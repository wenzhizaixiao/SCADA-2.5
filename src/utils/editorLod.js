export const EDITOR_LOD_NODE_THRESHOLD = 1200
export const EDITOR_LOD_MAX_ZOOM = 0.3
export const EDITOR_LOD_MAX_OVERLAY_NODES = 128
export const EDITOR_LOD_MAX_OVERLAY_EDGES = 512
export const EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS = 32
export const EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD = 96

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveFrame(value) {
  if (!value) return null
  const values = [value.x, value.y, value.w, value.h].map(Number)
  if (values.some(number => !Number.isFinite(number)) || values[2] <= 0 || values[3] <= 0) return null
  return { x: values[0], y: values[1], w: values[2], h: values[3] }
}

function frameIntersection(value, bounds) {
  const frame = positiveFrame(value)
  if (!frame || !bounds) return null
  const left = Math.max(frame.x, bounds.x)
  const top = Math.max(frame.y, bounds.y)
  const right = Math.min(frame.x + frame.w, bounds.x + bounds.w)
  const bottom = Math.min(frame.y + frame.h, bounds.y + bounds.h)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function framesTouchOrOverlap(a, b) {
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y
}

function mergeTouchingFrames(source) {
  const merged = []
  for (const region of source) {
    let current = region
    let index = 0
    while (index < merged.length) {
      const previous = merged[index]
      if (!framesTouchOrOverlap(current, previous)) {
        index += 1
        continue
      }
      const left = Math.min(current.x, previous.x)
      const top = Math.min(current.y, previous.y)
      const right = Math.max(current.x + current.w, previous.x + previous.w)
      const bottom = Math.max(current.y + current.h, previous.y + previous.h)
      current = { x: left, y: top, w: right - left, h: bottom - top }
      merged.splice(index, 1)
      index = 0
    }
    merged.push(current)
  }
  return merged.sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h)
}

function frameUnion(a, b) {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function appendMergedFrame(regions, frame) {
  let current = frame
  let index = 0
  while (index < regions.length) {
    if (!framesTouchOrOverlap(current, regions[index])) {
      index += 1
      continue
    }
    current = frameUnion(current, regions[index])
    regions.splice(index, 1)
    index = 0
  }
  regions.push(current)
}

// At the 32-region cap, numeric pair scores and row minima avoid rebuilding
// every possible merge candidate for each additional removed entity.
function pairMetrics(firstFrame, secondFrame) {
  const unionWidth = Math.max(firstFrame.x + firstFrame.w, secondFrame.x + secondFrame.w)
    - Math.min(firstFrame.x, secondFrame.x)
  const unionHeight = Math.max(firstFrame.y + firstFrame.h, secondFrame.y + secondFrame.h)
    - Math.min(firstFrame.y, secondFrame.y)
  const unionArea = unionWidth * unionHeight
  return {
    extraArea: unionArea - firstFrame.w * firstFrame.h - secondFrame.w * secondFrame.h,
    unionArea
  }
}

function pairScoreIsLower(extraArea, unionArea, first, second, selectedExtraArea, selectedUnionArea, selectedFirst, selectedSecond) {
  if (extraArea !== selectedExtraArea) return extraArea < selectedExtraArea
  if (unionArea !== selectedUnionArea) return unionArea < selectedUnionArea
  const orderedFirst = Math.min(first, second)
  const orderedSecond = Math.max(first, second)
  const selectedOrderedFirst = Math.min(selectedFirst, selectedSecond)
  return orderedFirst < selectedOrderedFirst
    || (orderedFirst === selectedOrderedFirst && orderedSecond < Math.max(selectedFirst, selectedSecond))
}

function removalPairScoreIndex(cache, first, second) {
  return cache.slots[first] * cache.size + cache.slots[second]
}

function writeRemovalPairScore(cache, regions, first, second) {
  const metrics = pairMetrics(regions[first], regions[second])
  const pairIndex = removalPairScoreIndex(cache, first, second)
  const reverseIndex = removalPairScoreIndex(cache, second, first)
  cache.extraAreas[pairIndex] = metrics.extraArea
  cache.extraAreas[reverseIndex] = metrics.extraArea
  cache.unionAreas[pairIndex] = metrics.unionArea
  cache.unionAreas[reverseIndex] = metrics.unionArea
}

function cachedRemovalPairIsLower(cache, first, second, selectedFirst, selectedSecond) {
  if (selectedFirst < 0 || selectedSecond < 0) return true
  const pairIndex = removalPairScoreIndex(cache, first, second)
  const selectedIndex = removalPairScoreIndex(cache, selectedFirst, selectedSecond)
  return pairScoreIsLower(
    cache.extraAreas[pairIndex],
    cache.unionAreas[pairIndex],
    first,
    second,
    cache.extraAreas[selectedIndex],
    cache.unionAreas[selectedIndex],
    selectedFirst,
    selectedSecond
  )
}

function recomputeRemovalRowBest(cache, row) {
  let partner = -1
  for (let candidate = 0; candidate < cache.size; candidate += 1) {
    if (candidate !== row && cachedRemovalPairIsLower(cache, row, candidate, row, partner)) partner = candidate
  }
  cache.rowBestPartners[row] = partner
}

function refreshRemovalGlobalBest(cache) {
  let bestFirst = -1
  let bestSecond = -1
  for (let row = 0; row < cache.size; row += 1) {
    const partner = cache.rowBestPartners[row]
    if (partner >= 0 && cachedRemovalPairIsLower(cache, row, partner, bestFirst, bestSecond)) {
      bestFirst = Math.min(row, partner)
      bestSecond = Math.max(row, partner)
    }
  }
  cache.bestFirst = bestFirst
  cache.bestSecond = bestSecond
}

function createRemovalPairCache(regions) {
  const size = regions.length
  const cache = {
    size,
    extraAreas: new Float64Array(size * size),
    unionAreas: new Float64Array(size * size),
    slots: Int16Array.from({ length: size }, (_, index) => index),
    rowBestPartners: new Int16Array(size),
    rowBestScratch: new Int16Array(size),
    bestFirst: -1,
    bestSecond: -1
  }
  cache.rowBestPartners.fill(-1)
  for (let first = 0; first < size - 1; first += 1) {
    for (let second = first + 1; second < size; second += 1) writeRemovalPairScore(cache, regions, first, second)
  }
  for (let row = 0; row < size; row += 1) recomputeRemovalRowBest(cache, row)
  refreshRemovalGlobalBest(cache)
  return cache
}

function updateRemovalPairCache(cache, regions, changedFirst, changedSecond = -1) {
  for (let other = 0; other < cache.size; other += 1) {
    if (other !== changedFirst) writeRemovalPairScore(cache, regions, changedFirst, other)
    if (changedSecond >= 0 && other !== changedSecond && other !== changedFirst) {
      writeRemovalPairScore(cache, regions, changedSecond, other)
    }
  }
  for (let row = 0; row < cache.size; row += 1) {
    const partner = cache.rowBestPartners[row]
    if (row === changedFirst || row === changedSecond || partner === changedFirst || partner === changedSecond) {
      recomputeRemovalRowBest(cache, row)
      continue
    }
    if (changedFirst !== row && cachedRemovalPairIsLower(cache, row, changedFirst, row, partner)) {
      cache.rowBestPartners[row] = changedFirst
    }
    const currentPartner = cache.rowBestPartners[row]
    if (changedSecond >= 0 && changedSecond !== row && cachedRemovalPairIsLower(cache, row, changedSecond, row, currentPartner)) {
      cache.rowBestPartners[row] = changedSecond
    }
  }
  refreshRemovalGlobalBest(cache)
}

function moveRemovalPairCacheEntryToEnd(cache, regions, index) {
  const last = cache.size - 1
  cache.rowBestScratch.set(cache.rowBestPartners)
  const movedSlot = cache.slots[index]
  cache.slots.copyWithin(index, index + 1)
  cache.slots[last] = movedSlot
  for (let other = 0; other < last; other += 1) writeRemovalPairScore(cache, regions, other, last)
  for (let row = 0; row < last; row += 1) {
    const oldRow = row < index ? row : row + 1
    const oldPartner = cache.rowBestScratch[oldRow]
    if (oldPartner < 0 || oldPartner === index) {
      recomputeRemovalRowBest(cache, row)
      continue
    }
    const mappedPartner = oldPartner < index ? oldPartner : oldPartner - 1
    cache.rowBestPartners[row] = cachedRemovalPairIsLower(cache, row, last, row, mappedPartner)
      ? last
      : mappedPartner
  }
  recomputeRemovalRowBest(cache, last)
  refreshRemovalGlobalBest(cache)
}

function selectRemovalPairWithIncoming(cache, regions, incoming) {
  let selectedFirst = cache.bestFirst
  let selectedSecond = cache.bestSecond
  const selectedIndex = selectedFirst >= 0 ? removalPairScoreIndex(cache, selectedFirst, selectedSecond) : -1
  let selectedExtraArea = selectedIndex >= 0 ? cache.extraAreas[selectedIndex] : Infinity
  let selectedUnionArea = selectedIndex >= 0 ? cache.unionAreas[selectedIndex] : Infinity
  const incomingIndex = regions.length
  for (let first = 0; first < regions.length; first += 1) {
    const metrics = pairMetrics(regions[first], incoming)
    if (!pairScoreIsLower(
      metrics.extraArea,
      metrics.unionArea,
      first,
      incomingIndex,
      selectedExtraArea,
      selectedUnionArea,
      selectedFirst,
      selectedSecond
    )) continue
    selectedFirst = first
    selectedSecond = incomingIndex
    selectedExtraArea = metrics.extraArea
    selectedUnionArea = metrics.unionArea
  }
  return { first: selectedFirst, second: selectedSecond }
}

function firstTouchingRegionIndex(frame, regions) {
  for (let index = 0; index < regions.length; index += 1) {
    if (framesTouchOrOverlap(frame, regions[index])) return index
  }
  return -1
}

function changedRemovalFramesTouch(regions, changedFirst, changedSecond = -1) {
  for (let other = 0; other < regions.length; other += 1) {
    if (other !== changedFirst && framesTouchOrOverlap(regions[changedFirst], regions[other])) return true
    if (changedSecond >= 0 && other !== changedSecond && framesTouchOrOverlap(regions[changedSecond], regions[other])) return true
  }
  return false
}

function paddedFrame(value, padding) {
  const frame = positiveFrame(value)
  if (!frame) return null
  return {
    x: frame.x - padding,
    y: frame.y - padding,
    w: frame.w + padding * 2,
    h: frame.h + padding * 2
  }
}

export function editorLodRemovalCoverRegions(options = {}) {
  const limit = Math.min(
    EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS,
    Math.max(1, Math.floor(finiteNumber(options.limit, EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)))
  )
  const padding = Math.max(0, finiteNumber(options.padding))
  const bounds = positiveFrame(options.bounds)
  const previous = Array.isArray(options.previous) ? options.previous : (options.previous ? [options.previous] : [])
  const frames = Array.isArray(options.frames) ? options.frames : (options.frames ? [options.frames] : [])
  let regions = []
  let pairCache = null

  const append = value => {
    const frame = bounds ? frameIntersection(value, bounds) : positiveFrame(value)
    if (!frame) return
    if (regions.length < limit) {
      appendMergedFrame(regions, frame)
      pairCache = null
      return
    }

    const touchingIndex = firstTouchingRegionIndex(frame, regions)
    if (touchingIndex >= 0) {
      const previous = regions[touchingIndex]
      const merged = frameUnion(previous, frame)
      regions.splice(touchingIndex, 1)
      regions.push(merged)
      const changedIndex = regions.length - 1
      if (changedRemovalFramesTouch(regions, changedIndex)) {
        regions.pop()
        appendMergedFrame(regions, merged)
        pairCache = null
      } else if (pairCache) {
        moveRemovalPairCacheEntryToEnd(pairCache, regions, touchingIndex)
      }
      return
    }

    pairCache ||= createRemovalPairCache(regions)
    const selected = selectRemovalPairWithIncoming(pairCache, regions, frame)
    let changedFirst = selected.first
    let changedSecond = -1
    if (selected.second === regions.length) {
      regions[changedFirst] = frameUnion(regions[changedFirst], frame)
    } else {
      changedSecond = selected.second
      regions[changedFirst] = frameUnion(regions[changedFirst], regions[changedSecond])
      regions[changedSecond] = frame
    }
    if (changedRemovalFramesTouch(regions, changedFirst, changedSecond)) {
      regions = mergeTouchingFrames(regions)
      pairCache = regions.length === limit ? createRemovalPairCache(regions) : null
    } else {
      updateRemovalPairCache(pairCache, regions, changedFirst, changedSecond)
    }
  }

  for (const frame of previous) append(frame)
  for (const frame of frames) append(paddedFrame(frame, padding))
  return regions.sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h)
}

function clippedFrames(source, detailBounds) {
  const values = Array.isArray(source) ? source : (source ? [source] : [])
  return values.map(value => frameIntersection(value, detailBounds)).filter(Boolean)
}

export function editorLodDetailFallbackRegions(options = {}) {
  const detailBounds = positiveFrame(options.detailBounds)
  if (!detailBounds) return []
  const regions = []
  if (options.geometryMode === 'canvas' && options.geometryCommitted === true && options.geometryFailed !== true) {
    regions.push(...clippedFrames(options.geometryCoverBounds, detailBounds))
  }
  if (options.removalFallbackCommitted === true && options.removalFailed !== true) {
    regions.push(...clippedFrames(options.removalCoverBounds, detailBounds))
  }
  return mergeTouchingFrames(regions)
}

export function editorLodDetailClipPath(options = {}) {
  const detailBounds = positiveFrame(options.detailBounds)
  const frameWidth = Number(options.frameWidth)
  const frameHeight = Number(options.frameHeight)
  if (!detailBounds || !Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0) return 'none'
  const regions = mergeTouchingFrames(clippedFrames(options.regions, detailBounds))
  if (!regions.length) return 'none'

  const scaleX = frameWidth / detailBounds.w
  const scaleY = frameHeight / detailBounds.h
  const point = (x, y) => `${x}px ${y}px`
  const points = [
    point(0, 0),
    point(frameWidth, 0),
    point(frameWidth, frameHeight),
    point(0, frameHeight),
    point(0, 0)
  ]
  for (const region of regions) {
    const left = Math.max(0, Math.min(frameWidth, Math.floor((region.x - detailBounds.x) * scaleX)))
    const top = Math.max(0, Math.min(frameHeight, Math.floor((region.y - detailBounds.y) * scaleY)))
    const right = Math.max(0, Math.min(frameWidth, Math.ceil((region.x + region.w - detailBounds.x) * scaleX)))
    const bottom = Math.max(0, Math.min(frameHeight, Math.ceil((region.y + region.h - detailBounds.y) * scaleY)))
    points.push(
      point(left, top),
      point(left, bottom),
      point(right, bottom),
      point(right, top),
      point(left, top),
      point(0, 0)
    )
  }
  // The outer frame and every inner rectangle use opposite winding directions.
  // Default nonzero filling therefore creates the same holes without requiring
  // the less widely supported `polygon(evenodd, ...)` grammar.
  return `polygon(${points.join(', ')})`
}

export function shouldUseEditorLodDetailFallback(options = {}) {
  return editorLodDetailFallbackRegions(options).length > 0
}

export function shouldHideEditorLodGeometryDom(options = {}) {
  const fallbackReliable = options.fallbackVisible !== false
    && options.fallbackMode === 'canvas'
    && options.fallbackCommitted === true
    && options.fallbackFailed !== true
  const detailReliable = options.detailVisible === true
    && options.detailPatchActive === true
    && options.detailCommitted === true
    && options.detailFailed !== true
  return fallbackReliable || detailReliable
}

export function shouldUseEditorLod(nodeCount, zoom) {
  return finiteNumber(nodeCount) >= EDITOR_LOD_NODE_THRESHOLD
    && finiteNumber(zoom, 1) <= EDITOR_LOD_MAX_ZOOM
}

export function shouldUseAnimatedFlowDirectionLod(nodes, threshold = EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD) {
  const limit = Math.max(1, Math.floor(finiteNumber(threshold, EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD)))
  let animatedCount = 0
  for (const node of nodes || []) {
    if (
      node?.type !== 'flowDirection'
      || node.animation !== 'flow'
      || node.animationPaused === true
      || finiteNumber(node.opacity, 1) <= 0
    ) continue
    animatedCount += 1
    if (animatedCount >= limit) return true
  }
  return false
}

export function editorLodOverlayNodeIds(options = {}) {
  const limit = Math.max(1, Math.floor(finiteNumber(options.limit, EDITOR_LOD_MAX_OVERLAY_NODES)))
  const result = new Set()
  const add = id => {
    if (id != null && id !== '' && result.size < limit) result.add(id)
  }
  add(options.primaryId)
  add(options.anchorId)
  add(options.connectFromId)
  add(options.editingTextId)
  add(options.editingFormId)

  const appendBounded = source => {
    const ids = Array.isArray(source) ? source : [...(source || [])]
    if (ids.length > limit - result.size) return
    for (const id of ids) add(id)
  }
  appendBounded(options.selectedIds)
  appendBounded(options.activeIds)
  return [...result]
}

export function editorLodOverlayEdges(options = {}) {
  const limit = Math.max(1, Math.floor(finiteNumber(options.limit, EDITOR_LOD_MAX_OVERLAY_EDGES)))
  const nodeIds = new Set(options.nodeIds || [])
  if (!nodeIds.size) return []
  const result = []
  const seen = new Set()
  const add = edge => {
    if (!edge?.id || seen.has(edge.id) || result.length >= limit) return
    seen.add(edge.id)
    result.push(edge)
  }
  const latest = options.latestEdge
  if (latest && (nodeIds.has(latest.from) || nodeIds.has(latest.to))) add(latest)
  for (const nodeId of nodeIds) {
    for (const edge of options.adjacency?.get?.(nodeId) || []) {
      add(edge)
      if (result.length >= limit) return result
    }
  }
  return result
}

export function pointHitsRotatedNode(node, point, padding = 0) {
  if (!node || !point) return false
  const width = Math.max(0.1, Math.abs(finiteNumber(node.w, 1)))
  const height = Math.max(0.1, Math.abs(finiteNumber(node.h, 1)))
  const centerX = finiteNumber(node.x) + width / 2
  const centerY = finiteNumber(node.y) + height / 2
  const radians = -finiteNumber(node.rotate) * Math.PI / 180
  const dx = finiteNumber(point.x) - centerX
  const dy = finiteNumber(point.y) - centerY
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  const tolerance = Math.max(0, finiteNumber(padding))
  return Math.abs(localX) <= width / 2 + tolerance
    && Math.abs(localY) <= height / 2 + tolerance
}

export function pickTopNodeAtPoint(candidates, point, padding = 0) {
  let match = null
  let matchLayer = Number.NEGATIVE_INFINITY
  for (const node of candidates || []) {
    if (!pointHitsRotatedNode(node, point, padding)) continue
    const layer = finiteNumber(node.layer)
    if (!match || layer >= matchLayer) {
      match = node
      matchLayer = layer
    }
  }
  return match
}

function pointSegmentDistance(point, start, end) {
  const x = finiteNumber(point?.x)
  const y = finiteNumber(point?.y)
  const startX = finiteNumber(start?.x)
  const startY = finiteNumber(start?.y)
  const dx = finiteNumber(end?.x) - startX
  const dy = finiteNumber(end?.y) - startY
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) return Math.hypot(x - startX, y - startY)
  const ratio = Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / lengthSquared))
  return Math.hypot(x - (startX + dx * ratio), y - (startY + dy * ratio))
}

function pointInPolygon(point, points) {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const currentPoint = points[index]
    const previousPoint = points[previous]
    const intersects = (finiteNumber(currentPoint.y) > finiteNumber(point.y)) !== (finiteNumber(previousPoint.y) > finiteNumber(point.y))
      && finiteNumber(point.x) < (finiteNumber(previousPoint.x) - finiteNumber(currentPoint.x))
        * (finiteNumber(point.y) - finiteNumber(currentPoint.y))
        / ((finiteNumber(previousPoint.y) - finiteNumber(currentPoint.y)) || Number.EPSILON)
        + finiteNumber(currentPoint.x)
    if (intersects) inside = !inside
  }
  return inside
}

export function pointHitsDrawing(drawing, point, padding = 0) {
  const points = Array.isArray(drawing?.points) ? drawing.points : []
  if (points.length < 2) return false
  if (drawing.closed && points.length > 2 && pointInPolygon(point, points)) return true
  const tolerance = Math.max(0, finiteNumber(padding)) + Math.max(0.5, finiteNumber(drawing.width, 2) / 2)
  for (let index = 1; index < points.length; index += 1) {
    if (pointSegmentDistance(point, points[index - 1], points[index]) <= tolerance) return true
  }
  return Boolean(drawing.closed && pointSegmentDistance(point, points.at(-1), points[0]) <= tolerance)
}

export function pickTopEditorEntity(nodeCandidates, drawings, point, padding = 0) {
  const node = pickTopNodeAtPoint(nodeCandidates, point, padding)
  let match = node ? { kind: 'node', entity: node } : null
  let matchLayer = node ? finiteNumber(node.layer) : Number.NEGATIVE_INFINITY
  for (const drawing of drawings || []) {
    const layer = finiteNumber(drawing?.layer)
    if (layer < matchLayer || !pointHitsDrawing(drawing, point, padding)) continue
    match = { kind: 'drawing', entity: drawing }
    matchLayer = layer
  }
  return match
}
