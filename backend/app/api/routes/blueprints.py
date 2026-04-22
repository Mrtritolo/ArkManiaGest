"""
api/routes/blueprints.py — ARK blueprint database.

Downloads blueprint data from multiple public sources, normalises entries, and
stores them in the application settings table for offline search.

Data sources:
  1. Dododex GitHub bp.json       — creature/dino blueprints
  2. Dododex GitHub commands.json — admin console commands
  3. ARK Wiki (ark.wiki.gg)       — complete item database (19 categories)
"""
import asyncio
import json
import re
import logging
from typing import Optional, List
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.store import get_plugin_config_sync, save_plugin_config_sync

router = APIRouter()
log = logging.getLogger("arkmaniagest.blueprints")

_PLUGIN_NAME = "blueprints_db"
_TIMEOUT_SECS = 30

# Upstream data sources
_DODODEX_BP_URL       = "https://raw.githubusercontent.com/dododex/dododex.github.io/master/bp.json"
_DODODEX_COMMANDS_URL = "https://raw.githubusercontent.com/dododex/dododex.github.io/master/commands.json"

# ARK Wiki API — item tables split across 19 category subpages
_WIKI_API_BASE = "https://ark.wiki.gg/api.php"
_WIKI_ITEM_CATEGORIES = [
    "Resources", "Tools", "Armor", "Saddles", "Structures", "Vehicles",
    "Dye", "Consumables", "Recipes", "Eggs", "Farming", "Seeds",
    "Weapons", "Ammunition", "Skins", "Chibi Pets", "Artifacts", "Trophy",
]


# ── In-process storage helpers ────────────────────────────────────────────────

def _get_db() -> dict:
    config = get_plugin_config_sync(_PLUGIN_NAME)
    return config if config else {
        "blueprints": [], "last_sync": None, "sources": [], "version": 0
    }


def _save_db(db: dict) -> None:
    save_plugin_config_sync(_PLUGIN_NAME, db)


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
    # Exact match
    if lower in _DINO_NAME_MAP:
        return _DINO_NAME_MAP[lower]
    if no_under in _DINO_NAME_MAP:
        return _DINO_NAME_MAP[no_under]
    # Longest match first to avoid prefix collisions
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
    """Return an improved display name for a blueprint."""
    if not name:
        return _extract_name(blueprint)
    improved = _clean_dino_name(name)
    return improved if improved != name else name


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
    """Convert a display name to a safe slug for use as an ID."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _parse_wiki_item_table(wikitext: str, category: str) -> list[dict]:
    """
    Parse a MediaWiki table from the ARK Wiki Item_IDs subpages.

    Each row has pipe-separated cells.  The expected columns are:
      Name | Category | Stack Size | Item ID | Class Name | Blueprint Path

    Returns a list of blueprint dicts ready for the local database.
    """
    results: list[dict] = []
    in_table = False
    cells: list[str] = []

    for raw_line in wikitext.split("\n"):
        line = raw_line.strip()

        # Table start / header
        if line.startswith("{|"):
            in_table = True
            continue
        if line.startswith("|}"):
            in_table = False
            continue
        if not in_table:
            continue
        # Skip header row and sort markers
        if line.startswith("!") or line.startswith("|-"):
            if cells:
                _flush_wiki_row(cells, category, results)
                cells = []
            continue

        # Cell lines: "| value" or "| value || value2 || value3"
        if line.startswith("|"):
            parts = line[1:].split("||")
            for p in parts:
                cells.append(p.strip())

    # Flush last row
    if cells:
        _flush_wiki_row(cells, category, results)

    return results


def _flush_wiki_row(cells: list[str], category: str, out: list[dict]) -> None:
    """Process a single wiki table row and append to *out* if valid."""
    if len(cells) < 6:
        return

    raw_name = _strip_wiki_markup(cells[0])
    class_name = _strip_wiki_markup(cells[4]).strip()
    bp_path = _strip_wiki_markup(cells[5]).strip()

    if not bp_path or not raw_name:
        return

    # Normalize blueprint path
    if not bp_path.startswith("/Game/") and not bp_path.startswith("Blueprint'"):
        bp_path = f"/Game/{bp_path}"

    # Map wiki category to our type system
    type_map: dict[str, str] = {
        "Resources": "resource", "Tools": "item", "Armor": "armor",
        "Saddles": "armor", "Structures": "structure", "Vehicles": "structure",
        "Dye": "consumable", "Consumables": "consumable", "Recipes": "consumable",
        "Eggs": "consumable", "Farming": "resource", "Seeds": "resource",
        "Weapons": "weapon", "Ammunition": "weapon", "Skins": "cosmetic",
        "Chibi Pets": "cosmetic", "Artifacts": "artifact", "Trophy": "artifact",
    }
    bp_type = type_map.get(category, "item")

    gfi_cmd = f"GFI {class_name} 1 0 false" if class_name else None

    out.append({
        "id":        _make_id(raw_name),
        "name":      raw_name,
        "blueprint": bp_path,
        "category":  category,
        "type":      bp_type,
        "gfi":       gfi_cmd,
        "source":    "ark-wiki",
    })


def _strip_wiki_markup(text: str) -> str:
    """Remove common MediaWiki markup from a cell value."""
    # Remove [[File:...]] and [[Image:...]]
    text = re.sub(r"\[\[(File|Image):[^\]]*\]\]", "", text)
    # [[Page|Display]] → Display
    text = re.sub(r"\[\[[^\]]*\|([^\]]*)\]\]", r"\1", text)
    # [[Simple link]] → Simple link
    text = re.sub(r"\[\[([^\]]*)\]\]", r"\1", text)
    # {{Template}} → empty
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    # <br>, <ref>, etc.
    text = re.sub(r"<[^>]*>", "", text)
    # '''bold''' and ''italic''
    text = text.replace("'''", "").replace("''", "")
    return text.strip()


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
    ids:      List[str]
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
async def blueprint_status():
    """Return metadata about the local blueprint database."""
    db = _get_db()
    return {
        "has_data":         len(db.get("blueprints", [])) > 0,
        "total_blueprints": len(db.get("blueprints", [])),
        "last_sync":        db.get("last_sync"),
        "sources":          db.get("sources", []),
        "version":          db.get("version", 0),
    }


@router.post("/sync", response_model=SyncResult)
async def sync_blueprints():
    """
    Wipe the local blueprint DB and refill it from Dododex.

    The sync is deliberately destructive: the previous contents are
    discarded and the result of the Dododex fetch becomes the new
    canonical dataset.  This keeps the catalog in lockstep with
    Dododex's upstream -- entries they removed disappear locally, and
    there's no chance of stale rows piling up across repeated syncs.

    We used to ALSO scrape the ARK Wiki (18 pages, rate-limited, prone
    to 429) -- that path has been dropped: Dododex already covers the
    creature + item + command dataset, and the wiki scrape added ~60s
    of latency, 18 extra external dependencies, and the occasional
    rate-limit failure for little gain.  If wiki coverage is ever
    needed again the removed helpers (``_parse_wiki_item_table`` et al.)
    still live in this module but are intentionally not called.
    """
    blueprints:     list[dict] = []
    sources:        list[str]  = []
    errors:         list[str]  = []
    items_count    = 0
    dinos_count    = 0
    commands_count = 0

    # Explicit wipe up front.  _save_db at the tail already replaces the
    # whole blob, but operators reading the log expect to see the reset
    # moment so they can tell a "nothing changed" run from a "wiped and
    # refilled" one.
    prev_total = len(_get_db().get("blueprints", []))
    log.info("Blueprint sync: wiping %d previous entries", prev_total)

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECS, follow_redirects=True) as client:

        # ── 1. bp.json (creatures/dinos from Dododex GitHub) ────────────────
        # Keys: "l" = label, "bp" = blueprint path, "t" = category,
        #        "id" = class name, "cid" = creature id
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
                    # Ensure blueprint has the /Game/ prefix
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
                    # Build a GFI command from the class name
                    gfi_cmd = f"GFI {class_id} 1 0 false" if class_id else None
                    blueprints.append({
                        "id":        item.get("cid") or _make_id(name),
                        "name":      name,
                        "blueprint": bp_path,
                        "category":  category,
                        "type":      bp_type,
                        "gfi":       gfi_cmd,
                        "source":    "dododex-github",
                    })
                added = len(blueprints) - bp_before
                sources.append(f"bp.json ({added} creatures)")
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
                            "source":    "dododex-github",
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
                        "source":      "dododex-github",
                        "description": str(desc) if desc else None,
                    })

                sources.append(f"commands.json ({commands_count} commands)")
            else:
                errors.append(f"commands.json: HTTP {resp.status_code}")
        except Exception as exc:
            errors.append(f"commands.json: {type(exc).__name__}: {exc}")

    # ARK Wiki scrape used to live here -- removed on the switch to
    # "Dododex only".  See the sync_blueprints docstring for the
    # rationale; the parser helpers below this module are kept in case
    # coverage has to grow back.

    # Deduplicate by blueprint path (case-insensitive)
    seen: dict[str, bool] = {}
    unique = []
    for bp in blueprints:
        key = bp["blueprint"].lower().strip()
        if key and key not in seen:
            seen[key] = True
            unique.append(bp)

    _save_db({
        "blueprints": unique,
        "last_sync":  datetime.now(timezone.utc).isoformat(),
        "sources":    sources,
        "version":    _get_db().get("version", 0) + 1,
    })

    return SyncResult(
        success          = len(unique) > 0,
        total_blueprints = len(unique),
        items_count      = items_count,
        dinos_count      = dinos_count,
        commands_count   = commands_count,
        sources          = sources,
        errors           = errors,
    )


# ── Query endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_blueprints(
    search:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type:     Optional[str] = Query(None),
    limit:    int           = Query(100, ge=1, le=1000),
    offset:   int           = Query(0, ge=0),
):
    """
    Search and paginate the local blueprint database.

    Args:
        search:   Substring match against name, blueprint path, or GFI.
        category: Exact category filter (case-insensitive).
        type:     Exact type filter (e.g. ``dino``, ``weapon``).
        limit:    Page size (1–1000).
        offset:   Pagination offset.
    """
    items = _get_db().get("blueprints", [])

    if search:
        s = search.lower()
        items = [
            i for i in items
            if s in i.get("name", "").lower()
            or s in i.get("blueprint", "").lower()
            or s in (i.get("gfi") or "").lower()
        ]

    if category:
        cat_lower = category.lower().strip()
        items = [
            i for i in items
            if i.get("category", "").lower().strip() == cat_lower
        ]

    if type:
        items = [i for i in items if i.get("type", "") == type]

    total = len(items)
    return {"items": items[offset: offset + limit], "total": total}


@router.get("/categories")
async def list_categories():
    """Return all categories with their blueprint counts."""
    cats: dict[str, int] = {}
    for bp in _get_db().get("blueprints", []):
        cat = bp.get("category", "Other")
        cats[cat] = cats.get(cat, 0) + 1
    return {"categories": [{"name": k, "count": v} for k, v in sorted(cats.items())]}


@router.get("/types")
async def list_types():
    """Return all blueprint types with their counts."""
    types: dict[str, int] = {}
    for bp in _get_db().get("blueprints", []):
        t = bp.get("type", "item")
        types[t] = types.get(t, 0) + 1
    return {"types": [{"name": k, "count": v} for k, v in sorted(types.items())]}


@router.delete("")
async def clear_blueprints():
    """Delete the entire local blueprint database."""
    save_plugin_config_sync(_PLUGIN_NAME, {})
    return {"success": True}


# ── Category management ───────────────────────────────────────────────────────

@router.get("/categories/list")
async def list_all_categories():
    """Return predefined categories merged with any custom ones from the DB."""
    db_cats = {
        bp.get("category", "")
        for bp in _get_db().get("blueprints", [])
        if bp.get("category")
    }
    all_cats = list(dict.fromkeys(_PREDEFINED_CATEGORIES + sorted(db_cats - set(_PREDEFINED_CATEGORIES))))
    return {"categories": all_cats}


@router.put("/{bp_id}/category")
async def update_blueprint_category(bp_id: str, body: CategoryUpdate):
    """Update the category of a single blueprint by its ID."""
    db = _get_db()
    blueprints = db.get("blueprints", [])
    updated = False
    for bp in blueprints:
        if bp.get("id") == bp_id:
            bp["category"] = body.category
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail=f"Blueprint '{bp_id}' not found.")
    db["blueprints"] = blueprints
    _save_db(db)
    return {"success": True, "id": bp_id, "category": body.category}


@router.put("/bulk-category")
async def bulk_update_category(body: BulkCategoryUpdate):
    """Update the category of multiple blueprints at once."""
    db = _get_db()
    blueprints = db.get("blueprints", [])
    ids_set = set(body.ids)
    count = 0
    for bp in blueprints:
        if bp.get("id") in ids_set:
            bp["category"] = body.category
            count += 1
    db["blueprints"] = blueprints
    _save_db(db)
    return {"success": True, "updated": count, "category": body.category}


# ── Import / Export ───────────────────────────────────────────────────────────

@router.get("/export")
async def export_blueprints():
    """Export the full blueprint database as a JSON download."""
    from fastapi.responses import JSONResponse
    db = _get_db()
    blueprints = db.get("blueprints", [])
    return JSONResponse(
        content=blueprints,
        headers={
            "Content-Disposition": (
                f'attachment; filename="blueprints_{datetime.now(timezone.utc).strftime("%Y-%m-%d")}.json"'
            ),
        },
    )


@router.post("/import")
async def import_blueprints(body: ImportRequest):
    """
    Import blueprints from a JSON payload.

    Modes:
      - ``merge``:   add new entries and update existing ones (matched by blueprint path)
      - ``replace``: wipe the DB and replace with the imported data

    Each entry must have at least ``name`` and ``blueprint`` fields.
    Missing fields are filled with sensible defaults.
    """
    incoming = body.blueprints
    if not incoming:
        raise HTTPException(status_code=400, detail="No blueprints in payload.")

    # Validate and normalize
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
        # Auto-detect type from blueprint path
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
        _save_db({
            "blueprints": normalized,
            "last_sync":  datetime.now(timezone.utc).isoformat(),
            "sources":    [f"manual import ({len(normalized)} entries)"],
            "version":    _get_db().get("version", 0) + 1,
        })
        return {"success": True, "added": len(normalized), "updated": 0, "skipped": 0, "total": len(normalized)}

    # Merge mode — deduplicate by blueprint path
    db = _get_db()
    existing = db.get("blueprints", [])
    by_bp: dict[str, int] = {
        bp["blueprint"].lower().strip(): i
        for i, bp in enumerate(existing)
    }

    added = 0
    updated = 0
    skipped = 0
    for entry in normalized:
        key = entry["blueprint"].lower().strip()
        if key in by_bp:
            idx = by_bp[key]
            # Update existing — keep source, update other fields
            for field in ("name", "category", "type", "gfi"):
                if entry.get(field):
                    existing[idx][field] = entry[field]
            updated += 1
        else:
            existing.append(entry)
            by_bp[key] = len(existing) - 1
            added += 1

    db["blueprints"] = existing
    db["version"] = db.get("version", 0) + 1
    _save_db(db)
    return {"success": True, "added": added, "updated": updated, "skipped": skipped, "total": len(existing)}
