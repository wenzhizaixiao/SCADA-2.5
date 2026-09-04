import {
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS
} from '../models/dataBindingModel.js'

export const TABLE_VIRTUALIZATION_CELL_THRESHOLD = 120
export const TABLE_VIRTUALIZATION_OVERSCAN_ROWS = 2
export const TABLE_VIRTUALIZATION_OVERSCAN_COLUMNS = 1

function splitValues(value, separator = ',') {
  return String(value || '').split(separator).map(item => item.trim()).filter(Boolean)
}

function tableSource(node) {
  const headers = Array.isArray(node.tableHeaders) ? node.tableHeaders : splitValues(node.options)
  const records = Array.isArray(node.tableCells)
    ? node.tableCells
    : splitValues(node.tableData, ';').map(row => splitValues(row))
  const columns = Math.max(1, Math.min(12, Number(node.tableColumns) || headers.length || 3))
  const rows = Math.max(1, Math.min(50, Number(node.tableRows) || records.length || 3))
  const headerOffset = node.showHeader === false ? 0 : 1
  return { headers, records, columns, rows, headerOffset }
}

function normalizedTrackSizes(values) {
  return Array.from(values || [], value => Math.max(.1, Number(value) || .1))
}

function visibleTrackRange(trackSizes, offset, viewportSize, overscan) {
  const sizes = normalizedTrackSizes(trackSizes)
  const count = sizes.length
  if (!count) return { start: 0, end: 0 }

  const visibleStart = Math.max(0, Number(offset) || 0)
  const visibleEnd = visibleStart + Math.max(1, Number(viewportSize) || 1)
  let cursor = 0
  let start = 0
  while (start < count && cursor + sizes[start] <= visibleStart) {
    cursor += sizes[start]
    start += 1
  }
  if (start >= count) return { start: count - 1, end: count }

  let end = start
  while (end < count && cursor < visibleEnd) {
    cursor += sizes[end]
    end += 1
  }
  const padding = Math.max(0, Math.floor(Number(overscan) || 0))
  return {
    start: Math.max(0, start - padding),
    end: Math.min(count, Math.max(start + 1, end) + padding)
  }
}

export function shouldVirtualizeTable(node, threshold = TABLE_VIRTUALIZATION_CELL_THRESHOLD) {
  const { columns, rows, headerOffset } = tableSource(node)
  return columns * (rows + headerOffset) > Math.max(1, Number(threshold) || TABLE_VIRTUALIZATION_CELL_THRESHOLD)
}

export function createTableVirtualWindow({
  rowHeights,
  columnWidths,
  scrollTop = 0,
  scrollLeft = 0,
  viewportWidth = 1,
  viewportHeight = 1,
  gridOffsetTop = 0,
  overscanRows = TABLE_VIRTUALIZATION_OVERSCAN_ROWS,
  overscanColumns = TABLE_VIRTUALIZATION_OVERSCAN_COLUMNS
}) {
  const top = Math.max(0, Number(scrollTop) || 0)
  const height = Math.max(1, Number(viewportHeight) || 1)
  const gridTop = Math.max(0, Number(gridOffsetTop) || 0)
  const gridVisibleStart = Math.max(0, top - gridTop)
  const gridVisibleEnd = Math.max(gridVisibleStart + 1, top + height - gridTop)
  const rows = visibleTrackRange(rowHeights, gridVisibleStart, gridVisibleEnd - gridVisibleStart, overscanRows)
  const columns = visibleTrackRange(columnWidths, scrollLeft, viewportWidth, overscanColumns)
  return {
    rowStart: rows.start,
    rowEnd: rows.end,
    columnStart: columns.start,
    columnEnd: columns.end
  }
}

function normalizedWindow(window, rows, columns, headerOffset) {
  const trackCount = rows + headerOffset
  if (!window) {
    return { rowStart: 0, rowEnd: trackCount, columnStart: 0, columnEnd: columns }
  }
  const rowStart = Math.max(0, Math.min(trackCount, Math.floor(Number(window.rowStart) || 0)))
  const rowEnd = Math.max(rowStart, Math.min(trackCount, Math.ceil(Number(window.rowEnd) || 0)))
  const columnStart = Math.max(0, Math.min(columns, Math.floor(Number(window.columnStart) || 0)))
  const columnEnd = Math.max(columnStart, Math.min(columns, Math.ceil(Number(window.columnEnd) || 0)))
  return { rowStart, rowEnd, columnStart, columnEnd }
}

function validTableMerges(node, rows, columns) {
  const occupied = new Set()
  const merges = []
  const source = Array.isArray(node.tableMerges)
    ? node.tableMerges.slice(0, MAX_RUNTIME_TABLE_ROWS * MAX_RUNTIME_TABLE_COLUMNS)
    : []
  for (const item of source) {
    const row = Math.floor(Number(item?.row))
    const column = Math.floor(Number(item?.column))
    if (!Number.isFinite(row) || !Number.isFinite(column) || row < 0 || column < 0 || row >= rows || column >= columns) continue
    const rowSpan = Math.min(rows - row, Math.max(1, Math.floor(Number(item?.rowSpan)) || 1))
    const columnSpan = Math.min(columns - column, Math.max(1, Math.floor(Number(item?.columnSpan)) || 1))
    if (rowSpan === 1 && columnSpan === 1) continue

    const keys = []
    let overlaps = false
    for (let currentRow = row; currentRow < row + rowSpan; currentRow += 1) {
      for (let currentColumn = column; currentColumn < column + columnSpan; currentColumn += 1) {
        const key = `${currentRow}:${currentColumn}`
        keys.push(key)
        if (occupied.has(key)) overlaps = true
      }
    }
    if (overlaps) continue
    keys.forEach(key => occupied.add(key))
    merges.push({ row, column, rowSpan, columnSpan })
  }
  return { occupied, merges }
}

export function createTableCellModels(node, window) {
  const { headers, records, columns, rows, headerOffset } = tableSource(node)
  const visible = normalizedWindow(window, rows, columns, headerOffset)
  const bodyRowStart = Math.max(0, visible.rowStart - headerOffset)
  const bodyRowEnd = Math.max(bodyRowStart, Math.min(rows, visible.rowEnd - headerOffset))
  const { occupied, merges } = validTableMerges(node, rows, columns)
  const cells = []

  if (headerOffset && visible.rowStart === 0 && visible.rowEnd > 0) {
    for (let column = visible.columnStart; column < visible.columnEnd; column += 1) {
      cells.push({
        key: `header:${column}`,
        text: String(headers[column] ?? `\u5217 ${column + 1}`),
        header: true,
        row: -1,
        column,
        rowSpan: 1,
        columnSpan: 1,
        gridRow: 1,
        gridColumn: column + 1
      })
    }
  }

  for (const merge of merges) {
    const rowIntersects = merge.row < bodyRowEnd && merge.row + merge.rowSpan > bodyRowStart
    const columnIntersects = merge.column < visible.columnEnd && merge.column + merge.columnSpan > visible.columnStart
    if (!rowIntersects || !columnIntersects) continue
    cells.push({
      key: `cell:${merge.row}:${merge.column}`,
      text: String(records[merge.row]?.[merge.column] ?? ''),
      header: false,
      ...merge,
      gridRow: merge.row + headerOffset + 1,
      gridColumn: merge.column + 1
    })
  }

  for (let row = bodyRowStart; row < bodyRowEnd; row += 1) {
    for (let column = visible.columnStart; column < visible.columnEnd; column += 1) {
      const key = `${row}:${column}`
      if (occupied.has(key)) continue
      cells.push({
        key: `cell:${key}`,
        text: String(records[row]?.[column] ?? ''),
        header: false,
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        gridRow: row + headerOffset + 1,
        gridColumn: column + 1
      })
    }
  }

  cells.sort((left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn)
  return cells
}
