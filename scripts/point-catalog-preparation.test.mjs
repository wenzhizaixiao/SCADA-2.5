import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPointCatalogPreparer,
  PointCatalogPreparationCancelledError
} from '../src/utils/pointCatalogPreparation.js'

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
      callback()
      return true
    },
    flushAll(limit = 100_000) {
      let count = 0
      while (this.flushOne()) {
        count += 1
        if (count > limit) throw new Error('point catalog preparation did not settle')
      }
      return count
    },
    get size() { return callbacks.size }
  }
}

function sourceInput(pointCount, prefix = 'point') {
  return [{
    id: `source-${prefix}`,
    name: prefix,
    points: Array.from({ length: pointCount }, (_, index) => ({
      id: `${prefix}.${index}`,
      status: index % 3 === 0 ? 'offline' : 'good',
      value: index
    }))
  }]
}

function createPreparer(scheduler, options = {}) {
  return createPointCatalogPreparer({
    schedule: callback => scheduler.schedule(callback),
    cancel: handle => scheduler.cancel(handle),
    now: () => 0,
    maxOperationsPerSlice: options.maxOperationsPerSlice || 128,
    normalizeSource: source => ({ id: source.id, name: source.name, points: [] }),
    normalizePoint: (point, source) => ({ ...point, sourceId: source.id })
  })
}

test('prepares a large point catalog in bounded slices and commits complete private indexes', async () => {
  const scheduler = createManualScheduler()
  const preparer = createPreparer(scheduler)
  const input = sourceInput(20_000)
  let settled = false
  const resultPromise = preparer.prepare(input).then(result => {
    settled = true
    return result
  })

  assert.equal(settled, false)
  assert.equal(scheduler.size, 1)
  assert.equal(scheduler.flushOne(), true)
  assert.equal(settled, false)
  assert.equal(scheduler.size, 1)
  assert.ok(scheduler.flushAll() > 100)

  const result = await resultPromise
  assert.equal(result.sources[0].points.length, 20_000)
  assert.equal(result.sourceIndex.get('source-point'), result.sources[0])
  assert.equal(result.pointIndex.get('point.19999').point.value, 19_999)
  assert.equal(result.healthyPointCountBySource.get('source-point'), 13_333)
  assert.equal(result.offlinePointCountBySource.get('source-point'), 6_667)
  assert.equal(preparer.state.pending, false)
})

test('normalized catalog preparation preserves source and point references', async () => {
  const scheduler = createManualScheduler()
  const preparer = createPreparer(scheduler, { maxOperationsPerSlice: 2 })
  const input = sourceInput(3, 'normalized')
  const resultPromise = preparer.prepare(input, { normalized: true })
  scheduler.flushAll()
  const result = await resultPromise

  assert.equal(result.sources[0], input[0])
  assert.equal(result.pointIndex.get('normalized.2').point, input[0].points[2])
})

test('superseding preparation cancels the old generation without publishing it', async () => {
  const scheduler = createManualScheduler()
  const preparer = createPreparer(scheduler, { maxOperationsPerSlice: 8 })
  const first = preparer.prepare(sourceInput(1_000, 'old'))
  const second = preparer.prepare(sourceInput(2, 'new'))

  await assert.rejects(first, error => (
    error instanceof PointCatalogPreparationCancelledError
    && error.reason === 'superseded'
  ))
  scheduler.flushAll()
  const result = await second
  assert.equal(result.pointIndex.has('old.999'), false)
  assert.equal(result.pointIndex.get('new.1').point.value, 1)
})

test('duplicate point ids reject the private task and leave no scheduled continuation', async () => {
  const scheduler = createManualScheduler()
  const preparer = createPreparer(scheduler)
  const input = sourceInput(2, 'duplicate')
  input[0].points[1].id = input[0].points[0].id
  const result = preparer.prepare(input)

  scheduler.flushAll()
  await assert.rejects(result, /点位 ID 重复：duplicate\.0/)
  assert.equal(scheduler.size, 0)
  assert.equal(preparer.state.pending, false)
})

test('hidden documents use a timer so preparation cannot stall on suspended animation frames', async () => {
  const originalDocument = globalThis.document
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  let frameRequests = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'hidden' }
  })
  globalThis.requestAnimationFrame = () => {
    frameRequests += 1
    throw new Error('hidden preparation requested an animation frame')
  }

  try {
    const preparer = createPointCatalogPreparer({
      maxOperationsPerSlice: 1,
      normalizeSource: source => ({ id: source.id, points: [] }),
      normalizePoint: point => ({ ...point })
    })
    const result = await preparer.prepare(sourceInput(2, 'hidden'))
    assert.equal(result.pointIndex.size, 2)
    assert.equal(frameRequests, 0)
    preparer.dispose()
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame
  }
})
