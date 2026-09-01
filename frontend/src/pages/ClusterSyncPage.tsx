/**
 * ClusterSyncPage - Health of the ARK cluster directory across the machines.
 *
 * ARK implements cluster transfers as files on disk, so a multi-host cluster
 * only works while every host sees the same directory. When the replication
 * behind that breaks, nothing errors: uploads keep succeeding on the origin
 * and simply never arrive. This page makes that visible.
 *
 * Read-only: the panel never performs the replication itself (Syncthing,
 * DFS-R or an SMB share do), it only reports whether the hosts still agree.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Network, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle,
  Clock, HelpCircle, Copy, Check,
} from 'lucide-react'
import { clusterSyncApi } from '../services/api'
import type { ClusterSyncHealth, ClusterSyncStatus } from '../types'

const GRID_COLUMNS = '1.4fr 2.2fr 90px 110px 150px 1fr'

const labelStyle: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)',
  display: 'block', marginBottom: 3,
}

/** Status -> icon + colour token. Keep in step with ClusterSyncStatus. */
const STATUS_STYLE: Record<ClusterSyncStatus, { icon: typeof CheckCircle2; color: string }> = {
  ok:      { icon: CheckCircle2,  color: 'var(--success)' },
  drift:   { icon: AlertTriangle, color: 'var(--danger)' },
  stale:   { icon: Clock,         color: 'var(--warning)' },
  unknown: { icon: HelpCircle,    color: 'var(--text-muted)' },
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function ClusterSyncPage() {
  const { t } = useTranslation()
  const [clusters, setClusters] = useState<ClusterSyncHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await clusterSyncApi.list()
      setClusters(res.data)
    } catch (e: any) {
      setError(e?.response?.data?.detail || t('clusterSync.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  // Device IDs are meant to be exchanged between peers, so a copy button is
  // the whole point of surfacing them here.
  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      // Clipboard is unavailable over plain HTTP; the id stays selectable.
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">
            <Network size={20} style={{ marginRight: 8, verticalAlign: '-3px' }} />
            {t('clusterSync.title')}
          </h1>
          <p className="page-subtitle">{t('clusterSync.subtitle')}</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          {t('clusterSync.refresh')}
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {loading ? (
        <div className="card"><div className="pl-loading" style={{ padding: '3rem' }}>{t('clusterSync.loading')}</div></div>
      ) : clusters.length === 0 ? (
        <div className="card">
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <Network size={40} style={{ opacity: 0.12 }} />
            <p>{t('clusterSync.empty')}</p>
          </div>
        </div>
      ) : clusters.map(cluster => {
        const style = STATUS_STYLE[cluster.status] || STATUS_STYLE.unknown
        const StatusIcon = style.icon
        return (
          <div key={cluster.cluster_id} className="card"
            style={{ marginBottom: '0.9rem', padding: 0, overflow: 'hidden' }}>

            {/* Verdict banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-card-muted)',
            }}>
              <StatusIcon size={18} style={{ color: style.color, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  {cluster.cluster_id}
                  <span style={{
                    marginLeft: 8, fontSize: '0.65rem', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: style.color,
                  }}>
                    {t(`clusterSync.status.${cluster.status}`)}
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  {cluster.detail}
                </div>
              </div>
            </div>

            {/* Per-host table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: GRID_COLUMNS,
              padding: '0.45rem 1rem', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)',
            }}>
              <span>{t('clusterSync.column.machine')}</span>
              <span>{t('clusterSync.column.path')}</span>
              <span>{t('clusterSync.column.files')}</span>
              <span>{t('clusterSync.column.size')}</span>
              <span>{t('clusterSync.column.newest')}</span>
              <span>{t('clusterSync.column.replication')}</span>
            </div>

            {cluster.members.map(m => (
              <div key={m.machine_id} style={{
                display: 'grid', gridTemplateColumns: GRID_COLUMNS,
                padding: '0.5rem 1rem', alignItems: 'center',
                borderBottom: '1px solid var(--border)', fontSize: '0.78rem',
              }}>
                <span style={{ fontWeight: 600 }}>{m.machine_name}</span>

                <span style={{
                  fontFamily: 'monospace', fontSize: '0.72rem',
                  color: 'var(--text-muted)', overflowWrap: 'anywhere',
                }}>
                  {m.path || '—'}
                </span>

                {m.error ? (
                  <span style={{ gridColumn: 'span 3', color: 'var(--danger)', fontSize: '0.74rem' }}>
                    {m.error}
                  </span>
                ) : (
                  <>
                    <span>{m.file_count}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatBytes(m.total_bytes)}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {m.newest_epoch
                        ? new Date(m.newest_epoch * 1000).toLocaleString(undefined, {
                            day: '2-digit', month: '2-digit', year: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </span>
                  </>
                )}

                {/* Replication: what actually matters is whether the daemon
                    covers the directory ARK writes to, not just that it runs. */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {!m.syncthing?.present ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                      {t('clusterSync.syncthing.absent')}
                    </span>
                  ) : (
                    <>
                      {m.syncthing.covers_cluster_dir ? (
                        <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                      ) : (
                        <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                      )}
                      <span
                        title={m.syncthing.device_id}
                        style={{
                          fontFamily: 'monospace', fontSize: '0.7rem',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: m.syncthing.covers_cluster_dir
                            ? 'var(--text-muted)' : 'var(--warning)',
                        }}
                      >
                        {m.syncthing.covers_cluster_dir
                          ? (m.syncthing.device_id.split('-')[0] || t('clusterSync.syncthing.present'))
                          : t('clusterSync.syncthing.wrongFolder')}
                      </span>
                      {m.syncthing.device_id && (
                        <button
                          onClick={() => copyId(m.syncthing!.device_id)}
                          title={t('clusterSync.syncthing.copyId')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', padding: 0, flexShrink: 0,
                          }}
                        >
                          {copied === m.syncthing.device_id
                            ? <Check size={12} style={{ color: 'var(--success)' }} />
                            : <Copy size={12} />}
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {/* The path nesting is the single most common misconfiguration, so it
          is spelled out on the page rather than buried in the docs. */}
      {!loading && clusters.length > 0 && (
        <div className="card" style={{ padding: '0.7rem 1rem' }}>
          <label style={labelStyle}>{t('clusterSync.hintTitle')}</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
            {t('clusterSync.hintBody')}
          </p>
        </div>
      )}
    </div>
  )
}
