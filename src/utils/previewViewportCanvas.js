import { MAX_CANVAS_PIXEL_RATIO } from './canvasBitmap.js'
import { MAX_PREVIEW_BITMAP_PIXELS } from './previewBitmapBudget.js'

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function previewViewportPixelRatio(devicePixelRatio) {
  return Math.max(1, Math.min(
    MAX_CANVAS_PIXEL_RATIO,
    positiveNumber(devicePixelRatio, 1)
  ))
}

/**
 * Keep the visible viewport at native device density. Overscan is the first
 * thing reduced when the backing-store budget cannot cover both.
 */
export function previewViewportOverscan(options = {}) {
  const width = positiveNumber(options.width, 0)
  const height = positiveNumber(options.height, 0)
  const preferred = Math.max(0, Number(options.preferred) || 0)
  if (!width || !height || !preferred) return 0

  const pixelRatio = previewViewportPixelRatio(options.pixelRatio)
  const maximumPixels = Math.max(1, Math.floor(positiveNumber(
    options.maximumPixels,
    MAX_PREVIEW_BITMAP_PIXELS
  )))
  const maximumCssPixels = maximumPixels / (pixelRatio * pixelRatio)
  if (width * height >= maximumCssPixels) return 0

  // (width + 2x) * (height + 2x) <= maximumCssPixels
  const discriminant = (width - height) ** 2 + 4 * maximumCssPixels
  const available = (Math.sqrt(discriminant) - width - height) / 4
  return Math.max(0, Math.min(preferred, Math.floor(available)))
}
