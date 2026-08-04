import assert from 'node:assert/strict'
import test from 'node:test'
import { watch } from 'vue'

import { useRuntimeData } from '../src/composables/useRuntimeData.js'
import { createLocalPointCatalogGateway } from '../src/services/pointCatalogGateway.js'
import { createLocalRuntimeGateway } from '../src/services/runtimeGateway.js'
import { createSourceBindingRuntime } from '../src/services/sourceBindingRuntime.js'
import { sourceBindingRuntimeKey } from '../src/utils/jsonPathBinding.js'

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
      return callbacks.delete(handle)
    },
    runOne() {
      const entry = callbacks.entries().next()
      if (entry.done) return false
      const [handle, callback] = entry.value
      callbacks.delete(handle)
      callback()
      return true
    },
    runAll(limit = 10_000) {
      let count = 0
      while (this.runOne()) {
        count += 1
        if (count > limit) throw new Error('scheduler did not settle')
      }
      return count
    },
    get size() { return callbacks.size }
  }
}

function binding(target, sourceId, jsonPath, extra = {}) {
  return { target, sourceId, jsonPath, enabled: true, ...extra }
}

test('keeps source bindings isolated from a legacy point id with identical display text', () => {
  const sourceId = 'collision-source'
  const jsonPath = '$.value'
  const sourceKey = sourceBindingRuntimeKey(sourceId, jsonPath)
  const legacyKey = String(sourceKey)
  assert.notStrictEqual(sourceKey, legacyKey)

  const storeScheduler = createManualScheduler()
  const store = useRuntimeData({
    schedule: callback => storeScheduler.schedule(callback),
    cancel: handle => storeScheduler.cancel(handle),
    now: () => 0
  })
  assert.equal(store.registerKeys(sourceKey), 1)
  assert.equal(store.registerKeys(legacyKey), 1)
  const gateway = createLocalRuntimeGateway()
  gateway.subscribe(batch => store.enqueue(batch))
  const sourceRuntime = createSourceBindingRuntime({
    onUpdates: batch => gateway.send(batch),
    schedule: () => 1,
    cancel() {}
  })
  sourceRuntime.rebuild([{
    id: 'source-node',
    dataBindings: [binding('text', sourceId, jsonPath)]
  }])

  sourceRuntime.ingest({ sourceId, revision: 1, data: { value: 'source-value' } })
  sourceRuntime.flush()
  gateway.send([{ key: legacyKey, value: 'legacy-value' }])

  assert.equal(store.state.activeKeys, 2)
  assert.equal(store.getValue(sourceKey), 'source-value')
  assert.equal(store.getValue(legacyKey), 'legacy-value')
  assert.equal(store.unregisterKeys([legacyKey]), 1)
  assert.equal(store.hasActiveKey(sourceKey), true)
  assert.equal(store.getValue(sourceKey), 'source-value')
  assert.equal(store.unregisterKeys([sourceKey]), 1)
  assert.equal(store.state.activeKeys, 0)
})

test('publishes a new snapshot generation when an owned object reference is reused', () => {
  const sourceId = 'owned-reference-source'
  const sourceKey = sourceBindingRuntimeKey(sourceId, '$.nested')
  const storeScheduler = createManualScheduler()
  const store = useRuntimeData({
    activeKeys: [sourceKey],
    schedule: callback => storeScheduler.schedule(callback),
    cancel: handle => storeScheduler.cancel(handle),
    now: () => 0
  })
  const bindingRef = store.acquire(sourceKey)
  const observed = []
  const stopWatching = watch(bindingRef, value => observed.push(value?.value), { flush: 'sync' })
  const runtimeGateway = createLocalRuntimeGateway()
  runtimeGateway.subscribe(batch => store.enqueue(batch))
  const sourceRuntime = createSourceBindingRuntime({
    onUpdates: batch => runtimeGateway.send(batch),
    schedule: () => 1,
    cancel() {}
  })
  sourceRuntime.rebuild([{
    id: 'owned-reference-node',
    dataBindings: [binding('text', sourceId, '$.nested')]
  }])
  const pointGateway = createLocalPointCatalogGateway({
    sources: [{
      id: sourceId,
      name: '所有权测试',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: []
    }]
  })
  pointGateway.subscribeSnapshots(snapshot => sourceRuntime.ingest(snapshot), { shared: true })

  const ownedPayload = { nested: { value: 1 } }
  pointGateway.ingestSourceSnapshot(sourceId, ownedPayload, { quality: 'good' }, {
    takeOwnership: true,
    sharedResult: true
  })
  sourceRuntime.flush()
  storeScheduler.runAll()

  ownedPayload.nested.value = 2
  pointGateway.ingestSourceSnapshot(sourceId, ownedPayload, { quality: 'good' }, {
    takeOwnership: true,
    sharedResult: true
  })
  sourceRuntime.flush()
  storeScheduler.runAll()

  assert.deepEqual(observed, [1, 2])
  assert.strictEqual(store.getValue(sourceKey), ownedPayload.nested)
  stopWatching()
  store.release(sourceKey)
})

test('indexes only source JSONPath bindings and evaluates every unique path once per revision', () => {
  const scheduler = createManualScheduler()
  const batches = []
  const runtime = createSourceBindingRuntime({
    onUpdates: updates => batches.push(updates),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })

  runtime.rebuild([
    {
      id: 'node-a',
      dataBindings: [
        binding('text', 'mqtt-main', '$.device.name'),
        binding('fill', 'mqtt-main', '$.device.state'),
        { target: 'stroke', pointId: 'legacy.point', enabled: true }
      ]
    },
    {
      id: 'node-b',
      dataBindings: [
        binding('text', 'mqtt-main', "$['device']['name']"),
        binding('opacity', 'mqtt-main', '$.ignored', { enabled: false })
      ]
    }
  ])

  assert.deepEqual(runtime.state, {
    nodeCount: 2,
    sourceCount: 1,
    pathCount: 2,
    snapshotCount: 0,
    pendingSourceCount: 0,
    scheduled: false,
    disposed: false,
    slices: 0,
    evaluations: 0,
    emittedUpdates: 0,
    errors: 0
  })

  assert.equal(runtime.ingest({
    sourceId: 'mqtt-main',
    revision: 1,
    data: { device: { name: '主泵', state: 'running' } }
  }), true)
  assert.equal(batches.length, 0)
  assert.equal(scheduler.size, 1)
  scheduler.runAll()

  assert.deepEqual(batches.flat(), [
    { key: sourceBindingRuntimeKey('mqtt-main', '$.device.name'), value: '主泵' },
    { key: sourceBindingRuntimeKey('mqtt-main', '$.device.state'), value: 'running' }
  ])
  assert.equal(runtime.state.evaluations, 2)
  assert.equal(runtime.state.emittedUpdates, 2)

  assert.equal(runtime.ingest({ sourceId: 'mqtt-main', revision: 1, data: { device: { name: '重复' } } }), false)
  assert.equal(scheduler.size, 0)
  assert.equal(runtime.state.evaluations, 2)
})

test('coalesces pending snapshots and republishes the complete latest revision after an interruption', () => {
  const scheduler = createManualScheduler()
  const finalValues = new Map()
  const batches = []
  let clock = 0
  const runtime = createSourceBindingRuntime({
    onUpdates(updates) {
      batches.push(updates)
      for (const update of updates) finalValues.set(update.key, update.value)
    },
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => { clock += 0.55; return clock },
    budgetMs: 1
  })
  const bindings = Array.from({ length: 30 }, (_, index) => binding(`target-${index}`, 'http-main', `$.values[${index}]`))
  runtime.rebuild([{ id: 'node-many', dataBindings: bindings }])

  runtime.ingest({ sourceId: 'http-main', revision: 10, data: { values: Array.from({ length: 30 }, (_, index) => index) } })
  assert.equal(scheduler.runOne(), true)
  assert.ok(runtime.state.evaluations < 30)

  runtime.ingest({ sourceId: 'http-main', revision: 11, data: { values: Array.from({ length: 30 }, (_, index) => index + 100) } })
  scheduler.runAll()

  assert.equal(finalValues.size, 30)
  for (let index = 0; index < 30; index += 1) {
    assert.equal(finalValues.get(sourceBindingRuntimeKey('http-main', `$.values[${index}]`)), index + 100)
  }
  assert.ok(batches.length > 1, 'small frame budget should split publication into multiple batches')
  assert.equal(runtime.state.pendingSourceCount, 0)
  assert.equal(runtime.state.scheduled, false)
})

test('updates reference counts incrementally and evaluates newly bound paths from the cached snapshot', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })
  const shared = binding('text', 'redis-main', '$.shared')

  assert.equal(runtime.updateNode({ id: 'a', dataBindings: [shared] }), true)
  assert.equal(runtime.updateNode({ id: 'b', dataBindings: [shared] }), true)
  assert.equal(runtime.state.pathCount, 1)
  runtime.ingest({ sourceId: 'redis-main', revision: 'r1', data: { shared: 7, later: 9 } })
  scheduler.runAll()

  assert.equal(runtime.removeNode('a'), true)
  assert.equal(runtime.state.pathCount, 1)
  assert.equal(runtime.updateNode({ id: 'b', dataBindings: [binding('text', 'redis-main', '$.later')] }), true)
  scheduler.runAll()
  assert.equal(updates.at(-1).key, sourceBindingRuntimeKey('redis-main', '$.later'))
  assert.equal(updates.at(-1).value, 9)

  assert.equal(runtime.removeNode('b'), true)
  assert.equal(runtime.state.nodeCount, 0)
  assert.equal(runtime.state.sourceCount, 0)
  assert.equal(runtime.state.pathCount, 0)
  assert.equal(runtime.removeNode('missing'), false)
})

test('contains invalid paths and throwing source getters without stopping sibling updates', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const source = { ok: 42 }
  Object.defineProperty(source, 'broken', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })

  runtime.rebuild([{
    id: 'node',
    dataBindings: [
      binding('a', 'source', '$.ok'),
      binding('b', 'source', '$.broken'),
      binding('c', 'source', '$..invalid'),
      binding('d', 'source', '$.constructor')
    ]
  }])
  runtime.ingest({ sourceId: 'source', revision: 1, data: source })
  scheduler.runAll()

  assert.deepEqual(updates, [
    { key: sourceBindingRuntimeKey('source', '$.ok'), value: 42 },
    { key: sourceBindingRuntimeKey('source', '$.broken'), value: undefined }
  ])
  assert.equal(runtime.state.pathCount, 2)
})

test('flush drains pending work synchronously and dispose cancels future publication', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })
  runtime.rebuild([{ id: 'node', dataBindings: [binding('text', 'socket-main', '$.value')] }])
  runtime.ingest({ sourceId: 'socket-main', revision: 1, value: { value: '兼容值' } })

  assert.equal(runtime.flush(), 1)
  assert.equal(scheduler.size, 0)
  assert.deepEqual(updates, [{ key: sourceBindingRuntimeKey('socket-main', '$.value'), value: '兼容值' }])

  runtime.ingest({ sourceId: 'socket-main', revision: 2, data: { value: '不会发布' } })
  assert.equal(scheduler.size, 1)
  runtime.dispose()
  assert.equal(scheduler.size, 0)
  assert.equal(runtime.ingest({ sourceId: 'socket-main', revision: 3, data: { value: '忽略' } }), false)
  assert.equal(runtime.updateNode({ id: 'new', dataBindings: [] }), false)
  assert.equal(runtime.state.disposed, true)
})

test('reset can retain binding indexes while clearing snapshots and derived revision caches', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })
  runtime.rebuild([{ id: 'node', dataBindings: [binding('text', 'sql-main', '$.row.name')] }])
  assert.deepEqual(runtime.sourceIds(), ['sql-main'])

  runtime.ingest({ sourceId: 'sql-main', revision: 2, data: { row: { name: '新值' } } })
  runtime.ingest({ sourceId: 'sql-main', revision: 1, data: { row: { name: '过期值' } } })
  scheduler.runAll()
  assert.equal(updates.at(-1).value, '新值')

  assert.equal(runtime.reset({ keepBindings: true }), true)
  assert.deepEqual(runtime.sourceIds(), ['sql-main'])
  assert.equal(runtime.state.snapshotCount, 0)
  assert.equal(runtime.state.evaluations, 0)
  runtime.ingest({ sourceId: 'sql-main', revision: 2, data: { row: { name: '重新激活' } } })
  scheduler.runAll()
  assert.equal(updates.at(-1).value, '重新激活')

  runtime.reset()
  assert.deepEqual(runtime.sourceIds(), [])
  assert.equal(runtime.state.nodeCount, 0)
})

test('invalidates derived values while a source is unavailable and restores them when it recovers', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })
  const runtimeKey = sourceBindingRuntimeKey('mqtt-main', '$.temperature')
  runtime.rebuild([{ id: 'node', dataBindings: [binding('text', 'mqtt-main', '$.temperature')] }])

  runtime.ingest({ sourceId: 'mqtt-main', revision: 1, quality: 'good', data: { temperature: 36 } })
  scheduler.runAll()
  assert.deepEqual(updates.at(-1), { key: runtimeKey, value: 36 })

  for (const [revision, quality] of [[2, 'testing'], [3, 'stale'], [4, 'offline'], [5, 'error'], [6, 'bad']]) {
    runtime.ingest({ sourceId: 'mqtt-main', revision, quality, data: { temperature: 99 } })
    scheduler.runAll()
    assert.deepEqual(updates.at(-1), { key: runtimeKey, value: undefined })
  }

  runtime.ingest({ sourceId: 'mqtt-main', revision: 7, quality: 'good', data: { temperature: 41 } })
  scheduler.runAll()
  assert.deepEqual(updates.at(-1), { key: runtimeKey, value: 41 })
})

test('explicitly replays the latest tested snapshot when a downstream value was cleared', async () => {
  const scheduler = createManualScheduler()
  const values = new Map()
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: 'http-recovery',
      name: '恢复测试接口',
      protocol: 'HTTP',
      enabled: true,
      status: 'offline',
      config: {
        method: 'GET',
        url: 'https://gateway.example/recovery',
        headers: '{}',
        pollInterval: 1000
      },
      points: []
    }]
  })
  const runtime = createSourceBindingRuntime({
    onUpdates(batch) {
      for (const update of batch) values.set(update.key, update.value)
    },
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle)
  })
  const runtimeKey = sourceBindingRuntimeKey('http-recovery', '$.status')
  runtime.rebuild([{
    id: 'status-text',
    dataBindings: [binding('text', 'http-recovery', '$.status')]
  }])
  gateway.subscribeSnapshots(snapshot => runtime.ingest(snapshot), { shared: true })

  await gateway.testSource('http-recovery', { includePoints: false })
  scheduler.runAll()
  assert.equal(values.get(runtimeKey), 'connected')

  // 前端拒绝非法配置时网关不会产生新 revision；下游值丢失后仍须能重放当前快照。
  values.set(runtimeKey, undefined)
  const testedSnapshot = await gateway.getSourceSnapshot('http-recovery', { shared: true })
  assert.equal(runtime.ingest(testedSnapshot), false)
  assert.equal(runtime.ingest(testedSnapshot, { replay: true }), true)
  scheduler.runAll()
  assert.equal(values.get(runtimeKey), 'connected')
})

test('rebuilds large binding indexes in slices and preserves edits made before commit', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    budgetMs: 1
  })
  const nodes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `node-${index}`,
    dataBindings: [binding('text', 'source', '$.value')]
  }))

  assert.equal(runtime.rebuildDeferred(nodes), true)
  assert.equal(runtime.state.nodeCount, 0)
  assert.equal(scheduler.size, 1)
  runtime.ingest({ sourceId: 'source', revision: 1, quality: 'good', data: { value: 7, other: 9 } })
  runtime.updateNode({ id: 'node-1099', dataBindings: [binding('text', 'source', '$.other')] })
  runtime.removeNode('node-0')
  scheduler.runAll()

  assert.equal(runtime.state.nodeCount, 1_099)
  assert.equal(runtime.state.pathCount, 2)
  assert.deepEqual(new Map(updates.map(update => [update.key, update.value])), new Map([
    [sourceBindingRuntimeKey('source', '$.value'), 7],
    [sourceBindingRuntimeKey('source', '$.other'), 9]
  ]))
})

test('flush commits a pending deferred rebuild before draining derived updates', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    budgetMs: 1
  })
  const nodes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `node-${index}`,
    dataBindings: [binding('text', 'source', '$.value')]
  }))

  runtime.rebuildDeferred(nodes)
  runtime.ingest({ sourceId: 'source', revision: 1, data: { value: 17 } })

  assert.equal(runtime.flush(), 1)
  assert.equal(scheduler.size, 0)
  assert.equal(runtime.state.nodeCount, 1_100)
  assert.equal(runtime.state.pathCount, 1)
  assert.deepEqual(updates, [
    { key: sourceBindingRuntimeKey('source', '$.value'), value: 17 }
  ])
})

test('reset with keepBindings commits an in-progress rebuild before clearing snapshots', () => {
  const scheduler = createManualScheduler()
  const updates = []
  const runtime = createSourceBindingRuntime({
    onUpdates: batch => updates.push(...batch),
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    budgetMs: 1
  })
  const nodes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `node-${index}`,
    dataBindings: [binding('text', 'source', '$.value')]
  }))

  runtime.rebuildDeferred(nodes)
  assert.equal(scheduler.runOne(), true)
  assert.equal(runtime.state.nodeCount, 0)

  assert.equal(runtime.reset({ keepBindings: true }), true)
  assert.equal(scheduler.size, 0)
  assert.equal(runtime.state.nodeCount, 1_100)
  assert.deepEqual(runtime.sourceIds(), ['source'])
  assert.equal(runtime.state.snapshotCount, 0)

  runtime.ingest({ sourceId: 'source', revision: 1, data: { value: 23 } })
  runtime.flush()
  assert.deepEqual(updates.at(-1), {
    key: sourceBindingRuntimeKey('source', '$.value'),
    value: 23
  })
})

test('falls back to synchronous rebuild when initial or subsequent scheduling throws', () => {
  const nodes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `node-${index}`,
    dataBindings: [binding('text', 'source', '$.value')]
  }))
  const initialFailureRuntime = createSourceBindingRuntime({
    schedule() { throw new Error('initial scheduling failed') },
    cancel() {},
    now: () => 0,
    budgetMs: 1
  })

  assert.equal(initialFailureRuntime.rebuildDeferred(nodes), true)
  assert.equal(initialFailureRuntime.state.nodeCount, 1_100)
  assert.equal(initialFailureRuntime.state.errors, 1)

  const scheduler = createManualScheduler()
  let scheduleAttempts = 0
  const rescheduleFailureRuntime = createSourceBindingRuntime({
    schedule(callback) {
      scheduleAttempts += 1
      if (scheduleAttempts === 2) throw new Error('rescheduling failed')
      return scheduler.schedule(callback)
    },
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    budgetMs: 1
  })

  assert.equal(rescheduleFailureRuntime.rebuildDeferred(nodes), true)
  assert.equal(scheduler.runOne(), true)
  assert.equal(scheduler.size, 0)
  assert.equal(rescheduleFailureRuntime.state.nodeCount, 1_100)
  assert.equal(rescheduleFailureRuntime.state.errors, 1)
})

test('dispose cancels a scheduled deferred rebuild and rejects future work', () => {
  const scheduler = createManualScheduler()
  const runtime = createSourceBindingRuntime({
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    budgetMs: 1
  })
  const nodes = Array.from({ length: 1_100 }, (_, index) => ({
    id: `node-${index}`,
    dataBindings: [binding('text', 'source', '$.value')]
  }))

  runtime.rebuildDeferred(nodes)
  assert.equal(scheduler.size, 1)

  assert.equal(runtime.dispose(), true)
  assert.equal(scheduler.size, 0)
  assert.equal(scheduler.runOne(), false)
  assert.equal(runtime.state.disposed, true)
  assert.equal(runtime.state.nodeCount, 0)
  assert.equal(runtime.rebuildDeferred(nodes), false)
})
