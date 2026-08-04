function normalizePointIds(pointIds) {
  if (pointIds == null) return []
  const values = typeof pointIds === 'string' ? [pointIds] : pointIds
  const normalized = new Set()
  for (const value of values) {
    const pointId = String(value ?? '').trim()
    if (pointId) normalized.add(pointId)
  }
  return [...normalized]
}

function lifecycleActive(isActive) {
  try {
    return isActive() === true
  } catch {
    return false
  }
}

function pointActive(isPointActive, pointId) {
  try {
    return isPointActive(pointId) === true
  } catch {
    return false
  }
}

/**
 * 为动态插入的旧 pointId/dataKey 执行定向批量恢复，不扫描整张图或完整点位目录。
 * 图纸生命周期失效后丢弃晚到结果；同一点位的旧请求也不能覆盖较新的值。
 */
export function createLegacyPointReplayCoordinator({
  readPoints,
  commitUpdates,
  isActive = () => true,
  isPointActive = () => true
} = {}) {
  if (typeof readPoints !== 'function') throw new TypeError('readPoints must be a function')
  if (typeof commitUpdates !== 'function') throw new TypeError('commitUpdates must be a function')
  if (typeof isActive !== 'function') throw new TypeError('isActive must be a function')
  if (typeof isPointActive !== 'function') throw new TypeError('isPointActive must be a function')

  let lifecycleEpoch = 0
  const pointRequestTokens = new Map()
  const state = {}
  Object.defineProperty(state, 'pendingPoints', {
    enumerable: true,
    get: () => pointRequestTokens.size
  })
  Object.freeze(state)

  function invalidate() {
    lifecycleEpoch += 1
    pointRequestTokens.clear()
  }

  async function replay(pointIds) {
    const epoch = lifecycleEpoch
    const requestedPointIds = normalizePointIds(pointIds)
    if (!requestedPointIds.length) return lifecycleActive(isActive)
    const requestToken = Symbol('legacy-point-replay')
    const requested = new Set(requestedPointIds)
    for (const pointId of requestedPointIds) pointRequestTokens.set(pointId, requestToken)

    try {
      const points = await readPoints(requestedPointIds)
      if (epoch !== lifecycleEpoch || !lifecycleActive(isActive)) return false
      const updates = []
      for (const point of Array.isArray(points) ? points : []) {
        let pointId
        let value
        try {
          pointId = String(point?.id ?? '').trim()
          value = point?.value
        } catch {
          continue
        }
        if (!pointId || !requested.has(pointId) || pointRequestTokens.get(pointId) !== requestToken) continue
        if (!pointActive(isPointActive, pointId)) continue
        updates.push({ key: pointId, value })
      }
      if (updates.length) commitUpdates(updates)
      return true
    } catch {
      // 连接不可用时组件继续显示图纸中的静态值，不中断新增、粘贴或撤销流程。
      return epoch === lifecycleEpoch && lifecycleActive(isActive)
    } finally {
      // 只清理仍指向本次令牌的键，不能删除后续请求已经接管的同名点位。
      for (const pointId of requestedPointIds) {
        if (pointRequestTokens.get(pointId) === requestToken) pointRequestTokens.delete(pointId)
      }
    }
  }

  return Object.freeze({ replay, invalidate, state })
}
