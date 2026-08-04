import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  drawEdgeRasterBatch,
  drawEdgeRasterCommand,
  edgeRasterBatchTransferList,
  packEdgeRasterCommands
} from '../src/utils/edgeRasterDrawing.js'
import { createEdgeRasterWorkerClient } from '../src/utils/edgeRasterWorkerClient.js'

function recordingContext(initialState = {}) {
  const calls = []
  const context = new Proxy({ ...initialState, calls }, {
    set(target, key, value) {
      calls.push(['set', key, value])
      target[key] = value
      return true
    },
    get(target, key) {
      if (key in target) return target[key]
      return (...args) => calls.push([key, ...args])
    }
  })
  return context
}

function sampleCommands() {
  return [
    {
      startX: 1.25,
      startY: 2.5,
      endX: 31.75,
      endY: 42.125,
      color: 'rgba(10, 80, 220, .72)',
      lineWidth: 1.35,
      dash: true,
      startMarker: 'circle',
      endMarker: 'arrow',
      startMarkerSize: 8,
      endMarkerSize: 10,
      markerLineWidth: 2
    },
    {
      startX: 9,
      startY: 4,
      endX: 11,
      endY: 14,
      color: '#485563',
      lineWidth: 3,
      dash: false,
      startMarker: 'none',
      endMarker: 'square',
      startMarkerSize: 8,
      endMarkerSize: 8,
      markerLineWidth: 1
    }
  ]
}

test('typed edge batches replay the exact per-edge command sequence', () => {
  const commands = sampleCommands()
  const direct = recordingContext()
  const packed = recordingContext()
  for (const command of commands) drawEdgeRasterCommand(direct, command)
  const batch = packEdgeRasterCommands(commands)

  assert.equal(drawEdgeRasterBatch(packed, batch), commands.length)
  assert.deepEqual(packed.calls, direct.calls)
  assert.ok(direct.calls.some(call => call[0] === 'set' && call[1] === 'lineCap' && call[2] === 'round'))
  assert.ok(batch.geometry instanceof Float64Array)
  assert.ok(batch.flags instanceof Uint8Array)
  assert.ok(batch.colorIndexes instanceof Uint16Array)
  assert.deepEqual(edgeRasterBatchTransferList(batch), [
    batch.geometry.buffer,
    batch.flags.buffer,
    batch.colorIndexes.buffer
  ])
})

test('edge raster drawing restores the calling context line cap', () => {
  const context = recordingContext({ lineCap: 'square' })

  assert.equal(drawEdgeRasterCommand(context, sampleCommands()[0]), true)
  assert.equal(context.lineCap, 'square')
  assert.deepEqual(
    context.calls.filter(call => call[0] === 'set' && call[1] === 'lineCap').map(call => call[2]),
    ['round', 'square']
  )
})

class FakeWorker {
  constructor() {
    this.messages = []
    this.terminated = false
    this.onmessage = null
    this.onerror = null
    this.onmessageerror = null
  }

  postMessage(message, transfer) {
    this.messages.push({ message, transfer })
  }

  emit(message) {
    this.onmessage?.({ data: message })
  }

  terminate() {
    this.terminated = true
  }
}

test('edge worker requests transfer batches and complete with explicit bitmap ownership', () => {
  const worker = new FakeWorker()
  const client = createEdgeRasterWorkerClient({ workerFactory: () => worker })
  const request = client.start({ bitmapWidth: 100, bitmapHeight: 60 })
  const jobId = request.state.jobId
  assert.equal(request.state.status, 'starting')
  worker.emit({ type: 'ready', jobId })
  assert.equal(request.state.status, 'ready')

  const batch = packEdgeRasterCommands(sampleCommands())
  assert.equal(request.sendBatch(batch), true)
  assert.equal(request.state.status, 'batch')
  assert.deepEqual(worker.messages.at(-1).transfer, edgeRasterBatchTransferList(batch))
  worker.emit({ type: 'batch-complete', jobId })
  assert.equal(request.finish(), true)
  const bitmap = { closeCalls: 0, close() { this.closeCalls += 1 } }
  worker.emit({ type: 'complete', jobId, bitmap })
  assert.equal(request.state.status, 'complete')
  assert.equal(request.take(), bitmap)
  request.dispose()
  assert.equal(bitmap.closeCalls, 0)
  client.dispose()
  assert.equal(worker.terminated, true)
})

test('a superseded edge worker job closes its late bitmap and keeps the latest job active', () => {
  const worker = new FakeWorker()
  const client = createEdgeRasterWorkerClient({ workerFactory: () => worker })
  const first = client.start({ bitmapWidth: 10, bitmapHeight: 10 })
  const firstJobId = first.state.jobId
  worker.emit({ type: 'ready', jobId: firstJobId })
  const second = client.start({ bitmapWidth: 20, bitmapHeight: 20 })
  const secondJobId = second.state.jobId
  const late = { closed: 0, close() { this.closed += 1 } }

  worker.emit({ type: 'complete', jobId: firstJobId, bitmap: late })
  assert.equal(late.closed, 1)
  assert.equal(first.state.status, 'disposed')
  assert.equal(client.state.activeJobId, secondJobId)
  worker.emit({ type: 'ready', jobId: secondJobId })
  assert.equal(second.state.status, 'ready')
})

test('a worker fault disables future jobs so rendering can fall back to main-thread slices', () => {
  const worker = new FakeWorker()
  const client = createEdgeRasterWorkerClient({ workerFactory: () => worker })
  const request = client.start({ bitmapWidth: 10, bitmapHeight: 10 })
  worker.onerror?.(new Error('worker failed'))

  assert.equal(request.state.status, 'failed')
  assert.equal(client.state.unavailable, true)
  assert.equal(worker.terminated, true)
  assert.equal(client.start({ bitmapWidth: 10, bitmapHeight: 10 }), null)
})

test('a silent edge worker times out and enters the existing main-thread fallback state', () => {
  const worker = new FakeWorker()
  const timers = new Map()
  let nextTimerId = 1
  const client = createEdgeRasterWorkerClient({
    workerFactory: () => worker,
    responseTimeoutMs: 25,
    setTimer(callback) {
      const id = nextTimerId++
      timers.set(id, callback)
      return id
    },
    clearTimer(id) { timers.delete(id) }
  })
  const request = client.start({ bitmapWidth: 10, bitmapHeight: 10 })
  assert.equal(request.state.status, 'starting')
  assert.equal(timers.size, 1)

  timers.values().next().value()

  assert.equal(request.state.status, 'failed')
  assert.equal(client.state.unavailable, true)
  assert.equal(worker.terminated, true)
  assert.equal(timers.size, 0)
})

test('worker progress replaces the watchdog and completion clears it', () => {
  const worker = new FakeWorker()
  const timers = new Map()
  let nextTimerId = 1
  const client = createEdgeRasterWorkerClient({
    workerFactory: () => worker,
    responseTimeoutMs: 25,
    setTimer(callback) {
      const id = nextTimerId++
      timers.set(id, callback)
      return id
    },
    clearTimer(id) { timers.delete(id) }
  })
  const request = client.start({ bitmapWidth: 10, bitmapHeight: 10 })
  const jobId = request.state.jobId
  worker.emit({ type: 'ready', jobId })
  assert.equal(timers.size, 0)
  request.sendBatch(packEdgeRasterCommands(sampleCommands()))
  assert.equal(timers.size, 1)
  worker.emit({ type: 'batch-complete', jobId })
  assert.equal(timers.size, 0)
  request.finish()
  assert.equal(timers.size, 1)
  worker.emit({ type: 'complete', jobId, bitmap: { close() {} } })
  assert.equal(timers.size, 0)
  request.dispose()
})

test('large incremental edge frames and spatial edge queries use the worker with a lossless fallback', async () => {
  const component = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const worker = await readFile(new URL('../src/workers/edgeRaster.worker.js', import.meta.url), 'utf8')
  const task = component.match(/function createRenderTask\(payload, generation\)[\s\S]*?(?=\nfunction prepareNodeIndex)/)?.[0] || ''
  const workerBatch = component.match(/function prepareStaticEdgeWorkerBatch\(task, deadline\)[\s\S]*?(?=\nfunction awaitStaticEdgeWorkerBatch)/)?.[0] || ''
  const prepare = component.match(/function prepareStaticRenderSurface\(task\)[\s\S]*?(?=\nfunction drawStaticEdges)/)?.[0] || ''
  const staticEdges = component.match(/function drawStaticEdges\(task, deadline\)[\s\S]*?(?=\nfunction composeStaticRenderSurface)/)?.[0] || ''
  const fallback = component.match(/function fallbackStaticEdgeWorker\(task\)[\s\S]*?(?=\nfunction awaitStaticEdgeWorkerReady)/)?.[0] || ''
  const release = component.match(/function releaseRenderTask\([^)]*\)[\s\S]*?(?=\nfunction replaceCommittedStaticSurface)/)?.[0] || ''
  const commit = component.match(/function commitRenderTask\(task\)[\s\S]*?(?=\nfunction scheduleRender)/)?.[0] || ''
  const previewEdgeCanvas = app.match(/<MiniMapPreview[^>]*test-id="preview-edge-canvas"[^>]*\/>/)?.[0] || ''

  assert.match(component, /const EDGE_RASTER_WORKER_THRESHOLD = 2048/)
  assert.match(component, /const EDGE_RASTER_WORKER_BATCH_SIZE = 512/)
  assert.match(task, /edgeSourceCursor[\s\S]*?payload\.edgeSpatialIndex\?\.state\?\.entries/)
  assert.match(task, /payload\.incrementalRuntime[\s\S]*?edgeSourceCount >= EDGE_RASTER_WORKER_THRESHOLD/)
  assert.doesNotMatch(task, /!edgeSourceCursor/)
  assert.match(previewEdgeCanvas, /\bincremental-runtime\b/)
  assert.match(prepare, /edgeRasterWorkerClient\.start\([\s\S]*?task\.phase = 'awaitStaticEdgeWorkerReady'/)
  assert.match(workerBatch, /task\.edgeSourceCursor\.runSlice\(\{[\s\S]*?maxOperations: 256/)
  assert.match(workerBatch, /while \([\s\S]*?staticEdgeWorkerCommands\.length < EDGE_RASTER_WORKER_BATCH_SIZE[\s\S]*?!deadline\.shouldYield\(\)/)
  assert.match(workerBatch, /onMatch\(edge\)[\s\S]*?task\.edges\.push\(edge\)[\s\S]*?edgeRasterCommand\(edge/)
  assert.doesNotMatch(workerBatch, /drawEdge\(/)
  assert.match(workerBatch, /packEdgeRasterCommands\(task\.staticEdgeWorkerCommands\)[\s\S]*?request\.sendBatch\(batch\)/)
  assert.match(fallback, /staticEdgeWorkerRequest\?\.dispose\(\)[\s\S]*?task\.phase = 'staticEdges'/)
  assert.match(staticEdges, /task\.edgeSourceCursor[\s\S]*?task\.phase = 'edgeQuery'/)
  assert.match(release, /staticEdgeWorkerRequest\?\.dispose\(\)/)
  assert.match(commit, /retainIncrementalSurfaces = task\.incrementalRuntime[\s\S]*?task\.renderNodes[\s\S]*?task\.renderDrawings[\s\S]*?task\.geometryInteractive/)
  assert.match(commit, /retainIncrementalSurfaces && task\.staticSurface[\s\S]*?retainIncrementalSurfaces && task\.surface/)
  assert.match(worker, /new OffscreenCanvas\(bitmapWidth, bitmapHeight\)/)
  assert.match(worker, /drawEdgeRasterBatch\(job\.ctx, message\.batch\)/)
  assert.match(worker, /transferToImageBitmap\(\)[\s\S]*?postMessage\([^\n]*\[bitmap\]/)
  assert.doesNotMatch(component, /createImageBitmap|Path2D/)
})

test('a spatial worker failure replays collected edges before continuing the remaining cursor', async () => {
  const component = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const fallbackSource = component.match(/function fallbackStaticEdgeWorker\(task\)[\s\S]*?(?=\nfunction awaitStaticEdgeWorkerReady)/)?.[0] || ''
  const staticEdgesSource = component.match(/function drawStaticEdges\(task, deadline\)[\s\S]*?(?=\nfunction composeStaticRenderSurface)/)?.[0] || ''
  const querySource = component.match(/function queryAndDrawSpatialEdges\(task, deadline\)[\s\S]*?(?=\nfunction prepareFallbackEntities)/)?.[0] || ''
  const drawn = []
  const indexed = []
  const finishEdgePass = task => { task.phase = 'complete' }
  const indexTaskGeometryEntity = (_task, _kind, edge) => indexed.push(edge.id)
  const fallbackStaticEdgeWorker = Function(
    'resetTaskEdgeGeometryIndex',
    `return (${fallbackSource})`
  )(() => undefined)
  const drawStaticEdges = Function(
    'drawEdges',
    'finishEdgePass',
    `return (${staticEdgesSource})`
  )((_ctx, edges, startIndex) => {
    for (let index = startIndex; index < edges.length; index += 1) {
      drawn.push(edges[index].id)
      indexed.push(edges[index].id)
    }
    return edges.length
  }, finishEdgePass)
  const queryAndDrawSpatialEdges = Function(
    'drawEdge',
    'indexTaskGeometryEntity',
    'finishEdgePass',
    `return (${querySource})`
  )((_ctx, edge) => drawn.push(edge.id), indexTaskGeometryEntity, finishEdgePass)
  const remaining = [{ id: 'C' }]
  const task = {
    staticEdgeWorkerRequest: { dispose() {} },
    staticEdgeWorkerEligible: true,
    staticEdgeWorkerCommands: [{}],
    staticEdgeWorkerCursor: 2,
    staticEdgeCursor: 2,
    edgeSourceCursor: {
      runSlice({ onMatch }) {
        for (const edge of remaining) onMatch(edge)
        return { done: true }
      }
    },
    edges: [{ id: 'A' }, { id: 'B' }],
    staticCtx: {},
    ctx: {},
    incrementalRuntime: true,
    worldPixel: 1,
    nodeIndex: new Map(),
    phase: 'awaitStaticEdgeWorkerBatch'
  }
  const deadline = { shouldYield: () => false }

  assert.equal(fallbackStaticEdgeWorker(task), true)
  assert.equal(task.phase, 'staticEdges')
  assert.equal(drawStaticEdges(task, deadline), true)
  assert.equal(task.phase, 'edgeQuery')
  assert.equal(queryAndDrawSpatialEdges(task, deadline), true)
  assert.equal(task.phase, 'complete')
  assert.deepEqual(drawn, ['A', 'B', 'C'])
  assert.deepEqual(indexed, ['A', 'B', 'C'])
  assert.equal(new Set(drawn).size, 3)
})
