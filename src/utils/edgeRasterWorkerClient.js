import { edgeRasterBatchTransferList } from './edgeRasterDrawing.js'

function closeBitmap(bitmap) {
  if (!bitmap || typeof bitmap.close !== 'function') return
  try { bitmap.close() } catch {}
}

function defaultWorkerFactory() {
  if (typeof globalThis.Worker !== 'function' || typeof globalThis.OffscreenCanvas !== 'function') return null
  return new Worker(new URL('../workers/edgeRaster.worker.js', import.meta.url), { type: 'module' })
}

export function createEdgeRasterWorkerClient(options = {}) {
  const workerFactory = options.workerFactory || defaultWorkerFactory
  const responseTimeoutMs = Math.max(1, Math.floor(Number(options.responseTimeoutMs) || 8000))
  const setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = options.clearTimer || (timer => clearTimeout(timer))
  let worker = null
  let active = null
  let responseTimer = null
  let nextJobId = 1
  let disposed = false
  let unavailable = false

  function clearResponseTimer() {
    if (responseTimer == null) return
    clearTimer(responseTimer)
    responseTimer = null
  }

  function armResponseTimer(record) {
    clearResponseTimer()
    const timer = setTimer(() => {
      if (responseTimer !== timer || active !== record || record.disposed) return
      if (!['starting', 'batch', 'finishing'].includes(record.status)) return
      markUnavailable()
    }, responseTimeoutMs)
    responseTimer = timer
    timer?.unref?.()
  }

  function markUnavailable() {
    clearResponseTimer()
    unavailable = true
    if (active && !active.disposed) active.status = 'failed'
    try { worker?.terminate?.() } catch {}
    worker = null
  }

  function handleMessage(event) {
    const message = event?.data || {}
    const request = active
    if (!request || request.disposed || message.jobId !== request.jobId) {
      closeBitmap(message.bitmap)
      return
    }
    if (message.type === 'ready' && request.status === 'starting') {
      clearResponseTimer()
      request.status = 'ready'
    } else if (message.type === 'batch-complete' && request.status === 'batch') {
      clearResponseTimer()
      request.status = 'ready'
    } else if (message.type === 'complete' && request.status === 'finishing' && message.bitmap) {
      clearResponseTimer()
      request.bitmap = message.bitmap
      request.status = 'complete'
    } else if (message.type === 'failed') {
      clearResponseTimer()
      request.status = 'failed'
    } else closeBitmap(message.bitmap)
  }

  function ensureWorker() {
    if (disposed || unavailable) return null
    if (worker) return worker
    try {
      worker = workerFactory()
    } catch {
      worker = null
    }
    if (!worker) {
      unavailable = true
      return null
    }
    worker.onmessage = handleMessage
    worker.onerror = markUnavailable
    worker.onmessageerror = markUnavailable
    return worker
  }

  function post(message, transfer = undefined) {
    try {
      worker.postMessage(message, transfer)
      return true
    } catch {
      markUnavailable()
      return false
    }
  }

  function start(config) {
    if (disposed) return null
    active?.dispose()
    if (!ensureWorker()) return null
    const record = {
      jobId: nextJobId++,
      status: 'starting',
      bitmap: null,
      disposed: false,
      dispose: null
    }
    const state = Object.freeze({
      get jobId() { return record.jobId },
      get status() { return record.status },
      get disposed() { return record.disposed }
    })
    function sendBatch(batch) {
      if (record.disposed || active !== record || record.status !== 'ready' || !batch) return false
      record.status = 'batch'
      if (post({ type: 'batch', jobId: record.jobId, batch }, edgeRasterBatchTransferList(batch))) {
        armResponseTimer(record)
        return true
      }
      record.status = 'failed'
      return false
    }
    function finish() {
      if (record.disposed || active !== record || record.status !== 'ready') return false
      record.status = 'finishing'
      if (post({ type: 'finish', jobId: record.jobId })) {
        armResponseTimer(record)
        return true
      }
      record.status = 'failed'
      return false
    }
    function take() {
      if (record.status !== 'complete' || !record.bitmap) return null
      const bitmap = record.bitmap
      record.bitmap = null
      record.status = 'taken'
      return bitmap
    }
    function disposeRequest() {
      if (record.disposed) return
      record.disposed = true
      closeBitmap(record.bitmap)
      record.bitmap = null
      if (active === record) {
        clearResponseTimer()
        post({ type: 'cancel', jobId: record.jobId })
        active = null
      }
      record.status = 'disposed'
    }
    record.dispose = disposeRequest
    active = record
    if (!post({ type: 'start', jobId: record.jobId, config })) record.status = 'failed'
    else armResponseTimer(record)
    return Object.freeze({ state, sendBatch, finish, take, dispose: disposeRequest })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    active?.dispose()
    active = null
    clearResponseTimer()
    try { worker?.terminate?.() } catch {}
    worker = null
  }

  const state = Object.freeze({
    get disposed() { return disposed },
    get unavailable() { return unavailable },
    get activeJobId() { return active?.jobId ?? null }
  })
  return Object.freeze({ state, start, dispose })
}
