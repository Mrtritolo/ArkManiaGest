/**
 * OnlinePlayersPage.tsx — Real-time view of connected players.
 *
 * Groups sessions by server, shows per-player duration, map and EOS ID.
 * Filters by server via the stat tiles at the top.
 * Auto-refreshes every 30 seconds while the tab is visible.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, RefreshCw, Globe } from 'lucide-react'
import { arkmaniaApi } from '../services/api'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  NotAvailable,
  PageHeader,
  Spinner,
  StatTile,
  Switch,
  Table,
  TableMessageRow,
} from '../components/ui'

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

function formatDuration(mins: number): string {
  if (mins < 1)  return '<1m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatMapName(map: string): string {
  return map?.replace('_WP', '').replace(/([a-z])([A-Z])/g, '$1 $2') || ''
}

interface Props {
  // Read-only page: nothing to gate.
  currentUser?: AuthUser | null
}

export default function OnlinePlayersPage(_props: Props) {
  const { t } = useTranslation()
  const [players, setPlayers]     = useState<OnlinePlayer[]>([])
  const [servers, setServers]     = useState<ServerStat[]>([])
  const [totalOnline, setTotalOnline]     = useState(0)
  const [serversOnline, setServersOnline] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState('')
  const [filterServer, setFilterServer] = useState<string>('all')
  const [lastUpdate, setLastUpdate]     = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh]   = useState(true)

  const loadData = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      // Always fetch the whole cluster: total_online is counted after the
      // server_key filter, so a filtered fetch made the "All servers" tile
      // show one server's count.  filteredPlayers narrows the list below.
      const res = await arkmaniaApi.getOnlinePlayers()
      setPlayers(res.data.players)
      setServers(res.data.servers)
      setTotalOnline(res.data.total_online)
      setServersOnline(res.data.servers_online)
      setLastUpdate(new Date())
      setError('')
    } catch (err) {
      // A failed poll used to be swallowed, so an unreachable plugin DB read
      // as "the cluster is empty".  Keep the last good rows and say so.
      setError(extractError(err, t('onlinePlayers.loadFailed')))
    }
    finally { setLoading(false); setRefreshing(false) }
  }, [t])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!autoRefresh) return
    // Pause polling while the tab is hidden -- prevents wasted XHRs on
    // long-lived admin sessions and keeps the JWT idle window honest.
    const id = setInterval(() => {
      if (!document.hidden) loadData(true)
    }, 30_000)
    const onVisible = () => { if (!document.hidden) loadData(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [autoRefresh, loadData])

  const filteredPlayers = filterServer === 'all'
    ? players
    : players.filter(p => p.server_key === filterServer)

  return (
    <div className="l-page">
      <PageHeader
        title={t('onlinePlayers.heading')}
        icon={Users}
        description={
          <>
            {t('onlinePlayers.subtitle', { count: totalOnline, servers: serversOnline })}
            {lastUpdate && (
              <span className="u-muted"> · {t('onlinePlayers.updatedLabel')} {lastUpdate.toLocaleTimeString(undefined)}</span>
            )}
          </>
        }
        actions={
          <>
            <Switch
              label={t('onlinePlayers.autoRefreshLabel')}
              checked={autoRefresh}
              onChange={setAutoRefresh}
            />
            <Button
              icon={RefreshCw}
              loading={refreshing}
              loadingLabel={t('onlinePlayers.refreshing')}
              onClick={() => loadData(true)}
            >
              {t('onlinePlayers.refreshButton')}
            </Button>
          </>
        }
      />

      {error && (
        <Alert
          tone="danger"
          title={t('onlinePlayers.loadFailed')}
          actions={<Button size="sm" icon={RefreshCw} onClick={() => loadData(true)}>{t('common.retry')}</Button>}
        >
          {error}
        </Alert>
      )}

      <div className="l-grid--stats">
        <StatTile
          label={t('onlinePlayers.allServersLabel')}
          value={totalOnline}
          icon={Globe}
          meta={t('onlinePlayers.serversOnline', { count: serversOnline })}
          onClick={() => setFilterServer('all')}
          pressed={filterServer === 'all'}
        />
        {servers.filter(s => s.is_online).map(srv => (
          <StatTile
            key={srv.server_key}
            label={srv.display_name}
            value={srv.session_count}
            meta={formatMapName(srv.map_name) || undefined}
            onClick={() => setFilterServer(srv.server_key === filterServer ? 'all' : srv.server_key)}
            pressed={filterServer === srv.server_key}
          />
        ))}
      </div>

      <Card
        title={t('onlinePlayers.listTitle')}
        flush
        actions={refreshing ? <Spinner /> : undefined}
      >
        <Table label={t('onlinePlayers.listTitle')} minWidth={760}>
          <thead>
            <tr>
              <th scope="col">{t('onlinePlayers.table.player')}</th>
              <th scope="col">{t('onlinePlayers.table.server')}</th>
              <th scope="col">{t('onlinePlayers.table.map')}</th>
              <th scope="col" className="u-text-end">{t('onlinePlayers.table.duration')}</th>
              <th scope="col" className="u-text-end">{t('onlinePlayers.table.connectedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={5}>
                <Spinner block label={t('onlinePlayers.loading')} />
              </TableMessageRow>
            ) : filteredPlayers.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState
                  icon={Users}
                  title={t('onlinePlayers.emptyTitle')}
                  description={
                    error
                      ? t('onlinePlayers.emptyAfterError')
                      : filterServer !== 'all'
                        ? t('onlinePlayers.emptyServer')
                        : t('onlinePlayers.emptyCluster')
                  }
                />
              </TableMessageRow>
            ) : filteredPlayers.map(p => (
              <tr key={p.eos_id}>
                <td>
                  <div className="ui-cell-2">
                    <span>{p.player_name || t('onlinePlayers.unknownPlayer')}</span>
                    <span className="u-mono">{p.eos_id}</span>
                  </div>
                </td>
                <td>{p.server_name}</td>
                <td>{formatMapName(p.map_name) || <NotAvailable />}</td>
                <td className="u-text-end u-num u-mono">
                  {p.duration_min == null ? <NotAvailable /> : formatDuration(p.duration_min)}
                </td>
                <td className="u-text-end u-num">
                  {p.login_time
                    ? new Date(p.login_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                    : <NotAvailable />}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
