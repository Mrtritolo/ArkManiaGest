# Changelog

All notable changes to ArkManiaGest are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

---

## [3.5.2] - 2026-04-26

Cryopod-aware marketplace cards: species, level, gender and stat
distribution extracted from the dino payload embedded in the
item.  Plus the durability `2591980%` glitch that also showed on
cryopods is now suppressed.

### Added

- **Cryopod cards on the marketplace dashboard.**  When a
  marketplace listing's blueprint name contains `cryopod` (stock
  Empty / Socketable cryopods + modded variants), the card now
  surfaces the dino inside instead of just rendering 'Empty
  Cryopod':

    * Headline becomes `Moschops · Lvl 197` (species + level).
    * Image background gets a purple gradient so cryopods stand
      out from regular resources at a glance.
    * Top-right overlay: gold `Lvl N` badge (replaces the
      `×quantity` badge -- cryopods are always qty 1).
    * Top-left overlay: gender symbol (♀ pink / ♂ blue) when
      detected.
    * Stat row: 7-column grid showing the dino's stat distribution
      (`HP / St / Ox / Fd / Wt / Dm / Sp` -- whichever values the
      blob carries) instead of the generic Q/durability/rating
      chips used for regular items.

  All extraction is best-effort and lossless: when the blob
  doesn't yield a usable parse the card falls back to the
  standard layout.

### Backend

- New `app/services/cryopod_parser.py` -- decodes the base64
  `item_data` blob, walks every UE FString in the outer envelope
  AND in the embedded zlib-compressed dino character payload,
  matches against the canonical patterns
  (`Name - Lvl N (Species)`, `Name_Character_BP_C[_id]`,
  `\d+,\d+,...,?`, `MALE`/`FEMALE`, `/Game/.../Dinos/.../X`).
  Returns `CryopodInfo` with whatever fields could be matched;
  None on bad blob.  ~1-3 ms per cryopod.

- `GET /api/v1/market/listed` and `GET /api/v1/market/me/items`
  now SELECT `item_data` too, parse it lazily for any row whose
  blueprint contains `cryopod`, and attach the result as a new
  `dino: { species, level, display_name, stats, gender,
  blueprint, colors }` field on each list item.  Non-cryopod
  rows get `dino: null` and the rest of the response shape is
  unchanged.

### Frontend

- New `MarketDinoCard` typed interface in `services/api.ts`;
  `MarketListedItem` and `MarketMyItem` both extended with
  `dino: MarketDinoCard | null`.
- `MarketPage` ItemCard branches on `it.dino` to switch the
  card into 'cryopod mode'.

### Fixed (carryover from v3.5.1)

- **Durability `2591980%` chip** on Empty Cryopod cards.  ARK's
  ItemDurability field is supposed to live in 0..100 but plugins
  occasionally stuff non-percentage data there for special items
  (cryopods being the most obvious case).  The chip now only
  renders when the value is in the canonical 0..100 range.
  Cryopods take the new dino-stats grid path instead of any
  durability chip, so the regression is gone for them either way.

### Operational notes

- No DB schema change; no migration.  The parser is purely
  read-side over the existing `item_data` LONGBLOB.
- A future plugin update can pre-populate dedicated dino_*
  columns at upload time to skip the parse on every list
  request; the contract doc will document that path when the
  plugin chat picks it up.
- Parser tolerates 1-3 byte truncations in the base64 data
  (occasional copy-paste damage when investigating in the SQL
  console) -- best-effort decode rather than a strict reject.

---
## [3.5.1] - 2026-04-26

Marketplace GUI upgrade: visually richer cards with ARK item
images served same-origin from a local on-disk cache.

### Added

- **Item image proxy + cache.**  New
  `GET /api/v1/market/thumb/{display_name}` endpoint fetches the
  matching PNG from `ark.wiki.gg/wiki/Special:FilePath/<name>.png`
  on first request, persists it to
  `backend/data/market_thumbs/<safe>.png`, then serves every
  subsequent hit from local disk with a 1-year browser-cache
  header.

  Why proxy instead of pointing the `<img>` straight at the wiki:
    - keeps the panel's CSP locked to `img-src 'self' data:
      cdn.discordapp.com` (no need to also whitelist ark.wiki.gg)
    - shields us from any wiki-side URL drift / page renames
    - cold latency stays at ~600 ms only the first time per item

  Negative-cache: when the wiki has no image (mod items, typos
  in the BP), a zero-byte `.404` marker is written that suppresses
  re-fetches for 24h.

- **Frontend item-name helpers** in `src/utils/arkItem.ts`:
    * `arkItemDisplayName(blueprint)` -- maps
      `Blueprint'/Game/.../PrimalItemConsumable_Berry_Mejoberry'`
      to `Mejoberry`.  Handles the `Blueprint'...'` wrapper, the
      `_C` Blueprint Class suffix, every `PrimalItem*_` prefix,
      categorical sub-prefixes (Berry / Egg / Kibble / Soup /
      Veggie), and CamelCase splitting.  Validated against the
      4 real blueprints in the operator's plugin output.
    * `arkItemThumbUrl(blueprint)` -- returns the relative URL
      `/api/v1/market/thumb/<encoded name>` for use as `<img src=>`.

- **Item card redesign** (Browse tab).  Each marketplace listing
  is now a dedicated card with:
    * 1:1 image header on a dark gradient backdrop
    * `×N` quantity badge (top-right)
    * `BP` badge (top-left) when `is_blueprint`
    * Pretty display name + Q / durability / rating chips
    * Seller line with relative timestamp
    * Price footer (red when wallet can't afford) + Buy button
    * Hover lift (translateY -2px + shadow)
    * `loading="lazy"` on every image
    * Graceful fallback to a Lucide Package icon when the wiki
      has no image for that item

- **My-items + History tables** also pick up the new display name
  and a small (32px) item thumbnail in the Item column.

### Operational notes

- Cache lives at `backend/data/market_thumbs/` (already gitignored
  via `backend/data/`).  Override the base directory via the
  `ARKM_DATA_DIR` env var when running in containers / on
  ephemeral filesystems where you want the cache on a persistent
  volume.
- ~5-30 KB per image; 100 distinct items = 0.5-3 MB on disk.  Safe
  to nuke the directory at any point -- next request rebuilds the
  cache from the wiki.
- The cache is per-image-name, not per-blueprint, so two BPs that
  resolve to the same display name (rare; happens with mod items
  copying vanilla names) share one disk file.

---
## [3.5.0] - 2026-04-25

**Phase 8 — Player Marketplace** lands as the panel half of a
two-component feature.  The C++ ARK plugin owns the in-game flow
(`/market upload`, `/market claim`); the panel owns commerce (set
price, browse, buy, wallet, audit).  Strict ownership matrix +
contract documented in `docs/MARKETPLACE_API_CONTRACT.md`.

### Added

- **Marketplace dashboard** at `/market` (admin sidebar entry
  'Mercato'), three tabs:

    * **Sfoglia** -- grid of listed items with search by blueprint,
      sort by newest / price asc / price desc, per-card Buy button.
      Saldo wallet shown at the top; Buy button disabled when
      balance < price.
    * **I miei item** -- per-status counters (Bozza / In vendita /
      Venduti in claim / Conclusi) + a table of every item I own
      OR have queued for claim.  Inline 'Pubblica' (set price +
      list) on drafts; 'Annulla' (cancel listing -- item returns
      to me via /market claim in-game) on listed items.
    * **Storico** -- last 100 transactions where I'm buyer or
      seller, role-coloured ±price chips.

- **Atomic purchase**: `POST /api/v1/market/buy/{id}` runs a SQL
  transaction with `FOR UPDATE` row locks on the item AND on both
  wallet rows so concurrent buyers can't race.  Wallets
  auto-create at balance=0 on first read.

- **Cancel-by-owner via reuse of claim flow**: cancelling a
  listing flips it to `status='sold'` with `buyer_eos_id =
  owner_eos_id`, so the plugin's `/market claim` returns the item
  to its original owner via the same code path that delivers
  purchased items.  No special plugin path needed.

- **Admin endpoints**: `POST /api/v1/market/admin/wallet/credit`
  (top up / debit any wallet, audited) +
  `GET /api/v1/market/admin/audit` (paginated audit log filterable
  by actor / action / item).

### Backend

- New `app/api/routes/market.py` (10 endpoints, mixed-auth: most
  resolve the player from the `disc_session` cookie; admin endpoints
  guarded by `Depends(require_admin)`).
- New `create_marketplace_tables()` boot-time idempotent migration
  in `app/db/session.py` -- creates the four `ARKM_market_*`
  tables in the **plugin** DB (panel-owned at boot, shared at
  runtime per the contract).

### Frontend

- New `marketApi` namespace in `services/api.ts` (10 methods +
  typed responses).
- New `pages/MarketPage.tsx` with the standard standalone /
  embedded dual-mode pattern (matches PlayerDashboardPage).

### Plugin contract

`docs/MARKETPLACE_API_CONTRACT.md` is the canonical source of
truth for the schema and ownership matrix.  Mirrored in the C++
plugin repo (`C:/Claude/ArkMania-Plugin/docs/`) so the plugin chat
session can implement `/market upload` and `/market claim` against
it.  No other plugin work is required for v3.5.0 to be useful on
the panel side -- admins can already credit wallets, players can
already browse and buy listed items even before the plugin lands.

### Operational notes

- The marketplace tables are created automatically on first boot of
  v3.5.0 (no manual migration).  All tables prefixed `ARKM_market_*`
  to match the plugin DB convention.
- Tokens have no in-game source until the plugin's faucet (or
  admin credit) is in place.  Use `POST /admin/wallet/credit` to
  bootstrap a wallet.
- The web dashboard works for both admin (via panel JWT) and
  Discord-only player sessions (via `disc_session` cookie).

---
## [3.4.2] - 2026-04-25

Two new operator actions on the Players page, both born from the
post-v3.4.1 sync-names diagnostic.

### Added

- **Import missing players.** `/sync-names` now returns up to 124
  'orphan' profiles per scan (EOS files on disk but no row in the
  `Players` table -- typically players who joined before the
  Permissions plugin was registered).  A persistent banner appears
  whenever orphans are detected; click 'Importa N giocatori
  mancanti' to open a modal with a checkbox per orphan (default
  all selected) and a single Submit that calls the new
  `POST /api/v1/players/import-from-profiles` endpoint.  Inserts
  rows with `PermissionGroups='Default,'`; existing EOS are
  skipped automatically (no double inserts).

- **Cluster-wide character wipe.**  Per-player action exposed as
  a Skull button next to the existing Ban button on the player
  detail panel.  Click opens a two-step modal:

    1. `GET /api/v1/players/{eos_id}/character-files` lists every
       `<eos>.arkprofile` found across every container's
       SavedArks directory (with full paths so the operator can
       audit before confirming).
    2. Confirm calls `DELETE /api/v1/players/{eos_id}/character-files`
       which `rm -f`s each match across the cluster.

  After the wipe the player respawns as a brand-new character on
  next login.  The `Players` row (permissions) is intentionally
  NOT touched -- that's a separate delete.

### API

- `POST /api/v1/players/import-from-profiles` (admin)
  - Body: `{ players: [{ eos_id, player_name? }], default_groups }`
  - Returns: `{ requested, inserted, skipped_existing, errors }`
- `GET /api/v1/players/{eos_id}/character-files` (admin)
  - Returns: `{ eos_id, total_files, files: [{path, container, machine_id}], errors }`
- `DELETE /api/v1/players/{eos_id}/character-files` (admin)
  - Returns: `{ eos_id, total_deleted, deleted: [...], errors }`

### Operational notes

- The wipe is destructive on disk; the modal preview step is the
  intentional safety net.  Keep it open and verify the file list
  matches what you expect before confirming.
- EOS-id input is validated against a strict charset to defang
  shell-injection through the find filter.
- Re-running `/import-from-profiles` is safe -- existing EOS rows
  are skipped silently.

---
## [3.4.1] - 2026-04-25

Patch + small feature: fixes the sync-names function that was
silently dropping legitimate player names, surfaces what was
previously dropped in the response, and adds a multi-character
picker modal so an admin chooses the right name when the same EOS
has different .arkprofile names across the cluster.

### Fixed

- **'Sync nomi' was skipping some players silently.**  Two root
  causes:

    * The technical-string blacklist used by the .arkprofile parser
      substring-matched a wide list of common English words
      (`name`, `map`, `level`, `str`, `bool`, `int`, `float`,
      `primal`, ...) and rejected legitimate player names that
      happened to contain those letters as 'engine identifiers'.
      Names like **Mapmaker**, **Levellord**, **Aristocrat** were
      dropped.  Replaced with two narrower checks:

        * `_TECHNICAL_FRAGMENTS` -- only strong-evidence patterns
          (`/script/`, `blueprintgenerated`, `default__`, `::`,
          `primalcharacter`, `character_bp_`, ...) that cannot
          appear in a real display name.
        * `_TECHNICAL_EXACT` -- exact-match (case-insensitive)
          reserved-word frozenset (`BoolProperty`, `NameProperty`,
          `None`, `Default`, vector type names, map filenames).

    * `str.isprintable()` was rejecting Unicode whitespace
      categories used in stylised nicknames (NBSP ` `,
      ideographic `　`, tabs).  Replaced with
      `_is_human_readable()` that accepts those + requires at
      least one alphanumeric character.

- **`/sync-names` no longer silently drops profiles with no name.**
  The previous version skipped them at `if not player_name:
  continue` without surfacing them anywhere.  The response now
  includes `no_name_extracted[] / no_name_extracted_total` so the
  admin can see exactly which `.arkprofile` files the parser
  failed on and report them.

### Added

- **Multi-character picker modal on Players page.**  When the
  cluster scan finds multiple `.arkprofile` files for the same EOS
  with **different** player names (common case: a player has one
  character per map, or a rename hasn't propagated yet), the
  endpoint no longer guesses last-wins.  Instead it returns the
  ambiguous list and the page opens a modal:

    * One block per ambiguous EOS with the current DB name and a
      radio-button list of every distinct candidate name (each
      showing the source `.arkprofile` path so the admin can tell
      servers apart).
    * A 'Non aggiornare ora' option per row to skip a single
      player's resolution.
    * Apply button submits the chosen names in one batch via
      the new `POST /api/v1/players/sync-names/resolve` endpoint
      and reloads the table.
    * Cancel discards all picks without touching the DB.

  Cluster-wide replicas of the **same** character (most common
  case) still auto-apply silently as before.

### API

- `POST /api/v1/players/sync-names` response gains:
    * `ambiguous`              -- list of multi-character EOS rows
                                   waiting for admin choice
    * `no_name_extracted`      -- profiles whose name the parser
                                   couldn't read
    * `no_name_extracted_total`
- `POST /api/v1/players/sync-names/resolve` (NEW, admin only):
    * Body  : `{ resolutions: [{ player_id, chosen_name }] }`
    * Empty `chosen_name` = skip that row.
    * Returns `{ success, requested, applied, skipped, not_found }`.

### Operational notes

- The ambiguous modal opens automatically after a sync.  The
  default selection for each row is the first candidate so an
  Apply-without-touching is a sensible 'pick whichever' shortcut.
- Cluster-wide replicas of the same character (common scenario)
  remain auto-applied -- the modal only appears for genuine
  multi-character ambiguity, not for routine cluster duplicates.
- The parser change is permissive: if you spot a clearly-technical
  string getting through and ending up as a player name, please
  add it to `_TECHNICAL_EXACT` (preferred) rather than to
  `_TECHNICAL_FRAGMENTS`.  Substring fragments are kept surgical
  on purpose.

---
## [3.4.0] - 2026-04-24

Big release: configurable Discord role -> ARK group sync engine,
mobile-friendly player dashboard, plus the bug fix for relative
timestamps that was making every VIP/timed-perm chip read 'scade
ora' regardless of the actual expiry.

### Added

- **Generic Discord-role -> ARK-group mapping engine** (Phase 7+).
  Replaces the unused OAuth admin/operator/viewer whitelists with a
  proper CRUD-driven mapping table.  N rules of
  `(discord_role_id -> ark_group_name)` configurable from the
  panel, with a 'Sync ruoli ora' button that walks every active
  rule and pushes the diff into `Players.PermissionGroups`.

  Where: **Settings -> Discord -> Modifica -> Sincronizzazione
  ruoli**.  Each row exposes the colored Discord role + an inline
  ARK group name input + Active toggle + Delete.  A draft row at
  the bottom adds new rules.  The sync report shows per-player
  groups added (green) and removed (amber).

  Backend additions:
    * `GET /api/v1/discord/role-mappings` (list)
    * `POST /api/v1/discord/role-mappings` (create)
    * `PUT  /api/v1/discord/role-mappings/{id}` (patch)
    * `DELETE /api/v1/discord/role-mappings/{id}` (delete)
    * `POST /api/v1/discord/sync-roles` (apply all active rules)
    * `app/discord/sync_roles.py` (the engine)
    * `arkmaniagest_discord_role_map.ark_group_name` column added
      via boot-time idempotent migration

  The VIP sync stays untouched (separate `DISCORD_VIP_ROLE_ID` env,
  separate endpoint, separate button) per operator request.  The
  two engines compose cleanly: the generic engine NEVER touches
  groups not produced by an active rule, so the VIP-managed group
  + admin/custom groups pass through.

### Removed

- **Auto-promotion whitelists section** on the Modifica tab
  (admin / operator / viewer Discord-ID CSVs).  These were the
  bootstrap-admin-via-Discord knobs from Phase 2 and were never
  used in practice.  The .env keys themselves
  (`DISCORD_*_USER_IDS`) stay in place server-side -- `auth_discord`
  still respects them on first OAuth login -- but the UI no longer
  shows or edits them.

### Fixed

- **Player dashboard: every VIP / timed-permission chip read
  'scade ora'.** `fmtRelative()` always treated negative diffs (future
  timestamps) as 'less than 1 minute ago'.  Now bidirectional: past
  values render as `'... fa'` (2h fa, 3g fa, ...), future values as
  `'tra ...'` (tra 2h, tra 12g, ...).

- **Player dashboard: mobile rendering**.  Several viewport
  improvements based on operator feedback:
    * Page padding scales with `clamp(0.75rem, 3vw, 1.5rem)` so it
      breathes on phones without wasting space on desktop.
    * Header greeting block clamps font + ellipsises long names so
      they don't push the avatar off-screen.  Action buttons drop
      to a second line on very narrow viewports.
    * CharacterHero permanent-permission chips no longer have a
      `maxWidth: 40%` constraint -- they wrap to a new row when
      tight (was squeezing to nothing on mobile).
    * Grid `minmax(280px, 1fr)` (was 320px) -- tablet portrait now
      fits 2 columns; mobile still falls to 1.
    * Scrollable lists (tribe roster / rare dinos / activity) use
      `clamp(...)` for `maxHeight` so they don't explode on short
      phones.

### Backend

Total Discord-related routes: 22 -> 27.  Two boot-time idempotent
migrations on `arkmaniagest_discord_role_map`: ADD COLUMN
`ark_group_name VARCHAR(64) NULL` + index, MODIFY `app_role_name`
to NULL-able for back-compat.

### Operational notes

- Run sync from `Settings -> Discord -> Modifica` after configuring
  rules.  The button is disabled when no active rules exist.
- Existing v3.3.x deploys: nothing manual to do.  The migration
  applies on first boot of v3.4.0; the ARK-group column is created
  empty so the new sync engine is a no-op until you add rules.
- The unused OAuth whitelist `.env` keys (`DISCORD_ADMIN_USER_IDS`
  etc.) can be left as-is; they're only consulted by the very first
  Discord login when a brand-new identity has no AppUser link yet,
  and that codepath is unchanged.

---
## [3.3.2] - 2026-04-24

Patch release: two operator-reported papercuts on the Discord pages.

### Fixed

- **Settings -> Discord -> Modifica: 'Save' looked like a no-op.**
  The form was re-fetching `/discord/config` right after a successful
  save, which returned the OLD in-memory values (Pydantic loads
  `.env` only at boot).  The form visually snapped back to its
  pre-save state, hiding the green 'restart required' banner amid
  the visual noise -- making the operator think the save had
  silently failed when in fact `.env` WAS correctly updated.

  Fixed by NOT re-fetching after save: the local 'initial' baseline
  is updated to match what was just submitted, so the form stays
  consistent with the user's input + the green banner is the only
  visible 'pending' cue (which it should be -- the truth is that
  the running backend is still on the old values until restarted).

  Also tightened the disabled Save button: tooltip and label flip
  to 'No changes' so a grey button no longer looks broken.

- **Discord avatars + guild icon were blank squares everywhere.**
  Browser was rejecting every `<img src='https://cdn.discordapp.com/...'>`
  with a Content-Security-Policy violation -- the deployed nginx
  template still had the pre-Phase-3 `img-src 'self' data:` lockdown
  and never got loosened when we added Discord-CDN-fed surfaces in
  v3.0.0+.

  Fixed by whitelisting `https://cdn.discordapp.com` in `img-src`.
  All other directives (script-src / connect-src / frame-ancestors)
  stay locked.  Discord CDN images are public + no-PII so the trust
  boundary doesn't widen meaningfully.

### Operational note

Existing deployments whose `/etc/nginx/sites-available/arkmaniagest`
was already rendered from the previous template need a ONE-SHOT
manual fix on the host (the panel doesn't rewrite nginx config on
every release; only fresh installs pick up the template change).
The release notes carry the exact `sed` one-liner; future fresh
installs are unaffected.

---
## [3.3.1] - 2026-04-24

Patch release: hotfix for the Phase-7 tribe-roster query that landed
broken with v3.3.0.

### Fixed

- **Player dashboard 500ed** when the linked player had a tribe.

  ```
  pymysql.err.OperationalError: (1054, "Unknown column 'pt.player_name'
  in 'SELECT'")
  ```

  Root cause: the Phase-7 tribe-roster query joined
  `ARKM_player_tribes` with `Players` and tried to use
  `COALESCE(NULLIF(p.Giocatore, ''), pt.player_name)` as the member's
  display name -- but `ARKM_player_tribes` does NOT have a
  `player_name` column.  The schema is just `eos_id /
  targeting_team / tribe_name / last_login`.

  Fixed by dropping `pt.player_name` from the SELECT and the
  COALESCE.  Names now come exclusively from `Players.Giocatore` via
  the LEFT JOIN; the frontend already handles a null name with the
  `name || eos_id.slice(0, 8) + '…'` fallback, so the UI is
  unchanged.

  GROUP BY also gets `p.Giocatore` appended -- MariaDB would
  otherwise reject the non-aggregated column once the COALESCE was
  simplified.

### No other changes

Apply via the in-panel self-update -- only one backend file changed,
no frontend rebuild needed.

---
## [3.3.0] - 2026-04-24

Big visual + data refresh of the player dashboard, plus the related
backend enrichments.  The dashboard now exposes most of what the
plugin DB tracks per-player without forcing the player into the
admin panel.

### Added

- **Hero player card** at the top of the dashboard with the player's
  big avatar, an **animated VIP badge** (gold gradient + glow when
  the player is in the VIP permission group), inline online/offline
  pill, and a sub-line that shows tribe + relative time
  ('connesso da 2h 14m' / 'ultimo accesso 3g fa').
- **Cluster pulse banner** at the very top: 'Online su <server>
  (1h 42m) · 8 giocatori su 3/3 server online'.  Lets the player
  know the live state of the cluster at a glance.
- **Leaderboard card** per `server_type` (PvE / PvP):
    * Headline `#12 su 247 (PvE)` with the player's rank
    * Coloured percentile bar (green/amber/red by tier)
    * Two-column 7-stat breakdown: kill wild, tame, kill PvP,
      craft, kill enemy dino, structs destroyed, deaths
- **Tribe roster card** listing every other linked tribe member
  with an online indicator (green dot for live sessions) and
  relative last-seen for offline members.  The current player's
  row is highlighted with a `(tu)` tag.
- **Rare dinos card**: 30-day kill / tame counters as big-stat
  tiles, plus a scrollable list of the 10 most recent rare-dino
  events the player was killer or tamer of.
- **Activity feed card**: merged `ARKM_event_log` + `ARKM_lb_events`
  timeline (15 most recent items combined), with the leaderboard-
  event rows showing their point delta in green.

### Backend

- New `app/api/routes/me.py` enrichments to `GET /api/v1/me/dashboard`:
    * `presence`     -- real-time online status (joins ARKM_sessions
                        with ARKM_servers)
    * `server_pulse` -- cluster-wide online counters
    * `leaderboard`  -- per-server_type scores + computed rank
                        (counts strictly-higher total_points peers)
    * `tribe.members`-- self-join on `ARKM_player_tribes` with
                        latest-entry-per-eos collapse + online flag
                        from `ARKM_sessions`
    * `rare_dinos`   -- last-30-day kills/tames per player from
                        `ARKM_rare_spawns`
    * `activity`     -- UNION of `ARKM_event_log` + `ARKM_lb_events`
                        merge-sorted by time, capped at 15

  Single combined endpoint preserved so the page first-paints in one
  round-trip.  No new routes; all data added to the existing JSON
  response.

### Frontend

- `services/api.ts`: typed `DashboardPresence`, `DashboardServerPulse`,
  `DashboardLeaderboard*`, `DashboardTribe*`, `DashboardRareDinos*`,
  `DashboardActivity*`; `DashboardResponse` extended with the six
  new sections.
- `PlayerDashboardPage.tsx` redesigned around an asymmetric grid
  (`auto-fit minmax(320px, 1fr)` columns when standalone, single
  column when embedded inside the admin sidebar).  Hero character
  card spans full width.
- New helpers: `fmtRelative()` ('ora' / 'Xm fa' / 'Xh fa' / 'Xg fa')
  and `fmtMinutes()` ('Xh YYm') for friendlier presentation.
- The standalone view ships a Discord-blurple gradient header instead
  of the previous flat one; embedded mode keeps the panel's pl-page
  wrapper so it slots into the admin layout without visual collision.

### Roadmap

This release ships the **read-only** enrichments (Phase 7 Asse 1).
The interactive layer (Phase 7 Asse 2 -- Discord DM to tribe member,
opt-in scadenza notifications, derived achievements, auto Discord
nickname sync, web-driven decay refresh) lands in v3.4.0.
Collaborative tools (tribe diary, ticket system, marketplace) are
queued for v3.5.0.

---
## [3.2.1] - 2026-04-24

Patch release: hotfix for the Players page crash that landed with
v3.2.0.

### Fixed

- **PlayersPage crashed at runtime** with
  `TypeError: _s is not a constructor` as soon as the operator
  opened it, blocking access to the page entirely.

  Root cause: `frontend/src/pages/PlayersPage.tsx` imports the
  `Map` icon from `lucide-react` AND uses `new Map()` to build
  the Discord-link index added back in v3.0.0.  Both `Map`
  identifiers compete for the same name; the bundler resolves
  `new Map()` to the React component (a function, not a
  constructor) -- crash on the first render.

  Fixed by aliasing the import to `Map as MapIcon` and updating
  the three JSX usages.  Added an inline comment on the import
  line so a future contributor doesn't innocently revert it
  back to a bare `Map` import.

  Diagnosed by extracting the bytes around the minified crash
  position (line 90 col 84342) of the deployed bundle, which
  decoded to `c.useState(new _s)` -- the smoking gun pointing
  straight at `useState(new Map())`.

### No other changes

This release contains no new features.  Apply via the in-panel
self-update -- the only changed file is the rebuilt frontend
bundle, no migrations or restart caveats.

---
## [3.2.0] - 2026-04-24

Two big additions: a **player-facing dashboard** (Phase 6) so a
Discord-linked player can self-serve their character / shop /
decay status without admin help, and a **manual VIP-role sync**
(Phase 4) that mirrors the ARK plugin DB's VIP permission group
onto a Discord role on demand.

The Settings -> Discord page also gains a fourth tab where an
admin can rotate every Discord credential / ID directly from the
panel (no more SSH + nano).

### Added

- **Player dashboard** at `/me` (admin layout) and as a full-canvas
  view for Discord-only players.  Three cards rendered from the
  new `GET /api/v1/me/dashboard` endpoint:

    * Character: name, tribe, last login, EOS_Id, permanent
                 permission groups + active timed entries (with
                 their expiry timestamps).
    * Shop:      points + total spent (big-stat tiles), plus a
                 collapsible raw view of the plugin's `Kits`
                 column.
    * Decay:     status banner (safe / expiring / expired) with
                 a friendly countdown ('scade tra Xg Yh' /
                 'scaduto da Xh'), tribe info, last-refresh
                 metadata, and a red banner when the tribe is
                 scheduled for purge.

  Authenticated via the existing `disc_session` cookie; unlinked
  Discord callers see a 403 with a hint pointing at the admin
  link flow.

- **Auth state machine** rerouted to the dashboard.  When the
  SPA boots without a panel JWT but with a valid Discord session,
  `App.tsx` resolves to a new `"player"` state and renders the
  dashboard with no admin sidebar.  The previous Phase-2 path
  (admin-linked Discord -> panel JWT -> admin shell) is unchanged.

- **'My dashboard' sidebar entry** for admins -- click it from
  the admin shell to preview your own player view inside the
  existing layout (the same component, mounted with
  `embedded={true}`).

- **Manual VIP-role sync** (Phase 4):

    * `POST /api/v1/discord/sync-vip` (admin only) walks every
      linked discord_account, computes 'should be VIP' from the
      Players row (permanent OR active timed entry for the
      'VIP' permission group -- 'permanenti e temporanei
      gestiti in ugual modo'), and applies the diff to the
      Discord role specified by `DISCORD_VIP_ROLE_ID`.
    * Direction is fixed: ARK plugin DB is authoritative ('VIP
      vince il dato su db gestionale').  Discord-side members
      who hold the role but have no EOS link in our DB are
      reported only -- never stripped.
    * Per-row report: assigned / removed / noop / error counts,
      duration, plus a paginated action table for the operator
      to audit.  A 'user left the guild' 404 becomes a 'noop'
      with detail; other Discord errors per row count as
      'error' but never abort the run.

- **Settings -> Discord -> VIP sync section** with a 'Sync VIP
  now' button + last-result panel (5-metric dashboard + collapsible
  per-row table + 'stranger VIPs' list).

- **Settings -> Discord -> Modifica tab** -- edit every
  `DISCORD_*` key directly from the panel.  Powered by the new
  `PUT /api/v1/discord/config` endpoint and an atomic env-file
  writer (`app/core/env_writer.py`) that:

    * Replaces existing keys in place, preserving comments + key
      order.
    * Appends unknown keys at the end.
    * Atomic write via `<env>.tmp + os.replace`.
    * Preserves the file's 600 mode after the rename.

  The form treats secrets specially: their current values are
  never returned by the GET; the field shows '(currently set,
  leave empty to keep)' and an explicit 'Clear' button is needed
  to wipe them.  Pydantic loads `.env` once at boot, so a save
  surfaces a 'restart required' banner with the exact systemctl
  command + a copy button.

### Backend

- New `app/api/routes/me.py` (`/me/dashboard`); auth via
  `get_current_player()` dependency that decodes the
  `disc_session` cookie + resolves the linked EOS, returning
  401 / 403 / 404 with operator-friendly messages.
- New `app/discord/sync_vip.py` containing
  `sync_vip_role()` (panel -> Discord reconciliation engine) and
  the `VipSyncReport` envelope returned to the route layer.
- New `app/core/env_writer.py` providing
  `update_env_file({KEY: value})` for the panel-driven `.env`
  edit flow, with `keys_in_env(keys)` as a presence-check helper
  for diagnostic UIs.
- New `DISCORD_VIP_ROLE_ID` settings key (defaults to empty;
  `.env.production` template gains a documented placeholder).
- `/discord/config` response extended with `vip_role_id` +
  `vip_sync_ready` so the Config tab can light up / disable the
  sync controls accordingly.

### Frontend

- New `services/api.ts` namespace `meApi` (`dashboard()`) and
  `discordAuthApi` (`me()`, `logout()`); typed responses
  `DashboardResponse / DashboardCharacter / DashboardShop /
  DashboardDecay / DashboardDiscord / DiscordMeResponse`.
- `discordApi` extended with `syncVip()` (5-min timeout, large
  guilds may need it) and `updateConfig(body)`; type additions
  `VipSyncReport`, `VipSyncAction`, `DiscordConfigUpdate`,
  `DiscordConfigUpdateResponse`.
- New `pages/PlayerDashboardPage.tsx` (full-canvas + embedded
  modes; 3 stacked cards).
- New `pages/discord/SettingsTab.tsx` (edit form for every
  `DISCORD_*` key) and a 'VIP sync' section in the existing
  `ConfigTab`.
- Sidebar gets a 'La mia dashboard' entry under the main
  Dashboard.
- The 401 axios interceptor now exempts `/auth/discord/me` and
  `/me/dashboard` so a missing/expired Discord session does NOT
  clear the panel JWT or bounce the admin to /login.

### Operational notes

- **VIP sync prerequisites**: bot must be in the guild with the
  Manage Roles permission AND the bot's role must sit ABOVE the
  VIP role in the guild's role hierarchy.  Discord otherwise
  responds 50013 'Missing Permissions' which the panel surfaces
  verbatim.
- **`.env` editing prerequisites**: the backend process must have
  write access to `/opt/arkmaniagest/backend/.env`.  Default
  install (file owned by `arkmania:arkmania`, mode 600) satisfies
  this.  Changes do NOT take effect until the service is
  restarted -- the response carries the exact command.
- **Player dashboard via Discord-only**: when a Discord-only player
  reaches the panel, the SPA detects the session cookie and lands
  them on the dashboard instead of the admin login screen.  Their
  Discord identity must already be linked to an EOS by an admin
  via Settings -> Discord -> Accounts -> 'Link player'; otherwise
  the dashboard renders a 403 with a hint asking them to ping an
  admin.

---
## [3.1.0] - 2026-04-24

Phase 3 of the Discord integration: a full **admin Discord
console** wired into Settings, plus inline player-side actions
on the Players page.

The operator can now bind ARK players to Discord identities,
moderate the guild from inside the panel (assign/remove roles,
kick, ban, DM), and inspect at a glance which players have a
Discord link straight from the Players table.

Per the operator's design intent the player <-> Discord binding
is **admin-only** -- there is no self-link flow.  This keeps the
audit trail clean and makes the link the trustworthy substrate
the future role-sync engine (Phase 4-5) will build on.

### Added

- **Settings -> Discord page** (admin-only) with three tabs:

  - **Accounts** -- one row per known Discord identity, with
    inline link/unlink for both:
      * panel AppUser   (filterable dropdown of /users)
      * ARK player      (debounced autocomplete by name / EOS /
                         tribe via the new
                         `GET /api/v1/discord/players/search`)
    Both sides surface the verbatim 409 from the UNIQUE indexes
    so the operator sees 'EOS X is already linked to Discord
    ID Y' instead of a generic error.

  - **Members** -- live guild member list driven by the bot.
    Per row: avatar, global_name, role chips (clickable to
    remove), DM, Kick, Ban.  The '+' next to the chips opens a
    popover with the assignable roles (skips @everyone and
    managed-by-integration roles).  Pagination via 'Load more'
    (Discord caps a single page at 1000; we walk pages of 100).
    DM is a 2 000-char-capped textarea with live counter.  Ban
    has audit-log reason + delete-recent-messages picker.

  - **Configuration** -- read-only diagnostic.  OAuth readiness
    + which `.env` keys are still missing.  Bot readiness +
    live guild probe (calls `/discord/guild/info` on mount and
    shows the guild icon + name + member counts in a green
    success block).  Auto-promotion whitelists rendered as
    chips per role (admin / operator / viewer).

- **Players page Discord chip**.  When the row's eos_id has a
  Discord link, a tiny blurple chip is appended next to the
  player name showing the Discord global_name.  Click opens a
  small modal with a textarea for sending an immediate DM and
  a link to the Settings -> Discord page for follow-up actions.
  Non-admin operators silently see no chips (the chip's data
  source `/discord/accounts` is admin-gated).

- **Backend Discord client helpers** (`app/discord/client.py`):
    `get_guild()`, `list_guild_members()` (paginated),
    `remove_guild_member()` (kick), `create_guild_ban()` /
    `remove_guild_ban()`, `create_dm_channel()`, `send_message()`.
  All routed through the existing `_request()` so the 429 /
  Retry-After single-retry honour applies.  Audit-log reasons
  on bans go through the `X-Audit-Log-Reason` header.

- **Backend Discord routes** (all gated by
  `Depends(require_admin)`):

    `GET    /api/v1/discord/players/search?q=&limit=`
    `POST   /api/v1/discord/link-eos/{discord_user_id}`
    `DELETE /api/v1/discord/link-eos/{discord_user_id}`
    `GET    /api/v1/discord/guild/info`
    `GET    /api/v1/discord/guild/roles`
    `GET    /api/v1/discord/guild/members?limit=&after=`
    `PUT    /api/v1/discord/guild/members/{user_id}/roles/{role_id}`
    `DELETE /api/v1/discord/guild/members/{user_id}/roles/{role_id}`
    `DELETE /api/v1/discord/guild/members/{user_id}`         (kick)
    `PUT    /api/v1/discord/guild/bans/{user_id}`            (ban)
    `DELETE /api/v1/discord/guild/bans/{user_id}`            (unban)
    `POST   /api/v1/discord/dm/{user_id}`                    (DM)

  Total Discord surface: 16 routes (was 7 in v3.0.0).

- **`discordApi` namespace** in `frontend/src/services/api.ts`
  with typed responses (`DiscordAccount`, `DiscordPlayerSearchHit`,
  `DiscordGuildInfo`, `DiscordGuildRole`, `DiscordGuildMember`,
  `DiscordConfigStatus`).

- **Shared `DiscordIcon` component** under
  `frontend/src/components/DiscordIcon.tsx`.  Replaces the
  duplicate inline SVG that lived inside `LoginPage.tsx`; both
  the login button, the sidebar Settings -> Discord entry, the
  admin tabs and the Players page chip now import the single
  source.

### Changed

- **`/api/v1/discord/config`** response extended with
  `admin_user_ids`, `operator_user_ids`, `viewer_user_ids`
  (parsed from the existing `DISCORD_*_USER_IDS` env CSVs).
  Drives the Configuration tab's whitelist view.  Backwards-
  compatible: every previous field is unchanged.

- **Sidebar `NavItem.icon` type** widened from `LucideIcon` to
  a structural `ComponentType<{size?, className?}>` so both
  Lucide icons and the inline `DiscordIcon` slot in without
  per-call casts.

- **Discord-call error mapping**: a new `_wrap_discord_call()`
  helper in `routes/discord.py` translates `DiscordAPIError`
  into an HTTPException carrying Discord's own message.
  401 / 403 / 404 / 409 / 429 pass through as-is (semantically
  meaningful for the UI); everything else flattens to 502 so
  the panel doesn't falsely advertise a 500 on its own side.

### Operational notes

- **GUILD_MEMBERS privileged intent** must be enabled on the
  Discord Developer Portal -> Bot tab for the Members tab to
  populate.  Without it Discord returns 403 'Missing Access'
  on `/guild/members`; the panel surfaces the message verbatim
  with a hint pointing at the Dev Portal.

- **Bot role hierarchy**: for kick / ban / role-assign to
  succeed, the bot's role must sit ABOVE the target's highest
  role on Server Settings -> Roles.  Discord otherwise returns
  50013 'Missing Permissions' which the panel forwards verbatim
  so the operator sees the actual fix.

- **Recommended bot permissions integer** for the OAuth invite
  URL (minimum for full Phase 3 functionality):
  `268504070` (View Channels + Send Messages + Read Message
  History + Kick + Ban + Manage Roles).  Or `8` (Administrator)
  for testing.

- **Build housekeeping**: `release.ps1` no longer dies on the
  `git push` stderr lines under PowerShell 5.1 strict mode, and
  the CHANGELOG separator detection is CRLF-tolerant.  Both
  fixes shipped during the v3.0.0 cycle and are now baked in.

---
## [3.0.0] - 2026-04-24

First major release introducing **Discord integration** as a
new capability of the panel.  Operators can now sign in to the
admin UI with their Discord account, and the foundations are in
place for player-link, role-mapping and dashboard features
landing across the next minor releases.

This release also bundles the self-update hardening completed
during the 2.3.9 -> 3.0.0 cycle (no more empty 500s on install
failure).

### Added

- **Discord OAuth2 sign-in** on the LoginPage: a new "Sign in
  with Discord" button (Discord blurple, inline icon) kicks off
  the Authorization Code flow against
  `/api/v1/auth/discord/start`.  The callback at
  `/api/v1/auth/discord/callback` finishes the exchange,
  upserts the Discord identity into
  `arkmaniagest_discord_accounts`, and redirects back to the
  panel with the freshly-minted JWT delivered via URL fragment
  (`#token=...`) so it never lands in nginx access logs.  The
  React shell intercepts the fragment in `App.tsx`, scrubs it
  immediately, and resolves the token via `authApi.me()`.
- **Discord -> AppUser bridge** (admin-only):
  `POST /api/v1/discord/link-app-user/{discord_user_id}` binds
  a Discord identity to an existing panel `AppUser` (by id OR
  username).  After linking, "Sign in with Discord" alone logs
  the operator in as that AppUser with the AppUser's role --
  no whitelist required.  `DELETE` unlinks.  A `UNIQUE` index
  on `app_user_id` enforces a strict 1:1 mapping (linking the
  same AppUser to two different Discord IDs returns 409).
- **Whitelist-based auto-promotion** as a fallback path:
  `DISCORD_ADMIN_USER_IDS`, `DISCORD_OPERATOR_USER_IDS` and
  `DISCORD_VIEWER_USER_IDS` (CSV of Discord snowflakes) auto-
  upsert a `discord:<id>` AppUser at the matching role on
  first login -- handy for spinning up a small fleet of
  trusted operators without pre-creating AppUsers.
- **Discord diagnostic endpoint**
  (`GET /api/v1/discord/config`, admin-only): reports which
  `.env` keys are still missing for OAuth and bot
  capabilities, never exposing the secret values themselves.
  Drives the upcoming Settings -> Discord page banner.
- **Discord accounts admin endpoint**
  (`GET /api/v1/discord/accounts`): lists every known Discord
  identity together with its current AppUser link and (where
  set) ARK player link, ready to power the Phase-3 admin UI.
- **Encrypted token storage**: Discord access + refresh tokens
  travel through `app/discord/store.py` and are stored
  AES-256-GCM-encrypted in `arkmaniagest_discord_accounts`,
  reusing the existing `core/encryption.py` envelope.  Routes
  never see plaintext unless they explicitly ask via
  `include_tokens=True`.
- **Discord HTTP wrapper** (`app/discord/client.py`): thin
  httpx layer that handles both OAuth (Bearer) and bot
  (`Bot <token>`) auth modes, honours one `429 Retry-After`
  bounce, and exposes `exchange_code`, `refresh_token`,
  `get_current_user`, `list_guild_roles`,
  `add_guild_member_role`, `remove_guild_member_role` as
  building blocks for the upcoming role-sync engine.
- **DiscordRoleMap ORM table**
  (`arkmaniagest_discord_role_map`): persists `app_role_name`
  -> `discord_guild_id + discord_role_id` mappings with
  `direction` (`discord->panel`, `panel->discord`,
  `bidirectional`) and `priority` columns.  Schema only -- the
  CRUD UI ships in a follow-up minor.

### Changed

- **Self-update install endpoint** is now wrapped in a
  defensive try/except around both `preflight()` and
  `run_self_update_async()`: any exception (subprocess
  failure, missing sudoers entry, etc.) is now persisted to
  `/tmp/arkmaniagest-update-status.json` AND surfaced to the
  caller as a JSON `{detail, path}` payload, so the
  Settings -> Update card no longer renders an empty "HTTP 500"
  banner.  Pairs with a global FastAPI exception handler in
  `main.py` that converts any uncaught exception to the same
  JSON shape and logs the full traceback to
  `backend-error.log`.
- **JWT storage** now lives in `sessionStorage` (not
  `localStorage`) keyed at `arkmaniagest.authToken`.  The
  shell restores the token on F5 by calling `authApi.me()`
  before falling back to the login screen, so a hard refresh
  no longer forces re-login while keeping the token out of
  cross-tab reach.
- **systemd hardening trade-off**: `NoNewPrivileges` is now
  `no` so the in-UI self-update can call `sudo
  /opt/arkmaniagest/deploy/server-update.sh`.  The blast
  radius stays bounded by a single literal-path entry in
  `/etc/sudoers.d/arkmaniagest-update`.
- **Beacon import endpoint** is exempted from the global 10 MB
  request cap (raised the per-route ceiling so multi-mod
  bundles up to 100 MB can be imported).  nginx
  `client_max_body_size` is bumped to match.

### Database

- **New migration on boot**: idempotent ALTER on
  `arkmaniagest_discord_accounts` adds `app_user_id INT NULL`,
  a `UNIQUE` index `uq_discord_app_user`, and a foreign key
  `fk_discord_app_user -> arkmaniagest_users(id) ON DELETE SET
  NULL`.  Driven by the new `_add_column_if_missing()` helper
  in `app/db/session.py`, guarded by `INFORMATION_SCHEMA` so
  re-runs are no-ops.
- **New table**: `arkmaniagest_discord_role_map` (id,
  app_role_name, discord_guild_id, discord_role_id, direction,
  priority, created_at, updated_at) -- created automatically
  on first boot of 3.0.0.

### Configuration

- New `.env` keys (template in `deploy/.env.production`):
  - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
    `DISCORD_PUBLIC_KEY`
  - `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
  - `DISCORD_REDIRECT_URI` (must match the URI registered on
    the Discord Developer Portal *exactly*; the panel ships
    `https://<host>/api/v1/auth/discord/callback`)
  - `DISCORD_ADMIN_USER_IDS`, `DISCORD_OPERATOR_USER_IDS`,
    `DISCORD_VIEWER_USER_IDS` (CSV, optional)

### Security

- Discord OAuth state + session cookies are JWT-signed with
  the existing `JWT_SECRET` and segregated by `audience`
  (`discord:state` vs `discord:session`) so a captured cookie
  cannot be replayed across audiences.
- The panel JWT issued at the end of the OAuth flow is
  delivered to the SPA via URL fragment, so it never reaches
  nginx access logs or upstream proxies.
- All OAuth tokens are AES-256-GCM-encrypted at rest using
  the existing envelope helper -- a snapshot of the panel DB
  cannot be replayed against Discord without
  `ARKM_ENCRYPTION_KEY`.

### Documentation

- New `docs/DISCORD_INTEGRATION.md` describing the 7-phase
  rollout plan, the security model, and the operational
  notes (what to register on the Discord Dev Portal, how to
  rotate credentials, expected DB row layout).

### Migration notes (2.3.9 -> 3.0.0)

The release is **drop-in**: the panel boots normally without
any of the `DISCORD_*` keys set (the Discord button is hidden
in that case).  To enable Discord login:

1. Create an application on the Discord Developer Portal,
   copy the Client ID, Client Secret, Bot Token and Public
   Key into `.env`.
2. Register the redirect URI **exactly** as
   `https://<your-host>/api/v1/auth/discord/callback` under
   the application's "OAuth2 -> Redirects" tab.
3. (Optional) Pre-populate `DISCORD_ADMIN_USER_IDS` so the
   first Discord login lands directly in the admin UI; or,
   log in as an existing admin AppUser and call `POST
   /api/v1/discord/link-app-user/{discord_user_id}` to bind
   that Discord identity to the AppUser explicitly.
4. Restart the service -- the `app_user_id` column is added
   automatically by the boot-time migration.

---
## [2.3.9] - 2026-04-23

Quality-of-life batch focused on the daily ops workflows: bulk
permission management, single-tribe purge controls, and
fast-iteration knobs across the panel.

### Added

- **Bulk timed-permission grant** on Players: per-row checkboxes +
  a master select-all in the table header drive a 'Bulk grant (N)'
  button in the page header.  Click opens a modal with a group
  dropdown, four duration shortcuts (+7d / +1m / +3m / +12m) and a
  custom 'N days' input.  Backed by the new
  `POST /api/v1/players/bulk-add-timed-perm` endpoint with
  EXTENSION semantics: existing entries get bumped by the chosen
  delta (clamped to `now` for already-expired ones), missing
  entries get inserted with `now + delta`.  Other timed
  permissions on those players are never touched; the response
  reports `extended` / `added` counts separately.
- **Excel-style column filters** on the Players table (Tribe,
  Groups, Timed-Active, Timed-Expired).  Each filterable column
  has a small filter icon next to its sort caret; click opens a
  popup with a search box, select-all-with-indeterminate
  master checkbox, a Clear button and one row per distinct
  value found across the loaded players (plus an '(empty)'
  sentinel for rows that have no value in the column).  Filters
  AND across columns, ANY-match within a column, and the
  Timed-perms popup is split into ACTIVE / EXPIRED tabs so 'who
  currently has VIP' is separable from 'who once had VIP that's
  now expired'.
- **'+7d' quick-extend button** in the per-player timed-permission
  editor, alongside the existing +1m / +3m / +12m for short-term
  grants.
- **Tribe-name sync** (`POST /api/v1/players/sync-tribes`):
  sibling of the player-name sync.  Walks each scanned
  container's SavedArks dir for `*.arktribe` files, extracts the
  TribeName via a new `ark_parse_tribe.py` parser uploaded to the
  remote host, and updates `tribe_name` in both
  `ARKM_player_tribes` and `ARKM_tribe_decay` matched by
  `targeting_team`.  New 'Sync Tribù' button next to 'Sync Nomi'
  on the Players page.
- **Per-row decay actions** (Tribes tab): a new red `Trash2 +
  'Now'` button schedules a single tribe AND immediately fires
  `ARKM.DM.Purge` over RCON on every active ARK instance via the
  existing `exec_rcon` plumbing -- so the destructive sweep
  doesn't have to wait for the next periodic plugin tick.  A
  smaller `Clock` button next to it is the queue-only schedule
  (legacy behaviour).  Pending tab gains a per-row `XCircle +
  Cancel` button to remove the queued entry without firing the
  sweep.
- **Cluster-wide 'Run DM.Purge' button** on the Decay page header
  (admin only).  Sends `ARKM.DM.Purge` to every active ARK
  instance, returns a per-instance result with stdout/stderr
  tails so the operator can confirm each server actually
  executed the command.
- **'Clear PvE' / 'Clear PvP' buttons** on the Leaderboard page
  header.  Each wipes both the score table (`ARKM_lb_scores`)
  and the per-event log (`ARKM_lb_events`) for the matching
  `server_type` only -- the other mode's history is untouched.
- **'Clear spawn table' button** on the Rare Dinos page.
  Truncates `ARKM_rare_spawns` (the event log) without touching
  the configured pool in `ARKM_rare_dinos`.

### Changed

- Players list cap raised from 100 to 500 to match the backend
  default; the subtitle 'N registered' and the filtered/sorted
  table now agree on small/medium clusters (real offset
  pagination is still needed beyond 500).
- The bulk-grant entry point lives in the page header now
  (next to Sync buttons), not in an inline strip above the
  table -- one less context jump, button-disabled state shows
  immediately when no rows are selected.
- 'Containers' was removed from the sidebar in 2.3.8; 2.3.9 has
  no further nav changes.
- Dashboard right-side 'Server status' box was removed in 2.3.8.

### Fixed

- Route-ordering bug: `DELETE /arkmania/rare-dinos/spawns` was
  returning HTTP 422 because FastAPI matches routes in
  declaration order and `DELETE /{dino_id}` was registered first
  -- the literal string 'spawns' got parsed as int and validation
  rejected it.  Same pattern fixed for the new
  `/decay/run-purge` and `/decay/purge-tribe/{team}` endpoints.
- React 'Minified error #31' (object passed to JSX) when a
  FastAPI 422 validation array reached `setError(detail)`.  The
  global axios response interceptor now coerces
  `error.response.data.detail` to a single-line string when it's
  an array or object, so every page is safe regardless of which
  FastAPI failure mode it hits.

---

## [2.3.8] - 2026-04-22

UI consolidation, light theme, fresh blueprint catalog and rare-dino
event log management.

### Added

- **Containers + ARK Instances merged** into a single `/instances`
  page.  The new Instances page lists every registered managed
  instance and adds a "Scan machines" action that surfaces "orphan"
  containers (discovered by SSH but not yet in `ARKM_server_instances`)
  in a separate section, each with a one-click **Import** workflow
  backed by the new `POST /api/v1/servers/import-from-container`
  endpoint.  The old `/containers` route now redirects to `/instances`.
- **Light theme.**  `index.css` ships a `[data-theme="light"]` palette
  alongside the dark default; `src/theme.ts` reads / persists the
  choice in `localStorage` and applies it to `<html>` BEFORE React
  paints (no flash of wrong theme).  A Sun/Moon button next to the
  language selector toggles between modes.  System preference is
  honoured when the user hasn't picked yet.
- **Beacon `.beacondata` import** for the blueprint catalog.  The
  Dododex GitHub mirror is stale (1,973 entries, last refresh 2024-11-08,
  zero ASA additions); Beacon's complete export yields 15,243 unique
  blueprints across 80 content packs (4,586 creatures + 12,283 engrams)
  including ASA-era creatures like Maeguana, Helminth and Bog Spider
  PLUS any mods loaded in Beacon.  Multipart upload via the new
  `POST /api/v1/blueprints/import-beacondata` endpoint; primary
  "Import Beacon (.beacondata)" button on the empty-state screen,
  smaller "Beacon" button in the toolbar.
- **"Clear spawn table" button** on the Rare Dinos page (top-right,
  next to "Generate Random") — wipes the `ARKM_rare_spawns` event
  log without touching the configured pool.  Backed by the new
  `DELETE /api/v1/arkmania/rare-dinos/spawns` endpoint with optional
  `server_key` / `older_than_days` filters for future fine-grained
  cleanups.

### Changed

- ServerInstancesPage rewritten on the design-system classes
  (`.page-header`, `.card`, `.card-form`, `.form-grid`, `.machine-card`,
  `.badge`, `.btn-primary/secondary/ghost/danger`).  Almost all inline
  styles removed -- font sizes, spacing and colours now match the rest
  of the panel.
- "Containers" sidebar entry retired; the Instances page absorbs its
  list-view + scan responsibilities.
- `POST /api/v1/blueprints/sync` no longer scrapes 18 ARK Wiki pages
  (which added ~60s of latency, occasional 429s, and marginal gain
  over Dododex).  Sync is Dododex-only; the wiki helpers are kept
  in-module ready to re-enable if ever needed.  Operators reading the
  log now see an explicit `Blueprint sync: wiping N previous entries`
  line so a no-op run is distinguishable from a real refresh.
- `RateLimitMiddleware` exempts the polling endpoints (`/settings/status`,
  `/system-update/status`, `/health`) and raises the general per-IP
  quota from 120/min to 300/min so an active admin session can't
  429-lock itself.
- The frontend's GitHub-derived 429 messages now include the reset
  time + a hint to add `GITHUB_TOKEN` to `.env`.

### Fixed

- `[data-theme="light"]` selector for `color-scheme` was nested wrong
  (would only have matched an `<html>` inside a `data-theme="light"`
  element, which is impossible) — native dropdowns rendered with dark
  defaults on a white page.  Fixed plus belt-and-braces explicit
  `select option` background/colour so Firefox renders correctly too.
- `RareDinosPage` add-modal now warns up front when the local blueprint
  DB is empty + offers a deep link to Settings → Blueprints, instead
  of returning silent zero-result autocomplete.
- Self-update sudo probe (`POST /system-update/preflight`) used the
  strict `sudo -n -l <command>` form which doesn't match a sudoers
  rule ending with `*` when no argument is supplied.  Switched to the
  relaxed `sudo -n -l` listing + grep, matching the operator-readable
  manual verification.  Banner hint surfaces the concrete sudo error
  (`NOPASSWD missing`, `no rule for this user`, ...) instead of a
  generic "sudoers entry missing".
- `arkmaniagest.service` had `NoNewPrivileges=yes`, which silently
  vetoed every sudo from inside the service and made the in-UI
  self-update unusable -- flipped to `no` (the matching sudoers
  whitelist still constrains escalation to the single trusted
  `server-update.sh` path).  `PrivateTmp` flipped to `no` and `/tmp`
  added to `ReadWritePaths` so the detached update child + the
  post-restart backend share the status / log / tarball files.
- `server-update.sh` now writes `state=success` to the panel-side
  status JSON BEFORE calling `systemctl restart arkmaniagest`,
  because the script is in the panel's cgroup and gets SIGTERM-ed
  the moment systemd starts stopping the service.  Adds an `ERR`
  trap that writes `state=failed` on any non-zero exit earlier.
- `server-update.sh` auto-detects the GitHub-release tarball layout
  (`arkmaniagest-vX.Y.Z/` as a single top-level directory) and shifts
  ROOT one level deeper before the rsync -- the old logic blew away
  most of `/opt/arkmaniagest/` when fed a release-style archive.
  A follow-up sweep cleans up any orphan `arkmaniagest-v*/` directory
  left by previous broken runs.
- Hitting F5 on any panel page no longer kicks the user back to the
  login screen.  The JWT is now persisted in `sessionStorage` (cleared
  on tab close) and restored on boot via `authApi.me()`.
- Nginx `client_max_body_size` raised from 10 MB to 100 MB so Beacon
  uploads (~12 MB) reach the backend.
- `RequestSizeLimitMiddleware` exempts the `/blueprints/import-*`
  endpoints from the 10 MB cap so the Beacon upload isn't blocked
  by the global limit either.

### Tooling

- **`deploy/update-panel.ps1`** + **`deploy/update-panel.sh`**:
  interactive dev-side update scripts (push working tree to an
  existing panel host without cutting a GitHub release).  Honour
  `.deployignore`, support `--backend-only` / `--frontend-only` /
  `--no-deps` / `--dry-run`.
- `release.ps1` no longer aborts on vite stderr (PS 5.1 turned it
  into a NativeCommandError) and reads files as UTF-8 explicitly so
  em-dashes / accented characters don't round-trip to mojibake.
- `release.ps1` + `package-release.ps1` resolve `$PROJECT` two levels
  up from `deploy/maintainer/` (where they actually live).
- `full-deploy.sh` writes `/etc/sudoers.d/arkmaniagest` after
  `visudo -c` validation in phase 9, enabling the in-UI self-update
  on fresh installs.

---

## [2.3.7] - 2026-04-22

Hotfix release for two regressions surfaced by the first real-world
end-to-end test of the in-UI self-updater introduced in 2.3.5/2.3.6.

### Fixed

- **`server-update.sh` misread the GitHub release tarball layout**,
  wiping most of `/opt/arkmaniagest/` in the process.  The release
  workflow packs the code under a single top-level
  `arkmaniagest-vX.Y.Z/` directory; the old sync logic ran
  `rsync --delete $TMP/ $APP/` which saw only that one dir in source,
  interpreted every existing dir at the destination as "obsolete",
  and tried to delete `backend/`, `frontend/`, `deploy/` and friends.
  Partial success left the host unreachable (`deploy/` gone,
  `find: '/opt/arkmaniagest/deploy': No such file or directory`).

  Fix: detect when `$TMP` contains exactly one project-root-shaped
  directory and rsync FROM that inner dir instead.  A follow-up sweep
  also removes any `arkmaniagest-v*/` leftover from a botched prior
  run so the tree is self-healing.
- **F5 on any panel page kicked the operator back to the login
  screen**.  The JWT was held in a module-level variable with no
  persistence, so the in-memory state was wiped by every page reload.
  The token is now kept in `sessionStorage` (survives F5 inside the
  same tab, wiped on tab close) and `App.tsx` restores the session on
  boot via `authApi.me()` before falling back to the login route.
  The proper long-term fix is an httpOnly cookie + CSRF token;
  sessionStorage is a pragmatic middle ground with the same narrow
  XSS exposure as the old in-memory approach.

### Upgrade note

The 2.3.6 release tarball, if installed via the in-UI updater,
leaves `/opt/arkmaniagest/` in a half-broken state.  Recovery path:

```powershell
.\deploy\update-panel.ps1 -Server root@<panel-host>
```

which pushes a correctly-shaped (root-level) tarball of the dev
working tree and runs the new `server-update.sh` that cleans up the
orphan `arkmaniagest-v2.3.6/` directory on its way through.

---

## [2.3.6] - 2026-04-22

First release where the in-UI self-update actually works end-to-end --
2.3.5 shipped the UI button and the endpoint, but the systemd service
unit + the sudo probe + the restart race each silently broke the flow
in a different place.  All fixed here.

### Fixed

- **systemd unit contradicted the self-update path**: shipped with
  `NoNewPrivileges=yes`, which makes `sudo` refuse to elevate from
  inside the service with `sudo: The "no new privileges" flag is set,
  which prevents sudo from running as root`.  Flipped to `no`, plus
  `PrivateTmp=no` and `/tmp` added to `ReadWritePaths` so the detached
  update child and the post-restart backend see the same status /
  log files.  Threat-model compensation: the sudoers snippet still
  whitelists only a single literal path (`bash server-update.sh *`),
  so a panel compromise cannot escalate beyond (re-)running the
  already-trusted update pipeline.
- **Preflight sudo probe returned a false negative**: used
  `sudo -n -l bash <script>` which, on recent sudo versions, does not
  match a sudoers rule ending with `*` when no argument is supplied.
  Probe now runs `sudo -n -l` (without a command) and grep-checks for
  `server-update.sh` + `NOPASSWD`, matching the manual verification
  operators run in the README.
- **Preflight banner was uninformative**: the hint now surfaces the
  concrete reason (`no sudoers rule at all`, `NOPASSWD missing`,
  `sudo binary not in PATH`, ...) instead of a generic "Sudoers entry
  missing".
- **`server-update.sh` got SIGTERM-ed mid-restart**: the script runs
  inside the panel's own cgroup, and `systemctl restart arkmaniagest`
  is synchronous, so when systemd stops the old service it kills the
  still-running script -- the UI status poll could never transition
  to `success`.  The script now writes the final status JSON *before*
  the restart, and installs an `ERR` trap that writes `failed` on any
  non-zero exit earlier in the run, so the browser gets a clean
  terminal state regardless.
- **GitHub 429 / 403 rate-limit errors** now translate to a
  human-readable `"Try again in ~N minute(s). Add GITHUB_TOKEN to
  backend/.env to lift the limit from 60/h anonymous to 5000/h
  authenticated"` message in both `/version-check` and
  `/system-update/install`, and the `/version-check` cache honours
  `X-RateLimit-Reset` so the panel does not keep pounding GitHub
  during the lockout window.
- **Admin panel lockout via internal rate limiter**: the per-IP
  120 req/min window was eaten by `/settings/status` (pre-login
  polling), `/system-update/status` (install progress drawer) and
  `/health` (dashboard auto-refresh) combined, so an active admin
  could 429-lock themselves on a normal session.  Those three
  polling paths are now exempt from the counter, and the general
  quota is raised from 120 to 300/min.

### Tooling

- `deploy/update-panel.ps1` / `.sh`: fixed a PS 5.1 trailing-comma
  parse error in the `WriteAllText` invocation.

---

## [2.3.5] - 2026-04-22

### Added

- **In-UI self-update** (Settings -> General -> Updates card, new
  "Install update" button).  When a newer release is available on
  GitHub, an admin can now install it directly from the browser:
  - `GET  /api/v1/system-update/preflight` -- reports whether the
    sudoers entry, `server-update.sh` and `GITHUB_REPO` are in place;
    the UI uses it to enable/disable the button and explain what is
    missing.
  - `POST /api/v1/system-update/install` -- fetches the latest GitHub
    release metadata, downloads the Linux tarball to `/tmp`, verifies
    its SHA-256 against `SHA256SUMS`, then spawns `server-update.sh`
    in a detached process (`start_new_session=True`) so it survives
    the backend restart it triggers.
  - `GET  /api/v1/system-update/status` -- poll-friendly snapshot of
    the in-flight update, including a tail of `/tmp/arkmaniagest-update.log`.
  The UI polls `/status` every 2 s during the install and displays a
  live drawer with the build log, then re-checks `/health` and the
  version banner once the new backend is up.
- **`deploy/sudoers-arkmaniagest`**: drop this file under
  `/etc/sudoers.d/arkmaniagest` (mode 0440) to allow the panel user
  `arkmania` to run `server-update.sh` as root without a password.
  The snippet whitelists only the literal script path under bash, so
  a panel compromise cannot escalate via this entry.  `full-deploy.sh`
  installs it automatically (and reverts if `visudo -c` rejects it).
- **`deploy/update-panel.ps1`** and **`deploy/update-panel.sh`**:
  interactive dev-side update scripts.  Unlike the release-based
  flow, these pack the local working tree, upload it to an existing
  panel and run `server-update.sh` in place -- so a developer can
  iterate against a remote panel without cutting a GitHub release.
  Both honour `.deployignore`, auto-detect `deploy/deploy.conf`,
  support `--backend-only` / `--frontend-only` / `--no-deps`, and
  survive the backend restart via stdout streaming.

### Changed

- `full-deploy.sh` phase 9 now also installs the sudoers snippet,
  validated with `visudo -c`.  Existing deployments can enable the
  in-UI updater by running once:
  ```
  sudo install -m 0440 /opt/arkmaniagest/deploy/sudoers-arkmaniagest \
      /etc/sudoers.d/arkmaniagest
  ```

---

## [2.3.4] - 2026-04-22

### Added

- **ARK server instances module** (`/instances` page, `/api/v1/servers/*`).
  Full CRUD over `ARKM_server_instances` + lifecycle actions executed via
  SSH against POK-manager: **start / stop / restart / update / backup /
  status probe / rcon**.  Every call is audited into
  `ARKM_instance_actions` (stdout / stderr / exit code / duration) and
  the instance `status` column is transitioned (`starting` -> `running`,
  `stopping` -> `stopped`, `error` on failure, ...).
- **`ssh/pok_executor.py`**: new module that wraps POK-manager invocations
  through `PlatformAdapter` (bash on Linux, `wsl.exe` on Windows hosts),
  runs them off the event loop via `asyncio.to_thread`, and persists the
  outcome.  Long-running actions (e.g. `POK -update`, 10+ min) are
  supported; the per-call axios timeout on the UI side is bumped to 30
  minutes only for `/update`.
- **Global instance-action log endpoint** `GET /api/v1/instance-actions`
  with filters (`instance_id`, `machine_id`, `action`, `status`).

### Fixed

- **Backend boots on installs that emit empty `.env` values**.
  pydantic v2 refused to parse `PLUGIN_DB_PORT=""` into `int` and the
  service stayed in an `exited` loop after the installer wrote the real
  `.env`.  Added a `@field_validator(mode="before")` on every int / bool
  field that treats empty strings as "use the default".
- **`release.ps1` aborting on vite stderr**.  With
  `$ErrorActionPreference = "Stop"` any native command writing to stderr
  (including vite's progress lines) got promoted to a
  `NativeCommandError` before `$LASTEXITCODE` could be checked; fix
  lowers the preference for the build call only.
- **`release.ps1` mojibake on non-ASCII characters**.  `Get-Content -Raw`
  without `-Encoding UTF8` on PS 5.1 with the Italian locale re-read
  files as Windows-1252, so em-dashes / arrows / ellipses round-tripped
  to garbage when rewritten.  All three call sites now pass
  `-Encoding UTF8` explicitly.
- **`release.ps1` + `package-release.ps1` resolved `$PROJECT` wrong**.
  The scripts were moved under `deploy/maintainer/` but still did
  `$PSScriptRoot\..`, pointing at `deploy/` instead of the repo root
  ("cannot find path deploy\backend\app\main.py").
- **`full-deploy.sh` GeoIP nginx config**: the generated
  `/etc/nginx/conf.d/geoip2.conf` is now written directly from bash
  instead of via `awk` template substitution, which on Ubuntu's mawk
  silently flattened the country/whitelist multi-line variables into a
  single line ("unknown directive CH").  GeoIP DB fallback also
  extended to the current month + the previous 3 months so early-
  in-the-month deploys succeed before db-ip publishes the new DB.
- **`full-deploy.sh`**: npm is now upgraded to latest right after
  installing NodeSource Node.js 20 (silences the
  "new major version of npm available" notice on every deploy).

### UI

- New **"ARK Instances"** entry in the Main sidebar group
  (`/instances`), between Containers and Game Config.
- Per-row action toolbar with icons for start / stop / restart /
  probe / backup / update / edit / delete.  Delete gated to admin role;
  optional host-side stop before deletion.
- Expandable drawer below each row showing the 20 most recent audit
  entries with stdout/stderr/exit code/duration/user.
- `serverInstancesApi` + `instanceActionsApi` in `services/api.ts`;
  typed `ServerInstance`, `InstanceAction`, `InstanceActionResult`
  added to `types/index.ts`; `instances.*` i18n section in both
  `en.json` and `it.json`.

### Installer

- Both `install-panel.ps1` and `install-panel.sh` now dump
  `/var/log/arkmaniagest/backend-error.log` when the post-install
  `/health` poll times out — that's where uvicorn's stderr actually
  lives.  `journalctl` alone only shows systemd "Main process exited"
  noise, which is useless for diagnosing Python tracebacks.

---

## [2.3.3] - 2026-04-21

### Fixed

- **`install-panel.ps1` SSH test always failing** with
  `SSH test failed (exit ArkManiaGest-SSH-OK 0)`.  The helper
  functions `Invoke-SSH` / `Invoke-SCP` were returning
  `[stdout lines..., $LASTEXITCODE]` as a merged PowerShell pipeline,
  so the caller's `$test_rc` was an array, not an integer, and the
  `-ne 0` comparison was always truthy.
  Fix: every helper now routes the external-process output to
  `Out-Host` (or `Out-Null` for silent probes) and returns ONLY
  `$LASTEXITCODE`.  Added a second helper `Invoke-SSH-Quiet` for
  connectivity probes that must not echo to the console.

---

## [2.3.2] - 2026-04-21

### Fixed

- **`install-panel.ps1`**: the interactive installer failed to parse on
  Windows PowerShell 5.1 with the Italian UI locale.  Two issues were
  at play:
  - PowerShell 5.1 reads files without a UTF-8 BOM as Windows-1252, so
    the em-dashes (`—`) and ellipses (`…`) in comments and section
    banners broke the parser ("Token non riconosciuto").  All PS
    scripts are now ASCII-only.
  - `"@"` as a literal string inside a concatenation was parsed as a
    here-string opener.  Replaced with `[char]0x40` builder.
  - `"$var1:$var2"` interpolation was parsed as "scoped variable
    reference".  Replaced with `${var1}:${var2}` form (and string
    concatenation where safer).
- Same sanitisation applied to `deploy-remote.ps1`,
  `update-remote.ps1`, `maintainer/package-release.ps1`.

---

## [2.3.1] - 2026-04-21

First-class interactive installers and release-bundle cleanup.

### Added

- **`deploy/install-panel.ps1`** (Windows client) and
  **`deploy/install-panel.sh`** (Linux client): interactive installers
  that prompt for target server / domain / DB credentials / admin
  user, probe SSH (default keys or `ssh-agent` first; fall back to
  explicit key file or password), generate `deploy.conf` + `.env`
  with random `JWT_SECRET` / `FIELD_ENCRYPTION_KEY`, upload the
  release tree via SCP, and run `full-deploy.sh` on the remote host —
  then seed the first admin user via the `/settings/setup` endpoint.
- **`docs/INSTALL.en.md`** and **`docs/INSTALL.it.md`**: end-user
  installation guides in English and Italian, shipped inside the
  release bundle.
- README section "Panel on a Windows server" documenting the
  WSL2 + Ubuntu approach for hosting the panel on Windows VPSes.

### Changed

- Release bundles (`arkmaniagest-v*-windows.zip` /
  `arkmaniagest-v*-linux.tar.gz`) now contain **only** the scripts an
  end user needs to install or update the panel.  Maintainer scripts
  (`release.ps1`, `package-release.ps1`) moved to
  `deploy/maintainer/` and excluded from release artefacts via
  `.deployignore`.
- `.github/workflows/release.yml` keeps the user-facing `.ps1` / `.bat`
  helpers inside the Windows zip (previously all `*.ps1 *.bat *.vbs`
  were excluded because the shared exclude list served the Linux
  tarball too).  The Linux tarball still strips them, as before.

### Fixed

- **v2.3.0 Windows zip**: shipped without any `.ps1` script, making
  the interactive flow impossible from a Windows client.  Re-tagged
  and re-built.

---

## [2.3.0] - 2026-04-21

First public release.  Consolidates the entire V2 work behind a single
source-available repository: split panel/plugin databases, cross-platform
SSH support, the schema for managed Docker ARK ASA instances, a fully
bilingual (IT/EN) UI, release packaging, and an in-panel update checker.

### Added

- **Dual database architecture**: panel DB (users, SSH machines,
  settings, managed Docker instances) kept separate from the plugin DB
  (ArkMania game tables).  Configure with `DB_*` and `PLUGIN_DB_*` in
  `.env`; `PLUGIN_DB_*` empty → plugin falls back to the panel DSN, so
  legacy single-database installs keep working.
- **Managed instances schema** in the panel DB: `ARKM_server_instances`,
  `ARKM_instance_actions`, `ARKM_mariadb_instances`.  REST routes to
  manipulate these land in a follow-up release.
- **Cross-platform SSH layer** (`backend/app/ssh/platform.py`): a
  `PlatformAdapter` that wraps `docker`, `docker compose`, and
  `POK-manager.sh` invocations so they work transparently on native
  Linux hosts *and* Windows + WSL Ubuntu hosts.
- **i18n (IT/EN)**: every user-facing string on every page now goes
  through `react-i18next`.  Language toggle in the sidebar, default
  from the browser, persisted in `localStorage`.
- **SQL Console dual-DB toggle**: Panel DB / Plugin DB switch in the
  toolbar.
- **In-panel update checker**: `GET /settings/version-check` polls the
  GitHub Releases API (cached 1 h) and a card in General Settings shows
  the running version, the latest release, and a link to its notes.
- **Release packaging**:
  - `deploy/package-release.ps1` builds self-contained Linux and
    Windows bundles locally.
  - `.github/workflows/release.yml` publishes the same two artefacts
    plus `SHA256SUMS.txt` to a GitHub Release whenever a `v*` tag is
    pushed.  The release body is auto-populated from this CHANGELOG.
- **Community files**: `LICENSE` (source-available, non-commercial),
  `CONTRIBUTING.md` (contribution assignment clause), `SECURITY.md`,
  `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, CI
  workflow.
- **`deploy/migrate-env.sh`**: idempotent backfill of new `.env`
  keys on upgrade.

### Changed

- README + CHANGELOG + all deploy scripts rewritten in English.
- `Specifiche/` → `docs/` with an English walkthrough of the ServerForge
  API reference.
- `deploy/deploy.conf` is no longer tracked; `deploy/deploy.conf.example`
  ships as the template.  Scripts fall back to the template with a
  warning when the real config is missing.
- History rewrite: earlier internal development has been squashed into
  a single "V2 baseline" commit; the git log now starts with V2.

### Security

- Sensitive IPs previously tracked in the repo (production server IP +
  admin office IP) have been scrubbed from git history via
  `git-filter-repo`.
- SSH passwords and passphrases stored AES-256-GCM encrypted in the
  panel DB (unchanged, documented).

### Licensing

- Project released as **source-available** under the **ArkManiaGest
  Source-Available License v1.0** (see `LICENSE`).  Commercial use is
  prohibited; deployment / redistribution require prior written
  authorisation from Lomatek / ArkMania.it (`info@arkmania.it`).

### Upgrade notes

- Run `deploy/migrations/001_arkmania_config_unique.sql` and
  `deploy/migrations/002_ssh_machines_os_type.sql` once on the live DB.
- If you upgrade an existing install: `deploy/migrate-env.sh` will
  add the new `PLUGIN_DB_*`, `GITHUB_REPO`, `GITHUB_TOKEN` keys to
  your `.env` with safe empty defaults.
- POK integration (container lifecycle routes, bootstrap endpoint,
  frontend management page) is deliberately NOT in 2.3.0 — it is the
  headline feature of the upcoming 2.4 line.

---

## [Unreleased] — Phase 2: Cross-platform SSH (Linux / Windows+WSL)

### New `PlatformAdapter` abstraction

Prerequisite for the POK bootstrap work: every `docker`, `docker compose`
and `POK-manager.sh` invocation now goes through a wrapper that
translates a bash command into whatever syntax the game host's OS
expects.

### Backend

- **`arkmaniagest_machines`**: new columns `os_type` (`linux` / `windows`,
  default `linux`) and `wsl_distro` (default `Ubuntu`).  The
  `server_default` transparently covers pre-existing rows.
- **`deploy/migrations/002_ssh_machines_os_type.sql`**: idempotent
  `ALTER TABLE` for deployments upgrading an existing DB.
- **`app/schemas/ssh_machine.py`**: new `OSTypeEnum` + `os_type` /
  `wsl_distro` fields on Create / Update / Read schemas.
- **`app/ssh/platform.py`**: new `PlatformAdapter` class (`wrap_shell`,
  `docker`, `compose`, `pok`, `prereqs_check_cmd`, `default_pok_base_dir`,
  `join_path`).  Correct bash single-quote escaping for the
  `wsl.exe -d <distro> -- bash -c '...'` wrapper on Windows hosts.
  `from_machine(dict)` falls back to `linux` for legacy rows.
- **`app/api/routes/machines.py`**: create / update / duplicate persist
  `os_type` / `wsl_distro`; the read endpoint returns them normalised.

### Frontend

- **`types/index.ts`**: new `OSType = "linux" | "windows"` +
  `os_type` / `wsl_distro` fields on `SSHMachine` / `SSHMachineCreate`.
- **`MachinesPage`**: "Host OS" selector (native Linux / Windows + WSL),
  WSL distro field shown only when Windows is selected, OS badge in the
  card header, and a dedicated "Host OS" detail inside the expanded
  panel.

### No new routes in Phase 2

The POK bootstrap and prereqs-check endpoints land in Phase 3 and will
reuse `PlatformAdapter.prereqs_check_cmd()` which is already in place.

---

## [Unreleased] — Phase 1: Docker/POK instance schema

### New tables (Panel DB)

Three panel-owned tables to host the ARK ASA instances managed through
POK-manager plus the MariaDB instances co-located on the same machines.
They are auto-created on the next startup via `create_app_tables()` on
the Panel DB only.

- **`ARKM_server_instances`** (35 columns) — one row per ARK ASA
  container.  Key fields: `machine_id`, `name`, `map_name`,
  `session_name`, `game_port` / `rcon_port`, `cluster_id`, mods,
  `container_name`, `image`, `mem_limit_mb`, `pok_base_dir` /
  `instance_dir`, feature flags (`mod_api` / `battleye` /
  `update_server` / …), runtime state + timestamps.  Admin and server
  passwords are stored AES-256-GCM encrypted in the `*_enc` columns.
- **`ARKM_instance_actions`** (15 columns) — lifecycle audit log
  (bootstrap / create / start / stop / restart / update / backup /
  delete / rcon / pok_sync).  Rows are preserved even after the related
  instance is deleted (`ON DELETE SET NULL` on `instance_id` /
  `machine_id` / `user_id`) so the history remains queryable.
- **`ARKM_mariadb_instances`** (17 columns) — one row per managed
  MariaDB container.  Root password AES-256-GCM, `databases_json` with
  the list of databases + users provisioned inside the container
  (per-database passwords encrypted too).

### Backend

- **`app/db/session.py`**: `create_app_tables()` now creates **only**
  the tables defined in `app.db.models.app`, even though `Base.metadata`
  also contains the ARK plugin ORM classes (`Players`, `ArkShopPlayers`,
  …).  The plugin tables stay owned by the game plugins and must never
  be touched by the panel.
- **`app/db/models/app.py`**: the three new ORM classes with explicit
  foreign keys to `arkmaniagest_machines` and `arkmaniagest_users`.
- **`app/schemas/server_instance.py`** / **`instance_action.py`** /
  **`mariadb_instance.py`**: Pydantic Create / Update / Read schemas
  with enums for state, update coordination role and action types.
  Passwords are never returned in read responses (only the
  `has_*_password` flags).
- **`app/core/store.py`**: async helpers `get_instance_async`,
  `get_all_instances_async`, `log_action_async`,
  `finalise_action_async`, `list_actions_async`, `get_mariadb_async`,
  `get_all_mariadb_async` + row-to-dict normalisers that decrypt
  passwords and sanitise the JSON inside MariaDB instances.

### No REST routes yet

The REST API (`/api/v1/instances/…`, `/api/v1/mariadb/…`) lands in the
following phases (POK bootstrap + instance CRUD), after the
cross-platform SSH layer is in place.

---

## [Unreleased] — Phase 0: Panel / Plugin DB separation

### Infrastructure refactor

First step of the Docker POK-manager effort: the panel database is
split from the game-plugin database.  This is a prerequisite for
hosting the new `ARKM_server_instances`, `ARKM_instance_actions`,
`ARKM_mariadb_instances` tables on the panel without polluting the
plugin schema.

#### Backend

- **`.env`**: new `PLUGIN_DB_HOST`, `PLUGIN_DB_PORT`, `PLUGIN_DB_NAME`,
  `PLUGIN_DB_USER`, `PLUGIN_DB_PASSWORD` variables.  When any of them
  is left empty the plugin connection transparently falls back to the
  panel DSN — existing single-DB deployments keep working without
  changes.
- **`app/core/config.py`**: new `plugin_database_url`,
  `plugin_db_host/port/name/user/password`, `plugin_db_is_separate`
  properties.
- **`app/db/session.py`**: second engine / session factory with
  `init_plugin_engine()` and a `get_plugin_db()` dependency (alongside
  `get_db` / alias `get_panel_db`).  New `close_plugin_engine()`
  wired in the lifespan handler.
- **`app/core/store.py`**: new `_sync_plugin_db_connection()` context
  manager for sync code that needs to target the plugin DB.
- **Routes switched to `get_plugin_db`**: `arkmania_bans`,
  `arkmania_rare_dinos`, `arkmania_transfer_rules`,
  `arkmania_leaderboard`, `arkmania_config`, `arkmania_decay`,
  `players`, `public`.  No route performs cross-DB joins: every
  left-join was between plugin tables (`ARKM_*` + native ARK
  `Players`), so queries remain atomic.
- **Panel routes unchanged** (`get_db`): `auth`, `machines`,
  `serverforge`, `settings`.
- **SQL Console**: the `/sql/execute`, `/sql/tables`,
  `/sql/tables/{name}/schema` endpoints now accept
  `database: "panel" | "plugin"` (default: `panel`).
- **`GET /settings/database`**: schema upgraded to
  `DualDatabaseConfigRead` with `panel` + `plugin` blocks + the
  `plugin_is_separate` / `plugin_configured` flags.
- **New endpoint**: `POST /settings/database/test-plugin` to test the
  plugin DB with the credentials currently in `.env`.
- **`/health`**: new `plugin_db_ready` field.

#### Frontend

- **`DatabaseSettingsPage`**: renders two separate cards (Panel /
  Plugin), each with its own connection parameters and Test button.
  "separate" / "shared with panel" badge on the plugin card + a hint
  explaining the fallback.
- **`SqlConsolePage`**: Panel DB / Plugin DB toggle in the toolbar.
  Switching the target reloads the tables listing and resets the
  schema accordion.  Every `Execute` includes the selected target.
- **Types**: new `DualDatabaseConfig` + `SqlDatabaseTarget`.

#### Developer setup

- POK reference (`reference/POK-ASA-Server/`) is now cloned locally and
  listed in `.gitignore` as the reference for Phase 3 (ARK ASA
  container bootstrap).

---

## Historical

Earlier development of ArkManiaGest (migration from the local vault to
the `.env` + DB architecture, introduction of the ArkMania plugin
editor, ServerForge import, shop editor, blueprint database, and the
SSH scanner) has been consolidated into a single baseline commit
("Unificazione commit per V2 gestionale arkmania") at the start of
the V2 work.  The detailed timeline of that pre-V2 history is no
longer tracked in this file; the squashed baseline is the starting
point of the public repository.
