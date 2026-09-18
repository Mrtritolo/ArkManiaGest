/**
 * SetupWizard.tsx — First-run application setup.
 *
 * Creates the initial admin account.
 * Database credentials are pre-configured in the .env file on the server.
 *
 * Rendered as the whole canvas (App.tsx shows it instead of the panel), so it
 * owns the centred `.ui-auth` layout.  It is a real <form>: Enter in any
 * field submits, and a failed submit keeps the inline errors and focuses the
 * first invalid control.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsApi } from '../services/api'
import { extractError } from '../utils/errors'
import { Alert, Button, Card, Field, Input } from '../components/ui'
import styles from './SetupWizard.module.css'

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

/** The fields that can be invalid, in tab order. */
const VALIDATED = [
  'admin_username',
  'admin_display_name',
  'admin_password',
  'admin_password_confirm',
] as const
type ValidatedField = typeof VALIDATED[number]

type Errors = Partial<Record<ValidatedField, string>>

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
  const [touched, setTouched]   = useState<Partial<Record<ValidatedField, true>>>({})
  const [submitted, setSubmitted] = useState(false)
  const inputs = useRef<Partial<Record<ValidatedField, HTMLInputElement | null>>>({})

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    const name = e.target.name as ValidatedField
    if ((VALIDATED as readonly string[]).includes(name)) {
      setTouched(prev => ({ ...prev, [name]: true }))
    }
  }

  /**
   * Mirror of the backend policy (12+ chars, letters + digits).  Username and
   * display name are checked trimmed: the backend strips them after its
   * length check, so 'a ' would create admin 'a', which login rejects.
   */
  function validate(state: FormState): Errors {
    const errors: Errors = {}
    if (state.admin_username.trim().length < 2) {
      errors.admin_username = t('setup.error.username')
    }
    if (state.admin_display_name.trim().length < 1) {
      errors.admin_display_name = t('setup.error.displayName')
    }
    if (
      state.admin_password.length < 12 ||
      !/[a-zA-Z]/.test(state.admin_password) ||
      !/[0-9]/.test(state.admin_password)
    ) {
      errors.admin_password = t('setup.error.password')
    }
    if (state.admin_password !== state.admin_password_confirm) {
      errors.admin_password_confirm = t('setup.passwordMismatch')
    }
    return errors
  }

  const errors = validate(form)

  /** Shown once the field was left, or once a submit was attempted. */
  function errorFor(field: ValidatedField): string | undefined {
    return submitted || touched[field] ? errors[field] : undefined
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitted(true)
    const firstInvalid = VALIDATED.find(field => errors[field])
    if (firstInvalid) {
      inputs.current[firstInvalid]?.focus()
      return
    }

    setCreating(true)
    setError('')
    try {
      await settingsApi.setup({
        admin_username:      form.admin_username.trim(),
        admin_password:      form.admin_password,
        admin_display_name:  form.admin_display_name.trim(),
        app_name:            form.app_name,
      })
      onComplete()
    } catch (err: unknown) {
      setError(extractError(err, t('setup.errorGeneric')))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="ui-auth">
      <div className={`${styles.card} l-stack`}>
        <div className={styles.brand}>
          <img src="/logo.png" alt="" className={styles.logo} />
          <h1>{t('nav.brand')}</h1>
          <p className={styles.lead}>{t('setup.title')}</p>
        </div>

        <Card title={t('setup.stepTitle')}>
          <form onSubmit={handleSubmit} className="l-stack" noValidate>
            <p className={styles.lead}>{t('setup.stepDesc')}</p>

            {error && <Alert tone="danger">{error}</Alert>}

            <div className="l-grid--form">
              <Field label={t('setup.username')} error={errorFor('admin_username')} required>
                <Input
                  name="admin_username"
                  value={form.admin_username}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder={t('setup.placeholder.username')}
                  autoComplete="username"
                  autoFocus
                  ref={el => { inputs.current.admin_username = el }}
                />
              </Field>

              <Field label={t('setup.displayName')} error={errorFor('admin_display_name')} required>
                <Input
                  name="admin_display_name"
                  value={form.admin_display_name}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder={t('setup.placeholder.displayName')}
                  ref={el => { inputs.current.admin_display_name = el }}
                />
              </Field>

              <Field
                label={t('setup.field.password')}
                hint={t('setup.hint.password')}
                error={errorFor('admin_password')}
                required
              >
                <Input
                  type="password"
                  revealable
                  name="admin_password"
                  value={form.admin_password}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder={t('setup.placeholder.password')}
                  autoComplete="new-password"
                  ref={el => { inputs.current.admin_password = el }}
                />
              </Field>

              <Field
                label={t('setup.passwordConfirm')}
                error={errorFor('admin_password_confirm')}
                required
              >
                <Input
                  type="password"
                  revealable
                  name="admin_password_confirm"
                  value={form.admin_password_confirm}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder={t('setup.placeholder.passwordConfirm')}
                  autoComplete="new-password"
                  ref={el => { inputs.current.admin_password_confirm = el }}
                />
              </Field>

              <Field label={t('setup.appName')}>
                <Input name="app_name" value={form.app_name} onChange={handleChange} />
              </Field>
            </div>

            <div className="l-cluster l-cluster--end">
              <Button
                type="submit"
                variant="primary"
                loading={creating}
                loadingLabel={t('setup.submitting')}
              >
                {t('setup.submit')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
