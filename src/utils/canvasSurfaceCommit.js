function clippedRect(rect, width, height) {
  if (!rect) return null
  const left = Math.max(0, Math.floor(Number(rect.x) || 0))
  const top = Math.max(0, Math.floor(Number(rect.y) || 0))
  const right = Math.min(width, Math.ceil((Number(rect.x) || 0) + Math.max(0, Number(rect.w) || 0)))
  const bottom = Math.min(height, Math.ceil((Number(rect.y) || 0) + Math.max(0, Number(rect.h) || 0)))
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Copies one completed backing surface to the visible canvas in one draw call. */
export function commitCanvasSurface(context, surface, dirtyRects = null) {
  if (!context || !surface || typeof context.drawImage !== 'function') return false
  const width = Math.max(1, Math.floor(Number(surface.width) || 1))
  const height = Math.max(1, Math.floor(Number(surface.height) || 1))
  const rects = Array.isArray(dirtyRects)
    ? dirtyRects.map(rect => clippedRect(rect, width, height)).filter(Boolean)
    : null
  if (rects && !rects.length) return false

  let saved = false
  try {
    context.save()
    saved = true
    context.setTransform(1, 0, 0, 1, 0, 0)
    if (rects) {
      context.beginPath()
      for (const rect of rects) context.rect(rect.x, rect.y, rect.w, rect.h)
      context.clip()
    }
    context.globalCompositeOperation = 'copy'
    context.drawImage(surface, 0, 0)
    return true
  } finally {
    if (saved) context.restore()
  }
}

/** Preserves the current visible frame when a full commit also changes bitmap size. */
export function commitCanvasSurfaceWithResize(target, surface, options = {}) {
  if (!target || !surface) return false
  const width = Math.max(1, Math.floor(Number(surface.width) || 1))
  const height = Math.max(1, Math.floor(Number(surface.height) || 1))
  const previousWidth = Math.max(1, Math.floor(Number(target.width) || 1))
  const previousHeight = Math.max(1, Math.floor(Number(target.height) || 1))
  const getContext = typeof options.getContext === 'function'
    ? options.getContext
    : canvas => canvas?.getContext?.('2d') || null
  const acceptsContext = typeof options.acceptContext === 'function'
    ? options.acceptContext
    : context => Boolean(context)
  const initialContext = options.context || getContext(target)
  if (!acceptsContext(initialContext)) return false
  if (previousWidth === width && previousHeight === height) {
    return commitCanvasSurface(initialContext, surface)
  }

  const createBackup = options.createBackup
  const releaseBackup = typeof options.releaseBackup === 'function' ? options.releaseBackup : () => {}
  const backup = typeof createBackup === 'function' ? createBackup(previousWidth, previousHeight) : null
  if (!backup) return false
  let resized = false
  try {
    const backupContext = getContext(backup)
    if (!backupContext || !commitCanvasSurface(backupContext, target)) return false

    resized = true
    target.width = width
    target.height = height
    const resizedContext = getContext(target)
    if (!acceptsContext(resizedContext)) throw new Error('canvas context unavailable after resize')
    if (!commitCanvasSurface(resizedContext, surface)) throw new Error('resized canvas surface commit failed')
    return true
  } catch (error) {
    if (resized) {
      try {
        target.width = previousWidth
        target.height = previousHeight
        const rollbackContext = getContext(target)
        if (acceptsContext(rollbackContext)) commitCanvasSurface(rollbackContext, backup)
      } catch {}
    }
    throw error
  } finally {
    try { releaseBackup(backup) } catch {}
  }
}
