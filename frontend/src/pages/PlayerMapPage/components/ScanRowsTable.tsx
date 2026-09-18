/**
 * ScanRowsTable — the scan as a list, sortable and selectable.
 *
 * Memoised: on a big base this is thousands of rows, and a pan of the map
 * must not rebuild any of them. `onSelect` takes the index into the MASTER
 * row list, never the visible position.
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { MapCalib } from '../../../utils/mapCalibration'
import { SortableHeader, Table } from '../../../components/ui'
import { latLonCells, rowName, uuLabel, type ScanRow, type ScanSort, type SortKey } from '../mapModel'

interface Props {
  visible: { r: ScanRow; i: number }[]
  selected: number | null
  onSelect: (index: number) => void
  sort: ScanSort
  onToggleSort: (key: SortKey) => void
  calib: MapCalib | null
}

function ScanRowsTableInner({ visible, selected, onSelect, sort, onToggleSort, calib }: Props) {
  const { t } = useTranslation()

  return (
    <Table label={t('playerMap.rowsTitle')} minWidth={560} maxHeight="26rem">
      <thead>
        <tr>
          <SortableHeader label={t('decay.detail.type')} sortKey="type" sort={sort} onSort={onToggleSort} />
          <SortableHeader label={t('decay.detail.name')} sortKey="name" sort={sort} onSort={onToggleSort} />
          <SortableHeader label={t('decay.detail.level')} sortKey="level" sort={sort} onSort={onToggleSort} align="end" />
          <SortableHeader label={t('playerMap.lat')} sortKey="lat" sort={sort} onSort={onToggleSort} align="end" />
          <SortableHeader label={t('playerMap.lon')} sortKey="lon" sort={sort} onSort={onToggleSort} align="end" />
        </tr>
      </thead>
      <tbody>
        {visible.map(({ r, i }) => {
          const [lat, lon] = latLonCells(r, calib)
          const uu = uuLabel(r)
          return (
            <tr
              key={i}
              data-selected={i === selected || undefined}
              className="ui-row-clickable"
              onClick={() => onSelect(i)}
            >
              <td>
                {r.actor_type === 'player'
                  ? (r.is_online ? t('playerMap.online') : t('playerMap.offline'))
                  : t(`playerMap.kind.${r.actor_type}`, { defaultValue: r.actor_type })}
              </td>
              <td className="ui-cell-wrap">
                <button
                  type="button"
                  className="ui-row-button"
                  title={r.class_name}
                  onClick={() => onSelect(i)}
                >
                  {rowName(r)}
                </button>
              </td>
              <td className="u-num u-text-end">
                {r.actor_type === 'dino' && r.dino_level > 0 ? r.dino_level : '—'}
              </td>
              {/* Lat and Lon are separate cells only so each header can sort
                  on its own axis; the UU triplet stays in the title. */}
              <td className="u-num u-text-end u-text-sm u-muted" title={uu}>{lat}</td>
              <td className="u-num u-text-end u-text-sm u-muted" title={uu}>{lon}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export const ScanRowsTable = memo(ScanRowsTableInner)
