function validIndex(value, fallback) {
  const index = Number(value)
  return Number.isInteger(index) && index >= 0 ? index : fallback
}

/**
 * Copies mutable containers while retaining immutable primitive values by
 * reference. In particular, large data URLs are never serialized or copied.
 */
export function cloneHistoryValue(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return new Date(value.getTime())

  const clone = Array.isArray(value) ? [] : {}
  seen.set(value, clone)
  for (const key of Object.keys(value)) clone[key] = cloneHistoryValue(value[key], seen)
  return clone
}

export function historyValuesEqual(left, right, seen = new Map()) {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false

  let compared = seen.get(left)
  if (!compared) {
    compared = new Set()
    seen.set(left, compared)
  } else if (compared.has(right)) return true
  compared.add(right)

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !historyValuesEqual(left[key], right[key], seen)) return false
  }
  return true
}

export function captureFieldRecord(target, fields = Object.keys(target || {})) {
  if (!target?.id) return null
  const values = {}
  for (const field of fields) values[field] = cloneHistoryValue(target[field])
  return { id: target.id, values }
}

export function fieldRecordChanged(target, record) {
  if (!target || !record) return false
  return Object.entries(record.values || {}).some(([field, value]) => !historyValuesEqual(target[field], value))
}

export function captureInverseFieldRecord(target, record) {
  return target ? captureFieldRecord(target, Object.keys(record?.values || {})) : null
}

export function applyFieldRecord(target, record) {
  if (!target || !record) return []
  const changedFields = []
  for (const [field, value] of Object.entries(record.values || {})) {
    if (historyValuesEqual(target[field], value)) continue
    target[field] = cloneHistoryValue(value)
    changedFields.push(field)
  }
  return changedFields
}

export function createListInsertionRecords(items = [], startIndex = 0) {
  const start = validIndex(startIndex, 0)
  return items.map((item, offset) => ({ id: item.id, index: start + offset, value: null }))
}

export function createListRemovalRecords(items = [], source = []) {
  const positions = new Map(source.map((item, index) => [item.id, index]))
  return items.flatMap(item => {
    const index = positions.get(item?.id)
    return index == null ? [] : [{ id: item.id, index, value: cloneHistoryValue(item) }]
  })
}

export function captureInverseListRecords(records = [], source = []) {
  let fallbackIndex = null
  return records.map(record => {
    const expectedIndex = validIndex(record.index, -1)
    const expected = expectedIndex >= 0 ? source[expectedIndex] : null
    let current = expected?.id === record.id ? { value: expected, index: expectedIndex } : null
    if (!current) {
      fallbackIndex ||= new Map(source.map((item, index) => [item.id, { value: item, index }]))
      current = fallbackIndex.get(record.id) || null
    }
    return {
      id: record.id,
      index: current?.index ?? validIndex(record.index, source.length),
      value: current ? cloneHistoryValue(current.value) : null
    }
  })
}

export function applyListRecords(records = [], source = []) {
  const removals = records
    .filter(record => record.value === null)
    .map(record => ({ id: record.id, index: validIndex(record.index, -1) }))
    .sort((left, right) => right.index - left.index)

  for (const removal of removals) {
    if (removal.index >= 0 && source[removal.index]?.id === removal.id) {
      source.splice(removal.index, 1)
      continue
    }
    const fallback = source.findIndex(item => item?.id === removal.id)
    if (fallback >= 0) source.splice(fallback, 1)
  }

  const restorations = records
    .filter(record => record.value !== null)
    .map((record, order) => ({ record, order }))
    .sort((left, right) => validIndex(left.record.index, source.length) - validIndex(right.record.index, source.length) || left.order - right.order)
  for (const { record } of restorations) {
    const index = Math.min(validIndex(record.index, source.length), source.length)
    source.splice(index, 0, cloneHistoryValue(record.value))
  }
  return source
}

/** Estimates retained memory without materializing a serialized copy. */
export function historyValueBytes(value, seen = new Set()) {
  if (value == null) return 4
  if (typeof value === 'string') return value.length * 2
  if (typeof value === 'number' || typeof value === 'bigint') return 8
  if (typeof value === 'boolean') return 4
  if (typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)

  let bytes = Array.isArray(value) ? 16 : 32
  for (const key of Object.keys(value)) {
    bytes += key.length * 2
    bytes += historyValueBytes(value[key], seen)
  }
  return bytes
}
