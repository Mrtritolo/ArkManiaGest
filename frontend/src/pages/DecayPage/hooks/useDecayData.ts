/**
 * useDecayData — the page's four lists plus the filters that shape them.
 *
 * loadData reads filterStatus and search from the render that created it, so
 * every caller must use the loadData of the same render (the shell passes it
 * down); a ref would let a command refresh with a filter the operator has
 * already left.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import { TRIBES_LIMIT, type DecayStats, type DecayTribe, type LogItem, type PendingItem } from '../decayModel'

const EMPTY_STATS: DecayStats = {
  total: 0, expired: 0, expiring_soon: 0, safe: 0, pending: 0, purged_last_7d: 0,
}

export function useDecayData() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DecayStats>(EMPTY_STATS)
  const [tribes, setTribes] = useState<DecayTribe[]>([])
  const [pending, setPending] = useState<PendingItem[]>([])
  const [log, setLog] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')

  async function loadData() {
    setLoading(true)
    try {
      const [statsRes, tribesRes, pendingRes, logRes] = await Promise.all([
        arkDecayApi.overview(),
        arkDecayApi.tribes({
          status: filterStatus !== 'all' ? filterStatus : undefined,
          search: search || undefined,
          limit: TRIBES_LIMIT,
        }),
        arkDecayApi.pending(),
        arkDecayApi.log({ limit: 50 }),
      ])
      setStats(statsRes.data)
      setTribes(tribesRes.data.tribes)
      setPending(pendingRes.data.pending)
      setLog(logRes.data.log)
      // Deliberately NOT clearing `error` here: runCmd sets the RCON failure
      // and then awaits this reload, which would wipe the reason before it
      // ever rendered.
    } catch (e: unknown) {
      setError(extractError(e, t('decay.loadFailed')))
    } finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [filterStatus])

  function handleSearch(e: FormEvent) {
    e.preventDefault(); loadData()
  }

  return {
    stats, tribes, pending, log, loading,
    error, setError,
    filterStatus, setFilterStatus,
    search, setSearch, handleSearch,
    loadData,
  }
}
