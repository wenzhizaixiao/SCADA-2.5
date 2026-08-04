import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  canReuseCanvasRenderSurface,
  createCanvasContextGate,
  restoreCanvasRenderTaskContexts
} from '../src/utils/canvasContextGate.js'

test('a surface without a 2d context is discarded instead of poisoning the reuse pool', () => {
  const broken = { width: 320, height: 180, getContext: () => null }
  const healthyContext = {}
  const healthy = { width: 0, height: 0, getContext: () => healthyContext }
  const created = [broken, healthy]
  const pool = []

  function acquire() {
    return pool.pop() || created.shift()
  }

  function release(surface, requested) {
    const context = surface.getContext('2d')
    if (canReuseCanvasRenderSurface(requested, context)) pool.push(surface)
    else {
      surface.width = 0
      surface.height = 0
    }
  }

  const failedSurface = acquire()
  release(failedSurface, true)
  assert.equal(pool.length, 0)
  assert.deepEqual({ width: failedSurface.width, height: failedSurface.height }, { width: 0, height: 0 })

  const recoveredSurface = acquire()
  assert.equal(recoveredSurface, healthy)
  assert.equal(recoveredSurface.getContext('2d'), healthyContext)
})

test('the production surface pool revalidates contexts at every release boundary', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const releaseStart = source.indexOf('function releaseRenderSurface')
  const releaseEnd = source.indexOf('function clearReusableRenderSurfaces', releaseStart)
  const release = source.slice(releaseStart, releaseEnd)

  assert.match(release, /surface\.getContext\?\.\('2d'\)/)
  assert.match(release, /canReuseCanvasRenderSurface\(reusable, context\)/)
  assert.ok(release.indexOf("surface.getContext?.('2d')") < release.indexOf('reusableRenderSurfaces.push(surface)'))
})

test('canvas context tokens reject lost, restored, and replaced targets', () => {
  const gate = createCanvasContextGate()
  const first = {}
  const second = {}
  const context = {}

  const firstToken = gate.capture(first)
  assert.equal(gate.accepts(firstToken, first, context), true)

  assert.equal(gate.markLost(first), true)
  assert.equal(gate.state().lost, true)
  assert.equal(gate.accepts(firstToken, first, context), false)

  assert.equal(gate.markRestored(first), true)
  const restoredToken = gate.capture(first)
  assert.equal(gate.accepts(restoredToken, first, context), true)
  assert.equal(gate.accepts(firstToken, first, context), false)

  const secondToken = gate.capture(second)
  assert.equal(gate.accepts(restoredToken, first, context), false)
  assert.equal(gate.accepts(secondToken, second, context), true)
  assert.equal(gate.markLost(first), false)
})

test('canvas context release invalidates delayed commits and ignores stale events', () => {
  const gate = createCanvasContextGate()
  const target = {}
  const token = gate.capture(target)

  assert.equal(gate.release(target), true)
  assert.equal(gate.accepts(token, target, {}), false)
  assert.equal(gate.markLost(target), false)
  assert.equal(gate.markRestored(target), false)
  assert.equal(gate.release(target), false)
})

test('discarded render tasks balance saved contexts before same-size surface reuse', () => {
  function savedContext() {
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

  const ctx = savedContext()
  const staticCtx = savedContext()
  ctx.save()
  staticCtx.save()
  const task = { ctx, staticCtx, contextRestored: false }

  assert.equal(restoreCanvasRenderTaskContexts(task), true)
  assert.equal(ctx.depth, 0)
  assert.equal(staticCtx.depth, 0)
  assert.equal(task.contextRestored, true)
  assert.equal(task.staticCtx, null)

  assert.equal(restoreCanvasRenderTaskContexts(task), true)
  assert.equal(ctx.depth, 0)
  assert.equal(staticCtx.depth, 0)
})

test('failed context restoration prevents a discarded surface from being reused', () => {
  const task = {
    ctx: { restore() { throw new Error('context lost') } },
    staticCtx: null,
    contextRestored: false
  }

  assert.equal(restoreCanvasRenderTaskContexts(task), false)
  assert.equal(task.contextRestored, true)
  assert.equal(task.contextRestoreFailed, true)
  assert.equal(restoreCanvasRenderTaskContexts(task), false)
})

test('render errors quarantine full and runtime surfaces from the reuse pool', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const fullRelease = source.match(/function releaseRenderTask\([\s\S]*?(?=\nfunction replaceCommittedStaticSurface)/)?.[0] || ''
  const runtimeRelease = source.match(/function releaseRuntimeRenderTask\([\s\S]*?(?=\nfunction runtimeRenderCompletion)/)?.[0] || ''

  assert.match(fullRelease, /reason !== 'error'/)
  assert.match(fullRelease, /task\.surfaceReusable !== false/)
  assert.match(runtimeRelease, /reason !== 'error'/)
  assert.match(runtimeRelease, /task\.surfaceReusable !== false/)
})

test('geometry patch failures restore both backing contexts and queue an authoritative frame', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const staticPlan = source.match(/function drawGeometryStaticPlan\([\s\S]*?(?=\nfunction drawGeometryCompositePlan)/)?.[0] || ''
  const compositePlan = source.match(/function drawGeometryCompositePlan\([\s\S]*?(?=\nfunction replaceGeometryOwnerSegments)/)?.[0] || ''
  const commit = source.match(/function commitGeometryPlans\([\s\S]*?(?=\nfunction applyGeometrySnapshot)/)?.[0] || ''

  for (const draw of [staticPlan, compositePlan]) {
    assert.match(draw, /ctx\.save\(\)[\s\S]*?try\s*\{[\s\S]*?finally\s*\{\s*ctx\.restore\(\)/)
  }
  assert.match(commit, /catch \(error\)[\s\S]*?committedGeometryIndexesComplete = false[\s\S]*?requestCoalescedRender\(\)/)
})
