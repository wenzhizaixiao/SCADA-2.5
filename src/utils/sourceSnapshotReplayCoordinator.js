function normalizeSourceIds(sourceIds) {
  if (sourceIds == null) return []
  const values = typeof sourceIds === 'string' ? [sourceIds] : sourceIds
  const normalized = new Set()
  for (const value of values) {
    const sourceId = String(value ?? '').trim()
    if (sourceId) normalized.add(sourceId)
  }
  return [...normalized]
}

/**
 * 协调数据源快照的异步重放：不同数据源互不取消，同一数据源只允许最新请求提交。
 * invalidate 用于图纸替换、工作空间切换和组件卸载，防止旧请求污染新上下文。
 */
export function createSourceSnapshotReplayCoordinator({
  readSnapshot,
  commitSnapshot,
  isActive = () => true
} = {}) {
  if (typeof readSnapshot !== 'function') throw new TypeError('readSnapshot must be a function')
  if (typeof commitSnapshot !== 'function') throw new TypeError('commitSnapshot must be a function')
  if (typeof isActive !== 'function') throw new TypeError('isActive must be a function')

  let lifecycleEpoch = 0
  const sourceRequestTokens = new Map()
  const state = {}
  Object.defineProperty(state, 'pendingSources', {
    enumerable: true,
    get: () => sourceRequestTokens.size
  })
  Object.freeze(state)

  function lifecycleIsActive() {
    try {
      return isActive() === true
    } catch {
      return false
    }
  }

  function requestIsCurrent(request) {
    return request.epoch === lifecycleEpoch
      && sourceRequestTokens.get(request.sourceId) === request.token
      && lifecycleIsActive()
  }

  function invalidate() {
    lifecycleEpoch += 1
    sourceRequestTokens.clear()
  }

  async function replay(sourceIds, { force = false } = {}) {
    const epoch = lifecycleEpoch
    // 快照读取命中网关内存缓存，可并行完成；这里不会发起协议采集请求。
    const requests = normalizeSourceIds(sourceIds).map(sourceId => {
      const token = Symbol('source-snapshot-replay')
      sourceRequestTokens.set(sourceId, token)
      return { epoch, sourceId, token }
    })

    const outcomes = await Promise.all(requests.map(async request => {
      try {
        const snapshot = await readSnapshot(request.sourceId)
        if (!requestIsCurrent(request)) return false
        if (snapshot) {
          // 网关结果必须与请求来源一致，避免异常适配器把其他连接的数据串入当前组件。
          const snapshotSourceId = String(snapshot.sourceId ?? '').trim()
          if (snapshotSourceId !== request.sourceId) return true
          commitSnapshot(snapshot, { replay: force === true })
        }
        return true
      } catch {
        // 数据源暂不可用时保留组件静态值；只有上下文失效才判定本次重放已取消。
        return requestIsCurrent(request)
      } finally {
        if (sourceRequestTokens.get(request.sourceId) === request.token) {
          sourceRequestTokens.delete(request.sourceId)
        }
      }
    }))

    return epoch === lifecycleEpoch
      && lifecycleIsActive()
      && outcomes.every(Boolean)
  }

  return Object.freeze({ replay, invalidate, state })
}
