/**
 * useMinimapViewport — zoom and pan over the map square, in SVG units.
 *
 * Zoom works on the viewBox rather than by scaling coordinates, so one dot
 * stays one dot: stroke widths, labels and hit areas keep their pixel size
 * while the terrain underneath gets bigger.
 *
 * zoomAt clamps the pan inside a setPan nested in the setZoom updater, using
 * the zoom of that update rather than the render's: keeping zoom, pan and
 * both clamps in one hook is what stops a wheel listener attached at an
 * earlier zoom from panning against a stale limit.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SIZE } from '../mapModel'

const MAX_ZOOM = 8

interface Args {
  mapName: string
  /** The SVG only exists while there are rows: the wheel listener follows it. */
  hasMap: boolean
}

export function useMinimapViewport({ mapName, hasMap }: Args) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  // The drag origin lives in a ref: it changes on every pointermove, and as
  // state each move re-rendered the whole dot layer and table. Only the grab
  // cursor needs a render, and that flips twice per drag.
  const dragFrom = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // A new map starts from the full view.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [mapName])

  const VIEW = SIZE / zoom
  const maxPan = Math.max(0, SIZE - VIEW)
  const clampPan = (v: number) => Math.min(maxPan, Math.max(0, v))
  const viewBox = `${clampPan(pan.x)} ${clampPan(pan.y)} ${VIEW} ${VIEW}`
  // Anything drawn in viewBox units shrinks as we zoom in; divide by zoom to
  // keep it visually constant.
  const k = 1 / zoom

  function zoomAt(factor: number, cx?: number, cy?: number) {
    setZoom(prevZoom => {
      const next = Math.min(MAX_ZOOM, Math.max(1, prevZoom * factor))
      if (next === prevZoom) return prevZoom
      // Keep the point under the cursor fixed while the window shrinks.
      const px0 = cx ?? SIZE / 2, py0 = cy ?? SIZE / 2
      setPan(prevPan => {
        const oldView = SIZE / prevZoom, newView = SIZE / next
        // Clamped against prevZoom, not the render's clampPan: the wheel
        // listener below keeps the zoomAt of the render that attached it.
        const oldLim = Math.max(0, SIZE - oldView)
        const wx = Math.min(oldLim, Math.max(0, prevPan.x)) + (px0 / SIZE) * oldView
        const wy = Math.min(oldLim, Math.max(0, prevPan.y)) + (py0 / SIZE) * oldView
        const nx = wx - (px0 / SIZE) * newView
        const ny = wy - (py0 / SIZE) * newView
        const lim = Math.max(0, SIZE - newView)
        return { x: Math.min(lim, Math.max(0, nx)), y: Math.min(lim, Math.max(0, ny)) }
      })
      return next
    })
  }

  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }) }

  // Wheel zoom needs a non-passive native listener: React registers onWheel
  // as a passive listener on the root, so preventDefault() there was ignored
  // and the whole page scrolled while the map zoomed.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const b = el.getBoundingClientRect()
      // The listener reads client pixels; the SVG box is square, so one
      // scale factor maps them onto the coordinate space.
      const scale = b.width > 0 ? SIZE / b.width : 1
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - b.left) * scale, (e.clientY - b.top) * scale)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasMap])

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    // Left button only, and never start a drag from a dot: the dot's own
    // click must still select it. This guard is the whole point --
    // setPointerCapture retargets every later pointer event to the <svg>, so
    // a capture started on a dot makes the browser fire the click on the svg
    // and the dot's onClick never runs.
    if (e.button !== 0) return
    if ((e.target as Element).hasAttribute?.('data-dot')) return
    dragFrom.current = { x: e.clientX, y: e.clientY }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const from = dragFrom.current
    if (!from) return
    const box = e.currentTarget.getBoundingClientRect()
    const scale = box.width > 0 ? SIZE / box.width : 1
    const dx = ((e.clientX - from.x) * scale) / zoom
    const dy = ((e.clientY - from.y) * scale) / zoom
    dragFrom.current = { x: e.clientX, y: e.clientY }
    setPan(prev => ({ x: clampPan(prev.x - dx), y: clampPan(prev.y - dy) }))
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    dragFrom.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return {
    zoom, pan, dragging, svgRef, viewBox, k, maxZoom: MAX_ZOOM,
    zoomAt, resetZoom, onPointerDown, onPointerMove, onPointerUp,
  }
}

export type MinimapViewport = ReturnType<typeof useMinimapViewport>
