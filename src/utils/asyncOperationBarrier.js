export function createAsyncOperationBarrier() {
  const activeTokens = new Set()
  const idleWaiters = new Set()
  let nextTokenId = 1
  let disposed = false

  const state = Object.freeze({
    get active() { return activeTokens.size > 0 },
    get activeCount() { return activeTokens.size },
    get disposed() { return disposed }
  })

  function settleWaiters(result) {
    if (!idleWaiters.size) return
    const waiters = [...idleWaiters]
    idleWaiters.clear()
    for (const resolve of waiters) resolve(result)
  }

  function begin(label = '') {
    if (disposed) return null
    const token = Object.freeze({ id: nextTokenId++, label: String(label || '') })
    activeTokens.add(token)
    return token
  }

  function end(token) {
    if (!activeTokens.delete(token)) return false
    if (!activeTokens.size) settleWaiters(true)
    return true
  }

  async function whenIdle() {
    while (!disposed && activeTokens.size) {
      const settled = await new Promise(resolve => idleWaiters.add(resolve))
      if (!settled) return false
    }
    return !disposed
  }

  function dispose() {
    if (disposed) return
    disposed = true
    activeTokens.clear()
    settleWaiters(false)
  }

  return Object.freeze({ state, begin, end, whenIdle, dispose })
}
