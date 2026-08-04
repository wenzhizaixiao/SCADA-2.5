import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RUNTIME_LISTENER_QUANTUM,
  useRuntimeData
} from '../src/composables/useRuntimeData.js'

function createManualScheduler() {
  let nextHandle = 1
  const callbacks = new Map()
  const cancelledCallbacks = []

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
    flushOne() {
      const entry = callbacks.entries().next().value
      if (!entry) return false
      const [handle, callback] = entry
      callbacks.delete(handle)
      callback()
      return true
    },
    flushAll(limit = 100_000) {
      let count = 0
      while (this.flushOne()) {
        count += 1
        if (count > limit) throw new Error('runtime data scheduler did not settle')
      }
      return count
    },
    flushCancelled() {
      const staleCallbacks = cancelledCallbacks.splice(0)
      staleCallbacks.forEach(callback => callback())
    },
    get size() { return callbacks.size }
  }
}

function createStore(options = {}) {
  const scheduler = createManualScheduler()
  const store = useRuntimeData({
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    ...options
  })
  return { scheduler, store }
}

test('only active document keys are retained and unmounted keys create no refs', () => {
  const { scheduler, store } = createStore({ activeKeys: [' pump.a ', 'pump.a', 'pump.b'] })

  assert.equal(store.enqueue([
    { key: 'pump.a', value: 10 },
    { key: 'pump.b', value: 20 },
    { key: 'not-in-document', value: 30 }
  ]), 2)
  assert.equal(store.getValue('pump.a'), 10)
  assert.equal(store.getValue('pump.b'), 20)
  assert.equal(store.getValue('not-in-document'), undefined)
  assert.deepEqual(store.debugSnapshot(), {
    activeKeys: 2,
    activeReferences: 3,
    bindings: 0,
    bindingReferences: 0,
    listenerKeys: 0,
    listenerReferences: 0,
    values: 2,
    ingressPending: 0,
    pending: 0,
    listenerFanoutPending: 0,
    queued: 0,
    scheduled: false
  })
  assert.equal(scheduler.size, 0)
})

test('incremental active-key reference counts support duplicate data keys', () => {
  const { store } = createStore()

  assert.equal(store.registerKeys(['shared', 'shared', 'other']), 3)
  store.enqueue([{ key: 'shared', value: 1 }, { key: 'other', value: 2 }])
  assert.equal(store.unregisterKeys(['shared']), 1)
  assert.equal(store.hasActiveKey('shared'), true)
  assert.equal(store.getValue('shared'), 1)

  assert.equal(store.unregisterKeys(['shared', 'missing']), 1)
  assert.equal(store.hasActiveKey('shared'), false)
  assert.equal(store.getValue('shared'), undefined)

  assert.equal(store.setActiveKeys(['next', 'next', 'last']), 2)
  assert.deepEqual(store.getActiveKeys(), ['next', 'last'])
  assert.equal(store.state.activeReferences, 3)
  assert.equal(store.rebuild(['last']), 1)
  assert.deepEqual(store.getActiveKeys(), ['last'])
  assert.equal(store.state.activeReferences, 1)
})

test('acquire returns one stable shallowRef per key and release is view-only', () => {
  const { scheduler, store } = createStore({ activeKeys: ['shared'] })
  store.enqueue([{ key: 'shared', value: 7 }])

  const first = store.acquire('shared')
  const second = store.acquire(' shared ')
  assert.strictEqual(first, second)
  assert.equal(first.value, 7)
  assert.equal(store.state.bindingReferences, 2)

  store.enqueue([{ key: 'shared', value: 8 }])
  assert.equal(first.value, 7)
  assert.equal(scheduler.size, 1)
  scheduler.flushAll()
  assert.equal(first.value, 8)

  assert.equal(store.release('shared'), false)
  assert.equal(store.hasActiveKey('shared'), true)
  assert.equal(store.release('shared'), true)
  assert.equal(store.state.bindings, 0)
  assert.equal(store.hasActiveKey('shared'), true)

  store.enqueue([{ key: 'shared', value: 9 }])
  assert.equal(store.getValue('shared'), 9)
  assert.equal(store.state.pending, 0)
  assert.equal(scheduler.size, 0)
})

test('pending updates are coalesced per key with latest value winning', () => {
  const { scheduler, store } = createStore({ activeKeys: ['a', 'b'] })
  const a = store.acquire('a')
  const b = store.acquire('b')

  store.enqueue([
    { key: 'a', value: 1 },
    { key: 'b', value: 2 },
    { key: 'a', value: 3 },
    { key: 'a', value: 4 }
  ])

  assert.equal(store.state.pending, 2)
  assert.equal(store.state.queued, 2)
  assert.equal(scheduler.size, 1)
  scheduler.flushAll()
  assert.equal(a.value, 4)
  assert.equal(b.value, 2)
  assert.equal(store.getValue('a'), 4)
  assert.equal(store.state.pending, 0)
})

test('visible keys at the end of a 6016-item ingress publish in its first frame', () => {
  const keys = Array.from({ length: 6_016 }, (_, index) => `bulk.${index}`)
  const listenerKey = keys.at(-1)
  const bindingKey = keys.at(-2)
  const legacyKey = keys.at(-3)
  const { scheduler, store } = createStore({ activeKeys: keys })
  const listenerValues = []
  const binding = store.acquire(bindingKey)

  store.subscribe(listenerKey, value => listenerValues.push(value), { immediate: false })
  assert.equal(store.getVersion(legacyKey), 0)

  const batch = keys.map((key, value) => ({ key, value }))
  batch[0] = { key: listenerKey, value: 'stale' }
  batch[batch.length - 1] = { key: listenerKey, value: 'latest' }

  assert.equal(store.enqueue(batch), batch.length)
  assert.equal(listenerValues.length, 0)
  assert.equal(binding.value, undefined)
  assert.equal(store.getVersion(legacyKey), 0)

  assert.equal(scheduler.flushOne(), true)
  assert.deepEqual(listenerValues, ['latest'])
  assert.equal(binding.value, 6_014)
  assert.equal(store.getVersion(legacyKey), 1)
  assert.equal(store.getValue(listenerKey), 'latest')
})

test('new immediate values cannot be overwritten by an older deferred ingress', () => {
  const keys = Array.from({ length: 300 }, (_, index) => `ordered.${index}`)
  const hotKey = keys.at(-1)
  const { scheduler, store } = createStore({ activeKeys: keys, maxUpdatesPerFrame: 2 })

  store.enqueue(keys.map(key => ({ key, value: 'old' })))
  const binding = store.acquire(hotKey)
  store.enqueue({ key: hotKey, value: 'new' })

  scheduler.flushOne()
  assert.equal(binding.value, 'new')
  scheduler.flushAll()
  assert.equal(binding.value, 'new')
  assert.equal(store.getValue(hotKey), 'new')
})

test('a deferred value cannot cross an inactive activation epoch', () => {
  const keys = Array.from({ length: 300 }, (_, index) => `epoch.${index}`)
  const reusedKey = keys.at(-1)
  const { scheduler, store } = createStore({ activeKeys: keys, maxUpdatesPerFrame: 8 })

  store.enqueue(keys.map(key => ({ key, value: 'old' })))
  assert.equal(store.unregisterKeys([reusedKey]), 1)
  assert.equal(store.registerKeys([reusedKey]), 1)
  const binding = store.acquire(reusedKey)

  scheduler.flushAll()
  assert.equal(binding.value, undefined)
  assert.equal(store.getValue(reusedKey), undefined)

  store.enqueue({ key: reusedKey, value: 'new' })
  scheduler.flushAll()
  assert.equal(binding.value, 'new')
  assert.equal(store.getValue(reusedKey), 'new')
})

test('leaf listeners update without creating Vue refs and unsubscribe cleanly', () => {
  const { scheduler, store } = createStore({ activeKeys: ['text'] })
  const values = []
  const unsubscribe = store.subscribe('text', value => values.push(value))

  assert.deepEqual(values, [undefined])
  assert.equal(store.state.bindings, 0)
  assert.equal(store.state.listenerKeys, 1)
  store.enqueue([{ key: 'text', value: 'first' }, { key: 'text', value: 'latest' }])
  scheduler.flushAll()
  assert.deepEqual(values, [undefined, 'latest'])

  assert.equal(unsubscribe(), true)
  assert.equal(unsubscribe(), false)
  store.enqueue([{ key: 'text', value: 'after-release' }])
  assert.equal(scheduler.size, 0)
  assert.deepEqual(values, [undefined, 'latest'])
  assert.equal(store.state.listenerReferences, 0)
})

test('leaf listeners share the same bounded frame slices as ref bindings', () => {
  const keys = Array.from({ length: 5 }, (_, index) => `leaf.${index}`)
  const { scheduler, store } = createStore({ activeKeys: keys, maxUpdatesPerFrame: 2, frameBudgetMs: 100 })
  const values = new Map()
  keys.forEach(key => store.subscribe(key, value => values.set(key, value)))
  store.enqueue(keys.map((key, value) => ({ key, value })))

  scheduler.flushOne()
  assert.equal([...values.values()].filter(value => value !== undefined).length, 2)
  scheduler.flushAll()
  assert.deepEqual(keys.map(key => values.get(key)), [0, 1, 2, 3, 4])

  store.clear()
  assert.deepEqual(keys.map(key => values.get(key)), [undefined, undefined, undefined, undefined, undefined])
})

test('one high-fanout key resumes listener delivery across frame slices and converges on the latest value', () => {
  const listenerCount = 6_016
  const { scheduler, store } = createStore({
    activeKeys: ['shared'],
    frameBudgetMs: 2,
    maxUpdatesPerFrame: 16_384
  })
  const latestValues = Array(listenerCount).fill(undefined)

  for (let index = 0; index < listenerCount; index += 1) {
    store.subscribe('shared', value => { latestValues[index] = value }, { immediate: false })
  }

  store.enqueue({ key: 'shared', value: 'first' })
  assert.equal(scheduler.flushOne(), true)
  const deliveredInFirstFrame = latestValues.filter(value => value !== undefined).length
  assert.equal(deliveredInFirstFrame, DEFAULT_RUNTIME_LISTENER_QUANTUM)
  assert.equal(store.state.listenerFanoutPending, 1)
  assert.equal(scheduler.size, 1)

  store.enqueue({ key: 'shared', value: 'latest' })
  scheduler.flushAll()

  assert.ok(latestValues.every(value => value === 'latest'))
  assert.equal(store.state.pending, 0)
  assert.equal(store.state.listenerFanoutPending, 0)
  assert.equal(store.state.queued, 0)
  assert.equal(store.state.scheduled, false)
})

test('one high-fanout key checks the time budget before every listener callback', () => {
  const listenerCount = 6_016
  let clock = 0
  let delivered = 0
  const { scheduler, store } = createStore({
    activeKeys: ['shared'],
    frameBudgetMs: 2,
    maxUpdatesPerFrame: 16_384,
    listenerQuantum: listenerCount,
    now: () => clock++
  })

  for (let index = 0; index < listenerCount; index += 1) {
    store.subscribe('shared', () => { delivered += 1 }, { immediate: false })
  }

  store.enqueue({ key: 'shared', value: 'value' })
  assert.equal(scheduler.flushOne(), true)
  assert.equal(delivered, 2)
  assert.equal(store.state.listenerFanoutPending, 1)
  assert.equal(scheduler.size, 1)
  store.stop()
  assert.equal(store.state.listenerFanoutPending, 0)
})

test('each frame slice obeys the maximum update count', () => {
  const keys = Array.from({ length: 5 }, (_, index) => `key.${index}`)
  const { scheduler, store } = createStore({ activeKeys: keys, maxUpdatesPerFrame: 2, frameBudgetMs: 100 })
  const bindings = keys.map(key => store.acquire(key))
  store.enqueue(keys.map((key, value) => ({ key, value })))

  scheduler.flushOne()
  assert.equal(bindings.filter(binding => binding.value !== undefined).length, 2)
  assert.equal(store.state.pending, 3)
  assert.equal(scheduler.size, 1)

  assert.equal(scheduler.flushAll(), 2)
  assert.deepEqual(bindings.map(binding => binding.value), [0, 1, 2, 3, 4])
})

test('each frame slice also obeys its time budget', () => {
  const keys = Array.from({ length: 5 }, (_, index) => `timed.${index}`)
  let clock = 0
  const { scheduler, store } = createStore({
    activeKeys: keys,
    maxUpdatesPerFrame: 100,
    frameBudgetMs: 2,
    now: () => clock++
  })
  const bindings = keys.map(key => store.acquire(key))
  store.enqueue(keys.map((key, value) => ({ key, value })))

  scheduler.flushOne()
  assert.equal(bindings.filter(binding => binding.value !== undefined).length, 2)
  assert.equal(store.state.pending, 3)
  scheduler.flushAll()
  assert.deepEqual(bindings.map(binding => binding.value), [0, 1, 2, 3, 4])
})

test('updates arriving during a multi-frame drain keep fair order and final values', () => {
  const keys = ['key.0', 'key.1', 'key.2', 'key.3']
  const { scheduler, store } = createStore({ activeKeys: keys, maxUpdatesPerFrame: 1 })
  const bindings = new Map(keys.map(key => [key, store.acquire(key)]))
  store.enqueue(keys.map(key => ({ key, value: 1 })))

  scheduler.flushOne()
  assert.equal(bindings.get('key.0').value, 1)
  store.enqueue([
    { key: 'key.0', value: 2 },
    { key: 'key.2', value: 3 },
    { key: 'key.2', value: 4 }
  ])
  scheduler.flushAll()

  assert.deepEqual(keys.map(key => bindings.get(key).value), [2, 1, 4, 1])
  assert.deepEqual(keys.map(key => store.getValue(key)), [2, 1, 4, 1])
  assert.equal(store.state.pending, 0)
  assert.equal(store.state.queued, 0)
})

test('stop and clear invalidate cancelled callbacks without orphaning mounted bindings', () => {
  const { scheduler, store } = createStore({ activeKeys: ['key'] })
  const binding = store.acquire('key')

  store.enqueue([{ key: 'key', value: 1 }])
  store.stop()
  assert.equal(binding.value, undefined)
  assert.equal(store.getValue('key'), 1)
  assert.equal(store.state.pending, 0)
  scheduler.flushCancelled()
  assert.equal(binding.value, undefined)

  store.enqueue([{ key: 'key', value: 1 }])
  scheduler.flushAll()
  assert.equal(binding.value, 1)

  store.enqueue([{ key: 'key', value: 2 }])
  store.clear()
  assert.equal(binding.value, undefined)
  assert.equal(store.getValue('key'), undefined)
  assert.equal(store.hasActiveKey('key'), false)
  assert.equal(store.state.bindings, 1)
  scheduler.flushCancelled()
  assert.equal(binding.value, undefined)

  store.registerKeys(['key'])
  store.enqueue([{ key: 'key', value: 3 }])
  scheduler.flushAll()
  assert.equal(binding.value, 3)
  assert.equal(store.release('key'), true)
})

test('legacy parent-render versions remain frame-batched during migration', () => {
  const { scheduler, store } = createStore({ activeKeys: ['legacy'] })
  const binding = store.acquire('legacy')
  assert.equal(store.getVersion('legacy'), 0)
  store.enqueue([{ key: 'legacy', value: 42 }])
  assert.equal(store.release('legacy'), true)
  assert.equal(store.getVersion('legacy'), 0)
  scheduler.flushAll()
  assert.equal(store.getVersion('legacy'), 1)
  assert.equal(store.getValue('legacy'), 42)
  assert.equal(binding.value, undefined)
})

test('a scheduler object can be injected in Node without browser frame globals', () => {
  const scheduler = createManualScheduler()
  const store = useRuntimeData({ activeKeys: ['node'], scheduler, frameBudgetMs: 100 })
  const binding = store.acquire('node')

  store.enqueue([{ key: 'node', value: 'ready' }])
  scheduler.flushAll()
  assert.equal(binding.value, 'ready')
})
