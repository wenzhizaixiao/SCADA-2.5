import assert from 'node:assert/strict'
import test from 'node:test'

import { createLocalRuntimeGateway } from '../src/services/runtimeGateway.js'

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

function gatewayWithFrames(frameScheduler, options = {}) {
  return createLocalRuntimeGateway({
    ...options,
    ingressOptions: {
      schedule: frameScheduler.schedule,
      cancel: frameScheduler.cancel,
      now: () => 0,
      ...options.ingressOptions
    }
  })
}

test('send keeps synchronous normalization, notification, and array return semantics', () => {
  const frames = manualScheduler()
  const gateway = gatewayWithFrames(frames)
  const deliveries = []
  let sendReturned = false
  gateway.subscribe(updates => deliveries.push({ sendReturned, updates }))

  const result = gateway.send({ values: [
    { key: ' speed ', value: 1 },
    { key: 'speed', value: 2 },
    { key: '', value: 3 }
  ] })
  sendReturned = true

  assert.deepEqual(result, [{ key: 'speed', value: 2 }])
  assert.deepEqual(deliveries, [{ sendReturned: false, updates: [{ key: 'speed', value: 2 }] }])
  assert.equal(frames.size, 0)
})

test('a synchronous send supersedes the same key in an older deferred ingress', async () => {
  const frames = manualScheduler()
  const gateway = gatewayWithFrames(frames, {
    ingressOptions: { syncItems: 1, sliceItems: 2, emitItems: 1 }
  })
  const deliveries = []
  gateway.subscribe(updates => deliveries.push(...updates))

  const older = gateway.ingest([
    { key: 'shared', value: 'old' },
    { key: 'distinct', value: true }
  ])
  gateway.send({ key: 'shared', value: 'new' })
  frames.drain()
  await older

  assert.deepEqual(deliveries.filter(update => update.key === 'shared'), [
    { key: 'shared', value: 'new' }
  ])
  assert.deepEqual(deliveries.find(update => update.key === 'distinct'), {
    key: 'distinct',
    value: true
  })
})

test('large ingress does not read update entries on the caller stack', async () => {
  const frames = manualScheduler()
  const gateway = gatewayWithFrames(frames, {
    ingressOptions: { syncItems: 1, sliceItems: 1 }
  })
  let reads = 0
  const batch = [0, 1].map(index => ({
    get key() {
      reads += 1
      return `key-${index}`
    },
    get value() {
      reads += 1
      return index
    }
  }))

  const completion = gateway.ingest(batch)
  assert.equal(reads, 0)
  assert.equal(frames.size, 1)
  frames.drain()
  await completion
  assert.equal(reads, 4)
})

test('ingress rejects pending overflow explicitly and drains accepted work', async () => {
  const frames = manualScheduler()
  const errors = []
  const gateway = gatewayWithFrames(frames, {
    onError: (error, context) => errors.push({ error, context }),
    ingressOptions: {
      syncItems: 1,
      sliceItems: 1,
      maxPendingItems: 2,
      maxBatchItems: 10
    }
  })
  const deliveries = []
  gateway.subscribe(updates => deliveries.push(...updates))

  const accepted = gateway.ingest([
    { key: 'a', value: 1 },
    { key: 'b', value: 2 }
  ])
  assert.equal(gateway.ingressState.reservedItems, 2)
  const rejected = assert.rejects(
    gateway.ingest([{ key: 'c', value: 3 }]),
    /pending input exceeds configured limit 2/
  )

  frames.drain()
  await Promise.all([accepted, rejected])
  assert.deepEqual(deliveries, [{ key: 'a', value: 1 }, { key: 'b', value: 2 }])
  assert.equal(gateway.ingressState.reservedItems, 0)
  assert.equal(gateway.ingressState.queuedBatches, 0)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].context.phase, 'enqueue')
})

test('gateway batch backpressure also bounds zero-length queued work', async () => {
  const frames = manualScheduler()
  const errors = []
  const gateway = gatewayWithFrames(frames, {
    onError: (error, context) => errors.push({ error, context }),
    ingressOptions: {
      syncItems: 1,
      sliceItems: 1,
      maxPendingItems: 10,
      maxPendingBatches: 1
    }
  })

  const accepted = gateway.ingest([
    { key: 'a', value: 1 },
    { key: 'b', value: 2 }
  ])
  const rejected = assert.rejects(
    gateway.ingest([]),
    /pending batches exceed configured limit 1/
  )
  assert.equal(gateway.ingressState.maxPendingBatches, 1)

  frames.drain()
  await Promise.all([accepted, rejected])
  assert.equal(errors.length, 1)
  assert.equal(gateway.ingressState.queuedBatches, 0)
})

test('overlapping gateway ingress batches publish only the latest shared value', async () => {
  const frames = manualScheduler()
  const gateway = gatewayWithFrames(frames, {
    ingressOptions: { syncItems: 1, sliceItems: 3, emitItems: 1 }
  })
  const deliveries = []
  gateway.subscribe(updates => deliveries.push(...updates))

  const completions = [
    gateway.ingest([{ key: 'shared', value: 1 }, { key: 'first', value: true }]),
    gateway.ingest([{ key: 'shared', value: 2 }, { key: 'second', value: true }]),
    gateway.ingest([{ key: 'shared', value: 3 }, { key: 'third', value: true }])
  ]
  frames.drain()
  await Promise.all(completions)

  assert.deepEqual(deliveries.filter(update => update.key === 'shared'), [
    { key: 'shared', value: 3 }
  ])
  assert.deepEqual(
    new Set(deliveries.filter(update => update.key !== 'shared').map(update => update.key)),
    new Set(['first', 'second', 'third'])
  )
})

test('a transient gateway subscriber failure retries without losing the update', async () => {
  const frames = manualScheduler()
  const errors = []
  const gateway = gatewayWithFrames(frames, {
    onError: (error, context) => errors.push({ error, context })
  })
  const deliveries = []
  let attempts = 0
  gateway.subscribe(updates => {
    attempts += 1
    if (attempts === 1) throw new Error('subscriber unavailable')
    deliveries.push(...updates)
  })

  const completion = gateway.ingest([{ key: 'pressure', value: 8 }])
  assert.equal(attempts, 1)
  assert.equal(gateway.ingressState.queuedBatches, 1)
  frames.drain()

  assert.deepEqual(await completion, [{ key: 'pressure', value: 8 }])
  assert.deepEqual(deliveries, [{ key: 'pressure', value: 8 }])
  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].context.phase, 'emit')
  assert.deepEqual(await gateway.ingest([{ key: 'pressure', value: 8 }]), [])
  assert.equal(attempts, 2)
})

test('connection generation rejects stale timer and ingress callbacks after reconnect', async () => {
  const timers = manualScheduler({ cancelRemoves: false })
  const frames = manualScheduler({ cancelRemoves: false })
  const gateway = gatewayWithFrames(frames, {
    schedule: timers.schedule,
    cancel: timers.cancel,
    random: () => 0.5,
    ingressOptions: { syncItems: 1, sliceItems: 1 }
  })
  const deliveries = []
  gateway.subscribe(updates => deliveries.push(...updates))

  await gateway.connect({ getKeys: () => ['old-a', 'old-b', 'old-c'] })
  await gateway.connect({ getKeys: () => ['replacement-a', 'replacement-b', 'replacement-c'] })
  assert.equal(timers.size, 2)
  timers.runNext()
  assert.equal(frames.size, 0, 'the cancelled connection timer must not enqueue work')

  timers.runNext()
  assert.equal(frames.size, 1)
  gateway.disconnect()
  await gateway.connect({ getKeys: () => ['current'] })
  frames.runNext()
  assert.deepEqual(deliveries, [], 'the cancelled ingress generation must not publish')

  timers.runNext()
  assert.deepEqual(deliveries, [{ key: 'current', value: 50 }])
  gateway.disconnect()
})
