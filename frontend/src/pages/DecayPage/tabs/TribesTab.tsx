/**
 * TribesTab — every tribe the plugin tracks, with its decay countdown.
 *
 * Staging a purge (Clock) is require_operator; the combined "purge now" fires
 * RCON and is require_admin, so the two buttons are gated apart.
 */
import { useTranslation } from 'react-i18next'
import { Clock, Timer, TriangleAlert, Trash2 } from 'lucide-react'
import { fmtShortDateTime } from '../../../utils/format'
import {
  Alert, Badge, Button, Card, EmptyState, IconButton, Input, SegmentedControl,
  Spinner, Table, TableMessageRow,
} from '../../../components/ui'
import type { Pending } from '../../../hooks/usePending'
import { TRIBES_LIMIT, type DecayTribe } from '../decayModel'

type StatusFilter = 'all' | 'expired' | 'expiring' | 'safe'

interface Props {
  tribes: DecayTribe[]
  loading: boolean
  filterStatus: string
  setFilterStatus: (v: string) => void
  search: string
  setSearch: (v: string) => void
  onSearchSubmit: (e: React.FormEvent) => void
  acting: Pending<number>
  running: boolean
  isAdmin: boolean
  canOperate: boolean
  onSchedule: (tribe: DecayTribe) => void
  onPurgeNow: (tribe: DecayTribe) => void
  formatHoursLeft: (h: number) => string
}

export function TribesTab({
  tribes, loading, filterStatus, setFilterStatus, search, setSearch, onSearchSubmit,
  acting, running, isAdmin, canOperate, onSchedule, onPurgeNow, formatHoursLeft,
}: Props) {
  const { t } = useTranslation()

  const filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t('decay.filter.all') },
    { value: 'expired', label: t('decay.filter.expired') },
    { value: 'expiring', label: t('decay.filter.expiring') },
    { value: 'safe', label: t('decay.filter.safe') },
  ]

  const truncated = !loading && tribes.length >= TRIBES_LIMIT
  const busy = acting.anyPending || running

  return (
    <div className="l-stack">
      {/* Above the card, not in it: the card body is flush, so an alert
          inside would sit edge to edge against the table header. */}
      {truncated && (
        <Alert tone="warning">{t('decay.tribes.truncated', { shown: tribes.length })}</Alert>
      )}
      <Card
        title={t('decay.tabs.tribes')}
        flush
        actions={
          <>
            {loading && tribes.length > 0 && <Spinner />}
            <SegmentedControl
              size="sm"
              label={t('decay.filter.label')}
              options={filters}
              value={filterStatus as StatusFilter}
              onChange={setFilterStatus}
            />
            <form className="l-cluster" onSubmit={onSearchSubmit}>
              <Input
                type="search"
                size="sm"
                aria-label={t('decay.searchPlaceholder')}
                placeholder={t('decay.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Button type="submit" size="sm" variant="primary">{t('decay.searchButton')}</Button>
            </form>
          </>
        }
      >
        <Table label={t('decay.tabs.tribes')} minWidth={1040} maxHeight="calc(100vh - 400px)">
          <thead>
            <tr>
              <th scope="col">{t('decay.tribes.table.id')}</th>
              <th scope="col">{t('decay.tribes.table.name')}</th>
              <th scope="col">{t('decay.tribes.table.player')}</th>
              <th scope="col">{t('decay.tribes.table.group')}</th>
              <th scope="col" className="u-text-end">{t('decay.tribes.table.days')}</th>
              <th scope="col">{t('decay.tribes.table.expires')}</th>
              <th scope="col">{t('decay.tribes.table.status')}</th>
              <th scope="col" className="u-text-end">{t('decay.tribes.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && tribes.length === 0 ? (
              <TableMessageRow colSpan={8}><Spinner block label={t('decay.loading')} /></TableMessageRow>
            ) : tribes.length === 0 ? (
              <TableMessageRow colSpan={8}>
                <EmptyState icon={Timer} title={t('decay.emptyTribes')} />
              </TableMessageRow>
            ) : tribes.map(tr => (
              <tr key={tr.targeting_team}>
                <td className="u-mono">{tr.targeting_team}</td>
                <td>{tr.tribe_name || <span className="u-muted">{t('decay.unknownTribe')}</span>}</td>
                <td className={tr.last_refresh_eos ? 'ui-cell-2' : undefined}>
                  <span>{tr.player_name || <span className="u-muted">—</span>}</span>
                  {tr.last_refresh_eos && (
                    <span className="u-mono u-text-sm u-muted">{tr.last_refresh_eos.slice(0, 16)}</span>
                  )}
                </td>
                <td>{tr.last_refresh_group || t('decay.defaultGroup')}</td>
                <td className="u-num u-text-end">{t('decay.tribes.daysValue', { d: tr.last_refresh_days })}</td>
                <td className="u-text-sm u-muted">{fmtShortDateTime(tr.expire_time)}</td>
                <td>
                  {tr.status === 'expired' ? (
                    <Badge tone="danger" icon={TriangleAlert}>{t('decay.status.expired')}</Badge>
                  ) : tr.status === 'expiring' ? (
                    <Badge tone="warning" icon={Clock}>{formatHoursLeft(tr.hours_left)}</Badge>
                  ) : (
                    <Badge tone="success" dot>{t('decay.status.ok')}</Badge>
                  )}
                </td>
                <td>
                  <div className="ui-row-actions">
                    {canOperate && (
                      <IconButton
                        size="sm"
                        icon={Clock}
                        label={t('decay.scheduleTribeTitle', {
                          id: tr.targeting_team,
                          name: tr.tribe_name || t('decay.unknownTribe'),
                        })}
                        loading={acting.isPending(tr.targeting_team)}
                        disabled={busy}
                        onClick={() => onSchedule(tr)}
                      />
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        title={t('decay.purgeTribeTitle', {
                          id: tr.targeting_team,
                          name: tr.tribe_name || t('decay.unknownTribe'),
                        })}
                        loading={acting.isPending(tr.targeting_team)}
                        disabled={busy}
                        onClick={() => onPurgeNow(tr)}
                      >
                        {t('decay.purgeNowButton')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
