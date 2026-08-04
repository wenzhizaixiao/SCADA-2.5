import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS,
  EDITOR_LOD_MAX_OVERLAY_EDGES,
  EDITOR_LOD_MAX_OVERLAY_NODES,
  editorLodDetailClipPath,
  editorLodDetailFallbackRegions,
  editorLodOverlayEdges,
  editorLodOverlayNodeIds,
  editorLodRemovalCoverRegions,
  pickTopEditorEntity,
  pointHitsDrawing,
  pointHitsRotatedNode,
  shouldHideEditorLodGeometryDom,
  shouldUseEditorLodDetailFallback,
  shouldUseEditorLod
} from '../src/utils/editorLod.js'
import {
  editorLodDrawingRegions,
  editorLodEdgeRegions,
  editorLodGeometryRegions,
  editorLodIndexSegments,
  editorLodNodeRegion,
  editorLodSegmentRegions,
  mergeEditorLodGeometryRegions
} from '../src/utils/editorLodGeometry.js'
import { canvasBitmapDimensions } from '../src/utils/canvasBitmap.js'
import {
  EDITOR_LOD_FALLBACK_BITMAP_PIXELS,
  MIN_EDITOR_LOD_DETAIL_PIXEL_RATIO,
  MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS,
  editorLodDetailOverscanPixels,
  editorLodDetailPixelRatio,
  editorLodBitmapPixelBudget
} from '../src/utils/editorLodBitmapBudget.js'
import {
  MIN_EDITOR_LOD_GRID_SCREEN_PITCH,
  MIN_EDITOR_LOD_GRID_SCREEN_STROKE,
  editorLodGridPresentation
} from '../src/utils/editorLodGrid.js'
import {
  EDITOR_LOD_MIN_TEXT_SCREEN_SIZE,
  layoutConstrainedCanvasFontSize,
  readableCanvasFontSize
} from '../src/utils/canvasTextReadability.js'
import {
  editorLodDetailGeometryCompletesSession,
  editorLodDetailRenderCompletesSession,
  editorLodFallbackGeometryCompletesSession,
  editorLodGeometryBarrierSettled,
  markEditorLodGeometryLayerComplete,
  markEditorLodGeometryLayerFailed,
  parseRenderGeneration
} from '../src/utils/editorLodGeometryCompletion.js'

function referenceFramesTouchOrOverlap(a, b) {
  return a.x <= b.x + b.w
    && a.x + a.w >= b.x
    && a.y <= b.y + b.h
    && a.y + a.h >= b.y
}

function referenceFrameUnion(a, b) {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function referenceAppendMergedFrame(regions, frame) {
  let current = frame
  let index = 0
  while (index < regions.length) {
    if (!referenceFramesTouchOrOverlap(current, regions[index])) {
      index += 1
      continue
    }
    current = referenceFrameUnion(current, regions[index])
    regions.splice(index, 1)
    index = 0
  }
  regions.push(current)
}

function referenceMergeTouchingFrames(regions) {
  const merged = []
  for (const region of regions) referenceAppendMergedFrame(merged, region)
  return merged.sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h)
}

function referenceChangedFramesTouch(regions, changedFirst, changedSecond = -1) {
  for (let other = 0; other < regions.length; other += 1) {
    if (other !== changedFirst && referenceFramesTouchOrOverlap(regions[changedFirst], regions[other])) return true
    if (changedSecond >= 0 && other !== changedSecond && referenceFramesTouchOrOverlap(regions[changedSecond], regions[other])) return true
  }
  return false
}

function referencePairScore(first, second, firstIndex, secondIndex) {
  const union = referenceFrameUnion(first, second)
  return {
    extraArea: union.w * union.h - first.w * first.h - second.w * second.h,
    unionArea: union.w * union.h,
    first: firstIndex,
    second: secondIndex
  }
}

function referencePairScoreIsLower(candidate, selected) {
  return !selected
    || candidate.extraArea < selected.extraArea
    || (candidate.extraArea === selected.extraArea && candidate.unionArea < selected.unionArea)
    || (
      candidate.extraArea === selected.extraArea
      && candidate.unionArea === selected.unionArea
      && (candidate.first < selected.first || (candidate.first === selected.first && candidate.second < selected.second))
    )
}

function referenceRemovalCoverRegions(frames, limit) {
  let regions = []
  for (const frame of frames) {
    if (regions.length < limit) {
      referenceAppendMergedFrame(regions, { ...frame })
      continue
    }
    if (regions.some(region => referenceFramesTouchOrOverlap(frame, region))) {
      referenceAppendMergedFrame(regions, { ...frame })
      continue
    }
    const candidates = [...regions, frame]
    let selected = null
    for (let first = 0; first < candidates.length - 1; first += 1) {
      for (let second = first + 1; second < candidates.length; second += 1) {
        const score = referencePairScore(candidates[first], candidates[second], first, second)
        if (referencePairScoreIsLower(score, selected)) selected = score
      }
    }
    let changedSecond = -1
    if (selected.second === regions.length) {
      regions[selected.first] = referenceFrameUnion(regions[selected.first], frame)
    } else {
      changedSecond = selected.second
      regions[selected.first] = referenceFrameUnion(regions[selected.first], regions[selected.second])
      regions[selected.second] = { ...frame }
    }
    if (referenceChangedFramesTouch(regions, selected.first, changedSecond)) {
      regions = referenceMergeTouchingFrames(regions)
    }
  }
  return regions.sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h)
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

test('editor LOD render generations are strictly positive integers', () => {
  for (const value of [null, undefined, '', false, Number.NaN, 0, -1, 1.5]) {
    assert.equal(parseRenderGeneration(value), null)
  }

  assert.equal(parseRenderGeneration(1), 1)
  assert.equal(parseRenderGeneration(42), 42)
})

test('editor LOD only exposes a complete fallback below an intersecting stale detail region', () => {
  const detailBounds = { x: 100, y: 100, w: 400, h: 300 }
  const intersectingCover = { x: 200, y: 150, w: 80, h: 60 }
  const outsideCover = { x: 700, y: 700, w: 80, h: 60 }

  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'canvas',
    geometryCommitted: false
  }), false)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'bounds',
    geometryCommitted: true
  }), false)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: outsideCover,
    geometryMode: 'canvas',
    geometryCommitted: true
  }), false)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'canvas',
    geometryCommitted: true
  }), true)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'canvas',
    geometryCommitted: true,
    geometryFailed: true
  }), false)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    removalCoverBounds: intersectingCover,
    removalFallbackCommitted: true
  }), true)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'canvas',
    geometryCommitted: true,
    removalCoverBounds: intersectingCover,
    removalFallbackCommitted: false
  }), true)
  assert.equal(shouldUseEditorLodDetailFallback({
    detailBounds,
    geometryCoverBounds: intersectingCover,
    geometryMode: 'canvas',
    geometryCommitted: true,
    removalCoverBounds: outsideCover,
    removalFallbackCommitted: false
  }), true)
})

test('editor LOD fallback regions clip reliable covers to the committed detail frame', () => {
  const detailBounds = { x: 100, y: 200, w: 400, h: 300 }
  const partialCover = { x: 80, y: 190, w: 60, h: 50 }
  const outsideCover = { x: 0, y: 0, w: 20, h: 20 }

  assert.deepEqual(editorLodDetailFallbackRegions({
    detailBounds,
    geometryCoverBounds: partialCover,
    geometryMode: 'canvas',
    geometryCommitted: true
  }), [{ x: 100, y: 200, w: 40, h: 40 }])
  assert.deepEqual(editorLodDetailFallbackRegions({
    detailBounds,
    geometryCoverBounds: outsideCover,
    geometryMode: 'canvas',
    geometryCommitted: true
  }), [])
  assert.deepEqual(editorLodDetailFallbackRegions({
    detailBounds,
    geometryCoverBounds: { x: 500, y: 250, w: 20, h: 20 },
    geometryMode: 'canvas',
    geometryCommitted: true
  }), [], 'edge contact is not a positive-area intersection')
})

test('editor LOD fallback regions evaluate geometry and removal reliability independently', () => {
  const detailBounds = { x: 0, y: 0, w: 300, h: 200 }
  const geometryCoverBounds = { x: 20, y: 30, w: 40, h: 50 }
  const removalCoverBounds = { x: 220, y: 130, w: 40, h: 50 }

  for (const overrides of [
    { geometryMode: 'bounds', geometryCommitted: true },
    { geometryMode: 'canvas', geometryCommitted: false },
    { geometryMode: 'canvas', geometryCommitted: true, geometryFailed: true }
  ]) {
    assert.deepEqual(editorLodDetailFallbackRegions({
      detailBounds,
      geometryCoverBounds,
      ...overrides
    }), [])
  }

  for (const overrides of [
    { removalFallbackCommitted: false },
    { removalFallbackCommitted: true, removalFailed: true }
  ]) {
    assert.deepEqual(editorLodDetailFallbackRegions({
      detailBounds,
      removalCoverBounds,
      ...overrides
    }), [])
  }

  assert.deepEqual(editorLodDetailFallbackRegions({
    detailBounds,
    geometryCoverBounds,
    geometryMode: 'canvas',
    geometryCommitted: true,
    removalCoverBounds,
    removalFallbackCommitted: false
  }), [geometryCoverBounds])
  assert.deepEqual(editorLodDetailFallbackRegions({
    detailBounds,
    geometryCoverBounds,
    geometryMode: 'bounds',
    geometryCommitted: false,
    removalCoverBounds,
    removalFallbackCommitted: true
  }), [removalCoverBounds])
})

test('editor LOD fallback regions merge touching covers but preserve separated holes', () => {
  const regions = editorLodDetailFallbackRegions({
    detailBounds: { x: 0, y: 0, w: 300, h: 200 },
    geometryCoverBounds: [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 25, y: 15, w: 25, h: 20 },
      { x: 50, y: 20, w: 20, h: 20 }
    ],
    geometryMode: 'canvas',
    geometryCommitted: true,
    removalCoverBounds: [
      { x: 200, y: 100, w: 20, h: 20 },
      { x: 220, y: 120, w: 20, h: 20 }
    ],
    removalFallbackCommitted: true
  })

  assert.deepEqual(regions, [
    { x: 10, y: 10, w: 60, h: 30 },
    { x: 200, y: 100, w: 40, h: 40 }
  ])
})

test('editor LOD removal covers keep distant frames separate and merge only touching padded frames', () => {
  const regions = editorLodRemovalCoverRegions({
    previous: [{ x: 10, y: 10, w: 10, h: 10 }],
    frames: [
      { x: 40, y: 10, w: 10, h: 10 },
      { x: 49, y: 10, w: 10, h: 10 },
      { x: -8, y: 80, w: 10, h: 10 }
    ],
    padding: 2,
    bounds: { x: 0, y: 0, w: 100, h: 100 }
  })

  assert.deepEqual(regions, [
    { x: 0, y: 78, w: 4, h: 14 },
    { x: 10, y: 10, w: 10, h: 10 },
    { x: 38, y: 8, w: 23, h: 14 }
  ])
})

test('editor LOD removal covers coalesce the minimum-extra-area pair without dropping coverage', () => {
  const frames = Array.from({ length: EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS + 1 }, (_, index) => ({
    x: index < 2 ? index * 20 : 100 + index * 100,
    y: 0,
    w: 10,
    h: 10
  }))
  const regions = editorLodRemovalCoverRegions({ frames })

  assert.equal(EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS, 32)
  assert.equal(regions.length, EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)
  assert.deepEqual(regions[0], { x: 0, y: 0, w: 30, h: 10 })
  for (const frame of frames) {
    assert.ok(regions.some(region => (
      region.x <= frame.x
      && region.y <= frame.y
      && region.x + region.w >= frame.x + frame.w
      && region.y + region.h >= frame.y + frame.h
    )), `expected a retained cover for x=${frame.x}`)
  }
})

test('editor LOD removal cover compaction stays bounded for 6000 dispersed frames', () => {
  const frames = Array.from({ length: 6000 }, (_, index) => ({
    x: index * 100,
    y: (index % 17) * 1000,
    w: 10,
    h: 10
  }))
  editorLodRemovalCoverRegions({ frames })

  let bestElapsedMs = Infinity
  let regions = []
  for (let sample = 0; sample < 3; sample += 1) {
    const startedAt = performance.now()
    regions = editorLodRemovalCoverRegions({ frames })
    bestElapsedMs = Math.min(bestElapsedMs, performance.now() - startedAt)
  }

  assert.equal(regions.length, EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)
  assert.ok(bestElapsedMs < 50, `expected 6000 removal frames under 50ms, received ${bestElapsedMs.toFixed(2)}ms`)
})

test('editor LOD removal cover cache matches an uncached reference across randomized sequences', () => {
  const random = seededRandom(0x2d1d0d)
  for (let sample = 0; sample < 300; sample += 1) {
    const limit = 2 + Math.floor(random() * 7)
    const frames = Array.from({ length: 40 + Math.floor(random() * 60) }, () => ({
      x: Math.floor(random() * 30) * 5,
      y: Math.floor(random() * 20) * 5,
      w: (1 + Math.floor(random() * 4)) * 5,
      h: (1 + Math.floor(random() * 4)) * 5
    }))
    assert.deepEqual(
      editorLodRemovalCoverRegions({ frames, limit }),
      referenceRemovalCoverRegions(frames, limit),
      `cached compaction diverged for sample ${sample}`
    )
  }
})

test('editor LOD touching cover compaction preserves legacy tie ordering', () => {
  const frames = [
    { x: 70, y: 45, w: 15, h: 15 },
    { x: 0, y: 0, w: 10, h: 5 },
    { x: 50, y: 55, w: 10, h: 10 },
    { x: 15, y: 0, w: 15, h: 15 },
    { x: 65, y: 40, w: 10, h: 5 },
    { x: 25, y: 20, w: 10, h: 5 },
    { x: 70, y: 50, w: 15, h: 5 },
    { x: 50, y: 55, w: 10, h: 15 },
    { x: 50, y: 20, w: 5, h: 15 },
    { x: 10, y: 10, w: 10, h: 15 }
  ]

  assert.deepEqual(
    editorLodRemovalCoverRegions({ frames, limit: 3 }),
    referenceRemovalCoverRegions(frames, 3)
  )
})

test('editor LOD contained touching covers migrate to preserve deterministic tie ordering', () => {
  const frames = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 0, w: 10, h: 10 },
    { x: 40, y: 0, w: 10, h: 10 },
    { x: 2, y: 2, w: 2, h: 2 },
    { x: 60, y: 0, w: 10, h: 10 }
  ]

  const regions = editorLodRemovalCoverRegions({ frames, limit: 3 })

  assert.deepEqual(regions, referenceRemovalCoverRegions(frames, 3))
  assert.deepEqual(regions, [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 0, w: 30, h: 10 },
    { x: 60, y: 0, w: 10, h: 10 }
  ], 'the contained fourth frame moves the first region behind the other tie candidates')
})

test('editor LOD removal cover bridge/add churn stays bounded for 6033 frames', () => {
  const frames = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 110, y: 0, w: 10, h: 10 },
    { x: 220, y: 0, w: 10, h: 10 },
    ...Array.from({ length: EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS - 3 }, (_, index) => ({
      x: 0,
      y: (index + 1) * 10000,
      w: 10,
      h: 10
    })),
    { x: 1_000_000_000, y: 0, w: 10, h: 10 }
  ]
  let anchorRight = 120
  for (let cycle = 0; cycle < 3000; cycle += 1) {
    frames.push({ x: anchorRight, y: 0, w: 100, h: 10 })
    anchorRight += 110
    frames.push({ x: anchorRight + 100, y: 0, w: 10, h: 10 })
  }
  assert.equal(frames.length, 6033)
  editorLodRemovalCoverRegions({ frames })

  let bestElapsedMs = Infinity
  let regions = []
  for (let sample = 0; sample < 3; sample += 1) {
    const startedAt = performance.now()
    regions = editorLodRemovalCoverRegions({ frames })
    bestElapsedMs = Math.min(bestElapsedMs, performance.now() - startedAt)
  }

  assert.equal(regions.length, EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)
  assert.ok(bestElapsedMs < 50, `expected 6033 bridge/add frames under 50ms, received ${bestElapsedMs.toFixed(2)}ms`)
})

test('editor LOD removal cover updates stay bounded for 6000 touching frames at the region cap', () => {
  const frames = Array.from({ length: 6000 }, (_, index) => {
    const cluster = index % EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS
    const step = Math.floor(index / EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)
    return { x: cluster * 10000 + step, y: cluster * 1000, w: 10, h: 10 }
  })
  editorLodRemovalCoverRegions({ frames })

  let bestElapsedMs = Infinity
  let regions = []
  for (let sample = 0; sample < 3; sample += 1) {
    const startedAt = performance.now()
    regions = editorLodRemovalCoverRegions({ frames })
    bestElapsedMs = Math.min(bestElapsedMs, performance.now() - startedAt)
  }

  assert.equal(regions.length, EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS)
  assert.ok(bestElapsedMs < 50, `expected 6000 touching removal frames under 50ms, received ${bestElapsedMs.toFixed(2)}ms`)
})

test('editor LOD detail clip path uses broadly supported nonzero winding with conservative rounding', () => {
  const clipPath = editorLodDetailClipPath({
    detailBounds: { x: 100, y: 50, w: 200, h: 100 },
    frameWidth: 300,
    frameHeight: 200,
    regions: [
      { x: 110.2, y: 55.2, w: 10.1, h: 5.1 },
      { x: 200, y: 100, w: 20, h: 10 }
    ]
  })

  assert.equal(clipPath, 'polygon(0px 0px, 300px 0px, 300px 200px, 0px 200px, 0px 0px, 15px 10px, 15px 21px, 31px 21px, 31px 10px, 15px 10px, 0px 0px, 150px 100px, 150px 120px, 180px 120px, 180px 100px, 150px 100px, 0px 0px)')
  assert.doesNotMatch(clipPath, /evenodd/)
  assert.equal(editorLodDetailClipPath({
    detailBounds: { x: 0, y: 0, w: 100, h: 100 },
    frameWidth: 200,
    frameHeight: 200,
    regions: []
  }), 'none')
})

test('editor LOD hides active DOM geometry when either visible Canvas layer committed it', () => {
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'canvas',
    fallbackCommitted: true
  }), true)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'canvas',
    fallbackCommitted: true,
    fallbackVisible: false
  }), false, 'a covered fallback cannot replace the active DOM geometry')
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'canvas',
    fallbackCommitted: true,
    fallbackFailed: true,
    detailVisible: true,
    detailPatchActive: true,
    detailCommitted: true
  }), true)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'canvas',
    fallbackCommitted: true,
    detailVisible: true,
    detailPatchActive: true,
    detailCommitted: true,
    detailFailed: true
  }), true)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'dom',
    fallbackCommitted: false,
    detailVisible: true,
    detailPatchActive: true,
    detailCommitted: true
  }), true)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'dom',
    detailVisible: false,
    detailPatchActive: true,
    detailCommitted: true
  }), false)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'dom',
    detailVisible: true,
    detailPatchActive: true,
    detailCommitted: true,
    detailFailed: true
  }), false)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'bounds',
    fallbackCommitted: false,
    detailVisible: true,
    detailPatchActive: false,
    detailCommitted: false
  }), false)
  assert.equal(shouldHideEditorLodGeometryDom({
    fallbackMode: 'canvas',
    fallbackCommitted: true,
    fallbackFailed: true
  }), false)
})

test('editor LOD generation completion accepts the target or a newer generation', () => {
  const session = {
    sessionId: 7,
    state: 'awaiting-full',
    revision: 0.5,
    targetFullGeneration: 14,
    detailCompletionRequired: false
  }

  assert.equal(editorLodFallbackGeometryCompletesSession(session, {
    sessionId: 7,
    renderGeneration: 13,
    geometryRevision: 0.5
  }), false)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, {
    sessionId: 7,
    renderGeneration: 14,
    geometryRevision: 0.5
  }), true)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, {
    sessionId: 7,
    renderGeneration: 15,
    geometryRevision: 0.5
  }), true)

  assert.equal(editorLodFallbackGeometryCompletesSession({ ...session, revision: 0 }, {
    sessionId: 7,
    renderGeneration: 14,
    geometryRevision: 0
  }), true)
})

test('editor LOD cover waits for both fallback and the targeted detail generation', () => {
  const initial = {
    sessionId: 7,
    state: 'awaiting-full',
    revision: 18,
    targetFullGeneration: 8,
    detailSessionId: 9,
    detailCoverBounds: { x: 10, y: 20, w: 30, h: 40 },
    detailTargetGeneration: 12,
    detailCompletionRequired: true,
    fallbackComplete: false,
    detailComplete: false
  }

  assert.equal(editorLodDetailRenderCompletesSession(initial, {
    geometrySessionId: 9,
    renderGeneration: 11,
    geometryRevision: 18
  }), false)
  assert.equal(editorLodDetailRenderCompletesSession(initial, {
    geometrySessionId: 9,
    renderGeneration: 12,
    geometryRevision: 18
  }), true)

  const fallbackFirst = markEditorLodGeometryLayerComplete(initial, 'fallback')
  assert.equal(fallbackFirst.settled, false)
  assert.equal(markEditorLodGeometryLayerComplete(fallbackFirst.session, 'detail').settled, true)

  const detailFirst = markEditorLodGeometryLayerComplete(initial, 'detail')
  assert.equal(detailFirst.settled, false)
  assert.equal(markEditorLodGeometryLayerComplete(detailFirst.session, 'fallback').settled, true)
})

test('editor LOD detail session rejects an old or unrelated completion event', () => {
  const session = {
    sessionId: 3,
    state: 'awaiting-full',
    revision: 31,
    detailSessionId: 9,
    detailTargetGeneration: 22,
    detailCompletionRequired: true,
    fallbackComplete: true,
    detailComplete: false
  }
  assert.equal(editorLodDetailRenderCompletesSession(session, { geometrySessionId: 8, renderGeneration: 22, geometryRevision: 31 }), false)
  assert.equal(editorLodDetailRenderCompletesSession(session, { geometrySessionId: 9, renderGeneration: 21, geometryRevision: 31 }), false)
  assert.equal(editorLodDetailRenderCompletesSession(session, { geometrySessionId: 9, renderGeneration: 22, geometryRevision: 30 }), false)
  assert.equal(editorLodDetailRenderCompletesSession(session, { geometrySessionId: 9, renderGeneration: 22, geometryRevision: 31 }), true)
  assert.equal(editorLodDetailGeometryCompletesSession({ ...session, state: 'active' }, { sessionId: 9, renderGeneration: 22, geometryRevision: 31 }), false)
  assert.equal(editorLodDetailGeometryCompletesSession(session, { sessionId: 9, renderGeneration: 21, geometryRevision: 31 }), false)
  assert.equal(editorLodDetailGeometryCompletesSession(session, { sessionId: 9, renderGeneration: 22, geometryRevision: 30 }), false)
  assert.equal(editorLodDetailGeometryCompletesSession(session, { sessionId: 9, renderGeneration: 22, geometryRevision: 31 }), true)
})

test('editor LOD fallback acknowledgement requires the current session, generation, and revision', () => {
  const session = {
    sessionId: 7,
    state: 'awaiting-full',
    revision: 31,
    targetFullGeneration: 14,
    fallbackComplete: false,
    detailCompletionRequired: false
  }

  assert.equal(editorLodFallbackGeometryCompletesSession({ ...session, state: 'active' }, { sessionId: 7, renderGeneration: 14, geometryRevision: 31 }), false)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, { sessionId: 6, renderGeneration: 14, geometryRevision: 31 }), false)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, { sessionId: 7, renderGeneration: 13, geometryRevision: 31 }), false)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, { sessionId: 7, renderGeneration: 14, geometryRevision: 30 }), false)
  assert.equal(editorLodFallbackGeometryCompletesSession(session, { sessionId: 7, renderGeneration: 14, geometryRevision: 31 }), true)
})

test('editor LOD completion rejects missing target pointers', () => {
  const session = {
    sessionId: 7,
    state: 'awaiting-full',
    revision: 31,
    targetFullGeneration: null,
    detailSessionId: 9,
    detailTargetGeneration: null,
    detailCompletionRequired: true
  }
  const fallbackEvent = { sessionId: 7, renderGeneration: 14, geometryRevision: 31 }
  const detailEvent = { sessionId: 9, renderGeneration: 22, geometryRevision: 31 }

  assert.equal(editorLodFallbackGeometryCompletesSession(session, fallbackEvent), false)
  assert.equal(editorLodDetailGeometryCompletesSession(session, detailEvent), false)
})

test('editor LOD fallback settles immediately when no visible detail frame is pending', () => {
  const completion = markEditorLodGeometryLayerComplete({
    sessionId: 1,
    state: 'awaiting-full',
    detailSessionId: null,
    detailCoverBounds: null,
    detailTargetGeneration: null,
    detailCompletionRequired: false
  }, 'fallback')
  assert.equal(completion.settled, true)
})

test('editor LOD detail errors preserve the cover and wait for fallback acknowledgement', () => {
  const cover = { x: 10, y: 20, w: 30, h: 40 }
  const session = {
    sessionId: 7,
    state: 'awaiting-full',
    revision: 18,
    targetFullGeneration: 8,
    detailSessionId: 9,
    detailTargetGeneration: 12,
    detailCompletionRequired: true,
    detailCoverBounds: cover,
    fallbackComplete: false,
    detailComplete: false
  }

  const failed = markEditorLodGeometryLayerFailed(session, 'detail')
  assert.equal(failed.settled, false)
  assert.equal(failed.session.detailComplete, true)
  assert.equal(failed.session.detailFailed, true)
  assert.equal(failed.session.detailRecoveryPending, true)
  assert.equal(failed.session.detailCoverBounds, cover)
  assert.equal(editorLodGeometryBarrierSettled(failed.session), false)

  const fallbackComplete = markEditorLodGeometryLayerComplete(failed.session, 'fallback')
  assert.equal(fallbackComplete.settled, true)
  assert.equal(fallbackComplete.session.detailCoverBounds, cover)

  const fallbackFirst = markEditorLodGeometryLayerComplete(session, 'fallback')
  assert.equal(markEditorLodGeometryLayerFailed(fallbackFirst.session, 'detail').settled, true)
})

test('editor LOD errors cannot settle an interaction before it awaits full frames', () => {
  const active = {
    sessionId: 7,
    state: 'active',
    detailCompletionRequired: true,
    fallbackComplete: true,
    detailComplete: false,
    detailCoverBounds: { x: 1, y: 2, w: 3, h: 4 }
  }

  const failed = markEditorLodGeometryLayerFailed(active, 'detail')
  assert.equal(failed.session.detailComplete, true)
  assert.equal(failed.settled, false)
  assert.equal(editorLodGeometryBarrierSettled(failed.session), false)
})

test('editor LOD raises only undersized Canvas text within its component height', () => {
  const scale = 0.3836277859791702 * (1 / 1.1 ** 8)
  const raised = readableCanvasFontSize({
    requestedSize: 20,
    minimumScreenSize: EDITOR_LOD_MIN_TEXT_SCREEN_SIZE,
    scaleY: scale,
    layoutHeight: 50,
    heightRatio: .9
  })
  const alreadyReadable = readableCanvasFontSize({
    requestedSize: 43,
    minimumScreenSize: EDITOR_LOD_MIN_TEXT_SCREEN_SIZE,
    scaleY: .2,
    layoutHeight: 60,
    heightRatio: .9
  })
  const constrained = readableCanvasFontSize({
    requestedSize: 20,
    minimumScreenSize: EDITOR_LOD_MIN_TEXT_SCREEN_SIZE,
    scaleY: .1,
    layoutHeight: 30,
    heightRatio: .9
  })

  assert.ok(Math.abs(raised * scale - EDITOR_LOD_MIN_TEXT_SCREEN_SIZE) < 1e-9)
  assert.equal(alreadyReadable, 43)
  assert.equal(constrained, 27)
  assert.equal(readableCanvasFontSize({ requestedSize: 20, minimumScreenSize: 0 }), 20)
})

test('editor LOD readable text cannot turn one baseline line into clipped extra lines', () => {
  const requestedSize = 23
  const readableSize = 34.666666666666664
  const layoutWidth = 291.47026169547007
  const baselineWidth = 219.21
  const constrained = layoutConstrainedCanvasFontSize({
    requestedSize,
    readableSize,
    layoutWidth,
    layoutHeight: 50,
    contentWidth: baselineWidth,
    contentHeight: requestedSize
  })

  assert.ok(constrained < readableSize)
  assert.ok(Math.abs(constrained - requestedSize * layoutWidth / baselineWidth) < 1e-9)
  assert.ok(baselineWidth * constrained / requestedSize <= layoutWidth + 1e-9)
})

test('editor LOD layout constraint preserves roomy, multiline, and legacy overflow text', () => {
  assert.equal(layoutConstrainedCanvasFontSize({
    requestedSize: 20,
    readableSize: 35,
    layoutWidth: 200,
    layoutHeight: 80,
    contentWidth: 100,
    contentHeight: 20
  }), 35)
  assert.equal(layoutConstrainedCanvasFontSize({
    requestedSize: 20,
    readableSize: 35,
    layoutWidth: 200,
    layoutHeight: 45,
    contentWidth: 160,
    contentHeight: 40
  }), 22.5)
  assert.equal(layoutConstrainedCanvasFontSize({
    requestedSize: 20,
    readableSize: 35,
    layoutWidth: 100,
    layoutHeight: 20,
    contentWidth: 130,
    contentHeight: 25
  }), 20)
})

test('editor LOD targets 3x detail and preserves at least 2x under the bitmap cap', () => {
  const zoom = 1 / 1.1 ** 8
  const cssWidth = 1820
  const cssHeight = 1233
  const detailWidth = cssWidth / zoom
  const detailHeight = cssHeight / zoom
  const pixelRatio = editorLodDetailPixelRatio(1)
  const budget = editorLodBitmapPixelBudget({
    stageWidth: detailWidth,
    stageHeight: detailHeight,
    zoom,
    devicePixelRatio: 1
  })
  const bitmap = canvasBitmapDimensions({
    width: cssWidth,
    height: cssHeight,
    devicePixelRatio: pixelRatio,
    maximum: budget
  })

  assert.equal(MIN_EDITOR_LOD_DETAIL_PIXEL_RATIO, 3)
  assert.equal(pixelRatio, 3)
  assert.ok(bitmap.pixelRatioX >= 2)
  assert.ok(bitmap.pixelRatioY >= 2)
  assert.ok(bitmap.bitmapWidth * bitmap.bitmapHeight <= MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS)
  assert.ok(MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS >= Math.ceil(cssWidth * 2) * Math.ceil(cssHeight * 2))
  assert.equal(EDITOR_LOD_FALLBACK_BITMAP_PIXELS, 1_048_576)
  assert.equal(editorLodBitmapPixelBudget({ stageWidth: 20_000, stageHeight: 20_000, zoom: 1, devicePixelRatio: 3 }), MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS)
  assert.equal(editorLodBitmapPixelBudget({ zoom: 0 }), MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS)

  const compactHeight = 560
  const compactBudget = editorLodBitmapPixelBudget({
    stageWidth: detailWidth,
    stageHeight: compactHeight / zoom,
    zoom,
    devicePixelRatio: 1
  })
  const compactBitmap = canvasBitmapDimensions({
    width: cssWidth,
    height: compactHeight,
    devicePixelRatio: pixelRatio,
    maximum: compactBudget
  })
  assert.ok(compactBitmap.pixelRatioX >= 3)
  assert.ok(compactBitmap.pixelRatioY >= 3)
})

test('editor LOD trims hidden overscan before reducing the visible 3x detail ratio', () => {
  const viewportWidth = 1628
  const viewportHeight = 650
  const pixelRatio = 3
  const overscan = editorLodDetailOverscanPixels({
    viewportWidth,
    viewportHeight,
    pixelRatio,
    preferredOverscan: 192
  })
  const bitmapWidth = Math.ceil((viewportWidth + overscan * 2) * pixelRatio)
  const bitmapHeight = Math.ceil((viewportHeight + overscan * 2) * pixelRatio)

  assert.ok(overscan > 0 && overscan < 192)
  assert.ok(bitmapWidth * bitmapHeight <= MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS)
})

test('editor LOD thins only the visual grid at low zoom', () => {
  const atFortySevenPercent = editorLodGridPresentation({ gridSize: 10, zoom: 1 / 1.1 ** 8 })
  const atTwentyPercent = editorLodGridPresentation({ gridSize: 10, zoom: .2 })
  const atNativeScale = editorLodGridPresentation({ gridSize: 10, zoom: 1 })

  assert.equal(atFortySevenPercent.stepMultiplier, 2)
  assert.ok(atFortySevenPercent.screenPitch >= MIN_EDITOR_LOD_GRID_SCREEN_PITCH)
  assert.equal(atTwentyPercent.stepMultiplier, 4)
  assert.equal(atTwentyPercent.screenPitch, 8)
  assert.equal(atTwentyPercent.stroke, MIN_EDITOR_LOD_GRID_SCREEN_STROKE)
  assert.ok(atTwentyPercent.dotSize >= 1)
  assert.equal(atNativeScale.stepMultiplier, 1)
  assert.equal(atNativeScale.worldStep, 10)
})

test('stale editor detail projects the current grid pitch and weight without densifying it', () => {
  const frameZoom = 1 / 1.1 ** 8
  const currentZoom = .2
  const projectionScale = currentZoom / frameZoom
  const grid = editorLodGridPresentation({ gridSize: 10, zoom: currentZoom })
  const internalPitch = grid.worldStep * frameZoom
  const internalStroke = grid.stroke / projectionScale
  const internalDotSize = grid.dotSize / projectionScale

  assert.ok(Math.abs(internalPitch * projectionScale - grid.screenPitch) < 1e-9)
  assert.ok(internalPitch * projectionScale >= MIN_EDITOR_LOD_GRID_SCREEN_PITCH)
  assert.ok(internalStroke * projectionScale >= MIN_EDITOR_LOD_GRID_SCREEN_STROKE)
  assert.ok(internalDotSize * projectionScale >= 1)
})

test('editor LOD activates from document size and zoom without a visible-node scan', () => {
  assert.equal(shouldUseEditorLod(1199, 0.2), false)
  assert.equal(shouldUseEditorLod(1200, 0.3), true)
  assert.equal(shouldUseEditorLod(6000, 0.31), false)
})

test('rotated node hit testing matches the DOM shell footprint', () => {
  const node = { x: 100, y: 100, w: 100, h: 20, rotate: 90 }
  assert.equal(pointHitsRotatedNode(node, { x: 150, y: 60 }), true)
  assert.equal(pointHitsRotatedNode(node, { x: 105, y: 105 }), false)
  assert.equal(pointHitsRotatedNode(node, { x: 105, y: 105 }, 40), true)
})

test('LOD hit testing resolves nodes and drawings by top layer', () => {
  const lowNode = { id: 'low', x: 0, y: 0, w: 100, h: 100, layer: 2 }
  const highNode = { id: 'high', x: 20, y: 20, w: 100, h: 100, layer: 4 }
  const drawing = { id: 'line', points: [{ x: 0, y: 50 }, { x: 120, y: 50 }], width: 2, layer: 3 }
  assert.equal(pickTopEditorEntity([lowNode, highNode], [drawing], { x: 50, y: 50 })?.entity.id, 'high')
  drawing.layer = 5
  assert.equal(pickTopEditorEntity([lowNode, highNode], [drawing], { x: 50, y: 50 })?.entity.id, 'line')
  assert.equal(pointHitsDrawing({ ...drawing, closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }] }, { x: 50, y: 40 }), true)
})

test('LOD DOM overlay remains bounded for full-document selections', () => {
  const selectedIds = Array.from({ length: 6000 }, (_, index) => `node-${index}`)
  const ids = editorLodOverlayNodeIds({
    selectedIds,
    activeIds: selectedIds,
    primaryId: 'node-5999',
    anchorId: 'node-3000',
    connectFromId: 'node-20',
    editingTextId: 'node-21'
  })
  assert.deepEqual(ids, ['node-5999', 'node-3000', 'node-20', 'node-21'])
  assert.ok(ids.length <= EDITOR_LOD_MAX_OVERLAY_NODES)

  const smallSelection = editorLodOverlayNodeIds({ selectedIds: ['a', 'b'], primaryId: 'b' })
  assert.deepEqual(new Set(smallSelection), new Set(['a', 'b']))
})

test('LOD edge overlay uses adjacency, stays bounded, and prioritizes the newest edge', () => {
  const edges = Array.from({ length: 800 }, (_, index) => ({ id: `edge-${index}`, from: 'a', to: `n-${index}` }))
  const latestEdge = { id: 'edge-latest', from: 'a', to: 'b' }
  const adjacency = { get: id => id === 'a' ? edges : [] }
  const overlay = editorLodOverlayEdges({ nodeIds: ['a'], adjacency, latestEdge })

  assert.equal(overlay.length, EDITOR_LOD_MAX_OVERLAY_EDGES)
  assert.equal(overlay[0], latestEdge)
  assert.equal(new Set(overlay.map(edge => edge.id)).size, overlay.length)
  assert.deepEqual(editorLodOverlayEdges({ nodeIds: [], adjacency, latestEdge }), [])
})

test('LOD geometry regions clip rotated nodes and split long segments deterministically', () => {
  const rotated = { id: 'rotated', x: 10, y: 20, w: 100, h: 40, rotate: 90, borderWidth: 2 }
  assert.deepEqual(editorLodNodeRegion(rotated, {
    stageWidth: 200,
    stageHeight: 200,
    padding: 2
  }), { x: 28, y: 0, w: 64, h: 102 })

  const options = {
    stageWidth: 1_200,
    stageHeight: 200,
    padding: 10,
    maxSegmentLength: 250
  }
  const expected = [
    { x: 0, y: 10, w: 270, h: 20 },
    { x: 250, y: 10, w: 270, h: 20 },
    { x: 500, y: 10, w: 270, h: 20 },
    { x: 750, y: 10, w: 270, h: 20 }
  ]
  assert.deepEqual(editorLodSegmentRegions({ x: 10, y: 20 }, { x: 1_010, y: 20 }, options), expected)
  assert.deepEqual(editorLodSegmentRegions({ x: 10, y: 20 }, { x: 1_010, y: 20 }, options), expected)
})

test('LOD edge regions share endpoint geometry and index segments have stable owner ids', () => {
  const nodeIndex = new Map([
    ['source', { id: 'source', x: 100, y: 100, w: 80, h: 40, rotate: 0 }],
    ['target', { id: 'target', x: 700, y: 100, w: 80, h: 40, rotate: 0 }]
  ])
  const edge = {
    id: 'edge-1',
    from: 'source',
    to: 'target',
    anchorMode: 'center',
    width: 4
  }
  const options = { stageWidth: 1_000, stageHeight: 300, padding: 0, maxSegmentLength: 200 }
  const expected = [
    { x: 126, y: 106, w: 228, h: 28 },
    { x: 326, y: 106, w: 228, h: 28 },
    { x: 526, y: 106, w: 228, h: 28 }
  ]

  assert.deepEqual(editorLodEdgeRegions(edge, nodeIndex, options), expected)
  const indexed = editorLodIndexSegments('edge', edge, nodeIndex, options)
  assert.deepEqual(indexed.map(item => item.id), ['edge:edge-1:0', 'edge:edge-1:1', 'edge:edge-1:2'])
  assert.deepEqual(indexed.map(item => item.order), [0, 1, 2])
  assert.ok(indexed.every(item => item.owner === edge && item.ownerId === edge.id))
  assert.deepEqual(editorLodEdgeRegions({ ...edge, to: 'missing' }, nodeIndex, options), [])
})

test('LOD drawing regions enforce segment budgets without returning partial open paths', () => {
  const shortDrawing = {
    id: 'drawing-short',
    width: 2,
    points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }]
  }
  const options = {
    stageWidth: 200,
    stageHeight: 200,
    padding: 0,
    maxSegmentLength: 100,
    maxSegments: 2
  }
  const shortResult = editorLodDrawingRegions(shortDrawing, options)
  assert.equal(shortResult.truncated, false)
  assert.equal(shortResult.regions.length, 2)

  const tooManyPoints = {
    ...shortDrawing,
    id: 'drawing-points',
    points: [{ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 40, y: 10 }, { x: 60, y: 10 }]
  }
  assert.deepEqual(editorLodDrawingRegions(tooManyPoints, options), { regions: [], truncated: true })

  const longSegment = {
    ...shortDrawing,
    id: 'drawing-long',
    points: [{ x: 0, y: 20 }, { x: 500, y: 20 }]
  }
  assert.deepEqual(editorLodDrawingRegions(longSegment, options), { regions: [], truncated: true })
  assert.deepEqual(editorLodIndexSegments('drawing', longSegment, null, options), [])

  const closedOverflow = {
    ...shortDrawing,
    id: 'drawing-closed',
    closed: true,
    points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }]
  }
  assert.deepEqual(editorLodDrawingRegions(closedOverflow, options), { regions: [], truncated: true })
})

test('closed LOD drawings dirty their filled interior instead of only their outline', () => {
  assert.deepEqual(editorLodDrawingRegions({
    id: 'filled',
    closed: true,
    width: 4,
    points: [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 100 }, { x: 20, y: 100 }]
  }, { stageWidth: 240, stageHeight: 140, padding: 0 }), {
    regions: [{ x: 8, y: 8, w: 184, h: 104 }],
    truncated: false
  })
})

test('LOD geometry region merging is stable and fails closed at its region cap', () => {
  const source = [
    { x: 10, y: 10, w: 20, h: 20 },
    { x: 40, y: 40, w: 20, h: 20 },
    { x: 150, y: 10, w: 20, h: 20 }
  ]
  const expected = {
    regions: [
      { x: 10, y: 10, w: 50, h: 50 },
      { x: 150, y: 10, w: 20, h: 20 }
    ],
    truncated: false
  }
  assert.deepEqual(mergeEditorLodGeometryRegions(source, { cellSize: 100, maxRegions: 2 }), expected)
  assert.deepEqual(mergeEditorLodGeometryRegions(source, { cellSize: 100, maxRegions: 2 }), expected)
  assert.deepEqual(mergeEditorLodGeometryRegions(source, { cellSize: 100, maxRegions: 1 }), {
    regions: [],
    truncated: true
  })

  const combined = editorLodGeometryRegions({
    nodes: [{ id: 'node', x: 10, y: 10, w: 20, h: 20 }],
    drawings: [{ id: 'drawing', points: [{ x: 120, y: 20 }, { x: 180, y: 20 }], width: 2 }],
    stageWidth: 240,
    stageHeight: 120,
    padding: 0,
    cellSize: 64,
    maxRegions: 8,
    maxSegments: 8
  })
  assert.equal(combined.truncated, false)
  assert.equal(combined.regions.length, 2)
})

test('LOD geometry applies the total segment budget to node and edge-only batches', () => {
  const result = editorLodGeometryRegions({
    nodes: [
      { id: 'node-a', x: 10, y: 10, w: 20, h: 20 },
      { id: 'node-b', x: 180, y: 10, w: 20, h: 20 }
    ],
    stageWidth: 240,
    stageHeight: 120,
    padding: 0,
    cellSize: 32,
    maxRegions: 8,
    maxSegments: 1
  })
  assert.deepEqual(result, { regions: [], truncated: true })
})

test('App routes low-zoom Canvas pointer actions through existing editor handlers', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')
  assert.match(source, /const editorDenseLodActive = computed\(\(\) => \{[\s\S]*?nodeSpatialIndex\.query\(bounds, \{ sort: false, limit: EDITOR_DOM_NODE_LIMIT \+ 1 \}\)\.length > EDITOR_DOM_NODE_LIMIT/)
  assert.match(source, /const editorFullLodActive = computed\(\(\) => shouldUseEditorLod\(nodes\.value\.length, zoom\.value\) \|\| editorDenseLodActive\.value\)/)
  assert.match(source, /const editorDenseEdgeLodActive = computed\(\(\) => \{[\s\S]*?edges\.value\.length <= EDITOR_DOM_EDGE_LIMIT[\s\S]*?edgeSpatialIndex\.query\(bounds, \{ sort: false, limit: EDITOR_DOM_EDGE_LIMIT \+ 1 \}\)\.length > EDITOR_DOM_EDGE_LIMIT/)
  assert.match(source, /const editorEdgeOnlyLodActive = computed\(\(\) => !editorFullLodActive\.value && editorDenseEdgeLodActive\.value\)/)
  assert.match(source, /const editorPersistentLodActive = computed\(\(\) => editorFullLodActive\.value\)/)
  assert.match(source, /const editorLodActive = computed\(\(\) => editorFullLodActive\.value \|\| editorEdgeOnlyLodActive\.value \|\| editorProgressiveDomActive\.value\)/)
  assert.match(source, /const editorLodCanvasRendersEntities = computed\(\(\) => !editorEdgeOnlyLodActive\.value \|\| editorProgressiveDomActive\.value\)/)
  assert.match(source, /const editorRenderPaused = computed\(\(\) => showPreview\.value\)/)
  assert.match(source, /v-if="editorLodActive" v-show="!editorRenderPaused"[^>]+class="editor-lod-surface"[\s\S]*?<MiniMapPreview[^>]+render-mode="frame"/)
  assert.match(source, /<MiniMapPreview[^>]+geometry-interactive[^>]+@geometry-complete="handleEditorLodGeometryComplete"/)
  assert.match(source, /if \(editorRenderPaused\.value\) return \[\][\s\S]*?if \(!editorLodActive\.value \|\| !editorLodCanvasRendersEntities\.value\) return visibleNodes\.value/)
  const edgeOverlay = source.match(/const editorLodEdgeEntries = computed\([\s\S]*?(?=\nconst renderedEdgeEntries)/)?.[0] || ''
  assert.match(edgeOverlay, /const nodeIds = new Set\(editorLodOverlayIds\.value\)/)
  assert.match(edgeOverlay, /editorLodCanvasRendersEntities\.value && !editorLodCanvasReady\.value[\s\S]*?editorLodBootstrapNodeIds\.value[\s\S]*?editorProgressiveDomNodeIds\.value/)
  assert.match(edgeOverlay, /editorLodOverlayEdges\(\{[\s\S]*?nodeIds,[\s\S]*?adjacency: edgeAdjacency\.value,[\s\S]*?latestEdge: edges\.value\.at\(-1\)/)
  assert.doesNotMatch(edgeOverlay, /editorRenderedNodes/)
  assert.match(source, /v-for="entry in renderedEdgeEntries"/)
  assert.match(source, /v-for="n in editorRenderedNodes"/)
  assert.match(source, /<MiniMapPreview ref="editorLodCanvas"[^>]+:render-nodes="editorLodCanvasRendersEntities"[^>]+:render-drawings="editorLodCanvasRendersEntities"/)
  assert.match(source, /<MiniMapPreview ref="editorLodDetailCanvas"[^>]+:render-nodes="editorLodCanvasRendersEntities"[^>]+:render-drawings="editorLodCanvasRendersEntities"/)
  assert.match(source, /nodePointerDown\(e, lodHit\.entity\)/)
  assert.match(source, /handleNodeDoubleClick\(e, hit\.entity\)/)
  assert.match(source, /openContextMenu\(e, hit\.entity\)/)
  assert.match(source, /const hitBounds = \{[\s\S]*?const nodeCandidates = queryNodesInBounds\(hitBounds\)[\s\S]*?const drawingCandidates = drawingsInBounds\(hitBounds\)[\s\S]*?pickTopEditorEntity\(nodeCandidates, drawingCandidates/)
  assert.doesNotMatch(source, /pickTopEditorEntity\([^\n]*drawings\.value/)
  assert.match(source, /appendBounded|editorLodOverlayNodeIds/)
  assert.match(source, /function beginEditorLodGeometry\(op, preparedPayload = null\)[\s\S]*?target\.beginGeometryInteraction\(payload\)/)
  assert.match(source, /function requestEditorLodGeometryFrame\(op\)[\s\S]*?requestGeometryInteractionFrame/)
  assert.match(source, /function finishEditorLodGeometry\(op\)[\s\S]*?finishGeometryInteraction/)
  assert.match(source, /function patchRemovedEditorLodEntities\(payload\)[\s\S]*?editorLodCanvas\.value\?\.patchRemovedEntities[\s\S]*?editorLodDetailCanvas\.value\?\.patchRemovedEntities/)
  assert.match(source, /function deleteSelected\(\)[\s\S]*?patchRemovedEditorLodEntities\(\{[\s\S]*?nodes: removedNodes,[\s\S]*?edges: removedEdges/)
  assert.match(source, /patchRemovedEditorLodEntities\(\{[\s\S]*?drawings: \[drawing\]/)
  assert.match(source, /function applyEntityHistory\(entry\)[\s\S]*?const removedNodes = changes\.nodes\.removed\.map[\s\S]*?patchRemovedEditorLodEntities\(\{[\s\S]*?nodes: removedNodes,[\s\S]*?edges: removedEdges,[\s\S]*?drawings: removedDrawings/)
  assert.match(source, /beginEditorLodGeometry\(op\)[\s\S]*?commitPointerOperation\(op\)[\s\S]*?requestEditorLodGeometryFrame\(op\)/)
  assert.match(source, /v-show="!editorLodGeometryHiddenNodeIds\.has\(n\.id\)"/)
  assert.match(source, /function syncEditorLodGeometryHiddenState\(session, payload = null\)[\s\S]*?shouldHideEditorLodGeometryDom/)
  assert.match(source, /fallbackVisible: !editorLodDetailVisible\.value \|\| EDITOR_LOD_DETAIL_CLIP_SUPPORTED/)
  assert.doesNotMatch(source, /shouldHideEditorLodGeometryDom\(\{[\s\S]{0,300}detailCoverBounds/)
  assert.match(source, /editorLodBootstrapNodeIds[\s\S]*?EDITOR_LOD_BOOTSTRAP_ENTITY_LIMIT/)
  assert.match(styles, /\.canvas\.grid\.grid-line \.stage:not\(\.editor-lod-stage\)/)
  assert.match(styles, /\.canvas\.grid\.grid-dot \.stage:not\(\.editor-lod-stage\)/)
  assert.doesNotMatch(styles, /\.canvas\.grid\.grid-(?:line|dot)\s+\.stage(?:\s*,|\s*\{)/)
  assert.match(source, /class="editor-lod-background"[\s\S]*?<MiniMapPreview[^>]+class="editor-lod-canvas"[^>]+background="transparent"/)
  assert.match(styles, /\.editor-lod-surface > \.editor-lod-background \{[^}]*z-index:\s*0;/)
  assert.match(styles, /\.editor-lod-surface > \.editor-lod-canvas \{[^}]*z-index:\s*1;/)
  assert.match(styles, /\.editor-lod-surface > \.editor-lod-detail-window \{[^}]*z-index:\s*2;/)
  assert.match(styles, /\.editor-lod-detail-window > \.editor-lod-detail-background \{[^}]*z-index:\s*0;/)
  assert.match(styles, /\.editor-lod-detail-window > \.editor-lod-detail-canvas \{[^}]*z-index:\s*1;/)
  assert.match(styles, /\.stage-space > \.stage \{[^}]*z-index:\s*3;/)
  assert.match(styles, /\.canvas \.stage\.editor-lod-stage \{[^}]*background-image:\s*none;/)
  assert.match(source, /const editorLodDetailGridStyle = computed\(\(\) => \{[\s\S]*?backgroundColor: canvasBg\.value,[\s\S]*?backgroundPosition: `\$\{-bounds\.x \* frameZoom\}px \$\{-bounds\.y \* frameZoom\}px`/)
  assert.match(source, /class="editor-lod-detail-background"[\s\S]*?<MiniMapPreview[^>]+class="editor-lod-detail-canvas"/)
  assert.match(source, /:view-box="editorLodDetailBounds"[^>]+test-id="editor-lod-detail-canvas"/)
  assert.match(source, /const editorLodDetailCommittedFrame = shallowRef\(null\)/)
  assert.match(source, /const renderZoom = finiteNumber\(event\.width,[\s\S]*?editorLodDetailCommittedFrame\.value = \{[\s\S]*?bounds: \{ \.\.\.bounds \},[\s\S]*?zoom: renderZoom,[\s\S]*?pixelRatioX: finiteNumber\(event\.pixelRatioX/)
  assert.match(source, /const projectionScale = zoom\.value \/ frameZoom[\s\S]*?transform: Math\.abs\(projectionScale - 1\)/)
  assert.match(source, /const editorLodDetailGridStyle = computed\(\(\) => \{[\s\S]*?const currentZoom = Math\.max\(\.0001, finiteNumber\(zoom\.value, frameZoom\)\)[\s\S]*?const projectionScale = currentZoom \/ frameZoom[\s\S]*?editorLodGridPresentation\(\{ gridSize: gridSize\.value, zoom: currentZoom \}\)/)
  assert.match(source, /'--editor-lod-grid-size': `\$\{grid\.worldStep \* frameZoom\}px`[\s\S]*?'--editor-lod-grid-stroke': `\$\{grid\.stroke \/ projectionScale\}px`[\s\S]*?'--editor-lod-grid-dot-size': `\$\{grid\.dotSize \/ projectionScale\}px`/)
  assert.match(source, /:minimum-screen-text-size="EDITOR_LOD_MIN_TEXT_SCREEN_SIZE"[^>]+:minimum-screen-stroke-size="1"[^>]+:pixel-ratio="editorLodDetailPixelRatio"[^>]+:render-budget-ms="6"[^>]+render-mode="task"[^>]+incremental-runtime geometry-interactive atomic-css-size faithful test-id="editor-lod-detail-canvas"/)
  assert.match(source, /@render-error="handleEditorLodRenderError"/)
  assert.match(source, /function handleEditorLodDetailRenderError\(\) \{[\s\S]*?editorLodDetailFresh\.value = false[\s\S]*?detailCoverBounds[\s\S]*?completeEditorLodGeometryLayer\(session\.sessionId, 'detail', \{ failed: true \}\)/)
  assert.match(source, /function settleEditorLodGeometrySession\(sessionId, session\)[\s\S]*?session\?\.detailFailed[\s\S]*?editorLodDetailReady\.value = false[\s\S]*?editorLodDetailCommittedFrame\.value = null[\s\S]*?clearEditorLodGeometryVisualState[\s\S]*?queueEditorLodRecovery/)
  assert.match(source, /function markEditorLodDirty\(\) \{[\s\S]*?editorLodContentRevision\.value \+= 1[\s\S]*?invalidateEditorLodDetail\(\)[\s\S]*?editorLodRenderFrame = requestAnimationFrame/)
  assert.match(source, /function handleEditorLodDetailRenderComplete\(event\) \{\s*if \(event\?\.kind !== 'full' \|\| event\.pendingFull \|\| event\.renderPlanKey !== editorLodDetailPlanKey\.value\) return/)
  assert.match(source, /const editorLodRemovalCoverRegions = shallowRef\(\[\]\)/)
  assert.match(source, /const editorLodRemovalFallbackReady = ref\(false\)/)
  assert.match(source, /const EDITOR_LOD_DETAIL_CLIP_SUPPORTED = Boolean\([\s\S]*?globalThis\.CSS\?\.supports\?\.\([\s\S]*?'clip-path',[\s\S]*?'polygon\(0 0, 100% 0, 100% 100%, 0 100%\)'/)
  assert.match(source, /const editorLodDetailFallbackRegions = computed\(\(\) => \{[\s\S]*?resolveEditorLodDetailFallbackRegions\(\{[\s\S]*?detailBounds: editorLodDetailCommittedFrame\.value\?\.bounds,[\s\S]*?geometryCoverBounds: session\?\.detailCoverBounds,[\s\S]*?geometryMode: session\?\.mode,[\s\S]*?geometryCommitted: session\?\.committed,[\s\S]*?geometryFailed: session\?\.fallbackFailed,[\s\S]*?removalCoverBounds: editorLodRemovalCoverRegions\.value,[\s\S]*?removalFallbackCommitted: editorLodRemovalFallbackReady\.value/)
  assert.match(source, /const editorLodDetailClipPath = computed\(\(\) => \{[\s\S]*?createEditorLodDetailClipPath\(\{[\s\S]*?frameWidth: frame\?\.width,[\s\S]*?frameHeight: frame\?\.height,[\s\S]*?regions: editorLodDetailFallbackRegions\.value/)
  assert.match(source, /const editorLodDetailFrameStyle = computed\(\(\) => \{[\s\S]*?const detailClipPath = EDITOR_LOD_DETAIL_CLIP_SUPPORTED \? editorLodDetailClipPath\.value : 'none'[\s\S]*?clipPath: detailClipPath,[\s\S]*?WebkitClipPath: detailClipPath/)
  assert.match(source, /const editorLodDetailVisible = computed\(\(\) => editorLodDetailReady\.value\)/)
  assert.doesNotMatch(source, /editorLodDetailReady\.value && \([\s\S]{0,160}!editorLodDetailFallback/)
  assert.match(source, /'is-ready': editorLodDetailVisible, 'is-stale': !editorLodDetailFresh/)
  assert.doesNotMatch(source, /editor-lod-detail-geometry-cover/)
  assert.doesNotMatch(styles, /editor-lod-detail-geometry-cover/)
  assert.match(source, /function patchRemovedEditorLodEntities\(payload\) \{[\s\S]*?const hadRemovalCover = editorLodRemovalCoverRegions\.value\.length > 0[\s\S]*?const fallbackPatched[\s\S]*?editorLodRemovalFallbackReady\.value = hadRemovalCover[\s\S]*?editorLodRemovalFallbackReady\.value && fallbackPatched[\s\S]*?: fallbackPatched[\s\S]*?editorLodRemovalCoverRegions\.value = createEditorLodRemovalCoverRegions/)
  assert.match(source, /function handleEditorLodRenderComplete\(event\) \{[\s\S]*?!event\.pendingFull && editorLodRemovalCoverRegions\.value\.length[\s\S]*?editorLodRemovalFallbackReady\.value = true/)
  assert.match(source, /function handleEditorLodRenderError\(\) \{[\s\S]*?editorLodRemovalFallbackReady\.value = false/)
  assert.match(source, /function resetEditorLodDetail\(\)[\s\S]*?editorLodRemovalCoverRegions\.value = \[\][\s\S]*?editorLodRemovalFallbackReady\.value = false/)
  assert.match(source, /function handleEditorLodDetailRenderComplete\(event\)[\s\S]*?editorLodRemovalCoverRegions\.value = \[\][\s\S]*?editorLodRemovalFallbackReady\.value = false/)
  assert.doesNotMatch(source, /editorLodRemovalCoverRegions\.value = mergeEditorLodDetailCoverBounds/)
  assert.match(source, /function createEditorLodRemovalCoverRegions\(previous, payload\)[\s\S]*?payloadNodes\.map\(node => rotatedFrameBounds\(node\)\)[\s\S]*?payload\?\.edges[\s\S]*?edgeBoundsForNodes[\s\S]*?payload\?\.drawings[\s\S]*?drawingBounds[\s\S]*?mergeEditorLodRemovalRegions/)
  assert.match(source, /function completeEditorLodGeometryLayer\(sessionId, layer, \{ failed = false \} = \{\}\)[\s\S]*?markEditorLodGeometryLayerFailed[\s\S]*?markEditorLodGeometryLayerComplete[\s\S]*?completion\.settled[\s\S]*?settleEditorLodGeometrySession/)
  assert.match(source, /function handleEditorLodGeometryComplete\(event\) \{[\s\S]*?editorLodFallbackGeometryCompletesSession\(session, event\)[\s\S]*?completeEditorLodGeometryLayer\(session\.sessionId, 'fallback'\)/)
  const detailGeometryComplete = source.slice(
    source.indexOf('function handleEditorLodDetailGeometryComplete'),
    source.indexOf('function handleEditorLodGeometryComplete')
  )
  const detailSessionGuard = detailGeometryComplete.indexOf('editorLodDetailGeometryCompletesSession(session, event)')
  const detailPlanGuard = detailGeometryComplete.indexOf('event?.renderPlanKey !== editorLodDetailPlanKey.value')
  const detailFailure = detailGeometryComplete.indexOf('handleEditorLodDetailRenderError()')
  assert.ok(detailSessionGuard >= 0 && detailPlanGuard > detailSessionGuard && detailFailure > detailPlanGuard)
  assert.match(detailGeometryComplete, /completeEditorLodGeometryLayer\(session\.sessionId, 'detail'\)/)
  assert.match(source, /@geometry-complete="handleEditorLodDetailGeometryComplete"/)
  assert.match(source, /function invalidateEditorLodDetail[\s\S]*?editorLodDetailFresh\.value = false[\s\S]*?if \(!editorLodDetailCommittedFrame\.value\) editorLodDetailReady\.value = false/)
  assert.match(source, /function beginEditorLodGeometry[\s\S]*?editorLodDetailCanvas\.value\?\.beginGeometryInteraction[\s\S]*?detailSessionId/)
  assert.match(source, /if \(!detailSessionId\) editorLodDetailCanvas\.value\?\.invalidatePendingRender\?\.\('geometry-fallback'\)/)
  assert.match(source, /function requestEditorLodGeometryFrame[\s\S]*?editorLodDetailCanvas\.value\?\.requestGeometryInteractionFrame/)
  assert.match(source, /function finishEditorLodGeometry[\s\S]*?editorLodDetailCanvas\.value\?\.finishGeometryInteraction/)
  assert.match(source, /detailTargetGeneration = parseRenderGeneration\(editorLodDetailCanvas\.value\?\.requestCoalescedRender\?\.\(\)\)/)
  assert.match(source, /event\?\.renderPlanKey !== editorLodDetailPlanKey\.value[\s\S]*?handleEditorLodDetailRenderError\(\)/)
  assert.doesNotMatch(source, /EDITOR_LOD_DETAIL_GEOMETRY_PATCH_ENTITY_LIMIT/)
  assert.doesNotMatch(source, /editorLodGeometryPayloadEntityCount/)
  const beginDetailGeometry = source.slice(
    source.indexOf('function beginEditorLodGeometry'),
    source.indexOf('function requestEditorLodGeometryFrame')
  )
  assert.match(beginDetailGeometry, /const detailPatchAllowed = editorLodDetailReady\.value\s*&& !\(payload\.coverBounds\?\.length > 0\)/)
  assert.doesNotMatch(beginDetailGeometry, /payload\.(?:nodes|edges|drawings)\.length/)
  assert.match(source, /function mergeEditorLodDetailCoverBounds[\s\S]*?rotatedFrameBounds[\s\S]*?edgeBoundsForNodes[\s\S]*?drawingBounds/)
  assert.match(source, /function editorLodDetailCoverRegions\(\.\.\.sources\)[\s\S]*?flatMap\(source => Array\.isArray\(source\) \? source : \[source\]\)/)
  assert.match(source, /detailSourceBounds,\s*detailCurrentBounds: detailSourceBounds,\s*detailCoverBounds: editorLodDetailReady\.value && !detailPatchActive\s*\? editorLodDetailCoverRegions\(detailSourceBounds\)/)
  assert.match(source, /detailCoverBounds: previous\.detailFailed[\s\S]*?editorLodDetailCoverRegions\(detailSourceBounds, detailCurrentBounds\)/)
  assert.match(source, /const editorLodDetailNodes = computed\(\(\) => \{[\s\S]*?nodeSpatialIndex\.query\(bounds, \{ sort: false \}\)/)
  assert.match(source, /const editorLodDetailBitmapBudget = computed\(\(\) => \{[\s\S]*?editorLodBitmapPixelBudget\(\{[\s\S]*?devicePixelRatio: editorDevicePixelRatio\.value/)
  assert.match(source, /const editorLodDetailPixelRatio = computed\(\(\) => resolveEditorLodDetailPixelRatio\(editorDevicePixelRatio\.value\)\)/)
  assert.match(source, /const editorLodDetailOverscan = computed\(\(\) => editorLodDetailOverscanPixels\(\{[\s\S]*?viewportWidth: viewport\.value\.width,[\s\S]*?pixelRatio: editorLodDetailPixelRatio\.value/)
  assert.match(source, /clippedEditorLodDetailBounds\(editorLodDetailOverscan\.value\)/)
  assert.doesNotMatch(source, /const drawingRenderEntries = computed\(\(\) => drawings\.value\.map/)
  assert.doesNotMatch(source, /const drawing = drawings\.value\.find\([^\n]+op\.id/)
})

test('ordinary-density startup mounts editor DOM in bounded batches before restoring full fidelity', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')
  const restart = source.slice(
    source.indexOf('function restartEditorProgressiveDomMount'),
    source.indexOf('// watch 会在注册时')
  )
  const apply = source.slice(
    source.indexOf('async function applyProject'),
    source.indexOf('function drawingFileName')
  )

  assert.match(source, /const EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD = 128/)
  assert.match(source, /const EDITOR_PROGRESSIVE_DOM_BATCH_SIZE = 8/)
  assert.match(source, /const EDITOR_PROGRESSIVE_DOM_MOUNT_COST = 64/)
  assert.match(source, /function editorProgressiveDomMountRequired\(source\) \{[\s\S]*?!editorPersistentLodActive\.value[\s\S]*?source\.length > EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD/)
  assert.match(restart, /previewMountBatchEnd\(pendingNodes, pendingStart,[\s\S]*?maxNodes: EDITOR_PROGRESSIVE_DOM_BATCH_SIZE,[\s\S]*?costBudget: EDITOR_PROGRESSIVE_DOM_MOUNT_COST/)
  assert.match(restart, /const finish = \(\) => \{[\s\S]*?editorProgressiveDomActive\.value = false/)
  assert.match(restart, /void nextTick\(\(\) => \{[\s\S]*?scheduleBundleFrame/)
  assert.match(source, /const progressiveIds = editorProgressiveDomActive\.value \? editorProgressiveDomNodeIds\.value : \[\]/)
  assert.match(source, /function editorProgressiveDomNodeHidden\(nodeId\) \{[\s\S]*?editorLodCanvasReady\.value[\s\S]*?!editorLodOverlayIdSet\.value\.has\(nodeId\)/)
  const renderedNode = source.split('\n').find(line => line.includes('v-for="n in editorRenderedNodes"')) || ''
  assert.match(renderedNode, /:key="n\.id"/)
  assert.match(renderedNode, /progressive-dom-hidden/)
  assert.match(styles, /\.canvas \.node-shell\.progressive-dom-hidden \{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/)
  assert.ok(apply.indexOf('editorProgressiveDomActive.value = runtime.nodes.length') < apply.indexOf('installPreparedEntityCollections(runtime)'))
  assert.ok(apply.indexOf('primeEditorLodBootstrap()') < apply.indexOf('restartEditorProgressiveDomMount()'))
})

test('editor DOM recovery stays progressive across preview and persistent LOD handoffs', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const persistentExitWatch = source.slice(
    source.indexOf('watch(editorPersistentLodActive'),
    source.indexOf('// watch ', source.indexOf('watch(editorPersistentLodActive'))
  )
  const closePreview = source.slice(
    source.indexOf('async function closePreview'),
    source.indexOf('async function openPreview')
  )
  const openPreview = source.slice(
    source.indexOf('async function openPreview'),
    source.indexOf('watch([stageWidth, stageHeight, previewAutoFit]')
  )

  assert.match(persistentExitWatch, /watch\(editorPersistentLodActive, \(active, previous\) => \{[\s\S]*?active \|\| previous !== true[\s\S]*?restartEditorProgressiveDomMount\(\)/)
  assert.match(persistentExitWatch, /\{ flush: 'sync' \}\)/)

  const closeRestart = closePreview.indexOf('restartEditorProgressiveDomMount()')
  const closeUnpause = closePreview.indexOf('showPreview.value = false')
  assert.ok(closeRestart >= 0 && closeRestart < closeUnpause)

  const openPause = openPreview.indexOf('pauseEditorLodRendering()')
  const openCancelProgressive = openPreview.indexOf('clearEditorProgressiveDomMount()')
  const openPauseEditor = openPreview.indexOf('showPreview.value = true')
  assert.ok(openPause >= 0 && openPause < openCancelProgressive)
  assert.ok(openCancelProgressive < openPauseEditor)
})

test('App keeps LOD failures sticky and recovers each Canvas from an acknowledged full generation', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const recovery = source.slice(
    source.indexOf('function clearEditorLodRecoveryTimer'),
    source.indexOf('function clearEditorLodGeometryVisualState')
  )
  const fallbackError = source.slice(
    source.indexOf('function handleEditorLodRenderError'),
    source.indexOf('function patchRemovedEditorLodEntities')
  )
  const detailError = source.slice(
    source.indexOf('function handleEditorLodDetailRenderError'),
    source.indexOf('function handleEditorLodDetailGeometryComplete')
  )
  const pointerFrame = source.slice(
    source.indexOf('function requestEditorLodGeometryFrame'),
    source.indexOf('function finishEditorLodGeometry')
  )
  const finish = source.slice(
    source.indexOf('function finishEditorLodGeometry'),
    source.indexOf('function commitPointerOperation')
  )
  const largeCommit = source.slice(
    source.indexOf('function scheduleLargeSelectionCommit'),
    source.indexOf('function cancelLargeSelectionCommit')
  )
  const mergeCover = source.slice(
    source.indexOf('function mergeEditorLodDetailCoverBounds'),
    source.indexOf('function beginEditorLodGeometry')
  )
  const beginGeometry = source.slice(
    source.indexOf('function beginEditorLodGeometry'),
    source.indexOf('function requestEditorLodGeometryFrame')
  )
  const unmount = source.slice(source.indexOf('onUnmounted(() => {'), source.indexOf('</script>'))

  assert.match(recovery, /editorLodFallbackRecoveryTargetGeneration/)
  assert.match(recovery, /editorLodDetailRecoveryTargetGeneration/)
  assert.match(recovery, /targetGeneration != null && recoveryTarget === target\)[\s\S]*?renderState\?\.pending[\s\S]*?pendingGeneration >= targetGeneration[\s\S]*?clearEditorLodRecoveryTarget\(layer\)/)
  assert.match(recovery, /renderState\?\.pending \? renderState\.generation : target\.requestCoalescedRender\?\.\(\)/)
  assert.match(recovery, /if \(fallback\) primeEditorLodBootstrap\(\)/)
  assert.match(recovery, /renderGeneration < targetGeneration/)
  assert.match(recovery, /editorLodGeometrySession\.value\) return false/)

  assert.match(fallbackError, /cancelGeometryInteraction\?\.\(sessionId\)/)
  assert.match(fallbackError, /syncEditorLodGeometryHiddenState\(currentEditorLodGeometrySession\(sessionId\)\)/)
  assert.match(fallbackError, /completeEditorLodGeometryLayer\(sessionId, 'fallback', \{ failed: true \}\)/)
  assert.match(fallbackError, /queueEditorLodRecovery\(\{ fallback: true \}\)/)
  assert.match(detailError, /cancelGeometryInteraction\?\.\(session\.detailSessionId\)/)
  assert.match(detailError, /operation\.value\.editorLodDetailGeometrySessionId = null/)
  assert.match(detailError, /completeEditorLodGeometryLayer\(session\.sessionId, 'detail', \{ failed: true \}\)/)
  assert.match(detailError, /syncEditorLodGeometryHiddenState\(currentEditorLodGeometrySession\(session\.sessionId\)\)/)
  assert.doesNotMatch(detailError, /editorLodGeometryHidden(?:Node|Edge|Drawing)Ids\.value = new Set\(\)/)

  assert.match(pointerFrame, /if \(!previous\.fallbackFailed\)/)
  assert.match(pointerFrame, /mode: previous\.fallbackFailed \? 'dom'/)
  assert.match(pointerFrame, /fallbackComplete: previous\.fallbackComplete === true/)
  assert.match(pointerFrame, /detailComplete: previous\.detailComplete === true/)
  assert.match(pointerFrame, /fallbackRecoveryPending: previous\.fallbackRecoveryPending === true/)
  assert.match(pointerFrame, /detailRecoveryPending: previous\.detailRecoveryPending === true/)

  assert.match(finish, /fallbackTargetGeneration = fallbackFailed \? null : parseRenderGeneration\(result\?\.targetFullGeneration\)/)
  assert.match(finish, /detailTargetGeneration = detailFailed \? null : parseRenderGeneration\(detailResult\?\.targetFullGeneration\)/)
  assert.match(finish, /fallbackTargetGeneration == null/)
  assert.match(finish, /detailTargetGeneration == null/)
  assert.match(finish, /detailResult\.mode === 'canvas' && detailResult\.committed === true/)
  assert.match(finish, /result\.mode === 'canvas' && result\.committed === true/)
  assert.match(finish, /fallbackComplete: currentSession\.fallbackComplete === true \|\| fallbackFailed/)
  assert.match(finish, /detailComplete: currentSession\.detailComplete === true \|\| detailFailed/)
  assert.match(finish, /editorLodGeometryBarrierSettled\(finalSession\)/)

  assert.match(largeCommit, /op\.editorLodCoverBounds = \[op\.bounds, largeSelectionPreviewBounds\.value\]/)
  assert.match(largeCommit, /authoritativeBounds = \{ \.\.\.result\.bounds \}[\s\S]*?op\.editorLodCoverBounds = \[\.\.\.\(op\.editorLodCoverBounds \|\| \[\]\), authoritativeBounds\]/)
  assert.match(largeCommit, /editorLodGeometrySession\.value = \{ \.\.\.session, detailCurrentBounds, detailCoverBounds \}/)
  assert.match(largeCommit, /coverBounds: op\.editorLodCoverBounds/)
  assert.match(mergeCover, /\.\.\.\(payload\?\.coverBounds \|\| \[\]\)/)
  assert.match(beginGeometry, /!\(payload\.coverBounds\?\.length > 0\)/)
  assert.match(beginGeometry, /detailNeedsRecovery = detailCanvasExpected && !editorLodDetailReady\.value/)
  assert.match(beginGeometry, /detailRecoveryPending: editorLodDetailRecoveryPending \|\| detailNeedsRecovery/)
  assert.match(beginGeometry, /clearEditorLodRecoveryTarget\('fallback'\)/)
  assert.match(finish, /coverBounds: op\.editorLodCoverBounds \|\| \[\]/)
  assert.doesNotMatch(finish, /op\.items/)
  assert.match(unmount, /resetEditorLodRecovery\(\)/)
})

test('App cancels old-document LOD work before replacing collections and only primes the new indexes', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const cancel = source.slice(
    source.indexOf('function cancelEditorLodRendering'),
    source.indexOf('function pauseEditorLodRendering')
  )
  const pause = source.slice(
    source.indexOf('function pauseEditorLodRendering'),
    source.indexOf('function syncEditorLodDetailBounds')
  )
  const reset = source.slice(
    source.indexOf('function resetDocumentSession'),
    source.indexOf('function applyProject')
  )
  const apply = source.slice(
    source.indexOf('function applyProject'),
    source.indexOf('function drawingFileName')
  )

  assert.match(cancel, /cancelGeometryInteraction\?\.\(session\?\.sessionId\)/)
  assert.match(cancel, /cancelGeometryInteraction\?\.\(session\?\.detailSessionId\)/)
  assert.match(cancel, /invalidatePendingRender\?\.\(reason\)/)
  assert.match(cancel, /clearEditorLodGeometryVisualState\(\)/)
  assert.doesNotMatch(cancel, /primeEditorLodBootstrap\(\)/)
  assert.match(pause, /cancelEditorLodRendering\(reason\)[\s\S]*?primeEditorLodBootstrap\(\)/)
  assert.ok(reset.indexOf('pointerUp()') < reset.indexOf("cancelEditorLodRendering('document-reset')"))
  assert.doesNotMatch(reset, /primeEditorLodBootstrap\(\)/)
  const install = apply.indexOf('installPreparedEntityCollections(runtime)')
  const stageWidth = apply.indexOf('stageWidth.value = project.stageWidth')
  const stageHeight = apply.indexOf('stageHeight.value = project.stageHeight')
  const resetView = apply.indexOf('resetCanvasView()')
  const bootstrap = apply.indexOf('primeEditorLodBootstrap()')
  assert.ok(install >= 0 && stageWidth > install && stageHeight > install && resetView > stageHeight && bootstrap > resetView)
  assert.match(source, /watch\(editorLodActive, active => \{[\s\S]*?if \(!editorLodDocumentResetPending\) primeEditorLodBootstrap\(\)/)
  assert.match(source, /const EDITOR_LOD_BOOTSTRAP_ENTITY_LIMIT = 32/)
})

test('App explicitly rebuilds detail bounds after a same-size LOD document replacement', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function applyProject')
  const end = source.indexOf('function drawingFileName', start)
  assert.ok(start >= 0 && end > start, 'expected an isolated applyProject function')
  const apply = source.slice(start, end)

  const replace = apply.indexOf('installPreparedEntityCollections(runtime)')
  const stageWidth = apply.indexOf('stageWidth.value = project.stageWidth')
  const stageHeight = apply.indexOf('stageHeight.value = project.stageHeight')
  const resetView = apply.indexOf('resetCanvasView()')
  const detailRefresh = apply.indexOf('syncEditorLodDetailBounds(true)')

  assert.ok(replace >= 0 && stageWidth > replace && stageHeight > replace && resetView > stageHeight)
  assert.ok(
    detailRefresh > resetView,
    'applyProject must force detail bounds after installing the new indexes, dimensions, and view'
  )
})

test('App re-reads live LOD failures after synchronous child Canvas callbacks', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const pointerFrame = source.slice(
    source.indexOf('function requestEditorLodGeometryFrame'),
    source.indexOf('function finishEditorLodGeometry')
  )
  const finish = source.slice(
    source.indexOf('function finishEditorLodGeometry'),
    source.indexOf('function commitPointerOperation')
  )
  assert.match(pointerFrame, /requestGeometryInteractionFrame\?\.\(sessionId, payload\)\s*\n\s*const liveSession = currentEditorLodGeometrySession\(sessionId\)\s*\n\s*if \(!liveSession\) return null/)
  assert.match(pointerFrame, /requestGeometryInteractionFrame\?\.\(detailSessionId, payload\)\s*\n\s*const liveSession = currentEditorLodGeometrySession\(sessionId\)\s*\n\s*if \(!liveSession\) return null/)
  assert.match(finish, /finishGeometryInteraction\?\.\([\s\S]*?detailSessionId,[\s\S]*?\)\s*\n\s*const liveSession = currentEditorLodGeometrySession\(sessionId\)\s*\n\s*if \(!liveSession\) return false/)
  assert.match(finish, /requestCoalescedRender\?\.\(\)\)\s*\n\s*const liveSession = currentEditorLodGeometrySession\(sessionId\)\s*\n\s*if \(!liveSession\) return false/)
  assert.match(finish, /finishGeometryInteraction\?\.\(sessionId, payload\)\s*\n\s*const liveSession = currentEditorLodGeometrySession\(sessionId\)\s*\n\s*if \(!liveSession\) return false/)
  assert.match(pointerFrame, /fallbackFailed: previous\.fallbackFailed === true/)
  assert.match(pointerFrame, /detailFailed: previous\.detailFailed === true/)
  assert.match(finish, /const finalSessionSource = currentEditorLodGeometrySession\(sessionId\)/)
})

test('App keeps active DOM hidden while either LOD Canvas remains reliable', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const visualState = source.slice(
    source.indexOf('function syncEditorLodGeometryHiddenState'),
    source.indexOf('function updateEditorLodGeometryVisualState')
  )
  const pointerFrame = source.slice(
    source.indexOf('function requestEditorLodGeometryFrame'),
    source.indexOf('function finishEditorLodGeometry')
  )
  const fallbackError = source.slice(
    source.indexOf('function handleEditorLodRenderError'),
    source.indexOf('function patchRemovedEditorLodEntities')
  )
  const detailError = source.slice(
    source.indexOf('function handleEditorLodDetailRenderError'),
    source.indexOf('function handleEditorLodDetailGeometryComplete')
  )

  assert.match(visualState, /shouldHideEditorLodGeometryDom\(\{[\s\S]*?fallbackCommitted: session\?\.committed,[\s\S]*?detailCommitted: session\?\.detailCommitted/)
  assert.match(pointerFrame, /detailCommitted/)
  assert.match(fallbackError, /syncEditorLodGeometryHiddenState\(currentEditorLodGeometrySession\(sessionId\)\)/)
  assert.match(detailError, /syncEditorLodGeometryHiddenState\(currentEditorLodGeometrySession\(session\.sessionId\)\)/)
})

test('LOD removal cover resolves deleted edge endpoints from payload nodes', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function mergeEditorLodDetailCoverBounds')
  const end = source.indexOf('function editorLodDetailCoverRegions', start)
  assert.ok(start >= 0 && end > start, 'expected an isolated LOD cover merge function')

  const createMerge = new Function(
    'rotatedFrameBounds',
    'edgeBoundsForNodes',
    'drawingBounds',
    'nodeIndex',
    'zoom',
    'stageWidth',
    'stageHeight',
    `"use strict"; return (${source.slice(start, end)});`
  )
  const removedNode = { id: 'removed', x: 20, y: 30, w: 40, h: 40 }
  const retainedNode = { id: 'retained', x: 900, y: 30, w: 40, h: 40 }
  const liveNodeIndex = new Map([[retainedNode.id, retainedNode]])
  let resolvedSource = null
  let resolvedTarget = null
  const merge = createMerge(
    node => ({ x: node.x, y: node.y, w: node.w, h: node.h }),
    (edge, lookup) => {
      resolvedSource = lookup.get(edge.from)
      resolvedTarget = lookup.get(edge.to)
      if (!resolvedSource || !resolvedTarget) return { x: 0, y: 0, w: 0, h: 0 }
      return {
        x: Math.min(resolvedSource.x, resolvedTarget.x),
        y: Math.min(resolvedSource.y, resolvedTarget.y),
        w: Math.abs(resolvedTarget.x - resolvedSource.x) + 40,
        h: 40
      }
    },
    drawing => drawing,
    { value: liveNodeIndex },
    { value: 1 },
    { value: 2000 },
    { value: 1000 }
  )

  const cover = merge(null, {
    nodes: [removedNode],
    edges: [{ id: 'edge', from: removedNode.id, to: retainedNode.id }],
    drawings: []
  })

  assert.equal(resolvedSource, removedNode, 'deleted endpoint must resolve from payload.nodes')
  assert.equal(resolvedTarget, retainedNode, 'retained endpoint must still resolve from the live index')
  assert.ok(cover.x + cover.w > retainedNode.x, 'cover must include the connected edge, not only the deleted node')
})

test('preview pauses unfinished editor LOD geometry without leaving a completion barrier behind', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const cancel = source.slice(
    source.indexOf('function cancelEditorLodRendering'),
    source.indexOf('function pauseEditorLodRendering')
  )
  const pause = source.slice(
    source.indexOf('function pauseEditorLodRendering'),
    source.indexOf('function syncEditorLodDetailBounds')
  )
  const openPreview = source.slice(
    source.indexOf('async function openPreview'),
    source.indexOf('watch([stageWidth, stageHeight, previewAutoFit]')
  )

  assert.match(cancel, /editorLodCanvas\.value\?\.cancelGeometryInteraction\?\.\(session\?\.sessionId\)/)
  assert.match(cancel, /editorLodDetailCanvas\.value\?\.cancelGeometryInteraction\?\.\(session\?\.detailSessionId\)/)
  assert.match(cancel, /invalidatePendingRender\?\.\(reason\)/)
  assert.match(cancel, /resetEditorLodRecovery\(\)/)
  assert.match(cancel, /clearEditorLodGeometryVisualState\(\)/)
  assert.match(cancel, /editorLodCanvasReady\.value = false/)
  assert.match(cancel, /resetEditorLodDetail\(\)/)
  assert.match(pause, /cancelEditorLodRendering\(reason\)[\s\S]*?primeEditorLodBootstrap\(\)/)
  assert.match(openPreview, /if \(operation\.value\) pointerUp\(\)[\s\S]*?pauseEditorLodRendering\(\)[\s\S]*?showPreview\.value = true/)
})

test('MiniMap LOD geometry uses bounded local patches and authoritative full acknowledgements', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  assert.match(source, /const GEOMETRY_QUERY_LIMIT = 1025/)
  assert.match(source, /const GEOMETRY_MAX_TOTAL_PATCH_PIXELS = 1048576/)
  assert.match(source, /props\.spatialIndex\.query\(region, \{ sort: false, limit: GEOMETRY_QUERY_LIMIT \}\)/)
  assert.match(source, /function beginGeometryInteraction[\s\S]*?renderScheduler\.invalidate\('geometry'\)[\s\S]*?beginRuntimeBackingMutation\('geometry'\)/)
  assert.match(source, /function cancelGeometryInteraction[\s\S]*?geometryInteraction = null[\s\S]*?runtimeRenderDirty \|\| runtimeRenderFollowUpPending\(\)[\s\S]*?canIncrementRuntime\(\)[\s\S]*?scheduleRuntimeRender\(\)[\s\S]*?requestCoalescedRender\(\)/)
  assert.match(source, /function finishGeometryInteraction[\s\S]*?const finalFrame =[\s\S]*?requestGeometryInteractionFrame\(sessionId, source\)[\s\S]*?if \(geometryInteraction !== session\) return null[\s\S]*?targetFullGeneration = startGeometryFullRender\(session\)[\s\S]*?committed: finalFrame\?\.committed === true/)
  assert.match(source, /task\.geometrySessionId !== waitingGeometry\.id[\s\S]*?task\.generation < waitingGeometry\.targetFullGeneration[\s\S]*?task\.geometryRevision < waitingGeometry\.revision/)
  assert.match(source, /function queueGeometryFullRefresh\(session\)[\s\S]*?queueRenderMicrotask[\s\S]*?session\.fullDirty[\s\S]*?startGeometryFullRender\(session\)/)
  assert.match(source, /function markGeometryFullDirty\(\)[\s\S]*?session\.state === 'awaiting-full'[\s\S]*?queueGeometryFullRefresh\(session\)/)
  const fullCommit = source.slice(source.indexOf('function commitRenderTask'), source.indexOf('const renderScheduler'))
  const dirtyGate = fullCommit.indexOf('waitingGeometry.fullDirty || coalescedRenderDirty')
  const geometryComplete = fullCommit.indexOf("emit('geometry-complete'")
  assert.ok(dirtyGate >= 0 && geometryComplete > dirtyGate)
  assert.match(fullCommit, /releaseRenderTask\(task\)[\s\S]*?startGeometryFullRender\(waitingGeometry\)[\s\S]*?return/)
  assert.doesNotMatch(fullCommit, /needsFollowup/)
  assert.match(source, /emit\('geometry-complete'/)
  assert.match(source, /@contextlost="handleCanvasContextLost"/)
  assert.match(source, /@contextrestored="handleCanvasContextRestored"/)
  assert.match(source, /function handleCanvasContextLost[\s\S]*?geometryInteraction = null[\s\S]*?reportCanvasRenderError\('context-lost'\)/)
  assert.match(source, /function handleCanvasContextRestored[\s\S]*?scheduleRender\(\)/)
  assert.doesNotMatch(source.match(/function geometryPatchPlans[\s\S]*?(?=\nfunction drawGeometryStaticPlan)/)?.[0] || '', /props\.(nodes|edges|drawings)/)
})

test('MiniMap refuses to commit an empty local geometry patch', async () => {
  const source = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function commitGeometryPlans')
  const end = source.indexOf('function patchRemovedEntities', start)
  assert.ok(start >= 0 && end > start, 'expected isolated geometry commit and apply functions')

  const createHarness = new Function(
    'committedStaticSurface',
    'committedCompositeSurface',
    'canvas',
    'canvasContextGate',
    'commitCanvasSurface',
    'releaseRuntimeBackSurface',
    'reportCanvasRenderError',
    'drawGeometryStaticPlan',
    'drawGeometryCompositePlan',
    'geometryRegions',
    'mergeEditorLodGeometryRegions',
    'committedStaticFrame',
    'props',
    'geometryPatchPlans',
    'replaceGeometryOwnerSegments',
    'needsIncrementalTextLayout',
    'requestCoalescedRender',
    'committedGeometryIndexesComplete',
    `"use strict"; ${source.slice(start, end)}; return { applyGeometrySnapshot };`
  )
  const context = {
    setTransform() {},
    clearRect() {},
    drawImage() {}
  }
  const surface = { getContext: () => context }
  let producePlans = false
  const { applyGeometrySnapshot } = createHarness(
    surface,
    surface,
    { value: surface },
    { capture: () => 1, accepts: () => true },
    () => true,
    () => {},
    () => {},
    () => {},
    () => {},
    () => ({ truncated: false, regions: [] }),
    regions => ({ truncated: false, regions }),
    { stageWidth: 100, stageHeight: 100 },
    { stageWidth: 100, stageHeight: 100 },
    (_snapshot, regions) => producePlans
      ? regions.map(region => ({ region, bitmapRect: region, edges: [], entities: [] }))
      : [],
    () => true,
    () => false,
    () => {},
    true
  )
  const session = { lastRegions: [], revision: 3 }
  const snapshot = { edges: [], drawings: [], nodeLookup: new Map(), revision: 4 }

  assert.equal(applyGeometrySnapshot(session, snapshot), false)
  assert.equal(session.revision, 3, 'empty patch must not advance the committed geometry revision')

  const dirtyRegion = { x: 5, y: 6, w: 7, h: 8 }
  const emptyPlanSession = { lastRegions: [dirtyRegion], revision: 3 }
  assert.equal(applyGeometrySnapshot(emptyPlanSession, snapshot), false)
  assert.equal(emptyPlanSession.revision, 3, 'empty bitmap plans must not advance the committed geometry revision')

  producePlans = true
  const clearingSession = { lastRegions: [dirtyRegion], revision: 3 }
  assert.equal(applyGeometrySnapshot(clearingSession, snapshot), true)
  assert.equal(clearingSession.revision, 4, 'a real patch may clear the previous region even when the current region set is empty')
})

test('runtime Canvas dirt is consumed once and dispatched to every active surface', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('function markRuntimeCanvasDirty()')
  const end = source.indexOf('function markMiniMapDirty()', start)
  const dispatch = source.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.equal(source.match(/takeRuntimeCanvasDirtyNodes\(\)/g)?.length, 2, 'expected one definition and one consumer')
  assert.match(dispatch, /editorLodCanvas\.value/)
  assert.match(dispatch, /previewFitCanvas\.value/)
  assert.match(dispatch, /const dirty = takeRuntimeCanvasDirtyNodes\(\)/)
  assert.match(dispatch, /for \(const target of targets\)/)
  assert.match(dispatch, /const runtimeRequest = \{[\s\S]*?nodes: dirty\.nodes,[\s\S]*?dense: dirty\.dense,[\s\S]*?pending: dirty\.pending[\s\S]*?\}/)
  assert.match(dispatch, /target\.requestRuntimeRender\?\.\(runtimeRequest\)/)
})
