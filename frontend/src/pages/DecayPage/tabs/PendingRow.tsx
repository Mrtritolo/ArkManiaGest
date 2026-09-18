/**
 * PendingRow — one staged tribe, plus the detail panel it expands into.
 *
 * Cancelling the entry is require_operator. The three plugin commands
 * (grant, remove structures, remove dinos) are require_admin and always aim
 * at the row's OWN map: targeting_team is assigned per map, so the toolbar
 * selection is only used when it serves that same map.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Building, CalendarPlus, CircleX, MapPin, Skull, TriangleAlert } from 'lucide-react'
import { arkDecayApi } from '../../../services/api'
import { fmtShortDateTime } from '../../../utils/format'
import type { ServerInstance } from '../../../types'
import { Badge, Button, IconButton } from '../../../components/ui'
import type { ConfirmOptions } from '../../../components/ui'
import type { Pending } from '../../../hooks/usePending'
import {
  HEAVY_STRUCTURES, RECENT_LOGIN_DAYS, daysSince, instanceLabel, type PendingItem,
} from '../decayModel'
import type { CmdResponse } from '../hooks/useMapCommands'

interface Props {
  p: PendingItem
  open: boolean
  target: ServerInstance | null
  isAdmin: boolean
  canOperate: boolean
  acting: Pending<number>
  cmdBusy: string | null
  colSpan: number
  onToggleDetail: (p: PendingItem) => void
  onCancel: (p: PendingItem) => void
  onGrant: (p: PendingItem, target: ServerInstance) => void
  runCmd: (key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) => Promise<void>
  detail: ReactNode
}

export function PendingRow({
  p, open, target, isAdmin, canOperate, acting, cmdBusy, colSpan,
  onToggleDetail, onCancel, onGrant, runCmd, detail,
}: Props) {
  const { t } = useTranslation()
  const sinceLogin = daysSince(p.last_member_login)
  const detailId = `decay-detail-${p.targeting_team}-${p.server_key}`
  const targetName = target ? instanceLabel(target) : ''
  const noTarget = t('decay.cmd.noTarget')

  return (
    <>
      <tr>
        <td className="u-mono">{p.targeting_team}</td>
        <td>{p.tribe_name || <span className="u-muted">{t('decay.unknownTribe')}</span>}</td>
        <td>{p.player_name || <span className="u-muted">—</span>}</td>
        <td>{p.server_name || p.server_key.split('_')[0]}</td>
        <td>
          {p.reason === 'orphaned' ? (
            <Badge tone="warning" icon={TriangleAlert}>{t('decay.reason.orphaned')}</Badge>
          ) : p.reason === 'expired' ? (
            <Badge tone="danger" icon={TriangleAlert}>{t('decay.reason.expired')}</Badge>
          ) : (
            <Badge>{p.reason}</Badge>
          )}
        </td>
        <td className="u-text-end">
          {p.structure_count > HEAVY_STRUCTURES ? (
            <Badge tone="warning" icon={TriangleAlert}>
              {t('decay.pending.heavyStructures', { count: p.structure_count })}
            </Badge>
          ) : (
            <span className="u-num">{p.structure_count.toLocaleString(undefined)}</span>
          )}
        </td>
        <td className="u-num u-text-end">{p.dino_count}</td>
        <td>
          {sinceLogin === null ? (
            <span className="u-muted">{t('decay.pending.never')}</span>
          ) : sinceLogin <= RECENT_LOGIN_DAYS ? (
            <Badge tone="warning" icon={TriangleAlert}>{t('decay.pending.daysAgo', { d: sinceLogin })}</Badge>
          ) : (
            <span className="u-muted">{t('decay.pending.daysAgo', { d: sinceLogin })}</span>
          )}
        </td>
        <td className="u-text-sm u-muted">{fmtShortDateTime(p.flagged_at)}</td>
        <td>
          <div className="ui-row-actions">
            {/* The detail toggle keeps its label: it is the action operators
                reach for on nearly every row, and as a bare icon among five
                it was simply not findable. The three plugin commands stay
                icon-only, each naming its target server in the label. */}
            <Button
              size="sm"
              icon={MapPin}
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              onClick={() => onToggleDetail(p)}
            >
              {open ? t('decay.detail.hide') : t('decay.detail.show')}
            </Button>
            {canOperate && (
              <IconButton
                size="sm"
                icon={CircleX}
                label={t('decay.cancelRowTitle', {
                  id: p.targeting_team,
                  server: p.server_name || p.server_key.split('_')[0],
                })}
                loading={acting.isPending(p.targeting_team)}
                disabled={acting.anyPending}
                onClick={() => onCancel(p)}
              />
            )}
            {isAdmin && (
              <>
                <IconButton
                  size="sm"
                  icon={CalendarPlus}
                  label={target ? t('decay.cmd.grantRowTitle', { server: targetName }) : noTarget}
                  disabled={!target || cmdBusy !== null}
                  onClick={() => target && onGrant(p, target)}
                />
                <IconButton
                  size="sm"
                  icon={Building}
                  tone="danger"
                  label={target ? t('decay.cmd.structsRowTitle', { server: targetName }) : noTarget}
                  disabled={!target || cmdBusy !== null}
                  loading={cmdBusy === `str-${p.targeting_team}`}
                  onClick={() => target && runCmd(
                    `str-${p.targeting_team}`,
                    () => arkDecayApi.removeStructures(target.id, p.targeting_team),
                    {
                      title: t('decay.cmd.structsTitle'),
                      description: t('decay.cmd.confirmStructs', { team: p.targeting_team, server: targetName }),
                      confirmLabel: t('decay.cmd.structsAction'),
                      tone: 'danger',
                    },
                  )}
                />
                <IconButton
                  size="sm"
                  icon={Skull}
                  tone="danger"
                  label={target ? t('decay.cmd.dinosRowTitle', { server: targetName }) : noTarget}
                  disabled={!target || cmdBusy !== null}
                  loading={cmdBusy === `din-${p.targeting_team}`}
                  onClick={() => target && runCmd(
                    `din-${p.targeting_team}`,
                    () => arkDecayApi.removeDinos(target.id, p.targeting_team),
                    {
                      title: t('decay.cmd.dinosTitle'),
                      description: t('decay.cmd.confirmDinos', { team: p.targeting_team, server: targetName }),
                      confirmLabel: t('decay.cmd.dinosAction'),
                      tone: 'danger',
                    },
                  )}
                />
              </>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={colSpan} id={detailId}>{detail}</td>
        </tr>
      )}
    </>
  )
}
