/**
 * PlayerMapPage — On-demand player scan with a spatial minimap.
 *
 * Flow: pick a player and a server instance, trigger the plugin's
 * ARKM.DM.PlayerScan over RCON, then render the snapshot from
 * ARKM_player_scan: where the player is, where their structures and dinos
 * are. From a selected point the admin can surgically destroy the tribe's
 * structures/dinos within a radius (ARKM.DM.DestroyRadius) or kill the
 * player if online (ARKM.DM.KillPlayer). Every action re-scans so the map
 * always shows the post-action truth.
 *
 * The minimap uses real GPS placement when the map is calibrated (official
 * maps built in, mod maps via the PlayerMap.MapCalibration config key), and
 * falls back to an auto-fit UU scatter (relative positions) otherwise.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScanKind } from '../services/api'
import { arkDecayApi, playersApi, serverInstancesApi, arkmaniaApi } from '../services/api'
import type { PlayerListItem, ServerInstance } from '../types'
import { DEFAULT_CALIBRATION, parseCalibOverrides, calibFromWorldSettings, gpsOf, fullMapBounds, type MapCalib } from '../utils/mapCalibration'
import {
  Crosshair, Loader2, AlertTriangle, RefreshCw, Building, Skull, MapPin, Copy,
  Eye, EyeOff, ZoomIn, ZoomOut, Maximize2
} from 'lucide-react'

interface ScanRow {
  targeting_team: number; server_key: string; map_name: string
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number
  dino_level: number; is_online: boolean; scanned_at: string | null
  actor_name: string | null
}

// Neon palette with a dark halo. The dots sit on top of a photographic
// topographic map, where a muted theme colour simply disappears; the
// stroke keeps them readable over both the pale coastlines and the dark
// interior.
const DOT: Record<string, { r: number; fill: string }> = {
  structure: { r: 3, fill: '#00e5ff' },   // cyan
  dino:      { r: 5, fill: '#c026ff' },   // magenta
  player:    { r: 7, fill: '#ff2d55' },   // hot pink/red
}
const DOT_HALO = 'rgba(0, 0, 0, 0.75)'
const OFFLINE_FILL = '#ffd400'            // acid yellow: offline character

export default function PlayerMapPage() {
  const { t } = useTranslation()

  const [players, setPlayers] = useState<PlayerListItem[]>([])
  const [instances, setInstances] = useState<ServerInstance[]>([])
  const [playerFilter, setPlayerFilter] = useState('')
  const [eosId, setEosId] = useState('')
  const [instanceId, setInstanceId] = useState<number | ''>('')

  const [scanning, setScanning] = useState(false)
  const [scanReply, setScanReply] = useState('')
  const [rows, setRows] = useState<ScanRow[]>([])
  // Which layers the map draws. A base with 2000 foundations buries the
  // handful of dots that matter, so the admin turns layers off to read the
  // map -- and can re-scan just one layer without redoing the slow sweep.
  const [layers, setLayers] = useState<Record<ScanRow['actor_type'], boolean>>({
    structure: true, dino: true, player: true,
  })
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)   // index into rows
  const [radius, setRadius] = useState(30)
  const [acting, setActing] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  const [calibOverrides, setCalibOverrides] = useState<Record<string, MapCalib>>({})
  // Calibration the plugin read out of the running world. Authoritative:
  // it is what the game itself uses for GPS, mod maps included.
  const [calibFromGame, setCalibFromGame] = useState<Record<string, MapCalib>>({})
  // Zoom/pan over the map square, in SVG units.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null)
  // Cached topographic image as an object URL, tagged with the map it
  // belongs to. Tagging matters: while a new map's image is in flight the
  // old URL is still in state, and drawing it would show the previous
  // map's terrain under the new map's dots.
  const [mapImg, setMapImg] = useState<{ name: string; url: string } | null>(null)

  // Servers in the picker, alphabetical by the label the admin actually
  // reads -- the API returns them in registration order.
  const sortedInstances = useMemo(
    () => [...instances].sort((a, b) =>
      (a.display_name || a.name).localeCompare(b.display_name || b.name, undefined,
        { sensitivity: 'base', numeric: true })),
    [instances])

  // Every player, not the first page. 500 is the endpoint's hard cap per
  // request (asking for more is a 422), so we walk the pages instead of
  // silently showing whoever happened to land in page one.
  const loadAllPlayers = useCallback(async () => {
    const PAGE = 500
    const acc: PlayerListItem[] = []
    for (let offset = 0; ; offset += PAGE) {
      const r = await playersApi.list({ limit: PAGE, offset })
      acc.push(...r.data)
      // Short page = last page. The ceiling is a runaway guard, not a
      // product limit: it is far above any plausible roster.
      if (r.data.length < PAGE || acc.length >= 20_000) break
    }
    setPlayers(acc)
  }, [])

  useEffect(() => {
    loadAllPlayers()
      .catch(e => setError(e.response?.data?.detail?.[0]?.msg || String(e)))
    // Niente catch muto: se questa fallisce la tendina dei server resta
    // vuota e la pagina sembra rotta senza dire perche' - e' successo due
    // volte, una col 422 sul limite e una col 500 sull'enum.
    serverInstancesApi.list({ active_only: true })
      .then(r => setInstances(r.data))
      .catch(e => setError(e.response?.data?.detail || String(e)))
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

  // Calibration active for the map currently shown, if any.
  const mapName = rows[0]?.map_name || ''

  // A new map starts from the full view.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [mapName])
  // A hand-written override still wins: it is how you correct a map whose
  // own settings are wrong. Then the game's own numbers, then our table.
  const calib: MapCalib | null =
    calibOverrides[mapName] || calibFromGame[mapName] || DEFAULT_CALIBRATION[mapName] || null

  // Background image follows the displayed map. Revoked on change so the
  // blobs do not pile up as the admin hops between maps.
  useEffect(() => {
    if (!mapName) return
    let cancelled = false
    // The previous URL is revoked at the moment it is replaced, not in the
    // cleanup: revoking on dependency change killed the image that was
    // still on screen while the next one downloaded.
    const swap = (next: { name: string; url: string } | null) =>
      setMapImg(prev => {
        if (prev && prev.url !== next?.url) URL.revokeObjectURL(prev.url)
        return next
      })
    arkDecayApi.mapImage(mapName)
      .then(r => { if (!cancelled) swap({ name: mapName, url: URL.createObjectURL(r.data) }) })
      .catch(() => { if (!cancelled) swap(null) })
    return () => { cancelled = true }
  }, [mapName])

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
  }, [players, playerFilter])

  async function loadRows(eos: string) {
    const res = await arkDecayApi.playerScanRows(eos)
    const all: ScanRow[] = res.data.rows || []
    if (all.length === 0) { setRows([]); setTruncated(false); return }
    // Keep only the newest scan batch, PER LAYER: a per-layer re-scan
    // leaves the other layers with an older timestamp, and a single
    // cluster-wide cutoff would silently drop them from the map.
    // Chunked inserts straddle seconds, hence the 2-minute window.
    const sk = all[0].server_key
    const onMap = all.filter(r => r.server_key === sk)
    const newestOf: Record<string, number> = {}
    for (const r of onMap) {
      const t = new Date(r.scanned_at || 0).getTime()
      if (!(r.actor_type in newestOf) || t > newestOf[r.actor_type]) newestOf[r.actor_type] = t
    }
    setRows(onMap.filter(r =>
      Math.abs(new Date(r.scanned_at || 0).getTime() - newestOf[r.actor_type]) < 120_000))
    setTruncated(!!res.data.truncated)
  }

  async function runScan(kind: ScanKind = 'all') {
    if (!eosId || instanceId === '') return
    setScanning(true); setError(''); setScanReply(''); setSelected(null); setActionMsg('')
    // A layer you just re-scanned is a layer you want to look at.
    if (kind === 'structures') setLayers(l => ({ ...l, structure: true }))
    else if (kind === 'dinos') setLayers(l => ({ ...l, dino: true }))
    else if (kind === 'players') setLayers(l => ({ ...l, player: true }))
    try {
      const res = await arkDecayApi.playerScanRun(eosId, instanceId as number, kind)
      setScanReply(res.data.reply || '')
      if (res.data.status !== 'success') setError(res.data.stderr || res.data.reply || 'RCON failed')
      await loadRows(eosId)
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setScanning(false)
    }
  }

  async function doDestroy(kind: 'structures' | 'dinos' | 'all', center: ScanRow, radiusM: number) {
    const label = t(`playerMap.actions.${kind}`)
    if (!window.confirm(t('playerMap.confirmDestroy', { what: label, r: radiusM }))) return
    if (kind === 'all' && !window.confirm(t('playerMap.confirmAll'))) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyRadius({
        instance_id: instanceId as number, targeting_team: center.targeting_team,
        x: center.pos_x, y: center.pos_y, z: center.pos_z, radius_m: radiusM, kind,
      })
      setActionMsg(res.data.reply || '')
      await runScan()   // the map must show the post-action truth
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
    }
  }

  async function doDestroyOne(row: ScanRow) {
    if (!row.actor_name) return
    const label = row.custom_name || row.display_name || row.class_name
    if (!window.confirm(t('playerMap.confirmDestroyOne', { what: label }))) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyActor(
        instanceId as number, row.targeting_team, row.actor_name)
      setActionMsg(res.data.reply || '')
      await runScan()
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
    }
  }

  async function doKillPlayer() {
    if (!window.confirm(t('playerMap.confirmKill'))) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.killPlayer(eosId, instanceId as number)
      setActionMsg(res.data.reply || '')
      await runScan()
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
    }
  }

  // ── Minimap geometry ───────────────────────────────────────────────────
  // Calibrated map: fixed square = the whole map (GPS 0..100), so dots sit
  // at their true in-game position and the axes read as GPS. Uncalibrated:
  // auto-fit around the objects (relative positions only, no GPS meaning).
  // Rows the map and table actually show, each paired with its index in
  // `rows` so selection keeps pointing at the master list.
  const visible = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ r }) => layers[r.actor_type]),
    [rows, layers])

  const view = useMemo(() => {
    if (visible.length === 0) return null
    if (calib) {
      const b = fullMapBounds(calib)
      const span = Math.max(b.spanX, b.spanY)
      return { minX: b.minX, minY: b.minY, span, calibrated: true }
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const { r } of visible) {
      if (r.pos_x < minX) minX = r.pos_x; if (r.pos_x > maxX) maxX = r.pos_x
      if (r.pos_y < minY) minY = r.pos_y; if (r.pos_y > maxY) maxY = r.pos_y
    }
    const spanX = Math.max(maxX - minX, 1000), spanY = Math.max(maxY - minY, 1000)
    const pad = 0.06 * Math.max(spanX, spanY)
    return { minX: minX - pad, minY: minY - pad, span: Math.max(spanX, spanY) + 2 * pad, calibrated: false }
  }, [visible, calib])

  const SIZE = 560
  function px(r: ScanRow) { return view ? ((r.pos_x - view.minX) / view.span) * SIZE : 0 }
  function py(r: ScanRow) { return view ? ((r.pos_y - view.minY) / view.span) * SIZE : 0 }
  /**
   * Coordinates the way a player reads them in game: GPS lat/lon.
   *
   * The raw world units are what the plugin stores and what `cheat
   * TPCoords` needs, but they mean nothing to anyone looking at the map,
   * so they only show when the map has no calibration to convert them.
   */
  function coordLabel(r: ScanRow): string {
    const g = gpsLabel(r)
    if (g) { const [la, lo] = g.split(', '); return `Lat ${la}  Lon ${lo}` }
    return `${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`
  }

  function gpsLabel(r: ScanRow) {
    if (!calib) return null
    const g = gpsOf(calib, r.pos_x, r.pos_y)
    return `${g.lat.toFixed(1)}, ${g.lon.toFixed(1)}`
  }

  // Zoom works on the SVG viewBox rather than by scaling coordinates, so
  // one dot stays one dot: stroke widths, labels and hit areas keep their
  // pixel size while the terrain underneath gets bigger.
  const VIEW = SIZE / zoom
  const maxPan = Math.max(0, SIZE - VIEW)
  const clampPan = (v: number) => Math.min(maxPan, Math.max(0, v))
  const viewBox = `${clampPan(pan.x)} ${clampPan(pan.y)} ${VIEW} ${VIEW}`
  // Anything drawn in viewBox units shrinks as we zoom in; divide by zoom
  // to keep it visually constant.
  const k = 1 / zoom

  function zoomAt(factor: number, cx?: number, cy?: number) {
    setZoom(prevZoom => {
      const next = Math.min(8, Math.max(1, prevZoom * factor))
      if (next === prevZoom) return prevZoom
      // Keep the point under the cursor fixed while the window shrinks.
      const px0 = cx ?? SIZE / 2, py0 = cy ?? SIZE / 2
      setPan(prevPan => {
        const oldView = SIZE / prevZoom, newView = SIZE / next
        const wx = clampPan(prevPan.x) + (px0 / SIZE) * oldView
        const wy = clampPan(prevPan.y) + (py0 / SIZE) * oldView
        const nx = wx - (px0 / SIZE) * newView
        const ny = wy - (py0 / SIZE) * newView
        const lim = Math.max(0, SIZE - newView)
        return { x: Math.min(lim, Math.max(0, nx)), y: Math.min(lim, Math.max(0, ny)) }
      })
      return next
    })
  }

  const sel = selected !== null ? rows[selected] : null
  const anyOnline = rows.some(r => r.actor_type === 'player' && r.is_online)
  const nStruct = rows.filter(r => r.actor_type === 'structure').length
  const nDino = rows.filter(r => r.actor_type === 'dino').length
  const nChar = rows.filter(r => r.actor_type === 'player').length

  function toggleLayer(k: ScanRow['actor_type']) {
    setLayers(l => ({ ...l, [k]: !l[k] }))
    setSelected(null)
  }

  function copyTp(r: ScanRow) {
    navigator.clipboard?.writeText(`cheat TPCoords ${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`).catch(() => {})
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1><Crosshair size={22} style={{ verticalAlign: -4, marginRight: 8 }} />{t('playerMap.title')}</h1>
        <p className="page-subtitle">{t('playerMap.subtitle')}</p>
      </div>

      {/* Selettori */}
      <div className="card" style={{ padding: '0.9rem 1rem', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 260 }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('playerMap.player')}</label>
          <input className="input" placeholder={t('playerMap.searchPlayer')} value={playerFilter}
            onChange={e => setPlayerFilter(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          <select className="input" value={eosId} onChange={e => setEosId(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
            <option value="">—</option>
            {filteredPlayers.map(p => (
              <option key={p.eos_id} value={p.eos_id}>{p.name || t('playerMap.noName')} ({p.eos_id.slice(0, 10)}…)</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('playerMap.server')}</label>
          <select className="input" value={instanceId} onChange={e => setInstanceId(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '100%', marginTop: 4 }}>
            <option value="">—</option>
            {sortedInstances.map(i => (
              <option key={i.id} value={i.id}>{i.display_name || i.name} ({i.map_name})</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => runScan('all')} disabled={scanning || !eosId || instanceId === ''}>
          {scanning ? <><Loader2 size={14} className="pl-spin" /> {t('playerMap.scanning')}</> : <><RefreshCw size={14} /> {t('playerMap.scan')}</>}
        </button>
        {/* Per-layer re-scan: same command, one layer. The plugin wipes only
            that layer's snapshot, so the others stay on the map. */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([['structures', 'scanStructures'], ['dinos', 'scanDinos'],
             ['players', 'scanPlayers']] as [ScanKind, string][]).map(([k, lbl]) => (
            <button key={k} className="btn btn-secondary btn-sm"
              onClick={() => runScan(k)}
              disabled={scanning || !eosId || instanceId === ''}
              title={t('playerMap.scanLayerHint')}>
              {t(`playerMap.${lbl}`)}
            </button>
          ))}
        </div>
        {scanReply && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexBasis: '100%' }}>{scanReply}</span>}

        {rows.length > 0 && (
        <>
        {/* Display filter, deliberately separate from the scan buttons above:
            hiding a layer only changes what you look at, it never touches
            the snapshot. A base with a couple of thousand foundations
            buries the handful of dots that matter. */}
        <div style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                      borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            {t('playerMap.showLabel')}
          </span>
          {([
            ['structure', nStruct, t('playerMap.structures')],
            ['dino', nDino, t('playerMap.dinos')],
            ['player', nChar, t('playerMap.characters')],
          ] as [ScanRow['actor_type'], number, string][]).map(([k, n, label]) => (
            <button key={k} onClick={() => toggleLayer(k)}
              className={layers[k] ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              style={layers[k] ? undefined : { opacity: 0.55 }}
              title={t('playerMap.toggleLayer')}>
              {layers[k] ? <Eye size={11} /> : <EyeOff size={11} />} {label} ({n})
            </button>
          ))}
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {t('playerMap.visibleCount', { shown: visible.length, total: rows.length })}
          </span>
        </div>
        </>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
      {actionMsg && <div className="alert alert-success" style={{ marginTop: 10 }}>{actionMsg}</div>}
      {truncated && (
        <div className="alert alert-warning" style={{ marginTop: 10 }}>
          <AlertTriangle size={14} /> {t('playerMap.truncated')}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Minimappa */}
          <div className="card" style={{ padding: 10 }}>
            {/* Plain legend: the filter itself lives in the toolbar above,
                where it is visible before you scroll down to the map. */}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 14 }}>
              <span style={{ opacity: layers.structure ? 1 : 0.35 }}>
                <Building size={11} /> {nStruct} {t('playerMap.structures')}
              </span>
              <span style={{ color: '#8b5cf6', opacity: layers.dino ? 1 : 0.35 }}>
                ● {nDino} {t('playerMap.dinos')}
              </span>
              <span style={{ color: 'var(--danger)', opacity: layers.player ? 1 : 0.35 }}>
                ● {t('playerMap.playerDot')} {anyOnline ? t('playerMap.online') : t('playerMap.offline')}
              </span>
              <span>{rows[0].map_name}</span>
            </div>
            <svg width={SIZE} height={SIZE} viewBox={viewBox}
              onWheel={e => {
                e.preventDefault()
                const b = e.currentTarget.getBoundingClientRect()
                zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2,
                  e.clientX - b.left, e.clientY - b.top)
              }}
              onPointerDown={e => {
                // Left button only, and never start a drag from a dot:
                // the dot's own click must still select it.
                if (e.button !== 0) return
                setDragging({ x: e.clientX, y: e.clientY })
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={e => {
                if (!dragging) return
                const dx = (e.clientX - dragging.x) / zoom
                const dy = (e.clientY - dragging.y) / zoom
                setDragging({ x: e.clientX, y: e.clientY })
                setPan(prev => ({ x: clampPan(prev.x - dx), y: clampPan(prev.y - dy) }))
              }}
              onPointerUp={e => {
                setDragging(null)
                e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              style={{ background: 'var(--bg-card-muted)', borderRadius: 8, border: '1px solid var(--border)', display: 'block', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
              {/* Topographic background: only meaningful when calibrated,
                  because only then does the square correspond to the whole
                  map. Uncalibrated maps keep the plain auto-fit view -- an
                  image stretched over arbitrary bounds would put dots in
                  convincingly wrong places. */}
              {mapImg?.name === mapName && view?.calibrated && (
                <image href={mapImg.url} x={0} y={0} width={SIZE} height={SIZE}
                  preserveAspectRatio="none" />
              )}
              {/* griglia leggera */}
              {[1, 2, 3].map(i => (
                <g key={i} stroke="var(--border)" strokeWidth={0.5 * k} opacity={0.6}>
                  <line x1={(SIZE / 4) * i} y1={0} x2={(SIZE / 4) * i} y2={SIZE} />
                  <line x1={0} y1={(SIZE / 4) * i} x2={SIZE} y2={(SIZE / 4) * i} />
                </g>
              ))}
              {/* etichette GPS agli angoli quando la mappa e' calibrata */}
              {view?.calibrated && (
                <g fill="var(--text-muted)" fontSize={9 * k} fontFamily="var(--font-mono)"
                   style={{ paintOrder: 'stroke' }} stroke="rgba(0,0,0,0.6)" strokeWidth={2 * k}>
                  <text x={3} y={11}>Lon 0 / Lat 0</text>
                  <text x={SIZE - 3} y={11} textAnchor="end">Lon 100</text>
                  <text x={3} y={SIZE - 4}>Lat 100</text>
                </g>
              )}
              {/* raggio anteprima sul punto selezionato */}
              {sel && view && (
                <circle cx={px(sel)} cy={py(sel)} r={(radius * 100 / view.span) * SIZE}
                  fill="var(--danger)" opacity={0.10} stroke="var(--danger)"
                  strokeDasharray={`${4 * k} ${3 * k}`} strokeWidth={1 * k} />
              )}
              {visible.map(({ r, i }) => {
                const d = DOT[r.actor_type] || DOT.structure
                const isSel = i === selected
                return (
                  <circle key={i} cx={px(r)} cy={py(r)}
                    r={(isSel ? d.r + 3 : d.r) * k}
                    fill={r.actor_type === 'player' && !r.is_online ? OFFLINE_FILL : d.fill}
                    stroke={isSel ? 'var(--accent)' : DOT_HALO}
                    strokeWidth={(isSel ? 2 : 1) * k}
                    style={{ cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); setSelected(i) }}>
                    <title>{`${r.custom_name || r.display_name || r.class_name}\n${coordLabel(r)}`}</title>
                  </circle>
                )
              })}
            </svg>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.4)}
                disabled={zoom <= 1} title={t('playerMap.zoomOut')}><ZoomOut size={12} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.4)}
                disabled={zoom >= 8} title={t('playerMap.zoomIn')}><ZoomIn size={12} /></button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                title={t('playerMap.zoomReset')}><Maximize2 size={12} /></button>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {zoom.toFixed(1)}x
              </span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {view?.calibrated ? t('playerMap.mapHintGps') : t('playerMap.mapHint')}
              {' '}{t('playerMap.zoomHint')}
            </div>
            {view && !view.calibrated && (
              <div style={{ fontSize: '0.68rem', color: '#b45309', marginTop: 4 }}>
                {t('playerMap.noCalibration', { map: mapName })}
              </div>
            )}
          </div>

          {/* Pannello azioni + lista */}
          <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: '0.8rem 1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}><MapPin size={13} /> {t('playerMap.actionsTitle')}</div>
              {sel ? (
                <>
                  <div style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                    <b>{sel.custom_name || sel.display_name || sel.class_name}</b>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: 8 }}>
                      <span style={{ color: 'var(--accent)' }}>{coordLabel(sel)}</span>
                      {gpsLabel(sel) && (
                        <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                          ({Math.round(sel.pos_x)} {Math.round(sel.pos_y)} {Math.round(sel.pos_z)})
                        </span>
                      )}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyTp(sel)} title="cheat TPCoords"><Copy size={10} /> TP</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '0.75rem' }}>{t('playerMap.radius')}</label>
                    <input type="number" className="input" style={{ width: 80 }} min={1} max={2000}
                      value={radius} onChange={e => setRadius(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} />
                    <button className="btn btn-danger btn-sm" disabled={acting} onClick={() => doDestroy('structures', sel, radius)}>
                      <Building size={11} /> {t('playerMap.actions.structures')}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={acting} onClick={() => doDestroy('dinos', sel, radius)}>
                      <Skull size={11} /> {t('playerMap.actions.dinos')}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={acting} onClick={() => doDestroy('all', sel, radius)}>
                      {t('playerMap.actions.all')}
                    </button>
                    {sel.actor_name && sel.actor_type !== 'player' && (
                      <button className="btn btn-danger btn-sm" disabled={acting}
                        onClick={() => doDestroyOne(sel)}
                        title={sel.actor_name}>
                        <Crosshair size={11} /> {t('playerMap.destroyThis')}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('playerMap.selectHint')}</div>
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-danger btn-sm" disabled={acting || !anyOnline} onClick={doKillPlayer}
                  title={anyOnline ? '' : t('playerMap.killOfflineHint')}>
                  <Skull size={11} /> {t('playerMap.killPlayer')}
                </button>
                {!anyOnline && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>{t('playerMap.killOfflineHint')}</span>}
              </div>
            </div>

            <div className="card" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 60px 190px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', padding: '0.35rem 0.8rem', position: 'sticky', top: 0, background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>{t('decay.detail.type')}</span><span>{t('decay.detail.name')}</span><span>{t('decay.detail.level')}</span><span>{t('decay.detail.coords')}</span>
              </div>
              {visible.map(({ r, i }) => (
                <div key={i} onClick={() => setSelected(i)} style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 60px 190px', alignItems: 'center',
                  fontSize: '0.76rem', padding: '0.24rem 0.8rem', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: i === selected ? 'var(--bg-card-muted)' : 'transparent',
                }}>
                  <span style={{ fontWeight: 600, color: r.actor_type === 'dino' ? '#8b5cf6' : r.actor_type === 'player' ? (r.is_online ? 'var(--danger)' : '#f59e0b') : 'var(--text-secondary)' }}>
                    {r.actor_type === 'player' ? (r.is_online ? t('playerMap.online') : t('playerMap.offline')) : r.actor_type}
                  </span>
                  <span title={r.class_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.custom_name || r.display_name || r.class_name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{r.actor_type === 'dino' && r.dino_level > 0 ? r.dino_level : '—'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}
                    title={`${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`}>
                    {coordLabel(r)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
