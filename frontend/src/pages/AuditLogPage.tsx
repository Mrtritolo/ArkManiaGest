/**
 * AuditLogPage - Read-only viewer for the NIS2 security audit trail.
 *
 * Admin only. Displays arkmaniagest_audit_log entries (newest first) in a
 * filterable, paginated table. Entries cannot be edited or deleted from the
 * UI by design (tamper resistance) — rows age out via the retention job.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, RotateCw } from 'lucide-react'
import { auditApi } from '../services/api'
import type { AuditEntry } from '../services/api'
import { extractError } from '../utils/errors'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { AuthUser } from '../types'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  NotAvailable,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  TableMessageRow,
} from '../components/ui'

const PAGE_SIZE = 50

/** dd/MM/yy HH:mm:ss -- the audit trail needs the seconds. */
function fmtAuditTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/** Everything one request depends on: a filter change resets the page. */
interface Query {
  action: string
  username: string
  page: number
}

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only and
  // GET /audit is require_admin server side.
  currentUser?: AuthUser | null
}

export default function AuditLogPage(_props: Props) {
  const { t } = useTranslation()
  const [items, setItems] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // Whether a request has ever settled.  Inferring "first load" from an
  // empty `items` would put the full-width spinner row back every time a
  // filter legitimately returns zero rows; the settled state must stay on
  // screen while a refetch runs.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')

  // Filters.  The inputs feed the query only after a short pause: the
  // backend matches exactly, so every partial keystroke was a COUNT(*) +
  // SELECT that could only return an empty page.
  const [actionInput, setActionInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const action = useDebouncedValue(actionInput)
  const username = useDebouncedValue(usernameInput)
  const [query, setQuery] = useState<Query>({ action: '', username: '', page: 0 })

  // One state object, so a settled filter change moves back to page 1 in the
  // same update and the table fetches once, not twice.
  useEffect(() => {
    setQuery(prev =>
      prev.action === action && prev.username === username
        ? prev
        : { action, username, page: 0 },
    )
  }, [action, username])

  // Only the latest request may update the table, so a slow response for
  // an older filter cannot overwrite the current one.
  const loadReq = useRef(0)

  const load = useCallback(async () => {
    const req = ++loadReq.current
    setLoading(true)
    setError('')
    try {
      const res = await auditApi.list({
        action: query.action || undefined,
        username: query.username || undefined,
        limit: PAGE_SIZE,
        offset: query.page * PAGE_SIZE,
      })
      if (req !== loadReq.current) return
      setItems(res.data.items)
      setTotal(res.data.total)
    } catch (e: unknown) {
      if (req !== loadReq.current) return
      setError(extractError(e, t('auditLog.errors.load')))
    } finally {
      if (req === loadReq.current) {
        setLoading(false)
        setHasLoaded(true)
      }
    }
  }, [query, t])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstLoad = loading && !hasLoaded

  return (
    <div className="l-page">
      <PageHeader
        title={t('auditLog.title')}
        icon={ShieldCheck}
        description={t('auditLog.subtitle', {
          total: total.toLocaleString(),
          page: query.page + 1,
          totalPages,
        })}
        actions={
          <Button
            icon={RotateCw}
            onClick={load}
            loading={loading}
            loadingLabel={t('auditLog.loading')}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {error && (
        <Alert
          tone="danger"
          title={t('auditLog.errors.load')}
          onDismiss={() => setError('')}
          actions={
            <Button size="sm" icon={RotateCw} onClick={load}>
              {t('common.retry')}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card title={t('auditLog.filters')}>
        <div className="l-grid--form">
          <Field label={t('auditLog.filter.action')}>
            <Input
              type="search"
              value={actionInput}
              onChange={e => setActionInput(e.target.value)}
              placeholder={t('auditLog.filter.actionPlaceholder')}
            />
          </Field>
          <Field label={t('auditLog.filter.username')}>
            <Input
              type="search"
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value)}
              placeholder={t('auditLog.filter.usernamePlaceholder')}
            />
          </Field>
        </div>
      </Card>

      <Card
        title={t('auditLog.entries')}
        flush
        actions={loading && !firstLoad ? <Spinner /> : undefined}
        footer={
          totalPages > 1 ? (
            <Pagination
              label={t('auditLog.pagination')}
              page={query.page}
              pageCount={totalPages}
              onPageChange={page => setQuery(prev => ({ ...prev, page }))}
            />
          ) : undefined
        }
      >
        <Table label={t('auditLog.entries')} minWidth={880}>
          <thead>
            <tr>
              <th scope="col">{t('auditLog.column.datetime')}</th>
              <th scope="col">{t('auditLog.column.username')}</th>
              <th scope="col">{t('auditLog.column.action')}</th>
              <th scope="col">{t('auditLog.column.detail')}</th>
              <th scope="col">{t('auditLog.column.ip')}</th>
            </tr>
          </thead>
          <tbody>
            {firstLoad ? (
              <TableMessageRow colSpan={5}>
                <Spinner block label={t('auditLog.loading')} />
              </TableMessageRow>
            ) : items.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState icon={ShieldCheck} title={t('auditLog.empty')} />
              </TableMessageRow>
            ) : items.map(it => (
              <tr key={it.id}>
                <td className="u-mono u-num">
                  {it.created_at ? fmtAuditTime(it.created_at) : <NotAvailable />}
                </td>
                <td>{it.username || <NotAvailable />}</td>
                <td className="u-mono">{it.action}</td>
                {/* The audit trail has no detail view: the full text has to
                    be readable here, so it wraps instead of being clipped. */}
                <td className="ui-cell-wrap">{it.detail || <NotAvailable />}</td>
                <td className="u-mono">{it.ip_address || <NotAvailable />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
