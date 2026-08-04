import {
  evaluateJsonPath,
  sourceBindingDescriptor
} from '../utils/jsonPathBinding.js'
import { setRuntimeUpdateGeneration } from '../utils/runtimeKey.js'

const DEFAULT_FRAME_BUDGET_MS = 2
const MAX_OPERATIONS_PER_SLICE = 256
const DEFERRED_REBUILD_THRESHOLD = 1_024
const AVAILABLE_SNAPSHOT_QUALITIES = new Set(['', 'good'])

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback)
  return setTimeout(callback, 16)
}

function defaultCancel(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle)
  else clearTimeout(handle)
}

function safeText(value) {
  try {
    return String(value ?? '').trim()
  } catch {
    return ''
  }
}

function safeProperty(value, key) {
  try {
    return { ok: true, value: value?.[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

function ownProperty(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
  } catch {
    return false
  }
}

function snapshotRevisionIdentity(revision, sequence) {
  if (revision == null) return `auto:${sequence}`
  const type = typeof revision
  if (['string', 'number', 'bigint', 'boolean'].includes(type)) return `${type}:${String(revision)}`
  return `arrival:${sequence}`
}

function staleNumericRevision(previous, next) {
  if (typeof previous === 'number' && typeof next === 'number') return next < previous
  if (typeof previous === 'bigint' && typeof next === 'bigint') return next < previous
  return false
}

function normalizedBinding(binding) {
  if (!binding || typeof binding !== 'object' || binding.enabled === false) return null
  return sourceBindingDescriptor(binding)
}

function normalizedNodeBindings(node) {
  if (!node || typeof node !== 'object') return null
  const nodeId = safeText(safeProperty(node, 'id').value)
  if (!nodeId) return null
  const source = safeProperty(node, 'dataBindings')
  const bindings = []
  const runtimeKeys = new Set()
  if (source.ok && Array.isArray(source.value)) {
    for (const candidate of source.value) {
      const binding = normalizedBinding(candidate)
      if (!binding || runtimeKeys.has(binding.runtimeKey)) continue
      runtimeKeys.add(binding.runtimeKey)
      bindings.push(binding)
    }
  }
  return { nodeId, bindings }
}

function bindingListHas(bindings, runtimeKey) {
  for (const binding of bindings) if (binding.runtimeKey === runtimeKey) return true
  return false
}

/**
 * 把各数据源的内存快照按 sourceId + JSONPath 派生为运行时更新。
 * 节点只登记引用，协议采集和组件渲染仍通过各自网关解耦。
 */
export function createSourceBindingRuntime({
  onUpdates = () => {},
  schedule = defaultSchedule,
  cancel = defaultCancel,
  now = defaultNow,
  budgetMs = DEFAULT_FRAME_BUDGET_MS
} = {}) {
  if (typeof onUpdates !== 'function') throw new TypeError('onUpdates 必须是函数')
  if (typeof schedule !== 'function' || typeof cancel !== 'function' || typeof now !== 'function') {
    throw new TypeError('调度器配置无效')
  }

  const frameBudgetMs = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0
    ? Number(budgetMs)
    : DEFAULT_FRAME_BUDGET_MS
  let nodeBindings = new Map()
  let sourcePaths = new Map()
  const snapshots = new Map()
  const pendingQueue = []
  const queuedSources = new Set()
  const counters = {
    slices: 0,
    evaluations: 0,
    emittedUpdates: 0,
    errors: 0
  }
  let scheduledHandle = null
  let rebuildScheduledHandle = null
  let pendingRebuild = null
  let activeWork = null
  let snapshotSequence = 0
  let disposed = false

  function sourcePathCount() {
    let count = 0
    for (const paths of sourcePaths.values()) count += paths.size
    return count
  }

  function cancelScheduledWork() {
    if (scheduledHandle === null) return false
    try {
      cancel(scheduledHandle)
    } catch {
      counters.errors += 1
    }
    scheduledHandle = null
    return true
  }

  function cancelDeferredRebuild() {
    pendingRebuild = null
    if (rebuildScheduledHandle === null) return false
    try {
      cancel(rebuildScheduledHandle)
    } catch {
      counters.errors += 1
    }
    rebuildScheduledHandle = null
    return true
  }

  function hasPendingWork() {
    return Boolean(activeWork) || pendingQueue.length > 0
  }

  function ensureScheduled() {
    if (disposed || scheduledHandle !== null || !hasPendingWork()) return false
    try {
      scheduledHandle = schedule(() => {
        scheduledHandle = null
        drainSlice(false)
        ensureScheduled()
      })
      return true
    } catch {
      scheduledHandle = null
      counters.errors += 1
      return false
    }
  }

  function enqueueSource(sourceId) {
    if (disposed || !snapshots.has(sourceId) || !sourcePaths.get(sourceId)?.size) return false
    if (activeWork?.sourceId !== sourceId && !queuedSources.has(sourceId)) {
      queuedSources.add(sourceId)
      pendingQueue.push(sourceId)
    }
    ensureScheduled()
    return true
  }

  function addReference(binding, pathsIndex = sourcePaths) {
    let paths = pathsIndex.get(binding.sourceId)
    if (!paths) {
      paths = new Map()
      pathsIndex.set(binding.sourceId, paths)
    }
    const current = paths.get(binding.jsonPath)
    if (current) {
      current.refCount += 1
      return current
    }
    const entry = {
      ...binding,
      refCount: 1,
      lastRevisionKey: null
    }
    paths.set(binding.jsonPath, entry)
    return entry
  }

  function removeReference(binding, pathsIndex = sourcePaths) {
    const paths = pathsIndex.get(binding.sourceId)
    const entry = paths?.get(binding.jsonPath)
    if (!entry) return
    entry.refCount -= 1
    if (entry.refCount <= 0) paths.delete(binding.jsonPath)
    if (!paths.size) pathsIndex.delete(binding.sourceId)
  }

  function sameBindingSet(previous, next) {
    if (previous.length !== next.length) return false
    for (const binding of previous) {
      if (!bindingListHas(next, binding.runtimeKey)) return false
    }
    return true
  }

  function updateNodeIndexes(normalized, bindingsIndex = nodeBindings, pathsIndex = sourcePaths) {
    if (!normalized) return false
    const previous = bindingsIndex.get(normalized.nodeId) || []
    if (sameBindingSet(previous, normalized.bindings)) return false

    for (const binding of previous) {
      if (!bindingListHas(normalized.bindings, binding.runtimeKey)) removeReference(binding, pathsIndex)
    }
    const affectedSources = new Set()
    for (const binding of normalized.bindings) {
      if (bindingListHas(previous, binding.runtimeKey)) continue
      addReference(binding, pathsIndex)
      affectedSources.add(binding.sourceId)
    }

    if (normalized.bindings.length) bindingsIndex.set(normalized.nodeId, normalized.bindings)
    else bindingsIndex.delete(normalized.nodeId)
    return affectedSources
  }

  function updateNode(node) {
    if (disposed) return false
    const normalized = normalizedNodeBindings(node)
    if (pendingRebuild && normalized) {
      pendingRebuild.overriddenNodeIds.add(normalized.nodeId)
      updateNodeIndexes(normalized, pendingRebuild.nodeBindings, pendingRebuild.sourcePaths)
    }
    const affectedSources = updateNodeIndexes(normalized)
    if (affectedSources === false) return false
    if (!pendingRebuild) {
      for (const sourceId of affectedSources) enqueueSource(sourceId)
    }
    return true
  }

  function removeNodeFromIndexes(nodeId, bindingsIndex = nodeBindings, pathsIndex = sourcePaths) {
    const normalizedId = safeText(nodeId)
    const previous = bindingsIndex.get(normalizedId)
    if (!previous) return false
    for (const binding of previous) removeReference(binding, pathsIndex)
    bindingsIndex.delete(normalizedId)
    return true
  }

  function removeNode(nodeId) {
    if (disposed) return false
    const normalizedId = safeText(nodeId)
    let stagedRemoved = false
    if (pendingRebuild && normalizedId) {
      pendingRebuild.overriddenNodeIds.add(normalizedId)
      stagedRemoved = removeNodeFromIndexes(normalizedId, pendingRebuild.nodeBindings, pendingRebuild.sourcePaths)
    }
    return removeNodeFromIndexes(normalizedId) || stagedRemoved
  }

  function rebuild(nodes) {
    if (disposed) return false
    cancelDeferredRebuild()
    nodeBindings.clear()
    sourcePaths.clear()
    activeWork = null
    pendingQueue.length = 0
    queuedSources.clear()
    cancelScheduledWork()

    if (nodes && typeof nodes[Symbol.iterator] === 'function') {
      for (const node of nodes) {
        const normalized = normalizedNodeBindings(node)
        if (!normalized?.bindings.length) continue
        nodeBindings.set(normalized.nodeId, normalized.bindings)
        for (const binding of normalized.bindings) addReference(binding)
      }
    }
    for (const sourceId of sourcePaths.keys()) enqueueSource(sourceId)
    return true
  }

  function scheduleDeferredRebuild() {
    if (disposed || !pendingRebuild || rebuildScheduledHandle !== null) return false
    try {
      rebuildScheduledHandle = schedule(() => {
        rebuildScheduledHandle = null
        drainDeferredRebuildSlice()
        // 浏览器调度器异常时同步完成剩余索引，避免重建永久停在半完成状态。
        if (!scheduleDeferredRebuild() && pendingRebuild && !disposed) flushRebuild()
      })
      return true
    } catch {
      counters.errors += 1
      return false
    }
  }

  function drainDeferredRebuildSlice(force = false) {
    const rebuildState = pendingRebuild
    if (!rebuildState || disposed) return 0
    const startedAt = now()
    let operations = 0
    while (
      rebuildState.index < rebuildState.nodes.length
      && (force || operations === 0 || (
        operations < MAX_OPERATIONS_PER_SLICE
        && now() - startedAt < frameBudgetMs
      ))
    ) {
      const node = rebuildState.nodes[rebuildState.index++]
      operations += 1
      const nodeId = safeText(safeProperty(node, 'id').value)
      if (nodeId && rebuildState.overriddenNodeIds.has(nodeId)) continue
      const normalized = normalizedNodeBindings(node)
      if (!normalized?.bindings.length) continue
      updateNodeIndexes(normalized, rebuildState.nodeBindings, rebuildState.sourcePaths)
    }
    if (rebuildState.index < rebuildState.nodes.length || pendingRebuild !== rebuildState) return operations

    nodeBindings = rebuildState.nodeBindings
    sourcePaths = rebuildState.sourcePaths
    pendingRebuild = null
    for (const sourceId of sourcePaths.keys()) enqueueSource(sourceId)
    return operations
  }

  /** 大图换图时分片重建源索引；旧索引立即释放，快照在完成后自动重放。 */
  function rebuildDeferred(nodes) {
    if (disposed) return false
    const source = Array.isArray(nodes) ? nodes : [...(nodes || [])]
    if (source.length < DEFERRED_REBUILD_THRESHOLD) return rebuild(source)

    cancelDeferredRebuild()
    activeWork = null
    pendingQueue.length = 0
    queuedSources.clear()
    cancelScheduledWork()
    nodeBindings = new Map()
    sourcePaths = new Map()
    pendingRebuild = {
      nodes: source,
      index: 0,
      nodeBindings: new Map(),
      sourcePaths: new Map(),
      overriddenNodeIds: new Set()
    }
    if (!scheduleDeferredRebuild()) flushRebuild()
    return true
  }

  function flushRebuild() {
    if (disposed || !pendingRebuild) return 0
    if (rebuildScheduledHandle !== null) {
      try { cancel(rebuildScheduledHandle) } catch { counters.errors += 1 }
      rebuildScheduledHandle = null
    }
    let operations = 0
    while (pendingRebuild) operations += drainDeferredRebuildSlice(true)
    return operations
  }

  function replaySource(sourceId) {
    const normalizedSourceId = safeText(sourceId)
    const snapshot = snapshots.get(normalizedSourceId)
    const paths = sourcePaths.get(normalizedSourceId)
    if (!snapshot || !paths?.size) return false

    // 下游运行值可能因工作空间或视图生命周期被清空；同一快照无需重新接入，
    // 只重置派生游标并按现有帧预算再次发布。
    snapshot.generation = ++snapshotSequence
    for (const entry of paths.values()) entry.lastRevisionKey = null
    return enqueueSource(normalizedSourceId)
  }

  function ingest(snapshot, { replay = false } = {}) {
    if (disposed || !snapshot || typeof snapshot !== 'object') return false
    const sourceIdResult = safeProperty(snapshot, 'sourceId')
    const sourceId = sourceIdResult.ok ? safeText(sourceIdResult.value) : ''
    if (!sourceId) return false

    const revisionResult = safeProperty(snapshot, 'revision')
    if (!revisionResult.ok) return false
    const dataKey = ownProperty(snapshot, 'data') ? 'data' : (ownProperty(snapshot, 'value') ? 'value' : '')
    if (!dataKey) return false
    const dataResult = safeProperty(snapshot, dataKey)
    if (!dataResult.ok) return false
    const qualityResult = safeProperty(snapshot, 'quality')
    const quality = qualityResult.ok ? safeText(qualityResult.value).toLowerCase() : ''

    const sequence = ++snapshotSequence
    const revision = revisionResult.value
    const revisionKey = snapshotRevisionIdentity(revision, sequence)
    const previous = snapshots.get(sourceId)
    if (previous?.revisionKey === revisionKey || staleNumericRevision(previous?.revision, revision)) {
      return replay ? replaySource(sourceId) : false
    }

    snapshots.set(sourceId, {
      sourceId,
      revision,
      revisionKey,
      generation: sequence,
      available: AVAILABLE_SNAPSHOT_QUALITIES.has(quality),
      data: dataResult.value
    })
    enqueueSource(sourceId)
    return true
  }

  function createWork(sourceId) {
    const snapshot = snapshots.get(sourceId)
    const paths = sourcePaths.get(sourceId)
    if (!snapshot || !paths?.size) return null
    return {
      sourceId,
      generation: snapshot.generation,
      iterator: paths.values()
    }
  }

  function takeWork() {
    while (!activeWork && pendingQueue.length) {
      const sourceId = pendingQueue.shift()
      queuedSources.delete(sourceId)
      activeWork = createWork(sourceId)
    }
    return activeWork
  }

  function publish(updates) {
    if (!updates.length) return
    try {
      onUpdates(updates)
      counters.emittedUpdates += updates.length
    } catch {
      counters.errors += 1
    }
  }

  function drainSlice(force) {
    if (disposed || !hasPendingWork()) return 0
    const startedAt = now()
    const updates = []
    let operations = 0
    counters.slices += 1

    while (force || operations === 0 || (operations < MAX_OPERATIONS_PER_SLICE && now() - startedAt < frameBudgetMs)) {
      const work = takeWork()
      if (!work) break
      const snapshot = snapshots.get(work.sourceId)
      if (!snapshot || !sourcePaths.get(work.sourceId)?.size) {
        activeWork = null
        continue
      }
      if (snapshot.generation !== work.generation) {
        activeWork = createWork(work.sourceId)
        continue
      }

      const next = work.iterator.next()
      if (next.done) {
        activeWork = null
        continue
      }
      operations += 1
      const entry = next.value
      if (!entry || entry.refCount <= 0 || entry.lastRevisionKey === snapshot.revisionKey) continue
      // 非正常质量不沿用旧值；渲染层收到 undefined 后会回退到属性中的静态值。
      const value = snapshot.available
        ? evaluateJsonPath(snapshot.data, entry.compiled)
        : undefined
      entry.lastRevisionKey = snapshot.revisionKey
      counters.evaluations += 1
      updates.push(setRuntimeUpdateGeneration({ key: entry.runtimeKey, value }, snapshot.generation))
    }

    publish(updates)
    return updates.length
  }

  function flush() {
    if (disposed) return 0
    // flush 的契约是排空全部运行时工作，索引重建必须先于数据派生完成。
    flushRebuild()
    cancelScheduledWork()
    const before = counters.emittedUpdates
    while (hasPendingWork()) drainSlice(true)
    return counters.emittedUpdates - before
  }

  function reset({ keepBindings = false } = {}) {
    if (disposed) return false
    // 保留绑定时先提交正在构建的索引，否则取消任务会丢失尚未提交的绑定。
    if (keepBindings && pendingRebuild) flushRebuild()
    else cancelDeferredRebuild()
    cancelScheduledWork()
    activeWork = null
    pendingQueue.length = 0
    queuedSources.clear()
    snapshots.clear()
    for (const paths of sourcePaths.values()) {
      for (const entry of paths.values()) entry.lastRevisionKey = null
    }
    if (!keepBindings) {
      nodeBindings.clear()
      sourcePaths.clear()
    }
    counters.slices = 0
    counters.evaluations = 0
    counters.emittedUpdates = 0
    counters.errors = 0
    return true
  }

  function sourceIds() {
    return [...sourcePaths.keys()]
  }

  function dispose() {
    if (disposed) return false
    reset()
    disposed = true
    return true
  }

  return Object.freeze({
    rebuild,
    rebuildDeferred,
    flushRebuild,
    updateNode,
    removeNode,
    ingest,
    flush,
    reset,
    sourceIds,
    dispose,
    get state() {
      return {
        nodeCount: nodeBindings.size,
        sourceCount: sourcePaths.size,
        pathCount: sourcePathCount(),
        snapshotCount: snapshots.size,
        pendingSourceCount: queuedSources.size + (activeWork ? 1 : 0),
        scheduled: scheduledHandle !== null,
        disposed,
        slices: counters.slices,
        evaluations: counters.evaluations,
        emittedUpdates: counters.emittedUpdates,
        errors: counters.errors
      }
    }
  })
}
