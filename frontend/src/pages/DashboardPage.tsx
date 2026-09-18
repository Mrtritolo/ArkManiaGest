/**
 * DashboardPage.tsx — Cluster overview.
 *
 * Shows online players, server status, machine health, and database
 * connectivity at a glance.  Auto-refreshes every 30 seconds.
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Database, LayoutDashboard, Monitor, Users, Server, RotateCw } from 'lucide-react'
import { machinesApi, databaseApi, arkmaniaApi } from '../services/api'
import type { AuthUser } from '../types'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  NotAvailable,
  PageHeader,
  Spinner,
  StatTile,
  Table,
  TableMessageRow,
  buttonClass,
} from '../components/ui'
import styles from './DashboardPage.module.css'

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

interface Props {
  currentUser?: AuthUser | null
}

export default function DashboardPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // POST /settings/database/test-current is require_admin: for any other
  // role it can only answer 403, which read as "Database offline".
  const isAdmin = currentUser?.role === 'admin'
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  // null = not an admin, so the status is unknown
  const [dbOk, setDbOk]               = useState<boolean | null>(null)
  const [machineCount, setMachineCount] = useState({ total: 0, active: 0, online: 0 })
  const [players, setPlayers]         = useState<OnlinePlayer[]>([])
  const [servers, setServers]         = useState<ServerStat[]>([])
  const [totalOnline, setTotalOnline] = useState(0)
  const [serversOnline, setServersOnline] = useState(0)
  const [onlineFailed, setOnlineFailed] = useState(false)

  /** '<1m' / '42m' / '3h' / '3h 20m', localised. */
  function formatDuration(mins: number): string {
    if (mins < 1) return t('dashboard.duration.lessThanMinute')
    if (mins < 60) return t('dashboard.duration.minutes', { m: mins })
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0
      ? t('dashboard.duration.hoursMinutes', { h, m })
      : t('dashboard.duration.hours', { h })
  }

  async function loadAll(silent = false): Promise<void> {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [dbRes, countRes, onlineRes] = await Promise.allSettled([
        isAdmin ? databaseApi.testCurrent() : Promise.reject(new Error('admin only')),
        machinesApi.count(),
        arkmaniaApi.getOnlinePlayers(),
      ])
      // For an admin a rejected test is itself "Offline": get_current_user
      // reads the panel DB, so a down DB answers 5xx, not success:false.
      setDbOk(!isAdmin ? null : dbRes.status === 'fulfilled' ? dbRes.value.data.success : false)
      if (countRes.status  === 'fulfilled') setMachineCount(countRes.value.data)
      if (onlineRes.status === 'fulfilled') {
        const d = onlineRes.value.data
        setPlayers(d.players)
        setServers(d.servers)
        setTotalOnline(d.total_online)
        setServersOnline(d.servers_online)
        setOnlineFailed(false)
      } else {
        // Do not keep showing the last good list as if it were current.
        setPlayers([])
        setServers([])
        setTotalOnline(0)
        setServersOnline(0)
        setOnlineFailed(true)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadAll() }, [isAdmin])
  useEffect(() => {
    // Skip the polling tick when the tab is in the background -- a
    // long-lived admin session would otherwise burn hundreds of XHRs
    // an hour, plus reset the JWT idle clock so the session never
    // naturally times out.  We refresh once when the tab becomes
    // visible again so the dashboard isn't stale.
    const id = setInterval(() => {
      if (!document.hidden) loadAll(true)
    }, 30_000)
    const onVisible = () => { if (!document.hidden) loadAll(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isAdmin])

  const dbValue = dbOk === null
    ? <NotAvailable />
    : dbOk ? t('dashboard.stat.dbOk') : t('dashboard.stat.dbOffline')

  return (
    <div className="l-page">
      <PageHeader
        title={t('nav.dashboard')}
        icon={LayoutDashboard}
        description={t('dashboard.subtitle')}
        actions={
          <Button
            icon={RotateCw}
            onClick={() => loadAll(true)}
            loading={refreshing}
            loadingLabel={t('common.loading')}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="l-grid--stats">
        <StatTile
          label={t('dashboard.stat.onlinePlayers')}
          icon={Users}
          value={onlineFailed ? <NotAvailable /> : totalOnline}
          meta={onlineFailed ? t('dashboard.card.loadFailed') : undefined}
          metaTone={onlineFailed ? 'danger' : undefined}
          loading={loading}
          href="/online"
        />
        <StatTile
          label={t('dashboard.stat.serversOnline')}
          icon={Server}
          value={onlineFailed ? <NotAvailable /> : serversOnline}
          unit={onlineFailed ? undefined : `/ ${servers.length}`}
          meta={onlineFailed ? t('dashboard.card.loadFailed') : undefined}
          metaTone={onlineFailed ? 'danger' : undefined}
          loading={loading}
          href="/serverforge"
        />
        <StatTile
          label={t('dashboard.stat.sshMachines')}
          icon={Monitor}
          value={machineCount.online}
          unit={`/ ${machineCount.total}`}
          loading={loading}
          href="/settings/machines"
        />
        <StatTile
          label={t('dashboard.stat.database')}
          icon={Database}
          value={dbValue}
          meta={
            dbOk === null
              ? t('dashboard.stat.dbAdminOnly')
              : dbOk === false ? t('dashboard.stat.dbOfflineHint') : undefined
          }
          metaTone={dbOk === false ? 'danger' : undefined}
          loading={loading}
          // /settings/db is registered for admins only in App.tsx.
          href={isAdmin ? '/settings/db' : undefined}
        />
      </div>

      <Card
        title={t('dashboard.card.onlinePlayers')}
        icon={Users}
        flush
        actions={
          <>
            <span className="ui-count">{totalOnline}</span>
            {refreshing && <Spinner />}
            <Link to="/online" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              {t('common.showAll')}
            </Link>
          </>
        }
      >
        <Table label={t('dashboard.card.onlinePlayers')} minWidth={420} maxHeight="26rem">
          <thead>
            <tr>
              <th scope="col">{t('dashboard.card.colPlayer')}</th>
              <th scope="col">{t('dashboard.card.colServer')}</th>
              <th scope="col" className="u-text-end">{t('dashboard.card.colDuration')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={3}>
                <Spinner block label={t('common.loading')} />
              </TableMessageRow>
            ) : onlineFailed ? (
              <TableMessageRow colSpan={3}>
                <div className={styles.messagePad}>
                  <Alert tone="danger">{t('dashboard.card.loadFailed')}</Alert>
                </div>
              </TableMessageRow>
            ) : players.length === 0 ? (
              <TableMessageRow colSpan={3}>
                <EmptyState icon={Users} title={t('dashboard.card.noPlayers')} />
              </TableMessageRow>
            ) : players.map(p => (
              <tr key={p.eos_id}>
                <td>{p.player_name || t('dashboard.card.unknown')}</td>
                <td><Badge>{p.server_name}</Badge></td>
                <td className="u-text-end u-num u-mono">
                  {p.duration_min == null ? <NotAvailable /> : formatDuration(p.duration_min)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
