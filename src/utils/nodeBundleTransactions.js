import { reactive, toRaw } from 'vue'

import { normalizeEdge, normalizeNode } from '../models/editorModel.js'
import { createDataKeyIndex, createEdgeAdjacencyIndex } from './documentIndexes.js'
import { edgeBoundsForNodes } from './edgeGeometry.js'
import { cloneHistoryValue, historyValueBytes } from './historyPatches.js'
import { rotatedFrameBounds } from './editorGeometry.js'
import { createSpatialIndex } from './spatialIndex.js'

export const LARGE_NODE_BUNDLE_THRESHOLD = 64
export const LARGE_EDGE_BUNDLE_THRESHOLD = 128
export const NODE_BUNDLE_FRAME_BUDGET_MS = 2

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function deadlineYielded(deadline, operations, maxOperations) {
  return operations >= maxOperations || (operations > 0 && deadline?.shouldYield?.())
}

function createLayerSortTask(items) {
  const input = Array.isArray(items) ? items : []
  return {
    input,
    source: [],
    buffer: new Array(input.length),
    phase: 'copy',
    index: 0,
    width: 1,
    left: 0,
    middle: 0,
    right: 0,
    leftIndex: 0,
    rightIndex: 0,
    outputIndex: 0,
    result: input.length ? null : []
  }
}

function layerValue(item) {
  return finiteNumber(item?.layer)
}

function advanceLayerSort(task) {
  if (task.result) return true
  if (task.phase === 'copy') {
    task.source.push(task.input[task.index++])
    if (task.index >= task.input.length) {
      if (task.input.length <= 1) {
        task.result = task.source
        return true
      }
      task.phase = 'mergeSetup'
    }
    return false
  }
  if (task.phase === 'mergeSetup') {
    if (task.left >= task.source.length) {
      ;[task.source, task.buffer] = [task.buffer, task.source]
      task.width *= 2
      task.left = 0
      if (task.width >= task.source.length) {
        task.result = task.source
        return true
      }
    }
    task.middle = Math.min(task.left + task.width, task.source.length)
    task.right = Math.min(task.left + task.width * 2, task.source.length)
    task.leftIndex = task.left
    task.rightIndex = task.middle
    task.outputIndex = task.left
    task.phase = 'merge'
    return false
  }
  const takeLeft = task.leftIndex < task.middle && (
    task.rightIndex >= task.right
    || layerValue(task.source[task.leftIndex]) <= layerValue(task.source[task.rightIndex])
  )
  task.buffer[task.outputIndex++] = takeLeft
    ? task.source[task.leftIndex++]
    : task.source[task.rightIndex++]
  if (task.outputIndex >= task.right) {
    task.left += task.width * 2
    task.phase = 'mergeSetup'
  }
  return false
}

function resetNodeInstanceState(node) {
  if (node.type === 'button') {
    node.clickCount = 0
    node.buttonFeedback = ''
  }
  if (['checkbox', 'radio', 'switch'].includes(node.type) || (node.type === 'button' && node.buttonAction === 'toggle')) {
    node.checked = Boolean(node.defaultChecked)
  }
  if (['input', 'select'].includes(node.type)) node.value = String(node.defaultValue ?? node.value ?? '')
  return node
}

export function shouldPrepareNodeBundleAsync(nodeCount, edgeCount = 0) {
  return Number(nodeCount) > LARGE_NODE_BUNDLE_THRESHOLD || Number(edgeCount) > LARGE_EDGE_BUNDLE_THRESHOLD
}

/**
 * Captures a selected node bundle without scanning the document edge array.
 * Adjacency traversal, bounds and cloning all resume at entity boundaries.
 */
export function createNodeBundleCaptureTask(options = {}) {
  const sourceNodes = Array.isArray(options.nodes) ? options.nodes : []
  return {
    phase: sourceNodes.length ? 'sort' : 'done',
    sourceNodes: [],
    sortTask: createLayerSortTask(sourceNodes),
    adjacency: options.adjacency,
    clone: typeof options.clone === 'function' ? options.clone : value => cloneHistoryValue(toRaw(value)),
    transformNode: typeof options.transformNode === 'function' ? options.transformNode : null,
    getBounds: typeof options.getBounds === 'function' ? options.getBounds : rotatedFrameBounds,
    index: 0,
    edgeNodeIndex: 0,
    edgeIterator: null,
    sourceIds: new Set(),
    seenEdgeIds: new Set(),
    internalEdges: [],
    clonedNodes: [],
    clonedEdges: [],
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    result: null,
    operations: 0
  }
}

function advanceCaptureTask(task) {
  if (task.phase === 'sort') {
    if (advanceLayerSort(task.sortTask)) {
      task.sourceNodes = task.sortTask.result
      task.phase = 'bounds'
      task.index = 0
    }
    return
  }
  if (task.phase === 'bounds') {
    const node = task.sourceNodes[task.index++]
    task.sourceIds.add(node.id)
    const frame = task.getBounds(node)
    task.minX = Math.min(task.minX, frame.x)
    task.minY = Math.min(task.minY, frame.y)
    task.maxX = Math.max(task.maxX, frame.x + frame.w)
    task.maxY = Math.max(task.maxY, frame.y + frame.h)
    if (task.index >= task.sourceNodes.length) {
      task.phase = 'edges'
      task.index = 0
    }
    return
  }

  if (task.phase === 'edges') {
    while (!task.edgeIterator && task.edgeNodeIndex < task.sourceNodes.length) {
      task.edgeIterator = task.adjacency?.get?.(task.sourceNodes[task.edgeNodeIndex++].id)?.[Symbol.iterator]?.() || [][Symbol.iterator]()
    }
    const next = task.edgeIterator?.next()
    if (next && !next.done) {
      const edge = next.value
      if (
        edge?.id
        && !task.seenEdgeIds.has(edge.id)
        && task.sourceIds.has(edge.from)
        && task.sourceIds.has(edge.to)
      ) {
        task.seenEdgeIds.add(edge.id)
        task.internalEdges.push(edge)
      }
      return
    }
    task.edgeIterator = null
    if (task.edgeNodeIndex >= task.sourceNodes.length) {
      task.phase = 'cloneNodes'
      task.index = 0
    }
    return
  }

  if (task.phase === 'cloneNodes') {
    const source = task.sourceNodes[task.index++]
    const cloned = {
      ...task.clone(source),
      x: finiteNumber(source.x) - task.minX,
      y: finiteNumber(source.y) - task.minY
    }
    task.clonedNodes.push(task.transformNode ? task.transformNode(cloned) : cloned)
    if (task.index >= task.sourceNodes.length) {
      task.phase = 'cloneEdges'
      task.index = 0
    }
    return
  }

  if (task.phase === 'cloneEdges') {
    if (task.index < task.internalEdges.length) task.clonedEdges.push(task.clone(task.internalEdges[task.index++]))
    if (task.index >= task.internalEdges.length) {
      task.result = {
        width: Math.max(1, task.maxX - task.minX),
        height: Math.max(1, task.maxY - task.minY),
        originX: task.minX,
        originY: task.minY,
        nodes: task.clonedNodes,
        edges: task.clonedEdges
      }
      task.phase = 'done'
    }
  }
}

export function runNodeBundleCaptureSlice(task, deadline, options = {}) {
  const maxOperations = Math.max(1, Math.floor(Number(options.maxOperations) || 8192))
  let operations = 0
  while (task.phase !== 'done' && !deadlineYielded(deadline, operations, maxOperations)) {
    advanceCaptureTask(task)
    operations += 1
    task.operations += 1
  }
  return task.phase === 'done'
}

export function captureNodeBundleSync(options = {}) {
  const task = createNodeBundleCaptureTask(options)
  const deadline = { shouldYield: () => false }
  while (!runNodeBundleCaptureSlice(task, deadline, { maxOperations: Number.MAX_SAFE_INTEGER })) {}
  return task.result
}

function historyArrayItemBytes(record, index) {
  return String(index).length * 2 + historyValueBytes(record)
}

/**
 * Builds a one-use, fully reactive instance and its private indexes. The result
 * remains detached from the document until the caller performs one atomic publish.
 */
export function createNodeBundleInstanceTask(bundle, options = {}) {
  const sourceNodes = Array.isArray(bundle?.nodes) ? bundle.nodes : []
  const sourceEdges = Array.isArray(bundle?.edges) ? bundle.edges : []
  const createId = typeof options.createId === 'function'
    ? options.createId
    : prefix => `${prefix}-${Math.random().toString(36).slice(2)}`
  const nodeMap = new Map()
  const nodeSpatialIndex = createSpatialIndex([], { cellSize: 512 })
  const edgeAdjacency = createEdgeAdjacencyIndex()
  const edgeSpatialIndex = createSpatialIndex([], {
    cellSize: 512,
    getBounds: edge => edgeBoundsForNodes(edge, nodeMap)
  })
  const historyEntry = { kind: 'entities', nodes: [], edges: [], drawings: [] }
  const emptyHistoryBytes = historyValueBytes(historyEntry)
  return {
    phase: sourceNodes.length ? 'sort' : 'done',
    bundle,
    sourceNodes: [],
    sortTask: createLayerSortTask(sourceNodes),
    sourceEdges,
    createId,
    forceGroup: options.forceGroup === true,
    unlock: options.unlock !== false,
    lineDefaults: options.lineDefaults || {},
    clone: typeof options.clone === 'function' ? options.clone : value => cloneHistoryValue(toRaw(value)),
    index: 0,
    idMap: new Map(),
    groupMap: new Map(),
    forcedGroupId: options.forceGroup === true && sourceNodes.length > 1 ? createId('group') : null,
    nodes: [],
    edges: [],
    nodeIds: [],
    nodeMap,
    nodeSpatialIndex,
    edgeAdjacency,
    edgeSpatialIndex,
    dataKeyIndex: createDataKeyIndex(),
    timeNodeIndex: new Map(),
    runtimeKeys: [],
    historyEntry,
    historyBytes: emptyHistoryBytes,
    operations: 0,
    result: null
  }
}

function prepareInstanceNode(task, source) {
  const sourceId = source.id
  const id = task.createId('node')
  task.idMap.set(sourceId, id)
  let groupId = task.forcedGroupId
  if (!groupId && source.groupId) {
    if (!task.groupMap.has(source.groupId)) task.groupMap.set(source.groupId, task.createId('group'))
    groupId = task.groupMap.get(source.groupId)
  }
  const rawNode = resetNodeInstanceState(normalizeNode({
    ...task.clone(source),
    id,
    layer: 0,
    x: finiteNumber(source.x),
    y: finiteNumber(source.y),
    locked: task.unlock ? false : Boolean(source.locked),
    groupId
  }))
  const node = reactive(rawNode)
  task.nodes.push(node)
  task.nodeIds.push(id)
  task.nodeMap.set(id, node)
  task.nodeSpatialIndex.update(node)
  task.dataKeyIndex.add([node])
  if (node.type === 'time') task.timeNodeIndex.set(id, node)
  const runtimeKey = String(node.dataKey ?? '').trim()
  if (runtimeKey) task.runtimeKeys.push(runtimeKey)
  const record = { id, index: 0, value: null }
  const recordIndex = task.historyEntry.nodes.length
  task.historyEntry.nodes.push(record)
  task.historyBytes += historyArrayItemBytes(record, recordIndex)
}

function prepareInstanceEdge(task, source) {
  const from = task.idMap.get(source.from)
  const to = task.idMap.get(source.to)
  if (!from || !to) return
  const edge = reactive(normalizeEdge({
    ...task.clone(source),
    id: task.createId('edge'),
    from,
    to
  }, task.lineDefaults))
  task.edges.push(edge)
  task.edgeAdjacency.add([edge])
  task.edgeSpatialIndex.update(edge)
  const record = { id: edge.id, index: 0, value: null }
  const recordIndex = task.historyEntry.edges.length
  task.historyEntry.edges.push(record)
  task.historyBytes += historyArrayItemBytes(record, recordIndex)
}

function finishInstanceTask(task) {
  task.result = {
    width: Math.max(1, finiteNumber(task.bundle?.width, 1)),
    height: Math.max(1, finiteNumber(task.bundle?.height, 1)),
    nodes: task.nodes,
    edges: task.edges,
    nodeIds: task.nodeIds,
    nodeMap: task.nodeMap,
    nodeSpatialIndex: task.nodeSpatialIndex,
    edgeAdjacency: task.edgeAdjacency,
    edgeSpatialIndex: task.edgeSpatialIndex,
    dataKeyIndex: task.dataKeyIndex,
    timeNodeIndex: task.timeNodeIndex,
    runtimeKeys: task.runtimeKeys,
    historyEntry: task.historyEntry,
    historyBytes: task.historyBytes,
    consumed: false
  }
  task.phase = 'done'
}

function advanceInstanceTask(task) {
  if (task.phase === 'sort') {
    if (advanceLayerSort(task.sortTask)) {
      task.sourceNodes = task.sortTask.result
      task.phase = 'nodes'
      task.index = 0
    }
    return
  }
  if (task.phase === 'nodes') {
    prepareInstanceNode(task, task.sourceNodes[task.index++])
    if (task.index >= task.sourceNodes.length) {
      task.phase = 'edges'
      task.index = 0
    }
    return
  }
  if (task.phase === 'edges') {
    if (task.index < task.sourceEdges.length) prepareInstanceEdge(task, task.sourceEdges[task.index++])
    if (task.index >= task.sourceEdges.length) finishInstanceTask(task)
    return
  }
  finishInstanceTask(task)
}

export function runNodeBundleInstanceSlice(task, deadline, options = {}) {
  const maxOperations = Math.max(1, Math.floor(Number(options.maxOperations) || 8192))
  let operations = 0
  while (task.phase !== 'done' && !deadlineYielded(deadline, operations, maxOperations)) {
    advanceInstanceTask(task)
    operations += 1
    task.operations += 1
  }
  return task.phase === 'done'
}

export function prepareNodeBundleInstanceSync(bundle, options = {}) {
  const task = createNodeBundleInstanceTask(bundle, options)
  const deadline = { shouldYield: () => false }
  while (!runNodeBundleInstanceSlice(task, deadline, { maxOperations: Number.MAX_SAFE_INTEGER })) {}
  return task.result
}
