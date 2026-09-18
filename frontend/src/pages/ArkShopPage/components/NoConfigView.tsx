/**
 * Shown while no ArkShop config is stored: pull one from a container, or (for
 * admins) upload a config file by hand.
 */
import { CloudDownload, RotateCw, ShoppingBag, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Alert, Button, Card, EmptyState, PageHeader, Spinner, Table, TableMessageRow,
} from '../../../components/ui'
import type { ArkServerRow } from '../../../services/api'

interface Props {
  isAdmin: boolean
  canOperate: boolean
  statusError: string
  onRetryStatus: () => void
  loadingServers: boolean
  arkServers: ArkServerRow[]
  pulling: boolean
  onPull: (machineId: number, containerName: string) => void
  uploading: boolean
  onUploadClick: () => void
  /** The hidden file input, rendered by the shell. */
  children?: React.ReactNode
}

export function NoConfigView({
  isAdmin, canOperate, statusError, onRetryStatus,
  loadingServers, arkServers, pulling, onPull, uploading, onUploadClick, children,
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="l-page">
      <PageHeader title={t('arkshop.heading')} icon={ShoppingBag} description={t('arkshop.subtitleNoConfig')} />
      {statusError && (
        <Alert
          tone="danger"
          title={statusError}
          actions={<Button size="sm" icon={RotateCw} onClick={onRetryStatus}>{t('common.retry')}</Button>}
        >
          {t('arkshop.messagesResult.statusErrorHint')}
        </Alert>
      )}
      <Card title={t('arkshop.loadFromServer.title')} icon={CloudDownload}>
        <div className="l-stack">
          <p className="u-secondary">{t('arkshop.loadFromServer.hint')}</p>
          <Table label={t('arkshop.loadFromServer.title')} minWidth={720}>
          <thead>
            <tr>
              <th scope="col">{t('arkshop.loadFromServer.columnContainer')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnServer')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnMap')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnHost')}</th>
              <th scope="col" className="u-text-end">{t('arkshop.rowActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loadingServers ? (
              <TableMessageRow colSpan={5}>
                <Spinner block label={t('arkshop.loadFromServer.searching')} />
              </TableMessageRow>
            ) : arkServers.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState
                  icon={CloudDownload}
                  title={t('arkshop.loadFromServer.emptyTitle')}
                  description={t('arkshop.loadFromServer.empty')}
                />
              </TableMessageRow>
            ) : arkServers.map(server => (
              <tr key={`${server.machine_id}|${server.container_name}`}>
                <td className="u-mono">{server.container_name}</td>
                <td>{server.server_name || server.machine_name}</td>
                <td>{server.map_name || '-'}</td>
                <td className="u-mono">{server.hostname}</td>
                <td>
                  <div className="ui-row-actions">
                    {canOperate && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={CloudDownload}
                        loading={pulling}
                        loadingLabel={t('arkshop.loadFromServer.pullButton')}
                        onClick={() => onPull(server.machine_id, server.container_name)}
                      >
                        {t('arkshop.loadFromServer.pullButton')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {isAdmin && (
        <Card title={t('arkshop.loadFromServer.manualTitle')} icon={Upload}>
          <div className="l-stack l-stack--sm">
            <p className="u-secondary u-text-sm">{t('arkshop.loadFromServer.manualHint')}</p>
            <div className="l-cluster">
              <Button
                icon={Upload}
                loading={uploading}
                loadingLabel={t('arkshop.loadFromServer.uploading')}
                onClick={onUploadClick}
              >
                {t('arkshop.loadFromServer.uploadButton')}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {children}
    </div>
  )
}
