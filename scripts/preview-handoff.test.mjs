import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createPreviewFrameFreshness } from '../src/utils/previewFrameFreshness.js'
import {
  PREVIEW_HYBRID_MAX_DOM_COST,
  PREVIEW_HYBRID_MAX_DOM_ENTRIES,
  PREVIEW_HYBRID_MAX_DOM_NODES,
  previewHybridDomSafe,
  previewHybridLayerTail,
  previewHybridTailDomSafe,
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

test('dense original-size preview queries the complete viewport instead of truncating the 513th entity', () => {
  const nodeCandidates = sourceBetween(appSource, 'const previewNodeCandidates', 'function edgesForNodeIds')
  const edgeCandidates = sourceBetween(appSource, 'const previewEdgeCandidates', 'const previewDrawingCandidates')
  const drawingCandidates = sourceBetween(appSource, 'const previewDrawingCandidates', 'const previewDomDensity')
  const visibleNodes = sourceBetween(appSource, 'const previewVisibleNodes', 'function edgesForNodeIds')

  assert.match(nodeCandidates, /nodeSpatialIndex\.query\(viewportWorldBounds\(previewViewport\.value, 1, LARGE_DOCUMENT_OVERSCAN\)/)
  assert.doesNotMatch(nodeCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(edgeCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(drawingCandidates, /\blimit\s*:|\.slice\(/)
  assert.doesNotMatch(visibleNodes, /PREVIEW_DOM_NODE_LIMIT|\.slice\(/)

  // The thresholds may select the Canvas loading handoff, but must never select content to omit.
  assert.match(appSource, /const previewDomDensity = computed\([\s\S]*?PREVIEW_DOM_NODE_LIMIT[\s\S]*?PREVIEW_DOM_EDGE_LIMIT[\s\S]*?PREVIEW_DOM_DRAWING_LIMIT/)
})

test('dense original-size and fullscreen previews move only excess edges to a sharp Canvas window', () => {
  const density = sourceBetween(appSource, 'const previewDomDensity', 'const previewVisibleEdges')
  const edgeCanvasTag = openingTag(appSource, '<MiniMapPreview v-if="previewEdgeCanvasBounds"')
  const domEdges = sourceBetween(appSource, 'const previewDomEdges', 'const editorLodEdgeEntries')
  const edgeCanvasVisibility = sourceBetween(appSource, 'const previewEdgeCanvasVisible', 'const previewVisibleEdges')
  const edgeCanvasMatcher = sourceBetween(appSource, 'function previewEdgeCanvasFrameMatchesRequest', 'function canCommitPreviewEdgeCanvasFrame')
  const edgeCanvasGuard = sourceBetween(appSource, 'function canCommitPreviewEdgeCanvasFrame', 'function handlePreviewEdgeCanvasRenderRejected')
  const edgeCanvasRejected = sourceBetween(appSource, 'function handlePreviewEdgeCanvasRenderRejected', 'function handlePreviewEdgeCanvasRenderComplete')
  const edgeCanvasComplete = sourceBetween(appSource, 'function handlePreviewEdgeCanvasRenderComplete', 'function handlePreviewEdgeCanvasRenderError')
  const previewTemplate = sourceBetween(appSource, '<div v-if="showPreview"', '<Teleport v-if="buttonMessageDialog.show"')

  assert.match(density, /edgesInBounds\(bounds, \{ limit: PREVIEW_DOM_EDGE_LIMIT \+ 1 \}\)/)
  assert.match(density, /previewRenderTarget\.value === 'dom'/)
  assert.match(density, /!previewFitLayoutRequested\.value/)
  assert.match(density, /previewDomDensity\.value\.edges/)
  assert.match(density, /clippedPreviewEdgeCanvasBounds\(PREVIEW_EDGE_CANVAS_OVERSCAN\)/)
  assert.match(density, /PREVIEW_EDGE_CANVAS_GUARD/)
  assert.match(edgeCanvasTag, /:render-nodes="false"/)
  assert.match(edgeCanvasTag, /:render-drawings="false"/)
  assert.match(edgeCanvasTag, /:edges="EMPTY_RENDER_LIST"/)
  assert.match(edgeCanvasTag, /:drawings="EMPTY_RENDER_LIST"/)
  assert.match(edgeCanvasTag, /:ordered-entities="EMPTY_RENDER_LIST"/)
  assert.match(edgeCanvasTag, /:edge-spatial-index="edgeSpatialIndex"/)
  assert.match(edgeCanvasTag, /:view-box="previewEdgeCanvasBounds"/)
  assert.match(edgeCanvasTag, /:render-plan-key="previewEdgeCanvasPlanKey"/)
  assert.match(edgeCanvasTag, /:frame-commit-guard="canCommitPreviewEdgeCanvasFrame"/)
  assert.match(edgeCanvasTag, /@render-rejected="handlePreviewEdgeCanvasRenderRejected"/)
  assert.match(edgeCanvasTag, /:pixel-ratio="previewEdgeCanvasPixelRatio"/)
  assert.match(edgeCanvasTag, /v-if="previewEdgeCanvasBounds"/)
  assert.match(edgeCanvasTag, /:active="previewDomEdgeCanvasActive"/)
  assert.match(edgeCanvasTag, /render-mode="task"/)
  assert.match(domEdges, /previewDomEdgeCanvasActive\.value[\s\S]*?previewEdgeCanvasVisible\.value/)
  assert.match(domEdges, /return previewVisibleEdges\.value/)
  assert.doesNotMatch(domEdges, /\.map\(|\blimit\s*:/)
  assert.match(previewTemplate, /<ProgressivePreviewGeometry[\s\S]*?:edges="previewDomEdges"[\s\S]*?:drawings="previewDomDrawings"/)
  assert.match(previewTemplate, /<ProgressivePreviewNodes :nodes="previewDomNodes"/)
  assert.match(edgeCanvasVisibility, /previewEdgeCanvasCommittedPlanKey\.value === previewEdgeCanvasPlanKey\.value/)
  assert.match(edgeCanvasVisibility, /previewBitmapIsSharp\(previewEdgeCanvasCommittedPixelRatio\.value, previewEdgeCanvasPixelRatio\.value\)/)
  assert.match(edgeCanvasVisibility, /previewCanvasBoundsContain\(previewEdgeCanvasCommittedBounds\.value, clippedPreviewEdgeCanvasBounds\(0\)\)/)
  assert.match(edgeCanvasMatcher, /event\.renderPlanKey === previewEdgeCanvasPlanKey\.value/)
  assert.match(edgeCanvasMatcher, /previewCanvasBoundsMatch\(event\.viewBox, previewEdgeCanvasBounds\.value\)/)
  assert.match(edgeCanvasGuard, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewBitmapIsSharp/)
  assert.match(edgeCanvasRejected, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewEdgeCanvasReady\.value = false[\s\S]*?handlePreviewEdgeCanvasRenderError\(\)/)
  assert.match(edgeCanvasComplete, /if \(!previewEdgeCanvasFrameMatchesRequest\(event\)\) return/)
  assert.doesNotMatch(edgeCanvasComplete, /previewEdgeCanvasFrameMatchesRequest\(event\)[\s\S]*?previewEdgeCanvasReady\.value = false/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedBounds\.value = \{ \.\.\.renderedBounds \}/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedPixelRatio\.value = renderedPixelRatio/)
  assert.match(edgeCanvasComplete, /previewEdgeCanvasCommittedPlanKey\.value = event\.renderPlanKey/)
  assert.match(edgeCanvasComplete, /previewBitmapIsSharp[\s\S]*?handlePreviewEdgeCanvasRenderError\(\)/)
  assert.match(appSource, /return `preview-edges:[^`]*\$\{edgeSpatialRevision\.value\}:\$\{previewEdgeCanvasPixelRatio\.value\}`/)
  assert.match(appSource, /!previewCanvasBoundsMatch\(nextBounds, previewEdgeCanvasBounds\.value\)[\s\S]*?!previewCanvasBoundsContain\(previewEdgeCanvasCommittedBounds\.value, clippedPreviewEdgeCanvasBounds\(0\)\)[\s\S]*?previewEdgeCanvasReady\.value = false/)
  assert.match(appSource, /if \(previewDomEdgeCanvasActive\.value\) syncPreviewEdgeCanvasBounds\(\)/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-edge-canvas\.is-visible \{ visibility: visible; opacity: 1; \}/)
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
  const settle = sourceBetween(progressiveSource, 'const settleVisibleNodes', 'const appendPendingBatch')
  const append = sourceBetween(progressiveSource, 'const appendPendingBatch', 'if (!props.progressive)')

  assert.match(progressiveSource, /generation:\s*\{\s*type:\s*Number/)
  assert.match(progressiveSource, /defineEmits\(\[[^\]]*'render-complete'/)
  assert.match(progressiveSource, /emit\('render-complete',\s*\{\s*generation:[^,}]+,\s*count:\s*source\.length\s*\}\)/)
  assert.match(progressiveSource, /if \(generation !== renderGeneration\) return/)
  assert.match(progressiveSource, /if \(visibleCount\.value < source\.length\) return[\s\S]*?emit\('render-complete'/)
  assert.match(progressiveSource, /watch\(\[[^\]]*\(\) => props\.generation/)

  assert.match(progressiveSource, /const visibleNodes = shallowRef\(\[\]\)/)
  assert.match(progressiveSource, /partitionRetainedPreviewNodes\(source, visibleNodes\.value\)/)
  assert.match(progressiveSource, /\{ retainedIds, retainedNodes, pendingNodes \} = partitionRetainedPreviewNodes/)
  assert.match(progressiveSource, /visibleNodes\.value = retainedNodes/)
  assert.match(append, /visibleNodes\.value\.push\(\.\.\.pendingNodes\.slice\(pendingCount, nextCount\)\)[\s\S]*?triggerRef\(visibleNodes\)/)
  assert.doesNotMatch(append, /visibleNodes\.value\.filter/)
  assert.match(settle, /if \(!props\.progressive \|\| retainedIds\.size\) visibleNodes\.value = source\.slice\(\)[\s\S]*?reportRenderComplete/)

  // Empty viewports must also finish; otherwise the Canvas loading frame could remain forever.
  assert.match(progressiveSource, /source\.length\s*===\s*0[\s\S]*?render-complete|render-complete[\s\S]*?source\.length\s*===\s*0/)
})

test('preview policy keeps a bounded DOM tail above the lowest live visual', () => {
  assert.equal(previewNodeNeedsLiveDom({ type: 'rect', animation: 'none' }), false)
  for (const node of [
    { type: 'video' },
    { type: 'time' },
    { type: 'input' },
    { type: 'table' },
    { type: 'customTextMotion', animation: 'none' },
    { type: 'rect', animation: 'pulse' },
    { type: 'progress', progressFluctuationEnabled: true },
    { type: 'image', imageUrl: 'status.GIF?revision=2' },
    { type: 'image', imageUrl: 'data:image/webp;base64,animated' }
  ]) assert.equal(previewNodeNeedsLiveDom(node), true, `expected ${node.type} to use live DOM`)

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

test('Canvas and controlled live DOM overlay retain a fallback only during handoff', () => {
  const canvasVisibility = sourceBetween(appSource, 'const previewCanvasVisible', 'const previewRenderScale')
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
  const showFit = sourceBetween(appSource, 'function showPreviewFitFrame', 'function handlePreviewFitRenderComplete')
  const releaseFit = sourceBetween(appSource, 'function releasePreviewFitCanvas', 'function handlePreviewDomRenderComplete')
  const resetFit = sourceBetween(appSource, 'function resetPreviewFitCanvasState', 'function previewFitRenderPlanMatches')

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
  assert.match(canvasVisibility, /previewFitVisible\.value/)
  assert.match(canvasVisibility, /!previewDomReady\.value[\s\S]*?previewFitFrameAvailable\.value|previewFitFrameAvailable\.value[\s\S]*?!previewDomReady\.value/)
  assert.match(canvasVisibility, /previewFitFrameFresh\.value/)
  assert.doesNotMatch(canvasVisibility, /previewDomLimited\.value\s*&&\s*previewFitFrameAvailable\.value/)
  assert.match(previewCanvasTag, /:class="\{ 'is-visible': previewCanvasVisible \}"/)
  assert.match(previewCanvasTag, /:excluded-node-ids="previewFitExcludedNodeIds"/)
  assert.match(previewCanvasTag, /:excluded-drawing-ids="previewFitExcludedDrawingIds"/)
  assert.match(previewCanvasTag, /:render-plan-key="previewFitPlan\.key"/)
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
  assert.match(domComplete, /previewDomNodesReady\.value = true[\s\S]*?finishPreviewDomHandoff\(\)/)
  assert.match(geometryComplete, /edgeCount[^\n]*previewDomEdges\.value\.length[\s\S]*?drawingCount[^\n]*previewDomDrawings\.value\.length/)
  assert.match(geometryComplete, /previewDomGeometryReady\.value = true[\s\S]*?finishPreviewDomHandoff\(\)/)
  assert.match(resetDomReady, /previewDomNodesReady\.value = false[\s\S]*?previewDomGeometryReady\.value = false/)
  assert.match(finishDom, /!showPreview\.value[\s\S]*?!previewDomMounted\.value[\s\S]*?!previewDomReady\.value[\s\S]*?previewRenderTarget\.value !== 'dom'/)
  assert.match(finishDom, /previewDisplayMode\.value = previewFitLayoutRequested\.value \? 'dom-fit' : 'dom'[\s\S]*?releasePreviewFitCanvas\(\)/)
  assert.match(liveComplete, /generation[^\n]*previewLivePlaneGeneration\.value[\s\S]*?count[^\n]*previewLivePlaneNodes\.value\.length[\s\S]*?previewLivePlaneReady\.value = true/)
  assert.match(releaseFit, /resetPreviewFitCanvasState\(\{ clearFailure: false \}\)/)
  assert.doesNotMatch(releaseFit, /runtimeCanvasRenderFrame|runtimeCanvasDirtyQueue/)
  assert.match(resetFit, /previewFitMounted\.value\s*=\s*false/)
  assert.match(resetFit, /previewFitCanvasReady\.value\s*=\s*false[\s\S]*?previewFitFrameAvailable\.value\s*=\s*false/)
  assert.match(fitComplete, /previewFrameFreshness\.handleRenderComplete\(event\)/)
  assert.match(fitComplete, /previewFitRenderPlanMatches\(event\)[\s\S]*?previewFrameFreshness\.handleRenderComplete\(event\)[\s\S]*?commitPreviewFitRenderPlan\(\)[\s\S]*?showPreviewFitFrame\(\)/)
  assert.match(showFit, /!previewFitCanUseCanvas\.value[\s\S]*?resetPreviewDomHandoff\(\)/)
  assert.match(showFit, /previewFitCommittedPlanKey\.value !== previewFitPlan\.value\.key/)
  assert.match(showFit, /previewFitCommittedUsesDomOverlay\.value && !previewLivePlaneReady\.value\) return false/)
  assert.match(showFit, /previewDisplayMode\.value\s*=\s*['"]fit['"][\s\S]*?previewDomMounted\.value\s*=\s*false/)

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

  // Visibility keeps the old layer as an atomic fallback while the target mounts.
  // The v-if contracts above ensure neither hidden layer survives the completed handoff.
  assert.match(styleSource, /\.preview-stage\.is-hidden\s*\{[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage\.is-live-plane\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*none/)
  assert.match(styleSource, /\.preview-stage\.is-live-plane \.node-shell\s*\{[^}]*pointer-events:\s*auto/)
  assert.match(styleSource, /\.preview-stage-space > \.preview-fit-canvas\s*\{[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*pointer-events:\s*none/)
})

test('fit preview presents only one accepted frame geometry and never exposes a low-density bootstrap', () => {
  const fitComplete = sourceBetween(appSource, 'function handlePreviewFitRenderComplete', 'function handlePreviewFitRenderError')
  const fitError = sourceBetween(appSource, 'function handlePreviewFitRenderError', 'function rememberPreviewScroll')
  const releaseFit = sourceBetween(appSource, 'function releasePreviewFitCanvas', 'function handlePreviewDomRenderComplete')
  const resetFit = sourceBetween(appSource, 'function resetPreviewFitCanvasState', 'function previewFitRenderPlanMatches')
  const ensureFit = sourceBetween(appSource, 'async function ensurePreviewFitCanvas', 'function showPreviewFitFrame')
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

  assert.match(appSource, /const previewFitBootstrapSharp = computed\(\(\) => previewBitmapIsSharp\([\s\S]*?previewFitCommittedPixelRatio\.value,[\s\S]*?previewFitPixelRatio\.value/)
  assert.match(appSource, /const previewFitPresentationScale = computed/)
  assert.match(appSource, /const previewFitPresentationOffset = computed/)
  assert.match(stageSpace, /previewFitPresentationOffset\.left/)
  assert.match(stageSpace, /previewFitPresentationOffset\.top/)
  assert.match(flushViewport, /syncPreviewFitCommittedOffset\(target, contentRect\)/)
  assert.match(flushViewport, /previewFittedVisible\.value && previewFitFrameAvailable\.value/)

  assert.doesNotMatch(ensureFit, /copyCommittedFrameTo|bootstrap\s*=/)
  assert.match(ensureFit, /!target && !previewFitMounted\.value && !previewFitBootstrapCanRenderSharp\.value\) return false/)
  assert.match(ensureFit, /const mountedNow = !previewFitMounted\.value[\s\S]*?await nextTick\(\)/)
  assert.match(ensureFit, /!mountedNow && !targetChanged && !previewFitCanvas\.value\?\.renderState\?\.pending/)
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
  assert.match(runtimeActive, /function previewRuntimeCanvasTracked\(\)[\s\S]*?showPreview\.value && previewFitMounted\.value/)
  assert.match(appSource, /if \(!runtimeCanvasRenderingActive\(\) && !previewRuntimeCanvasTracked\(\)\) return false/)
  assert.match(runtimeDispatch, /previewCanvasRenderActive\.value\s*&&\s*previewFitCanvas\.value/)
  assert.match(runtimeDispatch, /const runtimeRequest = \{[\s\S]*?nodes: dirty\.nodes,[\s\S]*?dense: dirty\.dense,[\s\S]*?pending: dirty\.pending[\s\S]*?\}/)
  assert.match(runtimeDispatch, /target\.requestRuntimeRender\?\.\(runtimeRequest\)/)
  assert.match(runtimeDispatch, /previewFrameFreshness\.markRuntimeStale\(\)[\s\S]*?syncPreviewFitFrameFreshness\(\)/)
  assert.match(appSource, /previewRuntimeCanvasTracked\(\) && !previewCanvasRenderActive\.value[\s\S]*?previewFrameFreshness\.markRuntimeStale\(\)[\s\S]*?syncPreviewFitFrameFreshness\(\)/)
  assert.match(appSource, /watch\(runtimeCanvasRenderingActive, active => \{[\s\S]*?runtimeCanvasDirtyQueue\.hasPending\(\)[\s\S]*?markRuntimeCanvasDirty\(\)/)
  assert.ok(
    appSource.indexOf('const editorLodActive = computed') < appSource.indexOf('watch(runtimeCanvasRenderingActive'),
    'runtime Canvas watch must be registered after editorLodActive initialization'
  )
  assert.match(documentDirty, /invalidatePreviewFitDocument\(\)[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.match(requestDocumentRender, /clearPreviewCanvasDocumentRenderTimer\(\)/)
  assert.match(requestDocumentRender, /const requestedToken = previewFitFrameCommitToken\.value[\s\S]*?nextTick[\s\S]*?previewFitFrameCommitToken\.value !== requestedToken[\s\S]*?renderState\?\.pending[\s\S]*?requestCoalescedRender/)
  assert.match(targetRenderWatch, /clearPreviewCanvasDocumentRenderTimer\(\)[\s\S]*?previewFrameFreshness\.requestDocumentRender/)
  assert.match(rejectedRender, /previewCanvasDocumentRenderTimer[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.doesNotMatch(rejectedRender, /previewFrameCommitRequested/)
  assert.match(excludedPlanWatch, /invalidatePreviewFitDocument\(\)[\s\S]*?nextTick[\s\S]*?requestPreviewFitDocumentRender\(\)/)
  assert.doesNotMatch(excludedPlanWatch, /renderState\?\.pending/)
  assert.match(previewRenderComplete, /previewFrameFreshness\.handleRenderComplete\(event\)[\s\S]*?syncPreviewFitFrameFreshness\(\)[\s\S]*?if \(!fresh\) return[\s\S]*?showPreviewFitFrame\(\)/)
  assert.match(previewRenderComplete, /event\.kind === 'runtime' && \(event\.pendingRuntime \|\| runtimeCanvasDirtyQueue\.hasPending\(\)\)\) return/)
  assert.match(appSource, /function canCommitPreviewFitFrame\(event\)[\s\S]*?previewFitRenderPlanMatches\(event\)[\s\S]*?previewFrameFreshness\.canCommitRender\(event\)/)

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
  assert.match(appSource, /function handlePreviewFitRenderError\(\)[\s\S]*?previewFitCanvasFailed\.value = true[\s\S]*?resetPreviewDomHandoff\(\)[\s\S]*?previewDisplayMode\.value = 'dom'/)
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
})

test('parameter bindings invalidate and materialize both DOM and Canvas previews', () => {
  const canvasRuntimeFilter = sourceBetween(miniMapSource, 'function hasIncrementalRuntimeVisual', 'function runtimeDisplayText')
  const canvasNodeDraw = sourceBetween(miniMapSource, 'function drawNode', 'function edgeRasterCommand')

  assert.match(batchSource, /v-memo="\[node,[^"]*node\.dataBindings[^"]*"/)
  assert.match(batchSource, /:key="[^\n]*bindingRenderKey\(node\)[^\n]*"/)
  assert.match(canvasRuntimeFilter, /bindingPointIds\(node\)\.length/)
  assert.match(canvasNodeDraw, /const node = options\.node \|\| textLayout\?\.node \|\| materializeRuntimeNode\(sourceNode, runtimePointValue\)/)
  assert.match(miniMapSource, /runtimeChartPercentages\(node\)/)
  assert.match(miniMapSource, /hasEnabledRuntimeBinding\(node, 'progressValue'\)/)
})
