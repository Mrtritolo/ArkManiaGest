/**
 * DecayStatsCards — the six aggregate counters above the tabs.
 */
import { useTranslation } from 'react-i18next'
import { Building, CircleCheck, CircleX, Clock, TriangleAlert, Trash2 } from 'lucide-react'
import { StatTile } from '../../../components/ui'
import type { DecayStats } from '../decayModel'

interface Props {
  stats: DecayStats
  loading: boolean
}

export function DecayStatsCards({ stats, loading }: Props) {
  const { t } = useTranslation()
  const tiles = [
    { label: t('decay.stats.total'), value: stats.total, icon: Building },
    { label: t('decay.stats.expired'), value: stats.expired, icon: CircleX, tone: 'danger' as const },
    { label: t('decay.stats.expiring'), value: stats.expiring_soon, icon: TriangleAlert, tone: 'warning' as const },
    { label: t('decay.stats.safe'), value: stats.safe, icon: CircleCheck },
    { label: t('decay.stats.pending'), value: stats.pending, icon: Clock },
    { label: t('decay.stats.purged7d'), value: stats.purged_last_7d, icon: Trash2 },
  ]

  return (
    <div className="l-grid--stats">
      {tiles.map(tile => (
        <StatTile
          key={tile.label}
          label={tile.label}
          value={tile.value}
          icon={tile.icon}
          loading={loading}
          // The problem counters state the problem in words as well as colour.
          meta={tile.tone && tile.value > 0 ? t(`decay.stats.meta.${tile.tone}`, { count: tile.value }) : undefined}
          metaTone={tile.tone && tile.value > 0 ? tile.tone : undefined}
        />
      ))}
    </div>
  )
}
