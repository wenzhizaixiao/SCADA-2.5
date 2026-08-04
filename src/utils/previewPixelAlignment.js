function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function previewPixelAlignedOffset(options = {}) {
  const available = Math.max(0, finiteNumber(options.available))
  const rendered = Math.max(0, finiteNumber(options.rendered))
  const gap = Math.max(0, available - rendered)
  if (!gap) return 0

  const origin = finiteNumber(options.origin)
  const pixelRatio = Math.max(1, finiteNumber(options.devicePixelRatio, 1))
  const centered = gap / 2
  const aligned = Math.round((origin + centered) * pixelRatio) / pixelRatio - origin
  return Math.max(0, Math.min(gap, aligned))
}
