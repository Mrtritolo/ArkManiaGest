/**
 * Catalogue state: status, the current page of rows, the filter option lists
 * and every filter/page handler. The list requests are sequenced, so a slow
 * answer for a filter the operator already left never lands on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import { LIMIT, type BpItem } from '../blueprintsModel'

interface NamedCount { name: string; count: number }

export function useBlueprintCatalog() {
  const { t } = useTranslation()

  const [hasData, setHasData] = useState(false)
  const [totalBp, setTotalBp] = useState(0)
  const [lastSync, setLastSync] = useState<string | null>(null)

  const [items, setItems] = useState<BpItem[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<NamedCount[]>([])
  const [types, setTypes] = useState<NamedCount[]>([])
  const [sourcesList, setSourcesList] = useState<NamedCount[]>([])
  const [allCategories, setAllCategories] = useState<string[]>([])

  const [search, setSearch] = useState('')
  // The search the table is showing: the box can hold unsubmitted text, and
  // paging or "Delete filtered" must act on what is on screen.
  const [appliedSearch, setAppliedSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(0)

  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Only the latest list request may apply its result.
  const listSeq = useRef(0)

  const loadData = useCallback(
    async (s?: string, cat?: string, typ?: string, src?: string, pg?: number) => {
      const seq = ++listSeq.current
      setListLoading(true)
      try {
        const res = await blueprintsApi.list({
          search: (s ?? appliedSearch) || undefined,
          category: (cat ?? catFilter) || undefined,
          type: (typ ?? typeFilter) || undefined,
          source: (src ?? sourceFilter) || undefined,
          limit: LIMIT,
          offset: (pg ?? page) * LIMIT,
        })
        if (seq !== listSeq.current) return
        setItems(res.data.items as unknown as BpItem[])
        setTotal(res.data.total)
        setLoadError('')
      } catch {
        if (seq !== listSeq.current) return
        setLoadError(t('blueprints.messages.loadError'))
      } finally {
        if (seq === listSeq.current) setListLoading(false)
      }
    },
    [appliedSearch, catFilter, typeFilter, sourceFilter, page, t],
  )

  const loadFilters = useCallback(async () => {
    const [catRes, typRes, srcRes] = await Promise.allSettled([
      blueprintsApi.categories(), blueprintsApi.types(), blueprintsApi.sources(),
    ])
    if (catRes.status === 'fulfilled') setCategories(catRes.value.data.categories)
    if (typRes.status === 'fulfilled') setTypes(typRes.value.data.types)
    if (srcRes.status === 'fulfilled') setSourcesList(srcRes.value.data.sources)
  }, [])

  const loadAllCategories = useCallback(async () => {
    try {
      const res = await blueprintsApi.allCategories()
      setAllCategories(res.data.categories)
    } catch { /* the inline category editor falls back to the stored value */ }
  }, [])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await blueprintsApi.status()
      setHasData(res.data.has_data)
      setTotalBp(res.data.total_blueprints)
      setLastSync(res.data.last_sync)
      if (res.data.has_data) { void loadData(); void loadFilters(); void loadAllCategories() }
    } catch (err) {
      setLoadError(extractError(err, t('blueprints.messages.loadError')))
    } finally {
      setLoading(false)
    }
    // loadData is read from the latest render on purpose: loadStatus always
    // refetches with the filters currently on screen.
  }, [loadData, loadFilters, loadAllCategories, t])

  useEffect(() => { void loadStatus() }, [])

  function resetFilters() {
    setSearch(''); setAppliedSearch(''); setCatFilter(''); setTypeFilter(''); setSourceFilter(''); setPage(0)
  }

  // Each handler passes the new value explicitly: the state set above is not
  // applied yet when loadData reads it.
  function doSearch() { setAppliedSearch(search); setPage(0); void loadData(search, catFilter, typeFilter, sourceFilter, 0) }
  function handleCatChange(val: string) { setCatFilter(val); setPage(0); void loadData(appliedSearch, val, typeFilter, sourceFilter, 0) }
  function handleTypeChange(val: string) { setTypeFilter(val); setPage(0); void loadData(appliedSearch, catFilter, val, sourceFilter, 0) }
  function handleSourceChange(val: string) { setSourceFilter(val); setPage(0); void loadData(appliedSearch, catFilter, typeFilter, val, 0) }
  function handlePage(p: number) { setPage(p); void loadData(appliedSearch, catFilter, typeFilter, sourceFilter, p) }

  const hasFilters = Boolean(appliedSearch || catFilter || typeFilter || sourceFilter)

  return {
    hasData, setHasData, totalBp, setTotalBp, lastSync, setLastSync,
    items, setItems, total, setTotal,
    categories, types, sourcesList, allCategories,
    search, setSearch, appliedSearch, catFilter, typeFilter, sourceFilter, page,
    loading, listLoading, loadError, hasFilters,
    loadStatus, loadData, loadFilters, loadAllCategories, resetFilters,
    doSearch, handleCatChange, handleTypeChange, handleSourceChange, handlePage,
  }
}

export type BlueprintCatalog = ReturnType<typeof useBlueprintCatalog>
