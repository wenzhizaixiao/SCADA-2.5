import { bindingPointIds } from '../models/dataBindingModel.js'
import {
  findSourceBindingRuntimeKey,
  isSourceBindingRuntimeKey,
  normalizeRuntimeKey
} from './runtimeKey.js'

const EMPTY_ITERABLE = Object.freeze([])

function validNodeId(value) {
  return value != null && value !== ''
}

function normalizedPointId(value) {
  return normalizeRuntimeKey(value)
}

function samePointIds(left, right) {
  if (!left || left.size !== right.size) return false
  for (const pointId of left) {
    if (!right.has(pointId)) return false
  }
  return true
}

/** 维护启用绑定的 pointId 与 nodeId 多对多关系，节点内相同点位只登记一次。 */
export function createDataBindingIndex() {
  const pointIdsByNodeId = new Map()
  const nodeIdsByPointId = new Map()

  const state = Object.freeze({
    get nodeCount() { return pointIdsByNodeId.size },
    get pointCount() { return nodeIdsByPointId.size }
  })

  function detach(nodeId) {
    const pointIds = pointIdsByNodeId.get(nodeId)
    if (!pointIds) return false
    pointIdsByNodeId.delete(nodeId)
    for (const pointId of pointIds) {
      const nodeIds = nodeIdsByPointId.get(pointId)
      if (!nodeIds) continue
      nodeIds.delete(nodeId)
      if (!nodeIds.size) nodeIdsByPointId.delete(pointId)
    }
    return true
  }

  function attach(nodeId, pointIds) {
    pointIdsByNodeId.set(nodeId, pointIds)
    for (const pointId of pointIds) {
      let nodeIds = nodeIdsByPointId.get(pointId)
      if (!nodeIds) {
        nodeIds = new Set()
        nodeIdsByPointId.set(pointId, nodeIds)
      }
      nodeIds.add(nodeId)
    }
  }

  function update(node) {
    const nodeId = node?.id
    if (!validNodeId(nodeId)) return false
    const nextPointIds = new Set(bindingPointIds(node))
    const previousPointIds = pointIdsByNodeId.get(nodeId)
    if (samePointIds(previousPointIds, nextPointIds) || (!previousPointIds && !nextPointIds.size)) return false
    detach(nodeId)
    if (nextPointIds.size) attach(nodeId, nextPointIds)
    return true
  }

  function add(nodes = []) {
    let changed = 0
    for (const node of nodes) {
      if (update(node)) changed += 1
    }
    return changed
  }

  function remove(nodes = []) {
    let removed = 0
    for (const nodeOrId of nodes) {
      const nodeId = typeof nodeOrId === 'object' && nodeOrId != null ? nodeOrId.id : nodeOrId
      if (validNodeId(nodeId) && detach(nodeId)) removed += 1
    }
    return removed
  }

  function rebuild(nodes = []) {
    pointIdsByNodeId.clear()
    nodeIdsByPointId.clear()
    add(nodes)
    return state
  }

  function pointIdsFor(nodeOrId) {
    const nodeId = typeof nodeOrId === 'object' && nodeOrId != null ? nodeOrId.id : nodeOrId
    return validNodeId(nodeId) ? pointIdsByNodeId.get(nodeId)?.values() ?? EMPTY_ITERABLE : EMPTY_ITERABLE
  }

  function nodeIdsFor(rawPointId) {
    const pointId = normalizedPointId(rawPointId)
    if (!pointId) return EMPTY_ITERABLE
    const direct = nodeIdsByPointId.get(pointId)
    if (isSourceBindingRuntimeKey(pointId)) return direct?.values() ?? EMPTY_ITERABLE
    const sourceKey = findSourceBindingRuntimeKey(pointId)
    const sourceNodes = sourceKey ? nodeIdsByPointId.get(sourceKey) : null
    if (!direct) return sourceNodes?.values() ?? EMPTY_ITERABLE
    if (!sourceNodes) return direct.values()
    return new Set([...direct, ...sourceNodes]).values()
  }

  function countFor(rawPointId) {
    const pointId = normalizedPointId(rawPointId)
    if (!pointId) return 0
    const direct = nodeIdsByPointId.get(pointId)
    if (isSourceBindingRuntimeKey(pointId)) return direct?.size ?? 0
    const sourceKey = findSourceBindingRuntimeKey(pointId)
    const sourceNodes = sourceKey ? nodeIdsByPointId.get(sourceKey) : null
    if (!direct) return sourceNodes?.size ?? 0
    if (!sourceNodes) return direct.size
    return new Set([...direct, ...sourceNodes]).size
  }

  function keys() {
    return nodeIdsByPointId.keys()
  }

  return Object.freeze({ state, rebuild, add, remove, update, pointIdsFor, nodeIdsFor, countFor, keys })
}
