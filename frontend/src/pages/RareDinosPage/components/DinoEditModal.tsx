/**
 * DinoEditModal — add or edit one pool entry: blueprint, map, enabled state
 * and the seven stat ranges. A stat switched off (min < 0) is left to the
 * game's own roll; switched on it takes the min/max pair.
 */
import { useTranslation } from 'react-i18next'
import { Activity, Save } from 'lucide-react'
import { Alert, Button, Field, Input, Modal, Select, Switch } from '../../../components/ui'
import { MAP_OPTIONS, STATS, statValue } from '../rareDinoModel'
import type { DinoEditor } from '../hooks/useDinoEditor'
import { DinoBlueprintField } from './DinoBlueprintField'

interface Props {
  editor: DinoEditor
}

export function DinoEditModal({ editor }: Props) {
  const { t } = useTranslation()
  const editing = editor.editingDino

  return (
    <Modal
      open={editor.showModal}
      onClose={editor.close}
      size="lg"
      title={editing
        ? t('rareDinos.modal.editTitle', { name: editing.display_name })
        : t('rareDinos.modal.newTitle')}
      dismissible={!editor.saving}
      onSubmit={() => void editor.handleSave()}
      footer={
        <>
          <Button variant="secondary" disabled={editor.saving} onClick={editor.close}>
            {t('rareDinos.modal.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            loading={editor.saving}
            loadingLabel={t('rareDinos.modal.saving')}
          >
            {editing ? t('rareDinos.modal.save') : t('rareDinos.modal.add')}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        {editor.modalError && <Alert tone="danger">{editor.modalError}</Alert>}

        <div className="l-grid--form">
          <DinoBlueprintField editor={editor} />
          <Field label={t('rareDinos.modal.mapLabel')}>
            <Select
              value={String(editor.form.map_name ?? '*')}
              onChange={e => editor.setForm(prev => ({ ...prev, map_name: e.target.value }))}
            >
              <option value="*">{t('rareDinos.modal.mapAll')}</option>
              {MAP_OPTIONS.map(m => (
                <option key={m} value={m}>{t(`rareDinos.maps.${m}`, { defaultValue: m })}</option>
              ))}
            </Select>
          </Field>
          <Switch
            className="u-span-full"
            label={t('rareDinos.modal.enabledLabel')}
            description={Boolean(editor.form.enabled)
              ? t('rareDinos.modal.enabled')
              : t('rareDinos.modal.disabled')}
            checked={Boolean(editor.form.enabled)}
            onChange={value => editor.setForm(prev => ({ ...prev, enabled: value }))}
          />
        </div>

        <fieldset className="ui-fieldset">
          <legend>{t('rareDinos.modal.statsHeading')}</legend>
          <div className="l-grid--form">
            {STATS.map(s => {
              const minKey = `${s.key}_min`
              const maxKey = `${s.key}_max`
              const isActive = statValue(editor.form, minKey) >= 0
              const label = t(`rareDinos.stats.${s.key}`)
              const Icon = s.icon
              return (
                <div key={s.key} className="l-stack l-stack--sm">
                  <Switch
                    label={<><Icon size={16} strokeWidth={1.75} aria-hidden="true" /> {label}</>}
                    checked={isActive}
                    onChange={next => editor.setForm(prev => next
                      ? { ...prev, [minKey]: 35, [maxKey]: 45 }
                      : { ...prev, [minKey]: -1, [maxKey]: -1 })}
                  />
                  {isActive && (
                    <div className="l-cluster">
                      <Field label={t('rareDinos.modal.minLabel')}>
                        <Input
                          type="number"
                          mono
                          size="sm"
                          value={String(editor.form[minKey] ?? '')}
                          onChange={e => editor.setForm(prev => ({ ...prev, [minKey]: Number(e.target.value) }))}
                        />
                      </Field>
                      <Field
                        label={t('rareDinos.modal.maxLabel')}
                        error={editor.statErrors[s.key] || undefined}
                      >
                        <Input
                          type="number"
                          mono
                          size="sm"
                          value={String(editor.form[maxKey] ?? '')}
                          onChange={e => editor.setForm(prev => ({ ...prev, [maxKey]: Number(e.target.value) }))}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>

        <p className="u-muted u-text-sm">
          <Activity size={16} strokeWidth={1.75} aria-hidden="true" /> {t('rareDinos.modal.statsHint')}
        </p>
      </div>
    </Modal>
  )
}
