import assert from 'node:assert/strict'
import test from 'node:test'
import { createSharedVisualClock } from '../src/composables/useSharedVisualClock.js'

function createManualScheduler() {
  let nextHandle = 1
  const callbacks = new Map()
  const cancelledCallbacks = []
  let timestamp = 0

  return {
    schedule(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancel(handle) {
      const callback = callbacks.get(handle)
      if (callback) cancelledCallbacks.push(callback)
      callbacks.delete(handle)
    },
    flushAt(nextTimestamp) {
      timestamp = nextTimestamp
      const entry = callbacks.entries().next().value
      if (!entry) return false
      const [handle, callback] = entry
      callbacks.delete(handle)
      callback(timestamp)
      return true
    },
    flushCancelled() {
      const staleCallbacks = cancelledCallbacks.splice(0)
      staleCallbacks.forEach(callback => callback(timestamp))
    },
    now() { return timestamp },
    get size() { return callbacks.size }
  }
}

function createClock() {
  const scheduler = createManualScheduler()
  return {
    scheduler,
    clock: createSharedVisualClock({ scheduler })
  }
}

test('all subscribers and frequencies share one scheduled host callback', () => {
  const { scheduler, clock } = createClock()
  const first30 = clock.acquire(30)
  const second30 = clock.acquire(30)
  const clock10 = clock.acquire(10)

  assert.strictEqual(first30, second30)
  assert.notStrictEqual(first30, clock10)
  assert.equal(scheduler.size, 1)
  assert.deepEqual(clock.debugSnapshot(), {
    frequencies: 2,
    subscribers: 3,
    scheduled: true
  })

  scheduler.flushAt(34)
  assert.equal(scheduler.size, 1)
  assert.equal(first30.value, 34)
  assert.equal(clock10.value, 0)
})

test('10fps and 30fps timestamps are independently throttled', () => {
  const { scheduler, clock } = createClock()
  const clock10 = clock.acquire(10)
  const clock30 = clock.acquire(30)

  scheduler.flushAt(20)
  assert.deepEqual([clock10.value, clock30.value], [0, 0])
  scheduler.flushAt(34)
  assert.deepEqual([clock10.value, clock30.value], [0, 34])
  scheduler.flushAt(68)
  assert.deepEqual([clock10.value, clock30.value], [0, 68])
  scheduler.flushAt(101)
  assert.deepEqual([clock10.value, clock30.value], [101, 68])
  scheduler.flushAt(102)
  assert.deepEqual([clock10.value, clock30.value], [101, 102])
})

test('the final release cancels the loop and extra releases are harmless', () => {
  const { scheduler, clock } = createClock()
  clock.acquire(30)
  clock.acquire(30)

  assert.equal(clock.release(30), false)
  assert.equal(scheduler.size, 1)
  assert.equal(clock.release(30), true)
  assert.equal(scheduler.size, 0)
  assert.equal(clock.release(30), false)
  assert.deepEqual(clock.debugSnapshot(), {
    frequencies: 0,
    subscribers: 0,
    scheduled: false
  })
})

test('a cancelled stale callback cannot publish or revive the loop', () => {
  const { scheduler, clock } = createClock()
  const staleTimestamp = clock.acquire(30)
  clock.release(30)
  const activeTimestamp = clock.acquire(10)

  assert.equal(scheduler.size, 1)
  scheduler.flushCancelled()
  assert.equal(staleTimestamp.value, 0)
  assert.equal(activeTimestamp.value, 0)
  assert.equal(scheduler.size, 1)

  scheduler.flushAt(101)
  assert.equal(staleTimestamp.value, 0)
  assert.equal(activeTimestamp.value, 101)
  assert.equal(scheduler.size, 1)
})

test('an injected Node scheduler can supply timestamps when callbacks omit them', () => {
  const scheduler = createManualScheduler()
  const clock = createSharedVisualClock({
    schedule: callback => scheduler.schedule(() => callback()),
    cancel: handle => scheduler.cancel(handle),
    now: () => scheduler.now()
  })
  const timestamp = clock.acquire(10)

  scheduler.flushAt(101)
  assert.equal(timestamp.value, 101)
  assert.equal(scheduler.size, 1)
  clock.dispose()
  assert.equal(scheduler.size, 0)
})
