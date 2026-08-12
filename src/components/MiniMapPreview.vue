<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { acquireVisualClock, releaseVisualClock } from '../composables/useSharedVisualClock'
import { edgeEndpointsForNodes } from '../utils/edgeGeometry'
import {
  LINE_SHAPE_MIN_INNER_SIZE,
  lineShapeBorderWidth,
  lineShapeBodyDashSegments,
  lineShapeBodyInset,
  lineShapeDashSegments,
  lineShapeHeight,
  lineShapeInnerThickness,
  lineShapeWidth
} from '../utils/lineShapeGeometry'
import { miniMapTransform } from '../utils/miniMapGeometry'
import { multiplyOpacity } from '../utils/interactionOpacity'
import {
  createChunkedRenderScheduler,
  createCoalescedRenderTrigger
} from '../utils/chunkedRenderScheduler'
import {
  canReuseCanvasRenderSurface,
  createCanvasContextGate,
  restoreCanvasRenderTaskContexts
} from '../utils/canvasContextGate'
import {
  commitCanvasSurface,
  commitCanvasSurfaceWithResize
} from '../utils/canvasSurfaceCommit'
import { createSpatialIndex } from '../utils/spatialIndex'
import {
  EDITOR_LOD_GEOMETRY_MAX_SEGMENTS,
  editorLodGeometryRegions,
  editorLodIndexSegments,
  mergeEditorLodGeometryRegions
} from '../utils/editorLodGeometry'
import { resolveTimeValue } from '../utils/formTime'
import { formatRuntimeValue } from '../utils/runtimeValueFormat'
import {
  polylineArrowSize,
  polylineDashSegments,
  polylineLineOpacity,
  polylineLineWidth,
  polylineOutlineWidth,
  polylineStrokeLineCap
} from '../utils/polylineGeometry'
import {
  horizontalTextLayout,
  horizontalTextLines,
  TEXT_LAYOUT_LINE_HEIGHT,
  textBlockStart,
  verticalTextColumns
} from '../utils/textLayout'
import {
  createIncrementalTextLayout,
  finishIncrementalTextLayout,
  runIncrementalTextLayoutSlice
} from '../utils/incrementalTextLayout'
import {
  createRuntimeCandidateCursor,
  createRuntimeQueryCursor,
  createRuntimeRegionAccumulator,
  runtimeBitmapRect,
  runtimeNodeBitmapRect,
  runtimeNodeRegion
} from '../utils/runtimeCanvasRegions'
import {
  RUNTIME_DENSE_NODE_THRESHOLD,
  createRuntimeBitmapCoverageTracker,
  shouldUseDenseRuntime
} from '../utils/runtimeCanvasStrategy'
import { canvasBitmapDimensions } from '../utils/canvasBitmap'
import {
  drawEdgeRasterCommand,
  packEdgeRasterCommands
} from '../utils/edgeRasterDrawing'
import { createEdgeRasterWorkerClient } from '../utils/edgeRasterWorkerClient'
import {
  layoutConstrainedCanvasFontSize,
  readableCanvasFontSize
} from '../utils/canvasTextReadability'
import { previewFrameCommitRequested } from '../utils/previewFrameFreshness'
import {
  canvasVisualAnimationFramePlan,
  canvasVisualDetailSize,
  createCanvasVisualAnimationTimeline,
  flowPipeDashOffset,
  heartbeatAnimationScale,
  isCanvasVisualAnimationCandidate,
  isCanvasVisualAnimationNode,
  particleAnimationState,
  rotatingFanAngle,
  signalLightColor,
  waterTankAnimationState,
  waterTankWaveColor
} from '../utils/canvasVisualAnimation'
import { bindingPointIds } from '../models/dataBindingModel'
import {
  hasEnabledRuntimeBinding,
  materializeRuntimeNode,
  runtimeChartPercentages
} from '../utils/runtimeNodeMaterializer'
import { sharedPreviewImageCache } from '../utils/sharedPreviewImageCache'
import {
  canvasVisualAtlasBlitData,
  drawCanvasVisualAtlasBlits,
  mapCanvasVisualAtlasInstances,
  packCanvasVisualAtlas
} from '../utils/canvasVisualAtlas'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  drawings: { type: Array, default: () => [] },
  stageWidth: { type: Number, required: true },
  stageHeight: { type: Number, required: true },
  width: { type: Number, default: 240 },
  height: { type: Number, default: 150 },
  viewBox: { type: Object, default: null },
  background: { type: String, default: '#f7f8fa' },
  fitMode: { type: String, default: 'stretch', validator: value => ['stretch', 'contain'].includes(value) },
  preferText: { type: Boolean, default: false },
  faithful: { type: Boolean, default: false },
  minimumScreenTextSize: { type: Number, default: 0 },
  minimumScreenStrokeSize: { type: Number, default: 0 },
  renderRevision: { type: Number, default: 0 },
  nodeIndex: { type: Object, default: null },
  orderedEntities: { type: Array, default: null },
  excludedNodeIds: { type: Array, default: () => [] },
  excludedDrawingIds: { type: Array, default: () => [] },
  renderPlanKey: { type: String, default: '' },
  frameCommitToken: { type: Object, default: null },
  frameCommitGuard: { type: Function, default: null },
  runtimeStore: { type: Object, default: null },
  timeContext: { type: Object, default: null },
  spatialIndex: { type: Object, default: null },
  edgeSpatialIndex: { type: Object, default: null },
  drawingSpatialIndex: { type: Object, default: null },
  renderNodes: { type: Boolean, default: true },
  renderDrawings: { type: Boolean, default: true },
  incrementalRuntime: { type: Boolean, default: false },
  geometryInteractive: { type: Boolean, default: false },
  atomicCssSize: { type: Boolean, default: false },
  maxBitmapPixels: { type: Number, default: 0 },
  pixelRatio: { type: Number, default: 0 },
  renderBudgetMs: { type: Number, default: 2 },
  renderMode: { type: String, default: 'idle', validator: value => ['idle', 'frame', 'task'].includes(value) },
  waitForImages: { type: Boolean, default: false },
  respectReducedMotion: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  testId: { type: String, default: 'minimap-preview' },
  ariaLabel: { type: String, default: '鹰眼组件缩略图' }
})

const emit = defineEmits(['render-complete', 'render-rejected', 'render-error', 'geometry-complete'])

const canvas = ref(null)
const renderReady = ref(false)
const committedGeneration = ref(0)
const committedCssWidth = ref(0)
const committedCssHeight = ref(0)
const committedRenderPlanKey = ref('')
const canvasContextGate = createCanvasContextGate()
const imageCache = new Map()
let deferredImageUrls = new Set()
const reusableRenderSurfaces = []
const reusableVisualSpriteSurfaces = []
let reusableVisualSpritePixelCount = 0
let canvasVisualSpriteDescriptorCache = new WeakMap()
let canvasVisualSpriteStaticSignatureIds = new Map()
let canvasVisualAnimationProfileIds = new Map()
let nextCanvasVisualSpriteStaticSignatureId = 1
let nextCanvasVisualAnimationProfileId = 1
let canvasVisualAnimationStreamStates = new WeakMap()
const canvasVisualAtlasFrameCache = new Map()
let canvasVisualAtlasFramePixelCount = 0
let canvasVisualDirectAtlasFrameCache = null
let committedStaticSurface = null
let committedStaticFrame = null
let committedCompositeSurface = null
let runtimeBackSurface = null
let runtimeBackSyncRects = []
let committedTimeNodes = []
let committedVisualAnimationNodes = []
let committedVisualAnimationNodeMap = new Map()
let committedSignalLightColors = new Map()
let committedDirectSignalLightTimestamp = null
let visibleVisualAnimationNodes = []
let visualAnimationViewportKey = ''
let visualAnimationViewportDirty = true
let visualAnimationClipTarget = null
let visualAnimationClipAncestors = []
let visualAnimationClock = null
let stopVisualAnimationClockWatch = null
let visualAnimationLastFrameTimestamp = null
let visualAnimationFrameIntervalMs = 0
let visualAnimationMeasuredFrameMs = 0
let visualAnimationMeasuredNodeCount = 0
let visualAnimationTickCount = 0
const visualAnimationMotionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null
let visualAnimationReducedMotion = props.respectReducedMotion
  && Boolean(visualAnimationMotionPreference?.matches)
const visualAnimationTimeline = createCanvasVisualAnimationTimeline()
visualAnimationTimeline.setSuspended(visualAnimationReducedMotion)
let committedExcludedNodeIds = new Set()
let committedExcludedDrawingIds = new Set()
let committedEdgeSpatialIndex = null
let committedDrawingSpatialIndex = null
let committedEdgeSegmentIds = new Map()
let committedDrawingSegmentIds = new Map()
let committedGeometryIndexesComplete = false
let geometryInteraction = null
let nextGeometrySessionId = 1
let reportedCanvasErrorEpoch = -1
let suspendedRenderDirty = false

const DEFAULT_RENDER_SLICE_BUDGET_MS = 2
const MIN_RENDER_SLICE_BUDGET_MS = 1
const MAX_RENDER_SLICE_BUDGET_MS = 6
const RUNTIME_RENDER_SLICE_BUDGET_MS = 2
const RUNTIME_ANIMATION_RENDER_SLICE_BUDGET_MS = 12
const RUNTIME_ANIMATION_MAX_TASK_BURST_MS = 48
const RUNTIME_VISUAL_SPRITE_MAX_SIGNATURES = 512
const RUNTIME_VISUAL_SPRITE_MAX_SURFACES = 256
const RUNTIME_VISUAL_SPRITE_MAX_ITEM_PIXELS = 262144
const RUNTIME_VISUAL_SPRITE_MAX_TOTAL_PIXELS = 4194304
const RUNTIME_VISUAL_SPRITE_POOL_MAX_SURFACES = 256
const RUNTIME_VISUAL_SPRITE_POOL_MAX_TOTAL_PIXELS = 4194304
const RUNTIME_VISUAL_SPRITE_SUBPIXEL_STEPS = 4
const RUNTIME_VISUAL_SPRITE_DENSE_THRESHOLD = 512
const RUNTIME_VISUAL_ATLAS_MIN_INSTANCES = 32
const RUNTIME_VISUAL_ATLAS_MAX_ENTRIES = 4096
const RUNTIME_VISUAL_ATLAS_MAX_DIMENSION = 4096
const RUNTIME_VISUAL_ATLAS_MAX_PIXELS = 8388608
const RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_ENTRIES = 2
const RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_PIXELS = 16777216
const VISUAL_ANIMATION_CLOCK_FPS = 60
const RUNTIME_RENDER_NODE_BATCH_SIZE = 512
const RUNTIME_REGION_MERGE_SIZE = 512
const RUNTIME_CURSOR_OPERATION_LIMIT = 4096
const RUNTIME_SURFACE_SEED_STRIP_PIXELS = 262144
const RUNTIME_DENSE_STREAM_MAX_WAIT_MS = 48
const GEOMETRY_INDEX_CELL_SIZE = 384
const GEOMETRY_QUERY_LIMIT = 1025
const GEOMETRY_TOTAL_CANDIDATE_LIMIT = 4096
const GEOMETRY_MAX_PATCH_PIXELS = 262144
const GEOMETRY_MAX_TOTAL_PATCH_PIXELS = 1048576
const RENDER_IDLE_TIMEOUT_MS = 120
const MAX_REUSABLE_RENDER_SURFACES = 2
const TASK_RENDER_MAX_CONSECUTIVE_SLICES = 2
const EDGE_RASTER_WORKER_THRESHOLD = 2048
const EDGE_RASTER_WORKER_BATCH_SIZE = 512
const LONG_TEXT_INCREMENTAL_THRESHOLD = 512
// 与 NodeVisual 的固定内件配色保持一致；node.color 是文字颜色，不能作为动效强调色。
const VISUAL_ACCENT_COLOR = '#16b89a'
const VISUAL_HEARTBEAT_COLOR = '#ef5350'
const supportsIdleRender = typeof globalThis.requestIdleCallback === 'function'
  && typeof globalThis.cancelIdleCallback === 'function'
const supportsFrameRender = typeof globalThis.requestAnimationFrame === 'function'
  && typeof globalThis.cancelAnimationFrame === 'function'
const supportsTaskRender = typeof globalThis.MessageChannel === 'function'
const taskRenderCallbacks = new Map()
let taskRenderChannel = null
let nextTaskRenderId = 1
let taskRenderConsecutiveSlices = 0
let animationRenderBurstGeneration = -1
let animationRenderBurstStartedAt = 0
const edgeRasterWorkerClient = createEdgeRasterWorkerClient()

function handleVisualAnimationMotionPreferenceChange(event) {
  const next = props.respectReducedMotion && Boolean(event?.matches)
  if (next === visualAnimationReducedMotion) return
  visualAnimationReducedMotion = next
  const timestamp = currentAnimationTimestamp()
  const effectiveNodes = []
  if (next) {
    for (const sourceNode of committedVisualAnimationNodeMap.values()) {
      const effective = materializeRuntimeNode(sourceNode, runtimePointValue)
      if (isCanvasVisualAnimationCandidate(effective)) effectiveNodes.push(effective)
    }
  }
  visualAnimationTimeline.setSuspended(next, timestamp, effectiveNodes)
  syncVisualAnimationClock()
}

function attachVisualAnimationMotionPreference() {
  visualAnimationMotionPreference?.addEventListener?.('change', handleVisualAnimationMotionPreferenceChange)
  if (!visualAnimationMotionPreference?.addEventListener) {
    visualAnimationMotionPreference?.addListener?.(handleVisualAnimationMotionPreferenceChange)
  }
}

function detachVisualAnimationMotionPreference() {
  visualAnimationMotionPreference?.removeEventListener?.('change', handleVisualAnimationMotionPreferenceChange)
  if (!visualAnimationMotionPreference?.removeEventListener) {
    visualAnimationMotionPreference?.removeListener?.(handleVisualAnimationMotionPreferenceChange)
  }
}

onMounted(attachVisualAnimationMotionPreference)
watch(() => props.respectReducedMotion, () => {
  handleVisualAnimationMotionPreferenceChange(visualAnimationMotionPreference)
}, { flush: 'sync' })

function normalizedRenderSliceBudgetMs(value) {
  const requested = Number(value)
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_RENDER_SLICE_BUDGET_MS
  return Math.min(MAX_RENDER_SLICE_BUDGET_MS, Math.max(MIN_RENDER_SLICE_BUDGET_MS, requested))
}

function runtimeRenderSliceBudget(context) {
  return context?.payload?.visualAnimationFrame
    ? RUNTIME_ANIMATION_RENDER_SLICE_BUDGET_MS
    : RUNTIME_RENDER_SLICE_BUDGET_MS
}

function scheduleTaskRender(callback) {
  if (!supportsTaskRender) return { type: 'timer', id: globalThis.setTimeout(callback, 0) }
  if (!taskRenderChannel) {
    taskRenderChannel = new globalThis.MessageChannel()
    taskRenderChannel.port1.onmessage = event => {
      const queued = taskRenderCallbacks.get(event.data)
      if (!queued) return
      taskRenderCallbacks.delete(event.data)
      queued()
    }
  }
  const id = nextTaskRenderId++
  taskRenderCallbacks.set(id, callback)
  taskRenderChannel.port2.postMessage(id)
  return { type: 'task', id }
}

function acquireRenderSurface(width, height, reusable) {
  const surface = reusable && reusableRenderSurfaces.length
    ? reusableRenderSurfaces.pop()
    : document.createElement('canvas')
  if (surface.width !== width) surface.width = width
  if (surface.height !== height) surface.height = height
  return surface
}

function releaseRenderSurface(surface, reusable) {
  if (!surface) return
  let context = null
  if (reusable) {
    try {
      context = surface.getContext?.('2d') || null
    } catch {}
  }
  if (
    canReuseCanvasRenderSurface(reusable, context)
    && reusableRenderSurfaces.length < MAX_REUSABLE_RENDER_SURFACES
  ) {
    reusableRenderSurfaces.push(surface)
    return
  }
  surface.width = 0
  surface.height = 0
}

function clearReusableRenderSurfaces() {
  for (const surface of reusableRenderSurfaces.splice(0)) {
    surface.width = 0
    surface.height = 0
  }
}

function acquireCanvasVisualSpriteSurface(width, height) {
  let matchIndex = -1
  for (let index = reusableVisualSpriteSurfaces.length - 1; index >= 0; index -= 1) {
    const candidate = reusableVisualSpriteSurfaces[index]
    if (candidate.width === width && candidate.height === height) {
      matchIndex = index
      break
    }
  }
  if (matchIndex < 0 && reusableVisualSpriteSurfaces.length) {
    matchIndex = reusableVisualSpriteSurfaces.length - 1
  }
  const surface = matchIndex >= 0
    ? reusableVisualSpriteSurfaces.splice(matchIndex, 1)[0]
    : globalThis.document?.createElement?.('canvas') || null
  if (!surface) return null
  if (matchIndex >= 0) {
    reusableVisualSpritePixelCount = Math.max(
      0,
      reusableVisualSpritePixelCount - Math.max(0, surface.width * surface.height)
    )
  }
  try {
    // Assigning the bitmap dimensions also resets every 2D context state and clears stale pixels.
    surface.width = width
    surface.height = height
    return surface
  } catch {
    try {
      surface.width = 0
      surface.height = 0
    } catch {}
    return null
  }
}

function releaseCanvasVisualSpriteSurface(surface) {
  if (!surface) return false
  const pixelCount = Math.max(0, number(surface.width) * number(surface.height))
  let context = null
  try { context = surface.getContext?.('2d') || null } catch {}
  if (
    context
    && pixelCount > 0
    && pixelCount <= RUNTIME_VISUAL_SPRITE_MAX_ITEM_PIXELS
    && reusableVisualSpriteSurfaces.length < RUNTIME_VISUAL_SPRITE_POOL_MAX_SURFACES
    && reusableVisualSpritePixelCount + pixelCount <= RUNTIME_VISUAL_SPRITE_POOL_MAX_TOTAL_PIXELS
  ) {
    reusableVisualSpriteSurfaces.push(surface)
    reusableVisualSpritePixelCount += pixelCount
    return true
  }
  surface.width = 0
  surface.height = 0
  return false
}

function clearReusableVisualSpriteSurfaces() {
  for (const surface of reusableVisualSpriteSurfaces.splice(0)) {
    surface.width = 0
    surface.height = 0
  }
  reusableVisualSpritePixelCount = 0
}

function releaseCanvasVisualAtlasFrame(entry) {
  if (!entry) return
  canvasVisualAtlasFramePixelCount = Math.max(
    0,
    canvasVisualAtlasFramePixelCount - Math.max(0, number(entry.pixels))
  )
  try {
    entry.surface.width = 0
    entry.surface.height = 0
  } catch {}
  entry.slotSignatures?.clear?.()
}

function clearCanvasVisualAtlasFrameCache() {
  for (const entry of canvasVisualAtlasFrameCache.values()) releaseCanvasVisualAtlasFrame(entry)
  canvasVisualAtlasFrameCache.clear()
  canvasVisualAtlasFramePixelCount = 0
}

function trimCanvasVisualAtlasFrameCache(additionalPixels = 0) {
  while (
    canvasVisualAtlasFrameCache.size >= RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_ENTRIES
    || canvasVisualAtlasFramePixelCount + additionalPixels > RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_PIXELS
  ) {
    const oldest = canvasVisualAtlasFrameCache.entries().next().value
    if (!oldest) break
    canvasVisualAtlasFrameCache.delete(oldest[0])
    releaseCanvasVisualAtlasFrame(oldest[1])
  }
}

function cachedCanvasVisualAtlasFrame(layoutKey) {
  const entry = canvasVisualAtlasFrameCache.get(layoutKey)
  if (!entry) return null
  canvasVisualAtlasFrameCache.delete(layoutKey)
  canvasVisualAtlasFrameCache.set(layoutKey, entry)
  return entry
}

function acquireCanvasVisualAtlasFrame(layoutKey, plan) {
  const cached = cachedCanvasVisualAtlasFrame(layoutKey)
  if (cached) return cached
  const width = Math.max(1, Math.floor(number(plan?.width)))
  const height = Math.max(1, Math.floor(number(plan?.height)))
  const pixels = width * height
  if (
    width > RUNTIME_VISUAL_ATLAS_MAX_DIMENSION
    || height > RUNTIME_VISUAL_ATLAS_MAX_DIMENSION
    || pixels > RUNTIME_VISUAL_ATLAS_MAX_PIXELS
    || pixels > RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_PIXELS
  ) return null
  trimCanvasVisualAtlasFrameCache(pixels)
  if (
    canvasVisualAtlasFrameCache.size >= RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_ENTRIES
    || canvasVisualAtlasFramePixelCount + pixels > RUNTIME_VISUAL_ATLAS_FRAME_CACHE_MAX_PIXELS
  ) return null
  const surface = globalThis.document?.createElement?.('canvas') || null
  if (!surface) return null
  try {
    surface.width = width
    surface.height = height
    const context = surface.getContext?.('2d') || null
    if (!context) throw new Error('visual atlas context unavailable')
    const entry = { surface, context, plan, pixels, slotSignatures: new Map() }
    canvasVisualAtlasFrameCache.set(layoutKey, entry)
    canvasVisualAtlasFramePixelCount += pixels
    return entry
  } catch {
    try {
      surface.width = 0
      surface.height = 0
    } catch {}
    return null
  }
}

function releaseCanvasVisualAtlasResources() {
  invalidateCanvasVisualDirectAtlasFrame()
  clearCanvasVisualAtlasFrameCache()
  canvasVisualSpriteDescriptorCache = new WeakMap()
  resetCanvasVisualSignatureIds()
}

function invalidateCanvasVisualDirectAtlasFrame() {
  canvasVisualDirectAtlasFrameCache = null
}

function resetCanvasVisualSignatureIds() {
  canvasVisualSpriteStaticSignatureIds = new Map()
  canvasVisualAnimationProfileIds = new Map()
  nextCanvasVisualSpriteStaticSignatureId = 1
  nextCanvasVisualAnimationProfileId = 1
  canvasVisualAnimationStreamStates = new WeakMap()
}

function scheduleTaskRenderSlice(callback) {
  if (!supportsFrameRender) return scheduleTaskRender(callback)
  // 首帧没有可展示的中间结果；继续用短任务切片，避免后台或嵌入页的 rAF 限频把每次让出放大到 1 秒。
  if (!renderReady.value) {
    taskRenderConsecutiveSlices = 0
    return scheduleTaskRender(callback)
  }
  if (taskRenderConsecutiveSlices < TASK_RENDER_MAX_CONSECUTIVE_SLICES) {
    taskRenderConsecutiveSlices += 1
    return scheduleTaskRender(callback)
  }
  taskRenderConsecutiveSlices = 0
  return { type: 'frame', id: globalThis.requestAnimationFrame(() => callback()) }
}

function resetTaskRenderFrameYield() {
  taskRenderConsecutiveSlices = 0
}

function resetAnimationRenderBurst() {
  animationRenderBurstGeneration = -1
  animationRenderBurstStartedAt = 0
}

function visualAnimationInputPending() {
  const scheduler = globalThis.navigator?.scheduling
  if (typeof scheduler?.isInputPending !== 'function') return false
  try {
    return scheduler.isInputPending({ includeContinuous: true }) === true
  } catch {
    try { return scheduler.isInputPending() === true } catch { return false }
  }
}

function scheduleAnimationRenderSlice(callback, context) {
  resetTaskRenderFrameYield()
  const generation = Number(context?.generation)
  const now = currentAnimationTimestamp()
  if (generation !== animationRenderBurstGeneration || !animationRenderBurstStartedAt) {
    animationRenderBurstGeneration = generation
    animationRenderBurstStartedAt = now
  }
  const shouldYieldFrame = supportsFrameRender && (
    visualAnimationInputPending()
    || now - animationRenderBurstStartedAt >= RUNTIME_ANIMATION_MAX_TASK_BURST_MS
  )
  if (!shouldYieldFrame) return scheduleTaskRender(callback)
  animationRenderBurstStartedAt = 0
  return {
    type: 'frame',
    id: globalThis.requestAnimationFrame(() => {
      if (generation === animationRenderBurstGeneration) {
        animationRenderBurstStartedAt = currentAnimationTimestamp()
      }
      callback()
    })
  }
}

function scheduleRenderSlice(callback, context) {
  if (context?.payload?.visualAnimationFrame) return scheduleAnimationRenderSlice(callback, context)
  resetAnimationRenderBurst()
  if (props.renderMode === 'task') return scheduleTaskRenderSlice(callback)
  resetTaskRenderFrameYield()
  if (props.renderMode === 'frame' && supportsFrameRender) {
    return { type: 'frame', id: globalThis.requestAnimationFrame(() => callback()) }
  }
  if (supportsIdleRender) {
    return { type: 'idle', id: globalThis.requestIdleCallback(callback, { timeout: RENDER_IDLE_TIMEOUT_MS }) }
  }
  return { type: 'timer', id: globalThis.setTimeout(callback, 0) }
}

function cancelRenderSlice(handle) {
  if (handle?.type === 'task') taskRenderCallbacks.delete(handle.id)
  else if (handle?.type === 'frame') globalThis.cancelAnimationFrame(handle.id)
  else if (handle?.type === 'idle') globalThis.cancelIdleCallback(handle.id)
  else globalThis.clearTimeout(handle?.id)
}

function scheduleImageRender(callback) {
  if (props.renderMode === 'task' || !renderReady.value) return scheduleTaskRender(callback)
  if (supportsFrameRender) {
    return { type: 'frame', id: globalThis.requestAnimationFrame(callback) }
  }
  return scheduleTaskRender(callback)
}

const imageRenderTrigger = createCoalescedRenderTrigger({
  schedule: scheduleImageRender,
  cancel: cancelRenderSlice,
  flush: requestCoalescedRender
})

function queueRenderMicrotask(callback) {
  if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(callback)
  else Promise.resolve().then(callback)
}

function reportCanvasRenderError(reason, error = null, force = false) {
  const preservesVisibleFrame = committedGeneration.value > 0
    && !['context-lost', 'context-unavailable'].includes(reason)
  renderReady.value = false
  const state = canvasContextGate.state()
  if (!force && reportedCanvasErrorEpoch === state.epoch) return
  reportedCanvasErrorEpoch = state.epoch
  emit('render-error', {
    reason,
    epoch: state.epoch,
    preservesVisibleFrame,
    message: error?.message || ''
  })
}

function handleCanvasContextLost(event) {
  const target = event?.currentTarget || canvas.value
  event?.preventDefault?.()
  canvasContextGate.bind(target)
  if (!canvasContextGate.markLost(target)) return
  geometryInteraction = null
  invalidatePendingRender('context-lost')
  invalidateIncrementalRuntime()
  replaceCommittedStaticSurface(null)
  replaceCommittedCompositeSurface(null)
  replaceCommittedGeometryIndexes(null, null)
  reportCanvasRenderError('context-lost')
}

function handleCanvasContextRestored(event) {
  const target = event?.currentTarget || canvas.value
  if (!canvasContextGate.markRestored(target)) return
  reportedCanvasErrorEpoch = -1
  renderReady.value = false
  scheduleRender()
}

const shapePoints = {
  triangle: [[.5, 0], [1, 1], [0, 1]],
  diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  decision: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  star: [[.5, 0], [.61, .34], [1, .34], [.68, .55], [.79, .92], [.5, .7], [.21, .92], [.32, .55], [0, .34], [.39, .34]],
  hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]],
  arrow: [[0, .25], [.65, .25], [.65, 0], [1, .5], [.65, 1], [.65, .75], [0, .75]]
}

const runtimeBadgeExcludedTypes = new Set([
  'table', 'checkbox', 'radio', 'switch', 'formProgress', 'button', 'input', 'select', 'time',
  'gauge', 'progress', 'polyline'
])
const canvasVisualAnimationTypes = new Set([
  'flowPipe',
  'rotatingFan',
  'signalLight',
  'waterTank',
  'heartbeat',
  'particles'
])

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function currentAnimationTimestamp() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function alpha(value, fallback = 1) {
  return Math.max(0, Math.min(1, number(value, fallback)))
}

function runtimeValue(node) {
  const key = String(node?.dataKey ?? '').trim()
  return key ? props.runtimeStore?.getValue?.(key) : undefined
}

function runtimePointValue(pointId) {
  return props.runtimeStore?.getValue?.(pointId)
}

function hasIncrementalRuntimeVisual(node) {
  if (node?.type === 'time') return true
  if (bindingPointIds(node).length) return true
  const key = String(node?.dataKey ?? '').trim()
  return Boolean(key && (['gauge', 'progress'].includes(node.type) || !runtimeBadgeExcludedTypes.has(node.type)))
}

function runtimeDisplayText(value, fallback) {
  const resolved = value === undefined ? fallback : value
  if (resolved === undefined || resolved === null) return ''
  return formatRuntimeValue(resolved)
}

function previewTime(node) {
  let currentTime = Date.now()
  if (node.timeRunning) {
    currentTime = Number(props.timeContext?.tick?.value) || currentTime
    if (node.timeUseServer) currentTime += Number(props.timeContext?.serverOffset?.value) || 0
  }
  return resolveTimeValue(node, currentTime)
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(number(radius), width / 2, height / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, safeRadius)
}

function polygon(ctx, width, height, points) {
  ctx.beginPath()
  points.forEach(([x, y], index) => {
    const px = x * width
    const py = y * height
    if (index) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  })
  ctx.closePath()
}

function nodePath(ctx, node, width, height) {
  if (node.type === 'circle') {
    ctx.beginPath()
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    return
  }
  const points = shapePoints[node.type]
  if (points) return polygon(ctx, width, height, points)
  roundedRect(ctx, 0, 0, width, height, number(node.radius))
}

function readableStroke(requestedWidth, worldPixel) {
  const requested = Math.max(.1, number(requestedWidth, 1))
  const minimumScreenSize = Math.max(0, number(props.minimumScreenStrokeSize))
  return minimumScreenSize > 0
    ? Math.max(requested, worldPixel * minimumScreenSize)
    : requested
}

function visibleStroke(node, width, height, worldPixel, requestedWidth = node.borderWidth) {
  const requested = Math.max(.1, number(requestedWidth, 1))
  if (props.faithful) return readableStroke(requested, worldPixel)
  return Math.max(
    readableStroke(requested, worldPixel),
    Math.min(worldPixel * .8, Math.max(1, Math.min(width, height) / 5))
  )
}

function strokeNodeOutline(ctx, node, width, height, worldPixel) {
  if (node.borderVisible === false) return
  const requestedBorderWidth = Number(node.borderWidth)
  if (Number.isFinite(requestedBorderWidth) && requestedBorderWidth <= 0) return
  nodePath(ctx, node, width, height)
  ctx.strokeStyle = node.stroke || '#485563'
  ctx.lineWidth = visibleStroke(
    node,
    width,
    height,
    worldPixel,
    Number.isFinite(requestedBorderWidth) ? requestedBorderWidth : 1
  )
  if (node.borderStyle === 'dashed' || node.borderStyle === 'dotted') {
    const defaultDashLength = node.borderStyle === 'dotted' ? 2 : 8
    const dashLength = Math.max(.1, number(node.borderDashLength) || defaultDashLength)
    const dashGap = Math.max(.1, number(node.borderDashGap) || 6)
    ctx.setLineDash([dashLength, dashGap])
    if (node.borderStyle === 'dotted') ctx.lineCap = 'round'
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineCap = 'butt'
}

function fillAndStroke(ctx, node, width, height, worldPixel, fallbackFill = '#dceee9') {
  nodePath(ctx, node, width, height)
  ctx.save()
  try {
    ctx.globalAlpha *= alpha(node.backgroundOpacity)
    ctx.fillStyle = node.fill || fallbackFill
    ctx.fill()
  } finally {
    ctx.restore()
  }
  strokeNodeOutline(ctx, node, width, height, worldPixel)
}

function canvasTextFont(node, fontSize) {
  return `${node.fontStyle || 'normal'} ${number(node.fontWeight, 400)} ${fontSize}px "Microsoft YaHei", sans-serif`
}

function canvasTextDrawPlan(node, width, height, scaleX, scaleY, override) {
  const screenWidth = width * scaleX
  const screenHeight = height * scaleY
  const preferText = props.preferText && node.type === 'text'
  const faithfulText = props.faithful
  if (screenWidth < (preferText ? 5 : faithfulText ? .15 : 12) || screenHeight < (preferText ? 2.5 : faithfulText ? .15 : 7)) {
    return { visible: false }
  }

  const text = String(override ?? node.text ?? '')
  const safeScaleY = Math.max(.0001, scaleY)
  const requestedFontSize = Math.max(.1, number(node.fontSize, 14))
  const minimumScreenFontSize = preferText ? 5 : 6
  const fittedFontSize = height * (preferText ? .78 : .62)
  const readableFontSize = minimumScreenFontSize / safeScaleY
  const fontSize = faithfulText
    ? readableCanvasFontSize({
        requestedSize: requestedFontSize,
        minimumScreenSize: props.minimumScreenTextSize,
        scaleY: safeScaleY,
        layoutHeight: height,
        heightRatio: node.type === 'text' ? .9 : .72
      })
    : preferText
      ? Math.max(readableFontSize, Math.min(fittedFontSize, Math.max(number(node.fontSize, 14), readableFontSize)))
      : Math.min(fittedFontSize, Math.max(number(node.fontSize, 14), readableFontSize))

  return {
    visible: true,
    text,
    preferText,
    faithfulText,
    safeScaleY,
    requestedFontSize,
    fontSize,
    drawable: fontSize * safeScaleY >= (preferText ? 3 : faithfulText ? .15 : 4),
    needsBaselineLayout: faithfulText && node.type === 'text' && fontSize > requestedFontSize
  }
}

function baselineCanvasTextLayout(ctx, node, text, width, height, fontSize) {
  const advance = Math.max(.1, fontSize * TEXT_LAYOUT_LINE_HEIGHT)
  if (node.textLayout === 'vertical') {
    const columns = verticalTextColumns(text, Math.max(1, Math.floor(height / advance)))
    return {
      columns,
      contentWidth: columns.length * advance,
      contentHeight: columns.reduce((maximum, column) => Math.max(maximum, column.length * advance), 0)
    }
  }
  const layout = horizontalTextLayout(text, width, value => ctx.measureText(value))
  return {
    lines: layout.lines,
    contentWidth: layout.widths.reduce((maximum, lineWidth) => Math.max(maximum, lineWidth), 0),
    contentHeight: layout.lines.length * advance
  }
}

function drawVerticalText(ctx, text, width, height, fontSize, textAlign, baselineColumns) {
  const glyphAdvance = Math.max(.1, fontSize * TEXT_LAYOUT_LINE_HEIGHT)
  const columnAdvance = glyphAdvance
  const maxRows = Math.max(1, Math.floor(height / glyphAdvance))
  const columns = baselineColumns || verticalTextColumns(text, maxRows)
  const contentWidth = columns.length * columnAdvance
  const firstX = textBlockStart(width, contentWidth, 'center') + contentWidth - columnAdvance / 2

  ctx.save()
  try {
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const firstColumn = Math.max(0, Math.ceil((firstX - width - columnAdvance) / columnAdvance))
    const lastColumn = Math.min(columns.length, Math.floor((firstX + columnAdvance) / columnAdvance) + 1)
    for (let columnIndex = firstColumn; columnIndex < lastColumn; columnIndex += 1) {
      const x = firstX - columnIndex * columnAdvance
      const column = columns[columnIndex]
      const startY = textBlockStart(height, column.length * glyphAdvance, textAlign) + glyphAdvance / 2
      const firstRow = Math.max(0, Math.floor(-startY / glyphAdvance) - 1)
      const lastRow = Math.min(column.length, Math.ceil((height - startY) / glyphAdvance) + 2)
      for (let rowIndex = firstRow; rowIndex < lastRow; rowIndex += 1) {
        const grapheme = column[rowIndex]
        if (grapheme !== ' ') ctx.fillText(grapheme, x, startY + rowIndex * glyphAdvance)
      }
    }
  } finally {
    ctx.restore()
  }
}

function drawHorizontalText(ctx, text, width, height, fontSize, textAlign, baselineLines) {
  const lineAdvance = Math.max(.1, fontSize * TEXT_LAYOUT_LINE_HEIGHT)
  const lines = baselineLines || horizontalTextLines(text, width, value => ctx.measureText(value))
  const startY = textBlockStart(height, lines.length * lineAdvance, 'center') + lineAdvance / 2
  const x = textAlign === 'left' ? 0 : textAlign === 'right' ? width : width / 2

  ctx.save()
  try {
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()
    ctx.textAlign = textAlign === 'left' ? 'left' : textAlign === 'right' ? 'right' : 'center'
    ctx.textBaseline = 'middle'
    const firstLine = Math.max(0, Math.floor(-startY / lineAdvance) - 1)
    const lastLine = Math.min(lines.length, Math.ceil((height - startY) / lineAdvance) + 2)
    for (let index = firstLine; index < lastLine; index += 1) {
      ctx.fillText(lines[index], x, startY + index * lineAdvance)
    }
  } finally {
    ctx.restore()
  }
}

function drawText(ctx, node, width, height, scaleX, scaleY, override, placement = {}, preparedTextLayout = null) {
  const plan = preparedTextLayout?.plan || canvasTextDrawPlan(node, width, height, scaleX, scaleY, override)
  if (!plan.visible || !plan.drawable) return
  const { text, preferText, faithfulText, safeScaleY, requestedFontSize } = plan
  if (preparedTextLayout ? !text.length : !text.trim()) return
  let fontSize = plan.fontSize
  ctx.save()
  try {
    let baselineLayout = null
    let drawLayout = null
    if (plan.needsBaselineLayout) {
      if (preparedTextLayout?.baseline) {
        baselineLayout = preparedTextLayout.layout
      } else {
        ctx.font = canvasTextFont(node, requestedFontSize)
        baselineLayout = baselineCanvasTextLayout(ctx, node, text, width, height, requestedFontSize)
      }
      fontSize = layoutConstrainedCanvasFontSize({
        requestedSize: requestedFontSize,
        readableSize: fontSize,
        layoutWidth: width,
        layoutHeight: height,
        contentWidth: baselineLayout.contentWidth,
        contentHeight: baselineLayout.contentHeight
      })
    } else if (preparedTextLayout) {
      drawLayout = preparedTextLayout.layout
    }
    if (fontSize * safeScaleY < (preferText ? 3 : faithfulText ? .15 : 4)) return
    if (faithfulText) {
      ctx.beginPath()
      ctx.rect(0, 0, width, height)
      ctx.clip()
    }
    ctx.fillStyle = node.color || '#26323d'
    ctx.font = canvasTextFont(node, fontSize)
    const textAlign = placement.align || node.textAlign
    if (node.type === 'text' && node.textLayout === 'vertical') {
      drawVerticalText(ctx, text, width, height, fontSize, textAlign, baselineLayout?.columns || drawLayout?.columns)
      return
    }
    if (node.type === 'text') {
      drawHorizontalText(ctx, text, width, height, fontSize, textAlign, baselineLayout?.lines || drawLayout?.lines)
      return
    }
    ctx.textAlign = textAlign === 'left' ? 'left' : textAlign === 'right' ? 'right' : 'center'
    ctx.textBaseline = 'middle'
    const x = placement.x ?? (textAlign === 'left' ? fontSize * .35 : textAlign === 'right' ? width - fontSize * .35 : width / 2)
    const maxTextWidth = placement.maxWidth ?? (preferText
      ? Math.max(1, width - fontSize * .25, Math.min(width * 1.6, Array.from(text).length * fontSize))
      : Math.max(1, width - fontSize * .7))
    ctx.fillText(text, x, placement.y ?? height / 2, maxTextWidth)
  } finally {
    ctx.restore()
  }
}

function drawRuntimeBadge(ctx, node, width, height, value) {
  if (!node.dataKey || runtimeBadgeExcludedTypes.has(node.type)) return
  const text = runtimeDisplayText(value)
  if (!text) return

  const fontSize = Math.max(1, Math.min(9, height * .22))
  const horizontalPadding = Math.max(1, fontSize * .45)
  const verticalPadding = Math.max(.5, fontSize * .16)
  ctx.save()
  try {
    ctx.font = `400 ${fontSize}px "Microsoft YaHei", sans-serif`
    const maxWidth = Math.max(1, width - 10 - horizontalPadding * 2)
    const textWidth = Math.min(maxWidth, ctx.measureText(text).width)
    const badgeWidth = textWidth + horizontalPadding * 2
    const badgeHeight = fontSize + verticalPadding * 2
    const x = Math.max(0, width - 5 - badgeWidth)
    const y = Math.min(Math.max(0, height - badgeHeight), 4)
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()
    roundedRect(ctx, x, y, badgeWidth, badgeHeight, Math.min(2, badgeHeight / 4))
    ctx.fillStyle = '#26323dcc'
    ctx.fill()
    ctx.beginPath()
    ctx.rect(x, y, badgeWidth, badgeHeight)
    ctx.clip()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + horizontalPadding, y + badgeHeight / 2, maxWidth)
  } finally {
    ctx.restore()
  }
}

function optionLabel(node) {
  const source = Array.isArray(node.selectOptions) ? node.selectOptions : String(node.options || '').split(',')
  const items = source.map((item, index) => typeof item === 'object'
    ? { label: String(item.label ?? item.value ?? `选项${index + 1}`), value: String(item.value ?? item.label ?? index) }
    : { label: String(item).trim(), value: String(item).trim() })
  return items.find(item => item.value === String(node.value ?? node.defaultValue ?? ''))?.label || items[0]?.label || node.text
}

function formDisplayText(node) {
  if (node.type === 'input') return node.value || node.defaultValue || node.placeholder || node.text
  if (node.type === 'select') return optionLabel(node)
  if (node.type === 'time') return previewTime(node)
  if (node.type === 'formProgress') {
    const percent = Math.max(0, Math.min(100, number(node.progressValue, 68) / Math.max(1, number(node.progressMax, 100)) * 100))
    return node.showProgressText === false ? '' : `${Math.round(percent)}%`
  }
  return node.text
}

function drawTableText(ctx, node, width, height, scaleX, scaleY) {
  const title = node.showTableTitle === false ? '' : (node.tableTitle || node.text)
  if (title) drawText(ctx, node, width, height, scaleX, scaleY, title, { y: height * .1, maxWidth: width * .92 })
  if (!props.faithful) return
  const headers = Array.isArray(node.tableHeaders) ? node.tableHeaders : []
  if (headers.length) drawText(ctx, node, width, height, scaleX, scaleY, headers.join('  '), { y: height * .31, maxWidth: width * .94 })
  const rows = Array.isArray(node.tableCells) ? node.tableCells.slice(0, 3) : []
  rows.forEach((row, index) => drawText(ctx, node, width, height, scaleX, scaleY, row.join('  '), {
    y: height * (.5 + index * .18),
    maxWidth: width * .94
  }))
}

function drawPencil(ctx, node, width, height, worldPixel) {
  const points = Array.isArray(node.pencilPoints) ? node.pencilPoints : []
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(number(points[0].x) * width, number(points[0].y) * height)
  if (node.pencilSmooth !== false && points.length > 2) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index]
      const next = points[index + 1]
      ctx.quadraticCurveTo(number(point.x) * width, number(point.y) * height, (number(point.x) + number(next.x)) * width / 2, (number(point.y) + number(next.y)) * height / 2)
    }
    const last = points.at(-1)
    ctx.lineTo(number(last.x) * width, number(last.y) * height)
  } else {
    points.slice(1).forEach(point => ctx.lineTo(number(point.x) * width, number(point.y) * height))
  }
  if (node.pencilClosed) {
    ctx.closePath()
    ctx.save()
    try {
      ctx.globalAlpha *= .16
      ctx.fillStyle = node.pencilColor || '#485563'
      ctx.fill()
    } finally {
      ctx.restore()
    }
  }
  const lineWidth = props.faithful
    ? readableStroke(node.pencilWidth, worldPixel)
    : Math.max(number(node.pencilWidth, 2), Math.min(worldPixel, Math.max(1, Math.min(width, height) / 4)))
  ctx.strokeStyle = node.pencilColor || '#485563'
  ctx.lineWidth = lineWidth
  ctx.lineCap = node.pencilLineCap || 'round'
  ctx.lineJoin = node.pencilLineJoin || 'round'
  if (node.pencilDash) ctx.setLineDash([lineWidth * 4, lineWidth * 3])
  ctx.stroke()
  ctx.setLineDash([])
}

function drawPolylineArrow(ctx, point, neighbor, size, color) {
  const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x)
  ctx.save()
  try {
    ctx.translate(point.x, point.y)
    ctx.rotate(angle)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-size, -size * .45)
    ctx.lineTo(-size, size * .45)
    ctx.closePath()
    ctx.fill()
  } finally {
    ctx.restore()
  }
}

function drawPolyline(ctx, node, width, height, worldPixel) {
  const sourcePoints = Array.isArray(node.polylinePoints) ? node.polylinePoints : []
  if (sourcePoints.length < 2) return
  const points = sourcePoints.map(point => ({ x: number(point?.x) * width, y: number(point?.y) * height }))
  const sourceLineWidth = polylineLineWidth(node)
  const lineWidth = props.faithful
    ? readableStroke(sourceLineWidth, worldPixel)
    : Math.max(sourceLineWidth, Math.min(worldPixel, Math.max(1, Math.min(width, height) / 4)))
  const styleScale = lineWidth / sourceLineWidth
  const outlineWidth = polylineOutlineWidth(node) * styleScale
  const dashSegments = polylineDashSegments(node).map(segment => segment * styleScale)
  const color = node.polylineColor || '#485563'
  ctx.save()
  try {
    const strokePath = (stroke, widthValue, opacity = 1) => {
      ctx.save()
      try {
        ctx.globalAlpha *= opacity
        ctx.strokeStyle = stroke
        ctx.lineWidth = widthValue
        ctx.lineCap = polylineStrokeLineCap(node)
        ctx.lineJoin = node.polylineLineJoin || 'round'
        ctx.setLineDash(dashSegments)
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        points.slice(1).forEach(point => ctx.lineTo(point.x, point.y))
        ctx.stroke()
      } finally {
        ctx.restore()
      }
    }
    if (outlineWidth > 0) strokePath(node.stroke || '#485563', lineWidth + outlineWidth * 2)
    strokePath(color, lineWidth, polylineLineOpacity(node))
    const arrowSize = props.faithful ? polylineArrowSize(node) : Math.max(polylineArrowSize(node), worldPixel * 4)
    const drawArrowPair = (point, neighbor) => {
      if (outlineWidth > 0) drawPolylineArrow(ctx, point, neighbor, arrowSize + outlineWidth * 2, node.stroke || '#485563')
      ctx.save()
      try {
        ctx.globalAlpha *= polylineLineOpacity(node)
        drawPolylineArrow(ctx, point, neighbor, arrowSize, color)
      } finally {
        ctx.restore()
      }
    }
    if (node.polylineStartMarker === 'arrow') drawArrowPair(points[0], points[1])
    if (node.polylineEndMarker === 'arrow') drawArrowPair(points.at(-1), points.at(-2))
  } finally {
    ctx.restore()
  }
}

function drawGrid(ctx, width, height, columns, rows, lineWidth, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (let column = 1; column < columns; column += 1) {
    const x = width * column / columns
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let row = 1; row < rows; row += 1) {
    const y = height * row / rows
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
}

function drawChart(ctx, node, width, height) {
  const values = runtimeChartPercentages(node).map(value => value / 100)
  const gap = width * .07
  const barWidth = (width - gap * (values.length + 1)) / values.length
  ctx.fillStyle = VISUAL_ACCENT_COLOR
  values.forEach((value, index) => ctx.fillRect(gap + index * (barWidth + gap), height * (1 - value), barWidth, height * value))
}

function drawGauge(ctx, node, width, height, lineWidth, value, renderPass = 'full') {
  const startAngle = Math.PI * .75
  const radius = Math.min(width, height) * .34
  if (renderPass !== 'runtime') {
    ctx.strokeStyle = '#d8e0e4'
    ctx.lineWidth = lineWidth * 2
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, radius, startAngle, Math.PI * 2.25)
    ctx.stroke()
  }
  if (renderPass === 'static') return

  const effectiveValue = hasEnabledRuntimeBinding(node, 'progressValue')
    ? node.progressValue
    : value ?? node.progressValue ?? 68
  const displayValue = runtimeDisplayText(effectiveValue, 68)
  const percent = Math.max(0, Math.min(100, number(effectiveValue, 68))) / 100
  const endAngle = startAngle + Math.PI * 1.5 * percent
  ctx.strokeStyle = VISUAL_ACCENT_COLOR
  ctx.lineWidth = lineWidth * 2
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, radius, startAngle, endAngle)
  ctx.stroke()
  ctx.strokeStyle = node.stroke || '#485563'
  ctx.lineWidth = Math.max(.5, lineWidth)
  ctx.beginPath()
  ctx.moveTo(width / 2, height / 2)
  ctx.lineTo(width / 2 + Math.cos(endAngle) * radius * .72, height / 2 + Math.sin(endAngle) * radius * .72)
  ctx.stroke()
  ctx.fillStyle = node.color || node.stroke || '#26323d'
  ctx.font = `600 ${Math.max(1, Math.min(number(node.fontSize, 14), height * .17))}px "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${displayValue}%`, width / 2, height * .72, Math.max(1, width * .8))
}

function drawFlowPipe(ctx, node, width, height, worldPixel, animationTimestamp) {
  fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
  const trackWidth = Math.max(.1, width * .75)
  const trackHeight = Math.max(.1, Math.min(16, height * .64))
  const trackX = (width - trackWidth) / 2
  const trackY = (height - trackHeight) / 2
  const trackBorderWidth = canvasVisualDetailSize(2, worldPixel, trackHeight * .28, .8)
  const innerX = trackX + trackBorderWidth
  const innerY = trackY + trackBorderWidth
  const innerRight = trackX + trackWidth - trackBorderWidth
  const innerBottom = trackY + trackHeight - trackBorderWidth
  ctx.save()
  try {
    ctx.fillStyle = '#e4f7fa'
    ctx.fillRect(trackX, trackY, trackWidth, trackHeight)
    ctx.strokeStyle = '#3c8fa0'
    ctx.lineWidth = trackBorderWidth
    ctx.strokeRect(
      trackX + trackBorderWidth / 2,
      trackY + trackBorderWidth / 2,
      Math.max(.1, trackWidth - trackBorderWidth),
      Math.max(.1, trackHeight - trackBorderWidth)
    )
    if (innerRight <= innerX || innerBottom <= innerY) return

    ctx.beginPath()
    ctx.rect(innerX, innerY, innerRight - innerX, innerBottom - innerY)
    ctx.clip()
    const stripeSpacing = Math.max(20, worldPixel * 5, trackWidth / 96)
    const stripeWidth = canvasVisualDetailSize(3, worldPixel, trackHeight * .35, .9)
    const stripeSlant = Math.min(trackHeight * .72, stripeSpacing * .65)
    const stripeOffset = flowPipeDashOffset(node, stripeSpacing / 7, animationTimestamp)
    ctx.strokeStyle = node.visualPrimaryColor || VISUAL_ACCENT_COLOR
    ctx.lineWidth = stripeWidth
    ctx.lineCap = 'butt'
    ctx.beginPath()
    for (
      let stripeX = innerX - stripeSpacing + stripeOffset;
      stripeX < innerRight + stripeSpacing;
      stripeX += stripeSpacing
    ) {
      ctx.moveTo(stripeX + stripeSlant / 2, innerY)
      ctx.lineTo(stripeX - stripeSlant / 2, innerBottom)
    }
    ctx.stroke()
  } finally {
    ctx.restore()
  }
}

function drawFan(ctx, node, width, height, worldPixel, animationTimestamp) {
  fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
  const radius = Math.min(32, width / 2, height / 2)
  const visualScale = radius / 32
  const visualBorderWidth = canvasVisualDetailSize(2 * visualScale, worldPixel, radius * .18, .75)
  const insetWidth = canvasVisualDetailSize(5 * visualScale, worldPixel, radius * .3, .8)
  // Mirror the 64px DOM fan: the 8px round-capped blade reaches 24px from the hub.
  const bladeLength = 20 * visualScale
  ctx.fillStyle = '#f2f7f7'
  ctx.strokeStyle = '#8ea5aa'
  ctx.lineWidth = visualBorderWidth
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.max(.1, radius - visualBorderWidth / 2), 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#dfeaea'
  ctx.lineWidth = insetWidth
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.max(.1, radius - visualBorderWidth - insetWidth / 2), 0, Math.PI * 2)
  ctx.stroke()
  const rotorAngle = rotatingFanAngle(node, animationTimestamp)
  const bladeWidth = canvasVisualDetailSize(8 * visualScale, worldPixel, radius * .3, 1)
  ctx.save()
  try {
    ctx.strokeStyle = node.visualPrimaryColor || VISUAL_ACCENT_COLOR
    ctx.lineWidth = bladeWidth
    ctx.lineCap = 'round'
    for (let index = 0; index < 4; index += 1) {
      ctx.save()
      try {
        ctx.translate(width / 2, height / 2)
        ctx.rotate(rotorAngle + index * Math.PI / 2)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(
          bladeLength * .3,
          -bladeLength * .3,
          bladeLength * .4,
          -bladeLength * .8,
          0,
          -bladeLength
        )
        ctx.stroke()
      } finally {
        ctx.restore()
      }
    }
  } finally {
    ctx.restore()
  }
  const outerHubRadius = canvasVisualDetailSize(8 * visualScale, worldPixel, radius * .4, 1.25)
  const innerHubRadius = canvasVisualDetailSize(4 * visualScale, worldPixel, radius * .24, .7)
  ctx.fillStyle = '#e7f7f4'
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, outerHubRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#176e69'
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, innerHubRadius, 0, Math.PI * 2)
  ctx.fill()
}

function drawImageFit(ctx, image, width, height, fit) {
  const sourceWidth = image.naturalWidth || image.videoWidth || image.width
  const sourceHeight = image.naturalHeight || image.videoHeight || image.height
  if (!sourceWidth || !sourceHeight) return
  if (fit === 'fill') return ctx.drawImage(image, 0, 0, width, height)
  const scale = fit === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight)
  const targetWidth = sourceWidth * scale
  const targetHeight = sourceHeight * scale
  ctx.save()
  try {
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()
    ctx.drawImage(image, (width - targetWidth) / 2, (height - targetHeight) / 2, targetWidth, targetHeight)
  } finally {
    ctx.restore()
  }
}

function cachedImageSettled(image) {
  return sharedPreviewImageCache.settled(image)
}

function cachedImageReady(image) {
  return sharedPreviewImageCache.ready(image)
}

function handleSharedImageSettled(event) {
  if (imageCache.get(event.url) !== event.image) return
  requestImageRender(event.url)
}

function cachedImage(url) {
  if (!url) return null
  if (imageCache.has(url)) {
    const cached = imageCache.get(url)
    if (props.waitForImages && !cachedImageSettled(cached)) deferredImageUrls.add(url)
    return cached
  }
  const image = sharedPreviewImageCache.acquire(url, handleSharedImageSettled)
  imageCache.set(url, image)
  if (props.waitForImages && !cachedImageSettled(image)) deferredImageUrls.add(url)
  return image
}

function requestImageRender(url = '') {
  // 完整预览等待多张图片时，只在当前待加载集合结算后触发重绘。
  if (props.waitForImages && deferredImageUrls.size) {
    if (url) deferredImageUrls.delete(url)
    if (deferredImageUrls.size) return false
  }
  if (!props.active) {
    suspendedRenderDirty = true
    return false
  }
  // 当前私有帧会在提交时复查图片状态，无需再排一个会被合并掉的整图任务。
  if (renderScheduler.state.pending) return false
  return imageRenderTrigger.request()
}

function pruneImageCache(activeUrls) {
  for (const [url] of imageCache) {
    if (activeUrls?.has(url)) continue
    sharedPreviewImageCache.release(url, handleSharedImageSettled)
    imageCache.delete(url)
    deferredImageUrls.delete(url)
  }
}

function clearImageCache() {
  sharedPreviewImageCache.releaseSubscriber(handleSharedImageSettled)
  imageCache.clear()
  deferredImageUrls.clear()
}

function drawMediaPlaceholder(ctx, node, width, height, lineWidth, imageMode = false) {
  ctx.fillStyle = node.fill || '#e8edf0'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = node.stroke || '#64727d'
  ctx.lineWidth = lineWidth
  ctx.strokeRect(lineWidth / 2, lineWidth / 2, Math.max(0, width - lineWidth), Math.max(0, height - lineWidth))
  ctx.beginPath()
  if (imageMode) {
    ctx.moveTo(width * .12, height * .8)
    ctx.lineTo(width * .4, height * .46)
    ctx.lineTo(width * .58, height * .65)
    ctx.lineTo(width * .75, height * .35)
    ctx.lineTo(width * .9, height * .8)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(width * .72, height * .25, Math.min(width, height) * .08, 0, Math.PI * 2)
    ctx.fillStyle = node.color || '#64727d'
    ctx.fill()
  } else {
    ctx.moveTo(width * .4, height * .25)
    ctx.lineTo(width * .72, height * .5)
    ctx.lineTo(width * .4, height * .75)
    ctx.closePath()
    ctx.fillStyle = node.color || '#64727d'
    ctx.fill()
  }
}

function drawFormControl(ctx, node, width, height, lineWidth) {
  const accent = node.fill || '#16b89a'
  const dark = node.stroke || '#485563'
  if (node.type === 'table') {
    ctx.fillStyle = node.tableRowFill || '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = node.tableTitleFill || '#eef1f4'
    ctx.fillRect(0, 0, width, height * .2)
    ctx.fillStyle = node.tableHeaderFill || '#f4f6f8'
    ctx.fillRect(0, height * .2, width, height * .22)
    drawGrid(ctx, width, height, Math.min(6, number(node.tableColumns, 3)), Math.min(6, number(node.tableRows, 3) + 2), lineWidth, node.tableGridColor || '#8c969d')
    return
  }
  if (node.type === 'checkbox' || node.type === 'radio') {
    ctx.strokeStyle = dark
    ctx.lineWidth = lineWidth
    const size = Math.min(height * .55, width * .24)
    ctx.beginPath()
    if (node.type === 'radio') ctx.arc(size, height / 2, size * .48, 0, Math.PI * 2)
    else ctx.rect(size * .5, (height - size) / 2, size, size)
    ctx.stroke()
    if (node.checked) {
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(size, height / 2, size * .24, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }
  if (node.type === 'switch') {
    const trackWidth = Math.min(width * .55, height * 1.65)
    const trackHeight = Math.min(height * .55, trackWidth * .5)
    roundedRect(ctx, (width - trackWidth) / 2, (height - trackHeight) / 2, trackWidth, trackHeight, trackHeight / 2)
    ctx.fillStyle = node.checked ? accent : '#bcc5ca'
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    const radius = trackHeight * .38
    const centerX = (width - trackWidth) / 2 + (node.checked ? trackWidth - trackHeight / 2 : trackHeight / 2)
    ctx.arc(centerX, height / 2, radius, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  if (node.type === 'formProgress') {
    const value = Math.max(0, Math.min(1, number(node.progressValue, 68) / Math.max(1, number(node.progressMax, 100))))
    const trackHeight = Math.min(height * .28, lineWidth * 4)
    ctx.fillStyle = '#dce3e6'
    ctx.fillRect(width * .08, (height - trackHeight) / 2, width * .84, trackHeight)
    ctx.fillStyle = accent
    ctx.fillRect(width * .08, (height - trackHeight) / 2, width * .84 * value, trackHeight)
    return
  }
  ctx.fillStyle = node.type === 'button' ? accent : '#fff'
  ctx.strokeStyle = dark
  ctx.lineWidth = lineWidth
  roundedRect(ctx, 0, 0, width, height, Math.min(number(node.radius, 4), height / 3))
  ctx.fill()
  ctx.stroke()
  if (node.type === 'select') {
    ctx.beginPath()
    ctx.moveTo(width * .82, height * .38)
    ctx.lineTo(width * .9, height * .5)
    ctx.lineTo(width * .82, height * .62)
    ctx.stroke()
  }
  if (node.type === 'time' && node.timeShowLeftIcon !== false) {
    ctx.beginPath()
    ctx.arc(width * .16, height / 2, Math.min(width, height) * .12, 0, Math.PI * 2)
    ctx.moveTo(width * .16, height / 2)
    ctx.lineTo(width * .16, height * .39)
    ctx.moveTo(width * .16, height / 2)
    ctx.lineTo(width * .22, height * .55)
    ctx.stroke()
  }
}

function drawSpecialNode(ctx, node, width, height, lineWidth, value, renderPass = 'full', worldPixel = lineWidth, animationTimestamp = 0) {
  const accent = ['customMotion', 'customIndicator'].includes(node.type)
    ? node.motionColor || VISUAL_ACCENT_COLOR
    : VISUAL_ACCENT_COLOR
  const dark = node.stroke || '#485563'
  if (node.type === 'chart') return drawChart(ctx, node, width, height)
  if (node.type === 'gauge') return drawGauge(ctx, node, width, height, lineWidth, value, renderPass)
  if (node.type === 'flowPipe') return drawFlowPipe(ctx, node, width, height, worldPixel, animationTimestamp)
  if (node.type === 'rotatingFan') return drawFan(ctx, node, width, height, worldPixel, animationTimestamp)
  if (node.type === 'signalLight') {
    fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
    ctx.save()
    try {
      ctx.globalAlpha *= alpha(node.signalOpacity)
      ctx.fillStyle = signalLightColor(node, animationTimestamp)
      const signalRadius = canvasVisualDetailSize(
        20,
        worldPixel,
        Math.min(width / 2, height / 2),
        4.25
      )
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, signalRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(38, 50, 61, .15)'
      ctx.lineWidth = canvasVisualDetailSize(lineWidth, worldPixel, signalRadius * .18, .6)
      ctx.stroke()
    } finally {
      ctx.restore()
    }
    return
  }
  if (node.type === 'waterTank') {
    fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
    const tankScale = Math.min(1, width / 68, height / 95)
    const tankWidth = Math.max(.1, 68 * tankScale)
    const tankHeight = Math.max(.1, 95 * tankScale)
    const tankX = (width - tankWidth) / 2
    const tankY = (height - tankHeight) / 2
    const tankBorderWidth = canvasVisualDetailSize(3 * tankScale, worldPixel, Math.min(tankWidth, tankHeight) * .12, .75)
    const tankRadius = 10 * tankScale
    ctx.beginPath()
    roundedRect(ctx, tankX, tankY, tankWidth, tankHeight, tankRadius)
    ctx.fillStyle = '#f6fbfc'
    ctx.fill()
    ctx.strokeStyle = '#3c6f7a'
    ctx.lineWidth = tankBorderWidth
    ctx.stroke()
    const percent = Math.max(0, Math.min(100, number(node.progressValue))) / 100
    const innerX = tankX + tankBorderWidth
    const innerY = tankY + tankBorderWidth
    const innerWidth = Math.max(.1, tankWidth - tankBorderWidth * 2)
    const innerHeight = Math.max(.1, tankHeight - tankBorderWidth * 2)
    const liquidHeight = innerHeight * percent
    ctx.save()
    try {
      ctx.beginPath()
      roundedRect(ctx, innerX, innerY, innerWidth, innerHeight, Math.max(0, tankRadius - tankBorderWidth))
      ctx.clip()
      const liquidY = innerY + innerHeight - liquidHeight
      ctx.fillStyle = node.visualPrimaryColor || '#3bb9df'
      ctx.fillRect(innerX, liquidY, innerWidth, liquidHeight)
      if (liquidHeight > 0) {
        const wave = waterTankAnimationState(node, animationTimestamp)
        ctx.fillStyle = waterTankWaveColor(node)
        ctx.beginPath()
        ctx.ellipse(
          innerX + innerWidth / 2 + wave.waveOffset * innerWidth * .112,
          liquidY,
          innerWidth * .7 * wave.waveScale,
          6 * tankScale,
          0,
          0,
          Math.PI * 2
        )
        ctx.fill()
      }
    } finally {
      ctx.restore()
    }
    ctx.fillStyle = '#174b58'
    ctx.font = `600 ${Math.max(1, 13 * tankScale)}px "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(percent * 10000) / 100}%`, width / 2, height / 2, tankWidth * .8)
    return
  }
  if (node.type === 'heartbeat') {
    fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
    const iconSize = Math.max(.1, Math.min(48, width * .8, height * .8))
      * heartbeatAnimationScale(node, animationTimestamp)
    const scale = iconSize / 24
    const iconX = (width - iconSize) / 2
    const iconY = (height - iconSize) / 2
    ctx.strokeStyle = node.visualPrimaryColor || VISUAL_HEARTBEAT_COLOR
    ctx.lineWidth = canvasVisualDetailSize(2 * scale, worldPixel, iconSize * .12, .8)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(iconX + 12 * scale, iconY + 21 * scale)
    ctx.bezierCurveTo(iconX + 10.8 * scale, iconY + 19.8 * scale, iconX + 2 * scale, iconY + 14.3 * scale, iconX + 2 * scale, iconY + 8.5 * scale)
    ctx.bezierCurveTo(iconX + 2 * scale, iconY + 5.5 * scale, iconX + 4.5 * scale, iconY + 3 * scale, iconX + 7.5 * scale, iconY + 3 * scale)
    ctx.bezierCurveTo(iconX + 9.3 * scale, iconY + 3 * scale, iconX + 10.8 * scale, iconY + 3.8 * scale, iconX + 12 * scale, iconY + 5.1 * scale)
    ctx.bezierCurveTo(iconX + 13.2 * scale, iconY + 3.8 * scale, iconX + 14.7 * scale, iconY + 3 * scale, iconX + 16.5 * scale, iconY + 3 * scale)
    ctx.bezierCurveTo(iconX + 19.5 * scale, iconY + 3 * scale, iconX + 22 * scale, iconY + 5.5 * scale, iconX + 22 * scale, iconY + 8.5 * scale)
    ctx.bezierCurveTo(iconX + 22 * scale, iconY + 14.3 * scale, iconX + 13.2 * scale, iconY + 19.8 * scale, iconX + 12 * scale, iconY + 21 * scale)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(iconX + 3.2 * scale, iconY + 12 * scale)
    ctx.lineTo(iconX + 9.5 * scale, iconY + 12 * scale)
    ctx.lineTo(iconX + 10 * scale, iconY + 11 * scale)
    ctx.lineTo(iconX + 12 * scale, iconY + 15.5 * scale)
    ctx.lineTo(iconX + 14 * scale, iconY + 8.5 * scale)
    ctx.lineTo(iconX + 15.5 * scale, iconY + 12 * scale)
    ctx.lineTo(iconX + 20.8 * scale, iconY + 12 * scale)
    ctx.stroke()
    return
  }
  if (node.type === 'particles') {
    fillAndStroke(ctx, node, width, height, worldPixel, '#fff')
    ctx.fillStyle = node.visualPrimaryColor || accent
    const visualWidth = width * .8
    const visualHeight = Math.min(52, height)
    const visualX = (width - visualWidth) / 2
    const visualY = (height - visualHeight) / 2
    const dotSize = Math.min(7, visualHeight / 7)
    const radius = canvasVisualDetailSize(dotSize / 2, worldPixel, visualHeight * .1, .65)
    const positions = [[.05, 0], [.16, 7], [.28, 14], [.4, 21], [.52, 28], [.64, 35], [.76, 42], [.88, 7]]
    const visualScale = dotSize / 7
    ctx.save()
    try {
      ctx.beginPath()
      ctx.rect(visualX, visualY, visualWidth, visualHeight)
      ctx.clip()
      const baseAlpha = ctx.globalAlpha
      for (const [index, [left, top]] of positions.entries()) {
        const state = particleAnimationState(node, index, animationTimestamp)
        ctx.globalAlpha = baseAlpha * state.opacity
        ctx.beginPath()
        ctx.arc(
          visualX + visualWidth * left + state.translateX * visualScale + radius,
          visualY + top * visualScale + radius,
          radius,
          0,
          Math.PI * 2
        )
        ctx.fill()
      }
      ctx.globalAlpha = baseAlpha
    } finally {
      ctx.restore()
    }
    return
  }
  if (node.type === 'progress') {
    if (renderPass !== 'runtime') {
      ctx.fillStyle = '#dce3e6'
      ctx.fillRect(width * .06, height * .38, width * .88, height * .24)
    }
    if (renderPass === 'static') return
    const effectiveValue = hasEnabledRuntimeBinding(node, 'progressValue')
      ? node.progressValue
      : value ?? node.progressValue ?? 68
    const percent = Math.max(0, Math.min(1, number(effectiveValue, 68) / 100))
    ctx.fillStyle = accent
    ctx.fillRect(width * .06, height * .38, width * .88 * percent, height * .24)
    ctx.fillStyle = dark
    ctx.font = `600 ${Math.max(1, Math.min(number(node.fontSize, 14), height * .2))}px "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(percent * 1000) / 10}%`, width / 2, height * .76, Math.max(1, width * .9))
    return
  }
  if (node.type === 'server') {
    ctx.fillStyle = node.fill || '#edf2f4'
    ctx.strokeStyle = dark
    ctx.lineWidth = lineWidth
    roundedRect(ctx, 0, 0, width, height, lineWidth * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(width * .1, height * .35)
    ctx.lineTo(width * .9, height * .35)
    ctx.moveTo(width * .1, height * .65)
    ctx.lineTo(width * .9, height * .65)
    ctx.stroke()
    ctx.fillStyle = '#21c58e'
    ;[.2, .5, .8].forEach(y => {
      ctx.beginPath()
      ctx.arc(width * .82, height * y, Math.max(lineWidth, Math.min(width, height) * .035), 0, Math.PI * 2)
      ctx.fill()
    })
    return
  }
  if (node.type === 'database') {
    ctx.fillStyle = node.fill || '#edf2f4'
    ctx.strokeStyle = dark
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    ctx.ellipse(width / 2, height * .18, width * .42, height * .15, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillRect(width * .08, height * .18, width * .84, height * .64)
    ctx.strokeRect(width * .08, height * .18, width * .84, height * .64)
    ctx.beginPath()
    ctx.ellipse(width / 2, height * .82, width * .42, height * .15, 0, 0, Math.PI)
    ctx.stroke()
    return
  }
  if (['network', 'router', 'disk', 'cloud', 'customMotion', 'customIndicator'].includes(node.type)) {
    fillAndStroke(ctx, node, width, height, lineWidth, '#eaf3f1')
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = lineWidth
    const centers = [[.25, .35], [.72, .28], [.55, .72]]
    ctx.beginPath()
    ctx.moveTo(width * centers[0][0], height * centers[0][1])
    ctx.lineTo(width * centers[1][0], height * centers[1][1])
    ctx.lineTo(width * centers[2][0], height * centers[2][1])
    ctx.lineTo(width * centers[0][0], height * centers[0][1])
    ctx.stroke()
    centers.forEach(([x, y]) => {
      ctx.beginPath()
      ctx.arc(width * x, height * y, Math.max(lineWidth * 1.3, Math.min(width, height) * .06), 0, Math.PI * 2)
      ctx.fill()
    })
    return
  }
  fillAndStroke(ctx, node, width, height, lineWidth)
}

function canvasNodeLayout(node, scaleX, scaleY, worldPixel) {
  const width = node.type === 'lineShape' ? lineShapeWidth(node) : Math.max(1, number(node.w, 1))
  const height = node.type === 'lineShape' ? lineShapeHeight(node) : Math.max(1, number(node.h, 1))
  const visualScaleX = Math.max(.0001, number(node.visualScaleX, 1))
  const visualScaleY = Math.max(.0001, number(node.visualScaleY, 1))
  const layoutWidth = width / visualScaleX
  const layoutHeight = height / visualScaleY
  const visualWorldPixel = worldPixel / Math.max(.0001, Math.min(visualScaleX, visualScaleY))
  return {
    width,
    height,
    visualScaleX,
    visualScaleY,
    layoutWidth,
    layoutHeight,
    visualWorldPixel,
    effectiveScaleX: scaleX * visualScaleX,
    effectiveScaleY: scaleY * visualScaleY
  }
}

function drawNode(ctx, sourceNode, scaleX, scaleY, worldPixel, renderPass = 'full', opacityMultiplier = 1, options = {}) {
  // 运行时值只生成本次绘制使用的有效节点，不回写图纸中的静态属性。
  const textLayout = options.textLayout || null
  const node = options.node || textLayout?.node || materializeRuntimeNode(sourceNode, runtimePointValue)
  const rawAnimationTimestamp = number(options.animationTimestamp)
  const animationTimestamp = options.animationTimestampResolved === true
    ? rawAnimationTimestamp
    : isCanvasVisualAnimationCandidate(node)
    ? visualAnimationTimeline.resolve(node, rawAnimationTimestamp)
    : rawAnimationTimestamp
  const {
    width,
    height,
    visualScaleX,
    visualScaleY,
    layoutWidth,
    layoutHeight,
    visualWorldPixel,
    effectiveScaleX,
    effectiveScaleY
  } = canvasNodeLayout(node, scaleX, scaleY, worldPixel)
  const x = number(node.x)
  const y = number(node.y)
  const lineWidth = visibleStroke(node, layoutWidth, layoutHeight, visualWorldPixel)
  const value = renderPass === 'static'
    ? undefined
    : options.runtimeValueResolved === true
      ? options.runtimeValue
      : runtimeValue(node)
  ctx.save()
  try {
    ctx.globalAlpha = multiplyOpacity(node.opacity, opacityMultiplier)
    ctx.translate(x + width / 2, y + height / 2)
    ctx.rotate(number(node.rotate) * Math.PI / 180)
    ctx.scale(visualScaleX, visualScaleY)
    ctx.translate(-layoutWidth / 2, -layoutHeight / 2)

    if (renderPass === 'runtime') {
      if (['gauge', 'progress'].includes(node.type)) {
        drawSpecialNode(ctx, node, layoutWidth, layoutHeight, lineWidth, value, 'runtime', visualWorldPixel, animationTimestamp)
      } else if (node.type === 'time') {
        drawText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY, formDisplayText(node))
      } else {
        drawRuntimeBadge(ctx, node, layoutWidth, layoutHeight, value)
      }
      return
    }

    if (node.type === 'pencil') drawPencil(ctx, node, layoutWidth, layoutHeight, visualWorldPixel)
    else if (node.type === 'polyline') drawPolyline(ctx, node, layoutWidth, layoutHeight, visualWorldPixel)
    else if (node.type === 'lineShape') {
      const visualLineNode = { ...node, w: layoutWidth, h: layoutHeight }
      const sourceBorderWidth = lineShapeBorderWidth(visualLineNode)
      const borderWidth = sourceBorderWidth > 0 ? readableStroke(sourceBorderWidth, visualWorldPixel) : 0
      if (node.borderStyle === 'solid') {
        ctx.save()
        try {
          ctx.globalAlpha *= alpha(node.backgroundOpacity)
          ctx.fillStyle = node.fill || '#485563'
          ctx.fillRect(0, 0, layoutWidth, layoutHeight)
        } finally {
          ctx.restore()
        }
        if (borderWidth > 0) {
          ctx.strokeStyle = node.stroke || node.fill || '#485563'
          ctx.lineWidth = borderWidth
          ctx.setLineDash(lineShapeDashSegments(node))
          ctx.strokeRect(borderWidth / 2, borderWidth / 2, Math.max(LINE_SHAPE_MIN_INNER_SIZE, layoutWidth - borderWidth), Math.max(LINE_SHAPE_MIN_INNER_SIZE, layoutHeight - borderWidth))
        }
      } else {
        const inset = lineShapeBodyInset(visualLineNode)
        const drawBodyLine = (color, thickness, opacity = 1) => {
          ctx.save()
          try {
            ctx.globalAlpha *= opacity
            ctx.beginPath()
            ctx.moveTo(inset, layoutHeight / 2)
            ctx.lineTo(layoutWidth - inset, layoutHeight / 2)
            ctx.strokeStyle = color
            ctx.lineWidth = thickness
            ctx.setLineDash(lineShapeBodyDashSegments(visualLineNode))
            ctx.lineCap = node.borderStyle === 'dotted' ? 'round' : 'butt'
            ctx.stroke()
          } finally {
            ctx.restore()
          }
        }
        drawBodyLine(borderWidth > 0 ? (node.stroke || '#485563') : (node.fill || '#485563'), layoutHeight, borderWidth > 0 ? 1 : alpha(node.backgroundOpacity))
        const innerThickness = lineShapeInnerThickness(visualLineNode)
        if (borderWidth > 0 && innerThickness > 0) drawBodyLine(node.fill || '#485563', innerThickness, alpha(node.backgroundOpacity))
      }
    } else if (node.type === 'text') {
      strokeNodeOutline(ctx, node, layoutWidth, layoutHeight, visualWorldPixel)
      drawText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY, undefined, {}, textLayout)
    } else if (Array.isArray(shapePoints[node.type]) || ['circle', 'rect', 'process', 'decision', 'terminal', 'code'].includes(node.type)) {
      fillAndStroke(ctx, node, layoutWidth, layoutHeight, visualWorldPixel)
      drawText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY)
    } else if (['table', 'checkbox', 'radio', 'switch', 'formProgress', 'button', 'input', 'select', 'time'].includes(node.type)) {
      drawFormControl(ctx, node, layoutWidth, layoutHeight, lineWidth)
      if (node.type === 'table') drawTableText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY)
      else if (renderPass !== 'static' || node.type !== 'time') {
        drawText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY, formDisplayText(node))
      }
    } else if (node.type === 'image' || node.type === 'customImageMotion') {
      const image = cachedImage(node.imageUrl)
      if (cachedImageReady(image)) {
        ctx.save()
        try {
          ctx.globalAlpha *= alpha(node.backgroundOpacity)
          ctx.fillStyle = node.fill || '#eef2f4'
          ctx.fillRect(0, 0, layoutWidth, layoutHeight)
        } finally {
          ctx.restore()
        }
        drawImageFit(ctx, image, layoutWidth, layoutHeight, node.imageFit || 'contain')
      } else drawMediaPlaceholder(ctx, node, layoutWidth, layoutHeight, lineWidth, true)
    } else if (node.type === 'video') drawMediaPlaceholder(ctx, node, layoutWidth, layoutHeight, lineWidth, false)
    else {
      drawSpecialNode(ctx, node, layoutWidth, layoutHeight, lineWidth, value, renderPass, visualWorldPixel, animationTimestamp)
      const visualOnly = ['flowPipe', 'rotatingFan', 'signalLight', 'waterTank', 'heartbeat', 'particles', 'progress']
      if (node.type === 'customTextMotion' || (!node.type.startsWith('custom') && !visualOnly.includes(node.type))) {
        drawText(ctx, node, layoutWidth, layoutHeight, effectiveScaleX, effectiveScaleY)
      }
    }
    if (renderPass === 'full') drawRuntimeBadge(ctx, node, layoutWidth, layoutHeight, value)
  } finally {
    ctx.restore()
  }
}

function longTextLayoutDescriptor(sourceNode, scaleX, scaleY, worldPixel, renderPass, materializedNode = null) {
  if (renderPass === 'runtime' || sourceNode?.type !== 'text') return null
  const node = materializedNode || materializeRuntimeNode(sourceNode, runtimePointValue)
  if (String(node?.text ?? '').length <= LONG_TEXT_INCREMENTAL_THRESHOLD) return null
  const layout = canvasNodeLayout(node, scaleX, scaleY, worldPixel)
  const plan = canvasTextDrawPlan(
    node,
    layout.layoutWidth,
    layout.layoutHeight,
    layout.effectiveScaleX,
    layout.effectiveScaleY
  )
  if (
    !plan.visible
    || !plan.drawable
    || plan.text.length <= LONG_TEXT_INCREMENTAL_THRESHOLD
  ) return null

  return { sourceNode, node, plan, layout }
}

function createLongTextLayoutWork(sourceNode, scaleX, scaleY, worldPixel, renderPass, materializedNode = null) {
  const descriptor = longTextLayoutDescriptor(
    sourceNode,
    scaleX,
    scaleY,
    worldPixel,
    renderPass,
    materializedNode
  )
  if (!descriptor) return null
  const { node, plan, layout } = descriptor

  const layoutFontSize = plan.needsBaselineLayout ? plan.requestedFontSize : plan.fontSize
  const orientation = node.textLayout === 'vertical' ? 'vertical' : 'horizontal'
  const state = createIncrementalTextLayout(plan.text, orientation === 'vertical'
    ? {
        orientation,
        maxRows: Math.max(1, Math.floor(layout.layoutHeight / Math.max(.1, layoutFontSize * TEXT_LAYOUT_LINE_HEIGHT)))
      }
    : {
        orientation,
        maxWidth: layout.layoutWidth
      })
  return {
    ...descriptor,
    node,
    plan,
    state,
    orientation,
    layoutFontSize,
    font: canvasTextFont(node, layoutFontSize)
  }
}

function finishLongTextLayoutWork(work) {
  const layout = finishIncrementalTextLayout(work.state)
  const advance = Math.max(.1, work.layoutFontSize * TEXT_LAYOUT_LINE_HEIGHT)
  if (work.orientation === 'vertical') {
    return {
      node: work.node,
      plan: work.plan,
      baseline: work.plan.needsBaselineLayout,
      layout: {
        columns: layout.columns,
        contentWidth: layout.columns.length * advance,
        contentHeight: layout.maximumColumnLength * advance
      }
    }
  }
  return {
    node: work.node,
    plan: work.plan,
    baseline: work.plan.needsBaselineLayout,
    layout: {
      lines: layout.lines,
      contentWidth: layout.maximumLineWidth,
      contentHeight: layout.lines.length * advance
    }
  }
}

function canvasVisualDescriptorSourceKey(node) {
  const bindings = Array.isArray(node?.dataBindings)
    ? node.dataBindings.map(binding => [
        binding?.target,
        binding?.pointId,
        binding?.sourceId,
        binding?.jsonPath,
        binding?.enabled
      ])
    : []
  return JSON.stringify([
    node?.type,
    node?.x,
    node?.y,
    node?.w,
    node?.h,
    node?.rotate,
    node?.visualScaleX,
    node?.visualScaleY,
    node?.opacity,
    node?.fill,
    node?.stroke,
    node?.color,
    node?.visualPrimaryColor,
    node?.radius,
    node?.borderVisible,
    node?.borderWidth,
    node?.borderStyle,
    node?.borderDashLength,
    node?.borderDashGap,
    node?.backgroundOpacity,
    node?.animation,
    node?.animationDuration,
    node?.animationDirection,
    node?.animationPaused,
    node?.signalOpacity,
    node?.signalColorCount,
    node?.signalColor,
    ...(Array.isArray(node?.signalColors) ? node.signalColors : []),
    node?.progressValue,
    node?.dataKey,
    bindings
  ])
}

function canvasVisualSpriteAnimationState(node, layout, timestamp) {
  if (node.type === 'flowPipe') {
    const trackWidth = Math.max(.1, layout.layoutWidth * .75)
    const trackHeight = Math.max(.1, Math.min(16, layout.layoutHeight * .64))
    const stripeSpacing = Math.max(20, layout.visualWorldPixel * 5, trackWidth / 96)
    return [flowPipeDashOffset(node, stripeSpacing / 7, timestamp), trackHeight]
  }
  if (node.type === 'rotatingFan') return [rotatingFanAngle(node, timestamp)]
  if (node.type === 'signalLight') {
    return [alpha(node.signalOpacity), signalLightColor(node, timestamp)]
  }
  if (node.type === 'waterTank') {
    const state = waterTankAnimationState(node, timestamp)
    return [Math.max(0, Math.min(100, number(node.progressValue))), state.waveOffset, state.waveScale]
  }
  if (node.type === 'heartbeat') return [heartbeatAnimationScale(node, timestamp)]
  if (node.type === 'particles') {
    const state = []
    for (let index = 0; index < 8; index += 1) {
      const particle = particleAnimationState(node, index, timestamp)
      state.push(particle.translateX, particle.opacity)
    }
    return state
  }
  return []
}

function canvasVisualSpriteStaticSignature(task, node, bitmapRect, layout, opacityMultiplier, badgeText) {
  const frame = task.frame
  const rawCenterBitmapX = (
    frame.offsetX + (number(node.x) + layout.width / 2) * frame.scaleX
  ) * frame.pixelRatioX - bitmapRect.x
  const rawCenterBitmapY = (
    frame.offsetY + (number(node.y) + layout.height / 2) * frame.scaleY
  ) * frame.pixelRatioY - bitmapRect.y
  // Dense previews may share imperceptibly different subpixel origins, but a
  // clipped edge sprite must keep its asymmetric local center.
  const dense = number(task.visualAnimationVisibleCount) >= RUNTIME_VISUAL_SPRITE_DENSE_THRESHOLD
    && Math.abs(rawCenterBitmapX - bitmapRect.w / 2) <= 1
    && Math.abs(rawCenterBitmapY - bitmapRect.h / 2) <= 1
  const centerBitmapX = dense
    ? bitmapRect.w / 2
    : Math.round(rawCenterBitmapX * RUNTIME_VISUAL_SPRITE_SUBPIXEL_STEPS)
      / RUNTIME_VISUAL_SPRITE_SUBPIXEL_STEPS
  const centerBitmapY = dense
    ? bitmapRect.h / 2
    : Math.round(rawCenterBitmapY * RUNTIME_VISUAL_SPRITE_SUBPIXEL_STEPS)
      / RUNTIME_VISUAL_SPRITE_SUBPIXEL_STEPS
  return JSON.stringify([
    bitmapRect.w,
    bitmapRect.h,
    centerBitmapX,
    centerBitmapY,
    node.type,
    layout.width,
    layout.height,
    layout.visualScaleX,
    layout.visualScaleY,
    node.opacity,
    opacityMultiplier,
    node.fill,
    node.stroke,
    node.color,
    node.visualPrimaryColor,
    node.radius,
    node.borderVisible,
    node.borderWidth,
    node.borderStyle,
    node.borderDashLength,
    node.borderDashGap,
    node.backgroundOpacity,
    badgeText
  ])
}

function internCanvasVisualSpriteStaticSignature(signature) {
  let id = canvasVisualSpriteStaticSignatureIds.get(signature)
  if (id == null) {
    id = nextCanvasVisualSpriteStaticSignatureId
    nextCanvasVisualSpriteStaticSignatureId += 1
    canvasVisualSpriteStaticSignatureIds.set(signature, id)
  }
  return id
}

function canvasVisualAnimationProfile(node, layout) {
  const profile = [
    node.type,
    node.animation,
    node.animationDuration,
    node.animationDirection
  ]
  if (node.type === 'flowPipe') {
    profile.push(layout.layoutWidth, layout.layoutHeight, layout.visualWorldPixel)
  } else if (node.type === 'signalLight') {
    profile.push(
      node.signalOpacity,
      node.signalColorCount,
      node.signalColor,
      ...(Array.isArray(node.signalColors) ? node.signalColors : [])
    )
  } else if (node.type === 'waterTank') {
    profile.push(node.progressValue)
  }
  return JSON.stringify(profile)
}

function internCanvasVisualAnimationProfile(node, layout) {
  const profile = canvasVisualAnimationProfile(node, layout)
  let id = canvasVisualAnimationProfileIds.get(profile)
  if (id == null) {
    id = nextCanvasVisualAnimationProfileId
    nextCanvasVisualAnimationProfileId += 1
    canvasVisualAnimationProfileIds.set(profile, id)
  }
  return id
}

function canvasVisualAnimationStreamKey(
  sourceNode,
  node,
  profileId,
  rawTimestamp,
  resolvedTimestamp,
  animated
) {
  if (!animated || !sourceNode || typeof sourceNode !== 'object') return 'static'
  const paused = node.animationPaused === true
  let state = canvasVisualAnimationStreamStates.get(sourceNode)
  if (!state || state.profileId !== profileId || state.paused !== paused) {
    state = {
      profileId,
      paused,
      key: paused
        ? `paused:${resolvedTimestamp}`
        : `running:${resolvedTimestamp - rawTimestamp}`
    }
    canvasVisualAnimationStreamStates.set(sourceNode, state)
  }
  return state.key
}

function canvasVisualSpriteSignature(
  task,
  node,
  bitmapRect,
  layout,
  timestamp,
  opacityMultiplier,
  badgeText,
  staticSignature = '',
  animationProfileId = 0
) {
  const prefix = staticSignature || internCanvasVisualSpriteStaticSignature(
    canvasVisualSpriteStaticSignature(
      task,
      node,
      bitmapRect,
      layout,
      opacityMultiplier,
      badgeText
    )
  )
  const profileId = animationProfileId || internCanvasVisualAnimationProfile(node, layout)
  const animationKey = `${profileId}\u0000${timestamp}`
  let animationState = task.visualAnimationSignatureCache?.get(animationKey)
  if (animationState == null) {
    task.visualAnimationSignatureCacheMisses += 1
    animationState = JSON.stringify(canvasVisualSpriteAnimationState(node, layout, timestamp))
    task.visualAnimationSignatureCache?.set(animationKey, animationState)
  } else {
    task.visualAnimationSignatureCacheHits += 1
  }
  return `${prefix}\u0000${animationState}`
}

function drawCanvasVisualSpriteDirect(
  task,
  sourceNode,
  node,
  scaleX,
  scaleY,
  worldPixel,
  opacityMultiplier,
  animationTimestamp,
  runtimeValueSnapshot
) {
  drawNode(
    task.ctx,
    sourceNode,
    scaleX,
    scaleY,
    worldPixel,
    'full',
    opacityMultiplier,
    {
      node,
      animationTimestamp,
      animationTimestampResolved: true,
      runtimeValue: runtimeValueSnapshot,
      runtimeValueResolved: true
    }
  )
}

function createCanvasVisualSprite(
  task,
  sourceNode,
  node,
  bitmapRect,
  scaleX,
  scaleY,
  worldPixel,
  opacityMultiplier,
  animationTimestamp,
  runtimeValueSnapshot
) {
  const surface = acquireCanvasVisualSpriteSurface(bitmapRect.w, bitmapRect.h)
  if (!surface) return null
  let context = null
  let complete = false
  try {
    context = surface.getContext?.('2d') || null
    if (!context) return null
    context.setTransform(
      task.frame.pixelRatioX,
      0,
      0,
      task.frame.pixelRatioY,
      -bitmapRect.x,
      -bitmapRect.y
    )
    context.translate(task.frame.offsetX, task.frame.offsetY)
    context.scale(task.frame.scaleX, task.frame.scaleY)
    drawNode(
      context,
      sourceNode,
      scaleX,
      scaleY,
      worldPixel,
      'full',
      opacityMultiplier,
      {
        node,
        animationTimestamp,
        animationTimestampResolved: true,
        runtimeValue: runtimeValueSnapshot,
        runtimeValueResolved: true
      }
    )
    complete = true
    return surface
  } catch {
    return null
  } finally {
    if (!complete) {
      surface.width = 0
      surface.height = 0
    }
  }
}

function blitCanvasVisualSprite(ctx, surface, bitmapRect, frame) {
  const pixelRatioX = Math.max(.0001, number(frame.pixelRatioX, 1))
  const pixelRatioY = Math.max(.0001, number(frame.pixelRatioY, 1))
  const scaleX = Math.max(.0001, number(frame.scaleX, 1))
  const scaleY = Math.max(.0001, number(frame.scaleY, 1))
  const destinationX = (bitmapRect.x / pixelRatioX - number(frame.offsetX)) / scaleX
  const destinationY = (bitmapRect.y / pixelRatioY - number(frame.offsetY)) / scaleY
  const destinationWidth = bitmapRect.w / pixelRatioX / scaleX
  const destinationHeight = bitmapRect.h / pixelRatioY / scaleY
  ctx.drawImage(surface, destinationX, destinationY, destinationWidth, destinationHeight)
}

function prepareCanvasVisualSpriteCommand(
  task,
  sourceNode,
  scaleX,
  scaleY,
  worldPixel,
  opacityMultiplier
) {
  if (!canvasVisualAnimationTypes.has(sourceNode?.type)) return null
  const descriptorOwner = sourceNode && typeof sourceNode === 'object'
  const sourceKey = canvasVisualDescriptorSourceKey(sourceNode)
  let descriptor = descriptorOwner ? canvasVisualSpriteDescriptorCache.get(sourceNode) : null
  if (
    descriptor?.frame !== task.frame
    || descriptor.opacityMultiplier !== opacityMultiplier
    || descriptor.sourceKey !== sourceKey
  ) {
    descriptor = null
  }
  let cacheable = false
  if (descriptor) {
    task.visualDescriptorCacheHits += 1
  } else {
    cacheable = Boolean(
      descriptorOwner
    )
    if (cacheable) task.visualDescriptorCacheMisses += 1
    else task.visualDescriptorCacheBypasses += 1
  }
  if (!descriptor) {
    const node = materializeRuntimeNode(sourceNode, runtimePointValue)
    if (number(node.rotate) !== 0) return null
    const runtimeValueSnapshot = runtimeValue(sourceNode)
    const badgeText = sourceNode.dataKey ? runtimeDisplayText(runtimeValueSnapshot) : ''
    const visualScalePadding = Math.max(
      Math.abs(number(node.visualScaleX, 1)),
      Math.abs(number(node.visualScaleY, 1)),
      1
    )
    const borderPadding = node.borderVisible === false
      ? 0
      : Math.max(0, number(node.borderWidth)) / 2 * visualScalePadding
    const heartbeatPadding = node.type === 'heartbeat'
      ? Math.max(number(node.w, 1), number(node.h, 1)) * .09 * visualScalePadding
      : 0
    const bitmapRect = runtimeNodeBitmapRect(node, task.frame, {
      regionPadding: Math.max(2, borderPadding, heartbeatPadding),
      bitmapPadding: 2
    })
    if (!bitmapRect) return null
    const pixelCount = bitmapRect.w * bitmapRect.h
    if (pixelCount <= 0 || pixelCount > RUNTIME_VISUAL_SPRITE_MAX_ITEM_PIXELS) return null
    const layout = canvasNodeLayout(node, scaleX, scaleY, worldPixel)
    descriptor = {
      frame: task.frame,
      sourceKey,
      node,
      bitmapRect,
      pixelCount,
      runtimeValueSnapshot,
      badgeText,
      layout,
      opacityMultiplier,
      staticSignature: internCanvasVisualSpriteStaticSignature(
        canvasVisualSpriteStaticSignature(
          task,
          node,
          bitmapRect,
          layout,
          opacityMultiplier,
          badgeText
        )
      ),
      animationProfileId: internCanvasVisualAnimationProfile(node, layout)
    }
    if (cacheable) canvasVisualSpriteDescriptorCache.set(sourceNode, descriptor)
  }

  const rawTimestamp = number(task.animationTimestamp)
  const animated = isCanvasVisualAnimationCandidate(descriptor.node)
  const animationTimestamp = animated
    ? visualAnimationTimeline.resolve(descriptor.node, rawTimestamp)
    : rawTimestamp
  if (descriptor.node.type === 'signalLight') {
    task.signalLightColors.set(
      visualAnimationNodeKey(sourceNode),
      signalLightColor(descriptor.node, animationTimestamp)
    )
  }
  const signature = canvasVisualSpriteSignature(
    task,
    descriptor.node,
    descriptor.bitmapRect,
    descriptor.layout,
    animationTimestamp,
    opacityMultiplier,
    descriptor.badgeText,
    descriptor.staticSignature,
    descriptor.animationProfileId
  )
  const streamKey = canvasVisualAnimationStreamKey(
    sourceNode,
    descriptor.node,
    descriptor.animationProfileId,
    rawTimestamp,
    animationTimestamp,
    animated
  )
  return {
    sourceNode,
    node: descriptor.node,
    bitmapRect: descriptor.bitmapRect,
    pixelCount: descriptor.pixelCount,
    signature,
    slotSignature: `${descriptor.staticSignature}\u0000${descriptor.animationProfileId}\u0000${streamKey}`,
    scaleX,
    scaleY,
    worldPixel,
    opacityMultiplier,
    animationTimestamp,
    runtimeValueSnapshot: descriptor.runtimeValueSnapshot
  }
}

function tryDrawCanvasVisualSprite(
  task,
  sourceNode,
  scaleX,
  scaleY,
  worldPixel,
  renderPass,
  opacityMultiplier
) {
  if (
    renderPass !== 'full'
    || !task.visualSpriteCache
    || !canvasVisualAnimationTypes.has(sourceNode?.type)
  ) return false

  const command = prepareCanvasVisualSpriteCommand(
    task,
    sourceNode,
    scaleX,
    scaleY,
    worldPixel,
    opacityMultiplier,
  )
  if (!command) return false
  const {
    node,
    bitmapRect,
    pixelCount,
    signature,
    animationTimestamp,
    runtimeValueSnapshot
  } = command
  let entry = task.visualSpriteCache.get(signature)
  if (entry?.surface) {
    blitCanvasVisualSprite(task.ctx, entry.surface, bitmapRect, task.frame)
    task.visualSpriteBlitCount += 1
    return true
  }

  if (!entry) {
    if (task.visualSpriteCache.size >= RUNTIME_VISUAL_SPRITE_MAX_SIGNATURES) return false
    entry = { hits: 1, disabled: false, surface: null, pixels: 0 }
    task.visualSpriteCache.set(signature, entry)
    drawCanvasVisualSpriteDirect(
      task,
      sourceNode,
      node,
      scaleX,
      scaleY,
      worldPixel,
      opacityMultiplier,
      animationTimestamp,
      runtimeValueSnapshot
    )
    return true
  }

  entry.hits += 1
  const canCreate = !entry.disabled
    && task.visualSpriteSurfaceCount < RUNTIME_VISUAL_SPRITE_MAX_SURFACES
    && task.visualSpritePixelCount + pixelCount <= RUNTIME_VISUAL_SPRITE_MAX_TOTAL_PIXELS
  if (!canCreate) {
    entry.disabled = true
    drawCanvasVisualSpriteDirect(
      task,
      sourceNode,
      node,
      scaleX,
      scaleY,
      worldPixel,
      opacityMultiplier,
      animationTimestamp,
      runtimeValueSnapshot
    )
    return true
  }

  const surface = createCanvasVisualSprite(
    task,
    sourceNode,
    node,
    bitmapRect,
    scaleX,
    scaleY,
    worldPixel,
    opacityMultiplier,
    animationTimestamp,
    runtimeValueSnapshot
  )
  if (!surface) {
    entry.disabled = true
    drawCanvasVisualSpriteDirect(
      task,
      sourceNode,
      node,
      scaleX,
      scaleY,
      worldPixel,
      opacityMultiplier,
      animationTimestamp,
      runtimeValueSnapshot
    )
    return true
  }

  entry.surface = surface
  entry.pixels = pixelCount
  task.visualSpriteSurfaceCount += 1
  task.visualSpritePixelCount += pixelCount
  task.visualSpriteRasterCount += 1
  blitCanvasVisualSprite(task.ctx, surface, bitmapRect, task.frame)
  task.visualSpriteBlitCount += 1
  return true
}

function releaseCanvasVisualSprites(task) {
  for (const entry of task?.visualSpriteCache?.values?.() || []) {
    if (!entry?.surface) continue
    releaseCanvasVisualSpriteSurface(entry.surface)
    entry.surface = null
  }
  task?.visualSpriteCache?.clear?.()
  if (!task) return
  task.visualSpritePixelCount = 0
  task.visualSpriteSurfaceCount = 0
}

function canvasVisualAtlasEligible(task, items) {
  return Boolean(
    task.visualAnimationFrame
    && !task.visualAtlasAttempted
    && Array.isArray(items)
    && items.length >= RUNTIME_VISUAL_ATLAS_MIN_INSTANCES
    && task.renderNodes
  )
}

function beginCanvasVisualAtlasAttempt(task, items, mode) {
  if (!canvasVisualAtlasEligible(task, items)) return false
  const topology = mode === 'direct'
    ? task.visualAtlasDirectFrame?.topology || null
    : null
  task.visualAtlasAttempted = true
  task.visualAtlasMode = mode
  task.visualAtlasMinimumInstances = RUNTIME_VISUAL_ATLAS_MIN_INSTANCES
  task.visualAtlasTopology = topology
  task.visualAtlasItems = topology?.representatives || items
  task.visualAtlasInstanceSources = topology?.instances || null
  task.visualAtlasPendingTopology = null
  task.visualAtlasCursor = 0
  task.visualAtlasCommands = []
  task.visualAtlasLayerItems = []
  task.visualAtlasPassthroughCount = 0
  task.visualAtlasUniqueCommands = new Map()
  task.visualAtlasStableSlots = true
  task.visualAtlasEntries = []
  task.visualAtlasRasterCursor = 0
  task.visualAtlasCompositeCursor = 0
  task.visualAtlasCompositePrepared = false
  task.visualAtlasPlan = null
  task.visualAtlasFrame = null
  task.visualAtlasInstances = null
  task.visualAtlasBlitData = null
  task.phase = 'visualAtlasPrepare'
  return true
}

function clearCanvasVisualAtlasAttempt(task) {
  task.visualAtlasItems = null
  task.visualAtlasCommands = []
  task.visualAtlasLayerItems = []
  task.visualAtlasPassthroughCount = 0
  task.visualAtlasMinimumInstances = 0
  task.visualAtlasUniqueCommands = null
  task.visualAtlasEntries = []
  task.visualAtlasInstances = null
  task.visualAtlasBlitData = null
  task.visualAtlasInstanceSources = null
  task.visualAtlasTopology = null
  task.visualAtlasPendingTopology = null
  task.visualAtlasPlan = null
  task.visualAtlasFrame = null
  task.visualAtlasOutputRect = null
  task.visualAtlasCursor = 0
  task.visualAtlasRasterCursor = 0
  task.visualAtlasCompositeCursor = 0
  task.visualAtlasCompositePrepared = false
}

function canvasVisualAtlasOutputRect(task) {
  const rects = task.visualAtlasMode === 'union' || (task.visualAnimationFrame && task.measuredBitmapRects.length)
    ? task.measuredBitmapRects
    : fullRuntimeSeedRect(task.frame)
  if (!Array.isArray(rects) || !rects.length) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, number(rect?.x))
    top = Math.min(top, number(rect?.y))
    right = Math.max(right, number(rect?.x) + Math.max(0, number(rect?.w)))
    bottom = Math.max(bottom, number(rect?.y) + Math.max(0, number(rect?.h)))
  }
  const x = Math.max(0, Math.floor(left))
  const y = Math.max(0, Math.floor(top))
  const clippedRight = Math.min(task.frame.bitmapWidth, Math.ceil(right))
  const clippedBottom = Math.min(task.frame.bitmapHeight, Math.ceil(bottom))
  if (clippedRight <= x || clippedBottom <= y) return null
  return { x, y, w: clippedRight - x, h: clippedBottom - y }
}

function fallbackCanvasVisualAtlas(task, reason = 'unknown') {
  const mode = task.visualAtlasMode
  const preserveCompositeBase = task.visualAtlasDirectFrame?.preserveCompositeBase === true
  if (task.regionContextSaved) {
    try { task.ctx.restore() } catch { task.surfaceReusable = false }
    task.regionContextSaved = false
  }
  if (task.denseContextSaved) {
    try { task.ctx.restore() } catch { task.surfaceReusable = false }
    task.denseContextSaved = false
  }
  task.visualAtlasFallbackCount += 1
  task.visualAtlasFailureReason = reason
  clearCanvasVisualAtlasAttempt(task)
  if (mode === 'dense') beginDenseRuntime2dDraw(task)
  else if (mode === 'direct') {
    task.candidates = task.visualAtlasDirectItems || []
    task.candidateCursor = 0
    if (preserveCompositeBase) beginDirectPreservingRuntimeDraw(task)
    else beginRuntimeUnionDraw(task)
  }
  else beginRuntimeUnionDraw(task)
}

function restoreCanvasVisualAtlasOutput(task, outputRect) {
  const source = task?.visualAtlasDirectFrame?.preserveCompositeBase
    ? task.frontComposite
    : task?.base
  if (!task?.ctx || !source || !outputRect) return false
  let saved = false
  try {
    task.ctx.save()
    saved = true
    task.ctx.setTransform(1, 0, 0, 1, 0, 0)
    task.ctx.globalAlpha = 1
    task.ctx.globalCompositeOperation = 'source-over'
    task.ctx.clearRect(outputRect.x, outputRect.y, outputRect.w, outputRect.h)
    task.ctx.drawImage(
      source,
      outputRect.x,
      outputRect.y,
      outputRect.w,
      outputRect.h,
      outputRect.x,
      outputRect.y,
      outputRect.w,
      outputRect.h
    )
    return true
  } catch {
    task.surfaceReusable = false
    return false
  } finally {
    if (saved) {
      try { task.ctx.restore() } catch { task.surfaceReusable = false }
    }
  }
}

function beginDirectPreservingRuntimeDraw(task) {
  task.ctx.save()
  task.regionContextSaved = true
  task.ctx.setTransform(1, 0, 0, 1, 0, 0)
  task.ctx.beginPath()
  for (const rect of task.measuredBitmapRects) task.ctx.rect(rect.x, rect.y, rect.w, rect.h)
  task.ctx.clip()
  task.ctx.setTransform(task.frame.pixelRatioX, 0, 0, task.frame.pixelRatioY, 0, 0)
  task.ctx.translate(task.frame.offsetX, task.frame.offsetY)
  task.ctx.scale(task.frame.scaleX, task.frame.scaleY)
  task.bitmapRects.push(...task.measuredBitmapRects)
  task.phase = 'draw'
}

function drawCanvasVisualAtlasSprite(task, context, command, slot) {
  const frame = task.frame
  context.save()
  try {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.beginPath()
    context.rect(slot.x, slot.y, slot.w, slot.h)
    context.clip()
    context.setTransform(
      frame.pixelRatioX,
      0,
      0,
      frame.pixelRatioY,
      slot.x - command.bitmapRect.x,
      slot.y - command.bitmapRect.y
    )
    context.translate(frame.offsetX, frame.offsetY)
    context.scale(frame.scaleX, frame.scaleY)
    drawNode(
      context,
      command.sourceNode,
      command.scaleX,
      command.scaleY,
      command.worldPixel,
      'full',
      command.opacityMultiplier,
      {
        node: command.node,
        animationTimestamp: command.animationTimestamp,
        animationTimestampResolved: true,
        runtimeValue: command.runtimeValueSnapshot,
        runtimeValueResolved: true
      }
    )
  } finally {
    context.restore()
  }
  const surface = context.canvas
  context.save()
  try {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.drawImage(surface, slot.x, slot.y, slot.w, 1, slot.x, slot.y - 1, slot.w, 1)
    context.drawImage(surface, slot.x, slot.y + slot.h - 1, slot.w, 1, slot.x, slot.y + slot.h, slot.w, 1)
    context.drawImage(surface, slot.x, slot.y, 1, slot.h, slot.x - 1, slot.y, 1, slot.h)
    context.drawImage(surface, slot.x + slot.w - 1, slot.y, 1, slot.h, slot.x + slot.w, slot.y, 1, slot.h)
    context.drawImage(surface, slot.x, slot.y, 1, 1, slot.x - 1, slot.y - 1, 1, 1)
    context.drawImage(surface, slot.x + slot.w - 1, slot.y, 1, 1, slot.x + slot.w, slot.y - 1, 1, 1)
    context.drawImage(surface, slot.x, slot.y + slot.h - 1, 1, 1, slot.x - 1, slot.y + slot.h, 1, 1)
    context.drawImage(surface, slot.x + slot.w - 1, slot.y + slot.h - 1, 1, 1, slot.x + slot.w, slot.y + slot.h, 1, 1)
  } finally {
    context.restore()
  }
}

function canvasVisualAtlasLayoutKey(entries) {
  return entries
    .slice()
    .sort((left, right) => left.signature.localeCompare(right.signature))
    .map(entry => `${entry.signature.length}:${entry.signature}:${entry.width}x${entry.height}`)
    .join('|')
}

function resolveCanvasVisualAtlasSlotSignature(task, command) {
  let slotSignature = command.slotSignature
  const existing = task.visualAtlasUniqueCommands.get(slotSignature)
  if (!existing || existing.signature === command.signature) return slotSignature
  const sourceKey = String(command.sourceNode?.id ?? task.visualAtlasCursor)
  slotSignature = `${slotSignature}\u0000node:${sourceKey}`
  let suffix = 1
  while (
    task.visualAtlasUniqueCommands.has(slotSignature)
    && task.visualAtlasUniqueCommands.get(slotSignature).signature !== command.signature
  ) {
    slotSignature = `${command.slotSignature}\u0000node:${sourceKey}:${suffix}`
    suffix += 1
  }
  return slotSignature
}

function prepareCanvasVisualAtlas(task, deadline) {
  const startedAt = currentAnimationTimestamp()
  if (!Array.isArray(task.visualAtlasLayerItems)) task.visualAtlasLayerItems = []
  if (!Number.isFinite(task.visualAtlasPassthroughCount)) task.visualAtlasPassthroughCount = 0
  const worldPixel = 1 / Math.max(.0001, Math.min(task.frame.scaleX, task.frame.scaleY))
  while (task.visualAtlasCursor < task.visualAtlasItems.length) {
    const item = task.visualAtlasItems[task.visualAtlasCursor]
    if (item?.kind !== 'node' || !item.entity) {
      if (item?.kind === 'drawing' && item.entity) {
        task.visualAtlasLayerItems.push({ kind: 'passthrough', item })
        task.visualAtlasPassthroughCount += 1
        task.visualAtlasCursor += 1
        if (deadline.shouldYield()) {
          task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
          return false
        }
        continue
      }
      task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
      fallbackCanvasVisualAtlas(task, 'unsupported-entity')
      return true
    }
    const command = prepareCanvasVisualSpriteCommand(
      task,
      item.entity,
      task.frame.scaleX,
      task.frame.scaleY,
      worldPixel,
      1
    )
    if (!command) {
      task.visualAtlasLayerItems.push({ kind: 'passthrough', item })
      task.visualAtlasPassthroughCount += 1
      task.visualAtlasCursor += 1
      if (deadline.shouldYield()) {
        task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
        return false
      }
      continue
    }
    command.slotSignature = item.slotSignature
      || resolveCanvasVisualAtlasSlotSignature(task, command)
    task.visualAtlasCommands.push(command)
    task.visualAtlasLayerItems.push({
      kind: 'atlas',
      instanceIndex: task.visualAtlasCommands.length - 1
    })
    if (!task.visualAtlasUniqueCommands.has(command.slotSignature)) {
      task.visualAtlasUniqueCommands.set(command.slotSignature, command)
    }
    task.visualAtlasCursor += 1
    if (deadline.shouldYield()) {
      task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
      return false
    }
  }

  const minimumInstances = Math.max(1, Math.floor(Number(task.visualAtlasMinimumInstances) || 1))
  if (task.visualAtlasCommands.length < minimumInstances) {
    task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'insufficient-visual-instances')
    return true
  }

  if (task.visualAtlasUniqueCommands.size > RUNTIME_VISUAL_ATLAS_MAX_ENTRIES) {
    const dynamicCommands = new Map()
    for (const command of task.visualAtlasCommands) {
      command.slotSignature = command.signature
      if (!dynamicCommands.has(command.signature)) dynamicCommands.set(command.signature, command)
      if (dynamicCommands.size > RUNTIME_VISUAL_ATLAS_MAX_ENTRIES) {
        task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
        fallbackCanvasVisualAtlas(task, 'signature-capacity')
        return true
      }
    }
    task.visualAtlasUniqueCommands = dynamicCommands
    task.visualAtlasStableSlots = false
  }

  const entries = [...task.visualAtlasUniqueCommands.values()].map(command => ({
    signature: command.slotSignature,
    width: command.bitmapRect.w,
    height: command.bitmapRect.h
  }))
  task.visualAtlasRawPixels = entries.reduce((total, entry) => total + entry.width * entry.height, 0)
  const layoutKey = canvasVisualAtlasLayoutKey(entries)
  if (task.visualAtlasTopology && task.visualAtlasTopology.layoutKey !== layoutKey) {
    if (task.visualAtlasDirectFrame?.topology === task.visualAtlasTopology) {
      task.visualAtlasDirectFrame.topology = null
    }
    task.visualAtlasTopology = null
    task.visualAtlasItems = task.visualAtlasDirectItems || []
    task.visualAtlasInstanceSources = null
    task.visualAtlasCursor = 0
    task.visualAtlasCommands = []
    task.visualAtlasUniqueCommands = new Map()
    task.visualAtlasStableSlots = true
    task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
    return false
  }
  let atlasFrame = cachedCanvasVisualAtlasFrame(layoutKey)
  const plan = atlasFrame?.plan || packCanvasVisualAtlas(entries, {
    maxEntries: RUNTIME_VISUAL_ATLAS_MAX_ENTRIES,
    maxWidth: RUNTIME_VISUAL_ATLAS_MAX_DIMENSION,
    maxHeight: RUNTIME_VISUAL_ATLAS_MAX_DIMENSION,
    maxPixels: RUNTIME_VISUAL_ATLAS_MAX_PIXELS,
    padding: 1
  })
  const cacheHit = Boolean(atlasFrame)
  if (plan && !atlasFrame) atlasFrame = acquireCanvasVisualAtlasFrame(layoutKey, plan)
  if (!plan || !atlasFrame?.surface || !atlasFrame.context) {
    task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, plan ? 'atlas-surface' : 'atlas-budget')
    return true
  }
  task.visualAtlasPlan = plan
  task.visualAtlasFrame = atlasFrame
  task.visualAtlasFrameCacheHit = cacheHit
  task.visualAtlasWidth = plan.width
  task.visualAtlasHeight = plan.height
  task.visualAtlasEntries = [...task.visualAtlasUniqueCommands.values()]
  if (
    task.visualAtlasMode === 'direct'
    && task.visualAtlasStableSlots
    && !task.visualAtlasTopology
    && task.visualAtlasDirectFrame
  ) {
    task.visualAtlasPendingTopology = {
      layoutKey,
      representatives: task.visualAtlasEntries.map(command => ({
        kind: 'node',
        entity: command.sourceNode,
        slotSignature: command.slotSignature
      })),
      instances: task.visualAtlasCommands.map(command => ({
        signature: command.slotSignature,
        bitmapRect: command.bitmapRect
      })),
      mappedInstances: null,
      blitData: null,
      outputRect: null
    }
  }
  task.visualAtlasRasterCursor = 0
  task.visualAtlasPrepareMs += currentAnimationTimestamp() - startedAt
  task.phase = 'visualAtlasRaster'
  return true
}

function rasterCanvasVisualAtlas(task, deadline) {
  const startedAt = currentAnimationTimestamp()
  const atlasFrame = task.visualAtlasFrame
  const surface = atlasFrame?.surface
  const context = atlasFrame?.context
  if (!surface || !context || !task.visualAtlasPlan) {
    task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'atlas-surface')
    return true
  }
  try {
    while (task.visualAtlasRasterCursor < task.visualAtlasEntries.length) {
      const command = task.visualAtlasEntries[task.visualAtlasRasterCursor]
      const slot = task.visualAtlasPlan.slots.get(command.slotSignature)
      if (!slot) throw new Error('visual atlas slot is missing')
      if (atlasFrame.slotSignatures.get(command.slotSignature) === command.signature) {
        task.visualAtlasSlotCacheHits += 1
      } else {
        context.save()
        try {
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.globalAlpha = 1
          context.globalCompositeOperation = 'source-over'
          context.clearRect(slot.x - 1, slot.y - 1, slot.w + 2, slot.h + 2)
        } finally {
          context.restore()
        }
        try {
          drawCanvasVisualAtlasSprite(task, context, command, slot)
          atlasFrame.slotSignatures.set(command.slotSignature, command.signature)
        } catch (error) {
          atlasFrame.slotSignatures.delete(command.slotSignature)
          throw error
        }
        task.visualAtlasRasterDrawCount += 1
        task.visualAtlasSlotCacheMisses += 1
      }
      task.visualAtlasRasterCursor += 1
      if (deadline.shouldYield()) {
        task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
        return false
      }
    }
  } catch {
    task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'atlas-raster')
    return true
  }
  const instanceSources = task.visualAtlasInstanceSources || task.visualAtlasCommands.map(command => ({
    signature: command.slotSignature,
    bitmapRect: command.bitmapRect
  }))
  const cachedTopology = task.visualAtlasTopology
  const instances = cachedTopology?.mappedInstances
    || mapCanvasVisualAtlasInstances(instanceSources, task.visualAtlasPlan.slots)
  if (!instances) {
    task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'atlas-instance-map')
    return true
  }
  const outputRect = canvasVisualAtlasOutputRect(task)
  if (!outputRect) {
    task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'output-rect')
    return true
  }
  task.visualAtlasOutputRect = outputRect
  task.visualAtlasInstances = cachedTopology?.mappedInstances
    ? instances
    : instances.map(instance => ({
        ...instance,
        bitmapRect: {
          x: instance.bitmapRect.x - outputRect.x,
          y: instance.bitmapRect.y - outputRect.y,
          w: instance.bitmapRect.w,
          h: instance.bitmapRect.h
        }
      }))
  task.visualAtlasBlitData = cachedTopology?.blitData
    || canvasVisualAtlasBlitData(task.visualAtlasInstances)
  if (!task.visualAtlasBlitData) {
    task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
    fallbackCanvasVisualAtlas(task, 'atlas-blit-data')
    return true
  }
  if (task.visualAtlasPendingTopology && task.visualAtlasDirectFrame) {
    task.visualAtlasPendingTopology.mappedInstances = task.visualAtlasInstances
    task.visualAtlasPendingTopology.blitData = task.visualAtlasBlitData
    task.visualAtlasPendingTopology.outputRect = { ...outputRect }
    task.visualAtlasDirectFrame.topology = task.visualAtlasPendingTopology
  }
  task.visualAtlasRasterMs += currentAnimationTimestamp() - startedAt
  task.phase = 'visualAtlasComposite'
  return true
}

function compositeCanvasVisualAtlas(task, deadline) {
  const outputRect = task.visualAtlasOutputRect
  const atlas = task.visualAtlasFrame?.surface
  const instanceCount = task.visualAtlasInstances.length
  const spriteCount = task.visualAtlasEntries.length
  const atlasPixels = task.visualAtlasPlan.pixels
  const compositeStartedAt = currentAnimationTimestamp()
  let saved = false
  let compositeFailed = false
  let blitDone = false
  try {
    if (!task.visualAtlasCompositePrepared) {
      if (task.visualAtlasMode === 'union') {
        beginRuntimeUnionDraw(task)
        task.phase = 'visualAtlasComposite'
      }
      else if (task.visualAtlasMode === 'dense' && task.visualAtlasPassthroughCount > 0) {
        beginDenseRuntime2dDraw(task)
        task.phase = 'visualAtlasComposite'
      }
      else if (task.visualAtlasMode === 'direct') {
        task.bitmapRects = task.measuredBitmapRects.slice()
      }
      else {
        task.bitmapRects = task.partialDense
          ? task.measuredBitmapRects.slice()
          : fullRuntimeSeedRect(task.frame)
      }
      task.visualAtlasCompositePrepared = true
      task.visualAtlasBackend = 'canvas2d'
    }
    if (task.visualAtlasPassthroughCount > 0) {
      const worldPixel = 1 / Math.max(.0001, Math.min(task.frame.scaleX, task.frame.scaleY))
      while (task.visualAtlasCompositeCursor < task.visualAtlasLayerItems.length) {
        const layerItem = task.visualAtlasLayerItems[task.visualAtlasCompositeCursor]
        if (layerItem.kind === 'atlas') {
          const blitStartedAt = currentAnimationTimestamp()
          const instance = task.visualAtlasInstances[layerItem.instanceIndex]
          if (!instance) throw new Error('visual atlas instance is missing')
          const source = instance.atlasRect
          const target = instance.bitmapRect
          task.ctx.save()
          try {
            task.ctx.setTransform(1, 0, 0, 1, 0, 0)
            task.ctx.globalAlpha = 1
            task.ctx.globalCompositeOperation = 'source-over'
            task.ctx.drawImage(
              atlas,
              source.x,
              source.y,
              source.w,
              source.h,
              outputRect.x + target.x,
              outputRect.y + target.y,
              target.w,
              target.h
            )
          } finally {
            task.ctx.restore()
          }
          task.visualAtlasDrawMs += Math.max(0, currentAnimationTimestamp() - blitStartedAt)
        } else if (layerItem.item?.kind === 'drawing') {
          drawTemporaryDrawing(task.ctx, layerItem.item.entity, worldPixel)
        } else if (layerItem.item?.kind === 'node') {
          if (!drawEntityIncrementally(
            task,
            layerItem.item.entity,
            task.frame.scaleX,
            task.frame.scaleY,
            worldPixel,
            'full',
            1,
            deadline
          )) return false
        }
        task.visualAtlasCompositeCursor += 1
        if (deadline?.shouldYield?.()) return false
      }
      blitDone = true
    } else {
    task.ctx.save()
    saved = true
    task.ctx.setTransform(1, 0, 0, 1, 0, 0)
    task.ctx.globalAlpha = 1
    task.ctx.globalCompositeOperation = 'source-over'
    task.ctx.beginPath()
    task.ctx.rect(outputRect.x, outputRect.y, outputRect.w, outputRect.h)
    task.ctx.clip()
    if (
      task.visualAtlasMode === 'direct'
      && task.visualAtlasCompositeCursor === 0
      && !task.visualAtlasDirectFrame?.preserveCompositeBase
    ) {
      for (const rect of task.measuredBitmapRects) {
        task.ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
        task.ctx.drawImage(
          task.base,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
          rect.x,
          rect.y,
          rect.w,
          rect.h
        )
      }
    }
    const blitStartedAt = currentAnimationTimestamp()
    const result = drawCanvasVisualAtlasBlits(task.ctx, atlas, task.visualAtlasBlitData, {
      cursor: task.visualAtlasCompositeCursor,
      offsetX: outputRect.x,
      offsetY: outputRect.y,
      shouldYield: () => deadline?.shouldYield?.() === true
    })
    task.visualAtlasDrawMs += currentAnimationTimestamp() - blitStartedAt
    task.visualAtlasCompositeCursor = result.cursor
    blitDone = result.done
    }
  } catch {
    compositeFailed = true
  } finally {
    if (saved) {
      try { task.ctx.restore() } catch {
        task.surfaceReusable = false
        compositeFailed = true
      }
    }
  }
  task.visualAtlasCompositeMs += currentAnimationTimestamp() - compositeStartedAt
  if (compositeFailed) {
    restoreCanvasVisualAtlasOutput(task, outputRect)
    fallbackCanvasVisualAtlas(task, '2d-atlas-composite')
    return true
  }
  if (!blitDone) return false
  task.visualAtlasUsed = true
  task.visualAtlasInstanceCount = instanceCount
  task.visualAtlasSpriteCount = spriteCount
  task.visualAtlasPixels = atlasPixels
  task.visualAtlasOutputPixels = outputRect.w * outputRect.h
  task.visualSpriteRasterCount = task.visualAtlasRasterDrawCount
  task.visualSpriteBlitCount = instanceCount
  if (task.regionContextSaved) {
    task.ctx.restore()
    task.regionContextSaved = false
  }
  if (task.denseContextSaved) {
    task.ctx.restore()
    task.denseContextSaved = false
  }
  clearCanvasVisualAtlasAttempt(task)
  task.phase = 'complete'
  return true
}

function drawEntityIncrementally(
  task,
  sourceNode,
  scaleX,
  scaleY,
  worldPixel,
  renderPass,
  opacityMultiplier,
  deadline
) {
  if (['image', 'customImageMotion'].includes(sourceNode?.type) && sourceNode.imageUrl) {
    task.imageUrls?.add(sourceNode.imageUrl)
    const image = cachedImage(sourceNode.imageUrl)
    // 记录“实际绘制时”尚未就绪的资源；即使它在长任务结束前加载，也不能提交旧占位像素。
    if (!cachedImageSettled(image)) task.pendingImageUrls?.add(sourceNode.imageUrl)
  }
  let work = task.textLayoutWork
  let preparedNode = null
  if (!work) {
    if (sourceNode?.type === 'text') preparedNode = materializeRuntimeNode(sourceNode, runtimePointValue)
    work = createLongTextLayoutWork(
      sourceNode,
      scaleX,
      scaleY,
      worldPixel,
      renderPass,
      preparedNode
    )
    if (work) task.textLayoutWork = work
  } else if (work.sourceNode !== sourceNode) {
    throw new Error('incremental text layout cursor does not match the current entity')
  }

  let textLayout = null
  if (work) {
    task.ctx.save()
    try {
      task.ctx.font = work.font
      const result = runIncrementalTextLayoutSlice(
        work.state,
        value => task.ctx.measureText(value),
        deadline
      )
      if (!result.done) return false
      textLayout = finishLongTextLayoutWork(work)
      task.textLayoutWork = null
    } catch (error) {
      task.surfaceReusable = false
      throw error
    } finally {
      task.ctx.restore()
    }
  }

  if (tryDrawCanvasVisualSprite(
    task,
    sourceNode,
    scaleX,
    scaleY,
    worldPixel,
    renderPass,
    opacityMultiplier
  )) return true

  drawNode(
    task.ctx,
    sourceNode,
    scaleX,
    scaleY,
    worldPixel,
    renderPass,
    opacityMultiplier,
    {
      node: textLayout?.node || preparedNode,
      textLayout,
      animationTimestamp: task.animationTimestamp
    }
  )
  return true
}

function edgeRasterCommand(edge, worldPixel, index) {
  const endpoints = edgeEndpointsForNodes(edge, index)
  if (!endpoints) return null
  const color = edge.color || '#485563'
  const lineWidth = props.faithful
    ? readableStroke(edge.width, worldPixel)
    : Math.max(readableStroke(edge.width, worldPixel), worldPixel * .65)
  const markerLineWidth = readableStroke(worldPixel, worldPixel)
  const markerSize = marker => props.faithful
    ? (marker === 'arrow' ? 10 : 8)
    : worldPixel * (marker === 'arrow' ? 4 : 3.2)
  return {
    startX: endpoints.start.x,
    startY: endpoints.start.y,
    endX: endpoints.end.x,
    endY: endpoints.end.y,
    color,
    lineWidth,
    dash: Boolean(edge.dash),
    startMarker: edge.startMarker,
    endMarker: edge.endMarker,
    startMarkerSize: markerSize(edge.startMarker),
    endMarkerSize: markerSize(edge.endMarker),
    markerLineWidth
  }
}

function drawEdge(ctx, edge, worldPixel, index) {
  return drawEdgeRasterCommand(ctx, edgeRasterCommand(edge, worldPixel, index))
}

function drawEdges(ctx, edges, startIndex, worldPixel, index, deadline, task = null, endIndex = edges.length) {
  let cursor = startIndex
  const limit = Math.min(edges.length, Math.max(startIndex, endIndex))
  while (cursor < limit) {
    const edge = edges[cursor]
    drawEdge(ctx, edge, worldPixel, index)
    if (task) indexTaskGeometryEntity(task, 'edge', edge)
    cursor += 1
    if (deadline.shouldYield()) break
  }
  return cursor
}

function drawTemporaryDrawing(ctx, drawing, worldPixel) {
  const points = Array.isArray(drawing.points) ? drawing.points : []
  if (points.length < 2) return
  ctx.save()
  try {
    ctx.strokeStyle = drawing.color || '#485563'
    ctx.globalAlpha = alpha(drawing.opacity)
    ctx.lineWidth = props.faithful
      ? readableStroke(drawing.width, worldPixel)
      : Math.max(readableStroke(drawing.width, worldPixel), worldPixel)
    ctx.lineCap = drawing.lineCap || 'round'
    ctx.lineJoin = drawing.lineJoin || 'round'
    if (drawing.dash) ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3])
    ctx.beginPath()
    ctx.moveTo(number(points[0].x), number(points[0].y))
    if (drawing.smooth && points.length > 2) {
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index]
        const next = points[index + 1]
        ctx.quadraticCurveTo(number(point.x), number(point.y), (number(point.x) + number(next.x)) / 2, (number(point.y) + number(next.y)) / 2)
      }
      const last = points.at(-1)
      ctx.lineTo(number(last.x), number(last.y))
    } else points.slice(1).forEach(point => ctx.lineTo(number(point.x), number(point.y)))
    if (drawing.closed) {
      ctx.closePath()
      ctx.save()
      try {
        ctx.globalAlpha *= .16
        ctx.fillStyle = drawing.color || '#485563'
        ctx.fill()
      } finally {
        ctx.restore()
      }
    }
    ctx.stroke()
  } finally {
    ctx.restore()
  }
}

function renderPayload() {
  const target = canvas.value
  return {
    target,
    contextToken: canvasContextGate.capture(target),
    width: props.width,
    height: props.height,
    viewBox: props.viewBox,
    stageWidth: props.stageWidth,
    stageHeight: props.stageHeight,
    background: props.background,
    fitMode: props.fitMode,
    maxBitmapPixels: props.maxBitmapPixels,
    pixelRatio: props.pixelRatio,
    incrementalRuntime: props.incrementalRuntime,
    geometryInteractive: props.geometryInteractive,
    renderNodes: props.renderNodes,
    renderDrawings: props.renderDrawings,
    nodes: props.nodes,
    edges: props.edges,
    drawings: props.drawings,
    nodeIndex: props.nodeIndex,
    orderedEntities: props.orderedEntities,
    excludedNodeIds: props.excludedNodeIds,
    excludedDrawingIds: props.excludedDrawingIds,
    renderPlanKey: props.renderPlanKey,
    frameCommitToken: props.frameCommitToken,
    waitForImages: props.waitForImages,
    spatialIndex: props.spatialIndex,
    edgeSpatialIndex: props.edgeSpatialIndex,
    drawingSpatialIndex: props.drawingSpatialIndex
  }
}

function createGeometrySpatialIndex() {
  return createSpatialIndex([], {
    cellSize: GEOMETRY_INDEX_CELL_SIZE,
    getBounds: item => item
  })
}

function indexTaskGeometryEntity(task, kind, entity) {
  if (!task.geometryInteractive || !entity?.id) return
  const segments = editorLodIndexSegments(kind, entity, task.nodeIndex, {
    stageWidth: task.stageWidth,
    stageHeight: task.stageHeight,
    maxSegments: EDITOR_LOD_GEOMETRY_MAX_SEGMENTS
  })
  if (segments.length > EDITOR_LOD_GEOMETRY_MAX_SEGMENTS) {
    task.geometryIndexesComplete = false
    return
  }
  if (kind === 'drawing' && Array.isArray(entity.points) && entity.points.length >= 2 && !segments.length) {
    task.geometryIndexesComplete = false
    return
  }
  const index = kind === 'edge' ? task.edgeSpatialIndex : task.drawingSpatialIndex
  const ids = kind === 'edge' ? task.edgeSegmentIds : task.drawingSegmentIds
  for (const segment of segments) index.update(segment)
  ids.set(entity.id, segments.map(segment => segment.id))
}

function fillRenderBackground(ctx, background, stageWidth, stageHeight) {
  ctx.fillStyle = background || '#f7f8fa'
  ctx.fillRect(0, 0, stageWidth, stageHeight)
}

function initialEdgeRenderPhase(incrementalRuntime, edgeSourceCursor) {
  if (incrementalRuntime) return 'prepareStaticSurface'
  return edgeSourceCursor ? 'edgeQuery' : 'edges'
}

function createStaticRenderSurface(task) {
  const surface = acquireRenderSurface(task.bitmapWidth, task.bitmapHeight, task.reuseSurfaces)
  let ctx = null
  let contextSaved = false
  try {
    ctx = surface.getContext('2d')
    if (!ctx) {
      releaseRenderSurface(surface, false)
      return null
    }
    ctx.setTransform(task.pixelRatioX, 0, 0, task.pixelRatioY, 0, 0)
    ctx.clearRect(0, 0, task.width, task.height)
    ctx.save()
    contextSaved = true
    ctx.translate(task.offsetX, task.offsetY)
    ctx.scale(task.scaleX, task.scaleY)
    ctx.beginPath()
    ctx.rect(0, 0, task.stageWidth, task.stageHeight)
    ctx.clip()
    fillRenderBackground(ctx, task.background, task.stageWidth, task.stageHeight)
    return { surface, ctx }
  } catch (error) {
    if (contextSaved) {
      try { ctx.restore() } catch {}
    }
    releaseRenderSurface(surface, false)
    throw error
  }
}

function createViewBoxEntityCandidateWork(
  payload,
  viewBox,
  renderNodes,
  renderDrawings,
  excludedNodeIds,
  excludedDrawingIds
) {
  if (!viewBox) return null
  const sources = []
  if (renderNodes) {
    if (typeof payload.spatialIndex?.createQueryCursor !== 'function') return null
    sources.push({
      kind: 'node',
      cursor: payload.spatialIndex.createQueryCursor(viewBox, { sort: false })
    })
  }
  if (renderDrawings) {
    if (typeof payload.drawingSpatialIndex?.createQueryCursor !== 'function') return null
    sources.push({
      kind: 'drawing',
      cursor: payload.drawingSpatialIndex.createQueryCursor(viewBox, { sort: false })
    })
  }
  return createRuntimeCandidateCursor(createRuntimeQueryCursor(sources), {
    include(item) {
      if (item?.kind === 'node') return !excludedNodeIds.has(item.entity?.id)
      if (item?.kind === 'drawing') return !excludedDrawingIds.has(item.entity?.id)
      return false
    },
    compare: (left, right) => number(left?.entity?.layer) - number(right?.entity?.layer)
  })
}

function createRenderTask(payload, generation) {
  const width = Math.max(1, number(payload.width, 240))
  const height = Math.max(1, number(payload.height, 150))
  const stageWidth = Math.max(1, number(payload.stageWidth, 1))
  const stageHeight = Math.max(1, number(payload.stageHeight, 1))
  const maxBitmapPixels = Math.max(0, number(payload.maxBitmapPixels))
  const animationTimestamp = number(payload.animationTimestamp, currentAnimationTimestamp())
  const { bitmapWidth, bitmapHeight, pixelRatioX, pixelRatioY } = canvasBitmapDimensions({
    width,
    height,
    devicePixelRatio: payload.pixelRatio > 0 ? payload.pixelRatio : globalThis.devicePixelRatio,
    maximum: maxBitmapPixels
  })
  const reuseSurfaces = Boolean(payload.incrementalRuntime)
  const surface = acquireRenderSurface(bitmapWidth, bitmapHeight, reuseSurfaces)
  let ctx = null
  let contextSaved = false
  try {
    ctx = surface.getContext('2d')
    if (!payload.target || !ctx) {
      if (payload.target && !ctx) reportCanvasRenderError('surface-unavailable')
      return {
        valid: false,
        surface,
        reuseSurfaces: canReuseCanvasRenderSurface(reuseSurfaces, ctx)
      }
    }

    ctx.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const transform = miniMapTransform({
      stageWidth,
      stageHeight,
      width,
      height,
      fitMode: payload.fitMode,
      viewBox: payload.viewBox
    })
    const { scaleX, scaleY, offsetX, offsetY } = transform
    const worldPixel = 1 / Math.max(.0001, Math.min(scaleX, scaleY))
    const edgeSourceCursor = transform.viewBox && typeof payload.edgeSpatialIndex?.createQueryCursor === 'function'
      ? payload.edgeSpatialIndex.createQueryCursor(transform.viewBox, { sort: false })
      : null
    const edgeCount = Array.isArray(payload.edges) ? payload.edges.length : 0
    const edgeSourceCount = edgeSourceCursor
      ? Math.max(edgeCount, Math.max(0, Math.floor(number(payload.edgeSpatialIndex?.state?.entries))))
      : edgeCount
    ctx.save()
    contextSaved = true
    ctx.translate(offsetX, offsetY)
    ctx.scale(scaleX, scaleY)
    // 留白属于鹰眼容器，不属于图纸；这里只填充并裁切真实画布范围。
    ctx.beginPath()
    ctx.rect(0, 0, stageWidth, stageHeight)
    ctx.clip()
    if (!payload.incrementalRuntime) fillRenderBackground(ctx, payload.background, stageWidth, stageHeight)

    const sharedNodeIndex = payload.nodeIndex instanceof Map
    const renderNodes = payload.renderNodes !== false
    const renderDrawings = payload.renderDrawings !== false
    const excludedNodeIds = new Set(payload.excludedNodeIds || [])
    const excludedDrawingIds = new Set(payload.excludedDrawingIds || [])
    const entityCandidateWork = createViewBoxEntityCandidateWork(
      payload,
      transform.viewBox,
      renderNodes,
      renderDrawings,
      excludedNodeIds,
      excludedDrawingIds
    )
    return {
      valid: true,
      generation,
      target: payload.target,
      contextToken: payload.contextToken,
      surface,
      ctx,
      width,
      height,
      background: payload.background,
      bitmapWidth,
      bitmapHeight,
      pixelRatioX,
      pixelRatioY,
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      stageWidth,
      stageHeight,
      worldPixel,
      animationTimestamp,
      nodes: payload.nodes || [],
      edges: edgeSourceCursor ? [] : (payload.edges || []),
      edgeSourceCursor,
      drawings: payload.drawings || [],
      renderNodes,
      renderDrawings,
      nodeIndex: sharedNodeIndex ? payload.nodeIndex : new Map(),
      nodeIndexCursor: 0,
      edgeCursor: 0,
      entities: entityCandidateWork ? [] : (payload.orderedEntities || []),
      entityCandidateWork,
      usesSharedEntities: !entityCandidateWork && Array.isArray(payload.orderedEntities),
      excludedNodeIds,
      excludedDrawingIds,
      renderPlanKey: String(payload.renderPlanKey || ''),
      frameCommitToken: payload.frameCommitToken,
      viewBox: transform.viewBox || null,
      nodeEntityCursor: 0,
      drawingEntityCursor: 0,
      entityCursor: 0,
      textLayoutWork: null,
      timeEntities: [],
      animationNodes: [],
      animationCandidateIds: new Set(),
      imageUrls: new Set(),
      pendingImageUrls: new Set(),
      waitForImages: Boolean(payload.waitForImages),
      incrementalRuntime: Boolean(payload.incrementalRuntime),
      reuseSurfaces,
      geometryInteractive: Boolean(payload.geometryInteractive),
      geometrySessionId: payload.geometrySessionId ?? null,
      geometryRevision: number(payload.geometryRevision),
      edgeSpatialIndex: payload.geometryInteractive ? createGeometrySpatialIndex() : null,
      drawingSpatialIndex: payload.geometryInteractive ? createGeometrySpatialIndex() : null,
      edgeSegmentIds: new Map(),
      drawingSegmentIds: new Map(),
      geometryIndexesComplete: Boolean(payload.geometryInteractive),
      staticSurface: null,
      staticCtx: null,
      staticEdgeCursor: 0,
      staticEdgeWorkerEligible: Boolean(
        payload.incrementalRuntime
        && edgeSourceCount >= EDGE_RASTER_WORKER_THRESHOLD
      ),
      staticEdgeWorkerRequest: null,
      staticEdgeWorkerCursor: 0,
      staticEdgeWorkerCommands: [],
      sortBuffer: null,
      sortWidth: 1,
      sortStart: 0,
      sortMerge: null,
      phase: sharedNodeIndex ? initialEdgeRenderPhase(Boolean(payload.incrementalRuntime), edgeSourceCursor) : 'nodeIndex',
      contextRestored: false,
      contextRestoreFailed: false
    }
  } catch (error) {
    if (contextSaved) {
      try { ctx.restore() } catch {}
    }
    releaseRenderSurface(surface, false)
    throw error
  }
}

function prepareNodeIndex(task, deadline) {
  while (task.nodeIndexCursor < task.nodes.length) {
    const node = task.nodes[task.nodeIndexCursor]
    task.nodeIndexCursor += 1
    if (node?.id) task.nodeIndex.set(node.id, node)
    if (deadline.shouldYield()) return false
  }
  task.phase = initialEdgeRenderPhase(task.incrementalRuntime, task.edgeSourceCursor)
  return true
}

function beginEntityRenderPhase(task) {
  task.phase = task.entityCandidateWork
    ? 'queryEntities'
    : task.usesSharedEntities
      ? 'entities'
      : 'prepareEntities'
}

function finishEdgePass(task) {
  if (task.incrementalRuntime) {
    task.staticCtx.restore()
    task.staticCtx = null
    task.phase = 'composeStaticSurface'
    return
  }
  beginEntityRenderPhase(task)
}

function closeEdgeRasterBitmap(bitmap) {
  try { bitmap?.close?.() } catch {}
}

function resetTaskEdgeGeometryIndex(task) {
  task.edgeSpatialIndex?.clear?.()
  task.edgeSegmentIds.clear()
}

function fallbackStaticEdgeWorker(task) {
  task.staticEdgeWorkerRequest?.dispose()
  task.staticEdgeWorkerRequest = null
  task.staticEdgeWorkerEligible = false
  task.staticEdgeWorkerCommands.length = 0
  task.staticEdgeWorkerCursor = 0
  task.staticEdgeCursor = 0
  resetTaskEdgeGeometryIndex(task)
  task.phase = 'staticEdges'
  return true
}

function awaitStaticEdgeWorkerReady(task) {
  const status = task.staticEdgeWorkerRequest?.state.status
  if (status === 'starting') return false
  if (status !== 'ready') return fallbackStaticEdgeWorker(task)
  task.phase = 'staticEdgeWorkerBatch'
  return true
}

function prepareStaticEdgeWorkerBatch(task, deadline) {
  const request = task.staticEdgeWorkerRequest
  if (request?.state.status !== 'ready') return fallbackStaticEdgeWorker(task)
  while (
    task.edgeSourceCursor
    && task.staticEdgeWorkerCommands.length < EDGE_RASTER_WORKER_BATCH_SIZE
    && !deadline.shouldYield()
  ) {
    const result = task.edgeSourceCursor.runSlice({
      maxOperations: 256,
      shouldYield: () => (
        task.staticEdgeWorkerCommands.length >= EDGE_RASTER_WORKER_BATCH_SIZE
        || deadline.shouldYield()
      ),
      onMatch(edge) {
        task.edges.push(edge)
        task.staticEdgeWorkerCursor = task.edges.length
        const command = edgeRasterCommand(edge, task.worldPixel, task.nodeIndex)
        if (command) task.staticEdgeWorkerCommands.push(command)
        indexTaskGeometryEntity(task, 'edge', edge)
      }
    })
    if (result.done) task.edgeSourceCursor = null
    if (result.yielded || result.operations === 0) break
  }
  if (!task.edgeSourceCursor && task.staticEdgeWorkerCursor < task.edges.length) {
    while (
      task.staticEdgeWorkerCursor < task.edges.length
      && task.staticEdgeWorkerCommands.length < EDGE_RASTER_WORKER_BATCH_SIZE
    ) {
      const edge = task.edges[task.staticEdgeWorkerCursor]
      task.staticEdgeWorkerCursor += 1
      const command = edgeRasterCommand(edge, task.worldPixel, task.nodeIndex)
      if (command) task.staticEdgeWorkerCommands.push(command)
      indexTaskGeometryEntity(task, 'edge', edge)
      if (deadline.shouldYield()) break
    }
  }
  if (task.staticEdgeWorkerCommands.length) {
    const batch = packEdgeRasterCommands(task.staticEdgeWorkerCommands)
    task.staticEdgeWorkerCommands = []
    if (!request.sendBatch(batch)) return fallbackStaticEdgeWorker(task)
    task.phase = 'awaitStaticEdgeWorkerBatch'
    return false
  }
  if (task.edgeSourceCursor || task.staticEdgeWorkerCursor < task.edges.length) return false
  if (!request.finish()) return fallbackStaticEdgeWorker(task)
  task.phase = 'awaitStaticEdgeWorkerResult'
  return false
}

function awaitStaticEdgeWorkerBatch(task) {
  const status = task.staticEdgeWorkerRequest?.state.status
  if (status === 'batch') return false
  if (status !== 'ready') return fallbackStaticEdgeWorker(task)
  task.phase = 'staticEdgeWorkerBatch'
  return true
}

function restartStaticRenderSurface(task) {
  if (task.staticSurface) releaseRenderSurface(task.staticSurface, false)
  task.staticSurface = null
  task.staticCtx = null
  const prepared = createStaticRenderSurface(task)
  if (!prepared) return false
  task.staticSurface = prepared.surface
  task.staticCtx = prepared.ctx
  return true
}

function commitStaticEdgeWorkerResult(task) {
  const request = task.staticEdgeWorkerRequest
  const bitmap = request?.take() || null
  if (!bitmap) return fallbackStaticEdgeWorker(task)
  let copied = false
  try {
    task.staticCtx.restore()
    task.staticCtx.setTransform(1, 0, 0, 1, 0, 0)
    task.staticCtx.clearRect(0, 0, task.bitmapWidth, task.bitmapHeight)
    task.staticCtx.drawImage(bitmap, 0, 0)
    copied = true
  } catch {}
  closeEdgeRasterBitmap(bitmap)
  request.dispose()
  task.staticEdgeWorkerRequest = null
  task.staticCtx = null
  if (!copied) {
    if (!restartStaticRenderSurface(task)) {
      resetTaskEdgeGeometryIndex(task)
      task.incrementalRuntime = false
      fillRenderBackground(task.ctx, task.background, task.stageWidth, task.stageHeight)
      task.edgeCursor = 0
      task.phase = 'edges'
      return true
    }
    return fallbackStaticEdgeWorker(task)
  }
  task.phase = 'composeStaticSurface'
  return true
}

function awaitStaticEdgeWorkerResult(task) {
  const status = task.staticEdgeWorkerRequest?.state.status
  if (status === 'finishing') return false
  if (status !== 'complete') return fallbackStaticEdgeWorker(task)
  return commitStaticEdgeWorkerResult(task)
}

function queryAndDrawSpatialEdges(task, deadline) {
  const edgeContext = task.incrementalRuntime ? task.staticCtx : task.ctx
  const result = task.edgeSourceCursor.runSlice({
    maxOperations: 256,
    shouldYield: () => deadline.shouldYield(),
    onMatch(edge) {
      task.edges.push(edge)
      drawEdge(edgeContext, edge, task.worldPixel, task.nodeIndex)
      indexTaskGeometryEntity(task, 'edge', edge)
    }
  })
  if (result.done) task.edgeSourceCursor = null
  if (!result.done) return false
  finishEdgePass(task)
  return true
}

function prepareFallbackEntities(task, deadline) {
  while (task.nodeEntityCursor < task.nodes.length) {
    const entity = task.nodes[task.nodeEntityCursor]
    task.nodeEntityCursor += 1
    if (task.renderNodes && !task.excludedNodeIds.has(entity?.id)) task.entities.push({ kind: 'node', entity, layer: number(entity?.layer) })
    if (deadline.shouldYield()) return false
  }
  while (task.drawingEntityCursor < task.drawings.length) {
    const entity = task.drawings[task.drawingEntityCursor]
    task.drawingEntityCursor += 1
    if (task.renderDrawings && !task.excludedDrawingIds.has(entity?.id)) task.entities.push({ kind: 'drawing', entity, layer: number(entity?.layer) })
    if (deadline.shouldYield()) return false
  }
  task.sortBuffer = new Array(task.entities.length)
  task.phase = 'sortEntities'
  return true
}

function prepareViewBoxEntities(task, deadline) {
  const result = task.entityCandidateWork.runSlice(deadline, RUNTIME_CURSOR_OPERATION_LIMIT)
  if (!result.done) return false
  task.entities = task.entityCandidateWork.items
  task.entityCandidateWork = null
  task.entityCursor = 0
  task.phase = 'entities'
  return true
}

function sortFallbackEntities(task, deadline) {
  const length = task.entities.length
  if (length < 2 || task.sortWidth >= length) {
    task.phase = 'entities'
    return true
  }

  while (!deadline.shouldYield()) {
    if (task.sortStart >= length) {
      const previousEntities = task.entities
      task.entities = task.sortBuffer
      task.sortBuffer = previousEntities
      task.sortWidth *= 2
      task.sortStart = 0
      task.sortMerge = null
      if (task.sortWidth >= length) {
        task.phase = 'entities'
        return true
      }
    }

    if (!task.sortMerge) {
      const left = task.sortStart
      const middle = Math.min(left + task.sortWidth, length)
      const right = Math.min(left + task.sortWidth * 2, length)
      task.sortMerge = { left, middle, right, first: left, second: middle, output: left }
    }

    const merge = task.sortMerge
    while (merge.output < merge.right) {
      const takeFirst = merge.first < merge.middle && (
        merge.second >= merge.right || task.entities[merge.first].layer <= task.entities[merge.second].layer
      )
      task.sortBuffer[merge.output] = takeFirst ? task.entities[merge.first++] : task.entities[merge.second++]
      merge.output += 1
      if (deadline.shouldYield()) return false
    }
    task.sortStart += task.sortWidth * 2
    task.sortMerge = null
  }
  return false
}

function prepareStaticRenderSurface(task) {
  if (!task.incrementalRuntime) {
    task.phase = initialEdgeRenderPhase(false, task.edgeSourceCursor)
    return true
  }
  if (task.staticSurface) {
    task.phase = task.edgeSourceCursor ? 'edgeQuery' : 'staticEdges'
    return true
  }
  const prepared = createStaticRenderSurface(task)
  if (!prepared) {
    task.incrementalRuntime = false
    fillRenderBackground(task.ctx, task.background, task.stageWidth, task.stageHeight)
    task.phase = initialEdgeRenderPhase(false, task.edgeSourceCursor)
    return true
  }
  task.staticSurface = prepared.surface
  task.staticCtx = prepared.ctx
  if (task.staticEdgeWorkerEligible) {
    task.staticEdgeWorkerRequest = edgeRasterWorkerClient.start({
      bitmapWidth: task.bitmapWidth,
      bitmapHeight: task.bitmapHeight,
      width: task.width,
      height: task.height,
      pixelRatioX: task.pixelRatioX,
      pixelRatioY: task.pixelRatioY,
      scaleX: task.scaleX,
      scaleY: task.scaleY,
      offsetX: task.offsetX,
      offsetY: task.offsetY,
      stageWidth: task.stageWidth,
      stageHeight: task.stageHeight,
      background: task.background
    })
    if (task.staticEdgeWorkerRequest) {
      task.phase = 'awaitStaticEdgeWorkerReady'
      return true
    }
    task.staticEdgeWorkerEligible = false
  }
  task.phase = task.edgeSourceCursor ? 'edgeQuery' : 'staticEdges'
  return true
}

function drawStaticEdges(task, deadline) {
  task.staticEdgeCursor = drawEdges(
    task.staticCtx,
    task.edges,
    task.staticEdgeCursor,
    task.worldPixel,
    task.nodeIndex,
    deadline,
    task
  )
  if (task.staticEdgeCursor < task.edges.length) return false
  if (task.edgeSourceCursor) {
    task.phase = 'edgeQuery'
    return true
  }
  finishEdgePass(task)
  return true
}

function composeStaticRenderSurface(task) {
  let copied = false
  try {
    copied = commitCanvasSurface(task.ctx, task.staticSurface)
  } catch {}
  if (copied) {
    beginEntityRenderPhase(task)
    return true
  }

  task.incrementalRuntime = false
  if (task.staticSurface) releaseRenderSurface(task.staticSurface, task.reuseSurfaces)
  task.staticSurface = null
  fillRenderBackground(task.ctx, task.background, task.stageWidth, task.stageHeight)
  task.edgeCursor = 0
  task.phase = 'edges'
  return false
}

function collectTaskVisualAnimationNode(task, sourceNode) {
  if (!canvasVisualAnimationTypes.has(sourceNode?.type)) return
  const node = materializeRuntimeNode(sourceNode, runtimePointValue)
  if (!isCanvasVisualAnimationCandidate(node)) return
  task.animationCandidateIds.add(sourceNode.id ?? sourceNode)
  if (!isCanvasVisualAnimationNode(node)) return
  task.animationNodes.push(sourceNode)
}

function orderedTaskVisualAnimationNodes(task) {
  return (task.animationNodes || [])
    .slice()
    .sort((left, right) => number(right?.layer) - number(left?.layer))
}

function drawEntities(task, deadline) {
  while (task.entityCursor < task.entities.length) {
    const item = task.entities[task.entityCursor]
    if (item?.entity) {
      if (item.kind === 'node') {
        if (!task.renderNodes) {
          task.entityCursor += 1
          if (deadline.shouldYield()) return false
          continue
        }
        if (task.excludedNodeIds.has(item.entity.id)) {
          task.entityCursor += 1
          if (deadline.shouldYield()) return false
          continue
        }
        if (['image', 'customImageMotion'].includes(item.entity.type) && item.entity.imageUrl) {
          task.imageUrls.add(item.entity.imageUrl)
        }
        if (!drawEntityIncrementally(
          task,
          item.entity,
          task.scaleX,
          task.scaleY,
          task.worldPixel,
          'full',
          1,
          deadline
        )) return false
        if (item.entity.type === 'time') task.timeEntities.push(item.entity)
        collectTaskVisualAnimationNode(task, item.entity)
      }
      else {
        if (!task.renderDrawings) {
          task.entityCursor += 1
          if (deadline.shouldYield()) return false
          continue
        }
        if (task.excludedDrawingIds.has(item.entity.id)) {
          task.entityCursor += 1
          if (deadline.shouldYield()) return false
          continue
        }
        indexTaskGeometryEntity(task, 'drawing', item.entity)
        drawTemporaryDrawing(task.ctx, item.entity, task.worldPixel)
      }
    }
    task.entityCursor += 1
    if (deadline.shouldYield()) return false
  }
  task.ctx.restore()
  task.contextRestored = true
  task.phase = 'complete'
  return true
}

function runRenderSlice(task, deadline) {
  if (!task.valid) return true
  while (!deadline.shouldYield()) {
    if (task.phase === 'nodeIndex') {
      if (!prepareNodeIndex(task, deadline)) return false
      continue
    }
    if (task.phase === 'prepareStaticSurface') {
      prepareStaticRenderSurface(task)
      if (deadline.shouldYield()) return false
      continue
    }
    if (task.phase === 'edgeQuery') {
      if (!queryAndDrawSpatialEdges(task, deadline)) return false
      continue
    }
    if (task.phase === 'awaitStaticEdgeWorkerReady') {
      if (!awaitStaticEdgeWorkerReady(task)) return false
      continue
    }
    if (task.phase === 'staticEdgeWorkerBatch') {
      if (!prepareStaticEdgeWorkerBatch(task, deadline)) return false
      continue
    }
    if (task.phase === 'awaitStaticEdgeWorkerBatch') {
      if (!awaitStaticEdgeWorkerBatch(task)) return false
      continue
    }
    if (task.phase === 'awaitStaticEdgeWorkerResult') {
      if (!awaitStaticEdgeWorkerResult(task)) return false
      continue
    }
    if (task.phase === 'edges') {
      task.edgeCursor = drawEdges(task.ctx, task.edges, task.edgeCursor, task.worldPixel, task.nodeIndex, deadline, task)
      if (task.edgeCursor < task.edges.length) return false
      if (task.edgeSourceCursor) {
        task.phase = 'edgeQuery'
        continue
      }
      finishEdgePass(task)
      continue
    }
    if (task.phase === 'staticEdges') {
      if (!drawStaticEdges(task, deadline)) return false
      continue
    }
    if (task.phase === 'composeStaticSurface') {
      composeStaticRenderSurface(task)
      if (deadline.shouldYield()) return false
      continue
    }
    if (task.phase === 'queryEntities') {
      if (!prepareViewBoxEntities(task, deadline)) return false
      continue
    }
    if (task.phase === 'prepareEntities') {
      if (!prepareFallbackEntities(task, deadline)) return false
      continue
    }
    if (task.phase === 'sortEntities') {
      if (!sortFallbackEntities(task, deadline)) return false
      continue
    }
    if (task.phase === 'entities') return drawEntities(task, deadline)
    return task.phase === 'complete'
  }
  return false
}

function releaseRenderTask(task, _payload, reason) {
  if (!task) return
  task.staticEdgeWorkerRequest?.dispose()
  task.staticEdgeWorkerRequest = null
  task.staticEdgeWorkerCommands = []
  task.textLayoutWork = null
  task.entityCandidateWork = null
  task.animationNodes = []
  task.animationCandidateIds?.clear?.()
  const contextsRestored = restoreCanvasRenderTaskContexts(task)
  const reuseSurfaces = task.reuseSurfaces && contextsRestored && reason !== 'error' && task.surfaceReusable !== false
  if (task.surface) {
    releaseRenderSurface(task.surface, reuseSurfaces)
  }
  if (task.staticSurface) {
    releaseRenderSurface(task.staticSurface, reuseSurfaces)
  }
  task.ctx = null
  task.staticCtx = null
  task.surface = null
  task.staticSurface = null
  task.edgeSpatialIndex?.clear?.()
  task.drawingSpatialIndex?.clear?.()
  task.edgeSpatialIndex = null
  task.drawingSpatialIndex = null
}

function replaceCommittedStaticSurface(surface, frame = null) {
  if (committedStaticSurface && committedStaticSurface !== surface) {
    releaseRenderSurface(committedStaticSurface, true)
  }
  committedStaticSurface = surface || null
  committedStaticFrame = surface && frame ? frame : null
}

function releaseRuntimeBackSurface() {
  const surface = runtimeBackSurface
  runtimeBackSurface = null
  runtimeBackSyncRects = []
  if (surface) releaseRenderSurface(surface, true)
}

function takeRuntimeBackSurface(frame) {
  const surface = runtimeBackSurface
  const syncRects = runtimeBackSyncRects
  runtimeBackSurface = null
  runtimeBackSyncRects = []
  if (!surface) return null
  if (surface.width !== frame?.bitmapWidth || surface.height !== frame?.bitmapHeight) {
    releaseRenderSurface(surface, true)
    return null
  }
  return { surface, syncRects }
}

function replaceCommittedCompositeSurface(surface) {
  releaseRuntimeBackSurface()
  if (committedCompositeSurface && committedCompositeSurface !== surface) {
    releaseRenderSurface(committedCompositeSurface, true)
  }
  committedCompositeSurface = surface || null
}

function swapCommittedCompositeSurface(surface, dirtyRects) {
  if (!surface) return replaceCommittedCompositeSurface(null)
  const previous = committedCompositeSurface
  releaseRuntimeBackSurface()
  committedCompositeSurface = surface
  if (previous && previous !== surface) {
    runtimeBackSurface = previous
    runtimeBackSyncRects = (Array.isArray(dirtyRects) ? dirtyRects : []).map(rect => ({ ...rect }))
  }
}

function replaceCommittedGeometryIndexes(edgeIndex, drawingIndex, edgeIds = new Map(), drawingIds = new Map(), complete = false) {
  if (committedEdgeSpatialIndex && committedEdgeSpatialIndex !== edgeIndex) committedEdgeSpatialIndex.clear?.()
  if (committedDrawingSpatialIndex && committedDrawingSpatialIndex !== drawingIndex) committedDrawingSpatialIndex.clear?.()
  committedEdgeSpatialIndex = edgeIndex || null
  committedDrawingSpatialIndex = drawingIndex || null
  committedEdgeSegmentIds = edgeIds
  committedDrawingSegmentIds = drawingIds
  committedGeometryIndexesComplete = Boolean(edgeIndex && drawingIndex && complete)
}

function fullRenderCompletion(task, pendingFull = false) {
  const pendingRuntime = runtimeRenderDirty || runtimeRenderFollowUpPending()
  const pendingImages = task.pendingImageUrls?.size || 0
  return {
    generation: Math.max(committedGeneration.value + 1, task.generation),
    renderGeneration: task.generation,
    kind: 'full',
    settled: !pendingFull && !pendingRuntime && pendingImages === 0,
    pendingFull,
    pendingRuntime,
    pendingImages,
    renderPlanKey: task.renderPlanKey,
    frameCommitToken: task.frameCommitToken,
    viewBox: task.viewBox ? { ...task.viewBox } : null,
    width: task.width,
    height: task.height,
    pixelRatioX: task.pixelRatioX,
    pixelRatioY: task.pixelRatioY,
    excludedNodeIds: [...task.excludedNodeIds],
    excludedDrawingIds: [...task.excludedDrawingIds],
    geometrySessionId: task.geometrySessionId,
    geometryRevision: task.geometryRevision,
    bitmapWidth: task.bitmapWidth,
    bitmapHeight: task.bitmapHeight,
    animationTimestamp: task.animationTimestamp
  }
}

function frameCommitAccepted(event) {
  if (typeof props.frameCommitGuard !== 'function') return true
  try {
    return props.frameCommitGuard(event) === true
  } catch (error) {
    reportCanvasRenderError('frame-commit-guard-failed', error, true)
    return false
  }
}

function startGeometryFullRender(session) {
  if (!session || geometryInteraction !== session || session.state !== 'awaiting-full') return null
  session.fullDirty = false
  session.refreshQueued = false
  const generation = startFullRender({
    geometrySessionId: session.id,
    geometryRevision: session.revision
  })
  if (!Number.isInteger(generation) || generation <= 0) {
    geometryInteraction = null
    reportCanvasRenderError('geometry-render-unavailable', null, true)
    return null
  }
  session.targetFullGeneration = generation
  return generation
}

function queueGeometryFullRefresh(session) {
  if (!session || session.state !== 'awaiting-full' || session.refreshQueued) return
  session.refreshQueued = true
  queueRenderMicrotask(() => {
    if (geometryInteraction !== session || session.state !== 'awaiting-full') return
    session.refreshQueued = false
    if (session.fullDirty) startGeometryFullRender(session)
  })
}

function commitRenderTask(task) {
  const target = task?.target
  if (!task?.valid || !target || target !== canvas.value) {
    releaseRenderTask(task)
    return
  }
  const waitingGeometry = geometryInteraction
  if (waitingGeometry && (
    waitingGeometry.state !== 'awaiting-full'
    || task.geometrySessionId !== waitingGeometry.id
    || task.generation < waitingGeometry.targetFullGeneration
    || task.geometryRevision < waitingGeometry.revision
  )) {
    releaseRenderTask(task)
    return
  }
  const completesGeometry = Boolean(waitingGeometry)
  if (waitingGeometry && (waitingGeometry.fullDirty || coalescedRenderDirty)) {
    releaseRenderTask(task)
    coalescedRenderDirty = false
    startGeometryFullRender(waitingGeometry)
    return
  }
  if (!waitingGeometry && coalescedRenderDirty) {
    releaseRenderTask(task)
    coalescedRenderDirty = false
    scheduleRender()
    return
  }
  const completion = fullRenderCompletion(task)
  if (task.waitForImages && completion.pendingImages > 0) {
    // 私有绘制面仍含占位像素时不覆盖可见帧；最后一张图片结算后再统一重绘。
    deferredImageUrls = new Set(
      [...task.pendingImageUrls].filter(url => {
        const image = imageCache.get(url)
        return image && !cachedImageSettled(image)
      })
    )
    releaseRenderTask(task)
    emit('render-rejected', completion)
    if (!deferredImageUrls.size) requestImageRender()
    return
  }
  if (task.waitForImages) deferredImageUrls.clear()
  if (!frameCommitAccepted(completion)) {
    releaseRenderTask(task)
    emit('render-rejected', completion)
    return
  }
  let nextStaticSurface = null
  let nextCompositeSurface = null
  let nextEdgeSpatialIndex = null
  let nextDrawingSpatialIndex = null
  let nextEdgeSegmentIds = new Map()
  let nextDrawingSegmentIds = new Map()
  let nextGeometryIndexesComplete = false
  let committed = false
  const retainIncrementalSurfaces = task.incrementalRuntime && (
    task.renderNodes
    || task.renderDrawings
    || task.geometryInteractive
  )
  const nextVisualAnimationNodes = retainIncrementalSurfaces
    ? orderedTaskVisualAnimationNodes(task)
    : []
  const nextVisualAnimationCandidateIds = retainIncrementalSurfaces
    ? new Set(task.animationCandidateIds)
    : new Set()
  try {
    if (!restoreCanvasRenderTaskContexts(task)) throw new Error('render task context restore failed')
    const targetContext = target.getContext('2d')
    if (!canvasContextGate.accepts(task.contextToken, target, targetContext)) {
      reportCanvasRenderError(canvasContextGate.state().lost ? 'context-lost' : 'context-unavailable')
      return
    }
    if (!commitCanvasSurfaceWithResize(target, task.surface, {
      context: targetContext,
      acceptContext: context => canvasContextGate.accepts(task.contextToken, target, context),
      createBackup: (width, height) => acquireRenderSurface(width, height, true),
      releaseBackup: surface => releaseRenderSurface(surface, true)
    })) throw new Error('render surface commit failed')
    if (retainIncrementalSurfaces && task.staticSurface) {
      nextStaticSurface = task.staticSurface
      task.staticSurface = null
    }
    if (retainIncrementalSurfaces && task.surface) {
      nextCompositeSurface = task.surface
      task.surface = null
    }
    if (task.geometryInteractive) {
      nextEdgeSpatialIndex = task.edgeSpatialIndex
      nextDrawingSpatialIndex = task.drawingSpatialIndex
      nextEdgeSegmentIds = task.edgeSegmentIds
      nextDrawingSegmentIds = task.drawingSegmentIds
      nextGeometryIndexesComplete = task.geometryIndexesComplete
      task.edgeSpatialIndex = null
      task.drawingSpatialIndex = null
    }
    committed = true
  } catch (error) {
    task.surfaceReusable = false
    reportCanvasRenderError('commit-failed', error)
  } finally {
    releaseRenderTask(task)
  }
  if (!committed) return
  reportedCanvasErrorEpoch = -1

  pruneImageCache(task.imageUrls)

  replaceCommittedCompositeSurface(nextCompositeSurface)
  replaceCommittedGeometryIndexes(
    nextEdgeSpatialIndex,
    nextDrawingSpatialIndex,
    nextEdgeSegmentIds,
    nextDrawingSegmentIds,
    nextGeometryIndexesComplete
  )
  replaceCommittedStaticSurface(nextStaticSurface, nextStaticSurface ? {
    generation: task.generation,
    width: task.width,
    height: task.height,
    bitmapWidth: task.bitmapWidth,
    bitmapHeight: task.bitmapHeight,
    pixelRatioX: task.pixelRatioX,
    pixelRatioY: task.pixelRatioY,
    scaleX: task.scaleX,
    scaleY: task.scaleY,
    offsetX: task.offsetX,
    offsetY: task.offsetY,
    stageWidth: task.stageWidth,
    stageHeight: task.stageHeight,
    renderNodes: task.renderNodes,
    renderDrawings: task.renderDrawings,
    viewBox: task.viewBox ? { ...task.viewBox } : null,
    renderPlanKey: task.renderPlanKey,
    animationTimestamp: task.animationTimestamp,
    frameCommitToken: task.frameCommitToken
  } : null)
  committedTimeNodes = task.timeEntities
  committedVisualAnimationNodes = nextVisualAnimationNodes
  committedVisualAnimationNodeMap = new Map(
    nextVisualAnimationNodes.map(node => [node.id ?? node, node])
  )
  commitSignalLightColors(nextVisualAnimationNodes, task.animationTimestamp, true)
  if (typeof resetVisualAnimationFramePacing === 'function') resetVisualAnimationFramePacing()
  visualAnimationViewportDirty = true
  visualAnimationTimeline.retain(nextVisualAnimationCandidateIds)
  committedExcludedNodeIds = task.excludedNodeIds
  committedExcludedDrawingIds = task.excludedDrawingIds
  if (pendingRuntimeNodes.size) {
    syncRuntimeVisualAnimationNodes([...pendingRuntimeNodes.values()])
  }

  committedGeneration.value = completion.generation
  committedCssWidth.value = task.width
  committedCssHeight.value = task.height
  committedRenderPlanKey.value = task.renderPlanKey
  renderReady.value = true
  if (task.target?.dataset) {
    task.target.dataset.visualAnimationNodes = String(nextVisualAnimationNodes.length)
  }
  syncVisualAnimationClock()
  emit('render-complete', completion)
  if (completesGeometry && geometryInteraction?.id === waitingGeometry.id) {
    if (waitingGeometry.fullDirty || coalescedRenderDirty) {
      coalescedRenderDirty = false
      startGeometryFullRender(waitingGeometry)
      return
    }
    geometryInteraction = null
    emit('geometry-complete', {
      sessionId: waitingGeometry.id,
      mode: waitingGeometry.mode,
      geometryRevision: waitingGeometry.revision,
      renderGeneration: task.generation,
      renderPlanKey: task.renderPlanKey,
      viewBox: task.viewBox ? { ...task.viewBox } : null
    })
  }
  if (coalescedRenderDirty) {
    coalescedRenderDirty = false
    scheduleRender()
    return
  }
  if (pendingRuntimeDense || pendingRuntimeNodes.size) scheduleRuntimeRender()
}

const renderScheduler = createChunkedRenderScheduler({
  budgetMs: () => normalizedRenderSliceBudgetMs(props.renderBudgetMs),
  schedule: scheduleRenderSlice,
  cancel: cancelRenderSlice,
  createTask: createRenderTask,
  runSlice: runRenderSlice,
  commit: commitRenderTask,
  discard: releaseRenderTask,
  onError: (error, detail) => reportCanvasRenderError(`render-${detail.phase}-failed`, error)
})

let coalescedRenderDirty = false
let runtimeRenderEpoch = 0
let runtimeRenderDirty = false
let pendingRuntimeDense = false
let runtimeDenseStreamOpen = false
let runtimeDenseStreamStarted = false
let runtimeDenseStreamTimer = 0
let pendingRuntimeNodes = new Map()
let pendingVisualAnimationTimestamp = null

function runtimeRenderFollowUpPending() {
  return pendingRuntimeDense || runtimeDenseStreamOpen || pendingRuntimeNodes.size > 0
}

function takePendingRuntimeNodeBatch(limit = RUNTIME_RENDER_NODE_BATCH_SIZE) {
  const nodes = []
  for (const [key, node] of pendingRuntimeNodes) {
    nodes.push(node)
    pendingRuntimeNodes.delete(key)
    if (nodes.length >= limit) break
  }
  return nodes
}

function clearRuntimeDenseStreamTimer() {
  if (!runtimeDenseStreamTimer) return
  globalThis.clearTimeout(runtimeDenseStreamTimer)
  runtimeDenseStreamTimer = 0
}

function queueRuntimeDenseStreamFlush() {
  if (!runtimeDenseStreamOpen || runtimeDenseStreamTimer) return
  runtimeDenseStreamTimer = globalThis.setTimeout(() => {
    runtimeDenseStreamTimer = 0
    if (!runtimeDenseStreamOpen || (!pendingRuntimeDense && !pendingRuntimeNodes.size && !runtimeRenderDirty)) return
    pendingRuntimeDense = true
    runtimeDenseStreamStarted = false
    runtimeRenderDirty = true
    scheduleRuntimeRender()
  }, RUNTIME_DENSE_STREAM_MAX_WAIT_MS)
}

function runtimeRenderRequest(source) {
  const descriptor = source && !Array.isArray(source) && Array.isArray(source.nodes)
    ? source
    : null
  return {
    nodes: descriptor ? descriptor.nodes : source,
    dense: descriptor?.dense === true,
    pending: descriptor?.pending === true,
    stream: Boolean(descriptor && ('dense' in descriptor || 'pending' in descriptor))
  }
}

function updateRuntimeDenseStream(request) {
  if (request.dense) pendingRuntimeDense = true
  if (!request.stream) return
  if (request.pending) {
    if (!runtimeDenseStreamOpen) runtimeDenseStreamStarted = false
    runtimeDenseStreamOpen = true
    return
  }
  if (!runtimeDenseStreamOpen) return
  runtimeDenseStreamOpen = false
  runtimeDenseStreamStarted = false
  pendingRuntimeDense = true
  clearRuntimeDenseStreamTimer()
}

function resolveChangedRuntimeNodes(source) {
  if (source == null) return []
  const values = Array.isArray(source)
    ? source
    : typeof source !== 'string' && typeof source?.[Symbol.iterator] === 'function'
      ? [...source]
      : [source]
  const resolved = []
  const seen = new Set()
  for (const candidate of values) {
    const node = candidate && typeof candidate === 'object' ? candidate : props.nodeIndex?.get?.(candidate)
    const key = node?.id ?? node
    if (!node || committedExcludedNodeIds.has(key) || seen.has(key) || !hasIncrementalRuntimeVisual(node)) continue
    if (committedStaticFrame && !runtimeNodeBitmapRect(node, committedStaticFrame)) continue
    seen.add(key)
    resolved.push(node)
  }
  return resolved
}

function invalidateIncrementalRuntime() {
  runtimeRenderEpoch += 1
  runtimeRenderDirty = false
  pendingRuntimeDense = false
  runtimeDenseStreamOpen = false
  runtimeDenseStreamStarted = false
  clearRuntimeDenseStreamTimer()
  pendingRuntimeNodes.clear()
  pendingVisualAnimationTimestamp = null
  resetVisualAnimationFramePacing()
}

function canIncrementRuntime() {
  return Boolean(
    props.active
    && props.incrementalRuntime
    && committedStaticSurface
    && committedStaticFrame
    && committedStaticFrame.renderNodes
    && committedCompositeSurface
    && canvas.value
    && typeof props.spatialIndex?.createQueryCursor === 'function'
    && (!committedStaticFrame.renderDrawings || !props.drawings.length || typeof props.drawingSpatialIndex?.createQueryCursor === 'function')
    && !renderScheduler.state.pending
    && !geometryInteraction
  )
}

function fullRuntimeSeedRect(frame) {
  return [{
    x: 0,
    y: 0,
    w: Math.max(1, Math.floor(Number(frame?.bitmapWidth) || 1)),
    h: Math.max(1, Math.floor(Number(frame?.bitmapHeight) || 1))
  }]
}

function bitmapRectContains(outer, inner) {
  if (!outer || !inner) return false
  return number(outer.x) <= number(inner.x)
    && number(outer.y) <= number(inner.y)
    && number(outer.x) + Math.max(0, number(outer.w)) >= number(inner.x) + Math.max(0, number(inner.w))
    && number(outer.y) + Math.max(0, number(outer.h)) >= number(inner.y) + Math.max(0, number(inner.h))
}

function createRuntimeRenderTask(payload, generation) {
  const taskStartedAt = currentAnimationTimestamp()
  const frame = payload.frame
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : []
  const entities = Array.isArray(payload.entities) ? payload.entities : null
  const allowDense = payload.allowDense !== false
  const changedNodeCount = Math.max(nodes.length, Math.floor(Number(payload.nodeCount) || 0))
  const animationTimestamp = number(payload.animationTimestamp, currentAnimationTimestamp())
  const visualAnimationFrame = payload.visualAnimationFrame === true
  const visualAnimationNodeCount = visualAnimationFrame
    ? Math.max(1, Math.floor(Number(payload.visualAnimationNodeCount) || changedNodeCount || 1))
    : 0
  const visualAnimationVisibleCount = visualAnimationFrame
    ? Math.max(visualAnimationNodeCount, Math.floor(Number(payload.visualAnimationVisibleCount) || 0))
    : 0
  const visualAtlasDirectRect = payload.visualAtlasDirectRect || null
  const visualAtlasDirectFrame = payload.visualAtlasDirectFrame || null
  const visualAtlasDirect = Boolean(
    visualAnimationFrame
    && visualAtlasDirectRect
    && visualAtlasDirectFrame
    && nodes.length >= RUNTIME_VISUAL_ATLAS_MIN_INSTANCES
  )
  const signalLightColors = new Map()
  if (!visualAtlasDirect) {
    for (const sourceNode of nodes) {
      if (sourceNode?.type !== 'signalLight') continue
      const node = materializeRuntimeNode(sourceNode, runtimePointValue)
      const resolvedTimestamp = isCanvasVisualAnimationCandidate(node)
        ? visualAnimationTimeline.resolve(node, animationTimestamp)
        : animationTimestamp
      signalLightColors.set(
        visualAnimationNodeKey(sourceNode),
        signalLightColor(node, resolvedTimestamp)
      )
    }
  }
  const dense = allowDense && Boolean(entities) && (
    payload.dense === true
    || (!visualAnimationFrame && shouldUseDenseRuntime({
      available: true,
      nodeCount: changedNodeCount
    }))
  )
  const frontComposite = payload.composite
  const back = frame && frontComposite ? takeRuntimeBackSurface(frame) : null
  const preserveDirectComposite = visualAtlasDirectFrame?.preserveCompositeBase === true
  const seedRects = dense || !back
    ? fullRuntimeSeedRect(frame)
    : visualAtlasDirect && !preserveDirectComposite
      ? back.syncRects.filter(rect => !bitmapRectContains(visualAtlasDirectRect, rect))
      : back.syncRects
  const regionAccumulator = createRuntimeRegionAccumulator({
    stageWidth: frame?.stageWidth,
    stageHeight: frame?.stageHeight,
    padding: 2,
    mergeCellSize: RUNTIME_REGION_MERGE_SIZE
  })
  const task = {
    valid: Boolean(
      (nodes.length || dense)
      && frame
      && frontComposite
      && payload.base
      && payload.epoch === runtimeRenderEpoch
      && payload.base === committedStaticSurface
      && frontComposite === committedCompositeSurface
      && payload.excludedNodeIds === committedExcludedNodeIds
      && payload.excludedDrawingIds === committedExcludedDrawingIds
      && payload.target === canvas.value
      && payload.contextToken?.target === payload.target
      && typeof payload.spatialIndex?.createQueryCursor === 'function'
      && (!payload.hasDrawings || typeof payload.drawingSpatialIndex?.createQueryCursor === 'function')
    ),
    epoch: payload.epoch,
    generation,
    animationTimestamp,
    visualAnimationFrame,
    visualAnimationNodeCount,
    visualAnimationVisibleCount,
    visualAtlasDirect,
    visualAtlasDirectFrame: visualAtlasDirect ? visualAtlasDirectFrame : null,
    visualAtlasDirectItems: visualAtlasDirect
      ? nodes
          .slice()
          .map(node => ({ kind: 'node', entity: node }))
      : null,
    visualAnimationStartedAt: visualAnimationFrame ? taskStartedAt : 0,
    visualAnimationActiveWorkMs: visualAnimationFrame
      ? Math.max(0, number(payload.visualAnimationPreparationMs))
      : 0,
    signalLightColors,
    allowDense,
    target: payload.target,
    contextToken: payload.contextToken,
    base: payload.base,
    frontComposite,
    composite: back?.surface || null,
    frame,
    spatialIndex: payload.spatialIndex,
    drawingSpatialIndex: payload.drawingSpatialIndex,
    hasDrawings: payload.hasDrawings === true,
    renderNodes: frame?.renderNodes !== false,
    renderDrawings: frame?.renderDrawings !== false,
    ctx: null,
    nodes,
    changedNodeCount,
    entities,
    entityCursor: 0,
    textLayoutWork: null,
    visualSpriteCache: visualAnimationFrame ? new Map() : null,
    visualSpritePixelCount: 0,
    visualSpriteSurfaceCount: 0,
    visualSpriteRasterCount: 0,
    visualSpriteBlitCount: 0,
    visualAnimationSignatureCache: visualAnimationFrame ? new Map() : null,
    visualAnimationSignatureCacheHits: 0,
    visualAnimationSignatureCacheMisses: 0,
    visualAtlasAttempted: false,
    visualAtlasMode: '',
    visualAtlasItems: null,
    visualAtlasTopology: null,
    visualAtlasInstanceSources: null,
    visualAtlasPendingTopology: null,
    visualAtlasCursor: 0,
    visualAtlasCommands: [],
    visualAtlasLayerItems: [],
    visualAtlasPassthroughCount: 0,
    visualAtlasMinimumInstances: 0,
    visualAtlasUniqueCommands: null,
    visualAtlasStableSlots: true,
    visualAtlasEntries: [],
    visualAtlasRasterCursor: 0,
    visualAtlasCompositeCursor: 0,
    visualAtlasCompositePrepared: false,
    visualAtlasRasterDrawCount: 0,
    visualAtlasSlotCacheHits: 0,
    visualAtlasSlotCacheMisses: 0,
    visualAtlasPlan: null,
    visualAtlasFrame: null,
    visualAtlasFrameCacheHit: false,
    visualAtlasInstances: null,
    visualAtlasBlitData: null,
    visualAtlasOutputRect: null,
    visualAtlasUsed: false,
    visualAtlasBackend: '',
    visualAtlasFallbackCount: 0,
    visualAtlasFailureReason: '',
    visualAtlasInstanceCount: 0,
    visualAtlasSpriteCount: 0,
    visualAtlasPixels: 0,
    visualAtlasRawPixels: 0,
    visualAtlasWidth: 0,
    visualAtlasHeight: 0,
    visualAtlasOutputPixels: 0,
    visualAtlasPrepareMs: 0,
    visualAtlasRasterMs: 0,
    visualAtlasUploadMs: 0,
    visualAtlasDrawMs: 0,
    visualAtlasValidationMs: 0,
    visualAtlasCompositeMs: 0,
    visualDescriptorCacheHits: 0,
    visualDescriptorCacheMisses: 0,
    visualDescriptorCacheBypasses: 0,
    mode: dense ? 'dense' : 'sparse',
    seededFromBase: false,
    seedSource: dense ? payload.base : frontComposite,
    seedRects,
    seedRectCursor: 0,
    seedRectY: 0,
    excludedNodeIds: payload.excludedNodeIds,
    excludedDrawingIds: payload.excludedDrawingIds,
    nodeCursor: 0,
    regionAccumulator,
    coverageTracker: createRuntimeBitmapCoverageTracker({
      bitmapWidth: frame?.bitmapWidth,
      bitmapHeight: frame?.bitmapHeight
    }),
    measuredRegionCount: 0,
    measuredRegions: [],
    measuredBitmapRects: visualAtlasDirect ? [{ ...visualAtlasDirectRect }] : [],
    visualDenseRequested: false,
    regionCursor: null,
    bitmapRects: [],
    region: null,
    bitmapRect: null,
    candidateProbe: null,
    candidateProbeCount: 0,
    candidateWork: null,
    candidates: [],
    candidateCursor: 0,
    regionContextSaved: false,
    denseContextSaved: false,
    partialDense: false,
    unionRegionDraw: false,
    phase: 'regions'
  }
  if (visualAnimationFrame) {
    task.visualAnimationActiveWorkMs += Math.max(0, currentAnimationTimestamp() - taskStartedAt)
  }
  return task
}

function seedRuntimeRenderSurface(task, deadline) {
  if (!task.composite) {
    task.composite = acquireRenderSurface(task.frame.bitmapWidth, task.frame.bitmapHeight, true)
  }
  if (!task.ctx) {
    task.ctx = task.composite?.getContext('2d') || null
  }
  if (!task.ctx) {
    task.valid = false
    task.surfaceReusable = false
    reportCanvasRenderError('runtime-surface-unavailable')
    return true
  }
  const source = task.seedSource
  if (!source) return true
  try {
    task.ctx.setTransform(1, 0, 0, 1, 0, 0)
    task.ctx.globalCompositeOperation = 'source-over'
    while (task.seedRectCursor < task.seedRects.length) {
      const rect = task.seedRects[task.seedRectCursor]
      const stripHeight = Math.max(1, Math.floor(RUNTIME_SURFACE_SEED_STRIP_PIXELS / Math.max(1, rect.w)))
      const y = rect.y + task.seedRectY
      const height = Math.min(stripHeight, rect.h - task.seedRectY)
      task.ctx.clearRect(rect.x, y, rect.w, height)
      task.ctx.drawImage(
        source,
        rect.x,
        y,
        rect.w,
        height,
        rect.x,
        y,
        rect.w,
        height
      )
      task.seedRectY += height
      if (task.seedRectY >= rect.h) {
        task.seedRectCursor += 1
        task.seedRectY = 0
      }
      if (deadline.shouldYield()) return false
    }
    task.seededFromBase = source === task.base
    task.seedSource = null
    task.seedRects = []
    task.seedRectCursor = 0
    task.seedRectY = 0
    return true
  } catch (error) {
    try { task.ctx.globalCompositeOperation = 'source-over' } catch {}
    task.valid = false
    task.surfaceReusable = false
    reportCanvasRenderError('runtime-surface-initialize-failed', error)
    return true
  }
}

function resetRuntimeSurfaceSeed(task, source, rects = fullRuntimeSeedRect(task.frame)) {
  task.seedSource = source
  task.seedRects = rects
  task.seedRectCursor = 0
  task.seedRectY = 0
  task.seededFromBase = false
}

function prepareRuntimeRegions(task, deadline) {
  if (task.visualAtlasDirect) {
    task.nodes = []
    task.regionAccumulator = null
    if (beginCanvasVisualAtlasAttempt(task, task.visualAtlasDirectItems, 'direct')) return true
    task.candidates = task.visualAtlasDirectItems || []
    task.candidateCursor = 0
    beginRuntimeUnionDraw(task)
    return true
  }
  if (task.mode === 'dense') {
    task.nodes = []
    task.regionAccumulator = null
    beginDenseRuntimeDraw(task)
    return true
  }
  while (task.nodeCursor < task.nodes.length) {
    task.regionAccumulator.add(task.nodes[task.nodeCursor])
    task.nodeCursor += 1
    if (deadline.shouldYield()) return false
  }
  task.valid = task.valid && task.regionAccumulator.size > 0
  if (task.valid) task.regionCursor = task.regionAccumulator.createCursor()
  task.nodes = []
  task.phase = 'measure'
  return true
}

function runtimeRegionsOverlap(left, right) {
  return left.x <= right.x + right.w
    && right.x <= left.x + left.w
    && left.y <= right.y + right.h
    && right.y <= left.y + left.h
}

function mergeOverlappingRuntimeRegions(regions) {
  const merged = []
  for (const source of regions || []) {
    if (!source) continue
    const region = { ...source }
    let index = 0
    while (index < merged.length) {
      const previous = merged[index]
      if (!runtimeRegionsOverlap(previous, region)) {
        index += 1
        continue
      }
      const right = Math.max(region.x + region.w, previous.x + previous.w)
      const bottom = Math.max(region.y + region.h, previous.y + previous.h)
      region.x = Math.min(region.x, previous.x)
      region.y = Math.min(region.y, previous.y)
      region.w = right - region.x
      region.h = bottom - region.y
      merged.splice(index, 1)
      index = 0
    }
    merged.push(region)
  }
  return merged
}

function beginDenseRuntimeDraw(task) {
  if (!task.entities) {
    task.valid = false
    task.phase = 'complete'
    return
  }
  task.mode = 'dense'
  task.regionAccumulator = null
  task.regionCursor = null
  task.region = null
  task.bitmapRect = null
  task.candidateProbe = null
  task.candidateProbeCount = 0
  task.candidateWork = null
  task.candidates = []
  task.candidateCursor = 0
  const preserveVisualRegions = task.visualAnimationFrame && task.measuredBitmapRects.length > 0
  task.partialDense = preserveVisualRegions
  if (!preserveVisualRegions) {
    task.measuredRegions = []
    task.measuredBitmapRects = []
  }
  task.unionRegionDraw = false
  if (!task.seededFromBase) {
    if (task.seedSource !== task.base) {
      resetRuntimeSurfaceSeed(
        task,
        task.base,
        preserveVisualRegions ? task.measuredBitmapRects.slice() : fullRuntimeSeedRect(task.frame)
      )
    }
    task.phase = 'denseSetup'
    return
  }
  if (beginCanvasVisualAtlasAttempt(task, task.entities, 'dense')) return
  beginDenseRuntime2dDraw(task)
}

function beginDenseRuntime2dDraw(task) {
  task.ctx.save()
  task.denseContextSaved = true
  task.ctx.setTransform(task.frame.pixelRatioX, 0, 0, task.frame.pixelRatioY, 0, 0)
  task.ctx.translate(task.frame.offsetX, task.frame.offsetY)
  task.ctx.scale(task.frame.scaleX, task.frame.scaleY)
  task.entityCursor = 0
  task.bitmapRects = task.partialDense
    ? task.measuredBitmapRects.slice()
    : [{ x: 0, y: 0, w: task.frame.bitmapWidth, h: task.frame.bitmapHeight }]
  task.phase = 'dense'
}

function measureRuntimeRegions(task, deadline) {
  while (true) {
    const next = task.regionCursor?.next()
    if (!next || next.done) {
      if (task.visualAnimationFrame && task.measuredRegions.length) {
        if (task.visualDenseRequested) {
          task.regionCursor = null
          task.regionAccumulator = null
          beginDenseRuntimeDraw(task)
          return true
        }
        const queryRegions = mergeOverlappingRuntimeRegions(task.measuredRegions)
        task.regionCursor = null
        task.regionAccumulator = null
        task.unionRegionDraw = true
        beginRuntimeCandidateCollection(task, queryRegions, true)
        return true
      }
      task.regionCursor = task.regionAccumulator.createCursor()
      task.regionAccumulator = null
      task.phase = 'region'
      return true
    }
    const bitmapRect = runtimeBitmapRect(next.value, task.frame, 2)
    if (bitmapRect) {
      task.measuredRegionCount += 1
      if (task.visualAnimationFrame) {
        task.measuredRegions.push(next.value)
        task.measuredBitmapRects.push(bitmapRect)
      }
      task.coverageTracker.add(bitmapRect)
      if (shouldUseDenseRuntime({
        available: task.allowDense && Boolean(task.entities),
        regionCount: task.measuredRegionCount,
        coverage: task.coverageTracker.coverage
      })) {
        if (task.visualAnimationFrame) {
          task.visualDenseRequested = true
          if (deadline.shouldYield()) return false
          continue
        }
        task.regionAccumulator = null
        task.regionCursor = null
        beginDenseRuntimeDraw(task)
        return true
      }
    }
    if (deadline.shouldYield()) return false
  }
}

function drawDenseRuntimeEntities(task, deadline) {
  while (task.entityCursor < task.entities.length) {
    const item = task.entities[task.entityCursor]
    if (item?.entity) {
      if (item.kind === 'drawing') {
        if (task.renderDrawings && !task.excludedDrawingIds.has(item.entity.id)) {
          drawTemporaryDrawing(task.ctx, item.entity, 1 / Math.max(.0001, Math.min(task.frame.scaleX, task.frame.scaleY)))
        }
      } else if (task.renderNodes && !task.excludedNodeIds.has(item.entity.id)) {
        const worldPixel = 1 / Math.max(.0001, Math.min(task.frame.scaleX, task.frame.scaleY))
        if (!drawEntityIncrementally(
          task,
          item.entity,
          task.frame.scaleX,
          task.frame.scaleY,
          worldPixel,
          'full',
          1,
          deadline
        )) return false
      }
    }
    task.entityCursor += 1
    if (deadline.shouldYield()) return false
  }
  if (task.denseContextSaved) task.ctx.restore()
  task.denseContextSaved = false
  task.phase = 'complete'
  return true
}

function finishRuntimeRegion(task) {
  if (task.regionContextSaved) task.ctx.restore()
  task.regionContextSaved = false
  task.region = null
  task.bitmapRect = null
  task.candidateWork = null
  task.candidates = []
  task.candidateCursor = 0
  task.phase = task.unionRegionDraw ? 'complete' : 'region'
}

function runtimeCandidateIncluded(task, item) {
  if (item?.kind === 'node') {
    return task.renderNodes && !task.excludedNodeIds.has(item.entity?.id)
  }
  if (item?.kind === 'drawing') {
    return task.renderDrawings && !task.excludedDrawingIds.has(item.entity?.id)
  }
  return false
}

function runtimeRegionQuerySources(task, limit = Number.POSITIVE_INFINITY, regions = [task.region]) {
  const queryLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined
  const options = queryLimit ? { sort: false, limit: queryLimit } : { sort: false }
  const sources = []
  for (const region of regions) {
    if (task.renderNodes) {
      sources.push({
        kind: 'node',
        cursor: task.spatialIndex.createQueryCursor(region, options)
      })
    }
    if (task.renderDrawings && typeof task.drawingSpatialIndex?.createQueryCursor === 'function') {
      sources.push({
        kind: 'drawing',
        cursor: task.drawingSpatialIndex.createQueryCursor(region, options)
      })
    }
  }
  return sources
}

function beginRuntimeCandidateCollection(task, regions = [task.region], deduplicate = false) {
  const seenIds = deduplicate ? new Map() : null
  const seenObjects = deduplicate ? new Map() : null
  const include = item => {
    if (!runtimeCandidateIncluded(task, item)) return false
    if (!deduplicate) return true
    const kind = item.kind
    const entity = item.entity
    if (entity?.id != null) {
      let ids = seenIds.get(kind)
      if (!ids) seenIds.set(kind, ids = new Set())
      if (ids.has(entity.id)) return false
      ids.add(entity.id)
      return true
    }
    let objects = seenObjects.get(kind)
    if (!objects) seenObjects.set(kind, objects = new WeakSet())
    if (entity && typeof entity === 'object') {
      if (objects.has(entity)) return false
      objects.add(entity)
    }
    return true
  }
  task.candidateWork = createRuntimeCandidateCursor(
    createRuntimeQueryCursor(runtimeRegionQuerySources(task, Number.POSITIVE_INFINITY, regions)),
    {
      include,
      compare: (left, right) => number(left?.entity?.layer) - number(right?.entity?.layer)
    }
  )
  task.phase = 'candidates'
}

function prepareRuntimeRegion(task) {
  const next = task.regionCursor?.next()
  if (!next || next.done) return false
  const bitmapRect = runtimeBitmapRect(next.value, task.frame, 2)
  if (!bitmapRect) return true

  task.region = next.value
  task.bitmapRect = bitmapRect
  if (!task.visualAnimationFrame && task.allowDense && Array.isArray(task.entities)) {
    const excludedCount = task.excludedNodeIds.size + task.excludedDrawingIds.size
    task.candidateProbe = createRuntimeQueryCursor(runtimeRegionQuerySources(
      task,
      RUNTIME_DENSE_NODE_THRESHOLD + excludedCount + 1
    ))
    task.candidateProbeCount = 0
    task.phase = 'candidateProbe'
  } else beginRuntimeCandidateCollection(task)
  return true
}

function probeRuntimeCandidates(task, deadline) {
  const result = task.candidateProbe.runSlice({
    maxOperations: RUNTIME_CURSOR_OPERATION_LIMIT,
    shouldYield: () => task.candidateProbeCount > RUNTIME_DENSE_NODE_THRESHOLD || deadline.shouldYield(),
    onMatch(item) {
      if (runtimeCandidateIncluded(task, item)) task.candidateProbeCount += 1
    }
  })
  if (task.candidateProbeCount > RUNTIME_DENSE_NODE_THRESHOLD) {
    beginDenseRuntimeDraw(task)
    return true
  }
  if (!result.done) return false
  task.candidateProbe = null
  task.candidateProbeCount = 0
  beginRuntimeCandidateCollection(task)
  return true
}

function beginRuntimeRegionDraw(task) {
  const bitmapRect = task.bitmapRect
  task.ctx.save()
  task.regionContextSaved = true
  task.ctx.setTransform(1, 0, 0, 1, 0, 0)
  task.ctx.beginPath()
  task.ctx.rect(bitmapRect.x, bitmapRect.y, bitmapRect.w, bitmapRect.h)
  task.ctx.clip()
  task.ctx.clearRect(bitmapRect.x, bitmapRect.y, bitmapRect.w, bitmapRect.h)
  task.ctx.drawImage(
    task.base,
    bitmapRect.x,
    bitmapRect.y,
    bitmapRect.w,
    bitmapRect.h,
    bitmapRect.x,
    bitmapRect.y,
    bitmapRect.w,
    bitmapRect.h
  )
  task.ctx.setTransform(task.frame.pixelRatioX, 0, 0, task.frame.pixelRatioY, 0, 0)
  task.ctx.translate(task.frame.offsetX, task.frame.offsetY)
  task.ctx.scale(task.frame.scaleX, task.frame.scaleY)
  task.bitmapRects.push(bitmapRect)
  task.phase = 'draw'
}

function beginRuntimeUnionDraw(task) {
  const bitmapRects = task.measuredBitmapRects
  task.ctx.save()
  task.regionContextSaved = true
  task.ctx.setTransform(1, 0, 0, 1, 0, 0)
  task.ctx.beginPath()
  for (const rect of bitmapRects) task.ctx.rect(rect.x, rect.y, rect.w, rect.h)
  task.ctx.clip()
  task.ctx.clearRect(0, 0, task.frame.bitmapWidth, task.frame.bitmapHeight)
  task.ctx.drawImage(task.base, 0, 0)
  task.ctx.setTransform(task.frame.pixelRatioX, 0, 0, task.frame.pixelRatioY, 0, 0)
  task.ctx.translate(task.frame.offsetX, task.frame.offsetY)
  task.ctx.scale(task.frame.scaleX, task.frame.scaleY)
  task.bitmapRects.push(...bitmapRects)
  task.phase = 'draw'
}

function prepareRuntimeCandidates(task, deadline) {
  const result = task.candidateWork.runSlice(deadline, RUNTIME_CURSOR_OPERATION_LIMIT)
  if (!result.done) return false
  task.candidates = task.candidateWork.items
  task.candidateWork = null
  task.candidateCursor = 0
  if (task.unionRegionDraw) {
    if (!beginCanvasVisualAtlasAttempt(task, task.candidates, 'union')) beginRuntimeUnionDraw(task)
  }
  else beginRuntimeRegionDraw(task)
  return true
}

function runRuntimeRenderSlice(task, deadline) {
  const sliceStartedAt = task?.visualAnimationFrame ? currentAnimationTimestamp() : 0
  try {
  if (
    !task.valid
    || task.epoch !== runtimeRenderEpoch
    || task.base !== committedStaticSurface
    || task.frontComposite !== committedCompositeSurface
    || task.excludedNodeIds !== committedExcludedNodeIds
    || task.excludedDrawingIds !== committedExcludedDrawingIds
  ) return true
  while (!deadline.shouldYield()) {
    if (task.seedSource) {
      if (!seedRuntimeRenderSurface(task, deadline)) return false
      if (!task.valid) return true
      continue
    }
    if (task.phase === 'regions') {
      if (!prepareRuntimeRegions(task, deadline)) return false
      if (!task.valid) return true
      continue
    }
    if (task.phase === 'measure') {
      if (!measureRuntimeRegions(task, deadline)) return false
      continue
    }
    if (task.phase === 'region') {
      if (!prepareRuntimeRegion(task)) return true
      if (deadline.shouldYield()) return false
      continue
    }
    if (task.phase === 'candidateProbe') {
      if (!probeRuntimeCandidates(task, deadline)) return false
      continue
    }
    if (task.phase === 'candidates') {
      if (!prepareRuntimeCandidates(task, deadline)) return false
      continue
    }
    if (task.phase === 'draw') {
      while (task.candidateCursor < task.candidates.length) {
        const item = task.candidates[task.candidateCursor]
        const worldPixel = 1 / Math.max(.0001, Math.min(task.frame.scaleX, task.frame.scaleY))
        if (item.kind === 'drawing') {
          if (task.renderDrawings && !task.excludedDrawingIds.has(item.entity.id)) drawTemporaryDrawing(task.ctx, item.entity, worldPixel)
        }
        else if (task.renderNodes && !task.excludedNodeIds.has(item.entity.id)) {
          if (!drawEntityIncrementally(
            task,
            item.entity,
            task.frame.scaleX,
            task.frame.scaleY,
            worldPixel,
            'full',
            1,
            deadline
          )) return false
        }
        task.candidateCursor += 1
        if (deadline.shouldYield()) return false
      }
      finishRuntimeRegion(task)
      continue
    }
    if (task.phase === 'dense') return drawDenseRuntimeEntities(task, deadline)
    if (task.phase === 'visualAtlasPrepare') {
      if (!prepareCanvasVisualAtlas(task, deadline)) return false
      continue
    }
    if (task.phase === 'visualAtlasRaster') {
      if (!rasterCanvasVisualAtlas(task, deadline)) return false
      continue
    }
    if (task.phase === 'visualAtlasComposite') return compositeCanvasVisualAtlas(task, deadline)
    if (task.phase === 'denseSetup') {
      beginDenseRuntimeDraw(task)
      continue
    }
    if (task.phase === 'complete') return true
    return true
  }
  return false
  } finally {
    if (task?.visualAnimationFrame) {
      task.visualAnimationActiveWorkMs += Math.max(0, currentAnimationTimestamp() - sliceStartedAt)
    }
  }
}

function releaseRuntimeRenderTask(task, _payload, reason) {
  if (!task) return
  let contextsHealthy = true
  if (task.regionContextSaved && task.ctx) {
    try { task.ctx.restore() } catch { contextsHealthy = false }
  }
  if (task.denseContextSaved && task.ctx) {
    try { task.ctx.restore() } catch { contextsHealthy = false }
  }
  task.regionContextSaved = false
  task.denseContextSaved = false
  task.textLayoutWork = null
  task.visualAnimationSignatureCache?.clear?.()
  task.visualAnimationSignatureCache = null
  releaseCanvasVisualSprites(task)
  clearCanvasVisualAtlasAttempt(task)
  task.nodes = []
  task.entities = null
  task.regionAccumulator = null
  task.coverageTracker = null
  task.regionCursor = null
  task.candidateProbe = null
  task.candidateProbeCount = 0
  task.candidateWork = null
  task.candidates = []
  if (task.ctx) {
    try { task.ctx.globalCompositeOperation = 'source-over' } catch { contextsHealthy = false }
  }
  if (task.composite) {
    releaseRenderSurface(task.composite, contextsHealthy && reason !== 'error' && task.surfaceReusable !== false)
  }
  task.frontComposite = null
  task.composite = null
  task.ctx = null
}

function runtimeRenderCompletion(task) {
  const pendingRuntime = runtimeRenderDirty
    || runtimeRenderFollowUpPending()
  return {
    generation: committedGeneration.value + 1,
    renderGeneration: task.generation,
    kind: 'runtime',
    settled: !renderScheduler.state.pending && !pendingRuntime,
    pendingFull: renderScheduler.state.pending,
    pendingRuntime,
    runtimeMode: task.mode,
    bitmapWidth: task.frame.bitmapWidth,
    bitmapHeight: task.frame.bitmapHeight,
    pixelRatioX: task.frame.pixelRatioX,
    pixelRatioY: task.frame.pixelRatioY,
    viewBox: task.frame.viewBox ? { ...task.frame.viewBox } : null,
    renderPlanKey: task.frame.renderPlanKey,
    frameCommitToken: task.frame.frameCommitToken,
    animationTimestamp: task.animationTimestamp,
    visualSpriteRasters: task.visualSpriteRasterCount,
    visualSpriteBlits: task.visualSpriteBlitCount,
    visualAtlasUsed: task.visualAtlasUsed,
    visualAtlasMode: task.visualAtlasMode,
    visualAtlasPreserveComposite: task.visualAtlasDirectFrame?.preserveCompositeBase === true,
    visualAtlasBackend: task.visualAtlasBackend,
    visualAtlasFallbacks: task.visualAtlasFallbackCount,
    visualAtlasFailureReason: task.visualAtlasFailureReason,
    visualAtlasInstances: task.visualAtlasInstanceCount,
    visualAtlasSprites: task.visualAtlasSpriteCount,
    visualAtlasPixels: task.visualAtlasPixels,
    visualAtlasRawPixels: task.visualAtlasRawPixels,
    visualAtlasWidth: task.visualAtlasWidth,
    visualAtlasHeight: task.visualAtlasHeight,
    visualAtlasOutputPixels: task.visualAtlasOutputPixels,
    visualAtlasPrepareMs: task.visualAtlasPrepareMs,
    visualAtlasRasterMs: task.visualAtlasRasterMs,
    visualAtlasUploadMs: task.visualAtlasUploadMs,
    visualAtlasDrawMs: task.visualAtlasDrawMs,
    visualAtlasValidationMs: task.visualAtlasValidationMs,
    visualAtlasCompositeMs: task.visualAtlasCompositeMs,
    visualDescriptorCacheHits: task.visualDescriptorCacheHits,
    visualDescriptorCacheMisses: task.visualDescriptorCacheMisses,
    visualDescriptorCacheBypasses: task.visualDescriptorCacheBypasses,
    visualAnimationSignatureCacheHits: task.visualAnimationSignatureCacheHits,
    visualAnimationSignatureCacheMisses: task.visualAnimationSignatureCacheMisses,
    visualAtlasFrameCacheHit: task.visualAtlasFrameCacheHit,
    visualAtlasSlotCacheHits: task.visualAtlasSlotCacheHits,
    visualAtlasSlotCacheMisses: task.visualAtlasSlotCacheMisses
  }
}

function commitRuntimeRenderTask(task) {
  const commitStartedAt = task?.visualAnimationFrame ? currentAnimationTimestamp() : 0
  if (
    !task?.valid
    || task.epoch !== runtimeRenderEpoch
    || task.base !== committedStaticSurface
    || task.frontComposite !== committedCompositeSurface
    || task.excludedNodeIds !== committedExcludedNodeIds
    || task.excludedDrawingIds !== committedExcludedDrawingIds
    || task.target !== canvas.value
  ) {
    releaseRuntimeRenderTask(task)
    return
  }
  const completion = runtimeRenderCompletion(task)
  if (!frameCommitAccepted(completion)) {
    releaseRuntimeRenderTask(task)
    emit('render-rejected', completion)
    return
  }
  let committed = false
  let nextComposite = null
  try {
    const targetContext = task.target.getContext('2d')
    if (!canvasContextGate.accepts(task.contextToken, task.target, targetContext)) {
      reportCanvasRenderError(canvasContextGate.state().lost ? 'context-lost' : 'context-unavailable')
      return
    }
    if (task.bitmapRects.length && !commitCanvasSurface(targetContext, task.composite, task.bitmapRects)) {
      throw new Error('runtime surface commit failed')
    }
    if (task.bitmapRects.length) {
      nextComposite = task.composite
      task.composite = null
    }
    committed = true
  } catch (error) {
    task.surfaceReusable = false
    reportCanvasRenderError('runtime-commit-failed', error)
  } finally {
    releaseRuntimeRenderTask(task)
  }
  if (!committed) return
  if (task.target?.dataset) {
    task.target.dataset.visualAtlasUsed = completion.visualAtlasUsed ? 'true' : 'false'
    task.target.dataset.visualAtlasMode = completion.visualAtlasMode
    task.target.dataset.visualAtlasPreserveComposite = completion.visualAtlasPreserveComposite ? 'true' : 'false'
    task.target.dataset.visualAtlasBackend = completion.visualAtlasBackend
    task.target.dataset.visualAtlasFallbacks = String(completion.visualAtlasFallbacks)
    task.target.dataset.visualAtlasFailureReason = completion.visualAtlasFailureReason
    task.target.dataset.visualAtlasInstances = String(completion.visualAtlasInstances)
    task.target.dataset.visualAtlasSprites = String(completion.visualAtlasSprites)
    task.target.dataset.visualAtlasPixels = String(completion.visualAtlasPixels)
    task.target.dataset.visualAtlasRawPixels = String(completion.visualAtlasRawPixels)
    task.target.dataset.visualAtlasWidth = String(completion.visualAtlasWidth)
    task.target.dataset.visualAtlasHeight = String(completion.visualAtlasHeight)
    task.target.dataset.visualAtlasOutputPixels = String(completion.visualAtlasOutputPixels)
    task.target.dataset.visualAtlasPrepareMs = completion.visualAtlasPrepareMs.toFixed(3)
    task.target.dataset.visualAtlasRasterMs = completion.visualAtlasRasterMs.toFixed(3)
    task.target.dataset.visualAtlasUploadMs = completion.visualAtlasUploadMs.toFixed(3)
    task.target.dataset.visualAtlasDrawMs = completion.visualAtlasDrawMs.toFixed(3)
    task.target.dataset.visualAtlasValidationMs = completion.visualAtlasValidationMs.toFixed(3)
    task.target.dataset.visualAtlasCompositeMs = completion.visualAtlasCompositeMs.toFixed(3)
    task.target.dataset.visualDescriptorCacheHits = String(completion.visualDescriptorCacheHits)
    task.target.dataset.visualDescriptorCacheMisses = String(completion.visualDescriptorCacheMisses)
    task.target.dataset.visualDescriptorCacheBypasses = String(completion.visualDescriptorCacheBypasses)
    task.target.dataset.visualAnimationSignatureCacheHits = String(completion.visualAnimationSignatureCacheHits)
    task.target.dataset.visualAnimationSignatureCacheMisses = String(completion.visualAnimationSignatureCacheMisses)
    task.target.dataset.visualAtlasFrameCacheHit = completion.visualAtlasFrameCacheHit ? 'true' : 'false'
    task.target.dataset.visualAtlasSlotCacheHits = String(completion.visualAtlasSlotCacheHits)
    task.target.dataset.visualAtlasSlotCacheMisses = String(completion.visualAtlasSlotCacheMisses)
  }
  if (task.visualAnimationFrame) {
    const measuredAt = currentAnimationTimestamp()
    task.visualAnimationActiveWorkMs += Math.max(0, measuredAt - commitStartedAt)
    visualAnimationMeasuredFrameMs = Math.max(0, task.visualAnimationActiveWorkMs)
    visualAnimationMeasuredNodeCount = task.visualAnimationVisibleCount
    if (task.target?.dataset) {
      task.target.dataset.visualAnimationState = 'committed'
      task.target.dataset.visualAnimationFrameMs = visualAnimationMeasuredFrameMs.toFixed(3)
      task.target.dataset.visualAnimationWallMs = Math.max(
        0,
        measuredAt - task.visualAnimationStartedAt
      ).toFixed(3)
      task.target.dataset.visualAnimationIntervalMs = visualAnimationFrameIntervalMs.toFixed(3)
    }
  }
  if (nextComposite) {
    if (task.mode === 'sparse' || task.partialDense) swapCommittedCompositeSurface(nextComposite, task.bitmapRects)
    else replaceCommittedCompositeSurface(nextComposite)
  }
  if (task.visualAtlasDirect) commitDirectSignalLightTimestamp(task.animationTimestamp)
  else if (task.mode === 'dense') commitSignalLightColors(committedVisualAnimationNodes, task.animationTimestamp, true)
  else commitSignalLightColors(task.signalLightColors, task.animationTimestamp)
  reportedCanvasErrorEpoch = -1
  committedGeneration.value = completion.generation
  renderReady.value = true
  emit('render-complete', completion)
  if (!pendingRuntimeDense && !pendingRuntimeNodes.size) {
    runtimeRenderDirty = false
    flushPendingVisualAnimationRender()
    return
  }
  if (runtimeDenseStreamOpen && runtimeDenseStreamStarted) {
    runtimeRenderDirty = true
    queueRuntimeDenseStreamFlush()
    return
  }
  runtimeRenderDirty = false
  scheduleRuntimeRender()
}

const runtimeRenderScheduler = createChunkedRenderScheduler({
  budgetMs: runtimeRenderSliceBudget,
  schedule: scheduleRenderSlice,
  cancel: cancelRenderSlice,
  createTask: createRuntimeRenderTask,
  runSlice: runRuntimeRenderSlice,
  commit: commitRuntimeRenderTask,
  discard: releaseRuntimeRenderTask,
  onError: (error, detail) => reportCanvasRenderError(`runtime-${detail.phase}-failed`, error)
})

function resetVisualAnimationFramePacing() {
  visualAnimationLastFrameTimestamp = null
  visualAnimationFrameIntervalMs = 0
  visualAnimationMeasuredFrameMs = 0
  visualAnimationMeasuredNodeCount = 0
}

function releaseVisualAnimationClock() {
  pendingVisualAnimationTimestamp = null
  stopVisualAnimationClockWatch?.()
  stopVisualAnimationClockWatch = null
  if (visualAnimationClock) releaseVisualClock(VISUAL_ANIMATION_CLOCK_FPS)
  visualAnimationClock = null
  resetVisualAnimationFramePacing()
}

function visualAnimationNodeKey(node) {
  return node?.id ?? node
}

function hasSignalRuntimeBinding(node) {
  return Array.isArray(node?.dataBindings) && node.dataBindings.some(binding => (
    binding?.enabled !== false
    && /^signalColors\.\d+$/.test(String(binding?.target ?? '').trim())
  ))
}

function visualAnimationRuntimeNode(node, { signal = false, composite = false } = {}) {
  const needsRuntime = hasEnabledRuntimeBinding(node, 'animationDuration')
    || hasEnabledRuntimeBinding(node, 'animationPlaying')
    || (signal && (
      hasEnabledRuntimeBinding(node, 'signalOpacity')
      || hasSignalRuntimeBinding(node)
    ))
    || (composite && (
      hasEnabledRuntimeBinding(node, 'fill')
      || hasEnabledRuntimeBinding(node, 'opacity')
    ))
  return needsRuntime ? materializeRuntimeNode(node, runtimePointValue) : node
}

function commitSignalLightColors(nodesOrColors, timestamp, replace = false) {
  const colors = replace ? new Map() : committedSignalLightColors
  if (nodesOrColors instanceof Map) {
    for (const [key, color] of nodesOrColors) {
      if (key != null) colors.set(key, color)
    }
  } else {
    for (const sourceNode of nodesOrColors || []) {
      if (sourceNode?.type !== 'signalLight') continue
      const key = visualAnimationNodeKey(sourceNode)
      if (key == null) continue
      const node = materializeRuntimeNode(sourceNode, runtimePointValue)
      const resolvedTimestamp = isCanvasVisualAnimationCandidate(node)
        ? visualAnimationTimeline.resolve(node, timestamp)
        : timestamp
      colors.set(key, signalLightColor(node, resolvedTimestamp))
    }
  }
  if (replace) {
    committedSignalLightColors = colors
    committedDirectSignalLightTimestamp = null
  }
}

function commitDirectSignalLightTimestamp(timestamp) {
  committedSignalLightColors = new Map()
  committedDirectSignalLightTimestamp = number(timestamp, currentAnimationTimestamp())
}

function previousCommittedSignalLightColor(node, key) {
  if (committedSignalLightColors.has(key)) return committedSignalLightColors.get(key)
  if (committedDirectSignalLightTimestamp == null) return undefined
  const resolvedTimestamp = isCanvasVisualAnimationCandidate(node)
    ? visualAnimationTimeline.resolve(node, committedDirectSignalLightTimestamp)
    : committedDirectSignalLightTimestamp
  return signalLightColor(node, resolvedTimestamp)
}

function syncRuntimeVisualAnimationNodes(nodes) {
  const source = Array.isArray(nodes) ? nodes : []
  if (!source.length) return false
  invalidateCanvasVisualDirectAtlasFrame()
  const timestamp = currentAnimationTimestamp()
  let changed = false
  for (const candidate of source) {
    const node = candidate && typeof candidate === 'object'
      ? candidate
      : props.nodeIndex?.get?.(candidate)
    if (!canvasVisualAnimationTypes.has(node?.type)) continue
    canvasVisualSpriteDescriptorCache.delete(node)
    canvasVisualAnimationStreamStates.delete(node)
    const key = visualAnimationNodeKey(node)
    if (key == null) continue
    const effective = materializeRuntimeNode(node, runtimePointValue)
    if (isCanvasVisualAnimationCandidate(effective)) {
      visualAnimationTimeline.resolve(effective, timestamp)
    }
    const active = !committedExcludedNodeIds.has(key) && isCanvasVisualAnimationNode(effective)
    if (active) {
      if (committedVisualAnimationNodeMap.get(key) !== node) {
        committedVisualAnimationNodeMap.set(key, node)
        committedSignalLightColors.delete(key)
        changed = true
      }
    } else {
      committedSignalLightColors.delete(key)
      if (committedVisualAnimationNodeMap.delete(key)) changed = true
    }
  }
  if (!changed) return false
  committedVisualAnimationNodes = [...committedVisualAnimationNodeMap.values()]
    .sort((left, right) => number(right?.layer) - number(left?.layer))
  visualAnimationViewportDirty = true
  syncVisualAnimationClock()
  return true
}

function clipsOverflow(value) {
  return ['auto', 'scroll', 'hidden', 'clip'].includes(String(value || '').toLowerCase())
}

function visualAnimationClippingAncestors(target) {
  if (target === visualAnimationClipTarget) return visualAnimationClipAncestors
  visualAnimationClipTarget = target
  visualAnimationClipAncestors = []
  for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = typeof globalThis.getComputedStyle === 'function'
      ? globalThis.getComputedStyle(ancestor)
      : null
    const clipsX = clipsOverflow(style?.overflowX || style?.overflow)
    const clipsY = clipsOverflow(style?.overflowY || style?.overflow)
    if (clipsX || clipsY) visualAnimationClipAncestors.push({ element: ancestor, clipsX, clipsY })
  }
  return visualAnimationClipAncestors
}

function visualAnimationViewportBounds() {
  const frame = committedStaticFrame
  const target = canvas.value
  const fallback = frame?.viewBox || (frame ? {
    x: 0,
    y: 0,
    w: frame.stageWidth,
    h: frame.stageHeight
  } : null)
  if (!frame || !target?.getBoundingClientRect) return fallback
  const rect = target.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) return fallback

  const ownerDocument = target.ownerDocument
  const documentElement = ownerDocument?.documentElement
  const viewportWidth = Number(globalThis.innerWidth) || Number(documentElement?.clientWidth) || rect.right
  const viewportHeight = Number(globalThis.innerHeight) || Number(documentElement?.clientHeight) || rect.bottom
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(viewportWidth, rect.right)
  let bottom = Math.min(viewportHeight, rect.bottom)
  for (const { element, clipsX, clipsY } of visualAnimationClippingAncestors(target)) {
    if (typeof element?.getBoundingClientRect !== 'function') continue
    const ancestorRect = element.getBoundingClientRect()
    if (clipsX) {
      left = Math.max(left, ancestorRect.left)
      right = Math.min(right, ancestorRect.right)
    }
    if (clipsY) {
      top = Math.max(top, ancestorRect.top)
      bottom = Math.min(bottom, ancestorRect.bottom)
    }
  }
  if (right <= left || bottom <= top) return { x: 0, y: 0, w: 0, h: 0 }

  const cssWidth = Math.max(1, number(frame.width, rect.width))
  const cssHeight = Math.max(1, number(frame.height, rect.height))
  const localLeft = (left - rect.left) * cssWidth / rect.width
  const localTop = (top - rect.top) * cssHeight / rect.height
  const localRight = (right - rect.left) * cssWidth / rect.width
  const localBottom = (bottom - rect.top) * cssHeight / rect.height
  const worldLeft = Math.max(0, Math.min(frame.stageWidth, (localLeft - frame.offsetX) / frame.scaleX))
  const worldTop = Math.max(0, Math.min(frame.stageHeight, (localTop - frame.offsetY) / frame.scaleY))
  const worldRight = Math.max(worldLeft, Math.min(frame.stageWidth, (localRight - frame.offsetX) / frame.scaleX))
  const worldBottom = Math.max(worldTop, Math.min(frame.stageHeight, (localBottom - frame.offsetY) / frame.scaleY))
  return { x: worldLeft, y: worldTop, w: worldRight - worldLeft, h: worldBottom - worldTop }
}

function visualAnimationBoundsKey(bounds) {
  if (!bounds) return ''
  return [bounds.x, bounds.y, bounds.w, bounds.h]
    .map(value => Math.round(number(value) * 10) / 10)
    .join(':')
}

function visualAnimationQueryBounds(bounds) {
  if (!bounds) return bounds
  let padding = 0
  for (const node of committedVisualAnimationNodes) {
    const visualScalePadding = Math.max(
      1,
      Math.abs(number(node.visualScaleX, 1)),
      Math.abs(number(node.visualScaleY, 1))
    )
    const borderPadding = node.borderVisible === false
      ? 0
      : Math.max(0, number(node.borderWidth)) / 2 * visualScalePadding
    const heartbeatPadding = node.type === 'heartbeat'
      ? Math.max(number(node.w, 1), number(node.h, 1)) * .09 * visualScalePadding
      : 0
    padding = Math.max(padding, borderPadding, heartbeatPadding)
  }
  if (!(padding > 0)) return bounds
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2
  }
}

function refreshVisibleVisualAnimationNodes() {
  const bounds = visualAnimationViewportBounds()
  const key = visualAnimationBoundsKey(bounds)
  if (!visualAnimationViewportDirty && key === visualAnimationViewportKey) return visibleVisualAnimationNodes
  visualAnimationViewportDirty = false
  visualAnimationViewportKey = key
  const queryBounds = visualAnimationQueryBounds(bounds)
  const candidates = bounds?.w > 0 && bounds?.h > 0 && typeof props.spatialIndex?.query === 'function'
    ? props.spatialIndex.query(queryBounds, { sort: false })
    : bounds?.w > 0 && bounds?.h > 0
      ? committedVisualAnimationNodes
      : []
  const visible = []
  const ids = new Set()
  for (const candidate of candidates) {
    const key = visualAnimationNodeKey(candidate)
    if (key == null || ids.has(key) || !committedVisualAnimationNodeMap.has(key)) continue
    const node = props.nodeIndex?.get?.(candidate.id) || candidate
    if (!node || committedExcludedNodeIds.has(key)) continue
    ids.add(key)
    visible.push(node)
  }
  visible.sort((left, right) => number(right?.layer) - number(left?.layer))
  visibleVisualAnimationNodes = visible
  return visibleVisualAnimationNodes
}

function appendVisibleVisualAnimationNodes(source, timestamp, batch, stale) {
  const seen = new Set()
  for (const tracked of source) {
    const node = props.nodeIndex?.get?.(tracked?.id) || tracked
    const key = visualAnimationNodeKey(node)
    if (!node || key == null || seen.has(key) || committedExcludedNodeIds.has(key)) continue
    const effective = visualAnimationRuntimeNode(node, { signal: node.type === 'signalLight' })
    if (!isCanvasVisualAnimationNode(effective)) {
      stale.push(node)
      continue
    }
    const previousSignalColor = effective.type === 'signalLight'
      ? previousCommittedSignalLightColor(effective, key)
      : undefined
    const resolvedTimestamp = visualAnimationTimeline.resolve(effective, timestamp)
    if (
      effective.type === 'signalLight'
      && previousSignalColor === signalLightColor(effective, resolvedTimestamp)
    ) continue
    seen.add(key)
    batch.push(node)
  }
}

function nextVisualAnimationNodeBatch(timestamp = currentAnimationTimestamp()) {
  const visible = refreshVisibleVisualAnimationNodes()
  if (!visible.length) return []
  const batch = []
  const stale = []
  // Build one atomic frame from every visible continuous effect and each light that changed color.
  appendVisibleVisualAnimationNodes(visible, timestamp, batch, stale)
  if (stale.length) syncRuntimeVisualAnimationNodes(stale)
  return batch
}

function visualAnimationDirectAtlasFrame(visibleNodes = refreshVisibleVisualAnimationNodes()) {
  const documentNodes = Array.isArray(props.nodes) ? props.nodes : []
  const layerEntries = Array.isArray(props.orderedEntities) ? props.orderedEntities : []
  const cached = canvasVisualDirectAtlasFrameCache
  if (
    cached?.frame === committedStaticFrame
    && cached.documentNodes === documentNodes
    && cached.layerEntries === layerEntries
    && cached.nodeIndex === props.nodeIndex
    && cached.visibleNodes === visibleNodes
    && cached.animationNodeMap === committedVisualAnimationNodeMap
    && cached.renderRevision === props.renderRevision
  ) return cached
  if (
    visibleNodes.length < RUNTIME_VISUAL_ATLAS_MIN_INSTANCES
    || !documentNodes.length
    || !layerEntries.length
  ) return null

  const pureVisualDocument = layerEntries.length === documentNodes.length
    && committedVisualAnimationNodeMap.size === documentNodes.length
    && !props.drawings.length
    && !committedExcludedNodeIds.size
    && !committedExcludedDrawingIds.size
  let preserveCompositeBase = !pureVisualDocument
  if (pureVisualDocument) {
    for (const sourceNode of documentNodes) {
      const key = visualAnimationNodeKey(sourceNode)
      const node = visualAnimationRuntimeNode(sourceNode, { composite: true })
      if (
        key == null
        || committedVisualAnimationNodeMap.get(key) !== sourceNode
        || !canvasVisualAnimationTypes.has(sourceNode?.type)
        || !isCanvasVisualAnimationNode(node)
        || number(node?.rotate) !== 0
        || alpha(node?.opacity) <= 0
      ) return null
    }
    preserveCompositeBase = false
  } else {
    const opaqueFill = value => {
      const color = String(value || '').trim()
      return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color)
        || /^rgb\(\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*\)$/i.test(color)
        || /^rgb\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*\)$/i.test(color)
    }
    if (typeof props.spatialIndex?.query !== 'function') return null
    for (const sourceNode of visibleNodes) {
      const key = visualAnimationNodeKey(sourceNode)
      const node = visualAnimationRuntimeNode(sourceNode, { composite: true })
      if (
        key == null
        || committedVisualAnimationNodeMap.get(key) !== sourceNode
        || !canvasVisualAnimationTypes.has(sourceNode?.type)
        || !isCanvasVisualAnimationNode(node)
        || number(node?.rotate) !== 0
        || alpha(node?.opacity) !== 1
        || alpha(node?.backgroundOpacity) !== 1
        || !opaqueFill(node?.fill)
      ) return null
      const region = runtimeNodeRegion(node, {
        stageWidth: committedStaticFrame?.stageWidth,
        stageHeight: committedStaticFrame?.stageHeight,
        padding: 2
      })
      if (!region) return null
      const overlappingNodes = props.spatialIndex.query(region, { sort: false })
      if (overlappingNodes.some(candidate => {
        const candidateKey = visualAnimationNodeKey(candidate)
        return candidateKey !== key && !committedExcludedNodeIds.has(candidateKey)
      })) return null
      if (props.drawings.length) {
        if (typeof props.drawingSpatialIndex?.query !== 'function') return null
        const overlappingDrawings = props.drawingSpatialIndex.query(region, { sort: false })
        if (overlappingDrawings.some(drawing => !committedExcludedDrawingIds.has(drawing?.id))) return null
      }
    }
  }
  const visibleIds = new Set(visibleNodes.map(visualAnimationNodeKey))
  const orderedVisibleNodes = []
  for (const item of layerEntries) {
    if (item?.kind !== 'node' || !item.entity) return null
    const key = visualAnimationNodeKey(item.entity)
    if (visibleIds.has(key)) orderedVisibleNodes.push(props.nodeIndex?.get?.(key) || item.entity)
  }
  if (orderedVisibleNodes.length !== visibleIds.size) return null
  const bitmapRect = runtimeBitmapRect(visualAnimationViewportBounds(), committedStaticFrame, 2)
  if (!bitmapRect) return null
  canvasVisualDirectAtlasFrameCache = {
    frame: committedStaticFrame,
    documentNodes,
    layerEntries,
    nodeIndex: props.nodeIndex,
    visibleNodes,
    animationNodeMap: committedVisualAnimationNodeMap,
    renderRevision: props.renderRevision,
    bitmapRect,
    nodes: orderedVisibleNodes,
    preserveCompositeBase,
    topology: null
  }
  return canvasVisualDirectAtlasFrameCache
}

function queueVisualAnimationTimestamp(timestamp) {
  const resolved = number(timestamp, currentAnimationTimestamp())
  pendingVisualAnimationTimestamp = pendingVisualAnimationTimestamp == null
    ? resolved
    : Math.max(pendingVisualAnimationTimestamp, resolved)
  return pendingVisualAnimationTimestamp
}

function minimumVisibleVisualAnimationDurationSeconds(nodes) {
  let minimum = Number.POSITIVE_INFINITY
  for (const sourceNode of nodes) {
    const hasRuntimeTiming = hasEnabledRuntimeBinding(sourceNode, 'animationDuration')
      || hasEnabledRuntimeBinding(sourceNode, 'animationPlaying')
    const node = hasRuntimeTiming
      ? materializeRuntimeNode(sourceNode, runtimePointValue)
      : sourceNode
    if (!isCanvasVisualAnimationNode(node)) continue
    const duration = number(node.animationDuration)
    if (duration > 0) minimum = Math.min(minimum, duration)
  }
  return Number.isFinite(minimum) ? minimum : 0
}

function flushPendingVisualAnimationRender() {
  const blockedBy = pendingVisualAnimationTimestamp == null
    ? 'timestamp'
    : !props.active
      ? 'inactive'
      : !props.incrementalRuntime
        ? 'non-incremental'
        : renderScheduler.state.pending
          ? 'full-render'
          : runtimeRenderScheduler.state.pending
            ? 'runtime-render'
            : geometryInteraction
              ? 'geometry'
              : coalescedRenderDirty
                ? 'coalesced-render'
                : runtimeRenderDirty
                  ? 'runtime-dirty'
                  : runtimeRenderFollowUpPending()
                    ? 'runtime-follow-up'
                    : !canIncrementRuntime()
                      ? 'incremental-unavailable'
                      : ''
  if (blockedBy) {
    if (canvas.value?.dataset) canvas.value.dataset.visualAnimationState = `blocked:${blockedBy}`
    return null
  }

  const preparationStartedAt = currentAnimationTimestamp()
  const animationTimestamp = pendingVisualAnimationTimestamp
  const visibleNodes = refreshVisibleVisualAnimationNodes()
  const visibleCount = visibleNodes.length
  const directAtlasFrame = visualAnimationDirectAtlasFrame(visibleNodes)
  const batch = directAtlasFrame?.nodes || nextVisualAnimationNodeBatch(animationTimestamp)
  if (!batch.length) {
    pendingVisualAnimationTimestamp = null
    return null
  }
  const inserted = []
  for (const node of batch) {
    const key = node.id ?? node
    pendingRuntimeNodes.set(key, node)
    inserted.push([key, node])
  }
  const generation = scheduleRuntimeRender({
    animationTimestamp,
    visualAnimationFrame: true,
    visualAnimationNodeCount: batch.length,
    visualAnimationVisibleCount: visibleCount,
    visualAtlasDirectRect: directAtlasFrame?.bitmapRect || null,
    visualAtlasDirectFrame: directAtlasFrame || null,
    visualAnimationPreparationMs: Math.max(0, currentAnimationTimestamp() - preparationStartedAt)
  })
  if (generation != null) {
    pendingVisualAnimationTimestamp = null
    if (canvas.value?.dataset) canvas.value.dataset.visualAnimationState = 'scheduled'
    return generation
  }
  for (const [key, node] of inserted) {
    if (pendingRuntimeNodes.get(key) === node) pendingRuntimeNodes.delete(key)
  }
  return null
}

function requestVisualAnimationRender(timestamp) {
  visualAnimationTickCount += 1
  if (canvas.value?.dataset) canvas.value.dataset.visualAnimationTicks = String(visualAnimationTickCount)
  if (visualAnimationReducedMotion || !props.active || !props.incrementalRuntime) return null
  if (pendingVisualAnimationTimestamp != null) {
    const pendingGeneration = flushPendingVisualAnimationRender()
    if (pendingGeneration != null || pendingVisualAnimationTimestamp != null) return pendingGeneration
  }
  const now = number(timestamp, currentAnimationTimestamp())
  const visibleNodes = refreshVisibleVisualAnimationNodes()
  const visibleCount = visibleNodes.length
  const pending = Boolean(
    renderScheduler.state.pending
    || runtimeRenderScheduler.state.pending
    || geometryInteraction
    || coalescedRenderDirty
    || runtimeRenderDirty
    || runtimeRenderFollowUpPending()
    || !canIncrementRuntime()
  )
  const plan = canvasVisualAnimationFramePlan({
    now,
    visibleCount,
    measuredFrameMs: visualAnimationMeasuredFrameMs,
    measuredVisibleCount: visualAnimationMeasuredNodeCount,
    previousIntervalMs: visualAnimationFrameIntervalMs,
    lastFrameTimestamp: visualAnimationLastFrameTimestamp,
    minimumAnimationDurationSeconds: minimumVisibleVisualAnimationDurationSeconds(visibleNodes),
    pending
  })
  if (!plan.shouldRender) {
    if (canvas.value?.dataset) canvas.value.dataset.visualAnimationState = 'paced'
    return null
  }
  visualAnimationLastFrameTimestamp = plan.frameTimestamp
  visualAnimationFrameIntervalMs = plan.intervalMs
  queueVisualAnimationTimestamp(plan.frameTimestamp)
  return flushPendingVisualAnimationRender()
}

function syncVisualAnimationClock() {
  const shouldRun = Boolean(
    props.active
    && !visualAnimationReducedMotion
    && props.incrementalRuntime
    && committedVisualAnimationNodeMap.size
    && committedStaticSurface
    && committedStaticFrame?.renderNodes
    && committedCompositeSurface
    && canvas.value
    && !renderScheduler.state.pending
    && typeof props.spatialIndex?.createQueryCursor === 'function'
  )
  if (!shouldRun) {
    releaseVisualAnimationClock()
    if (canvas.value?.dataset) canvas.value.dataset.visualAnimationClock = 'stopped'
    return
  }
  if (visualAnimationClock) {
    if (canvas.value?.dataset) canvas.value.dataset.visualAnimationClock = 'running'
    return
  }
  visualAnimationClock = acquireVisualClock(VISUAL_ANIMATION_CLOCK_FPS)
  stopVisualAnimationClockWatch = watch(
    visualAnimationClock,
    requestVisualAnimationRender,
    { flush: 'sync', immediate: true }
  )
  if (canvas.value?.dataset) canvas.value.dataset.visualAnimationClock = 'running'
}

function geometryNodeLookup(nodes) {
  const overrides = new Map(nodes.map(node => [node.id, node]))
  return Object.freeze({
    get(id) {
      return overrides.get(id) ?? props.nodeIndex?.get?.(id)
    }
  })
}

function geometrySnapshot(source = {}) {
  const nodes = (Array.isArray(source.nodes) ? source.nodes : []).filter(Boolean)
  const edges = (Array.isArray(source.edges) ? source.edges : []).filter(Boolean)
  const drawings = (Array.isArray(source.drawings) ? source.drawings : []).filter(Boolean)
  return {
    nodes,
    edges,
    drawings,
    activeNodeIds: new Set(nodes.map(node => node.id)),
    nodeOpacityMultiplier: alpha(source.nodeOpacityMultiplier),
    nodeLookup: geometryNodeLookup(nodes),
    animationTimestamp: currentAnimationTimestamp(),
    revision: number(source.geometryRevision)
  }
}

function geometryRegions(snapshot) {
  return editorLodGeometryRegions({
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    drawings: snapshot.drawings,
    nodeIndex: snapshot.nodeLookup,
    stageWidth: committedStaticFrame?.stageWidth ?? props.stageWidth,
    stageHeight: committedStaticFrame?.stageHeight ?? props.stageHeight,
    maxSegments: EDITOR_LOD_GEOMETRY_MAX_SEGMENTS
  })
}

function geometryOwnersForRegion(index, region) {
  const segments = index?.query?.(region, { sort: false, limit: GEOMETRY_QUERY_LIMIT }) || []
  if (segments.length >= GEOMETRY_QUERY_LIMIT) return null
  const owners = new Map()
  for (const segment of segments) {
    if (segment?.owner?.id != null) owners.set(segment.owner.id, segment.owner)
  }
  return owners
}

function geometryPatchPlans(snapshot, regions) {
  const frame = committedStaticFrame
  if (
    !frame
    || !committedEdgeSpatialIndex
    || !committedDrawingSpatialIndex
    || (frame.renderNodes && typeof props.spatialIndex?.query !== 'function')
  ) return null
  const activeNodes = frame.renderNodes
    ? new Map(snapshot.nodes.map(node => [node.id, node]))
    : new Map()
  const activeEdges = new Map(snapshot.edges.map(edge => [edge.id, edge]))
  const activeDrawings = frame.renderDrawings
    ? new Map(snapshot.drawings.map(drawing => [drawing.id, drawing]))
    : new Map()
  const plans = []
  let totalPixels = 0
  let totalCandidates = 0

  for (const region of regions) {
    const bitmapRect = runtimeBitmapRect(region, frame, 2)
    if (!bitmapRect) continue
    const pixels = bitmapRect.w * bitmapRect.h
    if (pixels > GEOMETRY_MAX_PATCH_PIXELS || totalPixels + pixels > GEOMETRY_MAX_TOTAL_PATCH_PIXELS) return null

    const queriedNodes = frame.renderNodes
      ? props.spatialIndex.query(region, { sort: false, limit: GEOMETRY_QUERY_LIMIT })
      : []
    if (queriedNodes.length >= GEOMETRY_QUERY_LIMIT) return null
    const nodes = new Map(queriedNodes.map(node => [node.id, node]))
    const edges = geometryOwnersForRegion(committedEdgeSpatialIndex, region)
    const drawings = frame.renderDrawings
      ? geometryOwnersForRegion(committedDrawingSpatialIndex, region)
      : new Map()
    if (!edges || !drawings) return null
    for (const [id, node] of activeNodes) nodes.set(id, node)
    for (const [id, edge] of activeEdges) edges.set(id, edge)
    for (const [id, drawing] of activeDrawings) drawings.set(id, drawing)

    const candidateCount = nodes.size + edges.size + drawings.size
    totalCandidates += candidateCount
    if (candidateCount >= GEOMETRY_QUERY_LIMIT || totalCandidates > GEOMETRY_TOTAL_CANDIDATE_LIMIT) return null

    const entities = [
      ...[...nodes.values()].map(entity => ({ kind: 'node', entity })),
      ...[...drawings.values()].map(entity => ({ kind: 'drawing', entity }))
    ].sort((left, right) => number(left.entity?.layer) - number(right.entity?.layer))
    plans.push({
      region,
      bitmapRect,
      edges: [...edges.values()],
      entities
    })
    totalPixels += pixels
  }
  return plans
}

function needsIncrementalTextLayout(plans) {
  const frame = committedStaticFrame
  if (!frame?.renderNodes) return false
  const worldPixel = 1 / Math.max(.0001, Math.min(frame.scaleX, frame.scaleY))
  const inspected = new Set()
  for (const plan of plans) {
    for (const item of plan.entities) {
      if (item.kind !== 'node' || !item.entity || inspected.has(item.entity.id)) continue
      inspected.add(item.entity.id)
      if (longTextLayoutDescriptor(
        item.entity,
        frame.scaleX,
        frame.scaleY,
        worldPixel,
        'full'
      )) return true
    }
  }
  return false
}

function drawGeometryStaticPlan(ctx, plan, snapshot) {
  const frame = committedStaticFrame
  const rect = plan.bitmapRect
  const worldPixel = 1 / Math.max(.0001, Math.min(frame.scaleX, frame.scaleY))
  ctx.save()
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
    ctx.setTransform(frame.pixelRatioX, 0, 0, frame.pixelRatioY, 0, 0)
    ctx.translate(frame.offsetX, frame.offsetY)
    ctx.scale(frame.scaleX, frame.scaleY)
    ctx.fillStyle = props.background || '#f7f8fa'
    ctx.fillRect(0, 0, frame.stageWidth, frame.stageHeight)
    for (const edge of plan.edges) drawEdge(ctx, edge, worldPixel, snapshot.nodeLookup)
  } finally {
    ctx.restore()
  }
}

function drawGeometryCompositePlan(ctx, plan, snapshot) {
  const frame = committedStaticFrame
  const rect = plan.bitmapRect
  const worldPixel = 1 / Math.max(.0001, Math.min(frame.scaleX, frame.scaleY))
  ctx.save()
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
    ctx.drawImage(
      committedStaticSurface,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    )
    ctx.setTransform(frame.pixelRatioX, 0, 0, frame.pixelRatioY, 0, 0)
    ctx.translate(frame.offsetX, frame.offsetY)
    ctx.scale(frame.scaleX, frame.scaleY)
    for (const item of plan.entities) {
      if (item.kind === 'node') {
        if (!frame.renderNodes) continue
        const opacityMultiplier = snapshot.activeNodeIds.has(item.entity.id) ? snapshot.nodeOpacityMultiplier : 1
        drawNode(ctx, item.entity, frame.scaleX, frame.scaleY, worldPixel, 'full', opacityMultiplier, {
          animationTimestamp: snapshot.animationTimestamp
        })
      }
      else if (frame.renderDrawings) drawTemporaryDrawing(ctx, item.entity, worldPixel)
    }
  } finally {
    ctx.restore()
  }
}

function replaceGeometryOwnerSegments(kind, entities, nodeLookup) {
  if (kind === 'drawing' && committedStaticFrame?.renderDrawings === false) return true
  const index = kind === 'edge' ? committedEdgeSpatialIndex : committedDrawingSpatialIndex
  const idsByOwner = kind === 'edge' ? committedEdgeSegmentIds : committedDrawingSegmentIds
  for (const entity of entities) {
    for (const id of idsByOwner.get(entity.id) || []) index.remove(id)
    const segments = editorLodIndexSegments(kind, entity, nodeLookup, {
      stageWidth: committedStaticFrame.stageWidth,
      stageHeight: committedStaticFrame.stageHeight,
      maxSegments: EDITOR_LOD_GEOMETRY_MAX_SEGMENTS
    })
    if (segments.length > EDITOR_LOD_GEOMETRY_MAX_SEGMENTS) return false
    if (kind === 'drawing' && entity.points.length >= 2 && !segments.length) return false
    for (const segment of segments) index.update(segment)
    idsByOwner.set(entity.id, segments.map(segment => segment.id))
  }
  return true
}

function removeGeometryOwnerSegments(kind, entities) {
  if (kind === 'drawing' && committedStaticFrame?.renderDrawings === false) return true
  const index = kind === 'edge' ? committedEdgeSpatialIndex : committedDrawingSpatialIndex
  const idsByOwner = kind === 'edge' ? committedEdgeSegmentIds : committedDrawingSegmentIds
  if (!index) return false
  for (const entity of entities) {
    for (const id of idsByOwner.get(entity.id) || []) index.remove(id)
    idsByOwner.delete(entity.id)
  }
  return true
}

function commitGeometryPlans(plans, snapshot) {
  if (!plans.length || needsIncrementalTextLayout(plans)) return false
  releaseRuntimeBackSurface()
  const target = canvas.value

  try {
    const staticContext = committedStaticSurface?.getContext?.('2d')
    const compositeContext = committedCompositeSurface?.getContext?.('2d')
    const targetContext = target?.getContext?.('2d')
    if (!staticContext || !compositeContext) throw new Error('geometry backing context unavailable')
    const contextToken = canvasContextGate.capture(target)
    if (!canvasContextGate.accepts(contextToken, target, targetContext)) {
      if (!targetContext) reportCanvasRenderError(canvasContextGate.state().lost ? 'context-lost' : 'context-unavailable')
      return false
    }
    for (const plan of plans) drawGeometryStaticPlan(staticContext, plan, snapshot)
    for (const plan of plans) drawGeometryCompositePlan(compositeContext, plan, snapshot)
    return commitCanvasSurface(targetContext, committedCompositeSurface, plans.map(plan => plan.bitmapRect))
  } catch (error) {
    committedGeometryIndexesComplete = false
    reportCanvasRenderError('geometry-commit-failed', error)
    requestCoalescedRender()
    return false
  }
}

function applyGeometrySnapshot(session, snapshot) {
  const current = geometryRegions(snapshot)
  if (current.truncated) return false
  const merged = mergeEditorLodGeometryRegions([...session.lastRegions, ...current.regions], {
    stageWidth: committedStaticFrame?.stageWidth ?? props.stageWidth,
    stageHeight: committedStaticFrame?.stageHeight ?? props.stageHeight
  })
  if (merged.truncated || !merged.regions.length) return false
  const plans = geometryPatchPlans(snapshot, merged.regions)
  if (!plans?.length) return false
  if (!commitGeometryPlans(plans, snapshot)) return false

  const indexesUpdated = replaceGeometryOwnerSegments('edge', snapshot.edges, snapshot.nodeLookup)
    && replaceGeometryOwnerSegments('drawing', snapshot.drawings, snapshot.nodeLookup)
  if (!indexesUpdated) committedGeometryIndexesComplete = false
  session.lastRegions = current.regions
  session.revision = Math.max(session.revision, snapshot.revision)
  return indexesUpdated
}

function beginRuntimeBackingMutation(reason) {
  const needsReplay = runtimeRenderScheduler.state.pending
    || runtimeRenderDirty
    || runtimeRenderFollowUpPending()
  runtimeRenderScheduler.invalidate(reason)
  runtimeRenderEpoch += 1
  runtimeDenseStreamStarted = false
  clearRuntimeDenseStreamTimer()
  releaseRuntimeBackSurface()
  if (needsReplay) {
    pendingRuntimeDense = true
    runtimeRenderDirty = true
  }
  return needsReplay
}

function patchRemovedEntities(source = {}) {
  if (!props.active) {
    geometryInteraction = null
    return false
  }
  if (!props.geometryInteractive || geometryInteraction || !committedGeometryIndexesComplete) return false
  const removed = geometrySnapshot(source)
  const dirty = geometryRegions(removed)
  if (dirty.truncated || !dirty.regions.length) return false
  const merged = mergeEditorLodGeometryRegions(dirty.regions, {
    stageWidth: committedStaticFrame?.stageWidth ?? props.stageWidth,
    stageHeight: committedStaticFrame?.stageHeight ?? props.stageHeight
  })
  if (merged.truncated) return false

  const replayRuntime = beginRuntimeBackingMutation('geometry-removal')
  removeGeometryOwnerSegments('edge', removed.edges)
  removeGeometryOwnerSegments('drawing', removed.drawings)
  const current = geometrySnapshot({ geometryRevision: source.geometryRevision })
  const plans = geometryPatchPlans(current, merged.regions)
  if (!plans || !commitGeometryPlans(plans, current)) {
    committedGeometryIndexesComplete = false
    if (replayRuntime) requestCoalescedRender()
    return false
  }
  committedGeneration.value += 1
  renderReady.value = true
  if (replayRuntime) scheduleRuntimeRender()
  return true
}

function beginGeometryInteraction(source = {}) {
  if (!props.active) {
    geometryInteraction = null
    return null
  }
  if (!props.geometryInteractive) return null
  const snapshot = geometrySnapshot(source)
  const initial = geometryRegions(snapshot)
  renderScheduler.invalidate('geometry')
  beginRuntimeBackingMutation('geometry')
  coalescedRenderDirty = false
  const readyForCanvas = Boolean(
    committedStaticSurface
    && committedCompositeSurface
    && committedStaticFrame
    && committedGeometryIndexesComplete
    && canvas.value
    && typeof props.spatialIndex?.query === 'function'
  )
  const session = {
    id: nextGeometrySessionId++,
    state: 'active',
    revision: snapshot.revision,
    targetFullGeneration: null,
    fullDirty: false,
    refreshQueued: false,
    lastRegions: initial.truncated ? [] : initial.regions,
    mode: readyForCanvas && !initial.truncated ? 'canvas' : readyForCanvas ? 'bounds' : 'dom'
  }
  geometryInteraction = session
  return { sessionId: session.id, mode: session.mode, revision: session.revision }
}

function requestGeometryInteractionFrame(sessionId, source = {}) {
  if (!props.active) {
    geometryInteraction = null
    return null
  }
  const session = geometryInteraction
  if (!session || session.id !== sessionId || session.state !== 'active') return null
  const snapshot = geometrySnapshot(source)
  if (snapshot.revision < session.revision) return { sessionId, mode: session.mode, committed: false, revision: session.revision }
  let committed = false
  if (session.mode === 'canvas') {
    committed = applyGeometrySnapshot(session, snapshot)
    if (!committed) session.mode = 'bounds'
  } else {
    session.revision = Math.max(session.revision, snapshot.revision)
  }
  return { sessionId, mode: session.mode, committed, revision: session.revision }
}

function finishGeometryInteraction(sessionId, source = {}) {
  if (!props.active) {
    geometryInteraction = null
    return null
  }
  const session = geometryInteraction
  if (!session || session.id !== sessionId || session.state !== 'active') return null
  const finalFrame = source && (source.nodes || source.edges || source.drawings)
    ? requestGeometryInteractionFrame(sessionId, source)
    : null
  if (geometryInteraction !== session) return null
  session.state = 'awaiting-full'
  session.revision = Math.max(session.revision, number(source.geometryRevision, session.revision))
  session.fullDirty = false
  session.refreshQueued = false
  session.targetFullGeneration = startGeometryFullRender(session)
  return {
    sessionId: session.id,
    mode: session.mode,
    committed: finalFrame?.committed === true,
    revision: session.revision,
    targetFullGeneration: session.targetFullGeneration
  }
}

function cancelGeometryInteraction(sessionId) {
  if (!geometryInteraction || (sessionId != null && geometryInteraction.id !== sessionId)) return false
  geometryInteraction = null
  if (runtimeRenderDirty || runtimeRenderFollowUpPending()) {
    if (canIncrementRuntime()) scheduleRuntimeRender()
    else requestCoalescedRender()
  }
  return true
}

function scheduleRuntimeRender(options = {}) {
  if (!props.active) {
    suspendedRenderDirty = true
    return null
  }
  if (
    geometryInteraction
    || (!pendingRuntimeDense && !pendingRuntimeNodes.size)
    || runtimeRenderScheduler.state.pending
    || !canIncrementRuntime()
  ) return null
  if (runtimeDenseStreamOpen && runtimeDenseStreamStarted) {
    queueRuntimeDenseStreamFlush()
    return null
  }
  const allowDense = options.allowDense !== false
  const denseAvailable = allowDense && Array.isArray(props.orderedEntities)
  if (pendingRuntimeDense && !denseAvailable && !pendingRuntimeNodes.size) {
    pendingRuntimeDense = false
    runtimeRenderDirty = false
    return requestCoalescedRender()
  }
  const dense = denseAvailable && (
    pendingRuntimeDense
    || (options.visualAnimationFrame !== true && shouldUseDenseRuntime({
      available: true,
      nodeCount: pendingRuntimeNodes.size
    }))
  )
  const nodeCount = pendingRuntimeNodes.size
  const nodes = dense
    ? []
    : takePendingRuntimeNodeBatch(options.visualAnimationFrame === true
      ? Math.max(1, nodeCount)
      : RUNTIME_RENDER_NODE_BATCH_SIZE)
  if (dense) pendingRuntimeNodes = new Map()
  pendingRuntimeDense = false
  runtimeRenderDirty = false
  if (dense && runtimeDenseStreamOpen) runtimeDenseStreamStarted = true
  return runtimeRenderScheduler.request({
    epoch: runtimeRenderEpoch,
    target: canvas.value,
    contextToken: canvasContextGate.capture(canvas.value),
    base: committedStaticSurface,
    composite: committedCompositeSurface,
    frame: committedStaticFrame,
    spatialIndex: props.spatialIndex,
    drawingSpatialIndex: props.drawingSpatialIndex,
    hasDrawings: props.drawings.length > 0,
    entities: allowDense ? props.orderedEntities : null,
    excludedNodeIds: committedExcludedNodeIds,
    excludedDrawingIds: committedExcludedDrawingIds,
    nodes,
    nodeCount,
    dense,
    allowDense,
    animationTimestamp: options.animationTimestamp,
    visualAnimationFrame: options.visualAnimationFrame === true,
    visualAnimationNodeCount: options.visualAnimationNodeCount,
    visualAnimationVisibleCount: options.visualAnimationVisibleCount,
    visualAnimationPreparationMs: options.visualAnimationPreparationMs,
    visualAtlasDirectRect: options.visualAtlasDirectRect,
    visualAtlasDirectFrame: options.visualAtlasDirectFrame
  })
}

function startFullRender(metadata = {}) {
  releaseVisualAnimationClock()
  invalidateCanvasVisualDirectAtlasFrame()
  clearCanvasVisualAtlasFrameCache()
  canvasVisualSpriteDescriptorCache = new WeakMap()
  resetCanvasVisualSignatureIds()
  visualAnimationClipTarget = null
  visualAnimationClipAncestors = []
  runtimeRenderScheduler.invalidate('full-render')
  invalidateIncrementalRuntime()
  committedTimeNodes = []
  if (!renderScheduler.state.pending) {
    replaceCommittedStaticSurface(null)
    replaceCommittedCompositeSurface(null)
    replaceCommittedGeometryIndexes(null, null)
  }
  if (!committedGeneration.value) renderReady.value = false
  return renderScheduler.request({ ...renderPayload(), ...metadata })
}

function markGeometryFullDirty() {
  const session = geometryInteraction
  if (!session) return false
  session.fullDirty = true
  if (session.state === 'awaiting-full') queueGeometryFullRefresh(session)
  return true
}

function scheduleRender() {
  if (!props.active) {
    suspendedRenderDirty = true
    return renderScheduler.state.generation
  }
  suspendedRenderDirty = false
  if (markGeometryFullDirty()) return renderScheduler.state.generation
  coalescedRenderDirty = false
  return startFullRender()
}

function requestCoalescedRender() {
  if (!props.active) {
    suspendedRenderDirty = true
    return renderScheduler.state.generation
  }
  suspendedRenderDirty = false
  if (markGeometryFullDirty()) return renderScheduler.state.generation
  if (renderScheduler.state.pending) {
    coalescedRenderDirty = true
    return renderScheduler.state.generation
  }
  // 新任务已经吸收此前的合并请求，避免成功提交后再无意义地完整重绘一次。
  coalescedRenderDirty = false
  return startFullRender()
}

function invalidatePendingRender(reason = 'invalidated') {
  releaseVisualAnimationClock()
  renderScheduler.invalidate(reason)
  runtimeRenderScheduler.invalidate(reason)
  coalescedRenderDirty = false
  invalidateIncrementalRuntime()
}

function requestRuntimeRender(changedNodes) {
  if (!props.active) {
    suspendedRenderDirty = true
    return runtimeRenderScheduler.state.generation
  }
  if (props.renderNodes === false) return runtimeRenderScheduler.state.generation
  if (changedNodes == null) return requestCoalescedRender()
  const request = runtimeRenderRequest(changedNodes)
  updateRuntimeDenseStream(request)
  const nodes = resolveChangedRuntimeNodes(request.nodes)
  syncRuntimeVisualAnimationNodes(nodes)
  for (const node of nodes) pendingRuntimeNodes.set(node.id ?? node, node)
  if (!nodes.length && !pendingRuntimeDense && !pendingRuntimeNodes.size) {
    const pendingFull = renderScheduler.state.pending
    const pendingRuntime = runtimeRenderScheduler.state.pending || runtimeRenderDirty || runtimeRenderFollowUpPending()
    emit('render-complete', {
      generation: committedGeneration.value,
      renderGeneration: runtimeRenderScheduler.state.generation,
      kind: 'runtime',
      settled: !pendingFull && !pendingRuntime,
      pendingFull,
      pendingRuntime
    })
    return runtimeRenderScheduler.state.generation
  }
  if (geometryInteraction) {
    runtimeRenderDirty = true
    return runtimeRenderScheduler.state.generation
  }
  if (!canIncrementRuntime()) {
    if (
      props.incrementalRuntime
      && renderScheduler.state.pending
      && canvas.value
      && typeof props.spatialIndex?.createQueryCursor === 'function'
    ) {
      runtimeRenderDirty = true
      return renderScheduler.state.generation
    }
    return requestCoalescedRender()
  }
  if (runtimeRenderScheduler.state.pending) {
    runtimeRenderDirty = true
    if (runtimeDenseStreamOpen && runtimeDenseStreamStarted) queueRuntimeDenseStreamFlush()
    return runtimeRenderScheduler.state.generation
  }
  return scheduleRuntimeRender()
}

function requestTimeRender() {
  if (!props.active) {
    suspendedRenderDirty = true
    return runtimeRenderScheduler.state.generation
  }
  if (props.renderNodes === false) return runtimeRenderScheduler.state.generation
  if (!committedTimeNodes.length) return runtimeRenderScheduler.state.generation
  if (!props.incrementalRuntime) return requestCoalescedRender()
  if (shouldUseDenseRuntime({
    available: Array.isArray(props.orderedEntities),
    nodeCount: committedTimeNodes.length
  })) {
    return requestRuntimeRender({ nodes: [], dense: true, pending: false })
  }
  return requestRuntimeRender(committedTimeNodes)
}

function getCanvasElement() {
  return canvas.value
}

function resumeCommittedAnimationClock() {
  if (!props.active) return false
  syncVisualAnimationClock()
  return Boolean(visualAnimationClock)
}

defineExpose({
  requestRender: scheduleRender,
  requestCoalescedRender,
  invalidatePendingRender,
  requestRuntimeRender,
  beginGeometryInteraction,
  requestGeometryInteractionFrame,
  finishGeometryInteraction,
  cancelGeometryInteraction,
  patchRemovedEntities,
  resumeCommittedAnimationClock,
  getCanvasElement,
  renderState: renderScheduler.state,
  runtimeRenderState: runtimeRenderScheduler.state
})

// 父级在文档真实变更后递增版本；这里只观察浅层契约，避免任一节点变化都遍历整张图纸。
watch([
  canvas,
  () => props.renderRevision,
  () => props.stageWidth,
  () => props.stageHeight,
  () => props.width,
  () => props.height,
  () => props.viewBox,
  () => props.background,
  () => props.fitMode,
  () => props.maxBitmapPixels,
  () => props.pixelRatio,
  () => props.incrementalRuntime,
  () => props.geometryInteractive,
  () => props.renderNodes,
  () => props.renderDrawings,
  () => props.spatialIndex,
  () => props.edgeSpatialIndex,
  () => props.drawingSpatialIndex,
  () => props.renderMode,
  () => props.waitForImages,
  () => props.preferText,
  () => props.faithful,
  () => props.minimumScreenTextSize,
  () => props.minimumScreenStrokeSize,
  () => props.nodes,
  () => props.nodes.length,
  () => props.edges,
  () => props.edges.length,
  () => props.drawings,
  () => props.drawings.length,
  () => props.nodeIndex,
  () => props.orderedEntities,
  () => props.excludedNodeIds,
  () => props.excludedDrawingIds,
  () => props.renderPlanKey,
  () => props.runtimeStore
], () => {
  if (!props.active) {
    suspendedRenderDirty = true
    return
  }
  if (props.frameCommitToken != null && !previewFrameCommitRequested(props.frameCommitToken)) return
  scheduleRender()
}, { immediate: true, flush: 'post' })

watch(() => props.frameCommitToken, token => {
  if (!props.active) {
    suspendedRenderDirty = true
    return
  }
  if (previewFrameCommitRequested(token)) scheduleRender()
}, { flush: 'post' })

watch(() => props.active, active => {
  if (active) {
    const renderRequested = suspendedRenderDirty && (
      props.frameCommitToken == null
      || previewFrameCommitRequested(props.frameCommitToken)
    )
    if (renderRequested) scheduleRender()
    else syncVisualAnimationClock()
    return
  }
  suspendedRenderDirty = true
  geometryInteraction = null
  releaseVisualAnimationClock()
  imageRenderTrigger.cancel()
  invalidatePendingRender('suspended')
  invalidateIncrementalRuntime()
}, { flush: 'sync' })

watch([
  () => props.timeContext?.tick?.value,
  () => props.timeContext?.serverOffset?.value
], requestTimeRender, { flush: 'post' })

onBeforeUnmount(() => {
  detachVisualAnimationMotionPreference()
  releaseVisualAnimationClock()
  imageRenderTrigger.dispose()
  edgeRasterWorkerClient.dispose()
  resetTaskRenderFrameYield()
  resetAnimationRenderBurst()
  canvasContextGate.release(canvas.value)
  geometryInteraction = null
  coalescedRenderDirty = false
  suspendedRenderDirty = false
  invalidateIncrementalRuntime()
  runtimeRenderScheduler.dispose()
  renderScheduler.dispose()
  replaceCommittedStaticSurface(null)
  replaceCommittedCompositeSurface(null)
  replaceCommittedGeometryIndexes(null, null)
  clearReusableRenderSurfaces()
  clearReusableVisualSpriteSurfaces()
  releaseCanvasVisualAtlasResources()
  committedTimeNodes = []
  committedVisualAnimationNodes = []
  committedVisualAnimationNodeMap.clear()
  committedSignalLightColors.clear()
  committedDirectSignalLightTimestamp = null
  visibleVisualAnimationNodes = []
  resetVisualAnimationFramePacing()
  visualAnimationViewportKey = ''
  visualAnimationViewportDirty = true
  visualAnimationClipTarget = null
  visualAnimationClipAncestors = []
  visualAnimationTimeline.clear()
  committedExcludedNodeIds = new Set()
  committedExcludedDrawingIds = new Set()
  clearImageCache()
  taskRenderCallbacks.clear()
  taskRenderChannel?.port1.close()
  taskRenderChannel?.port2.close()
  taskRenderChannel = null
})
</script>

<template>
  <canvas
    ref="canvas"
    class="minimap-preview"
    :data-testid="testId"
    :data-render-ready="renderReady ? 'true' : 'false'"
    :data-render-generation="committedGeneration"
    :data-render-plan-key="committedRenderPlanKey"
    :data-render-width="atomicCssSize && committedCssWidth ? committedCssWidth : width"
    :data-render-height="atomicCssSize && committedCssHeight ? committedCssHeight : height"
    :style="{ width: `${atomicCssSize && committedCssWidth ? committedCssWidth : width}px`, height: `${atomicCssSize && committedCssHeight ? committedCssHeight : height}px`, backgroundColor: background }"
    role="img"
    :aria-label="ariaLabel"
    @contextlost="handleCanvasContextLost"
    @contextrestored="handleCanvasContextRestored"
  ></canvas>
</template>
