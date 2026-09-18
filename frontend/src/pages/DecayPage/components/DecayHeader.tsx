/**
 * DecayHeader — page title and the cluster-wide purge trigger.
 * The sweep is admin-only on the backend, so the button only exists for one.
 */
import { useTranslation } from 'react-i18next'
import { Timer, Trash2 } from 'lucide-react'
import { Button, PageHeader } from '../../../components/ui'

interface Props {
  total: number
  isAdmin: boolean
  running: boolean
  onRunPurge: () => void
}

export function DecayHeader({ total, isAdmin, running, onRunPurge }: Props) {
  const { t } = useTranslation()
  return (
    <PageHeader
      title={t('decay.heading')}
      icon={Timer}
      description={t('decay.subtitle', { count: total })}
      actions={isAdmin ? (
        <Button
          variant="danger"
          icon={Trash2}
          loading={running}
          loadingLabel={t('decay.runningPurge')}
          title={t('decay.runPurgeTitle')}
          onClick={onRunPurge}
        >
          {t('decay.runPurgeButton')}
        </Button>
      ) : undefined}
    />
  )
}
