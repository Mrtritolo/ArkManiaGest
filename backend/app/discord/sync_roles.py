"""
app.discord.sync_roles — Generic Discord-role -> ARK-permission-group
reconciliation engine (Phase 7+).

Sister of :mod:`app.discord.sync_vip` but driven by the
``arkmaniagest_discord_role_map`` table instead of a single hard-coded
env-var, so the operator can configure N rules from the panel UI:
'every linked player who owns Discord role X gets ARK permission group
Y written into Players.PermissionGroups'.

Direction is fixed: Discord -> ARK plugin DB.  The reverse direction
('player has X group in ARK -> assign Discord role') already exists for
the specific VIP case in :mod:`app.discord.sync_vip` and stays
untouched -- the operator explicitly asked for both engines to coexist.

Per-rule semantics:

  - Membership probe: pull the guild's full member list once via the
    bot, then index ``user_id -> set(role_ids)``.  This is O(1) per
    rule afterwards regardless of how many rules are configured.
  - For each linked discord_account (eos_id NOT NULL) we compute the
    union of ARK groups it should have based on every active rule
    that mentions a role the user owns.
  - Plugin-DB diff: compare the union against the player's current
    PermissionGroups CSV and apply the minimal add/remove diff.  We
    NEVER touch groups not produced by any rule (e.g. Default,
    custom admin-only groups, the VIP-sync-managed group) so the
    two engines compose cleanly.
  - Players whose linked EOS does not exist in ``Players`` are
    skipped silently.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.discord import client as dc_client


log = logging.getLogger("arkmaniagest.discord.sync_roles")


# ── Result envelope ──────────────────────────────────────────────────────────

@dataclass
class _RuleAction:
    """One row in the per-player report."""
    discord_user_id: str
    eos_id:          str
    player_name:     Optional[str]
    groups_added:    list[str] = field(default_factory=list)
    groups_removed:  list[str] = field(default_factory=list)
    detail:          Optional[str] = None
    error:           bool = False


@dataclass
class RoleSyncReport:
    started_at_iso:    str
    finished_at_iso:   str
    duration_seconds:  float

    rules_total:       int = 0
    rules_active:      int = 0
    linked_total:      int = 0
    players_changed:   int = 0
    players_unchanged: int = 0
    error_count:       int = 0

    actions:           list[_RuleAction] = field(default_factory=list)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_perm_groups(raw: Optional[str]) -> list[str]:
    """
    Split the Players.PermissionGroups CSV.

    The plugin's own writer keeps a trailing comma ('Default,VIP,').  We
    drop empties on read and re-emit the trailing comma on write so the
    plugin doesn't notice anything changed structurally.
    """
    if not raw:
        return []
    return [g.strip() for g in raw.split(",") if g.strip()]


def _emit_perm_groups(groups: list[str]) -> str:
    """
    Re-emit a CSV the plugin will accept.  Keeps the historical trailing
    comma so a side-by-side diff with the previous row stays minimal.
    """
    if not groups:
        return ""
    return ",".join(groups) + ","


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ── Core sync ────────────────────────────────────────────────────────────────

async def sync_role_mappings(
    *,
    db:         AsyncSession,
    plugin_db:  AsyncSession,
    bot_token:  str,
    guild_id:   str,
) -> RoleSyncReport:
    """
    Apply every active row in ``arkmaniagest_discord_role_map``.

    Returns a per-player report.  Failures on a single member do not
    abort the run -- they're recorded with ``error=True``.  Only Discord
    auth/connectivity failures at the very start would propagate.
    """
    started_t = time.monotonic()
    started_iso = _iso_now()

    # 1. Load every row from the role-map table
    res = await db.execute(text(
        "SELECT id, discord_role_id, ark_group_name, is_active "
        "FROM arkmaniagest_discord_role_map"
    ))
    all_rows = list(res.mappings().fetchall())
    active_rules = [
        (str(r["discord_role_id"]), str(r["ark_group_name"]).strip())
        for r in all_rows
        if r.get("is_active") and r.get("ark_group_name") and r.get("discord_role_id")
    ]
    # The set of ARK groups this engine OWNS.  We only ever touch groups
    # in this set; everything else (Default, VIP managed elsewhere,
    # admin-only groups, ...) passes through untouched.
    managed_groups: set[str] = {g for _, g in active_rules}

    report = RoleSyncReport(
        started_at_iso  = started_iso,
        finished_at_iso = "",
        duration_seconds= 0.0,
        rules_total     = len(all_rows),
        rules_active    = len(active_rules),
    )

    if not active_rules or not managed_groups:
        report.finished_at_iso  = _iso_now()
        report.duration_seconds = round(time.monotonic() - started_t, 2)
        return report

    # 2. Pull every linked discord_account (eos_id NOT NULL)
    pairs = [
        (str(row[0]), str(row[1]))
        for row in (await db.execute(text(
            "SELECT discord_user_id, eos_id "
            "FROM arkmaniagest_discord_accounts "
            "WHERE eos_id IS NOT NULL"
        ))).fetchall()
    ]
    report.linked_total = len(pairs)
    if not pairs:
        report.finished_at_iso  = _iso_now()
        report.duration_seconds = round(time.monotonic() - started_t, 2)
        return report

    # 3. Walk the guild member list once + build user_id -> roles index.
    #    list_guild_members is paginated -- walk pages of 1000 (Discord
    #    cap).  Each page returns members with their .roles array.
    user_roles: dict[str, set[str]] = {}
    after: Optional[str] = None
    page_size = 1000
    pages = 0
    MAX_PAGES = 25  # 25 * 1000 = 25k member ceiling
    try:
        while pages < MAX_PAGES:
            members = await dc_client.list_guild_members(
                bot_token=bot_token, guild_id=guild_id,
                limit=page_size, after=after,
            )
            if not members:
                break
            for m in members:
                u = m.get("user") or {}
                uid = str(u.get("id") or "")
                if not uid:
                    continue
                user_roles[uid] = set(str(r) for r in (m.get("roles") or []))
            if len(members) < page_size:
                break
            after = str(members[-1].get("user", {}).get("id") or "")
            if not after:
                break
            pages += 1
    except dc_client.DiscordAPIError as exc:
        # Hard fail at the very start -- nothing we can apply.
        raise

    # 4. Pre-fetch every Players row for the linked EOS ids (one shot)
    eos_ids = [eid for _, eid in pairs]
    placeholders = ",".join(f":e{i}" for i in range(len(eos_ids)))
    params = {f"e{i}": eid for i, eid in enumerate(eos_ids)}
    p_rows = (await plugin_db.execute(
        text(
            f"SELECT EOS_Id, Giocatore, PermissionGroups "
            f"FROM Players WHERE EOS_Id IN ({placeholders})"
        ),
        params,
    )).mappings().fetchall()
    by_eos = {r["EOS_Id"]: r for r in p_rows}

    # 5. Rule application per player
    for did, eid in pairs:
        prow = by_eos.get(eid)
        if not prow:
            # Linked EOS no longer in Players (wiped save).  Skip.
            report.actions.append(_RuleAction(
                discord_user_id=did, eos_id=eid, player_name=None,
                detail="player not in Players table",
            ))
            continue

        member_roles = user_roles.get(did, set())
        # The set of groups every active rule that matches this user
        # produces.
        target_managed: set[str] = {
            g for role_id, g in active_rules if role_id in member_roles
        }

        current = _parse_perm_groups(prow.get("PermissionGroups"))
        # Re-build the new CSV: keep every group NOT managed by this
        # engine, plus the target_managed set.  Preserves order of
        # the unmanaged tail to keep the diff minimal.
        unmanaged_tail = [g for g in current if g not in managed_groups]
        new_groups = unmanaged_tail + sorted(target_managed)
        added   = sorted(set(new_groups) - set(current))
        removed = sorted(set(current)    - set(new_groups))

        if not added and not removed:
            report.players_unchanged += 1
            continue

        try:
            await plugin_db.execute(
                text(
                    "UPDATE Players SET PermissionGroups = :pg "
                    "WHERE EOS_Id = :e"
                ),
                {"pg": _emit_perm_groups(new_groups), "e": eid},
            )
            await plugin_db.commit()
        except Exception as exc:
            await plugin_db.rollback()
            report.error_count += 1
            report.actions.append(_RuleAction(
                discord_user_id=did, eos_id=eid,
                player_name=prow.get("Giocatore"),
                groups_added=added, groups_removed=removed,
                detail=f"DB write failed: {exc}",
                error=True,
            ))
            continue

        report.players_changed += 1
        report.actions.append(_RuleAction(
            discord_user_id=did, eos_id=eid,
            player_name=prow.get("Giocatore"),
            groups_added=added, groups_removed=removed,
        ))

    report.finished_at_iso  = _iso_now()
    report.duration_seconds = round(time.monotonic() - started_t, 2)
    return report
