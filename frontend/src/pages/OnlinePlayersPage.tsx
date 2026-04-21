/**
 * OnlinePlayersPage.tsx — Real-time view of connected players.
 *
 * Groups sessions by server, shows per-player duration, map and EOS ID.
 * Filters by server via the top card row.
 * Auto-refreshes every 30 seconds.
 */
import { useState, useEffect, useCallback } from 'react'
import { arkmaniaApi } from '../services/api'
import { Users, RefreshCw, Globe, Server } from 'lucide-react'

interface OnlinePlayer {
  eos_id:         string
  server_key:     string
  login_time:     string | null
  last_heartbeat: string | null
  ip_address:     string | null
  player_name:    string | null
  server_name:    string
  map_name:       string
  duration_min:   number | null
}

interface ServerStat {
  server_key:   string
  display_name: string
  map_name:     string
  is_online:    boolean
  player_count: number
  max_players:  number
  session_count:number
}

function formatDuration(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1)  return '<1m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatMapName(map: string): string {
  return map?.replace('_WP', '').replace(/([a-z])([A-Z])/g, '$1 $2') || '—'
}

export default function OnlinePlayersPage() {
  const [players, setPlayers]     = useState<OnlinePlayer[]>([])
  const [servers, setServers]     = useState<ServerStat[]>([])
  const [totalOnline, setTotalOnline]     = useState(0)
  const [serversOnline, setServersOnline] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterServer, setFilterServer] = useState<string>('all')
  const [lastUpdate, setLastUpdate]     = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh]   = useState(true)

  const loadData = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const serverParam = filterServer !== 'all' ? filterServer : undefined
      const res = await arkmaniaApi.getOnlinePlayers(serverParam)
      setPlayers(res.data.players)
      setServers(res.data.servers)
      setTotalOnline(res.data.total_online)
      setServersOnline(res.data.servers_online)
      setLastUpdate(new Date())
    } catch { /* silently handle */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [filterServer])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => loadData(true), 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadData])

  const filteredPlayers = filterServer === 'all'
    ? players
    : players.filter(p => p.server_key === filterServer)

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Users size={22} /> Online Players</h1>
          <p className="page-subtitle">
            {totalOnline} players connected on {serversOnline} active servers
            {lastUpdate && (
              <span style={{ marginLeft: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Updated: {lastUpdate.toLocaleTimeString('it-IT')}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem',
                          fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto 30s
          </label>
          <button onClick={() => loadData(true)} className="btn btn-ghost" disabled={refreshing} style={{ fontSize: '0.8rem' }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>
      </div>

      {/* Server filter cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {/* "All" card */}
        <button
          onClick={() => setFilterServer('all')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)',
            border: filterServer === 'all' ? '2px solid var(--accent)' : '1px solid var(--border)',
            background: filterServer === 'all' ? 'var(--accent-glow)' : 'var(--bg-card)',
            cursor: 'pointer', boxShadow: 'var(--shadow-sm)', textAlign: 'left',
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Globe size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{totalOnline}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>All servers</div>
          </div>
        </button>

        {/* Per-server cards */}
        {servers.filter(s => s.is_online).map(srv => (
          <button
            key={srv.server_key}
            onClick={() => setFilterServer(srv.server_key === filterServer ? 'all' : srv.server_key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.65rem',
              padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-lg)',
              border: filterServer === srv.server_key ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: filterServer === srv.server_key ? 'var(--accent-glow)' : 'var(--bg-card)',
              cursor: 'pointer', boxShadow: 'var(--shadow-sm)', textAlign: 'left', transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 7,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: srv.session_count > 0 ? 'var(--success-bg)' : 'var(--bg-card-muted)',
              border: `1px solid ${srv.session_count > 0 ? 'var(--success)' : 'var(--border)'}`,
            }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800,
                             color: srv.session_count > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                {srv.session_count}
              </span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {srv.display_name}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {formatMapName(srv.map_name)}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Player table */}
      {loading ? (
        <div className="pl-loading">Loading…</div>
      ) : filteredPlayers.length === 0 ? (
        <div className="pl-empty" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <Users size={48} style={{ opacity: 0.15 }} />
          <p style={{ fontSize: '0.92rem', fontWeight: 500 }}>No players connected</p>
          <p style={{ fontSize: '0.78rem' }}>
            {filterServer !== 'all' ? 'No players on this server' : 'The cluster is currently empty'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)',
                      borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 100px 140px',
            padding: '0.55rem 1rem', background: 'var(--bg-card-muted)',
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--text-secondary)',
          }}>
            <span>Player</span><span>Server</span><span>Map</span>
            <span style={{ textAlign: 'center' }}>Duration</span>
            <span style={{ textAlign: 'right' }}>Connected at</span>
          </div>

          {filteredPlayers.map((p) => (
            <div key={p.eos_id} style={{
              display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 100px 140px',
              padding: '0.6rem 1rem', background: 'var(--bg-card)', alignItems: 'center',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.5)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.player_name || 'Unknown'}
                  </span>
                </div>
                <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                              marginLeft: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.eos_id}
                </div>
              </div>
              <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {p.server_name}
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)',
                background: 'var(--accent-glow)', padding: '0.1rem 0.5rem', borderRadius: 4, width: 'fit-content',
              }}>
                {formatMapName(p.map_name)}
              </span>
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: (p.duration_min ?? 0) > 60 ? 'var(--accent)' : 'var(--text-secondary)',
                }}>
                  {formatDuration(p.duration_min)}
                </span>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {p.login_time
                  ? new Date(p.login_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
