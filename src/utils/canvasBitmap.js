export const MAX_CANVAS_PIXEL_RATIO = 3

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function canvasBitmapDimensions(options = {}) {
  const width = Math.max(1, positiveNumber(options.width, 1))
  const height = Math.max(1, positiveNumber(options.height, 1))
  const requestedPixelRatio = Math.max(1, Math.min(
    MAX_CANVAS_PIXEL_RATIO,
    positiveNumber(options.devicePixelRatio, 1)
  ))
  const parsedMaximum = Number(options.maximum)
  const maximum = Number.isFinite(parsedMaximum) && parsedMaximum > 0
    ? Math.max(1, Math.floor(parsedMaximum))
    : 0

  const requestedWidth = Math.max(1, Math.ceil(width * requestedPixelRatio))
  const requestedHeight = Math.max(1, Math.ceil(height * requestedPixelRatio))
  const requestedPixels = requestedWidth * requestedHeight
  if (!maximum || (Number.isSafeInteger(requestedPixels) && requestedPixels <= maximum)) {
    return {
      bitmapWidth: requestedWidth,
      bitmapHeight: requestedHeight,
      pixelRatioX: requestedWidth / width,
      pixelRatioY: requestedHeight / height,
      requestedPixelRatio,
      capped: false
    }
  }

  const cappedPixelRatio = Math.sqrt(maximum / Math.max(1, width * height))
  let bitmapWidth = Math.max(1, Math.floor(width * cappedPixelRatio))
  let bitmapHeight = Math.max(1, Math.floor(height * cappedPixelRatio))
  if (bitmapWidth * bitmapHeight > maximum) {
    if (bitmapWidth >= bitmapHeight) bitmapWidth = Math.max(1, Math.floor(maximum / bitmapHeight))
    else bitmapHeight = Math.max(1, Math.floor(maximum / bitmapWidth))
  }
  return {
    bitmapWidth,
    bitmapHeight,
    pixelRatioX: bitmapWidth / width,
    pixelRatioY: bitmapHeight / height,
    requestedPixelRatio,
    capped: true
  }
}
