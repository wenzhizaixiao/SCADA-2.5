function normalizedPointId(point) {
  return String(point?.id ?? '').trim()
}

function primitive(value) {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

function pointValueChanged(previous, next) {
  if (String(previous?.type ?? '') !== String(next?.type ?? '')) return true
  if (String(previous?.status ?? '') !== String(next?.status ?? '')) return true

  const previousValue = previous?.value
  const nextValue = next?.value
  if (primitive(previousValue) || primitive(nextValue)) return !Object.is(previousValue, nextValue)

  // 结构化值由采集端的更新时间充当版本，避免目录刷新时深比较并重绘全部表格和图表。
  const previousVersion = String(previous?.updatedAt ?? '')
  const nextVersion = String(next?.updatedAt ?? '')
  if (previousVersion && nextVersion) return previousVersion !== nextVersion
  return previousValue !== nextValue
}

/** 返回目录提交后需要清空和重放的最小点位集合。 */
export function diffPointCatalog(previousPoints, nextPoints) {
  const previous = Array.isArray(previousPoints) ? previousPoints : []
  const next = Array.isArray(nextPoints) ? nextPoints : []
  const previousById = new Map(previous.map(point => [normalizedPointId(point), point]).filter(([id]) => id))
  const nextIds = new Set(next.map(normalizedPointId).filter(Boolean))
  const invalidatedPointIds = previous
    .map(normalizedPointId)
    .filter(id => id && !nextIds.has(id))
  const changedPointIds = []

  for (const point of next) {
    const id = normalizedPointId(point)
    if (!id) continue
    const oldPoint = previousById.get(id)
    if (!oldPoint || pointValueChanged(oldPoint, point)) changedPointIds.push(id)
  }

  return { invalidatedPointIds, changedPointIds }
}
