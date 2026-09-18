/**
 * The three permission-group editors: a chip list, a decay rule table and an
 * ordered priority list. Each stores its value as the JSON string the plugin
 * reads back.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Field, IconButton, Input, Select } from '../../../components/ui'
import styles from '../ArkManiaConfigPage.module.css'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  availableGroups: string[]
  disabled: boolean
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function GroupsEditor({ value, onChange, availableGroups, disabled }: EditorProps) {
  const { t } = useTranslation()
  const groups = parseStringArray(value)
  const [showAdd, setShowAdd] = useState(false)
  const remaining = availableGroups.filter(g => !groups.includes(g))

  return (
    <div className="l-cluster">
      {groups.map(group => (
        <span key={group} className="l-cluster">
          <Badge tone="accent">{group}</Badge>
          <IconButton
            size="sm"
            tone="danger"
            icon={X}
            disabled={disabled}
            label={t('arkmaniaConfig.editors.removeGroup', { group })}
            onClick={() => onChange(JSON.stringify(groups.filter(g => g !== group)))}
          />
        </span>
      ))}
      {showAdd ? (
        <Select
          size="sm"
          autoFocus
          aria-label={t('arkmaniaConfig.editors.selectPlaceholder')}
          value=""
          onBlur={() => setShowAdd(false)}
          onChange={event => {
            const group = event.target.value
            if (group && !groups.includes(group)) onChange(JSON.stringify([...groups, group]))
            setShowAdd(false)
          }}
        >
          <option value="">{t('arkmaniaConfig.editors.selectPlaceholder')}</option>
          {remaining.map(g => <option key={g} value={g}>{g}</option>)}
        </Select>
      ) : (
        <Button size="sm" icon={Plus} disabled={disabled} onClick={() => setShowAdd(true)}>
          {t('arkmaniaConfig.editors.addLabel')}
        </Button>
      )}
    </div>
  )
}

interface GroupRule { Group: string; DecayDays: number }

export function GroupRulesEditor({ value, onChange, availableGroups, disabled }: EditorProps) {
  const { t } = useTranslation()
  let rules: GroupRule[] = []
  try { rules = JSON.parse(value) } catch { rules = [] }

  const commit = (next: GroupRule[]) => onChange(JSON.stringify(next))

  return (
    <div className="l-stack l-stack--sm">
      {rules.map((rule, index) => (
        <div key={index} className={styles.row}>
          <Select
            size="sm"
            className={styles.rowMain}
            aria-label={t('arkmaniaConfig.editors.columnGroup')}
            value={rule.Group}
            disabled={disabled}
            onChange={event => commit(rules.map((r, i) => (i === index ? { ...r, Group: event.target.value } : r)))}
          >
            {/* A stored group missing from PermissionGroups (renamed, deleted,
                or the list failed to load) still needs an option, or the
                select shows the first group while the rule keeps the old one. */}
            {!availableGroups.includes(rule.Group) && (
              <option value={rule.Group}>{t('arkmaniaConfig.editors.missingGroup', { group: rule.Group })}</option>
            )}
            {availableGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </Select>
          <Input
            size="sm"
            mono
            type="number"
            aria-label={t('arkmaniaConfig.editors.daysFor', { group: rule.Group })}
            value={rule.DecayDays}
            disabled={disabled}
            onChange={event => commit(rules.map((r, i) => (i === index ? { ...r, DecayDays: Number(event.target.value) } : r)))}
          />
          <IconButton
            size="sm"
            tone="danger"
            icon={Trash2}
            disabled={disabled}
            label={t('arkmaniaConfig.editors.removeRule', { group: rule.Group })}
            onClick={() => commit(rules.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div className="l-cluster">
        <Button
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={() => commit([...rules, { Group: availableGroups[0] || 'Default', DecayDays: 7 }])}
        >
          {t('arkmaniaConfig.editors.addRule')}
        </Button>
      </div>
    </div>
  )
}

export function OrderedGroupsEditor({ value, onChange, availableGroups, disabled }: EditorProps) {
  const { t } = useTranslation()
  const groups = parseStringArray(value)
  const [showAdd, setShowAdd] = useState(false)
  const remaining = availableGroups.filter(g => !groups.includes(g))

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    const next = [...groups]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(JSON.stringify(next))
  }

  return (
    <div className="l-stack l-stack--sm">
      {groups.map((group, index) => (
        <div key={group} className={styles.row}>
          <span className={`u-mono u-text-sm u-muted ${styles.rowIndex}`}>{index + 1}</span>
          <span className={styles.rowMain}>{group}</span>
          <IconButton
            size="sm"
            icon={ChevronUp}
            disabled={disabled || index === 0}
            label={t('arkmaniaConfig.editors.moveUp', { group })}
            onClick={() => move(index, -1)}
          />
          <IconButton
            size="sm"
            icon={ChevronDown}
            disabled={disabled || index === groups.length - 1}
            label={t('arkmaniaConfig.editors.moveDown', { group })}
            onClick={() => move(index, 1)}
          />
          <IconButton
            size="sm"
            tone="danger"
            icon={X}
            disabled={disabled}
            label={t('arkmaniaConfig.editors.removeGroup', { group })}
            onClick={() => onChange(JSON.stringify(groups.filter((_, i) => i !== index)))}
          />
        </div>
      ))}
      {showAdd ? (
        <Field label={t('arkmaniaConfig.editors.selectGroupPlaceholder')}>
          <Select
            size="sm"
            autoFocus
            value=""
            onBlur={() => setShowAdd(false)}
            onChange={event => {
              const group = event.target.value
              if (group && !groups.includes(group)) onChange(JSON.stringify([...groups, group]))
              setShowAdd(false)
            }}
          >
            <option value="">{t('arkmaniaConfig.editors.selectGroupPlaceholder')}</option>
            {remaining.map(g => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
      ) : (
        <div className="l-cluster">
          <Button size="sm" icon={Plus} disabled={disabled} onClick={() => setShowAdd(true)}>
            {t('arkmaniaConfig.editors.addGroup')}
          </Button>
        </div>
      )}
    </div>
  )
}
