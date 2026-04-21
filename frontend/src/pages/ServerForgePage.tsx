/**
 * ServerForgePage — ServerForge control dashboard.
 * Displays machines, containers (game servers) and clusters with live controls.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { sfApi } from '../services/api'
import type { SFMachine, SFContainer, SFCluster } from '../types'

type Tab = 'containers' | 'machines' | 'clusters'

export default function ServerForgePage() {
  const { t } = useTranslation()
  // Config
  const [hasToken, setHasToken] = useState<boolean | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)
  const [tokenTestResult, setTokenTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Data
  const [machines, setMachines] = useState<SFMachine[]>([])
  const [containers, setContainers] = useState<SFContainer[]>([])
  const [clusters, setClusters] = useState<SFCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('containers')

  // Actions
  const [actionId, setActionId] = useState<number | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionIsError, setActionIsError] = useState(false)

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => { checkConfig() }, [])

  useEffect(() => {
    if (!hasToken || !autoRefresh) return
    const interval = setInterval(() => loadAll(true), 30000)
    return () => clearInterval(interval)
  }, [hasToken, autoRefresh])

  useEffect(() => {
    if (actionMsg) {
      const timer = setTimeout(() => setActionMsg(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [actionMsg])

  async function checkConfig() {
    try {
      const res = await sfApi.getConfig()
      setHasToken(res.data.has_token)
      if (res.data.has_token) loadAll()
    } catch {
      setHasToken(false)
    }
  }

  async function handleSaveToken() {
    if (!tokenInput.trim()) return
    setTokenSaving(true)
    setTokenTestResult(null)
    try {
      await sfApi.updateConfig(tokenInput.trim())
      setHasToken(true)
      setTokenInput('')
      // Test automatico
      const test = await sfApi.testToken()
      setTokenTestResult(test.data)
      if (test.data.success) loadAll()
    } catch (err: any) {
      setTokenTestResult({ success: false, message: err.message })
    } finally {
      setTokenSaving(false)
    }
  }

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [mRes, cRes, clRes] = await Promise.allSettled([
        sfApi.machines(),
        sfApi.containers(),
        sfApi.clusters(),
      ])
      if (mRes.status === 'fulfilled') setMachines(mRes.value.data.data || [])
      if (cRes.status === 'fulfilled') setContainers(cRes.value.data.data || [])
      if (clRes.status === 'fulfilled') setClusters(clRes.value.data.data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleContainerAction(id: number, action: 'start' | 'stop' | 'restart', label: string) {
    const confirmKey = action === 'start' ? 'serverForge.confirm.start' : action === 'stop' ? 'serverForge.confirm.stop' : 'serverForge.confirm.restart'
    if (!confirm(t(confirmKey, { label }))) return

    setActionId(id)
    try {
      if (action === 'start') await sfApi.startContainer(id)
      else if (action === 'stop') await sfApi.stopContainer(id)
      else await sfApi.restartContainer(id)

      const msgKey = action === 'start' ? 'serverForge.action.startSent' : action === 'stop' ? 'serverForge.action.stopSent' : 'serverForge.action.restartSent'
      setActionIsError(false)
      setActionMsg(t(msgKey, { label }))
      // Reload after a couple of seconds to give the server time to update
      setTimeout(() => loadAll(true), 3000)
    } catch (err: any) {
      setActionIsError(true)
      setActionMsg(t('serverForge.errorPrefix', { detail: err.response?.data?.detail || err.message }))
    } finally {
      setActionId(null)
    }
  }

  // ====== RENDER: Token config ======
  if (hasToken === false) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">{t('serverForge.heading')}</h1>
          <p className="page-subtitle">{t('serverForge.tokenSubtitle')}</p>
        </div>
        <div className="card">
          <h2 className="card-title"><span className="card-title-icon">&#x26A1;</span> {t('serverForge.tokenCardTitle')}</h2>
          <p className="card-text">
            {t('serverForge.tokenCardBody')}
          </p>
          <div className="setup-field" style={{ marginTop: '1rem' }}>
            <label className="form-label">{t('serverForge.tokenLabel')}</label>
            <input
              type="password" value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              className="form-input" placeholder={t('serverForge.tokenPlaceholder')}
            />
          </div>
          {tokenTestResult && (
            <div className={`alert mt-3 ${tokenTestResult.success ? 'alert-success' : 'alert-error'}`}>
              <span className="alert-icon">{tokenTestResult.success ? '\u2713' : '!'}</span>
              {tokenTestResult.message}
            </div>
          )}
          <div className="form-actions">
            <button onClick={handleSaveToken} disabled={tokenSaving || !tokenInput.trim()} className="btn btn-primary">
              {tokenSaving ? t('serverForge.tokenSaving') : t('serverForge.tokenSaveTest')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (hasToken === null) {
    return <div className="loading-state">{t('serverForge.loading')}</div>
  }

  // ====== RENDER: Dashboard ======
  const runningCount = containers.filter(c => c.status === 'running').length
  const stoppedCount = containers.filter(c => c.status === 'stopped').length
  const updatesCount = containers.filter(c => c.update_available).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('serverForge.heading')}</h1>
          <p className="page-subtitle">
            {t('serverForge.subtitle', { total: containers.length, running: runningCount, stopped: stoppedCount })}
            {updatesCount > 0 && <span className="sf-updates-badge">{t('serverForge.updatesBadge', { count: updatesCount })}</span>}
          </p>
        </div>
        <div className="page-header-actions">
          <label className="sf-auto-refresh">
            <input type="checkbox" checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)} className="form-checkbox" />
            {t('serverForge.autoRefresh')}
          </label>
          <button onClick={() => loadAll()} disabled={loading} className="btn btn-secondary btn-sm">
            {loading ? t('serverForge.refreshLoading') : t('serverForge.refresh')}
          </button>
        </div>
      </div>

      {/* Messaggi */}
      {error && (
        <div className="alert alert-error mb-6">
          <span className="alert-icon">!</span>{error}
          <button onClick={() => setError('')} className="alert-close">&times;</button>
        </div>
      )}
      {actionMsg && (
        <div className={`alert mb-6 ${actionIsError ? 'alert-error' : 'alert-success'}`}>
          <span className="alert-icon">{actionIsError ? '!' : '\u2713'}</span>
          {actionMsg}
        </div>
      )}

      {/* Riassunto macchine */}
      {machines.length > 0 && (
        <div className="sf-machines-strip">
          {machines.map(m => (
            <div key={m.id} className="sf-machine-mini">
              <div className="sf-machine-mini-header">
                <span className="sf-machine-mini-name">{m.hostname || m.ip_address}</span>
                <span className={`sf-machine-mini-status sf-status-${m.status}`}>{m.status}</span>
              </div>
              <div className="sf-machine-mini-gauges">
                <GaugeMini label="CPU" value={m.cpu_usage_percent} placeholder={t('serverForge.gauge.placeholder')} />
                <GaugeMini label="RAM" value={m.ram_usage_percent} placeholder={t('serverForge.gauge.placeholder')} />
                <GaugeMini label="Disk" value={m.disk_usage_percent} placeholder={t('serverForge.gauge.placeholder')} />
              </div>
              <div className="sf-machine-mini-info">
                {t('serverForge.machine.locationCount', { location: m.location, count: m.containers_count })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="sf-tabs">
        <button className={`sf-tab ${activeTab === 'containers' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('containers')}>
          {t('serverForge.tabs.containers', { count: containers.length })}
        </button>
        <button className={`sf-tab ${activeTab === 'machines' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('machines')}>
          {t('serverForge.tabs.machines', { count: machines.length })}
        </button>
        <button className={`sf-tab ${activeTab === 'clusters' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('clusters')}>
          {t('serverForge.tabs.clusters', { count: clusters.length })}
        </button>
      </div>

      {/* TAB: Containers */}
      {activeTab === 'containers' && (
        <div className="sf-containers-grid">
          {loading && containers.length === 0 ? (
            <div className="loading-state">{t('serverForge.loadingServers')}</div>
          ) : containers.length === 0 ? (
            <div className="empty-state"><p className="empty-state-text">{t('serverForge.empty.noServers')}</p></div>
          ) : (
            containers.map(c => (
              <div key={c.id} className={`sf-container-card sf-container-${c.status}`}>
                <div className="sf-container-header">
                  <div>
                    <h3 className="sf-container-name">{c.label || c.container_name}</h3>
                    <span className="sf-container-map">{c.map_name || t('serverForge.container.mapFallback')}</span>
                  </div>
                  <span className={`sf-status-pill sf-status-${c.status}`}>
                    {c.status === 'running' ? '\u25CF' : '\u25CB'} {c.status}
                  </span>
                </div>

                <div className="sf-container-stats">
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">{t('serverForge.container.portLabel')}</span>
                    <span className="sf-stat-value">{c.server_port || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">{t('serverForge.container.rconLabel')}</span>
                    <span className="sf-stat-value">{c.rcon_port || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">{t('serverForge.container.uptimeLabel')}</span>
                    <span className="sf-stat-value">{c.formatted_uptime || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">{t('serverForge.container.playersLabel')}</span>
                    <span className="sf-stat-value">{c.max_players || '--'}</span>
                  </div>
                </div>

                {c.update_available && (
                  <div className="sf-update-banner">{t('serverForge.container.updateAvailable')}</div>
                )}

                {c.cluster && (
                  <div className="sf-container-cluster">
                    {t('serverForge.container.clusterLine', { name: c.cluster.name })}
                  </div>
                )}

                <div className="sf-container-actions">
                  {c.status === 'stopped' ? (
                    <button
                      onClick={() => handleContainerAction(c.id, 'start', c.label || c.container_name)}
                      disabled={actionId === c.id}
                      className="btn btn-sm sf-btn-start"
                    >
                      {actionId === c.id ? t('serverForge.container.pending') : t('serverForge.container.start')}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleContainerAction(c.id, 'restart', c.label || c.container_name)}
                        disabled={actionId === c.id}
                        className="btn btn-sm sf-btn-restart"
                      >
                        {actionId === c.id ? t('serverForge.container.pending') : t('serverForge.container.restart')}
                      </button>
                      <button
                        onClick={() => handleContainerAction(c.id, 'stop', c.label || c.container_name)}
                        disabled={actionId === c.id}
                        className="btn btn-sm sf-btn-stop"
                      >
                        {actionId === c.id ? t('serverForge.container.pending') : t('serverForge.container.stop')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB: Machines */}
      {activeTab === 'machines' && (
        <div className="sf-machines-detail">
          {machines.map(m => (
            <div key={m.id} className="sf-machine-card">
              <div className="sf-machine-header">
                <h3 className="sf-machine-name">{m.hostname || m.ip_address || t('serverForge.machine.fallback', { id: m.id })}</h3>
                <span className={`sf-status-pill sf-status-${m.status}`}>{m.status}</span>
              </div>
              <div className="sf-machine-gauges-full">
                <GaugeFull label="CPU" value={m.cpu_usage_percent} placeholder={t('serverForge.gauge.placeholder')} />
                <GaugeFull label="RAM" value={m.ram_usage_percent} placeholder={t('serverForge.gauge.placeholder')}
                  detail={m.ram_used_gb && m.ram_total_gb ? `${m.ram_used_gb} / ${m.ram_total_gb} GB` : undefined} />
                <GaugeFull label="Disco" value={m.disk_usage_percent} placeholder={t('serverForge.gauge.placeholder')}
                  detail={m.disk_used_gb && m.disk_total_gb ? `${m.disk_used_gb} / ${m.disk_total_gb} GB` : undefined} />
              </div>
              <div className="sf-machine-meta">
                <span>{t('serverForge.machine.ipLabel')} <strong>{m.ip_address || t('serverForge.ipFallback')}</strong></span>
                <span>{t('serverForge.machine.osLabel', { os: m.os })}</span>
                <span>{t('serverForge.machine.locationLabel', { location: m.location })}</span>
                <span>{t('serverForge.machine.countsLine', { containers: m.containers_count, clusters: m.clusters_count })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB: Clusters */}
      {activeTab === 'clusters' && (
        <div className="sf-clusters-list">
          {clusters.map(cl => (
            <div key={cl.id} className="sf-cluster-card">
              <h3 className="sf-cluster-name">{cl.name}</h3>
              <div className="sf-cluster-meta">
                <span>{t('serverForge.cluster.serverCount', { count: cl.containers_count })}</span>
                {cl.sync_enabled && <span className="sf-sync-badge">{t('serverForge.cluster.syncActive')}</span>}
                {cl.machine && <span>{t('serverForge.cluster.hostLabel', { host: cl.machine.hostname || cl.machine.ip_address })}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Token config link */}
      <div className="sf-token-footer">
        <button onClick={() => setHasToken(false)} className="btn btn-sm btn-ghost">
          {t('serverForge.editTokenBtn')}
        </button>
      </div>
    </div>
  )
}


// ====== Sub-components ======

function GaugeMini({ label, value, placeholder }: { label: string; value: string | null; placeholder: string }) {
  const pct = parseFloat(value || '0')
  const color = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent-bright)'
  return (
    <div className="sf-gauge-mini">
      <div className="sf-gauge-mini-bar">
        <div className="sf-gauge-mini-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="sf-gauge-mini-label">{label} {value ? `${value}%` : placeholder}</span>
    </div>
  )
}

function GaugeFull({ label, value, detail, placeholder }: { label: string; value: string | null; detail?: string; placeholder: string }) {
  const pct = parseFloat(value || '0')
  const color = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent-bright)'
  return (
    <div className="sf-gauge-full">
      <div className="sf-gauge-full-header">
        <span>{label}</span>
        <span style={{ color }}>{value ? `${value}%` : placeholder}</span>
      </div>
      <div className="sf-gauge-full-bar">
        <div className="sf-gauge-full-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      {detail && <span className="sf-gauge-full-detail">{detail}</span>}
    </div>
  )
}
