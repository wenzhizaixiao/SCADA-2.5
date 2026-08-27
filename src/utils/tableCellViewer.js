function integer(value, fallback = -1) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : fallback
}

function positiveSpan(value) {
  return Math.max(1, integer(value, 1))
}

function headerText(value, column) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const title = value.title ?? value.label ?? value.name ?? value.key
    if (title != null && String(title)) return String(title)
  } else if (value != null && String(value)) return String(value)
  return `第 ${column + 1} 列`
}

export function createTableCellViewPayload(node, cell) {
  const row = integer(cell?.row)
  const column = integer(cell?.column)
  if (!node || node.type !== 'table' || row < 0 || column < 0) return null
  return {
    row,
    column,
    rowSpan: positiveSpan(cell?.rowSpan),
    columnSpan: positiveSpan(cell?.columnSpan),
    title: headerText(node.tableHeaders?.[column], column),
    text: String(cell?.text ?? node.tableCells?.[row]?.[column] ?? '')
  }
}

export function resolveTableCellViewDetail(node, viewer) {
  const row = integer(viewer?.row)
  const column = integer(viewer?.column)
  if (!node || node.type !== 'table' || row < 0 || column < 0) return null

  const merge = (node.tableMerges || []).find(item => item.row === row && item.column === column)
  const rowSpan = positiveSpan(viewer?.rowSpan ?? merge?.rowSpan)
  const columnSpan = positiveSpan(viewer?.columnSpan ?? merge?.columnSpan)
  const hasRenderedTitle = Object.prototype.hasOwnProperty.call(viewer || {}, 'title')
  const hasRenderedText = Object.prototype.hasOwnProperty.call(viewer || {}, 'text')
  const rowPosition = rowSpan > 1 ? `第 ${row + 1}-${row + rowSpan} 行` : `第 ${row + 1} 行`
  const columnPosition = columnSpan > 1 ? `第 ${column + 1}-${column + columnSpan} 列` : `第 ${column + 1} 列`

  if (!hasRenderedText && !Array.isArray(node.tableCells?.[row])) return null
  return {
    title: hasRenderedTitle ? String(viewer.title || `第 ${column + 1} 列`) : headerText(node.tableHeaders?.[column], column),
    position: `${rowPosition} · ${columnPosition}`,
    text: String(hasRenderedText ? viewer.text ?? '' : node.tableCells[row][column] ?? '')
  }
}
