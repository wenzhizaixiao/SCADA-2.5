import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createChunkedRenderScheduler,
  createCoalescedRenderTrigger
} from '../src/utils/chunkedRenderScheduler.js'

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

function createManualSchedule() {
  let nextId = 1
  const pending = new Map()
  const cancelledCallbacks = []
  const cancelledHandles = []

  return {
    schedule(callback) {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    cancel(id) {
      const callback = pending.get(id)
      if (callback) cancelledCallbacks.push(callback)
      cancelledHandles.push(id)
      pending.delete(id)
    },
    flushOne(hostDeadline) {
      const entry = pending.entries().next().value
      if (!entry) return false
      const [id, callback] = entry
      pending.delete(id)
      callback(hostDeadline)
      return true
    },
    flushAll(limit = 100_000) {
      let count = 0
      while (this.flushOne()) {
        count += 1
        if (count > limit) throw new Error('manual schedule did not settle')
      }
      return count
    },
    flushCancelled() {
      const callbacks = cancelledCallbacks.splice(0)
      callbacks.forEach(callback => callback())
    },
    cancelledHandles,
    get size() { return pending.size }
  }
}

function createClock() {
  let value = 0
  return {
    now: () => value,
    advance(amount = 1) { value += amount }
  }
}

test('coalesced render trigger flushes many requests through one scheduled callback', () => {
  const manual = createManualSchedule()
  let flushes = 0
  const trigger = createCoalescedRenderTrigger({
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    flush: () => { flushes += 1 }
  })

  assert.equal(trigger.request(), true)
  assert.equal(trigger.request(), false)
  assert.equal(trigger.request(), false)
  assert.equal(manual.size, 1)
  assert.equal(trigger.state.pending, true)

  manual.flushAll()
  assert.equal(flushes, 1)
  assert.equal(trigger.state.pending, false)

  assert.equal(trigger.request(), true)
  manual.flushAll()
  assert.equal(flushes, 2)
})

test('coalesced render trigger ignores cancelled and disposed callbacks', () => {
  const manual = createManualSchedule()
  let flushes = 0
  const trigger = createCoalescedRenderTrigger({
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    flush: () => { flushes += 1 }
  })

  trigger.request()
  assert.equal(trigger.cancel(), true)
  trigger.request()
  manual.flushCancelled()
  assert.equal(flushes, 0)
  assert.equal(trigger.state.pending, true, 'a stale cancelled callback must not consume its replacement')
  manual.flushAll()
  assert.equal(flushes, 1)

  trigger.request()
  trigger.dispose()
  manual.flushCancelled()
  assert.equal(flushes, 1)
  assert.equal(trigger.state.disposed, true)
  assert.equal(trigger.request(), false)
})

function phasedTask(payload) {
  return {
    edges: payload.edges,
    nodes: payload.nodes,
    edgeIndex: 0,
    nodeIndex: 0,
    target: { edgeCount: 0, nodeCount: 0 }
  }
}

function runPhasedSlice(clock, sliceCounts) {
  return (task, deadline) => {
    let processed = 0
    while (!deadline.shouldYield()) {
      if (task.edgeIndex < task.edges.length) {
        task.edgeIndex += 1
        task.target.edgeCount += 1
      } else if (task.nodeIndex < task.nodes.length) {
        task.nodeIndex += 1
        task.target.nodeCount += 1
      } else break
      processed += 1
      clock.advance(1)
    }
    sliceCounts.push(processed)
    return task.edgeIndex === task.edges.length && task.nodeIndex === task.nodes.length
  }
}

test('large edge and node collections are split across 3ms render slices', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const sliceCounts = []
  const commits = []
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 3,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: phasedTask,
    runSlice: runPhasedSlice(clock, sliceCounts),
    commit: task => commits.push({ ...task.target })
  })

  scheduler.request({
    edges: Array.from({ length: 2_000 }, (_, index) => ({ id: `edge-${index}` })),
    nodes: Array.from({ length: 10_000 }, (_, index) => ({ id: `node-${index}` }))
  })

  assert.equal(commits.length, 0)
  assert.equal(manual.flushOne(), true)
  assert.equal(sliceCounts[0], 3)
  assert.equal(commits.length, 0)
  assert.equal(manual.size, 1)

  manual.flushAll()
  assert.ok(sliceCounts.length > 1)
  assert.ok(Math.max(...sliceCounts) <= 3)
  assert.deepEqual(commits, [{ edgeCount: 2_000, nodeCount: 10_000 }])
  assert.deepEqual(scheduler.state, { generation: 1, pending: false, scheduled: false, disposed: false })
})

test('reads a dynamic render budget at the start of every slice', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const sliceCounts = []
  let budgetMs = 2
  const scheduler = createChunkedRenderScheduler({
    budgetMs: () => budgetMs,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: phasedTask,
    runSlice: runPhasedSlice(clock, sliceCounts),
    commit: () => {}
  })

  scheduler.request({ edges: [], nodes: Array(6).fill({}) })
  manual.flushOne()
  budgetMs = 4
  manual.flushOne()

  assert.deepEqual(sliceCounts, [2, 4])
  assert.equal(scheduler.state.pending, false)
})

test('a superseded job does not create or discard resources before its first slice', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const created = []
  const commits = []
  const discards = []
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => {
      created.push(payload.name)
      return { ...phasedTask(payload), name: payload.name }
    },
    runSlice: runPhasedSlice(clock, []),
    commit: task => commits.push(task.name),
    discard: (task, payload, reason) => discards.push({ name: task.name, reason })
  })

  scheduler.request({ name: 'old', edges: Array(4).fill({}), nodes: [] })
  scheduler.request({ name: 'new', edges: [], nodes: Array(2).fill({}) })

  assert.deepEqual(created, [])
  assert.deepEqual(discards, [])
  assert.equal(manual.cancelledHandles.length, 1)

  manual.flushCancelled()
  manual.flushAll()
  assert.deepEqual(created, ['new'])
  assert.deepEqual(commits, ['new'])
  assert.deepEqual(discards, [])
})

test('host idle deadlines defer creation when time is short and bound slice work', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const created = []
  const sliceCounts = []
  let hostTimeRemaining
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 3,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => {
      created.push(payload.name)
      return phasedTask(payload)
    },
    runSlice(task, deadline) {
      let processed = 0
      while (task.nodeIndex < task.nodes.length && !deadline.shouldYield()) {
        task.nodeIndex += 1
        processed += 1
        clock.advance(1)
        if (typeof hostTimeRemaining === 'number') hostTimeRemaining = Math.max(0, hostTimeRemaining - 2)
      }
      sliceCounts.push(processed)
      return task.nodeIndex === task.nodes.length
    },
    commit: () => {}
  })

  scheduler.request({ name: 'idle', edges: [], nodes: Array(6).fill({}) })
  manual.flushOne({ didTimeout: false, timeRemaining: () => 1 })
  assert.deepEqual(created, [])
  assert.deepEqual(sliceCounts, [])
  assert.equal(manual.size, 1)

  hostTimeRemaining = 4
  manual.flushOne({ didTimeout: false, timeRemaining: () => hostTimeRemaining })
  assert.deepEqual(created, ['idle'])
  assert.deepEqual(sliceCounts, [2])
  assert.equal(manual.size, 1)

  hostTimeRemaining = 0
  manual.flushOne({ didTimeout: false, timeRemaining: () => hostTimeRemaining })
  assert.deepEqual(sliceCounts, [2])
  assert.equal(manual.size, 1)
})

test('a timed-out idle callback makes bounded progress instead of starving', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const sliceCounts = []
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 3,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: phasedTask,
    runSlice: runPhasedSlice(clock, sliceCounts),
    commit: () => {}
  })

  scheduler.request({ edges: Array(5).fill({}), nodes: [] })
  manual.flushOne({ didTimeout: true, timeRemaining: () => 0 })

  assert.deepEqual(sliceCounts, [1])
  assert.equal(scheduler.state.pending, true)
  assert.equal(manual.size, 1)
  manual.flushAll()
  assert.equal(scheduler.state.pending, false)
})

test('a new request cancels and discards an older partially rendered generation', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const commits = []
  const discards = []
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => ({ ...phasedTask(payload), name: payload.name }),
    runSlice: runPhasedSlice(clock, []),
    commit: task => commits.push(task.name),
    discard: (task, payload, reason) => discards.push({ name: task.name, reason })
  })

  scheduler.request({ name: 'old', edges: Array(8).fill({}), nodes: [] })
  manual.flushOne()
  assert.equal(manual.size, 1)

  scheduler.request({ name: 'new', edges: [], nodes: Array(2).fill({}) })
  assert.equal(manual.cancelledHandles.length, 1)
  assert.deepEqual(discards, [{ name: 'old', reason: 'superseded' }])

  manual.flushCancelled()
  manual.flushAll()
  assert.deepEqual(commits, ['new'])
  assert.equal(manual.size, 0)
  assert.equal(scheduler.state.generation, 2)
})

test('invalidate retires created work once and the scheduler remains reusable', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const commits = []
  const discards = []
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => ({ ...phasedTask(payload), name: payload.name }),
    runSlice: runPhasedSlice(clock, []),
    commit: task => commits.push(task.name),
    discard: (task, payload, reason) => discards.push({ name: task.name, reason })
  })

  assert.equal(scheduler.invalidate('empty'), 1)
  assert.deepEqual(discards, [])
  scheduler.request({ name: 'cancelled', edges: Array(8).fill({}), nodes: [] })
  manual.flushOne()
  assert.equal(scheduler.invalidate('geometry'), 3)
  assert.deepEqual(discards, [{ name: 'cancelled', reason: 'geometry' }])
  manual.flushCancelled()
  assert.deepEqual(commits, [])
  assert.deepEqual(discards, [{ name: 'cancelled', reason: 'geometry' }])

  scheduler.request({ name: 'replacement', edges: [], nodes: Array(2).fill({}) })
  manual.flushAll()
  assert.deepEqual(commits, ['replacement'])
  assert.equal(scheduler.state.generation, 4)
})

test('the visible canvas changes only after the private target is complete', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const visible = { revision: 'previous', count: 1 }
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => ({ items: payload.items, index: 0, target: { revision: payload.revision, count: 0 } }),
    runSlice(task, deadline) {
      while (task.index < task.items.length && !deadline.shouldYield()) {
        task.index += 1
        task.target.count += 1
        clock.advance(1)
      }
      return task.index === task.items.length
    },
    commit(task) { Object.assign(visible, task.target) }
  })

  scheduler.request({ revision: 'next', items: Array(5).fill(null) })
  manual.flushOne()
  assert.deepEqual(visible, { revision: 'previous', count: 1 })
  manual.flushOne()
  assert.deepEqual(visible, { revision: 'previous', count: 1 })
  manual.flushAll()
  assert.deepEqual(visible, { revision: 'next', count: 5 })
})

test('a failed commit discards the completed private task exactly once', () => {
  const manual = createManualSchedule()
  const discards = []
  const task = { released: false }
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    createTask: () => task,
    runSlice: () => true,
    commit: () => { throw new Error('commit failed') },
    discard: (discardedTask, payload, reason) => {
      discardedTask.released = true
      discards.push({ payload, reason })
    }
  })

  const payload = { revision: 'broken' }
  scheduler.request(payload)

  assert.throws(() => manual.flushOne(), /commit failed/)
  assert.equal(task.released, true)
  assert.deepEqual(discards, [{ payload, reason: 'error' }])
  assert.deepEqual(scheduler.state, { generation: 1, pending: false, scheduled: false, disposed: false })
  scheduler.dispose()
  assert.equal(discards.length, 1)
})

test('reports a slice error once and remains reusable when an error handler is installed', () => {
  const manual = createManualSchedule()
  const discards = []
  const errors = []
  const commits = []
  let fail = true
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    createTask: payload => ({ name: payload.name }),
    runSlice() {
      if (fail) throw new Error('slice failed')
      return true
    },
    commit: task => commits.push(task.name),
    discard: (task, payload, reason) => discards.push({ name: task.name, reason }),
    onError: (error, detail) => errors.push({ message: error.message, ...detail })
  })

  scheduler.request({ name: 'broken' })
  assert.doesNotThrow(() => manual.flushOne())
  assert.deepEqual(discards, [{ name: 'broken', reason: 'error' }])
  assert.deepEqual(errors.map(({ message, phase, generation, payload }) => ({ message, phase, generation, payload })), [{
    message: 'slice failed',
    phase: 'run',
    generation: 1,
    payload: { name: 'broken' }
  }])
  assert.equal(scheduler.state.pending, false)

  fail = false
  scheduler.request({ name: 'recovered' })
  manual.flushAll()
  assert.deepEqual(commits, ['recovered'])
  assert.equal(discards.length, 1)
})

test('reports an initial scheduling error and remains reusable', () => {
  const manual = createManualSchedule()
  const errors = []
  const commits = []
  let failSchedule = true
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule(callback) {
      if (failSchedule) {
        failSchedule = false
        throw new Error('schedule failed')
      }
      return manual.schedule(callback)
    },
    cancel: handle => manual.cancel(handle),
    createTask: payload => ({ name: payload.name }),
    runSlice: () => true,
    commit: task => commits.push(task.name),
    onError: (error, detail) => errors.push({ message: error.message, ...detail })
  })

  assert.equal(scheduler.request({ name: 'broken' }), null)
  assert.deepEqual(errors.map(({ message, phase, generation, payload }) => ({ message, phase, generation, payload })), [{
    message: 'schedule failed',
    phase: 'schedule',
    generation: 1,
    payload: { name: 'broken' }
  }])
  assert.equal(scheduler.state.pending, false)

  scheduler.request({ name: 'recovered' })
  manual.flushAll()
  assert.deepEqual(commits, ['recovered'])
})

test('dispose cancels queued work, discards its target, and blocks future requests', () => {
  const manual = createManualSchedule()
  const clock = createClock()
  const commits = []
  const discards = []
  let created = 0
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 1,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    now: clock.now,
    createTask: payload => { created += 1; return phasedTask(payload) },
    runSlice: runPhasedSlice(clock, []),
    commit: task => commits.push(task),
    discard: (task, payload, reason) => discards.push(reason)
  })

  scheduler.request({ edges: Array(5).fill({}), nodes: [] })
  manual.flushOne()
  assert.equal(manual.size, 1)

  scheduler.dispose()
  assert.equal(manual.size, 0)
  assert.deepEqual(discards, ['disposed'])
  assert.deepEqual(scheduler.state, { generation: 2, pending: false, scheduled: false, disposed: true })

  manual.flushCancelled()
  assert.equal(manual.size, 0)
  assert.deepEqual(commits, [])
  assert.equal(scheduler.request({ edges: [], nodes: [] }), null)
  assert.equal(created, 1)
  scheduler.dispose()
  assert.deepEqual(discards, ['disposed'])
})

test('MiniMapPreview connects every large phase to the private chunked render target', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const createTask = sourceBetween(source, 'function createRenderTask', 'function prepareNodeIndex')
  const prepareNodeIndex = sourceBetween(source, 'function prepareNodeIndex', 'function prepareFallbackEntities')
  const prepareEntities = sourceBetween(source, 'function prepareFallbackEntities', 'function sortFallbackEntities')
  const sortEntities = sourceBetween(source, 'function sortFallbackEntities', 'function drawEntities')
  const drawEntities = sourceBetween(source, 'function drawEntities', 'function runRenderSlice')
  const runSlice = sourceBetween(source, 'function runRenderSlice', 'function releaseRenderTask')
  const release = sourceBetween(source, 'function releaseRenderTask', 'function commitRenderTask')
  const commit = sourceBetween(source, 'function commitRenderTask', 'const renderScheduler')
  const teardown = sourceBetween(source, 'onBeforeUnmount(() => {', '</script>')
  const runtimeTask = sourceBetween(source, 'function createRuntimeRenderTask', 'function finishRuntimeRegion')
  const runtimeRegion = sourceBetween(source, 'function prepareRuntimeRegion', 'function runRuntimeRenderSlice')
  const runtimeSlice = sourceBetween(source, 'function runRuntimeRenderSlice', 'function releaseRuntimeRenderTask')
  const runtimeCommit = sourceBetween(source, 'function commitRuntimeRenderTask', 'const runtimeRenderScheduler')

  assert.match(source, /createChunkedRenderScheduler,[\s\S]*?createCoalescedRenderTrigger[\s\S]*?from '\.\.\/utils\/chunkedRenderScheduler'/)
  assert.match(source, /commitCanvasSurface,[\s\S]*?commitCanvasSurfaceWithResize[\s\S]*?from '\.\.\/utils\/canvasSurfaceCommit'/)
  assert.match(source, /canReuseCanvasRenderSurface,[\s\S]*?createCanvasContextGate,[\s\S]*?restoreCanvasRenderTaskContexts[\s\S]*?from '\.\.\/utils\/canvasContextGate'/)
  assert.match(source, /const DEFAULT_RENDER_SLICE_BUDGET_MS = 2/)
  assert.match(source, /const MIN_RENDER_SLICE_BUDGET_MS = 1/)
  assert.match(source, /const MAX_RENDER_SLICE_BUDGET_MS = 6/)
  assert.match(source, /const RUNTIME_RENDER_SLICE_BUDGET_MS = 2/)
  assert.match(source, /const RUNTIME_REGION_MERGE_SIZE = 512/)
  assert.match(source, /const RUNTIME_CURSOR_OPERATION_LIMIT = 4096/)
  assert.match(source, /function normalizedRenderSliceBudgetMs\(value\)[\s\S]*?return DEFAULT_RENDER_SLICE_BUDGET_MS[\s\S]*?Math\.min\(MAX_RENDER_SLICE_BUDGET_MS, Math\.max\(MIN_RENDER_SLICE_BUDGET_MS, requested\)\)/)
  assert.match(source, /function scheduleRenderSlice\([\s\S]*?requestIdleCallback\([\s\S]*?setTimeout\(/)
  assert.match(source, /function cancelRenderSlice\([\s\S]*?cancelIdleCallback\([\s\S]*?clearTimeout\(/)
  assert.match(source, /function acquireRenderSurface\(width, height, reusable\)[\s\S]*?reusableRenderSurfaces\.pop\(\)[\s\S]*?document\.createElement\('canvas'\)/)
  assert.match(createTask, /acquireRenderSurface\(bitmapWidth, bitmapHeight, reuseSurfaces\)/)
  assert.match(createTask, /surface\.getContext\('2d'\)/)
  assert.match(createTask, /reuseSurfaces: canReuseCanvasRenderSurface\(reuseSurfaces, ctx\)/)
  assert.doesNotMatch(createTask, /payload\.target\.getContext/)
  assert.match(source, /function drawStaticEdges\(task, deadline\)[\s\S]*?drawEdges\([\s\S]*?deadline/)
  assert.doesNotMatch(source, /function copyCanvasSurface/)

  for (const phase of [prepareNodeIndex, prepareEntities, sortEntities, drawEntities, runSlice]) {
    assert.match(phase, /deadline\.shouldYield\(\)/)
  }
  assert.match(sourceBetween(source, 'function drawEdges', 'function drawTemporaryDrawing'), /deadline\.shouldYield\(\)/)
  assert.doesNotMatch(runSlice, /canvas\.value|target\.getContext|drawImage/)

  assert.match(release, /const contextsRestored = restoreCanvasRenderTaskContexts\(task\)[\s\S]*?const reuseSurfaces = task\.reuseSurfaces && contextsRestored/)
  assert.match(release, /releaseRenderSurface\(task\.surface, reuseSurfaces\)/)
  assert.match(release, /releaseRenderSurface\(task\.staticSurface, reuseSurfaces\)/)
  assert.match(source, /const MAX_REUSABLE_RENDER_SURFACES = 2/)
  assert.match(source, /function releaseRenderSurface\(surface, reusable\)[\s\S]*?reusableRenderSurfaces\.push\(surface\)[\s\S]*?surface\.width = 0/)
  assert.match(commit, /target\.getContext\('2d'\)/)
  assert.match(commit, /commitCanvasSurfaceWithResize\(target, task\.surface,[\s\S]*?createBackup:[\s\S]*?releaseBackup:/)
  assert.match(commit, /finally \{\s*releaseRenderTask\(task\)/)
  assert.match(source, /createChunkedRenderScheduler\(\{[\s\S]*?budgetMs: \(\) => normalizedRenderSliceBudgetMs\(props\.renderBudgetMs\)[\s\S]*?schedule: scheduleRenderSlice[\s\S]*?cancel: cancelRenderSlice[\s\S]*?createTask: createRenderTask[\s\S]*?runSlice: runRenderSlice[\s\S]*?commit: commitRenderTask[\s\S]*?discard: releaseRenderTask,[\s\S]*?onError: \(error, detail\) => reportCanvasRenderError/)
  assert.match(source, /const runtimeRenderScheduler = createChunkedRenderScheduler\(\{[\s\S]*?budgetMs: RUNTIME_RENDER_SLICE_BUDGET_MS[\s\S]*?createTask: createRuntimeRenderTask[\s\S]*?runSlice: runRuntimeRenderSlice[\s\S]*?commit: commitRuntimeRenderTask[\s\S]*?discard: releaseRuntimeRenderTask,[\s\S]*?onError: \(error, detail\) => reportCanvasRenderError/)
  assert.match(runtimeTask, /createRuntimeRegionAccumulator\(\{[\s\S]*?mergeCellSize: RUNTIME_REGION_MERGE_SIZE[\s\S]*?nodes,[\s\S]*?nodeCursor: 0[\s\S]*?phase: 'regions'/)
  assert.match(runtimeTask, /function prepareRuntimeRegions\(task, deadline\)[\s\S]*?while \(task\.nodeCursor < task\.nodes\.length\)[\s\S]*?regionAccumulator\.add\(task\.nodes\[task\.nodeCursor\]\)[\s\S]*?deadline\.shouldYield\(\)[\s\S]*?regionAccumulator\.createCursor\(\)/)
  assert.doesNotMatch(runtimeTask, /regionAccumulator\.values\(\)/)
  assert.match(runtimeRegion, /task\.regionCursor\?\.next\(\)/)
  assert.match(runtimeRegion, /task\.spatialIndex\.createQueryCursor\(task\.region, \{ sort: false \}\)[\s\S]*?createRuntimeCandidateCursor\([\s\S]*?createRuntimeQueryCursor\(querySources\)/)
  assert.match(runtimeRegion, /task\.candidateWork\.runSlice\(deadline, RUNTIME_CURSOR_OPERATION_LIMIT\)/)
  assert.doesNotMatch(runtimeRegion, /\.query\([^)]*\)[\s\S]*?\.filter\([^)]*\)[\s\S]*?\.sort\(/)
  assert.match(runtimeRegion, /task\.ctx\.drawImage\(\s*task\.base,/)
  assert.match(runtimeSlice, /deadline\.shouldYield\(\)/)
  assert.match(runtimeCommit, /commitCanvasSurface\(targetContext, task\.composite, task\.bitmapRects\)/)
  assert.doesNotMatch(runtimeCommit, /targetContext\.clearRect|for \(const rect of task\.bitmapRects\)/)
  assert.doesNotMatch(runtimeTask + runtimeRegion + runtimeSlice, /props\.nodes|payload\.nodes\.filter|for \(const node of props\.nodes/)
  assert.match(teardown, /renderScheduler\.dispose\(\)/)
  assert.match(teardown, /runtimeRenderScheduler\.dispose\(\)/)
  assert.match(teardown, /imageRenderTrigger\.dispose\(\)/)
  assert.match(teardown, /replaceCommittedStaticSurface\(null\)/)
  assert.match(teardown, /replaceCommittedCompositeSurface\(null\)/)
  assert.doesNotMatch(source, /\brenderFrame\b|\brenderTimer\b|\brenderIdle\b/)
})
