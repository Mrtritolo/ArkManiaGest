/**
 * CraftLimit `struct.rules`: a list of structures, each with a blueprint and a
 * crafting-speed / max-count limit per permission group. One rule is expanded
 * at a time and only the expanded one searches the blueprint catalogue.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, Hammer, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi, type BlueprintRow } from '../../../services/api'
import { Badge, Button, Combobox, Field, IconButton, Input, Select } from '../../../components/ui'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { shortBlueprint } from '../configModel'
import styles from '../ArkManiaConfigPage.module.css'

interface CraftLimit { CraftingSpeedMultiplier: number; MaxItemCount: number }
interface CraftRule { Name: string; Blueprint: string; Groups: Record<string, CraftLimit> }
interface Option { name: string; blueprint: string }

function structureName(bp: string): string {
  const match = bp.match(/\.([^.]+)'?$/)
  if (!match) return bp.slice(0, 50)
  return match[1].replace(/^PrimalItemStructure_/, '').replace(/_/g, ' ')
}

interface Props {
  value: string
  onChange: (value: string) => void
  availableGroups: string[]
  disabled: boolean
}

export function CraftLimitRulesEditor({ value, onChange, availableGroups, disabled }: Props) {
  const { t } = useTranslation()
  let rules: CraftRule[] = []
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) rules = parsed } catch { rules = [] }

  const [expandedIdx, setExpandedIdx] = useState<number | null>(rules.length === 0 ? null : 0)
  const [searchIdx, setSearchIdx] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebouncedValue(query)

  useEffect(() => {
    if (searchIdx === null || debounced.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    blueprintsApi.list({ search: debounced, type: 'structure', limit: 10 })
      .then(res => {
        if (!alive) return
        setResults((res.data.items ?? []).map((i: BlueprintRow) => ({ name: i.name, blueprint: i.blueprint })))
      })
      .catch(() => { if (alive) setResults([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [debounced, searchIdx])

  const persist = (next: CraftRule[]) => onChange(JSON.stringify(next))
  const updateRule = (index: number, patch: Partial<CraftRule>) =>
    persist(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))

  function updateGroup(index: number, group: string, patch: Partial<CraftLimit>) {
    persist(rules.map((rule, i) => (i === index
      ? { ...rule, Groups: { ...rule.Groups, [group]: { ...rule.Groups[group], ...patch } } }
      : rule)))
  }

  function removeGroup(index: number, group: string) {
    persist(rules.map((rule, i) => {
      if (i !== index) return rule
      const rest: Record<string, CraftLimit> = {}
      for (const key of Object.keys(rule.Groups)) if (key !== group) rest[key] = rule.Groups[key]
      return { ...rule, Groups: rest }
    }))
  }

  return (
    <div className="l-stack l-stack--sm">
      {rules.length === 0 && <p className="u-muted u-text-sm">{t('arkmaniaConfig.editors.noCraftRules')}</p>}
      {rules.map((rule, index) => {
        const isOpen = expandedIdx === index
        const groupNames = Object.keys(rule.Groups)
        const panelId = `craft-rule-${index}`
        const remaining = availableGroups.filter(g => !groupNames.includes(g))
        return (
          <div key={index} className="l-stack l-stack--sm">
            <div className={styles.row}>
              <Hammer aria-hidden="true" size={16} strokeWidth={1.75} />
              <span className={`u-truncate ${styles.rowMain}`}>
                {rule.Name || t('arkmaniaConfig.editors.unnamed')}
              </span>
              <span className="u-mono u-text-sm u-muted u-truncate" title={rule.Blueprint}>
                {rule.Blueprint ? shortBlueprint(rule.Blueprint) : t('arkmaniaConfig.editors.noBlueprintTag')}
              </span>
              <Badge>{t('arkmaniaConfig.editors.groupCount', { count: groupNames.length })}</Badge>
              <IconButton
                size="sm"
                icon={ChevronDown}
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                label={isOpen
                  ? t('arkmaniaConfig.editors.collapseRule', { name: rule.Name || String(index + 1) })
                  : t('arkmaniaConfig.editors.expandRule', { name: rule.Name || String(index + 1) })}
                onClick={() => setExpandedIdx(isOpen ? null : index)}
              />
              <IconButton
                size="sm"
                tone="danger"
                icon={Trash2}
                disabled={disabled}
                label={t('arkmaniaConfig.editors.removeRuleNamed', { name: rule.Name || String(index + 1) })}
                onClick={() => {
                  persist(rules.filter((_, i) => i !== index))
                  if (expandedIdx === index) setExpandedIdx(null)
                }}
              />
            </div>

            {isOpen && (
              <div id={panelId} className="l-stack l-stack--sm">
                <Field label={t('arkmaniaConfig.editors.nameLabel')}>
                  <Input
                    value={rule.Name}
                    disabled={disabled}
                    onChange={event => updateRule(index, { Name: event.target.value })}
                  />
                </Field>
                <Field label={t('arkmaniaConfig.editors.blueprintLabel')}>
                  <Input
                    mono
                    value={rule.Blueprint}
                    disabled={disabled}
                    placeholder={t('arkmaniaConfig.editors.blueprintPlaceholder')}
                    onChange={event => updateRule(index, { Blueprint: event.target.value })}
                  />
                </Field>
                <div className="l-cluster">
                  <Button
                    size="sm"
                    icon={Hammer}
                    disabled={disabled}
                    aria-expanded={searchIdx === index}
                    onClick={() => {
                      setSearchIdx(searchIdx === index ? null : index)
                      setQuery(''); setResults([])
                    }}
                  >
                    {t('arkmaniaConfig.editors.findButton')}
                  </Button>
                </div>
                {searchIdx === index && (
                  <Field label={t('arkmaniaConfig.editors.searchStructuresPlaceholder')}>
                    <Combobox<Option>
                      inputValue={query}
                      onInputChange={setQuery}
                      options={results}
                      loading={loading}
                      placeholder={t('arkmaniaConfig.editors.searchStructuresPlaceholder')}
                      getKey={option => option.blueprint}
                      renderOption={option => (
                        <div className="l-cluster">
                          <span>{option.name}</span>
                          <span className="u-muted u-text-sm u-mono">{shortBlueprint(option.blueprint)}</span>
                        </div>
                      )}
                      onSelect={option => {
                        updateRule(index, {
                          Blueprint: option.blueprint,
                          Name: rule.Name || structureName(option.blueprint),
                        })
                        setSearchIdx(null)
                        setQuery('')
                      }}
                    />
                  </Field>
                )}

                <fieldset className="ui-fieldset">
                  <legend>{t('arkmaniaConfig.editors.limitsPerGroup')}</legend>
                  {groupNames.map(group => {
                    const limit = rule.Groups[group]
                    return (
                      <div key={group} className={styles.limitRow}>
                        <Badge tone="accent">{group}</Badge>
                        <Input
                          size="sm"
                          mono
                          type="number"
                          step="0.1"
                          aria-label={t('arkmaniaConfig.editors.speedFor', { group })}
                          value={limit.CraftingSpeedMultiplier}
                          disabled={disabled}
                          onChange={event => updateGroup(index, group, { CraftingSpeedMultiplier: Number(event.target.value) })}
                        />
                        <Input
                          size="sm"
                          mono
                          type="number"
                          aria-label={t('arkmaniaConfig.editors.maxFor', { group })}
                          value={limit.MaxItemCount}
                          disabled={disabled}
                          onChange={event => updateGroup(index, group, { MaxItemCount: Number(event.target.value) })}
                        />
                        <IconButton
                          size="sm"
                          tone="danger"
                          icon={X}
                          disabled={disabled}
                          label={t('arkmaniaConfig.editors.removeGroup', { group })}
                          onClick={() => removeGroup(index, group)}
                        />
                      </div>
                    )
                  })}
                  {remaining.length > 0 && !disabled && (
                    <Select
                      size="sm"
                      aria-label={t('arkmaniaConfig.editors.addGroupLimit')}
                      value=""
                      onChange={event => {
                        const group = event.target.value
                        if (!group || rule.Groups[group]) return
                        updateRule(index, {
                          Groups: { ...rule.Groups, [group]: { CraftingSpeedMultiplier: 100, MaxItemCount: 100 } },
                        })
                      }}
                    >
                      <option value="">{t('arkmaniaConfig.editors.addGroupLimit')}</option>
                      {remaining.map(g => <option key={g} value={g}>{g}</option>)}
                    </Select>
                  )}
                </fieldset>
              </div>
            )}
          </div>
        )
      })}
      <div className="l-cluster">
        <Button
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={() => {
            const next = [...rules, {
              Name: 'NewStructure',
              Blueprint: '',
              Groups: { Default: { CraftingSpeedMultiplier: 100, MaxItemCount: 100 } },
            }]
            persist(next)
            setExpandedIdx(next.length - 1)
          }}
        >
          {t('arkmaniaConfig.editors.addStructure')}
        </Button>
      </div>
    </div>
  )
}
