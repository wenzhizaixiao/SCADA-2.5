function finiteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function rectangularNodeBorderGeometry(node = {}) {
  const width = Math.max(.1, finiteNumber(node.w, 1))
  const height = Math.max(.1, finiteNumber(node.h, 1))
  const requestedStroke = node.borderWidth == null ? 2 : finiteNumber(node.borderWidth, 2)
  const strokeWidth = Math.min(
    Math.max(0, requestedStroke),
    Math.max(0, width - .1),
    Math.max(0, height - .1)
  )
  const frameWidth = Math.max(.1, width - strokeWidth)
  const frameHeight = Math.max(.1, height - strokeWidth)
  const requestedRadius = Math.max(0, finiteNumber(node.radius, 0))
  const outerRadius = Math.min(requestedRadius, width / 2, height / 2)
  const radius = Math.max(0, Math.min(
    outerRadius - strokeWidth / 2,
    frameWidth / 2,
    frameHeight / 2
  ))
  return { width: frameWidth, height: frameHeight, strokeWidth, outerRadius, radius }
}
