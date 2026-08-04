export const DEFAULT_POINT_CATALOG_PREPARATION_BUDGET_MS = 4
export const DEFAULT_POINT_CATALOG_PREPARATION_MAX_OPERATIONS = 4096

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (
    typeof globalThis.requestAnimationFrame === 'function'
    && globalThis.document?.visibilityState !== 'hidden'
  ) return { kind: 'frame', handle: globalThis.requestAnimationFrame(callback) }
  return { kind: 'timeout', handle: globalThis.setTimeout(callback, 0) }
}

function defaultCancel(request) {
  if (request?.kind === 'frame' && typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(request.handle)
    return
  }
  globalThis.clearTimeout(request?.handle ?? request)
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`)
  return value
}

function entityId(value, label) {
  const id = String(value ?? '').trim()
  if (!id) throw new TypeError(`${label} ID is required`)
  return id
}

export function createPointCatalogPreparationTask(sourceInput, options = {}) {
  if (!Array.isArray(sourceInput)) throw new TypeError('Point catalog sources must be an array')
  return {
    sourceInput,
    normalized: options.normalized === true,
    sourceCursor: 0,
    pointCursor: 0,
    current: null,
    sourceIds: new Set(),
    pointIds: new Set(),
    sources: [],
    sourceIndex: new Map(),
    pointIndex: new Map(),
    healthyPointCountBySource: new Map(),
    offlinePointCountBySource: new Map(),
    result: null
  }
}

function beginSource(task, callbacks) {
  const input = task.sourceInput[task.sourceCursor++]
  const source = task.normalized ? input : callbacks.normalizeSource(input)
  const sourceId = entityId(callbacks.sourceId(source), 'Source')
  if (task.sourceIds.has(sourceId)) throw new TypeError(`数据源 ID 重复：${sourceId}`)
  task.sourceIds.add(sourceId)

  const inputPoints = Array.isArray(input?.points) ? input.points : []
  if (!task.normalized) source.points = []
  else if (!Array.isArray(source?.points)) throw new TypeError(`Source points must be an array: ${sourceId}`)

  task.sources.push(source)
  task.sourceIndex.set(sourceId, source)
  task.current = {
    source,
    sourceId,
    inputPoints,
    healthyPointCount: 0,
    offlinePointCount: 0
  }
  task.pointCursor = 0
}

function preparePoint(task, callbacks) {
  const current = task.current
  const input = current.inputPoints[task.pointCursor++]
  const point = task.normalized ? input : callbacks.normalizePoint(input, current.source)
  const pointId = entityId(callbacks.pointId(point), 'Point')
  if (task.pointIds.has(pointId)) throw new TypeError(`点位 ID 重复：${pointId}`)
  task.pointIds.add(pointId)

  if (!task.normalized) current.source.points.push(point)
  task.pointIndex.set(pointId, { sourceId: current.sourceId, point })
  const status = callbacks.pointStatus(point)
  if (status === 'good') current.healthyPointCount += 1
  if (status === 'offline') current.offlinePointCount += 1
}

function finishSource(task) {
  const current = task.current
  task.healthyPointCountBySource.set(current.sourceId, current.healthyPointCount)
  task.offlinePointCountBySource.set(current.sourceId, current.offlinePointCount)
  task.current = null
  task.pointCursor = 0
}

function finishTask(task) {
  task.result = Object.freeze({
    sources: task.sources,
    sourceIndex: task.sourceIndex,
    pointIndex: task.pointIndex,
    healthyPointCountBySource: task.healthyPointCountBySource,
    offlinePointCountBySource: task.offlinePointCountBySource
  })
}

export function runPointCatalogPreparationSlice(task, deadline = {}, options = {}) {
  if (!task || task.result) return true
  const normalizeSource = requiredFunction(options.normalizeSource, 'normalizeSource')
  const normalizePoint = requiredFunction(options.normalizePoint, 'normalizePoint')
  const callbacks = {
    normalizeSource,
    normalizePoint,
    sourceId: typeof options.sourceId === 'function' ? options.sourceId : source => source?.id,
    pointId: typeof options.pointId === 'function' ? options.pointId : point => point?.id,
    pointStatus: typeof options.pointStatus === 'function' ? options.pointStatus : point => point?.status
  }
  const shouldYield = typeof deadline.shouldYield === 'function' ? deadline.shouldYield : () => false
  const maximum = Math.max(
    1,
    Math.floor(Number(options.maxOperationsPerSlice) || DEFAULT_POINT_CATALOG_PREPARATION_MAX_OPERATIONS)
  )
  let operations = 0

  while (!task.result && operations < maximum && (operations === 0 || !shouldYield())) {
    if (!task.current) {
      if (task.sourceCursor >= task.sourceInput.length) {
        finishTask(task)
        break
      }
      beginSource(task, callbacks)
      operations += 1
      continue
    }

    if (task.pointCursor < task.current.inputPoints.length) {
      preparePoint(task, callbacks)
      operations += 1
      continue
    }
    finishSource(task)
  }
  return Boolean(task.result)
}

export class PointCatalogPreparationCancelledError extends Error {
  constructor(reason = 'cancelled') {
    super(`Point catalog preparation ${reason}`)
    this.name = 'PointCatalogPreparationCancelledError'
    this.reason = reason
  }
}

export function createPointCatalogPreparer(options = {}) {
  const schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule
  const cancel = typeof options.cancel === 'function' ? options.cancel : defaultCancel
  const now = typeof options.now === 'function' ? options.now : defaultNow
  const budgetMs = Math.max(.25, Number(options.budgetMs) || DEFAULT_POINT_CATALOG_PREPARATION_BUDGET_MS)
  const callbacks = {
    normalizeSource: requiredFunction(options.normalizeSource, 'normalizeSource'),
    normalizePoint: requiredFunction(options.normalizePoint, 'normalizePoint'),
    sourceId: options.sourceId,
    pointId: options.pointId,
    pointStatus: options.pointStatus,
    maxOperationsPerSlice: options.maxOperationsPerSlice
  }
  let generation = 0
  let active = null
  let disposed = false

  const state = Object.freeze({
    get pending() { return active != null },
    get generation() { return generation },
    get disposed() { return disposed }
  })

  function retire(reason) {
    const job = active
    if (!job) return false
    active = null
    if (job.handle != null) cancel(job.handle)
    job.reject(new PointCatalogPreparationCancelledError(reason))
    return true
  }

  function fail(job, error) {
    if (active === job) active = null
    job.reject(error)
  }

  function scheduleSlice(job) {
    try {
      job.handle = schedule(() => {
        job.handle = null
        if (active !== job || disposed || job.generation !== generation) return
        const expiresAt = now() + budgetMs
        try {
          const done = runPointCatalogPreparationSlice(
            job.task,
            { shouldYield: () => now() >= expiresAt },
            callbacks
          )
          if (done) {
            active = null
            job.resolve(job.task.result)
          } else scheduleSlice(job)
        } catch (error) {
          fail(job, error)
        }
      })
    } catch (error) {
      fail(job, error)
    }
  }

  function prepare(sourceInput, prepareOptions = {}) {
    if (disposed) return Promise.reject(new PointCatalogPreparationCancelledError('disposed'))
    retire('superseded')
    let task
    try {
      task = createPointCatalogPreparationTask(sourceInput, prepareOptions)
    } catch (error) {
      return Promise.reject(error)
    }
    const jobGeneration = ++generation
    return new Promise((resolve, reject) => {
      const job = { generation: jobGeneration, task, handle: null, resolve, reject }
      active = job
      scheduleSlice(job)
    })
  }

  function invalidate(reason = 'invalidated') {
    generation += 1
    retire(reason)
    return generation
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation += 1
    retire('disposed')
  }

  return Object.freeze({ state, prepare, invalidate, dispose })
}
