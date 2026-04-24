/**
 * PlayersPage — ARK player management.
 * Modern design with Lucide icons, solid table, inline detail view.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search, Users, Star, Shield, ChevronRight, X, Plus, Minus,
  Clock, UserCheck, Skull, Home, Calendar, CreditCard, Save,
  RefreshCw, Filter, Loader2, Download, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown,
  Map, Copy, CheckCircle, ShieldOff
} from 'lucide-react'
import { playersApi, arkBansApi } from '../services/api'
import type { PlayerListItem, PlayerFull, PlayersStats, PermissionGroupItem, PlayerMapResult } from '../types'

export default function PlayersPage() {
  const { t } = useTranslation()
  const [players, setPlayers] = useState<PlayerListItem[]>([])
  const [stats, setStats] = useState<PlayersStats | null>(null)
  const [groups, setGroups] = useState<PermissionGroupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [selectedPlayer, setSelectedPlayer] = useState<PlayerFull | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [pointsInput, setPointsInput] = useState('')
  const [pointsSaving, setPointsSaving] = useState(false)
  const [permInput, setPermInput] = useState('')
  const [timedPerms, setTimedPerms] = useState<{flag: string; timestamp: number; group: string}[]>([])
  const [syncing, setSyncing] = useState(false)

  // ── Bulk timed-permission grant ─────────────────────────────────
  // selectedIds tracks the player.Id values toggled via the checkbox
  // column.  The actual configuration UI lives in a modal so the page
  // header stays uncluttered; bulkModalOpen drives that.
  // bulkDurationSeconds is a DELTA (extend by N seconds) -- when the
  // player already has the group its current expiry is bumped by that
  // delta, otherwise the entry is created with `now + delta`.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkGroup, setBulkGroup] = useState<string>('')
  const [bulkDurationSeconds, setBulkDurationSeconds] = useState<number>(7 * 24 * 3600)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null)
  const [syncContainers, setSyncContainers] = useState<Record<string, unknown>[]>([])
  const [showSyncPanel, setShowSyncPanel] = useState(false)
  const [sortCol, setSortCol] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // --- Maps & character copy ---
  const [playerMaps, setPlayerMaps] = useState<PlayerMapResult[]>([])
  const [mapsLoading, setMapsLoading] = useState(false)
  const [mapsSearched, setMapsSearched] = useState(false)
  const [mapsErrors, setMapsErrors] = useState<string[]>([])
  const [copying, setCopying] = useState(false)
  const [copySource, setCopySource] = useState<PlayerMapResult | null>(null)
  const [copyDestContainer, setCopyDestContainer] = useState('')
  const [copyDestMap, setCopyDestMap] = useState('')

  // Ban dialog
  const [showBanDialog, setShowBanDialog] = useState(false)
  const [banReason, setBanReason] = useState(t('players.ban.defaultReason'))
  const [banDuration, setBanDuration] = useState<'permanent' | '1d' | '3d' | '7d' | '30d'>('permanent')
  const [banning, setBanning] = useState(false)

  useEffect(() => { loadPlayers(); loadGroups(); loadStats(); loadSyncContainers() }, [])

  async function loadSyncContainers() {
    try {
      const res = await playersApi.syncContainers()
      setSyncContainers(res.data.containers || [])
    } catch {}
  }
  useEffect(() => { if (success) { const timer = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(timer) } }, [success])

  const loadPlayers = useCallback(async (s?: string, g?: string) => {
    setLoading(true)
    try {
      // Use the backend-side max (500) so the table actually shows every
      // registered player on small/medium clusters.  When we cross the
      // 500 mark we'll need real pagination (offset-based) -- for now a
      // single batch covers it.
      const res = await playersApi.list({ search: (s ?? search) || undefined, group: (g ?? groupFilter) || undefined, limit: 500 })
      setPlayers(res.data)
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.load')) }
    finally { setLoading(false) }
  }, [search, groupFilter, t])

  async function loadStats() { try { const res = await playersApi.stats(); setStats(res.data) } catch {} }
  async function loadGroups() { try { const res = await playersApi.permissionGroups(); setGroups(res.data) } catch {} }

  function handleSearch() { loadPlayers(search, groupFilter) }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter') handleSearch() }

  async function openDetail(id: number) {
    setDetailLoading(true); setError('')
    setPlayerMaps([]); setMapsSearched(false); setMapsErrors([])
    setCopySource(null); setCopyDestContainer(''); setCopyDestMap('')
    try {
      const res = await playersApi.get(id)
      setSelectedPlayer(res.data)
      setPointsInput(String(res.data.points ?? 0))
      setPermInput(res.data.permission_groups)
      setTimedPerms(parseTimedPerms(res.data.timed_permission_groups))
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.detail')) }
    finally { setDetailLoading(false) }
  }

  const [mapsDebug, setMapsDebug] = useState<Record<string, unknown>[]>([])

  async function handleFindMaps() {
    if (!selectedPlayer) return
    setMapsLoading(true); setMapsErrors([]); setMapsSearched(false); setMapsDebug([])
    try {
      const res = await playersApi.findPlayerMaps(selectedPlayer.eos_id)
      setPlayerMaps(res.data.maps || [])
      setMapsErrors(res.data.errors || [])
      setMapsDebug(res.data.debug || [])
      setMapsSearched(true)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('players.errors.mapSearch'))
    } finally { setMapsLoading(false) }
  }

  async function handleCopyCharacter() {
    if (!copySource || !copyDestContainer || !copyDestMap) return
    setCopying(true); setError('')
    // Find destination machine_id from syncContainers
    const destC = syncContainers.find((c: Record<string, unknown>) => c.container_name === copyDestContainer)
    if (!destC) { setError(t('players.errors.destContainerNotFound')); setCopying(false); return }
    try {
      const res = await playersApi.copyCharacter({
        source_machine_id: copySource.machine_id,
        source_container: copySource.container_name,
        source_profile_path: copySource.profile_path,
        dest_machine_id: destC.machine_id,
        dest_container: copyDestContainer,
        dest_map_name: copyDestMap,
      })
      if (res.data.success) {
        setSuccess(res.data.overwritten
          ? t('players.copy.successOverwritten', { map: copyDestMap })
          : t('players.copy.success', { map: copyDestMap }))
        setCopySource(null); setCopyDestContainer(''); setCopyDestMap('')
        handleFindMaps() // Reload maps
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || t('players.errors.copyCharacter'))
    } finally { setCopying(false) }
  }

  // Get available maps for a destination container
  function getDestMaps(containerName: string): string[] {
    const c = syncContainers.find((sc: Record<string, unknown>) => sc.container_name === containerName)
    if (!c) return []
    // Use map_name from the container as an option
    return c.map_name ? [c.map_name as string] : []
  }

  async function handleSetPoints() {
    if (!selectedPlayer) return
    const val = parseInt(pointsInput)
    if (isNaN(val) || val < 0) { setError(t('players.errors.invalidPoints')); return }
    setPointsSaving(true)
    try {
      await playersApi.setPoints(selectedPlayer.id, val)
      setSuccess(t('players.messages.pointsSet', { value: val }))
      setSelectedPlayer({ ...selectedPlayer, points: val }); loadPlayers(); loadStats()
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.generic')) }
    finally { setPointsSaving(false) }
  }

  async function handleAddPoints(amount: number) {
    if (!selectedPlayer) return
    setPointsSaving(true)
    try {
      const res = await playersApi.addPoints(selectedPlayer.id, amount)
      setSuccess(amount > 0
        ? t('players.messages.pointsChangedPositive', { amount, total: res.data.points })
        : t('players.messages.pointsChangedNegative', { amount, total: res.data.points }))
      setSelectedPlayer({ ...selectedPlayer, points: res.data.points })
      setPointsInput(String(res.data.points)); loadPlayers(); loadStats()
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.generic')) }
    finally { setPointsSaving(false) }
  }

  async function handleSavePermissions() {
    if (!selectedPlayer) return
    try {
      await playersApi.update(selectedPlayer.id, { permission_groups: permInput })
      setSuccess(t('players.messages.fixedPermsUpdated'))
      setSelectedPlayer({ ...selectedPlayer, permission_groups: permInput }); loadPlayers()
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.generic')) }
  }

  // --- Timed permissions ---
  function parseTimedPerms(raw: string) {
    if (!raw?.trim()) return [] as {flag: string; timestamp: number; group: string}[]
    return raw.split(',').filter(Boolean).map(entry => {
      const p = entry.split(';')
      return { flag: p[0] || '0', timestamp: parseInt(p[1]) || 0, group: p[2] || '' }
    }).filter(e => e.group)
  }

  function serializeTimedPerms(perms: typeof timedPerms) {
    return perms.map(p => `${p.flag};${p.timestamp};${p.group}`).join(',')
  }

  function handleTimedPermChange(i: number, field: string, value: string | number) {
    setTimedPerms(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p))
  }

  function tsToInput(ts: number) { return ts ? new Date(ts * 1000).toISOString().slice(0, 16) : '' }
  function inputToTs(val: string) { return val ? Math.floor(new Date(val).getTime() / 1000) : 0 }

  async function handleSaveTimedPermissions() {
    if (!selectedPlayer) return
    const s = serializeTimedPerms(timedPerms)
    try {
      await playersApi.update(selectedPlayer.id, { timed_permission_groups: s })
      setSuccess(t('players.messages.timedPermsUpdated'))
      setSelectedPlayer({ ...selectedPlayer, timed_permission_groups: s }); loadPlayers()
    } catch (err: any) { setError(err.response?.data?.detail || t('players.errors.generic')) }
  }

  async function handleBanPlayer() {
    if (!selectedPlayer) return
    setBanning(true); setError('')
    try {
      let expireTime: string | undefined
      if (banDuration !== 'permanent') {
        const days = { '1d': 1, '3d': 3, '7d': 7, '30d': 30 }[banDuration]
        const dt = new Date()
        dt.setDate(dt.getDate() + days)
        expireTime = dt.toISOString()
      }
      await arkBansApi.create({
        eos_id: selectedPlayer.eos_id,
        player_name: selectedPlayer.name || undefined,
        reason: banReason || t('players.ban.noReason'),
        banned_by: 'Admin',
        expire_time: expireTime,
      })
      const who = selectedPlayer.name || selectedPlayer.eos_id
      setSuccess(banDuration === 'permanent'
        ? t('players.messages.bannedPermanent', { name: who })
        : t('players.messages.bannedTemporary', { name: who, duration: banDuration }))
      setShowBanDialog(false)
      setBanReason(t('players.ban.defaultReason'))
      setBanDuration('permanent')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || t('players.errors.banFailed'))
    } finally { setBanning(false) }
  }

  // ── Bulk-selection helpers ─────────────────────────────────────

  function toggleSelected(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAll(visibleIds: number[]) {
    setSelectedIds(prev => {
      // If every visible row is already selected -> clear; else add all.
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      }
      const next = new Set(prev)
      visibleIds.forEach(id => next.add(id))
      return next
    })
  }
  function clearSelection() { setSelectedIds(new Set()); setBulkModalOpen(false) }

  function openBulkModal() {
    setBulkGroup('')
    setBulkDurationSeconds(7 * 24 * 3600)
    setBulkModalOpen(true)
  }

  async function handleBulkApply() {
    if (selectedIds.size === 0)    { setError(t('players.bulkPerm.errorNoneSelected')); return }
    if (!bulkGroup)                { setError(t('players.bulkPerm.errorNoGroup'));     return }
    if (bulkDurationSeconds < 60)  { setError(t('players.bulkPerm.errorBadDuration')); return }

    const humanDuration = formatDurationSeconds(bulkDurationSeconds)
    if (!window.confirm(t('players.bulkPerm.confirm', {
      count:    selectedIds.size,
      group:    bulkGroup,
      duration: humanDuration,
    }))) return

    setBulkApplying(true); setError('')
    try {
      const res = await playersApi.bulkAddTimedPerm({
        player_ids:       Array.from(selectedIds),
        group:            bulkGroup,
        duration_seconds: bulkDurationSeconds,
      })
      setSuccess(t('players.bulkPerm.done', {
        updated:  res.data.updated,
        extended: res.data.extended,
        added:    res.data.added,
        missing:  res.data.missing_ids.length,
      }))
      clearSelection()
      loadPlayers()
    } catch (err: any) {
      setError(err.response?.data?.detail || t('players.bulkPerm.failed'))
    } finally {
      setBulkApplying(false)
    }
  }

  /** Render a delta in seconds as '7 days' / '30 days' / '1 year' etc. */
  function formatDurationSeconds(s: number): string {
    const day = 24 * 3600
    if (s % (365 * day) === 0) return t('players.bulkPerm.fmtYears',  { n: s / (365 * day) })
    if (s % (30  * day) === 0) return t('players.bulkPerm.fmtMonths', { n: s / (30  * day) })
    return t('players.bulkPerm.fmtDays', { n: Math.round(s / day) })
  }

  async function handleSyncNames(machineId?: number, containerName?: string) {
    setSyncing(true); setError(''); setSyncResult(null)
    try {
      const res = await playersApi.syncNames(machineId, containerName)
      setSyncResult(res.data)
      if (res.data.updated > 0) {
        loadPlayers(); loadStats()
      }
      if (res.data.errors?.length > 0) {
        setError(t('players.messages.syncErrors', { errors: res.data.errors.join('; ') }))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || t('players.errors.syncNames'))
    } finally { setSyncing(false) }
  }

  // Sibling of handleSyncNames: targets .arktribe files instead of
  // .arkprofile and writes the discovered names into ARKM_player_tribes
  // + ARKM_tribe_decay.  Same SSH plumbing on the backend.
  const [syncingTribes, setSyncingTribes] = useState(false)
  async function handleSyncTribes() {
    setSyncingTribes(true); setError('')
    try {
      const res = await playersApi.syncTribes()
      const updates = res.data.player_tribes_rows_updated + res.data.tribe_decay_rows_updated
      window.alert(t('players.tribeSync.done', {
        scanned: res.data.total_files_scanned,
        matched: res.data.matched,
        rows:    updates,
      }))
      if (updates > 0) loadPlayers()
      if (res.data.errors?.length > 0) {
        setError(t('players.messages.syncErrors', { errors: res.data.errors.join('; ') }))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || t('players.tribeSync.failed'))
    } finally {
      setSyncingTribes(false)
    }
  }

  function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '--' }
  function fmtLoginAgo(d: string | null) {
    if (!d) return null
    const now = Date.now(), tms = new Date(d).getTime(), diff = now - tms
    const mins = Math.floor(diff / 60000), hrs = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000)
    if (mins < 60) return t('players.timeAgo.minutes', { n: mins })
    if (hrs < 24) return t('players.timeAgo.hours', { n: hrs })
    if (days < 30) return t('players.timeAgo.days', { n: days })
    return t('players.timeAgo.months', { n: Math.floor(days / 30) })
  }
  function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleString(undefined) : '--' }

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return <ArrowUpDown size={11} style={{ opacity: 0.25 }} />
    return sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
  }

  const sortedPlayers = [...players].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortCol) {
      case 'name': return dir * (a.name || '').localeCompare(b.name || '')
      case 'points': return dir * ((a.points ?? 0) - (b.points ?? 0))
      case 'groups': return dir * (a.permission_groups || '').localeCompare(b.permission_groups || '')
      case 'timed': return dir * (a.timed_permission_groups || '').localeCompare(b.timed_permission_groups || '')
      case 'tribe': return dir * (a.tribe_name || '').localeCompare(b.tribe_name || '')
      case 'login':
        const ta = a.last_login ? new Date(a.last_login).getTime() : 0
        const tb = b.last_login ? new Date(b.last_login).getTime() : 0
        return dir * (ta - tb)
      default: return 0
    }
  })

  return (
    <div className="pl-page">
      {/* Header */}
      <div className="pl-header">
        <div>
          <h1 className="pl-title"><Users size={24} /> {t('players.heading')}</h1>
          <p className="pl-subtitle">
            {t('players.subtitle')}
            {stats && <span className="pl-count">{t('players.registeredCount', { count: stats.total_players })}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            onClick={handleSyncTribes}
            disabled={syncing || syncingTribes}
            className="btn btn-secondary btn-sm"
            title={t('players.tribeSync.title')}
          >
            {syncingTribes
              ? <><Loader2 size={14} className="pl-spin" /> {t('players.tribeSync.running')}</>
              : <><Download size={14} /> {t('players.tribeSync.button')}</>}
          </button>
          <button onClick={() => setShowSyncPanel(!showSyncPanel)} disabled={syncing || syncingTribes} className="btn btn-primary btn-sm" title={t('players.syncNamesTitle')}>
            {syncing ? <><Loader2 size={14} className="pl-spin" /> {t('players.syncing')}</> : <><Download size={14} /> {t('players.syncNamesButton')}</>}
          </button>
          <button onClick={() => { loadPlayers(); loadStats() }} className="pl-btn-icon" title={t('players.refreshTooltip')}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Sync panel */}
      {showSyncPanel && (
        <div className="pl-sync-panel">
          <div className="pl-sync-header">
            <span className="pl-sync-title"><Download size={14} /> {t('players.syncPanel.title')}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button onClick={() => handleSyncNames()} disabled={syncing} className="btn btn-sm btn-primary">
                {syncing ? <Loader2 size={12} className="pl-spin" /> : <Download size={12} />} {t('players.syncPanel.allButton')}
              </button>
              <button onClick={() => setShowSyncPanel(false)} className="pl-btn-icon" style={{ width: 22, height: 22 }}><X size={12} /></button>
            </div>
          </div>
          <div className="pl-sync-body">
            {syncContainers.length > 0 ? (
              <table className="pl-sync-table">
                <thead>
                  <tr>
                    <th>{t('players.syncPanel.columns.container')}</th>
                    <th>{t('players.syncPanel.columns.server')}</th>
                    <th>{t('players.syncPanel.columns.map')}</th>
                    <th>{t('players.syncPanel.columns.host')}</th>
                    <th style={{ textAlign: 'right' }}>{t('players.syncPanel.columns.profiles')}</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {syncContainers.map((c, i) => (
                    <tr key={i}>
                      <td><span className="pl-sync-mono">{c.container_name}</span></td>
                      <td>{c.server_name || '—'}</td>
                      <td>{c.map_name || '—'}</td>
                      <td><span className="pl-sync-mono">{c.machine_name}</span></td>
                      <td style={{ textAlign: 'right' }}><strong>{c.profile_count || 0}</strong></td>
                      <td>
                        <button onClick={() => handleSyncNames(c.machine_id, c.container_name)} disabled={syncing}
                          className="btn btn-sm btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                          {syncing ? <Loader2 size={11} className="pl-spin" /> : <Download size={11} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{t('players.syncPanel.empty')}</p>
            )}
          </div>
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className={`pl-alert ${syncResult.updated > 0 ? 'pl-alert-ok' : 'pl-alert-warn'}`} style={{ marginBottom: '0.5rem' }}>
          <UserCheck size={14} />
          <span>
            {t('players.syncResult.scanned', { count: syncResult.total_profiles_scanned })} &middot;
            {t('players.syncResult.matched', { count: syncResult.matched })} &middot;
            <strong>{t('players.syncResult.updated', { count: syncResult.updated })}</strong>
            {syncResult.errors?.length > 0 && <> &middot; {t('players.syncResult.errors', { count: syncResult.errors.length })}</>}
            {syncResult.not_matched_total > 0 && <> &middot; {t('players.syncResult.noMatch', { count: syncResult.not_matched_total })}</>}
          </span>
          <button onClick={() => setSyncResult(null)} className="pl-alert-x"><X size={14}/></button>
        </div>
      )}

      {/* Messaggi */}
      {error && <div className="pl-alert pl-alert-err"><X size={14} /> {error}<button onClick={() => setError('')} className="pl-alert-x"><X size={14}/></button></div>}
      {success && <div className="pl-alert pl-alert-ok"><UserCheck size={14} /> {success}</div>}

      {/* Stats */}
      {stats && (
        <div className="pl-stats">
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-blue"><Users size={18} /></div>
            <div><p className="pl-stat-val">{stats.total_players}</p><p className="pl-stat-lbl">{t('players.stats.players')}</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-gold"><Star size={18} /></div>
            <div><p className="pl-stat-val">{stats.total_points_in_circulation.toLocaleString(undefined)}</p><p className="pl-stat-lbl">{t('players.stats.pointsInCirculation')}</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-purple"><CreditCard size={18} /></div>
            <div><p className="pl-stat-val">{stats.total_spent.toLocaleString(undefined)}</p><p className="pl-stat-lbl">{t('players.stats.totalSpent')}</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-green"><Shield size={18} /></div>
            <div><p className="pl-stat-val">{stats.permission_groups_count}</p><p className="pl-stat-lbl">{t('players.stats.groups')}</p></div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="pl-search">
        <div className="pl-search-input-wrap">
          <Search size={16} className="pl-search-icon" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleKeyDown}
            className="pl-search-input" placeholder={t('players.searchPlaceholder')} />
        </div>
        <div className="pl-search-filter-wrap">
          <Filter size={14} className="pl-search-filter-icon" />
          <select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); loadPlayers(search, e.target.value) }} className="pl-search-filter">
            <option value="">{t('players.allGroups')}</option>
            {groups.map(g => <option key={g.id} value={g.group_name}>{g.group_name}</option>)}
          </select>
        </div>
        <button onClick={handleSearch} className="pl-btn-search">{t('players.searchButton')}</button>
      </div>

      {/* Layout: Table + Detail side panel */}
      <div className={`pl-layout ${selectedPlayer ? 'pl-layout-split' : ''}`}>

        {/* Table */}
        {/* ── Selection strip ───────────────────────────────────────────
            Visible only while at least one player is selected.  Holds
            JUST a counter + 'Configure' button + 'Clear'; the actual
            group / duration form lives in a popup modal so this strip
            stays one line on every screen size. */}
        {selectedIds.size > 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.55rem 0.85rem', marginBottom: '0.5rem',
              background: 'var(--accent-glow)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius)',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
              {t('players.bulkPerm.selectedCount', { count: selectedIds.size })}
            </span>
            <button
              onClick={openBulkModal}
              className="btn btn-primary btn-sm"
              style={{ marginLeft: 'auto' }}
            >
              <Clock size={12} /> {t('players.bulkPerm.openModal')}
            </button>
            <button
              onClick={clearSelection}
              className="btn btn-ghost btn-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              <X size={12} /> {t('players.bulkPerm.clear')}
            </button>
          </div>
        )}

        <div className="pl-table-wrap" style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> {t('players.loading')}</div>
          ) : players.length === 0 ? (
            <div className="pl-empty"><Users size={32} /><p>{t('players.empty')}</p></div>
          ) : (
            <table className="pl-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: '32px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t('players.bulkPerm.selectAllAria')}
                      checked={
                        sortedPlayers.length > 0 &&
                        sortedPlayers.every(p => selectedIds.has(p.id))
                      }
                      ref={el => {
                        // Indeterminate when SOME but not all are selected.
                        if (el) el.indeterminate =
                          sortedPlayers.some(p => selectedIds.has(p.id)) &&
                          !sortedPlayers.every(p => selectedIds.has(p.id))
                      }}
                      onChange={() => toggleSelectAll(sortedPlayers.map(p => p.id))}
                    />
                  </th>
                  <th className="pl-th-sort" onClick={() => toggleSort('name')} style={{width:'18%'}}>{t('players.table.player')} <SortIcon col="name" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('tribe')} style={{width:'14%'}}>{t('players.table.tribe')} <SortIcon col="tribe" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('points')} style={{width:'8%'}}>{t('players.table.points')} <SortIcon col="points" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('groups')} style={{width:'20%'}}>{t('players.table.groups')} <SortIcon col="groups" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('timed')} style={{width:'16%'}}>{t('players.table.timed')} <SortIcon col="timed" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('login')} style={{width:'14%'}}>{t('players.table.login')} <SortIcon col="login" /></th>
                  <th style={{width: '24px'}}></th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map(p => {
                  const timedGroups = (p.timed_permission_groups || '').split(',').filter(Boolean).map(entry => {
                    const parts = entry.split(';')
                    const ts = parseInt(parts[1]) || 0
                    const group = parts[2] || ''
                    const expired = ts > 0 && ts < Date.now() / 1000
                    return { group, ts, expired }
                  }).filter(e => e.group)
                  return (
                  <tr key={p.id} onClick={() => openDetail(p.id)}
                    className={selectedPlayer?.id === p.id ? 'pl-row-active' : ''}>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={t('players.bulkPerm.selectRowAria', { name: p.name || '?' })}
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                      />
                    </td>
                    <td>
                      <div className="pl-cell-player">
                        <div className="pl-avatar">{(p.name || '?')[0].toUpperCase()}</div>
                        <span className="pl-cell-name">{p.name || t('players.unknownPlayer')}</span>
                      </div>
                    </td>
                    <td>
                      {p.tribe_name ? (
                        <span className="pl-cell-tribe"><Home size={11} /> {p.tribe_name}</span>
                      ) : (
                        <span className="pl-cell-tribe" style={{ fontStyle: 'italic', opacity: 0.5 }}><Home size={11} /> {t('players.unknownTribe')}</span>
                      )}
                    </td>
                    <td><span className="pl-cell-points"><Star size={12} /> {p.points?.toLocaleString(undefined) ?? '--'}</span></td>
                    <td>
                      <div className="pl-cell-groups">
                        {(p.permission_groups || '').split(',').filter(Boolean).map(g => (
                          <span key={g} className="pl-chip">{g}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="pl-cell-groups">
                        {timedGroups.map((tg, i) => (
                          <span key={i} className={`pl-chip pl-chip-timed ${tg.expired ? 'pl-chip-expired' : ''}`}
                            title={tg.ts ? (tg.expired ? t('players.chipTimed.expired') : t('players.chipTimed.expiresOn', { date: new Date(tg.ts * 1000).toLocaleDateString(undefined) })) : ''}>
                            <Clock size={9} /> {tg.group}
                          </span>
                        ))}
                        {timedGroups.length === 0 && <span className="pl-cell-muted">—</span>}
                      </div>
                    </td>
                    <td>
                      <span className="pl-cell-date"><Calendar size={10} /> {fmtDate(p.last_login)}{fmtLoginAgo(p.last_login) && <span style={{ opacity: 0.5, marginLeft: 4 }}>{fmtLoginAgo(p.last_login)}</span>}</span>
                    </td>
                    <td><ChevronRight size={14} className="pl-chevron" /></td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selectedPlayer && (
          <div className="pl-detail">
            <div className="pl-detail-header">
              <div className="pl-detail-avatar">{(selectedPlayer.name || '?')[0].toUpperCase()}</div>
              <div className="pl-detail-info">
                <h3 className="pl-detail-name">{selectedPlayer.name || t('players.unknownPlayer')}</h3>
                <p className="pl-detail-eos">{selectedPlayer.eos_id}</p>
              </div>
              <button onClick={() => setShowBanDialog(true)} className="pl-btn-icon" title={t('players.detail.banTooltip')} style={{ color: 'var(--danger)' }}><ShieldOff size={16} /></button>
              <button onClick={() => setSelectedPlayer(null)} className="pl-btn-icon"><X size={16} /></button>
            </div>

            {/* Meta */}
            <div className="pl-detail-meta">
              {selectedPlayer.tribe_name && <div className="pl-meta-item"><Home size={13} /><span>{selectedPlayer.tribe_name}</span></div>}
              <div className="pl-meta-item"><Calendar size={13} /><span>{fmtDateTime(selectedPlayer.last_login)}</span></div>
              <div className="pl-meta-item"><CreditCard size={13} /><span>{t('players.detail.spentLabel')} {selectedPlayer.total_spent?.toLocaleString() ?? '0'}</span></div>
            </div>

            {/* Ban Dialog */}
            {showBanDialog && (
              <div className="pl-section" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.75rem' }}>
                <h4 className="pl-section-title" style={{ color: 'var(--danger)' }}><ShieldOff size={14} /> {t('players.ban.sectionTitle')}</h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}
                   dangerouslySetInnerHTML={{ __html: t('players.ban.intro', { name: selectedPlayer.name || selectedPlayer.eos_id }) }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>{t('players.ban.reasonLabel')}</label>
                    <input type="text" value={banReason} onChange={e => setBanReason(e.target.value)}
                      className="pl-points-input" style={{ width: '100%' }} placeholder={t('players.ban.reasonPlaceholder')} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>{t('players.ban.durationLabel')}</label>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {([
                        ['permanent', t('players.ban.permanent')],
                        ['1d', t('players.ban.oneDay')],
                        ['3d', t('players.ban.threeDays')],
                        ['7d', t('players.ban.sevenDays')],
                        ['30d', t('players.ban.thirtyDays')],
                      ] as const).map(([val, label]) => (
                        <button key={val} onClick={() => setBanDuration(val as typeof banDuration)}
                          style={{
                            padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                            border: banDuration === val ? '2px solid var(--danger)' : '1px solid var(--border)',
                            background: banDuration === val ? 'rgba(239,68,68,0.1)' : 'transparent',
                            color: banDuration === val ? 'var(--danger)' : 'var(--text-secondary)',
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <button onClick={handleBanPlayer} disabled={banning}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                        padding: '0.45rem', borderRadius: 7, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                        background: 'var(--danger)', color: '#fff', border: 'none',
                        opacity: banning ? 0.6 : 1,
                      }}>
                      {banning ? <><Loader2 size={14} className="pl-spin" /> {t('players.ban.banning')}</> : <><ShieldOff size={14} /> {t('players.ban.confirmBan')}</>}
                    </button>
                    <button onClick={() => setShowBanDialog(false)}
                      style={{
                        padding: '0.45rem 0.75rem', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
                      }}>
                      {t('players.ban.cancel')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Points */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Star size={14} /> {t('players.points.sectionTitle')}</h4>
              <div className="pl-points-current">{selectedPlayer.points?.toLocaleString(undefined) ?? 0}</div>
              <div className="pl-points-controls">
                <input type="number" value={pointsInput} onChange={e => setPointsInput(e.target.value)}
                  className="pl-points-input" min={0} />
                <button onClick={handleSetPoints} disabled={pointsSaving} className="pl-btn-sm pl-btn-primary">
                  <Save size={12} /> {t('players.points.setButton')}
                </button>
              </div>
              <div className="pl-points-quick">
                {[100, 500, 1000].map(n => (
                  <button key={n} onClick={() => handleAddPoints(n)} disabled={pointsSaving} className="pl-btn-sm pl-btn-ghost-green">
                    <Plus size={11} />{n}
                  </button>
                ))}
                <button onClick={() => handleAddPoints(-100)} disabled={pointsSaving} className="pl-btn-sm pl-btn-ghost-red">
                  <Minus size={11} />100
                </button>
              </div>
            </div>

            {/* Permessi Fissi */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Shield size={14} /> {t('players.perms.sectionTitle')}</h4>
              <div className="pl-perm-chips">
                {groups.map(g => {
                  const active = permInput.includes(g.group_name)
                  return (
                    <button key={g.id} className={`pl-perm-chip ${active ? 'pl-perm-active' : ''}`}
                      onClick={() => {
                        if (active) setPermInput(permInput.replace(g.group_name + ',', '').replace(g.group_name, ''))
                        else setPermInput((permInput.endsWith(',') ? permInput : permInput + ',') + g.group_name + ',')
                      }}>
                      {active && <UserCheck size={11} />} {g.group_name}
                    </button>
                  )
                })}
              </div>
              <button onClick={handleSavePermissions} className="pl-btn-sm pl-btn-primary pl-btn-full"><Save size={12} /> {t('players.perms.save')}</button>
            </div>

            {/* Permessi Temporanei */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Clock size={14} /> {t('players.perms.timedSectionTitle')}</h4>
              {timedPerms.length > 0 ? (
                <div className="pl-timed-list">
                  {timedPerms.map((tp, i) => {
                    const exp = tp.timestamp ? new Date(tp.timestamp * 1000) : null
                    const expired = exp ? exp < new Date() : false
                    return (
                      <div key={i} className={`pl-timed-item ${expired ? 'pl-timed-expired' : ''}`}>
                        <div className="pl-timed-top">
                          <span className="pl-timed-group">{tp.group}</span>
                          <span className={expired ? 'pl-timed-badge-exp' : 'pl-timed-badge-act'}>
                            {expired ? t('players.perms.expired') : t('players.perms.active')}
                          </span>
                        </div>
                        <div className="pl-timed-fields">
                          <div className="pl-timed-field">
                            <label>{t('players.perms.flagLabel')}</label>
                            <input type="text" value={tp.flag} onChange={e => handleTimedPermChange(i, 'flag', e.target.value)} />
                          </div>
                          <div className="pl-timed-field pl-timed-field-grow">
                            <label>{t('players.perms.expiresLabel')}</label>
                            <input type="datetime-local" value={tsToInput(tp.timestamp)}
                              onChange={e => handleTimedPermChange(i, 'timestamp', inputToTs(e.target.value))} />
                          </div>
                        </div>
                        <div className="pl-timed-actions">
                          <button onClick={() => handleTimedPermChange(i, 'timestamp', tp.timestamp + 7*24*3600)}
                            className="pl-btn-xs pl-btn-extend">+7d</button>
                          <button onClick={() => handleTimedPermChange(i, 'timestamp', tp.timestamp + 30*24*3600)}
                            className="pl-btn-xs pl-btn-extend">+1m</button>
                          <button onClick={() => handleTimedPermChange(i, 'timestamp', tp.timestamp + 90*24*3600)}
                            className="pl-btn-xs pl-btn-extend">+3m</button>
                          <button onClick={() => handleTimedPermChange(i, 'timestamp', tp.timestamp + 365*24*3600)}
                            className="pl-btn-xs pl-btn-extend">+12m</button>
                          <button onClick={() => setTimedPerms(prev => prev.filter((_, idx) => idx !== i))}
                            className="pl-btn-xs pl-btn-del"><X size={11} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="pl-empty-text">{t('players.perms.emptyTimed')}</p>}

              <div className="pl-timed-add-row">
                {groups.filter(g => !timedPerms.some(tp => tp.group === g.group_name)).map(g => (
                  <button key={g.id} className="pl-btn-xs pl-btn-add"
                    onClick={() => setTimedPerms(prev => [...prev, { flag: '0', timestamp: Math.floor(Date.now()/1000) + 30*24*3600, group: g.group_name }])}>
                    <Plus size={10} /> {g.group_name}
                  </button>
                ))}
              </div>
              <button onClick={handleSaveTimedPermissions} className="pl-btn-sm pl-btn-primary pl-btn-full"><Save size={12} /> {t('players.perms.saveTimed')}</button>
            </div>

            {/* Kits */}
            {selectedPlayer.kits && selectedPlayer.kits !== '{}' && (
              <div className="pl-section">
                <h4 className="pl-section-title"><Skull size={14} /> {t('players.kits.sectionTitle')}</h4>
                <pre className="pl-kits-pre">{selectedPlayer.kits}</pre>
              </div>
            )}

            {/* Mappe & Copia personaggio */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Map size={14} /> {t('players.maps.sectionTitle')}</h4>
              <button onClick={handleFindMaps} disabled={mapsLoading} className="pl-btn-sm pl-btn-primary pl-btn-full" style={{ marginBottom: '0.5rem' }}>
                {mapsLoading ? <><Loader2 size={12} className="pl-spin" /> {t('players.maps.searching')}</> : <><Map size={12} /> {t('players.maps.searchButton')}</>}
              </button>

              {mapsSearched && playerMaps.length === 0 && (
                <>
                  <p className="pl-empty-text">{t('players.maps.notFound')}</p>
                  {mapsDebug.length > 0 && (
                    <details style={{ marginBottom: '0.5rem' }}>
                      <summary style={{ fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '0.3rem' }}>{t('players.maps.debugInfo', { count: mapsDebug.length })}</summary>
                      <pre style={{
                        fontSize: '0.65rem', background: '#0f172a', color: '#e2e8f0',
                        padding: '0.5rem', borderRadius: '6px', maxHeight: '250px',
                        overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                      }}>{JSON.stringify(mapsDebug, null, 2)}</pre>
                    </details>
                  )}
                </>
              )}

              {mapsErrors.length > 0 && (
                <div style={{ marginBottom: '0.4rem' }}>
                  {mapsErrors.map((e, i) => (
                    <div key={i} className="pl-alert pl-alert-err" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem', marginBottom: '2px' }}>
                      <AlertCircle size={11} /> {e}
                    </div>
                  ))}
                </div>
              )}

              {playerMaps.length > 0 && (
                <div className="pl-maps-list">
                  {playerMaps.map((m, i) => (
                    <div key={i} className={`pl-map-item ${copySource?.profile_path === m.profile_path ? 'pl-map-selected' : ''}`}>
                      <div className="pl-map-info">
                        <span className="pl-map-name"><Map size={11} /> {m.map_name}</span>
                        <span className="pl-map-detail">{m.container_name} &middot; {m.machine_name}</span>
                        {m.player_name && <span className="pl-map-detail">{t('players.maps.nameLabel')} {m.player_name}</span>}
                      </div>
                      <button
                        onClick={() => setCopySource(copySource?.profile_path === m.profile_path ? null : m)}
                        className={`pl-btn-xs ${copySource?.profile_path === m.profile_path ? 'pl-btn-del' : 'pl-btn-add'}`}
                        title={copySource?.profile_path === m.profile_path ? t('players.maps.sourceTooltipDeselect') : t('players.maps.sourceTooltipSelect')}
                      >
                        {copySource?.profile_path === m.profile_path ? <X size={10} /> : <Copy size={10} />}
                        {copySource?.profile_path === m.profile_path ? t('players.maps.sourceCancelLabel') : t('players.maps.sourceSelectLabel')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Pannello copia */}
              {copySource && (
                <div className="pl-copy-panel">
                  <p className="pl-copy-from">
                    <Copy size={11} /> {t('players.copy.fromLabel')} <strong>{copySource.map_name}</strong> ({copySource.container_name})
                  </p>
                  <div className="pl-copy-fields">
                    <div className="pl-copy-field">
                      <label>{t('players.copy.destContainerLabel')}</label>
                      <select value={copyDestContainer} onChange={e => {
                        setCopyDestContainer(e.target.value)
                        const maps = getDestMaps(e.target.value)
                        setCopyDestMap(maps.length === 1 ? maps[0] : '')
                      }}>
                        <option value="">{t('players.copy.selectPlaceholder')}</option>
                        {syncContainers
                          .filter(c => !(c.container_name === copySource.container_name && c.map_name === copySource.map_name))
                          .map((c, i) => (
                            <option key={i} value={c.container_name}>
                              {c.container_name} — {c.map_name || c.server_name || '?'}
                            </option>
                          ))}
                      </select>
                    </div>
                    {copyDestContainer && (
                      <div className="pl-copy-field">
                        <label>{t('players.copy.destMapLabel')}</label>
                        <input type="text" value={copyDestMap} onChange={e => setCopyDestMap(e.target.value)}
                          placeholder={t('players.copy.destMapPlaceholder')} />
                      </div>
                    )}
                  </div>
                  <button onClick={handleCopyCharacter} disabled={copying || !copyDestContainer || !copyDestMap}
                    className="pl-btn-sm pl-btn-primary pl-btn-full">
                    {copying ? <><Loader2 size={12} className="pl-spin" /> {t('players.copy.copying')}</> : <><Copy size={12} /> {t('players.copy.copyButton')}</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk timed-permission modal ─────────────────────────────────
          Opens when the operator clicks "Configure" on the selection
          strip.  Picks ONE group + ONE duration shortcut (or a custom
          number of days), then POSTs to /players/bulk-add-timed-perm.
          Backend semantics: existing entries get extended by the chosen
          delta, missing ones get inserted with `now + delta`. */}
      {bulkModalOpen && (
        <div
          onClick={() => setBulkModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card"
            style={{ width: 480, maxWidth: '92vw', padding: '1.25rem' }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={16} /> {t('players.bulkPerm.modalTitle', { count: selectedIds.size })}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {t('players.bulkPerm.modalHint')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <label className="form-label" style={{ fontSize: '0.78rem' }}>
                  {t('players.bulkPerm.groupLabel')}
                </label>
                <select
                  value={bulkGroup}
                  onChange={e => setBulkGroup(e.target.value)}
                  className="form-input"
                  autoFocus
                >
                  <option value="">{t('players.bulkPerm.groupPlaceholder')}</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.group_name}>{g.group_name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <label className="form-label" style={{ fontSize: '0.78rem' }}>
                  {t('players.bulkPerm.durationLabel')}
                </label>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {[
                    { label: '+7d',  s: 7   * 24 * 3600 },
                    { label: '+1m',  s: 30  * 24 * 3600 },
                    { label: '+3m',  s: 90  * 24 * 3600 },
                    { label: '+12m', s: 365 * 24 * 3600 },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => setBulkDurationSeconds(opt.s)}
                      className={`btn btn-sm ${bulkDurationSeconds === opt.s ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {t('players.bulkPerm.customDaysLabel')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={Math.round(bulkDurationSeconds / (24 * 3600))}
                    onChange={e => {
                      const days = Math.max(1, Math.min(3650, parseInt(e.target.value, 10) || 1))
                      setBulkDurationSeconds(days * 24 * 3600)
                    }}
                    className="form-input"
                    style={{ width: 80, padding: '0.25rem 0.4rem', fontSize: '0.82rem' }}
                  />
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {t('players.bulkPerm.customDaysSuffix')}
                  </span>
                </div>
              </div>

              <div style={{
                fontSize: '0.74rem', color: 'var(--text-muted)',
                padding: '0.5rem 0.65rem', background: 'var(--bg-card-muted)',
                borderRadius: 'var(--radius)', lineHeight: 1.45,
              }}>
                {t('players.bulkPerm.semanticsHint')}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                onClick={() => setBulkModalOpen(false)}
                disabled={bulkApplying}
                className="btn btn-ghost btn-sm"
                style={{ borderColor: 'var(--border)' }}
              >
                {t('players.bulkPerm.cancel')}
              </button>
              <button
                onClick={handleBulkApply}
                disabled={bulkApplying || !bulkGroup}
                className="btn btn-primary btn-sm"
              >
                {bulkApplying
                  ? <><Loader2 size={12} className="pl-spin" /> {t('players.bulkPerm.applying')}</>
                  : <><Save size={12} /> {t('players.bulkPerm.apply', { count: selectedIds.size })}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
