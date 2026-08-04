function finite(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function edgeNodeCenter(node) {
  return {
    x: finite(node?.x) + finite(node?.w, 1) / 2,
    y: finite(node?.y) + finite(node?.h, 1) / 2
  }
}

export function edgeNodeBoundaryPoint(node, toward, padding = 0) {
  const center = edgeNodeCenter(node)
  let dx = finite(toward?.x) - center.x
  const dy = finite(toward?.y) - center.y
  if (Math.abs(dx) + Math.abs(dy) < .001) dx = 1
  const angle = finite(node?.rotate) * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  const halfWidth = Math.max(1, finite(node?.w, 1) / 2) + padding
  const halfHeight = Math.max(1, finite(node?.h, 1) / 2) + padding
  const distance = 1 / Math.max(Math.abs(localX) / halfWidth, Math.abs(localY) / halfHeight)
  const boundaryX = localX * distance
  const boundaryY = localY * distance
  return {
    x: center.x + boundaryX * cos - boundaryY * sin,
    y: center.y + boundaryX * sin + boundaryY * cos
  }
}

export function edgeEndpointsForNodes(edge, nodeIndex) {
  const source = nodeIndex.get(edge?.from)
  const target = nodeIndex.get(edge?.to)
  if (!source || !target) return null
  const sourceCenter = edgeNodeCenter(source)
  const targetCenter = edgeNodeCenter(target)
  if (edge.anchorMode === 'center') return { start: sourceCenter, end: targetCenter }
  const markerPadding = marker => marker === 'none' ? 0 : marker === 'arrow' ? 2 : 5
  return {
    start: edgeNodeBoundaryPoint(source, targetCenter, markerPadding(edge.startMarker)),
    end: edgeNodeBoundaryPoint(target, sourceCenter, markerPadding(edge.endMarker))
  }
}

export function edgeBoundsForNodes(edge, nodeIndex, padding = 0) {
  const endpoints = edgeEndpointsForNodes(edge, nodeIndex)
  if (!endpoints) return { x: 0, y: 0, w: 0, h: 0 }
  const margin = Math.max(12, finite(edge?.width, 1) + 8, finite(padding))
  const left = Math.min(endpoints.start.x, endpoints.end.x) - margin
  const top = Math.min(endpoints.start.y, endpoints.end.y) - margin
  return {
    x: left,
    y: top,
    w: Math.max(1, Math.abs(endpoints.end.x - endpoints.start.x)) + margin * 2,
    h: Math.max(1, Math.abs(endpoints.end.y - endpoints.start.y)) + margin * 2
  }
}
