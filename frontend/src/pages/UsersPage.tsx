/**
 * UsersPage.tsx — User account management (admin only).
 *
 * Lists all portal users, allows creating, editing, toggling active status,
 * and deleting accounts.  Only the admin role has access to this page.
 */
import { useState, useEffect } from 'react'
import {
  Users, Plus, Trash2, Shield, Pencil, X, Save,
  UserCheck, UserX, Loader2, AlertCircle, CheckCircle,
} from 'lucide-react'
import { usersApi } from '../services/api'
import type { AuthUser, UserRole } from '../types'

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, { label: string; color: string }> = {
  admin:    { label: 'Admin',    color: '#dc2626' },
  operator: { label: 'Operator', color: '#2563eb' },
  viewer:   { label: 'Viewer',   color: '#6b7280' },
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
    const t = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(t)
  }, [success])

  async function loadUsers(): Promise<void> {
    setLoading(true)
    try {
      const res = await usersApi.list()
      setUsers(res.data)
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Failed to load users',
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
        setSuccess(`User "${editUser.username}" updated`)
      } else {
        if (!form.username || !form.password || !form.display_name) {
          setError('All fields are required')
          setSaving(false)
          return
        }
        await usersApi.create(form)
        setSuccess(`User "${form.username}" created`)
      }
      setShowForm(false)
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Save failed',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: AuthUser): Promise<void> {
    try {
      await usersApi.update(u.id, { active: !u.active })
      setSuccess(`User "${u.username}" ${u.active ? 'disabled' : 'enabled'}`)
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Update failed',
      )
    }
  }

  async function handleDelete(u: AuthUser): Promise<void> {
    if (!confirm(`Delete user "${u.username}"?`)) return
    try {
      await usersApi.delete(u.id)
      setSuccess(`User "${u.username}" deleted`)
      loadUsers()
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Delete failed',
      )
    }
  }

  function formatDate(d: string | null): string {
    if (!d) return 'Never'
    return new Date(d).toLocaleDateString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="pl-page">
      <div className="pl-header">
        <div>
          <h1 className="pl-title"><Users size={24} /> User Management</h1>
          <p className="pl-subtitle">Create and manage portal user accounts</p>
        </div>
        <button onClick={openNew} className="btn btn-primary btn-sm">
          <Plus size={14} /> New User
        </button>
      </div>

      {error   && <div className="alert alert-error"   style={{ marginBottom: '0.5rem' }}><AlertCircle size={14} /> {error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}><CheckCircle size={14} /> {success}</div>}

      {/* Inline form */}
      {showForm && (
        <div className="pl-sync-panel" style={{ marginBottom: '1rem' }}>
          <div className="pl-sync-header">
            <span className="pl-sync-title">
              {editUser ? `Edit: ${editUser.username}` : 'New User'}
            </span>
            <button onClick={() => setShowForm(false)} className="pl-btn-icon" style={{ width: 22, height: 22 }}>
              <X size={12} />
            </button>
          </div>
          <div className="pl-sync-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            {!editUser && (
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  className="form-input" value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="e.g. marco" autoFocus
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                className="form-input" value={form.display_name}
                onChange={e => setForm({ ...form, display_name: e.target.value })}
                placeholder="e.g. Marco Rossi"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                {editUser ? 'New Password (leave blank to keep current)' : 'Password'}
              </label>
              <input
                className="form-input" type="password" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={editUser ? 'Leave blank to keep unchanged' : 'Minimum 6 characters'}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin — Full access</option>
                <option value="operator">Operator — Manage players and servers</option>
                <option value="viewer">Viewer — Read only</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
                {saving ? <Loader2 size={14} className="pl-spin" /> : <Save size={14} />}
                {' '}{editUser ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User table */}
      {loading ? (
        <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> Loading…</div>
      ) : (
        <table className="pl-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Created</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const r = ROLE_LABELS[u.role as UserRole] ?? ROLE_LABELS.viewer
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
                      style={{ background: `${r.color}15`, color: r.color, borderColor: `${r.color}30` }}
                    >
                      <Shield size={9} /> {r.label}
                    </span>
                  </td>
                  <td>
                    {u.active
                      ? <span style={{ color: '#16a34a', fontSize: '0.78rem' }}><UserCheck size={12} /> Active</span>
                      : <span style={{ color: '#dc2626', fontSize: '0.78rem' }}><UserX size={12} /> Disabled</span>
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
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title={u.active ? 'Disable' : 'Enable'}
                      >
                        {u.active ? <UserX size={12} /> : <UserCheck size={12} />}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.4rem', color: '#dc2626' }}
                        title="Delete"
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
