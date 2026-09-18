/**
 * BansPage — Cluster-wide ban management from ARKM_bans.
 *
 * List + expandable detail row, three KPI tiles, and a create dialog.
 * Banning and unbanning are require_operator server side; viewers get a
 * read-only page.
 */
import { Fragment, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Ban, Search, Plus, Shield, ChevronRight,
  UserX, CheckCircle, RefreshCw,
} from 'lucide-react'
import { arkBansApi } from '../services/api'
import { fmtCompactDateTime } from '../utils/format'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  Spinner,
  StatTile,
  Table,
  TableMessageRow,
  useConfirm,
  useToast,
} from '../components/ui'
import { usePending } from '../hooks/usePending'

interface BanItem {
  id: number; eos_id: string; player_name: string | null; reason: string
  banned_by: string; ban_time: string; expire_time: string | null
  is_active: boolean; unbanned_by: string | null; unban_time: string | null
}

/** GET /arkmania/bans — untyped in services/api.ts, see cross_file_requests. */
interface BansListResponse {
  bans: BanItem[]
  active_count: number
  total_count: number
}

interface Props {
  currentUser?: AuthUser | null
}

/** Current local time as a datetime-local value (the input has no zone). */
function localNowInput(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export default function BansPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const pending = usePending<number>()
  // Banning and unbanning are require_operator server side.
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'
  const [bans, setBans] = useState<BanItem[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  // First load blanks the table; later loads keep the rows visible and show a
  // spinner in the card header instead.
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Create dialog
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ eos_id: '', player_name: '', reason: '', expire_time: '', permanent: true })
  const [creating, setCreating] = useState(false)
  // Shown inside the dialog: a page-level alert sits behind the scrim.
  const [modalError, setModalError] = useState('')
  const [eosError, setEosError] = useState('')
  const [expireError, setExpireError] = useState('')
  const eosRef = useRef<HTMLInputElement>(null)
  const expireRef = useRef<HTMLInputElement>(null)

  // Expanded detail row
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Two searches submitted in a row, or a search overlapping the showAll
  // effect, can land out of order; only the latest request may touch state.
  const listReqRef = useRef(0)

  async function loadBans() {
    const seq = ++listReqRef.current
    setRefreshing(true)
    try {
      const res = await arkBansApi.list({ active_only: !showAll, search: search || undefined, limit: 200 })
      if (seq !== listReqRef.current) return
      const data = res.data as BansListResponse
      setBans(data.bans)
      setActiveCount(data.active_count)
      // Unfiltered count of every ban on record; the list itself is
      // filtered and capped, so it cannot give the totals.
      setTotalCount(data.total_count ?? null)
      setError('')
    } catch (e) {
      if (seq === listReqRef.current) setError(extractError(e, t('bans.loadFailed')))
    }
    finally { if (seq === listReqRef.current) { setLoading(false); setRefreshing(false) } }
  }

  useEffect(() => { loadBans() }, [showAll])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    loadBans()
  }

  function openCreate() {
    setModalError(''); setEosError(''); setExpireError('')
    setShowModal(true)
  }

  function closeCreate() {
    if (creating) return
    setShowModal(false)
  }

  async function handleUnban(ban: BanItem) {
    const name = ban.player_name || t('bans.confirmUnbanFallback')
    const ok = await confirm({
      title: t('bans.confirmUnbanTitle'),
      description: t('bans.confirmUnban', { name }),
      confirmLabel: t('bans.unbanButton'),
    })
    if (!ok) return
    try {
      await pending.run(ban.id, () => arkBansApi.unban(ban.id))
      toast.success(t('bans.unbanDone', { name }))
      await loadBans()
    } catch (e) { toast.error(extractError(e, t('bans.unbanFailed'))) }
  }

  async function handleCreate() {
    setModalError(''); setEosError(''); setExpireError('')
    if (!form.eos_id.trim()) {
      setEosError(t('bans.modal.eosRequired'))
      eosRef.current?.focus()
      return
    }
    // A temporary ban with no expiry would be stored as permanent
    // (expire_time NULL), and one already expired would do nothing.
    const expire = form.permanent ? null : new Date(form.expire_time)
    if (expire && (isNaN(expire.getTime()) || expire.getTime() <= Date.now())) {
      setExpireError(t('bans.modal.expireInvalid'))
      expireRef.current?.focus()
      return
    }
    setCreating(true)
    try {
      await arkBansApi.create({
        eos_id: form.eos_id.trim(),
        player_name: form.player_name.trim() || undefined,
        reason: form.reason.trim() || t('bans.defaultReason'),
        // The server records the logged-in user as banned_by.  Send the
        // expiry with its zone, like PlayersPage, so the backend moves it
        // onto the database clock.
        expire_time: expire ? expire.toISOString() : undefined,
      })
      toast.success(t('bans.createDone', { name: form.player_name.trim() || form.eos_id.trim() }))
      setShowModal(false)
      setForm({ eos_id: '', player_name: '', reason: '', expire_time: '', permanent: true })
      await loadBans()
    } catch (e) { setModalError(extractError(e, t('bans.createFailed'))) }
    finally { setCreating(false) }
  }

  const totalBans = totalCount ?? bans.length
  const expiredCount = totalCount != null ? totalCount - activeCount : bans.filter(b => !b.is_active).length

  return (
    <div className="l-page">
      <PageHeader
        title={t('bans.heading')}
        icon={Ban}
        description={t('bans.subtitle', { count: activeCount })}
        actions={canOperate
          ? <Button variant="primary" icon={Plus} onClick={openCreate}>{t('bans.newButton')}</Button>
          : undefined}
      />

      {error && (
        <Alert
          tone="danger"
          title={t('bans.loadFailed')}
          onDismiss={() => setError('')}
          actions={<Button size="sm" icon={RefreshCw} onClick={() => loadBans()}>{t('common.retry')}</Button>}
        >
          {error}
        </Alert>
      )}

      <div className="l-grid--stats">
        <StatTile label={t('bans.stats.active')} value={activeCount} icon={UserX} />
        <StatTile label={t('bans.stats.total')} value={totalBans} icon={Shield} />
        <StatTile label={t('bans.stats.unbanned')} value={expiredCount} icon={CheckCircle} />
      </div>

      <Card
        title={t('bans.listTitle')}
        flush
        actions={
          <>
            {refreshing && <Spinner />}
            {!loading && <span className="u-secondary u-text-sm" role="status">{t('bans.shownCount', { count: bans.length })}</span>}
            <SegmentedControl
              size="sm"
              label={t('bans.scopeLabel')}
              options={[
                { value: 'active', label: t('bans.filterActive') },
                { value: 'all', label: t('bans.filterAll') },
              ]}
              value={showAll ? 'all' : 'active'}
              onChange={v => setShowAll(v === 'all')}
            />
            <form className="l-cluster" onSubmit={handleSearchSubmit}>
              <Input
                type="search"
                size="sm"
                aria-label={t('bans.searchLabel')}
                placeholder={t('bans.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Button type="submit" size="sm" icon={Search}>{t('bans.searchButton')}</Button>
            </form>
          </>
        }
      >
        <Table label={t('bans.listTitle')} minWidth={880}>
          <thead>
            <tr>
              <th scope="col">{t('bans.table.player')}</th>
              <th scope="col">{t('bans.table.reason')}</th>
              <th scope="col">{t('bans.table.bannedBy')}</th>
              <th scope="col">{t('bans.table.date')}</th>
              <th scope="col">{t('bans.table.expires')}</th>
              <th scope="col" className="u-text-end">{t('bans.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={6}>
                <Spinner block label={t('bans.loading')} />
              </TableMessageRow>
            ) : bans.length === 0 ? (
              <TableMessageRow colSpan={6}>
                <EmptyState
                  icon={Shield}
                  title={t('bans.emptyTitle')}
                  description={search ? t('bans.emptyNoResults') : showAll ? t('bans.emptyNoneAll') : t('bans.emptyNoneActive')}
                />
              </TableMessageRow>
            ) : bans.map(ban => {
              const name = ban.player_name || t('bans.unknownPlayer')
              const expanded = expandedId === ban.id
              return (
                <Fragment key={ban.id}>
                <tr>
                  <td>
                    <div className="ui-cell-2">
                      <span>
                        {name}{' '}
                        {ban.is_active
                          ? <Badge tone="danger" icon={Ban}>{t('bans.activeBadge')}</Badge>
                          : <Badge tone="success" icon={CheckCircle}>{t('bans.unbannedBadge')}</Badge>}
                      </span>
                      <span className="u-mono">{ban.eos_id}</span>
                    </div>
                  </td>
                  <td className="ui-cell-wrap">{ban.reason}</td>
                  <td>{ban.banned_by}</td>
                  <td className="u-num">{fmtCompactDateTime(ban.ban_time)}</td>
                  <td className="u-num">
                    {ban.expire_time
                      ? <Badge tone="warning">{fmtCompactDateTime(ban.expire_time)}</Badge>
                      : <Badge tone="danger">{t('bans.permanent')}</Badge>}
                  </td>
                  <td>
                    <div className="ui-row-actions">
                      {ban.is_active && canOperate && (
                        <IconButton
                          size="sm"
                          icon={CheckCircle}
                          label={t('bans.unbanName', { name })}
                          loading={pending.isPending(ban.id)}
                          onClick={() => handleUnban(ban)}
                        />
                      )}
                      <CopyButton value={ban.eos_id} label={t('bans.copyEosTooltip')} />
                      <IconButton
                        size="sm"
                        icon={ChevronRight}
                        label={t('bans.detailsFor', { name })}
                        aria-expanded={expanded}
                        aria-controls={`ban-detail-${ban.id}`}
                        onClick={() => setExpandedId(expanded ? null : ban.id)}
                      />
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr id={`ban-detail-${ban.id}`}>
                    <td colSpan={6}>
                      <dl className="ui-dl">
                        <dt>{t('bans.detail.eosId')}</dt>
                        <dd className="u-mono u-wrap-anywhere">{ban.eos_id}</dd>
                        <dt>{t('bans.detail.fullReason')}</dt>
                        <dd>{ban.reason}</dd>
                        <dt>{t('bans.detail.bannedAt')}</dt>
                        <dd>{fmtCompactDateTime(ban.ban_time)}</dd>
                        {ban.expire_time && (<>
                          <dt>{t('bans.detail.expires')}</dt>
                          <dd>{fmtCompactDateTime(ban.expire_time)}</dd>
                        </>)}
                        {!ban.is_active && ban.unbanned_by && (<>
                          <dt>{t('bans.detail.unbannedBy')}</dt>
                          <dd>{ban.unbanned_by}</dd>
                          <dt>{t('bans.detail.unbannedAt')}</dt>
                          <dd>{fmtCompactDateTime(ban.unban_time)}</dd>
                        </>)}
                      </dl>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={showModal && canOperate}
        onClose={closeCreate}
        title={t('bans.modal.title')}
        size="md"
        dismissible={!creating}
        initialFocusRef={eosRef}
        onSubmit={handleCreate}
        footer={
          <>
            <Button onClick={closeCreate} disabled={creating}>{t('bans.modal.cancel')}</Button>
            <Button type="submit" variant="danger" icon={Ban} loading={creating} loadingLabel={t('bans.modal.submitting')}>
              {t('bans.modal.submit')}
            </Button>
          </>
        }
      >
        <div className="l-stack">
          {modalError && <Alert tone="danger">{modalError}</Alert>}
          <Field label={t('bans.modal.eosLabel')} required error={eosError || undefined}>
            <Input
              ref={eosRef}
              mono
              placeholder={t('bans.modal.eosPlaceholder')}
              value={form.eos_id}
              onChange={e => setForm({ ...form, eos_id: e.target.value })}
            />
          </Field>
          <Field label={t('bans.modal.nameLabel')}>
            <Input
              placeholder={t('bans.modal.namePlaceholder')}
              value={form.player_name}
              onChange={e => setForm({ ...form, player_name: e.target.value })}
            />
          </Field>
          <Field label={t('bans.modal.reasonLabel')}>
            <Input
              placeholder={t('bans.modal.reasonPlaceholder')}
              value={form.reason}
              onChange={e => setForm({ ...form, reason: e.target.value })}
            />
          </Field>
          <SegmentedControl
            label={t('bans.modal.durationLabel')}
            options={[
              { value: 'permanent', label: t('bans.modal.permanent') },
              { value: 'temporary', label: t('bans.modal.temporary') },
            ]}
            value={form.permanent ? 'permanent' : 'temporary'}
            onChange={v => setForm({ ...form, permanent: v === 'permanent' })}
          />
          {!form.permanent && (
            <Field label={t('bans.modal.expireLabel')} required error={expireError || undefined}>
              <Input
                ref={expireRef}
                type="datetime-local"
                min={localNowInput()}
                value={form.expire_time}
                onChange={e => setForm({ ...form, expire_time: e.target.value })}
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  )
}
