import {
  DEFAULT_RUNTIME_PIPELINE_SYNC_ITEMS,
  createRuntimeUpdatePipeline
} from '../utils/runtimeUpdatePipeline.js'
import {
  copyRuntimeUpdateGeneration,
  normalizeRuntimeKey
} from '../utils/runtimeKey.js'

const DEFAULT_RUNTIME_GATEWAY_MAX_PENDING_BATCHES = 128

export function normalizeRuntimeUpdates(payload) {
  let entries
  if (Array.isArray(payload)) entries = payload
  else if (Array.isArray(payload?.values)) entries = payload.values
  else if (payload && typeof payload === 'object' && 'key' in payload) entries = [payload]
  else if (payload && typeof payload === 'object') entries = Object.entries(payload).map(([key, value]) => ({ key, value }))
  else entries = []

  const latest = new Map()
  for (const entry of entries) {
    const key = normalizeRuntimeKey(entry?.key)
    if (key) latest.set(key, copyRuntimeUpdateGeneration({ key, value: entry?.value }, entry))
  }
  return [...latest.values()]
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : fallback
}

export function createLocalRuntimeGateway({
  intervalMs = 500,
  random = Math.random,
  schedule = setInterval,
  cancel = clearInterval,
  ingressOptions = {},
  onError
} = {}) {
  const subscribers = new Set()
  const {
    maxPendingBatches: configuredMaxPendingBatches,
    ...pipelineOptions
  } = ingressOptions
  const ingressSyncItems = positiveInteger(pipelineOptions.syncItems, DEFAULT_RUNTIME_PIPELINE_SYNC_ITEMS)
  const maxPendingBatches = positiveInteger(
    configuredMaxPendingBatches,
    DEFAULT_RUNTIME_GATEWAY_MAX_PENDING_BATCHES
  )
  let timer = null
  let connection = null
  let generation = 0

  function report(error, context = {}) {
    try { onError?.(error, context) } catch {}
  }

  function publish(updates) {
    if (updates.length) subscribers.forEach(handler => handler(updates))
    return updates
  }

  const ingressPipeline = createRuntimeUpdatePipeline({
    ...pipelineOptions,
    onChanges: publish,
    onError(error, context) {
      report(error, { source: 'ingress', generation, ...context })
    }
  })

  function send(payload) {
    return ingressPipeline.publishSynchronously(normalizeRuntimeUpdates(payload))
  }

  function assertIngressCapacity() {
    if (ingressPipeline.state.queuedBatches >= maxPendingBatches) {
      throw new RangeError(`runtime gateway pending batches exceed configured limit ${maxPendingBatches}`)
    }
  }

  function ingest(payload) {
    try {
      assertIngressCapacity()
      return ingressPipeline.enqueue(payload)
    } catch (error) {
      report(error, { source: 'ingress', generation, phase: 'enqueue' })
      return Promise.reject(error)
    }
  }

  function consumeIngress(completion) {
    Promise.resolve(completion).catch(() => {})
  }

  function ingestGenerated(keys, expectedGeneration) {
    if (expectedGeneration !== generation || !connection) return
    const source = keys || []
    try {
      let completion
      if (Array.isArray(source) && source.length <= ingressSyncItems) {
        completion = ingest(source.map(key => ({ key, value: Math.round(random() * 100) })))
      } else {
        assertIngressCapacity()
        completion = ingressPipeline.enqueueGenerated(source, () => Math.round(random() * 100))
      }
      consumeIngress(completion)
    } catch (error) {
      report(error, { source: 'ingress', generation, phase: 'enqueue-generated' })
    }
  }

  function disconnect() {
    generation += 1
    if (timer !== null) cancel(timer)
    timer = null
    connection = null
    ingressPipeline.stop('runtime gateway disconnected')
    ingressPipeline.resetChanges()
  }

  return {
    get connected() { return Boolean(connection) },
    get connection() { return connection ? { ...connection } : null },
    get generation() { return generation },
    get ingressState() {
      return Object.freeze({ ...ingressPipeline.state, maxPendingBatches })
    },
    subscribe(handler) {
      if (typeof handler !== 'function') throw new TypeError('runtime subscriber must be a function')
      if (!subscribers.size) ingressPipeline.resetChanges()
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
    async connect({ protocol = 'WebSocket', url = '', getKeys = () => [] } = {}) {
      disconnect()
      const connectionGeneration = generation
      connection = { protocol: String(protocol), url: String(url), adapter: 'local-simulator' }
      try {
        timer = schedule(() => {
          if (connectionGeneration !== generation || !connection) return
          let keys
          try {
            keys = getKeys() || []
          } catch (error) {
            report(error, { source: 'simulator', generation, phase: 'get-keys' })
            return
          }
          ingestGenerated(keys, connectionGeneration)
        }, intervalMs)
      } catch (error) {
        connection = null
        report(error, { source: 'simulator', generation, phase: 'schedule' })
        throw error
      }
      return { ...connection }
    },
    disconnect,
    ingest,
    send
  }
}
