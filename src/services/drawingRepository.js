function drawingPath(name) {
  const normalized = String(name || '')
  if (!normalized) throw new TypeError('drawing name cannot be empty')
  return `/api/drawings/${encodeURIComponent(normalized)}`
}

// 图纸文件可能包含大量组件或内嵌媒体，传输耗时不应被通用接口的固定超时截断。
const DRAWING_TRANSFER_TIMEOUT_MS = 0

export function createDrawingRepository(httpClient) {
  if (!httpClient?.request) throw new TypeError('httpClient is required')

  return {
    async list(context = {}) {
      void context
      const { data } = await httpClient.request('/api/drawings', {
        cache: 'no-store',
        timeoutMs: DRAWING_TRANSFER_TIMEOUT_MS,
        errorMessage: '无法读取项目图纸库'
      })
      return {
        files: Array.isArray(data?.files) ? data.files : [],
        directory: String(data?.directory || '图纸库'),
        caseSensitiveNames: data?.caseSensitiveNames !== false
      }
    },

    async get(name, context = {}) {
      void context
      const response = await httpClient.request(drawingPath(name), {
        cache: 'no-store',
        timeoutMs: DRAWING_TRANSFER_TIMEOUT_MS,
        responseType: 'text',
        errorMessage: '图纸打开失败'
      })
      return {
        serialized: response.data,
        etag: response.headers.get('etag') || ''
      }
    },

    async save(name, serialized, { etag = '', create = false, context = {} } = {}) {
      void context
      const conditionHeaders = create
        ? { 'If-None-Match': '*' }
        : { 'If-Match': String(etag || '') }
      const response = await httpClient.request(drawingPath(name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...conditionHeaders },
        body: serialized,
        timeoutMs: DRAWING_TRANSFER_TIMEOUT_MS,
        errorMessage: '图纸保存失败'
      })
      return {
        ...(response.data || {}),
        etag: response.headers.get('etag') || response.data?.etag || ''
      }
    },

    async delete(name, etag, context = {}) {
      void context
      const { data } = await httpClient.request(drawingPath(name), {
        method: 'DELETE',
        headers: { 'If-Match': String(etag || '') },
        timeoutMs: DRAWING_TRANSFER_TIMEOUT_MS,
        errorMessage: '图纸删除失败'
      })
      return data
    },

    async exists(name, context = {}) {
      void context
      try {
        await httpClient.request(drawingPath(name), {
          method: 'HEAD',
          cache: 'no-store',
          timeoutMs: DRAWING_TRANSFER_TIMEOUT_MS,
          responseType: 'none',
          errorMessage: '无法确认图纸文件状态'
        })
        return true
      } catch (error) {
        if (error?.status === 404) return false
        throw error
      }
    }
  }
}
