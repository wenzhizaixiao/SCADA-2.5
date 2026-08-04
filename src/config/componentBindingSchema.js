const COMMON_GROUP = 'common'
const ANIMATION_GROUP = 'animation'
const DATA_GROUP = 'data'

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
  parameter('animationDuration', '动画周期', 'number', ANIMATION_GROUP, node => node?.animationDuration, { min: 0.1, max: 3600 })
])

// 这些组件的视觉实现不读取相应公共字段，通信页不展示无效绑定入口。
const EXCLUDED_TARGETS_BY_TYPE = Object.freeze({
  pencil: new Set(['fill', 'stroke', 'text']),
  polyline: new Set(['fill', 'text'])
})

const CHECKED_PARAMETER = parameter('checked', '选中状态', 'boolean', DATA_GROUP, node => node?.checked)
const VALUE_PARAMETER = parameter('value', '组件值', 'text', DATA_GROUP, node => node?.value)
const PROGRESS_PARAMETER = parameter('progressValue', '进度数值', 'number', DATA_GROUP, node => node?.progressValue)
const TABLE_PARAMETER = parameter('tableData', '表格数据', 'table', DATA_GROUP, node => ({
  columns: (Array.isArray(node?.tableHeaders) ? node.tableHeaders : []).map((title, index) => ({
    key: `column${index + 1}`,
    title
  })),
  rows: Array.isArray(node?.tableCells) ? node.tableCells : []
}))
const CHART_PARAMETER = parameter('chartData', '图表数据', 'table', DATA_GROUP, node => node?.chartData ?? [])

const TYPE_PARAMETERS = Object.freeze({
  table: Object.freeze([TABLE_PARAMETER]),
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
  waterTank: Object.freeze([PROGRESS_PARAMETER]),
  chart: Object.freeze([CHART_PARAMETER])
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
    const common = excluded
      ? COMMON_PARAMETERS.filter(item => !excluded.has(item.target))
      : COMMON_PARAMETERS
    parameters = Object.freeze([...common, ...(TYPE_PARAMETERS[normalizedType] || [])])
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
  if (!nodeOrType || typeof nodeOrType === 'string' || item.target !== 'text') return true
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

export const COMPONENT_BINDING_GROUPS = Object.freeze({
  COMMON: COMMON_GROUP,
  ANIMATION: ANIMATION_GROUP,
  DATA: DATA_GROUP
})
