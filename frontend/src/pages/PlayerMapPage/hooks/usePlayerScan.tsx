/**
 * usePlayerScan — the scan itself and every action fired from its result.
 *
 * doDestroy, doDestroyOne and doKillPlayer all re-scan through runScan, which
 * reads the target from this same closure, so they have to live together: the
 * map must show the post-action truth, for the player and server the snapshot
 * belongs to.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi, type ScanKind } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import type { PlayerListItem, ServerInstance } from '../../../types'
import { nextSort, useConfirm } from '../../../components/ui'
import {
  mapPrefix, newestPerKey, pickLatestBatch, rowName,
  type ScanBaseline, type ScanRow, type ScanSort, type ScanTarget, type SortKey,
} from '../mapModel'

interface Args {
  players: PlayerListItem[]
  instances: ServerInstance[]
  setError: (v: string) => void
}

export function usePlayerScan({ players, instances, setError }: Args) {
  const { t } = useTranslation()
  const confirm = useConfirm()

  const [eosId, setEosIdState] = useState('')
  const [instanceId, setInstanceIdState] = useState<number | ''>('')
  const [scanning, setScanning] = useState(false)
  const [scanReply, setScanReply] = useState('')
  const [target, setTarget] = useState<ScanTarget | null>(null)
  const [rows, setRows] = useState<ScanRow[]>([])
  // Which layers the map draws. A base with 2000 foundations buries the
  // handful of dots that matter, so the admin turns layers off to read the
  // map -- and can re-scan just one layer without redoing the slow sweep.
  const [layers, setLayers] = useState<Record<string, boolean>>({
    structure: true, dino: true, player: true,
  })
  const [truncated, setTruncated] = useState(false)
  // Set when two active servers share the map and the scan left no rows
  // that can only be the selected server's: the map is kept empty.
  const [unattributed, setUnattributed] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)   // index into rows
  const [sort, setSort] = useState<ScanSort>(null)
  const [radius, setRadius] = useState(30)
  const [acting, setActing] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  /** The pickers as a scan target, or null while either is unset. */
  function selectionTarget(): ScanTarget | null {
    const inst = instances.find(i => i.id === instanceId)
    if (!eosId || !inst) return null
    const who = players.find(p => p.eos_id === eosId)?.name || eosId
    return {
      eosId, instanceId: inst.id, mapName: inst.map_name,
      label: `${who} — ${inst.display_name || inst.name} (${inst.map_name})`,
    }
  }

  /** A new player or server makes the snapshot on screen someone else's. */
  function clearScan() {
    setTarget(null); setRows([]); setTruncated(false); setSelected(null)
    setScanReply(''); setActionMsg(''); setUnattributed(false)
  }

  function setEosId(value: string) { setEosIdState(value); clearScan() }
  function setInstanceId(value: number | '') { setInstanceIdState(value); clearScan() }

  /**
   * Load the snapshot for `tgt`. `before` is the newest scanned_at per
   * server_key read just before the scan, passed only while a same-map
   * target is unresolved.
   */
  async function loadRows(tgt: ScanTarget, before: ScanBaseline | null) {
    const res = await arkDecayApi.playerScanRows(tgt.eosId, tgt.serverKey)
    // The endpoint returns the player's rows from every map ever scanned.
    // Only the scanned instance's map may be shown: when this scan found
    // nothing, the newest rows would otherwise be an older snapshot of
    // another map, and every action below would fire its tribe id and
    // coordinates at this server.
    const all: ScanRow[] = (res.data.rows || []).filter(
      (r: ScanRow) => mapPrefix(r.map_name) === mapPrefix(tgt.mapName))
    let sk = tgt.serverKey
    if (before) {
      // Two active servers run this map, and the prefix cannot tell their
      // rows apart: when this scan found nothing or failed, the newest rows
      // are the other server's older snapshot. Only a server_key whose rows
      // this scan moved forward is ours. A key missing from a truncated
      // baseline proves nothing. Anything but exactly one such key leaves
      // the map empty rather than arming actions with another server's data.
      const fresh = [...newestPerKey(all)].filter(([key, s]) => {
        const was = before.newest.get(key)
        return was === undefined ? before.complete : s > was
      })
      if (fresh.length !== 1) { setRows([]); setTruncated(false); setUnattributed(true); return }
      sk = fresh[0][0]
      setTarget({ ...tgt, serverKey: sk })
    }
    if (all.length === 0) { setRows([]); setTruncated(false); return }
    // With a single active server on this map, its newest rows are its own.
    sk = sk ?? all[0].server_key
    setRows(pickLatestBatch(all.filter(r => r.server_key === sk)))
    setTruncated(!!res.data.truncated)
  }

  // A non-null target always matches the pickers (changing either clears it),
  // so re-scans reuse it and keep a server_key already resolved.
  async function runScan(kind: ScanKind = 'all', tgt: ScanTarget | null = target ?? selectionTarget()) {
    if (!tgt) return
    setTarget(tgt)
    setScanning(true); setError(''); setScanReply(''); setSelected(null); setActionMsg(''); setUnattributed(false)
    // A layer you just re-scanned is a layer you want to look at.
    if (kind === 'structures') setLayers(l => ({ ...l, structure: true }))
    else if (kind === 'dinos') setLayers(l => ({ ...l, dino: true }))
    else if (kind === 'players') setLayers(l => ({ ...l, player: true }))
    try {
      // Another active server on the same map: record how fresh each
      // server's rows are before scanning, so loadRows can tell which
      // server_key this scan wrote to.
      let before: ScanBaseline | null = null
      const sameMap = instances.filter(i => mapPrefix(i.map_name) === mapPrefix(tgt.mapName)).length > 1
      if (sameMap && !tgt.serverKey) {
        const prev = await arkDecayApi.playerScanRows(tgt.eosId)
        before = { newest: newestPerKey(prev.data.rows || []), complete: !prev.data.truncated }
      }
      const res = await arkDecayApi.playerScanRun(tgt.eosId, tgt.instanceId, kind)
      setScanReply(res.data.reply || '')
      if (res.data.status !== 'success') setError(res.data.stderr || res.data.reply || t('decay.cmd.rconFailed'))
      await loadRows(tgt, before)
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setScanning(false)
    }
  }

  /**
   * Show an action's outcome. Called after the re-scan, which clears both
   * the message and the error: set before it, the plugin's reply (including
   * a refusal such as "player offline") was wiped before it ever rendered.
   * The endpoint answers 200 even when SSH/RCON failed; `status` says so.
   */
  function reportAction(r: { status: string; reply: string; stderr: string | null }) {
    if (r.status === 'success') setActionMsg(r.reply || '')
    else setError(r.stderr || r.reply || t('decay.cmd.rconFailed'))
  }

  async function doDestroy(kind: 'structures' | 'dinos' | 'all', center: ScanRow, radiusM: number) {
    if (!target) return
    const what = t(`playerMap.actions.${kind}`)
    // One dialog, not two: "everything" adds its warning and the typed
    // confirmation instead of a second window.
    const ok = await confirm({
      title: t('playerMap.confirmDestroyTitle', { what }),
      description: (
        <>
          <span className="u-mono">{target.label}</span>
          <br />
          {t('playerMap.confirmDestroy', { what, r: radiusM })}
          {kind === 'all' && <> {t('playerMap.confirmAll')}</>}
        </>
      ),
      confirmLabel: t('playerMap.confirmDestroyAction', { what }),
      confirmText: kind === 'all' ? t('playerMap.destroyAllWord') : undefined,
      tone: 'danger',
    })
    if (!ok) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyRadius({
        instance_id: target.instanceId, targeting_team: center.targeting_team,
        x: center.pos_x, y: center.pos_y, z: center.pos_z, radius_m: radiusM, kind,
      })
      await runScan('all', target)   // the map must show the post-action truth
      reportAction(res.data)
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setActing(false)
    }
  }

  async function doDestroyOne(row: ScanRow) {
    if (!row.actor_name || !target) return
    const label = rowName(row)
    const ok = await confirm({
      title: t('playerMap.destroyThis'),
      description: (
        <>
          <span className="u-mono">{target.label}</span>
          <br />
          {t('playerMap.confirmDestroyOne', { what: label })}
        </>
      ),
      confirmLabel: t('playerMap.confirmDestroyOneAction'),
      tone: 'danger',
    })
    if (!ok) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyActor(
        target.instanceId, row.targeting_team, row.actor_name)
      await runScan('all', target)
      reportAction(res.data)
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setActing(false)
    }
  }

  async function doKillPlayer() {
    if (!target) return
    const ok = await confirm({
      title: t('playerMap.killPlayer'),
      description: (
        <>
          <span className="u-mono">{target.label}</span>
          <br />
          {t('playerMap.confirmKill')}
        </>
      ),
      confirmLabel: t('playerMap.confirmKillAction'),
      tone: 'danger',
    })
    if (!ok) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.killPlayer(target.eosId, target.instanceId)
      await runScan('all', target)
      reportAction(res.data)
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setActing(false)
    }
  }

  const toggleLayer = useCallback((k: string) => {
    setLayers(l => ({ ...l, [k]: !l[k] }))
    setSelected(null)
  }, [])

  /** asc -> desc -> back to scan order. */
  const toggleSort = useCallback((k: SortKey) => {
    setSort(s => (s?.key === k && s.dir === 'desc' ? null : nextSort(s, k)))
  }, [])

  return {
    eosId, setEosId, instanceId, setInstanceId,
    scanning, scanReply, target, rows, layers, truncated, unattributed,
    selected, setSelected, sort, toggleSort, radius, setRadius,
    acting, actionMsg,
    runScan, doDestroy, doDestroyOne, doKillPlayer, toggleLayer,
  }
}

export type PlayerScan = ReturnType<typeof usePlayerScan>
