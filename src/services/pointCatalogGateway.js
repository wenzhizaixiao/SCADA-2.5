import { normalizeWorkspaceId } from '../utils/workspaceIdentity.js'
import {
  MAX_BINDING_POINT_ID_LENGTH,
  MAX_BINDING_TEXT_ARRAY_ITEMS,
  MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS,
  MAX_RUNTIME_TABLE_CELL_DEPTH,
  MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS,
  MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH,
  MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES,
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS,
  cloneRuntimeTableCellValue
} from '../models/dataBindingModel.js'
import { formatRuntimeValue } from '../utils/runtimeValueFormat.js'
import { createPointCatalogPreparer } from '../utils/pointCatalogPreparation.js'

const PROTOCOL_ALIASES = Object.freeze({
  MSSQL: 'SQL Server',
  SQLSERVER: 'SQL Server',
  WS: 'WebSocket'
})

export const POINT_SOURCE_PROTOCOLS = Object.freeze([
  'MQTT',
  'HTTP',
  'MySQL',
  'SQL Server',
  'Redis',
  'Socket',
  'WebSocket'
])

export const POINT_SOURCE_QUERY_PAGE_SIZE = 50
export const POINT_SOURCE_QUERY_MAX_PAGE_SIZE = 100
export const POINT_SOURCE_QUERY_SCAN_SIZE = 512
export const POINT_SOURCE_EVENT_ID_DETAIL_LIMIT = 4096

function freezeFields(fields) {
  return Object.freeze(fields.map(field => Object.freeze({ ...field })))
}

// UI 与未来后台适配器共用这份协议字段定义，防止两端配置名称逐渐偏离。
export const POINT_SOURCE_CONFIG_FIELDS = Object.freeze({
  MQTT: freezeFields([
    { key: 'brokerUrl', label: 'Broker 地址', required: true, span: 2, placeholder: 'mqtt://127.0.0.1:1883', default: 'mqtt://127.0.0.1:1883' },
    { key: 'clientId', label: 'Client ID', required: true, placeholder: 'tc2d-client', default: 'tc2d-client' },
    { key: 'topic', label: '订阅 Topic', required: true, placeholder: 'factory/+/telemetry', default: 'factory/+/telemetry' },
    { key: 'username', label: '用户名', placeholder: '可选', default: '' },
    { key: 'password', label: '密码', type: 'password', placeholder: '可选', default: '' },
    { key: 'qos', label: 'QoS', type: 'select', options: ['0', '1', '2'], default: '1' },
    { key: 'keepAlive', label: 'Keep Alive（秒）', type: 'number', min: 5, max: 86_400, default: 60 }
  ]),
  HTTP: freezeFields([
    { key: 'url', label: '请求地址', required: true, span: 2, placeholder: 'https://gateway.example/api/realtime', default: 'https://gateway.example/api/realtime' },
    { key: 'method', label: '请求方法', type: 'select', options: ['GET', 'POST'], default: 'GET' },
    { key: 'pollInterval', label: '采集周期（毫秒）', type: 'number', min: 100, max: 86_400_000, default: 1000 },
    { key: 'headers', label: '请求头（JSON）', type: 'textarea', span: 2, placeholder: '{"Authorization":"Bearer ..."}', default: '{}' },
    { key: 'dataPath', label: '数据路径', span: 2, placeholder: '$.data', default: '$.data' }
  ]),
  MySQL: freezeFields([
    { key: 'host', label: '主机地址', required: true, placeholder: '127.0.0.1', default: '127.0.0.1' },
    { key: 'port', label: '端口', type: 'number', required: true, min: 1, max: 65_535, default: 3306 },
    { key: 'database', label: '数据库', required: true, placeholder: 'production', default: 'production' },
    { key: 'username', label: '用户名', required: true, placeholder: 'readonly', default: 'readonly' },
    { key: 'password', label: '密码', type: 'password', placeholder: '由后台安全保存', default: '' },
    { key: 'pollInterval', label: '查询周期（毫秒）', type: 'number', min: 200, max: 86_400_000, default: 1000 },
    { key: 'query', label: '查询语句', type: 'textarea', span: 2, required: true, placeholder: 'SELECT ...', default: 'SELECT * FROM device_snapshot' }
  ]),
  'SQL Server': freezeFields([
    { key: 'host', label: '服务器地址', required: true, placeholder: '127.0.0.1', default: '127.0.0.1' },
    { key: 'port', label: '端口', type: 'number', required: true, min: 1, max: 65_535, default: 1433 },
    { key: 'database', label: '数据库', required: true, placeholder: 'Quality', default: 'Quality' },
    { key: 'username', label: '用户名', required: true, placeholder: 'readonly', default: 'readonly' },
    { key: 'password', label: '密码', type: 'password', placeholder: '由后台安全保存', default: '' },
    { key: 'pollInterval', label: '查询周期（毫秒）', type: 'number', min: 200, max: 86_400_000, default: 1000 },
    { key: 'query', label: '查询语句', type: 'textarea', span: 2, required: true, placeholder: 'SELECT ...', default: 'SELECT * FROM dbo.DeviceSnapshot' }
  ]),
  Redis: freezeFields([
    { key: 'host', label: '主机地址', required: true, placeholder: '127.0.0.1', default: '127.0.0.1' },
    { key: 'port', label: '端口', type: 'number', required: true, min: 1, max: 65_535, default: 6379 },
    { key: 'database', label: 'Database', type: 'number', min: 0, default: 0 },
    { key: 'password', label: '密码', type: 'password', placeholder: '可选', default: '' },
    { key: 'keyPattern', label: 'Key / Pattern', required: true, span: 2, placeholder: 'factory:*', default: 'factory:*' },
    { key: 'pollInterval', label: '刷新周期（毫秒）', type: 'number', min: 100, max: 86_400_000, default: 500 }
  ]),
  Socket: freezeFields([
    { key: 'host', label: '主机地址', required: true, placeholder: '127.0.0.1', default: '127.0.0.1' },
    { key: 'port', label: '端口', type: 'number', required: true, min: 1, max: 65_535, default: 9001 },
    { key: 'encoding', label: '报文编码', type: 'select', options: ['UTF-8', 'GBK', 'HEX'], default: 'UTF-8' },
    { key: 'delimiter', label: '报文边界', placeholder: '\\r\\n', default: '\\r\\n' },
    { key: 'heartbeat', label: '心跳内容', placeholder: 'PING', default: 'PING' },
    { key: 'heartbeatInterval', label: '心跳周期（秒）', type: 'number', min: 1, max: 86_400, default: 30 }
  ]),
  WebSocket: freezeFields([
    { key: 'url', label: '服务地址', required: true, span: 2, placeholder: 'wss://gateway.example/realtime', default: 'ws://127.0.0.1:8080' },
    { key: 'subprotocol', label: '子协议', placeholder: '可选', default: '' },
    { key: 'subscribeMessage', label: '订阅消息', type: 'textarea', span: 2, placeholder: '{"action":"subscribe"}', default: '{"action":"subscribe"}' },
    { key: 'heartbeatInterval', label: '心跳周期（秒）', type: 'number', min: 1, max: 86_400, default: 30 }
  ])
})

const ISSUED_SOURCE_IDS = new Set()
let fallbackSourceIdSequence = 0

const CLONE_TRUNCATED = '[Truncated]'
const CLONE_THROWN = '[Thrown]'
const CLONE_UNFORMATTABLE = '[Unformattable]'
const UNSAFE_CLONE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

// 目录结构允许承载大量点位，但协议值会在遇到 point.value 时切换为更严格的表格/单元格预算。
const CATALOG_CLONE_LIMITS = Object.freeze({
  maxDepth: 32,
  maxObjectKeys: 256,
  maxArrayItems: 10_000
})
const MAX_POINT_ROOT_ARRAY_ITEMS = Math.max(MAX_RUNTIME_TABLE_ROWS, MAX_BINDING_TEXT_ARRAY_ITEMS)
const POINT_CELL_FORMAT_LIMITS = Object.freeze({
  maxLength: MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH,
  maxDepth: MAX_RUNTIME_TABLE_CELL_DEPTH,
  maxObjectKeys: MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS,
  maxArrayItems: MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS,
  maxTotalEntries: MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES
})

function safeArrayCheck(value) {
  try {
    return { value: Array.isArray(value), threw: false }
  } catch {
    return { value: false, threw: true }
  }
}

function safeArrayLength(value) {
  try {
    const length = Number(value.length)
    if (!Number.isFinite(length)) return 0
    return Math.min(0xFFFFFFFF, Math.max(0, Math.floor(length)))
  } catch {
    return 0
  }
}

function safeProperty(value, key) {
  try {
    return { value: value[key], threw: false }
  } catch {
    return { value: undefined, threw: true }
  }
}

function safeOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
  } catch {
    return false
  }
}

function boundedRecordKeys(value, maximum) {
  const keys = []
  let scanned = 0
  const scanLimit = maximum * 2 + 4
  try {
    for (const key in value) {
      scanned += 1
      if (scanned > scanLimit) break
      if (!safeOwn(value, key) || UNSAFE_CLONE_KEYS.has(key)) continue
      keys.push(key)
      if (keys.length >= maximum) break
    }
  } catch {
    // Proxy 枚举失败时返回已经确认安全的键。
  }
  return keys
}

function clonePointCellValue(value) {
  const clone = cloneRuntimeTableCellValue(value)
  if (value !== null && typeof value === 'object' && clone === value) {
    return formatRuntimeValue(value, POINT_CELL_FORMAT_LIMITS)
  }
  return clone
}

function cloneTableRow(row) {
  if (row === null || typeof row !== 'object') return clonePointCellValue(row)
  const arrayCheck = safeArrayCheck(row)
  if (arrayCheck.threw) return CLONE_UNFORMATTABLE
  if (arrayCheck.value) {
    const clone = []
    const count = Math.min(safeArrayLength(row), MAX_RUNTIME_TABLE_COLUMNS)
    for (let index = 0; index < count; index += 1) {
      const item = safeProperty(row, index)
      clone.push(item.threw ? CLONE_THROWN : clonePointCellValue(item.value))
    }
    return clone
  }

  const clone = {}
  for (const key of boundedRecordKeys(row, MAX_RUNTIME_TABLE_COLUMNS)) {
    const item = safeProperty(row, key)
    clone[key] = item.threw ? CLONE_THROWN : clonePointCellValue(item.value)
  }
  return clone
}

function cloneTableRows(rows, maximum = MAX_RUNTIME_TABLE_ROWS) {
  const clone = []
  const count = Math.min(safeArrayLength(rows), maximum)
  for (let index = 0; index < count; index += 1) {
    const row = safeProperty(rows, index)
    clone.push(row.threw ? CLONE_THROWN : cloneTableRow(row.value))
  }
  return clone
}

function cloneTableColumns(columns) {
  const clone = []
  const count = Math.min(safeArrayLength(columns), MAX_RUNTIME_TABLE_COLUMNS)
  for (let index = 0; index < count; index += 1) {
    const column = safeProperty(columns, index)
    clone.push(column.threw ? CLONE_THROWN : clonePointCellValue(column.value))
  }
  return clone
}

function clonePointDataset(value, rows) {
  const clone = { rows: cloneTableRows(rows) }
  const copiedKeys = new Set(['rows'])

  const columns = safeProperty(value, 'columns')
  const columnsArray = columns.threw ? { value: false } : safeArrayCheck(columns.value)
  if (!columns.threw && !columnsArray.threw && columnsArray.value) {
    clone.columns = cloneTableColumns(columns.value)
    copiedKeys.add('columns')
  }

  for (const key of boundedRecordKeys(value, MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS)) {
    if (copiedKeys.has(key) || copiedKeys.size >= MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS) continue
    const item = safeProperty(value, key)
    clone[key] = item.threw ? CLONE_THROWN : clonePointCellValue(item.value)
    copiedKeys.add(key)
  }
  return clone
}

function clonePointValue(value) {
  if (value === null || typeof value !== 'object') return clonePointCellValue(value)
  const arrayCheck = safeArrayCheck(value)
  if (arrayCheck.threw) return CLONE_UNFORMATTABLE
  if (arrayCheck.value) return cloneTableRows(value, MAX_POINT_ROOT_ARRAY_ITEMS)

  const rows = safeProperty(value, 'rows')
  const rowsArray = rows.threw ? { value: false } : safeArrayCheck(rows.value)
  if (!rows.threw && !rowsArray.threw && rowsArray.value) return clonePointDataset(value, rows.value)
  return clonePointCellValue(value)
}

function isPointRecord(value) {
  if (!value || typeof value !== 'object') return false
  const arrayCheck = safeArrayCheck(value)
  return !arrayCheck.threw && !arrayCheck.value && safeOwn(value, 'id') && safeOwn(value, 'value')
}

function cloneContainer(value) {
  const arrayCheck = safeArrayCheck(value)
  if (arrayCheck.threw) return null
  if (arrayCheck.value) return { clone: [], kind: 'array' }
  try {
    if (value instanceof Date) return { clone: new Date(Date.prototype.getTime.call(value)), kind: 'terminal' }
  } catch {
    return null
  }
  return { clone: {}, kind: 'object' }
}

/** 非递归复制目录数据；点位值使用独立预算，避免深协议值阻塞目录读取。 */
function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value
  const rootContainer = cloneContainer(value)
  if (!rootContainer) return CLONE_UNFORMATTABLE
  if (rootContainer.kind === 'terminal') return rootContainer.clone

  const seen = new Map([[value, rootContainer.clone]])
  const stack = [{
    source: value,
    target: rootContainer.clone,
    kind: rootContainer.kind,
    role: rootContainer.kind === 'array' ? 'source-list' : (isPointRecord(value) ? 'point' : 'value'),
    depth: 0
  }]

  const copyEntry = (frame, key) => {
    const item = safeProperty(frame.source, key)
    if (item.threw) {
      frame.target[key] = CLONE_THROWN
      return true
    }
    if (frame.role === 'point' && key === 'value') {
      frame.target[key] = clonePointValue(item.value)
      return true
    }

    const child = item.value
    if (child === null || typeof child !== 'object') {
      frame.target[key] = child
      return true
    }
    if (seen.has(child)) {
      frame.target[key] = seen.get(child)
      return true
    }
    if (frame.depth + 1 >= CATALOG_CLONE_LIMITS.maxDepth) {
      frame.target[key] = CLONE_TRUNCATED
      return true
    }

    const container = cloneContainer(child)
    if (!container) {
      frame.target[key] = CLONE_UNFORMATTABLE
      return true
    }
    frame.target[key] = container.clone
    seen.set(child, container.clone)
    if (container.kind === 'terminal') return true

    let role = 'value'
    if (frame.role === 'point-list') role = 'point'
    else if (frame.kind === 'object' && key === 'points' && container.kind === 'array') role = 'point-list'
    else if (isPointRecord(child)) role = 'point'
    stack.push({
      source: child,
      target: container.clone,
      kind: container.kind,
      role,
      depth: frame.depth + 1
    })
    return true
  }

  while (stack.length) {
    const frame = stack.pop()
    if (frame.kind === 'array') {
      const maximum = frame.role === 'point-list' || frame.role === 'source-list'
        ? safeArrayLength(frame.source)
        : CATALOG_CLONE_LIMITS.maxArrayItems
      const count = Math.min(safeArrayLength(frame.source), maximum)
      for (let index = 0; index < count; index += 1) {
        if (!copyEntry(frame, index)) break
      }
      continue
    }
    for (const key of boundedRecordKeys(frame.source, CATALOG_CLONE_LIMITS.maxObjectKeys)) {
      if (!copyEntry(frame, key)) break
    }
  }
  return rootContainer.clone
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new TypeError(`${label}不能为空`)
  return normalized
}

function normalizedProtocol(value) {
  const raw = requiredText(value, '协议')
  const alias = PROTOCOL_ALIASES[raw.replace(/[\s_-]/g, '').toUpperCase()]
  const protocol = alias || POINT_SOURCE_PROTOCOLS.find(item => item.toLowerCase() === raw.toLowerCase())
  if (!protocol) throw new TypeError(`不支持的数据源协议：${raw}`)
  return protocol
}

function defaultConfig(protocol) {
  return Object.fromEntries(POINT_SOURCE_CONFIG_FIELDS[protocol].map(field => [field.key, field.default ?? '']))
}

function normalizeConfig(protocol, config) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const normalized = defaultConfig(protocol)
  for (const field of POINT_SOURCE_CONFIG_FIELDS[protocol]) {
    if (!(field.key in source)) continue
    const value = source[field.key]
    if (field.type !== 'number') {
      normalized[field.key] = String(value ?? '')
      continue
    }
    const numericValue = Number(value)
    // 无效数字保留原始文本，连接测试才能给出明确错误，不能静默替换为默认值。
    normalized[field.key] = Number.isFinite(numericValue) ? numericValue : String(value ?? '')
  }
  return normalized
}

function sourceConfigEquals(protocol, left, right) {
  return POINT_SOURCE_CONFIG_FIELDS[protocol].every(field => Object.is(left?.[field.key], right?.[field.key]))
}

function secureSourceIdToken(cryptoProvider) {
  try {
    if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID().toLowerCase()
  } catch {
    // 部分 WebView 暴露了 crypto 但禁用了 randomUUID，继续使用 getRandomValues。
  }
  try {
    if (typeof cryptoProvider?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      cryptoProvider.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // 极旧环境进入最后的进程级唯一回退。
  }
  fallbackSourceIdSequence += 1
  return `${Date.now().toString(36)}-${fallbackSourceIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function createGeneratedSourceId(protocol, cryptoProvider, isTaken) {
  const prefix = `source-${protocol.toLowerCase().replace(/\s+/g, '-')}`
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `${prefix}-${secureSourceIdToken(cryptoProvider)}`
    if (ISSUED_SOURCE_IDS.has(id) || isTaken(id)) continue
    ISSUED_SOURCE_IDS.add(id)
    return id
  }
  // 防御错误的宿主 crypto 实现：重复返回同一 UUID 时切换进程级唯一序列。
  for (;;) {
    const id = `${prefix}-${secureSourceIdToken(null)}`
    if (ISSUED_SOURCE_IDS.has(id) || isTaken(id)) continue
    ISSUED_SOURCE_IDS.add(id)
    return id
  }
}

function normalizeDate(value, fallback) {
  const date = new Date(value ?? fallback)
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString()
}

function normalizePoint(point, source, now) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) throw new TypeError('点位结构无效')
  const id = requiredText(point.id, '点位 ID')
  if (id.length > MAX_BINDING_POINT_ID_LENGTH) {
    throw new TypeError(`点位 ID 不能超过 ${MAX_BINDING_POINT_ID_LENGTH} 个字符`)
  }
  const pointValue = safeProperty(point, 'value')
  const value = pointValue.threw ? CLONE_THROWN : pointValue.value
  const type = ['number', 'string', 'boolean', 'array', 'object'].includes(point.type) ? point.type : typeof value
  const status = ['good', 'stale', 'bad', 'error', 'offline', 'testing'].includes(point.status) ? point.status : 'good'
  return {
    id,
    name: requiredText(point.name || point.id, '点位名称'),
    group: String(point.group || '未分组').trim() || '未分组',
    type: ['number', 'string', 'boolean', 'array', 'object'].includes(type) ? type : 'string',
    value: clonePointValue(value),
    status,
    updatedAt: normalizeDate(point.updatedAt, now),
    sourceId: source.id,
    sourceName: source.name,
    protocol: source.protocol
  }
}

function normalizeLastResponse(value, now) {
  if (!value || typeof value !== 'object') return null
  return {
    ok: Boolean(value.ok),
    at: normalizeDate(value.at, now),
    durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)),
    message: String(value.message || ''),
    preview: String(value.preview || '').slice(0, 2000)
  }
}

function normalizeSource(source, now) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('数据源结构无效')
  const protocol = normalizedProtocol(source.protocol)
  const normalized = {
    id: requiredText(source.id, '数据源 ID'),
    name: requiredText(source.name, '数据源名称'),
    protocol,
    enabled: source.enabled !== false,
    status: ['online', 'offline', 'testing', 'error'].includes(source.status) ? source.status : 'offline',
    config: normalizeConfig(protocol, source.config),
    lastResponse: normalizeLastResponse(source.lastResponse, now),
    points: []
  }
  normalized.points = (Array.isArray(source.points) ? source.points : []).map(point => normalizePoint(point, normalized, now))
  return normalized
}

/** 连接元数据变化时复用已规范化的点位，避免对大目录重复深拷贝。 */
function normalizeSourceMetadata(source, now, points) {
  const normalized = normalizeSource({ ...source, points: [] }, now)
  normalized.points = points
  return normalized
}

function assertUniqueSourceIds(sources) {
  const ids = new Set()
  for (const source of sources) {
    if (ids.has(source.id)) throw new TypeError(`数据源 ID 重复：${source.id}`)
    ids.add(source.id)
  }
}

function assertUniquePointIds(sources) {
  const ids = new Set()
  for (const source of sources) {
    for (const point of source.points) {
      if (ids.has(point.id)) throw new TypeError(`点位 ID 重复：${point.id}`)
      ids.add(point.id)
    }
  }
}

function point(type, id, name, group, value, updatedAt, status = 'good') {
  return { type, id, name, group, value, updatedAt, status }
}

export function createDefaultPointSources() {
  const updatedAt = '2026-07-31T07:30:00.000Z'
  return [
    {
      id: 'source-mqtt-workshop', name: '车间设备', protocol: 'MQTT', enabled: true, status: 'online',
      config: { brokerUrl: 'mqtt://10.20.1.18:1883', clientId: 'tc2d-line1', topic: 'factory/line1/+/telemetry', username: 'factory-readonly', qos: '1', keepAlive: 60 },
      lastResponse: { ok: true, at: updatedAt, durationMs: 18, message: '连接正常，已接收设备遥测', preview: '{"device":"motor01","rpm":1480,"running":true}' },
      points: [
        point('string', 'mqtt.motor01.alarm', '电机告警状态', '生产一线 / 风机 01', 'warning', updatedAt),
        point('boolean', 'mqtt.motor01.running', '电机运行状态', '生产一线 / 风机 01', true, updatedAt),
        point('number', 'mqtt.motor01.rpm', '电机当前转速', '生产一线 / 风机 01', 1480, updatedAt),
        point('number', 'mqtt.motor01.temperature', '轴承温度', '生产一线 / 风机 01', 86.2, updatedAt)
      ]
    },
    {
      id: 'source-http-energy', name: '能源接口', protocol: 'HTTP', enabled: true, status: 'online',
      config: { url: 'https://energy-gateway/api/v1/realtime', method: 'GET', pollInterval: 1000, headers: '{}', dataPath: '$.data' },
      lastResponse: { ok: true, at: updatedAt, durationMs: 42, message: 'HTTP 200，数据解析正常', preview: '{"data":{"power":386.2,"today":18342.7}}' },
      points: [
        point('number', 'http.energy.power', '当前功率', '能源中心 / 总表', 386.2, updatedAt),
        point('number', 'http.energy.today', '今日用电量', '能源中心 / 总表', 18342.7, updatedAt),
        point('string', 'http.energy.quality', '数据质量', '能源中心 / 总表', 'good', updatedAt)
      ]
    },
    {
      id: 'source-mysql-production', name: '生产数据库', protocol: 'MySQL', enabled: true, status: 'online',
      config: { host: '10.20.3.11', port: 3306, database: 'production', username: 'readonly', password: '', pollInterval: 1000, query: 'SELECT * FROM device_snapshot WHERE updated_at > ?' },
      lastResponse: { ok: true, at: updatedAt, durationMs: 31, message: '增量查询成功', preview: '[{"device":"M01","output":12640}]' },
      points: [
        point('number', 'mysql.production.m01.output', '当前产量', '生产报表 / M01', 12640, updatedAt),
        point('number', 'mysql.production.m01.target', '目标产量', '生产报表 / M01', 13200, updatedAt),
        point('string', 'mysql.production.m01.state', '生产状态', '生产报表 / M01', 'run', updatedAt),
        point('array', 'mysql.production.line1.overview', '产线实时明细', '生产报表 / 产线 1', [
          { device: '风机 01', state: '运行', value: 1480 },
          { device: '水泵 02', state: '待机', value: 0 },
          { device: '电机 03', state: '告警', value: 86.2 }
        ], updatedAt)
      ]
    },
    {
      id: 'source-sqlserver-quality', name: '质量数据库', protocol: 'SQL Server', enabled: true, status: 'online',
      config: { host: '10.20.3.21', port: 1433, database: 'Quality', username: 'readonly', password: '', pollInterval: 1000, query: 'SELECT * FROM dbo.v_LineQuality' },
      lastResponse: { ok: true, at: updatedAt, durationMs: 46, message: 'Change Tracking 正常', preview: '[{"line":"line1","passRate":98.72}]' },
      points: [
        point('number', 'sqlserver.quality.line1.passRate', '一次合格率', '质量中心 / 产线 1', 98.72, updatedAt),
        point('number', 'sqlserver.quality.line1.samples', '抽检数量', '质量中心 / 产线 1', 642, updatedAt),
        point('string', 'sqlserver.quality.line1.state', '质量状态', '质量中心 / 产线 1', 'good', updatedAt)
      ]
    },
    {
      id: 'source-redis-alarm', name: '告警缓存', protocol: 'Redis', enabled: true, status: 'online',
      config: { host: '10.20.4.16', port: 6379, database: 2, password: '', keyPattern: 'alarm:*', pollInterval: 500 },
      lastResponse: { ok: true, at: updatedAt, durationMs: 9, message: 'Redis 节点在线', preview: '{"id":"ALM-0182","level":"warning"}' },
      points: [
        point('string', 'redis.alarm.latest.level', '最新告警等级', '告警中心', 'warning', updatedAt),
        point('boolean', 'redis.alarm.motor01.active', '电机告警激活', '告警中心 / 风机 01', true, updatedAt),
        point('string', 'redis.alarm.latest.id', '最新告警编号', '告警中心', 'ALM-0182', updatedAt)
      ]
    },
    {
      id: 'source-socket-plc', name: 'PLC Socket 网关', protocol: 'Socket', enabled: true, status: 'offline',
      config: { host: '10.20.2.30', port: 9001, encoding: 'HEX', delimiter: '\\r\\n', heartbeat: 'PING', heartbeatInterval: 30 },
      lastResponse: { ok: false, at: updatedAt, durationMs: 3000, message: '连接超时，等待重新测试', preview: '' },
      points: [
        point('string', 'socket.plc.line1.state', 'PLC 运行状态', 'PLC 网关 / 产线 1', 'unknown', updatedAt, 'offline'),
        point('number', 'socket.plc.line1.count', 'PLC 计数', 'PLC 网关 / 产线 1', 12640, updatedAt, 'stale'),
        point('string', 'socket.plc.line1.quality', 'PLC 通信质量', 'PLC 网关 / 产线 1', 'offline', updatedAt, 'offline')
      ]
    },
    {
      id: 'source-websocket-events', name: '实时事件通道', protocol: 'WebSocket', enabled: true, status: 'online',
      config: { url: 'wss://runtime-gateway/ws', subprotocol: 'tc2d-runtime-v1', subscribeMessage: '{"action":"subscribe","scope":"factory"}', heartbeatInterval: 30 },
      lastResponse: { ok: true, at: updatedAt, durationMs: 16, message: 'WebSocket 已连接', preview: '{"event":"line.changed","line":"line1"}' },
      points: [
        point('string', 'websocket.events.latest.type', '最新事件类型', '实时事件', 'line.changed', updatedAt),
        point('string', 'websocket.events.latest.line', '事件产线', '实时事件', 'line1', updatedAt),
        point('number', 'websocket.events.sequence', '事件序号', '实时事件', 28193, updatedAt)
      ]
    }
  ]
}

function sourceEndpoint(source) {
  const config = source.config
  if (source.protocol === 'MQTT') return config.brokerUrl
  if (source.protocol === 'HTTP' || source.protocol === 'WebSocket') return config.url
  if (['MySQL', 'SQL Server', 'Redis', 'Socket'].includes(source.protocol)) return `${config.host}:${config.port}`
  return ''
}

function lastResponseSummary(response) {
  if (!response) return null
  return {
    ok: response.ok,
    at: response.at,
    durationMs: response.durationMs,
    message: response.message
  }
}

function sourceSummary(source, healthyPointCount = 0) {
  return {
    id: source.id,
    name: source.name,
    protocol: source.protocol,
    enabled: source.enabled,
    status: source.status,
    endpoint: sourceEndpoint(source),
    pointCount: source.points.length,
    healthyPointCount,
    lastResponse: cloneValue(lastResponseSummary(source.lastResponse))
  }
}

function configErrors(source) {
  if (!source.enabled) return ['数据源已停用']
  const errors = []
  for (const field of POINT_SOURCE_CONFIG_FIELDS[source.protocol]) {
    const value = source.config[field.key]
    const text = String(value ?? '').trim()
    if (field.required && !text) {
      errors.push(`${field.label}不能为空`)
      continue
    }
    if (!text) continue
    if (field.type === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) {
        errors.push(`${field.label}必须是有效数字`)
        continue
      }
      if (Number.isFinite(field.min) && number < field.min) errors.push(`${field.label}不能小于 ${field.min}`)
      if (Number.isFinite(field.max) && number > field.max) errors.push(`${field.label}不能大于 ${field.max}`)
    }
    if (field.type === 'select' && !field.options.includes(text)) {
      errors.push(`${field.label}必须是以下选项之一：${field.options.join('、')}`)
    }
    if (source.protocol === 'HTTP' && field.key === 'headers') {
      try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push('请求头（JSON）必须是 JSON 对象')
        }
      } catch {
        errors.push('请求头（JSON）格式无效')
      }
    }
  }
  return errors
}

function cloneSnapshotValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {
      // 协议数据可能包含不可克隆值；回退到目录使用的防御性复制。
    }
  }
  return cloneValue(value)
}

function parsedResponsePreview(source) {
  const preview = String(source?.lastResponse?.preview || '').trim()
  if (!preview) return undefined
  try {
    return JSON.parse(preview)
  } catch {
    return undefined
  }
}

function sampleDataFromPoints(source) {
  const points = Array.isArray(source?.points) ? source.points : []
  if (!points.length) {
    return {
      status: 'connected',
      source: {
        id: source.id,
        name: source.name,
        protocol: source.protocol
      }
    }
  }

  // 本地适配器只构造固定大小的测试样例；真实后台快照由 ingestSourceSnapshot 注入。
  return {
    points: points.slice(0, MAX_RUNTIME_TABLE_ROWS).map(pointValue => ({
      id: pointValue.id,
      name: pointValue.name,
      type: pointValue.type,
      value: cloneSnapshotValue(pointValue.value),
      status: pointValue.status,
      updatedAt: pointValue.updatedAt
    })),
    total: points.length
  }
}

function sourceSampleData(source, codeDefinedFallback) {
  const preview = parsedResponsePreview(source)
  if (preview !== undefined) return preview
  return codeDefinedFallback === undefined
    ? sampleDataFromPoints(source)
    : cloneSnapshotValue(codeDefinedFallback)
}

function normalizedSnapshotQuality(value, fallback = 'good') {
  const quality = String(value || '').trim().toLowerCase()
  return ['good', 'stale', 'bad', 'error', 'offline', 'testing', 'unknown'].includes(quality)
    ? quality
    : fallback
}

function sourceCanPublish(source) {
  return source.enabled && source.status === 'online'
}

function pointCanPublish(point, source, recoveredOfflinePointSourceIds = null) {
  return sourceCanPublish(source) && (
    point.status === 'good'
    || (point.status === 'offline' && recoveredOfflinePointSourceIds?.has(source.id))
  )
}

function pointMatchesQuery(point, source, query) {
  if (!query) return true
  const metadataMatches = [
    point.id,
    point.name,
    point.group,
    point.type,
    source.name,
    source.protocol
  ].some(value => String(value ?? '').toLocaleLowerCase('zh-CN').includes(query))
  if (metadataMatches) return true
  return formatRuntimeValue(point.value, POINT_CELL_FORMAT_LIMITS)
    .toLocaleLowerCase('zh-CN')
    .includes(query)
}

function abortPointQuery(signal) {
  if (!signal?.aborted) return
  if (typeof DOMException === 'function') throw new DOMException('点位查询已取消', 'AbortError')
  const error = new Error('点位查询已取消')
  error.name = 'AbortError'
  throw error
}

function normalizedPointQueryCursor(cursor, revision, sourceId) {
  if (cursor == null || cursor === '') return { offset: 0, matched: 0 }
  if (!cursor || typeof cursor !== 'object') throw new TypeError('点位查询游标无效')
  if (cursor.revision !== revision || String(cursor.sourceId) !== sourceId) {
    const error = new Error('点位目录已更新，请重新查询')
    error.code = 'POINT_CATALOG_CURSOR_STALE'
    throw error
  }
  const offset = Number(cursor.offset)
  const matched = Number(cursor.matched)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(matched) || matched < 0) {
    throw new TypeError('点位查询游标无效')
  }
  return { offset, matched }
}

function availablePointIdSet(sourceList, recoveredOfflinePointSourceIds = null) {
  const ids = new Set()
  for (const source of sourceList) {
    if (!sourceCanPublish(source)) continue
    for (const point of source.points) {
      if (pointCanPublish(point, source, recoveredOfflinePointSourceIds)) ids.add(point.id)
    }
  }
  return ids
}

function requiredWorkspaceId(value) {
  const workspaceId = normalizeWorkspaceId(value)
  if (!workspaceId) throw new TypeError('工作空间不能为空')
  return workspaceId
}

function normalizePersistenceResult(value, fallbackReason = 'storage-unavailable') {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'durable')) {
    const durable = Boolean(value.durable)
    return Object.freeze({
      durable,
      mode: durable ? 'durable' : 'memory',
      reason: durable ? '' : String(value.reason || fallbackReason)
    })
  }
  const durable = value === true
  return Object.freeze({ durable, mode: durable ? 'durable' : 'memory', reason: durable ? '' : fallbackReason })
}

function sourceMetadataResult(source, persistence) {
  const { points, lastResponse, ...metadata } = source
  return {
    ...cloneValue(metadata),
    endpoint: sourceEndpoint(source),
    lastResponse: cloneValue(lastResponseSummary(lastResponse)),
    pointCount: points.length,
    persistence
  }
}

function sourceResult(source, persistence, includePoints = true) {
  if (!includePoints) return sourceMetadataResult(source, persistence)
  return { ...cloneValue(source), persistence }
}

function isStorageCorruption(error) {
  return error?.code === 'POINT_SOURCE_STORAGE_CORRUPT'
}

/**
 * 本地实现遵循异步接口；未来 HTTP 实现只需提供同名方法即可替换，调用方不感知存储位置。
 */
export function createLocalPointCatalogGateway(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const delayMs = Math.max(0, Number(options.testDelayMs) || 0)
  const store = options.store || null
  const cryptoProvider = options.crypto || globalThis.crypto
  const initialSourceInput = options.sources
  const createInitialSources = () => cloneValue(
    initialSourceInput == null
      ? createDefaultPointSources()
      : (typeof initialSourceInput === 'function' ? initialSourceInput() : initialSourceInput)
  )
  let activeWorkspaceId = requiredWorkspaceId(options.workspaceId || 'default')
  const initialSources = createInitialSources()
  // 响应正文不会写入本地存储；保留代码内置的小型样例，确保刷新后 JSONPath 结构不变。
  const codeDefinedSamples = new Map()
  for (const source of Array.isArray(initialSources) ? initialSources : []) {
    const sample = parsedResponsePreview(source)
    if (sample === undefined) continue
    codeDefinedSamples.set(String(source?.id ?? ''), {
      protocol: String(source?.protocol ?? ''),
      data: sample
    })
  }
  let sources = (Array.isArray(initialSources) ? initialSources : []).map(source => normalizeSource(source, now()))
  const listeners = new Set()
  const snapshotListeners = new Map()
  const sourceSnapshots = new Map()
  const snapshotRevisionBySource = new Map()
  // 兼容旧版本“测试失败后把整批点位持久化为 offline”的数据，不改写大点位分片。
  const recoveredOfflinePointSourceIds = new Set()
  let sourceIndex = new Map()
  let pointIndex = new Map()
  let healthyPointCountBySource = new Map()
  let offlinePointCountBySource = new Map()
  let workspaceLoaded = false
  let workspaceCorruption = null
  let catalogRevision = 1
  let mutationTail = Promise.resolve()
  const catalogPreparer = createPointCatalogPreparer({
    schedule: options.catalogSchedule,
    cancel: options.catalogCancel,
    now: options.catalogNow,
    budgetMs: options.catalogBudgetMs,
    maxOperationsPerSlice: options.catalogMaxOperationsPerSlice,
    normalizeSource: source => normalizeSourceMetadata(source, now(), []),
    normalizePoint: (pointValue, source) => normalizePoint(pointValue, source, now())
  })
  let lastPersistence = normalizePersistenceResult(
    store?.getPersistenceStatus?.(activeWorkspaceId),
    store ? 'persistence-status-unknown' : 'storage-unavailable'
  )

  function sampleDataForSource(source) {
    const fallback = codeDefinedSamples.get(String(source?.id ?? ''))
    return sourceSampleData(
      source,
      fallback?.protocol === source?.protocol ? fallback.data : undefined
    )
  }

  assertUniqueSourceIds(sources)
  assertUniquePointIds(sources)

  function rebuildSourceIndex() {
    sourceIndex = new Map(sources.map(source => [source.id, source]))
  }

  function rebuildPointIndex() {
    const next = new Map()
    const nextHealthyCounts = new Map()
    const nextOfflineCounts = new Map()
    for (const source of sources) {
      let healthyPointCount = 0
      let offlinePointCount = 0
      for (const pointValue of source.points) {
        next.set(pointValue.id, { sourceId: source.id, point: pointValue })
        if (pointValue.status === 'good') healthyPointCount += 1
        if (pointValue.status === 'offline') offlinePointCount += 1
      }
      nextHealthyCounts.set(source.id, healthyPointCount)
      nextOfflineCounts.set(source.id, offlinePointCount)
    }
    pointIndex = next
    healthyPointCountBySource = nextHealthyCounts
    offlinePointCountBySource = nextOfflineCounts
  }

  function rebuildCatalogIndexes({ pointsChanged = true } = {}) {
    rebuildSourceIndex()
    if (pointsChanged) rebuildPointIndex()
  }

  function installPreparedCatalog(prepared) {
    sources = prepared.sources
    sourceIndex = prepared.sourceIndex
    pointIndex = prepared.pointIndex
    healthyPointCountBySource = prepared.healthyPointCountBySource
    offlinePointCountBySource = prepared.offlinePointCountBySource
  }

  async function normalizeSourceAsync(source) {
    const prepared = await catalogPreparer.prepare([source])
    return prepared.sources[0]
  }

  function prepareNormalizedCatalog(candidate) {
    return catalogPreparer.prepare(candidate, { normalized: true })
  }

  function includeDetailedPointIds(...sourceLists) {
    let count = 0
    for (const sourceList of sourceLists) {
      for (const source of sourceList || []) {
        count += Array.isArray(source?.points) ? source.points.length : 0
        if (count > POINT_SOURCE_EVENT_ID_DETAIL_LIMIT) return false
      }
    }
    return true
  }

  function snapshotMetadata(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
    const details = meta.meta && typeof meta.meta === 'object' && !Array.isArray(meta.meta)
      ? { ...meta.meta }
      : {}
    for (const [key, value] of Object.entries(meta)) {
      if (!['quality', 'timestamp', 'meta', 'revision', 'sourceId', 'data'].includes(key)) details[key] = value
    }
    return cloneSnapshotValue(details)
  }

  function notifySnapshot(snapshot) {
    for (const [listener, listenerOptions] of snapshotListeners) {
      try { listener(listenerOptions.shared ? snapshot : cloneSnapshotValue(snapshot)) } catch {}
    }
  }

  function commitSourceSnapshot(source, data, meta = {}, {
    publish = true,
    takeOwnership = false,
    sharedResult = false
  } = {}) {
    const sourceId = source.id
    const revision = (snapshotRevisionBySource.get(sourceId) || 0) + 1
    const fallbackQuality = source.enabled && source.status === 'online' ? 'good' : 'offline'
    const snapshot = Object.freeze({
      sourceId,
      revision,
      timestamp: normalizeDate(meta?.timestamp, now()),
      quality: normalizedSnapshotQuality(meta?.quality, fallbackQuality),
      // 真实采集适配器可移交刚解析出的 JSON 所有权，避免大响应再深拷贝一次。
      data: takeOwnership ? data : cloneSnapshotValue(data),
      meta: Object.freeze(snapshotMetadata(meta))
    })
    snapshotRevisionBySource.set(sourceId, revision)
    sourceSnapshots.set(sourceId, snapshot)
    if (publish) notifySnapshot(snapshot)
    return sharedResult ? snapshot : cloneSnapshotValue(snapshot)
  }

  function seedSourceSnapshots(sourceList, { publish = false, reset = false } = {}) {
    if (reset) {
      sourceSnapshots.clear()
    }
    for (const source of sourceList) {
      commitSourceSnapshot(source, sampleDataForSource(source), {
        timestamp: source.lastResponse?.at,
        quality: source.enabled && source.status === 'online' ? 'good' : 'offline',
        origin: 'local-sample',
        protocol: source.protocol,
        sourceName: source.name
      }, { publish, sharedResult: true })
    }
  }

  rebuildCatalogIndexes()
  seedSourceSnapshots(sources)

  function assertWorkspaceWritable() {
    if (workspaceCorruption) throw workspaceCorruption
  }

  function advanceCatalogRevision() {
    catalogRevision = catalogRevision >= Number.MAX_SAFE_INTEGER ? 1 : catalogRevision + 1
  }

  function quarantineCorruptWorkspace(workspaceId, error) {
    const validSources = []
    for (const source of Array.isArray(error?.validSources) ? error.validSources : []) {
      try {
        const normalized = normalizeSource(source, now())
        assertUniqueSourceIds([...validSources, normalized])
        assertUniquePointIds([...validSources, normalized])
        validSources.push(normalized)
      } catch {
        // 损坏快照中的无效条目不进入隔离目录，避免继续暴露上一工作空间的数据。
      }
    }
    activeWorkspaceId = workspaceId
    recoveredOfflinePointSourceIds.clear()
    sources = validSources
    rebuildCatalogIndexes()
    seedSourceSnapshots(sources, { reset: true })
    workspaceLoaded = true
    workspaceCorruption = error
    lastPersistence = normalizePersistenceResult({ durable: false, reason: 'storage-corrupt' })
    emit('workspace-activation-failed', null, null, { catalogChanged: false })
  }

  function findSource(id) {
    return sourceIndex.get(String(id)) || null
  }

  function emit(type, source, previousAvailableIds = null, options = {}) {
    if (!listeners.size) return
    const catalogChanged = options.catalogChanged !== false
    const includePointIds = catalogChanged && options.includePointIds !== false
    const previousIds = previousAvailableIds || (includePointIds ? availablePointIdSet(sources, recoveredOfflinePointSourceIds) : new Set())
    const nextAvailableIds = includePointIds ? availablePointIdSet(sources, recoveredOfflinePointSourceIds) : new Set()
    const changedSourceIds = Array.isArray(options.changedSourceIds)
      ? options.changedSourceIds.map(id => String(id)).filter(Boolean)
      : []
    const event = Object.freeze({
      type,
      workspaceId: activeWorkspaceId,
      sourceId: source?.id || '',
      // 事件只携带连接元数据；完整点位由分页或目录接口读取，避免一次变更额外复制大目录。
      source: source ? sourceMetadataResult(source, lastPersistence) : null,
      catalogChanged,
      pointIdsOmitted: catalogChanged && !includePointIds,
      changedSourceIds: Object.freeze(changedSourceIds),
      invalidatedPointIds: Object.freeze([...previousIds].filter(id => !nextAvailableIds.has(id))),
      availablePointIds: Object.freeze([...nextAvailableIds])
    })
    for (const listener of listeners) {
      try { listener(event) } catch {}
    }
  }

  function candidateWithReplacement(current, next, validatePointIds = true) {
    const index = sources.indexOf(current)
    const candidate = [...sources]
    candidate[index] = next
    if (validatePointIds) assertUniquePointIds(candidate)
    return candidate
  }

  async function persist(candidate = sources, change = {}) {
    let result = null
    if (change.removedSourceId && store?.removeSource) {
      result = await store.removeSource(activeWorkspaceId, change.removedSourceId)
    } else if (change.source && store?.saveSource) {
      result = await store.saveSource(activeWorkspaceId, change.source, {
        pointsChanged: change.pointsChanged !== false
      })
    }
    if (result == null && store?.save) result = await store.save(activeWorkspaceId, candidate)
    lastPersistence = normalizePersistenceResult(
      result,
      store ? 'storage-write-failed' : 'storage-unavailable'
    )
    return lastPersistence
  }

  function serializeMutation(operation) {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.catch(() => {})
    return result
  }

  async function listSources() {
    return sources.map(source => sourceSummary(
      source,
      recoveredOfflinePointSourceIds.has(source.id)
        ? source.points.length
        : (healthyPointCountBySource.get(source.id) || 0)
    ))
  }

  async function getSource(id, resultOptions = {}) {
    const source = findSource(id)
    if (!source) return null
    return resultOptions.includePoints === false
      ? sourceMetadataResult(source, lastPersistence)
      : cloneValue(source)
  }

  /**
   * 快照只存在于当前 gateway 实例的内存中。默认返回独立副本；仅内部只读运行时
   * 可显式请求 shared，避免大响应在同一进程中被重复深拷贝。
   */
  async function getSourceSnapshot(id, resultOptions = {}) {
    const snapshot = sourceSnapshots.get(String(id))
    return snapshot ? (resultOptions.shared === true ? snapshot : cloneSnapshotValue(snapshot)) : null
  }

  function ingestSourceSnapshot(id, data, meta = {}, ingestOptions = {}) {
    const sourceId = String(id ?? '').trim()
    const source = findSource(sourceId)
    if (!source) throw new RangeError(`数据源不存在：${sourceId}`)
    // 收到新数据本身就是一次成功采集；停用连接仍强制保持离线。
    const quality = source.enabled
      ? normalizedSnapshotQuality(meta?.quality, 'good')
      : 'offline'
    // takeOwnership 会跳过大 JSON 深拷贝：调用方不得静默修改已移交的数据；复用同一
    // 引用时必须再次调用本方法生成新 revision，运行链路会按 generation 强制发布。
    return commitSourceSnapshot(source, data, { ...meta, quality }, {
      takeOwnership: ingestOptions.takeOwnership === true,
      sharedResult: ingestOptions.sharedResult === true
    })
  }

  function subscribeSnapshots(listener, listenerOptions = {}) {
    if (typeof listener !== 'function') return () => false
    snapshotListeners.set(listener, Object.freeze({ shared: listenerOptions.shared === true }))
    return () => snapshotListeners.delete(listener)
  }

  async function getPointsByIds(ids, options = {}) {
    if (ids == null) return []
    const sourceIds = typeof ids === 'string' ? [ids] : ids
    const includeUnavailable = options.includeUnavailable === true
    const result = []
    const visited = new Set()
    for (const rawId of sourceIds) {
      const id = String(rawId ?? '').trim()
      if (!id || visited.has(id)) continue
      visited.add(id)
      const indexed = pointIndex.get(id)
      if (!indexed) continue
      const source = sourceIndex.get(indexed.sourceId)
      if (!source || (!includeUnavailable && !pointCanPublish(indexed.point, source, recoveredOfflinePointSourceIds))) continue
      result.push({
        ...cloneValue(indexed.point),
        sourceId: source.id,
        sourceName: source.name,
        protocol: source.protocol
      })
    }
    return result
  }


  /**
   * 按固定扫描预算读取一个点位页。游标是本地实现细节，未来后台可用自己的不透明游标
   * 实现同一接口；调用方不需要持有或复制完整点位目录。
   */
  async function querySourcePoints(options = {}) {
    const sourceId = String(options.sourceId ?? '').trim()
    const source = findSource(sourceId)
    if (!source) throw new RangeError(`数据源不存在：${sourceId}`)
    const signal = options.signal
    abortPointQuery(signal)

    const query = String(options.query ?? '').trim().toLocaleLowerCase('zh-CN')
    const includeUnavailable = options.includeUnavailable === true
    const requestedLimit = Number(options.limit)
    const limit = Math.min(
      POINT_SOURCE_QUERY_MAX_PAGE_SIZE,
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.max(1, Math.floor(requestedLimit))
        : POINT_SOURCE_QUERY_PAGE_SIZE
    )
    const cursor = normalizedPointQueryCursor(options.cursor, catalogRevision, sourceId)
    const items = []
    let offset = Math.min(cursor.offset, source.points.length)
    let matched = cursor.matched
    let scanned = 0

    while (
      offset < source.points.length
      && items.length < limit
      && scanned < POINT_SOURCE_QUERY_SCAN_SIZE
    ) {
      abortPointQuery(signal)
      const point = source.points[offset]
      offset += 1
      scanned += 1
      if (!includeUnavailable && !pointCanPublish(point, source, recoveredOfflinePointSourceIds)) continue
      if (!pointMatchesQuery(point, source, query)) continue
      matched += 1
      items.push(cloneValue(point))
    }

    const done = offset >= source.points.length
    const nextCursor = done
      ? null
      : Object.freeze({ revision: catalogRevision, sourceId, offset, matched })
    return Object.freeze({
      items: Object.freeze(items),
      total: done ? matched : (query || !includeUnavailable ? null : source.points.length),
      nextCursor,
      hasMore: !done,
      done,
      scanned
    })
  }

  async function listPoints(filters = {}) {
    const sourceId = String(filters.sourceId || '')
    const protocol = filters.protocol ? normalizedProtocol(filters.protocol) : ''
    const status = String(filters.status || '')
    const includeUnavailable = filters.includeUnavailable === true
    return sources
      .filter(source => !sourceId || source.id === sourceId)
      .filter(source => !protocol || source.protocol === protocol)
      .flatMap(source => source.points
        .filter(point => includeUnavailable || pointCanPublish(point, source, recoveredOfflinePointSourceIds))
        .filter(point => !status || point.status === status)
        .map(point => ({
          ...cloneValue(point),
          sourceId: source.id,
          sourceName: source.name,
          protocol: source.protocol
        })))
  }

  async function searchPoints(query = '', filters = {}) {
    if (query && typeof query === 'object') {
      filters = query
      query = filters.query || ''
    }
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('zh-CN')
    const points = await listPoints(filters)
    if (!normalizedQuery) return points
    return points.filter(point => [point.id, point.name, point.group, point.sourceName, point.protocol]
      .some(value => String(value).toLocaleLowerCase('zh-CN').includes(normalizedQuery)))
  }

  async function updateSource(id, patch = {}, resultOptions = {}) {
    return serializeMutation(async () => {
      assertWorkspaceWritable()
      const current = findSource(id)
      if (!current) throw new RangeError(`数据源不存在：${id}`)
      const protocol = patch.protocol == null ? current.protocol : normalizedProtocol(patch.protocol)
      const protocolChanged = protocol !== current.protocol
      const configBase = protocol === current.protocol ? current.config : defaultConfig(protocol)
      const pointsChanged = patch.points !== undefined || protocolChanged
      const sourceInput = {
        ...current,
        ...patch,
        id: current.id,
        protocol,
        config: { ...configBase, ...(patch.config || {}) },
        points: pointsChanged ? (patch.points ?? current.points) : [],
        lastResponse: patch.lastResponse === undefined ? current.lastResponse : patch.lastResponse
      }
      const next = pointsChanged
        ? await normalizeSourceAsync(sourceInput)
        : normalizeSourceMetadata(sourceInput, now(), current.points)
      const configChanged = protocolChanged || !sourceConfigEquals(protocol, current.config, next.config)
      const enabledChanged = next.enabled !== current.enabled
      const requiresVerification = configChanged || (!current.enabled && next.enabled)
      if (!next.enabled || requiresVerification) next.status = 'offline'
      const publicationChanged = pointsChanged
        || configChanged
        || enabledChanged
        || next.status !== current.status
      const includePointIds = publicationChanged && includeDetailedPointIds(sources, [next])
      const previousAvailableIds = includePointIds ? availablePointIdSet(sources, recoveredOfflinePointSourceIds) : null
      const candidate = candidateWithReplacement(current, next, false)
      const preparedCandidate = pointsChanged ? await prepareNormalizedCatalog(candidate) : null
      const persistence = await persist(candidate, { source: next, pointsChanged })
      if (pointsChanged || configChanged) recoveredOfflinePointSourceIds.delete(current.id)
      if (preparedCandidate) installPreparedCatalog(preparedCandidate)
      else {
        sources = candidate
        rebuildCatalogIndexes({ pointsChanged: false })
      }
      if (publicationChanged) {
        const previousSnapshot = sourceSnapshots.get(current.id)
        const invalidatesPreviousData = configChanged || enabledChanged
        const nextSnapshotData = invalidatesPreviousData
          ? undefined
          : (pointsChanged ? sampleDataForSource(next) : (previousSnapshot?.data ?? sampleDataForSource(next)))
        const quality = invalidatesPreviousData
          ? (next.enabled && configChanged ? 'stale' : 'offline')
          : (next.enabled && next.status === 'online' ? 'good' : 'offline')
        commitSourceSnapshot(next, nextSnapshotData, {
          quality,
          origin: invalidatesPreviousData ? 'source-verification-required' : 'source-update',
          verificationRequired: requiresVerification,
          protocol: next.protocol,
          sourceName: next.name
        }, { sharedResult: true })
      }
      advanceCatalogRevision()
      emit('source-updated', next, previousAvailableIds, {
        catalogChanged: publicationChanged,
        includePointIds,
        changedSourceIds: [next.id]
      })
      return sourceResult(next, persistence, resultOptions.includePoints !== false)
    })
  }

  async function createSource(input = {}) {
    return serializeMutation(async () => {
      assertWorkspaceWritable()
      const protocol = normalizedProtocol(input.protocol || 'MQTT')
      let id = String(input.id || '').trim()
      if (!id) id = createGeneratedSourceId(protocol, cryptoProvider, candidateId => Boolean(findSource(candidateId)))
      else if (findSource(id)) throw new TypeError(`数据源 ID 重复：${id}`)
      const source = await normalizeSourceAsync({
        id,
        name: input.name || `新建 ${protocol} 连接`,
        protocol,
        enabled: input.enabled !== false,
        status: 'offline',
        config: { ...defaultConfig(protocol), ...(input.config || {}) },
        points: input.points || [],
        lastResponse: null
      })
      const candidate = [...sources, source]
      const preparedCandidate = await prepareNormalizedCatalog(candidate)
      const persistence = await persist(candidate, { source, pointsChanged: true })
      installPreparedCatalog(preparedCandidate)
      advanceCatalogRevision()
      emit('source-created', source, null, {
        catalogChanged: sourceCanPublish(source) && source.points.length > 0,
        includePointIds: includeDetailedPointIds(candidate),
        changedSourceIds: [source.id]
      })
      return sourceResult(source, persistence)
    })
  }

  async function removeSource(id) {
    return serializeMutation(async () => {
      assertWorkspaceWritable()
      const source = findSource(id)
      if (!source) return false
      const includePointIds = includeDetailedPointIds(sources)
      const previousAvailableIds = includePointIds
        ? availablePointIdSet([source], recoveredOfflinePointSourceIds)
        : null
      const candidate = sources.filter(item => item !== source)
      const preparedCandidate = await prepareNormalizedCatalog(candidate)
      const persistence = await persist(candidate, { removedSourceId: source.id })
      recoveredOfflinePointSourceIds.delete(source.id)
      installPreparedCatalog(preparedCandidate)
      commitSourceSnapshot(source, undefined, {
        quality: 'bad',
        origin: 'source-removed',
        removed: true,
        protocol: source.protocol,
        sourceName: source.name
      }, { sharedResult: true })
      sourceSnapshots.delete(source.id)
      advanceCatalogRevision()
      emit('source-removed', source, previousAvailableIds, {
        includePointIds,
        changedSourceIds: [source.id]
      })
      return { removed: true, persistence }
    })
  }

  async function testSource(id, resultOptions = {}) {
    return serializeMutation(async () => {
      assertWorkspaceWritable()
      const current = findSource(id)
      if (!current) throw new RangeError(`数据源不存在：${id}`)
      const testingSource = normalizeSourceMetadata({ ...current, status: 'testing' }, now(), current.points)
      const currentSnapshot = sourceSnapshots.get(testingSource.id)
      const currentSnapshotRevision = currentSnapshot?.revision ?? 0
      const testData = currentSnapshot?.data ?? sampleDataForSource(testingSource)
      sources = candidateWithReplacement(current, testingSource, false)
      rebuildCatalogIndexes({ pointsChanged: false })
      advanceCatalogRevision()
      emit('source-testing', testingSource, null, {
        catalogChanged: false,
        includePointIds: false,
        changedSourceIds: [testingSource.id]
      })
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      else await Promise.resolve()

      const errors = configErrors(testingSource)
      const testedAt = now()
      const ok = errors.length === 0
      const durationMs = ok ? 12 + (testingSource.id.length % 37) : 0
      const response = {
        ok,
        at: new Date(testedAt).toISOString(),
        durationMs,
        message: ok ? '连接成功，数据测试正常' : errors.join('；'),
        preview: ''
      }
      const nextStatus = !testingSource.enabled ? 'offline' : (ok ? 'online' : 'error')
      const next = normalizeSourceMetadata({
        ...testingSource,
        status: nextStatus,
        lastResponse: response,
        points: []
      }, testedAt, testingSource.points)
      const candidate = candidateWithReplacement(testingSource, next, false)
      const persistence = await persist(candidate, { source: next, pointsChanged: false })
      const recoversLegacyOfflinePoints = ok
        && next.enabled
        && current.status === 'error'
        && current.lastResponse?.ok === false
        && current.points.length > 0
        && offlinePointCountBySource.get(current.id) === current.points.length
      if (recoversLegacyOfflinePoints) recoveredOfflinePointSourceIds.add(current.id)
      else if (!ok || !next.enabled) recoveredOfflinePointSourceIds.delete(current.id)
      sources = candidate
      rebuildCatalogIndexes({ pointsChanged: false })
      advanceCatalogRevision()
      const latestSnapshot = sourceSnapshots.get(next.id)
      const receivedSnapshotDuringTest = (latestSnapshot?.revision ?? 0) > currentSnapshotRevision
      // A successful connection test must not overwrite fresher adapter data that arrived while it was running.
      if (!receivedSnapshotDuringTest || !ok || !next.enabled) {
        commitSourceSnapshot(next, receivedSnapshotDuringTest ? latestSnapshot.data : testData, {
          timestamp: response.at,
          quality: next.enabled ? (ok ? 'good' : 'error') : 'offline',
          origin: 'connection-test',
          protocol: next.protocol,
          sourceName: next.name,
          durationMs
        }, { takeOwnership: true, sharedResult: true })
      }
      const publicationChanged = current.points.length > 0
        && sourceCanPublish(current) !== sourceCanPublish(next)
      emit('source-tested', next, null, {
        catalogChanged: publicationChanged,
        includePointIds: false,
        changedSourceIds: [next.id]
      })
      return {
        ok,
        response: cloneValue(next.lastResponse),
        source: sourceResult(next, persistence, resultOptions.includePoints !== false),
        persistence
      }
    })
  }

  async function activateWorkspace(workspaceId) {
    return serializeMutation(async () => {
      const nextWorkspaceId = requiredWorkspaceId(workspaceId)
      if (workspaceLoaded && !workspaceCorruption && nextWorkspaceId === activeWorkspaceId) {
        return { workspaceId: activeWorkspaceId, sources: await listSources(), persistence: lastPersistence }
      }
      let persisted = null
      try {
        persisted = store?.load ? await store.load(nextWorkspaceId) : null
      } catch (error) {
        if (isStorageCorruption(error)) quarantineCorruptWorkspace(nextWorkspaceId, error)
        throw error
      }
      const sourceInput = persisted == null ? createInitialSources() : persisted
      const prepared = await catalogPreparer.prepare(Array.isArray(sourceInput) ? sourceInput : [])
      const nextSources = prepared.sources
      const changedSourceIds = [...new Set([
        ...sources.map(source => source.id),
        ...nextSources.map(source => source.id)
      ])]
      if (persisted == null && store?.save) {
        lastPersistence = normalizePersistenceResult(await store.save(nextWorkspaceId, nextSources), 'storage-write-failed')
      } else {
        lastPersistence = normalizePersistenceResult(
          store?.getPersistenceStatus?.(nextWorkspaceId),
          store ? 'persistence-status-unknown' : 'storage-unavailable'
        )
      }
      activeWorkspaceId = nextWorkspaceId
      recoveredOfflinePointSourceIds.clear()
      installPreparedCatalog(prepared)
      seedSourceSnapshots(sources, { publish: true, reset: true })
      workspaceLoaded = true
      workspaceCorruption = null
      advanceCatalogRevision()
      emit('workspace-activated', null, null, {
        catalogChanged: true,
        includePointIds: false,
        changedSourceIds
      })
      return { workspaceId: activeWorkspaceId, sources: await listSources(), persistence: lastPersistence }
    })
  }

  async function refresh() {
    return serializeMutation(async () => {
      if (!store?.load) return { workspaceId: activeWorkspaceId, sources: await listSources(), persistence: lastPersistence }
      let persisted = null
      try {
        persisted = await store.load(activeWorkspaceId)
      } catch (error) {
        if (isStorageCorruption(error)) quarantineCorruptWorkspace(activeWorkspaceId, error)
        throw error
      }
      if (persisted == null) return { workspaceId: activeWorkspaceId, sources: await listSources(), persistence: lastPersistence }
      const prepared = await catalogPreparer.prepare(persisted)
      const changedSourceIds = [...new Set([
        ...sources.map(source => source.id),
        ...prepared.sources.map(source => source.id)
      ])]
      recoveredOfflinePointSourceIds.clear()
      installPreparedCatalog(prepared)
      seedSourceSnapshots(sources, { publish: true, reset: true })
      workspaceCorruption = null
      advanceCatalogRevision()
      lastPersistence = normalizePersistenceResult(
        store?.getPersistenceStatus?.(activeWorkspaceId),
        store ? 'persistence-status-unknown' : 'storage-unavailable'
      )
      emit('catalog-refreshed', null, null, {
        catalogChanged: true,
        includePointIds: false,
        changedSourceIds
      })
      return { workspaceId: activeWorkspaceId, sources: await listSources(), persistence: lastPersistence }
    })
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => false
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return Object.freeze({
    listSources,
    getSource,
    getSourceSnapshot,
    ingestSourceSnapshot,
    subscribeSnapshots,
    querySourcePoints,
    getPointsByIds,
    listPoints,
    searchPoints,
    updateSource,
    createSource,
    removeSource,
    testSource,
    activateWorkspace,
    refresh,
    subscribe,
    getPersistenceStatus() { return lastPersistence },
    dispose() {
      catalogPreparer.dispose()
      listeners.clear()
      snapshotListeners.clear()
      sourceSnapshots.clear()
    },
    get activeWorkspaceId() { return activeWorkspaceId }
  })
}
