/**
 * Empty catalogue: the three ways to fill it (Beacon archive, Dododex/Wiki
 * sync, JSON import). Viewers see the explanation without the actions.
 *
 * A status request that failed is not an empty catalogue: it renders as an
 * alert with Retry above the card, so nobody fires a replace-mode import
 * against a catalogue the page merely could not read.
 */
import type { ReactNode } from 'react'
import { Database, Download, RotateCw, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, EmptyState, PageHeader } from '../../../components/ui'
import styles from '../BlueprintsPage.module.css'

interface Props {
  canOperate: boolean
  syncing: boolean
  loadError: string
  onRetry: () => void
  onBeaconClick: () => void
  onSync: () => void
  onJsonClick: () => void
  /** The hidden file inputs and the import dialog. */
  children?: ReactNode
}

export function NoDataView({
  canOperate, syncing, loadError, onRetry, onBeaconClick, onSync, onJsonClick, children,
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="l-page">
      <PageHeader
        title={t('blueprints.heading')}
        icon={Database}
        description={t('blueprints.subtitleEmpty')}
        actions={canOperate ? (
          <>
            <Button size="sm" variant="ghost" icon={Upload} onClick={onJsonClick}>
              {t('blueprints.noData.importButton')}
            </Button>
            <Button
              size="sm"
              icon={Download}
              loading={syncing}
              loadingLabel={t('blueprints.noData.syncing')}
              onClick={onSync}
            >
              {t('blueprints.noData.syncButton')}
            </Button>
          </>
        ) : undefined}
      />
      {children}
      {loadError && (
        <Alert
          tone="danger"
          title={loadError}
          actions={<Button size="sm" icon={RotateCw} onClick={onRetry}>{t('common.retry')}</Button>}
        />
      )}
      <Card>
        <EmptyState
          icon={Database}
          title={t('blueprints.noData.title')}
          description={t('blueprints.noData.hint')}
          action={canOperate ? (
            <Button
              icon={Upload}
              loading={syncing}
              loadingLabel={t('blueprints.beacon.importing')}
              onClick={onBeaconClick}
            >
              {t('blueprints.beacon.importButton')}
            </Button>
          ) : undefined}
        />
        <p className={`u-muted u-text-sm ${styles.emptyNote}`}>{t('blueprints.beacon.hint')}</p>
      </Card>
    </div>
  )
}
