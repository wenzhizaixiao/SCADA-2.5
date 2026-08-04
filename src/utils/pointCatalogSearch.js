export const DEFAULT_POINT_CATALOG_SCAN_SIZE = 512

function normalizedText(value) {
  return String(value ?? '').trim()
}

function normalizedSearchText(value) {
  return normalizedText(value).toLocaleLowerCase('zh-CN')
}

function defaultPointId(point) {
  return normalizedText(point?.id || point?.pointId || point?.key)
}

function defaultSearchValues(point, id) {
  return [
    id,
    point?.name,
    point?.label,
    point?.group,
    point?.groupName,
    point?.sourceGroup,
    point?.sourceName,
    point?.source,
    point?.connectionName,
    point?.protocol,
    point?.sourceType
  ]
}

function defaultNormalize(point, id) {
  return { source: point, id }
}

function positiveInteger(value, fallback) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0
    ? Math.max(1, Math.floor(normalized))
    : fallback
}

function pointMatchesQuery(point, id, query, getSearchValues) {
  if (!query) return true
  const values = getSearchValues(point, id)
  const candidates = Array.isArray(values) ? values : [values]
  return candidates.some(value => normalizedSearchText(value).includes(query))
}

/**
 * 创建一个可恢复的点位目录扫描器。扫描状态保留在游标中，调用方可以在浏览器空闲片段中
 * 多次执行 runSlice，避免一次性为大目录构建搜索文本和索引。
 */
export function createPointCatalogScan(points, query = '', options = {}) {
  const source = Array.isArray(points) ? points : []
  const sourceLength = source.length
  const getId = typeof options.getId === 'function' ? options.getId : defaultPointId
  const getSearchValues = typeof options.getSearchValues === 'function'
    ? options.getSearchValues
    : defaultSearchValues
  const normalize = typeof options.normalize === 'function' ? options.normalize : defaultNormalize
  const normalizedQuery = normalizedSearchText(query)
  const matches = []
  const usedIds = new Set()
  let cursor = 0
  let cancelled = false

  function cancel() {
    cancelled = true
  }

  function runSlice(sliceOptions = {}) {
    if (cancelled) {
      return Object.freeze({
        added: [],
        cancelled: true,
        done: false,
        operations: 0,
        yielded: false
      })
    }

    const maxOperations = positiveInteger(
      sliceOptions.maxOperations,
      DEFAULT_POINT_CATALOG_SCAN_SIZE
    )
    const requestedMatchLimit = Number(sliceOptions.stopAfterMatches)
    const stopAfterMatches = Number.isFinite(requestedMatchLimit) && requestedMatchLimit >= 0
      ? Math.max(0, Math.floor(requestedMatchLimit))
      : Number.POSITIVE_INFINITY
    const shouldYield = typeof sliceOptions.shouldYield === 'function'
      ? sliceOptions.shouldYield
      : () => false
    const added = []
    let operations = 0
    let yielded = false

    while (
      cursor < sourceLength
      && operations < maxOperations
      && matches.length < stopAfterMatches
    ) {
      if (operations > 0 && shouldYield()) {
        yielded = true
        break
      }

      const point = source[cursor]
      cursor += 1
      operations += 1
      const id = getId(point)
      if (!id || usedIds.has(id)) continue
      usedIds.add(id)
      if (!pointMatchesQuery(point, id, normalizedQuery, getSearchValues)) continue

      const normalized = normalize(point, id)
      if (normalized == null) continue
      matches.push(normalized)
      added.push(normalized)
    }

    return Object.freeze({
      added,
      cancelled: false,
      done: cursor >= sourceLength,
      operations,
      yielded
    })
  }

  return Object.freeze({
    cancel,
    runSlice,
    get cancelled() { return cancelled },
    get cursor() { return cursor },
    get done() { return !cancelled && cursor >= sourceLength },
    get matches() { return matches }
  })
}

/**
 * 为少量指定 ID 创建分片查询。扫描过程只解析 ID，只有命中项才会执行 normalize。
 */
export function createPointCatalogLookup(points, pointIds, options = {}) {
  const source = Array.isArray(points) ? points : []
  const sourceLength = source.length
  const getId = typeof options.getId === 'function' ? options.getId : defaultPointId
  const normalize = typeof options.normalize === 'function' ? options.normalize : defaultNormalize
  const pendingIds = new Set(
    (pointIds || []).map(normalizedText).filter(Boolean)
  )
  const matches = new Map()
  let cursor = 0
  let cancelled = false

  function cancel() {
    cancelled = true
  }

  function runSlice(sliceOptions = {}) {
    if (cancelled) {
      return Object.freeze({ added: [], cancelled: true, done: false, operations: 0, yielded: false })
    }

    const maxOperations = positiveInteger(
      sliceOptions.maxOperations,
      DEFAULT_POINT_CATALOG_SCAN_SIZE
    )
    const shouldYield = typeof sliceOptions.shouldYield === 'function'
      ? sliceOptions.shouldYield
      : () => false
    const added = []
    let operations = 0
    let yielded = false

    while (cursor < sourceLength && pendingIds.size && operations < maxOperations) {
      if (operations > 0 && shouldYield()) {
        yielded = true
        break
      }
      const point = source[cursor]
      cursor += 1
      operations += 1
      const id = getId(point)
      if (!pendingIds.has(id)) continue
      const normalized = normalize(point, id)
      if (normalized != null) {
        matches.set(id, normalized)
        added.push(normalized)
      }
      pendingIds.delete(id)
    }

    return Object.freeze({
      added,
      cancelled: false,
      done: cursor >= sourceLength || pendingIds.size === 0,
      operations,
      yielded
    })
  }

  return Object.freeze({
    cancel,
    runSlice,
    get cancelled() { return cancelled },
    get cursor() { return cursor },
    get done() { return !cancelled && (cursor >= sourceLength || pendingIds.size === 0) },
    get matches() { return matches }
  })
}

/**
 * 已绑定关系只需要少量指定点位。这里只遍历 ID，并且只为命中的点位创建展示对象。
 */
export function resolvePointCatalogEntries(points, pointIds, options = {}) {
  const lookup = createPointCatalogLookup(points, pointIds, options)
  while (!lookup.done) {
    lookup.runSlice({ maxOperations: Math.max(1, Array.isArray(points) ? points.length : 1) })
  }
  return lookup.matches
}
