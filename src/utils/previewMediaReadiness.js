const PREVIEW_MEDIA_SELECTOR = 'img, video'

function mediaTag(media) {
  return String(media?.tagName || '').toUpperCase()
}

function mediaSource(media) {
  // 优先比较模板实际绑定的 src，避免 currentSrc 从空值切到绝对地址时误判为资源换代。
  return String(media?.getAttribute?.('src') || media?.src || media?.currentSrc || '')
}

function mediaFailed(media) {
  if (media?.dataset?.previewMediaState === 'error') return true
  if (mediaTag(media) === 'VIDEO') return Boolean(media?.error)
  return mediaTag(media) === 'IMG'
    && media?.complete === true
    && Number(media?.naturalWidth) <= 0
}

function mediaNativeReady(media) {
  if (mediaTag(media) === 'VIDEO') return Number(media?.readyState) >= 2
  if (mediaTag(media) === 'IMG') {
    return media?.complete === true && Number(media?.naturalWidth) > 0
  }
  return true
}

function mediaEvents(media) {
  return mediaTag(media) === 'VIDEO'
    ? ['loadeddata', 'error', 'emptied']
    : ['load', 'error']
}

function exposeMediaFallback(media, force = false) {
  if (!force && !mediaFailed(media)) return false
  if (media?.dataset) media.dataset.previewMediaState = 'error'
  media?.classList?.add?.('is-media-failed')
  if (force && typeof media?.dispatchEvent === 'function' && typeof Event === 'function') {
    // 通知 NodeVisual 切换为组件占位内容，不能只隐藏损坏的媒体元素。
    media.dispatchEvent(new Event('preview-media-error'))
  }
  return true
}

/**
 * 为每个预览舞台建立可取消的媒体就绪门禁。新舞台未完整解码前，调用方继续保留旧完整帧。
 */
export function createPreviewMediaReadinessGate(options = {}) {
  const afterDomUpdate = options.afterDomUpdate || (() => Promise.resolve())
  const activeWaits = new Map()

  function cancel(stage) {
    const task = stage && activeWaits.get(stage)
    if (!task) return false
    task.finish(false)
    return true
  }

  function cancelAll() {
    for (const task of [...activeWaits.values()]) task.finish(false)
  }

  function wait(stage) {
    cancel(stage)
    if (!stage?.querySelectorAll) return Promise.resolve(true)

    let resolveWait
    const promise = new Promise(resolve => { resolveWait = resolve })
    const records = new Map()
    const settledSources = new Map()
    let finished = false

    function removeRecord(record) {
      if (!record || records.get(record.media) !== record) return
      for (const event of record.events) record.media.removeEventListener?.(event, record.handleEvent)
      records.delete(record.media)
    }

    function finish(ready) {
      if (finished) return
      finished = true
      for (const record of [...records.values()]) removeRecord(record)
      if (activeWaits.get(stage)?.finish === finish) activeWaits.delete(stage)
      resolveWait(Boolean(ready))
    }

    function currentMedia() {
      return [...(stage.querySelectorAll(PREVIEW_MEDIA_SELECTOR) || [])]
    }

    async function checkRecord(record) {
      if (finished || record.checking || records.get(record.media) !== record) return
      const source = mediaSource(record.media)
      if (source !== record.source) {
        removeRecord(record)
        scan()
        return
      }
      const failed = mediaFailed(record.media)
      if (!failed && !mediaNativeReady(record.media)) return

      record.checking = true
      let decodeFailed = false
      if (!failed && mediaTag(record.media) === 'IMG' && typeof record.media.decode === 'function') {
        // decode() 保证首次公开该舞台时，浏览器已经有可绘制的图片帧。
        try {
          await record.media.decode()
        } catch {
          decodeFailed = true
          exposeMediaFallback(record.media, true)
        }
      }
      try {
        await afterDomUpdate()
      } catch {
        finish(false)
        return
      }
      if (finished || records.get(record.media) !== record) return
      record.checking = false
      if (source !== mediaSource(record.media)) {
        removeRecord(record)
        scan()
        return
      }
      if (!mediaFailed(record.media) && !mediaNativeReady(record.media)) return
      exposeMediaFallback(record.media, decodeFailed)
      settledSources.set(record.media, source)
      removeRecord(record)
      scan()
    }

    function addRecord(media) {
      const record = {
        media,
        source: mediaSource(media),
        events: mediaEvents(media),
        checking: false,
        handleEvent: null
      }
      record.handleEvent = () => { void checkRecord(record) }
      records.set(media, record)
      for (const event of record.events) media.addEventListener?.(event, record.handleEvent)
      void checkRecord(record)
    }

    function scan() {
      if (finished) return
      const current = currentMedia()
      const retained = new Set(current)
      for (const record of [...records.values()]) {
        if (!retained.has(record.media) || record.source !== mediaSource(record.media)) removeRecord(record)
      }
      for (const [media, source] of [...settledSources]) {
        if (!retained.has(media) || source !== mediaSource(media)) settledSources.delete(media)
      }
      for (const media of current) {
        if (!records.has(media) && settledSources.get(media) !== mediaSource(media)) addRecord(media)
      }
      if (!records.size) finish(true)
    }

    const task = { finish }
    activeWaits.set(stage, task)
    scan()
    return promise
  }

  return Object.freeze({ wait, cancel, cancelAll })
}
