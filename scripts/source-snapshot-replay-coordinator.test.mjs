import assert from 'node:assert/strict'
import test from 'node:test'

import { createSourceSnapshotReplayCoordinator } from '../src/utils/sourceSnapshotReplayCoordinator.js'

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
  const pending = new Map()
  const commits = []
  let active = true
  const coordinator = createSourceSnapshotReplayCoordinator({
    readSnapshot(sourceId) {
      const request = deferred()
      const queue = pending.get(sourceId) || []
      queue.push(request)
      pending.set(sourceId, queue)
      return request.promise
    },
    commitSnapshot(snapshot, options) {
      commits.push({ snapshot, options })
    },
    isActive: () => active
  })
  return {
    coordinator,
    commits,
    request(sourceId, index = 0) {
      return pending.get(sourceId)?.[index]
    },
    setActive(value) {
      active = value
    }
  }
}

test('concurrent replays for unrelated sources both commit', async () => {
  const harness = createHarness()
  const replayA = harness.coordinator.replay(['source-a'])
  const replayB = harness.coordinator.replay(['source-b'], { force: true })

  harness.request('source-b').resolve({ sourceId: 'source-b', data: { value: 2 } })
  harness.request('source-a').resolve({ sourceId: 'source-a', data: { value: 1 } })

  assert.equal(await replayA, true)
  assert.equal(await replayB, true)
  assert.deepEqual(harness.commits, [
    {
      snapshot: { sourceId: 'source-b', data: { value: 2 } },
      options: { replay: true }
    },
    {
      snapshot: { sourceId: 'source-a', data: { value: 1 } },
      options: { replay: false }
    }
  ])
})

test('only the newest replay for the same source may commit', async () => {
  const harness = createHarness()
  const olderReplay = harness.coordinator.replay(['source-a'])
  const newerReplay = harness.coordinator.replay(['source-a'])

  harness.request('source-a', 0).resolve({ sourceId: 'source-a', revision: 1 })
  harness.request('source-a', 1).resolve({ sourceId: 'source-a', revision: 2 })

  assert.equal(await olderReplay, false)
  assert.equal(await newerReplay, true)
  assert.deepEqual(harness.commits.map(entry => entry.snapshot.revision), [2])
})

test('a released replacement token never makes an older source request current again', async () => {
  const harness = createHarness()
  const oldestReplay = harness.coordinator.replay(['source-a'])
  const replacementReplay = harness.coordinator.replay(['source-a'])
  harness.request('source-a', 1).resolve({ sourceId: 'source-a', revision: 2 })
  assert.equal(await replacementReplay, true)

  const newestReplay = harness.coordinator.replay(['source-a'])
  harness.request('source-a', 0).resolve({ sourceId: 'source-a', revision: 1 })
  harness.request('source-a', 2).resolve({ sourceId: 'source-a', revision: 3 })

  assert.equal(await oldestReplay, false)
  assert.equal(await newestReplay, true)
  assert.deepEqual(harness.commits.map(entry => entry.snapshot.revision), [2, 3])
})

test('completed source requests leave no historical token entries', async () => {
  const harness = createHarness()
  const sourceIds = Array.from({ length: 2_000 }, (_, index) => `source-${index}`)
  const replay = harness.coordinator.replay(sourceIds)
  sourceIds.forEach(sourceId => harness.request(sourceId).resolve({ sourceId, data: {} }))

  assert.equal(await replay, true)
  assert.equal(harness.coordinator.state.pendingSources, 0)
})

test('invalidating the lifecycle rejects stale work without blocking a new replay', async () => {
  const harness = createHarness()
  const staleReplay = harness.coordinator.replay(['source-a'])
  harness.coordinator.invalidate()
  const currentReplay = harness.coordinator.replay(['source-a'])

  harness.request('source-a', 0).resolve({ sourceId: 'source-a', revision: 1 })
  harness.request('source-a', 1).resolve({ sourceId: 'source-a', revision: 2 })

  assert.equal(await staleReplay, false)
  assert.equal(await currentReplay, true)
  assert.deepEqual(harness.commits.map(entry => entry.snapshot.revision), [2])
})

test('a temporarily unavailable source does not prevent other sources from replaying', async () => {
  const harness = createHarness()
  const replay = harness.coordinator.replay(['source-a', 'source-b', 'source-a', '  '])

  harness.request('source-a').reject(new Error('offline'))
  harness.request('source-b').resolve({ sourceId: 'source-b', revision: 3 })

  assert.equal(await replay, true)
  assert.deepEqual(harness.commits.map(entry => entry.snapshot.sourceId), ['source-b'])
})

test('a snapshot returned for a different source is ignored', async () => {
  const harness = createHarness()
  const replay = harness.coordinator.replay(['source-a'])
  harness.request('source-a').resolve({ sourceId: 'source-b', revision: 4 })

  assert.equal(await replay, true)
  assert.deepEqual(harness.commits, [])
})

test('inactive component lifecycle prevents late commits', async () => {
  const harness = createHarness()
  const replay = harness.coordinator.replay(['source-a'])
  harness.setActive(false)
  harness.request('source-a').resolve({ sourceId: 'source-a', revision: 1 })

  assert.equal(await replay, false)
  assert.deepEqual(harness.commits, [])
})
