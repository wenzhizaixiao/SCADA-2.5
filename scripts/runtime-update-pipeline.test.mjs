import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRuntimeUpdatePipeline,
  normalizeRuntimeUpdates
} from '../src/utils/runtimeUpdatePipeline.js'
import { setRuntimeUpdateGeneration } from '../src/utils/runtimeKey.js'

function manualScheduler({ cancelRemoves = true } = {}) {
  let nextId = 1
  const callbacks = new Map()
  return {
    schedule(callback) {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      if (cancelRemoves) callbacks.delete(id)
    },
    runNext() {
      const entry = callbacks.entries().next()
      if (entry.done) return false
      const [id, callback] = entry.value
      callbacks.delete(id)
      callback()
      return true
    },
    drain(limit = 10_000) {
      let count = 0
      while (this.runNext()) {
        count += 1
        if (count > limit) throw new Error('manual scheduler did not become idle')
      }
      return count
    },
    get size() {
      return callbacks.size
    }
  }
}

function range(count, map) {
  return {
    *[Symbol.iterator]() {
      for (let index = 0; index < count; index += 1) yield map(index)
    }
  }
}

test('normalization remains synchronous and keeps the last value in a batch', () => {
  assert.deepEqual(normalizeRuntimeUpdates({ values: [
    { key: ' speed ', value: 1 },
    { key: 'speed', value: 2 },
    { key: '', value: 3 }
  ] }), [{ key: 'speed', value: 2 }])
})

test('a newer generation publishes even when its mutable value keeps the same reference', async () => {
  const deliveries = []
  const pipeline = createRuntimeUpdatePipeline({
    onChanges: updates => deliveries.push(...updates)
  })
  const shared = { value: 1 }

  await pipeline.enqueue([setRuntimeUpdateGeneration({ key: 'shared', value: shared }, 1)])
  shared.value = 2
  await pipeline.enqueue([setRuntimeUpdateGeneration({ key: 'shared', value: shared }, 2)])

  assert.equal(deliveries.length, 2)
  assert.strictEqual(deliveries[0].value, shared)
  assert.strictEqual(deliveries[1].value, shared)
})

test('round-robin scheduling lets a new small batch pass a large batch', async () => {
  const scheduler = manualScheduler()
  const deliveries = []
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    sliceItems: 4,
    syncItems: 1,
    emitItems: 1,
    onChanges: changes => deliveries.push(...changes)
  })

  const large = pipeline.enqueueGenerated(range(1_000, index => `old-${index}`), key => key)
  const small = pipeline.enqueue([{ key: 'urgent', value: 42 }])
  scheduler.runNext()
  scheduler.runNext()

  assert.deepEqual(deliveries.find(update => update.key === 'urgent'), { key: 'urgent', value: 42 })
  assert.equal(pipeline.state.queuedBatches, 1)
  scheduler.drain()
  await Promise.all([large, small])
})

test('newer batch wins when an older iterator reaches the hot key at its tail', async () => {
  const scheduler = manualScheduler()
  const deliveries = []
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    sliceItems: 8,
    syncItems: 1,
    emitItems: 1,
    onChanges: changes => deliveries.push(...changes)
  })
  const oldKeys = range(40, index => index === 39 ? 'hot' : `cold-${index}`)
  const oldBatch = pipeline.enqueueGenerated(oldKeys, () => 'old')
  const newBatch = pipeline.enqueue([{ key: 'hot', value: 'new' }])

  scheduler.drain()
  await Promise.all([oldBatch, newBatch])
  assert.deepEqual(deliveries.filter(update => update.key === 'hot'), [{ key: 'hot', value: 'new' }])
})

test('overlapping queued batches never let an older value overwrite a newer value', async () => {
  const scheduler = manualScheduler()
  const deliveries = []
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    sliceItems: 3,
    syncItems: 1,
    emitItems: 4,
    onChanges: changes => deliveries.push(changes.map(update => ({ ...update })))
  })
  const first = pipeline.enqueue([{ key: 'shared', value: 1 }, { key: 'first', value: true }])
  const second = pipeline.enqueue([{ key: 'shared', value: 2 }, { key: 'second', value: true }])
  const third = pipeline.enqueue([{ key: 'shared', value: 3 }, { key: 'third', value: true }])

  scheduler.drain()
  await Promise.all([first, second, third])
  assert.deepEqual(deliveries.flat().filter(update => update.key === 'shared'), [{ key: 'shared', value: 3 }])
})

test('unknown iterators dynamically obey maxPendingItems and maxBatchItems', async () => {
  const scheduler = manualScheduler()
  const errors = []
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    sliceItems: 1,
    maxPendingItems: 3,
    maxBatchItems: 10,
    onError: error => errors.push(error)
  })
  const pending = pipeline.enqueueGenerated(range(4, index => `key-${index}`), () => 1)
  const rejection = assert.rejects(pending, /pending input exceeds configured limit 3/)

  assert.equal(pipeline.state.reservedItems, 1)
  scheduler.runNext()
  assert.equal(pipeline.state.reservedItems, 1)
  assert.ok(pipeline.state.reservedItems <= 3)
  scheduler.drain()
  await rejection
  assert.equal(pipeline.state.reservedItems, 0)
  assert.equal(errors.length, 1)

  const batchScheduler = manualScheduler()
  const batchPipeline = createRuntimeUpdatePipeline({
    schedule: batchScheduler.schedule,
    cancel: batchScheduler.cancel,
    now: () => 0,
    maxPendingItems: 20,
    maxBatchItems: 2
  })
  const tooLarge = batchPipeline.enqueueGenerated(range(3, index => `key-${index}`), () => 1)
  const batchRejection = assert.rejects(tooLarge, /batch contains 3 items/)
  batchScheduler.drain()
  await batchRejection
})

test('untrusted iterable size metadata cannot bypass pending accounting', async () => {
  const scheduler = manualScheduler()
  const deceptive = {
    size: -100,
    *[Symbol.iterator]() {
      yield 'first'
      yield 'second'
    }
  }
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    maxPendingItems: 1,
    maxBatchItems: 10
  })
  const pending = pipeline.enqueueGenerated(deceptive, () => true)
  const rejection = assert.rejects(pending, /pending input exceeds configured limit 1/)

  assert.equal(pipeline.state.reservedItems, 1)
  assert.throws(
    () => pipeline.enqueueGenerated(range(0, String), () => true),
    /pending input exceeds configured limit 1/
  )
  scheduler.drain()
  await rejection
  assert.equal(pipeline.state.reservedItems, 0)
})

test('known inputs reserve capacity immediately and reject total pending overflow', () => {
  const scheduler = manualScheduler()
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    syncItems: 1,
    maxPendingItems: 3
  })
  pipeline.enqueue([{ key: 'a', value: 1 }, { key: 'b', value: 2 }])
  assert.equal(pipeline.state.reservedItems, 2)
  assert.throws(
    () => pipeline.enqueue([{ key: 'c', value: 3 }, { key: 'd', value: 4 }]),
    /pending input exceeds configured limit 3/
  )
  pipeline.stop()
})

test('sink failures retry without committing lastValues or losing changes', async () => {
  const scheduler = manualScheduler()
  const errors = []
  const deliveries = []
  let attempts = 0
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    onError: (error, context) => errors.push({ error, context }),
    onChanges(changes) {
      attempts += 1
      if (attempts === 1) throw new Error('sink unavailable')
      deliveries.push(...changes)
    }
  })

  const completion = pipeline.enqueue([{ key: 'pressure', value: 8 }])
  assert.equal(attempts, 1)
  assert.equal(pipeline.state.queuedBatches, 1)
  scheduler.drain()
  assert.deepEqual(await completion, [{ key: 'pressure', value: 8 }])
  assert.deepEqual(deliveries, [{ key: 'pressure', value: 8 }])
  assert.equal(attempts, 2)
  assert.equal(errors[0].context.phase, 'emit')

  assert.deepEqual(await pipeline.enqueue([{ key: 'pressure', value: 8 }]), [])
  assert.equal(attempts, 2)
})

test('stop resolves pending work and stale callbacks cannot consume reconnect work', async () => {
  const scheduler = manualScheduler({ cancelRemoves: false })
  const deliveries = []
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => 0,
    sliceItems: 1,
    syncItems: 1,
    onChanges: changes => deliveries.push(...changes)
  })
  const stopped = pipeline.enqueueGenerated(range(20, index => `old-${index}`), () => 'old')
  const stoppedState = pipeline.stop('disconnect')
  assert.equal(stoppedState.stoppedBatches, 1)
  assert.deepEqual(await stopped, [])

  const reconnect = pipeline.enqueue([{ key: 'connected', value: true }, { key: 'ready', value: true }])
  assert.equal(scheduler.size, 2)
  scheduler.runNext()
  assert.equal(deliveries.length, 0)
  scheduler.drain()
  assert.deepEqual(await reconnect, [
    { key: 'connected', value: true },
    { key: 'ready', value: true }
  ])
  assert.equal(pipeline.state.queuedBatches, 0)
})

test('each scheduled turn respects the configured time budget', () => {
  const scheduler = manualScheduler()
  let clock = 0
  let pulls = 0
  const pipeline = createRuntimeUpdatePipeline({
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => {
      const current = clock
      clock += 0.6
      return current
    },
    budgetMs: 2,
    sliceItems: 10_000,
    maxPendingItems: 100,
    maxBatchItems: 100
  })
  const source = {
    *[Symbol.iterator]() {
      for (let index = 0; index < 50; index += 1) {
        pulls += 1
        yield `key-${index}`
      }
    }
  }
  pipeline.enqueueGenerated(source, () => 1)
  scheduler.runNext()
  assert.ok(pulls > 0)
  assert.ok(pulls <= 4, `expected a bounded 2ms slice, pulled ${pulls} items`)
  pipeline.stop()
})

test('configured value and batch limits are enforced before queue growth', () => {
  const pipeline = createRuntimeUpdatePipeline({ maxBatchItems: 2, maxStringValueLength: 3 })
  assert.throws(
    () => pipeline.enqueue([{ key: 'a', value: 1 }, { key: 'b', value: 2 }, { key: 'c', value: 3 }]),
    /batch contains 3 items/
  )
  const invalidValue = pipeline.enqueue([{ key: 'a', value: 'long' }])
  return assert.rejects(invalidValue, /exceeds 3 characters/)
})
