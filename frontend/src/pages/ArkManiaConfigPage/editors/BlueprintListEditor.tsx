/**
 * Array-of-blueprints editor: the current list, a catalogue typeahead filtered
 * by item type, and a manual paste box for a path the catalogue does not hold.
 *
 * The search is debounced and its answers are guarded: the old hand-rolled
 * timer left "Searching..." on screen forever when the query dropped below two
 * characters inside the debounce window.
 */
import { useEffect, useState } from 'react'
import { Package, Plus, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi, type BlueprintRow } from '../../../services/api'
import { Badge, Button, Combobox, CopyButton, Field, IconButton, Input, SegmentedControl } from '../../../components/ui'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { extractBlueprintName, shortBlueprint } from '../configModel'
import styles from '../ArkManiaConfigPage.module.css'

interface Option { name: string; blueprint: string; type: string; category: string }

const TYPE_FILTER_KEYS = [
  { value: '', labelKey: 'arkmaniaConfig.typeFilter.all' },
  { value: 'item', labelKey: 'arkmaniaConfig.typeFilter.items' },
  { value: 'armor', labelKey: 'arkmaniaConfig.typeFilter.armor' },
  { value: 'weapon', labelKey: 'arkmaniaConfig.typeFilter.weapons' },
  { value: 'dino', labelKey: 'arkmaniaConfig.typeFilter.dino' },
  { value: 'resource', labelKey: 'arkmaniaConfig.typeFilter.resources' },
  { value: 'consumable', labelKey: 'arkmaniaConfig.typeFilter.consumable' },
] as const

const TYPE_BADGE_KEYS: Record<string, string> = {
  dino: 'arkmaniaConfig.typeBadge.dino',
  armor: 'arkmaniaConfig.typeBadge.armor',
  weapon: 'arkmaniaConfig.typeBadge.weapon',
  resource: 'arkmaniaConfig.typeBadge.resource',
  consumable: 'arkmaniaConfig.typeBadge.consumable',
  structure: 'arkmaniaConfig.typeBadge.structure',
  item: 'arkmaniaConfig.typeBadge.item',
}

interface Props {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

export function BlueprintListEditor({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  let items: string[] = []
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) items = parsed } catch { items = [] }

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const debounced = useDebouncedValue(query)

  useEffect(() => {
    if (!showSearch || debounced.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    const params: Record<string, string | number> = { search: debounced, limit: 12 }
    if (typeFilter) params.type = typeFilter
    blueprintsApi.list(params)
      .then(res => {
        if (!alive) return
        setResults((res.data.items ?? []).map((i: BlueprintRow) => ({
          name: i.name, blueprint: i.blueprint, type: i.type || 'item', category: i.category || '',
        })))
      })
      .catch(() => { if (alive) setResults([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [debounced, typeFilter, showSearch])

  function addBlueprint(bp: string) {
    const trimmed = bp.trim()
    if (trimmed && !items.includes(trimmed)) onChange(JSON.stringify([...items, trimmed]))
    setQuery(''); setResults([]); setPasteValue(''); setShowPaste(false)
  }

  return (
    <div className="l-stack l-stack--sm">
      {items.length === 0 && <p className="u-muted u-text-sm">{t('arkmaniaConfig.editors.noBlueprints')}</p>}
      {items.map((bp, index) => (
        <div key={bp} className={styles.row}>
          <Package aria-hidden="true" size={16} strokeWidth={1.75} />
          <span className={`u-truncate ${styles.rowMain}`}>{extractBlueprintName(bp)}</span>
          <span className="u-mono u-text-sm u-muted u-truncate" title={bp}>{shortBlueprint(bp)}</span>
          <CopyButton value={bp} label={t('arkmaniaConfig.editors.copyBp')} />
          <IconButton
            size="sm"
            tone="danger"
            icon={X}
            disabled={disabled}
            label={t('arkmaniaConfig.editors.removeBlueprint', { name: extractBlueprintName(bp) })}
            onClick={() => onChange(JSON.stringify(items.filter((_, i) => i !== index)))}
          />
        </div>
      ))}

      {!showSearch && !showPaste && !disabled && (
        <div className="l-cluster">
          <Button size="sm" icon={Search} onClick={() => { setShowSearch(true); setShowPaste(false) }}>
            {t('arkmaniaConfig.editors.searchDb')}
          </Button>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setShowPaste(true); setShowSearch(false) }}>
            {t('arkmaniaConfig.editors.pasteBp')}
          </Button>
        </div>
      )}

      {showSearch && (
        <div className="l-stack l-stack--sm">
          <div className="l-cluster">
            <SegmentedControl
              size="sm"
              label={t('arkmaniaConfig.editors.typeFilterLabel')}
              value={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_FILTER_KEYS.map(f => ({ value: f.value, label: t(f.labelKey) }))}
            />
            <IconButton
              size="sm"
              className="u-push"
              icon={X}
              label={t('arkmaniaConfig.editors.closeSearch')}
              onClick={() => { setShowSearch(false); setQuery(''); setResults([]) }}
            />
          </div>
          <Field label={t('arkmaniaConfig.editors.bpSearchPlaceholder')}>
            <Combobox<Option>
              inputValue={query}
              onInputChange={setQuery}
              options={results}
              loading={loading}
              emptyText={t('arkmaniaConfig.editors.noBpResults')}
              placeholder={t('arkmaniaConfig.editors.bpSearchPlaceholder')}
              getKey={option => option.blueprint}
              renderOption={option => (
                <div className="l-cluster">
                  <Badge>{t(TYPE_BADGE_KEYS[option.type] ?? TYPE_BADGE_KEYS.item)}</Badge>
                  <span>{option.name}</span>
                  <span className="u-muted u-text-sm u-mono">{shortBlueprint(option.blueprint)}</span>
                  {items.includes(option.blueprint) && (
                    <span className="u-muted u-text-sm">{t('arkmaniaConfig.editors.alreadyAdded')}</span>
                  )}
                </div>
              )}
              onSelect={option => addBlueprint(option.blueprint)}
            />
          </Field>
        </div>
      )}

      {showPaste && (
        <div className="l-cluster">
          <Input
            autoFocus
            mono
            aria-label={t('arkmaniaConfig.editors.pastePlaceholder')}
            placeholder={t('arkmaniaConfig.editors.pastePlaceholder')}
            value={pasteValue}
            onChange={event => setPasteValue(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && pasteValue.trim()) addBlueprint(pasteValue) }}
          />
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            disabled={!pasteValue.trim()}
            onClick={() => { if (pasteValue.trim()) addBlueprint(pasteValue) }}
          >
            {t('arkmaniaConfig.editors.addLabel')}
          </Button>
          <IconButton
            size="sm"
            icon={X}
            label={t('arkmaniaConfig.editors.closePaste')}
            onClick={() => { setShowPaste(false); setPasteValue('') }}
          />
        </div>
      )}
    </div>
  )
}
