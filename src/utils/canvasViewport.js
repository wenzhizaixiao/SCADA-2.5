function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback)
  return number > 0 ? number : fallback
}

export const MIN_CANVAS_ZOOM = .2
export const MAX_CANVAS_ZOOM = 10
export const CANVAS_ZOOM_FACTOR = 1.1

export function clampCanvasZoom(value, fallback = 1) {
  const fallbackZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, positiveNumber(fallback, 1)))
  const zoom = positiveNumber(value, fallbackZoom)
  return Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom))
}

export function steppedCanvasZoom(value, steps) {
  const sourceZoom = clampCanvasZoom(value)
  const stepCount = finiteNumber(steps, 0)
  const targetLog = Math.log(sourceZoom) + Math.log(CANVAS_ZOOM_FACTOR) * stepCount
  if (targetLog <= Math.log(MIN_CANVAS_ZOOM)) return MIN_CANVAS_ZOOM
  if (targetLog >= Math.log(MAX_CANVAS_ZOOM)) return MAX_CANVAS_ZOOM
  return clampCanvasZoom(Math.exp(targetLog), sourceZoom)
}

/**
 * 合并连续缩放手势涉及的世界坐标范围。已覆盖时返回原对象，
 * 调用方可据此避免无意义的响应式更新和 DOM 重排。
 */
export function expandCanvasBounds(current, next) {
  if (!current) return next ? { ...next } : null
  if (!next) return current
  const currentRight = finiteNumber(current.x, 0) + Math.max(0, finiteNumber(current.w, 0))
  const currentBottom = finiteNumber(current.y, 0) + Math.max(0, finiteNumber(current.h, 0))
  const nextRight = finiteNumber(next.x, 0) + Math.max(0, finiteNumber(next.w, 0))
  const nextBottom = finiteNumber(next.y, 0) + Math.max(0, finiteNumber(next.h, 0))
  const left = Math.min(finiteNumber(current.x, 0), finiteNumber(next.x, 0))
  const top = Math.min(finiteNumber(current.y, 0), finiteNumber(next.y, 0))
  const right = Math.max(currentRight, nextRight)
  const bottom = Math.max(currentBottom, nextBottom)
  if (left === current.x && top === current.y && right === currentRight && bottom === currentBottom) return current
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function anchoredCanvasScroll({
  scrollLeft = 0,
  scrollTop = 0,
  fromZoom = 1,
  toZoom = 1,
  anchorX = 0,
  anchorY = 0,
  anchorWorldX,
  anchorWorldY
}) {
  const oldZoom = positiveNumber(fromZoom, 1)
  const nextZoom = positiveNumber(toZoom, oldZoom)
  const x = finiteNumber(anchorX, 0)
  const y = finiteNumber(anchorY, 0)
  const left = finiteNumber(scrollLeft, 0)
  const top = finiteNumber(scrollTop, 0)
  const worldX = finiteNumber(anchorWorldX, (left + x) / oldZoom)
  const worldY = finiteNumber(anchorWorldY, (top + y) / oldZoom)

  return {
    left: worldX * nextZoom - x,
    top: worldY * nextZoom - y
  }
}
