/**
 * Small helpers shared by the ArkShop editor: the tab ids, the readable name
 * of a blueprint path, the JSON-with-comments cleaner ArkShop's own config
 * files need, and the defaults of a new entry.
 */
import type { ArkShopEntry } from '../../services/api'

export type Tab = 'mysql' | 'general' | 'shop' | 'kits' | 'sell' | 'messages'

/** 'Blueprint"/Game/.../PrimalItemArmor_RexSaddle"' -> 'Rex Saddle'. */
export function bpName(bp: string): string {
  const match = bp?.match(/\.([^.']+)'?$/)
  if (!match) return bp || '?'
  return match[1]
    .replace(/PrimalItem_|PrimalItemArmor_|PrimalItemResource_|PrimalItemStructure_|PrimalItemConsumable_|PrimalItemConsumableEatable_|PrimalItemAmmo_|PrimalItemSkin_|PrimalItemArtifact_|PrimalItem_Weapon/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
}

/** Strip the BOM, `//` comments outside strings and trailing commas. */
export function cleanJsonComments(raw: string): string {
  const lines = raw.replace(/^﻿/, '').split('\n').map(line => {
    if (line.trimStart().startsWith('//')) return ''
    let inString = false
    let result = ''
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"' && (i === 0 || line[i - 1] !== '\\')) inString = !inString
      if (!inString && char === '/' && i + 1 < line.length && line[i + 1] === '/') break
      result += char
    }
    return result
  })
  return lines.join('\n').replace(/,\s*([}\]])/g, '$1')
}

export const NEW_SHOP_ENTRY: ArkShopEntry = {
  key: '', Title: '', Description: '', Price: 10, Type: 'item', Permissions: 'WL', Items: [],
}
export const NEW_KIT_ENTRY: ArkShopEntry = {
  key: '', Description: '', Price: 10, DefaultAmount: 1, MaxLevel: 0,
  OnlyFromSpawn: false, Permissions: 'WL', Items: [], Dinos: [],
}
export const NEW_SELL_ENTRY: ArkShopEntry = {
  key: '', Description: '', Price: 10, Amount: 1, Blueprint: '', Type: 'item',
}

/** One line of an entry: either an item (Blueprint) or a console command. */
export interface SubItem extends Record<string, unknown> {
  Amount?: number
  Blueprint?: string
  ForceBlueprint?: boolean
  Quality?: number
  Command?: string
  DisplayAs?: string
  ExecuteAsAdmin?: boolean
}

export function isCommandLine(line: SubItem): boolean {
  return !line.Blueprint && (line.Command !== undefined || line.DisplayAs !== undefined)
}
