import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactEntityLayers,
  createDataKeyIndex,
  createEdgeAdjacencyIndex,
  createLayerAllocator
} from '../src/utils/documentIndexes.js'

function observeCollectionAccess(source) {
  const stats = { numericReads: 0, mapReads: 0, iteratorReads: 0 }
  const collection = new Proxy(source, {
    get(target, property, receiver) {
      if (property === 'map') stats.mapReads += 1
      if (property === Symbol.iterator) stats.iteratorReads += 1
      if (typeof property === 'string' && /^\d+$/.test(property)) stats.numericReads += 1
      return Reflect.get(target, property, receiver)
    }
  })
  return {
    collection,
    stats,
    reset() {
      stats.numericReads = 0
      stats.mapReads = 0
      stats.iteratorReads = 0
    }
  }
}

test('layer reservations stay O(1) after rebuilding a 10k document', () => {
  const observedNodes = observeCollectionAccess(Array.from({ length: 10_000 }, (_, index) => ({
    id: `node-${index}`,
    layer: index + 1
  })))
  const allocator = createLayerAllocator()

  allocator.rebuild([observedNodes.collection])
  assert.deepEqual(allocator.state, { committedMax: 10_000, reservedMax: 10_000 })
  assert.ok(observedNodes.stats.numericReads >= 10_000)

  observedNodes.reset()
  const single = allocator.reserve(1)
  const bundle = allocator.reserve(16)

  assert.deepEqual(single, { start: 10_001, end: 10_001 })
  assert.deepEqual(bundle, { start: 10_002, end: 10_017 })
  assert.deepEqual(observedNodes.stats, { numericReads: 0, mapReads: 0, iteratorReads: 0 })
  assert.deepEqual(allocator.state, { committedMax: 10_000, reservedMax: 10_017 })
  assert.equal(Object.isFrozen(allocator.state), true)
  assert.throws(() => { allocator.state.reservedMax = 0 }, TypeError)
})

test('imported layers are compacted without changing their relative stacking order', () => {
  const highest = { id: 'highest', layer: Number.MAX_SAFE_INTEGER }
  const invalid = { id: 'invalid', layer: null }
  const middle = { id: 'middle', layer: 900 }
  const lowest = { id: 'lowest', layer: 12 }
  const entities = [highest, invalid, middle, lowest]

  assert.equal(compactEntityLayers(entities), entities)
  assert.deepEqual(entities.map(entity => entity.id), ['highest', 'invalid', 'middle', 'lowest'])
  assert.deepEqual(
    Object.fromEntries(entities.map(entity => [entity.id, entity.layer])),
    { highest: 3, invalid: 4, middle: 2, lowest: 1 }
  )

  const allocator = createLayerAllocator()
  allocator.rebuild([entities])
  assert.deepEqual(allocator.state, { committedMax: 4, reservedMax: 4 })
  assert.deepEqual(allocator.reserve(1), { start: 5, end: 5 })
})

test('layer commits scan only their batch and never reuse failed reservations', () => {
  const allocator = createLayerAllocator()
  allocator.rebuild([[{ layer: 20 }]])

  const failed = allocator.reserve(3)
  const successful = allocator.reserve(2)
  assert.deepEqual(failed, { start: 21, end: 23 })
  assert.deepEqual(successful, { start: 24, end: 25 })

  const batch = observeCollectionAccess([
    { id: 'node-a', layer: successful.start },
    { id: 'node-b', layer: successful.end }
  ])
  allocator.commit(batch.collection)

  assert.equal(batch.stats.numericReads, 2)
  assert.equal(allocator.state.committedMax, 25)
  allocator.reconcile(8)
  assert.deepEqual(allocator.state, { committedMax: 8, reservedMax: 25 })
  assert.deepEqual(allocator.reserve(1), { start: 26, end: 26 })
  assert.throws(() => allocator.reserve(0), RangeError)
  assert.throws(() => allocator.reserve(1.5), RangeError)
})

test('rebuild clears layer reservations from the previous document baseline', () => {
  const allocator = createLayerAllocator()
  allocator.rebuild([[{ layer: 20 }]])
  assert.deepEqual(allocator.reserve(6), { start: 21, end: 26 })
  assert.deepEqual(allocator.state, { committedMax: 20, reservedMax: 26 })

  allocator.rebuild([[{ layer: 1 }, { layer: 2 }]])
  assert.deepEqual(allocator.state, { committedMax: 2, reservedMax: 2 })
  assert.deepEqual(allocator.reserve(2), { start: 3, end: 4 })
})

test('adding 15 edges does not reread the existing 9999-edge collection', () => {
  const existingEdges = Array.from({ length: 9_999 }, (_, index) => ({
    id: `edge-${index}`,
    from: `node-${index}`,
    to: `node-${index + 1}`
  }))
  const observedExisting = observeCollectionAccess(existingEdges)
  const adjacency = createEdgeAdjacencyIndex()

  adjacency.rebuild(observedExisting.collection)
  assert.equal(adjacency.state.edgeCount, 9_999)
  observedExisting.reset()

  const insertedEdges = observeCollectionAccess(Array.from({ length: 15 }, (_, index) => ({
    id: `inserted-${index}`,
    from: `inserted-node-${index}`,
    to: `inserted-node-${index + 1}`
  })))
  assert.equal(adjacency.add(insertedEdges.collection), 15)

  assert.deepEqual(observedExisting.stats, { numericReads: 0, mapReads: 0, iteratorReads: 0 })
  assert.equal(insertedEdges.stats.numericReads, 15)
  assert.equal(adjacency.state.edgeCount, 10_014)
  assert.deepEqual(
    [...adjacency.get('inserted-node-7')].map(edge => edge.id).sort(),
    ['inserted-6', 'inserted-7']
  )
})

test('edge adjacency applies removals, restorations, replacements, and self loops incrementally', () => {
  const adjacency = createEdgeAdjacencyIndex()
  const first = { id: 'edge-a', from: 'node-a', to: 'node-b' }
  const second = { id: 'edge-b', from: 'node-b', to: 'node-c' }
  const selfLoop = { id: 'edge-loop', from: 'node-c', to: 'node-c' }

  adjacency.rebuild([first, second, selfLoop])
  assert.deepEqual([...adjacency.get('node-b')].map(edge => edge.id), ['edge-a', 'edge-b'])
  assert.deepEqual([...adjacency.get('node-c')].map(edge => edge.id), ['edge-b', 'edge-loop'])

  const replacement = { id: 'edge-a', from: 'node-d', to: 'node-e' }
  assert.equal(adjacency.add([replacement]), 1)
  assert.deepEqual([...adjacency.get('node-a')], [])
  assert.deepEqual([...adjacency.get('node-d')], [replacement])

  const restored = { id: 'edge-restored', from: 'node-a', to: 'node-e' }
  const changes = adjacency.applyChanges(
    [{ id: second.id, index: 1, value: second }],
    [{ id: restored.id, index: 1, value: restored }]
  )
  assert.deepEqual(changes, { removed: 1, added: 1 })
  assert.deepEqual([...adjacency.get('node-b')], [])
  assert.deepEqual([...adjacency.get('node-a')], [restored])
  assert.equal(adjacency.remove(['missing', selfLoop.id]), 1)
  assert.deepEqual([...adjacency.get('node-c')], [])
  assert.deepEqual(adjacency.state, { edgeCount: 2, nodeCount: 3 })
  assert.equal(Object.isFrozen(adjacency.state), true)
})

test('data key index trims keys and keeps duplicate-key nodes independent', () => {
  const index = createDataKeyIndex()
  const state = index.rebuild([
    { id: 'temperature-a', dataKey: '  device.temperature  ' },
    { id: 'temperature-b', dataKey: 'device.temperature' },
    { id: 'blank', dataKey: '   ' },
    { id: 'pressure', dataKey: 'device.pressure' },
    { id: '', dataKey: 'ignored.invalid-id' }
  ])

  assert.equal(state, index.state)
  assert.deepEqual(index.state, { nodeCount: 3, keyCount: 2 })
  assert.deepEqual([...index.keys()].sort(), ['device.pressure', 'device.temperature'])
  assert.equal(index.has(' device.temperature '), true)
  assert.equal(index.has('   '), false)
  assert.equal(index.keyFor('temperature-a'), 'device.temperature')
  assert.equal(index.keyFor({ id: 'temperature-b' }), 'device.temperature')
  assert.equal(index.keyFor('blank'), undefined)
  assert.equal(index.countFor(' device.temperature '), 2)
  assert.equal(index.countFor('device.pressure'), 1)
  assert.equal(index.countFor('missing'), 0)
  assert.equal(index.countFor('   '), 0)
  assert.deepEqual([...index.idsFor(' device.temperature ')].sort(), ['temperature-a', 'temperature-b'])
  assert.deepEqual([...index.idsFor('missing')], [])
  assert.deepEqual([...index.idsFor('   ')], [])
  assert.equal(Object.isFrozen(index.state), true)
})

test('data key index replaces, clears, and removes node keys incrementally', () => {
  const index = createDataKeyIndex()
  index.rebuild([
    { id: 'node-a', dataKey: 'shared' },
    { id: 'node-b', dataKey: 'shared' },
    { id: 'node-c', dataKey: 'solo' }
  ])

  assert.equal(index.add([{ id: 'node-a', dataKey: 'replacement' }]), 1)
  assert.equal(index.has('shared'), true)
  assert.equal(index.keyFor('node-a'), 'replacement')
  assert.deepEqual(index.state, { nodeCount: 3, keyCount: 3 })

  assert.equal(index.update('node-b', ' replacement '), true)
  assert.equal(index.has('shared'), false)
  assert.equal(index.countFor('replacement'), 2)
  assert.deepEqual([...index.idsFor('replacement')].sort(), ['node-a', 'node-b'])
  assert.deepEqual(index.state, { nodeCount: 3, keyCount: 2 })

  assert.equal(index.update({ id: 'node-c', dataKey: '   ' }), true)
  assert.equal(index.keyFor('node-c'), undefined)
  assert.equal(index.has('solo'), false)
  assert.deepEqual(index.state, { nodeCount: 2, keyCount: 1 })

  assert.equal(index.update('node-new', 'replacement'), true)
  assert.equal(index.update('node-new', ' replacement '), false)
  assert.deepEqual(index.state, { nodeCount: 3, keyCount: 1 })

  assert.equal(index.remove([{ id: 'node-a' }, 'missing']), 1)
  assert.equal(index.has('replacement'), true)
  assert.equal(index.remove(['node-b', 'node-new']), 2)
  assert.equal(index.countFor('replacement'), 0)
  assert.deepEqual([...index.keys()], [])
  assert.deepEqual([...index.idsFor('replacement')], [])
  assert.deepEqual(index.state, { nodeCount: 0, keyCount: 0 })
})

test('data key index mutations never reread the rebuilt document collection', () => {
  const existingNodes = observeCollectionAccess(Array.from({ length: 10_000 }, (_, index) => ({
    id: `node-${index}`,
    dataKey: index % 2 ? `runtime.${index}` : 'runtime.shared'
  })))
  const index = createDataKeyIndex()

  index.rebuild(existingNodes.collection)
  assert.deepEqual(index.state, { nodeCount: 10_000, keyCount: 5_001 })
  existingNodes.reset()

  const insertedNodes = observeCollectionAccess(Array.from({ length: 15 }, (_, offset) => ({
    id: `inserted-${offset}`,
    dataKey: `inserted.key.${offset}`
  })))
  assert.equal(index.add(insertedNodes.collection), 15)
  assert.equal(index.remove(['node-1', 'node-2']), 2)
  assert.equal(index.update('node-3', 'runtime.updated'), true)

  assert.deepEqual(existingNodes.stats, { numericReads: 0, mapReads: 0, iteratorReads: 0 })
  assert.equal(insertedNodes.stats.numericReads, 15)
  assert.deepEqual(index.state, { nodeCount: 10_013, keyCount: 5_015 })

  index.rebuild([{ id: 'fresh-node', dataKey: 'fresh.key' }])
  assert.deepEqual([...index.keys()], ['fresh.key'])
  assert.equal(index.keyFor('node-3'), undefined)
  assert.deepEqual(index.state, { nodeCount: 1, keyCount: 1 })
})
