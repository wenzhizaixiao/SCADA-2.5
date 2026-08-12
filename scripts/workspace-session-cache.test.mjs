import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWorkspaceSessionCache,
  prepareWorkspaceSessionSnapshot,
  prepareWorkspaceSessionSnapshotAsync
} from '../src/utils/workspaceSessionCache.js'

function cachePersisted(cache, workspace) {
  cache.set(workspace, { workspace })
  const version = cache.beginSave(workspace)
  assert.equal(cache.completeSave(workspace, version), true)
}

test('evicts only the oldest workspace whose latest snapshot was persisted', () => {
  const cache = createWorkspaceSessionCache(3)
  cachePersisted(cache, 'w1')
  cachePersisted(cache, 'w2')
  cachePersisted(cache, 'w3')
  cachePersisted(cache, 'w4')
  assert.deepEqual([...cache].map(([workspace]) => workspace), ['w2', 'w3', 'w4'])
})

test('a failed latest save protects memory through later trims', () => {
  const cache = createWorkspaceSessionCache(3)
  cachePersisted(cache, 'w1')
  cache.beginSave('w1')
  cachePersisted(cache, 'w2')
  cachePersisted(cache, 'w3')
  cachePersisted(cache, 'w4')

  assert.equal(cache.size, 3)
  assert.ok(cache.get('w1'))
  assert.deepEqual([...cache].map(([workspace]) => workspace), ['w1', 'w3', 'w4'])
})

test('an older queued save cannot mark a newer snapshot as persisted', () => {
  const cache = createWorkspaceSessionCache(2)
  cache.set('w1', {})
  const staleVersion = cache.beginSave('w1')
  const latestVersion = cache.beginSave('w1')
  assert.equal(cache.completeSave('w1', staleVersion), false)

  cachePersisted(cache, 'w2')
  cachePersisted(cache, 'w3')
  assert.equal(cache.size, 2)
  assert.ok(cache.get('w1'))

  assert.equal(cache.completeSave('w1', latestVersion), true)
  assert.equal(cache.size, 2)
  assert.ok(cache.get('w1'))
})

test('an edit invalidates an in-flight save before the next debounce begins', () => {
  const cache = createWorkspaceSessionCache(2)
  cache.set('w1', {})
  const inFlightVersion = cache.beginSave('w1')

  cache.markDirty('w1')
  assert.equal(cache.completeSave('w1', inFlightVersion), false)

  cachePersisted(cache, 'w2')
  cachePersisted(cache, 'w3')
  assert.equal(cache.size, 2)
  assert.ok(cache.get('w1'))
  assert.ok(cache.get('w3'))
})

test('reports save freshness before persistence reaches storage', () => {
  const cache = createWorkspaceSessionCache(2)
  cache.set('w1', {})
  const version = cache.beginSave('w1')
  assert.equal(cache.isSaveCurrent('w1', version), true)

  cache.markDirty('w1')
  assert.equal(cache.isSaveCurrent('w1', version), false)
})

test('reports dirty state without creating another save version', () => {
  const cache = createWorkspaceSessionCache(2)
  cache.set('w1', {})
  assert.equal(cache.isDirty('w1'), false)

  cache.markDirty('w1')
  assert.equal(cache.isDirty('w1'), true)
  const version = cache.beginSave('w1')
  assert.equal(cache.isDirty('w1'), true)
  assert.equal(cache.completeSave('w1', version), true)
  assert.equal(cache.isDirty('w1'), false)

  cache.markDirty('w1')
  assert.equal(cache.isDirty('w1'), true)
})

test('supports updating every cached workspace from a stable iteration snapshot', () => {
  const cache = createWorkspaceSessionCache(3)
  for (const workspace of ['w1', 'w2', 'w3']) cache.set(workspace, { detached: false })
  for (const [workspace, value] of [...cache]) cache.set(workspace, { ...value, detached: true })
  assert.deepEqual([...cache].map(([workspace, value]) => [workspace, value.detached]), [
    ['w1', true], ['w2', true], ['w3', true]
  ])
})

test('filters corrupt persisted papers without losing valid sessions', () => {
  const prepared = prepareWorkspaceSessionSnapshot({
    version: 1,
    workspace: 'w1',
    activeId: 'broken',
    sessions: [
      { id: 'valid', data: { name: 'kept' }, history: null },
      { id: 'broken', data: { corrupt: true } },
      { id: 'valid', data: { name: 'duplicate' } }
    ]
  }, 'w1', data => {
    if (data.corrupt) throw new Error('invalid project')
    return { ...data, prepared: true }
  })

  assert.equal(prepared.sanitized, true)
  assert.equal(prepared.activeId, 'valid')
  assert.deepEqual(prepared.sessions.map(session => session.data), [{ name: 'kept', prepared: true }])
  assert.deepEqual(prepared.sessions[0].history, [])
})

test('rejects a persisted snapshot when no paper can be prepared', () => {
  const prepared = prepareWorkspaceSessionSnapshot({
    version: 1,
    workspace: 'w1',
    activeId: 'broken',
    sessions: [{ id: 'broken', data: {} }]
  }, 'w1', () => { throw new Error('invalid project') })
  assert.equal(prepared, null)
})

test('prepares persisted papers asynchronously in order and filters rejected sessions', async () => {
  let active = 0
  let maxActive = 0
  const calls = []
  const prepared = await prepareWorkspaceSessionSnapshotAsync({
    version: 1,
    workspace: 'w1',
    activeId: 'second',
    sessions: [
      { id: 'first', data: { name: 'first' }, history: null },
      { id: 'broken', data: { name: 'broken' } },
      { id: 'second', data: { name: 'second' }, future: null }
    ]
  }, 'w1', async data => {
    active += 1
    maxActive = Math.max(maxActive, active)
    calls.push(data.name)
    await Promise.resolve()
    active -= 1
    if (data.name === 'broken') throw new Error('invalid project')
    return { ...data, prepared: true }
  })

  assert.equal(maxActive, 1)
  assert.deepEqual(calls, ['first', 'broken', 'second'])
  assert.equal(prepared.sanitized, true)
  assert.equal(prepared.activeId, 'second')
  assert.deepEqual(prepared.sessions.map(session => session.data.name), ['first', 'second'])
  assert.deepEqual(prepared.sessions[0].history, [])
  assert.deepEqual(prepared.sessions[1].future, [])
})

test('rejects an asynchronous persisted snapshot when no paper can be prepared', async () => {
  const prepared = await prepareWorkspaceSessionSnapshotAsync({
    version: 1,
    workspace: 'w1',
    activeId: 'broken',
    sessions: [{ id: 'broken', data: {} }]
  }, 'w1', async () => { throw new Error('invalid project') })
  assert.equal(prepared, null)
})

test('removes stale legacy drawing history without discarding node and edge undo data', () => {
  const drawingRecord = { id: 'legacy-drawing', index: 0, value: { id: 'legacy-drawing', points: [] } }
  const nodeRecord = { id: 'node-a', index: 0, value: null }
  const edgeRecord = { id: 'edge-a', index: 0, value: null }
  const source = {
    version: 1,
    workspace: 'legacy-history',
    activeId: 'paper',
    sessions: [{
      id: 'paper',
      data: { name: 'prepared' },
      history: [
        { kind: 'entities', nodes: [], edges: [], drawings: [drawingRecord] },
        { kind: 'entities', nodes: [nodeRecord], edges: [edgeRecord], drawings: [drawingRecord] },
        { kind: 'fields', nodes: [{ id: 'node-a', values: { text: 'before' } }], drawings: [{ id: 'legacy-drawing' }] },
        { kind: 'geometry', nodes: [], drawings: [{ id: 'legacy-drawing', points: [] }] },
        { kind: 'layers', order: ['drawing:legacy-drawing', 'node:node-a'] }
      ],
      future: [{ kind: 'geometry', nodes: [{ id: 'node-a', x: 1, y: 2 }], drawings: [{ id: 'legacy-drawing' }] }]
    }]
  }
  const original = structuredClone(source)

  const prepared = prepareWorkspaceSessionSnapshot(source, 'legacy-history', data => data)

  assert.equal(prepared.sanitized, true)
  assert.deepEqual(prepared.sessions[0].history, [
    { kind: 'entities', nodes: [nodeRecord], edges: [edgeRecord], drawings: [] },
    { kind: 'fields', nodes: [{ id: 'node-a', values: { text: 'before' } }], drawings: [] },
    { kind: 'layers', order: ['drawing:legacy-drawing', 'node:node-a'] }
  ])
  assert.deepEqual(prepared.sessions[0].future, [
    { kind: 'geometry', nodes: [{ id: 'node-a', x: 1, y: 2 }], drawings: [] }
  ])
  assert.deepEqual(source, original)
})
