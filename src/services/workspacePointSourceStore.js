import { normalizeWorkspaceId } from '../utils/workspaceIdentity.js'

const DEFAULT_STORAGE_PREFIX = 'tc2d-point-sources:v1:'
const LEGACY_SNAPSHOT_VERSION = 1
const MANIFEST_VERSION = 2
const POINT_SHARD_VERSION = 1
const DEFAULT_INDEXED_DB_NAME = 'tc2d-point-sources'
const DEFAULT_INDEXED_DB_STORE_NAME = 'workspace-point-sources'
const INDEXED_DB_VERSION = 1
const LEGACY_INDEXED_DB_POINT_CHUNK_MAX_ITEMS = 256
const INDEXED_DB_POINT_CHUNK_MAX_ITEMS = 256
const INDEXED_DB_OPERATIONS_PER_YIELD = 4

const SENSITIVE_CONFIG_KEY = /(?:password|passwd|pwd|secret|token|auth(?:entication|orization)?|signature|api[_-]?key|access[_-]?key|credential|headers?)/i
const VOLATILE_CONFIG_KEY = /^(?:subprotocol|subscribeMessage)$/i
const SAFE_URL_QUERY_KEYS = new Set(['site', 'format'])

function cloneValue(value) {
  if (value == null || typeof value !== 'object') return value
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function requiredWorkspaceId(value) {
  const workspaceId = normalizeWorkspaceId(value)
  if (!workspaceId) throw new TypeError('工作空间不能为空')
  return workspaceId
}

function browserStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function stripUrlCredentials(value) {
  const text = String(value ?? '')
  if (!text.includes('://')) return text
  try {
    const url = new URL(text)
    url.username = ''
    url.password = ''
    // 仅持久化明确用于路由或响应格式的参数，未知参数按凭据处理。
    for (const key of [...url.searchParams.keys()]) {
      if (!SAFE_URL_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    // 非标准协议地址也保守移除 userinfo、查询参数和片段。
    return text.replace(/:\/\/[^/@\s]+@/u, '://').replace(/[?#][\s\S]*$/u, '')
  }
}

export function isSensitivePointSourceConfigKey(key) {
  return SENSITIVE_CONFIG_KEY.test(String(key ?? ''))
}

function sanitizeStructuredConfig(value) {
  if (Array.isArray(value)) {
    let changed = false
    const persisted = value.map(item => {
      const result = sanitizeStructuredConfig(item)
      if (result.changed) changed = true
      return result.persisted
    })
    return { persisted, changed }
  }

  if (value && Object.prototype.toString.call(value) === '[object Object]') {
    let changed = false
    const persisted = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      const result = sanitizeConfigEntry(key, nestedValue)
      if (!result.include) {
        changed = true
        continue
      }
      persisted[key] = result.persisted
      if (result.changed) changed = true
    }
    return { persisted, changed }
  }

  return { persisted: cloneValue(value), changed: false }
}

function sanitizeJsonConfigString(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { persisted: value, changed: false }
  }
  try {
    const result = sanitizeStructuredConfig(JSON.parse(value))
    return result.changed
      ? { persisted: JSON.stringify(result.persisted), changed: true }
      : { persisted: value, changed: false }
  } catch {
    return { persisted: value, changed: false }
  }
}

function sanitizeConfigEntry(key, value) {
  if (isSensitivePointSourceConfigKey(key) || VOLATILE_CONFIG_KEY.test(String(key ?? ''))) {
    return { include: false, persisted: undefined, changed: true }
  }
  if (/url$/i.test(key)) {
    const originalUrl = String(value ?? '')
    const persistedUrl = stripUrlCredentials(value)
    return { include: true, persisted: persistedUrl, changed: persistedUrl !== originalUrl }
  }
  if (typeof value === 'string') {
    return { include: true, ...sanitizeJsonConfigString(value) }
  }
  return { include: true, ...sanitizeStructuredConfig(value) }
}

function splitConfig(config = {}) {
  const persisted = {}
  const volatile = {}
  for (const [key, value] of Object.entries(config || {})) {
    const result = sanitizeConfigEntry(key, value)
    if (!result.include) {
      volatile[key] = cloneValue(value)
      continue
    }
    persisted[key] = result.persisted
    if (result.changed) volatile[key] = cloneValue(value)
  }
  return { persisted, volatile }
}

function sanitizeLastResponse(value) {
  if (!value || typeof value !== 'object') return null
  return {
    ok: cloneValue(value.ok),
    at: cloneValue(value.at),
    durationMs: cloneValue(value.durationMs),
    message: '',
    preview: ''
  }
}

// 清单只保存连接元数据，点位数组放在独立分片中，配置编辑不再序列化整个目录。
function sanitizeSourceMetadata(source) {
  const { points: _points, ...metadata } = source || {}
  const { persisted, volatile: volatileConfig } = splitConfig(metadata.config)
  const volatile = {}
  if (Object.keys(volatileConfig).length) volatile.config = volatileConfig
  if (metadata.lastResponse != null) volatile.lastResponse = cloneValue(metadata.lastResponse)
  const sanitized = {
    ...metadata,
    config: persisted,
    lastResponse: sanitizeLastResponse(metadata.lastResponse)
  }
  return { sanitized, volatile }
}

function restoreVolatileConfig(sources, stateBySource) {
  return sources.map(source => {
    const volatile = stateBySource.get(String(source.id)) || {}
    const restored = {
      ...source,
      config: {
        ...(source.config || {}),
        ...(volatile.config || {})
      }
    }
    if (Object.hasOwn(volatile, 'lastResponse')) restored.lastResponse = cloneValue(volatile.lastResponse)
    return restored
  })
}

function persistenceResult(durable, reason = '') {
  return Object.freeze({
    durable: Boolean(durable),
    mode: durable ? 'durable' : 'memory',
    reason: durable ? '' : (String(reason || '') || 'storage-write-failed')
  })
}

export class PointSourceStorageCorruptionError extends Error {
  constructor(workspaceId, detail, options = {}) {
    super(`数据源存储损坏：${String(detail || '未知错误')}`)
    this.name = 'PointSourceStorageCorruptionError'
    this.code = 'POINT_SOURCE_STORAGE_CORRUPT'
    this.workspaceId = String(workspaceId)
    this.validSources = Array.isArray(options.validSources) ? options.validSources : []
    this.invalidSourceIds = Array.isArray(options.invalidSourceIds) ? options.invalidSourceIds : []
    if (options.cause !== undefined) this.cause = options.cause
  }
}

function indexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function indexedDbTransactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
  })
}

function createPointSourceIndexedDbDriver({ indexedDB, databaseName, storeName }) {
  let databasePromise = null

  function openDatabase() {
    if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB is unavailable'))
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, INDEXED_DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName)
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => database.close()
        resolve(database)
      }
      request.onerror = () => reject(request.error || new Error('Unable to open point-source IndexedDB'))
      request.onblocked = () => reject(new Error('Point-source IndexedDB upgrade is blocked'))
    }).catch(error => {
      databasePromise = null
      throw error
    })
    return databasePromise
  }

  async function run(mode, action) {
    const database = await openDatabase()
    const transaction = database.transaction(storeName, mode)
    const completed = indexedDbTransactionComplete(transaction)
    try {
      const value = await action(transaction.objectStore(storeName))
      await completed
      return value
    } catch (error) {
      try { transaction.abort() } catch {}
      await completed.catch(() => {})
      throw error
    }
  }

  return {
    get(key) {
      return run('readonly', store => indexedDbRequest(store.get(key)))
    },
    put(key, value) {
      return run('readwrite', store => indexedDbRequest(store.put(value, key)))
    },
    delete(key) {
      return run('readwrite', store => indexedDbRequest(store.delete(key)))
    },
    close() {
      void databasePromise?.then(database => database.close()).catch(() => {})
      databasePromise = null
    }
  }
}

function legacyStorageValue(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null
  } catch {
    return null
  }
}

function parseLegacyManifest(serialized) {
  const snapshot = JSON.parse(serialized)
  if (![LEGACY_SNAPSHOT_VERSION, MANIFEST_VERSION].includes(snapshot?.version) || !Array.isArray(snapshot.sources)) {
    throw new TypeError('数据源快照格式无效')
  }
  return snapshot
}

function parseLegacyPointShard(serialized, expectedSourceId) {
  const shard = JSON.parse(serialized)
  if (shard?.version !== POINT_SHARD_VERSION || String(shard.sourceId) !== String(expectedSourceId) || !Array.isArray(shard.points)) {
    throw new TypeError('数据源点位分片格式无效')
  }
  return shard.points
}

function readLegacyPointSourceSnapshot(storage, prefix, workspaceId) {
  const manifestKey = `${prefix}${encodeURIComponent(workspaceId)}`
  const serialized = legacyStorageValue(storage, manifestKey)
  if (!serialized) return null

  let snapshot
  try {
    snapshot = parseLegacyManifest(serialized)
  } catch (error) {
    throw new PointSourceStorageCorruptionError(workspaceId, '数据源清单无法解析', { cause: error })
  }

  if (snapshot.version === LEGACY_SNAPSHOT_VERSION) {
    const invalid = snapshot.sources.some(source => (
      !source
      || typeof source !== 'object'
      || Array.isArray(source)
      || !String(source.id ?? '').trim()
    ))
    if (invalid) {
      throw new PointSourceStorageCorruptionError(
        workspaceId,
        '旧版数据源快照迁移失败',
        { cause: new TypeError('旧版数据源快照包含无效条目') }
      )
    }
    return { sources: cloneValue(snapshot.sources), keys: [manifestKey] }
  }

  const sources = []
  const invalidSourceIds = []
  const keys = [manifestKey]
  const shardKeys = new Set()
  for (const [index, entry] of snapshot.sources.entries()) {
    const sourceId = String(entry?.id ?? `#${index + 1}`)
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError('数据源清单项格式无效')
      }
      const { pointShardKey, ...metadata } = entry
      const ownedPrefix = `${manifestKey}:points:${encodeURIComponent(String(metadata.id))}:`
      if (typeof pointShardKey !== 'string' || !pointShardKey.startsWith(ownedPrefix) || shardKeys.has(pointShardKey)) {
        throw new TypeError(`数据源点位分片引用无效：${metadata.id}`)
      }
      const serializedPoints = pointShardKey ? legacyStorageValue(storage, pointShardKey) : null
      if (!serializedPoints) throw new TypeError(`数据源点位分片缺失：${metadata.id}`)
      sources.push({ ...cloneValue(metadata), points: parseLegacyPointShard(serializedPoints, metadata.id) })
      keys.push(pointShardKey)
      shardKeys.add(pointShardKey)
    } catch {
      invalidSourceIds.push(sourceId)
    }
  }
  if (invalidSourceIds.length) {
    throw new PointSourceStorageCorruptionError(
      workspaceId,
      `${invalidSourceIds.length} 个数据源的点位分片缺失或损坏`,
      { validSources: sources, invalidSourceIds }
    )
  }
  return { sources, keys }
}

function removeLegacyPointSourceSnapshot(storage, keys) {
  for (const key of keys) {
    try { storage?.removeItem?.(key) } catch {}
  }
}

function defaultPointSourceYield() {
  try {
    if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield()
  } catch {}
  return new Promise(resolve => setTimeout(resolve, 0))
}

function pointRevisionNamespace() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replaceAll('-', '')
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const random = new Uint32Array(4)
      globalThis.crypto.getRandomValues(random)
      return [...random].map(value => value.toString(36)).join('-')
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createIndexedDbWorkspacePointSourceStore(options) {
  const prefix = String(options.prefix || DEFAULT_STORAGE_PREFIX)
  const indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB
  const injectedDriver = options.indexedDbDriver || null
  const driver = injectedDriver || createPointSourceIndexedDbDriver({
    indexedDB,
    databaseName: options.databaseName || DEFAULT_INDEXED_DB_NAME,
    storeName: options.storeName || DEFAULT_INDEXED_DB_STORE_NAME
  })
  const legacyStorage = Object.hasOwn(options, 'legacyStorage') ? options.legacyStorage : browserStorage()
  const lockManager = Object.hasOwn(options, 'lockManager') ? options.lockManager : globalThis.navigator?.locks
  const yieldControl = options.yieldControl || defaultPointSourceYield
  const pointChunkMaxItems = Math.max(1, Math.floor(Number(options.pointChunkMaxItems) || INDEXED_DB_POINT_CHUNK_MAX_ITEMS))
  const operationsPerYield = Math.max(1, Math.floor(Number(options.operationsPerYield) || INDEXED_DB_OPERATIONS_PER_YIELD))
  const manifestCache = new Map()
  const durableManifestCache = new Map()
  const snapshotCache = new Map()
  const volatileSecrets = new Map()
  const persistenceByWorkspace = new Map()
  const memoryOnlyWorkspaces = new Set()
  const durablePointKeys = new Set()
  const operationQueues = new Map()
  const revisionNamespace = pointRevisionNamespace()
  let pointRevision = 0

  function manifestKey(workspaceId) {
    return `${prefix}${encodeURIComponent(workspaceId)}`
  }

  function nextPointRevision() {
    pointRevision += 1
    return `${Date.now().toString(36)}-${revisionNamespace}-${pointRevision.toString(36)}`
  }

  function pointChunkKey(workspaceId, sourceId, revision, sequence) {
    return `${manifestKey(workspaceId)}:idb-points:${encodeURIComponent(String(sourceId))}:${revision}:${sequence}`
  }

  function pointChunkRecords(workspaceId, sourceId, points) {
    const sourcePoints = Array.isArray(points) ? points : []
    const revision = nextPointRevision()
    const records = []
    for (let start = 0, sequence = 0; start < sourcePoints.length; start += pointChunkMaxItems, sequence += 1) {
      const key = pointChunkKey(workspaceId, sourceId, revision, sequence)
      records.push({
        key,
        value: {
          version: POINT_SHARD_VERSION,
          sourceId: String(sourceId),
          sequence,
          points: sourcePoints.slice(start, start + pointChunkMaxItems)
        }
      })
    }
    return records
  }

  async function yieldAfter(index) {
    if ((index + 1) % operationsPerYield === 0) await yieldControl()
  }

  async function stagePointChunks(records) {
    const writtenKeys = []
    try {
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]
        await driver.put(record.key, record.value)
        writtenKeys.push(record.key)
        durablePointKeys.add(record.key)
        await yieldAfter(index)
      }
      return writtenKeys
    } catch (error) {
      await cleanupPointKeys(writtenKeys)
      throw error
    }
  }

  async function cleanupPointKeys(keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]
      try {
        await driver.delete(key)
        durablePointKeys.delete(key)
      } catch {}
      await yieldAfter(index)
    }
  }

  function sourceEntryAndChunks(workspaceId, source) {
    const sourceId = String(source?.id ?? '')
    const { sanitized, volatile } = sanitizeSourceMetadata(source)
    const records = pointChunkRecords(workspaceId, sourceId, source?.points)
    return {
      entry: {
        ...sanitized,
        pointChunkKeys: records.map(record => record.key),
        pointCount: Array.isArray(source?.points) ? source.points.length : 0,
        pointChunkMaxItems
      },
      records,
      volatile
    }
  }

  function pointKeysFromManifest(manifest) {
    if (manifest?.version !== MANIFEST_VERSION || !Array.isArray(manifest.sources)) return []
    return manifest.sources.flatMap(entry => Array.isArray(entry?.pointChunkKeys) ? entry.pointChunkKeys : [])
  }

  function persistedPointChunkMaxItems(entry) {
    if (entry?.pointChunkMaxItems == null) return LEGACY_INDEXED_DB_POINT_CHUNK_MAX_ITEMS
    const value = entry.pointChunkMaxItems
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  }

  function validateStructuredManifest(value, workspaceId) {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.version !== MANIFEST_VERSION
      || value.workspaceId !== workspaceId
      || !Array.isArray(value.sources)
    ) {
      throw new PointSourceStorageCorruptionError(workspaceId, '数据源清单无法解析')
    }
    const sourceIds = new Set()
    const chunkKeys = new Set()
    for (const entry of value.sources) {
      const sourceId = String(entry?.id ?? '')
      const entryPointChunkMaxItems = persistedPointChunkMaxItems(entry)
      if (
        !entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || !sourceId.trim()
        || sourceIds.has(sourceId)
        || !Array.isArray(entry.pointChunkKeys)
        || !Number.isSafeInteger(entry.pointCount)
        || entry.pointCount < 0
        || !entryPointChunkMaxItems
        || entry.pointChunkKeys.length !== Math.ceil(entry.pointCount / entryPointChunkMaxItems)
      ) {
        throw new PointSourceStorageCorruptionError(workspaceId, '数据源清单项格式无效')
      }
      sourceIds.add(sourceId)
      const ownedPrefix = `${manifestKey(workspaceId)}:idb-points:${encodeURIComponent(sourceId)}:`
      for (let sequence = 0; sequence < entry.pointChunkKeys.length; sequence += 1) {
        const key = entry.pointChunkKeys[sequence]
        const revisionAndSequence = typeof key === 'string' && key.startsWith(ownedPrefix)
          ? key.slice(ownedPrefix.length)
          : ''
        const separator = revisionAndSequence.lastIndexOf(':')
        const revision = revisionAndSequence.slice(0, separator)
        const storedSequence = revisionAndSequence.slice(separator + 1)
        if (
          !revision
          || revision.includes(':')
          || storedSequence !== String(sequence)
          || chunkKeys.has(key)
        ) {
          throw new PointSourceStorageCorruptionError(workspaceId, '数据源点位分片引用无效')
        }
        chunkKeys.add(key)
      }
    }
    return value
  }

  function replaceDurableManifest(workspaceId, manifest) {
    const previousKeys = new Set(pointKeysFromManifest(durableManifestCache.get(workspaceId)))
    const currentKeys = new Set(pointKeysFromManifest(manifest))
    for (const key of previousKeys) if (!currentKeys.has(key)) durablePointKeys.delete(key)
    for (const key of currentKeys) durablePointKeys.add(key)
    if (manifest == null) {
      manifestCache.delete(workspaceId)
      durableManifestCache.delete(workspaceId)
      return
    }
    manifestCache.set(workspaceId, manifest)
    durableManifestCache.set(workspaceId, manifest)
  }

  async function readManifest(workspaceId, readOptions = {}) {
    if (readOptions.refresh !== true && manifestCache.has(workspaceId)) return manifestCache.get(workspaceId)
    const value = await driver.get(manifestKey(workspaceId))
    if (value == null) {
      if (readOptions.refresh === true) replaceDurableManifest(workspaceId, null)
      return null
    }
    const manifest = validateStructuredManifest(value, workspaceId)
    replaceDurableManifest(workspaceId, manifest)
    return manifest
  }

  async function readManifestOrCache(workspaceId, readOptions = {}) {
    try {
      return await readManifest(workspaceId, readOptions)
    } catch (error) {
      if (error instanceof PointSourceStorageCorruptionError) throw error
      if (readOptions.refresh === true) return null
      if (manifestCache.has(workspaceId)) return manifestCache.get(workspaceId)
      return null
    }
  }

  async function hydrateManifest(workspaceId, manifest) {
    const secrets = volatileSecrets.get(workspaceId) || new Map()
    const validSources = []
    const invalidSourceIds = []
    let operationIndex = 0
    for (const [index, entry] of manifest.sources.entries()) {
      const sourceId = String(entry?.id ?? `#${index + 1}`)
      const entryPointChunkMaxItems = persistedPointChunkMaxItems(entry)
      if (
        !entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || !String(entry.id ?? '').trim()
        || !Array.isArray(entry.pointChunkKeys)
        || !Number.isSafeInteger(entry.pointCount)
        || entry.pointCount < 0
        || !entryPointChunkMaxItems
      ) {
        invalidSourceIds.push(sourceId)
        continue
      }
      const points = []
      let invalid = entry.pointChunkKeys.length === 0 && entry.pointCount !== 0
      for (let sequence = 0; !invalid && sequence < entry.pointChunkKeys.length; sequence += 1) {
        const key = entry.pointChunkKeys[sequence]
        const shard = await driver.get(key)
        operationIndex += 1
        await yieldAfter(operationIndex - 1)
        if (
          !shard
          || typeof shard !== 'object'
          || Array.isArray(shard)
          || shard.version !== POINT_SHARD_VERSION
          || String(shard.sourceId) !== String(entry.id)
          || shard.sequence !== sequence
          || !Array.isArray(shard.points)
          || shard.points.length > entryPointChunkMaxItems
        ) {
          invalid = true
          break
        }
        points.push(...shard.points)
        durablePointKeys.add(key)
      }
      if (invalid || points.length !== entry.pointCount) {
        invalidSourceIds.push(sourceId)
        continue
      }
      const {
        pointChunkKeys: _pointChunkKeys,
        pointCount: _pointCount,
        pointChunkMaxItems: _pointChunkMaxItems,
        ...metadata
      } = entry
      validSources.push({ ...cloneValue(metadata), points })
    }

    const restored = restoreVolatileConfig(validSources, secrets)
    if (invalidSourceIds.length) {
      throw new PointSourceStorageCorruptionError(
        workspaceId,
        `${invalidSourceIds.length} 个数据源的点位分片缺失或损坏`,
        { validSources: restored, invalidSourceIds }
      )
    }
    return restored
  }

  function cacheSourceSnapshot(workspaceId, entries, sources, secrets) {
    const persistedSources = entries.map((entry, index) => {
      const {
        pointChunkKeys: _pointChunkKeys,
        pointCount: _pointCount,
        pointChunkMaxItems: _pointChunkMaxItems,
        ...metadata
      } = entry
      return {
        ...cloneValue(metadata),
        points: Array.isArray(sources[index]?.points) ? sources[index].points : []
      }
    })
    snapshotCache.set(workspaceId, restoreVolatileConfig(persistedSources, secrets))
  }

  function setPersistence(workspaceId, result) {
    persistenceByWorkspace.set(workspaceId, result)
    return result
  }

  function updateVolatileSecrets(workspaceId, sourceId, volatile) {
    const secrets = volatileSecrets.get(workspaceId) || new Map()
    if (Object.keys(volatile).length) secrets.set(String(sourceId), volatile)
    else secrets.delete(String(sourceId))
    volatileSecrets.set(workspaceId, secrets)
  }

  function markMemoryOnly(workspaceId) {
    memoryOnlyWorkspaces.add(workspaceId)
    return setPersistence(workspaceId, persistenceResult(false))
  }

  function previousPointKeys(workspaceId, manifest = null) {
    return [...new Set([
      ...pointKeysFromManifest(durableManifestCache.get(workspaceId)),
      ...pointKeysFromManifest(manifest)
    ])]
  }

  async function publishManifest(workspaceId, manifest, stagedRecords, previousPointKeys) {
    const stagedKeys = stagedRecords.map(record => record.key)
    const lastDurableKeys = pointKeysFromManifest(durableManifestCache.get(workspaceId))
    try {
      await stagePointChunks(stagedRecords)
      await driver.put(manifestKey(workspaceId), manifest)
    } catch {
      await cleanupPointKeys(stagedKeys)
      for (const key of stagedKeys) durablePointKeys.delete(key)
      memoryOnlyWorkspaces.add(workspaceId)
      return setPersistence(workspaceId, persistenceResult(false))
    }

    memoryOnlyWorkspaces.delete(workspaceId)
    durableManifestCache.set(workspaceId, manifest)
    const result = setPersistence(workspaceId, persistenceResult(true))
    const currentKeys = new Set(pointKeysFromManifest(manifest))
    const obsoleteKeys = [...new Set([...previousPointKeys, ...lastDurableKeys])]
      .filter(key => !currentKeys.has(key))
    await cleanupPointKeys(obsoleteKeys)
    return result
  }

  async function loadLegacy(workspaceId) {
    const legacy = readLegacyPointSourceSnapshot(legacyStorage, prefix, workspaceId)
    if (!legacy) return null
    const result = await saveCore(workspaceId, legacy.sources)
    if (result.durable) removeLegacyPointSourceSnapshot(legacyStorage, legacy.keys)
    return snapshotCache.get(workspaceId) || legacy.sources
  }

  async function loadCore(workspaceId) {
    if (memoryOnlyWorkspaces.has(workspaceId) && snapshotCache.has(workspaceId)) {
      return snapshotCache.get(workspaceId)
    }

    let manifest
    try {
      manifest = await readManifest(workspaceId, { refresh: true })
    } catch (error) {
      if (error instanceof PointSourceStorageCorruptionError) throw error
      markMemoryOnly(workspaceId)
      if (snapshotCache.has(workspaceId)) return snapshotCache.get(workspaceId)
      return loadLegacy(workspaceId)
    }
    if (!manifest) return loadLegacy(workspaceId)

    try {
      const sources = await hydrateManifest(workspaceId, manifest)
      snapshotCache.set(workspaceId, sources)
      memoryOnlyWorkspaces.delete(workspaceId)
      setPersistence(workspaceId, persistenceResult(true))
      return sources
    } catch (error) {
      if (error instanceof PointSourceStorageCorruptionError) throw error
      markMemoryOnly(workspaceId)
      if (snapshotCache.has(workspaceId)) return snapshotCache.get(workspaceId)
      return loadLegacy(workspaceId)
    }
  }

  async function saveCore(workspaceId, sources) {
    if (!Array.isArray(sources)) throw new TypeError('数据源列表必须是数组')
    const previousManifest = await readManifestOrCache(workspaceId, {
      refresh: !memoryOnlyWorkspaces.has(workspaceId)
    })
    const secrets = new Map()
    const entries = []
    const stagedRecords = []
    for (const source of sources) {
      const prepared = sourceEntryAndChunks(workspaceId, source)
      entries.push(prepared.entry)
      stagedRecords.push(...prepared.records)
      if (Object.keys(prepared.volatile).length) secrets.set(String(source?.id), prepared.volatile)
    }
    const manifest = {
      version: MANIFEST_VERSION,
      workspaceId,
      updatedAt: new Date().toISOString(),
      sources: entries
    }
    volatileSecrets.set(workspaceId, secrets)
    manifestCache.set(workspaceId, manifest)
    cacheSourceSnapshot(workspaceId, entries, sources, secrets)
    memoryOnlyWorkspaces.add(workspaceId)
    return publishManifest(workspaceId, manifest, stagedRecords, previousPointKeys(workspaceId, previousManifest))
  }

  async function ensureSnapshotCache(workspaceId, manifest) {
    if (snapshotCache.has(workspaceId)) return snapshotCache.get(workspaceId)
    const sources = await hydrateManifest(workspaceId, manifest)
    snapshotCache.set(workspaceId, sources)
    return sources
  }

  async function saveSourceCore(workspaceId, source, saveOptions = {}) {
    const currentManifest = await readManifestOrCache(workspaceId, {
      refresh: !memoryOnlyWorkspaces.has(workspaceId)
    })
    if (currentManifest?.version !== MANIFEST_VERSION) return null
    const sourceId = String(source?.id ?? '')
    if (!sourceId) throw new TypeError('数据源 ID 不能为空')
    const currentEntry = currentManifest.sources.find(entry => String(entry.id) === sourceId) || null
    const currentSources = await ensureSnapshotCache(workspaceId, currentManifest)
    const currentKeys = Array.isArray(currentEntry?.pointChunkKeys) ? currentEntry.pointChunkKeys : []
    const pointsChanged = saveOptions.pointsChanged !== false
      || !currentEntry
      || currentKeys.some(key => !durablePointKeys.has(key))
    const { sanitized, volatile } = sanitizeSourceMetadata(source)
    const stagedRecords = pointsChanged ? pointChunkRecords(workspaceId, sourceId, source.points) : []
    const nextEntry = {
      ...sanitized,
      pointChunkKeys: pointsChanged ? stagedRecords.map(record => record.key) : currentKeys,
      pointCount: pointsChanged
        ? (Array.isArray(source.points) ? source.points.length : 0)
        : Number(currentEntry.pointCount) || 0,
      pointChunkMaxItems: pointsChanged
        ? pointChunkMaxItems
        : persistedPointChunkMaxItems(currentEntry)
    }
    const nextEntries = currentEntry
      ? currentManifest.sources.map(entry => String(entry.id) === sourceId ? nextEntry : entry)
      : [...currentManifest.sources, nextEntry]
    const nextSources = currentEntry
      ? currentSources.map(item => String(item.id) === sourceId ? source : item)
      : [...currentSources, source]
    updateVolatileSecrets(workspaceId, sourceId, volatile)
    const manifest = {
      version: MANIFEST_VERSION,
      workspaceId,
      updatedAt: new Date().toISOString(),
      sources: nextEntries
    }
    manifestCache.set(workspaceId, manifest)
    snapshotCache.set(workspaceId, nextSources)
    memoryOnlyWorkspaces.add(workspaceId)

    const stagedKeys = new Set(stagedRecords.map(record => record.key))
    const canPublish = nextEntries.every(entry => (
      Array.isArray(entry.pointChunkKeys)
      && entry.pointChunkKeys.every(key => stagedKeys.has(key) || durablePointKeys.has(key))
    ))
    if (!canPublish) return markMemoryOnly(workspaceId)
    const durableEntry = durableManifestCache.get(workspaceId)?.sources?.find(entry => String(entry.id) === sourceId)
    const replacedKeys = pointsChanged
      ? [...new Set([...currentKeys, ...(durableEntry?.pointChunkKeys || [])])]
      : []
    return publishManifest(workspaceId, manifest, stagedRecords, replacedKeys)
  }

  async function removeSourceCore(workspaceId, sourceId) {
    const currentManifest = await readManifestOrCache(workspaceId, {
      refresh: !memoryOnlyWorkspaces.has(workspaceId)
    })
    if (currentManifest?.version !== MANIFEST_VERSION) return null
    const normalizedSourceId = String(sourceId)
    const currentSources = await ensureSnapshotCache(workspaceId, currentManifest)
    const removedEntry = currentManifest.sources.find(entry => String(entry.id) === normalizedSourceId) || null
    const nextEntries = currentManifest.sources.filter(entry => String(entry.id) !== normalizedSourceId)
    const manifest = {
      version: MANIFEST_VERSION,
      workspaceId,
      updatedAt: new Date().toISOString(),
      sources: nextEntries
    }
    manifestCache.set(workspaceId, manifest)
    snapshotCache.set(workspaceId, currentSources.filter(source => String(source.id) !== normalizedSourceId))
    volatileSecrets.get(workspaceId)?.delete(normalizedSourceId)
    memoryOnlyWorkspaces.add(workspaceId)
    const canPublish = pointKeysFromManifest(manifest).every(key => durablePointKeys.has(key))
    if (!canPublish) return markMemoryOnly(workspaceId)
    const durableEntry = durableManifestCache.get(workspaceId)?.sources?.find(entry => String(entry.id) === normalizedSourceId)
    const removedKeys = [...new Set([
      ...(removedEntry?.pointChunkKeys || []),
      ...(durableEntry?.pointChunkKeys || [])
    ])]
    return publishManifest(workspaceId, manifest, [], removedKeys)
  }

  async function removeCore(workspaceId) {
    const manifest = await readManifestOrCache(workspaceId, {
      refresh: !memoryOnlyWorkspaces.has(workspaceId)
    })
    const oldKeys = previousPointKeys(workspaceId, manifest)
    snapshotCache.set(workspaceId, null)
    manifestCache.delete(workspaceId)
    volatileSecrets.delete(workspaceId)
    memoryOnlyWorkspaces.add(workspaceId)
    try {
      await driver.delete(manifestKey(workspaceId))
      memoryOnlyWorkspaces.delete(workspaceId)
      durableManifestCache.delete(workspaceId)
      persistenceByWorkspace.delete(workspaceId)
      await cleanupPointKeys(oldKeys)
    } catch {
      markMemoryOnly(workspaceId)
    }
    return true
  }

  function enqueue(workspaceId, operation) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    const previous = operationQueues.get(normalizedWorkspaceId) || Promise.resolve()
    const run = () => operation(normalizedWorkspaceId)
    const current = previous.catch(() => {}).then(async () => {
      if (typeof lockManager?.request !== 'function') return run()
      let started = false
      try {
        return await lockManager.request(
          `tc2d-point-sources:${encodeURIComponent(normalizedWorkspaceId)}`,
          { mode: 'exclusive' },
          () => {
            started = true
            return run()
          }
        )
      } catch (error) {
        if (started) throw error
        return run()
      }
    })
    operationQueues.set(normalizedWorkspaceId, current)
    return current.finally(() => {
      if (operationQueues.get(normalizedWorkspaceId) === current) operationQueues.delete(normalizedWorkspaceId)
    })
  }

  function getPersistenceStatus(workspaceId) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    if (persistenceByWorkspace.has(normalizedWorkspaceId)) return persistenceByWorkspace.get(normalizedWorkspaceId)
    const available = Boolean(injectedDriver || indexedDB?.open)
    return persistenceResult(available, available ? '' : 'storage-unavailable')
  }

  return Object.freeze({
    load: workspaceId => enqueue(workspaceId, loadCore),
    save: (workspaceId, sources) => enqueue(workspaceId, id => saveCore(id, sources)),
    saveSource: (workspaceId, source, saveOptions) => enqueue(workspaceId, id => saveSourceCore(id, source, saveOptions)),
    removeSource: (workspaceId, sourceId) => enqueue(workspaceId, id => removeSourceCore(id, sourceId)),
    remove: workspaceId => enqueue(workspaceId, removeCore),
    getPersistenceStatus
  })
}

/**
 * 默认用 IndexedDB 的有界 structured-clone 分片持久化；显式 storage 注入保留旧版兼容实现。
 * 密码、令牌、授权头和响应正文只放在本 store 实例的内存中，不会明文写入持久层。
 */
export function createWorkspacePointSourceStore(options = {}) {
  if (!Object.hasOwn(options, 'storage')) return createIndexedDbWorkspacePointSourceStore(options)
  const storage = options.storage
  const prefix = String(options.prefix || DEFAULT_STORAGE_PREFIX)
  const memoryStorage = new Map()
  const volatileSecrets = new Map()
  const manifestCache = new Map()
  const persistenceByWorkspace = new Map()
  const durableShardKeys = new Set()
  let shardRevision = 0

  function storageKey(workspaceId) {
    return `${prefix}${encodeURIComponent(requiredWorkspaceId(workspaceId))}`
  }

  function pointShardKey(workspaceId, sourceId) {
    shardRevision += 1
    const revision = `${Date.now().toString(36)}-${shardRevision.toString(36)}`
    return `${storageKey(workspaceId)}:points:${encodeURIComponent(String(sourceId))}:${revision}`
  }

  // 内存中存在值意味着最近一次落盘失败；同一页面必须优先读到这份最新状态。
  function read(key) {
    if (memoryStorage.has(key)) return memoryStorage.get(key)
    if (storage?.getItem) {
      try {
        return storage.getItem(key) ?? null
      } catch {
        return null
      }
    }
    return null
  }

  function write(key, value) {
    if (storage?.setItem) {
      try {
        storage.setItem(key, value)
        memoryStorage.delete(key)
        return persistenceResult(true)
      } catch {
        // localStorage 被禁用或配额不足时，当前页面仍使用内存中的最新版本。
      }
    }
    memoryStorage.set(key, value)
    return persistenceResult(false)
  }

  function writeMemoryOnly(key, value) {
    memoryStorage.set(key, value)
    return persistenceResult(false)
  }

  function rollbackShardToMemory(key, serialized) {
    try { storage?.removeItem?.(key) } catch {}
    memoryStorage.set(key, serialized)
    durableShardKeys.delete(key)
  }

  function removeValue(key) {
    try { storage?.removeItem?.(key) } catch {}
    memoryStorage.delete(key)
    durableShardKeys.delete(key)
  }

  function setPersistence(workspaceId, result) {
    persistenceByWorkspace.set(workspaceId, result)
    return result
  }

  function updateVolatileSecrets(workspaceId, sourceId, volatile) {
    const secrets = volatileSecrets.get(workspaceId) || new Map()
    if (Object.keys(volatile).length) secrets.set(String(sourceId), volatile)
    else secrets.delete(String(sourceId))
    volatileSecrets.set(workspaceId, secrets)
  }

  function serializeManifest(workspaceId, sources) {
    return JSON.stringify({
      version: MANIFEST_VERSION,
      workspaceId,
      updatedAt: new Date().toISOString(),
      sources
    })
  }

  function parseManifest(serialized) {
    const snapshot = JSON.parse(serialized)
    if (![LEGACY_SNAPSHOT_VERSION, MANIFEST_VERSION].includes(snapshot?.version) || !Array.isArray(snapshot.sources)) {
      throw new TypeError('数据源快照格式无效')
    }
    return snapshot
  }

  function parsePointShard(serialized, expectedSourceId) {
    const shard = JSON.parse(serialized)
    if (shard?.version !== POINT_SHARD_VERSION || String(shard.sourceId) !== String(expectedSourceId) || !Array.isArray(shard.points)) {
      throw new TypeError('数据源点位分片格式无效')
    }
    return shard.points
  }

  function manifestFor(workspaceId) {
    if (manifestCache.has(workspaceId)) return manifestCache.get(workspaceId)
    const serialized = read(storageKey(workspaceId))
    if (!serialized) return null
    const manifest = parseManifest(serialized)
    manifestCache.set(workspaceId, manifest)
    return manifest
  }

  async function load(workspaceId) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    const key = storageKey(normalizedWorkspaceId)
    const serialized = read(key)
    if (!serialized) return null

    let snapshot
    try {
      snapshot = parseManifest(serialized)
    } catch (error) {
      throw new PointSourceStorageCorruptionError(
        normalizedWorkspaceId,
        '数据源清单无法解析',
        { cause: error }
      )
    }

    const secrets = volatileSecrets.get(normalizedWorkspaceId) || new Map()
    if (snapshot.version === LEGACY_SNAPSHOT_VERSION) {
      try {
        const hasInvalidSource = snapshot.sources.some(source => (
          !source
          || typeof source !== 'object'
          || Array.isArray(source)
          || !String(source.id ?? '').trim()
        ))
        if (hasInvalidSource) throw new TypeError('旧版数据源快照包含无效条目')
        const legacySources = restoreVolatileConfig(cloneValue(snapshot.sources), secrets)
        // 读取旧快照后迁移到分片格式；失败时旧持久快照仍保持完整，当前页走内存新格式。
        await save(normalizedWorkspaceId, legacySources)
        return legacySources
      } catch (error) {
        throw new PointSourceStorageCorruptionError(
          normalizedWorkspaceId,
          '旧版数据源快照迁移失败',
          { cause: error }
        )
      }
    }

    const validSources = []
    const invalidSourceIds = []
    const shardDurability = []
    for (const [index, entry] of snapshot.sources.entries()) {
      const sourceId = String(entry?.id ?? `#${index + 1}`)
      try {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new TypeError('数据源清单项格式无效')
        }
        const { pointShardKey: shardKey, ...metadata } = entry
        const serializedPoints = shardKey ? read(shardKey) : null
        if (!serializedPoints) throw new TypeError(`数据源点位分片缺失：${metadata.id}`)
        const source = {
          ...cloneValue(metadata),
          points: parsePointShard(serializedPoints, metadata.id)
        }
        validSources.push(restoreVolatileConfig([source], secrets)[0])
        shardDurability.push({ key: shardKey, durable: !memoryStorage.has(shardKey) })
      } catch {
        invalidSourceIds.push(sourceId)
      }
    }

    if (invalidSourceIds.length) {
      throw new PointSourceStorageCorruptionError(
        normalizedWorkspaceId,
        `${invalidSourceIds.length} 个数据源的点位分片缺失或损坏`,
        { validSources, invalidSourceIds }
      )
    }

    for (const shard of shardDurability) {
      if (shard.durable) durableShardKeys.add(shard.key)
      else durableShardKeys.delete(shard.key)
    }
    manifestCache.set(normalizedWorkspaceId, snapshot)
    return validSources
  }

  async function save(workspaceId, sources) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    if (!Array.isArray(sources)) throw new TypeError('数据源列表必须是数组')
    const previousManifest = manifestFor(normalizedWorkspaceId)
    const secrets = new Map()
    const entries = []
    const pendingShards = []
    let shardsDurable = true

    try {
      for (const source of sources) {
        const { sanitized, volatile } = sanitizeSourceMetadata(source)
        if (Object.keys(volatile).length) secrets.set(String(source.id), volatile)
        const shardKey = pointShardKey(normalizedWorkspaceId, source.id)
        const serializedShard = JSON.stringify({
          version: POINT_SHARD_VERSION,
          sourceId: String(source.id),
          points: Array.isArray(source.points) ? source.points : []
        })
        const shardResult = write(shardKey, serializedShard)
        pendingShards.push({ key: shardKey, serialized: serializedShard })
        if (shardResult.durable) durableShardKeys.add(shardKey)
        else durableShardKeys.delete(shardKey)
        if (!shardResult.durable) shardsDurable = false
        entries.push({ ...sanitized, pointShardKey: shardKey })
      }

      volatileSecrets.set(normalizedWorkspaceId, secrets)
      const manifest = {
        version: MANIFEST_VERSION,
        workspaceId: normalizedWorkspaceId,
        updatedAt: new Date().toISOString(),
        sources: entries
      }
      const serializedManifest = serializeManifest(normalizedWorkspaceId, entries)
      const manifestResult = shardsDurable
        ? write(storageKey(normalizedWorkspaceId), serializedManifest)
        : writeMemoryOnly(storageKey(normalizedWorkspaceId), serializedManifest)
      manifestCache.set(normalizedWorkspaceId, manifest)
      const result = setPersistence(
        normalizedWorkspaceId,
        persistenceResult(shardsDurable && manifestResult.durable)
      )

      if (!result.durable) {
        for (const shard of pendingShards) rollbackShardToMemory(shard.key, shard.serialized)
      } else if (previousManifest?.version === MANIFEST_VERSION) {
        // 新清单落盘后再清理旧分片，提交失败不会破坏最后一份完整快照。
        const currentKeys = new Set(entries.map(entry => entry.pointShardKey))
        for (const entry of previousManifest.sources) {
          if (entry.pointShardKey && !currentKeys.has(entry.pointShardKey)) removeValue(entry.pointShardKey)
        }
      }
      return result
    } catch (error) {
      for (const shard of pendingShards) removeValue(shard.key)
      throw error
    }
  }

  async function saveSource(workspaceId, source, options = {}) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    const currentManifest = manifestFor(normalizedWorkspaceId)
    if (currentManifest?.version !== MANIFEST_VERSION) return null

    const sourceId = String(source?.id ?? '')
    if (!sourceId) throw new TypeError('数据源 ID 不能为空')
    const currentEntry = currentManifest.sources.find(entry => String(entry.id) === sourceId) || null
    const pointsChanged = options.pointsChanged !== false
      || !currentEntry?.pointShardKey
      || !durableShardKeys.has(currentEntry.pointShardKey)
    let nextShardKey = currentEntry?.pointShardKey || ''
    let shardResult = persistenceResult(true)
    let serializedShard = ''
    const { sanitized, volatile } = sanitizeSourceMetadata(source)

    if (pointsChanged) {
      nextShardKey = pointShardKey(normalizedWorkspaceId, sourceId)
      serializedShard = JSON.stringify({
        version: POINT_SHARD_VERSION,
        sourceId,
        points: Array.isArray(source.points) ? source.points : []
      })
    }

    const nextEntry = { ...sanitized, pointShardKey: nextShardKey }
    const nextEntries = currentEntry
      ? currentManifest.sources.map(entry => String(entry.id) === sourceId ? nextEntry : entry)
      : [...currentManifest.sources, nextEntry]
    const serializedManifest = serializeManifest(normalizedWorkspaceId, nextEntries)
    updateVolatileSecrets(normalizedWorkspaceId, sourceId, volatile)
    if (pointsChanged) {
      shardResult = write(nextShardKey, serializedShard)
      if (shardResult.durable) durableShardKeys.add(nextShardKey)
      else durableShardKeys.delete(nextShardKey)
    }
    const allShardsDurable = shardResult.durable
      && nextEntries.every(entry => durableShardKeys.has(entry.pointShardKey))
    const manifestResult = allShardsDurable
      ? write(storageKey(normalizedWorkspaceId), serializedManifest)
      : writeMemoryOnly(storageKey(normalizedWorkspaceId), serializedManifest)
    const nextManifest = {
      version: MANIFEST_VERSION,
      workspaceId: normalizedWorkspaceId,
      updatedAt: new Date().toISOString(),
      sources: nextEntries
    }
    manifestCache.set(normalizedWorkspaceId, nextManifest)
    const result = setPersistence(
      normalizedWorkspaceId,
      persistenceResult(allShardsDurable && manifestResult.durable)
    )

    if (!result.durable && pointsChanged) {
      rollbackShardToMemory(nextShardKey, serializedShard)
    } else if (
      result.durable
      && pointsChanged
      && currentEntry?.pointShardKey
      && currentEntry.pointShardKey !== nextShardKey
    ) {
      removeValue(currentEntry.pointShardKey)
    }
    return result
  }

  async function removeSource(workspaceId, sourceId) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    const currentManifest = manifestFor(normalizedWorkspaceId)
    if (currentManifest?.version !== MANIFEST_VERSION) return null
    const normalizedSourceId = String(sourceId)
    const removedEntry = currentManifest.sources.find(entry => String(entry.id) === normalizedSourceId) || null
    const nextEntries = currentManifest.sources.filter(entry => String(entry.id) !== normalizedSourceId)
    const allShardsDurable = nextEntries.every(entry => durableShardKeys.has(entry.pointShardKey))
    const serializedManifest = serializeManifest(normalizedWorkspaceId, nextEntries)
    const manifestResult = allShardsDurable
      ? write(storageKey(normalizedWorkspaceId), serializedManifest)
      : writeMemoryOnly(storageKey(normalizedWorkspaceId), serializedManifest)
    manifestCache.set(normalizedWorkspaceId, {
      version: MANIFEST_VERSION,
      workspaceId: normalizedWorkspaceId,
      updatedAt: new Date().toISOString(),
      sources: nextEntries
    })
    volatileSecrets.get(normalizedWorkspaceId)?.delete(normalizedSourceId)
    const result = setPersistence(normalizedWorkspaceId, manifestResult)
    if (result.durable && removedEntry?.pointShardKey) removeValue(removedEntry.pointShardKey)
    return result
  }

  async function remove(workspaceId) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    let manifest = null
    try { manifest = manifestFor(normalizedWorkspaceId) } catch {}
    removeValue(storageKey(normalizedWorkspaceId))
    if (manifest?.version === MANIFEST_VERSION) {
      for (const entry of manifest.sources) if (entry.pointShardKey) removeValue(entry.pointShardKey)
    }
    manifestCache.delete(normalizedWorkspaceId)
    volatileSecrets.delete(normalizedWorkspaceId)
    persistenceByWorkspace.delete(normalizedWorkspaceId)
    return true
  }

  function getPersistenceStatus(workspaceId) {
    const normalizedWorkspaceId = requiredWorkspaceId(workspaceId)
    return persistenceByWorkspace.get(normalizedWorkspaceId) || persistenceResult(Boolean(storage), storage ? '' : 'storage-unavailable')
  }

  return Object.freeze({ load, save, saveSource, removeSource, remove, getPersistenceStatus })
}
