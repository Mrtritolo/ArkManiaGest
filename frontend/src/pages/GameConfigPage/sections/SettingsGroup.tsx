/**
 * One group of typed INI settings: booleans as switches, everything else as a
 * labelled field. Viewers see the values but cannot change them.
 */
import { Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Field, IconButton, Input, Switch, Textarea } from '../../../components/ui'
import { settingLabel, type GroupDef, type SettingDef } from '../gameConfigModel'
import styles from '../GameConfigPage.module.css'

/** What the backend sends instead of a password an account may not read. */
const MASKED = '********'

interface Props {
  gid: string
  group: GroupDef
  localValues: Record<string, Record<string, string>>
  loadedValues: Record<string, Record<string, string>> | undefined
  canOperate: boolean
  isAdmin: boolean
  onChange: (gid: string, key: string, value: string) => void
  onReset: (gid: string, key: string) => void
}

export function SettingsGroup({
  gid, group, localValues, loadedValues, canOperate, isAdmin, onChange, onReset,
}: Props) {
  const { t } = useTranslation()
  const readOnlyTitle = canOperate ? undefined : t('gameConfig.readOnlyRole')

  const bools: [string, SettingDef][] = []
  const others: [string, SettingDef][] = []
  for (const [key, def] of Object.entries(group.settings)) {
    if (def.type === 'bool') bools.push([key, def])
    else others.push([key, def])
  }

  function hintFor(key: string, def: SettingDef, dirty: boolean, masked: boolean): string | undefined {
    const parts = [
      dirty ? t('gameConfig.changed') : null,
      masked ? t('gameConfig.passwordMasked') : null,
      def.default !== undefined ? t('gameConfig.defaultPrefix', { value: String(def.default) }) : null,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' — ') : undefined
  }

  function renderControl(key: string, def: SettingDef) {
    const value = localValues[gid]?.[key] ?? ''
    const orig = loadedValues?.[gid]?.[key]
    const dirty = value !== (orig ?? '')
    const label = settingLabel(key, def)
    const masked = def.type === 'password' && !isAdmin && value === MASKED

    if (def.type === 'float' || def.type === 'int') {
      return (
        <Field key={key} label={label} hint={hintFor(key, def, dirty, false)}>
          <div className={styles.inputRow}>
            <Input
              type="number"
              mono
              value={value || ''}
              min={def.min}
              max={def.max}
              step={def.step || (def.type === 'int' ? 1 : 0.1)}
              disabled={!canOperate}
              title={readOnlyTitle}
              onChange={event => onChange(gid, key, event.target.value)}
            />
            {def.default !== undefined && (
              <IconButton
                icon={Undo2}
                label={t('gameConfig.resetTo', { label, value: String(def.default) })}
                disabled={!canOperate}
                title={readOnlyTitle ?? t('gameConfig.defaultTitle', { value: String(def.default) })}
                onClick={() => onReset(gid, key)}
              />
            )}
          </div>
        </Field>
      )
    }

    if (def.type === 'password') {
      // A mask is not a secret, so it gets no reveal toggle. A real value stays
      // revealable for a viewer: read-only, not disabled, because Input passes
      // `disabled` on to the eye button and would hide a value the backend
      // already sent them.
      return (
        <Field key={key} label={label} hint={hintFor(key, def, dirty, masked)}>
          <Input
            type={masked ? 'text' : 'password'}
            revealable={!masked}
            value={value || ''}
            autoComplete="off"
            readOnly={!canOperate}
            title={readOnlyTitle}
            onChange={event => onChange(gid, key, event.target.value)}
          />
        </Field>
      )
    }

    if (def.type === 'text') {
      return (
        <Field key={key} label={label} hint={hintFor(key, def, dirty, false)}>
          <Textarea
            mono
            rows={3}
            value={(value || '').replace(/\\n/g, '\n')}
            disabled={!canOperate}
            title={readOnlyTitle}
            onChange={event => onChange(gid, key, event.target.value.replace(/\n/g, '\\n'))}
          />
        </Field>
      )
    }

    return (
      <Field key={key} label={label} hint={hintFor(key, def, dirty, false)}>
        <Input
          type="text"
          value={value || ''}
          disabled={!canOperate}
          title={readOnlyTitle}
          onChange={event => onChange(gid, key, event.target.value)}
        />
      </Field>
    )
  }

  return (
    <div className="l-stack">
      {others.length > 0 && <div className={styles.fields}>{others.map(([k, d]) => renderControl(k, d))}</div>}
      {bools.length > 0 && (
        <fieldset className="ui-fieldset">
          <legend>{t('gameConfig.onOffToggles')}</legend>
          <div className={styles.toggles}>
            {bools.map(([key, def]) => {
              const value = localValues[gid]?.[key] ?? ''
              const orig = loadedValues?.[gid]?.[key]
              const dirty = value !== (orig ?? '')
              const isOn = value.toLowerCase() === 'true'
              return (
                <Switch
                  key={key}
                  label={settingLabel(key, def)}
                  description={dirty ? t('gameConfig.changed') : undefined}
                  checked={isOn}
                  disabled={!canOperate}
                  onChange={() => onChange(gid, key, isOn ? 'False' : 'True')}
                />
              )
            })}
          </div>
        </fieldset>
      )}
    </div>
  )
}
