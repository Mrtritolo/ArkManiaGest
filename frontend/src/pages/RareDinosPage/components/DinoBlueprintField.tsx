/**
 * DinoBlueprintField — the blueprint picker of the add/edit dialog.
 *
 * Adding a dino searches the local blueprint DB (combobox); editing one shows
 * the stored path as plain text to correct by hand, with no list. When the DB
 * has never been synced the banner says so and links to the sync page.
 */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Alert, Combobox, Field } from '../../../components/ui'
import type { BpItem } from '../rareDinoModel'
import type { DinoEditor } from '../hooks/useDinoEditor'

interface Props {
  editor: DinoEditor
}

export function DinoBlueprintField({ editor }: Props) {
  const { t } = useTranslation()
  const editing = editor.editingDino !== null
  const bp = String(editor.form.dino_bp ?? '')
  const dbEmpty = !editing && editor.bpDbStatus !== null && !editor.bpDbStatus.has_data

  // Three states, exactly as before: results, "no matches", or "sync first".
  // An empty string keeps the popup shut (the primitive only opens it when
  // there is something to say).
  const emptyText = editing || !editor.bpSearched || editor.bpSearch.length < 2
    ? ''
    : dbEmpty
      ? t('rareDinos.modal.bpDbEmpty')
      : t('rareDinos.modal.bpNoMatches')

  return (
    <div className="l-stack l-stack--sm u-span-full">
      <Field
        label={t('rareDinos.modal.blueprintLabel')}
        error={editor.bpError || undefined}
        hint={bp.includes("'") ? <span className="u-mono u-wrap-anywhere">{bp}</span> : undefined}
        required
      >
        <Combobox<BpItem>
          inputValue={editing ? bp : (editor.bpSearch || bp)}
          onInputChange={value => {
            if (editing) {
              editor.setForm(prev => ({ ...prev, dino_bp: value }))
            } else {
              editor.changeBpSearch(value)
              editor.setForm(prev => ({ ...prev, dino_bp: value }))
            }
          }}
          options={editing ? [] : editor.bpResults}
          getKey={o => o.blueprint}
          renderOption={o => (
            <>
              <span>{o.name}</span>{' '}
              <span className="u-muted u-text-sm">{o.category}</span>
            </>
          )}
          onSelect={editor.selectBp}
          loading={!editing && editor.bpLoading}
          emptyText={emptyText}
          placeholder={t('rareDinos.modal.blueprintPlaceholder')}
          mono={bp.includes("'")}
        />
      </Field>

      {/* Persistent banner, so the user notices BEFORE typing two characters. */}
      {dbEmpty && (
        <Alert tone="warning" title={t('rareDinos.modal.bpDbEmpty')}>
          {t('rareDinos.modal.bpDbEmptyHint')}{' '}
          <Link to="/settings/blueprints">{t('rareDinos.modal.bpDbGoToSettings')}</Link>
        </Alert>
      )}
    </div>
  )
}
