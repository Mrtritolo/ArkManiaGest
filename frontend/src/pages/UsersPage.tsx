/**
 * UsersPage.tsx — User account management (admin only).
 *
 * Lists all portal users, allows creating, editing, toggling active status,
 * and deleting accounts.  Only the admin role has access to this page.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users, Plus, Trash2, Shield, Pencil, X, Save,
  UserCheck, UserX, Loader2, AlertCircle, CheckCircle,
} from 'lucide-react'
import { usersApi } from '../services/api'
import type { AuthUser, UserRole } from '../types'

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<UserRole, string> = {
  admin:    '#dc2626',
  operator: '#2563eb',
  viewer:   '#6b7280',
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserForm {
  username:     string
  password:     string
  display_name: string
  role:         string
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { t } = useTranslation()
  const [users, setUsers]     = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<AuthUser | null>(null)
  const [form, setForm]         = useState<UserForm>({
    username: '', password: '', display_name: '', role: 'operator',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadUsers() }, [])

  // Auto-clear success toast
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  async function loadUsers(): Promise<void> {
    setLoading(true)
    try {
      const res = await usersApi.list()
      setUsers(res.data)
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('users.errors.load'),
      )
    } finally {
      setLoading(false)
    }
  }

  function openNew(): void {
    setEditUser(null)
    setForm({ username: '', password: '', display_name: '', role: 'operator' })
    setShowForm(true)
    setError('')
  }

  function openEdit(u: AuthUser): void {
    setEditUser(u)
    setForm({ username: u.username, password: '', display_name: u.display_name, role: u.role })
    setShowForm(true)
    setError('')
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError('')
    try {
      if (editUser) {
        const updates: Partial<UserForm> = {}
        if (form.display_name !== editUser.display_name) updates.display_name = form.display_name
        if (form.role         !== editUser.role)         updates.role         = form.role
        if (form.password)                               updates.password     = form.password
        await usersApi.update(editUser.id, updates)
        setSuccess(t('users.messages.updated', { username: editUser.username }))
      } else {
        if (!form.username || !form.password || !form.display_name) {
          setError(t('users.messages.allRequired'))
          setSaving(false)
          return
        }
        await usersApi.create(form)
        setSuccess(t('users.messages.created', { username: form.username }))
      }
      setShowForm(false)
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('users.errors.save'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: AuthUser): Promise<void> {
    try {
      await usersApi.update(u.id, { active: !u.active })
      setSuccess(u.active
        ? t('users.messages.disabled', { username: u.username })
        : t('users.messages.enabled',  { username: u.username }))
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('users.errors.update'),
      )
    }
  }

  async function handleDelete(u: AuthUser): Promise<void> {
    if (!confirm(t('users.confirmDelete', { username: u.username }))) return
    try {
      await usersApi.delete(u.id)
      setSuccess(t('users.messages.deleted', { username: u.username }))
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('users.errors.delete'),
      )
    }
  }

  function formatDate(d: string | null): string {
    if (!d) return t('users.lastLoginNever')
    return new Date(d).toLocaleDateString(undefined, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="pl-page">
      <div className="pl-header">
        <div>
          <h1 className="pl-title"><Users size={24} /> {t('users.title')}</h1>
          <p className="pl-subtitle">{t('users.subtitle')}</p>
        </div>
        <button onClick={openNew} className="btn btn-primary btn-sm">
          <Plus size={14} /> {t('users.new')}
        </button>
      </div>

      {error   && <div className="alert alert-error"   style={{ marginBottom: '0.5rem' }}><AlertCircle size={14} /> {error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}><CheckCircle size={14} /> {success}</div>}

      {/* Inline form */}
      {showForm && (
        <div className="pl-sync-panel" style={{ marginBottom: '1rem' }}>
          <div className="pl-sync-header">
            <span className="pl-sync-title">
              {editUser ? t('users.formEdit', { username: editUser.username }) : t('users.formNew')}
            </span>
            <button onClick={() => setShowForm(false)} className="pl-btn-icon" style={{ width: 22, height: 22 }}>
              <X size={12} />
            </button>
          </div>
          <div className="pl-sync-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            {!editUser && (
              <div className="form-group">
                <label className="form-label">{t('users.field.username')}</label>
                <input
                  className="form-input" value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder={t('users.placeholder.username')} autoFocus
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{t('users.field.displayName')}</label>
              <input
                className="form-input" value={form.display_name}
                onChange={e => setForm({ ...form, display_name: e.target.value })}
                placeholder={t('users.placeholder.displayName')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                {editUser ? t('users.field.passwordEdit') : t('users.field.passwordNew')}
              </label>
              <input
                className="form-input" type="password" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={editUser ? t('users.placeholder.passwordEdit') : t('users.placeholder.passwordNew')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('users.field.role')}</label>
              <select className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="admin">{t('users.role.adminOption')}</option>
                <option value="operator">{t('users.role.operatorOption')}</option>
                <option value="viewer">{t('users.role.viewerOption')}</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} className="btn btn-secondary btn-sm">{t('common.cancel')}</button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
                {saving ? <Loader2 size={14} className="pl-spin" /> : <Save size={14} />}
                {' '}{editUser ? t('users.action.save') : t('users.action.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User table */}
      {loading ? (
        <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> {t('users.loading')}</div>
      ) : (
        <table className="pl-table">
          <thead>
            <tr>
              <th>{t('users.column.user')}</th>
              <th>{t('users.column.role')}</th>
              <th>{t('users.column.status')}</th>
              <th>{t('users.column.lastLogin')}</th>
              <th>{t('users.column.created')}</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const role = u.role as UserRole
              const color = ROLE_COLORS[role] ?? ROLE_COLORS.viewer
              const roleLabel = t(`users.role.${role}`)
              return (
                <tr key={u.id}>
                  <td>
                    <div className="pl-cell-player">
                      <div
                        className="pl-avatar"
                        style={u.role === 'admin' ? { background: 'linear-gradient(135deg, #dc2626, #f97316)' } : {}}
                      >
                        {u.display_name[0].toUpperCase()}
                      </div>
                      <div>
                        <span className="pl-cell-name">{u.display_name}</span>
                        <span className="pl-cell-tribe" style={{ fontSize: '0.7rem' }}>@{u.username}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className="pl-chip"
                      style={{ background: `${color}15`, color, borderColor: `${color}30` }}
                    >
                      <Shield size={9} /> {roleLabel}
                    </span>
                  </td>
                  <td>
                    {u.active
                      ? <span style={{ color: '#16a34a', fontSize: '0.78rem' }}><UserCheck size={12} /> {t('users.status.active')}</span>
                      : <span style={{ color: '#dc2626', fontSize: '0.78rem' }}><UserX size={12} /> {t('users.status.disabled')}</span>
                    }
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{formatDate(u.last_login)}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{formatDate(u.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => openEdit(u)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title={t('users.action.edit')}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title={u.active ? t('users.status.disable') : t('users.status.enable')}
                      >
                        {u.active ? <UserX size={12} /> : <UserCheck size={12} />}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.4rem', color: '#dc2626' }}
                        title={t('users.action.delete')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
