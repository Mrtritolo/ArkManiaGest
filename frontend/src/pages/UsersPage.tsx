/**
 * UsersPage.tsx — User account management (admin only).
 *
 * Lists all portal users, allows creating, editing, toggling active status,
 * and deleting accounts.  Only the admin role has access to this page.
 */
import { useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users, Plus, Trash2, Shield, Pencil, RotateCw,
  UserCheck, UserX,
} from 'lucide-react'
import { usersApi } from '../services/api'
import { extractError } from '../utils/errors'
import { fmtDateTime } from '../utils/format'
import { usePending } from '../hooks/usePending'
import type { AuthUser, UserRole } from '../types'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableMessageRow,
  useConfirm,
  useToast,
} from '../components/ui'
import styles from './UsersPage.module.css'

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserForm {
  username:     string
  password:     string
  display_name: string
  role:         string
}

/** Fields that can carry an inline error, in tab order. */
type FormField = 'username' | 'display_name' | 'password'
type FormErrors = Partial<Record<FormField, string>>

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only and
  // every /users endpoint is require_admin server side.
  currentUser?: AuthUser | null
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function UsersPage(_props: Props) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [users, setUsers]     = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Keyed per action, so deleting a row does not spin the toggle button too.
  const rowPending = usePending<string>()

  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<AuthUser | null>(null)
  const [form, setForm]         = useState<UserForm>({
    username: '', password: '', display_name: '', role: 'operator',
  })
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const inputs = useRef<Partial<Record<FormField, HTMLInputElement | null>>>({})

  useEffect(() => { loadUsers() }, [])

  async function loadUsers(): Promise<void> {
    setLoading(true)
    setLoadError('')
    try {
      const res = await usersApi.list()
      setUsers(res.data)
    } catch (err: unknown) {
      setLoadError(extractError(err, t('users.errors.load')))
    } finally {
      setLoading(false)
    }
  }

  function openNew(): void {
    setEditUser(null)
    setForm({ username: '', password: '', display_name: '', role: 'operator' })
    setFormError('')
    setFieldErrors({})
    setShowForm(true)
  }

  function openEdit(u: AuthUser): void {
    setEditUser(u)
    setForm({ username: u.username, password: '', display_name: u.display_name, role: u.role })
    setFormError('')
    setFieldErrors({})
    setShowForm(true)
  }

  function closeForm(): void {
    setShowForm(false)
  }

  /**
   * The backend accepts a blank display name on update (and strips a
   * whitespace-only one to "" on create); an empty one broke the avatar
   * initial here and in the sidebar, so reject it before sending.
   */
  function validate(): FormErrors {
    const errors: FormErrors = {}
    if (!form.display_name.trim()) errors.display_name = t('users.messages.displayNameRequired')
    if (!editUser) {
      if (!form.username.trim()) errors.username = t('users.errors.usernameRequired')
      if (!form.password)        errors.password = t('users.errors.passwordRequired')
    }
    return errors
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    const firstInvalid = (['username', 'display_name', 'password'] as const).find(f => errors[f])
    if (firstInvalid) {
      inputs.current[firstInvalid]?.focus()
      return
    }

    setSaving(true)
    setFormError('')
    const displayName = form.display_name.trim()
    try {
      if (editUser) {
        const updates: Partial<UserForm> = {}
        if (displayName  !== editUser.display_name) updates.display_name = displayName
        if (form.role    !== editUser.role)         updates.role         = form.role
        if (form.password)                          updates.password     = form.password
        await usersApi.update(editUser.id, updates)
        toast.success(t('users.messages.updated', { username: editUser.username }))
      } else {
        await usersApi.create({
          ...form,
          username: form.username.trim(),
          display_name: displayName,
        })
        toast.success(t('users.messages.created', { username: form.username }))
      }
      setShowForm(false)
      loadUsers()
    } catch (err: unknown) {
      // The dialog stays open with the typed values; the reason sits in it.
      setFormError(extractError(err, t('users.errors.save')))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: AuthUser): Promise<void> {
    try {
      await rowPending.run(`toggle:${u.id}`, () => usersApi.update(u.id, { active: !u.active }))
      toast.success(u.active
        ? t('users.messages.disabled', { username: u.username })
        : t('users.messages.enabled',  { username: u.username }))
      loadUsers()
    } catch (err: unknown) {
      toast.error(extractError(err, t('users.errors.update')))
    }
  }

  async function handleDelete(u: AuthUser): Promise<void> {
    const ok = await confirm({
      title: t('users.confirmDelete', { username: u.username }),
      description: t('users.confirmDeleteBody'),
      confirmLabel: t('users.action.deleteUser'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await rowPending.run(`delete:${u.id}`, () => usersApi.delete(u.id))
      toast.success(t('users.messages.deleted', { username: u.username }))
      loadUsers()
    } catch (err: unknown) {
      toast.error(extractError(err, t('users.errors.delete')))
    }
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t('users.title')}
        icon={Users}
        description={t('users.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={openNew}>
            {t('users.new')}
          </Button>
        }
      />

      {loadError && (
        <Alert
          tone="danger"
          title={t('users.errors.load')}
          actions={
            <Button size="sm" icon={RotateCw} onClick={loadUsers}>
              {t('common.retry')}
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      <Card title={t('users.list')} flush>
        <Table label={t('users.list')} minWidth={880}>
          <thead>
            <tr>
              <th scope="col">{t('users.column.user')}</th>
              <th scope="col">{t('users.column.role')}</th>
              <th scope="col">{t('users.column.status')}</th>
              <th scope="col">{t('users.column.lastLogin')}</th>
              <th scope="col">{t('users.column.created')}</th>
              <th scope="col" className="u-text-end">{t('users.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={6}>
                <Spinner block label={t('users.loading')} />
              </TableMessageRow>
            ) : users.length === 0 ? (
              <TableMessageRow colSpan={6}>
                <EmptyState icon={Users} title={t('users.empty')} />
              </TableMessageRow>
            ) : users.map(u => {
              const role = u.role as UserRole
              const name = u.display_name || u.username
              return (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userCell}>
                      <Avatar name={name} size="sm" />
                      <div className="ui-cell-2">
                        <span>{name}</span>
                        <span>@{u.username}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge icon={Shield}>{t(`users.role.${role}`)}</Badge>
                  </td>
                  <td>
                    {u.active
                      ? <Badge tone="success" icon={UserCheck}>{t('users.status.active')}</Badge>
                      : <Badge icon={UserX}>{t('users.status.disabled')}</Badge>}
                  </td>
                  <td className="u-secondary">{fmtDateTime(u.last_login, t('users.lastLoginNever'))}</td>
                  <td className="u-secondary">{fmtDateTime(u.created_at, t('users.lastLoginNever'))}</td>
                  <td>
                    <div className="ui-row-actions">
                      <IconButton
                        size="sm"
                        icon={Pencil}
                        label={t('users.action.editName', { username: u.username })}
                        onClick={() => openEdit(u)}
                      />
                      <IconButton
                        size="sm"
                        icon={u.active ? UserX : UserCheck}
                        label={u.active
                          ? t('users.status.disableName', { username: u.username })
                          : t('users.status.enableName', { username: u.username })}
                        loading={rowPending.isPending(`toggle:${u.id}`)}
                        onClick={() => handleToggleActive(u)}
                      />
                      <IconButton
                        size="sm"
                        icon={Trash2}
                        tone="danger"
                        label={t('users.action.deleteName', { username: u.username })}
                        loading={rowPending.isPending(`delete:${u.id}`)}
                        onClick={() => handleDelete(u)}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={showForm}
        onClose={closeForm}
        size="md"
        title={editUser ? t('users.formEdit', { username: editUser.username }) : t('users.formNew')}
        dismissible={!saving}
        onSubmit={handleSave}
        footer={
          <>
            <Button onClick={closeForm} disabled={saving}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel={t('users.action.saving')}
            >
              {editUser ? t('users.action.save') : t('users.action.create')}
            </Button>
          </>
        }
      >
        <div className="l-stack">
          {formError && <Alert tone="danger">{formError}</Alert>}

          <div className="l-grid--form">
            {!editUser && (
              <Field label={t('users.field.username')} error={fieldErrors.username} required>
                <Input
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder={t('users.placeholder.username')}
                  autoComplete="off"
                  ref={el => { inputs.current.username = el }}
                />
              </Field>
            )}

            <Field label={t('users.field.displayName')} error={fieldErrors.display_name} required>
              <Input
                value={form.display_name}
                onChange={e => setForm({ ...form, display_name: e.target.value })}
                placeholder={t('users.placeholder.displayName')}
                autoComplete="off"
                ref={el => { inputs.current.display_name = el }}
              />
            </Field>

            <Field
              label={editUser ? t('users.field.passwordEdit') : t('users.field.passwordNew')}
              hint={editUser ? t('users.placeholder.passwordEdit') : t('users.placeholder.passwordNew')}
              error={fieldErrors.password}
              required={!editUser}
            >
              <Input
                type="password"
                revealable
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                // Without this a password manager fills the signed-in admin's
                // own password here, and Save sets it on the edited user.
                autoComplete="new-password"
                ref={el => { inputs.current.password = el }}
              />
            </Field>

            <Field label={t('users.field.role')}>
              <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="admin">{t('users.role.adminOption')}</option>
                <option value="operator">{t('users.role.operatorOption')}</option>
                <option value="viewer">{t('users.role.viewerOption')}</option>
              </Select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}
