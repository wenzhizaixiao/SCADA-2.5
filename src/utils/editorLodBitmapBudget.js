import { MAX_CANVAS_PIXEL_RATIO } from './canvasBitmap.js'

export const MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS = 12_582_912
export const MIN_EDITOR_LOD_DETAIL_PIXEL_RATIO = 3
export const EDITOR_LOD_FALLBACK_BITMAP_PIXELS = 1_048_576

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function editorLodBitmapPixelBudget(options = {}) {
  const maximum = Math.max(1, Math.floor(positiveNumber(
    options.maximum,
    MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS
  )))
  const stageWidth = positiveNumber(options.stageWidth, 0)
  const stageHeight = positiveNumber(options.stageHeight, 0)
  const zoom = positiveNumber(options.zoom, 0)
  if (!stageWidth || !stageHeight || !zoom) return maximum

  const targetPixelRatio = editorLodDetailPixelRatio(options.devicePixelRatio)
  const bitmapWidth = Math.ceil(stageWidth * zoom * targetPixelRatio)
  const bitmapHeight = Math.ceil(stageHeight * zoom * targetPixelRatio)
  const required = bitmapWidth * bitmapHeight
  return Number.isSafeInteger(required) ? Math.max(1, Math.min(maximum, required)) : maximum
}

export function editorLodDetailPixelRatio(devicePixelRatio) {
  return Math.min(
    MAX_CANVAS_PIXEL_RATIO,
    Math.max(MIN_EDITOR_LOD_DETAIL_PIXEL_RATIO, positiveNumber(devicePixelRatio, 1))
  )
}

export function editorLodDetailOverscanPixels(options = {}) {
  const viewportWidth = positiveNumber(options.viewportWidth, 0)
  const viewportHeight = positiveNumber(options.viewportHeight, 0)
  const preferredOverscan = Math.max(0, Number(options.preferredOverscan) || 0)
  if (!viewportWidth || !viewportHeight || !preferredOverscan) return preferredOverscan

  const pixelRatio = positiveNumber(options.pixelRatio, MIN_EDITOR_LOD_DETAIL_PIXEL_RATIO)
  const maximum = Math.max(1, Math.floor(positiveNumber(
    options.maximum,
    MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS
  )))
  const maximumCssPixels = maximum / (pixelRatio * pixelRatio)
  if (viewportWidth * viewportHeight >= maximumCssPixels) return 0

  const capacity = (
    Math.sqrt((viewportWidth - viewportHeight) ** 2 + maximumCssPixels * 4)
    - viewportWidth
    - viewportHeight
  ) / 4
  let overscan = Math.min(preferredOverscan, Math.max(0, Math.floor(capacity)))
  while (overscan > 0) {
    const bitmapWidth = Math.ceil((viewportWidth + overscan * 2) * pixelRatio)
    const bitmapHeight = Math.ceil((viewportHeight + overscan * 2) * pixelRatio)
    if (bitmapWidth * bitmapHeight <= maximum) break
    overscan -= 1
  }
  return overscan
}
