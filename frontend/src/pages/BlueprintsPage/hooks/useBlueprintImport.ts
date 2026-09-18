/**
 * Filling the catalogue: Dododex/Wiki sync, Beacon archive upload, JSON
 * import (preview then merge or replace) and the JSON export.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi } from '../../../services/api'
import { useToast } from '../../../components/ui'
import { extractError } from '../../../utils/errors'
import { parseBlueprintImport } from '../blueprintsModel'
import type { BlueprintCatalog } from './useBlueprintCatalog'

/** The server caps uploads at 50MB; fail fast before a long wasted upload. */
const BEACON_MAX_BYTES = 60 * 1024 * 1024

export function useBlueprintImport(catalog: BlueprintCatalog) {
  const { t } = useTranslation()
  const toast = useToast()

  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{ data: unknown[]; filename: string } | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

  /** Shared tail of sync and Beacon import: the catalogue is now full. */
  function afterFullReload(total: number) {
    catalog.setHasData(true)
    catalog.setTotalBp(total)
    catalog.setLastSync(new Date().toISOString())
    catalog.resetFilters()
    // Explicit arguments: the reset above is not applied yet.
    void catalog.loadData('', '', '', '', 0)
    void catalog.loadFilters()
    void catalog.loadAllCategories()
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const d = (await blueprintsApi.sync()).data
      const errMsg = d.errors.length > 0
        ? t('blueprints.messages.syncErrorsPrefix', { list: d.errors.join('; ') })
        : ''
      if (d.total_blueprints > 0) {
        toast.success(t('blueprints.messages.syncComplete', {
          total: d.total_blueprints, items: d.items_count,
          dinos: d.dinos_count, commands: d.commands_count, errors: errMsg,
        }))
      } else {
        toast.error(t('blueprints.messages.syncNone', {
          sources: d.sources.join(', ') || t('blueprints.messages.syncNoneSourcesNone'),
        }))
      }
      afterFullReload(d.total_blueprints)
    } catch (err) {
      toast.error(extractError(err, t('blueprints.messages.syncFailed')))
    } finally { setSyncing(false) }
  }

  async function handleBeaconUpload(file: File) {
    if (file.size > BEACON_MAX_BYTES) {
      toast.error(t('blueprints.beacon.tooLarge', { size: Math.round(file.size / 1024 / 1024) }))
      return
    }
    setSyncing(true)
    try {
      const d = (await blueprintsApi.importBeacondata(file)).data
      toast.success(t('blueprints.beacon.importDone', {
        total: d.total_blueprints, items: d.items_count, dinos: d.dinos_count,
      }))
      afterFullReload(d.total_blueprints)
    } catch (err) {
      toast.error(extractError(err, t('blueprints.beacon.importFailed')))
    } finally { setSyncing(false) }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseBlueprintImport(reader.result as string)
      if (parsed.ok) {
        setImportPreview({ data: parsed.data, filename: file.name })
      } else if (parsed.reason === 'notArray') {
        toast.error(t('blueprints.messages.invalidArray'))
      } else {
        toast.error(t('blueprints.messages.invalidFile', {
          reason: parsed.message ?? t('blueprints.messages.parseError'),
        }))
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  async function confirmImport() {
    if (!importPreview) return
    setImporting(true)
    try {
      const res = await blueprintsApi.importBlueprints(importPreview.data, importMode)
      toast.success(t('blueprints.messages.importSuccess', {
        added: res.data.added, updated: res.data.updated, total: res.data.total,
      }))
      setImportPreview(null)
      catalog.setHasData(true)
      void catalog.loadStatus()
    } catch (err) {
      toast.error(t('blueprints.messages.importError', {
        reason: extractError(err, t('blueprints.messages.unknownError')),
      }))
    } finally { setImporting(false) }
  }

  async function handleExport() {
    try {
      const res = await blueprintsApi.exportAll()
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `blueprints_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(t('blueprints.messages.exportSuccess', { count: catalog.totalBp }))
    } catch (err) {
      toast.error(extractError(err, t('blueprints.messages.exportError')))
    }
  }

  return {
    syncing, importing, importPreview, setImportPreview, importMode, setImportMode,
    handleSync, handleBeaconUpload, handleFileSelected, confirmImport, handleExport,
  }
}
