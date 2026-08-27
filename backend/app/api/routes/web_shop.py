"""
api/routes/web_shop.py — acquisto dal web con i punti di gioco.

Il pannello vende, il plugin consegna. Qui vive solo la parte che il web puo'
fare da solo: mostrare il catalogo, scalare i punti ArkShop e mettere in coda
l'ordine in ``ARKM_shop_orders``. La consegna e' del plugin
(ARKM-Marketplace, ``/ritiro``), perche' un oggetto entra in un inventario e
un inventario esiste solo mentre il giocatore e' in gioco.

Due cataloghi, due sorgenti, entrambe autorevoli lato server:
  * item / dino — ``ARKM_web_shop_items``, popolata importando la config di
    ArkShop (rotta admin sotto). L'import esplicito e' voluto: la config di
    ArkShop contiene anche tipi che dal web non vendiamo (beacon,
    experience, unlockengram, command), e passare da una tabella dedicata
    permette di scegliere cosa esporre invece di riversare tutto.
  * gene — ``ARKM_gene_traits``, pubblicata dal plugin ARKM-GeneShop, che e'
    l'unico posto dove i tratti esistono davvero.

Sui punti: ArkShop rilegge ``ArkShopPlayers.Points`` dal DB a ogni
operazione e non tiene cache in memoria, quindi lo scalo fatto qui e' visto
dal gioco immediatamente. Lo scalo e' condizionale (``WHERE Points >= :p``)
in modo che due acquisti simultanei non possano portare il saldo sotto zero.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.db.session import get_db, get_plugin_db
from app.api.routes.me import get_current_player, _PlayerSession

log = logging.getLogger("arkmaniagest.web_shop")

router = APIRouter()

# I soli tipi consegnabili dal web. 'command' e' escluso per scelta: la voce
# 'command' di ArkShop esegue console command arbitrari definiti in config, e
# dietro un bottone web significherebbe che una sessione del pannello puo'
# farli eseguire sul server. In gioco il rischio e' minore perche' il comando
# parte comunque da un giocatore presente.
WEB_KINDS = ("item", "dino", "gene")


def _lines_of(items_json: Optional[str]) -> list[dict]:
    """
    Righe che compongono una voce di catalogo.

    Una voce ArkShop non e' un oggetto: e' un pacchetto di 1..N righe
    (``Items``), ed e' normale che ne abbia cinque, come un set di armatura.
    Ogni riga porta il proprio blueprint, quantita', qualita' e flag
    blueprint.
    """
    if not items_json:
        return []
    try:
        parsed = json.loads(items_json)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


# ── Catalogo ──────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def catalog(
    kind: Optional[str] = Query(None, description="item | dino | gene"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Catalogo acquistabile dal web: oggetti e dino importati da ArkShop, piu'
    i tratti genetici pubblicati da ARKM-GeneShop.

    Rotta PUBBLICA, senza autenticazione: e' una vetrina e non contiene dati
    di nessun giocatore. Deve restare raggiungibile sia col JWT del pannello
    sia con la sola sessione Discord del giocatore, che JWT non ne ha; un
    gate a livello di router escluderebbe i secondi.
    """
    if kind and kind not in WEB_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {WEB_KINDS}")

    items: list[dict] = []
    if kind in (None, "item", "dino"):
        where = "WHERE enabled = 1"
        params: dict = {}
        if kind:
            where += " AND kind = :k"
            params["k"] = kind
        rows = await db.execute(text(
            "SELECT item_key, label, kind, category, blueprint, quantity, "
            "quality, is_blueprint, dino_level, price, items_json "
            f"FROM ARKM_web_shop_items {where} ORDER BY category, label"), params)
        for r in rows.fetchall():
            lines = _lines_of(r[10])
            items.append({
                "key": r[0], "label": r[1], "kind": r[2], "category": r[3],
                "blueprint": r[4], "quantity": r[5], "quality": r[6],
                "is_blueprint": bool(r[7]), "dino_level": r[8], "price": r[9],
                # Le righe che compongono la voce. Vanno nel catalogo e non
                # dietro una seconda chiamata: sono poche decine di byte
                # ciascuna e servono per aprire il dettaglio senza attese.
                "lines": [
                    {
                        "blueprint": str(ln.get("Blueprint", "")),
                        "amount": int(ln.get("Amount", 1) or 1),
                        "quality": int(ln.get("Quality", 0) or 0),
                        "is_blueprint": bool(ln.get("ForceBlueprint", False)),
                    }
                    for ln in lines if isinstance(ln, dict)
                ],
                "line_count": len(lines) if lines else 1,
            })

    genes: list[dict] = []
    if kind in (None, "gene"):
        try:
            rows = await db.execute(text(
                "SELECT internal_name, display_name, category, description, "
                "cost_t1, cost_t2, cost_t3 FROM ARKM_gene_traits "
                "ORDER BY category, display_name"))
            for r in rows.fetchall():
                genes.append({
                    "key": r[0], "label": r[1], "category": r[2],
                    "description": r[3],
                    "prices": {"1": r[4], "2": r[5], "3": r[6]},
                })
        except Exception:
            # Tabella assente = nessun server ha ancora avviato il GeneShop
            # con la versione che la pubblica. Vetrina vuota, non un errore.
            log.info("web_shop: ARKM_gene_traits non disponibile")

    return {"items": items, "genes": genes}


# ── Acquisto ──────────────────────────────────────────────────────────────────

class BuyRequest(BaseModel):
    kind: str
    key: str
    quantity: int = Field(1, ge=1, le=100)
    gene_tier: int = Field(1, ge=1, le=3)


@router.post("/buy")
async def buy(
    data: BuyRequest,
    player: _PlayerSession = Depends(get_current_player),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Compra con i punti ArkShop e mette l'ordine in coda per il ritiro.

    L'ordine di esecuzione conta: prima si scala, poi si accoda. Al
    contrario, un errore fra i due passi regalerebbe l'oggetto; cosi' il
    caso peggiore e' un addebito senza ordine, che resta nel log e si
    rimborsa a mano — molto piu' raro e molto meno costoso.
    """
    eos = player.eos_id
    if data.kind not in WEB_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {WEB_KINDS}")

    # 1. Risolvi la voce di catalogo e il prezzo, dal DB e mai dal client:
    #    il prezzo arrivato dal browser sarebbe il prezzo scelto dal browser.
    lines: list[dict] = []
    order: dict = {
        "kind": data.kind, "item_key": data.key, "blueprint": "",
        "quantity": data.quantity, "quality": 0, "is_blueprint": 0,
        "dino_level": 1, "gene_trait": "", "gene_tier": data.gene_tier,
        "source": "arkshop",
    }

    if data.kind == "gene":
        row = (await db.execute(text(
            "SELECT internal_name, cost_t1, cost_t2, cost_t3 "
            "FROM ARKM_gene_traits WHERE internal_name = :k"),
            {"k": data.key})).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Trait not found.")
        unit = {1: row[1], 2: row[2], 3: row[3]}[data.gene_tier]
        order["source"] = "geneshop"
        order["gene_trait"] = row[0]
        # I geni si consegnano uno per oggetto: la quantita' diventa il
        # numero di ordini, non un campo dentro l'ordine.
        total = unit * data.quantity
    else:
        row = (await db.execute(text(
            "SELECT item_key, kind, blueprint, quantity, quality, "
            "is_blueprint, dino_level, price, items_json "
            "FROM ARKM_web_shop_items "
            "WHERE item_key = :k AND enabled = 1"), {"k": data.key})).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found.")
        if row[1] != data.kind:
            raise HTTPException(status_code=422, detail="Wrong kind for this item.")
        order["blueprint"] = row[2]
        order["quality"] = row[4]
        order["is_blueprint"] = 1 if row[5] else 0
        order["dino_level"] = row[6]
        unit = row[7]
        lines = _lines_of(row[8])
        if data.kind == "dino":
            # Un dino per pod: come i geni, la quantita' e' il numero di ordini.
            order["quantity"] = 1
            total = unit * data.quantity
        else:
            order["quantity"] = row[3] * data.quantity
            total = unit * data.quantity

    if total <= 0:
        raise HTTPException(status_code=422, detail="This entry has no price set.")

    # 2. Scala i punti in modo condizionale: se il saldo e' cambiato fra la
    #    lettura e la scrittura, la UPDATE non tocca nessuna riga e non c'e'
    #    nessun addebito da annullare.
    res = await db.execute(text(
        "UPDATE ArkShopPlayers SET Points = Points - :p, "
        "TotalSpent = TotalSpent + :p WHERE EosId = :e AND Points >= :p"),
        {"p": total, "e": eos})
    if res.rowcount != 1:
        await db.rollback()
        cur = (await db.execute(text(
            "SELECT Points FROM ArkShopPlayers WHERE EosId = :e"),
            {"e": eos})).fetchone()
        raise HTTPException(
            status_code=400,
            detail=f"Punti insufficienti: servono {total}, "
                   f"disponibili {cur[0] if cur else 0}.")

    # 3. Accoda: un ordine per ogni riga consegnabile. Una voce ArkShop puo'
    #    essere un pacchetto (il set di armatura sono cinque pezzi) e il
    #    plugin consegna un blueprint per ordine, quindi e' qui che il
    #    pacchetto si apre.
    #
    #    Da questo punto i punti sono GIA' scalati: tutto cio' che segue sta
    #    dentro il try, compresa la costruzione dei parametri. Un errore
    #    lasciato fuori dal try non verrebbe rimborsato dal nostro ramo di
    #    errore, e la sessione lo salverebbe solo per fortuna.
    rows_to_queue: list[dict] = []
    try:
        base = {
            "eos": eos,
            # _PlayerSession porta i nomi Discord, non un generico "name".
            "name": (player.discord_global_name
                     or player.discord_username or "")[:64],
            "src": order["source"], "key": order["item_key"],
            "kind": order["kind"], "lvl": order["dino_level"],
            "trait": order["gene_trait"], "tier": order["gene_tier"],
        }
        if data.kind == "item" and lines:
            for _ in range(data.quantity):
                for ln in lines:
                    rows_to_queue.append({**base,
                        "bp": str(ln.get("Blueprint", ""))[:512],
                        "qty": int(ln.get("Amount", 1) or 1),
                        "qual": int(ln.get("Quality", 0) or 0),
                        "isbp": 1 if ln.get("ForceBlueprint", False) else 0})
        else:
            n = data.quantity if data.kind in ("dino", "gene") else 1
            for _ in range(n):
                rows_to_queue.append({**base,
                    "bp": order["blueprint"], "qty": order["quantity"],
                    "qual": order["quality"], "isbp": order["is_blueprint"]})

        if not rows_to_queue:
            # Nessuna riga consegnabile: annulla l'addebito, non c'e' niente
            # da consegnare e tenere i punti sarebbe un furto.
            await db.rollback()
            raise HTTPException(status_code=422,
                                detail="Questa voce non ha nulla da consegnare.")

        n_orders = len(rows_to_queue)
        for r in rows_to_queue:
            await db.execute(text(
                "INSERT INTO ARKM_shop_orders "
                "(eos_id, player_name, source, item_key, kind, blueprint, "
                " quantity, quality, is_blueprint, dino_level, gene_trait, "
                " gene_tier, price, status) "
                "VALUES (:eos, :name, :src, :key, :kind, :bp, :qty, :qual, "
                "        :isbp, :lvl, :trait, :tier, :price, 'pending')"),
                {**r, "price": total // n_orders})
        await db.commit()
    except HTTPException:
        # Gia' gestita sopra (rollback incluso): non e' un errore da
        # trasformare nel messaggio generico di addebito senza ordine.
        raise
    except Exception as exc:
        await db.rollback()
        # I punti sono gia' stati scalati e la INSERT e' fallita: e' il caso
        # che va reso rumoroso, perche' e' l'unico in cui il giocatore paga
        # senza ricevere.
        log.error("web_shop: ordine non accodato dopo l'addebito "
                  "eos=%s totale=%s: %s", eos, total, exc)
        raise HTTPException(
            status_code=500,
            detail="Punti scalati ma ordine non registrato: contatta un admin.")

    return {"status": "ok", "orders": n_orders, "spent": total}


@router.get("/orders")
async def my_orders(
    player: _PlayerSession = Depends(get_current_player),
    db: AsyncSession = Depends(get_plugin_db),
):
    """I miei ordini: cosa aspetta il ritiro e cosa ho gia' ritirato."""
    rows = await db.execute(text(
        "SELECT id, source, item_key, kind, blueprint, quantity, gene_trait, "
        "gene_tier, price, status, server_key, last_error, created_at, "
        "claimed_at FROM ARKM_shop_orders WHERE eos_id = :e "
        "ORDER BY created_at DESC LIMIT 200"), {"e": player.eos_id})
    out = []
    for r in rows.fetchall():
        out.append({
            "id": r[0], "source": r[1], "item_key": r[2], "kind": r[3],
            "blueprint": r[4], "quantity": r[5], "gene_trait": r[6],
            "gene_tier": r[7], "price": r[8], "status": r[9],
            "server_key": r[10], "last_error": r[11] or None,
            "created_at": str(r[12]) if r[12] else None,
            "claimed_at": str(r[13]) if r[13] else None,
        })
    pending = sum(1 for o in out if o["status"] == "pending")
    return {"orders": out, "pending": pending}


# ── Amministrazione del catalogo ──────────────────────────────────────────────

@router.post("/admin/import-arkshop", dependencies=[Depends(require_admin)])
async def import_from_arkshop(db: AsyncSession = Depends(get_plugin_db)):
    """
    Importa in ``ARKM_web_shop_items`` le voci item/dino della config ArkShop.

    Le voci gia' presenti mantengono ``enabled`` e ``price``: l'import
    aggiorna la definizione tecnica (blueprint, quantita', livello) senza
    ributtare online qualcosa che era stato tolto a mano dalla vetrina.
    """
    from app.api.routes.arkshop import _require_vault, _get_config

    _require_vault()
    shop_items = _get_config().get("ShopItems", {})

    imported = 0
    skipped_kinds: dict[str, int] = {}
    for key, val in shop_items.items():
        kind = str(val.get("Type", "")).lower()
        if kind not in ("item", "dino"):
            skipped_kinds[kind or "?"] = skipped_kinds.get(kind or "?", 0) + 1
            continue

        # Una voce ArkShop di tipo item porta il suo contenuto in "Items",
        # una lista di righe con blueprint/quantita'/qualita' — anche quando
        # la riga e' una sola. La voce dino ha invece Blueprint e Level in
        # cima. Il primo import leggeva solo la forma dino e finiva per
        # saltare l'intero catalogo.
        lines = val.get("Items") or []
        if kind == "item" and not isinstance(lines, list):
            lines = []

        if kind == "item":
            if not lines:
                skipped_kinds["item-empty"] = skipped_kinds.get("item-empty", 0) + 1
                continue
            first = lines[0] if isinstance(lines[0], dict) else {}
            blueprint = str(first.get("Blueprint", ""))
            quantity = int(first.get("Amount", 1) or 1)
            quality = int(first.get("Quality", 0) or 0)
            is_bp = 1 if first.get("ForceBlueprint", False) else 0
            dino_level = 1
            items_json = json.dumps(lines)
        else:
            blueprint = str(val.get("Blueprint", ""))
            if not blueprint:
                skipped_kinds["dino-noblueprint"] = \
                    skipped_kinds.get("dino-noblueprint", 0) + 1
                continue
            quantity, quality, is_bp = 1, 0, 0
            dino_level = int(val.get("Level", 1) or 1)
            items_json = None

        await db.execute(text(
            "INSERT INTO ARKM_web_shop_items "
            "(item_key, label, kind, category, blueprint, quantity, quality, "
            " is_blueprint, dino_level, price, enabled, items_json) "
            "VALUES (:k, :lbl, :kind, :cat, :bp, :qty, :qual, :isbp, :lvl, "
            "        :price, 1, :ij) "
            "ON DUPLICATE KEY UPDATE label=VALUES(label), kind=VALUES(kind), "
            "blueprint=VALUES(blueprint), quantity=VALUES(quantity), "
            "quality=VALUES(quality), is_blueprint=VALUES(is_blueprint), "
            "dino_level=VALUES(dino_level), items_json=VALUES(items_json)"),
            {
                "k": key[:128],
                "lbl": str(val.get("Title", key))[:128],
                "kind": kind,
                "cat": str(val.get("Permissions", ""))[:64],
                "bp": blueprint[:512],
                "qty": quantity,
                "qual": quality,
                "isbp": is_bp,
                "lvl": dino_level,
                "price": int(val.get("Price", 0) or 0),
                "ij": items_json,
            })
        imported += 1
    await db.commit()
    return {"imported": imported, "skipped": skipped_kinds}


class CatalogEntryUpdate(BaseModel):
    price: Optional[int] = Field(None, ge=0)
    enabled: Optional[bool] = None
    label: Optional[str] = None


@router.put("/admin/catalog/{item_key}", dependencies=[Depends(require_admin)])
async def update_catalog_entry(
    item_key: str,
    data: CatalogEntryUpdate,
    db: AsyncSession = Depends(get_plugin_db),
):
    """Ritocca prezzo, etichetta o visibilita' di una voce della vetrina."""
    sets, params = [], {"k": item_key}
    if data.price is not None:
        sets.append("price = :p"); params["p"] = data.price
    if data.enabled is not None:
        sets.append("enabled = :e"); params["e"] = 1 if data.enabled else 0
    if data.label is not None:
        sets.append("label = :l"); params["l"] = data.label[:128]
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    res = await db.execute(text(
        f"UPDATE ARKM_web_shop_items SET {', '.join(sets)} WHERE item_key = :k"),
        params)
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Entry not found.")
    return {"status": "ok"}
