/**
 * RareDinoTable — the configured pool.
 *
 * Operators get the enable switch and the edit/delete actions; a viewer sees
 * the same row with the state as a badge, because the backend would only ever
 * answer their write with a 403.
 */
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleOff, Edit2, Eye, Trash2 } from 'lucide-react'
import {
  Badge, CopyButton, EmptyState, IconButton, Spinner, Switch, Table, TableMessageRow,
} from '../../../components/ui'
import type { Pending } from '../../../hooks/usePending'
import { STATS, formatStat, type RareDino } from '../rareDinoModel'

interface Props {
  loading: boolean
  dinos: RareDino[]
  canOperate: boolean
  pending: Pending<number>
  onToggle: (dino: RareDino) => void
  onEdit: (dino: RareDino) => void
  onDelete: (dino: RareDino) => void
}

const COLUMNS = 4 + STATS.length

export function RareDinoTable({ loading, dinos, canOperate, pending, onToggle, onEdit, onDelete }: Props) {
  const { t } = useTranslation()

  return (
    <Table label={t('rareDinos.listTitle')} minWidth={1120}>
      <thead>
        <tr>
          <th scope="col">{t('rareDinos.table.dino')}</th>
          <th scope="col">{t('rareDinos.table.map')}</th>
          <th scope="col">{t('rareDinos.table.status')}</th>
          {STATS.map(s => (
            <th key={s.key} scope="col" className="u-text-end">{t(`rareDinos.stats.${s.key}`)}</th>
          ))}
          <th scope="col" className="u-text-end">{t('rareDinos.table.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <TableMessageRow colSpan={COLUMNS}><Spinner block label={t('rareDinos.loading')} /></TableMessageRow>
        ) : dinos.length === 0 ? (
          <TableMessageRow colSpan={COLUMNS}>
            <EmptyState icon={Eye} title={t('rareDinos.empty')} />
          </TableMessageRow>
        ) : dinos.map(dino => (
          <tr key={dino.id}>
            <td className="ui-cell-2">
              <span>{dino.display_name}</span>
              <span className="u-mono u-text-sm u-muted" title={dino.dino_bp}>
                {dino.dino_bp.split('/').pop()?.replace("'", '')}
              </span>
            </td>
            <td>
              {dino.map_name === '*'
                ? t('rareDinos.mapAll')
                : t(`rareDinos.maps.${dino.map_name}`, { defaultValue: dino.map_name.replace('_WP', '') })}
            </td>
            <td>
              {canOperate ? (
                <Switch
                  hideLabel
                  label={t('rareDinos.tooltip.toggle', { name: dino.display_name })}
                  checked={dino.enabled}
                  disabled={pending.isPending(dino.id)}
                  onChange={() => onToggle(dino)}
                />
              ) : dino.enabled ? (
                <Badge tone="success" icon={CircleCheck}>{t('rareDinos.filterEnabled.on')}</Badge>
              ) : (
                <Badge icon={CircleOff}>{t('rareDinos.filterEnabled.off')}</Badge>
              )}
            </td>
            {STATS.map(s => {
              const value = formatStat(
                (dino as unknown as Record<string, number>)[`${s.key}_min`],
                (dino as unknown as Record<string, number>)[`${s.key}_max`],
              )
              return (
                <td key={s.key} className="u-num u-text-end">
                  {value || <span className="u-muted">—</span>}
                </td>
              )
            })}
            <td>
              <div className="ui-row-actions">
                {canOperate && (
                  <IconButton
                    size="sm"
                    icon={Edit2}
                    label={t('rareDinos.tooltip.editName', { name: dino.display_name })}
                    onClick={() => onEdit(dino)}
                  />
                )}
                <CopyButton
                  value={dino.dino_bp}
                  label={t('rareDinos.tooltip.copyBpName', { name: dino.display_name })}
                />
                {canOperate && (
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    tone="danger"
                    label={t('rareDinos.tooltip.deleteName', { name: dino.display_name })}
                    loading={pending.isPending(dino.id)}
                    onClick={() => onDelete(dino)}
                  />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
