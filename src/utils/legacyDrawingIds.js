function legacyDrawingIdBase(drawing, index) {
  const rawId = String(drawing?.id ?? index + 1).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96) || `${index + 1}`
  return `pencil-${rawId}`
}

export function allocateLegacyDrawingNodeIds(drawings, nodes) {
  const sourceDrawings = Array.isArray(drawings) ? drawings : []
  const sourceNodes = Array.isArray(nodes) ? nodes : []
  const usedIds = new Set(sourceNodes.map(node => node?.id))
  const nextSuffixByBase = new Map()

  return sourceDrawings.map((drawing, index) => {
    const base = legacyDrawingIdBase(drawing, index)
    let suffix = nextSuffixByBase.get(base) || 1
    let id = suffix === 1 ? base : `${base}-${suffix}`
    while (usedIds.has(id)) {
      suffix = suffix === 1 ? 2 : suffix + 1
      id = `${base}-${suffix}`
    }
    usedIds.add(id)
    nextSuffixByBase.set(base, suffix === 1 ? 2 : suffix + 1)
    return id
  })
}
