/**
 * Preview of a JSON import: how many entries the file holds, and whether they
 * are merged into the catalogue or replace it.
 */
import { Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Modal, SegmentedControl } from '../../../components/ui'

interface Props {
  preview: { data: unknown[]; filename: string } | null
  mode: 'merge' | 'replace'
  setMode: (mode: 'merge' | 'replace') => void
  importing: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ImportDialog({ preview, mode, setMode, importing, onCancel, onConfirm }: Props) {
  const { t } = useTranslation()
  const count = preview?.data.length ?? 0

  return (
    <Modal
      open={preview !== null}
      onClose={onCancel}
      dismissible={!importing}
      title={t('blueprints.importDialog.title')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={importing}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            icon={Upload}
            loading={importing}
            loadingLabel={t('blueprints.importDialog.importing')}
            onClick={onConfirm}
          >
            {t('blueprints.importDialog.importEntries', { count })}
          </Button>
        </>
      }
    >
      <div className="l-stack l-stack--sm">
        <dl className="ui-dl">
          <dt>{t('blueprints.importDialog.fileName')}</dt>
          <dd className="u-mono">{preview?.filename}</dd>
          <dt>{t('blueprints.importDialog.entries')}</dt>
          <dd className="u-num">{count}</dd>
        </dl>
        <SegmentedControl
          label={t('blueprints.importDialog.modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'merge', label: t('blueprints.importDialog.modeMerge') },
            { value: 'replace', label: t('blueprints.importDialog.modeReplace') },
          ]}
        />
        <p className="u-secondary u-text-sm">
          {mode === 'merge'
            ? t('blueprints.importDialog.modeMergeHint')
            : t('blueprints.importDialog.modeReplaceHint')}
        </p>
        {mode === 'replace' && (
          <Alert tone="warning">{t('blueprints.importDialog.replaceWarning')}</Alert>
        )}
      </div>
    </Modal>
  )
}
