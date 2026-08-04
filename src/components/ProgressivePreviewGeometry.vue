<script setup>
import { nextTick, onUnmounted, shallowRef, triggerRef, watch } from 'vue'
import { nextPreviewMountBatchScale } from '../utils/previewMountBudget'
import PreviewDrawingBatch from './PreviewDrawingBatch.vue'
import PreviewEdgeBatch from './PreviewEdgeBatch.vue'

const props = defineProps({
  edges: { type: Array, default: () => [] },
  drawings: { type: Array, default: () => [] },
  nodeIndex: { type: Object, required: true },
  drawingEntryFactory: { type: Function, required: true },
  generation: { type: Number, default: 0 },
  stageWidth: { type: Number, required: true },
  stageHeight: { type: Number, required: true },
  progressive: { type: Boolean, default: false },
  edgeBatchSize: { type: Number, default: 64 },
  drawingBatchSize: { type: Number, default: 8 }
})

const emit = defineEmits(['render-start', 'render-complete'])
const edgeBatches = shallowRef([])
const drawingBatches = shallowRef([])
let renderFrame = 0
let renderGeneration = 0
let nextBatchId = 1

function cancelRenderFrame() {
  if (!renderFrame) return
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(renderFrame)
  else clearTimeout(renderFrame)
  renderFrame = 0
}

function scheduleRenderFrame(callback) {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 16)
}

function currentTime() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function retainedBatches(source, batches) {
  if (!batches.length) {
    return { batches: [], pending: source, retainedCount: 0 }
  }
  const sourceById = new Map()
  for (const item of source) sourceById.set(item?.id, item)
  const retainedIds = new Set()
  const retained = []
  for (const batch of batches) {
    const items = []
    let unchanged = true
    for (const previous of batch.items) {
      const current = sourceById.get(previous?.id)
      if (!current || retainedIds.has(current.id)) {
        unchanged = false
        continue
      }
      retainedIds.add(current.id)
      items.push(current)
      if (current !== previous) unchanged = false
    }
    if (!items.length) continue
    retained.push(unchanged && items.length === batch.items.length
      ? batch
      : { id: nextBatchId++, items })
  }
  return {
    batches: retained,
    pending: source.filter(item => !retainedIds.has(item?.id)),
    retainedCount: retainedIds.size
  }
}

function appendBatch(target, pending, cursor, size) {
  if (cursor >= pending.length) return cursor
  const end = Math.min(pending.length, cursor + size)
  target.value.push({ id: nextBatchId++, items: pending.slice(cursor, end) })
  triggerRef(target)
  return end
}

function rebuildGeometry() {
  cancelRenderFrame()
  const generation = ++renderGeneration
  const sourceGeneration = props.generation
  const sourceEdges = Array.isArray(props.edges) ? props.edges : []
  const sourceDrawings = Array.isArray(props.drawings) ? props.drawings : []
  const retainedEdges = retainedBatches(sourceEdges, edgeBatches.value)
  const retainedDrawings = retainedBatches(sourceDrawings, drawingBatches.value)
  edgeBatches.value = retainedEdges.batches
  drawingBatches.value = retainedDrawings.batches
  let edgeCursor = 0
  let drawingCursor = 0
  let visibleEdgeCount = retainedEdges.retainedCount
  let visibleDrawingCount = retainedDrawings.retainedCount
  let batchScale = 1
  const edgeBatchSize = Math.max(1, Math.floor(Number(props.edgeBatchSize) || 64))
  const drawingBatchSize = Math.max(1, Math.floor(Number(props.drawingBatchSize) || 8))

  emit('render-start', {
    generation: sourceGeneration,
    edgeCount: sourceEdges.length,
    drawingCount: sourceDrawings.length
  })

  const reportComplete = () => {
    if (generation !== renderGeneration) return
    void nextTick(() => {
      if (generation !== renderGeneration) return
      if (sourceGeneration !== props.generation || sourceEdges !== props.edges || sourceDrawings !== props.drawings) return
      emit('render-complete', {
        generation: sourceGeneration,
        edgeCount: sourceEdges.length,
        drawingCount: sourceDrawings.length
      })
    })
  }

  const appendNextBatch = () => {
    const scale = Math.min(4, batchScale)
    const nextEdgeCursor = appendBatch(edgeBatches, retainedEdges.pending, edgeCursor, edgeBatchSize * scale)
    const nextDrawingCursor = appendBatch(drawingBatches, retainedDrawings.pending, drawingCursor, drawingBatchSize * scale)
    visibleEdgeCount += nextEdgeCursor - edgeCursor
    visibleDrawingCount += nextDrawingCursor - drawingCursor
    edgeCursor = nextEdgeCursor
    drawingCursor = nextDrawingCursor
  }

  if (!props.progressive) {
    edgeBatches.value = sourceEdges.length ? [{ id: nextBatchId++, items: sourceEdges.slice() }] : []
    drawingBatches.value = sourceDrawings.length ? [{ id: nextBatchId++, items: sourceDrawings.slice() }] : []
    reportComplete()
    return
  }

  appendNextBatch()
  if (visibleEdgeCount >= sourceEdges.length && visibleDrawingCount >= sourceDrawings.length) {
    reportComplete()
    return
  }

  const revealNextBatch = async () => {
    renderFrame = 0
    if (generation !== renderGeneration) return
    const mountStartedAt = currentTime()
    appendNextBatch()
    await nextTick()
    if (generation !== renderGeneration) return
    batchScale = Math.min(4, nextPreviewMountBatchScale(batchScale, currentTime() - mountStartedAt))
    if (visibleEdgeCount < sourceEdges.length || visibleDrawingCount < sourceDrawings.length) {
      renderFrame = scheduleRenderFrame(revealNextBatch)
    } else reportComplete()
  }
  renderFrame = scheduleRenderFrame(revealNextBatch)
}

watch([
  () => props.edges,
  () => props.drawings,
  () => props.nodeIndex,
  () => props.generation,
  () => props.progressive,
  () => props.edgeBatchSize,
  () => props.drawingBatchSize
], rebuildGeometry, { immediate: true })

onUnmounted(() => {
  renderGeneration += 1
  cancelRenderFrame()
})
</script>

<template>
  <svg v-if="edgeBatches.length" class="edges" :width="stageWidth" :height="stageHeight">
    <defs>
      <marker id="preview-arrow" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="9" refY="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke" /></marker>
      <marker id="preview-circle" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="5" refY="5" markerUnits="userSpaceOnUse" orient="auto"><circle cx="5" cy="5" r="4" fill="context-stroke" /></marker>
      <marker id="preview-square" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="5" refY="5" markerUnits="userSpaceOnUse" orient="auto"><rect x="1" y="1" width="8" height="8" fill="context-stroke" /></marker>
    </defs>
    <PreviewEdgeBatch
      v-for="batch in edgeBatches"
      :key="batch.id"
      :edges="batch.items"
      :node-index="nodeIndex"
      :generation="generation"
    />
  </svg>
  <PreviewDrawingBatch
    v-for="batch in drawingBatches"
    :key="batch.id"
    :drawings="batch.items"
    :entry-factory="drawingEntryFactory"
    :generation="generation"
  />
</template>
