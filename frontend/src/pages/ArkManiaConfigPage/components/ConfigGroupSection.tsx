/**
 * One sub-section of a plugin module: its boolean keys as a grid of switches,
 * then the other keys, each dispatched to the editor its value deserves.
 */
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Field, Input, Switch, Textarea } from '../../../components/ui'
import {
  WIDE_EDITORS, autoDescription, detectEditorType, type ConfigItem,
} from '../configModel'
import { BlueprintListEditor } from '../editors/BlueprintListEditor'
import { CraftLimitRulesEditor } from '../editors/CraftLimitRulesEditor'
import { GroupRulesEditor, GroupsEditor, OrderedGroupsEditor } from '../editors/GroupEditors'
import { KeyValueEditor } from '../editors/KeyValueEditor'
import styles from '../ArkManiaConfigPage.module.css'

interface Props {
  group: string
  items: ConfigItem[]
  editedValues: Record<string, string>
  invalidJsonKeys: Set<string>
  permGroups: string[]
  discardSeq: number
  expandedJsonKeys: Set<string>
  setExpandedJsonKeys: (keys: Set<string>) => void
  canOperate: boolean
  onChange: (key: string, value: string) => void
  onDuplicatesChange: (key: string, hasDuplicates: boolean) => void
}

export function ConfigGroupSection({
  group, items, editedValues, invalidJsonKeys, permGroups, discardSeq,
  expandedJsonKeys, setExpandedJsonKeys, canOperate, onChange, onDuplicatesChange,
}: Props) {
  const { t } = useTranslation()
  const disabled = !canOperate

  const bools = items.filter(i => detectEditorType(i.short_key, i.value) === 'bool')
  const others = items.filter(i => detectEditorType(i.short_key, i.value) !== 'bool')

  function describe(item: ConfigItem) {
    return item.description || autoDescription(item.short_key, t)
  }

  function renderEditor(item: ConfigItem, current: string) {
    const editorType = detectEditorType(item.short_key, item.value)
    switch (editorType) {
      case 'groups':
        return <GroupsEditor value={current} availableGroups={permGroups} disabled={disabled}
          onChange={v => onChange(item.config_key, v)} />
      case 'ordered_groups':
        return <OrderedGroupsEditor value={current} availableGroups={permGroups} disabled={disabled}
          onChange={v => onChange(item.config_key, v)} />
      case 'craft_rules':
        return <CraftLimitRulesEditor value={current} availableGroups={permGroups} disabled={disabled}
          onChange={v => onChange(item.config_key, v)} />
      case 'group_rules':
        return <GroupRulesEditor value={current} availableGroups={permGroups} disabled={disabled}
          onChange={v => onChange(item.config_key, v)} />
      case 'blueprints':
        return <BlueprintListEditor value={current} disabled={disabled}
          onChange={v => onChange(item.config_key, v)} />
      case 'key_value':
        return <KeyValueEditor key={discardSeq} value={current} disabled={disabled}
          onChange={v => onChange(item.config_key, v)}
          onDuplicatesChange={has => onDuplicatesChange(item.config_key, has)} />
      case 'json': {
        const expanded = expandedJsonKeys.has(item.config_key)
        const panelId = `json-${item.config_key}`
        return (
          <div className="l-stack l-stack--sm">
            <div className="l-cluster">
              {/* One target carrying the chevron and the phrase, as before:
                  a chevron-only button would be 28px wide and the phrase
                  would be announced twice. */}
              <Button
                size="sm"
                variant="ghost"
                icon={ChevronDown}
                aria-expanded={expanded}
                aria-controls={expanded ? panelId : undefined}
                onClick={() => {
                  const next = new Set(expandedJsonKeys)
                  if (expanded) next.delete(item.config_key)
                  else next.add(item.config_key)
                  setExpandedJsonKeys(next)
                }}
              >
                {t('arkmaniaConfig.editors.jsonLabel', { count: item.value.length })}
              </Button>
            </div>
            {expanded && (
              <div id={panelId}>
                <Field
                  label={t('arkmaniaConfig.editors.jsonFieldLabel', { key: item.short_key })}
                  error={invalidJsonKeys.has(item.config_key) ? t('arkmaniaConfig.editors.invalidJson') : null}
                >
                  <Textarea
                    mono
                    rows={4}
                    value={current}
                    disabled={disabled}
                    onChange={event => onChange(item.config_key, event.target.value)}
                  />
                </Field>
              </div>
            )}
            {!expanded && invalidJsonKeys.has(item.config_key) && (
              <p role="alert" className="u-text-sm">{t('arkmaniaConfig.editors.invalidJson')}</p>
            )}
          </div>
        )
      }
      default:
        return (
          <Input
            mono={/^-?\d/.test(item.value)}
            value={current}
            disabled={disabled}
            aria-label={item.short_key}
            onChange={event => onChange(item.config_key, event.target.value)}
          />
        )
    }
  }

  return (
    <fieldset className="ui-fieldset">
      {group !== '_general' && <legend>{group}</legend>}

      {bools.length > 0 && (
        <div className={styles.boolGrid}>
          {bools.map(item => {
            const current = editedValues[item.config_key] ?? item.value
            const edited = item.config_key in editedValues
            const description = describe(item)
            return (
              <Switch
                key={item.config_key}
                label={
                  <>
                    {item.short_key}
                    {edited && <> <Badge tone="accent">{t('arkmaniaConfig.badges.mod')}</Badge></>}
                  </>
                }
                description={description || undefined}
                checked={current.toLowerCase() === 'true'}
                disabled={disabled}
                onChange={checked => onChange(item.config_key, checked ? 'true' : 'false')}
              />
            )
          })}
        </div>
      )}

      {others.length > 0 && (
        <div className={styles.itemGrid}>
          {others.map(item => {
            const current = editedValues[item.config_key] ?? item.value
            const edited = item.config_key in editedValues
            const editorType = detectEditorType(item.short_key, item.value)
            const wide = WIDE_EDITORS.includes(editorType)
            const description = describe(item)
            return (
              <div key={item.config_key} className={wide ? styles.itemWide : undefined}>
                <div className="l-stack l-stack--sm">
                  <div className="l-cluster">
                    <span className="u-mono u-text-sm">{item.short_key}</span>
                    {item.is_overridden && <Badge tone="warning">{t('arkmaniaConfig.badges.ovr')}</Badge>}
                    {edited && <Badge tone="accent">{t('arkmaniaConfig.badges.mod')}</Badge>}
                  </div>
                  {description && <p className="u-muted u-text-sm">{description}</p>}
                  {renderEditor(item, current)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
