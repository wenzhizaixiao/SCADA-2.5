import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { ref } from 'vue'
import { createDataKeyIndex, createLayerAllocator } from '../src/utils/documentIndexes.js'
import { applyEntityEntry, captureEntityEntry } from '../src/utils/entityHistory.js'
import { createSpatialIndex } from '../src/utils/spatialIndex.js'

const FRAME_BUDGET_MS = 16.7
const TARGET_COUNT = 2_000
const source = JSON.parse(await readFile(new URL('../\u56fe\u7eb8\u5e93/sacada\u6d4b\u8bd5.json', import.meta.url), 'utf8'))
assert.equal(source.nodes.length, 6_016, 'the formal drawing baseline must contain 6,016 nodes')
const baselineNodeCount = source.nodes.length
const historyOptions = { reuseEntityReferences: true, mutateRawCollections: true }

const nodes = ref(source.nodes)
const collections = { nodes: nodes.value, edges: [], drawings: [] }
const nodeIndex = new Map(nodes.value.map(node => [node.id, node]))
const nodeSpatialIndex = createSpatialIndex(nodes.value, { cellSize: 512 })
const runtimeDataKeyIndex = createDataKeyIndex()
runtimeDataKeyIndex.rebuild(nodes.value)
const layerAllocator = createLayerAllocator()
layerAllocator.rebuild([nodes.value])
const layerEntries = nodes.value
  .map(node => ({ kind: 'node', id: node.id, entity: node, layer: Number(node.layer) || 0 }))
  .sort((left, right) => left.layer - right.layer)

function now(run) {
  const startedAt = performance.now()
  const value = run()
  return { duration: performance.now() - startedAt, value }
}

function removeLayerEntries(items) {
  const ids = new Set(items.map(item => item.id))
  let writeIndex = 0
  for (let readIndex = 0; readIndex < layerEntries.length; readIndex += 1) {
    const entry = layerEntries[readIndex]
    if (ids.has(entry.id)) continue
    if (writeIndex !== readIndex) layerEntries[writeIndex] = entry
    writeIndex += 1
  }
  layerEntries.splice(writeIndex)
}

function appendLayerEntries(items) {
  const additions = items
    .map(item => ({ kind: 'node', id: item.value.id, entity: item.value, layer: Number(item.value.layer) || 0 }))
    .sort((left, right) => left.layer - right.layer)
  if (!additions.length) return
  if (!layerEntries.length || additions[0].layer > layerEntries.at(-1).layer) {
    layerEntries.push(...additions)
    return
  }
  for (const entry of additions) {
    let low = 0
    let high = layerEntries.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (layerEntries[middle].layer <= entry.layer) low = middle + 1
      else high = middle
    }
    layerEntries.splice(low, 0, entry)
  }
}

function applyIndexes(changes) {
  const spatial = now(() => {
    for (const item of changes.nodes.removed) {
      nodeIndex.delete(item.id)
      nodeSpatialIndex.remove(item.id)
    }
    for (const item of changes.nodes.inserted) {
      nodeIndex.set(item.id, item.value)
      nodeSpatialIndex.update(item.value)
    }
  })
  const runtime = now(() => {
    runtimeDataKeyIndex.remove(changes.nodes.removed)
    runtimeDataKeyIndex.add(changes.nodes.inserted.map(item => item.value))
  })
  const layers = now(() => {
    removeLayerEntries(changes.nodes.removed)
    appendLayerEntries(changes.nodes.inserted)
    layerAllocator.commit(changes.nodes.inserted.map(item => item.value))
  })
  return {
    spatialMs: spatial.duration,
    runtimeMs: runtime.duration,
    layersMs: layers.duration
  }
}

function historyTransition(entry) {
  const capture = now(() => captureEntityEntry(entry, collections, historyOptions))
  const apply = now(() => applyEntityEntry(entry, collections, {}, historyOptions))
  const indexes = now(() => applyIndexes(apply.value))
  return {
    inverse: capture.value,
    captureMs: capture.duration,
    applyMs: apply.duration,
    indexesMs: indexes.duration,
    indexBreakdown: indexes.value,
    totalMs: capture.duration + apply.duration + indexes.duration
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function summarize(samples) {
  return {
    captureP95Ms: percentile(samples.map(sample => sample.captureMs), 0.95),
    applyP95Ms: percentile(samples.map(sample => sample.applyMs), 0.95),
    indexesP95Ms: percentile(samples.map(sample => sample.indexesMs), 0.95),
    totalP95Ms: percentile(samples.map(sample => sample.totalMs), 0.95),
    totalMaxMs: Math.max(...samples.map(sample => sample.totalMs)),
    withinFrame: percentile(samples.map(sample => sample.totalMs), 0.95) < FRAME_BUDGET_MS
  }
}

const selected = nodes.value.slice(0, TARGET_COUNT)
const identifiers = {
  kind: 'entities',
  nodes: selected.map(node => ({ id: node.id, index: 0, value: null })),
  edges: [],
  drawings: []
}
const deletionCapture = now(() => captureEntityEntry(identifiers, collections, historyOptions))
const initialRemove = captureEntityEntry(deletionCapture.value, collections, historyOptions)
applyIndexes(applyEntityEntry(initialRemove, collections, {}, historyOptions))

const undoSamples = []
const redoSamples = []
let restoreEntry = deletionCapture.value
for (let sample = 0; sample < 10; sample += 1) {
  const undo = historyTransition(restoreEntry)
  undoSamples.push(undo)
  assert.equal(nodes.value.length, 6_016)
  assert.ok(selected.every((node, index) => nodes.value[index] === node), 'undo must restore the original reactive references')
  const redo = historyTransition(undo.inverse)
  redoSamples.push(redo)
  assert.equal(nodes.value.length, 4_016)
  restoreEntry = redo.inverse
}

const result = {
  drawingNodes: baselineNodeCount,
  selectedNodes: TARGET_COUNT,
  frameBudgetMs: FRAME_BUDGET_MS,
  deletionCaptureMs: deletionCapture.duration,
  undo: summarize(undoSamples),
  redo: summarize(redoSamples),
  firstUndoBreakdown: undoSamples[0].indexBreakdown,
  firstRedoBreakdown: redoSamples[0].indexBreakdown,
  undoTotalsMs: undoSamples.map(sample => sample.totalMs),
  redoTotalsMs: redoSamples.map(sample => sample.totalMs)
}

console.log(JSON.stringify(result, null, 2))
