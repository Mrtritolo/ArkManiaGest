/**
 * EventLogPage - Read-only viewer for ARKM_event_log.
 *
 * Displays all server events (LOGIN, RARE_SPAWN, RARE_DESPAWN, RARE_KILLED,
 * RARE_TAMED, DECAY_SCAN) in a filterable, paginated table with aggregate
 * stats cards.  Follows the same design patterns as TransferRulesPage.
 */
import { useState, useEffect, useCallback } from 'react'
import { arkmaniaApi } from '../services/api'
import {
  ScrollText, RefreshCw, AlertCircle, Search, ChevronLeft, ChevronRight,
  LogIn, Skull, Heart, Eye, Timer, Sparkles, Trash2, CheckCircle
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventItem {
  id: number
  event_type: string
  eos_id: string | null
  player_name: string | null
  server_key: string
  details: string
  event_time: string | null
  discord_sent: boolean
}

interface EventStat {
  event_type: string
  count: number
  latest: string | null
}

interface ServerItem {
  server_key: string
  display_name: string
}

// ── Event type styling map ────────────────────────────────────────────────────

const EVENT_STYLES: Record<string, { color: string; bg: string; icon: LucideIcon; label: string }> = {
  LOGIN:        { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  icon: LogIn,    label: 'Login' },
  RARE_SPAWN:   { color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', icon: Sparkles, label: 'Rare Spawn' },
  RARE_DESPAWN: { color: '#6b7280', bg: 'rgba(107,114,128,0.08)',icon: Eye,      label: 'Rare Despawn' },
  RARE_KILLED:  { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  icon: Skull,    label: 'Rare Killed' },
  RARE_TAMED:   { color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  icon: Heart,    label: 'Rare Tamed' },
  DECAY_SCAN:   { color: '#ca8a04', bg: 'rgba(202,138,4,0.08)',  icon: Timer,    label: 'Decay Scan' },
}

const DEFAULT_STYLE = { color: '#6b7280', bg: 'rgba(107,114,128,0.08)', icon: ScrollText, label: '?' }

function getStyle(type: string) {
  return EVENT_STYLES[type] || DEFAULT_STYLE
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const labelStyle: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)',
  display: 'block', marginBottom: 3,
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EventLogPage() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [stats, setStats] = useState<EventStat[]>([])
  const [servers, setServers] = useState<ServerItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [eventType, setEventType] = useState('')
  const [serverKey, setServerKey] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  // Purge
  const [showPurge, setShowPurge] = useState(false)
  const [purgeDays, setPurgeDays] = useState(30)
  const [purgeType, setPurgeType] = useState('')
  const [purging, setPurging] = useState(false)
  const [success, setSuccess] = useState('')

  // ── Data loading ────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (eventType) params.event_type = eventType
      if (serverKey) params.server_key = serverKey
      if (search) params.search = search
      const res = await arkmaniaApi.getEvents(params)
      setEvents(res.data.events)
      setTotal(res.data.total)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }, [eventType, serverKey, search, page])

  const loadMeta = useCallback(async () => {
    try {
      const [statsRes, serversRes] = await Promise.all([
        arkmaniaApi.getEventStats(),
        arkmaniaApi.listServers(),
      ])
      setStats(statsRes.data.stats)
      setServers(serversRes.data.servers)
    } catch { /* stats are optional */ }
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadEvents() }, [loadEvents])
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t) }
  }, [success])

  async function handlePurge() {
    const typeLabel = purgeType ? getStyle(purgeType).label : 'tutti i tipi'
    const msg = purgeDays === 0
      ? `ATTENZIONE: Eliminare TUTTI gli eventi (${typeLabel})?\nQuesta azione e' irreversibile!`
      : `Eliminare gli eventi piu' vecchi di ${purgeDays} giorni (${typeLabel})?\nQuesta azione e' irreversibile.`
    if (!confirm(msg)) return
    setPurging(true)
    try {
      const res = await arkmaniaApi.purgeEvents(purgeDays, purgeType || undefined)
      setSuccess(`${res.data.deleted.toLocaleString()} eventi eliminati`)
      setShowPurge(false)
      loadMeta()
      loadEvents()
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setPurging(false)
    }
  }

  // Reset page when filters change
  function applyFilter(setter: (v: string) => void, value: string) {
    setter(value)
    setPage(0)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function resolveServer(key: string): string {
    const s = servers.find(sv => sv.server_key === key)
    return s?.display_name || key.split('_')[0]
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const totalEvents = stats.reduce((s, e) => s + e.count, 0)

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><ScrollText size={22} /> Event Log</h1>
          <p className="page-subtitle">{totalEvents.toLocaleString()} eventi totali — pagina {page + 1} di {totalPages || 1}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => setShowPurge(!showPurge)} className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
            <Trash2 size={14} /> Pulisci
          </button>
          <button onClick={() => { loadMeta(); loadEvents() }} className="btn btn-secondary" style={{ padding: '0.4rem' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Success message */}
      {success && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.85rem', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#16a34a' }}>
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {/* Purge panel */}
      {showPurge && (
        <div className="card" style={{ padding: '1rem', marginBottom: '0.75rem', borderLeft: '3px solid #dc2626' }}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', fontWeight: 700, color: '#dc2626' }}>
            <Trash2 size={14} style={{ verticalAlign: -2 }} /> Pulizia Event Log
          </h3>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <label style={labelStyle}>Mantieni ultimi</label>
              <select className="input" value={purgeDays} onChange={e => setPurgeDays(Number(e.target.value))} style={{ fontSize: '0.82rem' }}>
                <option value={7}>7 giorni</option>
                <option value={14}>14 giorni</option>
                <option value={30}>30 giorni</option>
                <option value={60}>60 giorni</option>
                <option value={90}>90 giorni</option>
                <option value={180}>6 mesi</option>
                <option value={365}>1 anno</option>
                <option value={0}>Elimina TUTTI</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo evento</label>
              <select className="input" value={purgeType} onChange={e => setPurgeType(e.target.value)} style={{ fontSize: '0.82rem' }}>
                <option value="">Tutti i tipi</option>
                {Object.entries(EVENT_STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <button onClick={handlePurge} disabled={purging} className="btn btn-primary"
              style={{ fontSize: '0.82rem', background: '#dc2626', borderColor: '#dc2626' }}>
              {purging ? 'Eliminazione...' : 'Elimina vecchi eventi'}
            </button>
            <button onClick={() => setShowPurge(false)} className="btn btn-ghost" style={{ fontSize: '0.82rem' }}>Annulla</button>
          </div>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Verranno eliminati tutti gli eventi precedenti alla data di retention selezionata. Azione irreversibile.
          </p>
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
        {stats.map(s => {
          const st = getStyle(s.event_type)
          const Icon = st.icon
          return (
            <button key={s.event_type} onClick={() => applyFilter(setEventType, eventType === s.event_type ? '' : s.event_type)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem',
                background: eventType === s.event_type ? st.bg : 'var(--bg-card)',
                border: `1px solid ${eventType === s.event_type ? st.color : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)',
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
              }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: st.bg, border: `1px solid ${st.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={13} color={st.color} />
              </div>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: st.color, lineHeight: 1 }}>{s.count.toLocaleString()}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{st.label}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '0.6rem 1rem', marginBottom: '0.75rem', display: 'flex', gap: '0.6rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 140 }}>
          <label style={labelStyle}>Tipo Evento</label>
          <select className="input" value={eventType} onChange={e => applyFilter(setEventType, e.target.value)}
            style={{ fontSize: '0.82rem' }}>
            <option value="">Tutti</option>
            {Object.entries(EVENT_STYLES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <label style={labelStyle}>Server</label>
          <select className="input" value={serverKey} onChange={e => applyFilter(setServerKey, e.target.value)}
            style={{ fontSize: '0.82rem' }}>
            <option value="">Tutti</option>
            {servers.map(s => (
              <option key={s.server_key} value={s.server_key}>{s.display_name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={labelStyle}>Cerca</label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Giocatore o dettagli..."
              value={search} onChange={e => applyFilter(setSearch, e.target.value)}
              style={{ fontSize: '0.82rem', paddingLeft: 28 }} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ minHeight: 200 }}>
        {loading ? (
          <div className="pl-loading" style={{ padding: '3rem' }}>Caricamento...</div>
        ) : events.length === 0 ? (
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <ScrollText size={40} style={{ opacity: 0.12 }} />
            <p>Nessun evento trovato</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '110px 1.2fr 0.8fr 2fr 130px',
              padding: '0.5rem 1rem', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-secondary)', background: 'var(--bg-card-muted)',
              borderBottom: '2px solid var(--border)',
            }}>
              <span>Tipo</span>
              <span>Giocatore</span>
              <span>Server</span>
              <span>Dettagli</span>
              <span>Data/Ora</span>
            </div>

            {/* Rows */}
            {events.map(ev => {
              const st = getStyle(ev.event_type)
              const Icon = st.icon
              return (
                <div key={ev.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1.2fr 0.8fr 2fr 130px',
                  padding: '0.45rem 1rem', alignItems: 'center',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${st.color}`,
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  {/* Event type badge */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                    padding: '0.12rem 0.45rem', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700,
                    background: st.bg, color: st.color, border: `1px solid ${st.color}20`,
                    whiteSpace: 'nowrap',
                  }}>
                    <Icon size={11} /> {st.label}
                  </span>

                  {/* Player name */}
                  <div>
                    {ev.player_name ? (
                      <>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{ev.player_name}</span>
                        {ev.eos_id && (
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {ev.eos_id.substring(0, 12)}...
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>—</span>
                    )}
                  </div>

                  {/* Server */}
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {resolveServer(ev.server_key)}
                  </span>

                  {/* Details */}
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.details}
                  </span>

                  {/* Timestamp */}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {ev.event_time ? new Date(ev.event_time).toLocaleString('it-IT', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                    }) : '—'}
                  </span>
                </div>
              )
            })}
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
            padding: '0.6rem 1rem', borderTop: '1px solid var(--border)',
            fontSize: '0.82rem', color: 'var(--text-secondary)',
          }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="btn btn-ghost" style={{ padding: '0.3rem 0.5rem' }}>
              <ChevronLeft size={16} />
            </button>
            <span>Pagina <strong>{page + 1}</strong> di <strong>{totalPages}</strong></span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="btn btn-ghost" style={{ padding: '0.3rem 0.5rem' }}>
              <ChevronRight size={16} />
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              ({total.toLocaleString()} risultati)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
