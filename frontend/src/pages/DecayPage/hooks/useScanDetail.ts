/**
 * useScanDetail — the per-object snapshot behind a pending row.
 *
 * Lives at page level, not inside the Pending tab: the open panel and its
 * rows must survive a tab switch. Every response carries the request id it
 * was opened with, so a slow snapshot of tribe A cannot land in the panel
 * opened for tribe B afterwards.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkDecayApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import type { ServerInstance } from '../../../types'
import { useConfirm } from '../../../components/ui'
import { instanceLabel, targetFor, type PendingItem, type ScanDetailItem } from '../decayModel'

interface Args {
  instances: ServerInstance[]
  cmdInstance: number | ''
  setCmdBusy: (v: string | null) => void
  setCmdReply: (v: string) => void
  setError: (v: string) => void
}

export function useScanDetail({ instances, cmdInstance, setCmdBusy, setCmdReply, setError }: Args) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  // Key is `${team}-${server_key}`, rows come from ARKM_scan_detail (written
  // by DecayManager 5.3.0+ at every scan).
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detailRows, setDetailRows] = useState<ScanDetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  // What the detail table shows. Purely a view filter: it never touches
  // the snapshot, and a hidden row is still there when you turn it back on.
  const [detailKinds, setDetailKinds] = useState({ structure: true, dino: true })
  const [detailTruncated, setDetailTruncated] = useState(false)
  // Bumped by every detail open/close: a response that is no longer the
  // latest request is dropped.
  const detailReq = useRef(0)

  /** Load (or reload) the detail of one row, leaving it open. */
  async function openDetail(p: PendingItem) {
    const req = ++detailReq.current
    setDetailKey(`${p.targeting_team}-${p.server_key}`)
    setDetailRows([]); setDetailLoading(true)
    try {
      const res = await arkDecayApi.pendingDetail(p.targeting_team, p.server_key)
      if (req !== detailReq.current) return
      setDetailRows(res.data.detail || [])
      setDetailTruncated(!!res.data.truncated)
    } catch {
      if (req === detailReq.current) setDetailRows([])
    } finally {
      if (req === detailReq.current) setDetailLoading(false)
    }
  }

  async function toggleDetail(p: PendingItem) {
    const key = `${p.targeting_team}-${p.server_key}`
    if (detailKey === key) {
      detailReq.current++
      setDetailKey(null); setDetailRows([]); setDetailLoading(false)
      return
    }
    await openDetail(p)
  }

  async function destroyOne(row: ScanDetailItem, idx: number) {
    // The object's own map, never the toolbar: targeting_team is per map.
    const tgt = targetFor(instances, cmdInstance, row.server_key)
    if (!row.actor_name || !tgt) return
    const label = row.custom_name || row.display_name || row.class_name
    const ok = await confirm({
      title: t('decay.detail.destroyOneTitle'),
      description: `${t('decay.detail.confirmDestroyOne', { what: label })} ${t('decay.cmd.onServer', { server: instanceLabel(tgt) })}`,
      confirmLabel: t('decay.detail.destroyOneAction'),
      tone: 'danger',
    })
    if (!ok) return
    setCmdBusy(`obj-${idx}`); setError('')
    const req = detailReq.current
    try {
      const res = await arkDecayApi.destroyActor(tgt.id, row.targeting_team, row.actor_name)
      if (res.data.status !== 'success') {
        setError(res.data.stderr || res.data.reply || t('decay.cmd.rconFailed'))
        return
      }
      setCmdReply(res.data.reply || '')
      // idx points into the list the click came from; skip if it was reloaded.
      if (req === detailReq.current) setDetailRows(rows => rows.filter((_, i) => i !== idx))
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setCmdBusy(null)
    }
  }

  // Each visible row keeps its index in detailRows, so destroyOne() still
  // removes the right one after a filter change.
  const detailVisible = detailRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => detailKinds[r.actor_type as 'structure' | 'dino'] !== false)
  const nDetailStruct = detailRows.filter(r => r.actor_type === 'structure').length
  const nDetailDino = detailRows.filter(r => r.actor_type === 'dino').length

  return {
    detailKey, detailRows, detailLoading, detailTruncated,
    detailKinds, setDetailKinds,
    detailVisible, nDetailStruct, nDetailDino,
    openDetail, toggleDetail, destroyOne,
  }
}

export type ScanDetail = ReturnType<typeof useScanDetail>
