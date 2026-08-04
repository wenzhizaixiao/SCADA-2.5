import assert from 'node:assert/strict'
import test from 'node:test'
import { isReactive } from 'vue'
import {
  createProjectRuntimePreparationTask,
  createProjectRuntimePreparer,
  ProjectRuntimePreparationCancelledError,
  runProjectRuntimePreparationSlice
} from '../src/utils/projectRuntimePreparation.js'

function project(nodeCount = 12) {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index}`,
      type: index === 2 ? 'time' : 'rect',
      x: index * 20,
      y: index * 10,
      w: 10,
      h: 10,
      layer: nodeCount - index,
      dataKey: index < 2 ? 'shared-key' : ''
    })),
    edges: [{ id: 'edge-1', from: 'node-0', to: 'node-1', layer: nodeCount + 1 }],
    drawings: [{ id: 'drawing-1', layer: nodeCount + 2, width: 2, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }]
  }
}

test('builds a complete private runtime bundle before exposing reactive collections', () => {
  const task = createProjectRuntimePreparationTask(project())
  let slices = 0
  while (!runProjectRuntimePreparationSlice(task, { shouldYield: () => true })) slices += 1
  const result = task.result

  assert.ok(slices > 1)
  assert.equal(isReactive(result.nodes), true)
  assert.equal(result.nodeIndex.get('node-0'), result.nodes[0])
  assert.equal(result.timeNodeIndex.get('node-2'), result.nodes[2])
  assert.deepEqual([...result.runtimeDataKeyIndex.idsFor('shared-key')], ['node-0', 'node-1'])
  assert.equal(result.nodeSpatialIndex.state.entries, 12)
  assert.equal(result.edgeAdjacency.countFor('node-0'), 1)
  assert.equal(result.edgeSpatialIndex.state.entries, 1)
  assert.equal(result.drawingSpatialIndex.state.entries, 1)
  assert.equal(result.entityLayerAllocator.state.committedMax, 14)
  assert.deepEqual(result.runtimeKeys, ['shared-key', 'shared-key'])
  assert.deepEqual(result.layerEntries.map(entry => entry.layer), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14])
})

test('prepares in bounded scheduled slices and rejects a superseded document', async () => {
  const callbacks = []
  let clock = 0
  const preparer = createProjectRuntimePreparer({
    budgetMs: 2,
    now: () => (clock += .6),
    schedule(callback) {
      callbacks.push(callback)
      return callback
    },
    cancel(handle) {
      const index = callbacks.indexOf(handle)
      if (index >= 0) callbacks.splice(index, 1)
    }
  })

  const superseded = preparer.prepare(project(40))
  const current = preparer.prepare(project(20))
  await assert.rejects(superseded, ProjectRuntimePreparationCancelledError)

  let turns = 0
  while (callbacks.length) {
    callbacks.shift()()
    turns += 1
  }
  const result = await current
  assert.ok(turns > 1)
  assert.equal(result.nodes.length, 20)
  assert.equal(preparer.state.pending, false)
  preparer.dispose()
})

test('falls back to synchronous private preparation when scheduling is unavailable', async () => {
  const preparer = createProjectRuntimePreparer({ schedule() { throw new Error('no scheduler') } })
  const result = await preparer.prepare(project(4))
  assert.equal(result.nodeIndex.size, 4)
  assert.equal(result.layerEntries.length, 5)
  preparer.dispose()
})
