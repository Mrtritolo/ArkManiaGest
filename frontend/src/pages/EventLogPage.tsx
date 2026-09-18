/**
 * EventLogPage — Read-only viewer for ARKM_event_log.
 *
 * Every server event (LOGIN, RARE_SPAWN, RARE_DESPAWN, RARE_KILLED,
 * RARE_TAMED, DECAY_SCAN) in a filterable, paginated table, with the
 * aggregate counts doubling as type filters. Purging the log is
 * require_admin and irreversible, so the panel is admin-only and the
 * "delete everything" case asks the admin to type the word out.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkmaniaApi } from '../services/api'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import {
  Eye, Heart, LogIn, RefreshCw, RotateCw, ScrollText, Skull, Sparkles, Timer, Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, PageHeader,
  Pagination, Select, Spinner, StatTile, Table, TableMessageRow, useConfirm, useToast,
} from '../components/ui'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

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

// ── Event type icons ──────────────────────────────────────────────────────────

// Event types are categories, so each one is told apart by its glyph and its
// written label; labels are resolved via `eventLog.types.<EVENT_TYPE>`.
const EVENT_ICONS: Record<string, LucideIcon> = {
  LOGIN: LogIn,
  RARE_SPAWN: Sparkles,
  RARE_DESPAWN: Eye,
  RARE_KILLED: Skull,
  RARE_TAMED: Heart,
  DECAY_SCAN: Timer,
}

const EVENT_TYPES = Object.keys(EVENT_ICONS)

function iconFor(type: string): LucideIcon {
  return EVENT_ICONS[type] || ScrollText
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  currentUser?: AuthUser | null
}

export default function EventLogPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  // Purging the log is irreversible and Depends(require_admin) server side.
  const isAdmin = currentUser?.role === 'admin'
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
  // What the query actually uses: every keystroke used to fire a COUNT(*)
  // plus a LIKE '%q%' scan of the whole log.
  const debouncedSearch = useDebouncedValue(search, 300)
  const [page, setPage] = useState(0)
  // A new query text invalidates the page index. Adjusted during render (not
  // in an effect) so the fetch below runs once, for page 0, instead of firing
  // for the old page first and having its answer thrown away.
  const [pagedSearch, setPagedSearch] = useState(debouncedSearch)
  if (pagedSearch !== debouncedSearch) {
    setPagedSearch(debouncedSearch)
    setPage(0)
  }
  // Only the latest request may write the table: an older, slower response
  // (the one for "Re" while the box says "Rexy") is dropped.
  const eventsReq = useRef(0)

  // Purge
  const [showPurge, setShowPurge] = useState(false)
  const [purgeDays, setPurgeDays] = useState(30)
  const [purgeType, setPurgeType] = useState('')
  const [purging, setPurging] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    const req = ++eventsReq.current
    setLoading(true)
    try {
      const params: Record<string, unknown> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (eventType) params.event_type = eventType
      if (serverKey) params.server_key = serverKey
      if (debouncedSearch) params.search = debouncedSearch
      const res = await arkmaniaApi.getEvents(params)
      if (req !== eventsReq.current) return
      setEvents(res.data.events)
      setTotal(res.data.total)
    } catch (e: unknown) {
      if (req === eventsReq.current) setError(extractError(e, t('eventLog.loadFailed')))
    } finally {
      if (req === eventsReq.current) setLoading(false)
    }
  }, [eventType, serverKey, debouncedSearch, page, t])

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

  function eventLabel(type: string): string {
    return t(`eventLog.types.${type}`, { defaultValue: type })
  }

  async function handlePurge() {
    const typeLabel = purgeType ? eventLabel(purgeType) : t('eventLog.purgeAllTypes')
    const everything = purgeDays === 0
    const ok = await confirm({
      title: everything ? t('eventLog.purgeTitleAll') : t('eventLog.purgeTitleOlder', { days: purgeDays }),
      description: everything
        ? t('eventLog.purgeConfirmAll', { type: typeLabel })
        : t('eventLog.purgeConfirmOlder', { type: typeLabel, days: purgeDays }),
      confirmLabel: t('eventLog.purgeGo'),
      // Deleting the whole log is unbounded and cannot be undone: make the
      // admin write it out. A dated prune keeps the plain confirmation.
      confirmText: everything ? t('eventLog.purgeConfirmWord') : undefined,
      tone: 'danger',
    })
    if (!ok) return
    setPurging(true)
    try {
      const res = await arkmaniaApi.purgeEvents(purgeDays, purgeType || undefined)
      toast.success(t('eventLog.purgeDeleted', { count: res.data.deleted.toLocaleString() }))
      setShowPurge(false)
      loadMeta()
      // Back to page one: the old page index can now lie past the end, and
      // the table would read "no events" while events remain.
      if (page !== 0) setPage(0)
      else loadEvents()
    } catch (e: unknown) {
      setError(extractError(e, t('eventLog.purgeFailed')))
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
  const firstLoad = loading && events.length === 0
  const refreshing = loading && !firstLoad

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="l-page">
      <PageHeader
        title={t('eventLog.title')}
        icon={ScrollText}
        description={t('eventLog.subtitleStats', {
          total: totalEvents.toLocaleString(),
          page: page + 1,
          totalPages: totalPages || 1,
        })}
        actions={
          <>
            {/* aria-expanded alone: the panel only exists while it is open,
                and aria-controls pointing at a missing id costs some AT the
                expander semantics altogether. */}
            {isAdmin && (
              <Button
                icon={Trash2}
                aria-expanded={showPurge}
                onClick={() => setShowPurge(v => !v)}
              >
                {t('eventLog.purge')}
              </Button>
            )}
            <IconButton
              icon={RefreshCw}
              label={t('common.refresh')}
              loading={loading}
              onClick={() => { loadMeta(); loadEvents() }}
            />
          </>
        }
      />

      {error && (
        <Alert
          tone="danger"
          actions={<Button size="sm" icon={RotateCw} onClick={loadEvents}>{t('common.retry')}</Button>}
          onDismiss={() => setError('')}
        >
          {error}
        </Alert>
      )}

      {isAdmin && showPurge && (
        <Card title={t('eventLog.purgeTitle')} icon={Trash2}>
          <div className="l-stack">
            <Alert tone="warning">{t('eventLog.purgeFootnote')}</Alert>
            <div className="l-grid--form">
              <Field label={t('eventLog.purgeKeep')}>
                <Select value={purgeDays} onChange={e => setPurgeDays(Number(e.target.value))}>
                  <option value={7}>{t('eventLog.days.d7')}</option>
                  <option value={14}>{t('eventLog.days.d14')}</option>
                  <option value={30}>{t('eventLog.days.d30')}</option>
                  <option value={60}>{t('eventLog.days.d60')}</option>
                  <option value={90}>{t('eventLog.days.d90')}</option>
                  <option value={180}>{t('eventLog.days.m6')}</option>
                  <option value={365}>{t('eventLog.days.y1')}</option>
                  <option value={0}>{t('eventLog.days.all')}</option>
                </Select>
              </Field>
              <Field label={t('eventLog.purgeType')}>
                <Select value={purgeType} onChange={e => setPurgeType(e.target.value)}>
                  <option value="">{t('eventLog.filter.allTypes')}</option>
                  {EVENT_TYPES.map(k => <option key={k} value={k}>{eventLabel(k)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="l-cluster l-cluster--end">
              <Button variant="ghost" onClick={() => setShowPurge(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                icon={Trash2}
                loading={purging}
                loadingLabel={t('eventLog.purging')}
                onClick={handlePurge}
              >
                {t('eventLog.purgeGo')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {stats.length > 0 && (
        <div className="l-grid--stats">
          {stats.map(s => (
            <StatTile
              key={s.event_type}
              label={eventLabel(s.event_type)}
              value={s.count.toLocaleString()}
              icon={iconFor(s.event_type)}
              pressed={eventType === s.event_type}
              onClick={() => applyFilter(setEventType, eventType === s.event_type ? '' : s.event_type)}
            />
          ))}
        </div>
      )}

      <Card title={t('eventLog.filtersTitle')}>
        <div className="l-grid--form">
          <Field label={t('eventLog.filter.type')}>
            <Select value={eventType} onChange={e => applyFilter(setEventType, e.target.value)}>
              <option value="">{t('eventLog.filter.allTypes')}</option>
              {EVENT_TYPES.map(k => <option key={k} value={k}>{eventLabel(k)}</option>)}
            </Select>
          </Field>
          <Field label={t('eventLog.filter.server')}>
            <Select value={serverKey} onChange={e => applyFilter(setServerKey, e.target.value)}>
              <option value="">{t('eventLog.filter.allServers')}</option>
              {servers.map(s => (
                <option key={s.server_key} value={s.server_key}>{s.display_name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('eventLog.filter.search')}>
            <Input
              type="search"
              placeholder={t('eventLog.filter.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card
        title={t('eventLog.listTitle')}
        flush
        actions={refreshing ? <Spinner /> : undefined}
        footer={
          totalPages > 1 ? (
            <div className="l-cluster l-cluster--between">
              <Pagination
                label={t('eventLog.listTitle')}
                page={page}
                pageCount={totalPages}
                onPageChange={setPage}
              />
              <span className="u-muted u-text-sm">
                {t('eventLog.pagination.resultsCount', { count: total.toLocaleString() })}
              </span>
            </div>
          ) : undefined
        }
      >
        <Table label={t('eventLog.listTitle')} minWidth={960}>
          <thead>
            <tr>
              <th scope="col">{t('eventLog.column.type')}</th>
              <th scope="col">{t('eventLog.column.player')}</th>
              <th scope="col">{t('eventLog.column.server')}</th>
              <th scope="col">{t('eventLog.column.details')}</th>
              <th scope="col">{t('eventLog.column.datetime')}</th>
            </tr>
          </thead>
          <tbody>
            {firstLoad ? (
              <TableMessageRow colSpan={5}><Spinner block label={t('eventLog.loading')} /></TableMessageRow>
            ) : events.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState icon={ScrollText} title={t('eventLog.empty')} />
              </TableMessageRow>
            ) : events.map(ev => (
              <tr key={ev.id}>
                <td>
                  <Badge icon={iconFor(ev.event_type)}>{eventLabel(ev.event_type)}</Badge>
                </td>
                <td className={ev.player_name && ev.eos_id ? 'ui-cell-2' : undefined}>
                  {ev.player_name ? (
                    <>
                      <span>{ev.player_name}</span>
                      {ev.eos_id && <span className="u-mono u-text-sm u-muted">{ev.eos_id.substring(0, 12)}…</span>}
                    </>
                  ) : (
                    <span className="u-muted">—</span>
                  )}
                </td>
                <td>{resolveServer(ev.server_key)}</td>
                <td className="ui-cell-wrap">{ev.details}</td>
                <td className="u-mono u-text-sm u-muted">
                  {ev.event_time ? new Date(ev.event_time).toLocaleString(undefined, {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                  }) : <span className="u-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
