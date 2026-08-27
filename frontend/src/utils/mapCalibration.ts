/**
 * Per-map GPS calibration: converts ARK world units (UU) to the in-game
 * GPS lat/lon (0..100) shown on the implant map.
 *
 *   lat = latShift + Y / latDiv        lon = lonShift + X / lonDiv
 *
 * Defaults below cover the official maps (values inherited from the ASE
 * wiki; terrain extents are unchanged in ASA). Mod maps — Astraeos, Lost
 * City, Lost Colony, … — are NOT here on purpose: guessing a divisor
 * would place dots confidently in the wrong spot, which is worse than
 * showing raw UU. Calibrate them yourself via the plugin config key
 * `PlayerMap.MapCalibration` (server '*'), a JSON object keyed by the
 * map_name reported by the scan:
 *
 *   {"Astraeos_WP": {"latShift":50,"latDiv":20000,"lonShift":50,"lonDiv":20000}}
 *
 * Overrides win over the defaults, so a wrong default can also be
 * corrected from the panel without a redeploy.
 */

export interface MapCalib {
  latShift: number
  latDiv: number
  lonShift: number
  lonDiv: number
}

export const DEFAULT_CALIBRATION: Record<string, MapCalib> = {
  TheIsland_WP:     { latShift: 50,    latDiv: 8000,   lonShift: 50,   lonDiv: 8000 },
  ScorchedEarth_WP: { latShift: 50,    latDiv: 8000,   lonShift: 50,   lonDiv: 8000 },
  Aberration_WP:    { latShift: 50,    latDiv: 8000,   lonShift: 50,   lonDiv: 8000 },
  Extinction_WP:    { latShift: 50,    latDiv: 8000,   lonShift: 50,   lonDiv: 8000 },
  Valguero_WP:      { latShift: 50,    latDiv: 8161.6, lonShift: 50,   lonDiv: 8161.6 },
  Ragnarok_WP:      { latShift: 50,    latDiv: 13100,  lonShift: 50,   lonDiv: 13100 },
  TheCenter_WP:     { latShift: 30.34, latDiv: 9584,   lonShift: 55.1, lonDiv: 9600 },
  Genesis_WP:       { latShift: 50,    latDiv: 10500,  lonShift: 50,   lonDiv: 10500 },
  LostIsland_WP:    { latShift: 48.9,  latDiv: 15300,  lonShift: 48.75, lonDiv: 15300 },
  Fjordur_WP:       { latShift: 50,    latDiv: 13100,  lonShift: 50,   lonDiv: 13100 },
}

/**
 * Convert the raw world settings the plugin publishes into a MapCalib.
 *
 * Semantics (verified live in ARKM-RareDino::WorldToGPS): origin is the
 * world-unit coordinate of the GPS-zero corner and `scale * 10` is the
 * number of world units per GPS degree, so
 * `lat = (y - latOrigin) / (latScale * 10)`, which is our
 * `latShift + y / latDiv` with the substitutions below.
 * Returns null for a map that leaves the scales at zero.
 */
export function calibFromWorldSettings(w: {
  lat_origin: number; lat_scale: number
  lon_origin: number; lon_scale: number
}): MapCalib | null {
  const latDiv = w.lat_scale * 10
  const lonDiv = w.lon_scale * 10
  if (!latDiv || !lonDiv) return null
  return {
    latShift: -w.lat_origin / latDiv, latDiv,
    lonShift: -w.lon_origin / lonDiv, lonDiv,
  }
}

/** UU → GPS. */
export function gpsOf(c: MapCalib, x: number, y: number): { lat: number; lon: number } {
  return { lat: c.latShift + y / c.latDiv, lon: c.lonShift + x / c.lonDiv }
}

/** GPS 0..100 → UU bounds of the whole map square. */
export function fullMapBounds(c: MapCalib) {
  return {
    minX: (0 - c.lonShift) * c.lonDiv,
    minY: (0 - c.latShift) * c.latDiv,
    spanX: 100 * c.lonDiv,
    spanY: 100 * c.latDiv,
  }
}

/** Parse the `PlayerMap.MapCalibration` config value; {} on any problem. */
export function parseCalibOverrides(raw: string | null | undefined): Record<string, MapCalib> {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    const out: Record<string, MapCalib> = {}
    for (const [k, v] of Object.entries(obj as Record<string, Partial<MapCalib>>)) {
      if (v && typeof v.latDiv === 'number' && typeof v.lonDiv === 'number'
          && v.latDiv !== 0 && v.lonDiv !== 0) {
        out[k] = {
          latShift: typeof v.latShift === 'number' ? v.latShift : 50,
          latDiv: v.latDiv,
          lonShift: typeof v.lonShift === 'number' ? v.lonShift : 50,
          lonDiv: v.lonDiv,
        }
      }
    }
    return out
  } catch {
    return {}
  }
}
