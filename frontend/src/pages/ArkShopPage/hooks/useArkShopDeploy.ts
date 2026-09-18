/**
 * Moving the config between the panel and the servers: the container list,
 * pulling a config in, the version history, and deploying to one or every
 * stopped container. Every one of those overwrites something, so each asks
 * first and each names the unsaved settings edits it would leave behind.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  arkshopApi, type ArkServerRow, type PluginPushSummary, type PluginVersionRow,
} from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import { usePending } from '../../../hooks/usePending'
import { extractError } from '../../../utils/errors'
import type { ArkShopConfigState } from './useArkShopConfig'

export function useArkShopDeploy(config: ArkShopConfigState) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [arkServers, setArkServers] = useState<ArkServerRow[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [pushResults, setPushResults] = useState<PluginPushSummary | null>(null)
  const [versions, setVersions] = useState<PluginVersionRow[]>([])
  const [savingVersion, setSavingVersion] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  const [showVersions, setShowVersions] = useState(false)
  const [deployVersionId, setDeployVersionId] = useState<number | null>(null)
  // One row at a time: a second click on the same container is ignored.
  const perServer = usePending<string>()

  const loadArkServers = useCallback(async () => {
    setLoadingServers(true)
    try {
      const res = await arkshopApi.servers()
      setArkServers(res.data.servers || [])
    } catch {
      // The panel simply has no container to offer; the empty state says so.
      setArkServers([])
    } finally { setLoadingServers(false) }
  }, [])

  const loadVersions = useCallback(async () => {
    try {
      const res = await arkshopApi.listVersions()
      setVersions(res.data.versions || [])
    } catch { /* the version list stays as it is; deploy still works */ }
  }, [])

  // After useArkShopConfig's own effect, so the request order is unchanged.
  useEffect(() => { void loadArkServers(); void loadVersions() }, [])

  async function handlePull(machineId: number, containerName: string) {
    if (!(await confirm({
      title: t('arkshop.loadFromServer.pullButton'),
      description: t('arkshop.messagesResult.pullConfirm', { container: containerName }),
      confirmLabel: t('arkshop.loadFromServer.pullButton'),
      tone: 'danger',
    }))) return
    if (!(await config.confirmDiscardEdits())) return
    setPulling(true)
    try {
      const res = await arkshopApi.pull(machineId, containerName)
      config.setConfigLoaded(true)
      const counts = await config.loadAll()
      toast.success(t('arkshop.messagesResult.pullSuccess', { source: res.data.source, ...counts }))
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.pullError')))
    } finally { setPulling(false) }
  }

  function reportDeploy(summary: PluginPushSummary) {
    setPushResults(summary)
    if (summary.deployed > 0 && summary.failed === 0 && summary.skipped_running === 0) {
      toast.success(t('arkshop.messagesResult.deployAllSuccess', {
        version: summary.version, deployed: summary.deployed, total: summary.total,
      }))
    } else if (summary.deployed > 0) {
      toast.success(t('arkshop.messagesResult.deployPartial', {
        version: summary.version, deployed: summary.deployed,
        skipped: summary.skipped_running, failed: summary.failed,
      }))
    } else if (summary.skipped_running > 0) {
      toast.error(t('arkshop.messagesResult.deployNone', { skipped: summary.skipped_running }))
    } else {
      toast.error(t('arkshop.messagesResult.deployFailed', { failed: summary.failed }))
    }
  }

  /** Deploy pushes what was saved: unsaved form edits would not travel. */
  async function confirmDeploy(description: string) {
    if (!(await confirm({
      title: t('arkshop.deploy.confirmTitle'),
      description,
      confirmLabel: t('arkshop.actions.deploy'),
      tone: 'danger',
    }))) return false
    if (config.anyDirty && !(await confirm({
      title: t('arkshop.deploy.unsavedTitle'),
      description: t('arkshop.deploy.unsavedDescription'),
      confirmLabel: t('arkshop.deploy.unsavedConfirm'),
      tone: 'danger',
    }))) return false
    return true
  }

  async function handleDeployAll() {
    if (!(await confirmDeploy(t('arkshop.deploy.confirmAll', { count: arkServers.length })))) return
    setPushing(true); setPushResults(null)
    try {
      const res = await arkshopApi.deploy(deployVersionId ?? undefined)
      reportDeploy(res.data)
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.deployError')))
    } finally { setPushing(false) }
  }

  async function handleDeployOne(server: ArkServerRow) {
    const key = `${server.machine_id}|${server.container_name}`
    if (!(await confirmDeploy(t('arkshop.deploy.confirmOne', { container: server.container_name })))) return
    await perServer.run(key, async () => {
      try {
        const res = await arkshopApi.deploy(deployVersionId ?? undefined, server.machine_id, server.container_name)
        reportDeploy(res.data)
      } catch (err) {
        toast.error(extractError(err, t('arkshop.messagesResult.deployError')))
      }
    })
  }

  async function handleSaveVersion() {
    if (!versionLabel.trim()) { toast.error(t('arkshop.messagesResult.versionNameRequired')); return }
    setSavingVersion(true)
    try {
      const res = await arkshopApi.saveVersion(versionLabel.trim())
      toast.success(t('arkshop.messagesResult.versionSaved', {
        label: res.data.label, total: res.data.total_versions,
      }))
      setVersionLabel('')
      void loadVersions()
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.versionSaveError')))
    } finally { setSavingVersion(false) }
  }

  async function handleRestoreVersion(version: PluginVersionRow) {
    // Restore replaces every shop item, kit, sell item and settings block with
    // the snapshot: it sits one mis-click away from "select for deploy".
    if (!(await confirm({
      title: t('arkshop.deploy.restoreCurrent'),
      description: t('arkshop.messagesResult.versionRestoreConfirm', { label: version.label }),
      confirmLabel: t('arkshop.deploy.restoreConfirmAction'),
      tone: 'danger',
      confirmText: t('arkshop.restoreWord'),
    }))) return
    if (!(await config.confirmDiscardEdits())) return
    try {
      const res = await arkshopApi.restoreVersion(version.id)
      const counts = await config.loadAll()
      toast.success(t('arkshop.messagesResult.versionRestored', { label: res.data.label, ...counts }))
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.versionRestoreError')))
    }
  }

  async function handleDeleteVersion(version: PluginVersionRow) {
    // Name the snapshot: "Delete this version?" next to a list of them is not
    // enough to tell which one is about to go.
    if (!(await confirm({
      title: t('arkshop.deploy.deleteNamed', { label: version.label }),
      description: t('arkshop.deploy.deleteConfirmNamed', { label: version.label }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    }))) return
    try {
      await arkshopApi.deleteVersion(version.id)
      if (deployVersionId === version.id) setDeployVersionId(null)
      toast.success(t('arkshop.messagesResult.versionDeleted'))
      void loadVersions()
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.versionDeleteError')))
    }
  }

  return {
    arkServers, loadingServers, pulling, pushing, showDeploy, setShowDeploy, pushResults, setPushResults,
    versions, savingVersion, versionLabel, setVersionLabel, showVersions, setShowVersions,
    deployVersionId, setDeployVersionId, perServer,
    loadArkServers, handlePull, handleDeployAll, handleDeployOne,
    handleSaveVersion, handleRestoreVersion, handleDeleteVersion,
  }
}

export type ArkShopDeployState = ReturnType<typeof useArkShopDeploy>
