function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`)
  return value
}

export function createCoalescedRenderTrigger(options = {}) {
  const schedule = requiredFunction(options.schedule, 'schedule')
  const cancel = requiredFunction(options.cancel, 'cancel')
  const flush = requiredFunction(options.flush, 'flush')
  let pending = null
  let disposed = false

  const state = Object.freeze({
    get pending() { return pending !== null },
    get disposed() { return disposed }
  })

  function request() {
    if (disposed || pending !== null) return false
    const request = { handle: null }
    pending = request
    try {
      request.handle = schedule(() => {
        if (disposed || pending !== request) return
        pending = null
        flush()
      })
    } catch (error) {
      pending = null
      throw error
    }
    return true
  }

  function cancelPending() {
    if (pending === null) return false
    const request = pending
    pending = null
    cancel(request.handle)
    return true
  }

  function dispose() {
    if (disposed) return
    disposed = true
    cancelPending()
  }

  return Object.freeze({ state, request, cancel: cancelPending, dispose })
}

/**
 * Runs render work against a private task in time-bounded scheduled slices.
 * Only the latest completed generation is committed to the visible target.
 */
export function createChunkedRenderScheduler(options = {}) {
  const budgetSource = typeof options.budgetMs === 'function'
    ? options.budgetMs
    : () => options.budgetMs ?? 3

  function currentBudgetMs() {
    const budgetMs = Number(budgetSource())
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('budgetMs must be greater than zero')
    return budgetMs
  }

  currentBudgetMs()

  const schedule = requiredFunction(options.schedule, 'schedule')
  const cancel = requiredFunction(options.cancel, 'cancel')
  const createTask = requiredFunction(options.createTask, 'createTask')
  const runSlice = requiredFunction(options.runSlice, 'runSlice')
  const commit = requiredFunction(options.commit, 'commit')
  const discard = typeof options.discard === 'function' ? options.discard : () => {}
  const onError = typeof options.onError === 'function' ? options.onError : null
  const now = typeof options.now === 'function' ? options.now : defaultNow

  let generation = 0
  let activeJob = null
  let scheduledHandle = null
  let disposed = false

  const state = Object.freeze({
    get generation() { return generation },
    get pending() { return activeJob != null },
    get scheduled() { return scheduledHandle != null },
    get disposed() { return disposed }
  })

  function discardJob(job, reason) {
    if (!job || job.finished) return
    job.finished = true
    if (job.taskCreated) discard(job.task, job.payload, reason)
  }

  function cancelScheduledHandle() {
    if (scheduledHandle == null) return
    const handle = scheduledHandle
    scheduledHandle = null
    cancel(handle)
  }

  function retireActiveJob(reason) {
    cancelScheduledHandle()
    const job = activeJob
    activeJob = null
    discardJob(job, reason)
  }

  function failJob(job, error, phase) {
    if (activeJob === job) activeJob = null
    discardJob(job, 'error')
    if (!onError) throw error
    onError(error, Object.freeze({ phase, generation: job.generation, payload: job.payload }))
  }

  function deadlineFor(job, hostDeadline) {
    const budgetMs = currentBudgetMs()
    const startedAt = Number(now())
    const hasHostDeadline = typeof hostDeadline?.timeRemaining === 'function'
    const didTimeout = hasHostDeadline && hostDeadline.didTimeout === true
    const hostTimeRemaining = hasHostDeadline
      ? Math.max(0, Number(hostDeadline.timeRemaining()) || 0)
      : Number.POSITIVE_INFINITY
    // Timed-out idle callbacks report no budget; grant one short slice so work cannot starve.
    const sliceBudgetMs = didTimeout ? Math.min(1, budgetMs) : budgetMs
    const expiresAt = startedAt + (didTimeout ? sliceBudgetMs : Math.min(sliceBudgetMs, hostTimeRemaining))
    let timeoutProgressAvailable = didTimeout
    return Object.freeze({
      budgetMs,
      generation: job.generation,
      startedAt,
      expiresAt,
      didTimeout,
      canStart: didTimeout || !hasHostDeadline || hostTimeRemaining >= budgetMs,
      timeRemaining() {
        const ownRemaining = Math.max(0, expiresAt - Number(now()))
        if (!hasHostDeadline || didTimeout) return ownRemaining
        return Math.min(ownRemaining, Math.max(0, Number(hostDeadline.timeRemaining()) || 0))
      },
      shouldYield() {
        if (timeoutProgressAvailable) {
          timeoutProgressAvailable = false
          return false
        }
        if (Number(now()) >= expiresAt) return true
        return hasHostDeadline && !didTimeout && Number(hostDeadline.timeRemaining()) <= 0
      }
    })
  }

  function scheduleNextSlice(job) {
    let handle = null
    const callback = hostDeadline => {
      if (scheduledHandle === handle) scheduledHandle = null
      if (disposed || activeJob !== job || job.generation !== generation || job.finished) return

      let deadline
      try {
        deadline = deadlineFor(job, hostDeadline)
      } catch (error) {
        failJob(job, error, 'deadline')
        return
      }
      if (!deadline.canStart) {
        try {
          scheduleNextSlice(job)
        } catch (error) {
          failJob(job, error, 'schedule')
        }
        return
      }

      let done = false
      let phase = 'create'
      try {
        if (!job.taskCreated) {
          job.task = createTask(job.payload, job.generation)
          job.taskCreated = true
        }
        phase = 'run'
        done = runSlice(job.task, deadline, job.payload) === true
      } catch (error) {
        failJob(job, error, phase)
        return
      }

      if (disposed || activeJob !== job || job.generation !== generation || job.finished) return
      if (!done) {
        try {
          scheduleNextSlice(job)
        } catch (error) {
          failJob(job, error, 'schedule')
        }
        return
      }

      activeJob = null
      try {
        commit(job.task, job.payload)
        job.finished = true
      } catch (error) {
        failJob(job, error, 'commit')
      }
    }

    handle = schedule(callback)
    scheduledHandle = handle
  }

  function request(payload) {
    if (disposed) return null
    retireActiveJob('superseded')
    const requestGeneration = ++generation
    const job = {
      generation: requestGeneration,
      payload,
      task: undefined,
      taskCreated: false,
      finished: false
    }
    activeJob = job
    try {
      scheduleNextSlice(job)
    } catch (error) {
      failJob(job, error, 'schedule')
      return null
    }
    return requestGeneration
  }

  function invalidate(reason = 'invalidated') {
    if (disposed) return generation
    generation += 1
    retireActiveJob(reason)
    return generation
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation += 1
    retireActiveJob('disposed')
  }

  return Object.freeze({ state, request, invalidate, dispose })
}
