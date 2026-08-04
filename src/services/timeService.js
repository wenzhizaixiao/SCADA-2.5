export function createTimeService(httpClient) {
  if (!httpClient?.request) throw new TypeError('httpClient is required')

  return {
    async current({ fallbackToLocal = true, context = {} } = {}) {
      void context
      try {
        const { data } = await httpClient.request('/api/time', {
          cache: 'no-store',
          errorMessage: '服务器时间不可用'
        })
        const now = Number(data?.now)
        if (!Number.isFinite(now)) throw new TypeError('invalid server time')
        return { now, iso: String(data?.iso || new Date(now).toISOString()), source: 'server', error: null }
      } catch (error) {
        if (!fallbackToLocal) throw error
        const now = Date.now()
        return { now, iso: new Date(now).toISOString(), source: 'local', error }
      }
    }
  }
}
