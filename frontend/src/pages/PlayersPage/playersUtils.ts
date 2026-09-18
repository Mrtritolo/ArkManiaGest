/**
 * playersUtils.ts — pure helpers for PlayersPage.
 *
 * No React, no API calls: parsing of the two ARK permission strings
 * (`PermissionGroups`, `TimedPermissionGroups`), the Excel-style column
 * filter pipeline, sorting, and the persisted "align family" list.
 */
import type { TFunction } from "i18next";
import type { PlayerListItem } from "../../types";

export type ColKey = "tribe" | "groups" | "timedActive" | "timedExpired";

/** Reserved value for rows that have no value at all in a column. */
export const NO_VALUE_KEY = "__empty__";

export interface TimedPerm {
  flag: string;
  timestamp: number;
  group: string;
}

/** One chip of the Timed column: keeps the raw timestamp, does not trim. */
export interface TimedChip {
  group: string;
  ts: number;
  expired: boolean;
}

const ALIGN_GROUPS_KEY = "arkmaniagest.alignGroups";

// ── TimedPermissionGroups ────────────────────────────────────────────────

/** `flag;timestamp;group,…` -> editable entries (used by the detail editor). */
export function parseTimedPerms(raw: string | null | undefined): TimedPerm[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .filter(Boolean)
    .map(entry => {
      const p = entry.split(";");
      return { flag: p[0] || "0", timestamp: parseInt(p[1]) || 0, group: p[2] || "" };
    })
    .filter(e => e.group);
}

export function serializeTimedPerms(perms: TimedPerm[]): string {
  return perms.map(p => `${p.flag};${p.timestamp};${p.group}`).join(",");
}

/** Row variant: keeps `ts` for the tooltip and does NOT trim the group name. */
export function parseTimedChips(raw: string | null | undefined): TimedChip[] {
  return (raw || "")
    .split(",")
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(";");
      const ts = parseInt(parts[1]) || 0;
      const group = parts[2] || "";
      return { group, ts, expired: ts > 0 && ts < Date.now() / 1000 };
    })
    .filter(e => e.group);
}

/** Filter variant: trimmed group names plus their expiry state. */
export function parseTimedGroups(raw: string | null | undefined): Array<{ group: string; expired: boolean }> {
  const nowSec = Date.now() / 1000;
  return (raw || "")
    .split(",")
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(";");
      const ts = parseInt(parts[1] || "0", 10) || 0;
      return { group: (parts[2] || "").trim(), expired: ts > 0 && ts < nowSec };
    })
    .filter(e => e.group);
}

/** The comma-separated fixed-permission groups of a player. */
export function parseFixedGroups(raw: string | null | undefined): string[] {
  return (raw || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

// datetime-local has no zone: the browser parses its value as local time
// (inputToTs), so it must also be rendered as local time.  toISOString()
// rendered UTC, and every edit moved the expiry by the UTC offset.
export function tsToInput(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function inputToTs(val: string): number {
  return val ? Math.floor(new Date(val).getTime() / 1000) : 0;
}

// ── Column filters ───────────────────────────────────────────────────────

export type ColFilters = Record<ColKey, Set<string>>;
export type DistinctValues = Record<ColKey, string[]>;

/** Distinct values per filterable column across the loaded player set. */
export function computeDistinctValues(players: PlayerListItem[]): DistinctValues {
  const tribes = new Set<string>();
  const groups = new Set<string>();
  const timedActive = new Set<string>();
  const timedExpired = new Set<string>();
  let hasNoTribe = false;
  let hasNoGroups = false;
  let hasNoActive = false;
  let hasNoExpired = false;
  players.forEach(p => {
    if (p.tribe_name?.trim()) tribes.add(p.tribe_name.trim());
    else hasNoTribe = true;
    const fg = parseFixedGroups(p.permission_groups);
    if (fg.length === 0) hasNoGroups = true;
    fg.forEach(g => groups.add(g));
    const tg = parseTimedGroups(p.timed_permission_groups);
    const act = tg.filter(e => !e.expired);
    const exp = tg.filter(e => e.expired);
    if (act.length === 0) hasNoActive = true;
    if (exp.length === 0) hasNoExpired = true;
    act.forEach(e => timedActive.add(e.group));
    exp.forEach(e => timedExpired.add(e.group));
  });
  function sorted(set: Set<string>, hasEmpty: boolean): string[] {
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return hasEmpty ? [...arr, NO_VALUE_KEY] : arr;
  }
  return {
    tribe: sorted(tribes, hasNoTribe),
    groups: sorted(groups, hasNoGroups),
    timedActive: sorted(timedActive, hasNoActive),
    timedExpired: sorted(timedExpired, hasNoExpired),
  };
}

/** Excel-autofilter semantics: an empty Set means "no filter on this column". */
export function passesFilter(player: PlayerListItem, colFilters: ColFilters): boolean {
  if (colFilters.tribe.size > 0) {
    const tribeKey = player.tribe_name?.trim() || NO_VALUE_KEY;
    if (!colFilters.tribe.has(tribeKey)) return false;
  }
  if (colFilters.groups.size > 0) {
    const fg = parseFixedGroups(player.permission_groups);
    if (fg.length === 0) {
      if (!colFilters.groups.has(NO_VALUE_KEY)) return false;
    } else if (!fg.some(g => colFilters.groups.has(g))) {
      // ANY-match: at least one of the player's groups is ticked.
      return false;
    }
  }
  if (colFilters.timedActive.size > 0 || colFilters.timedExpired.size > 0) {
    const tg = parseTimedGroups(player.timed_permission_groups);
    const act = tg.filter(e => !e.expired).map(e => e.group);
    const exp = tg.filter(e => e.expired).map(e => e.group);

    if (colFilters.timedActive.size > 0) {
      if (act.length === 0) {
        if (!colFilters.timedActive.has(NO_VALUE_KEY)) return false;
      } else if (!act.some(g => colFilters.timedActive.has(g))) {
        return false;
      }
    }
    if (colFilters.timedExpired.size > 0) {
      if (exp.length === 0) {
        if (!colFilters.timedExpired.has(NO_VALUE_KEY)) return false;
      } else if (!exp.some(g => colFilters.timedExpired.has(g))) {
        return false;
      }
    }
  }
  return true;
}

export type SortCol = "name" | "points" | "groups" | "timed" | "tribe" | "login";

export function sortPlayers(list: PlayerListItem[], col: SortCol, dir: "asc" | "desc"): PlayerListItem[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (col) {
      case "name":
        return sign * (a.name || "").localeCompare(b.name || "");
      case "points":
        return sign * ((a.points ?? 0) - (b.points ?? 0));
      case "groups":
        return sign * (a.permission_groups || "").localeCompare(b.permission_groups || "");
      case "timed":
        return sign * (a.timed_permission_groups || "").localeCompare(b.timed_permission_groups || "");
      case "tribe":
        return sign * (a.tribe_name || "").localeCompare(b.tribe_name || "");
      case "login": {
        const ta = a.last_login ? new Date(a.last_login).getTime() : 0;
        const tb = b.last_login ? new Date(b.last_login).getTime() : 0;
        return sign * (ta - tb);
      }
      default:
        return 0;
    }
  });
}

// ── Formatting ───────────────────────────────────────────────────────────

export function fmtLoginAgo(d: string | null, t: TFunction): string | null {
  if (!d) return null;
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return t("players.timeAgo.minutes", { n: mins });
  if (hrs < 24) return t("players.timeAgo.hours", { n: hrs });
  if (days < 30) return t("players.timeAgo.days", { n: days });
  return t("players.timeAgo.months", { n: Math.floor(days / 30) });
}

/** A container name is only unique per host, so keys carry the machine id. */
export function containerKey(c: { machine_id: number; container_name: string }): string {
  return `${c.machine_id}|${c.container_name}`;
}

// ── Persisted "align family" ─────────────────────────────────────────────

export function loadAlignGroups(): string[] {
  try {
    const stored = window.localStorage.getItem(ALIGN_GROUPS_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.every(s => typeof s === "string")) return arr;
    }
  } catch {
    /* fall through */
  }
  return ["VIP", "Dead", "Decadimento"];
}

export function saveAlignGroups(groups: string[]): void {
  try {
    window.localStorage.setItem(ALIGN_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* ignore */
  }
}
