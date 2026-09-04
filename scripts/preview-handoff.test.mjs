import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createPreviewFrameFreshness } from '../src/utils/previewFrameFreshness.js'
import {
  buildPreviewHybridPlan,
  PREVIEW_RENDER_CAPABILITIES,
  PREVIEW_HYBRID_MAX_DOM_COST,
  PREVIEW_HYBRID_MAX_DOM_ENTRIES,
  PREVIEW_HYBRID_MAX_DOM_NODES,
  previewHybridDomSafe,
  previewHybridLayerTail,
  previewHybridTailDomSafe,
  previewNodeCanUseCanvasFallback,
  previewNodeRenderCapability,
  previewNodeNeedsLiveDom
} from '../src/utils/previewRenderPolicy.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const progressiveSource = readFileSync(new URL('../src/components/ProgressivePreviewNodes.vue', import.meta.url), 'utf8')
const progressiveGeometrySource = readFileSync(new URL('../src/components/ProgressivePreviewGeometry.vue', import.meta.url), 'utf8')
const edgeBatchSource = readFileSync(new URL('../src/components/PreviewEdgeBatch.vue', import.meta.url), 'utf8')
const drawingBatchSource = readFileSync(new URL('../src/components/PreviewDrawingBatch.vue', import.meta.url), 'utf8')
const batchSource = readFileSync(new URL('../src/components/PreviewNodeBatch.vue', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

function openingTag(source, marker) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `expected ${marker}`)
  const end = source.indexOf('>', start)
  assert.notEqual(end, -1, `expected closing > after ${marker}`)
  return source.slice(start, end + 1)
}

function openingTagContaining(source, marker) {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `expected ${marker}`)
  const start = source.lastIndexOf('<', markerIndex)
  const end = source.indexOf('>', markerIndex)
  assert.notEqual(start, -1, `expected opening < before ${marker}`)
  assert.notEqual(end, -1, `expected closing > after ${marker}`)
  return source.slice(start, end + 1)
}

test('ordinary preview keeps every header action above the canvas', () => {
  const previewTemplate = sourceBetween(appSource, '<div v-if="showPreview"', '<Teleport v-if="buttonMessageDialog.show"')
  const previewHeader = sourceBetween(previewTemplate, '<header v-if="showPreview && !previewFullscreen"', '</header>')
  const topbarTag = openingTag(appSource, '<header v-show="!showPreview" class="topbar"')
  const workspaceTag = openingTag(appSource, '<main v-show="!showPreview" class="workspace"')

  assert.equal((previewHeader.match(/<button\b/g) || []).length, 3)
  assert.doesNotMatch(previewHeader, /\s(?::)?title=/)
  assert.match(previewHeader, /:aria-label="previewAutoFit \? '恢复原始尺寸预览' : '自适应预览'"/)
  assert.match(previewHeader, /aria-label="全屏预览"/)
  assert.match(previewHeader, /aria-label="关闭预览"/)
  assert.match(previewTemplate, /class="preview-viewport-clip"[^>]*data-testid="preview-viewport-clip"[^>]*>[\s\S]*?<div ref="previewCanvas"/)
  assert.match(previewTemplate, /data-testid="preview-overlay"[\s\S]*?<\/div>\s*<header v-if="showPreview && !previewFullscreen" class="preview-header"/)
  assert.match(topbarTag, /v-show="!showPreview"/)
  assert.match(workspaceTag, /v-show="!showPreview"/)
  assert.match(styleSource, /\.preview-overlay\s*\{[^}]*inset:\s*50px 0 0[^}]*display:\s*block[^}]*overflow:\s*hidden/)
  assert.match(styleSource, /\.preview-header\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*51[^}]*height:\s*50px[^}]*isolation:\s*isolate/)
  assert.match(styleSource, /\.preview-header\s*\{[^}]*contain:\s*layout paint style[^}]*transform:\s*translateZ\(0\)[^}]*backface-visibility:\s*hidden/)
  assert.match(styleSource, /\.preview-viewport-clip\s*\{[^}]*position:\s*relative[^}]*width:\s*100%[^}]*height:\s*100%[^}]*overflow:\s*hidden/)
  assert.doesNotMatch(styleSource, /\.preview-viewport-clip\s*\{[^}]*(?:position:\s*absolute|contain:|clip-path:)/)
  assert.match(styleSource, /\.preview-canvas\s*\{[^}]*z-index:\s*0[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*max-height:\s*100%/)
  assert.match(styleSource, /\.preview-actions\s*\{[^}]*min-width:\s*max-content[^}]*flex:\s*0\s+0\s+auto/)
  assert.match(styleSource, /\.preview-header\s+\.preview-actions\s+button\s*\{[^}]*flex:\s*none/)
  assert.doesNotMatch(styleSource, /\.preview-overlay\s*>\s*header/)
  assert.match(styleSource, /\.preview-overlay\.is-fullscreen,[\s\S]*?inset:\s*0/)
  assert.match(styleSource, /\.preview-overlay\.is-fullscreen\s*>\s*\.preview-viewport-clip,[\s\S]*?inset:\s*auto[^}]*grid-row:\s*1/)
  assert.doesNotMatch(styleSource, /\.preview-overlay\.is-preparing\s*\{[^}]*opacity:/)
  assert.match(styleSource, /\.preview-overlay\.is-preparing \.preview-stage-space\s*\{[^}]*visibility:\s*hidden/)
})

test('fullscreen transitions preserve an already completed DOM handoff', () => {
  const ensureSource = sourceBetween(
    appSource,
    'function ensurePreviewDomHandoff',
    'function clearPreviewFitCommittedPlan'
  )
  const fullscreenSource = sourceBetween(
    appSource,
    'function handleFullscreenChange',
    'function reconcilePreviewFullscreenState'
  )
  const previewDomMounted = { value: true }
  const previewRenderTarget = { value: 'dom' }
  const previewDomGeneration = { value: 41 }
  const previewDomNodesReady = { value: true }
  const previewDomGeometryReady = { value: true }
  let resetCount = 0
  const resetPreviewDomHandoff = () => {
    resetCount += 1
    previewDomMounted.value = true
    previewRenderTarget.value = 'dom'
    previewDomGeneration.value += 1
    previewDomNodesReady.value = false
    previewDomGeometryReady.value = false
  }
  const ensurePreviewDomHandoff = new Function(
    'previewDomMounted',
    'previewRenderTarget',
    'resetPreviewDomHandoff',
    `${ensureSource}\nreturn ensurePreviewDomHandoff`
  )(previewDomMounted, previewRenderTarget, resetPreviewDomHandoff)

  assert.equal(ensurePreviewDomHandoff(), false)
  assert.equal(resetCount, 0)
  assert.equal(previewDomGeneration.value, 41)
  assert.equal(previewDomNodesReady.value, true)
  assert.equal(previewDomGeometryReady.value, true)

  const previewFullscreenRoot = {}
  const previewFullscreen = { value: false }
  const previewAutoFit = { value: false }
  const previewFitCanUseCanvas = { value: false }
  let currentFullscreenElement = previewFullscreenRoot
  let invalidations = 0
  let ensureCount = 0
  const viewportUpdates = []
  const harness = new Function(
    'previewFullscreen',
    'fullscreenElement',
    'previewFullscreenTarget',
    'invalidatePreviewViewportSchedule',
    'ensurePreviewDomHandoff',
    'updatePreviewViewport',
    'previewAutoFit',
    'previewFitCanUseCanvas',
    'previewRenderTarget',
    'syncPreviewFullscreenViewportSize',
    'initialScroll',
    `let previewScrollBeforeFullscreen = initialScroll\n${fullscreenSource}\nreturn { handleFullscreenChange, storedScroll: () => previewScrollBeforeFullscreen }`
  )(
    previewFullscreen,
    () => currentFullscreenElement,
    () => previewFullscreenRoot,
    () => { invalidations += 1 },
    () => {
      ensureCount += 1
      return ensurePreviewDomHandoff()
    },
    update => viewportUpdates.push(update),
    previewAutoFit,
    previewFitCanUseCanvas,
    previewRenderTarget,
    () => {},
    { left: 17, top: 29 }
  )

  harness.handleFullscreenChange()
  assert.equal(previewFullscreen.value, true)
  assert.equal(previewDomGeneration.value, 41)
  assert.equal(previewDomNodesReady.value, true)
  assert.equal(previewDomGeometryReady.value, true)

  currentFullscreenElement = null
  harness.handleFullscreenChange()
  assert.equal(previewFullscreen.value, false)
  assert.equal(harness.storedScroll(), null)
  assert.equal(previewDomGeneration.value, 41)
  assert.equal(previewDomNodesReady.value, true)
  assert.equal(previewDomGeometryReady.value, true)
  assert.equal(resetCount, 0)
  assert.equal(ensureCount, 2)
  assert.equal(invalidations, 2)
  assert.deepEqual(viewportUpdates, [
    { scroll: { left: 0, top: 0 }, waitForContentRect: true },
    { scroll: { left: 17, top: 29 }, waitForContentRect: true }
  ])
})

test('auto-fit and fullscreen transitions are mutually exclusive across async work', () => {
  const autoFit = sourceBetween(appSource, 'async function togglePreviewAutoFit', 'async function enterPreviewFullscreen')
  const enterFullscreen = sourceBetween(appSource, 'async function enterPreviewFullscreen', 'async function exitPreviewFullscreen')
  const toggleFullscreen = sourceBetween(appSource, 'function togglePreviewFullscreen', 'async function closePreview')
  const previewHeader = sourceBetween(appSource, '<header v-if="showPreview && !previewFullscreen"', '</header>')

  assert.match(appSource, /const previewAutoFitPending = ref\(false\)/)
  assert.match(appSource, /const previewModeTransitionPending = computed\(\(\) => previewAutoFitPending\.value \|\| previewFullscreenPending\.value\)/)
  assert.match(autoFit, /if \(previewModeTransitionPending\.value\) return/)
  assert.match(autoFit, /previewAutoFitPending\.value = true[\s\S]*?finally \{[\s\S]*?previewAutoFitPending\.value = false/)
  assert.match(enterFullscreen, /previewModeTransitionPending\.value/)
  assert.match(toggleFullscreen, /previewModeTransitionPending\.value/)
  assert.equal((previewHeader.match(/:disabled="previewModeTransitionPending"/g) || []).length, 2)
})

test('dense original-size preview queries the complete viewport instead of truncating the 513th entity', () => {
  const nodeCandidates = sourceBetween(appSource, 'const previewNodeCandidates', 'function edgesForNodeIds')
  const edgeCandidates = sourceBetween(appSource, 'const previewEdgeCandidates', 'const previewDrawingCandidates')
  const drawingCandidates = sourceBetween(appSource, 'const previewDrawingCandidates', '// 复用原高密连线画布')
  const visibleNodes = sourceBetween(appSource, 'const previewVisibleNodes', 'function edgesForNodeIds')

  assert.match(nodeCandidates, /const bounds = previewDomQueryBounds\.value \|\| viewportWorldBounds\(previewViewport\.value, 1, LARGE_DOCUMENT_OVERSCAN\)/)
  assert.match(nodeCandidates, /nodeSpatialIndex\.query\(bounds, \{ sort: false \}\)/)
  assert.doesNotMatch(nodeCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(edgeCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(drawingCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(visibleNodes, /PREVIEW_DOM_NODE_LIMIT|\.slice\(/)

  // The thresholds select the fallback strategy, never content to omit.
  assert.match(appSource, /const previewSmallDocument = computed\([\s\S]*?PREVIEW_DOM_NODE_LIMIT[\s\S]*?PREVIEW_DOM_EDGE_LIMIT[\s\S]*?PREVIEW_DOM_DRAWING_LIMIT/)
})

test('preview viewport retention bounds remain stable until the guard band is crossed', () => {
  const clippedBoundsSource = sourceBetween(
    appSource,
    'function clippedPreviewDomQueryBounds',
    'function previewDomQueryBoundsNeedRefresh'
  )
  const needsRefreshSource = sourceBetween(
    appSource,
    'function previewDomQueryBoundsNeedRefresh',
    'function syncPreviewDomQueryBounds'
  )
  const overscan = Number(appSource.match(/const PREVIEW_DOM_RETENTION_OVERSCAN = (\d+)/)?.[1])
  const guard = Number(appSource.match(/const PREVIEW_DOM_RETENTION_GUARD = (\d+)/)?.[1])
  assert.ok(Number.isFinite(overscan) && overscan > guard, 'retention overscan must exceed its refresh guard')

  const previewViewport = { value: { left: 1_000, top: 800, width: 1_000, height: 600 } }
  const stageWidth = { value: 6_000 }
  const stageHeight = { value: 4_000 }
  const viewportWorldBounds = (viewport, _zoom, buffer) => ({
    x: viewport.left - buffer,
    y: viewport.top - buffer,
    w: viewport.width + buffer * 2,
    h: viewport.height + buffer * 2
  })
  const createProbe = new Function(
    'viewportWorldBounds',
    'previewViewport',
    'stageWidth',
    'stageHeight',
    'PREVIEW_DOM_RETENTION_OVERSCAN',
    'PREVIEW_DOM_RETENTION_GUARD',
    `${clippedBoundsSource}\n${needsRefreshSource}\nreturn { clippedPreviewDomQueryBounds, previewDomQueryBoundsNeedRefresh }`
  )
  const probe = createProbe(
    viewportWorldBounds,
    previewViewport,
    stageWidth,
    stageHeight,
    overscan,
    guard
  )
  const retained = probe.clippedPreviewDomQueryBounds()

  previewViewport.value = { ...previewViewport.value, left: previewViewport.value.left + guard - 1 }
  assert.equal(probe.previewDomQueryBoundsNeedRefresh(retained), false, 'movement inside the guard band must retain mounted DOM')

  previewViewport.value = { ...previewViewport.value, left: previewViewport.value.left + overscan }
  assert.equal(probe.previewDomQueryBoundsNeedRefresh(retained), true, 'crossing the retained edge must request the next stable DOM window')
})

test('original-size and fullscreen previews render complete sharp viewport Canvas content', () => {
  const viewportCanvas = sourceBetween(appSource, '// 复用原高密连线画布', 'const previewVisibleEdges')
  const edgeCanvasTag = openingTag(appSource, '<MiniMapPreview v-if="previewEdgeCanvasBounds"')
  const domNodes = sourceBetween(appSource, 'const previewDomNodes', 'function edgesForNodeIds')
  const domEdges = sourceBetween(appSource, 'const previewDomEdges', 'const editorLodEdgeEntries')
  const domDrawings = sourceBetween(appSource, 'const previewDomDrawings', 'const previewLivePlaneDrawingEntries')
  const edgeCanvasVisibility = sourceBetween(appSource, 'const previewEdgeCanvasVisible', 'const previewVisibleEdges')
  const edgeCanvasMatcher = sourceBetween(appSource, 'function previewEdgeCanvasFrameMatchesRequest', 'function canCommitPreviewEdgeCanvasFrame')
  const edgeCanvasGuard = sourceBetween(appSource, 'function canCommitPreviewEdgeCanvasFrame', 'function handlePreviewEdgeCanvasRenderRejected')
  const edgeCanvasRejected = sourceBetween(appSource, 'function handlePreviewEdgeCanvasRenderRejected', 'function handlePreviewEdgeCanvasRenderComplete')
  const edgeCanvasComplete = sourceBetween(appSource, 'function handlePreviewEdgeCanvasRenderComplete', 'function handlePreviewEdgeCanvasRenderError')
  const edgeCanvasError = sourceBetween(appSource, 'function handlePreviewEdgeCanvasRenderError', 'function handlePreviewDomRenderStart')
  const previewTemplate = sourceBetween(appSource, '<div v-if="showPreview"', '<Teleport v-if="buttonMessageDialog.show"')

  assert.match(viewportCanvas, /previewViewportCanvasPlanned\.value/)
  assert.match(viewportCanvas, /previewViewportOverscan\(/)
  assert.match(viewportCanvas, /PREVIEW_EDGE_CANVAS_GUARD/)
  assert.match(viewportCanvas, /nodeSpatialIndex\.query\(bounds, \{ sort: false \}\)/)
  assert.match(viewportCanvas, /edgesInBounds\(bounds\)/)
  assert.match(viewportCanvas, /drawingsInBounds\(bounds\)/)
  assert.match(viewportCanvas, /layerEntries\.value\.filter/)
  assert.match(edgeCanvasTag, /:nodes="previewEdgeCanvasNodes"/)
  assert.match(edgeCanvasTag, /:edges="previewEdgeCanvasEdges"/)
  assert.match(edgeCanvasTag, /:drawings="previewEdgeCanvasDrawings"/)
  assert.match(edgeCanvasTag, /:ordered-entities="previewEdgeCanvasEntities"/)
  assert.match(edgeCanvasTag, /:spatial-index="nodeSpatialIndex"/)
  assert.match(edgeCanvasTag, /:edge-spatial-index="edgeSpatialIndex"/)
  assert.match(edgeCanvasTag, /:drawing-spatial-index="drawingSpatialIndex"/)
  assert.match(edgeCanvasTag, /:excluded-node-ids="previewFitExcludedNodeIds"/)
  assert.match(edgeCanvasTag, /:excluded-drawing-ids="previewFitExcludedDrawingIds"/)
  assert.match(edgeCanvasTag, /:runtime-store="runtimeData"/)
  assert.match(edgeCanvasTag, /:view-box="previewEdgeCanvasBounds"/)
  assert.match(edgeCanvasTag, /:render-plan-key="previewEdgeCanvasPlanKey"/)
  assert.match(edgeCanvasTag, /:frame-commit-guard="canCommitPreviewEdgeCanvasFrame"/)
  assert.match(edgeCanvasTag, /@render-rejected="handlePreviewEdgeCanvasRenderRejected"/)
  assert.match(edgeCanvasTag, /:pixel-ratio="previewEdgeCanvasPixelRatio"/)
  assert.match(edgeCanvasTag, /v-if="previewEdgeCanvasBounds"/)
  assert.match(edgeCanvasTag, /:active="previewDomEdgeCanvasActive"/)
  assert.match(edgeCanvasTag, /render-mode="task"/)
  assert.match(domNodes, /previewDomEdgeCanvasActive\.value\) return \[\]/)
  assert.match(domEdges, /previewDomEdgeCanvasActive\.value\) return \[\]/)
  assert.match(domDrawings, /previewDomEdgeCanvasActive\.value\) return \[\]/)
  assert.doesNotMatch(domEdges, /\.map\(|\blimit\s*:/)
  assert.match(previewTemplate, /<ProgressivePreviewGeometry[\s\S]*?:edges="previewDomEdges"[\s\S]*?:drawings="previewDomDrawings"/)
  assert.match(previewTemplate, /<ProgressivePreviewNodes :nodes="previewDomNodes"/)
  assert.match(edgeCanvasVisibility, /previewEdgeCanvasCommittedPlanKey\.value === previewEdgeCanvasPlanKey\.value/)
  assert.match(edgeCanvasVisibility, /previewBitmapIsSharp\(previewEdgeCanvasCommittedPixelRatio\.value, previewEdgeCanvasPixelRatio\.value\)/)
  assert.match(edgeCanvasVisibility, /previewCanvasBoundsContain\(previewEdgeCanvasCommittedBounds\.value, clippedPreviewEdgeCanvasBounds\(0\)\)/)
  assert.match(edgeCanvasMatcher, /\['full', 'runtime'\]\.includes\(event\?\.kind\)/)
  assert.match(edgeCanvasMatcher, /event\.renderPlanKey === previewEdgeCanvasPlanKey\.value/)
  assert.match(edgeCanvasMatcher, /previewCanvasBoundsMatch\(event\.viewBox, previewEdgeCanvasBounds\.value\)/)
  assert.match(edgeCanvasGuard, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewBitmapIsSharp/)
  assert.match(edgeCanvasGuard, /event\.kind === 'full'[\s\S]*?previewEdgeCanvasReady\.value[\s\S]*?event\.pendingFull !== true/)
  assert.match(edgeCanvasGuard, /event\.renderPlanKey === previewEdgeCanvasCommittedPlanKey\.value/)
  assert.match(edgeCanvasGuard, /previewCanvasBoundsMatch\(event\.viewBox, previewEdgeCanvasCommittedBounds\.value\)/)
  assert.match(edgeCanvasRejected, /event\?\.kind !== 'full'/)
  assert.match(edgeCanvasRejected, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewEdgeCanvasReady\.value = false[\s\S]*?handlePreviewEdgeCanvasRenderError\(\)/)
  assert.match(edgeCanvasComplete, /if \(!previewEdgeCanvasFrameMatchesRequest\(event\)\) return/)
  assert.match(edgeCanvasComplete, /if \(event\.kind === 'runtime'\) return/)
  assert.doesNotMatch(edgeCanvasComplete, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewEdgeCanvasReady\.value = false/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedBounds\.value = \{ \.\.\.renderedBounds \}/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedPixelRatio\.value = renderedPixelRatio/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedPlanKey\.value = event\.renderPlanKey/)
  assert.match(edgeCanvasComplete, /previewBitmapIsSharp[\s\S]*?handlePreviewEdgeCanvasRenderError\(\)/)
  assert.match(edgeCanvasError, /previewEdgeCanvasFailed\.value = true[\s\S]*?startPreviewFitCanvasFallback\(\)/)
  assert.match(appSource, /return `preview-viewport:[^`]*\$\{nodeSpatialRevision\.value\}:[^`]*\$\{edgeSpatialRevision\.value\}:[^`]*\$\{drawingSpatialRevision\.value\}:[^`]*\$\{previewEdgeCanvasPixelRatio\.value\}`/)
  assert.match(appSource, /!previewCanvasBoundsMatch\(nextBounds, previewEdgeCanvasBounds\.value\)[\s\S]*?!previewCanvasBoundsContain\(previewEdgeCanvasCommittedBounds\.value, clippedPreviewEdgeCanvasBounds\(0\)\)[\s\S]*?previewEdgeCanvasReady\.value = false/)
  assert.match(appSource, /if \(previewDomEdgeCanvasActive\.value\) syncPreviewEdgeCanvasBounds\(\)/)
  assert.match(miniMapSource, /viewBox: task\.frame\.viewBox \? \{ \.\.\.task\.frame\.viewBox \} : null,[\s\S]*?renderPlanKey: task\.frame\.renderPlanKey/)
  assert.match(miniMapSource, /pixelRatioX: task\.frame\.pixelRatioX,[\s\S]*?pixelRatioY: task\.frame\.pixelRatioY/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-edge-canvas\s*\{[^}]*display:\s*none/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-edge-canvas\.is-visible\s*\{[^}]*display:\s*block/)
})

test('full-stage fallback mounts only after a sharp viewport is presented or immediately after its failure', () => {
  const fallbackSource = sourceBetween(
    appSource,
    'function previewFitFallbackCanMount',
    'async function ensurePreviewFitCanvas'
  )
  const showPreview = { value: true }
  const previewFallbackRequired = { value: true }
  const previewFitMounted = { value: false }
  const previewPresentationReady = { value: false }
  const previewEdgeCanvasVisible = { value: false }
  const ensureCalls = []
  let scheduledCallback = null
  let scheduleCount = 0
  let cancelCount = 0
  const previewFitFallbackIdleTask = {
    pending: false,
    schedule(callback) {
      scheduleCount += 1
      scheduledCallback = callback
      this.pending = true
      return true
    },
    cancel() {
      cancelCount += 1
      scheduledCallback = null
      this.pending = false
    }
  }
  const harness = new Function(
    'showPreview',
    'previewFallbackRequired',
    'previewFitMounted',
    'previewPresentationReady',
    'previewEdgeCanvasVisible',
    'previewFitFallbackIdleTask',
    'ensurePreviewFitCanvas',
    `${fallbackSource}\nreturn { schedulePreviewFitCanvasFallback, startPreviewFitCanvasFallback }`
  )(
    showPreview,
    previewFallbackRequired,
    previewFitMounted,
    previewPresentationReady,
    previewEdgeCanvasVisible,
    previewFitFallbackIdleTask,
    options => ensureCalls.push(options)
  )

  assert.equal(harness.schedulePreviewFitCanvasFallback(), false)
  assert.equal(scheduleCount, 0)
  assert.deepEqual(ensureCalls, [])

  previewPresentationReady.value = true
  previewEdgeCanvasVisible.value = true
  assert.equal(harness.schedulePreviewFitCanvasFallback(), true)
  assert.equal(harness.schedulePreviewFitCanvasFallback(), true)
  assert.equal(scheduleCount, 1, 'an accepted viewport must queue only one idle fallback')
  assert.deepEqual(ensureCalls, [], 'queueing the fallback must not mount it in the presentation task')
  previewFitFallbackIdleTask.pending = false
  scheduledCallback()
  assert.deepEqual(ensureCalls, [{ target: false }])

  ensureCalls.length = 0
  previewFitMounted.value = false
  assert.equal(harness.startPreviewFitCanvasFallback(), true)
  assert.equal(cancelCount, 1)
  assert.deepEqual(ensureCalls, [{ target: false }], 'a failed viewport must start its fallback immediately')
})

test('fallback geometry mounts complete viewport sources in bounded animation-frame batches', () => {
  const domEdges = sourceBetween(appSource, 'const previewDomEdges', 'const editorLodEdgeEntries')
  const domDrawings = sourceBetween(appSource, 'const previewDomDrawings', 'const previewLivePlaneDrawingEntries')
  const previewTemplate = sourceBetween(appSource, '<div v-if="showPreview"', '<Teleport v-if="buttonMessageDialog.show"')

  assert.doesNotMatch(domEdges, /\.map\(/)
  assert.doesNotMatch(domDrawings, /\.map\(/)
  assert.match(previewTemplate, /<ProgressivePreviewGeometry/)
  assert.doesNotMatch(previewTemplate, /v-for="entry in previewVisible(?:Edge|Drawing)Entries"/)
  assert.match(progressiveGeometrySource, /edgeBatchSize:\s*\{ type: Number, default: 64 \}/)
  assert.match(progressiveGeometrySource, /drawingBatchSize:\s*\{ type: Number, default: 8 \}/)
  assert.match(progressiveGeometrySource, /appendNextBatch\(\)[\s\S]*?scheduleRenderFrame\(revealNextBatch\)/)
  assert.match(progressiveGeometrySource, /visibleEdgeCount < sourceEdges\.length \|\| visibleDrawingCount < sourceDrawings\.length/)
  assert.match(progressiveGeometrySource, /emit\('render-complete',[\s\S]*?edgeCount: sourceEdges\.length,[\s\S]*?drawingCount: sourceDrawings\.length/)
  assert.match(edgeBatchSource, /props\.edges\.map\(edge/)
  assert.match(drawingBatchSource, /props\.drawings\.map\(props\.entryFactory\)/)
})

test('keeps the accepted original-size edge frame mounted during fit handoff', () => {
  const handoffWatch = sourceBetween(
    appSource,
    'watch(previewDomEdgeCanvasRequested, requested => {',
    'watch(previewLivePlaneKey'
  )
  assert.match(handoffWatch, /showPreview\.value && previewRenderTarget\.value === 'fit' && previewEdgeCanvasBounds\.value/)
  assert.ok(
    handoffWatch.indexOf("previewRenderTarget.value === 'fit'")
      < handoffWatch.indexOf('resetPreviewEdgeCanvas({ clearFailure: true })')
  )
})

test('progressive preview completion is generation-scoped and reports only a fully mounted source', () => {
  const settle = sourceBetween(progressiveSource, 'const settleVisibleBatches', 'const appendPendingBatch')
  const append = sourceBetween(progressiveSource, 'const appendPendingBatch', 'if (!props.progressive)')

  assert.match(progressiveSource, /generation:\s*\{\s*type:\s*Number/)
  assert.match(progressiveSource, /defineEmits\(\[[^\]]*'render-complete'/)
  assert.match(progressiveSource, /emit\('render-complete',\s*\{\s*generation:[^,}]+,\s*count:\s*source\.length\s*\}\)/)
  assert.match(progressiveSource, /if \(generation !== renderGeneration\) return/)
  assert.match(progressiveSource, /if \(visibleCount\.value < source\.length\) return[\s\S]*?emit\('render-complete'/)
  assert.match(progressiveSource, /watch\(\[[^\]]*\(\) => props\.generation/)

  assert.match(progressiveSource, /const visibleBatches = shallowRef\(\[\]\)/)
  assert.match(progressiveSource, /partitionRetainedPreviewNodeBatches\(source, visibleBatches\.value\)/)
  assert.match(progressiveSource, /\{ retainedIds, retainedBatches, pendingNodes \} = partitionRetainedPreviewNodeBatches/)
  assert.match(progressiveSource, /visibleBatches\.value = retainedBatches/)
  assert.match(append, /visibleBatches\.value = \[[\s\S]*?\.\.\.visibleBatches\.value,[\s\S]*?items: pendingNodes\.slice\(pendingCount, nextCount\)/)
  assert.doesNotMatch(append, /visibleNodes\.value\.push|triggerRef\(visibleNodes\)/)
  assert.match(settle, /reportRenderComplete\(generation, source, sourceGeneration\)/)
  assert.match(progressiveSource, /v-for="batch in visibleBatches"[\s\S]*?:nodes="batch\.items"/)

  // Empty viewports must also finish; otherwise the Canvas loading frame could remain forever.
  assert.match(progressiveSource, /source\.length\s*===\s*0[\s\S]*?render-complete|render-complete[\s\S]*?source\.length\s*===\s*0/)
})

test('preview policy classifies only supported visual animations for Canvas', () => {
  const { STATIC_CANVAS, ANIMATED_CANVAS, LIVE_DOM } = PREVIEW_RENDER_CAPABILITIES
  assert.deepEqual(PREVIEW_RENDER_CAPABILITIES, {
    STATIC_CANVAS: 'static-canvas',
    ANIMATED_CANVAS: 'animated-canvas',
    LIVE_DOM: 'live-dom'
  })

  for (const node of [
    null,
    { type: 'rect' },
    { type: 'rect', animation: 'none' },
    { type: 'rect', animation: 'flow' },
    { type: 'flowPipe', animation: 'none' },
    { type: 'flowPipe', animation: 'blink' },
    { type: 'rotatingFan', animation: 'pulse' },
    { type: 'signalLight', animation: 'flow' },
    { type: 'waterTank', animation: 'pulse' },
    { type: 'heartbeat', animation: 'flow' },
    { type: 'particles', animation: 'float' },
    { type: 'image', imageUrl: 'status.png' }
  ]) assert.equal(previewNodeRenderCapability(node), STATIC_CANVAS)

  for (const node of [
    { type: 'flowPipe', animation: 'flow' },
    { type: 'rotatingFan', animation: 'flow', animationPaused: true },
    { type: 'signalLight', animation: 'blink' },
    { type: 'waterTank', animation: 'flow' },
    { type: 'heartbeat', animation: 'pulse' },
    { type: 'particles', animation: 'flow' }
  ]) {
    assert.equal(previewNodeRenderCapability(node), ANIMATED_CANVAS, `expected ${node.type} to animate on Canvas`)
    assert.equal(previewNodeNeedsLiveDom(node), false)
  }

  for (const node of [
    { type: 'flowPipe', animation: 'flow', progressFluctuationEnabled: true },
    { type: 'video' },
    { type: 'time' },
    { type: 'input' },
    { type: 'table' },
    { type: 'customTextMotion', animation: 'none' },
    { type: 'image', imageUrl: 'status.GIF?revision=2' },
    { type: 'image', imageUrl: 'data:image/webp;base64,animated' }
  ]) {
    assert.equal(previewNodeRenderCapability(node), LIVE_DOM, `expected ${node.type} to use live DOM`)
    assert.equal(previewNodeNeedsLiveDom(node), true)
  }
})

test('preview policy keeps a bounded DOM tail above the lowest live visual', () => {
  assert.equal(previewNodeNeedsLiveDom({ type: 'rect', animation: 'none' }), false)
  for (const node of [
    { type: 'video' },
    { type: 'time' },
    { type: 'input' },
    { type: 'table' },
    { type: 'customTextMotion', animation: 'none' },
    { type: 'progress', progressFluctuationEnabled: true },
    { type: 'image', imageUrl: 'status.GIF?revision=2' },
    { type: 'image', imageUrl: 'data:image/webp;base64,animated' }
  ]) assert.equal(previewNodeNeedsLiveDom(node), true, `expected ${node.type} to use live DOM`)
  assert.equal(previewNodeNeedsLiveDom({ type: 'rect', animation: 'pulse' }), false)

  const safe = [
    { kind: 'node', id: 'static', layer: 1 },
    { kind: 'drawing', id: 'drawing', layer: 2 },
    { kind: 'node', id: 'video', layer: 3 },
    { kind: 'node', id: 'form', layer: 4 }
  ]
  const boundedTail = previewHybridLayerTail([
    ...safe,
    { kind: 'drawing', id: 'tail-drawing', layer: 5 },
    { kind: 'node', id: 'tail-static', layer: 6, entity: { id: 'tail-static', type: 'rect' } }
  ], ['video', 'form'])
  assert.equal(boundedTail.safe, true)
  assert.deepEqual(boundedTail.entries.map(entry => entry.id), ['video', 'form', 'tail-drawing', 'tail-static'])
  assert.equal(previewHybridLayerTail(safe, ['missing']).safe, false)
  assert.equal(previewHybridLayerTail([
    { kind: 'node', id: 'live', layer: 1 },
    ...Array.from({ length: PREVIEW_HYBRID_MAX_DOM_ENTRIES }, (_, index) => ({ kind: 'node', id: `static-${index}`, layer: index + 2 }))
  ], ['live']).safe, false)

  let indexedReads = 0
  const largeEntries = new Proxy(Array.from({ length: 10000 }, (_, index) => ({ kind: 'node', id: `node-${index}` })), {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) indexedReads += 1
      return Reflect.get(target, key, receiver)
    }
  })
  assert.equal(previewHybridLayerTail(largeEntries, ['node-9997']).safe, true)
  assert.equal(indexedReads, 3)

  assert.equal(previewHybridDomSafe(Array(PREVIEW_HYBRID_MAX_DOM_NODES).fill({ type: 'input' })), true)
  assert.equal(previewHybridDomSafe(Array(PREVIEW_HYBRID_MAX_DOM_NODES + 1).fill({ type: 'input' })), false)
  assert.equal(previewHybridDomSafe([{ type: 'table', tableRows: 50, tableColumns: 12 }]), false)
  assert.equal(previewHybridDomSafe(Array(4).fill({ type: 'video' })), true)
  assert.equal(previewHybridDomSafe(Array(5).fill({ type: 'video' })), false)
  assert.equal(previewHybridTailDomSafe([
    { kind: 'node', entity: { type: 'input' } },
    { kind: 'drawing', entity: { id: 'drawing' } }
  ]), true)
  assert.equal(PREVIEW_HYBRID_MAX_DOM_COST, 128)
})

test('ECharts prefer live SVG but may fall back to Canvas without forcing a full-document DOM preview', () => {
  const chartTypes = ['chart', 'lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart', 'echartsCode']
  for (const type of chartTypes) {
    const node = { id: type, type }
    assert.equal(previewNodeNeedsLiveDom(node), true, `${type} should prefer the real ECharts renderer`)
    assert.equal(previewNodeCanUseCanvasFallback(node), true, `${type} should support the bounded Canvas fallback`)
  }
  for (const type of ['video', 'input', 'table', 'customTextMotion']) {
    assert.equal(previewNodeCanUseCanvasFallback({ type }), false, `${type} must remain live DOM`)
  }

  const lowChart = { id: 'low-chart', type: 'lineChart' }
  const lowChartEntries = [
    { kind: 'node', id: lowChart.id, entity: lowChart },
    ...Array.from({ length: PREVIEW_HYBRID_MAX_DOM_ENTRIES + 4 }, (_, index) => {
      const entity = { id: `static-${index}`, type: 'rect' }
      return { kind: 'node', id: entity.id, entity }
    })
  ]
  const lowChartPlan = buildPreviewHybridPlan(lowChartEntries, lowChartEntries.map(entry => entry.entity))
  assert.equal(lowChartPlan.canUseCanvas, true)
  assert.equal(lowChartPlan.preservesAllLiveDom, false)
  assert.deepEqual(lowChartPlan.overlayEntries, [])
  assert.deepEqual(lowChartPlan.canvasFallbackNodeIds, [lowChart.id])

  const largeNodes = Array.from({ length: 5980 }, (_, index) => ({ id: `base-${index}`, type: 'rect' }))
  const charts = Array.from({ length: 20 }, (_, index) => ({ id: `chart-${index}`, type: 'barChart' }))
  const largeEntries = [...largeNodes, ...charts].map(entity => ({ kind: 'node', id: entity.id, entity }))
  const largePlan = buildPreviewHybridPlan(largeEntries, [...largeNodes, ...charts])
  assert.equal(largePlan.canUseCanvas, true)
  assert.equal(largePlan.preservesAllLiveDom, false)
  assert.equal(largePlan.overlayEntries.length, PREVIEW_HYBRID_MAX_DOM_NODES)
  assert.deepEqual(largePlan.canvasFallbackNodeIds, charts.slice(0, 4).map(node => node.id))

  const fitPlanSource = sourceBetween(appSource, 'const previewFitPlan', 'const previewFitOverlayNodes')
  const viewportPlanSource = sourceBetween(appSource, 'const previewViewportCanvasPlanned', 'const previewFallbackRequired')
  assert.match(fitPlanSource, /buildPreviewHybridPlan\(layerEntries\.value, nodes\.value\)/)
  assert.match(fitPlanSource, /canUseCanvas:\s*hybridPlan\.canUseCanvas/)
  assert.match(fitPlanSource, /preservesAllLiveDom:\s*hybridPlan\.preservesAllLiveDom/)
  assert.match(viewportPlanSource, /previewFitPlan\.value\.preservesAllLiveDom/)
})

test('hybrid chart fallback never weakens mandatory live DOM layering', () => {
  const video = { id: 'video', type: 'video' }
  const coveredVideoEntries = [
    { kind: 'node', id: video.id, entity: video },
    ...Array.from({ length: PREVIEW_HYBRID_MAX_DOM_ENTRIES }, (_, index) => {
      const entity = { id: `cover-${index}`, type: index === 0 ? 'pieChart' : 'rect' }
      return { kind: 'node', id: entity.id, entity }
    })
  ]
  const unsafePlan = buildPreviewHybridPlan(coveredVideoEntries, coveredVideoEntries.map(entry => entry.entity))
  assert.equal(unsafePlan.canUseCanvas, false)
  assert.equal(unsafePlan.layerSafe, false)

  const chart = { id: 'chart-below-video', type: 'radarChart' }
  const safeEntries = [
    { kind: 'node', id: chart.id, entity: chart },
    { kind: 'node', id: video.id, entity: video },
    { kind: 'node', id: 'top', entity: { id: 'top', type: 'rect' } }
  ]
  const safePlan = buildPreviewHybridPlan(safeEntries, safeEntries.map(entry => entry.entity))
  assert.equal(safePlan.canUseCanvas, true)
  assert.deepEqual(safePlan.canvasFallbackNodeIds, [])
  assert.equal(safePlan.preservesAllLiveDom, true)
})

test('Canvas and controlled live DOM overlay retain a complete fallback between DOM generations', () => {
  const canvasVisibility = sourceBetween(appSource, 'const previewCanvasVisible', 'const previewRenderScale')
  const canvasActive = sourceBetween(appSource, 'const previewCanvasRenderActive', 'const previewFitBitmapPixelBudget')
  const previewCanvasTag = openingTag(appSource, '<MiniMapPreview v-if="previewFitMounted"')
  const previewStageTag = openingTagContaining(appSource, 'data-testid="preview-dom-stage"')
  const liveStageTag = openingTagContaining(appSource, 'data-testid="preview-live-plane"')
  const geometryTag = openingTag(appSource, '<ProgressivePreviewGeometry')
  const progressiveTag = openingTag(appSource, '<ProgressivePreviewNodes :nodes="previewDomNodes"')
  const liveProgressiveTag = openingTag(appSource, '<ProgressivePreviewNodes :nodes="previewLivePlaneNodes"')
  const resetDomReady = sourceBetween(appSource, 'function resetPreviewDomReadyState', 'function resetPreviewDomHandoff')
  const finishDom = sourceBetween(appSource, 'function finishPreviewDomHandoff', 'function handlePreviewDomRenderComplete')
  const domComplete = sourceBetween(appSource, 'function handlePreviewDomRenderComplete', 'function handlePreviewGeometryRenderComplete')
  const geometryComplete = sourceBetween(appSource, 'function handlePreviewGeometryRenderComplete', 'function handlePreviewLivePlaneRenderComplete')
  const liveComplete = sourceBetween(appSource, 'function handlePreviewLivePlaneRenderComplete', 'function invalidatePreviewViewportSchedule')
  const fitComplete = sourceBetween(appSource, 'function handlePreviewFitRenderComplete', 'function handlePreviewFitRenderError')
  const fitError = sourceBetween(appSource, 'function handlePreviewFitRenderError', 'function rememberPreviewScroll')
  const showFit = sourceBetween(appSource, 'function showPreviewFitFrame', 'function handlePreviewFitRenderComplete')
  const releaseFit = sourceBetween(appSource, 'function releasePreviewFitCanvas', 'function handlePreviewDomRenderComplete')
  const resetFit = sourceBetween(appSource, 'function resetPreviewFitCanvasState', 'function previewFitRenderPlanMatches')
  const presentPreview = sourceBetween(appSource, 'function presentPreparedPreview', 'function finishPreviewDomHandoff')
  const fullDocumentRequest = sourceBetween(appSource, 'const previewDomFullDocumentRequested', 'const previewDomNodes')
  const fullDocumentWatch = sourceBetween(appSource, 'watch(previewDomFullDocumentRequested', 'watch(previewDomEdgeCanvasRequested')
  const fallbackScheduler = sourceBetween(appSource, 'function previewFitFallbackCanMount', 'async function ensurePreviewFitCanvas')
  const openPreview = sourceBetween(appSource, 'async function openPreview', 'watch([stageWidth, stageHeight, previewAutoFit]')
  const fallbackWatch = sourceBetween(appSource, 'watch([previewFallbackRequired, previewViewportCanvasPlanned]', 'watch([previewFitExcludedNodeIds, previewFitExcludedDrawingIds]')

  assert.match(appSource, /const previewDomGeneration = ref\(/)
  assert.match(appSource, /const previewDomNodesReady = ref\(false\)/)
  assert.match(appSource, /const previewDomGeometryReady = ref\(false\)/)
  assert.match(appSource, /const previewDomReady = computed\(\(\) => previewDomNodesReady\.value && previewDomGeometryReady\.value\)/)
  assert.doesNotMatch(appSource, /previewDomReady\.value\s*=/)
  assert.match(appSource, /const previewDomMounted = ref\(/)
  assert.match(appSource, /const previewLivePlaneReady = ref\(/)
  assert.match(appSource, /const previewRenderTarget = ref\(['"]dom['"]\)/)
  assert.match(appSource, /const previewLivePlaneUsesCommittedPlan = computed\([\s\S]*?previewFitVisible\.value[\s\S]*?previewFitCommittedPlanKey\.value === previewFitPlan\.value\.key/)
  assert.match(appSource, /const previewLivePlaneNodes = computed\([\s\S]*?previewFitCommittedOverlayNodes\.value[\s\S]*?previewFitOverlayNodes\.value/)
  assert.match(appSource, /const previewCanvasRenderActive = computed\(/)
  assert.match(canvasActive, /previewCanvasVisible\.value/, 'the currently visible fit fallback must keep its animation clock active')
  assert.match(appSource, /const previewViewportCanvasPlanned = computed\(\(\) => \([\s\S]*?previewRenderTarget\.value === 'dom'[\s\S]*?!previewFitLayoutRequested\.value[\s\S]*?previewFitPlan\.value\.canUseCanvas[\s\S]*?\)\)/)
  assert.match(appSource, /const previewFitInitialRenderUrgent = computed\(\(\) => \([\s\S]*?previewFallbackRequired\.value[\s\S]*?!previewFitFrameAvailable\.value[\s\S]*?!previewPresentationReady\.value[\s\S]*?!previewViewportCanvasPlanned\.value[\s\S]*?previewEdgeCanvasFailed\.value[\s\S]*?\)\)/)
  assert.match(appSource, /const previewFitRenderMode = computed\(\(\) => \(previewFitActive\.value \|\| previewFitInitialRenderUrgent\.value\) \? 'task' : 'idle'\)/)
  assert.match(appSource, /const previewFitRenderBudgetMs = computed\(\(\) => previewFitRenderMode\.value === 'task' \? 4 : 2\)/)
  assert.match(canvasVisibility, /previewFitVisible\.value/)
  assert.match(canvasVisibility, /previewViewportTransitioning\.value[\s\S]*?\|\| !previewDomReady\.value[\s\S]*?previewDomEdgeCanvasActive\.value && !previewEdgeCanvasVisible\.value/)
  assert.match(canvasVisibility, /!previewViewportTransitioning\.value && previewDomReady\.value/)
  assert.match(canvasVisibility, /previewFitFrameAvailable\.value/)
  assert.doesNotMatch(canvasVisibility, /!previewDomReady\.value[\s\S]*?previewFitFrameFresh\.value/)
  assert.doesNotMatch(canvasVisibility, /previewDomLimited\.value\s*&&\s*previewFitFrameAvailable\.value/)
  assert.match(previewCanvasTag, /:class="\{ 'is-visible': previewCanvasVisible \}"/)
  assert.match(previewCanvasTag, /:excluded-node-ids="previewFitExcludedNodeIds"/)
  assert.match(previewCanvasTag, /:excluded-drawing-ids="previewFitExcludedDrawingIds"/)
  assert.match(previewCanvasTag, /:render-plan-key="previewFitPlan\.key"/)
  assert.match(previewCanvasTag, /:render-mode="previewFitRenderMode"/)
  assert.match(previewCanvasTag, /:render-budget-ms="previewFitRenderBudgetMs"/)
  assert.match(previewCanvasTag, /@render-error="handlePreviewFitRenderError"/)
  assert.match(previewStageTag, /\bv-if="previewDomMounted"/)
  assert.match(previewStageTag, /data-testid="preview-dom-stage"/)
  assert.match(previewStageTag, /:data-preview-ready="previewDomReady"/)
  assert.match(previewStageTag, /'is-hidden':\s*(?:previewCanvasVisible|!previewDomVisible)/)
  assert.match(previewStageTag, /:aria-hidden="!previewDomVisible"/)
  assert.match(previewStageTag, /:inert="!previewDomVisible"/)
  assert.doesNotMatch(previewStageTag, /v-show=/)
  assert.match(liveStageTag, /v-if="previewLivePlaneActive"/)
  assert.match(liveStageTag, /class="preview-stage is-live-plane"/)

  assert.match(progressiveTag, /:generation="previewDomGeneration"/)
  assert.match(progressiveTag, /:nodes="previewDomNodes"/)
  assert.match(progressiveTag, /@render-start="handlePreviewDomRenderStart"/)
  assert.match(progressiveTag, /@render-complete="handlePreviewDomRenderComplete"/)
  assert.match(geometryTag, /:generation="previewDomGeneration"/)
  assert.match(geometryTag, /:edges="previewDomEdges"/)
  assert.match(geometryTag, /:drawings="previewDomDrawings"/)
  assert.match(geometryTag, /@render-start="handlePreviewGeometryRenderStart"/)
  assert.match(geometryTag, /@render-complete="handlePreviewGeometryRenderComplete"/)
  assert.match(liveProgressiveTag, /:generation="previewLivePlaneGeneration"/)
  assert.match(liveProgressiveTag, /:batch-size="PREVIEW_HYBRID_MAX_DOM_NODES"/)
  assert.match(liveProgressiveTag, /:mount-cost-budget="PREVIEW_HYBRID_MAX_DOM_COST"/)
  assert.match(domComplete, /generation[^\n]*previewDomGeneration\.value[\s\S]*?count[^\n]*previewDomNodes\.value\.length/)
  assert.match(domComplete, /await nextTick\(\)[\s\S]*?previewDomStage\.value\?\.querySelectorAll\('\.preview-node'\)\.length[\s\S]*?mountedCount !== event\.count/)
  assert.match(domComplete, /previewDomNodesReady\.value = true[\s\S]*?finishPreviewDomHandoff\(\)/)
  assert.match(geometryComplete, /edgeCount[^\n]*previewDomEdges\.value\.length[\s\S]*?drawingCount[^\n]*previewDomDrawings\.value\.length/)
  assert.match(geometryComplete, /previewDomGeometryReady\.value = true[\s\S]*?finishPreviewDomHandoff\(\)/)
  assert.match(resetDomReady, /previewDomNodesReady\.value = false[\s\S]*?previewDomGeometryReady\.value = false/)
  assert.match(finishDom, /!showPreview\.value[\s\S]*?!previewDomMounted\.value[\s\S]*?!previewDomReady\.value[\s\S]*?previewRenderTarget\.value !== 'dom'/)
  assert.match(finishDom, /previewFallbackRequired\.value[\s\S]*?!previewDomFullDocumentRequested\.value[\s\S]*?!previewFitFrameAvailable\.value[\s\S]*?!previewEdgeCanvasVisible\.value[\s\S]*?return/)
  assert.match(finishDom, /previewDisplayMode\.value = previewFitLayoutRequested\.value \? 'dom-fit' : 'dom'[\s\S]*?presentPreparedPreview\(\)[\s\S]*?releasePreviewFitCanvas\(\)/)
  assert.match(finishDom, /presentPreparedPreview\(\)[\s\S]*?previewEdgeCanvasVisible\.value[\s\S]*?schedulePreviewFitCanvasFallback\(\)/)
  assert.match(presentPreview, /if \(previewPresentationReady\.value\) return[\s\S]*?pauseEditorLodRendering\(\)[\s\S]*?clearEditorProgressiveDomMount\(\)[\s\S]*?previewPresentationReady\.value = true/)
  assert.match(liveComplete, /generation[^\n]*previewLivePlaneGeneration\.value[\s\S]*?count[^\n]*previewLivePlaneNodes\.value\.length/)
  assert.match(liveComplete, /await nextTick\(\)[\s\S]*?previewLivePlaneStage\.value\?\.querySelectorAll\('\.preview-node'\)\.length[\s\S]*?mountedCount !== event\.count/)
  assert.match(liveComplete, /previewLivePlaneReady\.value = true/)
  assert.match(releaseFit, /previewFallbackRequired\.value[\s\S]*?resetPreviewFitCanvasState\(\{ clearFailure: false \}\)/)
  assert.doesNotMatch(releaseFit, /runtimeCanvasRenderFrame|runtimeCanvasDirtyQueue/)
  assert.match(resetFit, /previewFitMounted\.value\s*=\s*false/)
  assert.match(resetFit, /previewFitCanvasReady\.value\s*=\s*false[\s\S]*?previewFitFrameAvailable\.value\s*=\s*false/)
  assert.match(fitComplete, /previewFrameFreshness\.handleRenderComplete\(event\)/)
  assert.match(fitComplete, /previewFitRenderPlanMatches\(event\)[\s\S]*?previewFrameFreshness\.handleRenderComplete\(event\)[\s\S]*?commitPreviewFitRenderPlan\(\)[\s\S]*?showPreviewFitFrame\(\)/)
  assert.match(fitComplete, /previewFitFrameAvailable\.value = true[\s\S]*?previewRenderTarget\.value === 'dom'\) finishPreviewDomHandoff\(\)/)
  assert.match(fitError, /retainsCommittedFrame[\s\S]*?previewFitCanvasFailed\.value = false[\s\S]*?requestPreviewFitDocumentRender\(\)[\s\S]*?previewFitFrameAvailable\.value = false[\s\S]*?previewFitCanvasFailed\.value = true/)
  assert.match(fitError, /resetPreviewDomHandoff\(\)[\s\S]*?previewDisplayMode\.value = 'dom'[\s\S]*?previewPresentationReady\.value = false/)
  assert.match(showFit, /!previewFitCanUseCanvas\.value[\s\S]*?resetPreviewDomHandoff\(\)/)
  assert.match(showFit, /previewFitCommittedPlanKey\.value !== previewFitPlan\.value\.key/)
  assert.match(showFit, /previewFitCommittedUsesDomOverlay\.value && !previewLivePlaneReady\.value\) return false/)
  assert.match(showFit, /previewDisplayMode\.value\s*=\s*['"]fit['"][\s\S]*?previewDomMounted\.value\s*=\s*false/)
  assert.match(showFit, /presentPreparedPreview\(\)/)
  assert.match(fullDocumentRequest, /previewFitCanvasFailed\.value/)
  assert.match(fullDocumentWatch, /if \(requested\) resetPreviewDomQueryBounds\(\)[\s\S]*?previewDomGeneration\.value \+= 1[\s\S]*?resetPreviewDomReadyState\(\)/)
  assert.match(fallbackScheduler, /previewPresentationReady\.value[\s\S]*?previewEdgeCanvasVisible\.value[\s\S]*?previewFitFallbackIdleTask\.schedule/)
  assert.match(fallbackScheduler, /previewFitFallbackIdleTask\.pending[\s\S]*?return true/)
  assert.match(fallbackScheduler, /function startPreviewFitCanvasFallback\(\)[\s\S]*?previewFitFallbackIdleTask\.cancel\(\)[\s\S]*?ensurePreviewFitCanvas\(\{ target: false \}\)/)
  assert.match(openPreview, /previewFallbackRequired\.value && !previewViewportCanvasPlanned\.value[\s\S]*?ensurePreviewFitCanvas\(\{ target: false \}\)/)
  assert.doesNotMatch(openPreview, /else if \(previewFallbackRequired\.value\) await ensurePreviewFitCanvas/)
  assert.match(fallbackWatch, /if \(!required\)[\s\S]*?previewFitFallbackIdleTask\.cancel\(\)[\s\S]*?if \(!showPreview\.value \|\| viewportCanvasPlanned\) return[\s\S]*?startPreviewFitCanvasFallback\(\)/)

  assert.match(miniMapSource, /excludedNodeIds:\s*\{\s*type:\s*Array/)
  assert.match(miniMapSource, /excludedDrawingIds:\s*\{\s*type:\s*Array/)
  assert.match(miniMapSource, /renderPlanKey:\s*\{\s*type:\s*String/)
  assert.match(miniMapSource, /excludedNodeIds:\s*props\.excludedNodeIds/)
  assert.match(miniMapSource, /const excludedNodeIds = new Set\(payload\.excludedNodeIds \|\| \[\]\)/)
  assert.match(miniMapSource, /if \(task\.renderNodes && !task\.excludedNodeIds\.has\(entity\?\.id\)\) task\.entities\.push/)
  assert.match(miniMapSource, /task\.excludedNodeIds\.has\(item\.entity\.id\)[\s\S]*?continue/)
  assert.match(miniMapSource, /committedExcludedNodeIds = task\.excludedNodeIds/)
  assert.match(miniMapSource, /committedExcludedDrawingIds = task\.excludedDrawingIds/)
  assert.match(miniMapSource, /renderPlanKey:\s*task\.renderPlanKey[\s\S]*?excludedNodeIds:\s*\[\.\.\.task\.excludedNodeIds\][\s\S]*?excludedDrawingIds:\s*\[\.\.\.task\.excludedDrawingIds\]/)
  assert.match(miniMapSource, /committedExcludedNodeIds\.has\(key\)/)
  assert.match(miniMapSource, /task\.renderNodes && !task\.excludedNodeIds\.has\(item\.entity\.id\)[\s\S]*?drawEntityIncrementally/)
  assert.match(miniMapSource, /\(\) => props\.excludedNodeIds/)

  // Inactive surfaces leave the layout and compositor instead of remaining as hidden layers.
  assert.match(styleSource, /\.preview-stage\.is-hidden\s*\{[^}]*display:\s*none[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage\.is-live-plane\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage\.is-live-plane \.node-shell\s*\{[^}]*pointer-events:\s*auto/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-fit-canvas\s*\{[^}]*display:\s*none[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-fit-canvas\.is-visible\s*\{[^}]*display:\s*block/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-edge-canvas\s*\{[^}]*display:\s*none[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-edge-canvas\.is-visible\s*\{[^}]*display:\s*block/)
  assert.doesNotMatch(styleSource, /\.preview-overlay\.is-preparing\s*\{[^}]*opacity:/)
  assert.match(styleSource, /\.preview-overlay\.is-preparing \.preview-stage-space\s*\{[^}]*visibility:\s*hidden/)
})

test('preview readiness uses the committed DOM count and the presentation switch is atomic', async () => {
  const domCompleteSource = sourceBetween(
    appSource,
    'async function handlePreviewDomRenderComplete',
    'function handlePreviewGeometryRenderComplete'
  )
  const presentSource = sourceBetween(
    appSource,
    'function presentPreparedPreview',
    'function finishPreviewDomHandoff'
  )

  const previewDomGeneration = { value: 7 }
  const previewDomNodes = { value: [{ id: 1 }, { id: 2 }, { id: 3 }] }
  const previewDomNodesReady = { value: false }
  let mountedCount = 2
  let handoffCount = 0
  const previewDomStage = {
    value: {
      querySelectorAll(selector) {
        assert.equal(selector, '.preview-node')
        return { length: mountedCount }
      }
    }
  }
  const createDomComplete = new Function(
    'previewDomGeneration',
    'previewDomNodes',
    'nextTick',
    'previewDomStage',
    'previewMediaReadinessGate',
    'previewDomNodesReady',
    'finishPreviewDomHandoff',
    `${domCompleteSource}\nreturn handlePreviewDomRenderComplete`
  )
  const handleDomComplete = createDomComplete(
    previewDomGeneration,
    previewDomNodes,
    () => Promise.resolve(),
    previewDomStage,
    { wait: () => Promise.resolve(true) },
    previewDomNodesReady,
    () => { handoffCount += 1 }
  )

  await handleDomComplete({ generation: 7, count: 3 })
  assert.equal(previewDomNodesReady.value, false, 'render-complete must not publish readiness while a DOM node is still missing')
  assert.equal(handoffCount, 0)

  mountedCount = 3
  await handleDomComplete({ generation: 7, count: 3 })
  assert.equal(previewDomNodesReady.value, true)
  assert.equal(handoffCount, 1)

  const presentationEvents = []
  let ready = false
  const previewPresentationReady = {
    get value() { return ready },
    set value(value) {
      ready = value
      presentationEvents.push(`ready:${value}`)
    }
  }
  const createPresenter = new Function(
    'previewPresentationReady',
    'pauseEditorLodRendering',
    'clearEditorProgressiveDomMount',
    'resumeWorkspaceSessionPersistenceAfterPreview',
    `${presentSource}\nreturn presentPreparedPreview`
  )
  const presentPreparedPreview = createPresenter(
    previewPresentationReady,
    () => presentationEvents.push('pause-editor'),
    () => presentationEvents.push('clear-editor-dom'),
    () => presentationEvents.push('resume-persistence')
  )

  presentPreparedPreview()
  presentPreparedPreview()
  assert.deepEqual(presentationEvents, ['pause-editor', 'clear-editor-dom', 'ready:true', 'resume-persistence'])
})

test('live preview plane revokes readiness before mounting a replacement generation', () => {
  const startSource = sourceBetween(
    appSource,
    'function handlePreviewLivePlaneRenderStart',
    'async function handlePreviewLivePlaneRenderComplete'
  )
  const createHandler = new Function(
    'previewLivePlaneGeneration',
    'previewMediaReadinessGate',
    'previewLivePlaneStage',
    'previewLivePlaneReady',
    `${startSource}\nreturn handlePreviewLivePlaneRenderStart`
  )
  let cancellations = 0
  const ready = { value: true }
  const handler = createHandler(
    { value: 7 },
    { cancel: () => { cancellations += 1 } },
    { value: { id: 'live-stage' } },
    ready
  )

  handler({ generation: 6 })
  assert.equal(cancellations, 0)
  assert.equal(ready.value, true)

  handler({ generation: 7 })
  assert.equal(cancellations, 1)
  assert.equal(ready.value, false)
  const liveProgressiveTag = openingTag(appSource, '<ProgressivePreviewNodes :nodes="previewLivePlaneNodes"')
  assert.match(liveProgressiveTag, /@render-start="handlePreviewLivePlaneRenderStart"/)
})

test('scroll and Canvas failures keep a complete presentation until the replacement is ready', () => {
  const updateSource = sourceBetween(appSource, 'function updatePreviewViewport', 'function schedulePreviewViewport')
  const createUpdate = new Function(
    'currentDevicePixelRatio',
    'previewDevicePixelRatio',
    'previewCanvas',
    'previewViewport',
    'previewRenderTarget',
    'previewFitFrameAvailable',
    'previewViewportTransitioning',
    'schedulePreviewViewport',
    `${updateSource}\nreturn updatePreviewViewport`
  )
  const previewViewportTransitioning = { value: false }
  const previewViewport = { value: { left: 0, top: 0, width: 1200, height: 800 } }
  const scheduled = []
  const updatePreviewViewport = createUpdate(
    () => 1,
    { value: 1 },
    { value: null },
    previewViewport,
    { value: 'dom' },
    { value: true },
    previewViewportTransitioning,
    update => scheduled.push({ update, transitioning: previewViewportTransitioning.value })
  )
  const scrollTarget = { scrollLeft: 2800, scrollTop: 900 }
  updatePreviewViewport({ type: 'scroll', currentTarget: scrollTarget })
  assert.equal(previewViewportTransitioning.value, true)
  assert.deepEqual(scheduled, [{
    update: { contentRect: undefined, scroll: undefined, refreshFit: undefined, waitForContentRect: undefined },
    transitioning: true
  }])

  const errorSource = sourceBetween(appSource, 'function handlePreviewFitRenderError', 'function rememberPreviewScroll')
  const createErrorHandler = new Function(
    'previewFitFrameAvailable',
    'previewFitCanvasReady',
    'previewFitCanvasFailed',
    'invalidatePreviewFitDocument',
    'nextTick',
    'showPreview',
    'previewFitMounted',
    'previewFitCanvas',
    'requestPreviewFitDocumentRender',
    'resetPreviewFitPresentation',
    'previewRenderTarget',
    'resetPreviewDomHandoff',
    'previewDisplayMode',
    'previewPresentationReady',
    `${errorSource}\nreturn handlePreviewFitRenderError`
  )
  const frameAvailable = { value: true }
  const canvasReady = { value: true }
  const canvasFailed = { value: false }
  const renderTarget = { value: 'fit' }
  const displayMode = { value: 'fit' }
  const presentationReady = { value: true }
  const calls = { invalidate: 0, retry: 0, resetPresentation: 0, resetDom: 0 }
  const handlePreviewFitRenderError = createErrorHandler(
    frameAvailable,
    canvasReady,
    canvasFailed,
    () => { calls.invalidate += 1 },
    callback => callback(),
    { value: true },
    { value: true },
    { value: { renderState: { pending: false } } },
    () => { calls.retry += 1 },
    () => { calls.resetPresentation += 1 },
    renderTarget,
    () => { calls.resetDom += 1 },
    displayMode,
    presentationReady
  )

  handlePreviewFitRenderError({ preservesVisibleFrame: true })
  assert.equal(frameAvailable.value, true)
  assert.equal(canvasFailed.value, false)
  assert.equal(displayMode.value, 'fit')
  assert.equal(presentationReady.value, true)
  assert.deepEqual(calls, { invalidate: 1, retry: 1, resetPresentation: 0, resetDom: 0 })

  handlePreviewFitRenderError({ reason: 'context-lost', preservesVisibleFrame: false })
  assert.equal(frameAvailable.value, false)
  assert.equal(canvasFailed.value, true)
  assert.equal(displayMode.value, 'dom')
  assert.equal(presentationReady.value, false)
  assert.deepEqual(calls, { invalidate: 2, retry: 1, resetPresentation: 1, resetDom: 1 })
})

test('fit preview presents only one accepted frame geometry and never exposes a low-density bootstrap', () => {
  const fitComplete = sourceBetween(appSource, 'function handlePreviewFitRenderComplete', 'function handlePreviewFitRenderError')
  const fitError = sourceBetween(appSource, 'function handlePreviewFitRenderError', 'function rememberPreviewScroll')
  const releaseFit = sourceBetween(appSource, 'function releasePreviewFitCanvas', 'function handlePreviewDomRenderComplete')
  const resetFit = sourceBetween(appSource, 'function resetPreviewFitCanvasState', 'function previewFitRenderPlanMatches')
  const ensureFit = sourceBetween(appSource, 'async function ensurePreviewFitCanvas', 'function showPreviewFitFrame')
  const showFit = sourceBetween(appSource, 'function showPreviewFitFrame', 'function handlePreviewFitRenderComplete')
  const flushViewport = sourceBetween(appSource, 'function flushPreviewViewport', 'function commitPreviewViewport')
  const closePreview = sourceBetween(appSource, 'async function closePreview', 'async function openPreview')
  const openPreview = sourceBetween(appSource, 'async function openPreview', 'watch([stageWidth, stageHeight, previewAutoFit]')
  const stageSpace = openingTagContaining(appSource, 'class="preview-stage-space"')

  const fresh = fitComplete.indexOf('previewFrameFreshness.handleRenderComplete(event)')
  const commitPlan = fitComplete.indexOf('commitPreviewFitRenderPlan()')
  const commitPresentation = fitComplete.indexOf('commitPreviewFitPresentation(event)')
  const show = fitComplete.indexOf('showPreviewFitFrame()')
  assert.ok(fresh >= 0 && fresh < commitPlan)
  assert.ok(commitPlan < commitPresentation && commitPresentation < show)
  assert.equal((fitComplete.match(/commitPreviewFitPresentation\(event\)/g) || []).length, 1)

  assert.match(appSource, /const previewFitPresentationScale = computed/)
  assert.match(appSource, /const previewFitPresentationOffset = computed/)
  assert.match(stageSpace, /previewFitPresentationOffset\.left/)
  assert.match(stageSpace, /previewFitPresentationOffset\.top/)
  assert.match(flushViewport, /syncPreviewFitCommittedOffset\(target, contentRect\)/)
  assert.match(flushViewport, /previewFittedVisible\.value && previewFitFrameAvailable\.value/)

  assert.match(appSource, /let previewFitEnsureGeneration = 0/)
  assert.doesNotMatch(ensureFit, /copyCommittedFrameTo|bootstrap\s*=/)
  assert.match(ensureFit, /if \(target && !previewFitCanUseCanvas\.value\)[\s\S]*?resetPreviewDomHandoff\(\)[\s\S]*?return false/)
  assert.match(ensureFit, /const ensureGeneration = previewFitEnsureGeneration[\s\S]*?const mountedNow = !previewFitMounted\.value[\s\S]*?await nextTick\(\)/)
  assert.match(ensureFit, /await nextTick\(\)[\s\S]*?if \([\s\S]*?!showPreview\.value[\s\S]*?\|\| !previewFitMounted\.value[\s\S]*?\|\| ensureGeneration !== previewFitEnsureGeneration[\s\S]*?\) return false/)
  assert.match(ensureFit, /const mountedNow = !previewFitMounted\.value[\s\S]*?await nextTick\(\)/)
  assert.match(ensureFit, /!mountedNow && !targetChanged && !previewFitCanvas\.value\?\.renderState\?\.pending/)
  assert.match(fitComplete, /const frameIsSharp = previewBitmapIsSharp\([\s\S]*?!frameIsSharp && previewRenderTarget\.value === 'fit'\)[\s\S]*?handlePreviewFitRenderError\(\)/)
  assert.match(showFit, /!previewFitFrameAvailable\.value \|\| !previewFitFrameFresh\.value/)
  assert.match(showFit, /!previewFitCanUseCanvas\.value[\s\S]*?return false/)
  assert.match(resetFit, /previewFitEnsureGeneration \+= 1[\s\S]*?previewFitFallbackIdleTask\.cancel\(\)[\s\S]*?previewFitMounted\.value = false/)
  assert.match(resetFit, /resetPreviewFitPresentation\(\)/)
  assert.match(resetFit, /clearPreviewFitCommittedPlan\(\)[\s\S]*?invalidatePreviewFitDocument\(\)/)
  assert.match(releaseFit, /resetPreviewFitCanvasState\(\{ clearFailure: false \}\)/)
  assert.match(fitError, /resetPreviewFitPresentation\(\)/)
  assert.match(closePreview, /previewDomMounted\.value = false[\s\S]*?previewDomGeneration\.value \+= 1[\s\S]*?resetPreviewFitCanvasState\(\)/)
  assert.match(openPreview, /resetPreviewFitCanvasState\(\)/)
})

test('reactivation starts a fresh full handoff and runtime dispatch targets only the active Canvas', () => {
  const updateViewport = sourceBetween(appSource, 'function updatePreviewViewport', 'function commitPreviewViewport')
  const runtimeActive = sourceBetween(appSource, 'function runtimeCanvasRenderingActive', 'function queueRuntimeCanvasDirtyKey')
  const runtimeDispatch = sourceBetween(appSource, 'function markRuntimeCanvasDirty', 'function markMiniMapDirty')
  const documentDirty = sourceBetween(appSource, 'function markPreviewCanvasDocumentDirty', 'function handleFormChange')
  const requestDocumentRender = sourceBetween(appSource, 'function requestPreviewFitDocumentRender', 'watch(\n  [previewFitMounted')
  const targetRenderWatch = sourceBetween(appSource, 'watch(\n  [previewFitMounted', '// 节点索引')
  const rejectedRender = sourceBetween(appSource, 'function handlePreviewFitRenderRejected', 'function commitPreviewFitRenderPlan')
  const excludedPlanWatch = sourceBetween(appSource, 'watch([previewFitExcludedNodeIds, previewFitExcludedDrawingIds]', 'watch(previewFitCanUseCanvas')
  const previewRenderComplete = sourceBetween(appSource, 'function handlePreviewFitRenderComplete', 'function rememberPreviewScroll')
  const domHandoff = sourceBetween(appSource, 'function resetPreviewDomHandoff', 'function handlePreviewDomRenderComplete')
  const fitHandoff = sourceBetween(appSource, 'async function ensurePreviewFitCanvas', 'function showPreviewFitFrame')
  const progressiveTag = openingTag(appSource, '<ProgressivePreviewNodes')

  assert.match(updateViewport, /requestAnimationFrame/)
  assert.match(updateViewport, /commitPreviewViewport\(target\.scrollLeft, target\.scrollTop, target\)/)
  assert.match(appSource, /watch\([^\n]*(?:previewViewport|previewNodeCandidates|previewVisibleNodes)[\s\S]*?previewDomGeneration\.value\s*\+=\s*1[\s\S]*?resetPreviewDomReadyState\(\)/)
  assert.match(runtimeActive, /previewCanvasRenderActive\.value/)
  assert.match(runtimeActive, /function previewRuntimeCanvasTracked\(\)[\s\S]*?showPreview\.value && \(previewFitMounted\.value \|\| previewDomEdgeCanvasActive\.value\)/)
  assert.match(appSource, /if \(!runtimeCanvasRenderingActive\(\) && !previewRuntimeCanvasTracked\(\)\) return false/)
  assert.match(runtimeDispatch, /previewCanvasRenderActive\.value\s*&&\s*previewFitCanvas\.value/)
  assert.match(runtimeDispatch, /previewDomEdgeCanvasActive\.value\s*&&\s*previewEdgeCanvas\.value/)
  assert.match(runtimeDispatch, /const runtimeRequest = \{[\s\S]*?nodes: dirty\.nodes,[\s\S]*?dense: dirty\.dense,[\s\S]*?pending: dirty\.pending[\s\S]*?\}/)
  assert.match(runtimeDispatch, /target\.requestRuntimeRender\?\.\(runtimeRequest\)/)
  assert.match(runtimeDispatch, /previewFrameFreshness\.markRuntimeStale\(\)[\s\S]*?syncPreviewFitFrameFreshness\(\)/)
  assert.match(appSource, /previewRuntimeCanvasTracked\(\) && !previewCanvasRenderActive\.value[\s\S]*?previewFrameFreshness\.markRuntimeStale\(\)[\s\S]*?syncPreviewFitFrameFreshness\(\)/)
  assert.match(appSource, /watch\(runtimeCanvasRenderingActive, active => \{[\s\S]*?runtimeCanvasDirtyQueue\.hasPending\(\)[\s\S]*?markRuntimeCanvasDirty\(\)/)
  assert.ok(
    appSource.indexOf('const editorLodActive = computed') < appSource.indexOf('watch(runtimeCanvasRenderingActive'),
    'runtime Canvas watch must be registered after editorLodActive initialization'
  )
  assert.ok(
    appSource.indexOf('const previewDomEdgeCanvasActive = computed') < appSource.indexOf('watch(runtimeCanvasRenderingActive'),
    'runtime Canvas watch must be registered after previewDomEdgeCanvasActive initialization'
  )
  assert.match(documentDirty, /invalidatePreviewFitDocument\(\)[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.match(requestDocumentRender, /clearPreviewCanvasDocumentRenderTimer\(\)/)
  assert.match(requestDocumentRender, /const requestedToken = previewFitFrameCommitToken\.value[\s\S]*?nextTick[\s\S]*?previewFitFrameCommitToken\.value !== requestedToken[\s\S]*?renderState\?\.pending[\s\S]*?requestCoalescedRender/)
  assert.match(targetRenderWatch, /clearPreviewCanvasDocumentRenderTimer\(\)[\s\S]*?previewFrameFreshness\.requestDocumentRender/)
  assert.match(rejectedRender, /previewCanvasDocumentRenderTimer[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.match(rejectedRender, /pendingImages[\s\S]*?return/)
  assert.doesNotMatch(rejectedRender, /previewFrameCommitRequested/)
  assert.match(excludedPlanWatch, /invalidatePreviewFitDocument\(\)[\s\S]*?nextTick[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.doesNotMatch(excludedPlanWatch, /renderState\?\.pending/)
  assert.match(previewRenderComplete, /previewFrameFreshness\.handleRenderComplete\(event\)[\s\S]*?syncPreviewFitFrameFreshness\(\)[\s\S]*?if \(!fresh\) return[\s\S]*?showPreviewFitFrame\(\)/)
  assert.match(previewRenderComplete, /event\.kind === 'runtime' && \(event\.pendingRuntime \|\| runtimeCanvasDirtyQueue\.hasPending\(\)\)\) return/)
  assert.match(appSource, /function canCommitPreviewFitFrame\(event\)[\s\S]*?pendingImages[\s\S]*?previewFitRenderPlanMatches\(event\)[\s\S]*?previewFrameFreshness\.canCommitRender\(event\)/)
  assert.match(miniMapSource, /pendingImages = task\.pendingImageUrls\?\.size \|\| 0[\s\S]*?settled:\s*!pendingFull && !pendingRuntime && pendingImages === 0/)
  assert.match(miniMapSource, /task\.waitForImages && completion\.pendingImages > 0[\s\S]*?emit\('render-rejected', completion\)/)
  assert.match(miniMapSource, /sharedPreviewImageCache\.acquire\(url, handleSharedImageSettled\)/)
  assert.match(miniMapSource, /function cachedImageReady\(image\) \{[\s\S]*?sharedPreviewImageCache\.ready\(image\)/)
  assert.match(openingTag(appSource, '<MiniMapPreview v-if="previewFitMounted"'), /\bwait-for-images\b/)

  assert.match(domHandoff, /previewRenderTarget\.value\s*=\s*['"]dom['"]/)
  assert.match(domHandoff, /previewDomMounted\.value\s*=\s*true/)
  assert.match(domHandoff, /resetPreviewDomReadyState\(\)/)
  assert.match(domHandoff, /previewDomGeneration\.value\s*\+=\s*1/)
  assert.match(fitHandoff, /previewRenderTarget\.value\s*=\s*['"]fit['"]/)
  assert.match(fitHandoff, /previewFitMounted\.value\s*=\s*true/)
  assert.match(fitHandoff, /previewFitCanvasReady\.value\s*=\s*false/)
  assert.match(fitHandoff, /previewFitFrameAvailable\.value\s*=\s*false/)
  assert.match(fitHandoff, /clearPreviewCanvasDocumentRenderTimer\(\)[\s\S]*?previewFrameFreshness\.requestDocumentRender/)
  assert.match(fitHandoff, /requestPreviewFitDocumentRender\(\)/)

  const runtimeBinding = progressiveTag.match(/:runtime-store="([^"]+)"/)?.[1] || ''
  assert.equal(runtimeBinding, 'runtimeData')
  assert.match(progressiveTag, /:batch-size="8"/)
  assert.match(progressiveTag, /:mount-cost-budget="64"/)
})

test('ordinary preview explicitly resumes the visible committed animation clock', () => {
  const resume = sourceBetween(
    appSource,
    'function resumeVisiblePreviewAnimationClocks',
    'function presentPreparedPreview'
  )
  const present = sourceBetween(appSource, 'function presentPreparedPreview', 'function finishPreviewDomHandoff')

  assert.match(resume, /showPreview\.value/)
  assert.match(resume, /previewPresentationReady\.value/)
  assert.match(resume, /previewCanvasVisible\.value[\s\S]*?previewFitCanvas\.value\?\.resumeCommittedAnimationClock\?\.\(\)/)
  assert.match(resume, /previewEdgeCanvasVisible\.value[\s\S]*?previewEdgeCanvas\.value\?\.resumeCommittedAnimationClock\?\.\(\)/)
  assert.match(present, /previewPresentationReady\.value = true/)
  assert.match(appSource, /watch\(\s*\[previewPresentationReady, previewCanvasVisible, previewEdgeCanvasVisible\],[\s\S]*?resumeVisiblePreviewAnimationClocks,[\s\S]*?\{ flush: 'post' \}/)
})

test('preview frame freshness rejects stale documents without starving on continuous runtime updates', () => {
  const freshness = createPreviewFrameFreshness()

  assert.deepEqual(freshness.state(), {
    documentEpoch: 0,
    requestedEpoch: -1,
    committedEpoch: -1,
    fresh: false
  })

  freshness.requestDocumentRender()
  assert.equal(freshness.handleRenderComplete({ kind: 'full', settled: true, pendingFull: false, pendingRuntime: false }), true)
  assert.equal(freshness.state().fresh, true)

  freshness.markRuntimeDirty()
  assert.equal(freshness.state().fresh, true)
  assert.equal(freshness.handleRenderComplete({ kind: 'runtime', settled: false, pendingRuntime: true }), true)

  freshness.invalidateDocument()
  assert.equal(freshness.handleRenderComplete({ kind: 'runtime', settled: true }), false)
  assert.equal(freshness.handleRenderComplete({ kind: 'full', settled: true, pendingFull: false, pendingRuntime: false }), false)

  freshness.requestDocumentRender()
  assert.equal(freshness.handleRenderComplete({ kind: 'full', settled: false, pendingFull: true, pendingRuntime: false }), false)
  assert.equal(freshness.handleRenderComplete({ kind: 'full', settled: false, pendingFull: false, pendingRuntime: true }), true)
  freshness.markRuntimeDirty()
  assert.equal(freshness.state().fresh, true)
  assert.equal(freshness.handleRenderComplete({ kind: 'runtime', settled: false, pendingRuntime: true }), true)

  freshness.invalidateDocument()
  freshness.requestDocumentRender()
  freshness.invalidateDocument()
  assert.equal(freshness.handleRenderComplete({ kind: 'full', settled: true, pendingFull: false, pendingRuntime: false }), false)
})

test('preview frame commit checks are pure and runtime staleness recovers only from the matching backing', () => {
  const freshness = createPreviewFrameFreshness()
  const windowed = { width: 640, height: 360, pixelRatio: 2, maxBitmapPixels: 8_388_608 }
  const fullscreen = { width: 960, height: 540, pixelRatio: 2, maxBitmapPixels: 8_388_608 }
  freshness.requestDocumentRender(windowed)
  const windowedTarget = freshness.targetState().target
  const oldDocumentToken = freshness.currentCommitStamp()
  const pendingWindowed = { kind: 'full', pendingFull: true, ...windowedTarget, frameCommitToken: oldDocumentToken }
  const completeWindowed = { kind: 'full', pendingFull: false, ...windowedTarget, frameCommitToken: oldDocumentToken }

  const beforeCheck = { state: freshness.state(), target: freshness.targetState() }
  assert.equal(freshness.canCommitRender(pendingWindowed), false)
  assert.equal(freshness.canCommitRender(completeWindowed), true)
  assert.deepEqual({ state: freshness.state(), target: freshness.targetState() }, beforeCheck)

  freshness.invalidateDocument()
  freshness.requestDocumentRender(windowed)
  const currentDocumentToken = freshness.currentCommitStamp()
  assert.notDeepEqual(currentDocumentToken, oldDocumentToken)
  assert.equal(freshness.canCommitRender(completeWindowed), false)
  assert.equal(freshness.handleRenderComplete(completeWindowed), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'full',
    pendingFull: true,
    ...windowedTarget,
    frameCommitToken: currentDocumentToken
  }), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'full',
    pendingFull: false,
    ...windowedTarget,
    frameCommitToken: currentDocumentToken
  }), true)
  const completeCurrentWindowed = {
    kind: 'full',
    pendingFull: false,
    ...windowedTarget,
    frameCommitToken: currentDocumentToken
  }

  freshness.requestDocumentRender(fullscreen)
  const fullscreenTarget = freshness.targetState().target
  const fullscreenToken = freshness.currentCommitStamp()
  assert.equal(freshness.canCommitRender(completeCurrentWindowed), false)
  assert.equal(freshness.handleRenderComplete(completeCurrentWindowed), false)
  assert.equal(freshness.canCommitRender({
    ...completeCurrentWindowed,
    frameCommitToken: fullscreenToken
  }), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'full',
    pendingFull: true,
    ...fullscreenTarget,
    frameCommitToken: fullscreenToken
  }), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'full',
    pendingFull: false,
    ...fullscreenTarget,
    frameCommitToken: fullscreenToken
  }), true)

  const committedState = freshness.state()
  const committedTargetState = freshness.targetState()
  freshness.markRuntimeStale()
  assert.deepEqual(freshness.state(), { ...committedState, fresh: false })
  assert.deepEqual(freshness.targetState(), committedTargetState)

  const wrongBacking = {
    kind: 'runtime',
    pendingFull: false,
    bitmapWidth: fullscreenTarget.bitmapWidth + 1,
    bitmapHeight: fullscreenTarget.bitmapHeight,
    frameCommitToken: fullscreenToken
  }
  assert.equal(freshness.canCommitRender(wrongBacking), false)
  assert.equal(freshness.handleRenderComplete(wrongBacking), false)
  assert.equal(freshness.state().fresh, false)

  const matchingBacking = {
    kind: 'runtime',
    pendingFull: false,
    bitmapWidth: fullscreenTarget.bitmapWidth,
    bitmapHeight: fullscreenTarget.bitmapHeight,
    frameCommitToken: fullscreenToken
  }
  assert.equal(freshness.canCommitRender(matchingBacking), true)
  assert.equal(freshness.state().fresh, false)
  assert.equal(freshness.handleRenderComplete(matchingBacking), true)
  assert.equal(freshness.state().fresh, true)
})

test('the controlled hybrid handoff preserves layer order and real form and video interaction', () => {
  const previewTemplate = sourceBetween(appSource, '<div v-if="showPreview"', '<Teleport v-if="buttonMessageDialog.show"')
  const livePlaneTemplate = sourceBetween(previewTemplate, '<div v-if="previewLivePlaneActive"', '</div>\n    </div></div>')

  assert.match(previewTemplate, /<ProgressivePreviewNodes :nodes="previewDomNodes"/)
  assert.doesNotMatch(previewTemplate, /<ProgressivePreviewNodes[^>]*:nodes="previewDomNodes\.slice/)
  assert.doesNotMatch(previewTemplate, /<svg v-if="!previewDomLimited"/)
  assert.match(previewTemplate, /<ProgressivePreviewGeometry[\s\S]*?:edges="previewDomEdges"[\s\S]*?:drawings="previewDomDrawings"/)
  assert.doesNotMatch(previewTemplate, /previewVisibleEdgeEntries|previewVisibleDrawingEntries/)
  assert.match(previewTemplate, /backgroundColor: canvasBg/)
  assert.match(appSource, /const previewDomNodes = computed\([\s\S]*?previewDomUsesLivePlane\.value[\s\S]*?previewFitExcludedNodeIds\.value[\s\S]*?source\.filter\(node => !excludedIds\.has\(node\.id\)\)/)
  assert.match(appSource, /const previewDomDrawings = computed\([\s\S]*?previewDomUsesLivePlane\.value[\s\S]*?previewFitExcludedDrawingIds\.value[\s\S]*?source\.filter\(drawing => !excludedIds\.has\(drawing\.id\)\)/)
  assert.match(appSource, /const previewDomFullDocumentRequested = computed\([\s\S]*?previewRenderTarget\.value === 'dom'[\s\S]*?previewFitLayoutRequested\.value[\s\S]*?!previewFitCanUseCanvas\.value \|\| previewFitCanvasFailed\.value/)
  assert.match(appSource, /function handlePreviewFitRenderError\(event = null\)[\s\S]*?retainsCommittedFrame[\s\S]*?previewFitCanvasFailed\.value = false[\s\S]*?return[\s\S]*?previewFitCanvasFailed\.value = true[\s\S]*?resetPreviewDomHandoff\(\)[\s\S]*?previewPresentationReady\.value = false/)
  assert.match(livePlaneTemplate, /<ProgressivePreviewNodes :nodes="previewLivePlaneNodes"/)
  assert.match(livePlaneTemplate, /v-for="entry in previewLivePlaneDrawingEntries"/)
  assert.doesNotMatch(livePlaneTemplate, /class="edges"/)
  assert.match(batchSource, /zIndex:\s*Number\(node\.layer\)\s*\|\|\s*0/)
  assert.match(drawingBatchSource, /zIndex:\s*Number\(entry\.drawing\.layer\)\s*\|\|\s*0/)
  assert.match(batchSource, /<NodeVisual[\s\S]*?\bpreview\b[\s\S]*?@form-change=/)

  for (const contract of [
    /node\.type === 'checkbox'[\s\S]*?<input[^>]*@change="updateChecked/,
    /node\.type === 'button'[\s\S]*?<button[^>]*@click\.stop="handleButtonClick"/,
    /node\.type === 'input'[\s\S]*?<input[^>]*@input="updateValue"/,
    /node\.type === 'select'[\s\S]*?<select[^>]*@change="updateValue"/,
    /node\.type === 'video'[\s\S]*?<video[^>]*:controls="preview/
  ]) assert.match(nodeVisualSource, contract)
  assert.match(nodeVisualSource, /<video[^>]*:preload="preview \? 'auto' : 'metadata'"[^>]*@loadeddata="handleVideoLoadedData"[^>]*@error="handleVideoLoadError"/)
  assert.match(nodeVisualSource, /<img[^>]*:data-preview-media-state="imageLoadFailed \? 'error' : undefined"[^>]*@error="handleImageLoadError"/)
  assert.match(nodeVisualSource, /<video[^>]*:data-preview-media-state="videoLoadFailed \? 'error' : undefined"/)
})

test('parameter bindings invalidate and materialize both DOM and Canvas previews', () => {
  const canvasRuntimeFilter = sourceBetween(miniMapSource, 'function hasIncrementalRuntimeVisual', 'function runtimeDisplayText')
  const canvasNodeDraw = sourceBetween(miniMapSource, 'function drawNode', 'function edgeRasterCommand')

  assert.match(batchSource, /v-memo="\[node,[^"]*node\.dataBindings[^"]*"/)
  assert.match(batchSource, /:key="[^\n]*bindingRenderKey\(node\)[^\n]*"/)
  assert.match(canvasRuntimeFilter, /bindingPointIds\(node\)\.length/)
  assert.match(canvasNodeDraw, /const node = options\.node \|\| textLayout\?\.node \|\| materializeRuntimeNode\(sourceNode, runtimePointValue\)/)
  assert.match(miniMapSource, /chartSeries\(node\)/)
  assert.match(miniMapSource, /node\.chartData/)
  assert.match(miniMapSource, /hasEnabledRuntimeBinding\(node, 'progressValue'\)/)
})
