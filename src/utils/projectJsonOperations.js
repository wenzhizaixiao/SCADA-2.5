import { ProjectValidationError } from './projectValidation.js'
import { prepareProject } from './projectPreparation.js'

export const PROJECT_JSON_OPERATIONS = Object.freeze({
  parse: 'parse',
  parseHeader: 'parse-header',
  prepare: 'prepare',
  parseAndPrepare: 'parse-and-prepare'
})

export const PROJECT_JSON_RESPONSE_MODES = Object.freeze({
  preparedProjectChunksV1: 'prepared-project-chunks-v1'
})

export const PREPARED_PROJECT_CHUNK_PROTOCOL = 'tc2d-prepared-project-v1'
export const PREPARED_PROJECT_CHUNK_COLLECTIONS = Object.freeze([
  'nodes',
  'edges',
  'drawings',
  'customComponents'
])
export const PREPARED_PROJECT_CHUNK_MAX_ITEMS = 128
export const PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES = 1024 * 1024

export const PREPARED_PROJECT_MESSAGE_KINDS = Object.freeze({
  start: 'prepared-project-start',
  chunk: 'prepared-project-chunk',
  complete: 'prepared-project-complete'
})

export function usesPreparedProjectChunkResponse(request = {}) {
  return request.responseMode === PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1
    && [PROJECT_JSON_OPERATIONS.prepare, PROJECT_JSON_OPERATIONS.parseAndPrepare].includes(request.operation)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function estimatedCloneBytes(value) {
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized.length * 2 : 0
}

/**
 * Produces bounded collection messages without cloning the complete prepared
 * project back to the main thread in one task. A single oversized entity is
 * isolated and marked because entity fields cannot be split transparently.
 */
export function *createPreparedProjectChunkMessages(project, options = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new TypeError('Prepared project must be an object')
  }
  const maxItems = positiveInteger(options.maxItems, PREPARED_PROJECT_CHUNK_MAX_ITEMS)
  const maxEstimatedBytes = positiveInteger(
    options.maxEstimatedBytes,
    PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES
  )
  const collectionNames = new Set(PREPARED_PROJECT_CHUNK_COLLECTIONS)
  const envelope = Object.create(null)
  for (const [key, value] of Object.entries(project)) {
    if (!collectionNames.has(key)) envelope[key] = value
  }
  const counts = {}
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) {
    if (!Array.isArray(project[collection])) throw new TypeError(`Prepared project ${collection} must be an array`)
    counts[collection] = project[collection].length
  }

  yield {
    protocol: PREPARED_PROJECT_CHUNK_PROTOCOL,
    kind: PREPARED_PROJECT_MESSAGE_KINDS.start,
    envelope,
    counts
  }

  let sequence = 0
  for (const collection of PREPARED_PROJECT_CHUNK_COLLECTIONS) {
    const items = project[collection]
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
        protocol: PREPARED_PROJECT_CHUNK_PROTOCOL,
        kind: PREPARED_PROJECT_MESSAGE_KINDS.chunk,
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

  yield {
    protocol: PREPARED_PROJECT_CHUNK_PROTOCOL,
    kind: PREPARED_PROJECT_MESSAGE_KINDS.complete,
    sequence,
    counts
  }
}

export function executeProjectJsonOperation(request = {}) {
  if (request.operation === PROJECT_JSON_OPERATIONS.prepare) {
    return prepareProject(request.data, request.fallbackName)
  }
  if (request.operation === PROJECT_JSON_OPERATIONS.parseAndPrepare) {
    return prepareProject(JSON.parse(request.serialized), request.fallbackName)
  }
  if (request.operation === PROJECT_JSON_OPERATIONS.parseHeader) {
    const project = JSON.parse(request.serialized)
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new TypeError('Project JSON must contain an object')
    }
    const revision = Math.floor(Number(project.revision))
    return {
      projectId: typeof project.projectId === 'string' && project.projectId.length <= 512 ? project.projectId : '',
      revision: Number.isSafeInteger(revision) ? Math.max(0, revision) : 0,
      updatedAt: typeof project.updatedAt === 'string' && project.updatedAt.length <= 128 ? project.updatedAt : null
    }
  }
  if (request.operation === PROJECT_JSON_OPERATIONS.parse) return JSON.parse(request.serialized)
  throw new TypeError('Unsupported project JSON operation')
}

export function serializeProjectJsonOperationError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    code: typeof error?.code === 'string' ? error.code : undefined
  }
}

export function deserializeProjectJsonOperationError(value = {}) {
  const message = String(value.message || 'Invalid project JSON')
  if (value.name === 'ProjectValidationError') return new ProjectValidationError(value.code, message)
  const ErrorType = value.name === 'SyntaxError'
    ? SyntaxError
    : value.name === 'TypeError'
      ? TypeError
      : value.name === 'RangeError'
        ? RangeError
        : Error
  const error = new ErrorType(message)
  if (typeof value.name === 'string' && value.name) error.name = value.name
  if (typeof value.code === 'string') error.code = value.code
  return error
}
