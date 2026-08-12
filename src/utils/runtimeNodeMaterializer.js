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
  'value',
  'progressValue',
  'chartData',
  'animationDuration'
])
const SIGNAL_COLOR_TARGET_PATTERN = /^signalColors\.(\d+)$/

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

/**
 * 将运行时覆盖值物化成只读视觉节点。未绑定时直接返回原节点；有绑定时仅浅拷贝，
 * 表格数组只在 tableData 变化时生成，绝不把实时值写回图纸 JSON。
 */
export function materializeRuntimeNode(node, getPointValue) {
  if (!node || typeof node !== 'object' || !Array.isArray(node.dataBindings) || !node.dataBindings.length) return node

  const overrides = resolveNodeDataBindings(node, getPointValue)
  const targets = Object.keys(overrides)
  if (!targets.length) return node

  let effective = { ...node }
  let signalColors = null
  for (const target of targets) {
    if (target === 'fill' || target === 'stroke' || target === 'visualPrimaryColor') {
      effective[target] = runtimeColor(overrides[target], node[target])
      continue
    }
    if (target === 'animationPlaying') {
      effective.animationPaused = !Boolean(overrides.animationPlaying)
      continue
    }
    if (target === 'tableData') {
      effective = materializeTableData(effective, overrides.tableData)
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
