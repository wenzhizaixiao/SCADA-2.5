export const MIN_EDITOR_LOD_GRID_SCREEN_PITCH = 8
export const MIN_EDITOR_LOD_GRID_SCREEN_STROKE = 1

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function editorLodGridPresentation(options = {}) {
  const gridSize = positiveNumber(options.gridSize, 10)
  const zoom = positiveNumber(options.zoom, 1)
  const minimumPitch = positiveNumber(
    options.minimumPitch,
    MIN_EDITOR_LOD_GRID_SCREEN_PITCH
  )
  const basePitch = gridSize * zoom
  const exponent = basePitch < minimumPitch
    ? Math.min(20, Math.ceil(Math.log2(minimumPitch / basePitch)))
    : 0
  const stepMultiplier = 2 ** exponent

  return {
    stepMultiplier,
    worldStep: gridSize * stepMultiplier,
    screenPitch: basePitch * stepMultiplier,
    stroke: MIN_EDITOR_LOD_GRID_SCREEN_STROKE,
    dotSize: Math.max(1, Math.min(1.5, 1.25 * zoom * Math.sqrt(stepMultiplier)))
  }
}
