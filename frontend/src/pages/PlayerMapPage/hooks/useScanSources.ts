/**
 * useScanSources — everything the pickers need: the full player roster, the
 * active instances, and the two calibration sources.
 *
 * No silent catches: if one of these fails the pickers stay empty and the
 * page looks broken without saying why -- it happened twice, once with the
 * 422 on the page limit and once with the 500 on the enum.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi, arkmaniaApi, playersApi, serverInstancesApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import type { PlayerListItem, ServerInstance } from '../../../types'
import { calibFromWorldSettings, parseCalibOverrides, type MapCalib } from '../../../utils/mapCalibration'

/** The list endpoint's hard cap per request; asking for more is a 422. */
const PAGE = 500
/** Runaway guard, not a product limit: far above any plausible roster. */
const MAX_PLAYERS = 20_000
/** The combobox shows the best matches, not the whole roster. */
export const PLAYER_OPTIONS_CAP = 50

interface Args {
  setError: (v: string) => void
}

export function useScanSources({ setError }: Args) {
  const { t } = useTranslation()
  const [players, setPlayers] = useState<PlayerListItem[]>([])
  const [instances, setInstances] = useState<ServerInstance[]>([])
  const [playerFilter, setPlayerFilter] = useState('')
  const [calibOverrides, setCalibOverrides] = useState<Record<string, MapCalib>>({})
  // Calibration the plugin read out of the running world. Authoritative:
  // it is what the game itself uses for GPS, mod maps included.
  const [calibFromGame, setCalibFromGame] = useState<Record<string, MapCalib>>({})

  // Every player, not the first page: walking the pages beats silently
  // showing whoever happened to land in page one.
  const loadAllPlayers = useCallback(async () => {
    const acc: PlayerListItem[] = []
    for (let offset = 0; ; offset += PAGE) {
      const r = await playersApi.list({ limit: PAGE, offset })
      acc.push(...r.data)
      // Short page = last page.
      if (r.data.length < PAGE || acc.length >= MAX_PLAYERS) break
    }
    setPlayers(acc)
  }, [])

  useEffect(() => {
    loadAllPlayers()
      .catch(e => setError(extractError(e, t('playerMap.loadFailed'))))
    serverInstancesApi.list({ active_only: true })
      .then(r => setInstances(r.data))
      .catch(e => setError(extractError(e, t('playerMap.loadFailed'))))
    // Per-map GPS overrides for mod maps (or corrections to a default),
    // stored in ARKM_config as PlayerMap.MapCalibration. Absent = no
    // override, we fall back to DEFAULT_CALIBRATION then to raw UU.
    arkmaniaApi.getConfig('PlayerMap.MapCalibration', '*')
      .then(r => setCalibOverrides(parseCalibOverrides(r.data.config_value)))
      .catch(() => setCalibOverrides({}))
    arkDecayApi.mapCalibration()
      .then(r => {
        const out: Record<string, MapCalib> = {}
        for (const m of r.data.maps) {
          const c = calibFromWorldSettings(m)
          if (c) out[m.map_name] = c
        }
        setCalibFromGame(out)
      })
      .catch(() => setCalibFromGame({}))
  }, [loadAllPlayers])

  // Servers in the picker, alphabetical by the label the admin actually
  // reads -- the API returns them in registration order.
  const sortedInstances = useMemo(
    () => [...instances].sort((a, b) =>
      (a.display_name || a.name).localeCompare(b.display_name || b.name, undefined,
        { sensitivity: 'base', numeric: true })),
    [instances])

  const filteredPlayers = useMemo(() => {
    const q = playerFilter.trim().toLowerCase()
    const base = q
      ? players.filter(p => (p.name || '').toLowerCase().includes(q) || p.eos_id.toLowerCase().includes(q))
      : players
    // localeCompare so accented names land where an Italian reader expects.
    return [...base]
      .sort((a, b) => {
        // Nameless accounts sink to the bottom instead of heading the
        // list under an empty string.
        if (!a.name !== !b.name) return a.name ? -1 : 1
        return (a.name || a.eos_id).localeCompare(b.name || b.eos_id, undefined,
          { sensitivity: 'base', numeric: true })
      })
      .slice(0, PLAYER_OPTIONS_CAP)
  }, [players, playerFilter])

  return {
    players, instances, sortedInstances, filteredPlayers,
    playerFilter, setPlayerFilter,
    calibOverrides, calibFromGame,
  }
}

export type ScanSources = ReturnType<typeof useScanSources>
