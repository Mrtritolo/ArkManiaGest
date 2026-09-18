/**
 * The add/edit dialog for a shop item, a kit or a sell item, plus the delete
 * the list rows share with it. The dialog keeps the typed values on failure
 * and refuses to close silently once something was changed.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkshopApi, type ArkShopEntry } from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import { extractError } from '../../../utils/errors'
import { NEW_KIT_ENTRY, NEW_SELL_ENTRY, NEW_SHOP_ENTRY } from '../arkshopUtils'
import type { ArkShopConfigState } from './useArkShopConfig'

export type EntryType = 'shop' | 'kit' | 'sell'

const clone = (entry: ArkShopEntry): ArkShopEntry => JSON.parse(JSON.stringify(entry))

export function useEntryDialog(config: ArkShopConfigState) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogType, setDialogType] = useState<EntryType>('shop')
  const [dialogData, setDialogData] = useState<ArkShopEntry | null>(null)
  const [dialogIsNew, setDialogIsNew] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [saving, setSaving] = useState(false)
  // The copy the dialog opened with, to tell an edited entry from an untouched one.
  const [opened, setOpened] = useState('')

  const dirty = dialogData !== null && JSON.stringify(dialogData) !== opened

  function open(type: EntryType, entry: ArkShopEntry | undefined, blank: ArkShopEntry) {
    const data = entry ? clone(entry) : clone(blank)
    setDialogType(type)
    setDialogIsNew(!entry)
    setDialogData(data)
    setOpened(JSON.stringify(data))
    setDialogError('')
    setDialogOpen(true)
  }

  const openShopDialog = (entry?: ArkShopEntry) => open('shop', entry, NEW_SHOP_ENTRY)
  const openKitDialog = (entry?: ArkShopEntry) => open('kit', entry, NEW_KIT_ENTRY)
  const openSellDialog = (entry?: ArkShopEntry) => open('sell', entry, NEW_SELL_ENTRY)

  async function requestClose() {
    if (saving) return
    if (dirty && !(await confirm({
      title: t('arkshop.dialog.discardTitle'),
      description: t('arkshop.dialog.discardDescription'),
      confirmLabel: t('arkshop.dialog.discardConfirm'),
      tone: 'danger',
    }))) return
    setDialogOpen(false)
  }

  async function handleDialogSave() {
    if (!dialogData?.key?.trim()) { setDialogError(t('arkshop.messagesResult.keyRequired')); return }
    const { key: rawKey, ...data } = dialogData
    const key = dialogIsNew ? rawKey.trim() : rawKey
    // The PUT is an upsert: a "new" entry with an existing key would silently
    // replace that entry (items, price, permissions) with this one.
    if (dialogIsNew) {
      const existing = dialogType === 'shop' ? config.shopItems : dialogType === 'kit' ? config.kits : config.sellItems
      if (existing.some(e => e.key === key)) {
        setDialogError(t('arkshop.messagesResult.keyExists', { key }))
        return
      }
    }
    setSaving(true)
    setDialogError('')
    try {
      if (dialogType === 'shop') {
        await arkshopApi.updateShopItem(key, data)
        config.setShopItems((await arkshopApi.listShopItems()).data)
      } else if (dialogType === 'kit') {
        await arkshopApi.updateKit(key, data)
        config.setKits((await arkshopApi.listKits()).data)
      } else {
        await arkshopApi.updateSellItem(key, data)
        config.setSellItems((await arkshopApi.listSellItems()).data)
      }
      toast.success(t('arkshop.messagesResult.saved', { key }))
      setDialogOpen(false)
    } catch (err) {
      setDialogError(extractError(err, t('arkshop.messagesResult.saveError')))
    } finally { setSaving(false) }
  }

  async function handleDelete(type: EntryType, key: string) {
    if (!(await confirm({
      title: t('arkshop.shop.deleteTooltip'),
      description: t('arkshop.messagesResult.deleteConfirm', { key }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    }))) return
    try {
      if (type === 'shop') {
        await arkshopApi.deleteShopItem(key)
        config.setShopItems(prev => prev.filter(i => i.key !== key))
      } else if (type === 'kit') {
        await arkshopApi.deleteKit(key)
        config.setKits(prev => prev.filter(i => i.key !== key))
      } else {
        await arkshopApi.deleteSellItem(key)
        config.setSellItems(prev => prev.filter(i => i.key !== key))
      }
      toast.success(t('arkshop.messagesResult.deleted', { key }))
      setDialogOpen(false)
    } catch (err) {
      const message = extractError(err, t('arkshop.messagesResult.deleteError'))
      if (dialogOpen) setDialogError(message)
      else toast.error(message)
    }
  }

  return {
    dialogOpen, dialogType, dialogData, setDialogData, dialogIsNew, dialogError, saving, dirty,
    openShopDialog, openKitDialog, openSellDialog, requestClose, handleDialogSave, handleDelete,
  }
}

export type EntryDialogState = ReturnType<typeof useEntryDialog>
