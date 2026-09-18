/**
 * AuditLogPage - Read-only viewer for the NIS2 security audit trail.
 *
 * Admin only. Displays arkmaniagest_audit_log entries (newest first) in a
 * filterable, paginated table. Entries cannot be edited or deleted from the
 * UI by design (tamper resistance) — rows age out via the retention job.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { auditApi } from '../services/api'
import type { AuditEntry } from '../services/api'
import type { AuthUser } from '../types'
import {
  ShieldCheck, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Search,
} from 'lucide-react'

const PAGE_SIZE = 50

const GRID_COLUMNS = '150px 1fr 1.2fr 2.4fr 130px'

const labelStyle: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)',
  display: 'block', marginBottom: 3,
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
  const [error, setError] = useState('')

  // Filters.  The inputs feed the query only after a short pause: the
  // backend matches exactly, so every partial keystroke was a COUNT(*) +
  // SELECT that could only return an empty page.
  const [actionInput, setActionInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [action, setAction] = useState('')
  const [username, setUsername] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => {
      setAction(actionInput)
      setUsername(usernameInput)
      setPage(0)
    }, 300)
    return () => clearTimeout(id)
  }, [actionInput, usernameInput])

  // Only the latest request may update the table, so a slow response for
  // an older filter cannot overwrite the current one.
  const loadReq = useRef(0)

  const load = useCallback(async () => {
    const req = ++loadReq.current
    setLoading(true)
    setError('')
    try {
      const res = await auditApi.list({
        action: action || undefined,
        username: username || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (req !== loadReq.current) return
      setItems(res.data.items)
      setTotal(res.data.total)
    } catch (e: any) {
      if (req !== loadReq.current) return
      setError(e?.response?.data?.detail || t('auditLog.errors.load'))
    } finally {
      if (req === loadReq.current) setLoading(false)
    }
  }, [action, username, page, t])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><ShieldCheck size={22} /> {t('auditLog.title')}</h1>
          <p className="page-subtitle">
            {t('auditLog.subtitle', { total: total.toLocaleString(), page: page + 1, totalPages })}
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary" style={{ padding: '0.4rem' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '0.6rem 1rem', marginBottom: '0.75rem', display: 'flex', gap: '0.6rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160 }}>
          <label style={labelStyle}>{t('auditLog.filter.action')}</label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder={t('auditLog.filter.actionPlaceholder')}
              value={actionInput} onChange={e => setActionInput(e.target.value)}
              style={{ fontSize: '0.82rem', paddingLeft: 28 }} />
          </div>
        </div>
        <div style={{ minWidth: 160 }}>
          <label style={labelStyle}>{t('auditLog.filter.username')}</label>
          <input className="input" placeholder={t('auditLog.filter.usernamePlaceholder')}
            value={usernameInput} onChange={e => setUsernameInput(e.target.value)}
            style={{ fontSize: '0.82rem' }} />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ minHeight: 200, padding: 0 }}>
        {loading ? (
          <div className="pl-loading" style={{ padding: '3rem' }}>{t('auditLog.loading')}</div>
        ) : items.length === 0 ? (
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <ShieldCheck size={40} style={{ opacity: 0.12 }} />
            <p>{t('auditLog.empty')}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: GRID_COLUMNS,
              padding: '0.5rem 1rem', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-secondary)', background: 'var(--bg-card-muted)',
              borderBottom: '2px solid var(--border)',
            }}>
              <span>{t('auditLog.column.datetime')}</span>
              <span>{t('auditLog.column.username')}</span>
              <span>{t('auditLog.column.action')}</span>
              <span>{t('auditLog.column.detail')}</span>
              <span>{t('auditLog.column.ip')}</span>
            </div>

            {/* Rows */}
            {items.map(it => (
              <div key={it.id} style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLUMNS,
                padding: '0.45rem 1rem', alignItems: 'center',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {it.created_at ? new Date(it.created_at).toLocaleString(undefined, {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  }) : '—'}
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                  {it.username || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>}
                </span>
                <span style={{ fontSize: '0.74rem', fontFamily: 'monospace', color: 'var(--accent)' }}>
                  {it.action}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.detail || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {it.ip_address || '—'}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '0.6rem' }}>
            <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem' }}
              disabled={page === 0 || loading}
              onClick={() => setPage(p => Math.max(0, p - 1))}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {page + 1} / {totalPages}
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem' }}
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
