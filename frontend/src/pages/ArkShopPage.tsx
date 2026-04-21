/**
 * ArkShopPage — ArkShop plugin configuration editor.
 * Row-based layout, modal dialog for editing, blueprint search from local DB.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShoppingBag, Settings, Package, MessageSquare, Database,
  Upload, Download, Save, Plus, Trash2, Edit3, X, Search,
  DollarSign, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp,
  Server, CloudDownload, CloudUpload, RefreshCw, Archive, RotateCcw, Play, Square, Clock
} from 'lucide-react'
import { arkshopApi, blueprintsApi } from '../services/api'

type Tab = 'mysql' | 'general' | 'shop' | 'kits' | 'sell' | 'messages'

function bpName(bp: string) {
  const m = bp?.match(/\.([^.']+)'?$/)
  return m ? m[1].replace(/PrimalItem_|PrimalItemArmor_|PrimalItemResource_|PrimalItemStructure_|PrimalItemConsumable_|PrimalItemConsumableEatable_|PrimalItemAmmo_|PrimalItemSkin_|PrimalItemArtifact_|PrimalItem_Weapon/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ') : bp || '?'
}

// ===== Blueprint Search Component =====
function BlueprintSearch({ value, onChange }: { value: string; onChange: (bp: string) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ name: string; blueprint: string; type: string; category?: string; gfi?: string }[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handleClick); return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await blueprintsApi.list({ search: q, limit: 15 })
      setResults(res.data.items)
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(timer)
  }, [query, doSearch])

  return (
    <div className="bp-search-wrap" ref={ref}>
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (query.length >= 2) setOpen(true) }}
        className="as-edit-field-input" placeholder={t('arkshop.bpSearch.placeholder')} />
      <button type="button" className="bp-search-btn" onClick={() => { setQuery(value ? bpName(value) : ''); setOpen(true) }}>
        <Search size={12} />
      </button>
      {open && results.length > 0 && (
        <div className="bp-search-dropdown">
          {loading && <div className="bp-search-loading"><Loader2 size={14} className="pl-spin" /></div>}
          {results.map((item, i) => (
            <div key={i} className="bp-search-option" onClick={() => { onChange(item.blueprint); setOpen(false); setQuery('') }}>
              <span className="bp-search-opt-name">{item.name}</span>
              <span className="bp-search-opt-type">{item.type}</span>
              <span className="bp-search-opt-cat">{item.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== Edit Dialog =====
function EditDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="as-dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="as-dialog">
        <div className="as-dialog-header">
          <h3>{title}</h3>
          <button onClick={onClose} className="pl-btn-icon" style={{ width: 28, height: 28 }}><X size={14} /></button>
        </div>
        <div className="as-dialog-body">{children}</div>
      </div>
    </div>
  )
}

// ===== Sub-Item Editor inside Dialog =====
function SubItemEditor({ items, onChange }: { items: any[]; onChange: (items: any[]) => void }) {
  const { t } = useTranslation()
  function update(idx: number, field: string, val: any) {
    const n = [...items]; n[idx] = { ...n[idx], [field]: val }; onChange(n)
  }
  function remove(idx: number) { onChange(items.filter((_, i) => i !== idx)) }
  function addItem() { onChange([...items, { Amount: 1, Blueprint: '', ForceBlueprint: false, Quality: 0 }]) }
  function addCmd() { onChange([...items, { Command: '', DisplayAs: '', ExecuteAsAdmin: false }]) }

  return (
    <div className="as-sub-editor">
      {items.map((it, idx) => {
        const isCmd = !it.Blueprint && (it.Command !== undefined || it.DisplayAs !== undefined)
        return (
          <div key={idx} className="as-sub-row">
            <span className="as-sub-num">#{idx + 1}</span>
            {isCmd ? (
              <div className="as-sub-fields">
                <div className="as-sub-field" style={{ flex: 2 }}>
                  <label>{t('arkshop.sub.command')}</label>
                  <input type="text" value={it.Command ?? ''} onChange={e => update(idx, 'Command', e.target.value)} />
                </div>
                <div className="as-sub-field" style={{ flex: 1 }}>
                  <label>{t('arkshop.sub.displayAs')}</label>
                  <input type="text" value={it.DisplayAs ?? ''} onChange={e => update(idx, 'DisplayAs', e.target.value)} />
                </div>
                <div className="as-sub-field" style={{ width: 70 }}>
                  <label>{t('arkshop.sub.admin')}</label>
                  <select value={it.ExecuteAsAdmin ? '1' : '0'} onChange={e => update(idx, 'ExecuteAsAdmin', e.target.value === '1')}>
                    <option value="0">{t('arkshop.sub.no')}</option><option value="1">{t('arkshop.sub.yes')}</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="as-sub-fields">
                <div className="as-sub-field" style={{ flex: 3 }}>
                  <label>{t('arkshop.sub.blueprint')}</label>
                  <BlueprintSearch value={it.Blueprint ?? ''} onChange={v => update(idx, 'Blueprint', v)} />
                </div>
                <div className="as-sub-field" style={{ width: 65 }}>
                  <label>{t('arkshop.sub.qty')}</label>
                  <input type="number" value={it.Amount ?? 1} onChange={e => update(idx, 'Amount', parseInt(e.target.value) || 1)} />
                </div>
                <div className="as-sub-field" style={{ width: 60 }}>
                  <label>{t('arkshop.sub.quality')}</label>
                  <input type="number" value={it.Quality ?? 0} onChange={e => update(idx, 'Quality', parseInt(e.target.value) || 0)} />
                </div>
                <div className="as-sub-field" style={{ width: 50 }}>
                  <label>{t('arkshop.sub.bp')}</label>
                  <select value={it.ForceBlueprint ? '1' : '0'} onChange={e => update(idx, 'ForceBlueprint', e.target.value === '1')}>
                    <option value="0">{t('arkshop.sub.no')}</option><option value="1">{t('arkshop.sub.yes')}</option>
                  </select>
                </div>
              </div>
            )}
            <button onClick={() => remove(idx)} className="as-sub-remove"><Trash2 size={12} /></button>
          </div>
        )
      })}
      <div className="as-sub-add">
        <button className="btn btn-sm btn-secondary" onClick={addItem}><Plus size={12} /> {t('arkshop.sub.addItem')}</button>
        <button className="btn btn-sm btn-ghost" onClick={addCmd}><Plus size={12} /> {t('arkshop.sub.addCmd')}</button>
      </div>
    </div>
  )
}

// ===== MAIN =====
export default function ArkShopPage() {
  const { t } = useTranslation()
  const [configLoaded, setConfigLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('shop')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mysql, setMysql] = useState<Record<string, unknown>>({})
  const [general, setGeneral] = useState<Record<string, unknown>>({})
  const [shopItems, setShopItems] = useState<Record<string, unknown>[]>([])
  const [kits, setKits] = useState<Record<string, unknown>[]>([])
  const [sellItems, setSellItems] = useState<Record<string, unknown>[]>([])
  const [messages, setMessages] = useState<Record<string, unknown>>({})

  const [shopSearch, setShopSearch] = useState('')
  const [shopTypeFilter, setShopTypeFilter] = useState('')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogType, setDialogType] = useState<'shop' | 'kit' | 'sell'>('shop')
  const [dialogData, setDialogData] = useState<Record<string, unknown> | null>(null)
  const [dialogIsNew, setDialogIsNew] = useState(false)

  // Pull/Push/Deploy state
  const [arkServers, setArkServers] = useState<Record<string, unknown>[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [pushResults, setPushResults] = useState<Record<string, unknown> | null>(null)
  const [configSource, setConfigSource] = useState<Record<string, unknown> | null>(null)

  // Versions
  const [versions, setVersions] = useState<Record<string, unknown>[]>([])
  const [savingVersion, setSavingVersion] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  const [showVersions, setShowVersions] = useState(false)
  const [deployVersionId, setDeployVersionId] = useState<number | null>(null)

  useEffect(() => { if (success) { const timer = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(timer) } }, [success])

  // Lifecycle
  async function handleReset() {
    if (!confirm(t('arkshop.messagesResult.resetConfirm'))) return
    try {
      await arkshopApi.deleteConfig()
      setConfigLoaded(false)
      setShopItems([]); setKits([]); setSellItems([])
      setMysql({}); setGeneral({}); setMessages({})
      setSuccess(t('arkshop.messagesResult.resetSuccess'))
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.resetError')) }
  }

  function handleUploadClick() { fileInputRef.current?.click() }
  function cleanJsonComments(raw: string): string {
    let text = raw.replace(/^\uFEFF/, '')
    const lines = text.split('\n').map(line => {
      if (line.trimStart().startsWith('//')) return ''
      let inStr = false, result = ''
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"' && (i === 0 || line[i - 1] !== '\\')) inStr = !inStr
        if (!inStr && c === '/' && i + 1 < line.length && line[i + 1] === '/') break
        result += c
      }
      return result
    })
    return lines.join('\n').replace(/,\s*([}\]])/g, '$1')
  }
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setLoading(true); setError('')
    try {
      const raw = await file.text()
      const clean = cleanJsonComments(raw)
      await arkshopApi.uploadConfig(JSON.parse(clean))
      setConfigLoaded(true); setSuccess(t('arkshop.messagesResult.uploadSuccess')); loadAll()
    } catch (err: any) { setError(err.message?.includes('JSON') ? t('arkshop.messagesResult.invalidJson') : (err.response?.data?.detail || err.message)) }
    finally { setLoading(false); e.target.value = '' }
  }
  async function handleExport() {
    try {
      const res = await arkshopApi.exportConfig()
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })); a.download = 'ArkShop.json'; a.click()
      setSuccess(t('arkshop.messagesResult.exportSuccess'))
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.genericError')) }
  }
  async function loadAll() {
    const [my, gen, shop, kit, sell, msg] = await Promise.allSettled([
      arkshopApi.getMysql(), arkshopApi.getGeneral(), arkshopApi.listShopItems(),
      arkshopApi.listKits(), arkshopApi.listSellItems(), arkshopApi.getMessages(),
    ])
    if (my.status === 'fulfilled') setMysql(my.value.data)
    if (gen.status === 'fulfilled') setGeneral(gen.value.data)
    if (shop.status === 'fulfilled') setShopItems(shop.value.data)
    if (kit.status === 'fulfilled') setKits(kit.value.data)
    if (sell.status === 'fulfilled') setSellItems(sell.value.data)
    if (msg.status === 'fulfilled') setMessages(msg.value.data)
  }
  useEffect(() => {
    arkshopApi.configStatus().then(r => {
      if (r.data.has_config) { setConfigLoaded(true); loadAll() }
    }).catch(() => {})
    loadArkServers()
    loadVersions()
  }, [])

  async function loadArkServers() {
    setLoadingServers(true)
    try {
      const res = await arkshopApi.servers()
      setArkServers(res.data.servers || [])
    } catch {} finally { setLoadingServers(false) }
  }

  async function handlePull(machineId: number, containerName: string) {
    setPulling(true); setError('')
    try {
      const res = await arkshopApi.pull(machineId, containerName)
      setSuccess(t('arkshop.messagesResult.pullSuccess', { source: res.data.source, items: res.data.shop_items, kits: res.data.kits }))
      setConfigLoaded(true)
      loadAll()
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.pullError')) }
    finally { setPulling(false) }
  }

  async function handleDeploy(versionId?: number, machineId?: number, containerName?: string) {
    setPushing(true); setError(''); setPushResults(null)
    try {
      const res = await arkshopApi.deploy(versionId ?? undefined, machineId, containerName)
      setPushResults(res.data)
      const d = res.data
      if (d.deployed > 0 && d.failed === 0 && d.skipped_running === 0) {
        setSuccess(t('arkshop.messagesResult.deployAllSuccess', { version: d.version, deployed: d.deployed, total: d.total }))
      } else if (d.deployed > 0) {
        setSuccess(t('arkshop.messagesResult.deployPartial', { version: d.version, deployed: d.deployed, skipped: d.skipped_running, failed: d.failed }))
      } else if (d.skipped_running > 0) {
        setError(t('arkshop.messagesResult.deployNone', { skipped: d.skipped_running }))
      } else {
        setError(t('arkshop.messagesResult.deployFailed', { failed: d.failed }))
      }
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.deployError')) }
    finally { setPushing(false) }
  }

  async function loadVersions() {
    try {
      const res = await arkshopApi.listVersions()
      setVersions(res.data.versions || [])
    } catch {}
  }

  async function handleSaveVersion() {
    if (!versionLabel.trim()) { setError(t('arkshop.messagesResult.versionNameRequired')); return }
    setSavingVersion(true); setError('')
    try {
      const res = await arkshopApi.saveVersion(versionLabel.trim())
      setSuccess(t('arkshop.messagesResult.versionSaved', { label: res.data.label, total: res.data.total_versions }))
      setVersionLabel('')
      loadVersions()
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.versionSaveError')) }
    finally { setSavingVersion(false) }
  }

  async function handleRestoreVersion(id: number) {
    try {
      const res = await arkshopApi.restoreVersion(id)
      setSuccess(t('arkshop.messagesResult.versionRestored', { label: res.data.label, items: res.data.shop_items, kits: res.data.kits }))
      loadAll()
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.versionRestoreError')) }
  }

  async function handleDeleteVersion(id: number) {
    if (!confirm(t('arkshop.messagesResult.versionDeleteConfirm'))) return
    try {
      await arkshopApi.deleteVersion(id)
      setSuccess(t('arkshop.messagesResult.versionDeleted'))
      loadVersions()
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.versionDeleteError')) }
  }

  // ===== Dialog open helpers =====
  function openShopDialog(item?: any) {
    setDialogType('shop'); setDialogIsNew(!item)
    setDialogData(item ? JSON.parse(JSON.stringify(item)) : { key: '', Title: '', Description: '', Price: 10, Type: 'item', Permissions: 'WL', Items: [] })
    setDialogOpen(true)
  }
  function openKitDialog(kit?: any) {
    setDialogType('kit'); setDialogIsNew(!kit)
    setDialogData(kit ? JSON.parse(JSON.stringify(kit)) : { key: '', Description: '', Price: 10, DefaultAmount: 1, MaxLevel: 0, OnlyFromSpawn: false, Permissions: 'WL', Items: [], Dinos: [] })
    setDialogOpen(true)
  }
  function openSellDialog(item?: any) {
    setDialogType('sell'); setDialogIsNew(!item)
    setDialogData(item ? JSON.parse(JSON.stringify(item)) : { key: '', Description: '', Price: 10, Amount: 1, Blueprint: '', Type: 'item' })
    setDialogOpen(true)
  }

  // ===== Save from dialog =====
  async function handleDialogSave() {
    if (!dialogData?.key) { setError(t('arkshop.messagesResult.keyRequired')); return }
    try {
      const { key, ...data } = dialogData
      if (dialogType === 'shop') {
        await arkshopApi.updateShopItem(key, data)
        const res = await arkshopApi.listShopItems(); setShopItems(res.data)
      } else if (dialogType === 'kit') {
        await arkshopApi.updateKit(key, data)
        const res = await arkshopApi.listKits(); setKits(res.data)
      } else {
        await arkshopApi.updateSellItem(key, data)
        const res = await arkshopApi.listSellItems(); setSellItems(res.data)
      }
      setSuccess(t('arkshop.messagesResult.saved', { key })); setDialogOpen(false)
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.saveError')) }
  }

  // ===== Delete =====
  async function handleDelete(type: string, key: string) {
    if (!confirm(t('arkshop.messagesResult.deleteConfirm', { key }))) return
    try {
      if (type === 'shop') { await arkshopApi.deleteShopItem(key); setShopItems(p => p.filter(i => i.key !== key)) }
      else if (type === 'kit') { await arkshopApi.deleteKit(key); setKits(p => p.filter(i => i.key !== key)) }
      else { await arkshopApi.deleteSellItem(key); setSellItems(p => p.filter(i => i.key !== key)) }
      setSuccess(t('arkshop.messagesResult.deleted', { key })); setDialogOpen(false)
    } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.deleteError')) }
  }

  // General/MySQL/Messages saves
  async function saveMysql() { try { await arkshopApi.updateMysql(mysql); setSuccess(t('arkshop.messagesResult.mysqlSaved')) } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.genericError')) } }
  async function saveGeneral() { try { await arkshopApi.updateGeneral(general); setSuccess(t('arkshop.messagesResult.generalSaved')) } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.genericError')) } }
  async function saveMessages() { try { await arkshopApi.updateMessages(messages); setSuccess(t('arkshop.messagesResult.messagesSaved')) } catch (err: any) { setError(err.response?.data?.detail || t('arkshop.messagesResult.genericError')) } }

  // Filters
  const filteredShop = shopItems.filter(item => {
    if (shopSearch && !item.Title?.toLowerCase().includes(shopSearch.toLowerCase()) && !item.key?.toLowerCase().includes(shopSearch.toLowerCase())) return false
    if (shopTypeFilter && item.Type !== shopTypeFilter) return false; return true
  })

  // ===== No config =====
  if (!configLoaded) return (
    <div>
      <div className="page-header"><div>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingBag size={24} style={{ color: 'var(--accent)' }} /> {t('arkshop.heading')}</h1>
        <p className="page-subtitle">{t('arkshop.subtitleNoConfig')}</p>
      </div></div>
      {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14}/></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}

      <div className="card" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <CloudDownload size={18} /> {t('arkshop.loadFromServer.title')}
        </h3>
        <p className="card-text" style={{ marginBottom: '1rem' }}>{t('arkshop.loadFromServer.hint')}</p>

        {loadingServers ? (
          <p style={{ color: 'var(--text-muted)' }}><Loader2 size={14} className="pl-spin" /> {t('arkshop.loadFromServer.searching')}</p>
        ) : arkServers.length > 0 ? (
          <table className="pl-sync-table">
            <thead><tr><th>{t('arkshop.loadFromServer.columnContainer')}</th><th>{t('arkshop.loadFromServer.columnServer')}</th><th>{t('arkshop.loadFromServer.columnMap')}</th><th>{t('arkshop.loadFromServer.columnHost')}</th><th style={{ width: 80 }}></th></tr></thead>
            <tbody>
              {arkServers.map((s, i) => (
                <tr key={i}>
                  <td><span className="pl-sync-mono">{s.container_name}</span></td>
                  <td>{s.server_name || s.machine_name}</td>
                  <td>{s.map_name || '-'}</td>
                  <td><span className="pl-sync-mono">{s.hostname}</span></td>
                  <td>
                    <button onClick={() => handlePull(s.machine_id, s.container_name)}
                      disabled={pulling} className="btn btn-primary btn-sm" style={{ padding: '0.2rem 0.5rem' }}>
                      {pulling ? <Loader2 size={12} className="pl-spin" /> : <CloudDownload size={12} />} {t('arkshop.loadFromServer.pullButton')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('arkshop.loadFromServer.empty')}</p>
        )}

        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <p className="card-text" style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('arkshop.loadFromServer.manualHint')}</p>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          <button onClick={handleUploadClick} disabled={loading} className="btn btn-secondary btn-sm">
            <Upload size={14} /> {loading ? t('arkshop.loadFromServer.uploading') : t('arkshop.loadFromServer.uploadButton')}
          </button>
        </div>
      </div>
    </div>
  )

  // ===== MAIN RENDER =====
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingBag size={24} style={{ color: 'var(--accent)' }} /> {t('arkshop.heading')}</h1>
          <p className="page-subtitle">{t('arkshop.subtitleStats', { items: shopItems.length, kits: kits.length, sell: sellItems.length })}</p>
        </div>
        <div className="page-header-actions">
          <button onClick={handleReset} className="btn btn-secondary btn-sm" style={{ color: '#dc2626' }}><RotateCcw size={14} /> {t('arkshop.actions.reset')}</button>
          <button onClick={handleUploadClick} className="btn btn-secondary btn-sm"><Upload size={14} /> {t('arkshop.actions.reload')}</button>
          <button onClick={handleExport} className="btn btn-secondary btn-sm"><Download size={14} /> {t('arkshop.actions.export')}</button>
          <button onClick={() => setShowDeploy(!showDeploy)} className="btn btn-primary btn-sm" disabled={pushing}>
            {pushing ? <Loader2 size={14} className="pl-spin" /> : <CloudUpload size={14} />} {t('arkshop.actions.deploy')}
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
      {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14}/></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}

      {/* Deploy panel */}
      {showDeploy && (
        <div className="pl-sync-panel" style={{ marginBottom: '1rem' }}>
          <div className="pl-sync-header">
            <span className="pl-sync-title"><CloudUpload size={14} /> {t('arkshop.deploy.title')}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button onClick={() => { loadArkServers(); setPushResults(null) }} className="pl-btn-icon" style={{ width: 22, height: 22 }} title={t('arkshop.deploy.refreshList')}>
                <RefreshCw size={12} />
              </button>
              <button onClick={() => setShowDeploy(false)} className="pl-btn-icon" style={{ width: 22, height: 22 }}><X size={12} /></button>
            </div>
          </div>
          <div className="pl-sync-body">

            {/* Salva versione */}
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.8rem', padding: '0.6rem', background: 'var(--bg-hover)', borderRadius: '8px' }}>
              <Archive size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <input type="text" value={versionLabel} onChange={e => setVersionLabel(e.target.value)}
                placeholder={t('arkshop.deploy.versionPlaceholder')} className="form-input"
                style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                onKeyDown={e => e.key === 'Enter' && handleSaveVersion()} />
              <button onClick={handleSaveVersion} disabled={savingVersion || !versionLabel.trim()}
                className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                {savingVersion ? <Loader2 size={12} className="pl-spin" /> : <Save size={12} />} {t('arkshop.deploy.saveVersion')}
              </button>
              <button onClick={() => setShowVersions(!showVersions)} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                <Clock size={12} /> {versions.length}
              </button>
            </div>

            {/* Lista versioni (toggle) */}
            {showVersions && versions.length > 0 && (
              <div style={{ marginBottom: '0.8rem' }}>
                <table className="pl-sync-table">
                  <thead><tr><th>{t('arkshop.deploy.versionColumn')}</th><th>{t('arkshop.deploy.dateColumn')}</th><th>{t('arkshop.deploy.itemsColumn')}</th><th>{t('arkshop.deploy.kitsColumn')}</th><th style={{ width: 160 }}></th></tr></thead>
                  <tbody>
                    {versions.map(v => (
                      <tr key={v.id} style={deployVersionId === v.id ? { background: 'rgba(37,99,235,0.06)' } : {}}>
                        <td>
                          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{v.label}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>#{v.id}</span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {new Date(v.created_at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>{v.shop_items}</td>
                        <td style={{ fontSize: '0.78rem' }}>{v.kits}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setDeployVersionId(deployVersionId === v.id ? null : v.id)}
                              className={`btn btn-sm ${deployVersionId === v.id ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ padding: '0.15rem 0.4rem' }} title={t('arkshop.deploy.selectForDeploy')}>
                              <Play size={10} />
                            </button>
                            <button onClick={() => handleRestoreVersion(v.id)}
                              className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem' }} title={t('arkshop.deploy.restoreCurrent')}>
                              <RotateCcw size={10} />
                            </button>
                            <button onClick={() => handleDeleteVersion(v.id)}
                              className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem', color: '#dc2626' }} title={t('arkshop.deploy.deleteTitle')}>
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sorgente deploy */}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {t('arkshop.deploy.source')} <strong>{deployVersionId ? t('arkshop.deploy.sourceVersion', { id: deployVersionId, label: versions.find(v => v.id === deployVersionId)?.label || '?' }) : t('arkshop.deploy.sourceCurrent')}</strong>
              {deployVersionId && <button onClick={() => setDeployVersionId(null)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.7rem', marginLeft: '0.3rem' }}>{t('arkshop.deploy.useCurrent')}</button>}
            </div>

            {/* Tabella server con deploy */}
            {arkServers.length > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.4rem' }}>
                  <button onClick={() => handleDeploy(deployVersionId ?? undefined)}
                    disabled={pushing || arkServers.length === 0}
                    className="btn btn-primary btn-sm">
                    {pushing ? <Loader2 size={12} className="pl-spin" /> : <CloudUpload size={12} />} {t('arkshop.deploy.deployAll')}
                  </button>
                </div>
                <table className="pl-sync-table">
                  <thead><tr><th>{t('arkshop.loadFromServer.columnContainer')}</th><th>{t('arkshop.loadFromServer.columnServer')}</th><th>{t('arkshop.loadFromServer.columnMap')}</th><th>{t('arkshop.loadFromServer.columnHost')}</th><th style={{ width: 130 }}></th></tr></thead>
                  <tbody>
                    {arkServers.map((s, i) => {
                      const result = pushResults?.results?.find((r: any) => r.container === s.container_name && r.machine === s.machine_name)
                      return (
                        <tr key={i}>
                          <td><span className="pl-sync-mono">{s.container_name}</span></td>
                          <td>{s.server_name || s.machine_name}</td>
                          <td>{s.map_name || '-'}</td>
                          <td><span className="pl-sync-mono">{s.hostname}</span></td>
                          <td style={{ textAlign: 'right' }}>
                            {result ? (
                              result.status === 'deployed'
                                ? <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}><CheckCircle size={11} /> {t('arkshop.deploy.deployed')}</span>
                                : result.status === 'running'
                                  ? <span style={{ color: '#d97706', fontSize: '0.75rem' }}><Play size={11} /> {t('arkshop.deploy.active')}</span>
                                  : <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }} title={result.message}><AlertCircle size={11} /> {t('arkshop.deploy.errorStatus')}</span>
                            ) : (
                              <button onClick={() => handleDeploy(deployVersionId ?? undefined, s.machine_id, s.container_name)}
                                disabled={pushing} className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem' }}>
                                {pushing ? <Loader2 size={11} className="pl-spin" /> : <CloudUpload size={11} />} {t('arkshop.deploy.deploySingle')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {t('arkshop.deploy.noServers')}
              </p>
            )}
            {pushResults && (
              <div className={`pl-alert ${pushResults.failed === 0 && pushResults.skipped_running === 0 ? 'pl-alert-ok' : 'pl-alert-err'}`} style={{ marginTop: '0.5rem' }}>
                {pushResults.failed === 0 && pushResults.skipped_running === 0 ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {' '}{t('arkshop.deploy.resultDeployed', { count: pushResults.deployed })}
                {pushResults.skipped_running > 0 && <>{t('arkshop.deploy.resultSkipped', { count: pushResults.skipped_running })}</>}
                {pushResults.failed > 0 && <>{t('arkshop.deploy.resultFailed', { count: pushResults.failed })}</>}
                {' '}{t('arkshop.deploy.resultSuffix', { total: pushResults.total })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="sf-tabs">
        {([
          { id: 'shop', label: t('arkshop.tabs.shop'), icon: ShoppingBag, count: shopItems.length },
          { id: 'kits', label: t('arkshop.tabs.kits'), icon: Package, count: kits.length },
          { id: 'sell', label: t('arkshop.tabs.sell'), icon: DollarSign, count: sellItems.length },
          { id: 'general', label: t('arkshop.tabs.general'), icon: Settings },
          { id: 'mysql', label: t('arkshop.tabs.mysql'), icon: Database },
          { id: 'messages', label: t('arkshop.tabs.messages'), icon: MessageSquare },
        ] as { id: Tab; label: string; icon: any; count?: number }[]).map(tb => (
          <button key={tb.id} className={`sf-tab ${tab === tb.id ? 'sf-tab-active' : ''}`} onClick={() => setTab(tb.id)}>
            <tb.icon size={14} style={{ marginRight: '0.3rem', verticalAlign: '-2px' }} />
            {tb.label} {tb.count != null && <span style={{ opacity: 0.6, marginLeft: '0.2rem' }}>({tb.count})</span>}
          </button>
        ))}
      </div>

      {/* ==================== SHOP ITEMS - Lista a righe ==================== */}
      {tab === 'shop' && (<div>
        <div className="dc-filters" style={{ marginBottom: '0.75rem' }}>
          <div className="pl-search-input-wrap"><Search size={16} className="pl-search-icon" />
            <input type="text" value={shopSearch} onChange={e => setShopSearch(e.target.value)} className="pl-search-input" placeholder={t('arkshop.shop.searchPlaceholder')} /></div>
          <select value={shopTypeFilter} onChange={e => setShopTypeFilter(e.target.value)} className="dc-select">
            <option value="">{t('arkshop.shop.filterAll')}</option><option value="item">{t('arkshop.shop.filterItem')}</option><option value="command">{t('arkshop.shop.filterCommand')}</option><option value="dino">{t('arkshop.shop.filterDino')}</option>
          </select>
          <button onClick={() => openShopDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> {t('arkshop.shop.new')}</button>
        </div>
        <div className="as-list">
          {filteredShop.map(item => (
            <div key={item.key} className="as-list-item">
              <div className="as-list-row" onClick={() => setExpandedItem(expandedItem === item.key ? null : item.key)}>
                <span className="as-list-title">{item.Title || item.key}</span>
                <span className="as-list-type">{item.Type || t('arkshop.shop.defaultType')}</span>
                <span className="as-list-price"><DollarSign size={11} /> {item.Price}</span>
                <div className="as-list-perms">
                  {(item.Permissions || '').split(',').map((p: string) => p.trim()).filter(Boolean).slice(0, 3).map((p: string) => <span key={p} className="pl-chip">{p}</span>)}
                </div>
                <span className="as-list-count">{t('arkshop.shop.objectsShort', { count: item.Items?.length || 0 })}</span>
                <div className="as-list-actions">
                  <button onClick={e => { e.stopPropagation(); openShopDialog(item) }} className="btn btn-sm btn-ghost" title={t('arkshop.shop.editTooltip')}><Edit3 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete('shop', item.key) }} className="btn btn-sm btn-danger" title={t('arkshop.shop.deleteTooltip')}><Trash2 size={13} /></button>
                </div>
                {expandedItem === item.key ? <ChevronUp size={14} className="as-list-chevron" /> : <ChevronDown size={14} className="as-list-chevron" />}
              </div>
              {expandedItem === item.key && item.Items?.length > 0 && (
                <div className="as-list-expand">
                  {item.Items.map((it: any, idx: number) => (
                    <div key={idx} className="as-bp-row">
                      {it.Blueprint ? (<>
                        <span className="as-bp-amount">{it.Amount}x</span>
                        <span className="as-bp-name">{bpName(it.Blueprint)}</span>
                        {it.Quality > 0 && <span className="as-bp-quality">Q{it.Quality}</span>}
                        {it.ForceBlueprint && <span className="as-bp-tag">{t('arkshop.sub.bp')}</span>}
                      </>) : (<>
                        <span className="as-bp-amount" style={{ color: '#64748b' }}>{t('arkshop.shop.bpCommandTag')}</span>
                        <span className="as-bp-name">{it.Command || it.DisplayAs || '?'}</span>
                        {it.ExecuteAsAdmin && <span className="as-bp-tag" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>{t('arkshop.shop.bpAdminTag')}</span>}
                      </>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>)}

      {/* ==================== KITS - Lista a righe ==================== */}
      {tab === 'kits' && (<div>
        <div style={{ marginBottom: '0.75rem' }}><button onClick={() => openKitDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> {t('arkshop.kits.new')}</button></div>
        <div className="as-list">
          {kits.map(kit => (
            <div key={kit.key} className="as-list-item">
              <div className="as-list-row" onClick={() => setExpandedItem(expandedItem === kit.key ? null : kit.key)}>
                <span className="as-list-title">{kit.key}</span>
                <span className="as-list-type">{t('arkshop.kits.kitTypeLabel')}</span>
                <span className="as-list-price"><DollarSign size={11} /> {kit.Price}</span>
                <div className="as-list-perms">
                  {(kit.Permissions || '').split(',').map((p: string) => p.trim()).filter(Boolean).slice(0, 3).map((p: string) => <span key={p} className="pl-chip">{p}</span>)}
                </div>
                <span className="as-list-count">{t('arkshop.kits.itemsShort', { count: kit.Items?.length || 0 })}</span>
                <div className="as-list-actions">
                  <button onClick={e => { e.stopPropagation(); openKitDialog(kit) }} className="btn btn-sm btn-ghost"><Edit3 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete('kit', kit.key) }} className="btn btn-sm btn-danger"><Trash2 size={13} /></button>
                </div>
                {expandedItem === kit.key ? <ChevronUp size={14} className="as-list-chevron" /> : <ChevronDown size={14} className="as-list-chevron" />}
              </div>
              {expandedItem === kit.key && (
                <div className="as-list-expand">
                  <div className="as-kit-meta" style={{ marginBottom: '0.4rem' }}>
                    {kit.DefaultAmount != null && <span>{t('arkshop.kits.qty', { count: kit.DefaultAmount })}</span>}
                    {kit.MaxLevel != null && <span>{t('arkshop.kits.maxLv', { level: kit.MaxLevel })}</span>}
                    {kit.OnlyFromSpawn && <span>{t('arkshop.kits.onlyFromSpawn')}</span>}
                  </div>
                  {kit.Items?.map((it: any, idx: number) => (
                    <div key={idx} className="as-bp-row"><span className="as-bp-amount">{it.Amount}x</span><span className="as-bp-name">{bpName(it.Blueprint)}</span>{it.Quality > 0 && <span className="as-bp-quality">Q{it.Quality}</span>}{it.ForceBlueprint && <span className="as-bp-tag">{t('arkshop.sub.bp')}</span>}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>)}

      {/* ==================== SELL ITEMS - Lista a righe ==================== */}
      {tab === 'sell' && (<div>
        <div style={{ marginBottom: '0.75rem' }}><button onClick={() => openSellDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> {t('arkshop.sell.new')}</button></div>
        <div className="as-list">
          {sellItems.map(item => (
            <div key={item.key} className="as-list-item">
              <div className="as-list-row">
                <span className="as-list-title">{item.key}</span>
                <span className="as-list-type">{item.Type || t('arkshop.shop.defaultType')}</span>
                <span className="as-list-price"><DollarSign size={11} /> {t('arkshop.sell.pricePts', { price: item.Price })}</span>
                <span className="as-list-count">{item.Amount}x {bpName(item.Blueprint)}</span>
                <div className="as-list-actions">
                  <button onClick={() => openSellDialog(item)} className="btn btn-sm btn-ghost"><Edit3 size={13} /></button>
                  <button onClick={() => handleDelete('sell', item.key)} className="btn btn-sm btn-danger"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>)}

      {/* ==================== GENERAL ==================== */}
      {tab === 'general' && (<div className="card">
        <h3 className="card-title"><Settings size={16} style={{color:'var(--accent)'}} /> {t('arkshop.general.title')}</h3>
        <div className="as-general-grid">
          <div className="as-gen-section">{t('arkshop.general.sectionDisplay')}</div>
          <div className="as-gen-field"><label>{t('arkshop.general.itemsPerPage')}</label><input type="number" value={general.ItemsPerPage??10} onChange={e=>setGeneral({...general,ItemsPerPage:parseInt(e.target.value)||10})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.general.shopTextSize')}</label><input type="number" step="0.1" value={general.ShopTextSize??1.5} onChange={e=>setGeneral({...general,ShopTextSize:parseFloat(e.target.value)||1.5})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.general.shopDisplayTime')}</label><input type="number" value={general.ShopDisplayTime??15} onChange={e=>setGeneral({...general,ShopDisplayTime:parseInt(e.target.value)||15})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.general.defaultKit')}</label><input type="text" value={general.DefaultKit??''} onChange={e=>setGeneral({...general,DefaultKit:e.target.value})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.general.dbPathOverride')}</label><input type="text" value={general.DbPathOverride??''} onChange={e=>setGeneral({...general,DbPathOverride:e.target.value})} /></div>
          <div className="as-gen-section">{t('arkshop.general.sectionOptions')}</div>
          {[['GiveDinosInCryopods',t('arkshop.general.optGiveDinosInCryopods')],['CryoLimitedTime',t('arkshop.general.optCryoLimitedTime')],['PreventUseCarried',t('arkshop.general.optPreventUseCarried')],
            ['PreventUseHandcuffed',t('arkshop.general.optPreventUseHandcuffed')],['PreventUseNoglin',t('arkshop.general.optPreventUseNoglin')],['PreventUseUnconscious',t('arkshop.general.optPreventUseUnconscious')],
            ['UseOriginalTradeCommandWithUI',t('arkshop.general.optUseOriginalTradeCommandWithUI')]].map(([k,l])=>(
            <div key={k} className="as-gen-check"><label><input type="checkbox" checked={general[k]??false} onChange={e=>setGeneral({...general,[k]:e.target.checked})} /> {l}</label></div>))}
          <div className="as-gen-section">{t('arkshop.general.sectionDiscord')}</div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.Discord?.Enabled??false} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),Enabled:e.target.checked}})} /> {t('arkshop.general.discordEnabled')}</label></div>
          <div className="as-gen-field"><label>{t('arkshop.general.discordSenderName')}</label><input type="text" value={general.Discord?.SenderName??''} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),SenderName:e.target.value}})} /></div>
          <div className="as-gen-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.general.discordWebhookUrl')}</label><input type="text" value={general.Discord?.URL??''} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),URL:e.target.value}})} /></div>
          <div className="as-gen-section">{t('arkshop.general.sectionTimedPoints')}</div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.Enabled??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),Enabled:e.target.checked}})} /> {t('arkshop.general.timedEnabled')}</label></div>
          <div className="as-gen-field"><label>{t('arkshop.general.timedInterval')}</label><input type="number" value={general.TimedPointsReward?.Interval??10} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),Interval:parseInt(e.target.value)||10}})} /></div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.AlwaysSendNotifications??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),AlwaysSendNotifications:e.target.checked}})} /> {t('arkshop.general.timedAlwaysSend')}</label></div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.StackRewards??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),StackRewards:e.target.checked}})} /> {t('arkshop.general.timedStack')}</label></div>
          {general.TimedPointsReward?.Groups && Object.entries(general.TimedPointsReward.Groups).map(([g,v]:any)=>(
            <div key={g} className="as-gen-field"><label>{t('arkshop.general.timedGroupPoints', { group: g })}</label><input type="number" value={v.Amount??0} onChange={e=>setGeneral({...general,TimedPointsReward:{...general.TimedPointsReward,Groups:{...general.TimedPointsReward.Groups,[g]:{Amount:parseInt(e.target.value)||0}}}})} /></div>))}
        </div>
        <button onClick={saveGeneral} className="btn btn-primary mt-4"><Save size={14} /> {t('arkshop.dialog.save')}</button>
      </div>)}

      {/* ==================== MYSQL ==================== */}
      {tab === 'mysql' && (<div className="card">
        <h3 className="card-title"><Database size={16} style={{color:'var(--accent)'}} /> {t('arkshop.mysql.title')}</h3>
        <div className="as-general-grid">
          <div className="as-gen-check"><label><input type="checkbox" checked={mysql.UseMysql??true} onChange={e=>setMysql({...mysql,UseMysql:e.target.checked})} /> {t('arkshop.mysql.useMysql')}</label></div>
          <div className="as-gen-field"><label>{t('arkshop.mysql.host')}</label><input type="text" value={mysql.MysqlHost??''} onChange={e=>setMysql({...mysql,MysqlHost:e.target.value})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.mysql.port')}</label><input type="number" value={mysql.MysqlPort??3306} onChange={e=>setMysql({...mysql,MysqlPort:parseInt(e.target.value)||3306})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.mysql.database')}</label><input type="text" value={mysql.MysqlDB??''} onChange={e=>setMysql({...mysql,MysqlDB:e.target.value})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.mysql.user')}</label><input type="text" value={mysql.MysqlUser??''} onChange={e=>setMysql({...mysql,MysqlUser:e.target.value})} /></div>
          <div className="as-gen-field"><label>{t('arkshop.mysql.password')}</label><input type="password" value={mysql.MysqlPass??''} onChange={e=>setMysql({...mysql,MysqlPass:e.target.value})} /></div>
        </div>
        <button onClick={saveMysql} className="btn btn-primary mt-4"><Save size={14} /> {t('arkshop.dialog.save')}</button>
      </div>)}

      {/* ==================== MESSAGES ==================== */}
      {tab === 'messages' && (<div className="card">
        <h3 className="card-title"><MessageSquare size={16} style={{color:'var(--accent)'}} /> {t('arkshop.messages.title')}</h3>
        <div className="as-msg-grid">
          {Object.entries(messages).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>(
            <div key={key} className="as-msg-row"><label className="as-msg-key">{key}</label>
              <input type="text" value={String(val)} className="as-msg-input" onChange={e=>setMessages({...messages,[key]:e.target.value})} /></div>))}
        </div>
        <button onClick={saveMessages} className="btn btn-primary mt-4"><Save size={14} /> {t('arkshop.dialog.save')}</button>
      </div>)}

      {/* ==================== EDIT DIALOG ==================== */}
      {dialogOpen && dialogData && (
        <EditDialog title={dialogIsNew ? (dialogType === 'shop' ? t('arkshop.dialog.newShop') : dialogType === 'kit' ? t('arkshop.dialog.newKit') : t('arkshop.dialog.newSell')) : t('arkshop.dialog.editPrefix', { key: dialogData.key })}
          onClose={() => setDialogOpen(false)}>

          {/* Shop Item dialog */}
          {dialogType === 'shop' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.keyId')}</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.title')}</label>
                <input type="text" value={dialogData.Title ?? ''} onChange={e => setDialogData({...dialogData, Title: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>{t('arkshop.dialog.description')}</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.price')}</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.type')}</label>
                <select value={dialogData.Type ?? 'item'} onChange={e => setDialogData({...dialogData, Type: e.target.value})}>
                  <option value="item">{t('arkshop.dialog.optItem')}</option><option value="command">{t('arkshop.dialog.optCommand')}</option><option value="dino">{t('arkshop.dialog.optDino')}</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.permissions')}</label>
                <input type="text" value={dialogData.Permissions ?? ''} onChange={e => setDialogData({...dialogData, Permissions: e.target.value})} placeholder={t('arkshop.dialog.permissionsPlaceholder')} /></div>
            </div>
            <div className="as-dlg-section">{t('arkshop.dialog.contentCount', { count: (dialogData.Items||[]).length })}</div>
            <SubItemEditor items={dialogData.Items || []} onChange={items => setDialogData({...dialogData, Items: items})} />
          </>)}

          {/* Kit dialog */}
          {dialogType === 'kit' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.keyId')}</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.description')}</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.price')}</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.defaultAmount')}</label>
                <input type="number" value={dialogData.DefaultAmount ?? 1} onChange={e => setDialogData({...dialogData, DefaultAmount: parseInt(e.target.value)||1})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.maxLevel')}</label>
                <input type="number" value={dialogData.MaxLevel ?? 0} onChange={e => setDialogData({...dialogData, MaxLevel: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.onlyFromSpawn')}</label>
                <select value={dialogData.OnlyFromSpawn ? '1' : '0'} onChange={e => setDialogData({...dialogData, OnlyFromSpawn: e.target.value==='1'})}>
                  <option value="0">{t('arkshop.dialog.selectNo')}</option><option value="1">{t('arkshop.dialog.selectYes')}</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>{t('arkshop.dialog.permissions')}</label>
                <input type="text" value={dialogData.Permissions ?? ''} onChange={e => setDialogData({...dialogData, Permissions: e.target.value})} /></div>
            </div>
            <div className="as-dlg-section">{t('arkshop.dialog.itemsCount', { count: (dialogData.Items||[]).length })}</div>
            <SubItemEditor items={dialogData.Items || []} onChange={items => setDialogData({...dialogData, Items: items})} />
          </>)}

          {/* Sell Item dialog */}
          {dialogType === 'sell' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.keyId')}</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.description')}</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.pricePts')}</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>{t('arkshop.dialog.amount')}</label>
                <input type="number" value={dialogData.Amount ?? 1} onChange={e => setDialogData({...dialogData, Amount: parseInt(e.target.value)||1})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>{t('arkshop.dialog.type')}</label>
                <select value={dialogData.Type ?? 'item'} onChange={e => setDialogData({...dialogData, Type: e.target.value})}>
                  <option value="item">{t('arkshop.dialog.optItem')}</option><option value="dino">{t('arkshop.dialog.optDino')}</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>{t('arkshop.dialog.blueprint')}</label>
                <BlueprintSearch value={dialogData.Blueprint ?? ''} onChange={v => setDialogData({...dialogData, Blueprint: v})} /></div>
            </div>
          </>)}

          {/* Dialog footer */}
          <div className="as-dlg-footer">
            <button onClick={handleDialogSave} className="btn btn-primary"><Save size={14} /> {t('arkshop.dialog.save')}</button>
            <button onClick={() => setDialogOpen(false)} className="btn btn-secondary"><X size={14} /> {t('arkshop.dialog.cancel')}</button>
            {!dialogIsNew && <button onClick={() => handleDelete(dialogType, dialogData.key)} className="btn btn-danger" style={{marginLeft:'auto'}}><Trash2 size={14} /> {t('arkshop.dialog.delete')}</button>}
          </div>
        </EditDialog>
      )}
    </div>
  )
}
