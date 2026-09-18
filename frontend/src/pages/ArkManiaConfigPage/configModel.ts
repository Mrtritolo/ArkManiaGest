/**
 * Shared model of the plugin config editor: the row shapes, the icon per
 * plugin module, the description derived from a key name, the editor a value
 * deserves, and the filter/group/sort the content area renders.
 */
import {
  Bell, Crosshair, Eye, FileText, Heart, LogIn, MessageCircle, MessageSquare,
  Package, Settings, Shield, ShieldAlert, Swords, Timer, Trophy, UserCheck,
  Users, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const MODULE_ICONS: Record<string, LucideIcon> = {
  Login: LogIn, Plus: Zap, RareDino: Eye, ItemPlus: Package,
  ServerRules: Shield, DeadSaver: Heart, CrossChat: MessageSquare,
  DecayManager: Timer, Discord: Bell, Messages: MessageCircle,
  Leaderboard: Trophy, LeaderBoard: Trophy,
  nc: UserCheck, te: Users, tl: FileText,
  craftlimit: Package, plus: Zap, PvPManager: Swords,
  RangeManager: Crosshair, SpawnProtection: ShieldAlert,
}

export interface ConfigModule { prefix: string; label: string; icon: string; key_count: number }
export interface ConfigItem {
  config_key: string; short_key: string; value: string; global_value: string | null
  description: string; is_overridden: boolean; override_value: string | null
}
export interface ServerItem {
  server_key: string; display_name: string; map_name: string; is_online: boolean; player_count: number
}

export type TFn = (key: string, options?: Record<string, unknown>) => string

/** Description derived from the key name, when the plugin ships none. */
export function autoDescription(shortKey: string, t: TFn): string {
  const k = shortKey.toLowerCase()
  const last = shortKey.split('.').pop() || ''
  const lastLow = last.toLowerCase()

  // Pattern Cmd.xxx.yyy
  if (k.includes('cmd.')) {
    const parts = shortKey.split('.')
    const cmd = parts.length >= 2 ? parts[1] : ''
    if (lastLow === 'cooldown') return t('arkmaniaConfig.autoDesc.cmdCooldown', { cmd })
    if (lastLow === 'range') return t('arkmaniaConfig.autoDesc.cmdRange', { cmd })
    if (lastLow === 'value') return t('arkmaniaConfig.autoDesc.cmdValue', { cmd })
    if (lastLow === 'cost') {
      const group = parts.length >= 3 ? parts[parts.length - 2] : ''
      return t('arkmaniaConfig.autoDesc.cmdCost', { cmd, group })
    }
  }

  if (lastLow === 'enabled') return t('arkmaniaConfig.autoDesc.enabled')
  if (lastLow === 'cooldown' || lastLow === 'cooldownsec') return t('arkmaniaConfig.autoDesc.cooldown')
  if (lastLow === 'range') return t('arkmaniaConfig.autoDesc.range')
  if (lastLow === 'cost') return t('arkmaniaConfig.autoDesc.cost')
  if (lastLow.includes('interval')) return t('arkmaniaConfig.autoDesc.interval')
  if (lastLow.includes('max')) return t('arkmaniaConfig.autoDesc.max')
  if (lastLow.includes('min') && !lastLow.includes('admin')) return t('arkmaniaConfig.autoDesc.min')
  if (lastLow.includes('color')) return t('arkmaniaConfig.autoDesc.color')
  if (lastLow.includes('prefix')) return t('arkmaniaConfig.autoDesc.prefix')
  if (lastLow.includes('message') || lastLow.includes('msg')) return t('arkmaniaConfig.autoDesc.message')
  if (lastLow.includes('webhook')) return t('arkmaniaConfig.autoDesc.webhook')
  if (lastLow.includes('channel')) return t('arkmaniaConfig.autoDesc.channel')
  if (lastLow.includes('url')) return t('arkmaniaConfig.autoDesc.url')
  if (lastLow.includes('timeout') || lastLow.includes('sec')) return t('arkmaniaConfig.autoDesc.timeout')
  if (lastLow.includes('days') || lastLow.includes('day')) return t('arkmaniaConfig.autoDesc.days')
  if (lastLow.includes('hours') || lastLow.includes('hour')) return t('arkmaniaConfig.autoDesc.hours')
  if (lastLow.includes('limit')) return t('arkmaniaConfig.autoDesc.limit')
  if (lastLow.includes('radius')) return t('arkmaniaConfig.autoDesc.radius')
  if (lastLow.includes('multiplier') || lastLow.includes('mult')) return t('arkmaniaConfig.autoDesc.multiplier')
  if (lastLow.includes('percent') || lastLow.includes('pct')) return t('arkmaniaConfig.autoDesc.percent')
  if (lastLow.includes('count')) return t('arkmaniaConfig.autoDesc.count')
  if (lastLow.includes('level')) return t('arkmaniaConfig.autoDesc.level')
  if (lastLow.includes('weight')) return t('arkmaniaConfig.autoDesc.weight')
  if (lastLow.includes('speed')) return t('arkmaniaConfig.autoDesc.speed')

  return ''
}

export type EditorType =
  | 'bool' | 'text' | 'groups' | 'ordered_groups' | 'group_rules'
  | 'blueprints' | 'key_value' | 'craft_rules' | 'json'

/** Which GUI a value gets, inferred from the key name and the stored value. */
export function detectEditorType(key: string, value: string): EditorType {
  if (['true', 'false'].includes(value.toLowerCase())) return 'bool'

  // CraftLimit: list of structures with a limit per group.
  if (key.endsWith('struct.rules') || key === 'struct.rules') {
    if (value === '[]' || value.startsWith('[')) {
      try { const arr = JSON.parse(value); if (Array.isArray(arr)) return 'craft_rules' } catch { /* not JSON */ }
    }
  }

  // CraftLimit: group priority, where the order matters.
  if (key.endsWith('group_priority') && value.startsWith('[')) {
    try {
      const arr = JSON.parse(value)
      if (Array.isArray(arr) && arr.every((i: unknown) => typeof i === 'string')) return 'ordered_groups'
    } catch { /* not JSON */ }
  }

  // Permission groups: array of strings under a "Groups" key.
  const groupKeys = ['Groups', 'AdminGroups', 'AllowedGroups', 'VIPGroups', 'MuteAdminGroups', 'RequiredGroups']
  if (groupKeys.some(gk => key.endsWith(gk)) && value.startsWith('[')) {
    try {
      const arr = JSON.parse(value)
      if (Array.isArray(arr) && arr.every((i: unknown) => typeof i === 'string')) return 'groups'
    } catch { /* not JSON */ }
  }

  // Group rules: array of objects with Group + DecayDays.
  if (key.endsWith('GroupRules') && value.startsWith('[')) {
    try {
      const arr = JSON.parse(value)
      if (Array.isArray(arr) && arr.length > 0 && arr[0].Group) return 'group_rules'
    } catch { /* not JSON */ }
  }
  // An empty array under a GroupRules key is still the rules editor.
  if (key.endsWith('GroupRules') && value === '[]') return 'group_rules'

  if ((key.endsWith('RewardPool') || key.endsWith('BlockedItems') || key.endsWith('BlockedEngrams')) && value.startsWith('['))
    return 'blueprints'

  if (key.endsWith('MapDisplayNames') && value.startsWith('{')) return 'key_value'

  if ((value.startsWith('[') || value.startsWith('{')) && value.length > 2) {
    try { JSON.parse(value); return 'json' } catch { /* not JSON */ }
  }

  return 'text'
}

/** True when a hand-edited JSON value parses and keeps the original's shape. */
export function isValidJsonEdit(value: string, original: string): boolean {
  try {
    const next = JSON.parse(value)
    return typeof next === 'object' && next !== null && Array.isArray(next) === Array.isArray(JSON.parse(original))
  } catch { return false }
}

/** Editors that need the full width of the content area. */
export const WIDE_EDITORS: EditorType[] = ['groups', 'group_rules', 'blueprints', 'key_value', 'json', 'craft_rules']

/**
 * Filter by the toolbar query, group by the first segment of the key and sort
 * each group with the "Enabled" switch first.
 */
export function groupConfigItems(items: ConfigItem[], query: string): [string, ConfigItem[]][] {
  const filtered = query
    ? items.filter(i => i.short_key.toLowerCase().includes(query.toLowerCase())
      || i.description.toLowerCase().includes(query.toLowerCase()))
    : items

  const grouped: Record<string, ConfigItem[]> = {}
  for (const item of filtered) {
    const parts = item.short_key.split('.')
    const group = parts.length > 2 ? parts[0] : '_general'
    if (!grouped[group]) grouped[group] = []
    grouped[group].push(item)
  }
  const isEnabled = (key: string) => {
    const low = key.toLowerCase()
    return low.endsWith('enabled') || low === 'enabled'
  }
  for (const group of Object.keys(grouped)) {
    grouped[group].sort((a, b) => {
      const aEnabled = isEnabled(a.short_key)
      const bEnabled = isEnabled(b.short_key)
      if (aEnabled && !bEnabled) return -1
      if (!aEnabled && bEnabled) return 1
      return a.short_key.localeCompare(b.short_key)
    })
  }
  return Object.entries(grouped)
}

/** Readable name of a blueprint path, for the list rows. */
export function extractBlueprintName(bp: string): string {
  const match = bp.match(/\.([^.]+)'?$/)
  if (!match) return bp.slice(0, 50)
  let name = match[1]
  for (const prefix of ['PrimalItemArmor_', 'PrimalItemResource_', 'PrimalItem_Weapon', 'PrimalItemConsumable_', 'PrimalItem_', 'PrimalItemAmmo_']) {
    if (name.startsWith(prefix)) { name = name.slice(prefix.length); break }
  }
  return name.replace(/_Character_BP$/, '').replace(/_/g, ' ')
}

/** Last segment of a blueprint path, for the mono secondary line. */
export function shortBlueprint(bp: string): string {
  return bp.split('/').pop()?.replace("'", '') ?? bp
}
