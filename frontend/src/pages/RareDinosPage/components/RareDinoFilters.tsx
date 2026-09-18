/**
 * RareDinoFilters — client-side search, map scope and on/off filter for the
 * pool table. Nothing here hits the API, so the search needs no debounce.
 */
import { useTranslation } from 'react-i18next'
import { Input, SegmentedControl, Select } from '../../../components/ui'

export type EnabledFilter = 'all' | 'on' | 'off'

interface Props {
  search: string
  setSearch: (v: string) => void
  filterMap: string
  setFilterMap: (v: string) => void
  filterEnabled: EnabledFilter
  setFilterEnabled: (v: EnabledFilter) => void
  maps: string[]
  count: number
}

export function RareDinoFilters({
  search, setSearch, filterMap, setFilterMap, filterEnabled, setFilterEnabled, maps, count,
}: Props) {
  const { t } = useTranslation()

  return (
    <>
      <Input
        type="search"
        size="sm"
        aria-label={t('rareDinos.searchPlaceholder')}
        placeholder={t('rareDinos.searchPlaceholder')}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <Select
        size="sm"
        aria-label={t('rareDinos.filterMap.label')}
        value={filterMap}
        onChange={e => setFilterMap(e.target.value)}
      >
        <option value="all">{t('rareDinos.filterMap.all')}</option>
        <option value="*">{t('rareDinos.filterMap.global')}</option>
        {maps.filter(m => m !== '*').map(m => (
          <option key={m} value={m}>{t(`rareDinos.maps.${m}`, { defaultValue: m })}</option>
        ))}
      </Select>
      <SegmentedControl
        size="sm"
        label={t('rareDinos.filterEnabled.label')}
        options={[
          { value: 'all', label: t('rareDinos.filterEnabled.all') },
          { value: 'on', label: t('rareDinos.filterEnabled.on') },
          { value: 'off', label: t('rareDinos.filterEnabled.off') },
        ]}
        value={filterEnabled}
        onChange={setFilterEnabled}
      />
      <span className="u-muted u-text-sm" role="status">
        {t('rareDinos.resultsCount', { count })}
      </span>
    </>
  )
}
