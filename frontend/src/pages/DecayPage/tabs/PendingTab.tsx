/**
 * PendingTab — the tribes staged in ARKM_decay_pending, each expandable into
 * the plugin's last scan of what a purge would destroy.
 */
import { useTranslation } from 'react-i18next'
import { CircleCheck } from 'lucide-react'
import type { ServerInstance } from '../../../types'
import { Card, EmptyState, Spinner, Table, TableMessageRow } from '../../../components/ui'
import type { ConfirmOptions } from '../../../components/ui'
import type { Pending } from '../../../hooks/usePending'
import { targetFor, type PendingItem } from '../decayModel'
import type { ScanDetail } from '../hooks/useScanDetail'
import type { CmdResponse } from '../hooks/useMapCommands'
import { PendingRow } from './PendingRow'
import { ScanDetailPanel } from './ScanDetailPanel'

const COLUMNS = 10

interface Props {
  pending: PendingItem[]
  loading: boolean
  instances: ServerInstance[]
  cmdInstance: number | ''
  cmdBusy: string | null
  isAdmin: boolean
  canOperate: boolean
  acting: Pending<number>
  detail: ScanDetail
  onCancel: (p: PendingItem) => void
  onGrant: (p: PendingItem, target: ServerInstance) => void
  runCmd: (key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) => Promise<void>
}

export function PendingTab({
  pending, loading, instances, cmdInstance, cmdBusy, isAdmin, canOperate, acting,
  detail, onCancel, onGrant, runCmd,
}: Props) {
  const { t } = useTranslation()

  return (
    <Card
      title={t('decay.tabs.pending')}
      flush
      actions={loading && pending.length > 0 ? <Spinner /> : undefined}
    >
      <Table label={t('decay.tabs.pending')} minWidth={1180}>
        <thead>
          <tr>
            <th scope="col">{t('decay.tribes.table.id')}</th>
            <th scope="col">{t('decay.tribes.table.name')}</th>
            <th scope="col">{t('decay.tribes.table.player')}</th>
            <th scope="col">{t('decay.pending.table.server')}</th>
            <th scope="col">{t('decay.pending.table.reason')}</th>
            <th scope="col" className="u-text-end">{t('decay.pending.table.structures')}</th>
            <th scope="col" className="u-text-end">{t('decay.pending.table.dinos')}</th>
            <th scope="col">{t('decay.pending.table.lastLogin')}</th>
            <th scope="col">{t('decay.pending.table.flaggedAt')}</th>
            <th scope="col" className="u-text-end">{t('decay.tribes.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && pending.length === 0 ? (
            <TableMessageRow colSpan={COLUMNS}><Spinner block label={t('decay.loading')} /></TableMessageRow>
          ) : pending.length === 0 ? (
            <TableMessageRow colSpan={COLUMNS}>
              <EmptyState icon={CircleCheck} title={t('decay.emptyPending')} />
            </TableMessageRow>
          ) : pending.map(p => {
            const key = `${p.targeting_team}-${p.server_key}`
            const target = targetFor(instances, cmdInstance, p.server_key)
            const open = detail.detailKey === key
            return (
              <PendingRow
                key={key}
                p={p}
                open={open}
                target={target}
                isAdmin={isAdmin}
                canOperate={canOperate}
                acting={acting}
                cmdBusy={cmdBusy}
                colSpan={COLUMNS}
                onToggleDetail={detail.toggleDetail}
                onCancel={onCancel}
                onGrant={onGrant}
                runCmd={runCmd}
                detail={open ? (
                  <ScanDetailPanel
                    p={p}
                    target={target}
                    isAdmin={isAdmin}
                    detail={detail}
                    cmdBusy={cmdBusy}
                    runCmd={runCmd}
                  />
                ) : null}
              />
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}
