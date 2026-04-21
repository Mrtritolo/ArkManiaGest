/**
 * GameConfigPage — INI configuration editor for ASA containers.
 *
 * Features:
 * - Container selection via dropdown
 * - Setting group tabs with typed controls (bool toggle, number, text, password)
 * - Dedicated GUIs: Stack Sizes, Supply Crate Overrides, Crafting Costs, NPC Replacements, Spawn Entries
 * - Dynamic mod sections and uncategorized key viewer
 * - Raw INI editor for advanced users
 * - Save with automatic backup, unsaved-changes guard
 */
import './GameConfigPage.css'
import { useState, useEffect, useMemo } from 'react'
import {
  Settings, TrendingUp, Star, Sun, Swords, User, Bug, Heart,
  Building, Gamepad2, ShieldAlert, Snowflake, Timer, Crosshair,
  Gift, Users, Save, Loader2, AlertCircle, CheckCircle, RefreshCw,
  Code, Layers, Package, FileText, Undo2, Eye, EyeOff, X, Plus,
  Trash2, Search, ArrowLeftRight, Shield, Stethoscope, Replace
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { containersApi, gameConfigApi } from '../services/api'

const ICONS: Record<string, LucideIcon> = {
  Settings, TrendingUp, Star, Sun, Swords, User, Bug, Heart,
  Building, Gamepad2, ShieldAlert, Snowflake, Timer, Crosshair,
  Gift, Users, ArrowLeftRight, Shield, Stethoscope,
}

interface Container { name: string; machine_id: number; machine_name: string; hostname: string; map_name?: string; paths?: Record<string, string> }
interface SettingDef { type: string; section: string; file: string; default?: string | number | boolean; min?: number; max?: number; step?: number; label?: string }
interface GroupDef { label: string; icon: string; settings: Record<string, SettingDef> }
interface ConfigData { values: Record<string, Record<string, string>>; overrides: Record<string, unknown[]>; mod_sections: { gus: Record<string, Record<string, string>>; game: Record<string, Record<string, string>> }; uncategorized: { gus: Record<string, { key: string; value: string }[]>; game: Record<string, { key: string; value: string }[]> }; raw: { gus: string; game: string } }

export default function GameConfigPage() {
  const [containers, setContainers] = useState<Container[]>([])
  const [sel, setSel] = useState<Container | null>(null)
  const [groups, setGroups] = useState<Record<string, GroupDef>>({})
  const [configData, setConfigData] = useState<ConfigData | null>(null)
  const [localValues, setLocalValues] = useState<Record<string, Record<string, string>>>({})
  const [localStacks, setLocalStacks] = useState<Record<string, unknown>[]>([])
  const [localCrafting, setLocalCrafting] = useState<Record<string, unknown>[]>([])
  const [localNpcRepl, setLocalNpcRepl] = useState<Record<string, unknown>[]>([])
  const [localSupplyCrates, setLocalSupplyCrates] = useState<Record<string, unknown>[]>([])
  const [localSpawnEntries, setLocalSpawnEntries] = useState<Record<string, Record<string, unknown>[]>>({})
  const [rawGus, setRawGus] = useState('')
  const [rawGame, setRawGame] = useState('')
  const [activeTab, setActiveTab] = useState('general')
  const [loading, setLoading] = useState(true)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [showPw, setShowPw] = useState<Record<string, boolean>>({})
  const [stackSearch, setStackSearch] = useState('')

  useEffect(() => { loadContainers(); loadDefinitions() }, [])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t) } }, [success])

  async function loadContainers() {
    setLoading(true)
    try {
      const res = await containersApi.getAllContainers()
      const valid = (res.data.containers || []).filter((c: Record<string, unknown>) => {
        const paths = c.paths as Record<string, string> | undefined
        return paths?.gameusersettings_ini || paths?.game_ini
      })
      setContainers(valid)
    } catch { setError('Failed to load containers') }
    finally { setLoading(false) }
  }

  async function loadDefinitions() {
    try { const res = await gameConfigApi.getDefinitions(); setGroups(res.data.groups || {}) } catch {}
  }

  async function loadConfig(c: Container) {
    setLoadingConfig(true); setError('')
    try {
      const res = await gameConfigApi.loadConfig(c.machine_id, c.name)
      const d = res.data as ConfigData
      setConfigData(d)
      setLocalValues(JSON.parse(JSON.stringify(d.values)))
      setLocalStacks([...(d.overrides?.stacks as Record<string, unknown>[] || [])])
      setLocalCrafting([...(d.overrides?.crafting_costs as Record<string, unknown>[] || [])])
      setLocalNpcRepl([...(d.overrides?.npc_replacements as Record<string, unknown>[] || [])])
      setLocalSupplyCrates([...(d.overrides?.supply_crates as Record<string, unknown>[] || [])])
      setLocalSpawnEntries({
        add: [...(d.overrides?.ConfigAddNPCSpawnEntriesContainer as Record<string, unknown>[] || [])],
        override: [...(d.overrides?.ConfigOverrideNPCSpawnEntriesContainer as Record<string, unknown>[] || [])],
        subtract: [...(d.overrides?.ConfigSubtractNPCSpawnEntriesContainer as Record<string, unknown>[] || [])],
      })
      setRawGus(d.raw?.gus || ''); setRawGame(d.raw?.game || '')
      setHasChanges(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError('Failed to load config: ' + (detail || (e instanceof Error ? e.message : 'Unknown error')))
    }
    finally { setLoadingConfig(false) }
  }

  function selectContainer(name: string) {
    const c = containers.find(x => `${x.machine_id}|${x.name}` === name)
    if (!c) return
    if (hasChanges && !confirm('You have unsaved changes. Continue?')) return
    setSel(c); setActiveTab('general'); loadConfig(c)
  }

  function updateValue(gid: string, key: string, value: string) {
    setLocalValues(p => ({ ...p, [gid]: { ...p[gid], [key]: value } }))
    setHasChanges(true)
  }

  function resetValue(gid: string, key: string) {
    const d = groups[gid]?.settings[key]?.default
    if (d !== undefined) updateValue(gid, key, String(d))
  }

  // Count changed fields
  const changeCount = useMemo(() => {
    if (!configData) return 0
    let count = 0
    for (const [gid, gv] of Object.entries(localValues)) {
      for (const [key, value] of Object.entries(gv)) {
        const orig = (configData.values as Record<string, Record<string, string>>)[gid]?.[key]
        if (value !== (orig ?? '')) count++
      }
    }
    return count
  }, [localValues, configData])

  async function handleSave() {
    if (!sel || !configData) return
    setSaving(true); setError('')
    try {
      if (activeTab === 'raw') {
        if (rawGus !== configData.raw.gus) await gameConfigApi.saveRaw(sel.machine_id, sel.name, { file: 'gus', content: rawGus, backup: true })
        if (rawGame !== configData.raw.game) await gameConfigApi.saveRaw(sel.machine_id, sel.name, { file: 'game', content: rawGame, backup: true })
      } else if (activeTab === 'stacks') {
        const items = localStacks.filter((s: Record<string, unknown>) => s.class).map((s: Record<string, unknown>) => ({
          item_class: s.class as string, max_quantity: s.max_quantity as number, ignore_multiplier: s.ignore_multiplier as boolean
        }))
        await gameConfigApi.saveStacks(sel.machine_id, sel.name, { items, backup: true })
      } else if (activeTab === 'crafting') {
        const items = localCrafting.filter((c: Record<string, unknown>) => c.item_class).map((c: Record<string, unknown>) => ({
          item_class: c.item_class as string, resources: (c.resources as Record<string, unknown>[]) || []
        }))
        await gameConfigApi.saveCrafting(sel.machine_id, sel.name, { items, backup: true })
      } else if (activeTab === 'npc_replace') {
        await gameConfigApi.saveNpcReplacements(sel.machine_id, sel.name, {
          items: localNpcRepl.filter((n: Record<string, unknown>) => n.from_class), backup: true
        })
      } else if (activeTab === 'supply_crates' || activeTab === 'spawn_entries') {
        const keyMap: Record<string, string> = {
          supply_crates: 'ConfigOverrideSupplyCrateItems',
          spawn_entries_add: 'ConfigAddNPCSpawnEntriesContainer',
          spawn_entries_override: 'ConfigOverrideNPCSpawnEntriesContainer',
          spawn_entries_subtract: 'ConfigSubtractNPCSpawnEntriesContainer',
        }
        if (activeTab === 'supply_crates') {
          await gameConfigApi.saveOverrideRaw(sel.machine_id, sel.name, {
            key: keyMap.supply_crates,
            values: localSupplyCrates.map((s: Record<string, unknown>) => (s.raw as string) || '').filter(Boolean),
            backup: true
          })
        } else {
          for (const [subKey, apiKey] of [['add', keyMap.spawn_entries_add], ['override', keyMap.spawn_entries_override], ['subtract', keyMap.spawn_entries_subtract]]) {
            const entries = localSpawnEntries[subKey] || []
            if (entries.length > 0) {
              await gameConfigApi.saveOverrideRaw(sel.machine_id, sel.name, {
                key: apiKey, values: entries.map((e: Record<string, unknown>) => (e.raw as string) || '').filter(Boolean), backup: true
              })
            }
          }
        }
      } else {
        const gusC: Record<string, Record<string, string>> = {}
        const gameC: Record<string, Record<string, string>> = {}
        for (const [gid, gv] of Object.entries(localValues)) {
          const g = groups[gid]; if (!g) continue
          for (const [key, value] of Object.entries(gv)) {
            const d = g.settings[key]; if (!d) continue
            const orig = (configData.values as Record<string, Record<string, string>>)[gid]?.[key]
            if (value !== orig && value !== null && value !== '') {
              const t = d.file === 'gus' ? gusC : gameC
              if (!t[d.section]) t[d.section] = {}
              t[d.section][key] = value
            }
          }
        }
        await gameConfigApi.saveConfig(sel.machine_id, sel.name, { gus_changes: gusC, game_changes: gameC, backup: true })
      }
      setSuccess('Configuration saved with backup!'); setHasChanges(false); loadConfig(sel)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError('Save failed: ' + (detail || 'Unknown error'))
    }
    finally { setSaving(false) }
  }

  // ── Tab definitions ──────────────────────────────────────────
  const groupTabs = Object.entries(groups).map(([id, g]) => ({ id, ...g }))
  const overrideTabs: { id: string; label: string; icon: LucideIcon }[] = [
    { id: 'stacks', label: 'Stack Sizes', icon: Layers },
    { id: 'supply_crates', label: 'Supply Crates', icon: Gift },
    { id: 'crafting', label: 'Crafting Costs', icon: Package },
    { id: 'npc_replace', label: 'NPC Replacements', icon: Replace },
    { id: 'spawn_entries', label: 'Spawn Entries', icon: Bug },
  ]
  const extraTabs: { id: string; label: string; icon: LucideIcon }[] = [
    { id: 'mods', label: 'Mod Settings', icon: Package },
    { id: 'uncategorized', label: 'Extra Keys', icon: FileText },
    { id: 'raw', label: 'Raw Editor', icon: Code },
  ]

  // ── Render: single control ───────────────────────────────────
  function renderControl(gid: string, key: string, def: SettingDef) {
    const value = localValues[gid]?.[key] ?? ''
    const orig = (configData?.values as Record<string, Record<string, string>>)?.[gid]?.[key]
    const dirty = value !== (orig ?? '')
    const label = def.label || key.replace(/([A-Z])/g, ' $1').replace(/^b /, '').trim()

    if (def.type === 'bool') {
      const isOn = value?.toLowerCase() === 'true'
      return (
        <div className={`gc-ctrl gc-ctrl-bool ${dirty ? 'dirty' : ''}`} key={key}>
          <div className="gc-toggle-row" onClick={() => updateValue(gid, key, isOn ? 'False' : 'True')}>
            <div className={`gc-toggle ${isOn ? 'on' : ''}`}><div className="gc-toggle-knob" /></div>
            <span className="gc-ctrl-label">{label}</span>
            {dirty && <span className="gc-ctrl-dot" />}
          </div>
        </div>
      )
    }

    if (def.type === 'float' || def.type === 'int') {
      return (
        <div className={`gc-ctrl ${dirty ? 'dirty' : ''}`} key={key}>
          <div className="gc-ctrl-head"><span className="gc-ctrl-label">{label}</span>{dirty && <span className="gc-ctrl-dot" />}</div>
          <div className="gc-input-row">
            <input type="number" className="gc-input gc-input-num" value={value || ''} min={def.min} max={def.max} step={def.step || (def.type === 'int' ? 1 : 0.1)} onChange={e => updateValue(gid, key, e.target.value)} />
            {def.default !== undefined && <button className="gc-reset" title={`Default: ${def.default}`} onClick={() => resetValue(gid, key)}><Undo2 size={12} /></button>}
          </div>
          {def.default !== undefined && <div className="gc-ctrl-default">default: {String(def.default)}</div>}
        </div>
      )
    }

    if (def.type === 'password') {
      return (
        <div className={`gc-ctrl ${dirty ? 'dirty' : ''}`} key={key}>
          <div className="gc-ctrl-head"><span className="gc-ctrl-label">{label}</span>{dirty && <span className="gc-ctrl-dot" />}</div>
          <div className="gc-input-row">
            <input type={showPw[key] ? 'text' : 'password'} className="gc-input" style={{ flex: 1 }} value={value || ''} onChange={e => updateValue(gid, key, e.target.value)} />
            <button className="gc-reset" onClick={() => setShowPw(p => ({ ...p, [key]: !p[key] }))}>{showPw[key] ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </div>
      )
    }

    if (def.type === 'text') {
      return (
        <div className={`gc-ctrl ${dirty ? 'dirty' : ''}`} key={key}>
          <div className="gc-ctrl-head"><span className="gc-ctrl-label">{label}</span>{dirty && <span className="gc-ctrl-dot" />}</div>
          <textarea className="gc-input gc-input-mono" value={(value || '').replace(/\\n/g, '\n')} rows={3} style={{ resize: 'vertical' }} onChange={e => updateValue(gid, key, e.target.value.replace(/\n/g, '\\n'))} />
        </div>
      )
    }

    return (
      <div className={`gc-ctrl ${dirty ? 'dirty' : ''}`} key={key}>
        <div className="gc-ctrl-head"><span className="gc-ctrl-label">{label}</span>{dirty && <span className="gc-ctrl-dot" />}</div>
        <input type="text" className="gc-input" value={value || ''} onChange={e => updateValue(gid, key, e.target.value)} />
      </div>
    )
  }

  // ── Render: group content ────────────────────────────────────
  function renderGroupContent(gid: string) {
    const g = groups[gid]; if (!g) return null
    const bools: [string, SettingDef][] = [], others: [string, SettingDef][] = []
    for (const [k, d] of Object.entries(g.settings)) { d.type === 'bool' ? bools.push([k, d]) : others.push([k, d]) }
    return (
      <>
        {others.length > 0 && <div className="gc-fields">{others.map(([k, d]) => renderControl(gid, k, d))}</div>}
        {bools.length > 0 && (
          <div className="gc-toggles">
            <div className="gc-toggles-title">On/Off Toggles</div>
            <div className="gc-toggles-grid">{bools.map(([k, d]) => renderControl(gid, k, d))}</div>
          </div>
        )}
      </>
    )
  }

  // ── Render: Stack Overrides ──────────────────────────────────
  function renderStacks() {
    const filtered = localStacks.filter((s: Record<string, unknown>) =>
      !stackSearch || ((s.class as string) || '').toLowerCase().includes(stackSearch.toLowerCase())
    )
    return (
      <div className="gc-override">
        <div className="gc-override-bar">
          <div className="gc-override-count"><Layers size={14} /> {localStacks.length} stack overrides</div>
          <div className="gc-override-tools">
            <div className="gc-search-box"><Search size={13} /><input placeholder="Search class..." value={stackSearch} onChange={e => setStackSearch(e.target.value)} /></div>
            <button className="gc-btn gc-btn-sm gc-btn-primary" onClick={() => { setLocalStacks(p => [...p, { class: '', max_quantity: 100, ignore_multiplier: true }]); setHasChanges(true) }}><Plus size={13} /> Add</button>
          </div>
        </div>
        <div className="gc-table">
          <div className="gc-thead gc-thead-stacks"><span className="gc-th">Item Class</span><span className="gc-th">Max Qty</span><span className="gc-th">Ignore Multi</span><span className="gc-th" /></div>
          {filtered.map((s: Record<string, unknown>, i: number) => {
            const oi = localStacks.indexOf(s)
            return (
              <div className="gc-row gc-row-stacks" key={i}>
                <input className="gc-input gc-input-mono" value={(s.class as string) || (s.raw as string) || ''} placeholder="PrimalItemConsumable_..." onChange={e => { const u = [...localStacks]; u[oi] = { ...u[oi], class: e.target.value }; setLocalStacks(u); setHasChanges(true) }} />
                <input type="number" className="gc-input gc-input-num" value={s.max_quantity as number} min={1} onChange={e => { const u = [...localStacks]; u[oi] = { ...u[oi], max_quantity: parseInt(e.target.value) || 1 }; setLocalStacks(u); setHasChanges(true) }} />
                <div style={{ justifySelf: 'center', cursor: 'pointer' }} onClick={() => { const u = [...localStacks]; u[oi] = { ...u[oi], ignore_multiplier: !u[oi].ignore_multiplier }; setLocalStacks(u); setHasChanges(true) }}>
                  <div className={`gc-toggle gc-toggle-sm ${s.ignore_multiplier ? 'on' : ''}`}><div className="gc-toggle-knob" /></div>
                </div>
                <button className="gc-del" onClick={() => { setLocalStacks(p => p.filter((_, idx) => idx !== oi)); setHasChanges(true) }}><Trash2 size={13} /></button>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="gc-empty"><Layers size={24} /><span>No stack overrides{stackSearch ? ' matching search' : ''}</span></div>}
        </div>
      </div>
    )
  }

  // ── Render: Crafting ─────────────────────────────────────────
  function renderCrafting() {
    return (
      <div className="gc-override">
        <div className="gc-override-bar">
          <div className="gc-override-count"><Package size={14} /> {localCrafting.length} crafting cost overrides</div>
          <button className="gc-btn gc-btn-sm gc-btn-primary" onClick={() => { setLocalCrafting(p => [...p, { item_class: '', resources: [{ resource_class: '', amount: 1, exact_type: false }] }]); setHasChanges(true) }}><Plus size={13} /> Add</button>
        </div>
        {localCrafting.map((item: Record<string, unknown>, idx: number) => (
          <div key={idx} className="gc-card">
            <div className="gc-card-head">
              <input className="gc-input gc-input-mono" placeholder="ItemClassString (e.g. PrimalItemAmmo_ArrowTranq_C)" value={(item.item_class as string) || ''} onChange={e => { const u = [...localCrafting]; u[idx] = { ...u[idx], item_class: e.target.value }; setLocalCrafting(u); setHasChanges(true) }} />
              <button className="gc-del" onClick={() => { setLocalCrafting(p => p.filter((_, i) => i !== idx)); setHasChanges(true) }}><Trash2 size={13} /></button>
            </div>
            <div className="gc-card-label">Required Resources:</div>
            {((item.resources as Record<string, unknown>[]) || []).map((res: Record<string, unknown>, ri: number) => (
              <div key={ri} className="gc-res-row">
                <input className="gc-input gc-input-mono" style={{ flex: 1 }} placeholder="ResourceItemTypeString" value={(res.resource_class as string) || ''} onChange={e => { const u = [...localCrafting]; (u[idx].resources as Record<string, unknown>[])[ri] = { ...(u[idx].resources as Record<string, unknown>[])[ri], resource_class: e.target.value }; setLocalCrafting(u); setHasChanges(true) }} />
                <input type="number" className="gc-input gc-input-num" style={{ width: 80 }} value={res.amount as number} min={0} step={0.1} onChange={e => { const u = [...localCrafting]; (u[idx].resources as Record<string, unknown>[])[ri] = { ...(u[idx].resources as Record<string, unknown>[])[ri], amount: parseFloat(e.target.value) || 0 }; setLocalCrafting(u); setHasChanges(true) }} />
                <button className="gc-del" onClick={() => { const u = [...localCrafting]; u[idx].resources = (u[idx].resources as Record<string, unknown>[]).filter((_, j) => j !== ri); setLocalCrafting(u); setHasChanges(true) }}><X size={12} /></button>
              </div>
            ))}
            <button className="gc-add-btn" onClick={() => { const u = [...localCrafting]; u[idx].resources = [...((u[idx].resources as Record<string, unknown>[]) || []), { resource_class: '', amount: 1, exact_type: false }]; setLocalCrafting(u); setHasChanges(true) }}><Plus size={12} /> Add resource</button>
          </div>
        ))}
        {localCrafting.length === 0 && <div className="gc-empty"><Package size={24} /><span>No crafting cost overrides</span></div>}
      </div>
    )
  }

  // ── Render: NPC Replacements ──────────────────────────────────
  function renderNpcReplacements() {
    return (
      <div className="gc-override">
        <div className="gc-override-bar">
          <div className="gc-override-count"><Replace size={14} /> {localNpcRepl.length} NPC replacements</div>
          <button className="gc-btn gc-btn-sm gc-btn-primary" onClick={() => { setLocalNpcRepl(p => [...p, { from_class: '', to_class: '' }]); setHasChanges(true) }}><Plus size={13} /> Add</button>
        </div>
        <div className="gc-table">
          <div className="gc-thead gc-thead-npc"><span className="gc-th">From Class</span><span className="gc-th">To Class</span><span className="gc-th" /></div>
          {localNpcRepl.map((item: Record<string, unknown>, idx: number) => (
            <div key={idx} className="gc-row gc-row-npc">
              <input className="gc-input gc-input-mono" placeholder="Pegomastax_Character_BP_C" value={(item.from_class as string) || ''} onChange={e => { const u = [...localNpcRepl]; u[idx] = { ...u[idx], from_class: e.target.value }; setLocalNpcRepl(u); setHasChanges(true) }} />
              <input className="gc-input gc-input-mono" placeholder="Dodo_Character_BP_C" value={(item.to_class as string) || ''} onChange={e => { const u = [...localNpcRepl]; u[idx] = { ...u[idx], to_class: e.target.value }; setLocalNpcRepl(u); setHasChanges(true) }} />
              <button className="gc-del" onClick={() => { setLocalNpcRepl(p => p.filter((_, i) => i !== idx)); setHasChanges(true) }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        {localNpcRepl.length === 0 && <div className="gc-empty"><Replace size={24} /><span>No NPC replacements configured</span></div>}
      </div>
    )
  }

  // ── Render: Supply Crates ─────────────────────────────────────
  function renderSupplyCrates() {
    return (
      <div className="gc-override">
        <div className="gc-override-bar">
          <div className="gc-override-count"><Gift size={14} /> {localSupplyCrates.length} supply crate overrides</div>
          <button className="gc-btn gc-btn-sm gc-btn-primary" onClick={() => { setLocalSupplyCrates(p => [...p, { crate_class: 'NEW', raw: '', item_sets_count: 0, item_entries_count: 0 }]); setHasChanges(true) }}><Plus size={13} /> Add</button>
        </div>
        <div className="gc-warn"><AlertCircle size={14} /> Supply crates have a complex structure. Edit the raw entry for each crate below.</div>
        {localSupplyCrates.map((crate: Record<string, unknown>, idx: number) => (
          <div key={idx} className="gc-card">
            <div className="gc-card-head">
              <div className="gc-crate-info">
                <span className="gc-crate-name">{(crate.crate_class as string) || 'New'}</span>
                <span className="gc-crate-meta">{(crate.item_sets_count as number) || 0} sets, {(crate.item_entries_count as number) || 0} entries</span>
              </div>
              <button className="gc-del" onClick={() => { setLocalSupplyCrates(p => p.filter((_, i) => i !== idx)); setHasChanges(true) }}><Trash2 size={13} /></button>
            </div>
            <div className="gc-card-body">
              <textarea className="gc-raw-editor gc-raw-small" value={(crate.raw as string) || ''} onChange={e => { const u = [...localSupplyCrates]; u[idx] = { ...u[idx], raw: e.target.value }; setLocalSupplyCrates(u); setHasChanges(true) }} spellCheck={false} rows={4} />
            </div>
          </div>
        ))}
        {localSupplyCrates.length === 0 && <div className="gc-empty"><Gift size={24} /><span>No supply crate overrides</span></div>}
      </div>
    )
  }

  // ── Render: Spawn Entries ─────────────────────────────────────
  function renderSpawnEntries() {
    const types = [
      { key: 'add', label: 'ConfigAddNPCSpawnEntriesContainer', desc: 'Add creatures to spawn zones' },
      { key: 'override', label: 'ConfigOverrideNPCSpawnEntriesContainer', desc: 'Override creatures in spawn zones' },
      { key: 'subtract', label: 'ConfigSubtractNPCSpawnEntriesContainer', desc: 'Remove creatures from spawn zones' },
    ]
    return (
      <div className="gc-override">
        <div className="gc-warn"><AlertCircle size={14} /> Spawn entries have a complex structure. Each row is a complete raw entry.</div>
        {types.map(t => {
          const entries = localSpawnEntries[t.key] || []
          return (
            <div key={t.key} className="gc-spawn-group">
              <div className="gc-spawn-head">
                <div><strong>{t.label}</strong><div className="gc-spawn-desc">{t.desc}</div></div>
                <span className="gc-spawn-count">{entries.length} entries</span>
              </div>
              {entries.map((e: Record<string, unknown>, idx: number) => (
                <div key={idx} className="gc-card" style={{ marginBottom: '0.35rem' }}>
                  <div className="gc-card-head">
                    <span className="gc-crate-name">{(e.container_class as string) || `Entry #${idx + 1}`}</span>
                    <button className="gc-del" onClick={() => { const u = { ...localSpawnEntries }; u[t.key] = u[t.key].filter((_, i) => i !== idx); setLocalSpawnEntries(u); setHasChanges(true) }}><Trash2 size={13} /></button>
                  </div>
                  <div className="gc-card-body">
                    <textarea className="gc-raw-editor gc-raw-small" value={(e.raw as string) || ''} onChange={ev => { const u = { ...localSpawnEntries }; u[t.key] = [...u[t.key]]; u[t.key][idx] = { ...u[t.key][idx], raw: ev.target.value }; setLocalSpawnEntries(u); setHasChanges(true) }} spellCheck={false} rows={3} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Mods ──────────────────────────────────────────────
  function renderMods() {
    if (!configData) return null
    const allMods = { ...configData.mod_sections.gus, ...configData.mod_sections.game }
    if (Object.keys(allMods).length === 0) return <div className="gc-empty"><Package size={28} /><span>No mod sections detected</span></div>
    return (
      <div className="gc-mods">{Object.entries(allMods).map(([name, data]) => (
        <div key={name} className="gc-mod">
          <div className="gc-mod-head"><Package size={14} />[{name}]</div>
          <div className="gc-mod-rows">{Object.entries(data).map(([k, v]) => (
            <div className="gc-kv" key={k}><span className="gc-kv-key">{k}</span><span className="gc-kv-eq">=</span><span className="gc-kv-val">{String(v)}</span></div>
          ))}</div>
        </div>
      ))}</div>
    )
  }

  // ── Render: Uncategorized ─────────────────────────────────────
  function renderUncategorized() {
    if (!configData) return null
    const { gus, game } = configData.uncategorized
    if (!Object.keys(gus).length && !Object.keys(game).length) return <div className="gc-empty"><CheckCircle size={28} /><span>All settings are categorised — nothing extra here.</span></div>
    return (
      <div className="gc-mods">
        {Object.entries(gus).map(([s, entries]) => (
          <div key={`g-${s}`} className="gc-mod">
            <div className="gc-mod-head" style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--warn)', borderColor: 'rgba(245,158,11,0.2)' }}><FileText size={13} /> GUS [{s}]</div>
            <div className="gc-mod-rows">{entries.map((e, i) => <div className="gc-kv" key={i}><span className="gc-kv-key">{e.key}</span><span className="gc-kv-eq">=</span><span className="gc-kv-val">{e.value}</span></div>)}</div>
          </div>
        ))}
        {Object.entries(game).map(([s, entries]) => (
          <div key={`gm-${s}`} className="gc-mod">
            <div className="gc-mod-head" style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--warn)', borderColor: 'rgba(245,158,11,0.2)' }}><FileText size={13} /> Game.ini [{s}]</div>
            <div className="gc-mod-rows">{entries.map((e, i) => <div className="gc-kv" key={i}><span className="gc-kv-key">{e.key}</span><span className="gc-kv-eq">=</span><span className="gc-kv-val">{e.value}</span></div>)}</div>
          </div>
        ))}
      </div>
    )
  }

  // ── Render: Raw Editor ────────────────────────────────────────
  function renderRaw() {
    return (
      <>
        <div className="gc-warn"><AlertCircle size={14} /> Advanced editor — direct INI file editing. Use with caution.</div>
        <div className="gc-raw-grid">
          <div>
            <div className="gc-raw-label"><FileText size={13} /> GameUserSettings.ini <span className="gc-raw-size">{rawGus.length.toLocaleString()} chars</span></div>
            <textarea className="gc-raw-editor" value={rawGus} onChange={e => { setRawGus(e.target.value); setHasChanges(true) }} spellCheck={false} />
          </div>
          <div>
            <div className="gc-raw-label"><FileText size={13} /> Game.ini <span className="gc-raw-size">{rawGame.length.toLocaleString()} chars</span></div>
            <textarea className="gc-raw-editor" value={rawGame} onChange={e => { setRawGame(e.target.value); setHasChanges(true) }} spellCheck={false} />
          </div>
        </div>
      </>
    )
  }

  // ── Main render ───────────────────────────────────────────────
  if (loading) return <div className="gc-empty-page"><Loader2 size={24} className="spin" /><p>Loading containers...</p></div>
  if (!containers.length) return <div className="gc-empty-page"><Settings size={36} /><h3>No containers with INI files</h3><p>Scan your containers from the Containers page first.</p></div>

  return (
    <div className="gc-page page-container">
      {/* Top bar: title + container selector + save */}
      <div className="gc-topbar">
        <div className="gc-topbar-left">
          <span className="gc-topbar-title"><Settings size={18} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Server Config</span>
          <div className="gc-topbar-sep" />
          <div className="gc-topbar-select">
            <select value={sel ? `${sel.machine_id}|${sel.name}` : ''} onChange={e => selectContainer(e.target.value)}>
              <option value="">Select container...</option>
              {containers.map(c => (
                <option key={`${c.machine_id}|${c.name}`} value={`${c.machine_id}|${c.name}`}>
                  {c.map_name || c.name} — {c.hostname}
                </option>
              ))}
            </select>
          </div>
          {sel && <span className="gc-topbar-chip">{sel.map_name || sel.name}</span>}
        </div>
        <div className="gc-topbar-actions">
          {sel && <button className="gc-btn gc-btn-ghost" onClick={() => loadConfig(sel)} title="Reload from server"><RefreshCw size={14} /></button>}
          {hasChanges && <button className="gc-btn" onClick={() => { setHasChanges(false); if (sel) loadConfig(sel) }}><Undo2 size={14} /> Discard</button>}
          <button className="gc-btn gc-btn-primary" onClick={handleSave} disabled={!hasChanges || saving || !sel}>
            {saving ? <><Loader2 size={14} className="spin" /> Saving...</> : <><Save size={14} /> Save</>}
            {changeCount > 0 && !saving && <span className="gc-change-badge">{changeCount}</span>}
          </button>
        </div>
      </div>

      {error && <div className="gc-alert gc-alert-error"><AlertCircle size={15} /> {error}<button className="gc-alert-close" onClick={() => setError('')}><X size={13} /></button></div>}
      {success && <div className="gc-alert gc-alert-success"><CheckCircle size={15} /> {success}</div>}

      {sel && configData && (
        <div className="gc-editor">
          {/* Sidebar nav */}
          <div className="gc-nav">
            <div className="gc-nav-label">Settings</div>
            {groupTabs.map(tab => {
              const IC = ICONS[tab.icon] || Settings
              return <button key={tab.id} className={`gc-nav-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><IC size={14} /><span>{tab.label}</span></button>
            })}
            <div className="gc-nav-label" style={{ marginTop: '0.35rem' }}>Overrides</div>
            {overrideTabs.map(tab => <button key={tab.id} className={`gc-nav-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><tab.icon size={14} /><span>{tab.label}</span></button>)}
            <div className="gc-nav-label" style={{ marginTop: '0.35rem' }}>Advanced</div>
            {extraTabs.map(tab => <button key={tab.id} className={`gc-nav-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><tab.icon size={14} /><span>{tab.label}</span></button>)}
          </div>

          {/* Content area */}
          <div className="gc-content">
            {loadingConfig ? (
              <div className="gc-empty"><Loader2 size={20} className="spin" /><span>Loading configuration...</span></div>
            ) : (
              <>
                {groups[activeTab] && renderGroupContent(activeTab)}
                {activeTab === 'stacks' && renderStacks()}
                {activeTab === 'supply_crates' && renderSupplyCrates()}
                {activeTab === 'crafting' && renderCrafting()}
                {activeTab === 'npc_replace' && renderNpcReplacements()}
                {activeTab === 'spawn_entries' && renderSpawnEntries()}
                {activeTab === 'mods' && renderMods()}
                {activeTab === 'uncategorized' && renderUncategorized()}
                {activeTab === 'raw' && renderRaw()}
              </>
            )}
            {hasChanges && (
              <div className="gc-unsaved">
                <span className="gc-unsaved-text">{changeCount > 0 ? `${changeCount} unsaved changes` : 'Unsaved changes'}</span>
                <div className="gc-unsaved-actions">
                  <button className="gc-btn" onClick={() => { if (sel) loadConfig(sel) }}><Undo2 size={13} /> Discard</button>
                  <button className="gc-btn gc-btn-primary" onClick={handleSave} disabled={saving}><Save size={13} /> Save</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
