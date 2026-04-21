/**
 * DashboardPage.tsx — Cluster overview.
 *
 * Shows online players, server status, machine health, and database
 * connectivity at a glance.  Auto-refreshes every 30 seconds.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Database, Monitor, Users, Server, RefreshCw, WifiOff } from 'lucide-react'
import { machinesApi, databaseApi, arkmaniaApi } from '../services/api'

interface OnlinePlayer {
  eos_id:     string
  player_name:string | null
  server_name:string
  map_name:   string
  duration_min:number | null
}

interface ServerStat {
  server_key:   string
  display_name: string
  map_name:     string
  is_online:    boolean
  session_count:number
}

function formatDuration(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1)  return '<1m'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ''}`
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [dbOk, setDbOk]               = useState(false)
  const [machineCount, setMachineCount] = useState({ total: 0, active: 0, online: 0 })
  const [players, setPlayers]         = useState<OnlinePlayer[]>([])
  const [servers, setServers]         = useState<ServerStat[]>([])
  const [totalOnline, setTotalOnline] = useState(0)
  const [serversOnline, setServersOnline] = useState(0)

  async function loadAll(silent = false): Promise<void> {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [dbRes, countRes, onlineRes] = await Promise.allSettled([
        databaseApi.testCurrent(),
        machinesApi.count(),
        arkmaniaApi.getOnlinePlayers(),
      ])
      if (dbRes.status     === 'fulfilled') setDbOk(dbRes.value.data.success)
      if (countRes.status  === 'fulfilled') setMachineCount(countRes.value.data)
      if (onlineRes.status === 'fulfilled') {
        const d = onlineRes.value.data
        setPlayers(d.players)
        setServers(d.servers)
        setTotalOnline(d.total_online)
        setServersOnline(d.servers_online)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadAll() }, [])
  useEffect(() => {
    const id = setInterval(() => loadAll(true), 30_000)
    return () => clearInterval(id)
  }, [])

  const serversOffline = servers.filter(s => !s.is_online)

  const statCards = [
    { label: t('dashboard.stat.onlinePlayers'), value: totalOnline,                                  icon: Users,   color: 'var(--accent)',         nav: '/online' },
    { label: t('dashboard.stat.serversOnline'), value: `${serversOnline}/${servers.length}`,         icon: Server,  color: 'var(--success)',        nav: '/serverforge' },
    { label: t('dashboard.stat.sshMachines'),   value: `${machineCount.online}/${machineCount.total}`, icon: Monitor, color: 'var(--text-secondary)', nav: '/settings/machines' },
    { label: t('dashboard.stat.database'),      value: dbOk ? t('dashboard.stat.dbOk') : t('dashboard.stat.dbOffline'), icon: Database, color: dbOk ? 'var(--success)' : 'var(--danger)', nav: '/settings/db' },
  ]

  return (
    <div className="page-container">
      {/* Hero */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '1rem 1.25rem', marginBottom: '1.25rem',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        borderRadius: 'var(--radius-lg)', border: '1px solid rgba(59,130,246,0.15)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <img
          src="/logo.png" alt="ArkMania"
          style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0,
                   filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }}
        />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff',
                       letterSpacing: '-0.02em', lineHeight: 1.2, margin: 0 }}>
            ArkMania<span style={{ color: '#60a5fa', fontWeight: 600 }}>Gest</span>
          </h1>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', margin: '0.15rem 0 0' }}>
            {t('dashboard.subtitle')}
          </p>
        </div>
        <button
          onClick={() => loadAll(true)} disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.4rem 0.75rem',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '0.78rem',
          }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem', marginBottom: '1.25rem' }}>
        {statCards.map(s => (
          <div
            key={s.label}
            onClick={() => navigate(s.nav)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.7rem',
              padding: '0.75rem 1rem',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 8, flexShrink: 0,
              background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <s.icon size={18} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>
                {loading ? '…' : s.value}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 2-column: players + servers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* Online players */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.65rem 1rem', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card-muted)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={16} color="var(--accent)" />
              <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>{t('dashboard.card.onlinePlayers')}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)' }}>{totalOnline}</span>
            </div>
            <button onClick={() => navigate('/online')} className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
              {t('dashboard.card.viewAll')}
            </button>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {players.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <Users size={32} style={{ opacity: 0.15, display: 'block', margin: '0 auto 0.5rem' }} />
                {t('dashboard.card.noPlayers')}
              </div>
            ) : players.map((p) => (
              <div key={p.eos_id} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.45rem 1rem', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.5)' }} />
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.player_name || t('dashboard.card.unknown')}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600,
                               background: 'var(--accent-glow)', padding: '0.1rem 0.45rem',
                               borderRadius: 4, flexShrink: 0 }}>
                  {p.server_name}
                </span>
                <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                               flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
                  {formatDuration(p.duration_min)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Server status */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.65rem 1rem', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card-muted)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Server size={16} color="var(--success)" />
              <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>{t('dashboard.card.serverStatus')}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {t('dashboard.card.serversOnlineCount', { count: serversOnline })}
                {serversOffline.length > 0 && ` · ${t('dashboard.card.serversOfflineCount', { count: serversOffline.length })}`}
              </span>
            </div>
            <button onClick={() => navigate('/serverforge')} className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
              {t('dashboard.card.serverforgeLink')}
            </button>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {servers.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <Server size={32} style={{ opacity: 0.15, display: 'block', margin: '0 auto 0.5rem' }} />
                {t('dashboard.card.noServers')}
              </div>
            ) : servers.map(srv => (
              <div key={srv.server_key} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)',
                opacity: srv.is_online ? 1 : 0.5,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: srv.is_online ? (srv.session_count > 0 ? '#22c55e' : '#94a3b8') : '#ef4444',
                  boxShadow: srv.is_online && srv.session_count > 0 ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {srv.display_name}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {srv.map_name || srv.server_key.split('_')[0]}
                  </div>
                </div>
                {srv.is_online ? (
                  srv.session_count > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                      <Users size={12} color="var(--accent)" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)' }}>{srv.session_count}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', flexShrink: 0 }}>{t('dashboard.card.empty')}</span>
                  )
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                    <WifiOff size={12} color="#ef4444" />
                    <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600 }}>{t('dashboard.card.offline')}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
