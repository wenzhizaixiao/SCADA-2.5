import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPreviewFrameFreshness,
  previewFrameCommitRequested,
  previewFrameMatchesTarget,
  previewFrameTarget
} from '../src/utils/previewFrameFreshness.js'

function fullFrame(target, overrides = {}) {
  return {
    kind: 'full',
    pendingFull: false,
    ...target,
    ...overrides
  }
}

test('only a requested document and target epoch may start a guarded full render', () => {
  assert.equal(previewFrameCommitRequested(null), false)
  assert.equal(previewFrameCommitRequested({
    documentEpoch: 2,
    requestedEpoch: -1,
    targetEpoch: 3,
    requestedTargetEpoch: -1
  }), false)
  assert.equal(previewFrameCommitRequested({
    documentEpoch: 2,
    requestedEpoch: 1,
    targetEpoch: 3,
    requestedTargetEpoch: 3
  }), false)
  assert.equal(previewFrameCommitRequested({
    documentEpoch: 2,
    requestedEpoch: 2,
    targetEpoch: 3,
    requestedTargetEpoch: 2
  }), false)
  assert.equal(previewFrameCommitRequested({
    documentEpoch: 2,
    requestedEpoch: 2,
    targetEpoch: 3,
    requestedTargetEpoch: 3
  }), true)
})

test('normalizes a preview target to the renderer backing dimensions', () => {
  const target = previewFrameTarget({
    width: 1280,
    height: 361.625,
    pixelRatio: 2,
    maxBitmapPixels: 8_388_608
  })

  assert.deepEqual(target, {
    width: 1280,
    height: 361.625,
    bitmapWidth: 2560,
    bitmapHeight: 724,
    pixelRatioX: 2,
    pixelRatioY: 724 / 361.625
  })
  assert.equal(previewFrameMatchesTarget(fullFrame(target), target), true)
  assert.equal(previewFrameMatchesTarget(fullFrame(target, { bitmapWidth: 2559 }), target), false)
  assert.equal(previewFrameMatchesTarget(fullFrame(target, { pixelRatioX: 1 }), target), false)
  assert.equal(previewFrameMatchesTarget({ width: target.width, height: target.height }, target), false)
})

test('a resize target invalidates the old backing until the matching full frame commits', () => {
  const freshness = createPreviewFrameFreshness()
  const windowed = {
    width: 1280,
    height: 361.625,
    pixelRatio: 2,
    maxBitmapPixels: 8_388_608
  }
  const fullscreen = {
    width: 1920,
    height: 541.5,
    pixelRatio: 2,
    maxBitmapPixels: 8_388_608
  }
  const windowedTarget = previewFrameTarget(windowed)
  const fullscreenTarget = previewFrameTarget(fullscreen)

  freshness.requestDocumentRender(windowed)
  assert.equal(freshness.handleRenderComplete(fullFrame(windowedTarget)), true)
  assert.equal(freshness.state().fresh, true)

  freshness.requestDocumentRender(fullscreen)
  assert.equal(freshness.state().fresh, false)
  assert.equal(freshness.handleRenderComplete(fullFrame(windowedTarget)), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'runtime',
    pendingFull: false,
    bitmapWidth: windowedTarget.bitmapWidth,
    bitmapHeight: windowedTarget.bitmapHeight
  }), false)
  assert.equal(freshness.state().fresh, false)

  assert.equal(freshness.handleRenderComplete(fullFrame(fullscreenTarget)), true)
  assert.equal(freshness.state().fresh, true)
})

test('a DPR-only target change cannot be satisfied by the old backing', () => {
  const freshness = createPreviewFrameFreshness()
  const lowDensity = { width: 900, height: 500, pixelRatio: 2, maxBitmapPixels: 8_388_608 }
  const highDensity = { ...lowDensity, pixelRatio: 3 }

  freshness.requestDocumentRender(lowDensity)
  assert.equal(freshness.handleRenderComplete(fullFrame(previewFrameTarget(lowDensity))), true)

  freshness.requestDocumentRender(highDensity)
  assert.equal(freshness.state().fresh, false)
  assert.equal(freshness.handleRenderComplete(fullFrame(previewFrameTarget(lowDensity))), false)
  assert.equal(freshness.handleRenderComplete(fullFrame(previewFrameTarget(highDensity))), true)
})

test('repeating an unchanged target does not hide an already committed frame', () => {
  const freshness = createPreviewFrameFreshness()
  const options = { width: 1280, height: 720, pixelRatio: 2, maxBitmapPixels: 8_388_608 }
  const target = previewFrameTarget(options)

  freshness.requestDocumentRender(options)
  freshness.handleRenderComplete(fullFrame(target))
  const before = freshness.targetState()

  freshness.requestDocumentRender({ ...options })
  assert.equal(freshness.state().fresh, true)
  assert.deepEqual(freshness.targetState(), before)
})

test('runtime completion only refreshes the backing committed for the current target', () => {
  const freshness = createPreviewFrameFreshness()
  const options = { width: 640, height: 360, pixelRatio: 2, maxBitmapPixels: 8_388_608 }
  const target = previewFrameTarget(options)

  freshness.requestDocumentRender(options)
  freshness.handleRenderComplete(fullFrame(target))
  freshness.markRuntimeDirty()
  assert.equal(freshness.handleRenderComplete({
    kind: 'runtime',
    pendingFull: false,
    bitmapWidth: target.bitmapWidth + 1,
    bitmapHeight: target.bitmapHeight
  }), false)
  assert.equal(freshness.handleRenderComplete({
    kind: 'runtime',
    pendingFull: false,
    bitmapWidth: target.bitmapWidth,
    bitmapHeight: target.bitmapHeight
  }), true)

  freshness.markRuntimeDirty()
  assert.equal(freshness.handleRenderComplete({ kind: 'runtime', pendingFull: false }), true)
})

test('strict targets reject full completion events without a frame signature', () => {
  const freshness = createPreviewFrameFreshness()
  freshness.requestDocumentRender({ width: 640, height: 360, pixelRatio: 2 })

  assert.equal(freshness.handleRenderComplete({ kind: 'full', pendingFull: false }), false)
  assert.equal(freshness.state().fresh, false)
})
