/**
 * RareDinosPage — Rare dino pool management (ARKM_rare_dinos).
 * Add/edit modal with all stat parameters, filters, and blueprint search from DB.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { arkRareDinosApi, blueprintsApi } from '../services/api'
import {
  Eye, Plus, Trash2, Edit2, Save, X, AlertCircle, Search,
  ToggleLeft, ToggleRight, Copy, Filter, Activity, Shuffle, Loader2
} from 'lucide-react'

interface RareDino {
  id: number; map_name: string; dino_bp: string; display_name: string; enabled: boolean
  health_min: number; health_max: number; stamina_min: number; stamina_max: number
  oxygen_min: number; oxygen_max: number; food_min: number; food_max: number
  weight_min: number; weight_max: number; melee_min: number; melee_max: number
  speed_min: number; speed_max: number; extra: string | null
}

interface BpItem { name: string; blueprint: string; category: string }

const STATS = [
  { key: 'health', label: 'Health', icon: '❤️' },
  { key: 'stamina', label: 'Stamina', icon: '⚡' },
  { key: 'oxygen', label: 'Oxygen', icon: '💧' },
  { key: 'food', label: 'Food', icon: '🍖' },
  { key: 'weight', label: 'Weight', icon: '⚖️' },
  { key: 'melee', label: 'Melee', icon: '⚔️' },
  { key: 'speed', label: 'Speed', icon: '💨' },
]

const DEFAULT_STATS = {
  health_min: 35, health_max: 45, stamina_min: -1, stamina_max: -1,
  oxygen_min: -1, oxygen_max: -1, food_min: -1, food_max: -1,
  weight_min: 35, weight_max: 45, melee_min: 35, melee_max: 45,
  speed_min: -1, speed_max: -1,
}

export default function RareDinosPage() {
  const { t } = useTranslation()
  const [dinos, setDinos] = useState<RareDino[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterMap, setFilterMap] = useState('all')
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'on' | 'off'>('all')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [editingDino, setEditingDino] = useState<RareDino | null>(null)
  const [form, setForm] = useState<Record<string, any>>({ dino_bp: '', map_name: '*', enabled: true, ...DEFAULT_STATS })

  // Blueprint search
  const [bpSearch, setBpSearch] = useState('')
  const [bpResults, setBpResults] = useState<BpItem[]>([])
  const [bpLoading, setBpLoading] = useState(false)

  // Generator
  const [showGenerator, setShowGenerator] = useState(false)
  const [genCount, setGenCount] = useState(10)
  const [genMap, setGenMap] = useState('*')
  const [genPreset, setGenPreset] = useState('balanced')
  const [genExclude, setGenExclude] = useState(true)
  const [genResults, setGenResults] = useState<Record<string, unknown>[]>([])
  const [genLoading, setGenLoading] = useState(false)
  const [genInfo, setGenInfo] = useState<{ available: number; excluded: number } | null>(null)

  async function handleGenerate() {
    setGenLoading(true); setError('')
    try {
      const res = await arkRareDinosApi.generate({
        count: genCount, map_name: genMap, stat_preset: genPreset, exclude_existing: genExclude,
      })
      setGenResults(res.data.generated)
      setGenInfo({ available: res.data.available_dinos, excluded: res.data.excluded_existing })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || t('rareDinos.generator.errorGeneration'))
    } finally { setGenLoading(false) }
  }

  async function handleApplyGenerated(replaceAll: boolean) {
    if (genResults.length === 0) return
    setGenLoading(true)
    try {
      await arkRareDinosApi.bulkUpdate(genResults, replaceAll)
      setShowGenerator(false); setGenResults([])
      loadDinos()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || t('rareDinos.generator.errorBulkInsert'))
    } finally { setGenLoading(false) }
  }

  async function loadDinos() {
    try {
      const res = await arkRareDinosApi.list()
      setDinos(res.data.dinos)
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadDinos() }, [])

  // Blueprint search with debounce
  useEffect(() => {
    if (bpSearch.length < 2) { setBpResults([]); return }
    const timer = setTimeout(async () => {
      setBpLoading(true)
      try {
        const res = await blueprintsApi.list({ search: bpSearch, type: 'dino', limit: 10 })
        setBpResults(res.data.items?.map((i: Record<string, string>) => ({ name: i.name, blueprint: i.blueprint, category: i.category })) || [])
      } catch { setBpResults([]) }
      finally { setBpLoading(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [bpSearch])

  // Mappe uniche
  const maps = useMemo(() => {
    const s = new Set(dinos.map(d => d.map_name))
    return Array.from(s).sort()
  }, [dinos])

  // Filtra dinos
  const filtered = useMemo(() => {
    return dinos.filter(d => {
      if (search && !d.display_name.toLowerCase().includes(search.toLowerCase()) && !d.dino_bp.toLowerCase().includes(search.toLowerCase())) return false
      if (filterMap !== 'all' && d.map_name !== filterMap && d.map_name !== '*') return false
      if (filterEnabled === 'on' && !d.enabled) return false
      if (filterEnabled === 'off' && d.enabled) return false
      return true
    })
  }, [dinos, search, filterMap, filterEnabled])

  function openAddModal() {
    setEditingDino(null)
    setForm({ dino_bp: '', map_name: '*', enabled: true, ...DEFAULT_STATS })
    setBpSearch('')
    setBpResults([])
    setShowModal(true)
  }

  function openEditModal(dino: RareDino) {
    setEditingDino(dino)
    const f: Record<string, any> = { dino_bp: dino.dino_bp, map_name: dino.map_name, enabled: dino.enabled }
    STATS.forEach(s => { f[`${s.key}_min`] = (dino as any)[`${s.key}_min`]; f[`${s.key}_max`] = (dino as any)[`${s.key}_max`] })
    setForm(f)
    setShowModal(true)
  }

  function selectBp(bp: BpItem) {
    setForm(prev => ({ ...prev, dino_bp: bp.blueprint }))
    setBpSearch('')
    setBpResults([])
  }

  async function handleSave() {
    if (!form.dino_bp.trim()) { setError(t('rareDinos.errorBpRequired')); return }
    try {
      if (editingDino) {
        await arkRareDinosApi.update(editingDino.id, form)
      } else {
        await arkRareDinosApi.create(form)
      }
      setShowModal(false)
      await loadDinos()
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
  }

  async function toggleEnabled(id: number, current: boolean) {
    try { await arkRareDinosApi.update(id, { enabled: !current }); await loadDinos() }
    catch (e: any) { setError(e.message) }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(t('rareDinos.confirmDelete', { name }))) return
    try { await arkRareDinosApi.delete(id); await loadDinos() }
    catch (e: any) { setError(e.message) }
  }

  function formatStat(min: number, max: number) {
    if (min < 0) return null
    return `${min}-${max}`
  }

  const enabledCount = dinos.filter(d => d.enabled).length

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Eye size={22} /> {t('rareDinos.heading')}</h1>
          <p className="page-subtitle">
            {t('rareDinos.subtitle', { total: dinos.length, enabled: enabledCount, disabled: dinos.length - enabledCount })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => { setShowGenerator(true); setGenResults([]) }} className="btn btn-ghost" style={{ borderColor: 'var(--border)' }}>
            <Shuffle size={15} /> {t('rareDinos.generateRandom')}
          </button>
          <button onClick={openAddModal} className="btn btn-primary">
            <Plus size={16} /> {t('rareDinos.addDino')}
          </button>
        </div>
      </div>

      {/* Generator modal */}
      {showGenerator && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 600, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}><Shuffle size={18} /> {t('rareDinos.generator.title')}</h3>
              <button onClick={() => setShowGenerator(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {/* Generator controls */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)', display: 'block', marginBottom: 4 }}>{t('rareDinos.generator.countLabel')}</label>
                <input type="number" value={genCount} onChange={e => setGenCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  min={1} max={50} className="input" style={{ fontFamily: 'var(--font-mono)' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)', display: 'block', marginBottom: 4 }}>{t('rareDinos.generator.mapLabel')}</label>
                <select value={genMap} onChange={e => setGenMap(e.target.value)} className="input">
                  <option value="*">{t('rareDinos.generator.allMaps')}</option>
                  {maps.filter(m => m !== '*').map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)', display: 'block', marginBottom: 4 }}>{t('rareDinos.generator.statPresetLabel')}</label>
                <select value={genPreset} onChange={e => setGenPreset(e.target.value)} className="input">
                  <option value="none">{t('rareDinos.generator.preset.none')}</option>
                  <option value="low">{t('rareDinos.generator.preset.low')}</option>
                  <option value="balanced">{t('rareDinos.generator.preset.balanced')}</option>
                  <option value="high">{t('rareDinos.generator.preset.high')}</option>
                  <option value="random">{t('rareDinos.generator.preset.random')}</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer', padding: '0.4rem 0' }}>
                  <input type="checkbox" checked={genExclude} onChange={e => setGenExclude(e.target.checked)} style={{ accentColor: 'var(--green)' }} />
                  {t('rareDinos.generator.excludeExisting')}
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
              <button onClick={handleGenerate} disabled={genLoading} className="btn btn-primary" style={{ flex: 1 }}>
                {genLoading ? <><Loader2 size={14} className="pl-spin" /> {t('rareDinos.generator.generating')}</> : <><Shuffle size={14} /> {t('rareDinos.generator.generateBtn', { count: genCount })}</>}
              </button>
            </div>

            {/* Results preview */}
            {genInfo && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {t('rareDinos.generator.availableInfo', { available: genInfo.available })}{genInfo.excluded > 0 && ` ${t('rareDinos.generator.excludedInfo', { excluded: genInfo.excluded })}`}
              </div>
            )}

            {genResults.length > 0 && (
              <>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: '1rem', maxHeight: 300, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{t('rareDinos.generator.colDino')}</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{t('rareDinos.generator.colHp')}</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{t('rareDinos.generator.colMelee')}</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{t('rareDinos.generator.colSpeed')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genResults.map((d, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.35rem 0.6rem', fontWeight: 600 }}>{(d.display_name as string) || '?'}</td>
                          <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                            {(d.health_min as number) === -1 ? '—' : `${d.health_min}–${d.health_max}`}
                          </td>
                          <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                            {(d.melee_min as number) === -1 ? '—' : `${d.melee_min}–${d.melee_max}`}
                          </td>
                          <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                            {(d.speed_min as number) === -1 ? '—' : `${d.speed_min}–${d.speed_max}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={handleGenerate} disabled={genLoading} className="btn btn-ghost" style={{ borderColor: 'var(--border)' }}>
                    <Shuffle size={13} /> {t('rareDinos.generator.reroll')}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => handleApplyGenerated(false)} disabled={genLoading} className="btn btn-primary">
                    <Plus size={13} /> {t('rareDinos.generator.addToPool')}
                  </button>
                  <button onClick={() => { if (confirm(t('rareDinos.generator.confirmReplace'))) handleApplyGenerated(true) }}
                    disabled={genLoading} className="btn btn-ghost" style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
                    {t('rareDinos.generator.replaceAll')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Filtri */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder={t('rareDinos.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 28, fontSize: '0.82rem' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-input)', borderRadius: 'var(--radius)', padding: '0.3rem 0.5rem', border: '1px solid var(--border)' }}>
          <Filter size={13} style={{ color: 'var(--text-muted)' }} />
          <select value={filterMap} onChange={e => setFilterMap(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            <option value="all">{t('rareDinos.filterMap.all')}</option>
            <option value="*">{t('rareDinos.filterMap.global')}</option>
            {maps.filter(m => m !== '*').map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          {(['all', 'on', 'off'] as const).map(f => (
            <button key={f} onClick={() => setFilterEnabled(f)}
              style={{
                padding: '0.3rem 0.65rem', border: 'none', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer',
                background: filterEnabled === f ? 'var(--accent)' : 'var(--bg-input)',
                color: filterEnabled === f ? '#fff' : 'var(--text-secondary)',
              }}>
              {f === 'all' ? t('rareDinos.filterEnabled.all') : f === 'on' ? t('rareDinos.filterEnabled.on') : t('rareDinos.filterEnabled.off')}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {t('rareDinos.resultsCount', { count: filtered.length })}
        </span>
      </div>

      {/* Dino list */}
      {loading ? (
        <div className="pl-loading">{t('rareDinos.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="pl-empty"><Eye size={40} style={{ opacity: 0.2 }} /><p>{t('rareDinos.empty')}</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 80px repeat(7, 70px) 80px', gap: 0, padding: '0.5rem 1rem', background: 'var(--bg-card-muted)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            <span>{t('rareDinos.table.dino')}</span>
            <span>{t('rareDinos.table.map')}</span>
            <span style={{ textAlign: 'center' }}>{t('rareDinos.table.status')}</span>
            {STATS.map(s => <span key={s.key} style={{ textAlign: 'center' }}>{s.icon} {s.label}</span>)}
            <span style={{ textAlign: 'center' }}>{t('rareDinos.table.actions')}</span>
          </div>

          {/* Rows */}
          {filtered.map(dino => (
            <div key={dino.id} style={{
              display: 'grid', gridTemplateColumns: '2fr 100px 80px repeat(7, 70px) 80px',
              gap: 0, padding: '0.55rem 1rem', background: 'var(--bg-card)', alignItems: 'center',
              opacity: dino.enabled ? 1 : 0.5, transition: 'opacity 0.15s',
            }}>
              {/* Nome + BP */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dino.display_name}
                </div>
                <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dino.dino_bp}>
                  {dino.dino_bp.split('/').pop()?.replace("'", '')}
                </div>
              </div>

              {/* Mappa */}
              <span style={{ fontSize: '0.78rem', color: dino.map_name === '*' ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: dino.map_name === '*' ? 600 : 400 }}>
                {dino.map_name === '*' ? t('rareDinos.mapAll') : dino.map_name.replace('_WP', '')}
              </span>

              {/* Toggle */}
              <div style={{ textAlign: 'center' }}>
                <button onClick={() => toggleEnabled(dino.id, dino.enabled)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                  {dino.enabled ? <ToggleRight size={22} color="var(--success)" /> : <ToggleLeft size={22} color="var(--text-muted)" />}
                </button>
              </div>

              {/* Stats */}
              {STATS.map(s => {
                const val = formatStat((dino as any)[`${s.key}_min`], (dino as any)[`${s.key}_max`])
                return (
                  <div key={s.key} style={{ textAlign: 'center', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', fontWeight: 500, color: val ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {val || '—'}
                  </div>
                )
              })}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center' }}>
                <button onClick={() => openEditModal(dino)} className="btn btn-ghost" style={{ padding: '0.2rem 0.35rem' }} title={t('rareDinos.tooltip.edit')}>
                  <Edit2 size={14} />
                </button>
                <button onClick={() => { navigator.clipboard.writeText(dino.dino_bp) }} className="btn btn-ghost" style={{ padding: '0.2rem 0.35rem' }} title={t('rareDinos.tooltip.copyBp')}>
                  <Copy size={14} />
                </button>
                <button onClick={() => handleDelete(dino.id, dino.display_name)} className="btn btn-ghost" style={{ padding: '0.2rem 0.35rem', color: 'var(--danger)' }} title={t('rareDinos.tooltip.delete')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Add/Edit */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(2px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: '95%', maxWidth: 700, maxHeight: '90vh', overflow: 'auto' }}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={18} color="var(--accent)" />
                {editingDino ? t('rareDinos.modal.editTitle', { name: editingDino.display_name }) : t('rareDinos.modal.newTitle')}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '1.25rem' }}>
              {/* Blueprint + Map */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('rareDinos.modal.blueprintLabel')}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" placeholder={t('rareDinos.modal.blueprintPlaceholder')}
                      value={editingDino ? form.dino_bp : bpSearch || form.dino_bp}
                      onChange={e => {
                        if (editingDino) {
                          setForm(prev => ({ ...prev, dino_bp: e.target.value }))
                        } else {
                          setBpSearch(e.target.value)
                          setForm(prev => ({ ...prev, dino_bp: e.target.value }))
                        }
                      }}
                      style={{ fontSize: '0.82rem', fontFamily: form.dino_bp.includes("'") ? 'var(--font-mono)' : 'inherit' }} />
                    {/* Blueprint autocomplete dropdown */}
                    {bpResults.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                        boxShadow: 'var(--shadow-lg)', maxHeight: 200, overflowY: 'auto',
                      }}>
                        {bpResults.map((bp, i) => (
                          <button key={i} onClick={() => selectBp(bp)}
                            style={{
                              display: 'block', width: '100%', padding: '0.45rem 0.75rem', border: 'none',
                              background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem',
                            }}
                            onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                            <span style={{ fontWeight: 600 }}>{bp.name}</span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 8 }}>{bp.category}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {bpLoading && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>...</div>}
                  </div>
                  {form.dino_bp && form.dino_bp.includes("'") && (
                    <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {form.dino_bp}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('rareDinos.modal.mapLabel')}
                  </label>
                  <select className="input" value={form.map_name} onChange={e => setForm(prev => ({ ...prev, map_name: e.target.value }))}
                    style={{ fontSize: '0.82rem' }}>
                    <option value="*">{t('rareDinos.modal.mapAll')}</option>
                    <option value="TheIsland_WP">The Island</option>
                    <option value="TheCenter_WP">The Center</option>
                    <option value="ScorchedEarth_WP">Scorched Earth</option>
                    <option value="Aberration_WP">Aberration</option>
                    <option value="Extinction_WP">Extinction</option>
                    <option value="Ragnarok_WP">Ragnarok</option>
                    <option value="Valguero_WP">Valguero</option>
                    <option value="Astraeos_WP">Astraeos</option>
                    <option value="LostCity_WP">Lost City</option>
                    <option value="LostColony_WP">Lost Colony</option>
                    <option value="Svartalfheim_WP">Svartalfheim</option>
                  </select>
                </div>
              </div>

              {/* Enabled */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <button onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: form.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                  {form.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  {form.enabled ? t('rareDinos.modal.enabled') : t('rareDinos.modal.disabled')}
                </button>
              </div>

              {/* Stats grid */}
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('rareDinos.modal.statsHeading')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.65rem' }}>
                {STATS.map(s => {
                  const minKey = `${s.key}_min`
                  const maxKey = `${s.key}_max`
                  const isActive = form[minKey] >= 0

                  return (
                    <div key={s.key} style={{
                      padding: '0.6rem 0.75rem', borderRadius: 'var(--radius)',
                      border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                      background: isActive ? 'var(--accent-glow)' : 'var(--bg-card-muted)',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {s.icon} {s.label}
                        </span>
                        <button onClick={() => {
                          if (isActive) {
                            setForm(prev => ({ ...prev, [minKey]: -1, [maxKey]: -1 }))
                          } else {
                            setForm(prev => ({ ...prev, [minKey]: 35, [maxKey]: 45 }))
                          }
                        }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          {isActive ? <ToggleRight size={18} color="var(--accent)" /> : <ToggleLeft size={18} color="var(--text-muted)" />}
                        </button>
                      </div>
                      {isActive && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 2 }}>{t('rareDinos.modal.minLabel')}</div>
                            <input type="number" className="input" value={form[minKey]}
                              onChange={e => setForm(prev => ({ ...prev, [minKey]: Number(e.target.value) }))}
                              style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', textAlign: 'center', height: 32 }} />
                          </div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', paddingTop: 14 }}>–</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 2 }}>{t('rareDinos.modal.maxLabel')}</div>
                            <input type="number" className="input" value={form[maxKey]}
                              onChange={e => setForm(prev => ({ ...prev, [maxKey]: Number(e.target.value) }))}
                              style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', textAlign: 'center', height: 32 }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card-muted)' }}>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost">{t('rareDinos.modal.cancel')}</button>
              <button onClick={handleSave} className="btn btn-primary">
                <Save size={14} /> {editingDino ? t('rareDinos.modal.save') : t('rareDinos.modal.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
