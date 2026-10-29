"""
services/player_names.py — Which name the panel shows for a player.

The rules live here so every route applies the same ones:

* :func:`pick_profile_name` chooses the name the profile sync (the Players
  page button and the nightly cron) writes to ``Players.Giocatore`` from a
  player's ``.arkprofile`` files, one per map.
* :func:`resolved_name_sql` / :func:`display_name_sql` make a plugin table
  that carries an EOS id show that same name instead of the copy the plugin
  stored on the row when it wrote it, and :func:`name_search_sql` makes a
  search match it.  :func:`resolved_name` is the same rule in Python, with
  :func:`current_names` for tables never joined to ``Players`` in SQL.

In both directions a default character name counts as no name: it never
replaces a real one, and it is shown only when nothing better is known.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ARK's per-language default name for a character the player never renamed.
# The game stores it verbatim in the .arkprofile, so a sync that copied it
# replaced the real name of anyone who opened a fresh character on another
# map with "Survivor" (Human / Umano / Humain / Человек on older saves).
DEFAULT_CHARACTER_NAMES: frozenset[str] = frozenset(
    s.casefold() for s in ("Survivor", "Human", "Umano", "Humain", "Человек")
)


def is_default_name(name: Optional[str]) -> bool:
    """True when *name* is the game's default name for an unnamed character."""
    return bool(name) and name.strip().casefold() in DEFAULT_CHARACTER_NAMES


def _is_real(name: Optional[str]) -> bool:
    return bool(name and name.strip()) and not is_default_name(name)


def _newest(candidates: list[tuple[float, str]]) -> Optional[str]:
    return max(candidates)[1] if candidates else None


def pick_profile_name(profiles: Iterable[dict], current: Optional[str]) -> Optional[str]:
    """
    Name to store for one player, or ``None`` to leave ``current`` as it is.

    *profiles* are the player's parsed .arkprofile files, as returned by
    :func:`app.ssh.profile_parser.scan_and_match_profiles`
    (``character_name``, ``account_name``, ``mtime``).  In order of
    preference:

    1. the character name of the most recently written profile that has a
       real one -- a player owns one character per map, and the panel
       follows the one they played last;
    2. the account name, when every character still has the default name;
    3. the default name itself, when nothing else is known.

    A fallback (2 or 3) never replaces a real name already stored: a scan
    limited to one container, or a wipe of the only named character, must
    not demote a name the player chose.
    """
    named:    list[tuple[float, str]] = []
    accounts: list[tuple[float, str]] = []
    defaults: list[tuple[float, str]] = []
    for p in profiles:
        mtime     = p.get("mtime") or 0.0
        character = (p.get("character_name") or "").strip()
        account   = (p.get("account_name") or "").strip()
        if _is_real(character):
            named.append((mtime, character))
        elif _is_real(account):
            accounts.append((mtime, account))
        elif character or account:
            defaults.append((mtime, character or account))

    if named:
        return _newest(named)
    fallback = _newest(accounts) or _newest(defaults)
    if fallback is None or _is_real(current):
        return None
    return fallback


def resolved_name(giocatore: Optional[str], stored: Optional[str]) -> Optional[str]:
    """
    Name to show for a row: *giocatore* (``Players.Giocatore``) when it is a
    real name, else the name the plugin *stored* on the row, else whatever
    *giocatore* holds.
    """
    if _is_real(giocatore):
        return giocatore
    return (stored or None) or (giocatore or None)


_DEFAULT_NAMES_SQL = ", ".join(f"'{n}'" for n in sorted(DEFAULT_CHARACTER_NAMES | {""}))


def resolved_name_sql(giocatore_col: str, stored_col: str) -> str:
    """:func:`resolved_name` as SQL, for a query already joined to ``Players``."""
    return (
        f"CASE WHEN LOWER(TRIM({giocatore_col})) IN ({_DEFAULT_NAMES_SQL}) "
        f"THEN COALESCE(NULLIF({stored_col}, ''), NULLIF({giocatore_col}, '')) "
        f"ELSE COALESCE({giocatore_col}, {stored_col}) END"
    )


def display_name_sql(eos_col: str, stored_col: str) -> str:
    """
    :func:`resolved_name` as SQL for a plugin row with the player's EOS id in
    *eos_col* and the plugin's copy of the name in *stored_col*.

    A scalar subquery rather than a JOIN: ``Players`` has ``Id`` and
    ``EOS_Id`` columns that would make the unqualified ``id`` / ``eos_id`` of
    the surrounding query ambiguous.
    """
    return (
        f"COALESCE((SELECT {resolved_name_sql('pn.Giocatore', stored_col)} "
        f"FROM Players pn WHERE pn.EOS_Id = {eos_col} LIMIT 1), {stored_col})"
    )


def name_search_sql(eos_col: str) -> str:
    """SQL condition matching rows whose player's Giocatore is ``LIKE :q``."""
    return f"{eos_col} IN (SELECT pn.EOS_Id FROM Players pn WHERE pn.Giocatore LIKE :q)"


async def current_names(db: AsyncSession, eos_ids: Iterable[Optional[str]]) -> dict[str, str]:
    """``Players.Giocatore`` by EOS id, for the ids that have a non-empty one."""
    ids = sorted({e for e in eos_ids if e})
    if not ids:
        return {}
    ph = ",".join(f":e{i}" for i in range(len(ids)))
    rows = (await db.execute(
        text(f"SELECT EOS_Id, Giocatore FROM Players WHERE EOS_Id IN ({ph})"),
        {f"e{i}": e for i, e in enumerate(ids)},
    )).fetchall()
    return {r[0]: r[1] for r in rows if r[1]}
