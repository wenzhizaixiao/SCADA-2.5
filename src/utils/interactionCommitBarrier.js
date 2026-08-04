function defaultSchedule(callback) {
  return setTimeout(callback, 0)
}

function defaultCancel(handle) {
  clearTimeout(handle)
}

/**
 * Keeps background publication outside active editor interactions.
 * The monotonic generation also detects work that crossed an interaction.
 */
export function createInteractionCommitBarrier(options = {}) {
  const schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule
  const cancel = typeof options.cancel === 'function' ? options.cancel : defaultCancel
  const activeKeys = new Set()
  const deferred = new Map()
  const idleWaiters = new Set()
  let generation = 0
  let resumeHandle = null
  let disposed = false

  const state = Object.freeze({
    get generation() { return generation },
    get active() { return activeKeys.size > 0 },
    get activeCount() { return activeKeys.size },
    get deferredCount() { return deferred.size },
    get disposed() { return disposed }
  })

  function cancelResume() {
    if (resumeHandle == null) return
    const handle = resumeHandle
    resumeHandle = null
    cancel(handle)
  }

  function scheduleResume() {
    if (disposed || activeKeys.size || !deferred.size || resumeHandle != null) return
    const expectedGeneration = generation
    let handle = null
    handle = schedule(() => {
      if (resumeHandle === handle) resumeHandle = null
      if (disposed) return
      if (activeKeys.size || generation !== expectedGeneration) {
        scheduleResume()
        return
      }

      const pending = [...deferred]
      deferred.clear()
      for (let index = 0; index < pending.length; index += 1) {
        const [, callback] = pending[index]
        if (disposed) return
        if (activeKeys.size || generation !== expectedGeneration) {
          for (let rest = index; rest < pending.length; rest += 1) {
            const [pendingKey, pendingCallback] = pending[rest]
            if (!deferred.has(pendingKey)) deferred.set(pendingKey, pendingCallback)
          }
          scheduleResume()
          return
        }
        callback()
      }
      scheduleResume()
    })
    resumeHandle = handle
  }

  function settleIdleWaiters(result) {
    if (activeKeys.size || !idleWaiters.size) return
    const waiters = [...idleWaiters]
    idleWaiters.clear()
    for (const resolve of waiters) resolve(result)
  }

  function begin(key) {
    if (disposed || activeKeys.has(key)) return generation
    cancelResume()
    activeKeys.add(key)
    generation += 1
    return generation
  }

  function end(key) {
    if (disposed || !activeKeys.delete(key)) return generation
    generation += 1
    settleIdleWaiters(true)
    scheduleResume()
    return generation
  }

  function whenIdle() {
    if (disposed) return Promise.resolve(false)
    if (!activeKeys.size) return Promise.resolve(true)
    return new Promise(resolve => idleWaiters.add(resolve))
  }

  function defer(key, callback) {
    if (disposed) return false
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    deferred.set(key, callback)
    scheduleResume()
    return true
  }

  function cancelDeferred(key) {
    return deferred.delete(key)
  }

  function isCurrent(candidateGeneration) {
    return !disposed && !activeKeys.size && candidateGeneration === generation
  }

  function reset() {
    if (disposed) return
    cancelResume()
    activeKeys.clear()
    deferred.clear()
    generation += 1
    settleIdleWaiters(true)
  }

  function dispose() {
    if (disposed) return
    cancelResume()
    activeKeys.clear()
    deferred.clear()
    generation += 1
    disposed = true
    settleIdleWaiters(false)
  }

  return Object.freeze({ state, begin, end, whenIdle, defer, cancelDeferred, isCurrent, reset, dispose })
}
