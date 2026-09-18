/**
 * ActionsPanel — what the admin can do to the selected point.
 *
 * Destroy and kill are admin-only server side, so the whole panel is hidden
 * for anyone else. Every action re-scans afterwards, which is why the target
 * comes from the scan and never from the live pickers.
 */
import { useTranslation } from 'react-i18next'
import { Building, Crosshair, MapPin, Skull } from 'lucide-react'
import type { MapCalib } from '../../../utils/mapCalibration'
import { Button, Card, CopyButton, Field, Input } from '../../../components/ui'
import { coordLabel, gpsLabel, rowName, tpCommand, uuLabel, type ScanRow } from '../mapModel'

interface Props {
  sel: ScanRow | null
  calib: MapCalib | null
  radius: number
  setRadius: (v: number) => void
  acting: boolean
  anyOnline: boolean
  onDestroy: (kind: 'structures' | 'dinos' | 'all', center: ScanRow, radiusM: number) => void
  onDestroyOne: (row: ScanRow) => void
  onKill: () => void
}

export function ActionsPanel({
  sel, calib, radius, setRadius, acting, anyOnline, onDestroy, onDestroyOne, onKill,
}: Props) {
  const { t } = useTranslation()

  return (
    <Card title={t('playerMap.actionsTitle')} icon={MapPin}>
      <div className="l-stack">
        {sel ? (
          <>
            <p className="l-cluster">
              <strong>{rowName(sel)}</strong>
              <span className="u-mono u-text-sm">{coordLabel(sel, calib)}</span>
              {gpsLabel(sel, calib) && (
                <span className="u-mono u-text-sm u-muted">({uuLabel(sel)})</span>
              )}
              <CopyButton value={tpCommand(sel)} label={t('playerMap.copyTp', { what: rowName(sel) })} />
            </p>
            <div className="l-cluster">
              <Field label={t('playerMap.radius')}>
                <Input
                  type="number"
                  size="sm"
                  min={1}
                  max={2000}
                  value={radius}
                  onChange={e => setRadius(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                />
              </Field>
              <Button
                size="sm"
                variant="danger"
                icon={Building}
                disabled={acting}
                onClick={() => onDestroy('structures', sel, radius)}
              >
                {t('playerMap.actions.structures')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={Skull}
                disabled={acting}
                onClick={() => onDestroy('dinos', sel, radius)}
              >
                {t('playerMap.actions.dinos')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={acting}
                onClick={() => onDestroy('all', sel, radius)}
              >
                {t('playerMap.actions.all')}
              </Button>
              {sel.actor_name && sel.actor_type !== 'player' && (
                <Button
                  size="sm"
                  variant="danger"
                  icon={Crosshair}
                  disabled={acting}
                  title={sel.actor_name}
                  onClick={() => onDestroyOne(sel)}
                >
                  {t('playerMap.destroyThis')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="u-muted u-text-sm">{t('playerMap.selectHint')}</p>
        )}

        <div className="l-cluster">
          <Button
            size="sm"
            variant="danger"
            icon={Skull}
            disabled={acting || !anyOnline}
            title={anyOnline ? undefined : t('playerMap.killOfflineHint')}
            onClick={onKill}
          >
            {t('playerMap.killPlayer')}
          </Button>
          {!anyOnline && <span className="u-muted u-text-sm">{t('playerMap.killOfflineHint')}</span>}
        </div>
      </div>
    </Card>
  )
}
