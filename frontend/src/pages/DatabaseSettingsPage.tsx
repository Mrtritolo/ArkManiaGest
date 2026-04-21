/**
 * DatabaseSettingsPage.tsx — MariaDB connection overview.
 *
 * Read-only view of the database configuration sourced from the server .env
 * file, plus a connectivity test button.
 */
import { useState, useEffect } from 'react'
import { Database, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { databaseApi } from '../services/api'
import type { DatabaseConfig } from '../types'

export default function DatabaseSettingsPage() {
  const [config, setConfig]       = useState<DatabaseConfig | null>(null)
  const [testing, setTesting]     = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => { loadConfig() }, [])

  async function loadConfig(): Promise<void> {
    try {
      const res = await databaseApi.get()
      setConfig(res.data)
    } catch { /* silently ignore — page shows "Loading…" */ }
  }

  async function handleTestCurrent(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await databaseApi.testCurrent()
      setTestResult(res.data)
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Database size={22} /> Database Configuration</h1>
          <p className="page-subtitle">
            MariaDB connection — configured in the server .env file
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">
          <span className="card-title-icon">&#x25C9;</span>
          Connection Parameters
        </h2>

        {config ? (
          <div className="form-grid">
            <div className="form-group form-group-3">
              <label className="form-label">Host</label>
              <input type="text" value={config.host} className="form-input" readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group form-group-1">
              <label className="form-label">Port</label>
              <input type="text" value={config.port} className="form-input" readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group form-group-2">
              <label className="form-label">Database</label>
              <input type="text" value={config.name} className="form-input" readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group form-group-2">
              <label className="form-label">User</label>
              <input type="text" value={config.user} className="form-input" readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group form-group-2">
              <label className="form-label">Password</label>
              <input
                type="text"
                value={config.has_password ? '••••••••' : '(not configured)'}
                className="form-input"
                readOnly
                style={{ opacity: 0.7 }}
              />
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={handleTestCurrent} disabled={testing} className="btn btn-primary">
            {testing
              ? <><RefreshCw size={14} className="pl-spin" /> Testing…</>
              : 'Test Connection'}
          </button>
          {testResult && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.85rem',
              color: testResult.success ? 'var(--success)' : 'var(--danger)',
            }}>
              {testResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="card mt-6 card-muted">
        <h2 className="card-title">
          <span className="card-title-icon">&#x1F512;</span>
          Configuration
        </h2>
        <p className="card-text">
          Database credentials are stored in the <code>.env</code> file on the backend
          server.  To change them, edit <code>.env</code> and restart the backend.
          SSH machine passwords are stored AES-256-GCM encrypted in the database.
        </p>
      </div>
    </div>
  )
}
