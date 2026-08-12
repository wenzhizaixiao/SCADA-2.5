const DEFAULT_DATABASE_NAME = 'tc2d-workspace-sessions'
const DEFAULT_STORE_NAME = 'sessions'
const DATABASE_VERSION = 1
const CHUNK_FORMAT_VERSION = 1
const DEFAULT_CHUNK_SIZE = 64 * 1024
const DEFAULT_TIME_SLICE_MS = 4
const DEFAULT_CHECKPOINT_TASK_INTERVAL = 256
const MAX_STRING_SLICE_CHARS = 4 * 1024
const ROOT_SEGMENT = Symbol('workspace-session-root')

export const WORKSPACE_SESSION_CHUNK_FORMAT = 'tc2d-workspace-session-json-chunks'

class StaleWorkspaceSessionSaveError extends Error {
  constructor() {
    super('Workspace session save is stale')
    this.name = 'StaleWorkspaceSessionSaveError'
  }
}

class ClosedWorkspaceSessionStoreError extends Error {
  constructor() {
    super('Workspace session store is closed')
    this.name = 'ClosedWorkspaceSessionStoreError'
  }
}

class JsonCharacterLimitExceededError extends Error {
  constructor() {
    super('JSON character limit exceeded')
    this.name = 'JsonCharacterLimitExceededError'
  }
}

function positiveNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultIsInputPending() {
  try {
    return globalThis.navigator?.scheduling?.isInputPending?.({ includeContinuous: true }) === true
  } catch {
    return false
  }
}

function yieldToMainThread() {
  const scheduler = globalThis.scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise(resolve => setTimeout(resolve, 0))
}

function materializePath(parent, segment) {
  const path = [segment]
  for (let cursor = parent; cursor; cursor = cursor.parent) path.push(cursor.segment)
  path.reverse()
  return path
}

function pathNode(parent, segment) {
  return segment === ROOT_SEGMENT ? parent : { parent, segment }
}

function boxedPrimitive(value) {
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object Number]' || tag === '[object String]' || tag === '[object Boolean]' || tag === '[object BigInt]') {
    return value.valueOf()
  }
  return value
}

function prepareJsonValue(value, key, inArray, parentPath, customHandles, customHandlePaths, captureCustomHandles) {
  if (captureCustomHandles && key === 'customHandle' && value !== null && (typeof value === 'object' || typeof value === 'function')) {
    customHandles.push(value)
    customHandlePaths.push(materializePath(parentPath, key))
    return { omitted: false, value: null }
  }

  let prepared = value
  if (prepared !== null && typeof prepared === 'object' && typeof prepared.toJSON === 'function') {
    prepared = prepared.toJSON(key)
  }
  if (prepared !== null && typeof prepared === 'object') prepared = boxedPrimitive(prepared)

  const type = typeof prepared
  if (type === 'bigint') throw new TypeError('Workspace session snapshot contains a BigInt value')
  if (type === 'undefined' || type === 'function' || type === 'symbol') {
    return inArray ? { omitted: false, value: null } : { omitted: true, value: undefined }
  }
  if (type === 'number' && !Number.isFinite(prepared)) return { omitted: false, value: null }
  return { omitted: false, value: prepared }
}

/**
 * Serializes without cloning the complete object graph in one main-thread task.
 * Blob parts keep IndexedDB's subsequent structured clone proportional to the
 * small envelope rather than the drawing payload.
 */
export async function encodeWorkspaceSessionSnapshot(snapshot, options = {}) {
  const chunksAsText = options.chunksAsText === true
  const BlobConstructor = options.Blob || globalThis.Blob
  if (!chunksAsText && typeof BlobConstructor !== 'function') throw new Error('Blob is unavailable')

  const chunkSize = Math.max(1, Math.floor(positiveNumber(options.chunkSize, DEFAULT_CHUNK_SIZE)))
  const timeSliceMs = positiveNumber(options.timeSliceMs, DEFAULT_TIME_SLICE_MS)
  const checkpointTaskInterval = Math.max(1, Math.floor(positiveNumber(
    options.checkpointTaskInterval,
    DEFAULT_CHECKPOINT_TASK_INTERVAL
  )))
  const now = typeof options.now === 'function' ? options.now : defaultNow
  const isInputPending = typeof options.isInputPending === 'function' ? options.isInputPending : defaultIsInputPending
  const yieldControl = typeof options.yieldControl === 'function' ? options.yieldControl : yieldToMainThread
  const isFresh = typeof options.isFresh === 'function' ? options.isFresh : () => true
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false
  const configuredMaxCharacterLength = Number(options.maxCharacterLength)
  const maxCharacterLength = Number.isSafeInteger(configuredMaxCharacterLength) && configuredMaxCharacterLength >= 0
    ? configuredMaxCharacterLength
    : Number.POSITIVE_INFINITY
  const captureCustomHandles = options.captureCustomHandles !== false
  const stringSliceSize = Math.max(1, Math.min(MAX_STRING_SLICE_CHARS, chunkSize))
  const chunks = []
  const customHandles = []
  const customHandlePaths = []
  const activeObjects = new WeakSet()
  let buffer = ''
  let characterLength = 0
  let sliceStartedAt = now()
  let tasksUntilCheckpoint = 0

  function assertActive() {
    if (isCancelled()) throw new ClosedWorkspaceSessionStoreError()
    if (!isFresh()) throw new StaleWorkspaceSessionSaveError()
  }

  function flushChunk() {
    if (!buffer) return
    chunks.push(chunksAsText ? buffer : new BlobConstructor([buffer], { type: 'application/json' }))
    buffer = ''
  }

  function appendText(value) {
    if (characterLength + value.length > maxCharacterLength) {
      characterLength = maxCharacterLength + 1
      throw new JsonCharacterLimitExceededError()
    }
    let offset = 0
    characterLength += value.length
    while (offset < value.length) {
      const available = chunkSize - buffer.length
      const length = Math.min(available, value.length - offset)
      buffer += value.slice(offset, offset + length)
      offset += length
      if (buffer.length >= chunkSize) flushChunk()
    }
  }

  try {
  assertActive()
  const root = prepareJsonValue(snapshot, '', false, null, customHandles, customHandlePaths, captureCustomHandles)
  if (root.omitted) throw new TypeError('Workspace session snapshot is not JSON serializable')
  const tasks = [{ type: 'value', value: root.value, parentPath: null, segment: ROOT_SEGMENT }]

  while (tasks.length) {
    const task = tasks.pop()
    if (task.type === 'raw') {
      appendText(task.value)
    } else if (task.type === 'string') {
      if (!task.started) {
        appendText('"')
        task.started = true
      }
      if (task.offset < task.value.length) {
        const slice = task.value.slice(task.offset, task.offset + stringSliceSize)
        const escaped = JSON.stringify(slice)
        appendText(escaped.slice(1, -1))
        task.offset += slice.length
        tasks.push(task)
      } else {
        appendText('"')
      }
    } else if (task.type === 'array') {
      if (task.index >= task.value.length) {
        appendText(']')
        activeObjects.delete(task.value)
      } else {
        const index = task.index
        task.index += 1
        const prepared = prepareJsonValue(
          task.value[index],
          String(index),
          true,
          task.path,
          customHandles,
          customHandlePaths,
          captureCustomHandles
        )
        tasks.push(task)
        tasks.push({ type: 'value', value: prepared.value, parentPath: task.path, segment: index })
        if (index > 0) tasks.push({ type: 'raw', value: ',' })
      }
    } else if (task.type === 'object') {
      let prepared = null
      let key = ''
      while (task.index < task.keys.length && !prepared) {
        key = task.keys[task.index]
        task.index += 1
        const candidate = prepareJsonValue(
          task.value[key],
          key,
          false,
          task.path,
          customHandles,
          customHandlePaths,
          captureCustomHandles
        )
        if (!candidate.omitted) prepared = candidate
      }
      if (!prepared) {
        appendText('}')
        activeObjects.delete(task.value)
      } else {
        const hasPrevious = task.emitted
        task.emitted = true
        tasks.push(task)
        tasks.push({ type: 'value', value: prepared.value, parentPath: task.path, segment: key })
        tasks.push({ type: 'raw', value: ':' })
        tasks.push({ type: 'string', value: key, offset: 0, started: false })
        if (hasPrevious) tasks.push({ type: 'raw', value: ',' })
      }
    } else {
      const value = task.value
      if (value === null) {
        appendText('null')
      } else if (typeof value === 'string') {
        tasks.push({ type: 'string', value, offset: 0, started: false })
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        appendText(String(value))
      } else if (typeof value === 'object') {
        if (activeObjects.has(value)) throw new TypeError('Workspace session snapshot contains a circular reference')
        activeObjects.add(value)
        const currentPath = pathNode(task.parentPath, task.segment)
        if (Array.isArray(value)) {
          appendText('[')
          tasks.push({ type: 'array', value, index: 0, path: currentPath })
        } else {
          appendText('{')
          tasks.push({ type: 'object', value, keys: Object.keys(value), index: 0, emitted: false, path: currentPath })
        }
      } else {
        throw new TypeError(`Workspace session snapshot contains unsupported ${typeof value} data`)
      }
    }

    if (tasks.length && tasksUntilCheckpoint <= 0) {
      let pending = false
      try {
        pending = isInputPending() === true
      } catch {
        pending = false
      }
      if (pending || now() - sliceStartedAt >= timeSliceMs) {
        await yieldControl()
        assertActive()
        sliceStartedAt = now()
      }
      tasksUntilCheckpoint = checkpointTaskInterval
    }
    tasksUntilCheckpoint -= 1
  }

  assertActive()
  flushChunk()
  } catch (error) {
    if (!(error instanceof JsonCharacterLimitExceededError)) throw error
    buffer = ''
    chunks.length = 0
    return {
      __tc2dWorkspaceSessionFormat: WORKSPACE_SESSION_CHUNK_FORMAT,
      formatVersion: CHUNK_FORMAT_VERSION,
      chunks,
      characterLength,
      customHandles: [],
      customHandlePaths: [],
      tooLarge: true
    }
  }
  return {
    __tc2dWorkspaceSessionFormat: WORKSPACE_SESSION_CHUNK_FORMAT,
    formatVersion: CHUNK_FORMAT_VERSION,
    chunks,
    characterLength,
    customHandles,
    customHandlePaths,
    tooLarge: false
  }
}

export async function encodeBoundedJsonText(value, options = {}) {
  const maxCharacterLength = Number(options.maxCharacterLength)
  if (!Number.isSafeInteger(maxCharacterLength) || maxCharacterLength < 0) {
    throw new TypeError('maxCharacterLength must be a non-negative safe integer')
  }
  const record = await encodeWorkspaceSessionSnapshot(value, {
    ...options,
    maxCharacterLength,
    chunksAsText: true,
    captureCustomHandles: false
  })
  if (record.tooLarge) {
    return Object.freeze({ tooLarge: true, text: '', characterLength: record.characterLength })
  }
  return Object.freeze({
    tooLarge: false,
    text: record.chunks.join(''),
    characterLength: record.characterLength
  })
}

export function isChunkedWorkspaceSessionRecord(value) {
  return value !== null && typeof value === 'object' &&
    value.__tc2dWorkspaceSessionFormat === WORKSPACE_SESSION_CHUNK_FORMAT
}

export function createWorkspaceSessionRestoreSource(record, options = {}) {
  if (!isChunkedWorkspaceSessionRecord(record)) throw new TypeError('Workspace session record is not chunked')
  if (record.formatVersion !== CHUNK_FORMAT_VERSION) throw new Error('Workspace session chunk format is unsupported')
  if (!Array.isArray(record.chunks) || record.chunks.length === 0) {
    throw new Error('Workspace session chunks are missing')
  }
  const customHandles = record.customHandles || []
  const customHandlePaths = record.customHandlePaths || []
  if (!Array.isArray(customHandles) || !Array.isArray(customHandlePaths) || customHandles.length !== customHandlePaths.length) {
    throw new Error('Workspace session custom handle metadata is invalid')
  }
  const BlobConstructor = options.Blob || globalThis.Blob
  if (typeof BlobConstructor !== 'function') throw new Error('Blob is unavailable')
  return {
    serialized: new BlobConstructor(record.chunks, { type: 'application/json' }),
    customHandles,
    customHandlePaths
  }
}

async function chunkText(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) throw new Error('Workspace session chunks are missing')
  if (chunks.every(chunk => typeof chunk !== 'string') && typeof globalThis.Blob === 'function') {
    return new globalThis.Blob(chunks).text()
  }
  const parts = []
  for (const chunk of chunks) {
    if (typeof chunk === 'string') parts.push(chunk)
    else if (typeof chunk?.text === 'function') parts.push(await chunk.text())
    else throw new Error('Workspace session contains an invalid chunk')
  }
  return parts.join('')
}

function restoreCustomHandles(snapshot, handles, paths) {
  if (!Array.isArray(handles) || !Array.isArray(paths) || handles.length !== paths.length) {
    throw new Error('Workspace session custom handle metadata is invalid')
  }
  for (let index = 0; index < handles.length; index += 1) {
    const path = paths[index]
    if (!Array.isArray(path) || path.length === 0 || path[path.length - 1] !== 'customHandle') {
      throw new Error('Workspace session custom handle path is invalid')
    }
    let target = snapshot
    for (let part = 0; part < path.length - 1; part += 1) {
      const segment = path[part]
      if (
        (typeof segment !== 'string' && !Number.isInteger(segment))
        || target === null
        || typeof target !== 'object'
        || !Object.hasOwn(target, segment)
      ) {
        throw new Error('Workspace session custom handle path cannot be restored')
      }
      target = target[segment]
    }
    if (target === null || typeof target !== 'object' || !Object.hasOwn(target, 'customHandle')) {
      throw new Error('Workspace session custom handle target is missing')
    }
    target.customHandle = handles[index]
  }
  return snapshot
}

export async function decodeWorkspaceSessionRecord(record) {
  if (!isChunkedWorkspaceSessionRecord(record)) return record
  const source = createWorkspaceSessionRestoreSource(record)
  const serialized = typeof source.serialized.text === 'function'
    ? await source.serialized.text()
    : await chunkText(record.chunks)
  return restoreCustomHandles(JSON.parse(serialized), source.customHandles, source.customHandlePaths)
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
  })
}

function createIndexedDbDriver({ indexedDB, databaseName, storeName }) {
  let databasePromise = null

  function openDatabase() {
    if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB is unavailable'))
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName)
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => database.close()
        resolve(database)
      }
      request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'))
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'))
    }).catch(error => {
      databasePromise = null
      throw error
    })
    return databasePromise
  }

  async function run(mode, action) {
    const database = await openDatabase()
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const result = action(store)
    const value = result ? await requestResult(result) : undefined
    await transactionComplete(transaction)
    return value
  }

  return {
    get: key => run('readonly', store => store.get(key)),
    put: (key, value) => run('readwrite', store => store.put(value, key)),
    delete: key => run('readwrite', store => store.delete(key)),
    close() {
      void databasePromise?.then(database => database.close()).catch(() => {})
      databasePromise = null
    }
  }
}

function normalizedWorkspaceId(value) {
  return String(value || '').trim()
}

export function createWorkspaceSessionStore(options = {}) {
  const driver = options.driver || createIndexedDbDriver({
    indexedDB: options.indexedDB ?? globalThis.indexedDB,
    databaseName: options.databaseName || DEFAULT_DATABASE_NAME,
    storeName: options.storeName || DEFAULT_STORE_NAME
  })
  const serialization = options.serialization || {}
  let closed = false

  async function attempt(operation) {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, error }
    }
  }

  function closedFailure() {
    return { ok: false, error: new ClosedWorkspaceSessionStoreError() }
  }

  async function loadRecord(key) {
    const record = await driver.get(key)
    if (closed) throw new ClosedWorkspaceSessionStoreError()
    return record
  }

  return {
    async loadRecord(workspaceId) {
      const key = normalizedWorkspaceId(workspaceId)
      if (!key) return { ok: false, error: new Error('Workspace id is required') }
      if (closed) return closedFailure()
      return attempt(() => loadRecord(key))
    },
    async load(workspaceId) {
      const key = normalizedWorkspaceId(workspaceId)
      if (!key) return { ok: false, error: new Error('Workspace id is required') }
      if (closed) return closedFailure()
      return attempt(async () => decodeWorkspaceSessionRecord(await loadRecord(key)))
    },
    async save(workspaceId, snapshot, saveOptions = {}) {
      const key = normalizedWorkspaceId(workspaceId)
      if (!key) return { ok: false, error: new Error('Workspace id is required') }
      if (closed) return closedFailure()
      const isFresh = typeof saveOptions.isFresh === 'function' ? saveOptions.isFresh : () => true
      try {
        const record = await encodeWorkspaceSessionSnapshot(snapshot, {
          ...serialization,
          isFresh,
          isCancelled: () => closed
        })
        if (closed) throw new ClosedWorkspaceSessionStoreError()
        if (!isFresh()) throw new StaleWorkspaceSessionSaveError()
        await driver.put(key, record)
        return { ok: true }
      } catch (error) {
        if (error instanceof StaleWorkspaceSessionSaveError) return { ok: false, stale: true }
        return { ok: false, error }
      }
    },
    async remove(workspaceId) {
      const key = normalizedWorkspaceId(workspaceId)
      if (!key) return { ok: false, error: new Error('Workspace id is required') }
      if (closed) return closedFailure()
      const result = await attempt(() => driver.delete(key))
      return result.ok ? { ok: true } : result
    },
    close() {
      if (closed) return
      closed = true
      driver.close?.()
    }
  }
}

export function createWorkspaceSessionSaveQueue(store) {
  if (typeof store?.save !== 'function') throw new TypeError('Workspace session store is required')
  const pendingByWorkspace = new Map()

  async function attemptSave(workspaceId, snapshot, saveOptions) {
    try {
      return await store.save(workspaceId, snapshot, saveOptions)
    } catch (error) {
      return { ok: false, error }
    }
  }

  function save(workspaceId, snapshot, fallbackSnapshot = null, saveOptions = {}) {
    const workspace = normalizedWorkspaceId(workspaceId)
    const previous = pendingByWorkspace.get(workspace) || Promise.resolve()
    const current = previous.catch(() => {}).then(async () => {
      const result = await attemptSave(workspaceId, snapshot, saveOptions)
      if (result.ok || result.stale || fallbackSnapshot == null) return result
      return attemptSave(workspaceId, fallbackSnapshot, saveOptions)
    })
    pendingByWorkspace.set(workspace, current)
    return current.finally(() => {
      if (pendingByWorkspace.get(workspace) === current) pendingByWorkspace.delete(workspace)
    })
  }

  return { save }
}
