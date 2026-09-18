/**
 * ServerForgePage -- ServerForge control dashboard.
 *
 * Shows the machines, the containers (game servers) and the clusters of the
 * linked ServerForge account, with live controls.
 *
 * Role gating mirrors serverforge.py: the API token is admin-only, the
 * container lifecycle needs an operator. The backend stays the authority, and
 * an upstream failure now arrives as a 502 with a readable detail.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Network, RotateCw, Server, TriangleAlert, Zap } from 'lucide-react'

import { sfApi } from '../services/api'
import { extractError } from '../utils/errors'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Meter,
  PageHeader,
  Spinner,
  StatusBadge,
  Switch,
  Tabs,
  useConfirm,
  useToast,
  type RuntimeStatus,
} from '../components/ui'
import type { AuthUser, SFMachine, SFContainer, SFCluster } from '../types'
import styles from './ServerForgePage.module.css'

type Tab = 'containers' | 'machines' | 'clusters'

/** ServerForge status strings -> the kit's runtime statuses. */
function toRuntimeStatus(value: string): RuntimeStatus {
  switch (value) {
    case 'running':
    case 'online':
      return 'online'
    case 'stopped':
    case 'offline':
      return 'offline'
    case 'restarting':
    case 'starting':
      return 'testing'
    case 'error':
    case 'crashed':
      return 'crashed'
    default:
      return 'unknown'
  }
}

interface Props {
  currentUser?: AuthUser | null
}

export default function ServerForgePage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'

  // Config
  const [hasToken, setHasToken] = useState<boolean | null>(null)
  /** The token form is shown while there is no token, or when an admin opens it. */
  const [editingToken, setEditingToken] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)
  const [tokenTestResult, setTokenTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Data
  const [machines, setMachines] = useState<SFMachine[]>([])
  const [containers, setContainers] = useState<SFContainer[]>([])
  const [clusters, setClusters] = useState<SFCluster[]>([])
  // Starts true: the dashboard is only reachable with a token, and the token
  // check is followed immediately by the first load.
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  // null = no error; '' = the upstream failed without a detail.
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('containers')

  // The acting container and what is being done to it, so the spinner lands on
  // the button that was pressed rather than on its neighbour.
  const [busyAction, setBusyAction] = useState<{ id: number; kind: 'start' | 'stop' | 'restart' } | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  // Bumped after a successful token save. A replacement token leaves hasToken
  // true, so the load effect needs a trigger of its own or the dashboard would
  // keep showing the previous account's machines and servers.
  const [reloadTick, setReloadTick] = useState(0)

  // Tracks the post-action delayed reload so it can be cancelled on unmount
  // (the timer would otherwise fire after navigation away).
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [mRes, cRes, clRes] = await Promise.allSettled([
      sfApi.machines(),
      sfApi.containers(),
      sfApi.clusters(),
    ])
    if (mRes.status === 'fulfilled') setMachines(mRes.value.data.data || [])
    if (cRes.status === 'fulfilled') setContainers(cRes.value.data.data || [])
    if (clRes.status === 'fulfilled') setClusters(clRes.value.data.data || [])
    // allSettled never rejects: surface the first failure, otherwise an
    // unreachable ServerForge reads as "no servers". The previous lists stay.
    const failed = [mRes, cRes, clRes].find(r => r.status === 'rejected')
    setError(failed ? extractError(failed.reason, '') : null)
    setLoading(false)
    setLoaded(true)
    // No dependency on `t`: a language switch must not re-poll ServerForge.
  }, [])

  useEffect(() => {
    let alive = true
    sfApi.getConfig()
      .then(res => { if (alive) { setHasToken(res.data.has_token); setEditingToken(!res.data.has_token) } })
      .catch(() => { if (alive) { setHasToken(false); setEditingToken(true) } })
    return () => { alive = false }
  }, [])

  useEffect(() => () => { if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current) }, [])

  // One place decides when the dashboard fetches, so the lists can never be
  // left waiting on a load nobody started. The first token and a replacement
  // token both land here: React batches the two setState calls of a save, so
  // that still fetches exactly once.
  useEffect(() => {
    if (hasToken) loadAll()
  }, [hasToken, reloadTick, loadAll])

  useEffect(() => {
    if (!hasToken || !autoRefresh || editingToken) return
    // Pause polling while the tab is hidden (long-lived admin sessions would
    // otherwise burn ~120 idle requests per hour per open tab).
    const interval = setInterval(() => { if (!document.hidden) loadAll(true) }, 30000)
    const onVisible = () => { if (!document.hidden) loadAll(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hasToken, autoRefresh, editingToken, loadAll])

  async function handleSaveToken() {
    if (!tokenInput.trim()) return
    setTokenSaving(true)
    setTokenTestResult(null)
    try {
      await sfApi.updateConfig(tokenInput.trim())
      // Leave the form only once the token works: a rejected token would
      // otherwise strand the dashboard on an empty list.
      const test = await sfApi.testToken()
      setTokenTestResult(test.data)
      if (test.data.success) {
        setTokenInput('')
        setHasToken(true)
        setEditingToken(false)
        // The lists on screen were fetched with the previous token.
        setReloadTick(n => n + 1)
      }
    } catch (err) {
      setTokenTestResult({ success: false, message: extractError(err, t('serverForge.tokenSaveFailed')) })
    } finally {
      setTokenSaving(false)
    }
  }

  async function handleContainerAction(c: SFContainer, action: 'start' | 'stop' | 'restart') {
    const label = c.label || c.container_name
    // Start brings a server up; stop and restart take players off it.
    if (action !== 'start') {
      const ok = await confirm({
        title: t(`serverForge.confirm.${action}`, { label }),
        description: t('serverForge.confirm.body', { label }),
        confirmLabel: t(`serverForge.container.${action}Label`),
        tone: 'danger',
      })
      if (!ok) return
    }

    setBusyAction({ id: c.id, kind: action })
    try {
      if (action === 'start') await sfApi.startContainer(c.id)
      else if (action === 'stop') await sfApi.stopContainer(c.id)
      else await sfApi.restartContainer(c.id)

      const msgKey = action === 'start' ? 'startSent' : action === 'stop' ? 'stopSent' : 'restartSent'
      toast.success(t(`serverForge.action.${msgKey}`, { label }))
      // Reload after a couple of seconds to give the server time to update.
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = setTimeout(() => loadAll(true), 3000)
    } catch (err) {
      // 409 = not configured, 502 = the upstream refused or failed.
      toast.error(t('serverForge.errorPrefix', { detail: extractError(err, t('serverForge.actionFailed')) }))
    } finally {
      setBusyAction(null)
    }
  }

  // ====== RENDER: token configuration ======
  if (hasToken === null) {
    return (
      <div className="l-page">
        <Card><Spinner block label={t('serverForge.loading')} /></Card>
      </div>
    )
  }

  if (editingToken) {
    return (
      <div className="l-page">
        <PageHeader
          title={t('serverForge.heading')}
          icon={Zap}
          description={t('serverForge.tokenSubtitle')}
        />
        <Card title={t('serverForge.tokenCardTitle')} icon={Zap}>
          <div className="l-stack">
            <p className="u-secondary">{t('serverForge.tokenCardBody')}</p>
            {/* PUT /sf/config is admin-only: other roles get the reason, not a form that 403s. */}
            {!isAdmin ? (
              <Alert tone="info">{t('serverForge.tokenAdminOnly')}</Alert>
            ) : (
              <>
                <Field label={t('serverForge.tokenLabel')}>
                  <Input
                    type="password"
                    revealable
                    autoComplete="off"
                    value={tokenInput}
                    placeholder={t('serverForge.tokenPlaceholder')}
                    onChange={e => setTokenInput(e.target.value)}
                  />
                </Field>
                {tokenTestResult && (
                  <Alert tone={tokenTestResult.success ? 'success' : 'danger'}>
                    {tokenTestResult.message}
                  </Alert>
                )}
                <div className="l-cluster">
                  <Button
                    variant="primary"
                    loading={tokenSaving}
                    loadingLabel={t('serverForge.tokenSaving')}
                    disabled={!tokenInput.trim()}
                    onClick={handleSaveToken}
                  >
                    {t('serverForge.tokenSaveTest')}
                  </Button>
                  {/* Only offered when a working token is already stored. */}
                  {hasToken && (
                    <Button
                      variant="ghost"
                      disabled={tokenSaving}
                      onClick={() => { setEditingToken(false); setTokenInput(''); setTokenTestResult(null) }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // ====== RENDER: dashboard ======
  const runningCount = containers.filter(c => c.status === 'running').length
  const stoppedCount = containers.filter(c => c.status === 'stopped').length
  const updatesCount = containers.filter(c => c.update_available).length
  const firstLoad = !loaded && loading

  return (
    <div className="l-page">
      <PageHeader
        title={t('serverForge.heading')}
        icon={Zap}
        description={
          <span className="l-cluster">
            <span>
              {t('serverForge.subtitle', { total: containers.length, running: runningCount, stopped: stoppedCount })}
            </span>
            {updatesCount > 0 && (
              <Badge tone="warning" icon={TriangleAlert}>
                {t('serverForge.updatesBadge', { count: updatesCount })}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            <Switch
              label={t('serverForge.autoRefresh')}
              checked={autoRefresh}
              onChange={setAutoRefresh}
            />
            <Button
              size="sm"
              icon={RotateCw}
              loading={loading}
              loadingLabel={t('serverForge.refreshLoading')}
              onClick={() => loadAll()}
            >
              {t('serverForge.refresh')}
            </Button>
          </>
        }
      />

      {/* A load failure stays until it is read or the next load clears it. */}
      {error !== null && (
        <Alert
          tone="danger"
          title={t('serverForge.loadFailed')}
          onDismiss={() => setError(null)}
          actions={<Button size="sm" icon={RotateCw} onClick={() => loadAll()}>{t('common.retry')}</Button>}
        >
          {error ? t('serverForge.errorPrefix', { detail: error }) : undefined}
        </Alert>
      )}

      {machines.length > 0 && (
        <div className="l-grid--cards">
          {machines.map(m => (
            <Card key={m.id} titleAs="h3" title={m.hostname || m.ip_address || t('serverForge.machine.fallback', { id: m.id })}
              actions={<StatusBadge status={toRuntimeStatus(m.status)} label={m.status} />}>
              <div className="l-stack l-stack--sm">
                <div className={styles.gauges}>
                  <Gauge host={m} metric="cpu" label="CPU" value={m.cpu_usage_percent} />
                  <Gauge host={m} metric="ram" label="RAM" value={m.ram_usage_percent} />
                  <Gauge host={m} metric="disk" label={t('serverForge.gauge.disk')} value={m.disk_usage_percent} />
                </div>
                <p className={styles.meta}>
                  {t('serverForge.machine.locationCount', { location: m.location, count: m.containers_count })}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Tabs
        label={t('serverForge.tabsLabel')}
        value={activeTab}
        onChange={id => setActiveTab(id as Tab)}
        items={[
          { id: 'containers', label: t('serverForge.tab.containers'), icon: Server, count: containers.length },
          { id: 'machines', label: t('serverForge.tab.machines'), icon: Boxes, count: machines.length },
          { id: 'clusters', label: t('serverForge.tab.clusters'), icon: Network, count: clusters.length },
        ]}
      >
        {activeTab === 'containers' && (
          firstLoad ? (
            <Spinner block label={t('serverForge.loadingServers')} />
          ) : containers.length === 0 ? (
            <EmptyState icon={Server} title={t('serverForge.empty.noServers')} />
          ) : (
            <div className="l-grid--cards">
              {containers.map(c => (
                <Card
                  key={c.id}
                  titleAs="h3"
                  title={c.label || c.container_name}
                  actions={<StatusBadge status={toRuntimeStatus(c.status)} label={c.status} />}
                >
                  <div className="l-stack l-stack--sm">
                    <p className="u-secondary u-text-sm">{c.map_name || t('serverForge.container.mapFallback')}</p>
                    <dl className="ui-dl">
                      <dt>{t('serverForge.container.portLabel')}</dt>
                      <dd className="u-mono u-num">{c.server_port ?? t('serverForge.gauge.placeholder')}</dd>
                      <dt>{t('serverForge.container.rconLabel')}</dt>
                      <dd className="u-mono u-num">{c.rcon_port ?? t('serverForge.gauge.placeholder')}</dd>
                      <dt>{t('serverForge.container.uptimeLabel')}</dt>
                      <dd className="u-num">{c.formatted_uptime || t('serverForge.gauge.placeholder')}</dd>
                      <dt>{t('serverForge.container.playersLabel')}</dt>
                      <dd className="u-num">{c.max_players ?? t('serverForge.gauge.placeholder')}</dd>
                    </dl>
                    {c.update_available && (
                      <span>
                        <Badge tone="warning" icon={TriangleAlert}>
                          {t('serverForge.container.updateAvailable')}
                        </Badge>
                      </span>
                    )}
                    {c.cluster && (
                      <p className="u-muted u-text-sm">
                        {t('serverForge.container.clusterLine', { name: c.cluster.name })}
                      </p>
                    )}
                    {canOperate && (
                      <div className="l-cluster">
                        {/* One action per container at a time: the pressed
                            button spins, its neighbour is only disabled. */}
                        {c.status === 'stopped' ? (
                          <Button
                            size="sm"
                            loading={busyAction?.id === c.id && busyAction.kind === 'start'}
                            loadingLabel={t('serverForge.container.working')}
                            disabled={busyAction?.id === c.id}
                            onClick={() => handleContainerAction(c, 'start')}
                          >
                            {t('serverForge.container.startLabel')}
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              loading={busyAction?.id === c.id && busyAction.kind === 'restart'}
                              loadingLabel={t('serverForge.container.working')}
                              disabled={busyAction?.id === c.id}
                              onClick={() => handleContainerAction(c, 'restart')}
                            >
                              {t('serverForge.container.restartLabel')}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              className="u-push"
                              loading={busyAction?.id === c.id && busyAction.kind === 'stop'}
                              loadingLabel={t('serverForge.container.working')}
                              disabled={busyAction?.id === c.id}
                              onClick={() => handleContainerAction(c, 'stop')}
                            >
                              {t('serverForge.container.stopLabel')}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {activeTab === 'machines' && (
          firstLoad ? (
            <Spinner block label={t('serverForge.loading')} />
          ) : machines.length === 0 ? (
            <EmptyState icon={Boxes} title={t('serverForge.empty.noMachines')} />
          ) : (
            <div className="l-grid--cards">
              {machines.map(m => (
                <Card
                  key={m.id}
                  titleAs="h3"
                  title={m.hostname || m.ip_address || t('serverForge.machine.fallback', { id: m.id })}
                  actions={<StatusBadge status={toRuntimeStatus(m.status)} label={m.status} />}
                >
                  <div className="l-stack l-stack--sm">
                    <div className={styles.gauges}>
                      <Gauge host={m} metric="cpu" label="CPU" value={m.cpu_usage_percent} />
                      <Gauge
                        host={m}
                        metric="ram"
                        label="RAM"
                        value={m.ram_usage_percent}
                        detail={m.ram_used_gb && m.ram_total_gb ? `${m.ram_used_gb} / ${m.ram_total_gb} GB` : undefined}
                      />
                      <Gauge
                        host={m}
                        metric="disk"
                        label={t('serverForge.gauge.disk')}
                        value={m.disk_usage_percent}
                        detail={m.disk_used_gb && m.disk_total_gb ? `${m.disk_used_gb} / ${m.disk_total_gb} GB` : undefined}
                      />
                    </div>
                    <p className={styles.meta}>
                      <span>
                        {t('serverForge.machine.ipLabel')}{' '}
                        <span className="u-mono">{m.ip_address || t('serverForge.ipFallback')}</span>
                      </span>
                      <span>{t('serverForge.machine.osLabel', { os: m.os })}</span>
                      <span>{t('serverForge.machine.locationLabel', { location: m.location })}</span>
                      <span>{t('serverForge.machine.countsLine', { containers: m.containers_count, clusters: m.clusters_count })}</span>
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {activeTab === 'clusters' && (
          firstLoad ? (
            <Spinner block label={t('serverForge.loading')} />
          ) : clusters.length === 0 ? (
            <EmptyState icon={Network} title={t('serverForge.empty.noClusters')} />
          ) : (
            <div className="l-grid--cards">
              {clusters.map(cl => (
                <Card key={cl.id} titleAs="h3" title={cl.name}>
                  <p className={styles.meta}>
                    <span>{t('serverForge.cluster.serverCount', { count: cl.containers_count })}</span>
                    {cl.sync_enabled && <Badge tone="success">{t('serverForge.cluster.syncActive')}</Badge>}
                    {cl.machine && (
                      <span>{t('serverForge.cluster.hostLabel', { host: cl.machine.hostname || cl.machine.ip_address })}</span>
                    )}
                  </p>
                </Card>
              ))}
            </div>
          )
        )}
      </Tabs>

      {isAdmin && (
        <div className="l-cluster l-cluster--end">
          <Button size="sm" variant="ghost" onClick={() => setEditingToken(true)}>
            {t('serverForge.editTokenBtn')}
          </Button>
        </div>
      )}
    </div>
  )
}

// ====== Sub-components ======

/** One resource gauge: the number is always printed next to the bar. */
function Gauge({
  host, metric, label, value, detail,
}: {
  host: SFMachine
  metric: 'cpu' | 'ram' | 'disk'
  label: string
  value: string | null
  detail?: string
}) {
  const { t } = useTranslation()
  const pct = value === null ? null : parseFloat(value)
  const shown = pct === null || Number.isNaN(pct) ? null : Math.min(Math.max(pct, 0), 100)
  const tone = shown === null ? 'accent' : shown > 85 ? 'danger' : shown > 60 ? 'warning' : 'accent'
  const hostName = host.hostname || host.ip_address || t('serverForge.machine.fallback', { id: host.id })
  const text = shown === null
    ? t('serverForge.gauge.placeholder')
    : t('serverForge.gauge.percent', { value })

  return (
    <div className={styles.gauge}>
      <span className={styles.gaugeHead}>
        <span>{label}</span>
        <span className={styles.gaugeValue}>{text}</span>
      </span>
      <Meter
        value={shown ?? 0}
        tone={tone}
        label={t(`serverForge.gauge.aria.${metric}`, { host: hostName })}
        valueText={text}
      />
      {detail && <span className={styles.gaugeDetail}>{detail}</span>}
    </div>
  )
}
