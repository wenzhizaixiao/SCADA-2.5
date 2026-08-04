import { drawEdgeRasterBatch } from '../utils/edgeRasterDrawing.js'

let activeJob = null

function fail(jobId, error) {
  if (activeJob?.jobId === jobId) activeJob = null
  self.postMessage({ type: 'failed', jobId, message: String(error?.message || error || 'Edge raster failed') })
}

function startJob(message) {
  const config = message.config || {}
  const bitmapWidth = Math.max(1, Math.floor(Number(config.bitmapWidth) || 1))
  const bitmapHeight = Math.max(1, Math.floor(Number(config.bitmapHeight) || 1))
  const canvas = new OffscreenCanvas(bitmapWidth, bitmapHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2D context is unavailable')
  const width = Math.max(1, Number(config.width) || 1)
  const height = Math.max(1, Number(config.height) || 1)
  const stageWidth = Math.max(1, Number(config.stageWidth) || 1)
  const stageHeight = Math.max(1, Number(config.stageHeight) || 1)
  ctx.setTransform(Number(config.pixelRatioX) || 1, 0, 0, Number(config.pixelRatioY) || 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.translate(Number(config.offsetX) || 0, Number(config.offsetY) || 0)
  ctx.scale(Number(config.scaleX) || 1, Number(config.scaleY) || 1)
  ctx.beginPath()
  ctx.rect(0, 0, stageWidth, stageHeight)
  ctx.clip()
  ctx.fillStyle = config.background || '#f7f8fa'
  ctx.fillRect(0, 0, stageWidth, stageHeight)
  activeJob = { jobId: message.jobId, canvas, ctx }
  self.postMessage({ type: 'ready', jobId: message.jobId })
}

self.onmessage = event => {
  const message = event?.data || {}
  const jobId = message.jobId
  try {
    if (message.type === 'start') {
      startJob(message)
      return
    }
    if (message.type === 'cancel') {
      if (activeJob?.jobId === jobId) activeJob = null
      return
    }
    const job = activeJob
    if (!job || job.jobId !== jobId) return
    if (message.type === 'batch') {
      drawEdgeRasterBatch(job.ctx, message.batch)
      self.postMessage({ type: 'batch-complete', jobId })
      return
    }
    if (message.type === 'finish') {
      job.ctx.restore()
      const bitmap = job.canvas.transferToImageBitmap()
      activeJob = null
      self.postMessage({ type: 'complete', jobId, bitmap }, [bitmap])
    }
  } catch (error) {
    fail(jobId, error)
  }
}
