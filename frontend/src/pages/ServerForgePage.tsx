/**
 * ServerForgePage — ServerForge control dashboard.
 * Displays machines, containers (game servers) and clusters with live controls.
 */
import { useState, useEffect, useCallback } from 'react'
import { sfApi } from '../services/api'
import type { SFMachine, SFContainer, SFCluster } from '../types'

type Tab = 'containers' | 'machines' | 'clusters'

export default function ServerForgePage() {
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
      const t = setTimeout(() => setActionMsg(''), 5000)
      return () => clearTimeout(t)
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
    const actionLabel = action === 'start' ? 'Avviare' : action === 'stop' ? 'Fermare' : 'Riavviare'
    if (!confirm(`${actionLabel} il server "${label}"?`)) return

    setActionId(id)
    try {
      if (action === 'start') await sfApi.startContainer(id)
      else if (action === 'stop') await sfApi.stopContainer(id)
      else await sfApi.restartContainer(id)

      setActionMsg(`${action === 'start' ? 'Avvio' : action === 'stop' ? 'Stop' : 'Restart'} inviato per "${label}"`)
      // Reload after a couple of seconds to give the server time to update
      setTimeout(() => loadAll(true), 3000)
    } catch (err: any) {
      setActionMsg(`Errore: ${err.response?.data?.detail || err.message}`)
    } finally {
      setActionId(null)
    }
  }

  // ====== RENDER: Token config ======
  if (hasToken === false) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">ServerForge</h1>
          <p className="page-subtitle">Configura il token API per collegarti a ServerForge</p>
        </div>
        <div className="card">
          <h2 className="card-title"><span className="card-title-icon">&#x26A1;</span> Token API</h2>
          <p className="card-text">
            Inserisci il Bearer Token del tuo account ServerForge. Lo trovi nella sezione API
            della dashboard ServerForge. Il token viene salvato criptato nel vault locale.
          </p>
          <div className="setup-field" style={{ marginTop: '1rem' }}>
            <label className="form-label">Bearer Token</label>
            <input
              type="password" value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              className="form-input" placeholder="Incolla qui il tuo token..."
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
              {tokenSaving ? 'Salvataggio...' : 'Salva e Testa Token'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (hasToken === null) {
    return <div className="loading-state">Caricamento...</div>
  }

  // ====== RENDER: Dashboard ======
  const runningCount = containers.filter(c => c.status === 'running').length
  const stoppedCount = containers.filter(c => c.status === 'stopped').length
  const updatesCount = containers.filter(c => c.update_available).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">ServerForge</h1>
          <p className="page-subtitle">
            {containers.length} server &middot; {runningCount} running &middot; {stoppedCount} stopped
            {updatesCount > 0 && <span className="sf-updates-badge">{updatesCount} update</span>}
          </p>
        </div>
        <div className="page-header-actions">
          <label className="sf-auto-refresh">
            <input type="checkbox" checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)} className="form-checkbox" />
            Auto-refresh 30s
          </label>
          <button onClick={() => loadAll()} disabled={loading} className="btn btn-secondary btn-sm">
            {loading ? 'Caricamento...' : 'Aggiorna'}
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
        <div className={`alert mb-6 ${actionMsg.startsWith('Errore') ? 'alert-error' : 'alert-success'}`}>
          <span className="alert-icon">{actionMsg.startsWith('Errore') ? '!' : '\u2713'}</span>
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
                <GaugeMini label="CPU" value={m.cpu_usage_percent} />
                <GaugeMini label="RAM" value={m.ram_usage_percent} />
                <GaugeMini label="Disk" value={m.disk_usage_percent} />
              </div>
              <div className="sf-machine-mini-info">
                {m.location} &middot; {m.containers_count} containers
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="sf-tabs">
        <button className={`sf-tab ${activeTab === 'containers' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('containers')}>
          Server di Gioco ({containers.length})
        </button>
        <button className={`sf-tab ${activeTab === 'machines' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('machines')}>
          Macchine ({machines.length})
        </button>
        <button className={`sf-tab ${activeTab === 'clusters' ? 'sf-tab-active' : ''}`}
          onClick={() => setActiveTab('clusters')}>
          Cluster ({clusters.length})
        </button>
      </div>

      {/* TAB: Containers */}
      {activeTab === 'containers' && (
        <div className="sf-containers-grid">
          {loading && containers.length === 0 ? (
            <div className="loading-state">Caricamento server...</div>
          ) : containers.length === 0 ? (
            <div className="empty-state"><p className="empty-state-text">Nessun server trovato</p></div>
          ) : (
            containers.map(c => (
              <div key={c.id} className={`sf-container-card sf-container-${c.status}`}>
                <div className="sf-container-header">
                  <div>
                    <h3 className="sf-container-name">{c.label || c.container_name}</h3>
                    <span className="sf-container-map">{c.map_name || 'N/D'}</span>
                  </div>
                  <span className={`sf-status-pill sf-status-${c.status}`}>
                    {c.status === 'running' ? '\u25CF' : '\u25CB'} {c.status}
                  </span>
                </div>

                <div className="sf-container-stats">
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">Porta</span>
                    <span className="sf-stat-value">{c.server_port || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">RCON</span>
                    <span className="sf-stat-value">{c.rcon_port || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">Uptime</span>
                    <span className="sf-stat-value">{c.formatted_uptime || '--'}</span>
                  </div>
                  <div className="sf-container-stat">
                    <span className="sf-stat-label">Players</span>
                    <span className="sf-stat-value">{c.max_players || '--'}</span>
                  </div>
                </div>

                {c.update_available && (
                  <div className="sf-update-banner">Aggiornamento disponibile</div>
                )}

                {c.cluster && (
                  <div className="sf-container-cluster">
                    Cluster: {c.cluster.name}
                  </div>
                )}

                <div className="sf-container-actions">
                  {c.status === 'stopped' ? (
                    <button
                      onClick={() => handleContainerAction(c.id, 'start', c.label || c.container_name)}
                      disabled={actionId === c.id}
                      className="btn btn-sm sf-btn-start"
                    >
                      {actionId === c.id ? '...' : '\u25B6 Avvia'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleContainerAction(c.id, 'restart', c.label || c.container_name)}
                        disabled={actionId === c.id}
                        className="btn btn-sm sf-btn-restart"
                      >
                        {actionId === c.id ? '...' : '\u21BB Restart'}
                      </button>
                      <button
                        onClick={() => handleContainerAction(c.id, 'stop', c.label || c.container_name)}
                        disabled={actionId === c.id}
                        className="btn btn-sm sf-btn-stop"
                      >
                        {actionId === c.id ? '...' : '\u25A0 Stop'}
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
                <h3 className="sf-machine-name">{m.hostname || m.ip_address || `Machine #${m.id}`}</h3>
                <span className={`sf-status-pill sf-status-${m.status}`}>{m.status}</span>
              </div>
              <div className="sf-machine-gauges-full">
                <GaugeFull label="CPU" value={m.cpu_usage_percent} />
                <GaugeFull label="RAM" value={m.ram_usage_percent}
                  detail={m.ram_used_gb && m.ram_total_gb ? `${m.ram_used_gb} / ${m.ram_total_gb} GB` : undefined} />
                <GaugeFull label="Disco" value={m.disk_usage_percent}
                  detail={m.disk_used_gb && m.disk_total_gb ? `${m.disk_used_gb} / ${m.disk_total_gb} GB` : undefined} />
              </div>
              <div className="sf-machine-meta">
                <span>IP: <strong>{m.ip_address || 'N/D'}</strong></span>
                <span>OS: {m.os}</span>
                <span>Location: {m.location}</span>
                <span>{m.containers_count} containers, {m.clusters_count} clusters</span>
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
                <span>{cl.containers_count} server</span>
                {cl.sync_enabled && <span className="sf-sync-badge">Sync attivo</span>}
                {cl.machine && <span>Host: {cl.machine.hostname || cl.machine.ip_address}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Token config link */}
      <div className="sf-token-footer">
        <button onClick={() => setHasToken(false)} className="btn btn-sm btn-ghost">
          Modifica Token ServerForge
        </button>
      </div>
    </div>
  )
}


// ====== Sub-components ======

function GaugeMini({ label, value }: { label: string; value: string | null }) {
  const pct = parseFloat(value || '0')
  const color = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent-bright)'
  return (
    <div className="sf-gauge-mini">
      <div className="sf-gauge-mini-bar">
        <div className="sf-gauge-mini-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="sf-gauge-mini-label">{label} {value ? `${value}%` : '--'}</span>
    </div>
  )
}

function GaugeFull({ label, value, detail }: { label: string; value: string | null; detail?: string }) {
  const pct = parseFloat(value || '0')
  const color = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent-bright)'
  return (
    <div className="sf-gauge-full">
      <div className="sf-gauge-full-header">
        <span>{label}</span>
        <span style={{ color }}>{value ? `${value}%` : '--'}</span>
      </div>
      <div className="sf-gauge-full-bar">
        <div className="sf-gauge-full-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      {detail && <span className="sf-gauge-full-detail">{detail}</span>}
    </div>
  )
}
