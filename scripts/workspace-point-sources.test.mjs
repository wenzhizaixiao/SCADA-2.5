import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { createLocalPointCatalogGateway } from '../src/services/pointCatalogGateway.js'
import { createWorkspacePointSourceStore } from '../src/services/workspacePointSourceStore.js'
import { sourceProtocolShortName } from '../src/utils/sourceConnectionList.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const managerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')
const pointSourceStoreSource = readFileSync(new URL('../src/services/workspacePointSourceStore.js', import.meta.url), 'utf8')

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    serialized() { return [...values.values()].join('\n') }
  }
}

function createControlledStorage() {
  const values = new Map()
  let rejectWrites = false
  let successfulWritesBeforeFailure = null
  let writes = []
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) {
      if (rejectWrites || successfulWritesBeforeFailure === 0) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      const serialized = String(value)
      values.set(key, serialized)
      writes.push({ key, value: serialized })
      if (successfulWritesBeforeFailure != null) successfulWritesBeforeFailure -= 1
    },
    removeItem(key) { values.delete(key) },
    rejectWrites(value = true) {
      rejectWrites = value
      if (!value) successfulWritesBeforeFailure = null
    },
    failAfterSuccessfulWrites(count) {
      rejectWrites = false
      successfulWritesBeforeFailure = Math.max(0, Number(count) || 0)
    },
    resetWrites() { writes = [] },
    writes() { return [...writes] },
    keys() { return [...values.keys()].sort() },
    rawValue(key) { return values.get(key) ?? null },
    setRaw(key, value) { values.set(key, String(value)) },
    deleteRaw(key) { values.delete(key) }
  }
}

function createStructuredPointSourceDriver() {
  const values = new Map()
  const writes = []
  let rejectWrites = false
  let successfulWritesBeforeFailure = null
  const clone = value => value === undefined ? undefined : structuredClone(value)
  return {
    async get(key) { return clone(values.get(key)) },
    async put(key, value) {
      if (rejectWrites || successfulWritesBeforeFailure === 0) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      const stored = clone(value)
      values.set(key, stored)
      writes.push({ key, value: stored })
      if (successfulWritesBeforeFailure != null) successfulWritesBeforeFailure -= 1
    },
    async delete(key) { values.delete(key) },
    rejectWrites(value = true) {
      rejectWrites = value
      if (!value) successfulWritesBeforeFailure = null
    },
    failAfterSuccessfulWrites(count) {
      rejectWrites = false
      successfulWritesBeforeFailure = Math.max(0, Number(count) || 0)
    },
    resetWrites() { writes.length = 0 },
    writes() { return [...writes] },
    keys() { return [...values.keys()].sort() },
    rawValue(key) { return values.get(key) },
    snapshot() { return structuredClone([...values.entries()]) }
  }
}

function createExclusiveLockManager() {
  const queues = new Map()
  const calls = []
  return {
    request(name, options, callback) {
      calls.push({ name, options })
      const previous = queues.get(name) || Promise.resolve()
      const current = previous.catch(() => {}).then(callback)
      queues.set(name, current)
      return current.finally(() => {
        if (queues.get(name) === current) queues.delete(name)
      })
    },
    calls() { return [...calls] }
  }
}

function twoSourceFixture() {
  const first = sourceFixture()[0]
  const second = {
    ...sourceFixture()[0],
    id: 'source-mqtt-line',
    name: '二号线 MQTT',
    protocol: 'MQTT',
    config: { brokerUrl: 'mqtt://broker.example:1883', topic: 'line/2' },
    points: sourceFixture()[0].points.map(point => ({
      ...point,
      id: 'mqtt.line.temperature',
      name: '二号线温度',
      value: 26
    }))
  }
  return [first, second]
}

test('strips URL userinfo, query credentials and fragments while retaining safe endpoint data', async () => {
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const originalUrl = 'https://reader:userinfo-secret@gateway.example:8443/api/realtime?site=line1&token=token-secret&format=json&auth=auth-secret&signature=signature-secret#fragment-secret'
  const originalBrokerUrl = 'mqtt://device:broker-userinfo-secret@broker.example:1883/factory/line?site=line1&signature=broker-signature-secret#broker-fragment-secret'
  await store.save('url-security-workspace', [{
    id: 'source-url-security',
    name: 'URL security source',
    protocol: 'HTTP',
    config: {
      url: originalUrl,
      brokerUrl: originalBrokerUrl,
      method: 'GET'
    },
    points: []
  }])

  const persisted = storage.serialized()
  assert.doesNotMatch(persisted, /token-secret|auth-secret|signature-secret|userinfo-secret|fragment-secret/)

  // 当前页面切换工作空间后仍使用内存中的完整凭据，不强迫用户重新输入。
  await store.save('another-workspace', [])
  const [samePageSource] = await store.load('url-security-workspace')
  assert.equal(samePageSource.config.url, originalUrl)
  assert.equal(samePageSource.config.brokerUrl, originalBrokerUrl)

  // 模拟刷新：新 store 只能恢复允许持久化的安全路由参数。
  const reloadedStore = createWorkspacePointSourceStore({ storage })
  const [reloadedSource] = await reloadedStore.load('url-security-workspace')
  assert.equal(reloadedSource.config.url, 'https://gateway.example:8443/api/realtime?site=line1&format=json')
  assert.equal(reloadedSource.config.brokerUrl, 'mqtt://broker.example:1883/factory/line?site=line1')
  assert.equal(reloadedSource.config.method, 'GET')
})

test('keeps nested credentials, subscription payloads and complete responses memory-only', async () => {
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const config = {
    subprotocol: 'tc2d-runtime-v1,subprotocol-token-secret',
    subscribeMessage: '{"action":"subscribe","token":"subscription-token-secret","site":"line1"}',
    body: '{"deviceId":"line1","token":"request-body-token-secret"}',
    mapping: {
      site: 'line1',
      credentials: {
        token: 'object-token-secret',
        auth: 'object-auth-secret',
        signature: 'object-signature-secret'
      }
    },
    requestOptions: '{"route":{"site":"line1"},"headers":{"Authorization":"Bearer json-authorization-secret"},"password":"json-password-secret"}',
    safeJson: '{"site":"line1","format":"json"}'
  }
  const lastResponse = {
    ok: true,
    at: '2026-08-01T01:02:03.000Z',
    durationMs: 12,
    message: 'HTTP 200 response-message-secret',
    preview: '{"token":"response-preview-secret"}'
  }
  await store.save('nested-security-workspace', [{
    id: 'source-nested-security',
    name: 'Nested security source',
    protocol: 'WebSocket',
    enabled: true,
    status: 'online',
    config,
    lastResponse,
    points: []
  }])

  const persisted = storage.serialized()
  assert.doesNotMatch(persisted, /subprotocol-token-secret|subscription-token-secret|request-body-token-secret|object-token-secret|object-auth-secret|object-signature-secret|json-authorization-secret|json-password-secret|response-message-secret|response-preview-secret/)

  await store.save('another-nested-workspace', [])
  const [samePageSource] = await store.load('nested-security-workspace')
  assert.deepEqual(samePageSource.config, config)
  assert.deepEqual(samePageSource.lastResponse, lastResponse)

  const [reloadedSource] = await createWorkspacePointSourceStore({ storage }).load('nested-security-workspace')
  assert.equal(Object.hasOwn(reloadedSource.config, 'subprotocol'), false)
  assert.equal(Object.hasOwn(reloadedSource.config, 'subscribeMessage'), false)
  assert.deepEqual(JSON.parse(reloadedSource.config.body), { deviceId: 'line1' })
  assert.deepEqual(reloadedSource.config.mapping, { site: 'line1' })
  assert.deepEqual(JSON.parse(reloadedSource.config.requestOptions), { route: { site: 'line1' } })
  assert.equal(reloadedSource.config.safeJson, config.safeJson)
  assert.deepEqual(reloadedSource.lastResponse, {
    ok: true,
    at: lastResponse.at,
    durationMs: 12,
    message: '',
    preview: ''
  })
})

function sourceFixture() {
  return [{
    id: 'source-http-line',
    name: '产线接口',
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: {
      url: 'https://reader:embedded-password@gateway.example/realtime?token=query-secret',
      method: 'GET',
      pollInterval: 1000,
      headers: '{"Authorization":"Bearer header-secret"}',
      dataPath: '$.data'
    },
    lastResponse: {
      ok: true,
      at: '2026-07-31T00:00:00.000Z',
      durationMs: 8,
      message: 'HTTP 200',
      preview: '{"secret":"response-secret"}'
    },
    points: [{
      id: 'http.line.speed',
      name: '产线速度',
      group: '一号线',
      type: 'number',
      value: 88,
      status: 'good',
      updatedAt: '2026-07-31T00:00:00.000Z'
    }]
  }]
}

test('uses bounded structured-clone chunks for the default IndexedDB path', async () => {
  const driver = createStructuredPointSourceDriver()
  const legacyStorage = createControlledStorage()
  const pointCount = 20_000
  const points = Array.from({ length: pointCount }, (_, index) => ({
    id: `idb.large.${index}`,
    name: `点位 ${index}`,
    type: 'number',
    value: index,
    status: 'good'
  }))
  let yields = 0
  const store = createWorkspacePointSourceStore({
    indexedDbDriver: driver,
    legacyStorage,
    pointChunkMaxItems: 128,
    operationsPerYield: 3,
    yieldControl: async () => { yields += 1 }
  })
  const source = {
    id: 'source-idb-large',
    name: 'IndexedDB 大目录',
    protocol: 'HTTP',
    config: { url: 'https://gateway.example/realtime', method: 'GET' },
    points
  }

  const originalStringify = JSON.stringify
  let stringifyCalls = 0
  JSON.stringify = (...args) => {
    stringifyCalls += 1
    return originalStringify(...args)
  }
  let saved
  try {
    saved = await store.save('idb-large-workspace', [source])
  } finally {
    JSON.stringify = originalStringify
  }

  assert.equal(saved.durable, true)
  assert.equal(stringifyCalls, 0, '默认点位持久层不得把大目录编码为 JSON 文本')
  assert.equal(legacyStorage.writes().length, 0, '默认路径不得回写 localStorage')
  const pointWrites = driver.writes().filter(write => write.key.includes(':idb-points:'))
  const manifestWrite = driver.writes().find(write => !write.key.includes(':idb-points:'))
  assert.ok(pointWrites.length > 1)
  assert.ok(pointWrites.every(write => Array.isArray(write.value.points) && write.value.points.length <= 128))
  assert.equal(pointWrites.reduce((total, write) => total + write.value.points.length, 0), pointCount)
  assert.equal(Object.hasOwn(manifestWrite.value.sources[0], 'points'), false)
  assert.equal(manifestWrite.value.sources[0].pointChunkKeys.length, pointWrites.length)
  assert.equal(manifestWrite.value.sources[0].pointChunkMaxItems, 128)
  assert.ok(yields >= Math.floor(pointWrites.length / 3))

  driver.resetWrites()
  const metadataSave = await store.saveSource(
    'idb-large-workspace',
    { ...source, name: '只改连接名称' },
    { pointsChanged: false }
  )
  assert.equal(metadataSave.durable, true)
  assert.equal(driver.writes().length, 1)
  assert.doesNotMatch(driver.writes()[0].key, /:idb-points:/)

  const reloaded = await createWorkspacePointSourceStore({
    indexedDbDriver: driver,
    legacyStorage,
    pointChunkMaxItems: 64,
    yieldControl: async () => {}
  }).load('idb-large-workspace')
  assert.equal(reloaded[0].name, '只改连接名称')
  assert.equal(reloaded[0].points.length, pointCount)
  assert.equal(reloaded[0].points.at(-1).id, `idb.large.${pointCount - 1}`)
  assert.equal(Object.hasOwn(reloaded[0], 'pointChunkMaxItems'), false)
})

test('keeps legacy IndexedDB manifests readable after the configured chunk size changes', async () => {
  const workspaceId = 'idb-legacy-chunk-size'
  const manifestKey = `tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`
  const driver = createStructuredPointSourceDriver()
  const points = Array.from({ length: 257 }, (_, index) => ({ id: `legacy.chunk.${index}`, value: index }))
  await createWorkspacePointSourceStore({
    indexedDbDriver: driver,
    legacyStorage: null,
    yieldControl: async () => {}
  }).save(workspaceId, [{ id: 'legacy-chunk-source', name: '旧清单', protocol: 'HTTP', config: {}, points }])

  delete driver.rawValue(manifestKey).sources[0].pointChunkMaxItems
  const [reloaded] = await createWorkspacePointSourceStore({
    indexedDbDriver: driver,
    legacyStorage: null,
    pointChunkMaxItems: 64,
    yieldControl: async () => {}
  }).load(workspaceId)

  assert.equal(reloaded.points.length, points.length)
  assert.equal(reloaded.points.at(-1).id, points.at(-1).id)
})

test('uses unique point revisions across store instances created in the same millisecond', async () => {
  const driver = createStructuredPointSourceDriver()
  const originalNow = Date.now
  Date.now = () => 1_787_000_000_000
  try {
    const firstStore = createWorkspacePointSourceStore({ indexedDbDriver: driver, legacyStorage: null, yieldControl: async () => {} })
    const secondStore = createWorkspacePointSourceStore({ indexedDbDriver: driver, legacyStorage: null, yieldControl: async () => {} })
    const source = value => [{
      id: 'shared-source',
      name: `并发版本 ${value}`,
      protocol: 'HTTP',
      config: {},
      points: [{ id: 'shared.point', value }]
    }]
    await Promise.all([
      firstStore.save('shared-revision-workspace', source(1)),
      secondStore.save('shared-revision-workspace', source(2))
    ])
  } finally {
    Date.now = originalNow
  }

  const pointWriteKeys = driver.writes()
    .filter(write => write.key.includes(':idb-points:'))
    .map(write => write.key)
  assert.equal(pointWriteKeys.length, 2)
  assert.equal(new Set(pointWriteKeys).size, 2)
})

test('refreshes the durable manifest inside the cross-page lock before reusing point chunks', async () => {
  const workspaceId = 'cross-page-manifest-refresh'
  const driver = createStructuredPointSourceDriver()
  const lockManager = createExclusiveLockManager()
  const options = {
    indexedDbDriver: driver,
    legacyStorage: null,
    lockManager,
    yieldControl: async () => {}
  }
  const initial = {
    id: 'cross-page-source',
    name: '初始连接',
    protocol: 'HTTP',
    config: {},
    points: [{ id: 'cross.page.point', value: 1 }]
  }
  await createWorkspacePointSourceStore(options).save(workspaceId, [initial])

  const firstPage = createWorkspacePointSourceStore(options)
  const secondPage = createWorkspacePointSourceStore(options)
  const [firstPageStaleSource] = await firstPage.load(workspaceId)
  const [secondPageSource] = await secondPage.load(workspaceId)
  await secondPage.saveSource(
    workspaceId,
    { ...secondPageSource, points: [{ ...secondPageSource.points[0], value: 2 }] },
    { pointsChanged: true }
  )

  const metadataSave = await firstPage.saveSource(
    workspaceId,
    { ...firstPageStaleSource, name: '第一页元数据修改' },
    { pointsChanged: false }
  )
  assert.equal(metadataSave.durable, true)
  const [afterMetadataSave] = await createWorkspacePointSourceStore(options).load(workspaceId)
  assert.equal(afterMetadataSave.name, '第一页元数据修改')
  assert.equal(afterMetadataSave.points[0].value, 2, '元数据保存必须复用锁内刷新的 durable 点位分片')

  const staleReader = createWorkspacePointSourceStore(options)
  assert.equal((await staleReader.load(workspaceId))[0].points[0].value, 2)
  await secondPage.saveSource(
    workspaceId,
    { ...secondPageSource, name: '第二页新版本', points: [{ ...secondPageSource.points[0], value: 3 }] },
    { pointsChanged: true }
  )
  assert.equal((await staleReader.load(workspaceId))[0].points[0].value, 3)

  assert.ok(lockManager.calls().length >= 9)
  assert.ok(lockManager.calls().every(call => (
    call.name === `tc2d-point-sources:${encodeURIComponent(workspaceId)}`
    && call.options?.mode === 'exclusive'
  )))
})

test('default IndexedDB cooperative yield never waits for the next animation frame', () => {
  const functionStart = pointSourceStoreSource.indexOf('function defaultPointSourceYield()')
  const functionEnd = pointSourceStoreSource.indexOf('\n}\n', functionStart)
  const implementation = pointSourceStoreSource.slice(functionStart, functionEnd)
  assert.match(implementation, /scheduler\?\.yield/)
  assert.doesNotMatch(implementation, /requestAnimationFrame/)
})

test('migrates default-store localStorage v1 and v2 snapshots only after IndexedDB commit', async t => {
  await t.test('v1 snapshot', async () => {
    const workspaceId = 'default-idb-v1-migration'
    const manifestKey = `tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`
    const legacyStorage = createControlledStorage()
    legacyStorage.setRaw(manifestKey, JSON.stringify({
      version: 1,
      workspaceId,
      sources: sourceFixture()
    }))
    const driver = createStructuredPointSourceDriver()
    const store = createWorkspacePointSourceStore({
      indexedDbDriver: driver,
      legacyStorage,
      yieldControl: async () => {}
    })

    const loaded = await store.load(workspaceId)
    assert.equal(loaded[0].id, 'source-http-line')
    assert.equal(legacyStorage.rawValue(manifestKey), null)
    assert.equal(driver.rawValue(manifestKey).version, 2)
    assert.ok(driver.rawValue(manifestKey).sources[0].pointChunkKeys.length > 0)
  })

  await t.test('v2 sharded snapshot', async () => {
    const workspaceId = 'default-idb-v2-migration'
    const legacyStorage = createControlledStorage()
    await createWorkspacePointSourceStore({ storage: legacyStorage }).save(workspaceId, sourceFixture())
    const legacyKeys = legacyStorage.keys()
    const driver = createStructuredPointSourceDriver()
    const store = createWorkspacePointSourceStore({
      indexedDbDriver: driver,
      legacyStorage,
      yieldControl: async () => {}
    })

    const loaded = await store.load(workspaceId)
    assert.equal(loaded[0].points[0].id, 'http.line.speed')
    assert.ok(legacyKeys.every(key => legacyStorage.rawValue(key) === null))
    const manifest = driver.rawValue(`tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`)
    assert.equal(manifest.version, 2)
    assert.equal(Object.hasOwn(manifest.sources[0], 'pointShardKey'), false)
  })
})

test('keeps the previous IndexedDB manifest recoverable when a new revision cannot publish', async () => {
  const workspaceId = 'idb-atomic-failure'
  const driver = createStructuredPointSourceDriver()
  const options = {
    indexedDbDriver: driver,
    legacyStorage: null,
    pointChunkMaxItems: 100,
    yieldControl: async () => {}
  }
  const store = createWorkspacePointSourceStore(options)
  const oldSource = {
    id: 'source-atomic',
    name: '旧版本',
    protocol: 'HTTP',
    config: {},
    points: Array.from({ length: 350 }, (_, index) => ({ id: `atomic.${index}`, value: index }))
  }
  assert.equal((await store.save(workspaceId, [oldSource])).durable, true)
  const committedSnapshot = driver.snapshot()

  const nextSource = {
    ...oldSource,
    name: '当前页新版本',
    points: oldSource.points.map(point => ({ ...point, value: point.value + 1 }))
  }
  driver.failAfterSuccessfulWrites(4)
  const failed = await store.save(workspaceId, [nextSource])
  assert.equal(failed.durable, false)
  assert.equal((await store.load(workspaceId))[0].name, '当前页新版本')
  assert.deepEqual(driver.snapshot(), committedSnapshot, '发布清单失败后不得替换旧版本或遗留新分片')

  driver.rejectWrites(false)
  const reloaded = await createWorkspacePointSourceStore(options).load(workspaceId)
  assert.equal(reloaded[0].name, '旧版本')
  assert.equal(reloaded[0].points[0].value, 0)

  const oldPointKeys = committedSnapshot.map(([key]) => key).filter(key => key.includes(':idb-points:'))
  const recoveredSource = { ...nextSource, name: '恢复后版本' }
  const recovered = await store.save(workspaceId, [recoveredSource])
  assert.equal(recovered.durable, true)
  assert.ok(oldPointKeys.every(key => !driver.keys().includes(key)), '恢复发布后必须回收最后一份 durable revision')
  assert.equal((await createWorkspacePointSourceStore(options).load(workspaceId))[0].name, '恢复后版本')
})

test('falls back to an authoritative memory snapshot when IndexedDB is unavailable', async () => {
  const store = createWorkspacePointSourceStore({
    indexedDB: null,
    legacyStorage: null,
    yieldControl: async () => {}
  })
  const source = {
    id: 'source-memory-only',
    name: '仅当前页',
    protocol: 'HTTP',
    config: {},
    points: [{ id: 'memory.point', value: 7 }]
  }

  const result = await store.save('idb-unavailable', [source])
  assert.equal(result.durable, false)
  assert.equal(result.mode, 'memory')
  assert.equal((await store.load('idb-unavailable'))[0].points[0].value, 7)
  assert.deepEqual(store.getPersistenceStatus('idb-unavailable'), result)
})

test('rejects IndexedDB manifests that escape workspace or chunk ownership boundaries', async t => {
  async function corruptManifest(mutator) {
    const workspaceId = 'idb-isolation-workspace'
    const manifestKey = `tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`
    const driver = createStructuredPointSourceDriver()
    const options = {
      indexedDbDriver: driver,
      legacyStorage: null,
      pointChunkMaxItems: 1,
      yieldControl: async () => {}
    }
    await createWorkspacePointSourceStore(options).save(workspaceId, [{
      id: 'source-owned',
      name: '隔离测试',
      protocol: 'HTTP',
      config: {},
      points: [{ id: 'owned.1', value: 1 }, { id: 'owned.2', value: 2 }]
    }])
    mutator(driver.rawValue(manifestKey), { workspaceId, manifestKey })
    await assert.rejects(
      createWorkspacePointSourceStore(options).load(workspaceId),
      error => error?.code === 'POINT_SOURCE_STORAGE_CORRUPT' && error?.workspaceId === workspaceId
    )
  }

  await t.test('workspace id mismatch', () => corruptManifest(manifest => {
    manifest.workspaceId = 'another-workspace'
  }))
  await t.test('cross-workspace chunk key', () => corruptManifest(manifest => {
    manifest.sources[0].pointChunkKeys[0] = 'tc2d-point-sources:v1:another-workspace:idb-points:source-owned:revision:0'
  }))
  await t.test('duplicate chunk key', () => corruptManifest(manifest => {
    manifest.sources[0].pointChunkKeys[1] = manifest.sources[0].pointChunkKeys[0]
  }))
  await t.test('chunk count exceeds the bounded point count', () => corruptManifest(manifest => {
    manifest.sources[0].pointCount = 1
  }))
})

test('fails closed without deleting a v2 manifest when one point shard is missing', async () => {
  const workspaceId = 'missing-shard-workspace'
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, twoSourceFixture())

  const manifestKey = storage.keys().find(key => !key.includes(':points:'))
  const manifestValue = storage.rawValue(manifestKey)
  const manifest = JSON.parse(manifestValue)
  const missingEntry = manifest.sources.find(source => source.id === 'source-mqtt-line')
  const validEntry = manifest.sources.find(source => source.id === 'source-http-line')
  const validShardValue = storage.rawValue(validEntry.pointShardKey)
  storage.deleteRaw(missingEntry.pointShardKey)
  storage.resetWrites()

  await assert.rejects(
    store.load(workspaceId),
    error => {
      assert.equal(error?.code, 'POINT_SOURCE_STORAGE_CORRUPT')
      assert.equal(error?.workspaceId, workspaceId)
      assert.deepEqual(error?.invalidSourceIds, ['source-mqtt-line'])
      assert.deepEqual(error?.validSources.map(source => source.id), ['source-http-line'])
      assert.equal(error?.validSources[0].points[0].id, 'http.line.speed')
      assert.match(error?.validSources[0].config.headers, /header-secret/)
      assert.match(error?.validSources[0].lastResponse.preview, /response-secret/)
      return true
    }
  )

  assert.equal(storage.rawValue(manifestKey), manifestValue, '损坏读取不得删除或重写主清单')
  assert.equal(storage.rawValue(validEntry.pointShardKey), validShardValue, '有效分片必须原样保留')
  assert.equal(storage.rawValue(missingEntry.pointShardKey), null)
  assert.deepEqual(storage.writes(), [], '损坏读取不得写入默认数据源或修复快照')
})

test('reports all readable sources while preserving a malformed v2 point shard', async () => {
  const workspaceId = 'malformed-shard-workspace'
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, twoSourceFixture())

  const manifestKey = storage.keys().find(key => !key.includes(':points:'))
  const manifestValue = storage.rawValue(manifestKey)
  const manifest = JSON.parse(manifestValue)
  const brokenEntry = manifest.sources.find(source => source.id === 'source-http-line')
  const malformedShard = '{"version":999,"sourceId":"source-http-line","points":[]}'
  storage.setRaw(brokenEntry.pointShardKey, malformedShard)
  storage.resetWrites()

  await assert.rejects(
    store.load(workspaceId),
    error => {
      assert.equal(error?.code, 'POINT_SOURCE_STORAGE_CORRUPT')
      assert.deepEqual(error?.invalidSourceIds, ['source-http-line'])
      assert.deepEqual(error?.validSources.map(source => source.id), ['source-mqtt-line'])
      assert.equal(error?.validSources[0].points[0].id, 'mqtt.line.temperature')
      return true
    }
  )

  assert.equal(storage.rawValue(manifestKey), manifestValue)
  assert.equal(storage.rawValue(brokenEntry.pointShardKey), malformedShard, '损坏分片必须保留以便恢复')
  assert.deepEqual(storage.writes(), [])
})

test('preserves an unreadable point-source manifest and exposes a recognizable error', async () => {
  const workspaceId = 'malformed-manifest-workspace'
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, sourceFixture())

  const manifestKey = storage.keys().find(key => !key.includes(':points:'))
  const malformedManifest = '{"version":2,"sources":'
  storage.setRaw(manifestKey, malformedManifest)
  storage.resetWrites()

  await assert.rejects(
    store.load(workspaceId),
    error => {
      assert.equal(error?.code, 'POINT_SOURCE_STORAGE_CORRUPT')
      assert.equal(error?.workspaceId, workspaceId)
      assert.deepEqual(error?.validSources, [])
      assert.deepEqual(error?.invalidSourceIds, [])
      return true
    }
  )

  assert.equal(storage.rawValue(manifestKey), malformedManifest)
  assert.deepEqual(storage.writes(), [])
})

test('migrates a valid v1 point-source snapshot to the sharded v2 format', async () => {
  const workspaceId = 'legacy-migration-workspace'
  const manifestKey = `tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`
  const storage = createControlledStorage()
  const legacySnapshot = JSON.stringify({
    version: 1,
    workspaceId,
    sources: sourceFixture()
  })
  storage.setRaw(manifestKey, legacySnapshot)
  storage.resetWrites()

  const [loaded] = await createWorkspacePointSourceStore({ storage }).load(workspaceId)
  const migratedManifest = JSON.parse(storage.rawValue(manifestKey))
  assert.equal(loaded.id, 'source-http-line')
  assert.match(loaded.config.headers, /header-secret/)
  assert.equal(migratedManifest.version, 2)
  assert.equal(migratedManifest.sources[0].id, 'source-http-line')
  assert.ok(migratedManifest.sources[0].pointShardKey)
  assert.ok(storage.rawValue(migratedManifest.sources[0].pointShardKey))
})

test('preserves a corrupt v1 snapshot and refuses to seed default sources', async () => {
  const workspaceId = 'corrupt-legacy-workspace'
  const manifestKey = `tc2d-point-sources:v1:${encodeURIComponent(workspaceId)}`
  const storage = createControlledStorage()
  const corruptLegacySnapshot = JSON.stringify({
    version: 1,
    workspaceId,
    sources: [null]
  })
  storage.setRaw(manifestKey, corruptLegacySnapshot)
  storage.resetWrites()
  const store = createWorkspacePointSourceStore({ storage })
  const gateway = createLocalPointCatalogGateway({ store, sources: sourceFixture })

  await assert.rejects(
    gateway.activateWorkspace(workspaceId),
    error => {
      assert.equal(error?.code, 'POINT_SOURCE_STORAGE_CORRUPT')
      assert.equal(error?.workspaceId, workspaceId)
      assert.deepEqual(error?.validSources, [])
      return true
    }
  )

  assert.equal(storage.rawValue(manifestKey), corruptLegacySnapshot)
  assert.deepEqual(storage.writes(), [], '迁移失败不得写入默认目录或替换旧快照')
  assert.deepEqual(await gateway.listSources(), [], '隔离状态不得继续暴露默认数据源')
})

test('persists point sources per workspace while keeping credentials memory-only', async () => {
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const gateway = createLocalPointCatalogGateway({ store, sources: sourceFixture })

  await gateway.activateWorkspace('workspace-a')
  await gateway.updateSource('source-http-line', {
    name: 'A 工作空间接口',
    config: { headers: '{"Authorization":"Bearer workspace-a-token"}' }
  })
  await gateway.activateWorkspace('workspace-b')
  assert.equal((await gateway.getSource('source-http-line')).name, '产线接口')
  await gateway.updateSource('source-http-line', { name: 'B 工作空间接口' })

  await gateway.activateWorkspace('workspace-a')
  const samePageSource = await gateway.getSource('source-http-line')
  assert.equal(samePageSource.name, 'A 工作空间接口')
  assert.match(samePageSource.config.headers, /workspace-a-token/)

  const persisted = storage.serialized()
  assert.doesNotMatch(persisted, /embedded-password|query-secret|workspace-a-token|header-secret|response-secret/)

  // 模拟刷新：非敏感配置保留，凭据和响应正文不从持久层恢复。
  const reloadedGateway = createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage }),
    sources: sourceFixture
  })
  await reloadedGateway.activateWorkspace('workspace-a')
  const reloadedSource = await reloadedGateway.getSource('source-http-line')
  assert.equal(reloadedSource.name, 'A 工作空间接口')
  assert.equal(reloadedSource.config.headers, '{}')
  assert.equal(reloadedSource.lastResponse.preview, '')
  assert.doesNotMatch(reloadedSource.config.url, /embedded-password|query-secret/)
})

test('rebuilds the same code-defined sample snapshot after a page reload', async () => {
  const workspaceId = 'stable-sample-workspace'
  const storage = createMemoryStorage()
  const createGateway = () => createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage }),
    sources: sourceFixture
  })

  const firstGateway = createGateway()
  await firstGateway.activateWorkspace(workspaceId)
  const firstSnapshot = await firstGateway.getSourceSnapshot('source-http-line')
  assert.deepEqual(firstSnapshot.data, { secret: 'response-secret' })
  assert.doesNotMatch(storage.serialized(), /response-secret/)

  // 模拟刷新：新网关只能从代码定义恢复样例，不能依赖已脱敏的响应正文。
  const reloadedGateway = createGateway()
  await reloadedGateway.activateWorkspace(workspaceId)
  const reloadedSnapshot = await reloadedGateway.getSourceSnapshot('source-http-line')
  assert.deepEqual(reloadedSnapshot.data, firstSnapshot.data)
  assert.doesNotMatch(storage.serialized(), /response-secret/)
})

test('persists a newly created source after durable workspace activation', async () => {
  const workspaceId = 'new-source-workspace'
  const storage = createMemoryStorage()
  const gateway = createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage }),
    sources: sourceFixture
  })
  await gateway.activateWorkspace(workspaceId)

  const created = await gateway.createSource({ name: '新建 HTTP 连接', protocol: 'HTTP' })
  assert.equal(created.persistence.durable, true)

  const reloadedGateway = createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage }),
    sources: []
  })
  await reloadedGateway.activateWorkspace(workspaceId)
  const reloaded = await reloadedGateway.getSource(created.id)

  assert.equal(reloaded.name, '新建 HTTP 连接')
  assert.equal(reloaded.protocol, 'HTTP')
  assert.deepEqual(reloaded.points, [])
})

test('keeps the newest memory snapshot authoritative after a quota failure without claiming durability', async () => {
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const oldSources = sourceFixture()
  const firstSave = await store.save('quota-workspace', oldSources)
  assert.equal(firstSave.durable, true)

  storage.rejectWrites()
  const newSources = sourceFixture()
  newSources[0].name = '仅内存的新名称'
  const secondSave = await store.save('quota-workspace', newSources)
  assert.equal(secondSave.durable, false)
  assert.equal(secondSave.mode, 'memory')
  assert.equal((await store.load('quota-workspace'))[0].name, '仅内存的新名称')
  assert.deepEqual(store.getPersistenceStatus('quota-workspace'), secondSave)

  // 刷新页面会创建新的 store，只能看到最后一次真实写入持久层的旧快照。
  const reloadedStore = createWorkspacePointSourceStore({ storage })
  assert.equal((await reloadedStore.load('quota-workspace'))[0].name, '产线接口')
})

test('retries an in-memory point shard before a recovered metadata write can become durable', async () => {
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  assert.equal((await store.save('quota-recovery-workspace', sourceFixture())).durable, true)

  storage.rejectWrites()
  const memorySources = sourceFixture()
  memorySources[0].name = '配额期间名称'
  memorySources[0].points[0].value = 99
  assert.equal((await store.save('quota-recovery-workspace', memorySources)).durable, false)

  storage.rejectWrites(false)
  storage.resetWrites()
  const recovered = await store.saveSource(
    'quota-recovery-workspace',
    { ...memorySources[0], name: '恢复后名称' },
    { pointsChanged: false }
  )
  assert.equal(recovered.durable, true)
  assert.ok(storage.writes().some(write => /:points:/.test(write.key)), '内存分片必须先补写到持久层')

  const [reloaded] = await createWorkspacePointSourceStore({ storage }).load('quota-recovery-workspace')
  assert.equal(reloaded.name, '恢复后名称')
  assert.equal(reloaded.points[0].value, 99)
})

test('rolls back newly written point shards when a later shard cannot be committed', async () => {
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const first = sourceFixture()[0]
  const second = {
    ...sourceFixture()[0],
    id: 'source-http-line-2',
    name: '二号产线接口',
    points: sourceFixture()[0].points.map(point => ({ ...point, id: `${point.id}.second` }))
  }
  assert.equal((await store.save('partial-quota-workspace', [first, second])).durable, true)
  const committedKeys = storage.keys()

  const nextFirst = { ...first, name: '内存一号', points: first.points.map(point => ({ ...point, value: 101 })) }
  const nextSecond = { ...second, name: '内存二号', points: second.points.map(point => ({ ...point, value: 202 })) }
  storage.failAfterSuccessfulWrites(1)
  const failed = await store.save('partial-quota-workspace', [nextFirst, nextSecond])

  assert.equal(failed.durable, false)
  assert.deepEqual(storage.keys(), committedKeys, '未提交 revision 不得残留在持久层占用配额')
  const samePage = await store.load('partial-quota-workspace')
  assert.deepEqual(samePage.map(source => source.name), ['内存一号', '内存二号'])
  assert.deepEqual(samePage.map(source => source.points[0].value), [101, 202])

  const reloaded = await createWorkspacePointSourceStore({ storage }).load('partial-quota-workspace')
  assert.deepEqual(reloaded.map(source => source.name), ['产线接口', '二号产线接口'])
  assert.deepEqual(reloaded.map(source => source.points[0].value), [88, 88])
})

test('reports memory-only gateway mutations while retaining them for the current page', async () => {
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const gateway = createLocalPointCatalogGateway({ store, sources: sourceFixture })
  await gateway.activateWorkspace('gateway-quota-workspace')
  storage.rejectWrites()

  const updated = await gateway.updateSource('source-http-line', { name: '当前页名称' }, { includePoints: false })
  assert.equal(updated.name, '当前页名称')
  assert.equal(updated.persistence.durable, false)
  assert.equal(updated.persistence.mode, 'memory')
  assert.equal((await gateway.getSource('source-http-line')).name, '当前页名称')

  const created = await gateway.createSource({ name: '当前页新连接', protocol: 'MQTT' })
  assert.equal(created.persistence.durable, false)
  assert.equal((await gateway.getSource(created.id)).name, '当前页新连接')

  const tested = await gateway.testSource('source-http-line')
  assert.equal(tested.ok, true)
  assert.equal(tested.persistence.durable, false)
  assert.equal(gateway.getPersistenceStatus().durable, false)

  await gateway.refresh()
  assert.equal((await gateway.getSource('source-http-line')).name, '当前页名称')
  assert.equal((await gateway.getSource(created.id)).name, '当前页新连接')

  const removed = await gateway.removeSource('source-http-line')
  assert.equal(removed.removed, true)
  assert.equal(removed.persistence.durable, false)
  assert.equal(await gateway.getSource('source-http-line'), null)
  await gateway.refresh()
  assert.equal(await gateway.getSource('source-http-line'), null)

  const reloadedGateway = createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage }),
    sources: sourceFixture
  })
  const reloaded = await reloadedGateway.activateWorkspace('gateway-quota-workspace')
  assert.equal(reloaded.persistence.durable, true)
  assert.equal((await reloadedGateway.getSource('source-http-line')).name, '产线接口')
})

test('persists metadata separately and reuses a large point shard for connection-only edits', async () => {
  const storage = createControlledStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const updatedAt = '2026-08-01T00:00:00.000Z'
  const pointCount = 50_000
  const largeSource = {
    ...sourceFixture()[0],
    points: Array.from({ length: pointCount }, (_, index) => ({
      id: `large.point.${index}`,
      name: `点位 ${index}`,
      group: '性能边界',
      type: 'number',
      value: index,
      status: 'good',
      updatedAt
    }))
  }
  assert.equal((await store.save('large-catalog-workspace', [largeSource])).durable, true)
  storage.resetWrites()

  const startedAt = performance.now()
  const result = await store.saveSource(
    'large-catalog-workspace',
    { ...largeSource, name: '五万点连接已改名' },
    { pointsChanged: false }
  )
  const elapsedMs = performance.now() - startedAt
  const writes = storage.writes()

  assert.equal(result.durable, true)
  assert.equal(writes.length, 1, '纯连接配置修改只应提交小型清单')
  assert.doesNotMatch(writes[0].key, /:points:/)
  assert.doesNotMatch(writes[0].value, /large\.point\.49999/)
  assert.ok(writes[0].value.length < 10_000, `metadata manifest unexpectedly contains ${writes[0].value.length} bytes`)
  assert.ok(elapsedMs < 80, `metadata-only persistence took ${elapsedMs.toFixed(1)}ms`)

  const reloaded = await createWorkspacePointSourceStore({ storage }).load('large-catalog-workspace')
  assert.equal(reloaded[0].name, '五万点连接已改名')
  assert.equal(reloaded[0].points.length, pointCount)
  assert.equal(reloaded[0].points.at(-1).id, 'large.point.49999')
})

test('gateway metadata edits avoid full-catalog persistence and cloning at the 50k point boundary', async () => {
  const updatedAt = '2026-08-01T00:00:00.000Z'
  const points = Array.from({ length: 50_000 }, (_, index) => ({
    id: `gateway.large.${index}`,
    name: `点位 ${index}`,
    group: '性能边界',
    type: 'number',
    value: index,
    status: 'good',
    updatedAt
  }))
  let fullSaveCalls = 0
  let sourceSaveCalls = 0
  const savedSources = []
  const savedOptions = []
  const store = {
    async save() {
      fullSaveCalls += 1
      return { durable: true, mode: 'durable', reason: '' }
    },
    async saveSource(workspaceId, source, options) {
      sourceSaveCalls += 1
      assert.equal(workspaceId, 'default')
      assert.equal(source.name, '快速改名')
      savedSources.push(source)
      savedOptions.push(options)
      return { durable: true, mode: 'durable', reason: '' }
    }
  }
  const gateway = createLocalPointCatalogGateway({
    store,
    sources: [{ ...sourceFixture()[0], points }]
  })

  const startedAt = performance.now()
  const updated = await gateway.updateSource('source-http-line', { name: '快速改名' }, { includePoints: false })
  const elapsedMs = performance.now() - startedAt

  assert.equal(updated.name, '快速改名')
  assert.equal(updated.pointCount, points.length)
  assert.equal(Object.hasOwn(updated, 'points'), false)
  assert.equal(updated.persistence.durable, true)
  assert.equal(sourceSaveCalls, 1)
  assert.equal(fullSaveCalls, 0)
  assert.equal(savedOptions[0].pointsChanged, false)
  assert.ok(elapsedMs < 80, `50k point metadata update took ${elapsedMs.toFixed(1)}ms`)

  const tested = await gateway.testSource('source-http-line', { includePoints: false })
  assert.equal(tested.ok, true)
  assert.equal(tested.source.pointCount, points.length)
  assert.equal(sourceSaveCalls, 2)
  assert.equal(fullSaveCalls, 0)
  assert.equal(savedOptions[1].pointsChanged, false)
  assert.strictEqual(savedSources[1].points, savedSources[0].points, '连接测试不得重建未变化的点位集合')
  assert.strictEqual(savedSources[1].points[0], savedSources[0].points[0], '连接测试不得重建未变化的点位对象')
})

test('normalizes hostile point values into JSON-safe data before persistence', async () => {
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const workspaceId = 'json-safe-point-values'
  const gateway = createLocalPointCatalogGateway({
    workspaceId,
    store,
    sources: [{
      id: 'source-json-safe',
      name: 'JSON 安全点位',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: [{ id: 'safe.initial', name: '初始值', value: 1, type: 'number', status: 'good' }]
    }]
  })
  await gateway.activateWorkspace(workspaceId)

  const cyclic = { label: '循环值' }
  cyclic.self = cyclic
  const updated = await gateway.updateSource('source-json-safe', {
    points: [
      { id: 'unsafe.cycle', name: '循环', value: cyclic, type: 'object', status: 'good' },
      { id: 'unsafe.bigint', name: '大整数', value: 123n, type: 'string', status: 'good' },
      { id: 'unsafe.function', name: '函数', value: () => true, type: 'string', status: 'good' },
      { id: 'unsafe.symbol', name: '符号', value: Symbol('signal'), type: 'string', status: 'good' },
      { id: 'unsafe.undefined', name: '空值', value: undefined, type: 'string', status: 'good' },
      { id: 'unsafe.infinity', name: '无穷', value: Number.POSITIVE_INFINITY, type: 'number', status: 'good' }
    ]
  })

  assert.equal(updated.persistence.durable, true)
  assert.doesNotThrow(() => JSON.stringify(updated.points))
  assert.equal(updated.points[0].value.self, '[Circular]')
  assert.equal(updated.points[1].value, '123')
  assert.equal(updated.points[2].value, '[Function]')
  assert.equal(updated.points[3].value, 'Symbol(signal)')
  assert.equal(updated.points[4].value, '[Undefined]')
  assert.equal(updated.points[5].value, 'Infinity')

  const reloadedGateway = createLocalPointCatalogGateway({
    workspaceId,
    store: createWorkspacePointSourceStore({ storage }),
    sources: []
  })
  await reloadedGateway.activateWorkspace(workspaceId)
  const reloaded = await reloadedGateway.getSource('source-json-safe')
  assert.deepEqual(reloaded.points.map(point => point.value), updated.points.map(point => point.value))
})

test('invalidates disabled, offline and removed points and republishes them only after revalidation', async () => {
  const gateway = createLocalPointCatalogGateway({
    store: createWorkspacePointSourceStore({ storage: createMemoryStorage() }),
    sources: sourceFixture
  })
  const events = []
  gateway.subscribe(event => events.push(event))
  await gateway.activateWorkspace('runtime-workspace')

  await gateway.updateSource('source-http-line', { enabled: false })
  assert.deepEqual(events.at(-1).invalidatedPointIds, ['http.line.speed'])
  assert.equal((await gateway.listPoints()).length, 0)
  assert.equal((await gateway.listPoints({ includeUnavailable: true })).length, 1)

  await gateway.updateSource('source-http-line', { enabled: true })
  assert.equal((await gateway.listPoints()).length, 0)
  assert.equal(events.at(-1).availablePointIds.includes('http.line.speed'), false)

  await gateway.testSource('source-http-line')
  assert.equal((await gateway.listPoints())[0].value, 88)
  assert.equal(events.at(-1).pointIdsOmitted, true)
  assert.deepEqual(events.at(-1).changedSourceIds, ['source-http-line'])

  await gateway.updateSource('source-http-line', { status: 'offline' })
  assert.deepEqual(events.at(-1).invalidatedPointIds, ['http.line.speed'])
  await gateway.updateSource('source-http-line', { status: 'online' })
  assert.equal((await gateway.listPoints())[0].value, 88)

  await gateway.removeSource('source-http-line')
  assert.deepEqual(events.at(-1).invalidatedPointIds, ['http.line.speed'])
  assert.equal((await gateway.listPoints()).length, 0)
})

test('App owns runtime snapshot delivery while the manager only tests connection lifecycle', () => {
  assert.match(appSource, /import \{ drawingRepository, operationGateway, pointCatalogGateway, runtimeGateway, timeService \} from '\.\/services\/backend'/)
  assert.match(appSource, /drawingPointSourceScopeId\(normalizedWorkspace, normalizedDrawingId\)/)
  assert.match(appSource, /await pointCatalogGateway\.activateWorkspace\(targetScopeId, \{[\s\S]*?legacyWorkspaceId:[\s\S]*?publishSnapshots: false/)
  assert.match(appSource, /await activateCurrentDrawingPointCatalog\(\{ inheritLegacyWorkspace: false \}\)/)
  assert.match(appSource, /invalidatedPointIds\.map\(key => \(\{ key, value: undefined \}\)\)/)
  assert.match(appSource, /pointCatalogGateway\.subscribeSnapshots\?\.\(snapshot => \{[\s\S]*?snapshot\?\.workspaceId !== activePointSourceScopeId\.value[\s\S]*?sourceBindingRuntime\.ingest\(snapshot\)[\s\S]*?\}, \{ shared: true \}\)/)
  assert.match(appSource, /const sourceSnapshotReplayCoordinator = createSourceSnapshotReplayCoordinator\([\s\S]*?getSourceSnapshot\?\.\(sourceId, \{ shared: true \}\)/)
  assert.match(appSource, /function replaySourceSnapshotsForNodes[\s\S]*?bindingSourceIds\(node\)[\s\S]*?sourceSnapshotReplayCoordinator\.replay\(sourceIds, \{ force \}\)/)
  assert.match(appSource, /const pointIds = requiredIds == null[\s\S]*?indexedLegacyPointIds\(\)[\s\S]*?getPointsByIds\(pointIds\)/)
  assert.match(appSource, /sourceBindingRuntime\.rebuildDeferred\(source\)/)
  assert.doesNotMatch(appSource, /replayPointCatalogValues\(runtimeDataKeysForNodes\(data\.nodes\)\)/)
  assert.doesNotMatch(appSource, /@changed="refreshPointCatalog"/)

  assert.equal(sourceProtocolShortName('MySQL'), 'MYSQL')
  assert.match(managerSource, /sourceProtocolShortName as protocolShortName/)
  assert.match(managerSource, /getSource\(id, \{ includePoints: false \}\)/)
  assert.match(managerSource, /gateway\.testSource\(sourceId, \{ includePoints: false \}\)/)
  assert.match(managerSource, /gateway\.testSourceDraft\(activeConnectionPayload\(\), \{ sharedSnapshot: true \}\)/)
  assert.doesNotMatch(managerSource, /sourceBindingRuntime|sourceSnapshotReplayCoordinator|replaySourceSnapshotsForNodes|runtimeGateway\.send/)
  assert.match(managerSource, /gateway\.removeSource\(source\.id\)/)
  assert.match(managerSource, /persistence\.durable/)
  assert.match(managerSource, /仅在当前页面生效，未持久保存/)
  assert.match(managerSource, /removed\.persistence/)
  assert.doesNotMatch(managerSource, /POINT_PAGE_SIZE|matchingPoints|visiblePointLimit|querySourcePoints|listPoints|<pre>/)
})
