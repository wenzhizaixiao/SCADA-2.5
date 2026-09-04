export const MAX_EDITABLE_CHART_ITEMS = 2000
const MAX_MAPPED_DATA_ITEMS = MAX_EDITABLE_CHART_ITEMS
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function inputNumber(value) {
  if (typeof value === 'string' && !value.trim()) return null
  return finiteNumber(value)
}

function rowSourceIndex(row) {
  const index = row?.sourceIndex
  return Number.isInteger(index) && index >= 0 && index < MAX_MAPPED_DATA_ITEMS ? index : null
}

function chartKind(node) {
  const type = node?.chartType ?? node?.type
  if (type === 'scatter' || type === 'scatterChart') return 'scatter'
  if (type === 'pie' || type === 'pieChart') return 'pie'
  return 'scalar'
}

function dataAccess(node) {
  const source = node?.chartData
  if (Array.isArray(source)) {
    return { rows: source, wrap: rows => rows }
  }
  if (plainRecord(source)) {
    const rows = Array.isArray(source.rows) ? source.rows : []
    return { rows, wrap: nextRows => ({ ...source, rows: nextRows }) }
  }
  return { rows: [], wrap: rows => rows }
}

function configuredLabels(node) {
  if (Array.isArray(node?.chartLabels)) return node.chartLabels
  if (Array.isArray(node?.xAxisData)) return node.xAxisData
  return []
}

function scalarLocation(row) {
  if (Array.isArray(row)) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (finiteNumber(row[index]) !== null) return { kind: 'array', index }
    }
    return null
  }
  if (plainRecord(row)) {
    if (finiteNumber(row.value) !== null) return { kind: 'object', key: 'value' }
    for (const key of Object.keys(row)) {
      if (UNSAFE_KEYS.has(key)) continue
      if (finiteNumber(row[key]) !== null) return { kind: 'object', key }
    }
    return null
  }
  return finiteNumber(row) === null ? null : { kind: 'primitive' }
}

function scatterCoordinates(row, sourceIndex) {
  let x = null
  let y = null
  if (Array.isArray(row)) {
    x = finiteNumber(row[0])
    y = finiteNumber(row[1])
  } else if (plainRecord(row)) {
    const value = Array.isArray(row.value) ? row.value : null
    x = finiteNumber(value ? value[0] : row.x)
    y = finiteNumber(value ? value[1] : row.y ?? row.value)
    if (x === null && y !== null) x = sourceIndex + 1
  } else {
    y = finiteNumber(row)
    if (y !== null) x = sourceIndex + 1
  }
  return x === null || y === null ? null : { x, y }
}

function validSourceRow(row, index, kind) {
  return kind === 'scatter'
    ? scatterCoordinates(row, index) !== null
    : scalarLocation(row) !== null
}

function hasMappedSourceRows(rows, kind) {
  const limit = Math.min(rows.length, MAX_MAPPED_DATA_ITEMS)
  for (let index = 0; index < limit; index += 1) {
    if (validSourceRow(rows[index], index, kind)) return true
  }
  return false
}

function normalizedRows(rows) {
  return Array.isArray(rows) ? rows : []
}

function normalizedIndex(row, rows) {
  const index = row?.index
  if (Number.isInteger(index) && index >= 0 && index < rows.length) return index
  const identityIndex = rows.indexOf(row)
  if (identityIndex >= 0) return identityIndex
  const sourceIndex = rowSourceIndex(row)
  return sourceIndex !== null && sourceIndex < rows.length ? sourceIndex : null
}

function materializedRowValues(rows, kind) {
  const result = []
  for (const row of rows) {
    if (kind === 'scatter') {
      const x = finiteNumber(row?.x)
      const y = finiteNumber(row?.y)
      if (x === null || y === null) return null
      result.push([x, y])
      continue
    }
    const value = finiteNumber(row?.value)
    if (value === null) return null
    result.push(kind === 'pie' ? Math.max(0, value) : value)
  }
  return result
}

function materializedLabels(node, rows) {
  const result = configuredLabels(node).slice()
  for (let index = 0; index < rows.length; index += 1) {
    result[index] = String(rows[index]?.label ?? `数据 ${index + 1}`)
  }
  return result
}

function editableData(node, rows) {
  const access = dataAccess(node)
  const kind = chartKind(node)
  if (hasMappedSourceRows(access.rows, kind)) {
    return { access, kind, rows: access.rows.slice(), materialized: false }
  }
  const materialized = materializedRowValues(rows, kind)
  if (!materialized) return null
  const nextRows = access.rows.slice()
  for (let index = 0; index < materialized.length; index += 1) nextRows[index] = materialized[index]
  return { access, kind, rows: nextRows, materialized: true }
}

function replacementValue(previous, value) {
  if (typeof previous === 'string') return String(value)
  if (Array.isArray(previous) && previous.length === 1 && finiteNumber(previous) !== null) {
    const next = previous.slice()
    next[0] = replacementValue(previous[0], value)
    return next
  }
  return value
}

function replaceScalarRow(row, value) {
  const location = scalarLocation(row)
  if (!location) return null
  if (location.kind === 'primitive') return replacementValue(row, value)
  if (location.kind === 'array') {
    const next = row.slice()
    next[location.index] = replacementValue(row[location.index], value)
    return next
  }
  return { ...row, [location.key]: replacementValue(row[location.key], value) }
}

function replaceScatterRow(row, rowView, value, field) {
  if (Array.isArray(row)) {
    const next = row.slice()
    next[field === 'x' ? 0 : 1] = replacementValue(next[field === 'x' ? 0 : 1], value)
    return next
  }
  if (plainRecord(row)) {
    if (Array.isArray(row.value)) {
      const point = row.value.slice()
      point[field === 'x' ? 0 : 1] = replacementValue(point[field === 'x' ? 0 : 1], value)
      return { ...row, value: point }
    }
    if (field === 'x') return { ...row, x: replacementValue(row.x, value) }
    if (row.y !== undefined && row.y !== null) {
      return { ...row, y: replacementValue(row.y, value) }
    }
    if (finiteNumber(row.value) !== null) {
      return { ...row, value: replacementValue(row.value, value) }
    }
    return { ...row, y: value }
  }
  if (field === 'y') return replacementValue(row, value)
  const y = finiteNumber(rowView?.y ?? row)
  return y === null ? null : [value, y]
}

function rowPatchIndex(row, rows, materialized) {
  return materialized ? normalizedIndex(row, rows) : rowSourceIndex(row)
}

/** Returns a patch; the supplied node and its nested values are never mutated. */
export function setChartRowLabel(node, row, label) {
  const sourceIndex = rowSourceIndex(row)
  if (sourceIndex === null) return null
  const labels = configuredLabels(node).slice()
  labels[sourceIndex] = String(label ?? '').slice(0, 120)
  return { chartLabels: labels }
}

/**
 * Updates a scalar value or one scatter coordinate at the row's original sourceIndex.
 * Pass the complete normalized row list when the renderer is showing derived defaults.
 */
export function setChartRowValue(node, row, value, { field = 'value', rows = [] } = {}) {
  const numeric = inputNumber(value)
  if (numeric === null) return null
  const views = normalizedRows(rows)
  const editable = editableData(node, views)
  if (!editable) return null
  if (editable.kind === 'scatter' && field !== 'x' && field !== 'y') return null
  if (editable.kind !== 'scatter' && field !== 'value') return null

  const index = rowPatchIndex(row, views, editable.materialized)
  if (index === null || index >= editable.rows.length) return null
  const nextValue = editable.kind === 'pie' ? Math.max(0, numeric) : numeric
  const nextRow = editable.kind === 'scatter'
    ? replaceScatterRow(editable.rows[index], row, nextValue, field)
    : replaceScalarRow(editable.rows[index], nextValue)
  if (nextRow === null) return null
  editable.rows[index] = nextRow

  const patch = { chartData: editable.access.wrap(editable.rows) }
  if (editable.materialized) patch.chartLabels = materializedLabels(node, views)
  return patch
}

/** Adds one row after the last mapped source row so it remains editable. */
export function addChartRow(node, rows = [], values = {}) {
  const views = normalizedRows(rows)
  const editable = editableData(node, views)
  if (!editable) return null
  const previous = views.at(-1)
  let nextRow
  if (editable.kind === 'scatter') {
    const previousX = finiteNumber(previous?.x) ?? 0
    const previousY = finiteNumber(previous?.y) ?? 0
    const x = inputNumber(values.x) ?? previousX + 1
    const y = inputNumber(values.y) ?? previousY
    nextRow = [x, y]
  } else {
    const previousValue = finiteNumber(previous?.value) ?? 50
    const value = inputNumber(values.value) ?? previousValue
    nextRow = editable.kind === 'pie' ? Math.max(0, value) : value
  }

  const lastVisibleSourceIndex = views.reduce((last, row) => {
    const sourceIndex = rowSourceIndex(row)
    return sourceIndex === null ? last : Math.max(last, sourceIndex)
  }, -1)
  const insertionIndex = editable.materialized
    ? Math.min(views.length, editable.rows.length)
    : Math.min(editable.rows.length, lastVisibleSourceIndex + 1)
  if (insertionIndex >= MAX_MAPPED_DATA_ITEMS) return null
  editable.rows.splice(insertionIndex, 0, nextRow)
  const labels = editable.materialized
    ? materializedLabels(node, views)
    : configuredLabels(node).slice()
  if (labels.length < insertionIndex) labels.length = insertionIndex
  const label = String(values.label ?? `数据 ${views.length + 1}`).slice(0, 120)
  labels.splice(insertionIndex, 0, label)
  return { chartData: editable.access.wrap(editable.rows), chartLabels: labels }
}

/** Removes the original data row and the label at that same source index. */
export function removeChartRow(node, row, { rows = [] } = {}) {
  const views = normalizedRows(rows)
  const editable = editableData(node, views)
  if (!editable) return null
  const index = rowPatchIndex(row, views, editable.materialized)
  if (index === null || index >= editable.rows.length) return null
  editable.rows.splice(index, 1)

  const labels = editable.materialized
    ? materializedLabels(node, views)
    : configuredLabels(node).slice()
  if (index < labels.length) labels.splice(index, 1)
  return { chartData: editable.access.wrap(editable.rows), chartLabels: labels }
}
