function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function nextPreviewMountBatchScale(currentScale, elapsedMs) {
  const scale = boundedInteger(currentScale, 1, 1, 16)
  const elapsed = Math.max(0, Number(elapsedMs) || 0)
  if (elapsed < 3) return Math.min(16, scale * 2)
  if (elapsed > 8) return Math.max(1, Math.floor(scale / 2))
  return scale
}

export function previewNodeMountCost(node) {
  if (node?.type === 'video') return 32
  if (
    ['image', 'customImageMotion'].includes(node?.type)
    && /(?:^data:image\/(?:gif|apng|webp)|\.(?:gif|apng|webp)(?:$|[?#]))/i.test(String(node.imageUrl || '').trim())
  ) return 24
  if (node?.type === 'table') {
    const columns = boundedInteger(node.tableColumns ?? node.tableHeaders?.length, 3, 1, 12)
    const rows = boundedInteger(node.tableRows ?? node.tableCells?.length, 3, 1, 50)
    return 16 + columns * (rows + (node.showHeader === false ? 0 : 1))
  }
  if (node?.type === 'select') {
    const optionCount = Array.isArray(node.options)
      ? node.options.length
      : String(node.options || '').split(/[,;\n]/).filter(Boolean).length
    return 10 + Math.min(200, optionCount)
  }
  if (String(node?.type || '').startsWith('custom') || (node?.animation && node.animation !== 'none')) return 12
  return 8
}

export function previewMountBatchEnd(nodes, start = 0, options = {}) {
  const source = Array.isArray(nodes) ? nodes : []
  const first = Math.max(0, Math.min(source.length, Math.floor(Number(start)) || 0))
  const maxNodes = boundedInteger(options.maxNodes, 128, 1, 1024)
  const costBudget = boundedInteger(options.costBudget, 1024, 32, 16384)
  let cost = 0
  let end = first
  while (end < source.length && end - first < maxNodes) {
    const nextCost = previewNodeMountCost(source[end])
    if (end > first && cost + nextCost > costBudget) break
    cost += nextCost
    end += 1
    if (cost >= costBudget) break
  }
  return end
}

export function partitionRetainedPreviewNodes(sourceNodes, visibleNodes) {
  const source = Array.isArray(sourceNodes) ? sourceNodes : []
  const visible = Array.isArray(visibleNodes) ? visibleNodes : []
  if (!visible.length) {
    return {
      retainedIds: new Set(),
      retainedNodes: [],
      pendingNodes: source
    }
  }
  const sourceById = new Map(source.map(node => [node.id, node]))
  const retainedIds = new Set()
  const retainedNodes = []
  for (const node of visible) {
    const current = sourceById.get(node?.id)
    if (!current || retainedIds.has(current.id)) continue
    retainedIds.add(current.id)
    retainedNodes.push(current)
  }
  return {
    retainedIds,
    retainedNodes,
    pendingNodes: source.filter(node => !retainedIds.has(node.id))
  }
}
