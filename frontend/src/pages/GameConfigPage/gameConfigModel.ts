/**
 * Shared types and pure helpers of the INI editor: the shapes the backend
 * returns, the icon map of the setting groups, the spawn-entry key map and
 * the client-side validation the typed override endpoints now require.
 */
import {
  ArrowLeftRight, Building, Bug, Crosshair, Gamepad2, Gift, Heart, Settings,
  Shield, ShieldAlert, Snowflake, Star, Stethoscope, Sun, Swords, Timer,
  TrendingUp, User, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  Settings, TrendingUp, Star, Sun, Swords, User, Bug, Heart,
  Building, Gamepad2, ShieldAlert, Snowflake, Timer, Crosshair,
  Gift, Users, ArrowLeftRight, Shield, Stethoscope,
}

export interface Container {
  name: string; machine_id: number; machine_name: string; hostname: string
  map_name?: string; paths?: Record<string, string>
}
export interface SettingDef {
  type: string; section: string; file: string
  default?: string | number | boolean; min?: number; max?: number; step?: number; label?: string
}
export interface GroupDef { label: string; icon: string; settings: Record<string, SettingDef> }
export interface ConfigData {
  values: Record<string, Record<string, string>>
  overrides: Record<string, unknown[]>
  mod_sections: { gus: Record<string, Record<string, string>>; game: Record<string, Record<string, string>> }
  uncategorized: {
    gus: Record<string, { key: string; value: string }[]>
    game: Record<string, { key: string; value: string }[]>
  }
  raw: { gus: string; game: string }
}

export type Row = Record<string, unknown>

/** Spawn-entry lists: local editor key -> Game.ini key (also the overrides key). */
export const SPAWN_KEYS: [string, string][] = [
  ['add', 'ConfigAddNPCSpawnEntriesContainer'],
  ['override', 'ConfigOverrideNPCSpawnEntriesContainer'],
  ['subtract', 'ConfigSubtractNPCSpawnEntriesContainer'],
]

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }

/** Human label for a setting key: 'bDisableFriendlyFire' -> 'Disable Friendly Fire'. */
export function settingLabel(key: string, def: SettingDef): string {
  return def.label || key.replace(/([A-Z])/g, ' $1').replace(/^b /, '').trim()
}

/** A line the backend could not parse arrives with `raw` only and is read-only. */
export function isRawOnly(row: Row, typedField: string): boolean {
  return row[typedField] === undefined
}

function badNumber(value: unknown, allowZero = true): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return true
  return allowZero ? value < 0 : value <= 0
}

/**
 * The stacks, crafting and NPC endpoints answer 400 ("Entry N of <key> is
 * incomplete or malformed.") for a value their parser cannot read back. The
 * page saves GUS/Game, then stacks, then crafting one after another, so a
 * single leftover row would fail the save with earlier parts already written:
 * everything is checked before the first request goes out.
 *
 * Rows the save drops anyway (no class, no item_class, no from_class, and
 * raw-only lines the backend preserves itself) are not checked.
 */
export function hasIncompleteOverrides(stacks: Row[], crafting: Row[]): boolean {
  for (const stack of stacks) {
    if (!stack.class) continue
    if (badNumber(stack.max_quantity)) return true
  }
  for (const item of crafting) {
    if (!item.item_class) continue
    const resources = (item.resources as Row[] | undefined) ?? []
    if (resources.length === 0) return true
    for (const resource of resources) {
      if (!String(resource.resource_class ?? '').trim()) return true
      if (badNumber(resource.amount)) return true
    }
  }
  return false
}
