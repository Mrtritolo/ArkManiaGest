/**
 * MachinesPage -- full CRUD for the SSH machines, plus the ServerForge import.
 *
 * Every write here (create, edit, duplicate, delete, test, import) is
 * admin-only in machines.py / serverforge.py; every other role reads.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus, Server, Zap } from 'lucide-react'

import { machinesApi, sfApi } from '../services/api'
import { extractError } from '../utils/errors'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  useConfirm,
  useToast,
  type RuntimeStatus,
} from '../components/ui'
import type { AuthUser, SSHMachine, SSHMachineCreate, SSHTestResult, SFImportPreview } from '../types'
import styles from './MachinesPage.module.css'

const emptyMachine: SSHMachineCreate = {
  name: '',
  description: '',
  hostname: '',
  ip_address: '',
  ssh_port: 22,
  ssh_user: 'root',
  auth_method: 'key',
  ssh_password: '',
  ssh_key_path: '/home/arkmania/.ssh/id_ed25519',
  ssh_passphrase: '',
  ark_root_path: '/opt/ark',
  ark_config_path: '/opt/ark/ShooterGame/Saved/Config/LinuxServer',
  ark_plugins_path: '/opt/ark/ShooterGame/Binaries/Linux/Plugins',
  os_type: 'linux',
  wsl_distro: 'Ubuntu',
  runtime: 'pok',
  cluster_dir: '',
  cluster_sync_mode: 'none',
  is_active: true,
}

/** last_status is a free-form string from the backend; map it to the kit. */
const RUNTIME_STATUS: Record<string, RuntimeStatus> = {
  online: 'online',
  offline: 'offline',
  error: 'error',
  testing: 'testing',
  unknown: 'unknown',
}
const toRuntimeStatus = (value: string): RuntimeStatus => RUNTIME_STATUS[value] ?? 'unknown'

type ImportCreds = { ssh_user: string; ssh_password: string; auth_method: string; ssh_key_path: string }

interface Props {
  currentUser?: AuthUser | null
}

export default function MachinesPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = currentUser?.role === 'admin'

  const [machines, setMachines] = useState<SSHMachine[]>([])
  const [loading, setLoading] = useState(true)
  // null = loaded; a string (possibly empty) = the last load failed.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<SSHMachineCreate>({ ...emptyMachine })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [testResults, setTestResults] = useState<Record<number, SSHTestResult>>({})
  const [testingId, setTestingId] = useState<number | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({})

  // Import from ServerForge (admin only: POST /sf/machines/import is require_admin)
  const [showImport, setShowImport] = useState(false)
  const [sfMachines, setSfMachines] = useState<SFImportPreview[]>([])
  const [sfLoading, setSfLoading] = useState(false)
  const [sfError, setSfError] = useState('')
  const [sfHasToken, setSfHasToken] = useState<boolean | null>(null)
  const [importingId, setImportingId] = useState<number | null>(null)
  const [importForm, setImportForm] = useState<Record<number, ImportCreds>>({})

  useEffect(() => { loadMachines(); checkSfToken() }, [])

  async function checkSfToken() {
    try {
      const res = await sfApi.getConfig()
      setSfHasToken(res.data.has_token)
    } catch { setSfHasToken(false) }
  }

  async function loadMachines() {
    setLoading(true)
    try {
      const res = await machinesApi.list()
      setMachines(res.data)
      setLoadError(null)
    } catch (err) {
      setLoadError(extractError(err, ''))
    } finally {
      setLoading(false)
    }
  }

  // ========== Import from ServerForge ==========

  async function handleOpenImport() {
    setShowImport(true)
    setShowForm(false)
    setSfLoading(true)
    setSfError('')
    try {
      const res = await sfApi.previewImport()
      setSfMachines(res.data.machines)
      const forms: Record<number, ImportCreds> = {}
      for (const m of res.data.machines) {
        if (!m.already_imported) {
          forms[m.sf_id] = { ssh_user: 'root', ssh_password: '', auth_method: 'key', ssh_key_path: '/home/arkmania/.ssh/id_ed25519' }
        }
      }
      setImportForm(forms)
    } catch (err) {
      setSfError(extractError(err, t('machines.errors.load')))
    } finally {
      setSfLoading(false)
    }
  }

  function handleImportFormChange(sfId: number, field: keyof ImportCreds, value: string) {
    setImportForm(prev => ({ ...prev, [sfId]: { ...prev[sfId], [field]: value } }))
  }

  async function handleImportMachine(sfm: SFImportPreview) {
    const creds = importForm[sfm.sf_id]
    if (!creds?.ssh_user) {
      setSfError(t('machines.import.errors.userRequired'))
      return
    }
    if (creds.auth_method === 'password' && !creds.ssh_password) {
      setSfError(t('machines.import.errors.passwordRequired'))
      return
    }

    setImportingId(sfm.sf_id)
    setSfError('')
    try {
      const name = sfm.hostname || sfm.ip_address || t('machines.import.fallbackName', { id: sfm.sf_id })
      await sfApi.importMachine({
        sf_machine_id: sfm.sf_id,
        name,
        hostname: sfm.hostname || sfm.ip_address,
        ip_address: sfm.ip_address || undefined,
        ssh_port: sfm.ssh_port,
        ssh_user: creds.ssh_user,
        auth_method: creds.auth_method,
        ssh_password: creds.auth_method === 'password' ? creds.ssh_password : undefined,
        ssh_key_path: creds.auth_method !== 'password' ? creds.ssh_key_path : undefined,
        ark_root_path: '/opt/ark',
        ark_config_path: '/opt/ark/ShooterGame/Saved/Config/LinuxServer',
        ark_plugins_path: '/opt/ark/ShooterGame/Binaries/Linux/Plugins',
      })
      toast.success(t('machines.import.imported', { name }))
      await loadMachines()
      setSfMachines(prev => prev.map(m => (m.sf_id === sfm.sf_id ? { ...m, already_imported: true } : m)))
    } catch (err) {
      setSfError(extractError(err, t('machines.import.errors.generic')))
    } finally {
      setImportingId(null)
    }
  }

  // ========== CRUD ==========

  function setField<K extends keyof SSHMachineCreate>(key: K, value: SSHMachineCreate[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (validationErrors[key as string]) {
      setValidationErrors(prev => { const next = { ...prev }; delete next[key as string]; return next })
    }
  }

  function validate(): string | null {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = t('validation.required')
    if (!form.hostname.trim()) errors.hostname = t('validation.required')
    if (!form.ssh_user.trim()) errors.ssh_user = t('validation.required')
    if (form.ssh_port < 1 || form.ssh_port > 65535) errors.ssh_port = t('validation.invalidPort')
    if (form.auth_method === 'password' && !editingId && !form.ssh_password) errors.ssh_password = t('validation.passwordRequired')
    if ((form.auth_method === 'key' || form.auth_method === 'key_password') && !form.ssh_key_path) errors.ssh_key_path = t('validation.required')
    setValidationErrors(errors)
    // Order matters: the first invalid control takes focus after a failed save.
    const order = ['name', 'hostname', 'ssh_port', 'ssh_user', 'ssh_password', 'ssh_key_path']
    return order.find(key => errors[key]) ?? null
  }

  function revealForm() {
    setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      fieldRefs.current.name?.focus()
    }, 50)
  }

  function handleNew() {
    setForm({ ...emptyMachine }); setEditingId(null); setShowForm(true); setShowImport(false)
    setFormError(''); setValidationErrors({})
    revealForm()
  }

  function handleEdit(machine: SSHMachine) {
    setForm({
      name: machine.name, description: machine.description || '', hostname: machine.hostname,
      ip_address: machine.ip_address || '', ssh_port: machine.ssh_port, ssh_user: machine.ssh_user,
      auth_method: machine.auth_method, ssh_password: '', ssh_key_path: machine.ssh_key_path || '',
      ssh_passphrase: '', ark_root_path: machine.ark_root_path, ark_config_path: machine.ark_config_path,
      ark_plugins_path: machine.ark_plugins_path,
      os_type: machine.os_type || 'linux',
      wsl_distro: machine.wsl_distro || 'Ubuntu',
      runtime: machine.runtime || 'pok',
      cluster_dir: machine.cluster_dir || '',
      cluster_sync_mode: machine.cluster_sync_mode || 'none',
      is_active: machine.is_active,
    })
    setEditingId(machine.id); setShowForm(true); setShowImport(false); setFormError(''); setValidationErrors({})
    revealForm()
  }

  function handleCancel() { setShowForm(false); setEditingId(null); setFormError(''); setValidationErrors({}) }

  async function handleSave() {
    const firstInvalid = validate()
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus()
      return
    }
    setSaving(true); setFormError('')
    // runtime=native only exists on Windows: a runtime picked before switching
    // the OS back to Linux must not be stored (the Hardening page reads it).
    const payload: SSHMachineCreate = form.os_type === 'windows' ? form : { ...form, runtime: 'pok' }
    try {
      if (editingId) {
        await machinesApi.update(editingId, payload)
        toast.success(t('machines.messages.updated', { name: form.name }))
      } else {
        await machinesApi.create(payload)
        toast.success(t('machines.messages.created', { name: form.name }))
      }
      await loadMachines(); setShowForm(false); setEditingId(null)
    } catch (err) {
      setFormError(extractError(err, t('machines.errors.save')))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(machine: SSHMachine) {
    const ok = await confirm({
      title: t('machines.deleteTitle', { name: machine.name }),
      description: t('machines.confirmDelete', { name: machine.name }),
      confirmLabel: t('machines.deleteConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await machinesApi.delete(machine.id)
      toast.success(t('machines.messages.deleted', { name: machine.name }))
      await loadMachines()
    } catch (err) {
      toast.error(extractError(err, t('machines.errors.delete')))
    }
  }

  async function handleDuplicate(id: number) {
    try {
      const res = await machinesApi.duplicate(id)
      toast.success(t('machines.messages.duplicated', { name: res.data.name }))
      await loadMachines()
    } catch (err) {
      toast.error(extractError(err, t('machines.errors.save')))
    }
  }

  async function handleTest(id: number) {
    setTestingId(id)
    try {
      const res = await machinesApi.test(id)
      setTestResults(prev => ({ ...prev, [id]: res.data }))
      await loadMachines()
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, message: extractError(err, t('machines.errors.test')), hostname: '', response_time_ms: null },
      }))
    } finally {
      setTestingId(null)
    }
  }

  const bindField = (key: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    fieldRefs.current[key] = el
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t('machines.title')}
        icon={Server}
        description={
          <>
            {t('machines.subtitle')}
            {machines.length > 0 && <> {t('machines.subtitleCount', { count: machines.length })}</>}
          </>
        }
        actions={
          isAdmin && !showForm && !showImport ? (
            <>
              {sfHasToken && (
                <Button icon={Zap} onClick={handleOpenImport}>{t('machines.importServerForge')}</Button>
              )}
              <Button variant="primary" icon={Plus} onClick={handleNew}>{t('machines.newMachine')}</Button>
            </>
          ) : undefined
        }
      />

      {loadError !== null && (
        <Alert
          tone="danger"
          title={t('machines.errors.load')}
          actions={<Button size="sm" onClick={loadMachines}>{t('common.retry')}</Button>}
        >
          {loadError || undefined}
        </Alert>
      )}

      {/* ===== ServerForge import panel (admin only) ===== */}
      {isAdmin && showImport && (
        <Card
          title={t('machines.import.title')}
          icon={Zap}
          actions={<Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>{t('common.close')}</Button>}
        >
          <div className="l-stack">
            <p className="u-secondary u-text-sm">{t('machines.import.intro')}</p>
            {sfError && <Alert tone="danger" onDismiss={() => setSfError('')}>{sfError}</Alert>}

            {sfLoading ? (
              <Spinner block label={t('machines.import.loading')} />
            ) : sfMachines.length === 0 ? (
              <EmptyState icon={Server} title={t('machines.import.empty')} />
            ) : (
              sfMachines.map(sfm => {
                const creds = importForm[sfm.sf_id]
                const usesPassword = creds?.auth_method === 'password'
                return (
                  <div key={sfm.sf_id} className={styles.importRow}>
                    <div className="l-stack l-stack--sm">
                      <span className="l-cluster">
                        <strong>{sfm.hostname || sfm.ip_address}</strong>
                        <StatusBadge status={toRuntimeStatus(sfm.status)} label={sfm.status} />
                        {sfm.already_imported && <Badge tone="success">{t('machines.import.alreadyImported')}</Badge>}
                      </span>
                      <p className={styles.meta}>
                        <span>{t('machines.import.meta.ip', { value: sfm.ip_address || t('machines.ipFallback') })}</span>
                        <span>{t('machines.import.meta.ssh', { value: sfm.ssh_port })}</span>
                        <span>{t('machines.import.meta.os', { value: sfm.os })}</span>
                        <span>{sfm.location}</span>
                        <span>{t('machines.import.containersCount', { count: sfm.containers_count })}</span>
                      </p>
                    </div>

                    {!sfm.already_imported && creds && (
                      <div className={styles.importCreds}>
                        <Field label={t('machines.import.label.user')}>
                          <Input
                            value={creds.ssh_user}
                            placeholder="root"
                            onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_user', e.target.value)}
                          />
                        </Field>
                        <Field label={t('machines.import.label.auth')}>
                          <Select
                            value={creds.auth_method}
                            onChange={e => handleImportFormChange(sfm.sf_id, 'auth_method', e.target.value)}
                          >
                            <option value="password">{t('machines.auth.password')}</option>
                            <option value="key">{t('machines.auth.key')}</option>
                          </Select>
                        </Field>
                        {usesPassword ? (
                          <Field label={t('machines.import.label.password')}>
                            <Input
                              type="password"
                              revealable
                              autoComplete="new-password"
                              value={creds.ssh_password}
                              placeholder={t('machines.import.placeholder.password')}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_password', e.target.value)}
                            />
                          </Field>
                        ) : (
                          <Field label={t('machines.import.label.keyPath')}>
                            <Input
                              mono
                              value={creds.ssh_key_path}
                              placeholder={t('machines.import.placeholder.keyPath')}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_key_path', e.target.value)}
                            />
                          </Field>
                        )}
                        <Button
                          variant="primary"
                          loading={importingId === sfm.sf_id}
                          loadingLabel={t('machines.form.saving')}
                          onClick={() => handleImportMachine(sfm)}
                        >
                          {t('machines.import.label.go')}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </Card>
      )}

      {/* ===== Create / edit form ===== */}
      {isAdmin && showForm && (
        <div ref={formRef}>
          <Card title={editingId ? t('machines.form.editTitle', { name: form.name || '-' }) : t('machines.form.createTitle')}>
            <form
              className="l-stack"
              noValidate
              onSubmit={e => { e.preventDefault(); handleSave() }}
            >
              {formError && <Alert tone="danger">{formError}</Alert>}

              <fieldset className="ui-fieldset">
                <legend>{t('machines.section.identification')}</legend>
                <div className="l-grid--form">
                  <Field label={t('machines.field.name')} hint={t('machines.form.nameHint')} error={validationErrors.name} required>
                    <Input
                      ref={bindField('name')}
                      value={form.name}
                      placeholder={t('machines.form.namePlaceholder')}
                      onChange={e => setField('name', e.target.value)}
                    />
                  </Field>
                  <Field label={t('machines.field.description')}>
                    <Input
                      value={form.description ?? ''}
                      placeholder={t('machines.form.descriptionPlaceholder')}
                      onChange={e => setField('description', e.target.value)}
                    />
                  </Field>
                  <Field label={t('machines.field.hostname')} error={validationErrors.hostname} required>
                    <Input
                      ref={bindField('hostname')}
                      value={form.hostname}
                      placeholder={t('machines.form.hostnamePlaceholder')}
                      onChange={e => setField('hostname', e.target.value)}
                    />
                  </Field>
                  <Field label={t('machines.field.ip')}>
                    <Input
                      mono
                      value={form.ip_address ?? ''}
                      placeholder={t('machines.form.ipPlaceholder')}
                      onChange={e => setField('ip_address', e.target.value)}
                    />
                  </Field>
                  <Checkbox
                    className="u-span-full"
                    label={t('machines.field.active')}
                    checked={form.is_active}
                    onChange={e => setField('is_active', e.target.checked)}
                  />
                  <Field label={t('machines.field.osType')} hint={t('machines.osHint')}>
                    <Select value={form.os_type} onChange={e => setField('os_type', e.target.value as SSHMachineCreate['os_type'])}>
                      <option value="linux">{t('machines.os.linux')}</option>
                      <option value="windows">{t('machines.os.windows')}</option>
                    </Select>
                  </Field>
                  {form.os_type === 'windows' && (
                    <Field label={t('machines.field.runtime')} hint={t('machines.runtimeHint')}>
                      <Select value={form.runtime} onChange={e => setField('runtime', e.target.value as SSHMachineCreate['runtime'])}>
                        <option value="pok">{t('machines.runtime.pok')}</option>
                        <option value="native">{t('machines.runtime.native')}</option>
                      </Select>
                    </Field>
                  )}
                  {form.os_type === 'windows' && form.runtime === 'pok' && (
                    <Field label={t('machines.field.wslDistro')} hint={t('machines.wslHint', { cmd: 'wsl -l -q' })}>
                      <Input
                        value={form.wsl_distro || ''}
                        placeholder="Ubuntu"
                        onChange={e => setField('wsl_distro', e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label={t('machines.field.clusterDir')} hint={t('machines.clusterDirHint')}>
                    <Input
                      mono
                      value={form.cluster_dir || ''}
                      placeholder={form.os_type === 'windows' && form.runtime === 'native' ? 'C:\\ArkMania\\Cluster' : '/gameadmin'}
                      onChange={e => setField('cluster_dir', e.target.value)}
                    />
                  </Field>
                  <Field label={t('machines.field.clusterSyncMode')} hint={t('machines.clusterSyncHint')}>
                    <Select
                      value={form.cluster_sync_mode}
                      onChange={e => setField('cluster_sync_mode', e.target.value as SSHMachineCreate['cluster_sync_mode'])}
                    >
                      <option value="none">{t('machines.clusterSync.none')}</option>
                      <option value="syncthing">{t('machines.clusterSync.syncthing')}</option>
                      <option value="smb">{t('machines.clusterSync.smb')}</option>
                    </Select>
                  </Field>
                </div>
              </fieldset>

              <fieldset className="ui-fieldset">
                <legend>{t('machines.section.sshConnection')}</legend>
                <div className="l-grid--form">
                  <Field label={t('machines.field.port')} error={validationErrors.ssh_port}>
                    <Input
                      ref={bindField('ssh_port')}
                      type="number"
                      min={1}
                      max={65535}
                      value={form.ssh_port}
                      onChange={e => setField('ssh_port', parseInt(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label={t('machines.field.user')} error={validationErrors.ssh_user} required>
                    <Input
                      ref={bindField('ssh_user')}
                      value={form.ssh_user}
                      placeholder="root"
                      onChange={e => setField('ssh_user', e.target.value)}
                    />
                  </Field>
                  <Field label={t('machines.field.auth')}>
                    <Select value={form.auth_method} onChange={e => setField('auth_method', e.target.value as SSHMachineCreate['auth_method'])}>
                      <option value="password">{t('machines.auth.password')}</option>
                      <option value="key">{t('machines.auth.key')}</option>
                      <option value="key_password">{t('machines.auth.keyPassword')}</option>
                    </Select>
                  </Field>
                  {(form.auth_method === 'password' || form.auth_method === 'key_password') && (
                    <Field
                      label={form.auth_method === 'password' ? t('machines.field.password') : t('machines.field.passphrase')}
                      hint={editingId ? t('machines.form.passwordKeepHint') : undefined}
                      error={validationErrors.ssh_password}
                      required={!editingId}
                      className="u-span-full"
                    >
                      <Input
                        ref={bindField('ssh_password')}
                        type="password"
                        revealable
                        autoComplete="new-password"
                        value={form.auth_method === 'password' ? form.ssh_password ?? '' : form.ssh_passphrase ?? ''}
                        placeholder={editingId ? t('machines.form.passwordEditPlaceholder') : ''}
                        onChange={e =>
                          form.auth_method === 'password'
                            ? setField('ssh_password', e.target.value)
                            : setField('ssh_passphrase', e.target.value)
                        }
                      />
                    </Field>
                  )}
                  {(form.auth_method === 'key' || form.auth_method === 'key_password') && (
                    <Field label={t('machines.field.keyPath')} error={validationErrors.ssh_key_path} required className="u-span-full">
                      <Input
                        ref={bindField('ssh_key_path')}
                        mono
                        value={form.ssh_key_path ?? ''}
                        placeholder={t('machines.form.keyPathPlaceholder')}
                        onChange={e => setField('ssh_key_path', e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </fieldset>

              <fieldset className="ui-fieldset">
                <legend>{t('machines.section.arkPaths')}</legend>
                <div className="l-grid--form">
                  <Field label={t('machines.field.arkRoot')} className="u-span-full">
                    <Input mono value={form.ark_root_path} placeholder="/opt/ark" onChange={e => setField('ark_root_path', e.target.value)} />
                  </Field>
                  <Field label={t('machines.field.arkConfig')} className="u-span-full">
                    <Input mono value={form.ark_config_path} onChange={e => setField('ark_config_path', e.target.value)} />
                  </Field>
                  <Field label={t('machines.field.arkPlugins')} className="u-span-full">
                    <Input mono value={form.ark_plugins_path} onChange={e => setField('ark_plugins_path', e.target.value)} />
                  </Field>
                </div>
              </fieldset>

              <div className="l-cluster">
                <Button type="submit" variant="primary" loading={saving} loadingLabel={t('machines.form.saving')}>
                  {editingId ? t('machines.form.update') : t('machines.form.create')}
                </Button>
                <Button variant="ghost" onClick={handleCancel}>{t('common.cancel')}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* ===== Machines list ===== */}
      {loading ? (
        <Card><Spinner block label={t('machines.loadingList')} /></Card>
      ) : machines.length === 0 && !showForm && !showImport ? (
        <Card>
          <EmptyState
            icon={Server}
            title={t('machines.empty.title')}
            description={t('machines.empty.text')}
            action={isAdmin ? <Button icon={Plus} onClick={handleNew}>{t('machines.newMachine')}</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="l-stack">
          {machines.map(machine => (
            <MachineCard
              key={machine.id}
              machine={machine}
              expanded={expandedId === machine.id}
              onToggle={() => setExpandedId(prev => (prev === machine.id ? null : machine.id))}
              isAdmin={isAdmin}
              testing={testingId === machine.id}
              testResult={testResults[machine.id]}
              onTest={() => handleTest(machine.id)}
              onEdit={() => handleEdit(machine)}
              onDuplicate={() => handleDuplicate(machine.id)}
              onDelete={() => handleDelete(machine)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface MachineCardProps {
  machine: SSHMachine
  expanded: boolean
  onToggle: () => void
  isAdmin: boolean
  testing: boolean
  testResult?: SSHTestResult
  onTest: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function MachineCard({
  machine, expanded, onToggle, isAdmin, testing, testResult,
  onTest, onEdit, onDuplicate, onDelete,
}: MachineCardProps) {
  const { t } = useTranslation()
  const detailsId = `machine-details-${machine.id}`
  const osLong = machine.os_type === 'windows'
    ? (machine.runtime === 'native'
        ? t('machines.os.windowsNative')
        : t('machines.osLong.wsl', { distro: machine.wsl_distro || 'Ubuntu' }))
    : t('machines.os.linux')
  const authLabel = machine.auth_method === 'password'
    ? t('machines.auth.password')
    : machine.auth_method === 'key'
      ? t('machines.auth.key')
      : t('machines.auth.keyPassword')

  return (
    <Card
      titleAs="h3"
      title={
        <span className="l-cluster">
          <span>{machine.name}</span>
          <Badge>{machine.os_type === 'windows' ? t('machines.tag.windows') : t('machines.tag.linux')}</Badge>
          {!machine.is_active && <Badge tone="warning">{t('machines.tag.inactive')}</Badge>}
        </span>
      }
      actions={
        <>
          <StatusBadge status={testing ? 'testing' : toRuntimeStatus(machine.last_status)} />
          <IconButton
            size="sm"
            icon={ChevronDown}
            label={t('machines.toggleDetails', { name: machine.name })}
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            onClick={onToggle}
          />
        </>
      }
    >
      <div className="l-stack l-stack--sm">
        <p className={styles.meta}>
          <span className="u-mono">{machine.ssh_user}@{machine.hostname}:{machine.ssh_port}</span>
        </p>
        {machine.description && <p className="u-muted u-text-sm">{machine.description}</p>}

        {expanded && (
          <div id={detailsId} className="l-stack l-stack--sm">
            <dl className="ui-dl">
              <dt>{t('machines.field.osType')}</dt>
              <dd>{osLong}</dd>
              <dt>{t('machines.field.auth')}</dt>
              <dd>{authLabel}</dd>
              {machine.ip_address && (
                <>
                  <dt>{t('machines.field.ip')}</dt>
                  <dd className="u-mono">{machine.ip_address}</dd>
                </>
              )}
              <dt>{t('machines.field.arkRoot')}</dt>
              <dd className="u-mono u-wrap-anywhere">{machine.ark_root_path}</dd>
              <dt>{t('machines.field.arkConfig')}</dt>
              <dd className="u-mono u-wrap-anywhere">{machine.ark_config_path}</dd>
              <dt>{t('machines.field.arkPlugins')}</dt>
              <dd className="u-mono u-wrap-anywhere">{machine.ark_plugins_path}</dd>
              {machine.last_connection && (
                <>
                  <dt>{t('machines.lastConnection')}</dt>
                  <dd>{new Date(machine.last_connection).toLocaleString()}</dd>
                </>
              )}
            </dl>

            {testResult && (
              <Alert tone={testResult.success ? 'success' : 'danger'}>
                {testResult.message}
                {testResult.response_time_ms !== null && (
                  <> {t('machines.testResponseTime', { ms: testResult.response_time_ms })}</>
                )}
              </Alert>
            )}

            {isAdmin && (
              <div className="l-cluster">
                <Button size="sm" loading={testing} loadingLabel={t('machines.status.testing')} onClick={onTest}>
                  {t('machines.action.test')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onEdit}>{t('common.edit')}</Button>
                <Button size="sm" variant="ghost" onClick={onDuplicate}>{t('common.duplicate')}</Button>
                <Button size="sm" variant="danger" className="u-push" onClick={onDelete}>{t('common.delete')}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
