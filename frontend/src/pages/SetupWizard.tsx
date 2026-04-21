/**
 * SetupWizard.tsx — First-run application setup.
 *
 * Creates the initial admin account.
 * Database credentials are pre-configured in the .env file on the server.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsApi } from '../services/api'

interface SetupWizardProps {
  /** Called when setup completes successfully. */
  onComplete: () => void
}

interface FormState {
  admin_username:        string
  admin_password:        string
  admin_password_confirm:string
  admin_display_name:    string
  app_name:              string
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const { t } = useTranslation()
  const [form, setForm]       = useState<FormState>({
    admin_username:         'admin',
    admin_password:         '',
    admin_password_confirm: '',
    admin_display_name:     'Administrator',
    app_name:               'ArkManiaGest',
  })
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  function isValid(): boolean {
    return (
      form.admin_username.length >= 2 &&
      form.admin_password.length >= 6 &&
      form.admin_password === form.admin_password_confirm &&
      form.admin_display_name.length >= 1
    )
  }

  async function handleCreate(): Promise<void> {
    setCreating(true)
    setError('')
    try {
      await settingsApi.setup({
        admin_username:      form.admin_username,
        admin_password:      form.admin_password,
        admin_display_name:  form.admin_display_name,
        app_name:            form.app_name,
      })
      onComplete()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (err instanceof Error ? err.message : t('setup.errorGeneric'))
      setError(detail)
    } finally {
      setCreating(false)
    }
  }

  const passwordMismatch =
    form.admin_password_confirm.length > 0 &&
    form.admin_password !== form.admin_password_confirm

  return (
    <div className="setup-overlay">
      <div className="setup-container">
        <div className="setup-header">
          <img src="/logo.png" alt="ArkMania" className="setup-logo" />
          <h1 className="setup-title">ArkManiaGest</h1>
          <p className="setup-subtitle">{t('setup.title')}</p>
        </div>

        <div className="setup-step">
          <h2 className="setup-step-title">{t('setup.stepTitle')}</h2>
          <p className="setup-step-desc">{t('setup.stepDesc')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div className="setup-field">
              <label className="form-label">{t('setup.username')}</label>
              <input
                type="text" name="admin_username" value={form.admin_username}
                onChange={handleChange} className="form-input"
                placeholder={t('setup.placeholder.username')} autoFocus
              />
            </div>
            <div className="setup-field">
              <label className="form-label">{t('setup.displayName')}</label>
              <input
                type="text" name="admin_display_name" value={form.admin_display_name}
                onChange={handleChange} className="form-input"
                placeholder={t('setup.placeholder.displayName')}
              />
            </div>
            <div className="setup-field">
              <label className="form-label">{t('setup.password')}</label>
              <input
                type="password" name="admin_password" value={form.admin_password}
                onChange={handleChange} className="form-input"
                placeholder={t('setup.placeholder.password')}
              />
            </div>
            <div className="setup-field">
              <label className="form-label">{t('setup.passwordConfirm')}</label>
              <input
                type="password" name="admin_password_confirm" value={form.admin_password_confirm}
                onChange={handleChange} className="form-input"
                placeholder={t('setup.placeholder.passwordConfirm')}
              />
              {passwordMismatch && (
                <span className="form-message form-message-error">{t('setup.passwordMismatch')}</span>
              )}
            </div>
            <div className="setup-field">
              <label className="form-label">{t('setup.appName')}</label>
              <input
                type="text" name="app_name" value={form.app_name}
                onChange={handleChange} className="form-input"
              />
            </div>
          </div>

          {error && (
            <div className="alert alert-error mt-3">
              <span className="alert-icon">!</span>
              {error}
            </div>
          )}

          <div className="setup-actions">
            <button
              onClick={handleCreate}
              disabled={creating || !isValid()}
              className="btn btn-primary"
            >
              {creating ? t('setup.submitting') : t('setup.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
