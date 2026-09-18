/**
 * mapModel — types, dot palette and the pure geometry of the player map.
 * No React, no API.
 */
import { gpsOf, fullMapBounds, type MapCalib } from '../../utils/mapCalibration'
import type { SortState } from '../../components/ui'

export interface ScanRow {
  targeting_team: number; server_key: string; map_name: string
  actor_type: string; class_name: string; display_name: string | null
  custom_name: string | null; owner_name: string | null
  pos_x: number; pos_y: number; pos_z: number
  dino_level: number; is_online: boolean; scanned_at: string | null
  actor_name: string | null
}

/**
 * The player and server a scan was run against. Every action on the map
 * reuses it instead of the live pickers: the dots, the tribe id and the
 * coordinates belong to this pair, and firing them at whatever is selected
 * now would hit another player or another map.
 */
export interface ScanTarget {
  eosId: string; instanceId: number; mapName: string; label: string
  /**
   * The plugin's server_key for this instance, once a scan has proven it.
   * Only resolved when another active server runs the same map, where the
   * map prefix alone cannot tell the two servers' rows apart (see loadRows).
   */
  serverKey?: string
}

/** server_key and map names both start with the map; the suffix varies. */
export const mapPrefix = (name: string) => name.split('_')[0]

/** Newest scanned_at per server_key before a scan; `complete` is false when the read was truncated. */
export type ScanBaseline = { newest: Map<string, string>; complete: boolean }

/** Newest scanned_at per server_key. The 'YYYY-MM-DD HH:MM:SS' text sorts as a date. */
export function newestPerKey(rows: ScanRow[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    const s = r.scanned_at || ''
    if (s > (out.get(r.server_key) ?? '')) out.set(r.server_key, s)
  }
  return out
}

/**
 * Data colours for the dots: they sit on a photographic topographic map,
 * where a theme ink simply disappears, so they use the categorical series
 * tokens plus a sunken-plane halo that reads over both pale coastlines and
 * the dark interior.
 */
export const DOT: Record<string, { r: number; fill: string }> = {
  structure: { r: 3, fill: 'var(--color-series-1)' },
  dino: { r: 5, fill: 'var(--color-series-5)' },
  player: { r: 7, fill: 'var(--color-series-2)' },
}

export const DOT_HALO = 'var(--color-surface-sunken)'
/**
 * Offline character. Online vs offline is a STATUS, and the series ramp is
 * categorical ("never for status", MASTER 3.5), so this is the neutral ink
 * the design system already pairs with offline elsewhere (StatusBadge maps
 * offline to tone="neutral"). The legend writes the word too.
 */
export const OFFLINE_FILL = 'var(--color-text-muted)'

/** The SVG coordinate space. The rendered size comes from CSS, not from here. */
export const SIZE = 560

export type SortKey = 'type' | 'name' | 'level' | 'lat' | 'lon'

export type ScanSort = SortState<SortKey> | null

/**
 * Keep only the newest scan batch, PER LAYER: a per-layer re-scan leaves the
 * other layers with an older timestamp, and a single cluster-wide cutoff
 * would silently drop them from the map. Chunked inserts straddle seconds,
 * hence the 2-minute window.
 */
export function pickLatestBatch(onMap: ScanRow[]): ScanRow[] {
  const newestOf: Record<string, number> = {}
  for (const r of onMap) {
    const ms = new Date(r.scanned_at || 0).getTime()
    if (!(r.actor_type in newestOf) || ms > newestOf[r.actor_type]) newestOf[r.actor_type] = ms
  }
  return onMap.filter(r =>
    Math.abs(new Date(r.scanned_at || 0).getTime() - newestOf[r.actor_type]) < 120_000)
}

/**
 * Rows the map and table show, each paired with its index in `rows` so
 * selection keeps pointing at the master list.
 */
export function sortVisible(
  rows: ScanRow[],
  layers: Record<string, boolean>,
  sort: ScanSort,
  calib: MapCalib | null,
): { r: ScanRow; i: number }[] {
  const out = rows.map((r, i) => ({ r, i })).filter(({ r }) => layers[r.actor_type])
  if (!sort) return out          // no sort = scan order, the plugin's own
  // Sort on the number the operator reads, not on the raw coordinate: the
  // calibration divisors are per-map and nothing guarantees their sign, so
  // ordering by pos_y would silently invert Lat on a map that flips it.
  const dir = sort.dir === 'asc' ? 1 : -1
  const key = (r: ScanRow): string | number => {
    switch (sort.key) {
      case 'type': return r.actor_type
      case 'name': return (r.custom_name || r.display_name || r.class_name).toLowerCase()
      case 'level': return r.dino_level
      case 'lat': return calib ? gpsOf(calib, r.pos_x, r.pos_y).lat : r.pos_y
      case 'lon': return calib ? gpsOf(calib, r.pos_x, r.pos_y).lon : r.pos_x
    }
  }
  return out.sort((a, b) => {
    const ka = key(a.r), kb = key(b.r)
    return ka < kb ? -dir : ka > kb ? dir : 0
  })
}

export interface MapView {
  minX: number; minY: number; span: number; calibrated: boolean
}

/**
 * Calibrated map: fixed square = the whole map (GPS 0..100), so dots sit at
 * their true in-game position and the axes read as GPS. Uncalibrated:
 * auto-fit around the objects (relative positions only, no GPS meaning).
 */
export function computeView(
  visible: { r: ScanRow; i: number }[],
  calib: MapCalib | null,
): MapView | null {
  if (visible.length === 0) return null
  if (calib) {
    const b = fullMapBounds(calib)
    const span = Math.max(b.spanX, b.spanY)
    return { minX: b.minX, minY: b.minY, span, calibrated: true }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { r } of visible) {
    if (r.pos_x < minX) minX = r.pos_x; if (r.pos_x > maxX) maxX = r.pos_x
    if (r.pos_y < minY) minY = r.pos_y; if (r.pos_y > maxY) maxY = r.pos_y
  }
  const spanX = Math.max(maxX - minX, 1000), spanY = Math.max(maxY - minY, 1000)
  const pad = 0.06 * Math.max(spanX, spanY)
  return { minX: minX - pad, minY: minY - pad, span: Math.max(spanX, spanY) + 2 * pad, calibrated: false }
}

export function projectX(r: ScanRow, view: MapView | null): number {
  return view ? ((r.pos_x - view.minX) / view.span) * SIZE : 0
}

export function projectY(r: ScanRow, view: MapView | null): number {
  return view ? ((r.pos_y - view.minY) / view.span) * SIZE : 0
}

export function gpsLabel(r: ScanRow, calib: MapCalib | null): string | null {
  if (!calib) return null
  const g = gpsOf(calib, r.pos_x, r.pos_y)
  return `${g.lat.toFixed(1)}, ${g.lon.toFixed(1)}`
}

/**
 * Coordinates the way a player reads them in game: GPS lat/lon.
 *
 * The raw world units are what the plugin stores and what `cheat TPCoords`
 * needs, but they mean nothing to anyone looking at the map, so they only
 * show when the map has no calibration to convert them.
 */
export function coordLabel(r: ScanRow, calib: MapCalib | null): string {
  const g = gpsLabel(r, calib)
  if (g) { const [la, lo] = g.split(', '); return `Lat ${la}  Lon ${lo}` }
  return uuLabel(r)
}

/** The raw world-unit triplet, which is what `cheat TPCoords` takes. */
export function uuLabel(r: ScanRow): string {
  return `${Math.round(r.pos_x)} ${Math.round(r.pos_y)} ${Math.round(r.pos_z)}`
}

export function tpCommand(r: ScanRow): string {
  return `cheat TPCoords ${uuLabel(r)}`
}

/**
 * Lat and Lon as separate cells, so each column header can sort on its own
 * axis; the UU triplet stays in the cell title.
 */
export function latLonCells(r: ScanRow, calib: MapCalib | null): [string | number, string | number] {
  return calib
    ? [gpsOf(calib, r.pos_x, r.pos_y).lat.toFixed(1), gpsOf(calib, r.pos_x, r.pos_y).lon.toFixed(1)]
    : [Math.round(r.pos_y), Math.round(r.pos_x)]
}

export function rowName(r: ScanRow): string {
  return r.custom_name || r.display_name || r.class_name
}
