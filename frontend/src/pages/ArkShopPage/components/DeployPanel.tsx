/**
 * Version history and deploy: save the current config as a version, pick a
 * version (or the current config) as the source, then push it to one or every
 * stopped container. Restoring and deleting a version are confirmed first.
 */
import {
  Archive, CircleAlert, CircleCheck, Clock, CloudUpload, Play, RotateCcw, RotateCw, Save, Trash2, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Alert, Badge, Button, Card, EmptyState, IconButton, Input, Spinner, Table, TableMessageRow,
} from '../../../components/ui'
import { fmtLocaleDateTime } from '../../../utils/format'
import type { ArkShopDeployState } from '../hooks/useArkShopDeploy'

interface Props {
  deploy: ArkShopDeployState
  isAdmin: boolean
  onClose: () => void
}

export function DeployPanel({ deploy, isAdmin, onClose }: Props) {
  const { t } = useTranslation()
  const selectedVersion = deploy.versions.find(v => v.id === deploy.deployVersionId)

  return (
    <Card
      title={t('arkshop.deploy.title')}
      icon={CloudUpload}
      actions={
        <>
          <IconButton
            size="sm"
            icon={RotateCw}
            label={t('arkshop.deploy.refreshList')}
            loading={deploy.loadingServers}
            onClick={() => { void deploy.loadArkServers(); deploy.setPushResults(null) }}
          />
          <IconButton size="sm" icon={X} label={t('common.close')} onClick={onClose} />
        </>
      }
    >
      <div className="l-stack">
        <div className="l-cluster">
          <Archive aria-hidden="true" size={16} strokeWidth={1.75} />
          <Input
            aria-label={t('arkshop.deploy.versionPlaceholder')}
            placeholder={t('arkshop.deploy.versionPlaceholder')}
            value={deploy.versionLabel}
            onChange={event => deploy.setVersionLabel(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void deploy.handleSaveVersion() }}
          />
          <Button
            icon={Save}
            loading={deploy.savingVersion}
            loadingLabel={t('arkshop.deploy.saveVersion')}
            disabled={!deploy.versionLabel.trim()}
            title={deploy.versionLabel.trim() ? undefined : t('arkshop.messagesResult.versionNameRequired')}
            onClick={() => void deploy.handleSaveVersion()}
          >
            {t('arkshop.deploy.saveVersion')}
          </Button>
          <Button
            icon={Clock}
            pressed={deploy.showVersions}
            aria-expanded={deploy.showVersions}
            onClick={() => deploy.setShowVersions(!deploy.showVersions)}
          >
            {t('arkshop.deploy.versionsToggle', { count: deploy.versions.length })}
          </Button>
        </div>

        {deploy.showVersions && (
          <Table label={t('arkshop.deploy.versionsToggle', { count: deploy.versions.length })} minWidth={720}>
            <thead>
              <tr>
                <th scope="col">{t('arkshop.deploy.versionColumn')}</th>
                <th scope="col">{t('arkshop.deploy.dateColumn')}</th>
                <th scope="col" className="u-text-end">{t('arkshop.deploy.itemsColumn')}</th>
                <th scope="col" className="u-text-end">{t('arkshop.deploy.kitsColumn')}</th>
                <th scope="col" className="u-text-end">{t('arkshop.rowActions')}</th>
              </tr>
            </thead>
            <tbody>
              {deploy.versions.length === 0 ? (
                <TableMessageRow colSpan={5}>
                  <EmptyState icon={Archive} title={t('arkshop.deploy.noVersions')} />
                </TableMessageRow>
              ) : deploy.versions.map(version => {
                const selected = deploy.deployVersionId === version.id
                return (
                  <tr key={version.id} data-selected={selected || undefined}>
                    <td>
                      <div className="ui-cell-2">
                        <span>{version.label}</span>
                        <span className="u-mono">#{version.id}</span>
                      </div>
                    </td>
                    <td>{fmtLocaleDateTime(version.created_at)}</td>
                    <td className="u-text-end u-num">{version.shop_items}</td>
                    <td className="u-text-end u-num">{version.kits}</td>
                    <td>
                      <div className="ui-row-actions">
                        <IconButton
                          size="sm"
                          icon={Play}
                          pressed={selected}
                          label={t('arkshop.deploy.selectForDeployNamed', { label: version.label })}
                          onClick={() => deploy.setDeployVersionId(selected ? null : version.id)}
                        />
                        <IconButton
                          size="sm"
                          icon={RotateCcw}
                          label={t('arkshop.deploy.restoreNamed', { label: version.label })}
                          onClick={() => void deploy.handleRestoreVersion(version)}
                        />
                        {isAdmin && (
                          <IconButton
                            size="sm"
                            tone="danger"
                            icon={Trash2}
                            label={t('arkshop.deploy.deleteNamed', { label: version.label })}
                            onClick={() => void deploy.handleDeleteVersion(version)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}

        <div className="l-cluster">
          <span className="u-secondary u-text-sm">{t('arkshop.deploy.source')}</span>
          <strong>
            {selectedVersion
              ? t('arkshop.deploy.sourceVersion', { id: selectedVersion.id, label: selectedVersion.label })
              : t('arkshop.deploy.sourceCurrent')}
          </strong>
          {deploy.deployVersionId !== null && (
            <Button size="sm" variant="ghost" onClick={() => deploy.setDeployVersionId(null)}>
              {t('arkshop.deploy.useCurrent')}
            </Button>
          )}
          <Button
            className="u-push"
            variant="primary"
            icon={CloudUpload}
            loading={deploy.pushing}
            loadingLabel={t('arkshop.actions.deploy')}
            disabled={deploy.arkServers.length === 0}
            title={deploy.arkServers.length === 0 ? t('arkshop.deploy.noServers') : undefined}
            onClick={() => void deploy.handleDeployAll()}
          >
            {t('arkshop.deploy.deployAll')}
          </Button>
        </div>

        <Table label={t('arkshop.deploy.title')} minWidth={720}>
          <thead>
            <tr>
              <th scope="col">{t('arkshop.loadFromServer.columnContainer')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnServer')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnMap')}</th>
              <th scope="col">{t('arkshop.loadFromServer.columnHost')}</th>
              <th scope="col" className="u-text-end">{t('arkshop.deploy.resultColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {deploy.loadingServers ? (
              <TableMessageRow colSpan={5}>
                <Spinner block label={t('arkshop.loadFromServer.searching')} />
              </TableMessageRow>
            ) : deploy.arkServers.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState icon={CloudUpload} title={t('arkshop.deploy.noServers')} />
              </TableMessageRow>
            ) : deploy.arkServers.map(server => {
              const key = `${server.machine_id}|${server.container_name}`
              const result = deploy.pushResults?.results?.find(
                r => r.container === server.container_name && r.machine === server.machine_name)
              return (
                <tr key={key}>
                  <td className="u-mono">{server.container_name}</td>
                  <td>{server.server_name || server.machine_name}</td>
                  <td>{server.map_name || '-'}</td>
                  <td className="u-mono">{server.hostname}</td>
                  <td>
                    <div className="ui-row-actions">
                      {result ? (
                        result.status === 'deployed' ? (
                          <Badge tone="success" icon={CircleCheck}>{t('arkshop.deploy.deployed')}</Badge>
                        ) : result.status === 'running' ? (
                          <Badge tone="warning" icon={Play}>{t('arkshop.deploy.active')}</Badge>
                        ) : (
                          <Badge tone="danger" icon={CircleAlert}>
                            <span title={result.message}>{t('arkshop.deploy.errorStatus')}</span>
                          </Badge>
                        )
                      ) : (
                        <Button
                          size="sm"
                          icon={CloudUpload}
                          loading={deploy.perServer.isPending(key)}
                          loadingLabel={t('arkshop.deploy.deploySingle')}
                          disabled={deploy.pushing}
                          onClick={() => void deploy.handleDeployOne(server)}
                        >
                          {t('arkshop.deploy.deploySingle')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>

        {deploy.pushResults && (
          <Alert
            tone={deploy.pushResults.failed === 0 && deploy.pushResults.skipped_running === 0 ? 'success' : 'warning'}
          >
            {t('arkshop.deploy.resultDeployed', { count: deploy.pushResults.deployed })}
            {deploy.pushResults.skipped_running > 0 && t('arkshop.deploy.resultSkipped', { count: deploy.pushResults.skipped_running })}
            {deploy.pushResults.failed > 0 && t('arkshop.deploy.resultFailed', { count: deploy.pushResults.failed })}
            {' '}
            {t('arkshop.deploy.resultSuffix', { total: deploy.pushResults.total })}
          </Alert>
        )}
      </div>
    </Card>
  )
}
