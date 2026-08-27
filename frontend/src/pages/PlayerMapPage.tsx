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
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScanKind } from '../services/api'
import { arkDecayApi, playersApi, serverInstancesApi, arkmaniaApi } from '../services/api'
import type { PlayerListItem, ServerInstance } from '../types'
import { DEFAULT_CALIBRATION, parseCalibOverrides, gpsOf, fullMapBounds, type MapCalib } from '../utils/mapCalibration'
import {
  Crosshair, Loader2, AlertTriangle, RefreshCw, Building, Skull, MapPin, Copy,
} from 'lucide-react'

interface ScanRow {
  targeting_team: number; server_key: string; map_name: string
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number
  dino_level: number; is_online: boolean; scanned_at: string | null
  actor_name: string | null
}

const DOT: Record<string, { r: number; fill: string }> = {
  structure: { r: 3, fill: 'var(--text-muted)' },
  dino:      { r: 5, fill: '#8b5cf6' },
  player:    { r: 7, fill: 'var(--danger)' },
}

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
  // Object URL of the cached topographic image; null when the map has none
  // (mod maps) or the wiki fetch failed — the map then renders bare.
  const [mapImg, setMapImg] = useState<string | null>(null)

  useEffect(() => {
    // 500 is the API's hard cap: asking for more is a 422, which left the
    // player selector empty with no visible error.
    playersApi.list({ limit: 500 }).then(r => setPlayers(r.data))
      .catch(e => setError(e.response?.data?.detail?.[0]?.msg || String(e)))
    serverInstancesApi.list({ active_only: true }).then(r => setInstances(r.data)).catch(() => {})
    // Per-map GPS overrides for mod maps (or corrections to a default),
    // stored in ARKM_config as PlayerMap.MapCalibration. Absent = no
    // override, we fall back to DEFAULT_CALIBRATION then to raw UU.
    arkmaniaApi.getConfig('PlayerMap.MapCalibration', '*')
      .then(r => setCalibOverrides(parseCalibOverrides(r.data.config_value)))
      .catch(() => setCalibOverrides({}))
  }, [])

  // Calibration active for the map currently shown, if any.
  const mapName = rows[0]?.map_name || ''
  const calib: MapCalib | null = calibOverrides[mapName] || DEFAULT_CALIBRATION[mapName] || null

  // Background image follows the displayed map. Revoked on change so the
  // blobs do not pile up as the admin hops between maps.
  useEffect(() => {
    if (!mapName) { setMapImg(null); return }
    let url: string | null = null
    let cancelled = false
    arkDecayApi.mapImage(mapName)
      .then(r => {
        if (cancelled) return
        url = URL.createObjectURL(r.data)
        setMapImg(url)
      })
      .catch(() => { if (!cancelled) setMapImg(null) })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [mapName])

  const filteredPlayers = useMemo(() => {
    const q = playerFilter.trim().toLowerCase()
    const base = q
      ? players.filter(p => (p.name || '').toLowerCase().includes(q) || p.eos_id.toLowerCase().includes(q))
      : players
    return base.slice(0, 60)
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
  function gpsLabel(r: ScanRow) {
    if (!calib) return null
    const g = gpsOf(calib, r.pos_x, r.pos_y)
    return `${g.lat.toFixed(1)}, ${g.lon.toFixed(1)}`
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
            {instances.map(i => (
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
            {/* The legend doubles as the layer filter: click a class to
                show or hide it, both on the map and in the list. */}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleLayer('structure')}
                title={t('playerMap.toggleLayer')}
                style={{ opacity: layers.structure ? 1 : 0.4, textDecoration: layers.structure ? 'none' : 'line-through' }}>
                <Building size={11} /> {nStruct} {t('playerMap.structures')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleLayer('dino')}
                title={t('playerMap.toggleLayer')}
                style={{ color: '#8b5cf6', opacity: layers.dino ? 1 : 0.4, textDecoration: layers.dino ? 'none' : 'line-through' }}>
                ● {nDino} {t('playerMap.dinos')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleLayer('player')}
                title={t('playerMap.toggleLayer')}
                style={{ color: 'var(--danger)', opacity: layers.player ? 1 : 0.4, textDecoration: layers.player ? 'none' : 'line-through' }}>
                ● {nChar} {t('playerMap.playerDot')} {anyOnline ? t('playerMap.online') : t('playerMap.offline')}
              </button>
              <span>{rows[0].map_name}</span>
            </div>
            <svg width={SIZE} height={SIZE} style={{ background: 'var(--bg-card-muted)', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}>
              {/* Topographic background: only meaningful when calibrated,
                  because only then does the square correspond to the whole
                  map. Uncalibrated maps keep the plain auto-fit view -- an
                  image stretched over arbitrary bounds would put dots in
                  convincingly wrong places. */}
              {mapImg && view?.calibrated && (
                <image href={mapImg} x={0} y={0} width={SIZE} height={SIZE}
                  preserveAspectRatio="none" opacity={0.85} />
              )}
              {/* griglia leggera */}
              {[1, 2, 3].map(i => (
                <g key={i} stroke="var(--border)" strokeWidth={0.5}>
                  <line x1={(SIZE / 4) * i} y1={0} x2={(SIZE / 4) * i} y2={SIZE} />
                  <line x1={0} y1={(SIZE / 4) * i} x2={SIZE} y2={(SIZE / 4) * i} />
                </g>
              ))}
              {/* etichette GPS agli angoli quando la mappa e' calibrata */}
              {view?.calibrated && (
                <g fill="var(--text-muted)" fontSize={9} fontFamily="var(--font-mono)">
                  <text x={3} y={11}>Lon 0 / Lat 0</text>
                  <text x={SIZE - 3} y={11} textAnchor="end">Lon 100</text>
                  <text x={3} y={SIZE - 4}>Lat 100</text>
                </g>
              )}
              {/* raggio anteprima sul punto selezionato */}
              {sel && view && (
                <circle cx={px(sel)} cy={py(sel)} r={(radius * 100 / view.span) * SIZE}
                  fill="var(--danger)" opacity={0.10} stroke="var(--danger)" strokeDasharray="4 3" strokeWidth={1} />
              )}
              {visible.map(({ r, i }) => {
                const d = DOT[r.actor_type] || DOT.structure
                const isSel = i === selected
                return (
                  <circle key={i} cx={px(r)} cy={py(r)}
                    r={isSel ? d.r + 3 : d.r}
                    fill={r.actor_type === 'player' && !r.is_online ? '#f59e0b' : d.fill}
                    stroke={isSel ? 'var(--accent)' : 'none'} strokeWidth={isSel ? 2 : 0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(i)}>
                    <title>{`${r.custom_name || r.display_name || r.class_name}\n${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`}</title>
                  </circle>
                )
              })}
            </svg>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {view?.calibrated ? t('playerMap.mapHintGps') : t('playerMap.mapHint')}
            </div>
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
                      {Math.round(sel.pos_x)} {Math.round(sel.pos_y)} {Math.round(sel.pos_z)}
                      {gpsLabel(sel) && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>GPS {gpsLabel(sel)}</span>}
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
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{Math.round(r.pos_x)} {Math.round(r.pos_y)} {Math.round(r.pos_z)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
