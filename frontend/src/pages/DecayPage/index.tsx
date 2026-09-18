/**
 * DecayPage — Tribe decay management (ARKM_tribe_decay).
 *
 * Three views over the same load: the tribes the plugin tracks, the ones
 * staged for destruction (with the per-object snapshot behind each), and the
 * purge log. The shell owns the tab, wires the hooks together and keeps the
 * open scan detail alive across tab switches.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Clock, Timer } from 'lucide-react'
import { arkDecayApi } from '../../services/api'
import type { AuthUser, ServerInstance } from '../../types'
import { Alert, Tabs } from '../../components/ui'
import { formatHoursLeft, type PendingItem, type TabType } from './decayModel'
import { useDecayData } from './hooks/useDecayData'
import { useMapCommands } from './hooks/useMapCommands'
import { useScanDetail } from './hooks/useScanDetail'
import { usePurgeActions } from './hooks/usePurgeActions'
import { DecayHeader } from './components/DecayHeader'
import { DecayStatsCards } from './components/DecayStatsCards'
import { GrantExpiryModal } from './components/GrantExpiryModal'
import { MapCommandBar } from './components/MapCommandBar'
import { TribesTab } from './tabs/TribesTab'
import { PendingTab } from './tabs/PendingTab'
import { PurgeLogTab } from './tabs/PurgeLogTab'

interface Props {
  currentUser?: AuthUser | null
}

export default function DecayPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // Everything that reaches the plugin over RCON -- purge, per-map commands,
  // set-expiry, single-object destroy -- is Depends(require_admin) on the
  // backend. Staging a tribe in ARKM_decay_pending (schedule / cancel) is
  // require_operator: open to operators, hidden from viewers, who only ever
  // got a 403 back from those buttons.
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'

  const [activeTab, setActiveTab] = useState<TabType>('tribes')

  const data = useDecayData()
  // Every hook below takes the loadData of THIS render: it reads the status
  // filter and the search box from the same closure, so a refresh after a
  // command never re-queries with a filter the operator has left.
  const commands = useMapCommands({ loadData: data.loadData, setError: data.setError })
  const detail = useScanDetail({
    instances: commands.instances,
    cmdInstance: commands.cmdInstance,
    setCmdBusy: commands.setCmdBusy,
    setCmdReply: commands.setCmdReply,
    setError: data.setError,
  })
  const purge = usePurgeActions({ loadData: data.loadData, setError: data.setError })

  // The grant-days prompt is a dialog now, so the row it was opened from has
  // to be remembered while it is up.
  const [grantFor, setGrantFor] = useState<{ p: PendingItem; target: ServerInstance } | null>(null)
  const grantKey = grantFor ? `exp-${grantFor.p.targeting_team}` : null

  // The dialog stays up while the command runs: RCON over a slow link takes
  // seconds, and closing first would leave the submit button's progress
  // behind a dialog that is already gone.
  async function submitGrant(days: number) {
    if (!grantFor) return
    const { p, target } = grantFor
    try {
      await commands.runCmd(`exp-${p.targeting_team}`, () =>
        arkDecayApi.setExpiry(target.id, p.targeting_team, days))
    } finally {
      setGrantFor(null)
    }
  }

  const tabs = [
    { id: 'tribes', label: t('decay.tabs.tribes'), icon: Timer, count: data.stats.total },
    { id: 'pending', label: t('decay.tabs.pending'), icon: Clock, count: data.stats.pending },
    { id: 'log', label: t('decay.tabs.log'), icon: Activity, count: data.stats.purged_last_7d },
  ]

  return (
    <div className="l-page">
      <DecayHeader
        total={data.stats.total}
        isAdmin={isAdmin}
        running={purge.running}
        onRunPurge={purge.handleRunPurge}
      />

      <MapCommandBar
        isAdmin={isAdmin}
        instances={commands.instances}
        cmdInstance={commands.cmdInstance}
        setCmdInstance={commands.setCmdInstance}
        cmdBusy={commands.cmdBusy}
        cmdReply={commands.cmdReply}
        runCmd={commands.runCmd}
      />

      {data.error && (
        <Alert tone="danger" onDismiss={() => data.setError('')}>{data.error}</Alert>
      )}

      <DecayStatsCards stats={data.stats} loading={data.loading} />

      <Tabs
        label={t('decay.tabsLabel')}
        items={tabs}
        value={activeTab}
        onChange={id => setActiveTab(id as TabType)}
      >
        {activeTab === 'tribes' && (
          <TribesTab
            tribes={data.tribes}
            loading={data.loading}
            filterStatus={data.filterStatus}
            setFilterStatus={data.setFilterStatus}
            search={data.search}
            setSearch={data.setSearch}
            onSearchSubmit={data.handleSearch}
            acting={purge.acting}
            running={purge.running}
            isAdmin={isAdmin}
            canOperate={canOperate}
            onSchedule={purge.handleSchedulePurge}
            onPurgeNow={purge.handlePurgeTribeNow}
            formatHoursLeft={h => formatHoursLeft(h, t)}
          />
        )}
        {activeTab === 'pending' && (
          <PendingTab
            pending={data.pending}
            loading={data.loading}
            instances={commands.instances}
            cmdInstance={commands.cmdInstance}
            cmdBusy={commands.cmdBusy}
            isAdmin={isAdmin}
            canOperate={canOperate}
            acting={purge.acting}
            detail={detail}
            onCancel={purge.handleCancelPurge}
            onGrant={(p, target) => setGrantFor({ p, target })}
            runCmd={commands.runCmd}
          />
        )}
        {activeTab === 'log' && <PurgeLogTab log={data.log} loading={data.loading} />}
      </Tabs>

      <GrantExpiryModal
        open={grantFor !== null}
        team={grantFor?.p.targeting_team ?? null}
        target={grantFor?.target ?? null}
        busy={grantKey !== null && commands.cmdBusy === grantKey}
        onClose={() => setGrantFor(null)}
        onSubmit={submitGrant}
      />
    </div>
  )
}
