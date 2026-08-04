export const EDITOR_LOD_MIN_TEXT_SCREEN_SIZE = 7

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function readableCanvasFontSize(options = {}) {
  const requestedSize = Math.max(.1, finiteNumber(options.requestedSize, 14))
  const minimumScreenSize = Math.max(0, finiteNumber(options.minimumScreenSize))
  if (!minimumScreenSize) return requestedSize

  const scaleY = Math.max(.0001, Math.abs(finiteNumber(options.scaleY, 1)))
  const layoutHeight = Math.max(.1, finiteNumber(options.layoutHeight, requestedSize))
  const heightRatio = Math.max(.1, Math.min(1, finiteNumber(options.heightRatio, .72)))
  const readableTarget = minimumScreenSize / scaleY
  const fittedMaximum = Math.max(requestedSize, layoutHeight * heightRatio)
  return Math.max(requestedSize, Math.min(readableTarget, fittedMaximum))
}

export function layoutConstrainedCanvasFontSize(options = {}) {
  const requestedSize = Math.max(.1, finiteNumber(options.requestedSize, 14))
  const readableSize = Math.max(requestedSize, finiteNumber(options.readableSize, requestedSize))
  const layoutWidth = Math.max(.1, finiteNumber(options.layoutWidth, requestedSize))
  const layoutHeight = Math.max(.1, finiteNumber(options.layoutHeight, requestedSize))
  const contentWidth = Math.max(0, finiteNumber(options.contentWidth))
  const contentHeight = Math.max(0, finiteNumber(options.contentHeight))
  const widthScale = contentWidth > 0 ? layoutWidth / contentWidth : Number.POSITIVE_INFINITY
  const heightScale = contentHeight > 0 ? layoutHeight / contentHeight : Number.POSITIVE_INFINITY
  const maximumLayoutScale = Math.max(1, Math.min(widthScale, heightScale))
  return Math.min(readableSize, requestedSize * maximumLayoutScale)
}
