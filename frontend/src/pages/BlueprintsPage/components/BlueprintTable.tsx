/**
 * The catalogue table: select-all, thumbnail + name, type, inline category
 * edit, the blueprint path with a copy button and the per-row delete.
 */
import { Check, Database, Pencil, RotateCw, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Alert, Badge, Button, Checkbox, CopyButton, EmptyState, IconButton, Select, Spinner,
  Table, TableMessageRow,
} from '../../../components/ui'
import type { Selection } from '../../../hooks/useSelection'
import { typeIcon, type BpItem } from '../blueprintsModel'
import styles from '../BlueprintsPage.module.css'
import { BpThumb } from './BpThumb'

const COLUMNS = 6

interface Props {
  items: BpItem[]
  loading: boolean
  loadError: string
  hasFilters: boolean
  canOperate: boolean
  selection: Selection<number>
  editingCat: number | null
  editCatValue: string
  setEditCatValue: (value: string) => void
  onStartEdit: (id: number, category: string) => void
  onSaveEdit: (id: number) => void
  onCancelEdit: () => void
  allCategories: string[]
  onDeleteOne: (id: number, name: string) => void
  onRetry: () => void
}

export function BlueprintTable({
  items, loading, loadError, hasFilters, canOperate, selection,
  editingCat, editCatValue, setEditCatValue, onStartEdit, onSaveEdit, onCancelEdit,
  allCategories, onDeleteOne, onRetry,
}: Props) {
  const { t } = useTranslation()

  return (
    <Table label={t('blueprints.table.label')} minWidth={880}>
      <thead>
        <tr>
          <th scope="col">
            <Checkbox
              aria-label={t('blueprints.table.selectAll')}
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
              disabled={!canOperate || items.length === 0}
            />
          </th>
          <th scope="col">{t('blueprints.table.name')}</th>
          <th scope="col">{t('blueprints.table.type')}</th>
          <th scope="col">{t('blueprints.table.category')}</th>
          <th scope="col">{t('blueprints.table.blueprintPath')}</th>
          <th scope="col" className="u-text-end">{t('blueprints.table.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {loadError ? (
          <TableMessageRow colSpan={COLUMNS}>
            <Alert
              tone="danger"
              title={loadError}
              actions={<Button size="sm" icon={RotateCw} onClick={onRetry}>{t('common.retry')}</Button>}
            />
          </TableMessageRow>
        ) : loading && items.length === 0 ? (
          <TableMessageRow colSpan={COLUMNS}>
            <Spinner block label={t('common.loading')} />
          </TableMessageRow>
        ) : items.length === 0 ? (
          <TableMessageRow colSpan={COLUMNS}>
            <EmptyState
              icon={Database}
              title={t('blueprints.table.emptyTitle')}
              description={hasFilters ? t('blueprints.table.emptyFiltered') : t('blueprints.table.emptyAll')}
            />
          </TableMessageRow>
        ) : items.map(item => {
          const isEditing = editingCat === item.id
          // The stored category may be gone from the option list; keep it.
          const options = allCategories.includes(editCatValue)
            ? allCategories
            : [editCatValue, ...allCategories].filter(Boolean)
          return (
            <tr key={item.id} data-selected={selection.isSelected(item.id) || undefined}>
              <td>
                <Checkbox
                  aria-label={t('blueprints.table.selectRow', { name: item.name })}
                  checked={selection.isSelected(item.id)}
                  onChange={() => selection.toggle(item.id)}
                  disabled={!canOperate}
                />
              </td>
              <td className="ui-cell-wrap">
                <span className={styles.nameCell}>
                  <BpThumb name={item.name} blueprint={item.blueprint} type={item.type} />
                  <span>{item.name}</span>
                </span>
              </td>
              <td>
                <Badge icon={typeIcon(item.type)}>{item.type}</Badge>
              </td>
              <td>
                {isEditing ? (
                  <div className={styles.catEdit}>
                    <Select
                      size="sm"
                      autoFocus
                      aria-label={t('blueprints.table.categoryFor', { name: item.name })}
                      value={editCatValue}
                      onChange={event => setEditCatValue(event.target.value)}
                    >
                      {options.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    <IconButton
                      size="sm"
                      icon={Check}
                      label={t('blueprints.table.saveCategory')}
                      onClick={() => onSaveEdit(item.id)}
                    />
                    <IconButton
                      size="sm"
                      icon={X}
                      label={t('common.cancel')}
                      onClick={onCancelEdit}
                    />
                  </div>
                ) : canOperate ? (
                  <button
                    type="button"
                    className="ui-row-button"
                    title={t('blueprints.table.changeCategoryTip')}
                    onClick={() => onStartEdit(item.id, item.category)}
                  >
                    {item.category}
                    <Pencil aria-hidden="true" size={12} strokeWidth={1.75} />
                  </button>
                ) : (
                  item.category
                )}
              </td>
              <td className="ui-cell-wrap">
                <span className={styles.pathCell}>
                  <span className="u-mono u-text-sm u-truncate" title={item.blueprint}>{item.blueprint}</span>
                  <CopyButton value={item.blueprint} label={t('blueprints.table.copyTip')} />
                </span>
              </td>
              <td>
                <div className="ui-row-actions">
                  {canOperate && (
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={Trash2}
                      label={t('blueprints.manage.deleteOneNamed', { name: item.name })}
                      onClick={() => onDeleteOne(item.id, item.name)}
                    />
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
