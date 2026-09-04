import { isAnimationComponentType } from './componentCapabilities.js'
import { MAX_EDITABLE_CHART_SERIES, chartSeriesFromNode } from '../utils/chartOptions.js'

const COMMON_TARGET_ORDER = Object.freeze(['fill', 'stroke', 'opacity', 'text', 'visible'])
const ANIMATION_TARGET_ORDER = Object.freeze(['animationPlaying', 'animationDuration'])
const MULTI_SERIES_CHART_TYPES = new Set(['lineChart', 'barChart', 'scatterChart', 'radarChart'])
const CHART_SERIES_TARGET_PATTERN = /^chartSeries\.(\d+)\.(name|color|data)$/

const COMMON_TARGET_EXCLUSIONS = new Map([
  ['image', new Set(['text'])],
  ['video', new Set(['text'])],
  ['pencil', new Set(['fill', 'stroke', 'text'])],
  ['polyline', new Set(['fill', 'text'])],
  ['flowDirection', new Set(['fill', 'text'])],
  ['flowPipe', new Set(['text'])],
  ['rotatingFan', new Set(['text'])],
  ['signalLight', new Set(['text'])],
  ['waterTank', new Set(['text'])],
  ['heartbeat', new Set(['text'])],
  ['particles', new Set(['text'])],
  ['lineShape', new Set(['text'])],
  ['input', new Set(['text'])],
  ['select', new Set(['text'])],
  ['time', new Set(['text'])],
  ['formProgress', new Set(['text'])],
  ['progress', new Set(['text'])],
  ['customMotion', new Set(['text'])],
  ['customImageMotion', new Set(['text'])],
  ['customIndicator', new Set(['text'])],
  ['chart', new Set(['text'])],
  ['lineChart', new Set(['text'])],
  ['barChart', new Set(['text'])],
  ['pieChart', new Set(['text'])],
  ['scatterChart', new Set(['text'])],
  ['radarChart', new Set(['text'])],
  ['echartsCode', new Set(['text'])]
])

function componentType(nodeOrType) {
  return typeof nodeOrType === 'string' ? nodeOrType : String(nodeOrType?.type ?? '')
}

function cloneStaticValue(value) {
  if (Array.isArray(value)) return value.map(cloneStaticValue)
  if (!value || typeof value !== 'object') return value
  const clone = {}
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    clone[key] = cloneStaticValue(value[key])
  }
  return clone
}

function propertyContract(target, fieldPaths, controlKind, readStatic, writeStatic) {
  return Object.freeze({
    target,
    fieldPaths: Object.freeze([...fieldPaths]),
    controlKind,
    readStatic,
    writeStatic
  })
}

function directPropertyContract(target, fieldPath = target, controlKind = 'text', readStatic) {
  return propertyContract(
    target,
    [fieldPath],
    controlKind,
    readStatic || (node => node?.[fieldPath]),
    (node, value) => ({ ...node, [fieldPath]: cloneStaticValue(value) })
  )
}

function aliasPropertyContract(target, fieldPath, controlKind) {
  return directPropertyContract(target, fieldPath, controlKind)
}

const COMMON_CONTRACTS = new Map([
  ['fill', directPropertyContract('fill', 'fill', 'color')],
  ['stroke', directPropertyContract('stroke', 'stroke', 'color')],
  ['opacity', directPropertyContract('opacity', 'opacity', 'number')],
  ['text', directPropertyContract('text', 'text', 'text')],
  ['visible', directPropertyContract('visible', 'visible', 'boolean', node => node?.visible !== false)]
])

const ANIMATION_CONTRACTS = new Map([
  ['animationPlaying', propertyContract(
    'animationPlaying',
    ['animationPaused'],
    'boolean',
    node => node?.animationPaused !== true,
    (node, value) => ({ ...node, animationPaused: value === false })
  )],
  ['animationDuration', directPropertyContract('animationDuration', 'animationDuration', 'number')]
])

function tableDataFromNode(node) {
  const headers = Array.isArray(node?.tableHeaders) ? node.tableHeaders : []
  return {
    columns: headers.map((title, index) => ({ key: `column${index + 1}`, title })),
    rows: Array.isArray(node?.tableCells) ? node.tableCells : []
  }
}

function tableDataFields(value) {
  const columns = Array.isArray(value?.columns) ? value.columns : []
  const rows = Array.isArray(value?.rows) ? value.rows : []
  const headers = columns.map((column, index) => String(column?.title ?? column?.label ?? column?.key ?? `列 ${index + 1}`))
  const keys = columns.map((column, index) => String(column?.key || `column${index + 1}`))
  const cells = rows.map(row => {
    if (Array.isArray(row)) return row.map(cloneStaticValue)
    if (row && typeof row === 'object') return keys.map(key => cloneStaticValue(row[key]))
    return [cloneStaticValue(row)]
  })
  return { headers, cells }
}

const TABLE_CONTRACTS = new Map([
  ['fill', aliasPropertyContract('fill', 'tableRowFill', 'color')],
  ['stroke', aliasPropertyContract('stroke', 'tableBorderColor', 'color')],
  ['text', directPropertyContract('text', 'tableTitle', 'text', node => node?.tableTitle ?? node?.text)],
  ['tableRowFill', directPropertyContract('tableRowFill', 'tableRowFill', 'color')],
  ['tableBorderColor', directPropertyContract('tableBorderColor', 'tableBorderColor', 'color')],
  ['tableTitle', directPropertyContract('tableTitle', 'tableTitle', 'text', node => node?.tableTitle ?? node?.text)],
  ['tableHeaders', directPropertyContract('tableHeaders', 'tableHeaders', 'structured', node => (
    Array.isArray(node?.tableHeaders) ? node.tableHeaders : []
  ))],
  ['tableCells', directPropertyContract('tableCells', 'tableCells', 'structured', node => (
    Array.isArray(node?.tableCells) ? node.tableCells : []
  ))],
  ['tableData', propertyContract(
    'tableData',
    ['tableHeaders', 'tableCells', 'tableColumns', 'tableRows'],
    'structured',
    tableDataFromNode,
    (node, value) => {
      const { headers, cells } = tableDataFields(value)
      return {
        ...node,
        tableHeaders: headers,
        tableCells: cells,
        tableColumns: Math.max(1, headers.length),
        tableRows: Math.max(1, cells.length)
      }
    }
  )]
])

const TIME_CONTRACTS = new Map([
  ['value', aliasPropertyContract('value', 'defaultValue', 'text')]
])

const CHECKED_CONTRACT = directPropertyContract('checked', 'checked', 'boolean')
const VALUE_CONTRACT = directPropertyContract('value', 'value', 'text')
const PROGRESS_CONTRACT = directPropertyContract('progressValue', 'progressValue', 'number')
const VISUAL_COLOR_CONTRACT = directPropertyContract('visualPrimaryColor', 'visualPrimaryColor', 'color')
const POLYLINE_COLOR_CONTRACT = directPropertyContract('polylineColor', 'polylineColor', 'color')
const CHART_DATA_CONTRACT = directPropertyContract('chartData', 'chartData', 'structured', node => node?.chartData ?? [])
const CHART_TITLE_CONTRACT = directPropertyContract('chartTitle', 'chartTitle', 'text')
const CHART_SERIES_NAME_CONTRACT = directPropertyContract('chartSeriesName', 'chartSeriesName', 'text')
const CHART_LABELS_CONTRACT = directPropertyContract('chartLabels', 'chartLabels', 'structured', node => (
  Array.isArray(node?.chartLabels) ? node.chartLabels : []
))
const CHART_COLOR_CONTRACT = directPropertyContract('chartColor', 'chartColor', 'color')
const CHART_SHOW_LEGEND_CONTRACT = directPropertyContract('chartShowLegend', 'chartShowLegend', 'boolean')
const CHART_SHOW_TOOLTIP_CONTRACT = directPropertyContract('chartShowTooltip', 'chartShowTooltip', 'boolean')
const CHART_SHOW_GRID_CONTRACT = directPropertyContract('chartShowGrid', 'chartShowGrid', 'boolean')
const CHART_SMOOTH_CONTRACT = directPropertyContract('chartSmooth', 'chartSmooth', 'boolean')
const CHART_AREA_FILL_CONTRACT = directPropertyContract('chartAreaFill', 'chartAreaFill', 'boolean')
const CHART_SYMBOL_SIZE_CONTRACT = directPropertyContract('chartSymbolSize', 'chartSymbolSize', 'number')
const CHART_RADAR_MAX_CONTRACT = directPropertyContract('chartRadarMax', 'chartRadarMax', 'number')
const COMMON_CHART_CONTRACTS = Object.freeze([
  CHART_TITLE_CONTRACT,
  CHART_SERIES_NAME_CONTRACT,
  CHART_LABELS_CONTRACT,
  CHART_DATA_CONTRACT,
  CHART_COLOR_CONTRACT,
  CHART_SHOW_LEGEND_CONTRACT,
  CHART_SHOW_TOOLTIP_CONTRACT,
  CHART_SHOW_GRID_CONTRACT
])
const PIE_CHART_CONTRACTS = Object.freeze([
  CHART_TITLE_CONTRACT,
  CHART_LABELS_CONTRACT,
  CHART_DATA_CONTRACT,
  CHART_COLOR_CONTRACT,
  CHART_SHOW_LEGEND_CONTRACT,
  CHART_SHOW_TOOLTIP_CONTRACT,
  CHART_SHOW_GRID_CONTRACT
])
const SIGNAL_OPACITY_CONTRACT = directPropertyContract('signalOpacity', 'signalOpacity', 'number')

function chartSeriesContract(index, field) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_EDITABLE_CHART_SERIES) return undefined
  const target = `chartSeries.${index}.${field}`
  const legacyField = index === 0 ? { name: 'chartSeriesName', color: 'chartColor', data: 'chartData' }[field] : ''
  return propertyContract(
    target,
    legacyField ? ['chartSeries', legacyField] : ['chartSeries'],
    field === 'color' ? 'color' : field === 'data' ? 'structured' : 'text',
    node => chartSeriesFromNode(node)[index]?.[field],
    (node, value) => {
      const series = chartSeriesFromNode(node).map(item => ({
        ...item,
        data: cloneStaticValue(item.data)
      }))
      while (series.length <= index) {
        series.push({ name: `系列 ${series.length + 1}`, color: '#16b89a', data: [] })
      }
      series[index] = { ...series[index], [field]: cloneStaticValue(value) }
      return {
        ...node,
        chartSeries: series,
        ...(legacyField ? { [legacyField]: cloneStaticValue(value) } : {})
      }
    }
  )
}

function chartSeriesContractFor(nodeOrType, target) {
  if (!MULTI_SERIES_CHART_TYPES.has(componentType(nodeOrType))) return undefined
  const match = CHART_SERIES_TARGET_PATTERN.exec(String(target ?? '').trim())
  return match ? chartSeriesContract(Number(match[1]), match[2]) : undefined
}

function chartSeriesContractCount(nodeOrType) {
  if (!nodeOrType || typeof nodeOrType === 'string') return 1
  let count = Math.max(1, Math.min(
    MAX_EDITABLE_CHART_SERIES,
    Array.isArray(nodeOrType.chartSeries) ? nodeOrType.chartSeries.length : 0
  ))
  for (const binding of Array.isArray(nodeOrType.dataBindings) ? nodeOrType.dataBindings : []) {
    const match = CHART_SERIES_TARGET_PATTERN.exec(String(binding?.target ?? '').trim())
    if (match) count = Math.max(count, Math.min(MAX_EDITABLE_CHART_SERIES, Number(match[1]) + 1))
  }
  return count
}

function signalColorContract(index) {
  const target = `signalColors.${index}`
  return propertyContract(
    target,
    [target],
    'color',
    node => node?.signalColors?.[index] ?? (index === 0 ? node?.signalColor : undefined),
    (node, value) => {
      const colors = Array.isArray(node?.signalColors) ? [...node.signalColors] : []
      colors[index] = cloneStaticValue(value)
      return { ...node, signalColors: colors }
    }
  )
}

const SIGNAL_COLOR_CONTRACTS = Object.freeze(Array.from({ length: 8 }, (_, index) => signalColorContract(index)))

function contracts(...entries) {
  return new Map(entries.map(contract => [contract.target, contract]))
}

const TYPE_CONTRACTS = new Map([
  ['table', TABLE_CONTRACTS],
  ['time', TIME_CONTRACTS],
  ['checkbox', contracts(CHECKED_CONTRACT)],
  ['radio', contracts(CHECKED_CONTRACT)],
  ['switch', contracts(CHECKED_CONTRACT)],
  ['button', contracts(CHECKED_CONTRACT)],
  ['input', contracts(VALUE_CONTRACT)],
  ['select', contracts(VALUE_CONTRACT)],
  ['formProgress', contracts(PROGRESS_CONTRACT)],
  ['progress', contracts(PROGRESS_CONTRACT)],
  ['gauge', contracts(PROGRESS_CONTRACT)],
  ['flowDirection', contracts(POLYLINE_COLOR_CONTRACT)],
  ['flowPipe', contracts(VISUAL_COLOR_CONTRACT)],
  ['rotatingFan', contracts(VISUAL_COLOR_CONTRACT)],
  ['waterTank', contracts(VISUAL_COLOR_CONTRACT, PROGRESS_CONTRACT)],
  ['heartbeat', contracts(VISUAL_COLOR_CONTRACT)],
  ['particles', contracts(VISUAL_COLOR_CONTRACT)],
  ['chart', contracts(CHART_DATA_CONTRACT)],
  ['lineChart', contracts(
    ...COMMON_CHART_CONTRACTS,
    CHART_SMOOTH_CONTRACT,
    CHART_AREA_FILL_CONTRACT,
    CHART_SYMBOL_SIZE_CONTRACT
  )],
  ['barChart', contracts(...COMMON_CHART_CONTRACTS)],
  ['pieChart', contracts(...PIE_CHART_CONTRACTS)],
  ['scatterChart', contracts(...COMMON_CHART_CONTRACTS, CHART_SYMBOL_SIZE_CONTRACT)],
  ['radarChart', contracts(...COMMON_CHART_CONTRACTS, CHART_RADAR_MAX_CONTRACT)],
  ['signalLight', contracts(...SIGNAL_COLOR_CONTRACTS, SIGNAL_OPACITY_CONTRACT)]
])

function commonTargetAllowed(type, target) {
  return !COMMON_TARGET_EXCLUSIONS.get(type)?.has(target)
}

/**
 * 返回通信 target 对应的属性编辑静态字段契约。
 * 组件专用映射优先于同名公共字段，例如表格 fill 实际编辑 tableRowFill。
 */
export function getPropertyEditorContract(nodeOrType, target) {
  const type = componentType(nodeOrType)
  const normalizedTarget = String(target ?? '').trim()
  if (!type || !normalizedTarget) return undefined

  const componentContract = TYPE_CONTRACTS.get(type)?.get(normalizedTarget)
  if (componentContract) return componentContract
  const seriesContract = chartSeriesContractFor(nodeOrType, normalizedTarget)
  if (seriesContract) return seriesContract
  if (ANIMATION_CONTRACTS.has(normalizedTarget)) {
    return isAnimationComponentType(type) ? ANIMATION_CONTRACTS.get(normalizedTarget) : undefined
  }
  if (!commonTargetAllowed(type, normalizedTarget)) return undefined
  return COMMON_CONTRACTS.get(normalizedTarget)
}

export function getPropertyEditorContracts(nodeOrType) {
  const type = componentType(nodeOrType)
  if (!type) return Object.freeze([])
  const targets = [...COMMON_TARGET_ORDER]
  if (isAnimationComponentType(type)) targets.push(...ANIMATION_TARGET_ORDER)
  targets.push(...(TYPE_CONTRACTS.get(type)?.keys() || []))
  if (MULTI_SERIES_CHART_TYPES.has(type)) {
    for (let index = 0; index < chartSeriesContractCount(nodeOrType); index += 1) {
      targets.push(`chartSeries.${index}.name`, `chartSeries.${index}.color`, `chartSeries.${index}.data`)
    }
  }
  return Object.freeze([...new Set(targets)]
    .map(target => getPropertyEditorContract(type, target))
    .filter(Boolean))
}
