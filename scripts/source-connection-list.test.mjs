import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSourceConnectionListModel,
  isInterfaceDemoSource,
  sourceEffectiveStatus,
  sourceListDisplayName,
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

test('builds global connection stats and separates interface demos without copying rows', () => {
  const model = createSourceConnectionListModel(sources)

  assert.deepEqual(model.stats, { total: 6, online: 2, errors: 2, disabled: 1 })
  assert.deepEqual(model.groups[0].items, sources.slice(0, 5))
  assert.deepEqual(model.groups[1].items, [sources[5]])
  assert.equal(model.filtered[0], sources[0])
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
  assert.deepEqual(
    createSourceConnectionListModel(sources, { query: '异常' }).filtered.map(source => source.id),
    ['business-socket', 'business-mysql']
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
