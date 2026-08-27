const STATUS_LABELS = Object.freeze({
  online: '在线',
  offline: '离线',
  testing: '测试中',
  error: '异常',
  disabled: '已停用',
  unknown: '未知'
})

const PROTOCOL_SHORT_NAMES = Object.freeze({
  'SQL Server': 'SQL',
  WebSocket: 'WS',
  Socket: 'TCP',
  MySQL: 'MYSQL'
})

const INTERFACE_DEMO_ID_PREFIX = 'demo-interface-'
const VALID_STATUS_FILTERS = new Set(['all', 'online', 'issues', 'disabled'])
const POINT_SOURCE_LIST_PROTOCOL_ORDER = Object.freeze([
  'MQTT', 'HTTP', 'MySQL', 'SQL Server', 'Redis', 'Socket', 'WebSocket'
])
const POINT_SOURCE_PROTOCOL_SLUGS = Object.freeze({
  MQTT: 'mqtt',
  HTTP: 'http',
  MySQL: 'mysql',
  'SQL Server': 'sql-server',
  Redis: 'redis',
  Socket: 'socket',
  WebSocket: 'websocket'
})
const SOURCE_SEARCH_TEXT_CACHE = new WeakMap()

function normalizedSearchText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
}

export function sourceEffectiveStatus(source) {
  if (source?.enabled === false) return 'disabled'
  const status = String(source?.status || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : 'unknown'
}

export function sourceStatusLabel(status) {
  return STATUS_LABELS[String(status || '').toLowerCase()] || STATUS_LABELS.unknown
}

export function sourceProtocolShortName(protocol) {
  return PROTOCOL_SHORT_NAMES[protocol] || String(protocol || '').slice(0, 5).toUpperCase()
}

function stableTextHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** 生成稳定的 ASCII DOM id，并避免自定义协议名称规范化后发生冲突。 */
export function sourceProtocolGroupId(protocol) {
  const value = String(protocol || '')
  const knownSlug = POINT_SOURCE_PROTOCOL_SLUGS[value]
  if (knownSlug) return `protocol-${knownSlug}`

  const readableSlug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `protocol-${readableSlug || 'custom'}-${stableTextHash(value)}`
}

export function isInterfaceDemoSource(source) {
  return String(source?.id || '').startsWith(INTERFACE_DEMO_ID_PREFIX)
}

export function sourceListDisplayName(source) {
  const name = String(source?.name || '')
  if (!isInterfaceDemoSource(source)) return name
  const prefix = `${String(source?.protocol || '')} `
  const withoutProtocol = name.startsWith(prefix) ? name.slice(prefix.length) : name
  return withoutProtocol.endsWith(' Demo') ? withoutProtocol.slice(0, -5) : withoutProtocol
}

function statusMatchesFilter(status, filter) {
  if (filter === 'online') return status === 'online'
  if (filter === 'issues') return status === 'offline' || status === 'error'
  if (filter === 'disabled') return status === 'disabled'
  return true
}

function sourceSearchTexts(source, status) {
  const name = String(source?.name ?? '')
  const protocol = String(source?.protocol ?? '')
  const protocolShortName = sourceProtocolShortName(source?.protocol)
  const endpoint = String(source?.endpoint ?? '')
  const statusText = sourceStatusLabel(status)
  const issueText = status === 'offline' || status === 'error' ? '异常' : ''
  const categoryText = isInterfaceDemoSource(source)
    ? '数据连接 示例 demo 接口 测试'
    : '数据连接 连接配置'
  const cacheable = source !== null && (typeof source === 'object' || typeof source === 'function')
  const cached = cacheable ? SOURCE_SEARCH_TEXT_CACHE.get(source) : null

  // 先比较廉价的原始字段快照；对象原地修改后会立即重建，不会命中陈旧检索文本。
  if (
    cached
    && cached.name === name
    && cached.protocol === protocol
    && cached.protocolShortName === protocolShortName
    && cached.endpoint === endpoint
    && cached.statusText === statusText
    && cached.issueText === issueText
    && cached.categoryText === categoryText
  ) return cached.texts

  const texts = [
    name,
    protocol,
    protocolShortName,
    endpoint,
    statusText,
    issueText,
    categoryText
  ].map(normalizedSearchText)
  if (cacheable) {
    SOURCE_SEARCH_TEXT_CACHE.set(source, {
      name,
      protocol,
      protocolShortName,
      endpoint,
      statusText,
      issueText,
      categoryText,
      texts
    })
  }
  return texts
}

function sourceMatchesQuery(source, status, query) {
  if (!query) return true
  return sourceSearchTexts(source, status).some(value => value.includes(query))
}

/** Builds one immutable-by-convention view model without copying source records. */
export function createSourceConnectionListModel(sourceList, options = {}) {
  const sources = Array.isArray(sourceList) ? sourceList : []
  const query = normalizedSearchText(options.query)
  const statusFilter = VALID_STATUS_FILTERS.has(options.status) ? options.status : 'all'
  const protocolFilter = String(options.protocol || 'all')
  const stats = { total: 0, online: 0, errors: 0, disabled: 0 }
  const protocolCounts = new Map()
  const filtered = []
  const protocolGroups = new Map()

  for (const source of sources) {
    const status = sourceEffectiveStatus(source)
    const protocol = String(source?.protocol || '')
    stats.total += 1
    if (status === 'online') stats.online += 1
    if (status === 'offline' || status === 'error') stats.errors += 1
    if (status === 'disabled') stats.disabled += 1
    protocolCounts.set(protocol, (protocolCounts.get(protocol) || 0) + 1)

    if (protocolFilter !== 'all' && protocol !== protocolFilter) continue
    if (!statusMatchesFilter(status, statusFilter)) continue
    if (!sourceMatchesQuery(source, status, query)) continue

    filtered.push(source)
    if (!protocolGroups.has(protocol)) protocolGroups.set(protocol, [])
    protocolGroups.get(protocol).push(source)
  }

  const protocolOrder = [...POINT_SOURCE_LIST_PROTOCOL_ORDER]
  const orderedProtocols = [
    ...protocolOrder.filter(protocol => protocolGroups.has(protocol)),
    ...[...protocolGroups.keys()].filter(protocol => !protocolOrder.includes(protocol)).sort()
  ]

  return {
    stats,
    protocolCounts,
    filtered,
    filteredIds: new Set(filtered.map(source => source.id)),
    groups: orderedProtocols.map(protocol => ({
      id: sourceProtocolGroupId(protocol),
      label: protocol,
      items: protocolGroups.get(protocol)
    }))
  }
}
