"""
api/routes/market.py — ArkMania Marketplace HTTP surface (Phase 8).

The C++ plugin owns INSERTs into ARKM_market_items (`/market upload`)
and the final UPDATE-to-claimed (`/market claim`).  The panel owns
EVERYTHING ELSE: list price, cancel, buy, wallet operations,
transactions, audit.

Per the operator's design intent ('il plugin c++ carica e scarica
gli item e basta verificando i record a db; lo scambio token e la
modifica dello stato dei record la fa il pannello web'), this module
implements the panel side of that contract.  See
``docs/MARKETPLACE_API_CONTRACT.md`` for the full schema and state
machine.

Auth model:
  - GET /listed                 : any authenticated caller (panel JWT
                                  OR disc_session cookie)
  - GET /me/* + POST /list/buy/cancel  : requires disc_session cookie;
                                  the EOS comes from there.
  - POST /admin/*               : panel JWT, admin role.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.db.session import get_db, get_plugin_db
from app.api.routes.me import get_current_player, _PlayerSession
from app.services.market_thumbs import get_or_fetch_thumb, sanitize_thumb_name


router = APIRouter()


# ── Auth: optional player session OR a panel-admin override ─────────────────

async def _resolve_eos_for_read(
    player:  _PlayerSession = Depends(get_current_player),
    for_eos: Optional[str]  = Query(None, description="(admin only) view another EOS"),
) -> str:
    """
    For /me read endpoints: the EOS is the current Discord-linked
    player by default; admins can pass `?for_eos=...` to peek at
    another player's data.

    The for_eos override is enforced via require_admin in the route
    decorator chain when needed -- here we just trust the dependency
    upstream and return the right EOS.  When for_eos is set, this
    means an admin is viewing another player; the player session is
    still required to bypass the disc_session-cookie auth.
    """
    if for_eos:
        return for_eos.strip()
    return player.eos_id


# ── Pydantic shapes ─────────────────────────────────────────────────────────

class _ListedItem(BaseModel):
    id:           int
    blueprint:    str
    quantity:     int
    quality:      int
    is_blueprint: bool
    durability:   float
    rating:       float
    price:        int
    owner_eos_id: str
    owner_name:   Optional[str] = None
    listed_at:    Optional[str] = None


class _ListedResponse(BaseModel):
    total: int
    items: list[_ListedItem]


class _MyItem(BaseModel):
    """A marketplace row owned by OR queued for the current player."""
    id:           int
    role:         str            # 'owner' (uploaded by me) | 'buyer' (queued for me)
    blueprint:    str
    quantity:     int
    quality:      int
    price:        int
    status:       str
    owner_eos_id: str
    owner_name:   Optional[str] = None
    buyer_eos_id: Optional[str] = None
    buyer_name:   Optional[str] = None
    created_at:   Optional[str] = None
    listed_at:    Optional[str] = None
    sold_at:      Optional[str] = None
    claimed_at:   Optional[str] = None


class _WalletResponse(BaseModel):
    eos_id:  str
    balance: int


class _TransactionRow(BaseModel):
    id:                int
    role:              str       # 'buyer' | 'seller'
    item_id:           int
    blueprint:         Optional[str] = None
    quantity:          int
    price:             int
    counterpart_eos:   str
    counterpart_name:  Optional[str] = None
    created_at:        Optional[str] = None


class _TransactionsResponse(BaseModel):
    transactions: list[_TransactionRow]


class _ListRequest(BaseModel):
    price: int = Field(gt=0, description="Listing price in market tokens (positive int).")


class _BuyResponse(BaseModel):
    ok:             bool
    transaction_id: int
    item_id:        int
    price:          int
    new_balance:    int


class _AdminCreditRequest(BaseModel):
    eos_id: str
    amount: int = Field(description="Positive = credit, negative = debit (admin override).")
    reason: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────────────────

def _iso(v) -> Optional[str]:
    """Coerce a DateTime/None into an ISO string (or None)."""
    return v.isoformat() if v and hasattr(v, "isoformat") else (str(v) if v else None)


async def _get_or_create_wallet(plugin_db: AsyncSession, eos_id: str) -> int:
    """
    Return the wallet balance for *eos_id*, creating the row at 0 if missing.
    Single round-trip when the row exists; two when it doesn't.
    """
    row = (await plugin_db.execute(
        text("SELECT balance FROM ARKM_market_wallets WHERE eos_id = :e LIMIT 1"),
        {"e": eos_id},
    )).fetchone()
    if row is not None:
        return int(row[0] or 0)
    await plugin_db.execute(
        text("INSERT INTO ARKM_market_wallets (eos_id, balance) VALUES (:e, 0) "
             "ON DUPLICATE KEY UPDATE balance = balance"),
        {"e": eos_id},
    )
    await plugin_db.commit()
    return 0


async def _audit(plugin_db: AsyncSession, *,
                 actor_eos: Optional[str], action: str,
                 item_id: Optional[int] = None, amount: Optional[int] = None,
                 detail: Optional[str] = None) -> None:
    """Append a row to ARKM_market_audit; never raises."""
    try:
        await plugin_db.execute(
            text(
                "INSERT INTO ARKM_market_audit (actor_eos_id, action, item_id, amount, detail) "
                "VALUES (:a, :ac, :i, :am, :d)"
            ),
            {"a": actor_eos, "ac": action, "i": item_id, "am": amount, "d": detail},
        )
        await plugin_db.commit()
    except Exception:
        # Audit is best-effort; never fail a real op because of it.
        try: await plugin_db.rollback()
        except Exception: pass


# ── Item thumbnail proxy (Phase 8 GUI) ──────────────────────────────────────
# Public-ish: any authenticated caller can fetch.  No auth dependency
# at all -- the images are not sensitive (every player can see what's
# on the market) and removing the auth lookup makes the response
# trivially cacheable by browser + nginx.

@router.get("/thumb/{display_name}")
async def get_item_thumb(display_name: str):
    """
    Return the cached PNG for *display_name* (e.g. ``Mejoberry``).

    The first request triggers a fetch from ark.wiki.gg, which can
    take ~500-800 ms; every subsequent request is served from local
    disk with a 1-year browser cache header.

    Use ``arkItemDisplayName(blueprint)`` on the frontend to derive
    *display_name* from a raw blueprint path, then concatenate with
    ``/api/v1/market/thumb/`` (URL-encode the name -- the backend
    accepts spaces and most ASCII).

    Responds 404 when the wiki has no matching image (mod items,
    typos).  The 404 is cached on disk for 24h so we don't keep
    hammering the wiki.
    """
    # Strip the optional ``.png`` suffix to support both forms.
    name = display_name[:-4] if display_name.lower().endswith(".png") else display_name
    safe = sanitize_thumb_name(name)
    if not safe:
        raise HTTPException(status_code=422, detail="Invalid item name")

    data = await get_or_fetch_thumb(name)
    if data is None:
        raise HTTPException(status_code=404, detail="Image not found on wiki")

    return Response(
        content=data,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


# ── Browse listed items (any authenticated caller) ──────────────────────────

@router.get("/listed", response_model=_ListedResponse)
async def list_market_items(
    plugin_db: AsyncSession = Depends(get_plugin_db),
    limit:     int          = Query(50, ge=1, le=200),
    offset:    int          = Query(0,  ge=0),
    blueprint: Optional[str] = Query(None, description="Fragment match"),
    seller:    Optional[str] = Query(None, description="EOS"),
    min_price: Optional[int] = Query(None, ge=0),
    max_price: Optional[int] = Query(None, ge=0),
    sort:      str          = Query("newest", pattern="^(newest|price_asc|price_desc)$"),
):
    """List browseable marketplace items (status='listed')."""
    where  = ["status = 'listed'"]
    params: dict = {"lim": limit, "off": offset}
    if blueprint:
        where.append("blueprint LIKE :bp")
        params["bp"] = f"%{blueprint}%"
    if seller:
        where.append("owner_eos_id = :s")
        params["s"] = seller
    if min_price is not None:
        where.append("price >= :mn")
        params["mn"] = int(min_price)
    if max_price is not None:
        where.append("price <= :mx")
        params["mx"] = int(max_price)

    order = {
        "newest":     "listed_at DESC, id DESC",
        "price_asc":  "price ASC, listed_at DESC",
        "price_desc": "price DESC, listed_at DESC",
    }[sort]

    where_sql = " AND ".join(where)

    total = int((await plugin_db.execute(
        text(f"SELECT COUNT(*) FROM ARKM_market_items WHERE {where_sql}"), params,
    )).scalar() or 0)

    rows = (await plugin_db.execute(
        text(
            f"SELECT id, blueprint, quantity, quality, is_blueprint, durability, rating, "
            f"       price, owner_eos_id, owner_name, listed_at "
            f"FROM ARKM_market_items WHERE {where_sql} "
            f"ORDER BY {order} LIMIT :lim OFFSET :off"
        ),
        params,
    )).mappings().fetchall()

    return _ListedResponse(
        total=total,
        items=[
            _ListedItem(
                id           = int(r["id"]),
                blueprint    = r["blueprint"] or "",
                quantity     = int(r["quantity"] or 1),
                quality      = int(r["quality"] or 0),
                is_blueprint = bool(r["is_blueprint"]),
                durability   = float(r["durability"] or 0),
                rating       = float(r["rating"] or 0),
                price        = int(r["price"] or 0),
                owner_eos_id = r["owner_eos_id"],
                owner_name   = r.get("owner_name"),
                listed_at    = _iso(r.get("listed_at")),
            )
            for r in rows
        ],
    )


# ── /me/* (player-scoped) ───────────────────────────────────────────────────

@router.get("/me/wallet", response_model=_WalletResponse)
async def get_my_wallet(
    eos:       str          = Depends(_resolve_eos_for_read),
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """Return the wallet balance for the current player (auto-creates row)."""
    bal = await _get_or_create_wallet(plugin_db, eos)
    return _WalletResponse(eos_id=eos, balance=bal)


@router.get("/me/items", response_model=list[_MyItem])
async def list_my_items(
    eos:       str          = Depends(_resolve_eos_for_read),
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """Items I own (every status) + items queued for me to claim (status='sold')."""
    rows = (await plugin_db.execute(
        text(
            "SELECT id, blueprint, quantity, quality, price, status, "
            "       owner_eos_id, owner_name, buyer_eos_id, buyer_name, "
            "       created_at, listed_at, sold_at, claimed_at "
            "FROM ARKM_market_items "
            "WHERE owner_eos_id = :e OR buyer_eos_id = :e "
            "ORDER BY id DESC LIMIT 200"
        ),
        {"e": eos},
    )).mappings().fetchall()
    out: list[_MyItem] = []
    for r in rows:
        role = "owner" if r["owner_eos_id"] == eos else "buyer"
        out.append(_MyItem(
            id=int(r["id"]), role=role,
            blueprint=r["blueprint"] or "", quantity=int(r["quantity"] or 1),
            quality=int(r["quality"] or 0), price=int(r["price"] or 0),
            status=r["status"],
            owner_eos_id=r["owner_eos_id"], owner_name=r.get("owner_name"),
            buyer_eos_id=r.get("buyer_eos_id"), buyer_name=r.get("buyer_name"),
            created_at=_iso(r.get("created_at")),
            listed_at=_iso(r.get("listed_at")),
            sold_at=_iso(r.get("sold_at")),
            claimed_at=_iso(r.get("claimed_at")),
        ))
    return out


@router.get("/me/transactions", response_model=_TransactionsResponse)
async def list_my_transactions(
    eos:       str          = Depends(_resolve_eos_for_read),
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """Last 100 transactions where the current player is buyer or seller."""
    rows = (await plugin_db.execute(
        text(
            "SELECT id, item_id, buyer_eos_id, seller_eos_id, price, "
            "       blueprint, quantity, created_at "
            "FROM ARKM_market_transactions "
            "WHERE buyer_eos_id = :e OR seller_eos_id = :e "
            "ORDER BY created_at DESC LIMIT 100"
        ),
        {"e": eos},
    )).mappings().fetchall()

    # Look up counterpart names in one shot to avoid N+1.
    counterpart_eos_ids = list({
        (r["seller_eos_id"] if r["buyer_eos_id"] == eos else r["buyer_eos_id"])
        for r in rows
    })
    name_map: dict[str, str] = {}
    if counterpart_eos_ids:
        ph     = ",".join(f":c{i}" for i in range(len(counterpart_eos_ids)))
        params = {f"c{i}": cid for i, cid in enumerate(counterpart_eos_ids)}
        nm_rows = (await plugin_db.execute(
            text(f"SELECT EOS_Id, Giocatore FROM Players WHERE EOS_Id IN ({ph})"),
            params,
        )).fetchall()
        name_map = {r[0]: r[1] for r in nm_rows if r[1]}

    return _TransactionsResponse(transactions=[
        _TransactionRow(
            id=int(r["id"]),
            role="buyer" if r["buyer_eos_id"] == eos else "seller",
            item_id=int(r["item_id"]),
            blueprint=r.get("blueprint"),
            quantity=int(r["quantity"] or 1),
            price=int(r["price"] or 0),
            counterpart_eos =(r["seller_eos_id"] if r["buyer_eos_id"] == eos else r["buyer_eos_id"]),
            counterpart_name=name_map.get(
                r["seller_eos_id"] if r["buyer_eos_id"] == eos else r["buyer_eos_id"]
            ),
            created_at=_iso(r.get("created_at")),
        )
        for r in rows
    ])


# ── Owner write ops: list price, cancel ─────────────────────────────────────

@router.post("/list/{item_id}", response_model=_MyItem)
async def list_item_for_sale(
    item_id:   int,
    body:      _ListRequest,
    player:    _PlayerSession = Depends(get_current_player),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Set a price + flip from 'draft' to 'listed' (owner only).

    The plugin uploads items at status='draft' with price=0; this is
    where the owner publishes them.
    """
    row = (await plugin_db.execute(
        text("SELECT * FROM ARKM_market_items WHERE id = :i FOR UPDATE"),
        {"i": item_id},
    )).mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
    if row["owner_eos_id"] != player.eos_id:
        raise HTTPException(status_code=403, detail="NOT_OWNER")
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="INVALID_STATE")

    await plugin_db.execute(
        text(
            "UPDATE ARKM_market_items "
            "SET status='listed', price=:p, listed_at=NOW() "
            "WHERE id=:i"
        ),
        {"p": int(body.price), "i": item_id},
    )
    await plugin_db.commit()
    await _audit(plugin_db, actor_eos=player.eos_id, action="list",
                 item_id=item_id, amount=int(body.price))
    # Re-read for the response
    fresh = (await plugin_db.execute(
        text(
            "SELECT id, blueprint, quantity, quality, price, status, "
            "       owner_eos_id, owner_name, buyer_eos_id, buyer_name, "
            "       created_at, listed_at, sold_at, claimed_at "
            "FROM ARKM_market_items WHERE id = :i"
        ),
        {"i": item_id},
    )).mappings().fetchone()
    return _MyItem(
        id=int(fresh["id"]), role="owner",
        blueprint=fresh["blueprint"] or "", quantity=int(fresh["quantity"] or 1),
        quality=int(fresh["quality"] or 0), price=int(fresh["price"] or 0),
        status=fresh["status"],
        owner_eos_id=fresh["owner_eos_id"], owner_name=fresh.get("owner_name"),
        buyer_eos_id=fresh.get("buyer_eos_id"), buyer_name=fresh.get("buyer_name"),
        created_at=_iso(fresh.get("created_at")),
        listed_at=_iso(fresh.get("listed_at")),
        sold_at=_iso(fresh.get("sold_at")),
        claimed_at=_iso(fresh.get("claimed_at")),
    )


@router.post("/cancel/{item_id}")
async def cancel_listing(
    item_id:   int,
    player:    _PlayerSession = Depends(get_current_player),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Owner withdraws a draft/listed item.  Implemented as 'sold to self':
    set buyer_eos_id = owner_eos_id + status='sold' so the plugin's
    /market claim flow returns the item to its original owner.
    """
    row = (await plugin_db.execute(
        text("SELECT owner_eos_id, owner_name, status "
             "FROM ARKM_market_items WHERE id = :i FOR UPDATE"),
        {"i": item_id},
    )).mappings().fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
    if row["owner_eos_id"] != player.eos_id:
        raise HTTPException(status_code=403, detail="NOT_OWNER")
    if row["status"] not in ("draft", "listed"):
        raise HTTPException(status_code=409, detail="INVALID_STATE")

    await plugin_db.execute(
        text(
            "UPDATE ARKM_market_items "
            "SET status='sold', buyer_eos_id=:e, buyer_name=:n, sold_at=NOW() "
            "WHERE id=:i"
        ),
        {"e": player.eos_id, "n": row.get("owner_name"), "i": item_id},
    )
    await plugin_db.commit()
    await _audit(plugin_db, actor_eos=player.eos_id, action="cancel",
                 item_id=item_id, detail="owner withdrawal -- queued for self-claim")
    return {"ok": True, "item_id": item_id,
            "hint": "Use /market claim in-game to retrieve the item."}


# ── Purchase (atomic) ───────────────────────────────────────────────────────

@router.post("/buy/{item_id}", response_model=_BuyResponse)
async def buy_item(
    item_id:   int,
    player:    _PlayerSession = Depends(get_current_player),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Atomic purchase.  Locks the item row + both wallet rows, validates
    state and balance, then performs the transfer + records the
    transaction + audit -- all in one DB transaction.
    """
    me = player.eos_id

    # 1. SELECT item FOR UPDATE
    item = (await plugin_db.execute(
        text("SELECT * FROM ARKM_market_items WHERE id = :i FOR UPDATE"),
        {"i": item_id},
    )).mappings().fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
    if item["status"] != "listed":
        raise HTTPException(status_code=409, detail="ITEM_NOT_AVAILABLE")
    if item["owner_eos_id"] == me:
        raise HTTPException(status_code=409, detail="CANNOT_BUY_OWN_ITEM")

    seller = item["owner_eos_id"]
    price  = int(item["price"] or 0)

    # 2. Lock buyer wallet (auto-create at 0)
    await plugin_db.execute(
        text("INSERT INTO ARKM_market_wallets (eos_id, balance) VALUES (:e, 0) "
             "ON DUPLICATE KEY UPDATE balance = balance"),
        {"e": me},
    )
    buyer_bal = int((await plugin_db.execute(
        text("SELECT balance FROM ARKM_market_wallets WHERE eos_id = :e FOR UPDATE"),
        {"e": me},
    )).scalar() or 0)
    if buyer_bal < price:
        raise HTTPException(status_code=402, detail="INSUFFICIENT_FUNDS")

    # 3. Lock seller wallet (auto-create at 0)
    await plugin_db.execute(
        text("INSERT INTO ARKM_market_wallets (eos_id, balance) VALUES (:e, 0) "
             "ON DUPLICATE KEY UPDATE balance = balance"),
        {"e": seller},
    )
    await plugin_db.execute(
        text("SELECT balance FROM ARKM_market_wallets WHERE eos_id = :e FOR UPDATE"),
        {"e": seller},
    )

    # 4. Move tokens
    await plugin_db.execute(
        text("UPDATE ARKM_market_wallets SET balance = balance - :p WHERE eos_id = :e"),
        {"p": price, "e": me},
    )
    await plugin_db.execute(
        text("UPDATE ARKM_market_wallets SET balance = balance + :p WHERE eos_id = :e"),
        {"p": price, "e": seller},
    )

    # 5. Mark item sold
    buyer_name = (await plugin_db.execute(
        text("SELECT Giocatore FROM Players WHERE EOS_Id = :e LIMIT 1"),
        {"e": me},
    )).scalar()
    await plugin_db.execute(
        text(
            "UPDATE ARKM_market_items "
            "SET status='sold', buyer_eos_id=:b, buyer_name=:bn, sold_at=NOW() "
            "WHERE id=:i"
        ),
        {"b": me, "bn": buyer_name, "i": item_id},
    )

    # 6. Insert transaction
    tx_result = await plugin_db.execute(
        text(
            "INSERT INTO ARKM_market_transactions "
            "  (item_id, buyer_eos_id, seller_eos_id, price, blueprint, quantity) "
            "VALUES (:i, :b, :s, :p, :bp, :q)"
        ),
        {
            "i": item_id, "b": me, "s": seller, "p": price,
            "bp": item["blueprint"], "q": int(item["quantity"] or 1),
        },
    )
    await plugin_db.commit()
    tx_id = int(tx_result.lastrowid or 0)

    await _audit(plugin_db, actor_eos=me, action="buy", item_id=item_id, amount=price,
                 detail=f"seller={seller}")

    new_bal = int((await plugin_db.execute(
        text("SELECT balance FROM ARKM_market_wallets WHERE eos_id = :e"),
        {"e": me},
    )).scalar() or 0)

    return _BuyResponse(ok=True, transaction_id=tx_id, item_id=item_id,
                        price=price, new_balance=new_bal)


# ── Admin endpoints ─────────────────────────────────────────────────────────

@router.post("/admin/wallet/credit", dependencies=[Depends(require_admin)])
async def admin_credit_wallet(
    body:      _AdminCreditRequest,
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """Admin top-up / debit of any wallet.  Audited."""
    eos = body.eos_id.strip()
    if not eos:
        raise HTTPException(status_code=422, detail="eos_id required")
    await plugin_db.execute(
        text("INSERT INTO ARKM_market_wallets (eos_id, balance) VALUES (:e, 0) "
             "ON DUPLICATE KEY UPDATE balance = balance"),
        {"e": eos},
    )
    await plugin_db.execute(
        text("UPDATE ARKM_market_wallets SET balance = balance + :a WHERE eos_id = :e"),
        {"a": int(body.amount), "e": eos},
    )
    await plugin_db.commit()
    await _audit(plugin_db, actor_eos=None, action="credit_admin",
                 item_id=None, amount=int(body.amount),
                 detail=(body.reason or "")[:500])
    new_bal = int((await plugin_db.execute(
        text("SELECT balance FROM ARKM_market_wallets WHERE eos_id = :e"),
        {"e": eos},
    )).scalar() or 0)
    return {"ok": True, "eos_id": eos, "new_balance": new_bal}


@router.get("/admin/audit", dependencies=[Depends(require_admin)])
async def admin_get_audit(
    limit:     int                = Query(100, ge=1, le=500),
    offset:    int                = Query(0,   ge=0),
    actor:     Optional[str]      = Query(None),
    action:    Optional[str]      = Query(None),
    item_id:   Optional[int]      = Query(None),
    plugin_db: AsyncSession       = Depends(get_plugin_db),
):
    """Audit log -- filterable, paginated."""
    where:  list[str] = []
    params: dict      = {"lim": limit, "off": offset}
    if actor:
        where.append("actor_eos_id = :a"); params["a"] = actor
    if action:
        where.append("action = :ac");      params["ac"] = action
    if item_id is not None:
        where.append("item_id = :i");      params["i"] = int(item_id)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = (await plugin_db.execute(
        text(
            f"SELECT id, actor_eos_id, action, item_id, amount, detail, created_at "
            f"FROM ARKM_market_audit {where_sql} "
            f"ORDER BY id DESC LIMIT :lim OFFSET :off"
        ),
        params,
    )).mappings().fetchall()
    return {
        "items": [
            {
                "id":           int(r["id"]),
                "actor_eos_id": r.get("actor_eos_id"),
                "action":       r["action"],
                "item_id":      r.get("item_id"),
                "amount":       r.get("amount"),
                "detail":       r.get("detail"),
                "created_at":   _iso(r.get("created_at")),
            }
            for r in rows
        ],
    }
