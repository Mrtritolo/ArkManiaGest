/**
 * ScanDetailPanel — the plugin's last snapshot of everything a purge would
 * destroy for one pending tribe.
 *
 * The kind toggles are a view filter only: a hidden row is still in the
 * snapshot, and each visible row keeps its index in the master list so a
 * single destroy removes the right one.
 */
import { useTranslation } from 'react-i18next'
import { Crosshair, Eye, EyeOff, RefreshCw, ScanSearch } from 'lucide-react'
import { arkDecayApi } from '../../../services/api'
import type { ServerInstance } from '../../../types'
import {
  Alert, Button, CopyButton, EmptyState, IconButton, Spinner, Table, TableMessageRow,
} from '../../../components/ui'
import type { ConfirmOptions } from '../../../components/ui'
import { instanceLabel, tpCommand, type PendingItem } from '../decayModel'
import type { ScanDetail } from '../hooks/useScanDetail'
import type { CmdResponse } from '../hooks/useMapCommands'

interface Props {
  p: PendingItem
  target: ServerInstance | null
  isAdmin: boolean
  detail: ScanDetail
  cmdBusy: string | null
  runCmd: (key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) => Promise<void>
}

export function ScanDetailPanel({ p, target, isAdmin, detail, cmdBusy, runCmd }: Props) {
  const { t } = useTranslation()
  const targetName = target ? instanceLabel(target) : ''
  const scanKey = `scan-${p.targeting_team}`

  if (detail.detailLoading) {
    return <Spinner block label={t('decay.detail.loading')} />
  }

  if (detail.detailRows.length === 0) {
    return (
      <EmptyState
        icon={ScanSearch}
        title={t('decay.detail.empty')}
        description={t('decay.detail.emptyHint')}
        // The snapshot only exists after a scan, so offer the scan right
        // here instead of sending the operator back to the toolbar to work
        // out which server this row is on.
        action={isAdmin ? (
          <Button
            size="sm"
            icon={RefreshCw}
            disabled={!target || cmdBusy !== null}
            loading={cmdBusy === scanKey}
            title={target ? t('decay.detail.scanHereTitle', { server: targetName }) : t('decay.cmd.noTarget')}
            onClick={() => target && runCmd(scanKey, async () => {
              const res = await arkDecayApi.scanInstance(target.id)
              await detail.openDetail(p)
              return res
            })}
          >
            {t('decay.detail.scanHere')}
          </Button>
        ) : undefined}
      />
    )
  }

  const kinds: ['structure' | 'dino', number, string][] = [
    ['structure', detail.nDetailStruct, t('playerMap.structures')],
    ['dino', detail.nDetailDino, t('playerMap.dinos')],
  ]

  return (
    <div className="l-stack l-stack--sm">
      {detail.detailTruncated && <Alert tone="warning">{t('decay.detail.truncated')}</Alert>}

      <div className="l-cluster">
        <span className="u-secondary u-text-sm">{t('decay.detail.showLabel')}</span>
        {kinds.map(([k, n, label]) => (
          <Button
            key={k}
            size="sm"
            icon={detail.detailKinds[k] ? Eye : EyeOff}
            pressed={detail.detailKinds[k]}
            onClick={() => detail.setDetailKinds(d => ({ ...d, [k]: !d[k] }))}
          >
            {`${label} (${n})`}
          </Button>
        ))}
        <span className="u-muted u-text-sm" role="status">
          {t('decay.detail.visibleCount', { shown: detail.detailVisible.length, total: detail.detailRows.length })}
        </span>
      </div>

      <Table label={t('decay.detail.title')} minWidth={760} maxHeight="20rem">
        <thead>
          <tr>
            <th scope="col">{t('decay.detail.type')}</th>
            <th scope="col">{t('decay.detail.name')}</th>
            <th scope="col">{t('decay.detail.owner')}</th>
            <th scope="col" className="u-text-end">{t('decay.detail.level')}</th>
            <th scope="col">{t('decay.detail.coords')}</th>
            <th scope="col" className="u-text-end">{t('decay.tribes.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.detailVisible.length === 0 ? (
            <TableMessageRow colSpan={6}>
              <EmptyState icon={EyeOff} title={t('decay.detail.allHidden')} />
            </TableMessageRow>
          ) : detail.detailVisible.map(({ r: row, i: idx }) => {
            const label = row.custom_name || row.display_name || row.class_name
            return (
              <tr key={idx}>
                <td>{t(`playerMap.kind.${row.actor_type}`, { defaultValue: row.actor_type })}</td>
                <td className="ui-cell-wrap" title={row.class_name}>{label}</td>
                <td className="u-muted">{row.owner_name || '—'}</td>
                <td className="u-num u-text-end">
                  {row.actor_type === 'dino' && row.dino_level > 0 ? row.dino_level : '—'}
                </td>
                <td className="u-mono u-text-sm u-muted">
                  {Math.round(row.pos_x)} {Math.round(row.pos_y)} {Math.round(row.pos_z)}
                </td>
                <td>
                  <div className="ui-row-actions">
                    <CopyButton value={tpCommand(row)} label={t('decay.detail.copyTpLabel', { what: label })} />
                    {isAdmin && row.actor_name && (
                      <IconButton
                        size="sm"
                        icon={Crosshair}
                        tone="danger"
                        label={target
                          ? t('decay.detail.destroyOneLabel', { what: label, server: targetName })
                          : t('decay.cmd.noTarget')}
                        disabled={!target || cmdBusy !== null}
                        loading={cmdBusy === `obj-${idx}`}
                        onClick={() => detail.destroyOne(row, idx)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
