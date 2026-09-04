import {
  isAnimationComponentType,
  isBuiltInAnimationComponentType
} from './componentCapabilities.js'
import { MAX_EDITABLE_CHART_SERIES } from '../utils/chartOptions.js'

const COMMON_GROUP = 'common'
const ANIMATION_GROUP = 'animation'
const DATA_GROUP = 'data'
const SIGNAL_GROUP = 'signal'
const CHART_SERIES_GROUP = 'series'
const MULTI_SERIES_CHART_TYPES = new Set(['lineChart', 'barChart', 'scatterChart', 'radarChart'])
const CHART_SERIES_TARGET_PATTERN = /^chartSeries\.(\d+)\.(name|color|data)$/
export const MAX_SIGNAL_COLORS = 8
export const ANIMATION_DURATION_MIN_SECONDS = 0.2
export const BUILT_IN_ANIMATION_DURATION_MAX_SECONDS = 5
export const CUSTOM_ANIMATION_DURATION_MAX_SECONDS = 20

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
  parameter('visible', '显示组件', 'boolean', COMMON_GROUP, node => node?.visible !== false)
])
const ANIMATION_PARAMETERS = Object.freeze([
  parameter('animationPlaying', '动画播放状态', 'boolean', ANIMATION_GROUP, node => node?.animationPaused !== true),
  parameter('animationDuration', '动画周期', 'number', ANIMATION_GROUP, node => node?.animationDuration, {
    min: ANIMATION_DURATION_MIN_SECONDS,
    max: CUSTOM_ANIMATION_DURATION_MAX_SECONDS
  })
])
const readTableRowFill = node => node?.tableRowFill ?? node?.fill
const readTableBorderColor = node => node?.tableBorderColor ?? node?.stroke
const readTableTitle = node => node?.tableTitle ?? node?.text
const LEGACY_TABLE_FILL_PARAMETER = Object.freeze({
  ...COMMON_PARAMETERS.find(item => item.target === 'fill'),
  label: '旧版表体填充颜色',
  readStatic: readTableRowFill,
  value: readTableRowFill,
  legacy: true,
  visibleWhenBound: true
})
const LEGACY_TABLE_STROKE_PARAMETER = Object.freeze({
  ...COMMON_PARAMETERS.find(item => item.target === 'stroke'),
  label: '旧版表格外框颜色',
  readStatic: readTableBorderColor,
  value: readTableBorderColor,
  legacy: true,
  visibleWhenBound: true
})
const LEGACY_TABLE_TEXT_PARAMETER = Object.freeze({
  ...COMMON_PARAMETERS.find(item => item.target === 'text'),
  label: '旧版标题数据',
  readStatic: readTableTitle,
  value: readTableTitle,
  legacy: true,
  visibleWhenBound: true
})
const BUILT_IN_ANIMATION_DURATION_PARAMETER = Object.freeze({
  ...ANIMATION_PARAMETERS.find(item => item.target === 'animationDuration'),
  max: BUILT_IN_ANIMATION_DURATION_MAX_SECONDS
})

// 这些组件的视觉实现不读取相应公共字段，通信页不展示无效绑定入口。
const EXCLUDED_TARGETS_BY_TYPE = Object.freeze({
  lineShape: new Set(['text']),
  image: new Set(['text']),
  video: new Set(['text']),
  pencil: new Set(['fill', 'stroke', 'text']),
  polyline: new Set(['fill', 'text']),
  flowDirection: new Set(['fill', 'text']),
  table: new Set(['fill', 'stroke', 'text']),
  input: new Set(['text']),
  select: new Set(['text']),
  time: new Set(['text']),
  formProgress: new Set(['text']),
  progress: new Set(['text']),
  flowPipe: new Set(['text']),
  rotatingFan: new Set(['text']),
  signalLight: new Set(['text']),
  waterTank: new Set(['text']),
  heartbeat: new Set(['text']),
  particles: new Set(['text']),
  customMotion: new Set(['text']),
  customImageMotion: new Set(['text']),
  customIndicator: new Set(['text']),
  chart: new Set(['text']),
  lineChart: new Set(['text']),
  barChart: new Set(['text']),
  pieChart: new Set(['text']),
  scatterChart: new Set(['text']),
  radarChart: new Set(['text']),
  echartsCode: new Set(['text'])
})

const CHECKED_PARAMETER = parameter('checked', '选中状态', 'boolean', DATA_GROUP, node => node?.checked)
const BUTTON_CHECKED_PARAMETER = parameter('checked', '当前开启', 'boolean', DATA_GROUP, node => node?.checked, {
  availableWhen: node => node?.buttonAction === 'toggle',
  visibleWhenBound: true
})
const VALUE_PARAMETER = parameter('value', '组件值', 'text', DATA_GROUP, node => node?.value)
const TIME_VALUE_PARAMETER = parameter('value', '固定时间', 'text', DATA_GROUP, node => node?.defaultValue ?? node?.value)
const FORM_PROGRESS_PARAMETER = parameter('progressValue', '进度数值', 'number', DATA_GROUP, node => node?.progressValue, { min: 0 })
const PROGRESS_PARAMETER = parameter('progressValue', '进度数值', 'number', DATA_GROUP, node => node?.progressValue, { min: 0, max: 100 })
const VISUAL_PRIMARY_COLOR_PARAMETER = parameter('visualPrimaryColor', '主体颜色', 'color', COMMON_GROUP, node => node?.visualPrimaryColor)
const POLYLINE_COLOR_PARAMETER = parameter('polylineColor', '线条颜色', 'color', COMMON_GROUP, node => node?.polylineColor)
const TABLE_ROW_FILL_PARAMETER = parameter('tableRowFill', '表体填充颜色', 'color', COMMON_GROUP, readTableRowFill)
const TABLE_BORDER_COLOR_PARAMETER = parameter('tableBorderColor', '表格外框颜色', 'color', COMMON_GROUP, readTableBorderColor)
const TABLE_TITLE_PARAMETER = parameter('tableTitle', '标题数据', 'text', DATA_GROUP, readTableTitle, {
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
const CHART_TITLE_PARAMETER = parameter('chartTitle', '图表标题', 'text', DATA_GROUP, node => node?.chartTitle)
const CHART_SERIES_NAME_PARAMETER = parameter('chartSeriesName', '系列名称', 'text', DATA_GROUP, node => node?.chartSeriesName)
const CHART_LABELS_PARAMETER = parameter('chartLabels', '分类标签', 'text-list', DATA_GROUP, node => (
  Array.isArray(node?.chartLabels) ? node.chartLabels : []
))
const CHART_PARAMETER = parameter('chartData', '图表数据', 'table', DATA_GROUP, node => node?.chartData ?? [])
const CHART_COLOR_PARAMETER = parameter('chartColor', '图表主色', 'color', COMMON_GROUP, node => node?.chartColor)
const CHART_SHOW_LEGEND_PARAMETER = parameter('chartShowLegend', '显示图例', 'boolean', COMMON_GROUP, node => node?.chartShowLegend !== false)
const CHART_SHOW_TOOLTIP_PARAMETER = parameter('chartShowTooltip', '显示提示框', 'boolean', COMMON_GROUP, node => node?.chartShowTooltip !== false)
const CHART_SHOW_GRID_PARAMETER = parameter('chartShowGrid', '显示坐标网格', 'boolean', COMMON_GROUP, node => node?.chartShowGrid !== false)
const CHART_SMOOTH_PARAMETER = parameter('chartSmooth', '平滑曲线', 'boolean', COMMON_GROUP, node => node?.chartSmooth === true)
const CHART_AREA_FILL_PARAMETER = parameter('chartAreaFill', '显示面积填充', 'boolean', COMMON_GROUP, node => node?.chartAreaFill === true)
const CHART_SYMBOL_SIZE_PARAMETER = parameter('chartSymbolSize', '数据点大小', 'number', COMMON_GROUP, node => node?.chartSymbolSize, { min: 1, max: 100 })
const CHART_RADAR_MAX_PARAMETER = parameter('chartRadarMax', '雷达最大值', 'number', DATA_GROUP, node => node?.chartRadarMax, { min: 1 })
const CHART_APPEARANCE_PARAMETERS = Object.freeze([
  CHART_SHOW_LEGEND_PARAMETER,
  CHART_SHOW_TOOLTIP_PARAMETER,
  CHART_SHOW_GRID_PARAMETER
])
const CHART_DATA_PARAMETERS = Object.freeze([CHART_TITLE_PARAMETER, CHART_LABELS_PARAMETER])
const LEGACY_CHART_PARAMETERS = Object.freeze([
  Object.freeze({ ...CHART_SERIES_NAME_PARAMETER, label: '旧版首系列名称', legacy: true, visibleWhenBound: true }),
  Object.freeze({ ...CHART_COLOR_PARAMETER, label: '旧版首系列颜色', legacy: true, visibleWhenBound: true }),
  Object.freeze({ ...CHART_PARAMETER, label: '旧版首系列数据', legacy: true, visibleWhenBound: true })
])
const PIE_CHART_PARAMETERS = Object.freeze([
  ...CHART_APPEARANCE_PARAMETERS,
  CHART_COLOR_PARAMETER,
  CHART_TITLE_PARAMETER,
  CHART_LABELS_PARAMETER,
  CHART_PARAMETER,
])

function chartSeriesValue(node, index, field) {
  const series = Array.isArray(node?.chartSeries) ? node.chartSeries[index] : null
  if (index === 0) {
    if (field === 'name' && node?.chartSeriesName !== undefined) return node.chartSeriesName
    if (field === 'color' && node?.chartColor !== undefined) return node.chartColor
    if (field === 'data' && node?.chartData !== undefined) return node.chartData
  }
  if (series && typeof series === 'object' && !Array.isArray(series)) return series[field]
  if (field === 'name') return `系列 ${index + 1}`
  if (field === 'data') return []
  return undefined
}

function chartSeriesLabel(nodeOrType, index, field) {
  const fieldLabel = { name: '名称', color: '颜色', data: '数据' }[field]
  if (!nodeOrType || typeof nodeOrType === 'string') return `系列 ${index + 1} · ${fieldLabel}`
  const name = String(chartSeriesValue(nodeOrType, index, 'name') ?? '').trim()
  const defaultName = `系列 ${index + 1}`
  return `${defaultName}${name && name !== defaultName ? `（${name}）` : ''} · ${fieldLabel}`
}

function chartSeriesParameter(nodeOrType, index, field) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_EDITABLE_CHART_SERIES) return undefined
  const target = `chartSeries.${index}.${field}`
  const valueType = field === 'color' ? 'color' : field === 'data' ? 'table' : 'text'
  return parameter(
    target,
    chartSeriesLabel(nodeOrType, index, field),
    valueType,
    CHART_SERIES_GROUP,
    node => chartSeriesValue(node, index, field),
    { chartSeriesIndex: index, chartSeriesField: field }
  )
}

function chartSeriesParameterCount(nodeOrType) {
  if (!nodeOrType || typeof nodeOrType === 'string') return 1
  let count = Math.max(1, Math.min(
    MAX_EDITABLE_CHART_SERIES,
    Array.isArray(nodeOrType.chartSeries) ? nodeOrType.chartSeries.length : 0
  ))
  for (const binding of Array.isArray(nodeOrType.dataBindings) ? nodeOrType.dataBindings : []) {
    const match = CHART_SERIES_TARGET_PATTERN.exec(String(binding?.target ?? '').trim())
    if (!match) continue
    count = Math.max(count, Math.min(MAX_EDITABLE_CHART_SERIES, Number(match[1]) + 1))
  }
  return count
}

function chartSeriesParameters(nodeOrType) {
  if (!MULTI_SERIES_CHART_TYPES.has(componentType(nodeOrType))) return []
  return Array.from({ length: chartSeriesParameterCount(nodeOrType) }, (_, index) => [
    chartSeriesParameter(nodeOrType, index, 'name'),
    chartSeriesParameter(nodeOrType, index, 'color'),
    chartSeriesParameter(nodeOrType, index, 'data')
  ]).flat()
}
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
    TABLE_ROW_FILL_PARAMETER,
    TABLE_BORDER_COLOR_PARAMETER,
    TABLE_TITLE_PARAMETER,
    TABLE_HEADERS_PARAMETER,
    TABLE_CELLS_PARAMETER,
    TABLE_PARAMETER,
    LEGACY_TABLE_FILL_PARAMETER,
    LEGACY_TABLE_STROKE_PARAMETER,
    LEGACY_TABLE_TEXT_PARAMETER
  ]),
  checkbox: Object.freeze([CHECKED_PARAMETER]),
  radio: Object.freeze([CHECKED_PARAMETER]),
  switch: Object.freeze([CHECKED_PARAMETER]),
  button: Object.freeze([BUTTON_CHECKED_PARAMETER]),
  input: Object.freeze([VALUE_PARAMETER]),
  select: Object.freeze([VALUE_PARAMETER]),
  time: Object.freeze([TIME_VALUE_PARAMETER]),
  formProgress: Object.freeze([FORM_PROGRESS_PARAMETER]),
  progress: Object.freeze([PROGRESS_PARAMETER]),
  gauge: Object.freeze([PROGRESS_PARAMETER]),
  flowDirection: Object.freeze([POLYLINE_COLOR_PARAMETER]),
  flowPipe: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  rotatingFan: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  waterTank: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER, PROGRESS_PARAMETER]),
  heartbeat: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  particles: Object.freeze([VISUAL_PRIMARY_COLOR_PARAMETER]),
  chart: Object.freeze([CHART_PARAMETER]),
  lineChart: Object.freeze([
    ...CHART_APPEARANCE_PARAMETERS,
    CHART_SMOOTH_PARAMETER,
    CHART_AREA_FILL_PARAMETER,
    CHART_SYMBOL_SIZE_PARAMETER,
    ...CHART_DATA_PARAMETERS,
    ...LEGACY_CHART_PARAMETERS
  ]),
  barChart: Object.freeze([...CHART_APPEARANCE_PARAMETERS, ...CHART_DATA_PARAMETERS, ...LEGACY_CHART_PARAMETERS]),
  pieChart: PIE_CHART_PARAMETERS,
  scatterChart: Object.freeze([
    ...CHART_APPEARANCE_PARAMETERS,
    CHART_SYMBOL_SIZE_PARAMETER,
    ...CHART_DATA_PARAMETERS,
    ...LEGACY_CHART_PARAMETERS
  ]),
  radarChart: Object.freeze([
    ...CHART_APPEARANCE_PARAMETERS,
    ...CHART_DATA_PARAMETERS,
    CHART_RADAR_MAX_PARAMETER,
    ...LEGACY_CHART_PARAMETERS
  ]),
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
    const animation = !isAnimationComponentType(normalizedType)
      ? []
      : isBuiltInAnimationComponentType(normalizedType)
        ? ANIMATION_PARAMETERS.map(item => item.target === 'animationDuration'
          ? BUILT_IN_ANIMATION_DURATION_PARAMETER
          : item)
        : ANIMATION_PARAMETERS
    parameters = Object.freeze([...availableCommon, ...animation, ...(TYPE_PARAMETERS[normalizedType] || [])])
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
  if (item.availableWhen && !item.availableWhen(nodeOrType)) {
    return item.visibleWhenBound && hasTargetBinding(nodeOrType, item.target)
  }
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
  const parameters = [
    ...parametersForType(componentType(nodeOrType)).filter(item => parameterIsVisible(nodeOrType, item)),
    ...chartSeriesParameters(nodeOrType)
  ]
  if (!category) return Object.freeze(parameters)
  return Object.freeze(parameters.filter(item => item.group === category))
}

export function getBindableParameter(nodeOrType, target) {
  const normalizedTarget = String(target ?? '').trim()
  if (!normalizedTarget) return undefined
  const staticParameter = parametersForType(componentType(nodeOrType)).find(item => item.target === normalizedTarget)
  if (staticParameter) return staticParameter
  if (!MULTI_SERIES_CHART_TYPES.has(componentType(nodeOrType))) return undefined
  const match = CHART_SERIES_TARGET_PATTERN.exec(normalizedTarget)
  return match ? chartSeriesParameter(nodeOrType, Number(match[1]), match[2]) : undefined
}

/** 仅用于在归一化迁移前接受旧普通组件动画绑定，运行时不会继续执行。 */
export function getLegacyBindableParameter(nodeOrType, target) {
  if (isAnimationComponentType(componentType(nodeOrType))) return undefined
  const normalizedTarget = String(target ?? '').trim()
  return ANIMATION_PARAMETERS.find(item => item.target === normalizedTarget)
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
