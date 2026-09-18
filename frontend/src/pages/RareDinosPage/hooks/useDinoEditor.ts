/**
 * useDinoEditor — the add/edit dialog's form, its blueprint lookup and its
 * validation.
 *
 * The blueprint search lives here rather than in the dialog: it is debounced,
 * and moving it into a component that unmounts with the dialog would restart
 * the timer every time the dialog opens. openEditModal deliberately does NOT
 * reset the search (only openAddModal does), which is how an edit keeps the
 * blueprint it was opened with.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkRareDinosApi, blueprintsApi, type BlueprintRow } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import { useToast } from '../../../components/ui'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { DEFAULT_STATS, STATS, statValue, type BpItem, type DinoForm, type RareDino } from '../rareDinoModel'

interface Args {
  loadDinos: () => Promise<void>
}

export function useDinoEditor({ loadDinos }: Args) {
  const { t } = useTranslation()
  const toast = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingDino, setEditingDino] = useState<RareDino | null>(null)
  const [form, setForm] = useState<DinoForm>({ dino_bp: '', map_name: '*', enabled: true, ...DEFAULT_STATS })
  const [saving, setSaving] = useState(false)
  // Errors raised while the dialog is open belong inside it.
  const [modalError, setModalError] = useState('')
  const [bpError, setBpError] = useState('')
  const [statErrors, setStatErrors] = useState<Record<string, string>>({})

  // Blueprint search
  const [bpSearch, setBpSearch] = useState('')
  const [bpResults, setBpResults] = useState<BpItem[]>([])
  const [bpLoading, setBpLoading] = useState(false)
  // Status of the local blueprint DB. null = not yet probed; drives the
  // "DB empty" warning so users don't stare at a silent autocomplete that
  // returns nothing.
  const [bpDbStatus, setBpDbStatus] = useState<{
    has_data: boolean
    total: number
    last_sync: string | null
  } | null>(null)
  // Did the most recent search return zero results? Used together with
  // bpDbStatus to render the right empty state in the list.
  const [bpSearched, setBpSearched] = useState(false)
  const debouncedBp = useDebouncedValue(bpSearch, 300)

  // Probe the blueprint DB once on mount so we can warn the user up front
  // when it's empty (the autocomplete would otherwise return zero matches
  // forever and look broken).
  useEffect(() => {
    blueprintsApi.status()
      .then(r => setBpDbStatus({
        has_data: r.data.has_data,
        total: r.data.total_blueprints,
        last_sync: r.data.last_sync,
      }))
      .catch(() => setBpDbStatus({ has_data: false, total: 0, last_sync: null }))
  }, [])

  useEffect(() => {
    // Clearing the flag here matters: when the query shrinks below two
    // characters while a request is in flight, the cleanup below detaches
    // that request, so nothing else would ever switch the spinner off.
    if (debouncedBp.length < 2) { setBpLoading(false); return }
    let alive = true
    setBpLoading(true)
    blueprintsApi.list({ search: debouncedBp, type: 'dino', scope: 'official_plus_s', limit: 10 })
      .then(res => {
        if (!alive) return
        setBpResults(res.data.items?.map((i: BlueprintRow) => ({
          name: i.name, blueprint: i.blueprint, category: i.category ?? '',
        })) || [])
      })
      .catch(() => { if (alive) setBpResults([]) })
      .finally(() => {
        if (!alive) return
        setBpLoading(false)
        setBpSearched(true)
      })
    return () => { alive = false }
  }, [debouncedBp])

  /** Typing fewer than two characters clears the list at once, not in 300ms. */
  function changeBpSearch(value: string) {
    setBpSearch(value)
    // At once, not at the end of the debounce: the popup must not keep
    // claiming it is loading a query that will never be sent.
    if (value.length < 2) { setBpResults([]); setBpSearched(false); setBpLoading(false) }
  }

  function clearErrors() {
    setModalError(''); setBpError(''); setStatErrors({})
  }

  function openAddModal() {
    setEditingDino(null)
    setForm({ dino_bp: '', map_name: '*', enabled: true, ...DEFAULT_STATS })
    setBpSearch('')
    setBpResults([])
    setBpLoading(false)
    clearErrors()
    setShowModal(true)
  }

  function openEditModal(dino: RareDino) {
    setEditingDino(dino)
    const f: DinoForm = { dino_bp: dino.dino_bp, map_name: dino.map_name, enabled: dino.enabled }
    STATS.forEach(s => {
      f[`${s.key}_min`] = (dino as unknown as Record<string, number>)[`${s.key}_min`]
      f[`${s.key}_max`] = (dino as unknown as Record<string, number>)[`${s.key}_max`]
    })
    setForm(f)
    clearErrors()
    setShowModal(true)
  }

  function close() {
    setShowModal(false)
  }

  function selectBp(bp: BpItem) {
    setForm(prev => ({ ...prev, dino_bp: bp.blueprint }))
    setBpSearch('')
    setBpResults([])
    setBpLoading(false)
    setBpError('')
  }

  async function handleSave() {
    const bp = String(form.dino_bp ?? '')
    const errors: Record<string, string> = {}
    for (const s of STATS) {
      const min = statValue(form, `${s.key}_min`)
      const max = statValue(form, `${s.key}_max`)
      // Only active stats are validated: -1/-1 means "leave this one alone".
      if (min >= 0 && max >= 0 && min > max) {
        errors[s.key] = t('rareDinos.modal.errorMinMax')
      }
    }
    setStatErrors(errors)
    if (!bp.trim()) {
      setBpError(t('rareDinos.errorBpRequired'))
      return
    }
    setBpError('')
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      if (editingDino) {
        await arkRareDinosApi.update(editingDino.id, form)
      } else {
        await arkRareDinosApi.create(form)
      }
      setShowModal(false)
      toast.success(editingDino
        ? t('rareDinos.savedEdit', { name: editingDino.display_name })
        : t('rareDinos.savedNew'))
      await loadDinos()
    } catch (e: unknown) {
      setModalError(extractError(e, t('rareDinos.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return {
    showModal, editingDino, form, setForm, saving,
    modalError, bpError, statErrors,
    bpSearch, changeBpSearch, bpResults, bpLoading, bpDbStatus, bpSearched,
    openAddModal, openEditModal, close, selectBp, handleSave,
  }
}

export type DinoEditor = ReturnType<typeof useDinoEditor>
