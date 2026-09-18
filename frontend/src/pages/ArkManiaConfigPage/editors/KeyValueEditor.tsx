/**
 * Key -> value map editor (MapDisplayNames).
 *
 * Rows are edited as an ordered list: rebuilding the object on every keystroke
 * moved a renamed key to the end (so the focused row started editing another
 * entry) and merged a key typed onto an existing one. A change is held back
 * while two keys are equal, and the page is told, so Save stays disabled.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton, Input } from '../../../components/ui'
import styles from '../ArkManiaConfigPage.module.css'

function parseRows(value: string): [string, string][] {
  try { return Object.entries(JSON.parse(value) as Record<string, string>) } catch { return [] }
}

interface Props {
  value: string
  onChange: (value: string) => void
  onDuplicatesChange: (hasDuplicates: boolean) => void
  disabled: boolean
}

export function KeyValueEditor({ value, onChange, onDuplicatesChange, disabled }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<[string, string][]>(() => parseRows(value))
  const emitted = useRef(value)

  // Discard or a reload replaces the value from outside: start from it again.
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setRows(parseRows(value)) }
  }, [value])

  const keys = rows.map(([k]) => k)
  const dupes = new Set(keys.filter((k, i) => keys.indexOf(k) !== i))
  const hasDupes = dupes.size > 0

  // A held-back change is invisible to the parent otherwise: it keeps Save
  // disabled and offers Discard while this editor has duplicate keys.
  useEffect(() => {
    onDuplicatesChange(hasDupes)
    return () => onDuplicatesChange(false)
  }, [hasDupes])

  function commit(next: [string, string][]) {
    setRows(next)
    const nextKeys = next.map(([k]) => k)
    // Duplicate keys would collapse into one entry: hold the change until
    // the keys are unique again.
    if (new Set(nextKeys).size !== nextKeys.length) return
    const json = JSON.stringify(Object.fromEntries(next))
    emitted.current = json
    onChange(json)
  }

  return (
    <div className="l-stack l-stack--sm">
      {rows.map(([key, val], index) => (
        <div key={index} className={styles.kvRow}>
          <Input
            size="sm"
            mono
            aria-label={t('arkmaniaConfig.editors.keyPlaceholder')}
            placeholder={t('arkmaniaConfig.editors.keyPlaceholder')}
            value={key}
            disabled={disabled}
            aria-invalid={dupes.has(key) || undefined}
            title={dupes.has(key) ? t('arkmaniaConfig.editors.duplicateKey') : undefined}
            onChange={event => commit(rows.map((r, i) => (i === index ? [event.target.value, val] : r)))}
          />
          <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />
          <Input
            size="sm"
            aria-label={t('arkmaniaConfig.editors.valuePlaceholder')}
            placeholder={t('arkmaniaConfig.editors.valuePlaceholder')}
            value={val}
            disabled={disabled}
            onChange={event => commit(rows.map((r, i) => (i === index ? [key, event.target.value] : r)))}
          />
          <IconButton
            size="sm"
            tone="danger"
            icon={X}
            disabled={disabled}
            label={t('arkmaniaConfig.editors.removeEntry', { key: key || String(index + 1) })}
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      {hasDupes && (
        <p role="alert" className="u-text-sm">{t('arkmaniaConfig.editors.duplicateKey')}</p>
      )}
      <div className="l-cluster">
        <Button size="sm" icon={Plus} disabled={disabled} onClick={() => commit([...rows, ['', '']])}>
          {t('arkmaniaConfig.editors.addLabel')}
        </Button>
      </div>
    </div>
  )
}
