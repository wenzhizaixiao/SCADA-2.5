export const DEFAULT_SHARED_PREVIEW_IMAGE_CACHE_LIMIT = 32
export const DEFAULT_SHARED_PREVIEW_IMAGE_PIXEL_LIMIT = 16_777_216
export const DEFAULT_SHARED_PREVIEW_IMAGE_SETTLE_TIMEOUT_MS = 8_000

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

function defaultImageFactory() {
  const ImageConstructor = globalThis.Image
  if (typeof ImageConstructor !== 'function') throw new Error('Image is unavailable')
  return new ImageConstructor()
}

export function createSharedPreviewImageCache(options = {}) {
  const createImage = typeof options.createImage === 'function'
    ? options.createImage
    : defaultImageFactory
  const maximumSettledEntries = nonNegativeInteger(
    options.maximumSettledEntries,
    DEFAULT_SHARED_PREVIEW_IMAGE_CACHE_LIMIT
  )
  const maximumDecodedPixels = nonNegativeInteger(
    options.maximumDecodedPixels,
    DEFAULT_SHARED_PREVIEW_IMAGE_PIXEL_LIMIT
  )
  const settleTimeoutMs = nonNegativeInteger(
    options.settleTimeoutMs,
    DEFAULT_SHARED_PREVIEW_IMAGE_SETTLE_TIMEOUT_MS
  )
  const setTimer = typeof options.setTimer === 'function'
    ? options.setTimer
    : globalThis.setTimeout.bind(globalThis)
  const clearTimer = typeof options.clearTimer === 'function'
    ? options.clearTimer
    : globalThis.clearTimeout.bind(globalThis)
  const entries = new Map()
  const imageStates = new WeakMap()

  function state(image) {
    return imageStates.get(image) || 'loading'
  }

  function settled(image) {
    return state(image) === 'ready' || state(image) === 'error'
  }

  function ready(image) {
    return state(image) === 'ready'
      && image?.complete === true
      && Number(image.naturalWidth) > 0
  }

  function decodedPixels(record) {
    if (state(record.image) !== 'ready') return 0
    const width = Math.max(0, Number(record.image.naturalWidth) || 0)
    const height = Math.max(0, Number(record.image.naturalHeight) || 0)
    const pixels = width * height
    return Number.isSafeInteger(pixels) ? pixels : Number.MAX_SAFE_INTEGER
  }

  function touch(record) {
    if (entries.get(record.url) !== record) return
    entries.delete(record.url)
    entries.set(record.url, record)
  }

  function clearSettleTimer(record) {
    if (record.settleTimer === null) return
    clearTimer(record.settleTimer)
    record.settleTimer = null
  }

  function armSettleTimer(record) {
    clearSettleTimer(record)
    if (!settleTimeoutMs) return
    record.settleTimer = setTimer(() => {
      record.settleTimer = null
      settle(record, 'error')
    }, settleTimeoutMs)
  }

  function discard(record) {
    if (
      entries.get(record.url) !== record
      || record.subscribers.size
    ) return false
    clearSettleTimer(record)
    record.image.onload = null
    record.image.onerror = null
    entries.delete(record.url)
    return true
  }

  function evict(record) {
    return settled(record.image) && discard(record)
  }

  function trim() {
    const inactive = [...entries.values()].filter(record => (
      !record.subscribers.size && settled(record.image)
    ))
    let inactiveCount = inactive.length
    let inactivePixels = inactive.reduce((total, record) => total + decodedPixels(record), 0)
    for (const record of inactive) {
      if (
        inactiveCount <= maximumSettledEntries
        && inactivePixels <= maximumDecodedPixels
      ) break
      const pixels = decodedPixels(record)
      if (!evict(record)) continue
      inactiveCount -= 1
      inactivePixels -= pixels
    }
  }

  function notify(record) {
    const event = Object.freeze({
      url: record.url,
      image: record.image,
      state: state(record.image)
    })
    for (const subscriber of [...record.subscribers]) {
      try {
        subscriber(event)
      } catch {
        // A stale preview subscriber must not prevent the remaining canvases from redrawing.
      }
    }
  }

  function settle(record, nextState) {
    if (entries.get(record.url) !== record || settled(record.image)) return false
    clearSettleTimer(record)
    imageStates.set(record.image, nextState)
    notify(record)
    trim()
    return true
  }

  function decode(record) {
    if (entries.get(record.url) !== record || settled(record.image)) {
      return record.decodePromise || Promise.resolve(state(record.image))
    }
    const image = record.image
    if (!image.complete) return Promise.resolve(state(image))
    if (Number(image.naturalWidth) <= 0) {
      settle(record, 'error')
      return Promise.resolve('error')
    }
    if (state(image) === 'decoding') return record.decodePromise

    imageStates.set(image, 'decoding')
    armSettleTimer(record)
    const decodePromise = typeof image.decode === 'function'
      ? Promise.resolve().then(() => image.decode())
      : Promise.resolve()
    record.decodePromise = decodePromise.then(
      () => {
        if (entries.get(record.url) !== record || state(image) === 'error') return state(image)
        settle(record, Number(image.naturalWidth) > 0 ? 'ready' : 'error')
        return state(image)
      },
      () => {
        settle(record, 'error')
        return 'error'
      }
    )
    return record.decodePromise
  }

  function start(record) {
    const image = record.image
    image.decoding = 'async'
    image.onload = () => { void decode(record) }
    image.onerror = () => { settle(record, 'error') }
    armSettleTimer(record)
    image.src = record.url
    if (image.complete) void decode(record)
  }

  function acquire(url, subscriber = null) {
    const key = String(url || '')
    if (!key) return null
    let record = entries.get(key)
    if (record && state(record.image) === 'error' && !record.subscribers.size) {
      discard(record)
      record = null
    }
    if (!record) {
      const image = createImage()
      record = {
        url: key,
        image,
        decodePromise: null,
        settleTimer: null,
        subscribers: new Set()
      }
      imageStates.set(image, 'loading')
      entries.set(key, record)
      if (typeof subscriber === 'function') record.subscribers.add(subscriber)
      start(record)
      return image
    }
    if (typeof subscriber === 'function') record.subscribers.add(subscriber)
    touch(record)
    return record.image
  }

  function release(url, subscriber) {
    const record = entries.get(String(url || ''))
    if (!record || typeof subscriber !== 'function') return false
    const released = record.subscribers.delete(subscriber)
    if (released) {
      if (!record.subscribers.size && !settled(record.image)) discard(record)
      else trim()
    }
    return released
  }

  function releaseSubscriber(subscriber) {
    if (typeof subscriber !== 'function') return 0
    let released = 0
    for (const record of [...entries.values()]) {
      if (record.subscribers.delete(subscriber)) released += 1
      if (!record.subscribers.size && !settled(record.image)) discard(record)
    }
    if (released) trim()
    return released
  }

  return Object.freeze({
    acquire,
    release,
    releaseSubscriber,
    state,
    settled,
    ready,
    has: url => entries.has(String(url || '')),
    get size() { return entries.size }
  })
}

export const sharedPreviewImageCache = createSharedPreviewImageCache()
