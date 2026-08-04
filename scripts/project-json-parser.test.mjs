import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProjectJsonParser,
  ProjectJsonParserDisposedError,
  ProjectJsonParserProtocolError
} from '../src/utils/projectJsonParser.js'
import {
  createPreparedProjectChunkMessages,
  executeProjectJsonOperation,
  PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES,
  PREPARED_PROJECT_CHUNK_MAX_ITEMS,
  PREPARED_PROJECT_MESSAGE_KINDS,
  PROJECT_JSON_OPERATIONS,
  PROJECT_JSON_RESPONSE_MODES,
  serializeProjectJsonOperationError
} from '../src/utils/projectJsonOperations.js'
import { prepareProject } from '../src/utils/projectPreparation.js'
import { ProjectValidationError } from '../src/utils/projectValidation.js'
import { prepareWorkspaceSessionSnapshot } from '../src/utils/workspaceSessionCache.js'
import {
  createPreparedWorkspaceSessionChunkMessages,
  executeWorkspaceSessionJsonOperation,
  PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES,
  PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS,
  PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS,
  usesPreparedWorkspaceSessionChunkResponse
} from '../src/utils/workspaceSessionJsonOperations.js'

function validProject(overrides = {}) {
  return {
    version: 20,
    projectId: 'project-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    nodes: [{ id: 'node-a', type: 'rect', x: 0, y: 0, w: 20, h: 20 }],
    edges: [],
    drawings: [],
    customComponents: [],
    ...overrides
  }
}

function operationWorker(messages = []) {
  const worker = {
    postMessage(request) {
      messages.push(structuredClone(request))
      queueMicrotask(() => {
        try {
          const value = executeProjectJsonOperation(request)
          if (request.responseMode === PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1) {
            for (const response of createPreparedProjectChunkMessages(value)) {
              worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...response }) })
            }
            return
          }
          worker.onmessage({ data: structuredClone({ id: request.id, ok: true, value }) })
        } catch (error) {
          worker.onmessage({
            data: structuredClone({ id: request.id, ok: false, error: serializeProjectJsonOperationError(error) })
          })
        }
      })
    },
    terminate() {}
  }
  return worker
}

function chunkedOperationWorker(messages = [], responses = []) {
  const worker = {
    postMessage(request) {
      messages.push(structuredClone(request))
      queueMicrotask(() => {
        try {
          const value = executeProjectJsonOperation(request)
          for (const response of createPreparedProjectChunkMessages(value)) {
            const message = structuredClone({ id: request.id, ok: true, ...response })
            responses.push(message)
            worker.onmessage({ data: message })
          }
        } catch (error) {
          worker.onmessage({
            data: structuredClone({ id: request.id, ok: false, error: serializeProjectJsonOperationError(error) })
          })
        }
      })
    },
    terminate() {}
  }
  return worker
}

function chunkedWorkspaceOperationWorker(messages = [], responses = []) {
  const worker = {
    postMessage(request) {
      messages.push(structuredClone(request))
      queueMicrotask(async () => {
        try {
          const value = await executeWorkspaceSessionJsonOperation(request)
          if (value && usesPreparedWorkspaceSessionChunkResponse(request)) {
            for (const response of createPreparedWorkspaceSessionChunkMessages(value)) {
              const message = structuredClone({ id: request.id, ok: true, ...response })
              responses.push(message)
              worker.onmessage({ data: message })
            }
            return
          }
          worker.onmessage({ data: structuredClone({ id: request.id, ok: true, value }) })
        } catch (error) {
          worker.onmessage({
            data: structuredClone({ id: request.id, ok: false, error: serializeProjectJsonOperationError(error) })
          })
        }
      })
    },
    terminate() {}
  }
  return worker
}

function workspaceSessionSource(snapshot, customHandles = [], customHandlePaths = []) {
  return {
    serialized: new Blob([JSON.stringify(snapshot)], { type: 'application/json' }),
    customHandles,
    customHandlePaths
  }
}

test('falls back to current-thread JSON parsing when workers are unavailable', async () => {
  const parser = createProjectJsonParser({ workerFactory: () => null })
  assert.deepEqual(await parser.parse('{"nodes":[]}'), { nodes: [] })
  assert.deepEqual(
    await parser.parseHeader('{"projectId":"fallback-project","revision":7,"updatedAt":"2026-08-03T00:00:00.000Z","nodes":[{"large":true}]}'),
    { projectId: 'fallback-project', revision: 7, updatedAt: '2026-08-03T00:00:00.000Z' }
  )
  await assert.rejects(parser.parse('{'), SyntaxError)
  await assert.rejects(parser.parseHeader('{'), SyntaxError)
  const source = validProject()
  assert.deepEqual(await parser.prepare(source, 'fallback'), prepareProject(source, 'fallback'))
  assert.deepEqual(await parser.parseAndPrepare(JSON.stringify(source), 'fallback'), prepareProject(source, 'fallback'))
  parser.dispose()
})

test('dispatches parse, header, prepare, and parse-and-prepare as explicit worker operations', async () => {
  const messages = []
  const parser = createProjectJsonParser({ workerFactory: () => operationWorker(messages) })
  const source = validProject({ fileName: '' })

  assert.deepEqual(await parser.parse('{"raw":true}'), { raw: true })
  assert.deepEqual(
    await parser.parseHeader(JSON.stringify({ ...source, revision: 11, updatedAt: '2026-08-03T00:00:00.000Z' })),
    { projectId: 'project-test', revision: 11, updatedAt: '2026-08-03T00:00:00.000Z' }
  )
  assert.deepEqual(await parser.prepare(source, 'prepared-name'), prepareProject(source, 'prepared-name'))
  assert.deepEqual(
    await parser.parseAndPrepare(JSON.stringify(source), 'parsed-name'),
    prepareProject(source, 'parsed-name')
  )
  assert.deepEqual(messages.map(message => message.operation), [
    PROJECT_JSON_OPERATIONS.parse,
    PROJECT_JSON_OPERATIONS.parseHeader,
    PROJECT_JSON_OPERATIONS.prepare,
    PROJECT_JSON_OPERATIONS.parseAndPrepare
  ])
  assert.equal(messages[2].fallbackName, 'prepared-name')
  assert.equal(messages[3].fallbackName, 'parsed-name')
  assert.equal(messages[0].responseMode, undefined)
  assert.equal(messages[1].responseMode, undefined)
  assert.equal(messages[2].responseMode, PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1)
  assert.equal(messages[3].responseMode, PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1)
  parser.dispose()
})

test('rejects project-header worker responses that contain an invalid or expanded payload', async () => {
  const worker = {
    postMessage(request) {
      queueMicrotask(() => worker.onmessage({
        data: {
          id: request.id,
          ok: true,
          value: { projectId: 'project-test', revision: 1, updatedAt: null, nodes: [] }
        }
      }))
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  await assert.rejects(parser.parseHeader(JSON.stringify(validProject())), ProjectJsonParserProtocolError)
  parser.dispose()
})

test('rejects single-value responses for every requested chunked response mode', async () => {
  function singleValueWorker() {
    const worker = {
      postMessage(request) {
        queueMicrotask(async () => {
          const value = usesPreparedWorkspaceSessionChunkResponse(request)
            ? await executeWorkspaceSessionJsonOperation(request)
            : executeProjectJsonOperation(request)
          worker.onmessage({ data: structuredClone({ id: request.id, ok: true, value }) })
        })
      },
      terminate() {}
    }
    return worker
  }

  const projectParser = createProjectJsonParser({ workerFactory: singleValueWorker })
  await assert.rejects(
    projectParser.prepare(validProject()),
    error => error instanceof ProjectJsonParserProtocolError && /chunked responses/.test(error.message)
  )
  projectParser.dispose()

  const workspaceParser = createProjectJsonParser({ workerFactory: singleValueWorker })
  const snapshot = {
    version: 1,
    workspace: 'single-value',
    activeId: 'paper',
    sessions: [{ id: 'paper', data: validProject(), history: [], future: [] }]
  }
  await assert.rejects(
    workspaceParser.parseAndPrepareWorkspaceSession(workspaceSessionSource(snapshot), 'single-value'),
    error => error instanceof ProjectJsonParserProtocolError && /chunked responses/.test(error.message)
  )
  workspaceParser.dispose()
})

test('strictly reassembles bounded prepared-project chunks', async () => {
  const messages = []
  const responses = []
  const parser = createProjectJsonParser({ workerFactory: () => chunkedOperationWorker(messages, responses) })
  const source = validProject({
    nodes: Array.from({ length: PREPARED_PROJECT_CHUNK_MAX_ITEMS * 2 + 5 }, (_, index) => ({
      id: `node-${index}`,
      type: 'rect',
      x: index,
      y: index,
      w: 20,
      h: 20
    }))
  })

  assert.deepEqual(
    await parser.parseAndPrepare(JSON.stringify(source), 'chunked'),
    prepareProject(source, 'chunked')
  )
  assert.equal(messages[0].responseMode, PROJECT_JSON_RESPONSE_MODES.preparedProjectChunksV1)
  const chunks = responses.filter(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.chunk)
  assert.ok(chunks.length >= 3)
  assert.deepEqual(chunks.map(message => message.sequence), chunks.map((_, index) => index))
  assert.ok(chunks.every(message => message.items.length <= PREPARED_PROJECT_CHUNK_MAX_ITEMS))
  assert.ok(chunks.every(message => (
    message.estimatedBytes <= PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES
    || (message.items.length === 1 && message.oversized === true)
  )))
  parser.dispose()
})

test('isolates a single entity that exceeds the prepared-project byte budget', () => {
  const project = prepareProject(validProject({
    nodes: [{ id: 'large-image', type: 'image', x: 0, y: 0, w: 20, h: 20, imageSrc: `data:image/png;base64,${'a'.repeat(600_000)}` }]
  }))
  const messages = [...createPreparedProjectChunkMessages(project)]
  const nodeChunk = messages.find(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.chunk)
  assert.equal(nodeChunk.items.length, 1)
  assert.equal(nodeChunk.oversized, true)
  assert.ok(nodeChunk.estimatedBytes > PREPARED_PROJECT_CHUNK_MAX_ESTIMATED_BYTES)
})

test('rejects out-of-order prepared-project chunks', async () => {
  const source = validProject()
  const worker = {
    postMessage(request) {
      const prepared = executeProjectJsonOperation(request)
      const messages = [...createPreparedProjectChunkMessages(prepared)]
      const start = messages.find(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.start)
      const chunk = messages.find(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.chunk)
      queueMicrotask(() => {
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...chunk, sequence: 1 }) })
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  await assert.rejects(
    parser.parseAndPrepare(JSON.stringify(source)),
    error => error instanceof ProjectJsonParserProtocolError && /sequence/.test(error.message)
  )
  parser.dispose()
})

test('rejects completion before the declared prepared-project total arrives', async () => {
  const source = validProject()
  const worker = {
    postMessage(request) {
      const prepared = executeProjectJsonOperation(request)
      const messages = [...createPreparedProjectChunkMessages(prepared)]
      const start = messages.find(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.start)
      const complete = messages.find(message => message.kind === PREPARED_PROJECT_MESSAGE_KINDS.complete)
      queueMicrotask(() => {
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...complete, sequence: 0 }) })
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  await assert.rejects(
    parser.prepare(source),
    error => error instanceof ProjectJsonParserProtocolError && /before all chunks/.test(error.message)
  )
  parser.dispose()
})

test('rejects prepared-project completion totals that differ from the start message', async () => {
  const source = validProject()
  const worker = {
    postMessage(request) {
      const prepared = executeProjectJsonOperation(request)
      const messages = [...createPreparedProjectChunkMessages(prepared)]
      queueMicrotask(() => {
        for (const message of messages) {
          const response = message.kind === PREPARED_PROJECT_MESSAGE_KINDS.complete
            ? { ...message, counts: { ...message.counts, nodes: message.counts.nodes + 1 } }
            : message
          worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...response }) })
        }
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  await assert.rejects(
    parser.prepare(source),
    error => error instanceof ProjectJsonParserProtocolError && /totals do not match/.test(error.message)
  )
  parser.dispose()
})

test('falls back after a worker crash interrupts a chunked response', async () => {
  let terminated = false
  const source = validProject({ fileName: '', revision: 9 })
  const worker = {
    postMessage(request) {
      const prepared = executeProjectJsonOperation(request)
      const start = [...createPreparedProjectChunkMessages(prepared)][0]
      queueMicrotask(() => {
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        worker.onerror(new Error('worker crashed mid-stream'))
      })
    },
    terminate() { terminated = true }
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  assert.deepEqual(await parser.prepare(source, 'fallback'), prepareProject(source, 'fallback'))
  assert.equal(terminated, true)
  parser.dispose()
})

test('dispose rejects and clears a partially received prepared project', async () => {
  let started
  const startReceived = new Promise(resolve => { started = resolve })
  const worker = {
    postMessage(request) {
      const prepared = executeProjectJsonOperation(request)
      const start = [...createPreparedProjectChunkMessages(prepared)][0]
      queueMicrotask(() => {
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        started()
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const pending = parser.parseAndPrepare(JSON.stringify(validProject()))
  const rejected = assert.rejects(pending, ProjectJsonParserDisposedError)
  await startReceived
  parser.dispose()
  await rejected
})

test('preserves syntax and project validation errors returned by the worker', async () => {
  const parser = createProjectJsonParser({ workerFactory: () => operationWorker() })
  await assert.rejects(parser.parseAndPrepare('{'), SyntaxError)
  await assert.rejects(
    parser.prepare({ nodes: [] }),
    error => error instanceof ProjectValidationError && error.code === 'MISSING_COLLECTIONS'
  )
  parser.dispose()
})

test('falls back every pending operation when a later worker post fails', async () => {
  let postCount = 0
  let terminated = false
  const worker = {
    postMessage() {
      postCount += 1
      if (postCount === 2) throw new Error('worker channel closed')
    },
    terminate() { terminated = true }
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const firstSource = validProject({ fileName: '', revision: 1 })
  const secondSource = validProject({ fileName: '', revision: 2 })
  const first = parser.parseAndPrepare(JSON.stringify(firstSource), 'first')
  const second = parser.prepare(secondSource, 'second')

  assert.deepEqual(await Promise.all([first, second]), [
    prepareProject(firstSource, 'first'),
    prepareProject(secondSource, 'second')
  ])
  assert.equal(terminated, true)
  assert.deepEqual(await parser.parse('{"request":3}'), { request: 3 })
  parser.dispose()
})

test('falls back every pending operation after a worker crash', async () => {
  const worker = { postMessage() {}, terminate() {} }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const firstSource = validProject({ fileName: '', revision: 1 })
  const secondSource = validProject({ fileName: '', revision: 2 })
  const first = parser.prepare(firstSource, 'first')
  const second = parser.parseAndPrepare(JSON.stringify(secondSource), 'second')
  const header = parser.parseHeader(JSON.stringify({
    ...secondSource,
    updatedAt: '2026-08-03T00:00:00.000Z'
  }))
  worker.onerror(new Error('worker crashed'))
  assert.deepEqual(await Promise.all([first, second, header]), [
    prepareProject(firstSource, 'first'),
    prepareProject(secondSource, 'second'),
    { projectId: 'project-test', revision: 2, updatedAt: '2026-08-03T00:00:00.000Z' }
  ])
  parser.dispose()
})

test('dispose rejects pending worker requests and prevents reuse', async () => {
  let terminated = false
  const worker = { postMessage() {}, terminate() { terminated = true } }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const pending = [
    parser.parse('{"pending":true}'),
    parser.parseHeader(JSON.stringify(validProject())),
    parser.prepare(validProject()),
    parser.parseAndPrepare(JSON.stringify(validProject()))
  ]
  parser.dispose()

  const settled = await Promise.allSettled(pending)
  assert.ok(settled.every(result => result.status === 'rejected' && result.reason instanceof ProjectJsonParserDisposedError))
  await assert.rejects(parser.parse('{}'), ProjectJsonParserDisposedError)
  await assert.rejects(parser.parseHeader('{}'), ProjectJsonParserDisposedError)
  await assert.rejects(parser.prepare(validProject()), ProjectJsonParserDisposedError)
  await assert.rejects(parser.parseAndPrepare('{}'), ProjectJsonParserDisposedError)
  assert.equal(terminated, true)
})

test('dispose rejects worker-failure fallbacks after they leave the pending map', async () => {
  const worker = { postMessage() {}, terminate() {} }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const fallback = parser.parseAndPrepare(JSON.stringify(validProject()))

  worker.onerror(new Error('worker crashed'))
  parser.dispose()

  await assert.rejects(fallback, ProjectJsonParserDisposedError)
})

test('dispose gates current-thread fallback results', async () => {
  const parser = createProjectJsonParser({ workerFactory: () => null })
  const fallback = parser.prepare(validProject())

  parser.dispose()

  await assert.rejects(fallback, ProjectJsonParserDisposedError)
})

test('parses and prepares a multi-paper workspace in the worker without posting custom handles', async () => {
  const messages = []
  const responses = []
  const parser = createProjectJsonParser({ workerFactory: () => chunkedWorkspaceOperationWorker(messages, responses) })
  const customHandle = { kind: 'file', name: 'paper-a.json' }
  const first = validProject({ projectId: 'first', fileName: 'first' })
  const second = validProject({ projectId: 'second', fileName: 'second' })
  const snapshot = {
    version: 1,
    workspace: 'workspace-a',
    activeId: 'paper-b',
    sessions: [
      { id: 'paper-a', data: first, customHandle: null, history: [{ type: 'first' }], future: [] },
      { id: 'paper-b', data: second, customHandle: null, history: [], future: [{ type: 'second' }] }
    ]
  }

  const prepared = await parser.parseAndPrepareWorkspaceSession(
    workspaceSessionSource(snapshot, [customHandle], [['sessions', 0, 'customHandle']]),
    'workspace-a'
  )

  const expected = prepareWorkspaceSessionSnapshot(snapshot, 'workspace-a', data => prepareProject(data))
  expected.sessions[0].customHandle = customHandle
  assert.deepEqual(prepared, expected)
  assert.equal(prepared.sessions[0].customHandle, customHandle)
  assert.ok(messages[0].serialized instanceof Blob)
  assert.equal(Object.hasOwn(messages[0], 'customHandles'), false)
  assert.ok(responses.some(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.start))
  assert.ok(responses.some(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.complete))
  parser.dispose()
})

test('bounds workspace project and history chunks by item count and estimated bytes', async () => {
  const messages = []
  const responses = []
  const parser = createProjectJsonParser({ workerFactory: () => chunkedWorkspaceOperationWorker(messages, responses) })
  const snapshot = {
    version: 1,
    workspace: 'bounded',
    activeId: 'paper',
    sessions: [{
      id: 'paper',
      data: validProject({
        nodes: Array.from({ length: PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS * 2 + 3 }, (_, index) => ({
          id: `node-${index}`,
          type: 'rect',
          x: index,
          y: index,
          w: 20,
          h: 20
        }))
      }),
      customHandle: null,
      history: Array.from({ length: PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS + 2 }, (_, index) => ({ index })),
      future: []
    }]
  }

  await parser.parseAndPrepareWorkspaceSession(workspaceSessionSource(snapshot), 'bounded')
  const chunks = responses.filter(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.chunk)
  assert.ok(chunks.length >= 4)
  assert.deepEqual(chunks.map(message => message.sequence), chunks.map((_, index) => index))
  assert.ok(chunks.every(message => message.items.length <= PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ITEMS))
  assert.ok(chunks.every(message => (
    message.estimatedBytes <= PREPARED_WORKSPACE_SESSION_CHUNK_MAX_ESTIMATED_BYTES
    || (message.items.length === 1 && message.oversized === true)
  )))
  parser.dispose()
})

test('rejects out-of-order prepared workspace chunks without publishing a partial snapshot', async () => {
  const snapshot = {
    version: 1,
    workspace: 'out-of-order',
    activeId: 'paper',
    sessions: [{ id: 'paper', data: validProject(), history: [], future: [] }]
  }
  const worker = {
    postMessage(request) {
      queueMicrotask(async () => {
        const value = await executeWorkspaceSessionJsonOperation(request)
        const responses = [...createPreparedWorkspaceSessionChunkMessages(value)]
        const start = responses.find(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.start)
        const paperStart = responses.find(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.paperStart)
        const chunk = responses.find(message => message.kind === PREPARED_WORKSPACE_SESSION_MESSAGE_KINDS.chunk)
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...paperStart }) })
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...chunk, sequence: 1 }) })
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })

  await assert.rejects(
    parser.parseAndPrepareWorkspaceSession(workspaceSessionSource(snapshot), 'out-of-order'),
    error => error instanceof ProjectJsonParserProtocolError && /sequence/.test(error.message)
  )
  parser.dispose()
})

test('falls back safely when a worker crashes during workspace restoration', async () => {
  const snapshot = {
    version: 1,
    workspace: 'crash-fallback',
    activeId: 'paper',
    sessions: [{ id: 'paper', data: validProject(), history: [], future: [] }]
  }
  let terminated = false
  const worker = {
    postMessage(request) {
      queueMicrotask(() => worker.onerror(new Error(`worker crashed for ${request.id}`)))
    },
    terminate() { terminated = true }
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })

  const prepared = await parser.parseAndPrepareWorkspaceSession(workspaceSessionSource(snapshot), 'crash-fallback')
  assert.equal(prepared.activeId, 'paper')
  assert.equal(prepared.sessions[0].data.projectId, 'project-test')
  assert.equal(terminated, true)
  parser.dispose()
})

test('dispose rejects a partially received prepared workspace', async () => {
  const snapshot = {
    version: 1,
    workspace: 'dispose-workspace',
    activeId: 'paper',
    sessions: [{ id: 'paper', data: validProject(), history: [], future: [] }]
  }
  let started
  const startReceived = new Promise(resolve => { started = resolve })
  const worker = {
    postMessage(request) {
      queueMicrotask(async () => {
        const value = await executeWorkspaceSessionJsonOperation(request)
        const start = [...createPreparedWorkspaceSessionChunkMessages(value)][0]
        worker.onmessage({ data: structuredClone({ id: request.id, ok: true, ...start }) })
        started()
      })
    },
    terminate() {}
  }
  const parser = createProjectJsonParser({ workerFactory: () => worker })
  const pending = parser.parseAndPrepareWorkspaceSession(workspaceSessionSource(snapshot), 'dispose-workspace')
  const rejected = assert.rejects(pending, ProjectJsonParserDisposedError)
  await startReceived
  parser.dispose()
  await rejected
})
