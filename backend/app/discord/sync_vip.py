"""
app.discord.sync_vip — manual VIP-role reconciliation engine (Phase 4).

Source of truth: the panel/plugin DB (the operator's call --
"VIP vince il dato su db gestionale").  We READ the VIP status of
every linked player and PUSH it to Discord.  We never write back to
ARK from this code.

A player is considered VIP when EITHER:

  - "VIP" appears in `Players.PermissionGroups`  (permanent), OR
  - An entry `flag;timestamp;VIP` is present in
    `Players.TimedPermissionGroups` AND the timestamp is in the future
    (active timed grant)

The sync compares this for each (discord_user_id, eos_id) pair in the
panel's discord_accounts table where eos_id IS NOT NULL, then:

  - If should-have-VIP and Discord-doesn't -> add the role.
  - If shouldn't-have-VIP and Discord-has -> remove the role.
  - Otherwise: skip.

Members in the Discord guild who have the VIP role but are NOT in our
discord_accounts (or have no eos_id link) are reported in
`unmapped_with_vip` -- we never strip a role from someone we don't own
the mapping for.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.discord import client as dc_client


log = logging.getLogger("arkmaniagest.discord.sync_vip")

# Permission-group name that the plugin uses for VIP.  Hard-coded for
# Phase 4; future Phase-5 work surfaces it as a config row.
_VIP_GROUP_NAME = "VIP"


# ── Result envelope ──────────────────────────────────────────────────────────

@dataclass
class _LinkAction:
    """One row in the per-player sync report."""
    discord_user_id: str
    eos_id:          str
    player_name:     Optional[str]
    action:          str           # 'assigned' | 'removed' | 'noop' | 'error'
    detail:          Optional[str] = None


@dataclass
class VipSyncReport:
    """Aggregate result returned by :func:`sync_vip_role`."""
    started_at_iso:    str
    finished_at_iso:   str
    duration_seconds:  float

    role_id:           str
    guild_id:          str

    linked_total:      int = 0
    assigned_count:    int = 0
    removed_count:     int = 0
    noop_count:        int = 0
    error_count:       int = 0

    # Members on Discord with the VIP role we couldn't map back to an EOS
    # link in our DB -- left untouched on purpose.
    unmapped_with_vip: list[str] = field(default_factory=list)

    actions:           list[_LinkAction] = field(default_factory=list)


# ── Per-player VIP detection (panel side) ────────────────────────────────────

def _player_has_vip(perm_groups: Optional[str], timed_groups: Optional[str]) -> bool:
    """
    Return True iff the player should have the VIP role per the panel DB.

    Permanent membership: "VIP" appears as a CSV entry in PermissionGroups.
    Timed membership:     `flag;timestamp;VIP` with timestamp > now.
    """
    if perm_groups:
        for entry in perm_groups.split(","):
            if entry.strip() == _VIP_GROUP_NAME:
                return True

    if timed_groups:
        now_ts = int(time.time())
        for entry in timed_groups.split(","):
            entry = entry.strip()
            if not entry:
                continue
            parts = entry.split(";")
            if len(parts) < 3:
                continue
            try:
                ts = int(parts[1])
            except (ValueError, TypeError):
                continue
            group = parts[2].strip()
            if group == _VIP_GROUP_NAME and ts > now_ts:
                return True

    return False


# ── Core sync ────────────────────────────────────────────────────────────────

async def sync_vip_role(
    *,
    db:          AsyncSession,
    plugin_db:   AsyncSession,
    bot_token:   str,
    guild_id:    str,
    vip_role_id: str,
) -> VipSyncReport:
    """
    Reconcile the Discord VIP role with the panel DB.

    Reads every linked discord_account (eos_id non-null), computes
    should-have-VIP from the plugin DB Players row, fetches the
    member's current Discord roles, applies the diff via PUT/DELETE
    /guilds/.../members/.../roles/...  Returns a per-player report.

    Failures on individual members do NOT abort the run -- they're
    recorded with action='error' and the run continues.  Only Discord
    auth/connectivity failures at the very start would propagate.
    """
    started = time.monotonic()
    started_iso = _iso_now()

    # 1. Pull every linked discord_account (eos_id NOT NULL)
    res = await db.execute(text(
        "SELECT discord_user_id, eos_id "
        "FROM arkmaniagest_discord_accounts "
        "WHERE eos_id IS NOT NULL"
    ))
    pairs: list[tuple[str, str]] = [
        (str(row[0]), str(row[1])) for row in res.fetchall()
    ]

    report = VipSyncReport(
        started_at_iso  = started_iso,
        finished_at_iso = "",
        duration_seconds= 0.0,
        role_id         = vip_role_id,
        guild_id        = guild_id,
        linked_total    = len(pairs),
    )

    if not pairs:
        # Nothing to sync -- still scan the guild for "stranger VIPs"
        # so the operator sees them in the report.
        await _collect_unmapped_vips(
            bot_token=bot_token, guild_id=guild_id,
            vip_role_id=vip_role_id, known_discord_ids=set(),
            report=report,
        )
        report.finished_at_iso  = _iso_now()
        report.duration_seconds = round(time.monotonic() - started, 2)
        return report

    # 2. For each pair, look up Players row and compute should-have
    eos_ids = [eid for _, eid in pairs]
    placeholders = ",".join(f":e{i}" for i in range(len(eos_ids)))
    params = {f"e{i}": eid for i, eid in enumerate(eos_ids)}
    rows = (await plugin_db.execute(
        text(
            f"SELECT EOS_Id, Giocatore, PermissionGroups, TimedPermissionGroups "
            f"FROM Players WHERE EOS_Id IN ({placeholders})"
        ),
        params,
    )).mappings().fetchall()
    by_eos = {r["EOS_Id"]: r for r in rows}

    known_discord_ids: set[str] = {did for did, _ in pairs}

    # 3. Walk each pair, fetch member, apply diff
    for did, eid in pairs:
        prow = by_eos.get(eid)
        if not prow:
            # Linked EOS gone from Players -- treat as 'no longer VIP'
            should = False
            player_name = None
        else:
            should = _player_has_vip(
                prow.get("PermissionGroups"),
                prow.get("TimedPermissionGroups"),
            )
            player_name = prow.get("Giocatore")

        try:
            member = await dc_client.get_guild_member(
                bot_token=bot_token, guild_id=guild_id, user_id=did,
            )
        except dc_client.DiscordAPIError as exc:
            # 404 here = the user left the guild.  Not an error from the
            # operator's PoV -- record as 'noop' with the detail.
            if exc.status == 404:
                report.actions.append(_LinkAction(
                    discord_user_id=did, eos_id=eid, player_name=player_name,
                    action="noop", detail="user not in guild",
                ))
                report.noop_count += 1
                continue
            report.actions.append(_LinkAction(
                discord_user_id=did, eos_id=eid, player_name=player_name,
                action="error", detail=str(exc),
            ))
            report.error_count += 1
            continue

        has_now = vip_role_id in (member.get("roles") or [])

        if should and not has_now:
            try:
                await dc_client.add_guild_member_role(
                    bot_token=bot_token, guild_id=guild_id,
                    user_id=did, role_id=vip_role_id,
                )
                report.assigned_count += 1
                report.actions.append(_LinkAction(
                    discord_user_id=did, eos_id=eid, player_name=player_name,
                    action="assigned",
                ))
            except dc_client.DiscordAPIError as exc:
                report.error_count += 1
                report.actions.append(_LinkAction(
                    discord_user_id=did, eos_id=eid, player_name=player_name,
                    action="error", detail=f"assign failed: {exc}",
                ))
        elif (not should) and has_now:
            try:
                await dc_client.remove_guild_member_role(
                    bot_token=bot_token, guild_id=guild_id,
                    user_id=did, role_id=vip_role_id,
                )
                report.removed_count += 1
                report.actions.append(_LinkAction(
                    discord_user_id=did, eos_id=eid, player_name=player_name,
                    action="removed",
                ))
            except dc_client.DiscordAPIError as exc:
                report.error_count += 1
                report.actions.append(_LinkAction(
                    discord_user_id=did, eos_id=eid, player_name=player_name,
                    action="error", detail=f"remove failed: {exc}",
                ))
        else:
            report.noop_count += 1
            report.actions.append(_LinkAction(
                discord_user_id=did, eos_id=eid, player_name=player_name,
                action="noop",
                detail="vip-role state already correct",
            ))

    # 4. Stranger VIPs (have role on Discord, no link in our DB)
    await _collect_unmapped_vips(
        bot_token=bot_token, guild_id=guild_id,
        vip_role_id=vip_role_id, known_discord_ids=known_discord_ids,
        report=report,
    )

    report.finished_at_iso  = _iso_now()
    report.duration_seconds = round(time.monotonic() - started, 2)
    return report


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _collect_unmapped_vips(
    *,
    bot_token:         str,
    guild_id:          str,
    vip_role_id:       str,
    known_discord_ids: set[str],
    report:            VipSyncReport,
) -> None:
    """
    Walk the guild member list (paginated) to find members who hold the
    VIP role but are NOT in our linked-accounts set.  Pure observation:
    we never strip the role from them, the operator gets a list to act
    on manually if they want.
    """
    after: Optional[str] = None
    page_size = 1000
    pages = 0
    MAX_PAGES = 20  # safety: stop walking after ~20k members
    while pages < MAX_PAGES:
        try:
            members = await dc_client.list_guild_members(
                bot_token=bot_token, guild_id=guild_id,
                limit=page_size, after=after,
            )
        except dc_client.DiscordAPIError as exc:
            log.warning("VIP sync: list_guild_members failed: %s", exc)
            return
        if not members:
            return
        for m in members:
            user = m.get("user") or {}
            uid  = str(user.get("id") or "")
            if not uid:
                continue
            if vip_role_id in (m.get("roles") or []):
                if uid not in known_discord_ids:
                    report.unmapped_with_vip.append(uid)
        if len(members) < page_size:
            return
        after = str(members[-1].get("user", {}).get("id") or "")
        if not after:
            return
        pages += 1


def _iso_now() -> str:
    """UTC ISO-8601 timestamp without microseconds."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
