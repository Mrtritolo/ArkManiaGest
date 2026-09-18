/**
 * Header of the content area: which module and server is being edited, how
 * many keys are on screen, and the filter box.
 */
import { useTranslation } from 'react-i18next'
import { Badge, Input } from '../../../components/ui'
import type { ServerItem } from '../configModel'

interface Props {
  moduleLabel?: string
  selectedServer: string
  servers: ServerItem[]
  count: number
  searchQuery: string
  onSearchChange: (value: string) => void
}

export function ConfigToolbar({ moduleLabel, selectedServer, servers, count, searchQuery, onSearchChange }: Props) {
  const { t } = useTranslation()
  const override = selectedServer !== '*'
    ? servers.find(s => s.server_key === selectedServer)?.display_name ?? selectedServer
    : null

  return (
    <>
      {override && <Badge tone="warning">{t('arkmaniaConfig.toolbar.override', { name: override })}</Badge>}
      <span role="status" className="u-secondary u-text-sm">
        {t('arkmaniaConfig.toolbar.keysCount', { count })}
      </span>
      <Input
        type="search"
        size="sm"
        aria-label={t('arkmaniaConfig.toolbar.filterLabel', { module: moduleLabel ?? '' })}
        placeholder={t('arkmaniaConfig.toolbar.filterPlaceholder')}
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
      />
    </>
  )
}
