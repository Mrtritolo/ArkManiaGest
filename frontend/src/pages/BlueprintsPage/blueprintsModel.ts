/**
 * Shared model for the blueprint catalogue page: the row shape, the icon per
 * blueprint type, the page size and the import-file parser.
 */
import {
  Box, Crown, Gem, Home, Package, Shield, Sword, Terminal, Utensils,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface BpItem {
  id: number; name: string; blueprint: string; category: string
  type: string; gfi: string | null; source: string | null; description?: string
}

/** Type is a category, never a status: the icon carries it, never a colour. */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  dino: Box, weapon: Sword, armor: Shield, structure: Home,
  consumable: Utensils, resource: Gem, cosmetic: Crown,
  artifact: Crown, command: Terminal, item: Package,
}

export function typeIcon(type: string): LucideIcon {
  return TYPE_ICONS[type] || Package
}

/** Rows per page, matching the backend default. */
export const LIMIT = 50

export type ImportParse =
  | { ok: true; data: unknown[] }
  | { ok: false; reason: 'notArray' }
  | { ok: false; reason: 'parse'; message: string | null }

/**
 * Parse an exported blueprint file: strip the BOM and `//` comment lines, then
 * accept either a bare array or a `{ blueprints: [...] }` wrapper.
 */
export function parseBlueprintImport(raw: string): ImportParse {
  try {
    const clean = raw
      .replace(/^﻿/, '')
      .split('\n')
      .map(line => (line.trimStart().startsWith('//') ? '' : line))
      .join('\n')
    const parsed: unknown = JSON.parse(clean)
    if (Array.isArray(parsed)) return { ok: true, data: parsed }
    const wrapped = (parsed as { blueprints?: unknown })?.blueprints
    if (Array.isArray(wrapped)) return { ok: true, data: wrapped }
    return { ok: false, reason: 'notArray' }
  } catch (err) {
    return { ok: false, reason: 'parse', message: err instanceof Error ? err.message : null }
  }
}
