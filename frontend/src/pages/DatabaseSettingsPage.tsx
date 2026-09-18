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
import { Trans, useTranslation } from 'react-i18next'
import { Database, Lock, Plug, RotateCw, Split, TriangleAlert } from 'lucide-react'
import { databaseApi } from '../services/api'
import { extractError } from '../utils/errors'
import { usePending } from '../hooks/usePending'
import type { AuthUser, DatabaseConfig, DualDatabaseConfig } from '../types'
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../components/ui'

type TestTarget = 'panel' | 'plugin'
type TestState = { success: boolean; message: string }

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only and
  // the database endpoints are require_admin server side.
  currentUser?: AuthUser | null
}

export default function DatabaseSettingsPage(_props: Props) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DualDatabaseConfig | null>(null)
  // Separate from `config`: the page must stop saying "loading" once the
  // request has settled, whether it succeeded or not.
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const pending = usePending<TestTarget>()
  const [testResults, setTestResults] = useState<Record<TestTarget, TestState | null>>({
    panel: null,
    plugin: null,
  })

  useEffect(() => { loadConfig() }, [])

  async function loadConfig(): Promise<void> {
    setLoading(true)
    setLoadError('')
    try {
      const res = await databaseApi.get()
      setConfig(res.data)
    } catch (err: unknown) {
      // Without this the page stayed on "Loading…" forever.
      setLoadError(extractError(err, t('database.loadFailed')))
    } finally {
      setLoading(false)
    }
  }

  async function handleTest(target: TestTarget): Promise<void> {
    setTestResults(prev => ({ ...prev, [target]: null }))
    await pending.run(target, async () => {
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
            message: extractError(err, t('database.testFailed')),
          },
        }))
      }
    })
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t('database.title')}
        icon={Database}
        description={t('database.subtitle')}
      />

      {loadError && (
        <Alert
          tone="danger"
          title={t('database.loadFailed')}
          actions={
            <Button size="sm" icon={RotateCw} onClick={loadConfig}>
              {t('common.retry')}
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {loading && !config && (
        <Card>
          <Spinner block label={t('common.loading')} />
        </Card>
      )}

      {config && (
        <>
          <ConnectionCard
            title={t('database.panelTitle')}
            hint={t('database.panelHint')}
            cfg={config.panel}
            testing={pending.isPending('panel')}
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
            testing={pending.isPending('plugin')}
            testResult={testResults.plugin}
            onTest={() => handleTest('plugin')}
            badge={
              config.plugin_is_separate
                ? { label: t('database.badge.separate'), tone: 'ok' }
                : { label: t('database.badge.shared'), tone: 'warn' }
            }
          />
        </>
      )}

      <Card title={t('database.configCard.title')} icon={Lock}>
        <p>
          {/* The i18n string carries <code> tags around the .env keys. */}
          <Trans i18nKey="database.configCard.body" components={{ code: <code className="ui-code" /> }} />
        </p>
      </Card>
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
    <Card
      title={title}
      icon={Database}
      actions={
        badge ? (
          <Badge
            tone={badge.tone === 'ok' ? 'success' : 'warning'}
            icon={badge.tone === 'ok' ? Split : TriangleAlert}
          >
            {badge.label}
          </Badge>
        ) : undefined
      }
      footer={
        <div className="l-cluster">
          <Button
            variant="primary"
            icon={Plug}
            onClick={onTest}
            loading={testing}
            loadingLabel={t('database.testing')}
          >
            {t('database.testButton')}
          </Button>
        </div>
      }
    >
      <div className="l-stack">
        <p className="u-secondary">{hint}</p>

        {/* Read-only values: a dl, not dimmed inputs nobody can edit. */}
        <dl className="ui-dl">
          <dt>{t('database.label.host')}</dt>
          <dd className="u-mono">{cfg.host}</dd>
          <dt>{t('database.label.port')}</dt>
          <dd className="u-mono u-num">{cfg.port}</dd>
          <dt>{t('database.label.name')}</dt>
          <dd className="u-mono">{cfg.name}</dd>
          <dt>{t('database.label.user')}</dt>
          <dd className="u-mono">{cfg.user}</dd>
          <dt>{t('database.label.password')}</dt>
          <dd className="u-mono">
            {cfg.has_password ? t('database.passwordMasked') : t('database.passwordMissing')}
          </dd>
        </dl>

        {testResult && (
          <Alert tone={testResult.success ? 'success' : 'danger'}>{testResult.message}</Alert>
        )}
      </div>
    </Card>
  )
}
