/**
 * ArkManiaConfigPage — Centralised ArkMania plugin configuration editor.
 * Dedicated GUIs for: permission groups (chips), group rules (table), blueprint arrays, key-value maps.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import { arkmaniaApi, blueprintsApi } from '../services/api'
import {
  Settings, Save, Search, Server, RotateCcw, AlertCircle, Check, Download,
  LogIn, Zap, Eye, Package, Shield, Heart, MessageSquare, Timer, Bell, MessageCircle, Trophy,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Plus, X, Trash2, GripVertical,
  UserCheck, Users, FileText, Swords, Crosshair, ShieldAlert, Hammer, Gauge
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const MODULE_ICONS: Record<string, LucideIcon> = {
  Login: LogIn, Plus: Zap, RareDino: Eye, ItemPlus: Package,
  ServerRules: Shield, DeadSaver: Heart, CrossChat: MessageSquare,
  DecayManager: Timer, Discord: Bell, Messages: MessageCircle,
  Leaderboard: Trophy, LeaderBoard: Trophy,
  nc: UserCheck, te: Users, tl: FileText,
  craftlimit: Package, plus: Zap, PvPManager: Swords,
  RangeManager: Crosshair, SpawnProtection: ShieldAlert,
}

interface ConfigModule { prefix: string; label: string; icon: string; key_count: number }
interface ConfigItem {
  config_key: string; short_key: string; value: string; global_value: string | null
  description: string; is_overridden: boolean; override_value: string | null
}
interface ServerItem { server_key: string; display_name: string; map_name: string; is_online: boolean; player_count: number }

// ============================================================
// Intelligent auto-description derived from the config key name
// ============================================================
type TFn = (key: string, options?: Record<string, unknown>) => string

function autoDescription(shortKey: string, t: TFn): string {
  const k = shortKey.toLowerCase()
  const last = shortKey.split('.').pop() || ''
  const lastLow = last.toLowerCase()

  // Pattern Cmd.xxx.yyy
  if (k.includes('cmd.')) {
    const parts = shortKey.split('.')
    const cmd = parts.length >= 2 ? parts[1] : ''
    if (lastLow === 'cooldown') return t('arkmaniaConfig.autoDesc.cmdCooldown', { cmd })
    if (lastLow === 'range') return t('arkmaniaConfig.autoDesc.cmdRange', { cmd })
    if (lastLow === 'value') return t('arkmaniaConfig.autoDesc.cmdValue', { cmd })
    if (lastLow === 'cost') {
      const group = parts.length >= 3 ? parts[parts.length - 2] : ''
      return t('arkmaniaConfig.autoDesc.cmdCost', { cmd, group })
    }
  }

  // Pattern comuni
  if (lastLow === 'enabled') return t('arkmaniaConfig.autoDesc.enabled')
  if (lastLow === 'cooldown' || lastLow === 'cooldownsec') return t('arkmaniaConfig.autoDesc.cooldown')
  if (lastLow === 'range') return t('arkmaniaConfig.autoDesc.range')
  if (lastLow === 'cost') return t('arkmaniaConfig.autoDesc.cost')
  if (lastLow.includes('interval')) return t('arkmaniaConfig.autoDesc.interval')
  if (lastLow.includes('max')) return t('arkmaniaConfig.autoDesc.max')
  if (lastLow.includes('min') && !lastLow.includes('admin')) return t('arkmaniaConfig.autoDesc.min')
  if (lastLow.includes('color')) return t('arkmaniaConfig.autoDesc.color')
  if (lastLow.includes('prefix')) return t('arkmaniaConfig.autoDesc.prefix')
  if (lastLow.includes('message') || lastLow.includes('msg')) return t('arkmaniaConfig.autoDesc.message')
  if (lastLow.includes('webhook')) return t('arkmaniaConfig.autoDesc.webhook')
  if (lastLow.includes('channel')) return t('arkmaniaConfig.autoDesc.channel')
  if (lastLow.includes('url')) return t('arkmaniaConfig.autoDesc.url')
  if (lastLow.includes('timeout') || lastLow.includes('sec')) return t('arkmaniaConfig.autoDesc.timeout')
  if (lastLow.includes('days') || lastLow.includes('day')) return t('arkmaniaConfig.autoDesc.days')
  if (lastLow.includes('hours') || lastLow.includes('hour')) return t('arkmaniaConfig.autoDesc.hours')
  if (lastLow.includes('limit')) return t('arkmaniaConfig.autoDesc.limit')
  if (lastLow.includes('radius')) return t('arkmaniaConfig.autoDesc.radius')
  if (lastLow.includes('multiplier') || lastLow.includes('mult')) return t('arkmaniaConfig.autoDesc.multiplier')
  if (lastLow.includes('percent') || lastLow.includes('pct')) return t('arkmaniaConfig.autoDesc.percent')
  if (lastLow.includes('count')) return t('arkmaniaConfig.autoDesc.count')
  if (lastLow.includes('level')) return t('arkmaniaConfig.autoDesc.level')
  if (lastLow.includes('weight')) return t('arkmaniaConfig.autoDesc.weight')
  if (lastLow.includes('speed')) return t('arkmaniaConfig.autoDesc.speed')

  return ''
}

// ============================================================
// Detect editor type based on config key name
// ============================================================
type EditorType = 'bool' | 'text' | 'groups' | 'ordered_groups' | 'group_rules' | 'blueprints' | 'key_value' | 'craft_rules' | 'json'

function detectEditorType(key: string, value: string): EditorType {
  if (['true', 'false'].includes(value.toLowerCase())) return 'bool'

  // CraftLimit — lista strutture con limiti per gruppo
  if (key.endsWith('struct.rules') || key === 'struct.rules') {
    if (value === '[]' || value.startsWith('[')) {
      try { const arr = JSON.parse(value); if (Array.isArray(arr)) return 'craft_rules' } catch {}
    }
  }

  // CraftLimit — priorità gruppi (ordine conta)
  if (key.endsWith('group_priority') && value.startsWith('[')) {
    try { const arr = JSON.parse(value); if (Array.isArray(arr) && arr.every((i: unknown) => typeof i === 'string')) return 'ordered_groups' } catch {}
  }

  // Gruppi permessi — array di stringhe con "Group" nel nome chiave
  const groupKeys = ['Groups', 'AdminGroups', 'AllowedGroups', 'VIPGroups', 'MuteAdminGroups', 'RequiredGroups']
  if (groupKeys.some(gk => key.endsWith(gk)) && value.startsWith('[')) {
    try { const arr = JSON.parse(value); if (Array.isArray(arr) && arr.every((i: unknown) => typeof i === 'string')) return 'groups' } catch {}
  }

  // Group rules — array di oggetti con Group+DecayDays
  if (key.endsWith('GroupRules') && value.startsWith('[')) {
    try { const arr = JSON.parse(value); if (Array.isArray(arr) && arr.length > 0 && arr[0].Group) return 'group_rules' } catch {}
  }
  // Anche array vuoto se la chiave è GroupRules
  if (key.endsWith('GroupRules') && value === '[]') return 'group_rules'

  // Blueprint arrays
  if ((key.endsWith('RewardPool') || key.endsWith('BlockedItems') || key.endsWith('BlockedEngrams')) && value.startsWith('[')) return 'blueprints'

  // Key-value objects (MapDisplayNames)
  if (key.endsWith('MapDisplayNames') && value.startsWith('{')) return 'key_value'

  // Generic JSON
  if ((value.startsWith('[') || value.startsWith('{')) && value.length > 2) {
    try { JSON.parse(value); return 'json' } catch {}
  }

  return 'text'
}

// ============================================================
// Sub-components: GUI editors
// ============================================================

/** Chip-based editor for permission groups */
function GroupsEditor({ value, onChange, availableGroups }: { value: string; onChange: (v: string) => void; availableGroups: string[] }) {
  const { t } = useTranslation()
  let groups: string[] = []
  try { groups = JSON.parse(value) } catch { groups = [] }
  const [showAdd, setShowAdd] = useState(false)

  function addGroup(g: string) {
    if (!groups.includes(g)) {
      const next = [...groups, g]
      onChange(JSON.stringify(next))
    }
    setShowAdd(false)
  }
  function removeGroup(g: string) {
    onChange(JSON.stringify(groups.filter(x => x !== g)))
  }
  const remaining = availableGroups.filter(g => !groups.includes(g))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      {groups.map(g => (
        <span key={g} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.2rem 0.5rem', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
          background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid var(--accent)',
        }}>
          {g}
          <button onClick={() => removeGroup(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, display: 'flex' }}>
            <X size={12} />
          </button>
        </span>
      ))}
      {showAdd ? (
        <div style={{ position: 'relative' }}>
          <select autoFocus onChange={e => { if (e.target.value) addGroup(e.target.value) }} onBlur={() => setShowAdd(false)}
            className="input" style={{ fontSize: '0.78rem', height: 28, width: 140, padding: '0 0.4rem' }}>
            <option value="">{t('arkmaniaConfig.editors.selectPlaceholder')}</option>
            {remaining.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.15rem', padding: '0.2rem 0.45rem',
          borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
          background: 'var(--bg-card-muted)', border: '1px dashed var(--border)', color: 'var(--text-muted)',
        }}>
          <Plus size={11} /> {t('arkmaniaConfig.editors.addLabel')}
        </button>
      )}
    </div>
  )
}

/** Table editor for group rules (e.g. DecayManager.GroupRules) */
function GroupRulesEditor({ value, onChange, availableGroups }: { value: string; onChange: (v: string) => void; availableGroups: string[] }) {
  const { t } = useTranslation()
  let rules: { Group: string; DecayDays: number }[] = []
  try { rules = JSON.parse(value) } catch { rules = [] }

  function updateRule(idx: number, field: string, val: string | number) {
    const next = [...rules]
    next[idx] = { ...next[idx], [field]: val }
    onChange(JSON.stringify(next))
  }
  function addRule() {
    const next = [...rules, { Group: availableGroups[0] || 'Default', DecayDays: 7 }]
    onChange(JSON.stringify(next))
  }
  function removeRule(idx: number) {
    onChange(JSON.stringify(rules.filter((_, i) => i !== idx)))
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {rules.map((rule, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.5rem', background: 'var(--bg-card-muted)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <GripVertical size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <select className="input" value={rule.Group} onChange={e => updateRule(i, 'Group', e.target.value)}
              style={{ fontSize: '0.8rem', height: 30, flex: 1 }}>
              {availableGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('arkmaniaConfig.editors.daysLabel')}</span>
              <input type="number" className="input" value={rule.DecayDays} onChange={e => updateRule(i, 'DecayDays', Number(e.target.value))}
                style={{ width: 60, fontSize: '0.8rem', height: 30, textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
            </div>
            <button onClick={() => removeRule(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2, flexShrink: 0 }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={addRule} style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.2rem', marginTop: '0.35rem',
        padding: '0.25rem 0.55rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
        background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
      }}>
        <Plus size={11} /> {t('arkmaniaConfig.editors.addRule')}
      </button>
    </div>
  )
}

/** Blueprint list editor with DB search, type filters, and manual paste */
function BlueprintListEditor({ value, onChange, configKey }: { value: string; onChange: (v: string) => void; configKey?: string }) {
  const { t } = useTranslation()
  let items: string[] = []
  try { items = JSON.parse(value) } catch { items = [] }

  const [bpSearch, setBpSearch] = useState('')
  const [bpResults, setBpResults] = useState<{ name: string; blueprint: string; type: string; category: string }[]>([])
  const [bpLoading, setBpLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Tipo suggerito in base alla chiave config
  const suggestedType = configKey?.includes('Engram') ? '' : configKey?.includes('Reward') ? '' : ''

  useEffect(() => {
    if (bpSearch.length < 2) { setBpResults([]); return }
    setBpLoading(true)
    const timer = setTimeout(async () => {
      try {
        const params: Record<string, string | number> = { search: bpSearch, limit: 12 }
        if (typeFilter) params.type = typeFilter
        const res = await blueprintsApi.list(params)
        setBpResults(res.data.items?.map((i: Record<string, string>) => ({
          name: i.name, blueprint: i.blueprint,
          type: i.type || 'item', category: i.category || '',
        })) || [])
      } catch { setBpResults([]) }
      finally { setBpLoading(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [bpSearch, typeFilter])

  function addBp(bp: string) {
    const trimmed = bp.trim()
    if (trimmed && !items.includes(trimmed)) onChange(JSON.stringify([...items, trimmed]))
    setBpSearch(''); setBpResults([]); setPasteValue(''); setShowPaste(false)
  }
  function removeBp(idx: number) { onChange(JSON.stringify(items.filter((_, i) => i !== idx))) }
  function copyBp(bp: string) { navigator.clipboard.writeText(bp) }

  function extractName(bp: string) {
    const m = bp.match(/\.([^.]+)'?$/)
    if (!m) return bp.slice(0, 50)
    let name = m[1]
    for (const pfx of ['PrimalItemArmor_', 'PrimalItemResource_', 'PrimalItem_Weapon', 'PrimalItemConsumable_', 'PrimalItem_', 'PrimalItemAmmo_'])
      if (name.startsWith(pfx)) { name = name.slice(pfx.length); break }
    name = name.replace(/_Character_BP$/, '').replace(/_/g, ' ')
    return name
  }

  function getTypeBadge(type: string) {
    const map: Record<string, { bg: string; color: string; labelKey: string }> = {
      dino:      { bg: 'rgba(34,197,94,0.12)', color: '#16a34a', labelKey: 'arkmaniaConfig.typeBadge.dino' },
      armor:     { bg: 'rgba(37,99,235,0.1)', color: '#2563eb', labelKey: 'arkmaniaConfig.typeBadge.armor' },
      weapon:    { bg: 'rgba(239,68,68,0.1)', color: '#dc2626', labelKey: 'arkmaniaConfig.typeBadge.weapon' },
      resource:  { bg: 'rgba(217,119,6,0.1)', color: '#d97706', labelKey: 'arkmaniaConfig.typeBadge.resource' },
      consumable:{ bg: 'rgba(168,85,247,0.1)', color: '#a855f7', labelKey: 'arkmaniaConfig.typeBadge.consumable' },
      structure: { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', labelKey: 'arkmaniaConfig.typeBadge.structure' },
      item:      { bg: 'rgba(107,114,128,0.08)', color: '#9ca3af', labelKey: 'arkmaniaConfig.typeBadge.item' },
    }
    const m = map[type] || map.item
    return (
      <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
        padding: '0.1rem 0.35rem', borderRadius: 3, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
        {t(m.labelKey)}
      </span>
    )
  }

  const TYPE_FILTERS = [
    { value: '', label: t('arkmaniaConfig.typeFilter.all') },
    { value: 'item', label: t('arkmaniaConfig.typeFilter.items') },
    { value: 'armor', label: t('arkmaniaConfig.typeFilter.armor') },
    { value: 'weapon', label: t('arkmaniaConfig.typeFilter.weapons') },
    { value: 'dino', label: t('arkmaniaConfig.typeFilter.dino') },
    { value: 'resource', label: t('arkmaniaConfig.typeFilter.resources') },
    { value: 'consumable', label: t('arkmaniaConfig.typeFilter.consumable') },
  ]

  return (
    <div style={{ width: '100%' }}>
      {/* Lista elementi correnti */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '0.4rem' }}>
        {items.map((bp, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', background: 'var(--bg-card-muted)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <Package size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {extractName(bp)}
            </span>
            <span style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={bp}>
              {bp.split('/').pop()?.replace("'", '')}
            </span>
            <button onClick={() => copyBp(bp)} title={t('arkmaniaConfig.editors.copyBp')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0 }}>
              <Search size={11} />
            </button>
            <button onClick={() => removeBp(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2, flexShrink: 0 }}>
              <X size={12} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.2rem 0' }}>{t('arkmaniaConfig.editors.noBlueprints')}</div>}
      </div>

      {/* Azioni */}
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        {!showSearch && !showPaste && (
          <>
            <button onClick={() => { setShowSearch(true); setShowPaste(false) }} style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
              padding: '0.25rem 0.55rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
              background: 'var(--accent-glow)', border: '1px solid var(--accent)', color: 'var(--accent)',
            }}>
              <Search size={11} /> {t('arkmaniaConfig.editors.searchDb')}
            </button>
            <button onClick={() => { setShowPaste(true); setShowSearch(false) }} style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
              padding: '0.25rem 0.55rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
              background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
            }}>
              <Plus size={11} /> {t('arkmaniaConfig.editors.pasteBp')}
            </button>
          </>
        )}
      </div>

      {/* Ricerca da DB */}
      {showSearch && (
        <div style={{ marginTop: '0.35rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)' }}>
          {/* Filtri tipo */}
          <div style={{ display: 'flex', gap: '1px', padding: '0.3rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-card-muted)', borderRadius: '8px 8px 0 0', flexWrap: 'wrap' }}>
            {TYPE_FILTERS.map(f => (
              <button key={f.value} onClick={() => setTypeFilter(f.value)} style={{
                padding: '0.15rem 0.45rem', borderRadius: 4, border: 'none', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer',
                background: typeFilter === f.value ? 'var(--accent)' : 'transparent',
                color: typeFilter === f.value ? '#fff' : 'var(--text-muted)',
              }}>
                {f.label}
              </button>
            ))}
            <button onClick={() => { setShowSearch(false); setBpSearch(''); setBpResults([]) }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 0.3rem' }}>
              <X size={13} />
            </button>
          </div>
          {/* Input ricerca */}
          <div style={{ padding: '0.4rem', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input autoFocus className="input" placeholder={t('arkmaniaConfig.editors.bpSearchPlaceholder')} value={bpSearch} onChange={e => setBpSearch(e.target.value)}
                style={{ paddingLeft: 28, fontSize: '0.8rem', height: 32 }} />
              {bpLoading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t('arkmaniaConfig.editors.searching')}</span>}
            </div>
          </div>
          {/* Risultati */}
          {bpResults.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
              {bpResults.map((bp, i) => {
                const alreadyAdded = items.includes(bp.blueprint)
                return (
                  <button key={i} onClick={() => !alreadyAdded && addBp(bp.blueprint)} disabled={alreadyAdded}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                      padding: '0.4rem 0.6rem', border: 'none', borderBottom: '1px solid var(--border)',
                      background: alreadyAdded ? 'var(--bg-card-muted)' : 'transparent',
                      cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left',
                      opacity: alreadyAdded ? 0.5 : 1,
                    }}
                    onMouseOver={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseOut={e => { if (!alreadyAdded) e.currentTarget.style.background = 'transparent' }}>
                    {getTypeBadge(bp.type)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{bp.name}</div>
                      <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bp.blueprint.split('/').pop()?.replace("'", '')}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>{bp.category}</span>
                    {alreadyAdded && <Check size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          )}
          {bpSearch.length >= 2 && bpResults.length === 0 && !bpLoading && (
            <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t('arkmaniaConfig.editors.noBpResults')}
            </div>
          )}
        </div>
      )}

      {/* Incolla manuale */}
      {showPaste && (
        <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <input autoFocus className="input" placeholder={t('arkmaniaConfig.editors.pastePlaceholder')} value={pasteValue} onChange={e => setPasteValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pasteValue.trim()) addBp(pasteValue) }}
            style={{ flex: 1, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', height: 30 }} />
          <button onClick={() => { if (pasteValue.trim()) addBp(pasteValue) }} className="btn btn-primary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', height: 30 }}>
            <Plus size={12} /> {t('arkmaniaConfig.editors.addLabel')}
          </button>
          <button onClick={() => { setShowPaste(false); setPasteValue('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Key-value editor (e.g. MapDisplayNames) */
function KeyValueEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  let obj: Record<string, string> = {}
  try { obj = JSON.parse(value) } catch {}
  const entries = Object.entries(obj)

  function updateEntry(oldKey: string, newKey: string, val: string) {
    const next = { ...obj }
    if (newKey !== oldKey) delete next[oldKey]
    next[newKey] = val
    onChange(JSON.stringify(next))
  }
  function removeEntry(key: string) {
    const next = { ...obj }; delete next[key]
    onChange(JSON.stringify(next))
  }
  function addEntry() {
    const next = { ...obj, '': '' }
    onChange(JSON.stringify(next))
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {entries.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input value={k} onChange={e => updateEntry(k, e.target.value, v)} placeholder={t('arkmaniaConfig.editors.keyPlaceholder')}
              style={{ flex: 1, fontSize: '0.78rem', height: 30, fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '0 0.5rem', outline: 'none' }} />
            <span style={{ color: 'var(--green)', fontSize: '0.8rem', flexShrink: 0 }}>→</span>
            <input value={v} onChange={e => updateEntry(k, k, e.target.value)} placeholder={t('arkmaniaConfig.editors.valuePlaceholder')}
              style={{ flex: 1, fontSize: '0.78rem', height: 30, background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '0 0.5rem', outline: 'none' }} />
            <button onClick={() => removeEntry(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={addEntry} style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.2rem', marginTop: '0.3rem',
        padding: '0.2rem 0.5rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
        background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
      }}>
        <Plus size={11} /> {t('arkmaniaConfig.editors.addLabel')}
      </button>
    </div>
  )
}

/** Ordered list of permission groups — priority matters (↑↓ reorder) */
function OrderedGroupsEditor({ value, onChange, availableGroups }: { value: string; onChange: (v: string) => void; availableGroups: string[] }) {
  const { t } = useTranslation()
  let groups: string[] = []
  try { groups = JSON.parse(value) } catch { groups = [] }
  const [showAdd, setShowAdd] = useState(false)

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= groups.length) return
    const next = [...groups]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(JSON.stringify(next))
  }
  function remove(idx: number) { onChange(JSON.stringify(groups.filter((_, i) => i !== idx))) }
  function add(g: string) {
    if (g && !groups.includes(g)) onChange(JSON.stringify([...groups, g]))
    setShowAdd(false)
  }
  const remaining = availableGroups.filter(g => !groups.includes(g))

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map((g, i) => (
          <div key={g} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.5rem', background: 'var(--bg-card-muted)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: 16, textAlign: 'center' }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}>{g}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0}
              style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--text-muted)', padding: 2 }}>
              <ChevronUp size={13} />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === groups.length - 1}
              style={{ background: 'none', border: 'none', cursor: i === groups.length - 1 ? 'default' : 'pointer', color: i === groups.length - 1 ? 'var(--border)' : 'var(--text-muted)', padding: 2 }}>
              <ChevronDown size={13} />
            </button>
            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {showAdd ? (
        <select autoFocus onChange={e => { if (e.target.value) add(e.target.value) }} onBlur={() => setShowAdd(false)}
          className="input" style={{ marginTop: 4, fontSize: '0.78rem', height: 28, width: 160, padding: '0 0.4rem' }}>
          <option value="">{t('arkmaniaConfig.editors.selectGroupPlaceholder')}</option>
          {remaining.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.2rem', marginTop: 4,
          padding: '0.2rem 0.5rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 500, cursor: 'pointer',
          background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)',
        }}>
          <Plus size={11} /> {t('arkmaniaConfig.editors.addGroup')}
        </button>
      )}
    </div>
  )
}

/** GUI editor for CraftLimit.struct.rules — list of structures with per-group limits */
interface CraftLimit { CraftingSpeedMultiplier: number; MaxItemCount: number }
interface CraftRule { Name: string; Blueprint: string; Groups: Record<string, CraftLimit> }

function CraftLimitRulesEditor({ value, onChange, availableGroups }: { value: string; onChange: (v: string) => void; availableGroups: string[] }) {
  const { t } = useTranslation()
  let rules: CraftRule[] = []
  try { rules = JSON.parse(value) } catch { rules = [] }

  const [expandedIdx, setExpandedIdx] = useState<number | null>(rules.length === 0 ? null : 0)
  const [bpSearchIdx, setBpSearchIdx] = useState<number | null>(null)
  const [bpQuery, setBpQuery] = useState('')
  const [bpResults, setBpResults] = useState<{ name: string; blueprint: string }[]>([])
  const [bpLoading, setBpLoading] = useState(false)

  function persist(next: CraftRule[]) { onChange(JSON.stringify(next)) }

  function addRule() {
    const next = [...rules, { Name: 'NewStructure', Blueprint: '', Groups: { Default: { CraftingSpeedMultiplier: 100, MaxItemCount: 100 } } }]
    persist(next)
    setExpandedIdx(next.length - 1)
  }
  function removeRule(i: number) {
    persist(rules.filter((_, idx) => idx !== i))
    if (expandedIdx === i) setExpandedIdx(null)
  }
  function updateRule(i: number, patch: Partial<CraftRule>) {
    const next = [...rules]; next[i] = { ...next[i], ...patch }; persist(next)
  }
  function updateGroup(i: number, group: string, patch: Partial<CraftLimit>) {
    const next = [...rules]
    next[i] = { ...next[i], Groups: { ...next[i].Groups, [group]: { ...next[i].Groups[group], ...patch } } }
    persist(next)
  }
  function addGroup(i: number, group: string) {
    if (!group || rules[i].Groups[group]) return
    const next = [...rules]
    next[i] = { ...next[i], Groups: { ...next[i].Groups, [group]: { CraftingSpeedMultiplier: 100, MaxItemCount: 100 } } }
    persist(next)
  }
  function removeGroup(i: number, group: string) {
    const next = [...rules]
    const rest: Record<string, CraftLimit> = {}
    for (const k of Object.keys(next[i].Groups)) if (k !== group) rest[k] = next[i].Groups[k]
    next[i] = { ...next[i], Groups: rest }
    persist(next)
  }

  // Debounced blueprint search for the structure currently being edited
  useEffect(() => {
    if (bpSearchIdx === null || bpQuery.length < 2) { setBpResults([]); return }
    setBpLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await blueprintsApi.list({ search: bpQuery, type: 'structure', limit: 10 })
        setBpResults(res.data.items?.map((i: Record<string, string>) => ({ name: i.name, blueprint: i.blueprint })) || [])
      } catch { setBpResults([]) }
      finally { setBpLoading(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [bpQuery, bpSearchIdx])

  function extractName(bp: string) {
    const m = bp.match(/\.([^.]+)'?$/)
    if (!m) return bp.slice(0, 50)
    return m[1].replace(/^PrimalItemStructure_/, '').replace(/_/g, ' ')
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rules.map((rule, i) => {
        const isOpen = expandedIdx === i
        const groupNames = Object.keys(rule.Groups)
        const bpShort = rule.Blueprint ? rule.Blueprint.split('/').pop()?.replace("'", '') : t('arkmaniaConfig.editors.noBlueprintTag')
        return (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card-muted)', overflow: 'hidden' }}>
            {/* Header row (always visible) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', cursor: 'pointer' }} onClick={() => setExpandedIdx(isOpen ? null : i)}>
              <Hammer size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{rule.Name || t('arkmaniaConfig.editors.unnamed')}</div>
                <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rule.Blueprint}>{bpShort}</div>
              </div>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '0.1rem 0.4rem', borderRadius: 4, border: '1px solid var(--border)', flexShrink: 0 }}>
                {t('arkmaniaConfig.editors.groupCount', { count: groupNames.length })}
              </span>
              <button onClick={e => { e.stopPropagation(); removeRule(i) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2, flexShrink: 0 }}>
                <Trash2 size={13} />
              </button>
              <ChevronDown size={13} style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.15s', flexShrink: 0 }} />
            </div>

            {/* Body (expanded) */}
            {isOpen && (
              <div style={{ padding: '0.5rem 0.6rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* Name */}
                <div>
                  <label style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 1 }}>{t('arkmaniaConfig.editors.nameLabel')}</label>
                  <input value={rule.Name} onChange={e => updateRule(i, { Name: e.target.value })}
                    style={{ fontSize: '0.82rem', height: 30, padding: '0.25rem 0.5rem', width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none', marginTop: 2 }} />
                </div>

                {/* Blueprint + picker */}
                <div>
                  <label style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 1 }}>{t('arkmaniaConfig.editors.blueprintLabel')}</label>
                  <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                    <input value={rule.Blueprint} onChange={e => updateRule(i, { Blueprint: e.target.value })} placeholder={t('arkmaniaConfig.editors.blueprintPlaceholder')}
                      style={{ flex: 1, fontSize: '0.72rem', fontFamily: 'var(--font-mono)', height: 30, padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
                    <button onClick={() => { setBpSearchIdx(bpSearchIdx === i ? null : i); setBpQuery(''); setBpResults([]) }}
                      className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', height: 30 }}>
                      <Search size={12} /> {t('arkmaniaConfig.editors.findButton')}
                    </button>
                  </div>
                  {bpSearchIdx === i && (
                    <div style={{ marginTop: 4, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card-muted)' }}>
                      <div style={{ padding: 4, position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input autoFocus value={bpQuery} onChange={e => setBpQuery(e.target.value)} placeholder={t('arkmaniaConfig.editors.searchStructuresPlaceholder')}
                          style={{ paddingLeft: 26, fontSize: '0.78rem', height: 28, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
                        {bpLoading && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>...</span>}
                      </div>
                      {bpResults.length > 0 && (
                        <div style={{ maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
                          {bpResults.map((bp, k) => (
                            <button key={k} onClick={() => { updateRule(i, { Blueprint: bp.blueprint, Name: rule.Name || extractName(bp.blueprint) }); setBpSearchIdx(null); setBpQuery('') }}
                              style={{ display: 'block', width: '100%', padding: '0.3rem 0.5rem', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{bp.name}</div>
                              <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bp.blueprint.split('/').pop()?.replace("'", '')}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Groups table */}
                <div>
                  <label style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 1 }}>{t('arkmaniaConfig.editors.limitsPerGroup')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 24px', gap: 6, padding: '0 0.3rem', fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      <span>{t('arkmaniaConfig.editors.columnGroup')}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Gauge size={10} /> {t('arkmaniaConfig.editors.columnSpeed')}</span>
                      <span><Package size={10} style={{ verticalAlign: 'middle' }} /> {t('arkmaniaConfig.editors.columnMax')}</span>
                      <span></span>
                    </div>
                    {groupNames.map(gname => {
                      const lim = rule.Groups[gname]
                      return (
                        <div key={gname} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 24px', gap: 6, alignItems: 'center' }}>
                          <span style={{ padding: '0.2rem 0.4rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: 6 }}>{gname}</span>
                          <input type="number" step="0.1" value={lim.CraftingSpeedMultiplier}
                            onChange={e => updateGroup(i, gname, { CraftingSpeedMultiplier: Number(e.target.value) })}
                            style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', height: 28, padding: '0 0.4rem', textAlign: 'right', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
                          <input type="number" value={lim.MaxItemCount}
                            onChange={e => updateGroup(i, gname, { MaxItemCount: Number(e.target.value) })}
                            style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', height: 28, padding: '0 0.4rem', textAlign: 'right', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
                          <button onClick={() => removeGroup(i, gname)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
                            <X size={12} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {/* Add-group selector */}
                  {(() => {
                    const remaining = availableGroups.filter(g => !groupNames.includes(g))
                    if (remaining.length === 0) return null
                    return (
                      <select value="" onChange={e => { if (e.target.value) addGroup(i, e.target.value) }}
                        style={{ marginTop: 4, fontSize: '0.72rem', height: 26, padding: '0 0.4rem', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 6, cursor: 'pointer', outline: 'none' }}>
                        <option value="">{t('arkmaniaConfig.editors.addGroupLimit')}</option>
                        {remaining.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {rules.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.3rem 0' }}>{t('arkmaniaConfig.editors.noCraftRules')}</div>
      )}
      <button onClick={addRule} style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.2rem', alignSelf: 'flex-start',
        padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
        background: 'var(--accent-glow)', border: '1px solid var(--accent)', color: 'var(--accent)',
      }}>
        <Plus size={12} /> {t('arkmaniaConfig.editors.addStructure')}
      </button>
    </div>
  )
}

// ============================================================
// Main page component
// ============================================================
export default function ArkManiaConfigPage() {
  const { t } = useTranslation()
  const { module: urlModule } = useParams()
  const navigate = useNavigate()

  const [modules, setModules] = useState<ConfigModule[]>([])
  const [activeModule, setActiveModule] = useState('')
  const [items, setItems] = useState<ConfigItem[]>([])
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [servers, setServers] = useState<ServerItem[]>([])
  const [selectedServer, setSelectedServer] = useState('*')
  const [loading, setLoading] = useState(true)
  const [moduleLoading, setModuleLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedJsonKeys, setExpandedJsonKeys] = useState<Set<string>>(new Set())
  const [permGroups, setPermGroups] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      try {
        const [modRes, srvRes, grpRes] = await Promise.all([
          arkmaniaApi.listModules(),
          arkmaniaApi.listServers(),
          arkmaniaApi.getPermissionGroups(),
        ])
        setModules(modRes.data.modules)
        setServers(srvRes.data.servers)
        setPermGroups(grpRes.data.groups)
        const target = urlModule || modRes.data.modules[0]?.prefix || ''
        if (target) setActiveModule(target)
      } catch (e: any) { setError(e.response?.data?.detail || e.message) }
      finally { setLoading(false) }
    }
    load()
  }, [urlModule])

  const loadModuleConfig = useCallback(async () => {
    if (!activeModule) return
    setModuleLoading(true)
    try {
      const res = await arkmaniaApi.getModule(activeModule, selectedServer)
      setItems(res.data.items)
      setEditedValues({})
      setSaved(false)
      setSearchQuery('')
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setModuleLoading(false) }
  }, [activeModule, selectedServer])

  useEffect(() => { loadModuleConfig() }, [loadModuleConfig])

  function handleTabClick(prefix: string) {
    setActiveModule(prefix)
    navigate(`/plugins/config/${prefix}`, { replace: true })
  }

  function handleValueChange(key: string, value: string) {
    setEditedValues(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    if (Object.keys(editedValues).length === 0) return
    setSaving(true); setError('')
    try {
      const updateItems = Object.entries(editedValues).map(([key, val]) => ({ config_key: key, config_value: val }))
      await arkmaniaApi.updateModule(activeModule, selectedServer, updateItems)
      setSaved(true)
      await loadModuleConfig()
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setSaving(false) }
  }

  function handleExportJSON() {
    const data: Record<string, Record<string, { value: string; description: string }>> = {}
    items.forEach(item => {
      const sv = selectedServer
      if (!data[sv]) data[sv] = {}
      data[sv][item.config_key] = {
        value: editedValues[item.config_key] ?? item.value,
        description: item.description || '',
      }
    })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `config_${activeModule}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasChanges = Object.keys(editedValues).length > 0
  const filteredItems = searchQuery
    ? items.filter(i => i.short_key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : items

  // Group by sub-section and sort: Enabled fields always first
  const groupedItems: Record<string, ConfigItem[]> = {}
  filteredItems.forEach(item => {
    const parts = item.short_key.split('.')
    const group = parts.length > 2 ? parts[0] : '_general'
    if (!groupedItems[group]) groupedItems[group] = []
    groupedItems[group].push(item)
  })
  // Sort within each group: Enabled first, then alphabetical
  for (const group of Object.keys(groupedItems)) {
    groupedItems[group].sort((a, b) => {
      const aIsEnabled = a.short_key.toLowerCase().endsWith('enabled') || a.short_key.toLowerCase() === 'enabled'
      const bIsEnabled = b.short_key.toLowerCase().endsWith('enabled') || b.short_key.toLowerCase() === 'enabled'
      if (aIsEnabled && !bIsEnabled) return -1
      if (!aIsEnabled && bIsEnabled) return 1
      return a.short_key.localeCompare(b.short_key)
    })
  }

  if (loading) return <div className="page-container"><div className="pl-loading">{t('arkmaniaConfig.loading')}</div></div>

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '0.5rem' }}>
        <div className="page-header-text">
          <h1 className="page-title"><Settings size={22} /> {t('arkmaniaConfig.heading')}</h1>
          <p className="page-subtitle">
            {t('arkmaniaConfig.subtitle', { keys: modules.reduce((s, m) => s + m.key_count, 0), online: servers.filter(s => s.is_online).length })}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-input)', borderRadius: 'var(--radius)', padding: '0.35rem 0.6rem', border: '1px solid var(--border)' }}>
            <Server size={14} style={{ color: 'var(--text-muted)' }} />
            <select value={selectedServer} onChange={e => setSelectedServer(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              <option value="*">{t('arkmaniaConfig.server.global')}</option>
              {servers.map(s => <option key={s.server_key} value={s.server_key}>{s.is_online ? t('arkmaniaConfig.server.onlinePrefix') : t('arkmaniaConfig.server.offlinePrefix')}{s.display_name}</option>)}
            </select>
          </div>
          <button onClick={handleExportJSON} className="btn btn-ghost" style={{ fontSize: '0.8rem' }} title={t('arkmaniaConfig.actions.exportTooltip')}>
            <Download size={14} /> {t('arkmaniaConfig.actions.export')}
          </button>
          {hasChanges && (
            <button onClick={() => setEditedValues({})} className="btn btn-ghost" style={{ fontSize: '0.8rem' }}>
              <RotateCcw size={14} /> {t('arkmaniaConfig.actions.discard')}
            </button>
          )}
          <button onClick={handleSave} className="btn btn-primary" disabled={!hasChanges || saving} style={{ fontSize: '0.8rem' }}>
            {saving ? t('arkmaniaConfig.actions.saving') : saved ? <><Check size={14} /> {t('arkmaniaConfig.actions.saved')}</> : <><Save size={14} /> {t('arkmaniaConfig.actions.save', { count: Object.keys(editedValues).length })}</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Two-column layout: plugin sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 'calc(100vh - 200px)', background: 'var(--bg-card)' }}>
        {/* Left sidebar — plugin list */}
        <div style={{ background: 'var(--bg-card-muted)', borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '0.4rem' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 3, fontFamily: 'var(--font-mono)', color: 'var(--green)', padding: '0.6rem 0.6rem 0.3rem', fontWeight: 600 }}>{t('arkmaniaConfig.plugins')}</div>
          {modules.map(m => {
            const Icon = MODULE_ICONS[m.prefix] || Settings
            const isActive = activeModule === m.prefix
            return (
              <button key={m.prefix} onClick={() => handleTabClick(m.prefix)} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%',
                padding: '0.42rem 0.6rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                textAlign: 'left', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                background: isActive ? 'rgba(74,222,128,0.08)' : 'transparent',
                color: isActive ? 'var(--green)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 500, fontSize: '0.8rem',
                borderLeft: isActive ? '3px solid var(--green)' : '3px solid transparent',
                transition: 'all 0.12s', marginBottom: 1,
              }}>
                <Icon size={14} style={{ opacity: isActive ? 1 : 0.45 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
                <span style={{ fontSize: '0.65rem', opacity: 0.5, fontFamily: 'var(--font-mono)' }}>{m.key_count}</span>
              </button>
            )
          })}
        </div>

        {/* Right content */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-card-muted)', flexShrink: 0, flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--text-primary)' }}>
                {modules.find(m => m.prefix === activeModule)?.label}
              </span>
              {selectedServer !== '*' && (
                <span style={{ fontSize: '0.65rem', background: 'var(--warning-bg)', color: 'var(--warning)', padding: '0.1rem 0.4rem', borderRadius: 4, fontWeight: 600 }}>
                  {t('arkmaniaConfig.toolbar.override', { name: servers.find(s => s.server_key === selectedServer)?.display_name })}
                </span>
              )}
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('arkmaniaConfig.toolbar.keysCount', { count: filteredItems.length })}</span>
            </div>
            <div style={{ position: 'relative', width: 220 }}>
              <Search size={13} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" placeholder={t('arkmaniaConfig.toolbar.filterPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 26, fontSize: '0.78rem', height: 30, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
            </div>
          </div>

          {/* Config items */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {moduleLoading ? (
              <div className="pl-loading">{t('arkmaniaConfig.loadingModule')}</div>
            ) : Object.entries(groupedItems).map(([group, groupItems]) => (
              <div key={group}>
                {group !== '_general' && (
                  <div style={{ padding: '0.35rem 0.75rem', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 3, fontFamily: 'var(--font-mono)', color: 'var(--green)', background: 'var(--bg-card-muted)', borderBottom: '1px solid var(--border)' }}>
                    {group}
                  </div>
                )}
              {/* Render bools as a compact toggle grid */}
              {(() => {
                const boolItems = groupItems.filter(i => detectEditorType(i.short_key, i.value) === 'bool')
                const otherItems = groupItems.filter(i => detectEditorType(i.short_key, i.value) !== 'bool')
                return (<>
                  {/* Toggles grid — compact 2-3 column layout */}
                  {boolItems.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2px', padding: '0.3rem 0' }}>
                      {boolItems.map(item => {
                        const currentValue = editedValues[item.config_key] ?? item.value
                        const isEdited = item.config_key in editedValues
                        const isOn = currentValue.toLowerCase() === 'true'
                        const desc = item.description || autoDescription(item.short_key, t)
                        return (
                          <div key={item.config_key} onClick={() => handleValueChange(item.config_key, isOn ? 'false' : 'true')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.75rem', cursor: 'pointer',
                              borderLeft: isEdited ? '3px solid var(--green)' : '3px solid transparent',
                              background: isEdited ? 'rgba(74,222,128,0.04)' : 'transparent',
                              borderBottom: '1px solid var(--border)', transition: 'background 0.15s',
                            }}>
                            <div style={{
                              width: 36, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative',
                              background: isOn ? 'var(--green)' : '#374151', transition: 'background 0.2s',
                            }}>
                              <div style={{
                                width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute',
                                top: 2, left: isOn ? 18 : 2, transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                              }} />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isOn ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1.2 }}>
                                {item.short_key}
                                {isEdited && <span style={{ fontSize: '0.55rem', color: 'var(--green)', fontWeight: 700, background: 'rgba(74,222,128,0.12)', padding: '0.05rem 0.25rem', borderRadius: 3, marginLeft: 4, verticalAlign: 'middle' }}>{t('arkmaniaConfig.badges.mod')}</span>}
                              </div>
                              {desc && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.1, marginTop: 1 }}>{desc}</div>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* Non-bool fields — compact 2-column grid */}
                  {otherItems.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1px' }}>
                      {otherItems.map(item => {
                        const currentValue = editedValues[item.config_key] ?? item.value
                        const isEdited = item.config_key in editedValues
                        const editorType = detectEditorType(item.short_key, item.value)
                        const isWide = ['groups', 'group_rules', 'blueprints', 'key_value', 'json'].includes(editorType)
                        const isExpanded = expandedJsonKeys.has(item.config_key)
                        const desc = item.description || autoDescription(item.short_key, t)
                        return (
                          <div key={item.config_key} style={{
                            padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border)',
                            borderLeft: isEdited ? '3px solid var(--green)' : '3px solid transparent',
                            background: isEdited ? 'rgba(74,222,128,0.04)' : 'transparent',
                            gridColumn: isWide ? '1 / -1' : undefined,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginBottom: '0.2rem' }}>
                              <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{item.short_key}</span>
                              {item.is_overridden && <span style={{ fontSize: '0.55rem', color: 'var(--warning)', fontWeight: 700, background: 'var(--warning-bg)', padding: '0.05rem 0.25rem', borderRadius: 3 }}>{t('arkmaniaConfig.badges.ovr')}</span>}
                              {isEdited && <span style={{ fontSize: '0.55rem', color: 'var(--green)', fontWeight: 700, background: 'rgba(74,222,128,0.12)', padding: '0.05rem 0.25rem', borderRadius: 3 }}>{t('arkmaniaConfig.badges.mod')}</span>}
                            </div>
                            {desc && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.25rem', lineHeight: 1.1 }}>{desc}</div>}
                            <div>
                              {editorType === 'groups' ? (
                                <GroupsEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} availableGroups={permGroups} />
                              ) : editorType === 'ordered_groups' ? (
                                <OrderedGroupsEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} availableGroups={permGroups} />
                              ) : editorType === 'craft_rules' ? (
                                <CraftLimitRulesEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} availableGroups={permGroups} />
                              ) : editorType === 'group_rules' ? (
                                <GroupRulesEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} availableGroups={permGroups} />
                              ) : editorType === 'blueprints' ? (
                                <BlueprintListEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} configKey={item.short_key} />
                              ) : editorType === 'key_value' ? (
                                <KeyValueEditor value={currentValue} onChange={v => handleValueChange(item.config_key, v)} />
                              ) : editorType === 'json' ? (
                                <div>
                                  <button onClick={() => {
                                    const next = new Set(expandedJsonKeys)
                                    isExpanded ? next.delete(item.config_key) : next.add(item.config_key)
                                    setExpandedJsonKeys(next)
                                  }} className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}>
                                    <ChevronDown size={12} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
                                    {t('arkmaniaConfig.editors.jsonLabel', { count: item.value.length })}
                                  </button>
                                  {isExpanded && (
                                    <textarea value={currentValue} onChange={e => handleValueChange(item.config_key, e.target.value)}
                                      style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', marginTop: 4, width: '100%', resize: 'vertical', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.5rem', outline: 'none' }} rows={4} />
                                  )}
                                </div>
                              ) : (
                                <input type="text" value={currentValue} onChange={e => handleValueChange(item.config_key, e.target.value)}
                                  style={{ fontSize: '0.82rem', fontFamily: /^-?\d/.test(item.value) ? 'var(--font-mono)' : 'inherit', height: 32, padding: '0.25rem 0.5rem', width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>)
              })()}
            </div>
          ))}
          {filteredItems.length === 0 && !moduleLoading && (
            <div className="pl-empty"><Search size={32} style={{ opacity: 0.3 }} /><p>{searchQuery ? t('arkmaniaConfig.empty.noResults') : t('arkmaniaConfig.empty.noSettings')}</p></div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
