/**
 * GeneralSettingsPage.tsx — Global application settings.
 *
 * Covers: application name, log level, auto-backup configuration.
 * Changes are persisted to the database via the settings API.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { settingsApi } from '../services/api'
import type { AppSettings, VersionCheckResult } from '../types'

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

  const [versionInfo, setVersionInfo]   = useState<VersionCheckResult | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)

  useEffect(() => { loadSettings(); loadHealth(); loadVersion(false) }, [])

  async function loadVersion(force: boolean): Promise<void> {
    setVersionLoading(true)
    try {
      const res = await settingsApi.checkVersion(force)
      setVersionInfo(res.data)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (err instanceof Error ? err.message : 'error')
      setVersionInfo({
        current: health?.version ?? '',
        current_commit: null,
        current_built_at: null,
        latest: null,
        update_available: false,
        release_url: null,
        release_name: null,
        release_published_at: null,
        release_notes: null,
        cached_at: null,
        error: detail,
      })
    } finally {
      setVersionLoading(false)
    }
  }

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

      {/* Updates */}
      <div className="card mt-6">
        <h2 className="card-title">
          <span className="card-title-icon"><Download size={14} /></span>
          {t('generalSettings.updates.section')}
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 180 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {t('generalSettings.updates.current')}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: 700 }}>
              {versionInfo?.current || health?.version || '…'}
            </span>
            {versionInfo?.current_commit && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {t('generalSettings.updates.commit')}: {versionInfo.current_commit.substring(0, 8)}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 180 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {t('generalSettings.updates.latest')}
            </span>
            <span
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: versionInfo?.update_available ? 'var(--warning, #ca8a04)' : 'var(--success, #16a34a)',
              }}
            >
              {versionInfo?.latest || (versionInfo?.error ? '—' : '…')}
            </span>
            {versionInfo?.release_published_at && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {t('generalSettings.updates.publishedAt', {
                  when: new Date(versionInfo.release_published_at).toLocaleString(undefined),
                })}
              </span>
            )}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => loadVersion(true)}
              disabled={versionLoading}
              className="btn btn-secondary"
            >
              <RefreshCw size={14} style={{ animation: versionLoading ? 'spin 1s linear infinite' : 'none' }} />
              {versionLoading ? t('generalSettings.updates.checking') : t('generalSettings.updates.checkNow')}
            </button>
            {versionInfo?.release_url && (
              <a
                href={versionInfo.release_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                <ExternalLink size={14} /> {t('generalSettings.updates.viewRelease')}
              </a>
            )}
          </div>
        </div>

        {/* Status line */}
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
          {versionInfo?.error ? (
            <span style={{ color: 'var(--danger, #dc2626)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <AlertCircle size={14} />
              {t('generalSettings.updates.error', { message: versionInfo.error })}
            </span>
          ) : versionInfo?.update_available && versionInfo.latest ? (
            <span style={{ color: 'var(--warning, #ca8a04)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Download size={14} />
              {t('generalSettings.updates.updateAvailable', { version: versionInfo.latest })}
            </span>
          ) : versionInfo?.latest ? (
            <span style={{ color: 'var(--success, #16a34a)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <CheckCircle size={14} /> {t('generalSettings.updates.upToDate')}
            </span>
          ) : null}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {t('generalSettings.updates.cacheHint')}
          </p>
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
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
