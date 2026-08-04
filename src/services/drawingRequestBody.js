import { constants as bufferConstants } from 'node:buffer'

export const DEFAULT_DRAWING_REQUEST_LIMIT_BYTES = 256 * 1024 * 1024
export const DRAWING_REQUEST_LIMIT_ENV = 'TC2D_MAX_DRAWING_BYTES'
export const MAX_DRAWING_REQUEST_LIMIT_BYTES = Math.min(bufferConstants.MAX_LENGTH, bufferConstants.MAX_STRING_LENGTH)

export class DrawingRequestError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DrawingRequestError'
    this.status = status
  }
}

export function resolveDrawingRequestLimit(environment = globalThis.process?.env || {}) {
  const raw = String(environment[DRAWING_REQUEST_LIMIT_ENV] || '').trim()
  if (!raw) return DEFAULT_DRAWING_REQUEST_LIMIT_BYTES
  if (!/^\d+$/u.test(raw)) throw new TypeError(`${DRAWING_REQUEST_LIMIT_ENV} must be a positive integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DRAWING_REQUEST_LIMIT_BYTES) {
    throw new TypeError(`${DRAWING_REQUEST_LIMIT_ENV} must be between 1 and ${MAX_DRAWING_REQUEST_LIMIT_BYTES}`)
  }
  return value
}

export function validateDrawingRequestHeaders(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new DrawingRequestError(415, '请求体必须使用 application/json')
  const contentEncoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase()
  if (contentEncoding !== 'identity') throw new DrawingRequestError(415, '不支持压缩请求体')
  const contentLength = req.headers['content-length']
  if (contentLength == null) return null
  if (Array.isArray(contentLength) || !/^\d+$/u.test(contentLength)) throw new DrawingRequestError(400, 'Content-Length 无效')
  const declaredBytes = BigInt(contentLength)
  if (declaredBytes > BigInt(maxBytes)) throw new DrawingRequestError(413, `图纸文件超过 ${maxBytes} 字节请求上限`)
  return Number(declaredBytes)
}

export function readBoundedRequestBody(req, maxBytes, declaredBytes = null, { allocate = Buffer.allocUnsafe } = {}) {
  return new Promise((resolveBody, rejectBody) => {
    const initialCapacity = declaredBytes == null ? Math.min(maxBytes, 64 * 1024) : declaredBytes
    let bodyBuffer = null
    let size = 0
    let settled = false
    const reject = error => {
      if (settled) return
      settled = true
      bodyBuffer = null
      req.resume()
      rejectBody(error)
    }
    const rejectAllocation = () => reject(new DrawingRequestError(413, '图纸请求体超过当前服务可处理的内存上限'))
    try {
      bodyBuffer = allocate(initialCapacity)
    } catch {
      rejectAllocation()
      return
    }
    req.on('data', chunk => {
      if (settled) return
      try {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (chunkBuffer.length > maxBytes - size) {
          reject(new DrawingRequestError(413, `图纸文件超过 ${maxBytes} 字节请求上限`))
          return
        }
        const required = size + chunkBuffer.length
        if (required > bodyBuffer.length) {
          let nextCapacity = Math.max(1, bodyBuffer.length)
          while (nextCapacity < required && nextCapacity < maxBytes) nextCapacity = Math.min(maxBytes, nextCapacity * 2)
          const expanded = allocate(nextCapacity)
          bodyBuffer.copy(expanded, 0, 0, size)
          bodyBuffer = expanded
        }
        chunkBuffer.copy(bodyBuffer, size)
        size = required
      } catch {
        rejectAllocation()
      }
    })
    req.on('end', () => {
      if (settled) return
      if (declaredBytes != null && size !== declaredBytes) {
        reject(new DrawingRequestError(400, 'Content-Length 与实际请求体长度不一致'))
        return
      }
      settled = true
      resolveBody(size === bodyBuffer.length ? bodyBuffer : bodyBuffer.subarray(0, size))
    })
    req.on('aborted', () => reject(new DrawingRequestError(400, '请求体传输中断')))
    req.on('error', reject)
  })
}
