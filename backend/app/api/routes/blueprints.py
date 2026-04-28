"""
api/routes/blueprints.py — ARK Blueprint catalog (per-row storage).

Storage model
-------------
Each entry lives as a single row in ``ARKM_blueprints`` (panel DB),
keyed on ``blueprint_hash`` (SHA-256 of the lowercased path) so re-imports
are idempotent.  This replaces the legacy single-JSON-blob layout under
``arkmaniagest_settings.key='plugin.blueprints_db'``; on first boot a
one-shot migration in :func:`app.db.session.create_app_tables` lifts the
old blob into rows automatically (see ``_migrate_blueprints_blob_to_rows``).

Lightweight metadata (last sync timestamp, source labels, version) lives
in a slim companion blob ``plugin.blueprints_meta`` so it survives
operations that wipe / reshape the catalog.

Population paths
----------------
* ``POST /sync``               — Dododex GitHub mirror.  UPSERTS into the
                                 table (no longer wipes), so repeated
                                 syncs accumulate / refresh in place.
* ``POST /import-beacondata``  — Beacon ``.beacondata`` bundle.  Same
                                 UPSERT semantics — the operator can
                                 import multiple bundles and have them
                                 merge instead of overwriting each other.
* ``POST /import``             — Inline JSON payload.  ``mode='merge'``
                                 upserts; ``mode='replace'`` wipes the
                                 table first.

Deletion paths
--------------
* ``DELETE /``                 — wipe everything
* ``DELETE /non-official``     — drop modded entries (paths outside the
                                 ``/Game/<official map>/`` trees)
* ``DELETE /by-source``        — drop every entry with a given source
                                 label (e.g. ``beacon:Mods.beacondata``)
* ``DELETE /by-filter``        — drop entries matching arbitrary
                                 search/category/type filters
* ``DELETE /{bp_id}``          — drop a single row by id
"""
import hashlib
import io
import json
import re
import tarfile
import logging
from typing import Optional, List
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

router = APIRouter()
log = logging.getLogger("arkmaniagest.blueprints")

_TIMEOUT_SECS = 30
_META_KEY     = "plugin.blueprints_meta"

# Upstream data sources
_DODODEX_BP_URL       = "https://raw.githubusercontent.com/dododex/dododex.github.io/master/bp.json"
_DODODEX_COMMANDS_URL = "https://raw.githubusercontent.com/dododex/dododex.github.io/master/commands.json"


# ── Hash helper ───────────────────────────────────────────────────────────────

def _bp_hash(path: str) -> str:
    """Stable identity for a blueprint path: SHA-256 of the lowercased / stripped form."""
    norm = (path or "").strip().lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


# ── Name normalisation ────────────────────────────────────────────────────────

# Maps known abbreviated ARK creature/item names to their full display names
_DINO_NAME_MAP: dict[str, str] = {
    "argent": "Argentavis", "argy": "Argentavis",
    "allo": "Allosaurus", "anky": "Ankylosaurus", "ankylo": "Ankylosaurus",
    "bary": "Baryonyx", "bronto": "Brontosaurus",
    "carno": "Carnotaurus", "coel": "Coelacanth", "compy": "Compsognathus",
    "dilo": "Dilophosaurus", "dimetro": "Dimetrodon",
    "diplo": "Diplodocus", "dodo": "Dodo", "doedic": "Doedicurus", "doed": "Doedicurus",
    "equus": "Equus", "galli": "Gallimimus",
    "giga": "Giganotosaurus", "griffin": "Griffin",
    "kapro": "Kaprosuchus", "lystro": "Lystrosaurus",
    "mega": "Megalodon", "megalania": "Megalania", "megalo": "Megalosaurus",
    "micro": "Microraptor", "mosa": "Mosasaurus", "ovis": "Ovis",
    "pachy": "Pachycephalosaurus", "para": "Parasaurolophus", "parasaur": "Parasaurolophus",
    "paracer": "Paraceratherium", "pego": "Pegomastax",
    "pelo": "Pelagornis", "pela": "Pelagornis",
    "phiomia": "Phiomia", "plesi": "Plesiosaurus",
    "ptera": "Pteranodon", "ptero": "Pteranodon",
    "quetz": "Quetzalcoatlus", "quetzal": "Quetzalcoatlus",
    "raptor": "Raptor", "rex": "Rex",
    "saber": "Sabertooth", "sabertooth": "Sabertooth",
    "sarco": "Sarcosuchus", "spino": "Spinosaurus",
    "stego": "Stegosaurus", "tapa": "Tapejara", "tape": "Tapejara",
    "terror": "Terror Bird", "terrorbird": "Terror Bird",
    "theri": "Therizinosaurus", "therizi": "Therizinosaurus",
    "thyla": "Thylacoleo",
    "trike": "Triceratops", "troodon": "Troodon",
    "turtle": "Carbonemys", "carbonemys": "Carbonemys",
    "yuty": "Yutyrannus", "wyvern": "Wyvern",
    "wooly": "Woolly Rhino", "woollyrhino": "Woolly Rhino",
    "mammoth": "Mammoth", "bee": "Giant Bee", "giantbee": "Giant Bee",
    "snake": "Titanoboa", "titanoboa": "Titanoboa",
    "spider": "Araneo", "araneo": "Araneo",
    "scorpion": "Pulmonoscorpius", "pulmonoscorpius": "Pulmonoscorpius",
    "bat": "Onyc", "onyc": "Onyc",
    "wolf": "Direwolf", "direwolf": "Direwolf",
    "bear": "Dire Bear", "direbear": "Dire Bear",
    "frog": "Beelzebufo", "beelzebufo": "Beelzebufo",
    "tuso": "Tusoteuthis", "basilo": "Basilosaurus",
    "chalico": "Chalicotherium",
    "deino": "Deinonychus", "desmodus": "Desmodus",
    "fasolasuchus": "Fasolasuchus", "shasta": "Shastasaurus",
    "xiphactinus": "Xiphactinus", "cerato": "Ceratosaurus",
    "giganto": "Gigantopithecus", "dimorph": "Dimorphodon",
    "liopleuro": "Liopleurodon", "amarga": "Amargasaurus",
    "sino": "Sinomacrops", "fjordhawk": "Fjordhawk",
    "otter": "Otter", "beaver": "Castoroides", "castoroides": "Castoroides",
    "titanosaur": "Titanosaur", "titan": "Titanosaur",
    "basil": "Basilisk", "basilisk": "Basilisk",
    "reaper": "Reaper", "rockdrake": "Rock Drake",
    "ravager": "Ravager", "bulbdog": "Bulbdog",
    "rollrat": "Roll Rat", "gacha": "Gacha",
    "managarmr": "Managarmr", "mana": "Managarmr",
    "velona": "Velonasaur", "velonasaur": "Velonasaur",
    "enforcer": "Enforcer", "gasbags": "Gasbags",
    "snowowl": "Snow Owl", "magma": "Magmasaur", "magmasaur": "Magmasaur",
    "bloodstalker": "Bloodstalker", "ferox": "Ferox",
    "astrocetus": "Astrocetus", "noglin": "Noglin",
    "shadowmane": "Shadowmane", "voidwyrm": "Voidwyrm",
    "maewing": "Maewing", "stryder": "Stryder",
    "andrewsarchus": "Andrewsarchus", "dinopithecus": "Dinopithecus",
    "fenrir": "Fenrir", "megachelon": "Megachelon",
    "tropeognathus": "Tropeognathus", "tropeo": "Tropeognathus",
    "manta": "Manta", "piranha": "Piranha",
    "archaeo": "Archaeopteryx", "archaeopteryx": "Archaeopteryx",
    "pelagornis": "Pelagornis", "angler": "Anglerfish",
    "dungbeetle": "Dung Beetle", "electro": "Electrophorus",
    "hesperornis": "Hesperornis", "kentro": "Kentrosaurus",
    "moschops": "Moschops", "pachyrhino": "Pachyrhinosaurus",
    "procoptodon": "Procoptodon",
}


def _clean_dino_name(raw: str) -> str:
    """Apply the name map to improve abbreviated creature names."""
    if not raw:
        return raw
    lower   = raw.lower().strip()
    no_under = lower.replace("_", " ").replace("  ", " ").strip()
    if lower in _DINO_NAME_MAP:
        return _DINO_NAME_MAP[lower]
    if no_under in _DINO_NAME_MAP:
        return _DINO_NAME_MAP[no_under]
    for key, full in sorted(_DINO_NAME_MAP.items(), key=lambda x: -len(x[0])):
        if lower == key or no_under == key:
            return full
    return raw


def _extract_name(blueprint: str) -> str:
    """Extract a human-readable name from a raw blueprint class path."""
    match = re.search(r'\.([^.\'\"]+)[\'"]?$', blueprint)
    if match:
        name = match.group(1)
        for suffix in ["_Character_BP_C", "_Character_BP_Aberrant", "_Character_BP"]:
            name = name.replace(suffix, "")
        for prefix in [
            "PrimalItem_", "PrimalItemArmor_", "PrimalItemResource_",
            "PrimalItemStructure_", "PrimalItemConsumable_",
            "PrimalItemConsumableEatable_", "PrimalItemAmmo_",
            "PrimalItemSkin_", "PrimalItemCostume_", "PrimalItemDye_",
            "PrimalItem_Weapon", "PrimalItemArtifact_",
        ]:
            if name.startswith(prefix):
                name = name[len(prefix):]
                break
        name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
        name = re.sub(r"_", " ", name).strip()
        improved = _clean_dino_name(name)
        return improved if improved != name else name
    return blueprint


def _improve_name(name: str, blueprint: str) -> str:
    if not name:
        return _extract_name(blueprint)
    improved = _clean_dino_name(name)
    return improved if improved != name else name


# ── Official-content classification ───────────────────────────────────────────

# Path fragments that identify "official" ARK creature content (vanilla
# + DLC maps + ASA).  Used by the rare-dino picker and the
# /non-official prune endpoint.
_OFFICIAL_DINO_PATH_FRAGMENTS: tuple[str, ...] = (
    "/game/primalearth/dinos/",
    "/game/scorchedearth/dinos/",
    "/game/aberration/dinos/",
    "/game/extinction/dinos/",
    "/game/genesis/dinos/",
    "/game/genesis2/dinos/",
    "/game/asa/dinos/",
    "/game/lostisland/dinos/",
    "/game/lostcolony/dinos/",
)

# Path fragments shared by every official blueprint type (creatures,
# items, structures, weapons, ...).  Distinct from the dino-specific
# tuple because items live outside `/Dinos/`.
_OFFICIAL_PATH_FRAGMENTS: tuple[str, ...] = (
    "/game/primalearth/",
    "/game/scorchedearth/",
    "/game/aberration/",
    "/game/extinction/",
    "/game/genesis/",
    "/game/genesis2/",
    "/game/asa/",
    "/game/lostisland/",
    "/game/lostcolony/",
)

# Path fragments that mark the "S-" variation packs the operator treats
# as on par with official content for the rare-dino picker.
_S_VARIATION_PATH_FRAGMENTS: tuple[str, ...] = (
    "/sdinovariants/",
    "/sdinovariantsfantastictames/",
)


def is_official_blueprint(bp: dict) -> bool:
    """
    Generalised "official content" check across every blueprint type.

    Admin command rows carry no `/Game/` path but are still vanilla
    content, so they are kept.
    """
    if bp.get("type") == "command":
        return True
    path = (bp.get("blueprint") or "").lower()
    if not path:
        return False
    raw = path.replace("blueprint'", "").lstrip("'").strip()
    return any(frag in raw for frag in _OFFICIAL_PATH_FRAGMENTS)


def is_official_or_s_variant_dino(bp: dict) -> bool:
    """
    Return True for dino blueprints from official ARK content or the
    "S-" variation packs.  Skin / chibi entries that upstream tags as
    ``type=dino`` are excluded so creature pickers don't surface them.
    """
    path = (bp.get("blueprint") or "").lower()
    name = (bp.get("name") or "").strip()
    if not path:
        return False
    raw = path.replace("blueprint'", "").lstrip("'").strip()

    if any(frag in raw for frag in _S_VARIATION_PATH_FRAGMENTS):
        return True
    if name.startswith("S-"):
        return True

    if "/skin/" in raw or "chibidino" in raw:
        return False

    return any(frag in raw for frag in _OFFICIAL_DINO_PATH_FRAGMENTS)


def _classify_type(bp: str) -> str:
    """Classify a blueprint by type based on its path segments."""
    bp_lower = bp.lower()
    if "dinos/" in bp_lower or "character_bp" in bp_lower:
        return "dino"
    if "weapon" in bp_lower or "ammo" in bp_lower:
        return "weapon"
    if "armor" in bp_lower or "saddle" in bp_lower:
        return "armor"
    if "structure" in bp_lower:
        return "structure"
    if "consumable" in bp_lower or "kibble" in bp_lower or "soup" in bp_lower:
        return "consumable"
    if "resource" in bp_lower:
        return "resource"
    if "skin" in bp_lower or "costume" in bp_lower:
        return "cosmetic"
    if "artifact" in bp_lower or "trophy" in bp_lower:
        return "artifact"
    return "item"


def _guess_category(bp: str) -> str:
    """Guess the DLC/map category from the blueprint path."""
    bp_lower = bp.lower()
    if "scorched" in bp_lower:    return "Scorched Earth"
    if "aberration" in bp_lower:  return "Aberration"
    if "extinction" in bp_lower:  return "Extinction"
    if "genesis" in bp_lower:     return "Genesis"
    if "lostcolony" in bp_lower:  return "Lost Colony"
    if "asa/" in bp_lower:        return "ASA"
    if "mods/" in bp_lower:       return "Mods"
    return "The Island"


def _make_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


# ── Schemas ────────────────────────────────────────────────────────────────────

class SyncResult(BaseModel):
    success:          bool
    total_blueprints: int
    items_count:      int
    dinos_count:      int
    commands_count:   int
    sources:          List[str]
    errors:           List[str]


class CategoryUpdate(BaseModel):
    category: str


class BulkCategoryUpdate(BaseModel):
    ids:      List[int]
    category: str


class ImportRequest(BaseModel):
    blueprints: List[dict]
    mode:       str = "merge"  # "merge" or "replace"


# Predefined categories — combined with any custom ones found in the DB
_PREDEFINED_CATEGORIES: list[str] = [
    "The Island", "Scorched Earth", "Aberration", "Extinction",
    "Genesis", "Lost Colony", "ASA", "Mods",
    "Resources", "Weapons", "Armor", "Saddles", "Structures",
    "Consumables", "Tools", "Ammunition", "Skins", "Artifacts",
    "Commands", "Custom",
]


# ── DB helpers ────────────────────────────────────────────────────────────────

_BP_COLS = "id, blueprint_hash, blueprint, name, category, type, gfi, source, class_name, description, ext_id"


def _row_to_bp(row) -> dict:
    """Convert a SELECT row (mappings) into the public blueprint dict shape."""
    return {
        "id":          row["id"],
        "name":        row["name"],
        "blueprint":   row["blueprint"],
        "category":    row["category"],
        "type":        row["type"],
        "gfi":         row["gfi"],
        "source":      row["source"],
        "class":       row["class_name"],
        "description": row["description"],
        "ext_id":      row["ext_id"],
    }


async def _load_meta(db: AsyncSession) -> dict:
    """Read the slim metadata blob (last_sync, sources, version)."""
    res = await db.execute(
        text("SELECT value FROM arkmaniagest_settings WHERE `key` = :k"),
        {"k": _META_KEY},
    )
    row = res.first()
    if not row or not row[0]:
        return {"last_sync": None, "sources": [], "version": 0}
    try:
        meta = json.loads(row[0]) or {}
    except (ValueError, TypeError):
        meta = {}
    meta.setdefault("last_sync", None)
    meta.setdefault("sources", [])
    meta.setdefault("version", 0)
    return meta


async def _save_meta(db: AsyncSession, meta: dict) -> None:
    """Persist the slim metadata blob."""
    await db.execute(
        text(
            "INSERT INTO arkmaniagest_settings (`key`, `value`, `encrypted`, `description`) "
            "VALUES (:k, :v, 0, 'Blueprints metadata (rows live in ARKM_blueprints)') "
            "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)"
        ),
        {"k": _META_KEY, "v": json.dumps(meta, ensure_ascii=False)},
    )


async def _count_total(db: AsyncSession) -> int:
    res = await db.execute(text("SELECT COUNT(*) FROM ARKM_blueprints"))
    return int(res.scalar() or 0)


async def _upsert_blueprints(
    db: AsyncSession,
    items: list[dict],
    *,
    default_source: Optional[str] = None,
) -> tuple[int, int]:
    """
    Bulk UPSERT a list of blueprint dicts.

    Returns ``(added, updated)``.  Identity is the SHA-256 of the path;
    on conflict the existing row's mutable fields are refreshed.
    Detection of "added vs updated" relies on a probe SELECT before the
    INSERT batch, since MySQL's ``ROW_COUNT()`` after INSERT … ON
    DUPLICATE conflates the two.
    """
    if not items:
        return 0, 0

    # 1. Compute hashes + de-dup within the incoming batch (last-write-wins).
    by_hash: dict[str, dict] = {}
    for it in items:
        path = (it.get("blueprint") or "").strip()
        if not path:
            continue
        h = _bp_hash(path)
        merged = dict(it)
        merged["_hash"] = h
        merged["_path"] = path
        by_hash[h] = merged
    if not by_hash:
        return 0, 0

    hashes = list(by_hash.keys())

    # 2. Probe which hashes already exist so we can split added vs updated.
    existing: set[str] = set()
    BATCH_PROBE = 500
    for i in range(0, len(hashes), BATCH_PROBE):
        chunk = hashes[i:i + BATCH_PROBE]
        # Build a positional placeholder list.  SQLAlchemy's expanding
        # bindparam would be cleaner but we already have plain text() here.
        params = {f"h{j}": h for j, h in enumerate(chunk)}
        placeholders = ", ".join(f":h{j}" for j in range(len(chunk)))
        res = await db.execute(
            text(f"SELECT blueprint_hash FROM ARKM_blueprints WHERE blueprint_hash IN ({placeholders})"),
            params,
        )
        for r in res.fetchall():
            existing.add(r[0])

    # 3. Bulk INSERT … ON DUPLICATE KEY UPDATE.
    rows: list[dict] = []
    for h, it in by_hash.items():
        rows.append({
            "h":   h,
            "bp":  it["_path"],
            "n":   (it.get("name") or "")[:255] or it["_path"][:255],
            "c":   it.get("category"),
            "t":   it.get("type"),
            "g":   it.get("gfi"),
            "s":   it.get("source") or default_source,
            "cl":  it.get("class") or it.get("class_name"),
            "d":   it.get("description"),
            "e":   it.get("id") if isinstance(it.get("id"), str) else None,
        })

    BATCH = 500
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        await db.execute(
            text(
                "INSERT INTO ARKM_blueprints "
                "(blueprint_hash, blueprint, name, category, type, gfi, "
                " source, class_name, description, ext_id) "
                "VALUES (:h, :bp, :n, :c, :t, :g, :s, :cl, :d, :e) "
                "ON DUPLICATE KEY UPDATE "
                "  blueprint   = VALUES(blueprint), "
                "  name        = VALUES(name), "
                "  category    = COALESCE(VALUES(category), category), "
                "  type        = COALESCE(VALUES(type), type), "
                "  gfi         = COALESCE(VALUES(gfi), gfi), "
                "  source      = COALESCE(VALUES(source), source), "
                "  class_name  = COALESCE(VALUES(class_name), class_name), "
                "  description = COALESCE(VALUES(description), description), "
                "  ext_id      = COALESCE(VALUES(ext_id), ext_id)"
            ),
            chunk,
        )

    added = sum(1 for h in by_hash if h not in existing)
    updated = sum(1 for h in by_hash if h in existing)
    return added, updated


async def _bump_meta(db: AsyncSession, *, source_label: str) -> None:
    """Append a source-label entry to meta.sources and refresh last_sync/version."""
    meta = await _load_meta(db)
    src = list(meta.get("sources") or [])
    src.append(source_label)
    # Cap the source-history size so it doesn't grow without bound.
    src = src[-50:]
    meta["sources"]   = src
    meta["last_sync"] = datetime.now(timezone.utc).isoformat()
    meta["version"]   = int(meta.get("version") or 0) + 1
    await _save_meta(db, meta)


# ── Beacon parser helpers ─────────────────────────────────────────────────────

_BEACON_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_BEACON_SKIP_PATH_FRAGMENTS = (
    "/Buffs/", "/Effects/", "/UI/", "/HUD/",
)


def _beacon_normalize_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    p = path.strip()
    return p if p else None


def _beacon_classify_type(path: str, kind: str) -> str:
    if kind == "creatures":
        return "dino"
    return _classify_type(path)


def _beacon_record_skipped(path: str) -> bool:
    if not path:
        return True
    return any(frag in path for frag in _BEACON_SKIP_PATH_FRAGMENTS)


def _normalize_beacon_creature(c: dict, source: str) -> Optional[dict]:
    path = _beacon_normalize_path(c.get("path"))
    if not path or _beacon_record_skipped(path):
        return None
    pack = str(c.get("contentPackName") or "").strip() or "Unknown"
    name = str(c.get("label") or c.get("alternateLabel") or "").strip()
    if not name:
        return None
    class_str = str(c.get("classString") or "").strip()
    return {
        "id":        f"bcn_{c.get('creatureId') or _make_id(name + path)}",
        "name":      name,
        "blueprint": path,
        "category":  pack,
        "type":      "dino",
        "gfi":       None,
        "source":    source,
        "class":     class_str or None,
    }


def _normalize_beacon_engram(e: dict, source: str) -> Optional[dict]:
    path = _beacon_normalize_path(e.get("path"))
    if not path or _beacon_record_skipped(path):
        return None
    pack = str(e.get("contentPackName") or "").strip() or "Unknown"
    name = str(e.get("label") or e.get("alternateLabel") or "").strip()
    if not name:
        return None
    class_str = str(e.get("classString") or "").strip()
    bp_type   = _beacon_classify_type(path, "engrams")
    spawn = e.get("spawn") or (
        f"cheat gfi {e['gfi']} 1 1 0" if e.get("gfi") else None
    )
    return {
        "id":        f"bcn_{e.get('engramId') or _make_id(name + path)}",
        "name":      name,
        "blueprint": path,
        "category":  pack,
        "type":      bp_type,
        "gfi":       spawn,
        "source":    source,
        "class":     class_str or None,
    }


def _iter_beacon_records(archive_bytes: bytes):
    bio = io.BytesIO(archive_bytes)
    try:
        tf = tarfile.open(fileobj=bio, mode="r:gz")
    except (tarfile.ReadError, OSError):
        bio.seek(0)
        tf = tarfile.open(fileobj=bio, mode="r:")
    with tf:
        for member in tf:
            if not member.isfile() or not member.name.endswith(".json"):
                continue
            fh = tf.extractfile(member)
            if fh is None:
                continue
            raw = fh.read()
            try:
                doc = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            for payload in doc.get("payloads", []) or []:
                for c in payload.get("creatures", []) or []:
                    yield ("creature", c)
                for e in payload.get("engrams", []) or []:
                    yield ("engram", e)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/test-connection")
async def test_connection():
    """Verify connectivity to the Dododex upstream used by ``POST /sync``."""
    results = {}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for name, url in [
            ("bp.json", _DODODEX_BP_URL),
            ("commands.json", _DODODEX_COMMANDS_URL),
        ]:
            try:
                resp = await client.get(url)
                results[name] = {
                    "status":       resp.status_code,
                    "ok":           resp.status_code == 200,
                    "size":         len(resp.content),
                    "content_type": resp.headers.get("content-type", ""),
                    "preview":      resp.text[:200] if resp.status_code == 200 else resp.text[:100],
                }
            except Exception as exc:
                results[name] = {"ok": False, "error": str(exc)}
    return results


@router.get("/status")
async def blueprint_status(db: AsyncSession = Depends(get_db)):
    """Return metadata about the local blueprint database."""
    total = await _count_total(db)
    meta  = await _load_meta(db)
    return {
        "has_data":         total > 0,
        "total_blueprints": total,
        "last_sync":        meta.get("last_sync"),
        "sources":          meta.get("sources") or [],
        "version":          int(meta.get("version") or 0),
    }


@router.post("/sync", response_model=SyncResult)
async def sync_blueprints(db: AsyncSession = Depends(get_db)):
    """
    UPSERT Dododex content (creatures + commands) into ``ARKM_blueprints``.

    Repeated syncs accumulate / refresh in place — they no longer wipe
    the table.  Use ``DELETE /blueprints/by-source?source=base``
    if you want to remove the previous Dododex import before resyncing.
    """
    blueprints:     list[dict] = []
    sources_added:  list[str]  = []
    errors:         list[str]  = []
    items_count    = 0
    dinos_count    = 0
    commands_count = 0

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECS, follow_redirects=True) as client:

        # ── 1. bp.json (creatures from Dododex GitHub) ───────────────────────
        try:
            resp = await client.get(_DODODEX_BP_URL)
            if resp.status_code == 200:
                bp_data = resp.json()
                entries = bp_data if isinstance(bp_data, list) else []
                if isinstance(bp_data, dict):
                    for val in bp_data.values():
                        if isinstance(val, list):
                            entries.extend(val)
                bp_before = len(blueprints)
                for item in entries:
                    bp_path = item.get("bp", "")
                    if not bp_path:
                        continue
                    if not bp_path.startswith("/Game/") and not bp_path.startswith("Blueprint'"):
                        bp_path = f"/Game/{bp_path}"
                    raw_name = item.get("l", item.get("n", ""))
                    category = item.get("t", "")
                    class_id = item.get("id", "")
                    bp_type = _classify_type(bp_path)
                    if bp_type == "dino":
                        dinos_count += 1
                    else:
                        items_count += 1
                    name = _improve_name(raw_name, bp_path)
                    if not category or category in ("Ark", "Official"):
                        category = _guess_category(bp_path)
                    gfi_cmd = f"GFI {class_id} 1 0 false" if class_id else None
                    blueprints.append({
                        "id":        item.get("cid") or _make_id(name),
                        "name":      name,
                        "blueprint": bp_path,
                        "category":  category,
                        "type":      bp_type,
                        "gfi":       gfi_cmd,
                        "source":    "base",
                    })
                added = len(blueprints) - bp_before
                sources_added.append(f"bp.json ({added} creatures)")
            else:
                errors.append(f"bp.json: HTTP {resp.status_code}")
        except Exception as exc:
            errors.append(f"bp.json: {type(exc).__name__}: {exc}")

        # ── 2. commands.json ─────────────────────────────────────────────────
        try:
            resp = await client.get(_DODODEX_COMMANDS_URL)
            if resp.status_code == 200:
                cmd_data = resp.json()
                cmd_list: list = []
                if isinstance(cmd_data, list):
                    cmd_list = cmd_data
                elif isinstance(cmd_data, dict):
                    for key, val in cmd_data.items():
                        if isinstance(val, dict):
                            val["id"] = val.get("id", key)
                            cmd_list.append(val)
                        elif isinstance(val, list):
                            cmd_list.extend(val)

                for cmd in cmd_list:
                    if isinstance(cmd, str):
                        commands_count += 1
                        blueprints.append({
                            "id":        f"cmd_{_make_id(cmd)}",
                            "name":      cmd,
                            "blueprint": cmd,
                            "category":  "Commands",
                            "type":      "command",
                            "gfi":       None,
                            "source":    "base",
                        })
                        continue

                    cmd_id   = cmd.get("id", cmd.get("n", ""))
                    command  = cmd.get("c", cmd.get("command", cmd.get("cmd", "")))
                    example  = cmd.get("e", cmd.get("example", ""))
                    desc     = cmd.get("d", cmd.get("desc", cmd.get("description", "")))
                    cat      = cmd.get("t", cmd.get("category", "Commands"))

                    if not cmd_id and not command:
                        continue

                    commands_count += 1
                    blueprints.append({
                        "id":          f"cmd_{cmd_id or _make_id(command)}",
                        "name":        str(cmd_id or command),
                        "blueprint":   str(command or cmd_id),
                        "category":    str(cat),
                        "type":        "command",
                        "gfi":         example or None,
                        "source":      "base",
                        "description": str(desc) if desc else None,
                    })

                sources_added.append(f"commands.json ({commands_count} commands)")
            else:
                errors.append(f"commands.json: HTTP {resp.status_code}")
        except Exception as exc:
            errors.append(f"commands.json: {type(exc).__name__}: {exc}")

    added, updated = await _upsert_blueprints(db, blueprints, default_source="base")
    if added or updated:
        await _bump_meta(
            db,
            source_label=f"base sync ({added} added, {updated} updated)",
        )

    total_after = await _count_total(db)
    return SyncResult(
        success          = bool(blueprints),
        total_blueprints = total_after,
        items_count      = items_count,
        dinos_count      = dinos_count,
        commands_count   = commands_count,
        sources          = sources_added,
        errors           = errors,
    )


# ── Beacon import ──────────────────────────────────────────────────────────────

@router.post("/import-beacondata", response_model=SyncResult)
async def import_beacondata(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    UPSERT a Beacon ``.beacondata`` bundle into ``ARKM_blueprints``.

    Multiple imports accumulate.  Each entry is tagged with a source
    label of ``beacon:<filename>`` so the operator can later wipe a
    single import via ``DELETE /blueprints/by-source``.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload.")
    if len(raw) > _BEACON_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large ({len(raw)} bytes; max "
                f"{_BEACON_MAX_UPLOAD_BYTES} = "
                f"{_BEACON_MAX_UPLOAD_BYTES // (1024*1024)} MB)."
            ),
        )

    fname = file.filename or "beacondata"
    source_label = fname

    log.info("Beacon import: %s (%d bytes)", fname, len(raw))

    blueprints:     list[dict] = []
    items_count:    int = 0
    dinos_count:    int = 0
    pack_counts:    dict[str, int] = {}
    errors:         list[str] = []

    try:
        for kind, record in _iter_beacon_records(raw):
            if kind == "creature":
                normalized = _normalize_beacon_creature(record, source_label)
                if normalized:
                    dinos_count += 1
                    pack_counts[normalized["category"]] = pack_counts.get(normalized["category"], 0) + 1
                    blueprints.append(normalized)
            else:  # engram
                normalized = _normalize_beacon_engram(record, source_label)
                if normalized:
                    items_count += 1
                    pack_counts[normalized["category"]] = pack_counts.get(normalized["category"], 0) + 1
                    blueprints.append(normalized)
    except (tarfile.TarError, OSError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read .beacondata archive: {exc}",
        )

    if not blueprints:
        raise HTTPException(
            status_code=400,
            detail=(
                "Archive parsed OK but contained 0 creatures + engrams.  "
                "Are you sure this is a Complete or Per-Pack Beacon export?"
            ),
        )

    added, updated = await _upsert_blueprints(db, blueprints, default_source=source_label)

    top_packs = sorted(pack_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    summary = (
        f"{fname} -- {added} added, {updated} updated; "
        f"{len(pack_counts)} content packs (top: " +
        ", ".join(f"{n} ({c})" for n, c in top_packs) + ")"
    )
    await _bump_meta(db, source_label=summary)

    total_after = await _count_total(db)
    return SyncResult(
        success          = True,
        total_blueprints = total_after,
        items_count      = items_count,
        dinos_count      = dinos_count,
        commands_count   = 0,
        sources          = [summary],
        errors           = errors,
    )


# ── Query endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_blueprints(
    search:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type:     Optional[str] = Query(None),
    source:   Optional[str] = Query(None),
    scope:    Optional[str] = Query(
        None,
        description=(
            "Optional curated filter. 'official_plus_s' keeps only "
            "official ARK dino blueprints (vanilla + DLC + ASA) and the "
            "S- variation pack, dropping all other modded content."
        ),
    ),
    limit:    int           = Query(100, ge=1, le=1000),
    offset:   int           = Query(0, ge=0),
    db:       AsyncSession  = Depends(get_db),
):
    """
    Search and paginate the blueprint catalog.

    Filters compose with AND.  ``search`` is a substring match against
    name, blueprint path, and gfi.
    """
    where: list[str] = []
    params: dict = {}

    if search:
        where.append(
            "(LOWER(name) LIKE :s OR LOWER(blueprint) LIKE :s OR LOWER(COALESCE(gfi, '')) LIKE :s)"
        )
        params["s"] = f"%{search.lower()}%"
    if category:
        where.append("LOWER(TRIM(category)) = :cat")
        params["cat"] = category.lower().strip()
    if type:
        where.append("type = :t")
        params["t"] = type
    if source:
        where.append("source = :src")
        params["src"] = source

    where_clause = ("WHERE " + " AND ".join(where)) if where else ""

    if scope == "official_plus_s":
        # Apply the curated filter in Python after fetching, since the
        # rule combines path + name conditions.  Fetch the whole filtered
        # set first, then page in memory.
        res = await db.execute(
            text(f"SELECT {_BP_COLS} FROM ARKM_blueprints {where_clause} ORDER BY name"),
            params,
        )
        all_items = [_row_to_bp(r) for r in res.mappings().fetchall()]
        kept = [bp for bp in all_items if is_official_or_s_variant_dino(bp)]
        total = len(kept)
        return {"items": kept[offset: offset + limit], "total": total}

    # Count + page in SQL.
    count_res = await db.execute(
        text(f"SELECT COUNT(*) FROM ARKM_blueprints {where_clause}"),
        params,
    )
    total = int(count_res.scalar() or 0)

    page_params = dict(params, lim=limit, off=offset)
    rows = await db.execute(
        text(
            f"SELECT {_BP_COLS} FROM ARKM_blueprints {where_clause} "
            f"ORDER BY name LIMIT :lim OFFSET :off"
        ),
        page_params,
    )
    items = [_row_to_bp(r) for r in rows.mappings().fetchall()]
    return {"items": items, "total": total}


@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)):
    """Return all categories with their blueprint counts."""
    res = await db.execute(text(
        "SELECT COALESCE(category, 'Other') AS c, COUNT(*) AS n "
        "FROM ARKM_blueprints GROUP BY category ORDER BY c"
    ))
    return {"categories": [{"name": r[0], "count": int(r[1])} for r in res.fetchall()]}


@router.get("/types")
async def list_types(db: AsyncSession = Depends(get_db)):
    """Return all blueprint types with their counts."""
    res = await db.execute(text(
        "SELECT COALESCE(type, 'item') AS t, COUNT(*) AS n "
        "FROM ARKM_blueprints GROUP BY type ORDER BY t"
    ))
    return {"types": [{"name": r[0], "count": int(r[1])} for r in res.fetchall()]}


@router.get("/sources")
async def list_sources(db: AsyncSession = Depends(get_db)):
    """Return all distinct source labels with their blueprint counts."""
    res = await db.execute(text(
        "SELECT COALESCE(source, '') AS s, COUNT(*) AS n "
        "FROM ARKM_blueprints GROUP BY source ORDER BY n DESC"
    ))
    return {"sources": [{"name": r[0], "count": int(r[1])} for r in res.fetchall()]}


# ── Bulk deletion endpoints ───────────────────────────────────────────────────

@router.delete("")
async def clear_blueprints(db: AsyncSession = Depends(get_db)):
    """Delete every blueprint row.  Metadata blob is reset too."""
    res = await db.execute(text("DELETE FROM ARKM_blueprints"))
    removed = res.rowcount or 0
    await _save_meta(db, {"last_sync": None, "sources": [], "version": 0})
    return {"success": True, "removed": removed}


@router.delete("/non-official")
async def prune_non_official_blueprints(db: AsyncSession = Depends(get_db)):
    """
    Drop every blueprint that is NOT vanilla / DLC / ASA content.

    Admin command rows are kept (no `/Game/` path but still vanilla).
    The check that decides which rows survive runs in Python because the
    "official" rule combines path + type and isn't trivially expressible
    in SQL across our quoting variants.
    """
    res = await db.execute(text(
        "SELECT id, blueprint, type FROM ARKM_blueprints"
    ))
    rows = res.mappings().fetchall()
    before = len(rows)
    drop_ids = [
        r["id"] for r in rows
        if not is_official_blueprint({"blueprint": r["blueprint"], "type": r["type"]})
    ]
    removed = await _delete_by_ids(db, drop_ids)
    if removed:
        await _bump_meta(db, source_label=f"prune-non-official ({removed} removed)")
    return {"success": True, "removed": removed, "kept": before - removed, "before": before}


@router.delete("/by-source")
async def delete_by_source(
    source: str = Query(..., description="Exact source label to delete (case-sensitive)."),
    db: AsyncSession = Depends(get_db),
):
    """Drop every blueprint whose ``source`` column matches *source*."""
    res = await db.execute(
        text("DELETE FROM ARKM_blueprints WHERE source = :s"),
        {"s": source},
    )
    removed = res.rowcount or 0
    if removed:
        await _bump_meta(db, source_label=f"delete by-source '{source}' ({removed} removed)")
    return {"success": True, "removed": removed, "source": source}


@router.delete("/by-filter")
async def delete_by_filter(
    search:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type:     Optional[str] = Query(None),
    source:   Optional[str] = Query(None),
    db:       AsyncSession  = Depends(get_db),
):
    """
    Drop every blueprint matching the supplied filters.

    At least one filter MUST be provided -- a request with no filters
    is rejected to prevent the operator from accidentally wiping the
    table via this endpoint (use ``DELETE /blueprints`` for that).
    """
    if not any((search, category, type, source)):
        raise HTTPException(
            status_code=400,
            detail="At least one filter (search/category/type/source) is required.",
        )

    where: list[str] = []
    params: dict = {}
    if search:
        where.append(
            "(LOWER(name) LIKE :s OR LOWER(blueprint) LIKE :s OR LOWER(COALESCE(gfi, '')) LIKE :s)"
        )
        params["s"] = f"%{search.lower()}%"
    if category:
        where.append("LOWER(TRIM(category)) = :cat")
        params["cat"] = category.lower().strip()
    if type:
        where.append("type = :t")
        params["t"] = type
    if source:
        where.append("source = :src")
        params["src"] = source

    where_clause = "WHERE " + " AND ".join(where)
    res = await db.execute(
        text(f"DELETE FROM ARKM_blueprints {where_clause}"),
        params,
    )
    removed = res.rowcount or 0
    if removed:
        applied = ",".join(k for k in ("search", "category", "type", "source")
                           if locals().get(k))
        await _bump_meta(db, source_label=f"delete by-filter [{applied}] ({removed} removed)")
    return {
        "success": True,
        "removed": removed,
        "filter":  {"search": search, "category": category, "type": type, "source": source},
    }


@router.delete("/{bp_id}")
async def delete_one(bp_id: int, db: AsyncSession = Depends(get_db)):
    """Drop a single blueprint row by its integer id."""
    res = await db.execute(
        text("DELETE FROM ARKM_blueprints WHERE id = :i"),
        {"i": bp_id},
    )
    if (res.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail=f"Blueprint id={bp_id} not found.")
    return {"success": True, "id": bp_id}


async def _delete_by_ids(db: AsyncSession, ids: list[int]) -> int:
    """Delete rows whose id is in *ids*, in chunks; return rows removed."""
    if not ids:
        return 0
    BATCH = 1000
    total = 0
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        params = {f"i{j}": v for j, v in enumerate(chunk)}
        placeholders = ", ".join(f":i{j}" for j in range(len(chunk)))
        res = await db.execute(
            text(f"DELETE FROM ARKM_blueprints WHERE id IN ({placeholders})"),
            params,
        )
        total += res.rowcount or 0
    return total


# ── Category management ───────────────────────────────────────────────────────

@router.get("/categories/list")
async def list_all_categories(db: AsyncSession = Depends(get_db)):
    """Return predefined categories merged with any custom ones found in rows."""
    res = await db.execute(text(
        "SELECT DISTINCT category FROM ARKM_blueprints WHERE category IS NOT NULL"
    ))
    db_cats = {r[0] for r in res.fetchall() if r[0]}
    all_cats = list(dict.fromkeys(
        _PREDEFINED_CATEGORIES + sorted(db_cats - set(_PREDEFINED_CATEGORIES))
    ))
    return {"categories": all_cats}


@router.put("/{bp_id}/category")
async def update_blueprint_category(
    bp_id: int,
    body:  CategoryUpdate,
    db:    AsyncSession = Depends(get_db),
):
    """Update the category of a single blueprint by its id."""
    res = await db.execute(
        text("UPDATE ARKM_blueprints SET category = :c WHERE id = :i"),
        {"c": body.category, "i": bp_id},
    )
    if (res.rowcount or 0) == 0:
        raise HTTPException(status_code=404, detail=f"Blueprint id={bp_id} not found.")
    return {"success": True, "id": bp_id, "category": body.category}


@router.put("/bulk-category")
async def bulk_update_category(
    body: BulkCategoryUpdate,
    db:   AsyncSession = Depends(get_db),
):
    """Update the category of multiple blueprints at once."""
    if not body.ids:
        return {"success": True, "updated": 0, "category": body.category}

    BATCH = 1000
    updated = 0
    for i in range(0, len(body.ids), BATCH):
        chunk = body.ids[i:i + BATCH]
        params = {f"i{j}": v for j, v in enumerate(chunk)}
        params["c"] = body.category
        placeholders = ", ".join(f":i{j}" for j in range(len(chunk)))
        res = await db.execute(
            text(f"UPDATE ARKM_blueprints SET category = :c WHERE id IN ({placeholders})"),
            params,
        )
        updated += res.rowcount or 0
    return {"success": True, "updated": updated, "category": body.category}


# ── Import / Export ───────────────────────────────────────────────────────────

@router.get("/export")
async def export_blueprints(db: AsyncSession = Depends(get_db)):
    """Export the full catalog as a JSON download."""
    from fastapi.responses import JSONResponse
    res = await db.execute(text(
        f"SELECT {_BP_COLS} FROM ARKM_blueprints ORDER BY name"
    ))
    items = [_row_to_bp(r) for r in res.mappings().fetchall()]
    return JSONResponse(
        content=items,
        headers={
            "Content-Disposition": (
                f'attachment; filename="blueprints_{datetime.now(timezone.utc).strftime("%Y-%m-%d")}.json"'
            ),
        },
    )


@router.post("/import")
async def import_blueprints(
    body: ImportRequest,
    db:   AsyncSession = Depends(get_db),
):
    """
    Import blueprints from a JSON payload.

    * ``mode='merge'`` (default): UPSERT entries — existing rows are
      refreshed, new rows are appended.
    * ``mode='replace'``: wipe the table first, then insert.
    """
    incoming = body.blueprints
    if not incoming:
        raise HTTPException(status_code=400, detail="No blueprints in payload.")

    normalized: list[dict] = []
    for raw in incoming:
        bp_path = raw.get("blueprint", "")
        name = raw.get("name", "")
        if not bp_path and not name:
            continue
        if not bp_path:
            bp_path = name
        if not name:
            name = _extract_name(bp_path)
        bp_type = raw.get("type") or _classify_type(bp_path)
        normalized.append({
            "id":        raw.get("id") or _make_id(name),
            "name":      name,
            "blueprint": bp_path,
            "category":  raw.get("category", "Custom"),
            "type":      bp_type,
            "gfi":       raw.get("gfi"),
            "source":    raw.get("source", "manual-import"),
        })

    if body.mode == "replace":
        await db.execute(text("DELETE FROM ARKM_blueprints"))

    added, updated = await _upsert_blueprints(db, normalized, default_source="manual-import")
    total_after = await _count_total(db)
    label = (
        f"manual-import {body.mode} ({added} added, {updated} updated)"
    )
    await _bump_meta(db, source_label=label)
    return {
        "success": True,
        "added":   added,
        "updated": updated,
        "skipped": 0,
        "total":   total_after,
    }
