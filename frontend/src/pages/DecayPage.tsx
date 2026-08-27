/**
 * DecayPage — Tribe decay management (ARKM_tribe_decay).
 * Shows tribes with decay status, pending purge, and recent logs.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi, serverInstancesApi } from '../services/api'
import type { ServerInstance } from '../types'
import {
  Timer, Search, AlertCircle, AlertTriangle, CheckCircle, Clock,
  Trash2, Building, Activity, XCircle, MapPin, Copy, Loader2,
  RefreshCw, Crosshair, Skull, CalendarPlus, Server, RotateCw, Eye, EyeOff
} from 'lucide-react'

interface DecayTribe {
  targeting_team: number; expire_time: string | null; last_refresh_eos: string
  tribe_name: string | null; player_name: string | null
  last_refresh_group: string; last_refresh_days: number
  last_refresh_time: string | null; hours_left: number; status: string
}
interface PendingItem {
  targeting_team: number; server_key: string; reason: string
  structure_count: number; dino_count: number; flagged_at: string | null
  server_name: string | null; tribe_name: string | null; player_name: string | null
  last_refresh_group: string | null; expire_time: string | null
  last_member_login: string | null
}
interface ScanDetailItem {
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number; dino_level: number
  reason: string; server_key: string; map_name: string; scanned_at: string | null
  actor_name: string | null; targeting_team: number
}
interface LogItem {
  id: number; targeting_team: number; server_key: string; map_name: string
  reason: string; structures_destroyed: number; dinos_destroyed: number
  purged_by: string; purged_at: string | null
}
interface DecayStats {
  total: number; expired: number; expiring_soon: number; safe: number
  pending: number; purged_last_7d: number
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}

/** Whole days elapsed since an ISO datetime; null when absent. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

type TabType = 'tribes' | 'pending' | 'log'

export default function DecayPage() {
  const { t } = useTranslation()

  function formatHoursLeft(h: number) {
    if (h < 0) return t('decay.hoursLeft.expired', { h: Math.abs(h) })
    if (h < 24) return t('decay.hoursLeft.hours', { h })
    return t('decay.hoursLeft.days', { d: Math.floor(h / 24), h: h % 24 })
  }

  const [stats, setStats] = useState<DecayStats>({ total: 0, expired: 0, expiring_soon: 0, safe: 0, pending: 0, purged_last_7d: 0 })
  const [tribes, setTribes] = useState<DecayTribe[]>([])
  const [pending, setPending] = useState<PendingItem[]>([])
  const [log, setLog] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('tribes')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')

  async function loadData() {
    setLoading(true)
    try {
      const [statsRes, tribesRes, pendingRes, logRes] = await Promise.all([
        arkDecayApi.overview(),
        arkDecayApi.tribes({ status: filterStatus !== 'all' ? filterStatus : undefined, search: search || undefined }),
        arkDecayApi.pending(),
        arkDecayApi.log({ limit: 50 }),
      ])
      setStats(statsRes.data)
      setTribes(tribesRes.data.tribes)
      setPending(pendingRes.data.pending)
      setLog(logRes.data.log)
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [filterStatus])

  // ── Single-tribe purge actions ─────────────────────────────────
  // `acting` is the targeting_team currently being scheduled or
  // cancelled, used to show a per-row spinner / disable double-click.
  const [acting, setActing] = useState<number | null>(null)
  // Scan-detail expansion: key is `${team}-${server_key}`, rows come from
  // ARKM_scan_detail (written by DecayManager 5.3.0+ at every scan).
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detailRows, setDetailRows] = useState<ScanDetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  // What the detail table shows. Purely a view filter: it never touches
  // the snapshot, and a hidden row is still there when you turn it back on.
  const [detailKinds, setDetailKinds] = useState({ structure: true, dino: true })
  const [detailTruncated, setDetailTruncated] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  // Per-map commands need an instance to talk to: every plugin command is
  // scoped to one server, so the operator picks which map to act on
  // instead of the old cluster-wide fan-out.
  const [instances, setInstances] = useState<ServerInstance[]>([])
  const [cmdInstance, setCmdInstance] = useState<number | ''>('')
  const [cmdBusy, setCmdBusy] = useState<string | null>(null)
  const [cmdReply, setCmdReply] = useState<string>('')

  useEffect(() => {
    serverInstancesApi.list({ active_only: true })
      .then(r => {
        setInstances(r.data)
        if (r.data.length > 0) setCmdInstance(r.data[0].id)
      })
      .catch(() => {})
  }, [])

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
  function instanceForRow(serverKey: string): ServerInstance | null {
    const prefix = serverKey.split('_')[0]
    const hits = instances.filter(i => i.map_name.split('_')[0] === prefix)
    return hits.length === 1 ? hits[0] : null
  }

  /** Auto-resolved target, else whatever the toolbar has selected. */
  function targetFor(serverKey: string): ServerInstance | null {
    return instanceForRow(serverKey)
      ?? instances.find(i => i.id === cmdInstance)
      ?? null
  }

  /** Run one plugin command against the selected instance. */
  async function runCmd(key: string, fn: () => Promise<any>, confirmMsg?: string) {
    if (cmdInstance === '') return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setCmdBusy(key); setCmdReply(''); setError('')
    try {
      const res = await fn()
      setCmdReply(res.data?.reply || res.data?.status || 'ok')
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setCmdBusy(null)
    }
  }

  async function destroyOne(row: ScanDetailItem, idx: number) {
    if (!row.actor_name || cmdInstance === '') return
    const label = row.custom_name || row.display_name || row.class_name
    if (!window.confirm(t('decay.detail.confirmDestroyOne', { what: label }))) return
    setCmdBusy(`obj-${idx}`); setError('')
    try {
      const res = await arkDecayApi.destroyActor(
        cmdInstance as number, row.targeting_team, row.actor_name)
      setCmdReply(res.data.reply || '')
      setDetailRows(rows => rows.filter((_, i) => i !== idx))
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e))
    } finally {
      setCmdBusy(null)
    }
  }

  /** Load (or reload) the detail of one row, leaving it open. */
  async function openDetail(p: PendingItem) {
    setDetailKey(`${p.targeting_team}-${p.server_key}`)
    setDetailRows([]); setDetailLoading(true)
    try {
      const res = await arkDecayApi.pendingDetail(p.targeting_team, p.server_key)
      setDetailRows(res.data.detail || [])
      setDetailTruncated(!!res.data.truncated)
    } catch {
      setDetailRows([])
    } finally {
      setDetailLoading(false)
    }
  }

  async function toggleDetail(p: PendingItem) {
    const key = `${p.targeting_team}-${p.server_key}`
    if (detailKey === key) { setDetailKey(null); setDetailRows([]); return }
    await openDetail(p)
  }

  // Each visible row keeps its index in detailRows, so destroyOne() still
  // removes the right one after a filter change.
  const detailVisible = detailRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => detailKinds[r.actor_type as 'structure' | 'dino'] !== false)
  const nDetailStruct = detailRows.filter(r => r.actor_type === 'structure').length
  const nDetailDino = detailRows.filter(r => r.actor_type === 'dino').length

  function copyTp(row: ScanDetailItem, idx: number) {
    const cmd = `cheat TPCoords ${Math.round(row.pos_x)} ${Math.round(row.pos_y)} ${Math.round(row.pos_z)}`
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    }).catch(() => {})
  }

  async function handleSchedulePurge(tribe: DecayTribe) {
    if (!window.confirm(t('decay.confirmSchedule', {
      id:    tribe.targeting_team,
      name:  tribe.tribe_name || t('decay.unknownTribe'),
    }))) return
    setActing(tribe.targeting_team); setError('')
    try {
      const res = await arkDecayApi.schedulePurge(tribe.targeting_team, 'manual')
      window.alert(t('decay.scheduleDone', {
        id:    tribe.targeting_team,
        rows:  res.data.rows_inserted,
        total: res.data.scheduled_on.length,
      }))
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || t('decay.scheduleFailed'))
    } finally {
      setActing(null)
    }
  }

  // ── DM.Purge dispatch (cluster-wide) ───────────────────────────
  // Calls ARKM.DM.Purge over RCON on every active ARK instance --
  // the plugin then walks ARKM_decay_pending on each contacted
  // server and destroys the actors there.  Admin only on the backend.
  const [running, setRunning] = useState(false)

  async function handleRunPurge() {
    if (!window.confirm(t('decay.confirmRunPurge'))) return
    setRunning(true); setError('')
    try {
      const res = await arkDecayApi.runPurge()
      window.alert(t('decay.runPurgeDone', {
        ok:     res.data.instances_ok,
        total:  res.data.instances_total,
        failed: res.data.instances_failed,
      }))
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || t('decay.runPurgeFailed'))
    } finally {
      setRunning(false)
    }
  }

  // ── Per-tribe combined "schedule + run" ────────────────────────
  // Used by the new red 'Purge now' button on the Tribes tab; one
  // round-trip schedules the tribe AND triggers the cluster-wide
  // RCON sweep so the operator doesn't need to click twice.
  async function handlePurgeTribeNow(tribe: DecayTribe) {
    if (!window.confirm(t('decay.confirmPurgeNow', {
      id: tribe.targeting_team,
      name: tribe.tribe_name || t('decay.unknownTribe'),
    }))) return
    setActing(tribe.targeting_team); setError('')
    try {
      const res = await arkDecayApi.purgeTribe(tribe.targeting_team)
      window.alert(t('decay.purgeNowDone', {
        id:    tribe.targeting_team,
        rows:  res.data.rows_inserted,
        ok:    res.data.instances_ok,
        total: res.data.instances_total,
      }))
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || t('decay.purgeNowFailed'))
    } finally {
      setActing(null)
    }
  }

  async function handleCancelPurge(p: PendingItem) {
    if (!window.confirm(t('decay.confirmCancel', {
      id:     p.targeting_team,
      name:   p.tribe_name || t('decay.unknownTribe'),
      server: p.server_name || p.server_key.split('_')[0],
    }))) return
    setActing(p.targeting_team); setError('')
    try {
      // Pass the specific server_key so we only cancel ONE row at a
      // time (the per-row button maps to the per-row entry).
      const res = await arkDecayApi.cancelPurge(p.targeting_team, p.server_key)
      window.alert(t('decay.cancelDone', {
        id:   p.targeting_team,
        rows: res.data.rows_deleted,
      }))
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || t('decay.cancelFailed'))
    } finally {
      setActing(null)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault(); loadData()
  }

  const TABS: { key: TabType; label: string; count: number }[] = [
    { key: 'tribes', label: t('decay.tabs.tribes'), count: stats.total },
    { key: 'pending', label: t('decay.tabs.pending'), count: stats.pending },
    { key: 'log', label: t('decay.tabs.log'), count: stats.purged_last_7d },
  ]

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Timer size={22} /> {t('decay.heading')}</h1>
          <p className="page-subtitle">{t('decay.subtitle', { count: stats.total })}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            onClick={handleRunPurge}
            disabled={running}
            className="btn btn-danger btn-sm"
            title={t('decay.runPurgeTitle')}
          >
            <Trash2 size={14} />
            {running ? t('decay.runningPurge') : t('decay.runPurgeButton')}
          </button>
        </div>
      </div>

      {/* Per-map command bar: every plugin command is scoped to one server,
          so the operator says WHICH map instead of firing at the cluster. */}
      <div className="card" style={{ padding: '0.7rem 0.9rem', marginBottom: '0.75rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Server size={14} style={{ opacity: 0.6 }} />
        <select className="input" value={cmdInstance} style={{ minWidth: 210 }}
          onChange={e => setCmdInstance(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">{t('decay.cmd.pickServer')}</option>
          {instances.map(i => (
            <option key={i.id} value={i.id}>{i.display_name || i.name} ({i.map_name})</option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" disabled={cmdInstance === '' || cmdBusy !== null}
          onClick={() => runCmd('scan', () => arkDecayApi.scanInstance(cmdInstance as number))}>
          {cmdBusy === 'scan' ? <Loader2 size={12} className="pl-spin" /> : <RefreshCw size={12} />} {t('decay.cmd.scan')}
        </button>
        <button className="btn btn-danger btn-sm" disabled={cmdInstance === '' || cmdBusy !== null}
          onClick={() => runCmd('purge', () => arkDecayApi.purgeInstance(cmdInstance as number), t('decay.cmd.confirmPurge'))}>
          {cmdBusy === 'purge' ? <Loader2 size={12} className="pl-spin" /> : <Trash2 size={12} />} {t('decay.cmd.purgeMap')}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={cmdInstance === '' || cmdBusy !== null}
          onClick={() => runCmd('unclaimed', () => arkDecayApi.cleanupUnclaimed(cmdInstance as number), t('decay.cmd.confirmUnclaimed'))}>
          {cmdBusy === 'unclaimed' ? <Loader2 size={12} className="pl-spin" /> : <Skull size={12} />} {t('decay.cmd.unclaimed')}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={cmdInstance === '' || cmdBusy !== null}
          onClick={() => runCmd('reload', () => arkDecayApi.reloadInstance(cmdInstance as number))}>
          {cmdBusy === 'reload' ? <Loader2 size={12} className="pl-spin" /> : <RotateCw size={12} />} {t('decay.cmd.reload')}
        </button>
        {cmdReply && (
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', flexBasis: '100%', fontFamily: 'var(--font-mono)' }}>
            {cmdReply}
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', marginBottom: '1.25rem' }}>
        {[
          { label: t('decay.stats.total'), value: stats.total, icon: Building, color: 'var(--accent)', bg: 'var(--accent-glow)' },
          { label: t('decay.stats.expired'), value: stats.expired, icon: XCircle, color: 'var(--danger)', bg: 'var(--danger-bg)' },
          { label: t('decay.stats.expiring'), value: stats.expiring_soon, icon: AlertTriangle, color: 'var(--warning)', bg: 'var(--warning-bg)' },
          { label: t('decay.stats.safe'), value: stats.safe, icon: CheckCircle, color: 'var(--success)', bg: 'var(--success-bg)' },
          { label: t('decay.stats.pending'), value: stats.pending, icon: Clock, color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
          { label: t('decay.stats.purged7d'), value: stats.purged_last_7d, icon: Trash2, color: 'var(--text-muted)', bg: 'var(--bg-card-muted)' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.85rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: s.bg, border: `1px solid ${s.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <s.icon size={16} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{loading ? '...' : s.value}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '0.75rem' }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setActiveTab(tb.key)} style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem',
            border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
            background: activeTab === tb.key ? 'var(--bg-card)' : 'transparent',
            color: activeTab === tb.key ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === tb.key ? 600 : 500, fontSize: '0.88rem',
            borderBottom: activeTab === tb.key ? '2px solid var(--accent)' : '2px solid transparent',
            boxShadow: activeTab === tb.key ? 'var(--shadow-sm)' : 'none',
          }}>
            {tb.label}
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{tb.count}</span>
          </button>
        ))}
      </div>

      {/* === TAB: Tribes === */}
      {activeTab === 'tribes' && (
        <div className="card" style={{ minHeight: 300 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-card-muted)' }}>
            <div style={{ display: 'flex', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {(['all', 'expired', 'expiring', 'safe'] as const).map(f => (
                <button key={f} onClick={() => setFilterStatus(f)} style={{
                  padding: '0.3rem 0.65rem', border: 'none', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer',
                  background: filterStatus === f ? 'var(--accent)' : 'var(--bg-input)',
                  color: filterStatus === f ? '#fff' : 'var(--text-secondary)',
                }}>
                  {f === 'all' ? t('decay.filter.all') : f === 'expired' ? t('decay.filter.expired') : f === 'expiring' ? t('decay.filter.expiring') : t('decay.filter.safe')}
                </button>
              ))}
            </div>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.3rem' }}>
              <div style={{ position: 'relative', width: 220 }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input className="input" placeholder={t('decay.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 26, fontSize: '0.82rem', height: 32 }} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ height: 32, fontSize: '0.78rem' }}>{t('decay.searchButton')}</button>
            </form>
          </div>

          {/* Table */}
          <div style={{ maxHeight: 'calc(100vh - 400px)', overflowY: 'auto' }}>
            {loading ? <div className="pl-loading">{t('decay.loading')}</div> : tribes.length === 0 ? (
              <div className="pl-empty"><Timer size={40} style={{ opacity: 0.15 }} /><p>{t('decay.emptyTribes')}</p></div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1.2fr 1.2fr 0.8fr 80px 120px 90px 130px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                  <span>{t('decay.tribes.table.id')}</span><span>{t('decay.tribes.table.name')}</span><span>{t('decay.tribes.table.player')}</span><span>{t('decay.tribes.table.group')}</span><span>{t('decay.tribes.table.days')}</span><span>{t('decay.tribes.table.expires')}</span><span style={{ textAlign: 'center' }}>{t('decay.tribes.table.status')}</span><span style={{ textAlign: 'center' }}>{t('decay.tribes.table.actions')}</span>
                </div>
                {tribes.map(tr => (
                  <div key={tr.targeting_team} style={{
                    display: 'grid', gridTemplateColumns: '80px 1.2fr 1.2fr 0.8fr 80px 120px 90px 130px',
                    padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{tr.targeting_team}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, fontStyle: tr.tribe_name ? 'normal' : 'italic', color: tr.tribe_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {tr.tribe_name || t('decay.unknownTribe')}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{tr.player_name || '—'}</div>
                      <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', opacity: 0.6 }}>{tr.last_refresh_eos?.slice(0, 16)}</div>
                    </div>
                    <span style={{ fontSize: '0.82rem' }}>{tr.last_refresh_group || t('decay.defaultGroup')}</span>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{tr.last_refresh_days}g</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(tr.expire_time)}</span>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 4,
                        background: tr.status === 'expired' ? 'var(--danger-bg)' : tr.status === 'expiring' ? 'var(--warning-bg)' : 'var(--success-bg)',
                        color: tr.status === 'expired' ? 'var(--danger)' : tr.status === 'expiring' ? 'var(--warning)' : 'var(--success)',
                      }}>
                        {tr.status === 'expired' ? t('decay.status.expired') : tr.status === 'expiring' ? formatHoursLeft(tr.hours_left) : t('decay.status.ok')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem' }}>
                      <button
                        onClick={() => handleSchedulePurge(tr)}
                        disabled={acting !== null || running}
                        className="btn btn-ghost btn-sm"
                        title={t('decay.scheduleTitle')}
                        style={{ padding: '0.2rem 0.4rem' }}
                      >
                        <Clock size={12} />
                      </button>
                      <button
                        onClick={() => handlePurgeTribeNow(tr)}
                        disabled={acting !== null || running}
                        className="btn btn-danger btn-sm"
                        title={t('decay.purgeNowTitle')}
                        style={{ padding: '0.2rem 0.4rem' }}
                      >
                        {acting === tr.targeting_team
                          ? <span style={{ fontSize: '0.65rem' }}>…</span>
                          : <><Trash2 size={11} /> {t('decay.purgeNowButton')}</>}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Pending === */}
      {activeTab === 'pending' && (
        <div className="card" style={{ minHeight: 200 }}>
          {pending.length === 0 ? (
            <div className="pl-empty"><CheckCircle size={40} style={{ opacity: 0.15 }} /><p>{t('decay.emptyPending')}</p></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 0.8fr 80px 70px 60px 100px 100px 215px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>{t('decay.tribes.table.id')}</span><span>{t('decay.tribes.table.name')}</span><span>{t('decay.tribes.table.player')}</span><span>{t('decay.pending.table.server')}</span><span>{t('decay.pending.table.reason')}</span><span>{t('decay.pending.table.structures')}</span><span>{t('decay.pending.table.dinos')}</span><span>{t('decay.pending.table.lastLogin')}</span><span>{t('decay.pending.table.flaggedAt')}</span><span style={{ textAlign: 'center' }}>{t('decay.tribes.table.actions')}</span>
              </div>
              {pending.map(p => { const dKey = `${p.targeting_team}-${p.server_key}`; const dOpen = detailKey === dKey; const gg = daysSince(p.last_member_login); const tgt = targetFor(p.server_key); const tgtName = tgt ? (tgt.display_name || tgt.name) : ''; return (
                <div key={dKey} style={{ borderBottom: '1px solid var(--border)' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 1fr 0.8fr 80px 70px 60px 100px 100px 215px',
                  padding: '0.45rem 1rem', alignItems: 'center',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{p.targeting_team}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, fontStyle: p.tribe_name ? 'normal' : 'italic', color: p.tribe_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {p.tribe_name || t('decay.unknownTribe')}
                  </span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{p.player_name || '—'}</span>
                  <span style={{ fontSize: '0.82rem' }}>{p.server_name || p.server_key.split('_')[0]}</span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase',
                    color: p.reason === 'orphaned' ? '#8b5cf6' : 'var(--danger)',
                  }}>{p.reason === 'orphaned' ? t('decay.reason.orphaned') : p.reason === 'expired' ? t('decay.reason.expired') : p.reason}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: p.structure_count > 500 ? 700 : 400, color: p.structure_count > 500 ? 'var(--danger)' : 'var(--text-secondary)' }}>{p.structure_count.toLocaleString(undefined)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{p.dino_count}</span>
                  <span style={{ fontSize: '0.78rem' }}>
                    {gg === null
                      ? <span style={{ color: 'var(--text-muted)' }}>{t('decay.pending.never')}</span>
                      : gg <= 30
                        ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('decay.pending.daysAgo', { d: gg })} ⚠</span>
                        : <span style={{ color: 'var(--text-muted)' }}>{t('decay.pending.daysAgo', { d: gg })}</span>}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(p.flagged_at)}</span>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {/* Icon-only group: five labelled buttons per row made the
                        table unreadable. Every button names its target server
                        in the tooltip, so a mis-aimed destructive command is
                        visible before the click, not after. */}
                    {/* The detail toggle keeps its label: it is the action
                        operators reach for on nearly every row, and as a bare
                        icon among five it was simply not findable. The three
                        plugin commands stay icon-only, each naming its target
                        server in the tooltip. */}
                    <button
                      onClick={() => toggleDetail(p)}
                      className={dOpen ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                      title={t('decay.detail.title')}
                    >
                      <MapPin size={12} />
                      {dOpen ? t('decay.detail.hide') : t('decay.detail.show')}
                    </button>
                    <button
                      onClick={() => handleCancelPurge(p)}
                      disabled={acting !== null}
                      className="btn btn-ghost btn-sm"
                      title={t('decay.cancelTitle')}
                    >
                      {acting === p.targeting_team
                        ? <Loader2 size={12} className="pl-spin" />
                        : <XCircle size={12} />}
                    </button>
                    <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 3px' }} />
                    <button className="btn btn-ghost btn-sm"
                      disabled={!tgt || cmdBusy !== null}
                      title={tgt ? `${t('decay.cmd.grantTitle')} — ${tgtName}` : t('decay.cmd.noTarget')}
                      onClick={() => {
                        if (!tgt) return
                        const raw = window.prompt(t('decay.cmd.grantPrompt'), '30')
                        const days = Number(raw)
                        if (!raw || !Number.isFinite(days) || days < 0 || days > 3650) return
                        runCmd(`exp-${p.targeting_team}`, () => arkDecayApi.setExpiry(
                          tgt.id, p.targeting_team, days))
                      }}>
                      <CalendarPlus size={12} />
                    </button>
                    <button className="btn btn-ghost btn-sm"
                      disabled={!tgt || cmdBusy !== null}
                      style={{ color: 'var(--danger)' }}
                      title={tgt ? `${t('decay.cmd.structsTitle')} — ${tgtName}` : t('decay.cmd.noTarget')}
                      onClick={() => tgt && runCmd(`str-${p.targeting_team}`,
                        () => arkDecayApi.removeStructures(tgt.id, p.targeting_team),
                        t('decay.cmd.confirmStructs', { team: p.targeting_team, server: tgtName }))}>
                      <Building size={12} />
                    </button>
                    <button className="btn btn-ghost btn-sm"
                      disabled={!tgt || cmdBusy !== null}
                      style={{ color: 'var(--danger)' }}
                      title={tgt ? `${t('decay.cmd.dinosTitle')} — ${tgtName}` : t('decay.cmd.noTarget')}
                      onClick={() => tgt && runCmd(`din-${p.targeting_team}`,
                        () => arkDecayApi.removeDinos(tgt.id, p.targeting_team),
                        t('decay.cmd.confirmDinos', { team: p.targeting_team, server: tgtName }))}>
                      <Skull size={12} />
                    </button>
                  </div>
                </div>
                {dOpen && (
                  <div style={{ padding: '0.4rem 1rem 0.75rem 1rem', background: 'var(--bg-card-muted)' }}>
                    {detailLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                        <Loader2 size={14} className="pl-spin" /> {t('decay.detail.loading')}
                      </div>
                    ) : detailRows.length === 0 ? (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '0.5rem 0' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('decay.detail.empty')}</span>
                        {/* The snapshot only exists after a scan, so offer the
                            scan right here instead of sending the operator to
                            the toolbar to work out which server this row is on. */}
                        <button className="btn btn-secondary btn-sm"
                          disabled={!tgt || cmdBusy !== null}
                          title={tgt ? t('decay.detail.scanHereTitle', { server: tgtName }) : t('decay.cmd.noTarget')}
                          onClick={() => tgt && runCmd(`scan-${p.targeting_team}`,
                            async () => {
                              const res = await arkDecayApi.scanInstance(tgt.id)
                              await openDetail(p)
                              return res
                            })}>
                          {cmdBusy === `scan-${p.targeting_team}`
                            ? <Loader2 size={12} className="pl-spin" />
                            : <RefreshCw size={12} />} {t('decay.detail.scanHere')}
                        </button>
                      </div>
                    ) : (
                      <>
                      {detailTruncated && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', fontWeight: 600, color: '#b45309', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 6, padding: '0.4rem 0.7rem', marginBottom: 6 }}>
                          <AlertTriangle size={13} /> {t('decay.detail.truncated')}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                          {t('decay.detail.showLabel')}
                        </span>
                        {([['structure', nDetailStruct, t('playerMap.structures')],
                           ['dino', nDetailDino, t('playerMap.dinos')]] as ['structure' | 'dino', number, string][])
                          .map(([k, n, label]) => (
                          <button key={k}
                            className={detailKinds[k] ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                            style={detailKinds[k] ? undefined : { opacity: 0.55 }}
                            onClick={() => setDetailKinds(d => ({ ...d, [k]: !d[k] }))}>
                            {detailKinds[k] ? <Eye size={11} /> : <EyeOff size={11} />} {label} ({n})
                          </button>
                        ))}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {t('decay.detail.visibleCount', { shown: detailVisible.length, total: detailRows.length })}
                        </span>
                      </div>
                      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 60px 200px 150px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', padding: '0.3rem 0.5rem', position: 'sticky', top: 0, background: 'var(--bg-card-muted)' }}>
                          <span>{t('decay.detail.type')}</span><span>{t('decay.detail.name')}</span><span>{t('decay.detail.owner')}</span><span>{t('decay.detail.level')}</span><span>{t('decay.detail.coords')}</span><span></span>
                        </div>
                        {detailVisible.map(({ r: row, i: idx }) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 60px 200px 150px', alignItems: 'center', fontSize: '0.76rem', padding: '0.22rem 0.5rem', borderTop: '1px solid var(--border)' }}>
                            <span style={{ fontWeight: 600, color: row.actor_type === 'dino' ? '#8b5cf6' : 'var(--text-secondary)' }}>{row.actor_type}</span>
                            <span title={row.class_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.custom_name || row.display_name || row.class_name}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{row.owner_name || '—'}</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{row.actor_type === 'dino' && row.dino_level > 0 ? row.dino_level : '—'}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{Math.round(row.pos_x)} {Math.round(row.pos_y)} {Math.round(row.pos_z)}</span>
                            <span style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => copyTp(row, idx)} className="btn btn-ghost btn-sm" title={`cheat TPCoords ${Math.round(row.pos_x)} ${Math.round(row.pos_y)} ${Math.round(row.pos_z)}`}>
                                <Copy size={10} /> {copiedIdx === idx ? t('decay.detail.copied') : t('decay.detail.copyTp')}
                              </button>
                              {row.actor_name && (
                                <button className="btn btn-danger btn-sm"
                                  disabled={cmdInstance === '' || cmdBusy !== null}
                                  title={row.actor_name}
                                  onClick={() => destroyOne(row, idx)}>
                                  <Crosshair size={10} />
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      </>
                    )}
                  </div>
                )}
                </div>
              ); })}
            </>
          )}
        </div>
      )}

      {/* === TAB: Log === */}
      {activeTab === 'log' && (
        <div className="card" style={{ minHeight: 200 }}>
          {log.length === 0 ? (
            <div className="pl-empty"><Activity size={40} style={{ opacity: 0.15 }} /><p>{t('decay.emptyLog')}</p></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 100px 100px 100px 130px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>{t('decay.tribes.table.id')}</span><span>{t('decay.pending.table.server')}</span><span>{t('decay.log.table.map')}</span><span>{t('decay.pending.table.structures')}</span><span>{t('decay.pending.table.dinos')}</span><span>{t('decay.log.table.by')}</span><span>{t('decay.log.table.date')}</span>
              </div>
              {log.map(l => (
                <div key={l.id} style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 1fr 100px 100px 100px 130px',
                  padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{l.targeting_team}</span>
                  <span style={{ fontSize: '0.82rem' }}>{l.server_key.split('_')[0]}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>{l.map_name.replace('_WP', '')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: l.structures_destroyed > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{l.structures_destroyed}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: l.dinos_destroyed > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{l.dinos_destroyed}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.purged_by}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(l.purged_at)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
