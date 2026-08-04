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
  'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua',
  'orange', 'transparent'
])

const BOOLEAN_TRUE_VALUES = new Set(['true', '1', 'yes', 'on', '开启', '打开', '选中'])
const BOOLEAN_FALSE_VALUES = new Set(['false', '0', 'no', 'off', '关闭', '未选中'])

const POINT_TYPE_ALIASES = Object.freeze({
  integer: 'number',
  int: 'number',
  float: 'number',
  double: 'number',
  decimal: 'number',
  bool: 'boolean',
  list: 'array',
  json: 'object'
})

const PARAMETER_TYPE_ALIASES = Object.freeze({
  percent: 'number',
  duration: 'number',
  chart: 'table',
  dataset: 'table'
})

export const POINT_RESULT_PAGE_SIZE = 50

export const PARAMETER_VALUE_TYPE_LABELS = Object.freeze({
  color: '颜色',
  number: '数值',
  boolean: '布尔',
  text: '文本',
  table: '表格数据'
})

export const POINT_VALUE_TYPE_LABELS = Object.freeze({
  string: '文本',
  number: '数值',
  boolean: '布尔',
  array: '数组',
  object: '对象',
  unknown: '未知'
})

function normalizedText(value) {
  return String(value ?? '').trim()
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key))
}

export function pointCurrentValue(point) {
  if (hasOwn(point, 'currentValue')) return point.currentValue
  return point?.value
}

function inferredPointType(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null || value === undefined) return 'unknown'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'object') return 'object'
  return 'unknown'
}

export function normalizePointValueType(point) {
  const raw = normalizedText(point?.type || point?.valueType || point?.dataType).toLowerCase()
  const explicit = POINT_TYPE_ALIASES[raw] || raw
  if (POINT_VALUE_TYPE_LABELS[explicit]) return explicit
  return inferredPointType(pointCurrentValue(point))
}

export function normalizeParameterValueType(parameter) {
  const raw = normalizedText(
    typeof parameter === 'string'
      ? parameter
      : parameter?.valueType || parameter?.targetType || parameter?.type
  ).toLowerCase()
  return PARAMETER_TYPE_ALIASES[raw] || raw
}

export function parameterValueTypeLabel(parameter) {
  const type = normalizeParameterValueType(parameter)
  return PARAMETER_VALUE_TYPE_LABELS[type] || type || '未知'
}

export function pointValueTypeLabel(point) {
  const type = normalizePointValueType(point)
  return POINT_VALUE_TYPE_LABELS[type] || type || '未知'
}

export function isMappableColorString(value) {
  if (typeof value !== 'string') return false
  const color = value.trim()
  if (!color) return false
  const normalized = color.toLowerCase()
  if (STATUS_COLOR_MAP[normalized] || SAFE_NAMED_COLORS.has(normalized)) return true
  if (/^#[\da-f]{3,4}(?:[\da-f]{3,4})?$/i.test(color)) return true
  return /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(color)
}

export function isSafeNumericString(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return false
  return Number.isFinite(Number(normalized))
}

export function isConvertibleBoolean(value) {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return BOOLEAN_TRUE_VALUES.has(normalized) || BOOLEAN_FALSE_VALUES.has(normalized)
}

function compatibilityResult(parameterType, pointType, compatible, reason = '') {
  return {
    compatible,
    parameterType,
    parameterTypeLabel: PARAMETER_VALUE_TYPE_LABELS[parameterType] || parameterType || '未知',
    pointType,
    pointTypeLabel: POINT_VALUE_TYPE_LABELS[pointType] || pointType || '未知',
    reason
  }
}

/**
 * 检查不带适配器的直接绑定。这里与运行时转换保持相同边界，避免连接成功后仍回退到静态值。
 */
export function directBindingCompatibility(parameter, point) {
  const parameterType = normalizeParameterValueType(parameter)
  const pointType = normalizePointValueType(point)
  const value = pointCurrentValue(point)
  const result = (compatible, reason) => compatibilityResult(parameterType, pointType, compatible, reason)

  if (!PARAMETER_VALUE_TYPE_LABELS[parameterType]) return result(false, '参数类型不支持直接绑定')
  if (pointType === 'unknown') return result(false, '点位类型未知')

  if (parameterType === 'table') {
    // 与 dataBindingModel.tableFromValue 保持同一数据形状，避免界面允许后运行时仍回退静态表格。
    let compatible = pointType === 'array' && Array.isArray(value)
    if (pointType === 'object') {
      try {
        compatible = Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.rows))
      } catch {
        compatible = false
      }
    }
    return compatible
      ? result(true)
      : result(false, '表格参数只接受数组或包含 rows 数组的对象点位')
  }

  if (parameterType === 'color') {
    return pointType === 'string' && isMappableColorString(value)
      ? result(true)
      : result(false, '颜色参数需要可识别的颜色或状态文本')
  }

  if (parameterType === 'number') {
    const compatible = pointType === 'number'
      ? (value == null || (typeof value === 'number' ? Number.isFinite(value) : isSafeNumericString(String(value))))
      : pointType === 'string' && isSafeNumericString(value)
    return compatible
      ? result(true)
      : result(false, '数值参数需要有限数值或安全的数字文本')
  }

  if (parameterType === 'text') {
    return ['string', 'number', 'boolean'].includes(pointType)
      ? result(true)
      : result(false, '文本参数只接受文本、数值或布尔点位')
  }

  if (parameterType === 'boolean') {
    const compatible = pointType === 'boolean'
      || (pointType === 'number' && (value == null || isConvertibleBoolean(value)))
      || (pointType === 'string' && isConvertibleBoolean(value))
    return compatible
      ? result(true)
      : result(false, '布尔参数需要布尔值、有限数值或开关状态文本')
  }

  return result(false, '点位与参数类型不兼容')
}

const POINT_STATUS = Object.freeze({
  good: { state: 'online', label: '在线' },
  online: { state: 'online', label: '在线' },
  normal: { state: 'online', label: '在线' },
  stale: { state: 'stale', label: '数据滞后' },
  bad: { state: 'error', label: '异常' },
  error: { state: 'error', label: '异常' },
  offline: { state: 'offline', label: '离线' },
  testing: { state: 'testing', label: '检测中' }
})

export function pointStatusInfo(point) {
  const status = normalizedText(point?.status || point?.quality).toLowerCase()
  if (POINT_STATUS[status]) return POINT_STATUS[status]
  if (['离线'].includes(status)) return POINT_STATUS.offline
  if (['异常'].includes(status)) return POINT_STATUS.error
  return { state: 'unknown', label: '状态未知' }
}

/** 未上报状态的旧点位保持可用；明确离线、滞后、异常或检测中的点位禁止新建绑定。 */
export function pointBindingAvailability(point) {
  const status = pointStatusInfo(point)
  const reasons = {
    stale: '点位数据已滞后，恢复更新后可绑定',
    error: '点位状态异常，恢复后可绑定',
    offline: '点位已离线，重新上线后可绑定',
    testing: '点位正在检测，完成后可绑定'
  }
  const reason = reasons[status.state] || ''
  return { ...status, available: !reason, reason }
}
