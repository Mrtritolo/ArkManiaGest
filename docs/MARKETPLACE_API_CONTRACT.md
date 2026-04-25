# ArkMania Marketplace — Plugin↔DB↔Backend Contract

**Owner**: shared between the C++ plugin (in-game flows) and the
ArkManiaGest panel (web GUI).  Both write to the same MariaDB
**plugin** database; ownership of WHO writes WHICH columns is
strict — see §Ownership Matrix.

**Version**: 1.0 (Phase 8 / panel v3.5.0)

---

## Architecture

```
┌──────────────────────┐                       ┌──────────────────────┐
│  C++ Plugin          │                       │  ArkManiaGest panel  │
│  (in-game)           │                       │  (web)               │
├──────────────────────┤                       ├──────────────────────┤
│ /market upload       │   writes to plugin DB │ GET /market/listed   │
│ /market claim        │ ────────────────────► │ POST /market/buy/{id}│
│ inv enumeration      │                       │ GET /me/market/wallet│
│ ItemSerializer       │                       │ GET /me/market/trans │
└──────────────────────┘                       └──────────────────────┘
            │                                              │
            └─────────► PLUGIN DB (MariaDB) ◄──────────────┘
                          ARKM_market_items
                          ARKM_market_wallets
                          ARKM_market_transactions
                          ARKM_market_audit
```

The plugin handles physical-item flow (read inventory, serialize,
spawn back into inventory).  The panel handles commerce
(browse, buy, wallet display, history).  Both can READ everything;
WRITE responsibilities are strictly partitioned (see §Ownership).

---

## Ownership Matrix (FINAL — per operator design intent)

The plugin does **only physical-item movement** -- it serializes
items out of and into player inventories.  Every other state change
is done by the panel via DB writes.

| Operation                       | Owner   | Tables touched                                          |
|---------------------------------|---------|---------------------------------------------------------|
| **Plugin responsibilities**     |         |                                                         |
| Upload item from inventory      | Plugin  | INSERT `market_items` (status='draft')                  |
| Claim purchased item            | Plugin  | UPDATE `market_items.status='claimed', claimed_at=NOW()`|
| **Panel responsibilities**      |         |                                                         |
| Browse listed items             | Panel   | SELECT `market_items` WHERE status='listed'             |
| Set price + publish (list)      | Panel   | UPDATE `market_items` (status='listed', price, listed_at)|
| Cancel a listing                | Panel   | UPDATE `market_items` (set buyer_eos_id = owner_eos_id, status='sold') so the plugin's claim flow returns it to the owner |
| Purchase                        | Panel   | TRANSACTION over `market_items` + `market_wallets` + INSERT `market_transactions` + `market_audit` |
| Wallet credit (admin / faucet)  | Panel   | UPDATE `market_wallets`, INSERT `audit`                 |
| Wallet balance display          | Panel   | SELECT `market_wallets`                                 |

**Invariants**:
- The plugin NEVER touches `market_wallets`, `market_transactions`,
  or `market_audit`.
- The plugin NEVER changes `price`, `buyer_eos_id` or `status`
  except writing `'claimed'` (only on `/market claim`).
- The panel NEVER touches `item_data` (the binary blob) or
  `item_hash` -- those are owned by the plugin at upload time.
- Status transitions (draft → listed → sold → claimed) are owned
  by whoever the matrix says.  The plugin only writes `claimed`;
  every other transition is the panel's job.

**Why this split**: the plugin only knows how to serialize and
spawn items; the panel knows about money, ownership and policy.
Putting commerce logic in the plugin would require duplicating
wallet code in C++ and dealing with concurrency from two writers.
The single-writer rule per row eliminates entire classes of race
conditions.

---

## Database Schema

All tables live in the **plugin DB** (the same MariaDB the rest of
`ARKM_*` tables use).  Created automatically by the panel on first
boot of v3.5.0 via the existing `_add_column_if_missing` helper.

### `ARKM_market_items`

```sql
CREATE TABLE IF NOT EXISTS ARKM_market_items (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,

    -- Ownership
    owner_eos_id  VARCHAR(64)  NOT NULL,
    owner_name    VARCHAR(64),                     -- snapshot at upload time
    buyer_eos_id  VARCHAR(64),                     -- set when purchased
    buyer_name    VARCHAR(64),                     -- snapshot at purchase

    -- Item content (used by plugin to spawn back)
    blueprint     VARCHAR(512) NOT NULL,           -- Blueprint path (browseable)
    quantity      INT          NOT NULL DEFAULT 1,
    quality       INT          NOT NULL DEFAULT 0,
    is_blueprint  TINYINT(1)   NOT NULL DEFAULT 0, -- crafted item vs blueprint
    durability    FLOAT        NOT NULL DEFAULT 0,
    rating        FLOAT        NOT NULL DEFAULT 0,

    -- Authoritative serialized blob (FItemNetInfo via ItemSerializer)
    item_data     LONGBLOB     NOT NULL,

    -- Anti-dup fingerprint (SHA256 of item_data + owner_eos_id; UNIQUE)
    item_hash     CHAR(64)     NOT NULL UNIQUE,

    -- Commerce
    price         BIGINT       NOT NULL DEFAULT 0,
    status        ENUM('draft','listed','sold','claimed','cancelled')
                  NOT NULL DEFAULT 'draft',

    -- Timestamps
    listed_at     TIMESTAMP    NULL,
    sold_at       TIMESTAMP    NULL,
    claimed_at    TIMESTAMP    NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX ix_status (status),
    INDEX ix_owner (owner_eos_id),
    INDEX ix_buyer (buyer_eos_id),
    INDEX ix_blueprint (blueprint(128))
);
```

### `ARKM_market_wallets`

```sql
CREATE TABLE IF NOT EXISTS ARKM_market_wallets (
    eos_id     VARCHAR(64) PRIMARY KEY,
    balance    BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### `ARKM_market_transactions`

```sql
CREATE TABLE IF NOT EXISTS ARKM_market_transactions (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
    item_id       BIGINT       NOT NULL,
    buyer_eos_id  VARCHAR(64)  NOT NULL,
    seller_eos_id VARCHAR(64)  NOT NULL,
    price         BIGINT       NOT NULL,
    blueprint     VARCHAR(512),                    -- snapshot for history
    quantity      INT          NOT NULL DEFAULT 1,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_buyer  (buyer_eos_id),
    INDEX ix_seller (seller_eos_id),
    INDEX ix_item   (item_id)
);
```

### `ARKM_market_audit`

```sql
CREATE TABLE IF NOT EXISTS ARKM_market_audit (
    id           BIGINT       PRIMARY KEY AUTO_INCREMENT,
    actor_eos_id VARCHAR(64),                      -- who triggered the event
    action       VARCHAR(32)  NOT NULL,            -- upload|list|cancel|buy|claim|credit_admin
    item_id      BIGINT,
    amount       BIGINT,                           -- price/credit when applicable
    detail       VARCHAR(512),                     -- free-text context
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_actor (actor_eos_id),
    INDEX ix_item  (item_id)
);
```

---

## State Machine

```
                  ┌──── upload (PLUGIN) ────┐
                  │                         ▼
             (none)                 ┌───────────┐
                                    │   draft   │
                                    └─────┬─────┘
                                          │ list with price (PANEL)
                                          ▼
                                    ┌───────────┐
                                    │  listed   │
                                    └─────┬─────┘
                                          │
                          ┌───────────────┼───────────────┐
                          │ buy (PANEL)   │ cancel (PANEL)│
                          ▼               ▼               │
                  ┌───────────┐    sets buyer_eos_id      │
                  │   sold    │    = owner_eos_id;        │
                  └─────┬─────┘    same 'sold' state      │
                        │  claim (PLUGIN)                 │
                        ▼                                 │
                  ┌───────────┐ ◄────────── (owner picks  │
                  │  claimed  │              up own item) │
                  └───────────┘ (terminal)                │
```

Rules:
- `draft`: just uploaded, awaiting the owner to set a price in the
  web dashboard.  Visible only to owner.  No price set yet.
- `listed`: priced and browseable by everyone in
  `GET /market/listed`.  Owner can either cancel (item returns to
  them) or wait for a buyer.
- `sold`: the row is queued for in-game pickup by `buyer_eos_id`.
  TWO sources reach this state:
    (a) a real purchase: `buyer_eos_id` = the buyer
    (b) an owner cancel: `buyer_eos_id` = the owner (the same
        plugin claim flow returns the item to its original owner)
  The plugin's `/market claim` doesn't care which source produced
  the row -- it just spawns whatever has `buyer_eos_id = me AND
  status='sold'` into that player's inventory.
- `claimed`: terminal.  The plugin wrote this after a successful
  spawn into the player's inventory.

There is **no `cancelled` state**: cancel is implemented by
flipping back to `sold` with `buyer_eos_id = owner_eos_id`, so the
plugin returns the item via the standard claim flow.  This keeps
the plugin's surface tiny (one read query, one write query).

---

## Plugin Operations (direct DB) — TWO commands, that's it

The plugin owns ONLY: serializing items into rows, and de-serializing
rows into items.  No price, no wallet, no buyer logic.

### `/market upload`

NO price argument -- that's set later in the web dashboard.

1. Enumerate inventory items in the `Market` folder (folder name
   detection via `UPrimalItem::CustomItemName` or `ItemFolderName`
   -- see ItemSerializer for the existing pattern).
2. For each item:
   - Capture via `ArkMania::ItemSerializer::CaptureItem(...)`.
   - Compute `item_hash = SHA256(NetInfoBlob || ownerEosId)`.
   - INSERT into `ARKM_market_items`:
     - `owner_eos_id` = current player's EOS
     - `owner_name`   = current player's display name
     - `item_data`    = the binary blob from CaptureItem
     - `item_hash`    = the SHA256 above
     - `status='draft'` (always; the panel transitions to 'listed'
       when the owner sets a price)
     - `price=0` (panel sets the real value)
   - On UNIQUE-violation of `item_hash`: this item was already
     uploaded (anti-dup) -- **do NOT remove it from inventory**;
     report the conflict to the player.
   - On INSERT success: remove the item from inventory.  Atomicity:
     INSERT first, then `RemoveItem` -- if RemoveItem fails, DELETE
     the just-inserted row by id.

The plugin does NOT write to `market_audit` -- the panel handles
audit writes when the owner lists / cancels / etc.  An optional
plugin-side audit row (`action='upload'`) is fine but not required.

### `/market claim`

Pulls every row queued for this player (purchased OR cancelled-by-owner-for-himself):

1. `SELECT * FROM ARKM_market_items WHERE buyer_eos_id = <me> AND status = 'sold' ORDER BY sold_at LIMIT N`.
2. For each row:
   - Validate inventory has slot space (else: skip + report).
   - Restore item via
     `ArkMania::ItemSerializer::RestoreItem(playerInv, item_data)`.
   - On spawn success:
     `UPDATE ARKM_market_items SET status='claimed', claimed_at=NOW() WHERE id=:id`.
   - On spawn failure: leave the row at `sold` so the player can
     retry on next `/market claim` call.

That's it.  The plugin does no price/wallet/transaction work.

### `/market list` (optional, in-game inventory check)

Optional convenience: shows the player THEIR own marketplace state
(items in draft / listed / sold-pending-claim) without leaving
the game.  Read-only -- pure SELECT against `market_items`
filtered by `owner_eos_id = me OR buyer_eos_id = me`.

---

## Backend API (panel)

All endpoints prefixed `/api/v1/market/...`.  Auth model:
- **Browse / wallet / history**: `disc_session` cookie (player view)
  OR panel JWT (admin view of any player by passing `?for_eos=...`).
- **Purchase**: `disc_session` cookie REQUIRED -- the buyer is the
  current Discord-linked player; admins cannot buy on behalf of
  others.

### `GET /market/listed`
List browseable items.  Public to any authenticated user
(disc_session OR panel JWT).

Query params:
- `limit`        (int, default 50, max 200)
- `offset`       (int, default 0)
- `blueprint`    (str, fragment match, optional)
- `seller`       (eos_id, optional)
- `min_price`, `max_price` (int, optional)
- `sort`         (`price_asc` | `price_desc` | `newest`, default `newest`)

Response:
```json
{
  "total": 1234,
  "items": [
    {
      "id":           123,
      "blueprint":    "/Game/.../PrimalItem_Foo.PrimalItem_Foo",
      "quantity":     5,
      "quality":      3,
      "is_blueprint": false,
      "durability":   100.0,
      "rating":       12.4,
      "price":        500,
      "owner_eos_id": "...",
      "owner_name":   "Mrtritolo",
      "listed_at":    "2026-04-25T..."
    }
  ]
}
```

`item_data` blob is NEVER returned by the backend (large + plugin-only).

### `GET /market/me/wallet`
Returns the wallet balance for the current player (disc_session) OR
for `?for_eos=...` (admin only).

```json
{ "eos_id": "...", "balance": 1250 }
```

Auto-creates the row at balance=0 on first read.

### `GET /market/me/transactions`
Last 100 transactions where the current player is buyer OR seller.

```json
{
  "transactions": [
    { "id": 9, "role": "buyer",  "item_id": 123, "blueprint": "...", "price": 500,  "counterpart_eos": "...", "counterpart_name": "...", "created_at": "..." },
    { "id": 8, "role": "seller", ... }
  ]
}
```

### `POST /market/list/{id}` (owner only)

Set a price + flip from `draft` to `listed`.  Body: `{ price: int }`.

1. SELECT row WHERE `id=:id AND owner_eos_id=:me FOR UPDATE`.
2. Reject with 409 INVALID_STATE if `status != 'draft'`.
3. Validate `price > 0` (else 422).
4. UPDATE `status='listed', price=:price, listed_at=NOW()`.
5. INSERT audit (`action='list'`, amount=`:price`).

### `POST /market/cancel/{id}` (owner only)

Owner withdraws a listing.  Item returns to them via the standard
`/market claim` flow (status flips to `sold` with `buyer_eos_id =
owner_eos_id`).

1. SELECT row WHERE `id=:id AND owner_eos_id=:me FOR UPDATE`.
2. Reject with 409 INVALID_STATE if `status NOT IN ('draft', 'listed')`.
3. UPDATE
     `status='sold',
      buyer_eos_id=owner_eos_id,
      buyer_name=owner_name,
      sold_at=NOW()`.
4. INSERT audit (`action='cancel'`).
5. The owner's next `/market claim` returns the item.

### `POST /market/buy/{id}`
Atomic purchase.  Transaction body (server-side):

1. `BEGIN;`
2. `SELECT * FROM ARKM_market_items WHERE id=:id FOR UPDATE` --
   row-level lock prevents concurrent buyers.
3. Validate `status='listed'`.
4. `SELECT balance FROM ARKM_market_wallets WHERE eos_id=:buyer FOR UPDATE`
   (auto-insert row at 0 if missing).
5. Check `balance >= price` -- else 402 INSUFFICIENT_FUNDS.
6. `UPDATE ARKM_market_wallets SET balance = balance - :price WHERE eos_id=:buyer`.
7. `UPDATE ARKM_market_wallets SET balance = balance + :price WHERE eos_id=:seller`
   (auto-insert seller row at 0 + price).
8. `UPDATE ARKM_market_items SET status='sold', buyer_eos_id=:buyer, buyer_name=:bname, sold_at=NOW() WHERE id=:id`.
9. `INSERT INTO ARKM_market_transactions (...)`.
10. `INSERT INTO ARKM_market_audit (action='buy', actor_eos_id=:buyer, ...)`.
11. `COMMIT;`

On error: `ROLLBACK`.  Returns `{ ok: true, transaction_id: ... }`
or a typed error code.

### `POST /market/cancel/{id}` (owner only)
Sets the item back to the owner's pending-claim list -- creates a
synthetic "sold to self" entry so the plugin's `/market claim` will
return it on next call.  Atomic: same FOR UPDATE pattern.

Only valid when `status='listed'` AND `owner_eos_id == disc_session.eos_id`.

### Admin endpoints (panel JWT, role=admin)

- `POST /market/admin/wallet/credit` -- top up a wallet (faucet,
  refund, dispute).  Body `{ eos_id, amount, reason }`.  Adds an
  audit row with `action='credit_admin'`.
- `GET  /market/admin/audit?limit=&offset=` -- full audit log,
  filterable by actor / action / item_id.

---

## Error Codes

| HTTP | Body code             | Meaning                            |
|------|-----------------------|------------------------------------|
| 400  | INVALID_STATE         | Item not in expected state         |
| 401  | NO_DISCORD_SESSION    | Buyer endpoint without disc_session|
| 402  | INSUFFICIENT_FUNDS    | Buyer wallet balance < price       |
| 403  | NOT_OWNER             | Cancel attempted by non-owner      |
| 404  | ITEM_NOT_FOUND        | id doesn't exist                   |
| 409  | ITEM_NOT_AVAILABLE    | Item already sold/claimed/cancelled|
| 409  | DUPLICATE_FINGERPRINT | item_hash UNIQUE violation         |

---

## Anti-Duplication Strategy

1. **`item_hash`** = SHA256(NetInfoBlob || owner_eos_id).  UNIQUE.
   Re-uploading the same item instance from the same player =
   immediate INSERT failure.
2. **Inventory removal AFTER insert** (plugin side): the item leaves
   the inventory ONLY when the row is safely committed to DB.  If
   the INSERT fails, the item stays in the player's hands.
3. **Claim-only-once**: `status='claimed'` is terminal.  The
   `/market claim` query filters on `status='sold'` so a
   double-spawn is impossible.
4. **FOR UPDATE on purchase**: row-level lock prevents two buyers
   racing on the same item.

---

## Concurrency notes

- All commerce mutations on the panel side use SQLAlchemy async
  sessions with explicit `session.begin()` and `FOR UPDATE` reads.
- The plugin uses the existing `shared/Database.cpp` connection
  pool; for the upload INSERT it should use a single transaction
  per item, not per batch (so a partial-batch failure doesn't
  reverse already-uploaded items).
- The audit table is append-only -- no foreign keys to
  `market_items` so a hard-deleted row keeps its history.

---

## Implementation status

| Phase                                 | Owner  | Status   |
|---------------------------------------|--------|----------|
| 1. DB schema + migration              | panel  | ⏳ planned for v3.5.0 |
| 2. Backend GET endpoints              | panel  | ⏳ planned for v3.5.0 |
| 3. Backend POST /buy + /cancel        | panel  | ⏳ planned for v3.5.0 |
| 4. Plugin `/market upload` + `/claim` | plugin | TODO -- pick up this contract in the plugin chat |
| 5. Frontend dashboard                 | panel  | ⏳ planned for v3.5.0 |
| 6. Anti-exploit hardening             | both   | ongoing |
