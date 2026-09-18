/**
 * The stored ArkShop config: whether one exists, its six blocks, the unsaved
 * edits of the three settings forms, and the actions that replace it wholesale
 * (upload, reset, export).
 */
import { useCallback, useEffect, useState, type ChangeEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  arkshopApi,
  type ArkShopEntry, type ArkShopGeneral, type ArkShopMessages, type ArkShopMysql,
} from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import { extractError } from '../../../utils/errors'
import { cleanJsonComments } from '../arkshopUtils'

/** Counts of what a pull or a restore loaded, for the result message. */
export interface LoadedCounts { items: number; kits: number }

/** The three settings blocks that have their own form and their own Save. */
export type SettingsBlock = 'mysql' | 'general' | 'messages'

export function useArkShopConfig(fileInputRef: RefObject<HTMLInputElement>) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [configLoaded, setConfigLoaded] = useState(false)
  // Until the status request settles the page must not claim there is no
  // config: an operator who believes it pulls, and a pull replaces the stored
  // config together with every edit that was never deployed.
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [loading, setLoading] = useState(false)

  const [mysql, setMysql] = useState<ArkShopMysql>({})
  const [general, setGeneral] = useState<ArkShopGeneral>({})
  const [shopItems, setShopItems] = useState<ArkShopEntry[]>([])
  const [kits, setKits] = useState<ArkShopEntry[]>([])
  const [sellItems, setSellItems] = useState<ArkShopEntry[]>([])
  const [messages, setMessages] = useState<ArkShopMessages>({})

  // The last saved shape of the three settings forms, so an unsaved edit can
  // be named before a deploy pushes the saved values instead.
  const [saved, setSaved] = useState({ mysql: '{}', general: '{}', messages: '{}' })
  // A block whose GET failed renders its typed fallbacks (10 items per page,
  // port 3306, empty strings). Those are defaults, not what is stored: the
  // form says so and its Save stays shut until the block loads.
  const [blockFailed, setBlockFailed] = useState<Record<SettingsBlock, boolean>>({
    mysql: false, general: false, messages: false,
  })
  const dirtyMysql = JSON.stringify(mysql) !== saved.mysql
  const dirtyGeneral = JSON.stringify(general) !== saved.general
  const dirtyMessages = JSON.stringify(messages) !== saved.messages
  const anyDirty = dirtyMysql || dirtyGeneral || dirtyMessages

  const loadAll = useCallback(async (): Promise<LoadedCounts> => {
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
    setSaved({
      mysql: JSON.stringify(my.status === 'fulfilled' ? my.value.data : {}),
      general: JSON.stringify(gen.status === 'fulfilled' ? gen.value.data : {}),
      messages: JSON.stringify(msg.status === 'fulfilled' ? msg.value.data : {}),
    })
    setBlockFailed({
      mysql: my.status === 'rejected',
      general: gen.status === 'rejected',
      messages: msg.status === 'rejected',
    })
    // Pull and restore do not return counts; report the ones just loaded.
    return {
      items: shop.status === 'fulfilled' ? shop.value.data.length : 0,
      kits: kit.status === 'fulfilled' ? kit.value.data.length : 0,
    }
  }, [])

  /** Retry one failed settings block, leaving the other two as they are. */
  const reloadBlock = useCallback(async (block: SettingsBlock) => {
    try {
      if (block === 'mysql') {
        const res = await arkshopApi.getMysql()
        setMysql(res.data); setSaved(prev => ({ ...prev, mysql: JSON.stringify(res.data) }))
      } else if (block === 'general') {
        const res = await arkshopApi.getGeneral()
        setGeneral(res.data); setSaved(prev => ({ ...prev, general: JSON.stringify(res.data) }))
      } else {
        const res = await arkshopApi.getMessages()
        setMessages(res.data); setSaved(prev => ({ ...prev, messages: JSON.stringify(res.data) }))
      }
      setBlockFailed(prev => ({ ...prev, [block]: false }))
    } catch (err) {
      toast.error(extractError(err, t('arkshop.blockLoad.error')))
    }
  }, [t, toast])

  const checkStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError('')
    try {
      const res = await arkshopApi.configStatus()
      if (res.data.has_config) { setConfigLoaded(true); await loadAll() }
    } catch (err) {
      setStatusError(extractError(err, t('arkshop.messagesResult.statusError')))
    } finally { setStatusLoading(false) }
  }, [loadAll, t])

  useEffect(() => { void checkStatus() }, [])

  /** Ask before anything replaces the three settings forms from the server. */
  const confirmDiscardEdits = useCallback(async () => {
    if (!anyDirty) return true
    return confirm({
      title: t('arkshop.unsaved.title'),
      description: t('arkshop.unsaved.description'),
      confirmLabel: t('arkshop.unsaved.confirm'),
      tone: 'danger',
    })
  }, [anyDirty, confirm, t])

  async function handleReset() {
    if (!(await confirm({
      title: t('arkshop.actions.reset'),
      description: t('arkshop.messagesResult.resetConfirm'),
      confirmLabel: t('arkshop.actions.reset'),
      tone: 'danger',
      confirmText: t('arkshop.resetWord'),
    }))) return
    try {
      await arkshopApi.deleteConfig()
      setConfigLoaded(false)
      setShopItems([]); setKits([]); setSellItems([])
      setMysql({}); setGeneral({}); setMessages({})
      setSaved({ mysql: '{}', general: '{}', messages: '{}' })
      setBlockFailed({ mysql: false, general: false, messages: false })
      toast.success(t('arkshop.messagesResult.resetSuccess'))
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.resetError')))
    }
  }

  async function handleUploadClick() {
    if (configLoaded && !(await confirm({
      title: t('arkshop.actions.reload'),
      description: t('arkshop.messagesResult.uploadConfirm'),
      confirmLabel: t('arkshop.actions.reload'),
      tone: 'danger',
    }))) return
    fileInputRef.current?.click()
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const raw = await file.text()
      await arkshopApi.uploadConfig(JSON.parse(cleanJsonComments(raw)))
      setConfigLoaded(true)
      toast.success(t('arkshop.messagesResult.uploadSuccess'))
      await loadAll()
    } catch (err) {
      const message = (err as { message?: string })?.message
      toast.error(message?.includes('JSON')
        ? t('arkshop.messagesResult.invalidJson')
        : extractError(err, t('arkshop.messagesResult.genericError')))
    } finally {
      setLoading(false)
      event.target.value = ''
    }
  }

  async function handleExport() {
    try {
      const res = await arkshopApi.exportConfig()
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' }))
      anchor.download = 'ArkShop.json'
      anchor.click()
      URL.revokeObjectURL(anchor.href)
      toast.success(t('arkshop.messagesResult.exportSuccess'))
    } catch (err) {
      toast.error(extractError(err, t('arkshop.messagesResult.genericError')))
    }
  }

  // Each save refuses while its block is showing defaults instead of the
  // stored values; the form's Save button is shut for the same reason.
  async function saveMysql() {
    if (blockFailed.mysql) return
    try {
      await arkshopApi.updateMysql(mysql)
      setSaved(prev => ({ ...prev, mysql: JSON.stringify(mysql) }))
      toast.success(t('arkshop.messagesResult.mysqlSaved'))
    } catch (err) { toast.error(extractError(err, t('arkshop.messagesResult.genericError'))) }
  }
  async function saveGeneral() {
    if (blockFailed.general) return
    try {
      await arkshopApi.updateGeneral(general)
      setSaved(prev => ({ ...prev, general: JSON.stringify(general) }))
      toast.success(t('arkshop.messagesResult.generalSaved'))
    } catch (err) { toast.error(extractError(err, t('arkshop.messagesResult.genericError'))) }
  }
  async function saveMessages() {
    if (blockFailed.messages) return
    try {
      await arkshopApi.updateMessages(messages)
      setSaved(prev => ({ ...prev, messages: JSON.stringify(messages) }))
      toast.success(t('arkshop.messagesResult.messagesSaved'))
    } catch (err) { toast.error(extractError(err, t('arkshop.messagesResult.genericError'))) }
  }

  return {
    configLoaded, setConfigLoaded, statusLoading, statusError, retryStatus: checkStatus, loading,
    mysql, setMysql, general, setGeneral, messages, setMessages,
    shopItems, setShopItems, kits, setKits, sellItems, setSellItems,
    blockFailed, reloadBlock,
    dirtyMysql, dirtyGeneral, dirtyMessages, anyDirty, confirmDiscardEdits,
    loadAll, handleReset, handleUploadClick, handleFileUpload, handleExport,
    saveMysql, saveGeneral, saveMessages,
  }
}

export type ArkShopConfigState = ReturnType<typeof useArkShopConfig>
