/**
 * ContainersPage — Game container scanning via SSH.
 * Discovers plugin paths, config files, and save directories for each container.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HardDrive, Search, RefreshCw, Server, FolderOpen, FileJson, Map, Users,
  Puzzle, Loader2, CheckCircle, AlertCircle, X, ChevronDown, ChevronUp,
  Eye, Folder, File
} from 'lucide-react'
import { machinesApi, containersApi } from '../services/api'

interface MachineItem { id: number; name: string; hostname: string; is_active: boolean; last_status: string }
interface ContainerInfo {
  name: string; path: string; server_root: string | null; paths: Record<string, string>;
  plugins: string[]; map_name: string | null; server_name?: string;
  save_files: string[]; config_files: { plugin: string; file: string; path: string; key: string }[];
  process_running: boolean; status: string;
  machine_id?: number; machine_name?: string; hostname?: string;
}

export default function ContainersPage() {
  const { t } = useTranslation()
  const [machines, setMachines] = useState<MachineItem[]>([])
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState<number | null>(null) // machine_id being scanned
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // File viewer
  const [viewingFile, setViewingFile] = useState<{ machineId: number; container: string; pathKey: string; label: string } | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)

  // Browser
  const [browsing, setBrowsing] = useState<{ machineId: number; container: string; subPath: string } | null>(null)
  const [browseEntries, setBrowseEntries] = useState<{ name: string; is_dir: boolean; size: number; modified: string; permissions: string }[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [basePath, setBasePath] = useState('/gameadmin/containers')

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (success) { const timer = setTimeout(() => setSuccess(''), 5000); return () => clearTimeout(timer) } }, [success])

  async function loadData() {
    setLoading(true)
    try {
      const [machRes, contRes] = await Promise.allSettled([
        machinesApi.list(),
        containersApi.getAllContainers(),
      ])
      if (machRes.status === 'fulfilled') setMachines(machRes.value.data)
      if (contRes.status === 'fulfilled') {
        setContainers(contRes.value.data.containers || [])
        setLastScan(contRes.value.data.last_scan)
      }
    } catch {} finally { setLoading(false) }
  }

  async function handleScan(machineId: number) {
    setScanning(machineId); setError('')
    try {
      const res = await containersApi.scanMachine(machineId, basePath)
      setSuccess(t('containersPage.messages.scanComplete', { count: res.data.containers_found, machine: res.data.machine }))
      // Reload
      const contRes = await containersApi.getAllContainers()
      setContainers(contRes.data.containers || [])
      setLastScan(contRes.data.last_scan)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('containersPage.messages.errorScan'))
    } finally { setScanning(null) }
  }

  async function handleScanAll() {
    setError('')
    const activeMachines = machines.filter(m => m.is_active)
    for (const m of activeMachines) {
      await handleScan(m.id)
    }
  }

  async function handleViewFile(machineId: number, containerName: string, pathKey: string, label: string) {
    setViewingFile({ machineId, container: containerName, pathKey, label })
    setFileLoading(true); setFileContent('')
    try {
      const res = await containersApi.readFile(machineId, containerName, pathKey)
      if (res.data.is_json) {
        setFileContent(JSON.stringify(res.data.content, null, 2))
      } else {
        setFileContent(res.data.content)
      }
    } catch (err: any) {
      setFileContent(t('containersPage.messages.errorPrefix', { detail: err.response?.data?.detail || err.message }))
    } finally { setFileLoading(false) }
  }

  async function handleBrowse(machineId: number, containerName: string, subPath: string = '') {
    setBrowsing({ machineId, container: containerName, subPath })
    try {
      const res = await containersApi.browse(machineId, containerName, subPath)
      setBrowseEntries(res.data.entries)
      setBrowsePath(res.data.path)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('containersPage.messages.errorBrowse'))
      setBrowsing(null)
    }
  }

  function navigateBrowse(entry: any) {
    if (!browsing) return
    if (entry.is_dir) {
      const newSub = browsing.subPath ? `${browsing.subPath}/${entry.name}` : entry.name
      handleBrowse(browsing.machineId, browsing.container, newSub)
    }
  }

  function navigateUp() {
    if (!browsing) return
    const parts = browsing.subPath.split('/').filter(Boolean)
    parts.pop()
    handleBrowse(browsing.machineId, browsing.container, parts.join('/'))
  }

  function fmtDate(d: string | null) { return d ? new Date(d).toLocaleString(undefined) : t('containersPage.neverScanned') }

  function pathLabel(key: string): string {
    const translated = t(`containersPage.pathLabels.${key}`, { defaultValue: '' })
    return translated || key
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HardDrive size={24} style={{ color: 'var(--accent)' }} /> {t('containersPage.heading')}
          </h1>
          <p className="page-subtitle">
            {t('containersPage.subtitleDiscovered', { count: containers.length })}
            {lastScan && <span style={{ margin: '0 0.4rem', opacity: 0.4 }}>&middot;</span>}
            {lastScan && t('containersPage.subtitleLastScan', { date: fmtDate(lastScan) })}
          </p>
        </div>
        <div className="page-header-actions">
          <button onClick={handleScanAll} disabled={scanning !== null} className="btn btn-primary btn-sm">
            {scanning !== null ? <><Loader2 size={14} className="pl-spin" /> {t('containersPage.scanning')}</> : <><Search size={14} /> {t('containersPage.scanAll')}</>}
          </button>
        </div>
      </div>

      {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14}/></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}

      {/* Macchine con pulsante scan */}
      {/* Base path config */}
      <div className="ct-basepath-row">
        <label>{t('containersPage.basePathLabel')}</label>
        <input type="text" value={basePath} onChange={e => setBasePath(e.target.value)}
          className="ct-basepath-input" />
      </div>

      <div className="ct-machines-strip">
        {machines.filter(m => m.is_active).map(m => (
          <div key={m.id} className="ct-machine-btn">
            <div className="ct-machine-info">
              <Server size={14} style={{ color: 'var(--accent)' }} />
              <span className="ct-machine-name">{m.name}</span>
              <span className="ct-machine-host">{m.hostname}</span>
            </div>
            <button onClick={() => handleScan(m.id)} disabled={scanning === m.id} className="btn btn-sm btn-secondary">
              {scanning === m.id ? <Loader2 size={12} className="pl-spin" /> : <Search size={12} />}
              {t('containersPage.scanButton')}
            </button>
          </div>
        ))}
        {machines.filter(m => m.is_active).length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('containersPage.noActiveMachines')}</p>
        )}
      </div>

      {/* Container list */}
      {loading ? (
        <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> {t('containersPage.loading')}</div>
      ) : containers.length === 0 ? (
        <div className="pl-empty"><HardDrive size={32} /><p>{t('containersPage.empty')}</p></div>
      ) : (
        <div className="ct-list">
          {containers.map((c) => {
            const key = `${c.machine_id}-${c.name}`
            const isExpanded = expanded === key
            return (
              <div key={key} className="ct-item">
                <div className="ct-row" onClick={() => setExpanded(isExpanded ? null : key)}>
                  <div className="ct-row-main">
                    <div className={`ct-status-dot ${c.process_running ? 'ct-status-running' : 'ct-status-stopped'}`} />
                    <div>
                      <span className="ct-name">{c.name}</span>
                      {c.map_name && <span className="ct-map"><Map size={11} /> {c.map_name}</span>}
                    </div>
                  </div>
                  <span className="ct-machine-tag"><Server size={10} /> {c.machine_name || c.hostname}</span>
                  <span className="ct-plugins-count"><Puzzle size={11} /> {t('containersPage.pluginCount', { count: c.plugins.length })}</span>
                  <span className="ct-paths-count"><FolderOpen size={11} /> {t('containersPage.pathsCount', { count: Object.keys(c.paths).length })}</span>
                  {(c as any).profile_count > 0 && <span className="ct-paths-count"><Users size={11} /> {t('containersPage.profileCount', { count: (c as any).profile_count })}</span>}
                  {isExpanded ? <ChevronUp size={14} className="ct-chevron" /> : <ChevronDown size={14} className="ct-chevron" />}
                </div>

                {isExpanded && (
                  <div className="ct-detail">
                    {/* Info base */}
                    <div className="ct-detail-section">
                      <div className="ct-detail-meta">
                        <span><strong>{t('containersPage.detail.pathLabel')}</strong> {c.path}</span>
                        {c.server_root && <span><strong>{t('containersPage.detail.serverRootLabel')}</strong> {c.server_root}</span>}
                        {(c as any).server_name && <span><strong>{t('containersPage.detail.serverNameLabel')}</strong> {(c as any).server_name}</span>}
                        {c.map_name && <span><strong>{t('containersPage.detail.mapLabel')}</strong> {c.map_name}</span>}
                        <span><strong>{t('containersPage.detail.processLabel')}</strong> {c.process_running ? t('containersPage.detail.processRunning') : t('containersPage.detail.processStopped')}</span>
                      </div>
                    </div>

                    {/* Plugin installati */}
                    {c.plugins.length > 0 && (
                      <div className="ct-detail-section">
                        <span className="ct-section-label"><Puzzle size={13} /> {t('containersPage.detail.installedPlugins')}</span>
                        <div className="ct-plugins-list">
                          {c.plugins.map(p => <span key={p} className="pl-chip">{p}</span>)}
                        </div>
                      </div>
                    )}

                    {/* Percorsi struttura */}
                    <div className="ct-detail-section">
                      <span className="ct-section-label"><FolderOpen size={13} /> {t('containersPage.detail.serverStructure')}</span>
                      <div className="ct-paths-list">
                        {Object.entries(c.paths).filter(([k]) => !k.startsWith('plugin_')).map(([key, path]) => (
                          <div key={key} className="ct-path-row">
                            <span className="ct-path-key">{pathLabel(key)}</span>
                            <span className="ct-path-val">{path}</span>
                            {(key.includes('ini')) && c.machine_id && (
                              <button onClick={e => { e.stopPropagation(); handleViewFile(c.machine_id!, c.name, key, pathLabel(key)) }}
                                className="btn btn-sm btn-ghost" title={t('containersPage.tooltip.view')}><Eye size={12} /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Config plugin */}
                    {c.config_files?.length > 0 && (
                      <div className="ct-detail-section">
                        <span className="ct-section-label"><FileJson size={13} /> {t('containersPage.detail.pluginConfigs')}</span>
                        <div className="ct-paths-list">
                          {c.config_files.map((cf, i) => (
                            <div key={i} className="ct-path-row">
                              <span className="ct-path-key">{cf.plugin}</span>
                              <span className="ct-path-val">{cf.path}</span>
                              {c.machine_id && (
                                <button onClick={e => { e.stopPropagation(); handleViewFile(c.machine_id!, c.name, cf.key, `${cf.plugin}/${cf.file}`) }}
                                  className="btn btn-sm btn-ghost" title={t('containersPage.tooltip.view')}><Eye size={12} /></button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Save files */}
                    {c.save_files.length > 0 && (
                      <div className="ct-detail-section">
                        <span className="ct-section-label"><FileJson size={13} /> {t('containersPage.detail.saveFiles')}</span>
                        <div className="ct-save-files">
                          {c.save_files.map((f, i) => <span key={i} className="ct-save-file">{f.split('/').pop()}</span>)}
                        </div>
                      </div>
                    )}

                    {/* Azioni */}
                    <div className="ct-detail-actions">
                      {c.machine_id && (
                        <>
                          <button onClick={() => handleBrowse(c.machine_id!, c.name)} className="btn btn-sm btn-secondary">
                            <Folder size={12} /> {t('containersPage.action.browse')}
                          </button>
                          <button onClick={() => { containersApi.rescanContainer(c.machine_id!, c.name).then(() => { setSuccess(t('containersPage.messages.rescanned', { name: c.name })); loadData() }) }}
                            className="btn btn-sm btn-ghost"><RefreshCw size={12} /> {t('containersPage.action.rescan')}</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* File Viewer Dialog */}
      {viewingFile && (
        <div className="as-dialog-overlay" onClick={e => { if (e.target === e.currentTarget) setViewingFile(null) }}>
          <div className="as-dialog" style={{ maxWidth: 800 }}>
            <div className="as-dialog-header">
              <h3><FileJson size={16} style={{ marginRight: '0.4rem', verticalAlign: '-2px' }} /> {viewingFile.label}</h3>
              <button onClick={() => setViewingFile(null)} className="pl-btn-icon" style={{ width: 28, height: 28 }}><X size={14} /></button>
            </div>
            <div className="as-dialog-body">
              {fileLoading ? (
                <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> {t('containersPage.loading')}</div>
              ) : (
                <pre className="ct-file-content">{fileContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* File Browser Dialog */}
      {browsing && (
        <div className="as-dialog-overlay" onClick={e => { if (e.target === e.currentTarget) setBrowsing(null) }}>
          <div className="as-dialog" style={{ maxWidth: 700 }}>
            <div className="as-dialog-header">
              <h3><Folder size={16} style={{ marginRight: '0.4rem', verticalAlign: '-2px' }} /> {browsing.container}</h3>
              <button onClick={() => setBrowsing(null)} className="pl-btn-icon" style={{ width: 28, height: 28 }}><X size={14} /></button>
            </div>
            <div className="as-dialog-body">
              <div className="ct-browse-path">
                <span>{browsePath}</span>
                {browsing.subPath && <button onClick={navigateUp} className="btn btn-sm btn-ghost">{t('containersPage.fileBrowser.upButton')}</button>}
              </div>
              <div className="ct-browse-list">
                {browseEntries.map((e, i) => (
                  <div key={i} className={`ct-browse-entry ${e.is_dir ? 'ct-browse-dir' : ''}`}
                    onClick={() => navigateBrowse(e)} style={{ cursor: e.is_dir ? 'pointer' : 'default' }}>
                    {e.is_dir ? <Folder size={14} style={{ color: 'var(--accent)' }} /> : <File size={14} style={{ color: 'var(--text-muted)' }} />}
                    <span className="ct-browse-name">{e.name}</span>
                    <span className="ct-browse-size">{e.is_dir ? '' : formatSize(e.size)}</span>
                    <span className="ct-browse-date">{e.modified}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
