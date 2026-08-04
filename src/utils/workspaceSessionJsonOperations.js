import {
  PREPARED_PROJECT_CHUNK_COLLECTIONS,
  PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES,
  PREPARED_PROJECT_CHUNK_MAX_ITEMS
} from './projectJsonOperations.js'
import { prepareProject } from './projectPreparation.js'
import { prepareWorkspaceSessionSnapshot } from './workspaceSessionCache.js'

export const WORKSPACE_SESSION_JSON_OPERATION = 'parse-and-prepare-workspace-session'
export const PREPARED_WORKSPACE_SESSION_RESPONSE_MODE = 'prepared-workspace-session-chunks-v1'
export const PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL = 'tc2d-prepared-workspace-session-v1'
export const PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS = PREPARED_PROJECT_CHUNK_MAX_ITEMS
export const PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES = PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES
export const PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS = Object.freeze([
  ...PREPARED_PROJECT_CHUNK_COLLECTIONS,
  'history',
  'future'
])
export const PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS = Object.freeze({
  start: 'prepared-workspace-session-start',
  paperStart: 'prepared-workspace-paper-start',
  chunk: 'prepared-workspace-paper-chunk',
  complete: 'prepared-workspace-session-complete'
})

const HANDLE_MARKER_KEY = '__tc2dWorkspaceSessionHandleMarker'

function validRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function estimatedCloneBytes(value) {
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized.length * 2 : 0
}

function recordWithout(record, excluded) {
  const result = Object.create(null)
  for (const [key, value] of Object.entries(record)) {
    if (!excluded.has(key)) result[key] = value
  }
  return result
}

function boundedEnvelopeBytes(value, label, maxEstimatedBytes) {
  const estimatedBytes = estimatedCloneBytes(value)
  if (estimatedBytes > maxEstimatedBytes) {
    throw new RangeError(`${label} exceeds the workspace session message budget`)
  }
  return estimatedBytes
}

function customHandleMarker(token, index) {
  return { [HANDLE_MARKER_KEY]: token, index }
}

function applyCustomHandleMarkers(snapshot, paths, token) {
  if (!Array.isArray(paths)) throw new Error('Workspace session custom handle paths are invalid')
  if (paths.length && (typeof token !== 'string' || !token)) {
    throw new Error('Workspace session custom handle marker token is invalid')
  }
  for (let index = 0; index < paths.length; index += 1) {
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
    target.customHandle = customHandleMarker(token, index)
  }
}

function isCustomHandleMarker(value, token) {
  return typeof token === 'string' && token.length > 0
    && validRecord(value)
    && Object.hasOwn(value, HANDLE_MARKER_KEY)
    && value[HANDLE_MARKER_KEY] === token
}

export function restoreWorkspaceSessionHandleMarkers(value, handles, token) {
  if (!Array.isArray(handles)) throw new Error('Workspace session custom handles are invalid')
  const root = { value }
  const stack = [{ parent: root, key: 'value', value }]
  const visited = new WeakSet()
  while (stack.length) {
    const entry = stack.pop()
    if (isCustomHandleMarker(entry.value, token)) {
      const index = entry.value.index
      if (!Number.isSafeInteger(index) || index < 0 || index >= handles.length) {
        throw new Error('Workspace session custom handle marker is invalid')
      }
      entry.parent[entry.key] = handles[index]
      continue
    }
    if (entry.value === null || typeof entry.value !== 'object' || visited.has(entry.value)) continue
    visited.add(entry.value)
    for (const key of Object.keys(entry.value)) {
      stack.push({ parent: entry.value, key, value: entry.value[key] })
    }
  }
  return root.value
}

async function serializedWorkspaceSessionText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.text === 'function') return value.text()
  throw new TypeError('Workspace session JSON must be a string or Blob')
}

export async function executeWorkspaceSessionJsonOperation(request = {}) {
  if (request.operation !== WORKSPACE_SESSION_JSON_OPERATION) {
    throw new TypeError('Unsupported workspace session JSON operation')
  }
  const serialized = await serializedWorkspaceSessionText(request.serialized)
  const snapshot = JSON.parse(serialized)
  applyCustomHandleMarkers(snapshot, request.customHandlePaths || [], request.customHandleMarkerToken)
  return prepareWorkspaceSessionSnapshot(snapshot, request.workspace, data => prepareProject(data))
}

export function usesPreparedWorkspaceSessionChunkResponse(request = {}) {
  return request.operation === WORKSPACE_SESSION_JSON_OPERATION
    && request.responseMode === PREPARED_WORKSPACE_SESSION_RESPONSE_MODE
}

function workspaceCollectionItems(session, collection) {
  return collection === 'history' || collection === 'future'
    ? session[collection]
    : session.data[collection]
}

export function *createPreparedWorkspaceSessionChunkMessages(prepared, options = {}) {
  if (!validRecord(prepared) || !Array.isArray(prepared.sessions)) {
    throw new TypeError('Prepared workspace session must be an object')
  }
  const maxItems = positiveInteger(options.maxItems, PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS)
  const maxEstimatedBytes = positiveInteger(
    options.maxEstimatedBytes,
    PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES
  )
  const workspaceEnvelope = recordWithout(prepared, new Set(['sessions']))
  const workspaceEnvelopeBytes = boundedEnvelopeBytes(
    workspaceEnvelope,
    'Prepared workspace session envelope',
    maxEstimatedBytes
  )

  yield {
    protocol: PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL,
    kind: PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.start,
    envelope: workspaceEnvelope,
    sessionCount: prepared.sessions.length,
    estimatedBytes: workspaceEnvelopeBytes
  }

  let sequence = 0
  for (let sessionIndex = 0; sessionIndex < prepared.sessions.length; sessionIndex += 1) {
    const session = prepared.sessions[sessionIndex]
    if (!validRecord(session) || !validRecord(session.data)) {
      throw new TypeError('Prepared workspace paper must contain project data')
    }
    if (!Array.isArray(session.history) || !Array.isArray(session.future)) {
      throw new TypeError('Prepared workspace paper history must be an array')
    }
    const sessionEnvelope = recordWithout(session, new Set(['data', 'history', 'future']))
    const dataEnvelope = recordWithout(session.data, new Set(PREPARED_PROJECT_CHUNK_COLLECTIONS))
    const counts = {}
    for (const collection of PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS) {
      const items = workspaceCollectionItems(session, collection)
      if (!Array.isArray(items)) throw new TypeError(`Prepared workspace paper ${collection} must be an array`)
      counts[collection] = items.length
    }
    const envelopeBytes = boundedEnvelopeBytes(
      { sessionEnvelope, dataEnvelope },
      'Prepared workspace paper envelope',
      maxEstimatedBytes
    )

    yield {
      protocol: PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL,
      kind: PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.paperStart,
      sessionIndex,
      envelope: sessionEnvelope,
      dataEnvelope,
      counts,
      estimatedBytes: envelopeBytes
    }

    for (const collection of PREPARED_WORKSPACE_SESSION_CHUNK_COLLECTIONS) {
      const items = workspaceCollectionItems(session, collection)
      let start = 0
      while (start < items.length) {
        const chunk = []
        let estimatedBytes = 0
        while (start + chunk.length < items.length && chunk.length < maxItems) {
          const item = items[start + chunk.length]
          const itemBytes = estimatedCloneBytes(item)
          if (chunk.length && estimatedBytes + itemBytes > maxEstimatedBytes) break
          chunk.push(item)
          estimatedBytes += itemBytes
          if (estimatedBytes >= maxEstimatedBytes) break
        }
        const oversized = chunk.length === 1 && estimatedBytes > maxEstimatedBytes
        yield {
          protocol: PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL,
          kind: PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.chunk,
          sessionIndex,
          collection,
          sequence: sequence++,
          start,
          items: chunk,
          estimatedBytes,
          oversized
        }
        start += chunk.length
      }
    }
  }

  yield {
    protocol: PREPARED_WORKSPACE_SESSION_CHUNK_PROTOCOL,
    kind: PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.complete,
    sequence,
    sessionCount: prepared.sessions.length
  }
}
