import { rotatedFrameBounds } from './editorGeometry.js'

const DEFAULT_CELL_SIZE = 512
const MAX_ITEM_CELLS = 256

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeBounds(value) {
  const x = finiteNumber(value?.x)
  const y = finiteNumber(value?.y)
  const width = finiteNumber(value?.w ?? value?.width)
  const height = finiteNumber(value?.h ?? value?.height)
  const left = Math.min(x, x + width)
  const top = Math.min(y, y + height)
  return {
    x: left,
    y: top,
    w: Math.max(0, Math.abs(width)),
    h: Math.max(0, Math.abs(height))
  }
}

function intersects(a, b) {
  return a.x + a.w >= b.x
    && a.x <= b.x + b.w
    && a.y + a.h >= b.y
    && a.y <= b.y + b.h
}

function equalBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

function cellRange(bounds, cellSize) {
  const minimumX = Math.floor(bounds.x / cellSize)
  const minimumY = Math.floor(bounds.y / cellSize)
  const maximumX = Math.floor((bounds.x + bounds.w) / cellSize)
  const maximumY = Math.floor((bounds.y + bounds.h) / cellSize)
  return {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    count: (maximumX - minimumX + 1) * (maximumY - minimumY + 1)
  }
}

function cellKey(x, y) {
  return `${x}:${y}`
}

/**
 * 创建用于画布节点的均匀网格索引。索引只保存对象引用和几何边界，
 * 样式、文字及运行时数据变化不会触发全图重建。
 */
export function createSpatialIndex(items = [], options = {}) {
  const cellSize = Math.max(32, finiteNumber(options.cellSize, DEFAULT_CELL_SIZE))
  const getBounds = typeof options.getBounds === 'function' ? options.getBounds : rotatedFrameBounds
  const entries = new Map()
  const buckets = new Map()
  const oversizedIds = new Set()
  const attachedIndexes = []
  let nextOrder = 0
  let overallBounds = null
  let overallBoundsDirty = false
  let translationX = 0
  let translationY = 0

  function localBounds(value) {
    const bounds = normalizeBounds(value)
    bounds.x -= translationX
    bounds.y -= translationY
    return bounds
  }

  function includeOverallBounds(bounds) {
    if (overallBoundsDirty) return
    if (!overallBounds) {
      overallBounds = { ...bounds }
      return
    }
    const right = Math.max(overallBounds.x + overallBounds.w, bounds.x + bounds.w)
    const bottom = Math.max(overallBounds.y + overallBounds.h, bounds.y + bounds.h)
    overallBounds.x = Math.min(overallBounds.x, bounds.x)
    overallBounds.y = Math.min(overallBounds.y, bounds.y)
    overallBounds.w = right - overallBounds.x
    overallBounds.h = bottom - overallBounds.y
  }

  function indexedBounds() {
    if (!overallBoundsDirty) return overallBounds
    overallBounds = null
    overallBoundsDirty = false
    for (const entry of entries.values()) includeOverallBounds(entry.bounds)
    return overallBounds
  }

  function detach(entry) {
    if (!entry) return
    if (entry.oversized) oversizedIds.delete(entry.id)
    for (const key of entry.keys) {
      const bucket = buckets.get(key)
      if (!bucket) continue
      bucket.ids.delete(entry.id)
      if (!bucket.ids.size) buckets.delete(key)
    }
  }

  function insert(item, order, preparedBounds = null) {
    const id = item?.id
    if (id == null || id === '') return false
    const bounds = preparedBounds || localBounds(getBounds(item))
    const range = cellRange(bounds, cellSize)
    const oversized = range.count > MAX_ITEM_CELLS
    const keys = []
    const entry = { id, item, bounds, keys, oversized, order }
    entries.set(id, entry)
    includeOverallBounds(bounds)

    // 超大背景组件单独存放，避免一个对象占据成百上千个网格桶。
    if (oversized) oversizedIds.add(id)
    else {
      for (let y = range.minimumY; y <= range.maximumY; y += 1) {
        for (let x = range.minimumX; x <= range.maximumX; x += 1) {
          const key = cellKey(x, y)
          let bucket = buckets.get(key)
          if (!bucket) {
            bucket = { x, y, ids: new Set() }
            buckets.set(key, bucket)
          }
          bucket.ids.add(id)
          keys.push(key)
        }
      }
    }
    return true
  }

  function removeLocal(id) {
    const entry = entries.get(id)
    if (!entry) return false
    detach(entry)
    entries.delete(id)
    overallBoundsDirty = true
    return true
  }

  function updateLocal(item) {
    const id = item?.id
    if (id == null || id === '') return false
    const previous = entries.get(id)
    const order = previous?.order ?? nextOrder++
    const bounds = localBounds(getBounds(item))
    if (previous && equalBounds(previous.bounds, bounds)) {
      previous.item = item
      return false
    }
    if (previous) {
      detach(previous)
      overallBoundsDirty = true
    }
    return insert(item, order, bounds)
  }

  function clearLocal() {
    entries.clear()
    buckets.clear()
    oversizedIds.clear()
    nextOrder = 0
    overallBounds = null
    overallBoundsDirty = false
  }

  function rebuild(nextItems = []) {
    clearLocal()
    attachedIndexes.length = 0
    translationX = 0
    translationY = 0
    for (const item of nextItems) updateLocal(item)
    return api
  }

  function createLocalQueryCursor(value, options = {}) {
    const bounds = localBounds(value)
    const range = cellRange(bounds, cellSize)
    const requestedLimit = Number(options.limit)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.floor(requestedLimit))
      : Number.POSITIVE_INFINITY
    const ids = new Set()
    const oversizedIterator = oversizedIds.values()
    const useBucketTraversal = range.count > Math.max(64, buckets.size * 2)
    let bucketIterator = null
    let idIterator = null
    let gridX = range.minimumX
    let gridY = range.minimumY
    let phase = 'oversized'
    let done = false
    let matchCount = 0
    let operationCount = 0

    function visit(id, onMatch) {
      if (ids.has(id)) return
      ids.add(id)
      const entry = entries.get(id)
      if (!entry || !intersects(entry.bounds, bounds)) return
      matchCount += 1
      onMatch?.(entry.item)
      if (matchCount >= limit) done = true
    }

    function advanceGrid() {
      if (gridY > range.maximumY) {
        done = true
        return
      }
      idIterator = buckets.get(cellKey(gridX, gridY))?.ids.values() || null
      gridX += 1
      if (gridX > range.maximumX) {
        gridX = range.minimumX
        gridY += 1
      }
    }

    function runOperation(onMatch) {
      if (idIterator) {
        const next = idIterator.next()
        if (next.done) idIterator = null
        else visit(next.value, onMatch)
        return
      }
      if (phase === 'oversized') {
        const next = oversizedIterator.next()
        if (!next.done) visit(next.value, onMatch)
        else {
          phase = useBucketTraversal ? 'buckets' : 'grid'
          if (useBucketTraversal) bucketIterator = buckets.values()
        }
        return
      }
      if (phase === 'buckets') {
        const next = bucketIterator.next()
        if (next.done) {
          done = true
          return
        }
        const bucket = next.value
        if (
          bucket.x >= range.minimumX
          && bucket.x <= range.maximumX
          && bucket.y >= range.minimumY
          && bucket.y <= range.maximumY
        ) idIterator = bucket.ids.values()
        return
      }
      advanceGrid()
    }

    function runSlice(sliceOptions = {}) {
      const requestedOperations = Number(sliceOptions.maxOperations)
      const maxOperations = Number.isFinite(requestedOperations) && requestedOperations > 0
        ? Math.max(1, Math.floor(requestedOperations))
        : 256
      const shouldYield = typeof sliceOptions.shouldYield === 'function'
        ? sliceOptions.shouldYield
        : () => false
      const onMatch = typeof sliceOptions.onMatch === 'function' ? sliceOptions.onMatch : null
      let operations = 0
      let yielded = false

      while (!done && operations < maxOperations) {
        runOperation(onMatch)
        operations += 1
        operationCount += 1
        if (shouldYield()) {
          yielded = true
          break
        }
      }
      return Object.freeze({ done, yielded, operations, matches: matchCount })
    }

    return Object.freeze({
      runSlice,
      get done() { return done },
      get matches() { return matchCount },
      get operations() { return operationCount }
    })
  }

  function queryLocal(value, options = {}) {
    const bounds = localBounds(value)
    const range = cellRange(bounds, cellSize)
    const requestedLimit = Number(options.limit)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.floor(requestedLimit))
      : Number.POSITIVE_INFINITY
    // Bucket traversal order is intentionally unrelated to insertion order. Only
    // unsorted callers may stop as soon as the bounded hot-path result is full.
    const traversalLimit = options.sort === false ? limit : Number.POSITIVE_INFINITY
    const ids = new Set()
    const matches = []
    const visit = id => {
      if (ids.has(id)) return false
      ids.add(id)
      const entry = entries.get(id)
      if (!entry || !intersects(entry.bounds, bounds)) return false
      matches.push(entry)
      return matches.length >= traversalLimit
    }

    for (const id of oversizedIds) {
      if (visit(id)) break
    }

    // 查询范围很大时只检查实际占用的桶，避免稀疏区域退化为全量实体扫描。
    if (matches.length < traversalLimit && range.count > Math.max(64, buckets.size * 2)) {
      const contentBounds = indexedBounds()
      if (!contentBounds || !intersects(contentBounds, bounds)) return []
      for (const bucket of buckets.values()) {
        if (bucket.x < range.minimumX || bucket.x > range.maximumX || bucket.y < range.minimumY || bucket.y > range.maximumY) continue
        let reachedLimit = false
        for (const id of bucket.ids) {
          if (visit(id)) {
            reachedLimit = true
            break
          }
        }
        if (reachedLimit) break
      }
    } else if (matches.length < traversalLimit) {
      let reachedLimit = false
      for (let y = range.minimumY; y <= range.maximumY; y += 1) {
        for (let x = range.minimumX; x <= range.maximumX; x += 1) {
          for (const id of buckets.get(cellKey(x, y))?.ids || []) {
            if (visit(id)) {
              reachedLimit = true
              break
            }
          }
          if (reachedLimit) break
        }
        if (reachedLimit) break
      }
    }

    if (options.sort !== false) matches.sort((a, b) => a.order - b.order)
    const boundedMatches = Number.isFinite(limit) ? matches.slice(0, limit) : matches
    return boundedMatches.map(entry => entry.item)
  }

  function has(id) {
    if (entries.has(id)) return true
    return attachedIndexes.some(index => index?.has?.(id))
  }

  function containsIndex(index) {
    return index === api || attachedIndexes.some(attached => attached?.containsIndex?.(index))
  }

  function pruneEmptyIndexes() {
    for (let index = attachedIndexes.length - 1; index >= 0; index -= 1) {
      if ((attachedIndexes[index]?.state?.entries || 0) === 0) attachedIndexes.splice(index, 1)
    }
  }

  function update(item) {
    const id = item?.id
    if (entries.has(id)) return updateLocal(item)
    for (const index of attachedIndexes) {
      if (index?.has?.(id)) return index.update(item)
    }
    return updateLocal(item)
  }

  function remove(id) {
    if (entries.has(id)) return removeLocal(id)
    for (const index of attachedIndexes) {
      if (!index?.has?.(id)) continue
      const removed = index.remove(id)
      pruneEmptyIndexes()
      return removed
    }
    return false
  }

  function clear() {
    clearLocal()
    attachedIndexes.length = 0
    translationX = 0
    translationY = 0
  }

  function attach(index) {
    if (!index || index === api || typeof index.query !== 'function' || typeof index.createQueryCursor !== 'function') {
      throw new TypeError('index must be a distinct spatial index')
    }
    if (containsIndex(index) || index.containsIndex?.(api)) throw new TypeError('spatial indexes cannot be attached twice or cyclically')
    if ((index.state?.entries || 0) === 0) return api
    attachedIndexes.push(index)
    return api
  }

  function setTranslation(x = 0, y = 0) {
    translationX = finiteNumber(x)
    translationY = finiteNumber(y)
    return api
  }

  function query(value, options = {}) {
    const requestedLimit = Number(options.limit)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.floor(requestedLimit))
      : Number.POSITIVE_INFINITY
    const result = []
    const seen = new Set()
    const append = item => {
      const id = item?.id
      if ((id == null || id === '') || seen.has(id)) return
      seen.add(id)
      result.push(item)
    }
    const sources = [api, ...attachedIndexes]
    for (const source of sources) {
      const remaining = Number.isFinite(limit) ? limit - result.length : limit
      if (remaining <= 0) break
      const matches = source === api
        ? queryLocal(value, { ...options, limit: remaining })
        : source.query(value, {
            ...options,
            limit: Number.isFinite(remaining) ? remaining + seen.size : remaining
          })
      for (const item of matches) append(item)
    }
    return result
  }

  function createQueryCursor(value, options = {}) {
    const requestedLimit = Number(options.limit)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.floor(requestedLimit))
      : Number.POSITIVE_INFINITY
    const cursorOptions = { ...options, limit: Number.POSITIVE_INFINITY }
    const cursors = [
      createLocalQueryCursor(value, cursorOptions),
      ...attachedIndexes.map(index => index.createQueryCursor(value, cursorOptions))
    ]
    const seen = new Set()
    let cursorIndex = 0
    let done = cursors.length === 0
    let matchCount = 0
    let operationCount = 0

    function runSlice(sliceOptions = {}) {
      const requestedOperations = Number(sliceOptions.maxOperations)
      const maxOperations = Number.isFinite(requestedOperations) && requestedOperations > 0
        ? Math.max(1, Math.floor(requestedOperations))
        : 256
      const shouldYield = typeof sliceOptions.shouldYield === 'function'
        ? sliceOptions.shouldYield
        : () => false
      const onMatch = typeof sliceOptions.onMatch === 'function' ? sliceOptions.onMatch : null
      let operations = 0
      let yielded = false

      while (!done && operations < maxOperations) {
        const cursor = cursors[cursorIndex]
        const result = cursor.runSlice({
          maxOperations: maxOperations - operations,
          shouldYield: () => matchCount >= limit || shouldYield(),
          onMatch(item) {
            const id = item?.id
            if (id == null || id === '' || seen.has(id) || matchCount >= limit) return
            seen.add(id)
            matchCount += 1
            onMatch?.(item)
          }
        })
        operations += result.operations
        operationCount += result.operations
        if (matchCount >= limit) {
          done = true
          break
        }
        if (cursor.done) cursorIndex += 1
        if (cursorIndex >= cursors.length) {
          done = true
          break
        }
        if (result.yielded || shouldYield()) {
          yielded = true
          break
        }
        if (result.operations === 0 && !cursor.done) {
          yielded = true
          break
        }
      }
      return Object.freeze({ done, yielded, operations, matches: matchCount })
    }

    return Object.freeze({
      runSlice,
      get done() { return done },
      get matches() { return matchCount },
      get operations() { return operationCount }
    })
  }

  const state = Object.freeze({
    get entries() {
      return entries.size + attachedIndexes.reduce((total, index) => total + (index?.state?.entries || 0), 0)
    },
    get segments() {
      return attachedIndexes.length + attachedIndexes.reduce((total, index) => total + (index?.state?.segments || 0), 0)
    },
    get translationX() { return translationX },
    get translationY() { return translationY }
  })

  const api = { rebuild, query, createQueryCursor, update, remove, clear, attach, has, containsIndex, setTranslation, state }
  return rebuild(items)
}
