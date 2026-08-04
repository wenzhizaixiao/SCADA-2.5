import assert from 'node:assert/strict'
import test from 'node:test'
import {
  POINT_SOURCE_PROTOCOLS,
  createLocalPointCatalogGateway
} from '../src/services/pointCatalogGateway.js'
import {
  MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS,
  MAX_RUNTIME_TABLE_CELL_DEPTH,
  MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS,
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS
} from '../src/models/dataBindingModel.js'

test('provides every supported protocol and one globally unique point catalog', async () => {
  const gateway = createLocalPointCatalogGateway()
  const sources = await gateway.listSources()
  const points = await gateway.listPoints()

  assert.deepEqual(new Set(sources.map(source => source.protocol)), new Set(POINT_SOURCE_PROTOCOLS))
  assert.equal(new Set(points.map(point => point.id)).size, points.length)
  assert.ok(points.length > sources.length)
  assert.ok(points.every(point => (
    point.id && point.name && point.group && point.type && point.status && point.updatedAt
    && point.sourceId && point.sourceName && point.protocol
  )))
})

test('searches point names, ids, groups and protocols with optional source filters', async () => {
  const gateway = createLocalPointCatalogGateway()
  const alarmPoints = await gateway.searchPoints('告警')
  const mqttPoints = await gateway.searchPoints({ query: '风机 01', protocol: 'MQTT' })
  const oneSource = await gateway.searchPoints('', { sourceId: 'source-http-energy' })

  assert.ok(alarmPoints.some(point => point.id === 'mqtt.motor01.alarm'))
  assert.ok(alarmPoints.some(point => point.protocol === 'Redis'))
  assert.ok(mqttPoints.length >= 2)
  assert.ok(mqttPoints.every(point => point.protocol === 'MQTT'))
  assert.ok(oneSource.length > 0)
  assert.ok(oneSource.every(point => point.sourceId === 'source-http-energy'))
})

test('pages and searches a 100k source without cloning or scanning the full catalog at once', async () => {
  const pointCount = 100_000
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: 'source-large-catalog',
      name: '大型目录',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: Array.from({ length: pointCount }, (_, index) => ({
        id: `large.point.${index}`,
        name: index === pointCount - 1 ? '末尾目标点位' : `点位 ${index}`,
        group: `分组 ${index % 20}`,
        type: 'number',
        value: index,
        status: 'good'
      }))
    }]
  })

  const metadata = await gateway.getSource('source-large-catalog', { includePoints: false })
  assert.equal(metadata.pointCount, pointCount)
  assert.equal(metadata.endpoint, 'https://gateway.example/realtime')
  assert.equal(Object.hasOwn(metadata, 'points'), false)

  const firstPage = await gateway.querySourcePoints({
    sourceId: 'source-large-catalog',
    limit: 50,
    includeUnavailable: true
  })
  assert.equal(firstPage.items.length, 50)
  assert.equal(firstPage.scanned, 50)
  assert.equal(firstPage.total, pointCount)
  assert.equal(firstPage.done, false)

  let cursor = null
  let tailResult = []
  let slices = 0
  do {
    const page = await gateway.querySourcePoints({
      sourceId: 'source-large-catalog',
      query: '末尾目标点位',
      cursor,
      limit: 50,
      includeUnavailable: true
    })
    assert.ok(page.scanned <= 512)
    tailResult.push(...page.items)
    cursor = page.nextCursor
    slices += 1
    if (page.done) {
      assert.equal(page.total, 1)
      break
    }
  } while (cursor)
  assert.ok(slices > 1)
  assert.deepEqual(tailResult.map(point => point.id), [`large.point.${pointCount - 1}`])

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    gateway.querySourcePoints({ sourceId: 'source-large-catalog', signal: controller.signal }),
    error => error?.name === 'AbortError'
  )

  await gateway.updateSource('source-large-catalog', { name: '大型目录（已改名）' }, { includePoints: false })
  await assert.rejects(
    gateway.querySourcePoints({ sourceId: 'source-large-catalog', cursor: firstPage.nextCursor }),
    error => error?.code === 'POINT_CATALOG_CURSOR_STALE'
  )

  const activated = await gateway.activateWorkspace('large-catalog-workspace')
  assert.equal(Object.hasOwn(activated, 'points'), false)
  assert.equal(activated.sources[0].pointCount, pointCount)

  // 生命周期返回值只能读取连接摘要；禁止重新扫描或复制 10 万点目录。
  const originalFilter = Array.prototype.filter
  Array.prototype.filter = function guardedLargeCatalogFilter(...args) {
    if (this.length === pointCount) throw new Error('workspace lifecycle enumerated the full point catalog')
    return Reflect.apply(originalFilter, this, args)
  }
  try {
    const sameWorkspace = await gateway.activateWorkspace('large-catalog-workspace')
    const refreshed = await gateway.refresh()
    assert.equal(Object.hasOwn(sameWorkspace, 'points'), false)
    assert.equal(Object.hasOwn(refreshed, 'points'), false)
    assert.equal(sameWorkspace.sources[0].healthyPointCount, pointCount)
  } finally {
    Array.prototype.filter = originalFilter
  }
})

test('updates sources through isolated copies and publishes directory changes', async () => {
  const gateway = createLocalPointCatalogGateway()
  const events = []
  const unsubscribe = gateway.subscribe(event => events.push(event))
  const before = await gateway.getSource('source-mqtt-workshop')
  before.name = '不能写回内部状态'
  before.config.brokerUrl = 'mqtt://mutated'

  assert.equal((await gateway.getSource('source-mqtt-workshop')).name, '车间设备')
  const updated = await gateway.updateSource('source-mqtt-workshop', {
    name: '一号车间设备',
    config: { brokerUrl: 'mqtt://10.20.1.99:1883' }
  })

  assert.equal(updated.name, '一号车间设备')
  assert.equal(updated.config.brokerUrl, 'mqtt://10.20.1.99:1883')
  assert.equal((await gateway.listSources()).find(source => source.id === updated.id).endpoint, 'mqtt://10.20.1.99:1883')
  assert.ok((await gateway.listPoints({ sourceId: updated.id })).every(point => point.sourceName === '一号车间设备'))
  assert.equal(events.at(-1).type, 'source-updated')
  assert.equal(events.at(-1).sourceId, updated.id)
  assert.equal(unsubscribe(), true)
  assert.equal(unsubscribe(), false)
})

test('tests valid and invalid connections and retains only a compact response summary', async () => {
  const now = () => Date.parse('2026-08-01T00:00:00.000Z')
  const gateway = createLocalPointCatalogGateway({ now })
  const valid = await gateway.testSource('source-mysql-production')

  assert.equal(valid.ok, true)
  assert.equal(valid.source.status, 'online')
  assert.equal(valid.response.at, '2026-08-01T00:00:00.000Z')
  assert.equal(valid.response.message, '连接成功，数据测试正常')
  assert.equal(valid.response.preview, '')
  assert.ok(await gateway.getSourceSnapshot(valid.source.id))

  const invalidSource = await gateway.createSource({
    id: 'source-invalid-http',
    name: '未配置接口',
    protocol: 'HTTP',
    config: { url: '' }
  })
  const invalid = await gateway.testSource(invalidSource.id)
  const restored = await gateway.getSource(invalidSource.id)

  assert.equal(invalid.ok, false)
  assert.equal(restored.status, 'error')
  assert.match(restored.lastResponse.message, /请求地址不能为空/)
  assert.ok(restored.points.every(point => point.status === 'offline'))
})

test('validates numeric bounds, select enums and HTTP header JSON before a connection succeeds', async () => {
  const gateway = createLocalPointCatalogGateway({ sources: [] })
  const source = await gateway.createSource({
    name: '待校验接口',
    protocol: 'HTTP',
    config: {
      url: 'https://gateway.example/realtime',
      method: 'PATCH',
      pollInterval: 99,
      headers: '{broken'
    }
  })

  const invalid = await gateway.testSource(source.id)
  assert.equal(invalid.ok, false)
  assert.match(invalid.response.message, /请求方法必须是以下选项之一：GET、POST/)
  assert.match(invalid.response.message, /采集周期（毫秒）不能小于 100/)
  assert.match(invalid.response.message, /请求头（JSON）格式无效/)

  await gateway.updateSource(source.id, {
    config: { method: 'GET', pollInterval: 86_400_001, headers: '[]' }
  })
  const aboveMaximum = await gateway.testSource(source.id)
  assert.equal(aboveMaximum.ok, false)
  assert.match(aboveMaximum.response.message, /采集周期（毫秒）不能大于 86400000/)
  assert.match(aboveMaximum.response.message, /请求头（JSON）必须是 JSON 对象/)

  await gateway.updateSource(source.id, {
    config: { pollInterval: 'not-a-number', headers: '{}' }
  })
  const nonNumeric = await gateway.testSource(source.id)
  assert.equal(nonNumeric.ok, false)
  assert.match(nonNumeric.response.message, /采集周期（毫秒）必须是有效数字/)
})

test('generates non-reusable source ids across deletion and gateway reconstruction', async () => {
  const uuids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ]
  let fallbackCalls = 0
  const crypto = {
    randomUUID() { return uuids.shift() },
    getRandomValues() {
      fallbackCalls += 1
      throw new Error('randomUUID should be preferred')
    }
  }
  const firstGateway = createLocalPointCatalogGateway({ sources: [], crypto })
  const first = await firstGateway.createSource({ name: '接口一', protocol: 'HTTP' })
  await firstGateway.removeSource(first.id)
  const second = await firstGateway.createSource({ name: '接口二', protocol: 'HTTP' })
  const rebuiltGateway = createLocalPointCatalogGateway({ sources: [], crypto })
  const third = await rebuiltGateway.createSource({ name: '接口三', protocol: 'HTTP' })

  assert.deepEqual(new Set([first.id, second.id, third.id]).size, 3)
  assert.equal(first.id, 'source-http-11111111-1111-4111-8111-111111111111')
  assert.equal(fallbackCalls, 0)
})

test('keeps structured snapshots out of response summaries and returns isolated copies', async () => {
  const cyclic = { state: 'running', samples: Array.from({ length: 2_000 }, (_, index) => index) }
  cyclic.self = cyclic
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: 'source-preview-budget',
      name: '预览预算',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: [{
        id: 'preview.large',
        name: '大对象',
        group: '预览',
        type: 'object',
        value: cyclic,
        status: 'good',
        updatedAt: '2026-08-01T00:00:00.000Z'
      }]
    }]
  })

  const result = await gateway.testSource('source-preview-budget')
  assert.equal(result.ok, true)
  assert.equal(result.response.preview, '')

  const first = await gateway.getSourceSnapshot('source-preview-budget')
  const second = await gateway.getSourceSnapshot('source-preview-budget')
  assert.notStrictEqual(first, second)
  assert.notStrictEqual(first.data, second.data)
  assert.equal(first.data.points[0].value.self, '[Circular]')
  first.data.points[0].name = '被调用方修改'
  assert.equal((await gateway.getSourceSnapshot('source-preview-budget')).data.points[0].name, '大对象')
})

test('publishes monotonic memory-only snapshots with latest-value replacement', async () => {
  const now = () => Date.parse('2026-08-01T00:00:00.000Z')
  const gateway = createLocalPointCatalogGateway({ now })
  const sourceId = 'source-http-energy'
  const initial = await gateway.getSourceSnapshot(sourceId)
  assert.deepEqual(Object.keys(initial), ['sourceId', 'revision', 'timestamp', 'quality', 'data', 'meta'])
  assert.equal(initial.data.data.power, 386.2)

  const events = []
  const unsubscribe = gateway.subscribeSnapshots(snapshot => events.push(snapshot))
  const payload = { data: { power: 401.8 }, rows: [{ id: 1 }] }
  const ingested = gateway.ingestSourceSnapshot(sourceId, payload, {
    quality: 'stale',
    timestamp: '2026-08-01T00:00:01.000Z',
    requestId: 'request-1'
  })
  payload.data.power = -1
  ingested.data.rows[0].id = 99

  const latest = await gateway.getSourceSnapshot(sourceId)
  assert.ok(latest.revision > initial.revision)
  assert.equal(latest.timestamp, '2026-08-01T00:00:01.000Z')
  assert.equal(latest.quality, 'stale')
  assert.equal(latest.data.data.power, 401.8)
  assert.equal(latest.data.rows[0].id, 1)
  assert.equal(latest.meta.requestId, 'request-1')
  assert.equal(events.length, 1)
  events[0].data.data.power = 0
  assert.equal((await gateway.getSourceSnapshot(sourceId)).data.data.power, 401.8)
  assert.equal(unsubscribe(), true)
  assert.equal(unsubscribe(), false)
})

test('offers an explicit read-only shared snapshot path without weakening isolated reads', async () => {
  const gateway = createLocalPointCatalogGateway()
  const sourceId = 'source-http-energy'
  const ownedPayload = { data: { power: 500.5 }, rows: Array.from({ length: 100 }, (_, id) => ({ id })) }
  let sharedEvent
  let isolatedEvent
  gateway.subscribeSnapshots(snapshot => { sharedEvent = snapshot }, { shared: true })
  gateway.subscribeSnapshots(snapshot => { isolatedEvent = snapshot })

  gateway.ingestSourceSnapshot(sourceId, ownedPayload, { quality: 'good' }, { takeOwnership: true })
  const sharedRead = await gateway.getSourceSnapshot(sourceId, { shared: true })
  const isolatedRead = await gateway.getSourceSnapshot(sourceId)

  assert.strictEqual(sharedEvent, sharedRead)
  assert.strictEqual(sharedRead.data, ownedPayload)
  assert.notStrictEqual(isolatedEvent, sharedRead)
  assert.notStrictEqual(isolatedRead, sharedRead)
  assert.notStrictEqual(isolatedRead.data, ownedPayload)
  isolatedRead.data.data.power = -1
  assert.equal(sharedRead.data.data.power, 500.5)
})

test('connection testing does not clone an owned response body that stays inside the gateway', async () => {
  const gateway = createLocalPointCatalogGateway()
  const sourceId = 'source-http-energy'
  const ownedPayload = { rows: Array.from({ length: 2_000 }, (_, id) => ({ id, value: id })) }
  gateway.ingestSourceSnapshot(
    sourceId,
    ownedPayload,
    { quality: 'good' },
    { takeOwnership: true, sharedResult: true }
  )

  const originalStructuredClone = globalThis.structuredClone
  let bodyCloneCount = 0
  globalThis.structuredClone = value => {
    if (value === ownedPayload || value?.data === ownedPayload) bodyCloneCount += 1
    return originalStructuredClone(value)
  }
  try {
    await gateway.testSource(sourceId, { includePoints: false })
  } finally {
    globalThis.structuredClone = originalStructuredClone
  }

  assert.equal(bodyCloneCount, 0)
  assert.strictEqual(
    (await gateway.getSourceSnapshot(sourceId, { shared: true })).data,
    ownedPayload
  )
})

test('a connection test cannot overwrite a newer snapshot received while it is pending', async () => {
  const gateway = createLocalPointCatalogGateway({ testDelayMs: 20 })
  const sourceId = 'source-http-energy'
  const initialData = { data: { power: 401 } }
  const latestData = { data: { power: 499 } }
  gateway.ingestSourceSnapshot(sourceId, initialData, {}, { takeOwnership: true, sharedResult: true })

  const pendingTest = gateway.testSource(sourceId, { includePoints: false })
  await Promise.resolve()
  const ingested = gateway.ingestSourceSnapshot(
    sourceId,
    latestData,
    { quality: 'good', origin: 'live-adapter' },
    { takeOwnership: true, sharedResult: true }
  )
  await pendingTest

  const snapshot = await gateway.getSourceSnapshot(sourceId, { shared: true })
  assert.strictEqual(snapshot, ingested)
  assert.strictEqual(snapshot.data, latestData)
  assert.equal(snapshot.data.data.power, 499)
})

test('tests an empty connection with a minimal structured sample and invalidates it on removal', async () => {
  const gateway = createLocalPointCatalogGateway()
  const events = []
  gateway.subscribeSnapshots(snapshot => events.push(snapshot))
  const source = await gateway.createSource({ name: '空连接', protocol: 'MQTT' })
  assert.equal(await gateway.getSourceSnapshot(source.id), null)

  const tested = await gateway.testSource(source.id)
  assert.equal(tested.ok, true)
  const snapshot = await gateway.getSourceSnapshot(source.id)
  assert.equal(snapshot.data.status, 'connected')
  assert.equal(snapshot.data.source.id, source.id)

  await gateway.removeSource(source.id)
  assert.equal(await gateway.getSourceSnapshot(source.id), null)
  const removed = events.at(-1)
  assert.equal(removed.sourceId, source.id)
  assert.equal(removed.quality, 'bad')
  assert.equal(removed.data, undefined)
  assert.equal(removed.meta.removed, true)
  assert.ok(removed.revision > snapshot.revision)
})

test('keeps the last snapshot while testing and publishes only the final quality transition', async () => {
  const gateway = createLocalPointCatalogGateway({ testDelayMs: 5 })
  const sourceId = 'source-http-energy'
  const events = []
  gateway.subscribeSnapshots(snapshot => {
    if (snapshot.sourceId === sourceId) events.push(snapshot)
  })

  await gateway.updateSource(sourceId, { enabled: false }, { includePoints: false })
  assert.equal(events.at(-1).quality, 'offline')
  assert.equal(events.at(-1).data, undefined)

  await gateway.updateSource(sourceId, { enabled: true }, { includePoints: false })
  assert.equal(events.at(-1).quality, 'offline')
  assert.equal(events.at(-1).data, undefined)

  gateway.ingestSourceSnapshot(sourceId, { data: { power: 412.5 } })
  assert.equal(events.at(-1).quality, 'good')
  assert.equal(events.at(-1).data.data.power, 412.5)

  await gateway.updateSource(sourceId, { enabled: false }, { includePoints: false })
  await gateway.updateSource(sourceId, { enabled: true }, { includePoints: false })
  assert.equal(events.at(-1).quality, 'offline')

  const eventCountBeforeTest = events.length
  const snapshotBeforeTest = await gateway.getSourceSnapshot(sourceId, { shared: true })
  const pendingTest = gateway.testSource(sourceId, { includePoints: false })
  await Promise.resolve()
  assert.equal(events.length, eventCountBeforeTest)
  assert.strictEqual(await gateway.getSourceSnapshot(sourceId, { shared: true }), snapshotBeforeTest)
  await pendingTest
  assert.equal(events.length, eventCountBeforeTest + 1)
  assert.equal(events.at(-1).quality, 'good')
})

test('keeps failed and disabled sources unavailable and restores legacy offline points after a successful test', async () => {
  const sourceId = 'source-legacy-offline'
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: sourceId,
      name: '旧版离线点位',
      protocol: 'HTTP',
      enabled: true,
      status: 'error',
      config: { url: 'https://gateway.example/realtime' },
      lastResponse: { ok: false, message: '旧版测试失败' },
      points: [{
        id: 'legacy.offline.value',
        name: '旧版离线值',
        group: '兼容性',
        type: 'number',
        value: 42,
        status: 'offline'
      }]
    }]
  })
  let snapshotSeenByTestedEvent = null
  gateway.subscribe(event => {
    if (event.type === 'source-tested') {
      snapshotSeenByTestedEvent = gateway.getSourceSnapshot(sourceId, { shared: true })
    }
  })

  const recovered = await gateway.testSource(sourceId, { includePoints: false })
  assert.equal(recovered.ok, true)
  assert.equal(recovered.source.status, 'online')
  assert.equal((await gateway.listPoints())[0].value, 42)
  assert.equal((await gateway.listSources())[0].healthyPointCount, 1)
  assert.equal((await snapshotSeenByTestedEvent).quality, 'good')

  await gateway.updateSource(sourceId, { enabled: false }, { includePoints: false })
  const disabled = await gateway.testSource(sourceId, { includePoints: false })
  assert.equal(disabled.ok, false)
  assert.equal(disabled.source.status, 'offline')
  assert.equal((await gateway.getSourceSnapshot(sourceId)).quality, 'offline')
  assert.deepEqual(await gateway.listPoints(), [])

  await gateway.updateSource(sourceId, {
    enabled: true,
    config: { url: '' }
  }, { includePoints: false })
  const failed = await gateway.testSource(sourceId, { includePoints: false })
  assert.equal(failed.ok, false)
  assert.equal(failed.source.status, 'error')
  assert.equal((await gateway.getSourceSnapshot(sourceId)).quality, 'error')
  assert.deepEqual(await gateway.listPoints(), [])
  assert.equal((await gateway.listPoints({ includeUnavailable: true }))[0].value, 42)
})

test('invalidates snapshots when protocol or connection config changes until fresh data arrives', async () => {
  const gateway = createLocalPointCatalogGateway()
  const sourceId = 'source-http-energy'
  const events = []
  gateway.subscribeSnapshots(snapshot => {
    if (snapshot.sourceId === sourceId) events.push(snapshot)
  })

  gateway.ingestSourceSnapshot(sourceId, { data: { power: 500 } })
  const updated = await gateway.updateSource(sourceId, {
    config: { url: 'https://new-gateway.example/realtime' }
  }, { includePoints: false })
  assert.equal(updated.status, 'offline')
  assert.equal(events.at(-1).quality, 'stale')
  assert.equal(events.at(-1).data, undefined)
  assert.equal(events.at(-1).meta.verificationRequired, true)

  gateway.ingestSourceSnapshot(sourceId, { data: { power: 501 } })
  assert.equal(events.at(-1).quality, 'good')
  assert.equal(events.at(-1).data.data.power, 501)

  await gateway.updateSource(sourceId, {
    protocol: 'WebSocket',
    config: { url: 'wss://new-gateway.example/realtime' }
  }, { includePoints: false })
  assert.equal(events.at(-1).quality, 'stale')
  assert.equal(events.at(-1).data, undefined)

  const tested = await gateway.testSource(sourceId, { includePoints: false })
  assert.equal(tested.ok, true)
  assert.equal(events.at(-1).quality, 'good')
})

test('looks up only requested legacy points by id and preserves request order', async () => {
  const gateway = createLocalPointCatalogGateway()
  assert.deepEqual(await gateway.getPointsByIds([]), [])
  const points = await gateway.getPointsByIds([
    'http.energy.today',
    'missing.point',
    'http.energy.power',
    'http.energy.today'
  ])
  assert.deepEqual(points.map(point => point.id), ['http.energy.today', 'http.energy.power'])
  assert.ok(points.every(point => point.sourceId === 'source-http-energy'))
})

test('isolates hostile protocol values within table and nested-cell budgets', async () => {
  let deepValue = { end: true }
  for (let index = 0; index < 20_000; index += 1) deepValue = { child: deepValue }

  let wideReads = 0
  const wideValue = { label: '运行' }
  for (let index = 0; index < 100_000; index += 1) {
    Object.defineProperty(wideValue, `field${index}`, {
      enumerable: true,
      get() {
        wideReads += 1
        return index
      }
    })
  }

  const cyclicValue = { label: '循环' }
  cyclicValue.self = cyclicValue
  const throwingValue = { label: '其余字段可用' }
  Object.defineProperty(throwingValue, 'failed', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  const customPrototypeValue = Object.assign(Object.create({ kind: 'custom' }), { label: '自定义对象' })

  const rows = Array.from({ length: MAX_RUNTIME_TABLE_ROWS }, (_, rowIndex) => (
    Array.from({ length: MAX_RUNTIME_TABLE_COLUMNS }, (_, columnIndex) => ({ rowIndex, columnIndex }))
  ))
  rows[0][0] = deepValue
  rows[0][1] = wideValue
  rows[0][2] = cyclicValue
  rows[0][3] = throwingValue
  rows[0][4] = Array.from({ length: 100_000 }, (_, index) => index)
  rows[0][5] = customPrototypeValue

  const datasetRows = Array.from({ length: MAX_RUNTIME_TABLE_ROWS }, (_, rowIndex) => (
    Array.from({ length: MAX_RUNTIME_TABLE_COLUMNS }, (_, columnIndex) => `${rowIndex}:${columnIndex}`)
  ))
  const dataset = {
    datasetId: 'complete-table',
    columns: Array.from({ length: MAX_RUNTIME_TABLE_COLUMNS }, (_, index) => ({ key: `c${index}`, title: `列 ${index}` })),
    rows: datasetRows
  }

  let gateway
  assert.doesNotThrow(() => {
    gateway = createLocalPointCatalogGateway({
      sources: [{
        id: 'source-hostile-values',
        name: '协议值预算',
        protocol: 'HTTP',
        enabled: true,
        status: 'online',
        config: { url: 'https://gateway.example/realtime' },
        points: [
          { id: 'table.rows', name: '行数组', group: '预算', type: 'array', value: rows, status: 'good' },
          { id: 'table.dataset', name: '数据集', group: '预算', type: 'object', value: dataset, status: 'good' }
        ]
      }]
    })
  })

  const source = await gateway.getSource('source-hostile-values')
  const tableValue = source.points.find(point => point.id === 'table.rows').value
  const datasetValue = source.points.find(point => point.id === 'table.dataset').value
  assert.equal(tableValue.length, MAX_RUNTIME_TABLE_ROWS)
  assert.ok(tableValue.every(row => row.length === MAX_RUNTIME_TABLE_COLUMNS))
  assert.equal(datasetValue.columns.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.equal(datasetValue.rows.length, MAX_RUNTIME_TABLE_ROWS)
  assert.ok(datasetValue.rows.every(row => row.length === MAX_RUNTIME_TABLE_COLUMNS))
  assert.deepEqual(datasetValue.rows.at(-1).at(-1), `${MAX_RUNTIME_TABLE_ROWS - 1}:${MAX_RUNTIME_TABLE_COLUMNS - 1}`)

  let depth = 0
  let cursor = tableValue[0][0]
  while (cursor && typeof cursor === 'object' && depth <= MAX_RUNTIME_TABLE_CELL_DEPTH + 1) {
    depth += 1
    cursor = cursor.child
  }
  assert.ok(depth <= MAX_RUNTIME_TABLE_CELL_DEPTH)
  assert.equal(cursor, '[Truncated]')
  assert.ok(Object.keys(tableValue[0][1]).length <= MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS)
  assert.ok(wideReads <= MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS, `read ${wideReads} wide properties`)
  assert.equal(tableValue[0][2].self, '[Circular]')
  assert.equal(tableValue[0][3].label, '其余字段可用')
  assert.equal(tableValue[0][3].failed, '[Thrown]')
  assert.ok(tableValue[0][4].length <= MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS)
  assert.notStrictEqual(tableValue[0][5], customPrototypeValue)
  assert.notStrictEqual(tableValue[1][0], rows[1][0])

  const pointWithThrowingValue = {
    id: 'point.throwing-value',
    name: '读取失败点位',
    group: '预算',
    type: 'object',
    status: 'good'
  }
  Object.defineProperty(pointWithThrowingValue, 'value', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  let updated
  await assert.doesNotReject(async () => {
    updated = await gateway.updateSource('source-hostile-values', { points: [pointWithThrowingValue] })
  })
  assert.equal(updated.points[0].value, '[Thrown]')
})

test('invalidates unavailable point and source states, then republishes their latest values after recovery', async () => {
  const timestamp = '2026-08-01T00:00:00.000Z'
  const pointIds = ['stale', 'bad', 'error', 'testing'].map(status => `lifecycle.${status}`)
  const latestValues = [11, 22, 33, 44]
  const gateway = createLocalPointCatalogGateway({
    sources: [{
      id: 'source-lifecycle',
      name: 'Lifecycle source',
      protocol: 'HTTP',
      enabled: true,
      status: 'online',
      config: { url: 'https://gateway.example/realtime' },
      points: pointIds.map((id, index) => ({
        id,
        name: id,
        group: 'Lifecycle',
        type: 'number',
        value: latestValues[index],
        status: 'good',
        updatedAt: timestamp
      }))
    }]
  })
  const events = []
  gateway.subscribe(event => events.push(event))

  const onlineSource = await gateway.getSource('source-lifecycle')
  await gateway.updateSource('source-lifecycle', {
    points: onlineSource.points.map((point, index) => ({
      ...point,
      status: ['stale', 'bad', 'error', 'testing'][index]
    }))
  })

  assert.deepEqual(events.at(-1).invalidatedPointIds, pointIds)
  assert.deepEqual(await gateway.listPoints(), [])
  const unavailablePoints = await gateway.listPoints({ includeUnavailable: true })
  assert.deepEqual(unavailablePoints.map(point => point.status), ['stale', 'bad', 'error', 'testing'])
  assert.deepEqual(unavailablePoints.map(point => point.value), latestValues)

  await gateway.updateSource('source-lifecycle', {
    points: unavailablePoints.map(point => ({ ...point, status: 'good' }))
  })
  assert.deepEqual(events.at(-1).availablePointIds, pointIds)
  assert.deepEqual((await gateway.listPoints()).map(point => point.value), latestValues)

  for (const status of ['testing', 'error']) {
    await gateway.updateSource('source-lifecycle', { status })
    assert.deepEqual(events.at(-1).invalidatedPointIds, pointIds)
    assert.deepEqual(await gateway.listPoints(), [])

    await gateway.updateSource('source-lifecycle', { status: 'online' })
    assert.deepEqual(events.at(-1).availablePointIds, pointIds)
    assert.deepEqual((await gateway.listPoints()).map(point => point.value), latestValues)
  }
})

test('rejects duplicate point ids during initialization and later source updates', async () => {
  const timestamp = '2026-07-31T00:00:00.000Z'
  const source = (id, pointId) => ({
    id,
    name: id,
    protocol: 'MQTT',
    config: { brokerUrl: 'mqtt://127.0.0.1:1883', clientId: id, topic: '#' },
    points: [{ id: pointId, name: pointId, group: '测试', type: 'number', value: 1, status: 'good', updatedAt: timestamp }]
  })

  assert.throws(
    () => createLocalPointCatalogGateway({ sources: [source('one', 'shared.point'), source('two', 'shared.point')] }),
    /点位 ID 重复：shared\.point/
  )

  const gateway = createLocalPointCatalogGateway({ sources: [source('one', 'one.point'), source('two', 'two.point')] })
  const second = await gateway.getSource('two')
  await assert.rejects(
    gateway.updateSource('two', { points: [{ ...second.points[0], id: 'one.point' }] }),
    /点位 ID 重复：one\.point/
  )
  assert.equal((await gateway.getSource('two')).points[0].id, 'two.point')
})

test('fails closed into a corrupt target workspace without leaking or overwriting the previous catalog', async () => {
  const timestamp = '2026-08-01T00:00:00.000Z'
  const source = (id, pointId) => ({
    id,
    name: id,
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: { url: 'https://gateway.example/realtime' },
    points: [{ id: pointId, name: pointId, group: id, type: 'number', value: 1, status: 'good', updatedAt: timestamp }]
  })
  const sourceA = source('source-a', 'workspace.a.point')
  const validSourceB = source('source-b-valid', 'workspace.b.valid')
  const saveCalls = []
  let corruptLoadCount = 0
  const store = {
    async load(workspaceId) {
      if (workspaceId === 'workspace-a') return [sourceA]
      corruptLoadCount += 1
      throw Object.assign(new Error('数据源存储损坏：点位分片缺失'), {
        code: 'POINT_SOURCE_STORAGE_CORRUPT',
        workspaceId,
        validSources: [validSourceB],
        invalidSourceIds: ['source-b-broken']
      })
    },
    async save(workspaceId) {
      saveCalls.push(workspaceId)
      return { durable: true, mode: 'durable', reason: '' }
    }
  }
  const gateway = createLocalPointCatalogGateway({ store, sources: [] })
  await gateway.activateWorkspace('workspace-a')
  assert.deepEqual((await gateway.listPoints()).map(point => point.id), ['workspace.a.point'])

  await assert.rejects(gateway.activateWorkspace('workspace-b'), error => (
    error?.code === 'POINT_SOURCE_STORAGE_CORRUPT'
  ))
  assert.equal(gateway.activeWorkspaceId, 'workspace-b')
  assert.equal(await gateway.getSource('source-a'), null)
  assert.deepEqual((await gateway.listSources()).map(item => item.id), ['source-b-valid'])
  assert.deepEqual((await gateway.listPoints()).map(point => point.id), ['workspace.b.valid'])
  assert.deepEqual(saveCalls, [], '损坏工作空间禁止写入默认数据源')

  await assert.rejects(
    gateway.createSource({ name: '不得覆盖', protocol: 'HTTP' }),
    error => error?.code === 'POINT_SOURCE_STORAGE_CORRUPT'
  )
  assert.deepEqual(saveCalls, [])

  // 同一目标仍处于损坏状态时必须重新读取，不能走“已激活”早退。
  await assert.rejects(gateway.activateWorkspace('workspace-b'), /数据源存储损坏/)
  assert.equal(corruptLoadCount, 2)
})
