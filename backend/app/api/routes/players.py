"""
api/routes/players.py — Player management endpoints.

Provides CRUD operations over the ARK game database (Players, ArkShopPlayers,
PermissionGroups, TribePermissions) as well as SSH-based operations for syncing
player names from .arkprofile binary files and copying character saves between maps.

Route ordering note:
    FastAPI matches routes in declaration order.  All named sub-paths
    (e.g. /stats, /sync-containers) MUST be declared before the parameterised
    /{player_id} route to prevent interception.
"""

import json
import os
import base64
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update, text

from app.db.session import get_db
from app.db.models.ark import Player, ArkShopPlayer, PermissionGroup, TribePermission
from app.core.store import get_machine_sync, get_plugin_config_sync
from app.ssh.manager import SSHManager
from app.ssh.profile_parser import scan_and_match_profiles, extract_player_data
from app.schemas.players import (
    PlayerFull, PlayerListItem, PlayerUpdate, PlayerPointsUpdate, PlayerPointsAdd,
    PermissionGroupRead, PermissionGroupUpdate, TribePermissionRead, PlayersStats,
    PlayerMapResult, PlayerMapSearchResponse, CopyCharacterRequest, CopyCharacterResponse,
)
from app.ssh.player_transfer import (
    find_player_maps_on_machine, copy_player_profile,
    find_container_in_map, resolve_map_directory,
)

router = APIRouter()


# ── Permission Groups ─────────────────────────────────────────────────────────
# These must be declared before /{player_id} to avoid route interception.

@router.get("/permissions/groups", response_model=List[PermissionGroupRead])
async def list_permission_groups(db: AsyncSession = Depends(get_db)):
    """Return all permission groups sorted by name."""
    result = await db.execute(
        select(PermissionGroup).order_by(PermissionGroup.GroupName)
    )
    groups = result.scalars().all()
    return [
        PermissionGroupRead(
            id=g.Id,
            group_name=g.GroupName,
            permissions=g.Permissions or "",
        )
        for g in groups
    ]


@router.put("/permissions/groups/{group_id}")
async def update_permission_group(
    group_id: int,
    data: PermissionGroupUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update the permissions string for a specific group."""
    result = await db.execute(
        select(PermissionGroup).where(PermissionGroup.Id == group_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Permission group not found.")
    if data.permissions is not None:
        group.Permissions = data.permissions
    return {"success": True, "group_name": group.GroupName}


# ── Aggregate statistics ──────────────────────────────────────────────────────

@router.get("/stats", response_model=PlayersStats)
async def players_stats(db: AsyncSession = Depends(get_db)):
    """
    Return aggregate statistics about registered players and the shop economy.

    Only players whose EOS_Id exists in both the Players and ArkShopPlayers
    tables are counted for shop-related statistics (no orphan records).
    """
    total = (await db.execute(select(func.count(Player.Id)))).scalar() or 0

    shop_stats = await db.execute(
        select(
            func.count(ArkShopPlayer.Id),
            func.coalesce(func.sum(ArkShopPlayer.Points), 0),
            func.coalesce(func.sum(ArkShopPlayer.TotalSpent), 0),
        ).where(ArkShopPlayer.EosId.in_(select(Player.EOS_Id)))
    )
    shop_row = shop_stats.one()
    perm_count = (await db.execute(select(func.count(PermissionGroup.Id)))).scalar() or 0

    return PlayersStats(
        total_players=total,
        players_with_points=shop_row[0] or 0,
        total_points_in_circulation=shop_row[1] or 0,
        total_spent=shop_row[2] or 0,
        permission_groups_count=perm_count,
    )


# ── Player list ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[PlayerListItem])
async def list_players(
    search: Optional[str] = Query(None, description="Search by name, EOS_Id or tribe name"),
    group: Optional[str] = Query(None, description="Filter by permission group"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    Return a paginated list of players with optional search and group filters.

    Enriches each row with tribe information and the player's last logout
    timestamp from auxiliary tracking tables (``ARKM_players``,
    ``ARKM_player_tribes``, ``ARKM_tribe_decay``).
    """
    # Base query: left-join Players with ArkShopPlayers
    query = (
        select(
            Player.Id, Player.EOS_Id, Player.Giocatore,
            Player.PermissionGroups, Player.TimedPermissionGroups,
            ArkShopPlayer.Points, ArkShopPlayer.TotalSpent,
        )
        .outerjoin(ArkShopPlayer, Player.EOS_Id == ArkShopPlayer.EosId)
    )

    if search:
        like = f"%{search}%"
        # Also match players whose tribe_name contains the search term
        tribe_eos_result = await db.execute(
            text("SELECT DISTINCT eos_id FROM ARKM_player_tribes WHERE tribe_name LIKE :q"),
            {"q": like},
        )
        tribe_eos_ids = {r[0] for r in tribe_eos_result.fetchall()}
        if tribe_eos_ids:
            query = query.where(
                or_(
                    Player.Giocatore.ilike(like),
                    Player.EOS_Id.ilike(like),
                    Player.EOS_Id.in_(tribe_eos_ids),
                )
            )
        else:
            query = query.where(
                or_(
                    Player.Giocatore.ilike(like),
                    Player.EOS_Id.ilike(like),
                )
            )

    if group:
        query = query.where(
            or_(
                Player.PermissionGroups.ilike(f"%{group}%"),
                Player.TimedPermissionGroups.ilike(f"%{group}%"),
            )
        )

    query = query.order_by(Player.Id.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.all()

    # Enrich with tribe and last-login data from auxiliary tables
    eos_ids = [r.EOS_Id for r in rows]
    login_map: dict[str, datetime] = {}
    tribe_id_map: dict[str, int] = {}      # eos_id → targeting_team
    tribe_pt_name_map: dict[str, str] = {} # eos_id → tribe_name (from player_tribes)
    tribe_name_map: dict[int, str] = {}    # targeting_team → tribe name (from decay)

    if eos_ids:
        placeholders = ",".join(f":e{i}" for i in range(len(eos_ids)))
        params = {f"e{i}": eid for i, eid in enumerate(eos_ids)}

        # Last logout from player history
        history_rows = (await db.execute(
            text(f"SELECT eos_id, last_logout FROM ARKM_players WHERE eos_id IN ({placeholders})"),
            params,
        )).fetchall()
        for hr in history_rows:
            if hr[1]:
                login_map[hr[0]] = hr[1]

        # Most recent tribe membership per player (includes tribe_name)
        tribe_rows = (await db.execute(
            text(
                f"SELECT eos_id, targeting_team, tribe_name, last_login "
                f"FROM ARKM_player_tribes WHERE eos_id IN ({placeholders}) "
                f"ORDER BY last_login DESC"
            ),
            params,
        )).fetchall()
        for tr in tribe_rows:
            if tr[0] not in tribe_id_map:
                tribe_id_map[tr[0]] = tr[1]
                # Keep the tribe name from the most recent login entry
                if tr[2] and tr[2].strip():
                    tribe_pt_name_map[tr[0]] = tr[2].strip()

        # Tribe display names from decay table (fallback for empty player_tribes names)
        tribe_ids = list(set(tribe_id_map.values()))
        if tribe_ids:
            t_placeholders = ",".join(f":t{i}" for i in range(len(tribe_ids)))
            t_params = {f"t{i}": tid for i, tid in enumerate(tribe_ids)}
            decay_rows = (await db.execute(
                text(
                    f"SELECT targeting_team, tribe_name "
                    f"FROM ARKM_tribe_decay WHERE targeting_team IN ({t_placeholders})"
                ),
                t_params,
            )).fetchall()
            for dr in decay_rows:
                if dr[1] and dr[1].strip():
                    tribe_name_map[dr[0]] = dr[1].strip()

    items = []
    for r in rows:
        # Tribe name resolution: player_tribes (freshest) -> tribe_decay (fallback)
        t_name = tribe_pt_name_map.get(r.EOS_Id)
        if not t_name and r.EOS_Id in tribe_id_map:
            t_name = tribe_name_map.get(tribe_id_map[r.EOS_Id])

        items.append(PlayerListItem(
            id=r.Id,
            eos_id=r.EOS_Id,
            name=r.Giocatore,
            permission_groups=r.PermissionGroups or "",
            timed_permission_groups=r.TimedPermissionGroups or "",
            points=r.Points,
            total_spent=r.TotalSpent,
            tribe_name=t_name,
            last_login=login_map.get(r.EOS_Id),
        ))
    return items


# ── Profile debugging helpers ─────────────────────────────────────────────────
# All sub-paths must be declared BEFORE /{player_id}.

@router.get("/debug-profile")
async def debug_arkprofile(
    machine_id: int = Query(...),
    profile_path: str = Query(..., description="Full path to the .arkprofile file"),
):
    """
    Debug endpoint: run the remote parser on a single .arkprofile and return
    full diagnostic output including the hex header and all extracted strings.
    """
    machine = get_machine_sync(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    try:
        with SSHManager(
            host=machine["hostname"],
            username=machine["ssh_user"],
            password=machine.get("ssh_password"),
            key_path=machine.get("ssh_key_path"),
            port=machine.get("ssh_port", 22),
        ) as ssh:
            stdout_ascii, _, _ = ssh.execute(
                f'strings -n 3 "{profile_path}" 2>/dev/null | head -200'
            )
            stdout_utf16, _, _ = ssh.execute(
                f'strings -e l -n 3 "{profile_path}" 2>/dev/null | head -200'
            )
            stdout_size, _, _ = ssh.execute(f'stat -c %s "{profile_path}" 2>/dev/null')
            stdout_hex, _, _ = ssh.execute(f'xxd -l 256 "{profile_path}" 2>/dev/null')
            # Use the structured parser for the name extraction result
            player_data = extract_player_data(ssh, profile_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}") from exc

    return {
        "path": profile_path,
        "file_size": stdout_size.strip() or None,
        "extracted_name": player_data.get("name"),
        "extracted_eos_id": player_data.get("eos_id"),
        "strings_ascii": stdout_ascii.strip().splitlines() if stdout_ascii else [],
        "strings_utf16": stdout_utf16.strip().splitlines() if stdout_utf16 else [],
        "hex_header": stdout_hex.strip() or None,
    }


@router.get("/sync-test")
async def test_profile_extraction(
    machine_id: int = Query(...),
    container_name: str = Query(...),
    limit: int = Query(3, description="Number of profiles to test"),
):
    """
    Debug endpoint: run the remote parser on the first *limit* .arkprofile
    files in a container and return the raw extraction results.
    """
    machine = get_machine_sync(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    containers_map = get_plugin_config_sync("containers_map")
    saved_arks: Optional[str] = None
    if containers_map:
        for mid, mdata in containers_map.get("machines", {}).items():
            if int(mid) != machine_id:
                continue
            for container in mdata.get("containers", []):
                if container["name"] == container_name:
                    saved_arks = container.get("paths", {}).get("saved_arks")
                    break

    if not saved_arks:
        raise HTTPException(
            status_code=404,
            detail="SavedArks path not found for this container. Run a scan first.",
        )

    try:
        with SSHManager(
            host=machine["hostname"],
            username=machine["ssh_user"],
            password=machine.get("ssh_password"),
            key_path=machine.get("ssh_key_path"),
            port=machine.get("ssh_port", 22),
        ) as ssh:
            # Locate the first N .arkprofile files
            stdout, _, _ = ssh.execute(
                f'find "{saved_arks}" -maxdepth 3 -name "*.arkprofile" -type f '
                f'2>/dev/null | head -{limit}'
            )
            if not stdout.strip():
                return {"error": "No .arkprofile files found.", "path": saved_arks}

            # Upload the parser script once
            script_path = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "..", "ssh", "ark_parse_profile.py")
            )
            with open(script_path, "r") as fh:
                script_content = fh.read()
            script_b64 = base64.b64encode(script_content.encode()).decode()
            ssh.execute(f'echo "{script_b64}" | base64 -d > /tmp/_ark_parse.py')

            profiles = [p.strip() for p in stdout.strip().splitlines() if p.strip()]
            results = []
            for prof_path in profiles:
                filename = prof_path.split("/")[-1]
                file_id = filename.replace(".arkprofile", "")
                out, err, code = ssh.execute(f'python3 /tmp/_ark_parse.py "{prof_path}" 2>&1')
                try:
                    parsed = json.loads(out.strip())
                except (json.JSONDecodeError, ValueError):
                    parsed = {"raw_output": out[:500], "stderr": err[:500], "code": code}
                results.append({"file": filename, "file_id": file_id, **parsed})

            ssh.execute("rm -f /tmp/_ark_parse.py")
            return {
                "saved_arks": saved_arks,
                "profiles_tested": len(results),
                "results": results,
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}") from exc


@router.get("/sync-containers")
async def list_sync_containers():
    """
    Return all containers that have a known SavedArks path and are therefore
    eligible for the player-name sync operation.
    """
    containers_map = get_plugin_config_sync("containers_map")
    if not containers_map or not containers_map.get("machines"):
        return {"containers": []}

    eligible = []
    for mid, mdata in containers_map["machines"].items():
        for container in mdata.get("containers", []):
            saved_arks_path = container.get("paths", {}).get("saved_arks")
            if saved_arks_path:
                eligible.append({
                    "machine_id": int(mid),
                    "machine_name": mdata.get("machine_name", ""),
                    "container_name": container["name"],
                    "map_name": container.get("map_name"),
                    "server_name": container.get("server_name"),
                    "saved_arks_path": saved_arks_path,
                    "profile_count": container.get("profile_count", 0),
                })

    return {"containers": eligible}


# ── Player map search and character copy ──────────────────────────────────────

@router.get("/find-maps")
async def find_player_maps(
    eos_id: str = Query(..., description="EOS_Id of the player to search for"),
    machine_id: Optional[int] = Query(None, description="Restrict search to a single machine"),
    debug: bool = Query(False, description="Include diagnostic information in the response"),
):
    """
    Search all scanned containers for a player's .arkprofile file.

    For each container that has a SavedArks path, the endpoint connects via SSH
    and checks whether ``{eos_id}.arkprofile`` exists in each map subdirectory.
    When found, the character name is extracted from the binary file.

    Returns a list of :class:`~app.schemas.players.PlayerMapResult` entries
    describing every map where the player's profile was located.
    """
    containers_map = get_plugin_config_sync("containers_map")
    if not containers_map or not containers_map.get("machines"):
        raise HTTPException(
            status_code=404,
            detail="No containers scanned. Run a container scan first.",
        )

    all_maps: List[dict] = []
    all_debug: List[dict] = []
    errors: List[str] = []

    for mid, mdata in containers_map["machines"].items():
        if machine_id is not None and int(mid) != machine_id:
            continue

        containers = mdata.get("containers", [])
        if not any(c.get("paths", {}).get("saved_arks") for c in containers):
            continue

        machine = get_machine_sync(int(mid))
        if not machine:
            errors.append(f"Machine {mid} not found in database.")
            continue

        try:
            with SSHManager(
                host=machine["hostname"],
                username=machine["ssh_user"],
                password=machine.get("ssh_password"),
                key_path=machine.get("ssh_key_path"),
                port=machine.get("ssh_port", 22),
            ) as ssh:
                found, dbg = find_player_maps_on_machine(
                    ssh=ssh,
                    eos_id=eos_id,
                    machine_id=int(mid),
                    machine_name=mdata.get("machine_name", ""),
                    hostname=mdata.get("hostname", ""),
                    containers=containers,
                    debug=debug,
                )
                all_maps.extend(found)
                all_debug.extend(dbg)
        except Exception as exc:
            errors.append(f"SSH {machine['hostname']}: {exc}")

    response: dict = {
        "eos_id": eos_id,
        "maps": all_maps,
        "total": len(all_maps),
        "errors": errors,
    }
    if debug:
        response["debug"] = all_debug
    return response


@router.post("/copy-character", response_model=CopyCharacterResponse)
async def copy_character(data: CopyCharacterRequest):
    """
    Copy a player's .arkprofile from a source map to a destination map.

    Supports cross-machine transfers (different SSH connections for source and
    destination). Automatically creates a timestamped backup of the destination
    file when *backup* is True (default).

    The profile is transferred as raw bytes via base64 to avoid binary corruption
    in the SSH stream.
    """
    containers_map = get_plugin_config_sync("containers_map")
    if not containers_map or not containers_map.get("machines"):
        raise HTTPException(status_code=404, detail="No containers scanned.")

    source_machine = get_machine_sync(data.source_machine_id)
    if not source_machine:
        raise HTTPException(status_code=404, detail="Source machine not found.")

    dest_machine = get_machine_sync(data.dest_machine_id)
    if not dest_machine:
        raise HTTPException(status_code=404, detail="Destination machine not found.")

    _, dest_container = find_container_in_map(
        containers_map, data.dest_machine_id, data.dest_container
    )
    if not dest_container:
        raise HTTPException(
            status_code=404,
            detail=f"Destination container '{data.dest_container}' not found. Run a scan first.",
        )

    same_machine = data.source_machine_id == data.dest_machine_id

    try:
        source_ssh = SSHManager(
            host=source_machine["hostname"],
            username=source_machine["ssh_user"],
            password=source_machine.get("ssh_password"),
            key_path=source_machine.get("ssh_key_path"),
            port=source_machine.get("ssh_port", 22),
        )
        source_ssh.connect()

        dest_ssh = source_ssh if same_machine else SSHManager(
            host=dest_machine["hostname"],
            username=dest_machine["ssh_user"],
            password=dest_machine.get("ssh_password"),
            key_path=dest_machine.get("ssh_key_path"),
            port=dest_machine.get("ssh_port", 22),
        )
        if not same_machine:
            dest_ssh.connect()

        try:
            dest_map_dir = resolve_map_directory(dest_ssh, dest_container, data.dest_map_name)
            if not dest_map_dir:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Destination map '{data.dest_map_name}' not found "
                        f"in container '{data.dest_container}'."
                    ),
                )

            copy_result = copy_player_profile(
                source_ssh=source_ssh,
                dest_ssh=dest_ssh,
                source_profile_path=data.source_profile_path,
                dest_map_dir=dest_map_dir,
                backup=data.backup,
            )
            return CopyCharacterResponse(**copy_result)

        finally:
            if not same_machine:
                dest_ssh.disconnect()
            source_ssh.disconnect()

    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Copy failed: {exc}") from exc


# ── Tribe permissions ─────────────────────────────────────────────────────────

@router.get("/tribes", response_model=List[TribePermissionRead])
async def list_tribe_permissions(db: AsyncSession = Depends(get_db)):
    """Return all tribe permission entries ordered by tribe ID."""
    result = await db.execute(
        select(TribePermission).order_by(TribePermission.TribeId)
    )
    tribes = result.scalars().all()
    return [
        TribePermissionRead(
            id=t.Id,
            tribe_id=t.TribeId,
            permission_groups=t.PermissionGroups or "",
            timed_permission_groups=t.TimedPermissionGroups or "",
        )
        for t in tribes
    ]


# ── Single player detail ──────────────────────────────────────────────────────
# IMPORTANT: this parameterised route must remain AFTER all named sub-paths.

@router.get("/{player_id}", response_model=PlayerFull)
async def get_player(player_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return the full profile of a single player by database ID.

    Joins Players with ArkShopPlayers and enriches the response with tribe
    information and last-login timestamp from the auxiliary tracking tables.
    """
    result = await db.execute(select(Player).where(Player.Id == player_id))
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")

    # Shop data
    shop_result = await db.execute(
        select(ArkShopPlayer).where(ArkShopPlayer.EosId == player.EOS_Id)
    )
    shop = shop_result.scalar_one_or_none()

    # Last logout from player history
    history_result = await db.execute(
        text("SELECT last_logout FROM ARKM_players WHERE eos_id = :eos LIMIT 1"),
        {"eos": player.EOS_Id},
    )
    history_row = history_result.fetchone()

    # Most recent tribe membership (includes tribe_name)
    tribe_result = await db.execute(
        text(
            "SELECT targeting_team, tribe_name, last_login FROM ARKM_player_tribes "
            "WHERE eos_id = :eos ORDER BY last_login DESC LIMIT 1"
        ),
        {"eos": player.EOS_Id},
    )
    tribe_row = tribe_result.fetchone()

    # Tribe name resolution: player_tribes (freshest) -> tribe_decay (fallback)
    tribe_name: Optional[str] = None
    tribe_id: Optional[int] = None
    if tribe_row:
        tribe_id = tribe_row[0]
        # Primary source: tribe_name directly from player_tribes
        if tribe_row[1] and tribe_row[1].strip():
            tribe_name = tribe_row[1].strip()
        else:
            # Fallback: tribe_name from the decay table
            decay_result = await db.execute(
                text("SELECT tribe_name FROM ARKM_tribe_decay WHERE targeting_team = :tid LIMIT 1"),
                {"tid": tribe_id},
            )
            decay_row = decay_result.fetchone()
            if decay_row and decay_row[0] and decay_row[0].strip():
                tribe_name = decay_row[0].strip()

    # Last login: prefer player_history, fall back to tribe login timestamp
    last_login = None
    if history_row and history_row[0]:
        last_login = history_row[0]
    elif tribe_row and tribe_row[2]:
        last_login = tribe_row[2]

    return PlayerFull(
        id=player.Id,
        eos_id=player.EOS_Id,
        name=player.Giocatore,
        permission_groups=player.PermissionGroups or "",
        timed_permission_groups=player.TimedPermissionGroups or "",
        points=shop.Points if shop else None,
        total_spent=shop.TotalSpent if shop else None,
        kits=shop.Kits if shop else None,
        tribe_name=tribe_name,
        tribe_id=tribe_id,
        last_login=last_login,
    )


# ── Player update operations ──────────────────────────────────────────────────

@router.put("/{player_id}")
async def update_player(
    player_id: int,
    data: PlayerUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update name or permission strings for a player."""
    result = await db.execute(select(Player).where(Player.Id == player_id))
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")

    updates = data.model_dump(exclude_unset=True)
    if "name" in updates:
        player.Giocatore = updates["name"]
    if "permission_groups" in updates:
        player.PermissionGroups = updates["permission_groups"]
    if "timed_permission_groups" in updates:
        player.TimedPermissionGroups = updates["timed_permission_groups"]

    return {"success": True, "message": f"Player {player.EOS_Id} updated."}


@router.put("/{player_id}/points")
async def set_player_points(
    player_id: int,
    data: PlayerPointsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Set a player's shop points to an absolute value.

    Creates an ArkShopPlayers record if one does not yet exist for this player.
    """
    result = await db.execute(select(Player).where(Player.Id == player_id))
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")

    shop_result = await db.execute(
        select(ArkShopPlayer).where(ArkShopPlayer.EosId == player.EOS_Id)
    )
    shop = shop_result.scalar_one_or_none()
    if shop:
        shop.Points = data.points
    else:
        db.add(ArkShopPlayer(EosId=player.EOS_Id, Points=data.points, Kits="", TotalSpent=0))

    return {"success": True, "points": data.points, "eos_id": player.EOS_Id}


@router.post("/{player_id}/points/add")
async def add_player_points(
    player_id: int,
    data: PlayerPointsAdd,
    db: AsyncSession = Depends(get_db),
):
    """
    Add or subtract shop points from a player (relative delta).

    The resulting balance is clamped to a minimum of zero to prevent negative
    point totals.

    Args (body):
        amount: Positive to add, negative to subtract.
    """
    result = await db.execute(select(Player).where(Player.Id == player_id))
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")

    shop_result = await db.execute(
        select(ArkShopPlayer).where(ArkShopPlayer.EosId == player.EOS_Id)
    )
    shop = shop_result.scalar_one_or_none()
    if shop:
        new_points = max(0, shop.Points + data.amount)
        shop.Points = new_points
    else:
        new_points = max(0, data.amount)
        db.add(ArkShopPlayer(EosId=player.EOS_Id, Points=new_points, Kits="", TotalSpent=0))

    return {"success": True, "points": new_points, "delta": data.amount, "eos_id": player.EOS_Id}


# ── Name synchronisation from .arkprofile files ───────────────────────────────

@router.post("/sync-names")
async def sync_player_names_from_profiles(
    machine_id: Optional[int] = Query(None, description="Restrict sync to a single machine"),
    container_name: Optional[str] = Query(None, description="Restrict sync to a single container"),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan .arkprofile binary files on remote servers, extract player names,
    and update the ``Giocatore`` column in the Players table.

    Matching strategy (tried in order):
      1. EOS_Id extracted from the binary file content.
      2. The .arkprofile filename (which equals the internal ARK player GUID).
      3. Substring match between the extracted EOS_Id and the DB EOS_Id.

    Returns a summary with counts of scanned profiles, matched players, and
    updated rows, plus a list of unmatched profiles for debugging.
    """
    containers_map = get_plugin_config_sync("containers_map")
    if not containers_map or not containers_map.get("machines"):
        raise HTTPException(
            status_code=404,
            detail="No containers scanned. Run a container scan first.",
        )

    # Build the list of SavedArks paths to scan, grouped by machine
    machines_to_scan: dict[int, list[str]] = {}
    for mid, mdata in containers_map["machines"].items():
        if machine_id is not None and int(mid) != machine_id:
            continue
        saved_paths = [
            container.get("paths", {}).get("saved_arks")
            for container in mdata.get("containers", [])
            if (not container_name or container["name"] == container_name)
            and container.get("paths", {}).get("saved_arks")
        ]
        if saved_paths:
            machines_to_scan[int(mid)] = saved_paths

    if not machines_to_scan:
        raise HTTPException(
            status_code=404,
            detail="No SavedArks paths found in the scanned containers.",
        )

    # Load the full EOS_Id → player_id mapping once to avoid per-profile queries
    all_players_result = await db.execute(
        select(Player.Id, Player.EOS_Id, Player.Giocatore)
    )
    eos_map: dict[str, dict] = {
        p.EOS_Id.lower(): {"id": p.Id, "eos_id": p.EOS_Id, "current_name": p.Giocatore}
        for p in all_players_result.all()
    }

    total_profiles = 0
    matched = 0
    updated = 0
    not_matched: list[dict] = []
    errors: list[str] = []

    for mid, saved_paths in machines_to_scan.items():
        machine = get_machine_sync(mid)
        if not machine:
            errors.append(f"Machine {mid} not found in database.")
            continue

        try:
            with SSHManager(
                host=machine["hostname"],
                username=machine["ssh_user"],
                password=machine.get("ssh_password"),
                key_path=machine.get("ssh_key_path"),
                port=machine.get("ssh_port", 22),
            ) as ssh:
                profiles = scan_and_match_profiles(ssh, saved_paths)
        except Exception as exc:
            errors.append(f"SSH {machine['hostname']}: {exc}")
            continue

        for prof in profiles:
            total_profiles += 1
            player_name = prof.get("player_name")
            profile_eos_id: Optional[str] = prof.get("eos_id")
            file_id_lower = prof["file_id"].lower()

            if not player_name:
                continue

            # Match 1: EOS_Id extracted from the binary file
            player_data = eos_map.get(profile_eos_id.lower()) if profile_eos_id else None

            # Match 2: filename as EOS_Id fallback
            if not player_data:
                player_data = eos_map.get(file_id_lower)

            # Match 3: substring containment match
            if not player_data and profile_eos_id:
                eos_lower = profile_eos_id.lower()
                for db_eos, pdata in eos_map.items():
                    if eos_lower in db_eos or db_eos in eos_lower:
                        player_data = pdata
                        break

            if not player_data:
                not_matched.append({
                    "file_id": prof["file_id"],
                    "eos_id": profile_eos_id,
                    "player_name": player_name,
                    "source": prof.get("source_path", ""),
                })
                continue

            matched += 1
            if player_data["current_name"] != player_name:
                await db.execute(
                    update(Player)
                    .where(Player.Id == player_data["id"])
                    .values(Giocatore=player_name)
                )
                updated += 1

    await db.commit()

    return {
        "success": True,
        "total_profiles_scanned": total_profiles,
        "matched": matched,
        "updated": updated,
        "not_matched": not_matched[:20],
        "not_matched_total": len(not_matched),
        "errors": errors,
    }
