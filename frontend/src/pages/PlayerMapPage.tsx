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
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScanKind } from '../services/api'
import { arkDecayApi, playersApi, serverInstancesApi, arkmaniaApi } from '../services/api'
import type { AuthUser, PlayerListItem, ServerInstance } from '../types'
import { DEFAULT_CALIBRATION, parseCalibOverrides, calibFromWorldSettings, gpsOf, fullMapBounds, type MapCalib } from '../utils/mapCalibration'
import { extractError } from '../utils/errors'
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
  dino:      { r: 5, fill: 'var(--violet)' },   // magenta
  player:    { r: 7, fill: 'var(--danger)' },   // hot pink/red
}
type SortKey = 'type' | 'name' | 'level' | 'lat' | 'lon'

const DOT_HALO = 'rgba(0, 0, 0, 0.75)'
const OFFLINE_FILL = 'var(--warning)'            // acid yellow: offline character

/**
 * The player and server a scan was run against. Every action on the map
 * reuses it instead of the live dropdowns: the dots, the tribe id and the
 * coordinates belong to this pair, and firing them at whatever is selected
 * now would hit another player or another map.
 */
interface ScanTarget {
  eosId: string; instanceId: number; mapName: string; label: string
  /**
   * The plugin's server_key for this instance, once a scan has proven it.
   * Only resolved when another active server runs the same map, where the
   * map prefix alone cannot tell the two servers' rows apart (see loadRows).
   */
  serverKey?: string
}

/** server_key and map names both start with the map; the suffix varies. */
const mapPrefix = (name: string) => name.split('_')[0]

/** Newest scanned_at per server_key before a scan; `complete` is false when the read was truncated. */
type ScanBaseline = { newest: Map<string, string>; complete: boolean }

/** Newest scanned_at per server_key. The 'YYYY-MM-DD HH:MM:SS' text sorts as a date. */
function newestPerKey(rows: ScanRow[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    const s = r.scanned_at || ''
    if (s > (out.get(r.server_key) ?? '')) out.set(r.server_key, s)
  }
  return out
}

interface Props {
  currentUser?: AuthUser | null
}

export default function PlayerMapPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // Every command on this page goes through an admin-only endpoint -- even
  // the scan, which fires RCON. Showing the controls to an operator who can
  // only ever get a 403 back is a trap, so they are hidden outright.
  const isAdmin = currentUser?.role === 'admin'

  const [players, setPlayers] = useState<PlayerListItem[]>([])
  const [instances, setInstances] = useState<ServerInstance[]>([])
  const [playerFilter, setPlayerFilter] = useState('')
  const [eosId, setEosId] = useState('')
  const [instanceId, setInstanceId] = useState<number | ''>('')

  const [scanning, setScanning] = useState(false)
  const [scanReply, setScanReply] = useState('')
  const [target, setTarget] = useState<ScanTarget | null>(null)
  const [rows, setRows] = useState<ScanRow[]>([])
  // Which layers the map draws. A base with 2000 foundations buries the
  // handful of dots that matter, so the admin turns layers off to read the
  // map -- and can re-scan just one layer without redoing the slow sweep.
  const [layers, setLayers] = useState<Record<ScanRow['actor_type'], boolean>>({
    structure: true, dino: true, player: true,
  })
  const [truncated, setTruncated] = useState(false)
  // Set when two active servers share the map and the scan left no rows
  // that can only be the selected server's: the map is kept empty.
  const [unattributed, setUnattributed] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)   // index into rows
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
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
  // The drag origin lives in a ref: it changes on every pointermove, and as
  // state each move re-rendered the whole dot layer and table. Only the
  // grab cursor needs a render, and that flips twice per drag.
  const dragFrom = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
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
      .catch(e => setError(extractError(e, String(e))))
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

  // Background image follows the displayed map.
  useEffect(() => {
    if (!mapName) return
    let cancelled = false
    arkDecayApi.mapImage(mapName)
      .then(r => { if (!cancelled) setMapImg({ name: mapName, url: URL.createObjectURL(r.data) }) })
      .catch(() => { if (!cancelled) setMapImg(null) })
    return () => { cancelled = true }
  }, [mapName])

  // Each blob URL is revoked once it is off screen: when the next image (or
  // null) has replaced it, and on unmount. Not in the effect above: revoking
  // on a mapName change killed the image that was still on screen while
  // the next one downloaded, and the last one used to outlive the page.
  useEffect(() => {
    if (!mapImg) return
    return () => URL.revokeObjectURL(mapImg.url)
  }, [mapImg])

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

  /** The dropdowns as a scan target, or null while either is unset. */
  function selectionTarget(): ScanTarget | null {
    const inst = instances.find(i => i.id === instanceId)
    if (!eosId || !inst) return null
    const who = players.find(p => p.eos_id === eosId)?.name || eosId
    return { eosId, instanceId: inst.id, mapName: inst.map_name,
             label: `${who} — ${inst.display_name || inst.name} (${inst.map_name})` }
  }

  /** A new player or server makes the snapshot on screen someone else's. */
  function clearScan() {
    setTarget(null); setRows([]); setTruncated(false); setSelected(null)
    setScanReply(''); setActionMsg(''); setUnattributed(false)
  }

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
    const onMap = all.filter(r => r.server_key === sk)
    // Keep only the newest scan batch, PER LAYER: a per-layer re-scan
    // leaves the other layers with an older timestamp, and a single
    // cluster-wide cutoff would silently drop them from the map.
    // Chunked inserts straddle seconds, hence the 2-minute window.
    const newestOf: Record<string, number> = {}
    for (const r of onMap) {
      const t = new Date(r.scanned_at || 0).getTime()
      if (!(r.actor_type in newestOf) || t > newestOf[r.actor_type]) newestOf[r.actor_type] = t
    }
    setRows(onMap.filter(r =>
      Math.abs(new Date(r.scanned_at || 0).getTime() - newestOf[r.actor_type]) < 120_000))
    setTruncated(!!res.data.truncated)
  }

  // A non-null target always matches the dropdowns (changing either clears
  // it), so re-scans reuse it and keep a server_key already resolved.
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
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setScanning(false)
    }
  }

  async function doDestroy(kind: 'structures' | 'dinos' | 'all', center: ScanRow, radiusM: number) {
    if (!target) return
    const label = t(`playerMap.actions.${kind}`)
    if (!window.confirm(`${target.label}\n\n${t('playerMap.confirmDestroy', { what: label, r: radiusM })}`)) return
    if (kind === 'all' && !window.confirm(t('playerMap.confirmAll'))) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyRadius({
        instance_id: target.instanceId, targeting_team: center.targeting_team,
        x: center.pos_x, y: center.pos_y, z: center.pos_z, radius_m: radiusM, kind,
      })
      await runScan('all', target)   // the map must show the post-action truth
      reportAction(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
    }
  }

  async function doDestroyOne(row: ScanRow) {
    if (!row.actor_name || !target) return
    const label = row.custom_name || row.display_name || row.class_name
    if (!window.confirm(`${target.label}\n\n${t('playerMap.confirmDestroyOne', { what: label })}`)) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.destroyActor(
        target.instanceId, row.targeting_team, row.actor_name)
      await runScan('all', target)
      reportAction(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
    }
  }

  async function doKillPlayer() {
    if (!target) return
    if (!window.confirm(`${target.label}\n\n${t('playerMap.confirmKill')}`)) return
    setActing(true); setActionMsg('')
    try {
      const res = await arkDecayApi.killPlayer(target.eosId, target.instanceId)
      await runScan('all', target)
      reportAction(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setActing(false)
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

  // ── Minimap geometry ───────────────────────────────────────────────────
  // Calibrated map: fixed square = the whole map (GPS 0..100), so dots sit
  // at their true in-game position and the axes read as GPS. Uncalibrated:
  // auto-fit around the objects (relative positions only, no GPS meaning).
  // Rows the map and table actually show, each paired with its index in
  // `rows` so selection keeps pointing at the master list.
  const visible = useMemo(() => {
    const out = rows.map((r, i) => ({ r, i })).filter(({ r }) => layers[r.actor_type])
    if (!sort) return out          // no sort = scan order, the plugin's own
    // Sort on the number the operator reads, not on the raw coordinate: the
    // calibration divisors are per-map and nothing guarantees their sign, so
    // ordering by pos_y would silently invert Lat on a map that flips it.
    const key = (r: ScanRow): string | number => {
      switch (sort.key) {
        case 'type':  return r.actor_type
        case 'name':  return (r.custom_name || r.display_name || r.class_name).toLowerCase()
        case 'level': return r.dino_level
        case 'lat':   return calib ? gpsOf(calib, r.pos_x, r.pos_y).lat : r.pos_y
        case 'lon':   return calib ? gpsOf(calib, r.pos_x, r.pos_y).lon : r.pos_x
      }
    }
    return out.sort((a, b) => {
      const ka = key(a.r), kb = key(b.r)
      return ka < kb ? -sort.dir : ka > kb ? sort.dir : 0
    })
  }, [rows, layers, sort, calib])

  /** asc -> desc -> back to scan order. */
  function toggleSort(k: SortKey) {
    setSort(s => s?.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null)
  }

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
        // Clamped against prevZoom, not the render's clampPan: the wheel
        // listener below keeps the zoomAt of the render that attached it.
        const oldLim = Math.max(0, SIZE - oldView)
        const wx = Math.min(oldLim, Math.max(0, prevPan.x)) + (px0 / SIZE) * oldView
        const wy = Math.min(oldLim, Math.max(0, prevPan.y)) + (py0 / SIZE) * oldView
        const nx = wx - (px0 / SIZE) * newView
        const ny = wy - (py0 / SIZE) * newView
        const lim = Math.max(0, SIZE - newView)
        return { x: Math.min(lim, Math.max(0, nx)), y: Math.min(lim, Math.max(0, ny)) }
      })
      return next
    })
  }

  // Wheel zoom needs a non-passive native listener: React registers onWheel
  // as a passive listener on the root, so preventDefault() there was ignored
  // and the whole page scrolled while the map zoomed.
  const hasMap = rows.length > 0
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const b = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - b.left, e.clientY - b.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasMap])

  // A pan only moves the viewBox. The dot layer, the object table and the
  // player <option> list run to thousands of elements on a big base, so
  // they are memoised: a drag must not rebuild any of them on every move.
  const playerOptions = useMemo(() => filteredPlayers.map(p => (
    <option key={p.eos_id} value={p.eos_id}>{p.name || t('playerMap.noName')} ({p.eos_id.slice(0, 10)}…)</option>
  )), [filteredPlayers, t])

  const dots = useMemo(() => visible.map(({ r, i }) => {
    const d = DOT[r.actor_type] || DOT.structure
    const isSel = i === selected
    return (
      <circle key={i} data-dot="" cx={px(r)} cy={py(r)}
        r={(isSel ? d.r + 3 : d.r) * k}
        fill={r.actor_type === 'player' && !r.is_online ? OFFLINE_FILL : d.fill}
        stroke={isSel ? 'var(--accent)' : DOT_HALO}
        strokeWidth={(isSel ? 2 : 1) * k}
        style={{ cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); setSelected(i) }}>
        <title>{`${r.custom_name || r.display_name || r.class_name}\n${coordLabel(r)}`}</title>
      </circle>
    )
  }), [visible, view, calib, selected, k])   // px, py and coordLabel read only view and calib

  const tableRows = useMemo(() => visible.map(({ r, i }) => (
    <div key={i} onClick={() => setSelected(i)} style={{
      display: 'grid', gridTemplateColumns: '80px 1fr 52px 74px 74px', alignItems: 'center',
      fontSize: '0.76rem', padding: '0.24rem 0.8rem', cursor: 'pointer',
      borderBottom: '1px solid var(--border)',
      background: i === selected ? 'var(--bg-card-muted)' : 'transparent',
    }}>
      <span style={{ fontWeight: 600, color: r.actor_type === 'dino' ? 'var(--violet)' : r.actor_type === 'player' ? (r.is_online ? 'var(--danger)' : 'var(--warning)') : 'var(--text-secondary)' }}>
        {r.actor_type === 'player'
          ? (r.is_online ? t('playerMap.online') : t('playerMap.offline'))
          : t(`playerMap.kind.${r.actor_type}`, { defaultValue: r.actor_type })}
      </span>
      <span title={r.class_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.custom_name || r.display_name || r.class_name}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{r.actor_type === 'dino' && r.dino_level > 0 ? r.dino_level : '—'}</span>
      {/* Lat and Lon are separate cells only so each header can
          sort on its own axis; the UU triplet stays in the title. */}
      {([calib ? gpsOf(calib, r.pos_x, r.pos_y).lat.toFixed(1) : Math.round(r.pos_y),
         calib ? gpsOf(calib, r.pos_x, r.pos_y).lon.toFixed(1) : Math.round(r.pos_x)]
      ).map((v, axis) => (
        <span key={axis} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}
          title={`${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`}>
          {v}
        </span>
      ))}
    </div>
  )), [visible, selected, calib, t])

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
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{t('playerMap.player')}</label>
          <input className="input" placeholder={t('playerMap.searchPlayer')} value={playerFilter}
            onChange={e => setPlayerFilter(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          {/* Locked while a scan or an action runs: its result would land
              under a selection it does not belong to. */}
          <select className="input" value={eosId} disabled={scanning || acting}
            onChange={e => { setEosId(e.target.value); clearScan() }} style={{ width: '100%', marginTop: 4 }}>
            <option value="">—</option>
            {playerOptions}
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{t('playerMap.server')}</label>
          <select className="input" value={instanceId} disabled={scanning || acting}
            onChange={e => { setInstanceId(e.target.value === '' ? '' : Number(e.target.value)); clearScan() }} style={{ width: '100%', marginTop: 4 }}>
            <option value="">—</option>
            {sortedInstances.map(i => (
              <option key={i.id} value={i.id}>{i.display_name || i.name} ({i.map_name})</option>
            ))}
          </select>
        </div>
        {isAdmin ? (
          <>
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
                  aria-label={t('playerMap.scanLayerHint')} title={t('playerMap.scanLayerHint')}>
                  {t(`playerMap.${lbl}`)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {t('playerMap.adminOnly')}
          </span>
        )}
        {scanReply && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexBasis: '100%' }}>{scanReply}</span>}

        {rows.length > 0 && (
        <>
        {/* Display filter, deliberately separate from the scan buttons above:
            hiding a layer only changes what you look at, it never touches
            the snapshot. A base with a couple of thousand foundations
            buries the handful of dots that matter. */}
        <div style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                      borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
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
              aria-label={t('playerMap.toggleLayer')} title={t('playerMap.toggleLayer')}>
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
      {unattributed && target && (
        <div className="alert alert-warning" style={{ marginTop: 10 }}>
          <AlertTriangle size={14} /> {t('playerMap.sameMapUnattributed', { map: target.mapName })}
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
              <span style={{ color: 'var(--violet)', opacity: layers.dino ? 1 : 0.35 }}>
                ● {nDino} {t('playerMap.dinos')}
              </span>
              <span style={{ color: 'var(--danger)', opacity: layers.player ? 1 : 0.35 }}>
                ● {t('playerMap.playerDot')} {anyOnline ? t('playerMap.online') : t('playerMap.offline')}
              </span>
              <span>{rows[0].map_name}</span>
            </div>
            <svg ref={svgRef} width={SIZE} height={SIZE} viewBox={viewBox}
              onPointerDown={e => {
                // Left button only, and never start a drag from a dot: the
                // dot's own click must still select it. This guard is the
                // whole point -- setPointerCapture retargets every later
                // pointer event to the <svg>, so a capture started on a dot
                // makes the browser fire the click on the svg and the dot's
                // onClick never runs.
                if (e.button !== 0) return
                if ((e.target as Element).hasAttribute?.('data-dot')) return
                dragFrom.current = { x: e.clientX, y: e.clientY }
                setDragging(true)
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={e => {
                const from = dragFrom.current
                if (!from) return
                const dx = (e.clientX - from.x) / zoom
                const dy = (e.clientY - from.y) / zoom
                dragFrom.current = { x: e.clientX, y: e.clientY }
                setPan(prev => ({ x: clampPan(prev.x - dx), y: clampPan(prev.y - dy) }))
              }}
              onPointerUp={e => {
                dragFrom.current = null
                setDragging(false)
                e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              style={{ background: 'var(--bg-card-muted)', borderRadius: 4, border: '1px solid var(--border)', display: 'block', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
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
                  style={{ pointerEvents: 'none' }}
                  strokeDasharray={`${4 * k} ${3 * k}`} strokeWidth={1 * k} />
              )}
              {dots}
            </svg>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.4)}
                disabled={zoom <= 1} aria-label={t('playerMap.zoomOut')} title={t('playerMap.zoomOut')}><ZoomOut size={12} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.4)}
                disabled={zoom >= 8} aria-label={t('playerMap.zoomIn')} title={t('playerMap.zoomIn')}><ZoomIn size={12} /></button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                aria-label={t('playerMap.zoomReset')} title={t('playerMap.zoomReset')}><Maximize2 size={12} /></button>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {zoom.toFixed(1)}x
              </span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {view?.calibrated ? t('playerMap.mapHintGps') : t('playerMap.mapHint')}
              {' '}{t('playerMap.zoomHint')}
            </div>
            {view && !view.calibrated && (
              <div style={{ fontSize: '0.68rem', color: 'var(--warning)', marginTop: 4 }}>
                {t('playerMap.noCalibration', { map: mapName })}
              </div>
            )}
          </div>

          {/* Pannello azioni + lista */}
          <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Destroy / kill: admin-only server side, so hidden here too. */}
            {isAdmin && (
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
                      <button className="btn btn-ghost btn-sm" onClick={() => copyTp(sel)} aria-label="cheat TPCoords" title="cheat TPCoords"><Copy size={10} /> TP</button>
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
                          aria-label={sel.actor_name} title={sel.actor_name}>
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
                    aria-label={anyOnline ? '' : t('playerMap.killOfflineHint')} title={anyOnline ? '' : t('playerMap.killOfflineHint')}>
                    <Skull size={11} /> {t('playerMap.killPlayer')}
                  </button>
                  {!anyOnline && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>{t('playerMap.killOfflineHint')}</span>}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 52px 74px 74px', fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', padding: '0.35rem 0.8rem', position: 'sticky', top: 0, background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                {([['type', t('decay.detail.type')], ['name', t('decay.detail.name')],
                   ['level', t('decay.detail.level')], ['lat', t('playerMap.lat')],
                   ['lon', t('playerMap.lon')]] as [SortKey, string][]).map(([col, label]) => (
                  <button key={col} type="button" onClick={() => toggleSort(col)}
                    title={t('playerMap.sortHint')} aria-label={`${label} — ${t('playerMap.sortHint')}`}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
                             fontSize: 'inherit', fontWeight: 'inherit', fontFamily: 'inherit',
                             color: sort?.key === col ? 'var(--accent)' : 'inherit',
                             textAlign: 'left', display: 'flex', gap: 3, alignItems: 'center' }}>
                    {label}
                    {sort?.key === col && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
                  </button>
                ))}
              </div>
              {tableRows}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
