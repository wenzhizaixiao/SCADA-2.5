import { reactive } from 'vue'
import { bindingPointIds, bindingSourceIds } from '../models/dataBindingModel.js'
import { createDataBindingIndex } from './dataBindingIndex.js'
import { createDataKeyIndex, createEdgeAdjacencyIndex, createLayerAllocator } from './documentIndexes.js'
import { edgeBoundsForNodes } from './edgeGeometry.js'
import { createSpatialIndex } from './spatialIndex.js'

export const DEFAULT_PROJECT_RUNTIME_PREPARATION_BUDGET_MS = 4

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultSchedule(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback)
  return globalThis.setTimeout(callback, 0)
}

function defaultCancel(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle)
  else globalThis.clearTimeout(handle)
}

function drawingFrame(drawing) {
  const points = Array.isArray(drawing?.points) ? drawing.points : []
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, Number(point?.x) || 0)
    minY = Math.min(minY, Number(point?.y) || 0)
    maxX = Math.max(maxX, Number(point?.x) || 0)
    maxY = Math.max(maxY, Number(point?.y) || 0)
  }
  const padding = Math.max(12, (Number(drawing?.width) || 2) + 8)
  return {
    x: minX - padding,
    y: minY - padding,
    w: Math.max(1, maxX - minX) + padding * 2,
    h: Math.max(1, maxY - minY) + padding * 2
  }
}

function projectCollections(data) {
  if (!data || typeof data !== 'object') throw new TypeError('Prepared project must be an object')
  for (const key of ['nodes', 'edges', 'drawings']) {
    if (!Array.isArray(data[key])) throw new TypeError(`Prepared project ${key} must be an array`)
  }
  return {
    nodes: reactive(data.nodes),
    edges: reactive(data.edges),
    drawings: reactive(data.drawings)
  }
}

function layerEntry(kind, entity) {
  return { kind, id: entity.id, entity, layer: Number(entity.layer) || 0 }
}

export function createProjectRuntimePreparationTask(data, options = {}) {
  const collections = projectCollections(data)
  const nodeIndex = new Map()
  const getDrawingBounds = typeof options.getDrawingBounds === 'function' ? options.getDrawingBounds : drawingFrame
  return {
    phase: 'nodes',
    index: 0,
    maxLayer: 0,
    data,
    ...collections,
    nodeIndex,
    drawingIndex: new Map(),
    timeNodeIndex: new Map(),
    runtimeDataKeyIndex: createDataKeyIndex(),
    runtimeBindingPointIndex: createDataBindingIndex(),
    nodeSpatialIndex: createSpatialIndex([], { cellSize: 512 }),
    drawingSpatialIndex: createSpatialIndex([], { cellSize: 512, getBounds: getDrawingBounds }),
    edgeAdjacency: createEdgeAdjacencyIndex(),
    edgeSpatialIndex: createSpatialIndex([], {
      cellSize: 512,
      getBounds: edge => edgeBoundsForNodes(edge, nodeIndex)
    }),
    entityLayerAllocator: createLayerAllocator(),
    layerEntries: [],
    runtimeKeys: [],
    sourceIds: new Set(),
    result: null
  }
}

function prepareNode(task) {
  const node = task.nodes[task.index++]
  task.nodeIndex.set(node.id, node)
  if (node.type === 'time') task.timeNodeIndex.set(node.id, node)
  task.runtimeDataKeyIndex.update(node)
  task.runtimeBindingPointIndex.update(node)
  task.nodeSpatialIndex.update(node)
  task.layerEntries.push(layerEntry('node', node))
  task.maxLayer = Math.max(task.maxLayer, Number(node.layer) || 0)
  task.runtimeKeys.push(...bindingPointIds(node, { includeLegacy: true }))
  for (const sourceId of bindingSourceIds(node)) task.sourceIds.add(sourceId)
}

function prepareEdge(task) {
  const edge = task.edges[task.index++]
  task.edgeAdjacency.add([edge])
  task.edgeSpatialIndex.update(edge)
}

function prepareDrawing(task) {
  const drawing = task.drawings[task.index++]
  task.drawingIndex.set(drawing.id, drawing)
  task.drawingSpatialIndex.update(drawing)
  task.layerEntries.push(layerEntry('drawing', drawing))
  task.maxLayer = Math.max(task.maxLayer, Number(drawing.layer) || 0)
}

function finishTask(task) {
  task.layerEntries.sort((left, right) => left.layer - right.layer)
  task.entityLayerAllocator.reconcile(task.maxLayer)
  task.result = Object.freeze({
    project: { ...task.data, nodes: task.nodes, edges: task.edges, drawings: task.drawings },
    nodes: task.nodes,
    edges: task.edges,
    drawings: task.drawings,
    nodeIndex: task.nodeIndex,
    drawingIndex: task.drawingIndex,
    timeNodeIndex: task.timeNodeIndex,
    runtimeDataKeyIndex: task.runtimeDataKeyIndex,
    runtimeBindingPointIndex: task.runtimeBindingPointIndex,
    nodeSpatialIndex: task.nodeSpatialIndex,
    drawingSpatialIndex: task.drawingSpatialIndex,
    edgeAdjacency: task.edgeAdjacency,
    edgeSpatialIndex: task.edgeSpatialIndex,
    entityLayerAllocator: task.entityLayerAllocator,
    layerEntries: task.layerEntries,
    runtimeKeys: task.runtimeKeys,
    sourceIds: [...task.sourceIds]
  })
  task.phase = 'done'
}

export function runProjectRuntimePreparationSlice(task, deadline = {}) {
  if (!task || task.phase === 'done') return true
  const shouldYield = typeof deadline.shouldYield === 'function' ? deadline.shouldYield : () => false
  let operations = 0
  while (task.phase !== 'done' && (operations === 0 || !shouldYield())) {
    if (task.phase === 'nodes') {
      if (task.index < task.nodes.length) {
        prepareNode(task)
        operations += 1
      } else {
        task.phase = 'edges'
        task.index = 0
      }
      continue
    }
    if (task.phase === 'edges') {
      if (task.index < task.edges.length) {
        prepareEdge(task)
        operations += 1
      } else {
        task.phase = 'drawings'
        task.index = 0
      }
      continue
    }
    if (task.phase === 'drawings') {
      if (task.index < task.drawings.length) {
        prepareDrawing(task)
        operations += 1
      } else {
        finishTask(task)
      }
    }
  }
  return task.phase === 'done'
}

export class ProjectRuntimePreparationCancelledError extends Error {
  constructor(reason = 'cancelled') {
    super(`Project runtime preparation ${reason}`)
    this.name = 'ProjectRuntimePreparationCancelledError'
    this.reason = reason
  }
}

export function createProjectRuntimePreparer(options = {}) {
  const schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule
  const cancel = typeof options.cancel === 'function' ? options.cancel : defaultCancel
  const now = typeof options.now === 'function' ? options.now : defaultNow
  const budgetMs = Math.max(.25, Number(options.budgetMs) || DEFAULT_PROJECT_RUNTIME_PREPARATION_BUDGET_MS)
  let generation = 0
  let active = null
  let disposed = false

  const state = Object.freeze({
    get pending() { return active != null },
    get generation() { return generation },
    get disposed() { return disposed }
  })

  function retire(reason) {
    const job = active
    if (!job) return false
    active = null
    if (job.handle != null) cancel(job.handle)
    job.reject(new ProjectRuntimePreparationCancelledError(reason))
    return true
  }

  function finishSynchronously(job) {
    while (!runProjectRuntimePreparationSlice(job.task)) {}
    if (active !== job || disposed) return
    active = null
    job.resolve(job.task.result)
  }

  function scheduleSlice(job) {
    try {
      job.handle = schedule(() => {
        job.handle = null
        if (active !== job || disposed || job.generation !== generation) return
        const expiresAt = now() + budgetMs
        try {
          const done = runProjectRuntimePreparationSlice(job.task, { shouldYield: () => now() >= expiresAt })
          if (done) {
            active = null
            job.resolve(job.task.result)
          } else scheduleSlice(job)
        } catch (error) {
          if (active === job) active = null
          job.reject(error)
        }
      })
    } catch {
      finishSynchronously(job)
    }
  }

  function prepare(data) {
    if (disposed) return Promise.reject(new ProjectRuntimePreparationCancelledError('disposed'))
    retire('superseded')
    let task
    try {
      task = createProjectRuntimePreparationTask(data, options)
    } catch (error) {
      return Promise.reject(error)
    }
    const jobGeneration = ++generation
    return new Promise((resolve, reject) => {
      const job = { generation: jobGeneration, task, handle: null, resolve, reject }
      active = job
      scheduleSlice(job)
    })
  }

  function invalidate(reason = 'invalidated') {
    generation += 1
    retire(reason)
    return generation
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation += 1
    retire('disposed')
  }

  return Object.freeze({ state, prepare, invalidate, dispose })
}
