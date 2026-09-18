/**
 * PurgeLogTab — the last 50 purges the plugin reported back.
 */
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { fmtShortDateTime } from '../../../utils/format'
import { Card, EmptyState, Spinner, Table, TableMessageRow } from '../../../components/ui'
import type { LogItem } from '../decayModel'

interface Props {
  log: LogItem[]
  loading: boolean
}

export function PurgeLogTab({ log, loading }: Props) {
  const { t } = useTranslation()

  return (
    <Card
      title={t('decay.tabs.log')}
      flush
      actions={loading && log.length > 0 ? <Spinner /> : undefined}
    >
      <Table label={t('decay.tabs.log')} minWidth={880}>
        <thead>
          <tr>
            <th scope="col">{t('decay.tribes.table.id')}</th>
            <th scope="col">{t('decay.pending.table.server')}</th>
            <th scope="col">{t('decay.log.table.map')}</th>
            <th scope="col" className="u-text-end">{t('decay.pending.table.structures')}</th>
            <th scope="col" className="u-text-end">{t('decay.pending.table.dinos')}</th>
            <th scope="col">{t('decay.log.table.by')}</th>
            <th scope="col">{t('decay.log.table.date')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && log.length === 0 ? (
            <TableMessageRow colSpan={7}><Spinner block label={t('decay.loading')} /></TableMessageRow>
          ) : log.length === 0 ? (
            <TableMessageRow colSpan={7}>
              <EmptyState icon={Activity} title={t('decay.emptyLog')} />
            </TableMessageRow>
          ) : log.map(l => (
            <tr key={l.id}>
              <td className="u-mono">{l.targeting_team}</td>
              <td>{l.server_key.split('_')[0]}</td>
              <td>{l.map_name.replace('_WP', '')}</td>
              <td className="u-num u-text-end">{l.structures_destroyed}</td>
              <td className="u-num u-text-end">{l.dinos_destroyed}</td>
              <td className="u-muted">{l.purged_by}</td>
              <td className="u-text-sm u-muted">{fmtShortDateTime(l.purged_at)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}
