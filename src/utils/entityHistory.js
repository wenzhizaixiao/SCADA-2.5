import { toRaw } from 'vue'
import { cloneHistoryValue } from './historyPatches.js'

const ENTITY_COLLECTIONS = ['nodes', 'edges', 'drawings']

function validIndex(value, fallback) {
  const index = Number(value)
  return Number.isInteger(index) && index >= 0 ? index : fallback
}

function targetEntityPositions(source, items) {
  const remainingIds = new Set(items.map(item => item.id))
  const positions = new Map()
  const sourceLength = source.length
  for (let position = 0; position < sourceLength && remainingIds.size; position += 1) {
    const entity = source[position]
    if (!remainingIds.has(entity?.id)) continue
    positions.set(entity.id, { entity, position })
    remainingIds.delete(entity.id)
  }
  return positions
}

/**
 * 新增实体的撤销目标是“不存在”。这里只记录 ID 和插入位置，
 * 避免新增一个组件时复制整张大图纸。
 */
export function createEntityInsertionEntry(payload = {}, collectionSizes = {}) {
  const entry = { kind: 'entities' }
  for (const name of ENTITY_COLLECTIONS) {
    const startIndex = validIndex(collectionSizes[name], 0)
    entry[name] = (payload[name] || []).map((entity, offset) => ({
      id: entity.id,
      index: startIndex + offset,
      value: null
    }))
  }
  return entry
}

/** 捕获指定实体当前的完整状态，作为撤销/重做的逆操作。 */
export function captureEntityEntry(entry, collections = {}, options = {}) {
  const reuseEntityReferences = options.reuseEntityReferences === true
  const captured = { kind: 'entities' }
  for (const name of ENTITY_COLLECTIONS) {
    const source = collections[name] || []
    const items = entry[name] || []
    if (!items.length) {
      captured[name] = []
      continue
    }
    let fallbackIndex = null
    captured[name] = items.map(item => {
      let current = null
      if (item.value === null) {
        const expectedPosition = validIndex(item.index, -1)
        const expectedEntity = expectedPosition >= 0 ? source[expectedPosition] : null
        current = expectedEntity?.id === item.id
          ? { entity: expectedEntity, position: expectedPosition }
          : null
        if (!current) {
          // 正常的撤销/重做可按记录位置 O(1) 命中；位置变化时才建立兜底索引。
          fallbackIndex ||= targetEntityPositions(source, items)
          current = fallbackIndex.get(item.id)
        }
      }
      return {
        id: item.id,
        index: current?.position ?? validIndex(item.index, source.length),
        value: current
          ? (reuseEntityReferences ? current.entity : cloneHistoryValue(current.entity))
          : null
      }
    })
  }
  return captured
}

function descendingIndexRanges(items) {
  const ranges = []
  for (const item of items) {
    const current = ranges.at(-1)
    if (current && item.index === current.start - 1) current.start = item.index
    else ranges.push({ start: item.index, end: item.index })
  }
  return ranges
}

function restorationGroups(items, fallbackLength) {
  const groups = []
  for (const item of items) {
    const index = validIndex(item.item.index, fallbackLength)
    const current = groups.at(-1)
    if (current && index === current.lastIndex + 1) {
      current.items.push(item.item)
      current.lastIndex = index
    } else {
      groups.push({ index, lastIndex: index, items: [item.item] })
    }
  }
  return groups
}

/**
 * 原位应用实体状态，保留未参与本次操作的数组和对象引用。
 * normalizers 用于把历史中的普通对象恢复成当前版本的规范模型。
 * mutateRawCollections 只负责跳过响应式逐项写入；调用方必须在索引同步后发布集合变更。
 */
export function applyEntityEntry(entry, collections = {}, normalizers = {}, options = {}) {
  const reuseEntityReferences = options.reuseEntityReferences === true
  const mutateRawCollections = options.mutateRawCollections === true
  const changes = {}
  for (const name of ENTITY_COLLECTIONS) {
    const source = collections[name] || []
    const mutationSource = mutateRawCollections ? toRaw(source) : source
    const items = entry[name] || []
    if (!items.length) {
      changes[name] = { removed: [], inserted: [] }
      continue
    }
    const removalItems = items.filter(item => item.value === null)
    const targetIds = new Set(removalItems.map(item => item.id))
    const removed = []
    const inserted = []

    // 先倒序移除目标实体，再按原位置升序恢复，多个实体也能保持原顺序。
    const directRemovals = removalItems
      .map(item => ({ id: item.id, index: validIndex(item.index, -1) }))
      .sort((a, b) => b.index - a.index)
    const canRemoveDirectly = directRemovals.every(item => item.index >= 0 && source[item.index]?.id === item.id)
    if (directRemovals.length && canRemoveDirectly) {
      for (const range of descendingIndexRanges(directRemovals)) {
        const length = range.end - range.start + 1
        const values = mutateRawCollections
          ? Array.from({ length }, (_, offset) => source[range.start + offset])
          : null
        const removedValues = mutationSource.splice(range.start, length)
        const retainedValues = values || removedValues
        retainedValues.forEach((value, offset) => removed.push({ id: value.id, index: range.start + offset, value }))
      }
    } else if (directRemovals.length) {
      const matches = []
      for (let index = source.length - 1; index >= 0; index -= 1) {
        if (!targetIds.has(source[index]?.id)) continue
        matches.push({ id: source[index].id, index })
      }
      for (const range of descendingIndexRanges(matches)) {
        const length = range.end - range.start + 1
        const values = mutateRawCollections
          ? Array.from({ length }, (_, offset) => source[range.start + offset])
          : null
        const removedValues = mutationSource.splice(range.start, length)
        const retainedValues = values || removedValues
        retainedValues.forEach((value, offset) => removed.push({ id: value.id, index: range.start + offset, value }))
      }
    }

    const restorations = items
      .filter(item => item.value !== null)
      .map((item, order) => ({ item, order }))
      .sort((a, b) => validIndex(a.item.index, source.length) - validIndex(b.item.index, source.length) || a.order - b.order)

    for (const group of restorationGroups(restorations, source.length)) {
      const entities = group.items.map(item => {
        if (reuseEntityReferences) return item.value
        const cloned = cloneHistoryValue(item.value)
        return normalizers[name] ? normalizers[name](cloned) : cloned
      })
      const index = Math.min(group.index, source.length)
      const mutationEntities = mutateRawCollections ? entities.map(toRaw) : entities
      mutationSource.splice(index, 0, ...mutationEntities)
      entities.forEach((entity, offset) => {
        inserted.push({ id: entity.id, index: index + offset, value: source[index + offset] })
      })
    }
    changes[name] = { removed, inserted }
  }
  return changes
}
