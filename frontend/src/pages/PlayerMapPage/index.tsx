/**
 * PlayerMapPage — On-demand player scan with a spatial minimap.
 *
 * Flow: pick a player and a server instance, trigger the plugin's
 * ARKM.DM.PlayerScan over RCON, then render the snapshot from
 * ARKM_player_scan: where the player is, where their structures and dinos
 * are. From a selected point the admin can surgically destroy the tribe's
 * structures/dinos within a radius (ARKM.DM.DestroyRadius) or kill the
 * player if online (ARKM.DM.KillPlayer). Every action re-scans so the map
 * always shows the post-action truth.
 *
 * The minimap uses real GPS placement when the map is calibrated (official
 * maps built in, mod maps via the PlayerMap.MapCalibration config key), and
 * falls back to an auto-fit UU scatter (relative positions) otherwise.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crosshair } from 'lucide-react'
import type { AuthUser } from '../../types'
import { DEFAULT_CALIBRATION, type MapCalib } from '../../utils/mapCalibration'
import { Alert, Card, EmptyState, PageHeader } from '../../components/ui'
import { computeView, sortVisible } from './mapModel'
import { useScanSources } from './hooks/useScanSources'
import { usePlayerScan } from './hooks/usePlayerScan'
import { useMinimapViewport } from './hooks/useMinimapViewport'
import { useMapImage } from './hooks/useMapImage'
import { ScanControls } from './components/ScanControls'
import { Minimap } from './components/Minimap'
import { ActionsPanel } from './components/ActionsPanel'
import { ScanRowsTable } from './components/ScanRowsTable'
import styles from './PlayerMapPage.module.css'

interface Props {
  currentUser?: AuthUser | null
}

export default function PlayerMapPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // Every command on this page goes through an admin-only endpoint -- even
  // the scan, which fires RCON. Showing the controls to an operator who can
  // only ever get a 403 back is a trap, so they are hidden outright.
  const isAdmin = currentUser?.role === 'admin'

  const [error, setError] = useState('')
  const sources = useScanSources({ setError })
  const scan = usePlayerScan({ players: sources.players, instances: sources.instances, setError })

  // Calibration active for the map currently shown, if any. A hand-written
  // override still wins: it is how you correct a map whose own settings are
  // wrong. Then the game's own numbers, then our table.
  const mapName = scan.rows[0]?.map_name || ''
  const calib: MapCalib | null =
    sources.calibOverrides[mapName] || sources.calibFromGame[mapName] || DEFAULT_CALIBRATION[mapName] || null

  // Order matters: the zoom reset and the image fetch both key off mapName,
  // which is derived from the rows above.
  const hasRows = scan.rows.length > 0
  const viewport = useMinimapViewport({ mapName, hasMap: hasRows })
  const mapImg = useMapImage(mapName)

  const visible = useMemo(
    () => sortVisible(scan.rows, scan.layers, scan.sort, calib),
    [scan.rows, scan.layers, scan.sort, calib])
  const view = useMemo(() => computeView(visible, calib), [visible, calib])

  // Resolved against the whole roster: the combobox only offers the first
  // matches, so the selected player can be outside its current list.
  const selectedName = useMemo(
    () => sources.players.find(p => p.eos_id === scan.eosId)?.name || scan.eosId,
    [sources.players, scan.eosId])

  const sel = scan.selected !== null ? scan.rows[scan.selected] : null
  const anyOnline = scan.rows.some(r => r.actor_type === 'player' && r.is_online)
  const counts = {
    structure: scan.rows.filter(r => r.actor_type === 'structure').length,
    dino: scan.rows.filter(r => r.actor_type === 'dino').length,
    player: scan.rows.filter(r => r.actor_type === 'player').length,
  }

  return (
    <div className="l-page">
      <PageHeader title={t('playerMap.title')} icon={Crosshair} description={t('playerMap.subtitle')} />

      <ScanControls
        playerFilter={sources.playerFilter}
        setPlayerFilter={sources.setPlayerFilter}
        filteredPlayers={sources.filteredPlayers}
        eosId={scan.eosId}
        setEosId={scan.setEosId}
        selectedName={selectedName}
        sortedInstances={sources.sortedInstances}
        instanceId={scan.instanceId}
        setInstanceId={scan.setInstanceId}
        isAdmin={isAdmin}
        scanning={scan.scanning}
        acting={scan.acting}
        onScan={kind => scan.runScan(kind)}
        scanReply={scan.scanReply}
        hasRows={hasRows}
        layers={scan.layers}
        counts={counts}
        visibleCount={visible.length}
        totalCount={scan.rows.length}
        onToggleLayer={scan.toggleLayer}
      />

      {error && <Alert tone="danger" onDismiss={() => setError('')}>{error}</Alert>}
      {scan.actionMsg && <Alert tone="success">{scan.actionMsg}</Alert>}
      {scan.truncated && <Alert tone="warning">{t('playerMap.truncated')}</Alert>}
      {scan.unattributed && scan.target && (
        <Alert tone="warning">{t('playerMap.sameMapUnattributed', { map: scan.target.mapName })}</Alert>
      )}

      {hasRows ? (
        <div className={styles.layout}>
          <Minimap
            visible={visible}
            layers={scan.layers}
            counts={counts}
            anyOnline={anyOnline}
            mapName={mapName}
            view={view}
            mapImg={mapImg}
            sel={sel}
            selected={scan.selected}
            radius={scan.radius}
            onSelect={scan.setSelected}
            viewport={viewport}
            calib={calib}
          />
          <div className="l-stack">
            {/* Destroy / kill: admin-only server side, so hidden here too. */}
            {isAdmin && (
              <ActionsPanel
                sel={sel}
                calib={calib}
                radius={scan.radius}
                setRadius={scan.setRadius}
                acting={scan.acting}
                anyOnline={anyOnline}
                onDestroy={scan.doDestroy}
                onDestroyOne={scan.doDestroyOne}
                onKill={scan.doKillPlayer}
              />
            )}
            <Card title={t('playerMap.rowsTitle')} flush>
              <ScanRowsTable
                visible={visible}
                selected={scan.selected}
                onSelect={scan.setSelected}
                sort={scan.sort}
                onToggleSort={scan.toggleSort}
                calib={calib}
              />
            </Card>
          </div>
        </div>
      ) : !scan.scanning && (
        <Card>
          {/* A non-admin already read why the scan buttons are missing, in
              the controls card one step above: repeating it here would say
              the same sentence twice. They get the title alone. */}
          <EmptyState
            icon={Crosshair}
            title={t('playerMap.emptyTitle')}
            description={isAdmin ? t('playerMap.emptyHint') : undefined}
          />
        </Card>
      )}
    </div>
  )
}
