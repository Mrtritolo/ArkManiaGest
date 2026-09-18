/**
 * GeneralSettingsPage.tsx — Global application settings.
 *
 * Covers: application name, log level, auto-backup configuration, the
 * release check and the in-UI self-updater.
 *
 * A failed settings load blocks Save: the form is never shown filled with
 * placeholder defaults, because saving them would overwrite every setting.
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  Archive,
  CircleAlert,
  CircleCheck,
  Download,
  DownloadCloud,
  ExternalLink,
  Info,
  RefreshCw,
  RotateCw,
  Settings,
} from 'lucide-react'
import { settingsApi, systemApi, systemUpdateApi } from '../services/api'
import type { SystemUpdatePreflight, SystemUpdateStatus } from '../services/api'
import { extractError } from '../utils/errors'
import { fmtLocaleDateTime } from '../utils/format'
import type { AppSettings, AuthUser, VersionCheckResult } from '../types'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Meter,
  NotAvailable,
  PageHeader,
  Select,
  Spinner,
  buttonClass,
  useConfirm,
  useToast,
} from '../components/ui'
import styles from './GeneralSettingsPage.module.css'

interface HealthInfo {
  version: string
  db_ready: boolean
}

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const

/** The save bar sits outside the <form>, so its button points back at it. */
const FORM_ID = 'general-settings-form'

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only, and
  // the settings write and system update endpoints are admin-only.
  currentUser?: AuthUser | null
}

export default function GeneralSettingsPage(_props: Props) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({
    app_name:               'ArkManiaGest',
    log_level:              'INFO',
    auto_backup:            true,
    backup_interval_hours:  6,
    backup_retention:       10,
  })
  const [saving, setSaving]   = useState(false)
  const [health, setHealth]   = useState<HealthInfo | null>(null)

  const [versionInfo, setVersionInfo]   = useState<VersionCheckResult | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)

  // Self-update state (button, preflight banner, progress panel).
  const [preflight, setPreflight]     = useState<SystemUpdatePreflight | null>(null)
  const [installing, setInstalling]   = useState(false)
  const [updateStatus, setUpdateStatus] = useState<SystemUpdateStatus | null>(null)
  const [installError, setInstallError] = useState('')
  const pollRef = useRef<number | null>(null)

  useEffect(() => { loadSettings(); loadHealth(); loadVersion(false); loadPreflight() }, [])

  // Stop polling when the component unmounts.
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  async function loadPreflight(): Promise<void> {
    try {
      const res = await systemUpdateApi.preflight()
      setPreflight(res.data)
    } catch {
      setPreflight(null)
    }
  }

  async function pollUpdateStatus(): Promise<void> {
    try {
      const res = await systemUpdateApi.status()
      setUpdateStatus(res.data)
      // Re-check the installed version whenever the state says "success".
      // The server-update.sh restart usually takes 10-20s, during which
      // the status endpoint may be briefly unreachable (503).  loadHealth
      // below picks up the new version as soon as the backend is back up.
      if (res.data.state === 'success' || res.data.state === 'failed') {
        if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null }
        setInstalling(false)
        loadHealth()
        loadVersion(true)
      }
    } catch {
      // 401 / 503 during the restart window -- keep polling.
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    setInstallError('')
    if (!preflight?.can_self_update) {
      setInstallError(preflight?.hint || t('generalSettings.updates.installDisabled'))
      return
    }
    const version = versionInfo?.latest ?? '?'
    const ok = await confirm({
      title: t('generalSettings.updates.confirmTitle', { version }),
      description: (
        <span className={styles.preLine}>
          {t('generalSettings.updates.confirmInstall', { version })}
        </span>
      ),
      confirmLabel: t('generalSettings.updates.installNow'),
    })
    if (!ok) return

    setInstalling(true)
    setUpdateStatus({
      state: 'downloading',
      target_version: versionInfo?.latest ?? null,
      started_at: new Date().toISOString(),
      finished_at: null,
      message: t('generalSettings.updates.starting'),
      progress_pct: 5,
      log_tail: null,
    })

    try {
      await systemUpdateApi.install()
      // Poll every 3s until the state becomes terminal.  The status path
      // is rate-limit-exempt on the backend, so 3s is just a courtesy to
      // avoid churn on the UI side.
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(pollUpdateStatus, 3000)
      // Kick one immediate poll so the UI updates right away.
      pollUpdateStatus()
    } catch (err: unknown) {
      setInstallError(extractError(err, t('generalSettings.updates.installFailed')))
      setInstalling(false)
    }
  }

  async function loadVersion(force: boolean): Promise<void> {
    setVersionLoading(true)
    try {
      const res = await settingsApi.checkVersion(force)
      setVersionInfo(res.data)
    } catch (err: unknown) {
      const detail = extractError(err, t('generalSettings.updates.checkFailed'))
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
      const { data } = await systemApi.health()
      setHealth(data)
    } catch { /* keep null */ }
  }

  async function loadSettings(): Promise<void> {
    setSettingsLoading(true)
    setLoadError('')
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
    } catch (err: unknown) {
      // Save stays blocked until this succeeds: the placeholder defaults
      // below would overwrite every setting if they were ever sent.
      setLoadError(extractError(err, t('generalSettings.loadFailed')))
    } finally {
      setSettingsLoading(false)
    }
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

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!settings) return
    setSaving(true)
    try {
      const res = await settingsApi.update(form)
      setSettings(res.data)
      toast.success(t('generalSettings.saved'))
    } catch (err: unknown) {
      toast.error(extractError(err, t('generalSettings.saveFailed')), {
        title: t('generalSettings.errorPrefix'),
      })
    } finally {
      setSaving(false)
    }
  }

  const state = updateStatus?.state
  const installDisabledReason = preflight?.can_self_update
    ? undefined
    : preflight?.hint || t('generalSettings.updates.installDisabled')

  return (
    <div className="l-page">
      <PageHeader
        title={t('generalSettings.title')}
        icon={Settings}
        description={t('generalSettings.subtitle')}
      />

      {loadError && (
        <Alert
          tone="danger"
          title={t('generalSettings.loadFailed')}
          actions={
            <Button size="sm" icon={RotateCw} onClick={loadSettings}>
              {t('common.retry')}
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {settingsLoading && !settings && (
        <Card>
          <Spinner block label={t('common.loading')} />
        </Card>
      )}

      {settings && (
        <form id={FORM_ID} className="l-stack" onSubmit={handleSave} noValidate>
          <Card title={t('generalSettings.section.app')} icon={AppWindow}>
            <div className="l-grid--form">
              <Field label={t('generalSettings.field.appName')} hint={t('generalSettings.hint.appName')}>
                <Input name="app_name" value={form.app_name} onChange={handleChange} />
              </Field>
              <Field label={t('generalSettings.field.logLevel')} hint={t('generalSettings.hint.logLevel')}>
                <Select name="log_level" value={form.log_level} onChange={handleChange}>
                  {LOG_LEVELS.map(level => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title={t('generalSettings.section.backup')} icon={Archive}>
            <div className="l-grid--form">
              <Checkbox
                className="u-span-full"
                name="auto_backup"
                label={t('generalSettings.field.autoBackup')}
                description={t('generalSettings.hint.autoBackup')}
                checked={form.auto_backup}
                onChange={handleChange}
              />

              {form.auto_backup && (
                <>
                  <Field label={t('generalSettings.field.interval')} hint={t('generalSettings.hint.interval')}>
                    <Input
                      type="number" name="backup_interval_hours" min={1} max={168}
                      value={form.backup_interval_hours} onChange={handleChange}
                    />
                  </Field>
                  <Field label={t('generalSettings.field.retention')} hint={t('generalSettings.hint.retention')}>
                    <Input
                      type="number" name="backup_retention" min={1} max={100}
                      value={form.backup_retention} onChange={handleChange}
                    />
                  </Field>
                </>
              )}
            </div>
          </Card>
        </form>
      )}

      {/* Updates */}
      <Card
        title={t('generalSettings.updates.section')}
        icon={Download}
        actions={
          <>
            <Button
              size="sm"
              icon={RotateCw}
              onClick={() => loadVersion(true)}
              loading={versionLoading}
              loadingLabel={t('generalSettings.updates.checking')}
              disabled={installing}
            >
              {t('generalSettings.updates.checkNow')}
            </Button>
            {versionInfo?.update_available && (
              <Button
                size="sm"
                variant="primary"
                icon={DownloadCloud}
                onClick={handleInstallUpdate}
                loading={installing}
                loadingLabel={t('generalSettings.updates.installing')}
                disabled={!preflight?.can_self_update}
                title={installDisabledReason}
              >
                {t('generalSettings.updates.installNow')}
              </Button>
            )}
            {versionInfo?.release_url && (
              <a
                href={versionInfo.release_url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('generalSettings.updates.viewRelease')}
              </a>
            )}
          </>
        }
      >
        <div className="l-stack">
          <dl className="ui-dl">
            <dt>{t('generalSettings.updates.current')}</dt>
            <dd className="u-mono">
              {versionInfo?.current || health?.version || <NotAvailable />}
            </dd>
            {versionInfo?.current_commit && (
              <>
                <dt>{t('generalSettings.updates.commit')}</dt>
                <dd className="u-mono">{versionInfo.current_commit.substring(0, 8)}</dd>
              </>
            )}
            <dt>{t('generalSettings.updates.latest')}</dt>
            <dd className="u-mono">{versionInfo?.latest || <NotAvailable />}</dd>
          </dl>

          {versionInfo?.release_published_at && (
            <p className="u-muted u-text-sm">
              {t('generalSettings.updates.publishedAt', {
                when: fmtLocaleDateTime(versionInfo.release_published_at),
              })}
            </p>
          )}

          {versionInfo?.error ? (
            <Alert tone="danger">
              {t('generalSettings.updates.error', { message: versionInfo.error })}
            </Alert>
          ) : versionInfo?.update_available && versionInfo.latest ? (
            <p>
              <Badge tone="warning" icon={Download}>
                {t('generalSettings.updates.updateAvailable', { version: versionInfo.latest })}
              </Badge>
            </p>
          ) : versionInfo?.latest ? (
            <p>
              <Badge tone="success" icon={CircleCheck}>
                {t('generalSettings.updates.upToDate')}
              </Badge>
            </p>
          ) : null}

          <p className="u-muted u-text-sm">{t('generalSettings.updates.cacheHint')}</p>

          {/* Shown only when the in-UI installer is NOT usable on this host
              (no sudoers, missing script, no repo). */}
          {preflight && !preflight.can_self_update && (
            <Alert tone="warning" title={t('generalSettings.updates.inUpdaterUnavailable')}>
              {preflight.hint || t('generalSettings.updates.inUpdaterGenericFix')}
            </Alert>
          )}

          {installError && <Alert tone="danger">{installError}</Alert>}

          {/* Live progress -- visible while an install is running, and after
              it finished until the page is reloaded. */}
          {updateStatus && state && state !== 'idle' && (
            <div className="l-stack l-stack--sm">
              <div className="l-cluster">
                <Badge
                  tone={state === 'success' ? 'success' : state === 'failed' ? 'danger' : 'info'}
                  icon={state === 'success' ? CircleCheck : state === 'failed' ? CircleAlert : RefreshCw}
                >
                  {t(`generalSettings.updates.stateLabel.${state}`)}
                </Badge>
                {updateStatus.target_version && (
                  <span className="u-mono u-secondary u-text-sm">v{updateStatus.target_version}</span>
                )}
              </div>

              {typeof updateStatus.progress_pct === 'number' && (
                <div className="l-cluster">
                  <Meter
                    className={styles.meter}
                    kind="progress"
                    value={updateStatus.progress_pct}
                    label={t('generalSettings.updates.progressLabel')}
                    valueText={t('generalSettings.updates.progressValue', { pct: updateStatus.progress_pct })}
                    tone={state === 'success' ? 'success' : state === 'failed' ? 'danger' : 'accent'}
                  />
                  <span className="u-num u-text-sm u-secondary">
                    {t('generalSettings.updates.progressValue', { pct: updateStatus.progress_pct })}
                  </span>
                </div>
              )}

              {updateStatus.message && (
                <p className="u-secondary u-text-sm">{updateStatus.message}</p>
              )}

              {updateStatus.log_tail && (
                <pre
                  className={`ui-log ${styles.logTail}`}
                  role="log"
                  aria-label={t('generalSettings.updates.logLabel')}
                  tabIndex={0}
                >
                  {updateStatus.log_tail}
                </pre>
              )}

              {state === 'running' && (
                <p className="u-muted u-text-sm">{t('generalSettings.updates.duringRestartHint')}</p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* System info */}
      <Card title={t('generalSettings.section.system')} icon={Info}>
        <dl className="ui-dl">
          <dt>{t('generalSettings.info.version')}</dt>
          <dd className="u-mono">{health?.version || <NotAvailable />}</dd>
          <dt>{t('generalSettings.info.database')}</dt>
          <dd>
            {health
              ? health.db_ready
                ? t('generalSettings.info.dbConnected')
                : t('generalSettings.info.dbOffline')
              : <NotAvailable />}
          </dd>
          <dt>{t('generalSettings.info.backend')}</dt>
          <dd>FastAPI + Python</dd>
          <dt>{t('generalSettings.info.configStorage')}</dt>
          <dd>DB + .env (AES-256-GCM)</dd>
        </dl>
      </Card>

      {/* Save bar */}
      <div className="ui-actionbar">
        <Button
          className="u-push"
          type="submit"
          form={FORM_ID}
          variant="primary"
          loading={saving}
          loadingLabel={t('generalSettings.saving')}
          disabled={!settings}
          // Saving the placeholder defaults would overwrite every setting.
          title={!settings && loadError ? loadError : undefined}
        >
          {t('generalSettings.save')}
        </Button>
      </div>
    </div>
  )
}
