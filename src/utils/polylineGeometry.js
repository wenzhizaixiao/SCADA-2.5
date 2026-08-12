import { clampNumber, finiteNumber, MAX_EDITOR_STAGE_SIZE } from './editorGeometry.js'

export const MAX_POLYLINE_NODE_POINTS = 10000
export const MAX_POLYLINE_SEGMENT_COUNT = MAX_POLYLINE_NODE_POINTS - 1
export const DEFAULT_POLYLINE_SEGMENT_COUNT = 4
const POLYLINE_LINE_STYLES = new Set(['solid', 'dashed', 'dotted'])

export function clampPolylineSegmentCount(value, fallback = DEFAULT_POLYLINE_SEGMENT_COUNT) {
  const fallbackNumber = Number(fallback)
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.trunc(fallbackNumber)
    : DEFAULT_POLYLINE_SEGMENT_COUNT
  const number = Number(value)
  return clampNumber(
    Number.isFinite(number) ? Math.trunc(number) : safeFallback,
    1,
    MAX_POLYLINE_SEGMENT_COUNT
  )
}

function finitePoint(point, fallback = { x: 0, y: 0 }) {
  return {
    x: finiteNumber(point?.x, fallback.x),
    y: finiteNumber(point?.y, fallback.y)
  }
}

function validPolylinePoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .slice(0, MAX_POLYLINE_NODE_POINTS)
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
}

export function createEvenlySpacedPolylinePoints(start, end, segmentCount = DEFAULT_POLYLINE_SEGMENT_COUNT) {
  const first = finitePoint(start)
  const last = finitePoint(end, first)
  const count = clampPolylineSegmentCount(segmentCount)
  return Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count
    return {
      x: first.x + (last.x - first.x) * progress,
      y: first.y + (last.y - first.y) * progress
    }
  })
}

export function resamplePolylinePoints(points, segmentCount = DEFAULT_POLYLINE_SEGMENT_COUNT) {
  const source = validPolylinePoints(points)
  if (!source.length) return []
  const count = clampPolylineSegmentCount(segmentCount)
  if (source.length === 1) return Array.from({ length: count + 1 }, () => ({ ...source[0] }))

  const cumulative = [0]
  for (let index = 1; index < source.length; index += 1) {
    const previous = source[index - 1]
    const current = source[index]
    cumulative.push(cumulative.at(-1) + Math.hypot(current.x - previous.x, current.y - previous.y))
  }
  const totalLength = cumulative.at(-1)
  if (totalLength <= Number.EPSILON) {
    return Array.from({ length: count + 1 }, () => ({ ...source[0] }))
  }

  const result = [{ ...source[0] }]
  let sourceIndex = 1
  for (let index = 1; index < count; index += 1) {
    const targetLength = totalLength * index / count
    while (sourceIndex < cumulative.length - 1 && cumulative[sourceIndex] < targetLength) sourceIndex += 1
    const segmentStartLength = cumulative[sourceIndex - 1]
    const segmentLength = cumulative[sourceIndex] - segmentStartLength
    const progress = segmentLength <= Number.EPSILON ? 0 : (targetLength - segmentStartLength) / segmentLength
    const startPoint = source[sourceIndex - 1]
    const endPoint = source[sourceIndex]
    result.push({
      x: startPoint.x + (endPoint.x - startPoint.x) * progress,
      y: startPoint.y + (endPoint.y - startPoint.y) * progress
    })
  }
  result.push({ ...source.at(-1) })
  return result
}

export function resamplePolylineNodePoints(node = {}, segmentCount = DEFAULT_POLYLINE_SEGMENT_COUNT) {
  const width = Math.max(.1, finiteNumber(node.w, 1))
  const height = Math.max(.1, finiteNumber(node.h, 1))
  return resamplePolylinePoints(polylineNormalizedPointsToLocal(node), segmentCount).map(point => ({
    x: clampNumber(point.x / width, 0, 1),
    y: clampNumber(point.y / height, 0, 1)
  }))
}

function polylineRotation(node) {
  return finiteNumber(node?.rotate, 0) * Math.PI / 180
}

export function polylineNormalizedPointsToLocal(node = {}) {
  const width = Math.max(.1, finiteNumber(node.w, 1))
  const height = Math.max(.1, finiteNumber(node.h, 1))
  return validPolylinePoints(node.polylinePoints).map(point => ({
    x: clampNumber(point.x, 0, 1) * width,
    y: clampNumber(point.y, 0, 1) * height
  }))
}

function polylineHandleCoordinate(value) {
  return Math.round(finiteNumber(value, 0) * 1000) / 1000
}

export function polylinePointHandlePaths(node = {}) {
  const points = polylineNormalizedPointsToLocal(node)
  let all = ''
  let endpoints = ''
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const command = `M${polylineHandleCoordinate(point.x)} ${polylineHandleCoordinate(point.y)}l.001 0`
    all += command
    if (index === 0 || index === points.length - 1) endpoints += command
  }
  return { all, endpoints }
}

export function nearestPolylinePointIndex(node = {}, localPoint = {}, maxDistance = Number.POSITIVE_INFINITY) {
  const points = polylineNormalizedPointsToLocal(node)
  if (!points.length) return -1
  const target = finitePoint(localPoint)
  const limit = Number(maxDistance)
  const maximumSquared = Number.isFinite(limit) && limit >= 0
    ? limit * limit
    : Number.POSITIVE_INFINITY
  let nearestIndex = -1
  let nearestSquared = maximumSquared
  for (let index = 0; index < points.length; index += 1) {
    const dx = points[index].x - target.x
    const dy = points[index].y - target.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared > nearestSquared) continue
    nearestSquared = distanceSquared
    nearestIndex = index
  }
  return nearestIndex
}

export function polylineLocalPointToWorld(node = {}, point = {}) {
  const width = Math.max(.1, finiteNumber(node.w, 1))
  const height = Math.max(.1, finiteNumber(node.h, 1))
  const centerX = finiteNumber(node.x, 0) + width / 2
  const centerY = finiteNumber(node.y, 0) + height / 2
  const local = finitePoint(point)
  const offsetX = local.x - width / 2
  const offsetY = local.y - height / 2
  const radians = polylineRotation(node)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    x: centerX + offsetX * cosine - offsetY * sine,
    y: centerY + offsetX * sine + offsetY * cosine
  }
}

export function worldPointToPolylineLocal(node = {}, point = {}) {
  const width = Math.max(.1, finiteNumber(node.w, 1))
  const height = Math.max(.1, finiteNumber(node.h, 1))
  const centerX = finiteNumber(node.x, 0) + width / 2
  const centerY = finiteNumber(node.y, 0) + height / 2
  const world = finitePoint(point, { x: centerX, y: centerY })
  const offsetX = world.x - centerX
  const offsetY = world.y - centerY
  const radians = polylineRotation(node)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    x: width / 2 + offsetX * cosine + offsetY * sine,
    y: height / 2 - offsetX * sine + offsetY * cosine
  }
}

export function reframePolylineNode(node = {}, localPoints, options = {}) {
  const source = validPolylinePoints(localPoints)
  if (source.length < 2) return null
  const pointIndex = Math.trunc(Number(options.pointIndex))
  if (Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < source.length) {
    let minOtherX = Number.POSITIVE_INFINITY
    let maxOtherX = Number.NEGATIVE_INFINITY
    let minOtherY = Number.POSITIVE_INFINITY
    let maxOtherY = Number.NEGATIVE_INFINITY
    for (let index = 0; index < source.length; index += 1) {
      if (index === pointIndex) continue
      minOtherX = Math.min(minOtherX, source[index].x)
      maxOtherX = Math.max(maxOtherX, source[index].x)
      minOtherY = Math.min(minOtherY, source[index].y)
      maxOtherY = Math.max(maxOtherY, source[index].y)
    }
    if (minOtherX !== Number.POSITIVE_INFINITY) {
      source[pointIndex].x = clampNumber(
        source[pointIndex].x,
        maxOtherX - MAX_EDITOR_STAGE_SIZE,
        minOtherX + MAX_EDITOR_STAGE_SIZE
      )
      source[pointIndex].y = clampNumber(
        source[pointIndex].y,
        maxOtherY - MAX_EDITOR_STAGE_SIZE,
        minOtherY + MAX_EDITOR_STAGE_SIZE
      )
    }
  }
  const lineWidth = polylineLineWidth(node)
  const hasMarker = node.polylineStartMarker === 'arrow' || node.polylineEndMarker === 'arrow'
  const defaultPadding = Math.max(8, lineWidth * 2 + (hasMarker ? 10 : 2))
  const padding = Math.max(0, finiteNumber(options.padding, defaultPadding))
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of source) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  const spanX = maxX - minX
  const spanY = maxY - minY
  const width = Math.max(1, Math.min(MAX_EDITOR_STAGE_SIZE, spanX + padding * 2))
  const height = Math.max(1, Math.min(MAX_EDITOR_STAGE_SIZE, spanY + padding * 2))
  const originX = minX - Math.max(0, width - spanX) / 2
  const originY = minY - Math.max(0, height - spanY) / 2
  const oldWidth = Math.max(.1, finiteNumber(node.w, 1))
  const oldHeight = Math.max(.1, finiteNumber(node.h, 1))
  const oldCenterX = finiteNumber(node.x, 0) + oldWidth / 2
  const oldCenterY = finiteNumber(node.y, 0) + oldHeight / 2
  const centerOffsetX = originX + width / 2 - oldWidth / 2
  const centerOffsetY = originY + height / 2 - oldHeight / 2
  const radians = polylineRotation(node)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centerX = oldCenterX + centerOffsetX * cosine - centerOffsetY * sine
  const centerY = oldCenterY + centerOffsetX * sine + centerOffsetY * cosine

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height,
    rotate: finiteNumber(node.rotate, 0),
    polylinePoints: source.map(point => ({
      x: clampNumber((point.x - originX) / width, 0, 1),
      y: clampNumber((point.y - originY) / height, 0, 1)
    }))
  }
}

export function resamplePolylineNodeGeometry(node = {}, segmentCount = DEFAULT_POLYLINE_SEGMENT_COUNT) {
  return reframePolylineNode(
    node,
    resamplePolylinePoints(polylineNormalizedPointsToLocal(node), segmentCount)
  )
}

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
