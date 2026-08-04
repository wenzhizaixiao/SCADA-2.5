export function createPreviewViewportScheduler({ requestFrame, cancelFrame, flush } = {}) {
  if (typeof requestFrame !== 'function') throw new TypeError('requestFrame must be a function')
  if (typeof cancelFrame !== 'function') throw new TypeError('cancelFrame must be a function')
  if (typeof flush !== 'function') throw new TypeError('flush must be a function')

  let frame = null
  let generation = 0
  let pendingContentRect = null
  let pendingScroll = null
  let pendingRefreshFit = false
  let pendingWaitForContentRect = false

  function clearPending() {
    pendingContentRect = null
    pendingScroll = null
    pendingRefreshFit = false
    pendingWaitForContentRect = false
  }

  function schedule({ contentRect = null, scroll, refreshFit = false, waitForContentRect = false } = {}) {
    const width = Number(contentRect?.width)
    const height = Number(contentRect?.height)
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      pendingContentRect = { width, height }
    }
    if (scroll) {
      pendingScroll = {
        left: Number(scroll.left) || 0,
        top: Number(scroll.top) || 0
      }
    }
    if (refreshFit) pendingRefreshFit = true
    if (waitForContentRect) pendingWaitForContentRect = true
    if (frame !== null) return frame

    const scheduledGeneration = generation
    const runFrame = () => {
      if (scheduledGeneration !== generation) return
      if (pendingWaitForContentRect && !pendingContentRect) {
        pendingWaitForContentRect = false
        frame = requestFrame(runFrame)
        return
      }
      frame = null
      const update = {
        contentRect: pendingContentRect,
        scroll: pendingScroll,
        refreshFit: pendingRefreshFit
      }
      clearPending()
      flush(update)
    }
    frame = requestFrame(runFrame)
    return frame
  }

  function invalidate() {
    generation += 1
    clearPending()
    if (frame !== null) cancelFrame(frame)
    frame = null
    return generation
  }

  function state() {
    return Object.freeze({ generation, scheduled: frame !== null })
  }

  return Object.freeze({ schedule, invalidate, dispose: invalidate, state })
}
