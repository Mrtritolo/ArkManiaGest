/**
 * All state of the INI editor: containers, setting definitions, the loaded
 * config and every local edit, plus loading, the unsaved-changes guards and
 * the multi-request save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBeforeUnload } from 'react-router-dom'
import { containersApi, gameConfigApi } from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import { extractError } from '../../../utils/errors'
import {
  SPAWN_KEYS, clone, hasIncompleteOverrides,
  type ConfigData, type Container, type GroupDef, type Row,
} from '../gameConfigModel'

export function useGameConfig() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [containers, setContainers] = useState<Container[]>([])
  const [sel, setSel] = useState<Container | null>(null)
  const [groups, setGroups] = useState<Record<string, GroupDef>>({})
  const [configData, setConfigData] = useState<ConfigData | null>(null)
  const [localValues, setLocalValues] = useState<Record<string, Record<string, string>>>({})
  const [localStacks, setLocalStacks] = useState<Row[]>([])
  const [localCrafting, setLocalCrafting] = useState<Row[]>([])
  const [localNpcRepl, setLocalNpcRepl] = useState<Row[]>([])
  const [localSupplyCrates, setLocalSupplyCrates] = useState<Row[]>([])
  const [localSpawnEntries, setLocalSpawnEntries] = useState<Record<string, Row[]>>({})
  const [rawGus, setRawGus] = useState('')
  const [rawGame, setRawGame] = useState('')
  const [activeTab, setActiveTab] = useState('general')
  const [loading, setLoading] = useState(true)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [stackSearch, setStackSearch] = useState('')
  // Only the latest loadConfig call may apply its result.
  const loadSeq = useRef(0)

  const loadContainers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await containersApi.getAllContainers()
      const valid = (res.data.containers || []).filter((c: Record<string, unknown>) => {
        const paths = c.paths as Record<string, string> | undefined
        return paths?.gameusersettings_ini || paths?.game_ini
      })
      setContainers(valid)
      setError('')
    } catch (err) {
      setError(extractError(err, t('gameConfig.messages.loadFailed')))
    } finally { setLoading(false) }
  }, [t])

  const loadDefinitions = useCallback(async () => {
    try {
      const res = await gameConfigApi.getDefinitions()
      setGroups(res.data.groups || {})
    } catch { /* the override and raw tabs still work without definitions */ }
  }, [])

  // Mount only, like before: a language switch must not refetch the cluster.
  useEffect(() => { void loadContainers(); void loadDefinitions() }, [])

  const loadConfig = useCallback(async (c: Container) => {
    const seq = ++loadSeq.current
    setLoadingConfig(true); setError('')
    try {
      const res = await gameConfigApi.loadConfig(c.machine_id, c.name)
      // A slower response for a container the user already left must not
      // overwrite the editor of the one now selected.
      if (seq !== loadSeq.current) return
      const d = res.data as ConfigData
      setConfigData(d)
      // Deep copies: the editors mutate nested rows, and Save diffs them
      // against configData.
      setLocalValues(clone(d.values))
      setLocalStacks(clone((d.overrides?.stacks as Row[]) || []))
      setLocalCrafting(clone((d.overrides?.crafting_costs as Row[]) || []))
      setLocalNpcRepl(clone((d.overrides?.npc_replacements as Row[]) || []))
      setLocalSupplyCrates(clone((d.overrides?.supply_crates as Row[]) || []))
      setLocalSpawnEntries(Object.fromEntries(SPAWN_KEYS.map(([sub, key]) =>
        [sub, clone((d.overrides?.[key] as Row[]) || [])])))
      setRawGus(d.raw?.gus || ''); setRawGame(d.raw?.game || '')
      setHasChanges(false)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(t('gameConfig.messages.loadConfigFailed', {
        detail: extractError(err, t('gameConfig.messages.unknownError')),
      }))
    } finally { if (seq === loadSeq.current) setLoadingConfig(false) }
  }, [t])

  const confirmDiscard = useCallback(async () => {
    if (!hasChanges) return true
    return confirm({
      title: t('gameConfig.unsavedTitle'),
      description: t('gameConfig.unsavedConfirm'),
      confirmLabel: t('gameConfig.discardChanges'),
      tone: 'danger',
    })
  }, [confirm, hasChanges, t])

  // Closing the tab or navigating away with unsaved edits.
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!hasChanges) return
    event.preventDefault()
    event.returnValue = ''
  }, [hasChanges]))

  async function selectContainer(value: string) {
    const c = containers.find(x => `${x.machine_id}|${x.name}` === value)
    if (!c) return
    if (!(await confirmDiscard())) return
    // Drop the previous container's editor state before loading: until the
    // new load lands (or if it fails), Save would write it to this container.
    setConfigData(null); setHasChanges(false)
    setSel(c); setActiveTab('general'); void loadConfig(c)
  }

  async function reload() {
    if (!sel) return
    if (!(await confirmDiscard())) return
    void loadConfig(sel)
  }

  async function discard() {
    if (!sel) return
    if (!(await confirmDiscard())) return
    setHasChanges(false)
    void loadConfig(sel)
  }

  function updateValue(gid: string, key: string, value: string) {
    setLocalValues(p => ({ ...p, [gid]: { ...p[gid], [key]: value } }))
    setHasChanges(true)
  }

  function resetValue(gid: string, key: string) {
    const d = groups[gid]?.settings[key]?.default
    if (d !== undefined) updateValue(gid, key, String(d))
  }

  /** True when a local override list differs from the one that was loaded. */
  const changedList = useCallback((local: unknown, loadedKey: string) =>
    JSON.stringify(local) !== JSON.stringify(configData?.overrides?.[loadedKey] || []),
    [configData])

  // Changed INI fields. Keys missing from the file load as null and their
  // controls show '', so both sides are compared that way.
  const fieldChangeCount = useMemo(() => {
    if (!configData) return 0
    let count = 0
    for (const [gid, gv] of Object.entries(localValues)) {
      for (const [key, value] of Object.entries(gv)) {
        const orig = configData.values[gid]?.[key]
        if ((value ?? '') !== (orig ?? '')) count++
      }
    }
    return count
  }, [localValues, configData])

  // The badge used to count INI fields only, so an operator who had edited
  // stacks, crates, spawn entries or a raw file saw "Save" with no number.
  const overrideChangeCount = useMemo(() => {
    if (!configData) return 0
    let count = 0
    if (rawGus !== configData.raw.gus) count++
    if (rawGame !== configData.raw.game) count++
    if (changedList(localStacks, 'stacks')) count++
    if (changedList(localCrafting, 'crafting_costs')) count++
    if (changedList(localNpcRepl, 'npc_replacements')) count++
    if (changedList(localSupplyCrates, 'supply_crates')) count++
    for (const [subKey, apiKey] of SPAWN_KEYS) {
      if (changedList(localSpawnEntries[subKey] || [], apiKey)) count++
    }
    return count
  }, [configData, rawGus, rawGame, localStacks, localCrafting, localNpcRepl, localSupplyCrates, localSpawnEntries, changedList])

  const changeCount = fieldChangeCount + overrideChangeCount

  async function handleSave() {
    if (!sel || !configData || loadingConfig) return
    const c = sel, d = configData
    // The typed endpoints reject a row they cannot read back, and the save is
    // a sequence of requests: refuse the whole save instead of writing half.
    if (hasIncompleteOverrides(localStacks, localCrafting)) {
      toast.error(t('gameConfig.messages.incompleteOverrides'))
      return
    }
    // Each file is backed up on its first write of this Save only. Backup names
    // resolve to the second, so a later backup of the same file could
    // overwrite the pre-Save copy with an intermediate one.
    const backedUp = new Set<'gus' | 'game'>()
    const backup = (file: 'gus' | 'game') => {
      if (backedUp.has(file)) return false
      backedUp.add(file); return true
    }
    setSaving(true); setError('')
    try {
      // Every edited category is written, not just the open tab: the reload
      // below would otherwise throw away the edits made on the other tabs.
      // The raw files go first because they replace the whole file; the saves
      // after them re-read the file and apply their own edits on top.
      if (rawGus !== d.raw.gus) await gameConfigApi.saveRaw(c.machine_id, c.name, { file: 'gus', content: rawGus, backup: backup('gus') })
      if (rawGame !== d.raw.game) await gameConfigApi.saveRaw(c.machine_id, c.name, { file: 'game', content: rawGame, backup: backup('game') })

      const gusC: Record<string, Record<string, unknown>> = {}
      const gameC: Record<string, Record<string, unknown>> = {}
      for (const [gid, gv] of Object.entries(localValues)) {
        const g = groups[gid]; if (!g) continue
        for (const [key, value] of Object.entries(gv)) {
          const def = g.settings[key]; if (!def) continue
          const next = value ?? ''
          if (next === (d.values[gid]?.[key] ?? '')) continue
          const bucket = def.file === 'gus' ? gusC : gameC
          if (!bucket[def.section]) bucket[def.section] = {}
          const section = bucket[def.section]
          if (next === '') {
            // A cleared field removes the key (apply_changes' __delete__), so
            // the server falls back to its default instead of keeping the value.
            section.__delete__ = [...((section.__delete__ as string[]) || []), key]
          } else {
            section[key] = next
          }
        }
      }
      // One request per file: the backup flag covers every file a request
      // writes, and the two files may already be in different backup states.
      if (Object.keys(gusC).length) {
        await gameConfigApi.saveConfig(c.machine_id, c.name, { gus_changes: gusC, backup: backup('gus') })
      }
      if (Object.keys(gameC).length) {
        await gameConfigApi.saveConfig(c.machine_id, c.name, { game_changes: gameC, backup: backup('game') })
      }

      // Rows the backend could not parse carry only `raw`: they are not sent,
      // and the backend keeps those lines when it replaces the list.
      if (changedList(localStacks, 'stacks')) {
        const items = localStacks.filter(s => s.class).map(s => ({
          item_class: s.class as string,
          max_quantity: s.max_quantity as number,
          ignore_multiplier: s.ignore_multiplier as boolean,
        }))
        await gameConfigApi.saveStacks(c.machine_id, c.name, { items, backup: backup('game') })
      }
      if (changedList(localCrafting, 'crafting_costs')) {
        const items = localCrafting.filter(r => r.item_class).map(r => ({
          item_class: r.item_class as string, resources: (r.resources as Row[]) || [],
        }))
        await gameConfigApi.saveCrafting(c.machine_id, c.name, { items, backup: backup('game') })
      }
      if (changedList(localNpcRepl, 'npc_replacements')) {
        await gameConfigApi.saveNpcReplacements(c.machine_id, c.name, {
          items: localNpcRepl.filter(n => n.from_class), backup: backup('game'),
        })
      }
      if (changedList(localSupplyCrates, 'supply_crates')) {
        await gameConfigApi.saveOverrideRaw(c.machine_id, c.name, {
          key: 'ConfigOverrideSupplyCrateItems',
          values: localSupplyCrates.map(s => (s.raw as string) || '').filter(Boolean),
          backup: backup('game'),
        })
      }
      for (const [subKey, apiKey] of SPAWN_KEYS) {
        const entries = localSpawnEntries[subKey] || []
        // An emptied list is sent too, so deleting the last entry removes it.
        if (changedList(entries, apiKey)) {
          await gameConfigApi.saveOverrideRaw(c.machine_id, c.name, {
            key: apiKey, values: entries.map(e => (e.raw as string) || '').filter(Boolean), backup: backup('game'),
          })
        }
      }
      toast.success(t('gameConfig.messages.saved'))
      setHasChanges(false)
      void loadConfig(c)
    } catch (err) {
      toast.error(t('gameConfig.messages.saveFailed', {
        detail: extractError(err, t('gameConfig.messages.unknownError')),
      }))
    } finally { setSaving(false) }
  }

  return {
    containers, sel, groups, configData,
    localValues, setLocalValues,
    localStacks, setLocalStacks,
    localCrafting, setLocalCrafting,
    localNpcRepl, setLocalNpcRepl,
    localSupplyCrates, setLocalSupplyCrates,
    localSpawnEntries, setLocalSpawnEntries,
    rawGus, setRawGus, rawGame, setRawGame,
    activeTab, setActiveTab,
    loading, loadingConfig, saving, error, setError, hasChanges, setHasChanges,
    stackSearch, setStackSearch,
    changeCount, selectContainer, reload, discard, updateValue, resetValue, handleSave,
    retryContainers: loadContainers,
  }
}

export type GameConfigState = ReturnType<typeof useGameConfig>
