export const RUNTIME_DENSE_NODE_THRESHOLD = 1024
export const RUNTIME_DENSE_BITMAP_COVERAGE = 0.35
export const RUNTIME_DENSE_REGION_THRESHOLD = 64

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : fallback
}

export function createRuntimeBitmapCoverageTracker(options = {}) {
  const bitmapWidth = positiveInteger(options.bitmapWidth, 1)
  const bitmapHeight = positiveInteger(options.bitmapHeight, 1)
  const tileSize = positiveInteger(options.tileSize, 64)
  const columns = Math.ceil(bitmapWidth / tileSize)
  const coveredTiles = new Set()
  let coveredPixels = 0

  function add(rect) {
    if (!rect) return false
    const left = Math.max(0, Math.floor(Number(rect.x) || 0))
    const top = Math.max(0, Math.floor(Number(rect.y) || 0))
    const right = Math.min(bitmapWidth, Math.ceil((Number(rect.x) || 0) + Math.max(0, Number(rect.w) || 0)))
    const bottom = Math.min(bitmapHeight, Math.ceil((Number(rect.y) || 0) + Math.max(0, Number(rect.h) || 0)))
    if (right <= left || bottom <= top) return false

    const firstColumn = Math.floor(left / tileSize)
    const lastColumn = Math.floor((right - 1) / tileSize)
    const firstRow = Math.floor(top / tileSize)
    const lastRow = Math.floor((bottom - 1) / tileSize)
    let changed = false
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const key = row * columns + column
        if (coveredTiles.has(key)) continue
        coveredTiles.add(key)
        const tileLeft = column * tileSize
        const tileTop = row * tileSize
        coveredPixels += Math.min(tileSize, bitmapWidth - tileLeft) * Math.min(tileSize, bitmapHeight - tileTop)
        changed = true
      }
    }
    return changed
  }

  return Object.freeze({
    add,
    get coverage() { return coveredPixels / (bitmapWidth * bitmapHeight) },
    get coveredPixels() { return coveredPixels },
    get tileCount() { return coveredTiles.size }
  })
}

export function shouldUseDenseRuntime(options = {}) {
  if (options.available === false) return false
  const nodeCount = Math.max(0, Number(options.nodeCount) || 0)
  const regionCount = Math.max(0, Number(options.regionCount) || 0)
  const coverage = Math.max(0, Number(options.coverage) || 0)
  return nodeCount >= positiveInteger(options.nodeThreshold, RUNTIME_DENSE_NODE_THRESHOLD)
    || regionCount > positiveInteger(options.regionThreshold, RUNTIME_DENSE_REGION_THRESHOLD)
    || coverage >= Math.max(0, Number(options.coverageThreshold) || RUNTIME_DENSE_BITMAP_COVERAGE)
}
