import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORKSPACE_SESSION_CHUNK_FORMAT,
  createWorkspaceSessionRestoreSource,
  createWorkspaceSessionSaveQueue,
  createWorkspaceSessionStore,
  encodeBoundedJsonText,
  isChunkedWorkspaceSessionRecord
} from '../src/services/workspaceSessionStore.js'

function memoryDriver() {
  const values = new Map()
  return {
    values,
    async get(key) { return values.get(key) },
    async put(key, value) { values.set(key, value) },
    async delete(key) { values.delete(key) }
  }
}

test('stops bounded JSON encoding near 4MB without traversing a 36MB-equivalent tail', async () => {
  const maxCharacterLength = 4 * 1024 * 1024
  let lateReads = 0
  let yields = 0
  let clock = 0
  const snapshot = {}
  Object.defineProperty(snapshot, 'payload', {
    enumerable: true,
    value: 'x'.repeat(36 * 1024 * 1024)
  })
  Object.defineProperty(snapshot, 'late', {
    enumerable: true,
    get() {
      lateReads += 1
      return 'must-not-be-read'
    }
  })

  const encoded = await encodeBoundedJsonText(snapshot, {
    maxCharacterLength,
    chunkSize: 64 * 1024,
    timeSliceMs: 4,
    now: () => ++clock,
    yieldControl: async () => { yields += 1 },
    Blob: class ForbiddenBlob { constructor() { throw new Error('Blob must not be created') } }
  })

  assert.equal(encoded.tooLarge, true)
  assert.equal(encoded.text, '')
  assert.equal(encoded.characterLength, maxCharacterLength + 1)
  assert.equal(lateReads, 0)
  assert.ok(yields > 0)
})

test('round-trips bounded JSON text and yields when input is pending', async () => {
  const source = {
    text: 'quoted " text \\ and 图纸',
    values: [undefined, Number.NaN, true, null],
    nested: { kept: 1, omitted: undefined }
  }
  let pending = true
  let yields = 0
  const encoded = await encodeBoundedJsonText(source, {
    maxCharacterLength: 64 * 1024,
    isInputPending: () => pending,
    yieldControl: async () => {
      yields += 1
      pending = false
    }
  })

  assert.equal(encoded.tooLarge, false)
  assert.equal(encoded.text, JSON.stringify(source))
  assert.deepEqual(JSON.parse(encoded.text), JSON.parse(JSON.stringify(source)))
  assert.ok(yields > 0)
})

test('cancels bounded JSON text after a yield when freshness or lifecycle expires', async t => {
  for (const mode of ['stale', 'cancelled']) {
    await t.test(mode, async () => {
      let releaseYield
      let markYieldStarted
      const yieldStarted = new Promise(resolve => { markYieldStarted = resolve })
      const waitForRelease = new Promise(resolve => { releaseYield = resolve })
      let fresh = true
      let cancelled = false
      const encoding = encodeBoundedJsonText({ payload: 'x'.repeat(256 * 1024) }, {
        maxCharacterLength: 512 * 1024,
        isInputPending: () => true,
        isFresh: () => fresh,
        isCancelled: () => cancelled,
        yieldControl: async () => {
          markYieldStarted()
          await waitForRelease
        }
      })
      await yieldStarted
      if (mode === 'stale') fresh = false
      else cancelled = true
      releaseYield()

      await assert.rejects(encoding, error => (
        mode === 'stale'
          ? error?.name === 'StaleWorkspaceSessionSaveError'
          : error?.name === 'ClosedWorkspaceSessionStoreError'
      ))
    })
  }
})

test('stores independent large multi-paper snapshots for multiple workspaces', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  const payload = 'x'.repeat(4 * 1024 * 1024 + 1)

  for (let index = 1; index <= 5; index += 1) {
    const workspace = `workspace-${index}`
    const snapshot = {
      version: 1,
      workspace,
      activeId: `${workspace}-b`,
      sessions: [
        { id: `${workspace}-a`, data: { note: payload } },
        { id: `${workspace}-b`, data: { note: `active-${index}` } }
      ]
    }
    assert.deepEqual(await store.save(workspace, snapshot), { ok: true })
  }

  const restored = await store.load('workspace-1')
  assert.equal(restored.ok, true)
  assert.equal(restored.value.sessions.length, 2)
  assert.equal(restored.value.sessions[0].data.note.length, payload.length)
  assert.equal(restored.value.activeId, 'workspace-1-b')
})

test('stores snapshots as bounded Blob chunks and restores the original value', async () => {
  const driver = memoryDriver()
  let pending = true
  let yields = 0
  let clock = 0
  const store = createWorkspaceSessionStore({
    driver,
    serialization: {
      chunkSize: 48,
      timeSliceMs: 2,
      now: () => ++clock,
      isInputPending: () => pending,
      yieldControl: async () => {
        yields += 1
        pending = false
      }
    }
  })
  const snapshot = {
    version: 1,
    workspace: 'chunked',
    activeId: 'paper-a',
    sessions: [{
      id: 'paper-a',
      data: {
        label: 'quoted " text \\ and unicode 图纸'.repeat(12),
        values: Array.from({ length: 40 }, (_, index) => ({ index, valid: index % 2 === 0 }))
      },
      customHandle: null
    }]
  }

  assert.deepEqual(await store.save('chunked', snapshot), { ok: true })
  const record = driver.values.get('chunked')
  assert.equal(record.__tc2dWorkspaceSessionFormat, WORKSPACE_SESSION_CHUNK_FORMAT)
  assert.ok(record.chunks.length > 1)
  assert.ok(record.chunks.every(chunk => chunk instanceof Blob))
  assert.ok(yields > 0)

  const restored = await store.load('chunked')
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.value, snapshot)
})

test('exposes a chunked restore source without decoding the record on the main thread', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  const customHandle = { kind: 'file', name: 'restored.json' }
  const snapshot = {
    version: 1,
    workspace: 'raw-restore',
    activeId: 'paper-a',
    sessions: [{ id: 'paper-a', data: { payload: 'x'.repeat(256) }, customHandle }]
  }

  assert.deepEqual(await store.save('raw-restore', snapshot), { ok: true })
  const loaded = await store.loadRecord('raw-restore')
  assert.equal(loaded.ok, true)
  assert.equal(loaded.value, driver.values.get('raw-restore'))
  assert.equal(isChunkedWorkspaceSessionRecord(loaded.value), true)

  const source = createWorkspaceSessionRestoreSource(loaded.value)
  assert.ok(source.serialized instanceof Blob)
  assert.equal(source.serialized.size, loaded.value.characterLength)
  assert.deepEqual(source.customHandlePaths, [['sessions', 0, 'customHandle']])
  assert.equal(source.customHandles[0], customHandle)
})

test('loads legacy object records without rewriting or changing their identity', async () => {
  const driver = memoryDriver()
  const legacy = { version: 1, sessions: [{ id: 'legacy', data: { name: 'kept' } }] }
  driver.values.set('legacy', legacy)
  const store = createWorkspaceSessionStore({ driver })

  const restored = await store.load('legacy')
  assert.equal(restored.ok, true)
  assert.equal(restored.value, legacy)
})

test('matches JSON semantics for omitted values, sparse arrays and non-finite numbers', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  const values = [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  values.length = 5
  const snapshot = {
    omitted: undefined,
    values,
    nested: { value: 1, toJSON() { return { converted: true, skipped: undefined } } }
  }

  assert.deepEqual(await store.save('json-semantics', snapshot), { ok: true })
  assert.deepEqual((await store.load('json-semantics')).value, {
    values: [null, null, null, null, null],
    nested: { converted: true }
  })
})

test('persists custom handles outside JSON chunks and restores them by identity', async () => {
  const driver = memoryDriver()
  const customHandle = { kind: 'file', name: 'drawing.json', opaque: true }
  const snapshot = {
    version: 1,
    sessions: [{ id: 'paper', data: {}, customHandle }]
  }
  const store = createWorkspaceSessionStore({ driver })

  assert.deepEqual(await store.save('handles', snapshot), { ok: true })
  const record = driver.values.get('handles')
  assert.deepEqual(record.customHandles, [customHandle])
  assert.equal((await store.load('handles')).value.sessions[0].customHandle, customHandle)
})

test('save queue reliably falls back when IndexedDB cannot clone a custom handle', async () => {
  const driver = memoryDriver()
  const put = driver.put.bind(driver)
  driver.put = async (key, value) => {
    if (value.customHandles?.length) throw new DOMException('cannot clone handle', 'DataCloneError')
    return put(key, value)
  }
  const store = createWorkspaceSessionStore({ driver })
  const queue = createWorkspaceSessionSaveQueue(store)
  const customHandle = { kind: 'file', name: 'drawing.json' }
  const withHandle = { version: 1, sessions: [{ id: 'paper', data: { kept: true }, customHandle }] }
  const withoutHandle = { version: 1, sessions: [{ id: 'paper', data: { kept: true }, customHandle: null }] }

  assert.deepEqual(await queue.save('fallback', withHandle, withoutHandle), { ok: true })
  assert.deepEqual((await store.load('fallback')).value, withoutHandle)
})

test('contains chunk serialization and decode failures', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  const circular = { version: 1 }
  circular.self = circular

  const saveResult = await store.save('circular', circular)
  assert.equal(saveResult.ok, false)
  assert.match(saveResult.error.message, /circular/i)
  assert.equal(driver.values.has('circular'), false)

  driver.values.set('corrupt', {
    __tc2dWorkspaceSessionFormat: WORKSPACE_SESSION_CHUNK_FORMAT,
    chunks: [new Blob(['{"broken":'])],
    customHandles: [],
    customHandlePaths: []
  })
  const loadResult = await store.load('corrupt')
  assert.equal(loadResult.ok, false)
  assert.ok(loadResult.error instanceof Error)
})

test('rejects custom handle paths that leave the decoded snapshot', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  driver.values.set('unsafe-path', {
    __tc2dWorkspaceSessionFormat: WORKSPACE_SESSION_CHUNK_FORMAT,
    formatVersion: 1,
    chunks: [new Blob(['{"version":1}'])],
    customHandles: [{ kind: 'file' }],
    customHandlePaths: [['__proto__', 'customHandle']]
  })

  const result = await store.load('unsafe-path')
  assert.equal(result.ok, false)
  assert.match(result.error.message, /cannot be restored/i)
  assert.equal(Object.hasOwn(Object.prototype, 'customHandle'), false)
})

test('does not replace a previously committed record when a later put fails', async () => {
  const previous = { version: 1, sessions: [{ id: 'previous' }] }
  const driver = memoryDriver()
  driver.values.set('atomic', previous)
  driver.put = async () => { throw new Error('quota exceeded') }
  const store = createWorkspaceSessionStore({ driver })

  assert.equal((await store.save('atomic', { version: 2 })).ok, false)
  assert.equal(driver.values.get('atomic'), previous)
})

test('a stale save stops after a yield and never reaches the driver', async () => {
  let releaseYield
  let markYieldStarted
  const yieldStarted = new Promise(resolve => { markYieldStarted = resolve })
  const waitForRelease = new Promise(resolve => { releaseYield = resolve })
  let fresh = true
  let putCalls = 0
  let clock = 0
  const store = createWorkspaceSessionStore({
    driver: {
      async get() {},
      async put() { putCalls += 1 },
      async delete() {}
    },
    serialization: {
      timeSliceMs: 1,
      now: () => ++clock,
      yieldControl: async () => {
        markYieldStarted()
        await waitForRelease
      }
    }
  })

  const save = store.save('stale', { payload: 'x'.repeat(100_000) }, { isFresh: () => fresh })
  await yieldStarted
  fresh = false
  releaseYield()

  assert.deepEqual(await save, { ok: false, stale: true })
  assert.equal(putCalls, 0)
})

test('closing a store cancels an in-flight encoder before it can write', async () => {
  let releaseYield
  let markYieldStarted
  const yieldStarted = new Promise(resolve => { markYieldStarted = resolve })
  const waitForRelease = new Promise(resolve => { releaseYield = resolve })
  let putCalls = 0
  let closeCalls = 0
  let clock = 0
  const store = createWorkspaceSessionStore({
    driver: {
      async get() {},
      async put() { putCalls += 1 },
      async delete() {},
      close() { closeCalls += 1 }
    },
    serialization: {
      timeSliceMs: 1,
      now: () => ++clock,
      yieldControl: async () => {
        markYieldStarted()
        await waitForRelease
      }
    }
  })

  const save = store.save('closing', { payload: 'x'.repeat(100_000) })
  await yieldStarted
  store.close()
  releaseYield()

  const result = await save
  assert.equal(result.ok, false)
  assert.match(result.error.message, /closed/i)
  assert.equal(putCalls, 0)
  assert.equal(closeCalls, 1)
})

test('removes chunked records through the existing store contract', async () => {
  const driver = memoryDriver()
  const store = createWorkspaceSessionStore({ driver })
  await store.save('remove-me', { version: 1, sessions: [] })
  assert.ok(driver.values.has('remove-me'))
  assert.deepEqual(await store.remove('remove-me'), { ok: true })
  assert.equal(driver.values.has('remove-me'), false)
})

test('contains persistence failures and keeps the caller in control', async () => {
  const failure = new Error('storage unavailable')
  const store = createWorkspaceSessionStore({
    driver: {
      async get() { throw failure },
      async put() { throw failure },
      async delete() { throw failure }
    }
  })

  for (const result of [
    await store.load('workspace'),
    await store.save('workspace', {}),
    await store.remove('workspace')
  ]) {
    assert.equal(result.ok, false)
    assert.equal(result.error, failure)
  }
})

test('rejects empty workspace identifiers without calling the driver', async () => {
  const store = createWorkspaceSessionStore({ driver: memoryDriver() })
  assert.equal((await store.load('')).ok, false)
  assert.equal((await store.save(' ', {})).ok, false)
  assert.equal((await store.remove(null)).ok, false)
})

test('keeps a failed snapshot fallback in the same per-workspace queue task', async () => {
  let releaseFirstSave
  let markFirstSaveStarted
  const firstSave = new Promise(resolve => { releaseFirstSave = resolve })
  const firstSaveStarted = new Promise(resolve => { markFirstSaveStarted = resolve })
  const calls = []
  let persisted = null
  const queue = createWorkspaceSessionSaveQueue({
    async save(workspace, snapshot) {
      calls.push(`${workspace}:${snapshot.id}`)
      if (snapshot.id === 'old-with-handle') {
        markFirstSaveStarted()
        return firstSave
      }
      persisted = snapshot.id
      return { ok: true }
    }
  })

  const oldSave = queue.save('workspace', { id: 'old-with-handle' }, { id: 'old-without-handle' })
  await firstSaveStarted
  const newSave = queue.save('workspace', { id: 'new' })
  assert.deepEqual(calls, ['workspace:old-with-handle'])

  releaseFirstSave({ ok: false })
  assert.deepEqual(await oldSave, { ok: true })
  assert.deepEqual(await newSave, { ok: true })
  assert.deepEqual(calls, ['workspace:old-with-handle', 'workspace:old-without-handle', 'workspace:new'])
  assert.equal(persisted, 'new')
})

test('does not run a custom-handle fallback for a stale queued save', async () => {
  const calls = []
  const queue = createWorkspaceSessionSaveQueue({
    async save(workspace, snapshot) {
      calls.push(`${workspace}:${snapshot.id}`)
      return { ok: false, stale: true }
    }
  })

  assert.deepEqual(
    await queue.save('workspace', { id: 'stale-with-handle' }, { id: 'fallback' }),
    { ok: false, stale: true }
  )
  assert.deepEqual(calls, ['workspace:stale-with-handle'])
})
