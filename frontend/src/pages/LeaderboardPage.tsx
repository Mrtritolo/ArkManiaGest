/**
 * LeaderboardPage — ArkMania player leaderboard.
 * Scores, PvE/PvP filters, recent event log.
 */
import { useState, useEffect } from 'react'
import { arkLeaderboardApi } from '../services/api'
import {
  Trophy, Search, Crosshair, Heart, Hammer, Skull, Users, Activity,
  AlertCircle, RefreshCw, ChevronDown
} from 'lucide-react'

interface LbScore {
  rank: number; eos_id: string; player_name: string; server_type: string
  total_points: number; kills_wild: number; kills_enemy_dino: number
  kills_player: number; tames: number; crafts: number
  structs_destroyed: number; deaths: number; last_event: string | null
}
interface LbEvent {
  id: number; eos_id: string; player_name: string
  event_type: number; event_label: string; points: number
  target_name: string | null; target_level: number
  server_key: string; server_type: string; created_at: string | null
}
interface LbStats {
  total_players: number; total_points: number; total_kills_wild: number
  total_kills_enemy_dino: number; total_kills_player: number
  total_tames: number; total_crafts: number; total_deaths: number
  total_events: number
}

const EVENT_COLORS: Record<number, string> = {
  1: '#ef4444', 2: '#f97316', 3: '#dc2626',
  4: '#22c55e', 5: '#3b82f6', 6: '#8b5cf6', 7: '#6b7280',
}
const EVENT_ICONS: Record<number, string> = {
  1: '🗡️', 2: '⚔️', 3: '☠️', 4: '🦎', 5: '🔨', 6: '💥', 7: '💀',
}

const SORT_OPTIONS = [
  { value: 'total_points', label: 'Punti' },
  { value: 'kills_wild', label: 'Kill Wild' },
  { value: 'kills_player', label: 'Kill PvP' },
  { value: 'tames', label: 'Tame' },
  { value: 'crafts', label: 'Craft' },
  { value: 'deaths', label: 'Morti' },
]

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso.slice(0, 16) }
}

function fmtServer(key: string) {
  return key.split('_')[0]
}

type TabType = 'classifica' | 'eventi'

export default function LeaderboardPage() {
  const [stats, setStats] = useState<LbStats | null>(null)
  const [scores, setScores] = useState<LbScore[]>([])
  const [events, setEvents] = useState<LbEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('classifica')

  // Filtri
  const [serverType, setServerType] = useState<string>('')
  const [sortBy, setSortBy] = useState('total_points')
  const [search, setSearch] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState<number | undefined>(undefined)

  async function loadData() {
    setLoading(true)
    try {
      const [statsRes, scoresRes, eventsRes] = await Promise.all([
        arkLeaderboardApi.overview(),
        arkLeaderboardApi.scores({
          server_type: serverType || undefined,
          sort_by: sortBy,
          limit: 100,
          search: search || undefined,
        }),
        arkLeaderboardApi.events({
          server_type: serverType || undefined,
          event_type: eventTypeFilter,
          limit: 50,
        }),
      ])
      setStats(statsRes.data)
      setScores(scoresRes.data.scores)
      setEvents(eventsRes.data.events)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [serverType, sortBy, eventTypeFilter])

  function handleSearch(e: React.FormEvent) { e.preventDefault(); loadData() }

  function getRankStyle(rank: number) {
    if (rank === 1) return { background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#000', fontWeight: 900 }
    if (rank === 2) return { background: 'linear-gradient(135deg, #d1d5db, #9ca3af)', color: '#000', fontWeight: 800 }
    if (rank === 3) return { background: 'linear-gradient(135deg, #d97706, #b45309)', color: '#fff', fontWeight: 800 }
    return { background: 'var(--bg-card-muted)', color: 'var(--text-muted)', fontWeight: 600 }
  }

  const TABS: { key: TabType; label: string }[] = [
    { key: 'classifica', label: 'Classifica' },
    { key: 'eventi', label: 'Eventi recenti' },
  ]

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Trophy size={22} /> Leaderboard</h1>
          <p className="page-subtitle">
            Classifica giocatori ArkMania
            {stats && <> — {stats.total_players} giocatori, {stats.total_events} eventi</>}
          </p>
        </div>
        <button onClick={loadData} className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
          {[
            { label: 'Giocatori', value: stats.total_players, icon: Users, color: 'var(--accent)' },
            { label: 'Punti Totali', value: stats.total_points, icon: Trophy, color: '#f59e0b' },
            { label: 'Kill Wild', value: stats.total_kills_wild, icon: Crosshair, color: '#ef4444' },
            { label: 'Tame', value: stats.total_tames, icon: Heart, color: '#22c55e' },
            { label: 'Craft', value: stats.total_crafts, icon: Hammer, color: '#3b82f6' },
            { label: 'Morti', value: stats.total_deaths, icon: Skull, color: '#6b7280' },
          ].map(s => (
            <div key={s.label} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            }}>
              <s.icon size={15} color={s.color} />
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{loading ? '...' : s.value.toLocaleString('it-IT')}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filtri globali */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          {['', 'PvE', 'PvP'].map(t => (
            <button key={t} onClick={() => setServerType(t)} style={{
              padding: '0.3rem 0.65rem', border: 'none', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer',
              background: serverType === t ? 'var(--accent)' : 'var(--bg-input)',
              color: serverType === t ? '#fff' : 'var(--text-secondary)',
            }}>
              {t || 'Tutti'}
            </button>
          ))}
        </div>

        {/* Tabs */}
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '0.3rem 0.75rem', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
            background: activeTab === t.key ? 'var(--bg-card)' : 'transparent',
            color: activeTab === t.key ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === t.key ? 700 : 500, fontSize: '0.82rem',
            boxShadow: activeTab === t.key ? 'var(--shadow-sm)' : 'none',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* === TAB: Classifica === */}
      {activeTab === 'classifica' && (
        <div className="card" style={{ minHeight: 300 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-card-muted)', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ordina per:</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
                fontSize: '0.78rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', background: 'var(--bg-input)', color: 'var(--text-primary)',
              }}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.3rem' }}>
              <div style={{ position: 'relative', width: 200 }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input className="input" placeholder="Cerca giocatore..." value={search} onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 26, fontSize: '0.82rem', height: 30 }} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ height: 30, fontSize: '0.75rem' }}>Cerca</button>
            </form>
          </div>

          {/* Table */}
          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            {loading ? <div className="pl-loading">Caricamento...</div> : scores.length === 0 ? (
              <div className="pl-empty"><Trophy size={40} style={{ opacity: 0.12 }} /><p>Nessun giocatore in classifica</p></div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1.5fr 80px 80px 70px 70px 70px 70px 70px 100px', padding: '0.45rem 1rem', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0 }}>
                  <span>#</span><span>Giocatore</span><span style={{ textAlign: 'right' }}>Punti</span>
                  <span style={{ textAlign: 'right' }}>Kill Wild</span><span style={{ textAlign: 'right' }}>Kill PvP</span>
                  <span style={{ textAlign: 'right' }}>Tame</span><span style={{ textAlign: 'right' }}>Craft</span>
                  <span style={{ textAlign: 'right' }}>Distrutti</span><span style={{ textAlign: 'right' }}>Morti</span>
                  <span style={{ textAlign: 'right' }}>Ultimo</span>
                </div>
                {scores.map(s => (
                  <div key={`${s.eos_id}-${s.server_type}`} style={{
                    display: 'grid', gridTemplateColumns: '50px 1.5fr 80px 80px 70px 70px 70px 70px 70px 100px',
                    padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                    background: s.rank <= 3 ? 'rgba(251,191,36,0.03)' : 'transparent',
                  }}>
                    {/* Rank badge */}
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 6, fontSize: '0.78rem',
                        ...getRankStyle(s.rank),
                      }}>
                        {s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] : s.rank}
                      </span>
                    </div>
                    {/* Nome */}
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{s.player_name}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{s.server_type}</div>
                    </div>
                    {/* Stats */}
                    <span style={{ textAlign: 'right', fontSize: '0.9rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{s.total_points.toLocaleString('it-IT')}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.kills_wild > 0 ? '#ef4444' : 'var(--text-muted)' }}>{s.kills_wild}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.kills_player > 0 ? '#dc2626' : 'var(--text-muted)' }}>{s.kills_player}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.tames > 0 ? '#22c55e' : 'var(--text-muted)' }}>{s.tames}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.crafts > 0 ? '#3b82f6' : 'var(--text-muted)' }}>{s.crafts}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.structs_destroyed > 0 ? '#8b5cf6' : 'var(--text-muted)' }}>{s.structs_destroyed}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: s.deaths > 0 ? '#6b7280' : 'var(--text-muted)' }}>{s.deaths}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtDate(s.last_event)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Eventi === */}
      {activeTab === 'eventi' && (
        <div className="card" style={{ minHeight: 300 }}>
          {/* Filtro tipo evento */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-card-muted)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Tipo:</span>
            {[
              { value: undefined, label: 'Tutti' },
              { value: 1, label: '🗡️ Kill Wild' },
              { value: 3, label: '☠️ Kill PvP' },
              { value: 4, label: '🦎 Tame' },
              { value: 5, label: '🔨 Craft' },
            ].map(f => (
              <button key={String(f.value)} onClick={() => setEventTypeFilter(f.value)} style={{
                padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius)',
                fontSize: '0.75rem', cursor: 'pointer',
                background: eventTypeFilter === f.value ? 'var(--accent)' : 'var(--bg-input)',
                color: eventTypeFilter === f.value ? '#fff' : 'var(--text-secondary)',
              }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            {loading ? <div className="pl-loading">Caricamento...</div> : events.length === 0 ? (
              <div className="pl-empty"><Activity size={40} style={{ opacity: 0.12 }} /><p>Nessun evento registrato</p></div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 1.5fr 80px 100px', padding: '0.45rem 1rem', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '2px solid var(--border)' }}>
                  <span>Giocatore</span><span>Evento</span><span style={{ textAlign: 'right' }}>Punti</span>
                  <span>Target</span><span>Server</span><span style={{ textAlign: 'right' }}>Data</span>
                </div>
                {events.map(ev => (
                  <div key={ev.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 80px 1.5fr 80px 100px',
                    padding: '0.45rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                    borderLeft: `3px solid ${EVENT_COLORS[ev.event_type] || '#888'}`,
                  }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{ev.player_name}</span>
                    <span style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span>{EVENT_ICONS[ev.event_type] || '?'}</span>
                      <span style={{ color: EVENT_COLORS[ev.event_type] || '#888', fontWeight: 600 }}>{ev.event_label}</span>
                    </span>
                    <span style={{ textAlign: 'right', fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>+{ev.points}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.target_name || '—'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>{fmtServer(ev.server_key)}</span>
                    <span style={{ textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtDate(ev.created_at)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
