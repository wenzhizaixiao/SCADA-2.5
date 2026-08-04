import { rotatedFrameBounds } from './editorGeometry.js'

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function runtimeNodeRegion(node, options = {}) {
  if (!node) return null
  const stageWidth = Math.max(1, finiteNumber(options.stageWidth, 1))
  const stageHeight = Math.max(1, finiteNumber(options.stageHeight, 1))
  const padding = Math.max(0, finiteNumber(options.padding, 2))
  const bounds = rotatedFrameBounds(node)
  const left = Math.max(0, finiteNumber(bounds.x) - padding)
  const top = Math.max(0, finiteNumber(bounds.y) - padding)
  const right = Math.min(stageWidth, finiteNumber(bounds.x) + Math.max(0, finiteNumber(bounds.w)) + padding)
  const bottom = Math.min(stageHeight, finiteNumber(bounds.y) + Math.max(0, finiteNumber(bounds.h)) + padding)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function createRuntimeRegionAccumulator(options = {}) {
  const regions = []
  const mergedRegions = new Map()
  const seenIds = new Set()
  const seenObjects = new Set()
  const mergeCellSize = Math.max(0, finiteNumber(options.mergeCellSize))

  function add(node) {
    if (!node || (node.id != null ? seenIds.has(node.id) : seenObjects.has(node))) return false
    if (node.id != null) seenIds.add(node.id)
    else seenObjects.add(node)
    const region = runtimeNodeRegion(node, options)
    if (!region) return false
    if (!mergeCellSize) {
      regions.push(region)
      return true
    }
    const key = `${Math.floor((region.x + region.w / 2) / mergeCellSize)}:${Math.floor((region.y + region.h / 2) / mergeCellSize)}`
    const previous = mergedRegions.get(key)
    if (!previous) {
      mergedRegions.set(key, region)
      return true
    }
    const right = Math.max(previous.x + previous.w, region.x + region.w)
    const bottom = Math.max(previous.y + previous.h, region.y + region.h)
    previous.x = Math.min(previous.x, region.x)
    previous.y = Math.min(previous.y, region.y)
    previous.w = right - previous.x
    previous.h = bottom - previous.y
    return true
  }

  function createCursor() {
    const iterator = mergeCellSize ? mergedRegions.values() : regions.values()
    let done = false
    let reads = 0
    return Object.freeze({
      next() {
        if (done) return { done: true, value: undefined }
        const result = iterator.next()
        done = result.done === true
        if (!done) reads += 1
        return result
      },
      get done() { return done },
      get reads() { return reads }
    })
  }

  function values() {
    return mergeCellSize ? [...mergedRegions.values()] : [...regions]
  }

  return Object.freeze({
    add,
    createCursor,
    values,
    get size() { return mergeCellSize ? mergedRegions.size : regions.length }
  })
}

export function createRuntimeQueryCursor(sources = []) {
  const entries = (Array.isArray(sources) ? sources : [])
    .filter(source => typeof source?.cursor?.runSlice === 'function')
  let sourceIndex = 0
  let operationCount = 0
  let matchCount = 0

  function runSlice(options = {}) {
    const parsedLimit = Number(options.maxOperations)
    const maxOperations = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.max(1, Math.floor(parsedLimit))
      : 256
    const shouldYield = typeof options.shouldYield === 'function' ? options.shouldYield : () => false
    const onMatch = typeof options.onMatch === 'function' ? options.onMatch : null
    let operations = 0
    let yielded = false

    while (sourceIndex < entries.length && operations < maxOperations) {
      const source = entries[sourceIndex]
      const result = source.cursor.runSlice({
        maxOperations: maxOperations - operations,
        shouldYield,
        onMatch(item) {
          matchCount += 1
          onMatch?.({ kind: source.kind, entity: item })
        }
      })
      operations += result.operations
      operationCount += result.operations
      if (result.done) sourceIndex += 1
      if (result.yielded) {
        yielded = true
        break
      }
      if (!result.done && result.operations === 0) break
    }

    return Object.freeze({
      done: sourceIndex >= entries.length,
      yielded,
      operations,
      matches: matchCount
    })
  }

  return Object.freeze({
    runSlice,
    get done() { return sourceIndex >= entries.length },
    get matches() { return matchCount },
    get operations() { return operationCount }
  })
}

export function createRuntimeCandidateCursor(queryCursor, options = {}) {
  if (typeof queryCursor?.runSlice !== 'function') {
    throw new TypeError('queryCursor.runSlice must be a function')
  }
  const include = typeof options.include === 'function' ? options.include : () => true
  const compare = typeof options.compare === 'function' ? options.compare : () => 0
  let items = []
  let sortBuffer = []
  let sortWidth = 1
  let sortStart = 0
  let sortMerge = null
  let phase = 'query'
  let operationCount = 0

  function beginSort() {
    if (items.length < 2) {
      phase = 'complete'
      return
    }
    sortBuffer = new Array(items.length)
    phase = 'sort'
  }

  function sortOperation() {
    while (phase === 'sort') {
      if (sortStart >= items.length) {
        const previousItems = items
        items = sortBuffer
        sortBuffer = previousItems
        sortWidth *= 2
        sortStart = 0
        sortMerge = null
        if (sortWidth >= items.length) {
          sortBuffer = []
          phase = 'complete'
          return false
        }
      }
      if (!sortMerge) {
        const left = sortStart
        const middle = Math.min(left + sortWidth, items.length)
        const right = Math.min(left + sortWidth * 2, items.length)
        sortMerge = { middle, right, first: left, second: middle, output: left }
      }

      const merge = sortMerge
      const takeFirst = merge.first < merge.middle && (
        merge.second >= merge.right || compare(items[merge.first], items[merge.second]) <= 0
      )
      sortBuffer[merge.output] = takeFirst ? items[merge.first++] : items[merge.second++]
      merge.output += 1
      if (merge.output >= merge.right) {
        sortStart += sortWidth * 2
        sortMerge = null
      }
      return true
    }
    return false
  }

  function runSlice(deadline, requestedOperationLimit = 4096) {
    const parsedLimit = Number(requestedOperationLimit)
    const operationLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.max(1, Math.floor(parsedLimit))
      : 4096
    const shouldYield = typeof deadline?.shouldYield === 'function'
      ? () => deadline.shouldYield()
      : () => false
    let operations = 0
    let yielded = false

    while (phase !== 'complete' && operations < operationLimit) {
      if (phase === 'query') {
        const result = queryCursor.runSlice({
          maxOperations: operationLimit - operations,
          shouldYield,
          onMatch(item) {
            if (include(item)) items.push(item)
          }
        })
        operations += result.operations
        operationCount += result.operations
        if (result.done) beginSort()
        if (result.yielded) {
          yielded = true
          break
        }
        if (!result.done && result.operations === 0) break
        continue
      }

      if (!sortOperation()) continue
      operations += 1
      operationCount += 1
      if (phase !== 'complete' && shouldYield()) {
        yielded = true
        break
      }
    }

    return Object.freeze({
      done: phase === 'complete',
      yielded,
      operations,
      phase
    })
  }

  return Object.freeze({
    runSlice,
    get done() { return phase === 'complete' },
    get phase() { return phase },
    get items() { return items },
    get operations() { return operationCount }
  })
}

export function runtimeBitmapRect(region, frame = {}, paddingPixels = 2) {
  if (!region) return null
  const bitmapWidth = Math.max(1, Math.floor(finiteNumber(frame.bitmapWidth, 1)))
  const bitmapHeight = Math.max(1, Math.floor(finiteNumber(frame.bitmapHeight, 1)))
  const pixelRatioX = Math.max(.0001, finiteNumber(frame.pixelRatioX, 1))
  const pixelRatioY = Math.max(.0001, finiteNumber(frame.pixelRatioY, 1))
  const scaleX = Math.max(.0001, finiteNumber(frame.scaleX, 1))
  const scaleY = Math.max(.0001, finiteNumber(frame.scaleY, 1))
  const offsetX = finiteNumber(frame.offsetX)
  const offsetY = finiteNumber(frame.offsetY)
  const padding = Math.max(0, Math.ceil(finiteNumber(paddingPixels, 2)))
  const left = Math.max(0, Math.floor((offsetX + finiteNumber(region.x) * scaleX) * pixelRatioX) - padding)
  const top = Math.max(0, Math.floor((offsetY + finiteNumber(region.y) * scaleY) * pixelRatioY) - padding)
  const right = Math.min(bitmapWidth, Math.ceil((offsetX + (finiteNumber(region.x) + Math.max(0, finiteNumber(region.w))) * scaleX) * pixelRatioX) + padding)
  const bottom = Math.min(bitmapHeight, Math.ceil((offsetY + (finiteNumber(region.y) + Math.max(0, finiteNumber(region.h))) * scaleY) * pixelRatioY) + padding)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function runtimeNodeBitmapRect(node, frame, options = {}) {
  const targetFrame = frame || {}
  const region = runtimeNodeRegion(node, {
    stageWidth: targetFrame.stageWidth,
    stageHeight: targetFrame.stageHeight,
    padding: options.regionPadding
  })
  return runtimeBitmapRect(region, targetFrame, options.bitmapPadding)
}
