import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createDrawingRepository } from '../src/services/drawingRepository.js'
import { createDrawingMetadataCache } from '../src/services/drawingMetadataCache.js'
import {
  DrawingJsonFormatError,
  normalizeDrawingJsonError,
  parseDrawingJson
} from '../src/services/drawingJsonParser.js'
import {
  DEFAULT_DRAWING_REQUEST_LIMIT_BYTES,
  DRAWING_REQUEST_LIMIT_ENV,
  DrawingRequestError,
  MAX_DRAWING_REQUEST_LIMIT_BYTES,
  readBoundedRequestBody,
  resolveDrawingRequestLimit
} from '../src/services/drawingRequestBody.js'
import { verifyDrawingSave } from '../src/services/drawingSaveVerification.js'
import { ApiRequestError, buildApiUrl, createHttpClient } from '../src/services/httpClient.js'
import { createLocalRuntimeGateway, normalizeRuntimeUpdates } from '../src/services/runtimeGateway.js'
import { createTimeService } from '../src/services/timeService.js'
import { allocateLegacyDrawingNodeIds } from '../src/utils/legacyDrawingIds.js'
import { MAX_POLYLINE_NODE_POINTS } from '../src/utils/polylineGeometry.js'
import {
  countProjectCapacity,
  PROJECT_CAPACITY_LIMITS,
  ProjectValidationError,
  validateProjectForFrontend
} from '../src/utils/projectValidation.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const projectPreparationSource = readFileSync(new URL('../src/utils/projectPreparation.js', import.meta.url), 'utf8')
const requestBodySource = readFileSync(new URL('../src/services/drawingRequestBody.js', import.meta.url), 'utf8')
const viteConfigSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  })
}

test('joins configurable API bases without changing absolute or same-origin paths', () => {
  assert.equal(buildApiUrl('', '/api/drawings'), '/api/drawings')
  assert.equal(buildApiUrl('/backend/', 'api/drawings'), '/backend/api/drawings')
  assert.equal(buildApiUrl('https://api.example.test/root/', '/api/time'), 'https://api.example.test/root/api/time')
  assert.equal(buildApiUrl('/ignored', 'https://other.example.test/health'), 'https://other.example.test/health')
})

test('parses JSON success and converts JSON HTTP failures into one error type', async () => {
  const requests = []
  const client = createHttpClient({
    baseUrl: '/backend',
    getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      if (url.endsWith('/failure')) return jsonResponse({ message: '版本冲突' }, { status: 409 })
      return jsonResponse({ ok: true })
    }
  })

  const success = await client.request('/success')
  assert.deepEqual(success.data, { ok: true })
  assert.equal(requests[0].url, '/backend/success')
  assert.equal(requests[0].options.headers.get('authorization'), 'Bearer test-token')
  await assert.rejects(client.request('/failure'), error => (
    error instanceof ApiRequestError && error.status === 409 && error.code === 'HTTP_ERROR' && error.message === '版本冲突'
  ))
})

test('distinguishes invalid JSON, timeout, and network errors', async () => {
  const invalidClient = createHttpClient({ fetchImpl: async () => new Response('{broken', { status: 200 }) })
  await assert.rejects(invalidClient.request('/invalid'), error => error.code === 'INVALID_RESPONSE')

  const timeoutClient = createHttpClient({
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  })
  await assert.rejects(timeoutClient.request('/slow'), error => error.code === 'REQUEST_TIMEOUT')

  const networkClient = createHttpClient({ fetchImpl: async () => { throw new TypeError('offline') } })
  await assert.rejects(networkClient.request('/offline'), error => error.code === 'NETWORK_ERROR')
})

test('drawing repository preserves encoded names, response ETags, and local list shape', async () => {
  const requests = []
  const client = createHttpClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      if (url === '/api/drawings') return jsonResponse({ directory: '图纸库', files: [{ name: '一号.json' }] })
      return new Response('{"nodes":[],"edges":[],"drawings":[]}', { status: 200, headers: { ETag: '"v1"' } })
    }
  })
  const repository = createDrawingRepository(client)
  assert.deepEqual(await repository.list({ workspaceId: 'workspace-a', projectId: 'project-a', revision: 7 }), {
    directory: '图纸库', files: [{ name: '一号.json' }], caseSensitiveNames: true
  })
  assert.deepEqual(await repository.get('一号 图纸.json', { workspaceId: 'workspace-a' }), {
    serialized: '{"nodes":[],"edges":[],"drawings":[]}', etag: '"v1"'
  })
  assert.equal(requests[1].url, `/api/drawings/${encodeURIComponent('一号 图纸.json')}`)
  assert.doesNotMatch(requests[1].url, /workspace-a|project-a|revision/u)
})

test('drawing repository sends optimistic-lock headers and can probe the real file state', async () => {
  const requests = []
  const repository = createDrawingRepository(createHttpClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return jsonResponse({ name: '图纸.json', size: 10 }, { headers: { ETag: '"next"' } })
    }
  }))

  const created = await repository.save('图纸.json', '{}', { create: true, context: { workspaceId: 'ignored' } })
  const updated = await repository.save('图纸.json', '{}', { etag: '"current"' })
  await repository.delete('图纸.json', '"next"', { revision: 99 })
  assert.equal(await repository.exists('图纸.json'), true)

  assert.equal(created.etag, '"next"')
  assert.equal(updated.etag, '"next"')
  assert.equal(requests[0].options.method, 'PUT')
  assert.equal(requests[0].options.headers.get('if-none-match'), '*')
  assert.equal(requests[0].options.headers.has('if-match'), false)
  assert.equal(requests[1].options.headers.get('if-match'), '"current"')
  assert.equal(requests[2].options.method, 'DELETE')
  assert.equal(requests[2].options.headers.get('if-match'), '"next"')
  assert.equal(requests[3].options.method, 'HEAD')
  assert.ok(requests.every(request => !request.url.includes('ignored') && !request.url.includes('99')))
})

test('drawing repository reports a confirmed missing file without hiding probe failures', async () => {
  const repository = createDrawingRepository(createHttpClient({
    fetchImpl: async url => new Response(
      JSON.stringify({ error: url.includes('missing') ? '图纸文件不存在' : '图纸文件服务异常' }),
      { status: url.includes('missing') ? 404 : 503, headers: { 'Content-Type': 'application/json' } }
    )
  }))

  assert.equal(await repository.exists('missing.json'), false)
  await assert.rejects(repository.exists('unavailable.json'), error => error?.status === 503)
})

test('drawing repository does not impose a fixed timeout on large file transfers', async () => {
  const requests = []
  const client = {
    async request(path, options = {}) {
      requests.push({ path, options })
      if (path === '/api/drawings') return { data: { directory: '图纸库', files: [] }, headers: new Headers() }
      if (options.method === 'PUT') return { data: { size: options.body.length }, headers: new Headers() }
      return { data: '{"nodes":[],"edges":[],"drawings":[]}', headers: new Headers() }
    }
  }
  const repository = createDrawingRepository(client)

  await repository.list()
  await repository.get('大图纸.json')
  await repository.save('大图纸.json', '{"nodes":[],"edges":[],"drawings":[]}', { create: true })
  await repository.delete('大图纸.json', '"current"')
  await repository.exists('大图纸.json')

  assert.deepEqual(requests.map(request => request.options.timeoutMs), [0, 0, 0, 0, 0])
})

test('drawing deletion isolates and revalidates the exact file before unlinking it', () => {
  const start = viteConfigSource.indexOf('async function deleteDrawing(')
  const end = viteConfigSource.indexOf('\nasync function handleDrawingApi(', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const deletion = viteConfigSource.slice(start, end)

  assert.match(deletion, /drawingMetadataCache\.getOrLoad\(name, fileStat/)
  assert.match(deletion, /await rename\(target, quarantine\)/)
  assert.match(deletion, /sameFileIdentity\(current\.fileStat, isolatedStat\)/)
  assert.match(deletion, /await unlink\(quarantine\)/)
  assert.match(deletion, /restoreQuarantinedDrawing\(quarantine, target, name\)/)
  assert.doesNotMatch(deletion, /await unlink\(target\)/)
})

test('build cleanup uses the resolved output directory once and rejects paths outside the project root', () => {
  const start = viteConfigSource.indexOf('function assertProjectBuildOutputPath(')
  const end = viteConfigSource.indexOf('\nfunction drawingFilesPlugin(', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const cleanup = viteConfigSource.slice(start, end)

  assert.match(cleanup, /configResolved\(config\)[\s\S]*?resolveBuildOutputDirectory\(config\)/u)
  assert.match(cleanup, /config\?\.build\?\.outDir/u)
  assert.match(cleanup, /relative\(PROJECT_ROOT, outputDirectory\)/u)
  assert.match(cleanup, /!relativePath[\s\S]*?isAbsolute\(relativePath\)[\s\S]*?relativePath === '\.\.'[\s\S]*?relativePath\.startsWith\(`\.\.\$\{sep\}`\)/u)
  assert.match(cleanup, /realpath\(PROJECT_ROOT\)[\s\S]*?nearestExistingRealPath\(outputDirectory\)/u)
  assert.match(cleanup, /if \(!cleanupPromise\) cleanupPromise = cleanBuildOutputDirectory\(outputDirectory\)[\s\S]*?await cleanupPromise/u)
  assert.match(cleanup, /await rm\(outputDirectory, \{[\s\S]*?recursive: true,[\s\S]*?force: true/u)
  assert.match(viteConfigSource, /plugins: \[vue\(\), cleanBuildOutputPlugin\(\), drawingFilesPlugin\(\)\]/u)
  assert.match(viteConfigSource, /build: \{[\s\S]*?emptyOutDir: true/u)
})

test('shares frontend project capacity accounting and accepts legacy drawing node references', () => {
  const project = {
    nodes: [
      { id: 'node-a', type: 'pencil', pencilPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 'node-b', type: 'polyline', polylinePoints: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] }
    ],
    edges: [{ id: 'edge-a', from: 'node-a', to: 'pencil-legacy' }],
    drawings: [{ id: 'legacy', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }],
    customComponents: [{
      id: 'custom-a',
      nodes: [
        { id: 'custom-pencil', type: 'pencil', x: 0, y: 0, w: 10, h: 10, pencilPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        { id: 'custom-polyline', type: 'polyline', x: 10, y: 0, w: 10, h: 10, polylinePoints: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] }
      ],
      edges: []
    }]
  }
  assert.deepEqual(countProjectCapacity(project), {
    nodeCount: 2,
    edgeCount: 1,
    drawingCount: 1,
    entityCount: 3,
    drawingPointCount: 4,
    pencilPointCount: 2,
    polylinePointCount: 3,
    customComponentPencilPointCount: 2,
    customComponentPolylinePointCount: 3,
    customComponentPathPointCount: 5,
    pathPointCount: 14,
    customComponentCount: 1,
    customComponentNodeCount: 2,
    customComponentEdgeCount: 0
  })
  assert.equal(validateProjectForFrontend(project).pathPointCount, 14)
  assert.throws(
    () => validateProjectForFrontend(project, { ...PROJECT_CAPACITY_LIMITS, pathPoints: 13 }),
    error => error instanceof ProjectValidationError && error.code === 'PROJECT_TOO_LARGE'
  )
  assert.throws(
    () => validateProjectForFrontend(project, { ...PROJECT_CAPACITY_LIMITS, entities: 2 }),
    error => error instanceof ProjectValidationError && error.code === 'PROJECT_TOO_LARGE'
  )

  assert.match(appSource, /import \{ PROJECT_CAPACITY_LIMITS \} from '\.\/utils\/projectValidation'/u)
  assert.match(projectPreparationSource, /import \{ PROJECT_CAPACITY_LIMITS, validateProjectForFrontend \} from '\.\/projectValidation\.js'/u)
  assert.match(projectPreparationSource, /export function prepareProject\(data,[\s\S]*?validateProjectForFrontend\(data\)/u)
  for (const [constant, name] of [
    ['MAX_PROJECT_NODES', 'entities'],
    ['MAX_PROJECT_EDGES', 'edges'],
    ['MAX_PROJECT_DRAWINGS', 'drawings'],
    ['MAX_CUSTOM_COMPONENTS', 'customComponents'],
    ['MAX_CUSTOM_COMPONENT_NODES', 'customComponentNodes'],
    ['MAX_CUSTOM_COMPONENT_EDGES', 'customComponentEdges']
  ]) {
    assert.match(appSource, new RegExp(`const ${constant} = PROJECT_CAPACITY_LIMITS\\.${name}`), constant)
  }
})

test('rejects IDs, references, and custom component counts that the frontend cannot open', () => {
  const base = { nodes: [{ id: 'node-a' }], edges: [], drawings: [] }
  assert.throws(
    () => validateProjectForFrontend({ ...base, nodes: [{ id: 'same' }, { id: 'same' }] }),
    error => error instanceof ProjectValidationError && error.code === 'INVALID_ID'
  )
  assert.throws(
    () => validateProjectForFrontend({ ...base, edges: [{ id: 'edge-a', from: 'node-a', to: 'missing' }] }),
    error => error instanceof ProjectValidationError && error.code === 'INVALID_EDGE_ENDPOINT'
  )
  const customComponents = Array.from({ length: PROJECT_CAPACITY_LIMITS.customComponents + 1 }, (_, index) => ({
    id: `custom-${index}`,
    nodes: [{ id: `node-${index}`, x: 0, y: 0, w: 10, h: 10 }],
    edges: []
  }))
  assert.throws(
    () => validateProjectForFrontend({ ...base, customComponents }),
    error => error instanceof ProjectValidationError && error.code === 'CUSTOM_COMPONENTS_TOO_LARGE'
  )
  assert.throws(
    () => validateProjectForFrontend({
      ...base,
      customComponents: [{ id: 'invalid-geometry', nodes: [{ id: 'custom-node', x: 0, y: 0, w: 0, h: 10 }], edges: [] }]
    }),
    error => error instanceof ProjectValidationError && error.code === 'INVALID_CUSTOM_COMPONENT_GEOMETRY'
  )
  assert.doesNotThrow(() => validateProjectForFrontend({
    ...base,
    version: 19,
    customComponents: [{ id: 'legacy-line', nodes: [{ id: 'line', type: 'lineShape', x: 0, y: 0, w: 10, h: 0 }], edges: [] }]
  }))

  const excessivePolylinePoints = Array.from({ length: MAX_POLYLINE_NODE_POINTS + 1 }, () => ({ x: 0, y: 0 }))
  assert.equal(PROJECT_CAPACITY_LIMITS.polylineNodePoints, MAX_POLYLINE_NODE_POINTS)
  assert.throws(
    () => validateProjectForFrontend({
      nodes: [{ id: 'polyline', type: 'polyline', polylinePoints: excessivePolylinePoints }],
      edges: [],
      drawings: []
    }),
    error => error instanceof ProjectValidationError && error.code === 'PROJECT_TOO_LARGE'
  )
  assert.throws(
    () => validateProjectForFrontend({
      ...base,
      customComponents: [{
        id: 'custom-polyline',
        nodes: [{ id: 'template-polyline', type: 'polyline', x: 0, y: 0, w: 10, h: 10, polylinePoints: excessivePolylinePoints }],
        edges: []
      }]
    }),
    error => error instanceof ProjectValidationError && error.code === 'PROJECT_TOO_LARGE'
  )
})

test('allocates colliding legacy drawing node IDs in linear time without changing IDs', () => {
  function referenceAllocator(drawings, nodes) {
    const usedIds = new Set(nodes.map(node => node.id))
    return drawings.map((drawing, index) => {
      const rawId = String(drawing?.id ?? index + 1).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96) || `${index + 1}`
      let id = `pencil-${rawId}`
      let suffix = 2
      while (usedIds.has(id)) id = `pencil-${rawId}-${suffix++}`
      usedIds.add(id)
      return id
    })
  }

  const sampleNodes = [
    { id: 'pencil-same' },
    { id: 'pencil-same-2' },
    { id: 'pencil-same-4' },
    { id: 'pencil-same-2-2' }
  ]
  const sampleDrawings = [
    { id: 'same' },
    { id: 'same' },
    { id: 'same-2' },
    { id: 'same' },
    { id: '../../same' },
    { id: '' },
    {}
  ]
  assert.deepEqual(
    allocateLegacyDrawingNodeIds(sampleDrawings, sampleNodes),
    referenceAllocator(sampleDrawings, sampleNodes)
  )

  const collisionNodes = Array.from({ length: 5000 }, (_, index) => ({
    id: index === 0 ? 'pencil-collision' : `pencil-collision-${index + 1}`
  }))
  const collisionDrawings = Array.from({ length: 5000 }, () => ({
    id: 'collision',
    points: [{ x: 0, y: 0 }]
  }))
  const startedAt = performance.now()
  const ids = allocateLegacyDrawingNodeIds(collisionDrawings, collisionNodes)
  const capacity = validateProjectForFrontend({ nodes: collisionNodes, edges: [], drawings: collisionDrawings })
  const elapsedMs = performance.now() - startedAt

  assert.equal(ids[0], 'pencil-collision-5001')
  assert.equal(ids.at(-1), 'pencil-collision-10000')
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(capacity.entityCount, 10000)
  assert.ok(elapsedMs < 1500, `legacy drawing allocation and validation took ${elapsedMs.toFixed(1)}ms`)
})

test('uses a configurable 256 MiB request limit by default', () => {
  assert.equal(DEFAULT_DRAWING_REQUEST_LIMIT_BYTES, 256 * 1024 * 1024)
  assert.equal(resolveDrawingRequestLimit({}), DEFAULT_DRAWING_REQUEST_LIMIT_BYTES)
  assert.equal(resolveDrawingRequestLimit({ [DRAWING_REQUEST_LIMIT_ENV]: '4096' }), 4096)
  assert.throws(() => resolveDrawingRequestLimit({ [DRAWING_REQUEST_LIMIT_ENV]: '4MiB' }), TypeError)
  assert.throws(
    () => resolveDrawingRequestLimit({ [DRAWING_REQUEST_LIMIT_ENV]: String(MAX_DRAWING_REQUEST_LIMIT_BYTES + 1) }),
    TypeError
  )
})

test('request body reader avoids concat peaks and rejects false declared lengths', async () => {
  assert.doesNotMatch(requestBodySource, /Buffer\.concat|const chunks/u)
  assert.match(requestBodySource, /\{ allocate = Buffer\.allocUnsafe \}[\s\S]*?declaredBytes == null[\s\S]*?allocate\(initialCapacity\)/u)

  const request = new PassThrough()
  request.headers = { 'content-length': '3' }
  const reading = readBoundedRequestBody(request, 1024, 3)
  request.end(Buffer.from('{}'))
  await assert.rejects(reading, error => error instanceof DrawingRequestError && error.status === 400)

  const initialAllocationRequest = new PassThrough()
  initialAllocationRequest.headers = { 'content-length': '8' }
  await assert.rejects(
    readBoundedRequestBody(initialAllocationRequest, 1024, 8, { allocate() { throw new RangeError('allocation failed') } }),
    error => error instanceof DrawingRequestError && error.status === 413
  )

  const growthAllocationRequest = new PassThrough()
  growthAllocationRequest.headers = {}
  let allocationCount = 0
  const growthReading = readBoundedRequestBody(growthAllocationRequest, 128 * 1024, null, {
    allocate(size) {
      allocationCount += 1
      if (allocationCount > 1) throw new RangeError('growth failed')
      return Buffer.allocUnsafe(size)
    }
  })
  growthAllocationRequest.end(Buffer.alloc(64 * 1024 + 1))
  await assert.rejects(growthReading, error => error instanceof DrawingRequestError && error.status === 413)
})

test('drawing metadata cache hits unchanged stat signatures and reloads external changes', async () => {
  const cache = createDrawingMetadataCache()
  const originalStat = { dev: 1, ino: 2, mode: 0o100600, size: 36 * 1024 * 1024, mtimeMs: 10, ctimeMs: 11, birthtimeMs: 1 }
  let loads = 0
  const load = async () => ({ etag: `"load-${++loads}"` })

  const first = await cache.getOrLoad('large.json', originalStat, load)
  const second = await cache.getOrLoad('large.json', { ...originalStat }, load)
  assert.strictEqual(second, first)
  assert.equal(loads, 1)
  assert.deepEqual(cache.stats, { entries: 1, hits: 1, misses: 1 })

  const externallyChanged = await cache.getOrLoad('large.json', { ...originalStat, size: originalStat.size + 1, ctimeMs: 12 }, load)
  assert.equal(externallyChanged.etag, '"load-2"')
  cache.set('large.json', { ...originalStat, mtimeMs: 20, ctimeMs: 20 }, { etag: '"saved"' })
  assert.equal((await cache.getOrLoad('large.json', { ...originalStat, mtimeMs: 20, ctimeMs: 20 }, load)).etag, '"saved"')
  cache.invalidate('large.json')
  await cache.getOrLoad('large.json', originalStat, load)
  assert.equal(loads, 3)

  let invalidLoads = 0
  const invalidError = Object.assign(new Error('invalid drawing'), { status: 422 })
  const negativeCache = createDrawingMetadataCache({ shouldCacheError: error => error?.status === 422 })
  const loadInvalid = async () => {
    invalidLoads += 1
    throw invalidError
  }
  await assert.rejects(negativeCache.getOrLoad('invalid.json', originalStat, loadInvalid), invalidError)
  await assert.rejects(negativeCache.getOrLoad('invalid.json', originalStat, loadInvalid), invalidError)
  assert.equal(invalidLoads, 1)
  await assert.rejects(
    negativeCache.getOrLoad('invalid.json', { ...originalStat, ctimeMs: 13 }, loadInvalid),
    invalidError
  )
  assert.equal(invalidLoads, 2)

  let transientLoads = 0
  const transientCache = createDrawingMetadataCache({ shouldCacheError: error => error?.status === 422 })
  const loadTransient = async () => {
    transientLoads += 1
    throw Object.assign(new Error('changed during read'), { status: 409 })
  }
  await assert.rejects(transientCache.getOrLoad('changing.json', originalStat, loadTransient))
  await assert.rejects(transientCache.getOrLoad('changing.json', originalStat, loadTransient))
  assert.equal(transientLoads, 2)
})

test('drawing JSON parsing distinguishes stable format errors from transient failures', () => {
  assert.deepEqual(parseDrawingJson(Buffer.from('\ufeff{"nodes":[]}')), { nodes: [] })
  assert.throws(() => parseDrawingJson(Buffer.from('{')), DrawingJsonFormatError)
  assert.throws(() => parseDrawingJson(Buffer.from([0xff])), DrawingJsonFormatError)

  const allocationFailure = new RangeError('string allocation failed')
  assert.strictEqual(normalizeDrawingJsonError(allocationFailure), allocationFailure)
  const unexpectedTypeError = new TypeError('decoder unavailable')
  assert.strictEqual(normalizeDrawingJsonError(unexpectedTypeError), unexpectedTypeError)
})

test('verifies saved content without leaving a positive metadata cache race', async () => {
  const expectedEtag = '"request"'
  const requestStat = { mtime: new Date('2026-01-01T00:00:00.000Z') }
  const externalStat = { mtime: new Date('2026-01-02T00:00:00.000Z') }
  const calls = { sets: [], invalidations: [] }
  const metadataCache = {
    set(...args) { calls.sets.push(args) },
    invalidate(name) { calls.invalidations.push(name) }
  }

  const conflict = await verifyDrawingSave({
    name: 'race.json',
    expectedEtag,
    loadCurrent: async () => ({ buffer: Buffer.from('external'), fileStat: externalStat, etag: '"external"' }),
    metadataCache
  })
  assert.equal(conflict, null)
  assert.deepEqual(calls.sets, [])
  assert.deepEqual(calls.invalidations, ['race.json', 'race.json'])

  const verified = await verifyDrawingSave({
    name: 'race.json',
    expectedEtag,
    loadCurrent: async () => ({ buffer: Buffer.from('request'), fileStat: requestStat, etag: expectedEtag }),
    metadataCache
  })
  assert.deepEqual(verified, {
    name: 'race.json',
    size: 7,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    etag: expectedEtag
  })
  assert.deepEqual(calls.sets, [])

  await assert.rejects(verifyDrawingSave({
    name: 'unstable.json',
    expectedEtag,
    loadCurrent: async () => { throw Object.assign(new Error('changed'), { status: 409 }) },
    metadataCache
  }))
  assert.deepEqual(calls.invalidations, [
    'race.json', 'race.json',
    'race.json', 'race.json',
    'unstable.json', 'unstable.json'
  ])
})

test('time service validates server time and returns an explicit local fallback', async () => {
  const serverTime = createTimeService(createHttpClient({ fetchImpl: async () => jsonResponse({ now: 1234, iso: 'test' }) }))
  assert.deepEqual(await serverTime.current(), { now: 1234, iso: 'test', source: 'server', error: null })

  const localTime = createTimeService(createHttpClient({ fetchImpl: async () => jsonResponse({ now: 'invalid' }) }))
  const fallback = await localTime.current()
  assert.equal(fallback.source, 'local')
  assert.equal(Number.isFinite(fallback.now), true)
  assert.ok(fallback.error instanceof Error)
})

test('runtime gateway normalizes every payload to keyed updates and batches through one subscription', async () => {
  assert.deepEqual(normalizeRuntimeUpdates({ values: [{ key: 'speed', value: 1 }, { key: 'speed', value: 2 }] }), [{ key: 'speed', value: 2 }])
  assert.deepEqual(normalizeRuntimeUpdates({ pressure: 3, enabled: false }), [{ key: 'pressure', value: 3 }, { key: 'enabled', value: false }])
  assert.deepEqual(normalizeRuntimeUpdates(null), [])

  let scheduled
  let cancelled = false
  const batches = []
  const gateway = createLocalRuntimeGateway({
    random: () => 0.42,
    schedule: callback => { scheduled = callback; return 7 },
    cancel: id => { cancelled = id === 7 }
  })
  const unsubscribe = gateway.subscribe(updates => batches.push(updates))
  const connection = await gateway.connect({ protocol: 'MQTT', url: 'mqtt://local', getKeys: () => ['speed', 'speed', ''] })
  scheduled()
  gateway.send({ key: 'manual', value: 9 })
  gateway.disconnect()
  unsubscribe()

  assert.equal(connection.adapter, 'local-simulator')
  assert.deepEqual(batches, [[{ key: 'speed', value: 42 }], [{ key: 'manual', value: 9 }]])
  assert.equal(cancelled, true)
  assert.equal(gateway.connected, false)
})

test('App delegates backend concerns and keeps browser file access as a separate path', () => {
  assert.match(appSource, /drawingRepository\.list\(backendRequestContext\(\)\)/)
  assert.match(appSource, /drawingRepository\.save\([\s\S]*context: backendRequestContext\(\)/)
  assert.match(appSource, /pointCatalogGateway\.listPoints\(\)/)
  assert.match(appSource, /runtimeGateway\.send\(/)
  assert.match(appSource, /operationGateway\.record\('document\.change'/)
  assert.doesNotMatch(appSource, /fetch\(\s*['"`]\/api\/(?:drawings|time)/)
  assert.match(appSource, /window\.showOpenFilePicker/)
  assert.match(appSource, /window\.showSaveFilePicker/)
})
