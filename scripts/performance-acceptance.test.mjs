import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { useRuntimeData } from '../src/composables/useRuntimeData.js'
import { createDataKeyIndex, createLayerAllocator } from '../src/utils/documentIndexes.js'
import { createSpatialIndex } from '../src/utils/spatialIndex.js'
import { normalizeRuntimeUpdates } from '../src/services/runtimeGateway.js'
import { createLocalPointCatalogGateway } from '../src/services/pointCatalogGateway.js'
import { createSourceBindingRuntime } from '../src/services/sourceBindingRuntime.js'
import {
  createRuntimeCanvasDirtyQueue,
  DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE
} from '../src/utils/runtimeCanvasDirtyQueue.js'
import { createBrowserPerformanceProbe, summarizeDurations } from './browser-performance-probe.mjs'

const LARGE_RUNTIME_KEY_COUNT = 6_016
const FRAME_ITEM_LIMIT = 256
const FRAME_BUDGET_MS = 16.7
const PRODUCTION_RUNTIME_SLICE_MS = 2
const VISIBLE_RUNTIME_KEY_COUNT = 406

function createRuntimeNodes(count = LARGE_RUNTIME_KEY_COUNT) {
  const columns = 80
  return Array.from({ length: count }, (_, index) => ({
    id: `runtime-node-${index}`,
    layer: index + 1,
    x: (index % columns) * 112,
    y: Math.floor(index / columns) * 78,
    w: 88,
    h: 54,
    dataKey: `runtime.${index}`
  }))
}

function createManualScheduler() {
  let nextHandle = 1
  const callbacks = new Map()

  return {
    schedule(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancel(handle) {
      callbacks.delete(handle)
    },
    flushOne() {
      const entry = callbacks.entries().next().value
      if (!entry) return false
      const [handle, callback] = entry
      callbacks.delete(handle)
      callback(0)
      return true
    },
    get size() { return callbacks.size }
  }
}

function createRuntimeStore(options = {}) {
  const scheduler = createManualScheduler()
  const store = useRuntimeData({
    scheduler,
    now: () => 0,
    frameBudgetMs: 100,
    maxUpdatesPerFrame: FRAME_ITEM_LIMIT,
    ...options
  })
  return { scheduler, store }
}

test('100k-point source metadata, query slices and connection tests stay inside one frame', async t => {
  const pointCount = 100_000
  const largeSnapshotPayload = {
    rows: Array.from({ length: 250_000 }, (_, index) => index)
  }
  let savedSource = null
  let saveOptions = null
  const catalogEvents = []
  const gateway = createLocalPointCatalogGateway({
    store: {
      async saveSource(workspaceId, source, options) {
        assert.equal(workspaceId, 'default')
        savedSource = source
        saveOptions = options
        return { durable: true, mode: 'durable', reason: '' }
      }
    },
    sources: [{
      id: 'performance-large-source',
      name: '性能目录',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: Array.from({ length: pointCount }, (_, index) => ({
        id: `performance.point.${index}`,
        name: `性能点位 ${index}`,
        group: `分组 ${index % 20}`,
        type: 'number',
        value: index,
        status: 'good'
      }))
    }]
  })
  gateway.subscribe(event => catalogEvents.push(event))

  const metadataSamples = []
  const pageSamples = []
  let cursor = null
  for (let index = 0; index < 24; index += 1) {
    let startedAt = performance.now()
    const metadata = await gateway.getSource('performance-large-source', { includePoints: false })
    metadataSamples.push(performance.now() - startedAt)
    assert.equal(metadata.pointCount, pointCount)
    assert.equal(Object.hasOwn(metadata, 'points'), false)

    startedAt = performance.now()
    const page = await gateway.querySourcePoints({
      sourceId: 'performance-large-source',
      query: '不存在的目标',
      cursor,
      limit: 50,
      includeUnavailable: true
    })
    pageSamples.push(performance.now() - startedAt)
    assert.ok(page.scanned <= 512)
    cursor = page.nextCursor
  }

  const metadataTiming = summarizeDurations(metadataSamples.slice(4))
  const pageTiming = summarizeDurations(pageSamples.slice(4))
  // 连接测试只切换质量状态，不得复制网关已经持有的大响应正文。
  gateway.ingestSourceSnapshot(
    'performance-large-source',
    largeSnapshotPayload,
    { quality: 'good' },
    { takeOwnership: true, sharedResult: true }
  )
  const testStartedAt = performance.now()
  const tested = await gateway.testSource('performance-large-source', { includePoints: false })
  const connectionTestMs = performance.now() - testStartedAt
  t.diagnostic(JSON.stringify({ pointCount, metadataMs: metadataTiming, querySliceMs: pageTiming, connectionTestMs }))
  assert.ok(metadataTiming.p95 < FRAME_BUDGET_MS)
  assert.ok(pageTiming.p95 < FRAME_BUDGET_MS)
  assert.ok(connectionTestMs < FRAME_BUDGET_MS, `100k point connection test took ${connectionTestMs.toFixed(1)}ms`)
  assert.equal(tested.ok, true)
  assert.equal(tested.source.pointCount, pointCount)
  assert.equal(savedSource.points.length, pointCount)
  assert.equal(saveOptions.pointsChanged, false)
  assert.deepEqual(catalogEvents.map(event => event.type), ['source-testing', 'source-tested'])
  assert.ok(catalogEvents.every(event => event.catalogChanged === false))
  assert.ok(catalogEvents.every(event => event.pointIdsOmitted === false))
  assert.ok(catalogEvents.every(event => event.invalidatedPointIds.length === 0))
  assert.ok(catalogEvents.every(event => event.availablePointIds.length === 0))
  assert.ok(catalogEvents.every(event => event.changedSourceIds[0] === 'performance-large-source'))
  assert.strictEqual(
    (await gateway.getSourceSnapshot('performance-large-source', { shared: true })).data,
    largeSnapshotPayload
  )
})

test('100k-point workspace activation builds private catalog indexes in frame-bounded slices', async t => {
  const pointCount = 100_000
  const scheduler = createManualScheduler()
  const sliceSamples = []
  const points = Array.from({ length: pointCount }, (_, index) => ({
    id: `activation.point.${index}`,
    name: `挂载点位 ${index}`,
    type: 'number',
    value: index,
    status: index % 10 === 0 ? 'offline' : 'good'
  }))
  const persistedSources = [{
    id: 'activation-source',
    name: '挂载性能目录',
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: { url: 'https://gateway.example/realtime' },
    points
  }]
  const events = []
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: 'initial-source',
      name: '原目录',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/initial' },
      points: []
    }],
    store: {
      async load() { return persistedSources },
      getPersistenceStatus() { return { durable: true, mode: 'durable', reason: '' } }
    },
    catalogSchedule(callback) {
      return scheduler.schedule(() => {
        const startedAt = performance.now()
        callback()
        sliceSamples.push(performance.now() - startedAt)
      })
    },
    catalogCancel: handle => scheduler.cancel(handle),
    catalogNow: () => performance.now(),
    catalogBudgetMs: 4,
    catalogMaxOperationsPerSlice: 4_096
  })
  gateway.subscribe(event => events.push(event))

  const startedAt = performance.now()
  const activation = gateway.activateWorkspace('activation-workspace')
  for (let attempt = 0; attempt < 8 && scheduler.size === 0; attempt += 1) await Promise.resolve()
  const callerMs = performance.now() - startedAt

  assert.equal(scheduler.size, 1)
  assert.equal((await gateway.getSource('initial-source', { includePoints: false })).id, 'initial-source')
  assert.equal(await gateway.getSource('activation-source', { includePoints: false }), null)
  let flushedSlices = 0
  while (scheduler.flushOne()) {
    flushedSlices += 1
    if (flushedSlices > 1_000) throw new Error('catalog preparation did not settle')
  }
  const result = await activation
  const totalMs = performance.now() - startedAt
  const timing = summarizeDurations(sliceSamples)
  t.diagnostic(JSON.stringify({ pointCount, callerMs, totalMs, slices: sliceSamples.length, sliceMs: timing }))

  assert.ok(callerMs < FRAME_BUDGET_MS, `activation caller took ${callerMs.toFixed(2)}ms`)
  assert.ok(sliceSamples.length > 1)
  assert.ok(timing.max < FRAME_BUDGET_MS, `catalog preparation slice took ${timing.max.toFixed(2)}ms`)
  assert.equal(result.sources[0].pointCount, pointCount)
  assert.equal((await gateway.getPointsByIds(['activation.point.99999']))[0].value, 99_999)
  assert.equal(events.at(-1).type, 'workspace-activated')
  assert.equal(events.at(-1).pointIdsOmitted, true)
  assert.deepEqual(events.at(-1).invalidatedPointIds, [])
  assert.deepEqual(events.at(-1).changedSourceIds, ['initial-source', 'activation-source'])

  const metadataUpdateStartedAt = performance.now()
  await gateway.updateSource('activation-source', { enabled: false }, { includePoints: false })
  const metadataUpdateMs = performance.now() - metadataUpdateStartedAt
  assert.ok(metadataUpdateMs < FRAME_BUDGET_MS, `large catalog metadata update took ${metadataUpdateMs.toFixed(2)}ms`)
  assert.equal(events.at(-1).type, 'source-updated')
  assert.equal(events.at(-1).pointIdsOmitted, true)
  assert.deepEqual(events.at(-1).changedSourceIds, ['activation-source'])
  gateway.dispose()
})

test('6016 component bindings share source paths and derive the latest snapshot in bounded slices', t => {
  const scheduler = createManualScheduler()
  const uniquePathCount = 128
  const nodes = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => ({
    id: `source-bound-${index}`,
    dataBindings: [{
      target: 'text',
      sourceId: 'performance-source',
      jsonPath: `$.values[${index % uniquePathCount}]`,
      enabled: true
    }]
  }))
  const updates = new Map()
  const sliceSamples = []
  const rebuildSliceSamples = []
  const derivationSliceSamples = []
  const runtime = createSourceBindingRuntime({
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => performance.now(),
    budgetMs: PRODUCTION_RUNTIME_SLICE_MS,
    onUpdates(batch) {
      for (const update of batch) updates.set(update.key, update.value)
    }
  })

  const rebuildStartedAt = performance.now()
  runtime.rebuildDeferred(nodes)
  const rebuildCallerMs = performance.now() - rebuildStartedAt
  assert.equal(runtime.state.nodeCount, 0, 'large rebuild must not index every node on the caller stack')

  runtime.ingest({
    sourceId: 'performance-source',
    revision: 1,
    quality: 'good',
    data: { values: Array.from({ length: uniquePathCount }, (_, index) => index) }
  })
  runtime.ingest({
    sourceId: 'performance-source',
    revision: 2,
    quality: 'good',
    data: { values: Array.from({ length: uniquePathCount }, (_, index) => index + 1_000) }
  })

  while (scheduler.size) {
    const before = runtime.state
    const startedAt = performance.now()
    scheduler.flushOne()
    const duration = performance.now() - startedAt
    const after = runtime.state
    sliceSamples.push(duration)
    if (after.evaluations > before.evaluations) derivationSliceSamples.push(duration)
    else rebuildSliceSamples.push(duration)
    assert.ok(sliceSamples.length < 100)
  }
  const timing = summarizeDurations(sliceSamples)
  const rebuildTiming = summarizeDurations(rebuildSliceSamples)
  const derivationTiming = summarizeDurations(derivationSliceSamples)
  t.diagnostic(JSON.stringify({
    components: LARGE_RUNTIME_KEY_COUNT,
    uniquePaths: uniquePathCount,
    rebuildCallerMs,
    slices: sliceSamples.length,
    sliceMs: timing,
    rebuildSliceMs: rebuildTiming,
    derivationSliceMs: derivationTiming
  }))

  assert.equal(runtime.state.evaluations, uniquePathCount)
  assert.equal(runtime.state.emittedUpdates, uniquePathCount)
  assert.equal(runtime.state.nodeCount, LARGE_RUNTIME_KEY_COUNT)
  assert.equal(runtime.state.pathCount, uniquePathCount)
  assert.equal(updates.size, uniquePathCount)
  assert.ok([...updates.values()].every(value => value >= 1_000))
  assert.ok(rebuildCallerMs < FRAME_BUDGET_MS, `deferred rebuild caller took ${rebuildCallerMs.toFixed(2)}ms`)
  assert.ok(rebuildTiming.max < FRAME_BUDGET_MS, `source index rebuild slice took ${rebuildTiming.max.toFixed(2)}ms`)
  assert.ok(derivationTiming.max < FRAME_BUDGET_MS, `source derivation slice took ${derivationTiming.max.toFixed(2)}ms`)
  assert.ok(timing.max < FRAME_BUDGET_MS, `source derivation slice took ${timing.max.toFixed(2)}ms`)
  runtime.dispose()
})

test('6k-key ingress is asynchronous, frame bounded, and latest-wins', () => {
  const keys = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => `runtime.${index}`)
  const { scheduler, store } = createRuntimeStore({ activeKeys: keys })
  const notifications = []
  store.subscribeAll((key, value) => { notifications.push({ key, value }) })

  const first = keys.map(key => ({ key, value: 1 }))
  const latest = keys.map(key => ({ key, value: 2 }))

  assert.equal(store.enqueue(first), LARGE_RUNTIME_KEY_COUNT)
  assert.equal(store.getValue(keys[0]), undefined, 'large ingress must not write values on the caller stack')
  assert.equal(store.enqueue(latest), LARGE_RUNTIME_KEY_COUNT)
  assert.equal(store.getValue(keys.at(-1)), undefined)
  assert.equal(scheduler.size, 1, 'all ingress batches must share one host frame')

  let frames = 0
  while (scheduler.size) {
    const before = notifications.length
    assert.equal(scheduler.flushOne(), true)
    const frameNotifications = notifications.slice(before)
    assert.ok(
      frameNotifications.length <= FRAME_ITEM_LIMIT,
      `frame ${frames + 1} published ${frameNotifications.length} values; limit is ${FRAME_ITEM_LIMIT}`
    )
    assert.ok(frameNotifications.length > 0, `frame ${frames + 1} made no useful progress`)
    assert.ok(
      frameNotifications.every(({ value }) => value === 2),
      `frame ${frames + 1} published a superseded value`
    )
    frames += 1
    assert.ok(frames < 100, '6k runtime ingress did not settle')
  }

  assert.equal(frames, Math.ceil(LARGE_RUNTIME_KEY_COUNT / FRAME_ITEM_LIMIT))
  assert.equal(notifications.length, LARGE_RUNTIME_KEY_COUNT)
  assert.equal(store.debugSnapshot().values, LARGE_RUNTIME_KEY_COUNT)
  assert.deepEqual(keys.map(key => store.getValue(key)), Array(LARGE_RUNTIME_KEY_COUNT).fill(2))
})

test('a large batch containing only inactive keys creates no queued work', () => {
  const { scheduler, store } = createRuntimeStore({ activeKeys: ['known'] })
  const unknown = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => ({
    key: `unknown.${index}`,
    value: index
  }))

  assert.equal(store.enqueue(unknown), 0)
  assert.equal(scheduler.size, 0)
  assert.equal(store.debugSnapshot().values, 0)
  assert.equal(store.debugSnapshot().ingressPending, 0)
  assert.equal(store.debugSnapshot().pending, 0)
})

test('a newer 6k batch replaces every old value that has not crossed a frame boundary', () => {
  const keys = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => `runtime.${index}`)
  const { scheduler, store } = createRuntimeStore({ activeKeys: keys })
  const notifications = new Map(keys.map(key => [key, []]))
  store.subscribeAll((key, value) => notifications.get(key)?.push(value))

  store.enqueue(keys.map(key => ({ key, value: 1 })))
  assert.equal(scheduler.flushOne(), true)
  assert.equal(keys.filter(key => store.getValue(key) === 1).length, FRAME_ITEM_LIMIT)

  store.enqueue(keys.map(key => ({ key, value: 2 })))
  assert.equal(store.debugSnapshot().ingressPending, LARGE_RUNTIME_KEY_COUNT)
  assert.equal(scheduler.size, 1)

  let remainingFrames = 0
  while (scheduler.size) {
    scheduler.flushOne()
    remainingFrames += 1
    assert.ok(remainingFrames < 100)
  }

  for (let index = 0; index < keys.length; index += 1) {
    const published = notifications.get(keys[index])
    assert.deepEqual(published, index < FRAME_ITEM_LIMIT ? [1, 2] : [2])
    assert.equal(store.getValue(keys[index]), 2)
  }
  assert.equal(remainingFrames, Math.ceil(LARGE_RUNTIME_KEY_COUNT / FRAME_ITEM_LIMIT))
  assert.equal(store.debugSnapshot().ingressPending, 0)
})

test('one active key mixed with 6015 inactive keys consumes one scheduled frame', () => {
  const hotKey = 'runtime.visible'
  const { scheduler, store } = createRuntimeStore({ activeKeys: [hotKey] })
  const published = []
  store.subscribe(hotKey, value => published.push(value), { immediate: false })
  const batch = Array.from({ length: LARGE_RUNTIME_KEY_COUNT - 1 }, (_, index) => ({
    key: `runtime.hidden.${index}`,
    value: index
  }))
  batch.push({ key: hotKey, value: 42 })

  assert.equal(store.enqueue(batch), 1)
  assert.equal(store.debugSnapshot().ingressPending, 1)
  assert.equal(scheduler.size, 1)
  assert.equal(scheduler.flushOne(), true)

  assert.deepEqual(published, [42])
  assert.equal(store.getValue(hotKey), 42)
  assert.equal(store.debugSnapshot().ingressPending, 0)
  assert.equal(store.debugSnapshot().pending, 0)
  assert.equal(scheduler.size, 0)
})

test('a key mounted after 6k ingress is promoted from the queue tail into the next frame', () => {
  const keys = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => `runtime.${index}`)
  const visibleKey = keys.at(-1)
  const { scheduler, store } = createRuntimeStore({ activeKeys: keys })

  store.enqueue(keys.map((key, value) => ({ key, value })))
  const visibleBinding = store.acquire(visibleKey)
  assert.equal(visibleBinding.value, undefined)
  assert.equal(scheduler.size, 1)

  assert.equal(scheduler.flushOne(), true)
  assert.equal(visibleBinding.value, LARGE_RUNTIME_KEY_COUNT - 1)
  assert.equal(store.getValue(visibleKey), LARGE_RUNTIME_KEY_COUNT - 1)
  assert.ok(store.debugSnapshot().ingressPending < LARGE_RUNTIME_KEY_COUNT)
})

test('discarded viewport subscriptions do not consume the next frame update quota', () => {
  const staleKeys = Array.from({ length: LARGE_RUNTIME_KEY_COUNT }, (_, index) => `stale.${index}`)
  const hotKey = 'new-viewport-key'
  const { scheduler, store } = createRuntimeStore({
    activeKeys: [...staleKeys, hotKey],
    syncIngressLimit: LARGE_RUNTIME_KEY_COUNT + 1
  })

  const unsubscribe = staleKeys.map(key => store.subscribe(key, () => {}, { immediate: false }))
  store.enqueue(staleKeys.map((key, value) => ({ key, value })))
  assert.equal(store.debugSnapshot().pending, LARGE_RUNTIME_KEY_COUNT)

  unsubscribe.forEach(stop => stop())
  assert.equal(store.debugSnapshot().pending, 0)

  let hotValue
  store.subscribe(hotKey, value => { hotValue = value }, { immediate: false })
  store.enqueue([{ key: hotKey, value: 42 }])
  assert.equal(scheduler.flushOne(), true)
  assert.equal(hotValue, 42, 'the newly visible key must publish in the first available frame')
})

test('one failing runtime listener cannot stall sibling listeners or later frames', () => {
  const listenerErrors = []
  const { scheduler, store } = createRuntimeStore({
    activeKeys: ['a', 'b'],
    onListenerError: (error, key) => listenerErrors.push({ error, key })
  })
  const received = []

  store.subscribe('a', () => { throw new Error('listener failure') }, { immediate: false })
  store.subscribe('a', value => received.push(['a', value]), { immediate: false })
  store.subscribe('b', value => received.push(['b', value]), { immediate: false })
  store.enqueue([{ key: 'a', value: 1 }, { key: 'b', value: 2 }])
  scheduler.flushOne()

  assert.deepEqual(received, [['a', 1], ['b', 2]])
  assert.equal(listenerErrors.length, 1)
  assert.equal(listenerErrors[0].key, 'a')
  assert.equal(store.debugSnapshot().pending, 0)
  assert.equal(scheduler.size, 0)
})

test('browser probe reports nearest-rank P95, long tasks, and named interactions', async () => {
  let currentTime = 0
  let nextHandle = 1
  const frames = new Map()
  let observerCallback = null
  class MockPerformanceObserver {
    constructor(callback) { observerCallback = callback }
    observe() {}
    disconnect() {}
  }
  const probe = createBrowserPerformanceProbe({
    host: { document: { visibilityState: 'visible' } },
    now: () => currentTime,
    requestFrame(callback) {
      const handle = nextHandle++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame(handle) { frames.delete(handle) },
    PerformanceObserver: MockPerformanceObserver
  })
  const flushFrame = timestamp => {
    currentTime = timestamp
    const [handle, callback] = frames.entries().next().value
    frames.delete(handle)
    callback(timestamp)
  }

  assert.equal(probe.start(), true)
  assert.equal(probe.start(), false)
  for (const timestamp of [0, 16, 32, 48, 80]) flushFrame(timestamp)
  observerCallback({ getEntries: () => [{ duration: 49 }, { duration: 55 }] })
  await probe.measure('drop', async () => { currentTime += 4 })
  probe.recordInteraction('drop', 6)
  const report = probe.stop()

  assert.equal(report.visibilityState, 'visible')
  assert.deepEqual(report.frames, {
    count: 4,
    average: 20,
    p95: 32,
    max: 32,
    overBudget: 1,
    overLongTaskThreshold: 0
  })
  assert.deepEqual(report.longTasks, { count: 1, average: 55, p95: 55, max: 55 })
  assert.deepEqual(report.interactions.drop, { count: 2, average: 5, p95: 6, max: 6 })
  assert.equal(frames.size, 0)
})

test('browser probe keeps long-running measurement samples bounded', () => {
  let currentTime = 0
  let nextHandle = 1
  const frames = new Map()
  let observerCallback = null
  class MockPerformanceObserver {
    constructor(callback) { observerCallback = callback }
    observe() {}
    disconnect() {}
  }
  const probe = createBrowserPerformanceProbe({
    host: { document: { visibilityState: 'visible' } },
    now: () => currentTime,
    requestFrame(callback) {
      const handle = nextHandle++
      frames.set(handle, callback)
      return handle
    },
    cancelFrame(handle) { frames.delete(handle) },
    PerformanceObserver: MockPerformanceObserver,
    maxFrameSamples: 8,
    maxLongTaskSamples: 4,
    maxInteractionSamples: 3
  })
  const flushFrame = timestamp => {
    currentTime = timestamp
    const [handle, callback] = frames.entries().next().value
    frames.delete(handle)
    callback(timestamp)
  }

  probe.start()
  for (let index = 0; index < 40; index += 1) flushFrame(index * 16)
  observerCallback({ getEntries: () => Array.from({ length: 20 }, (_, index) => ({ duration: 50 + index })) })
  for (let index = 0; index < 20; index += 1) probe.recordInteraction('drag', index)
  const report = probe.stop()

  assert.ok(report.frames.count <= 8)
  assert.ok(report.longTasks.count <= 4)
  assert.ok(report.interactions.drag.count <= 3)
  assert.equal(report.frames.max, 16)
  assert.equal(report.longTasks.max, 69)
  assert.equal(report.interactions.drag.max, 19)
})

test('6k mounted runtime data keeps incremental editing and drain slices inside one 60Hz frame', t => {
  const nodes = createRuntimeNodes()
  const runtimeKeys = nodes.map(node => node.dataKey)
  const nodeLookup = new Map(nodes.map(node => [node.id, node]))
  const dataKeyIndex = createDataKeyIndex()
  const layerAllocator = createLayerAllocator()
  const spatialIndex = createSpatialIndex(nodes, { cellSize: 256 })
  dataKeyIndex.rebuild(nodes)
  layerAllocator.rebuild([nodes])

  const scheduler = createManualScheduler()
  const store = useRuntimeData({
    scheduler,
    now: () => performance.now(),
    frameBudgetMs: PRODUCTION_RUNTIME_SLICE_MS,
    activeKeys: runtimeKeys
  })
  const visibleBindings = runtimeKeys
    .slice(0, VISIBLE_RUNTIME_KEY_COUNT)
    .map(key => [key, store.acquire(key)])
  const runtimeCanvasDirtyQueue = createRuntimeCanvasDirtyQueue({
    idsForKey(key) { return [dataKeyIndex.idsFor(key)] },
    nodeForId(id) { return nodeLookup.get(id) }
  })
  const stopCanvasSubscription = store.subscribeAll(key => {
    if (dataKeyIndex.countFor(key) > 0) runtimeCanvasDirtyQueue.queueKey(key)
  })
  const canvasFanoutSamples = []

  const flushRuntime = samples => {
    let frames = 0
    while (scheduler.size) {
      const startedAt = performance.now()
      assert.equal(scheduler.flushOne(), true)
      samples.push(performance.now() - startedAt)
      while (runtimeCanvasDirtyQueue.hasPending()) {
        const fanoutStartedAt = performance.now()
        const dirty = runtimeCanvasDirtyQueue.takeBatch()
        canvasFanoutSamples.push(performance.now() - fanoutStartedAt)
        assert.equal(dirty.full, false)
        assert.ok(dirty.nodes.length <= DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE)
      }
      frames += 1
      assert.ok(frames < 100, 'one 6k ingress batch must settle without starving later frames')
    }
    return frames
  }

  // Warm JIT and Map allocation paths before collecting percentiles.
  store.enqueue(runtimeKeys.map(key => ({ key, value: -1 })))
  flushRuntime([])

  const ingressSamples = []
  const editSamples = []
  const drainSamples = []
  let runtimeFrames = 0
  const sampleCount = 20
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const batch = runtimeKeys.map(key => ({ key, value: sample }))
    const wirePayload = JSON.stringify({ values: batch })
    let startedAt = performance.now()
    const normalizedBatch = normalizeRuntimeUpdates(JSON.parse(wirePayload))
    assert.equal(store.enqueue(normalizedBatch), LARGE_RUNTIME_KEY_COUNT)
    ingressSamples.push(performance.now() - startedAt)

    startedAt = performance.now()
    const reservation = layerAllocator.reserve(1)
    const inserted = {
      id: `inserted-${sample}`,
      layer: reservation.start,
      x: 24 + sample * 3,
      y: 24 + sample * 2,
      w: 88,
      h: 54,
      dataKey: `runtime.inserted.${sample}`
    }
    nodes.push(inserted)
    nodeLookup.set(inserted.id, inserted)
    dataKeyIndex.add([inserted])
    store.registerKeys([inserted.dataKey])
    spatialIndex.update(inserted)
    layerAllocator.commit([inserted])

    const moved = nodes[sample]
    moved.x += 1
    moved.y += 1
    spatialIndex.update(moved)
    const viewportNodes = spatialIndex.query({ x: 0, y: 0, w: 1_440, h: 900 })
    assert.ok(viewportNodes.some(node => node.id === inserted.id))
    editSamples.push(performance.now() - startedAt)

    runtimeFrames += flushRuntime(drainSamples)
  }

  const measuredIngress = summarizeDurations(ingressSamples.slice(3))
  const measuredEdit = summarizeDurations(editSamples.slice(3))
  const measuredDrain = summarizeDurations(drainSamples)
  const measuredCanvasFanout = summarizeDurations(canvasFanoutSamples)
  t.diagnostic(JSON.stringify({
    runtimeKeys: LARGE_RUNTIME_KEY_COUNT,
    visibleBindings: VISIBLE_RUNTIME_KEY_COUNT,
    runtimeFrames,
    protocolParseNormalizeEnqueueMs: measuredIngress,
    incrementalEditMs: measuredEdit,
    drainSliceMs: measuredDrain,
    canvasFanoutSliceMs: measuredCanvasFanout
  }))

  assert.ok(
    measuredIngress.p95 < FRAME_BUDGET_MS,
    `6k protocol parse, normalization, and enqueue P95 ${measuredIngress.p95.toFixed(2)}ms exceeds one 60Hz frame`
  )
  assert.ok(
    measuredEdit.p95 < FRAME_BUDGET_MS,
    `incremental edit P95 ${measuredEdit.p95.toFixed(2)}ms exceeds one 60Hz frame`
  )
  assert.ok(
    measuredDrain.p95 < FRAME_BUDGET_MS,
    `runtime drain P95 ${measuredDrain.p95.toFixed(2)}ms exceeds one 60Hz frame`
  )
  assert.ok(
    measuredCanvasFanout.p95 < PRODUCTION_RUNTIME_SLICE_MS * 2,
    `runtime Canvas fanout P95 ${measuredCanvasFanout.p95.toFixed(2)}ms exceeds its bounded slice`
  )
  assert.ok(runtimeFrames >= sampleCount, 'runtime work must remain asynchronous across host frames')
  assert.equal(store.debugSnapshot().ingressPending, 0)
  assert.equal(store.debugSnapshot().pending, 0)
  assert.equal(runtimeCanvasDirtyQueue.hasPending(), false)
  assert.ok(visibleBindings.every(([key, binding]) => binding.value === sampleCount - 1 && store.getValue(key) === sampleCount - 1))

  stopCanvasSubscription()
  for (const [key] of visibleBindings) store.release(key)
  store.stop()
})

test('one runtime key can fan out to 6016 Canvas nodes without a synchronous full redraw', t => {
  const nodes = createRuntimeNodes().map(node => ({ ...node, dataKey: 'runtime.shared' }))
  const nodeLookup = new Map(nodes.map(node => [node.id, node]))
  const dataKeyIndex = createDataKeyIndex()
  dataKeyIndex.rebuild(nodes)
  const queue = createRuntimeCanvasDirtyQueue({
    idsForKey(key) { return [dataKeyIndex.idsFor(key)] },
    nodeForId(id) { return nodeLookup.get(id) }
  })

  const entrySamples = []
  const sliceSamples = []
  let totalBatches = 0
  for (let sample = 0; sample < 20; sample += 1) {
    let startedAt = performance.now()
    assert.equal(dataKeyIndex.countFor('runtime.shared'), LARGE_RUNTIME_KEY_COUNT)
    queue.queueKey('runtime.shared')
    entrySamples.push(performance.now() - startedAt)

    let resolved = 0
    while (queue.hasPending()) {
      startedAt = performance.now()
      const dirty = queue.takeBatch()
      sliceSamples.push(performance.now() - startedAt)
      assert.equal(dirty.full, false)
      assert.ok(dirty.nodes.length <= DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE)
      resolved += dirty.nodes.length
      totalBatches += 1
    }
    assert.equal(resolved, LARGE_RUNTIME_KEY_COUNT)
  }

  const entryTiming = summarizeDurations(entrySamples.slice(3))
  const sliceTiming = summarizeDurations(sliceSamples.slice(3))
  t.diagnostic(JSON.stringify({
    affectedNodes: LARGE_RUNTIME_KEY_COUNT,
    totalBatches,
    keyEntryMs: entryTiming,
    fanoutSliceMs: sliceTiming
  }))
  assert.ok(entryTiming.p95 < PRODUCTION_RUNTIME_SLICE_MS)
  assert.ok(sliceTiming.p95 < PRODUCTION_RUNTIME_SLICE_MS * 2)
  assert.ok(totalBatches >= 20 * Math.ceil(LARGE_RUNTIME_KEY_COUNT / DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE))
})
