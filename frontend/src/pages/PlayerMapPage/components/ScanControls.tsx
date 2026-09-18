/**
 * ScanControls — who to scan, where, and what the map currently draws.
 *
 * Every command here is admin-only on the backend (even the scan, which
 * fires RCON), so an operator who could only ever get a 403 back is told
 * instead of shown a trap. The layer toggles, the pickers and the Clear
 * button are display state and stay available to everyone: none of them
 * touches the snapshot.
 */
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, RefreshCw, X } from 'lucide-react'
import type { ScanKind } from '../../../services/api'
import type { PlayerListItem, ServerInstance } from '../../../types'
import { Alert, Button, Card, Combobox, Field, Select } from '../../../components/ui'

interface Props {
  playerFilter: string
  setPlayerFilter: (v: string) => void
  filteredPlayers: PlayerListItem[]
  eosId: string
  setEosId: (v: string) => void
  /** Resolved from the full roster, not the capped option list. */
  selectedName: string
  sortedInstances: ServerInstance[]
  instanceId: number | ''
  setInstanceId: (v: number | '') => void
  isAdmin: boolean
  scanning: boolean
  acting: boolean
  onScan: (kind: ScanKind) => void
  scanReply: string
  hasRows: boolean
  layers: Record<string, boolean>
  counts: { structure: number; dino: number; player: number }
  visibleCount: number
  totalCount: number
  onToggleLayer: (k: string) => void
}

export function ScanControls({
  playerFilter, setPlayerFilter, filteredPlayers, eosId, setEosId, selectedName,
  sortedInstances, instanceId, setInstanceId, isAdmin, scanning, acting, onScan,
  scanReply, hasRows, layers, counts, visibleCount, totalCount, onToggleLayer,
}: Props) {
  const { t } = useTranslation()
  const canScan = !scanning && eosId !== '' && instanceId !== ''
  // Locked while a scan or an action runs: its result would land under a
  // selection it does not belong to.
  const locked = scanning || acting

  const layerRows: [string, number, string][] = [
    ['structure', counts.structure, t('playerMap.structures')],
    ['dino', counts.dino, t('playerMap.dinos')],
    ['player', counts.player, t('playerMap.characters')],
  ]

  return (
    <Card title={t('playerMap.scanTitle')}>
      <div className="l-stack">
        <div className="l-grid--form">
          <Field
            label={t('playerMap.player')}
            hint={eosId
              ? t('playerMap.selectedPlayer', { name: selectedName })
              : t('playerMap.pickPlayerHint')}
          >
            <Combobox<PlayerListItem>
              inputValue={playerFilter}
              onInputChange={setPlayerFilter}
              options={filteredPlayers}
              getKey={p => p.eos_id}
              renderOption={p => (
                <>
                  <span>{p.name || t('playerMap.noName')}</span>{' '}
                  <span className="u-muted u-mono u-text-sm">{p.eos_id.slice(0, 10)}…</span>
                </>
              )}
              onSelect={p => { setEosId(p.eos_id); setPlayerFilter(p.name || p.eos_id) }}
              placeholder={t('playerMap.searchPlayer')}
              disabled={locked}
            />
          </Field>
          <Field label={t('playerMap.server')}>
            <Select
              value={instanceId}
              disabled={locked}
              onChange={e => setInstanceId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">{t('playerMap.pickServer')}</option>
              {sortedInstances.map(i => (
                <option key={i.id} value={i.id}>{i.display_name || i.name} ({i.map_name})</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Deselecting a player is not a command: it is how every role gets
            back to "no player selected", which the old select did with its
            own "—" option. It stays outside the admin branch. */}
        {(isAdmin || eosId !== '') && (
          <div className="l-cluster">
            {isAdmin && (
              <>
                <Button
                  variant="primary"
                  icon={RefreshCw}
                  loading={scanning}
                  loadingLabel={t('playerMap.scanning')}
                  disabled={!canScan}
                  onClick={() => onScan('all')}
                >
                  {t('playerMap.scan')}
                </Button>
                {/* Per-layer re-scan: same command, one layer. The plugin wipes
                    only that layer's snapshot, so the others stay on the map. */}
                {([['structures', 'scanStructures'], ['dinos', 'scanDinos'],
                   ['players', 'scanPlayers']] as [ScanKind, string][]).map(([k, lbl]) => (
                  <Button
                    key={k}
                    size="sm"
                    disabled={!canScan}
                    title={t('playerMap.scanLayerHint')}
                    onClick={() => onScan(k)}
                  >
                    {t(`playerMap.${lbl}`)}
                  </Button>
                ))}
              </>
            )}
            {eosId !== '' && (
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                disabled={locked}
                onClick={() => { setEosId(''); setPlayerFilter('') }}
              >
                {t('playerMap.clearPlayer')}
              </Button>
            )}
          </div>
        )}

        {!isAdmin && <Alert tone="info">{t('playerMap.adminOnly')}</Alert>}

        {scanReply && <p className="u-muted u-text-sm u-wrap-anywhere">{scanReply}</p>}

        {hasRows && (
          // Display filter, deliberately separate from the scan buttons
          // above: hiding a layer only changes what you look at, it never
          // touches the snapshot. A base with a couple of thousand
          // foundations buries the handful of dots that matter.
          <div className="l-cluster">
            <span className="u-secondary u-text-sm">{t('playerMap.showLabel')}</span>
            {layerRows.map(([k, n, label]) => (
              <Button
                key={k}
                size="sm"
                icon={layers[k] ? Eye : EyeOff}
                pressed={layers[k]}
                title={t('playerMap.toggleLayer')}
                onClick={() => onToggleLayer(k)}
              >
                {`${label} (${n})`}
              </Button>
            ))}
            <span className="u-muted u-text-sm" role="status">
              {t('playerMap.visibleCount', { shown: visibleCount, total: totalCount })}
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}
