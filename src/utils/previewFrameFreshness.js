import { canvasBitmapDimensions } from './canvasBitmap.js'

const UNCHANGED_TARGET = Symbol('unchanged-preview-frame-target')

function positiveNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function closeEnough(left, right) {
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-9
}

function sameFrameTarget(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return left.bitmapWidth === right.bitmapWidth
    && left.bitmapHeight === right.bitmapHeight
    && closeEnough(left.width, right.width)
    && closeEnough(left.height, right.height)
    && closeEnough(left.pixelRatioX, right.pixelRatioX)
    && closeEnough(left.pixelRatioY, right.pixelRatioY)
}

export function previewFrameTarget(options = {}) {
  const width = positiveNumber(options.width)
  const height = positiveNumber(options.height)
  if (!width || !height) return null

  const explicitBitmapWidth = positiveNumber(options.bitmapWidth)
  const explicitBitmapHeight = positiveNumber(options.bitmapHeight)
  const dimensions = explicitBitmapWidth && explicitBitmapHeight
    ? {
        bitmapWidth: Math.max(1, Math.floor(explicitBitmapWidth)),
        bitmapHeight: Math.max(1, Math.floor(explicitBitmapHeight))
      }
    : canvasBitmapDimensions({
        width,
        height,
        devicePixelRatio: options.pixelRatio ?? options.devicePixelRatio,
        maximum: options.maxBitmapPixels ?? options.maximum
      })

  const bitmapWidth = dimensions.bitmapWidth
  const bitmapHeight = dimensions.bitmapHeight
  return Object.freeze({
    width,
    height,
    bitmapWidth,
    bitmapHeight,
    pixelRatioX: bitmapWidth / width,
    pixelRatioY: bitmapHeight / height
  })
}

export function previewFrameMatchesTarget(event, target) {
  if (!target || !event) return !target
  if (
    !positiveNumber(event.width)
    || !positiveNumber(event.height)
    || !positiveNumber(event.bitmapWidth)
    || !positiveNumber(event.bitmapHeight)
    || !positiveNumber(event.pixelRatioX)
    || !positiveNumber(event.pixelRatioY)
  ) return false
  return sameFrameTarget(previewFrameTarget(event), target)
    && closeEnough(event.pixelRatioX, target.pixelRatioX)
    && closeEnough(event.pixelRatioY, target.pixelRatioY)
}

export function previewFrameCommitRequested(stamp) {
  return Boolean(
    stamp
    && Number.isInteger(stamp.documentEpoch)
    && stamp.documentEpoch >= 0
    && stamp.requestedEpoch === stamp.documentEpoch
    && Number.isInteger(stamp.targetEpoch)
    && stamp.targetEpoch >= 0
    && stamp.requestedTargetEpoch === stamp.targetEpoch
  )
}

export function createPreviewFrameFreshness() {
  let documentEpoch = 0
  let requestedEpoch = -1
  let committedEpoch = -1
  let targetEpoch = 0
  let requestedTargetEpoch = -1
  let committedTargetEpoch = -1
  let target = null
  let committedTarget = null
  let fresh = false

  function invalidateDocument() {
    documentEpoch += 1
    requestedEpoch = -1
    committedEpoch = -1
    requestedTargetEpoch = -1
    committedTargetEpoch = -1
    committedTarget = null
    fresh = false
    return documentEpoch
  }

  function requestDocumentRender(options = UNCHANGED_TARGET) {
    if (options !== UNCHANGED_TARGET) {
      const nextTarget = previewFrameTarget(options)
      if (!sameFrameTarget(nextTarget, target)) {
        target = nextTarget
        targetEpoch += 1
      }
    }

    if (requestedEpoch === documentEpoch && requestedTargetEpoch === targetEpoch) return requestedEpoch
    requestedEpoch = documentEpoch
    requestedTargetEpoch = targetEpoch
    fresh = committedEpoch === documentEpoch
      && committedTargetEpoch === targetEpoch
      && sameFrameTarget(committedTarget, target)
    return requestedEpoch
  }

  function markRuntimeDirty() {
    if (
      committedEpoch !== documentEpoch
      || committedTargetEpoch !== targetEpoch
      || !sameFrameTarget(committedTarget, target)
    ) fresh = false
  }

  function markRuntimeStale() {
    fresh = false
  }

  function currentCommitStamp() {
    return Object.freeze({
      documentEpoch,
      requestedEpoch,
      targetEpoch,
      requestedTargetEpoch
    })
  }

  function commitStampMatchesCurrent(stamp) {
    if (!stamp || typeof stamp !== 'object') return false
    return stamp.documentEpoch === documentEpoch
      && stamp.requestedEpoch === requestedEpoch
      && stamp.targetEpoch === targetEpoch
      && stamp.requestedTargetEpoch === requestedTargetEpoch
  }

  function canCommitRender(event) {
    if (event?.frameCommitToken != null && !commitStampMatchesCurrent(event.frameCommitToken)) return false
    if (event?.kind === 'full') {
      return !(
        requestedEpoch !== documentEpoch
        || requestedTargetEpoch !== targetEpoch
        || event.pendingFull === true
        || !previewFrameMatchesTarget(event, target)
      )
    }

    if (event?.kind !== 'runtime') return false
    if (
      requestedEpoch !== documentEpoch
      || requestedTargetEpoch !== targetEpoch
      || committedEpoch !== documentEpoch
      || committedTargetEpoch !== targetEpoch
      || !sameFrameTarget(committedTarget, target)
    ) return false
    if (event.pendingFull === true) return false
    if (
      committedTarget
      && (event.bitmapWidth != null || event.bitmapHeight != null)
      && (
        Number(event.bitmapWidth) !== committedTarget.bitmapWidth
        || Number(event.bitmapHeight) !== committedTarget.bitmapHeight
      )
    ) return false
    return true
  }

  function handleRenderComplete(event) {
    if (!canCommitRender(event)) return false
    if (event.kind === 'full') {
      committedEpoch = documentEpoch
      committedTargetEpoch = targetEpoch
      committedTarget = target
    }
    // A runtime event is emitted only after one complete incremental frame is committed.
    // Newer values may already be queued under a continuous stream; they must not starve handoff.
    fresh = true
    return true
  }

  function state() {
    return Object.freeze({ documentEpoch, requestedEpoch, committedEpoch, fresh })
  }

  function targetState() {
    return Object.freeze({
      targetEpoch,
      requestedTargetEpoch,
      committedTargetEpoch,
      target,
      committedTarget
    })
  }

  return Object.freeze({
    invalidateDocument,
    requestDocumentRender,
    markRuntimeDirty,
    markRuntimeStale,
    currentCommitStamp,
    canCommitRender,
    handleRenderComplete,
    state,
    targetState
  })
}
