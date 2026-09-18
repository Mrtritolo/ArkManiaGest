/**
 * SourcesBar: what the catalogue was filled from, with the per-source and
 * filter-wide deletes. BulkActionBar: what to do with the current selection.
 */
import { Check, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, IconButton, Select } from '../../../components/ui'
import styles from '../BlueprintsPage.module.css'

interface NamedCount { name: string; count: number }

export function SourcesBar({
  sourcesList, total, deleting, canOperate, onDeleteSource, onDeleteFiltered, onPrune,
}: {
  sourcesList: NamedCount[]
  total: number
  deleting: boolean
  canOperate: boolean
  onDeleteSource: (source: string) => void
  onDeleteFiltered: () => void
  onPrune: () => void
}) {
  const { t } = useTranslation()
  if (sourcesList.length === 0) return null

  return (
    <Card title={t('blueprints.manage.sourcesLabel')}>
      <div className="l-cluster">
        {sourcesList.map(s => (
          <span key={s.name || '_none'} className={styles.sourceChip}>
            <strong>{s.name || t('blueprints.manage.noSource')}</strong>
            <span className="ui-count">{s.count}</span>
            {s.name && canOperate && (
              <IconButton
                size="sm"
                tone="danger"
                icon={Trash2}
                disabled={deleting}
                label={t('blueprints.manage.deleteSourceTitle', { source: s.name })}
                onClick={() => onDeleteSource(s.name)}
              />
            )}
          </span>
        ))}
        {canOperate && (
          <>
            <Button
              className="u-push"
              variant="danger"
              size="sm"
              icon={Trash2}
              disabled={deleting || total === 0}
              title={t('blueprints.manage.deleteFilteredTitle')}
              onClick={onDeleteFiltered}
            >
              {t('blueprints.manage.deleteFiltered', { count: total })}
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              disabled={deleting}
              title={t('blueprints.manage.pruneTitle')}
              onClick={onPrune}
            >
              {t('blueprints.manage.prune')}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

export function BulkActionBar({
  selectedCount, bulkCat, setBulkCat, allCategories, deleting,
  onApplyCategory, onDeleteSelected, onClear,
}: {
  selectedCount: number
  bulkCat: string
  setBulkCat: (value: string) => void
  allCategories: string[]
  deleting: boolean
  onApplyCategory: () => void
  onDeleteSelected: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="ui-actionbar">
      <span role="status" className="u-secondary u-text-sm">
        {t('ui.selectedCount', { count: selectedCount })}
      </span>
      <Select
        size="sm"
        aria-label={t('blueprints.bulk.setCategory')}
        value={bulkCat}
        onChange={event => setBulkCat(event.target.value)}
      >
        <option value="">{t('blueprints.bulk.setCategory')}</option>
        {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
      </Select>
      <Button
        size="sm"
        variant="primary"
        icon={Check}
        disabled={!bulkCat}
        title={bulkCat ? undefined : t('blueprints.bulk.pickCategoryFirst')}
        onClick={onApplyCategory}
      >
        {t('blueprints.bulk.apply')}
      </Button>
      <Button size="sm" icon={X} className="u-push" onClick={onClear}>
        {t('blueprints.bulk.clear')}
      </Button>
      <Button size="sm" variant="danger" icon={Trash2} disabled={deleting} onClick={onDeleteSelected}>
        {t('blueprints.manage.deleteSelected')}
      </Button>
    </div>
  )
}
