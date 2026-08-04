import {
  deserializeProjectJsonOperationError,
  executeProjectJsonOperation,
  PREPARED_PROJECT_CHUNK_COLLECTIONS,
  PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES,
  PREPARED_PROJECT_CHUNK_MAX_ITEMS,
  PREPARED_PROJECT_CHUNK_PROTOCOL,
  PREPARED_PROJECT_MESSAGE_KINDS,
  PROJECT_JSON_OPERATIONS,
  PROJECT_JSON_RESPONSE_MODES
} from './projectJsonOperations.js'
import {
  executeWorkspaceSessionJsonOperation,
  PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS,
  PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES,
  PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS,
  PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL,
  PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS,
  PREPARED_WORKSPACE_SESSION_RESPONSE_MODE,
  restoreWorkspaceSessionHandleMarkers,
  WORKSPACE_SESSION_JSON_OPERATION
} from './workspaceSessionJsonOperations.js'

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') return null
  return new Worker(new URL('../workers/projectJson.worker.js', import.meta.url), { type: 'module' })
}

function executeOnCurrentThread(request) {
  if (request.operation === WORKSPACE_SESSION_JSON_OPERATION) {
    return executeWorkspaceSessionJsonOperation(request)
  }
  return Promise.resolve().then(() => executeProjectJsonOperation(request))
}

export class ProjectJsonParserDisposedError extends Error {
  constructor() {
    super('Project JSON parser is disposed')
    this.name = 'ProjectJsonParserDisposedError'
  }
}

export class ProjectJsonParserProtocolError extends Error {
  constructor(message = 'Invalid project JSON worker response') {
    super(message)
    this.name = 'ProjectJsonParserProtocolError'
  }
}

function protocolError(message) {
  return new ProjectJsonParserProtocolError(message)
}

function validRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readChunkCounts(value) {
  if (!validRecord(value)) throw protocolError('Prepared project counts are missing')
  const keys = Object.keys(value)
  if (
    keys.length !== PREPARED_PROJECT_CHUNK_COLLECTIONS.length
    || keys.some(key => !PREPARED_PROJECT_CHUNK_COLLECTIONS.includes(key))
  ) throw protocolError('Prepared project counts are invalid')
  const counts = {}
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) {
    const count = value[collection]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw protocolError(`Prepared project ${collection} count is invalid`)
    }
    counts[collection] = count
  }
  return counts
}

function sameChunkCounts(left, right) {
  return PREPARED_PROJECT_CHUNK_COLLECTIONS.every(collection => left[collection] === right[collection])
}

function skipCompletedCollections(state) {
  while (state.collectionIndex < PREPARED_PROJECT_CHUNK_COLLECTIONS.length) {
    const collection = PREPARED_PROJECT_CHUNK_COLLECTIONS[state.collectionIndex]
    if (state.collections[collection].length !== state.counts[collection]) break
    state.collectionIndex += 1
  }
}

function createChunkState(message) {
  if (!validRecord(message.envelope)) throw protocolError('Prepared project envelope is invalid')
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) {
    if (Object.hasOwn(message.envelope, collection)) {
      throw protocolError(`Prepared project envelope contains ${collection}`)
    }
  }
  const collections = {}
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) collections[collection] = []
  const state = {
    envelope: message.envelope,
    counts: readChunkCounts(message.counts),
    collections,
    collectionIndex: 0,
    nextSequence: 0
  }
  skipCompletedCollections(state)
  return state
}

function acceptPreparedProjectChunk(state, message) {
  if (state.collectionIndex >= PREPARED_PROJECT_CHUNK_COLLECTIONS.length) {
    throw protocolError('Prepared project contains an unexpected extra chunk')
  }
  const expectedCollection = PREPARED_PROJECT_CHUNK_COLLECTIONS[state.collectionIndex]
  if (message.collection !== expectedCollection) {
    throw protocolError(`Prepared project chunk collection must be ${expectedCollection}`)
  }
  if (!Number.isSafeInteger(message.sequence) || message.sequence !== state.nextSequence) {
    throw protocolError('Prepared project chunk sequence is invalid')
  }
  const target = state.collections[expectedCollection]
  if (!Number.isSafeInteger(message.start) || message.start !== target.length) {
    throw protocolError('Prepared project chunk start is invalid')
  }
  if (!Array.isArray(message.items) || message.items.length < 1 || message.items.length > PREPARED_PROJECT_CHUNK_MAX_ITEMS) {
    throw protocolError('Prepared project chunk item count is invalid')
  }
  if (target.length + message.items.length > state.counts[expectedCollection]) {
    throw protocolError('Prepared project chunk exceeds its declared total')
  }
  if (!Number.isSafeInteger(message.estimatedBytes) || message.estimatedBytes < 0) {
    throw protocolError('Prepared project chunk byte estimate is invalid')
  }
  if (typeof message.oversized !== 'boolean') {
    throw protocolError('Prepared project oversized chunk marker is invalid')
  }
  const oversized = message.estimatedBytes > PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES
  if (oversized !== (message.oversized === true) || (oversized && message.items.length !== 1)) {
    throw protocolError('Prepared project oversized chunk marker is invalid')
  }
  target.push(...message.items)
  state.nextSequence += 1
  skipCompletedCollections(state)
}

function completePreparedProject(state, message) {
  if (!Number.isSafeInteger(message.sequence) || message.sequence !== state.nextSequence) {
    throw protocolError('Prepared project completion sequence is invalid')
  }
  const completionCounts = readChunkCounts(message.counts)
  if (!sameChunkCounts(state.counts, completionCounts)) {
    throw protocolError('Prepared project completion totals do not match')
  }
  skipCompletedCollections(state)
  if (state.collectionIndex !== PREPARED_PROJECT_CHUNK_COLLECTIONS.length) {
    throw protocolError('Prepared project completed before all chunks arrived')
  }
  return { ...state.envelope, ...state.collections }
}

function readWorkspaceChunkCounts(value) {
  if (!validRecord(value)) throw protocolError('Prepared workspace paper counts are missing')
  const keys = Object.keys(value)
  if (
    keys.length !== PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS.length
    || keys.some(key => !PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS.includes(key))
  ) throw protocolError('Prepared workspace paper counts are invalid')
  const counts = {}
  for (const collection of PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS) {
    const count = value[collection]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw protocolError(`Prepared workspace paper ${collection} count is invalid`)
    }
    counts[collection] = count
  }
  return counts
}

function readBoundedWorkspaceEnvelope(message) {
  if (!Number.isSafeInteger(message.estimatedBytes) || message.estimatedBytes < 0) {
    throw protocolError('Prepared workspace envelope byte estimate is invalid')
  }
  if (message.estimatedBytes > PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES) {
    throw protocolError('Prepared workspace envelope exceeds its byte budget')
  }
}

function hydrateWorkspaceChunkValue(state, value) {
  return restoreWorkspaceSessionHandleMarkers(value, state.customHandles, state.customHandleMarkerToken)
}

function createWorkspaceChunkState(message, localContext = {}) {
  if (!validRecord(message.envelope) || Object.hasOwn(message.envelope, 'sessions')) {
    throw protocolError('Prepared workspace session envelope is invalid')
  }
  if (!Number.isSafeInteger(message.sessionCount) || message.sessionCount < 0) {
    throw protocolError('Prepared workspace session count is invalid')
  }
  readBoundedWorkspaceEnvelope(message)
  return {
    type: 'workspace',
    envelope: restoreWorkspaceSessionHandleMarkers(
      message.envelope,
      localContext.customHandles || [],
      localContext.customHandleMarkerToken
    ),
    sessionCount: message.sessionCount,
    sessions: [],
    paper: null,
    nextSequence: 0,
    customHandles: localContext.customHandles || [],
    customHandleMarkerToken: localContext.customHandleMarkerToken
  }
}

function finishWorkspacePaperIfComplete(state) {
  const paper = state.paper
  if (!paper) return
  while (paper.collectionIndex < PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS.length) {
    const collection = PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS[paper.collectionIndex]
    if (paper.collections[collection].length !== paper.counts[collection]) return
    paper.collectionIndex += 1
  }
  state.paper = null
}

function acceptPreparedWorkspacePaperStart(state, message) {
  if (state.paper) throw protocolError('Prepared workspace paper started before the previous paper completed')
  if (!Number.isSafeInteger(message.sessionIndex) || message.sessionIndex !== state.sessions.length) {
    throw protocolError('Prepared workspace paper index is invalid')
  }
  if (state.sessions.length >= state.sessionCount) {
    throw protocolError('Prepared workspace contains an unexpected extra paper')
  }
  if (!validRecord(message.envelope) || ['data', 'history', 'future'].some(key => Object.hasOwn(message.envelope, key))) {
    throw protocolError('Prepared workspace paper envelope is invalid')
  }
  if (!validRecord(message.dataEnvelope)) throw protocolError('Prepared workspace project envelope is invalid')
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) {
    if (Object.hasOwn(message.dataEnvelope, collection)) {
      throw protocolError(`Prepared workspace project envelope contains ${collection}`)
    }
  }
  readBoundedWorkspaceEnvelope(message)
  const counts = readWorkspaceChunkCounts(message.counts)
  const collections = {}
  for (const collection of PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS) collections[collection] = []
  const sessionEnvelope = hydrateWorkspaceChunkValue(state, message.envelope)
  const dataEnvelope = hydrateWorkspaceChunkValue(state, message.dataEnvelope)
  const session = {
    ...sessionEnvelope,
    data: {
      ...dataEnvelope,
      nodes: collections.nodes,
      edges: collections.edges,
      drawings: collections.drawings,
      customComponents: collections.customComponents
    },
    history: collections.history,
    future: collections.future
  }
  state.sessions.push(session)
  state.paper = {
    sessionIndex: message.sessionIndex,
    counts,
    collections,
    collectionIndex: 0
  }
  finishWorkspacePaperIfComplete(state)
}

function acceptPreparedWorkspaceChunk(state, message) {
  const paper = state.paper
  if (!paper) throw protocolError('Prepared workspace chunk arrived without an active paper')
  if (message.sessionIndex !== paper.sessionIndex) {
    throw protocolError('Prepared workspace chunk paper index is invalid')
  }
  if (!Number.isSafeInteger(message.sequence) || message.sequence !== state.nextSequence) {
    throw protocolError('Prepared workspace chunk sequence is invalid')
  }
  const collection = PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS[paper.collectionIndex]
  if (message.collection !== collection) {
    throw protocolError(`Prepared workspace chunk collection must be ${collection}`)
  }
  const target = paper.collections[collection]
  if (!Number.isSafeInteger(message.start) || message.start !== target.length) {
    throw protocolError('Prepared workspace chunk start is invalid')
  }
  if (
    !Array.isArray(message.items)
    || message.items.length < 1
    || message.items.length > PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS
  ) throw protocolError('Prepared workspace chunk item count is invalid')
  if (target.length + message.items.length > paper.counts[collection]) {
    throw protocolError('Prepared workspace chunk exceeds its declared total')
  }
  if (!Number.isSafeInteger(message.estimatedBytes) || message.estimatedBytes < 0) {
    throw protocolError('Prepared workspace chunk byte estimate is invalid')
  }
  if (typeof message.oversized !== 'boolean') {
    throw protocolError('Prepared workspace oversized chunk marker is invalid')
  }
  const oversized = message.estimatedBytes > PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES
  if (oversized !== (message.oversized === true) || (oversized && message.items.length !== 1)) {
    throw protocolError('Prepared workspace oversized chunk marker is invalid')
  }
  target.push(...hydrateWorkspaceChunkValue(state, message.items))
  state.nextSequence += 1
  finishWorkspacePaperIfComplete(state)
}

function completePreparedWorkspaceSession(state, message) {
  if (!Number.isSafeInteger(message.sequence) || message.sequence !== state.nextSequence) {
    throw protocolError('Prepared workspace completion sequence is invalid')
  }
  if (!Number.isSafeInteger(message.sessionCount) || message.sessionCount !== state.sessionCount) {
    throw protocolError('Prepared workspace completion total does not match')
  }
  if (state.paper || state.sessions.length !== state.sessionCount) {
    throw protocolError('Prepared workspace completed before all papers arrived')
  }
  return { ...state.envelope, sessions: state.sessions }
}

export function createProjectJsonParser(options = {}) {
  const workerFactory = options.workerFactory || defaultWorkerFactory
  const pending = new Map()
  let worker = null
  let nextRequestId = 1
  let nextWorkspaceMarkerId = 1
  let disposed = false
  let workerUnavailable = false
  let lifecycleGeneration = 0

  function disposedError() {
    return new ProjectJsonParserDisposedError()
  }

  function finalizeOperationValue(value, localContext, operationRequest = null) {
    if (operationRequest?.operation === PROJECT_JSON_OPERATIONS.parseHeader) {
      const keys = validRecord(value) ? Object.keys(value) : []
      if (
        keys.length !== 3
        || !keys.includes('projectId')
        || !keys.includes('revision')
        || !keys.includes('updatedAt')
        || typeof value.projectId !== 'string'
        || value.projectId.length > 512
        || !Number.isSafeInteger(value.revision)
        || value.revision < 0
        || (value.updatedAt !== null && typeof value.updatedAt !== 'string')
        || (typeof value.updatedAt === 'string' && value.updatedAt.length > 128)
      ) throw protocolError('Project JSON header response is invalid')
      return value
    }
    if (!localContext) return value
    return restoreWorkspaceSessionHandleMarkers(
      value,
      localContext.customHandles,
      localContext.customHandleMarkerToken
    )
  }

  function executeWithLifecycle(request, generation = lifecycleGeneration, localContext = null) {
    return executeOnCurrentThread(request).then(
      value => {
        if (disposed || generation !== lifecycleGeneration) throw disposedError()
        return finalizeOperationValue(value, localContext, request)
      },
      error => {
        if (disposed || generation !== lifecycleGeneration) throw disposedError()
        throw error
      }
    )
  }

  function settleWithFallback() {
    if (disposed) return
    const requests = [...pending.values()]
    pending.clear()
    worker?.terminate?.()
    worker = null
    workerUnavailable = true
    for (const request of requests) {
      executeWithLifecycle(request.operationRequest, request.generation, request.localContext).then(request.resolve, request.reject)
    }
  }

  function ensureWorker() {
    if (disposed || workerUnavailable) return null
    if (worker) return worker
    try {
      worker = workerFactory()
    } catch {
      workerUnavailable = true
      return null
    }
    if (!worker) {
      workerUnavailable = true
      return null
    }
    worker.onmessage = event => {
      const message = event.data
      const request = pending.get(message?.id)
      if (!request) return
      if (message?.ok === false) {
        pending.delete(message.id)
        request.reject(deserializeProjectJsonOperationError(message.error))
        return
      }
      try {
        if (message?.ok !== true) throw protocolError('Project JSON worker response status is invalid')
        const responseMode = request.operationRequest.responseMode
        if (Object.hasOwn(message, 'value')) {
          if (request.chunkState) throw protocolError('Project JSON worker mixed chunked and single responses')
          if (responseMode === PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1) {
            throw protocolError('Prepared project must use chunked responses')
          }
          if (responseMode === PREPARED_WORKSPACE_SESSION_RESPONSE_MODE && message.value !== null) {
            throw protocolError('Prepared workspace must use chunked responses')
          }
          pending.delete(message.id)
          request.resolve(finalizeOperationValue(message.value, request.localContext, request.operationRequest))
          return
        }
        if (responseMode === PREPARED_WORKSPACE_SESSION_RESPONSE_MODE) {
          if (message.protocol !== PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL) {
            throw protocolError('Prepared workspace protocol version is invalid')
          }
          if (message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.start) {
            if (request.chunkState) throw protocolError('Prepared workspace started more than once')
            request.chunkState = createWorkspaceChunkState(message, request.localContext)
            return
          }
          if (!request.chunkState) throw protocolError('Prepared workspace chunk arrived before start')
          if (message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.paperStart) {
            acceptPreparedWorkspacePaperStart(request.chunkState, message)
            return
          }
          if (message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.chunk) {
            acceptPreparedWorkspaceChunk(request.chunkState, message)
            return
          }
          if (message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.complete) {
            const value = completePreparedWorkspaceSession(request.chunkState, message)
            pending.delete(message.id)
            request.resolve(value)
            return
          }
          throw protocolError('Prepared workspace message kind is invalid')
        }
        if (responseMode !== PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1) {
          throw protocolError('Project JSON worker returned unexpected prepared-project chunks')
        }
        if (message.protocol !== PREPARED_PROJECT_CHUNK_PROTOCOL) {
          throw protocolError('Prepared project protocol version is invalid')
        }
        if (message.kind === PREPARED_PROJECT_MESSAGE_KINDS.start) {
          if (request.chunkState) throw protocolError('Prepared project started more than once')
          request.chunkState = createChunkState(message)
          return
        }
        if (!request.chunkState) throw protocolError('Prepared project chunk arrived before start')
        if (message.kind === PREPARED_PROJECT_MESSAGE_KINDS.chunk) {
          acceptPreparedProjectChunk(request.chunkState, message)
          return
        }
        if (message.kind === PREPARED_PROJECT_MESSAGE_KINDS.complete) {
          const value = completePreparedProject(request.chunkState, message)
          pending.delete(message.id)
          request.resolve(value)
          return
        }
        throw protocolError('Prepared project message kind is invalid')
      } catch (error) {
        pending.delete(message.id)
        request.reject(error instanceof ProjectJsonParserProtocolError ? error : protocolError(error?.message))
      }
    }
    worker.onerror = settleWithFallback
    worker.onmessageerror = settleWithFallback
    return worker
  }

  function submit(operationRequest, localContext = null) {
    if (disposed) return Promise.reject(disposedError())
    const target = ensureWorker()
    if (!target) return executeWithLifecycle(operationRequest, lifecycleGeneration, localContext)
    const id = nextRequestId++
    return new Promise((resolve, reject) => {
      pending.set(id, { operationRequest, localContext, resolve, reject, generation: lifecycleGeneration, chunkState: null })
      try {
        target.postMessage({ id, ...operationRequest })
      } catch {
        settleWithFallback()
      }
    })
  }

  return {
    parse(serialized) {
      if (typeof serialized !== 'string') return Promise.reject(new TypeError('Project JSON must be a string'))
      return submit({ operation: PROJECT_JSON_OPERATIONS.parse, serialized })
    },
    parseHeader(serialized) {
      if (typeof serialized !== 'string') return Promise.reject(new TypeError('Project JSON must be a string'))
      return submit({ operation: PROJECT_JSON_OPERATIONS.parseHeader, serialized })
    },
    prepare(data, fallbackName = '未命名图纸') {
      return submit({
        operation: PROJECT_JSON_OPERATIONS.prepare,
        responseMode: PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1,
        data,
        fallbackName
      })
    },
    parseAndPrepare(serialized, fallbackName = '未命名图纸') {
      if (typeof serialized !== 'string') return Promise.reject(new TypeError('Project JSON must be a string'))
      return submit({
        operation: PROJECT_JSON_OPERATIONS.parseAndPrepare,
        responseMode: PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1,
        serialized,
        fallbackName
      })
    },
    parseAndPrepareWorkspaceSession(source, workspace) {
      if (!validRecord(source)) return Promise.reject(new TypeError('Workspace session restore source is required'))
      const serialized = source.serialized
      if (typeof serialized !== 'string' && typeof serialized?.text !== 'function') {
        return Promise.reject(new TypeError('Workspace session JSON must be a string or Blob'))
      }
      const customHandles = source.customHandles || []
      const customHandlePaths = source.customHandlePaths || []
      if (
        !Array.isArray(customHandles)
        || !Array.isArray(customHandlePaths)
        || customHandles.length !== customHandlePaths.length
      ) return Promise.reject(new TypeError('Workspace session custom handle metadata is invalid'))
      const randomToken = globalThis.crypto?.randomUUID?.()
      const customHandleMarkerToken = `workspace-handle-${randomToken || nextWorkspaceMarkerId++}`
      return submit({
        operation: WORKSPACE_SESSION_JSON_OPERATION,
        responseMode: PREPARED_WORKSPACE_SESSION_RESPONSE_MODE,
        serialized,
        workspace,
        customHandlePaths,
        customHandleMarkerToken
      }, {
        customHandles,
        customHandleMarkerToken
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifecycleGeneration += 1
      worker?.terminate?.()
      worker = null
      const error = disposedError()
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    }
  }
}
