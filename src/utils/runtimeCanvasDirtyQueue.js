export const DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE = 512

function normalizedKey(value) {
  return String(value ?? '').trim()
}

function iteratorFor(value) {
  return value?.[Symbol.iterator]?.() || [][Symbol.iterator]()
}

export function createRuntimeCanvasDirtyQueue(options = {}) {
  const idsForKey = typeof options.idsForKey === 'function' ? options.idsForKey : () => []
  const nodeForId = typeof options.nodeForId === 'function' ? options.nodeForId : () => null
  const pendingKeys = new Set()
  let activeKey = null
  let full = false

  function clearPendingKeys() {
    pendingKeys.clear()
    activeKey = null
  }

  function clear() {
    full = false
    clearPendingKeys()
  }

  function queueFull() {
    clearPendingKeys()
    full = true
    return true
  }

  function queueKey(value) {
    const key = normalizedKey(value)
    if (!key) return queueFull()
    if (!full) pendingKeys.add(key)
    return true
  }

  function beginNextKey() {
    const next = pendingKeys.values().next()
    if (next.done) return false
    pendingKeys.delete(next.value)
    const sources = idsForKey(next.value)
    activeKey = {
      key: next.value,
      iterators: Array.from(sources || [], iteratorFor),
      iteratorIndex: 0,
      seenNodeIds: new Set()
    }
    return true
  }

  function nextNodeId() {
    while (activeKey) {
      const iterator = activeKey.iterators[activeKey.iteratorIndex]
      if (!iterator) {
        activeKey = null
        return null
      }
      const next = iterator.next()
      if (next.done) {
        activeKey.iteratorIndex += 1
        continue
      }
      return next.value
    }
    return null
  }

  function hasPending() {
    return full || Boolean(activeKey) || pendingKeys.size > 0
  }

  function takeBatch(limit = DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE) {
    if (full) {
      clear()
      return { full: true, nodes: [], dense: false, pending: false }
    }

    const maximum = Math.max(1, Math.floor(Number(limit) || DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE))
    const maximumScans = maximum * 4
    const nodes = []
    const batchNodeIds = new Set()
    let scans = 0

    while (nodes.length < maximum && scans < maximumScans) {
      if (!activeKey && !beginNextKey()) break
      const nodeId = nextNodeId()
      if (nodeId == null) continue
      scans += 1
      if (activeKey.seenNodeIds.has(nodeId)) continue
      activeKey.seenNodeIds.add(nodeId)
      if (batchNodeIds.has(nodeId)) continue
      const node = nodeForId(nodeId)
      if (!node) continue
      batchNodeIds.add(nodeId)
      nodes.push(node)
    }

    const pending = hasPending()
    // 只有填满一批且仍有后续工作时才开启稠密流，避免少量并列更新误触发全量重放。
    const dense = pending && nodes.length >= maximum
    return { full: false, nodes, dense, pending }
  }

  return Object.freeze({ clear, hasPending, queueFull, queueKey, takeBatch })
}
