/**
 * DecayPage — Tribe decay management (ARKM_tribe_decay).
 * Shows tribes with decay status, pending purge, and recent logs.
 */
import { useState, useEffect } from 'react'
import { arkDecayApi } from '../services/api'
import {
  Timer, Search, AlertCircle, AlertTriangle, CheckCircle, Clock,
  Trash2, Building, Activity, XCircle
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
  try { const d = new Date(iso); return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}

function formatHoursLeft(h: number) {
  if (h < 0) return `Scaduto da ${Math.abs(h)}h`
  if (h < 24) return `${h}h rimaste`
  return `${Math.floor(h / 24)}g ${h % 24}h`
}

type TabType = 'tribes' | 'pending' | 'log'

export default function DecayPage() {
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault(); loadData()
  }

  const TABS: { key: TabType; label: string; count: number }[] = [
    { key: 'tribes', label: 'Tribù', count: stats.total },
    { key: 'pending', label: 'In attesa purge', count: stats.pending },
    { key: 'log', label: 'Log purge', count: stats.purged_last_7d },
  ]

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Timer size={22} /> Decay Manager</h1>
          <p className="page-subtitle">Gestione decadimento tribù — {stats.total} tribù monitorate</p>
        </div>
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
          { label: 'Totale', value: stats.total, icon: Building, color: 'var(--accent)', bg: 'var(--accent-glow)' },
          { label: 'Scadute', value: stats.expired, icon: XCircle, color: 'var(--danger)', bg: 'var(--danger-bg)' },
          { label: 'In scadenza', value: stats.expiring_soon, icon: AlertTriangle, color: 'var(--warning)', bg: 'var(--warning-bg)' },
          { label: 'Sicure', value: stats.safe, icon: CheckCircle, color: 'var(--success)', bg: 'var(--success-bg)' },
          { label: 'Pending', value: stats.pending, icon: Clock, color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
          { label: 'Purge 7gg', value: stats.purged_last_7d, icon: Trash2, color: 'var(--text-muted)', bg: 'var(--bg-card-muted)' },
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
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem',
            border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
            background: activeTab === t.key ? 'var(--bg-card)' : 'transparent',
            color: activeTab === t.key ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === t.key ? 600 : 500, fontSize: '0.88rem',
            borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
            boxShadow: activeTab === t.key ? 'var(--shadow-sm)' : 'none',
          }}>
            {t.label}
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{t.count}</span>
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
                  {f === 'all' ? 'Tutte' : f === 'expired' ? 'Scadute' : f === 'expiring' ? 'In scadenza' : 'Sicure'}
                </button>
              ))}
            </div>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.3rem' }}>
              <div style={{ position: 'relative', width: 220 }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input className="input" placeholder="Cerca tribù..." value={search} onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 26, fontSize: '0.82rem', height: 32 }} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ height: 32, fontSize: '0.78rem' }}>Cerca</button>
            </form>
          </div>

          {/* Table */}
          <div style={{ maxHeight: 'calc(100vh - 400px)', overflowY: 'auto' }}>
            {loading ? <div className="pl-loading">Caricamento...</div> : tribes.length === 0 ? (
              <div className="pl-empty"><Timer size={40} style={{ opacity: 0.15 }} /><p>Nessuna tribù trovata</p></div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1.2fr 1.2fr 0.8fr 80px 120px 90px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                  <span>Tribe ID</span><span>Nome Tribù</span><span>Giocatore</span><span>Gruppo</span><span>Giorni</span><span>Scadenza</span><span style={{ textAlign: 'center' }}>Stato</span>
                </div>
                {tribes.map(t => (
                  <div key={t.targeting_team} style={{
                    display: 'grid', gridTemplateColumns: '80px 1.2fr 1.2fr 0.8fr 80px 120px 90px',
                    padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{t.targeting_team}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, fontStyle: t.tribe_name ? 'normal' : 'italic', color: t.tribe_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {t.tribe_name || 'Non Identificata'}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{t.player_name || '—'}</div>
                      <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', opacity: 0.6 }}>{t.last_refresh_eos?.slice(0, 16)}</div>
                    </div>
                    <span style={{ fontSize: '0.82rem' }}>{t.last_refresh_group || 'Default'}</span>
                    <span style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{t.last_refresh_days}g</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(t.expire_time)}</span>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 4,
                        background: t.status === 'expired' ? 'var(--danger-bg)' : t.status === 'expiring' ? 'var(--warning-bg)' : 'var(--success-bg)',
                        color: t.status === 'expired' ? 'var(--danger)' : t.status === 'expiring' ? 'var(--warning)' : 'var(--success)',
                      }}>
                        {t.status === 'expired' ? 'SCADUTA' : t.status === 'expiring' ? formatHoursLeft(t.hours_left) : 'OK'}
                      </span>
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
            <div className="pl-empty"><CheckCircle size={40} style={{ opacity: 0.15 }} /><p>Nessuna tribù in attesa di purge</p></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 0.8fr 80px 80px 70px 110px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>Tribe ID</span><span>Nome Tribù</span><span>Giocatore</span><span>Server</span><span>Motivo</span><span>Strutture</span><span>Dino</span><span>Flaggata</span>
              </div>
              {pending.map(p => (
                <div key={`${p.targeting_team}-${p.server_key}`} style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 1fr 0.8fr 80px 80px 70px 110px',
                  padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{p.targeting_team}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, fontStyle: p.tribe_name ? 'normal' : 'italic', color: p.tribe_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {p.tribe_name || 'Non Identificata'}
                  </span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{p.player_name || '—'}</span>
                  <span style={{ fontSize: '0.82rem' }}>{p.server_name || p.server_key.split('_')[0]}</span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase',
                    color: p.reason === 'orphaned' ? '#8b5cf6' : 'var(--danger)',
                  }}>{p.reason === 'orphaned' ? 'Orfana' : p.reason === 'expired' ? 'Scaduta' : p.reason}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: p.structure_count > 500 ? 700 : 400, color: p.structure_count > 500 ? 'var(--danger)' : 'var(--text-secondary)' }}>{p.structure_count.toLocaleString('it-IT')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{p.dino_count}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDate(p.flagged_at)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* === TAB: Log === */}
      {activeTab === 'log' && (
        <div className="card" style={{ minHeight: 200 }}>
          {log.length === 0 ? (
            <div className="pl-empty"><Activity size={40} style={{ opacity: 0.15 }} /><p>Nessuna purge registrata</p></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 100px 100px 100px 130px', padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>Tribe ID</span><span>Server</span><span>Mappa</span><span>Strutture</span><span>Dino</span><span>Da</span><span>Data</span>
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
