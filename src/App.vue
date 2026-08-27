<script setup>
import { computed, markRaw, nextTick, onMounted, onUnmounted, onUpdated, ref, shallowRef, toRaw, triggerRef, watch } from 'vue'
import {
  AlignCenterHorizontal, AlignCenterVertical, Box, BringToFront, ChevronDown, ChevronRight, ChevronsDown,
  ChevronsUp, Copy, FileJson, FolderOpen, Grid3X3, Group, HardDrive, Layers3, Lock, Maximize2,
  PackagePlus, PanelRightClose, Pencil, Pin, PinOff, Play, Plus, Redo2, RefreshCw, RotateCcw, Save, Scaling,
  Search, Square, TableCellsMerge, TableCellsSplit, TableProperties, Trash2, Undo2, Ungroup, Unlock, Video,
  X, ZoomIn, ZoomOut
} from 'lucide-vue-next'
import NodeVisual from './components/NodeVisual.vue'
import MiniMapPreview from './components/MiniMapPreview.vue'
import BrandMark from './components/BrandMark.vue'
import ProgressivePreviewGeometry from './components/ProgressivePreviewGeometry.vue'
import ProgressivePreviewNodes from './components/ProgressivePreviewNodes.vue'
import DataSourceManager from './components/DataSourceManager.vue'
import CommunicationBindingPanel from './components/CommunicationBindingPanel.vue'
import { useRuntimeData } from './composables/useRuntimeData'
import {
  ANIMATION_DEFAULTS as animationDefaults,
  COMPONENT_CATEGORY_BY_TYPE as typeCategory,
  COMPONENT_NAME_BY_TYPE as typeDisplayName,
  createComponentGroups,
  EDITOR_TOOLS as tools,
  FORM_NODE_DEFAULTS as formNodeDefaults,
  FORM_TYPE_IDS as formTypeIds,
  SHAPE_DEFAULTS as shapeDefaults,
  WORKSPACE_TOOLS as workspaceTools
} from './config/componentCatalog'
import {
  baseNodeOptions,
  builtInVisualPrimaryColor,
  clampTableColumnWidth,
  normalizeDrawing,
  normalizeEdge,
  normalizeNode,
  normalizeNodesTogether,
  normalizeSelectOptions,
  normalizeTableMerges,
  normalizeTableModel
} from './models/editorModel'
import { drawingRepository, operationGateway, pointCatalogGateway, runtimeGateway, timeService } from './services/backend'
import {
  ANIMATION_DURATION_MIN_SECONDS,
  BUILT_IN_ANIMATION_DURATION_MAX_SECONDS,
  getBindableParameter,
  getBindableParameters,
  MAX_SIGNAL_COLORS
} from './config/componentBindingSchema'
import {
  bindingSourceIds,
  bindingPointIds,
  removeDataBinding,
  upsertDataBinding
} from './models/dataBindingModel'
import { createSourceBindingRuntime } from './services/sourceBindingRuntime'
import {
  createWorkspaceSessionRestoreSource,
  createWorkspaceSessionSaveQueue,
  createWorkspaceSessionStore,
  encodeBoundedJsonText,
  isChunkedWorkspaceSessionRecord
} from './services/workspaceSessionStore'
import { anchoredCanvasScroll, clampCanvasZoom, expandCanvasBounds, MIN_CANVAS_ZOOM, steppedCanvasZoom } from './utils/canvasViewport'
import { edgeBoundsForNodes, edgeEndpointsForNodes } from './utils/edgeGeometry'
import { createDataKeyIndex, createEdgeAdjacencyIndex, createLayerAllocator } from './utils/documentIndexes'
import { createDataBindingIndex } from './utils/dataBindingIndex'
import { createRuntimeCanvasDirtyQueue, DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE } from './utils/runtimeCanvasDirtyQueue'
import { directBindingCompatibility } from './utils/dataBindingCompatibility'
import { diffPointCatalog } from './utils/pointCatalogDiff'
import { canonicalizeJsonPath, evaluateJsonPath, jsonValueType } from './utils/jsonPathBinding'
import { isSourceBindingRuntimeKey } from './utils/runtimeKey'
import { normalizeWorkspaceId } from './utils/workspaceIdentity'
import { drawingPointSourceScopeId } from './utils/drawingPointSourceScope'
import { applyEntityEntry, captureEntityEntry, createEntityInsertionEntry } from './utils/entityHistory'
import {
  applyFieldRecord,
  applyListRecords,
  captureFieldRecord,
  captureInverseFieldRecord,
  captureInverseListRecords,
  cloneHistoryValue,
  createListInsertionRecords,
  createListRemovalRecords,
  fieldRecordChanged,
  historyValueBytes
} from './utils/historyPatches'
import { clampNumber, constrainNodeCollectionTranslation, constrainTranslation, finiteNumber, MAX_EDITOR_STAGE_SIZE, nodeMinimumSize, normalizeNodeGeometry, normalizedVisualScale, resizeFrameWithinBounds, resizeRotatedFrameWithinBounds, rotatedFrameBounds, rotationScaleWeights, transformNodeCollectionWithinStage } from './utils/editorGeometry'
import {
  editorLodDetailClipPath as createEditorLodDetailClipPath,
  editorLodDetailFallbackRegions as resolveEditorLodDetailFallbackRegions,
  editorLodRemovalCoverRegions as mergeEditorLodRemovalRegions,
  editorLodOverlayEdges,
  editorLodOverlayNodeIds,
  EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD,
  EDITOR_LOD_MAX_OVERLAY_NODES,
  pickTopEditorEntity,
  shouldHideEditorLodGeometryDom,
  shouldUseAnimatedFlowDirectionLod,
  shouldUseEditorLod
} from './utils/editorLod'
import { formatTimeValue, parseTimeValue, resolveTimeValue, timeInputStep, timeInputType } from './utils/formTime'
import { isImeCompositionEvent } from './utils/keyboard'
import { largeSelectionPreviewBounds as previewLargeSelectionBounds } from './utils/largeSelectionTransform'
import { createLargeSelectionTransformTask, runLargeSelectionTransformTaskSlice } from './utils/largeSelectionTransformTask'
import { filterPaperEntries } from './utils/librarySearch'
import { drawingComparisonKey, drawingNamesMatch } from './utils/drawingName'
import { incidentEdgeCountExceedsLimit } from './utils/edgeInteractionPolicy'
import { miniMapTransform, miniMapViewportRect, miniMapWorldPoint } from './utils/miniMapGeometry'
import {
  clampPolylineSegmentCount,
  createEvenlySpacedPolylinePoints,
  DEFAULT_POLYLINE_SEGMENT_COUNT,
  isPolylineNodeType,
  nearestPolylinePointIndex,
  polylineFrameFromWorldPoints,
  polylineNormalizedPointsToLocal,
  polylinePointHandlePaths,
  reframePolylineNode,
  resamplePolylineNodeGeometry,
  worldPointToPolylineLocal
} from './utils/polylineGeometry'
import { previewBitmapIsSharp, previewBitmapPixelBudget, previewBitmapPixelRatio } from './utils/previewBitmapBudget'
import { previewViewportOverscan, previewViewportPixelRatio } from './utils/previewViewportCanvas'
import {
  EDITOR_LOD_FALLBACK_BITMAP_PIXELS,
  editorLodDetailOverscanPixels,
  editorLodDetailPixelRatio as resolveEditorLodDetailPixelRatio,
  editorLodBitmapPixelBudget
} from './utils/editorLodBitmapBudget'
import { editorLodGridPresentation } from './utils/editorLodGrid'
import {
  editorLodDetailGeometryCompletesSession,
  editorLodDetailRenderCompletesSession,
  editorLodFallbackGeometryCompletesSession,
  editorLodGeometryBarrierSettled,
  markEditorLodGeometryLayerComplete,
  markEditorLodGeometryLayerFailed,
  parseRenderGeneration
} from './utils/editorLodGeometryCompletion'
import { EDITOR_LOD_MIN_TEXT_SCREEN_SIZE } from './utils/canvasTextReadability'
import {
  createPreviewFrameFreshness,
  previewFrameTarget
} from './utils/previewFrameFreshness'
import { createPreviewMediaReadinessGate } from './utils/previewMediaReadiness'
import {
  PREVIEW_HYBRID_MAX_DOM_COST,
  PREVIEW_HYBRID_MAX_DOM_NODES,
  previewHybridLayerTail,
  previewHybridTailDomSafe,
  previewNodeNeedsLiveDom
} from './utils/previewRenderPolicy'
import { previewMountBatchEnd } from './utils/previewMountBudget'
import { createPreviewViewportScheduler } from './utils/previewViewportScheduler'
import { PROJECT_VERSION } from './utils/projectMigration'
import { createChunkedRenderScheduler } from './utils/chunkedRenderScheduler'
import { createInteractionCommitBarrier } from './utils/interactionCommitBarrier'
import { createAsyncOperationBarrier } from './utils/asyncOperationBarrier'
import {
  captureNodeBundleSync,
  createNodeBundleCaptureTask,
  createNodeBundleInstanceTask,
  NODE_BUNDLE_FRAME_BUDGET_MS,
  prepareNodeBundleInstanceSync,
  runNodeBundleCaptureSlice,
  runNodeBundleInstanceSlice,
  shouldPrepareNodeBundleAsync
} from './utils/nodeBundleTransactions'
import { createSpatialIndex } from './utils/spatialIndex'
import {
  createProjectJsonParser,
  ProjectJsonParserDisposedError,
  ProjectJsonParserProtocolError
} from './utils/projectJsonParser'
import {
  createProjectRuntimePreparer,
  ProjectRuntimePreparationCancelledError
} from './utils/projectRuntimePreparation'
import { PROJECT_CAPACITY_LIMITS } from './utils/projectValidation'
import { clampCanvasDimension, createEntityId, drawingToPencilNode } from './utils/projectPreparation'
import { createWorkspaceSessionCache, prepareWorkspaceSessionSnapshotAsync } from './utils/workspaceSessionCache'
import { createCancellableIdleTask } from './utils/cancellableIdleTask'
import { createSourceSnapshotReplayCoordinator } from './utils/sourceSnapshotReplayCoordinator'
import { createLegacyPointReplayCoordinator } from './utils/legacyPointReplayCoordinator'
import { isUsableSourceSnapshot } from './utils/sourceSnapshotValidation'
import { resolveTableCellViewDetail } from './utils/tableCellViewer.js'

// 顶部品牌名称只在这里定义，修改后会同步更新显示文字和图标的无障碍名称。
const BRAND_NAME = '苔岑2D绘图'

const groups = ref(createComponentGroups())
const resizeDirections = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const resizeCursorBaseAngle = { e: 0, w: 0, nw: 45, se: 45, n: 90, s: 90, ne: 135, sw: 135 }
const resizeCursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
const ROTATE_HANDLE_CENTER_OFFSET = 44
const ROTATE_HANDLE_HIT_RADIUS = 24
const DEFAULT_STAGE_WIDTH = 6000
const DEFAULT_STAGE_HEIGHT = 4000
const canvasPresetValues = new Set(['1920x1080', '2560x1440', '3840x2160', '6000x4000'])
const DEFAULT_WORKSPACE_ID = '默认工作区'
const ACTIVE_WORKSPACE_STORAGE_KEY = 'tc2d-active-workspace'
const LEGACY_PROJECT_STORAGE_KEY = 'tc2d-project'
const PROJECT_STORAGE_PREFIX = 'tc2d-project:'
const MAX_CACHED_WORKSPACES = 3
const MAX_LOCAL_PROJECT_CACHE_CHARS = 4 * 1024 * 1024
const WORKSPACE_SESSION_IDLE_TIMEOUT_MS = 2500
const WORKSPACE_SESSION_MIN_IDLE_BUDGET_MS = 8
const WORKSPACE_SESSION_RETRY_DELAY_MS = 500
const PREVIEW_FIT_FALLBACK_IDLE_TIMEOUT_MS = 2000
const MAX_PROJECT_NODES = PROJECT_CAPACITY_LIMITS.entities
const MAX_PROJECT_EDGES = PROJECT_CAPACITY_LIMITS.edges
const MAX_PROJECT_DRAWINGS = PROJECT_CAPACITY_LIMITS.drawings
const MAX_CUSTOM_COMPONENTS = PROJECT_CAPACITY_LIMITS.customComponents
const MAX_CUSTOM_COMPONENT_NODES = PROJECT_CAPACITY_LIMITS.customComponentNodes
const MAX_CUSTOM_COMPONENT_EDGES = PROJECT_CAPACITY_LIMITS.customComponentEdges
const MAX_EMBEDDED_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_EMBEDDED_VIDEO_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_URL_LENGTH = 8192
const STRUCTURE_ROW_HEIGHT = 40
const STRUCTURE_OVERSCAN_ROWS = 8
const DEFAULT_VIEWPORT_OVERSCAN = 240
const LARGE_DOCUMENT_OVERSCAN = 96
const LARGE_DOCUMENT_NODE_COUNT = 1500
const EMPTY_NODE_ID_SET = new Set()
const EDITOR_LOD_BOOTSTRAP_ENTITY_LIMIT = 32
const EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD = 128
const EDITOR_PROGRESSIVE_DOM_BATCH_SIZE = 8
const EDITOR_PROGRESSIVE_DOM_MOUNT_COST = 64
const EMPTY_RENDER_LIST = Object.freeze([])
const PREVIEW_DOM_NODE_LIMIT = 512
const PREVIEW_DOM_EDGE_LIMIT = 1024
const PREVIEW_DOM_DRAWING_LIMIT = 512
const PREVIEW_DOM_RETENTION_OVERSCAN = 320
const PREVIEW_DOM_RETENTION_GUARD = 96
const PREVIEW_EDGE_CANVAS_OVERSCAN = 192
const PREVIEW_EDGE_CANVAS_GUARD = 64
const EDITOR_DOM_NODE_LIMIT = 512
const EDITOR_DOM_EDGE_LIMIT = 1024
const EDITOR_LOD_INTERACTION_EDGE_LIMIT = 128
const EDITOR_LOD_DETAIL_OVERSCAN = 192
const EDITOR_LOD_DETAIL_GUARD = 64
const EDITOR_LOD_RECOVERY_RETRY_MS = 250
const RUNTIME_CANVAS_DISPATCH_BUDGET_MS = 2
const RUNTIME_CANVAS_DISPATCH_BATCH_LIMIT = 1
const LARGE_SELECTION_TRANSFORM_THRESHOLD = 128
const LARGE_SELECTION_COMMIT_BUDGET_MS = 2
const EDITOR_LOD_DETAIL_CLIP_SUPPORTED = Boolean(
  globalThis.CSS?.supports?.(
    'clip-path',
    'polygon(0 0, 100% 0, 100% 100%, 0 100%)'
  ) || globalThis.CSS?.supports?.(
    '-webkit-clip-path',
    'polygon(0 0, 100% 0, 100% 100%, 0 100%)'
  )
)
const projectJsonParser = createProjectJsonParser()
const projectRuntimePreparer = createProjectRuntimePreparer()
const workspaceSessionStore = createWorkspaceSessionStore()
const workspaceSessionSaveQueue = createWorkspaceSessionSaveQueue(workspaceSessionStore)
const workspaceSessionIdleTask = createCancellableIdleTask({ timeout: WORKSPACE_SESSION_IDLE_TIMEOUT_MS })
const previewFitFallbackIdleTask = createCancellableIdleTask({ timeout: PREVIEW_FIT_FALLBACK_IDLE_TIMEOUT_MS })
let previewFitEnsureGeneration = 0
const workspaceAsyncOperationBarrier = createAsyncOperationBarrier()

function currentDevicePixelRatio() {
  const value = Number(globalThis.devicePixelRatio)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function isEmbeddedVideoSource(value) {
  return String(value || '').slice(0, 5).toLowerCase() === 'data:'
}

function embeddedDataUrlByteLength(value) {
  const source = String(value || '')
  if (!isEmbeddedVideoSource(source)) return 0
  const separator = source.indexOf(',')
  if (separator < 0) return 0
  const payloadLength = source.length - separator - 1
  if (!source.slice(0, separator).toLowerCase().endsWith(';base64')) return payloadLength
  const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(payloadLength * 3 / 4) - padding)
}

function formatMediaBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function initialWorkspaceId() {
  let queryValue = ''
  let sessionValue = ''
  let legacyValue = ''
  try {
    queryValue = new URLSearchParams(window.location.search).get('workspace') || ''
  } catch {}
  try {
    sessionValue = sessionStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || ''
  } catch {}
  if (!sessionValue) {
    try {
      legacyValue = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || ''
      if (legacyValue) {
        sessionStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, normalizeWorkspaceId(legacyValue))
        localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
      }
    } catch {}
  }
  return normalizeWorkspaceId(queryValue || sessionValue || legacyValue, DEFAULT_WORKSPACE_ID)
}

function storageKeyForWorkspace(id) {
  return `${PROJECT_STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspaceId(id, DEFAULT_WORKSPACE_ID))}`
}

// 文档状态：图纸内容、选择、视图和文件会话在此集中声明，便于追踪生命周期。
// 持久化实体与当前选择
const nodes = ref([])
const edges = ref([])
const drawings = ref([])
let entityLayerAllocator = createLayerAllocator()
const selectedId = ref(null)
const selectedNodeIds = ref([])
const selectedDrawingId = ref(null)
const customComponents = ref([])
// 编辑器视图与面板状态
const paperSelected = ref(false)
const activeTool = ref('select')
const zoom = ref(1)
const canvasLocked = ref(false)
const lockedCanvasView = ref(null)
const showGrid = ref(true)
const snap = ref(false)
const gridSize = ref(20)
const showMiniMap = ref(false)
const miniMapPreview = ref(null)
const editorLodCanvas = ref(null)
const editorLodCanvasReady = ref(false)
const editorLodDetailCanvas = ref(null)
const editorLodDetailBounds = shallowRef(null)
const editorLodDetailCommittedFrame = shallowRef(null)
const editorLodFallbackAnimationTimestamp = ref(null)
const editorLodDetailAnimationTimestamp = ref(null)
const editorLodDetailReady = ref(false)
const editorLodDetailFresh = ref(false)
const editorLodRemovalCoverRegions = shallowRef([])
const editorLodRemovalFallbackReady = ref(false)
const editorLodContentRevision = ref(0)
const editorDevicePixelRatio = ref(currentDevicePixelRatio())
const editorLodBootstrapNodeIds = shallowRef([])
const editorLodBootstrapDrawingIds = shallowRef([])
const editorLodPendingInsertionNodeIds = shallowRef([])
const editorProgressiveDomActive = ref(false)
const editorProgressiveDomNodeIds = shallowRef([])
const editorLodGeometrySession = shallowRef(null)
const editorLodGeometryHiddenNodeIds = shallowRef(new Set())
const editorLodGeometryHiddenEdgeIds = shallowRef(new Set())
const editorLodGeometryHiddenDrawingIds = shallowRef(new Set())
let editorLodGeometryRevision = 0
let editorLodRecoveryTimer = 0
let editorLodFallbackRecoveryPending = false
let editorLodDetailRecoveryPending = false
let editorLodFallbackRecoveryTargetGeneration = null
let editorLodDetailRecoveryTargetGeneration = null
let editorLodFallbackRecoveryTarget = null
let editorLodDetailRecoveryTarget = null
let editorLodDocumentResetPending = false
let editorProgressiveDomFrame = 0
let editorProgressiveDomGeneration = 0
const showPreview = ref(false)
const previewFullscreen = ref(false)
const previewFullscreenPending = ref(false)
const previewAutoFit = ref(false)
const previewAutoFitPending = ref(false)
const previewModeTransitionPending = computed(() => previewAutoFitPending.value || previewFullscreenPending.value)
const previewScale = ref(1)
const previewDisplayMode = ref('dom')
const previewRenderTarget = ref('dom')
const previewFitMounted = ref(false)
const previewFitCanvasReady = ref(false)
const previewFitFrameAvailable = ref(false)
const previewFitCanvasFailed = ref(false)
const previewFitFrameFresh = ref(false)
const previewFitScale = ref(1)
const previewFitOffset = shallowRef({ left: 0, top: 0 })
const previewFitCommittedScale = ref(1)
const previewFitCommittedOffset = shallowRef({ left: 0, top: 0 })
const previewFitCommittedPixelRatio = ref(0)
const previewDevicePixelRatio = ref(currentDevicePixelRatio())
const previewDomGeneration = ref(0)
const previewDomNodesReady = ref(false)
const previewDomGeometryReady = ref(false)
const previewDomReady = computed(() => previewDomNodesReady.value && previewDomGeometryReady.value)
const previewDomMounted = ref(false)
const previewPresentationReady = ref(false)
const previewViewportTransitioning = ref(false)
const previewDomQueryBounds = shallowRef(null)
const previewLivePlaneGeneration = ref(0)
const previewLivePlaneReady = ref(true)
const previewMediaReadinessGate = createPreviewMediaReadinessGate({ afterDomUpdate: nextTick })
const previewFitCommittedPlanKey = ref('')
const previewFitCommittedOverlayNodes = shallowRef([])
const previewFitCommittedOverlayDrawings = shallowRef([])
const previewEdgeCanvasBounds = shallowRef(null)
const previewEdgeCanvasCommittedBounds = shallowRef(null)
const previewEdgeCanvasCommittedPixelRatio = ref(0)
const previewEdgeCanvasCommittedPlanKey = ref('')
const previewEdgeCanvasReady = ref(false)
const previewEdgeCanvasFailed = ref(false)
const previewFrameFreshness = createPreviewFrameFreshness()
const previewFitFrameCommitToken = shallowRef(previewFrameFreshness.currentCommitStamp())
const currentTimeTick = ref(Date.now())
const rightOpen = ref(true)
const leftTab = ref('组件')
const rightTab = ref('属性')
// 数据源按当前图纸隔离；pointCatalog 只为旧 pointId 图纸保留，新绑定直接使用源快照。
const dataSourceManagerOpen = ref(false)
const dataSourceRevision = ref(0)
const pointCatalog = shallowRef([])
let pointCatalogLoadGeneration = 0
let pointCatalogActivationGeneration = 0
let pointCatalogScopeReady = false
const activePointSourceScopeId = ref('')
const propertiesPanel = ref(null)
const structureScroller = ref(null)
const structureScrollTop = ref(0)
const structureViewportHeight = ref(0)
const search = ref('')
// 图纸身份、画布样式和连线默认值
const fileName = ref('未命名图纸')
const workspaceId = ref(initialWorkspaceId())
const workspaceDraft = ref(workspaceId.value)
const projectId = ref(createEntityId('project'))
const currentPointSourceScopeId = computed(() => drawingPointSourceScopeId(workspaceId.value, projectId.value))
const projectRevision = ref(0)
const projectCreatedAt = ref(new Date().toISOString())
const projectUpdatedAt = ref(null)
const canvasBg = ref('#f7f8fa')
const canvasBorderColor = ref('#cbd3d9')
const canvasBorderWidth = ref(1)
const gridColor = ref('#dde3e7')
const gridStyle = ref('line')
const lineColor = ref('#485563')
const lineWidth = ref(2)
const lineDash = ref(false)
const lineStartMarker = ref('none')
const lineEndMarker = ref('arrow')
const lineAnchorMode = ref('edge')
const history = ref([])
const future = ref([])
let historyBytes = 0
const historyEntryByteCache = new WeakMap()
let documentChangeVersion = 0
const interactionCommitBarrier = createInteractionCommitBarrier({
  schedule: callback => scheduleBundleFrame(callback),
  cancel: handle => cancelBundleFrame(handle)
})
const POINTER_INTERACTION = 'pointer-operation'
const CANVAS_ZOOM_INTERACTION = 'canvas-zoom'
const CANVAS_SCROLL_INTERACTION = 'canvas-scroll'
const CONNECTION_INTERACTION = 'connection'
const POLYLINE_POINT_INTERACTION = 'polyline-point-drag'
const BUNDLE_CAPTURE_RETRY = 'bundle-capture-retry'
const DOCUMENT_INDEX_COMPACTION_RETRY = 'document-index-compaction-retry'
const CANVAS_SCROLL_INTERACTION_SETTLE_MS = 120
let canvasScrollInteractionTimer = 0
const operation = ref(null)
const selectionMarquee = ref(null)
const largeSelectionPreviewBounds = shallowRef(null)
const largeSelectionCommitPending = ref(false)
let largeSelectionTransformState = null
let largeSelectionCommitFrame = 0
let largeSelectionCommitGeneration = 0
let largeSelectionTransformWorker = null
let nextLargeSelectionWorkerRequestId = 1
const largeSelectionWorkerCallbacks = new Map()
const polylineDraft = ref(null)
let polylineStartPointDrag = null
const clipboardItem = ref(null)
let clipboardBundleGeneration = 0
const contextMenu = ref({ show: false, x: 0, y: 0, canvasPoint: null })
const contextMenuElement = ref(null)
const connectFrom = ref(null)
const toast = ref('')
const canvas = ref(null)
const stageSpace = ref(null)
const stage = ref(null)
const editorLodSurface = ref(null)
const importInput = ref(null)
const nodeImageInput = ref(null)
const nodeVideoInput = ref(null)
const drawingBrowserOpen = ref(false)
const drawingFiles = ref([])
const drawingDirectoryPath = ref('')
const drawingFilesLoading = ref(false)
const drawingFilesError = ref('')
const drawingFilesLoaded = ref(false)
const drawingNamesCaseSensitive = ref(true)
let drawingFilesRefreshPromise = null
const fileOperationPending = ref(false)
const workspaceSwitchPending = ref(false)
const showSaveMenu = ref(false)
const currentDrawingFile = ref({ kind: 'project', name: '', etag: '', size: 0, modifiedAt: null })
const paperSessions = shallowRef([])
const activePaperSessionId = ref('')
const workspacePaperSessions = createWorkspaceSessionCache(MAX_CACHED_WORKSPACES)
let workspaceSessionPersistTimer = 0
let workspaceSessionPersistenceCapturing = false
let workspaceSessionPersistenceWarningShown = false
let workspaceSessionPersistenceDeferredWorkspace = ''
let workspaceSessionRestoreGeneration = 0
let customDrawingFileHandle = null
let pendingVideoUrlEdit = null
let componentLifecycleActive = false
const activeNodeFileReaders = new Set()

function projectParsingWasDisposed(error) {
  return error instanceof ProjectJsonParserDisposedError
    || error instanceof ProjectRuntimePreparationCancelledError
    || !componentLifecycleActive
}

function beginEditorInteraction(key) {
  return interactionCommitBarrier.begin(key)
}
function endEditorInteraction(key) {
  return interactionCommitBarrier.end(key)
}
function currentInteractionGeneration() {
  return interactionCommitBarrier.state.generation
}
function interactionPayloadIsCurrent(payload) {
  return interactionCommitBarrier.isCurrent(payload?.interactionGeneration)
}
function finishCanvasScrollInteraction() {
  if (canvasScrollInteractionTimer) clearTimeout(canvasScrollInteractionTimer)
  canvasScrollInteractionTimer = 0
  endEditorInteraction(CANVAS_SCROLL_INTERACTION)
}
function pulseCanvasScrollInteraction() {
  beginEditorInteraction(CANVAS_SCROLL_INTERACTION)
  if (canvasScrollInteractionTimer) clearTimeout(canvasScrollInteractionTimer)
  canvasScrollInteractionTimer = setTimeout(finishCanvasScrollInteraction, CANVAS_SCROLL_INTERACTION_SETTLE_MS)
}
function setConnectionAnchor(nodeId = null) {
  const nextId = nodeId || null
  const hadAnchor = Boolean(connectFrom.value)
  connectFrom.value = nextId
  if (!hadAnchor && nextId) beginEditorInteraction(CONNECTION_INTERACTION)
  else if (hadAnchor && !nextId) endEditorInteraction(CONNECTION_INTERACTION)
}
// 后台网关与运行时数据不进入图纸 JSON 和撤销栈。
const runtimeData = useRuntimeData()
const {
  enqueue: enqueueRuntimeDataStore,
  registerKeys: registerRuntimeDataKeys,
  unregisterKeys: unregisterRuntimeDataKeys,
  setActiveKeys: setActiveRuntimeDataKeys,
  getActiveKeys: getActiveRuntimeDataKeys,
  hasActiveKey: hasActiveRuntimeDataKey,
  clear: clearRuntimeData,
  stop: stopRuntimeData
} = runtimeData
function enqueueRuntimeData(batch) {
  return enqueueRuntimeDataStore(batch)
}
const unsubscribeRuntimeStore = runtimeData.subscribeAll((key) => {
  if (!queueRuntimeCanvasDirtyKey(key)) return
  if (previewRuntimeCanvasTracked() && !previewCanvasRenderActive.value && previewFitFrameAvailable.value) {
    previewFrameFreshness.markRuntimeStale()
    syncPreviewFitFrameFreshness()
  }
  markRuntimeCanvasDirty()
})
const unsubscribeRuntimeGateway = runtimeGateway.subscribe(enqueueRuntimeData)

// JSONPath 只在数据源快照进入时解析一次；派生值继续复用现有 runtimeGateway 帧合并链路。
const sourceBindingRuntime = createSourceBindingRuntime({
  onUpdates(updates) {
    if (updates?.length) runtimeGateway.send(updates)
  }
})
const sourceSnapshotReplayCoordinator = createSourceSnapshotReplayCoordinator({
  readSnapshot(sourceId) {
    return pointCatalogGateway.getSourceSnapshot?.(sourceId, { shared: true })
  },
  commitSnapshot(snapshot, options) {
    if (!pointCatalogScopeReady || snapshot?.workspaceId !== activePointSourceScopeId.value) return
    sourceBindingRuntime.ingest(snapshot, options)
  },
  isActive: () => componentLifecycleActive
})
const legacyPointReplayCoordinator = createLegacyPointReplayCoordinator({
  readPoints(pointIds) {
    return pointCatalogGateway.getPointsByIds(pointIds)
  },
  commitUpdates(updates) {
    runtimeGateway.send(updates)
  },
  isActive: () => componentLifecycleActive,
  isPointActive(pointId) {
    return hasActiveRuntimeDataKey(pointId)
  }
})
const unsubscribeSourceSnapshots = pointCatalogGateway.subscribeSnapshots?.(snapshot => {
  if (!pointCatalogScopeReady || snapshot?.workspaceId !== activePointSourceScopeId.value) return
  sourceBindingRuntime.ingest(snapshot)
}, { shared: true }) || (() => false)

function legacyPointIdsForNodes(source = []) {
  const ids = new Set()
  for (const node of source) {
    const dataKey = String(node?.dataKey ?? '').trim()
    if (dataKey) ids.add(dataKey)
    for (const binding of Array.isArray(node?.dataBindings) ? node.dataBindings : []) {
      if (binding?.enabled === false) continue
      const pointId = String(binding?.pointId ?? '').trim()
      if (pointId) ids.add(pointId)
    }
  }
  return [...ids]
}

function indexedLegacyPointIds() {
  const ids = new Set(runtimeDataKeyIndex.keys())
  for (const key of runtimeBindingPointIndex.keys()) {
    if (isSourceBindingRuntimeKey(key)) continue
    const pointId = String(key ?? '').trim()
    if (pointId) ids.add(pointId)
  }
  return [...ids]
}

function clearPointCatalogRuntimeValues(points = pointCatalog.value) {
  const pointIds = [...new Set((Array.isArray(points) ? points : []).map(point => String(point?.id ?? '').trim()).filter(Boolean))]
  pointCatalog.value = []
  if (pointIds.length) runtimeGateway.send(pointIds.map(key => ({ key, value: undefined })))
}

function applyPointCatalog(points, { replay = true } = {}) {
  if (!Array.isArray(points)) throw new TypeError('数据点位目录格式无效')
  const { invalidatedPointIds, changedPointIds } = diffPointCatalog(pointCatalog.value, points)
  pointCatalog.value = points
  if (invalidatedPointIds.length) {
    runtimeGateway.send(invalidatedPointIds.map(key => ({ key, value: undefined })))
  }
  if (replay && changedPointIds.length) {
    const activeKeys = new Set(getActiveRuntimeDataKeys())
    replayPointCatalogValues(changedPointIds.filter(pointId => activeKeys.has(pointId)))
  }
  return { invalidatedPointIds, changedPointIds }
}

async function refreshPointCatalog({ replay = true, throwOnError = false, requiredIds = null } = {}) {
  const generation = ++pointCatalogLoadGeneration
  try {
    const pointIds = requiredIds == null
      ? indexedLegacyPointIds()
      : [...new Set(requiredIds)].filter(Boolean)
    const points = pointIds.length
      ? (pointCatalogGateway.getPointsByIds
          ? await pointCatalogGateway.getPointsByIds(pointIds)
          : (await pointCatalogGateway.listPoints()).filter(point => pointIds.includes(point.id)))
      : []
    if (generation !== pointCatalogLoadGeneration || !componentLifecycleActive) return false
    applyPointCatalog(points, { replay })
    return true
  } catch (error) {
    if (generation !== pointCatalogLoadGeneration || !componentLifecycleActive) return false
    // 目录未知时必须失败关闭，禁止把上一个工作空间的同名点位继续显示在当前图纸中。
    clearPointCatalogRuntimeValues()
    notify(error?.message || '数据点位读取失败')
    if (throwOnError) throw error
    return false
  }
}
async function activatePointCatalogDrawing(targetWorkspace, targetDrawingId, options = {}) {
  const normalizedWorkspace = normalizeWorkspaceId(targetWorkspace, DEFAULT_WORKSPACE_ID)
  const normalizedDrawingId = String(targetDrawingId || '').trim()
  const targetScopeId = drawingPointSourceScopeId(normalizedWorkspace, normalizedDrawingId)
  const activationGeneration = ++pointCatalogActivationGeneration
  const activationIsCurrent = () => (
    activationGeneration === pointCatalogActivationGeneration
    && componentLifecycleActive
    && workspaceId.value === normalizedWorkspace
    && projectId.value === normalizedDrawingId
  )
  pointCatalogScopeReady = false
  activePointSourceScopeId.value = ''
  invalidateRuntimeDataReplays()
  ++pointCatalogLoadGeneration
  try {
    const activation = await pointCatalogGateway.activateWorkspace(targetScopeId, {
      legacyWorkspaceId: options.inheritLegacyWorkspace === false ? '' : normalizedWorkspace,
      // 图纸安装完成后由当前调用方按绑定关系重放，切换过程中不向旧图纸发布快照。
      publishSnapshots: false
    })
    if (!activationIsCurrent()) return false
    if (activation?.workspaceId !== targetScopeId) throw new Error('图纸数据源作用域激活结果不一致')
    activePointSourceScopeId.value = targetScopeId
    sourceBindingRuntime.reset?.({ keepBindings: true })
    pointCatalogScopeReady = true
    dataSourceRevision.value += 1
    await refreshPointCatalog(options)
    if (!activationIsCurrent()) return false
    if (options.replay !== false) {
      await replaySourceSnapshotsForNodes()
      if (!activationIsCurrent()) return false
    }
    return true
  } catch (error) {
    if (!activationIsCurrent()) return false
    pointCatalogScopeReady = false
    activePointSourceScopeId.value = ''
    if (componentLifecycleActive) clearPointCatalogRuntimeValues()
    throw error
  }
}

async function activateCurrentDrawingPointCatalog(options = {}) {
  try {
    return await activatePointCatalogDrawing(workspaceId.value, projectId.value, options)
  } catch (error) {
    notify(`当前图纸数据源暂不可用，已按静态属性打开：${error?.message || '目录加载失败'}`)
    return false
  }
}
const unsubscribePointCatalog = pointCatalogGateway.subscribe(event => {
  // 图纸数据源激活由调用方显式刷新，避免订阅与生命周期调用重复读取目录。
  if (event?.type === 'workspace-activated') return
  if (!event?.catalogChanged) return
  // 停用、删除或重新测试连接后，旧批次即使晚到也不能恢复已失效的点位值。
  legacyPointReplayCoordinator.invalidate()
  // 删除连接的失效值由快照订阅统一处理，避免同一来源生成两套 revision。
  const requiredIds = indexedLegacyPointIds()
  void refreshPointCatalog({ requiredIds })
})
// 画布、视口及临时编辑器状态
const stageWidth = ref(DEFAULT_STAGE_WIDTH)
const stageHeight = ref(DEFAULT_STAGE_HEIGHT)
const miniMapWidth = 240
const miniMapHeight = 150
const miniMapViewportMinSize = 12
const viewport = ref({ left: 0, top: 0, width: 1200, height: 800 })
// 滚轮缩放期间只扩不缩，确保新露出的区域先挂载，再应用舞台合成变换。
const transientCanvasRenderBounds = shallowRef(null)
const previewViewport = ref({ left: 0, top: 0, width: 1200, height: 800 })
const previewOverlay = ref(null)
const previewCanvas = ref(null)
const previewFitCanvas = ref(null)
const previewEdgeCanvas = ref(null)
const previewDomStage = ref(null)
const previewLivePlaneStage = ref(null)
const textEditor = ref(null)
const inlineTextComposing = ref(false)
const editingText = ref(null)
const editingFormId = ref(null)
const tableDataEditor = ref({ show: false, nodeId: null, tab: 'data', mode: 'edit' })
const tableDataSelection = ref({ nodeId: null, start: null, end: null, awaitingEnd: false })
const tableSelectionDragging = ref(false)
const tableCellViewer = ref({ show: false, nodeId: null, row: -1, column: -1 })
const buttonMessageDialog = ref({ show: false, nodeId: null, title: '', message: '' })
const customComponentDialog = ref({ show: false, name: '', bundle: null })
const customComponentNameInput = ref(null)
const customComponentNameComposing = ref(false)
const pendingBundleInsertion = shallowRef(null)
const serverTimeOffset = ref(0)
const serverTimeSyncedAt = ref(0)
const timeRenderContext = Object.freeze({ tick: currentTimeTick, serverOffset: serverTimeOffset })
const projectStorageKey = computed(() => storageKeyForWorkspace(workspaceId.value))
const EMPTY_PREVIEW_FIT_PLAN = Object.freeze({
  overlayNodes: Object.freeze([]),
  overlayDrawings: Object.freeze([]),
  overlayNodeIds: Object.freeze([]),
  overlayDrawingIds: Object.freeze([]),
  liveNodeIds: Object.freeze([]),
  key: '',
  layerSafe: true,
  domSafe: true,
  canUseCanvas: true
})
const previewFitPlan = computed(() => {
  if (!showPreview.value) return EMPTY_PREVIEW_FIT_PLAN
  const liveNodeIds = []
  for (const node of nodes.value) {
    if (previewNodeNeedsLiveDom(node)) liveNodeIds.push(node.id)
  }
  const tail = previewHybridLayerTail(layerEntries.value, liveNodeIds)
  const layerSafe = tail.safe
  const domSafe = layerSafe && previewHybridTailDomSafe(tail.entries)
  // 混合层级不安全时，兜底 Canvas 绘制完整图纸；最终交互仍由完整 DOM 接管。
  const overlayEntries = liveNodeIds.length && layerSafe && domSafe ? tail.entries : []
  const overlayNodes = overlayEntries
    .filter(entry => entry?.kind === 'node' && entry.entity)
    .map(entry => entry.entity)
  const overlayDrawings = overlayEntries
    .filter(entry => entry?.kind === 'drawing' && entry.entity)
    .map(entry => entry.entity)
  const overlayNodeIds = overlayNodes.map(node => node.id)
  const overlayDrawingIds = overlayDrawings.map(drawing => drawing.id)
  return {
    overlayNodes,
    overlayDrawings,
    overlayNodeIds,
    overlayDrawingIds,
    liveNodeIds,
    key: JSON.stringify([layerSafe, domSafe, overlayNodeIds, overlayDrawingIds]),
    layerSafe,
    domSafe,
    canUseCanvas: !liveNodeIds.length || (layerSafe && domSafe)
  }
})
const previewFitOverlayNodes = computed(() => previewFitPlan.value.overlayNodes)
const previewFitOverlayDrawings = computed(() => previewFitPlan.value.overlayDrawings)
const previewFitExcludedNodeIds = computed(() => previewFitPlan.value.overlayNodeIds)
const previewFitExcludedDrawingIds = computed(() => previewFitPlan.value.overlayDrawingIds)
const previewFitHybridLayerSafe = computed(() => previewFitPlan.value.layerSafe)
const previewFitHybridDomSafe = computed(() => previewFitPlan.value.domSafe)
const previewFitUsesDomOverlay = computed(() => previewFitPlan.value.liveNodeIds.length > 0 && previewFitHybridLayerSafe.value && previewFitHybridDomSafe.value)
function previewFitCanvasQualityAvailable() {
  return previewFitBootstrapCanRenderSharp.value
}
const previewFitCanUseCanvas = computed(() => (
  previewFitPlan.value.canUseCanvas
  && previewFitCanvasQualityAvailable()
))
const previewFitCommittedUsesDomOverlay = computed(() => (
  previewFitCommittedOverlayNodes.value.length > 0
  || previewFitCommittedOverlayDrawings.value.length > 0
))
const previewFitLayoutRequested = computed(() => previewAutoFit.value && !previewFullscreen.value)
const previewFitActive = computed(() => previewRenderTarget.value === 'fit' && previewFitLayoutRequested.value)
const previewFitVisible = computed(() => previewDisplayMode.value === 'fit')
const previewDomFitVisible = computed(() => previewDisplayMode.value === 'dom-fit')
const previewFittedVisible = computed(() => previewFitVisible.value || previewDomFitVisible.value)
const previewLivePlaneUsesCommittedPlan = computed(() => (
  previewFitCommittedUsesDomOverlay.value
  && (
    previewFitVisible.value
    || (
      previewRenderTarget.value === 'fit'
      && previewFitCommittedPlanKey.value === previewFitPlan.value.key
    )
  )
))
const previewLivePlaneNodes = computed(() => {
  if (!showPreview.value) return EMPTY_PREVIEW_FIT_PLAN.overlayNodes
  if (previewLivePlaneUsesCommittedPlan.value) return previewFitCommittedOverlayNodes.value
  return previewFitUsesDomOverlay.value ? previewFitOverlayNodes.value : EMPTY_PREVIEW_FIT_PLAN.overlayNodes
})
const previewLivePlaneDrawings = computed(() => {
  if (!showPreview.value) return EMPTY_PREVIEW_FIT_PLAN.overlayDrawings
  if (previewLivePlaneUsesCommittedPlan.value) return previewFitCommittedOverlayDrawings.value
  return previewFitUsesDomOverlay.value ? previewFitOverlayDrawings.value : EMPTY_PREVIEW_FIT_PLAN.overlayDrawings
})
const previewLivePlaneKey = computed(() => {
  if (!previewLivePlaneNodes.value.length && !previewLivePlaneDrawings.value.length) return ''
  return previewLivePlaneUsesCommittedPlan.value
    ? `committed:${previewFitCommittedPlanKey.value}`
    : `current:${previewFitPlan.value.key}`
})
const previewLivePlaneActive = computed(() => (
  previewLivePlaneNodes.value.length > 0
  || previewLivePlaneDrawings.value.length > 0
))
const previewDomUsesLivePlane = computed(() => previewFitUsesDomOverlay.value)
const previewSmallDocument = computed(() => (
  nodes.value.length <= PREVIEW_DOM_NODE_LIMIT
  && edges.value.length <= PREVIEW_DOM_EDGE_LIMIT
  && drawings.value.length <= PREVIEW_DOM_DRAWING_LIMIT
  && !shouldUseAnimatedFlowDirectionLod(nodes.value)
))
const previewViewportCanvasPlanned = computed(() => (
  showPreview.value
  && previewRenderTarget.value === 'dom'
  && !previewFitLayoutRequested.value
  && previewFitPlan.value.canUseCanvas
))
// 大图保留一张完整 Canvas 帧；滚动换代期间显示旧完整帧，不暴露半挂载 DOM。
const previewFallbackRequired = computed(() => showPreview.value && !previewSmallDocument.value)
// 高清视口可用时优先完成首屏，整图兜底降为空闲任务，避免两张 Canvas 争抢首帧。
const previewFitInitialRenderUrgent = computed(() => (
  previewFallbackRequired.value
  && !previewFitFrameAvailable.value
  && (
    (!previewPresentationReady.value && !previewViewportCanvasPlanned.value)
    || previewEdgeCanvasFailed.value
  )
))
const previewFitRenderMode = computed(() => (previewFitActive.value || previewFitInitialRenderUrgent.value) ? 'task' : 'idle')
const previewFitRenderBudgetMs = computed(() => previewFitRenderMode.value === 'task' ? 4 : 2)
const previewCanvasVisible = computed(() => previewFitVisible.value || (
  (
    previewViewportTransitioning.value
    || !previewDomReady.value
    || (previewDomEdgeCanvasActive.value && !previewEdgeCanvasVisible.value)
  )
  && previewFitFrameAvailable.value
))
const previewDomVisible = computed(() => !previewFitVisible.value && (
  (!previewViewportTransitioning.value && previewDomReady.value)
  || !previewFitFrameAvailable.value
))
const previewFitPresentationScale = computed(() => (
  previewFitVisible.value && previewFitFrameAvailable.value
    ? previewFitCommittedScale.value
    : previewFitScale.value
))
const previewFitPresentationOffset = computed(() => (
  previewFitVisible.value && previewFitFrameAvailable.value
    ? previewFitCommittedOffset.value
    : previewFitOffset.value
))
const previewRenderScale = computed(() => previewFittedVisible.value ? previewFitPresentationScale.value : 1)
const previewFitCanvasScale = computed(() => (previewFitLayoutRequested.value || previewFittedVisible.value) ? previewFitScale.value : 1)
const previewFitCanvasWidth = computed(() => Math.max(1, stageWidth.value * previewFitCanvasScale.value))
const previewFitCanvasHeight = computed(() => Math.max(1, stageHeight.value * previewFitCanvasScale.value))
const previewFitPixelRatio = computed(() => previewBitmapPixelRatio(previewDevicePixelRatio.value))
const previewCanvasRenderActive = computed(() => showPreview.value && previewFitMounted.value && (
  previewRenderTarget.value === 'fit'
  || previewFitVisible.value
  || previewCanvasVisible.value
  || !previewDomReady.value
  || (previewFallbackRequired.value && (!previewFitFrameAvailable.value || !previewFitFrameFresh.value))
))
const previewFitBitmapPixelBudget = computed(() => previewBitmapPixelBudget({
  fitActive: previewFitLayoutRequested.value || previewFittedVisible.value,
  stageWidth: stageWidth.value,
  stageHeight: stageHeight.value,
  scale: previewFitCanvasScale.value,
  devicePixelRatio: previewDevicePixelRatio.value,
  preservePixelRatio: previewFitLayoutRequested.value || previewFittedVisible.value
}))
const previewFitBootstrapTarget = computed(() => previewFrameTarget(previewFitFrameTargetOptions()))
const previewFitBootstrapCanRenderSharp = computed(() => previewBitmapIsSharp(
  Math.min(
    previewFitBootstrapTarget.value?.pixelRatioX || 0,
    previewFitBootstrapTarget.value?.pixelRatioY || 0
  ),
  previewFitPixelRatio.value
))

function previewFitFrameTargetOptions() {
  return {
    width: previewFitCanvasWidth.value,
    height: previewFitCanvasHeight.value,
    pixelRatio: previewFitPixelRatio.value,
    maxBitmapPixels: previewFitBitmapPixelBudget.value
  }
}

function syncPreviewFitFrameFreshness() {
  previewFitFrameFresh.value = previewFrameFreshness.state().fresh
  const next = previewFrameFreshness.currentCommitStamp()
  const current = previewFitFrameCommitToken.value
  if (
    current?.documentEpoch !== next.documentEpoch
    || current?.requestedEpoch !== next.requestedEpoch
    || current?.targetEpoch !== next.targetEpoch
    || current?.requestedTargetEpoch !== next.requestedTargetEpoch
  ) previewFitFrameCommitToken.value = next
}

let previewCanvasDocumentRenderTimer = 0
function clearPreviewCanvasDocumentRenderTimer() {
  if (!previewCanvasDocumentRenderTimer) return false
  clearTimeout(previewCanvasDocumentRenderTimer)
  previewCanvasDocumentRenderTimer = 0
  return true
}

function invalidatePreviewFitDocument() {
  previewFrameFreshness.invalidateDocument()
  syncPreviewFitFrameFreshness()
}

function requestPreviewFitDocumentRender() {
  clearPreviewCanvasDocumentRenderTimer()
  if (!previewCanvasRenderActive.value || !previewFitCanvas.value) return false
  previewFrameFreshness.requestDocumentRender(previewFitFrameTargetOptions())
  syncPreviewFitFrameFreshness()
  const requestedToken = previewFitFrameCommitToken.value
  void nextTick(() => {
    const target = previewFitCanvas.value
    if (
      !previewCanvasRenderActive.value
      || previewFitFrameCommitToken.value !== requestedToken
      || target?.renderState?.pending
    ) return
    target.requestCoalescedRender?.()
  })
  return true
}

watch(
  [previewFitMounted, previewFitCanvasWidth, previewFitCanvasHeight, previewFitPixelRatio, previewFitBitmapPixelBudget],
  () => {
    if (!showPreview.value || !previewFitMounted.value || !previewCanvasRenderActive.value) return
    clearPreviewCanvasDocumentRenderTimer()
    previewFrameFreshness.requestDocumentRender(previewFitFrameTargetOptions())
    syncPreviewFitFrameFreshness()
  },
  { flush: 'sync' }
)

// 节点索引保存响应式数组中的代理引用；普通新增和删除按批次增量维护，整体换图时才完整重建。
const nodeIndex = shallowRef(new globalThis.Map())
const drawingIndex = shallowRef(new globalThis.Map())
const drawingSpatialRevision = ref(0)
let drawingSpatialIndex = createSpatialIndex([], {
  cellSize: 512,
  getBounds: drawing => drawingFrame(drawing)
})
let runtimeDataKeyIndex = createDataKeyIndex()
// 参数级绑定单独维护 pointId -> nodeId 索引；运行时刷新无需扫描整张图纸。
let runtimeBindingPointIndex = createDataBindingIndex()
const runtimeCanvasDirtyQueue = createRuntimeCanvasDirtyQueue({
  idsForKey(key) {
    return [runtimeDataKeyIndex.idsFor(key), runtimeBindingPointIndex.nodeIdsFor(key)]
  },
  nodeForId(nodeId) {
    return nodeIndex.value.get(nodeId)
  }
})

function runtimeCanvasRenderingActive() {
  return (editorLodActive.value && !editorRenderPaused.value)
    || previewCanvasRenderActive.value
    || previewDomEdgeCanvasActive.value
    || showMiniMap.value
}

function previewRuntimeCanvasTracked() {
  return showPreview.value && (previewFitMounted.value || previewDomEdgeCanvasActive.value)
}

function queueRuntimeCanvasDirtyKey(key) {
  if (!runtimeCanvasRenderingActive() && !previewRuntimeCanvasTracked()) return false
  const normalizedKey = String(key ?? '').trim()
  if (!normalizedKey) return runtimeCanvasDirtyQueue.queueFull()
  const affectedCount = runtimeDataKeyIndex.countFor(normalizedKey)
    + runtimeBindingPointIndex.countFor(normalizedKey)
  return affectedCount > 0 && runtimeCanvasDirtyQueue.queueKey(normalizedKey)
}

function takeRuntimeCanvasDirtyNodes() {
  return runtimeCanvasDirtyQueue.takeBatch(DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE)
}

function runtimeDataKeysForNodes(source = []) {
  const keys = []
  for (const node of source) {
    // 单节点内旧 dataKey 与参数绑定若指向同一点位，只登记一次引用。
    keys.push(...bindingPointIds(node, { includeLegacy: true }))
  }
  return keys
}

function invalidateRuntimeDataReplays() {
  sourceSnapshotReplayCoordinator.invalidate()
  legacyPointReplayCoordinator.invalidate()
}

async function replaySourceSnapshotsForNodes(source = nodes.value, { force = false } = {}) {
  if (!pointCatalogScopeReady) return false
  const sourceIds = new Set()
  for (const node of source) {
    for (const sourceId of bindingSourceIds(node)) sourceIds.add(sourceId)
  }
  return sourceSnapshotReplayCoordinator.replay(sourceIds, { force })
}

function rebuildRuntimeDataKeyIndex(source = nodes.value) {
  runtimeDataKeyIndex.rebuild(source)
  runtimeBindingPointIndex.rebuild(source)
  // 大图的源绑定索引按帧构建；完成前组件使用静态属性，快照会在索引提交后自动重放。
  sourceBindingRuntime.rebuildDeferred(source)
  setActiveRuntimeDataKeys(runtimeDataKeysForNodes(source))
  void replaySourceSnapshotsForNodes(source)
}

function addRuntimeDataNodes(source = []) {
  runtimeDataKeyIndex.add(source)
  runtimeBindingPointIndex.add(source)
  for (const node of source) sourceBindingRuntime.updateNode(node)
  registerRuntimeDataKeys(runtimeDataKeysForNodes(source))
  void legacyPointReplayCoordinator.replay(legacyPointIdsForNodes(source))
  void replaySourceSnapshotsForNodes(source)
}

function removeRuntimeDataNodes(source = []) {
  const keys = []
  for (const item of source) {
    const nodeId = item?.id ?? item
    const nodeKeys = new Set(runtimeBindingPointIndex.pointIdsFor(nodeId))
    const legacyKey = runtimeDataKeyIndex.keyFor(nodeId)
    if (legacyKey) nodeKeys.add(legacyKey)
    keys.push(...nodeKeys)
  }
  runtimeDataKeyIndex.remove(source)
  runtimeBindingPointIndex.remove(source)
  for (const item of source) sourceBindingRuntime.removeNode(item?.id ?? item)
  unregisterRuntimeDataKeys(keys)
}

function setNodeRuntimeDataKey(node, value) {
  if (!node?.id) return
  const previousKeys = indexedRuntimeKeysForNode(node.id)
  node.dataKey = value
  const nextKey = String(value ?? '').trim()
  runtimeDataKeyIndex.update(node.id, nextKey)
  const nextKeys = indexedRuntimeKeysForNode(node.id)
  synchronizeRuntimeKeyReferences(previousKeys, nextKeys)
}

function setSelectedDataKey(value) {
  if (!selected.value || selected.value.locked) return
  setNodeRuntimeDataKey(selected.value, value)
}

function replayPointCatalogValues(keys) {
  const pointIds = new Set([...keys].map(key => String(key ?? '').trim()).filter(Boolean))
  if (!pointIds.size) return
  const updates = pointCatalog.value
    .filter(point => pointIds.has(point.id))
    .map(point => ({ key: point.id, value: point.value }))
  if (updates.length) runtimeGateway.send(updates)
}

function synchronizeRuntimeKeyReferences(previousKeys, nextKeys) {
  const removedKeys = [...previousKeys].filter(key => !nextKeys.has(key))
  const addedKeys = [...nextKeys].filter(key => !previousKeys.has(key))
  unregisterRuntimeDataKeys(removedKeys)
  registerRuntimeDataKeys(addedKeys)
  // 新绑定、撤销和重做都先恢复目录中的最近值，随后再接收后台实时推送。
  replayPointCatalogValues(addedKeys)
}

function synchronizeNodeDataBindings(node, nextBindings) {
  const previousRuntimeKeys = indexedRuntimeKeysForNode(node.id)
  node.dataBindings = nextBindings
  runtimeBindingPointIndex.update(node)
  sourceBindingRuntime.updateNode(node)
  const nextRuntimeKeys = indexedRuntimeKeysForNode(node.id)
  synchronizeRuntimeKeyReferences(previousRuntimeKeys, nextRuntimeKeys)
  void replaySourceSnapshotsForNodes([node])
  markMiniMapDirty()
  markPreviewCanvasDocumentDirty()
}

// 真实后台请求可能跨越多个事件循环；选择变化或新操作会让旧请求失去提交资格。
let bindingOperationGeneration = 0
watch([selectedId, selectedNodeIds], () => {
  bindingOperationGeneration += 1
}, { flush: 'sync' })

async function bindSelectedParameter({ target, sourceId, jsonPath, pointId, adapter } = {}) {
  const operationGeneration = ++bindingOperationGeneration
  const node = selectedNodeCount.value === 1 ? selected.value : null
  if (!node || node.locked || !target) return
  const parameter = getBindableParameter(node, target)
  if (!parameter) {
    notify('当前组件不支持绑定该参数')
    return
  }

  try {
    let binding
    let snapshot = null
    const normalizedSourceId = String(sourceId ?? '').trim()
    if (normalizedSourceId) {
      const normalizedPath = canonicalizeJsonPath(jsonPath)
      const source = await pointCatalogGateway.getSource(normalizedSourceId, { includePoints: false })
      if (!source) throw new Error('所选数据源已不存在')
      snapshot = await pointCatalogGateway.getSourceSnapshot(normalizedSourceId, { shared: true })
      if (!isUsableSourceSnapshot(snapshot, normalizedSourceId)) throw new Error('数据源测试快照无效或已切换，请重新测试连接')
      const value = evaluateJsonPath(snapshot.data, normalizedPath)
      if (value === undefined) throw new Error('JSONPath 在当前测试数据中没有取到值')
      const compatibility = directBindingCompatibility(parameter, {
        type: jsonValueType(value),
        value
      })
      if (!compatibility.compatible && !adapter) {
        throw new Error(compatibility.reason || '动态数据类型与组件参数不匹配')
      }
      binding = { target, sourceId: normalizedSourceId, jsonPath: normalizedPath, ...(adapter ? { adapter } : {}) }
    } else {
      // 旧扩展仍可提交 pointId；新通信面板不会再创建此类绑定。
      const normalizedPointId = String(pointId ?? '').trim()
      if (!normalizedPointId) return
      const point = pointCatalog.value.find(item => item.id === normalizedPointId)
      if (!point) throw new Error('所选旧点位已不存在，请重新选择数据源字段')
      const compatibility = directBindingCompatibility(parameter, point)
      if (!compatibility.compatible) throw new Error(compatibility.reason || '动态数据类型与组件参数不匹配')
      binding = { target, pointId: normalizedPointId, ...(adapter ? { adapter } : {}) }
    }

    if (
      operationGeneration !== bindingOperationGeneration
      || selectedNodeCount.value !== 1
      || selected.value !== node
      || nodeIndex.value.get(node.id) !== node
      || node.locked
    ) return
    const nextBindings = upsertDataBinding(node, binding)
    const current = Array.isArray(node.dataBindings) ? node.dataBindings : []
    if (JSON.stringify(current) === JSON.stringify(nextBindings)) {
      // 重复确认同一绑定也要恢复可能被下游生命周期清掉的运行值。
      if (snapshot) sourceBindingRuntime.ingest(snapshot, { replay: true })
      return
    }
    recordNodeFields(node, ['dataBindings'])
    synchronizeNodeDataBindings(node, nextBindings)
    if (snapshot) sourceBindingRuntime.ingest(snapshot)
    notify('动态数据已连接')
  } catch (error) {
    notify(error?.message || '建立数据连接失败')
  }
}

function unbindSelectedParameter({ target } = {}) {
  bindingOperationGeneration += 1
  const node = selectedNodeCount.value === 1 ? selected.value : null
  if (!node || node.locked || !target) return
  const nextBindings = removeDataBinding(node, target)
  if (nextBindings.length === (node.dataBindings?.length || 0)) return
  recordNodeFields(node, ['dataBindings'])
  synchronizeNodeDataBindings(node, nextBindings)
  notify('动态数据连接已解除')
}

function rebuildNodeIndex(source = nodes.value) {
  nodeIndex.value = new globalThis.Map(source.map(node => [node.id, node]))
}
function rebuildDrawingIndex(source = drawings.value) {
  drawingIndex.value = new globalThis.Map(source.map(drawing => [drawing.id, drawing]))
  drawingSpatialIndex.rebuild(source)
  drawingSpatialRevision.value += 1
}
function updateDrawingIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  let changed = false
  for (const drawing of items) {
    if (!drawing?.id) continue
    if (drawingIndex.value.get(drawing.id) !== drawing) {
      drawingIndex.value.set(drawing.id, drawing)
      changed = true
    }
    changed = drawingSpatialIndex.update(drawing) || changed
  }
  if (changed) {
    triggerRef(drawingIndex)
    if (publish) drawingSpatialRevision.value += 1
  }
  return changed
}
function removeDrawingIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  let changed = false
  for (const item of items) {
    const id = item?.id ?? item
    changed = drawingIndex.value.delete(id) || changed
    changed = drawingSpatialIndex.remove(id) || changed
  }
  if (changed) {
    triggerRef(drawingIndex)
    if (publish) drawingSpatialRevision.value += 1
  }
  return changed
}
const timeNodeIndex = shallowRef(new globalThis.Map())
function rebuildTimeNodeIndex(source = nodes.value) {
  timeNodeIndex.value = new globalThis.Map(source.filter(node => node.type === 'time').map(node => [node.id, node]))
}
function addTimeNodes(source = []) {
  let changed = false
  for (const node of source) {
    if (node?.type !== 'time' || !node.id) continue
    timeNodeIndex.value.set(node.id, node)
    changed = true
  }
  if (changed) triggerRef(timeNodeIndex)
}
function removeTimeNodes(source = []) {
  let changed = false
  for (const item of source) changed = timeNodeIndex.value.delete(item?.id ?? item) || changed
  if (changed) triggerRef(timeNodeIndex)
}
const selected = computed(() => nodeIndex.value.get(selectedId.value) || null)
const selectedNodeIdSet = computed(() => new Set(selectedNodeIds.value))
const nodesByGroup = computed(() => {
  const index = new globalThis.Map()
  for (const node of nodes.value) {
    if (!node.groupId) continue
    if (!index.has(node.groupId)) index.set(node.groupId, [])
    index.get(node.groupId).push(node)
  }
  return index
})
const selectedNodes = computed(() => selectedNodeIds.value
  .map(id => nodeIndex.value.get(id))
  .filter(Boolean)
  .sort((a, b) => (Number(a.layer) || 0) - (Number(b.layer) || 0)))
const selectedNodeCount = computed(() => selectedNodes.value.length)
const selectedVideoSource = computed(() => selected.value?.type === 'video' ? String(selected.value.videoUrl || '') : '')
const selectedVideoHasEmbeddedSource = computed(() => isEmbeddedVideoSource(selectedVideoSource.value))
const selectedVideoSourceSize = computed(() => formatMediaBytes(embeddedDataUrlByteLength(selectedVideoSource.value)))
const selectedVideoEditorValue = computed(() => selectedVideoHasEmbeddedSource.value ? '' : selectedVideoSource.value)
const selectedNodeStateSummary = computed(() => {
  const items = selectedNodes.value
  const groups = new Set()
  let allLocked = items.length > 0
  let containsLocked = false
  let allGrouped = items.length > 0
  for (const node of items) {
    if (node.groupId) groups.add(node.groupId)
    else allGrouped = false
    if (node.locked) containsLocked = true
    else allLocked = false
  }
  const singleGroup = items.length >= 2 && groups.size === 1 && allGrouped
  return { groups, allLocked, containsLocked, singleGroup, canGroup: items.length >= 2 && !singleGroup }
})
const selectedGroups = computed(() => selectedNodeStateSummary.value.groups)
const selectedNodesAllLocked = computed(() => selectedNodeStateSummary.value.allLocked)
const selectedNodesContainLocked = computed(() => selectedNodeStateSummary.value.containsLocked)
const selectedNodesAreSingleGroup = computed(() => selectedNodeStateSummary.value.singleGroup)
const canGroupSelection = computed(() => selectedNodeStateSummary.value.canGroup)
const selectedNodeTransformSummary = computed(() => {
  const items = selectedNodes.value
  const bounds = nodeCollectionBounds(items)
  if (!bounds) return null
  const limits = selectedNodesScaleLimits(items)
  return {
    bounds,
    minimum: selectedNodesMinimumBounds(items, bounds, '', limits),
    maximum: selectedNodesMaximumBounds(items, bounds, '', limits)
  }
})
const selectedNodeBounds = computed(() => selectedNodeTransformSummary.value?.bounds || null)
const selectedNodeInteractionBounds = computed(() => largeSelectionPreviewBounds.value || selectedNodeBounds.value)
const selectedDrawing = computed(() => drawingIndex.value.get(selectedDrawingId.value) || null)
const selectedEntitiesContainLocked = computed(() => selectedNodesContainLocked.value || Boolean(selectedDrawing.value?.locked))
const selectedEntity = computed(() => selected.value || selectedDrawing.value)
const propertyInspectionIdentity = computed(() => {
  const documentIdentity = String(projectId.value || '')
  if (paperSelected.value) return `${documentIdentity}:paper`
  if (selectedDrawingId.value) return `${documentIdentity}:drawing:${selectedDrawingId.value}`
  if (selectedNodeIds.value.length) {
    return `${documentIdentity}:nodes:${selectedNodeIds.value.join(',')}:primary:${selectedId.value || ''}`
  }
  return `${documentIdentity}:empty`
})
const activeTableDataNode = computed(() => {
  const node = nodeIndex.value.get(tableDataEditor.value.nodeId)
  return node?.type === 'table' && !node.locked ? node : null
})
const activeTableSelection = computed(() => {
  const selection = tableDataSelection.value
  const node = activeTableDataNode.value
  if (!node || selection.nodeId !== node.id || !selection.start) return null
  const end = selection.end || selection.start
  const row = Math.min(selection.start.row, end.row)
  const column = Math.min(selection.start.column, end.column)
  const rowEnd = Math.max(selection.start.row, end.row)
  const columnEnd = Math.max(selection.start.column, end.column)
  if (row < 0 || column < 0 || rowEnd >= node.tableRows || columnEnd >= node.tableColumns) return null
  return {
    row, column, rowEnd, columnEnd,
    rowSpan: rowEnd - row + 1,
    columnSpan: columnEnd - column + 1,
    cellCount: (rowEnd - row + 1) * (columnEnd - column + 1),
    rowLabel: row === rowEnd ? `第 ${row + 1} 行` : `第 ${row + 1}-${rowEnd + 1} 行`,
    columnLabel: column === columnEnd ? `第 ${column + 1} 列` : `第 ${column + 1}-${columnEnd + 1} 列`
  }
})
const selectedTableMerges = computed(() => {
  const selection = activeTableSelection.value
  if (!selection) return []
  return (activeTableDataNode.value?.tableMerges || []).filter(merge => (
    merge.row <= selection.rowEnd && merge.row + merge.rowSpan - 1 >= selection.row &&
    merge.column <= selection.columnEnd && merge.column + merge.columnSpan - 1 >= selection.column
  ))
})
const activeTableMergeLookup = computed(() => {
  const lookup = new globalThis.Map()
  for (const merge of activeTableDataNode.value?.tableMerges || []) {
    for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
      for (let column = merge.column; column < merge.column + merge.columnSpan; column += 1) lookup.set(`${row}:${column}`, merge)
    }
  }
  return lookup
})
const activeTableCellDetail = computed(() => {
  const indexedNode = nodeIndex.value.get(tableCellViewer.value.nodeId)
  const node = indexedNode?.type === 'table' ? indexedNode : null
  return resolveTableCellViewDetail(node, tableCellViewer.value)
})
const hasAutomaticTime = computed(() => {
  for (const node of timeNodeIndex.value.values()) {
    if (node.timeRunning && (node.timeUseServer || node.timeMode === 'elapsed')) return true
  }
  return false
})
const hasServerTime = computed(() => {
  for (const node of timeNodeIndex.value.values()) {
    if (node.timeUseServer) return true
  }
  return false
})
const filteredGroups = computed(() => groups.value.map(g => ({ ...g, items: g.items.filter(i => i.name.includes(search.value.trim())) })).filter(g => g.items.length))
const filteredCustomComponents = computed(() => {
  const query = search.value.trim()
  return query ? customComponents.value.filter(item => item.name.includes(query)) : customComponents.value
})
const searchPlaceholder = computed(() => leftTab.value === '图纸'
  ? '搜索图纸'
  : leftTab.value === '我的' ? '搜索我的组件' : '搜索组件')
const allGroupsOpen = computed(() => groups.value.every(group => group.open))
const projectDrawingTargetName = computed(() => currentDrawingFile.value.kind === 'project' && currentDrawingFile.value.name
  ? currentDrawingFile.value.name
  : drawingFileName(fileName.value))
const saveTargetTitle = computed(() => currentDrawingFile.value.kind === 'custom'
  ? `保存“${fileName.value}”到 ${currentDrawingFile.value.name || '自定义位置'}`
  : `保存“${fileName.value}”到 图纸库/${projectDrawingTargetName.value}`)
const paperSessionEntries = computed(() => {
  const sessions = paperSessions.value.map(session => {
    const active = session.id === activePaperSessionId.value
    const data = active ? {
      fileName: fileName.value,
      nodes: nodes.value,
      drawings: drawings.value,
      stageWidth: stageWidth.value,
      stageHeight: stageHeight.value
    } : session.data
    const file = active ? currentDrawingFile.value : session.file
    const title = String(data.fileName || '未命名图纸')
    const projectTargetName = drawingFileName(title)
    const unsavedProject = file?.kind !== 'custom' && !file?.name
    return { session, active, data, file, title, projectTargetName, unsavedProject }
  })
  const unsavedTargetCounts = new Map()
  for (const session of sessions) {
    if (!session.unsavedProject) continue
    const key = drawingComparisonKey(session.projectTargetName, drawingNamesCaseSensitive.value)
    unsavedTargetCounts.set(key, (unsavedTargetCounts.get(key) || 0) + 1)
  }
  return sessions.map(({ session, active, data, file, title, projectTargetName, unsavedProject }) => {
    const nameConflict = unsavedProject
      && drawingFilesLoaded.value
      && drawingFiles.value.some(entry => drawingNamesMatch(entry.name, projectTargetName, drawingNamesCaseSensitive.value))
    const unsavedTargetConflict = unsavedProject
      && (unsavedTargetCounts.get(drawingComparisonKey(projectTargetName, drawingNamesCaseSensitive.value)) || 0) > 1
    const nameCheckPending = unsavedProject && !drawingFilesLoaded.value
    const pendingLocation = drawingFilesLoading.value
      ? '未保存 · 正在检查名称'
      : drawingFilesError.value ? '未保存 · 名称未检查' : '未保存 · 名称待检查'
    return {
      id: session.id,
      active,
      title,
      objectCount: (data.nodes?.length || 0) + (data.drawings?.length || 0),
      stageWidth: Number(data.stageWidth) || DEFAULT_STAGE_WIDTH,
      stageHeight: Number(data.stageHeight) || DEFAULT_STAGE_HEIGHT,
      location: file?.kind === 'custom'
        ? '其他位置'
        : file?.name
          ? '图纸库'
          : nameConflict
            ? '未保存 · 同名冲突'
            : unsavedTargetConflict ? '未保存 · 同名目标' : nameCheckPending ? pendingLocation : '未保存',
      targetName: unsavedProject ? `图纸库/${projectTargetName}` : (file?.name || ''),
      nameConflict: nameConflict || unsavedTargetConflict,
      statusTitle: nameConflict
        ? `图纸库中已存在“${projectTargetName}”，请修改当前图纸名称，或先删除图纸库中的同名文件`
        : unsavedTargetConflict
          ? `另一个未保存图纸也将保存到“图纸库/${projectTargetName}”，请为其中一张图纸修改名称`
          : nameCheckPending ? '尚未取得最新图纸库清单，不能确定该名称是否已存在' : ''
    }
  })
})
const filteredPaperSessionEntries = computed(() => filterPaperEntries(paperSessionEntries.value, search.value))
function nodeDisplayName(node) { return String(node.text || '').trim() || typeDisplayName.get(node.type) || (node.type === 'pencil' ? '铅笔线稿' : '未命名组件') }
function structureNodeDisplayName(node) { return node?.type === 'text' ? '文本' : nodeDisplayName(node) }
function nodeCollectionBounds(items) {
  if (!items.length) return null
  const frames = items.map(nodeSelectionBounds)
  const left = Math.min(...frames.map(frame => frame.x))
  const top = Math.min(...frames.map(frame => frame.y))
  const right = Math.max(...frames.map(frame => frame.x + frame.w))
  const bottom = Math.max(...frames.map(frame => frame.y + frame.h))
  const minimumHeight = items.every(item => nodeMinimumSize(item).h < 1) ? .1 : 1
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(minimumHeight, bottom - top) }
}
function nodeSelectionBounds(node) {
  return rotatedFrameBounds(node)
}
function framesIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
}
function roundedMetric(value) { return Math.round(Number(value) * 100) / 100 }
function formatCanvasZoom(value) {
  const percent = clampCanvasZoom(value) * 100
  const digits = percent < 10 ? 2 : percent < 100 ? 1 : 0
  return `${Number(percent.toFixed(digits))}%`
}
const selectedCategory = computed(() => selected.value ? typeCategory.get(selected.value.type) || (selected.value.type === 'pencil' ? '基本形状' : '通用组件') : '')
const BUILT_IN_ANIMATION_OPTIONS = Object.freeze({
  flowDirection: Object.freeze([{ value: 'flow', label: '流动' }, { value: 'none', label: '无' }]),
  flowPipe: Object.freeze([{ value: 'flow', label: '流动' }, { value: 'none', label: '无' }]),
  rotatingFan: Object.freeze([{ value: 'flow', label: '旋转' }, { value: 'none', label: '无' }]),
  signalLight: Object.freeze([{ value: 'blink', label: '颜色切换' }, { value: 'none', label: '无' }]),
  waterTank: Object.freeze([{ value: 'flow', label: '水面流动' }, { value: 'none', label: '无' }]),
  heartbeat: Object.freeze([{ value: 'pulse', label: '告警脉冲' }, { value: 'none', label: '无' }]),
  particles: Object.freeze([{ value: 'flow', label: '粒子流动' }, { value: 'none', label: '无' }])
})
function builtInAnimationOptions(node) {
  return BUILT_IN_ANIMATION_OPTIONS[node?.type] || BUILT_IN_ANIMATION_OPTIONS.flowPipe
}
const INTERACTION_ANIMATION_OPTIONS = Object.freeze({
  none: Object.freeze({ value: 'none', label: '无' }),
  pulse: Object.freeze({ value: 'pulse', label: '呼吸' }),
  float: Object.freeze({ value: 'float', label: '浮动' }),
  flow: Object.freeze({ value: 'flow', label: '数据流动' }),
  blink: Object.freeze({ value: 'blink', label: '状态闪烁' })
})
const INTERACTION_ANIMATION_BASE_VALUES = Object.freeze(['none', 'pulse', 'float'])
const INTERACTION_ANIMATION_VALUES_BY_TYPE = Object.freeze({
  chart: Object.freeze([...INTERACTION_ANIMATION_BASE_VALUES, 'flow']),
  gauge: Object.freeze([...INTERACTION_ANIMATION_BASE_VALUES, 'flow']),
  server: Object.freeze([...INTERACTION_ANIMATION_BASE_VALUES, 'blink'])
})
function interactionAnimationOptions(node) {
  const values = INTERACTION_ANIMATION_VALUES_BY_TYPE[node?.type] || INTERACTION_ANIMATION_BASE_VALUES
  return values.map(value => INTERACTION_ANIMATION_OPTIONS[value])
}
function supportsInteractionAnimation(node) {
  if (!node || node.type === 'pencil' || formTypeIds.has(node.type)) return false
  return !BUILT_IN_ANIMATION_OPTIONS[node.type] && !String(node.type || '').startsWith('custom')
}
function normalizeBuiltInAnimationDuration(node = selected.value) {
  if (!node || node.locked) return
  const duration = Number(node.animationDuration)
  node.animationDuration = Math.max(
    ANIMATION_DURATION_MIN_SECONDS,
    Math.min(BUILT_IN_ANIMATION_DURATION_MAX_SECONDS, Number.isFinite(duration) ? duration : 1.5)
  )
  // LOD canvases cache materialized visual descriptors, so commit the timing
  // change explicitly instead of waiting for the deferred property refresh.
  markMiniMapDirty()
}
function refreshBuiltInAnimation(node = selected.value) {
  if (!node || node.locked) return
  const request = { nodes: [node], dense: false, pending: false }
  if (editorLodActive.value && !editorRenderPaused.value) {
    editorLodCanvas.value?.requestRuntimeRender?.(request)
    editorLodDetailCanvas.value?.requestRuntimeRender?.(request)
  }
  if (showMiniMap.value) miniMapPreview.value?.requestRuntimeRender?.(request)
}
function setInteractionAnimation(node, value) {
  if (!node || node.locked || !supportsInteractionAnimation(node)) return
  const options = interactionAnimationOptions(node)
  const next = options.some(option => option.value === value) ? value : 'none'
  if (node.animation === next && node.animationPaused !== true) return
  node.animation = next
  node.animationPaused = false
  // 大图纸会把组件交给 Canvas 绘制，属性修改后需主动刷新其缓存画面。
  refreshBuiltInAnimation(node)
}
function setFlowDirectionAnimationEnabled(node, enabled) {
  if (!node || node.type !== 'flowDirection' || node.locked) return
  node.animation = enabled ? 'flow' : 'none'
  if (enabled) node.animationPaused = false
  refreshBuiltInAnimation(node)
}
function normalizeWaterTankProgress(node = selected.value) {
  if (!node || node.type !== 'waterTank' || node.locked) return
  const progress = Number(node.progressValue)
  node.progressValue = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0))
}
const selectedBindingParameters = computed(() => (
  selectedNodeCount.value === 1 && selected.value
    ? getBindableParameters(selected.value)
    : []
))
const miniMapRenderTransform = computed(() => miniMapTransform({
  stageWidth: stageWidth.value,
  stageHeight: stageHeight.value,
  width: miniMapWidth,
  height: miniMapHeight,
  fitMode: 'contain'
}))
const miniMapViewportStyle = computed(() => {
  const frame = miniMapViewportRect(miniMapRenderTransform.value, viewport.value, zoom.value, miniMapViewportMinSize)
  return {
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`
  }
})
const miniMapCanvasStyle = computed(() => {
  const transform = miniMapRenderTransform.value
  return {
    left: `${transform.offsetX}px`,
    top: `${transform.offsetY}px`,
    width: `${transform.contentWidth}px`,
    height: `${transform.contentHeight}px`
  }
})
const canvasSizePreset = computed(() => {
  const value = `${stageWidth.value}x${stageHeight.value}`
  return canvasPresetValues.has(value) ? value : 'custom'
})
const layerEntries = shallowRef([])
const structureContentStyle = computed(() => ({ height: `${layerEntries.value.length * STRUCTURE_ROW_HEIGHT}px` }))
const structureVirtualRows = computed(() => {
  const entries = layerEntries.value
  const viewportRows = Math.ceil(Math.max(structureViewportHeight.value, 640) / STRUCTURE_ROW_HEIGHT)
  const requestedStart = Math.max(0, Math.floor(structureScrollTop.value / STRUCTURE_ROW_HEIGHT) - STRUCTURE_OVERSCAN_ROWS)
  const start = Math.min(requestedStart, Math.max(0, entries.length - viewportRows))
  const end = Math.min(entries.length, start + viewportRows + STRUCTURE_OVERSCAN_ROWS * 2)
  return Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset
    return { item: entries[entries.length - index - 1], index }
  })
})
// 画布只读取实体自身层级；完整图层条目只在结构面板、鹰眼或层级命令实际使用时才排序。
const nodeLayerIndex = { get: id => Number(nodeIndex.value.get(id)?.layer) || 0 }
const drawingLayerIndex = { get: id => Number(drawingIndex.value.get(id)?.layer) || 0 }
function updateStructureViewport() {
  const target = structureScroller.value
  if (!target) return
  structureScrollTop.value = target.scrollTop
  structureViewportHeight.value = target.clientHeight
}
function createLayerEntry(kind, entity) {
  return { kind, id: entity.id, entity, layer: Number(entity.layer) || 0 }
}
function rebuildLayerEntries(nodeList = nodes.value, drawingList = drawings.value) {
  layerEntries.value = [
    ...nodeList.map(node => createLayerEntry('node', node)),
    ...drawingList.map(drawing => createLayerEntry('drawing', drawing))
  ].sort((a, b) => a.layer - b.layer)
}
function reserveEntityLayers(count = 1) {
  return entityLayerAllocator.reserve(count).start
}
function appendLayerEntries(kind, source = []) {
  const additions = source.map(entity => createLayerEntry(kind, entity)).sort((a, b) => a.layer - b.layer)
  if (!additions.length) return
  const entries = layerEntries.value
  if (!entries.length || additions[0].layer > entries.at(-1).layer) entries.push(...additions)
  else {
    for (const entry of additions) {
      let low = 0
      let high = entries.length
      while (low < high) {
        const middle = (low + high) >> 1
        if (entries[middle].layer <= entry.layer) low = middle + 1
        else high = middle
      }
      entries.splice(low, 0, entry)
    }
  }
  triggerRef(layerEntries)
}
function removeLayerEntries(kind, source = []) {
  const ids = new Set(source.map(item => item?.id ?? item))
  if (!ids.size) return
  const entries = layerEntries.value
  let writeIndex = 0
  for (let readIndex = 0; readIndex < entries.length; readIndex += 1) {
    const entry = entries[readIndex]
    if (entry.kind === kind && ids.has(entry.id)) continue
    if (writeIndex !== readIndex) entries[writeIndex] = entry
    writeIndex += 1
  }
  if (writeIndex === entries.length) return
  entries.splice(writeIndex)
  triggerRef(layerEntries)
}
function synchronizeLayerOrder(entries) {
  entries.forEach((entry, index) => { entry.entity.layer = index + 1 })
  entityLayerAllocator.reconcile(entries.length)
  rebuildLayerEntries()
  markMiniMapDirty()
}
function isNodeSelected(id) { return selectedNodeIdSet.value.has(id) }
function nodeSelectionMembers(node) {
  if (!node?.groupId) return node ? [node] : []
  return nodes.value.filter(item => item.groupId === node.groupId)
}
function setNodeSelection(ids, primaryId = null) {
  flushPendingDocumentEdits()
  const validIds = [...new Set(ids)].filter(id => nodeIndex.value.has(id))
  const nextPrimaryId = validIds.includes(primaryId) ? primaryId : validIds.at(-1) || null
  const selectionChanged = selectedId.value !== nextPrimaryId || validIds.length !== selectedNodeIds.value.length || validIds.some((id, index) => id !== selectedNodeIds.value[index])
  if (selectionChanged) {
    selectedNodeIds.value = validIds
    selectedId.value = nextPrimaryId
  }
  selectedDrawingId.value = null
  paperSelected.value = false
}
function clearNodeSelection() {
  flushPendingDocumentEdits()
  if (selectedNodeIds.value.length) selectedNodeIds.value = []
  if (selectedId.value != null) selectedId.value = null
}
function selectSingleNode(node) {
  if (!node) return clearNodeSelection()
  setNodeSelection(nodeSelectionMembers(node).map(item => item.id), node.id)
}
function toggleNodeSelection(node) {
  const memberIds = nodeSelectionMembers(node).map(item => item.id)
  const current = new Set(selectedNodeIds.value)
  const remove = memberIds.every(id => current.has(id))
  memberIds.forEach(id => remove ? current.delete(id) : current.add(id))
  const nextIds = [...current]
  const primaryId = remove && !current.has(selectedId.value) ? nextIds.at(-1) : (remove ? selectedId.value : node.id)
  setNodeSelection(nextIds, primaryId)
}
function selectLayerEntry(item) {
  paperSelected.value = false
  editingFormId.value = null
  if (item.kind === 'node') selectSingleNode(item.entity)
  else { clearNodeSelection(); selectedDrawingId.value = item.id }
}
function selectPaper() {
  paperSelected.value = true
  clearNodeSelection()
  selectedDrawingId.value = null
  editingText.value = null
  editingFormId.value = null
  rightTab.value = '属性'
  rightOpen.value = true
}
function setLeftTab(tab) {
  const entering = leftTab.value !== tab
  if (entering) search.value = ''
  leftTab.value = tab
  editingFormId.value = null
  if (tab !== '图纸') paperSelected.value = false
  else if (entering || !drawingFilesLoaded.value) void refreshDrawingFiles()
}
function normalizeCanvasStyle() {
  canvasBorderWidth.value = Math.round(Math.max(0, Math.min(10, Number(canvasBorderWidth.value) || 0)))
  gridSize.value = Math.round(Math.max(5, Math.min(100, Number(gridSize.value) || 20)))
}
async function normalizeCanvasSize() {
  if (operation.value) pointerUp()
  stageWidth.value = clampCanvasDimension(stageWidth.value, DEFAULT_STAGE_WIDTH)
  stageHeight.value = clampCanvasDimension(stageHeight.value, DEFAULT_STAGE_HEIGHT)
  const lockedGroupIds = new Set(nodes.value.filter(node => node.locked && node.groupId).map(node => node.groupId))
  const editableNodes = nodes.value.filter(node => !node.locked && (!node.groupId || !lockedGroupIds.has(node.groupId)))
  normalizeNodesTogether(editableNodes, stageWidth.value, stageHeight.value)
  drawings.value.forEach(drawing => {
    if (drawing.locked || !drawing.points.length) return
    const bounds = drawingBounds(drawing)
    const { dx, dy } = constrainTranslation([bounds], 0, 0, stageWidth.value, stageHeight.value)
    if (dx || dy) drawing.points = drawing.points.map(point => ({ x: point.x + dx, y: point.y + dy }))
  })
  rebuildNodeSpatialIndex()
  await nextTick()
  updateViewport()
}
async function setCanvasPreset(value) {
  if (!canvasPresetValues.has(value)) return
  const [width, height] = value.split('x').map(Number)
  stageWidth.value = width
  stageHeight.value = height
  await normalizeCanvasSize()
}
async function useCurrentScreenSize() {
  const width = globalThis.screen?.width || globalThis.innerWidth
  const height = globalThis.screen?.height || globalThis.innerHeight
  stageWidth.value = clampCanvasDimension(width, DEFAULT_STAGE_WIDTH)
  stageHeight.value = clampCanvasDimension(height, DEFAULT_STAGE_HEIGHT)
  await normalizeCanvasSize()
  notify(`画布已设为当前屏幕尺寸 ${stageWidth.value} × ${stageHeight.value}`)
}
const edgeAdjacency = shallowRef(createEdgeAdjacencyIndex())
const edgeSpatialRevision = ref(0)
let documentIndexRebuildRequired = false
let edgeSpatialIndex = createSpatialIndex([], {
  cellSize: 512,
  getBounds: edge => edgeBoundsForNodes(edge, nodeIndex.value)
})

function rebuildEdgeSpatialIndex(source = edges.value) {
  edgeSpatialIndex.rebuild(source)
  edgeSpatialRevision.value += 1
}

function updateEdgeSpatialIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  let changed = false
  for (const edge of items) {
    if (!edge?.id) continue
    changed = edgeSpatialIndex.update(edge) || changed
  }
  if (changed && publish) edgeSpatialRevision.value += 1
  return changed
}

function removeEdgeSpatialIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  let changed = false
  for (const item of items) changed = edgeSpatialIndex.remove(item?.id ?? item) || changed
  if (changed && publish) edgeSpatialRevision.value += 1
  return changed
}

function updateConnectedEdgeSpatialIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  const nodeIds = items.map(item => item?.id ?? item).filter(id => id != null && id !== '')
  if (incidentEdgeCountExceedsLimit(edgeAdjacency.value, nodeIds, EDITOR_LOD_INTERACTION_EDGE_LIMIT)) {
    documentIndexRebuildRequired = true
    return false
  }
  const connected = new globalThis.Map()
  for (const item of items) {
    for (const edge of edgeAdjacency.value.get(item?.id ?? item)) connected.set(edge.id, edge)
  }
  return updateEdgeSpatialIndex([...connected.values()], publish)
}

function updateEdgeAdjacency(removedEdges = [], insertedEdges = []) {
  if (!removedEdges.length && !insertedEdges.length) return
  edgeAdjacency.value.applyChanges(removedEdges, insertedEdges)
  const removed = removeEdgeSpatialIndex(removedEdges, false)
  const inserted = updateEdgeSpatialIndex(insertedEdges, false)
  if (removed || inserted) edgeSpatialRevision.value += 1
  triggerRef(edgeAdjacency)
  if (documentIndexRebuildRequired) scheduleDocumentIndexCompaction()
}
let nodeSpatialIndex = createSpatialIndex([], { cellSize: 512 })
const nodeSpatialRevision = ref(0)

function rebuildNodeSpatialIndex(source = nodes.value) {
  nodeSpatialIndex.rebuild(source)
  nodeSpatialRevision.value += 1
}

function updateNodeSpatialIndex(source, publish = true) {
  const items = Array.isArray(source) ? source : [source]
  const missingNode = items.some(node => node?.id && !nodeIndex.value.has(node.id))
  const appendedNodes = new globalThis.Map()
  if (missingNode) {
    // 所有普通新增路径都是先 push 再登记；只检查等长尾段即可取得 Vue 代理，避免逐项全表查找。
    const start = Math.max(0, nodes.value.length - items.length)
    for (let index = start; index < nodes.value.length; index += 1) {
      const node = nodes.value[index]
      if (node?.id) appendedNodes.set(node.id, node)
    }
  }
  let changed = false
  let lookupChanged = false
  for (const node of items) {
    // 新增节点在写入响应式数组后必须换成代理对象，否则属性编辑不会触发画布重绘。
    const indexedNode = nodeIndex.value.get(node?.id) || appendedNodes.get(node?.id) || node
    if (!indexedNode) continue
    if (!nodeIndex.value.has(indexedNode.id)) {
      nodeIndex.value.set(indexedNode.id, indexedNode)
      lookupChanged = true
    }
    changed = nodeSpatialIndex.update(indexedNode) || changed
  }
  if (lookupChanged) triggerRef(nodeIndex)
  const connectedEdgesChanged = changed && updateConnectedEdgeSpatialIndex(items, false)
  // 指针拖动期间索引仍逐帧保持准确，但可见集合只在操作结束时发布一次。
  if (changed && publish) {
    nodeSpatialRevision.value += 1
    if (connectedEdgesChanged) edgeSpatialRevision.value += 1
    if (documentIndexRebuildRequired) scheduleDocumentIndexCompaction()
  }
  return changed
}

function applyNodeSpatialChanges(removedNodes = [], insertedNodes = []) {
  let changed = false
  let lookupChanged = false
  for (const item of removedNodes) {
    lookupChanged = nodeIndex.value.delete(item.id) || lookupChanged
    changed = nodeSpatialIndex.remove(item.id) || changed
  }
  for (const item of insertedNodes) {
    if (item.value?.id) {
      nodeIndex.value.set(item.value.id, item.value)
      lookupChanged = true
    }
    changed = nodeSpatialIndex.update(item.value) || changed
  }
  if (lookupChanged) triggerRef(nodeIndex)
  if (changed) nodeSpatialRevision.value += 1
}

function rebuildDocumentIndexes() {
  documentIndexRebuildRequired = false
  rebuildNodeIndex()
  rebuildDrawingIndex()
  rebuildTimeNodeIndex()
  rebuildRuntimeDataKeyIndex()
  rebuildNodeSpatialIndex()
  edgeAdjacency.value.rebuild(edges.value)
  triggerRef(edgeAdjacency)
  rebuildEdgeSpatialIndex()
  entityLayerAllocator.rebuild([nodes.value, drawings.value])
  rebuildLayerEntries()
}

function replaceEntityCollections(nextNodes, nextEdges, nextDrawings) {
  nodes.value = nextNodes
  edges.value = nextEdges
  drawings.value = nextDrawings
  rebuildDocumentIndexes()
}

function installPreparedEntityCollections(runtime) {
  documentIndexRebuildRequired = false
  nodes.value = runtime.nodes
  edges.value = runtime.edges
  drawings.value = runtime.drawings
  nodeIndex.value = runtime.nodeIndex
  drawingIndex.value = runtime.drawingIndex
  timeNodeIndex.value = runtime.timeNodeIndex
  runtimeDataKeyIndex = runtime.runtimeDataKeyIndex
  runtimeBindingPointIndex = runtime.runtimeBindingPointIndex
  nodeSpatialIndex = runtime.nodeSpatialIndex
  drawingSpatialIndex = runtime.drawingSpatialIndex
  edgeAdjacency.value = runtime.edgeAdjacency
  edgeSpatialIndex = runtime.edgeSpatialIndex
  entityLayerAllocator = runtime.entityLayerAllocator
  layerEntries.value = runtime.layerEntries
  nodeSpatialRevision.value += 1
  drawingSpatialRevision.value += 1
  edgeSpatialRevision.value += 1
  sourceBindingRuntime.rebuildDeferred(runtime.nodes)
  setActiveRuntimeDataKeys(runtime.runtimeKeys)
  void sourceSnapshotReplayCoordinator.replay(runtime.sourceIds)
}

function appendNodes(source = []) {
  const items = Array.isArray(source) ? source : [source]
  if (!items.length) return []
  const start = nodes.value.length
  nodes.value.push(...items)
  const inserted = nodes.value.slice(start)
  updateNodeSpatialIndex(inserted)
  addTimeNodes(inserted)
  addRuntimeDataNodes(inserted)
  appendLayerEntries('node', inserted)
  entityLayerAllocator.commit(inserted)
  retainInsertedEditorLodNodes(inserted)
  return inserted
}

function retainInsertedEditorLodNodes(source = []) {
  if (!editorLodActive.value || !editorLodCanvasRendersEntities.value || editorRenderPaused.value) return false
  const nextIds = new Set(editorLodPendingInsertionNodeIds.value)
  for (const node of source) {
    if (node?.id == null || nextIds.size >= EDITOR_LOD_MAX_OVERLAY_NODES) break
    nextIds.add(node.id)
  }
  editorLodPendingInsertionNodeIds.value = [...nextIds]
  markEditorLodDirty()
  return true
}

function appendEdges(source = []) {
  const items = Array.isArray(source) ? source : [source]
  if (!items.length) return []
  const start = edges.value.length
  edges.value.push(...items)
  const inserted = edges.value.slice(start)
  updateEdgeAdjacency([], inserted)
  return inserted
}

function appendDrawings(source = []) {
  const items = Array.isArray(source) ? source : [source]
  if (!items.length) return []
  const start = drawings.value.length
  drawings.value.push(...items)
  const inserted = drawings.value.slice(start)
  updateDrawingIndex(inserted)
  appendLayerEntries('drawing', inserted)
  entityLayerAllocator.commit(inserted)
  return inserted
}

let miniMapRevisionFrame = 0
let editorLodRenderFrame = 0
let runtimeCanvasRenderFrame = 0
function invalidateEditorLodDetail(reason = 'document-dirty') {
  editorLodDetailFresh.value = false
  if (!editorLodDetailCommittedFrame.value) editorLodDetailReady.value = false
  editorLodDetailCanvas.value?.invalidatePendingRender?.(reason)
}
function markEditorLodDirty() {
  if (editorLodGeometrySession.value || !editorLodActive.value || editorRenderPaused.value) return
  editorLodContentRevision.value += 1
  invalidateEditorLodDetail()
  if (editorLodRenderFrame) return
  editorLodRenderFrame = requestAnimationFrame(() => {
    editorLodRenderFrame = 0
    if (!editorLodActive.value || editorRenderPaused.value) return
    for (const target of [editorLodCanvas.value, editorLodDetailCanvas.value]) {
      if (target?.requestCoalescedRender) target.requestCoalescedRender()
      else target?.requestRender?.()
    }
  })
}
function markRuntimeCanvasDirty() {
  if (!runtimeCanvasRenderingActive() || runtimeCanvasRenderFrame) return
  if (previewCanvasRenderActive.value) {
    previewFrameFreshness.markRuntimeStale()
    syncPreviewFitFrameFreshness()
  }
  runtimeCanvasRenderFrame = requestAnimationFrame(() => {
    runtimeCanvasRenderFrame = 0
    const targets = []
    if (editorLodActive.value && !editorRenderPaused.value && editorLodCanvas.value) targets.push(editorLodCanvas.value)
    if (editorLodActive.value && !editorRenderPaused.value && editorLodDetailCanvas.value) targets.push(editorLodDetailCanvas.value)
    if (previewCanvasRenderActive.value && previewFitCanvas.value) targets.push(previewFitCanvas.value)
    if (previewDomEdgeCanvasActive.value && previewEdgeCanvas.value) targets.push(previewEdgeCanvas.value)
    if (showMiniMap.value && miniMapPreview.value) targets.push(miniMapPreview.value)
    if (!targets.length) {
      if (runtimeCanvasRenderingActive()) markRuntimeCanvasDirty()
      return
    }
    const startedAt = performance.now()
    let batches = 0
    do {
      const dirty = takeRuntimeCanvasDirtyNodes()
      batches += 1
      if (dirty.full && editorLodActive.value) invalidateEditorLodDetail('runtime-full')
      const runtimeRequest = {
        nodes: dirty.nodes,
        dense: dirty.dense,
        pending: dirty.pending
      }
      for (const target of targets) {
        if (dirty.full) target.requestCoalescedRender?.()
        else target.requestRuntimeRender?.(runtimeRequest)
      }
      if (dirty.full || !dirty.pending) break
    } while (
      batches < RUNTIME_CANVAS_DISPATCH_BATCH_LIMIT
      && performance.now() - startedAt < RUNTIME_CANVAS_DISPATCH_BUDGET_MS
    )
    if (runtimeCanvasDirtyQueue.hasPending()) markRuntimeCanvasDirty()
  })
}
function markMiniMapDirty() {
  markEditorLodDirty()
  if (miniMapRevisionFrame) return
  miniMapRevisionFrame = requestAnimationFrame(() => {
    miniMapRevisionFrame = 0
    miniMapPreview.value?.requestRender()
  })
}
let documentInputRenderTimer = 0
function markDocumentInput(event) {
  documentChangeVersion += 1
  scheduleWorkspaceSessionPersistence()
  if (event?.type === 'input') {
    clearTimeout(documentInputRenderTimer)
    documentInputRenderTimer = setTimeout(() => {
      documentInputRenderTimer = 0
      markMiniMapDirty()
    }, 80)
    return
  }
  markMiniMapDirty()
}
function flushDocumentInputRender() {
  if (!documentInputRenderTimer) return false
  clearTimeout(documentInputRenderTimer)
  documentInputRenderTimer = 0
  markMiniMapDirty()
  return true
}
function viewportWorldBounds(currentViewport, scale = 1, bufferPixels = DEFAULT_VIEWPORT_OVERSCAN) {
  const safeScale = Math.max(.0001, finiteNumber(scale, 1))
  const buffer = bufferPixels / safeScale
  return {
    x: currentViewport.left / safeScale - buffer,
    y: currentViewport.top / safeScale - buffer,
    w: currentViewport.width / safeScale + buffer * 2,
    h: currentViewport.height / safeScale + buffer * 2
  }
}

function queryNodesInBounds(bounds) {
  void nodeSpatialRevision.value
  return nodeSpatialIndex.query(bounds, { sort: false })
}

function rotateHandleBelow(frame) {
  if (!frame) return false
  const scale = zoom.value
  const x = finiteNumber(frame.x, 0)
  const y = finiteNumber(frame.y, 0)
  const width = Math.max(1, finiteNumber(frame.w, 1))
  const height = Math.max(1, finiteNumber(frame.h, 1))
  const radians = finiteNumber(frame.rotate, 0) * Math.PI / 180
  const normalX = -Math.sin(radians)
  const normalY = Math.cos(radians)
  const distance = height / 2 + ROTATE_HANDLE_CENTER_OFFSET / scale
  const center = { x: x + width / 2, y: y + height / 2 }
  const candidates = [
    { x: center.x - normalX * distance, y: center.y - normalY * distance },
    { x: center.x + normalX * distance, y: center.y + normalY * distance }
  ]
  const screenWidth = stageWidth.value * scale
  const screenHeight = stageHeight.value * scale
  const clearance = point => Math.min(
    point.x * scale - ROTATE_HANDLE_HIT_RADIUS,
    screenWidth - point.x * scale - ROTATE_HANDLE_HIT_RADIUS,
    point.y * scale - ROTATE_HANDLE_HIT_RADIUS,
    screenHeight - point.y * scale - ROTATE_HANDLE_HIT_RADIUS
  )
  const topClearance = clearance(candidates[0])
  const bottomClearance = clearance(candidates[1])
  return topClearance < 0 && bottomClearance > topClearance
}
function resizeHandleCursor(direction, rotation = 0) {
  const baseAngle = resizeCursorBaseAngle[direction] ?? 0
  const angle = ((baseAngle + finiteNumber(rotation, 0)) % 180 + 180) % 180
  return resizeCursors[Math.round(angle / 45) % resizeCursors.length]
}
function nodesInViewport(currentViewport, scale = 1) {
  const overscan = nodes.value.length >= LARGE_DOCUMENT_NODE_COUNT ? LARGE_DOCUMENT_OVERSCAN : DEFAULT_VIEWPORT_OVERSCAN
  return queryNodesInBounds(viewportWorldBounds(currentViewport, scale, overscan))
}
const activeOperationNodeIds = computed(() => {
  const current = operation.value
  if (!current || current.deferPointerCapture) return EMPTY_NODE_ID_SET
  if (current.transientLargeSelection) {
    const anchorId = current.anchorId || current.id || current.items?.[0]?.id
    return anchorId == null ? EMPTY_NODE_ID_SET : new Set([anchorId])
  }
  if (['moveNodes', 'resizeNodes', 'rotateNodes'].includes(current.type)) return new Set(current.items.map(item => item.id))
  return ['resize', 'rotate'].includes(current.type) && current.id != null ? new Set([current.id]) : EMPTY_NODE_ID_SET
})
function deactivateNodeMoveInteraction(op) {
  if (op?.type === 'moveNodes') op.nodeMoveInteractionActive = false
}
const visibleNodes = computed(() => {
  const visible = transientCanvasRenderBounds.value
    ? queryNodesInBounds(transientCanvasRenderBounds.value)
    : nodesInViewport(viewport.value, zoom.value)
  const activeIds = activeOperationNodeIds.value
  if (!activeIds.size) return visible
  const included = new Set(visible.map(node => node.id))
  let appended = false
  for (const id of activeIds) {
    const node = nodeIndex.value.get(id)
    if (node && !included.has(id)) {
      visible.push(node)
      appended = true
    }
  }
  return appended ? visible.sort((a, b) => (Number(a.layer) || 0) - (Number(b.layer) || 0)) : visible
})
// 低倍率或单屏节点过密时使用单个 Canvas，避免一次创建数百至数千个 NodeVisual。
const editorDenseLodActive = computed(() => {
  if (nodes.value.length < EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD) return false
  void nodeSpatialRevision.value
  const bounds = transientCanvasRenderBounds.value || viewportWorldBounds(viewport.value, zoom.value, LARGE_DOCUMENT_OVERSCAN)
  const visible = nodeSpatialIndex.query(bounds, { sort: false, limit: EDITOR_DOM_NODE_LIMIT + 1 })
  return visible.length > EDITOR_DOM_NODE_LIMIT || shouldUseAnimatedFlowDirectionLod(visible)
})
const editorFullLodActive = computed(() => shouldUseEditorLod(nodes.value.length, zoom.value) || editorDenseLodActive.value)
const editorDenseEdgeLodActive = computed(() => {
  if (edges.value.length <= EDITOR_DOM_EDGE_LIMIT) return false
  void edgeSpatialRevision.value
  const bounds = transientCanvasRenderBounds.value || viewportWorldBounds(viewport.value, zoom.value, LARGE_DOCUMENT_OVERSCAN)
  return edgeSpatialIndex.query(bounds, { sort: false, limit: EDITOR_DOM_EDGE_LIMIT + 1 }).length > EDITOR_DOM_EDGE_LIMIT
})
const editorEdgeOnlyLodActive = computed(() => !editorFullLodActive.value && editorDenseEdgeLodActive.value)
// Persistent node LOD remains separate so the existing progressive handoff can mount DOM before edge-only mode takes over.
const editorPersistentLodActive = computed(() => editorFullLodActive.value)
const editorLodActive = computed(() => editorFullLodActive.value || editorEdgeOnlyLodActive.value || editorProgressiveDomActive.value)
const editorLodCanvasRendersEntities = computed(() => !editorEdgeOnlyLodActive.value || editorProgressiveDomActive.value)
const editorLodFallbackPlanKey = computed(() => `editor-${editorLodCanvasRendersEntities.value ? 'full' : 'edges'}`)
// 预览覆盖层挂载后编辑器已不可见，立即暂停其 Canvas，避免与预览首帧争抢主线程。
const editorRenderPaused = computed(() => showPreview.value)

function cancelEditorProgressiveDomFrame() {
  if (!editorProgressiveDomFrame) return
  cancelBundleFrame(editorProgressiveDomFrame)
  editorProgressiveDomFrame = 0
}

function clearEditorProgressiveDomMount() {
  editorProgressiveDomGeneration += 1
  cancelEditorProgressiveDomFrame()
  editorProgressiveDomActive.value = false
  editorProgressiveDomNodeIds.value = []
}

function editorProgressiveDomMountRequired(source) {
  return !editorPersistentLodActive.value
    && source.length > EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD
}

function restartEditorProgressiveDomMount(source = visibleNodes.value) {
  const candidates = Array.isArray(source) ? source : []
  const generation = ++editorProgressiveDomGeneration
  cancelEditorProgressiveDomFrame()
  if (!editorProgressiveDomMountRequired(candidates)) {
    editorProgressiveDomActive.value = false
    editorProgressiveDomNodeIds.value = []
    return false
  }

  editorProgressiveDomActive.value = true
  const candidateIds = new Set(candidates.map(node => node.id))
  const retainedIds = new Set([
    ...editorProgressiveDomNodeIds.value,
    ...editorLodBootstrapNodeIds.value
  ].filter(id => candidateIds.has(id)))
  let mountedNodes = candidates.filter(node => retainedIds.has(node.id))
  let pendingNodes = candidates.filter(node => !retainedIds.has(node.id))
  if (!mountedNodes.length && pendingNodes.length) {
    const initialEnd = previewMountBatchEnd(pendingNodes, 0, {
      maxNodes: EDITOR_PROGRESSIVE_DOM_BATCH_SIZE,
      costBudget: EDITOR_PROGRESSIVE_DOM_MOUNT_COST
    })
    mountedNodes = pendingNodes.slice(0, initialEnd)
    pendingNodes = pendingNodes.slice(initialEnd)
  }
  const mountedIds = new Set(mountedNodes.map(node => node.id))
  editorProgressiveDomNodeIds.value = candidates.filter(node => mountedIds.has(node.id)).map(node => node.id)

  let pendingStart = 0
  const finish = () => {
    editorProgressiveDomFrame = 0
    if (generation !== editorProgressiveDomGeneration) return
    const current = visibleNodes.value
    const currentIds = new Set(current.map(node => node.id))
    if (current.length !== candidates.length || candidates.some(node => !currentIds.has(node.id))) {
      restartEditorProgressiveDomMount(current)
      return
    }
    editorProgressiveDomActive.value = false
    editorProgressiveDomNodeIds.value = []
  }
  const mountNextBatch = () => {
    editorProgressiveDomFrame = 0
    if (generation !== editorProgressiveDomGeneration) return
    const nextEnd = previewMountBatchEnd(pendingNodes, pendingStart, {
      maxNodes: EDITOR_PROGRESSIVE_DOM_BATCH_SIZE,
      costBudget: EDITOR_PROGRESSIVE_DOM_MOUNT_COST
    })
    if (nextEnd > pendingStart) {
      for (const node of pendingNodes.slice(pendingStart, nextEnd)) mountedIds.add(node.id)
      editorProgressiveDomNodeIds.value = candidates
        .filter(node => mountedIds.has(node.id))
        .map(node => node.id)
      pendingStart = nextEnd
    }
    void nextTick(() => {
      if (generation !== editorProgressiveDomGeneration) return
      editorProgressiveDomFrame = scheduleBundleFrame(
        pendingStart < pendingNodes.length ? mountNextBatch : finish
      )
    })
  }
  editorProgressiveDomFrame = scheduleBundleFrame(
    pendingNodes.length ? mountNextBatch : finish
  )
  return true
}

watch(editorPersistentLodActive, (active, previous) => {
  if (active || previous !== true || editorRenderPaused.value || editorLodDocumentResetPending) return
  restartEditorProgressiveDomMount()
}, { flush: 'sync' })

const editorLodDetailPixelRatio = computed(() => resolveEditorLodDetailPixelRatio(editorDevicePixelRatio.value))
const editorLodDetailOverscan = computed(() => editorLodDetailOverscanPixels({
  viewportWidth: viewport.value.width,
  viewportHeight: viewport.value.height,
  pixelRatio: editorLodDetailPixelRatio.value,
  preferredOverscan: EDITOR_LOD_DETAIL_OVERSCAN
}))
function clippedEditorLodDetailBounds(bufferPixels) {
  const raw = viewportWorldBounds(viewport.value, zoom.value, bufferPixels)
  const left = Math.max(0, Math.min(stageWidth.value, raw.x))
  const top = Math.max(0, Math.min(stageHeight.value, raw.y))
  const right = Math.max(left, Math.min(stageWidth.value, raw.x + raw.w))
  const bottom = Math.max(top, Math.min(stageHeight.value, raw.y + raw.h))
  return {
    x: left,
    y: top,
    w: Math.max(.1, right - left),
    h: Math.max(.1, bottom - top)
  }
}
function editorLodDetailBoundsNeedRefresh(bounds) {
  if (!bounds) return true
  const visible = clippedEditorLodDetailBounds(0)
  const preferred = clippedEditorLodDetailBounds(editorLodDetailOverscan.value)
  const guard = EDITOR_LOD_DETAIL_GUARD / Math.max(.0001, zoom.value)
  return (bounds.x > 0 && visible.x < bounds.x + guard)
    || (bounds.y > 0 && visible.y < bounds.y + guard)
    || (bounds.x + bounds.w < stageWidth.value && visible.x + visible.w > bounds.x + bounds.w - guard)
    || (bounds.y + bounds.h < stageHeight.value && visible.y + visible.h > bounds.y + bounds.h - guard)
    || bounds.w > preferred.w + guard
    || bounds.h > preferred.h + guard
}
function resetEditorLodDetail() {
  editorLodDetailBounds.value = null
  editorLodDetailCommittedFrame.value = null
  editorLodDetailAnimationTimestamp.value = null
  editorLodDetailReady.value = false
  editorLodDetailFresh.value = false
  editorLodRemovalCoverRegions.value = []
  editorLodRemovalFallbackReady.value = false
}
function cancelEditorLodRendering(reason = 'editor-lod-reset') {
  const session = editorLodGeometrySession.value
  editorLodCanvas.value?.cancelGeometryInteraction?.(session?.sessionId)
  editorLodDetailCanvas.value?.cancelGeometryInteraction?.(session?.detailSessionId)
  editorLodCanvas.value?.invalidatePendingRender?.(reason)
  editorLodDetailCanvas.value?.invalidatePendingRender?.(reason)
  resetEditorLodRecovery()
  clearEditorLodGeometryVisualState()
  editorLodCanvasReady.value = false
  editorLodFallbackAnimationTimestamp.value = null
  resetEditorLodDetail()
  editorLodBootstrapNodeIds.value = []
  editorLodBootstrapDrawingIds.value = []
}
function pauseEditorLodRendering(reason = 'preview-open') {
  if (!editorLodActive.value) return
  cancelEditorLodRendering(reason)
  primeEditorLodBootstrap()
}
function syncEditorLodDetailBounds(force = false) {
  if (!editorLodActive.value || editorRenderPaused.value) {
    resetEditorLodDetail()
    return false
  }
  if (!force && !editorLodDetailBoundsNeedRefresh(editorLodDetailBounds.value)) return false
  editorLodDetailBounds.value = clippedEditorLodDetailBounds(editorLodDetailOverscan.value)
  return true
}
const editorLodDetailNodes = computed(() => {
  const bounds = editorLodDetailBounds.value
  if (!bounds || !editorLodActive.value || editorRenderPaused.value || !editorLodCanvasRendersEntities.value) return []
  void nodeSpatialRevision.value
  return nodeSpatialIndex.query(bounds, { sort: false })
})
const editorLodDetailEdges = EMPTY_RENDER_LIST
const editorLodDetailDrawings = computed(() => {
  const bounds = editorLodDetailBounds.value
  return bounds && editorLodActive.value && !editorRenderPaused.value && editorLodCanvasRendersEntities.value
    ? drawingsInBounds(bounds)
    : []
})
const editorLodDetailEntities = computed(() => [
  ...editorLodDetailNodes.value.map(node => createLayerEntry('node', node)),
  ...editorLodDetailDrawings.value.map(drawing => createLayerEntry('drawing', drawing))
].sort((a, b) => a.layer - b.layer))
const editorLodDetailPlanKey = computed(() => {
  const bounds = editorLodDetailBounds.value
  if (!bounds) return ''
  return `editor-detail:${editorLodCanvasRendersEntities.value ? 'full' : 'edges'}:${bounds.x.toFixed(3)}:${bounds.y.toFixed(3)}:${bounds.w.toFixed(3)}:${bounds.h.toFixed(3)}:${zoom.value.toFixed(6)}:${editorLodContentRevision.value}`
})
const editorLodDetailBitmapBudget = computed(() => {
  const bounds = editorLodDetailBounds.value
  return editorLodBitmapPixelBudget({
    stageWidth: bounds?.w,
    stageHeight: bounds?.h,
    zoom: zoom.value,
    devicePixelRatio: editorDevicePixelRatio.value
  })
})
const editorLodGridAppearance = computed(() => editorLodGridPresentation({
  gridSize: gridSize.value,
  zoom: zoom.value
}))
const editorLodDetailFrameStyle = computed(() => {
  const frame = editorLodDetailCommittedFrame.value
  const bounds = frame?.bounds || editorLodDetailBounds.value
  if (!bounds) return {}
  const frameZoom = Math.max(.0001, finiteNumber(frame?.zoom, zoom.value))
  const projectionScale = zoom.value / frameZoom
  const detailClipPath = EDITOR_LOD_DETAIL_CLIP_SUPPORTED ? editorLodDetailClipPath.value : 'none'
  return {
    left: `${bounds.x * zoom.value}px`,
    top: `${bounds.y * zoom.value}px`,
    width: `${finiteNumber(frame?.width, bounds.w * frameZoom)}px`,
    height: `${finiteNumber(frame?.height, bounds.h * frameZoom)}px`,
    transform: Math.abs(projectionScale - 1) < 1e-6 ? 'none' : `scale(${projectionScale})`,
    transformOrigin: '0 0',
    clipPath: detailClipPath,
    WebkitClipPath: detailClipPath
  }
})
const editorLodDetailGridStyle = computed(() => {
  const frame = editorLodDetailCommittedFrame.value
  const bounds = frame?.bounds || editorLodDetailBounds.value
  if (!bounds) return {}
  const frameZoom = Math.max(.0001, finiteNumber(frame?.zoom, zoom.value))
  const currentZoom = Math.max(.0001, finiteNumber(zoom.value, frameZoom))
  const projectionScale = currentZoom / frameZoom
  const grid = editorLodGridPresentation({ gridSize: gridSize.value, zoom: currentZoom })
  return {
    backgroundColor: canvasBg.value,
    backgroundPosition: `${-bounds.x * frameZoom}px ${-bounds.y * frameZoom}px`,
    '--editor-lod-grid-size': `${grid.worldStep * frameZoom}px`,
    '--editor-lod-grid-color': gridColor.value,
    '--editor-lod-grid-stroke': `${grid.stroke / projectionScale}px`,
    '--editor-lod-grid-dot-size': `${grid.dotSize / projectionScale}px`
  }
})
const editorLodDetailFallbackRegions = computed(() => {
  const session = editorLodGeometrySession.value
  return resolveEditorLodDetailFallbackRegions({
    detailBounds: editorLodDetailCommittedFrame.value?.bounds,
    geometryCoverBounds: session?.detailCoverBounds,
    geometryMode: session?.mode,
    geometryCommitted: session?.committed,
    geometryFailed: session?.fallbackFailed,
    removalCoverBounds: editorLodRemovalCoverRegions.value,
    removalFallbackCommitted: editorLodRemovalFallbackReady.value
  })
})
const editorLodDetailClipPath = computed(() => {
  const frame = editorLodDetailCommittedFrame.value
  return createEditorLodDetailClipPath({
    detailBounds: frame?.bounds,
    frameWidth: frame?.width,
    frameHeight: frame?.height,
    regions: editorLodDetailFallbackRegions.value
  })
})
// 裁剪不可用时保留高清帧，避免一次局部拖拽把整个视口降级成低清底图。
const editorLodDetailVisible = computed(() => editorLodDetailReady.value)
watch([editorLodActive, editorRenderPaused, viewport, zoom, stageWidth, stageHeight], (current, previous = []) => {
  const force = !previous.length
    || current[0] !== previous[0]
    || current[1] !== previous[1]
    || current[3] !== previous[3]
    || current[4] !== previous[4]
    || current[5] !== previous[5]
  syncEditorLodDetailBounds(force)
}, { flush: 'sync', immediate: true })
const editorLodOverlayIds = computed(() => editorLodOverlayNodeIds({
  selectedIds: selectedNodeIds.value,
  activeIds: activeOperationNodeIds.value,
  primaryId: selectedId.value,
  anchorId: operation.value?.anchorId || operation.value?.id,
  connectFromId: connectFrom.value,
  editingTextId: editingText.value?.id,
  editingFormId: editingFormId.value
}))
const editorLodOverlayIdSet = computed(() => new Set([
  ...editorLodOverlayIds.value,
  ...editorLodPendingInsertionNodeIds.value
]))
function editorProgressiveDomNodeHidden(nodeId) {
  return editorProgressiveDomActive.value
    && editorLodCanvasRendersEntities.value
    && editorLodCanvasReady.value
    && !editorLodOverlayIdSet.value.has(nodeId)
}
const editorRenderedNodes = computed(() => {
  if (editorRenderPaused.value) return []
  if (!editorLodActive.value || !editorLodCanvasRendersEntities.value) return visibleNodes.value
  const overlayIds = editorLodOverlayIds.value
  const progressiveIds = editorProgressiveDomActive.value ? editorProgressiveDomNodeIds.value : []
  const pendingInsertionIds = editorLodPendingInsertionNodeIds.value
  const ids = editorLodCanvasReady.value
    ? [...new Set([...progressiveIds, ...overlayIds, ...pendingInsertionIds])]
    : [...new Set([...editorLodBootstrapNodeIds.value, ...progressiveIds, ...overlayIds, ...pendingInsertionIds])]
  return ids
    .map(id => nodeIndex.value.get(id))
    .filter(Boolean)
    .sort((a, b) => (Number(a.layer) || 0) - (Number(b.layer) || 0))
})
function editorLodSignalAnimationTimestamp(node) {
  if (!editorLodActive.value || node?.type !== 'signalLight') return null
  const bounds = editorLodDetailCommittedFrame.value?.bounds
  const centerX = finiteNumber(node.x) + Math.max(.1, finiteNumber(node.w, 1)) / 2
  const centerY = finiteNumber(node.y) + Math.max(.1, finiteNumber(node.h, 1)) / 2
  const detailCoversNode = editorLodDetailVisible.value
    && bounds
    && centerX >= bounds.x
    && centerX <= bounds.x + bounds.w
    && centerY >= bounds.y
    && centerY <= bounds.y + bounds.h
  const preferred = detailCoversNode
    ? editorLodDetailAnimationTimestamp.value
    : editorLodFallbackAnimationTimestamp.value
  if (preferred != null && Number.isFinite(Number(preferred))) return Number(preferred)
  const fallback = editorLodFallbackAnimationTimestamp.value
  return fallback != null && Number.isFinite(Number(fallback)) ? Number(fallback) : null
}
function clippedPreviewDomQueryBounds(bufferPixels = PREVIEW_DOM_RETENTION_OVERSCAN) {
  const raw = viewportWorldBounds(previewViewport.value, 1, bufferPixels)
  const left = Math.max(0, Math.min(stageWidth.value, raw.x))
  const top = Math.max(0, Math.min(stageHeight.value, raw.y))
  const right = Math.max(left, Math.min(stageWidth.value, raw.x + raw.w))
  const bottom = Math.max(top, Math.min(stageHeight.value, raw.y + raw.h))
  return { x: left, y: top, w: Math.max(.1, right - left), h: Math.max(.1, bottom - top) }
}
function previewDomQueryBoundsNeedRefresh(bounds) {
  if (!bounds) return true
  const visible = clippedPreviewDomQueryBounds(0)
  const preferred = clippedPreviewDomQueryBounds(PREVIEW_DOM_RETENTION_OVERSCAN)
  const guard = PREVIEW_DOM_RETENTION_GUARD
  return (bounds.x > 0 && visible.x < bounds.x + guard)
    || (bounds.y > 0 && visible.y < bounds.y + guard)
    || (bounds.x + bounds.w < stageWidth.value && visible.x + visible.w > bounds.x + bounds.w - guard)
    || (bounds.y + bounds.h < stageHeight.value && visible.y + visible.h > bounds.y + bounds.h - guard)
    || bounds.w > preferred.w + guard
    || bounds.h > preferred.h + guard
}
function syncPreviewDomQueryBounds(force = false) {
  if (!showPreview.value || !previewDomMounted.value || previewDomFullDocumentRequested.value) return false
  if (!force && !previewDomQueryBoundsNeedRefresh(previewDomQueryBounds.value)) return false
  const next = clippedPreviewDomQueryBounds()
  if (previewCanvasBoundsMatch(next, previewDomQueryBounds.value)) return false
  previewDomQueryBounds.value = next
  return true
}
function resetPreviewDomQueryBounds() {
  previewDomQueryBounds.value = null
}
const previewNodeCandidates = computed(() => {
  if (!showPreview.value) return []
  void nodeSpatialRevision.value
  const bounds = previewDomQueryBounds.value || viewportWorldBounds(previewViewport.value, 1, LARGE_DOCUMENT_OVERSCAN)
  return nodeSpatialIndex.query(bounds, { sort: false })
})
const previewVisibleNodes = computed(() => previewNodeCandidates.value)
const previewDomFullDocumentRequested = computed(() => (
  previewRenderTarget.value === 'dom'
  && (
    previewSmallDocument.value
    || previewFitCanvasFailed.value
    || (
      previewFitLayoutRequested.value
      && (!previewFitCanUseCanvas.value || previewFitCanvasFailed.value)
    )
  )
))
const previewDomNodes = computed(() => {
  if (!showPreview.value || !previewDomMounted.value) return []
  // 原始尺寸预览由高清视口 Canvas 承担普通视觉；交互尾层由 live plane 保留真实 DOM。
  if (previewDomEdgeCanvasActive.value) return []
  const source = previewDomFullDocumentRequested.value ? nodes.value : previewVisibleNodes.value
  if (!previewDomUsesLivePlane.value) return source
  const excludedIds = new Set(previewFitExcludedNodeIds.value)
  return source.filter(node => !excludedIds.has(node.id))
})
function edgesForNodeIds(nodeIds, limit = Number.POSITIVE_INFINITY) {
  const result = []
  const seen = new Set()
  for (const nodeId of nodeIds) {
    for (const edge of edgeAdjacency.value.get(nodeId) || []) {
      if (!seen.has(edge.id)) { seen.add(edge.id); result.push(edge) }
      if (result.length >= limit) return result
    }
  }
  return result
}
function edgesInBounds(bounds, options = {}) {
  void edgeSpatialRevision.value
  return edgeSpatialIndex.query(bounds, { sort: false, ...options })
}
const visibleEdges = computed(() => {
  const overscan = nodes.value.length >= LARGE_DOCUMENT_NODE_COUNT ? LARGE_DOCUMENT_OVERSCAN : DEFAULT_VIEWPORT_OVERSCAN
  const bounds = transientCanvasRenderBounds.value || viewportWorldBounds(viewport.value, zoom.value, overscan)
  return edgesInBounds(bounds)
})
const previewEdgeCandidates = computed(() => {
  if (!showPreview.value) return []
  const bounds = previewDomQueryBounds.value || viewportWorldBounds(previewViewport.value, 1, LARGE_DOCUMENT_OVERSCAN)
  return edgesInBounds(bounds)
})
const previewDrawingCandidates = computed(() => {
  if (!showPreview.value) return []
  const bounds = previewDomQueryBounds.value || viewportWorldBounds(previewViewport.value, 1, LARGE_DOCUMENT_OVERSCAN)
  return drawingsInBounds(bounds)
})
// 复用原高密连线画布作为原始尺寸/全屏模式的完整高清视口画布。
const previewDomEdgeCanvasRequested = computed(() => (
  previewViewportCanvasPlanned.value
  && previewDomMounted.value
))
const previewDomEdgeCanvasActive = computed(() => previewDomEdgeCanvasRequested.value && !previewEdgeCanvasFailed.value)
// watch 注册时会立即读取 getter，必须等它引用的编辑器和预览状态全部初始化完毕。
watch(runtimeCanvasRenderingActive, active => {
  if (!active || !runtimeCanvasDirtyQueue.hasPending()) return
  markRuntimeCanvasDirty()
})
function previewEdgeCanvasOverscan() {
  const visible = viewportWorldBounds(previewViewport.value, 1, 0)
  return previewViewportOverscan({
    width: visible.w,
    height: visible.h,
    pixelRatio: previewEdgeCanvasPixelRatio.value,
    preferred: PREVIEW_EDGE_CANVAS_OVERSCAN
  })
}
function clippedPreviewEdgeCanvasBounds(bufferPixels = previewEdgeCanvasOverscan()) {
  const raw = viewportWorldBounds(previewViewport.value, 1, bufferPixels)
  const left = Math.max(0, Math.min(stageWidth.value, raw.x))
  const top = Math.max(0, Math.min(stageHeight.value, raw.y))
  const right = Math.max(left, Math.min(stageWidth.value, raw.x + raw.w))
  const bottom = Math.max(top, Math.min(stageHeight.value, raw.y + raw.h))
  return {
    x: left,
    y: top,
    w: Math.max(.1, right - left),
    h: Math.max(.1, bottom - top)
  }
}
function previewEdgeCanvasBoundsNeedRefresh(bounds) {
  if (!bounds) return true
  const visible = clippedPreviewEdgeCanvasBounds(0)
  const preferred = clippedPreviewEdgeCanvasBounds(previewEdgeCanvasOverscan())
  const guard = PREVIEW_EDGE_CANVAS_GUARD
  return (bounds.x > 0 && visible.x < bounds.x + guard)
    || (bounds.y > 0 && visible.y < bounds.y + guard)
    || (bounds.x + bounds.w < stageWidth.value && visible.x + visible.w > bounds.x + bounds.w - guard)
    || (bounds.y + bounds.h < stageHeight.value && visible.y + visible.h > bounds.y + bounds.h - guard)
    || bounds.w > preferred.w + guard
    || bounds.h > preferred.h + guard
}
function previewCanvasBoundsContain(outer, inner, tolerance = .5) {
  return Boolean(outer && inner)
    && inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.w <= outer.x + outer.w + tolerance
    && inner.y + inner.h <= outer.y + outer.h + tolerance
}
function resetPreviewEdgeCanvas({ clearFailure = false } = {}) {
  previewEdgeCanvas.value?.invalidatePendingRender?.('preview-edge-canvas-reset')
  previewEdgeCanvasBounds.value = null
  previewEdgeCanvasCommittedBounds.value = null
  previewEdgeCanvasCommittedPixelRatio.value = 0
  previewEdgeCanvasCommittedPlanKey.value = ''
  previewEdgeCanvasReady.value = false
  if (clearFailure) previewEdgeCanvasFailed.value = false
}
function syncPreviewEdgeCanvasBounds(force = false) {
  if (!previewDomEdgeCanvasActive.value) return false
  if (!force && !previewEdgeCanvasBoundsNeedRefresh(previewEdgeCanvasBounds.value)) return false
  const nextBounds = clippedPreviewEdgeCanvasBounds()
  if (
    !previewCanvasBoundsMatch(nextBounds, previewEdgeCanvasBounds.value)
    && !previewCanvasBoundsContain(previewEdgeCanvasCommittedBounds.value, clippedPreviewEdgeCanvasBounds(0))
  ) previewEdgeCanvasReady.value = false
  previewEdgeCanvasBounds.value = nextBounds
  return true
}
const previewEdgeCanvasPixelRatio = computed(() => previewViewportPixelRatio(previewDevicePixelRatio.value))
const previewEdgeCanvasBitmapBudget = computed(() => {
  const bounds = previewEdgeCanvasBounds.value
  return previewBitmapPixelBudget({
    fitActive: true,
    stageWidth: bounds?.w,
    stageHeight: bounds?.h,
    scale: 1,
    devicePixelRatio: previewDevicePixelRatio.value,
    preservePixelRatio: true
  })
})
const previewEdgeCanvasPlanKey = computed(() => {
  const bounds = previewEdgeCanvasBounds.value
  if (!bounds) return ''
  return `preview-viewport:${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}:${projectRevision.value}:${nodeSpatialRevision.value}:${edgeSpatialRevision.value}:${drawingSpatialRevision.value}:${previewFitPlan.value.key}:${previewEdgeCanvasPixelRatio.value}`
})
const previewEdgeCanvasNodes = computed(() => {
  const bounds = previewEdgeCanvasBounds.value
  if (!previewDomEdgeCanvasActive.value || !bounds) return []
  void nodeSpatialRevision.value
  return nodeSpatialIndex.query(bounds, { sort: false })
})
const previewEdgeCanvasEdges = computed(() => {
  const bounds = previewEdgeCanvasBounds.value
  return previewDomEdgeCanvasActive.value && bounds ? edgesInBounds(bounds) : []
})
const previewEdgeCanvasDrawings = computed(() => {
  const bounds = previewEdgeCanvasBounds.value
  return previewDomEdgeCanvasActive.value && bounds ? drawingsInBounds(bounds) : []
})
const previewEdgeCanvasEntities = computed(() => {
  const nodeIds = new Set(previewEdgeCanvasNodes.value.map(node => node.id))
  const drawingIds = new Set(previewEdgeCanvasDrawings.value.map(drawing => drawing.id))
  return layerEntries.value.filter(entry => (
    entry.kind === 'node' ? nodeIds.has(entry.id) : drawingIds.has(entry.id)
  ))
})
const previewEdgeCanvasFrameStyle = computed(() => {
  const bounds = previewEdgeCanvasCommittedBounds.value || previewEdgeCanvasBounds.value
  if (!bounds) return {}
  return {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`
  }
})
const previewEdgeCanvasVisible = computed(() => (
  previewDomEdgeCanvasActive.value
  && previewEdgeCanvasReady.value
  && Boolean(previewEdgeCanvasCommittedBounds.value)
  && previewEdgeCanvasCommittedPlanKey.value === previewEdgeCanvasPlanKey.value
  && previewBitmapIsSharp(previewEdgeCanvasCommittedPixelRatio.value, previewEdgeCanvasPixelRatio.value)
  && previewCanvasBoundsContain(previewEdgeCanvasCommittedBounds.value, clippedPreviewEdgeCanvasBounds(0))
))
const previewVisibleEdges = computed(() => previewEdgeCandidates.value)
const previewDomEdges = computed(() => {
  if (!previewDomMounted.value) return []
  if (previewDomEdgeCanvasActive.value) return []
  return previewDomFullDocumentRequested.value ? edges.value : previewVisibleEdges.value
})
const editorLodEdgeEntries = computed(() => {
  if (!editorLodActive.value || editorRenderPaused.value) return []
  const nodeIds = new Set(editorLodOverlayIds.value)
  if (editorLodCanvasRendersEntities.value && !editorLodCanvasReady.value) {
    for (const id of editorLodBootstrapNodeIds.value) nodeIds.add(id)
    for (const id of editorProgressiveDomNodeIds.value) nodeIds.add(id)
  }
  const overlayEdges = editorLodOverlayEdges({
    nodeIds,
    adjacency: edgeAdjacency.value,
    latestEdge: edges.value.at(-1),
    limit: EDITOR_LOD_INTERACTION_EDGE_LIMIT
  })
  return overlayEdges.map(edge => ({ edge, ...edgeEndpoints(edge) }))
})
const renderedEdgeEntries = computed(() => editorLodActive.value ? editorLodEdgeEntries.value : visibleEdgeEntries.value)

function clearEditorLodRecoveryTimer() {
  if (editorLodRecoveryTimer) clearTimeout(editorLodRecoveryTimer)
  editorLodRecoveryTimer = 0
}

function clearEditorLodRecoveryTarget(layer) {
  if (layer === 'fallback') {
    editorLodFallbackRecoveryTargetGeneration = null
    editorLodFallbackRecoveryTarget = null
  } else {
    editorLodDetailRecoveryTargetGeneration = null
    editorLodDetailRecoveryTarget = null
  }
}

function resetEditorLodRecovery() {
  clearEditorLodRecoveryTimer()
  editorLodFallbackRecoveryPending = false
  editorLodDetailRecoveryPending = false
  clearEditorLodRecoveryTarget('fallback')
  clearEditorLodRecoveryTarget('detail')
}

function scheduleEditorLodRecovery(delay = 0) {
  if (
    editorLodRecoveryTimer
    || (!editorLodFallbackRecoveryPending && !editorLodDetailRecoveryPending)
  ) return
  editorLodRecoveryTimer = setTimeout(runEditorLodRecovery, Math.max(0, delay))
}

function queueEditorLodRecovery({ fallback = false, detail = false } = {}) {
  if (fallback) {
    editorLodFallbackRecoveryPending = true
    clearEditorLodRecoveryTarget('fallback')
  }
  if (detail) {
    editorLodDetailRecoveryPending = true
    clearEditorLodRecoveryTarget('detail')
  }
  scheduleEditorLodRecovery()
}

function requestEditorLodRecoveryLayer(layer, target) {
  const fallback = layer === 'fallback'
  if (!target) {
    clearEditorLodRecoveryTarget(layer)
    return false
  }
  const targetGeneration = fallback
    ? editorLodFallbackRecoveryTargetGeneration
    : editorLodDetailRecoveryTargetGeneration
  const recoveryTarget = fallback
    ? editorLodFallbackRecoveryTarget
    : editorLodDetailRecoveryTarget
  const renderState = target.renderState
  if (targetGeneration != null && recoveryTarget === target) {
    const pendingGeneration = parseRenderGeneration(renderState?.generation)
    if (renderState?.pending && pendingGeneration != null && pendingGeneration >= targetGeneration) return true
    clearEditorLodRecoveryTarget(layer)
  }
  if (recoveryTarget !== target) {
    clearEditorLodRecoveryTarget(layer)
  }
  if (fallback) primeEditorLodBootstrap()
  const generation = parseRenderGeneration(
    renderState?.pending ? renderState.generation : target.requestCoalescedRender?.(),
  )
  if (generation == null) return false
  if (fallback) {
    editorLodFallbackRecoveryTargetGeneration = generation
    editorLodFallbackRecoveryTarget = target
  } else {
    editorLodDetailRecoveryTargetGeneration = generation
    editorLodDetailRecoveryTarget = target
  }
  return true
}

function runEditorLodRecovery() {
  editorLodRecoveryTimer = 0
  if (!editorLodFallbackRecoveryPending && !editorLodDetailRecoveryPending) return
  if (!editorLodActive.value) {
    resetEditorLodRecovery()
    return
  }
  if (editorRenderPaused.value || editorLodGeometrySession.value) {
    scheduleEditorLodRecovery(EDITOR_LOD_RECOVERY_RETRY_MS)
    return
  }
  if (editorLodFallbackRecoveryPending) {
    requestEditorLodRecoveryLayer('fallback', editorLodCanvas.value)
  }
  if (editorLodDetailRecoveryPending) {
    syncEditorLodDetailBounds()
    requestEditorLodRecoveryLayer('detail', editorLodDetailCanvas.value)
  }
  scheduleEditorLodRecovery(EDITOR_LOD_RECOVERY_RETRY_MS)
}

function acknowledgeEditorLodRecovery(layer, event) {
  if (event?.kind !== 'full' || event.pendingFull || editorLodGeometrySession.value) return false
  const fallback = layer === 'fallback'
  const pending = fallback ? editorLodFallbackRecoveryPending : editorLodDetailRecoveryPending
  if (!pending) return false
  const targetGeneration = fallback
    ? editorLodFallbackRecoveryTargetGeneration
    : editorLodDetailRecoveryTargetGeneration
  const recoveryTarget = fallback
    ? editorLodFallbackRecoveryTarget
    : editorLodDetailRecoveryTarget
  const currentTarget = fallback ? editorLodCanvas.value : editorLodDetailCanvas.value
  const renderGeneration = parseRenderGeneration(event.renderGeneration)
  if (
    recoveryTarget !== currentTarget
    || targetGeneration == null
    || renderGeneration == null
    || renderGeneration < targetGeneration
  ) return false
  if (fallback) {
    editorLodFallbackRecoveryPending = false
    editorLodFallbackRecoveryTargetGeneration = null
    editorLodFallbackRecoveryTarget = null
  } else {
    editorLodDetailRecoveryPending = false
    editorLodDetailRecoveryTargetGeneration = null
    editorLodDetailRecoveryTarget = null
  }
  if (!editorLodFallbackRecoveryPending && !editorLodDetailRecoveryPending) clearEditorLodRecoveryTimer()
  return true
}

function clearEditorLodGeometryVisualState(sessionId = null) {
  if (sessionId != null && editorLodGeometrySession.value?.sessionId !== sessionId) return
  editorLodGeometrySession.value = null
  editorLodGeometryHiddenNodeIds.value = new Set()
  editorLodGeometryHiddenEdgeIds.value = new Set()
  editorLodGeometryHiddenDrawingIds.value = new Set()
}

function settleEditorLodGeometrySession(sessionId, session) {
  const recoverFallback = session?.fallbackRecoveryPending === true
  const recoverDetail = session?.detailRecoveryPending === true
  if (session?.detailFailed) {
    editorLodDetailFresh.value = false
    editorLodDetailReady.value = false
    editorLodDetailCommittedFrame.value = null
    editorLodDetailAnimationTimestamp.value = null
  }
  editorLodRemovalCoverRegions.value = []
  editorLodRemovalFallbackReady.value = false
  clearEditorLodGeometryVisualState(sessionId)
  if (recoverFallback) primeEditorLodBootstrap()
  queueEditorLodRecovery({ fallback: recoverFallback, detail: recoverDetail })
}

function completeEditorLodGeometryLayer(sessionId, layer, { failed = false } = {}) {
  const current = editorLodGeometrySession.value
  if (!current || current.sessionId !== sessionId) return false
  const completion = failed
    ? markEditorLodGeometryLayerFailed(current, layer)
    : markEditorLodGeometryLayerComplete(current, layer)
  if (failed) queueEditorLodRecovery({ fallback: layer === 'fallback', detail: layer === 'detail' })
  if (completion.settled) {
    settleEditorLodGeometrySession(sessionId, completion.session)
    return true
  }
  editorLodGeometrySession.value = completion.session
  return false
}

function syncEditorLodAnimationTimestamp(target, event) {
  const timestamp = Number(event?.animationTimestamp)
  if (Number.isFinite(timestamp)) target.value = timestamp
}

function handleEditorLodRenderComplete(event) {
  syncEditorLodAnimationTimestamp(editorLodFallbackAnimationTimestamp, event)
  if (event?.kind !== 'full' || event.renderPlanKey !== editorLodFallbackPlanKey.value) return
  editorLodCanvasReady.value = true
  if (event?.pendingFull !== true && editorLodPendingInsertionNodeIds.value.length) {
    editorLodPendingInsertionNodeIds.value = []
  }
  if (!event.pendingFull && editorLodRemovalCoverRegions.value.length) {
    editorLodRemovalFallbackReady.value = true
  }
  acknowledgeEditorLodRecovery('fallback', event)
}

function handleEditorLodRenderError() {
  editorLodCanvasReady.value = false
  editorLodRemovalFallbackReady.value = false
  const sessionId = editorLodGeometrySession.value?.sessionId
  editorLodCanvas.value?.cancelGeometryInteraction?.(sessionId)
  if (sessionId != null) {
    completeEditorLodGeometryLayer(sessionId, 'fallback', { failed: true })
    syncEditorLodGeometryHiddenState(currentEditorLodGeometrySession(sessionId))
  } else {
    syncEditorLodGeometryHiddenState(null)
    primeEditorLodBootstrap()
    queueEditorLodRecovery({ fallback: true })
  }
}

function patchRemovedEditorLodEntities(payload) {
  invalidateEditorLodDetail('entity-removal')
  const hadRemovalCover = editorLodRemovalCoverRegions.value.length > 0
  const fallbackPatched = Boolean(editorLodCanvas.value?.patchRemovedEntities?.(payload))
  const detailPatched = Boolean(
    editorLodDetailReady.value
    && editorLodDetailCanvas.value?.patchRemovedEntities?.(payload)
  )
  if (editorLodDetailReady.value && !detailPatched) {
    editorLodRemovalFallbackReady.value = hadRemovalCover
      ? editorLodRemovalFallbackReady.value && fallbackPatched
      : fallbackPatched
    editorLodRemovalCoverRegions.value = createEditorLodRemovalCoverRegions(editorLodRemovalCoverRegions.value, payload)
  } else if (hadRemovalCover) {
    editorLodRemovalFallbackReady.value = editorLodRemovalFallbackReady.value && fallbackPatched
  }
  return fallbackPatched || detailPatched
}

function handleEditorLodDetailRenderComplete(event) {
  syncEditorLodAnimationTimestamp(editorLodDetailAnimationTimestamp, event)
  if (event?.kind !== 'full' || event.pendingFull || event.renderPlanKey !== editorLodDetailPlanKey.value) return
  const session = editorLodGeometrySession.value
  if (session?.detailFailed) return
  const completesGeometry = !session || editorLodDetailRenderCompletesSession(session, event)
  if (!completesGeometry) return
  const bounds = event.viewBox || editorLodDetailBounds.value
  if (!bounds) return
  const renderZoom = finiteNumber(event.width, bounds.w * zoom.value) / Math.max(.0001, bounds.w)
  editorLodDetailCommittedFrame.value = {
    bounds: { ...bounds },
    zoom: renderZoom,
    width: finiteNumber(event.width, bounds.w * renderZoom),
    height: finiteNumber(event.height, bounds.h * renderZoom),
    pixelRatioX: finiteNumber(event.pixelRatioX, 1),
    pixelRatioY: finiteNumber(event.pixelRatioY, 1),
    bitmapWidth: finiteNumber(event.bitmapWidth, 1),
    bitmapHeight: finiteNumber(event.bitmapHeight, 1),
    renderPlanKey: event.renderPlanKey
  }
  editorLodDetailReady.value = true
  editorLodDetailFresh.value = true
  editorLodRemovalCoverRegions.value = []
  editorLodRemovalFallbackReady.value = false
  acknowledgeEditorLodRecovery('detail', event)
  if (session && !session.detailSessionId) completeEditorLodGeometryLayer(session.sessionId, 'detail')
}

function handleEditorLodDetailRenderError() {
  editorLodDetailFresh.value = false
  const session = editorLodGeometrySession.value
  if (!session) {
    editorLodDetailReady.value = false
    editorLodDetailCommittedFrame.value = null
    editorLodDetailAnimationTimestamp.value = null
    editorLodRemovalCoverRegions.value = []
    editorLodRemovalFallbackReady.value = false
    queueEditorLodRecovery({ detail: true })
    return
  }
  if (session.detailSessionId) editorLodDetailCanvas.value?.cancelGeometryInteraction?.(session.detailSessionId)
  if (operation.value?.editorLodDetailGeometrySessionId === session.detailSessionId) {
    operation.value.editorLodDetailGeometrySessionId = null
    operation.value.editorLodDetailPatchActive = false
  }
  const detailCoverBounds = session.detailCoverBounds
    || editorLodDetailCommittedFrame.value?.bounds
    || editorLodDetailBounds.value
    || session.detailSourceBounds
  editorLodGeometrySession.value = {
    ...session,
    detailSessionId: null,
    detailPatchActive: false,
    detailCommitted: false,
    detailCoverBounds,
    detailCoverFrozen: true
  }
  completeEditorLodGeometryLayer(session.sessionId, 'detail', { failed: true })
  syncEditorLodGeometryHiddenState(currentEditorLodGeometrySession(session.sessionId))
}

function handleEditorLodDetailGeometryComplete(event) {
  const session = editorLodGeometrySession.value
  if (session?.detailFailed) return
  if (!editorLodDetailGeometryCompletesSession(session, event)) return
  if (event?.renderPlanKey !== editorLodDetailPlanKey.value) {
    handleEditorLodDetailRenderError()
    return
  }
  completeEditorLodGeometryLayer(session.sessionId, 'detail')
}

function handleEditorLodGeometryComplete(event) {
  const session = editorLodGeometrySession.value
  if (!editorLodFallbackGeometryCompletesSession(session, event)) return
  completeEditorLodGeometryLayer(session.sessionId, 'fallback')
}
const toolHint = computed(() => ({
  select: '拖动空白区域框选，Ctrl 或 Shift 多点选，Alt 或中键拖动画布，滚轮缩放',
  pencil: '按住并拖动绘制自由曲线',
  polyline: '单击确定终点并生成等分线段，Esc 取消',
  flowDirection: '单击确定终点并生成流向路径，Esc 取消',
  map: '鹰眼地图已开启', line: '依次点击两个组件创建连线'
}[activeTool.value]))

function backendRequestContext() {
  return {
    workspaceId: workspaceId.value,
    projectId: projectId.value,
    revision: projectRevision.value
  }
}

function historyEntryBytes(entry, preparedBytes = null) {
  if (!entry || typeof entry !== 'object') return 0
  const key = toRaw(entry)
  if (Number.isFinite(preparedBytes)) {
    const bytes = Math.max(0, Number(preparedBytes))
    historyEntryByteCache.set(key, bytes)
    return bytes
  }
  if (historyEntryByteCache.has(key)) return historyEntryByteCache.get(key)
  const bytes = historyValueBytes(key)
  historyEntryByteCache.set(key, bytes)
  return bytes
}
function appendHistory(entry, clearFuture = true, preparedBytes = null) {
  if (!entry) return
  history.value.push(entry)
  historyBytes += historyEntryBytes(entry, preparedBytes)
  const historyLimit = nodes.value.length > 1000 ? 20 : 80
  const byteLimit = 12 * 1024 * 1024
  while (history.value.length > 1 && (history.value.length > historyLimit || historyBytes > byteLimit)) {
    historyBytes -= historyEntryBytes(history.value.shift())
  }
  if (clearFuture) future.value = []
}
function recordHistory(entry, preparedBytes = null) {
  // 本地适配器不记录事件；未来启用操作审计时复用此统一历史检查点。
  operationGateway.record('document.change', backendRequestContext)
  documentChangeVersion += 1
  appendHistory(entry, true, preparedBytes)
  markMiniMapDirty()
  scheduleWorkspaceSessionPersistence()
}
function geometryHistoryForNodes(items) {
  return items.map(item => ({
    id: item.id,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotate: item.rotate || 0,
    visualScaleX: item.visualScaleX,
    visualScaleY: item.visualScaleY
  }))
}
function captureGeometryHistory(entry) {
  return {
    kind: 'geometry',
    nodes: geometryHistoryForNodes((entry.nodes || []).map(item => nodeIndex.value.get(item.id)).filter(Boolean)),
    drawings: (entry.drawings || []).flatMap(item => {
      const drawing = drawingIndex.value.get(item.id)
      return drawing ? [{ id: drawing.id, points: drawing.points.map(point => ({ ...point })) }] : []
    })
  }
}

function entityCollections() {
  return { nodes: nodes.value, edges: edges.value, drawings: drawings.value }
}

/** 新增只记录本批实体原本不存在，不再为整张图纸创建历史快照。 */
function recordEntityInsertion({ nodes: insertedNodes = [], edges: insertedEdges = [], drawings: insertedDrawings = [] }) {
  const entry = createEntityInsertionEntry(
    { nodes: insertedNodes, edges: insertedEdges, drawings: insertedDrawings },
    { nodes: nodes.value.length, edges: edges.value.length, drawings: drawings.value.length }
  )
  recordHistory(entry)
}

function captureEntityHistory(entry) {
  return captureEntityEntry(entry, entityCollections(), { reuseEntityReferences: true })
}

function entityReferenceHistoryBytes(entry) {
  return 128
    + (entry.nodes?.length || 0) * 128
    + (entry.edges?.length || 0) * 96
    + (entry.drawings?.length || 0) * 128
}

function fieldsHistoryEntry(nodeTargets = [], drawingTargets = [], fields = null) {
  const capture = target => captureFieldRecord(target, fields || Object.keys(target || {}))
  return {
    kind: 'fields',
    nodes: nodeTargets.map(capture).filter(Boolean),
    drawings: drawingTargets.map(capture).filter(Boolean)
  }
}

function fieldHistoryTarget(collection, id) {
  if (collection === 'nodes') return nodeIndex.value.get(id) || null
  return drawingIndex.value.get(id) || null
}

function captureFieldsHistory(entry) {
  const inverse = { kind: 'fields', nodes: [], drawings: [] }
  for (const collection of ['nodes', 'drawings']) {
    inverse[collection] = (entry[collection] || []).flatMap(record => {
      const captured = captureInverseFieldRecord(fieldHistoryTarget(collection, record.id), record)
      return captured ? [captured] : []
    })
  }
  return inverse
}

function indexedRuntimeKeysForNode(nodeId) {
  const keys = new Set(runtimeBindingPointIndex.pointIdsFor(nodeId))
  const legacyKey = runtimeDataKeyIndex.keyFor(nodeId)
  if (legacyKey) keys.add(legacyKey)
  return keys
}

function synchronizeRuntimeKeysAfterHistory(node, previousKeys) {
  const nextLegacyKey = String(node?.dataKey ?? '').trim()
  runtimeDataKeyIndex.update(node.id, nextLegacyKey)
  runtimeBindingPointIndex.update(node)
  sourceBindingRuntime.updateNode(node)
  const nextKeys = indexedRuntimeKeysForNode(node.id)
  synchronizeRuntimeKeyReferences(previousKeys, nextKeys)
}

function applyFieldsHistory(entry) {
  const changedNodes = []
  const changedDrawings = []
  let layerChanged = false
  for (const record of entry.nodes || []) {
    const node = nodeIndex.value.get(record.id)
    if (!node) continue
    const previousRuntimeKeys = indexedRuntimeKeysForNode(node.id)
    const previousType = node.type
    const changedFields = applyFieldRecord(node, record)
    if (!changedFields.length) continue
    synchronizeRuntimeKeysAfterHistory(node, previousRuntimeKeys)
    if (changedFields.includes('type') && previousType !== node.type) {
      removeTimeNodes([{ id: node.id, type: previousType }])
      addTimeNodes([node])
    }
    if (changedFields.includes('layer')) layerChanged = true
    if (changedFields.includes('locked') && node.locked) closeNodeEditors(new Set([node.id]))
    changedNodes.push(node)
  }
  for (const record of entry.drawings || []) {
    const drawing = fieldHistoryTarget('drawings', record.id)
    if (!drawing) continue
    const changedFields = applyFieldRecord(drawing, record)
    if (changedFields.includes('layer')) layerChanged = true
    if (changedFields.length) changedDrawings.push(drawing)
  }
  if (changedNodes.length) {
    updateNodeSpatialIndex(changedNodes)
    markPreviewCanvasDocumentDirty()
  }
  if (changedDrawings.length) updateDrawingIndex(changedDrawings)
  if (layerChanged) rebuildLayerEntries()
  documentChangeVersion += 1
  markMiniMapDirty()
}

let activeFieldEdit = null
function finishActiveFieldEdit() {
  const edit = activeFieldEdit
  activeFieldEdit = null
  if (!edit) return false
  const target = fieldHistoryTarget(edit.collection, edit.record.id)
  if (!fieldRecordChanged(target, edit.record)) return false
  if (edit.collection === 'drawings') updateDrawingIndex(target)
  const entry = { kind: 'fields', nodes: [], drawings: [] }
  entry[edit.collection].push(edit.record)
  recordHistory(entry)
  return true
}
function flushPendingDocumentEdits() {
  flushDocumentInputRender()
  finishActiveFieldEdit()
  flushPendingVideoUrlEdit()
}
function beginFieldEdit(collection, target) {
  if (!target?.id) return
  if (activeFieldEdit?.collection === collection && activeFieldEdit.record.id === target.id) return
  finishActiveFieldEdit()
  activeFieldEdit = { collection, record: captureFieldRecord(target) }
}
function beginSelectedFieldEdit() {
  if (selected.value) beginFieldEdit('nodes', selected.value)
  else if (selectedDrawing.value) beginFieldEdit('drawings', selectedDrawing.value)
}
function beginTableFieldEdit() {
  if (activeTableDataNode.value) beginFieldEdit('nodes', activeTableDataNode.value)
}
function recordFieldsHistory(nodeTargets = [], drawingTargets = [], fields = null) {
  finishActiveFieldEdit()
  const entry = fieldsHistoryEntry(nodeTargets, drawingTargets, fields)
  if (entry.nodes.length || entry.drawings.length) recordHistory(entry)
}
function recordNodeFields(targets, fields = null) {
  recordFieldsHistory(Array.isArray(targets) ? targets : [targets], [], fields)
}

function captureLayerHistory() {
  return { kind: 'layers', order: layerEntries.value.map(layerEntryKey) }
}
function applyLayerHistory(entry) {
  const currentEntries = layerEntries.value
  const byKey = new Map(currentEntries.map(item => [layerEntryKey(item), item]))
  const ordered = []
  const included = new Set()
  for (const key of entry.order || []) {
    const item = byKey.get(key)
    if (!item) continue
    ordered.push(item)
    included.add(key)
  }
  for (const item of currentEntries) {
    const key = layerEntryKey(item)
    if (!included.has(key)) ordered.push(item)
  }
  synchronizeLayerOrder(ordered)
  documentChangeVersion += 1
}
function recordLayerHistory() {
  finishActiveFieldEdit()
  recordHistory(captureLayerHistory())
}

function captureCustomComponentsHistory(entry) {
  return { kind: 'customComponents', items: captureInverseListRecords(entry.items, customComponents.value) }
}
function applyCustomComponentsHistory(entry) {
  applyListRecords(entry.items, customComponents.value)
  documentChangeVersion += 1
  markMiniMapDirty()
}
function recordCustomComponentInsertion(items) {
  finishActiveFieldEdit()
  recordHistory({ kind: 'customComponents', items: createListInsertionRecords(items, customComponents.value.length) })
}
function recordCustomComponentRemoval(items) {
  finishActiveFieldEdit()
  recordHistory({ kind: 'customComponents', items: createListRemovalRecords(items, customComponents.value) })
}

/** 删除前捕获少量目标实体，用同一种历史结构支持撤销恢复。 */
function recordEntityRemoval({ nodes: removedNodes = [], edges: removedEdges = [], drawings: removedDrawings = [] }) {
  const identifiers = {
    kind: 'entities',
    nodes: removedNodes.map(item => ({ id: item.id, index: 0, value: null })),
    edges: removedEdges.map(item => ({ id: item.id, index: 0, value: null })),
    drawings: removedDrawings.map(item => ({ id: item.id, index: 0, value: null }))
  }
  const entry = captureEntityHistory(identifiers)
  recordHistory(entry, entityReferenceHistoryBytes(entry))
}

function clearRemovedEntityState(removedNodeIds, removedDrawingIds) {
  if (removedNodeIds.size) {
    selectedNodeIds.value = selectedNodeIds.value.filter(id => !removedNodeIds.has(id))
    if (removedNodeIds.has(selectedId.value)) selectedId.value = selectedNodeIds.value.at(-1) || null
    if (removedNodeIds.has(editingText.value?.id)) editingText.value = null
    if (removedNodeIds.has(editingFormId.value)) editingFormId.value = null
    if (removedNodeIds.has(tableDataEditor.value.nodeId)) closeTableDataEditor()
    if (removedNodeIds.has(tableCellViewer.value.nodeId)) closeTableCellViewer()
    if (removedNodeIds.has(buttonMessageDialog.value.nodeId)) buttonMessageDialog.value.show = false
    if (removedNodeIds.has(connectFrom.value)) setConnectionAnchor(null)
    if (removedNodeIds.has(pendingVideoUrlEdit?.nodeId)) pendingVideoUrlEdit = null
  }
  if (removedDrawingIds.has(selectedDrawingId.value)) selectedDrawingId.value = null
}

function applyEntityHistory(entry) {
  const changes = applyEntityEntry(entry, entityCollections(), {
    nodes: value => normalizeNode(value),
    edges: value => normalizeEdge(value, currentLineDefaults()),
    drawings: value => normalizeDrawing(value)
  }, { reuseEntityReferences: true, mutateRawCollections: true })
  const removedNodes = changes.nodes.removed.map(item => item.value).filter(Boolean)
  const removedEdges = changes.edges.removed.map(item => item.value).filter(Boolean)
  const removedDrawings = changes.drawings.removed.map(item => item.value).filter(Boolean)
  applyNodeSpatialChanges(changes.nodes.removed, changes.nodes.inserted)
  removeTimeNodes(changes.nodes.removed)
  addTimeNodes(changes.nodes.inserted.map(item => item.value))
  removeRuntimeDataNodes(changes.nodes.removed)
  addRuntimeDataNodes(changes.nodes.inserted.map(item => item.value))
  updateEdgeAdjacency(changes.edges.removed, changes.edges.inserted)
  removeDrawingIndex(changes.drawings.removed)
  updateDrawingIndex(changes.drawings.inserted.map(item => item.value))
  removeLayerEntries('node', changes.nodes.removed)
  appendLayerEntries('node', changes.nodes.inserted.map(item => item.value))
  removeLayerEntries('drawing', changes.drawings.removed)
  appendLayerEntries('drawing', changes.drawings.inserted.map(item => item.value))
  entityLayerAllocator.commit([
    ...changes.nodes.inserted.map(item => item.value),
    ...changes.drawings.inserted.map(item => item.value)
  ])
  if (
    editorLodActive.value
    && !editorRenderPaused.value
    && (removedNodes.length || removedEdges.length || removedDrawings.length)
  ) {
    patchRemovedEditorLodEntities({
      nodes: removedNodes,
      edges: removedEdges,
      drawings: removedDrawings,
      geometryRevision: ++editorLodGeometryRevision
    })
  }
  clearRemovedEntityState(
    new Set(changes.nodes.removed.map(item => item.id)),
    new Set(changes.drawings.removed.map(item => item.id))
  )
  if (changes.nodes.removed.length || changes.nodes.inserted.length) triggerRef(nodes)
  if (changes.edges.removed.length || changes.edges.inserted.length) triggerRef(edges)
  if (changes.drawings.removed.length || changes.drawings.inserted.length) triggerRef(drawings)
  documentChangeVersion += 1
  markMiniMapDirty()
}

function applyGeometryHistory(entry) {
  const changedNodes = []
  const changedDrawings = []
  for (const item of entry.nodes || []) {
    const node = nodeIndex.value.get(item.id)
    if (!node) continue
    Object.assign(node, {
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      rotate: item.rotate,
      visualScaleX: item.visualScaleX,
      visualScaleY: item.visualScaleY
    })
    changedNodes.push(node)
  }
  for (const item of entry.drawings || []) {
    const drawing = drawingIndex.value.get(item.id)
    if (drawing) {
      drawing.points = item.points.map(point => ({ ...point }))
      changedDrawings.push(drawing)
    }
  }
  updateNodeSpatialIndex(changedNodes)
  updateDrawingIndex(changedDrawings)
  documentChangeVersion += 1
  markMiniMapDirty()
}
function captureHistoryEntry(entry) {
  if (entry.kind === 'entities') return captureEntityHistory(entry)
  if (entry.kind === 'geometry') return captureGeometryHistory(entry)
  if (entry.kind === 'fields') return captureFieldsHistory(entry)
  if (entry.kind === 'layers') return captureLayerHistory()
  if (entry.kind === 'customComponents') return captureCustomComponentsHistory(entry)
  return null
}
function applyHistoryEntry(entry) {
  if (entry.kind === 'entities') applyEntityHistory(entry)
  else if (entry.kind === 'geometry') applyGeometryHistory(entry)
  else if (entry.kind === 'fields') applyFieldsHistory(entry)
  else if (entry.kind === 'layers') applyLayerHistory(entry)
  else if (entry.kind === 'customComponents') applyCustomComponentsHistory(entry)
}
function undo() {
  finishActiveFieldEdit()
  if (operation.value) pointerUp()
  if (!history.value.length) return
  const entry = history.value.pop()
  historyBytes = Math.max(0, historyBytes - historyEntryBytes(entry))
  const inverse = captureHistoryEntry(entry)
  if (inverse) future.value.push(inverse)
  applyHistoryEntry(entry)
  scheduleWorkspaceSessionPersistence()
}
function redo() {
  finishActiveFieldEdit()
  if (operation.value) pointerUp()
  if (!future.value.length) return
  const entry = future.value.pop()
  appendHistory(captureHistoryEntry(entry), false)
  applyHistoryEntry(entry)
  scheduleWorkspaceSessionPersistence()
}
let toastTimer
function notify(message) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 1800) }
function toggleGroup(name) { const group = groups.value.find(g => g.name === name); if (group) group.open = !group.open }
function groupIsOpen(name) { return !!groups.value.find(g => g.name === name)?.open || !!search.value }
function toggleAllGroups() {
  const shouldOpen = !allGroupsOpen.value
  if (!shouldOpen) search.value = ''
  groups.value.forEach(group => { group.open = shouldOpen })
}
function currentLineDefaults() {
  return {
    color: lineColor.value,
    width: lineWidth.value,
    dash: lineDash.value,
    startMarker: lineStartMarker.value,
    endMarker: lineEndMarker.value,
    anchorMode: lineAnchorMode.value
  }
}
function applyLineSettingsToEdges() {
  const defaults = currentLineDefaults()
  edges.value.forEach(edge => Object.assign(edge, defaults))
  updateEdgeSpatialIndex(edges.value)
}
function edgeEndpoints(edge) {
  return edgeEndpointsForNodes(edge, nodeIndex.value) || { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
}
function edgeMarkerUrl(marker, scope) {
  return marker && marker !== 'none' ? `url(#${scope}-${marker})` : undefined
}
const visibleEdgeEntries = computed(() => visibleEdges.value.map(edge => ({ edge, ...edgeEndpoints(edge) })))
function pointFromEvent(e, constrainToStage = true) {
  const rect = canvas.value.getBoundingClientRect()
  const viewportLeft = rect.left + canvas.value.clientLeft
  const viewportTop = rect.top + canvas.value.clientTop
  const renderZoom = projectedCanvasZoom?.canvas === canvas.value ? projectedCanvasZoom.zoom : zoom.value
  const x = (finiteNumber(e?.clientX, viewportLeft) - viewportLeft + canvas.value.scrollLeft) / renderZoom
  const y = (finiteNumber(e?.clientY, viewportTop) - viewportTop + canvas.value.scrollTop) / renderZoom
  return constrainToStage
    ? { x: clampNumber(x, 0, stageWidth.value), y: clampNumber(y, 0, stageHeight.value) }
    : { x, y }
}
function editorLodEntityFromEvent(e) {
  if (!editorLodActive.value) return null
  const point = pointFromEvent(e)
  const padding = Math.max(2, 4 / Math.max(.0001, zoom.value))
  const hitBounds = {
    x: point.x - padding,
    y: point.y - padding,
    w: padding * 2,
    h: padding * 2
  }
  const nodeCandidates = queryNodesInBounds(hitBounds)
  const drawingCandidates = drawingsInBounds(hitBounds)
  return pickTopEditorEntity(nodeCandidates, drawingCandidates, point, padding)
}
function polylinePointFromEvent(e, constrainToStage = true) {
  const point = pointFromEvent(e, constrainToStage)
  if (!snap.value || e?.altKey) return point
  const x = Math.round(point.x / gridSize.value) * gridSize.value
  const y = Math.round(point.y / gridSize.value) * gridSize.value
  return constrainToStage
    ? { x: clampNumber(x, 0, stageWidth.value), y: clampNumber(y, 0, stageHeight.value) }
    : { x, y }
}
const polylineDraftRenderPoints = computed(() => {
  const draft = polylineDraft.value
  if (!draft?.points?.length) return []
  const hover = draft.hover
  const start = draft.points[0]
  if (hover && Math.hypot(hover.x - start.x, hover.y - start.y) > .1 / zoom.value) return [draft.points[0], hover]
  return [start]
})
const polylineDraftPointString = computed(() => polylineDraftRenderPoints.value.map(point => `${point.x},${point.y}`).join(' '))
function movePolylineStartPoint(e) {
  if (workspaceSwitchPending.value) { endPolylineStartPointDrag(); return }
  if (!polylineStartPointDrag || e.pointerId !== polylineStartPointDrag.pointerId || !polylineDraft.value?.points?.length) return
  const point = polylinePointFromEvent(e)
  polylineDraft.value.points[0] = point
  if (polylineDraft.value.points.length === 1) polylineDraft.value.hover = point
}
function endPolylineStartPointDrag(e) {
  if (!polylineStartPointDrag || (e?.pointerId != null && e.pointerId !== polylineStartPointDrag.pointerId)) return
  const { target, pointerId } = polylineStartPointDrag
  polylineStartPointDrag = null
  try { if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId) } catch {}
  window.removeEventListener('pointermove', movePolylineStartPoint)
  window.removeEventListener('pointerup', endPolylineStartPointDrag)
  window.removeEventListener('pointercancel', endPolylineStartPointDrag)
  window.removeEventListener('blur', endPolylineStartPointDrag)
  endEditorInteraction(POLYLINE_POINT_INTERACTION)
}
function startPolylineStartPointDrag(e) {
  if ((e.button ?? 0) !== 0 || !isPolylineNodeType(activeTool.value) || !polylineDraft.value?.points?.length) return
  e.preventDefault()
  e.stopPropagation()
  endPolylineStartPointDrag()
  polylineDraft.value.hover = polylineDraft.value.points.at(-1)
  polylineStartPointDrag = { pointerId: e.pointerId, target: e.currentTarget }
  beginEditorInteraction(POLYLINE_POINT_INTERACTION)
  try { e.currentTarget?.setPointerCapture?.(e.pointerId) } catch {}
  window.addEventListener('pointermove', movePolylineStartPoint)
  window.addEventListener('pointerup', endPolylineStartPointDrag)
  window.addEventListener('pointercancel', endPolylineStartPointDrag)
  window.addEventListener('blur', endPolylineStartPointDrag)
}
const selectedPolylinePointPaths = computed(() => (
  isPolylineNodeType(selected.value?.type)
    ? polylinePointHandlePaths(selected.value)
    : { all: '', endpoints: '' }
))
function startPolylinePointLayerDrag(e, node) {
  if ((e.button ?? 0) !== 0 || !isPolylineNodeType(node?.type)) return
  const localPoint = worldPointToPolylineLocal(node, pointFromEvent(e, false))
  const pointIndex = nearestPolylinePointIndex(node, localPoint, 12 / Math.max(.0001, zoom.value))
  if (pointIndex >= 0) startPolylinePointDrag(e, node, pointIndex)
}
function startPolylinePointDrag(e, node, pointIndex) {
  if (
    (e.button ?? 0) !== 0
    || activeTool.value !== 'select'
    || selectedNodeCount.value !== 1
    || !isPolylineNodeType(node.type) || node.locked
    || operation.value
  ) return
  const points = polylineNormalizedPointsToLocal(node)
  if (!points[pointIndex]) return
  e.preventDefault()
  e.stopPropagation()
  beginPointerOperation(e, {
    type: 'polylinePoint',
    id: node.id,
    pointIndex,
    frame: {
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      rotate: node.rotate || 0,
      polylineWidth: node.polylineWidth,
      polylineStartMarker: node.polylineStartMarker,
      polylineEndMarker: node.polylineEndMarker
    },
    points,
    historyRecord: captureFieldRecord(node, ['x', 'y', 'w', 'h', 'polylinePoints'])
  })
}
function polylineSegmentCount(node) {
  return clampPolylineSegmentCount((Array.isArray(node?.polylinePoints) ? node.polylinePoints.length : 0) - 1, 1)
}
function setPolylineSegmentCount(node, value) {
  if (!isPolylineNodeType(node?.type) || node.locked) return
  const nextCount = clampPolylineSegmentCount(value)
  if (nextCount === polylineSegmentCount(node)) return
  const geometry = resamplePolylineNodeGeometry(node, nextCount)
  if (!geometry) return
  Object.assign(node, geometry)
  updateNodeSpatialIndex(node)
  markPreviewCanvasDocumentDirty()
}
function addPolylinePoint(e) {
  if ((e.button ?? 0) !== 0 || !isPolylineNodeType(activeTool.value) || operation.value) return false
  e.preventDefault()
  lastTablePointerDown = null
  paperSelected.value = false
  editingFormId.value = null
  selectedDrawingId.value = null
  if (!polylineDraft.value) {
    if (nodes.value.length + drawings.value.length >= MAX_PROJECT_NODES) {
      notify(`图纸最多支持 ${MAX_PROJECT_NODES} 个组件和线稿`)
      return true
    }
    clearNodeSelection()
    const point = polylinePointFromEvent(e)
    const flowDirection = activeTool.value === 'flowDirection'
    polylineDraft.value = {
      type: activeTool.value,
      points: [point],
      hover: point,
      color: flowDirection ? '#16b89a' : lineColor.value,
      width: flowDirection ? 4 : lineWidth.value,
      dash: flowDirection || lineDash.value,
      style: flowDirection || lineDash.value ? 'dashed' : 'solid',
      startMarker: 'none',
      endMarker: flowDirection ? 'arrow' : 'none',
      lineCap: 'round',
      lineJoin: 'round'
    }
    return true
  }
  const draft = polylineDraft.value
  const point = polylinePointFromEvent(e)
  draft.hover = point
  if (Math.hypot(point.x - draft.points[0].x, point.y - draft.points[0].y) <= 2 / zoom.value) return true
  draft.points = createEvenlySpacedPolylinePoints(draft.points[0], point, DEFAULT_POLYLINE_SEGMENT_COUNT)
  return finishPolylineDrawing(e)
}
function finishPolylineDrawing(e) {
  if (!isPolylineNodeType(activeTool.value) || !polylineDraft.value) return false
  e?.preventDefault?.()
  e?.stopPropagation?.()
  const draft = polylineDraft.value
  if (draft.points.length < 2) {
    notify('请至少添加两个不同的节点')
    return false
  }
  const frame = polylineFrameFromWorldPoints(draft.points, {
    stageWidth: stageWidth.value,
    stageHeight: stageHeight.value,
    lineWidth: draft.width,
    startMarker: draft.startMarker,
    endMarker: draft.endMarker
  })
  if (!frame) return false
  endPolylineStartPointDrag()
  const node = normalizeNode({
    ...baseNodeOptions(),
    id: createEntityId('node'),
    layer: reserveEntityLayers(),
    type: draft.type,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    rotate: 0,
    text: draft.type === 'flowDirection' ? '流向' : '线段',
    fill: '#ffffff',
    stroke: draft.color,
    color: draft.color,
    backgroundOpacity: 0,
    borderVisible: false,
    opacity: 1,
    polylinePoints: frame.points,
    polylineColor: draft.color,
    polylineWidth: draft.width,
    polylineStyle: draft.style,
    polylineOpacity: 1,
    polylineDash: draft.dash,
    polylineStartMarker: draft.startMarker,
    polylineEndMarker: draft.endMarker,
    polylineLineCap: draft.lineCap,
    polylineLineJoin: draft.lineJoin,
    flowArrowVisible: draft.type === 'flowDirection',
    animation: draft.type === 'flowDirection' ? 'flow' : 'none',
    animationDuration: 1.5,
    animationDirection: 'normal',
    animationPaused: false,
    borderDashLength: 8,
    borderDashGap: 6
  })
  recordEntityInsertion({ nodes: [node], edges: [], drawings: [] })
  const [insertedNode] = appendNodes(node)
  polylineDraft.value = null
  selectSingleNode(insertedNode)
  activeTool.value = 'select'
  return true
}
function cancelPolylineDrawing(showNotice = false) {
  endPolylineStartPointDrag()
  if (!polylineDraft.value) return false
  polylineDraft.value = null
  if (isPolylineNodeType(activeTool.value)) activeTool.value = 'select'
  if (showNotice) notify('已取消当前线段')
  return true
}
function removeLastPolylinePoint() {
  const draft = polylineDraft.value
  if (!draft?.points?.length) return false
  draft.points.pop()
  if (!draft.points.length) {
    endPolylineStartPointDrag()
    polylineDraft.value = null
    activeTool.value = 'select'
  }
  else draft.hover = draft.points.at(-1)
  return true
}
function handleCanvasPointerMove(e) {
  trackCanvasZoomPointer(e)
  if (isPolylineNodeType(activeTool.value) && polylineDraft.value && !polylineStartPointDrag && !operation.value) polylineDraft.value.hover = polylinePointFromEvent(e)
}
function handleCanvasPointerLeave() {
  clearCanvasZoomGesture()
  if (polylineDraft.value?.points?.length) polylineDraft.value.hover = polylineDraft.value.points.at(-1)
}
function drawingBounds(drawing) {
  if (!drawing?.points?.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const point of drawing.points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}
function finalizePencilDrawing(id) {
  const drawingIndex = drawings.value.findIndex(item => item.id === id)
  if (drawingIndex < 0) return
  const [drawing] = drawings.value.splice(drawingIndex, 1)
  removeDrawingIndex(drawing)
  removeLayerEntries('drawing', [drawing])
  selectedDrawingId.value = null
  if (drawing.points.length < 2) return
  const node = drawingToPencilNode(drawing, createEntityId('node'), stageWidth.value, stageHeight.value)
  if (!node) return
  Object.assign(node, normalizeNodeGeometry(node, stageWidth.value, stageHeight.value))
  recordEntityInsertion({ nodes: [node], edges: [], drawings: [] })
  const [insertedNode] = appendNodes(node)
  selectSingleNode(insertedNode)
}
function drawingFrame(drawing, bounds = drawingBounds(drawing)) {
  const padding = Math.max(12, (Number(drawing?.width) || 2) + 8)
  return { x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 }
}
function drawingPath(drawing) {
  const points = drawing?.points || []
  if (!points.length) return ''
  if (!drawing.smooth || points.length < 3) return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}${drawing.closed ? ' Z' : ''}`
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const midpoint = { x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2 }
    path += ` Q ${points[index].x} ${points[index].y} ${midpoint.x} ${midpoint.y}`
  }
  path += ` L ${points.at(-1).x} ${points.at(-1).y}`
  return path + (drawing.closed ? ' Z' : '')
}
function drawingRenderEntry(drawing) {
  const bounds = drawingBounds(drawing)
  return { drawing, bounds, frame: drawingFrame(drawing, bounds), path: drawingPath(drawing) }
}
function drawingsInBounds(bounds, options = {}) {
  void drawingSpatialRevision.value
  return drawingSpatialIndex.query(bounds, { sort: false, ...options })
}
const selectedDrawingEntry = computed(() => {
  const drawing = drawingIndex.value.get(selectedDrawingId.value)
  return drawing ? drawingRenderEntry(drawing) : null
})
const activeOperationDrawingId = computed(() => ['draw', 'moveDrawing', 'resizeDrawing'].includes(operation.value?.type) ? operation.value.id : null)
const visibleDrawingEntries = computed(() => {
  const renderBounds = transientCanvasRenderBounds.value
  const bounds = renderBounds || viewportWorldBounds(viewport.value, zoom.value)
  const visible = drawingsInBounds(bounds)
  const active = drawingIndex.value.get(activeOperationDrawingId.value)
  if (active && !visible.some(drawing => drawing.id === active.id)) visible.push(active)
  return visible.map(drawingRenderEntry)
})
const editorRenderedDrawingEntries = computed(() => {
  if (editorRenderPaused.value) return []
  if (!editorLodActive.value || !editorLodCanvasRendersEntities.value) return visibleDrawingEntries.value
  const ids = new Set([
    ...(!editorLodCanvasReady.value ? editorLodBootstrapDrawingIds.value : []),
    selectedDrawingId.value,
    activeOperationDrawingId.value
  ].filter(Boolean))
  if (!ids.size) return []
  return [...ids].map(id => drawingIndex.value.get(id)).filter(Boolean).map(drawingRenderEntry)
})
const previewDomDrawings = computed(() => {
  if (!previewDomMounted.value) return []
  if (previewDomEdgeCanvasActive.value) return []
  const source = (
    previewDomFullDocumentRequested.value ? drawings.value : previewDrawingCandidates.value
  )
  if (!previewDomUsesLivePlane.value) return source
  const excludedIds = new Set(previewFitExcludedDrawingIds.value)
  return source.filter(drawing => !excludedIds.has(drawing.id))
})
const previewLivePlaneDrawingEntries = computed(() => previewLivePlaneDrawings.value.map(drawingRenderEntry))

function primeEditorLodBootstrap() {
  const bounds = viewportWorldBounds(viewport.value, zoom.value, LARGE_DOCUMENT_OVERSCAN)
  editorLodBootstrapNodeIds.value = nodeSpatialIndex
    .query(bounds, { sort: false, limit: EDITOR_LOD_BOOTSTRAP_ENTITY_LIMIT })
    .map(node => node.id)
  editorLodBootstrapDrawingIds.value = drawingsInBounds(bounds, { limit: EDITOR_LOD_BOOTSTRAP_ENTITY_LIMIT })
    .map(drawing => drawing.id)
}

watch(editorLodFallbackPlanKey, () => {
  if (!editorLodActive.value || editorRenderPaused.value) return
  cancelEditorLodRendering('editor-lod-mode-change')
  if (editorLodCanvasRendersEntities.value) primeEditorLodBootstrap()
  syncEditorLodDetailBounds(true)
}, { flush: 'sync' })

watch(editorLodActive, active => {
  editorLodCanvasReady.value = false
  if (active) {
    if (!editorLodDocumentResetPending) primeEditorLodBootstrap()
    return
  }
  resetEditorLodRecovery()
  editorLodFallbackAnimationTimestamp.value = null
  editorLodBootstrapNodeIds.value = []
  editorLodBootstrapDrawingIds.value = []
  editorLodPendingInsertionNodeIds.value = []
  clearEditorLodGeometryVisualState()
}, { flush: 'sync' })

function addNode(type, x = 350, y = 220) {
  if (nodes.value.length + drawings.value.length >= MAX_PROJECT_NODES) return notify(`图纸最多支持 ${MAX_PROJECT_NODES} 个组件和线稿`)
  const spec = shapeDefaults[type] || shapeDefaults.rect
  const id = createEntityId('node')
  let n = { ...baseNodeOptions(), id, layer: reserveEntityLayers(), type, x, y, w: spec[1], h: spec[2], text: spec[0], fill: '#ffffff', stroke: '#16b89a', color: '#28323c', visualPrimaryColor: builtInVisualPrimaryColor(type), radius: type === 'circle' ? 50 : 6, animation: animationDefaults[type] || 'none', dataKey: animationDefaults[type] ? `demo.${type}.${id}` : '', ...(formNodeDefaults[type] || {}) }
  if (type === 'lineShape') { n.fill = '#16b89a'; n.stroke = '#485563'; n.borderWidth = 2 }
  if (type === 'flowDirection') n.polylineColor = builtInVisualPrimaryColor(type)
  if (type === 'code') { n.fill = '#25323b'; n.color = '#d8f5ee' }
  if (type === 'table') n = normalizeTableModel(n)
  if (type === 'select') n.selectOptions = normalizeSelectOptions(n)
  Object.assign(n, normalizeNodeGeometry(n, stageWidth.value, stageHeight.value))
  if (formTypeIds.has(type)) { n.defaultChecked = Boolean(n.checked); n.defaultValue = String(n.value ?? '') }
  recordEntityInsertion({ nodes: [n], edges: [], drawings: [] })
  const [insertedNode] = appendNodes(n); selectSingleNode(insertedNode); activeTool.value = 'select'
}
function ensureSelectedTable() {
  const node = selected.value
  if (!node || node.type !== 'table' || node.locked) return null
  if (!Array.isArray(node.tableHeaders) || !Array.isArray(node.tableCells) || !Array.isArray(node.tableColumnWidths) || !Array.isArray(node.tableColumnWidthsPx) || !Array.isArray(node.tableRowHeights) || !Array.isArray(node.tableMerges)) Object.assign(node, normalizeTableModel(node))
  return node
}
function normalizeNodeTableMerges(node) {
  node.tableMerges = normalizeTableMerges(node.tableMerges, node.tableCells.length, node.tableHeaders.length)
}
function clearTableDataSelection() {
  tableSelectionDragging.value = false
  tableDataSelection.value = { nodeId: null, start: null, end: null, awaitingEnd: false }
}
function migrateTableMergesForInsertion(merges, axis, index) {
  const startKey = axis === 'row' ? 'row' : 'column'
  const spanKey = axis === 'row' ? 'rowSpan' : 'columnSpan'
  return (merges || []).map(merge => {
    const next = { ...merge }
    const start = next[startKey]
    const end = start + next[spanKey]
    if (index <= start) next[startKey] += 1
    else if (index < end) next[spanKey] += 1
    return next
  })
}
function migrateTableMergesForDeletion(merges, axis, index) {
  const startKey = axis === 'row' ? 'row' : 'column'
  const spanKey = axis === 'row' ? 'rowSpan' : 'columnSpan'
  return (merges || []).flatMap(merge => {
    const next = { ...merge }
    const start = next[startKey]
    const end = start + next[spanKey]
    if (index < start) next[startKey] -= 1
    else if (index < end) {
      if (next[spanKey] <= 1) return []
      next[spanKey] -= 1
    }
    return [next]
  })
}
function defaultTableColumnWidth(node, index) {
  const widths = node.tableColumnWidthsPx || []
  return clampTableColumnWidth(widths[index - 1] ?? widths[index] ?? (widths.reduce((sum, width) => sum + Number(width || 0), 0) / Math.max(1, widths.length)) ?? 120)
}
const TABLE_MODEL_HISTORY_FIELDS = [
  'tableMerges', 'tableCells', 'tableRowHeights', 'tableRows',
  'tableHeaders', 'tableColumnWidths', 'tableColumnWidthsPx', 'tableColumns'
]
function insertTableRow(index) {
  const node = ensureSelectedTable(); if (!node || node.tableCells.length >= 50) return
  const insertAt = Math.max(0, Math.min(node.tableCells.length, Math.round(Number(index))))
  recordNodeFields(node, TABLE_MODEL_HISTORY_FIELDS)
  node.tableMerges = migrateTableMergesForInsertion(node.tableMerges, 'row', insertAt)
  node.tableCells.splice(insertAt, 0, Array.from({ length: node.tableHeaders.length }, () => ''))
  node.tableRowHeights.splice(insertAt, 0, Math.max(18, Math.min(120, Number(node.tableRowHeights[insertAt - 1] ?? node.tableRowHeights[insertAt] ?? node.tableRowHeight) || 28)))
  node.tableRows = node.tableCells.length
  normalizeNodeTableMerges(node)
  clearTableDataSelection()
}
function deleteTableRow(index) {
  const node = ensureSelectedTable(); if (!node || node.tableCells.length <= 1) return
  const removeAt = Math.max(0, Math.min(node.tableCells.length - 1, Math.round(Number(index))))
  recordNodeFields(node, TABLE_MODEL_HISTORY_FIELDS)
  node.tableMerges = migrateTableMergesForDeletion(node.tableMerges, 'row', removeAt)
  node.tableCells.splice(removeAt, 1)
  node.tableRowHeights.splice(removeAt, 1)
  node.tableRows = node.tableCells.length
  normalizeNodeTableMerges(node)
  clearTableDataSelection()
}
function insertTableColumn(index) {
  const node = ensureSelectedTable(); if (!node || node.tableHeaders.length >= 12) return
  const insertAt = Math.max(0, Math.min(node.tableHeaders.length, Math.round(Number(index))))
  recordNodeFields(node, TABLE_MODEL_HISTORY_FIELDS)
  node.tableMerges = migrateTableMergesForInsertion(node.tableMerges, 'column', insertAt)
  node.tableHeaders.splice(insertAt, 0, `列 ${insertAt + 1}`)
  node.tableColumnWidths.splice(insertAt, 0, 1)
  node.tableColumnWidthsPx.splice(insertAt, 0, defaultTableColumnWidth(node, insertAt))
  node.tableCells.forEach(row => row.splice(insertAt, 0, ''))
  node.tableColumns = node.tableHeaders.length
  normalizeNodeTableMerges(node)
  clearTableDataSelection()
}
function deleteTableColumn(index) {
  const node = ensureSelectedTable(); if (!node || node.tableHeaders.length <= 1) return
  const removeAt = Math.max(0, Math.min(node.tableHeaders.length - 1, Math.round(Number(index))))
  recordNodeFields(node, TABLE_MODEL_HISTORY_FIELDS)
  node.tableMerges = migrateTableMergesForDeletion(node.tableMerges, 'column', removeAt)
  node.tableHeaders.splice(removeAt, 1)
  node.tableColumnWidths.splice(removeAt, 1)
  node.tableColumnWidthsPx.splice(removeAt, 1)
  node.tableCells.forEach(row => row.splice(removeAt, 1))
  node.tableColumns = node.tableHeaders.length
  normalizeNodeTableMerges(node)
  clearTableDataSelection()
}
function addTableRow() {
  const node = ensureSelectedTable(); if (!node || node.tableCells.length >= 50) return
  insertTableRow(node.tableCells.length)
}
function addTableColumn() {
  const node = ensureSelectedTable(); if (!node || node.tableHeaders.length >= 12) return
  insertTableColumn(node.tableHeaders.length)
}
function syncAllTableRowHeights(value) {
  const node = ensureSelectedTable(); if (!node) return
  const height = Math.max(18, Math.min(120, Number(value) || 28))
  node.tableRowHeight = height
  node.tableRowHeights.forEach((_, row) => { node.tableRowHeights[row] = height })
}
function setTableColumnWidth(column, value) {
  const node = ensureSelectedTable(); if (!node || column < 0 || column >= node.tableHeaders.length) return
  node.tableColumnWidthsPx[column] = clampTableColumnWidth(value, node.tableColumnWidthsPx[column])
}
function setTableRowHeight(row, value) {
  const node = ensureSelectedTable(); if (!node || row < 0 || row >= node.tableCells.length) return
  node.tableRowHeights[row] = Math.max(18, Math.min(120, Math.round(Number(value) || node.tableRowHeight || 28)))
}
function tableDataGridColumns(node) {
  const widths = node?.tableColumnWidthsPx || []
  return `104px ${Array.from({ length: node?.tableHeaders?.length || 0 }, (_, index) => `${Math.max(160, clampTableColumnWidth(widths[index]))}px`).join(' ')}`
}
function openTableDataEditor(node = selected.value) {
  if (!node || node.type !== 'table') return
  if (node.locked) {
    selectSingleNode(node)
    notify('组件已锁定，请先解锁后编辑')
    return
  }
  if (!Array.isArray(node.tableHeaders) || !Array.isArray(node.tableCells) || !Array.isArray(node.tableColumnWidthsPx) || !Array.isArray(node.tableRowHeights) || !Array.isArray(node.tableMerges)) Object.assign(node, normalizeTableModel(node))
  selectSingleNode(node)
  editingFormId.value = null
  tableDataEditor.value = { show: true, nodeId: node.id, tab: 'data', mode: 'edit' }
  clearTableDataSelection()
}
function closeTableDataEditor() {
  finishActiveFieldEdit()
  tableDataEditor.value = { show: false, nodeId: null, tab: 'data', mode: 'edit' }
  clearTableDataSelection()
}
function setTableDataEditorTab(tab) {
  if (!['data', 'style'].includes(tab)) return
  tableDataEditor.value = { ...tableDataEditor.value, tab }
  clearTableDataSelection()
}
function setTableDataEditorMode(mode) {
  if (!['edit', 'merge'].includes(mode)) return
  tableDataEditor.value = { ...tableDataEditor.value, mode }
  clearTableDataSelection()
}
function selectTableDataCell(row, column) {
  const node = activeTableDataNode.value
  if (!node) return
  const selection = tableDataSelection.value
  const cell = { row, column }
  if (selection.nodeId !== node.id || !selection.start || !selection.awaitingEnd) {
    tableDataSelection.value = { nodeId: node.id, start: cell, end: cell, awaitingEnd: true }
  } else {
    tableDataSelection.value = { ...selection, end: cell, awaitingEnd: false }
  }
}
function startTableDataSelectionDrag(event, row, column) {
  const node = activeTableDataNode.value
  if (!node || tableDataEditor.value.mode !== 'merge') return
  event.preventDefault()
  tableSelectionDragging.value = true
  const cell = { row, column }
  tableDataSelection.value = { nodeId: node.id, start: cell, end: cell, awaitingEnd: true }
}
function extendTableDataSelectionDrag(row, column) {
  if (!tableSelectionDragging.value || tableDataEditor.value.mode !== 'merge') return
  tableDataSelection.value = { ...tableDataSelection.value, end: { row, column } }
}
function extendTableDataSelectionFromPointer(event) {
  if (!tableSelectionDragging.value || tableDataEditor.value.mode !== 'merge') return
  const cell = event.target?.closest?.('[data-table-cell]')
  if (!cell) return
  const row = Number(cell.dataset.tableRow)
  const column = Number(cell.dataset.tableColumn)
  if (Number.isInteger(row) && Number.isInteger(column)) extendTableDataSelectionDrag(row, column)
}
function finishTableDataSelectionDrag() {
  if (!tableSelectionDragging.value) return
  tableSelectionDragging.value = false
  tableDataSelection.value = { ...tableDataSelection.value, awaitingEnd: false }
}
function selectTableDataRow(row) {
  const node = activeTableDataNode.value
  if (!node) return
  tableDataSelection.value = { nodeId: node.id, start: { row, column: 0 }, end: { row, column: node.tableColumns - 1 }, awaitingEnd: false }
}
function selectTableDataColumn(column) {
  const node = activeTableDataNode.value
  if (!node) return
  tableDataSelection.value = { nodeId: node.id, start: { row: 0, column }, end: { row: node.tableRows - 1, column }, awaitingEnd: false }
}
function tableDataCellSelected(row, column) {
  const selection = activeTableSelection.value
  return Boolean(selection && row >= selection.row && row <= selection.rowEnd && column >= selection.column && column <= selection.columnEnd)
}
function tableDataMergeAt(row, column) {
  return activeTableMergeLookup.value.get(`${row}:${column}`) || null
}
function tableDataMergeLabel(row, column) {
  const merge = tableDataMergeAt(row, column)
  if (!merge) return ''
  return row === merge.row && column === merge.column ? `${merge.rowSpan} 行 x ${merge.columnSpan} 列` : '合并区域'
}
function tableDataCellCovered(row, column) {
  const merge = tableDataMergeAt(row, column)
  return Boolean(merge && (merge.row !== row || merge.column !== column))
}
function tableDataEditorCellStyle(row, column) {
  const merge = tableDataMergeAt(row, column)
  const origin = merge && merge.row === row && merge.column === column ? merge : null
  return {
    gridRow: `${row + 2} / span ${origin?.rowSpan || 1}`,
    gridColumn: `${column + 2} / span ${origin?.columnSpan || 1}`
  }
}
function mergeSelectedTableCells() {
  const node = activeTableDataNode.value
  const selection = activeTableSelection.value
  if (!node || !selection || selection.cellCount < 2) return
  const partialOverlap = selectedTableMerges.value.some(merge => (
    merge.row < selection.row || merge.column < selection.column ||
    merge.row + merge.rowSpan - 1 > selection.rowEnd || merge.column + merge.columnSpan - 1 > selection.columnEnd
  ))
  if (partialOverlap) return notify('选区与已有合并区域部分重叠，请先拆分对应区域')
  recordNodeFields(node, ['tableMerges'])
  const contained = new Set(selectedTableMerges.value)
  node.tableMerges = normalizeTableMerges([
    ...(node.tableMerges || []).filter(merge => !contained.has(merge)),
    { row: selection.row, column: selection.column, rowSpan: selection.rowSpan, columnSpan: selection.columnSpan }
  ], node.tableRows, node.tableColumns)
  tableDataSelection.value = { ...tableDataSelection.value, awaitingEnd: false }
  notify(`已合并 ${selection.rowSpan} 行 × ${selection.columnSpan} 列`)
}
function splitSelectedTableCells() {
  const node = activeTableDataNode.value
  const merges = selectedTableMerges.value
  if (!node || !merges.length) return
  recordNodeFields(node, ['tableMerges'])
  const removed = new Set(merges)
  node.tableMerges = (node.tableMerges || []).filter(merge => !removed.has(merge))
  tableDataSelection.value = { ...tableDataSelection.value, awaitingEnd: false }
  notify(`已拆分 ${merges.length} 个合并区域`)
}
function openTableCellViewer(node, cell) {
  if (!node || node.type !== 'table' || node.tableContentDisplay === 'wrap' || !cell || cell.row < 0 || cell.column < 0) return
  tableCellViewer.value = {
    show: true,
    nodeId: node.id,
    row: cell.row,
    column: cell.column,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    title: cell.title,
    text: cell.text
  }
}
function closeTableCellViewer() {
  tableCellViewer.value = { show: false, nodeId: null, row: -1, column: -1 }
}
function ensureSelectedOptions() {
  const node = selected.value
  if (!node || node.type !== 'select' || node.locked) return null
  if (!Array.isArray(node.selectOptions)) node.selectOptions = normalizeSelectOptions(node)
  return node
}
function addSelectOption() {
  const node = ensureSelectedOptions(); if (!node || node.selectOptions.length >= 50) return
  recordNodeFields(node, ['selectOptions', 'value', 'defaultValue'])
  const index = node.selectOptions.length + 1
  node.selectOptions.push({ label: `选项 ${index}`, value: `option${index}` })
}
function removeSelectOption(index) {
  const node = ensureSelectedOptions(); if (!node || node.selectOptions.length <= 1) return
  recordNodeFields(node, ['selectOptions', 'value', 'defaultValue'])
  const [removed] = node.selectOptions.splice(index, 1)
  const fallback = node.selectOptions[0]?.value || ''
  if (node.value === removed.value) node.value = fallback
  if (node.defaultValue === removed.value) node.defaultValue = fallback
}
function setSelectOptionValue(index, value) {
  const node = ensureSelectedOptions(); if (!node?.selectOptions[index]) return
  const oldValue = node.selectOptions[index].value
  const nextValue = String(value)
  node.selectOptions[index].value = nextValue
  if (node.value === oldValue) node.value = nextValue
  if (node.defaultValue === oldValue) node.defaultValue = nextValue
}
function normalizeProgress(node = selected.value) {
  if (!node || node.type !== 'formProgress' || node.locked) return
  if (node.progressMode === 'percent') { node.progressMin = 0; node.progressMax = 100 }
  else { node.progressMin = 0; node.progressMax = Math.max(1, Number(node.progressMax) || 100) }
  node.progressValue = Math.max(node.progressMin, Math.min(node.progressMax, Number(node.progressValue) || 0))
}
function resetButtonData() {
  if (!selected.value || selected.value.type !== 'button' || selected.value.locked) return
  selected.value.clickCount = 0; selected.value.checked = false; selected.value.buttonFeedback = ''
}
function closeButtonMessage() {
  buttonMessageDialog.value = { show: false, nodeId: null, title: '', message: '' }
}
function currentTimestampForNode(node) {
  return Date.now() + (node?.timeUseServer ? serverTimeOffset.value : 0)
}
async function syncServerTime(silent = false) {
  const requestedAt = Date.now()
  const result = await timeService.current({ context: backendRequestContext() })
  const receivedAt = Date.now()
  if (result.source === 'server') {
    const serverNow = result.now
    serverTimeOffset.value = serverNow - (requestedAt + receivedAt) / 2
    serverTimeSyncedAt.value = receivedAt
    currentTimeTick.value = receivedAt
    return serverNow
  }
  serverTimeOffset.value = 0
  serverTimeSyncedAt.value = receivedAt
  if (!silent) notify('服务器时间同步失败，已使用本机时间')
  return result.now
}
async function setTimeUseServer(checked) {
  const node = selected.value
  if (!node || node.type !== 'time' || node.locked) return
  const before = resolveTimeValue(node, currentTimestampForNode(node))
  node.timeUseServer = Boolean(checked)
  if (node.timeUseServer) {
    await syncServerTime()
    if (node.locked || nodeIndex.value.get(node.id) !== node) return
    const now = currentTimestampForNode(node)
    const formatted = formatTimeValue(now, node.timeFormat)
    node.timeFrozenValue = formatted
    node.defaultValue = formatted
    node.value = formatted
    node.timeStartedAt = now
  } else {
    node.defaultValue = before
    node.value = before
    node.timeStartedAt = Date.now()
    if (node.timeMode === 'fixed') node.timeRunning = false
  }
}
async function setTimeRunning(checked) {
  const node = selected.value
  if (!node || node.type !== 'time' || node.locked) return
  if (checked && node.timeUseServer && Date.now() - serverTimeSyncedAt.value > 60000) await syncServerTime()
  if (node.locked || nodeIndex.value.get(node.id) !== node) return
  const now = currentTimestampForNode(node)
  if (checked) {
    node.timeStartedAt = now
    node.timeRunning = true
    currentTimeTick.value = Date.now()
    return
  }
  const displayed = resolveTimeValue(node, now)
  node.timeRunning = false
  node.timeStartedAt = null
  node.value = displayed
  if (node.timeUseServer) node.timeFrozenValue = displayed
  else node.defaultValue = displayed
}
function setTimeMode(mode) {
  const node = selected.value
  if (!node || node.type !== 'time' || node.locked) return
  const displayed = resolveTimeValue(node, currentTimestampForNode(node))
  node.timeMode = mode === 'elapsed' ? 'elapsed' : 'fixed'
  node.timeRunning = false
  node.timeStartedAt = null
  node.defaultValue = displayed
  node.value = displayed
}
function setTimeFormat(format) {
  const node = selected.value
  if (!node || node.type !== 'time' || node.locked) return
  const now = currentTimestampForNode(node)
  const displayed = resolveTimeValue(node, now)
  const timestamp = parseTimeValue(displayed, node.timeFormat, now)
  node.timeFormat = format
  const formatted = formatTimeValue(Number.isFinite(timestamp) ? timestamp : now, format)
  node.defaultValue = formatted
  node.value = formatted
  node.timeFrozenValue = formatted
  node.timeStartedAt = node.timeRunning ? now : null
}
function formDataValue(node) {
  if (!node) return ''
  if (['checkbox', 'radio', 'switch'].includes(node.type)) return node.checked ? node.checkedValue : node.uncheckedValue
  if (node.type === 'formProgress') return node.progressValue
  if (node.type === 'button') return node.buttonAction === 'toggle' ? (node.checked ? node.checkedValue : node.uncheckedValue) : node.clickCount
  if (node.type === 'table') return `${node.tableRows} 行 × ${node.tableColumns} 列`
  if (node.type === 'time') return resolveTimeValue(node, currentTimestampForNode(node))
  return node.value ?? ''
}
function formMemoKey(node) {
  if (!formTypeIds.has(node.type)) return ''
  return JSON.stringify([
    node.formName, node.value, node.defaultValue, node.checked, node.defaultChecked, node.disabled, node.required, node.readOnly, node.checkedValue, node.uncheckedValue,
    node.labelPosition, node.controlSize, node.switchWidth, node.switchHeight, node.inputType, node.maxLength, node.buttonAction,
    node.actionMessage, node.clickCount, node.showClickCount, node.buttonBeforeColor, node.buttonAfterColor, node.buttonFeedback, node.progressMin, node.progressMax, node.progressValue, node.progressMode, node.showProgressText,
    node.progressHeight, node.progressThickness, node.progressLength, node.progressStartShape, node.progressEndShape, node.progressFluctuationEnabled, node.progressFluctuationMin, node.progressFluctuationMax, node.progressFluctuationDuration,
    node.timeFormat, node.timeMode, node.timeUseServer, node.timeRunning, node.timeStartedAt, node.timeFrozenValue, node.timeShowLeftIcon, node.timeShowRightIcon, node.selectOptions, node.tableRows, node.tableColumns, node.showHeader, node.tableData, node.tableTitle,
    node.showTableTitle, node.tableTitleFill, node.tableTitleColor, node.tableTitleSize, node.tableTitleWeight, node.tableTitleAlign,
    node.tableHeaderFill, node.tableHeaderColor, node.tableHeaderSize, node.tableHeaderWeight, node.tableHeaderAlign,
    node.tableRowFill, node.tableAltRowFill, node.tableCellColor, node.tableCellSize, node.tableCellWeight, node.tableGridColor, node.tableGridWidth, node.tableGridStyle,
    node.tableBorderColor, node.tableBorderWidth, node.tableBorderStyle, node.tableHeaderHeight, node.tableRowHeight, node.tableRowHeights, node.tableTextAlign, node.tableContentDisplay,
    node.tableHeaders, node.tableCells, node.tableColumnWidths, node.tableColumnWidthsPx, node.tableScrollX, node.tableScrollY, node.tableMerges
  ])
}
function progressMemoKey(node) {
  if (node.type !== 'progress') return ''
  return JSON.stringify([node.progressValue, node.progressThickness, node.progressLength, node.progressStartShape, node.progressEndShape, node.progressFluctuationEnabled, node.progressFluctuationMin, node.progressFluctuationMax, node.progressFluctuationDuration])
}
function pencilMemoKey(node) {
  if (node.type !== 'pencil') return ''
  return JSON.stringify([node.pencilPoints, node.pencilColor, node.pencilWidth, node.pencilDash, node.pencilSmooth, node.pencilClosed, node.pencilLineCap, node.pencilLineJoin])
}
function polylineMemoKey(node) {
  if (!isPolylineNodeType(node.type)) return ''
  return JSON.stringify([node.polylinePoints, node.polylineColor, node.polylineWidth, node.polylineArrowSize, node.polylineStyle, node.polylineOpacity, node.polylineDash, node.polylineStartMarker, node.polylineEndMarker, node.polylineLineCap, node.polylineLineJoin, node.flowArrowVisible, node.dash, node.width])
}
function dataBindingsMemoKey(node) {
  return JSON.stringify((node.dataBindings || []).map(binding => [
    binding.target,
    binding.sourceId,
    binding.jsonPath,
    binding.pointId,
    binding.enabled !== false,
    binding.adapter
  ]))
}
const nodeRenderMemoCache = new WeakMap()
function nodeRenderMemo(node) {
  let memo = nodeRenderMemoCache.get(node)
  if (!memo) {
    const geometry = computed(() => [node.x, node.y, node.w, node.h, node.rotate, node.visualScaleX, node.visualScaleY, node.layer])
    const common = computed(() => [
      node.type, node.locked, node.text, node.fill, node.stroke, node.color, node.radius, node.backgroundOpacity, node.opacity, node.dataKey,
      node.fontSize, node.fontWeight, node.fontWeightScale, node.fontStyle, node.textAlign, node.textLayout,
      node.borderVisible, node.borderWidth, node.borderStyle, node.borderDashLength, node.borderDashGap,
      node.animation, node.animationPaused, node.animationDuration, node.animationDirection, node.animationDelay, node.animationEasing, node.animationIterations,
      node.customEffect, node.motionDistance, node.motionScale, node.motionRotate, node.motionColor, node.visualPrimaryColor,
      node.imageUrl, node.imageFit, node.videoUrl, node.videoFit, node.videoAutoplay, node.videoControls, node.videoPlaybackRate, node.videoPlayCount, node.videoMuted,
      node.placeholder, node.options, node.signalColor, node.signalColorCount, node.signalColors?.join(','), node.signalOpacity
    ])
    const content = computed(() => [formMemoKey(node), progressMemoKey(node), pencilMemoKey(node), polylineMemoKey(node), dataBindingsMemoKey(node)])
    // Geometry edits do not invalidate expensive table or path fingerprints.
    memo = computed(() => ({
      geometry: geometry.value,
      common: common.value,
      content: content.value,
      dataKey: node.dataKey,
      dataBindings: dataBindingsMemoKey(node),
      isTime: node.type === 'time',
      timeRunning: Boolean(node.timeRunning),
      timeUseServer: Boolean(node.timeUseServer)
    }))
    nodeRenderMemoCache.set(node, memo)
  }
  return memo.value
}
function previewCanvasOwnsNode(node) {
  const nodeId = node?.id
  if (!nodeId) return false
  return previewFitExcludedNodeIds.value.includes(nodeId)
    || previewFitCommittedOverlayNodes.value.some(item => item?.id === nodeId)
}
function markPreviewCanvasDocumentDirty(changedNode = null) {
  if (!showPreview.value) return
  // 表单已由实时 DOM 层绘制时，其值变化不会改变下方静态 Canvas。
  if (changedNode && previewCanvasOwnsNode(changedNode)) return
  invalidatePreviewFitDocument()
  if (!previewCanvasRenderActive.value) return
  clearTimeout(previewCanvasDocumentRenderTimer)
  previewCanvasDocumentRenderTimer = setTimeout(() => {
    previewCanvasDocumentRenderTimer = 0
    if (!previewCanvasRenderActive.value) return
    requestPreviewFitDocumentRender()
  }, 80)
}
function handleFormChange(node, event) {
  markPreviewCanvasDocumentDirty(node)
  markDocumentInput()
  if (event?.type === 'button' && event.action === 'message') {
    buttonMessageDialog.value = {
      show: true,
      nodeId: node.id,
      title: node.text ? `${node.text}消息` : '按钮消息',
      message: String(event.message || node.actionMessage || '操作已执行')
    }
    return
  }
  if (event?.type !== 'radio' || !event.checked || !node.formName) return
  for (const other of nodes.value) {
    if (!showPreview.value && other.locked) continue
    if (other.id !== node.id && other.type === 'radio' && other.formName === node.formName) other.checked = false
  }
}
watch(hasServerTime, enabled => { if (enabled) syncServerTime(true) }, { immediate: true })
function resetFormPreviewState() {
  const selectedRadioGroups = new Set()
  for (const node of nodes.value) {
    if (['checkbox', 'radio', 'switch'].includes(node.type) || (node.type === 'button' && node.buttonAction === 'toggle')) {
      let checked = Boolean(node.defaultChecked)
      if (node.type === 'radio' && checked) {
        const group = node.formName || `radio-${node.id}`
        if (selectedRadioGroups.has(group)) checked = false
        else selectedRadioGroups.add(group)
      }
      node.checked = checked
    }
    if (['input', 'select'].includes(node.type)) node.value = String(node.defaultValue ?? node.value ?? '')
    if (node.type === 'button') { node.clickCount = 0; node.buttonFeedback = '' }
  }
}
function cloneEditorValue(value) {
  return cloneHistoryValue(toRaw(value))
}
function nodeBundleBounds(sourceNodes) {
  const frames = sourceNodes.map(nodeSelectionBounds)
  const minX = Math.min(...frames.map(frame => frame.x))
  const minY = Math.min(...frames.map(frame => frame.y))
  const maxX = Math.max(...frames.map(frame => frame.x + frame.w))
  const maxY = Math.max(...frames.map(frame => frame.y + frame.h))
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}
function createNodeBundle(sourceNodes) {
  if (!sourceNodes?.length) return null
  return captureNodeBundleSync({ nodes: sourceNodes, adjacency: edgeAdjacency.value, clone: cloneEditorValue })
}
function resetNodeInstanceState(node) {
  if (node.type === 'button') { node.clickCount = 0; node.buttonFeedback = '' }
  if (['checkbox', 'radio', 'switch'].includes(node.type) || (node.type === 'button' && node.buttonAction === 'toggle')) node.checked = Boolean(node.defaultChecked)
  if (['input', 'select'].includes(node.type)) node.value = String(node.defaultValue ?? node.value ?? '')
  return node
}
const bundleReadyInstances = new globalThis.Map()
const bundlePrewarmRequests = []
let nextBundleWorkToken = 1
let activeBundleActionToken = 0
let activeBundleOperationToken = null
let bundlePrewarmFrame = 0

function beginBundleAsyncOperation(label) {
  const token = workspaceAsyncOperationBarrier.begin(label)
  activeBundleOperationToken = token
  return token
}

function finishBundleAsyncOperation(payload = null) {
  const token = payload ? payload.operationToken : activeBundleOperationToken
  if (!token) return false
  if (activeBundleOperationToken === token) activeBundleOperationToken = null
  return workspaceAsyncOperationBarrier.end(token)
}

function bundleCapacityAllows(bundle) {
  const nodeCount = bundle?.nodes?.length || 0
  const edgeCount = bundle?.edges?.length || 0
  if (!nodeCount) return false
  if (nodes.value.length + drawings.value.length + nodeCount > MAX_PROJECT_NODES || edges.value.length + edgeCount > MAX_PROJECT_EDGES) {
    notify('添加失败，图纸组件或连线数量已达到上限')
    return false
  }
  return true
}

function bundleCaptureNeedsSlices(sourceNodes) {
  if (shouldPrepareNodeBundleAsync(sourceNodes?.length || 0)) return true
  let incidentEdges = 0
  for (const node of sourceNodes || []) {
    incidentEdges += edgeAdjacency.value.countFor(node.id)
    if (incidentEdges > 128) return true
  }
  return false
}

function pendingBundleFrame(bundle, x, y, token, kind = 'insert') {
  const requestedX = Number.isFinite(Number(x)) ? Number(x) : 0
  const requestedY = Number.isFinite(Number(y)) ? Number(y) : 0
  const { dx: originX, dy: originY } = constrainTranslation(
    [{ x: 0, y: 0, w: finiteNumber(bundle.width, 1), h: finiteNumber(bundle.height, 1) }],
    requestedX,
    requestedY,
    stageWidth.value,
    stageHeight.value
  )
  return {
    token,
    kind,
    x: originX,
    y: originY,
    w: Math.max(1, finiteNumber(bundle.width, 1)),
    h: Math.max(1, finiteNumber(bundle.height, 1))
  }
}

function commitPreparedNodeBundle(ready, payload) {
  if (!ready || ready.consumed || payload.documentVersion !== documentChangeVersion) return []
  if (payload.asyncCommit && !interactionPayloadIsCurrent(payload)) return []
  if (!bundleCapacityAllows(ready)) return []
  const { dx: originX, dy: originY } = constrainTranslation(
    [{ x: 0, y: 0, w: ready.width, h: ready.height }],
    payload.x,
    payload.y,
    stageWidth.value,
    stageHeight.value
  )
  const baseLayer = reserveEntityLayers(ready.nodes.length)
  ready.nodes.forEach((node, index) => {
    const rawNode = toRaw(node)
    rawNode.x = originX + finiteNumber(rawNode.x)
    rawNode.y = originY + finiteNumber(rawNode.y)
    rawNode.layer = baseLayer + index
  })
  ready.nodeSpatialIndex.setTranslation(originX, originY)
  ready.edgeSpatialIndex.setTranslation(originX, originY)

  const nodeInsertIndex = nodes.value.length
  const edgeInsertIndex = edges.value.length
  ready.historyEntry.nodes.forEach((record, index) => { record.index = nodeInsertIndex + index })
  ready.historyEntry.edges.forEach((record, index) => { record.index = edgeInsertIndex + index })

  nodeSpatialIndex.attach(ready.nodeSpatialIndex)
  edgeSpatialIndex.attach(ready.edgeSpatialIndex)
  edgeAdjacency.value.attach(ready.edgeAdjacency)
  // 粘贴和“我的组件”也必须登记源 JSONPath，并立即恢复数据源的最近快照。
  addRuntimeDataNodes(ready.nodes)
  entityLayerAllocator.commit(ready.nodes)

  for (const node of ready.nodes) nodeIndex.value.set(node.id, node)
  for (const [id, node] of ready.timeNodeIndex) timeNodeIndex.value.set(id, node)
  toRaw(nodes.value).push(...ready.nodes)
  toRaw(edges.value).push(...ready.edges)
  layerEntries.value.push(...ready.nodes.map(node => createLayerEntry('node', node)))
  ready.consumed = true
  recordHistory(ready.historyEntry, ready.historyBytes)

  triggerRef(nodeIndex)
  if (ready.timeNodeIndex.size) triggerRef(timeNodeIndex)
  triggerRef(layerEntries)
  triggerRef(nodes)
  if (ready.edges.length) triggerRef(edges)
  nodeSpatialRevision.value += 1
  edgeSpatialRevision.value += 1
  triggerRef(edgeAdjacency)
  paperSelected.value = false
  selectedDrawingId.value = null
  selectedNodeIds.value = ready.nodeIds
  selectedId.value = ready.nodeIds.at(-1) || null
  activeTool.value = 'select'
  scheduleDocumentIndexCompaction()
  return ready.nodes
}

function scheduleBundleFrame(callback) {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(() => callback(performance.now()), 16)
}

function cancelBundleFrame(handle) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle)
}

const bundleInstanceScheduler = createChunkedRenderScheduler({
  budgetMs: NODE_BUNDLE_FRAME_BUDGET_MS,
  schedule: scheduleBundleFrame,
  cancel: cancelBundleFrame,
  createTask(payload) {
    return createNodeBundleInstanceTask(payload.bundle, {
      createId: createEntityId,
      forceGroup: payload.forceGroup,
      unlock: payload.unlock,
      lineDefaults: payload.lineDefaults
    })
  },
  runSlice(task, deadline, payload) {
    if (!interactionPayloadIsCurrent(payload)) {
      payload.interactionInterrupted = true
      if (interactionCommitBarrier.state.active) return false
      payload.interactionGeneration = currentInteractionGeneration()
      if (payload.kind === 'insert') payload.documentVersion = documentChangeVersion
    }
    if (payload.documentVersion != null && payload.documentVersion !== documentChangeVersion) {
      task.stale = true
      return true
    }
    return runNodeBundleInstanceSlice(task, deadline)
  },
  commit(task, payload) {
    const ready = task.result
    if (!ready || task.stale) {
      if (activeBundleActionToken === payload.token) activeBundleActionToken = 0
      if (pendingBundleInsertion.value?.token === payload.token) pendingBundleInsertion.value = null
      finishBundleAsyncOperation(payload)
      scheduleBundlePrewarm()
      return
    }
    if (payload.kind === 'prewarm') {
      if (payload.isCurrent?.() !== false) bundleReadyInstances.set(payload.readyKey, ready)
      scheduleBundlePrewarm()
      return
    }
    try {
      const created = commitPreparedNodeBundle(ready, payload)
      if (activeBundleActionToken === payload.token) activeBundleActionToken = 0
      if (pendingBundleInsertion.value?.token === payload.token) pendingBundleInsertion.value = null
      if (created.length) payload.onCommit?.(created)
      if (payload.readyKey) scheduleBundlePrewarm()
    } finally {
      finishBundleAsyncOperation(payload)
    }
  },
  discard(task, payload) {
    if (activeBundleActionToken === payload?.token) activeBundleActionToken = 0
    if (pendingBundleInsertion.value?.token === payload?.token) pendingBundleInsertion.value = null
    finishBundleAsyncOperation(payload)
  }
})

function deferBundleCaptureRetry(payload) {
  interactionCommitBarrier.defer(BUNDLE_CAPTURE_RETRY, () => {
    if (activeBundleActionToken !== payload.token) return
    bundleCaptureScheduler.request({
      ...payload,
      documentVersion: documentChangeVersion,
      interactionGeneration: currentInteractionGeneration()
    })
  })
}

const bundleCaptureScheduler = createChunkedRenderScheduler({
  budgetMs: NODE_BUNDLE_FRAME_BUDGET_MS,
  schedule: scheduleBundleFrame,
  cancel: cancelBundleFrame,
  createTask: payload => createNodeBundleCaptureTask({
    nodes: payload.nodes,
    adjacency: edgeAdjacency.value,
    clone: cloneEditorValue,
    transformNode: payload.transformNode
  }),
  runSlice(task, deadline, payload) {
    if (!interactionPayloadIsCurrent(payload)) {
      task.interactionStale = true
      return true
    }
    if (payload.documentVersion !== documentChangeVersion) {
      task.stale = true
      return true
    }
    return runNodeBundleCaptureSlice(task, deadline)
  },
  commit(task, payload) {
    if (task.interactionStale || !interactionPayloadIsCurrent(payload)) {
      deferBundleCaptureRetry(payload)
      return
    }
    try {
      if (activeBundleActionToken === payload.token) activeBundleActionToken = 0
      if (pendingBundleInsertion.value?.token === payload.token) pendingBundleInsertion.value = null
      if (!task.stale && task.result) payload.onCommit?.(task.result)
    } finally {
      finishBundleAsyncOperation(payload)
    }
  },
  discard(task, payload) {
    if (activeBundleActionToken === payload?.token) activeBundleActionToken = 0
    if (pendingBundleInsertion.value?.token === payload?.token) pendingBundleInsertion.value = null
    finishBundleAsyncOperation(payload)
  }
})

let indexCompactionRetryTimer = 0
const documentIndexCompactionScheduler = createChunkedRenderScheduler({
  budgetMs: NODE_BUNDLE_FRAME_BUDGET_MS,
  schedule: scheduleBundleFrame,
  cancel: cancelBundleFrame,
  createTask(payload) {
    const compactNodeSpatialIndex = createSpatialIndex([], { cellSize: 512 })
    return {
      phase: 'nodes',
      index: 0,
      nodeSpatialIndex: compactNodeSpatialIndex,
      edgeAdjacency: createEdgeAdjacencyIndex(),
      edgeSpatialIndex: createSpatialIndex([], {
        cellSize: 512,
        getBounds: edge => edgeBoundsForNodes(edge, payload.nodeMap)
      }),
      stale: false
    }
  },
  runSlice(task, deadline, payload) {
    if (!interactionPayloadIsCurrent(payload)) {
      task.interactionStale = true
      return true
    }
    if (payload.documentVersion !== documentChangeVersion) {
      task.stale = true
      return true
    }
    let operations = 0
    while (operations < 8192 && !deadline.shouldYield()) {
      if (task.phase === 'nodes') {
        if (task.index < payload.nodes.length) task.nodeSpatialIndex.update(payload.nodes[task.index++])
        if (task.index >= payload.nodes.length) {
          task.phase = 'edges'
          task.index = 0
        }
      } else if (task.phase === 'edges') {
        if (task.index < payload.edges.length) {
          const edge = payload.edges[task.index++]
          task.edgeAdjacency.add([edge])
          task.edgeSpatialIndex.update(edge)
        }
        if (task.index >= payload.edges.length) task.phase = 'done'
      }
      operations += 1
      if (task.phase === 'done') return true
    }
    return task.phase === 'done'
  },
  commit(task, payload) {
    if (task.interactionStale || !interactionPayloadIsCurrent(payload)) {
      interactionCommitBarrier.defer(DOCUMENT_INDEX_COMPACTION_RETRY, scheduleDocumentIndexCompaction)
      return
    }
    if (task.stale || payload.documentVersion !== documentChangeVersion) {
      clearTimeout(indexCompactionRetryTimer)
      indexCompactionRetryTimer = setTimeout(scheduleDocumentIndexCompaction, 100)
      return
    }
    nodeSpatialIndex = task.nodeSpatialIndex
    edgeSpatialIndex = task.edgeSpatialIndex
    edgeAdjacency.value = task.edgeAdjacency
    documentIndexRebuildRequired = false
    nodeSpatialRevision.value += 1
    edgeSpatialRevision.value += 1
  }
})

function scheduleDocumentIndexCompaction() {
  clearTimeout(indexCompactionRetryTimer)
  indexCompactionRetryTimer = 0
  const hasSegments = (nodeSpatialIndex.state?.segments || 0)
    || (edgeSpatialIndex.state?.segments || 0)
    || (edgeAdjacency.value.state?.segments || 0)
  if (!hasSegments && !documentIndexRebuildRequired) return
  if (interactionCommitBarrier.state.active) {
    interactionCommitBarrier.defer(DOCUMENT_INDEX_COMPACTION_RETRY, scheduleDocumentIndexCompaction)
    return
  }
  interactionCommitBarrier.cancelDeferred(DOCUMENT_INDEX_COMPACTION_RETRY)
  documentIndexCompactionScheduler.request({
    documentVersion: documentChangeVersion,
    interactionGeneration: currentInteractionGeneration(),
    nodes: nodes.value,
    edges: edges.value,
    nodeMap: nodeIndex.value
  })
}

function customReadyKey(item) {
  return `custom:${item.id}:${item.nodes.length}:${item.edges.length}:${item.createdAt || ''}`
}

function scheduleBundlePrewarm() {
  if (bundlePrewarmFrame || pendingBundleInsertion.value || bundleInstanceScheduler.state.pending) return
  bundlePrewarmFrame = scheduleBundleFrame(() => {
    bundlePrewarmFrame = 0
    if (pendingBundleInsertion.value || bundleInstanceScheduler.state.pending) return
    let request = null
    while (bundlePrewarmRequests.length && !request) {
      const candidate = bundlePrewarmRequests.shift()
      if (candidate.isCurrent?.() !== false && !bundleReadyInstances.has(candidate.readyKey)) request = candidate
    }
    if (!request) {
      const item = customComponents.value.find(entry => !bundleReadyInstances.has(customReadyKey(entry)))
      if (!item) return
      request = {
        bundle: item,
        readyKey: customReadyKey(item),
        forceGroup: item.nodes.length > 1,
        unlock: true,
        isCurrent: () => customComponents.value.includes(item) && customReadyKey(item) === request.readyKey
      }
    }
    bundleInstanceScheduler.request({
      kind: 'prewarm',
      bundle: request.bundle,
      readyKey: request.readyKey,
      forceGroup: request.forceGroup,
      unlock: request.unlock,
      lineDefaults: currentLineDefaults(),
      interactionGeneration: currentInteractionGeneration(),
      isCurrent: request.isCurrent
    })
  })
}

function queueBundlePrewarm(request) {
  if (!request?.readyKey || bundleReadyInstances.has(request.readyKey)) return
  if (!bundlePrewarmRequests.some(item => item.readyKey === request.readyKey)) bundlePrewarmRequests.push(request)
  scheduleBundlePrewarm()
}

function cancelPendingBundleWork(reason = 'invalidated') {
  finishBundleAsyncOperation()
  bundleCaptureScheduler.invalidate(reason)
  bundleInstanceScheduler.invalidate(reason)
  documentIndexCompactionScheduler.invalidate(reason)
  clearTimeout(indexCompactionRetryTimer)
  indexCompactionRetryTimer = 0
  interactionCommitBarrier.cancelDeferred(BUNDLE_CAPTURE_RETRY)
  interactionCommitBarrier.cancelDeferred(DOCUMENT_INDEX_COMPACTION_RETRY)
  activeBundleActionToken = 0
  pendingBundleInsertion.value = null
}

function supersedePendingBundleAction(reason) {
  finishBundleAsyncOperation()
  bundleCaptureScheduler.invalidate(reason)
  bundleInstanceScheduler.invalidate(reason)
  interactionCommitBarrier.cancelDeferred(BUNDLE_CAPTURE_RETRY)
  activeBundleActionToken = 0
  pendingBundleInsertion.value = null
}

function captureNodeBundleForAction(sourceNodes, options = {}) {
  if (!sourceNodes?.length) return false
  supersedePendingBundleAction('capture-requested')
  if (!bundleCaptureNeedsSlices(sourceNodes)) {
    const bundle = createNodeBundle(sourceNodes)
    if (bundle && options.transformNode) bundle.nodes = bundle.nodes.map(options.transformNode)
    if (bundle) options.onCommit?.(bundle)
    return Boolean(bundle)
  }
  const token = nextBundleWorkToken++
  activeBundleActionToken = token
  const operationToken = beginBundleAsyncOperation(`bundle-${options.kind || 'capture'}`)
  const bounds = options.bounds || selectedNodeBounds.value
  if (bounds) {
    pendingBundleInsertion.value = {
      token,
      kind: options.kind || 'capture',
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h
    }
  }
  try {
    bundleCaptureScheduler.request({
      token,
      operationToken,
      nodes: sourceNodes,
      documentVersion: documentChangeVersion,
      interactionGeneration: currentInteractionGeneration(),
      transformNode: options.transformNode,
      onCommit: options.onCommit
    })
  } catch (error) {
    finishBundleAsyncOperation({ operationToken })
    throw error
  }
  return true
}

function instantiateNodeBundle(bundle, x, y, { forceGroup = false, unlock = true, readyKey = '', onCommit = null } = {}) {
  supersedePendingBundleAction('insert-requested')
  if (!bundleCapacityAllows(bundle)) return []
  const token = nextBundleWorkToken++
  const payload = {
    kind: 'insert',
    token,
    bundle,
    x: Number.isFinite(Number(x)) ? Number(x) : 0,
    y: Number.isFinite(Number(y)) ? Number(y) : 0,
    forceGroup,
    unlock,
    readyKey,
    onCommit,
    lineDefaults: currentLineDefaults(),
    documentVersion: documentChangeVersion,
    interactionGeneration: currentInteractionGeneration()
  }
  const ready = readyKey ? bundleReadyInstances.get(readyKey) : null
  if (ready) {
    bundleReadyInstances.delete(readyKey)
    const created = commitPreparedNodeBundle(ready, payload)
    if (created.length) onCommit?.(created)
    scheduleBundlePrewarm()
    return created
  }
  if (!shouldPrepareNodeBundleAsync(bundle.nodes.length, bundle.edges?.length || 0)) {
    const prepared = prepareNodeBundleInstanceSync(bundle, {
      createId: createEntityId,
      forceGroup,
      unlock,
      lineDefaults: payload.lineDefaults
    })
    const created = commitPreparedNodeBundle(prepared, payload)
    if (created.length) onCommit?.(created)
    return created
  }
  pendingBundleInsertion.value = pendingBundleFrame(bundle, payload.x, payload.y, token)
  activeBundleActionToken = token
  payload.asyncCommit = true
  payload.operationToken = beginBundleAsyncOperation('bundle-insert')
  try {
    bundleInstanceScheduler.request(payload)
  } catch (error) {
    finishBundleAsyncOperation(payload)
    throw error
  }
  return []
}
function groupSelectedNodes() {
  const ids = new Set(selectedNodeIds.value)
  const groupIds = new Set(selectedNodes.value.map(node => node.groupId).filter(Boolean))
  if (groupIds.size) nodes.value.forEach(node => { if (groupIds.has(node.groupId)) ids.add(node.id) })
  const groupNodes = nodes.value.filter(node => ids.has(node.id))
  if (groupNodes.length < 2) return notify('请先按住 Ctrl 选择至少两个组件')
  if (groupNodes.some(node => node.locked)) return notify('组件已锁定，请先解锁后组合')
  recordNodeFields(groupNodes, ['groupId'])
  const groupId = createEntityId('group')
  groupNodes.forEach(node => { node.groupId = groupId })
  setNodeSelection(groupNodes.map(node => node.id), selectedId.value)
  notify(`已组合 ${groupNodes.length} 个组件`)
}
function ungroupSelectedNodes() {
  const groupIds = new Set(selectedNodes.value.map(node => node.groupId).filter(Boolean))
  if (!groupIds.size) return notify('选中的组件尚未组合')
  const selectedIds = new Set(selectedNodeIds.value)
  const affected = nodes.value.filter(node => groupIds.has(node.groupId))
  if (affected.some(node => node.locked)) return notify('组件已锁定，请先解锁后取消组合')
  affected.forEach(node => selectedIds.add(node.id))
  recordNodeFields(affected, ['groupId'])
  affected.forEach(node => { node.groupId = null })
  setNodeSelection([...selectedIds], selectedId.value)
  notify(`已解绑 ${affected.length} 个组件`)
}
function uniqueCustomComponentName(value) {
  const base = String(value || '自定义组件').trim().slice(0, 56) || '自定义组件'
  const names = new Set(customComponents.value.map(item => item.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}
function customComponentCapacityAllows(bundle) {
  if (customComponents.value.length >= MAX_CUSTOM_COMPONENTS) return notify(`“我的”最多保存 ${MAX_CUSTOM_COMPONENTS} 个组件`)
  const currentNodeCount = customComponents.value.reduce((total, item) => total + item.nodes.length, 0)
  const currentEdgeCount = customComponents.value.reduce((total, item) => total + item.edges.length, 0)
  if (currentNodeCount + bundle.nodes.length > MAX_CUSTOM_COMPONENT_NODES || currentEdgeCount + bundle.edges.length > MAX_CUSTOM_COMPONENT_EDGES) return notify('我的组件库已达到图纸容量上限')
  return true
}
function focusCustomComponentNameInput(selectAll = false) {
  nextTick(() => {
    if (!customComponentDialog.value.show) return
    const input = customComponentNameInput.value
    input?.focus({ preventScroll: true })
    if (selectAll && input) input.setSelectionRange(0, input.value.length)
  })
}
function addSelectionToMyLibrary() {
  if (selectedNodesContainLocked.value) return notify('组件已锁定，请先解锁后添加到我的组件')
  const sourceNodes = selectedNodes.value
  if (!sourceNodes.length) return notify('请先选择组件')
  const suggestedName = selectedNodeCount.value > 1 ? `${nodeDisplayName(selected.value)}组合` : nodeDisplayName(selected.value)
  captureNodeBundleForAction(sourceNodes, {
    kind: 'library',
    bounds: selectedNodeBounds.value,
    transformNode(source) {
      return resetNodeInstanceState(normalizeNode({ ...source, locked: false, groupId: null }))
    },
    onCommit(bundle) {
      if (!customComponentCapacityAllows(bundle)) return
      customComponentNameComposing.value = false
      customComponentDialog.value = {
        show: true,
        name: uniqueCustomComponentName(suggestedName),
        bundle
      }
      focusCustomComponentNameInput(true)
    }
  })
}
function closeCustomComponentDialog() {
  customComponentNameComposing.value = false
  customComponentDialog.value = { show: false, name: '', bundle: null }
}
function handleCustomComponentNameKeydown(event) {
  if (isImeCompositionEvent(event, customComponentNameComposing.value)) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    closeCustomComponentDialog()
    return
  }
  if (event.key !== 'Enter') return
  event.stopPropagation()
  event.preventDefault()
  confirmCustomComponent()
}
function confirmCustomComponent() {
  const bundle = customComponentDialog.value.bundle
  const requestedName = String(customComponentDialog.value.name || '').trim()
  if (!bundle || !requestedName) {
    focusCustomComponentNameInput()
    return
  }
  if (!customComponentCapacityAllows(bundle)) return
  const name = uniqueCustomComponentName(requestedName)
  const item = {
    id: createEntityId('custom'),
    name,
    width: bundle.width,
    height: bundle.height,
    nodes: bundle.nodes,
    edges: bundle.edges,
    createdAt: new Date().toISOString()
  }
  recordCustomComponentInsertion([item])
  customComponents.value.push(item)
  closeCustomComponentDialog()
  notify(`“${name}”已添加到我的组件`)
  scheduleBundlePrewarm()
}
function instantiateCustomComponent(id, x = 350, y = 220) {
  const item = customComponents.value.find(entry => entry.id === id)
  if (!item) return notify('自定义组件不存在')
  instantiateNodeBundle(item, x, y, {
    forceGroup: item.nodes.length > 1,
    unlock: true,
    readyKey: customReadyKey(item),
    onCommit: () => notify(`已添加“${item.name}”`)
  })
}
function deleteCustomComponent(id) {
  const index = customComponents.value.findIndex(entry => entry.id === id)
  if (index < 0) return
  const item = customComponents.value[index]
  bundleReadyInstances.delete(customReadyKey(item))
  recordCustomComponentRemoval([item])
  customComponents.value.splice(index, 1)
  notify(`已从我的组件删除“${item.name}”`)
  scheduleBundlePrewarm()
}
const libraryDragImages = new Map()
function libraryDragImage(kind = 'component') {
  if (libraryDragImages.has(kind)) return libraryDragImages.get(kind)
  if (typeof document === 'undefined') return null
  const image = document.createElement('canvas')
  image.width = 44
  image.height = 32
  const context = image.getContext('2d')
  if (!context) return null
  context.strokeStyle = '#168eea'
  context.lineWidth = 2
  context.setLineDash([4, 3])
  if (kind === 'circle') {
    context.beginPath()
    context.arc(22, 16, 11, 0, Math.PI * 2)
    context.stroke()
  } else {
    context.strokeRect(8, 5, 28, 22)
  }
  libraryDragImages.set(kind, image)
  return image
}
function configureLibraryDrag(event, format, value, previewKind = 'component') {
  const transfer = event.dataTransfer
  if (!transfer) return
  transfer.effectAllowed = 'copy'
  transfer.setData(format, value)
  const image = libraryDragImage(previewKind)
  if (image && typeof transfer.setDragImage === 'function') transfer.setDragImage(image, 22, 16)
}
function dragStartItem(event, type) { configureLibraryDrag(event, 'shape', type, type) }
function dragStartCustomComponent(event, id) { configureLibraryDrag(event, 'application/x-tc2d-custom-component', id) }
function addCatalogItem(item) {
  if (!isPolylineNodeType(item.type)) addNode(item.type)
}
function handleCatalogItemDoubleClick(item) {
  if (!isPolylineNodeType(item.type)) addCatalogItem(item)
}
function catalogItemTitle(item) {
  return isPolylineNodeType(item.type) ? `拖到画布确定${item.name}起始点` : `拖动或双击添加${item.name}`
}
const signalColorDefaults = ['#21c58e', '#ef5350', '#ffc440', '#168eea', '#9c5de5', '#ffffff', '#26323d', '#ff7a45']
function setSignalColorCount(value) {
  if (!selected.value || selected.value.locked) return
  const count = Math.max(1, Math.min(MAX_SIGNAL_COLORS, Math.trunc(Number(value) || 2)))
  selected.value.signalColorCount = count
  if (!Array.isArray(selected.value.signalColors)) selected.value.signalColors = []
  while (selected.value.signalColors.length < count) selected.value.signalColors.push(signalColorDefaults[selected.value.signalColors.length])
}
function dropItem(e) {
  // 拖放发生在滚轮停顿窗口内时先提交投影比例，确保落点和随后的组件渲染使用同一坐标系。
  cancelPendingCanvasZoom()
  const p = pointFromEvent(e)
  const customId = e.dataTransfer.getData('application/x-tc2d-custom-component')
  if (customId) {
    const item = customComponents.value.find(entry => entry.id === customId)
    if (item) instantiateCustomComponent(customId, p.x - item.width / 2, p.y - item.height / 2)
    return
  }
  const type = e.dataTransfer.getData('shape')
  if (isPolylineNodeType(type)) {
    cancelPolylineDrawing()
    setTool(type)
    addPolylinePoint(e)
    return
  }
  if (type) addNode(type, p.x - 70, p.y - 35)
}

function setTool(id) {
  if (id === 'dataSource') {
    dataSourceManagerOpen.value = true
    return
  }
  paperSelected.value = false
  editingFormId.value = null
  if (id === 'map') { showMiniMap.value = !showMiniMap.value; notify(showMiniMap.value ? '鹰眼地图已打开' : '鹰眼地图已关闭'); return }
  if (!isPolylineNodeType(id)) cancelPolylineDrawing()
  activeTool.value = id; setConnectionAnchor(null)
}

function handleDataSourceChanged() {
  dataSourceRevision.value += 1
}
function closeDataSourceManager() {
  dataSourceManagerOpen.value = false
}
function handleLockedBadgePointerDown(e, node) {
  if (activeTool.value === 'pencil') startPencilDrawing(e)
  else if (isPolylineNodeType(activeTool.value)) addPolylinePoint(e)
  else selectSingleNode(node)
}
const TABLE_DOUBLE_POINTER_DELAY = 650
const TABLE_DOUBLE_POINTER_DISTANCE = 12
const NODE_DRAG_START_DISTANCE = 4
let lastTablePointerDown = null
function canStartNodeTextEdit(node) {
  return activeTool.value === 'select' && !node.locked && !['lineShape', 'pencil'].includes(node.type) && !isPolylineNodeType(node.type)
}
function consumeTableDoublePointerDown(e, node) {
  if (node.type !== 'table' || !canStartNodeTextEdit(node) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
    lastTablePointerDown = null
    return false
  }
  const current = { id: node.id, at: Date.now(), x: e.clientX, y: e.clientY }
  const previous = lastTablePointerDown
  lastTablePointerDown = current
  if (!previous || previous.id !== current.id || current.at - previous.at > TABLE_DOUBLE_POINTER_DELAY) return false
  if (Math.hypot(current.x - previous.x, current.y - previous.y) > TABLE_DOUBLE_POINTER_DISTANCE) return false
  lastTablePointerDown = null
  return true
}
function startPencilDrawing(e) {
  if (e.button !== 0 || activeTool.value !== 'pencil' || operation.value) return false
  e.preventDefault()
  lastTablePointerDown = null
  paperSelected.value = false
  editingFormId.value = null
  selectedDrawingId.value = null
  clearNodeSelection()
  if (nodes.value.length + drawings.value.length >= MAX_PROJECT_NODES || drawings.value.length >= MAX_PROJECT_DRAWINGS) {
    notify(`图纸最多支持 ${MAX_PROJECT_NODES} 个组件和线稿`)
    return true
  }
  const point = pointFromEvent(e)
  const drawing = {
    id: createEntityId('drawing'),
    layer: reserveEntityLayers(),
    points: [point],
    color: lineColor.value,
    width: lineWidth.value,
    dash: false,
    opacity: 1,
    smooth: true,
    closed: false,
    locked: false,
    lineCap: 'round',
    lineJoin: 'round'
  }
  const [insertedDrawing] = appendDrawings(drawing)
  selectedDrawingId.value = insertedDrawing.id
  beginPointerOperation(e, { type: 'draw', id: drawing.id, historyCommitted: true })
  return true
}
function canvasPointerDown(e) {
  if (operation.value) return
  cancelPendingCanvasZoom()
  if (activeTool.value === 'select' && e.button === 1) {
    e.preventDefault()
    if (!canvasLocked.value) beginPointerOperation(e, { type: 'pan', sx: e.clientX, sy: e.clientY, left: canvas.value.scrollLeft, top: canvas.value.scrollTop })
    return
  }
  if (e.button !== 0) return
  if (startPencilDrawing(e)) return
  if (addPolylinePoint(e)) return
  if (e.target.closest?.('.node-shell, .drawing-hit')) return
  const lodHit = editorLodEntityFromEvent(e)
  if (lodHit?.kind === 'node') {
    nodePointerDown(e, lodHit.entity)
    return
  }
  if (lodHit?.kind === 'drawing') {
    drawingPointerDown(e, lodHit.entity)
    return
  }
  lastTablePointerDown = null
  paperSelected.value = false
  editingFormId.value = null
  selectedDrawingId.value = null
  if (activeTool.value === 'select') {
    if (e.altKey) {
      e.preventDefault()
      if (!canvasLocked.value) beginPointerOperation(e, { type: 'pan', sx: e.clientX, sy: e.clientY, left: canvas.value.scrollLeft, top: canvas.value.scrollTop })
      return
    }
    const start = pointFromEvent(e)
    const additive = e.ctrlKey || e.metaKey || e.shiftKey
    const baseIds = additive ? [...selectedNodeIds.value] : []
    const basePrimaryId = additive ? selectedId.value : null
    if (!additive) clearNodeSelection()
    selectionMarquee.value = { x: start.x, y: start.y, w: 0, h: 0 }
    beginPointerOperation(e, { type: 'selectNodes', start, baseIds, basePrimaryId })
    return
  }
  clearNodeSelection()
}
function nodePointerDown(e, n) {
  if (e.button !== 0) return
  e.stopPropagation()
  if (startPencilDrawing(e)) return
  if (addPolylinePoint(e)) return
  if (consumeTableDoublePointerDown(e, n)) {
    e.preventDefault()
    if (operation.value) pointerUp()
    void startTextEdit(e, n)
    return
  }
  if (operation.value) return
  paperSelected.value = false
  selectedDrawingId.value = null
  if (editingFormId.value !== n.id) editingFormId.value = null
  if (activeTool.value === 'select' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    e.preventDefault()
    toggleNodeSelection(n)
    return
  }
  if (isNodeSelected(n.id)) setNodeSelection(selectedNodeIds.value, n.id)
  else selectSingleNode(n)
  if (n.locked && activeTool.value !== 'select') return
  if (activeTool.value === 'line') {
    if (connectFrom.value && connectFrom.value !== n.id) {
      if (edges.value.length >= MAX_PROJECT_EDGES) { setConnectionAnchor(null); return notify(`图纸最多支持 ${MAX_PROJECT_EDGES} 条连线`) }
      const edge = normalizeEdge({ id: createEntityId('edge'), from: connectFrom.value, to: n.id }, currentLineDefaults())
      recordEntityInsertion({ nodes: [], edges: [edge], drawings: [] })
      appendEdges(edge); setConnectionAnchor(null); notify('连线已创建')
    } else { setConnectionAnchor(n.id); notify('请选择目标组件') }
    return
  }
  if (activeTool.value !== 'select') return
  const movingNodes = selectedNodes.value
  if (movingNodes.some(node => node.locked)) {
    if (!n.locked) notify('组合中包含锁定组件，请先解锁后移动')
    return
  }
  const transientLargeSelection = movingNodes.length > LARGE_SELECTION_TRANSFORM_THRESHOLD
  if (!transientLargeSelection) {
    normalizeNodesTogether(movingNodes, stageWidth.value, stageHeight.value, { commonTranslation: true })
    updateNodeSpatialIndex(movingNodes)
  }
  const items = movingNodes.map(selectedNodeTransformItem)
  const bounds = { ...(selectedNodeBounds.value || nodeBundleBounds(movingNodes)) }
  const translationMinimum = transientLargeSelection
    ? constrainNodeCollectionTranslation(items, -Number.MAX_VALUE, -Number.MAX_VALUE, stageWidth.value, stageHeight.value)
    : null
  const translationMaximum = transientLargeSelection
    ? constrainNodeCollectionTranslation(items, Number.MAX_VALUE, Number.MAX_VALUE, stageWidth.value, stageHeight.value)
    : null
  beginPointerOperation(e, {
    type: 'moveNodes',
    anchorId: n.id,
    sx: e.clientX,
    sy: e.clientY,
    deferPointerCapture: true,
    nodeMoveInteractionActive: false,
    items,
    anchorItem: items.find(item => item.id === n.id) || items[0],
    bounds,
    transientLargeSelection,
    translationRange: transientLargeSelection ? {
      minimumX: translationMinimum.dx,
      maximumX: translationMaximum.dx,
      minimumY: translationMinimum.dy,
      maximumY: translationMaximum.dy
    } : null
  })
}
async function startTextEdit(e, node) {
  e.stopPropagation()
  if (!canStartNodeTextEdit(node)) return
  selectSingleNode(node)
  if (formTypeIds.has(node.type)) {
    editingText.value = null
    if (node.type === 'table') openTableDataEditor(node)
    else editingFormId.value = node.id
    return
  }
  editingFormId.value = null
  inlineTextComposing.value = false
  editingText.value = { id: node.id, original: node.text }
  await nextTick()
  const editor = Array.isArray(textEditor.value) ? textEditor.value[0] : textEditor.value
  editor?.focus({ preventScroll: true })
  if (editor) editor.setSelectionRange(0, editor.value.length)
}
function handleNodeDoubleClick(e, node) {
  if (isPolylineNodeType(activeTool.value)) {
    finishPolylineDrawing(e)
    return
  }
  if (!node.locked) return startTextEdit(e, node)
  if (activeTool.value !== 'select') return
  e.stopPropagation()
  selectSingleNode(node)
  notify('组件已锁定，请使用属性栏或右键菜单解锁')
}
function handleCanvasDoubleClick(e) {
  if (editorLodActive.value && !e.target.closest?.('.node-shell, .drawing-hit')) {
    const hit = editorLodEntityFromEvent(e)
    if (hit?.kind === 'node') return handleNodeDoubleClick(e, hit.entity)
  }
  finishPolylineDrawing(e)
}
function finishTextEdit(cancel = false) {
  inlineTextComposing.value = false
  if (!editingText.value) return
  const original = editingText.value.original
  const node = nodeIndex.value.get(editingText.value.id)
  const changed = Boolean(node && node.text !== original)
  if (cancel && node) node.text = original
  editingText.value = null
  if (changed && !cancel) recordHistory({ kind: 'fields', nodes: [{ id: node.id, values: { text: original } }], drawings: [] })
  else markMiniMapDirty()
}
function drawingPointerDown(e, drawing) {
  if (e.button !== 0) return
  e.stopPropagation()
  if (startPencilDrawing(e)) return
  if (addPolylinePoint(e)) return
  if (operation.value) return
  paperSelected.value = false; editingFormId.value = null; clearNodeSelection(); selectedDrawingId.value = drawing.id
  if (activeTool.value !== 'select' || drawing.locked) return
  beginPointerOperation(e, { type: 'moveDrawing', id: drawing.id, sx: e.clientX, sy: e.clientY, bounds: drawingBounds(drawing), points: drawing.points.map(point => ({ ...point })) })
}
function drawingPointsToBounds(sourcePoints, sourceBounds, targetBounds) {
  const sourceWidth = Math.max(1, sourceBounds.w)
  const sourceHeight = Math.max(1, sourceBounds.h)
  return sourcePoints.map(point => ({
    x: targetBounds.x + (point.x - sourceBounds.x) / sourceWidth * targetBounds.w,
    y: targetBounds.y + (point.y - sourceBounds.y) / sourceHeight * targetBounds.h
  }))
}
function drawingPointsChanged(drawing, points) {
  return drawing.points.length !== points.length || points.some((point, index) => Math.abs(point.x - drawing.points[index].x) > 1e-8 || Math.abs(point.y - drawing.points[index].y) > 1e-8)
}
function startDrawingResize(e, drawing, direction) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  if (drawing.locked || operation.value) return
  beginPointerOperation(e, {
    type: 'resizeDrawing',
    id: drawing.id,
    direction,
    sx: e.clientX,
    sy: e.clientY,
    bounds: drawingBounds(drawing),
    points: drawing.points.map(point => ({ ...point }))
  })
}
function setSelectedDrawingMetric(metric, rawValue) {
  const drawing = selectedDrawing.value
  if (!drawing || drawing.locked) return
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  const bounds = drawingBounds(drawing)
  const target = { ...bounds }
  if (metric === 'x' || metric === 'y') {
    const requestedDx = metric === 'x' ? value - bounds.x : 0
    const requestedDy = metric === 'y' ? value - bounds.y : 0
    const { dx, dy } = constrainTranslation([bounds], requestedDx, requestedDy, stageWidth.value, stageHeight.value)
    target.x += dx
    target.y += dy
  } else if (metric === 'w') {
    target.w = clampNumber(value, 1, MAX_EDITOR_STAGE_SIZE)
  } else if (metric === 'h') {
    target.h = clampNumber(value, 1, MAX_EDITOR_STAGE_SIZE)
  } else return
  const points = drawingPointsToBounds(drawing.points, bounds, target)
  if (!drawingPointsChanged(drawing, points)) return
  recordHistory({ kind: 'geometry', nodes: [], drawings: [{ id: drawing.id, points: drawing.points.map(point => ({ ...point })) }] })
  drawing.points = points
  updateDrawingIndex(drawing)
}
function normalizeSelectedNodeGeometry() {
  const node = selected.value
  if (!node || node.locked || selectedNodeCount.value !== 1) return
  Object.assign(node, normalizeNodeGeometry(node, stageWidth.value, stageHeight.value))
  updateNodeSpatialIndex(node)
}
function scaleLimitForExponent(ratio, exponent, fallback) {
  if (exponent <= 1e-10) return fallback
  return Math.pow(Math.max(1e-12, ratio), 1 / exponent)
}
function selectedNodesScaleLimits(items) {
  return items.reduce((limits, item) => {
    const size = nodeMinimumSize(item)
    const width = Math.max(size.w, finiteNumber(item.w, size.w))
    const height = Math.max(size.h, finiteNumber(item.h, size.h))
    const { parallel, cross } = rotationScaleWeights(item.rotate)
    const minimumWidthRatio = size.w / width
    const minimumHeightRatio = size.h / height
    const maximumWidthRatio = MAX_EDITOR_STAGE_SIZE / width
    const maximumHeightRatio = MAX_EDITOR_STAGE_SIZE / height
    limits.x.minimum = Math.max(limits.x.minimum, scaleLimitForExponent(minimumWidthRatio, parallel, 0), scaleLimitForExponent(minimumHeightRatio, cross, 0))
    limits.x.maximum = Math.min(limits.x.maximum, scaleLimitForExponent(maximumWidthRatio, parallel, Infinity), scaleLimitForExponent(maximumHeightRatio, cross, Infinity))
    limits.y.minimum = Math.max(limits.y.minimum, scaleLimitForExponent(minimumWidthRatio, cross, 0), scaleLimitForExponent(minimumHeightRatio, parallel, 0))
    limits.y.maximum = Math.min(limits.y.maximum, scaleLimitForExponent(maximumWidthRatio, cross, Infinity), scaleLimitForExponent(maximumHeightRatio, parallel, Infinity))
    limits.uniform.minimum = Math.max(limits.uniform.minimum, minimumWidthRatio, minimumHeightRatio)
    limits.uniform.maximum = Math.min(limits.uniform.maximum, maximumWidthRatio, maximumHeightRatio)
    return limits
  }, {
    x: { minimum: 0, maximum: Infinity },
    y: { minimum: 0, maximum: Infinity },
    uniform: { minimum: 0, maximum: Infinity }
  })
}
function selectedNodesMinimumBounds(items, bounds, direction = '', preparedLimits = null) {
  const limits = preparedLimits || selectedNodesScaleLimits(items)
  const useUniformScale = direction.length === 2
  const minimumHeight = items.every(item => nodeMinimumSize(item).h < 1) ? .1 : 1
  return {
    w: Math.max(1, bounds.w * (useUniformScale ? limits.uniform.minimum : limits.x.minimum)),
    h: Math.max(minimumHeight, bounds.h * (useUniformScale ? limits.uniform.minimum : limits.y.minimum))
  }
}
function selectedNodesMaximumBounds(items, bounds, direction = '', preparedLimits = null) {
  const limits = preparedLimits || selectedNodesScaleLimits(items)
  const useUniformScale = direction.length === 2
  const widthScale = Math.max(1, Math.min(Math.max(MAX_EDITOR_STAGE_SIZE, bounds.w) / bounds.w, useUniformScale ? limits.uniform.maximum : limits.x.maximum))
  const heightScale = Math.max(1, Math.min(Math.max(MAX_EDITOR_STAGE_SIZE, bounds.h) / bounds.h, useUniformScale ? limits.uniform.maximum : limits.y.maximum))
  return { w: bounds.w * widthScale, h: bounds.h * heightScale }
}
function selectedNodeTransformItem(node) {
  return {
    id: node.id,
    groupId: node.groupId,
    type: node.type,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    rotate: node.rotate || 0,
    visualScaleX: normalizedVisualScale(node.visualScaleX, node.w),
    visualScaleY: normalizedVisualScale(node.visualScaleY, node.h)
  }
}
function nodeItemsGeometryChanged(items) {
  return items.some(item => {
    const node = nodeIndex.value.get(item.id)
    return node && (Math.abs(node.x - item.x) > 1e-8 || Math.abs(node.y - item.y) > 1e-8 || Math.abs(node.w - item.w) > 1e-8 || Math.abs(node.h - item.h) > 1e-8 || Math.abs((Number(node.rotate) || 0) - (Number(item.rotate) || 0)) > 1e-8 || Math.abs(normalizedVisualScale(node.visualScaleX) - normalizedVisualScale(item.visualScaleX)) > 1e-8 || Math.abs(normalizedVisualScale(node.visualScaleY) - normalizedVisualScale(item.visualScaleY)) > 1e-8)
  })
}
function applyNodeItemsGeometry(items, publish = true) {
  const changedNodes = []
  for (const item of items) {
    const node = nodeIndex.value.get(item.id)
    if (node) {
      Object.assign(node, {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        rotate: item.rotate,
        visualScaleX: Object.hasOwn(item, 'visualScaleX') ? normalizedVisualScale(item.visualScaleX, item.w) : node.visualScaleX,
        visualScaleY: Object.hasOwn(item, 'visualScaleY') ? normalizedVisualScale(item.visualScaleY, item.h) : node.visualScaleY
      })
      changedNodes.push(node)
    }
  }
  return updateNodeSpatialIndex(changedNodes, publish)
}
function setSelectedNodesMetric(metric, rawValue) {
  const bounds = selectedNodeBounds.value
  if (!bounds || selectedNodeCount.value < 2) return
  if (selectedNodesContainLocked.value) return notify('组合中包含锁定组件，请先解锁后调整')
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  const items = selectedNodes.value.map(selectedNodeTransformItem)
  if (metric === 'x' || metric === 'y') {
    const requestedDx = metric === 'x' ? value - bounds.x : 0
    const requestedDy = metric === 'y' ? value - bounds.y : 0
    const translation = constrainNodeCollectionTranslation(items, requestedDx, requestedDy, stageWidth.value, stageHeight.value)
    if (!translation.feasible) return
    const { dx, dy } = translation
    const translated = items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy }))
    if (!nodeItemsGeometryChanged(translated)) return
    recordHistory({ kind: 'geometry', nodes: geometryHistoryForNodes(items), drawings: [] })
    applyNodeItemsGeometry(translated)
    return
  }
  const minimum = selectedNodesMinimumBounds(items, bounds)
  const maximum = selectedNodesMaximumBounds(items, bounds)
  const target = { ...bounds }
  if (metric === 'w') {
    target.w = clampNumber(value, minimum.w, maximum.w)
  } else if (metric === 'h') {
    target.h = clampNumber(value, minimum.h, maximum.h)
  } else return
  const transformed = transformNodeCollectionWithinStage(items, bounds, target, stageWidth.value, stageHeight.value, {
    maximumWidth: maximum.w,
    maximumHeight: maximum.h
  })
  if (!transformed.feasible || !nodeItemsGeometryChanged(transformed.items)) return
  recordHistory({ kind: 'geometry', nodes: geometryHistoryForNodes(items), drawings: [] })
  applyNodeItemsGeometry(transformed.items)
}
function startSelectedNodesResize(e, direction) {
  if (e.button !== 0 || operation.value || selectedNodeCount.value < 2 || !selectedNodeBounds.value) return
  e.preventDefault()
  e.stopPropagation()
  if (selectedNodesContainLocked.value) return notify('组合中包含锁定组件，请先解锁后缩放')
  const bounds = { ...selectedNodeBounds.value }
  const items = selectedNodes.value.map(selectedNodeTransformItem)
  const limits = selectedNodesScaleLimits(items)
  beginPointerOperation(e, {
    type: 'resizeNodes', direction, sx: e.clientX, sy: e.clientY,
    bounds,
    items,
    transientLargeSelection: items.length > LARGE_SELECTION_TRANSFORM_THRESHOLD,
    minimum: selectedNodesMinimumBounds(items, bounds, direction, limits),
    maximum: selectedNodesMaximumBounds(items, bounds, direction, limits)
  })
}
function startSelectedNodesRotate(e) {
  if (e.button !== 0 || operation.value || selectedNodeCount.value < 2 || !selectedNodeBounds.value) return
  e.preventDefault()
  e.stopPropagation()
  if (selectedNodesContainLocked.value) return notify('组合中包含锁定组件，请先解锁后旋转')
  const bounds = selectedNodeBounds.value
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  const rect = canvas.value.getBoundingClientRect()
  const clientCenterX = rect.left + canvas.value.clientLeft + centerX * zoom.value - canvas.value.scrollLeft
  const clientCenterY = rect.top + canvas.value.clientTop + centerY * zoom.value - canvas.value.scrollTop
  const items = selectedNodes.value.map(node => ({
    ...selectedNodeTransformItem(node),
    centerX: node.x + node.w / 2, centerY: node.y + node.h / 2
  }))
  beginPointerOperation(e, {
    type: 'rotateNodes', cx: centerX, cy: centerY, clientCenterX, clientCenterY,
    start: Math.atan2(e.clientY - clientCenterY, e.clientX - clientCenterX), items,
    bounds: { ...bounds },
    transientLargeSelection: items.length > LARGE_SELECTION_TRANSFORM_THRESHOLD
  })
}
function startResize(e, n, direction) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  if (n.locked || operation.value) return
  Object.assign(n, normalizeNodeGeometry(n, stageWidth.value, stageHeight.value))
  updateNodeSpatialIndex(n)
  beginPointerOperation(e, { type: 'resize', id: n.id, direction, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: n.w, h: n.h, rotate: n.rotate || 0, nodeType: n.type })
}
function startRotate(e, n) {
  if (e.button !== 0) return
  e.stopPropagation(); if (n.locked || operation.value) return
  Object.assign(n, normalizeNodeGeometry(n, stageWidth.value, stageHeight.value))
  updateNodeSpatialIndex(n)
  const rect = canvas.value.getBoundingClientRect(); const cx = rect.left + canvas.value.clientLeft + (n.x + n.w / 2) * zoom.value - canvas.value.scrollLeft; const cy = rect.top + canvas.value.clientTop + (n.y + n.h / 2) * zoom.value - canvas.value.scrollTop
  beginPointerOperation(e, { type: 'rotate', id: n.id, cx, cy, start: Math.atan2(e.clientY - cy, e.clientX - cx), x: n.x, y: n.y, w: n.w, h: n.h, rotate: n.rotate || 0 })
}
let capturedPointerTarget = null
let capturedPointerId = null
// 移动、缩放、旋转、框选、平移和铅笔共用一个指针操作状态机，确保全局监听只绑定一次。
function capturePointer(e) {
  capturedPointerTarget = canvas.value || e.currentTarget
  capturedPointerId = e.pointerId
  try { capturedPointerTarget?.setPointerCapture?.(capturedPointerId) } catch {}
}
function releaseCapturedPointer() {
  const target = capturedPointerTarget
  const pointerId = capturedPointerId
  capturedPointerTarget = null
  capturedPointerId = null
  try {
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  } catch {}
}
function bindPointerEvents() {
  window.addEventListener('pointermove', pointerMove, { passive: false })
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)
  window.addEventListener('lostpointercapture', pointerUp)
  window.addEventListener('blur', pointerUp)
}
function beginPointerOperation(e, nextOperation) {
  if (operation.value || largeSelectionCommitPending.value) return false
  cancelPendingCanvasZoom()
  const pointerId = Number.isFinite(Number(e?.pointerId)) ? Number(e.pointerId) : null
  if (Array.isArray(nextOperation.items)) nextOperation.items = markRaw(nextOperation.items)
  operation.value = { historyCommitted: false, ...nextOperation, pointerId }
  beginEditorInteraction(POINTER_INTERACTION)
  if (!nextOperation.deferPointerCapture) capturePointer(e)
  bindPointerEvents()
  return true
}

function setLargeSelectionTransform(op, spec) {
  const previous = largeSelectionTransformState
  if (previous?.operation === op && JSON.stringify(previous.spec) === JSON.stringify(spec)) return false
  largeSelectionTransformState = { operation: op, spec }
  largeSelectionPreviewBounds.value = previewLargeSelectionBounds(op.bounds, spec)
  if (!op.transientGeometryChanged) op.transientGeometryChanged = true
  return true
}

function clearLargeSelectionTransform(op = null) {
  if (op && largeSelectionTransformState?.operation !== op) return
  largeSelectionTransformState = null
  largeSelectionPreviewBounds.value = null
}

function resetLargeSelectionTransform(op) {
  clearLargeSelectionTransform(op)
  if (op) op.transientGeometryChanged = false
}

function finishLargeSelectionCommit(op, generation, task) {
  if (generation !== largeSelectionCommitGeneration || operation.value !== op) return
  deactivateNodeMoveInteraction(op)
  largeSelectionCommitFrame = 0
  triggerRef(nodes)
  triggerRef(nodeIndex)
  if (task.nodeIndexChanged) nodeSpatialRevision.value += 1
  if (task.edgeIndexChanged) edgeSpatialRevision.value += 1
  commitPointerOperation(op)
  finishEditorLodGeometry(op)
  operation.value = null
  clearLargeSelectionTransform(op)
  largeSelectionCommitPending.value = false
  endEditorInteraction(POINTER_INTERACTION)
}

function runLargeSelectionCommitSlice(op, generation, task) {
  if (generation !== largeSelectionCommitGeneration || operation.value !== op) return
  const startedAt = performance.now()
  let operations = 0
  while (operations === 0 || performance.now() - startedAt < LARGE_SELECTION_COMMIT_BUDGET_MS) {
    if (task.phase === 'nodes') {
      if (task.index >= task.items.length) {
        task.phase = 'edges'
        task.index = 0
        continue
      }
      const item = task.items[task.index++]
      const node = nodeIndex.value.get(item.id)
      if (node) {
        Object.assign(toRaw(node), {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          rotate: item.rotate,
          visualScaleX: item.visualScaleX,
          visualScaleY: item.visualScaleY
        })
        task.nodeIndexChanged = nodeSpatialIndex.update(node) || task.nodeIndexChanged
      }
    } else if (task.phase === 'edges') {
      while (!task.edgeIterator && task.index < op.items.length) {
        task.edgeIterator = edgeAdjacency.value.get(op.items[task.index++].id)?.[Symbol.iterator]?.() || null
      }
      if (!task.edgeIterator) {
        task.phase = 'done'
        break
      }
      const next = task.edgeIterator.next()
      if (next.done) {
        task.edgeIterator = null
        continue
      }
      const edge = next.value
      if (edge?.id && !task.edgeIds.has(edge.id)) {
        task.edgeIds.add(edge.id)
        task.edgeIndexChanged = edgeSpatialIndex.update(edge) || task.edgeIndexChanged
      }
    } else break
    operations += 1
  }
  if (task.phase === 'done') {
    finishLargeSelectionCommit(op, generation, task)
    return
  }
  largeSelectionCommitFrame = scheduleBundleFrame(() => runLargeSelectionCommitSlice(op, generation, task))
}

function ensureLargeSelectionTransformWorker() {
  if (largeSelectionTransformWorker || typeof Worker !== 'function') return largeSelectionTransformWorker
  try {
    largeSelectionTransformWorker = new Worker(
      new URL('./workers/largeSelectionTransform.worker.js', import.meta.url),
      { type: 'module', name: 'tc2d-large-selection-transform' }
    )
    largeSelectionTransformWorker.onmessage = event => {
      const callback = largeSelectionWorkerCallbacks.get(event.data?.id)
      if (!callback) return
      largeSelectionWorkerCallbacks.delete(event.data.id)
      callback(event.data?.result || null, event.data?.error || '')
    }
    largeSelectionTransformWorker.onerror = () => {
      const callbacks = [...largeSelectionWorkerCallbacks.values()]
      largeSelectionWorkerCallbacks.clear()
      largeSelectionTransformWorker?.terminate()
      largeSelectionTransformWorker = null
      callbacks.forEach(callback => callback(null, 'worker-error'))
    }
  } catch {
    largeSelectionTransformWorker = null
  }
  return largeSelectionTransformWorker
}

function requestChunkedLargeSelectionTransform(op, spec, callback) {
  let task
  try {
    task = createLargeSelectionTransformTask(toRaw(op.items), spec)
  } catch (error) {
    callback(null, error instanceof Error ? error.message : String(error))
    return
  }
  const runSlice = () => {
    largeSelectionCommitFrame = 0
    const startedAt = performance.now()
    try {
      const done = runLargeSelectionTransformTaskSlice(task, {
        shouldYield: () => performance.now() - startedAt >= LARGE_SELECTION_COMMIT_BUDGET_MS
      })
      if (done) {
        callback(task.result, '')
        return
      }
    } catch (error) {
      callback(null, error instanceof Error ? error.message : String(error))
      return
    }
    largeSelectionCommitFrame = scheduleBundleFrame(runSlice)
  }
  largeSelectionCommitFrame = scheduleBundleFrame(runSlice)
}

function requestLargeSelectionTransform(op, spec, callback) {
  const worker = ensureLargeSelectionTransformWorker()
  if (!worker) {
    requestChunkedLargeSelectionTransform(op, spec, callback)
    return
  }
  const id = nextLargeSelectionWorkerRequestId++
  const handleWorkerResult = (result, error) => {
    if (error) {
      requestChunkedLargeSelectionTransform(op, spec, callback)
      return
    }
    callback(result, '')
  }
  largeSelectionWorkerCallbacks.set(id, handleWorkerResult)
  try {
    worker.postMessage({ id, items: toRaw(op.items), spec })
  } catch {
    largeSelectionWorkerCallbacks.delete(id)
    requestChunkedLargeSelectionTransform(op, spec, callback)
  }
}

function scheduleLargeSelectionCommit(op) {
  const pending = largeSelectionTransformState
  if (!op?.transientLargeSelection || pending?.operation !== op || !pending.spec) return false
  const generation = ++largeSelectionCommitGeneration
  op.largeSelectionCommitPending = true
  largeSelectionCommitPending.value = true
  miniMapPreview.value?.invalidatePendingRender?.('large-selection-commit')
  op.editorLodCoverBounds = [op.bounds, largeSelectionPreviewBounds.value]
    .filter(bounds => bounds && bounds.w > 0 && bounds.h > 0)
    .map(bounds => ({ ...bounds }))
  beginEditorLodGeometry(op, {
    nodes: [],
    edges: [],
    drawings: [],
    coverBounds: op.editorLodCoverBounds,
    geometryRevision: 0
  })
  requestLargeSelectionTransform(op, pending.spec, (result, error) => {
    if (generation !== largeSelectionCommitGeneration || operation.value !== op) return
    if (error || !result?.feasible || result.items.length !== op.items.length) {
      deactivateNodeMoveInteraction(op)
      finishEditorLodGeometry(op)
      operation.value = null
      clearLargeSelectionTransform(op)
      largeSelectionCommitPending.value = false
      endEditorInteraction(POINTER_INTERACTION)
      notify('组合变换超出画布范围，未应用本次操作')
      return
    }
    if (result.bounds?.w > 0 && result.bounds?.h > 0) {
      const authoritativeBounds = { ...result.bounds }
      op.editorLodCoverBounds = [...(op.editorLodCoverBounds || []), authoritativeBounds]
      const session = editorLodGeometrySession.value
      if (session?.sessionId === op.editorLodGeometrySessionId) {
        const coverPayload = { coverBounds: [authoritativeBounds] }
        const detailCurrentBounds = mergeEditorLodDetailCoverBounds(null, coverPayload)
        const detailCoverBounds = editorLodDetailCoverRegions(
          session.detailSourceBounds,
          detailCurrentBounds
        )
        editorLodGeometrySession.value = { ...session, detailCurrentBounds, detailCoverBounds }
      }
    }
    runLargeSelectionCommitSlice(op, generation, {
      phase: 'nodes',
      index: 0,
      items: result.items,
      edgeIterator: null,
      edgeIds: new Set(),
      nodeIndexChanged: false,
      edgeIndexChanged: false
    })
  })
  return true
}

function cancelLargeSelectionCommit() {
  largeSelectionCommitGeneration += 1
  largeSelectionWorkerCallbacks.clear()
  if (largeSelectionCommitFrame) cancelBundleFrame(largeSelectionCommitFrame)
  largeSelectionCommitFrame = 0
  if (operation.value?.transientLargeSelection) {
    deactivateNodeMoveInteraction(operation.value)
    editorLodCanvas.value?.cancelGeometryInteraction?.(operation.value.editorLodGeometrySessionId)
    editorLodDetailCanvas.value?.cancelGeometryInteraction?.(operation.value.editorLodDetailGeometrySessionId)
    clearEditorLodGeometryVisualState(operation.value.editorLodGeometrySessionId)
    operation.value = null
    endEditorInteraction(POINTER_INTERACTION)
  }
  clearLargeSelectionTransform()
  largeSelectionCommitPending.value = false
}

function pointerGeometryHistory(op) {
  if (op.type === 'polylinePoint') {
    return {
      kind: 'fields',
      nodes: op.historyRecord ? [op.historyRecord] : [],
      drawings: []
    }
  }
  if (['moveNodes', 'resizeNodes', 'rotateNodes'].includes(op.type)) {
    return { kind: 'geometry', nodes: geometryHistoryForNodes(op.items), drawings: [] }
  }
  if (['resize', 'rotate'].includes(op.type)) {
    const node = nodeIndex.value.get(op.id)
    return {
      kind: 'geometry',
      nodes: node ? geometryHistoryForNodes([{ ...selectedNodeTransformItem(node), x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate }]) : [],
      drawings: []
    }
  }
  if (['moveDrawing', 'resizeDrawing'].includes(op.type)) {
    return { kind: 'geometry', nodes: [], drawings: [{ id: op.id, points: op.points.map(point => ({ ...point })) }] }
  }
  return null
}

function editorLodGeometryPayload(op, geometryRevision, nodeOpacityMultiplier = null) {
  let activeNodes = []
  let activeDrawings = []
  if (['moveNodes', 'resizeNodes', 'rotateNodes'].includes(op?.type)) {
    activeNodes = op.items.map(item => nodeIndex.value.get(item.id)).filter(Boolean)
  } else if (['resize', 'rotate', 'polylinePoint'].includes(op?.type)) {
    const node = nodeIndex.value.get(op.id)
    if (node) activeNodes = [node]
  } else if (['moveDrawing', 'resizeDrawing'].includes(op?.type)) {
    const drawing = drawingIndex.value.get(op.id)
    if (drawing) activeDrawings = [drawing]
  }
  return {
    nodes: activeNodes,
    edges: edgesForNodeIds(activeNodes.map(node => node.id), EDITOR_LOD_INTERACTION_EDGE_LIMIT),
    drawings: activeDrawings,
    nodeOpacityMultiplier: nodeOpacityMultiplier ?? 1,
    geometryRevision
  }
}

function currentEditorLodGeometrySession(sessionId) {
  const session = editorLodGeometrySession.value
  return session?.sessionId === sessionId ? session : null
}

function syncEditorLodGeometryHiddenState(session, payload = null) {
  const hideCanvasEntities = shouldHideEditorLodGeometryDom({
    fallbackMode: session?.mode,
    fallbackCommitted: session?.committed,
    fallbackFailed: session?.fallbackFailed,
    fallbackVisible: !editorLodDetailVisible.value || EDITOR_LOD_DETAIL_CLIP_SUPPORTED,
    detailVisible: editorLodDetailVisible.value,
    detailPatchActive: session?.detailPatchActive,
    detailCommitted: session?.detailCommitted,
    detailFailed: session?.detailFailed
  })
  if (!hideCanvasEntities) {
    editorLodGeometryHiddenNodeIds.value = new Set()
    editorLodGeometryHiddenEdgeIds.value = new Set()
    editorLodGeometryHiddenDrawingIds.value = new Set()
    return
  }
  if (!payload) return
  editorLodGeometryHiddenNodeIds.value = editorLodCanvasRendersEntities.value
    ? new Set(payload.nodes.map(node => node.id))
    : new Set()
  editorLodGeometryHiddenEdgeIds.value = new Set(payload.edges.map(edge => edge.id))
  editorLodGeometryHiddenDrawingIds.value = editorLodCanvasRendersEntities.value
    ? new Set(payload.drawings.map(drawing => drawing.id))
    : new Set()
}

function updateEditorLodGeometryVisualState(session, payload) {
  editorLodGeometrySession.value = session
  syncEditorLodGeometryHiddenState(session, payload)
}

function createEditorLodRemovalCoverRegions(previous, payload) {
  const payloadNodes = (payload?.nodes || []).filter(Boolean)
  const payloadNodeIndex = new Map(payloadNodes.map(node => [node.id, node]))
  const removalNodeIndex = payloadNodeIndex.size
    ? {
        get(id) {
          return payloadNodeIndex.get(id) ?? nodeIndex.value.get(id)
        }
      }
    : nodeIndex.value
  const frames = [
    ...payloadNodes.map(node => rotatedFrameBounds(node)),
    ...(payload?.edges || []).map(edge => edgeBoundsForNodes(edge, removalNodeIndex)),
    ...(payload?.drawings || []).map(drawing => drawingBounds(drawing))
  ]
  return mergeEditorLodRemovalRegions({
    previous,
    frames,
    padding: 16 / Math.max(.0001, zoom.value),
    bounds: { x: 0, y: 0, w: stageWidth.value, h: stageHeight.value }
  })
}

function mergeEditorLodDetailCoverBounds(previous, payload) {
  const payloadNodes = (payload?.nodes || []).filter(Boolean)
  const payloadNodeIndex = new Map(payloadNodes.map(node => [node.id, node]))
  const geometryNodeIndex = payloadNodeIndex.size
    ? {
        get(id) {
          return payloadNodeIndex.get(id) ?? nodeIndex.value.get(id)
        }
      }
    : nodeIndex.value
  const frames = [
    ...(payload?.coverBounds || []),
    ...payloadNodes.map(node => rotatedFrameBounds(node)),
    ...(payload?.edges || []).map(edge => edgeBoundsForNodes(edge, geometryNodeIndex)),
    ...(payload?.drawings || []).map(drawing => drawingBounds(drawing))
  ].filter(frame => frame && frame.w > 0 && frame.h > 0)
  if (!frames.length) return previous
  const padding = 16 / Math.max(.0001, zoom.value)
  const left = Math.max(0, Math.min(previous?.x ?? Infinity, ...frames.map(frame => frame.x - padding)))
  const top = Math.max(0, Math.min(previous?.y ?? Infinity, ...frames.map(frame => frame.y - padding)))
  const right = Math.min(stageWidth.value, Math.max(
    previous ? previous.x + previous.w : -Infinity,
    ...frames.map(frame => frame.x + frame.w + padding)
  ))
  const bottom = Math.min(stageHeight.value, Math.max(
    previous ? previous.y + previous.h : -Infinity,
    ...frames.map(frame => frame.y + frame.h + padding)
  ))
  return { x: left, y: top, w: Math.max(.1, right - left), h: Math.max(.1, bottom - top) }
}

function editorLodDetailCoverRegions(...sources) {
  return sources
    .flatMap(source => Array.isArray(source) ? source : [source])
    .filter(bounds => bounds && bounds.w > 0 && bounds.h > 0)
}

function beginEditorLodGeometry(op, preparedPayload = null) {
  if (op.editorLodGeometrySessionId || !editorLodActive.value || editorRenderPaused.value) return op.editorLodGeometrySessionId || null
  const target = editorLodCanvas.value
  if (!target?.beginGeometryInteraction) return null
  const revision = ++editorLodGeometryRevision
  const payload = preparedPayload || editorLodGeometryPayload(op, revision)
  payload.geometryRevision = revision
  const result = target.beginGeometryInteraction(payload)
  if (!result?.sessionId) return null
  if (editorLodFallbackRecoveryPending) clearEditorLodRecoveryTarget('fallback')
  if (editorLodDetailRecoveryPending) clearEditorLodRecoveryTarget('detail')
  const detailSourceBounds = mergeEditorLodDetailCoverBounds(null, payload)
  const detailCanvasExpected = Boolean(editorLodDetailCanvas.value && editorLodDetailBounds.value)
  const detailNeedsRecovery = detailCanvasExpected && !editorLodDetailReady.value
  const detailPatchAllowed = editorLodDetailReady.value
    && !(payload.coverBounds?.length > 0)
  const detailResult = editorLodDetailReady.value
    ? editorLodDetailCanvas.value?.beginGeometryInteraction?.(
        detailPatchAllowed ? payload : { geometryRevision: revision }
      )
    : null
  const detailSessionId = detailResult?.sessionId || null
  const detailPatchActive = Boolean(detailPatchAllowed && detailResult?.mode === 'canvas')
  if (!detailSessionId) editorLodDetailCanvas.value?.invalidatePendingRender?.('geometry-fallback')
  clearEditorLodGeometryVisualState()
  op.editorLodGeometrySessionId = result.sessionId
  op.editorLodDetailGeometrySessionId = detailSessionId
  op.editorLodDetailPatchActive = detailPatchActive
  op.editorLodGeometryRevision = revision
  editorLodDetailFresh.value = false
  updateEditorLodGeometryVisualState({
    ...result,
    state: 'active',
    committed: false,
    detailSessionId,
    detailPatchActive,
    detailCommitted: false,
    detailSourceBounds,
    detailCurrentBounds: detailSourceBounds,
    detailCoverBounds: editorLodDetailReady.value && !detailPatchActive
      ? editorLodDetailCoverRegions(detailSourceBounds)
      : null,
    detailCoverFrozen: false,
    detailTargetGeneration: null,
    detailCompletionRequired: Boolean(editorLodDetailReady.value && detailSessionId),
    fallbackComplete: false,
    detailComplete: false,
    fallbackRecoveryPending: editorLodFallbackRecoveryPending,
    detailRecoveryPending: editorLodDetailRecoveryPending || detailNeedsRecovery
  }, payload)
  return result.sessionId
}

function requestEditorLodGeometryFrame(op) {
  const sessionId = op?.editorLodGeometrySessionId
  if (!sessionId) return null
  let previous = editorLodGeometrySession.value?.sessionId === sessionId
    ? editorLodGeometrySession.value
    : null
  if (!previous) return null
  const revision = ++editorLodGeometryRevision
  const payload = editorLodGeometryPayload(op, revision)
  let result = null
  if (!previous.fallbackFailed) {
    result = editorLodCanvas.value?.requestGeometryInteractionFrame?.(sessionId, payload)
    const liveSession = currentEditorLodGeometrySession(sessionId)
    if (!liveSession) return null
    previous = liveSession
    if (!result && !previous.fallbackFailed) {
      editorLodCanvas.value?.cancelGeometryInteraction?.(sessionId)
      completeEditorLodGeometryLayer(sessionId, 'fallback', { failed: true })
      previous = currentEditorLodGeometrySession(sessionId)
      if (!previous) return null
    }
  }
  const detailCurrentBounds = mergeEditorLodDetailCoverBounds(null, payload)
  let detailSourceBounds = previous.detailSourceBounds || detailCurrentBounds
  let detailSessionId = previous.detailSessionId || op.editorLodDetailGeometrySessionId
  let detailPatchActive = Boolean(previous.detailPatchActive && op.editorLodDetailPatchActive)
  let detailCommitted = false
  if (previous.detailFailed) {
    detailSessionId = null
    detailPatchActive = false
    op.editorLodDetailGeometrySessionId = null
    op.editorLodDetailPatchActive = false
  } else if (detailSessionId && detailPatchActive) {
    const detailResult = editorLodDetailCanvas.value?.requestGeometryInteractionFrame?.(detailSessionId, payload)
    const liveSession = currentEditorLodGeometrySession(sessionId)
    if (!liveSession) return null
    previous = liveSession
    if (previous.detailFailed) {
      detailSessionId = null
      detailPatchActive = false
      op.editorLodDetailGeometrySessionId = null
      op.editorLodDetailPatchActive = false
    } else if (!detailResult) {
      editorLodDetailCanvas.value?.cancelGeometryInteraction?.(detailSessionId)
      completeEditorLodGeometryLayer(sessionId, 'detail', { failed: true })
      previous = currentEditorLodGeometrySession(sessionId)
      if (!previous) return null
      detailSessionId = null
      detailPatchActive = false
      op.editorLodDetailGeometrySessionId = null
      op.editorLodDetailPatchActive = false
    } else {
      detailCommitted = detailResult.mode === 'canvas' && detailResult.committed === true
    }
    if (!detailCommitted) {
      op.editorLodDetailPatchActive = false
      detailPatchActive = false
    }
  }
  if (detailCommitted && detailCurrentBounds) detailSourceBounds = detailCurrentBounds
  op.editorLodGeometryRevision = revision
  updateEditorLodGeometryVisualState({
    ...previous,
    ...(result || {}),
    state: 'active',
    sessionId,
    mode: previous.fallbackFailed ? 'dom' : (result?.mode || previous.mode),
    committed: previous.fallbackFailed
      ? false
      : Boolean(result?.mode === 'canvas' && result?.committed === true),
    detailSessionId,
    detailPatchActive,
    detailCommitted: previous.detailFailed ? false : detailCommitted,
    detailSourceBounds,
    detailCurrentBounds,
    detailCoverBounds: previous.detailFailed
      ? (previous.detailCoverFrozen
          ? previous.detailCoverBounds
          : editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds))
      : editorLodDetailReady.value && !detailPatchActive
        ? editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds)
        : null,
    detailCoverFrozen: previous.detailCoverFrozen === true,
    detailTargetGeneration: null,
    detailCompletionRequired: previous.detailCompletionRequired === true
      || Boolean(editorLodDetailReady.value && detailSessionId),
    fallbackComplete: previous.fallbackComplete === true,
    detailComplete: previous.detailComplete === true,
    fallbackFailed: previous.fallbackFailed === true,
    detailFailed: previous.detailFailed === true,
    fallbackRecoveryPending: previous.fallbackRecoveryPending === true,
    detailRecoveryPending: previous.detailRecoveryPending === true
  }, payload)
  return result || editorLodGeometrySession.value
}

function finishEditorLodGeometry(op) {
  const sessionId = op?.editorLodGeometrySessionId
  if (!sessionId) return false
  let currentSession = editorLodGeometrySession.value?.sessionId === sessionId
    ? editorLodGeometrySession.value
    : null
  if (!currentSession) {
    editorLodCanvas.value?.cancelGeometryInteraction?.(sessionId)
    editorLodDetailCanvas.value?.cancelGeometryInteraction?.(op.editorLodDetailGeometrySessionId)
    clearEditorLodGeometryVisualState(sessionId)
    queueEditorLodRecovery({ fallback: true, detail: Boolean(op.editorLodDetailGeometrySessionId) })
    return false
  }
  const revision = op.editorLodGeometryRevision || ++editorLodGeometryRevision
  const payload = op.transientLargeSelection
    ? {
        nodes: [],
        edges: [],
        drawings: [],
        coverBounds: op.editorLodCoverBounds || [],
        geometryRevision: revision
      }
    : editorLodGeometryPayload(op, revision, 1)
  const detailCurrentBounds = mergeEditorLodDetailCoverBounds(null, payload)
  let detailSourceBounds = currentSession.detailSourceBounds || detailCurrentBounds
  let detailSessionId = currentSession.detailSessionId || op.editorLodDetailGeometrySessionId
  let detailPatchActive = Boolean(currentSession.detailPatchActive && op.editorLodDetailPatchActive)
  let detailTargetGeneration = null
  let detailRevision = revision
  let detailFailed = currentSession.detailFailed === true
  let detailRecoveryPending = currentSession.detailRecoveryPending === true
  let detailCommitted = Boolean(currentSession.detailCommitted && detailPatchActive)
  if (detailFailed) {
    editorLodDetailCanvas.value?.cancelGeometryInteraction?.(detailSessionId)
    detailSessionId = null
    detailPatchActive = false
    detailCommitted = false
    op.editorLodDetailGeometrySessionId = null
    op.editorLodDetailPatchActive = false
  } else if (detailSessionId) {
    const detailResult = editorLodDetailCanvas.value?.finishGeometryInteraction?.(
      detailSessionId,
      detailPatchActive ? payload : { geometryRevision: revision }
    )
    const liveSession = currentEditorLodGeometrySession(sessionId)
    if (!liveSession) return false
    currentSession = liveSession
    detailFailed = currentSession.detailFailed === true
    detailRecoveryPending = currentSession.detailRecoveryPending === true
    detailTargetGeneration = detailFailed ? null : parseRenderGeneration(detailResult?.targetFullGeneration)
    if (detailFailed) {
      detailSessionId = null
      detailPatchActive = false
      detailCommitted = false
      op.editorLodDetailGeometrySessionId = null
      op.editorLodDetailPatchActive = false
    } else if (!detailResult?.sessionId || detailTargetGeneration == null) {
      editorLodDetailCanvas.value?.cancelGeometryInteraction?.(detailSessionId)
      completeEditorLodGeometryLayer(sessionId, 'detail', { failed: true })
      currentSession = currentEditorLodGeometrySession(sessionId)
      if (!currentSession) return false
      detailSessionId = null
      detailPatchActive = false
      detailCommitted = false
      op.editorLodDetailGeometrySessionId = null
      op.editorLodDetailPatchActive = false
      detailFailed = true
      detailRecoveryPending = true
    } else {
      detailRevision = finiteNumber(detailResult.revision, revision)
      detailCommitted = Boolean(detailPatchActive && detailResult.mode === 'canvas' && detailResult.committed === true)
    }
  }
  if (detailCommitted && detailCurrentBounds) detailSourceBounds = detailCurrentBounds
  let detailCoverFrozen = currentSession.detailCoverFrozen === true
  let detailCoverBounds = editorLodDetailReady.value && !detailPatchActive
    ? editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds)
    : null
  if (detailFailed) {
    detailCoverBounds = detailCoverFrozen
      ? currentSession.detailCoverBounds
      : (detailCoverBounds || editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds))
  } else if (!detailSessionId && editorLodDetailReady.value) {
    detailTargetGeneration = parseRenderGeneration(editorLodDetailCanvas.value?.requestCoalescedRender?.())
    const liveSession = currentEditorLodGeometrySession(sessionId)
    if (!liveSession) return false
    currentSession = liveSession
    detailFailed = currentSession.detailFailed === true
    detailRecoveryPending = currentSession.detailRecoveryPending === true
    if (detailFailed) {
      detailTargetGeneration = null
      detailCommitted = false
      detailCoverFrozen = currentSession.detailCoverFrozen === true
      detailCoverBounds = detailCoverFrozen
        ? currentSession.detailCoverBounds
        : (detailCoverBounds || editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds))
    } else if (detailTargetGeneration == null) {
      completeEditorLodGeometryLayer(sessionId, 'detail', { failed: true })
      currentSession = currentEditorLodGeometrySession(sessionId)
      if (!currentSession) return false
      detailFailed = true
      detailRecoveryPending = true
      detailCommitted = false
      detailCoverFrozen = currentSession.detailCoverFrozen === true
      detailCoverBounds = detailCoverFrozen
        ? currentSession.detailCoverBounds
        : (detailCoverBounds || editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds))
    }
  }

  let fallbackFailed = currentSession.fallbackFailed === true
  let fallbackRecoveryPending = currentSession.fallbackRecoveryPending === true
  let fallbackCommitted = Boolean(currentSession.committed && currentSession.mode === 'canvas')
  let result = null
  let fallbackTargetGeneration = null
  if (fallbackFailed) {
    editorLodCanvas.value?.cancelGeometryInteraction?.(sessionId)
    fallbackCommitted = false
  } else {
    result = editorLodCanvas.value?.finishGeometryInteraction?.(sessionId, payload)
    const liveSession = currentEditorLodGeometrySession(sessionId)
    if (!liveSession) return false
    currentSession = liveSession
    fallbackFailed = currentSession.fallbackFailed === true
    fallbackRecoveryPending = currentSession.fallbackRecoveryPending === true
    fallbackTargetGeneration = fallbackFailed ? null : parseRenderGeneration(result?.targetFullGeneration)
    if (fallbackFailed) {
      result = null
      fallbackCommitted = false
    } else if (!result?.sessionId || fallbackTargetGeneration == null) {
      editorLodCanvas.value?.cancelGeometryInteraction?.(sessionId)
      completeEditorLodGeometryLayer(sessionId, 'fallback', { failed: true })
      currentSession = currentEditorLodGeometrySession(sessionId)
      if (!currentSession) return false
      result = null
      fallbackFailed = true
      fallbackRecoveryPending = true
      fallbackCommitted = false
    } else {
      fallbackCommitted = result.mode === 'canvas' && result.committed === true
    }
  }

  const finalSessionSource = currentEditorLodGeometrySession(sessionId)
  if (!finalSessionSource) return false
  currentSession = finalSessionSource
  fallbackFailed = fallbackFailed || currentSession.fallbackFailed === true
  detailFailed = detailFailed || currentSession.detailFailed === true
  fallbackRecoveryPending = fallbackRecoveryPending || currentSession.fallbackRecoveryPending === true
  detailRecoveryPending = detailRecoveryPending || currentSession.detailRecoveryPending === true
  if (fallbackFailed) {
    fallbackTargetGeneration = null
    fallbackCommitted = false
  }
  if (detailFailed) {
    detailTargetGeneration = null
    detailSessionId = null
    detailPatchActive = false
    detailCommitted = false
    detailCoverFrozen = currentSession.detailCoverFrozen === true
    detailCoverBounds = detailCoverFrozen
      ? currentSession.detailCoverBounds
      : (detailCoverBounds || editorLodDetailCoverRegions(detailSourceBounds, detailCurrentBounds))
    op.editorLodDetailGeometrySessionId = null
    op.editorLodDetailPatchActive = false
  }
  const finalSession = {
    ...currentSession,
    ...(result || {}),
    sessionId,
    state: 'awaiting-full',
    mode: fallbackFailed ? 'dom' : (result?.mode || currentSession.mode),
    committed: fallbackFailed ? false : fallbackCommitted,
    targetFullGeneration: fallbackTargetGeneration,
    detailSessionId,
    detailPatchActive,
    detailCommitted: detailFailed ? false : detailCommitted,
    detailSourceBounds,
    detailCurrentBounds,
    detailCoverBounds,
    detailCoverFrozen,
    detailTargetGeneration,
    fallbackRevision: finiteNumber(result?.revision, revision),
    detailRevision,
    detailCompletionRequired: currentSession.detailCompletionRequired === true || Boolean(
      editorLodDetailReady.value
      && (detailFailed || detailSessionId || detailTargetGeneration != null)
    ),
    fallbackComplete: currentSession.fallbackComplete === true || fallbackFailed,
    detailComplete: currentSession.detailComplete === true || detailFailed,
    fallbackFailed,
    detailFailed,
    fallbackRecoveryPending: fallbackRecoveryPending || fallbackFailed,
    detailRecoveryPending: detailRecoveryPending || detailFailed
  }
  updateEditorLodGeometryVisualState(finalSession, payload)
  if (editorLodGeometryBarrierSettled(finalSession)) settleEditorLodGeometrySession(sessionId, finalSession)
  return true
}

function commitPointerOperation(op) {
  if (op.historyCommitted) return
  const entry = pointerGeometryHistory(op)
  if (entry) recordHistory(entry)
  op.historyCommitted = true
}
let pointerFrame = 0
let pendingPointer = null
function pointerMove(e) {
  if (workspaceSwitchPending.value) { pointerUp(); return }
  if (operation.value?.pointerId != null && e.pointerId != null && e.pointerId !== operation.value.pointerId) return
  if (e.pointerType === 'mouse' && e.buttons === 0) { pointerUp(e); return }
  if (!Number.isFinite(Number(e.clientX)) || !Number.isFinite(Number(e.clientY))) return
  if (operation.value?.deferPointerCapture) {
    if (Math.hypot(e.clientX - operation.value.sx, e.clientY - operation.value.sy) < NODE_DRAG_START_DISTANCE) return
    operation.value.deferPointerCapture = false
    if (operation.value.type === 'moveNodes') operation.value.nodeMoveInteractionActive = true
    capturePointer(e)
  }
  if (['resize', 'resizeDrawing', 'resizeNodes', 'selectNodes'].includes(operation.value?.type)) e.preventDefault()
  pendingPointer = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: e.shiftKey, altKey: e.altKey }
  if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointerMove)
}
function applyPointerMove() {
  pointerFrame = 0
  const e = pendingPointer
  pendingPointer = null
  if (workspaceSwitchPending.value) return
  if (!e) return
  const op = operation.value; if (!op) return
  if (op.type === 'pan') {
    canvas.value.scrollLeft = op.left - (e.clientX - op.sx)
    canvas.value.scrollTop = op.top - (e.clientY - op.sy)
    updateViewport()
    return
  }
  if (op.type === 'selectNodes') {
    const current = pointFromEvent(e)
    const frame = {
      x: Math.min(op.start.x, current.x),
      y: Math.min(op.start.y, current.y),
      w: Math.abs(current.x - op.start.x),
      h: Math.abs(current.y - op.start.y)
    }
    selectionMarquee.value = frame
    const ids = new Set(op.baseIds)
    const minimumDrag = 3 / zoom.value
    if (frame.w >= minimumDrag || frame.h >= minimumDrag) {
      const matchedGroups = new Set()
      for (const node of queryNodesInBounds(frame)) {
        if (!framesIntersect(frame, nodeSelectionBounds(node))) continue
        if (node.groupId) matchedGroups.add(node.groupId)
        else ids.add(node.id)
      }
      if (matchedGroups.size) {
        for (const groupId of matchedGroups) {
          for (const node of nodesByGroup.value.get(groupId) || []) ids.add(node.id)
        }
      }
    }
    const nextIds = [...ids]
    const primaryId = nextIds.includes(selectedId.value) ? selectedId.value : nextIds.at(-1)
    setNodeSelection(nextIds, primaryId)
    return
  }
  if (op.type === 'draw') {
    const drawing = drawingIndex.value.get(op.id)
    if (drawing) {
      const point = pointFromEvent(e); const last = drawing.points.at(-1)
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2.5 / zoom.value) {
        drawing.points.push(point)
        if (updateDrawingIndex(drawing, false)) op.drawingSpatialIndexChanged = true
      }
    }
    return
  }
  if (op.type === 'polylinePoint') {
    const node = nodeIndex.value.get(op.id)
    if (!node || !isPolylineNodeType(node.type) || node.locked || !op.points[op.pointIndex]) return
    const point = worldPointToPolylineLocal(op.frame, polylinePointFromEvent(e, false))
    const original = op.points[op.pointIndex]
    if (Math.hypot(point.x - original.x, point.y - original.y) <= 1e-8) return
    const points = op.points.map(item => ({ ...item }))
    points[op.pointIndex] = point
    const reframed = reframePolylineNode(op.frame, points, { pointIndex: op.pointIndex })
    if (!reframed) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    Object.assign(node, reframed)
    if (updateNodeSpatialIndex(node, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
    return
  }
  if (op.type === 'moveDrawing') {
    const drawing = drawingIndex.value.get(op.id)
    if (drawing) {
      const requestedDx = (e.clientX - op.sx) / zoom.value
      const requestedDy = (e.clientY - op.sy) / zoom.value
      const { dx, dy } = constrainTranslation([op.bounds], requestedDx, requestedDy, stageWidth.value, stageHeight.value)
      const points = op.points.map(point => ({ x: point.x + dx, y: point.y + dy }))
      if (!drawingPointsChanged(drawing, points)) return
      beginEditorLodGeometry(op)
      commitPointerOperation(op)
      drawing.points = points
      if (updateDrawingIndex(drawing, false)) op.drawingSpatialIndexChanged = true
      requestEditorLodGeometryFrame(op)
    }
    return
  }
  if (op.type === 'resizeDrawing') {
    const drawing = drawingIndex.value.get(op.id)
    if (drawing) {
      const dx = (e.clientX - op.sx) / zoom.value
      const dy = (e.clientY - op.sy) / zoom.value
      const target = resizeFrameWithinBounds(op.bounds, op.direction, dx, dy, stageWidth.value, stageHeight.value, {
        minimumWidth: 1,
        minimumHeight: 1,
        snapSize: snap.value && !e.altKey ? gridSize.value : 0
      })
      const points = drawingPointsToBounds(op.points, op.bounds, target)
      if (!drawingPointsChanged(drawing, points)) return
      beginEditorLodGeometry(op)
      commitPointerOperation(op)
      drawing.points = points
      if (updateDrawingIndex(drawing, false)) op.drawingSpatialIndexChanged = true
      requestEditorLodGeometryFrame(op)
    }
    return
  }
  if (op.type === 'moveNodes') {
    const anchor = op.anchorItem || op.items[0]
    if (!anchor) return
    let anchorX = anchor.x + (e.clientX - op.sx) / zoom.value
    let anchorY = anchor.y + (e.clientY - op.sy) / zoom.value
    if (snap.value && !e.altKey) {
      anchorX = Math.round(anchorX / gridSize.value) * gridSize.value
      anchorY = Math.round(anchorY / gridSize.value) * gridSize.value
    }
    let dx = anchorX - anchor.x
    let dy = anchorY - anchor.y
    if (op.transientLargeSelection) {
      dx = clampNumber(dx, op.translationRange.minimumX, op.translationRange.maximumX)
      dy = clampNumber(dy, op.translationRange.minimumY, op.translationRange.maximumY)
      if (Math.abs(dx) <= 1e-8 && Math.abs(dy) <= 1e-8) {
        resetLargeSelectionTransform(op)
        return
      }
      setLargeSelectionTransform(op, { kind: 'move', dx, dy })
      return
    }
    const translation = constrainNodeCollectionTranslation(op.items, dx, dy, stageWidth.value, stageHeight.value)
    if (!translation.feasible) return
    ;({ dx, dy } = translation)
    const transformed = op.items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy }))
    if (!nodeItemsGeometryChanged(transformed)) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    if (applyNodeItemsGeometry(transformed, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
    return
  }
  if (op.type === 'resizeNodes') {
    const dx = (e.clientX - op.sx) / zoom.value
    const dy = (e.clientY - op.sy) / zoom.value
    const target = resizeFrameWithinBounds(op.bounds, op.direction, dx, dy, stageWidth.value, stageHeight.value, {
      minimumWidth: op.minimum.w,
      minimumHeight: op.minimum.h,
      minimumIsAuthoritative: true,
      maximumWidth: op.maximum.w,
      maximumHeight: op.maximum.h,
      lockAspectRatio: op.direction.length === 2,
      snapSize: snap.value && !e.altKey ? gridSize.value : 0
    })
    if (op.transientLargeSelection) {
      if (
        Math.abs(target.x - op.bounds.x) <= 1e-8
        && Math.abs(target.y - op.bounds.y) <= 1e-8
        && Math.abs(target.w - op.bounds.w) <= 1e-8
        && Math.abs(target.h - op.bounds.h) <= 1e-8
      ) {
        resetLargeSelectionTransform(op)
        return
      }
      setLargeSelectionTransform(op, {
        kind: 'resize',
        sourceBounds: { ...op.bounds },
        targetBounds: { ...target },
        stageWidth: stageWidth.value,
        stageHeight: stageHeight.value,
        maximumWidth: op.maximum.w,
        maximumHeight: op.maximum.h
      })
      return
    }
    const transformed = transformNodeCollectionWithinStage(op.items, op.bounds, target, stageWidth.value, stageHeight.value, {
      maximumWidth: op.maximum.w,
      maximumHeight: op.maximum.h
    })
    if (!transformed.feasible || !nodeItemsGeometryChanged(transformed.items)) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    if (applyNodeItemsGeometry(transformed.items, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
    return
  }
  if (op.type === 'rotateNodes') {
    const angle = Math.atan2(e.clientY - op.clientCenterY, e.clientX - op.clientCenterX)
    let angleDelta = angle - op.start
    if (angleDelta > Math.PI) angleDelta -= Math.PI * 2
    if (angleDelta < -Math.PI) angleDelta += Math.PI * 2
    let degrees = angleDelta * 180 / Math.PI
    if (e.shiftKey) degrees = Math.round(degrees / 15) * 15
    if (op.transientLargeSelection) {
      if (Math.abs(degrees) <= 1e-8) {
        resetLargeSelectionTransform(op)
        return
      }
      setLargeSelectionTransform(op, {
        kind: 'rotate',
        cx: op.cx,
        cy: op.cy,
        degrees,
        stageWidth: stageWidth.value,
        stageHeight: stageHeight.value
      })
      return
    }
    const transformAt = rotationDelta => {
      const radians = rotationDelta * Math.PI / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      return op.items.map(item => {
        const dx = item.centerX - op.cx
        const dy = item.centerY - op.cy
        const centerX = op.cx + dx * cos - dy * sin
        const centerY = op.cy + dx * sin + dy * cos
        return { ...item, x: centerX - item.w / 2, y: centerY - item.h / 2, rotate: Math.round((item.rotate + rotationDelta) * 100) / 100 }
      })
    }
    const constrainRotation = rotationDelta => {
      const items = transformAt(rotationDelta)
      return { items, translation: constrainNodeCollectionTranslation(items, 0, 0, stageWidth.value, stageHeight.value) }
    }
    let constrained = constrainRotation(degrees)
    if (!constrained.translation.feasible) {
      let allowedScale = 0
      let blockedScale = 1
      const samples = 32
      for (let index = 1; index <= samples; index += 1) {
        const scale = index / samples
        if (!constrainRotation(degrees * scale).translation.feasible) {
          blockedScale = scale
          break
        }
        allowedScale = scale
      }
      for (let index = 0; index < 40; index += 1) {
        const scale = (allowedScale + blockedScale) / 2
        if (constrainRotation(degrees * scale).translation.feasible) allowedScale = scale
        else blockedScale = scale
      }
      constrained = constrainRotation(degrees * allowedScale)
    }
    const transformed = constrained.items
    const { dx: shiftX, dy: shiftY } = constrained.translation
    if (!constrained.translation.feasible) return
    const appliedItems = transformed.map(item => ({ ...item, x: item.x + shiftX, y: item.y + shiftY }))
    if (!nodeItemsGeometryChanged(appliedItems)) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    if (applyNodeItemsGeometry(appliedItems, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
    return
  }
  const n = nodeIndex.value.get(op.id); if (!n) return
  if (op.type === 'resize') {
    const dx = (e.clientX - op.sx) / zoom.value; const dy = (e.clientY - op.sy) / zoom.value
    const minimum = nodeMinimumSize({ type: op.nodeType })
    const target = resizeRotatedFrameWithinBounds({ type: op.nodeType, x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate }, op.direction, dx, dy, stageWidth.value, stageHeight.value, {
      minimumWidth: minimum.w,
      minimumHeight: minimum.h
    })
    if (Math.abs(n.x - target.x) <= 1e-8 && Math.abs(n.y - target.y) <= 1e-8 && Math.abs(n.w - target.w) <= 1e-8 && Math.abs(n.h - target.h) <= 1e-8) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    Object.assign(n, target)
    if (updateNodeSpatialIndex(n, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
  } else if (op.type === 'rotate') {
    const angle = Math.atan2(e.clientY - op.cy, e.clientX - op.cx)
    let angleDelta = angle - op.start
    if (angleDelta > Math.PI) angleDelta -= Math.PI * 2
    if (angleDelta < -Math.PI) angleDelta += Math.PI * 2
    let rotation = Math.round(op.rotate + angleDelta * 180 / Math.PI)
    if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
    const candidate = { x: op.x, y: op.y, w: op.w, h: op.h, rotate: rotation }
    const { dx, dy } = constrainTranslation([candidate], 0, 0, stageWidth.value, stageHeight.value)
    const nextX = op.x + dx
    const nextY = op.y + dy
    if (rotation === n.rotate && nextX === n.x && nextY === n.y) return
    beginEditorLodGeometry(op)
    commitPointerOperation(op)
    n.x = nextX
    n.y = nextY
    n.rotate = rotation
    if (updateNodeSpatialIndex(n, false)) op.spatialIndexChanged = true
    requestEditorLodGeometryFrame(op)
  }
}
function releasePointerOperationBindings() {
  window.removeEventListener('pointermove', pointerMove)
  window.removeEventListener('pointerup', pointerUp)
  window.removeEventListener('pointercancel', pointerUp)
  window.removeEventListener('lostpointercapture', pointerUp)
  window.removeEventListener('blur', pointerUp)
  releaseCapturedPointer()
}

function pointerUp(e) {
  if (operation.value?.pointerId != null && e?.pointerId != null && e.pointerId !== operation.value.pointerId) return
  const finishedOperation = operation.value
  deactivateNodeMoveInteraction(finishedOperation)
  if (finishedOperation?.largeSelectionCommitPending) return
  const finishedType = finishedOperation?.type
  if (pendingPointer) { if (pointerFrame) cancelAnimationFrame(pointerFrame); applyPointerMove() }
  if (finishedOperation?.transientLargeSelection && finishedOperation.transientGeometryChanged) {
    selectionMarquee.value = null
    pendingPointer = null
    releasePointerOperationBindings()
    if (scheduleLargeSelectionCommit(finishedOperation)) return
  }
  if (finishedOperation?.transientLargeSelection) clearLargeSelectionTransform(finishedOperation)
  finishEditorLodGeometry(finishedOperation)
  operation.value = null
  selectionMarquee.value = null
  pendingPointer = null
  releasePointerOperationBindings()
  if (finishedType === 'draw') {
    finalizePencilDrawing(finishedOperation.id)
  }
  if (finishedOperation?.spatialIndexChanged) {
    nodeSpatialRevision.value += 1
    if (!documentIndexRebuildRequired) edgeSpatialRevision.value += 1
  }
  if (finishedOperation?.drawingSpatialIndexChanged) drawingSpatialRevision.value += 1
  if (finishedOperation?.historyCommitted) markMiniMapDirty()
  if (finishedOperation) endEditorInteraction(POINTER_INTERACTION)
  if (documentIndexRebuildRequired) scheduleDocumentIndexCompaction()
}

function openCanvasContextMenu(e) {
  if (editorLodActive.value && !e.target.closest?.('.node-shell, .drawing-hit')) {
    const hit = editorLodEntityFromEvent(e)
    if (hit?.kind === 'node') return openContextMenu(e, hit.entity)
    if (hit?.kind === 'drawing') return openContextMenu(e, null, hit.entity)
  }
  return openContextMenu(e)
}

async function openContextMenu(e, node = null, drawing = null) {
  e.preventDefault()
  e.stopPropagation()
  if (isPolylineNodeType(activeTool.value) && cancelPolylineDrawing(true)) return
  paperSelected.value = false
  if (node && !isNodeSelected(node.id)) selectSingleNode(node)
  if (drawing) { clearNodeSelection(); selectedDrawingId.value = drawing.id }
  const anchor = { x: e.clientX, y: e.clientY }
  contextMenu.value = {
    show: true,
    x: anchor.x,
    y: anchor.y,
    canvasPoint: pointFromEvent(e)
  }
  await nextTick()
  const menu = contextMenuElement.value
  if (!menu || !contextMenu.value.show) return
  const margin = 8
  const { width, height } = menu.getBoundingClientRect()
  const maxX = Math.max(margin, window.innerWidth - width - margin)
  const maxY = Math.max(margin, window.innerHeight - height - margin)
  const preferredX = anchor.x + width > window.innerWidth - margin ? anchor.x - width : anchor.x
  const preferredY = anchor.y + height > window.innerHeight - margin ? anchor.y - height : anchor.y
  contextMenu.value.x = Math.min(Math.max(margin, preferredX), maxX)
  contextMenu.value.y = Math.min(Math.max(margin, preferredY), maxY)
}
function closeContextMenu() {
  contextMenu.value.show = false
  showSaveMenu.value = false
}
function runContextAction(action) { action(); closeContextMenu() }

let viewportFrame = 0
let previewViewportScheduler = null
let resizeObserver
let previewResizeObserver
let previewScrollBeforeFit = null
let previewScrollBeforeFullscreen = null
function canvasViewportFromScroll(left, top, target = canvas.value) {
  return {
    left,
    top,
    width: target?.clientWidth || 0,
    height: target?.clientHeight || 0
  }
}
function commitCanvasViewport(left, top, target = canvas.value) {
  const nextViewport = canvasViewportFromScroll(left, top, target)
  const current = viewport.value
  if (current.left === nextViewport.left && current.top === nextViewport.top && current.width === nextViewport.width && current.height === nextViewport.height) return false
  viewport.value = nextViewport
  return true
}
function updateViewport(source = null) {
  const nextDevicePixelRatio = currentDevicePixelRatio()
  if (editorDevicePixelRatio.value !== nextDevicePixelRatio) editorDevicePixelRatio.value = nextDevicePixelRatio
  if (source?.type === 'scroll') pulseCanvasScrollInteraction()
  // 连续滚轮期间 DOM 已处于投影比例，暂不触发可见节点和连线重算。
  if (projectedCanvasZoom?.canvas === canvas.value) return
  if (viewportFrame) return
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0
    if (!canvas.value) return
    if (projectedCanvasZoom?.canvas === canvas.value) return
    if (canvasLocked.value && lockedCanvasView.value) {
      canvas.value.scrollLeft = lockedCanvasView.value.left
      canvas.value.scrollTop = lockedCanvasView.value.top
      commitCanvasViewport(lockedCanvasView.value.left, lockedCanvasView.value.top)
      return
    }
    commitCanvasViewport(canvas.value.scrollLeft, canvas.value.scrollTop)
  })
}
let projectedCanvasZoom = null
let canvasZoomCommitTimer = 0
let canvasZoomRenderPending = false
const CANVAS_ZOOM_COMMIT_DELAY = 96
const CANVAS_ZOOM_GESTURE_DISTANCE = 8
let canvasZoomGesture = null
function clearCanvasZoomGesture() {
  canvasZoomGesture = null
}
function trackCanvasZoomPointer(e) {
  if (!canvasZoomGesture || canvasZoomGesture.canvas !== e.currentTarget) return
  if (!Number.isFinite(Number(e.clientX)) || !Number.isFinite(Number(e.clientY))) return
  if (Math.hypot(canvasZoomGesture.clientX - e.clientX, canvasZoomGesture.clientY - e.clientY) > CANVAS_ZOOM_GESTURE_DISTANCE) clearCanvasZoomGesture()
}
function createCanvasZoomTarget(value, clientX, clientY, { wheelGesture = false } = {}) {
  if (!canvas.value || canvasLocked.value || operation.value) return
  if (!wheelGesture) clearCanvasZoomGesture()
  const requestedZoom = Number(value)
  if (!Number.isFinite(requestedZoom)) return
  const targetCanvas = canvas.value
  const source = projectedCanvasZoom?.canvas === targetCanvas
    ? projectedCanvasZoom
    : { canvas: targetCanvas, zoom: zoom.value, left: targetCanvas.scrollLeft, top: targetCanvas.scrollTop }
  const oldZoom = source.zoom
  const nextZoom = clampCanvasZoom(requestedZoom, oldZoom)
  const rect = targetCanvas.getBoundingClientRect()
  const viewportLeft = rect.left + targetCanvas.clientLeft
  const viewportTop = rect.top + targetCanvas.clientTop
  const pointerX = Math.max(0, Math.min(targetCanvas.clientWidth, (clientX ?? viewportLeft + targetCanvas.clientWidth / 2) - viewportLeft))
  const pointerY = Math.max(0, Math.min(targetCanvas.clientHeight, (clientY ?? viewportTop + targetCanvas.clientHeight / 2) - viewportTop))
  const pointerClientX = viewportLeft + pointerX
  const pointerClientY = viewportTop + pointerY
  const reuseGesture = wheelGesture && canvasZoomGesture?.canvas === targetCanvas && Math.hypot(canvasZoomGesture.clientX - pointerClientX, canvasZoomGesture.clientY - pointerClientY) <= CANVAS_ZOOM_GESTURE_DISTANCE
  const anchorX = reuseGesture ? canvasZoomGesture.anchorX : pointerX
  const anchorY = reuseGesture ? canvasZoomGesture.anchorY : pointerY
  const focusWorldX = reuseGesture ? canvasZoomGesture.worldX : Math.max(0, Math.min(stageWidth.value, (source.left + pointerX) / oldZoom))
  const focusWorldY = reuseGesture ? canvasZoomGesture.worldY : Math.max(0, Math.min(stageHeight.value, (source.top + pointerY) / oldZoom))
  if (wheelGesture) {
    if (!reuseGesture) canvasZoomGesture = { canvas: targetCanvas, clientX: pointerClientX, clientY: pointerClientY, anchorX, anchorY, worldX: focusWorldX, worldY: focusWorldY }
  }
  if (nextZoom === oldZoom) return
  const scroll = anchoredCanvasScroll({
    scrollLeft: source.left,
    scrollTop: source.top,
    fromZoom: oldZoom,
    toZoom: nextZoom,
    anchorX,
    anchorY,
    anchorWorldX: focusWorldX,
    anchorWorldY: focusWorldY
  })
  const maxLeft = Math.max(0, stageWidth.value * nextZoom - targetCanvas.clientWidth)
  const maxTop = Math.max(0, stageHeight.value * nextZoom - targetCanvas.clientHeight)
  const target = {
    canvas: targetCanvas,
    zoom: nextZoom,
    left: Math.max(0, Math.min(maxLeft, scroll.left)),
    top: Math.max(0, Math.min(maxTop, scroll.top))
  }
  return target
}
function canvasRenderBoundsForViewport(currentViewport, scale) {
  const overscan = nodes.value.length >= LARGE_DOCUMENT_NODE_COUNT ? LARGE_DOCUMENT_OVERSCAN : DEFAULT_VIEWPORT_OVERSCAN
  return viewportWorldBounds(currentViewport, scale, overscan)
}
function expandTransientCanvasRenderBounds(target) {
  const currentBounds = transientCanvasRenderBounds.value || canvasRenderBoundsForViewport(viewport.value, zoom.value)
  const targetViewport = canvasViewportFromScroll(target.left, target.top, target.canvas)
  const expandedBounds = expandCanvasBounds(currentBounds, canvasRenderBoundsForViewport(targetViewport, target.zoom))
  if (expandedBounds === currentBounds) return false
  transientCanvasRenderBounds.value = expandedBounds
  return true
}
function clearTransientCanvasRenderBounds() {
  if (transientCanvasRenderBounds.value) transientCanvasRenderBounds.value = null
}
function renderTransientCanvasZoom(target) {
  if (!target || target !== projectedCanvasZoom || target.canvas !== canvas.value || !stageSpace.value || !stage.value) return false
  stageSpace.value.style.width = `${stageWidth.value * target.zoom}px`
  stageSpace.value.style.height = `${stageHeight.value * target.zoom}px`
  stage.value.style.transform = `scale(${target.zoom})`
  if (editorLodSurface.value) {
    editorLodSurface.value.style.transformOrigin = '0 0'
    editorLodSurface.value.style.transform = `scale(${target.zoom / Math.max(.0001, zoom.value)})`
  }
  target.canvas.scrollTo({ left: target.left, top: target.top })
  return true
}
function clearTransientEditorLodScale() {
  void nextTick(() => {
    if (editorLodSurface.value) editorLodSurface.value.style.transform = ''
  })
}
function scheduleTransientCanvasZoomRender() {
  if (canvasZoomRenderPending) return
  canvasZoomRenderPending = true
  void nextTick(() => {
    canvasZoomRenderPending = false
    renderTransientCanvasZoom(projectedCanvasZoom)
  })
}
function applyTransientCanvasZoom(target) {
  if (!target || target.canvas !== canvas.value || !stageSpace.value || !stage.value) return false
  projectedCanvasZoom = target
  // 新区域先通过空间索引增量挂载；已有覆盖范围内仍只修改固定的合成层节点。
  if (expandTransientCanvasRenderBounds(target) || canvasZoomRenderPending) scheduleTransientCanvasZoomRender()
  else renderTransientCanvasZoom(target)
  return true
}
function commitCanvasZoomTarget(target = projectedCanvasZoom) {
  if (!target || target !== projectedCanvasZoom || target.canvas !== canvas.value) return false
  if (canvasZoomCommitTimer) clearTimeout(canvasZoomCommitTimer)
  canvasZoomCommitTimer = 0
  projectedCanvasZoom = null
  // 视口必须先于比例发布，避免一次“新比例 + 旧视口”的中间渲染。
  commitCanvasViewport(target.canvas.scrollLeft, target.canvas.scrollTop, target.canvas)
  zoom.value = target.zoom
  clearTransientCanvasRenderBounds()
  clearTransientEditorLodScale()
  clearCanvasZoomGesture()
  endEditorInteraction(CANVAS_ZOOM_INTERACTION)
  return true
}
function scheduleCanvasZoomCommit(target) {
  if (canvasZoomCommitTimer) clearTimeout(canvasZoomCommitTimer)
  canvasZoomCommitTimer = setTimeout(() => {
    canvasZoomCommitTimer = 0
    if (!target || target !== projectedCanvasZoom || target.canvas !== canvas.value) {
      endEditorInteraction(CANVAS_ZOOM_INTERACTION)
      return
    }
    projectedCanvasZoom = null
    commitCanvasViewport(target.canvas.scrollLeft, target.canvas.scrollTop, target.canvas)
    zoom.value = target.zoom
    clearTransientCanvasRenderBounds()
    clearTransientEditorLodScale()
    clearCanvasZoomGesture()
    endEditorInteraction(CANVAS_ZOOM_INTERACTION)
  }, CANVAS_ZOOM_COMMIT_DELAY)
}
async function setCanvasZoom(value, clientX, clientY) {
  const target = createCanvasZoomTarget(value, clientX, clientY)
  if (!target || !applyTransientCanvasZoom(target)) return
  await nextTick()
  if (!renderTransientCanvasZoom(target)) return
  commitCanvasZoomTarget(target)
}
let canvasWheelFrame = 0
let pendingCanvasWheelSteps = 0
let pendingCanvasWheelAnchor = null
function cancelPendingCanvasZoom({ commit = true } = {}) {
  pendingCanvasWheelSteps = 0
  pendingCanvasWheelAnchor = null
  if (canvasWheelFrame) cancelAnimationFrame(canvasWheelFrame)
  canvasWheelFrame = 0
  if (canvasZoomCommitTimer) clearTimeout(canvasZoomCommitTimer)
  canvasZoomCommitTimer = 0
  const target = projectedCanvasZoom
  if (commit && target) {
    if (!commitCanvasZoomTarget(target)) endEditorInteraction(CANVAS_ZOOM_INTERACTION)
    return
  }
  projectedCanvasZoom = null
  canvasZoomRenderPending = false
  clearTransientCanvasRenderBounds()
  clearCanvasZoomGesture()
  if (canvas.value && stageSpace.value && stage.value) {
    stageSpace.value.style.width = `${stageWidth.value * zoom.value}px`
    stageSpace.value.style.height = `${stageHeight.value * zoom.value}px`
    stage.value.style.transform = `scale(${zoom.value})`
    if (editorLodSurface.value) editorLodSurface.value.style.transform = ''
    canvas.value.style.setProperty('--inverse-zoom', String(1 / zoom.value))
    commitCanvasViewport(canvas.value.scrollLeft, canvas.value.scrollTop)
  }
  endEditorInteraction(CANVAS_ZOOM_INTERACTION)
}
function canvasWheel(e) {
  if (canvasLocked.value || operation.value) return
  const targetCanvas = canvas.value
  if (!targetCanvas) return
  const direction = Math.sign(-Number(e.deltaY))
  if (!direction) return
  beginEditorInteraction(CANVAS_ZOOM_INTERACTION)
  pendingCanvasWheelSteps += direction
  pendingCanvasWheelAnchor = { x: e.clientX, y: e.clientY }
  if (canvasWheelFrame) return
  canvasWheelFrame = requestAnimationFrame(() => {
    canvasWheelFrame = 0
    const steps = pendingCanvasWheelSteps
    const anchor = pendingCanvasWheelAnchor
    pendingCanvasWheelSteps = 0
    pendingCanvasWheelAnchor = null
    if (!steps || !anchor || canvasLocked.value || operation.value) {
      endEditorInteraction(CANVAS_ZOOM_INTERACTION)
      return
    }
    const sourceZoom = projectedCanvasZoom?.canvas === targetCanvas ? projectedCanvasZoom.zoom : zoom.value
    const target = createCanvasZoomTarget(steppedCanvasZoom(sourceZoom, steps), anchor.x, anchor.y, { wheelGesture: true })
    if (!target || !applyTransientCanvasZoom(target)) {
      endEditorInteraction(CANVAS_ZOOM_INTERACTION)
      return
    }
    scheduleCanvasZoomCommit(target)
  })
}
async function resetCanvasView() {
  if (canvasLocked.value || operation.value) return
  cancelPendingCanvasZoom({ commit: false })
  commitCanvasViewport(0, 0)
  zoom.value = 1
  await nextTick()
  canvas.value?.scrollTo({ left: 0, top: 0 })
  commitCanvasViewport(0, 0)
}
function toggleCanvasLock() {
  cancelPendingCanvasZoom()
  if (operation.value) pointerUp()
  const nextLocked = !canvasLocked.value
  canvasLocked.value = nextLocked
  lockedCanvasView.value = nextLocked && canvas.value ? { left: canvas.value.scrollLeft, top: canvas.value.scrollTop, zoom: zoom.value } : null
  notify(canvasLocked.value ? '画布位置已固定' : '画布位置已解除固定')
}
function navigateMiniMap(e) {
  if (!canvas.value || canvasLocked.value || operation.value) return
  cancelPendingCanvasZoom()
  const rect = e.currentTarget.getBoundingClientRect()
  const point = miniMapWorldPoint(miniMapRenderTransform.value, {
    x: (e.clientX - rect.left) / rect.width * miniMapWidth,
    y: (e.clientY - rect.top) / rect.height * miniMapHeight
  })
  canvas.value.scrollTo({
    left: point.x * zoom.value - canvas.value.clientWidth / 2,
    top: point.y * zoom.value - canvas.value.clientHeight / 2
  })
  updateViewport()
}
function previewAvailableSize(target = previewCanvas.value, contentRect = null) {
  const observedWidth = Number(contentRect?.width)
  const observedHeight = Number(contentRect?.height)
  const hasObservedSize = Number.isFinite(observedWidth) && observedWidth > 0 && Number.isFinite(observedHeight) && observedHeight > 0
  let availableWidth = Math.max(1, hasObservedSize ? observedWidth : target?.clientWidth || window.innerWidth || stageWidth.value)
  let availableHeight = Math.max(1, hasObservedSize ? observedHeight : target?.clientHeight || (window.innerHeight || stageHeight.value) - 50)
  let paddingLeft = 0
  let paddingTop = 0
  if (target && !hasObservedSize) {
    const style = getComputedStyle(target)
    paddingLeft = parseFloat(style.paddingLeft) || 0
    paddingTop = parseFloat(style.paddingTop) || 0
    availableWidth = Math.max(1, availableWidth - paddingLeft - (parseFloat(style.paddingRight) || 0))
    availableHeight = Math.max(1, availableHeight - paddingTop - (parseFloat(style.paddingBottom) || 0))
  } else if (target) {
    const style = getComputedStyle(target)
    paddingLeft = parseFloat(style.paddingLeft) || 0
    paddingTop = parseFloat(style.paddingTop) || 0
  }
  return { width: availableWidth, height: availableHeight, paddingLeft, paddingTop }
}
function fittedPreviewScale(target = previewCanvas.value, contentRect = null) {
  const available = previewAvailableSize(target, contentRect)
  const scale = Math.min(available.width / stageWidth.value, available.height / stageHeight.value)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}
function previewFitOffsetForScale() {
  return { left: 0, top: 0 }
}
function syncPreviewFitOffset(target = previewCanvas.value, contentRect = null) {
  if (!target) return false
  if (!previewFitLayoutRequested.value && !previewFittedVisible.value) {
    if (!previewFitOffset.value.left && !previewFitOffset.value.top) return false
    previewFitOffset.value = { left: 0, top: 0 }
    return true
  }
  const next = previewFitOffsetForScale(previewFitScale.value, target, contentRect)
  if (Math.abs(next.left - previewFitOffset.value.left) < 1e-6 && Math.abs(next.top - previewFitOffset.value.top) < 1e-6) return false
  previewFitOffset.value = next
  return true
}
function syncPreviewFitCommittedOffset(target = previewCanvas.value, contentRect = null) {
  if (!target || !previewFitFrameAvailable.value) return false
  const next = previewFitOffsetForScale(previewFitCommittedScale.value, target, contentRect)
  if (
    Math.abs(next.left - previewFitCommittedOffset.value.left) < 1e-6
    && Math.abs(next.top - previewFitCommittedOffset.value.top) < 1e-6
  ) return false
  previewFitCommittedOffset.value = next
  return true
}
function commitPreviewFitPresentation(event) {
  const width = Number(event?.width)
  const scale = Number.isFinite(width) && width > 0
    ? width / Math.max(1, stageWidth.value)
    : previewFitCanvasScale.value
  previewFitCommittedScale.value = scale
  previewFitCommittedOffset.value = previewFitOffsetForScale(scale)
  previewFitCommittedPixelRatio.value = Math.min(
    finiteNumber(event?.pixelRatioX, 0),
    finiteNumber(event?.pixelRatioY, 0)
  )
}
function resetPreviewFitPresentation() {
  previewFitCommittedScale.value = 1
  previewFitCommittedOffset.value = { left: 0, top: 0 }
  previewFitCommittedPixelRatio.value = 0
}
function resetPreviewDomReadyState() {
  previewMediaReadinessGate.cancel(previewDomStage.value)
  previewDomNodesReady.value = false
  previewDomGeometryReady.value = false
}
function resetPreviewDomHandoff({ target = true } = {}) {
  if (target) previewRenderTarget.value = 'dom'
  previewDomMounted.value = true
  previewDomGeneration.value += 1
  resetPreviewDomReadyState()
}
function ensurePreviewDomHandoff() {
  if (previewDomMounted.value && previewRenderTarget.value === 'dom') return false
  resetPreviewDomHandoff()
  return true
}
function clearPreviewFitCommittedPlan() {
  previewFitCommittedPlanKey.value = ''
  previewFitCommittedOverlayNodes.value = []
  previewFitCommittedOverlayDrawings.value = []
}
function resetPreviewFitCanvasState({ clearFailure = true } = {}) {
  previewFitEnsureGeneration += 1
  previewFitFallbackIdleTask.cancel()
  previewFitMounted.value = false
  previewFitCanvasReady.value = false
  previewFitFrameAvailable.value = false
  if (clearFailure) previewFitCanvasFailed.value = false
  resetPreviewFitPresentation()
  clearPreviewFitCommittedPlan()
  invalidatePreviewFitDocument()
}
function previewFitRenderPlanMatches(event) {
  const plan = previewFitPlan.value
  const eventNodeIds = Array.isArray(event?.excludedNodeIds) ? event.excludedNodeIds : []
  const eventDrawingIds = Array.isArray(event?.excludedDrawingIds) ? event.excludedDrawingIds : []
  return event?.renderPlanKey === plan.key
    && eventNodeIds.length === plan.overlayNodeIds.length
    && eventNodeIds.every((id, index) => id === plan.overlayNodeIds[index])
    && eventDrawingIds.length === plan.overlayDrawingIds.length
    && eventDrawingIds.every((id, index) => id === plan.overlayDrawingIds[index])
}
function canCommitPreviewFitFrame(event) {
  if (event?.kind === 'full' && Number(event.pendingImages) !== 0) return false
  if (event?.kind === 'full' && !previewFitRenderPlanMatches(event)) return false
  return previewFrameFreshness.canCommitRender(event)
}
function handlePreviewFitRenderRejected(event) {
  if (!showPreview.value || !previewFitMounted.value) return
  // 图片 load/error 会合并触发下一次完整渲染；立即重试只会重复生成占位帧。
  if (Number(event?.pendingImages) > 0) return
  void nextTick(() => {
    if (previewCanvasDocumentRenderTimer) return
    if (!previewFitCanvas.value?.renderState?.pending) requestPreviewFitDocumentRender()
  })
}
function commitPreviewFitRenderPlan() {
  const plan = previewFitPlan.value
  previewFitCommittedPlanKey.value = plan.key
  previewFitCommittedOverlayNodes.value = plan.overlayNodes.slice()
  previewFitCommittedOverlayDrawings.value = plan.overlayDrawings.slice()
}
function releasePreviewFitCanvas() {
  if (previewFallbackRequired.value) return false
  resetPreviewFitCanvasState({ clearFailure: false })
  return true
}
function previewCanvasBoundsMatch(left, right) {
  return Boolean(left && right)
    && left.x === right.x
    && left.y === right.y
    && left.w === right.w
    && left.h === right.h
}
function previewEdgeCanvasFramePixelRatio(event) {
  return Math.min(
    finiteNumber(event?.pixelRatioX, 0),
    finiteNumber(event?.pixelRatioY, 0)
  )
}
function previewEdgeCanvasFrameMatchesRequest(event) {
  return ['full', 'runtime'].includes(event?.kind)
    && previewDomEdgeCanvasActive.value
    && event.renderPlanKey === previewEdgeCanvasPlanKey.value
    && previewCanvasBoundsMatch(event.viewBox, previewEdgeCanvasBounds.value)
}
function canCommitPreviewEdgeCanvasFrame(event) {
  if (!previewEdgeCanvasFrameMatchesRequest(event)) return false
  if (!previewBitmapIsSharp(
    previewEdgeCanvasFramePixelRatio(event),
    previewEdgeCanvasPixelRatio.value
  )) return false
  if (event.kind === 'full') return true
  return previewEdgeCanvasReady.value
    && event.pendingFull !== true
    && event.renderPlanKey === previewEdgeCanvasCommittedPlanKey.value
    && previewCanvasBoundsMatch(event.viewBox, previewEdgeCanvasCommittedBounds.value)
}
function handlePreviewEdgeCanvasRenderRejected(event) {
  if (event?.kind !== 'full' || !previewEdgeCanvasFrameMatchesRequest(event)) return
  previewEdgeCanvasReady.value = false
  if (!previewBitmapIsSharp(
    previewEdgeCanvasFramePixelRatio(event),
    previewEdgeCanvasPixelRatio.value
  )) handlePreviewEdgeCanvasRenderError()
}
function handlePreviewEdgeCanvasRenderComplete(event) {
  if (!previewEdgeCanvasFrameMatchesRequest(event)) return
  if (event.kind === 'runtime') return
  const renderedPixelRatio = previewEdgeCanvasFramePixelRatio(event)
  if (!previewBitmapIsSharp(renderedPixelRatio, previewEdgeCanvasPixelRatio.value)) {
    handlePreviewEdgeCanvasRenderError()
    return
  }
  const renderedBounds = event.viewBox
  previewEdgeCanvasCommittedBounds.value = { ...renderedBounds }
  previewEdgeCanvasCommittedPixelRatio.value = renderedPixelRatio
  previewEdgeCanvasCommittedPlanKey.value = event.renderPlanKey
  previewEdgeCanvasReady.value = true
  finishPreviewDomHandoff()
}
function handlePreviewEdgeCanvasRenderError() {
  previewEdgeCanvasReady.value = false
  previewEdgeCanvasCommittedBounds.value = null
  previewEdgeCanvasCommittedPixelRatio.value = 0
  previewEdgeCanvasCommittedPlanKey.value = ''
  previewEdgeCanvasFailed.value = true
  previewDomGeneration.value += 1
  resetPreviewDomReadyState()
  startPreviewFitCanvasFallback()
}
function handlePreviewDomRenderStart(event) {
  if (event?.generation !== previewDomGeneration.value) return
  previewMediaReadinessGate.cancel(previewDomStage.value)
  previewDomNodesReady.value = false
}
function handlePreviewGeometryRenderStart(event) {
  if (event?.generation !== previewDomGeneration.value) return
  previewDomGeometryReady.value = false
}
function resumeVisiblePreviewAnimationClocks() {
  if (!showPreview.value || !previewPresentationReady.value) return false
  let resumed = false
  if (previewCanvasVisible.value) {
    resumed = previewFitCanvas.value?.resumeCommittedAnimationClock?.() === true || resumed
  }
  if (previewEdgeCanvasVisible.value) {
    resumed = previewEdgeCanvas.value?.resumeCommittedAnimationClock?.() === true || resumed
  }
  return resumed
}
function presentPreparedPreview() {
  if (previewPresentationReady.value) return
  // 先保留编辑器完整画面，预览节点和几何都提交后再在同一响应式批次切换。
  pauseEditorLodRendering()
  clearEditorProgressiveDomMount()
  previewPresentationReady.value = true
  resumeWorkspaceSessionPersistenceAfterPreview()
}
function finishPreviewDomHandoff() {
  if (
    !showPreview.value
    || !previewDomMounted.value
    || !previewDomReady.value
    || previewRenderTarget.value !== 'dom'
    || (previewLivePlaneActive.value && !previewLivePlaneReady.value)
    || (previewDomEdgeCanvasActive.value && !previewEdgeCanvasVisible.value)
  ) return
  // 高清视口已经覆盖当前窗口时不等待整图兜底；兜底继续在空闲时生成，供快速滚动换帧使用。
  // 视口 Canvas 不可用时仍等待整图兜底或完整 DOM，避免以漏绘换取首屏速度。
  if (
    previewFallbackRequired.value
    && !previewDomFullDocumentRequested.value
    && !previewFitFrameAvailable.value
    && !previewEdgeCanvasVisible.value
  ) return
  previewViewportTransitioning.value = false
  previewDisplayMode.value = previewFitLayoutRequested.value ? 'dom-fit' : 'dom'
  presentPreparedPreview()
  if (previewEdgeCanvasVisible.value) schedulePreviewFitCanvasFallback()
  // 原始尺寸视口滚动期间保留低清整图作瞬时底图；高清视口帧提交后会覆盖它。
  if (!previewDomEdgeCanvasActive.value) releasePreviewFitCanvas()
  if (!previewFitLayoutRequested.value) void nextTick(restorePreviewScroll)
}
async function handlePreviewDomRenderComplete(event) {
  if (event?.generation !== previewDomGeneration.value) return
  if (event?.count !== previewDomNodes.value.length) return
  await nextTick()
  if (event?.generation !== previewDomGeneration.value || event?.count !== previewDomNodes.value.length) return
  const mountedCount = previewDomStage.value?.querySelectorAll('.preview-node').length ?? 0
  if (mountedCount !== event.count) return
  const mediaSettled = await previewMediaReadinessGate.wait(previewDomStage.value)
  if (!mediaSettled) return
  if (event?.generation !== previewDomGeneration.value || event?.count !== previewDomNodes.value.length) return
  if ((previewDomStage.value?.querySelectorAll('.preview-node').length ?? 0) !== event.count) return
  previewDomNodesReady.value = true
  finishPreviewDomHandoff()
}
function handlePreviewGeometryRenderComplete(event) {
  if (event?.generation !== previewDomGeneration.value) return
  if (event?.edgeCount !== previewDomEdges.value.length) return
  if (event?.drawingCount !== previewDomDrawings.value.length) return
  previewDomGeometryReady.value = true
  finishPreviewDomHandoff()
}
function handlePreviewLivePlaneRenderStart(event) {
  if (event?.generation !== previewLivePlaneGeneration.value) return
  previewMediaReadinessGate.cancel(previewLivePlaneStage.value)
  previewLivePlaneReady.value = false
}
async function handlePreviewLivePlaneRenderComplete(event) {
  if (event?.generation !== previewLivePlaneGeneration.value) return
  if (event?.count !== previewLivePlaneNodes.value.length) return
  await nextTick()
  if (event?.generation !== previewLivePlaneGeneration.value || event?.count !== previewLivePlaneNodes.value.length) return
  const mountedCount = previewLivePlaneStage.value?.querySelectorAll('.preview-node').length ?? 0
  if (mountedCount !== event.count) return
  const mediaSettled = await previewMediaReadinessGate.wait(previewLivePlaneStage.value)
  if (!mediaSettled) return
  if (event?.generation !== previewLivePlaneGeneration.value || event?.count !== previewLivePlaneNodes.value.length) return
  if ((previewLivePlaneStage.value?.querySelectorAll('.preview-node').length ?? 0) !== event.count) return
  previewLivePlaneReady.value = true
  if (previewRenderTarget.value === 'fit') showPreviewFitFrame({ resetScroll: false })
  else finishPreviewDomHandoff()
}
function invalidatePreviewViewportSchedule() {
  previewViewportScheduler?.invalidate()
  previewViewportTransitioning.value = false
}
function updatePreviewViewport(source = null) {
  const nextDevicePixelRatio = currentDevicePixelRatio()
  if (previewDevicePixelRatio.value !== nextDevicePixelRatio) previewDevicePixelRatio.value = nextDevicePixelRatio
  const resizeEntry = Array.isArray(source)
    ? source.find(entry => entry?.target === previewCanvas.value)
    : null
  const contentRect = resizeEntry?.contentRect || source?.contentRect
  const scrollTarget = source?.type === 'scroll' ? source.currentTarget : null
  if (
    scrollTarget
    && previewViewport.value.left === scrollTarget.scrollLeft
    && previewViewport.value.top === scrollTarget.scrollTop
  ) return
  // 滚动事件先于下一次空间查询到达；同一任务内立即切到完整旧帧，避免浏览器先绘制空区。
  if (scrollTarget && previewRenderTarget.value === 'dom' && previewFitFrameAvailable.value) {
    previewViewportTransitioning.value = true
  }
  schedulePreviewViewport({
    contentRect,
    scroll: source?.scroll,
    refreshFit: source?.refreshFit,
    waitForContentRect: source?.waitForContentRect
  })
}
function schedulePreviewViewport(update) {
  if (!previewViewportScheduler) {
    previewViewportScheduler = createPreviewViewportScheduler({
      requestFrame: callback => requestAnimationFrame(callback),
      cancelFrame: frame => cancelAnimationFrame(frame),
      flush: flushPreviewViewport
    })
  }
  previewViewportScheduler.schedule(update)
}
function flushPreviewViewport({ contentRect, scroll, refreshFit }) {
  const target = previewCanvas.value
  if (!target) {
    previewViewportTransitioning.value = false
    return
  }
  const generationBefore = previewDomGeneration.value
  if (previewFitLayoutRequested.value) {
    previewFitScale.value = fittedPreviewScale(target, contentRect)
    syncPreviewFitOffset(target, contentRect)
  } else if (scroll) {
    commitPreviewViewport(scroll.left, scroll.top, target, contentRect)
  } else if (contentRect) {
    commitPreviewViewport(target.scrollLeft, target.scrollTop, target, contentRect)
  } else {
    commitPreviewViewport(target.scrollLeft, target.scrollTop, target)
  }
  if (previewFittedVisible.value && previewFitFrameAvailable.value) {
    syncPreviewFitCommittedOffset(target, contentRect)
  }
  if (previewDomEdgeCanvasActive.value) syncPreviewEdgeCanvasBounds()
  if (scroll) target.scrollTo(scroll)
  // 仍在原保留区内时无需重挂 DOM，当前完整层可在本帧继续显示。
  if (previewViewportTransitioning.value && previewDomGeneration.value === generationBefore) {
    previewViewportTransitioning.value = false
  }
  if (refreshFit && previewFitLayoutRequested.value && previewFitCanUseCanvas.value) {
    const scale = previewFitScale.value
    if (previewFitFrameAvailable.value) showPreviewFitFrame({ resetScroll: false })
    void ensurePreviewFitCanvas({ scale }).then(() => showPreviewFitFrame({ resetScroll: false }))
  }
}
function commitPreviewViewport(left, top, target = previewCanvas.value, contentRect = null) {
  if (!target) return false
  const observedWidth = Number(contentRect?.width)
  const observedHeight = Number(contentRect?.height)
  const width = Math.max(1, Number.isFinite(observedWidth) && observedWidth > 0 ? observedWidth : target.clientWidth || window.innerWidth || 1)
  const height = Math.max(1, Number.isFinite(observedHeight) && observedHeight > 0 ? observedHeight : target.clientHeight || window.innerHeight || 1)
  const next = {
    left: Math.max(0, Math.min(Math.max(0, stageWidth.value - width), Number(left) || 0)),
    top: Math.max(0, Math.min(Math.max(0, stageHeight.value - height), Number(top) || 0)),
    width,
    height
  }
  const current = previewViewport.value
  if (current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height) return false
  previewViewport.value = next
  return true
}
function previewCanvasHasFrame() {
  return previewFitCanvas.value?.getCanvasElement?.()?.dataset?.renderReady === 'true'
}
function previewFitFallbackCanMount() {
  return showPreview.value && previewFallbackRequired.value && !previewFitMounted.value
}
function schedulePreviewFitCanvasFallback() {
  if (
    !previewFitFallbackCanMount()
    || !previewPresentationReady.value
    || !previewEdgeCanvasVisible.value
  ) return false
  if (previewFitFallbackIdleTask.pending) return true
  return previewFitFallbackIdleTask.schedule(() => {
    if (
      !previewFitFallbackCanMount()
      || !previewPresentationReady.value
      || !previewEdgeCanvasVisible.value
    ) return
    void ensurePreviewFitCanvas({ target: false })
  })
}
function startPreviewFitCanvasFallback() {
  previewFitFallbackIdleTask.cancel()
  if (!showPreview.value || !previewFallbackRequired.value) return false
  void ensurePreviewFitCanvas({ target: false })
  return true
}
async function ensurePreviewFitCanvas({ scale = null, target = true } = {}) {
  previewFitFallbackIdleTask.cancel()
  if (!showPreview.value) return false
  const ensureGeneration = previewFitEnsureGeneration
  if (target && !previewFitCanUseCanvas.value) {
    resetPreviewDomHandoff()
    return false
  }
  if (target) {
    previewFitCanvasFailed.value = false
    previewRenderTarget.value = 'fit'
  }
  const requestedScale = Number(scale)
  previewFitScale.value = Number.isFinite(requestedScale) && requestedScale > 0
    ? requestedScale
    : fittedPreviewScale(previewCanvas.value)
  const targetEpochBefore = previewFrameFreshness.targetState().targetEpoch
  const mountedNow = !previewFitMounted.value
  if (mountedNow) {
    previewFitMounted.value = true
    previewFitCanvasReady.value = false
    previewFitFrameAvailable.value = false
    invalidatePreviewFitDocument()
  }
  await nextTick()
  if (
    !showPreview.value
    || !previewFitMounted.value
    || ensureGeneration !== previewFitEnsureGeneration
  ) return false
  if (previewCanvasHasFrame()) {
    previewFitCanvasReady.value = true
    previewFitFrameAvailable.value = true
  }
  clearPreviewCanvasDocumentRenderTimer()
  previewFrameFreshness.requestDocumentRender(previewFitFrameTargetOptions())
  syncPreviewFitFrameFreshness()
  const targetChanged = previewFrameFreshness.targetState().targetEpoch !== targetEpochBefore
  if (!mountedNow && !targetChanged && !previewFitCanvas.value?.renderState?.pending && !previewFitFrameFresh.value) {
    requestPreviewFitDocumentRender()
  }
  return previewFitFrameAvailable.value && previewFitFrameFresh.value
}
function showPreviewFitFrame({ resetScroll = true } = {}) {
  if (!showPreview.value || !previewFitActive.value || !previewFitFrameAvailable.value || !previewFitFrameFresh.value) return false
  if (!previewFitCanUseCanvas.value) {
    resetPreviewDomHandoff()
    return false
  }
  if (previewFitCommittedPlanKey.value !== previewFitPlan.value.key) return false
  if (previewFitCommittedUsesDomOverlay.value && !previewLivePlaneReady.value) return false
  syncPreviewFitCommittedOffset()
  previewDisplayMode.value = 'fit'
  previewDomMounted.value = false
  resetPreviewDomReadyState()
  presentPreparedPreview()
  if (resetScroll && (previewCanvas.value?.scrollLeft || previewCanvas.value?.scrollTop)) {
    updatePreviewViewport({ scroll: { left: 0, top: 0 } })
  }
  return true
}
function handlePreviewFitRenderComplete(event) {
  if (!['full', 'runtime'].includes(event?.kind)) return
  if (event.kind === 'full') {
    const frameIsSharp = previewBitmapIsSharp(
      Math.min(finiteNumber(event.pixelRatioX, 0), finiteNumber(event.pixelRatioY, 0)),
      previewFitPixelRatio.value
    )
    // 原始尺寸仅把低分辨率整图作为换代兜底；自适应最终画面仍必须达到清晰度门槛。
    if (!frameIsSharp && previewRenderTarget.value === 'fit') return handlePreviewFitRenderError()
    if (!previewFitRenderPlanMatches(event)) {
      invalidatePreviewFitDocument()
      handlePreviewFitRenderRejected()
      return
    }
  }
  if (event.kind === 'runtime' && (event.pendingRuntime || runtimeCanvasDirtyQueue.hasPending())) return
  const fresh = previewFrameFreshness.handleRenderComplete(event)
  syncPreviewFitFrameFreshness()
  if (!fresh) return
  if (event.kind === 'full') {
    previewFitCanvasReady.value = true
    previewFitFrameAvailable.value = true
    commitPreviewFitRenderPlan()
    commitPreviewFitPresentation(event)
    // 原始尺寸模式也依赖这张完整帧完成首次交接，避免 DOM 先完成后立即滚动产生空白。
    if (previewRenderTarget.value === 'dom') finishPreviewDomHandoff()
  }
  if (previewRenderTarget.value === 'fit') showPreviewFitFrame()
  else if (event.kind === 'full' && previewAutoFit.value && !previewFullscreen.value && previewFitCanUseCanvas.value) {
    previewRenderTarget.value = 'fit'
    showPreviewFitFrame({ resetScroll: false })
  }
}
function handlePreviewFitRenderError(event = null) {
  const retainsCommittedFrame = previewFitFrameAvailable.value
    && event?.preservesVisibleFrame === true
  previewFitCanvasReady.value = false
  invalidatePreviewFitDocument()
  if (retainsCommittedFrame) {
    // 私有面失败或提交已回滚时继续展示上一张权威帧，只在后台重试新帧。
    previewFitCanvasFailed.value = false
    void nextTick(() => {
      if (!showPreview.value || !previewFitMounted.value || previewFitCanvas.value?.renderState?.pending) return
      requestPreviewFitDocumentRender()
    })
    return
  }
  previewFitFrameAvailable.value = false
  previewFitCanvasFailed.value = true
  resetPreviewFitPresentation()
  if (!showPreview.value || previewRenderTarget.value !== 'fit') return
  resetPreviewDomHandoff()
  if (!retainsCommittedFrame) {
    // Context 丢失时画布本身不可再作为兜底，先露出完整编辑画面，完整 DOM 就绪后再原子呈现。
    previewDisplayMode.value = 'dom'
    previewPresentationReady.value = false
  }
}
function rememberPreviewScroll() {
  if (!previewCanvas.value || previewScrollBeforeFit) return
  previewScrollBeforeFit = {
    left: previewCanvas.value.scrollLeft,
    top: previewCanvas.value.scrollTop
  }
}
function restorePreviewScroll() {
  const position = previewScrollBeforeFit
  previewScrollBeforeFit = null
  if (!position) return
  if (!previewFitActive.value) updatePreviewViewport({ scroll: position })
}
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function previewFullscreenTarget() {
  return document.documentElement
}
function handleFullscreenChange() {
  const wasFullscreen = previewFullscreen.value
  const isFullscreen = fullscreenElement() === previewFullscreenTarget()
  if (wasFullscreen === isFullscreen) return
  invalidatePreviewViewportSchedule()
  if (isFullscreen) {
    previewScale.value = 1
    previewFullscreen.value = true
    ensurePreviewDomHandoff()
    updatePreviewViewport({ scroll: { left: 0, top: 0 }, waitForContentRect: true })
    return
  }
  if (previewAutoFit.value && previewFitCanUseCanvas.value) previewRenderTarget.value = 'fit'
  previewFullscreen.value = isFullscreen
  if (previewAutoFit.value) {
    previewScrollBeforeFullscreen = null
    if (previewFitCanUseCanvas.value) {
      updatePreviewViewport({ scroll: { left: 0, top: 0 }, refreshFit: true, waitForContentRect: true })
    } else {
      ensurePreviewDomHandoff()
      updatePreviewViewport({ scroll: { left: 0, top: 0 }, waitForContentRect: true })
    }
    return
  }
  const position = previewScrollBeforeFullscreen || { left: 0, top: 0 }
  previewScrollBeforeFullscreen = null
  ensurePreviewDomHandoff()
  updatePreviewViewport({ scroll: position, waitForContentRect: true })
}
function reconcilePreviewFullscreenState() {
  if (!showPreview.value || previewFullscreenPending.value) return
  const isFullscreen = fullscreenElement() === previewFullscreenTarget()
  if (previewFullscreen.value !== isFullscreen) handleFullscreenChange()
}
function handlePreviewWindowResize(event) {
  reconcilePreviewFullscreenState()
  updatePreviewViewport(event)
}
async function togglePreviewAutoFit() {
  if (previewModeTransitionPending.value) return
  previewAutoFitPending.value = true
  try {
    const enable = !previewAutoFit.value
    if (enable) {
      rememberPreviewScroll()
      previewFitScale.value = fittedPreviewScale()
      previewAutoFit.value = true
      syncPreviewFitOffset()
      if (previewFitCanUseCanvas.value) {
        if (await ensurePreviewFitCanvas()) showPreviewFitFrame()
      } else resetPreviewDomHandoff()
      return
    }
    const position = previewScrollBeforeFit || { left: 0, top: 0 }
    previewAutoFit.value = false
    previewFitOffset.value = { left: 0, top: 0 }
    resetPreviewDomHandoff()
    commitPreviewViewport(position.left, position.top)
    previewScale.value = 1
    await nextTick()
  } finally {
    previewAutoFitPending.value = false
  }
}
async function enterPreviewFullscreen() {
  if (!showPreview.value || previewModeTransitionPending.value) return
  const target = previewFullscreenTarget()
  const standardRequest = target?.requestFullscreen
  const legacyRequest = target?.webkitRequestFullscreen
  if (!standardRequest && !legacyRequest) return notify('当前浏览器不支持全屏预览')
  previewScrollBeforeFullscreen = {
    left: previewCanvas.value?.scrollLeft || 0,
    top: previewCanvas.value?.scrollTop || 0
  }
  previewFullscreenPending.value = true
  try {
    if (standardRequest) await standardRequest.call(target)
    else await legacyRequest.call(target)
    if (fullscreenElement() !== target) throw new Error('浏览器未进入全屏模式')
    handleFullscreenChange()
  } catch (error) {
    previewScrollBeforeFullscreen = null
    notify(error?.message || '无法进入全屏预览')
  } finally {
    previewFullscreenPending.value = false
  }
}
async function exitPreviewFullscreen() {
  if (previewModeTransitionPending.value) return
  if (fullscreenElement() !== previewFullscreenTarget()) {
    handleFullscreenChange()
    return
  }
  const exit = document.exitFullscreen || document.webkitExitFullscreen
  if (!exit) return
  previewFullscreenPending.value = true
  try {
    await exit.call(document)
  } catch (error) {
    notify(error?.message || '无法退出全屏预览')
  } finally {
    previewFullscreenPending.value = false
    handleFullscreenChange()
  }
}
function togglePreviewFullscreen() {
  if (previewModeTransitionPending.value) return
  return previewFullscreen.value ? exitPreviewFullscreen() : enterPreviewFullscreen()
}
async function closePreview() {
  if (fullscreenElement() === previewFullscreenTarget()) await exitPreviewFullscreen()
  invalidatePreviewViewportSchedule()
  previewMediaReadinessGate.cancelAll()
  closeButtonMessage()
  closeTableCellViewer()
  restartEditorProgressiveDomMount()
  showPreview.value = false
  previewPresentationReady.value = false
  previewViewportTransitioning.value = false
  previewFullscreen.value = false
  previewDisplayMode.value = 'dom'
  previewDomMounted.value = false
  previewDomGeneration.value += 1
  resetPreviewEdgeCanvas({ clearFailure: true })
  resetPreviewFitCanvasState()
  resetPreviewDomReadyState()
  resetPreviewDomQueryBounds()
  clearTimeout(previewCanvasDocumentRenderTimer)
  previewCanvasDocumentRenderTimer = 0
  previewScrollBeforeFit = null
  previewScrollBeforeFullscreen = null
  previewResizeObserver?.disconnect()
  resumeWorkspaceSessionPersistenceAfterPreview()
  await nextTick()
  markEditorLodDirty()
}
async function openPreview() {
  if (operation.value) pointerUp()
  flushPendingDocumentEdits()
  deferWorkspaceSessionPersistenceForPreview()
  invalidatePreviewViewportSchedule()
  resetFormPreviewState()
  closeButtonMessage()
  closeTableCellViewer()
  previewFullscreen.value = false
  previewPresentationReady.value = false
  previewViewportTransitioning.value = false
  previewDisplayMode.value = 'dom'
  resetPreviewEdgeCanvas({ clearFailure: true })
  resetPreviewFitCanvasState()
  resetPreviewDomQueryBounds()
  resetPreviewDomHandoff()
  previewScale.value = 1
  previewScrollBeforeFit = null
  previewScrollBeforeFullscreen = null
  showPreview.value = true
  await nextTick()
  previewResizeObserver?.disconnect()
  if (previewCanvas.value) previewResizeObserver?.observe(previewCanvas.value)
  previewCanvas.value?.scrollTo({ left: 0, top: 0 })
  commitPreviewViewport(0, 0)
  if (syncPreviewDomQueryBounds(true)) {
    previewDomGeneration.value += 1
    resetPreviewDomReadyState()
  }
  if (previewDomEdgeCanvasActive.value) syncPreviewEdgeCanvasBounds(true)
  if (previewAutoFit.value) {
    previewFitScale.value = fittedPreviewScale(previewCanvas.value)
    syncPreviewFitOffset(previewCanvas.value)
    if (await ensurePreviewFitCanvas()) showPreviewFitFrame()
  } else if (previewFallbackRequired.value && !previewViewportCanvasPlanned.value) {
    await ensurePreviewFitCanvas({ target: false })
  }
}

watch([stageWidth, stageHeight, previewAutoFit], () => {
  if (!showPreview.value) return
  updatePreviewViewport()
  if (syncPreviewDomQueryBounds(true)) {
    previewDomGeneration.value += 1
    resetPreviewDomReadyState()
  }
})
watch(previewViewport, () => {
  if (!showPreview.value || !previewDomMounted.value) return
  if (syncPreviewDomQueryBounds()) {
    previewDomGeneration.value += 1
    resetPreviewDomReadyState()
  }
  if (previewDomEdgeCanvasActive.value) syncPreviewEdgeCanvasBounds()
}, { flush: 'sync' })
watch([nodeSpatialRevision, edgeSpatialRevision, drawingSpatialRevision], () => {
  if (!showPreview.value || !previewDomMounted.value) return
  previewDomGeneration.value += 1
  resetPreviewDomReadyState()
}, { flush: 'sync' })
watch(previewDomFullDocumentRequested, requested => {
  if (!showPreview.value || !previewDomMounted.value) return
  if (requested) resetPreviewDomQueryBounds()
  else syncPreviewDomQueryBounds(true)
  previewDomGeneration.value += 1
  resetPreviewDomReadyState()
}, { flush: 'sync' })
watch(previewDomEdgeCanvasRequested, requested => {
  if (!requested) {
    // Keep the accepted sharp viewport frame alive while the fit Canvas takes over.
    // Reusing it when returning to original size also avoids disposing a large bitmap in the click task.
    if (showPreview.value && previewRenderTarget.value === 'fit' && previewEdgeCanvasBounds.value) return
    resetPreviewEdgeCanvas({ clearFailure: true })
    return
  }
  previewEdgeCanvasFailed.value = false
  syncPreviewEdgeCanvasBounds(true)
}, { flush: 'post' })
watch(previewLivePlaneKey, key => {
  previewMediaReadinessGate.cancel(previewLivePlaneStage.value)
  previewLivePlaneGeneration.value += 1
  previewLivePlaneReady.value = !key
}, { flush: 'sync' })
watch([previewFallbackRequired, previewViewportCanvasPlanned], ([required, viewportCanvasPlanned]) => {
  if (!required) {
    previewFitFallbackIdleTask.cancel()
    return
  }
  if (!showPreview.value || viewportCanvasPlanned) return
  startPreviewFitCanvasFallback()
})
watch([previewFitExcludedNodeIds, previewFitExcludedDrawingIds], () => {
  if (!showPreview.value || !previewFitMounted.value) return
  invalidatePreviewFitDocument()
  void nextTick(() => {
    requestPreviewFitDocumentRender()
  })
})
watch(previewFitCanUseCanvas, canUse => {
  if (canUse || !showPreview.value || !previewFitLayoutRequested.value || previewRenderTarget.value !== 'fit') return
  resetPreviewDomHandoff()
  previewDisplayMode.value = 'dom'
})
watch(
  [previewPresentationReady, previewCanvasVisible, previewEdgeCanvasVisible],
  resumeVisiblePreviewAnimationClocks,
  { flush: 'post' }
)

// 结构页只渲染当前滚动窗口；切换页签或重新展开属性栏时同步真实容器高度。
watch([rightTab, rightOpen], async ([tab, open]) => {
  if (tab !== '结构' || !open) return
  await nextTick()
  updateStructureViewport()
})

watch(propertyInspectionIdentity, async () => {
  await nextTick()
  if (propertiesPanel.value) propertiesPanel.value.scrollTop = 0
}, { flush: 'post' })

function rejectLockedSelection(action) {
  if (!selectedEntitiesContainLocked.value) return false
  notify(`对象已锁定，请先解锁后${action}`)
  return true
}
function deleteSelected() {
  if (rejectLockedSelection('删除')) return
  if (operation.value) pointerUp()
  if (selectedNodes.value.length) {
    const ids = new Set(selectedNodeIds.value)
    const removedNodes = nodes.value.filter(node => ids.has(node.id))
    const removedEdges = edges.value.filter(edge => ids.has(edge.from) || ids.has(edge.to))
    recordEntityRemoval({ nodes: removedNodes, edges: removedEdges, drawings: [] })
    for (let index = edges.value.length - 1; index >= 0; index -= 1) {
      if (ids.has(edges.value[index].from) || ids.has(edges.value[index].to)) edges.value.splice(index, 1)
    }
    for (let index = nodes.value.length - 1; index >= 0; index -= 1) {
      if (ids.has(nodes.value[index].id)) nodes.value.splice(index, 1)
    }
    updateEdgeAdjacency(removedEdges, [])
    applyNodeSpatialChanges(removedNodes.map(value => ({ id: value.id, value })), [])
    removeTimeNodes(removedNodes)
    removeRuntimeDataNodes(removedNodes)
    removeLayerEntries('node', removedNodes)
    if (editorLodActive.value && !editorRenderPaused.value) {
      patchRemovedEditorLodEntities({
        nodes: removedNodes,
        edges: removedEdges,
        drawings: [],
        geometryRevision: ++editorLodGeometryRevision
      })
    }
    clearRemovedEntityState(ids, new Set())
  } else if (selectedDrawing.value) {
    const drawing = selectedDrawing.value
    recordEntityRemoval({ nodes: [], edges: [], drawings: [drawing] })
    const index = drawings.value.findIndex(item => item.id === drawing.id)
    if (index >= 0) drawings.value.splice(index, 1)
    removeDrawingIndex(drawing)
    removeLayerEntries('drawing', [drawing])
    if (editorLodActive.value && !editorRenderPaused.value) {
      patchRemovedEditorLodEntities({
        nodes: [],
        edges: [],
        drawings: [drawing],
        geometryRevision: ++editorLodGeometryRevision
      })
    }
    clearRemovedEntityState(new Set(), new Set([drawing.id]))
  }
}
function duplicate() {
  if (rejectLockedSelection('复制')) return
  if (operation.value) pointerUp()
  if (selectedNodes.value.length) {
    captureNodeBundleForAction(selectedNodes.value, {
      kind: 'duplicate',
      bounds: selectedNodeBounds.value,
      onCommit(bundle) {
        instantiateNodeBundle(bundle, bundle.originX + 24, bundle.originY + 24, { unlock: false })
      }
    })
  } else if (selectedDrawing.value) {
    if (nodes.value.length + drawings.value.length >= MAX_PROJECT_NODES) return notify('图纸组件或线稿数量已达到上限')
    const sourceBounds = drawingBounds(selectedDrawing.value)
    const { dx, dy } = constrainTranslation([sourceBounds], 24, 24, stageWidth.value, stageHeight.value)
    const drawing = { ...cloneEditorValue(selectedDrawing.value), layer: reserveEntityLayers(), points: selectedDrawing.value.points.map(point => ({ x: point.x + dx, y: point.y + dy })), locked: false, groupId: null }
    const node = drawingToPencilNode(drawing, createEntityId('node'), stageWidth.value, stageHeight.value)
    if (!node) return notify('线稿数据无效')
    Object.assign(node, normalizeNodeGeometry(node, stageWidth.value, stageHeight.value))
    recordEntityInsertion({ nodes: [node], edges: [], drawings: [] })
    const [insertedNode] = appendNodes(node)
    selectSingleNode(insertedNode)
  }
}
function closeNodeEditors(nodeIds) {
  if (editingText.value && nodeIds.has(editingText.value.id)) finishTextEdit()
  if (editingFormId.value && nodeIds.has(editingFormId.value)) editingFormId.value = null
  if (nodeIds.has(tableDataEditor.value.nodeId)) closeTableDataEditor()
}
function toggleLock() {
  if (!selectedEntity.value) return notify('请先选择组件或线稿')
  const entities = selectedNodes.value.length ? selectedNodes.value : [selectedDrawing.value]
  const locked = entities.some(entity => !entity.locked)
  if (locked) closeNodeEditors(new Set(entities.map(entity => entity.id)))
  if (selectedNodes.value.length) recordNodeFields(entities, ['locked'])
  else recordFieldsHistory([], entities, ['locked'])
  entities.forEach(entity => { entity.locked = locked })
  notify(locked ? `${entities.length > 1 ? '选中组件' : '对象'}已锁定，属性与内容保持只读` : `${entities.length > 1 ? '选中组件' : '对象'}已解锁`)
}
function activeLayerSelection(entries = layerEntries.value) {
  if (selectedNodes.value.length) return entries.filter(item => item.kind === 'node' && selectedNodeIdSet.value.has(item.id))
  return entries.filter(item => item.kind === 'drawing' && item.id === selectedDrawingId.value)
}
function layerSelectionLocked(entries) { return entries.some(item => item.entity.locked) }
function layerEntryKey(entry) { return `${entry.kind}:${entry.id}` }
function bringFront() {
  if (!selectedEntity.value) return notify('请先选择对象')
  const entries = [...layerEntries.value]
  const selection = activeLayerSelection(entries)
  if (layerSelectionLocked(selection)) return notify('请先解锁选中对象再调整图层')
  const selectedKeys = new Set(selection.map(layerEntryKey))
  const reordered = [...entries.filter(item => !selectedKeys.has(layerEntryKey(item))), ...selection]
  if (reordered.every((item, index) => item === entries[index])) return
  recordLayerHistory(); synchronizeLayerOrder(reordered); notify(selection.length > 1 ? '组合已置顶' : '对象已置顶')
}
function sendBack() {
  if (!selectedEntity.value) return notify('请先选择对象')
  const entries = [...layerEntries.value]
  const selection = activeLayerSelection(entries)
  if (layerSelectionLocked(selection)) return notify('请先解锁选中对象再调整图层')
  const selectedKeys = new Set(selection.map(layerEntryKey))
  const reordered = [...selection, ...entries.filter(item => !selectedKeys.has(layerEntryKey(item)))]
  if (reordered.every((item, index) => item === entries[index])) return
  recordLayerHistory(); synchronizeLayerOrder(reordered); notify(selection.length > 1 ? '组合已置底' : '对象已置底')
}
function moveLayer(offset) {
  if (!selectedEntity.value) return notify('请先选择对象')
  const entries = [...layerEntries.value]
  const selection = activeLayerSelection(entries)
  if (layerSelectionLocked(selection)) return notify('请先解锁选中对象再调整图层')
  const selectedKeys = new Set(selection.map(layerEntryKey))
  let changed = false
  if (offset > 0) {
    for (let index = entries.length - 2; index >= 0; index -= 1) {
      if (selectedKeys.has(layerEntryKey(entries[index])) && !selectedKeys.has(layerEntryKey(entries[index + 1]))) {
        ;[entries[index], entries[index + 1]] = [entries[index + 1], entries[index]]
        changed = true
      }
    }
  } else {
    for (let index = 1; index < entries.length; index += 1) {
      if (selectedKeys.has(layerEntryKey(entries[index])) && !selectedKeys.has(layerEntryKey(entries[index - 1]))) {
        ;[entries[index], entries[index - 1]] = [entries[index - 1], entries[index]]
        changed = true
      }
    }
  }
  if (!changed) return
  recordLayerHistory(); synchronizeLayerOrder(entries)
  notify(offset > 0 ? '已上移一个图层' : '已下移一个图层')
}
function copySelected(options = {}) {
  if (operation.value) pointerUp()
  if (!selectedEntity.value) return notify('请先选择组件或线稿')
  if (rejectLockedSelection('复制')) return false
  if (selectedNodes.value.length) {
    const sourceNodes = selectedNodes.value
    const copiedLabel = sourceNodes.length > 1 ? '组合已复制' : '对象已复制'
    captureNodeBundleForAction(sourceNodes, {
      kind: options.cut ? 'cut' : 'copy',
      bounds: selectedNodeBounds.value,
      onCommit(bundle) {
        const readyKey = `clipboard:${++clipboardBundleGeneration}`
        clipboardItem.value = { kind: 'nodeBundle', data: bundle, readyKey }
        if (shouldPrepareNodeBundleAsync(bundle.nodes.length, bundle.edges.length)) {
          queueBundlePrewarm({
            bundle,
            readyKey,
            forceGroup: false,
            unlock: true,
            isCurrent: () => clipboardItem.value?.readyKey === readyKey
          })
        }
        if (options.cut) {
          deleteSelected()
          notify('对象已剪切')
        } else notify(copiedLabel)
      }
    })
    return true
  }
  clipboardItem.value = { kind: 'drawing', data: cloneEditorValue(selectedDrawing.value) }
  if (options.cut) {
    deleteSelected()
    notify('对象已剪切')
  } else notify('对象已复制')
  return true
}
function cutSelected() {
  if (!selectedEntity.value) return notify('请先选择组件或线稿')
  copySelected({ cut: true })
}
function pasteNode() {
  if (operation.value) pointerUp()
  if (!clipboardItem.value) return notify('剪贴板中没有对象')
  const source = clipboardItem.value.data; const point = contextMenu.value.show ? contextMenu.value.canvasPoint : null
  if (clipboardItem.value.kind === 'drawing') {
    if (nodes.value.length + drawings.value.length >= MAX_PROJECT_NODES) return notify('图纸组件或线稿数量已达到上限')
    const bounds = drawingBounds(source)
    const requestedDx = point ? point.x - bounds.x - bounds.w / 2 : 24
    const requestedDy = point ? point.y - bounds.y - bounds.h / 2 : 24
    const { dx, dy } = constrainTranslation([bounds], requestedDx, requestedDy, stageWidth.value, stageHeight.value)
    const drawing = { ...cloneEditorValue(source), layer: reserveEntityLayers(), points: source.points.map(item => ({ x: item.x + dx, y: item.y + dy })), locked: false, groupId: null }
    const node = drawingToPencilNode(drawing, createEntityId('node'), stageWidth.value, stageHeight.value)
    if (!node) return notify('剪贴板中的线稿无效')
    Object.assign(node, normalizeNodeGeometry(node, stageWidth.value, stageHeight.value))
    recordEntityInsertion({ nodes: [node], edges: [], drawings: [] })
    const [insertedNode] = appendNodes(node)
    selectSingleNode(insertedNode)
  } else {
    const x = point ? point.x - source.width / 2 : source.originX + 24
    const y = point ? point.y - source.height / 2 : source.originY + 24
    const readyKey = clipboardItem.value.readyKey || ''
    instantiateNodeBundle(source, x, y, {
      unlock: true,
      readyKey,
      onCommit() {
        notify('对象已粘贴')
        if (readyKey && clipboardItem.value?.readyKey === readyKey) {
          queueBundlePrewarm({
            bundle: source,
            readyKey,
            forceGroup: false,
            unlock: true,
            isCurrent: () => clipboardItem.value?.readyKey === readyKey
          })
        }
      }
    })
    return
  }
  notify('对象已粘贴')
}
function align(mode) {
  if (operation.value) pointerUp()
  if (!selectedNodes.value.length) return notify('请先选择组件')
  if (selectedNodes.value.some(node => node.locked)) return notify('请先解锁选中组件')
  const bounds = nodeBundleBounds(selectedNodes.value)
  const centerX = (viewport.value.left + viewport.value.width / 2) / zoom.value
  const centerY = (viewport.value.top + viewport.value.height / 2) / zoom.value
  const requestedDx = mode === 'h' ? centerX - bounds.w / 2 - bounds.x : 0
  const requestedDy = mode === 'v' ? centerY - bounds.h / 2 - bounds.y : 0
  const translation = constrainNodeCollectionTranslation(selectedNodes.value, requestedDx, requestedDy, stageWidth.value, stageHeight.value)
  if (!translation.feasible) return
  const { dx, dy } = translation
  if (dx === 0 && dy === 0) return
  recordHistory({ kind: 'geometry', nodes: geometryHistoryForNodes(selectedNodes.value), drawings: [] })
  selectedNodes.value.forEach(node => { node.x += dx; node.y += dy })
  updateNodeSpatialIndex(selectedNodes.value)
}
async function fitView() {
  if (operation.value) return
  if (canvasLocked.value) return notify('请先解除固定画布')
  if (!nodes.value.length) return resetCanvasView()
  cancelPendingCanvasZoom({ commit: false })
  const bounds = nodeBundleBounds(nodes.value)
  const maxX = bounds.x + bounds.w; const maxY = bounds.y + bounds.h
  const nextZoom = Math.max(MIN_CANVAS_ZOOM, Math.min(1, (canvas.value.clientWidth - 60) / maxX, (canvas.value.clientHeight - 60) / maxY))
  commitCanvasViewport(0, 0)
  zoom.value = nextZoom
  await nextTick()
  canvas.value.scrollTo({ left: 0, top: 0 })
  commitCanvasViewport(0, 0)
}
// projectData 是保存、导出、恢复缓存和后台仓储共用的唯一图纸序列化出口。
function projectData(overrides = {}) {
  return {
    version: PROJECT_VERSION,
    projectId: projectId.value,
    revision: projectRevision.value,
    createdAt: projectCreatedAt.value,
    updatedAt: projectUpdatedAt.value,
    fileName: fileName.value,
    nodes: nodes.value,
    edges: edges.value,
    drawings: drawings.value,
    customComponents: customComponents.value,
    stageWidth: stageWidth.value,
    stageHeight: stageHeight.value,
    canvasBg: canvasBg.value,
    canvasBorderColor: canvasBorderColor.value,
    canvasBorderWidth: canvasBorderWidth.value,
    showGrid: showGrid.value,
    gridColor: gridColor.value,
    gridStyle: gridStyle.value,
    snap: snap.value,
    gridSize: gridSize.value,
    lineColor: lineColor.value,
    lineWidth: lineWidth.value,
    lineDash: lineDash.value,
    lineStartMarker: lineStartMarker.value,
    lineEndMarker: lineEndMarker.value,
    lineAnchorMode: lineAnchorMode.value,
    ...overrides
  }
}
function serializeProjectData(data = projectData(), spacing = 0) {
  return JSON.stringify({
    ...data,
    nodes: toRaw(data.nodes || []),
    edges: toRaw(data.edges || []),
    drawings: toRaw(data.drawings || []),
    customComponents: toRaw(data.customComponents || [])
  }, null, spacing)
}
function resetDocumentSession() {
  invalidateProjectStorageChanges()
  invalidateProjectCacheTasks()
  invalidateRuntimeDataReplays()
  pointCatalogActivationGeneration += 1
  pointCatalogScopeReady = false
  activePointSourceScopeId.value = ''
  editorLodDocumentResetPending = true
  clearEditorProgressiveDomMount()
  cancelPendingBundleWork('document-reset')
  cancelLargeSelectionCommit()
  if (bundlePrewarmFrame) cancelBundleFrame(bundlePrewarmFrame)
  bundlePrewarmFrame = 0
  bundleReadyInstances.clear()
  bundlePrewarmRequests.length = 0
  pointerUp()
  cancelEditorLodRendering('document-reset')
  flushPendingDocumentEdits()
  endPolylineStartPointDrag()
  polylineDraft.value = null
  activeTool.value = 'select'
  history.value = []
  historyBytes = 0
  future.value = []
  clipboardItem.value = null
  paperSelected.value = false
  clearNodeSelection()
  selectedDrawingId.value = null
  setConnectionAnchor(null)
  editingText.value = null
  editingFormId.value = null
  closeTableDataEditor()
  closeTableCellViewer()
  operation.value = null
  contextMenu.value.show = false
  drawingBrowserOpen.value = false
  showSaveMenu.value = false
  clearDrawingFileTarget()
  showPreview.value = false
  canvasLocked.value = false
  lockedCanvasView.value = null
  runtimeGateway.disconnect()
  sourceBindingRuntime.reset?.()
  clearRuntimeData()
  if (runtimeCanvasRenderFrame) cancelAnimationFrame(runtimeCanvasRenderFrame)
  runtimeCanvasRenderFrame = 0
  runtimeCanvasDirtyQueue.clear()
  finishCanvasScrollInteraction()
  cancelPendingCanvasZoom({ commit: false })
  interactionCommitBarrier.reset()
}
async function applyProject(data, isCurrent = () => true) {
  const runtime = await projectRuntimePreparer.prepare(data)
  if (!componentLifecycleActive || !isCurrent()) throw new ProjectRuntimePreparationCancelledError('inactive')
  const project = runtime.project
  resetDocumentSession()
  editorProgressiveDomActive.value = runtime.nodes.length > EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD
  installPreparedEntityCollections(runtime)
  customComponents.value = project.customComponents || []
  projectId.value = project.projectId
  projectRevision.value = project.revision
  projectCreatedAt.value = project.createdAt
  projectUpdatedAt.value = project.updatedAt
  fileName.value = project.fileName
  stageWidth.value = project.stageWidth
  stageHeight.value = project.stageHeight
  canvasBg.value = project.canvasBg || '#f7f8fa'
  canvasBorderColor.value = project.canvasBorderColor
  canvasBorderWidth.value = project.canvasBorderWidth
  gridColor.value = project.gridColor
  gridStyle.value = project.gridStyle
  showGrid.value = typeof project.showGrid === 'boolean' ? project.showGrid : true
  snap.value = typeof project.snap === 'boolean' ? project.snap : false
  gridSize.value = Number(project.gridSize) || 20
  lineColor.value = project.lineColor || '#485563'
  lineWidth.value = Number(project.lineWidth) || 2
  lineDash.value = typeof project.lineDash === 'boolean' ? project.lineDash : false
  lineStartMarker.value = project.lineStartMarker
  lineEndMarker.value = project.lineEndMarker
  lineAnchorMode.value = project.lineAnchorMode
  documentChangeVersion = 0
  resetCanvasView()
  editorLodDocumentResetPending = false
  if (editorLodActive.value && !editorRenderPaused.value) {
    syncEditorLodDetailBounds(true)
    primeEditorLodBootstrap()
  }
  restartEditorProgressiveDomMount()
  scheduleBundlePrewarm()
  return true
}
function drawingFileName(value) {
  let name = String(value || '').normalize('NFC').trim().replace(/\.json$/i, '')
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 110)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `图纸-${name}`
  return `${name || '未命名图纸'}.json`
}
function drawingTitleFromFile(name) { return String(name || '').replace(/\.json$/i, '') || '未命名图纸' }
function formatDrawingSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
function formatDrawingDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
function clearDrawingFileTarget() {
  currentDrawingFile.value = { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null }
  customDrawingFileHandle = null
}
function paperSessionFile(session) {
  return session?.id === activePaperSessionId.value ? currentDrawingFile.value : session?.file
}
function createPaperSession(data = projectData(), file = currentDrawingFile.value, customHandle = customDrawingFileHandle) {
  return {
    id: createEntityId('paper'),
    data,
    file: { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null, ...file },
    customHandle,
    history: history.value,
    future: future.value
  }
}
function ensurePaperSession() {
  const active = paperSessions.value.find(session => session.id === activePaperSessionId.value)
  if (active) return active
  const session = createPaperSession()
  paperSessions.value = [...paperSessions.value, session]
  activePaperSessionId.value = session.id
  return session
}
function replacePaperSessionsWithCurrent() {
  const session = createPaperSession()
  paperSessions.value = [session]
  activePaperSessionId.value = session.id
  return session
}
function captureActivePaperSession() {
  flushPendingDocumentEdits()
  const active = ensurePaperSession()
  const updated = {
    ...active,
    data: projectData(),
    file: { ...currentDrawingFile.value },
    customHandle: customDrawingFileHandle,
    history: history.value,
    future: future.value
  }
  paperSessions.value = paperSessions.value.map(session => session.id === updated.id ? updated : session)
  return updated
}
async function restorePaperSession(session, isCurrent = () => true) {
  if (!session) return false
  await applyProject(session.data, isCurrent)
  if (!isCurrent()) throw new ProjectRuntimePreparationCancelledError('superseded')
  activePaperSessionId.value = session.id
  currentDrawingFile.value = { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null, ...session.file }
  customDrawingFileHandle = session.customHandle || null
  history.value = Array.isArray(session.history) ? session.history : []
  historyBytes = history.value.reduce((total, entry) => total + historyEntryBytes(entry), 0)
  future.value = Array.isArray(session.future) ? session.future : []
  await activateCurrentDrawingPointCatalog()
  if (!isCurrent()) throw new ProjectRuntimePreparationCancelledError('superseded')
  return true
}
async function activatePaperSession(sessionId) {
  if (fileOperationPending.value) return notify('正在处理图纸文件，请稍候')
  const target = paperSessions.value.find(session => session.id === sessionId)
  if (!target) return
  if (sessionId === activePaperSessionId.value) {
    selectPaper()
    scheduleWorkspaceSessionPersistence(250)
    return
  }
  captureActivePaperSession()
  fileOperationPending.value = true
  try {
    await restorePaperSession(target)
    notify(`正在编辑“${fileName.value}”`)
    selectPaper()
    scheduleWorkspaceSessionPersistence(250)
  } catch (error) {
    if (!projectParsingWasDisposed(error)) notify(error?.message || '图纸切换失败')
  } finally {
    fileOperationPending.value = false
  }
}
function nextBlankPaperTitle() {
  const titles = new Set([
    ...paperSessions.value.map(session => String((session.id === activePaperSessionId.value ? fileName.value : session.data?.fileName) || '')),
    ...drawingFiles.value.map(entry => drawingTitleFromFile(entry.name))
  ])
  let index = 1
  while (titles.has(index === 1 ? '未命名图纸' : `未命名图纸 ${index}`)) index += 1
  return index === 1 ? '未命名图纸' : `未命名图纸 ${index}`
}
async function createBlankPaperSession() {
  captureActivePaperSession()
  const title = nextBlankPaperTitle()
  resetToBlankProject()
  fileName.value = title
  const session = createPaperSession()
  paperSessions.value = [...paperSessions.value, session]
  activePaperSessionId.value = session.id
  // 新图纸创建独立目录，不继承旧工作空间的共享连接。
  await activateCurrentDrawingPointCatalog({ inheritLegacyWorkspace: false })
  selectPaper()
  scheduleWorkspaceSessionPersistence(250)
  return session
}
async function removePaperSession(sessionId) {
  const index = paperSessions.value.findIndex(session => session.id === sessionId)
  if (index < 0) return
  const removingActive = sessionId === activePaperSessionId.value
  const remaining = paperSessions.value.filter(session => session.id !== sessionId)
  if (!removingActive) {
    paperSessions.value = remaining
    scheduleWorkspaceSessionPersistence(250)
    return
  }
  const nextSession = remaining[Math.min(index, remaining.length - 1)]
  if (nextSession) {
    await restorePaperSession(nextSession)
    paperSessions.value = remaining
    selectPaper()
    scheduleWorkspaceSessionPersistence(250)
    return
  }
  resetToBlankProject()
  const replacement = createPaperSession()
  paperSessions.value = [replacement]
  activePaperSessionId.value = replacement.id
  await activateCurrentDrawingPointCatalog({ inheritLegacyWorkspace: false })
  selectPaper()
  scheduleWorkspaceSessionPersistence(250)
}
function persistableProjectData(data = {}) {
  return {
    ...data,
    nodes: toRaw(data.nodes || []),
    edges: toRaw(data.edges || []),
    drawings: toRaw(data.drawings || []),
    customComponents: toRaw(data.customComponents || [])
  }
}
function persistablePaperSession(session, includeCustomHandle = true) {
  const hasCustomHandle = Boolean(session.customHandle)
  return {
    id: session.id,
    data: persistableProjectData(session.data),
    file: hasCustomHandle && !includeCustomHandle
      ? { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null }
      : { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null, ...session.file },
    customHandle: includeCustomHandle ? session.customHandle || null : null,
    history: toRaw(Array.isArray(session.history) ? session.history : []),
    future: toRaw(Array.isArray(session.future) ? session.future : [])
  }
}
function workspaceSessionSnapshot(workspace, cached, includeCustomHandles = true) {
  return {
    version: 1,
    workspace,
    activeId: cached.activeId,
    sessions: cached.sessions.map(session => persistablePaperSession(session, includeCustomHandles)),
    savedAt: new Date().toISOString()
  }
}
function cacheWorkspacePaperSessions(workspace, cached) {
  workspacePaperSessions.set(workspace, cached)
}
async function persistWorkspacePaperSessions(workspace = workspaceId.value, cached = null) {
  if (workspaceSessionPersistenceIsDeferred(workspace)) return false
  let current = cached
  if (!current && workspace === workspaceId.value) {
    workspaceSessionPersistenceCapturing = true
    try {
      captureActivePaperSession()
    } finally {
      workspaceSessionPersistenceCapturing = false
    }
    current = { sessions: paperSessions.value, activeId: activePaperSessionId.value }
    cacheWorkspacePaperSessions(workspace, current)
  } else if (!current) current = workspacePaperSessions.get(workspace)
  if (!current?.sessions?.length) return false
  const saveVersion = workspacePaperSessions.beginSave(workspace)
  const snapshot = workspaceSessionSnapshot(workspace, current)
  const fallbackSnapshot = current.sessions.some(session => session.customHandle)
    ? workspaceSessionSnapshot(workspace, current, false)
    : null
  const result = await workspaceSessionSaveQueue.save(workspace, snapshot, fallbackSnapshot, {
    isFresh: () => (
      workspacePaperSessions.isSaveCurrent(workspace, saveVersion)
      && !workspaceSessionPersistenceIsDeferred(workspace)
    )
  })
  if (result.stale) return false
  if (!result.ok) {
    if (!workspaceSessionPersistenceWarningShown) {
      workspaceSessionPersistenceWarningShown = true
      notify('完整图纸会话暂时无法持久化，已保留在本次运行内存中')
    }
    return false
  }
  workspaceSessionPersistenceWarningShown = false
  return workspacePaperSessions.completeSave(workspace, saveVersion)
}
function cancelScheduledWorkspaceSessionPersistence() {
  clearTimeout(workspaceSessionPersistTimer)
  workspaceSessionPersistTimer = 0
  workspaceSessionIdleTask.cancel()
}
function workspaceSessionPersistenceIsDeferred(workspace) {
  return workspaceSessionPersistenceDeferredWorkspace === workspace
}
function deferWorkspaceSessionPersistenceForPreview() {
  workspaceSessionPersistenceDeferredWorkspace = workspaceId.value
  cancelScheduledWorkspaceSessionPersistence()
}
function resumeWorkspaceSessionPersistenceAfterPreview(delay = WORKSPACE_SESSION_RETRY_DELAY_MS) {
  const deferredWorkspace = workspaceSessionPersistenceDeferredWorkspace
  if (!deferredWorkspace) return false
  workspaceSessionPersistenceDeferredWorkspace = ''
  if (deferredWorkspace !== workspaceId.value || !workspacePaperSessions.isDirty(deferredWorkspace)) return false
  return scheduleWorkspaceSessionPersistence(delay, false)
}
function workspaceSessionPersistenceBlocked() {
  if (
    workspaceSessionPersistenceIsDeferred(workspaceId.value)
    || operation.value
    || interactionCommitBarrier.state.active
    || fileOperationPending.value
    || workspaceSwitchPending.value
  ) return true
  try {
    return globalThis.navigator?.scheduling?.isInputPending?.({ includeContinuous: true }) === true
  } catch {
    return false
  }
}
function workspaceSessionHasIdleBudget(deadline) {
  if (!deadline || deadline.didTimeout) return true
  try {
    return Number(deadline.timeRemaining?.()) >= WORKSPACE_SESSION_MIN_IDLE_BUDGET_MS
  } catch {
    return false
  }
}
function scheduleWorkspaceSessionPersistence(delay = 1500, markDirty = true) {
  if (workspaceSessionPersistenceCapturing) return
  const scheduledWorkspace = workspaceId.value
  if (markDirty) workspacePaperSessions.markDirty(scheduledWorkspace)
  else if (!workspacePaperSessions.isDirty(scheduledWorkspace)) return false
  cancelScheduledWorkspaceSessionPersistence()
  if (workspaceSessionPersistenceIsDeferred(scheduledWorkspace)) return false
  workspaceSessionPersistTimer = setTimeout(() => {
    workspaceSessionPersistTimer = 0
    if (workspaceId.value !== scheduledWorkspace) return
    if (workspaceSessionPersistenceBlocked()) {
      scheduleWorkspaceSessionPersistence(WORKSPACE_SESSION_RETRY_DELAY_MS)
      return
    }
    workspaceSessionIdleTask.schedule(deadline => {
      if (workspaceId.value !== scheduledWorkspace) return
      if (workspaceSessionPersistenceBlocked() || !workspaceSessionHasIdleBudget(deadline)) {
        scheduleWorkspaceSessionPersistence(WORKSPACE_SESSION_RETRY_DELAY_MS)
        return
      }
      void persistWorkspacePaperSessions(scheduledWorkspace)
    })
  }, delay)
  return true
}
async function storeWorkspacePaperSessions() {
  cancelScheduledWorkspaceSessionPersistence()
  return persistWorkspacePaperSessions(workspaceId.value)
}
function workspaceSessionRestoreIsCurrent(workspace, generation) {
  return componentLifecycleActive
    && workspace === workspaceId.value
    && generation === workspaceSessionRestoreGeneration
}
async function preparePersistedWorkspaceSession(record, workspace) {
  if (isChunkedWorkspaceSessionRecord(record)) {
    return projectJsonParser.parseAndPrepareWorkspaceSession(
      createWorkspaceSessionRestoreSource(record),
      workspace
    )
  }
  return prepareWorkspaceSessionSnapshotAsync(record, workspace, data => projectJsonParser.prepare(data))
}
async function restoreWorkspacePaperSessions() {
  if (!componentLifecycleActive) return false
  const workspace = workspaceId.value
  const restoreGeneration = ++workspaceSessionRestoreGeneration
  const isCurrent = () => workspaceSessionRestoreIsCurrent(workspace, restoreGeneration)
  let cached = workspacePaperSessions.get(workspace)
  let restoredFromStorage = false
  let rewritePersistedRecord = false
  if (!cached?.sessions?.length) {
    const restored = await workspaceSessionStore.loadRecord(workspace)
    if (!isCurrent()) return false
    if (!restored.ok || restored.value == null) return false
    let prepared = null
    try {
      prepared = await preparePersistedWorkspaceSession(restored.value, workspace)
    } catch (error) {
      if (
        isCurrent()
        && !projectParsingWasDisposed(error)
        && !(error instanceof ProjectJsonParserProtocolError)
      ) void workspaceSessionStore.remove(workspace)
      return false
    }
    if (!isCurrent()) return false
    if (!prepared) {
      void workspaceSessionStore.remove(workspace)
      return false
    }
    cached = { sessions: prepared.sessions, activeId: prepared.activeId }
    restoredFromStorage = true
    rewritePersistedRecord = prepared.sanitized || !isChunkedWorkspaceSessionRecord(restored.value)
  }
  const target = cached.sessions.find(session => session.id === cached.activeId) || cached.sessions[0]
  try {
    await restorePaperSession(target, isCurrent)
  } catch (error) {
    if (!isCurrent() || projectParsingWasDisposed(error)) return false
    workspacePaperSessions.delete(workspace)
    void workspaceSessionStore.remove(workspace)
    return false
  }
  if (!isCurrent()) return false
  cacheWorkspacePaperSessions(workspace, cached)
  paperSessions.value = cached.sessions
  if (restoredFromStorage) workspacePaperSessions.markPersisted(workspace)
  if (rewritePersistedRecord) void persistWorkspacePaperSessions(workspace, cached)
  return true
}
let projectCacheGeneration = 0
function invalidateProjectCacheTasks() {
  projectCacheGeneration += 1
}
function beginProjectCacheTask(data, workspace = workspaceId.value) {
  return {
    workspace,
    storageKey: storageKeyForWorkspace(workspace),
    project: String(data?.projectId || ''),
    documentVersion: documentChangeVersion,
    generation: ++projectCacheGeneration
  }
}
function projectCacheTaskIsCurrent(target) {
  return componentLifecycleActive
    && target.generation === projectCacheGeneration
    && target.workspace === workspaceId.value
    && target.storageKey === projectStorageKey.value
    && target.project === projectId.value
    && target.documentVersion === documentChangeVersion
}
function encodeProjectCacheSnapshot(data, target) {
  return encodeBoundedJsonText(data, {
    maxCharacterLength: MAX_LOCAL_PROJECT_CACHE_CHARS,
    isFresh: () => projectCacheTaskIsCurrent(target),
    isCancelled: () => !componentLifecycleActive
  })
}
function writeProjectCacheSnapshot(target, encoded) {
  if (!projectCacheTaskIsCurrent(target)) return false
  if (encoded.tooLarge) localStorage.removeItem(target.storageKey)
  else localStorage.setItem(target.storageKey, encoded.text)
  return true
}
function cacheProjectSnapshot(data, serialized = '') {
  const target = beginProjectCacheTask(data)
  if (serialized) {
    try {
      const encoded = serialized.length > MAX_LOCAL_PROJECT_CACHE_CHARS
        ? { tooLarge: true, text: '' }
        : { tooLarge: false, text: serialized }
      if (!writeProjectCacheSnapshot(target, encoded)) return false
      rememberWorkspace()
      return true
    } catch {
      return false
    }
  }
  return encodeProjectCacheSnapshot(data, target).then(encoded => {
    try {
      if (!writeProjectCacheSnapshot(target, encoded)) return false
      rememberWorkspace()
      return true
    } catch {
      return false
    }
  }).catch(() => false)
}
function nextProjectSavePayload() {
  return projectData({ revision: projectRevision.value + 1, updatedAt: new Date().toISOString() })
}
function markProjectSaved(data, serialized = '', currentContentChanged = false) {
  projectRevision.value = data.revision
  projectUpdatedAt.value = data.updatedAt
  if (currentContentChanged) cacheProjectSnapshot(projectData())
  else cacheProjectSnapshot(data, serialized)
}
async function refreshDrawingFiles() {
  if (drawingFilesRefreshPromise) return drawingFilesRefreshPromise
  drawingFilesLoading.value = true
  drawingFilesLoaded.value = false
  drawingFilesError.value = ''
  drawingFilesRefreshPromise = (async () => {
    try {
      const listing = await drawingRepository.list(backendRequestContext())
      drawingFiles.value = listing.files
      drawingDirectoryPath.value = listing.directory
      drawingNamesCaseSensitive.value = listing.caseSensitiveNames !== false
      drawingFilesLoaded.value = true
      return true
    } catch (error) {
      drawingFilesError.value = error?.message || '无法读取项目图纸库'
      return false
    } finally {
      drawingFilesLoading.value = false
    }
  })()
  try {
    return await drawingFilesRefreshPromise
  } finally {
    drawingFilesRefreshPromise = null
  }
}
async function openDrawingDirectory() {
  showSaveMenu.value = false
  drawingBrowserOpen.value = true
  await refreshDrawingFiles()
}
async function openProjectDrawing(entry) {
  if (fileOperationPending.value) return
  ensurePaperSession()
  const openSession = paperSessions.value.find(session => {
    const file = paperSessionFile(session)
    return file?.kind === 'project' && drawingNamesMatch(file.name, entry.name, drawingNamesCaseSensitive.value)
  })
  fileOperationPending.value = true
  try {
    const loaded = await drawingRepository.get(entry.name, backendRequestContext())
    const text = loaded.serialized
    const data = await projectJsonParser.parseAndPrepare(text, drawingTitleFromFile(entry.name))
    captureActivePaperSession()
    await applyProject(data)
    currentDrawingFile.value = { kind: 'project', name: entry.name, etag: loaded.etag || entry.etag || '', size: Number(entry.size) || 0, modifiedAt: entry.modifiedAt || null }
    const session = createPaperSession(projectData(), currentDrawingFile.value)
    if (openSession) {
      session.id = openSession.id
      paperSessions.value = paperSessions.value.map(item => item.id === openSession.id ? session : item)
    } else {
      paperSessions.value = [...paperSessions.value, session]
    }
    activePaperSessionId.value = session.id
    await activateCurrentDrawingPointCatalog()
    cacheProjectSnapshot(data, text)
    drawingBrowserOpen.value = false
    selectPaper()
    scheduleWorkspaceSessionPersistence(250)
    notify(`${openSession ? '已从磁盘重新打开' : '已打开'} 图纸库/${entry.name}`)
  } catch (error) {
    notify(error?.message || '图纸打开失败')
  } finally {
    fileOperationPending.value = false
  }
}
function matchesProjectDrawingFile(file, name) {
  return file?.kind === 'project' && drawingNamesMatch(file.name, name, drawingNamesCaseSensitive.value)
}
function detachProjectDrawingSessions(name) {
  captureActivePaperSession()
  const detachedFile = { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null }
  const activeDetached = matchesProjectDrawingFile(currentDrawingFile.value, name)
  let currentWorkspaceChanged = false
  paperSessions.value = paperSessions.value.map(session => {
    const file = session.id === activePaperSessionId.value ? currentDrawingFile.value : session.file
    if (!matchesProjectDrawingFile(file, name)) return session
    currentWorkspaceChanged = true
    return { ...session, file: { ...detachedFile } }
  })
  if (activeDetached) {
    currentDrawingFile.value = { ...detachedFile }
    customDrawingFileHandle = null
  }
  for (const [cachedWorkspaceId, cached] of [...workspacePaperSessions]) {
    let changed = cachedWorkspaceId === workspaceId.value && currentWorkspaceChanged
    const sessions = cachedWorkspaceId === workspaceId.value ? paperSessions.value : cached.sessions.map(session => {
      if (!matchesProjectDrawingFile(session.file, name)) return session
      changed = true
      return { ...session, file: { ...detachedFile } }
    })
    if (!changed) continue
    const nextCached = { ...cached, sessions }
    workspacePaperSessions.markDirty(cachedWorkspaceId)
    workspacePaperSessions.set(cachedWorkspaceId, nextCached)
    if (cachedWorkspaceId !== workspaceId.value) void persistWorkspacePaperSessions(cachedWorkspaceId, nextCached)
  }
  if (currentWorkspaceChanged) scheduleWorkspaceSessionPersistence(250)
  return activeDetached
}
async function deleteProjectDrawing(entry) {
  if (fileOperationPending.value || !entry?.name) return
  const openCopy = paperSessions.value.some(session => matchesProjectDrawingFile(paperSessionFile(session), entry.name))
  const detail = openCopy
    ? '\n磁盘文件将永久删除；已打开的编辑内容会保留为未保存图纸。'
    : '\n磁盘文件将永久删除且无法恢复。'
  if (!window.confirm(`确定从图纸库删除“${entry.name}”吗？${detail}`)) return
  if (!entry.etag) {
    notify('图纸版本信息缺失，请刷新列表后重试')
    await refreshDrawingFiles()
    return
  }
  fileOperationPending.value = true
  try {
    await drawingRepository.delete(entry.name, entry.etag, backendRequestContext())
    drawingFiles.value = drawingFiles.value.filter(file => !drawingNamesMatch(file.name, entry.name, drawingNamesCaseSensitive.value))
    const activeDetached = detachProjectDrawingSessions(entry.name)
    notify(activeDetached ? `已删除 ${entry.name}，当前编辑内容已保留为未保存图纸` : `已从图纸库删除 ${entry.name}`)
  } catch (error) {
    const refreshed = await refreshDrawingFiles()
    void refreshed
    let confirmedMissing = error?.status === 404
    if (!confirmedMissing) {
      try {
        confirmedMissing = !(await drawingRepository.exists(entry.name, backendRequestContext()))
      } catch {
        // A failed probe is inconclusive; keep the session attached to its saved file.
      }
    }
    if (confirmedMissing) {
      const activeDetached = detachProjectDrawingSessions(entry.name)
      notify(activeDetached ? `图纸库中已不存在 ${entry.name}，当前编辑内容已保留为未保存图纸` : `图纸库中已不存在 ${entry.name}`)
    } else {
      notify(error?.message || '图纸删除失败')
    }
  } finally {
    fileOperationPending.value = false
  }
}
async function applyExternalDrawingFile(file, handle = null) {
  if (!file) return false
  const serialized = await file.text()
  const data = await projectJsonParser.parseAndPrepare(serialized, drawingTitleFromFile(file.name))
  captureActivePaperSession()
  await applyProject(data)
  if (handle) {
    customDrawingFileHandle = handle
    currentDrawingFile.value = { kind: 'custom', name: file.name, etag: '', size: file.size, modifiedAt: file.lastModified }
  }
  const session = createPaperSession(projectData(), currentDrawingFile.value, handle)
  paperSessions.value = [...paperSessions.value, session]
  activePaperSessionId.value = session.id
  await activateCurrentDrawingPointCatalog()
  cacheProjectSnapshot(data, serialized)
  selectPaper()
  scheduleWorkspaceSessionPersistence(250)
  return true
}

async function deletePaperSession(sessionId) {
  if (fileOperationPending.value) return
  const session = paperSessions.value.find(item => item.id === sessionId)
  if (!session) return
  const file = paperSessionFile(session)
  const title = String((sessionId === activePaperSessionId.value ? fileName.value : session.data?.fileName) || '未命名图纸')
  const detail = file?.name
    ? `只会从图纸分类移除，已保存的“${file.name}”文件不会被删除。`
      : '该图纸尚未保存，将直接丢弃。'
  if (!window.confirm(`确定删除“${title}”吗？\n${detail}`)) return
  fileOperationPending.value = true
  try {
    await removePaperSession(sessionId)
    notify(`已从图纸分类移除“${title}”`)
  } catch (error) {
    if (!projectParsingWasDisposed(error)) notify(error?.message || '图纸删除失败')
  } finally {
    fileOperationPending.value = false
  }
}
async function openOtherDrawing() {
  drawingBrowserOpen.value = false
  if (typeof window.showOpenFilePicker !== 'function') {
    importInput.value?.click()
    return
  }
  try {
    const handles = await window.showOpenFilePicker({
      id: 'tc2d-open-drawing',
      multiple: false,
      types: [{ description: 'JSON 图纸', accept: { 'application/json': ['.json'] } }]
    })
    const handle = handles[0]
    const file = await handle.getFile()
    fileOperationPending.value = true
    await applyExternalDrawingFile(file, handle)
    notify(`已打开 ${file.name}`)
  } catch (error) {
    if (error?.name !== 'AbortError') notify(error?.message || '图纸打开失败')
  } finally {
    fileOperationPending.value = false
  }
}
function downloadProjectData(message = '图纸已导出') {
  flushPendingDocumentEdits()
  const blob = new Blob([serializeProjectData(projectData(), 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = drawingFileName(fileName.value)
  link.click()
  URL.revokeObjectURL(link.href)
  notify(message)
}
async function ensureWritableFileHandle(handle) {
  if (typeof handle?.queryPermission !== 'function') return true
  let permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission === 'prompt' && typeof handle.requestPermission === 'function') permission = await handle.requestPermission({ mode: 'readwrite' })
  return permission === 'granted'
}
async function writeCustomDrawing(handle, newTarget = false) {
  if (fileOperationPending.value || !handle) return false
  flushPendingDocumentEdits()
  const savingSessionId = ensurePaperSession().id
  const savingChangeVersion = documentChangeVersion
  const data = nextProjectSavePayload()
  const serialized = serializeProjectData(data, 2)
  fileOperationPending.value = true
  let writable
  try {
    if (!await ensureWritableFileHandle(handle)) throw new Error('没有所选文件的写入权限')
    if (!newTarget && currentDrawingFile.value.kind === 'custom') {
      const currentFile = await handle.getFile()
      if (currentFile.size !== currentDrawingFile.value.size || currentFile.lastModified !== currentDrawingFile.value.modifiedAt) throw new Error('文件已被其他程序修改，请重新打开或另存为')
    }
    writable = await handle.createWritable()
    await writable.write(serialized)
    await writable.close()
    writable = null
    const savedFile = await handle.getFile()
    if (activePaperSessionId.value !== savingSessionId) throw new Error('保存期间活动图纸发生变化，请重新保存')
    const currentContentChanged = documentChangeVersion !== savingChangeVersion
    customDrawingFileHandle = handle
    currentDrawingFile.value = { kind: 'custom', name: savedFile.name, etag: '', size: savedFile.size, modifiedAt: savedFile.lastModified }
    markProjectSaved(data, serialized, currentContentChanged)
    await storeWorkspacePaperSessions()
    notify(currentContentChanged ? '保存完成，但保存期间有新修改，请再次保存' : `图纸已保存到 ${savedFile.name}`)
    return true
  } catch (error) {
    try { await writable?.abort?.() } catch {}
    notify(error?.message || '图纸保存失败')
    return false
  } finally {
    fileOperationPending.value = false
  }
}
async function saveDrawingAsCustomFile() {
  showSaveMenu.value = false
  if (typeof window.showSaveFilePicker !== 'function') {
    downloadProjectData('浏览器不支持选择保存位置，已下载图纸')
    return
  }
  try {
    const handle = await window.showSaveFilePicker({
      id: 'tc2d-save-drawing',
      suggestedName: drawingFileName(fileName.value),
      types: [{ description: 'JSON 图纸', accept: { 'application/json': ['.json'] } }]
    })
    await writeCustomDrawing(handle, true)
  } catch (error) {
    if (error?.name !== 'AbortError') notify(error?.message || '图纸保存失败')
  }
}
async function saveDrawingToProjectDirectory(forceNew = false) {
  showSaveMenu.value = false
  if (fileOperationPending.value) return false
  flushPendingDocumentEdits()
  const savingSessionId = ensurePaperSession().id
  const existingTarget = !forceNew && currentDrawingFile.value.kind === 'project' && currentDrawingFile.value.name
  const name = existingTarget ? currentDrawingFile.value.name : drawingFileName(fileName.value)
  fileOperationPending.value = true
  try {
    const savingChangeVersion = documentChangeVersion
    const data = nextProjectSavePayload()
    const serialized = serializeProjectData(data, 2)
    const saved = await drawingRepository.save(name, serialized, {
      etag: currentDrawingFile.value.etag,
      create: !existingTarget,
      context: backendRequestContext()
    })
    if (activePaperSessionId.value !== savingSessionId) throw new Error('保存期间活动图纸发生变化，请重新打开该图纸')
    currentDrawingFile.value = { kind: 'project', name, etag: saved.etag || '', size: Number(saved.size) || 0, modifiedAt: saved.modifiedAt || null }
    customDrawingFileHandle = null
    await refreshDrawingFiles()
    const currentContentChanged = documentChangeVersion !== savingChangeVersion
    markProjectSaved(data, serialized, currentContentChanged)
    await storeWorkspacePaperSessions()
    notify(currentContentChanged ? '保存完成，但保存期间有新修改，请再次保存' : `图纸已保存到 图纸库/${name}`)
    return true
  } catch (error) {
    const conflict = error?.status === 409 || error?.status === 412
    const missingTarget = Boolean(existingTarget) && (
      error?.status === 404
      || (error?.status === 412 && String(error?.message || error?.data?.message || '').includes('不存在'))
    )
    if (missingTarget) {
      await refreshDrawingFiles()
      detachProjectDrawingSessions(name)
      notify(`图纸库中已不存在“${name}”，当前编辑内容已保留为未保存图纸；再次保存将创建新文件。`)
      return false
    }
    if (conflict && !existingTarget) await refreshDrawingFiles()
    const fallback = conflict
      ? existingTarget
        ? `无法按当前版本保存“${name}”。图纸库文件可能已被修改或删除，请重新打开后再保存。`
        : `图纸库中已存在“${name}”，同一位置不能保存两个同名图纸。请修改当前图纸名称，或先删除同名文件后再保存。`
      : '图纸保存失败'
    notify(error?.message || fallback)
    return false
  } finally {
    fileOperationPending.value = false
  }
}
function saveDrawing() {
  if (operation.value) pointerUp()
  flushPendingDocumentEdits()
  if (currentDrawingFile.value.kind === 'custom' && customDrawingFileHandle) return writeCustomDrawing(customDrawingFileHandle)
  return saveDrawingToProjectDirectory()
}
function rememberWorkspace() {
  try {
    sessionStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId.value)
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
  } catch {}
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('workspace', workspaceId.value)
    window.history.replaceState(null, '', url)
  } catch {}
}
function readWorkspaceProject(workspace = workspaceId.value) {
  const normalizedWorkspace = normalizeWorkspaceId(workspace)
  const storageKey = storageKeyForWorkspace(normalizedWorkspace)
  let raw = localStorage.getItem(storageKey)
  if (!raw && normalizedWorkspace === DEFAULT_WORKSPACE_ID) {
    const legacy = localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)
    if (legacy) {
      localStorage.setItem(storageKey, legacy)
      localStorage.removeItem(LEGACY_PROJECT_STORAGE_KEY)
      raw = legacy
    }
  }
  return raw
}
async function restoreStoredWorkspaceProject() {
  if (!componentLifecycleActive) return false
  let raw = ''
  try {
    raw = readWorkspaceProject()
  } catch {
    return false
  }
  if (!raw) return false
  try {
    const data = await projectJsonParser.parseAndPrepare(raw)
    if (!componentLifecycleActive) return false
    await applyProject(data)
    replacePaperSessionsWithCurrent()
    await activateCurrentDrawingPointCatalog()
    return true
  } catch (error) {
    if (projectParsingWasDisposed(error)) return false
    try { localStorage.removeItem(projectStorageKey.value) } catch {}
    notify('工作空间恢复数据无效，已使用空白图纸')
    return false
  }
}
// 同一浏览器的多个页面保存同一工作空间时串行执行；不支持 Web Locks 的环境仍由修订号校验兜底。
async function withWorkspaceSaveLock(workspace, task) {
  const lockManager = globalThis.navigator?.locks
  if (typeof lockManager?.request === 'function') {
    return lockManager.request(`tc2d-workspace:${encodeURIComponent(workspace)}`, { mode: 'exclusive' }, task)
  }
  return task()
}
async function saveLocal(options = {}) {
  if (!componentLifecycleActive) return false
  flushPendingDocumentEdits()
  const savingWorkspace = workspaceId.value
  const storageKey = storageKeyForWorkspace(savingWorkspace)
  try {
    return await withWorkspaceSaveLock(savingWorkspace, async () => {
      if (!componentLifecycleActive || workspaceId.value !== savingWorkspace) return false
      const storedRaw = readWorkspaceProject(savingWorkspace)
      let storedRevision = -1
      if (storedRaw) {
        let stored = null
        try {
          stored = await projectJsonParser.parseHeader(storedRaw)
        } catch (error) {
          if (projectParsingWasDisposed(error)) return false
          try { localStorage.removeItem(storageKey) } catch {}
        }
        if (!componentLifecycleActive || workspaceId.value !== savingWorkspace) return false
        if (stored && typeof stored === 'object' && stored.projectId === projectId.value) {
          storedRevision = Math.max(0, Math.floor(Number(stored.revision) || 0))
          const sameRevisionChanged = storedRevision === projectRevision.value && String(stored.updatedAt || '') !== String(projectUpdatedAt.value || '')
          if ((storedRevision > projectRevision.value || sameRevisionChanged) && !options.force) {
            notify('其他窗口已保存新版本，请先打开最新图纸')
            return false
          }
        }
      }
      const nextRevision = Math.max(projectRevision.value, storedRevision) + 1
      const updatedAt = new Date().toISOString()
      const data = projectData({ revision: nextRevision, updatedAt })
      const cacheTarget = beginProjectCacheTask(data, savingWorkspace)
      const encoded = await encodeProjectCacheSnapshot(data, cacheTarget)
      if (!writeProjectCacheSnapshot(cacheTarget, encoded)) return false
      projectRevision.value = nextRevision
      projectUpdatedAt.value = updatedAt
      captureActivePaperSession()
      rememberWorkspace()
      if (!options.silent) notify(`图纸已保存到“${savingWorkspace}”`)
      return true
    })
  } catch (error) {
    if (projectParsingWasDisposed(error)) return false
    notify('保存失败，请检查浏览器存储空间')
    return false
  }
}
function resetToBlankProject() {
  projectRuntimePreparer.invalidate('blank-project')
  resetDocumentSession()
  const now = new Date().toISOString()
  replaceEntityCollections([], [], [])
  customComponents.value = []
  projectId.value = createEntityId('project')
  projectRevision.value = 0
  projectCreatedAt.value = now
  projectUpdatedAt.value = null
  fileName.value = '未命名图纸'
  stageWidth.value = DEFAULT_STAGE_WIDTH
  stageHeight.value = DEFAULT_STAGE_HEIGHT
  canvasBg.value = '#f7f8fa'
  canvasBorderColor.value = '#cbd3d9'
  canvasBorderWidth.value = 1
  showGrid.value = true
  gridColor.value = '#dde3e7'
  gridStyle.value = 'line'
  gridSize.value = 20
  snap.value = false
  lineColor.value = '#485563'
  lineWidth.value = 2
  lineDash.value = false
  lineStartMarker.value = 'none'
  lineEndMarker.value = 'arrow'
  lineAnchorMode.value = 'edge'
  documentChangeVersion = 0
  resetCanvasView()
  editorLodDocumentResetPending = false
}
function workspaceSwitchMessage(targetWorkspace, sessionsSaved, isNewWorkspace = false) {
  const result = isNewWorkspace ? `已进入新的工作空间“${targetWorkspace}”` : `已切换到“${targetWorkspace}”`
  return sessionsSaved ? result : `${result}，原工作空间完整会话暂存于本次运行内存`
}
async function settleWorkspaceSwitchInteractions() {
  endPolylineStartPointDrag()
  cancelPendingCanvasZoom()
  finishCanvasScrollInteraction()
  setConnectionAnchor(null)
  if (operation.value) pointerUp()
  if (!await interactionCommitBarrier.whenIdle()) return false
  return workspaceAsyncOperationBarrier.whenIdle()
}
async function switchWorkspace() {
  if (!componentLifecycleActive) return
  if (fileOperationPending.value) return notify('正在处理图纸文件，请稍候')
  if (workspaceSwitchPending.value) return
  const nextWorkspace = normalizeWorkspaceId(workspaceDraft.value, DEFAULT_WORKSPACE_ID)
  const previousWorkspace = workspaceId.value
  workspaceDraft.value = nextWorkspace
  if (nextWorkspace === workspaceId.value) return notify('当前已在该工作空间')
  workspaceSwitchPending.value = true
  try {
    if (!await settleWorkspaceSwitchInteractions() || !componentLifecycleActive) return
    await saveLocal({ silent: true })
    if (!componentLifecycleActive) return
    const sessionsSaved = await storeWorkspacePaperSessions()
    if (!componentLifecycleActive) return
    workspaceId.value = nextWorkspace
    rememberWorkspace()
    if (await restoreWorkspacePaperSessions()) {
      if (!componentLifecycleActive) return
      notify(workspaceSwitchMessage(workspaceId.value, sessionsSaved))
      return
    }
    if (!componentLifecycleActive) return
    if (!await restoreStoredWorkspaceProject()) {
      if (!componentLifecycleActive) return
      resetToBlankProject()
      replacePaperSessionsWithCurrent()
      await activateCurrentDrawingPointCatalog({ inheritLegacyWorkspace: false })
      notify(workspaceSwitchMessage(workspaceId.value, sessionsSaved, true))
      return
    }
    if (!componentLifecycleActive) return
    notify(workspaceSwitchMessage(workspaceId.value, sessionsSaved))
  } catch (error) {
    if (!componentLifecycleActive) return
    workspaceId.value = previousWorkspace
    workspaceDraft.value = previousWorkspace
    rememberWorkspace()
    await restoreWorkspacePaperSessions()
    if (componentLifecycleActive) notify(error?.message || '工作空间切换失败，已恢复原工作空间')
  } finally {
    if (componentLifecycleActive) workspaceSwitchPending.value = false
  }
}
let projectStorageChangeGeneration = 0
function invalidateProjectStorageChanges() {
  projectStorageChangeGeneration += 1
}
function projectStorageChangeTargetIsCurrent(target) {
  return componentLifecycleActive
    && !workspaceSwitchPending.value
    && target.generation === projectStorageChangeGeneration
    && target.workspace === workspaceId.value
    && target.storageKey === projectStorageKey.value
    && target.project === projectId.value
}
async function handleProjectStorageChange(e) {
  if (e.storageArea && e.storageArea !== localStorage) return
  const storageKey = projectStorageKey.value
  if (e.key !== storageKey) return
  const generation = ++projectStorageChangeGeneration
  if (!e.newValue) return
  const target = {
    workspace: workspaceId.value,
    storageKey,
    project: projectId.value,
    generation
  }
  let incoming = null
  try {
    incoming = await projectJsonParser.parseHeader(e.newValue)
  } catch {
    return
  }
  if (!projectStorageChangeTargetIsCurrent(target)) return
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return
  const incomingRevision = Math.max(0, Math.floor(Number(incoming.revision) || 0))
  const sameRevisionChanged = incomingRevision === projectRevision.value
    && String(incoming.updatedAt || '') !== String(projectUpdatedAt.value || '')
  if (incoming.projectId === target.project && (incomingRevision > projectRevision.value || sameRevisionChanged)) notify('当前图纸已在其他窗口更新')
}
async function importJson(e) {
  const file = e.target.files?.[0]
  if (!file) return
  fileOperationPending.value = true
  try {
    await applyExternalDrawingFile(file)
    notify(`已打开 ${file.name}`)
  } catch (error) {
    notify(error?.message || '图纸文件格式无效或内容超过容量限制')
  } finally {
    fileOperationPending.value = false
    e.target.value = ''
  }
}
function selectedNodeFileReadTarget(nodeId) {
  return {
    workspace: workspaceId.value,
    paperSessionId: activePaperSessionId.value,
    project: projectId.value,
    nodeId,
    node: nodeIndex.value.get(nodeId)
  }
}
function nodeFileReadTargetIsCurrent(target, type = null) {
  return componentLifecycleActive
    && Boolean(target?.node)
    && workspaceId.value === target.workspace
    && activePaperSessionId.value === target.paperSessionId
    && projectId.value === target.project
    && nodeIndex.value.get(target.nodeId) === target.node
    && (!type || target.node?.type === type)
    && !target.node?.locked
}
function readNodeMediaFile(file, target, options) {
  const reader = new FileReader()
  const operationToken = workspaceAsyncOperationBarrier.begin(`media-${options.type || 'image'}`)
  if (!operationToken) return false
  activeNodeFileReaders.add(reader)
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    activeNodeFileReaders.delete(reader)
    workspaceAsyncOperationBarrier.end(operationToken)
  }
  reader.onload = () => {
    try {
      if (!nodeFileReadTargetIsCurrent(target, options.type) || typeof reader.result !== 'string') return
      recordNodeFields(target.node, [options.field])
      target.node[options.field] = reader.result
      notify(options.successMessage)
    } finally {
      finish()
    }
  }
  reader.onerror = () => {
    if (nodeFileReadTargetIsCurrent(target, options.type)) notify(options.errorMessage)
    finish()
  }
  reader.onabort = () => {
    if (nodeFileReadTargetIsCurrent(target, options.type)) notify(options.abortMessage)
    finish()
  }
  reader.onloadend = finish
  try {
    reader.readAsDataURL(file)
    return true
  } catch {
    finish()
    notify(options.errorMessage)
    return false
  }
}
function abortActiveNodeFileReaders() {
  for (const reader of [...activeNodeFileReaders]) {
    try { reader.abort() } catch {}
  }
  activeNodeFileReaders.clear()
}
function uploadNodeImage(e) {
  const file = e.target.files?.[0]
  const targetId = selectedId.value
  if (!file || !targetId) { e.target.value = ''; return }
  const target = selectedNodeFileReadTarget(targetId)
  if (!target.node) { e.target.value = ''; return }
  if (target.node?.locked) { e.target.value = ''; return notify('组件已锁定，请先解锁后更新图片') }
  if (!file.type.startsWith('image/')) { notify('请选择有效的图片文件'); e.target.value = ''; return }
  if (file.size > MAX_EMBEDDED_IMAGE_BYTES) { notify('本地图片最大支持 20MB'); e.target.value = ''; return }
  readNodeMediaFile(file, target, {
    field: 'imageUrl',
    successMessage: '图片已更新',
    errorMessage: '图片读取失败',
    abortMessage: '图片读取已取消'
  })
  e.target.value = ''
}
function restoreVideoUrlInput(target, node) {
  if (target) target.value = isEmbeddedVideoSource(node?.videoUrl) ? '' : String(node?.videoUrl || '')
}
function cacheVideoUrlEdit(event) {
  const target = event?.currentTarget
  if (!target?.dataset.nodeId) return
  pendingVideoUrlEdit = {
    nodeId: target.dataset.nodeId,
    value: String(target.value || ''),
    embeddedSource: target.dataset.embeddedSource === 'true'
  }
}
function flushPendingVideoUrlEdit(target = null) {
  const edit = pendingVideoUrlEdit
  pendingVideoUrlEdit = null
  if (!edit) return
  const node = nodeIndex.value.get(edit.nodeId)
  if (node?.type !== 'video') return
  if (node.locked) {
    restoreVideoUrlInput(target, node)
    return notify('组件已锁定，请先解锁后更新视频')
  }
  const nextUrl = edit.value.trim()
  if (target) target.value = nextUrl
  if (edit.embeddedSource && !nextUrl) return
  if (isEmbeddedVideoSource(nextUrl)) {
    restoreVideoUrlInput(target, node)
    return notify('本地视频请使用上传按钮')
  }
  if (nextUrl.length > MAX_VIDEO_URL_LENGTH) {
    restoreVideoUrlInput(target, node)
    return notify('视频地址过长，请使用较短的网络地址')
  }
  if (nextUrl === String(node.videoUrl || '')) return
  recordNodeFields(node, ['videoUrl'])
  node.videoUrl = nextUrl
  notify(nextUrl ? '视频地址已更新' : '视频地址已清除')
}
function commitSelectedVideoUrl(event) {
  cacheVideoUrlEdit(event)
  flushPendingVideoUrlEdit(event?.currentTarget)
}
function handleVideoUrlKeydown(event) {
  if (isImeCompositionEvent(event) || event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
  commitSelectedVideoUrl(event)
  event.currentTarget.blur()
}
function clearSelectedVideoSource() {
  const node = selected.value
  if (node?.type !== 'video' || !node.videoUrl) return
  if (node.locked) return notify('组件已锁定，请先解锁后更新视频')
  recordNodeFields(node, ['videoUrl'])
  node.videoUrl = ''
  notify('视频已清除')
}
function uploadNodeVideo(e) {
  const file = e.target.files?.[0]
  const targetId = selectedId.value
  if (!file || !targetId) { e.target.value = ''; return }
  const target = selectedNodeFileReadTarget(targetId)
  if (!target.node) { e.target.value = ''; return }
  if (target.node?.locked) { e.target.value = ''; return notify('组件已锁定，请先解锁后更新视频') }
  if (!file.type.startsWith('video/')) { notify('请选择有效的视频文件'); e.target.value = ''; return }
  if (file.size > MAX_EMBEDDED_VIDEO_BYTES) { notify('本地视频最大支持 20MB，较大视频请使用地址'); e.target.value = ''; return }
  readNodeMediaFile(file, target, {
    type: 'video',
    field: 'videoUrl',
    successMessage: '视频已更新',
    errorMessage: '视频读取失败',
    abortMessage: '视频读取已取消'
  })
  e.target.value = ''
}
async function newFile() {
  if (fileOperationPending.value) return notify('正在处理图纸文件，请稍候')
  fileOperationPending.value = true
  try {
    const session = await createBlankPaperSession()
    if (session) notify(`已新建“${fileName.value}”`)
  } finally {
    fileOperationPending.value = false
  }
}
let clockTimer
function handleWorkspaceNameKeydown(event) {
  if (isImeCompositionEvent(event) || event.key !== 'Enter') return
  event.stopPropagation()
  event.preventDefault()
  switchWorkspace()
}
function handleInlineTextEditorKeydown(event) {
  if (isImeCompositionEvent(event, inlineTextComposing.value)) return
  if (event.key === 'Enter') {
    event.stopPropagation()
    event.preventDefault()
    finishTextEdit()
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    event.preventDefault()
    finishTextEdit(true)
  }
}
const EDITOR_COMMAND_SHORTCUT_KEYS = new Set(['z', 'y', 'g', 'd', 'x', 'c', 'v'])
function overlayBlocksEditorShortcut(event, typing, allowSave = false) {
  const shortcutKey = event.key.toLowerCase()
  const commandKey = event.ctrlKey || event.metaKey
  if (commandKey && shortcutKey === 's') return !allowSave
  return !typing && (
    (commandKey && EDITOR_COMMAND_SHORTCUT_KEYS.has(shortcutKey))
    || event.key === 'Delete'
    || event.key === 'Backspace'
  )
}
function keydown(e) {
  if (isImeCompositionEvent(e)) return
  if (workspaceSwitchPending.value) {
    if (overlayBlocksEditorShortcut(e, false)) e.preventDefault()
    return
  }
  if (largeSelectionCommitPending.value) {
    e.preventDefault()
    return
  }
  const target = e.target
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable || Boolean(target?.closest?.('[contenteditable="true"]'))
  const shortcutKey = e.key.toLowerCase()
  const commandKey = e.ctrlKey || e.metaKey
  if (dataSourceManagerOpen.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDataSourceManager()
    } else if (overlayBlocksEditorShortcut(e, typing)) e.preventDefault()
    return
  }
  if (customComponentDialog.value.show) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeCustomComponentDialog()
    }
    if (overlayBlocksEditorShortcut(e, typing)) e.preventDefault()
    return
  }
  if (e.key === 'Escape') {
    if (buttonMessageDialog.value.show) {
      e.preventDefault()
      closeButtonMessage()
      return
    }
    if (tableCellViewer.value.show) {
      e.preventDefault()
      closeTableCellViewer()
      return
    }
    if (tableDataEditor.value.show) {
      e.preventDefault()
      closeTableDataEditor()
      return
    }
    if (drawingBrowserOpen.value) {
      e.preventDefault()
      drawingBrowserOpen.value = false
      return
    }
    if (showPreview.value) {
      if (previewFullscreenPending.value || previewFullscreen.value || fullscreenElement() === previewFullscreenTarget()) return
      e.preventDefault()
      closePreview()
      return
    }
  }
  if (buttonMessageDialog.value.show || tableCellViewer.value.show || drawingBrowserOpen.value || showPreview.value) {
    if (overlayBlocksEditorShortcut(e, typing)) e.preventDefault()
    return
  }
  if (commandKey && shortcutKey === 's') {
    e.preventDefault()
    flushPendingDocumentEdits()
    void saveDrawing()
    return
  }
  if (tableDataEditor.value.show) {
    if (overlayBlocksEditorShortcut(e, typing, true)) e.preventDefault()
    return
  }
  if (!typing && isPolylineNodeType(activeTool.value) && polylineDraft.value) {
    if (e.key === 'Enter') {
      e.preventDefault()
      finishPolylineDrawing(e)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelPolylineDrawing(true)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      removeLastPolylinePoint()
      return
    }
  }
  if (e.key === 'Escape' && operation.value) {
    e.preventDefault()
    if (operation.value.type === 'selectNodes') setNodeSelection(operation.value.baseIds, operation.value.basePrimaryId)
    pointerUp()
    return
  }
  if (!typing && commandKey && shortcutKey === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
  if (!typing && commandKey && shortcutKey === 'y') { e.preventDefault(); redo() }
  if (commandKey && shortcutKey === 'g' && !typing) { e.preventDefault(); e.shiftKey ? ungroupSelectedNodes() : groupSelectedNodes() }
  if (commandKey && shortcutKey === 'd' && !typing) { e.preventDefault(); duplicate() }
  if (commandKey && shortcutKey === 'x' && !typing) { e.preventDefault(); cutSelected() }
  if (commandKey && shortcutKey === 'c' && !typing) { e.preventDefault(); copySelected() }
  if (commandKey && shortcutKey === 'v' && !typing) { e.preventDefault(); pasteNode() }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) deleteSelected()
  if (e.key === 'Escape') {
    editingFormId.value = null
    editingText.value = null
    showSaveMenu.value = false
    setConnectionAnchor(null)
    activeTool.value = 'select'
  }
}

// 其他响应式数据若在滚轮手势中刷新，重新覆盖一次瞬时合成样式，避免实时数据把舞台拉回旧倍率。
onUpdated(() => {
  const target = projectedCanvasZoom
  if (!target) return
  renderTransientCanvasZoom(target)
})

// 全局监听与定时器在组件生命周期内成对注册和释放，避免热更新或重复挂载产生幽灵操作。
onMounted(async () => {
  componentLifecycleActive = true
  workspaceSwitchPending.value = true
  try {
    let restored = await restoreWorkspacePaperSessions()
    if (!componentLifecycleActive) return
    if (!restored) {
      restored = await restoreStoredWorkspaceProject()
      if (!componentLifecycleActive) return
    }
    if (!restored) {
      ensurePaperSession()
      // 首次进入空白图纸只建立独立的本地配置目录，不继承旧工作空间连接，也不会发起连接测试。
      await activateCurrentDrawingPointCatalog({ inheritLegacyWorkspace: false })
    }
  } finally {
    if (componentLifecycleActive) workspaceSwitchPending.value = false
  }
  if (!componentLifecycleActive) return
  window.addEventListener('keydown', keydown)
  window.addEventListener('pointerdown', closeContextMenu)
  window.addEventListener('pointerup', finishTableDataSelectionDrag)
  window.addEventListener('pointercancel', finishTableDataSelectionDrag)
  window.addEventListener('resize', handlePreviewWindowResize)
  window.addEventListener('focus', reconcilePreviewFullscreenState)
  window.addEventListener('resize', updateStructureViewport)
  window.addEventListener('storage', handleProjectStorageChange)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.addEventListener('visibilitychange', reconcilePreviewFullscreenState)
  rememberWorkspace()
  clockTimer = setInterval(() => {
    if (hasAutomaticTime.value) currentTimeTick.value = Date.now()
    if (hasServerTime.value && Date.now() - serverTimeSyncedAt.value > 300000) syncServerTime(true)
  }, 1000)
  await nextTick()
  if (!componentLifecycleActive) return
  canvas.value?.scrollTo({ left: 0, top: 0 })
  updateViewport()
  resizeObserver = new ResizeObserver(updateViewport)
  previewResizeObserver = new ResizeObserver(updatePreviewViewport)
  if (canvas.value) resizeObserver.observe(canvas.value)
  scheduleBundlePrewarm()
})
onUnmounted(() => {
  componentLifecycleActive = false
  previewMediaReadinessGate.cancelAll()
  invalidateProjectCacheTasks()
  invalidateRuntimeDataReplays()
  abortActiveNodeFileReaders()
  cancelPendingBundleWork('unmounted')
  workspaceAsyncOperationBarrier.dispose()
  cancelLargeSelectionCommit()
  clearEditorProgressiveDomMount()
  resetEditorLodRecovery()
  largeSelectionTransformWorker?.terminate()
  largeSelectionTransformWorker = null
  bundleCaptureScheduler.dispose()
  bundleInstanceScheduler.dispose()
  documentIndexCompactionScheduler.dispose()
  projectRuntimePreparer.dispose()
  projectJsonParser.dispose()
  libraryDragImages.clear()
  workspaceSessionStore.close()
  cancelScheduledWorkspaceSessionPersistence()
  workspaceSessionIdleTask.dispose()
  previewFitFallbackIdleTask.dispose()
  if (bundlePrewarmFrame) cancelBundleFrame(bundlePrewarmFrame)
  bundlePrewarmFrame = 0
  bundleReadyInstances.clear()
  bundlePrewarmRequests.length = 0
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('pointerdown', closeContextMenu)
  window.removeEventListener('pointerup', finishTableDataSelectionDrag)
  window.removeEventListener('pointercancel', finishTableDataSelectionDrag)
  window.removeEventListener('resize', handlePreviewWindowResize)
  window.removeEventListener('focus', reconcilePreviewFullscreenState)
  window.removeEventListener('resize', updateStructureViewport)
  window.removeEventListener('storage', handleProjectStorageChange)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.removeEventListener('visibilitychange', reconcilePreviewFullscreenState)
  resizeObserver?.disconnect()
  previewResizeObserver?.disconnect()
  runtimeGateway.disconnect()
  unsubscribeSourceSnapshots()
  sourceBindingRuntime.dispose()
  unsubscribePointCatalog()
  pointCatalogGateway.dispose?.()
  unsubscribeRuntimeGateway()
  unsubscribeRuntimeStore()
  operationGateway.dispose()
  clearInterval(clockTimer)
  stopRuntimeData()
  if (viewportFrame) cancelAnimationFrame(viewportFrame)
  invalidatePreviewViewportSchedule()
  if (pointerFrame) cancelAnimationFrame(pointerFrame)
  // 卸载时丢弃尚未执行的指针帧，避免 pointerUp 再访问已释放的画布节点。
  pointerFrame = 0
  pendingPointer = null
  if (miniMapRevisionFrame) cancelAnimationFrame(miniMapRevisionFrame)
  if (editorLodRenderFrame) cancelAnimationFrame(editorLodRenderFrame)
  if (runtimeCanvasRenderFrame) cancelAnimationFrame(runtimeCanvasRenderFrame)
  runtimeCanvasDirtyQueue.clear()
  clearTimeout(documentInputRenderTimer)
  clearTimeout(previewCanvasDocumentRenderTimer)
  cancelPendingCanvasZoom({ commit: false })
  endPolylineStartPointDrag()
  pointerUp()
  finishCanvasScrollInteraction()
  interactionCommitBarrier.dispose()
})
</script>

<template>
<div class="app-shell" :inert="workspaceSwitchPending" :aria-busy="workspaceSwitchPending">
  <div v-if="largeSelectionCommitPending" class="geometry-commit-shield" role="status" aria-label="正在完成组合变换"></div>
  <header v-show="!showPreview" class="topbar">
    <div class="brand">
      <BrandMark :label="BRAND_NAME" />
      <span>{{ BRAND_NAME }}</span>
    </div>
    <div class="toolbar">
      <button class="tool" :disabled="fileOperationPending" @click="openDrawingDirectory" title="打开项目图纸库"><FolderOpen /><span>打开</span></button>
      <div class="save-control" @pointerdown.stop>
        <button class="tool save-main" :disabled="fileOperationPending" @click="saveDrawing" :title="`${saveTargetTitle} (Ctrl+S)`"><Save /><span>保存</span></button>
        <button class="save-menu-toggle" :class="{ active: showSaveMenu }" :disabled="fileOperationPending" @click="showSaveMenu = !showSaveMenu" title="选择保存位置"><ChevronDown /></button>
        <div v-if="showSaveMenu" class="save-menu">
          <button @click="saveDrawingToProjectDirectory(currentDrawingFile.kind !== 'project')"><HardDrive /><span><b>保存到项目图纸库</b><small>图纸库/{{ projectDrawingTargetName }}</small></span></button>
          <button @click="saveDrawingAsCustomFile"><FolderOpen /><span><b>另存到其他位置</b><small>选择文件夹和文件名</small></span></button>
        </div>
      </div>
      <i aria-hidden="true"></i>
      <button v-for="t in tools" :key="t.id" class="tool" :class="{ active: activeTool === t.id || (t.id === 'map' && showMiniMap) }" @click="setTool(t.id)" :title="t.label"><component :is="t.icon" /><span>{{ t.label }}</span></button>
      <i aria-hidden="true"></i>
      <button class="tool" @click="undo" :disabled="!history.length" title="撤销 Ctrl+Z"><Undo2 /><span>撤销</span></button>
      <button class="tool" @click="redo" :disabled="!future.length" title="重做 Ctrl+Y"><Redo2 /><span>重做</span></button>
      <button class="tool" @click="toggleLock" :class="{ active: selectedNodes.length ? selectedNodesAllLocked : selectedDrawing?.locked }" title="锁定或解锁选中对象"><Unlock v-if="selectedNodes.length ? selectedNodesAllLocked : selectedDrawing?.locked" /><Lock v-else /><span>锁定</span></button>
      <button class="tool" :class="{ active: selectedNodesAreSingleGroup }" :disabled="selectedNodeCount < 2 || selectedNodesContainLocked" @click="selectedNodesAreSingleGroup ? ungroupSelectedNodes() : groupSelectedNodes()" :title="selectedNodesAreSingleGroup ? '取消组合 Ctrl+Shift+G' : '组合选中组件 Ctrl+G'"><Ungroup v-if="selectedNodesAreSingleGroup" /><Group v-else /><span>{{ selectedNodesAreSingleGroup ? '取消组合' : '组合' }}</span></button>
      <button class="tool" :disabled="!selectedEntity || selectedEntitiesContainLocked" @click="bringFront" title="将选中组件置于顶层"><BringToFront /><span>置顶</span></button>
      <button class="tool" @click="showGrid = !showGrid" :class="{ active: showGrid }" title="显示网格"><Grid3X3 /><span>网格</span></button>
      <i class="toolbar-group-divider" aria-hidden="true"></i>
      <button v-for="t in workspaceTools" :key="t.id" class="tool workspace-tool" :class="{ active: t.id === 'dataSource' && dataSourceManagerOpen }" @click="setTool(t.id)" :title="t.label"><component :is="t.icon" /><span>{{ t.label }}</span></button>
    </div>
    <div class="top-actions"><button class="preview-button" @click="openPreview"><Play :size="16" />预览</button></div>
  </header>

  <main v-show="!showPreview" class="workspace">
    <aside class="left-panel">
      <div class="search"><Search /><input v-model="search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" data-testid="library-search" /></div>
      <nav class="tabs"><button v-for="t in ['图纸', '组件', '我的']" :key="t" :class="{ on: leftTab === t }" @click="setLeftTab(t)">{{ t }}</button></nav>
      <div v-if="leftTab === '组件'" class="library">
        <section v-for="g in filteredGroups" :key="g.name">
          <button class="section-title" @click="toggleGroup(g.name)"><ChevronDown v-if="groupIsOpen(g.name)" /><ChevronRight v-else />{{ g.name }}<small>{{ g.items.length }}</small></button>
          <div v-show="groupIsOpen(g.name)" class="shape-grid"><button v-for="item in g.items" :key="item.type" :class="{ active: isPolylineNodeType(item.type) && activeTool === item.type, 'drawing-tool': isPolylineNodeType(item.type) }" draggable="true" :data-testid="isPolylineNodeType(item.type) ? `${item.type}-library-item` : undefined" :aria-pressed="isPolylineNodeType(item.type) ? activeTool === item.type : undefined" @dragstart="dragStartItem($event, item.type)" @dblclick="handleCatalogItemDoubleClick(item)" :title="catalogItemTitle(item)"><component :is="item.icon" /><span>{{ item.name }}</span></button></div>
        </section>
      </div>
      <div v-else-if="leftTab === '图纸'" class="paper-list">
        <div v-if="filteredPaperSessionEntries.length" class="paper-session-list">
          <div v-for="entry in filteredPaperSessionEntries" :key="entry.id" class="paper-session-row" :class="{ active: entry.active }">
            <button class="paper paper-session-main" :class="{ active: entry.active }" :disabled="fileOperationPending" data-testid="paper-card" @click="activatePaperSession(entry.id)" :title="entry.active ? '当前正在编辑，点击查看图纸属性' : `选择并编辑“${entry.title}”`">
              <FileJson />
              <span><b>{{ entry.title }}</b><small>{{ entry.objectCount }} 个对象 · {{ entry.stageWidth }} × {{ entry.stageHeight }}</small><em :class="{ conflict: entry.nameConflict }" :title="entry.statusTitle || undefined">{{ entry.location }}<template v-if="entry.targetName"> · {{ entry.targetName }}</template></em></span>
              <i v-if="entry.active">正在编辑</i>
            </button>
            <button class="paper-delete" :disabled="fileOperationPending" @click="deletePaperSession(entry.id)" :title="`删除“${entry.title}”`"><Trash2 /></button>
          </div>
        </div>
        <div v-else class="paper-search-empty" data-testid="paper-search-empty"><Search /><b>{{ search.trim() ? '没有匹配的图纸' : '暂无图纸' }}</b></div>
        <div class="paper-actions"><button :disabled="fileOperationPending" @click="saveDrawing" :title="saveTargetTitle"><Save />保存图纸</button><button :disabled="fileOperationPending" @click="openDrawingDirectory" title="打开项目图纸库或其他位置"><FolderOpen />打开图纸</button></div>
        <button class="add-paper" :disabled="fileOperationPending" @click="newFile"><Plus />新建图纸</button>
      </div>
      <div v-else class="my-panel">
        <section class="my-library">
          <div class="my-library-head"><b>我的组件</b><small>{{ customComponents.length }}</small></div>
          <div v-if="filteredCustomComponents.length" class="my-component-grid">
            <div v-for="item in filteredCustomComponents" :key="item.id" class="my-component-item" draggable="true" role="button" tabindex="0" :aria-label="`添加${item.name}`" :title="`拖动或双击添加${item.name}`" @dragstart="dragStartCustomComponent($event, item.id)" @dblclick="instantiateCustomComponent(item.id)" @keydown.enter.prevent="instantiateCustomComponent(item.id)" @keydown.space.prevent="instantiateCustomComponent(item.id)">
              <div class="my-component-preview">
                <MiniMapPreview :nodes="item.nodes" :edges="item.edges" :stage-width="item.width" :stage-height="item.height" :width="64" :height="54" background="#ffffff" fit-mode="contain" prefer-text :aria-label="`${item.name}缩略图`" />
              </div>
              <span><b>{{ item.name }}</b><small>{{ item.nodes.length > 1 ? `${item.nodes.length} 个组件` : '单个组件' }}</small></span>
              <button type="button" @pointerdown.stop @dblclick.stop @keydown.enter.stop="deleteCustomComponent(item.id)" @keydown.space.prevent.stop="deleteCustomComponent(item.id)" @click.stop="deleteCustomComponent(item.id)" :title="`删除${item.name}`"><Trash2 /></button>
            </div>
          </div>
          <div v-else class="my-library-empty"><PackagePlus /><b>{{ search.trim() ? '没有匹配的我的组件' : '暂无我的组件' }}</b></div>
        </section>
        <section class="workspace-settings">
          <div class="workspace-summary"><Layers3 /><span><b>当前工作空间</b><small>{{ workspaceId }}</small></span></div>
          <label class="workspace-field">工作空间名称<input v-model="workspaceDraft" :disabled="fileOperationPending" maxlength="64" @keydown="handleWorkspaceNameKeydown"></label>
          <button class="primary-wide" :disabled="fileOperationPending" @click="switchWorkspace">切换工作空间</button>
        </section>
      </div>
      <button v-if="leftTab === '组件'" class="manage" @click="toggleAllGroups"><ChevronsUp v-if="allGroupsOpen" /><ChevronsDown v-else />{{ allGroupsOpen ? '收起全部图形库' : '展开全部图形库' }}</button>
    </aside>

    <section class="canvas-wrap">
      <div class="canvas-head"><input v-model="fileName" :readonly="!paperSelected" @input="markDocumentInput" /><span>{{ toolHint }}</span></div>
      <div ref="canvas" class="canvas" :class="[{ grid: showGrid, panning: operation?.type === 'pan', selecting: operation?.type === 'selectNodes', resizing: ['resize','resizeDrawing','resizeNodes'].includes(operation?.type), 'canvas-fixed': canvasLocked }, `cursor-${activeTool}`, `grid-${gridStyle}`]" :style="{ '--inverse-zoom': 1 / zoom, '--grid-size': gridSize + 'px', '--grid-color': gridColor, '--canvas-bg': canvasBg, '--canvas-border-color': canvasBorderColor, '--canvas-border-base': canvasBorderWidth + 'px' }" @scroll.passive="updateViewport" @wheel.prevent="canvasWheel" @pointermove.passive="handleCanvasPointerMove" @pointerleave="handleCanvasPointerLeave" @dragover.prevent @drop="dropItem" @pointerdown="canvasPointerDown" @dblclick="handleCanvasDoubleClick" @contextmenu="openCanvasContextMenu">
        <div ref="stageSpace" class="stage-space" :style="{ width: stageWidth * zoom + 'px', height: stageHeight * zoom + 'px' }">
        <div v-if="editorLodActive" v-show="!editorRenderPaused" ref="editorLodSurface" class="editor-lod-surface" :style="{ width: Math.max(1, stageWidth * zoom) + 'px', height: Math.max(1, stageHeight * zoom) + 'px' }">
          <div class="editor-lod-background" :class="{ 'grid-line': showGrid && gridStyle === 'line', 'grid-dot': showGrid && gridStyle === 'dot' }" :style="{ backgroundColor: canvasBg, boxShadow: `inset 0 0 0 ${Math.max(.2, canvasBorderWidth * zoom)}px ${canvasBorderColor}`, '--editor-lod-grid-size': `${editorLodGridAppearance.screenPitch}px`, '--editor-lod-grid-color': gridColor, '--editor-lod-grid-stroke': `${editorLodGridAppearance.stroke}px`, '--editor-lod-grid-dot-size': `${editorLodGridAppearance.dotSize}px` }" aria-hidden="true"></div>
          <MiniMapPreview ref="editorLodCanvas" class="editor-lod-canvas" data-testid="editor-lod-canvas" :active="!editorRenderPaused" :nodes="nodes" :edges="edges" :drawings="drawings" :render-nodes="editorLodCanvasRendersEntities" :render-drawings="editorLodCanvasRendersEntities" :node-index="nodeIndex" :ordered-entities="layerEntries" :spatial-index="nodeSpatialIndex" :drawing-spatial-index="drawingSpatialIndex" :stage-width="stageWidth" :stage-height="stageHeight" :render-plan-key="editorLodFallbackPlanKey" :width="Math.max(1, stageWidth * zoom)" :height="Math.max(1, stageHeight * zoom)" :runtime-store="runtimeData" :minimum-screen-stroke-size=".75" :max-bitmap-pixels="EDITOR_LOD_FALLBACK_BITMAP_PIXELS" background="transparent" fit-mode="stretch" render-mode="frame" incremental-runtime geometry-interactive faithful aria-label="低倍率编辑画布" @render-complete="handleEditorLodRenderComplete" @render-error="handleEditorLodRenderError" @geometry-complete="handleEditorLodGeometryComplete" />
          <div v-if="editorLodDetailBounds && !editorRenderPaused" class="editor-lod-detail-window" :class="{ 'is-ready': editorLodDetailVisible, 'is-stale': !editorLodDetailFresh }" :data-frame-fresh="editorLodDetailFresh ? 'true' : 'false'" :style="editorLodDetailFrameStyle" aria-hidden="true">
            <div class="editor-lod-detail-background" :class="{ 'grid-line': showGrid && gridStyle === 'line', 'grid-dot': showGrid && gridStyle === 'dot' }" :style="editorLodDetailGridStyle"></div>
            <MiniMapPreview ref="editorLodDetailCanvas" class="editor-lod-detail-canvas" :nodes="editorLodDetailNodes" :edges="editorLodDetailEdges" :drawings="editorLodDetailDrawings" :render-nodes="editorLodCanvasRendersEntities" :render-drawings="editorLodCanvasRendersEntities" :node-index="nodeIndex" :ordered-entities="editorLodDetailEntities" :spatial-index="nodeSpatialIndex" :edge-spatial-index="edgeSpatialIndex" :drawing-spatial-index="drawingSpatialIndex" :stage-width="stageWidth" :stage-height="stageHeight" :view-box="editorLodDetailBounds" :render-plan-key="editorLodDetailPlanKey" :width="Math.max(1, editorLodDetailBounds.w * zoom)" :height="Math.max(1, editorLodDetailBounds.h * zoom)" :runtime-store="runtimeData" :minimum-screen-text-size="EDITOR_LOD_MIN_TEXT_SCREEN_SIZE" :minimum-screen-stroke-size="1" :max-bitmap-pixels="editorLodDetailBitmapBudget" :pixel-ratio="editorLodDetailPixelRatio" :render-budget-ms="6" background="transparent" fit-mode="stretch" render-mode="task" incremental-runtime geometry-interactive atomic-css-size faithful test-id="editor-lod-detail-canvas" aria-label="编辑画布清晰视口" @render-complete="handleEditorLodDetailRenderComplete" @render-error="handleEditorLodDetailRenderError" @geometry-complete="handleEditorLodDetailGeometryComplete" />
          </div>
        </div>
        <div ref="stage" class="stage" :style="{ width: stageWidth + 'px', height: stageHeight + 'px', transform: `scale(${zoom})` }" :class="{ 'editor-lod-stage': editorLodActive }">
          <svg v-if="!editorRenderPaused" class="edges" :width="stageWidth" :height="stageHeight">
            <defs>
              <marker id="editor-arrow" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="9" refY="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke" /></marker>
              <marker id="editor-circle" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="5" refY="5" markerUnits="userSpaceOnUse" orient="auto"><circle cx="5" cy="5" r="4" fill="context-stroke" /></marker>
              <marker id="editor-square" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="5" refY="5" markerUnits="userSpaceOnUse" orient="auto"><rect x="1" y="1" width="8" height="8" fill="context-stroke" /></marker>
            </defs>
            <line v-for="entry in renderedEdgeEntries" v-show="!editorLodGeometryHiddenEdgeIds.has(entry.edge.id)" :key="entry.edge.id" :x1="entry.start.x" :y1="entry.start.y" :x2="entry.end.x" :y2="entry.end.y" :stroke="entry.edge.color" :stroke-width="entry.edge.width" :stroke-dasharray="entry.edge.dash ? '8 6' : ''" stroke-linecap="round" :marker-start="edgeMarkerUrl(entry.edge.startMarker, 'editor')" :marker-end="edgeMarkerUrl(entry.edge.endMarker, 'editor')" />
          </svg>
          <svg v-if="polylineDraft" class="polyline-draft-layer" :width="stageWidth" :height="stageHeight" aria-hidden="true">
            <polyline :points="polylineDraftPointString" fill="none" :stroke="polylineDraft.color" :stroke-width="polylineDraft.width" :stroke-dasharray="polylineDraft.dash ? `${Math.max(1, polylineDraft.width * 4)} ${Math.max(1, polylineDraft.width * 3)}` : undefined" :stroke-linecap="polylineDraft.lineCap" :stroke-linejoin="polylineDraft.lineJoin" :marker-start="edgeMarkerUrl(polylineDraft.startMarker, 'editor')" :marker-end="edgeMarkerUrl(polylineDraft.endMarker, 'editor')" />
            <circle v-for="(point, index) in polylineDraft.points" :key="index" :class="{ 'polyline-start-point': index === 0 }" :data-testid="index === 0 ? 'polyline-start-point' : undefined" :cx="point.x" :cy="point.y" :r="(index === 0 ? 7 : 4) / zoom" :stroke="polylineDraft.color" :stroke-width="(index === 0 ? 2 : 1) / zoom" @pointerdown="index === 0 && startPolylineStartPointDrag($event)" />
          </svg>
          <div v-if="selectionMarquee" class="selection-marquee" data-testid="selection-marquee" :style="{ left: selectionMarquee.x + 'px', top: selectionMarquee.y + 'px', width: selectionMarquee.w + 'px', height: selectionMarquee.h + 'px' }"></div>
          <div v-if="pendingBundleInsertion" class="pending-bundle-frame" :class="`pending-${pendingBundleInsertion.kind}`" data-testid="pending-bundle-insertion" aria-hidden="true" :style="{ left: pendingBundleInsertion.x + 'px', top: pendingBundleInsertion.y + 'px', width: pendingBundleInsertion.w + 'px', height: pendingBundleInsertion.h + 'px' }"></div>
          <svg v-for="entry in editorRenderedDrawingEntries" :key="entry.drawing.id" class="drawing-layer" :class="{ locked: entry.drawing.locked }" :style="{ left: entry.frame.x + 'px', top: entry.frame.y + 'px', width: entry.frame.w + 'px', height: entry.frame.h + 'px', zIndex: drawingLayerIndex.get(entry.drawing.id) }" :viewBox="`${entry.frame.x} ${entry.frame.y} ${entry.frame.w} ${entry.frame.h}`" preserveAspectRatio="none">
            <path class="drawing-hit" :d="entry.path" fill="none" stroke="transparent" :stroke-width="Math.max(14, entry.drawing.width + 10)" @pointerdown="drawingPointerDown($event, entry.drawing)" @contextmenu="openContextMenu($event, null, entry.drawing)" />
            <path v-show="!editorLodGeometryHiddenDrawingIds.has(entry.drawing.id)" class="drawing-path" :class="{ selected: selectedDrawingId === entry.drawing.id }" :d="entry.path" :fill="entry.drawing.closed ? `${entry.drawing.color}22` : 'none'" :stroke="entry.drawing.color" :stroke-width="entry.drawing.width" :stroke-dasharray="entry.drawing.dash ? '8 6' : ''" :stroke-linecap="entry.drawing.lineCap || 'round'" :stroke-linejoin="entry.drawing.lineJoin || 'round'" :opacity="entry.drawing.opacity ?? 1" />
            <rect v-if="selectedDrawingId === entry.drawing.id" class="drawing-selection" :x="entry.bounds.x - 5" :y="entry.bounds.y - 5" :width="entry.bounds.w + 10" :height="entry.bounds.h + 10" />
          </svg>

          <div v-if="activeTool === 'select' && selectedDrawingEntry && !selectedDrawingEntry.drawing.locked" class="drawing-transform-box node-shell selected" :style="{ left: selectedDrawingEntry.bounds.x + 'px', top: selectedDrawingEntry.bounds.y + 'px', width: Math.max(1, selectedDrawingEntry.bounds.w) + 'px', height: Math.max(1, selectedDrawingEntry.bounds.h) + 'px' }">
            <i v-for="dir in resizeDirections" :key="dir" class="resize-handle" :class="dir" @pointerdown="startDrawingResize($event, selectedDrawingEntry.drawing, dir)"></i>
          </div>

          <div v-if="activeTool === 'select' && selectedNodeCount > 1 && selectedNodeInteractionBounds" class="group-transform-box node-shell selected selection-primary" :class="{ grouped: selectedNodesAreSingleGroup, 'rotate-handle-below': rotateHandleBelow(selectedNodeInteractionBounds), 'transient-transform': Boolean(largeSelectionPreviewBounds) }" data-testid="group-transform-box" :style="{ left: selectedNodeInteractionBounds.x + 'px', top: selectedNodeInteractionBounds.y + 'px', width: selectedNodeInteractionBounds.w + 'px', height: selectedNodeInteractionBounds.h + 'px' }">
            <template v-if="!selectedNodesContainLocked">
              <i v-for="dir in resizeDirections" :key="dir" class="resize-handle" :class="dir" @pointerdown="startSelectedNodesResize($event, dir)"></i>
              <button class="rotate-handle" @pointerdown="startSelectedNodesRotate" title="旋转组合"><RotateCcw /></button>
            </template>
          </div>

          <div v-if="activeTool === 'select' && selected && selectedNodeCount === 1 && !selected.locked" class="single-node-transform-box node-shell selected selection-primary" :class="{ 'rotate-handle-below': rotateHandleBelow(selected), 'compact-resize-handles': Math.min(selected.w, selected.h) * zoom < 24 }" data-testid="single-node-transform-box" :style="{ left: selected.x + 'px', top: selected.y + 'px', width: selected.w + 'px', height: selected.h + 'px', transform: `rotate(${selected.rotate || 0}deg)`, '--node-counter-rotation': `${-(Number(selected.rotate) || 0)}deg` }">
            <svg v-if="isPolylineNodeType(selected.type)" class="polyline-point-editor" :viewBox="`0 0 ${Math.max(.1, selected.w)} ${Math.max(.1, selected.h)}`" preserveAspectRatio="none" :aria-label="selected.type === 'flowDirection' ? '流向节点编辑' : '线段节点编辑'">
              <path class="polyline-point-handle-layer" data-testid="polyline-point-handle-layer" :data-point-count="selected.polylinePoints.length" :d="selectedPolylinePointPaths.all" :stroke-width="24 / zoom" @pointerdown="startPolylinePointLayerDrag($event, selected)" />
              <path class="polyline-point-dot-outer" :d="selectedPolylinePointPaths.all" :stroke-width="12 / zoom" />
              <path class="polyline-point-dot-inner" :d="selectedPolylinePointPaths.all" :stroke-width="8 / zoom" />
              <path class="polyline-point-endpoint-outer" :d="selectedPolylinePointPaths.endpoints" :stroke-width="12 / zoom" />
              <path class="polyline-point-endpoint-inner" :d="selectedPolylinePointPaths.endpoints" :stroke-width="8 / zoom" />
            </svg>
            <i v-for="dir in resizeDirections" :key="dir" class="resize-handle" :class="dir" :style="{ cursor: resizeHandleCursor(dir, selected.rotate) }" @pointerdown="startResize($event, selected, dir)"></i>
            <button class="rotate-handle" @pointerdown="startRotate($event, selected)" title="拖动旋转"><RotateCcw /></button>
          </div>

          <div v-for="n in editorRenderedNodes" :key="n.id" :data-node-id="n.id" v-memo="[nodeRenderMemo(n),isNodeSelected(n.id),selectedId === n.id,selectedId === n.id && selectedNodeCount === 1,connectFrom === n.id,editingText?.id === n.id,editingFormId === n.id,editorProgressiveDomNodeHidden(n.id),editorLodSignalAnimationTimestamp(n)]" class="node-shell" :class="{ selected: isNodeSelected(n.id), 'selection-primary': selectedId === n.id, 'single-transform-source': selectedId === n.id && selectedNodeCount === 1 && !n.locked, 'multi-selected': selectedNodeCount > 1 && isNodeSelected(n.id), connecting: connectFrom === n.id, locked: n.locked, 'line-node': n.type === 'lineShape' || isPolylineNodeType(n.type), 'form-interacting': editingFormId === n.id && !n.locked, 'progressive-dom-hidden': editorProgressiveDomNodeHidden(n.id) }" :style="{ left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px', zIndex: nodeLayerIndex.get(n.id), transform: `rotate(${n.rotate || 0}deg)` }" @pointerdown="nodePointerDown($event, n)" @dblclick="handleNodeDoubleClick($event, n)" @contextmenu="openContextMenu($event, n)">
            <i class="node-move-hit" data-testid="node-move-hit" aria-hidden="true"></i>
            <NodeVisual :key="`${n.id}:${n.dataKey}`" v-show="!editorLodGeometryHiddenNodeIds.has(n.id)" :node="n" :runtime-store="runtimeData" :time-context="timeRenderContext" :signal-animation-timestamp="editorLodSignalAnimationTimestamp(n)" :interactive="editingFormId === n.id && !n.locked" @form-change="handleFormChange(n, $event)" @table-cell-view="openTableCellViewer(n, $event)" @table-edit="openTableDataEditor(n)" />
            <input v-if="editingText?.id === n.id && !n.locked" ref="textEditor" v-model="n.text" data-testid="inline-text-editor" lang="zh-CN" inputmode="text" autocomplete="off" class="inline-text-editor" @pointerdown.stop @dblclick.stop @compositionstart="inlineTextComposing = true" @compositionend="inlineTextComposing = false" @keydown="handleInlineTextEditorKeydown" @blur="inlineTextComposing = false; finishTextEdit()" />
            <span v-if="n.locked" class="lock-badge" title="组件已锁定，请使用属性栏或右键菜单解锁" @pointerdown.stop="handleLockedBadgePointerDown($event, n)" @dblclick.stop="handleNodeDoubleClick($event, n)"><Lock /></span>
          </div>
        </div>
        </div>
      </div>

      <div v-if="showMiniMap" class="minimap">
        <div class="minimap-stage" @pointerdown="navigateMiniMap">
          <MiniMapPreview ref="miniMapPreview" :active="showMiniMap && !showPreview" :nodes="nodes" :edges="edges" :drawings="drawings" :node-index="nodeIndex" :ordered-entities="layerEntries" :spatial-index="nodeSpatialIndex" :drawing-spatial-index="drawingSpatialIndex" :stage-width="stageWidth" :stage-height="stageHeight" :width="miniMapWidth" :height="miniMapHeight" :runtime-store="runtimeData" :background="canvasBg" fit-mode="contain" incremental-runtime faithful />
          <b class="minimap-canvas-frame" :style="miniMapCanvasStyle" aria-hidden="true"></b>
          <b class="minimap-viewport" :style="miniMapViewportStyle" aria-hidden="true"></b>
          <span class="minimap-current-label">当前窗口</span>
        </div>
      </div>
      <div class="zoom-bar"><button :disabled="canvasLocked" @click="setCanvasZoom(steppedCanvasZoom(zoom, -1))" title="缩小"><ZoomOut /></button><span>{{ formatCanvasZoom(zoom) }}</span><button :disabled="canvasLocked" @click="setCanvasZoom(steppedCanvasZoom(zoom, 1))" title="放大"><ZoomIn /></button><button :class="{ active: canvasLocked }" @click="toggleCanvasLock" :title="canvasLocked ? '解除固定画布' : '固定当前画布'"><PinOff v-if="canvasLocked" /><Pin v-else /></button><button :disabled="canvasLocked" @click="resetCanvasView" title="回到原始定位"><RotateCcw /></button></div>
    </section>

    <aside class="right-panel" :class="{ closed: !rightOpen }">
      <button class="panel-toggle" @click="rightOpen = !rightOpen"><PanelRightClose /></button>
      <template v-if="rightOpen">
        <nav class="tabs right-tabs"><button v-for="t in ['属性', '通信', '布局', '结构']" :key="t" :class="{ on: rightTab === t }" @click="rightTab = t">{{ t }}</button></nav>
        <div ref="propertiesPanel" class="properties" v-show="rightTab === '属性'" @focusin.capture="beginSelectedFieldEdit" @focusout.capture="finishActiveFieldEdit" @input.capture="markDocumentInput" @change.capture="markDocumentInput">
          <template v-if="selected">
            <div class="prop-head"><div><b>{{ selectedNodeCount > 1 ? (selectedNodesAreSingleGroup ? '组合组件' : '多选组件') : (selected.type === 'text' ? '文本' : (selected.text || '图形')) }}</b><small>{{ selectedNodeCount > 1 ? `${selectedNodesAreSingleGroup ? '已组合' : '已选'} ${selectedNodeCount} 个组件` : `${selectedCategory} · ID ${selected.id}` }}</small></div><button @click="toggleLock" :title="selectedNodesAllLocked ? '解锁' : '锁定'"><Unlock v-if="selectedNodesAllLocked" /><Lock v-else /></button><button :disabled="selectedNodesContainLocked" @click="duplicate" title="复制"><Copy /></button><button class="danger" :disabled="selectedNodesContainLocked" @click="deleteSelected" title="删除"><Trash2 /></button></div>
            <div v-if="selectedNodesContainLocked" class="locked-property-state" data-testid="locked-property-state"><Lock /><div><b>组件已锁定</b><span>属性、内容和画布变换保持只读，请使用上方锁定按钮解锁。</span></div></div>
            <fieldset class="selection-property-editor" :disabled="selectedNodesContainLocked" :aria-disabled="selectedNodesContainLocked">
            <template v-if="selectedNodeCount > 1">
              <div class="group-property-actions">
                <button v-if="canGroupSelection" class="primary" data-testid="group-selection" @click="groupSelectedNodes"><Group />组合为组件</button>
                <button v-if="selectedGroups.size" data-testid="ungroup-selection" @click="ungroupSelectedNodes"><Ungroup />取消组合</button>
                <button @click="addSelectionToMyLibrary"><PackagePlus />添加为我的</button>
              </div>
              <h3>整体位置与尺寸</h3>
              <div v-if="selectedNodeBounds" class="form-grid group-metrics">
                <label>X<input type="number" :disabled="selectedNodesContainLocked" :value="roundedMetric(selectedNodeBounds.x)" @change="setSelectedNodesMetric('x', $event.target.value)"></label>
                <label>Y<input type="number" :disabled="selectedNodesContainLocked" :value="roundedMetric(selectedNodeBounds.y)" @change="setSelectedNodesMetric('y', $event.target.value)"></label>
                <label>宽<input type="number" :min="selectedNodeTransformSummary.minimum.w" :max="selectedNodeTransformSummary.maximum.w" step="0.1" :disabled="selectedNodesContainLocked" :value="roundedMetric(selectedNodeBounds.w)" @change="setSelectedNodesMetric('w', $event.target.value)"></label>
                <label>高<input type="number" :min="selectedNodeTransformSummary.minimum.h" :max="selectedNodeTransformSummary.maximum.h" step="0.1" :disabled="selectedNodesContainLocked" :value="roundedMetric(selectedNodeBounds.h)" @change="setSelectedNodesMetric('h', $event.target.value)"></label>
              </div>
              <h3>组合图层</h3>
              <div class="layer-actions"><button @click="bringFront">置顶</button><button @click="sendBack">置底</button><button @click="moveLayer(1)">上一个图层</button><button @click="moveLayer(-1)">下一个图层</button></div>
            </template>
            <template v-else>
            <h3>{{ selected.type === 'lineShape' ? '线条尺寸' : isPolylineNodeType(selected.type) ? (selected.type === 'flowDirection' ? '流向尺寸' : '线段尺寸') : '基础属性' }}</h3><div class="form-grid"><label>X<input type="number" v-model.number="selected.x" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"></label><label>Y<input type="number" v-model.number="selected.y" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"></label><label>{{ selected.type === 'lineShape' ? '宽度' : '宽' }}<input type="number" :min="nodeMinimumSize(selected).w" step="1" v-model.number="selected.w" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"></label><label>{{ selected.type === 'lineShape' ? '高度' : '高' }}<input type="number" :min="nodeMinimumSize(selected).h" :step="selected.type === 'lineShape' ? 0.1 : 1" v-model.number="selected.h" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"></label><label>旋转<input type="number" v-model.number="selected.rotate" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"></label><label>层级<button @click="bringFront">置顶</button></label></div>
            <template v-if="supportsInteractionAnimation(selected)">
              <h3>交互动画</h3><label class="field">动画效果<select :value="selected.animation" data-testid="interaction-animation-select" @change="setInteractionAnimation(selected, $event.target.value)"><option v-for="option in interactionAnimationOptions(selected)" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            </template>
            <template v-if="selected.type === 'pencil'">
              <h3>线条编辑</h3><label class="field">线条颜色<input type="color" v-model="selected.pencilColor"></label><label class="field">线条宽度<input type="number" min="0.1" max="100" step="0.1" v-model.number="selected.pencilWidth"></label><label class="field">透明度<input type="range" min="0" max="1" step="0.05" v-model.number="selected.opacity"><span>{{ Math.round((selected.opacity ?? 1) * 100) }}%</span></label><label class="switch-row">虚线<input type="checkbox" v-model="selected.pencilDash"><i></i></label><label class="switch-row">平滑曲线<input type="checkbox" v-model="selected.pencilSmooth"><i></i></label><label class="switch-row">闭合并填充<input type="checkbox" v-model="selected.pencilClosed"><i></i></label><label class="field">端点<select v-model="selected.pencilLineCap"><option value="round">圆形</option><option value="butt">平直</option><option value="square">方形</option></select></label><label class="field">连接<select v-model="selected.pencilLineJoin"><option value="round">圆角</option><option value="bevel">斜角</option><option value="miter">尖角</option></select></label>
              <h3>组件操作</h3><p class="property-note">铅笔线稿是普通组件，可框选、旋转、缩放、锁定，并可与其他组件组合或添加到“我的”。</p>
            </template>
            <template v-if="isPolylineNodeType(selected.type)">
              <h3>线条样式</h3>
              <label class="field">线条颜色<input type="color" v-model="selected.polylineColor"></label>
              <label class="switch-row">线条完全透明<input type="checkbox" :checked="selected.polylineOpacity === 0" @change="selected.polylineOpacity = $event.target.checked ? 0 : 1"><i></i></label>
              <label class="field">线条不透明度<input type="range" min="0" max="1" step="0.05" v-model.number="selected.polylineOpacity"><span>{{ Math.round((selected.polylineOpacity ?? 1) * 100) }}%</span></label>
              <label v-if="selected.type === 'polyline'" class="field">线条样式<select v-model="selected.polylineStyle" data-testid="polyline-style"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
              <template v-if="selected.type === 'flowDirection'"><label class="field">虚线长度<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashLength"></label><label class="field">虚线间隔<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashGap"></label></template>
              <template v-else-if="selected.polylineStyle !== 'solid'"><label class="field">线段长度<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashLength"></label><label class="field">线段间隔<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashGap"></label></template>
              <label class="switch-row">显示轮廓<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
              <label class="field">轮廓颜色<input type="color" v-model="selected.stroke"></label>
              <label class="field">轮廓宽度<input type="number" min="0" max="20" step="0.1" v-model.number="selected.borderWidth"></label>
              <h3 v-if="selected.type === 'flowDirection'">流向属性</h3><h3 v-else>线段属性</h3>
              <label class="field">分段数<input type="number" min="1" max="9999" step="1" :value="polylineSegmentCount(selected)" data-testid="polyline-segment-count" @change="setPolylineSegmentCount(selected, $event.target.value)"></label>
              <label class="field">线条宽度<input type="number" min="0.1" max="100" step="0.1" v-model.number="selected.polylineWidth"></label>
              <label class="field">箭头大小<input type="number" min="1" max="100" step="1" v-model.number="selected.polylineArrowSize" data-testid="polyline-arrow-size"></label>
              <template v-if="selected.type === 'flowDirection'"><label class="field">流动方向<select v-model="selected.animationDirection" @change="refreshBuiltInAnimation(selected)"><option value="normal">从起点到终点</option><option value="reverse">从终点到起点</option></select></label><label class="switch-row">显示方向箭头<input type="checkbox" v-model="selected.flowArrowVisible"><i></i></label><label class="switch-row">启用流动<input type="checkbox" :checked="selected.animation === 'flow'" @change="setFlowDirectionAnimationEnabled(selected, $event.target.checked)"><i></i></label><label class="field">流动周期（秒）<input type="number" :min="ANIMATION_DURATION_MIN_SECONDS" :max="BUILT_IN_ANIMATION_DURATION_MAX_SECONDS" step="0.1" v-model.number="selected.animationDuration" @input="refreshBuiltInAnimation(selected)" @change="normalizeBuiltInAnimationDuration(selected)"></label><label class="switch-row">暂停流动<input type="checkbox" v-model="selected.animationPaused" @change="refreshBuiltInAnimation(selected)"><i></i></label></template>
              <template v-else><label class="field">起点样式<select v-model="selected.polylineStartMarker"><option value="none">无</option><option value="arrow">箭头</option></select></label><label class="field">终点样式<select v-model="selected.polylineEndMarker"><option value="none">无</option><option value="arrow">箭头</option></select></label></template>
              <label class="field">端点<select v-model="selected.polylineLineCap"><option value="round">圆形</option><option value="butt">平直</option><option value="square">方形</option></select></label>
              <label class="field">连接<select v-model="selected.polylineLineJoin"><option value="round">圆角</option><option value="bevel">斜角</option><option value="miter">尖角</option></select></label>
            </template>
            <template v-if="!['lineShape','pencil','polyline','flowDirection','flowPipe','rotatingFan','signalLight','waterTank','heartbeat','particles'].includes(selected.type) && !['table','input','select','time','formProgress'].includes(selected.type)">
              <h3>文字编辑</h3>
              <label class="field">内容<input v-model="selected.text" data-testid="selected-text-content" lang="zh-CN" inputmode="text" autocomplete="off"></label>
              <div v-if="selected.type === 'text'" class="field"><span>文字排布</span><div class="text-layout-control" role="radiogroup" aria-label="文字排布" data-testid="text-layout-control"><label><input type="radio" v-model="selected.textLayout" value="horizontal" aria-label="横向排布"><span>横向</span></label><label><input type="radio" v-model="selected.textLayout" value="vertical" aria-label="竖向排布"><span>竖向</span></label></div></div>
              <label class="field">文字颜色<input type="color" v-model="selected.color"></label>
              <label class="field">字号<input type="number" min="8" max="96" v-model.number="selected.fontSize"></label>
              <label class="field">文字粗细<select v-model="selected.fontWeight"><option value="400">常规</option><option value="600">中粗</option><option value="700">粗体</option></select></label>
              <label class="field">对齐<select v-model="selected.textAlign"><option value="left">{{ selected.type === 'text' && selected.textLayout === 'vertical' ? '顶部对齐' : '左对齐' }}</option><option value="center">居中</option><option value="right">{{ selected.type === 'text' && selected.textLayout === 'vertical' ? '底部对齐' : '右对齐' }}</option></select></label>
            </template>
            <template v-if="selected.type === 'time'">
              <h3>文字样式</h3><label class="field">字号<input type="number" min="8" max="96" v-model.number="selected.fontSize" data-testid="time-font-size"></label><label class="field">文字粗细<select v-model="selected.fontWeight" data-testid="time-font-weight"><option value="400">常规</option><option value="600">中粗</option><option value="700">粗体</option></select></label>
            </template>
            <template v-if="['image','customImageMotion'].includes(selected.type)">
              <h3>图像编辑</h3><label class="field vertical">图片地址<input v-model="selected.imageUrl" placeholder="https://.../image.png"></label><label class="field">显示方式<select v-model="selected.imageFit"><option value="contain">完整显示</option><option value="cover">填满裁切</option><option value="fill">拉伸</option></select></label><button class="primary-wide" @click="nodeImageInput.click()">上传本地图片</button>
            </template>
            <template v-if="selected.type === 'video'">
              <h3>视频设置</h3>
              <div v-if="selectedVideoHasEmbeddedSource" class="video-source-status" data-testid="embedded-video-source"><Video /><span><b>本地视频</b><small v-if="selectedVideoSourceSize">{{ selectedVideoSourceSize }}</small></span><button type="button" title="移除本地视频" @click="clearSelectedVideoSource"><X /></button></div>
              <label class="field vertical">视频地址<input :value="selectedVideoEditorValue" :data-node-id="selected.id" :data-embedded-source="selectedVideoHasEmbeddedSource ? 'true' : 'false'" :maxlength="MAX_VIDEO_URL_LENGTH" :placeholder="selectedVideoHasEmbeddedSource ? '输入网络地址可替换本地视频' : 'https://.../video.mp4'" data-testid="video-url-editor" autocomplete="off" spellcheck="false" @input="cacheVideoUrlEdit" @blur="commitSelectedVideoUrl" @keydown="handleVideoUrlKeydown"></label>
              <label class="field">显示方式<select v-model="selected.videoFit"><option value="contain">完整显示</option><option value="cover">填满裁切</option><option value="fill">拉伸</option></select></label>
              <button class="primary-wide" @click="nodeVideoInput.click()">上传本地视频</button>
              <label class="switch-row">自动播放<input type="checkbox" v-model="selected.videoAutoplay"><i></i></label>
              <label class="switch-row">显示视频控制器<input type="checkbox" v-model="selected.videoControls"><i></i></label>
              <label class="field">播放频率<select v-model.number="selected.videoPlaybackRate"><option :value="0.25">0.25 倍</option><option :value="0.5">0.5 倍</option><option :value="0.75">0.75 倍</option><option :value="1">正常</option><option :value="1.25">1.25 倍</option><option :value="1.5">1.5 倍</option><option :value="2">2 倍</option><option :value="4">4 倍</option></select></label>
              <label class="field">播放次数<input type="number" min="0" max="999" step="1" v-model.number="selected.videoPlayCount"></label>
              <label class="field hint-field">次数说明<span>0 表示无限循环</span></label>
              <label class="switch-row">开启声音<input type="checkbox" :checked="!selected.videoMuted" @change="selected.videoMuted = !$event.target.checked"><i></i></label>
            </template>
            <h3 v-if="!['pencil','polyline','flowDirection'].includes(selected.type)">{{ selected.type === 'table' ? '表格样式' : selected.type === 'lineShape' ? '线条样式' : '外观与样式' }}</h3>
            <template v-if="selected.type === 'lineShape'">
              <label class="field">线条颜色<input type="color" v-model="selected.fill"></label>
              <label class="switch-row">线条完全透明<input type="checkbox" :checked="selected.backgroundOpacity === 0" @change="selected.backgroundOpacity = $event.target.checked ? 0 : 1"><i></i></label>
              <label class="field">线条不透明度<input type="range" min="0" max="1" step="0.05" v-model.number="selected.backgroundOpacity"><span>{{ Math.round((selected.backgroundOpacity ?? 1) * 100) }}%</span></label>
              <label class="field">线条样式<select v-model="selected.borderStyle" data-testid="line-shape-style"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
              <template v-if="selected.borderStyle !== 'solid'"><label class="field">线段长度<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashLength"></label><label class="field">线段间隔<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashGap"></label></template>
              <label class="switch-row">显示轮廓<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
              <label class="field">轮廓颜色<input type="color" v-model="selected.stroke"></label>
              <label class="field">轮廓宽度<input type="number" min="0" max="20" step="0.1" v-model.number="selected.borderWidth"></label>
            </template>
            <template v-else-if="!['table','pencil','polyline','flowDirection'].includes(selected.type)">
              <label class="field">填充颜色<input type="color" v-model="selected.fill"></label>
              <label class="switch-row">背景完全透明<input type="checkbox" :checked="selected.backgroundOpacity === 0" @change="selected.backgroundOpacity = $event.target.checked ? 0 : 1"><i></i></label>
              <label class="field">背景不透明度<input type="range" min="0" max="1" step="0.05" v-model.number="selected.backgroundOpacity"><span>{{ Math.round((selected.backgroundOpacity ?? 1) * 100) }}%</span></label>
              <label class="switch-row">显示边框<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
              <label class="field">边框颜色<input type="color" v-model="selected.stroke"></label>
              <label class="field">边框宽度<input type="number" min="0" max="20" step="0.1" v-model.number="selected.borderWidth"></label>
              <label class="field">边框样式<select v-model="selected.borderStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
              <template v-if="selected.borderStyle !== 'solid'"><label class="field">线段长度<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashLength"></label><label class="field">线段间隔<input type="number" min="0.1" max="50" step="0.1" v-model.number="selected.borderDashGap"></label></template>
              <label class="field">圆角<input type="range" min="0" max="100" v-model.number="selected.radius"><span>{{ selected.radius }}</span></label>
            </template>
            <template v-if="['checkbox','radio','switch'].includes(selected.type)">
              <label class="field">标签位置<select v-model="selected.labelPosition"><option value="right">控件在左</option><option value="left">控件在右</option></select></label>
              <label v-if="selected.type !== 'switch'" class="field">控件大小<input type="number" min="12" max="48" v-model.number="selected.controlSize"></label>
              <template v-else><label class="field">开关宽度<input type="number" min="28" max="100" v-model.number="selected.switchWidth"></label><label class="field">开关高度<input type="number" min="16" max="48" v-model.number="selected.switchHeight"></label></template>
            </template>
            <label v-if="!['table','pencil'].includes(selected.type)" class="field">整体透明度<input type="range" min="0.1" max="1" step="0.05" v-model.number="selected.opacity"><span>{{ Math.round((selected.opacity ?? 1) * 100) }}%</span></label>
            <template v-if="selected.type === 'table'">
              <section class="table-style-group"><h4>整体与滚动</h4>
                <label class="field">整体透明度<input type="range" min="0.1" max="1" step="0.05" v-model.number="selected.opacity"><span>{{ Math.round((selected.opacity ?? 1) * 100) }}%</span></label>
                <label class="switch-row">显示边框<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
                <label class="switch-row">显示横向滚动条<input type="checkbox" v-model="selected.tableScrollX"><i></i></label>
                <label class="switch-row">显示纵向滚动条<input type="checkbox" v-model="selected.tableScrollY"><i></i></label>
              </section>
              <section class="table-style-group"><h4>外框</h4>
                <label class="field">颜色<input type="color" v-model="selected.tableBorderColor"></label><label class="field">宽度<input type="number" min="0" max="20" step="0.1" v-model.number="selected.tableBorderWidth"></label><label class="field">样式<select v-model="selected.tableBorderStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
              </section>
              <section class="table-style-group"><h4>内框</h4>
                <label class="field">颜色<input type="color" v-model="selected.tableGridColor"></label><label class="field">宽度<input type="number" min="0" max="10" step="0.1" v-model.number="selected.tableGridWidth"></label><label class="field">样式<select v-model="selected.tableGridStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
              </section>
              <section class="table-style-group"><h4>标题</h4>
                <label class="field">背景颜色<input type="color" v-model="selected.tableTitleFill"></label><label class="field">文字颜色<input type="color" v-model="selected.tableTitleColor"></label><label class="field">字体大小<input type="number" min="8" max="48" v-model.number="selected.tableTitleSize"></label><label class="field">字体粗细<select v-model="selected.tableTitleWeight"><option value="400">常规</option><option value="600">中粗</option><option value="700">粗体</option></select></label><label class="field">对齐方式<select v-model="selected.tableTitleAlign"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              </section>
              <section class="table-style-group"><h4>表头</h4>
                <label class="field">背景颜色<input type="color" v-model="selected.tableHeaderFill"></label><label class="field">文字颜色<input type="color" v-model="selected.tableHeaderColor"></label><label class="field">字体大小<input type="number" min="8" max="48" v-model.number="selected.tableHeaderSize"></label><label class="field">字体粗细<select v-model="selected.tableHeaderWeight"><option value="400">常规</option><option value="600">中粗</option><option value="700">粗体</option></select></label><label class="field">表头高度<input type="number" min="18" max="120" v-model.number="selected.tableHeaderHeight"></label><label class="field">对齐方式<select v-model="selected.tableHeaderAlign"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              </section>
              <section class="table-style-group"><h4>内容行</h4>
                <label class="field">内容显示<select v-model="selected.tableContentDisplay"><option value="wrap">自适应换行</option><option value="ellipsis">缩略展示</option></select></label><label class="field">奇数行背景<input type="color" v-model="selected.tableRowFill"></label><label class="field">偶数行背景<input type="color" v-model="selected.tableAltRowFill"></label><label class="field">文字颜色<input type="color" v-model="selected.tableCellColor"></label><label class="field">字体大小<input type="number" min="8" max="48" v-model.number="selected.tableCellSize"></label><label class="field">字体粗细<select v-model="selected.tableCellWeight"><option value="400">常规</option><option value="600">中粗</option><option value="700">粗体</option></select></label><label class="field">统一行高<input type="number" min="18" max="120" v-model.number="selected.tableRowHeight" @input="syncAllTableRowHeights($event.target.value)"></label><label class="field">对齐方式<select v-model="selected.tableTextAlign"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
              </section>
            </template>
            <template v-if="selectedCategory === '表单'">
              <template v-if="selected.type === 'table'">
                <h3>表格内容</h3>
                <label class="field"><span>当前规模</span><output>{{ selected.tableRows }} 行 × {{ selected.tableColumns }} 列</output></label>
                <button class="secondary-wide" @click="openTableDataEditor(selected)"><TableProperties />编辑表格</button>
              </template>
              <template v-else-if="selected.type === 'checkbox'">
                <h3>复选框数据</h3><label class="switch-row">默认选中<input type="checkbox" v-model="selected.defaultChecked"><i></i></label><label class="switch-row">当前选中<input type="checkbox" v-model="selected.checked"><i></i></label>
                <label class="field">选中值<input v-model="selected.checkedValue"></label><label class="field">未选中值<input v-model="selected.uncheckedValue"></label>
              </template>
              <template v-else-if="selected.type === 'radio'">
                <h3>单选框数据</h3><label class="field">单选分组<input v-model="selected.formName" placeholder="同组名称保持一致"></label><label class="switch-row">默认选中<input type="checkbox" v-model="selected.defaultChecked"><i></i></label><label class="switch-row">当前选中<input type="checkbox" v-model="selected.checked"><i></i></label>
                <label class="field">选中值<input v-model="selected.checkedValue"></label><label class="field">未选中值<input v-model="selected.uncheckedValue"></label>
              </template>
              <template v-else-if="selected.type === 'switch'">
                <h3>开关数据</h3><label class="switch-row">默认开启<input type="checkbox" v-model="selected.defaultChecked"><i></i></label><label class="switch-row">当前开启<input type="checkbox" v-model="selected.checked"><i></i></label>
                <label class="field">开启值<input v-model="selected.checkedValue"></label><label class="field">关闭值<input v-model="selected.uncheckedValue"></label>
              </template>
              <template v-else-if="selected.type === 'formProgress'">
                <h3>进度数据</h3><label class="field">展示方式<select v-model="selected.progressMode" @change="normalizeProgress()"><option value="percent">百分比</option><option value="value">当前值 / 总数</option></select></label>
                <label v-if="selected.progressMode === 'value'" class="field">总数<input type="number" min="1" v-model.number="selected.progressMax" @change="normalizeProgress()"></label>
                <label class="field">{{ selected.progressMode === 'value' ? '当前数据' : '当前百分比' }}<input type="number" :min="0" :max="selected.progressMode === 'value' ? selected.progressMax : 100" step="0.1" v-model.number="selected.progressValue" @change="normalizeProgress()"></label><label class="switch-row">显示数值<input type="checkbox" v-model="selected.showProgressText"><i></i></label>
                <h3>进度条设置</h3>
                <label class="field">粗细<input type="number" min="2" max="80" step="1" v-model.number="selected.progressThickness"></label>
                <label class="field">长度<input type="range" min="10" max="100" step="1" v-model.number="selected.progressLength"><span>{{ selected.progressLength }}%</span></label>
                <label class="field">左端形状<select v-model="selected.progressStartShape"><option value="square">矩形</option><option value="round">圆形</option></select></label>
                <label class="field">右端形状<select v-model="selected.progressEndShape"><option value="square">矩形</option><option value="round">圆形</option></select></label>
                <label class="switch-row">开启范围波动<input type="checkbox" v-model="selected.progressFluctuationEnabled"><i></i></label>
                <template v-if="selected.progressFluctuationEnabled">
                  <div class="form-grid"><label>波动下限<input type="number" min="0" max="1" step="0.01" v-model.number="selected.progressFluctuationMin"></label><label>波动上限<input type="number" min="0" max="1" step="0.01" v-model.number="selected.progressFluctuationMax"></label></div>
                  <label class="field">波动周期（秒）<input type="number" min="0.2" max="60" step="0.1" v-model.number="selected.progressFluctuationDuration"></label>
                </template>
              </template>
              <template v-else-if="selected.type === 'button'">
                <h3>按钮数据</h3>
                <label class="field">点击动作<select v-model="selected.buttonAction"><option value="count">点击计数</option><option value="toggle">切换状态</option><option value="message">显示消息</option></select></label>
                <label v-if="selected.buttonAction === 'message'" class="field">消息内容<input v-model="selected.actionMessage"></label>
                <template v-if="selected.buttonAction === 'toggle'"><label class="switch-row">默认开启<input type="checkbox" v-model="selected.defaultChecked"><i></i></label><label class="switch-row">当前开启<input type="checkbox" v-model="selected.checked"><i></i></label><label class="field">点击前颜色<input type="color" v-model="selected.buttonBeforeColor"></label><label class="field">点击后颜色<input type="color" v-model="selected.buttonAfterColor"></label><label class="field">开启值<input v-model="selected.checkedValue"></label><label class="field">关闭值<input v-model="selected.uncheckedValue"></label></template>
                <template v-if="selected.buttonAction === 'count'"><label class="switch-row">显示数值<input type="checkbox" v-model="selected.showClickCount"><i></i></label><label class="field">当前点击次数<output>{{ selected.clickCount || 0 }}</output></label></template><button class="secondary-wide" @click="resetButtonData"><RotateCcw />重置按钮数据</button>
              </template>
              <template v-else-if="selected.type === 'input'">
                <h3>输入框数据</h3><label class="field">默认内容<input v-model="selected.defaultValue"></label><label class="field">当前内容<input v-model="selected.value"></label><label class="field">占位文字<input v-model="selected.placeholder"></label><label class="field">输入类型<select v-model="selected.inputType"><option value="text">文本</option><option value="number">数字</option><option value="password">密码</option><option value="email">邮箱</option><option value="search">搜索</option><option value="tel">电话</option><option value="url">网址</option></select></label><label class="field">最大长度<input type="number" min="1" max="1000" v-model.number="selected.maxLength"></label><label class="switch-row">只读<input type="checkbox" v-model="selected.readOnly"><i></i></label><label class="switch-row">必填<input type="checkbox" v-model="selected.required"><i></i></label>
              </template>
              <template v-else-if="selected.type === 'select'">
                <h3>选择器数据</h3><label class="field">选项数量<output>{{ selected.selectOptions.length }}</output></label>
                <div v-for="(option, index) in selected.selectOptions" :key="`option-${index}`" class="option-editor-row"><input v-model="option.label" placeholder="选项名称"><input :value="option.value" placeholder="选项值" @input="setSelectOptionValue(index, $event.target.value)"><button :disabled="selected.selectOptions.length <= 1" @click="removeSelectOption(index)" title="删除选项"><Trash2 /></button></div>
                <button class="secondary-wide" :disabled="selected.selectOptions.length >= 50" @click="addSelectOption"><Plus />添加选项</button>
                <label class="field">默认选中<select v-model="selected.defaultValue"><option v-for="(option, index) in selected.selectOptions" :key="`default-${index}`" :value="option.value">{{ option.label }}</option></select></label><label class="field">当前选中<select v-model="selected.value"><option v-for="(option, index) in selected.selectOptions" :key="`current-${index}`" :value="option.value">{{ option.label }}</option></select></label><label class="switch-row">必选<input type="checkbox" v-model="selected.required"><i></i></label>
              </template>
              <template v-else-if="selected.type === 'time'">
                <h3>时间设置</h3>
                <label class="switch-row">显示左侧图标<input type="checkbox" v-model="selected.timeShowLeftIcon" data-testid="time-left-icon-toggle"><i></i></label>
                <label class="switch-row">显示右侧图标<input type="checkbox" v-model="selected.timeShowRightIcon" data-testid="time-right-icon-toggle"><i></i></label>
                <label class="field">展示格式<select :value="selected.timeFormat" @change="setTimeFormat($event.target.value)"><option value="datetime-seconds">YYYY-MM-DDTHH:MM:SS</option><option value="datetime-local">YYYY-MM-DDTHH:MM</option><option value="date">YYYY-MM-DD</option><option value="time-seconds">HH:MM:SS</option><option value="time">HH:MM</option><option value="month">YYYY-MM</option><option value="week">YYYY-Www</option></select></label>
                <label class="field">展示方式<select :value="selected.timeMode" @change="setTimeMode($event.target.value)"><option value="fixed">展示固定时间</option><option value="elapsed">从固定时间开始计时</option></select></label>
                <label class="field">{{ selected.timeMode === 'elapsed' ? '起始时间' : '固定时间' }}<input :type="timeInputType(selected.timeFormat)" :step="timeInputStep(selected.timeFormat)" v-model="selected.defaultValue" :disabled="selected.timeUseServer || selected.timeRunning"></label>
                <label class="switch-row">自动获取服务器时间<input type="checkbox" :checked="selected.timeUseServer" @change="setTimeUseServer($event.target.checked)"><i></i></label>
                <label v-if="selected.timeMode === 'elapsed' || selected.timeUseServer" class="switch-row">开始计时<input type="checkbox" :checked="selected.timeRunning" @change="setTimeRunning($event.target.checked)"><i></i></label>
                <label class="field">当前展示<output>{{ formDataValue(selected) }}</output></label>
              </template>
              <template v-if="!['table','time'].includes(selected.type)"><label class="field">当前输出<output>{{ formDataValue(selected) }}</output></label><label class="switch-row">禁用<input type="checkbox" v-model="selected.disabled"><i></i></label></template>
            </template>
            <template v-if="['工业设备','图表组件'].includes(selectedCategory)">
              <h3>数据属性</h3><label class="field vertical">数据键<input :value="selected.dataKey" placeholder="device.temperature" @input="setSelectedDataKey($event.target.value)"></label><div class="form-grid"><label>最小<input type="number" v-model.number="selected.min"></label><label>最大<input type="number" v-model.number="selected.max"></label></div><label class="field">设备状态<select v-model="selected.status"><option>正常</option><option>告警</option><option>离线</option></select></label>
              <template v-if="selected.type === 'progress'">
                <h3>进度条设置</h3>
                <label class="field">粗细<input type="number" min="2" max="80" step="1" v-model.number="selected.progressThickness"></label>
                <label class="field">长度<input type="range" min="10" max="100" step="1" v-model.number="selected.progressLength"><span>{{ selected.progressLength }}%</span></label>
                <label class="field">左端形状<select v-model="selected.progressStartShape"><option value="square">矩形</option><option value="round">圆形</option></select></label>
                <label class="field">右端形状<select v-model="selected.progressEndShape"><option value="square">矩形</option><option value="round">圆形</option></select></label>
                <label class="switch-row">开启范围波动<input type="checkbox" v-model="selected.progressFluctuationEnabled"><i></i></label>
                <template v-if="selected.progressFluctuationEnabled">
                  <div class="form-grid"><label>波动下限<input type="number" min="0" max="1" step="0.01" v-model.number="selected.progressFluctuationMin"></label><label>波动上限<input type="number" min="0" max="1" step="0.01" v-model.number="selected.progressFluctuationMax"></label></div>
                  <label class="field">波动周期（秒）<input type="number" min="0.2" max="60" step="0.1" v-model.number="selected.progressFluctuationDuration"></label>
                </template>
              </template>
            </template>
            <template v-if="selectedCategory === '网络与云'">
              <h3>网络属性</h3><label class="field vertical">地址<input v-model="selected.address" placeholder="192.168.1.10"></label><label class="field vertical">数据键<input :value="selected.dataKey" placeholder="network.status" @input="setSelectedDataKey($event.target.value)"></label><label class="field">状态<select v-model="selected.status"><option>正常</option><option>告警</option><option>离线</option></select></label>
            </template>
            <template v-if="selectedCategory === '动效组件' && selected.type !== 'flowDirection'">
              <template v-if="selected.type === 'signalLight'"><h3>信号灯属性</h3><label class="field">切换颜色数量<input type="number" min="1" :max="MAX_SIGNAL_COLORS" :value="selected.signalColorCount" @input="setSignalColorCount($event.target.value)"></label><label v-for="index in selected.signalColorCount" :key="index" class="field">颜色 {{ index }}<input type="color" v-model="selected.signalColors[index - 1]"></label><label class="switch-row">完全透明<input type="checkbox" :checked="selected.signalOpacity === 0" @change="selected.signalOpacity = $event.target.checked ? 0 : 1"><i></i></label><label class="field">灯光不透明度<input type="range" min="0" max="1" step="0.05" v-model.number="selected.signalOpacity"><span>{{ Math.round((selected.signalOpacity ?? 1) * 100) }}%</span></label></template>
              <template v-else><h3>主体属性</h3><label class="field">主体颜色<input type="color" v-model="selected.visualPrimaryColor" data-testid="visual-primary-color"></label><label v-if="selected.type === 'waterTank'" class="field">液位（%）<input type="number" min="0" max="100" step="0.1" v-model.number="selected.progressValue" @change="normalizeWaterTankProgress(selected)"></label></template>
              <h3>动效属性</h3><label class="field">动画类型<select v-model="selected.animation" @change="refreshBuiltInAnimation(selected)"><option v-for="option in builtInAnimationOptions(selected)" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label class="field">动画周期（秒）<input type="number" :min="ANIMATION_DURATION_MIN_SECONDS" :max="BUILT_IN_ANIMATION_DURATION_MAX_SECONDS" step="0.1" v-model.number="selected.animationDuration" @input="refreshBuiltInAnimation(selected)" @change="normalizeBuiltInAnimationDuration(selected)"></label><label class="field">播放方向<select v-model="selected.animationDirection" @change="refreshBuiltInAnimation(selected)"><option value="normal">正向</option><option value="reverse">反向</option><option value="alternate">往返</option></select></label><label class="switch-row">暂停动画<input type="checkbox" v-model="selected.animationPaused" @change="refreshBuiltInAnimation(selected)"><i></i></label><label class="switch-row">显示边框<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
            </template>
            <template v-else-if="selectedCategory === '自定义动效'">
              <h3>自定义动效</h3><label class="field">效果<select v-model="selected.customEffect"><option value="bounce">弹跳</option><option value="slide">水平移动</option><option value="rotate">旋转</option><option value="scale">缩放</option><option value="fade">淡入淡出</option><option value="color">颜色变化</option></select></label><label class="field">周期（秒）<input type="number" min="0.2" max="20" step="0.1" v-model.number="selected.animationDuration"></label><label class="field">延迟（秒）<input type="number" min="0" max="20" step="0.1" v-model.number="selected.animationDelay"></label><label class="field">缓动<select v-model="selected.animationEasing"><option value="linear">匀速</option><option value="ease-in-out">平滑</option><option value="ease-out">减速</option><option value="steps(4,end)">步进</option></select></label><label class="field">循环<select v-model="selected.animationIterations"><option value="infinite">无限</option><option value="1">1 次</option><option value="2">2 次</option><option value="3">3 次</option></select></label><label class="field">方向<select v-model="selected.animationDirection"><option value="normal">正向</option><option value="reverse">反向</option><option value="alternate">往返</option></select></label><label v-if="['bounce','slide'].includes(selected.customEffect)" class="field">位移距离<input type="number" min="1" max="200" v-model.number="selected.motionDistance"></label><label v-if="selected.customEffect === 'scale'" class="field">缩放倍数<input type="number" min="0.1" max="3" step="0.05" v-model.number="selected.motionScale"></label><label v-if="selected.customEffect === 'rotate'" class="field">旋转角度<input type="number" min="1" max="1440" v-model.number="selected.motionRotate"></label><label v-if="selected.customEffect === 'color'" class="field">目标颜色<input type="color" v-model="selected.motionColor"></label><label class="switch-row">暂停动画<input type="checkbox" v-model="selected.animationPaused"><i></i></label><label class="switch-row">显示边框<input type="checkbox" v-model="selected.borderVisible"><i></i></label>
            </template>
            </template>
            </fieldset>
          </template>
          <template v-else-if="selectedDrawing">
            <div class="prop-head"><div><b>铅笔线稿</b><small>{{ selectedDrawing.points.length }} 个路径点</small></div><button @click="toggleLock" :title="selectedDrawing.locked ? '解锁' : '锁定'"><Unlock v-if="selectedDrawing.locked" /><Lock v-else /></button><button :disabled="selectedDrawing.locked" @click="duplicate" title="复制"><Copy /></button><button class="danger" :disabled="selectedDrawing.locked" @click="deleteSelected" title="删除"><Trash2 /></button></div>
            <div v-if="selectedDrawing.locked" class="locked-property-state"><Lock /><div><b>线稿已锁定</b><span>属性和画布变换保持只读，请使用上方锁定按钮解锁。</span></div></div>
            <fieldset class="selection-property-editor" :disabled="selectedDrawing.locked" :aria-disabled="selectedDrawing.locked">
            <h3>基础属性</h3><div v-if="selectedDrawingEntry" class="form-grid"><label>X<input type="number" :value="Math.round(selectedDrawingEntry.bounds.x * 100) / 100" @change="setSelectedDrawingMetric('x', $event.target.value)"></label><label>Y<input type="number" :value="Math.round(selectedDrawingEntry.bounds.y * 100) / 100" @change="setSelectedDrawingMetric('y', $event.target.value)"></label><label>宽<input type="number" min="1" :value="Math.round(selectedDrawingEntry.bounds.w * 100) / 100" @change="setSelectedDrawingMetric('w', $event.target.value)"></label><label>高<input type="number" min="1" :value="Math.round(selectedDrawingEntry.bounds.h * 100) / 100" @change="setSelectedDrawingMetric('h', $event.target.value)"></label></div>
            <h3>图层</h3><div class="layer-actions"><button @click="bringFront">置顶</button><button @click="sendBack">置底</button><button @click="moveLayer(1)">上一个图层</button><button @click="moveLayer(-1)">下一个图层</button></div>
            <h3>线条编辑</h3><label class="field">线条颜色<input type="color" v-model="selectedDrawing.color"></label><label class="field">线条宽度<input type="number" min="1" max="40" v-model.number="selectedDrawing.width"></label><label class="field">透明度<input type="range" min="0.1" max="1" step="0.05" v-model.number="selectedDrawing.opacity"><span>{{ Math.round((selectedDrawing.opacity ?? 1) * 100) }}%</span></label><label class="switch-row">虚线<input type="checkbox" v-model="selectedDrawing.dash"><i></i></label><label class="switch-row">平滑曲线<input type="checkbox" v-model="selectedDrawing.smooth"><i></i></label><label class="switch-row">闭合并填充<input type="checkbox" v-model="selectedDrawing.closed"><i></i></label><label class="field">端点<select v-model="selectedDrawing.lineCap"><option value="round">圆形</option><option value="butt">平直</option><option value="square">方形</option></select></label><label class="field">连接<select v-model="selectedDrawing.lineJoin"><option value="round">圆角</option><option value="bevel">斜角</option><option value="miter">尖角</option></select></label>
            <h3>操作</h3><p class="property-note">拖动线条可以移动整个线稿，拖动选框外侧的八个手柄可以自由缩放。线稿与组件共用图层顺序。</p>
            </fieldset>
          </template>
          <template v-else-if="paperSelected">
            <h3>文件</h3>
            <label class="field">文件名<input v-model="fileName"></label>
            <h3>画布尺寸</h3>
            <label class="field">尺寸预设<select :value="canvasSizePreset" @change="setCanvasPreset($event.target.value)"><option value="custom">自定义</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160</option><option value="6000x4000">6000 × 4000</option></select></label>
            <div class="form-grid"><label>宽<input data-testid="canvas-width" type="number" min="320" max="20000" step="10" v-model.number="stageWidth" @change="normalizeCanvasSize"></label><label>高<input data-testid="canvas-height" type="number" min="320" max="20000" step="10" v-model.number="stageHeight" @change="normalizeCanvasSize"></label></div>
            <button class="secondary-wide" data-testid="use-screen-size" @click="useCurrentScreenSize"><Scaling />使用当前屏幕尺寸</button>
            <label class="field hint-field">当前尺寸<span>{{ stageWidth }} × {{ stageHeight }} px</span></label>
            <h3>画布样式</h3>
            <label class="field">背景颜色<input type="color" v-model="canvasBg"></label>
            <label class="field">边框颜色<input type="color" v-model="canvasBorderColor"></label>
            <label class="field">边框宽度<input type="number" min="0" max="10" v-model.number="canvasBorderWidth" @change="normalizeCanvasStyle"></label>
            <label class="switch-row">背景网格<input type="checkbox" v-model="showGrid"><i></i></label>
            <template v-if="showGrid"><label class="field">网格样式<select v-model="gridStyle"><option value="line">线条</option><option value="dot">点阵</option></select></label><label class="field">网格颜色<input type="color" v-model="gridColor"></label><label class="field">网格尺寸<input type="number" min="5" max="100" v-model.number="gridSize" @change="normalizeCanvasStyle"></label></template>
            <label class="switch-row">网格自动对齐<input type="checkbox" v-model="snap"><i></i></label>
            <label class="field hint-field">摆放精度<span>{{ snap ? `吸附 ${gridSize}px（按 Alt 临时取消）` : '自由摆放' }}</span></label>
            <h3>连线设置</h3>
            <label class="field">连线颜色<input type="color" v-model="lineColor" @change="applyLineSettingsToEdges"></label>
            <label class="field">连线宽度<input type="number" min="0.1" max="10" step="0.1" v-model.number="lineWidth" @change="applyLineSettingsToEdges"></label>
            <label class="switch-row">虚线<input type="checkbox" v-model="lineDash" @change="applyLineSettingsToEdges"><i></i></label>
            <label class="field">起点端口<select v-model="lineStartMarker" @change="applyLineSettingsToEdges"><option value="none">无端口</option><option value="arrow">箭头</option><option value="circle">圆点</option><option value="square">方块</option></select></label>
            <label class="field">终点端口<select v-model="lineEndMarker" @change="applyLineSettingsToEdges"><option value="none">无端口</option><option value="arrow">箭头</option><option value="circle">圆点</option><option value="square">方块</option></select></label>
            <label class="field">连接点<select v-model="lineAnchorMode" @change="applyLineSettingsToEdges"><option value="edge">组件边缘</option><option value="center">组件中心</option></select></label>
            <p class="property-note">以上设置同时应用到当前图纸的已有连线和后续新连线。</p>
          </template>
          <div v-else class="property-empty-state"><FileJson /><b>未选择对象</b></div>
        </div>
        <CommunicationBindingPanel
          v-if="rightTab === '通信'"
          class="properties communication-properties"
          :node="selectedNodeCount === 1 ? selected : null"
          :parameters="selectedBindingParameters"
          :gateway="pointCatalogGateway"
          :source-revision="dataSourceRevision"
          :locked="selectedNodesContainLocked"
          @bind="bindSelectedParameter"
          @unbind="unbindSelectedParameter"
        />
        <div class="properties" v-if="rightTab === '布局'"><h3>画布布局</h3><div class="layout-actions"><button @click="align('h')"><AlignCenterHorizontal />水平居中</button><button @click="align('v')"><AlignCenterVertical />垂直居中</button><button @click="bringFront"><BringToFront />置于顶层</button><button @click="fitView"><ZoomIn />适应画布</button></div></div>
        <div class="properties structure-list" v-if="rightTab === '结构'">
          <h3>图层结构（{{ layerEntries.length }}）</h3>
          <div ref="structureScroller" class="structure-scroll" data-testid="structure-scroll" @scroll.passive="updateStructureViewport">
            <div class="structure-virtual-content" :style="structureContentStyle">
              <button v-for="row in structureVirtualRows" :key="`${row.item.kind}:${row.item.id}`" class="structure-row" :style="{ transform: `translateY(${row.index * STRUCTURE_ROW_HEIGHT}px)` }" :class="{ on: row.item.kind === 'node' ? isNodeSelected(row.item.id) : row.item.id === selectedDrawingId }" @click="selectLayerEntry(row.item)"><Pencil v-if="row.item.kind === 'drawing' || row.item.entity.type === 'pencil'" /><component v-else :is="shapeDefaults[row.item.entity.type] ? Box : Square" /><span>{{ row.item.kind === 'drawing' ? '铅笔线稿' : structureNodeDisplayName(row.item.entity) }}</span><small>{{ row.item.layer }}</small><Lock v-if="row.item.entity.locked" /></button>
            </div>
          </div>
        </div>
      </template>
    </aside>
  </main>

  <DataSourceManager
    v-if="dataSourceManagerOpen"
    :key="currentPointSourceScopeId"
    :gateway="pointCatalogGateway"
    :drawing-name="fileName"
    @changed="handleDataSourceChanged"
    @close="closeDataSourceManager"
  />

  <div v-if="contextMenu.show" ref="contextMenuElement" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop @contextmenu.prevent>
    <template v-if="selected">
      <button :disabled="selectedNodesContainLocked" @click="runContextAction(bringFront)"><span>置顶</span></button>
      <button :disabled="selectedNodesContainLocked" @click="runContextAction(sendBack)"><span>置底</span></button>
      <button :disabled="selectedNodesContainLocked" @click="runContextAction(() => moveLayer(1))"><span>上一个图层</span></button>
      <button :disabled="selectedNodesContainLocked" @click="runContextAction(() => moveLayer(-1))"><span>下一个图层</span></button>
      <i></i>
      <button @click="runContextAction(toggleLock)"><span>{{ selectedNodes.every(node => node.locked) ? '解锁' : '锁定' }}</span></button>
      <i></i>
      <button :disabled="!canGroupSelection || selectedNodesContainLocked" @click="runContextAction(groupSelectedNodes)"><span class="context-action-label"><Group />{{ canGroupSelection ? '组合为组件' : '组合为组件（需多选）' }}</span><kbd>Ctrl+G</kbd></button>
      <button v-if="selectedGroups.size" :disabled="selectedNodesContainLocked" @click="runContextAction(ungroupSelectedNodes)"><span class="context-action-label"><Ungroup />取消组合</span><kbd>Ctrl+Shift+G</kbd></button>
      <button :disabled="selectedNodesContainLocked" @click="runContextAction(addSelectionToMyLibrary)"><span class="context-action-label"><PackagePlus />添加为我的</span></button>
      <i></i>
      <button class="danger" :disabled="selectedNodesContainLocked" @click="runContextAction(deleteSelected)"><span>{{ selectedNodeCount > 1 ? '删除选中组件' : '删除' }}</span><kbd>Delete</kbd></button>
      <i></i>
    </template>
    <template v-else-if="selectedDrawing">
      <button :disabled="selectedDrawing.locked" @click="runContextAction(bringFront)"><span>置顶</span></button>
      <button :disabled="selectedDrawing.locked" @click="runContextAction(sendBack)"><span>置底</span></button>
      <button :disabled="selectedDrawing.locked" @click="runContextAction(() => moveLayer(1))"><span>上一个图层</span></button>
      <button :disabled="selectedDrawing.locked" @click="runContextAction(() => moveLayer(-1))"><span>下一个图层</span></button>
      <i></i>
      <button @click="runContextAction(toggleLock)"><span>{{ selectedDrawing.locked ? '解锁线稿' : '锁定线稿' }}</span></button>
      <button class="danger" :disabled="selectedDrawing.locked" @click="runContextAction(deleteSelected)"><span>删除线稿</span><kbd>Delete</kbd></button>
      <i></i>
    </template>
    <button :disabled="!history.length" @click="runContextAction(undo)"><span>撤销</span><kbd>Ctrl + Z</kbd></button>
    <button :disabled="!future.length" @click="runContextAction(redo)"><span>重做</span><kbd>Ctrl + Y</kbd></button>
    <i></i>
    <button v-if="selectedEntity" :disabled="selectedEntitiesContainLocked" @click="runContextAction(cutSelected)"><span>剪切</span><kbd>Ctrl + X</kbd></button>
    <button v-if="selectedEntity" :disabled="selectedEntitiesContainLocked" @click="runContextAction(copySelected)"><span>复制</span><kbd>Ctrl + C</kbd></button>
    <button :disabled="!clipboardItem" @click="runContextAction(pasteNode)"><span>粘贴</span><kbd>Ctrl + V</kbd></button>
  </div>

  <div v-if="customComponentDialog.show && customComponentDialog.bundle" class="custom-component-dialog-backdrop" @pointerdown.self="closeCustomComponentDialog">
    <section class="custom-component-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-component-dialog-title" data-testid="custom-component-dialog" @pointerdown.stop>
      <header>
        <div><b id="custom-component-dialog-title">添加为我的组件</b><span>{{ customComponentDialog.bundle.nodes.length > 1 ? `${customComponentDialog.bundle.nodes.length} 个组件` : '单个组件' }}</span></div>
        <button type="button" @click="closeCustomComponentDialog" title="关闭"><X /></button>
      </header>
      <div class="custom-component-dialog-body">
        <div class="custom-component-dialog-preview">
          <MiniMapPreview :nodes="customComponentDialog.bundle.nodes" :edges="customComponentDialog.bundle.edges" :stage-width="customComponentDialog.bundle.width" :stage-height="customComponentDialog.bundle.height" :width="180" :height="100" background="#ffffff" fit-mode="contain" prefer-text aria-label="待添加组件缩略图" />
        </div>
        <label>组件名称<input ref="customComponentNameInput" v-model="customComponentDialog.name" maxlength="56" data-testid="custom-component-name" lang="zh-CN" inputmode="text" @compositionstart="customComponentNameComposing = true" @compositionend="customComponentNameComposing = false" @blur="customComponentNameComposing = false" @keydown="handleCustomComponentNameKeydown"></label>
        <div class="custom-component-dialog-meta"><span>{{ Math.round(customComponentDialog.bundle.width) }} × {{ Math.round(customComponentDialog.bundle.height) }} px</span><span>{{ customComponentDialog.bundle.edges.length }} 条内部连线</span></div>
      </div>
      <footer><button type="button" class="secondary" @click="closeCustomComponentDialog">取消</button><button type="button" class="primary" :disabled="!customComponentDialog.name.trim()" data-testid="confirm-custom-component" @click="confirmCustomComponent">添加</button></footer>
    </section>
  </div>

  <div v-if="showPreview" ref="previewOverlay" class="preview-overlay" :class="{ 'is-fullscreen': previewFullscreen, 'is-preparing': !previewPresentationReady }" :aria-busy="!previewPresentationReady" data-testid="preview-overlay">
    <div class="preview-viewport-clip" data-testid="preview-viewport-clip"><div ref="previewCanvas" class="preview-canvas" :class="{ 'preview-fit': previewFittedVisible }" data-testid="preview-canvas" @scroll.passive="updatePreviewViewport"><div class="preview-stage-space" :style="{ width: stageWidth * previewRenderScale + 'px', height: stageHeight * previewRenderScale + 'px', marginLeft: previewFittedVisible ? previewFitPresentationOffset.left + 'px' : '0px', marginTop: previewFittedVisible ? previewFitPresentationOffset.top + 'px' : '0px', backgroundColor: canvasBg, boxShadow: previewFitVisible ? `inset 0 0 0 ${canvasBorderWidth * previewRenderScale}px ${canvasBorderColor}, 0 4px 18px #26323d26` : undefined }">
      <MiniMapPreview v-if="previewFitMounted" ref="previewFitCanvas" class="preview-fit-canvas" :class="{ 'is-visible': previewCanvasVisible }" :active="previewCanvasRenderActive" :nodes="nodes" :edges="edges" :drawings="drawings" :node-index="nodeIndex" :ordered-entities="layerEntries" :excluded-node-ids="previewFitExcludedNodeIds" :excluded-drawing-ids="previewFitExcludedDrawingIds" :render-plan-key="previewFitPlan.key" :frame-commit-token="previewFitFrameCommitToken" :frame-commit-guard="canCommitPreviewFitFrame" :spatial-index="nodeSpatialIndex" :drawing-spatial-index="drawingSpatialIndex" :runtime-store="runtimeData" :time-context="timeRenderContext" :stage-width="stageWidth" :stage-height="stageHeight" :width="previewFitCanvasWidth" :height="previewFitCanvasHeight" :background="canvasBg" :max-bitmap-pixels="previewFitBitmapPixelBudget" :pixel-ratio="previewFitPixelRatio" :render-budget-ms="previewFitRenderBudgetMs" :respect-reduced-motion="false" fit-mode="stretch" :render-mode="previewFitRenderMode" wait-for-images incremental-runtime atomic-css-size faithful test-id="preview-fit-canvas" aria-label="图纸自适应预览" @render-complete="handlePreviewFitRenderComplete" @render-rejected="handlePreviewFitRenderRejected" @render-error="handlePreviewFitRenderError" />
      <MiniMapPreview v-if="previewEdgeCanvasBounds" ref="previewEdgeCanvas" class="preview-edge-canvas" :class="{ 'is-visible': previewEdgeCanvasVisible }" :active="previewDomEdgeCanvasActive" :style="previewEdgeCanvasFrameStyle" :nodes="previewEdgeCanvasNodes" :edges="previewEdgeCanvasEdges" :drawings="previewEdgeCanvasDrawings" :node-index="nodeIndex" :edge-spatial-index="edgeSpatialIndex" :drawing-spatial-index="drawingSpatialIndex" :spatial-index="nodeSpatialIndex" :ordered-entities="previewEdgeCanvasEntities" :excluded-node-ids="previewFitExcludedNodeIds" :excluded-drawing-ids="previewFitExcludedDrawingIds" :render-revision="projectRevision" :stage-width="stageWidth" :stage-height="stageHeight" :view-box="previewEdgeCanvasBounds" :render-plan-key="previewEdgeCanvasPlanKey" :frame-commit-guard="canCommitPreviewEdgeCanvasFrame" :width="Math.max(1, previewEdgeCanvasBounds.w)" :height="Math.max(1, previewEdgeCanvasBounds.h)" :runtime-store="runtimeData" :time-context="timeRenderContext" :background="canvasBg" :max-bitmap-pixels="previewEdgeCanvasBitmapBudget" :pixel-ratio="previewEdgeCanvasPixelRatio" :render-budget-ms="4" :respect-reduced-motion="false" fit-mode="stretch" render-mode="task" wait-for-images incremental-runtime atomic-css-size faithful test-id="preview-edge-canvas" aria-label="高清视口预览层" @render-complete="handlePreviewEdgeCanvasRenderComplete" @render-rejected="handlePreviewEdgeCanvasRenderRejected" @render-error="handlePreviewEdgeCanvasRenderError" />
      <div v-if="previewDomMounted" ref="previewDomStage" class="preview-stage" :class="{ 'is-hidden': !previewDomVisible }" data-testid="preview-dom-stage" :data-preview-ready="previewDomReady" :aria-hidden="!previewDomVisible" :inert="!previewDomVisible" :style="{ width: stageWidth + 'px', height: stageHeight + 'px', backgroundColor: previewDomEdgeCanvasActive ? 'transparent' : canvasBg, boxShadow: `inset 0 0 0 ${canvasBorderWidth}px ${canvasBorderColor}`, transform: `scale(${previewRenderScale})` }">
      <ProgressivePreviewGeometry
        :edges="previewDomEdges"
        :drawings="previewDomDrawings"
        :node-index="nodeIndex"
        :drawing-entry-factory="drawingRenderEntry"
        :generation="previewDomGeneration"
        :stage-width="stageWidth"
        :stage-height="stageHeight"
        progressive
        @render-start="handlePreviewGeometryRenderStart"
        @render-complete="handlePreviewGeometryRenderComplete"
      />
      <ProgressivePreviewNodes :nodes="previewDomNodes" :generation="previewDomGeneration" progressive :batch-size="8" :mount-cost-budget="64" :runtime-store="runtimeData" :time-context="timeRenderContext" @render-start="handlePreviewDomRenderStart" @render-complete="handlePreviewDomRenderComplete" @form-change="handleFormChange" @table-cell-view="openTableCellViewer" />
      </div>
      <div v-if="previewLivePlaneActive" ref="previewLivePlaneStage" class="preview-stage is-live-plane" data-testid="preview-live-plane" :data-preview-ready="previewLivePlaneReady" :style="{ width: stageWidth + 'px', height: stageHeight + 'px', transform: `scale(${previewRenderScale})` }">
        <svg v-for="entry in previewLivePlaneDrawingEntries" :key="entry.drawing.id" class="drawing-layer preview-drawing" :style="{ left: entry.frame.x + 'px', top: entry.frame.y + 'px', width: entry.frame.w + 'px', height: entry.frame.h + 'px', zIndex: drawingLayerIndex.get(entry.drawing.id) }" :viewBox="`${entry.frame.x} ${entry.frame.y} ${entry.frame.w} ${entry.frame.h}`" preserveAspectRatio="none"><path :d="entry.path" :fill="entry.drawing.closed ? `${entry.drawing.color}22` : 'none'" :stroke="entry.drawing.color" :stroke-width="entry.drawing.width" :stroke-dasharray="entry.drawing.dash ? '8 6' : ''" :stroke-linecap="entry.drawing.lineCap || 'round'" :stroke-linejoin="entry.drawing.lineJoin || 'round'" :opacity="entry.drawing.opacity ?? 1" /></svg>
        <ProgressivePreviewNodes :nodes="previewLivePlaneNodes" :generation="previewLivePlaneGeneration" progressive :batch-size="PREVIEW_HYBRID_MAX_DOM_NODES" :mount-cost-budget="PREVIEW_HYBRID_MAX_DOM_COST" :runtime-store="runtimeData" :time-context="timeRenderContext" @render-start="handlePreviewLivePlaneRenderStart" @render-complete="handlePreviewLivePlaneRenderComplete" @form-change="handleFormChange" @table-cell-view="openTableCellViewer" />
      </div>
    </div></div></div>
  </div>
  <header v-if="showPreview && !previewFullscreen" class="preview-header" data-testid="preview-header"><b>{{ fileName }}</b><span>预览模式 · {{ stageWidth }} × {{ stageHeight }}</span><div class="preview-actions"><button :disabled="previewModeTransitionPending" :class="{ active: previewAutoFit }" :aria-pressed="previewAutoFit" :aria-label="previewAutoFit ? '恢复原始尺寸预览' : '自适应预览'" @click="togglePreviewAutoFit"><Scaling /><span>{{ previewAutoFit ? '原始尺寸' : '自适应预览' }}</span></button><button :disabled="previewModeTransitionPending" aria-label="全屏预览" @click="togglePreviewFullscreen"><Maximize2 /><span>全屏预览</span></button><button class="preview-close" :disabled="previewFullscreenPending" aria-label="关闭预览" @click="closePreview"><X /></button></div></header>

  <Teleport v-if="buttonMessageDialog.show" :to="showPreview && previewCanvas ? previewCanvas : 'body'">
    <div class="button-message-backdrop" @pointerdown.self="closeButtonMessage">
      <section class="button-message-dialog" role="dialog" aria-modal="true" aria-labelledby="button-message-dialog-title" @pointerdown.stop>
        <header><div><b id="button-message-dialog-title">{{ buttonMessageDialog.title }}</b><span>操作确认</span></div><button @click="closeButtonMessage" title="关闭"><X /></button></header>
        <p>{{ buttonMessageDialog.message }}</p>
        <footer><button @click="closeButtonMessage">确定</button></footer>
      </section>
    </div>
  </Teleport>

  <div v-if="drawingBrowserOpen" class="drawing-browser-backdrop" @pointerdown.self="drawingBrowserOpen = false">
    <section class="drawing-browser" role="dialog" aria-modal="true" aria-labelledby="drawing-browser-title" @pointerdown.stop>
      <header>
        <div><b id="drawing-browser-title">打开图纸</b><span :title="drawingDirectoryPath">{{ drawingDirectoryPath || '项目图纸库' }}</span></div>
        <button @click="drawingBrowserOpen = false" title="关闭"><X /></button>
      </header>
      <div class="drawing-browser-toolbar">
        <span>{{ drawingFiles.length }} 个图纸文件</span>
        <button :disabled="drawingFilesLoading" @click="refreshDrawingFiles" title="刷新图纸库"><RefreshCw :class="{ spinning: drawingFilesLoading }" /></button>
      </div>
      <div class="drawing-file-list">
        <div v-if="drawingFilesLoading" class="drawing-browser-state"><RefreshCw class="spinning" /><span>正在读取图纸库</span></div>
        <div v-else-if="drawingFilesError" class="drawing-browser-state error"><FileJson /><b>无法读取图纸库</b><span>{{ drawingFilesError }}</span><button @click="refreshDrawingFiles">重新加载</button></div>
        <div v-else v-for="entry in drawingFiles" :key="entry.name" class="drawing-file-row">
          <button class="drawing-file-open" :disabled="fileOperationPending" @click="openProjectDrawing(entry)" :title="`打开“${drawingTitleFromFile(entry.name)}”`">
            <FileJson />
            <span><b>{{ drawingTitleFromFile(entry.name) }}</b><small>{{ entry.name }}</small></span>
            <small>{{ formatDrawingSize(entry.size) }}</small>
            <time>{{ formatDrawingDate(entry.modifiedAt) }}</time>
            <ChevronRight />
          </button>
          <button class="drawing-file-delete" data-testid="drawing-file-delete" :disabled="fileOperationPending" @click.stop="deleteProjectDrawing(entry)" :title="`删除“${drawingTitleFromFile(entry.name)}”`" :aria-label="`从图纸库删除“${drawingTitleFromFile(entry.name)}”`"><Trash2 /></button>
        </div>
        <div v-if="!drawingFilesLoading && !drawingFilesError && !drawingFiles.length" class="drawing-browser-state"><FileJson /><b>图纸库为空</b><span>新建图纸后点击“保存”即可写入此目录</span></div>
      </div>
      <footer>
        <button class="secondary" :disabled="fileOperationPending" @click="openOtherDrawing"><FolderOpen />打开其他位置</button>
        <button class="secondary" @click="drawingBrowserOpen = false">取消</button>
      </footer>
    </section>
  </div>

  <div v-if="tableDataEditor.show && activeTableDataNode && !activeTableDataNode.locked" class="table-data-backdrop" @pointerdown.self="closeTableDataEditor">
    <section class="table-data-dialog" role="dialog" aria-modal="true" aria-labelledby="table-data-title" @pointerdown.stop @focusin.capture="beginTableFieldEdit" @focusout.capture="finishActiveFieldEdit" @input.capture="markDocumentInput" @change.capture="markDocumentInput">
      <header>
        <div><b id="table-data-title">编辑表格</b><span>{{ activeTableDataNode.tableRows }} 行 × {{ activeTableDataNode.tableColumns }} 列</span></div>
        <button @click="closeTableDataEditor" title="关闭"><X /></button>
      </header>
      <nav class="table-data-tabs">
        <button :class="{ active: tableDataEditor.tab === 'data' }" @click="setTableDataEditorTab('data')"><TableProperties />数据</button>
        <button :class="{ active: tableDataEditor.tab === 'style' }" @click="setTableDataEditorTab('style')"><Scaling />样式</button>
      </nav>
      <template v-if="tableDataEditor.tab === 'data'">
        <div class="table-data-primary">
          <label><span>表格标题</span><input v-model="activeTableDataNode.tableTitle" placeholder="请输入表格标题"></label>
          <label class="table-data-toggle"><input type="checkbox" v-model="activeTableDataNode.showTableTitle"><i></i><span>显示标题</span></label>
          <label class="table-data-toggle"><input type="checkbox" v-model="activeTableDataNode.showHeader"><i></i><span>显示表头</span></label>
        </div>
        <div class="table-data-toolbar">
          <div v-if="tableDataEditor.mode === 'edit'" class="table-data-structure-actions"><button :disabled="activeTableDataNode.tableCells.length >= 50" @click="addTableRow"><Plus />添加行</button><button :disabled="activeTableDataNode.tableHeaders.length >= 12" @click="addTableColumn"><Plus />添加列</button></div>
          <div class="table-data-mode-switch"><button :class="{ active: tableDataEditor.mode === 'edit' }" @click="setTableDataEditorMode('edit')"><Pencil />编辑数据</button><button :class="{ active: tableDataEditor.mode === 'merge' }" @click="setTableDataEditorMode('merge')"><TableCellsMerge />拖选合并</button></div>
          <div v-if="tableDataEditor.mode === 'merge'" class="table-data-merge-actions"><output v-if="activeTableSelection">{{ activeTableSelection.rowSpan }} × {{ activeTableSelection.columnSpan }}</output><button :disabled="!activeTableSelection || activeTableSelection.cellCount < 2" @click="mergeSelectedTableCells"><TableCellsMerge />合并选区</button><button :disabled="!selectedTableMerges.length" @click="splitSelectedTableCells"><TableCellsSplit />拆分选区</button></div>
        </div>
        <div class="table-data-grid-wrap">
          <div class="table-data-grid" :class="{ 'merge-mode': tableDataEditor.mode === 'merge' }" :style="{ gridTemplateColumns: tableDataGridColumns(activeTableDataNode) }" @pointermove="extendTableDataSelectionFromPointer">
            <b class="table-data-corner" :style="{ gridRow: 1, gridColumn: 1 }">#</b>
            <div v-for="(header, columnIndex) in activeTableDataNode.tableHeaders" :key="`data-header-${columnIndex}`" class="table-data-header" :class="{ selected: activeTableSelection?.column === columnIndex && activeTableSelection?.columnEnd === columnIndex && activeTableSelection?.row === 0 && activeTableSelection?.rowEnd === activeTableDataNode.tableRows - 1 }" :style="{ gridRow: 1, gridColumn: columnIndex + 2 }">
              <template v-if="tableDataEditor.mode === 'edit'">
                <div class="table-data-axis-heading"><b>第 {{ columnIndex + 1 }} 列</b><button type="button" :disabled="activeTableDataNode.tableHeaders.length <= 1" @click="deleteTableColumn(columnIndex)" title="删除此列"><Trash2 /></button></div>
                <input v-model="activeTableDataNode.tableHeaders[columnIndex]" :aria-label="`第 ${columnIndex + 1} 列名称`" placeholder="表头内容">
                <label class="table-data-size-field"><span>宽</span><input type="number" min="40" max="2000" step="1" v-model.number="activeTableDataNode.tableColumnWidthsPx[columnIndex]" @change="setTableColumnWidth(columnIndex, $event.target.value)"><i>px</i></label>
              </template>
              <button v-else type="button" class="table-data-axis-select" @click="selectTableDataColumn(columnIndex)"><b>第 {{ columnIndex + 1 }} 列</b><span>{{ header || `列 ${columnIndex + 1}` }}</span></button>
            </div>
            <template v-for="(row, rowIndex) in activeTableDataNode.tableCells" :key="`data-row-${rowIndex}`">
              <div class="table-data-row-number" :class="{ selected: activeTableSelection?.row === rowIndex && activeTableSelection?.rowEnd === rowIndex && activeTableSelection?.column === 0 && activeTableSelection?.columnEnd === activeTableDataNode.tableColumns - 1 }" :style="{ gridRow: rowIndex + 2, gridColumn: 1 }">
                <template v-if="tableDataEditor.mode === 'edit'"><div class="table-data-axis-heading"><b>第 {{ rowIndex + 1 }} 行</b><button type="button" :disabled="activeTableDataNode.tableCells.length <= 1" @click="deleteTableRow(rowIndex)" title="删除此行"><Trash2 /></button></div><label><input type="number" min="18" max="120" step="1" v-model.number="activeTableDataNode.tableRowHeights[rowIndex]" @change="setTableRowHeight(rowIndex, $event.target.value)"><span>px</span></label></template>
                <button v-else type="button" class="table-data-axis-select" @click="selectTableDataRow(rowIndex)"><b>第 {{ rowIndex + 1 }} 行</b><span>{{ activeTableDataNode.tableRowHeights[rowIndex] }}px</span></button>
              </div>
              <div
                v-for="(cell, columnIndex) in row"
                v-show="!tableDataCellCovered(rowIndex, columnIndex)"
                :key="`data-cell-${rowIndex}-${columnIndex}`"
                class="table-data-cell"
                :class="{ selected: tableDataCellSelected(rowIndex, columnIndex), merged: tableDataMergeAt(rowIndex, columnIndex) }"
                :style="tableDataEditorCellStyle(rowIndex, columnIndex)"
                data-table-cell
                :data-table-row="rowIndex"
                :data-table-column="columnIndex"
                :role="tableDataEditor.mode === 'merge' ? 'button' : undefined"
                :tabindex="tableDataEditor.mode === 'merge' ? 0 : undefined"
                @pointerdown="startTableDataSelectionDrag($event, rowIndex, columnIndex)"
                @pointerenter="extendTableDataSelectionDrag(rowIndex, columnIndex)"
                @keydown.enter.self.prevent="selectTableDataCell(rowIndex, columnIndex)"
                @keydown.space.self.prevent="selectTableDataCell(rowIndex, columnIndex)"
              >
                <input v-if="tableDataEditor.mode === 'edit'" v-model="activeTableDataNode.tableCells[rowIndex][columnIndex]" :aria-label="`第 ${rowIndex + 1} 行，${activeTableDataNode.tableHeaders[columnIndex] || `第 ${columnIndex + 1} 列`}`">
                <span v-else class="table-data-cell-value">{{ cell || '空' }}</span>
                <small v-if="tableDataMergeAt(rowIndex, columnIndex)" class="table-data-merge-label">{{ tableDataMergeLabel(rowIndex, columnIndex) }}</small>
              </div>
            </template>
          </div>
        </div>
      </template>
      <div v-else class="table-style-editor">
        <section><h3>尺寸</h3><div class="table-style-editor-fields"><label><span>宽度</span><span class="table-data-number"><input type="number" min="1" :max="MAX_EDITOR_STAGE_SIZE" step="1" v-model.number="activeTableDataNode.w" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"><i>px</i></span></label><label><span>高度</span><span class="table-data-number"><input type="number" min="1" :max="MAX_EDITOR_STAGE_SIZE" step="1" v-model.number="activeTableDataNode.h" @change="normalizeSelectedNodeGeometry()" @blur="normalizeSelectedNodeGeometry()"><i>px</i></span></label></div></section>
        <section><h3>颜色</h3><div class="table-style-editor-fields"><label><span>标题背景</span><input type="color" v-model="activeTableDataNode.tableTitleFill"></label><label><span>表头背景</span><input type="color" v-model="activeTableDataNode.tableHeaderFill"></label><label><span>内容背景</span><input type="color" v-model="activeTableDataNode.tableRowFill"></label><label><span>内容文字</span><input type="color" v-model="activeTableDataNode.tableCellColor"></label></div></section>
        <section><h3>边框</h3><div class="table-style-editor-fields"><label><span>外框颜色</span><input type="color" v-model="activeTableDataNode.tableBorderColor"></label><label><span>外框粗细</span><span class="table-data-number"><input type="number" min="0" max="20" step="0.1" v-model.number="activeTableDataNode.tableBorderWidth"><i>px</i></span></label><label><span>外框样式</span><select v-model="activeTableDataNode.tableBorderStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label><label><span>内框颜色</span><input type="color" v-model="activeTableDataNode.tableGridColor"></label><label><span>内框粗细</span><span class="table-data-number"><input type="number" min="0" max="10" step="0.1" v-model.number="activeTableDataNode.tableGridWidth"><i>px</i></span></label><label><span>内框样式</span><select v-model="activeTableDataNode.tableGridStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label></div></section>
      </div>
      <footer><span v-if="tableDataEditor.tab === 'data' && tableDataEditor.mode === 'merge' && activeTableSelection">选区 {{ activeTableSelection.rowSpan }} × {{ activeTableSelection.columnSpan }}</span><span v-else-if="tableDataEditor.tab === 'data' && tableDataEditor.mode === 'merge'">拖选合并模式</span><span v-else>{{ activeTableDataNode.tableRows }} 行 × {{ activeTableDataNode.tableColumns }} 列</span><button @click="closeTableDataEditor">完成</button></footer>
    </section>
  </div>

  <Teleport v-if="tableCellViewer.show && activeTableCellDetail" :to="showPreview && previewCanvas ? previewCanvas : 'body'">
    <div class="table-cell-viewer-backdrop" @pointerdown.self="closeTableCellViewer">
      <section class="table-cell-viewer" role="dialog" aria-modal="true" aria-labelledby="table-cell-viewer-title" @pointerdown.stop>
        <header><div><b id="table-cell-viewer-title">{{ activeTableCellDetail.title }}</b><span>{{ activeTableCellDetail.position }}</span></div><button @click="closeTableCellViewer" title="关闭"><X /></button></header>
        <p>{{ activeTableCellDetail.text }}</p>
        <footer><button @click="closeTableCellViewer">关闭</button></footer>
      </section>
    </div>
  </Teleport>

  <input ref="importInput" type="file" accept=".json" hidden @change="importJson">
  <input ref="nodeImageInput" type="file" accept="image/*" hidden @change="uploadNodeImage">
  <input ref="nodeVideoInput" type="file" accept="video/*" hidden @change="uploadNodeVideo">
  <transition name="toast"><div v-if="toast" class="toast">{{ toast }}</div></transition>
</div>
<div v-if="workspaceSwitchPending" class="geometry-commit-shield workspace-switch-shield" role="status" aria-label="正在加载工作空间"></div>
</template>
