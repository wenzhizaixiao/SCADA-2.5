<script setup>
import { nextTick, onUnmounted, shallowRef, triggerRef, watch } from 'vue'
import PreviewNodeBatch from './PreviewNodeBatch.vue'
import { nextPreviewMountBatchScale, partitionRetainedPreviewNodes, previewMountBatchEnd } from '../utils/previewMountBudget'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  generation: { type: Number, default: 0 },
  progressive: { type: Boolean, default: false },
  batchSize: { type: Number, default: 128 },
  mountCostBudget: { type: Number, default: 1024 },
  runtimeStore: { type: Object, default: null },
  timeContext: { type: Object, default: null }
})

const emit = defineEmits(['form-change', 'table-cell-view', 'render-start', 'render-complete'])
const visibleCount = shallowRef(0)
const visibleNodes = shallowRef([])
let renderFrame = 0
let renderGeneration = 0

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

function rebuildVisibleNodes() {
  cancelRenderFrame()
  const generation = ++renderGeneration
  const source = Array.isArray(props.nodes) ? props.nodes : []
  const sourceGeneration = props.generation
  emit('render-start', { generation: sourceGeneration, count: source.length })
  const { retainedIds, retainedNodes, pendingNodes } = partitionRetainedPreviewNodes(source, visibleNodes.value)
  // A shrinking viewport must release stale DOM before any new mount batch starts.
  visibleNodes.value = retainedNodes
  const batchSize = Math.max(1, Math.floor(Number(props.batchSize) || 128))
  const nextBatchEnd = (start, scale) => previewMountBatchEnd(pendingNodes, start, {
    maxNodes: batchSize * scale,
    costBudget: props.mountCostBudget * scale
  })
  let pendingCount = 0
  let batchScale = 1
  visibleCount.value = retainedIds.size

  const settleVisibleNodes = () => {
    if (generation !== renderGeneration) return
    if (!props.progressive || retainedIds.size) visibleNodes.value = source.slice()
    visibleCount.value = source.length
    reportRenderComplete(generation, source, sourceGeneration)
  }

  const appendPendingBatch = () => {
    const nextCount = nextBatchEnd(pendingCount, batchScale)
    if (nextCount > pendingCount) {
      visibleNodes.value.push(...pendingNodes.slice(pendingCount, nextCount))
      triggerRef(visibleNodes)
      pendingCount = nextCount
      visibleCount.value = retainedIds.size + pendingCount
    }
  }

  if (!props.progressive) {
    settleVisibleNodes()
    return
  }

  appendPendingBatch()
  if (source.length === 0 || visibleCount.value >= source.length) {
    settleVisibleNodes()
    return
  }
  const revealNextBatch = async () => {
    renderFrame = 0
    if (generation !== renderGeneration) return
    const mountStartedAt = currentTime()
    appendPendingBatch()
    await nextTick()
    if (generation !== renderGeneration) return
    const mountElapsedMs = currentTime() - mountStartedAt
    batchScale = nextPreviewMountBatchScale(batchScale, mountElapsedMs)
    if (visibleCount.value < source.length) renderFrame = scheduleRenderFrame(revealNextBatch)
    else settleVisibleNodes()
  }
  renderFrame = scheduleRenderFrame(revealNextBatch)
}

function reportRenderComplete(generation, source, sourceGeneration) {
  if (visibleCount.value < source.length) return
  void nextTick(() => {
    if (generation !== renderGeneration) return
    if (sourceGeneration !== props.generation || source !== props.nodes) return
    emit('render-complete', { generation: sourceGeneration, count: source.length })
  })
}

function forwardFormChange(node, event) {
  emit('form-change', node, event)
}

function forwardTableCellView(node, event) {
  emit('table-cell-view', node, event)
}

watch([() => props.nodes, () => props.generation, () => props.progressive, () => props.batchSize, () => props.mountCostBudget], rebuildVisibleNodes, { immediate: true })
onUnmounted(() => {
  renderGeneration += 1
  cancelRenderFrame()
})
</script>

<template>
  <PreviewNodeBatch
    :nodes="visibleNodes"
    :runtime-store="runtimeStore"
    :time-context="timeContext"
    @form-change="forwardFormChange"
    @table-cell-view="forwardTableCellView"
  />
</template>
