function defaultIdleDeadline() {
  return { didTimeout: true, timeRemaining: () => 0 }
}

export function createCancellableIdleTask(options = {}) {
  const requestIdle = options.requestIdle ?? (typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback.bind(globalThis)
    : null)
  const cancelIdle = options.cancelIdle ?? (typeof globalThis.cancelIdleCallback === 'function'
    ? globalThis.cancelIdleCallback.bind(globalThis)
    : null)
  const setTimer = options.setTimer || globalThis.setTimeout.bind(globalThis)
  const clearTimer = options.clearTimer || globalThis.clearTimeout.bind(globalThis)
  const timeout = Math.max(0, Number(options.timeout) || 0)
  let pending = null
  let generation = 0
  let disposed = false

  function cancel() {
    generation += 1
    if (pending?.type === 'idle') cancelIdle?.(pending.id)
    else if (pending) clearTimer(pending.id)
    pending = null
  }

  function schedule(callback) {
    if (disposed) return false
    if (typeof callback !== 'function') throw new TypeError('Idle task callback is required')
    cancel()
    const scheduledGeneration = generation
    const run = deadline => {
      if (disposed || generation !== scheduledGeneration) return
      pending = null
      callback(deadline || defaultIdleDeadline())
    }
    if (requestIdle) {
      try {
        pending = { type: 'idle', id: requestIdle(run, { timeout }) }
        return true
      } catch {}
    }
    pending = { type: 'timer', id: setTimer(() => run(defaultIdleDeadline()), 0) }
    return true
  }

  function dispose() {
    if (disposed) return
    cancel()
    disposed = true
  }

  return {
    cancel,
    dispose,
    schedule,
    get pending() { return pending !== null }
  }
}
