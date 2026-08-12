import { MAX_CANVAS_PIXEL_RATIO } from './canvasBitmap.js'

export const MAX_PREVIEW_BITMAP_PIXELS = 8_388_608
export const MAX_PREVIEW_BOOTSTRAP_BITMAP_PIXELS = 4_194_304
export const MIN_PREVIEW_BITMAP_PIXEL_RATIO = 2
export const PREVIEW_BITMAP_PIXEL_RATIO_TOLERANCE = 0.01

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function previewBitmapPixelRatio(devicePixelRatio) {
  return Math.max(MIN_PREVIEW_BITMAP_PIXEL_RATIO, Math.min(
    MAX_CANVAS_PIXEL_RATIO,
    positiveNumber(devicePixelRatio, 1)
  ))
}

export function previewBitmapIsSharp(actualPixelRatio, requestedPixelRatio) {
  const actual = Number(actualPixelRatio)
  const requested = Number(requestedPixelRatio)
  if (!Number.isFinite(actual) || actual <= 0 || !Number.isFinite(requested) || requested <= 0) return false
  return actual + PREVIEW_BITMAP_PIXEL_RATIO_TOLERANCE >= requested
}

export function previewBitmapPixelBudget(options = {}) {
  const maximum = Math.max(1, Math.floor(positiveNumber(
    options.maximum,
    MAX_PREVIEW_BITMAP_PIXELS
  )))
  if (!options.fitActive) return Math.min(maximum, MAX_PREVIEW_BOOTSTRAP_BITMAP_PIXELS)

  const stageWidth = positiveNumber(options.stageWidth, 0)
  const stageHeight = positiveNumber(options.stageHeight, 0)
  const scale = positiveNumber(options.scale, 0)
  if (!stageWidth || !stageHeight || !scale) return maximum

  const devicePixelRatio = previewBitmapPixelRatio(options.devicePixelRatio)
  const required = (Math.ceil(stageWidth * scale * devicePixelRatio) + 1)
    * (Math.ceil(stageHeight * scale * devicePixelRatio) + 1)
  if (!Number.isFinite(required)) return maximum
  // A visible preview frame must keep its requested spatial density. The
  // legacy ceiling remains available for offscreen/bootstrap fallback frames.
  if (options.preservePixelRatio === true) return Math.max(1, Math.ceil(required))
  return Math.max(1, Math.min(maximum, required))
}
