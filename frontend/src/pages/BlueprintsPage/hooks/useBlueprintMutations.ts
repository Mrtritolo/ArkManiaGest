/**
 * Every catalogue write: deletes (row, selection, filter, source, prune) and
 * the category edits. Each destructive call is confirmed first; the mass ones
 * ask for a typed word.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi } from '../../../services/api'
import { useConfirm, useToast } from '../../../components/ui'
import type { Selection } from '../../../hooks/useSelection'
import { extractError } from '../../../utils/errors'
import type { BlueprintCatalog } from './useBlueprintCatalog'

export function useBlueprintMutations(catalog: BlueprintCatalog, selection: Selection<number>) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()

  const [deleting, setDeleting] = useState(false)
  const [editingCat, setEditingCat] = useState<number | null>(null)
  const [editCatValue, setEditCatValue] = useState('')
  const [bulkCat, setBulkCat] = useState('')

  const confirmWord = t('blueprints.manage.confirmWord')

  async function handleDeleteSelected() {
    if (selection.count === 0) return
    const ids = [...selection.selected]
    if (!(await confirm({
      title: t('blueprints.manage.deleteSelectedTitle', { count: ids.length }),
      description: t('blueprints.manage.deleteSelectedConfirm', { count: ids.length }),
      confirmLabel: t('blueprints.manage.deleteSelected'),
      tone: 'danger',
    }))) return
    setDeleting(true)
    let removed = 0
    try {
      // Sequential on purpose: the backend deletes one row per request.
      for (const id of ids) {
        await blueprintsApi.deleteOne(id)
        removed++
      }
      toast.success(t('blueprints.manage.deleted', { count: removed }))
    } catch (err) {
      toast.error(extractError(err, t('blueprints.manage.deleteFailed')))
    } finally {
      setDeleting(false)
      // Also after a failure part-way: the rows deleted before it are gone.
      selection.clear()
      if (removed > 0) void catalog.loadStatus()
    }
  }

  async function handleDeleteFiltered() {
    if (!catalog.hasFilters) {
      toast.error(t('blueprints.manage.filterRequired'))
      return
    }
    if (!(await confirm({
      title: t('blueprints.manage.deleteFilteredTitle'),
      description: t('blueprints.manage.deleteFilteredConfirm', { count: catalog.total }),
      confirmLabel: t('blueprints.manage.deleteFiltered', { count: catalog.total }),
      tone: 'danger',
      confirmText: confirmWord,
    }))) return
    setDeleting(true)
    try {
      const res = await blueprintsApi.deleteByFilter({
        search: catalog.appliedSearch || undefined,
        category: catalog.catFilter || undefined,
        type: catalog.typeFilter || undefined,
        source: catalog.sourceFilter || undefined,
      })
      toast.success(t('blueprints.manage.deleted', { count: res.data.removed }))
      selection.clear()
      void catalog.loadStatus()
    } catch (err) {
      toast.error(extractError(err, t('blueprints.manage.deleteFailed')))
    } finally { setDeleting(false) }
  }

  async function handleDeleteSource(src: string) {
    if (!(await confirm({
      title: t('blueprints.manage.deleteSourceTitle', { source: src }),
      description: t('blueprints.manage.deleteSourceConfirm', { source: src }),
      confirmLabel: t('blueprints.manage.deleteSourceAction'),
      tone: 'danger',
    }))) return
    setDeleting(true)
    try {
      const res = await blueprintsApi.deleteBySource(src)
      toast.success(t('blueprints.manage.deletedFromSource', { count: res.data.removed, source: src }))
      selection.clear()
      void catalog.loadStatus()
    } catch (err) {
      toast.error(extractError(err, t('blueprints.manage.deleteFailed')))
    } finally { setDeleting(false) }
  }

  async function handlePruneNonOfficial() {
    if (!(await confirm({
      title: t('blueprints.manage.pruneTitle'),
      description: t('blueprints.manage.pruneConfirm'),
      confirmLabel: t('blueprints.manage.prune'),
      tone: 'danger',
      confirmText: confirmWord,
    }))) return
    setDeleting(true)
    try {
      const res = await blueprintsApi.pruneNonOfficial()
      toast.success(t('blueprints.manage.pruned', { removed: res.data.removed, kept: res.data.kept }))
      selection.clear()
      void catalog.loadStatus()
    } catch (err) {
      toast.error(extractError(err, t('blueprints.manage.pruneFailed')))
    } finally { setDeleting(false) }
  }

  async function handleDeleteOne(id: number, name: string) {
    if (!(await confirm({
      title: t('blueprints.manage.deleteOneTitle'),
      description: t('blueprints.manage.deleteOneConfirm', { name }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    }))) return
    try {
      await blueprintsApi.deleteOne(id)
      catalog.setItems(prev => prev.filter(i => i.id !== id))
      catalog.setTotal(n => Math.max(0, n - 1))
      catalog.setTotalBp(n => Math.max(0, n - 1))
      toast.success(t('blueprints.manage.deleted', { count: 1 }))
    } catch (err) {
      toast.error(extractError(err, t('blueprints.manage.deleteFailed')))
    }
  }

  function startCategoryEdit(id: number, category: string) {
    setEditingCat(id)
    setEditCatValue(category)
  }

  async function saveCategoryEdit(bpId: number) {
    const next = editCatValue.trim()
    if (!next) return
    try {
      await blueprintsApi.updateCategory(bpId, next)
      setEditingCat(null)
      catalog.setItems(prev => prev.map(i => (i.id === bpId ? { ...i, category: next } : i)))
      void catalog.loadFilters()
      void catalog.loadAllCategories()
    } catch (err) {
      toast.error(extractError(err, t('blueprints.messages.updateCategoryError')))
    }
  }

  async function handleBulkCategory() {
    const next = bulkCat.trim()
    if (!next || selection.count === 0) return
    try {
      const res = await blueprintsApi.bulkUpdateCategory([...selection.selected], next)
      toast.success(t('blueprints.messages.bulkSuccess', { count: res.data.updated }))
      selection.clear()
      setBulkCat('')
      void catalog.loadData()
      void catalog.loadFilters()
      void catalog.loadAllCategories()
    } catch (err) {
      toast.error(extractError(err, t('blueprints.messages.bulkError')))
    }
  }

  return {
    deleting, editingCat, setEditingCat, editCatValue, setEditCatValue, bulkCat, setBulkCat,
    startCategoryEdit, saveCategoryEdit, handleBulkCategory,
    handleDeleteSelected, handleDeleteFiltered, handleDeleteSource, handlePruneNonOfficial, handleDeleteOne,
  }
}
