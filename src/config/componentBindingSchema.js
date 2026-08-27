const COMMON_GROUP = 'common'
const ANIMATION_GROUP = 'animation'
const DATA_GROUP = 'data'
const SIGNAL_GROUP = 'signal'
export const MAX_SIGNAL_COLORS = 8
export const ANIMATION_DURATION_MIN_SECONDS = 0.2
export const BUILT_IN_ANIMATION_DURATION_MAX_SECONDS = 5
export const CUSTOM_ANIMATION_DURATION_MAX_SECONDS = 20

const BUILT_IN_ANIMATION_TYPES = new Set([
  'flowDirection',
  'flowPipe',
  'rotatingFan',
  'signalLight',
  'waterTank',
  'heartbeat',
  'particles'
])

function parameter(target, label, valueType, group, readStatic, options = {}) {
  return Object.freeze({
    target,
    label,
    valueType,
    group,
    readStatic,
    value: readStatic,
    ...options
  })
}

const COMMON_PARAMETERS = Object.freeze([
  parameter('fill', '填充颜色', 'color', COMMON_GROUP, node => node?.fill),
  parameter('stroke', '边框颜色', 'color', COMMON_GROUP, node => node?.stroke),
  parameter('opacity', '透明度', 'number', COMMON_GROUP, node => node?.opacity, { min: 0, max: 1 }),
  parameter('text', '显示文字', 'text', COMMON_GROUP, node => node?.text),
  parameter('animationPlaying', '动效播放', 'boolean', ANIMATION_GROUP, node => node?.animationPaused !== true),
  parameter('animationDuration', '动画周期', 'number', ANIMATION_GROUP, node => node?.animationDuration, {
    min: ANIMATION_DURATION_MIN_SECONDS,
    max: CUSTOM_ANIMATION_DURATION_MAX_SECONDS
  })
])
const LEGACY_TABLE_TEXT_PARAMETER = Object.freeze({
  ...COMMON_PARAMETERS.find(item => item.target === 'text'),
  label: '旧版标题数据',
  legacy: true,
  visibleWhenBound: true
})
const BUILT_IN_ANIMATION_DURATION_PARAMETER = Object.freeze({
  ...COMMON_PARAMETERS.find(item => item.target === 'animationDuration'),
  max: BUILT_IN_ANIMATION_DURATION_MAX_SECONDS
})

// 这些组件的视觉实现不读取相应公共字段，通信页不展示无效绑定入口。
const EXCLUDED_TARGETS_BY_TYPE = Object.freeze({
  pencil: new Set(['fill', 'stroke', 'text']),
  polyline: new Set(['fill', 'text']),
  flowDirection: new Set(['fill', 'text']),
  flowPipe: new Set(['text']),
  rotatingFan: new Set(['text']),
  signalLight: new Set(['text']),
  waterTank: new Set(['text']),
  heartbeat: new Set(['text']),
  particles: new Set(['text'])
})

const CHECKED_PARAMETER = parameter('checked', '选中状态', 'boolean', DATA_GROUP, node => node?.checked)
const VALUE_PARAMETER = parameter('value', '组件值', 'text', DATA_GROUP, node => node?.value)
const PROGRESS_PARAMETER = parameter('progressValue', '进度数值', 'number', DATA_GROUP, node => node?.progressValue, { min: 0, max: 100 })
const VISUAL_PRIMARY_COLOR_PARAMETER = parameter('visualPrimaryColor', '主体颜色', 'color', COMMON_GROUP, node => node?.visualPrimaryColor)
const POLYLINE_COLOR_PARAMETER = parameter('polylineColor', '线条颜色', 'color', COMMON_GROUP, node => node?.polylineColor)
const TABLE_TITLE_PARAMETER = parameter('tableTitle', '标题数据', 'text', DATA_GROUP, node => node?.tableTitle ?? node?.text, {
  formatGuideKey: 'tableTitle',
  valueTypeLabel: '标题文本'
})
const TABLE_HEADERS_PARAMETER = parameter('tableHeaders', '表头数据', 'text-list', DATA_GROUP, node => (
  Array.isArray(node?.tableHeaders) ? node.tableHeaders : []
))
const TABLE_CELLS_PARAMETER = parameter('tableCells', '行表格数据', 'table-rows', DATA_GROUP, node => (
  Array.isArray(node?.tableCells) ? node.tableCells : []
))
const TABLE_PARAMETER = parameter('tableData', '旧版整表数据', 'table', DATA_GROUP, node => ({
  columns: (Array.isArray(node?.tableHeaders) ? node.tableHeaders : []).map((title, index) => ({
    key: `column${index + 1}`,
    title
  })),
  rows: Array.isArray(node?.tableCells) ? node.tableCells : []
}), { legacy: true, visibleWhenBound: true })
const CHART_PARAMETER = parameter('chartData', '图表数据', 'table', DATA_GROUP, node => node?.chartData ?? [])
const SIGNAL_COLOR_PARAMETERS = Object.freeze(Array.from(
  { length: MAX_SIGNAL_COLORS },
  (_, index) => parameter(
    `signalColors.${index}`,
    `颜色 ${index + 1}`,
    'color',
    SIGNAL_GROUP,
    node => node?.signalColors?.[index] ?? (index === 0 ? node?.signalColor : undefined),
    { signalColorIndex: index }
  )
))
const SIGNAL_OPACITY_PARAMETER = parameter(
  'signalOpacity',
  '灯光不透明度',
  'number',
  SIGNAL_GROUP,
  node => node?.signalOpacity,
  { min: 0, max: 1 }
)

const TYPE_PARAMETERS = Object.freeze({
  table: Object.freeze([
    TABLE_TITLE_PARAMETER,
    TABLE_HEADERS_PARAMETER,
    TABLE_CELLS_PARAMETER,
    TABLE_PARAMETER
  ]),
  checkbox: Object.freeze([CHECKED_PARAMETER]),
  radio: Object.freeze([CHECKED_PARAMETER]),
  switch: Object.freeze([CHECKED_PARAMETER]),
  button: Object.freeze([CHECKED_PARAMETER]),
  input: Object.freeze([VALUE_PARAMETER]),
  select: Object.freeze([VALUE_PARAMETER]),
  time: Object.freeze([VALUE_PARAMETER]),
  formProgress: Object.freeze([PROGRESS_PARAMETER]),
  progress: Object.freeze([PROGRESS_PARAMETER]),
  gauge: Object.freeze([PROGRESS_PARAMETER]),
  flowDirection: Object.freeze([POLYLINE_COLOR_PARAMETER]),
  flowPipe: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  rotatingFan: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  waterTank: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER, PROGRESS_PARAMETER]),
  heartbeat: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  particles: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  chart: Object.freeze([CHART_PARAMETER]),
  signalLight: Object.freeze([...SIGNAL_COLOR_PARAMETERS, SIGNAL_OPACITY_PARAMETER])
})

const PARAMETER_LIST_CACHE = new Map()

function componentType(nodeOrType) {
  return typeof nodeOrType === 'string' ? nodeOrType : String(nodeOrType?.type ?? '')
}

function parametersForType(type) {
  const normalizedType = String(type ?? '')
  let parameters = PARAMETER_LIST_CACHE.get(normalizedType)
  if (!parameters) {
    const excluded = EXCLUDED_TARGETS_BY_TYPE[normalizedType]
    const availableCommon = excluded
      ? COMMON_PARAMETERS.filter(item => !excluded.has(item.target))
      : COMMON_PARAMETERS
    const common = BUILT_IN_ANIMATION_TYPES.has(normalizedType)
      ? availableCommon.map(item => item.target === 'animationDuration'
          ? BUILT_IN_ANIMATION_DURATION_PARAMETER
          : item)
      : availableCommon
    const componentCommon = normalizedType === 'table'
      ? common.map(item => item.target === 'text' ? LEGACY_TABLE_TEXT_PARAMETER : item)
      : common
    parameters = Object.freeze([...componentCommon, ...(TYPE_PARAMETERS[normalizedType] || [])])
    PARAMETER_LIST_CACHE.set(normalizedType, parameters)
  }
  return parameters
}

function hasTargetBinding(node, target) {
  return Array.isArray(node?.dataBindings) && node.dataBindings.some(item => (
    String(item?.target ?? '').trim() === target
    && (
      String(item?.pointId ?? '').trim()
      || (
        String(item?.sourceId ?? '').trim()
        && String(item?.jsonPath ?? item?.path ?? '').trim()
      )
    )
  ))
}

function parameterIsVisible(nodeOrType, item) {
  if (!nodeOrType || typeof nodeOrType === 'string') return true
  if (item.visibleWhenBound) return hasTargetBinding(nodeOrType, item.target)
  if (Number.isInteger(item.signalColorIndex)) {
    if (hasTargetBinding(nodeOrType, item.target)) return true
    const configuredCount = Number(nodeOrType.signalColorCount)
    const paletteCount = Array.isArray(nodeOrType.signalColors) ? nodeOrType.signalColors.length : 0
    const visibleCount = Number.isFinite(configuredCount)
      ? Math.max(0, Math.min(MAX_SIGNAL_COLORS, Math.trunc(configuredCount)))
      : Math.min(MAX_SIGNAL_COLORS, paletteCount)
    return item.signalColorIndex < visibleCount
  }
  if (item.target !== 'text') return true
  if (componentType(nodeOrType) === 'table') return hasTargetBinding(nodeOrType, 'text')
  if (hasTargetBinding(nodeOrType, 'text')) return true
  return String(nodeOrType.text ?? '').trim().length > 0
}

/** 返回属性页和通信页共同使用的参数定义。 */
export function getBindableParameters(nodeOrType, category) {
  const parameters = parametersForType(componentType(nodeOrType))
    .filter(item => parameterIsVisible(nodeOrType, item))
  if (!category) return Object.freeze(parameters)
  return Object.freeze(parameters.filter(item => item.group === category))
}

export function getBindableParameter(nodeOrType, target) {
  const normalizedTarget = String(target ?? '').trim()
  if (!normalizedTarget) return undefined
  return parametersForType(componentType(nodeOrType)).find(item => item.target === normalizedTarget)
}

export function isBindingTargetAllowed(nodeOrType, target) {
  return Boolean(getBindableParameter(nodeOrType, target))
}

export function bindingStaticValue(node, target) {
  const definition = getBindableParameter(node, target)
  if (!definition) return undefined
  try {
    return definition.readStatic(node)
  } catch {
    return undefined
  }
}

// 兼容简短命名，供现有纯函数测试和非 Vue 调用方使用。
export const bindingParametersForType = getBindableParameters
export const bindingParameterFor = getBindableParameter
