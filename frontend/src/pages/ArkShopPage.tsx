/**
 * ArkShopPage — ArkShop plugin configuration editor.
 * Row-based layout, modal dialog for editing, blueprint search from local DB.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
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
    const t = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(t)
  }, [query, doSearch])

  return (
    <div className="bp-search-wrap" ref={ref}>
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (query.length >= 2) setOpen(true) }}
        className="as-edit-field-input" placeholder="Cerca o incolla blueprint..." />
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
                  <label>Command</label>
                  <input type="text" value={it.Command ?? ''} onChange={e => update(idx, 'Command', e.target.value)} />
                </div>
                <div className="as-sub-field" style={{ flex: 1 }}>
                  <label>DisplayAs</label>
                  <input type="text" value={it.DisplayAs ?? ''} onChange={e => update(idx, 'DisplayAs', e.target.value)} />
                </div>
                <div className="as-sub-field" style={{ width: 70 }}>
                  <label>Admin</label>
                  <select value={it.ExecuteAsAdmin ? '1' : '0'} onChange={e => update(idx, 'ExecuteAsAdmin', e.target.value === '1')}>
                    <option value="0">No</option><option value="1">Si</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="as-sub-fields">
                <div className="as-sub-field" style={{ flex: 3 }}>
                  <label>Blueprint</label>
                  <BlueprintSearch value={it.Blueprint ?? ''} onChange={v => update(idx, 'Blueprint', v)} />
                </div>
                <div className="as-sub-field" style={{ width: 65 }}>
                  <label>Qty</label>
                  <input type="number" value={it.Amount ?? 1} onChange={e => update(idx, 'Amount', parseInt(e.target.value) || 1)} />
                </div>
                <div className="as-sub-field" style={{ width: 60 }}>
                  <label>Quality</label>
                  <input type="number" value={it.Quality ?? 0} onChange={e => update(idx, 'Quality', parseInt(e.target.value) || 0)} />
                </div>
                <div className="as-sub-field" style={{ width: 50 }}>
                  <label>BP</label>
                  <select value={it.ForceBlueprint ? '1' : '0'} onChange={e => update(idx, 'ForceBlueprint', e.target.value === '1')}>
                    <option value="0">No</option><option value="1">Si</option>
                  </select>
                </div>
              </div>
            )}
            <button onClick={() => remove(idx)} className="as-sub-remove"><Trash2 size={12} /></button>
          </div>
        )
      })}
      <div className="as-sub-add">
        <button className="btn btn-sm btn-secondary" onClick={addItem}><Plus size={12} /> Item</button>
        <button className="btn btn-sm btn-ghost" onClick={addCmd}><Plus size={12} /> Comando</button>
      </div>
    </div>
  )
}

// ===== MAIN =====
export default function ArkShopPage() {
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

  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t) } }, [success])

  // Lifecycle
  async function handleReset() {
    if (!confirm('Resettare tutta la configurazione ArkShop? Dovrai ricaricarla da un server.')) return
    try {
      await arkshopApi.deleteConfig()
      setConfigLoaded(false)
      setShopItems([]); setKits([]); setSellItems([])
      setMysql({}); setGeneral({}); setMessages({})
      setSuccess('Configurazione resettata')
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore reset') }
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
      setConfigLoaded(true); setSuccess('Configurazione caricata'); loadAll()
    } catch (err: any) { setError(err.message?.includes('JSON') ? 'JSON non valido (controlla formato)' : (err.response?.data?.detail || err.message)) }
    finally { setLoading(false); e.target.value = '' }
  }
  async function handleExport() {
    try {
      const res = await arkshopApi.exportConfig()
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })); a.download = 'ArkShop.json'; a.click()
      setSuccess('Esportato')
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
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
      setSuccess(`Config caricata da ${res.data.source}: ${res.data.shop_items} items, ${res.data.kits} kits`)
      setConfigLoaded(true)
      loadAll()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore pull') }
    finally { setPulling(false) }
  }

  async function handleDeploy(versionId?: number, machineId?: number, containerName?: string) {
    setPushing(true); setError(''); setPushResults(null)
    try {
      const res = await arkshopApi.deploy(versionId ?? undefined, machineId, containerName)
      setPushResults(res.data)
      const d = res.data
      if (d.deployed > 0 && d.failed === 0 && d.skipped_running === 0) {
        setSuccess(`${d.version}: deployata su ${d.deployed}/${d.total} server`)
      } else if (d.deployed > 0) {
        setSuccess(`${d.version}: ${d.deployed} OK, ${d.skipped_running} attivi (saltati), ${d.failed} errori`)
      } else if (d.skipped_running > 0) {
        setError(`Nessun deploy: ${d.skipped_running} container attivi. Spegnili prima.`)
      } else {
        setError(`Deploy fallito: ${d.failed} errori`)
      }
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore deploy') }
    finally { setPushing(false) }
  }

  async function loadVersions() {
    try {
      const res = await arkshopApi.listVersions()
      setVersions(res.data.versions || [])
    } catch {}
  }

  async function handleSaveVersion() {
    if (!versionLabel.trim()) { setError('Inserisci un nome per la versione'); return }
    setSavingVersion(true); setError('')
    try {
      const res = await arkshopApi.saveVersion(versionLabel.trim())
      setSuccess(`Versione "${res.data.label}" salvata (${res.data.total_versions} totali)`)
      setVersionLabel('')
      loadVersions()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore salvataggio versione') }
    finally { setSavingVersion(false) }
  }

  async function handleRestoreVersion(id: number) {
    try {
      const res = await arkshopApi.restoreVersion(id)
      setSuccess(`Versione "${res.data.label}" ripristinata: ${res.data.shop_items} items, ${res.data.kits} kits`)
      loadAll()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore ripristino') }
  }

  async function handleDeleteVersion(id: number) {
    if (!confirm('Eliminare questa versione?')) return
    try {
      await arkshopApi.deleteVersion(id)
      setSuccess('Versione eliminata')
      loadVersions()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
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
    if (!dialogData?.key) { setError('Chiave obbligatoria'); return }
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
      setSuccess(`"${key}" salvato`); setDialogOpen(false)
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore salvataggio') }
  }

  // ===== Delete =====
  async function handleDelete(type: string, key: string) {
    if (!confirm(`Eliminare "${key}"?`)) return
    try {
      if (type === 'shop') { await arkshopApi.deleteShopItem(key); setShopItems(p => p.filter(i => i.key !== key)) }
      else if (type === 'kit') { await arkshopApi.deleteKit(key); setKits(p => p.filter(i => i.key !== key)) }
      else { await arkshopApi.deleteSellItem(key); setSellItems(p => p.filter(i => i.key !== key)) }
      setSuccess(`"${key}" eliminato`); setDialogOpen(false)
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
  }

  // General/MySQL/Messages saves
  async function saveMysql() { try { await arkshopApi.updateMysql(mysql); setSuccess('MySQL salvato') } catch (err: any) { setError(err.response?.data?.detail || 'Errore') } }
  async function saveGeneral() { try { await arkshopApi.updateGeneral(general); setSuccess('Generali salvate') } catch (err: any) { setError(err.response?.data?.detail || 'Errore') } }
  async function saveMessages() { try { await arkshopApi.updateMessages(messages); setSuccess('Messaggi salvati') } catch (err: any) { setError(err.response?.data?.detail || 'Errore') } }

  // Filters
  const filteredShop = shopItems.filter(item => {
    if (shopSearch && !item.Title?.toLowerCase().includes(shopSearch.toLowerCase()) && !item.key?.toLowerCase().includes(shopSearch.toLowerCase())) return false
    if (shopTypeFilter && item.Type !== shopTypeFilter) return false; return true
  })

  // ===== No config =====
  if (!configLoaded) return (
    <div>
      <div className="page-header"><div>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingBag size={24} style={{ color: 'var(--accent)' }} /> ArkShop</h1>
        <p className="page-subtitle">Editor configurazione plugin ArkShop</p>
      </div></div>
      {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14}/></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}

      <div className="card" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <CloudDownload size={18} /> Carica config da un server
        </h3>
        <p className="card-text" style={{ marginBottom: '1rem' }}>Seleziona un container con ArkShop per importare automaticamente la configurazione.</p>

        {loadingServers ? (
          <p style={{ color: 'var(--text-muted)' }}><Loader2 size={14} className="pl-spin" /> Ricerca server...</p>
        ) : arkServers.length > 0 ? (
          <table className="pl-sync-table">
            <thead><tr><th>Container</th><th>Server</th><th>Mappa</th><th>Host</th><th style={{ width: 80 }}></th></tr></thead>
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
                      {pulling ? <Loader2 size={12} className="pl-spin" /> : <CloudDownload size={12} />} Pull
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nessun container con ArkShop trovato. Esegui prima una scansione dalla pagina Container.</p>
        )}

        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <p className="card-text" style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Oppure carica manualmente:</p>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          <button onClick={handleUploadClick} disabled={loading} className="btn btn-secondary btn-sm">
            <Upload size={14} /> {loading ? 'Caricamento...' : 'Carica file JSON'}
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
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingBag size={24} style={{ color: 'var(--accent)' }} /> ArkShop</h1>
          <p className="page-subtitle">{shopItems.length} articoli &middot; {kits.length} kit &middot; {sellItems.length} vendibili</p>
        </div>
        <div className="page-header-actions">
          <button onClick={handleReset} className="btn btn-secondary btn-sm" style={{ color: '#dc2626' }}><RotateCcw size={14} /> Reset</button>
          <button onClick={handleUploadClick} className="btn btn-secondary btn-sm"><Upload size={14} /> Ricarica</button>
          <button onClick={handleExport} className="btn btn-secondary btn-sm"><Download size={14} /> Esporta</button>
          <button onClick={() => setShowDeploy(!showDeploy)} className="btn btn-primary btn-sm" disabled={pushing}>
            {pushing ? <Loader2 size={14} className="pl-spin" /> : <CloudUpload size={14} />} Deploy
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
            <span className="pl-sync-title"><CloudUpload size={14} /> Deploy su Server</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button onClick={() => { loadArkServers(); setPushResults(null) }} className="pl-btn-icon" style={{ width: 22, height: 22 }} title="Aggiorna lista">
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
                placeholder="Nome versione (es. v1.2 promo estate)" className="form-input"
                style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                onKeyDown={e => e.key === 'Enter' && handleSaveVersion()} />
              <button onClick={handleSaveVersion} disabled={savingVersion || !versionLabel.trim()}
                className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                {savingVersion ? <Loader2 size={12} className="pl-spin" /> : <Save size={12} />} Salva
              </button>
              <button onClick={() => setShowVersions(!showVersions)} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                <Clock size={12} /> {versions.length}
              </button>
            </div>

            {/* Lista versioni (toggle) */}
            {showVersions && versions.length > 0 && (
              <div style={{ marginBottom: '0.8rem' }}>
                <table className="pl-sync-table">
                  <thead><tr><th>Versione</th><th>Data</th><th>Items</th><th>Kits</th><th style={{ width: 160 }}></th></tr></thead>
                  <tbody>
                    {versions.map(v => (
                      <tr key={v.id} style={deployVersionId === v.id ? { background: 'rgba(37,99,235,0.06)' } : {}}>
                        <td>
                          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{v.label}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>#{v.id}</span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {new Date(v.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>{v.shop_items}</td>
                        <td style={{ fontSize: '0.78rem' }}>{v.kits}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setDeployVersionId(deployVersionId === v.id ? null : v.id)}
                              className={`btn btn-sm ${deployVersionId === v.id ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ padding: '0.15rem 0.4rem' }} title="Seleziona per deploy">
                              <Play size={10} />
                            </button>
                            <button onClick={() => handleRestoreVersion(v.id)}
                              className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem' }} title="Ripristina come corrente">
                              <RotateCcw size={10} />
                            </button>
                            <button onClick={() => handleDeleteVersion(v.id)}
                              className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem', color: '#dc2626' }} title="Elimina">
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
              Deploy: <strong>{deployVersionId ? `Versione #${deployVersionId} - ${versions.find(v => v.id === deployVersionId)?.label || '?'}` : 'Config corrente'}</strong>
              {deployVersionId && <button onClick={() => setDeployVersionId(null)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.7rem', marginLeft: '0.3rem' }}>(usa corrente)</button>}
            </div>

            {/* Tabella server con deploy */}
            {arkServers.length > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.4rem' }}>
                  <button onClick={() => handleDeploy(deployVersionId ?? undefined)}
                    disabled={pushing || arkServers.length === 0}
                    className="btn btn-primary btn-sm">
                    {pushing ? <Loader2 size={12} className="pl-spin" /> : <CloudUpload size={12} />} Deploy su tutti (solo spenti)
                  </button>
                </div>
                <table className="pl-sync-table">
                  <thead><tr><th>Container</th><th>Server</th><th>Mappa</th><th>Host</th><th style={{ width: 130 }}></th></tr></thead>
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
                                ? <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}><CheckCircle size={11} /> Deployato</span>
                                : result.status === 'running'
                                  ? <span style={{ color: '#d97706', fontSize: '0.75rem' }}><Play size={11} /> Attivo</span>
                                  : <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }} title={result.message}><AlertCircle size={11} /> Errore</span>
                            ) : (
                              <button onClick={() => handleDeploy(deployVersionId ?? undefined, s.machine_id, s.container_name)}
                                disabled={pushing} className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem' }}>
                                {pushing ? <Loader2 size={11} className="pl-spin" /> : <CloudUpload size={11} />} Deploy
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
                Nessun container con ArkShop trovato.
              </p>
            )}
            {pushResults && (
              <div className={`pl-alert ${pushResults.failed === 0 && pushResults.skipped_running === 0 ? 'pl-alert-ok' : 'pl-alert-err'}`} style={{ marginTop: '0.5rem' }}>
                {pushResults.failed === 0 && pushResults.skipped_running === 0 ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {' '}{pushResults.deployed} deployati
                {pushResults.skipped_running > 0 && <>, {pushResults.skipped_running} saltati (attivi)</>}
                {pushResults.failed > 0 && <>, {pushResults.failed} errori</>}
                {' '}/ {pushResults.total} totali
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="sf-tabs">
        {([
          { id: 'shop', label: 'Shop Items', icon: ShoppingBag, count: shopItems.length },
          { id: 'kits', label: 'Kits', icon: Package, count: kits.length },
          { id: 'sell', label: 'Vendita', icon: DollarSign, count: sellItems.length },
          { id: 'general', label: 'Generale', icon: Settings },
          { id: 'mysql', label: 'MySQL', icon: Database },
          { id: 'messages', label: 'Messaggi', icon: MessageSquare },
        ] as { id: Tab; label: string; icon: any; count?: number }[]).map(t => (
          <button key={t.id} className={`sf-tab ${tab === t.id ? 'sf-tab-active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={14} style={{ marginRight: '0.3rem', verticalAlign: '-2px' }} />
            {t.label} {t.count != null && <span style={{ opacity: 0.6, marginLeft: '0.2rem' }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {/* ==================== SHOP ITEMS - Lista a righe ==================== */}
      {tab === 'shop' && (<div>
        <div className="dc-filters" style={{ marginBottom: '0.75rem' }}>
          <div className="pl-search-input-wrap"><Search size={16} className="pl-search-icon" />
            <input type="text" value={shopSearch} onChange={e => setShopSearch(e.target.value)} className="pl-search-input" placeholder="Cerca item..." /></div>
          <select value={shopTypeFilter} onChange={e => setShopTypeFilter(e.target.value)} className="dc-select">
            <option value="">Tutti</option><option value="item">Item</option><option value="command">Command</option><option value="dino">Dino</option>
          </select>
          <button onClick={() => openShopDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> Nuovo</button>
        </div>
        <div className="as-list">
          {filteredShop.map(item => (
            <div key={item.key} className="as-list-item">
              <div className="as-list-row" onClick={() => setExpandedItem(expandedItem === item.key ? null : item.key)}>
                <span className="as-list-title">{item.Title || item.key}</span>
                <span className="as-list-type">{item.Type || 'item'}</span>
                <span className="as-list-price"><DollarSign size={11} /> {item.Price}</span>
                <div className="as-list-perms">
                  {(item.Permissions || '').split(',').map((p: string) => p.trim()).filter(Boolean).slice(0, 3).map((p: string) => <span key={p} className="pl-chip">{p}</span>)}
                </div>
                <span className="as-list-count">{item.Items?.length || 0} obj</span>
                <div className="as-list-actions">
                  <button onClick={e => { e.stopPropagation(); openShopDialog(item) }} className="btn btn-sm btn-ghost" title="Modifica"><Edit3 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete('shop', item.key) }} className="btn btn-sm btn-danger" title="Elimina"><Trash2 size={13} /></button>
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
                        {it.ForceBlueprint && <span className="as-bp-tag">BP</span>}
                      </>) : (<>
                        <span className="as-bp-amount" style={{ color: '#64748b' }}>CMD</span>
                        <span className="as-bp-name">{it.Command || it.DisplayAs || '?'}</span>
                        {it.ExecuteAsAdmin && <span className="as-bp-tag" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>Admin</span>}
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
        <div style={{ marginBottom: '0.75rem' }}><button onClick={() => openKitDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> Nuovo Kit</button></div>
        <div className="as-list">
          {kits.map(kit => (
            <div key={kit.key} className="as-list-item">
              <div className="as-list-row" onClick={() => setExpandedItem(expandedItem === kit.key ? null : kit.key)}>
                <span className="as-list-title">{kit.key}</span>
                <span className="as-list-type">Kit</span>
                <span className="as-list-price"><DollarSign size={11} /> {kit.Price}</span>
                <div className="as-list-perms">
                  {(kit.Permissions || '').split(',').map((p: string) => p.trim()).filter(Boolean).slice(0, 3).map((p: string) => <span key={p} className="pl-chip">{p}</span>)}
                </div>
                <span className="as-list-count">{kit.Items?.length || 0} items</span>
                <div className="as-list-actions">
                  <button onClick={e => { e.stopPropagation(); openKitDialog(kit) }} className="btn btn-sm btn-ghost"><Edit3 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete('kit', kit.key) }} className="btn btn-sm btn-danger"><Trash2 size={13} /></button>
                </div>
                {expandedItem === kit.key ? <ChevronUp size={14} className="as-list-chevron" /> : <ChevronDown size={14} className="as-list-chevron" />}
              </div>
              {expandedItem === kit.key && (
                <div className="as-list-expand">
                  <div className="as-kit-meta" style={{ marginBottom: '0.4rem' }}>
                    {kit.DefaultAmount != null && <span>Qty: {kit.DefaultAmount}</span>}
                    {kit.MaxLevel != null && <span>MaxLv: {kit.MaxLevel}</span>}
                    {kit.OnlyFromSpawn && <span>Solo spawn</span>}
                  </div>
                  {kit.Items?.map((it: any, idx: number) => (
                    <div key={idx} className="as-bp-row"><span className="as-bp-amount">{it.Amount}x</span><span className="as-bp-name">{bpName(it.Blueprint)}</span>{it.Quality > 0 && <span className="as-bp-quality">Q{it.Quality}</span>}{it.ForceBlueprint && <span className="as-bp-tag">BP</span>}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>)}

      {/* ==================== SELL ITEMS - Lista a righe ==================== */}
      {tab === 'sell' && (<div>
        <div style={{ marginBottom: '0.75rem' }}><button onClick={() => openSellDialog()} className="btn btn-primary btn-sm"><Plus size={14} /> Nuovo</button></div>
        <div className="as-list">
          {sellItems.map(item => (
            <div key={item.key} className="as-list-item">
              <div className="as-list-row">
                <span className="as-list-title">{item.key}</span>
                <span className="as-list-type">{item.Type || 'item'}</span>
                <span className="as-list-price"><DollarSign size={11} /> {item.Price} pts</span>
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
        <h3 className="card-title"><Settings size={16} style={{color:'var(--accent)'}} /> Impostazioni Generali</h3>
        <div className="as-general-grid">
          <div className="as-gen-section">Shop Display</div>
          <div className="as-gen-field"><label>Items per Pagina</label><input type="number" value={general.ItemsPerPage??10} onChange={e=>setGeneral({...general,ItemsPerPage:parseInt(e.target.value)||10})} /></div>
          <div className="as-gen-field"><label>Shop Text Size</label><input type="number" step="0.1" value={general.ShopTextSize??1.5} onChange={e=>setGeneral({...general,ShopTextSize:parseFloat(e.target.value)||1.5})} /></div>
          <div className="as-gen-field"><label>Shop Display Time</label><input type="number" value={general.ShopDisplayTime??15} onChange={e=>setGeneral({...general,ShopDisplayTime:parseInt(e.target.value)||15})} /></div>
          <div className="as-gen-field"><label>Default Kit</label><input type="text" value={general.DefaultKit??''} onChange={e=>setGeneral({...general,DefaultKit:e.target.value})} /></div>
          <div className="as-gen-field"><label>DbPath Override</label><input type="text" value={general.DbPathOverride??''} onChange={e=>setGeneral({...general,DbPathOverride:e.target.value})} /></div>
          <div className="as-gen-section">Opzioni</div>
          {[['GiveDinosInCryopods','Give Dinos in Cryopods'],['CryoLimitedTime','Cryo Limited Time'],['PreventUseCarried','Prevent Use Carried'],
            ['PreventUseHandcuffed','Prevent Use Handcuffed'],['PreventUseNoglin','Prevent Use Noglin'],['PreventUseUnconscious','Prevent Use Unconscious'],
            ['UseOriginalTradeCommandWithUI','Use Original Trade Cmd With UI']].map(([k,l])=>(
            <div key={k} className="as-gen-check"><label><input type="checkbox" checked={general[k]??false} onChange={e=>setGeneral({...general,[k]:e.target.checked})} /> {l}</label></div>))}
          <div className="as-gen-section">Discord</div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.Discord?.Enabled??false} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),Enabled:e.target.checked}})} /> Abilitato</label></div>
          <div className="as-gen-field"><label>Sender Name</label><input type="text" value={general.Discord?.SenderName??''} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),SenderName:e.target.value}})} /></div>
          <div className="as-gen-field" style={{gridColumn:'span 2'}}><label>Webhook URL</label><input type="text" value={general.Discord?.URL??''} onChange={e=>setGeneral({...general,Discord:{...(general.Discord||{}),URL:e.target.value}})} /></div>
          <div className="as-gen-section">Timed Points Reward</div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.Enabled??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),Enabled:e.target.checked}})} /> Abilitato</label></div>
          <div className="as-gen-field"><label>Intervallo (min)</label><input type="number" value={general.TimedPointsReward?.Interval??10} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),Interval:parseInt(e.target.value)||10}})} /></div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.AlwaysSendNotifications??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),AlwaysSendNotifications:e.target.checked}})} /> Always Send Notifications</label></div>
          <div className="as-gen-check"><label><input type="checkbox" checked={general.TimedPointsReward?.StackRewards??false} onChange={e=>setGeneral({...general,TimedPointsReward:{...(general.TimedPointsReward||{}),StackRewards:e.target.checked}})} /> Stack Rewards</label></div>
          {general.TimedPointsReward?.Groups && Object.entries(general.TimedPointsReward.Groups).map(([g,v]:any)=>(
            <div key={g} className="as-gen-field"><label>Punti "{g}"</label><input type="number" value={v.Amount??0} onChange={e=>setGeneral({...general,TimedPointsReward:{...general.TimedPointsReward,Groups:{...general.TimedPointsReward.Groups,[g]:{Amount:parseInt(e.target.value)||0}}}})} /></div>))}
        </div>
        <button onClick={saveGeneral} className="btn btn-primary mt-4"><Save size={14} /> Salva</button>
      </div>)}

      {/* ==================== MYSQL ==================== */}
      {tab === 'mysql' && (<div className="card">
        <h3 className="card-title"><Database size={16} style={{color:'var(--accent)'}} /> MySQL</h3>
        <div className="as-general-grid">
          <div className="as-gen-check"><label><input type="checkbox" checked={mysql.UseMysql??true} onChange={e=>setMysql({...mysql,UseMysql:e.target.checked})} /> Usa MySQL</label></div>
          <div className="as-gen-field"><label>Host</label><input type="text" value={mysql.MysqlHost??''} onChange={e=>setMysql({...mysql,MysqlHost:e.target.value})} /></div>
          <div className="as-gen-field"><label>Porta</label><input type="number" value={mysql.MysqlPort??3306} onChange={e=>setMysql({...mysql,MysqlPort:parseInt(e.target.value)||3306})} /></div>
          <div className="as-gen-field"><label>Database</label><input type="text" value={mysql.MysqlDB??''} onChange={e=>setMysql({...mysql,MysqlDB:e.target.value})} /></div>
          <div className="as-gen-field"><label>Utente</label><input type="text" value={mysql.MysqlUser??''} onChange={e=>setMysql({...mysql,MysqlUser:e.target.value})} /></div>
          <div className="as-gen-field"><label>Password</label><input type="password" value={mysql.MysqlPass??''} onChange={e=>setMysql({...mysql,MysqlPass:e.target.value})} /></div>
        </div>
        <button onClick={saveMysql} className="btn btn-primary mt-4"><Save size={14} /> Salva</button>
      </div>)}

      {/* ==================== MESSAGES ==================== */}
      {tab === 'messages' && (<div className="card">
        <h3 className="card-title"><MessageSquare size={16} style={{color:'var(--accent)'}} /> Messaggi</h3>
        <div className="as-msg-grid">
          {Object.entries(messages).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>(
            <div key={key} className="as-msg-row"><label className="as-msg-key">{key}</label>
              <input type="text" value={String(val)} className="as-msg-input" onChange={e=>setMessages({...messages,[key]:e.target.value})} /></div>))}
        </div>
        <button onClick={saveMessages} className="btn btn-primary mt-4"><Save size={14} /> Salva</button>
      </div>)}

      {/* ==================== EDIT DIALOG ==================== */}
      {dialogOpen && dialogData && (
        <EditDialog title={dialogIsNew ? `Nuovo ${dialogType === 'shop' ? 'Shop Item' : dialogType === 'kit' ? 'Kit' : 'Sell Item'}` : `Modifica: ${dialogData.key}`}
          onClose={() => setDialogOpen(false)}>

          {/* Shop Item dialog */}
          {dialogType === 'shop' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Chiave ID</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Titolo</label>
                <input type="text" value={dialogData.Title ?? ''} onChange={e => setDialogData({...dialogData, Title: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>Descrizione</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>Prezzo</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>Tipo</label>
                <select value={dialogData.Type ?? 'item'} onChange={e => setDialogData({...dialogData, Type: e.target.value})}>
                  <option value="item">item</option><option value="command">command</option><option value="dino">dino</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Permessi</label>
                <input type="text" value={dialogData.Permissions ?? ''} onChange={e => setDialogData({...dialogData, Permissions: e.target.value})} placeholder="WL, VIP" /></div>
            </div>
            <div className="as-dlg-section">Contenuto ({(dialogData.Items||[]).length} elementi)</div>
            <SubItemEditor items={dialogData.Items || []} onChange={items => setDialogData({...dialogData, Items: items})} />
          </>)}

          {/* Kit dialog */}
          {dialogType === 'kit' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Chiave ID</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Descrizione</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>Prezzo</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>Default Amount</label>
                <input type="number" value={dialogData.DefaultAmount ?? 1} onChange={e => setDialogData({...dialogData, DefaultAmount: parseInt(e.target.value)||1})} /></div>
              <div className="as-dlg-field"><label>Max Level</label>
                <input type="number" value={dialogData.MaxLevel ?? 0} onChange={e => setDialogData({...dialogData, MaxLevel: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>Solo da Spawn</label>
                <select value={dialogData.OnlyFromSpawn ? '1' : '0'} onChange={e => setDialogData({...dialogData, OnlyFromSpawn: e.target.value==='1'})}>
                  <option value="0">No</option><option value="1">Si</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>Permessi</label>
                <input type="text" value={dialogData.Permissions ?? ''} onChange={e => setDialogData({...dialogData, Permissions: e.target.value})} /></div>
            </div>
            <div className="as-dlg-section">Items ({(dialogData.Items||[]).length})</div>
            <SubItemEditor items={dialogData.Items || []} onChange={items => setDialogData({...dialogData, Items: items})} />
          </>)}

          {/* Sell Item dialog */}
          {dialogType === 'sell' && (<>
            <div className="as-dlg-grid">
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Chiave ID</label>
                <input type="text" value={dialogData.key} disabled={!dialogIsNew} onChange={e => setDialogData({...dialogData, key: e.target.value})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Descrizione</label>
                <input type="text" value={dialogData.Description ?? ''} onChange={e => setDialogData({...dialogData, Description: e.target.value})} /></div>
              <div className="as-dlg-field"><label>Prezzo (punti)</label>
                <input type="number" value={dialogData.Price ?? 0} onChange={e => setDialogData({...dialogData, Price: parseInt(e.target.value)||0})} /></div>
              <div className="as-dlg-field"><label>Quantita'</label>
                <input type="number" value={dialogData.Amount ?? 1} onChange={e => setDialogData({...dialogData, Amount: parseInt(e.target.value)||1})} /></div>
              <div className="as-dlg-field" style={{gridColumn:'span 2'}}><label>Tipo</label>
                <select value={dialogData.Type ?? 'item'} onChange={e => setDialogData({...dialogData, Type: e.target.value})}>
                  <option value="item">item</option><option value="dino">dino</option></select></div>
              <div className="as-dlg-field" style={{gridColumn:'span 4'}}><label>Blueprint</label>
                <BlueprintSearch value={dialogData.Blueprint ?? ''} onChange={v => setDialogData({...dialogData, Blueprint: v})} /></div>
            </div>
          </>)}

          {/* Dialog footer */}
          <div className="as-dlg-footer">
            <button onClick={handleDialogSave} className="btn btn-primary"><Save size={14} /> Salva</button>
            <button onClick={() => setDialogOpen(false)} className="btn btn-secondary"><X size={14} /> Annulla</button>
            {!dialogIsNew && <button onClick={() => handleDelete(dialogType, dialogData.key)} className="btn btn-danger" style={{marginLeft:'auto'}}><Trash2 size={14} /> Elimina</button>}
          </div>
        </EditDialog>
      )}
    </div>
  )
}
