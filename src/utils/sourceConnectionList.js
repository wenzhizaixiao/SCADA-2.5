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

function sourceMatchesQuery(source, status, query) {
  if (!query) return true
  const protocolShortName = sourceProtocolShortName(source?.protocol)
  const statusText = sourceStatusLabel(status)
  const categoryText = isInterfaceDemoSource(source) ? '接口 demo 测试' : '连接配置'
  const issueText = status === 'offline' || status === 'error' ? '异常' : ''
  return [
    source?.name,
    source?.protocol,
    protocolShortName,
    source?.endpoint,
    statusText,
    issueText,
    categoryText
  ].some(value => normalizedSearchText(value).includes(query))
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
  const connections = []
  const demos = []

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
    if (isInterfaceDemoSource(source)) demos.push(source)
    else connections.push(source)
  }

  return {
    stats,
    protocolCounts,
    filtered,
    filteredIds: new Set(filtered.map(source => source.id)),
    groups: [
      { id: 'connections', label: '连接配置', items: connections },
      { id: 'demos', label: '接口 Demo', items: demos }
    ]
  }
}
