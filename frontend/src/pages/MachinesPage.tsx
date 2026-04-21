/**
 * MachinesPage — Full CRUD for SSH machines + ServerForge import
 */
import { useState, useEffect, useRef } from 'react'
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
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t) } }, [success])

  async function checkSfToken() {
    try {
      const res = await sfApi.getConfig()
      setSfHasToken(res.data.has_token)
    } catch { setSfHasToken(false) }
  }

  async function loadMachines() {
    setLoading(true)
    try { const res = await machinesApi.list(); setMachines(res.data) }
    catch { setError('Impossibile caricare le macchine') }
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
      setError(err.response?.data?.detail || 'Impossibile caricare macchine da ServerForge')
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
      setError('Inserisci l\'utente SSH per importare')
      return
    }
    if (creds.auth_method === 'password' && !creds.ssh_password) {
      setError('Inserisci la password SSH per importare')
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
      setSuccess(`Macchina "${name}" importata da ServerForge`)
      // Refresh list and import status
      await loadMachines()
      setSfMachines(prev => prev.map(m =>
        m.sf_id === sfm.sf_id ? { ...m, already_imported: true } : m
      ))
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore durante l\'importazione')
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
    if (!form.name.trim()) errors.name = 'Nome obbligatorio'
    if (!form.hostname.trim()) errors.hostname = 'Hostname obbligatorio'
    if (!form.ssh_user.trim()) errors.ssh_user = 'Utente SSH obbligatorio'
    if (form.ssh_port < 1 || form.ssh_port > 65535) errors.ssh_port = 'Porta non valida'
    if (form.auth_method === 'password' && !editingId && !form.ssh_password) errors.ssh_password = 'Password obbligatoria'
    if ((form.auth_method === 'key' || form.auth_method === 'key_password') && !form.ssh_key_path) errors.ssh_key_path = 'Percorso chiave obbligatorio'
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
      if (editingId) { await machinesApi.update(editingId, form); setSuccess(`Macchina "${form.name}" aggiornata`) }
      else { await machinesApi.create(form); setSuccess(`Macchina "${form.name}" creata`) }
      await loadMachines(); setShowForm(false); setEditingId(null)
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore durante il salvataggio') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare la macchina "${name}"?`)) return
    try { await machinesApi.delete(id); setSuccess(`"${name}" eliminata`); await loadMachines() }
    catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
  }

  async function handleDuplicate(id: number) {
    try { const res = await machinesApi.duplicate(id); setSuccess(`Duplicata come "${res.data.name}"`); await loadMachines() }
    catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
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
          <h1 className="page-title">Macchine SSH</h1>
          <p className="page-subtitle">
            Gestisci le macchine remote per connessioni SSH e trasferimento file
            {machines.length > 0 && <span className="page-subtitle-count"> - {machines.length} configurate</span>}
          </p>
        </div>
        {!showForm && !showImport && (
          <div className="page-header-actions">
            {sfHasToken && (
              <button onClick={handleOpenImport} className="btn btn-secondary">
                &#x26A1; Importa da ServerForge
              </button>
            )}
            <button onClick={handleNew} className="btn btn-primary">
              + Nuova Macchina
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

      {/* ========== PANNELLO IMPORT SERVERFORGE ========== */}
      {showImport && (
        <div className="card card-form mb-8">
          <div className="card-title-row">
            <h2 className="card-title">
              <span className="card-title-icon">&#x26A1;</span>
              Importa da ServerForge
            </h2>
            <button onClick={() => setShowImport(false)} className="btn btn-sm btn-ghost">Chiudi</button>
          </div>
          <p className="card-text mb-6">
            Seleziona le macchine da importare. ServerForge non espone le credenziali SSH,
            quindi dovrai inserire utente e password per ogni macchina.
          </p>

          {sfLoading ? (
            <div className="loading-state">Caricamento macchine da ServerForge...</div>
          ) : sfMachines.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <p className="empty-state-text">Nessuna macchina trovata su ServerForge</p>
            </div>
          ) : (
            <div className="sf-import-list">
              {sfMachines.map(sfm => {
                const creds = importForm[sfm.sf_id]
                return (
                  <div key={sfm.sf_id} className={`sf-import-item ${sfm.already_imported ? 'sf-import-done' : ''}`}>
                    {/* Info macchina */}
                    <div className="sf-import-info">
                      <div className="sf-import-main">
                        <span className="sf-import-name">{sfm.hostname || sfm.ip_address}</span>
                        <span className={`sf-status-pill sf-status-${sfm.status}`}>{sfm.status}</span>
                        {sfm.already_imported && <span className="sf-import-tag">Gia' importata</span>}
                      </div>
                      <div className="sf-import-meta">
                        <span>IP: {sfm.ip_address || 'N/D'}</span>
                        <span>SSH: {sfm.ssh_port}</span>
                        <span>OS: {sfm.os}</span>
                        <span>{sfm.location}</span>
                        <span>{sfm.containers_count} containers</span>
                      </div>
                    </div>

                    {/* Form credenziali + pulsante import */}
                    {!sfm.already_imported && creds && (
                      <div className="sf-import-creds">
                        <div className="sf-import-creds-row">
                          <div className="sf-import-field">
                            <label className="form-label">Utente SSH</label>
                            <input type="text" value={creds.ssh_user}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_user', e.target.value)}
                              className="form-input" placeholder="root" />
                          </div>
                          <div className="sf-import-field">
                            <label className="form-label">Auth</label>
                            <select value={creds.auth_method}
                              onChange={e => handleImportFormChange(sfm.sf_id, 'auth_method', e.target.value)}
                              className="form-input">
                              <option value="password">Password</option>
                              <option value="key">Chiave SSH</option>
                            </select>
                          </div>
                          {creds.auth_method === 'password' ? (
                            <div className="sf-import-field sf-import-field-wide">
                              <label className="form-label">Password SSH</label>
                              <input type="password" value={creds.ssh_password}
                                onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_password', e.target.value)}
                                className="form-input" placeholder="Password..." />
                            </div>
                          ) : (
                            <div className="sf-import-field sf-import-field-wide">
                              <label className="form-label">Percorso Chiave</label>
                              <input type="text" value={creds.ssh_key_path}
                                onChange={e => handleImportFormChange(sfm.sf_id, 'ssh_key_path', e.target.value)}
                                className="form-input" placeholder="~/.ssh/id_rsa" />
                            </div>
                          )}
                          <button
                            onClick={() => handleImportMachine(sfm)}
                            disabled={importingId === sfm.sf_id}
                            className="btn btn-sm sf-btn-import"
                          >
                            {importingId === sfm.sf_id ? '...' : 'Importa'}
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
            {editingId ? `Modifica: ${form.name || '...'}` : 'Nuova Macchina SSH'}
          </h2>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Identificazione</legend>
            <div className="form-grid">
              <div className="form-group form-group-3">
                <label className="form-label">Nome *</label>
                <input type="text" name="name" value={form.name} onChange={handleChange}
                  className={inputClass('name')} placeholder="es. Server Produzione 1" autoFocus />
                <span className="form-hint">Nome univoco per identificare la macchina</span>
                {fieldError('name')}
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">Descrizione</label>
                <input type="text" name="description" value={form.description} onChange={handleChange}
                  className="form-input" placeholder="es. Server principale TheIsland" />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">Hostname *</label>
                <input type="text" name="hostname" value={form.hostname} onChange={handleChange}
                  className={inputClass('hostname')} placeholder="es. ark01.example.com" />
                {fieldError('hostname')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">Indirizzo IP</label>
                <input type="text" name="ip_address" value={form.ip_address} onChange={handleChange}
                  className="form-input" placeholder="192.168.1.100" />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label form-label-inline">
                  <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} className="form-checkbox" />
                  Attiva
                </label>
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">Sistema operativo host</label>
                <select name="os_type" value={form.os_type} onChange={handleChange} className="form-input">
                  <option value="linux">Linux nativo</option>
                  <option value="windows">Windows + WSL</option>
                </select>
                <span className="form-hint">
                  Determina come POK-manager e docker vengono invocati via SSH.
                </span>
              </div>
              {form.os_type === 'windows' && (
                <div className="form-group form-group-2">
                  <label className="form-label">Distro WSL</label>
                  <input type="text" name="wsl_distro" value={form.wsl_distro || ''}
                    onChange={handleChange} className="form-input" placeholder="Ubuntu" />
                  <span className="form-hint">
                    Nome della distribuzione WSL (verifica con <code>wsl -l -q</code>).
                  </span>
                </div>
              )}
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Connessione SSH</legend>
            <div className="form-grid">
              <div className="form-group form-group-1">
                <label className="form-label">Porta</label>
                <input type="number" name="ssh_port" value={form.ssh_port} onChange={handleChange}
                  className={inputClass('ssh_port')} min={1} max={65535} />
                {fieldError('ssh_port')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">Utente SSH *</label>
                <input type="text" name="ssh_user" value={form.ssh_user} onChange={handleChange}
                  className={inputClass('ssh_user')} placeholder="root" />
                {fieldError('ssh_user')}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">Metodo Auth</label>
                <select name="auth_method" value={form.auth_method} onChange={handleChange} className="form-input">
                  <option value="password">Password</option>
                  <option value="key">Chiave SSH</option>
                  <option value="key_password">Chiave + Passphrase</option>
                </select>
              </div>
              <div className="form-group form-group-1" />
              {(form.auth_method === 'password' || form.auth_method === 'key_password') && (
                <div className="form-group form-group-3">
                  <label className="form-label">{form.auth_method === 'password' ? 'Password SSH' : 'Passphrase'}{!editingId && ' *'}</label>
                  <input type="password"
                    name={form.auth_method === 'password' ? 'ssh_password' : 'ssh_passphrase'}
                    value={form.auth_method === 'password' ? form.ssh_password : form.ssh_passphrase}
                    onChange={handleChange}
                    className={inputClass(form.auth_method === 'password' ? 'ssh_password' : 'ssh_passphrase')}
                    placeholder={editingId ? '(lascia vuoto per non modificare)' : ''} />
                  {editingId && <span className="form-hint">Vuoto = mantieni password attuale</span>}
                  {fieldError('ssh_password')}
                </div>
              )}
              {(form.auth_method === 'key' || form.auth_method === 'key_password') && (
                <div className="form-group form-group-3">
                  <label className="form-label">Percorso Chiave SSH *</label>
                  <input type="text" name="ssh_key_path" value={form.ssh_key_path} onChange={handleChange}
                    className={inputClass('ssh_key_path')} placeholder="~/.ssh/id_rsa" />
                  {fieldError('ssh_key_path')}
                </div>
              )}
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Percorsi Ark: Survival Ascended</legend>
            <div className="form-grid">
              <div className="form-group form-group-full">
                <label className="form-label">Root Directory ARK</label>
                <input type="text" name="ark_root_path" value={form.ark_root_path} onChange={handleChange}
                  className="form-input" placeholder="/opt/ark" />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">Directory Configurazione</label>
                <input type="text" name="ark_config_path" value={form.ark_config_path} onChange={handleChange}
                  className="form-input" />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">Directory Plugin</label>
                <input type="text" name="ark_plugins_path" value={form.ark_plugins_path} onChange={handleChange}
                  className="form-input" />
              </div>
            </div>
          </fieldset>

          <div className="form-actions">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary">
              {saving ? 'Salvataggio...' : editingId ? 'Aggiorna Macchina' : 'Crea Macchina'}
            </button>
            <button onClick={handleCancel} className="btn btn-ghost">Annulla</button>
          </div>
        </div>
      )}

      {/* ========== LISTA MACCHINE ========== */}
      {loading ? (
        <div className="loading-state">Caricamento macchine...</div>
      ) : machines.length === 0 && !showForm && !showImport ? (
        <div className="empty-state">
          <span className="empty-state-icon">&#x29C9;</span>
          <h3 className="empty-state-title">Nessuna macchina configurata</h3>
          <p className="empty-state-text">Aggiungi la prima macchina SSH per gestire i tuoi server Ark.</p>
          <div className="card-actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <button onClick={handleNew} className="btn btn-primary">+ Nuova Macchina</button>
            {sfHasToken && (
              <button onClick={handleOpenImport} className="btn btn-secondary">&#x26A1; Importa da ServerForge</button>
            )}
          </div>
        </div>
      ) : (
        <div className="machines-list">
          {machines.map((machine) => {
            const isExpanded = expandedId === machine.id
            return (
              <div key={machine.id} className={`machine-card ${!machine.is_active ? 'machine-card-inactive' : ''}`}>
                <div className="machine-card-header" onClick={() => setExpandedId(prev => prev === machine.id ? null : machine.id)} style={{ cursor: 'pointer' }}>
                  <div className="machine-card-info">
                    <h3 className="machine-card-name">
                      {machine.name}
                      <span className="machine-card-tag" title={machine.os_type === 'windows' ? `Windows + WSL (${machine.wsl_distro || 'Ubuntu'})` : 'Linux nativo'}>
                        {machine.os_type === 'windows' ? 'Windows+WSL' : 'Linux'}
                      </span>
                      {!machine.is_active && <span className="machine-card-tag">disattivata</span>}
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
                      <div className="machine-card-detail"><span className="detail-label">Host OS</span>
                        <span className="detail-value">
                          {machine.os_type === 'windows'
                            ? `Windows + WSL (${machine.wsl_distro || 'Ubuntu'})`
                            : 'Linux nativo'}
                        </span></div>
                      <div className="machine-card-detail"><span className="detail-label">Auth</span>
                        <span className="detail-value">{machine.auth_method === 'password' ? 'Password' : machine.auth_method === 'key' ? 'Chiave SSH' : 'Chiave + Passphrase'}</span></div>
                      {machine.ip_address && <div className="machine-card-detail"><span className="detail-label">IP</span><span className="detail-value detail-value-mono">{machine.ip_address}</span></div>}
                      <div className="machine-card-detail"><span className="detail-label">ARK Root</span><span className="detail-value detail-value-mono">{machine.ark_root_path}</span></div>
                      <div className="machine-card-detail"><span className="detail-label">Config</span><span className="detail-value detail-value-mono">{machine.ark_config_path}</span></div>
                      <div className="machine-card-detail"><span className="detail-label">Plugin</span><span className="detail-value detail-value-mono">{machine.ark_plugins_path}</span></div>
                      {machine.last_connection && <div className="machine-card-detail"><span className="detail-label">Ultima connessione</span><span className="detail-value">{new Date(machine.last_connection).toLocaleString('it-IT')}</span></div>}
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
                        {testingId === machine.id ? 'Testing...' : 'Test Connessione'}
                      </button>
                      <button onClick={() => handleEdit(machine)} className="btn btn-sm btn-ghost">Modifica</button>
                      <button onClick={() => handleDuplicate(machine.id)} className="btn btn-sm btn-ghost">Duplica</button>
                      <button onClick={() => handleDelete(machine.id, machine.name)} className="btn btn-sm btn-danger">Elimina</button>
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
