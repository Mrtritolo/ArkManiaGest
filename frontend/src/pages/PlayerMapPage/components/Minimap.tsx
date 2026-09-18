/**
 * Minimap — the spatial view of one scan.
 *
 * The dots keep their `data-dot` attribute: the pointer-down handler skips
 * them, because setPointerCapture retargets every later pointer event to the
 * <svg> and a capture started on a dot swallows the dot's own click.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Building, Maximize2, PawPrint, User, ZoomIn, ZoomOut } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MapCalib } from '../../../utils/mapCalibration'
import { Alert, Card, IconButton } from '../../../components/ui'
import {
  DOT, DOT_HALO, OFFLINE_FILL, SIZE, coordLabel, projectX, projectY, rowName,
  type MapView, type ScanRow,
} from '../mapModel'
import type { MapImage } from '../hooks/useMapImage'
import type { MinimapViewport } from '../hooks/useMinimapViewport'
import styles from '../PlayerMapPage.module.css'

const LAYER_ICONS: Record<string, LucideIcon> = {
  structure: Building, dino: PawPrint, player: User,
}

interface Props {
  visible: { r: ScanRow; i: number }[]
  layers: Record<string, boolean>
  counts: { structure: number; dino: number; player: number }
  anyOnline: boolean
  mapName: string
  view: MapView | null
  mapImg: MapImage | null
  sel: ScanRow | null
  selected: number | null
  radius: number
  onSelect: (index: number) => void
  viewport: MinimapViewport
  calib: MapCalib | null
}

export function Minimap({
  visible, layers, counts, anyOnline, mapName, view, mapImg, sel, selected,
  radius, onSelect, viewport, calib,
}: Props) {
  const { t } = useTranslation()
  const { k, viewBox, zoom, pan, svgRef, zoomAt, resetZoom, dragging, maxZoom } = viewport

  // A pan only moves the viewBox. The dot layer runs to thousands of elements
  // on a big base, so it is memoised: a drag must not rebuild it every move.
  const dots = useMemo(() => visible.map(({ r, i }) => {
    const d = DOT[r.actor_type] || DOT.structure
    const isSel = i === selected
    return (
      <circle
        key={i}
        data-dot=""
        cx={projectX(r, view)}
        cy={projectY(r, view)}
        r={(isSel ? d.r + 3 : d.r) * k}
        fill={r.actor_type === 'player' && !r.is_online ? OFFLINE_FILL : d.fill}
        stroke={isSel ? 'var(--color-accent)' : DOT_HALO}
        strokeWidth={(isSel ? 2 : 1) * k}
        onClick={e => { e.stopPropagation(); onSelect(i) }}
      >
        <title>{`${rowName(r)}\n${coordLabel(r, calib)}`}</title>
      </circle>
    )
  }), [visible, view, calib, selected, k, onSelect])

  const legend: [string, string, string][] = [
    ['structure', String(counts.structure), t('playerMap.structures')],
    ['dino', String(counts.dino), t('playerMap.dinos')],
    ['player', anyOnline ? t('playerMap.online') : t('playerMap.offline'), t('playerMap.playerDot')],
  ]

  return (
    <Card title={mapName || t('playerMap.mapTitle')}>
      <div className="l-stack l-stack--sm">
        {/* Plain legend: the filter itself lives in the controls above, where
            it is visible before you scroll down to the map. */}
        <p className={styles.legend}>
          {legend.map(([kind, value, label]) => {
            const Icon = LAYER_ICONS[kind]
            const hidden = !layers[kind]
            const fill = kind === 'player' && !anyOnline ? OFFLINE_FILL : DOT[kind].fill
            return (
              <span key={kind} className={styles.legendItem} data-hidden={hidden || undefined}>
                <span className={styles.swatch} style={{ background: fill }} aria-hidden="true" />
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {value} {label}
                {hidden && <span className="u-sr-only"> {t('playerMap.layerHidden')}</span>}
              </span>
            )
          })}
        </p>

        {/* role="img" makes the whole graphic one named object, so the dot
            <title>s and the clickable circles are not exposed. That is
            deliberate: the circles were never keyboard reachable, and
            ScanRowsTable below carries the same rows with a real button per
            object. It is the accessible equivalent of this picture. */}
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className={styles.map}
          data-dragging={dragging || undefined}
          role="img"
          aria-label={t('playerMap.mapAria', { map: mapName, count: visible.length })}
          onPointerDown={viewport.onPointerDown}
          onPointerMove={viewport.onPointerMove}
          onPointerUp={viewport.onPointerUp}
        >
          {/* Topographic background: only meaningful when calibrated, because
              only then does the square correspond to the whole map.
              Uncalibrated maps keep the plain auto-fit view -- an image
              stretched over arbitrary bounds would put dots in convincingly
              wrong places. */}
          {mapImg?.name === mapName && view?.calibrated && (
            <image href={mapImg.url} x={0} y={0} width={SIZE} height={SIZE} preserveAspectRatio="none" />
          )}
          {[1, 2, 3].map(i => (
            <g key={i} stroke="var(--color-border)" strokeWidth={0.5 * k} opacity={0.6}>
              <line x1={(SIZE / 4) * i} y1={0} x2={(SIZE / 4) * i} y2={SIZE} />
              <line x1={0} y1={(SIZE / 4) * i} x2={SIZE} y2={(SIZE / 4) * i} />
            </g>
          ))}
          {view?.calibrated && (
            <g
              fill="var(--color-text-muted)"
              fontSize={9 * k}
              fontFamily="var(--font-mono)"
              style={{ paintOrder: 'stroke' }}
              stroke="var(--color-surface-sunken)"
              strokeWidth={2 * k}
            >
              <text x={3} y={11}>Lon 0 / Lat 0</text>
              <text x={SIZE - 3} y={11} textAnchor="end">Lon 100</text>
              <text x={3} y={SIZE - 4}>Lat 100</text>
            </g>
          )}
          {sel && view && (
            <circle
              cx={projectX(sel, view)}
              cy={projectY(sel, view)}
              r={(radius * 100 / view.span) * SIZE}
              fill="var(--color-danger)"
              opacity={0.1}
              stroke="var(--color-danger)"
              style={{ pointerEvents: 'none' }}
              strokeDasharray={`${4 * k} ${3 * k}`}
              strokeWidth={1 * k}
            />
          )}
          {dots}
        </svg>

        <div className="l-cluster">
          <IconButton
            size="sm"
            icon={ZoomOut}
            label={t('playerMap.zoomOut')}
            disabled={zoom <= 1}
            onClick={() => zoomAt(1 / 1.4)}
          />
          <IconButton
            size="sm"
            icon={ZoomIn}
            label={t('playerMap.zoomIn')}
            disabled={zoom >= maxZoom}
            onClick={() => zoomAt(1.4)}
          />
          <IconButton
            size="sm"
            icon={Maximize2}
            label={t('playerMap.zoomReset')}
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
            onClick={resetZoom}
          />
          <span className="u-mono u-text-sm u-muted" role="status">
            {t('playerMap.zoomLevel', { zoom: zoom.toFixed(1) })}
          </span>
        </div>

        <p className="u-muted u-text-sm">
          {view?.calibrated ? t('playerMap.mapHintGps') : t('playerMap.mapHint')}
          {' '}{t('playerMap.zoomHint')}
        </p>
        {/* A warning, not a note: without calibration the axes carry no GPS
            meaning at all, and the dot scatter is relative only. Reading it
            as real positions is exactly the mistake to prevent. */}
        {view && !view.calibrated && (
          <Alert tone="warning">{t('playerMap.noCalibration', { map: mapName })}</Alert>
        )}
      </div>
    </Card>
  )
}
