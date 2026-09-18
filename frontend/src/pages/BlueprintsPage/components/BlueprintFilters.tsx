/**
 * Type chips plus the search box and the category / source selects. Search is
 * explicit (Enter or the Search button); the selects apply immediately.
 */
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Input, Select } from '../../../components/ui'
import { typeIcon } from '../blueprintsModel'

interface NamedCount { name: string; count: number }

interface Props {
  types: NamedCount[]
  typeFilter: string
  onTypeChange: (value: string) => void
  categories: NamedCount[]
  catFilter: string
  onCatChange: (value: string) => void
  sourcesList: NamedCount[]
  sourceFilter: string
  onSourceChange: (value: string) => void
  search: string
  setSearch: (value: string) => void
  onSearch: () => void
}

export function BlueprintFilters({
  types, typeFilter, onTypeChange,
  categories, catFilter, onCatChange,
  sourcesList, sourceFilter, onSourceChange,
  search, setSearch, onSearch,
}: Props) {
  const { t } = useTranslation()

  return (
    <Card title={t('blueprints.filters.title')}>
      <div className="l-stack l-stack--sm">
        {types.length > 0 && (
          <div className="l-cluster" role="group" aria-label={t('blueprints.filters.typeGroup')}>
            {types.map(ty => {
              const active = typeFilter === ty.name
              return (
                <Button
                  key={ty.name}
                  size="sm"
                  icon={typeIcon(ty.name)}
                  pressed={active}
                  onClick={() => onTypeChange(active ? '' : ty.name)}
                >
                  {t('blueprints.filters.typeChip', { name: ty.name, count: ty.count })}
                </Button>
              )
            })}
          </div>
        )}
        <div className="l-cluster">
          <Input
            type="search"
            aria-label={t('blueprints.filters.searchLabel')}
            placeholder={t('blueprints.filters.searchPlaceholder')}
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onSearch() }}
          />
          <Button icon={Search} onClick={onSearch}>{t('blueprints.filters.searchButton')}</Button>
          <Select
            aria-label={t('blueprints.filters.allCategories')}
            value={catFilter}
            onChange={event => onCatChange(event.target.value)}
          >
            <option value="">{t('blueprints.filters.allCategories')}</option>
            {categories.map(c => (
              <option key={c.name} value={c.name}>
                {t('blueprints.filters.categoryOption', { name: c.name, count: c.count })}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('blueprints.manage.sourceFilterTitle')}
            title={t('blueprints.manage.sourceFilterTitle')}
            value={sourceFilter}
            onChange={event => onSourceChange(event.target.value)}
          >
            <option value="">{t('blueprints.manage.allSources')}</option>
            {sourcesList.map(s => (
              <option key={s.name} value={s.name}>
                {t('blueprints.manage.sourceOption', {
                  name: s.name || t('blueprints.manage.noSource'), count: s.count,
                })}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Card>
  )
}
