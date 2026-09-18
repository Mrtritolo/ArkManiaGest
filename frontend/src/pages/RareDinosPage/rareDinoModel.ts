/**
 * rareDinoModel — types, the stat list and the map options of the rare-dino
 * pool. No React, no API.
 */
import { Drumstick, Droplet, Heart, Swords, Weight, Wind, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface RareDino {
  id: number; map_name: string; dino_bp: string; display_name: string; enabled: boolean
  health_min: number; health_max: number; stamina_min: number; stamina_max: number
  oxygen_min: number; oxygen_max: number; food_min: number; food_max: number
  weight_min: number; weight_max: number; melee_min: number; melee_max: number
  speed_min: number; speed_max: number; extra: string | null
}

export interface BpItem { name: string; blueprint: string; category: string }

/** Labels come from i18n: rareDinos.stats.<key>. */
export const STATS: { key: string; icon: LucideIcon }[] = [
  { key: 'health', icon: Heart },
  { key: 'stamina', icon: Zap },
  { key: 'oxygen', icon: Droplet },
  { key: 'food', icon: Drumstick },
  { key: 'weight', icon: Weight },
  { key: 'melee', icon: Swords },
  { key: 'speed', icon: Wind },
]

export const DEFAULT_STATS = {
  health_min: 35, health_max: 45, stamina_min: -1, stamina_max: -1,
  oxygen_min: -1, oxygen_max: -1, food_min: -1, food_max: -1,
  weight_min: 35, weight_max: 45, melee_min: 35, melee_max: 45,
  speed_min: -1, speed_max: -1,
}

/** The maps the pool can be scoped to; labels come from rareDinos.maps.<value>. */
export const MAP_OPTIONS = [
  'TheIsland_WP', 'TheCenter_WP', 'ScorchedEarth_WP', 'Aberration_WP',
  'Extinction_WP', 'Ragnarok_WP', 'Valguero_WP', 'Astraeos_WP',
  'LostCity_WP', 'LostColony_WP', 'Genesis_WP',
]

/** A stat range, or null when the stat is switched off (min < 0). */
export function formatStat(min: number, max: number): string | null {
  if (min < 0) return null
  return `${min}-${max}`
}

/** The form shape the modal edits: the blueprint, the map and the stat pairs. */
export type DinoForm = Record<string, string | number | boolean>

export function statValue(form: DinoForm, key: string): number {
  return Number(form[key] ?? -1)
}
