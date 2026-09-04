<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Check, ChevronDown, Clock3, Cloud, Database, HardDrive, Image, Network, Router, Server, Sparkles, Video } from 'lucide-vue-next'
import RuntimeValueText from './RuntimeValueText.vue'
import EChartsVisual from './EChartsVisual.vue'
import { normalizedVisualScale } from '../utils/editorGeometry'
import { resolveTimeValue, timeInputStep, timeInputType } from '../utils/formTime'
import { acquireVisualClock, releaseVisualClock } from '../composables/useSharedVisualClock'
import { createCanvasVisualAnimationTimeline, signalLightColor } from '../utils/canvasVisualAnimation'
import {
  LINE_SHAPE_MIN_INNER_SIZE,
  lineShapeBorderWidth,
  lineShapeBodyDashArray,
  lineShapeBodyInset,
  lineShapeDashArray,
  lineShapeHeight,
  lineShapeInnerThickness,
  lineShapeWidth
} from '../utils/lineShapeGeometry'
import {
  polylineArrowSize,
  polylineDashArray,
  polylineDashCycle,
  isPolylineNodeType,
  polylineLineOpacity,
  polylineLineWidth,
  polylineOutlineWidth,
  polylineStrokeLineCap
} from '../utils/polylineGeometry'
import {
  createTableCellModels,
  createTableVirtualWindow,
  shouldVirtualizeTable
} from '../utils/tableVirtualization'
import { createTableCellViewPayload } from '../utils/tableCellViewer.js'
import { bindingPointIds } from '../models/dataBindingModel.js'
import { MAX_SIGNAL_COLORS } from '../config/componentBindingSchema.js'
import { isAnimationComponentType } from '../config/componentCapabilities.js'
import {
  hasEnabledRuntimeBinding,
  materializeRuntimeNode
} from '../utils/runtimeNodeMaterializer.js'
import { normalizeRuntimeKey, runtimeKeySignature } from '../utils/runtimeKey.js'
import { rectangularNodeBorderGeometry } from '../utils/nodeBorderGeometry.js'

const visualOnlyTypes = new Set(['flowDirection', 'flowPipe', 'rotatingFan', 'signalLight', 'waterTank', 'heartbeat', 'particles'])
const formVisualTypes = new Set(['table', 'checkbox', 'radio', 'switch', 'formProgress', 'button', 'input', 'select', 'time'])
const chartVisualTypes = new Set(['chart', 'lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart', 'echartsCode'])

function fontWeight(node) {
  const explicit = Number(node.fontWeight)
  const legacyScale = Number(node.fontWeightScale)
  const value = explicit > 0 ? explicit : legacyScale > 0 ? legacyScale * 400 : 400
  if (value < 500) return 400
  if (value < 650) return 600
  return 700
}

function textAlignment(node) {
  const alignment = ['left', 'right'].includes(node.textAlign) ? node.textAlign : 'center'
  if (node.type !== 'text' || node.textLayout !== 'vertical') return alignment
  return alignment === 'left' ? 'start' : alignment === 'right' ? 'end' : 'center'
}

function fontStrokeWidth(weight, fontSize = 14) {
  const size = Math.max(8, Math.min(96, Number(fontSize) || 14))
  if (Number(weight) >= 700) return `${Math.round(Math.max(.2, Math.min(1.2, size * .02)) * 100) / 100}px`
  if (Number(weight) >= 600) return `${Math.round(Math.max(.1, Math.min(.6, size * .01)) * 100) / 100}px`
  return '0px'
}

function textStrokeWidth(node) {
  return fontStrokeWidth(fontWeight(node), node.fontSize)
}

function splitValues(value, separator = ',') {
  return String(value || '').split(separator).map(item => item.trim()).filter(Boolean)
}

function optionItems(node) {
  if (Array.isArray(node.selectOptions) && node.selectOptions.length) {
    return node.selectOptions.map((item, index) => ({ label: String(item?.label || `选项 ${index + 1}`), value: String(item?.value ?? '') }))
  }
  return splitValues(node.options).map((item, index) => {
    const separator = item.indexOf(':')
    return separator < 0 ? { label: item, value: item } : { label: item.slice(0, separator).trim() || `选项 ${index + 1}`, value: item.slice(separator + 1).trim() || item }
  })
}

function tablePixelColumnWidths(node) {
  const columns = Math.max(1, Math.min(12, Number(node.tableColumns) || node.tableHeaders?.length || 3))
  const pixelWidths = Array.isArray(node.tableColumnWidthsPx) ? node.tableColumnWidthsPx : []
  const hasCompletePixelWidths = pixelWidths.length >= columns && pixelWidths.slice(0, columns).every(width => Number.isFinite(Number(width)) && Number(width) > 0)
  if (hasCompletePixelWidths) return pixelWidths.slice(0, columns).map(width => Math.max(40, Math.min(2000, Number(width))))

  const legacyWidths = Array.isArray(node.tableColumnWidths) ? node.tableColumnWidths : []
  const ratios = Array.from({ length: columns }, (_, index) => Math.max(.2, Math.min(5, Number(legacyWidths[index]) || 1)))
  const ratioTotal = ratios.reduce((total, width) => total + width, 0)
  const borderWidth = Math.max(0, Number(node.tableBorderWidth) || 0)
  const availableWidth = Math.max(columns * 40, (Number(node.w) || columns * 120) - borderWidth * 2)
  return ratios.map(width => Math.max(40, Math.min(2000, availableWidth * width / ratioTotal)))
}

function tableColumnsStyle(node) {
  const widths = tablePixelColumnWidths(node)
  return widths.map(width => `${width}px`).join(' ')
}

function tableMinWidth(node) {
  return tablePixelColumnWidths(node).reduce((total, width) => total + width, 0)
}

function tableBorderMetrics(node) {
  const gridWidth = Math.max(0, Math.min(10, Number(node.tableGridWidth) || 0))
  const gridStyle = node.tableGridStyle || 'solid'
  const outerWidth = Math.max(0, Number(node.tableBorderWidth) || 0)
  const outerColor = String(node.tableBorderColor || node.tableGridColor || '').trim().toLowerCase()
  const gridColor = String(node.tableGridColor || '').trim().toLowerCase()
  const outerMatchesGrid = Math.abs(outerWidth - gridWidth) < .001
    && (node.tableBorderStyle || 'solid') === gridStyle
    && outerColor === gridColor
  const contentWidth = Math.max(0, (Number(node.w) || 0) - outerWidth * 2)
  return {
    gridWidth,
    gridStyle,
    outerMatchesGrid,
    hasTrailingSpace: tableMinWidth(node) + .5 < contentWidth
  }
}

function tableRowTrackHeights(node) {
  const rows = Math.max(1, Math.min(50, Number(node.tableRows) || node.tableCells?.length || 3))
  const fallback = Math.max(18, Math.min(120, Number(node.tableRowHeight) || 28))
  const heights = Array.isArray(node.tableRowHeights) ? node.tableRowHeights : []
  const tracks = Array.from({ length: rows }, (_, index) => {
    return Math.max(18, Math.min(120, Number(heights[index]) || fallback))
  })
  if (node.showHeader !== false) tracks.unshift(Math.max(18, Math.min(120, Number(node.tableHeaderHeight) || fallback)))
  return tracks
}

function tableRowsStyle(node) {
  const adaptive = node.tableContentDisplay === 'wrap'
  return tableRowTrackHeights(node)
    .map(height => adaptive ? `minmax(${height}px, auto)` : `${height}px`)
    .join(' ')
}

function tableMinimumHeight(node) {
  const gridHeight = tableRowTrackHeights(node).reduce((total, height) => total + height, 0)
  if (node.showTableTitle === false) return gridHeight
  const titleSize = Math.max(1, Number(node.tableTitleSize) || 14)
  const { gridWidth, outerMatchesGrid } = tableBorderMetrics(node)
  const titleTopWidth = outerMatchesGrid ? 0 : gridWidth
  return gridHeight + Math.max(30, titleSize * 1.2 + 8 + titleTopWidth + gridWidth)
}

function tableCellStyle(node, cell) {
  const align = cell.header ? (node.tableHeaderAlign || 'left') : (node.tableTextAlign || 'left')
  const color = cell.header ? node.tableHeaderColor : node.tableCellColor
  const size = cell.header ? (node.tableHeaderSize || 14) : (node.tableCellSize || 14)
  const weight = cell.header ? (node.tableHeaderWeight || '600') : (node.tableCellWeight || '400')
  const { gridWidth, gridStyle, outerMatchesGrid, hasTrailingSpace } = tableBorderMetrics(node)
  const outerWidth = Math.max(0, Number(node.tableBorderWidth) || 0)
  const columns = Math.max(1, Math.min(12, Number(node.tableColumns) || node.tableHeaders?.length || 3))
  const rows = Math.max(1, Math.min(50, Number(node.tableRows) || node.tableCells?.length || 3))
  const contentHeight = Math.max(0, (Number(node.h) || 0) - outerWidth * 2)
  const isLastColumn = cell.column + (cell.columnSpan || 1) >= columns
  const isLastRow = !cell.header && cell.row + (cell.rowSpan || 1) >= rows
  const hasTrailingBottomSpace = tableMinimumHeight(node) + .5 < contentHeight
  const leadingGridWidth = outerMatchesGrid ? 0 : gridWidth
  const drawsTopBorder = leadingGridWidth > 0 && node.showTableTitle === false && cell.gridRow === 1
  const drawsLeftBorder = leadingGridWidth > 0 && cell.column === 0
  return {
    backgroundColor: colorWithOpacity(cell.header ? node.tableHeaderFill : (cell.row % 2 ? node.tableAltRowFill : node.tableRowFill), node.backgroundOpacity ?? 1),
    color,
    fontSize: `${size}px`,
    fontWeight: weight,
    WebkitTextStrokeWidth: fontStrokeWidth(weight, size),
    WebkitTextStrokeColor: color,
    paintOrder: 'stroke fill',
    borderColor: node.tableGridColor,
    borderTopWidth: drawsTopBorder ? `${leadingGridWidth}px` : 0,
    borderLeftWidth: drawsLeftBorder ? `${leadingGridWidth}px` : 0,
    borderRightWidth: isLastColumn && !hasTrailingSpace && outerMatchesGrid ? 0 : `${gridWidth}px`,
    borderBottomWidth: isLastRow && !hasTrailingBottomSpace && outerMatchesGrid ? 0 : `${gridWidth}px`,
    borderTopStyle: drawsTopBorder ? gridStyle : 'none',
    borderLeftStyle: drawsLeftBorder ? gridStyle : 'none',
    borderRightStyle: gridStyle,
    borderBottomStyle: gridStyle,
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    textAlign: align,
    gridRow: `${cell.gridRow} / span ${cell.rowSpan || 1}`,
    gridColumn: `${cell.gridColumn} / span ${cell.columnSpan || 1}`
  }
}

function tableTitleStyle(node) {
  const size = Math.max(1, Number(node.tableTitleSize) || 14)
  const weight = node.tableTitleWeight || '600'
  const align = node.tableTitleAlign || 'center'
  const { gridWidth, gridStyle, outerMatchesGrid, hasTrailingSpace } = tableBorderMetrics(node)
  const leadingGridWidth = outerMatchesGrid ? 0 : gridWidth
  const trailingGridWidth = !hasTrailingSpace && outerMatchesGrid ? 0 : gridWidth
  return {
    backgroundColor: colorWithOpacity(node.tableTitleFill, node.backgroundOpacity ?? 1),
    color: node.tableTitleColor,
    fontSize: `${size}px`,
    fontWeight: weight,
    WebkitTextStrokeWidth: fontStrokeWidth(weight, size),
    WebkitTextStrokeColor: node.tableTitleColor,
    paintOrder: 'stroke fill',
    borderColor: node.tableGridColor,
    borderTopWidth: leadingGridWidth ? `${leadingGridWidth}px` : 0,
    borderRightWidth: trailingGridWidth ? `${trailingGridWidth}px` : 0,
    borderBottomWidth: gridWidth ? `${gridWidth}px` : 0,
    borderLeftWidth: leadingGridWidth ? `${leadingGridWidth}px` : 0,
    borderTopStyle: leadingGridWidth ? gridStyle : 'none',
    borderRightStyle: trailingGridWidth ? gridStyle : 'none',
    borderBottomStyle: gridWidth ? gridStyle : 'none',
    borderLeftStyle: leadingGridWidth ? gridStyle : 'none',
    justifyContent: align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center',
    textAlign: align
  }
}

function progressPercent(node) {
  if (node.progressFluctuationEnabled) return fluctuatingProgress.value * 100
  const min = Number(node.progressMin) || 0
  const max = Number(node.progressMax) || 100
  const value = Number(node.progressValue) || 0
  return Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100))
}

function progressText(node) {
  const percent = progressPercent(node)
  if (node.progressFluctuationEnabled && node.progressMode === 'value') {
    const max = Number(node.progressMax) || 100
    return `${Math.round(percent / 100 * max * 100) / 100} / ${max}`
  }
  return node.progressMode === 'value' ? `${Number(node.progressValue) || 0} / ${Number(node.progressMax) || 0}` : `${Math.round(percent * 10) / 10}%`
}

function safeInputType(type) {
  return ['text', 'number', 'password', 'email', 'search', 'tel', 'url'].includes(type) ? type : 'text'
}

const props = defineProps({
  node: { type: Object, required: true },
  preview: { type: Boolean, default: false },
  interactive: { type: Boolean, default: false },
  runtimeStore: { type: Object, default: null },
  timeContext: { type: Object, default: null },
  signalAnimationTimestamp: { type: Number, default: null }
})
const emit = defineEmits(['form-change', 'table-cell-view', 'table-edit'])
const visualInstanceId = getCurrentInstance()?.uid ?? 0
const canInteract = () => props.preview || (props.interactive && !props.node.locked)
let runtimeBindingKey = ''
let runtimeBindingStore = null
let unsubscribeRuntimeBinding = null
const runtimeValue = shallowRef(undefined)

function releaseRuntimeBinding() {
  unsubscribeRuntimeBinding?.()
  unsubscribeRuntimeBinding = null
}

function syncRuntimeBinding() {
  const nextKey = props.node.type === 'progress' ? String(props.node.dataKey ?? '').trim() : ''
  const nextStore = props.runtimeStore
  if (runtimeBindingKey === nextKey && runtimeBindingStore === nextStore) return
  releaseRuntimeBinding()
  runtimeBindingKey = nextKey
  runtimeBindingStore = nextStore
  runtimeValue.value = nextKey ? nextStore?.getValue?.(nextKey) : undefined
  if (nextKey && typeof nextStore?.subscribe === 'function') {
    unsubscribeRuntimeBinding = nextStore.subscribe(nextKey, value => {
      runtimeValue.value = value
    })
  }
}
watch([() => props.runtimeStore, () => props.node.type, () => props.node.dataKey], syncRuntimeBinding, { immediate: true })

// 参数级绑定按点位去重订阅。同一点位绑定多个属性时只保留一个响应式引用。
let runtimePointStore = null
let runtimePointBindings = null
const runtimePointSubscriptionVersion = ref(0)

function releaseRuntimePointBindings() {
  const changed = Boolean(runtimePointBindings?.size)
  for (const entry of runtimePointBindings?.values() || []) entry.unsubscribe?.()
  runtimePointBindings = null
  return changed
}

function publishRuntimePointBindingChange(changed) {
  if (changed) runtimePointSubscriptionVersion.value += 1
}

function syncRuntimePointBindings() {
  const nextStore = props.runtimeStore
  let changed = false
  if (runtimePointStore !== nextStore) {
    changed = releaseRuntimePointBindings()
    runtimePointStore = nextStore
  }

  const nextPointIds = bindingPointIds(props.node)
  // 绝大多数静态节点没有数据绑定，不为它们分配 Map、Set 或递增响应式版本。
  if (!nextPointIds.length && !runtimePointBindings?.size) return publishRuntimePointBindingChange(changed)

  const nextPointIdSet = new Set(nextPointIds)
  const bindings = runtimePointBindings || (runtimePointBindings = new Map())
  for (const [pointId, entry] of bindings) {
    if (nextPointIdSet.has(pointId)) continue
    entry.unsubscribe?.()
    bindings.delete(pointId)
    changed = true
  }
  if (typeof runtimePointStore?.subscribe === 'function') {
    for (const pointId of nextPointIds) {
      if (bindings.has(pointId)) continue
      const entry = {
        value: shallowRef(runtimePointStore.getValue?.(pointId)),
        unsubscribe: null
      }
      entry.unsubscribe = runtimePointStore.subscribe(pointId, value => {
        entry.value.value = value
      })
      bindings.set(pointId, entry)
      changed = true
    }
  }
  publishRuntimePointBindingChange(changed)
}

function runtimePointValue(pointId) {
  runtimePointSubscriptionVersion.value
  return runtimePointBindings?.get(normalizeRuntimeKey(pointId))?.value.value
}

watch(
  [() => props.runtimeStore, () => runtimeKeySignature(bindingPointIds(props.node))],
  syncRuntimePointBindings,
  { immediate: true }
)

const effectiveNode = computed(() => materializeRuntimeNode(props.node, runtimePointValue))
// 显式声明 node，让模板统一读取运行时有效值；交互写入仍只通过 props.node 完成。
const node = effectiveNode
const animationComponentActive = computed(() => isAnimationComponentType(node.value?.type))
const visualNode = computed(() => {
  const source = node.value
  const scaleX = normalizedVisualScale(props.node.visualScaleX, props.node.w)
  const scaleY = normalizedVisualScale(props.node.visualScaleY, props.node.h)
  if (scaleX === 1 && scaleY === 1) return source
  return {
    ...source,
    w: Math.max(.1, Number(props.node.w) || 1) / scaleX,
    h: Math.max(.1, Number(props.node.h) || 1) / scaleY
  }
})
const visualScaleFrameStyle = computed(() => {
  const scaleX = normalizedVisualScale(props.node.visualScaleX, props.node.w)
  const scaleY = normalizedVisualScale(props.node.visualScaleY, props.node.h)
  return {
    width: `${Math.max(.1, Number(props.node.w) || 1) / scaleX}px`,
    height: `${Math.max(.1, Number(props.node.h) || 1) / scaleY}px`,
    transform: `scale(${scaleX}, ${scaleY})`
  }
})
const customBorderGeometry = computed(() => rectangularNodeBorderGeometry(visualNode.value))
const tableWrapperElement = ref(null)
const tableGridElement = ref(null)
const tableWindowOverride = shallowRef(null)
let tableWindowFrame = 0
let tableBottomPinned = false
let tableWindowSettlePasses = 0
let tablePinnedScrollTop = 0
let tableWindowDisposed = false

function tableEstimatedGridOffset(node) {
  if (node.showTableTitle === false) return 0
  const rowHeight = tableRowTrackHeights(node).reduce((total, height) => total + height, 0)
  return Math.max(0, tableMinimumHeight(node) - rowHeight)
}

const tableVirtualized = computed(() => node.value.type === 'table' && shouldVirtualizeTable(node.value))
const initialTableVirtualWindow = computed(() => {
  const node = visualNode.value
  const outerWidth = Math.max(0, Number(node.tableBorderWidth) || 0)
  return createTableVirtualWindow({
    rowHeights: tableRowTrackHeights(node),
    columnWidths: tablePixelColumnWidths(node),
    viewportWidth: Math.max(1, node.w - outerWidth * 2),
    viewportHeight: Math.max(1, node.h - outerWidth * 2),
    gridOffsetTop: tableEstimatedGridOffset(node)
  })
})
const tableRenderWindow = computed(() => {
  if (!tableVirtualized.value) return null
  return tableWindowOverride.value || initialTableVirtualWindow.value
})
const visibleTableCells = computed(() => createTableCellModels(node.value, tableRenderWindow.value))

function sameTableWindow(left, right) {
  return Boolean(left && right)
    && left.rowStart === right.rowStart
    && left.rowEnd === right.rowEnd
    && left.columnStart === right.columnStart
    && left.columnEnd === right.columnEnd
}

function resolvedTableRowHeights(grid, fallback) {
  if (!grid || typeof getComputedStyle !== 'function') return fallback
  const resolved = getComputedStyle(grid).gridTemplateRows.match(/\d+(?:\.\d+)?px/g)?.map(value => Number.parseFloat(value)) || []
  if (resolved.length !== fallback.length || resolved.some(value => !Number.isFinite(value) || value <= 0)) return fallback
  return resolved
}

function syncTableVirtualWindow(wrapper = tableWrapperElement.value) {
  if (!tableVirtualized.value || !wrapper) {
    tableWindowOverride.value = null
    return
  }
  const grid = tableGridElement.value
  const fallbackRowHeights = tableRowTrackHeights(visualNode.value)
  const content = grid?.parentElement
  const gridOffsetTop = grid && content
    ? Math.max(0, grid.getBoundingClientRect().top - content.getBoundingClientRect().top)
    : tableEstimatedGridOffset(visualNode.value)
  const nextWindow = createTableVirtualWindow({
    rowHeights: resolvedTableRowHeights(grid, fallbackRowHeights),
    columnWidths: tablePixelColumnWidths(visualNode.value),
    scrollTop: wrapper.scrollTop,
    scrollLeft: wrapper.scrollLeft,
    viewportWidth: wrapper.clientWidth,
    viewportHeight: wrapper.clientHeight,
    gridOffsetTop
  })
  if (!sameTableWindow(tableWindowOverride.value || initialTableVirtualWindow.value, nextWindow)) {
    tableWindowOverride.value = nextWindow
  }
}

function scheduleTableVirtualWindowSync() {
  if (!tableVirtualized.value) return
  if (tableWindowDisposed || tableWindowFrame || typeof requestAnimationFrame !== 'function') return
  tableWindowFrame = requestAnimationFrame(() => {
    tableWindowFrame = 0
    const wrapper = tableWrapperElement.value
    if (tableBottomPinned && wrapper) {
      wrapper.scrollTop = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight)
      tablePinnedScrollTop = wrapper.scrollTop
    }
    syncTableVirtualWindow(wrapper)
    if (tableBottomPinned && tableWindowSettlePasses > 0) {
      tableWindowSettlePasses -= 1
      nextTick(scheduleTableVirtualWindowSync)
    }
  })
}

function handleTableScroll(event) {
  const wrapper = event.currentTarget
  const remainingScroll = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight - wrapper.scrollTop)
  const dynamicRows = node.value.tableContentDisplay === 'wrap'
  const movedAwayFromPinnedBottom = tableBottomPinned && wrapper.scrollTop + 2 < tablePinnedScrollTop
  if (!dynamicRows || movedAwayFromPinnedBottom) tableBottomPinned = false
  if (dynamicRows && remainingScroll <= 2) {
    tableBottomPinned = true
    tablePinnedScrollTop = wrapper.scrollTop
  }
  tableWindowSettlePasses = tableBottomPinned ? 4 : 0
  syncTableVirtualWindow(wrapper)
  scheduleTableVirtualWindowSync()
}

function releaseTableBottomPin() {
  tableBottomPinned = false
  tableWindowSettlePasses = 0
}

const tableLayoutSignature = computed(() => {
  const type = node.value.type
  if (type !== 'table') return type
  const visual = visualNode.value
  return [
    visual.w,
    visual.h,
    visual.tableRows,
    visual.tableColumns,
    visual.showHeader,
    visual.showTableTitle,
    visual.tableTitleSize,
    visual.tableContentDisplay,
    tablePixelColumnWidths(visual).join(','),
    tableRowTrackHeights(visual).join(',')
  ].join('|')
})

watch(tableLayoutSignature, () => {
  tableWindowOverride.value = null
  if (!tableVirtualized.value) return
  nextTick(() => {
    if (!tableVirtualized.value) return
    syncTableVirtualWindow()
    scheduleTableVirtualWindowSync()
  })
})
onMounted(() => {
  tableWindowDisposed = false
  if (!tableVirtualized.value) return
  nextTick(() => {
    if (!tableVirtualized.value) return
    syncTableVirtualWindow()
    scheduleTableVirtualWindowSync()
  })
})

function stopInteractivePointer(event) {
  if (!canInteract() || !event.target.closest?.('.form-control')) return
  if (props.node.type !== 'button') event.stopPropagation()
}

function stopInteractiveDoubleClick(event) {
  if (canInteract() && event.target.closest?.('.form-control')) event.stopPropagation()
}

function tableCellCanOpen(cell) {
  return node.value.tableContentDisplay !== 'wrap' && !cell.header && String(cell.text || '').length > 0
}
function emitTableCellView(cell) {
  const payload = createTableCellViewPayload(node.value, cell)
  if (payload) emit('table-cell-view', payload)
}
function handleTableCellClick(event, cell) {
  if (!props.preview || !tableCellCanOpen(cell)) return
  event.stopPropagation()
  emitTableCellView(cell)
}
function handleTableCellKey(event, cell) {
  if (!tableCellCanOpen(cell) || !['Enter', ' '].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  emitTableCellView(cell)
}

const videoElement = ref(null)
const completedVideoPlays = ref(0)
const videoSessionExhausted = ref(false)
const imageLoadFailed = ref(false)
const videoLoadFailed = ref(false)

function handleImageLoad() {
  imageLoadFailed.value = false
}

function handleImageLoadError() {
  imageLoadFailed.value = true
}

function handleVideoLoadedData() {
  videoLoadFailed.value = false
}

function handleVideoLoadError() {
  videoLoadFailed.value = true
  videoElement.value?.pause()
}

watch(() => props.node.imageUrl, () => {
  imageLoadFailed.value = false
})
watch(() => props.node.videoUrl, () => {
  videoLoadFailed.value = false
})

function applyVideoSettings({ preserveMuted = false } = {}) {
  const video = videoElement.value
  if (!video) return
  if (!preserveMuted) video.muted = props.node.videoMuted !== false
  video.playbackRate = Math.max(.25, Math.min(4, Number(props.node.videoPlaybackRate) || 1))
}

async function playVideo({ allowMutedFallback = false, preserveMuted = false } = {}) {
  const video = videoElement.value
  if (!video || !props.preview || node.value.visible === false || videoSessionExhausted.value) return false
  applyVideoSettings({ preserveMuted })
  try {
    await video.play()
    return true
  } catch (error) {
    if (!allowMutedFallback || video.muted || error?.name !== 'NotAllowedError') return false
    video.muted = true
    try {
      await video.play()
      return true
    } catch {
      return false
    }
  }
}

function resetVideoSession() {
  completedVideoPlays.value = 0
  videoSessionExhausted.value = false
}

function syncVideoSettings() {
  const video = videoElement.value
  if (!video) return
  applyVideoSettings()
  if (!props.preview) video.pause()
}

function initializeVideoPlayback() {
  resetVideoSession()
  nextTick(() => {
    const video = videoElement.value
    if (!video) return
    video.currentTime = 0
    if (props.preview && props.node.videoAutoplay && node.value.visible !== false) playVideo({ allowMutedFallback: true })
    else {
      applyVideoSettings()
      video.pause()
    }
  })
}

function handleVideoEnded() {
  const video = videoElement.value
  if (!video || !props.preview) return
  completedVideoPlays.value += 1
  const playCount = Math.max(0, Math.round(Number(props.node.videoPlayCount) || 0))
  if (playCount > 0 && completedVideoPlays.value >= playCount) {
    videoSessionExhausted.value = true
    return
  }
  video.currentTime = 0
  playVideo({ preserveMuted: true })
}

function handleVideoPlay() {
  if (!videoSessionExhausted.value) return
  resetVideoSession()
}

function syncVideoVisibility(visible) {
  const video = videoElement.value
  if (!video) return
  if (visible === false) {
    video.pause()
    return
  }
  if (props.preview && props.node.videoAutoplay) playVideo({ allowMutedFallback: true })
}

function toggleVideoPlayback(event) {
  const video = videoElement.value
  if (!video || !props.preview || props.node.videoControls !== false) return
  event.preventDefault()
  event.stopPropagation()
  if (!video.paused && !video.ended) {
    video.pause()
    return
  }
  if (videoSessionExhausted.value || video.ended) {
    resetVideoSession()
    video.currentTime = 0
  }
  playVideo()
}
if (props.node.type === 'video') {
  watch(() => [props.node.videoUrl, props.node.videoPlayCount, props.node.videoAutoplay], initializeVideoPlayback)
  watch([videoElement, () => props.node.videoMuted, () => props.node.videoPlaybackRate], syncVideoSettings, { flush: 'post' })
  watch(() => node.value.visible, syncVideoVisibility, { flush: 'post' })
}

function updateChecked(event) {
  if (!canInteract() || props.node.disabled) return
  props.node.checked = event.target.checked
  emit('form-change', { type: props.node.type, checked: props.node.checked, value: props.node.checked ? props.node.checkedValue : props.node.uncheckedValue })
}

function updateValue(event) {
  if (!canInteract() || props.node.disabled || props.node.readOnly || (props.node.type === 'time' && (props.node.timeUseServer || props.node.timeRunning))) return
  props.node.value = event.target.value
  if (props.node.type === 'time') props.node.defaultValue = event.target.value
  emit('form-change', { type: props.node.type, value: props.node.value })
}

function displayedTime(node) {
  let currentTime = Date.now()
  if (node.timeRunning) {
    currentTime = Number(props.timeContext?.tick?.value) || currentTime
    if (node.timeUseServer) currentTime += Number(props.timeContext?.serverOffset?.value) || 0
  }
  return resolveTimeValue(node, currentTime)
}

function updateProgress(event) {
  if (!canInteract() || props.node.disabled) return
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
  const min = Number(props.node.progressMin) || 0
  const max = Number(props.node.progressMax) || 100
  props.node.progressValue = Math.round((min + ratio * Math.max(1, max - min)) * 100) / 100
  emit('form-change', { type: 'formProgress', value: props.node.progressValue })
}

function updateProgressKey(event) {
  if (!canInteract() || props.node.disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const min = Number(props.node.progressMin) || 0
  const max = Number(props.node.progressMax) || 100
  const step = Math.max(.01, (max - min) / 100)
  if (event.key === 'Home') props.node.progressValue = min
  else if (event.key === 'End') props.node.progressValue = max
  else props.node.progressValue = Math.max(min, Math.min(max, (Number(props.node.progressValue) || 0) + (['ArrowRight', 'ArrowUp'].includes(event.key) ? step : -step)))
  emit('form-change', { type: 'formProgress', value: props.node.progressValue })
}

function handleButtonClick() {
  if (!canInteract() || props.node.disabled) return
  if (props.node.buttonAction === 'count') props.node.clickCount = (Number(props.node.clickCount) || 0) + 1
  if (props.node.buttonAction === 'toggle') props.node.checked = !props.node.checked
  const message = props.node.buttonAction === 'message' ? String(props.node.actionMessage || '操作已执行') : ''
  emit('form-change', { type: 'button', action: props.node.buttonAction, count: props.node.clickCount, checked: props.node.checked, message })
}

const PROGRESS_CLOCK_FPS = 30
const SIGNAL_CLOCK_FPS = 30
let progressClock = null
let progressClockStartedAt = 0
let signalClock = null
const signalAnimationTimeline = createCanvasVisualAnimationTimeline()
const signalReducedMotion = ref(false)
let signalMotionPreference = null

function visualTimestamp() {
  return globalThis.performance?.now?.() ?? Date.now()
}

// CSS animations use their own compositor clock after mount. A fixed negative
// delay aligns progressively mounted nodes to the same clock without reactive
// per-node updates on every frame.
function hasBuiltInCssAnimation(source) {
  if (['flowDirection', 'flowPipe', 'rotatingFan', 'waterTank', 'particles'].includes(source?.type)) {
    return source.animation === 'flow'
  }
  return source?.type === 'heartbeat' && source.animation === 'pulse'
}

const builtInAnimationActive = computed(() => hasBuiltInCssAnimation(node.value))
const builtInAnimationDelay = ref(`${
  builtInAnimationActive.value && node.value.animationPaused !== true
    ? -visualTimestamp() / 1000
    : 0
}s`)
let previousBuiltInAnimationActive = builtInAnimationActive.value
watch(builtInAnimationActive, active => {
  if (active && !previousBuiltInAnimationActive) {
    builtInAnimationDelay.value = `${node.value.animationPaused === true ? 0 : -visualTimestamp() / 1000}s`
  }
  previousBuiltInAnimationActive = active
}, { flush: 'sync' })

function handleSignalMotionPreferenceChange(event) {
  const next = Boolean(event?.matches)
  if (next === signalReducedMotion.value) return
  const timestamp = signalClock?.value ?? visualTimestamp()
  signalAnimationTimeline.setSuspended(next, timestamp, [node.value])
  signalReducedMotion.value = next
  syncSignalClock()
}

function setupSignalMotionPreference() {
  if (props.preview) {
    signalReducedMotion.value = false
    signalAnimationTimeline.setSuspended(false, visualTimestamp(), [node.value])
    return
  }
  signalMotionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null
  const next = Boolean(signalMotionPreference?.matches)
  signalReducedMotion.value = next
  signalAnimationTimeline.setSuspended(next, visualTimestamp(), [node.value])
  if (signalMotionPreference?.addEventListener) {
    signalMotionPreference.addEventListener('change', handleSignalMotionPreferenceChange)
  } else {
    signalMotionPreference?.addListener?.(handleSignalMotionPreferenceChange)
  }
}

function syncProgressClock() {
  if (node.value.visible === false || !node.value.progressFluctuationEnabled) {
    if (progressClock) releaseVisualClock(PROGRESS_CLOCK_FPS)
    progressClock = null
    return
  }
  if (!progressClock) progressClock = acquireVisualClock(PROGRESS_CLOCK_FPS)
  progressClockStartedAt = progressClock.value || visualTimestamp()
}

const fluctuatingProgress = computed(() => {
  const source = node.value
  const rawFirst = Number(source.progressFluctuationMin)
  const rawSecond = Number(source.progressFluctuationMax)
  const first = Math.max(0, Math.min(1, Number.isFinite(rawFirst) ? rawFirst : 0))
  const second = Math.max(0, Math.min(1, Number.isFinite(rawSecond) ? rawSecond : 1))
  const low = Math.min(first, second)
  const high = Math.max(first, second)
  if (!source.progressFluctuationEnabled) return low
  const duration = Math.max(.2, Number(source.progressFluctuationDuration) || 2) * 1000
  const timestamp = progressClock?.value ?? visualTimestamp()
  return low + (high - low) * ((Math.sin((timestamp - progressClockStartedAt) / duration * Math.PI * 2 - Math.PI / 2) + 1) / 2)
})

const chartProgressPercent = computed(() => {
  const source = node.value
  if (source.progressFluctuationEnabled) return fluctuatingProgress.value * 100
  // 新参数绑定优先于旧 dataKey；没有新绑定时完整保留旧项目行为。
  const value = hasEnabledRuntimeBinding(source, 'progressValue')
    ? source.progressValue
    : runtimeValue.value ?? source.progressValue ?? 68
  return Math.max(0, Math.min(100, Number(value) || 0))
})
const boundProgressText = computed(() => Math.round((Number(node.value.progressValue) || 0) * 100) / 100)
const waterTankPercent = computed(() => Math.max(0, Math.min(100, Number(node.value.progressValue) || 0)))
const waterTankText = computed(() => Math.round(waterTankPercent.value * 100) / 100)

function particleAnimationDelay(index) {
  const duration = Math.max(.2, Number(node.value.animationDuration) || 1.5)
  return `${-Math.max(0, Number(index) - 1) * duration / 8}s`
}

function progressRadius(node) {
  const radius = Math.max(1, Number(node.progressThickness) || 12) / 2
  return `${node.progressStartShape === 'round' ? radius : 0}px ${node.progressEndShape === 'round' ? radius : 0}px ${node.progressEndShape === 'round' ? radius : 0}px ${node.progressStartShape === 'round' ? radius : 0}px`
}
function signalPalette(node) {
  const count = Math.max(1, Math.min(MAX_SIGNAL_COLORS, Math.trunc(Number(node.signalColorCount) || 2)))
  const colors = Array.isArray(node.signalColors) ? node.signalColors : [node.signalColor || '#21c58e', '#ef5350']
  return Array.from({ length: count }, (_, index) => colors[index] || '#21c58e')
}
function syncSignalClock() {
  const source = node.value
  const colors = signalPalette(source)
  const candidate = source.animation === 'blink'
    && source.visible !== false
    && colors.length > 1
  const externalTimestamp = props.signalAnimationTimestamp != null
    && Number.isFinite(Number(props.signalAnimationTimestamp))
  const active = !signalReducedMotion.value
    && !externalTimestamp
    && candidate
    && source.animationPaused !== true
  if (!candidate) signalAnimationTimeline.remove(source)
  if (!active) {
    if (candidate && source.animationPaused === true) {
      signalAnimationTimeline.resolve(source, signalClock?.value ?? visualTimestamp())
    }
    if (signalClock) releaseVisualClock(SIGNAL_CLOCK_FPS)
    signalClock = null
    return
  }
  if (!signalClock) {
    signalClock = acquireVisualClock(SIGNAL_CLOCK_FPS)
  }
  signalAnimationTimeline.resolve(source, signalClock.value ?? visualTimestamp())
}
function currentSignalColor() {
  const source = node.value
  const colors = signalPalette(source)
  if (source.animation !== 'blink' || colors.length <= 1) return colors[0]
  const externalTimestamp = Number(props.signalAnimationTimestamp)
  const timestamp = props.signalAnimationTimestamp != null && Number.isFinite(externalTimestamp)
    ? externalTimestamp
    : signalClock?.value ?? visualTimestamp()
  return signalLightColor(source, signalAnimationTimeline.resolve(source, timestamp))
}
function pencilPath(node) {
  const points = Array.isArray(node.pencilPoints) ? node.pencilPoints : []
  if (!points.length) return ''
  const coordinate = point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })
  const first = coordinate(points[0])
  if (points.length === 1) return `M ${first.x} ${first.y} L ${first.x + .001} ${first.y + .001}`
  if (!node.pencilSmooth || points.length < 3) {
    return `M ${first.x} ${first.y} ${points.slice(1).map(point => { const item = coordinate(point); return `L ${item.x} ${item.y}` }).join(' ')}${node.pencilClosed ? ' Z' : ''}`
  }
  let path = `M ${first.x} ${first.y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = coordinate(points[index])
    const next = coordinate(points[index + 1])
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`
  }
  const last = coordinate(points.at(-1))
  return `${path} L ${last.x} ${last.y}${node.pencilClosed ? ' Z' : ''}`
}
function markerSafeId(value) {
  return String(value || 'node').replace(/[^a-zA-Z0-9_-]/g, '-')
}
const polylineStartMarkerId = computed(() => `polyline-${markerSafeId(props.node.id)}-${visualInstanceId}-start-arrow`)
const polylineEndMarkerId = computed(() => `polyline-${markerSafeId(props.node.id)}-${visualInstanceId}-end-arrow`)
function polylinePath(node) {
  const points = Array.isArray(node.polylinePoints) ? node.polylinePoints : []
  if (!points.length) return ''
  const width = Math.max(.1, Number(node.w) || 1)
  const height = Math.max(.1, Number(node.h) || 1)
  const coordinates = points.map(point => ({
    x: Math.max(0, Math.min(1, Number(point?.x) || 0)) * width,
    y: Math.max(0, Math.min(1, Number(point?.y) || 0)) * height
  }))
  const first = coordinates[0]
  if (coordinates.length === 1) return `M ${first.x} ${first.y} L ${first.x + .001} ${first.y + .001}`
  return `M ${first.x} ${first.y} ${coordinates.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ')}`
}
function polylineStartArrowVisible(node) {
  if (node.type === 'flowDirection') return node.flowArrowVisible !== false && node.animationDirection === 'reverse'
  return node.polylineStartMarker === 'arrow'
}
function polylineEndArrowVisible(node) {
  if (node.type === 'flowDirection') return node.flowArrowVisible !== false && node.animationDirection !== 'reverse'
  return node.polylineEndMarker === 'arrow'
}
if (props.node.type === 'signalLight') {
  setupSignalMotionPreference()
  watch(() => {
    const source = node.value
    const colors = Array.isArray(source.signalColors)
      ? source.signalColors.slice(0, MAX_SIGNAL_COLORS).join(',')
      : source.signalColor || ''
    const externalTimestamp = props.signalAnimationTimestamp != null
      && Number.isFinite(Number(props.signalAnimationTimestamp))
    return `${source.visible !== false}|${source.animation}|${source.animationPaused === true}|${source.animationDuration}|${source.animationDirection}|${source.signalColorCount}|${colors}|${externalTimestamp}|${signalReducedMotion.value}`
  }, syncSignalClock, { immediate: true })
}
if (['progress', 'formProgress'].includes(props.node.type)) {
  watch(() => {
    const source = node.value
    return [source.visible !== false, source.progressFluctuationEnabled, source.progressFluctuationMin, source.progressFluctuationMax, source.progressFluctuationDuration]
  }, syncProgressClock, { immediate: true })
}
onUnmounted(() => {
  tableWindowDisposed = true
  tableBottomPinned = false
  tableWindowSettlePasses = 0
  releaseRuntimeBinding()
  releaseRuntimePointBindings()
  if (signalClock) releaseVisualClock(SIGNAL_CLOCK_FPS)
  signalAnimationTimeline.clear()
  signalMotionPreference?.removeEventListener?.('change', handleSignalMotionPreferenceChange)
  signalMotionPreference?.removeListener?.(handleSignalMotionPreferenceChange)
  if (progressClock) releaseVisualClock(PROGRESS_CLOCK_FPS)
  if (tableWindowFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(tableWindowFrame)
  videoElement.value?.pause()
})

function colorWithOpacity(color, opacity = 1) {
  const alpha = Math.max(0, Math.min(1, Number(opacity)))
  if (alpha >= 1) return color
  if (alpha <= 0) return 'transparent'
  const match = /^#([0-9a-f]{6})$/i.exec(color || '')
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}
</script>

<template>
  <div v-show="node.visible !== false" class="node-visual-scale-frame" :class="{ 'runtime-hidden': node.visible === false }" :style="visualScaleFrameStyle">
  <div
    class="node-body"
    @pointerdown="stopInteractivePointer"
    @dblclick="stopInteractiveDoubleClick"
    :class="[node.type, animationComponentActive ? `animation-${node.animation || 'none'}` : 'animation-none', animationComponentActive && node.type.startsWith('custom') && `custom-effect-${node.customEffect || 'bounce'}`, { 'border-hidden': node.borderVisible === false, 'motion-paused': animationComponentActive && node.animationPaused === true, disabled: node.disabled }]"
    :style="{
      '--shape-fill': colorWithOpacity(node.fill, node.backgroundOpacity ?? 1),
      '--shape-stroke': node.stroke,
      '--form-color': node.color,
      '--form-control-size': `${node.controlSize || 20}px`,
      '--form-switch-width': `${node.switchWidth || 42}px`,
      '--form-switch-height': `${node.switchHeight || 22}px`,
      '--form-progress-height': `${node.progressHeight || 12}px`,
      '--text-stroke-width': textStrokeWidth(node),
      '--text-stroke-color': node.color || '#26323d',
      '--shape-border-width': `${customBorderGeometry.strokeWidth}px`,
      '--shape-outer-radius': `${customBorderGeometry.outerRadius}px`,
      '--shape-border-style': node.borderStyle || 'solid',
      '--shape-dash-array': node.borderStyle === 'solid' ? 'none' : `${node.borderStyle === 'dotted' ? Math.max(.1, node.borderDashLength || 2) : Math.max(.1, node.borderDashLength || 8)} ${Math.max(.1, node.borderDashGap || 6)}`,
      '--shape-dash-cap': node.borderStyle === 'dotted' ? 'round' : 'butt',
      '--motion-speed': `${node.animationDuration || 1.5}s`,
      '--motion-direction': node.animationDirection || 'normal',
      '--built-in-animation-delay': builtInAnimationDelay,
      '--motion-delay': `${node.animationDelay || 0}s`,
      '--motion-easing': node.animationEasing || 'ease-in-out',
      '--motion-iterations': node.animationIterations || 'infinite',
      '--motion-distance': `${node.motionDistance || 18}px`,
      '--motion-scale': node.motionScale || 1.18,
      '--motion-rotate': `${node.motionRotate || 360}deg`,
      '--motion-color': node.motionColor || '#16b89a',
      '--visual-primary-color': node.visualPrimaryColor || '#16b89a',
      background: isPolylineNodeType(node.type) ? 'transparent' : colorWithOpacity(node.fill, node.backgroundOpacity ?? 1),
      borderColor: node.stroke,
      borderWidth: 0,
      borderStyle: 'none',
      boxShadow: isPolylineNodeType(node.type) ? 'none' : undefined,
      overflow: isPolylineNodeType(node.type) ? 'visible' : undefined,
      color: node.color,
      borderRadius: node.type === 'lineShape' ? '0' : `${customBorderGeometry.outerRadius}px`,
      opacity: node.opacity ?? 1,
      fontSize: `${node.fontSize || 14}px`,
      fontWeight: fontWeight(node),
      fontStyle: node.fontStyle || 'normal',
      textAlign: textAlignment(node)
    }"
  >
    <svg v-if="node.type === 'lineShape'" class="line-shape-visual" :viewBox="`0 0 ${lineShapeWidth(visualNode)} ${lineShapeHeight(visualNode)}`" preserveAspectRatio="none" data-testid="line-shape-visual" aria-hidden="true">
      <rect v-if="node.borderStyle === 'solid'" data-testid="line-shape-body" :x="lineShapeBorderWidth(visualNode) / 2" :y="lineShapeBorderWidth(visualNode) / 2" :width="Math.max(LINE_SHAPE_MIN_INNER_SIZE, lineShapeWidth(visualNode) - lineShapeBorderWidth(visualNode))" :height="Math.max(LINE_SHAPE_MIN_INNER_SIZE, lineShapeHeight(visualNode) - lineShapeBorderWidth(visualNode))" :fill="colorWithOpacity(node.fill, node.backgroundOpacity ?? 1)" :stroke="node.borderVisible === false || lineShapeBorderWidth(visualNode) === 0 ? 'none' : (node.stroke || '#485563')" :stroke-width="lineShapeBorderWidth(visualNode)" :stroke-dasharray="lineShapeDashArray(visualNode)" stroke-linejoin="miter" />
      <template v-else>
        <line data-testid="line-shape-body" :x1="lineShapeBodyInset(visualNode)" :y1="lineShapeHeight(visualNode) / 2" :x2="lineShapeWidth(visualNode) - lineShapeBodyInset(visualNode)" :y2="lineShapeHeight(visualNode) / 2" :stroke="lineShapeBorderWidth(visualNode) > 0 ? (node.stroke || '#485563') : colorWithOpacity(node.fill, node.backgroundOpacity ?? 1)" :stroke-width="lineShapeHeight(visualNode)" :stroke-dasharray="lineShapeBodyDashArray(visualNode)" :stroke-linecap="node.borderStyle === 'dotted' ? 'round' : 'butt'" />
        <line v-if="lineShapeBorderWidth(visualNode) > 0 && lineShapeInnerThickness(visualNode) > 0" data-testid="line-shape-body-fill" :x1="lineShapeBodyInset(visualNode)" :y1="lineShapeHeight(visualNode) / 2" :x2="lineShapeWidth(visualNode) - lineShapeBodyInset(visualNode)" :y2="lineShapeHeight(visualNode) / 2" :stroke="colorWithOpacity(node.fill, node.backgroundOpacity ?? 1)" :stroke-width="lineShapeInnerThickness(visualNode)" :stroke-dasharray="lineShapeBodyDashArray(visualNode)" :stroke-linecap="node.borderStyle === 'dotted' ? 'round' : 'butt'" />
      </template>
    </svg>
    <svg v-if="node.borderVisible !== false && !['lineShape','pencil','polyline','flowDirection'].includes(node.type) && !formVisualTypes.has(node.type)" class="custom-border" :viewBox="node.type === 'circle' || ['triangle','diamond','decision','star','hexagon','arrow'].includes(node.type) ? '0 0 100 100' : `0 0 ${customBorderGeometry.width} ${customBorderGeometry.height}`" preserveAspectRatio="none" aria-hidden="true">
      <circle v-if="node.type === 'circle'" cx="50" cy="50" r="50" />
      <polygon v-else-if="['triangle','diamond','decision','star','hexagon','arrow'].includes(node.type)" :points="({ triangle: '50,0 100,100 0,100', diamond: '50,0 100,50 50,100 0,50', decision: '50,0 100,50 50,100 0,50', star: '50,0 61,34 100,34 68,55 79,92 50,70 21,92 32,55 0,34 39,34', hexagon: '25,0 75,0 100,50 75,100 25,100 0,50', arrow: '0,25 65,25 65,0 100,50 65,100 65,75 0,75' })[node.type]" />
      <rect v-else x="0" y="0" :width="customBorderGeometry.width" :height="customBorderGeometry.height" :rx="customBorderGeometry.radius" :ry="customBorderGeometry.radius" />
    </svg>
    <template v-if="node.type === 'pencil'">
      <svg class="pencil-node-visual" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="铅笔线稿">
        <path :d="pencilPath(node)" :fill="node.pencilClosed ? colorWithOpacity(node.pencilColor, .16) : 'none'" :stroke="node.pencilColor" :stroke-width="Math.max(.1, Number(node.pencilWidth) || 2)" :stroke-dasharray="node.pencilDash ? `${Math.max(1, (Number(node.pencilWidth) || 2) * 4)} ${Math.max(1, (Number(node.pencilWidth) || 2) * 3)}` : 'none'" :stroke-linecap="node.pencilLineCap || 'round'" :stroke-linejoin="node.pencilLineJoin || 'round'" vector-effect="non-scaling-stroke" />
      </svg>
    </template>
    <template v-else-if="isPolylineNodeType(node.type)">
      <svg class="pencil-node-visual polyline-node-visual" :viewBox="`0 0 ${visualNode.w} ${visualNode.h}`" preserveAspectRatio="none" :aria-label="node.type === 'flowDirection' ? '流向' : '线段'">
        <defs>
          <marker v-if="polylineStartArrowVisible(node)" :id="polylineStartMarkerId" viewBox="0 0 10 10" :markerWidth="polylineArrowSize(node)" :markerHeight="polylineArrowSize(node)" refX="9" refY="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0,0 L10,5 L0,10 Z" :fill="colorWithOpacity(node.polylineColor || '#485563', polylineLineOpacity(node))" :stroke="polylineOutlineWidth(node) > 0 ? (node.stroke || '#485563') : 'none'" :stroke-width="polylineOutlineWidth(node)" stroke-linejoin="round" vector-effect="non-scaling-stroke" paint-order="stroke fill" /></marker>
          <marker v-if="polylineEndArrowVisible(node)" :id="polylineEndMarkerId" viewBox="0 0 10 10" :markerWidth="polylineArrowSize(node)" :markerHeight="polylineArrowSize(node)" refX="9" refY="5" markerUnits="userSpaceOnUse" orient="auto" overflow="visible"><path d="M0,0 L10,5 L0,10 Z" :fill="colorWithOpacity(node.polylineColor || '#485563', polylineLineOpacity(node))" :stroke="polylineOutlineWidth(node) > 0 ? (node.stroke || '#485563') : 'none'" :stroke-width="polylineOutlineWidth(node)" stroke-linejoin="round" vector-effect="non-scaling-stroke" paint-order="stroke fill" /></marker>
        </defs>
        <path v-if="polylineOutlineWidth(node) > 0" data-testid="polyline-node-outline" :class="{ 'flow-direction-path': node.type === 'flowDirection' }" :style="node.type === 'flowDirection' ? { '--flow-dash-cycle': `${polylineDashCycle(node)}px` } : undefined" :d="polylinePath(visualNode)" fill="none" :stroke="node.stroke || '#485563'" :stroke-width="polylineLineWidth(node) + polylineOutlineWidth(node) * 2" :stroke-dasharray="polylineDashArray(node)" :stroke-linecap="polylineStrokeLineCap(node)" :stroke-linejoin="node.polylineLineJoin || 'round'" vector-effect="non-scaling-stroke" />
        <path :data-testid="node.type === 'flowDirection' ? 'flow-direction-path' : 'polyline-node-path'" :class="{ 'flow-direction-path': node.type === 'flowDirection' }" :style="node.type === 'flowDirection' ? { '--flow-dash-cycle': `${polylineDashCycle(node)}px` } : undefined" :d="polylinePath(visualNode)" fill="none" :stroke="colorWithOpacity(node.polylineColor || '#485563', polylineLineOpacity(node))" :stroke-width="polylineLineWidth(node)" :stroke-dasharray="polylineDashArray(node)" :stroke-linecap="polylineStrokeLineCap(node)" :stroke-linejoin="node.polylineLineJoin || 'round'" :marker-start="polylineStartArrowVisible(node) ? `url(#${polylineStartMarkerId})` : undefined" :marker-end="polylineEndArrowVisible(node) ? `url(#${polylineEndMarkerId})` : undefined" vector-effect="non-scaling-stroke" />
      </svg>
    </template>
    <template v-else-if="['chart', 'lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart', 'echartsCode'].includes(node.type)">
      <EChartsVisual :node="visualNode" :interactive="preview" />
    </template>
    <template v-else-if="node.type === 'gauge'">
      <div class="gauge-face"><i class="gauge-needle"></i><output v-if="hasEnabledRuntimeBinding(node, 'progressValue')">{{ boundProgressText }}</output><RuntimeValueText v-else :key="node.dataKey" :data-key="node.dataKey" :runtime-store="runtimeStore" tag="output" :fallback="node.progressValue ?? 68" class-name="" /><small>%</small></div>
    </template>
    <template v-else-if="node.type === 'table'">
      <div ref="tableWrapperElement" class="form-table-wrapper" :data-table-virtualized="tableVirtualized ? 'true' : undefined" :style="{ borderColor: node.tableBorderColor || node.tableGridColor, borderWidth: `${Math.max(0, Number(node.tableBorderWidth) || 0)}px`, borderStyle: node.tableBorderStyle || 'solid', backgroundColor: colorWithOpacity(node.tableRowFill, node.backgroundOpacity ?? 1), overflowX: node.tableScrollX === false ? 'hidden' : 'auto', overflowY: node.tableScrollY === false ? 'hidden' : 'auto' }" @wheel.passive="releaseTableBottomPin" @pointerdown.capture="releaseTableBottomPin" @scroll.passive="handleTableScroll" @dblclick.stop.prevent>
        <div class="form-table-content" :style="{ width: `${tableMinWidth(visualNode)}px` }">
          <div v-if="node.showTableTitle !== false" class="form-table-title" :style="tableTitleStyle(visualNode)">{{ node.tableTitle ?? node.text }}</div>
          <div ref="tableGridElement" class="form-table-visual" :class="{ 'content-wrap': node.tableContentDisplay === 'wrap', 'content-ellipsis': node.tableContentDisplay !== 'wrap' }" :style="{ gridTemplateColumns: tableColumnsStyle(visualNode), gridTemplateRows: tableRowsStyle(visualNode), borderColor: node.tableGridColor }" role="table" :aria-rowcount="Math.max(1, Math.min(50, Number(node.tableRows) || node.tableCells?.length || 3)) + (node.showHeader === false ? 0 : 1)" :aria-colcount="Math.max(1, Math.min(12, Number(node.tableColumns) || node.tableHeaders?.length || 3))">
            <span v-for="cell in visibleTableCells" :key="cell.key" :class="{ header: cell.header, merged: cell.rowSpan > 1 || cell.columnSpan > 1, 'cell-expandable': tableCellCanOpen(cell) }" :style="tableCellStyle(visualNode, cell)" :data-table-cell-key="cell.key" :data-table-row="cell.row" :data-table-column="cell.column" :role="tableCellCanOpen(cell) ? 'button' : (cell.header ? 'columnheader' : 'cell')" :tabindex="tableCellCanOpen(cell) ? 0 : undefined" :title="tableCellCanOpen(cell) ? '查看完整内容' : undefined" @click="handleTableCellClick($event, cell)" @keydown="handleTableCellKey($event, cell)">{{ cell.text }}</span>
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="node.type === 'checkbox'">
      <label class="form-choice-visual form-control" :class="{ reverse: node.labelPosition === 'left' }"><input class="form-native-input" type="checkbox" :name="node.formName" :checked="node.checked" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @change="updateChecked($event)"><i class="form-checkbox-box" :class="{ checked: node.checked }"><Check v-if="node.checked" /></i><span>{{ node.text }}</span></label>
    </template>
    <template v-else-if="node.type === 'radio'">
      <label class="form-choice-visual form-control" :class="{ reverse: node.labelPosition === 'left' }"><input class="form-native-input" type="checkbox" role="radio" :aria-checked="Boolean(node.checked)" :name="node.formName" :checked="node.checked" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @change="updateChecked($event)"><i class="form-radio-dot" :class="{ checked: node.checked }"><b></b></i><span>{{ node.text }}</span></label>
    </template>
    <template v-else-if="node.type === 'switch'">
      <label class="form-switch-visual form-control" :class="{ reverse: node.labelPosition === 'left' }"><input class="form-native-input" type="checkbox" :name="node.formName" :checked="node.checked" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @change="updateChecked($event)"><i class="form-switch-track" :class="{ checked: node.checked }"><b></b></i><span>{{ node.text }}</span></label>
    </template>
    <template v-else-if="node.type === 'formProgress'">
      <div class="form-progress-visual form-control" :class="{ fluctuating: node.progressFluctuationEnabled }"><div class="form-progress-track" role="slider" :aria-valuemin="node.progressMin" :aria-valuemax="node.progressMax" :aria-valuenow="node.progressFluctuationEnabled ? progressPercent(node) : node.progressValue" :tabindex="canInteract() && !node.disabled && !node.progressFluctuationEnabled ? 0 : -1" :style="{ width: `${node.progressLength || 84}%`, height: `${node.progressThickness || node.progressHeight || 12}px`, borderRadius: progressRadius(node) }" @pointerdown.stop="!node.progressFluctuationEnabled && updateProgress($event)" @keydown="!node.progressFluctuationEnabled && updateProgressKey($event)"><i :style="{ width: `${progressPercent(node)}%`, borderRadius: progressRadius(node) }"></i></div><b v-if="node.showProgressText !== false">{{ progressText(node) }}</b></div>
    </template>
    <template v-else-if="node.type === 'button'">
      <button type="button" class="form-button-visual form-control" :class="{ toggled: node.buttonAction === 'toggle' && node.checked }" :style="{ backgroundColor: node.buttonAction === 'toggle' && node.checked ? node.buttonAfterColor : node.buttonAction === 'toggle' ? node.buttonBeforeColor : node.fill }" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @click.stop="handleButtonClick"><span>{{ node.text || '按钮' }}</span><small v-if="node.buttonAction === 'count' && node.showClickCount !== false && node.clickCount">{{ node.clickCount }}</small></button>
    </template>
    <template v-else-if="node.type === 'progress'">
      <div class="chart-progress-visual"><div class="progress-track" :style="{ width: `${node.progressLength || 84}%`, height: `${node.progressThickness || 12}px`, borderRadius: progressRadius(node) }"><i :style="{ width: `${chartProgressPercent}%`, borderRadius: progressRadius(node) }"></i></div><b>{{ Math.round(chartProgressPercent * 10) / 10 }}%</b></div>
    </template>
    <template v-else-if="node.type === 'input'">
      <input class="form-input-visual form-control" :type="safeInputType(node.inputType)" :name="node.formName" :value="node.value" :placeholder="node.placeholder || node.text" :maxlength="node.maxLength || undefined" :readonly="node.readOnly" :required="node.required" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @input="updateValue">
    </template>
    <template v-else-if="node.type === 'select'">
      <div class="form-select-visual form-control"><select :name="node.formName" :value="node.value" :required="node.required" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @change="updateValue"><option v-for="(item, index) in optionItems(node)" :key="`${index}-${item.value}`" :value="item.value">{{ item.label }}</option></select><ChevronDown /></div>
    </template>
    <template v-else-if="node.type === 'time'">
      <div class="form-time-visual form-control" :class="{ 'hide-right-icon': node.timeShowRightIcon === false }" data-testid="form-time-visual"><Clock3 v-if="node.timeShowLeftIcon !== false" data-testid="time-left-icon" /><input data-testid="time-input" :type="timeInputType(node.timeFormat)" :name="node.formName" :value="displayedTime(node)" :step="timeInputStep(node.timeFormat)" :readonly="node.timeUseServer || node.timeRunning" :disabled="node.disabled" :tabindex="canInteract() ? 0 : -1" @input="updateValue"></div>
    </template>
    <template v-else-if="node.type === 'flowPipe'">
      <div class="animated-pipe"><i></i></div>
    </template>
    <template v-else-if="node.type === 'rotatingFan'">
      <div class="fan-visual" :style="{ backgroundColor: colorWithOpacity('#edf3f2', node.backgroundOpacity ?? 1) }">
        <svg class="fan-rotor" viewBox="0 0 64 64" aria-hidden="true">
          <rect v-for="index in 4" :key="index" class="fan-blade" x="28" y="2" width="8" height="32" rx="4" :transform="`rotate(${(index - 1) * 90} 32 32)`" />
          <circle class="fan-hub" cx="32" cy="32" r="4.5" />
        </svg>
      </div>
    </template>
    <template v-else-if="node.type === 'signalLight'">
      <div class="signal-visual"><i :style="{ backgroundColor: currentSignalColor(), opacity: node.signalOpacity ?? 1 }"></i></div>
    </template>
    <template v-else-if="node.type === 'waterTank'">
      <div class="tank-visual"><i :style="{ height: `${waterTankPercent}%` }"></i><b>{{ waterTankText }}%</b></div>
    </template>
    <template v-else-if="node.type === 'heartbeat'">
      <svg class="alarm-visual" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path class="alarm-shape" d="M32 7 L58 54 H6 Z" />
        <path class="alarm-mark" d="M32 22 V38 M32 47 V47.5" />
      </svg>
    </template>
    <template v-else-if="node.type === 'particles'">
      <div class="particles-visual"><i v-for="index in 8" :key="index" :style="{ '--particle-delay': particleAnimationDelay(index) }"></i></div>
    </template>
    <template v-else-if="node.type === 'customMotion'">
      <div class="custom-motion-target custom-shape-visual"><Sparkles :size="34" /></div>
    </template>
    <template v-else-if="node.type === 'customTextMotion'">
      <span class="custom-motion-target custom-text-visual">{{ node.text }}</span>
    </template>
    <template v-else-if="node.type === 'customImageMotion'">
      <img v-if="node.imageUrl" class="custom-motion-target node-image custom-image-visual" :class="{ 'is-media-failed': imageLoadFailed }" :data-preview-media-state="imageLoadFailed ? 'error' : undefined" :src="node.imageUrl" alt="" :style="{ objectFit: node.imageFit || 'contain' }" @load="handleImageLoad" @error="handleImageLoadError" @preview-media-error="handleImageLoadError" />
      <div v-if="!node.imageUrl || imageLoadFailed" class="custom-motion-target custom-shape-visual"><Image :size="34" /></div>
    </template>
    <template v-else-if="node.type === 'customIndicator'">
      <div class="custom-motion-target custom-indicator-visual"><i></i></div>
    </template>
    <template v-else-if="node.type === 'server'">
      <Server :size="30" /><div class="status-lights"><i></i><i></i><i></i></div>
    </template>
    <template v-else-if="node.type === 'image'">
      <img v-if="node.imageUrl" class="node-image" :class="{ 'is-media-failed': imageLoadFailed }" :data-preview-media-state="imageLoadFailed ? 'error' : undefined" :src="node.imageUrl" alt="" :style="{ objectFit: node.imageFit || 'contain' }" @load="handleImageLoad" @error="handleImageLoadError" @preview-media-error="handleImageLoadError" />
      <Image v-if="!node.imageUrl || imageLoadFailed" :size="28" />
    </template>
    <template v-else-if="node.type === 'video'">
      <video v-if="node.videoUrl" ref="videoElement" class="node-video" :class="{ 'manual-toggle': preview && node.videoControls === false, 'is-media-failed': videoLoadFailed }" :data-preview-media-state="videoLoadFailed ? 'error' : undefined" :src="node.videoUrl" :style="{ objectFit: node.videoFit || 'contain' }" :muted="node.videoMuted !== false" :autoplay="preview && node.videoAutoplay && node.visible !== false" :controls="preview && node.videoControls !== false" :tabindex="preview && node.videoControls === false ? 0 : undefined" :role="preview && node.videoControls === false ? 'button' : undefined" :aria-label="preview && node.videoControls === false ? '播放或暂停视频' : undefined" playsinline :preload="preview ? 'auto' : 'metadata'" @loadedmetadata="initializeVideoPlayback" @loadeddata="handleVideoLoadedData" @error="handleVideoLoadError" @play="handleVideoPlay" @ended="handleVideoEnded" @click="toggleVideoPlayback" @keydown.enter.prevent="toggleVideoPlayback" @keydown.space.prevent="toggleVideoPlayback"></video>
      <Video v-if="!node.videoUrl || videoLoadFailed" :size="30" />
    </template>
    <Cloud v-else-if="node.type === 'cloud'" :size="34" />
    <Network v-else-if="node.type === 'network'" :size="30" />
    <Database v-else-if="node.type === 'database'" :size="30" />
    <HardDrive v-else-if="node.type === 'disk'" :size="30" />
    <Router v-else-if="node.type === 'router'" :size="30" />
    <span v-if="!formVisualTypes.has(node.type) && !chartVisualTypes.has(node.type) && !['progress','pencil','polyline','flowDirection'].includes(node.type) && !node.type.startsWith('custom') && !visualOnlyTypes.has(node.type) && !(node.type === 'image' && node.imageUrl) && !(node.type === 'video' && node.videoUrl)" class="node-text-content" :class="{ 'text-layout-vertical': node.type === 'text' && node.textLayout === 'vertical' }">{{ node.text }}</span>
    <RuntimeValueText v-if="node.dataKey && !hasEnabledRuntimeBinding(node, 'text') && !formVisualTypes.has(node.type) && !chartVisualTypes.has(node.type) && !['gauge','progress','polyline','flowDirection'].includes(node.type)" :key="node.dataKey" :data-key="node.dataKey" :runtime-store="runtimeStore" />
  </div>
  </div>
</template>

<style scoped>
.node-body.text {
  background: var(--shape-fill) !important;
}
</style>
