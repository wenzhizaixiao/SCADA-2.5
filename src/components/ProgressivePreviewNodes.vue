<script setup>
import { nextTick, onUnmounted, shallowRef, watch } from 'vue'
import PreviewNodeBatch from './PreviewNodeBatch.vue'
import { nextPreviewMountBatchScale, partitionRetainedPreviewNodeBatches, previewMountBatchEnd } from '../utils/previewMountBudget'

// 限制单帧最多挂载两倍基础批量，防止便宜的前一批把下一批放大成百节点长任务。
const MAX_NODE_BATCH_SCALE = 2

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
const visibleBatches = shallowRef([])
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

function rebuildVisibleNodes() {
  cancelRenderFrame()
  const generation = ++renderGeneration
  const source = Array.isArray(props.nodes) ? props.nodes : []
  const sourceGeneration = props.generation
  emit('render-start', { generation: sourceGeneration, count: source.length })
  const { retainedIds, retainedBatches, pendingNodes } = partitionRetainedPreviewNodeBatches(source, visibleBatches.value)
  // 新世代开始时先释放已离开缓冲区的批次，交集批次保持原父组件和媒体实例。
  visibleBatches.value = retainedBatches
  const batchSize = Math.max(1, Math.floor(Number(props.batchSize) || 128))
  const nextBatchEnd = (start, scale) => previewMountBatchEnd(pendingNodes, start, {
    maxNodes: batchSize * scale,
    costBudget: props.mountCostBudget * scale
  })
  let pendingCount = 0
  let batchScale = 1
  visibleCount.value = retainedIds.size

  const settleVisibleBatches = () => {
    if (generation !== renderGeneration) return
    if (!props.progressive) {
      visibleBatches.value = source.length
        ? [{ id: nextBatchId++, items: source.slice() }]
        : []
    }
    visibleCount.value = source.length
    reportRenderComplete(generation, source, sourceGeneration)
  }

  const appendPendingBatch = () => {
    const nextCount = nextBatchEnd(pendingCount, batchScale)
    if (nextCount > pendingCount) {
      visibleBatches.value = [
        ...visibleBatches.value,
        { id: nextBatchId++, items: pendingNodes.slice(pendingCount, nextCount) }
      ]
      pendingCount = nextCount
      visibleCount.value = retainedIds.size + pendingCount
    }
  }

  if (!props.progressive) {
    settleVisibleBatches()
    return
  }

  appendPendingBatch()
  if (source.length === 0 || visibleCount.value >= source.length) {
    settleVisibleBatches()
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
    batchScale = Math.min(MAX_NODE_BATCH_SCALE, nextPreviewMountBatchScale(batchScale, mountElapsedMs))
    if (visibleCount.value < source.length) renderFrame = scheduleRenderFrame(revealNextBatch)
    else settleVisibleBatches()
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
    v-for="batch in visibleBatches"
    :key="batch.id"
    :nodes="batch.items"
    :runtime-store="runtimeStore"
    :time-context="timeContext"
    @form-change="forwardFormChange"
    @table-cell-view="forwardTableCellView"
  />
</template>
