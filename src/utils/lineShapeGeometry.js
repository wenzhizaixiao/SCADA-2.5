export const LINE_SHAPE_MIN_WIDTH = 1
export const LINE_SHAPE_MIN_HEIGHT = .1
export const LINE_SHAPE_MIN_INNER_SIZE = .01

function finiteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function lineShapeWidth(node = {}) {
  return Math.max(LINE_SHAPE_MIN_WIDTH, finiteNumber(node.w, LINE_SHAPE_MIN_WIDTH))
}

export function lineShapeHeight(node = {}) {
  return Math.max(LINE_SHAPE_MIN_HEIGHT, finiteNumber(node.h, 2))
}

export function lineShapeBorderWidth(node = {}) {
  if (node.borderVisible === false) return 0
  const requested = Math.max(0, finiteNumber(node.borderWidth, 0))
  return Math.min(
    requested,
    Math.max(0, lineShapeWidth(node) - LINE_SHAPE_MIN_INNER_SIZE),
    Math.max(0, lineShapeHeight(node) - LINE_SHAPE_MIN_INNER_SIZE)
  )
}

export function lineShapeDashSegments(node = {}) {
  if (node.borderStyle === 'solid') return []
  const fallbackLength = node.borderStyle === 'dotted' ? 2 : 8
  return [
    Math.max(.1, finiteNumber(node.borderDashLength, fallbackLength)),
    Math.max(.1, finiteNumber(node.borderDashGap, 6))
  ]
}

export function lineShapeDashArray(node = {}) {
  const segments = lineShapeDashSegments(node)
  return segments.length ? segments.join(' ') : 'none'
}

export function lineShapeBodyDashSegments(node = {}) {
  const segments = lineShapeDashSegments(node)
  if (!segments.length || node.borderStyle !== 'dotted') return segments
  return [segments[0], segments[1] + lineShapeHeight(node)]
}

export function lineShapeBodyDashArray(node = {}) {
  const segments = lineShapeBodyDashSegments(node)
  return segments.length ? segments.join(' ') : 'none'
}

export function lineShapeBodyInset(node = {}) {
  if (node.borderStyle !== 'dotted') return 0
  return Math.min(lineShapeWidth(node) / 2, lineShapeHeight(node) / 2)
}

export function lineShapeInnerThickness(node = {}) {
  return Math.max(0, lineShapeHeight(node) - lineShapeBorderWidth(node) * 2)
}
