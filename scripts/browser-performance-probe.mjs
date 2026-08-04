export const DEFAULT_FRAME_BUDGET_MS = 16.7
export const DEFAULT_LONG_TASK_MS = 50
export const DEFAULT_MAX_FRAME_SAMPLES = 4_096
export const DEFAULT_MAX_LONG_TASK_SAMPLES = 1_024
export const DEFAULT_MAX_INTERACTION_SAMPLES = 1_024

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : fallback
}

function appendBounded(values, value, limit) {
  if (values.length >= limit) {
    const retained = Math.max(0, limit - Math.max(1, Math.ceil(limit / 4)))
    values.copyWithin(0, values.length - retained)
    values.length = retained
  }
  values.push(value)
}

export function percentile(samples, ratio = 0.95) {
  const values = Array.from(samples || [], Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (!values.length) return null
  const normalizedRatio = Math.max(0, Math.min(1, Number(ratio) || 0))
  return values[Math.max(0, Math.ceil(values.length * normalizedRatio) - 1)]
}

export function summarizeDurations(samples) {
  const values = Array.from(samples || [], Number).filter(Number.isFinite)
  if (!values.length) return { count: 0, average: null, p95: null, max: null }
  let maximum = values[0]
  let total = 0
  for (const value of values) {
    total += value
    if (value > maximum) maximum = value
  }
  return {
    count: values.length,
    average: total / values.length,
    p95: percentile(values),
    max: maximum
  }
}

export function createBrowserPerformanceProbe(options = {}) {
  const host = options.host || globalThis
  const frameBudgetMs = Number(options.frameBudgetMs) || DEFAULT_FRAME_BUDGET_MS
  const longTaskThresholdMs = Number(options.longTaskThresholdMs) || DEFAULT_LONG_TASK_MS
  const maxFrameSamples = positiveInteger(options.maxFrameSamples, DEFAULT_MAX_FRAME_SAMPLES)
  const maxLongTaskSamples = positiveInteger(options.maxLongTaskSamples, DEFAULT_MAX_LONG_TASK_SAMPLES)
  const maxInteractionSamples = positiveInteger(options.maxInteractionSamples, DEFAULT_MAX_INTERACTION_SAMPLES)
  const now = options.now || (() => host.performance.now())
  const requestFrame = options.requestFrame || (callback => host.requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame || (handle => host.cancelAnimationFrame(handle))
  const Observer = options.PerformanceObserver === undefined ? host.PerformanceObserver : options.PerformanceObserver
  const frameIntervals = []
  const longTaskDurations = []
  const interactionDurations = new Map()
  let active = false
  let startedAt = null
  let stoppedAt = null
  let previousFrameAt = null
  let frameHandle = null
  let observer = null

  function recordFrame(timestamp) {
    if (!active) return
    if (previousFrameAt != null) {
      const interval = Number(timestamp) - previousFrameAt
      if (Number.isFinite(interval) && interval >= 0) appendBounded(frameIntervals, interval, maxFrameSamples)
    }
    previousFrameAt = Number(timestamp)
    frameHandle = requestFrame(recordFrame)
  }

  function start() {
    if (active) return false
    frameIntervals.length = 0
    longTaskDurations.length = 0
    interactionDurations.clear()
    startedAt = now()
    stoppedAt = null
    previousFrameAt = null
    active = true
    if (typeof Observer === 'function') {
      try {
        observer = new Observer(entries => {
          for (const entry of entries.getEntries()) {
            const duration = Number(entry.duration)
            if (Number.isFinite(duration) && duration >= longTaskThresholdMs) {
              appendBounded(longTaskDurations, duration, maxLongTaskSamples)
            }
          }
        })
        observer.observe({ type: 'longtask', buffered: false })
      } catch {
        observer = null
      }
    }
    frameHandle = requestFrame(recordFrame)
    return true
  }

  function recordInteraction(label, duration) {
    const key = String(label || 'interaction')
    let samples = interactionDurations.get(key)
    if (!samples) {
      samples = []
      interactionDurations.set(key, samples)
    }
    appendBounded(samples, duration, maxInteractionSamples)
  }

  async function measure(label, operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function')
    const interactionStartedAt = now()
    try {
      return await operation()
    } finally {
      recordInteraction(label, now() - interactionStartedAt)
    }
  }

  function snapshot() {
    const frameStats = summarizeDurations(frameIntervals)
    const longTaskStats = summarizeDurations(longTaskDurations)
    return {
      active,
      durationMs: startedAt == null ? 0 : (stoppedAt ?? now()) - startedAt,
      visibilityState: host.document?.visibilityState || 'unknown',
      frameBudgetMs,
      frames: {
        ...frameStats,
        overBudget: frameIntervals.filter(duration => duration > frameBudgetMs).length,
        overLongTaskThreshold: frameIntervals.filter(duration => duration >= longTaskThresholdMs).length
      },
      longTasks: longTaskStats,
      interactions: Object.fromEntries(
        [...interactionDurations].map(([label, samples]) => [label, summarizeDurations(samples)])
      )
    }
  }

  function stop() {
    if (active) {
      active = false
      stoppedAt = now()
      if (frameHandle != null) cancelFrame(frameHandle)
      frameHandle = null
      observer?.disconnect()
      observer = null
    }
    return snapshot()
  }

  return Object.freeze({ start, stop, snapshot, measure, recordInteraction })
}

if (typeof window !== 'undefined') {
  window.createTc2dPerformanceProbe = createBrowserPerformanceProbe
}
