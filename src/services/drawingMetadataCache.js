function statValue(value) {
  if (typeof value === 'bigint') return value.toString()
  return Number.isFinite(Number(value)) ? String(value) : ''
}

export function drawingStatSignature(fileStat) {
  if (!fileStat) return ''
  return [
    fileStat.dev,
    fileStat.ino,
    fileStat.mode,
    fileStat.size,
    fileStat.mtimeNs ?? fileStat.mtimeMs,
    fileStat.ctimeNs ?? fileStat.ctimeMs,
    fileStat.birthtimeNs ?? fileStat.birthtimeMs
  ].map(statValue).join(':')
}

export function createDrawingMetadataCache({
  keyForName = name => String(name),
  shouldCacheError = () => false
} = {}) {
  const entries = new Map()
  let hits = 0
  let misses = 0

  function key(name) {
    return keyForName(String(name))
  }

  function set(name, fileStat, value) {
    entries.set(key(name), { signature: drawingStatSignature(fileStat), value, pending: null })
    return value
  }

  async function getOrLoad(name, fileStat, loader) {
    const cacheKey = key(name)
    const signature = drawingStatSignature(fileStat)
    const existing = entries.get(cacheKey)
    if (existing?.signature === signature) {
      hits += 1
      if (existing.error) throw existing.error
      return existing.pending || existing.value
    }
    misses += 1
    const pending = Promise.resolve().then(loader)
    const entry = { signature, value: undefined, pending }
    entries.set(cacheKey, entry)
    try {
      const value = await pending
      if (entries.get(cacheKey) === entry) entries.set(cacheKey, { signature, value, pending: null })
      return value
    } catch (error) {
      if (entries.get(cacheKey) === entry) {
        if (shouldCacheError(error)) entries.set(cacheKey, { signature, value: undefined, pending: null, error })
        else entries.delete(cacheKey)
      }
      throw error
    }
  }

  function invalidate(name) {
    return entries.delete(key(name))
  }

  function retain(names) {
    const retained = new Set([...names].map(key))
    for (const cacheKey of entries.keys()) {
      if (!retained.has(cacheKey)) entries.delete(cacheKey)
    }
  }

  return {
    getOrLoad,
    set,
    invalidate,
    retain,
    clear() { entries.clear() },
    get stats() { return { entries: entries.size, hits, misses } }
  }
}
