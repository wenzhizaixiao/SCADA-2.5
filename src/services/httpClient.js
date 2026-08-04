const DEFAULT_TIMEOUT_MS = 15000

export class ApiRequestError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0, data = null, url = '', cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.data = data
    this.url = url
  }
}

export function buildApiUrl(baseUrl, path) {
  const endpoint = String(path || '').trim()
  if (!endpoint) throw new TypeError('API path cannot be empty')
  if (/^https?:\/\//iu.test(endpoint)) return endpoint
  const normalizedPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/u, '')
  return `${normalizedBase}${normalizedPath}`
}

async function errorPayload(response) {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload === 'object') return String(payload.message || payload.error || fallback)
  if (typeof payload === 'string' && payload.trim()) return payload.trim()
  return fallback
}

async function successPayload(response, responseType, url) {
  if (responseType === 'none' || response.status === 204) return null
  if (responseType === 'text') return response.text()
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ApiRequestError('服务器返回的数据格式无效', {
      code: 'INVALID_RESPONSE', status: response.status, url, cause
    })
  }
}

export function createHttpClient({
  baseUrl = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  credentials = 'same-origin',
  getAuthHeaders = null
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  return {
    async request(path, options = {}) {
      const url = buildApiUrl(baseUrl, path)
      const method = String(options.method || 'GET').toUpperCase()
      const controller = new AbortController()
      const externalSignal = options.signal
      const requestTimeout = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : timeoutMs
      let timedOut = false
      let timeoutId = null

      const abortFromCaller = () => controller.abort(externalSignal.reason)
      if (externalSignal?.aborted) abortFromCaller()
      else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
      if (requestTimeout > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true
          controller.abort(new DOMException('Request timed out', 'TimeoutError'))
        }, requestTimeout)
      }

      try {
        // 鉴权头在发送前动态取得，后续接入登录态时无需改动业务调用点。
        const authHeaders = typeof getAuthHeaders === 'function'
          ? await getAuthHeaders({ method, url })
          : null
        const headers = new Headers({ Accept: 'application/json', ...(authHeaders || {}), ...(options.headers || {}) })
        const response = await fetchImpl(url, {
          method,
          headers,
          body: options.body,
          cache: options.cache,
          credentials: options.credentials || credentials,
          signal: controller.signal
        })
        if (!response.ok) {
          const data = await errorPayload(response)
          throw new ApiRequestError(errorMessage(data, options.errorMessage || `请求失败 (${response.status})`), {
            code: 'HTTP_ERROR', status: response.status, data, url
          })
        }
        return {
          data: await successPayload(response, options.responseType || 'json', url),
          headers: response.headers,
          status: response.status
        }
      } catch (error) {
        if (error instanceof ApiRequestError) throw error
        if (timedOut) {
          throw new ApiRequestError('请求超时，请稍后重试', {
            code: 'REQUEST_TIMEOUT', url, cause: error
          })
        }
        if (externalSignal?.aborted) {
          throw new ApiRequestError('请求已取消', {
            code: 'REQUEST_ABORTED', url, cause: error
          })
        }
        throw new ApiRequestError('网络请求失败，请检查服务是否可用', {
          code: 'NETWORK_ERROR', url, cause: error
        })
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        externalSignal?.removeEventListener('abort', abortFromCaller)
      }
    }
  }
}
