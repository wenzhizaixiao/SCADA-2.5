export function createCanvasContextGate() {
  let epoch = 0
  let target = null
  let lost = false

  function bind(nextTarget) {
    if (target === nextTarget) return false
    target = nextTarget || null
    epoch += 1
    lost = false
    return true
  }

  function capture(nextTarget) {
    bind(nextTarget)
    return Object.freeze({ epoch, target })
  }

  function markLost(nextTarget) {
    if (!nextTarget || nextTarget !== target) return false
    epoch += 1
    lost = true
    return true
  }

  function markRestored(nextTarget) {
    if (!nextTarget || nextTarget !== target) return false
    epoch += 1
    lost = false
    return true
  }

  function accepts(token, nextTarget, context) {
    return Boolean(
      context
      && !lost
      && token?.epoch === epoch
      && token?.target === target
      && nextTarget === target
    )
  }

  function release(nextTarget = target) {
    if (nextTarget !== target) return false
    target = null
    epoch += 1
    lost = false
    return true
  }

  function state() {
    return Object.freeze({ epoch, target, lost })
  }

  return Object.freeze({ bind, capture, markLost, markRestored, accepts, release, state })
}

export function canReuseCanvasRenderSurface(requested, context) {
  return requested === true && Boolean(context)
}

export function restoreCanvasRenderTaskContexts(task) {
  if (!task) return true
  if (task.contextRestoreFailed === true) return false
  let restored = true

  if (task.staticCtx) {
    try {
      task.staticCtx.restore()
    } catch {
      restored = false
    }
    task.staticCtx = null
  }

  if (task.ctx && task.contextRestored !== true) {
    try {
      task.ctx.restore()
    } catch {
      restored = false
    }
    task.contextRestored = true
  }

  if (!restored) task.contextRestoreFailed = true
  return restored
}
