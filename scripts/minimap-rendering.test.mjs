import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  commitCanvasSurface,
  commitCanvasSurfaceWithResize
} from '../src/utils/canvasSurfaceCommit.js'
import { edgeBoundsForNodes, edgeEndpointsForNodes } from '../src/utils/edgeGeometry.js'
import { multiplyOpacity, NODE_MOVE_INTERACTION_OPACITY } from '../src/utils/interactionOpacity.js'
import { createSpatialIndex } from '../src/utils/spatialIndex.js'
import {
  miniMapTransform,
  miniMapViewportRect,
  miniMapWorldPoint
} from '../src/utils/miniMapGeometry.js'
import {
  createRuntimeCandidateCursor,
  createRuntimeQueryCursor,
  createRuntimeRegionAccumulator,
  runtimeBitmapRect,
  runtimeNodeBitmapRect,
  runtimeNodeRegion
} from '../src/utils/runtimeCanvasRegions.js'
import {
  RUNTIME_DENSE_BITMAP_COVERAGE,
  RUNTIME_DENSE_NODE_THRESHOLD,
  createRuntimeBitmapCoverageTracker,
  shouldUseDenseRuntime
} from '../src/utils/runtimeCanvasStrategy.js'
import {
  nextPreviewMountBatchScale,
  partitionRetainedPreviewNodes,
  previewMountBatchEnd,
  previewNodeMountCost
} from '../src/utils/previewMountBudget.js'

const EPSILON = 1e-10

function collectRuntimeRegions(nodes, options) {
  const accumulator = createRuntimeRegionAccumulator(options)
  for (const node of nodes) accumulator.add(node)
  return accumulator.values()
}

function createCommitContext({ drawError = null } = {}) {
  const calls = []
  const context = {
    globalCompositeOperation: 'source-over',
    save() { calls.push(['save']) },
    restore() { calls.push(['restore']); this.globalCompositeOperation = 'source-over' },
    setTransform(...values) { calls.push(['setTransform', ...values]) },
    beginPath() { calls.push(['beginPath']) },
    rect(...values) { calls.push(['rect', ...values]) },
    clip() { calls.push(['clip']) },
    drawImage(...values) {
      calls.push(['drawImage', ...values])
      if (drawError) throw drawError
    }
  }
  return { calls, context }
}

function createResizeCommitContext(draw) {
  return {
    globalCompositeOperation: 'source-over',
    save() {},
    restore() { this.globalCompositeOperation = 'source-over' },
    setTransform() {},
    drawImage: draw
  }
}

test('commits a complete Canvas surface with one non-destructive copy', () => {
  const { calls, context } = createCommitContext()
  const surface = { width: 100, height: 60 }

  assert.equal(commitCanvasSurface(context, surface), true)
  assert.equal(calls.filter(call => call[0] === 'drawImage').length, 1)
  assert.equal(calls.some(call => call[0] === 'beginPath'), false)
  assert.equal(context.globalCompositeOperation, 'source-over')
})

test('commits sparse Canvas regions through one union clip and one draw', () => {
  const { calls, context } = createCommitContext()
  const surface = { width: 100, height: 60 }

  assert.equal(commitCanvasSurface(context, surface, [
    { x: -4, y: 2, w: 12, h: 10 },
    { x: 90, y: 50, w: 20, h: 20 }
  ]), true)
  assert.deepEqual(calls.filter(call => call[0] === 'rect'), [
    ['rect', 0, 2, 8, 10],
    ['rect', 90, 50, 10, 10]
  ])
  assert.equal(calls.filter(call => call[0] === 'clip').length, 1)
  assert.equal(calls.filter(call => call[0] === 'drawImage').length, 1)
})

test('a failed Canvas copy restores state without clearing the visible frame', () => {
  const error = new Error('copy failed')
  const { calls, context } = createCommitContext({ drawError: error })

  assert.throws(
    () => commitCanvasSurface(context, { width: 100, height: 60 }, [{ x: 0, y: 0, w: 10, h: 10 }]),
    error
  )
  assert.equal(calls.some(call => call[0] === 'clearRect'), false)
  assert.equal(calls.at(-1)[0], 'restore')
  assert.equal(context.globalCompositeOperation, 'source-over')
})

test('a failed size-changing Canvas commit restores the previous visible frame', () => {
  let content = 'previous'
  let failNextFrame = true
  let released = 0
  const targetContext = createResizeCommitContext(surface => {
    if (surface.id === 'next' && failNextFrame) {
      failNextFrame = false
      throw new Error('copy failed')
    }
    content = surface.content ?? surface.id
  })
  const target = {
    _width: 100,
    _height: 60,
    get width() { return this._width },
    set width(value) { this._width = value; content = 'cleared' },
    get height() { return this._height },
    set height(value) { this._height = value; content = 'cleared' },
    getContext: () => targetContext
  }
  const backup = {
    id: 'backup',
    width: 100,
    height: 60,
    content: null,
    getContext() {
      return createResizeCommitContext(source => { this.content = source === target ? content : source.content })
    }
  }

  assert.throws(() => commitCanvasSurfaceWithResize(target, {
    id: 'next',
    width: 200,
    height: 120
  }, {
    acceptContext: context => context === targetContext,
    createBackup: () => backup,
    releaseBackup: () => { released += 1 }
  }), /copy failed/)
  assert.equal(target.width, 100)
  assert.equal(target.height, 60)
  assert.equal(content, 'previous')
  assert.equal(released, 1)
})

function assertClose(actual, expected, message, epsilon = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, received ${actual}`)
}

function assertPointClose(actual, expected, message) {
  assertClose(actual.x, expected.x, `${message} x`)
  assertClose(actual.y, expected.y, `${message} y`)
}

test('multiplies persisted node opacity by the render-only move opacity', async () => {
  assertClose(multiplyOpacity(0.5, NODE_MOVE_INTERACTION_OPACITY), 0.31, 'custom opacity must be preserved')
  assert.equal(multiplyOpacity(undefined, NODE_MOVE_INTERACTION_OPACITY), NODE_MOVE_INTERACTION_OPACITY)
  assert.equal(multiplyOpacity(2, NODE_MOVE_INTERACTION_OPACITY), NODE_MOVE_INTERACTION_OPACITY)
  assert.equal(multiplyOpacity(0.5, 1), 0.5, 'the release frame must restore persisted opacity')

  const previewSource = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const drawNode = previewSource.match(/function drawNode\([\s\S]*?(?=\nfunction drawTemporaryDrawing)/)?.[0] || ''
  const snapshot = previewSource.match(/function geometrySnapshot\([\s\S]*?(?=\nfunction geometryRegions)/)?.[0] || ''
  const composite = previewSource.match(/function drawGeometryCompositePlan\([\s\S]*?(?=\nfunction replaceGeometryOwnerSegments)/)?.[0] || ''
  const commit = previewSource.match(/function commitGeometryPlans\([\s\S]*?(?=\nfunction applyGeometrySnapshot)/)?.[0] || ''

  assert.match(drawNode, /opacityMultiplier = 1/)
  assert.match(drawNode, /ctx\.globalAlpha = multiplyOpacity\(node\.opacity, opacityMultiplier\)/)
  assert.match(snapshot, /activeNodeIds: new Set\(nodes\.map\(node => node\.id\)\)/)
  assert.match(snapshot, /nodeOpacityMultiplier: alpha\(source\.nodeOpacityMultiplier\)/)
  assert.match(composite, /snapshot\.activeNodeIds\.has\(item\.entity\.id\) \? snapshot\.nodeOpacityMultiplier : 1/)
  assert.match(composite, /drawNode\([^\n]+opacityMultiplier\)/)
  assert.match(commit, /drawGeometryCompositePlan\(compositeContext, plan, snapshot\)/)
})

test('entity render flags preserve edge-only Canvas output across every render path', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const payload = source.match(/function renderPayload\(\)[\s\S]*?(?=\nfunction createGeometrySpatialIndex)/)?.[0] || ''
  const staticEntities = source.match(/function prepareFallbackEntities[\s\S]*?(?=\nfunction sortFallbackEntities)/)?.[0] || ''
  const drawEntities = source.match(/function drawEntities[\s\S]*?(?=\nfunction runRenderSlice)/)?.[0] || ''
  const denseRuntime = source.match(/function drawDenseRuntimeEntities[\s\S]*?(?=\nfunction finishRuntimeRegion)/)?.[0] || ''
  const runtimeRegion = source.match(/function prepareRuntimeRegion[\s\S]*?(?=\nfunction beginRuntimeRegionDraw)/)?.[0] || ''
  const runtimeSlice = source.match(/function runRuntimeRenderSlice[\s\S]*?(?=\nfunction releaseRuntimeRenderTask)/)?.[0] || ''
  const geometryPlans = source.match(/function geometryPatchPlans[\s\S]*?(?=\nfunction drawGeometryStaticPlan)/)?.[0] || ''
  const geometryComposite = source.match(/function drawGeometryCompositePlan[\s\S]*?(?=\nfunction replaceGeometryOwnerSegments)/)?.[0] || ''

  assert.match(source, /renderNodes: \{ type: Boolean, default: true \}/)
  assert.match(source, /renderDrawings: \{ type: Boolean, default: true \}/)
  assert.match(payload, /renderNodes: props\.renderNodes/)
  assert.match(payload, /renderDrawings: props\.renderDrawings/)
  assert.match(source, /renderNodes: payload\.renderNodes !== false/)
  assert.match(source, /renderDrawings: payload\.renderDrawings !== false/)
  assert.match(staticEntities, /task\.renderNodes && !task\.excludedNodeIds/)
  assert.match(staticEntities, /task\.renderDrawings && !task\.excludedDrawingIds/)
  assert.match(drawEntities, /if \(!task\.renderNodes\)[\s\S]*?drawEntityIncrementally/)
  assert.match(drawEntities, /if \(!task\.renderDrawings\)[\s\S]*?drawTemporaryDrawing/)
  assert.match(denseRuntime, /task\.renderDrawings && !task\.excludedDrawingIds/)
  assert.match(denseRuntime, /task\.renderNodes && !task\.excludedNodeIds/)
  assert.match(runtimeRegion, /if \(task\.renderNodes\)[\s\S]*?kind: 'node'/)
  assert.match(runtimeRegion, /task\.renderDrawings && typeof task\.drawingSpatialIndex/)
  assert.match(runtimeSlice, /task\.renderDrawings && !task\.excludedDrawingIds/)
  assert.match(runtimeSlice, /task\.renderNodes && !task\.excludedNodeIds/)
  assert.match(geometryPlans, /frame\.renderNodes[\s\S]*?props\.spatialIndex\.query/)
  assert.match(geometryPlans, /frame\.renderDrawings[\s\S]*?geometryOwnersForRegion\(committedDrawingSpatialIndex/)
  assert.match(geometryComposite, /if \(!frame\.renderNodes\) continue/)
  assert.match(geometryComposite, /else if \(frame\.renderDrawings\) drawTemporaryDrawing/)
  assert.match(source, /renderNodes: task\.renderNodes,[\s\S]*?renderDrawings: task\.renderDrawings,[\s\S]*?frameCommitToken/)
  assert.match(source, /\(\) => props\.renderNodes,[\s\S]*?\(\) => props\.renderDrawings/)
})

test('local edge-only Canvas streams spatial matches within the render budget', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const payload = source.match(/function renderPayload\(\)[\s\S]*?(?=\nfunction createGeometrySpatialIndex)/)?.[0] || ''
  const task = source.match(/function createRenderTask\(payload, generation\)[\s\S]*?(?=\nfunction prepareNodeIndex)/)?.[0] || ''
  const spatialEdges = source.match(/function queryAndDrawSpatialEdges\(task, deadline\)[\s\S]*?(?=\nfunction prepareFallbackEntities)/)?.[0] || ''
  const renderSlice = source.match(/function runRenderSlice\(task, deadline\)[\s\S]*?(?=\nfunction releaseRenderTask)/)?.[0] || ''

  assert.match(source, /edgeSpatialIndex: \{ type: Object, default: null \}/)
  assert.match(payload, /edgeSpatialIndex: props\.edgeSpatialIndex/)
  assert.match(task, /transform\.viewBox && typeof payload\.edgeSpatialIndex\?\.createQueryCursor === 'function'/)
  assert.match(task, /payload\.edgeSpatialIndex\.createQueryCursor\(transform\.viewBox, \{ sort: false \}\)/)
  assert.match(task, /edges: edgeSourceCursor \? \[\] : \(payload\.edges \|\| \[\]\)/)
  assert.match(spatialEdges, /edgeSourceCursor\.runSlice\(\{[\s\S]*?maxOperations: 256/)
  assert.match(spatialEdges, /shouldYield: \(\) => deadline\.shouldYield\(\)/)
  assert.match(spatialEdges, /const edgeContext = task\.incrementalRuntime \? task\.staticCtx : task\.ctx[\s\S]*?onMatch\(edge\)[\s\S]*?task\.edges\.push\(edge\)[\s\S]*?drawEdge\(edgeContext, edge/)
  assert.match(spatialEdges, /if \(!result\.done\) return false[\s\S]*?finishEdgePass\(task\)/)
  assert.match(renderSlice, /task\.phase === 'edgeQuery'[\s\S]*?queryAndDrawSpatialEdges\(task, deadline\)/)
})

test('incremental full frames paint static edges once before copying them into the composite surface', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const task = source.match(/function createRenderTask\(payload, generation\)[\s\S]*?(?=\nfunction prepareNodeIndex)/)?.[0] || ''
  const nodeIndex = source.match(/function prepareNodeIndex\(task, deadline\)[\s\S]*?(?=\nfunction finishEdgePass)/)?.[0] || ''
  const edgeFinish = source.match(/function finishEdgePass\(task\)[\s\S]*?(?=\nfunction queryAndDrawSpatialEdges)/)?.[0] || ''
  const spatialEdges = source.match(/function queryAndDrawSpatialEdges\(task, deadline\)[\s\S]*?(?=\nfunction prepareFallbackEntities)/)?.[0] || ''
  const staticSurface = source.match(/function prepareStaticRenderSurface\(task\)[\s\S]*?(?=\nfunction drawStaticEdges)/)?.[0] || ''
  const staticEdges = source.match(/function drawStaticEdges\(task, deadline\)[\s\S]*?(?=\nfunction composeStaticRenderSurface)/)?.[0] || ''
  const compose = source.match(/function composeStaticRenderSurface\(task\)[\s\S]*?(?=\nfunction drawEntities)/)?.[0] || ''
  const renderSlice = source.match(/function runRenderSlice\(task, deadline\)[\s\S]*?(?=\nfunction releaseRenderTask)/)?.[0] || ''

  assert.match(task, /if \(!payload\.incrementalRuntime\) fillRenderBackground\(ctx, payload\.background, stageWidth, stageHeight\)/)
  assert.match(task, /phase: sharedNodeIndex \? initialEdgeRenderPhase\(Boolean\(payload\.incrementalRuntime\), edgeSourceCursor\) : 'nodeIndex'/)
  assert.match(nodeIndex, /task\.phase = initialEdgeRenderPhase\(task\.incrementalRuntime, task\.edgeSourceCursor\)/)
  assert.match(edgeFinish, /task\.incrementalRuntime[\s\S]*?task\.staticCtx\.restore\(\)[\s\S]*?task\.phase = 'composeStaticSurface'/)
  assert.doesNotMatch(edgeFinish, /prepareStaticSurface/)
  assert.match(spatialEdges, /const edgeContext = task\.incrementalRuntime \? task\.staticCtx : task\.ctx[\s\S]*?drawEdge\(edgeContext, edge/)
  assert.match(staticSurface, /task\.phase = task\.edgeSourceCursor \? 'edgeQuery' : 'staticEdges'/)
  assert.match(staticSurface, /task\.incrementalRuntime = false[\s\S]*?fillRenderBackground\(task\.ctx,[\s\S]*?initialEdgeRenderPhase\(false, task\.edgeSourceCursor\)/)
  assert.match(staticEdges, /drawEdges\([\s\S]*?task\.staticCtx[\s\S]*?deadline,[\s\S]*?task[\s\S]*?finishEdgePass\(task\)/)
  assert.match(compose, /commitCanvasSurface\(task\.ctx, task\.staticSurface\)[\s\S]*?task\.phase = task\.usesSharedEntities \? 'entities' : 'prepareEntities'/)
  assert.match(compose, /task\.incrementalRuntime = false[\s\S]*?task\.edgeCursor = 0[\s\S]*?task\.phase = 'edges'/)
  assert.match(renderSlice, /task\.phase === 'prepareStaticSurface'[\s\S]*?task\.phase === 'staticEdges'[\s\S]*?task\.phase === 'composeStaticSurface'/)
})

test('task rendering yields to a cancellable animation frame after two message slices', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const taskYield = source.match(/function scheduleTaskRenderSlice\(callback\)[\s\S]*?(?=\nfunction resetTaskRenderFrameYield)/)?.[0] || ''
  const resetYield = source.match(/function resetTaskRenderFrameYield\(\)[\s\S]*?(?=\nfunction scheduleRenderSlice)/)?.[0] || ''
  const schedule = source.match(/function scheduleRenderSlice\(callback\)[\s\S]*?(?=\nfunction cancelRenderSlice)/)?.[0] || ''
  const teardown = source.slice(source.indexOf('onBeforeUnmount(() =>'))

  assert.match(source, /const TASK_RENDER_MAX_CONSECUTIVE_SLICES = 2/)
  assert.match(taskYield, /if \(!supportsFrameRender\) return scheduleTaskRender\(callback\)/)
  assert.match(taskYield, /taskRenderConsecutiveSlices < TASK_RENDER_MAX_CONSECUTIVE_SLICES[\s\S]*?taskRenderConsecutiveSlices \+= 1[\s\S]*?scheduleTaskRender\(callback\)/)
  assert.match(taskYield, /taskRenderConsecutiveSlices = 0[\s\S]*?requestAnimationFrame\(\(\) => callback\(\)\)/)
  assert.match(resetYield, /taskRenderConsecutiveSlices = 0/)
  assert.match(schedule, /props\.renderMode === 'task'\) return scheduleTaskRenderSlice\(callback\)/)
  assert.match(schedule, /resetTaskRenderFrameYield\(\)/)
  assert.match(source, /handle\?\.type === 'frame'\) globalThis\.cancelAnimationFrame\(handle\.id\)/)
  assert.match(teardown, /resetTaskRenderFrameYield\(\)/)
})

test('maps changed runtime nodes to clipped bitmap restore regions', () => {
  const rotated = { id: 'gauge-1', x: 10, y: 20, w: 100, h: 40, rotate: 90 }
  assert.deepEqual(runtimeNodeRegion(rotated, { stageWidth: 200, stageHeight: 200, padding: 2 }), {
    x: 38,
    y: 0,
    w: 44,
    h: 92
  })
  assert.equal(collectRuntimeRegions([rotated, { ...rotated }], {
    stageWidth: 200,
    stageHeight: 200,
    padding: 2
  }).length, 1, 'a repeated changed node must restore one region')
  assert.deepEqual(collectRuntimeRegions([
    { id: 'a', x: 10, y: 10, w: 20, h: 20 },
    { id: 'b', x: 80, y: 40, w: 20, h: 20 }
  ], { stageWidth: 200, stageHeight: 200, padding: 0, mergeCellSize: 128 }), [
    { x: 10, y: 10, w: 90, h: 50 }
  ])

  assert.deepEqual(runtimeBitmapRect({ x: 10, y: 20, w: 30, h: 40 }, {
    bitmapWidth: 400,
    bitmapHeight: 300,
    pixelRatioX: 2,
    pixelRatioY: 2,
    scaleX: .5,
    scaleY: .5,
    offsetX: 0,
    offsetY: 25
  }, 2), { x: 8, y: 68, w: 34, h: 44 })
})

test('filters runtime nodes against the committed local Canvas frame', () => {
  const frame = {
    stageWidth: 1000,
    stageHeight: 800,
    bitmapWidth: 200,
    bitmapHeight: 100,
    pixelRatioX: 1,
    pixelRatioY: 1,
    scaleX: 1,
    scaleY: 1,
    offsetX: -100,
    offsetY: -100
  }

  assert.equal(runtimeNodeBitmapRect({ x: 400, y: 400, w: 20, h: 20 }, frame), null)
  assert.deepEqual(runtimeNodeBitmapRect({ x: 295, y: 140, w: 10, h: 20 }, frame), {
    x: 191,
    y: 36,
    w: 9,
    h: 28
  })
})

test('builds runtime restore regions incrementally without changing merge semantics', () => {
  const options = { stageWidth: 200, stageHeight: 200, padding: 0, mergeCellSize: 128 }
  const nodes = [
    { id: 'a', x: 10, y: 10, w: 20, h: 20 },
    { id: 'b', x: 80, y: 40, w: 20, h: 20 },
    { id: 'a', x: 150, y: 150, w: 20, h: 20 },
    null
  ]
  const accumulator = createRuntimeRegionAccumulator(options)
  assert.deepEqual(nodes.map(node => accumulator.add(node)), [true, true, false, false])
  assert.deepEqual(accumulator.values(), collectRuntimeRegions(nodes, options))
})

test('switches runtime rendering to dense for high node count or bitmap coverage', () => {
  assert.equal(shouldUseDenseRuntime({
    available: true,
    nodeCount: RUNTIME_DENSE_NODE_THRESHOLD - 1
  }), false)
  assert.equal(shouldUseDenseRuntime({
    available: true,
    nodeCount: RUNTIME_DENSE_NODE_THRESHOLD
  }), true)
  assert.equal(shouldUseDenseRuntime({
    available: false,
    nodeCount: RUNTIME_DENSE_NODE_THRESHOLD
  }), false, 'dense replay requires authoritative ordered entities')

  const coverage = createRuntimeBitmapCoverageTracker({
    bitmapWidth: 256,
    bitmapHeight: 256,
    tileSize: 64
  })
  coverage.add({ x: 0, y: 0, w: 128, h: 128 })
  assert.equal(coverage.coverage, .25)
  assert.equal(shouldUseDenseRuntime({ available: true, coverage: coverage.coverage }), false)
  coverage.add({ x: 128, y: 0, w: 64, h: 128 })
  assert.equal(coverage.coverage, .375)
  assert.ok(coverage.coverage >= RUNTIME_DENSE_BITMAP_COVERAGE)
  assert.equal(shouldUseDenseRuntime({ available: true, coverage: coverage.coverage }), true)
})

test('runtime composite ping-pong keeps front, back, and pool ownership exclusive', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function releaseRuntimeBackSurface')
  const end = source.indexOf('function replaceCommittedGeometryIndexes', start)
  assert.ok(start >= 0 && end > start)

  const released = []
  const firstFront = { id: 'front-a', width: 100, height: 60 }
  const createHarness = new Function(
    'releaseRenderSurface',
    'initialFront',
    `"use strict";
      let runtimeBackSurface = null;
      let runtimeBackSyncRects = [];
      let committedCompositeSurface = initialFront;
      ${source.slice(start, end)}
      return {
        replaceCommittedCompositeSurface,
        swapCommittedCompositeSurface,
        takeRuntimeBackSurface,
        state: () => ({ committedCompositeSurface, runtimeBackSurface, runtimeBackSyncRects })
      };`
  )
  const harness = createHarness(surface => released.push(surface.id), firstFront)
  const secondFront = { id: 'front-b', width: 100, height: 60 }
  const dirty = { x: 1, y: 2, w: 3, h: 4 }

  harness.swapCommittedCompositeSurface(secondFront, [dirty])
  dirty.x = 99
  assert.equal(harness.state().committedCompositeSurface, secondFront)
  const claimed = harness.takeRuntimeBackSurface({ bitmapWidth: 100, bitmapHeight: 60 })
  assert.equal(claimed.surface, firstFront)
  assert.deepEqual(claimed.syncRects, [{ x: 1, y: 2, w: 3, h: 4 }])
  assert.equal(harness.state().runtimeBackSurface, null)
  assert.deepEqual(released, [])

  const thirdFront = { id: 'front-c', width: 100, height: 60 }
  harness.swapCommittedCompositeSurface(thirdFront, [{ x: 5, y: 6, w: 7, h: 8 }])
  harness.replaceCommittedCompositeSurface({ id: 'full', width: 100, height: 60 })
  assert.deepEqual(released, ['front-b', 'front-c'])
})

test('runtime Canvas uses a private composite and dense replay yields between entities', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const runtimeStart = source.indexOf('function fullRuntimeSeedRect')
  const runtimeEnd = source.indexOf('function runRuntimeRenderSlice', runtimeStart)
  const releaseStart = source.indexOf('function releaseRuntimeRenderTask', runtimeEnd)
  const releaseEnd = source.indexOf('function runtimeRenderCompletion', releaseStart)
  const commitStart = source.indexOf('function commitRuntimeRenderTask', releaseEnd)
  const commitEnd = source.indexOf('const runtimeRenderScheduler', commitStart)
  const scheduleStart = source.indexOf('function scheduleRuntimeRender()', commitEnd)
  const scheduleEnd = source.indexOf('function startFullRender', scheduleStart)
  const requestStart = source.indexOf('function requestRuntimeRender', scheduleEnd)
  const requestEnd = source.indexOf('function requestTimeRender', requestStart)
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart && releaseEnd > releaseStart)

  const bitmapWidth = 256
  const bitmapHeight = 128
  const makePixelSurface = (id, value) => ({
    id,
    pixels: new Uint8Array(bitmapWidth * bitmapHeight).fill(value)
  })
  const base = makePixelSurface('base', 17)
  const front = makePixelSurface('front', 29)
  front.writes = 0
  const target = { id: 'target' }
  const workingState = { seed: null, clears: 0, saves: 0, restores: 0, draws: [] }
  const workingPixels = new Uint8Array(bitmapWidth * bitmapHeight).fill(255)
  const workingContext = {
    setTransform() {},
    clearRect(x, y, width, height) {
      workingState.clears += 1
      for (let row = y; row < y + height; row += 1) {
        workingPixels.fill(0, row * bitmapWidth + x, row * bitmapWidth + x + width)
      }
    },
    drawImage(surface, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY) {
      workingState.seed = surface
      workingState.draws.push({ surface, sourceY, sourceHeight })
      for (let row = 0; row < sourceHeight; row += 1) {
        const sourceOffset = (sourceY + row) * bitmapWidth + sourceX
        const targetOffset = (targetY + row) * bitmapWidth + targetX
        for (let column = 0; column < sourceWidth; column += 1) {
          const value = surface.pixels[sourceOffset + column]
          if (value) workingPixels[targetOffset + column] = value
        }
      }
    },
    beginPath() {},
    rect() {},
    clip() {},
    save() { workingState.saves += 1 },
    restore() { workingState.restores += 1 },
    translate() {},
    scale() {}
  }
  const working = { id: 'working', getContext: () => workingContext }
  const released = []
  const drawn = []
  let backEntry = null
  const excludedNodeIds = new Set()
  const excludedDrawingIds = new Set()
  const createHarness = new Function(
    'shouldUseDenseRuntime',
    'takeRuntimeBackSurface',
    'acquireRenderSurface',
    'reportCanvasRenderError',
    'createRuntimeRegionAccumulator',
    'createRuntimeBitmapCoverageTracker',
    'runtimeRenderEpoch',
    'committedStaticSurface',
    'committedCompositeSurface',
    'committedExcludedNodeIds',
    'committedExcludedDrawingIds',
    'canvas',
    'releaseRenderSurface',
    'runtimeBitmapRect',
    'drawTemporaryDrawing',
    'drawNode',
    'drawEntityIncrementally',
    'RUNTIME_REGION_MERGE_SIZE',
    'RUNTIME_SURFACE_SEED_STRIP_PIXELS',
    `"use strict"; ${source.slice(runtimeStart, runtimeEnd)}\n${source.slice(releaseStart, releaseEnd)}; return { createRuntimeRenderTask, seedRuntimeRenderSurface, prepareRuntimeRegions, measureRuntimeRegions, beginRuntimeRegionDraw, drawDenseRuntimeEntities, releaseRuntimeRenderTask };`
  )
  const harness = createHarness(
    shouldUseDenseRuntime,
    () => {
      const entry = backEntry
      backEntry = null
      return entry
    },
    () => working,
    error => { throw error },
    createRuntimeRegionAccumulator,
    createRuntimeBitmapCoverageTracker,
    7,
    base,
    front,
    excludedNodeIds,
    excludedDrawingIds,
    { value: target },
    surface => released.push(surface),
    runtimeBitmapRect,
    (_ctx, drawing) => drawn.push(`drawing:${drawing.id}`),
    (_ctx, node) => drawn.push(`node:${node.id}`),
    (_task, node) => {
      drawn.push(`node:${node.id}`)
      return true
    },
    512,
    1024
  )
  const frame = {
    bitmapWidth,
    bitmapHeight,
    stageWidth: 256,
    stageHeight: 128,
    pixelRatioX: 1,
    pixelRatioY: 1,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0
  }
  const commonPayload = {
    epoch: 7,
    target,
    contextToken: { target },
    base,
    composite: front,
    frame,
    spatialIndex: { createQueryCursor() {} },
    drawingSpatialIndex: null,
    hasDrawings: false,
    excludedNodeIds,
    excludedDrawingIds
  }

  const sparseTask = harness.createRuntimeRenderTask({
    ...commonPayload,
    nodes: [{ id: 'changed', x: 0, y: 0, w: 10, h: 10 }],
    entities: [{ kind: 'node', entity: { id: 'changed' } }]
  }, 1)
  assert.equal(sparseTask.valid, true)
  assert.equal(sparseTask.frontComposite, front)
  assert.equal(sparseTask.composite, null, 'private work is allocated lazily inside a budgeted render slice')
  let seedChecks = 0
  assert.equal(harness.seedRuntimeRenderSurface(sparseTask, {
    shouldYield: () => ++seedChecks >= 2
  }), false, 'large surface seeding must yield between strips')
  assert.equal(sparseTask.composite, working)
  assert.equal(workingState.seed, front)
  assert.equal(sparseTask.seedRectY, 8)
  assert.ok(workingPixels.slice(0, bitmapWidth * 8).every(value => value === 29))
  assert.ok(workingPixels.slice(bitmapWidth * 8).every(value => value === 255))
  assert.equal(harness.seedRuntimeRenderSurface(sparseTask, { shouldYield: () => false }), true)
  assert.ok(workingPixels.every(value => value === 29), 'all strips must survive the completed seed')
  harness.releaseRuntimeRenderTask(sparseTask)
  assert.deepEqual(released, [working])
  assert.equal(front.writes, 0, 'discarding private work must leave the committed front untouched')

  released.length = 0
  workingPixels.fill(7)
  backEntry = {
    surface: working,
    syncRects: [{ x: 20, y: 10, w: 5, h: 3 }]
  }
  const syncedSparseTask = harness.createRuntimeRenderTask({
    ...commonPayload,
    nodes: [{ id: 'next', x: 40, y: 20, w: 10, h: 10 }],
    entities: [{ kind: 'node', entity: { id: 'next' } }]
  }, 2)
  assert.equal(syncedSparseTask.composite, working)
  assert.deepEqual(syncedSparseTask.seedRects, [{ x: 20, y: 10, w: 5, h: 3 }])
  assert.equal(harness.seedRuntimeRenderSurface(syncedSparseTask, { shouldYield: () => false }), true)
  for (let y = 0; y < bitmapHeight; y += 1) {
    for (let x = 0; x < bitmapWidth; x += 1) {
      const expected = x >= 20 && x < 25 && y >= 10 && y < 13 ? 29 : 7
      assert.equal(workingPixels[y * bitmapWidth + x], expected)
    }
  }
  harness.releaseRuntimeRenderTask(syncedSparseTask)

  const transparentBase = makePixelSurface('transparent-base', 0)
  workingPixels.fill(99)
  const restoredRects = []
  harness.beginRuntimeRegionDraw({
    ctx: workingContext,
    base: transparentBase,
    frame,
    bitmapRect: { x: 20, y: 10, w: 5, h: 3 },
    bitmapRects: restoredRects
  })
  for (let y = 0; y < bitmapHeight; y += 1) {
    for (let x = 0; x < bitmapWidth; x += 1) {
      const expected = x >= 20 && x < 25 && y >= 10 && y < 13 ? 0 : 99
      assert.equal(workingPixels[y * bitmapWidth + x], expected)
    }
  }
  assert.deepEqual(restoredRects, [{ x: 20, y: 10, w: 5, h: 3 }])

  released.length = 0
  const entities = [
    { kind: 'node', entity: { id: 'low' } },
    { kind: 'drawing', entity: { id: 'middle' } },
    { kind: 'node', entity: { id: 'high' } }
  ]
  const denseTask = harness.createRuntimeRenderTask({
    ...commonPayload,
    nodes: Array.from({ length: RUNTIME_DENSE_NODE_THRESHOLD }, (_, index) => ({ id: `changed-${index}` })),
    entities
  }, 3)
  assert.equal(denseTask.mode, 'dense')
  assert.equal(denseTask.composite, null)
  assert.equal(harness.seedRuntimeRenderSurface(denseTask, { shouldYield: () => false }), true)
  assert.equal(denseTask.composite, working)
  assert.equal(workingState.seed, base, 'dense replay starts from the committed static surface')
  assert.ok(workingPixels.every(value => value === 17), 'dense seed must replace every pixel with the static base')
  harness.prepareRuntimeRegions(denseTask, { shouldYield: () => false })
  assert.equal(denseTask.phase, 'dense')

  let firstSliceChecks = 0
  assert.equal(harness.drawDenseRuntimeEntities(denseTask, {
    shouldYield: () => ++firstSliceChecks >= 1
  }), false)
  assert.deepEqual(drawn, ['node:low'])
  while (!harness.drawDenseRuntimeEntities(denseTask, { shouldYield: () => false })) {}
  assert.deepEqual(drawn, ['node:low', 'drawing:middle', 'node:high'])
  assert.equal(denseTask.phase, 'complete')
  harness.releaseRuntimeRenderTask(denseTask)

  const commitSource = source.slice(commitStart, commitEnd)
  const scheduleSource = source.slice(scheduleStart, scheduleEnd)
  const requestSource = source.slice(requestStart, requestEnd)
  const streamSource = source.match(/function updateRuntimeDenseStream\(request\)[\s\S]*?(?=\nfunction resolveChangedRuntimeNodes)/)?.[0] || ''
  assert.match(commitSource, /task\.frontComposite !== committedCompositeSurface/)
  assert.match(commitSource, /frameCommitAccepted\(completion\)[\s\S]*?nextComposite = task\.composite[\s\S]*?task\.mode === 'sparse'\) swapCommittedCompositeSurface\(nextComposite, task\.bitmapRects\)[\s\S]*?else replaceCommittedCompositeSurface\(nextComposite\)/)
  assert.match(scheduleSource, /runtimeRenderScheduler\.state\.pending[\s\S]*?return null/)
  assert.match(requestSource, /const request = runtimeRenderRequest\(changedNodes\)/)
  assert.match(requestSource, /updateRuntimeDenseStream\(request\)/)
  assert.match(requestSource, /resolveChangedRuntimeNodes\(request\.nodes\)/)
  assert.match(streamSource, /request\.dense[\s\S]*?pendingRuntimeDense = true/)
  assert.match(streamSource, /request\.pending[\s\S]*?runtimeDenseStreamOpen = true/)
  assert.match(streamSource, /runtimeDenseStreamOpen = false[\s\S]*?pendingRuntimeDense = true[\s\S]*?clearRuntimeDenseStreamTimer\(\)/)
  assert.match(requestSource, /runtimeRenderScheduler\.state\.pending[\s\S]*?runtimeRenderDirty = true[\s\S]*?return runtimeRenderScheduler\.state\.generation/)
  assert.doesNotMatch(requestSource, /runtimeRenderScheduler\.invalidate/)
})

test('dense runtime request streams coalesce middle batches and settle after the final batch', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const parserSource = source.match(/function runtimeRenderRequest\(source\)[\s\S]*?(?=\nfunction resolveChangedRuntimeNodes)/)?.[0] || ''
  const scheduleSource = source.match(/function scheduleRuntimeRender\(\)[\s\S]*?(?=\nfunction startFullRender)/)?.[0] || ''
  const requestSource = source.match(/function requestRuntimeRender\(changedNodes\)[\s\S]*?(?=\nfunction requestTimeRender)/)?.[0] || ''
  assert.ok(parserSource && scheduleSource && requestSource)

  const requests = []
  const emitted = []
  const flushes = []
  const runtimeRenderScheduler = {
    state: { generation: 0, pending: false },
    request(payload) {
      this.state.generation += 1
      this.state.pending = true
      requests.push(payload)
      return this.state.generation
    }
  }
  const createHarness = new Function(
    'props',
    'renderScheduler',
    'runtimeRenderScheduler',
    'emit',
    'resolveChangedRuntimeNodes',
    'canIncrementRuntime',
    'requestCoalescedRender',
    'canvas',
    'canvasContextGate',
    'committedStaticSurface',
    'committedCompositeSurface',
    'committedStaticFrame',
    'committedExcludedNodeIds',
    'committedExcludedDrawingIds',
    'flushes',
    `"use strict";
      let suspendedRenderDirty = false;
      let runtimeRenderEpoch = 1;
      let runtimeRenderDirty = false;
      let pendingRuntimeDense = false;
      let runtimeDenseStreamOpen = false;
      let runtimeDenseStreamStarted = false;
      let runtimeDenseStreamTimer = 0;
      let geometryInteraction = null;
      const committedGeneration = { value: 0 };
      let pendingRuntimeNodes = new Map();
      const RUNTIME_RENDER_NODE_BATCH_SIZE = 512;
      function runtimeRenderFollowUpPending() {
        return pendingRuntimeDense || runtimeDenseStreamOpen || pendingRuntimeNodes.size > 0;
      }
      function takePendingRuntimeNodeBatch(limit = RUNTIME_RENDER_NODE_BATCH_SIZE) {
        const nodes = [];
        for (const [key, node] of pendingRuntimeNodes) {
          nodes.push(node);
          pendingRuntimeNodes.delete(key);
          if (nodes.length >= limit) break;
        }
        return nodes;
      }
      function shouldUseDenseRuntime({ nodeCount }) {
        return nodeCount >= ${RUNTIME_DENSE_NODE_THRESHOLD};
      }
      function clearRuntimeDenseStreamTimer() {
        if (!runtimeDenseStreamTimer) return;
        runtimeDenseStreamTimer = 0;
        flushes.push('cleared');
      }
      function queueRuntimeDenseStreamFlush() {
        if (!runtimeDenseStreamOpen || runtimeDenseStreamTimer) return;
        runtimeDenseStreamTimer = 1;
        flushes.push('queued');
      }
      ${parserSource}
      ${scheduleSource}
      ${requestSource}
      return {
        requestRuntimeRender,
        state() {
          return {
            dirty: runtimeRenderDirty,
            dense: pendingRuntimeDense,
            open: runtimeDenseStreamOpen,
            started: runtimeDenseStreamStarted,
            timer: runtimeDenseStreamTimer,
            pendingNodeIds: [...pendingRuntimeNodes.keys()]
          };
        }
      };`
  )
  const target = { id: 'target' }
  const harness = createHarness(
    { active: true, drawings: [], orderedEntities: [] },
    { state: { pending: false, generation: 0 } },
    runtimeRenderScheduler,
    (_name, event) => emitted.push(event),
    values => Array.isArray(values) ? values : [],
    () => true,
    () => -1,
    { value: target },
    { capture: value => ({ target: value }) },
    { id: 'base' },
    { id: 'front' },
    { bitmapWidth: 100, bitmapHeight: 60 },
    new Set(),
    new Set(),
    flushes
  )

  harness.requestRuntimeRender({ nodes: [{ id: 'a' }], dense: true, pending: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].dense, true)
  assert.equal('pending' in requests[0], false)
  assert.equal(requests[0].nodeCount, 1)
  assert.deepEqual(requests[0].nodes, [], 'dense scheduling swaps the pending Map without expanding it')
  assert.deepEqual(harness.state(), {
    dirty: false,
    dense: false,
    open: true,
    started: true,
    timer: 0,
    pendingNodeIds: []
  })

  // 首次稠密重放完成后，中间批只进入合并窗口，不能每批再启动一次全量重放。
  runtimeRenderScheduler.state.pending = false
  harness.requestRuntimeRender({ nodes: [{ id: 'b' }], dense: true, pending: true })
  assert.equal(requests.length, 1)
  assert.deepEqual(flushes, ['queued'])
  assert.deepEqual(harness.state().pendingNodeIds, ['b'])

  // 尾批关闭流、取消等待窗口，并立即提交最终稠密帧。
  runtimeRenderScheduler.state.pending = false
  harness.requestRuntimeRender({ nodes: [{ id: 'c' }], dense: false, pending: false })
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].nodes, [])
  assert.equal(requests[1].nodeCount, 2)
  assert.equal(requests[1].dense, true)
  assert.equal('pending' in requests[1], false)
  assert.deepEqual(flushes, ['queued', 'cleared'])
  assert.equal(harness.state().open, false)
  assert.equal(harness.state().started, false)

  runtimeRenderScheduler.state.pending = false
  harness.requestRuntimeRender({ nodes: [], dense: false, pending: false })
  assert.equal(emitted.at(-1)?.settled, true, 'an empty terminal batch must release preview freshness')

  const exactBatch = Array.from({ length: 512 }, (_, index) => ({ id: `exact-${index}` }))
  harness.requestRuntimeRender({ nodes: exactBatch, dense: true, pending: true })
  assert.equal(requests.length, 3)
  runtimeRenderScheduler.state.pending = false
  harness.requestRuntimeRender({ nodes: [], dense: false, pending: false })
  assert.equal(requests.length, 4, 'an empty terminal descriptor must schedule the final dense replay')
  assert.equal(requests[3].dense, true)
  assert.equal(requests[3].nodeCount, 0)
  assert.deepEqual(requests[3].nodes, [])
  assert.equal(harness.state().open, false)
})

test('drains 6016 runtime regions through a deadline-bounded lazy cursor', () => {
  const count = 6016
  const accumulator = createRuntimeRegionAccumulator({
    stageWidth: count * 4,
    stageHeight: 8,
    padding: 0,
    mergeCellSize: 0
  })
  for (let index = 0; index < count; index += 1) {
    accumulator.add({ id: `region-${index}`, x: index * 4, y: 1, w: 1, h: 1 })
  }
  assert.equal(accumulator.size, count)

  const cursor = accumulator.createCursor()
  const sliceReads = []
  let totalReads = 0
  let done = false
  while (!done) {
    let checks = 0
    const deadline = { shouldYield: () => ++checks >= 113 }
    let reads = 0
    while (!done) {
      const next = cursor.next()
      done = next.done
      if (done) break
      reads += 1
      totalReads += 1
      if (deadline.shouldYield()) break
    }
    sliceReads.push(reads)
  }

  assert.equal(sliceReads[0], 113)
  assert.ok(sliceReads.length > 1)
  assert.ok(sliceReads.every(reads => reads <= 113))
  assert.equal(totalReads, count)
  assert.equal(cursor.reads, count)
})

test('chunks a 6016-candidate runtime region and preserves filter and stable layer order', () => {
  const count = 6016
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `runtime-${index}`,
    x: index ? 16 + (index % 8) * 4 : 0,
    y: index ? 16 + (Math.floor(index / 8) % 8) * 4 : 0,
    w: index ? 8 : 512,
    h: index ? 8 : 512,
    layer: (index * 17) % 251,
    runtime: index % 7 !== 0
  }))
  const accumulator = createRuntimeRegionAccumulator({
    stageWidth: 512,
    stageHeight: 512,
    padding: 0,
    mergeCellSize: 512
  })
  for (const node of nodes) accumulator.add(node)
  assert.equal(accumulator.size, 1, 'the stress fixture must exercise one merged dirty region')
  const region = accumulator.createCursor().next().value
  const spatialIndex = createSpatialIndex(nodes, { cellSize: 32 })
  const include = node => node.runtime
  const compare = (left, right) => left.layer - right.layer
  const expected = spatialIndex.query(region, { sort: false }).filter(include).sort(compare)
  const cursor = createRuntimeCandidateCursor(
    spatialIndex.createQueryCursor(region, { sort: false }),
    { include, compare }
  )

  const sliceOperations = []
  let firstSliceDone = null
  while (!cursor.done) {
    let checks = 0
    const deadline = { shouldYield: () => ++checks >= 127 }
    const result = cursor.runSlice(deadline, 4096)
    if (firstSliceDone == null) firstSliceDone = result.done
    sliceOperations.push(result.operations)
  }

  assert.equal(firstSliceDone, false, 'the first bounded slice must not finish 6016 candidates')
  assert.ok(sliceOperations[0] <= 127)
  assert.ok(sliceOperations.length > 1, 'a 6016-hit region must cross scheduled slices')
  assert.ok(sliceOperations.every(operations => operations <= 127), `unbounded slice: ${Math.max(...sliceOperations)} operations`)
  assert.deepEqual(cursor.items.map(node => node.id), expected.map(node => node.id))
})

test('combines node and drawing runtime candidates before stable layer replay', () => {
  const nodes = [
    { id: 'low-node', x: 0, y: 0, w: 20, h: 20, layer: 1 },
    { id: 'high-node', x: 0, y: 0, w: 20, h: 20, layer: 3 }
  ]
  const drawings = [{ id: 'middle-drawing', x: 0, y: 0, w: 20, h: 20, layer: 2 }]
  const nodeIndex = createSpatialIndex(nodes)
  const drawingIndex = createSpatialIndex(drawings, { getBounds: item => item })
  const combined = createRuntimeQueryCursor([
    { kind: 'node', cursor: nodeIndex.createQueryCursor({ x: 0, y: 0, w: 20, h: 20 }, { sort: false }) },
    { kind: 'drawing', cursor: drawingIndex.createQueryCursor({ x: 0, y: 0, w: 20, h: 20 }, { sort: false }) }
  ])
  const candidates = createRuntimeCandidateCursor(combined, {
    compare: (left, right) => left.entity.layer - right.entity.layer
  })

  while (!candidates.done) candidates.runSlice({ shouldYield: () => false }, 2)
  assert.deepEqual(candidates.items.map(item => `${item.kind}:${item.entity.id}`), [
    'node:low-node',
    'drawing:middle-drawing',
    'node:high-node'
  ])
})

test('contains a 9355 by 2643 stage in the minimap without distorting its aspect ratio', () => {
  const transform = miniMapTransform({
    stageWidth: 9355,
    stageHeight: 2643,
    width: 240,
    height: 150,
    fitMode: 'contain'
  })
  const expectedScale = 240 / 9355

  assertClose(transform.scaleX, expectedScale, 'scaleX')
  assertClose(transform.scaleY, expectedScale, 'scaleY')
  assertClose(transform.offsetX, 0, 'offsetX')
  assertClose(transform.offsetY, (150 - 2643 * expectedScale) / 2, 'offsetY')
  assertClose(transform.contentWidth, 240, 'content width')
  assertClose(transform.contentHeight, 2643 * expectedScale, 'content height')
})

test('maps a local editor view box to the complete bitmap without scaling the full stage', () => {
  const transform = miniMapTransform({
    stageWidth: 9355,
    stageHeight: 2643,
    width: 1500,
    height: 900,
    viewBox: { x: 1000, y: 400, w: 3000, h: 1800 }
  })

  assertClose(transform.scaleX, 0.5, 'view-box scaleX')
  assertClose(transform.scaleY, 0.5, 'view-box scaleY')
  assertClose(transform.offsetX, -500, 'view-box offsetX')
  assertClose(transform.offsetY, -200, 'view-box offsetY')
  assert.deepEqual(transform.viewBox, { x: 1000, y: 400, w: 3000, h: 1800 })
})

test('uses the same letterboxed transform for the viewport frame and minimap navigation', () => {
  const transform = miniMapTransform({
    stageWidth: 9355,
    stageHeight: 2643,
    width: 240,
    height: 150,
    fitMode: 'contain'
  })
  const zoom = 2
  const worldViewport = { left: 2000, top: 500, width: 1200, height: 900 }
  const frame = miniMapViewportRect(transform, {
    left: worldViewport.left * zoom,
    top: worldViewport.top * zoom,
    width: worldViewport.width * zoom,
    height: worldViewport.height * zoom
  }, zoom)

  assertClose(frame.left, transform.offsetX + worldViewport.left * transform.scaleX, 'viewport left')
  assertClose(frame.top, transform.offsetY + worldViewport.top * transform.scaleY, 'viewport top')
  assertClose(frame.width, worldViewport.width * transform.scaleX, 'viewport width')
  assertClose(frame.height, worldViewport.height * transform.scaleY, 'viewport height')

  const frameCenter = {
    x: frame.left + frame.width / 2,
    y: frame.top + frame.height / 2
  }
  assertPointClose(miniMapWorldPoint(transform, frameCenter), {
    x: worldViewport.left + worldViewport.width / 2,
    y: worldViewport.top + worldViewport.height / 2
  }, 'viewport center round trip')
})

test('keeps a tiny current-window indicator visible without moving its center', () => {
  const transform = miniMapTransform({
    stageWidth: 20000,
    stageHeight: 12000,
    width: 240,
    height: 150,
    fitMode: 'contain'
  })
  const naturalFrame = miniMapViewportRect(transform, {
    left: 10000,
    top: 6000,
    width: 100,
    height: 80
  }, 4, 1)
  const visibleFrame = miniMapViewportRect(transform, {
    left: 10000,
    top: 6000,
    width: 100,
    height: 80
  }, 4, 12)

  assert.equal(visibleFrame.width, 12)
  assert.equal(visibleFrame.height, 12)
  assertClose(visibleFrame.left + visibleFrame.width / 2, naturalFrame.left + naturalFrame.width / 2, 'minimum frame center x')
  assertClose(visibleFrame.top + visibleFrame.height / 2, naturalFrame.top + naturalFrame.height / 2, 'minimum frame center y')
})

test('shares canvas edge endpoint geometry with the minimap', () => {
  const nodeIndex = new Map([
    ['source', { id: 'source', x: 100, y: 100, w: 80, h: 40, rotate: 0 }],
    ['target', { id: 'target', x: 300, y: 90, w: 100, h: 60, rotate: 0 }]
  ])

  assert.deepEqual(edgeEndpointsForNodes({
    from: 'source',
    to: 'target',
    anchorMode: 'edge',
    startMarker: 'none',
    endMarker: 'none'
  }, nodeIndex), {
    start: { x: 180, y: 120 },
    end: { x: 300, y: 120 }
  })

  assert.deepEqual(edgeEndpointsForNodes({
    from: 'source',
    to: 'target',
    anchorMode: 'edge',
    startMarker: 'circle',
    endMarker: 'arrow'
  }, nodeIndex), {
    start: { x: 185, y: 120 },
    end: { x: 298, y: 120 }
  })

  assert.deepEqual(edgeEndpointsForNodes({
    from: 'source',
    to: 'target',
    anchorMode: 'center'
  }, nodeIndex), {
    start: { x: 140, y: 120 },
    end: { x: 350, y: 120 }
  })
})

test('finds a long edge crossing the viewport when both endpoint nodes are outside it', async () => {
  const nodeIndex = new Map([
    ['source', { id: 'source', x: 0, y: 100, w: 100, h: 40 }],
    ['target', { id: 'target', x: 3_000, y: 100, w: 100, h: 40 }]
  ])
  const edge = { id: 'crossing', from: 'source', to: 'target', anchorMode: 'center', width: 2 }
  const index = createSpatialIndex([edge], {
    cellSize: 128,
    getBounds: item => edgeBoundsForNodes(item, nodeIndex)
  })

  assert.deepEqual(index.query({ x: 1_400, y: 110, w: 200, h: 20 }), [edge])

  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(appSource, /(?:const|let) edgeSpatialIndex = createSpatialIndex\(\[\], \{[\s\S]*?edgeBoundsForNodes\(edge, nodeIndex\.value\)/)
  assert.match(appSource, /function updateConnectedEdgeSpatialIndex[\s\S]*?edgeAdjacency\.value\.get/)
  assert.match(appSource, /const visibleEdges = computed\([\s\S]*?edgesInBounds\(bounds\)/)
  const previewEdgeCandidates = appSource.match(/const previewEdgeCandidates = computed\([\s\S]*?(?=\nconst previewDrawingCandidates)/)?.[0] || ''
  assert.match(previewEdgeCandidates, /edgesInBounds\([\s\S]*?viewportWorldBounds\(previewViewport\.value/)
  assert.doesNotMatch(previewEdgeCandidates, /\blimit\s*:/)
  assert.doesNotMatch(appSource, /const previewEdgeCandidates = computed\(\(\) => edgesForNodeIds/)
})

test('wires the main App minimap to contain and faithful rendering', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const styleSource = await readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')
  const previewSource = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const mainMiniMap = appSource.match(/<div v-if="showMiniMap" class="minimap">[\s\S]*?(<MiniMapPreview[^>]*\/?>)/)?.[1]

  assert.ok(mainMiniMap, 'expected the main minimap preview in App.vue')
  assert.match(mainMiniMap, /\bfit-mode="contain"/)
  assert.match(mainMiniMap, /\bfaithful(?:\s|\/?>)/)
  assert.match(mainMiniMap, /:runtime-store="runtimeData"/)
  assert.match(mainMiniMap, /:spatial-index="nodeSpatialIndex"/)
  assert.match(mainMiniMap, /:drawing-spatial-index="drawingSpatialIndex"/)
  assert.match(mainMiniMap, /\bincremental-runtime(?:\s|\/?>)/)
  assert.match(appSource, /function runtimeCanvasRenderingActive\(\)[\s\S]*?showMiniMap\.value/)
  assert.match(appSource, /if \(showMiniMap\.value && miniMapPreview\.value\) targets\.push\(miniMapPreview\.value\)/)
  assert.match(appSource, /const miniMapRenderTransform = computed\(\(\) => miniMapTransform\(\{[\s\S]*?fitMode:\s*'contain'[\s\S]*?\}\)\)/)
  assert.match(appSource, /miniMapViewportRect\(miniMapRenderTransform\.value, viewport\.value, zoom\.value, miniMapViewportMinSize\)/)
  assert.match(appSource, /class="minimap-canvas-frame" :style="miniMapCanvasStyle"/)
  assert.doesNotMatch(appSource, /class="minimap-canvas-size"/)
  assert.match(styleSource, /\.minimap-canvas-frame \{[^}]*border: 2px solid #52616c/)
  assert.match(styleSource, /\.minimap-viewport \{[^}]*border: 2px solid #168eea/)
  assert.doesNotMatch(styleSource.match(/\.minimap-viewport \{[^}]*\}/)?.[0] || '', /#f4511e/)
  assert.match(previewSource, /ctx\.rect\(0, 0, stageWidth, stageHeight\)[\s\S]*?ctx\.clip\(\)[\s\S]*?fillRenderBackground\(ctx, payload\.background, stageWidth, stageHeight\)/)
  assert.match(previewSource, /function fillRenderBackground\(ctx, background, stageWidth, stageHeight\)[\s\S]*?ctx\.fillRect\(0, 0, stageWidth, stageHeight\)/)
})

test('uses a bounded faithful canvas with a controlled live DOM preview handoff', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const previewSource = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const progressiveGeometrySource = await readFile(new URL('../src/components/ProgressivePreviewGeometry.vue', import.meta.url), 'utf8')
  const adaptiveCanvas = appSource.match(/<MiniMapPreview v-if="previewFitMounted"[^>]*\/>/)?.[0] || ''
  const editorLodCanvas = appSource.match(/<MiniMapPreview ref="editorLodCanvas"[^>]*\/>/)?.[0] || ''
  const editorLodDetailCanvas = appSource.match(/<MiniMapPreview ref="editorLodDetailCanvas"[^>]*\/>/)?.[0] || ''
  const adaptiveStart = appSource.indexOf(adaptiveCanvas)
  const originalPreviewStart = appSource.indexOf('<div v-if="previewDomMounted" class="preview-stage"', adaptiveStart)

  assert.ok(adaptiveCanvas, 'expected an adaptive preview canvas')
  assert.match(editorLodCanvas, /:max-bitmap-pixels="EDITOR_LOD_FALLBACK_BITMAP_PIXELS"/)
  assert.doesNotMatch(editorLodCanvas, /4194304/)
  assert.match(editorLodDetailCanvas, /:max-bitmap-pixels="editorLodDetailBitmapBudget"/)
  assert.match(editorLodDetailCanvas, /:view-box="editorLodDetailBounds"/)
  assert.match(editorLodDetailCanvas, /:nodes="editorLodDetailNodes"/)
  assert.match(editorLodDetailCanvas, /:ordered-entities="editorLodDetailEntities"/)
  assert.match(editorLodDetailCanvas, /\bincremental-runtime\b/)
  for (const binding of [
    ':nodes="nodes"',
    ':edges="edges"',
    ':drawings="drawings"',
    ':node-index="nodeIndex"',
    ':ordered-entities="layerEntries"',
    ':excluded-node-ids="previewFitExcludedNodeIds"',
    ':excluded-drawing-ids="previewFitExcludedDrawingIds"',
    ':runtime-store="runtimeData"',
    ':time-context="timeRenderContext"'
  ]) assert.match(adaptiveCanvas, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(adaptiveCanvas, /:max-bitmap-pixels="previewFitBitmapPixelBudget"/)
  assert.match(appSource, /const previewFitBitmapPixelBudget = computed\(\(\) => previewBitmapPixelBudget\(\{[\s\S]*?fitActive: previewFitLayoutRequested\.value \|\| previewFittedVisible\.value[\s\S]*?stageWidth: stageWidth\.value[\s\S]*?stageHeight: stageHeight\.value[\s\S]*?scale: previewFitCanvasScale\.value[\s\S]*?devicePixelRatio: previewDevicePixelRatio\.value[\s\S]*?\}\)\)/)
  assert.match(appSource, /const previewFitBootstrapCanRenderSharp = computed\([\s\S]*?previewBitmapIsSharp\([\s\S]*?previewFitPixelRatio\.value/)
  assert.match(appSource, /const previewFitCanUseCanvas = computed\([\s\S]*?previewFitPlan\.value\.canUseCanvas[\s\S]*?previewFitCanvasQualityAvailable\(\)/)
  assert.match(adaptiveCanvas, /:spatial-index="nodeSpatialIndex"/)
  assert.match(adaptiveCanvas, /:drawing-spatial-index="drawingSpatialIndex"/)
  assert.match(adaptiveCanvas, /:render-budget-ms="previewFitActive \? 4 : 2"/)
  assert.match(adaptiveCanvas, /\bincremental-runtime\b/)
  assert.match(adaptiveCanvas, /:width="previewFitCanvasWidth"/)
  assert.match(adaptiveCanvas, /:height="previewFitCanvasHeight"/)
  assert.match(adaptiveCanvas, /:pixel-ratio="previewFitPixelRatio"/)
  assert.doesNotMatch(adaptiveCanvas, /transform:\s*`scale/)
  assert.match(appSource, /const previewFitCanvasScale = computed\(\(\) => \(previewFitLayoutRequested\.value \|\| previewFittedVisible\.value\) \? previewFitScale\.value : 1\)/)
  assert.match(appSource, /const previewFitCanvasWidth = computed\(\(\) => Math\.max\(1, stageWidth\.value \* previewFitCanvasScale\.value\)\)/)
  assert.match(appSource, /const previewFitCanvasHeight = computed\(\(\) => Math\.max\(1, stageHeight\.value \* previewFitCanvasScale\.value\)\)/)
  assert.match(appSource, /const previewFitPixelRatio = computed\(\(\) => previewBitmapPixelRatio\(previewDevicePixelRatio\.value\)\)/)
  assert.match(appSource, /function previewFitOffsetForScale[\s\S]*?previewPixelAlignedOffset/)
  assert.match(appSource, /function syncPreviewFitOffset[\s\S]*?previewFitOffsetForScale\(previewFitScale\.value/)
  assert.match(adaptiveCanvas, /fit-mode="stretch"/)
  assert.match(adaptiveCanvas, /:render-mode="previewFitActive \? 'task' : 'idle'"/)
  assert.match(adaptiveCanvas, /\batomic-css-size\b/)
  assert.match(adaptiveCanvas, /\bfaithful\b/)
  assert.match(adaptiveCanvas, /test-id="preview-fit-canvas"/)
  assert.match(adaptiveCanvas, /@render-complete="handlePreviewFitRenderComplete"/)
  assert.match(adaptiveCanvas, /:frame-commit-token="previewFitFrameCommitToken"/)
  assert.match(adaptiveCanvas, /:frame-commit-guard="canCommitPreviewFitFrame"/)
  assert.match(adaptiveCanvas, /@render-rejected="handlePreviewFitRenderRejected"/)

  assert.ok(originalPreviewStart > adaptiveStart, 'the conditional DOM preview must follow the canvas layer')
  const originalPreview = appSource.slice(originalPreviewStart, appSource.indexOf('</div></div></div>', originalPreviewStart))
  assert.match(originalPreview, /<ProgressivePreviewGeometry/)
  assert.match(originalPreview, /:edges="previewDomEdges"/)
  assert.match(originalPreview, /:drawings="previewDomDrawings"/)
  assert.match(originalPreview, /@render-start="handlePreviewGeometryRenderStart"/)
  assert.match(originalPreview, /@render-complete="handlePreviewGeometryRenderComplete"/)
  assert.doesNotMatch(originalPreview, /previewVisibleEdgeEntries|previewVisibleDrawingEntries/)
  assert.match(originalPreview, /<ProgressivePreviewNodes :nodes="previewDomNodes"/)
  assert.match(originalPreview, /<ProgressivePreviewNodes :nodes="previewDomNodes" :generation="previewDomGeneration" progressive :batch-size="8" :mount-cost-budget="64" :runtime-store="runtimeData"[^>]*@render-start="handlePreviewDomRenderStart"/)
  assert.match(originalPreview, /data-testid="preview-dom-stage"/)
  assert.match(originalPreview, /'is-hidden': !previewDomVisible/)
  assert.match(originalPreview, /data-testid="preview-live-plane"/)
  assert.match(originalPreview, /<ProgressivePreviewNodes :nodes="previewLivePlaneNodes"[^>]*:batch-size="PREVIEW_HYBRID_MAX_DOM_NODES"[^>]*:mount-cost-budget="PREVIEW_HYBRID_MAX_DOM_COST"/)
  assert.match(originalPreview, /v-for="entry in previewLivePlaneDrawingEntries"/)
  assert.doesNotMatch(originalPreview, /v-if="!previewDomLimited"/)
  assert.match(appSource, /const previewDomNodes = computed\([\s\S]*?previewDomUsesLivePlane\.value[\s\S]*?previewFitExcludedNodeIds\.value[\s\S]*?source\.filter\(node => !excludedIds\.has\(node\.id\)\)/)
  assert.match(appSource, /const previewDomDrawings = computed\([\s\S]*?previewDomUsesLivePlane\.value[\s\S]*?previewFitExcludedDrawingIds\.value[\s\S]*?source\.filter\(drawing => !excludedIds\.has\(drawing\.id\)\)/)
  assert.match(progressiveGeometrySource, /edgeBatchSize:\s*\{ type: Number, default: 64 \}/)
  assert.match(progressiveGeometrySource, /drawingBatchSize:\s*\{ type: Number, default: 8 \}/)
  assert.match(progressiveGeometrySource, /scheduleRenderFrame\(revealNextBatch\)/)
  assert.match(appSource, /function handlePreviewFitRenderComplete\(event\)[\s\S]*?previewFitFrameAvailable\.value = true[\s\S]*?commitPreviewFitRenderPlan\(\)[\s\S]*?showPreviewFitFrame\(\)/)
  assert.match(appSource, /function togglePreviewAutoFit\(\)[\s\S]*?ensurePreviewFitCanvas\(\)[\s\S]*?previewDisplayMode\.value = 'dom'/)

  assert.match(previewSource, /runtimeStore:\s*\{\s*type:\s*Object/)
  assert.match(previewSource, /excludedNodeIds:\s*\{\s*type:\s*Array/)
  assert.match(previewSource, /excludedDrawingIds:\s*\{\s*type:\s*Array/)
  assert.match(previewSource, /props\.runtimeStore\?\.getValue\?\.\(key\)/)
  assert.match(previewSource, /maxBitmapPixels:\s*\{\s*type:\s*Number/)
  assert.match(previewSource, /pixelRatio:\s*\{\s*type:\s*Number,\s*default:\s*0\s*\}/)
  assert.match(previewSource, /viewBox:\s*\{\s*type:\s*Object/)
  assert.match(previewSource, /renderBudgetMs:\s*\{\s*type:\s*Number,\s*default:\s*2\s*\}/)
  assert.match(previewSource, /const MAX_RENDER_SLICE_BUDGET_MS = 6/)
  assert.match(previewSource, /Math\.min\(MAX_RENDER_SLICE_BUDGET_MS, Math\.max\(MIN_RENDER_SLICE_BUDGET_MS, requested\)\)/)
  assert.match(previewSource, /renderMode:\s*\{ type: String, default: 'idle', validator: value => \['idle', 'frame', 'task'\]\.includes\(value\) \}/)
  assert.match(previewSource, /function scheduleTaskRender\(callback\)[\s\S]*?taskRenderChannel\.port2\.postMessage\(id\)/)
  assert.match(previewSource, /if \(props\.renderMode === 'task'\) return scheduleTaskRenderSlice\(callback\)/)
  assert.match(previewSource, /canvasBitmapDimensions\(\{[\s\S]*?devicePixelRatio: payload\.pixelRatio > 0 \? payload\.pixelRatio : globalThis\.devicePixelRatio,[\s\S]*?maximum: maxBitmapPixels/)
  assert.match(previewSource, /miniMapTransform\(\{[\s\S]*?viewBox: payload\.viewBox/)
  assert.match(previewSource, /committedCssWidth\.value = task\.width[\s\S]*?committedCssHeight\.value = task\.height[\s\S]*?committedRenderPlanKey\.value = task\.renderPlanKey/)
  assert.match(previewSource, /atomicCssSize:\s*\{ type: Boolean, default: false \}/)
  assert.match(previewSource, /minimumScreenTextSize:\s*\{ type: Number, default: 0 \}/)
  assert.match(previewSource, /minimumScreenStrokeSize:\s*\{ type: Number, default: 0 \}/)
  assert.match(previewSource, /readableCanvasFontSize\(\{[\s\S]*?minimumScreenSize: props\.minimumScreenTextSize/)
  assert.match(previewSource, /function readableStroke\(requestedWidth, worldPixel\)[\s\S]*?props\.minimumScreenStrokeSize/)
  assert.match(previewSource, /:style="\{ width: `\$\{atomicCssSize && committedCssWidth \? committedCssWidth : width\}px`, height: `\$\{atomicCssSize && committedCssHeight \? committedCssHeight : height\}px`/)
  assert.match(previewSource, /function requestCoalescedRender\(\)[\s\S]*?renderScheduler\.state\.pending[\s\S]*?coalescedRenderDirty = true/)
  const fullRenderWatch = previewSource.slice(
    previewSource.indexOf('watch(['),
    previewSource.indexOf('watch([\n  () => props.timeContext')
  )
  const fullRenderDependencies = fullRenderWatch.match(/watch\(\[[\s\S]*?\], \(\) => \{/)?.[0] || ''
  assert.doesNotMatch(fullRenderDependencies, /\(\) => props\.frameCommitToken/)
  assert.match(fullRenderWatch, /props\.frameCommitToken != null && !previewFrameCommitRequested\(props\.frameCommitToken\)[\s\S]*?scheduleRender\(\)/)
  assert.match(previewSource, /watch\(\(\) => props\.frameCommitToken, token => \{[\s\S]*?previewFrameCommitRequested\(token\)[\s\S]*?scheduleRender\(\)/)
  const fullCommitSource = previewSource.match(/function commitRenderTask\(task\)[\s\S]*?(?=\nconst renderScheduler)/)?.[0] || ''
  const fullGuard = fullCommitSource.indexOf('frameCommitAccepted(completion)')
  const contextGuard = fullCommitSource.indexOf('canvasContextGate.accepts(task.contextToken, target, targetContext)')
  const visibleDraw = fullCommitSource.indexOf('commitCanvasSurfaceWithResize(target, task.surface')
  assert.ok(fullGuard >= 0 && contextGuard > fullGuard && visibleDraw > contextGuard)
  assert.doesNotMatch(fullCommitSource, /target\.(width|height)\s*=/)
  assert.match(fullCommitSource, /emit\('render-rejected', completion\)/)
  assert.match(previewSource, /committedGeneration\.value = completion\.generation[\s\S]*?renderReady\.value = true[\s\S]*?emit\('render-complete', completion\)/)
  assert.match(previewSource, /if \(coalescedRenderDirty\)[\s\S]*?scheduleRender\(\)\s*return\s*\}[\s\S]*?if \(pendingRuntimeDense \|\| pendingRuntimeNodes\.size\) scheduleRuntimeRender\(\)/)
  const runtimeCommitSource = previewSource.match(/function commitRuntimeRenderTask\(task\)[\s\S]*?(?=\nconst runtimeRenderScheduler)/)?.[0] || ''
  assert.ok(runtimeCommitSource.indexOf('frameCommitAccepted(completion)') < runtimeCommitSource.indexOf("task.target.getContext('2d')"))
  assert.match(runtimeCommitSource, /commitCanvasSurface\(targetContext, task\.composite, task\.bitmapRects\)/)
  assert.doesNotMatch(runtimeCommitSource, /targetContext\.clearRect|for \(const rect of task\.bitmapRects\)/)
  assert.match(runtimeCommitSource, /if \(task\.bitmapRects\.length && !commitCanvasSurface/)
  assert.match(runtimeCommitSource, /if \(nextComposite\) \{[\s\S]*?task\.mode === 'sparse'\) swapCommittedCompositeSurface\(nextComposite, task\.bitmapRects\)[\s\S]*?else replaceCommittedCompositeSurface\(nextComposite\)/)
  assert.match(runtimeCommitSource, /committedGeneration\.value = completion\.generation[\s\S]*?renderReady\.value = true[\s\S]*?emit\('render-complete', completion\)/)
  assert.match(runtimeCommitSource, /if \(!pendingRuntimeDense && !pendingRuntimeNodes\.size\) \{[\s\S]*?runtimeRenderDirty = false[\s\S]*?return[\s\S]*?\}/)
  assert.match(runtimeCommitSource, /if \(runtimeDenseStreamOpen && runtimeDenseStreamStarted\) \{[\s\S]*?runtimeRenderDirty = true[\s\S]*?queueRuntimeDenseStreamFlush\(\)[\s\S]*?return[\s\S]*?\}/)
  assert.match(runtimeCommitSource, /runtimeRenderDirty = false\s*scheduleRuntimeRender\(\)\s*\}/)
  assert.match(previewSource, /function startFullRender\(metadata = \{\}\) \{[\s\S]*?invalidateIncrementalRuntime\(\)[\s\S]*?committedTimeNodes = \[\][\s\S]*?if \(!committedGeneration\.value\) renderReady\.value = false/)
  assert.match(previewSource, /function markGeometryFullDirty\(\)[\s\S]*?session\.fullDirty = true[\s\S]*?queueGeometryFullRefresh\(session\)/)
  assert.match(previewSource, /function requestCoalescedRender\(\)[\s\S]*?renderScheduler\.state\.pending[\s\S]*?coalescedRenderDirty = true[\s\S]*?return startFullRender\(\)/)
  assert.doesNotMatch(previewSource, /function draw\(\)/)
  assert.match(previewSource, /incrementalRuntime:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/)
  assert.match(previewSource, /spatialIndex:\s*\{\s*type:\s*Object,\s*default:\s*null\s*\}/)
  assert.match(previewSource, /drawingSpatialIndex:\s*\{\s*type:\s*Object,\s*default:\s*null\s*\}/)
  assert.match(previewSource, /function resolveChangedRuntimeNodes\(source\)[\s\S]*?committedStaticFrame && !runtimeNodeBitmapRect\(node, committedStaticFrame\)[\s\S]*?resolved\.push\(node\)/)
  assert.match(previewSource, /function requestRuntimeRender\(changedNodes\)[\s\S]*?runtimeRenderRequest\(changedNodes\)[\s\S]*?resolveChangedRuntimeNodes\(request\.nodes\)[\s\S]*?pendingRuntimeNodes\.set[\s\S]*?if \(!canIncrementRuntime\(\)\)[\s\S]*?renderScheduler\.state\.pending[\s\S]*?return renderScheduler\.state\.generation/)
  assert.match(previewSource, /function drawGauge\([^)]*renderPass = 'full'\)[\s\S]*?renderPass !== 'runtime'[\s\S]*?renderPass === 'static'\) return[\s\S]*?const percent/)
  assert.match(previewSource, /if \(node\.type === 'progress'\)[\s\S]*?renderPass !== 'runtime'[\s\S]*?renderPass === 'static'\) return[\s\S]*?const percent/)
  assert.match(previewSource, /if \(node\?\.type === 'time'\) return true/)
  assert.match(previewSource, /if \(item\.entity\.type === 'time'\) task\.timeEntities\.push\(item\.entity\)/)
  const layeredFullRender = previewSource.match(/function drawEntities\(task, deadline\)[\s\S]*?(?=\nfunction runRenderSlice)/)?.[0] || ''
  assert.match(layeredFullRender, /task\.excludedNodeIds\.has\(item\.entity\.id\)[\s\S]*?continue/)
  assert.match(layeredFullRender, /task\.excludedDrawingIds\.has\(item\.entity\.id\)[\s\S]*?continue/)
  assert.match(previewSource, /function createStaticRenderSurface\(task\)[\s\S]*?acquireRenderSurface\(task\.bitmapWidth, task\.bitmapHeight, task\.reuseSurfaces\)[\s\S]*?fillRenderBackground\(ctx, task\.background, task\.stageWidth, task\.stageHeight\)/)
  assert.match(previewSource, /const MAX_REUSABLE_RENDER_SURFACES = 2/)
  assert.match(previewSource, /function clearReusableRenderSurfaces\(\)[\s\S]*?reusableRenderSurfaces\.splice\(0\)[\s\S]*?surface\.width = 0/)
  assert.match(previewSource, /function drawStaticEdges\(task, deadline\)[\s\S]*?drawEdges\([\s\S]*?task\.staticCtx[\s\S]*?deadline,[\s\S]*?task[\s\S]*?finishEdgePass\(task\)/)
  assert.match(previewSource, /function composeStaticRenderSurface\(task\)[\s\S]*?commitCanvasSurface\(task\.ctx, task\.staticSurface\)[\s\S]*?task\.phase = task\.usesSharedEntities/)
  assert.doesNotMatch(previewSource, /function copyCanvasSurface/)
  assert.match(layeredFullRender, /drawEntityIncrementally\(\s*task,\s*item\.entity,[\s\S]*?'full'/)
  assert.doesNotMatch(layeredFullRender, /staticCtx|drawNode\([^\n]+, 'static'\)/)
  const layeredStaticPatch = previewSource.match(/function drawGeometryStaticPlan\(ctx, plan, snapshot\)[\s\S]*?(?=\nfunction drawGeometryCompositePlan)/)?.[0] || ''
  assert.match(layeredStaticPatch, /for \(const edge of plan\.edges\) drawEdge/)
  assert.doesNotMatch(layeredStaticPatch, /drawNode|drawTemporaryDrawing/)
  assert.match(previewSource, /function commitGeometryPlans\(plans, snapshot\)[\s\S]*?commitCanvasSurface\(targetContext, committedCompositeSurface, plans\.map\(plan => plan\.bitmapRect\)\)[\s\S]*?geometry-commit-failed/)
  assert.match(previewSource, /function beginRuntimeBackingMutation\(reason\)[\s\S]*?runtimeRenderScheduler\.invalidate\(reason\)[\s\S]*?runtimeRenderEpoch \+= 1[\s\S]*?pendingRuntimeDense = true/)
  assert.match(previewSource, /function beginGeometryInteraction[\s\S]*?beginRuntimeBackingMutation\('geometry'\)/)
  assert.match(previewSource, /function cancelGeometryInteraction[\s\S]*?runtimeRenderDirty \|\| runtimeRenderFollowUpPending\(\)[\s\S]*?canIncrementRuntime\(\)[\s\S]*?scheduleRuntimeRender\(\)[\s\S]*?requestCoalescedRender\(\)/)
  assert.match(previewSource, /function patchRemovedEntities\(source = \{\}\)[\s\S]*?beginRuntimeBackingMutation\('geometry-removal'\)[\s\S]*?removeGeometryOwnerSegments[\s\S]*?if \(replayRuntime\) scheduleRuntimeRender\(\)/)
  assert.doesNotMatch(previewSource, /runtimeEntities|function drawRuntimeEntities/)
  assert.match(previewSource, /createRuntimeQueryCursor\(querySources\)[\s\S]*?item\.kind === 'drawing'[\s\S]*?drawEntityIncrementally\(\s*task,\s*item\.entity,[\s\S]*?'full'/)
  assert.match(previewSource, /function beginRuntimeRegionDraw\(task\)[\s\S]*?task\.ctx\.clearRect\(bitmapRect\.x, bitmapRect\.y, bitmapRect\.w, bitmapRect\.h\)[\s\S]*?task\.ctx\.drawImage\(\s*task\.base,/)
  assert.match(previewSource, /function drawGeometryCompositePlan[\s\S]*?for \(const item of plan\.entities\)[\s\S]*?drawNode\(ctx, item\.entity[^\n]+, 'full', opacityMultiplier\)/)
  assert.match(previewSource, /function patchRemovedEntities\(source = \{\}\)[\s\S]*?geometryRegions\(removed\)[\s\S]*?removeGeometryOwnerSegments\('edge', removed\.edges\)[\s\S]*?geometryPatchPlans\(current, merged\.regions\)[\s\S]*?commitGeometryPlans\(plans, current\)/)
  assert.match(previewSource, /defineExpose\(\{[\s\S]*?patchRemovedEntities,/)
  assert.match(previewSource, /function requestTimeRender\(\)[\s\S]*?committedTimeNodes\.length[\s\S]*?shouldUseDenseRuntime\([\s\S]*?nodeCount: committedTimeNodes\.length[\s\S]*?requestRuntimeRender\(\{ nodes: \[\], dense: true, pending: false \}\)[\s\S]*?requestRuntimeRender\(committedTimeNodes\)/)
  assert.match(previewSource, /\(\) => props\.timeContext\?\.serverOffset\?\.value\s*\], requestTimeRender/)
  assert.match(previewSource, /active:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/)
  assert.match(previewSource, /function requestImageRender\(\)[\s\S]*?if \(!props\.active\)[\s\S]*?imageRenderTrigger\.request\(\)/)
  assert.match(previewSource, /image\.onload = requestImageRender/)
  assert.doesNotMatch(previewSource, /image\.onerror = request(?:Coalesced|Image)Render/)
  assert.match(previewSource, /createCoalescedRenderTrigger\(\{[\s\S]*?schedule: scheduleImageRender[\s\S]*?flush: requestCoalescedRender/)
  assert.match(previewSource, /function requestRuntimeRender\(changedNodes\)\s*\{\s*if \(!props\.active\)[\s\S]*?runtimeRenderRequest\(changedNodes\)[\s\S]*?resolveChangedRuntimeNodes\(request\.nodes\)/)
  assert.match(previewSource, /function requestTimeRender\(\)\s*\{\s*if \(!props\.active\)/)
  for (const [name, inactiveReturn] of [
    ['patchRemovedEntities', 'false'],
    ['beginGeometryInteraction', 'null'],
    ['requestGeometryInteractionFrame', 'null'],
    ['finishGeometryInteraction', 'null']
  ]) {
    assert.match(
      previewSource,
      new RegExp(`function ${name}\\([^)]*\\) \\{\\s*if \\(!props\\.active\\) \\{\\s*geometryInteraction = null\\s*return ${inactiveReturn}`),
      `${name} must be inert and clear stale geometry while suspended`
    )
  }
  assert.doesNotMatch(fullRenderDependencies, /\(\) => props\.active/)
  assert.match(fullRenderWatch, /if \(!props\.active\)[\s\S]*?suspendedRenderDirty = true[\s\S]*?previewFrameCommitRequested/)
  assert.match(previewSource, /watch\(\(\) => props\.active, active => \{[\s\S]*?if \(!suspendedRenderDirty\) return[\s\S]*?scheduleRender\(\)[\s\S]*?geometryInteraction = null[\s\S]*?imageRenderTrigger\.cancel\(\)[\s\S]*?invalidatePendingRender\('suspended'\)[\s\S]*?invalidateIncrementalRuntime\(\)/)
  assert.match(previewSource, /onBeforeUnmount\(\(\) => \{[\s\S]*?imageRenderTrigger\.dispose\(\)/)
  assert.match(previewSource, /function pruneImageCache\(activeUrls\)[\s\S]*?releaseCachedImage\(image\)[\s\S]*?imageCache\.delete\(url\)/)
  assert.match(previewSource, /task\.imageUrls\.add\(item\.entity\.imageUrl\)[\s\S]*?pruneImageCache\(task\.imageUrls\)/)
  assert.match(previewSource, /function clearImageCache\(\)[\s\S]*?releaseCachedImage\(image\)[\s\S]*?imageCache\.clear\(\)/)
  assert.match(previewSource, /emit\('render-complete'/)
  assert.match(previewSource, /:data-render-ready=/)

  assert.match(appSource, /runtimeData\.subscribeAll\(\([^)]*\) => \{[\s\S]*?markRuntimeCanvasDirty\(\)/)
  assert.match(appSource, /function markRuntimeCanvasDirty\(\)[\s\S]*?const dirty = takeRuntimeCanvasDirtyNodes\(\)[\s\S]*?const runtimeRequest = \{[\s\S]*?nodes: dirty\.nodes,[\s\S]*?dense: dirty\.dense,[\s\S]*?pending: dirty\.pending[\s\S]*?\}[\s\S]*?for \(const target of targets\)[\s\S]*?target\.requestRuntimeRender\?\.\(runtimeRequest\)/)
  assert.match(appSource, /unsubscribeRuntimeStore\(\)/)
})

test('progressively mounts preview edges and drawings without a full-source first pass', async () => {
  const geometrySource = await readFile(new URL('../src/components/ProgressivePreviewGeometry.vue', import.meta.url), 'utf8')
  const edgeBatchSource = await readFile(new URL('../src/components/PreviewEdgeBatch.vue', import.meta.url), 'utf8')
  const drawingBatchSource = await readFile(new URL('../src/components/PreviewDrawingBatch.vue', import.meta.url), 'utf8')

  const emptyBatchFastPath = geometrySource.indexOf('if (!batches.length)')
  const retainedSourceScan = geometrySource.indexOf('const sourceById = new Map()')
  assert.ok(emptyBatchFastPath >= 0 && emptyBatchFastPath < retainedSourceScan)
  assert.match(geometrySource, /return \{ batches: \[\], pending: source, retainedCount: 0 \}/)
  assert.match(geometrySource, /edgeBatchSize:\s*\{ type: Number, default: 64 \}/)
  assert.match(geometrySource, /drawingBatchSize:\s*\{ type: Number, default: 8 \}/)
  assert.match(geometrySource, /target\.value\.push\(\{ id: nextBatchId\+\+, items: pending\.slice\(cursor, end\) \}\)/)
  assert.match(geometrySource, /appendNextBatch\(\)[\s\S]*?scheduleRenderFrame\(revealNextBatch\)/)
  assert.match(geometrySource, /nextPreviewMountBatchScale\(batchScale, currentTime\(\) - mountStartedAt\)/)
  assert.match(geometrySource, /sourceGeneration !== props\.generation \|\| sourceEdges !== props\.edges \|\| sourceDrawings !== props\.drawings/)
  assert.match(geometrySource, /:generation="generation"/)

  assert.match(edgeBatchSource, /void props\.generation[\s\S]*?props\.edges\.map\(edge/)
  assert.match(edgeBatchSource, /v-memo="\[generation,[^"]*entry\.edge\.color[^"]*entry\.edge\.startMarker[^"]*entry\.edge\.endMarker/)
  assert.match(drawingBatchSource, /void props\.generation[\s\S]*?props\.drawings\.map\(props\.entryFactory\)/)
  assert.match(drawingBatchSource, /v-memo="\[generation,[^"]*entry\.path[^"]*entry\.drawing\.color[^"]*entry\.drawing\.opacity/)
})

test('grows one stable DOM preview batch without reparenting mounted media', async () => {
  const source = await readFile(new URL('../src/components/ProgressivePreviewNodes.vue', import.meta.url), 'utf8')

  assert.match(source, /const visibleNodes = shallowRef\(\[\]\)/)
  assert.match(source, /partitionRetainedPreviewNodes\(source, visibleNodes\.value\)/)
  assert.match(source, /\{ retainedIds, retainedNodes, pendingNodes \} = partitionRetainedPreviewNodes/)
  assert.match(source, /visibleNodes\.value = retainedNodes/)
  assert.match(source, /previewMountBatchEnd\(pendingNodes, start/)
  assert.match(source, /visibleNodes\.value\.push\(\.\.\.pendingNodes\.slice\(pendingCount, nextCount\)\)[\s\S]*?triggerRef\(visibleNodes\)/)
  assert.match(source, /nextPreviewMountBatchScale\([\s\S]*?mountElapsedMs/)
  assert.match(source, /if \(!props\.progressive \|\| retainedIds\.size\) visibleNodes\.value = source\.slice\(\)[\s\S]*?reportRenderComplete/)
  assert.equal((source.match(/<PreviewNodeBatch/g) || []).length, 1)
  assert.doesNotMatch(source, /v-for="batch|batch-\$\{offset\}/)
  assert.match(source, /if \(generation !== renderGeneration\) return/)
})

test('non-progressive preview still settles the complete source on a fresh mount', async () => {
  const source = await readFile(new URL('../src/components/ProgressivePreviewNodes.vue', import.meta.url), 'utf8')
  const settleStart = source.indexOf('const settleVisibleNodes = () => {')
  const settleEnd = source.indexOf('const appendPendingBatch = () => {', settleStart)
  const settleSource = source.slice(settleStart, settleEnd)
  const nonProgressiveStart = source.indexOf('if (!props.progressive) {', settleEnd)
  const nonProgressiveEnd = source.indexOf('appendPendingBatch()', nonProgressiveStart)
  const nonProgressiveSource = source.slice(nonProgressiveStart, nonProgressiveEnd)

  assert.match(settleSource, /if \(!props\.progressive \|\| retainedIds\.size\) visibleNodes\.value = source\.slice\(\)/)
  assert.match(nonProgressiveSource, /settleVisibleNodes\(\)/)
})

test('preview DOM mount scaling grows on cheap commits and backs off on expensive commits', () => {
  assert.equal(nextPreviewMountBatchScale(1, 1), 2)
  assert.equal(nextPreviewMountBatchScale(8, 1), 16)
  assert.equal(nextPreviewMountBatchScale(16, 1), 16)
  assert.equal(nextPreviewMountBatchScale(8, 5), 8)
  assert.equal(nextPreviewMountBatchScale(8, 12), 4)
  assert.equal(nextPreviewMountBatchScale(1, 12), 1)
})

test('shrinking a progressive preview immediately drops stale DOM and keeps current references', () => {
  const previous = Array.from({ length: 10_000 }, (_, index) => ({ id: `node-${index}`, stale: true }))
  const source = Array.from({ length: 96 }, (_, index) => ({ id: `node-${index + 48}`, stale: false }))
  source.push({ id: 'new-node', stale: false })
  const result = partitionRetainedPreviewNodes(source, [...previous, previous[48]])

  assert.equal(result.retainedNodes.length, 96)
  assert.deepEqual(result.retainedNodes, source.slice(0, 96))
  assert.deepEqual(result.pendingNodes, [source.at(-1)])
  assert.equal(result.retainedIds.size, 96)
  assert.ok(result.retainedNodes.every(node => node.stale === false))
})

test('a fresh progressive preview reuses the source as its pending cursor without scanning it', () => {
  let indexedReads = 0
  const source = new Proxy(Array.from({ length: 20_000 }, (_, index) => ({ id: `node-${index}` })), {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) indexedReads += 1
      return Reflect.get(target, key, receiver)
    }
  })
  const result = partitionRetainedPreviewNodes(source, [])

  assert.equal(indexedReads, 0)
  assert.equal(result.retainedIds.size, 0)
  assert.deepEqual(result.retainedNodes, [])
  assert.equal(result.pendingNodes, source)
})

test('preview batches are bounded by rendered DOM cost as well as node count', () => {
  const fullTable = {
    type: 'table',
    tableColumns: 12,
    tableRows: 50,
    showHeader: true
  }
  assert.equal(previewNodeMountCost(fullTable), 628)
  assert.equal(previewMountBatchEnd(Array(128).fill(fullTable), 0, {
    maxNodes: 128,
    costBudget: 1024
  }), 1)

  const simpleNodes = Array.from({ length: 256 }, () => ({ type: 'rect' }))
  assert.equal(previewMountBatchEnd(simpleNodes, 0, {
    maxNodes: 128,
    costBudget: 1024
  }), 128)

  const mixed = [fullTable, ...simpleNodes]
  assert.equal(previewMountBatchEnd(mixed, 0, {
    maxNodes: 128,
    costBudget: 1024
  }), 50)
})
