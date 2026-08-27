import {
  bindingStaticValue,
  getBindableParameter,
  isBindingTargetAllowed
} from '../config/componentBindingSchema.js'
import {
  canonicalizeJsonPath,
  sourceBindingDescriptor
} from '../utils/jsonPathBinding.js'

export const MAX_NODE_DATA_BINDINGS = 64
export const MAX_BINDING_POINT_ID_LENGTH = 1024
export const MAX_BINDING_SOURCE_ID_LENGTH = 256
export const MAX_BINDING_JSON_PATH_LENGTH = 2048
export const MAX_BINDING_TEMPLATE_LENGTH = 1024
export const MAX_BINDING_SEPARATOR_LENGTH = 64
export const MAX_BINDING_TEXT_ARRAY_ITEMS = 64
export const MAX_RUNTIME_TABLE_COLUMNS = 12
export const MAX_RUNTIME_TABLE_ROWS = 50
export const MAX_RUNTIME_TABLE_CELL_DEPTH = 4
export const MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS = 12
export const MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS = 12
export const MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES = 48
export const MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH = 256

const ADAPTER_TYPES_BY_VALUE_TYPE = Object.freeze({
  color: new Set(['direct', 'first']),
  number: new Set(['direct', 'first']),
  boolean: new Set(['direct', 'first']),
  text: new Set(['direct', 'first', 'join', 'template']),
  table: new Set(['direct']),
  'text-list': new Set(['direct']),
  'table-rows': new Set(['direct'])
})

const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function normalizedText(value, maximum = Number.MAX_SAFE_INTEGER) {
  return String(value ?? '').trim().slice(0, maximum)
}

function adapterType(adapter) {
  if (typeof adapter === 'string') return adapter.trim()
  return plainObject(adapter) ? String(adapter.type ?? '').trim() : ''
}

export function isSupportedBindingAdapter(adapter, valueType) {
  if (adapter == null) return true
  if (!plainObject(adapter)) return false
  const type = adapterType(adapter)
  if (!ADAPTER_TYPES_BY_VALUE_TYPE[valueType]?.has(type)) return false
  if (type === 'join') {
    return (adapter.separator == null || (typeof adapter.separator === 'string' && adapter.separator.length <= MAX_BINDING_SEPARATOR_LENGTH))
  }
  if (type === 'template') {
    return typeof adapter.template === 'string'
      && adapter.template.length <= MAX_BINDING_TEMPLATE_LENGTH
      && (adapter.separator == null || (typeof adapter.separator === 'string' && adapter.separator.length <= MAX_BINDING_SEPARATOR_LENGTH))
  }
  return true
}

export function normalizeBindingAdapter(adapter, valueType) {
  if (adapter == null) return undefined
  const type = adapterType(adapter)
  if (!ADAPTER_TYPES_BY_VALUE_TYPE[valueType]?.has(type)) return undefined
  if (type === 'join') {
    const separator = typeof adapter?.separator === 'string'
      ? adapter.separator.slice(0, MAX_BINDING_SEPARATOR_LENGTH)
      : ','
    return { type, separator }
  }
  if (type === 'template') {
    if (typeof adapter?.template !== 'string') return undefined
    return {
      type,
      template: adapter.template.slice(0, MAX_BINDING_TEMPLATE_LENGTH),
      separator: typeof adapter.separator === 'string'
        ? adapter.separator.slice(0, MAX_BINDING_SEPARATOR_LENGTH)
        : ','
    }
  }
  return { type }
}

function normalizeDataBinding(source, nodeType) {
  if (!plainObject(source)) return null
  const target = normalizedText(source.target, 128)
  const definition = getBindableParameter(nodeType, target)
  if (!target || !definition) return null

  const sourceId = String(source.sourceId ?? '').trim()
  const rawJsonPath = String(source.jsonPath ?? source.path ?? '').trim()
  const pointId = String(source.pointId ?? '').trim()
  let bindingIdentity
  if (sourceId || rawJsonPath) {
    if (
      !sourceId
      || sourceId.length > MAX_BINDING_SOURCE_ID_LENGTH
      || !rawJsonPath
      || rawJsonPath.length > MAX_BINDING_JSON_PATH_LENGTH
    ) return null
    try {
      bindingIdentity = { sourceId, jsonPath: canonicalizeJsonPath(rawJsonPath) }
    } catch {
      return null
    }
  } else {
    if (!pointId || pointId.length > MAX_BINDING_POINT_ID_LENGTH) return null
    bindingIdentity = { pointId }
  }

  const adapter = normalizeBindingAdapter(source.adapter, definition.valueType)
  if (source.adapter != null && !adapter) return null
  return {
    target,
    ...bindingIdentity,
    ...(adapter ? { adapter } : {}),
    enabled: source.enabled !== false
  }
}

/**
 * 接受节点或绑定数组，返回独立、受白名单约束的规范数组。
 * 重复 target 使用最后一项，保持该 target 第一次出现时的位置。
 */
export function normalizeDataBindings(nodeOrBindings, nodeType) {
  const source = Array.isArray(nodeOrBindings) ? nodeOrBindings : nodeOrBindings?.dataBindings
  const type = nodeType ?? (Array.isArray(nodeOrBindings) ? '' : nodeOrBindings?.type)
  if (!Array.isArray(source)) return []

  const bindingsByTarget = new Map()
  for (const item of source.slice(0, MAX_NODE_DATA_BINDINGS)) {
    const binding = normalizeDataBinding(item, type)
    if (binding) bindingsByTarget.set(binding.target, binding)
  }
  return [...bindingsByTarget.values()]
}

export function findDataBinding(node, target) {
  const normalizedTarget = normalizedText(target, 128)
  if (!normalizedTarget || !Array.isArray(node?.dataBindings)) return undefined
  return node.dataBindings.find(item => normalizedText(item?.target, 128) === normalizedTarget)
}

export const findBinding = findDataBinding

/** 新绑定使用数据源和 JSONPath 生成稳定运行键；旧图纸继续直接使用 pointId。 */
export function bindingRuntimeKey(binding) {
  if (!binding) return ''
  const sourceBinding = sourceBindingDescriptor(binding)
  if (sourceBinding) return sourceBinding.runtimeKey
  return normalizedText(binding.pointId, MAX_BINDING_POINT_ID_LENGTH)
}

export function bindingSourceIds(node, { enabledOnly = true } = {}) {
  const sourceIds = new Set()
  for (const binding of Array.isArray(node?.dataBindings) ? node.dataBindings : []) {
    if (enabledOnly && binding?.enabled === false) continue
    const sourceId = normalizedText(binding?.sourceId, MAX_BINDING_SOURCE_ID_LENGTH)
    if (sourceId) sourceIds.add(sourceId)
  }
  return [...sourceIds]
}

export function bindingPointIds(node, { enabledOnly = true, includeLegacy = false } = {}) {
  const runtimeKeys = new Set()
  if (includeLegacy) {
    const legacyKey = normalizedText(node?.dataKey, MAX_BINDING_POINT_ID_LENGTH)
    if (legacyKey) runtimeKeys.add(legacyKey)
  }
  for (const binding of Array.isArray(node?.dataBindings) ? node.dataBindings : []) {
    if (enabledOnly && binding?.enabled === false) continue
    const runtimeKey = bindingRuntimeKey(binding)
    if (runtimeKey) runtimeKeys.add(runtimeKey)
  }
  return [...runtimeKeys]
}

function upsertArguments(targetOrBinding, pointId, adapter) {
  if (plainObject(targetOrBinding)) return targetOrBinding
  return { target: targetOrBinding, pointId, ...(adapter == null ? {} : { adapter }) }
}

/** 返回新数组；调用方决定何时写回节点并记录撤销历史。 */
export function upsertDataBinding(node, targetOrBinding, pointId, adapter) {
  const binding = normalizeDataBinding(upsertArguments(targetOrBinding, pointId, adapter), node?.type)
  if (!binding) throw new TypeError('invalid component data binding')
  const current = normalizeDataBindings(node)
  const index = current.findIndex(item => item.target === binding.target)
  if (index >= 0) return current.map((item, itemIndex) => itemIndex === index ? binding : item)
  if (current.length >= MAX_NODE_DATA_BINDINGS) throw new RangeError(`a node supports at most ${MAX_NODE_DATA_BINDINGS} data bindings`)
  return [...current, binding]
}

export function removeDataBinding(node, target) {
  const normalizedTarget = normalizedText(target, 128)
  return normalizeDataBindings(node).filter(item => item.target !== normalizedTarget)
}

function cloneStructuredValue(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) {
    const clone = []
    seen.set(value, clone)
    for (const item of value) clone.push(cloneStructuredValue(item, seen))
    return clone
  }
  if (!plainObject(value)) return value
  const clone = {}
  seen.set(value, clone)
  for (const key of Object.keys(value)) {
    if (!UNSAFE_RECORD_KEYS.has(key)) clone[key] = cloneStructuredValue(value[key], seen)
  }
  return clone
}

const RUNTIME_TABLE_CELL_TRUNCATED = '[Truncated]'
const RUNTIME_TABLE_CELL_THROWN = '[Thrown]'
const RUNTIME_TABLE_CELL_UNFORMATTABLE = '[Unformattable]'
const RUNTIME_TABLE_CELL_CIRCULAR = '[Circular]'

function runtimeTableScalar(value) {
  if (typeof value === 'string') {
    return value.length <= MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH
      ? value
      : `${value.slice(0, MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH - 3)}...`
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  if (value === undefined) return '[Undefined]'
  return value
}

function runtimeTableArrayLength(value) {
  try {
    const length = Number(value.length)
    if (!Number.isFinite(length)) return 0
    return Math.min(0xFFFFFFFF, Math.max(0, Math.floor(length)))
  } catch {
    return 0
  }
}

/**
 * 动态表格的单元格可能直接承载协议返回的大对象，因此每个单元格独立使用固定遍历预算。
 * 保留简单对象的结构和循环关系，超出预算或读取失败的部分使用可显示的占位值代替。
 */
export function cloneRuntimeTableCellValue(value, depth = 0, state = {
  seen: new WeakMap(),
  totalEntries: 0
}) {
  if (value === null || typeof value !== 'object') return runtimeTableScalar(value)

  try {
    // 点位数据最终需要保存为 JSON；重复引用和循环引用都使用稳定占位符断开。
    if (state.seen.has(value)) return RUNTIME_TABLE_CELL_CIRCULAR
  } catch {
    return RUNTIME_TABLE_CELL_UNFORMATTABLE
  }
  if (depth >= MAX_RUNTIME_TABLE_CELL_DEPTH) return RUNTIME_TABLE_CELL_TRUNCATED

  let isArray = false
  try {
    isArray = Array.isArray(value)
  } catch {
    return RUNTIME_TABLE_CELL_UNFORMATTABLE
  }

  if (isArray) {
    const clone = []
    state.seen.set(value, clone)
    const sourceLength = runtimeTableArrayLength(value)
    const itemLimit = Math.min(sourceLength, MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS)
    const sourceItemLimit = sourceLength > itemLimit ? Math.max(0, itemLimit - 1) : itemLimit
    let index = 0
    for (; index < sourceItemLimit; index += 1) {
      if (state.totalEntries >= MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES) break
      state.totalEntries += 1
      try {
        clone[index] = cloneRuntimeTableCellValue(value[index], depth + 1, state)
      } catch {
        clone[index] = RUNTIME_TABLE_CELL_THROWN
      }
    }
    if (sourceLength > index && clone.length < MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS) clone.push(RUNTIME_TABLE_CELL_TRUNCATED)
    return clone
  }

  try {
    if (value instanceof Date) return new Date(Date.prototype.getTime.call(value))
  } catch {
    return RUNTIME_TABLE_CELL_UNFORMATTABLE
  }

  let isRecord = false
  try {
    isRecord = plainObject(value)
  } catch {
    return RUNTIME_TABLE_CELL_UNFORMATTABLE
  }
  if (!isRecord) return RUNTIME_TABLE_CELL_UNFORMATTABLE

  const clone = {}
  state.seen.set(value, clone)
  let clonedKeys = 0
  let scannedKeys = 0
  const scanLimit = MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS * 2 + 4
  try {
    for (const key in value) {
      scannedKeys += 1
      if (scannedKeys > scanLimit) break
      if (!Object.prototype.hasOwnProperty.call(value, key) || UNSAFE_RECORD_KEYS.has(key)) continue
      if (
        clonedKeys >= MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS
        || state.totalEntries >= MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES
      ) break

      state.totalEntries += 1
      clonedKeys += 1
      try {
        clone[key] = cloneRuntimeTableCellValue(value[key], depth + 1, state)
      } catch {
        clone[key] = RUNTIME_TABLE_CELL_THROWN
      }
    }
  } catch {
    // Proxy 枚举失败时保留已安全复制的字段。
  }
  return clone
}

function scalarText(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return null
}

function boundedScalarArray(value, maximum = MAX_BINDING_TEXT_ARRAY_ITEMS) {
  let isArray = false
  try {
    isArray = Array.isArray(value)
  } catch {
    return null
  }
  if (!isArray) return null

  let length = 0
  try {
    const parsedLength = Number(value.length)
    if (!Number.isFinite(parsedLength)) return null
    length = Math.min(Math.max(0, Math.floor(parsedLength)), maximum)
  } catch {
    return null
  }

  const items = []
  for (let index = 0; index < length; index += 1) {
    let item
    try {
      item = scalarText(value[index])
    } catch {
      return null
    }
    if (item == null) return null
    items.push(item)
  }
  return items
}

function textFromValue(value, adapter) {
  const type = adapter?.type || 'direct'
  if (type === 'first') {
    const items = boundedScalarArray(value, 1)
    return items?.[0] ?? null
  }
  if (type === 'join') {
    const items = boundedScalarArray(value)
    return items == null ? null : items.join(adapter.separator)
  }
  if (type === 'template') {
    const arrayItems = boundedScalarArray(value)
    const scalar = arrayItems == null ? scalarText(value) : null
    if (arrayItems == null && scalar == null) return null
    const renderedValue = arrayItems == null ? scalar : arrayItems.join(adapter.separator)
    return adapter.template.replace(/\{\{value\}\}|\{value\}/g, renderedValue)
  }
  return scalarText(value)
}

function firstAdaptedValue(value, adapter) {
  if (adapter?.type !== 'first') return { valid: true, value }
  return Array.isArray(value) && value.length
    ? { valid: true, value: value[0] }
    : { valid: false, value: undefined }
}

const STATUS_COLOR_MAP = Object.freeze({
  warning: '#f59e0b',
  alarm: '#ef4444',
  error: '#ef4444',
  danger: '#ef4444',
  normal: '#16a085',
  run: '#16a085',
  good: '#16a085',
  online: '#16a085',
  offline: '#9ca3af'
})
const SAFE_NAMED_COLORS = new Set([
  'black', 'silver', 'gray', 'white', 'maroon', 'red', 'purple', 'fuchsia',
  'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'orange',
  'transparent'
])

function colorFromValue(value) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (/^#[\da-f]{3,4}(?:[\da-f]{3,4})?$/i.test(color)) return color
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(color)) return color
  const normalized = color.toLowerCase()
  if (STATUS_COLOR_MAP[normalized]) return STATUS_COLOR_MAP[normalized]
  if (SAFE_NAMED_COLORS.has(normalized)) return normalized
  return null
}

function numberFromValue(value, definition) {
  if ((typeof value === 'string' && !value.trim()) || typeof value === 'boolean' || value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(definition.max ?? number, Math.max(definition.min ?? number, number))
}

function booleanFromValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on', '开启', '打开', '选中'].includes(normalized)) return true
  if (['false', '0', 'no', 'off', '关闭', '未选中'].includes(normalized)) return false
  return null
}

function boundedRecordKeys(value) {
  if (!plainObject(value)) return []
  const keys = []
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || UNSAFE_RECORD_KEYS.has(key)) continue
    keys.push(key)
    if (keys.length >= MAX_RUNTIME_TABLE_COLUMNS) break
  }
  return keys
}

function uniqueColumnKey(rawKey, index, usedKeys) {
  const fallback = `column${index + 1}`
  const base = normalizedText(rawKey, 128) || fallback
  let key = UNSAFE_RECORD_KEYS.has(base) ? fallback : base
  let suffix = 2
  while (usedKeys.has(key)) key = `${base}_${suffix++}`
  usedKeys.add(key)
  return key
}

function normalizeTableColumns(sourceColumns, sourceRows) {
  // 在列推断前先执行硬上限，避免超宽数据生成无意义的大型中间数组。
  const provided = Array.isArray(sourceColumns)
    ? Array.prototype.slice.call(sourceColumns, 0, MAX_RUNTIME_TABLE_COLUMNS)
    : []
  let rawColumns = provided
  if (!rawColumns.length) {
    const objectKeys = []
    const seenKeys = new Set()
    let arrayWidth = 0
    let hasScalar = false
    for (const row of sourceRows) {
      if (Array.isArray(row)) arrayWidth = Math.min(MAX_RUNTIME_TABLE_COLUMNS, Math.max(arrayWidth, row.length))
      else if (plainObject(row)) {
        for (const key of boundedRecordKeys(row)) {
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            objectKeys.push(key)
            if (objectKeys.length >= MAX_RUNTIME_TABLE_COLUMNS) break
          }
        }
      } else hasScalar = true
      if (objectKeys.length >= MAX_RUNTIME_TABLE_COLUMNS) break
    }
    if (objectKeys.length) rawColumns = objectKeys
    else if (arrayWidth) rawColumns = Array.from({ length: arrayWidth }, (_, index) => ({ key: `column${index + 1}`, title: `列 ${index + 1}` }))
    else if (hasScalar) rawColumns = [{ key: 'value', title: '值' }]
  }

  const usedKeys = new Set()
  return rawColumns.map((column, index) => {
    const sourceKey = plainObject(column)
      ? normalizedText(column.key ?? column.id ?? column.name, 128)
      : normalizedText(column, 128)
    const key = uniqueColumnKey(sourceKey, index, usedKeys)
    const titleSource = plainObject(column)
      ? column.title ?? column.label ?? column.name ?? sourceKey
      : column
    return {
      key,
      title: String(titleSource ?? key),
      sourceKey: sourceKey || key
    }
  })
}

function tableHeadersFromValue(value) {
  try {
    if (!Array.isArray(value)) return null
    const sourceHeaders = Array.prototype.slice.call(value, 0, MAX_RUNTIME_TABLE_COLUMNS)
    const usedKeys = new Set()
    const headers = []
    for (let index = 0; index < sourceHeaders.length; index += 1) {
      const source = sourceHeaders[index]
      if (plainObject(source)) {
        const rawKey = normalizedText(source.key, 128)
        const title = scalarText(source.title ?? source.label ?? source.name ?? rawKey)
        if (title == null) return null
        headers.push({
          ...(rawKey ? { key: uniqueColumnKey(rawKey, index, usedKeys) } : {}),
          title: title.slice(0, MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH)
        })
        continue
      }
      const title = scalarText(source)
      if (title == null) return null
      headers.push(title.slice(0, MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH))
    }
    return headers
  } catch {
    return null
  }
}

function tableRowsFromValue(value) {
  try {
    if (!Array.isArray(value)) return null
    const sourceRows = Array.prototype.slice.call(value, 0, MAX_RUNTIME_TABLE_ROWS)
    const rows = []
    let rowShape = ''
    for (const sourceRow of sourceRows) {
      if (Array.isArray(sourceRow)) {
        if (rowShape && rowShape !== 'array') return null
        rowShape = 'array'
        const boundedRow = Array.prototype.slice.call(sourceRow, 0, MAX_RUNTIME_TABLE_COLUMNS)
        rows.push(boundedRow.map(cell => cloneRuntimeTableCellValue(cell)))
        continue
      }
      if (plainObject(sourceRow)) {
        if (rowShape && rowShape !== 'object') return null
        rowShape = 'object'
        const row = {}
        for (const key of boundedRecordKeys(sourceRow)) {
          try {
            row[key] = cloneRuntimeTableCellValue(sourceRow[key])
          } catch {
            row[key] = RUNTIME_TABLE_CELL_THROWN
          }
        }
        rows.push(row)
        continue
      }
      return null
    }
    return rows
  } catch {
    return null
  }
}

function tableFromValue(value) {
  try {
    const dataset = plainObject(value) && Array.isArray(value.rows) ? value : null
    const sourceRows = dataset ? value.rows : Array.isArray(value) ? value : null
    if (!sourceRows) return null
    // 运行时表格最多渲染 50 行；必须先截断，后续推断、映射和深拷贝才保持常量级上限。
    const boundedRows = Array.prototype.slice.call(sourceRows, 0, MAX_RUNTIME_TABLE_ROWS)
    const columns = normalizeTableColumns(dataset?.columns, boundedRows)
    const rows = boundedRows.map(row => {
      const normalizedRow = {}
      columns.forEach((column, index) => {
        let cell
        if (Array.isArray(row)) cell = row[index]
        else if (plainObject(row)) cell = row[column.sourceKey]
        else if (index === 0) cell = row
        normalizedRow[column.key] = cloneRuntimeTableCellValue(cell)
      })
      return normalizedRow
    })
    return {
      ...(dataset?.datasetId == null ? {} : { datasetId: String(dataset.datasetId) }),
      columns: columns.map(({ key, title }) => ({ key, title })),
      rows
    }
  } catch {
    return null
  }
}

function fallbackValue(node, target) {
  const value = bindingStaticValue(node, target)
  const definition = getBindableParameter(node, target)
  if (definition?.valueType === 'table') return tableFromValue(value) ?? cloneStructuredValue(value)
  if (definition?.valueType === 'text-list') return tableHeadersFromValue(value) ?? cloneStructuredValue(value)
  if (definition?.valueType === 'table-rows') return tableRowsFromValue(value) ?? cloneStructuredValue(value)
  return cloneStructuredValue(value)
}

/** 将单个运行值转换为目标参数值，失败时返回节点的静态配置。 */
export function resolveBindingValue(node, target, runtimeValue, adapter) {
  const definition = getBindableParameter(node, target)
  if (!definition) return undefined
  const fallback = fallbackValue(node, target)
  if (runtimeValue === undefined || runtimeValue === null) return fallback

  const normalizedAdapter = normalizeBindingAdapter(adapter, definition.valueType)
  if (adapter != null && !normalizedAdapter) return fallback
  if (definition.valueType === 'text') return textFromValue(runtimeValue, normalizedAdapter) ?? fallback
  if (definition.valueType === 'table') return tableFromValue(runtimeValue) ?? fallback
  if (definition.valueType === 'text-list') return tableHeadersFromValue(runtimeValue) ?? fallback
  if (definition.valueType === 'table-rows') return tableRowsFromValue(runtimeValue) ?? fallback

  const selected = firstAdaptedValue(runtimeValue, normalizedAdapter)
  if (!selected.valid) return fallback
  if (definition.valueType === 'color') return colorFromValue(selected.value) ?? fallback
  if (definition.valueType === 'number') return numberFromValue(selected.value, definition) ?? fallback
  if (definition.valueType === 'boolean') return booleanFromValue(selected.value) ?? fallback
  return fallback
}

export function resolveNodeBindingValue(node, target, getPointValue) {
  const binding = findDataBinding(node, target)
  if (!binding || binding.enabled === false || typeof getPointValue !== 'function') {
    return resolveBindingValue(node, target, undefined)
  }
  try {
    const runtimeKey = bindingRuntimeKey(binding)
    return resolveBindingValue(node, target, runtimeKey ? getPointValue(runtimeKey) : undefined, binding.adapter)
  } catch {
    return resolveBindingValue(node, target, undefined)
  }
}

/**
 * 返回 target -> effectiveValue 覆盖对象。结果不包含未绑定或禁用参数，且不会写入节点。
 */
export function resolveNodeDataBindings(node, getPointValue) {
  const overrides = {}
  for (const binding of normalizeDataBindings(node)) {
    if (binding.enabled === false || !isBindingTargetAllowed(node, binding.target)) continue
    overrides[binding.target] = resolveNodeBindingValue(
      { ...node, dataBindings: [binding] },
      binding.target,
      getPointValue
    )
  }
  return overrides
}
