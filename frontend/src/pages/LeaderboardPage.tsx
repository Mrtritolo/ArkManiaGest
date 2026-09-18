/**
 * LeaderboardPage — ArkMania player leaderboard.
 *
 * Two views over the same fetch: the ranking (ARKM_lb_scores, sorted by the
 * chosen column) and the recent event log (ARKM_lb_events). The server-type
 * filter applies to both. Wiping a leaderboard is require_admin and
 * irreversible, so it sits behind a type-to-confirm dialog.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { arkLeaderboardApi } from '../services/api'
import { fmtShortDateTime } from '../utils/format'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import {
  Activity, Bomb, Crosshair, Ghost, Hammer, Heart, Medal, RefreshCw, RotateCw,
  Skull, Swords, Trash2, Trophy, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Alert, Badge, Button, Card, EmptyState, IconButton, Input, PageHeader,
  SegmentedControl, Select, Spinner, StatTile, Table, TableMessageRow, Tabs,
  useConfirm, useToast,
} from '../components/ui'
import styles from './LeaderboardPage.module.css'

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

/**
 * Event types are categories, not statuses, so each one is told apart by its
 * own Lucide glyph and its written label rather than by a status hue.
 */
const EVENT_ICONS: Record<number, LucideIcon> = {
  1: Crosshair, 2: Swords, 3: Skull, 4: Heart, 5: Hammer, 6: Bomb, 7: Ghost,
}
// The backend's event_label is English only; it stays the fallback for
// event types this map does not know.
const EVENT_LABEL_KEYS: Record<number, string> = {
  1: 'killWild', 2: 'killDino', 3: 'killPvp', 4: 'tame', 5: 'craft', 6: 'structDestroyed', 7: 'death',
}

function fmtServer(key: string) {
  return key.split('_')[0]
}

type TabType = 'classifica' | 'eventi'
type ServerScope = '' | 'PvE' | 'PvP'
type EventScope = '' | '1' | '3' | '4' | '5'

interface Props {
  currentUser?: AuthUser | null
}

export default function LeaderboardPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  // DELETE /arkmania/leaderboard/scores is require_admin.
  const isAdmin = currentUser?.role === 'admin'

  const SORT_OPTIONS = [
    { value: 'total_points', label: t('leaderboard.sort.points') },
    { value: 'kills_wild', label: t('leaderboard.sort.killsWild') },
    { value: 'kills_player', label: t('leaderboard.sort.killsPvp') },
    { value: 'tames', label: t('leaderboard.sort.tames') },
    { value: 'crafts', label: t('leaderboard.sort.crafts') },
    { value: 'deaths', label: t('leaderboard.sort.deaths') },
  ]

  const [stats, setStats] = useState<LbStats | null>(null)
  const [scores, setScores] = useState<LbScore[]>([])
  const [events, setEvents] = useState<LbEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('classifica')

  // Filtri
  const [serverType, setServerType] = useState<ServerScope>('')
  const [sortBy, setSortBy] = useState('total_points')
  const [search, setSearch] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState<EventScope>('')

  // Only the latest request may update the page: a slower response for a
  // filter the user already left must not overwrite the current one.
  const loadReq = useRef(0)

  async function loadData() {
    const req = ++loadReq.current
    setLoading(true)
    setError('')
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
          event_type: eventTypeFilter ? Number(eventTypeFilter) : undefined,
          limit: 50,
        }),
      ])
      if (req !== loadReq.current) return
      setStats(statsRes.data)
      setScores(scoresRes.data.scores)
      setEvents(eventsRes.data.events)
    } catch (e: unknown) {
      if (req !== loadReq.current) return
      setError(extractError(e, t('leaderboard.loadFailed')))
    } finally { if (req === loadReq.current) setLoading(false) }
  }

  useEffect(() => { loadData() }, [serverType, sortBy, eventTypeFilter])

  function handleSearch(e: FormEvent) { e.preventDefault(); loadData() }

  // ── Clear leaderboard buttons ───────────────────────────────────
  // Wipes both ARKM_lb_scores AND ARKM_lb_events for the chosen
  // server_type ('PvE' | 'PvP').  No way to omit the type from the UI
  // (use the API directly if you really want to nuke everything) so
  // operators can't accidentally lose the OTHER mode's history.
  const [clearing, setClearing] = useState<'PvE' | 'PvP' | null>(null)

  async function handleClear(type: 'PvE' | 'PvP') {
    const ok = await confirm({
      title: t('leaderboard.clearTitle', { type }),
      description: t('leaderboard.clearConfirm', { type }),
      confirmLabel: t('leaderboard.clearAction', { type }),
      confirmText: type,
      tone: 'danger',
    })
    if (!ok) return
    setClearing(type); setError('')
    try {
      const res = await arkLeaderboardApi.clear(type)
      toast.success(t('leaderboard.clearDone', {
        type,
        scores: res.data.scores_deleted,
        events: res.data.events_deleted,
      }))
      await loadData()
    } catch (err: unknown) {
      setError(extractError(err, t('leaderboard.clearFailed')))
    } finally {
      setClearing(null)
    }
  }

  const firstLoad = loading && scores.length === 0 && events.length === 0
  const refreshing = loading && !firstLoad

  const statTiles = stats ? [
    { label: t('leaderboard.stats.players'), value: stats.total_players, icon: Users },
    { label: t('leaderboard.stats.totalPoints'), value: stats.total_points, icon: Trophy },
    { label: t('leaderboard.stats.killsWild'), value: stats.total_kills_wild, icon: Crosshair },
    { label: t('leaderboard.stats.tames'), value: stats.total_tames, icon: Heart },
    { label: t('leaderboard.stats.crafts'), value: stats.total_crafts, icon: Hammer },
    { label: t('leaderboard.stats.deaths'), value: stats.total_deaths, icon: Skull },
  ] : []

  const scopeOptions: { value: ServerScope; label: string }[] = [
    { value: '', label: t('leaderboard.filter.allServers') },
    { value: 'PvE', label: 'PvE' },
    { value: 'PvP', label: 'PvP' },
  ]

  const eventScopeOptions: { value: EventScope; label: string }[] = [
    { value: '', label: t('leaderboard.events.all') },
    { value: '1', label: t('leaderboard.events.killWild') },
    { value: '3', label: t('leaderboard.events.killPvp') },
    { value: '4', label: t('leaderboard.events.tame') },
    { value: '5', label: t('leaderboard.events.craft') },
  ]

  const rankingCard = (
    <Card
      title={t('leaderboard.tabs.ranking')}
      flush
      actions={
        <>
          {refreshing && <Spinner />}
          <Select
            size="sm"
            aria-label={t('leaderboard.sortByLabel')}
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <form className="l-cluster" onSubmit={handleSearch}>
            <Input
              type="search"
              size="sm"
              aria-label={t('leaderboard.searchPlaceholder')}
              placeholder={t('leaderboard.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Button type="submit" size="sm" variant="primary">{t('leaderboard.searchButton')}</Button>
          </form>
        </>
      }
    >
      <Table label={t('leaderboard.tabs.ranking')} minWidth={980} maxHeight="calc(100vh - 380px)">
        <thead>
          <tr>
            <th scope="col">{t('leaderboard.table.rank')}</th>
            <th scope="col">{t('leaderboard.table.player')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.points')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.killsWild')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.killsPvp')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.tames')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.crafts')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.destroyed')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.deaths')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.table.last')}</th>
          </tr>
        </thead>
        <tbody>
          {firstLoad ? (
            <TableMessageRow colSpan={10}><Spinner block label={t('leaderboard.loading')} /></TableMessageRow>
          ) : scores.length === 0 ? (
            <TableMessageRow colSpan={10}>
              <EmptyState icon={Trophy} title={t('leaderboard.emptyRanking')} />
            </TableMessageRow>
          ) : scores.map(s => (
            <tr key={`${s.eos_id}-${s.server_type}`}>
              <td>
                <span className={styles.rank} data-top={s.rank <= 3 || undefined}>
                  {s.rank === 1 ? <Trophy aria-hidden="true" /> : s.rank <= 3 ? <Medal aria-hidden="true" /> : null}
                  {s.rank}
                </span>
              </td>
              <td className="ui-cell-2">
                <span>{s.player_name}</span>
                <span className={styles.playerMeta}>{s.server_type}</span>
              </td>
              <td className="u-num u-text-end">{s.total_points.toLocaleString(undefined)}</td>
              <td className="u-num u-text-end">{s.kills_wild}</td>
              <td className="u-num u-text-end">{s.kills_player}</td>
              <td className="u-num u-text-end">{s.tames}</td>
              <td className="u-num u-text-end">{s.crafts}</td>
              <td className="u-num u-text-end">{s.structs_destroyed}</td>
              <td className="u-num u-text-end">{s.deaths}</td>
              <td className="u-text-end u-text-sm u-muted">{fmtShortDateTime(s.last_event)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )

  const eventsCard = (
    <Card
      title={t('leaderboard.tabs.events')}
      flush
      actions={
        <>
          {refreshing && <Spinner />}
          <SegmentedControl
            size="sm"
            label={t('leaderboard.events.typeLabel')}
            options={eventScopeOptions}
            value={eventTypeFilter}
            onChange={setEventTypeFilter}
          />
        </>
      }
    >
      <Table label={t('leaderboard.tabs.events')} minWidth={880}>
        <thead>
          <tr>
            <th scope="col">{t('leaderboard.table.player')}</th>
            <th scope="col">{t('leaderboard.events.table.event')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.events.table.points')}</th>
            <th scope="col">{t('leaderboard.events.table.target')}</th>
            <th scope="col">{t('leaderboard.events.table.server')}</th>
            <th scope="col" className="u-text-end">{t('leaderboard.events.table.date')}</th>
          </tr>
        </thead>
        <tbody>
          {firstLoad ? (
            <TableMessageRow colSpan={6}><Spinner block label={t('leaderboard.loading')} /></TableMessageRow>
          ) : events.length === 0 ? (
            <TableMessageRow colSpan={6}>
              <EmptyState icon={Activity} title={t('leaderboard.emptyEvents')} />
            </TableMessageRow>
          ) : events.map(ev => (
            <tr key={ev.id}>
              <td>{ev.player_name}</td>
              <td>
                <Badge icon={EVENT_ICONS[ev.event_type] ?? Activity}>
                  {EVENT_LABEL_KEYS[ev.event_type]
                    ? t(`leaderboard.events.${EVENT_LABEL_KEYS[ev.event_type]}`)
                    : ev.event_label}
                </Badge>
              </td>
              <td className="u-num u-text-end">+{ev.points}</td>
              <td className="ui-cell-wrap">{ev.target_name || <span className="u-muted">—</span>}</td>
              <td>{fmtServer(ev.server_key)}</td>
              <td className="u-text-end u-text-sm u-muted">{fmtShortDateTime(ev.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )

  return (
    <div className="l-page">
      <PageHeader
        title={t('leaderboard.heading')}
        icon={Trophy}
        description={
          <>
            {t('leaderboard.subtitle')}
            {stats && <> {t('leaderboard.subtitleSuffix', { players: stats.total_players, events: stats.total_events })}</>}
          </>
        }
        actions={
          <>
            {isAdmin && (
              <>
                <Button
                  variant="danger"
                  icon={Trash2}
                  loading={clearing === 'PvE'}
                  loadingLabel={t('leaderboard.clearing')}
                  disabled={clearing !== null}
                  title={t('leaderboard.clearPveTitle')}
                  onClick={() => handleClear('PvE')}
                >
                  {t('leaderboard.clearPve')}
                </Button>
                <Button
                  variant="danger"
                  icon={Trash2}
                  loading={clearing === 'PvP'}
                  loadingLabel={t('leaderboard.clearing')}
                  disabled={clearing !== null}
                  title={t('leaderboard.clearPvpTitle')}
                  onClick={() => handleClear('PvP')}
                >
                  {t('leaderboard.clearPvp')}
                </Button>
              </>
            )}
            <IconButton icon={RefreshCw} label={t('common.refresh')} loading={loading} onClick={loadData} />
          </>
        }
      />

      {error && (
        <Alert
          tone="danger"
          actions={<Button size="sm" icon={RotateCw} onClick={loadData}>{t('common.retry')}</Button>}
          onDismiss={() => setError('')}
        >
          {error}
        </Alert>
      )}

      {stats && (
        <div className="l-grid--stats">
          {statTiles.map(s => (
            <StatTile key={s.label} label={s.label} value={s.value.toLocaleString(undefined)} icon={s.icon} loading={loading} />
          ))}
        </div>
      )}

      <SegmentedControl
        label={t('leaderboard.filter.scopeLabel')}
        options={scopeOptions}
        value={serverType}
        onChange={setServerType}
      />

      <Tabs
        label={t('leaderboard.tabsLabel')}
        items={[
          { id: 'classifica', label: t('leaderboard.tabs.ranking'), icon: Trophy },
          { id: 'eventi', label: t('leaderboard.tabs.events'), icon: Activity },
        ]}
        value={activeTab}
        onChange={id => setActiveTab(id as TabType)}
      >
        {activeTab === 'classifica' ? rankingCard : eventsCard}
      </Tabs>
    </div>
  )
}
