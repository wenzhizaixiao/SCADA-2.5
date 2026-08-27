import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSourceConnectionListModel,
  isInterfaceDemoSource,
  sourceEffectiveStatus,
  sourceListDisplayName,
  sourceProtocolGroupId,
  sourceProtocolShortName,
  sourceStatusLabel
} from '../src/utils/sourceConnectionList.js'

const sources = [
  { id: 'business-http', name: '能源接口', protocol: 'HTTP', endpoint: 'https://energy', enabled: true, status: 'online' },
  { id: 'business-socket', name: 'PLC 网关', protocol: 'Socket', endpoint: '10.0.0.2:9001', enabled: true, status: 'offline' },
  { id: 'business-ws', name: '事件流', protocol: 'WebSocket', endpoint: 'wss://events', enabled: true, status: 'testing' },
  { id: 'business-redis', name: '告警缓存', protocol: 'Redis', endpoint: '10.0.0.3:6379', enabled: false, status: 'online' },
  { id: 'business-mysql', name: '生产库', protocol: 'MySQL', endpoint: '10.0.0.4:3306', enabled: true, status: 'error' },
  { id: 'demo-interface-http-color', name: 'HTTP 颜色接口 Demo', protocol: 'HTTP', endpoint: 'https://demo/color', enabled: true, status: 'online' }
]

test('builds global stats and groups one data connection catalog by protocol', () => {
  const model = createSourceConnectionListModel(sources)

  assert.deepEqual(model.stats, { total: 6, online: 2, errors: 2, disabled: 1 })
  assert.deepEqual(model.groups.map(group => group.label), ['HTTP', 'MySQL', 'Redis', 'Socket', 'WebSocket'])
  assert.deepEqual(model.groups[0].items, [sources[0], sources[5]])
  assert.deepEqual(model.groups[1].items, [sources[4]])
  assert.deepEqual(model.groups[2].items, [sources[3]])
  assert.deepEqual(model.groups[3].items, [sources[1]])
  assert.deepEqual(model.groups[4].items, [sources[2]])
  assert.equal(model.filtered[0], sources[0])
  assert.equal(model.filtered[5], sources[5])
  assert.equal(model.protocolCounts.get('HTTP'), 2)
})

test('filters by status, protocol and every visible search alias while preserving order', () => {
  assert.deepEqual(
    createSourceConnectionListModel(sources, { status: 'issues' }).filtered.map(source => source.id),
    ['business-socket', 'business-mysql']
  )
  assert.deepEqual(
    createSourceConnectionListModel(sources, { status: 'disabled' }).filtered.map(source => source.id),
    ['business-redis']
  )
  assert.deepEqual(
    createSourceConnectionListModel(sources, { protocol: 'HTTP' }).filtered.map(source => source.id),
    ['business-http', 'demo-interface-http-color']
  )
  assert.deepEqual(createSourceConnectionListModel(sources, { query: 'tcp' }).filtered, [sources[1]])
  assert.deepEqual(createSourceConnectionListModel(sources, { query: 'ws' }).filtered, [sources[2]])
  assert.deepEqual(createSourceConnectionListModel(sources, { query: '离线' }).filtered, [sources[1]])
  assert.deepEqual(createSourceConnectionListModel(sources, { query: '数据连接' }).filtered, sources)
  assert.deepEqual(createSourceConnectionListModel(sources, { query: '示例' }).filtered, [sources[5]])
  assert.deepEqual(createSourceConnectionListModel(sources, { query: 'demo' }).filtered, [sources[5]])
  assert.deepEqual(
    createSourceConnectionListModel(sources, { query: '异常' }).filtered.map(source => source.id),
    ['business-socket', 'business-mysql']
  )
})

test('combines optional protocol and search filters without changing the source catalog', () => {
  const sharedNameSources = [
    { id: 'http-temperature', name: '车间温度', protocol: 'HTTP', endpoint: 'https://temperature', enabled: true, status: 'online' },
    { id: 'mqtt-temperature', name: '车间温度', protocol: 'MQTT', endpoint: 'factory/temperature', enabled: true, status: 'online' }
  ]

  assert.deepEqual(
    createSourceConnectionListModel(sharedNameSources, { query: '', protocol: 'all' }).filtered,
    sharedNameSources,
    '默认全部类型应直接保留完整目录和原始顺序'
  )
  assert.deepEqual(
    createSourceConnectionListModel(sharedNameSources, { query: '温度', protocol: 'all' }).filtered,
    createSourceConnectionListModel(sharedNameSources, { query: '温度' }).filtered,
    '全部类型不应改变名称搜索结果'
  )

  assert.deepEqual(
    createSourceConnectionListModel(sharedNameSources, { query: '温度', protocol: 'MQTT' }).filtered.map(source => source.id),
    ['mqtt-temperature']
  )
  assert.deepEqual(
    createSourceConnectionListModel(sharedNameSources, { query: '温度', protocol: 'Redis' }).filtered,
    []
  )
  assert.equal(
    createSourceConnectionListModel(sharedNameSources, { query: '温度', protocol: 'MQTT' }).protocolCounts.get('HTTP'),
    1,
    '可选协议列表应继续统计未选中的协议'
  )
})

test('exposes stable protocol, status and compact demo presentation values', () => {
  assert.equal(sourceProtocolShortName('Socket'), 'TCP')
  assert.equal(sourceProtocolShortName('WebSocket'), 'WS')
  assert.equal(sourceEffectiveStatus({ enabled: false, status: 'online' }), 'disabled')
  assert.equal(sourceStatusLabel('disabled'), '已停用')
  assert.equal(isInterfaceDemoSource(sources[5]), true)
  assert.equal(sourceListDisplayName(sources[5]), '颜色接口')
  assert.equal(sourceListDisplayName(sources[0]), '能源接口')
})

test('builds stable unique ASCII group ids without changing protocol labels', () => {
  const protocolSources = [
    { id: 'sql-server', protocol: 'SQL Server' },
    { id: 'custom-space', protocol: 'Custom API' },
    { id: 'custom-hyphen', protocol: 'Custom-API' },
    { id: 'custom-unicode', protocol: '自定义协议' }
  ]
  const model = createSourceConnectionListModel(protocolSources)
  const groupIds = model.groups.map(group => group.id)

  assert.equal(sourceProtocolGroupId('SQL Server'), 'protocol-sql-server')
  assert.equal(model.groups.find(group => group.label === 'SQL Server')?.id, 'protocol-sql-server')
  assert.deepEqual(new Set(model.groups.map(group => group.label)), new Set(protocolSources.map(source => source.protocol)))
  assert.equal(new Set(groupIds).size, groupIds.length)
  assert.ok(groupIds.every(id => /^[a-z0-9-]+$/.test(id)))
  assert.equal(sourceProtocolGroupId('Custom API'), sourceProtocolGroupId('Custom API'))
  assert.notEqual(sourceProtocolGroupId('Custom API'), sourceProtocolGroupId('Custom-API'))
})

test('reuses normalized fields for 5000 connections and invalidates changed or replaced rows', { concurrency: false }, () => {
  const largeSources = Array.from({ length: 5000 }, (_, index) => ({
    id: `bulk-${index}`,
    name: `车间连接 ${index}`,
    protocol: 'HTTP',
    endpoint: `https://gateway.example/source/${index}`,
    enabled: true,
    status: 'online'
  }))
  const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase
  let normalizationCalls = 0

  String.prototype.toLocaleLowerCase = function countedToLocaleLowerCase(...args) {
    normalizationCalls += 1
    return originalToLocaleLowerCase.apply(this, args)
  }

  try {
    const first = createSourceConnectionListModel(largeSources, { query: '车间连接 4999' })
    const callsAfterFirstSearch = normalizationCalls
    assert.deepEqual(first.filtered, [largeSources[4999]])

    const repeated = createSourceConnectionListModel(largeSources, { query: 'gateway.example' })
    assert.equal(repeated.filtered.length, 5000)
    assert.equal(
      normalizationCalls - callsAfterFirstSearch,
      1,
      '重复搜索只应规范化新查询，不应再处理 5000 条连接字段'
    )

    largeSources[4999].name = '已修改连接'
    largeSources[4999].endpoint = 'https://changed.example/realtime'
    largeSources[4999].status = 'error'
    assert.deepEqual(createSourceConnectionListModel(largeSources, { query: '已修改连接' }).filtered, [largeSources[4999]])
    assert.deepEqual(createSourceConnectionListModel(largeSources, { query: '车间连接 4999' }).filtered, [])
    assert.deepEqual(createSourceConnectionListModel(largeSources, { query: '异常' }).filtered, [largeSources[4999]])

    const replacement = { ...largeSources[4999], id: 'replacement', name: '替换后连接', protocol: 'Redis' }
    largeSources[4999] = replacement
    const replaced = createSourceConnectionListModel(largeSources, { query: '替换后连接' })
    assert.deepEqual(replaced.filtered, [replacement])
    assert.equal(replaced.filtered[0], replacement)
    assert.equal(replaced.groups.find(group => group.label === 'Redis')?.items[0], replacement)
  } finally {
    String.prototype.toLocaleLowerCase = originalToLocaleLowerCase
  }
})
