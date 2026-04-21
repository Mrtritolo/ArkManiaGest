/**
 * BansPage — Cluster-wide ban management from ARKM_bans.
 * Design consistent with OnlinePlayersPage and RareDinosPage.
 */
import { useState, useEffect } from 'react'
import { arkBansApi } from '../services/api'
import {
  Ban, Search, Plus, XCircle, AlertCircle, X, Shield,
  Clock, UserX, CheckCircle, Copy, ChevronDown
} from 'lucide-react'

interface BanItem {
  id: number; eos_id: string; player_name: string | null; reason: string
  banned_by: string; ban_time: string; expire_time: string | null
  is_active: boolean; unbanned_by: string | null; unban_time: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso.slice(0, 16) }
}

export default function BansPage() {
  const [bans, setBans] = useState<BanItem[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ eos_id: '', player_name: '', reason: '', banned_by: 'Admin', expire_time: '', permanent: true })
  const [creating, setCreating] = useState(false)

  // Dettaglio espanso
  const [expandedId, setExpandedId] = useState<number | null>(null)

  async function loadBans() {
    try {
      const res = await arkBansApi.list({ active_only: !showAll, search: search || undefined, limit: 200 })
      setBans(res.data.bans)
      setActiveCount(res.data.active_count)
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadBans() }, [showAll])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    loadBans()
  }

  async function handleUnban(id: number, name: string) {
    if (!confirm(`Sbloccare il ban di ${name || 'questo giocatore'}?`)) return
    try {
      await arkBansApi.unban(id)
      await loadBans()
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.eos_id.trim()) return
    setCreating(true)
    try {
      await arkBansApi.create({
        eos_id: form.eos_id.trim(),
        player_name: form.player_name.trim() || undefined,
        reason: form.reason.trim() || 'No reason',
        banned_by: form.banned_by.trim() || 'Admin',
        expire_time: form.permanent ? undefined : (form.expire_time || undefined),
      })
      setShowModal(false)
      setForm({ eos_id: '', player_name: '', reason: '', banned_by: 'Admin', expire_time: '', permanent: true })
      await loadBans()
    } catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setCreating(false) }
  }

  const totalBans = bans.length
  const expiredCount = bans.filter(b => !b.is_active).length

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title"><Ban size={22} /> Ban Manager</h1>
          <p className="page-subtitle">
            Gestione ban cluster-wide — {activeCount} ban attivi
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          <Plus size={16} /> Nuovo Ban
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--danger-bg)', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserX size={18} color="var(--danger)" />
          </div>
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--danger)', lineHeight: 1 }}>{activeCount}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ban attivi</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-card-muted)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18} color="var(--text-muted)" />
          </div>
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{totalBans}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Totale ban</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--success-bg)', border: '1px solid var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle size={18} color="var(--success)" />
          </div>
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--success)', lineHeight: 1 }}>{expiredCount}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sbloccati</div>
          </div>
        </div>
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center' }}>
        <form onSubmit={handleSearchSubmit} style={{ flex: 1, display: 'flex', gap: '0.4rem' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Cerca per EOS ID, nome o motivo..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 30, fontSize: '0.85rem', height: 36 }} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: 36 }}>
            <Search size={14} /> Cerca
          </button>
        </form>
        <div style={{ display: 'flex', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <button onClick={() => setShowAll(false)} style={{
            padding: '0.4rem 0.75rem', border: 'none', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
            background: !showAll ? 'var(--danger)' : 'var(--bg-input)', color: !showAll ? '#fff' : 'var(--text-secondary)',
          }}>
            Attivi
          </button>
          <button onClick={() => setShowAll(true)} style={{
            padding: '0.4rem 0.75rem', border: 'none', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
            background: showAll ? 'var(--accent)' : 'var(--bg-input)', color: showAll ? '#fff' : 'var(--text-secondary)',
          }}>
            Tutti
          </button>
        </div>
      </div>

      {/* Ban list */}
      {loading ? (
        <div className="pl-loading">Caricamento...</div>
      ) : bans.length === 0 ? (
        <div className="pl-empty" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '3rem' }}>
          <Shield size={48} style={{ opacity: 0.15 }} />
          <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>Nessun ban trovato</p>
          <p style={{ fontSize: '0.82rem' }}>
            {search ? 'Nessun risultato per la ricerca' : showAll ? 'Il cluster non ha ban registrati' : 'Nessun ban attivo nel cluster'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 120px 100px 90px',
            padding: '0.5rem 1rem', background: 'var(--bg-card-muted)',
            fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)',
          }}>
            <span>Giocatore</span>
            <span>Motivo</span>
            <span>Bannato da</span>
            <span>Data</span>
            <span style={{ textAlign: 'center' }}>Scadenza</span>
            <span style={{ textAlign: 'center' }}>Azioni</span>
          </div>

          {/* Rows */}
          {bans.map(ban => (
            <div key={ban.id} style={{ background: 'var(--bg-card)' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 120px 100px 90px',
                padding: '0.5rem 1rem', alignItems: 'center',
                opacity: ban.is_active ? 1 : 0.55,
                cursor: 'pointer',
              }}
                onClick={() => setExpandedId(expandedId === ban.id ? null : ban.id)}
              >
                {/* Player */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: ban.is_active ? '#ef4444' : '#94a3b8',
                      boxShadow: ban.is_active ? '0 0 4px rgba(239,68,68,0.5)' : 'none',
                    }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ban.player_name || 'Sconosciuto'}
                    </span>
                    {!ban.is_active && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '0.05rem 0.3rem', borderRadius: 3 }}>
                        SBLOCCATO
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ban.eos_id}
                  </div>
                </div>

                {/* Reason */}
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ban.reason}>
                  {ban.reason}
                </span>

                {/* Banned by */}
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{ban.banned_by}</span>

                {/* Date */}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {formatDate(ban.ban_time)}
                </span>

                {/* Expire */}
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 600,
                    padding: '0.1rem 0.45rem', borderRadius: 4,
                    background: ban.expire_time ? 'var(--warning-bg)' : 'var(--danger-bg)',
                    color: ban.expire_time ? 'var(--warning)' : 'var(--danger)',
                  }}>
                    {ban.expire_time ? formatDate(ban.expire_time) : 'Permanente'}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                  {ban.is_active && (
                    <button onClick={e => { e.stopPropagation(); handleUnban(ban.id, ban.player_name || '') }}
                      className="btn btn-ghost" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: 'var(--success)' }}>
                      <CheckCircle size={14} /> Sblocca
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(ban.eos_id) }}
                    className="btn btn-ghost" style={{ padding: '0.25rem 0.35rem' }} title="Copia EOS ID">
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === ban.id && (
                <div style={{ padding: '0.5rem 1rem 0.75rem 2.2rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card-muted)', fontSize: '0.82rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem 1.5rem' }}>
                    <div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>EOS ID</span>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', marginTop: 2 }}>{ban.eos_id}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Motivo completo</span>
                      <div style={{ marginTop: 2 }}>{ban.reason}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Bannato il</span>
                      <div style={{ marginTop: 2 }}>{formatDate(ban.ban_time)}</div>
                    </div>
                    {ban.expire_time && (
                      <div>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scadenza</span>
                        <div style={{ marginTop: 2 }}>{formatDate(ban.expire_time)}</div>
                      </div>
                    )}
                    {!ban.is_active && ban.unbanned_by && (
                      <>
                        <div>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sbloccato da</span>
                          <div style={{ marginTop: 2, color: 'var(--success)' }}>{ban.unbanned_by}</div>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sbloccato il</span>
                          <div style={{ marginTop: 2 }}>{formatDate(ban.unban_time)}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Nuovo Ban */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(2px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', width: '95%', maxWidth: 520 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserX size={18} color="var(--danger)" />
                Nuovo Ban
              </h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>

            {/* Body */}
            <form onSubmit={handleCreate}>
              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* EOS ID */}
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    EOS ID <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input" placeholder="abc123def456..." required value={form.eos_id}
                    onChange={e => setForm({ ...form, eos_id: e.target.value })}
                    style={{ fontSize: '0.88rem', fontFamily: 'var(--font-mono)', height: 36 }} />
                </div>

                {/* Nome giocatore */}
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Nome Giocatore
                  </label>
                  <input className="input" placeholder="Opzionale" value={form.player_name}
                    onChange={e => setForm({ ...form, player_name: e.target.value })}
                    style={{ fontSize: '0.88rem', height: 36 }} />
                </div>

                {/* Motivo */}
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Motivo
                  </label>
                  <input className="input" placeholder="Motivo del ban..." value={form.reason}
                    onChange={e => setForm({ ...form, reason: e.target.value })}
                    style={{ fontSize: '0.88rem', height: 36 }} />
                </div>

                {/* Bannato da + Durata */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Bannato da
                    </label>
                    <input className="input" value={form.banned_by}
                      onChange={e => setForm({ ...form, banned_by: e.target.value })}
                      style={{ fontSize: '0.88rem', height: 36 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Durata
                    </label>
                    <div style={{ display: 'flex', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)', height: 36 }}>
                      <button type="button" onClick={() => setForm({ ...form, permanent: true })} style={{
                        flex: 1, border: 'none', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                        background: form.permanent ? 'var(--danger)' : 'var(--bg-input)', color: form.permanent ? '#fff' : 'var(--text-secondary)',
                      }}>
                        Permanente
                      </button>
                      <button type="button" onClick={() => setForm({ ...form, permanent: false })} style={{
                        flex: 1, border: 'none', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                        background: !form.permanent ? 'var(--warning)' : 'var(--bg-input)', color: !form.permanent ? '#fff' : 'var(--text-secondary)',
                      }}>
                        Temporaneo
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scadenza (se temporaneo) */}
                {!form.permanent && (
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <Clock size={12} style={{ verticalAlign: -1 }} /> Scadenza
                    </label>
                    <input type="datetime-local" className="input" value={form.expire_time}
                      onChange={e => setForm({ ...form, expire_time: e.target.value })}
                      style={{ fontSize: '0.88rem', height: 36 }} />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card-muted)' }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost">Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={creating} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>
                  <Ban size={14} /> {creating ? 'Creazione...' : 'Banna Giocatore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
