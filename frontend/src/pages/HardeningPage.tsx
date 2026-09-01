/**
 * HardeningPage - Security posture of the native-Windows hosts.
 *
 * An ARK host is a public game server: UDP ports face the internet and it is
 * administered over SSH. This page audits the controls that shrink that
 * surface and lets an admin apply them.
 *
 * Two things the UI is deliberately careful about:
 *
 *  - Audit is always the default. Nothing is changed until Apply is pressed.
 *  - Controls tagged `lockout` can cut administrative access to the host.
 *    They are excluded from Apply unless the operator ticks a separate,
 *    explicitly worded opt-in, and the script still refuses the orderings
 *    that are structurally unsafe.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShieldCheck, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  AlertTriangle, Play, Server,
} from 'lucide-react'
import { machinesApi, hardeningApi } from '../services/api'
import type {
  SSHMachine, HardeningReport, HardeningControl, HardeningRisk,
} from '../types'

interface Props {
  currentUser?: { role?: string } | null
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)',
  display: 'block', marginBottom: 3,
}

const RISK_COLOR: Record<HardeningRisk, string> = {
  none: 'var(--text-muted)',
  service: 'var(--warning)',
  lockout: 'var(--danger)',
}

export default function HardeningPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const isAdmin = currentUser?.role === 'admin'

  const [machines, setMachines] = useState<SSHMachine[]>([])
  const [machineId, setMachineId] = useState<number | null>(null)
  const [report, setReport] = useState<HardeningReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeRisky, setIncludeRisky] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  // Only native hosts have these controls: a POK host runs its game servers
  // inside Linux containers, where none of this applies.
  const nativeMachines = useMemo(
    () => machines.filter(m => m.runtime === 'native'),
    [machines],
  )

  useEffect(() => {
    machinesApi.list()
      .then(res => {
        setMachines(res.data)
        const first = res.data.find(m => m.runtime === 'native')
        if (first) setMachineId(first.id)
      })
      .catch(() => setError(t('hardening.machinesError')))
  }, [t])

  const runAudit = useCallback(async (id: number) => {
    setLoading(true); setError(''); setReport(null); setSelected(new Set())
    try {
      const res = await hardeningApi.audit(id)
      setReport(res.data)
    } catch (e: any) {
      setError(e?.response?.data?.detail || t('hardening.auditError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  async function applySelected() {
    if (machineId === null || !report) return
    const ids = Array.from(selected)
    if (ids.length === 0) return

    const risky = report.controls.filter(
      c => ids.includes(c.id) && c.risk === 'lockout',
    )
    const warning = risky.length > 0
      ? t('hardening.confirmRisky', {
          count: risky.length,
          names: risky.map(c => c.id).join(', '),
        })
      : t('hardening.confirmApply', { count: ids.length })
    if (!window.confirm(warning)) return

    setApplying(true); setError('')
    try {
      const res = await hardeningApi.apply(machineId, {
        controls: ids,
        include_risky: includeRisky,
      })
      setReport(res.data)
      setSelected(new Set())
    } catch (e: any) {
      setError(e?.response?.data?.detail || t('hardening.applyError'))
    } finally {
      setApplying(false)
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function selectAllSafe() {
    if (!report) return
    setSelected(new Set(
      report.controls
        .filter(c => !c.compliant && (c.risk !== 'lockout' || includeRisky))
        .map(c => c.id),
    ))
  }

  // Grouped by category so related controls read together.
  const grouped = useMemo(() => {
    const out: Record<string, HardeningControl[]> = {}
    for (const c of report?.controls ?? []) {
      (out[c.category] = out[c.category] || []).push(c)
    }
    return out
  }, [report])

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">
            <ShieldCheck size={20} style={{ marginRight: 8, verticalAlign: '-3px' }} />
            {t('hardening.title')}
          </h1>
          <p className="page-subtitle">{t('hardening.subtitle')}</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}

      {/* Host picker + audit trigger */}
      <div className="card" style={{ padding: '0.7rem 1rem', marginBottom: '0.75rem', display: 'flex', gap: '0.7rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <label style={labelStyle}>{t('hardening.machine')}</label>
          <select className="form-input" value={machineId ?? ''}
            onChange={e => { const v = Number(e.target.value); setMachineId(v); setReport(null); setSelected(new Set()) }}
            disabled={nativeMachines.length === 0}>
            {nativeMachines.length === 0 && <option value="">{t('hardening.noNativeMachines')}</option>}
            {nativeMachines.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.hostname})</option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" disabled={machineId === null || loading}
          onClick={() => machineId !== null && runAudit(machineId)}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          {t('hardening.runAudit')}
        </button>
      </div>

      {nativeMachines.length === 0 ? (
        <div className="card">
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <Server size={40} style={{ opacity: 0.12 }} />
            <p>{t('hardening.noNativeHint')}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="card"><div className="pl-loading" style={{ padding: '3rem' }}>{t('hardening.auditing')}</div></div>
      ) : !report ? (
        <div className="card">
          <div className="pl-empty" style={{ padding: '3rem' }}>
            <ShieldCheck size={40} style={{ opacity: 0.12 }} />
            <p>{t('hardening.notRunYet')}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Summary + apply controls */}
          <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, color: report.summary.failing === 0 ? 'var(--success)' : 'var(--text)' }}>
                  {report.summary.compliant}/{report.summary.total}
                </span>
                <span style={{ marginLeft: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {t('hardening.satisfied')}
                </span>
              </div>
              {report.summary.lockout_pending > 0 && (
                <span style={{ fontSize: '0.78rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={14} />
                  {t('hardening.lockoutPending', { count: report.summary.lockout_pending })}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" className="form-checkbox" checked={includeRisky}
                    onChange={e => setIncludeRisky(e.target.checked)} disabled={!isAdmin} />
                  {t('hardening.includeRisky')}
                </label>
                <button className="btn btn-secondary btn-sm" onClick={selectAllSafe}>
                  {t('hardening.selectFailing')}
                </button>
                <button className="btn btn-primary btn-sm"
                  disabled={!isAdmin || applying || selected.size === 0}
                  onClick={applySelected}>
                  <Play size={14} />
                  {t('hardening.applySelected', { count: selected.size })}
                </button>
              </div>
            </div>
            {!isAdmin && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
                {t('hardening.adminOnly')}
              </p>
            )}
            {includeRisky && (
              <p style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: '0.5rem 0 0' }}>
                <AlertTriangle size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {t('hardening.riskyWarning')}
              </p>
            )}
          </div>

          {Object.entries(grouped).map(([category, controls]) => (
            <div key={category} className="card" style={{ marginBottom: '0.75rem', padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '0.5rem 1rem', fontSize: '0.7rem', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--text-secondary)', background: 'var(--bg-card-muted)',
                borderBottom: '1px solid var(--border)',
              }}>
                {t(`hardening.category.${category}`, { defaultValue: category })}
              </div>

              {controls.map(c => (
                <div key={c.id} style={{
                  display: 'flex', gap: '0.7rem', padding: '0.6rem 1rem',
                  alignItems: 'flex-start', borderBottom: '1px solid var(--border)',
                }}>
                  <input type="checkbox" className="form-checkbox"
                    style={{ marginTop: 3 }}
                    checked={selected.has(c.id)}
                    disabled={c.compliant || !isAdmin || (c.risk === 'lockout' && !includeRisky)}
                    onChange={() => toggle(c.id)} />

                  {c.compliant
                    ? <CheckCircle2 size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
                    : <XCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                      {c.title}
                      <span style={{
                        marginLeft: 8, fontSize: '0.62rem', fontWeight: 700,
                        color: RISK_COLOR[c.risk],
                      }}>
                        {t(`hardening.risk.${c.risk}`)}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {c.id}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {c.detail}
                    </div>
                    {c.applied === 'yes' && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--success)', marginTop: 3 }}>
                        {t('hardening.applied.yes')}
                      </div>
                    )}
                    {c.applied === 'failed' && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--danger)', marginTop: 3 }}>
                        {t('hardening.applied.failed')}{c.error ? `: ${c.error}` : ''}
                      </div>
                    )}
                    {c.applied === 'skipped-risky' && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--warning)', marginTop: 3 }}>
                        {t('hardening.applied.skipped')}
                      </div>
                    )}
                    {c.applied === 'no' && c.error && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--warning)', marginTop: 3 }}>
                        {c.error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
