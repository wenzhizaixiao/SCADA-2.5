import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createChunkedRenderScheduler } from '../src/utils/chunkedRenderScheduler.js'
import {
  createIncrementalTextLayout,
  finishIncrementalTextLayout,
  runIncrementalTextLayoutSlice
} from '../src/utils/incrementalTextLayout.js'

const LONG_TEXT = 'A'.repeat(50_001)
const SLICE_OPERATION_LIMIT = 128

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

function assertSourceMatch(source, pattern, message) {
  assert.ok(pattern.test(source), message)
}

function createManualSchedule() {
  let nextId = 1
  const pending = new Map()
  const cancelled = []
  return {
    schedule(callback) {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    cancel(id) {
      const callback = pending.get(id)
      if (callback) cancelled.push(callback)
      pending.delete(id)
    },
    flushOne() {
      const entry = pending.entries().next().value
      if (!entry) return false
      const [id, callback] = entry
      pending.delete(id)
      callback()
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
      for (const callback of cancelled.splice(0)) callback()
    },
    get size() { return pending.size }
  }
}

function createBalancedContext() {
  let depth = 0
  return {
    save() { depth += 1 },
    restore() {
      if (depth <= 0) throw new Error('unbalanced restore')
      depth -= 1
    },
    get depth() { return depth }
  }
}

function cursorField(path) {
  return path === 'sparse' ? 'candidateCursor' : 'entityCursor'
}

function createTextRenderTask(payload) {
  const field = cursorField(payload.path)
  return {
    path: payload.path,
    items: [{ id: `${payload.path}-text`, text: payload.text }],
    [field]: 0,
    textLayoutWork: null,
    privateSurface: [],
    ctx: createBalancedContext(),
    slices: 0,
    surfaceReusable: true
  }
}

function measureMonospace(value) {
  return String(value).length * 6
}

function runTextRenderSlice(task, _deadline, options = {}) {
  const field = cursorField(task.path)
  const item = task.items[task[field]]
  if (!item) return true
  if (!task.textLayoutWork) {
    task.textLayoutWork = {
      item,
      state: createIncrementalTextLayout(item.text, {
        orientation: 'horizontal',
        maxWidth: 60
      })
    }
  }

  task.ctx.save()
  try {
    const result = runIncrementalTextLayoutSlice(
      task.textLayoutWork.state,
      options.measureText || measureMonospace,
      { shouldYield: () => false },
      { operationLimit: options.operationLimit || SLICE_OPERATION_LIMIT }
    )
    task.slices += 1
    if (!result.done) return false

    const prepared = finishIncrementalTextLayout(task.textLayoutWork.state)
    task.privateSurface.push({ id: item.id, lineCount: prepared.lines.length })
    task.textLayoutWork = null
    task[field] += 1
    return task[field] >= task.items.length
  } catch (error) {
    task.surfaceReusable = false
    throw error
  } finally {
    task.ctx.restore()
  }
}

function releaseTextRenderTask(task, _payload, reason) {
  if (!task) return
  task.textLayoutWork = null
  task.privateSurface.length = 0
  if (reason === 'error') task.surfaceReusable = false
}

function assertDeferredCursorPath(body, collection, cursor) {
  const access = body.search(new RegExp(`task\\.${collection}\\[\\s*task\\.${cursor}\\s*\\]`))
  const draw = body.search(/\b(?:drawNode|drawTaskEntity|drawRenderEntity|drawEntityIncrementally)\s*\(/)
  const advanceAfterDraw = draw < 0
    ? -1
    : body.slice(draw).search(new RegExp(`task\\.${cursor}\\s*\\+=\\s*1`))
  assert.ok(access >= 0, `expected ${collection} to read ${cursor} without advancing it`)
  assert.ok(draw > access, `expected ${collection} to draw the current item`)
  assert.ok(advanceAfterDraw > 0, `expected ${cursor} to advance only after the current item is drawn`)
}

test('MiniMapPreview wires incremental long-text preparation into every render path', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const incrementalImport = source.match(/import\s*\{([\s\S]*?)\}\s*from '\.\.\/utils\/incrementalTextLayout'/)?.[1] || ''
  for (const symbol of [
    'createIncrementalTextLayout',
    'finishIncrementalTextLayout',
    'runIncrementalTextLayoutSlice'
  ]) {
    assertSourceMatch(incrementalImport, new RegExp(`\\b${symbol}\\b`), `MiniMapPreview must import ${symbol}`)
  }
  assertSourceMatch(source, /const LONG_TEXT_INCREMENTAL_THRESHOLD = 512/, 'long text threshold must remain 512')
  assertSourceMatch(source, /\btextLayoutWork\b/, 'render tasks need one active textLayoutWork slot')
  assertSourceMatch(source, /runIncrementalTextLayoutSlice\s*\(/, 'production rendering must execute incremental layout slices')
  assertSourceMatch(source, /finishIncrementalTextLayout\s*\(/, 'production rendering must finish prepared layouts')
  const incrementalDraw = sourceBetween(source, 'function drawEntityIncrementally', 'function edgeRasterCommand')
  assertSourceMatch(
    incrementalDraw,
    /drawNode\(\s*task\.ctx,[\s\S]*?\{\s*node:\s*textLayout\?\.node\s*\|\|\s*preparedNode,\s*textLayout,\s*animationTimestamp:\s*task\.animationTimestamp\s*\}\s*\)/,
    'drawNode must receive the prepared text layout and current task animation timestamp'
  )
  assertSourceMatch(
    source,
    /function drawNode\([^)]*opacityMultiplier[^)]*(?:prepared|options|textLayout)[^)]*\)/,
    'prepared text must not replace the geometry opacity argument'
  )

  const drawText = sourceBetween(source, 'function drawText', 'function drawRuntimeBadge')
  assertSourceMatch(drawText, /(?:prepared|options\?\.textLayout|textLayout)/, 'drawText must accept prepared layout data')
  assertSourceMatch(
    drawText,
    /if\s*\(\s*prepared\w*\?\.baseline\s*\)[\s\S]{0,400}?\}\s*else\s*\{[\s\S]{0,400}?baselineCanvasTextLayout\s*\(/,
    'prepared text must bypass synchronous baseline layout'
  )
  assertSourceMatch(
    drawText,
    /drawVerticalText\([\s\S]{0,300}?(?:baselineLayout|drawLayout)\?\.columns/,
    'vertical text must consume prepared columns'
  )
  assertSourceMatch(
    drawText,
    /drawHorizontalText\([\s\S]{0,300}?(?:baselineLayout|drawLayout)\?\.lines/,
    'horizontal text must consume prepared lines'
  )

  const full = sourceBetween(source, 'function drawEntities', 'function runRenderSlice')
  const dense = sourceBetween(source, 'function drawDenseRuntimeEntities', 'function finishRuntimeRegion')
  const sparse = sourceBetween(source, 'function runRuntimeRenderSlice', 'function releaseRuntimeRenderTask')
  assertDeferredCursorPath(full, 'entities', 'entityCursor')
  assertDeferredCursorPath(dense, 'entities', 'entityCursor')
  assertDeferredCursorPath(sparse, 'candidates', 'candidateCursor')
})

test('MiniMapPreview clears pending text work and quarantines error surfaces', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const fullRelease = sourceBetween(source, 'function releaseRenderTask', 'function replaceCommittedStaticSurface')
  const runtimeRelease = sourceBetween(source, 'function releaseRuntimeRenderTask', 'function runtimeRenderCompletion')

  for (const release of [fullRelease, runtimeRelease]) {
    assertSourceMatch(release, /textLayoutWork\s*=\s*null/, 'discard must clear pending textLayoutWork')
    assertSourceMatch(release, /reason\s*!==\s*'error'/, 'error surfaces must remain quarantined')
  }
  const sliceCall = source.indexOf('runIncrementalTextLayoutSlice(')
  assert.ok(sliceCall >= 0, 'expected an incremental layout slice call')
  const sliceScope = source.slice(Math.max(0, sliceCall - 1_500), sliceCall + 2_000)
  assertSourceMatch(
    sliceScope,
    /try\s*\{[\s\S]*?runIncrementalTextLayoutSlice\s*\([\s\S]*?finally\s*\{[\s\S]*?restore\s*\(/,
    'every incremental layout slice must restore its canvas context'
  )
})

test('geometry local patches fall back instead of synchronously laying out long text', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const geometry = sourceBetween(source, 'function geometryPatchPlans', 'function commitGeometryPlans')
  const apply = sourceBetween(source, 'function applyGeometrySnapshot', 'function beginRuntimeBackingMutation')

  assertSourceMatch(
    geometry,
    /(?:LONG_TEXT_INCREMENTAL_THRESHOLD|\b\w*(?:LongText|IncrementalText)\w*\s*\()/,
    'geometry patch planning must detect text that requires incremental layout'
  )
  assertSourceMatch(geometry, /return\s+(?:null|false)/, 'geometry patch planning needs an explicit fallback')
  assertSourceMatch(
    apply,
    /if\s*\([^)]*!\s*(?:plans|commitGeometryPlans)[^)]*\)\s*return false/,
    'geometry patch fallback must reach the authoritative full-render path'
  )
  assert.ok(!/finishIncrementalTextLayout\s*\(/.test(geometry), 'geometry patches must not synchronously finish long text')
})

test('50k text yields across slices without advancing full, dense, or sparse cursors', () => {
  for (const path of ['full', 'dense', 'sparse']) {
    const task = createTextRenderTask({ path, text: LONG_TEXT })
    const field = cursorField(path)
    let done = false

    while (!done) {
      done = runTextRenderSlice(task)
      assert.equal(task.ctx.depth, 0, `${path} must restore canvas state after every slice`)
      if (!done) {
        assert.equal(task[field], 0, `${path} advanced its cursor before layout completion`)
        assert.deepEqual(task.privateSurface, [], `${path} exposed a partial text draw`)
      }
    }

    assert.ok(task.slices > 1, `${path} did not yield long text`)
    assert.equal(task[field], 1)
    assert.deepEqual(task.privateSurface, [{ id: `${path}-text`, lineCount: 5_001 }])
    assert.equal(task.textLayoutWork, null)
  }
})

test('the visible surface commits once after a 50k text layout is complete', () => {
  const manual = createManualSchedule()
  const visible = { revision: 'previous', items: ['old'] }
  let commitCount = 0
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    createTask: createTextRenderTask,
    runSlice: runTextRenderSlice,
    commit(task, payload) {
      commitCount += 1
      visible.revision = payload.revision
      visible.items = task.privateSurface.map(item => item.id)
    },
    discard: releaseTextRenderTask
  })

  scheduler.request({ path: 'full', text: LONG_TEXT, revision: 'complete' })
  for (let index = 0; index < 8; index += 1) {
    assert.equal(manual.flushOne(), true)
    assert.deepEqual(visible, { revision: 'previous', items: ['old'] })
    assert.equal(commitCount, 0)
  }
  assert.ok(manual.size > 0)

  manual.flushAll()
  assert.equal(commitCount, 1)
  assert.deepEqual(visible, { revision: 'complete', items: ['full-text'] })
})

test('cancellation and errors discard pending layout state and restore the context', () => {
  const manual = createManualSchedule()
  const discarded = []
  const errors = []
  const commits = []
  const tasks = []
  let failingMeasure = null
  const scheduler = createChunkedRenderScheduler({
    budgetMs: 2,
    schedule: callback => manual.schedule(callback),
    cancel: handle => manual.cancel(handle),
    createTask(payload) {
      const task = createTextRenderTask(payload)
      tasks.push(task)
      return task
    },
    runSlice(task, deadline) {
      return runTextRenderSlice(task, deadline, { measureText: failingMeasure || measureMonospace })
    },
    commit(task, payload) { commits.push(payload.revision) },
    discard(task, payload, reason) {
      discarded.push({ revision: payload.revision, reason, reusable: task.surfaceReusable })
      releaseTextRenderTask(task, payload, reason)
    },
    onError(error, detail) { errors.push({ message: error.message, phase: detail.phase }) }
  })

  scheduler.request({ path: 'dense', text: LONG_TEXT, revision: 'cancelled' })
  manual.flushOne()
  const cancelledTask = tasks[0]
  assert.ok(cancelledTask.textLayoutWork)
  assert.equal(cancelledTask.entityCursor, 0)
  assert.equal(cancelledTask.ctx.depth, 0)

  scheduler.request({ path: 'dense', text: 'short', revision: 'replacement' })
  assert.equal(cancelledTask.textLayoutWork, null)
  assert.deepEqual(discarded, [{ revision: 'cancelled', reason: 'superseded', reusable: true }])
  manual.flushCancelled()
  manual.flushAll()
  assert.deepEqual(commits, ['replacement'])

  failingMeasure = () => { throw new Error('measure failed') }
  scheduler.request({ path: 'sparse', text: LONG_TEXT, revision: 'broken' })
  manual.flushOne()
  const failedTask = tasks.at(-1)
  assert.equal(failedTask.ctx.depth, 0)
  assert.equal(failedTask.textLayoutWork, null)
  assert.equal(failedTask.surfaceReusable, false)
  assert.deepEqual(errors, [{ message: 'measure failed', phase: 'run' }])
  assert.deepEqual(discarded.at(-1), { revision: 'broken', reason: 'error', reusable: false })
  assert.deepEqual(commits, ['replacement'])
})
