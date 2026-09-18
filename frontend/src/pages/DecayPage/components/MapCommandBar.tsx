/**
 * MapCommandBar — instance picker plus the four per-map plugin commands.
 *
 * Every plugin command is scoped to one server, so the operator says WHICH
 * map instead of firing at the whole cluster. Admin only; everyone else gets
 * the note explaining what the page still lets them do.
 */
import { useTranslation } from 'react-i18next'
import { RefreshCw, RotateCw, Server, Skull, Trash2 } from 'lucide-react'
import { arkDecayApi } from '../../../services/api'
import type { ServerInstance } from '../../../types'
import { Alert, Button, Card, Select } from '../../../components/ui'
import { instanceLabel } from '../decayModel'
import type { CmdResponse } from '../hooks/useMapCommands'
import type { ConfirmOptions } from '../../../components/ui'

interface Props {
  isAdmin: boolean
  instances: ServerInstance[]
  cmdInstance: number | ''
  setCmdInstance: (v: number | '') => void
  cmdBusy: string | null
  cmdReply: string
  runCmd: (key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) => Promise<void>
}

export function MapCommandBar({
  isAdmin, instances, cmdInstance, setCmdInstance, cmdBusy, cmdReply, runCmd,
}: Props) {
  const { t } = useTranslation()

  if (!isAdmin) {
    return <Alert tone="info">{t('decay.adminOnly')}</Alert>
  }

  const noInstance = cmdInstance === ''
  const id = cmdInstance as number

  return (
    <Card title={t('decay.cmd.title')} icon={Server}>
      <div className="l-stack l-stack--sm">
        <div className="l-cluster">
          <Select
            aria-label={t('decay.cmd.pickServer')}
            value={cmdInstance}
            onChange={e => setCmdInstance(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">{t('decay.cmd.pickServer')}</option>
            {instances.map(i => (
              <option key={i.id} value={i.id}>{instanceLabel(i)} ({i.map_name})</option>
            ))}
          </Select>
          <Button
            size="sm"
            icon={RefreshCw}
            disabled={noInstance || cmdBusy !== null}
            loading={cmdBusy === 'scan'}
            onClick={() => runCmd('scan', () => arkDecayApi.scanInstance(id))}
          >
            {t('decay.cmd.scan')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            disabled={noInstance || cmdBusy !== null}
            loading={cmdBusy === 'purge'}
            onClick={() => runCmd('purge', () => arkDecayApi.purgeInstance(id), {
              title: t('decay.cmd.purgeMap'),
              description: t('decay.cmd.confirmPurge'),
              confirmLabel: t('decay.cmd.purgeMapAction'),
              tone: 'danger',
            })}
          >
            {t('decay.cmd.purgeMap')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Skull}
            disabled={noInstance || cmdBusy !== null}
            loading={cmdBusy === 'unclaimed'}
            onClick={() => runCmd('unclaimed', () => arkDecayApi.cleanupUnclaimed(id), {
              title: t('decay.cmd.unclaimed'),
              description: t('decay.cmd.confirmUnclaimed'),
              confirmLabel: t('decay.cmd.unclaimedAction'),
              tone: 'danger',
            })}
          >
            {t('decay.cmd.unclaimed')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCw}
            disabled={noInstance || cmdBusy !== null}
            loading={cmdBusy === 'reload'}
            onClick={() => runCmd('reload', () => arkDecayApi.reloadInstance(id))}
          >
            {t('decay.cmd.reload')}
          </Button>
        </div>
        {cmdReply && (
          <Alert tone="success" title={t('decay.cmd.replyTitle')}>
            <span className="u-mono">{cmdReply}</span>
          </Alert>
        )}
      </div>
    </Card>
  )
}
