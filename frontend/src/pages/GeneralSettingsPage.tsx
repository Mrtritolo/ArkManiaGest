/**
 * GeneralSettingsPage.tsx — Global application settings.
 *
 * Covers: application name, log level, auto-backup configuration.
 * Changes are persisted to the database via the settings API.
 */
import { useState, useEffect } from 'react'
import { settingsApi } from '../services/api'
import type { AppSettings } from '../types'

interface HealthInfo {
  version: string
  db_ready: boolean
}

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const

export default function GeneralSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [form, setForm] = useState({
    app_name:               'ArkManiaGest',
    log_level:              'INFO',
    auto_backup:            true,
    backup_interval_hours:  6,
    backup_retention:       10,
  })
  const [saving, setSaving]   = useState(false)
  const [message, setMessage] = useState('')
  const [health, setHealth]   = useState<HealthInfo | null>(null)

  useEffect(() => { loadSettings(); loadHealth() }, [])

  async function loadHealth(): Promise<void> {
    try {
      const res = await fetch('/health')
      if (res.ok) setHealth(await res.json())
    } catch { /* keep null */ }
  }

  async function loadSettings(): Promise<void> {
    try {
      const res = await settingsApi.get()
      setSettings(res.data)
      setForm({
        app_name:               res.data.app_name,
        log_level:              res.data.log_level,
        auto_backup:            res.data.auto_backup,
        backup_interval_hours:  res.data.backup_interval_hours,
        backup_retention:       res.data.backup_retention,
      })
    } catch { /* keep defaults */ }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    const { name, type, value } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked
            : type === 'number'   ? (parseInt(value) || 0)
            : value,
    }))
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMessage('')
    try {
      const res = await settingsApi.update(form)
      setSettings(res.data)
      setMessage('Settings saved successfully!')
      setTimeout(() => setMessage(''), 3000)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (err instanceof Error ? err.message : 'Save failed')
      setMessage(`Error: ${detail}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">General Settings</h1>
        <p className="page-subtitle">Global application configuration</p>
      </div>

      {/* Application */}
      <div className="card">
        <h2 className="card-title">
          <span className="card-title-icon">⬢</span>
          Application
        </h2>
        <div className="form-grid">
          <div className="form-group form-group-3">
            <label className="form-label">Application Name</label>
            <input
              type="text" name="app_name" value={form.app_name}
              onChange={handleChange} className="form-input"
            />
            <span className="form-hint">Shown in the header and logs</span>
          </div>
          <div className="form-group form-group-2">
            <label className="form-label">Log Level</label>
            <select name="log_level" value={form.log_level} onChange={handleChange} className="form-input">
              {LOG_LEVELS.map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
            <span className="form-hint">Application log verbosity</span>
          </div>
        </div>
      </div>

      {/* Auto-backup */}
      <div className="card mt-6">
        <h2 className="card-title">
          <span className="card-title-icon">⟲</span>
          Auto Backup
        </h2>
        <div className="form-grid">
          <div className="form-group form-group-full">
            <label className="form-label form-label-inline">
              <input
                type="checkbox" name="auto_backup" checked={form.auto_backup}
                onChange={handleChange} className="form-checkbox"
              />
              Enable automatic configuration backups
            </label>
            <span className="form-hint">
              Automatically save a backup copy of plugin configuration files
            </span>
          </div>

          {form.auto_backup && (
            <>
              <div className="form-group form-group-2">
                <label className="form-label">Interval (hours)</label>
                <input
                  type="number" name="backup_interval_hours" value={form.backup_interval_hours}
                  onChange={handleChange} className="form-input" min={1} max={168}
                />
                <span className="form-hint">How often to run backups (1–168 h)</span>
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">Copies to keep</label>
                <input
                  type="number" name="backup_retention" value={form.backup_retention}
                  onChange={handleChange} className="form-input" min={1} max={100}
                />
                <span className="form-hint">Maximum number of backups to retain</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* System info */}
      <div className="card mt-6 card-muted">
        <h2 className="card-title">
          <span className="card-title-icon">ℹ</span>
          System Information
        </h2>
        <div className="info-grid">
          <div className="info-item"><span className="info-label">Version</span><span className="info-value">{health?.version || '...'}</span></div>
          <div className="info-item"><span className="info-label">Database</span><span className="info-value">{health?.db_ready ? 'Connected' : 'Offline'}</span></div>
          <div className="info-item"><span className="info-label">Backend</span><span className="info-value">FastAPI + Python</span></div>
          <div className="info-item"><span className="info-label">Config storage</span><span className="info-value">DB + .env (AES-256-GCM)</span></div>
        </div>
      </div>

      {/* Save bar */}
      <div className="form-actions-sticky">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {message && (
          <span className={`form-message ${message.startsWith('Error') ? 'form-message-error' : 'form-message-success'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
