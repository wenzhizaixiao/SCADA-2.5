import { edgeEndpointsForNodes } from './edgeGeometry.js'
import { rotatedFrameBounds } from './editorGeometry.js'

export const EDITOR_LOD_GEOMETRY_MAX_SEGMENT_LENGTH = 384
export const EDITOR_LOD_GEOMETRY_MAX_REGIONS = 192
export const EDITOR_LOD_GEOMETRY_MAX_SEGMENTS = 2048

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clippedBounds(bounds, options = {}) {
  const stageWidth = Math.max(1, finiteNumber(options.stageWidth, 1))
  const stageHeight = Math.max(1, finiteNumber(options.stageHeight, 1))
  const padding = Math.max(0, finiteNumber(options.padding))
  const left = Math.max(0, finiteNumber(bounds?.x) - padding)
  const top = Math.max(0, finiteNumber(bounds?.y) - padding)
  const right = Math.min(stageWidth, finiteNumber(bounds?.x) + Math.max(0, finiteNumber(bounds?.w)) + padding)
  const bottom = Math.min(stageHeight, finiteNumber(bounds?.y) + Math.max(0, finiteNumber(bounds?.h)) + padding)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function editorLodNodeRegion(node, options = {}) {
  if (!node) return null
  const padding = Math.max(12, finiteNumber(node.borderWidth) + 4, finiteNumber(options.padding, 16))
  return clippedBounds(rotatedFrameBounds(node), { ...options, padding })
}

export function editorLodSegmentRegions(start, end, options = {}) {
  const x1 = finiteNumber(start?.x)
  const y1 = finiteNumber(start?.y)
  const x2 = finiteNumber(end?.x)
  const y2 = finiteNumber(end?.y)
  const padding = Math.max(0, finiteNumber(options.padding, 16))
  const maxLength = Math.max(32, finiteNumber(options.maxSegmentLength, EDITOR_LOD_GEOMETRY_MAX_SEGMENT_LENGTH))
  const length = Math.hypot(x2 - x1, y2 - y1)
  const count = Math.max(1, Math.ceil(length / maxLength))
  const regions = []
  for (let index = 0; index < count; index += 1) {
    const startRatio = index / count
    const endRatio = (index + 1) / count
    const from = { x: x1 + (x2 - x1) * startRatio, y: y1 + (y2 - y1) * startRatio }
    const to = { x: x1 + (x2 - x1) * endRatio, y: y1 + (y2 - y1) * endRatio }
    const bounds = {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y)
    }
    const clipped = clippedBounds(bounds, { ...options, padding })
    if (clipped) regions.push(clipped)
  }
  return regions
}

export function editorLodEdgeRegions(edge, nodeIndex, options = {}) {
  const endpoints = edgeEndpointsForNodes(edge, nodeIndex)
  if (!endpoints) return []
  const padding = Math.max(14, finiteNumber(edge?.width, 1) / 2 + 12, finiteNumber(options.padding, 16))
  return editorLodSegmentRegions(endpoints.start, endpoints.end, { ...options, padding })
}

export function editorLodDrawingRegions(drawing, options = {}) {
  const points = Array.isArray(drawing?.points) ? drawing.points : []
  const maxSegments = Math.max(1, Math.floor(finiteNumber(options.maxSegments, EDITOR_LOD_GEOMETRY_MAX_SEGMENTS)))
  if (points.length < 2) return { regions: [], truncated: false }
  const segmentCount = points.length - 1 + (drawing.closed && points.length > 2 ? 1 : 0)
  if (segmentCount > maxSegments) return { regions: [], truncated: true }
  const padding = Math.max(12, finiteNumber(drawing?.width, 2) / 2 + 8, finiteNumber(options.padding, 16))
  if (drawing.closed && points.length > 2) {
    const xs = points.map(point => finiteNumber(point?.x))
    const ys = points.map(point => finiteNumber(point?.y))
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    }
    const region = clippedBounds(bounds, { ...options, padding })
    return { regions: region ? [region] : [], truncated: false }
  }
  const regions = []
  for (let index = 1; index < points.length; index += 1) {
    regions.push(...editorLodSegmentRegions(points[index - 1], points[index], { ...options, padding }))
    if (regions.length > maxSegments) return { regions: [], truncated: true }
  }
  return { regions, truncated: false }
}

export function mergeEditorLodGeometryRegions(source, options = {}) {
  const cellSize = Math.max(32, finiteNumber(options.cellSize, EDITOR_LOD_GEOMETRY_MAX_SEGMENT_LENGTH))
  const maxRegions = Math.max(1, Math.floor(finiteNumber(options.maxRegions, EDITOR_LOD_GEOMETRY_MAX_REGIONS)))
  const merged = new Map()
  for (const region of source || []) {
    if (!region) continue
    const key = `${Math.floor((region.x + region.w / 2) / cellSize)}:${Math.floor((region.y + region.h / 2) / cellSize)}`
    const previous = merged.get(key)
    if (!previous) {
      if (merged.size >= maxRegions) return { regions: [], truncated: true }
      merged.set(key, { ...region })
      continue
    }
    const right = Math.max(previous.x + previous.w, region.x + region.w)
    const bottom = Math.max(previous.y + previous.h, region.y + region.h)
    previous.x = Math.min(previous.x, region.x)
    previous.y = Math.min(previous.y, region.y)
    previous.w = right - previous.x
    previous.h = bottom - previous.y
  }
  return { regions: [...merged.values()], truncated: false }
}

export function editorLodGeometryRegions(options = {}) {
  const maxSegments = Math.max(1, Math.floor(finiteNumber(options.maxSegments, EDITOR_LOD_GEOMETRY_MAX_SEGMENTS)))
  const regions = []
  for (const node of options.nodes || []) {
    const region = editorLodNodeRegion(node, options)
    if (region) regions.push(region)
    if (regions.length > maxSegments) return { regions: [], truncated: true }
  }
  for (const edge of options.edges || []) {
    regions.push(...editorLodEdgeRegions(edge, options.nodeIndex, options))
    if (regions.length > maxSegments) return { regions: [], truncated: true }
  }
  for (const drawing of options.drawings || []) {
    const result = editorLodDrawingRegions(drawing, options)
    if (result.truncated) return { regions: [], truncated: true }
    regions.push(...result.regions)
    if (regions.length > maxSegments) return { regions: [], truncated: true }
  }
  return mergeEditorLodGeometryRegions(regions, options)
}

export function editorLodIndexSegments(kind, entity, nodeIndex, options = {}) {
  let regions = []
  if (kind === 'edge') regions = editorLodEdgeRegions(entity, nodeIndex, options)
  else if (kind === 'drawing') {
    const result = editorLodDrawingRegions(entity, options)
    if (result.truncated) return []
    regions = result.regions
  }
  return regions.map((bounds, index) => ({
    id: `${kind}:${entity.id}:${index}`,
    owner: entity,
    ownerId: entity.id,
    order: index,
    ...bounds
  }))
}
