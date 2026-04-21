/**
 * MachinesPage — Full CRUD for SSH machines + ServerForge import
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { machinesApi, sfApi } from '../services/api'
import StatusBadge from '../components/StatusBadge'
import type { SSHMachine, SSHMachineCreate, SSHTestResult, SFImportPreview } from '../types'

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
  is_active: true,
}

export default function MachinesPage() {
  const { t } = useTranslation()
  const [machines, setMachines] = useState<SSHMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<SSHMachineCreate>({ ...emptyMachine })
  const [saving, setSaving] = useState(false)
  const [testResults, setTestResults] = useState<Record<number, SSHTestResult>>({})
  const [testingId, setTestingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // Import ServerForge
  const [showImport, setShowImport] = useState(false)
  const [sfMachines, setSfMachines] = useState<SFImportPreview[]>([])
  const [sfLoading, setSfLoading] = useState(false)
  const [sfHasToken, setSfHasToken] = useState<boolean | null>(null)
  const [importingId, setImportingId] = useState<number | null>(null)
  const [importForm, setImportForm] = useState<Record<number, { ssh_user: string; ssh_password: string; auth_method: string; ssh_key_path: string }>>({})

  useEffect(() => { loadMachines(); checkSfToken() }, [])
  useEffect(() => { if (success) { const timer = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(timer) } }, [success])

  async function checkSfToken() {
    try {
      const res = await sfApi.getConfig()
      setSfHasToken(res.data.has_token)
    } catch { setSfHasToken(false) }
  }

  async function loadMachines() {
    setLoading(true)
    try { const res = await machinesApi.list(); setMachines(res.data) }
    catch { setError(t('machines.errors.load')) }
    finally { setLoading(false) }
  }

  // ========== Import da ServerForge ==========

  async function handleOpenImport() {
    setShowImport(true)
    setShowForm(false)
    setSfLoading(true)
    setError('')
    try {
      const res = await sfApi.previewImport()
      setSfMachines(res.data.machines)
      // Init form per ogni macchina non importata
      const forms: typeof importForm = {}
      for (const m of res.data.machines) {
        if (!m.already_imported) {
          forms[m.sf_id] = { ssh_user: 'root', ssh_password: '', auth_method: 'key', ssh_key_path: '/home/arkmania/.ssh/id_ed25519' }
        }
      }
      setImportForm(forms)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('machines.errors.load'))
      setShowImport(false)
    } finally {
      setSfLoading(false)
    }
  }

  function handleImportFormChange(sfId: number, field: string, value: string) {
    setImportForm(prev => ({
      ...prev,
      [sfId]: { ...prev[sfId], [field]: value },
    }))
  }

  async function handleImportMachine(sfm: SFImportPreview) {
    const creds = importForm[sfm.sf_id]
    if (!creds?.ssh_user) {
      setError(t('machines.import.errors.userRequired'))
      return
    }
    if (creds.auth_method === 'password' && !creds.ssh_password) {
      setError(t('machines.import.errors.passwordRequired'))
      return
    }

    setImportingId(sfm.sf_id)
    setError('')
    try {
      const name = sfm.hostname || sfm.ip_address || `SF-Machine-${sfm.sf_id}`
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
      setSuccess(t('machines.import.imported', { name }))
      // Refresh list and import status
      await loadMachines()
      setSfMachines(prev => prev.map(m =>
        m.sf_id === sfm.sf_id ? { ...m, already_imported: true } : m
      ))
    } catch (err: any) {
      setError(err.response?.data?.detail || t('machines.import.errors.generic'))
    } finally {
      setImportingId(null)
    }
  }

  // ========== CRUD standard ==========

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? parseInt(value) || 0 : value,
    }))
    if (validationErrors[name]) setValidationErrors(prev => { const n = { ...prev }; delete n[name]; return n })
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = t('validation.required')
    if (!form.hostname.trim()) errors.hostname = t('validation.required')
    if (!form.ssh_user.trim()) errors.ssh_user = t('validation.required')
    if (form.ssh_port < 1 || form.ssh_port > 65535) errors.ssh_port = t('validation.invalidPort')
    if (form.auth_method === 'password' && !editingId && !form.ssh_password) errors.ssh_password = t('validation.passwordRequired')
    if ((form.auth_method === 'key' || form.auth_method === 'key_password') && !form.ssh_key_path) errors.ssh_key_path = t('validation.required')
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleNew() {
    setForm({ ...emptyMachine }); setEditingId(null); setShowForm(true); setShowImport(false)
    setError(''); setValidationErrors({})
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
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
      is_active: machine.is_active,
    })
    setEditingId(machine.id); setShowForm(true); setShowImport(false); setError(''); setValidationErrors({})
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function handleCancel() { setShowForm(false); setEditingId(null); setError(''); setValidationErrors({}) }

  async function handleSave() {
    if (!validate()) return
    setSaving(true); setError('')
    try {
      if (editingId) { await machinesApi.update(editingId, form); setSuccess(t('machines.messages.updated', { name: form.name })) }
      else { await machinesApi.create(form); setSuccess(t('machines.messages.created', { name: form.name })) }
      await loadMachines(); setShowForm(false); setEditingId(null)
    } catch (err: any) { setError(err.response?.data?.detail || t('machines.errors.save')) }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(t('machines.confirmDelete', { name }))) return
    try { await machinesApi.delete(id); setSuccess(t('machines.messages.deleted', { name })); await loadMachines() }
    catch (err: any) { setError(err.response?.data?.detail || t('machines.errors.delete')) }
  }

  async function handleDuplicate(id: number) {
    try { const res = await machinesApi.duplicate(id); setSuccess(t('machines.messages.duplicated', { name: res.data.name })); await loadMachines() }
    catch (err: any) { setError(err.response?.data?.detail || t('machines.errors.save')) }
  }

  async function handleTest(id: number) {
    setTestingId(id)
    try { const res = await machinesApi.test(id); setTestResults(prev => ({ ...prev, [id]: res.data })); await loadMachines() }
    catch (err: any) { setTestResults(prev => ({ ...prev, [id]: { success: false, message: err.message, hostname: '', response_time_ms: null } })) }
    finally { setTestingId(null) }
  }

  function fieldError(name: string) { return validationErrors[name] ? <span className="form-error">{validationErrors[name]}</span> : null }
  function inputClass(name: string) { return `form-input ${validationErrors[name] ? 'form-input-error' : ''}` }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('machines.title')}</h1>
          <p className="page-subtitle">
            {t('machines.subtitle')}
            {machines.length > 0 && <span className="page-subtitle-count"> {t('machines.subtitleCount', { count: machines.length })}</span>}
          </p>
        </div>
        {!showForm && !showImport && (
          <div className="page-header-actions">
            {sfHasToken && (
              <button onClick={handleOpenImport} className="btn btn-secondary">
                &#x26A1; {t('machines.importServerForge')}
              </button>
            )}
            <button onClick={handleNew} className="btn btn-primary">
              + {t('machines.newMachine')}
            </button>
          </div>
        )}
      </div>

      {/* Messaggi */}
      {error && (
        <div className="alert alert-error mb-6">
          <span className="alert-icon">!</span>{error}
          <button onClick={() => setError('')} className="alert-close">&times;</button>
        </div>
      )}
      {success && (
        <div className="alert alert-success mb-6">
          <span className="alert-icon">&#10003;</span>{success}
        </div>
      )}

      {/* ========== ServerForge import panel ========== */}
      {showImport && (
        <div className="card card-form mb-8">
          <div className="card-title-row">
            <h2 className="card-title">
              <span className="card-title-icon">&#x26A1;</span>
              {t('machines.import.title')}
            </h2>
            <button onClick={() => setShowImport(false)} className="btn btn-sm btn-ghost">{t('common.close')}</button>
          </div>
          <p className="card-text mb-6">{t('machines.import.intro')}</p>

          {sfLoading ? (
            <div className="loading-state">{t('machines.import.loading')}</div>
          ) : sfMachines.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <p className="empty-state-text">{t('machines.import.empty')}</p>
            </div>
          ) : (
            <div className="sf-import-list">
              {sfMachines.map(sfm => {
                const creds = importForm[sfm.sf_id]
                return (
                  <div key={sfm.sf_id} className={`sf-import-item ${sfm.already_imported ? 'sf-import-done' : ''}`}>
                    {/* Machine info */}
                    <div className="sf-import-info">
                      <div className="sf-import-main">
                        <span className="sf-import-name">{sfm.hostname || sfm.ip_address}</span>
                        <span className={`sf-status-pill sf-status-${sfm.status}`}>{sfm.status}</span>
                        {sfm.already_imported && <span className="sf-import-tag">{t('machines.import.alreadyImported')}</span>}
                      </div>
                      <div className="sf-import-meta">
                        <span>IP: {sfm.ip_address || t('machines.ipFallback')}</span>
                        <span>SSH: {sfm.ssh_port}</span>
                        <span>OS: {sfm.os}</span>
                        <span>{sfm.location}</span>
                        <span>{sfm.containers_count} containers</span>
                      </div>
                    </div>

                    {/* Credentials form + import button */}
                    {!sfm.already_imported && creds && (
                      <div className="sf-import-creds">
                        <div className="sf-import-creds-row">
                          <div className="sf-import-field">
                            <label className="form-label">{t('machines.import.label.user')}</label>
                            <input type="text" value={creds.ssh_user}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_user', e.target.value)}
                              className="form-input" placeholder="root" />
                          </div>
                          <div className="sf-import-field">
                            <label className="form-label">{t('machines.import.label.auth')}</label>
                            <select value={creds.auth_method}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'auth_method', e.target.value)}
                              className="form-input">
                              <option value="password">{t('machines.auth.password')}</option>
                              <option value="key">{t('machines.auth.key')}</option>
                            </select>
                          </div>
                          {creds.auth_method === 'password' ? (
                            <div className="sf-import-field sf-import-field-wide">
                              <label className="form-label">{t('machines.import.label.password')}</label>
                              <input type="password" value={creds.ssh_password}
                                onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_password', e.target.value)}
                                className="form-input" placeholder={t('machines.import.placeholder.password')} />
                            </div>
                          ) : (
                            <div className="sf-import-field sf-import-field-wide">
                              <label className="form-label">{t('machines.import.label.keyPath')}</label>
                              <input type="text" value={creds.ssh_key_path}
                                onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_key_path', e.target.value)}
                                className="form-input" placeholder={t('machines.import.placeholder.keyPath')} />
                            </div>
                          )}
                          <button
                            onClick={() => handleImportMachine(sfm)}
                            disabled={importingId === sfm.sf_id}
                            className="btn btn-sm sf-btn-import"
                          >
                            {importingId === sfm.sf_id ? '…' : t('machines.import.label.go')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ========== FORM CREAZIONE/MODIFICA ========== */}
      {showForm && (
        <div className="card card-form mb-8" ref={formRef}>
          <h2 className="card-title">
            <span className="card-title-icon">{editingId ? '~' : '+'}</span>
            {editingId ? t('machines.form.editTitle', { name: form.name || '…' }) : t('machines.form.createTitle')}
          </h2>

          <fieldset className="form-fieldset">
            <legend className="form-legend">{t('machines.section.identification')}</legend>
            <div className="form-grid">
              <div className="form-group form-group-3">
                <label className="form-label">{t('machines.field.name')} *</label>
                <input type="text" name="name" value={form.name} onChange={handleChange}
                  className={inputClass('name')} placeholder={t('machines.form.namePlaceholder')} autoFocus />
                <span className="form-hint">{t('machines.form.nameHint')}</span>
                {fieldError('name')}
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t('machines.field.description')}</label>
                <input type="text" name="description" value={form.description} onChange={handleChange}
                  className="form-input" placeholder={t('machines.form.descriptionPlaceholder')} />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t('machines.field.hostname')} *</label>
                <input type="text" name="hostname" value={form.hostname} onChange={handleChange}
                  className={inputClass('hostname')} placeholder={t('machines.form.hostnamePlaceholder')} />
                {fieldError('hostname')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t('machines.field.ip')}</label>
                <input type="text" name="ip_address" value={form.ip_address} onChange={handleChange}
                  className="form-input" placeholder={t('machines.form.ipPlaceholder')} />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label form-label-inline">
                  <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} className="form-checkbox" />
                  {t('machines.field.active')}
                </label>
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t('machines.field.osType')}</label>
                <select name="os_type" value={form.os_type} onChange={handleChange} className="form-input">
                  <option value="linux">{t('machines.os.linux')}</option>
                  <option value="windows">{t('machines.os.windows')}</option>
                </select>
                <span className="form-hint">{t('machines.osHint')}</span>
              </div>
              {form.os_type === 'windows' && (
                <div className="form-group form-group-2">
                  <label className="form-label">{t('machines.field.wslDistro')}</label>
                  <input type="text" name="wsl_distro" value={form.wsl_distro || ''}
                    onChange={handleChange} className="form-input" placeholder="Ubuntu" />
                  <span className="form-hint">
                    {t('machines.wslHint', { cmd: 'wsl -l -q' })}
                  </span>
                </div>
              )}
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">{t('machines.section.sshConnection')}</legend>
            <div className="form-grid">
              <div className="form-group form-group-1">
                <label className="form-label">{t('machines.field.port')}</label>
                <input type="number" name="ssh_port" value={form.ssh_port} onChange={handleChange}
                  className={inputClass('ssh_port')} min={1} max={65535} />
                {fieldError('ssh_port')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t('machines.field.user')} *</label>
                <input type="text" name="ssh_user" value={form.ssh_user} onChange={handleChange}
                  className={inputClass('ssh_user')} placeholder="root" />
                {fieldError('ssh_user')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t('machines.field.auth')}</label>
                <select name="auth_method" value={form.auth_method} onChange={handleChange} className="form-input">
                  <option value="password">{t('machines.auth.password')}</option>
                  <option value="key">{t('machines.auth.key')}</option>
                  <option value="key_password">{t('machines.auth.keyPassword')}</option>
                </select>
              </div>
              <div className="form-group form-group-1" />
              {(form.auth_method === 'password' || form.auth_method === 'key_password') && (
                <div className="form-group form-group-3">
                  <label className="form-label">{form.auth_method === 'password' ? t('machines.field.password') : t('machines.field.passphrase')}{!editingId && ' *'}</label>
                  <input type="password"
                    name={form.auth_method === 'password' ? 'ssh_password' : 'ssh_passphrase'}
                    value={form.auth_method === 'password' ? form.ssh_password : form.ssh_passphrase}
                    onChange={handleChange}
                    className={inputClass(form.auth_method === 'password' ? 'ssh_password' : 'ssh_passphrase')}
                    placeholder={editingId ? t('machines.form.passwordEditPlaceholder') : ''} />
                  {editingId && <span className="form-hint">{t('machines.form.passwordKeepHint')}</span>}
                  {fieldError('ssh_password')}
                </div>
              )}
              {(form.auth_method === 'key' || form.auth_method === 'key_password') && (
                <div className="form-group form-group-3">
                  <label className="form-label">{t('machines.field.keyPath')} *</label>
                  <input type="text" name="ssh_key_path" value={form.ssh_key_path} onChange={handleChange}
                    className={inputClass('ssh_key_path')} placeholder={t('machines.form.keyPathPlaceholder')} />
                  {fieldError('ssh_key_path')}
                </div>
              )}
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">{t('machines.section.arkPaths')}</legend>
            <div className="form-grid">
              <div className="form-group form-group-full">
                <label className="form-label">{t('machines.field.arkRoot')}</label>
                <input type="text" name="ark_root_path" value={form.ark_root_path} onChange={handleChange}
                  className="form-input" placeholder="/opt/ark" />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t('machines.field.arkConfig')}</label>
                <input type="text" name="ark_config_path" value={form.ark_config_path} onChange={handleChange}
                  className="form-input" />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t('machines.field.arkPlugins')}</label>
                <input type="text" name="ark_plugins_path" value={form.ark_plugins_path} onChange={handleChange}
                  className="form-input" />
              </div>
            </div>
          </fieldset>

          <div className="form-actions">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary">
              {saving ? t('machines.form.saving') : editingId ? t('machines.form.update') : t('machines.form.create')}
            </button>
            <button onClick={handleCancel} className="btn btn-ghost">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {/* ========== Machines list ========== */}
      {loading ? (
        <div className="loading-state">{t('machines.loadingList')}</div>
      ) : machines.length === 0 && !showForm && !showImport ? (
        <div className="empty-state">
          <span className="empty-state-icon">&#x29C9;</span>
          <h3 className="empty-state-title">{t('machines.empty.title')}</h3>
          <p className="empty-state-text">{t('machines.empty.text')}</p>
          <div className="card-actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <button onClick={handleNew} className="btn btn-primary">+ {t('machines.newMachine')}</button>
            {sfHasToken && (
              <button onClick={handleOpenImport} className="btn btn-secondary">&#x26A1; {t('machines.importServerForge')}</button>
            )}
          </div>
        </div>
      ) : (
        <div className="machines-list">
          {machines.map((machine) => {
            const isExpanded = expandedId === machine.id
            const osLong = machine.os_type === 'windows'
              ? `${t('machines.os.windows')} (${machine.wsl_distro || 'Ubuntu'})`
              : t('machines.os.linux')
            return (
              <div key={machine.id} className={`machine-card ${!machine.is_active ? 'machine-card-inactive' : ''}`}>
                <div className="machine-card-header" onClick={() => setExpandedId(prev => prev === machine.id ? null : machine.id)} style={{ cursor: 'pointer' }}>
                  <div className="machine-card-info">
                    <h3 className="machine-card-name">
                      {machine.name}
                      <span className="machine-card-tag" title={osLong}>
                        {machine.os_type === 'windows' ? t('machines.tag.windows') : t('machines.tag.linux')}
                      </span>
                      {!machine.is_active && <span className="machine-card-tag">{t('machines.tag.inactive')}</span>}
                    </h3>
                    <p className="machine-card-host">{machine.ssh_user}@{machine.hostname}:{machine.ssh_port}</p>
                    {machine.description && <p className="machine-card-desc">{machine.description}</p>}
                  </div>
                  <div className="machine-card-status">
                    <StatusBadge status={testingId === machine.id ? 'testing' : machine.last_status} size="md" />
                    <span className="machine-card-expand">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="machine-card-body">
                    <div className="machine-card-details">
                      <div className="machine-card-detail"><span className="detail-label">{t('machines.field.osType')}</span>
                        <span className="detail-value">{osLong}</span></div>
                      <div className="machine-card-detail"><span className="detail-label">{t('machines.field.auth')}</span>
                        <span className="detail-value">{machine.auth_method === 'password' ? t('machines.auth.password') : machine.auth_method === 'key' ? t('machines.auth.key') : t('machines.auth.keyPassword')}</span></div>
                      {machine.ip_address && <div className="machine-card-detail"><span className="detail-label">{t('machines.field.ip')}</span><span className="detail-value detail-value-mono">{machine.ip_address}</span></div>}
                      <div className="machine-card-detail"><span className="detail-label">{t('machines.field.arkRoot')}</span><span className="detail-value detail-value-mono">{machine.ark_root_path}</span></div>
                      <div className="machine-card-detail"><span className="detail-label">{t('machines.field.arkConfig')}</span><span className="detail-value detail-value-mono">{machine.ark_config_path}</span></div>
                      <div className="machine-card-detail"><span className="detail-label">{t('machines.field.arkPlugins')}</span><span className="detail-value detail-value-mono">{machine.ark_plugins_path}</span></div>
                      {machine.last_connection && <div className="machine-card-detail"><span className="detail-label">{t('machines.lastConnection')}</span><span className="detail-value">{new Date(machine.last_connection).toLocaleString()}</span></div>}
                    </div>

                    {testResults[machine.id] && (
                      <div className={`alert mt-3 ${testResults[machine.id].success ? 'alert-success' : 'alert-error'}`}>
                        <span className="alert-icon">{testResults[machine.id].success ? '\u2713' : '!'}</span>
                        {testResults[machine.id].message}
                        {testResults[machine.id].response_time_ms && <span className="alert-detail">{testResults[machine.id].response_time_ms}ms</span>}
                      </div>
                    )}

                    <div className="machine-card-actions">
                      <button onClick={() => handleTest(machine.id)} disabled={testingId === machine.id} className="btn btn-sm btn-secondary">
                        {testingId === machine.id ? t('machines.status.testing') : t('machines.action.test')}
                      </button>
                      <button onClick={() => handleEdit(machine)} className="btn btn-sm btn-ghost">{t('common.edit')}</button>
                      <button onClick={() => handleDuplicate(machine.id)} className="btn btn-sm btn-ghost">{t('common.duplicate')}</button>
                      <button onClick={() => handleDelete(machine.id, machine.name)} className="btn btn-sm btn-danger">{t('common.delete')}</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
