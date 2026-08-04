import { shallowRef } from 'vue'

export const DEFAULT_VISUAL_CLOCK_FPS = 30

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(() => callback(defaultNow()), 16)
}

function defaultCancel(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle)
    return
  }
  globalThis.clearTimeout(handle)
}

function normalizeFps(value) {
  const fps = Number(value)
  return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_VISUAL_CLOCK_FPS
}

/**
 * Shares one host animation loop across every visual clock frequency.
 * Subscribers at the same frequency also share one reactive timestamp.
 */
export function createSharedVisualClock(options = {}) {
  const injectedScheduler = options.scheduler
  const schedule = options.schedule || injectedScheduler?.schedule?.bind(injectedScheduler) || defaultSchedule
  const cancel = options.cancel || injectedScheduler?.cancel?.bind(injectedScheduler) || defaultCancel
  const now = options.now || injectedScheduler?.now?.bind(injectedScheduler) || defaultNow

  const clocks = new Map()
  let subscriberCount = 0
  let scheduled = false
  let scheduledHandle = null
  let scheduleGeneration = 0

  function cancelLoop() {
    scheduleGeneration += 1
    if (scheduled) cancel(scheduledHandle)
    scheduled = false
    scheduledHandle = null
  }

  function publish(rawTimestamp) {
    const timestamp = Number.isFinite(rawTimestamp) ? rawTimestamp : now()

    for (const clock of clocks.values()) {
      if (timestamp < clock.lastPublishedAt) clock.lastPublishedAt = timestamp
      if (timestamp - clock.lastPublishedAt < clock.intervalMs) continue
      clock.lastPublishedAt = timestamp
      clock.timestamp.value = timestamp
    }
  }

  function ensureScheduled() {
    if (scheduled || subscriberCount === 0) return
    const generation = scheduleGeneration
    scheduled = true
    scheduledHandle = schedule(timestamp => {
      if (generation !== scheduleGeneration) return
      scheduled = false
      scheduledHandle = null
      publish(timestamp)
      if (generation === scheduleGeneration) ensureScheduled()
    })
  }

  function acquire(rawFps = DEFAULT_VISUAL_CLOCK_FPS) {
    const fps = normalizeFps(rawFps)
    let clock = clocks.get(fps)
    if (!clock) {
      const timestamp = now()
      clock = {
        intervalMs: 1000 / fps,
        lastPublishedAt: timestamp,
        references: 0,
        timestamp: shallowRef(timestamp)
      }
      clocks.set(fps, clock)
    }
    clock.references += 1
    subscriberCount += 1
    ensureScheduled()
    return clock.timestamp
  }

  function release(rawFps = DEFAULT_VISUAL_CLOCK_FPS) {
    const fps = normalizeFps(rawFps)
    const clock = clocks.get(fps)
    if (!clock) return false

    clock.references -= 1
    subscriberCount -= 1
    if (clock.references === 0) clocks.delete(fps)
    if (subscriberCount === 0) cancelLoop()
    return clock.references === 0
  }

  function dispose() {
    cancelLoop()
    clocks.clear()
    subscriberCount = 0
  }

  function debugSnapshot() {
    return {
      frequencies: clocks.size,
      subscribers: subscriberCount,
      scheduled
    }
  }

  return {
    acquire,
    release,
    dispose,
    debugSnapshot
  }
}

const sharedVisualClock = createSharedVisualClock()

export function acquireVisualClock(fps = DEFAULT_VISUAL_CLOCK_FPS) {
  return sharedVisualClock.acquire(fps)
}

export function releaseVisualClock(fps = DEFAULT_VISUAL_CLOCK_FPS) {
  return sharedVisualClock.release(fps)
}
