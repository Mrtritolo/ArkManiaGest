/**
 * PlayersPage — ARK player management.
 * Modern design with Lucide icons, solid table, inline detail view.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Search, Users, Star, Shield, ChevronRight, X, Plus, Minus,
  Clock, UserCheck, Skull, Home, Calendar, CreditCard, Save,
  RefreshCw, Filter, Loader2, Download, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown,
  Map, Copy, CheckCircle, ShieldOff
} from 'lucide-react'
import { playersApi, arkBansApi } from '../services/api'
import type { PlayerListItem, PlayerFull, PlayersStats, PermissionGroupItem, PlayerMapResult } from '../types'

export default function PlayersPage() {
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
  const [banReason, setBanReason] = useState('Violation of server rules')
  const [banDuration, setBanDuration] = useState<'permanent' | '1d' | '3d' | '7d' | '30d'>('permanent')
  const [banning, setBanning] = useState(false)

  useEffect(() => { loadPlayers(); loadGroups(); loadStats(); loadSyncContainers() }, [])

  async function loadSyncContainers() {
    try {
      const res = await playersApi.syncContainers()
      setSyncContainers(res.data.containers || [])
    } catch {}
  }
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t) } }, [success])

  const loadPlayers = useCallback(async (s?: string, g?: string) => {
    setLoading(true)
    try {
      const res = await playersApi.list({ search: (s ?? search) || undefined, group: (g ?? groupFilter) || undefined, limit: 100 })
      setPlayers(res.data)
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore caricamento. Verifica connessione DB.') }
    finally { setLoading(false) }
  }, [search, groupFilter])

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
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore dettaglio') }
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
      setError(err.response?.data?.detail || 'Errore ricerca mappe')
    } finally { setMapsLoading(false) }
  }

  async function handleCopyCharacter() {
    if (!copySource || !copyDestContainer || !copyDestMap) return
    setCopying(true); setError('')
    // Find destination machine_id from syncContainers
    const destC = syncContainers.find((c: Record<string, unknown>) => c.container_name === copyDestContainer)
    if (!destC) { setError('Destination container not found'); setCopying(false); return }
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
        setSuccess(`Personaggio copiato in ${copyDestMap}${res.data.overwritten ? ' (sovrascritto, backup creato)' : ''}`)
        setCopySource(null); setCopyDestContainer(''); setCopyDestMap('')
        handleFindMaps() // Reload maps
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore copia personaggio')
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
    if (isNaN(val) || val < 0) { setError('Valore punti non valido'); return }
    setPointsSaving(true)
    try {
      await playersApi.setPoints(selectedPlayer.id, val)
      setSuccess(`Punti impostati a ${val}`)
      setSelectedPlayer({ ...selectedPlayer, points: val }); loadPlayers(); loadStats()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
    finally { setPointsSaving(false) }
  }

  async function handleAddPoints(amount: number) {
    if (!selectedPlayer) return
    setPointsSaving(true)
    try {
      const res = await playersApi.addPoints(selectedPlayer.id, amount)
      setSuccess(`${amount > 0 ? '+' : ''}${amount} punti (totale: ${res.data.points})`)
      setSelectedPlayer({ ...selectedPlayer, points: res.data.points })
      setPointsInput(String(res.data.points)); loadPlayers(); loadStats()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
    finally { setPointsSaving(false) }
  }

  async function handleSavePermissions() {
    if (!selectedPlayer) return
    try {
      await playersApi.update(selectedPlayer.id, { permission_groups: permInput })
      setSuccess('Permessi fissi aggiornati')
      setSelectedPlayer({ ...selectedPlayer, permission_groups: permInput }); loadPlayers()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
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
      setSuccess('Permessi temporanei aggiornati')
      setSelectedPlayer({ ...selectedPlayer, timed_permission_groups: s }); loadPlayers()
    } catch (err: any) { setError(err.response?.data?.detail || 'Errore') }
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
        reason: banReason || 'No reason specified',
        banned_by: 'Admin',
        expire_time: expireTime,
      })
      setSuccess(`Player ${selectedPlayer.name || selectedPlayer.eos_id} banned${banDuration === 'permanent' ? ' permanently' : ` for ${banDuration}`}`)
      setShowBanDialog(false)
      setBanReason('Violation of server rules')
      setBanDuration('permanent')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Ban failed')
    } finally { setBanning(false) }
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
        setError('Errori durante sync: ' + res.data.errors.join('; '))
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore sincronizzazione nomi')
    } finally { setSyncing(false) }
  }

  function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '--' }
  function fmtLoginAgo(d: string | null) {
    if (!d) return null
    const now = Date.now(), t = new Date(d).getTime(), diff = now - t
    const mins = Math.floor(diff / 60000), hrs = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000)
    if (mins < 60) return `${mins}m fa`
    if (hrs < 24) return `${hrs}h fa`
    if (days < 30) return `${days}g fa`
    return `${Math.floor(days / 30)}M fa`
  }
  function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleString('it-IT') : '--' }

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
          <h1 className="pl-title"><Users size={24} /> Giocatori</h1>
          <p className="pl-subtitle">
            Gestione giocatori, punti shop e permessi
            {stats && <span className="pl-count">{stats.total_players} registrati</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button onClick={() => setShowSyncPanel(!showSyncPanel)} disabled={syncing} className="btn btn-primary btn-sm" title="Sincronizza nomi da .arkprofile">
            {syncing ? <><Loader2 size={14} className="pl-spin" /> Sync nomi...</> : <><Download size={14} /> Sync Nomi</>}
          </button>
          <button onClick={() => { loadPlayers(); loadStats() }} className="pl-btn-icon" title="Aggiorna">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Sync panel */}
      {showSyncPanel && (
        <div className="pl-sync-panel">
          <div className="pl-sync-header">
            <span className="pl-sync-title"><Download size={14} /> Sync Nomi da .arkprofile</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button onClick={() => handleSyncNames()} disabled={syncing} className="btn btn-sm btn-primary">
                {syncing ? <Loader2 size={12} className="pl-spin" /> : <Download size={12} />} Tutti
              </button>
              <button onClick={() => setShowSyncPanel(false)} className="pl-btn-icon" style={{ width: 22, height: 22 }}><X size={12} /></button>
            </div>
          </div>
          <div className="pl-sync-body">
            {syncContainers.length > 0 ? (
              <table className="pl-sync-table">
                <thead>
                  <tr>
                    <th>Container</th>
                    <th>Server</th>
                    <th>Mappa</th>
                    <th>Host</th>
                    <th style={{ textAlign: 'right' }}>Profili</th>
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
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>Nessun container con SavedArks trovato. Esegui prima una scansione dalla pagina Container.</p>
            )}
          </div>
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className={`pl-alert ${syncResult.updated > 0 ? 'pl-alert-ok' : 'pl-alert-warn'}`} style={{ marginBottom: '0.5rem' }}>
          <UserCheck size={14} />
          <span>
            Scansionati {syncResult.total_profiles_scanned} profili &middot;
            {syncResult.matched} match &middot;
            <strong>{syncResult.updated} aggiornati</strong>
            {syncResult.errors?.length > 0 && <> &middot; {syncResult.errors.length} errori</>}
            {syncResult.not_matched_total > 0 && <> &middot; {syncResult.not_matched_total} senza match</>}
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
            <div><p className="pl-stat-val">{stats.total_players}</p><p className="pl-stat-lbl">Giocatori</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-gold"><Star size={18} /></div>
            <div><p className="pl-stat-val">{stats.total_points_in_circulation.toLocaleString('it-IT')}</p><p className="pl-stat-lbl">Punti in circolo</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-purple"><CreditCard size={18} /></div>
            <div><p className="pl-stat-val">{stats.total_spent.toLocaleString('it-IT')}</p><p className="pl-stat-lbl">Totale spesi</p></div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-icon pl-stat-icon-green"><Shield size={18} /></div>
            <div><p className="pl-stat-val">{stats.permission_groups_count}</p><p className="pl-stat-lbl">Gruppi</p></div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="pl-search">
        <div className="pl-search-input-wrap">
          <Search size={16} className="pl-search-icon" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleKeyDown}
            className="pl-search-input" placeholder="Cerca per nome, EOS ID..." />
        </div>
        <div className="pl-search-filter-wrap">
          <Filter size={14} className="pl-search-filter-icon" />
          <select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); loadPlayers(search, e.target.value) }} className="pl-search-filter">
            <option value="">Tutti i gruppi</option>
            {groups.map(g => <option key={g.id} value={g.group_name}>{g.group_name}</option>)}
          </select>
        </div>
        <button onClick={handleSearch} className="pl-btn-search">Cerca</button>
      </div>

      {/* Layout: Table + Detail side panel */}
      <div className={`pl-layout ${selectedPlayer ? 'pl-layout-split' : ''}`}>

        {/* Table */}
        <div className="pl-table-wrap" style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="pl-loading"><Loader2 size={20} className="pl-spin" /> Caricamento...</div>
          ) : players.length === 0 ? (
            <div className="pl-empty"><Users size={32} /><p>Nessun giocatore trovato</p></div>
          ) : (
            <table className="pl-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th className="pl-th-sort" onClick={() => toggleSort('name')} style={{width:'18%'}}>Giocatore <SortIcon col="name" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('tribe')} style={{width:'14%'}}>Tribù <SortIcon col="tribe" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('points')} style={{width:'8%'}}>Punti <SortIcon col="points" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('groups')} style={{width:'20%'}}>Gruppi <SortIcon col="groups" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('timed')} style={{width:'16%'}}>Temp. <SortIcon col="timed" /></th>
                  <th className="pl-th-sort" onClick={() => toggleSort('login')} style={{width:'14%'}}>Login <SortIcon col="login" /></th>
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
                    <td>
                      <div className="pl-cell-player">
                        <div className="pl-avatar">{(p.name || '?')[0].toUpperCase()}</div>
                        <span className="pl-cell-name">{p.name || 'Sconosciuto'}</span>
                      </div>
                    </td>
                    <td>
                      {p.tribe_name ? (
                        <span className="pl-cell-tribe"><Home size={11} /> {p.tribe_name}</span>
                      ) : (
                        <span className="pl-cell-tribe" style={{ fontStyle: 'italic', opacity: 0.5 }}><Home size={11} /> Non Identificata</span>
                      )}
                    </td>
                    <td><span className="pl-cell-points"><Star size={12} /> {p.points?.toLocaleString('it-IT') ?? '--'}</span></td>
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
                            title={tg.ts ? (tg.expired ? 'Scaduto' : `Scade: ${new Date(tg.ts * 1000).toLocaleDateString('it-IT')}`) : ''}>
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
                <h3 className="pl-detail-name">{selectedPlayer.name || 'Sconosciuto'}</h3>
                <p className="pl-detail-eos">{selectedPlayer.eos_id}</p>
              </div>
              <button onClick={() => setShowBanDialog(true)} className="pl-btn-icon" title="Ban player" style={{ color: 'var(--danger)' }}><ShieldOff size={16} /></button>
              <button onClick={() => setSelectedPlayer(null)} className="pl-btn-icon"><X size={16} /></button>
            </div>

            {/* Meta */}
            <div className="pl-detail-meta">
              {selectedPlayer.tribe_name && <div className="pl-meta-item"><Home size={13} /><span>{selectedPlayer.tribe_name}</span></div>}
              <div className="pl-meta-item"><Calendar size={13} /><span>{fmtDateTime(selectedPlayer.last_login)}</span></div>
              <div className="pl-meta-item"><CreditCard size={13} /><span>Spent: {selectedPlayer.total_spent?.toLocaleString() ?? '0'}</span></div>
            </div>

            {/* Ban Dialog */}
            {showBanDialog && (
              <div className="pl-section" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.75rem' }}>
                <h4 className="pl-section-title" style={{ color: 'var(--danger)' }}><ShieldOff size={14} /> Ban Player</h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Ban <strong>{selectedPlayer.name || selectedPlayer.eos_id}</strong> from the cluster
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Reason</label>
                    <input type="text" value={banReason} onChange={e => setBanReason(e.target.value)}
                      className="pl-points-input" style={{ width: '100%' }} placeholder="Reason for ban..." />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Duration</label>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {([['permanent', 'Permanent'], ['1d', '1 Day'], ['3d', '3 Days'], ['7d', '7 Days'], ['30d', '30 Days']] as const).map(([val, label]) => (
                        <button key={val} onClick={() => setBanDuration(val)}
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
                      {banning ? <><Loader2 size={14} className="pl-spin" /> Banning...</> : <><ShieldOff size={14} /> Confirm Ban</>}
                    </button>
                    <button onClick={() => setShowBanDialog(false)}
                      style={{
                        padding: '0.45rem 0.75rem', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
                      }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Points */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Star size={14} /> Punti Shop</h4>
              <div className="pl-points-current">{selectedPlayer.points?.toLocaleString('it-IT') ?? 0}</div>
              <div className="pl-points-controls">
                <input type="number" value={pointsInput} onChange={e => setPointsInput(e.target.value)}
                  className="pl-points-input" min={0} />
                <button onClick={handleSetPoints} disabled={pointsSaving} className="pl-btn-sm pl-btn-primary">
                  <Save size={12} /> Imposta
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
              <h4 className="pl-section-title"><Shield size={14} /> Permessi Fissi</h4>
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
              <button onClick={handleSavePermissions} className="pl-btn-sm pl-btn-primary pl-btn-full"><Save size={12} /> Salva Permessi Fissi</button>
            </div>

            {/* Permessi Temporanei */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Clock size={14} /> Permessi Temporanei</h4>
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
                            {expired ? 'Scaduto' : 'Attivo'}
                          </span>
                        </div>
                        <div className="pl-timed-fields">
                          <div className="pl-timed-field">
                            <label>Flag</label>
                            <input type="text" value={tp.flag} onChange={e => handleTimedPermChange(i, 'flag', e.target.value)} />
                          </div>
                          <div className="pl-timed-field pl-timed-field-grow">
                            <label>Scadenza</label>
                            <input type="datetime-local" value={tsToInput(tp.timestamp)}
                              onChange={e => handleTimedPermChange(i, 'timestamp', inputToTs(e.target.value))} />
                          </div>
                        </div>
                        <div className="pl-timed-actions">
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
              ) : <p className="pl-empty-text">Nessun permesso temporaneo</p>}

              <div className="pl-timed-add-row">
                {groups.filter(g => !timedPerms.some(tp => tp.group === g.group_name)).map(g => (
                  <button key={g.id} className="pl-btn-xs pl-btn-add"
                    onClick={() => setTimedPerms(prev => [...prev, { flag: '0', timestamp: Math.floor(Date.now()/1000) + 30*24*3600, group: g.group_name }])}>
                    <Plus size={10} /> {g.group_name}
                  </button>
                ))}
              </div>
              <button onClick={handleSaveTimedPermissions} className="pl-btn-sm pl-btn-primary pl-btn-full"><Save size={12} /> Salva Temporanei</button>
            </div>

            {/* Kits */}
            {selectedPlayer.kits && selectedPlayer.kits !== '{}' && (
              <div className="pl-section">
                <h4 className="pl-section-title"><Skull size={14} /> Kits</h4>
                <pre className="pl-kits-pre">{selectedPlayer.kits}</pre>
              </div>
            )}

            {/* Mappe & Copia personaggio */}
            <div className="pl-section">
              <h4 className="pl-section-title"><Map size={14} /> Mappe Personaggio</h4>
              <button onClick={handleFindMaps} disabled={mapsLoading} className="pl-btn-sm pl-btn-primary pl-btn-full" style={{ marginBottom: '0.5rem' }}>
                {mapsLoading ? <><Loader2 size={12} className="pl-spin" /> Ricerca in corso...</> : <><Map size={12} /> Cerca nelle mappe</>}
              </button>

              {mapsSearched && playerMaps.length === 0 && (
                <>
                  <p className="pl-empty-text">Giocatore non trovato in nessuna mappa</p>
                  {mapsDebug.length > 0 && (
                    <details style={{ marginBottom: '0.5rem' }}>
                      <summary style={{ fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '0.3rem' }}>Debug info ({mapsDebug.length} step)</summary>
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
                        {m.player_name && <span className="pl-map-detail">Nome: {m.player_name}</span>}
                      </div>
                      <button
                        onClick={() => setCopySource(copySource?.profile_path === m.profile_path ? null : m)}
                        className={`pl-btn-xs ${copySource?.profile_path === m.profile_path ? 'pl-btn-del' : 'pl-btn-add'}`}
                        title={copySource?.profile_path === m.profile_path ? 'Deseleziona sorgente' : 'Seleziona come sorgente'}
                      >
                        {copySource?.profile_path === m.profile_path ? <X size={10} /> : <Copy size={10} />}
                        {copySource?.profile_path === m.profile_path ? 'Annulla' : 'Sorgente'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Pannello copia */}
              {copySource && (
                <div className="pl-copy-panel">
                  <p className="pl-copy-from">
                    <Copy size={11} /> Da: <strong>{copySource.map_name}</strong> ({copySource.container_name})
                  </p>
                  <div className="pl-copy-fields">
                    <div className="pl-copy-field">
                      <label>Container destinazione</label>
                      <select value={copyDestContainer} onChange={e => {
                        setCopyDestContainer(e.target.value)
                        const maps = getDestMaps(e.target.value)
                        setCopyDestMap(maps.length === 1 ? maps[0] : '')
                      }}>
                        <option value="">Seleziona...</option>
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
                        <label>Mappa destinazione</label>
                        <input type="text" value={copyDestMap} onChange={e => setCopyDestMap(e.target.value)}
                          placeholder="Es. Aberration_WP" />
                      </div>
                    )}
                  </div>
                  <button onClick={handleCopyCharacter} disabled={copying || !copyDestContainer || !copyDestMap}
                    className="pl-btn-sm pl-btn-primary pl-btn-full">
                    {copying ? <><Loader2 size={12} className="pl-spin" /> Copia in corso...</> : <><Copy size={12} /> Copia Personaggio</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
