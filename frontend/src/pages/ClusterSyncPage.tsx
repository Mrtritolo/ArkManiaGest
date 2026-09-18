/**
 * ClusterSyncPage - health of the ARK cluster directory across the machines.
 *
 * ARK implements cluster transfers as files on disk, so a multi-host cluster
 * only works while every host sees the same directory. When the replication
 * behind that breaks, nothing errors: uploads keep succeeding on the origin
 * and simply never arrive. This page makes that visible.
 *
 * Read-only for every role: the panel never performs the replication itself
 * (Syncthing, DFS-R or an SMB share do), it only reports whether the hosts
 * still agree.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleAlert, CircleCheck, CircleHelp, Clock, Network, RotateCw, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import { clusterSyncApi } from '../services/api'
import { extractError } from '../utils/errors'
import {
  Alert, Badge, Button, Card, CopyButton, EmptyState, NotAvailable, PageHeader,
  Spinner, Table, TableMessageRow, type BadgeTone,
} from '../components/ui'
import type { AuthUser, ClusterSyncHealth, ClusterSyncStatus } from '../types'
import styles from './ClusterSyncPage.module.css'

/** Verdict -> badge tone + icon. Keep in step with ClusterSyncStatus. */
const STATUS_BADGE: Record<ClusterSyncStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  ok: { tone: 'success', icon: CircleCheck },
  drift: { tone: 'danger', icon: CircleAlert },
  stale: { tone: 'warning', icon: Clock },
  unknown: { tone: 'neutral', icon: CircleHelp },
}

const COLUMNS = 6

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

interface Props {
  // Passed to every page by App.tsx; this page is read-only for every role.
  currentUser?: AuthUser | null
}

export default function ClusterSyncPage(_props: Props) {
  const { t } = useTranslation()
  const [clusters, setClusters] = useState<ClusterSyncHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  // null = no error; '' = the probe failed without a detail.
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  // No dependency on `t`: it changes identity on a language switch, and every
  // reload probes each cluster host over SSH.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await clusterSyncApi.list()
      setClusters(res.data)
      setError(null)
      setLastChecked(new Date())
    } catch (e) {
      // The rows already on screen stay: a failed probe is not "no clusters".
      setError(extractError(e, ''))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const firstLoad = !loaded && loading

  return (
    <div className="l-page">
      <PageHeader
        title={t('clusterSync.title')}
        icon={Network}
        description={
          <>
            {t('clusterSync.subtitle')}
            {lastChecked && (
              <> {t('clusterSync.lastChecked', { time: lastChecked.toLocaleTimeString() })}</>
            )}
          </>
        }
        actions={
          <Button
            icon={RotateCw}
            loading={loading}
            loadingLabel={t('clusterSync.loading')}
            onClick={load}
          >
            {t('clusterSync.refresh')}
          </Button>
        }
      />

      {error !== null && (
        <Alert
          tone="danger"
          title={t('clusterSync.loadError')}
          onDismiss={() => setError(null)}
          actions={<Button size="sm" icon={RotateCw} onClick={load}>{t('common.retry')}</Button>}
        >
          {error || undefined}
        </Alert>
      )}

      {firstLoad ? (
        <Card><Spinner block label={t('clusterSync.loading')} /></Card>
      ) : clusters.length === 0 ? (
        <Card><EmptyState icon={Network} title={t('clusterSync.empty')} /></Card>
      ) : (
        clusters.map(cluster => {
          const badge = STATUS_BADGE[cluster.status] ?? STATUS_BADGE.unknown
          return (
            <Card
              key={cluster.cluster_id}
              titleAs="h2"
              flush
              title={
                <span className="l-cluster">
                  <span className="u-mono">{cluster.cluster_id}</span>
                  <Badge tone={badge.tone} icon={badge.icon}>
                    {t(`clusterSync.status.${cluster.status}`)}
                  </Badge>
                </span>
              }
              actions={
                // Refreshing keeps every card on screen.
                loading && !firstLoad ? <Spinner label={t('clusterSync.loading')} /> : undefined
              }
            >
              <p className={styles.verdict}>{cluster.detail}</p>
              <Table label={t('clusterSync.tableLabel', { id: cluster.cluster_id })} minWidth={880}>
                <thead>
                  <tr>
                    <th scope="col">{t('clusterSync.column.machine')}</th>
                    <th scope="col">{t('clusterSync.column.path')}</th>
                    <th scope="col" className="u-text-end">{t('clusterSync.column.files')}</th>
                    <th scope="col" className="u-text-end">{t('clusterSync.column.size')}</th>
                    <th scope="col">{t('clusterSync.column.newest')}</th>
                    <th scope="col">{t('clusterSync.column.replication')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.members.length === 0 ? (
                    <TableMessageRow colSpan={COLUMNS}>
                      <EmptyState icon={Network} title={t('clusterSync.noMembers')} />
                    </TableMessageRow>
                  ) : (
                    cluster.members.map(m => (
                      <tr key={m.machine_id}>
                        <td>{m.machine_name}</td>
                        <td className="ui-cell-wrap u-mono">{m.path || <NotAvailable />}</td>

                        {m.error ? (
                          <td colSpan={3}>
                            <span className="l-cluster">
                              <Badge tone="danger" icon={CircleAlert}>{t('clusterSync.probeFailed')}</Badge>
                              <span className="u-text-sm">{m.error}</span>
                            </span>
                          </td>
                        ) : (
                          <>
                            <td className="u-num u-text-end">{m.file_count}</td>
                            <td className="u-num u-text-end u-muted">{formatBytes(m.total_bytes)}</td>
                            <td className="u-num u-mono u-muted">
                              {m.newest_epoch
                                ? new Date(m.newest_epoch * 1000).toLocaleString(undefined, {
                                    day: '2-digit', month: '2-digit', year: '2-digit',
                                    hour: '2-digit', minute: '2-digit',
                                  })
                                : <NotAvailable />}
                            </td>
                          </>
                        )}

                        {/* What matters is whether the daemon covers the directory
                            ARK writes to, not just that it runs. */}
                        <td>
                          {!m.syncthing?.present ? (
                            <span className="u-muted u-text-sm">{t('clusterSync.syncthing.absent')}</span>
                          ) : (
                            <span className="l-cluster">
                              {m.syncthing.covers_cluster_dir ? (
                                <Badge tone="success" icon={CircleCheck}>
                                  {m.syncthing.device_id.split('-')[0] || t('clusterSync.syncthing.present')}
                                </Badge>
                              ) : (
                                <Badge tone="warning" icon={TriangleAlert}>
                                  {t('clusterSync.syncthing.wrongFolder')}
                                </Badge>
                              )}
                              {m.syncthing.device_id && (
                                <CopyButton
                                  value={m.syncthing.device_id}
                                  label={t('clusterSync.syncthing.copyIdFor', { machine: m.machine_name })}
                                />
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Card>
          )
        })
      )}

      {/* The path nesting is the single most common misconfiguration, so it is
          spelled out on the page rather than buried in the docs. */}
      {!firstLoad && clusters.length > 0 && (
        <Alert tone="info" title={t('clusterSync.hintTitle')}>
          {t('clusterSync.hintBody')}
        </Alert>
      )}
    </div>
  )
}
