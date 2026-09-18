/**
 * HardeningPage - security posture of the native-Windows hosts.
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleAlert, CircleCheck, Play, RotateCw, Server, ShieldCheck, TriangleAlert,
} from 'lucide-react'

import { machinesApi, hardeningApi } from '../services/api'
import { extractError } from '../utils/errors'
import { useSelection } from '../hooks/useSelection'
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, Field, PageHeader, Select,
  Spinner, StatTile, Switch, Table, TableMessageRow, useConfirm, useToast, type BadgeTone,
} from '../components/ui'
import type {
  AuthUser, SSHMachine, HardeningReport, HardeningControl, HardeningRisk,
} from '../types'

interface Props {
  currentUser?: AuthUser | null
}

const RISK_TONE: Record<HardeningRisk, BadgeTone> = {
  none: 'neutral',
  service: 'warning',
  lockout: 'danger',
}

const COLUMNS = 6

// Same rule as PlatformAdapter.from_machine: runtime=native only counts on a
// Windows host, so a Linux row saved with a stale runtime is not listed.
const isNativeHost = (m: SSHMachine) => m.os_type === 'windows' && m.runtime === 'native'

export default function HardeningPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = currentUser?.role === 'admin'

  const [machines, setMachines] = useState<SSHMachine[]>([])
  const [machinesLoading, setMachinesLoading] = useState(true)
  // null = the list loaded; a string (possibly empty) = the last attempt failed.
  // Kept apart from `error` so a failure never reads as "no native host".
  const [machinesError, setMachinesError] = useState<string | null>(null)
  const [machinesReload, setMachinesReload] = useState(0)
  const [machineId, setMachineId] = useState<number | null>(null)
  const [report, setReport] = useState<HardeningReport | null>(null)
  const [includeRisky, setIncludeRisky] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  // Only native hosts have these controls: a POK host runs its game servers
  // inside Linux containers, where none of this applies.
  const nativeMachines = useMemo(() => machines.filter(isNativeHost), [machines])

  useEffect(() => {
    setMachinesLoading(true)
    machinesApi.list()
      .then(res => {
        setMachines(res.data)
        setMachinesError(null)
        const first = res.data.find(isNativeHost)
        // This effect re-runs on a language switch (`t` changes identity):
        // keep the host the operator picked, or Apply would target another
        // host than the report on screen.
        if (first) setMachineId(prev => prev ?? first.id)
      })
      .catch(e => setMachinesError(extractError(e, '')))
      .finally(() => setMachinesLoading(false))
    // `t` is a documented dependency: see the comment above.
  }, [t, machinesReload])

  /** Only failing controls can be selected, and lockout ones need the opt-in. */
  const selectableIds = useMemo(
    () =>
      (report?.controls ?? [])
        .filter(c => !c.compliant && (c.risk !== 'lockout' || includeRisky))
        .map(c => c.id),
    [report, includeRisky],
  )
  // Turning the opt-in back off drops the lockout controls from the selection.
  const selection = useSelection(selectableIds)

  const runAudit = useCallback(async (id: number) => {
    setLoading(true); setError(''); setReport(null)
    try {
      const res = await hardeningApi.audit(id)
      setReport(res.data)
    } catch (e) {
      setError(extractError(e, t('hardening.auditError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  async function applySelected() {
    // The selection comes from the report: never apply it to another host.
    if (machineId === null || !report || report.machine_id !== machineId) return
    const ids = Array.from(selection.selected)
    if (ids.length === 0) return

    const chosen = report.controls.filter(c => ids.includes(c.id))
    const risky = chosen.filter(c => c.risk === 'lockout')
    const ok = await confirm({
      title: risky.length > 0
        ? t('hardening.confirmRiskyTitle', { count: risky.length })
        : t('hardening.confirmApplyTitle', { count: ids.length }),
      description: (
        <>
          <p>
            {risky.length > 0
              ? t('hardening.confirmRisky', { count: risky.length, names: risky.map(c => c.id).join(', ') })
              : t('hardening.confirmApply', { count: ids.length })}
          </p>
          <ul>
            {chosen.map(c => (
              <li key={c.id}>
                {c.title} <span className="u-mono u-muted">{c.id}</span>
              </li>
            ))}
          </ul>
        </>
      ),
      confirmLabel: t('hardening.applyConfirm', { count: ids.length }),
      tone: 'danger',
      // An irreversible change that can lock the operator out: type the host.
      confirmText: risky.length > 0 ? report.machine_name : undefined,
    })
    if (!ok) return

    setApplying(true); setError('')
    try {
      const res = await hardeningApi.apply(machineId, { controls: ids, include_risky: includeRisky })
      setReport(res.data)
      selection.clear()
      toast.success(t('hardening.applyDone', { count: ids.length }))
    } catch (e) {
      setError(extractError(e, t('hardening.applyError')))
    } finally {
      setApplying(false)
    }
  }

  // Grouped by category so related controls read together.
  const grouped = useMemo(() => {
    const out: Record<string, HardeningControl[]> = {}
    for (const c of report?.controls ?? []) {
      (out[c.category] = out[c.category] || []).push(c)
    }
    return out
  }, [report])

  const busy = loading || applying

  // The empty option of the host picker states why it is empty: still loading,
  // the request failed, or there really is no native host.
  const hostPlaceholder = machinesLoading
    ? t('common.loading')
    : nativeMachines.length > 0
      ? null
      : machinesError !== null
        ? t('hardening.machinesError')
        : t('hardening.noNativeMachines')

  return (
    <div className="l-page">
      <PageHeader title={t('hardening.title')} icon={ShieldCheck} description={t('hardening.subtitle')} />

      {error && (
        <Alert tone="danger" onDismiss={() => setError('')}>{error}</Alert>
      )}

      {/* A failed host list is never dressed up as "no native host": it says so
          and offers Retry, here and in place of the empty state below. */}
      {machinesError !== null && (
        <Alert
          tone="danger"
          title={t('hardening.machinesError')}
          actions={
            <Button size="sm" icon={RotateCw} onClick={() => setMachinesReload(n => n + 1)}>
              {t('common.retry')}
            </Button>
          }
        >
          {machinesError || undefined}
        </Alert>
      )}

      {/* Host picker + audit trigger */}
      <Card>
        <div className="l-cluster">
          <Field label={t('hardening.machine')}>
            <Select
              value={machineId ?? ''}
              disabled={machinesLoading || nativeMachines.length === 0 || busy}
              onChange={e => {
                setMachineId(Number(e.target.value))
                setReport(null)
                selection.clear()
              }}
            >
              {hostPlaceholder && <option value="">{hostPlaceholder}</option>}
              {nativeMachines.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.hostname})</option>
              ))}
            </Select>
          </Field>
          <Button
            icon={RotateCw}
            loading={loading}
            loadingLabel={t('hardening.auditing')}
            disabled={machineId === null || applying}
            onClick={() => machineId !== null && runAudit(machineId)}
          >
            {t('hardening.runAudit')}
          </Button>
        </div>
      </Card>

      {machinesLoading ? (
        <Card><Spinner block label={t('common.loading')} /></Card>
      ) : machinesError !== null && nativeMachines.length === 0 ? (
        // The alert above already carries the reason and the Retry button.
        null
      ) : nativeMachines.length === 0 ? (
        <Card>
          <EmptyState icon={Server} title={t('hardening.noNativeMachines')} description={t('hardening.noNativeHint')} />
        </Card>
      ) : loading ? (
        <Card><Spinner block label={t('hardening.auditing')} /></Card>
      ) : !report ? (
        <Card>
          <EmptyState icon={ShieldCheck} title={t('hardening.notRunYet')} />
        </Card>
      ) : (
        <>
          <div className="l-grid--stats">
            <StatTile
              label={t('hardening.satisfied')}
              value={`${report.summary.compliant}/${report.summary.total}`}
            />
            <StatTile
              label={t('hardening.failingLabel')}
              value={report.summary.failing}
              meta={report.summary.failing > 0 ? t('hardening.failingMeta', { count: report.summary.failing }) : undefined}
              metaTone={report.summary.failing > 0 ? 'danger' : undefined}
            />
            <StatTile
              label={t('hardening.lockoutLabel')}
              value={report.summary.lockout_pending}
              meta={report.summary.lockout_pending > 0 ? t('hardening.lockoutPending', { count: report.summary.lockout_pending }) : undefined}
              metaTone={report.summary.lockout_pending > 0 ? 'warning' : undefined}
            />
          </div>

          <Card title={t('hardening.applyTitle')}>
            <div className="l-stack l-stack--sm">
              <Checkbox
                label={t('hardening.selectFailing')}
                description={t('hardening.selectFailingHint', { count: selectableIds.length })}
                checked={selection.allSelected}
                indeterminate={selection.someSelected}
                disabled={!isAdmin || selectableIds.length === 0}
                onChange={selection.toggleAll}
              />
              <Switch
                label={t('hardening.includeRisky')}
                description={t('hardening.riskyWarning')}
                checked={includeRisky}
                disabled={!isAdmin}
                onChange={setIncludeRisky}
              />
              <p className="u-secondary u-text-sm" role="status">
                {selection.count > 0
                  ? t('ui.selectedCount', { count: selection.count })
                  : t('ui.noneSelected')}
              </p>
              {!isAdmin && <Alert tone="info">{t('hardening.adminOnly')}</Alert>}
              {includeRisky && <Alert tone="warning">{t('hardening.riskyWarning')}</Alert>}
              <div className="l-cluster">
                <Button
                  variant="danger"
                  icon={Play}
                  loading={applying}
                  loadingLabel={t('hardening.applying')}
                  disabled={!isAdmin || selection.count === 0}
                  title={!isAdmin ? t('hardening.adminOnly') : undefined}
                  onClick={() => void applySelected()}
                >
                  {t('hardening.applySelected', { count: selection.count })}
                </Button>
              </div>
            </div>
          </Card>

          {Object.entries(grouped).map(([category, controls]) => (
            <Card
              key={category}
              titleAs="h2"
              flush
              title={t(`hardening.category.${category}`, { defaultValue: category })}
            >
              <Table label={t(`hardening.category.${category}`, { defaultValue: category })} minWidth={900}>
                <thead>
                  <tr>
                    <th scope="col"><span className="u-sr-only">{t('hardening.column.select')}</span></th>
                    <th scope="col">{t('hardening.column.state')}</th>
                    <th scope="col">{t('hardening.column.control')}</th>
                    <th scope="col">{t('hardening.column.risk')}</th>
                    <th scope="col">{t('hardening.column.detail')}</th>
                    <th scope="col">{t('hardening.column.result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.length === 0 ? (
                    <TableMessageRow colSpan={COLUMNS}>
                      <EmptyState icon={ShieldCheck} title={t('hardening.noControls')} />
                    </TableMessageRow>
                  ) : (
                    controls.map(c => {
                      const selectable = selectableIds.includes(c.id)
                      return (
                        <tr key={c.id} data-selected={selection.isSelected(c.id) || undefined}>
                          <td>
                            <Checkbox
                              aria-label={t('hardening.selectControl', { title: c.title })}
                              checked={selection.isSelected(c.id)}
                              disabled={!selectable || !isAdmin}
                              onChange={() => selection.toggle(c.id)}
                            />
                          </td>
                          <td>
                            {c.compliant ? (
                              <Badge tone="success" icon={CircleCheck}>{t('hardening.state.compliant')}</Badge>
                            ) : (
                              <Badge tone="danger" icon={CircleAlert}>{t('hardening.state.failing')}</Badge>
                            )}
                          </td>
                          <td>
                            <div className="ui-cell-2">
                              <span>{c.title}</span>
                              <span className="u-mono u-muted">{c.id}</span>
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={RISK_TONE[c.risk]}
                              icon={c.risk === 'lockout' ? CircleAlert : c.risk === 'service' ? TriangleAlert : undefined}
                            >
                              {t(`hardening.risk.${c.risk}`)}
                            </Badge>
                          </td>
                          <td className="ui-cell-wrap u-secondary">{c.detail}</td>
                          <td className="ui-cell-wrap">
                            {c.applied === 'yes' && (
                              <Badge tone="success" icon={CircleCheck}>{t('hardening.applied.yes')}</Badge>
                            )}
                            {c.applied === 'failed' && (
                              <span className="l-cluster">
                                <Badge tone="danger" icon={CircleAlert}>{t('hardening.applied.failed')}</Badge>
                                {c.error && <span className="u-text-sm">{c.error}</span>}
                              </span>
                            )}
                            {c.applied === 'skipped-risky' && (
                              <Badge tone="warning" icon={TriangleAlert}>{t('hardening.applied.skipped')}</Badge>
                            )}
                            {c.applied === 'no' && c.error && (
                              <span className="u-text-sm u-secondary">{c.error}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </Table>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
