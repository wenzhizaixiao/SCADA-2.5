const EMPTY_ITERABLE = Object.freeze([])

function finiteLayer(value) {
  const layer = Number(value)
  return Number.isFinite(layer) && layer > 0 ? layer : 0
}

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return number
}

function validId(value) {
  return value != null && value !== ''
}

/**
 * Preserves the imported stacking order while replacing sparse or extreme
 * layer values with the compact range 1..N. Invalid layers keep source order
 * after entities that have an explicit positive layer.
 */
export function compactEntityLayers(items = []) {
  const ordered = Array.from(items, (entity, index) => ({
    entity,
    index,
    layer: finiteLayer(entity?.layer)
  }))

  ordered.sort((left, right) => {
    if (left.layer && right.layer && left.layer !== right.layer) return left.layer < right.layer ? -1 : 1
    if (left.layer !== right.layer) return left.layer ? -1 : 1
    return left.index - right.index
  })
  ordered.forEach((entry, index) => { entry.entity.layer = index + 1 })
  return items
}

/**
 * Allocates monotonically increasing layer ranges without rescanning the document.
 * Rebuild starts a new full-document baseline. Reservations made within that
 * baseline are never rolled back.
 */
export function createLayerAllocator() {
  let committedMax = 0
  let reservedMax = 0

  const state = Object.freeze({
    get committedMax() { return committedMax },
    get reservedMax() { return reservedMax }
  })

  function rebuild(collections = []) {
    let nextCommittedMax = 0
    for (const collection of collections) {
      if (collection == null) continue
      for (const item of collection) nextCommittedMax = Math.max(nextCommittedMax, finiteLayer(item?.layer))
    }
    committedMax = nextCommittedMax
    reservedMax = committedMax
    return state
  }

  function reserve(count = 1) {
    const size = positiveInteger(count, 'count')
    const start = reservedMax + 1
    const end = reservedMax + size
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new RangeError('layer reservation exceeds the safe integer range')
    }
    reservedMax = end
    return Object.freeze({ start, end })
  }

  function commit(items = []) {
    let batchMax = 0
    for (const item of items) batchMax = Math.max(batchMax, finiteLayer(item?.layer))
    committedMax = Math.max(committedMax, batchMax)
    reservedMax = Math.max(reservedMax, committedMax)
    return state
  }

  function reconcile(maximum) {
    committedMax = finiteLayer(maximum)
    reservedMax = Math.max(reservedMax, committedMax)
    return state
  }

  return Object.freeze({ state, rebuild, reserve, commit, reconcile })
}

function normalizedDataKey(value) {
  return value == null ? '' : String(value).trim()
}

/**
 * Maintains the unique runtime data keys without rescanning the document.
 * Only rebuild reads a full node collection; all other mutations touch their
 * supplied node batch or node id and the affected key buckets.
 */
export function createDataKeyIndex() {
  const keyByNodeId = new Map()
  const nodeIdsByKey = new Map()

  const state = Object.freeze({
    get nodeCount() { return keyByNodeId.size },
    get keyCount() { return nodeIdsByKey.size }
  })

  function detach(nodeId, key) {
    keyByNodeId.delete(nodeId)
    const nodeIds = nodeIdsByKey.get(key)
    if (!nodeIds) return
    nodeIds.delete(nodeId)
    if (!nodeIds.size) nodeIdsByKey.delete(key)
  }

  function attach(nodeId, key) {
    let nodeIds = nodeIdsByKey.get(key)
    if (!nodeIds) {
      nodeIds = new Set()
      nodeIdsByKey.set(key, nodeIds)
    }
    nodeIds.add(nodeId)
    keyByNodeId.set(nodeId, key)
  }

  function update(nodeOrId, nextKey) {
    const nodeId = typeof nodeOrId === 'object' && nodeOrId != null ? nodeOrId.id : nodeOrId
    if (!validId(nodeId)) return false
    const key = normalizedDataKey(arguments.length > 1 ? nextKey : nodeOrId?.dataKey)
    const previousKey = keyByNodeId.get(nodeId)
    if (previousKey === key || (previousKey === undefined && !key)) return false

    if (previousKey !== undefined) detach(nodeId, previousKey)
    if (key) attach(nodeId, key)
    return true
  }

  function add(nodes = []) {
    let changed = 0
    for (const node of nodes) {
      if (update(node)) changed += 1
    }
    return changed
  }

  function remove(nodes = []) {
    let removed = 0
    for (const nodeOrId of nodes) {
      const nodeId = typeof nodeOrId === 'object' && nodeOrId != null ? nodeOrId.id : nodeOrId
      if (!validId(nodeId)) continue
      const key = keyByNodeId.get(nodeId)
      if (key === undefined) continue
      detach(nodeId, key)
      removed += 1
    }
    return removed
  }

  function rebuild(nodes = []) {
    keyByNodeId.clear()
    nodeIdsByKey.clear()
    add(nodes)
    return state
  }

  function keys() {
    return nodeIdsByKey.keys()
  }

  function has(key) {
    const normalizedKey = normalizedDataKey(key)
    return Boolean(normalizedKey) && nodeIdsByKey.has(normalizedKey)
  }

  function keyFor(nodeOrId) {
    const nodeId = typeof nodeOrId === 'object' && nodeOrId != null ? nodeOrId.id : nodeOrId
    return validId(nodeId) ? keyByNodeId.get(nodeId) : undefined
  }

  function countFor(key) {
    const normalizedKey = normalizedDataKey(key)
    return normalizedKey ? nodeIdsByKey.get(normalizedKey)?.size ?? 0 : 0
  }

  function idsFor(key) {
    const normalizedKey = normalizedDataKey(key)
    return normalizedKey ? nodeIdsByKey.get(normalizedKey)?.values() ?? EMPTY_ITERABLE : EMPTY_ITERABLE
  }

  return Object.freeze({ state, rebuild, add, remove, update, keys, has, keyFor, countFor, idsFor })
}

/**
 * Maintains edge adjacency incrementally. Existing edge collections are read only
 * by rebuild; add, remove, and applyChanges touch their supplied batch only.
 */
export function createEdgeAdjacencyIndex() {
  const edgesById = new Map()
  const edgesByNode = new Map()
  const attachedIndexes = []

  const state = {
    get edgeCount() {
      return edgesById.size + attachedIndexes.reduce((total, index) => total + (index?.state?.edgeCount || 0), 0)
    },
    get nodeCount() {
      if (!attachedIndexes.length) return edgesByNode.size
      const nodeIds = new Set(edgesByNode.keys())
      for (const index of attachedIndexes) {
        for (const nodeId of index?.nodeIds?.() || EMPTY_ITERABLE) nodeIds.add(nodeId)
      }
      return nodeIds.size
    }
  }
  Object.defineProperty(state, 'segments', {
    enumerable: false,
    get: () => attachedIndexes.length + attachedIndexes.reduce((total, index) => total + (index?.state?.segments || 0), 0)
  })
  Object.freeze(state)

  function bucket(nodeId) {
    let result = edgesByNode.get(nodeId)
    if (!result) {
      result = new Map()
      edgesByNode.set(nodeId, result)
    }
    return result
  }

  function detach(edge) {
    const endpoints = edge.from === edge.to ? [edge.from] : [edge.from, edge.to]
    for (const nodeId of endpoints) {
      const entries = edgesByNode.get(nodeId)
      if (!entries) continue
      entries.delete(edge.id)
      if (!entries.size) edgesByNode.delete(nodeId)
    }
  }

  function attachEdge(edge) {
    bucket(edge.from).set(edge.id, edge)
    if (edge.to !== edge.from) bucket(edge.to).set(edge.id, edge)
  }

  function addLocal(items = []) {
    let added = 0
    for (const candidate of items) {
      const edge = candidate?.value ?? candidate
      if (!validId(edge?.id) || !validId(edge?.from) || !validId(edge?.to)) continue
      const previous = edgesById.get(edge.id)
      if (previous) detach(previous)
      edgesById.set(edge.id, edge)
      attachEdge(edge)
      added += 1
    }
    return added
  }

  function removeLocal(items = []) {
    let removed = 0
    for (const candidate of items) {
      const id = typeof candidate === 'object' && candidate != null ? candidate.id : candidate
      if (!validId(id)) continue
      const edge = edgesById.get(id)
      if (!edge) continue
      detach(edge)
      edgesById.delete(id)
      removed += 1
    }
    return removed
  }

  function rebuild(items = []) {
    edgesById.clear()
    edgesByNode.clear()
    attachedIndexes.length = 0
    addLocal(items)
    return state
  }

  function has(edgeId) {
    if (edgesById.has(edgeId)) return true
    return attachedIndexes.some(index => index?.has?.(edgeId))
  }

  function containsIndex(index) {
    return index === api || attachedIndexes.some(attached => attached?.containsIndex?.(index))
  }

  function pruneEmptyIndexes() {
    for (let index = attachedIndexes.length - 1; index >= 0; index -= 1) {
      if ((attachedIndexes[index]?.state?.edgeCount || 0) === 0) attachedIndexes.splice(index, 1)
    }
  }

  function add(items = []) {
    if (!attachedIndexes.length) return addLocal(items)
    let added = 0
    for (const candidate of items) {
      const edge = candidate?.value ?? candidate
      if (!validId(edge?.id) || !validId(edge?.from) || !validId(edge?.to)) continue
      for (const index of attachedIndexes) {
        if (index?.has?.(edge.id)) index.remove([edge.id])
      }
      added += addLocal([edge])
    }
    pruneEmptyIndexes()
    return added
  }

  function remove(items = []) {
    let removed = removeLocal(items)
    for (const index of attachedIndexes) removed += index?.remove?.(items) || 0
    pruneEmptyIndexes()
    return removed
  }

  function applyChanges(removedItems = [], insertedItems = []) {
    return Object.freeze({
      removed: remove(removedItems),
      added: add(insertedItems)
    })
  }

  function *get(nodeId) {
    const seen = new Set()
    for (const edge of edgesByNode.get(nodeId)?.values() ?? EMPTY_ITERABLE) {
      if (seen.has(edge.id)) continue
      seen.add(edge.id)
      yield edge
    }
    for (const index of attachedIndexes) {
      for (const edge of index?.get?.(nodeId) || EMPTY_ITERABLE) {
        if (seen.has(edge.id)) continue
        seen.add(edge.id)
        yield edge
      }
    }
  }

  function countFor(nodeId) {
    let count = edgesByNode.get(nodeId)?.size || 0
    for (const index of attachedIndexes) count += index?.countFor?.(nodeId) || 0
    return count
  }

  function nodeIds() {
    const ids = new Set(edgesByNode.keys())
    for (const index of attachedIndexes) {
      for (const nodeId of index?.nodeIds?.() || EMPTY_ITERABLE) ids.add(nodeId)
    }
    return ids.values()
  }

  function attachIndex(index) {
    if (!index || index === api || typeof index.get !== 'function') throw new TypeError('index must be a distinct edge adjacency index')
    if (containsIndex(index) || index.containsIndex?.(api)) throw new TypeError('edge adjacency indexes cannot be attached twice or cyclically')
    if ((index.state?.edgeCount || 0) === 0) return state
    attachedIndexes.push(index)
    return state
  }

  const api = Object.freeze({ state, rebuild, add, remove, applyChanges, get, countFor, has, nodeIds, containsIndex, attach: attachIndex })
  return api
}
