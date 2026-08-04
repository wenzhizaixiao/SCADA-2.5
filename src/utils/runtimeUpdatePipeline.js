import {
  copyRuntimeUpdateGeneration,
  hasRuntimeUpdateGeneration,
  isSourceBindingRuntimeKey,
  normalizeRuntimeKey,
  runtimeKeyText,
  runtimeUpdateGeneration
} from './runtimeKey.js'

export const DEFAULT_RUNTIME_PIPELINE_BUDGET_MS = 2
export const DEFAULT_RUNTIME_PIPELINE_SYNC_ITEMS = 256
export const DEFAULT_RUNTIME_PIPELINE_SLICE_ITEMS = 2_048
export const DEFAULT_RUNTIME_PIPELINE_EMIT_ITEMS = 256
export const DEFAULT_RUNTIME_PIPELINE_MAX_BATCH_ITEMS = 65_536
export const DEFAULT_RUNTIME_PIPELINE_MAX_PENDING_ITEMS = 131_072
export const DEFAULT_RUNTIME_KEY_LENGTH = 1_024
export const DEFAULT_RUNTIME_STRING_VALUE_LENGTH = 1_048_576
export const DEFAULT_RUNTIME_BINARY_VALUE_BYTES = 4_194_304

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback)
  return globalThis.setTimeout(() => callback(defaultNow()), 16)
}

function defaultCancel(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') return globalThis.cancelAnimationFrame(handle)
  globalThis.clearTimeout(handle)
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)))
}

function limitsFrom(options = {}) {
  return {
    maxBatchItems: positiveInteger(options.maxBatchItems, DEFAULT_RUNTIME_PIPELINE_MAX_BATCH_ITEMS),
    maxKeyLength: positiveInteger(options.maxKeyLength, DEFAULT_RUNTIME_KEY_LENGTH),
    maxStringValueLength: positiveInteger(options.maxStringValueLength, DEFAULT_RUNTIME_STRING_VALUE_LENGTH),
    maxBinaryValueBytes: positiveInteger(options.maxBinaryValueBytes, DEFAULT_RUNTIME_BINARY_VALUE_BYTES)
  }
}

function batchLimitError(actual, limit) {
  return new RangeError(`runtime update batch contains ${actual} items; configured limit is ${limit}`)
}

function pendingLimitError(limit) {
  return new RangeError(`runtime update pipeline pending input exceeds configured limit ${limit}`)
}

function normalizeKey(rawKey, limits) {
  const keyText = runtimeKeyText(rawKey)
  if (keyText.length > limits.maxKeyLength) {
    throw new RangeError(`runtime update key exceeds ${limits.maxKeyLength} characters`)
  }
  return normalizeRuntimeKey(rawKey)
}

function validateValue(value, limits, key) {
  if (typeof value === 'string' && value.length > limits.maxStringValueLength) {
    throw new RangeError(`runtime value for "${key}" exceeds ${limits.maxStringValueLength} characters`)
  }
  const binaryBytes = typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer
    ? value.byteLength
    : typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView?.(value)
      ? value.byteLength
      : 0
  if (binaryBytes > limits.maxBinaryValueBytes) {
    throw new RangeError(`runtime value for "${key}" exceeds ${limits.maxBinaryValueBytes} binary bytes`)
  }
}

function normalizeEntry(entry, limits) {
  const key = normalizeKey(entry?.key, limits)
  if (!key) return null
  const value = entry?.value
  validateValue(value, limits, key)
  return copyRuntimeUpdateGeneration({ key, value }, entry)
}

function indexedSource(items, read = (source, index) => source[index]) {
  let index = 0
  return {
    knownLength: items.length,
    next() {
      if (index >= items.length) return { done: true, value: undefined }
      const value = read(items, index)
      index += 1
      return { done: false, value }
    }
  }
}

function payloadSource(payload, limits) {
  let values
  if (Array.isArray(payload)) values = payload
  else if (payload && typeof payload === 'object' && Array.isArray(payload.values)) values = payload.values
  if (values) {
    if (values.length > limits.maxBatchItems) throw batchLimitError(values.length, limits.maxBatchItems)
    return indexedSource(values)
  }
  if (payload && typeof payload === 'object' && 'key' in payload) return indexedSource([payload])
  if (payload && typeof payload === 'object') {
    const keys = Object.keys(payload)
    if (keys.length > limits.maxBatchItems) throw batchLimitError(keys.length, limits.maxBatchItems)
    return indexedSource(keys, (source, index) => {
      const key = source[index]
      return { key, value: payload[key] }
    })
  }
  return indexedSource([])
}

function generatedSource(keys, valueFactory, limits) {
  const iterable = typeof keys === 'string' || isSourceBindingRuntimeKey(keys) ? [keys] : keys || []
  if (Array.isArray(iterable)) {
    if (iterable.length > limits.maxBatchItems) throw batchLimitError(iterable.length, limits.maxBatchItems)
    return indexedSource(iterable, (source, index) => {
      const key = source[index]
      return { key, value: valueFactory(key) }
    })
  }
  const iterator = iterable?.[Symbol.iterator]?.()
  if (!iterator) return indexedSource([])
  return {
    // Only indexed sources have a trustworthy length. User-defined iterable
    // metadata must not bypass dynamic pending and batch accounting.
    knownLength: null,
    next() {
      const next = iterator.next()
      return next.done
        ? next
        : { done: false, value: { key: next.value, value: valueFactory(next.value) } }
    }
  }
}

function appendLatest(task, update) {
  const existingIndex = task.indexByKey.get(update.key)
  if (existingIndex == null) {
    task.indexByKey.set(update.key, task.updates.length)
    task.updates.push(update)
    return
  }
  task.updates[existingIndex] = update
}

export function normalizeRuntimeUpdates(payload, options = {}) {
  const limits = limitsFrom(options)
  const source = payloadSource(payload, limits)
  const task = { updates: [], indexByKey: new Map() }
  let inputCount = 0
  while (true) {
    const next = source.next()
    if (next.done) break
    inputCount += 1
    if (inputCount > limits.maxBatchItems) throw batchLimitError(inputCount, limits.maxBatchItems)
    const update = normalizeEntry(next.value, limits)
    if (update) appendLatest(task, update)
  }
  return task.updates
}

export function createRuntimeUpdatePipeline(options = {}) {
  const schedule = options.schedule || defaultSchedule
  const cancel = options.cancel || defaultCancel
  const now = options.now || defaultNow
  const budgetMs = positiveNumber(options.budgetMs, DEFAULT_RUNTIME_PIPELINE_BUDGET_MS)
  const syncItems = positiveInteger(options.syncItems, DEFAULT_RUNTIME_PIPELINE_SYNC_ITEMS)
  const sliceItems = positiveInteger(options.sliceItems, DEFAULT_RUNTIME_PIPELINE_SLICE_ITEMS)
  const emitItems = positiveInteger(options.emitItems, DEFAULT_RUNTIME_PIPELINE_EMIT_ITEMS)
  const maxPendingItems = positiveInteger(options.maxPendingItems, DEFAULT_RUNTIME_PIPELINE_MAX_PENDING_ITEMS)
  const limits = limitsFrom(options)
  const lastValues = new Map()
  const lastGenerations = new Map()
  const latestBatchByKey = new Map()
  const tasks = []
  let reservedItems = 0
  let taskCursor = 0
  let scheduled = false
  let scheduledHandle = null
  let generation = 0
  let nextBatchSequence = 1
  let nextRunSequence = 1

  function updateChanged(update) {
    if (!lastValues.has(update.key) || !Object.is(lastValues.get(update.key), update.value)) return true
    if (!hasRuntimeUpdateGeneration(update)) return false
    return !lastGenerations.has(update.key)
      || !Object.is(lastGenerations.get(update.key), runtimeUpdateGeneration(update))
  }

  function rememberUpdate(update) {
    lastValues.set(update.key, update.value)
    if (hasRuntimeUpdateGeneration(update)) {
      lastGenerations.set(update.key, runtimeUpdateGeneration(update))
    } else {
      lastGenerations.delete(update.key)
    }
  }

  function report(error, context = {}) {
    try { options.onError?.(error, context) } catch {}
  }

  function removeTask(task) {
    if (task.reserved) reservedItems -= task.reserved
    const index = tasks.indexOf(task)
    if (index < 0) return
    tasks.splice(index, 1)
    if (index < taskCursor) taskCursor -= 1
    if (!tasks.length || taskCursor >= tasks.length) taskCursor = 0
  }

  function finish(task) {
    removeTask(task)
    if (!tasks.length) latestBatchByKey.clear()
    task.resolve(task.result)
  }

  function fail(task, error) {
    removeTask(task)
    if (!tasks.length) latestBatchByKey.clear()
    report(error, { phase: task.phase, inputCount: task.inputCount })
    task.reject(error)
  }

  function currentChanges(task) {
    return task.chunk.filter(update => (
      latestBatchByKey.get(update.key) === task.sequence
      && updateChanged(update)
    ))
  }

  function flushChunk(task, runSequence) {
    if (!task.chunk.length) return true
    const changes = currentChanges(task)
    if (!changes.length) {
      task.chunk = []
      return true
    }
    try {
      options.onChanges?.(changes)
    } catch (error) {
      task.blockedRun = runSequence
      task.deliveryAttempts += 1
      report(error, {
        phase: 'emit',
        inputCount: task.inputCount,
        attempt: task.deliveryAttempts,
        batchSequence: task.sequence
      })
      return false
    }
    for (const update of changes) rememberUpdate(update)
    task.result.push(...changes)
    task.chunk = []
    task.deliveryAttempts = 0
    return true
  }

  function activateUpdate(task, update) {
    const latestSequence = latestBatchByKey.get(update.key)
    if (latestSequence == null || task.sequence > latestSequence) {
      latestBatchByKey.set(update.key, task.sequence)
    }
  }

  function reserveUnknownItem(task) {
    if (!task.dynamicReservation) return
    if (task.inputCount <= task.reserved) return
    if (reservedItems >= maxPendingItems) throw pendingLimitError(maxPendingItems)
    task.reserved += 1
    reservedItems += 1
  }

  function runUnit(task, runSequence) {
    if (task.phase === 'normalize') {
      const next = task.source.next()
      if (next.done) {
        task.phase = 'activate'
        return true
      }
      task.inputCount += 1
      if (task.inputCount > limits.maxBatchItems) throw batchLimitError(task.inputCount, limits.maxBatchItems)
      reserveUnknownItem(task)
      const update = normalizeEntry(next.value, limits)
      if (update) appendLatest(task, update)
      return true
    }
    if (task.phase === 'activate') {
      if (task.activateIndex < task.updates.length) {
        activateUpdate(task, task.updates[task.activateIndex++])
        if (task.activateIndex >= task.updates.length) task.phase = 'emit'
        return true
      }
      task.phase = 'emit'
      return true
    }
    if (task.chunk.length >= emitItems && !flushChunk(task, runSequence)) return true
    if (task.emitIndex < task.updates.length) {
      const update = task.updates[task.emitIndex++]
      if (latestBatchByKey.get(update.key) === task.sequence) task.chunk.push(update)
      if (task.chunk.length >= emitItems && !flushChunk(task, runSequence)) return true
    }
    if (task.emitIndex >= task.updates.length) {
      if (!flushChunk(task, runSequence)) return true
      finish(task)
    }
    return true
  }

  function nextRunnableTask(runSequence) {
    if (!tasks.length) return null
    let checked = 0
    while (checked < tasks.length) {
      if (taskCursor >= tasks.length) taskCursor = 0
      const index = taskCursor
      const task = tasks[index]
      taskCursor = (index + 1) % tasks.length
      checked += 1
      if (task.blockedRun !== runSequence) return task
    }
    return null
  }

  function ensureScheduled() {
    if (scheduled || !tasks.length) return
    const expectedGeneration = generation
    scheduled = true
    scheduledHandle = schedule(() => {
      if (expectedGeneration !== generation) return
      scheduled = false
      scheduledHandle = null
      const deadline = now() + budgetMs
      const runSequence = nextRunSequence++
      let work = 0
      while (tasks.length && work < sliceItems && (work === 0 || now() < deadline)) {
        const task = nextRunnableTask(runSequence)
        if (!task) break
        try {
          if (runUnit(task, runSequence)) work += 1
        } catch (error) {
          fail(task, error)
        }
      }
      ensureScheduled()
    })
  }

  function createTask(source, sequence, knownLength) {
    let resolve
    let reject
    const promise = new Promise((accept, decline) => {
      resolve = accept
      reject = decline
    })
    return {
      promise,
      source,
      sequence,
      phase: 'normalize',
      inputCount: 0,
      dynamicReservation: knownLength == null,
      reserved: knownLength == null ? 1 : knownLength,
      updates: [],
      indexByKey: new Map(),
      activateIndex: 0,
      emitIndex: 0,
      chunk: [],
      result: [],
      deliveryAttempts: 0,
      blockedRun: 0,
      resolve,
      reject
    }
  }

  function queueTask(task) {
    reservedItems += task.reserved
    tasks.push(task)
    ensureScheduled()
    return task.promise
  }

  function queueSource(source, sequence = nextBatchSequence++) {
    const knownLength = Number.isSafeInteger(source.knownLength) ? source.knownLength : null
    if (knownLength != null && knownLength > limits.maxBatchItems) throw batchLimitError(knownLength, limits.maxBatchItems)
    const initialReservation = knownLength == null ? 1 : knownLength
    if (reservedItems + initialReservation > maxPendingItems) {
      throw pendingLimitError(maxPendingItems)
    }
    return queueTask(createTask(source, sequence, knownLength))
  }

  function queueNormalized(updates, inputCount, sequence) {
    if (reservedItems + inputCount > maxPendingItems) throw pendingLimitError(maxPendingItems)
    const task = createTask(indexedSource([]), sequence, inputCount)
    task.phase = 'emit'
    task.inputCount = inputCount
    task.updates = updates
    task.activateIndex = updates.length
    task.emitIndex = updates.length
    task.chunk = updates.slice()
    for (const update of updates) activateUpdate(task, update)
    return queueTask(task)
  }

  function emitSynchronously(updates, inputCount, sequence) {
    for (const update of updates) activateUpdate({ sequence }, update)
    const changes = updates.filter(update => (
      latestBatchByKey.get(update.key) === sequence
      && updateChanged(update)
    ))
    if (!changes.length) {
      if (!tasks.length) latestBatchByKey.clear()
      return Promise.resolve([])
    }
    try {
      options.onChanges?.(changes)
    } catch (error) {
      report(error, { phase: 'emit', inputCount, attempt: 1, batchSequence: sequence })
      return queueNormalized(updates, inputCount, sequence)
    }
    for (const update of changes) rememberUpdate(update)
    if (!tasks.length) latestBatchByKey.clear()
    return Promise.resolve(changes)
  }

  function enqueue(payload) {
    const sequence = nextBatchSequence++
    const source = payloadSource(payload, limits)
    const knownLength = Number.isSafeInteger(source.knownLength) ? source.knownLength : null
    if (knownLength != null && knownLength > maxPendingItems) throw pendingLimitError(maxPendingItems)
    if (!tasks.length && knownLength != null && knownLength <= syncItems) {
      try {
        const updates = normalizeRuntimeUpdates(payload, limits)
        return emitSynchronously(updates, knownLength, sequence)
      } catch (error) {
        report(error, { phase: 'normalize-sync' })
        return Promise.reject(error)
      }
    }
    return queueSource(source, sequence)
  }

  function enqueueGenerated(keys, valueFactory) {
    return queueSource(generatedSource(keys, valueFactory, limits), nextBatchSequence++)
  }

  function publishSynchronously(updates = []) {
    const sequence = nextBatchSequence++
    for (const update of updates) activateUpdate({ sequence }, update)
    try {
      if (updates.length) options.onChanges?.(updates)
      for (const update of updates) rememberUpdate(update)
      return updates
    } finally {
      if (!tasks.length) latestBatchByKey.clear()
    }
  }

  function resetChanges() {
    lastValues.clear()
    lastGenerations.clear()
    if (!tasks.length) latestBatchByKey.clear()
  }

  function stop(reason = 'runtime update pipeline stopped') {
    generation += 1
    if (scheduled) cancel(scheduledHandle)
    scheduled = false
    scheduledHandle = null
    const stoppedTasks = tasks.splice(0)
    reservedItems = 0
    taskCursor = 0
    latestBatchByKey.clear()
    for (const task of stoppedTasks) task.resolve(task.result.slice())
    return Object.freeze({ reason: String(reason), stoppedBatches: stoppedTasks.length })
  }

  return {
    enqueue,
    enqueueGenerated,
    publishSynchronously,
    resetChanges,
    stop,
    get state() {
      return Object.freeze({ queuedBatches: tasks.length, reservedItems, scheduled, generation })
    }
  }
}
