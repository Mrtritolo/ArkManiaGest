/**
 * DatabaseSettingsPage.tsx — MariaDB connections overview.
 *
 * Read-only view of the two database configurations (panel + plugin) sourced
 * from the server .env file, each with its own connectivity test button.
 *
 * When PLUGIN_DB_* is empty in .env the plugin connection transparently
 * falls back to the panel DSN; the page flags this explicitly.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { databaseApi } from '../services/api'
import type { DatabaseConfig, DualDatabaseConfig } from '../types'

type TestTarget = 'panel' | 'plugin'
type TestState = { success: boolean; message: string }

export default function DatabaseSettingsPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DualDatabaseConfig | null>(null)
  const [testing, setTesting] = useState<TestTarget | null>(null)
  const [testResults, setTestResults] = useState<Record<TestTarget, TestState | null>>({
    panel: null,
    plugin: null,
  })

  useEffect(() => { loadConfig() }, [])

  async function loadConfig(): Promise<void> {
    try {
      const res = await databaseApi.get()
      setConfig(res.data)
    } catch { /* silently ignore — page shows "Loading…" */ }
  }

  async function handleTest(target: TestTarget): Promise<void> {
    setTesting(target)
    setTestResults(prev => ({ ...prev, [target]: null }))
    try {
      const res = target === 'panel'
        ? await databaseApi.testCurrent()
        : await databaseApi.testPlugin()
      setTestResults(prev => ({ ...prev, [target]: res.data }))
    } catch (err: unknown) {
      setTestResults(prev => ({
        ...prev,
        [target]: {
          success: false,
          message: err instanceof Error ? err.message : t('database.testFailed'),
        },
      }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Database size={22} /> {t('database.title')}</h1>
          <p className="page-subtitle">{t('database.subtitle')}</p>
        </div>
      </div>

      {config ? (
        <>
          <ConnectionCard
            title={t('database.panelTitle')}
            hint={t('database.panelHint')}
            cfg={config.panel}
            testing={testing === 'panel'}
            testResult={testResults.panel}
            onTest={() => handleTest('panel')}
          />
          <ConnectionCard
            title={t('database.pluginTitle')}
            hint={
              config.plugin_configured
                ? t('database.pluginHintConfigured')
                : t('database.pluginHintFallback')
            }
            cfg={config.plugin}
            testing={testing === 'plugin'}
            testResult={testResults.plugin}
            onTest={() => handleTest('plugin')}
            badge={
              config.plugin_is_separate
                ? { label: t('database.badge.separate'), tone: 'ok' }
                : { label: t('database.badge.shared'), tone: 'warn' }
            }
          />
        </>
      ) : (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        </div>
      )}

      <div className="card mt-6 card-muted">
        <h2 className="card-title">
          <span className="card-title-icon">&#x1F512;</span>
          {t('database.configCard.title')}
        </h2>
        <p
          className="card-text"
          // i18n string contains the <code> tags for inline keys.
          dangerouslySetInnerHTML={{ __html: t('database.configCard.body') }}
        />
      </div>
    </div>
  )
}

// ── Sub-component ─────────────────────────────────────────────────────────────

interface ConnectionCardProps {
  title: string
  hint: string
  cfg: DatabaseConfig
  testing: boolean
  testResult: TestState | null
  onTest: () => void
  badge?: { label: string; tone: 'ok' | 'warn' }
}

function ConnectionCard({ title, hint, cfg, testing, testResult, onTest, badge }: ConnectionCardProps) {
  const { t } = useTranslation()
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          <span className="card-title-icon">&#x25C9;</span>
          {title}
        </h2>
        {badge && (
          <span
            style={{
              fontSize: '0.72rem',
              padding: '0.15rem 0.55rem',
              borderRadius: '999px',
              background: badge.tone === 'ok' ? 'var(--success-bg, #113922)' : 'var(--warning-bg, #3a2e13)',
              color: badge.tone === 'ok' ? 'var(--success)' : 'var(--warning)',
              border: '1px solid currentColor',
            }}
          >
            {badge.label}
          </span>
        )}
      </div>
      <p className="card-text" style={{ marginTop: '0.25rem', fontSize: '0.82rem' }}>{hint}</p>

      <div className="form-grid" style={{ marginTop: '0.75rem' }}>
        <div className="form-group form-group-3">
          <label className="form-label">{t('database.label.host')}</label>
          <input type="text" value={cfg.host} className="form-input" readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group form-group-1">
          <label className="form-label">{t('database.label.port')}</label>
          <input type="text" value={cfg.port} className="form-input" readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group form-group-2">
          <label className="form-label">{t('database.label.name')}</label>
          <input type="text" value={cfg.name} className="form-input" readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group form-group-2">
          <label className="form-label">{t('database.label.user')}</label>
          <input type="text" value={cfg.user} className="form-input" readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group form-group-2">
          <label className="form-label">{t('database.label.password')}</label>
          <input
            type="text"
            value={cfg.has_password ? t('database.passwordMasked') : t('database.passwordMissing')}
            className="form-input"
            readOnly
            style={{ opacity: 0.7 }}
          />
        </div>
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button onClick={onTest} disabled={testing} className="btn btn-primary">
          {testing
            ? <><RefreshCw size={14} className="pl-spin" /> {t('database.testing')}</>
            : t('database.testButton')}
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
  )
}
