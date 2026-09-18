/**
 * RareDinosPage — Rare dino pool management (ARKM_rare_dinos).
 *
 * The pool rows drive what the plugin may spawn. Pool edits (add, edit,
 * toggle, delete, bulk apply) are require_operator server side; wiping the
 * spawn EVENT log is require_admin. Generating a preview is read-only, so it
 * stays open to everyone.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Plus, RefreshCw, RotateCw, Shuffle, Trash2 } from 'lucide-react'
import { arkRareDinosApi } from '../../services/api'
import { extractError } from '../../utils/errors'
import type { AuthUser } from '../../types'
import {
  Alert, Button, Card, IconButton, PageHeader, Spinner, useConfirm, useToast,
} from '../../components/ui'
import { usePending } from '../../hooks/usePending'
import type { RareDino } from './rareDinoModel'
import { useDinoEditor } from './hooks/useDinoEditor'
import { useDinoGenerator } from './hooks/useDinoGenerator'
import { DinoEditModal } from './components/DinoEditModal'
import { GeneratorModal } from './components/GeneratorModal'
import { RareDinoFilters, type EnabledFilter } from './components/RareDinoFilters'
import { RareDinoTable } from './components/RareDinoTable'

interface Props {
  currentUser?: AuthUser | null
}

export default function RareDinosPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'

  const [dinos, setDinos] = useState<RareDino[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterMap, setFilterMap] = useState('all')
  const [filterEnabled, setFilterEnabled] = useState<EnabledFilter>('all')
  const [clearingSpawns, setClearingSpawns] = useState(false)
  const rowPending = usePending<number>()

  async function loadDinos() {
    // Also on a refetch, not just the first load: the header's Refresh and
    // the inline spinner both read this flag. The table keeps the stale rows
    // visible because it guards on `loading && dinos.length === 0`.
    setLoading(true)
    try {
      const res = await arkRareDinosApi.list()
      setDinos(res.data.dinos)
    } catch (e: unknown) {
      setError(extractError(e, t('rareDinos.loadFailed')))
    } finally { setLoading(false) }
  }

  useEffect(() => { loadDinos() }, [])

  const editor = useDinoEditor({ loadDinos })
  const generator = useDinoGenerator({ loadDinos })

  // Mappe uniche
  const maps = useMemo(() => {
    const s = new Set(dinos.map(d => d.map_name))
    return Array.from(s).sort()
  }, [dinos])

  const filtered = useMemo(() => {
    return dinos.filter(d => {
      if (search
        && !d.display_name.toLowerCase().includes(search.toLowerCase())
        && !d.dino_bp.toLowerCase().includes(search.toLowerCase())) return false
      if (filterMap !== 'all' && d.map_name !== filterMap && d.map_name !== '*') return false
      if (filterEnabled === 'on' && !d.enabled) return false
      if (filterEnabled === 'off' && d.enabled) return false
      return true
    })
  }, [dinos, search, filterMap, filterEnabled])

  async function toggleEnabled(dino: RareDino) {
    try {
      await rowPending.run(dino.id, () => arkRareDinosApi.update(dino.id, { enabled: !dino.enabled }))
      await loadDinos()
    } catch (e: unknown) {
      toast.error(extractError(e, t('rareDinos.toggleFailed', { name: dino.display_name })))
    }
  }

  async function handleDelete(dino: RareDino) {
    const ok = await confirm({
      title: t('rareDinos.confirmDeleteTitle'),
      description: t('rareDinos.confirmDelete', { name: dino.display_name }),
      confirmLabel: t('rareDinos.confirmDeleteAction'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await rowPending.run(dino.id, () => arkRareDinosApi.delete(dino.id))
      toast.success(t('rareDinos.deletedDone', { name: dino.display_name }))
      await loadDinos()
    } catch (e: unknown) {
      toast.error(extractError(e, t('rareDinos.deleteFailed')))
    }
  }

  async function handleClearSpawnTable() {
    // The spawn TABLE is the event log (ARKM_rare_spawns) -- the configured
    // POOL (ARKM_rare_dinos rows) is left intact. The confirm copy says so
    // explicitly so a panicked operator can't lose their pool by misreading
    // the button.
    const ok = await confirm({
      title: t('rareDinos.clearSpawnsTitle'),
      description: t('rareDinos.clearSpawnsConfirm'),
      confirmLabel: t('rareDinos.clearSpawnsAction'),
      tone: 'danger',
    })
    if (!ok) return
    setClearingSpawns(true); setError('')
    try {
      const res = await arkRareDinosApi.clearSpawns()
      toast.success(t('rareDinos.clearSpawnsDone', { count: res.data.deleted }))
    } catch (e: unknown) {
      // The api.ts response interceptor already turns a Pydantic array
      // `detail` into a string, so it is always safe to render here.
      setError(extractError(e, t('rareDinos.clearSpawnsFailed')))
    } finally {
      setClearingSpawns(false)
    }
  }

  const enabledCount = dinos.filter(d => d.enabled).length

  return (
    <div className="l-page">
      <PageHeader
        title={t('rareDinos.heading')}
        icon={Eye}
        description={t('rareDinos.subtitle', {
          total: dinos.length,
          enabled: enabledCount,
          disabled: dinos.length - enabledCount,
        })}
        actions={
          <>
            {isAdmin && (
              <Button
                variant="danger"
                icon={Trash2}
                loading={clearingSpawns}
                loadingLabel={t('rareDinos.clearingSpawns')}
                title={t('rareDinos.clearSpawnsTitle')}
                onClick={handleClearSpawnTable}
              >
                {t('rareDinos.clearSpawns')}
              </Button>
            )}
            <Button icon={Shuffle} onClick={generator.open}>{t('rareDinos.generateRandom')}</Button>
            {canOperate && (
              <Button variant="primary" icon={Plus} onClick={editor.openAddModal}>
                {t('rareDinos.addDino')}
              </Button>
            )}
            <IconButton icon={RefreshCw} label={t('common.refresh')} loading={loading} onClick={loadDinos} />
          </>
        }
      />

      {error && (
        <Alert
          tone="danger"
          actions={<Button size="sm" icon={RotateCw} onClick={loadDinos}>{t('common.retry')}</Button>}
          onDismiss={() => setError('')}
        >
          {error}
        </Alert>
      )}

      <Card
        title={t('rareDinos.listTitle')}
        flush
        actions={
          <>
            {loading && dinos.length > 0 && <Spinner />}
            <RareDinoFilters
              search={search}
              setSearch={setSearch}
              filterMap={filterMap}
              setFilterMap={setFilterMap}
              filterEnabled={filterEnabled}
              setFilterEnabled={setFilterEnabled}
              maps={maps}
              count={filtered.length}
            />
          </>
        }
      >
        <RareDinoTable
          loading={loading && dinos.length === 0}
          dinos={filtered}
          canOperate={canOperate}
          pending={rowPending}
          onToggle={toggleEnabled}
          onEdit={editor.openEditModal}
          onDelete={handleDelete}
        />
      </Card>

      <GeneratorModal gen={generator} maps={maps} canOperate={canOperate} />
      <DinoEditModal editor={editor} />
    </div>
  )
}
