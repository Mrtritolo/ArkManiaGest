/**
 * GeneralSettingsPage.tsx — Global application settings.
 *
 * Covers: application name, log level, auto-backup configuration.
 * Changes are persisted to the database via the settings API.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsApi } from '../services/api'
import type { AppSettings } from '../types'

interface HealthInfo {
  version: string
  db_ready: boolean
}

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const

export default function GeneralSettingsPage() {
  const { t } = useTranslation()
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
  const [isError, setIsError] = useState(false)
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
    setIsError(false)
    try {
      const res = await settingsApi.update(form)
      setSettings(res.data)
      setMessage(t('generalSettings.saved'))
      setTimeout(() => setMessage(''), 3000)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (err instanceof Error ? err.message : t('generalSettings.saveFailed'))
      setIsError(true)
      setMessage(`${t('generalSettings.errorPrefix')}: ${detail}`)
    } finally {
      setSaving(false)
    }
  }

  // `settings` is read above for future use (e.g. change detection) but we
  // only render the editable `form` state; suppress the unused warning.
  void settings

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('generalSettings.title')}</h1>
        <p className="page-subtitle">{t('generalSettings.subtitle')}</p>
      </div>

      {/* Application */}
      <div className="card">
        <h2 className="card-title">
          <span className="card-title-icon">⬢</span>
          {t('generalSettings.section.app')}
        </h2>
        <div className="form-grid">
          <div className="form-group form-group-3">
            <label className="form-label">{t('generalSettings.field.appName')}</label>
            <input
              type="text" name="app_name" value={form.app_name}
              onChange={handleChange} className="form-input"
            />
            <span className="form-hint">{t('generalSettings.hint.appName')}</span>
          </div>
          <div className="form-group form-group-2">
            <label className="form-label">{t('generalSettings.field.logLevel')}</label>
            <select name="log_level" value={form.log_level} onChange={handleChange} className="form-input">
              {LOG_LEVELS.map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
            <span className="form-hint">{t('generalSettings.hint.logLevel')}</span>
          </div>
        </div>
      </div>

      {/* Auto-backup */}
      <div className="card mt-6">
        <h2 className="card-title">
          <span className="card-title-icon">⟲</span>
          {t('generalSettings.section.backup')}
        </h2>
        <div className="form-grid">
          <div className="form-group form-group-full">
            <label className="form-label form-label-inline">
              <input
                type="checkbox" name="auto_backup" checked={form.auto_backup}
                onChange={handleChange} className="form-checkbox"
              />
              {t('generalSettings.field.autoBackup')}
            </label>
            <span className="form-hint">{t('generalSettings.hint.autoBackup')}</span>
          </div>

          {form.auto_backup && (
            <>
              <div className="form-group form-group-2">
                <label className="form-label">{t('generalSettings.field.interval')}</label>
                <input
                  type="number" name="backup_interval_hours" value={form.backup_interval_hours}
                  onChange={handleChange} className="form-input" min={1} max={168}
                />
                <span className="form-hint">{t('generalSettings.hint.interval')}</span>
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t('generalSettings.field.retention')}</label>
                <input
                  type="number" name="backup_retention" value={form.backup_retention}
                  onChange={handleChange} className="form-input" min={1} max={100}
                />
                <span className="form-hint">{t('generalSettings.hint.retention')}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* System info */}
      <div className="card mt-6 card-muted">
        <h2 className="card-title">
          <span className="card-title-icon">ℹ</span>
          {t('generalSettings.section.system')}
        </h2>
        <div className="info-grid">
          <div className="info-item"><span className="info-label">{t('generalSettings.info.version')}</span><span className="info-value">{health?.version || '...'}</span></div>
          <div className="info-item"><span className="info-label">{t('generalSettings.info.database')}</span><span className="info-value">{health?.db_ready ? t('generalSettings.info.dbConnected') : t('generalSettings.info.dbOffline')}</span></div>
          <div className="info-item"><span className="info-label">{t('generalSettings.info.backend')}</span><span className="info-value">FastAPI + Python</span></div>
          <div className="info-item"><span className="info-label">{t('generalSettings.info.configStorage')}</span><span className="info-value">DB + .env (AES-256-GCM)</span></div>
        </div>
      </div>

      {/* Save bar */}
      <div className="form-actions-sticky">
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? t('generalSettings.saving') : t('generalSettings.save')}
        </button>
        {message && (
          <span className={`form-message ${isError ? 'form-message-error' : 'form-message-success'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
