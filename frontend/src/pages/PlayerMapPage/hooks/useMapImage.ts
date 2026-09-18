/**
 * useMapImage — the cached topographic image for the map on screen.
 *
 * The object URL is tagged with the map it belongs to: while a new map's
 * image is in flight the old URL is still in state, and drawing it would show
 * the previous map's terrain under the new map's dots.
 */
import { useEffect, useState } from 'react'
import { arkDecayApi } from '../../../services/api'

export interface MapImage { name: string; url: string }

export function useMapImage(mapName: string): MapImage | null {
  const [mapImg, setMapImg] = useState<MapImage | null>(null)

  useEffect(() => {
    if (!mapName) return
    let cancelled = false
    arkDecayApi.mapImage(mapName)
      .then(r => { if (!cancelled) setMapImg({ name: mapName, url: URL.createObjectURL(r.data) }) })
      .catch(() => { if (!cancelled) setMapImg(null) })
    return () => { cancelled = true }
  }, [mapName])

  // Each blob URL is revoked once it is off screen: when the next image (or
  // null) has replaced it, and on unmount. Not in the effect above: revoking
  // on a mapName change killed the image that was still on screen while the
  // next one downloaded, and the last one used to outlive the page.
  useEffect(() => {
    if (!mapImg) return
    return () => URL.revokeObjectURL(mapImg.url)
  }, [mapImg])

  return mapImg
}
