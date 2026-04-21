"""
api/routes/ARKM_rare_dinos.py — Rare-dino pool management.

Reads from and writes to the ``ARKM_rare_dinos`` and
``ARKM_rare_spawns`` tables.

Each pool entry defines which creature blueprint can spawn as a "rare" variant
and optionally overrides per-stat min/max bonus wild levels.  A value of -1
disables the override for that stat.
"""
import random
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_plugin_db
from app.core.store import get_plugin_config_sync

router = APIRouter()

# ── Stat column names shared between SELECT and INSERT ────────────────────────
_STAT_COLS = [
    "health_min", "health_max",
    "stamina_min", "stamina_max",
    "oxygen_min", "oxygen_max",
    "food_min", "food_max",
    "weight_min", "weight_max",
    "melee_min", "melee_max",
    "speed_min", "speed_max",
]
_DINO_SELECT_COLS = "id, map_name, dino_bp, enabled, " + ", ".join(_STAT_COLS) + ", extra"


# ── Schemas ────────────────────────────────────────────────────────────────────

class RareDinoCreate(BaseModel):
    """Fields required to add a creature to the rare-dino pool."""
    map_name:    str = "*"
    dino_bp:     str
    enabled:     bool = True
    health_min:  int = -1;  health_max:  int = -1
    stamina_min: int = -1;  stamina_max: int = -1
    oxygen_min:  int = -1;  oxygen_max:  int = -1
    food_min:    int = -1;  food_max:    int = -1
    weight_min:  int = -1;  weight_max:  int = -1
    melee_min:   int = -1;  melee_max:   int = -1
    speed_min:   int = -1;  speed_max:   int = -1
    extra:       Optional[str] = None


class RareDinoUpdate(BaseModel):
    """All fields are optional for partial updates."""
    map_name:    Optional[str]  = None
    dino_bp:     Optional[str]  = None
    enabled:     Optional[bool] = None
    health_min:  Optional[int]  = None;  health_max:  Optional[int] = None
    stamina_min: Optional[int]  = None;  stamina_max: Optional[int] = None
    oxygen_min:  Optional[int]  = None;  oxygen_max:  Optional[int] = None
    food_min:    Optional[int]  = None;  food_max:    Optional[int] = None
    weight_min:  Optional[int]  = None;  weight_max:  Optional[int] = None
    melee_min:   Optional[int]  = None;  melee_max:   Optional[int] = None
    speed_min:   Optional[int]  = None;  speed_max:   Optional[int] = None
    extra:       Optional[str]  = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_dino(r) -> dict:
    """
    Convert a raw database row to a serialisable dino dict.

    Also derives a human-readable ``display_name`` from the blueprint path.
    """
    col_names = _DINO_SELECT_COLS.replace(" ", "").split(",")
    d: dict = {}
    for i, col in enumerate(col_names):
        val = r[i]
        if col == "enabled":
            val = bool(val)
        d[col] = val

    # Derive a readable display name from the blueprint path
    bp = d.get("dino_bp", "")
    short = bp
    if "." in bp:
        short = bp.rsplit(".", 1)[-1].rstrip("'")
    if "/" in short:
        short = short.rsplit("/", 1)[-1]
    d["display_name"] = (
        short.replace("_Character_BP", "").replace("_", " ").replace("S-", "").strip()
    )
    return d


# ── Endpoints ─────────────────────────────────────────────────────────────────

# NOTE: routes use "" (no trailing slash) to be consistent with
# redirect_slashes=False set in main.py.

@router.get("")
async def list_rare_dinos(
    map_name: Optional[str] = Query(None),
    enabled_only: bool = Query(False),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    List all rare-dino pool entries.

    Args:
        map_name:     When provided, return only entries for this map or the
                      global wildcard ``'*'``.
        enabled_only: When True, return only enabled entries.
    """
    where: list[str] = []
    params: dict = {}

    if map_name:
        where.append("(map_name = :mn OR map_name = '*')")
        params["mn"] = map_name
    if enabled_only:
        where.append("enabled = 1")

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    result = await db.execute(
        text(
            f"SELECT {_DINO_SELECT_COLS} FROM ARKM_rare_dinos "
            f"{where_clause} ORDER BY dino_bp"
        ),
        params,
    )
    dinos = [_row_to_dino(r) for r in result.fetchall()]
    return {"dinos": dinos, "count": len(dinos)}


@router.post("")
async def create_rare_dino(body: RareDinoCreate, db: AsyncSession = Depends(get_plugin_db)):
    """Add a creature to the rare-dino pool."""
    await db.execute(
        text(
            "INSERT INTO ARKM_rare_dinos "
            "(map_name, dino_bp, enabled, "
            "health_min, health_max, stamina_min, stamina_max, "
            "oxygen_min, oxygen_max, food_min, food_max, "
            "weight_min, weight_max, melee_min, melee_max, "
            "speed_min, speed_max, extra) "
            "VALUES (:mn, :bp, :en, "
            ":h0, :h1, :s0, :s1, :o0, :o1, :f0, :f1, "
            ":w0, :w1, :m0, :m1, :sp0, :sp1, :ex)"
        ),
        {
            "mn": body.map_name, "bp": body.dino_bp, "en": int(body.enabled),
            "h0": body.health_min,  "h1": body.health_max,
            "s0": body.stamina_min, "s1": body.stamina_max,
            "o0": body.oxygen_min,  "o1": body.oxygen_max,
            "f0": body.food_min,    "f1": body.food_max,
            "w0": body.weight_min,  "w1": body.weight_max,
            "m0": body.melee_min,   "m1": body.melee_max,
            "sp0": body.speed_min,  "sp1": body.speed_max,
            "ex": body.extra,
        },
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"created": True}


@router.put("/{dino_id}")
async def update_rare_dino(
    dino_id: int,
    body: RareDinoUpdate,
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Update a rare-dino pool entry.

    Raises:
        HTTPException 400: No fields to update.
        HTTPException 404: Entry not found.
    """
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Convert boolean to integer for MariaDB TINYINT storage
    if "enabled" in updates:
        updates["enabled"] = int(updates["enabled"])

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["did"] = dino_id

    result = await db.execute(
        text(f"UPDATE ARKM_rare_dinos SET {set_clause} WHERE id = :did"),
        updates,
    )
    # Transaction committed by get_plugin_db dependency on success.

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dino not found")
    return {"updated": True, "id": dino_id}


@router.delete("/{dino_id}")
async def delete_rare_dino(dino_id: int, db: AsyncSession = Depends(get_plugin_db)):
    """
    Remove a creature from the rare-dino pool.

    Raises:
        HTTPException 404: Entry not found.
    """
    result = await db.execute(
        text("DELETE FROM ARKM_rare_dinos WHERE id = :did"),
        {"did": dino_id},
    )
    # Transaction committed by get_plugin_db dependency on success.
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dino not found")
    return {"deleted": True, "id": dino_id}


@router.post("/bulk")
async def bulk_update_dinos(
    dinos: list[RareDinoCreate],
    replace_all: bool = Query(False, description="Delete all entries before inserting"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Import or replace the entire rare-dino pool in a single operation.

    Args:
        dinos:       List of dino entries to insert.
        replace_all: When True, all existing entries are deleted first.
    """
    if replace_all:
        await db.execute(text("DELETE FROM ARKM_rare_dinos"))

    for d in dinos:
        await db.execute(
            text(
                "INSERT INTO ARKM_rare_dinos "
                "(map_name, dino_bp, enabled, "
                "health_min, health_max, stamina_min, stamina_max, "
                "oxygen_min, oxygen_max, food_min, food_max, "
                "weight_min, weight_max, melee_min, melee_max, "
                "speed_min, speed_max, extra) "
                "VALUES (:mn, :bp, :en, "
                ":h0, :h1, :s0, :s1, :o0, :o1, :f0, :f1, "
                ":w0, :w1, :m0, :m1, :sp0, :sp1, :ex)"
            ),
            {
                "mn": d.map_name, "bp": d.dino_bp, "en": int(d.enabled),
                "h0": d.health_min,  "h1": d.health_max,
                "s0": d.stamina_min, "s1": d.stamina_max,
                "o0": d.oxygen_min,  "o1": d.oxygen_max,
                "f0": d.food_min,    "f1": d.food_max,
                "w0": d.weight_min,  "w1": d.weight_max,
                "m0": d.melee_min,   "m1": d.melee_max,
                "sp0": d.speed_min,  "sp1": d.speed_max,
                "ex": d.extra,
            },
        )

    # Transaction committed by get_plugin_db dependency on success.
    return {"imported": len(dinos), "replaced": replace_all}


# ── Spawn log ──────────────────────────────────────────────────────────────────

@router.get("/spawns")
async def list_rare_spawns(
    limit: int = Query(50, le=200),
    event_type: Optional[str] = Query(
        None, description="SPAWN / KILLED / TAMED / DESPAWN / CLEAR"
    ),
    server_key: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_plugin_db),
):
    """Return recent rare-dino spawn events from the log table."""
    where: list[str] = []
    params: dict = {"lim": limit}

    if event_type:
        where.append("event_type = :et")
        params["et"] = event_type
    if server_key:
        where.append("server_key = :sk")
        params["sk"] = server_key

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    # NOTE: the actual column names in ARKM_rare_spawns are killer_eos /
    # killer_name (plugin-assigned names).  They are aliased to player_eos /
    # player_name in the response for a cleaner public API.
    result = await db.execute(
        text(
            f"SELECT id, event_type, dino_name, dino_blueprint, dino_level, "
            f"gps_lat, gps_lon, server_key, killer_eos, killer_name, event_time "
            f"FROM ARKM_rare_spawns {where_clause} "
            f"ORDER BY event_time DESC LIMIT :lim"
        ),
        params,
    )
    spawns = [
        {
            "id":             r[0],
            "event_type":     r[1],
            "dino_name":      r[2],
            "dino_blueprint": r[3],
            "dino_level":     r[4],
            "gps_lat":        r[5],
            "gps_lon":        r[6],
            "server_key":     r[7],
            "player_eos":     r[8],   # killer_eos in DB
            "player_name":    r[9],   # killer_name in DB
            "event_time":     str(r[10]) if r[10] else None,
        }
        for r in result.fetchall()
    ]
    return {"spawns": spawns}


# ── Random dino generator ────────────────────────────────────────────────────

# Stat presets: (min, max) tuples — values are bonus wild levels, max must be < 43
_STAT_PRESETS: dict[str, dict[str, tuple[int, int]]] = {
    "none":     {"health": (-1, -1), "stamina": (-1, -1), "melee": (-1, -1), "speed": (-1, -1)},
    "low":      {"health": (5, 15),  "stamina": (5, 12),  "melee": (5, 15),  "speed": (3, 8)},
    "balanced": {"health": (15, 30), "stamina": (10, 25), "melee": (15, 30), "speed": (5, 15)},
    "high":     {"health": (25, 42), "stamina": (20, 38), "melee": (25, 42), "speed": (10, 25)},
}


class GenerateRequest(BaseModel):
    """Parameters for the random dino list generator."""
    count:            int  = Field(10, ge=1, le=50, description="Number of dinos to generate")
    map_name:         str  = Field("*", description="Target map or * for all")
    stat_preset:      str  = Field("balanced", description="Preset: none, low, balanced, high, random")
    exclude_existing: bool = Field(True, description="Exclude dinos already in the pool")


def _extract_display_name(bp: str) -> str:
    """Extract a human-readable name from a blueprint path."""
    short = bp
    if "." in bp:
        short = bp.rsplit(".", 1)[-1].rstrip("'")
    if "/" in short:
        short = short.rsplit("/", 1)[-1]
    return (
        short.replace("_Character_BP", "")
             .replace("_Character_BP_ASA", "")
             .replace("_C", "")
             .replace("_", " ")
             .replace("S-", "")
             .strip()
    )


@router.post("/generate")
async def generate_random_dinos(
    body: GenerateRequest,
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Generate a random selection of dinos from the blueprint DB.

    Returns a preview list in RareDinoCreate format — does NOT auto-insert.
    Use the ``/bulk`` endpoint to actually insert the generated list.
    """
    # 1. Load blueprint DB and filter dinos
    bp_db = get_plugin_config_sync("blueprints_db")
    if not bp_db or not bp_db.get("blueprints"):
        raise HTTPException(
            status_code=404,
            detail="Blueprint database is empty. Run a sync first.",
        )

    all_dinos = [
        bp for bp in bp_db["blueprints"]
        if bp.get("type") == "dino" and bp.get("blueprint")
    ]

    if not all_dinos:
        raise HTTPException(status_code=404, detail="No dino blueprints found in database.")

    # 2. Optionally exclude dinos already in the pool
    excluded_count = 0
    if body.exclude_existing:
        result = await db.execute(text("SELECT dino_bp FROM ARKM_rare_dinos"))
        existing_bps = {r[0].lower().strip() for r in result.fetchall()}
        before = len(all_dinos)
        all_dinos = [
            d for d in all_dinos
            if d["blueprint"].lower().strip() not in existing_bps
        ]
        excluded_count = before - len(all_dinos)

    if not all_dinos:
        raise HTTPException(
            status_code=404,
            detail="All dinos in the blueprint DB are already in the pool.",
        )

    # 3. Random sample
    sample_size = min(body.count, len(all_dinos))
    selected = random.sample(all_dinos, sample_size)

    # 4. Apply stat presets
    preset_name = body.stat_preset if body.stat_preset in _STAT_PRESETS else "balanced"
    generated: list[dict] = []

    for dino in selected:
        bp_path = dino["blueprint"]

        # For "random" preset, pick a random preset per dino
        if body.stat_preset == "random":
            preset_name = random.choice(["low", "balanced", "high"])

        preset = _STAT_PRESETS.get(preset_name, _STAT_PRESETS["balanced"])

        def _stat(key: str) -> tuple[int, int]:
            mn, mx = preset.get(key, (-1, -1))
            if mn == -1:
                return -1, -1
            return mn, random.randint(mn, mx)

        h_min, h_max = _stat("health")
        s_min, s_max = _stat("stamina")
        m_min, m_max = _stat("melee")
        sp_min, sp_max = _stat("speed")

        generated.append({
            "map_name":     body.map_name,
            "dino_bp":      bp_path,
            "display_name": _extract_display_name(bp_path),
            "enabled":      True,
            "health_min":   h_min, "health_max":   h_max,
            "stamina_min":  s_min, "stamina_max":  s_max,
            "oxygen_min":   -1,    "oxygen_max":   -1,
            "food_min":     -1,    "food_max":     -1,
            "weight_min":   -1,    "weight_max":   -1,
            "melee_min":    m_min, "melee_max":    m_max,
            "speed_min":    sp_min,"speed_max":    sp_max,
            "extra":        None,
        })

    return {
        "generated":         generated,
        "count":             len(generated),
        "available_dinos":   len(all_dinos) + excluded_count,
        "excluded_existing": excluded_count,
    }
