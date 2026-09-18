/**
 * usePurgeActions — staging a tribe for destruction, cancelling it, and the
 * cluster-wide DM.Purge sweep.
 *
 * Scheduling and cancelling stage rows in ARKM_decay_pending (require_operator);
 * running the sweep and the combined "purge now" reach the game over RCON
 * (require_admin). Failures keep using the page-level alert: a 409 from
 * purge-tribe carries a list of the other tribes still pending, which is too
 * long to read in a toast.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import { useConfirm, useToast } from '../../../components/ui'
import { usePending } from '../../../hooks/usePending'
import type { DecayTribe, PendingItem } from '../decayModel'

interface Args {
  loadData: () => Promise<void>
  setError: (v: string) => void
}

export function usePurgeActions({ loadData, setError }: Args) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  // Keyed by targeting_team: only the row being staged or cancelled spins,
  // and a second click on the same row is ignored.
  const acting = usePending<number>()
  const [running, setRunning] = useState(false)

  async function handleSchedulePurge(tribe: DecayTribe) {
    const name = tribe.tribe_name || t('decay.unknownTribe')
    const ok = await confirm({
      title: t('decay.scheduleTitle'),
      description: t('decay.confirmSchedule', { id: tribe.targeting_team, name }),
      confirmLabel: t('decay.scheduleAction'),
    })
    if (!ok) return
    setError('')
    try {
      const res = await acting.run(tribe.targeting_team, () =>
        arkDecayApi.schedulePurge(tribe.targeting_team, 'manual'))
      if (!res) return
      toast.success(t('decay.scheduleDone', {
        id: tribe.targeting_team,
        rows: res.data.rows_inserted,
        total: res.data.scheduled_on.length,
      }))
      await loadData()
    } catch (e: unknown) {
      setError(extractError(e, t('decay.scheduleFailed')))
    }
  }

  // ── DM.Purge dispatch (cluster-wide) ───────────────────────────
  // Calls ARKM.DM.Purge over RCON on every active ARK instance -- the plugin
  // then walks ARKM_decay_pending on each contacted server and destroys the
  // actors there. Admin only on the backend, and irreversible, so the admin
  // types the word out.
  async function handleRunPurge() {
    const ok = await confirm({
      title: t('decay.runPurgeTitle'),
      description: t('decay.confirmRunPurge'),
      confirmLabel: t('decay.runPurgeAction'),
      confirmText: t('decay.purgeConfirmWord'),
      tone: 'danger',
    })
    if (!ok) return
    setRunning(true); setError('')
    try {
      const res = await arkDecayApi.runPurge()
      toast.success(t('decay.runPurgeDone', {
        ok: res.data.instances_ok,
        total: res.data.instances_total,
        failed: res.data.instances_failed,
      }))
      await loadData()
    } catch (e: unknown) {
      setError(extractError(e, t('decay.runPurgeFailed')))
    } finally {
      setRunning(false)
    }
  }

  // ── Per-tribe combined "schedule + run" ────────────────────────
  // One round-trip schedules the tribe AND triggers the cluster-wide RCON
  // sweep, so the operator doesn't need to click twice.
  async function handlePurgeTribeNow(tribe: DecayTribe) {
    const name = tribe.tribe_name || t('decay.unknownTribe')
    const ok = await confirm({
      title: t('decay.purgeNowTitle'),
      description: t('decay.confirmPurgeNow', { id: tribe.targeting_team, name }),
      confirmLabel: t('decay.purgeNowAction'),
      tone: 'danger',
    })
    if (!ok) return
    setError('')
    try {
      const res = await acting.run(tribe.targeting_team, () =>
        arkDecayApi.purgeTribe(tribe.targeting_team))
      if (!res) return
      toast.success(t('decay.purgeNowDone', {
        id: tribe.targeting_team,
        rows: res.data.rows_inserted,
        ok: res.data.instances_ok,
        total: res.data.instances_total,
      }))
      await loadData()
    } catch (e: unknown) {
      setError(extractError(e, t('decay.purgeNowFailed')))
    }
  }

  async function handleCancelPurge(p: PendingItem) {
    const ok = await confirm({
      title: t('decay.cancelTitle'),
      description: t('decay.confirmCancel', {
        id: p.targeting_team,
        name: p.tribe_name || t('decay.unknownTribe'),
        server: p.server_name || p.server_key.split('_')[0],
      }),
      confirmLabel: t('decay.cancelAction'),
    })
    if (!ok) return
    setError('')
    try {
      // Pass the specific server_key so we only cancel ONE row at a
      // time (the per-row button maps to the per-row entry).
      const res = await acting.run(p.targeting_team, () =>
        arkDecayApi.cancelPurge(p.targeting_team, p.server_key))
      if (!res) return
      toast.success(t('decay.cancelDone', {
        id: p.targeting_team,
        rows: res.data.rows_deleted,
      }))
      await loadData()
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cancelFailed')))
    }
  }

  return { acting, running, handleSchedulePurge, handleRunPurge, handlePurgeTribeNow, handleCancelPurge }
}

export type PurgeActions = ReturnType<typeof usePurgeActions>
