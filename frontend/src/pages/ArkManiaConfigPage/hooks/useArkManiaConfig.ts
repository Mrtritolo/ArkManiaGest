/**
 * State of the plugin config editor: the module list, the keys of the active
 * module for the selected server, every local edit and the save.
 *
 * Unsaved edits belong to the module and server they were made on, so both
 * switches ask before dropping them, and only the latest module request may
 * apply its result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBeforeUnload, type NavigateFunction } from 'react-router-dom'
import { arkmaniaApi } from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import { extractError } from '../../../utils/errors'
import { detectEditorType, isValidJsonEdit, type ConfigItem, type ConfigModule, type ServerItem } from '../configModel'

export function useArkManiaConfig(urlModule: string | undefined, navigate: NavigateFunction) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()
  // react-i18next hands out a new `t` on every language change. The module
  // loader drops the unsaved edits before it refetches, so it must not depend
  // on `t`: toggling EN/IT would silently discard them. Its fallback strings
  // are read through this ref instead.
  const tRef = useRef(t)
  tRef.current = t

  const [modules, setModules] = useState<ConfigModule[]>([])
  const [activeModule, setActiveModule] = useState('')
  const [items, setItems] = useState<ConfigItem[]>([])
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [servers, setServers] = useState<ServerItem[]>([])
  const [selectedServer, setSelectedServer] = useState('*')
  const [loading, setLoading] = useState(true)
  const [moduleLoading, setModuleLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [permGroups, setPermGroups] = useState<string[]>([])
  // Config keys whose key-value editor holds duplicate keys (a change not yet passed up).
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set())
  // Bumped by Discard to remount the key-value editors, whose rows are local state.
  const [discardSeq, setDiscardSeq] = useState(0)
  // Only the latest loadModuleConfig call may apply its result.
  const moduleSeq = useRef(0)

  // Loaded once: this used to re-run on every sidebar click (the click
  // changes the URL), and a late response could switch back to an older module.
  useEffect(() => {
    async function load() {
      const [modRes, srvRes, grpRes] = await Promise.allSettled([
        arkmaniaApi.listModules(),
        arkmaniaApi.listServers(),
        arkmaniaApi.getPermissionGroups(),
      ])
      // Servers and permission groups only feed selectors: when one of them
      // fails (e.g. no PermissionGroups table) the editor still loads.
      if (modRes.status === 'fulfilled') {
        setModules(modRes.value.data.modules)
        const first = modRes.value.data.modules[0]?.prefix || ''
        setActiveModule(prev => prev || first)
      }
      if (srvRes.status === 'fulfilled') setServers(srvRes.value.data.servers)
      if (grpRes.status === 'fulfilled') setPermGroups(grpRes.value.data.groups)
      const failed = [modRes, srvRes, grpRes].find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) setError(extractError(failed.reason, tRef.current('arkmaniaConfig.loadFailed')))
      setLoading(false)
    }
    void load()
  }, [])

  useEffect(() => { if (urlModule) setActiveModule(urlModule) }, [urlModule])

  const loadModuleConfig = useCallback(async () => {
    if (!activeModule) return
    const seq = ++moduleSeq.current
    setModuleLoading(true)
    // Edits belong to the module/server they were made on: drop them now,
    // not when the new load lands (or never, if it fails).
    setEditedValues({})
    try {
      const res = await arkmaniaApi.getModule(activeModule, selectedServer)
      if (seq !== moduleSeq.current) return
      setItems(res.data.items)
      setSearchQuery('')
      setError('')
    } catch (err) {
      if (seq !== moduleSeq.current) return
      setItems([])
      setError(extractError(err, tRef.current('arkmaniaConfig.loadFailed')))
    } finally { if (seq === moduleSeq.current) setModuleLoading(false) }
  }, [activeModule, selectedServer])

  useEffect(() => { void loadModuleConfig() }, [loadModuleConfig])

  const hasChanges = Object.keys(editedValues).length > 0 || duplicateKeys.size > 0

  // Generic JSON values are typed by hand; the backend stores them verbatim,
  // and one the plugin cannot parse breaks that key on its next config load.
  const invalidJsonKeys = useMemo(() => new Set(
    Object.entries(editedValues)
      .filter(([key, val]) => {
        const item = items.find(i => i.config_key === key)
        return !!item && detectEditorType(item.short_key, item.value) === 'json' && !isValidJsonEdit(val, item.value)
      })
      .map(([key]) => key),
  ), [editedValues, items])

  const confirmDiscard = useCallback(async () => {
    if (!hasChanges) return true
    return confirm({
      title: t('arkmaniaConfig.unsavedTitle'),
      description: t('arkmaniaConfig.unsavedConfirm'),
      confirmLabel: t('arkmaniaConfig.discardChanges'),
      tone: 'danger',
    })
  }, [confirm, hasChanges, t])

  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (!hasChanges) return
    event.preventDefault()
    event.returnValue = ''
  }, [hasChanges]))

  async function handleTabClick(prefix: string) {
    if (prefix === activeModule) return
    if (!(await confirmDiscard())) return
    setActiveModule(prefix)
    navigate(`/plugins/config/${prefix}`, { replace: true })
  }

  async function handleServerChange(serverKey: string) {
    if (serverKey === selectedServer) return
    if (!(await confirmDiscard())) return
    setSelectedServer(serverKey)
  }

  function handleValueChange(key: string, value: string) {
    // Setting a value back to what was loaded is not an edit: sending it
    // anyway would create a per-server override row equal to the global.
    const item = items.find(i => i.config_key === key)
    const unchanged = !!item && (detectEditorType(item.short_key, item.value) === 'bool'
      ? value.toLowerCase() === item.value.toLowerCase()
      : value === item.value)
    setEditedValues(prev => {
      const next = { ...prev }
      if (unchanged) delete next[key]
      else next[key] = value
      return next
    })
  }

  function handleDuplicatesChange(key: string, hasDuplicates: boolean) {
    setDuplicateKeys(prev => {
      if (prev.has(key) === hasDuplicates) return prev
      const next = new Set(prev)
      if (hasDuplicates) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleDiscard() {
    if (!(await confirmDiscard())) return
    setEditedValues({})
    setDiscardSeq(s => s + 1)
  }

  async function handleSave() {
    if (Object.keys(editedValues).length === 0 || invalidJsonKeys.size > 0 || duplicateKeys.size > 0) return
    setSaving(true)
    try {
      const updateItems = Object.entries(editedValues).map(([key, val]) => ({ config_key: key, config_value: val }))
      await arkmaniaApi.updateModule(activeModule, selectedServer, updateItems)
      // The reload clears editedValues, so the confirmation is a toast: the
      // old inline "Saved" state was reset in the same flow and never showed.
      toast.success(t('arkmaniaConfig.actions.savedCount', { count: updateItems.length }))
      await loadModuleConfig()
    } catch (err) {
      toast.error(extractError(err, t('arkmaniaConfig.saveFailed')))
    } finally { setSaving(false) }
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
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `config_${activeModule}_${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return {
    modules, activeModule, items, editedValues, servers, selectedServer,
    loading, moduleLoading, saving, error, setError, searchQuery, setSearchQuery,
    permGroups, duplicateKeys, discardSeq, hasChanges, invalidJsonKeys,
    handleTabClick, handleServerChange, handleValueChange, handleDuplicatesChange,
    handleDiscard, handleSave, handleExportJSON, retry: loadModuleConfig,
  }
}

export type ArkManiaConfigState = ReturnType<typeof useArkManiaConfig>
