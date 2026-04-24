/**
 * LoginPage.tsx — User login screen.
 *
 * Shown after the setup wizard completes (users exist in the DB).
 * Authenticates the user and passes the resulting JWT + profile up to App.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { authApi, setAuthToken } from '../services/api'
import type { AuthUser } from '../types'
import DiscordIcon from '../components/DiscordIcon'

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
  const [showPassword, setShowPassword] = useState(false)
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
      const r = await fetch(
        '/api/v1/auth/discord/start?next_path=' + encodeURIComponent('/'),
        { credentials: 'include' },
      )
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      const { authorize_url } = await r.json()
      window.location.assign(authorize_url)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.login.errorNetwork')
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
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('auth.login.errorNetwork')
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="setup-overlay">
      <div className="unlock-container">
        <div className="setup-header">
          <img
            src="/logo.png"
            alt="ArkMania"
            style={{ width: 120, height: 120, objectFit: 'contain', margin: '0 auto', display: 'block' }}
          />
        </div>

        <form onSubmit={handleSubmit} className="unlock-form">
          {error && (
            <div className="alert alert-error">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t('auth.login.username')}</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="form-input"
              placeholder={t('auth.login.username')}
              autoFocus
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">{t('auth.login.password')}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="form-input"
                placeholder={t('auth.login.password')}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                style={{
                  position: 'absolute', right: '0.6rem', top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
                aria-label={showPassword ? t('common.close') : t('common.confirm')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.65rem' }}
            disabled={loading || !username.trim() || !password}
          >
            {loading ? t('auth.login.submitting') : <><LogIn size={16} /> {t('auth.login.submit')}</>}
          </button>

          {/* ── Divider + Discord OAuth ──────────────────────────────
              The button hits /api/v1/auth/discord/start which sets the
              state cookie and returns the Discord authorize URL; we
              then redirect the browser to it.  After consent, Discord
              calls our /auth/discord/callback which sets the
              disc_session cookie and bounces back to '/' with
              ?discord_login=ok|err. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            margin: '1rem 0 0.65rem',
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {t('auth.login.or')}
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <button
            type="button"
            onClick={handleDiscordLogin}
            disabled={loading || discordRedirecting}
            className="btn btn-secondary"
            style={{
              width: '100%', padding: '0.65rem',
              background: '#5865F2',          // Discord brand blurple
              borderColor: '#5865F2',
              color: '#ffffff',
            }}
          >
            <DiscordIcon size={16} />
            {discordRedirecting
              ? t('auth.login.discordRedirecting')
              : t('auth.login.discordButton')}
          </button>
        </form>
      </div>
    </div>
  )
}
