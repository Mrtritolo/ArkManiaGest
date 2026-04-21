/**
 * LoginPage.tsx — User login screen.
 *
 * Shown after the setup wizard completes (users exist in the DB).
 * Authenticates the user and passes the resulting JWT + profile up to App.
 */
import { useState } from 'react'
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { authApi, setAuthToken } from '../services/api'
import type { AuthUser } from '../types'

interface LoginPageProps {
  onLoggedIn: (user: AuthUser) => void
}

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

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
        ?? 'Connection error'
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
            <label className="form-label">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="form-input"
              placeholder="Enter username"
              autoFocus
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="form-input"
                placeholder="Enter password"
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
            {loading ? 'Signing in…' : <><LogIn size={16} /> Sign in</>}
          </button>
        </form>
      </div>
    </div>
  )
}
