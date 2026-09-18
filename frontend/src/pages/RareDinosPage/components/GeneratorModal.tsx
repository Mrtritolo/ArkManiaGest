/**
 * GeneratorModal — random pool generator.
 *
 * Generating a preview is read-only and open to everyone; adding the result
 * to the pool, or replacing the pool with it, is require_operator, so those
 * two buttons are gated. Replacing deletes every configured dino, so it asks
 * the operator to type the word out.
 */
import { useTranslation } from 'react-i18next'
import { Plus, Shuffle } from 'lucide-react'
import {
  Alert, Button, Checkbox, EmptyState, Field, Input, Modal, Select, Table, TableMessageRow,
} from '../../../components/ui'
import { useConfirm } from '../../../components/ui'
import type { DinoGenerator } from '../hooks/useDinoGenerator'

interface Props {
  gen: DinoGenerator
  maps: string[]
  canOperate: boolean
}

/** A generated row prints a stat pair, or a dash when the generator left it out. */
function statRange(row: Record<string, unknown>, key: string): string {
  const min = row[`${key}_min`] as number
  const max = row[`${key}_max`] as number
  return min === -1 ? '—' : `${min}–${max}`
}

export function GeneratorModal({ gen, maps, canOperate }: Props) {
  const { t } = useTranslation()
  const confirm = useConfirm()

  async function replaceAll() {
    const ok = await confirm({
      title: t('rareDinos.generator.replaceAll'),
      description: t('rareDinos.generator.confirmReplace'),
      confirmLabel: t('rareDinos.generator.replaceAction'),
      confirmText: t('rareDinos.generator.replaceWord'),
      tone: 'danger',
    })
    if (ok) await gen.handleApplyGenerated(true)
  }

  return (
    <Modal
      open={gen.showGenerator}
      onClose={gen.close}
      size="lg"
      title={t('rareDinos.generator.title')}
      dismissible={!gen.genLoading}
      footer={
        <>
          <Button variant="secondary" disabled={gen.genLoading} onClick={gen.close}>
            {t('rareDinos.modal.cancel')}
          </Button>
          {canOperate && gen.genResults.length > 0 && (
            <>
              <Button
                variant="danger"
                disabled={gen.genLoading}
                onClick={replaceAll}
              >
                {t('rareDinos.generator.replaceAll')}
              </Button>
              <Button
                variant="primary"
                icon={Plus}
                loading={gen.genLoading}
                loadingLabel={t('rareDinos.generator.applying')}
                onClick={() => gen.handleApplyGenerated(false)}
              >
                {t('rareDinos.generator.addToPool')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="l-stack">
        {gen.genError && <Alert tone="danger">{gen.genError}</Alert>}

        <div className="l-grid--form">
          <Field label={t('rareDinos.generator.countLabel')}>
            <Input
              type="number"
              mono
              min={1}
              max={50}
              value={gen.genCount}
              onChange={e => gen.setGenCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            />
          </Field>
          <Field label={t('rareDinos.generator.mapLabel')}>
            <Select value={gen.genMap} onChange={e => gen.setGenMap(e.target.value)}>
              <option value="*">{t('rareDinos.generator.allMaps')}</option>
              {maps.filter(m => m !== '*').map(m => (
                <option key={m} value={m}>{t(`rareDinos.maps.${m}`, { defaultValue: m })}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('rareDinos.generator.statPresetLabel')}>
            <Select value={gen.genPreset} onChange={e => gen.setGenPreset(e.target.value)}>
              <option value="none">{t('rareDinos.generator.preset.none')}</option>
              <option value="low">{t('rareDinos.generator.preset.low')}</option>
              <option value="balanced">{t('rareDinos.generator.preset.balanced')}</option>
              <option value="high">{t('rareDinos.generator.preset.high')}</option>
              <option value="random">{t('rareDinos.generator.preset.random')}</option>
            </Select>
          </Field>
          <Checkbox
            className="u-span-full"
            label={t('rareDinos.generator.excludeExisting')}
            checked={gen.genExclude}
            onChange={e => gen.setGenExclude(e.target.checked)}
          />
        </div>

        <div className="l-cluster">
          <Button
            variant="primary"
            icon={Shuffle}
            loading={gen.genLoading}
            loadingLabel={t('rareDinos.generator.generating')}
            onClick={gen.handleGenerate}
          >
            {gen.genResults.length > 0
              ? t('rareDinos.generator.reroll')
              : t('rareDinos.generator.generateBtn', { count: gen.genCount })}
          </Button>
          {gen.genInfo && (
            <span className="u-muted u-text-sm" role="status">
              {t('rareDinos.generator.availableInfo', { available: gen.genInfo.available })}
              {gen.genInfo.excluded > 0 && ` ${t('rareDinos.generator.excludedInfo', { excluded: gen.genInfo.excluded })}`}
            </span>
          )}
        </div>

        <Table label={t('rareDinos.generator.previewTitle')} minWidth={480} maxHeight="18rem">
          <thead>
            <tr>
              <th scope="col">{t('rareDinos.generator.colDino')}</th>
              <th scope="col" className="u-text-end">{t('rareDinos.generator.colHp')}</th>
              <th scope="col" className="u-text-end">{t('rareDinos.generator.colMelee')}</th>
              <th scope="col" className="u-text-end">{t('rareDinos.generator.colSpeed')}</th>
            </tr>
          </thead>
          <tbody>
            {gen.genResults.length === 0 ? (
              <TableMessageRow colSpan={4}>
                <EmptyState icon={Shuffle} title={t('rareDinos.generator.emptyPreview')} />
              </TableMessageRow>
            ) : gen.genResults.map((d, i) => (
              <tr key={i}>
                <td>{(d.display_name as string) || '?'}</td>
                <td className="u-num u-text-end">{statRange(d, 'health')}</td>
                <td className="u-num u-text-end">{statRange(d, 'melee')}</td>
                <td className="u-num u-text-end">{statRange(d, 'speed')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Modal>
  )
}
