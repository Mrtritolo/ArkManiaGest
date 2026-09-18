/**
 * LoginPage.tsx — User login screen.
 *
 * Shown after the setup wizard completes (users exist in the DB).
 * Authenticates the user and passes the resulting JWT + profile up to App.
 *
 * Rendered as the whole canvas (App.tsx shows it instead of the panel), so it
 * owns the centred `.ui-auth` layout.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { authApi, setAuthToken } from '../services/api'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import { Alert, Button, Card, Field, Input } from '../components/ui'
import DiscordIcon from '../components/DiscordIcon'
import styles from './LoginPage.module.css'

// DiscordIcon is shared with the Sidebar Settings -> Discord entry, the
// Settings -> Discord admin page and the Players page Discord quick-action
// chip; see components/DiscordIcon.tsx for the SVG path.

interface LoginPageProps {
  onLoggedIn: (user: AuthUser) => void
}

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [discordRedirecting, setDiscordRedirecting] = useState(false)

  // Surface ?discord_login=err returned by the OAuth callback so the
  // operator sees what went wrong (mismatch state, user cancelled,
  // Discord 5xx, ...) instead of silently bouncing back to the login.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const flag   = params.get('discord_login')
    if (flag === 'err') {
      const reason = params.get('reason') || 'unknown'
      setError(t('auth.login.discordErr', { reason }))
      // Clean the URL so a refresh doesn't keep re-flashing the toast.
      params.delete('discord_login'); params.delete('reason')
      const qs = params.toString()
      window.history.replaceState({}, '',
        window.location.pathname + (qs ? '?' + qs : ''))
    }
    // We don't handle ?discord_login=ok here yet -- Phase 3 will, when
    // it picks up the disc_session cookie + walks the linking flow.
  }, [t])

  async function handleDiscordLogin(): Promise<void> {
    setDiscordRedirecting(true); setError('')
    try {
      // Hit the backend to get the authorize URL + the state cookie it
      // sets in the response.  Then jump the browser to Discord's
      // consent screen.
      const { data } = await authApi.discordStart('/')
      window.location.assign(data.authorize_url)
    } catch (err: unknown) {
      // Prefer the backend detail (e.g. which DISCORD_* keys are missing)
      // over axios' generic "Request failed with status code 409".
      const msg = extractError(err, t('auth.login.errorNetwork'))
      setError(t('auth.login.discordStartFailed', { message: msg }))
      setDiscordRedirecting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await authApi.login(username.trim().toLowerCase(), password)
      setAuthToken(res.data.token)
      onLoggedIn(res.data.user)
    } catch (err: unknown) {
      // Only the backend detail: axios' own message is English, and a
      // network failure says nothing useful to the operator.
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('auth.login.errorNetwork')
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ui-auth">
      <div className="ui-auth__card l-stack">
        <div className={styles.brand}>
          <img src="/logo.png" alt="" className={styles.logo} />
          <h1>{t('nav.brand')}</h1>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="l-stack" noValidate>
            {error && <Alert tone="danger">{error}</Alert>}

            <Field label={t('auth.login.username')}>
              <Input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t('auth.login.username')}
                autoFocus
                autoComplete="username"
                disabled={loading}
              />
            </Field>

            <Field label={t('auth.login.password')}>
              <Input
                type="password"
                revealable
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('auth.login.password')}
                autoComplete="current-password"
                disabled={loading}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              icon={LogIn}
              className={styles.block}
              loading={loading}
              loadingLabel={t('auth.login.submitting')}
              disabled={!username.trim() || !password}
            >
              {t('auth.login.submit')}
            </Button>

            {/* ── Divider + Discord OAuth ──────────────────────────────
                The button hits /api/v1/auth/discord/start which sets the
                state cookie and returns the Discord authorize URL; we
                then redirect the browser to it.  After consent, Discord
                calls our /auth/discord/callback which sets the
                disc_session cookie and bounces back to '/' with
                ?discord_login=ok|err. */}
            <p className={styles.separator}>{t('auth.login.or')}</p>

            <Button
              type="button"
              className={styles.block}
              onClick={handleDiscordLogin}
              disabled={loading || discordRedirecting}
            >
              <span className={styles.withIcon}>
                <DiscordIcon size={16} />
                {discordRedirecting
                  ? t('auth.login.discordRedirecting')
                  : t('auth.login.discordButton')}
              </span>
            </Button>

            {/* GDPR Art. 13: the privacy notice must be reachable BEFORE
                the user authenticates (especially via Discord OAuth).
                A plain link, not <Link>: /privacy is resolved by App
                before the router mounts. */}
            <p className={styles.footerLink}>
              <a href="/privacy">{t('privacy.policyLink')}</a>
            </p>
          </form>
        </Card>
      </div>
    </div>
  )
}
