<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import echartsRuntimeUrl from 'echarts/dist/echarts.min.js?url'
import { chartOptionFromNode } from '../utils/chartOptions.js'
import {
  createEChartsSandboxDocument,
  SANDBOX_HOST_MESSAGE_SOURCE,
  SANDBOX_MESSAGE_SOURCE
} from '../utils/echartsCodeSandbox.js'
import { echartsCodeViewport, standardEChartsViewport } from '../utils/echartsCodeViewport.js'

const props = defineProps({
  node: { type: Object, required: true },
  interactive: { type: Boolean, default: false }
})

const CODE_CHART_CLICK_DRAG_THRESHOLD = 5

const chartHost = ref(null)
const sandboxFrame = ref(null)
const sandboxDocument = ref('')
const renderError = ref('')
const codeChartCursor = ref('default')
const option = computed(() => chartOptionFromNode(props.node))
const isCodeChart = computed(() => props.node.type === 'echartsCode')
const codeSource = computed(() => String(props.node.echartsCode ?? ''))
const chartViewport = computed(() => isCodeChart.value
  ? echartsCodeViewport(props.node.w, props.node.h)
  : standardEChartsViewport(props.node.w, props.node.h)
)
const chartFrameStyle = computed(() => {
  const viewport = chartViewport.value
  return {
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    transform: `scale(${viewport.scale})`,
    transformOrigin: '0 0'
  }
})
const codeChartCursorStyle = computed(() => isCodeChart.value && !props.interactive
  ? { cursor: codeChartCursor.value }
  : undefined
)
const sandboxChannelId = `echarts-${getCurrentInstance()?.uid ?? 0}-${String(props.node.id ?? 'node')}`

let chart = null
let resizeObserver = null
let resizeFrame = 0
let sandboxTimer = 0
let sandboxHoverFrame = 0
let pendingSandboxHover = null
let codeChartPointerStart = null
let codeChartPointerMoved = false
let mountGeneration = 0

function resizeChart() {
  if (!chart || resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0
    chart?.resize({ animation: { duration: 0 } })
  })
}

function renderChart(nextOption = option.value) {
  if (!chart || !nextOption) return
  try {
    chart.setOption(nextOption, { notMerge: true, lazyUpdate: false })
    renderError.value = ''
    resizeChart()
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : String(error)
  }
}

async function mountChart() {
  if (isCodeChart.value) return
  const generation = ++mountGeneration
  const host = chartHost.value
  if (!host) return
  try {
    const echarts = await import('echarts')
    if (generation !== mountGeneration || chartHost.value !== host) return
    chart = echarts.init(host, null, { renderer: 'svg' })
    resizeObserver = new ResizeObserver(resizeChart)
    resizeObserver.observe(host)
    renderChart()
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : String(error)
  }
}

function rebuildSandbox() {
  sandboxTimer = 0
  if (!isCodeChart.value) return
  codeChartCursor.value = 'default'
  try {
    sandboxDocument.value = createEChartsSandboxDocument({
      source: codeSource.value,
      echartsUrl: echartsRuntimeUrl,
      channelId: sandboxChannelId,
      fallbackOption: option.value
    })
    renderError.value = ''
  } catch (error) {
    sandboxDocument.value = ''
    renderError.value = error instanceof Error ? error.message : String(error)
  }
}

function scheduleSandboxRebuild() {
  clearTimeout(sandboxTimer)
  sandboxTimer = window.setTimeout(rebuildSandbox, 220)
}

function handleSandboxMessage(event) {
  if (event.source !== sandboxFrame.value?.contentWindow) return
  const message = event.data
  if (message?.source !== SANDBOX_MESSAGE_SOURCE || message?.channelId !== sandboxChannelId) return
  if (message.type === 'cursor') codeChartCursor.value = message.message === 'pointer' ? 'pointer' : 'default'
  else if (message.type === 'ready') renderError.value = ''
  else if (message.type === 'error') renderError.value = String(message.message || 'ECharts 代码运行失败')
}

function postSandboxMessage(message) {
  sandboxFrame.value?.contentWindow?.postMessage({
    source: SANDBOX_HOST_MESSAGE_SOURCE,
    channelId: sandboxChannelId,
    ...message
  }, '*')
}

function codeChartLogicalPoint(event) {
  const viewport = chartViewport.value
  const localX = Number(event.offsetX)
  const localY = Number(event.offsetY)
  if (!Number.isFinite(localX) || !Number.isFinite(localY) || viewport.scale <= 0) return null
  return {
    x: localX / viewport.scale,
    y: localY / viewport.scale
  }
}

function stopCodeChartPointerTracking() {
  window.removeEventListener('pointermove', trackCodeChartPointerMove, true)
  window.removeEventListener('pointerup', stopCodeChartPointerTracking, true)
  window.removeEventListener('pointercancel', stopCodeChartPointerTracking, true)
  codeChartPointerStart = null
}

function trackCodeChartPointerMove(event) {
  if (!codeChartPointerStart || event.pointerId !== codeChartPointerStart.pointerId) return
  if (Math.hypot(event.clientX - codeChartPointerStart.x, event.clientY - codeChartPointerStart.y) > CODE_CHART_CLICK_DRAG_THRESHOLD) {
    codeChartPointerMoved = true
  }
}

function rememberCodeChartPointerDown(event) {
  if (!isCodeChart.value || props.interactive || event.button !== 0) return
  stopCodeChartPointerTracking()
  codeChartPointerStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  codeChartPointerMoved = false
  window.addEventListener('pointermove', trackCodeChartPointerMove, true)
  window.addEventListener('pointerup', stopCodeChartPointerTracking, true)
  window.addEventListener('pointercancel', stopCodeChartPointerTracking, true)
}

function relayCodeChartClick(event) {
  if (!isCodeChart.value || props.interactive || codeChartPointerMoved) return
  const point = codeChartLogicalPoint(event)
  if (!point) return
  postSandboxMessage({ type: 'click', ...point })
}

// 编辑态保留 iframe 鼠标穿透，通过消息转发悬浮坐标，避免破坏组件拖动和缩放。
function relayCodeChartPointerMove(event) {
  if (!isCodeChart.value || props.interactive) return
  const point = codeChartLogicalPoint(event)
  if (!point) return
  pendingSandboxHover = {
    type: 'pointermove',
    ...point
  }
  if (sandboxHoverFrame) return
  sandboxHoverFrame = requestAnimationFrame(() => {
    sandboxHoverFrame = 0
    const message = pendingSandboxHover
    pendingSandboxHover = null
    if (message) postSandboxMessage(message)
  })
}

function relayCodeChartPointerLeave() {
  if (!isCodeChart.value || props.interactive) return
  codeChartCursor.value = 'default'
  pendingSandboxHover = null
  if (sandboxHoverFrame) cancelAnimationFrame(sandboxHoverFrame)
  sandboxHoverFrame = 0
  postSandboxMessage({ type: 'pointerleave' })
}

watch(option, nextOption => {
  if (isCodeChart.value) scheduleSandboxRebuild()
  else renderChart(nextOption)
}, { deep: true })
watch(codeSource, scheduleSandboxRebuild)

onMounted(() => {
  window.addEventListener('message', handleSandboxMessage)
  if (isCodeChart.value) rebuildSandbox()
  else nextTick(mountChart)
})
onUnmounted(() => {
  mountGeneration += 1
  window.removeEventListener('message', handleSandboxMessage)
  clearTimeout(sandboxTimer)
  sandboxTimer = 0
  stopCodeChartPointerTracking()
  pendingSandboxHover = null
  if (sandboxHoverFrame) cancelAnimationFrame(sandboxHoverFrame)
  sandboxHoverFrame = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeFrame) cancelAnimationFrame(resizeFrame)
  resizeFrame = 0
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div
    class="echarts-visual"
    :data-chart-type="node.type"
    :data-chart-error="renderError || undefined"
    :style="codeChartCursorStyle"
    role="img"
    :aria-label="node.chartTitle || node.text || '图表'"
    @pointerdown="rememberCodeChartPointerDown"
    @pointermove="relayCodeChartPointerMove"
    @pointerleave="relayCodeChartPointerLeave"
    @click="relayCodeChartClick"
  >
    <iframe
      v-if="isCodeChart && sandboxDocument"
      ref="sandboxFrame"
      class="echarts-code-frame"
      :class="{ 'is-interactive': interactive }"
      :style="chartFrameStyle"
      :srcdoc="sandboxDocument"
      sandbox="allow-scripts"
      :tabindex="interactive ? 0 : -1"
      title="ECharts 完整代码图表"
    ></iframe>
    <div v-else-if="!isCodeChart" ref="chartHost" class="echarts-chart-host" :style="chartFrameStyle"></div>
    <span v-if="renderError" class="echarts-runtime-error" role="status">{{ renderError }}</span>
  </div>
</template>
