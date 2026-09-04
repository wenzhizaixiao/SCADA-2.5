import {
  MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS,
  MAX_RUNTIME_TABLE_CELL_DEPTH,
  MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS,
  MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH,
  MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES,
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS,
  bindingRuntimeKey,
  resolveNodeDataBindings
} from '../models/dataBindingModel.js'
import { MAX_SIGNAL_COLORS } from '../config/componentBindingSchema.js'
import { MAX_EDITABLE_CHART_SERIES, chartSeriesFromNode } from './chartOptions.js'
import { formatRuntimeValue } from './runtimeValueFormat.js'

export const MAX_RUNTIME_CHART_BARS = 12

// 协议中的状态值统一映射为视觉颜色，组件无需了解状态来自哪一种协议。
export const RUNTIME_STATUS_COLORS = Object.freeze({
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
  'orange', 'transparent', 'currentcolor'
])

const DIRECT_TARGETS = new Set([
  'opacity',
  'signalOpacity',
  'text',
  'checked',
  'visible',
  'value',
  'progressValue',
  'chartTitle',
  'chartSeriesName',
  'chartLabels',
  'chartData',
  'chartShowLegend',
  'chartShowTooltip',
  'chartShowGrid',
  'chartSmooth',
  'chartAreaFill',
  'chartSymbolSize',
  'chartRadarMax',
  'animationDuration'
])
const SIGNAL_COLOR_TARGET_PATTERN = /^signalColors\.(\d+)$/
const CHART_SERIES_TARGET_PATTERN = /^chartSeries\.(\d+)\.(name|color|data)$/
const TABLE_BINDING_TARGETS = new Set(['tableData', 'tableTitle', 'tableHeaders', 'tableCells'])
const TABLE_CONTENT_BINDING_TARGETS = new Set([...TABLE_BINDING_TARGETS, 'text'])

const RUNTIME_TABLE_CELL_FORMAT_LIMITS = Object.freeze({
  maxLength: MAX_RUNTIME_TABLE_CELL_TEXT_LENGTH,
  maxDepth: MAX_RUNTIME_TABLE_CELL_DEPTH,
  maxObjectKeys: MAX_RUNTIME_TABLE_CELL_OBJECT_KEYS,
  maxArrayItems: MAX_RUNTIME_TABLE_CELL_ARRAY_ITEMS,
  maxTotalEntries: MAX_RUNTIME_TABLE_CELL_TOTAL_ENTRIES
})

function normalizedColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (!color) return null

  const statusColor = RUNTIME_STATUS_COLORS[color.toLowerCase()]
  if (statusColor) return statusColor
  if (/^#[\da-f]{3,4}(?:[\da-f]{3,4})?$/i.test(color)) return color
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(color)) return color
  if (SAFE_NAMED_COLORS.has(color.toLowerCase())) return color
  return null
}

/**
 * 只接受明确的 CSS 颜色或约定状态名，避免把 warning-like-text 等任意英文串写进样式。
 */
export function runtimeColor(value, fallback) {
  return normalizedColor(value) ?? fallback
}

function tableContentBindingRuntimeKey(binding) {
  const target = String(binding?.target ?? '').trim()
  if (binding?.enabled === false || !TABLE_CONTENT_BINDING_TARGETS.has(target)) return ''
  return bindingRuntimeKey(binding)
}

export function hasConfiguredTableContentBinding(node) {
  if (node?.type !== 'table' || !Array.isArray(node.dataBindings)) return false
  return node.dataBindings.some(binding => Boolean(tableContentBindingRuntimeKey(binding)))
}

export function hasResolvedTableContentBinding(node, getPointValue) {
  if (node?.type !== 'table' || typeof getPointValue !== 'function') return false
  const bindings = Array.isArray(node.dataBindings) ? node.dataBindings : []
  for (const binding of bindings) {
    const runtimeKey = tableContentBindingRuntimeKey(binding)
    if (!runtimeKey) continue
    try {
      const value = getPointValue(runtimeKey)
      if (value !== undefined && value !== null) return true
    } catch {}
  }
  return false
}

function tableCellText(value) {
  if (value == null) return ''
  return formatRuntimeValue(value, RUNTIME_TABLE_CELL_FORMAT_LIMITS)
}

function materializeTableData(node, tableData) {
  const columns = Array.isArray(tableData?.columns) ? tableData.columns.slice(0, MAX_RUNTIME_TABLE_COLUMNS) : []
  const rows = Array.isArray(tableData?.rows) ? tableData.rows.slice(0, MAX_RUNTIME_TABLE_ROWS) : []
  const columnCount = Math.max(1, columns.length)
  const rowCount = Math.max(1, rows.length)
  const keys = Array.from({ length: columnCount }, (_, index) => String(columns[index]?.key || `column${index + 1}`))
  const headers = Array.from({ length: columnCount }, (_, index) => String(columns[index]?.title ?? keys[index] ?? `列 ${index + 1}`))
  const cells = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = rows[rowIndex]
    return keys.map((key, columnIndex) => {
      if (Array.isArray(row)) return tableCellText(row[columnIndex])
      if (row && typeof row === 'object') return tableCellText(row[key])
      return columnIndex === 0 ? tableCellText(row) : ''
    })
  })

  return {
    ...node,
    tableData,
    tableHeaders: headers,
    tableCells: cells,
    tableRows: rowCount,
    tableColumns: columnCount
  }
}

function tableHeaderDescriptor(value, index) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      key: String(value.key || `column${index + 1}`),
      title: tableCellText(value.title ?? value.label ?? value.name ?? value.key ?? `列 ${index + 1}`),
      explicitKey: Boolean(String(value.key ?? '').trim())
    }
  }
  return {
    key: '',
    title: tableCellText(value ?? `列 ${index + 1}`),
    explicitKey: false
  }
}

function inferredTableRowKeys(rows, maximum) {
  const keys = []
  const seen = new Set()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    let inspected = 0
    try {
      for (const key in row) {
        inspected += 1
        if (inspected > MAX_RUNTIME_TABLE_COLUMNS * 2 + 4) break
        if (!Object.prototype.hasOwnProperty.call(row, key) || seen.has(key)) continue
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
        seen.add(key)
        keys.push(key)
        if (keys.length >= maximum) return keys
      }
    } catch {
      // Keep the keys already read from hostile or transient records.
    }
  }
  return keys
}

function tableArrayRowWidth(row) {
  if (!Array.isArray(row)) return 0
  try {
    const length = Number(row.length)
    if (!Number.isFinite(length)) return 0
    return Math.min(MAX_RUNTIME_TABLE_COLUMNS, Math.max(0, Math.trunc(length)))
  } catch {
    return 0
  }
}

function materializedTableColumnWidthsPx(node, columnCount) {
  const sourceWidths = Array.isArray(node.tableColumnWidthsPx) ? node.tableColumnWidthsPx : []
  if (!sourceWidths.length || sourceWidths.length >= columnCount) return node.tableColumnWidthsPx

  const validWidths = sourceWidths
    .map(width => Number(width))
    .filter(width => Number.isFinite(width) && width > 0)
  const fallbackWidth = validWidths.length
    ? validWidths.reduce((total, width) => total + width, 0) / validWidths.length
    : 120
  return Array.from({ length: columnCount }, (_, index) => {
    const width = Number(sourceWidths[index])
    return Math.max(40, Math.min(2000, Number.isFinite(width) && width > 0 ? width : fallbackWidth))
  })
}

function materializeTableSections(node, headerData, rowData) {
  const sourceHeaders = Array.isArray(headerData)
    ? headerData.slice(0, MAX_RUNTIME_TABLE_COLUMNS)
    : []
  const sourceRows = Array.isArray(rowData)
    ? rowData.slice(0, MAX_RUNTIME_TABLE_ROWS)
    : []
  const inferredKeys = inferredTableRowKeys(sourceRows, MAX_RUNTIME_TABLE_COLUMNS)
  let arrayRowWidth = 0
  for (const row of sourceRows) {
    arrayRowWidth = Math.max(arrayRowWidth, tableArrayRowWidth(row))
    if (arrayRowWidth >= MAX_RUNTIME_TABLE_COLUMNS) break
  }
  const columnCount = Math.max(
    1,
    Math.min(
      MAX_RUNTIME_TABLE_COLUMNS,
      Math.max(sourceHeaders.length, arrayRowWidth, inferredKeys.length)
    )
  )
  const descriptors = Array.from({ length: columnCount }, (_, index) => (
    tableHeaderDescriptor(sourceHeaders[index], index)
  ))
  const explicitKeys = new Set(descriptors
    .filter(descriptor => descriptor.explicitKey)
    .map(descriptor => descriptor.key))
  const positionalKeys = inferredKeys.filter(key => !explicitKeys.has(key))
  let positionalKeyIndex = 0
  const keys = descriptors.map((descriptor, index) => {
    if (descriptor.explicitKey) return descriptor.key
    return positionalKeys[positionalKeyIndex++] || `column${index + 1}`
  })
  const headers = descriptors.map((descriptor, index) => (
    descriptor.title || `列 ${index + 1}`
  ))
  const cells = sourceRows.map(row => keys.map((key, columnIndex) => {
    if (Array.isArray(row)) return tableCellText(row[columnIndex])
    if (row && typeof row === 'object') {
      try {
        return Object.prototype.hasOwnProperty.call(row, key) ? tableCellText(row[key]) : ''
      } catch {
        return '[Thrown]'
      }
    }
    return columnIndex === 0 ? tableCellText(row) : ''
  }))

  while (cells.length < 1) cells.push(Array.from({ length: columnCount }, () => ''))
  const tableColumnWidthsPx = materializedTableColumnWidthsPx(node, columnCount)
  return {
    ...node,
    tableHeaders: headers,
    tableCells: cells,
    tableRows: cells.length,
    tableColumns: columnCount,
    ...(tableColumnWidthsPx === undefined ? {} : { tableColumnWidthsPx })
  }
}

/**
 * 将运行时覆盖值物化成只读视觉节点。未绑定时直接返回原节点；有绑定时仅浅拷贝，
 * 表格数组只在表格绑定变化时生成，绝不把实时值写回图纸 JSON。
 */
export function materializeRuntimeNode(node, getPointValue) {
  if (!node || typeof node !== 'object' || !Array.isArray(node.dataBindings) || !node.dataBindings.length) return node

  const overrides = resolveNodeDataBindings(node, getPointValue)
  const targets = Object.keys(overrides)
  if (!targets.length) return node

  let effective = { ...node }
  let signalColors = null
  let chartSeries = null
  if (Object.prototype.hasOwnProperty.call(overrides, 'tableData')) {
    effective = materializeTableData(effective, overrides.tableData)
  }
  if (node.type === 'table' && Object.prototype.hasOwnProperty.call(overrides, 'text')) {
    effective.text = overrides.text
    effective.tableTitle = overrides.text
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'tableTitle')) {
    effective.tableTitle = overrides.tableTitle
  }
  const hasHeaderOverride = Object.prototype.hasOwnProperty.call(overrides, 'tableHeaders')
  const hasRowOverride = Object.prototype.hasOwnProperty.call(overrides, 'tableCells')
  if (hasHeaderOverride || hasRowOverride) {
    effective = materializeTableSections(
      effective,
      hasHeaderOverride ? overrides.tableHeaders : effective.tableHeaders,
      hasRowOverride ? overrides.tableCells : effective.tableCells
    )
  }
  for (const target of targets) {
    if (TABLE_BINDING_TARGETS.has(target) || (node.type === 'table' && target === 'text')) continue
    if (target === 'tableRowFill' || (node.type === 'table' && target === 'fill')) {
      const color = runtimeColor(overrides[target], node.tableRowFill ?? node.fill)
      effective.tableRowFill = color
      effective.tableAltRowFill = color
      continue
    }
    if (target === 'tableBorderColor' || (node.type === 'table' && target === 'stroke')) {
      effective.tableBorderColor = runtimeColor(overrides[target], node.tableBorderColor ?? node.stroke)
      continue
    }
    if (target === 'fill' || target === 'stroke' || target === 'visualPrimaryColor' || target === 'polylineColor' || target === 'chartColor') {
      effective[target] = runtimeColor(overrides[target], node[target])
      continue
    }
    if (target === 'animationPlaying') {
      effective.animationPaused = !Boolean(overrides.animationPlaying)
      continue
    }
    if (target === 'value' && node.type === 'time') {
      effective.value = overrides.value
      effective.defaultValue = overrides.value
      effective.timeUseServer = false
      effective.timeRunning = false
      continue
    }
    const signalColorMatch = SIGNAL_COLOR_TARGET_PATTERN.exec(target)
    if (signalColorMatch && Number(signalColorMatch[1]) < MAX_SIGNAL_COLORS) {
      if (!signalColors) {
        signalColors = Array.isArray(node.signalColors)
          ? node.signalColors.slice(0, MAX_SIGNAL_COLORS)
          : [node.signalColor || '#21c58e']
        effective.signalColors = signalColors
      }
      const index = Number(signalColorMatch[1])
      signalColors[index] = runtimeColor(overrides[target], signalColors[index])
      continue
    }
    const chartSeriesMatch = CHART_SERIES_TARGET_PATTERN.exec(target)
    if (chartSeriesMatch) {
      const index = Number(chartSeriesMatch[1])
      const field = chartSeriesMatch[2]
      if (index >= MAX_EDITABLE_CHART_SERIES) continue
      if (!chartSeries) {
        chartSeries = chartSeriesFromNode(effective).map(series => ({ ...series, data: series.data }))
        effective.chartSeries = chartSeries
      }
      if (!chartSeries[index]) continue
      const fallback = chartSeries[index][field]
      const value = field === 'color'
        ? runtimeColor(overrides[target], fallback)
        : overrides[target]
      chartSeries[index] = { ...chartSeries[index], [field]: value }
      if (index === 0) {
        if (field === 'name') effective.chartSeriesName = value
        else if (field === 'color') effective.chartColor = value
        else effective.chartData = value
      }
      continue
    }
    if (DIRECT_TARGETS.has(target)) effective[target] = overrides[target]
  }
  return effective
}

export function hasEnabledRuntimeBinding(node, target) {
  return Array.isArray(node?.dataBindings) && node.dataBindings.some(binding => (
    binding?.enabled !== false
    && String(binding?.target ?? '').trim() === target
    && Boolean(bindingRuntimeKey(binding))
  ))
}

/** 将图表数据压缩成 0-100 的柱高，供 DOM 预览和鹰眼复用。 */
export function runtimeChartPercentages(node, maximumBars = MAX_RUNTIME_CHART_BARS) {
  const source = node?.chartData
  const rows = Array.isArray(source?.rows) ? source.rows : Array.isArray(source) ? source : []
  const values = []
  const requestedBars = Math.max(1, Math.trunc(Number(maximumBars) || MAX_RUNTIME_CHART_BARS))
  const rowCount = Math.min(rows.length, MAX_RUNTIME_CHART_BARS, requestedBars)
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex]
    let value
    if (Array.isArray(row)) {
      const candidateCount = Math.min(row.length, MAX_RUNTIME_TABLE_COLUMNS)
      for (let index = 0; index < candidateCount; index += 1) {
        const candidate = Number(row[index])
        if (Number.isFinite(candidate)) {
          value = candidate
          break
        }
      }
    } else if (row && typeof row === 'object') {
      let inspected = 0
      for (const key in row) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue
        const candidate = Number(row[key])
        inspected += 1
        if (Number.isFinite(candidate)) {
          value = candidate
          break
        }
        if (inspected >= MAX_RUNTIME_TABLE_COLUMNS) break
      }
    } else {
      const candidate = Number(row)
      if (Number.isFinite(candidate)) value = candidate
    }
    if (value != null) values.push(value)
  }
  if (!values.length) return [35, 70, 48, 85]
  const ceiling = Math.max(1, ...values.map(value => Math.abs(value)))
  return values.map(value => Math.max(2, Math.min(100, Math.abs(value) / ceiling * 100)))
}
