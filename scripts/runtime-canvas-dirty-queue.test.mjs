import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRuntimeCanvasDirtyQueue,
  DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE
} from '../src/utils/runtimeCanvasDirtyQueue.js'

function createHarness(dataIdsByKey = new Map(), bindingIdsByKey = new Map()) {
  const nodes = new Map()
  for (const ids of [...dataIdsByKey.values(), ...bindingIdsByKey.values()]) {
    for (const id of ids) nodes.set(id, { id })
  }
  const queue = createRuntimeCanvasDirtyQueue({
    idsForKey(key) {
      return [dataIdsByKey.get(key) || [], bindingIdsByKey.get(key) || []]
    },
    nodeForId(id) {
      return nodes.get(id)
    }
  })
  return { nodes, queue }
}

test('runtime Canvas dirty keys fan out in bounded batches without duplicate bindings', () => {
  const ids = Array.from({ length: 1200 }, (_, index) => `node-${index}`)
  const { queue } = createHarness(new Map([['shared', ids]]), new Map([['shared', ids]]))
  queue.queueKey('shared')

  const batches = []
  while (queue.hasPending()) batches.push(queue.takeBatch())

  assert.equal(DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE, 512)
  assert.deepEqual(batches.map(batch => batch.nodes.length), [512, 512, 176])
  assert.deepEqual(batches.map(batch => ({ dense: batch.dense, pending: batch.pending })), [
    { dense: true, pending: true },
    { dense: true, pending: true },
    { dense: false, pending: false }
  ])
  assert.equal(new Set(batches.flatMap(batch => batch.nodes.map(node => node.id))).size, ids.length)
})

test('a key updated during its active fanout is replayed for the newest runtime value', () => {
  const ids = Array.from({ length: 700 }, (_, index) => `node-${index}`)
  const { queue } = createHarness(new Map([['shared', ids]]))
  queue.queueKey('shared')

  assert.equal(queue.takeBatch().nodes.length, 512)
  queue.queueKey('shared')

  const remaining = []
  while (queue.hasPending()) remaining.push(...queue.takeBatch().nodes)
  assert.equal(remaining.length, 188 + ids.length)
  assert.deepEqual(remaining.slice(-ids.length).map(node => node.id), ids)
})

test('a full invalidation preempts pending key fanout and is consumed once', () => {
  const { queue } = createHarness(new Map([['shared', ['a', 'b', 'c']]]))
  queue.queueKey('shared')
  queue.queueFull()

  assert.deepEqual(queue.takeBatch(), { full: true, nodes: [], dense: false, pending: false })
  assert.equal(queue.hasPending(), false)
  assert.deepEqual(queue.takeBatch(), { full: false, nodes: [], dense: false, pending: false })
})

test('missing nodes and empty key buckets terminate without an empty-frame loop', () => {
  const { nodes, queue } = createHarness(new Map([
    ['missing', ['a', 'b']],
    ['empty', []]
  ]))
  nodes.clear()
  queue.queueKey('missing')
  queue.queueKey('empty')

  assert.deepEqual(queue.takeBatch(), { full: false, nodes: [], dense: false, pending: false })
  assert.equal(queue.hasPending(), false)
})
