export const DEFAULT_SYNC_INCIDENT_EDGE_LIMIT = 128

export function incidentEdgeCountExceedsLimit(adjacency, nodeIds, limit = DEFAULT_SYNC_INCIDENT_EDGE_LIMIT) {
  const maximum = Math.max(0, Math.floor(Number(limit) || 0))
  const uniqueNodeIds = new Set(nodeIds || [])
  let count = 0
  for (const nodeId of uniqueNodeIds) {
    count += Math.max(0, Number(adjacency?.countFor?.(nodeId)) || 0)
    if (count > maximum) return true
  }
  return false
}
