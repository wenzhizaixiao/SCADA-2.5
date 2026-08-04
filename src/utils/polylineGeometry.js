import { clampNumber, finiteNumber } from './editorGeometry.js'

export const MAX_POLYLINE_NODE_POINTS = 10000
const POLYLINE_LINE_STYLES = new Set(['solid', 'dashed', 'dotted'])

export function polylineLineStyle(node = {}) {
  if (POLYLINE_LINE_STYLES.has(node.polylineStyle)) return node.polylineStyle
  return node.polylineDash || node.dash ? 'dashed' : 'solid'
}

export function polylineLineWidth(node = {}) {
  return clampNumber(finiteNumber(node.polylineWidth, node.width ?? 2), .1, 100)
}

export function polylineArrowSize(node = {}) {
  const explicit = Number(node.polylineArrowSize)
  if (Number.isFinite(explicit)) return clampNumber(explicit, 1, 100)
  return clampNumber((polylineLineWidth(node) + polylineOutlineWidth(node) * 2) * 4, 8, 60)
}

export function polylineLineOpacity(node = {}) {
  return clampNumber(finiteNumber(node.polylineOpacity, 1), 0, 1)
}

export function polylineOutlineWidth(node = {}) {
  if (node.borderVisible !== true) return 0
  return clampNumber(finiteNumber(node.borderWidth, 0), 0, 20)
}

export function polylineDashSegments(node = {}) {
  const style = polylineLineStyle(node)
  if (style === 'solid') return []
  const fallbackLength = style === 'dotted' ? 2 : 8
  return [
    clampNumber(finiteNumber(node.borderDashLength, fallbackLength), .1, 50),
    clampNumber(finiteNumber(node.borderDashGap, 6), .1, 50)
  ]
}

export function polylineDashArray(node = {}) {
  const segments = polylineDashSegments(node)
  return segments.length ? segments.join(' ') : 'none'
}

export function polylineStrokeLineCap(node = {}) {
  if (polylineLineStyle(node) === 'dotted') return 'round'
  return ['round', 'butt', 'square'].includes(node.polylineLineCap) ? node.polylineLineCap : 'round'
}

export function normalizeWorldPolylinePoints(points, stageWidth, stageHeight) {
  const width = Math.max(1, finiteNumber(stageWidth, 1))
  const height = Math.max(1, finiteNumber(stageHeight, 1))
  return (Array.isArray(points) ? points : [])
    .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .slice(0, MAX_POLYLINE_NODE_POINTS)
    .map(point => ({
      x: clampNumber(Number(point.x), 0, width),
      y: clampNumber(Number(point.y), 0, height)
    }))
}

export function polylineFrameFromWorldPoints(points, options = {}) {
  const stageWidth = Math.max(1, finiteNumber(options.stageWidth, 1))
  const stageHeight = Math.max(1, finiteNumber(options.stageHeight, 1))
  const source = normalizeWorldPolylinePoints(points, stageWidth, stageHeight)
  if (source.length < 2) return null

  const lineWidth = clampNumber(finiteNumber(options.lineWidth, 2), .1, 100)
  const hasMarker = options.startMarker === 'arrow' || options.endMarker === 'arrow'
  const padding = Math.max(8, lineWidth * 2 + (hasMarker ? 10 : 2))
  const minX = Math.min(...source.map(point => point.x))
  const minY = Math.min(...source.map(point => point.y))
  const maxX = Math.max(...source.map(point => point.x))
  const maxY = Math.max(...source.map(point => point.y))
  const x = Math.max(0, minX - padding)
  const y = Math.max(0, minY - padding)
  const right = Math.min(stageWidth, maxX + padding)
  const bottom = Math.min(stageHeight, maxY + padding)
  const w = Math.max(1, right - x)
  const h = Math.max(1, bottom - y)

  return {
    x,
    y,
    w,
    h,
    points: source.map(point => ({
      x: clampNumber((point.x - x) / w, 0, 1),
      y: clampNumber((point.y - y) / h, 0, 1)
    }))
  }
}
