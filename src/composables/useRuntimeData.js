import { shallowRef, triggerRef } from 'vue'
import {
  hasRuntimeUpdateGeneration,
  isSourceBindingRuntimeKey,
  normalizeRuntimeKey,
  runtimeUpdateGeneration
} from '../utils/runtimeKey.js'

export const DEFAULT_RUNTIME_FRAME_BUDGET_MS = 2
export const DEFAULT_RUNTIME_UPDATES_PER_FRAME = 16_384
export const DEFAULT_RUNTIME_SYNC_INGRESS_LIMIT = 256
export const DEFAULT_RUNTIME_LISTENER_QUANTUM = 64

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(() => callback(defaultNow()), 16)
}

function defaultCancel(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle)
    return
  }
  globalThis.clearTimeout(handle)
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)))
}

function normalizeKey(key) {
  return normalizeRuntimeKey(key)
}

function keyIterable(keys) {
  if (keys == null) return []
  return typeof keys === 'string' || isSourceBindingRuntimeKey(keys) ? [keys] : keys
}

function countKeys(keys) {
  const counts = new Map()
  for (const rawKey of keyIterable(keys)) {
    const key = normalizeKey(rawKey)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/**
 * Runtime values stay outside the document model. Only explicitly registered
 * document keys are accepted, and only mounted subscribers receive reactive
 * updates. Reactive work is coalesced and split across bounded frame slices.
 */
export function useRuntimeData(options = {}) {
  const injectedScheduler = options.scheduler
  const schedule = options.schedule || injectedScheduler?.schedule?.bind(injectedScheduler) || defaultSchedule
  const cancel = options.cancel || injectedScheduler?.cancel?.bind(injectedScheduler) || defaultCancel
  const now = options.now || injectedScheduler?.now?.bind(injectedScheduler) || defaultNow
  const frameBudgetMs = positiveNumber(options.frameBudgetMs, DEFAULT_RUNTIME_FRAME_BUDGET_MS)
  const maxUpdatesPerFrame = positiveInteger(options.maxUpdatesPerFrame, DEFAULT_RUNTIME_UPDATES_PER_FRAME)
  const syncIngressLimit = positiveInteger(options.syncIngressLimit, DEFAULT_RUNTIME_SYNC_INGRESS_LIMIT)
  const listenerQuantum = positiveInteger(options.listenerQuantum, DEFAULT_RUNTIME_LISTENER_QUANTUM)

  const values = new Map()
  const activeKeyCounts = new Map()
  const bindings = new Map()
  const listeners = new Map()
  const globalListeners = new Set()
  const legacyVersions = new Map()
  const updateGenerations = new Map()
  const pending = new Map()
  const forcedPendingKeys = new Set()
  const queuedTokens = new Map()
  const listenerCursors = new Map()
  let queue = []
  let queueIndex = 0
  let staleQueueEntries = 0
  const pendingIngressByKey = new Map()
  let priorityIngressQueue = []
  let priorityIngressIndex = 0
  let ingressQueue = []
  let ingressIndex = 0
  let nextIngressToken = 1
  const activationEpochByKey = new Map()
  let nextActivationEpoch = 1
  let nextQueueToken = 1
  let nextListenerSequence = 1
  let scheduled = false
  let scheduledHandle = null
  let scheduleGeneration = 0
  let flushing = false
  let activeReferenceCount = 0
  let bindingReferenceCount = 0
  let listenerReferenceCount = 0
  const emptyBinding = shallowRef(undefined)

  function bindingFor(key) {
    return bindings.get(key)
  }

  function hasReactiveSubscriber(key) {
    return bindings.has(key) || listeners.has(key) || legacyVersions.has(key)
  }

  function publishToListeners(key, value) {
    const handlers = listeners.get(key)
    if (handlers) {
      for (const handler of handlers.keys()) {
        try { handler(value) } catch (error) { options.onListenerError?.(error, key) }
      }
    }
  }

  function publishToGlobalListeners(key, value) {
    for (const handler of globalListeners) {
      try { handler(key, value) } catch (error) { options.onListenerError?.(error, key) }
    }
  }

  function resetQueue() {
    pending.clear()
    forcedPendingKeys.clear()
    queuedTokens.clear()
    listenerCursors.clear()
    queue = []
    queueIndex = 0
    staleQueueEntries = 0
    pendingIngressByKey.clear()
    priorityIngressQueue = []
    priorityIngressIndex = 0
    ingressQueue = []
    ingressIndex = 0
  }

  function compactQueue(force = false) {
    if (force && queueIndex < queue.length) {
      queue = queue.slice(queueIndex).filter(({ key, token }) => (
        queuedTokens.get(key) === token && (pending.has(key) || listenerCursors.has(key))
      ))
      queueIndex = 0
      staleQueueEntries = 0
      return
    }
    if (queueIndex === queue.length) {
      queue = []
      queueIndex = 0
      staleQueueEntries = 0
    } else if (queueIndex >= 1024 && queueIndex * 2 >= queue.length) {
      queue = queue.slice(queueIndex)
      queueIndex = 0
      staleQueueEntries = 0
    }
  }

  function discardPendingKey(key) {
    pending.delete(key)
    forcedPendingKeys.delete(key)
    listenerCursors.delete(key)
    if (queuedTokens.delete(key)) staleQueueEntries += 1
    const remaining = queue.length - queueIndex
    if (staleQueueEntries >= 256 && staleQueueEntries * 2 >= remaining) compactQueue(true)
  }

  function compactIngressQueues() {
    if (!pendingIngressByKey.size) {
      priorityIngressQueue = []
      priorityIngressIndex = 0
      ingressQueue = []
      ingressIndex = 0
      return
    }
    if (priorityIngressIndex === priorityIngressQueue.length) {
      priorityIngressQueue = []
      priorityIngressIndex = 0
    } else if (priorityIngressIndex >= 64 && priorityIngressIndex * 2 >= priorityIngressQueue.length) {
      priorityIngressQueue = priorityIngressQueue.slice(priorityIngressIndex)
      priorityIngressIndex = 0
    }
    if (ingressIndex === ingressQueue.length) {
      ingressQueue = []
      ingressIndex = 0
    } else if (ingressIndex >= 64 && ingressIndex * 2 >= ingressQueue.length) {
      ingressQueue = ingressQueue.slice(ingressIndex)
      ingressIndex = 0
    }
  }

  function cancelScheduledFlush() {
    scheduleGeneration += 1
    if (scheduled) cancel(scheduledHandle)
    scheduled = false
    scheduledHandle = null
  }

  function ensureScheduled() {
    if (scheduled || flushing || (pending.size === 0 && listenerCursors.size === 0 && pendingIngressByKey.size === 0)) return
    const generation = scheduleGeneration
    scheduled = true
    scheduledHandle = schedule(() => {
      if (generation !== scheduleGeneration) return
      scheduled = false
      scheduledHandle = null
      flush()
    })
  }

  function queueBindingUpdate(key, value, force = false) {
    if (!hasReactiveSubscriber(key)) return
    pending.set(key, value)
    if (force) forcedPendingKeys.add(key)
    else forcedPendingKeys.delete(key)
    if (!queuedTokens.has(key)) {
      const token = nextQueueToken++
      queuedTokens.set(key, token)
      queue.push({ key, token })
    }
    ensureScheduled()
  }

  function acceptItem(item) {
    const key = normalizeKey(item?.key)
    if (!key || !activeKeyCounts.has(key)) return false

    const value = item.value
    const changed = !values.has(key) || !Object.is(values.get(key), value)
    const hasGeneration = hasRuntimeUpdateGeneration(item)
    const generation = hasGeneration ? runtimeUpdateGeneration(item) : undefined
    const generationChanged = hasGeneration && (
      !updateGenerations.has(key) || !Object.is(updateGenerations.get(key), generation)
    )
    if (changed) values.set(key, value)
    if (hasGeneration) updateGenerations.set(key, generation)
    else if (changed) updateGenerations.delete(key)

    const entry = bindingFor(key)
    const bindingIsStale = entry && !Object.is(entry.binding.value, value)
    if (changed || bindingIsStale || generationChanged) {
      queueBindingUpdate(key, value, generationChanged && !changed && !bindingIsStale)
    }
    if (changed || generationChanged) publishToGlobalListeners(key, value)
    return true
  }

  function queueIngressItem(key, item, priority) {
    const epoch = activationEpochByKey.get(key)
    const existing = pendingIngressByKey.get(key)
    if (existing && existing.epoch === epoch) {
      existing.item = item
      if (priority && !existing.priority) {
        existing.priority = true
        existing.token = nextIngressToken++
        priorityIngressQueue.push({ key, token: existing.token })
      }
      return
    }

    const entry = {
      epoch,
      item,
      priority,
      token: nextIngressToken++
    }
    pendingIngressByKey.set(key, entry)
    const targetQueue = priority ? priorityIngressQueue : ingressQueue
    targetQueue.push({ key, token: entry.token })
  }

  function promotePendingIngress(key) {
    const entry = pendingIngressByKey.get(key)
    if (!entry || entry.priority || activationEpochByKey.get(key) !== entry.epoch) return false
    entry.priority = true
    entry.token = nextIngressToken++
    priorityIngressQueue.push({ key, token: entry.token })
    ensureScheduled()
    return true
  }

  function discardIngressKey(key) {
    pendingIngressByKey.delete(key)
  }

  function drainIngress(deadline, work, priority) {
    const targetQueue = priority ? priorityIngressQueue : ingressQueue
    let targetIndex = priority ? priorityIngressIndex : ingressIndex
    while (targetIndex < targetQueue.length && work.count < maxUpdatesPerFrame) {
      if (work.count > 0 && now() >= deadline) break
      const { key, token } = targetQueue[targetIndex++]
      work.count += 1
      const entry = pendingIngressByKey.get(key)
      if (
        !entry
        || entry.token !== token
        || entry.priority !== priority
      ) continue
      pendingIngressByKey.delete(key)
      if (!activeKeyCounts.has(key) || activationEpochByKey.get(key) !== entry.epoch) continue
      acceptItem(entry.item)
    }
    if (priority) priorityIngressIndex = targetIndex
    else ingressIndex = targetIndex
  }

  function canRunReactiveUnit(deadline, work) {
    return work.count === 0 || (work.count < maxUpdatesPerFrame && now() < deadline)
  }

  function createListenerCursor(key, value) {
    const handlers = listeners.get(key)
    if (!handlers?.size) return null
    return {
      value,
      iterator: handlers.entries(),
      maxSequence: nextListenerSequence - 1
    }
  }

  function drainListenerCursor(key, token, cursor, deadline, work) {
    let delivered = 0
    while (delivered < listenerQuantum && canRunReactiveUnit(deadline, work)) {
      const next = cursor.iterator.next()
      if (next.done) return true
      const [handler, sequence] = next.value
      if (sequence > cursor.maxSequence) return true

      const value = pending.has(key) ? pending.get(key) : cursor.value
      work.count += 1
      delivered += 1
      try { handler(value) } catch (error) { options.onListenerError?.(error, key) }

      if (queuedTokens.get(key) !== token || listenerCursors.get(key) !== cursor) return true
    }
    return false
  }

  function requeueReactiveKey(key, token) {
    if (queuedTokens.get(key) === token) queue.push({ key, token })
  }

  function drainReactiveUpdates(deadline, work) {
    let remainingTurns = queue.length - queueIndex
    while (remainingTurns > 0 && queueIndex < queue.length && work.count < maxUpdatesPerFrame) {
      if (work.count > 0 && now() >= deadline) break
      remainingTurns -= 1
      const { key, token } = queue[queueIndex++]
      if (queuedTokens.get(key) !== token) continue
      if (work.reactiveKeys.has(key)) {
        requeueReactiveKey(key, token)
        continue
      }
      work.reactiveKeys.add(key)

      let cursor = listenerCursors.get(key)
      if (!cursor) {
        if (!pending.has(key)) {
          queuedTokens.delete(key)
          continue
        }
        const value = pending.get(key)
        pending.delete(key)
        const force = forcedPendingKeys.delete(key)

        const entry = bindingFor(key)
        if (entry && !Object.is(entry.binding.value, value)) entry.binding.value = value
        else if (entry && force) triggerRef(entry.binding)

        const keyVersion = legacyVersions.get(key)
        if (keyVersion) keyVersion.value += 1

        cursor = createListenerCursor(key, value)
        if (cursor) listenerCursors.set(key, cursor)
      }

      if (cursor) {
        const countBeforeFanout = work.count
        const complete = drainListenerCursor(key, token, cursor, deadline, work)
        if (queuedTokens.get(key) !== token) continue
        if (complete && work.count === countBeforeFanout) work.count += 1
        if (!complete) {
          requeueReactiveKey(key, token)
          continue
        }
        if (listenerCursors.get(key) === cursor) listenerCursors.delete(key)
      } else {
        work.count += 1
      }

      if (pending.has(key)) requeueReactiveKey(key, token)
      else queuedTokens.delete(key)
    }
  }

  function flush() {
    const startedAt = now()
    const deadline = startedAt + frameBudgetMs
    const work = { count: 0, reactiveKeys: new Set() }
    flushing = true
    try {
      // Mounted views get first claim; accepted values then publish in the same frame when budget allows.
      drainIngress(deadline, work, true)
      drainReactiveUpdates(deadline, work)
      drainIngress(deadline, work, false)
      drainReactiveUpdates(deadline, work)
    } finally {
      compactQueue()
      compactIngressQueues()
      flushing = false
      ensureScheduled()
    }
  }

  function enqueue(batch) {
    if (batch == null) return 0
    const iterable = typeof batch?.[Symbol.iterator] === 'function' && typeof batch !== 'string' ? batch : [batch]
    const items = Array.isArray(iterable) ? iterable : [...iterable]
    if (items.length > syncIngressLimit) {
      let accepted = 0
      for (const item of items) {
        const key = normalizeKey(item?.key)
        if (!key || !activeKeyCounts.has(key)) continue
        accepted += 1
        queueIngressItem(key, item, hasReactiveSubscriber(key))
      }
      ensureScheduled()
      return accepted
    }
    let accepted = 0
    for (const item of items) {
      const key = normalizeKey(item?.key)
      if (!key || !activeKeyCounts.has(key)) continue
      discardIngressKey(key)
      if (acceptItem(item)) accepted += 1
    }
    compactIngressQueues()
    return accepted
  }

  function getValue(rawKey) {
    const key = normalizeKey(rawKey)
    return key ? values.get(key) : undefined
  }

  // Transitional compatibility for callers that still read values in a parent render.
  function getVersion(rawKey) {
    const key = normalizeKey(rawKey)
    if (!key) return 0
    let keyVersion = legacyVersions.get(key)
    if (!keyVersion) {
      keyVersion = shallowRef(0)
      legacyVersions.set(key, keyVersion)
    }
    promotePendingIngress(key)
    return keyVersion.value
  }

  function acquire(rawKey) {
    const key = normalizeKey(rawKey)
    if (!key) return emptyBinding

    let entry = bindingFor(key)
    if (!entry) {
      entry = { binding: shallowRef(values.get(key)), references: 0 }
      bindings.set(key, entry)
    } else {
      const value = values.get(key)
      if (!Object.is(entry.binding.value, value)) entry.binding.value = value
    }
    entry.references += 1
    bindingReferenceCount += 1
    promotePendingIngress(key)
    return entry.binding
  }

  function release(rawKey) {
    const key = normalizeKey(rawKey)
    const entry = key && bindingFor(key)
    if (!entry) return false

    entry.references -= 1
    bindingReferenceCount -= 1
    if (entry.references > 0) return false
    bindings.delete(key)
    if (!listeners.has(key) && !legacyVersions.has(key)) {
      discardPendingKey(key)
    }
    return true
  }

  function subscribe(rawKey, handler, { immediate = true } = {}) {
    const key = normalizeKey(rawKey)
    if (!key || typeof handler !== 'function') return () => {}
    let handlers = listeners.get(key)
    if (!handlers) {
      handlers = new Map()
      listeners.set(key, handlers)
    }
    if (!handlers.has(handler)) {
      handlers.set(handler, nextListenerSequence++)
      listenerReferenceCount += 1
    }
    promotePendingIngress(key)
    if (immediate) handler(values.get(key))
    return () => unsubscribe(key, handler)
  }

  function subscribeAll(handler) {
    if (typeof handler !== 'function') return () => false
    globalListeners.add(handler)
    return () => globalListeners.delete(handler)
  }

  function unsubscribe(rawKey, handler) {
    const key = normalizeKey(rawKey)
    const handlers = key && listeners.get(key)
    if (!handlers || !handlers.delete(handler)) return false
    listenerReferenceCount -= 1
    if (!handlers.size) {
      listeners.delete(key)
      if (!bindings.has(key) && !legacyVersions.has(key)) {
        discardPendingKey(key)
      }
    }
    return true
  }

  function registerKeys(keys) {
    let registered = 0
    for (const [key, count] of countKeys(keys)) {
      if (!activeKeyCounts.has(key)) activationEpochByKey.set(key, nextActivationEpoch++)
      activeKeyCounts.set(key, (activeKeyCounts.get(key) || 0) + count)
      registered += count
    }
    activeReferenceCount += registered
    return registered
  }

  function deactivateKey(key) {
    activeKeyCounts.delete(key)
    activationEpochByKey.delete(key)
    values.delete(key)
    updateGenerations.delete(key)
    discardIngressKey(key)
    discardPendingKey(key)
    queueBindingUpdate(key, undefined)
    publishToGlobalListeners(key, undefined)
  }

  function unregisterKeys(keys) {
    let unregistered = 0
    for (const [key, requestedCount] of countKeys(keys)) {
      const currentCount = activeKeyCounts.get(key) || 0
      const removedCount = Math.min(currentCount, requestedCount)
      if (!removedCount) continue
      unregistered += removedCount
      if (removedCount === currentCount) deactivateKey(key)
      else activeKeyCounts.set(key, currentCount - removedCount)
    }
    activeReferenceCount -= unregistered
    return unregistered
  }

  function setActiveKeys(keys) {
    const nextCounts = countKeys(keys)
    let nextReferenceCount = 0
    for (const key of activeKeyCounts.keys()) {
      if (!nextCounts.has(key)) deactivateKey(key)
    }
    for (const [key, count] of nextCounts) {
      if (!activeKeyCounts.has(key)) activationEpochByKey.set(key, nextActivationEpoch++)
      activeKeyCounts.set(key, count)
      nextReferenceCount += count
    }
    activeReferenceCount = nextReferenceCount
    return activeKeyCounts.size
  }

  function getActiveKeys() {
    return [...activeKeyCounts.keys()]
  }

  function hasActiveKey(rawKey) {
    const key = normalizeKey(rawKey)
    return Boolean(key && activeKeyCounts.has(key))
  }

  function stop() {
    cancelScheduledFlush()
    resetQueue()
  }

  function clear() {
    stop()
    values.clear()
    updateGenerations.clear()
    activeKeyCounts.clear()
    activationEpochByKey.clear()
    activeReferenceCount = 0
    for (const entry of bindings.values()) entry.binding.value = undefined
    for (const key of listeners.keys()) publishToListeners(key, undefined)
    publishToGlobalListeners('', undefined)
    for (const keyVersion of legacyVersions.values()) keyVersion.value += 1
    legacyVersions.clear()
  }

  function debugSnapshot() {
    return {
      activeKeys: activeKeyCounts.size,
      activeReferences: activeReferenceCount,
      bindings: bindings.size,
      bindingReferences: bindingReferenceCount,
      listenerKeys: listeners.size,
      listenerReferences: listenerReferenceCount,
      values: values.size,
      ingressPending: pendingIngressByKey.size,
      pending: pending.size,
      listenerFanoutPending: listenerCursors.size,
      queued: queuedTokens.size,
      scheduled
    }
  }

  const state = {}
  for (const property of Object.keys(debugSnapshot())) {
    Object.defineProperty(state, property, {
      enumerable: true,
      get: () => debugSnapshot()[property]
    })
  }

  registerKeys(options.activeKeys)

  return {
    enqueue,
    getValue,
    getVersion,
    acquire,
    release,
    subscribe,
    subscribeAll,
    unsubscribe,
    registerKeys,
    unregisterKeys,
    setActiveKeys,
    rebuild: setActiveKeys,
    getActiveKeys,
    hasActiveKey,
    clear,
    stop,
    state,
    debugSnapshot
  }
}
