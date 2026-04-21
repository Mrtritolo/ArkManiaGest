/**
 * TransferRulesPage — Transfer rule management (ARKM_transfer_rules).
 * Design aligned with other ArkMania pages (DecayPage, BansPage, etc.)
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { arkTransferRulesApi, arkmaniaApi } from '../services/api'
import {
  ArrowRightLeft, Plus, Trash2, Edit2, Save, X, AlertCircle,
  CheckCircle, Shield, ArrowRight, RefreshCw
} from 'lucide-react'

interface TransferRule {
  id: number; source_server: string; dest_server: string
  transfer_level: number; transfer_level_name: string; notes: string | null
}

interface ServerItem {
  server_key: string; display_name: string; map_name: string
  is_online: boolean
}

const TRANSFER_LEVEL_META = [
  { value: 0, color: '#16a34a', bg: 'rgba(22,163,74,0.08)', tkey: 'full' },
  { value: 1, color: '#ca8a04', bg: 'rgba(202,138,4,0.08)', tkey: 'survivorInv' },
  { value: 2, color: '#ea580c', bg: 'rgba(234,88,12,0.08)', tkey: 'survivorOnly' },
  { value: 3, color: '#dc2626', bg: 'rgba(220,38,38,0.08)', tkey: 'blocked' },
]

export default function TransferRulesPage() {
  const { t } = useTranslation()
  const TRANSFER_LEVELS = TRANSFER_LEVEL_META.map(m => ({
    ...m,
    label: t(`transferRules.levels.${m.tkey}.label`),
    desc: t(`transferRules.levels.${m.tkey}.desc`),
  }))
  const [rules, setRules] = useState<TransferRule[]>([])
  const [servers, setServers] = useState<ServerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLevel, setEditLevel] = useState(0)
  const [editNotes, setEditNotes] = useState('')
  const [newRule, setNewRule] = useState({ source_server: '', dest_server: '', transfer_level: 3, notes: '' })

  async function loadData() {
    setLoading(true)
    try {
      const [rulesRes, serversRes] = await Promise.all([
        arkTransferRulesApi.list(),
        arkmaniaApi.listServers(),
      ])
      setRules(rulesRes.data.rules)
      setServers(serversRes.data.servers)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])

  const serverOptions = [
    { value: 'PvP', label: t('transferRules.serverTypePrefix', { type: 'PvP' }) },
    { value: 'PvE', label: t('transferRules.serverTypePrefix', { type: 'PvE' }) },
    ...servers.map(s => ({ value: s.server_key, label: s.display_name })),
  ]

  function resolveServerName(key: string): string {
    if (key === 'PvP' || key === 'PvE') return t('transferRules.serverTypePrefix', { type: key })
    const s = servers.find(s => s.server_key === key)
    return s?.display_name || key.split('_')[0]
  }

  function getLevelInfo(level: number) {
    return TRANSFER_LEVELS.find(t => t.value === level) || TRANSFER_LEVELS[3]
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    try {
      await arkTransferRulesApi.create({
        source_server: newRule.source_server,
        dest_server: newRule.dest_server,
        transfer_level: newRule.transfer_level,
        notes: newRule.notes || undefined,
      })
      setShowAdd(false)
      setNewRule({ source_server: '', dest_server: '', transfer_level: 3, notes: '' })
      setSuccess(t('transferRules.success.created'))
      await loadData()
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
  }

  function startEdit(rule: TransferRule) {
    setEditingId(rule.id)
    setEditLevel(rule.transfer_level)
    setEditNotes(rule.notes || '')
  }

  async function saveEdit() {
    if (editingId == null) return
    try {
      await arkTransferRulesApi.update(editingId, { transfer_level: editLevel, notes: editNotes || undefined })
      setEditingId(null)
      setSuccess(t('transferRules.success.updated'))
      await loadData()
    } catch (e: any) { setError(e.message) }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('transferRules.confirmDelete'))) return
    try {
      await arkTransferRulesApi.delete(id)
      setSuccess(t('transferRules.success.deleted'))
      await loadData()
    } catch (e: any) { setError(e.message) }
  }

  // Stats
  const levelCounts = TRANSFER_LEVELS.map(l => ({
    ...l,
    count: rules.filter(r => r.transfer_level === l.value).length,
  }))

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><ArrowRightLeft size={22} /> {t('transferRules.heading')}</h1>
          <p className="page-subtitle">{t('transferRules.subtitle', { count: rules.length })}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-primary">
            <Plus size={14} /> {t('transferRules.newButton')}
          </button>
          <button onClick={loadData} className="btn btn-secondary" style={{ padding: '0.4rem' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Messaggi */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}
      {success && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.85rem', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#16a34a' }}>
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {/* Stats mini */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
        {levelCounts.map(l => (
          <div key={l.value} style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: l.bg, border: `1px solid ${l.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={13} color={l.color} />
            </div>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: l.color, lineHeight: 1 }}>{l.count}</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{l.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Form nuova regola */}
      {showAdd && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '3px solid var(--accent)' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>
            <Plus size={14} style={{ verticalAlign: -2 }} /> {t('transferRules.form.heading')}
          </h3>
          <form onSubmit={handleAdd}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr 1fr', gap: '0.6rem', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{t('transferRules.form.sourceLabel')}</label>
                <select className="input" required value={newRule.source_server} onChange={e => setNewRule({ ...newRule, source_server: e.target.value })} style={{ fontSize: '0.82rem' }}>
                  <option value="">{t('transferRules.form.selectPlaceholder')}</option>
                  {serverOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <ArrowRight size={18} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{t('transferRules.form.destLabel')}</label>
                <select className="input" required value={newRule.dest_server} onChange={e => setNewRule({ ...newRule, dest_server: e.target.value })} style={{ fontSize: '0.82rem' }}>
                  <option value="">{t('transferRules.form.selectPlaceholder')}</option>
                  {serverOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{t('transferRules.form.levelLabel')}</label>
                <select className="input" value={newRule.transfer_level} onChange={e => setNewRule({ ...newRule, transfer_level: Number(e.target.value) })} style={{ fontSize: '0.82rem' }}>
                  {TRANSFER_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label} — {l.desc}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
              <input className="input" placeholder={t('transferRules.form.notesPlaceholder')} value={newRule.notes} onChange={e => setNewRule({ ...newRule, notes: e.target.value })} style={{ flex: 1, fontSize: '0.82rem' }} />
              <button type="submit" className="btn btn-primary" style={{ fontSize: '0.82rem' }}>{t('transferRules.form.create')}</button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn btn-ghost" style={{ fontSize: '0.82rem' }}>{t('transferRules.form.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabella regole */}
      <div className="card" style={{ minHeight: 200 }}>
        {loading ? (
          <div className="pl-loading" style={{ padding: '3rem' }}>{t('transferRules.loading')}</div>
        ) : rules.length === 0 ? (
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <ArrowRightLeft size={40} style={{ opacity: 0.12 }} />
            <p>{t('transferRules.empty.title')}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('transferRules.empty.hint')}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 30px 1.2fr 140px 1fr 80px', padding: '0.5rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'var(--bg-card-muted)', borderBottom: '2px solid var(--border)' }}>
              <span>{t('transferRules.table.source')}</span><span></span><span>{t('transferRules.table.dest')}</span><span>{t('transferRules.table.level')}</span><span>{t('transferRules.table.notes')}</span><span></span>
            </div>
            {/* Rows */}
            {rules.map(rule => {
              const isEditing = editingId === rule.id
              const lvl = getLevelInfo(rule.transfer_level)
              return (
                <div key={rule.id} style={{
                  display: 'grid', gridTemplateColumns: '1.2fr 30px 1.2fr 140px 1fr 80px',
                  padding: '0.55rem 1rem', alignItems: 'center', borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${lvl.color}`,
                  transition: 'background 0.1s',
                }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.04)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  {/* Sorgente */}
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {resolveServerName(rule.source_server)}
                  </span>
                  {/* Freccia */}
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                  {/* Destinazione */}
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {resolveServerName(rule.dest_server)}
                  </span>
                  {/* Livello */}
                  <div>
                    {isEditing ? (
                      <select className="input" value={editLevel} onChange={e => setEditLevel(Number(e.target.value))} style={{ fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}>
                        {TRANSFER_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </select>
                    ) : (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.12rem 0.5rem', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                        background: lvl.bg, color: lvl.color, border: `1px solid ${lvl.color}20`,
                      }}>
                        {lvl.label}
                      </span>
                    )}
                  </div>
                  {/* Note */}
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {isEditing ? (
                      <input className="input" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder={t('transferRules.notesPlaceholder')} style={{ fontSize: '0.78rem', padding: '0.2rem 0.4rem' }} />
                    ) : (
                      rule.notes || '—'
                    )}
                  </div>
                  {/* Azioni */}
                  <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'flex-end' }}>
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} title={t('transferRules.tooltip.save')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: 3 }}><Save size={15} /></button>
                        <button onClick={() => setEditingId(null)} title={t('transferRules.tooltip.cancel')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(rule)} title={t('transferRules.tooltip.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(rule.id)} title={t('transferRules.tooltip.delete')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 3 }}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
