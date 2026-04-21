/**
 * ServersPage — CRUD management for ARKM_servers table.
 *
 * Displays all registered ARK game servers in a table with inline editing,
 * status indicators, and creation/deletion capabilities.  Follows the same
 * design patterns as TransferRulesPage and BansPage.
 */
import { useState, useEffect } from 'react'
import { arkmaniaApi } from '../services/api'
import {
  Server, Plus, Trash2, Edit2, Save, X, AlertCircle,
  CheckCircle, RefreshCw, Users, Wifi, WifiOff
} from 'lucide-react'

interface ServerItem {
  server_key: string
  display_name: string
  map_name: string
  game_mode: string
  server_type: string
  cluster_group: string
  max_players: number
  is_online: boolean
  player_count: number
  last_heartbeat: string | null
}

const EMPTY_NEW: ServerItem = {
  server_key: '', display_name: '', map_name: '', game_mode: 'PvE',
  server_type: 'PvE', cluster_group: 'default', max_players: 70,
  is_online: false, player_count: 0, last_heartbeat: null,
}

export default function ServersPage() {
  const [servers, setServers] = useState<ServerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newServer, setNewServer] = useState({ ...EMPTY_NEW })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<ServerItem>>({})

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true)
    try {
      const res = await arkmaniaApi.listServers()
      setServers(res.data.servers)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) }
  }, [success])

  // ── CRUD handlers ─────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!newServer.server_key || !newServer.display_name || !newServer.map_name) {
      setError('Server key, nome e mappa sono obbligatori.')
      return
    }
    try {
      await arkmaniaApi.createServer({
        server_key: newServer.server_key,
        display_name: newServer.display_name,
        map_name: newServer.map_name,
        game_mode: newServer.game_mode,
        server_type: newServer.server_type,
        cluster_group: newServer.cluster_group,
        max_players: newServer.max_players,
      })
      setShowAdd(false)
      setNewServer({ ...EMPTY_NEW })
      setSuccess('Server creato')
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  function startEdit(s: ServerItem) {
    setEditingKey(s.server_key)
    setEditData({
      display_name: s.display_name,
      map_name: s.map_name,
      game_mode: s.game_mode,
      server_type: s.server_type,
      cluster_group: s.cluster_group,
      max_players: s.max_players,
    })
  }

  async function saveEdit() {
    if (!editingKey) return
    try {
      await arkmaniaApi.updateServer(editingKey, editData)
      setEditingKey(null)
      setSuccess('Server aggiornato')
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  async function handleDelete(serverKey: string, displayName: string) {
    if (!confirm(`Eliminare il server "${displayName}"?\nVerranno rimossi anche tutti gli override di configurazione.`)) return
    try {
      await arkmaniaApi.deleteServer(serverKey)
      setSuccess('Server eliminato')
      await loadData()
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const online = servers.filter(s => s.is_online).length
  const totalPlayers = servers.reduce((sum, s) => sum + s.player_count, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Server size={22} /> Server Manager</h1>
          <p className="page-subtitle">{servers.length} server registrati — {online} online — {totalPlayers} giocatori</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-primary">
            <Plus size={14} /> Nuovo Server
          </button>
          <button onClick={loadData} className="btn btn-secondary" style={{ padding: '0.4rem' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}
      {success && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.85rem', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#16a34a' }}>
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(22,163,74,0.08)', border: '1px solid #16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wifi size={13} color="#16a34a" />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#16a34a', lineHeight: 1 }}>{online}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Online</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(220,38,38,0.08)', border: '1px solid #dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <WifiOff size={13} color="#dc2626" />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#dc2626', lineHeight: 1 }}>{servers.length - online}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Offline</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(59,130,246,0.08)', border: '1px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={13} color="#3b82f6" />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#3b82f6', lineHeight: 1 }}>{totalPlayers}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Giocatori</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(107,114,128,0.08)', border: '1px solid #6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Server size={13} color="#6b7280" />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{servers.length}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Totali</div>
          </div>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '3px solid var(--accent)' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 700 }}>
            <Plus size={14} style={{ verticalAlign: -2 }} /> Nuovo Server
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Server Key</label>
              <input className="input" placeholder="es. Ragnarok_abc123" value={newServer.server_key}
                onChange={e => setNewServer({ ...newServer, server_key: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Nome</label>
              <input className="input" placeholder="es. Ragnarok" value={newServer.display_name}
                onChange={e => setNewServer({ ...newServer, display_name: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Mappa</label>
              <input className="input" placeholder="es. Ragnarok_WP" value={newServer.map_name}
                onChange={e => setNewServer({ ...newServer, map_name: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px', gap: '0.6rem', marginTop: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Game Mode</label>
              <select className="input" value={newServer.game_mode}
                onChange={e => setNewServer({ ...newServer, game_mode: e.target.value })}>
                <option value="PvE">PvE</option>
                <option value="PvP">PvP</option>
                <option value="PvPvE">PvPvE</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Tipo</label>
              <select className="input" value={newServer.server_type}
                onChange={e => setNewServer({ ...newServer, server_type: e.target.value })}>
                <option value="PvE">PvE</option>
                <option value="PvP">PvP</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Cluster</label>
              <input className="input" value={newServer.cluster_group}
                onChange={e => setNewServer({ ...newServer, cluster_group: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Max Players</label>
              <input className="input" type="number" value={newServer.max_players}
                onChange={e => setNewServer({ ...newServer, max_players: Number(e.target.value) })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button onClick={handleCreate} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>Crea</button>
            <button onClick={() => { setShowAdd(false); setNewServer({ ...EMPTY_NEW }) }} className="btn btn-ghost" style={{ fontSize: '0.82rem' }}>Annulla</button>
          </div>
        </div>
      )}

      {/* Server table */}
      <div className="card" style={{ minHeight: 200 }}>
        {loading ? (
          <div className="pl-loading" style={{ padding: '3rem' }}>Caricamento...</div>
        ) : servers.length === 0 ? (
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <Server size={40} style={{ opacity: 0.12 }} />
            <p>Nessun server registrato</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '36px 1.2fr 1fr 0.7fr 0.7fr 0.8fr 70px 70px 80px',
              padding: '0.5rem 1rem', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-secondary)', background: 'var(--bg-card-muted)',
              borderBottom: '2px solid var(--border)',
            }}>
              <span></span>
              <span>Nome</span>
              <span>Mappa</span>
              <span>Modalita</span>
              <span>Tipo</span>
              <span>Cluster</span>
              <span>Max</span>
              <span>Online</span>
              <span></span>
            </div>

            {/* Table rows */}
            {servers.map(s => {
              const isEditing = editingKey === s.server_key
              return (
                <div key={s.server_key} style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1.2fr 1fr 0.7fr 0.7fr 0.8fr 70px 70px 80px',
                  padding: '0.5rem 1rem', alignItems: 'center',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${s.is_online ? '#16a34a' : '#dc2626'}`,
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  {/* Status dot */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {s.is_online
                      ? <Wifi size={14} color="#16a34a" />
                      : <WifiOff size={14} color="#dc2626" />}
                  </div>

                  {/* Display name */}
                  {isEditing ? (
                    <input className="input" value={editData.display_name || ''}
                      onChange={e => setEditData({ ...editData, display_name: e.target.value })}
                      style={{ fontSize: '0.82rem', padding: '0.2rem 0.4rem' }} />
                  ) : (
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.display_name}</span>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{s.server_key}</div>
                    </div>
                  )}

                  {/* Map name */}
                  {isEditing ? (
                    <input className="input" value={editData.map_name || ''}
                      onChange={e => setEditData({ ...editData, map_name: e.target.value })}
                      style={{ fontSize: '0.82rem', padding: '0.2rem 0.4rem' }} />
                  ) : (
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{s.map_name}</span>
                  )}

                  {/* Game mode */}
                  {isEditing ? (
                    <select className="input" value={editData.game_mode || 'PvE'}
                      onChange={e => setEditData({ ...editData, game_mode: e.target.value })}
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.3rem' }}>
                      <option value="PvE">PvE</option>
                      <option value="PvP">PvP</option>
                      <option value="PvPvE">PvPvE</option>
                    </select>
                  ) : (
                    <span style={{
                      display: 'inline-flex', padding: '0.1rem 0.4rem', borderRadius: 4,
                      fontSize: '0.72rem', fontWeight: 700,
                      background: s.game_mode === 'PvP' ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
                      color: s.game_mode === 'PvP' ? '#dc2626' : '#16a34a',
                      border: `1px solid ${s.game_mode === 'PvP' ? '#dc262620' : '#16a34a20'}`,
                    }}>{s.game_mode}</span>
                  )}

                  {/* Server type */}
                  {isEditing ? (
                    <select className="input" value={editData.server_type || 'PvE'}
                      onChange={e => setEditData({ ...editData, server_type: e.target.value })}
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.3rem' }}>
                      <option value="PvE">PvE</option>
                      <option value="PvP">PvP</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.server_type}</span>
                  )}

                  {/* Cluster */}
                  {isEditing ? (
                    <input className="input" value={editData.cluster_group || ''}
                      onChange={e => setEditData({ ...editData, cluster_group: e.target.value })}
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.3rem' }} />
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.cluster_group}</span>
                  )}

                  {/* Max players */}
                  {isEditing ? (
                    <input className="input" type="number" value={editData.max_players || 70}
                      onChange={e => setEditData({ ...editData, max_players: Number(e.target.value) })}
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.3rem', width: '100%' }} />
                  ) : (
                    <span style={{ fontSize: '0.82rem' }}>
                      <span style={{ fontWeight: 700, color: s.player_count > 0 ? '#3b82f6' : 'var(--text-primary)' }}>
                        {s.player_count}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>/{s.max_players}</span>
                    </span>
                  )}

                  {/* Player count (read-only) */}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {s.last_heartbeat ? new Date(s.last_heartbeat).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'flex-end' }}>
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} title="Salva" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: 3 }}><Save size={15} /></button>
                        <button onClick={() => setEditingKey(null)} title="Annulla" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(s)} title="Modifica" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(s.server_key, s.display_name)} title="Elimina" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 3 }}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
