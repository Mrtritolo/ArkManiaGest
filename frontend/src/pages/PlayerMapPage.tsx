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
 * The minimap is an auto-fit SVG scatter (UU coordinates, north up): it
 * shows *relative* positions without needing per-map GPS calibration.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi, playersApi, serverInstancesApi } from '../services/api'
import type { PlayerListItem, ServerInstance } from '../types'
import {
  Crosshair, Loader2, AlertTriangle, RefreshCw, Building, Skull, MapPin, Copy,
} from 'lucide-react'

interface ScanRow {
  targeting_team: number; server_key: string; map_name: string
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number
  dino_level: number; is_online: boolean; scanned_at: string | null
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
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)   // index into rows
  const [radius, setRadius] = useState(30)
  const [acting, setActing] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  useEffect(() => {
    playersApi.list({ limit: 1000 }).then(r => setPlayers(r.data)).catch(() => {})
    serverInstancesApi.list({ active_only: true }).then(r => setInstances(r.data)).catch(() => {})
  }, [])

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
    // Keep only the newest scan batch: same server_key as the newest row,
    // scanned within 2 minutes of it (chunked inserts can straddle seconds).
    const sk = all[0].server_key
    const t0 = new Date(all[0].scanned_at || 0).getTime()
    setRows(all.filter(r => r.server_key === sk && Math.abs(new Date(r.scanned_at || 0).getTime() - t0) < 120_000))
    setTruncated(!!res.data.truncated)
  }

  async function runScan() {
    if (!eosId || instanceId === '') return
    setScanning(true); setError(''); setScanReply(''); setSelected(null); setActionMsg('')
    try {
      const res = await arkDecayApi.playerScanRun(eosId, instanceId as number)
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

  // ── Minimap geometry: auto-fit bounds with 6% padding ──────────────────
  const view = useMemo(() => {
    if (rows.length === 0) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const r of rows) {
      if (r.pos_x < minX) minX = r.pos_x; if (r.pos_x > maxX) maxX = r.pos_x
      if (r.pos_y < minY) minY = r.pos_y; if (r.pos_y > maxY) maxY = r.pos_y
    }
    const spanX = Math.max(maxX - minX, 1000), spanY = Math.max(maxY - minY, 1000)
    const pad = 0.06 * Math.max(spanX, spanY)
    return { minX: minX - pad, minY: minY - pad, span: Math.max(spanX, spanY) + 2 * pad }
  }, [rows])

  const SIZE = 560
  function px(r: ScanRow) { return view ? ((r.pos_x - view.minX) / view.span) * SIZE : 0 }
  function py(r: ScanRow) { return view ? ((r.pos_y - view.minY) / view.span) * SIZE : 0 }

  const sel = selected !== null ? rows[selected] : null
  const anyOnline = rows.some(r => r.actor_type === 'player' && r.is_online)
  const nStruct = rows.filter(r => r.actor_type === 'structure').length
  const nDino = rows.filter(r => r.actor_type === 'dino').length

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
        <button className="btn btn-primary" onClick={runScan} disabled={scanning || !eosId || instanceId === ''}>
          {scanning ? <><Loader2 size={14} className="pl-spin" /> {t('playerMap.scanning')}</> : <><RefreshCw size={14} /> {t('playerMap.scan')}</>}
        </button>
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
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 14 }}>
              <span><Building size={11} /> {nStruct} {t('playerMap.structures')}</span>
              <span style={{ color: '#8b5cf6' }}>● {nDino} {t('playerMap.dinos')}</span>
              <span style={{ color: 'var(--danger)' }}>● {t('playerMap.playerDot')} {anyOnline ? t('playerMap.online') : t('playerMap.offline')}</span>
              <span>{rows[0].map_name}</span>
            </div>
            <svg width={SIZE} height={SIZE} style={{ background: 'var(--bg-card-muted)', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}>
              {/* griglia leggera */}
              {[1, 2, 3].map(i => (
                <g key={i} stroke="var(--border)" strokeWidth={0.5}>
                  <line x1={(SIZE / 4) * i} y1={0} x2={(SIZE / 4) * i} y2={SIZE} />
                  <line x1={0} y1={(SIZE / 4) * i} x2={SIZE} y2={(SIZE / 4) * i} />
                </g>
              ))}
              {/* raggio anteprima sul punto selezionato */}
              {sel && view && (
                <circle cx={px(sel)} cy={py(sel)} r={(radius * 100 / view.span) * SIZE}
                  fill="var(--danger)" opacity={0.10} stroke="var(--danger)" strokeDasharray="4 3" strokeWidth={1} />
              )}
              {rows.map((r, i) => {
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
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('playerMap.mapHint')}</div>
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
                    {sel.actor_type === 'dino' && (
                      <button className="btn btn-danger btn-sm" disabled={acting} onClick={() => doDestroy('dinos', sel, 1)}>
                        <Skull size={11} /> {t('playerMap.killThisDino')}
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
              {rows.map((r, i) => (
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
