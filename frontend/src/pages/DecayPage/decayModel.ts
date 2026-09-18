/**
 * decayModel — types and pure helpers shared by the Decay page modules.
 * Nothing here touches React or the API.
 */
import type { TFunction } from 'i18next'
import type { ServerInstance } from '../../types'

export interface DecayTribe {
  targeting_team: number; expire_time: string | null; last_refresh_eos: string
  tribe_name: string | null; player_name: string | null
  last_refresh_group: string; last_refresh_days: number
  last_refresh_time: string | null; hours_left: number; status: string
}

export interface PendingItem {
  targeting_team: number; server_key: string; reason: string
  structure_count: number; dino_count: number; flagged_at: string | null
  server_name: string | null; tribe_name: string | null; player_name: string | null
  last_refresh_group: string | null; expire_time: string | null
  last_member_login: string | null
}

export interface ScanDetailItem {
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number; dino_level: number
  reason: string; server_key: string; map_name: string; scanned_at: string | null
  actor_name: string | null; targeting_team: number
}

export interface LogItem {
  id: number; targeting_team: number; server_key: string; map_name: string
  reason: string; structures_destroyed: number; dinos_destroyed: number
  purged_by: string; purged_at: string | null
}

export interface DecayStats {
  total: number; expired: number; expiring_soon: number; safe: number
  pending: number; purged_last_7d: number
}

export type TabType = 'tribes' | 'pending' | 'log'

/** The /tribes endpoint's hard cap; its default (100) hid most of a big cluster. */
export const TRIBES_LIMIT = 500

/** A structure count above this is worth flagging before a purge runs. */
export const HEAVY_STRUCTURES = 500

/** A member seen this recently makes an "abandoned" tribe suspicious. */
export const RECENT_LOGIN_DAYS = 30

/** Whole days elapsed since an ISO datetime; null when absent. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (isNaN(ms)) return null
  return Math.floor((Date.now() - ms) / 86_400_000)
}

export function formatHoursLeft(h: number, t: TFunction): string {
  if (h < 0) return t('decay.hoursLeft.expired', { h: Math.abs(h) })
  if (h < 24) return t('decay.hoursLeft.hours', { h })
  return t('decay.hoursLeft.days', { d: Math.floor(h / 24), h: h % 24 })
}

/** The teleport command for one scanned object. */
export function tpCommand(row: { pos_x: number; pos_y: number; pos_z: number }): string {
  return `cheat TPCoords ${Math.round(row.pos_x)} ${Math.round(row.pos_y)} ${Math.round(row.pos_z)}`
}

/**
 * The instance that serves a pending row's own map.
 *
 * This matters for correctness, not just convenience: `targeting_team`
 * is assigned per map, so the same number means a different tribe on a
 * different server. Firing RemoveStruct at the instance that happens to
 * be selected in the toolbar would hit an unrelated tribe.
 *
 * server_key is `<Map>_<hash>`, so the map prefix is what we match on.
 * Only a UNIQUE match auto-resolves: with two servers on the same map
 * the prefix cannot tell them apart, and guessing is exactly the
 * mistake this function exists to prevent.
 */
export function instanceForRow(instances: ServerInstance[], serverKey: string): ServerInstance | null {
  const prefix = serverKey.split('_')[0]
  const hits = instances.filter(i => i.map_name.split('_')[0] === prefix)
  return hits.length === 1 ? hits[0] : null
}

/**
 * Auto-resolved target, else the toolbar selection -- but only when the
 * toolbar serves the row's own map. With no unique match (no instance, or
 * two on the same map) a toolbar sitting on another map would aim the
 * command at an unrelated tribe, which is exactly what instanceForRow
 * exists to prevent; the operator picks the right server instead.
 */
export function targetFor(
  instances: ServerInstance[],
  cmdInstance: number | '',
  serverKey: string,
): ServerInstance | null {
  const picked = instances.find(i => i.id === cmdInstance)
  return instanceForRow(instances, serverKey)
    ?? (picked && picked.map_name.split('_')[0] === serverKey.split('_')[0] ? picked : null)
}

/** The label the operator reads for an instance. */
export function instanceLabel(instance: ServerInstance): string {
  return instance.display_name || instance.name
}
