export const NODE_MOVE_INTERACTION_OPACITY = 0.62

function normalizedOpacity(value, fallback = 1) {
  const parsed = Number(value)
  const resolved = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(0, Math.min(1, resolved))
}

export function multiplyOpacity(opacity, multiplier = 1) {
  return normalizedOpacity(opacity) * normalizedOpacity(multiplier)
}
