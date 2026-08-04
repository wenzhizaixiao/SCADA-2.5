import assert from 'node:assert/strict'
import test from 'node:test'

import { createLegacyPointReplayCoordinator } from '../src/utils/legacyPointReplayCoordinator.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness() {
  const reads = []
  const commits = []
  const activePointIds = new Set()
  let active = true
  const coordinator = createLegacyPointReplayCoordinator({
    readPoints(pointIds) {
      const request = deferred()
      reads.push({ pointIds, request })
      return request.promise
    },
    commitUpdates(updates) {
      commits.push(updates)
    },
    isActive: () => active,
    isPointActive: pointId => activePointIds.has(pointId)
  })
  return { coordinator, reads, commits, activePointIds, setActive: value => { active = value } }
}

test('reads one deduplicated batch and publishes only requested points that remain active', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  harness.activePointIds.add('point-b')
  const replay = harness.coordinator.replay([' point-a ', 'point-a', 'point-b', ''])

  assert.deepEqual(harness.reads[0].pointIds, ['point-a', 'point-b'])
  harness.activePointIds.delete('point-b')
  harness.reads[0].request.resolve([
    { id: 'point-a', value: 11 },
    { id: 'point-b', value: 22 },
    { id: 'point-foreign', value: 33 }
  ])

  assert.equal(await replay, true)
  assert.deepEqual(harness.commits, [[{ key: 'point-a', value: 11 }]])
})

test('lifecycle invalidation prevents a late point batch from entering a new document', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  const staleReplay = harness.coordinator.replay(['point-a'])
  harness.coordinator.invalidate()
  const currentReplay = harness.coordinator.replay(['point-a'])

  harness.reads[0].request.resolve([{ id: 'point-a', value: 1 }])
  harness.reads[1].request.resolve([{ id: 'point-a', value: 2 }])

  assert.equal(await staleReplay, false)
  assert.equal(await currentReplay, true)
  assert.deepEqual(harness.commits, [[{ key: 'point-a', value: 2 }]])
})

test('an older request cannot overwrite a newer value for the same legacy point', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  const olderReplay = harness.coordinator.replay(['point-a'])
  const newerReplay = harness.coordinator.replay(['point-a'])

  harness.reads[1].request.resolve([{ id: 'point-a', value: 2 }])
  harness.reads[0].request.resolve([{ id: 'point-a', value: 1 }])

  assert.equal(await olderReplay, true)
  assert.equal(await newerReplay, true)
  assert.deepEqual(harness.commits, [[{ key: 'point-a', value: 2 }]])
})

test('a completed replacement can release its token without making an older request current again', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  const oldestReplay = harness.coordinator.replay(['point-a'])
  const replacementReplay = harness.coordinator.replay(['point-a'])
  harness.reads[1].request.resolve([{ id: 'point-a', value: 2 }])
  assert.equal(await replacementReplay, true)

  const newestReplay = harness.coordinator.replay(['point-a'])
  harness.reads[0].request.resolve([{ id: 'point-a', value: 1 }])
  harness.reads[2].request.resolve([{ id: 'point-a', value: 3 }])

  assert.equal(await oldestReplay, true)
  assert.equal(await newestReplay, true)
  assert.deepEqual(harness.commits, [
    [{ key: 'point-a', value: 2 }],
    [{ key: 'point-a', value: 3 }]
  ])
})

test('completed unique point requests leave no historical token entries', async () => {
  const harness = createHarness()
  const pointIds = Array.from({ length: 2_000 }, (_, index) => `point-${index}`)
  pointIds.forEach(pointId => harness.activePointIds.add(pointId))
  const replay = harness.coordinator.replay(pointIds)
  harness.reads[0].request.resolve(pointIds.map((id, value) => ({ id, value })))

  assert.equal(await replay, true)
  assert.equal(harness.coordinator.state.pendingPoints, 0)
})

test('an unavailable catalog keeps static values without rejecting the editor flow', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  const replay = harness.coordinator.replay(['point-a'])
  harness.reads[0].request.reject(new Error('offline'))

  assert.equal(await replay, true)
  assert.deepEqual(harness.commits, [])
})

test('inactive component lifecycle prevents late legacy point publication', async () => {
  const harness = createHarness()
  harness.activePointIds.add('point-a')
  const replay = harness.coordinator.replay(['point-a'])
  harness.setActive(false)
  harness.reads[0].request.resolve([{ id: 'point-a', value: 1 }])

  assert.equal(await replay, false)
  assert.deepEqual(harness.commits, [])
})
