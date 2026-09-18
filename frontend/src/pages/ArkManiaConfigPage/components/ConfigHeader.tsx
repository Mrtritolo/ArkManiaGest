/**
 * Page header: title with the key and online-server counts, the server scope
 * selector and the JSON export.
 */
import { Download, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Field, PageHeader, Select } from '../../../components/ui'
import type { ConfigModule, ServerItem } from '../configModel'

interface Props {
  modules: ConfigModule[]
  servers: ServerItem[]
  selectedServer: string
  onServerChange: (serverKey: string) => void
  onExport: () => void
}

export function ConfigHeader({ modules, servers, selectedServer, onServerChange, onExport }: Props) {
  const { t } = useTranslation()

  return (
    <PageHeader
      title={t('arkmaniaConfig.heading')}
      icon={Settings}
      description={t('arkmaniaConfig.subtitle', {
        keys: modules.reduce((sum, m) => sum + m.key_count, 0),
        online: servers.filter(s => s.is_online).length,
      })}
      actions={
        <>
          <Field label={t('arkmaniaConfig.server.label')}>
            <Select
              size="sm"
              value={selectedServer}
              onChange={event => onServerChange(event.target.value)}
            >
              <option value="*">{t('arkmaniaConfig.server.global')}</option>
              {servers.map(server => (
                <option key={server.server_key} value={server.server_key}>
                  {server.is_online
                    ? t('arkmaniaConfig.server.onlineOption', { name: server.display_name })
                    : t('arkmaniaConfig.server.offlineOption', { name: server.display_name })}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            icon={Download}
            title={t('arkmaniaConfig.actions.exportTooltip')}
            onClick={onExport}
          >
            {t('arkmaniaConfig.actions.export')}
          </Button>
        </>
      }
    />
  )
}
