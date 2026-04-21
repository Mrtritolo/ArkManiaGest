/**
 * BlueprintsPage — ARK Blueprint Database.
 * Sync from Dododex + ARK Wiki, search, filter, category management,
 * JSON import/export, bulk category edit, copy blueprint to clipboard.
 */
import { useState, useEffect, useRef } from 'react'
import {
  Database, Download, Upload, Search, RefreshCw, Loader2, CheckCircle,
  AlertCircle, X, Copy, Box, Sword, Shield, Home, Utensils,
  Gem, Crown, Terminal, Package, Edit3, Check, ChevronDown
} from 'lucide-react'
import { blueprintsApi } from '../services/api'

interface BpItem {
  id: string; name: string; blueprint: string; category: string
  type: string; gfi: string | null; source: string; description?: string
}

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  dino: Box, weapon: Sword, armor: Shield, structure: Home,
  consumable: Utensils, resource: Gem, cosmetic: Crown,
  artifact: Crown, command: Terminal, item: Package,
}
const TYPE_COLORS: Record<string, string> = {
  dino: '#16a34a', weapon: '#dc2626', armor: '#3b82f6', structure: '#d97706',
  consumable: '#a855f7', resource: '#ca8a04', cosmetic: '#ec4899',
  artifact: '#f59e0b', command: '#64748b', item: '#475569',
}

export default function BlueprintsPage() {
  // DB state
  const [hasData, setHasData] = useState(false)
  const [totalBp, setTotalBp] = useState(0)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])

  // Items & filters
  const [items, setItems] = useState<BpItem[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([])
  const [types, setTypes] = useState<{ name: string; count: number }[]>([])
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(0)
  const LIMIT = 50

  // UI state
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // Category editing
  const [editingCat, setEditingCat] = useState<string | null>(null) // bp id being edited
  const [editCatValue, setEditCatValue] = useState('')

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCat, setBulkCat] = useState('')

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{ data: unknown[]; filename: string } | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

  // Effects
  useEffect(() => { loadStatus() }, [])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 5000); return () => clearTimeout(t) } }, [success])
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(null), 1500); return () => clearTimeout(t) } }, [copied])

  // ── Data loading ──────────────────────────────────────────────
  async function loadStatus() {
    setLoading(true)
    try {
      const res = await blueprintsApi.status()
      setHasData(res.data.has_data)
      setTotalBp(res.data.total_blueprints)
      setLastSync(res.data.last_sync)
      setSources(res.data.sources)
      if (res.data.has_data) { loadData(); loadFilters(); loadAllCategories() }
    } catch {} finally { setLoading(false) }
  }

  async function loadData(s?: string, cat?: string, typ?: string, pg?: number) {
    try {
      const res = await blueprintsApi.list({
        search: (s ?? search) || undefined,
        category: (cat ?? catFilter) || undefined,
        type: (typ ?? typeFilter) || undefined,
        limit: LIMIT, offset: (pg ?? page) * LIMIT,
      })
      setItems(res.data.items as BpItem[])
      setTotal(res.data.total)
    } catch { setError('Failed to load blueprints') }
  }

  async function loadFilters() {
    try {
      const [catRes, typRes] = await Promise.allSettled([blueprintsApi.categories(), blueprintsApi.types()])
      if (catRes.status === 'fulfilled') setCategories(catRes.value.data.categories)
      if (typRes.status === 'fulfilled') setTypes(typRes.value.data.types)
    } catch {}
  }

  async function loadAllCategories() {
    try { const res = await blueprintsApi.allCategories(); setAllCategories(res.data.categories) } catch {}
  }

  // ── Actions ───────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true); setError(''); setSuccess('')
    try {
      const res = await blueprintsApi.sync()
      const d = res.data
      const errMsg = d.errors.length > 0 ? ' | Errors: ' + d.errors.join('; ') : ''
      if (d.total_blueprints > 0) {
        setSuccess(`Sync complete: ${d.total_blueprints} blueprints (${d.items_count} items, ${d.dinos_count} dinos, ${d.commands_count} commands)${errMsg}`)
      } else {
        setError(`No blueprints downloaded. Sources: ${d.sources.join(', ') || 'none'}`)
      }
      setHasData(true); setTotalBp(d.total_blueprints); setSources(d.sources); setLastSync(new Date().toISOString())
      resetFilters(); loadData('', '', '', 0); loadFilters(); loadAllCategories()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Sync failed')
    } finally { setSyncing(false) }
  }

  function resetFilters() { setSearch(''); setCatFilter(''); setTypeFilter(''); setPage(0); setSelected(new Set()) }

  function doSearch() { setPage(0); loadData(search, catFilter, typeFilter, 0) }
  function handleCatChange(val: string) { setCatFilter(val); setPage(0); loadData(search, val, typeFilter, 0) }
  function handleTypeChange(val: string) { setTypeFilter(val); setPage(0); loadData(search, catFilter, val, 0) }
  function handlePage(p: number) { setPage(p); loadData(search, catFilter, typeFilter, p) }

  function copyBp(bp: string) { navigator.clipboard.writeText(bp); setCopied(bp) }
  function fmtDate(d: string | null) { return d ? new Date(d).toLocaleString() : 'Never' }

  // ── Category editing ──────────────────────────────────────────
  async function saveCategoryEdit(bpId: string) {
    if (!editCatValue.trim()) return
    try {
      await blueprintsApi.updateCategory(bpId, editCatValue.trim())
      setEditingCat(null)
      setItems(prev => prev.map(i => i.id === bpId ? { ...i, category: editCatValue.trim() } : i))
      loadFilters(); loadAllCategories()
    } catch { setError('Failed to update category') }
  }

  async function handleBulkCategory() {
    if (!bulkCat.trim() || selected.size === 0) return
    try {
      const res = await blueprintsApi.bulkUpdateCategory([...selected], bulkCat.trim())
      setSuccess(`Updated category for ${res.data.updated} blueprints`)
      setSelected(new Set()); setBulkCat('')
      loadData(); loadFilters(); loadAllCategories()
    } catch { setError('Bulk category update failed') }
  }

  // ── Selection ─────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.id)))
  }

  // ── Export ────────────────────────────────────────────────────
  async function handleExport() {
    try {
      const res = await blueprintsApi.exportAll()
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `blueprints_${new Date().toISOString().slice(0, 10)}.json`; a.click()
      URL.revokeObjectURL(a.href)
      setSuccess('Exported ' + totalBp + ' blueprints as JSON')
    } catch { setError('Export failed') }
  }

  // ── Import ────────────────────────────────────────────────────
  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = reader.result as string
        // Strip BOM and comments
        const clean = raw.replace(/^\uFEFF/, '').split('\n').map(l => l.trimStart().startsWith('//') ? '' : l).join('\n')
        let parsed = JSON.parse(clean)
        // Support both array format and {blueprints: [...]} wrapper
        if (!Array.isArray(parsed)) {
          if (Array.isArray(parsed.blueprints)) parsed = parsed.blueprints
          else { setError('Invalid JSON: expected an array of blueprints'); return }
        }
        setImportPreview({ data: parsed, filename: file.name })
      } catch (err) {
        setError('Invalid JSON file: ' + (err instanceof Error ? err.message : 'parse error'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function confirmImport() {
    if (!importPreview) return
    setImporting(true); setError('')
    try {
      const res = await blueprintsApi.importBlueprints(importPreview.data, importMode)
      setSuccess(`Import complete: ${res.data.added} added, ${res.data.updated} updated (${res.data.total} total)`)
      setImportPreview(null); setHasData(true)
      loadStatus()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError('Import failed: ' + (detail || 'Unknown error'))
    } finally { setImporting(false) }
  }

  const totalPages = Math.ceil(total / LIMIT)

  // ── No data state ─────────────────────────────────────────────
  if (!hasData && !loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-text">
            <h1 className="page-title"><Database size={22} /> Blueprint Database</h1>
            <p className="page-subtitle">Local ARK: Survival Ascended blueprint database</p>
          </div>
        </div>
        {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14} /></button></div>}
        {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Database size={44} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>No blueprint database</h3>
          <p style={{ marginBottom: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Download blueprints from Dododex + ARK Wiki, or import your own JSON file.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleSync} disabled={syncing} className="btn btn-primary">
              {syncing ? <><Loader2 size={16} className="pl-spin" /> Syncing...</> : <><Download size={16} /> Sync from Dododex + Wiki</>}
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary"><Upload size={16} /> Import JSON</button>
          </div>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileSelected} />
        </div>
        {importPreview && renderImportDialog()}
      </div>
    )
  }

  // ── Import preview dialog ─────────────────────────────────────
  function renderImportDialog() {
    if (!importPreview) return null
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
        <div className="card" style={{ width: 440, maxWidth: '90vw', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}><Upload size={18} /> Import Blueprints</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            File: <strong>{importPreview.filename}</strong> — {importPreview.data.length} entries
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer', padding: '0.35rem 0.7rem', borderRadius: 6, border: importMode === 'merge' ? '2px solid var(--accent)' : '1px solid var(--border)', background: importMode === 'merge' ? 'var(--accent-glow)' : 'transparent' }}>
              <input type="radio" name="mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} style={{ display: 'none' }} />
              <strong>Merge</strong> — add new, update existing
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer', padding: '0.35rem 0.7rem', borderRadius: 6, border: importMode === 'replace' ? '2px solid var(--danger)' : '1px solid var(--border)', background: importMode === 'replace' ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
              <input type="radio" name="mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} style={{ display: 'none' }} />
              <strong>Replace</strong> — wipe and replace all
            </label>
          </div>
          {importMode === 'replace' && <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginBottom: '0.75rem', padding: '0.4rem 0.6rem', background: 'rgba(239,68,68,0.06)', borderRadius: 6 }}><AlertCircle size={13} style={{ verticalAlign: 'text-bottom' }} /> This will delete all existing blueprints!</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setImportPreview(null)} className="btn btn-ghost">Cancel</button>
            <button onClick={confirmImport} disabled={importing} className="btn btn-primary">
              {importing ? <><Loader2 size={14} className="pl-spin" /> Importing...</> : <><Upload size={14} /> Import {importPreview.data.length} entries</>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main view with data ───────────────────────────────────────
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Database size={22} /> Blueprint Database</h1>
          <p className="page-subtitle">
            {totalBp.toLocaleString()} blueprints &middot; Last sync: {fmtDate(lastSync)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleExport} className="btn btn-ghost btn-sm" title="Export all as JSON"><Download size={14} /> Export</button>
          <button onClick={() => fileInputRef.current?.click()} className="btn btn-ghost btn-sm" title="Import from JSON"><Upload size={14} /> Import</button>
          <button onClick={handleSync} disabled={syncing} className="btn btn-primary btn-sm">
            {syncing ? <><Loader2 size={14} className="pl-spin" /> Syncing...</> : <><RefreshCw size={14} /> Sync</>}
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileSelected} />

      {error && <div className="pl-alert pl-alert-err"><AlertCircle size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14} /></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><CheckCircle size={14} /> {success}</div>}

      {/* Type chips */}
      <div className="bp-type-chips">
        {types.map(t => {
          const Icon = TYPE_ICONS[t.name] || Package
          const color = TYPE_COLORS[t.name] || 'var(--text-muted)'
          const isActive = typeFilter === t.name
          return (
            <button key={t.name} className={`bp-type-chip ${isActive ? 'bp-type-chip-active' : ''}`}
              style={{ '--chip-color': color } as React.CSSProperties}
              onClick={() => handleTypeChange(isActive ? '' : t.name)}>
              <Icon size={13} /> {t.name} <span className="bp-type-count">{t.count}</span>
            </button>
          )
        })}
      </div>

      {/* Search & filters */}
      <div className="dc-filters">
        <div className="pl-search-input-wrap">
          <Search size={16} className="pl-search-icon" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            className="pl-search-input" placeholder="Search name, blueprint, GFI..." />
        </div>
        <select value={catFilter} onChange={e => handleCatChange(e.target.value)} className="dc-select">
          <option value="">All categories</option>
          {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </select>
        <button onClick={doSearch} className="pl-btn-search">Search</button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.85rem', marginBottom: '0.6rem', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)' }}>{selected.size} selected</span>
          <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} className="dc-select" style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}>
            <option value="">Set category...</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {bulkCat && <button onClick={handleBulkCategory} className="btn btn-primary btn-sm"><Check size={13} /> Apply</button>}
          <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm"><X size={13} /> Clear</button>
        </div>
      )}

      {/* Results header */}
      <div className="bp-results-header">
        <span>{total.toLocaleString()} results</span>
        {totalPages > 1 && (
          <div className="bp-pagination">
            <button onClick={() => handlePage(page - 1)} disabled={page === 0} className="btn btn-sm btn-ghost">&laquo; Prev</button>
            <span className="bp-page-info">Page {page + 1} / {totalPages}</span>
            <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages - 1} className="btn btn-sm btn-ghost">Next &raquo;</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="bp-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={selected.size === items.length && items.length > 0}
                  onChange={toggleSelectAll} title="Select all" />
              </th>
              <th style={{ width: '28%' }}>Name</th>
              <th style={{ width: '8%' }}>Type</th>
              <th style={{ width: '14%' }}>Category</th>
              <th>Blueprint Path</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const Icon = TYPE_ICONS[item.type] || Package
              const color = TYPE_COLORS[item.type] || 'var(--text-muted)'
              const isSelected = selected.has(item.id)
              const isEditing = editingCat === item.id
              return (
                <tr key={`${item.id}-${i}`} style={{ background: isSelected ? 'var(--accent-glow)' : undefined }}>
                  <td><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)} /></td>
                  <td><span className="bp-cell-name">{item.name}</span></td>
                  <td>
                    <span className="bp-cell-type" style={{ color, borderColor: color + '33', background: color + '0a' }}>
                      <Icon size={11} /> {item.type}
                    </span>
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
                        <select value={editCatValue} onChange={e => setEditCatValue(e.target.value)}
                          autoFocus className="dc-select" style={{ fontSize: '0.75rem', padding: '0.2rem 0.3rem', flex: 1, minWidth: 0 }}>
                          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => saveCategoryEdit(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: 2 }}><Check size={13} /></button>
                        <button onClick={() => setEditingCat(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}><X size={12} /></button>
                      </div>
                    ) : (
                      <span className="bp-cell-cat" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={() => { setEditingCat(item.id); setEditCatValue(item.category) }}
                        title="Click to change category">
                        {item.category} <Edit3 size={10} style={{ opacity: 0.3 }} />
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="bp-cell-bp-wrap">
                      <span className="bp-cell-bp">{item.blueprint}</span>
                      <button onClick={() => copyBp(item.blueprint)} className="bp-copy-btn" title="Copy blueprint">
                        {copied === item.blueprint ? <CheckCircle size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="bp-pagination" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <button onClick={() => handlePage(page - 1)} disabled={page === 0} className="btn btn-sm btn-ghost">&laquo; Prev</button>
          <span className="bp-page-info">Page {page + 1} / {totalPages}</span>
          <button onClick={() => handlePage(page + 1)} disabled={page >= totalPages - 1} className="btn btn-sm btn-ghost">Next &raquo;</button>
        </div>
      )}

      {importPreview && renderImportDialog()}
    </div>
  )
}
