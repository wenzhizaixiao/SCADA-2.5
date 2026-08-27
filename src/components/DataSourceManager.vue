<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  AlertCircle,
  ArrowLeft,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Globe2,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  SlidersHorizontal,
  Trash2,
  Wifi,
  X
} from 'lucide-vue-next'
import {
  POINT_SOURCE_CONFIG_FIELDS,
  POINT_SOURCE_PROTOCOLS
} from '../services/pointCatalogGateway'
import {
  createSourceConnectionListModel,
  isInterfaceDemoSource,
  sourceEffectiveStatus as effectiveSourceStatus,
  sourceListDisplayName,
  sourceProtocolGroupId,
  sourceProtocolShortName as protocolShortName,
  sourceStatusLabel as statusLabel
} from '../utils/sourceConnectionList'
import { formatRuntimeValue } from '../utils/runtimeValueFormat'
import { createJsonResponsePointPreview } from '../utils/jsonResponsePointPreview'
import { isUsableSourceSnapshot } from '../utils/sourceSnapshotValidation'

const props = defineProps({
  gateway: { type: Object, required: true },
  initialSourceId: { type: String, default: '' },
  // 数据源按图纸隔离，页面始终展示当前图纸，避免误以为连接由整个工作空间共享。
  drawingName: { type: String, default: '未命名图纸' }
})

const emit = defineEmits(['close', 'changed'])

const sources = ref([])
const selectedSource = shallowRef(null)
const selectedSourceId = ref('')
const sourceDraft = ref({ name: '', enabled: true, config: {} })
const sourceDraftBaseline = ref('')
const sourceQueryInput = ref('')
const sourceQuery = ref('')
const sourceStatusFilter = ref('all')
const sourceProtocolFilter = ref('all')
const loading = ref(true)
const selectingSourceId = ref('')
const saving = ref(false)
const testing = ref(false)
const deleting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const protocolPickerOpen = ref(false)
const createDraft = ref(createSourceDraft())
const createError = ref('')
const createTestResult = ref(null)
const createTestContext = ref('')
const createResponseText = ref('')
const createResponseSnapshot = shallowRef(null)
const createAdvancedOpen = ref(false)
const sourceAdvancedOpen = ref(false)
const sourceTestResult = ref(null)
const sourceTestContext = ref('')
const sourceResponseText = ref('')
const selectedSourceSnapshot = shallowRef(null)
// 采集响应摘要与连接目录分离，快照刷新不会使大型目录重新分组、检索和排序。
const liveResponseBySource = shallowRef(new Map())
// 数据源管理默认先展示当前图纸的连接状态，只有用户明确选择连接后才加载详情。
const managerView = ref(props.initialSourceId ? 'detail' : 'overview')
const overviewPage = ref(0)
// 创建入口按常用程度排列；该顺序只影响类型选择，不改变数据源目录的协议分组。
const CREATE_PROTOCOL_ORDER = Object.freeze([
  'HTTP',
  'WebSocket',
  'Socket',
  'MQTT',
  'Redis',
  'MySQL',
  'SQL Server'
])
const protocolChoice = ref(CREATE_PROTOCOL_ORDER[0])
const collapsedSourceGroups = ref(new Set(
  POINT_SOURCE_PROTOCOLS
    .filter(protocol => protocol !== 'MQTT')
    .map(sourceProtocolGroupId)
))
const sourceGroupPages = ref(new Map())
const createDraftBaseline = ref('')
const managerShellElement = ref(null)
const managerCloseButton = ref(null)
const sourceOverviewEntry = ref(null)
const detailBackButton = ref(null)
const createNameInput = ref(null)
const protocolPickerElement = ref(null)
const sourceListElement = ref(null)
let selectionGeneration = 0
let sourcePreviewGeneration = 0
let previouslyFocusedElement = null
let protocolPickerTrigger = null
let unsubscribeSourceCatalog = null
let unsubscribeSourceSnapshots = null
let liveRefreshTimer = null
let liveRefreshRunning = false
let liveRefreshQueued = false
let liveCatalogDirty = false
let gatewayEventsActive = false
const pendingSnapshotBySource = new Map()
// 启停采用乐观状态：界面立即响应，IndexedDB 保存结果在后台按请求顺序确认。
const sourceToggleJobs = new Map()
const sourceToggleRevisions = new Map()
let sourceManagerActive = true

const SOURCE_STATUS_FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'online', label: '在线' },
  { id: 'issues', label: '异常' },
  { id: 'disabled', label: '停用' }
])

const PROTOCOL_LABELS = Object.freeze({
  MQTT: 'MQTT',
  HTTP: 'HTTP API',
  MySQL: 'MySQL',
  'SQL Server': 'SQL Server',
  Redis: 'Redis',
  Socket: 'Socket',
  WebSocket: 'WebSocket'
})
const PROTOCOL_WORKBENCH_COPY = Object.freeze({
  HTTP: { title: 'HTTP 请求配置', transport: 'HTTP / HTTPS' },
  WebSocket: { title: 'WebSocket 连接与订阅', transport: 'WebSocket / WSS' },
  Socket: { title: 'Socket 连接与报文', transport: 'TCP Socket' },
  MQTT: { title: 'MQTT 连接与订阅', transport: 'TCP / MQTT 5.0' },
  Redis: { title: 'Redis 连接与读取', transport: 'Redis RESP' },
  MySQL: { title: 'MySQL 连接与查询', transport: 'MySQL' },
  'SQL Server': { title: 'SQL Server 连接与查询', transport: 'TDS / SQL Server' }
})
const SOURCE_GROUP_PAGE_SIZE = 60
const SOURCE_OVERVIEW_PAGE_SIZE = 60
// 采集快照可能高频到达，管理页最多每秒合并一次，避免让采集频率直接驱动 Vue 整页渲染。
const LIVE_REFRESH_INTERVAL_MS = 1000
const SOURCE_COUNT_FORMATTER = new Intl.NumberFormat('zh-CN')
const SOURCE_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})
const OVERVIEW_RUNTIME_STATUSES = new Set(['online', 'offline', 'testing', 'error'])

const sourceListModel = computed(() => createSourceConnectionListModel(sources.value, {
  query: sourceQuery.value,
  status: sourceStatusFilter.value,
  protocol: sourceProtocolFilter.value
}))
const sourceStats = computed(() => sourceListModel.value.stats)
const drawingDisplayName = computed(() => (
  String(props.drawingName || '').trim().replace(/\.json$/i, '') || '未命名图纸'
))
const sourceOverviewPageCount = computed(() => Math.max(
  1,
  Math.ceil(sourceListModel.value.filtered.length / SOURCE_OVERVIEW_PAGE_SIZE)
))
const sourceOverviewCurrentPage = computed(() => Math.min(
  overviewPage.value,
  sourceOverviewPageCount.value - 1
))
const sourceOverviewItems = computed(() => {
  const start = sourceOverviewCurrentPage.value * SOURCE_OVERVIEW_PAGE_SIZE
  return sourceListModel.value.filtered.slice(start, start + SOURCE_OVERVIEW_PAGE_SIZE)
})
const sourceProtocolOptions = computed(() => {
  const counts = sourceListModel.value.protocolCounts
  const known = POINT_SOURCE_PROTOCOLS.filter(protocol => counts.has(protocol))
  const knownSet = new Set(known)
  const extra = [...counts.keys()].filter(protocol => protocol && !knownSet.has(protocol)).sort()
  return [...known, ...extra]
})
const hasSourceFilters = computed(() => (
  Boolean(sourceQuery.value.trim())
  || sourceStatusFilter.value !== 'all'
  || sourceProtocolFilter.value !== 'all'
))
const selectedSourceFilteredOut = computed(() => (
  Boolean(selectedSourceId.value)
  && !sourceListModel.value.filteredIds.has(selectedSourceId.value)
))

const configFields = computed(() => POINT_SOURCE_CONFIG_FIELDS[selectedSource.value?.protocol] || [])
const createConfigFields = computed(() => POINT_SOURCE_CONFIG_FIELDS[createDraft.value.protocol] || [])
const sourceInteractionLocked = computed(() => (
  Boolean(selectingSourceId.value)
  || saving.value
  || testing.value
  || deleting.value
))
const sourceDraftDirty = computed(() => (
  Boolean(selectedSource.value)
  && sourceDraftSnapshot(sourceDraft.value) !== sourceDraftBaseline.value
))
const createDraftDirty = computed(() => (
  managerView.value === 'create'
  && sourceDraftSnapshot(createDraft.value) !== createDraftBaseline.value
))
const activeProtocol = computed(() => managerView.value === 'create'
  ? createDraft.value.protocol
  : selectedSource.value?.protocol
)
const activeConfigFields = computed(() => managerView.value === 'create' ? createConfigFields.value : configFields.value)
const activeDraft = computed(() => managerView.value === 'create' ? createDraft.value : sourceDraft.value)
const activeAdvancedOpen = computed({
  get: () => managerView.value === 'create' ? createAdvancedOpen.value : sourceAdvancedOpen.value,
  set: value => {
    if (managerView.value === 'create') createAdvancedOpen.value = Boolean(value)
    else sourceAdvancedOpen.value = Boolean(value)
  }
})
const activeBasicFields = computed(() => configFieldsBySection(activeConfigFields.value, 'basic'))
const activeAdvancedFields = computed(() => configFieldsBySection(activeConfigFields.value, 'advanced'))
const activeWorkbenchCopy = computed(() => PROTOCOL_WORKBENCH_COPY[activeProtocol.value] || {
  title: `${activeProtocol.value || '数据'}连接配置`,
  transport: activeProtocol.value || '--'
})
const activeTestResult = computed(() => managerView.value === 'create' ? createTestResult.value : sourceTestResult.value)
const activeTestContext = computed(() => {
  if (managerView.value === 'create') return createTestContext.value
  // 表单修改后，画面中的旧结果只代表已保存配置，不能冒充当前草稿的测试结果。
  if (sourceDraftDirty.value && sourceTestContext.value === 'official') return 'history'
  return sourceTestContext.value
})
const activeOfficialSnapshotAvailable = computed(() => (
  activeTestContext.value === 'official'
  && managerView.value === 'detail'
  && selectedSource.value?.enabled !== false
  && effectiveSourceStatus(selectedSource.value) === 'online'
  && isUsableSourceSnapshot(selectedSourceSnapshot.value, selectedSource.value?.id)
))
const activeTestDisplayMessage = computed(() => {
  const result = activeTestResult.value
  if (!result) return '尚未测试'
  if (activeTestContext.value === 'draft') {
    return result.ok ? '当前配置测试成功（仅预览）' : `当前配置测试失败（仅预览）：${result.message}`
  }
  if (activeTestContext.value === 'history') {
    return result.ok ? '上次测试成功；当前连接需重新测试' : `上次测试失败：${result.message}`
  }
  if (result.ok && activeOfficialSnapshotAvailable.value) return '连接成功，数据已可用于组件通信'
  if (result.ok && selectedSource.value?.enabled === false) return '连接测试成功，但当前连接已停用'
  if (result.ok) return '连接测试成功，但尚未获得可用于组件通信的数据'
  return result.message
})
const activeTestHint = computed(() => {
  if (activeTestContext.value === 'draft') return '仅用于检查当前表单；请先保存，再执行正式测试后用于组件'
  if (activeTestContext.value === 'history') return '当前显示上次测试结果；保存配置后请重新测试'
  if (activeOfficialSnapshotAvailable.value) return '正式测试数据已同步到组件通信'
  if (activeTestResult.value?.ok && activeTestContext.value === 'official') return '当前结果不可用于组件，请确认连接已启用并重新测试'
  return ''
})
const responsePointQualityLabel = computed(() => {
  if (activeTestContext.value === 'draft') return '仅预览'
  if (activeTestContext.value === 'history') return '历史结果'
  const quality = String(activeResponseSnapshot.value?.quality || '').toLowerCase()
  if (quality === 'good') return '正常'
  if (quality === 'error' || quality === 'bad') return '异常'
  if (quality === 'offline') return '离线'
  if (quality === 'stale') return '待重测'
  return '--'
})
const activeResponseText = computed(() => managerView.value === 'create' ? createResponseText.value : sourceResponseText.value)
const activeResponseSnapshot = computed(() => managerView.value === 'create'
  ? createResponseSnapshot.value
  : selectedSourceSnapshot.value
)
// 尚未测试时不解析空快照，避免点位表生成“$ / undefined”的伪数据。
const responsePointPreview = computed(() => {
  if (!activeResponseSnapshot.value || activeResponseSnapshot.value.data === undefined) return []
  return createJsonResponsePointPreview(activeResponseSnapshot.value.data, {
    maxRows: 80,
    maxDepth: 8,
    maxChildren: 40
  })
})
const responsePointRows = computed(() => Array.isArray(responsePointPreview.value)
  ? responsePointPreview.value
  : (responsePointPreview.value?.rows || [])
)
const RESPONSE_POINT_ROW_LIMIT = 80

watch([sourceQuery, sourceStatusFilter, sourceProtocolFilter], async () => {
  resetSourceGroupPages()
  overviewPage.value = 0
  await nextTick()
  const sourceId = selectedSourceId.value
  if (sourceId && sourceListModel.value.filteredIds.has(sourceId)) expandSourceGroupFor(sourceId)
})

async function applySourceSearch() {
  sourceQuery.value = sourceQueryInput.value.trim()
  if (sourceQuery.value) {
    const next = new Set(collapsedSourceGroups.value)
    for (const group of sourceListModel.value.groups) next.delete(group.id)
    collapsedSourceGroups.value = next
  }
  await nextTick()
  const sourceId = selectedSourceId.value
  if (sourceId && sourceListModel.value.filteredIds.has(sourceId)) expandSourceGroupFor(sourceId)
}

function clearSourceFilters() {
  sourceQueryInput.value = ''
  sourceQuery.value = ''
  sourceStatusFilter.value = 'all'
  sourceProtocolFilter.value = 'all'
}

function changeOverviewPage(direction) {
  const target = Math.min(
    sourceOverviewPageCount.value - 1,
    Math.max(0, sourceOverviewCurrentPage.value + direction)
  )
  if (target === sourceOverviewCurrentPage.value) return
  overviewPage.value = target
}

function formatPointCount(value) {
  const count = Math.max(0, Math.trunc(Number(value) || 0))
  return SOURCE_COUNT_FORMATTER.format(count)
}

function responseDurationLabel(source) {
  const response = liveResponseBySource.value.get(source?.id) || source?.lastResponse
  if (!response) return '--'
  return `${Math.max(0, Math.round(Number(response.durationMs) || 0))} ms`
}

function recentResponseLabel(source) {
  const response = liveResponseBySource.value.get(source?.id) || source?.lastResponse
  return response?.at ? formatDate(response.at) : '尚未测试'
}

// 总览的运行状态只描述连接健康度；是否启用由相邻的独立字段表达。
function overviewRuntimeStatus(source) {
  const status = String(source?.status || '').trim().toLowerCase()
  return OVERVIEW_RUNTIME_STATUSES.has(status) ? status : 'unknown'
}

async function revealSelectedSource() {
  clearSourceFilters()
  await nextTick()
  expandSourceGroupFor(selectedSourceId.value)
}

function sourceGroupFor(source) {
  return sourceProtocolGroupId(source?.protocol)
}

function sourceGroupIsCollapsed(groupId) {
  return collapsedSourceGroups.value.has(groupId)
}

function toggleSourceGroup(groupId) {
  const next = new Set(collapsedSourceGroups.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedSourceGroups.value = next
}

function expandSourceGroupFor(sourceId) {
  const source = sources.value.find(item => item.id === sourceId)
  if (!source) return
  const groupId = sourceGroupFor(source)
  if (collapsedSourceGroups.value.has(groupId)) {
    const next = new Set(collapsedSourceGroups.value)
    next.delete(groupId)
    collapsedSourceGroups.value = next
  }

  const group = sourceListModel.value.groups.find(item => item.id === groupId)
  const sourceIndex = group?.items.findIndex(item => item.id === sourceId) ?? -1
  if (sourceIndex >= 0) {
    const targetPage = Math.floor(sourceIndex / SOURCE_GROUP_PAGE_SIZE)
    if (sourceGroupPage(groupId) !== targetPage) {
      const nextPages = new Map(sourceGroupPages.value)
      nextPages.set(groupId, targetPage)
      sourceGroupPages.value = nextPages
    }
  }
  scrollSourceRowIntoView(sourceId)
}

function scrollSourceRowIntoView(sourceId) {
  nextTick(() => {
    const escapedId = globalThis.CSS?.escape?.(String(sourceId))
    const row = escapedId
      ? sourceListElement.value?.querySelector?.(`[data-source-id="${escapedId}"]`)
      : [...(sourceListElement.value?.querySelectorAll?.('[data-source-id]') || [])]
          .find(element => element.dataset.sourceId === sourceId)
    row?.scrollIntoView?.({ block: 'nearest' })
  })
}

function sourceGroupPage(groupId) {
  return sourceGroupPages.value.get(groupId) || 0
}

function sourceGroupPageCount(group) {
  return Math.max(1, Math.ceil(group.items.length / SOURCE_GROUP_PAGE_SIZE))
}

function sourceGroupCountLabel(group) {
  const total = sourceListModel.value.protocolCounts.get(group.label) || group.items.length
  return group.items.length === total ? String(total) : `${group.items.length} / ${total}`
}

function sourceGroupCurrentPage(group) {
  return Math.min(sourceGroupPage(group.id), sourceGroupPageCount(group) - 1)
}

function sourceGroupPageItems(group) {
  const page = sourceGroupCurrentPage(group)
  const start = page * SOURCE_GROUP_PAGE_SIZE
  return group.items.slice(start, start + SOURCE_GROUP_PAGE_SIZE)
}

function changeSourceGroupPage(group, direction) {
  const pageCount = sourceGroupPageCount(group)
  const currentPage = sourceGroupCurrentPage(group)
  const targetPage = Math.min(pageCount - 1, Math.max(0, currentPage + direction))
  if (targetPage === currentPage) return
  const next = new Map(sourceGroupPages.value)
  next.set(group.id, targetPage)
  sourceGroupPages.value = next
  nextTick(() => sourceListElement.value?.querySelector?.(`#source-group-heading-${group.id}`)?.scrollIntoView?.({ block: 'nearest' }))
}

function resetSourceGroupPages() {
  sourceGroupPages.value = new Map()
}

function protocolDefaultConfig(protocol) {
  return Object.fromEntries(
    (POINT_SOURCE_CONFIG_FIELDS[protocol] || []).map(field => [field.key, field.default ?? ''])
  )
}

function createSourceDraft(protocol = 'HTTP') {
  return {
    name: '',
    protocol,
    enabled: true,
    config: protocolDefaultConfig(protocol)
  }
}

const PRIMARY_CONFIG_KEYS = Object.freeze({
  MQTT: ['brokerUrl'],
  HTTP: ['url'],
  MySQL: [],
  'SQL Server': [],
  Redis: [],
  Socket: [],
  WebSocket: ['url']
})

function configFieldsBySection(fields, section) {
  return fields.filter(field => (field.section || legacyFieldSection(field)) === section)
}

function workbenchFields(fields, protocol, section) {
  const primaryKeys = PRIMARY_CONFIG_KEYS[protocol] || []
  return configFieldsBySection(fields, section).filter(field => !primaryKeys.includes(field.key))
}

function primaryTargetKey(protocol) {
  if (protocol === 'MQTT') return 'brokerUrl'
  if (protocol === 'HTTP' || protocol === 'WebSocket') return 'url'
  return ''
}

function primaryTargetPlaceholder(protocol) {
  const key = primaryTargetKey(protocol)
  if (!key) return ''
  return (POINT_SOURCE_CONFIG_FIELDS[protocol] || []).find(field => field.key === key)?.placeholder || '连接地址'
}

function legacyFieldSection(field) {
  const key = String(field?.key || '').toLowerCase()
  return ['username', 'password', 'headers', 'clientid', 'keepalive', 'heartbeat', 'heartbeatinterval', 'subprotocol']
    .includes(key)
    ? 'advanced'
    : 'basic'
}

function fieldControlId(field, section) {
  return `source-${section}-${String(field?.key || '').replace(/[^a-z0-9_-]/gi, '-')}`
}

function fieldInputMode(field) {
  if (field.type === 'number') return 'numeric'
  if (/url|host|broker/i.test(field.key)) return 'url'
  return undefined
}

function sourceDraftSnapshot(draft) {
  const config = draft?.config && typeof draft.config === 'object'
    ? Object.fromEntries(Object.keys(draft.config).sort().map(key => [key, draft.config[key]]))
    : {}
  return JSON.stringify({
    name: String(draft?.name || ''),
    protocol: String(draft?.protocol || ''),
    enabled: draft?.enabled !== false,
    config
  })
}

function sourceDraftPatch() {
  return {
    name: sourceDraft.value.name.trim(),
    enabled: sourceDraft.value.enabled,
    config: { ...sourceDraft.value.config }
  }
}

function confirmDiscardSourceDraft() {
  if (!sourceDraftDirty.value && !createDraftDirty.value) return true
  return window.confirm('当前连接有未保存的修改，继续操作将放弃这些修改。')
}

async function requestSelectSource(id) {
  if (sourceInteractionLocked.value) return
  if (managerView.value === 'detail' && id === selectedSourceId.value) return
  if (['detail', 'create'].includes(managerView.value) && !confirmDiscardSourceDraft()) return
  const selected = await selectSource(id)
  if (selected !== false) {
    managerView.value = 'detail'
    nextTick(() => detailBackButton.value?.focus())
  }
}

function showSourceOverview() {
  if (sourceInteractionLocked.value || !confirmDiscardSourceDraft()) return
  selectionGeneration += 1
  selectingSourceId.value = ''
  selectedSourceId.value = ''
  selectedSource.value = null
  fillDraft(null)
  clearNotice()
  managerView.value = 'overview'
  nextTick(() => sourceOverviewEntry.value?.focus())
}

function requestCloseManager() {
  if (sourceInteractionLocked.value || !confirmDiscardSourceDraft()) return
  emit('close')
}

function closeProtocolPicker() {
  if (saving.value) return
  const focusTarget = protocolPickerTrigger
  protocolPickerTrigger = null
  protocolPickerOpen.value = false
  nextTick(() => focusTarget?.focus?.())
}

function handleManagerEscape() {
  if (protocolPickerOpen.value) closeProtocolPicker()
  else requestCloseManager()
}

function trapManagerFocus(event) {
  const root = protocolPickerOpen.value ? protocolPickerElement.value : managerShellElement.value
  if (!root) return
  const focusable = [...root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.getClientRects().length > 0)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return SOURCE_DATE_FORMATTER.format(date)
}

function clearNotice() {
  errorMessage.value = ''
  successMessage.value = ''
}

function fillDraft(source) {
  if (!source) {
    sourcePreviewGeneration += 1
    sourceTestResult.value = null
    sourceTestContext.value = ''
    sourceResponseText.value = ''
    selectedSourceSnapshot.value = null
  }
  const nextDraft = {
    name: source?.name || '',
    enabled: source?.enabled !== false,
    config: { ...(source?.config || {}) }
  }
  sourceDraft.value = nextDraft
  sourceDraftBaseline.value = sourceDraftSnapshot(nextDraft)
}

function mergeSourceMetadata(current, updated) {
  const { points: _points, ...metadata } = updated || {}
  return {
    ...(current || {}),
    ...metadata,
    pointCount: Number.isFinite(Number(metadata.pointCount))
      ? Number(metadata.pointCount)
      : Number(current?.pointCount) || 0
  }
}

function pendingToggleOverlay(source) {
  const job = sourceToggleJobs.get(String(source?.id || ''))
  if (!job) return source
  return mergeSourceMetadata(source, {
    enabled: job.desiredEnabled,
    // 启停会使旧采集结果失效，等待后台确认期间统一展示为离线。
    status: 'offline'
  })
}

function markSourceToggleRevision(sourceId) {
  sourceToggleRevisions.set(sourceId, (sourceToggleRevisions.get(sourceId) || 0) + 1)
}

function captureSourceToggleRevisions() {
  return new Map(sourceToggleRevisions)
}

function mergeSourceCatalogRead(nextSources, revisionsAtStart = new Map()) {
  const currentById = new Map(sources.value.map(source => [source.id, source]))
  return nextSources.map(source => {
    const sourceId = String(source?.id || '')
    const changedDuringRead = (sourceToggleRevisions.get(sourceId) || 0)
      !== (revisionsAtStart.get(sourceId) || 0)
    const current = currentById.get(sourceId)
    const merged = changedDuringRead && current
      ? mergeSourceMetadata(source, { enabled: current.enabled, status: current.status })
      : source
    return pendingToggleOverlay(merged)
  })
}

function applySourceToggleDisplay(job, options = {}) {
  const settled = options.settled === true
  const displayPatch = {
    enabled: job.desiredEnabled,
    status: settled ? job.confirmedSource?.status : 'offline'
  }
  const selectedDraftWasDirty = selectedSourceId.value === job.sourceId && sourceDraftDirty.value
  sources.value = sources.value.map(source => source.id === job.sourceId
    ? mergeSourceMetadata(source, displayPatch)
    : source)
  if (selectedSourceId.value !== job.sourceId || !selectedSource.value) return
  selectedSource.value = mergeSourceMetadata(selectedSource.value, displayPatch)
  if (!selectedDraftWasDirty) fillDraft(selectedSource.value)
}

function snapshotResponseSummary(snapshot, currentResponse = null) {
  if (!snapshot) return currentResponse
  const durationMs = Number(snapshot.meta?.durationMs)
  return {
    ok: snapshot.quality === 'good',
    at: snapshot.timestamp || currentResponse?.at || new Date().toISOString(),
    durationMs: Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : (Number(currentResponse?.durationMs) || 0),
    message: String(snapshot.meta?.message || currentResponse?.message || '已收到最新数据')
  }
}

// 启停、改配置等生命周期快照不是接口返回，不能刷新“最近响应”时间。
function snapshotRepresentsResponse(snapshot) {
  const origin = String(snapshot?.meta?.origin || '')
  return origin !== 'source-verification-required'
    && origin !== 'source-update'
    && origin !== 'source-removed'
}

function publishLiveResponseSummaries(snapshots) {
  if (!snapshots.size) return
  const nextResponses = new Map(liveResponseBySource.value)
  const sourceById = new Map(sources.value.map(source => [source.id, source]))
  let changed = false
  for (const [sourceId, snapshot] of snapshots) {
    if (!snapshotRepresentsResponse(snapshot)) continue
    const source = sourceById.get(sourceId)
    nextResponses.set(sourceId, snapshotResponseSummary(
      snapshot,
      nextResponses.get(sourceId) || source?.lastResponse
    ))
    changed = true
  }
  if (changed) liveResponseBySource.value = nextResponses
}

async function flushLiveRefresh() {
  if (!gatewayEventsActive) return
  if (liveRefreshRunning) {
    liveRefreshQueued = true
    return
  }
  liveRefreshRunning = true
  liveRefreshQueued = false
  const refreshCatalog = liveCatalogDirty
  liveCatalogDirty = false
  const snapshots = new Map(pendingSnapshotBySource)
  pendingSnapshotBySource.clear()

  try {
    let nextSources = sources.value
    if (refreshCatalog) {
      const toggleRevisionsAtStart = captureSourceToggleRevisions()
      const listedSources = await props.gateway.listSources()
      if (!gatewayEventsActive) return
      if (Array.isArray(listedSources)) {
        nextSources = mergeSourceCatalogRead(listedSources, toggleRevisionsAtStart)
      }
    }
    if (nextSources !== sources.value) {
      sources.value = nextSources
      const availableIds = new Set(nextSources.map(source => source.id))
      const retainedResponses = new Map(
        [...liveResponseBySource.value].filter(([sourceId]) => availableIds.has(sourceId))
      )
      if (retainedResponses.size !== liveResponseBySource.value.size) {
        liveResponseBySource.value = retainedResponses
      }
    }
    publishLiveResponseSummaries(snapshots)

    const sourceId = selectedSourceId.value
    const selectedSummary = sourceId ? nextSources.find(source => source.id === sourceId) : null
    if (managerView.value === 'detail' && sourceId && selectedSource.value && selectedSummary) {
      // 只更新详情元数据；编辑表单及其基线保持不动，避免实时事件覆盖未保存草稿。
      selectedSource.value = mergeSourceMetadata(selectedSource.value, selectedSummary)
      const snapshot = snapshots.get(sourceId)
      if (snapshot && snapshotRepresentsResponse(snapshot)) {
        selectedSourceSnapshot.value = snapshot
        const response = liveResponseBySource.value.get(sourceId)
        sourceTestResult.value = testResultFromResponse(response)
        sourceTestContext.value = snapshot.quality === 'good' && selectedSummary.status === 'online'
          ? 'official'
          : 'history'
        sourceResponseText.value = formatTestResponse(snapshot.data)
      }
    }

    if (sourceId && !nextSources.some(source => source.id === sourceId)) {
      if (managerView.value === 'detail' && sourceDraftDirty.value) {
        errorMessage.value = '当前连接已在其他位置删除，未保存的编辑内容已保留；返回总览前请确认是否放弃草稿。'
        return
      }
      selectionGeneration += 1
      sourcePreviewGeneration += 1
      selectingSourceId.value = ''
      selectedSourceId.value = ''
      selectedSource.value = null
      fillDraft(null)
      managerView.value = 'overview'
    }
  } catch {
    // 后台自动刷新失败不打断用户正在编辑的连接，下一次网关事件会继续尝试。
  } finally {
    liveRefreshRunning = false
    if (liveRefreshQueued || liveCatalogDirty || pendingSnapshotBySource.size) scheduleLiveRefresh()
  }
}

function scheduleLiveRefresh() {
  if (!gatewayEventsActive || liveRefreshTimer !== null) return
  liveRefreshTimer = globalThis.setTimeout(() => {
    liveRefreshTimer = null
    flushLiveRefresh()
  }, LIVE_REFRESH_INTERVAL_MS)
}

function handleSourceCatalogEvent() {
  liveCatalogDirty = true
  scheduleLiveRefresh()
}

function handleSourceSnapshot(snapshot) {
  const sourceId = String(snapshot?.sourceId || '')
  if (!sourceId) return
  // 同一个连接在合并窗口内只保留最后一帧共享快照，不复制大 JSON。
  pendingSnapshotBySource.set(sourceId, snapshot)
  scheduleLiveRefresh()
}

function subscribeToGatewayEvents() {
  gatewayEventsActive = true
  if (typeof props.gateway?.subscribe === 'function') {
    unsubscribeSourceCatalog = props.gateway.subscribe(handleSourceCatalogEvent)
  }
  if (typeof props.gateway?.subscribeSnapshots === 'function') {
    unsubscribeSourceSnapshots = props.gateway.subscribeSnapshots(handleSourceSnapshot, { shared: true })
  }
}

function unsubscribeFromGatewayEvents() {
  gatewayEventsActive = false
  unsubscribeSourceCatalog?.()
  unsubscribeSourceSnapshots?.()
  unsubscribeSourceCatalog = null
  unsubscribeSourceSnapshots = null
  if (liveRefreshTimer !== null) globalThis.clearTimeout(liveRefreshTimer)
  liveRefreshTimer = null
  liveRefreshQueued = false
  liveCatalogDirty = false
  pendingSnapshotBySource.clear()
}

function showPersistenceResult(persistence, durableMessage) {
  if (persistence && persistence.durable) {
    successMessage.value = durableMessage
    return true
  }
  errorMessage.value = '操作仅在当前页面生效，未持久保存；刷新页面后将恢复为上次成功保存的配置'
  return false
}

async function refreshSources(preferredId = selectedSourceId.value, options = {}) {
  const toggleRevisionsAtStart = captureSourceToggleRevisions()
  const nextSources = mergeSourceCatalogRead(
    await props.gateway.listSources(),
    toggleRevisionsAtStart
  )
  sources.value = nextSources
  if (!nextSources.length) {
    selectionGeneration += 1
    selectingSourceId.value = ''
    selectedSourceId.value = ''
    selectedSource.value = null
    fillDraft(null)
    managerView.value = 'overview'
    return true
  }
  const shouldSelect = options.select === true || (managerView.value === 'detail' && Boolean(preferredId))
  if (!shouldSelect) {
    selectionGeneration += 1
    selectingSourceId.value = ''
    selectedSourceId.value = ''
    selectedSource.value = null
    fillDraft(null)
    if (managerView.value !== 'create') managerView.value = 'overview'
    return true
  }
  const nextId = nextSources.some(source => source.id === preferredId) ? preferredId : nextSources[0].id
  if (nextId !== selectedSourceId.value || !selectedSource.value) return selectSource(nextId, options)
  return true
}

async function selectSource(id, options = {}) {
  const generation = ++selectionGeneration
  sourcePreviewGeneration += 1
  selectingSourceId.value = id
  expandSourceGroupFor(id)
  if (options.clearNotice !== false) clearNotice()
  try {
    const source = await props.gateway.getSource(id, { includePoints: false })
    if (generation !== selectionGeneration || selectingSourceId.value !== id) return false
    if (!source) throw new Error('连接不存在或无法读取')
    selectedSourceId.value = id
    const displayedSource = pendingToggleOverlay(source)
    selectedSource.value = displayedSource
    fillDraft(displayedSource)
    sourceAdvancedOpen.value = false
    loadSourceTestPreview(source)
    return true
  } catch (error) {
    if (generation !== selectionGeneration || selectingSourceId.value !== id) return false
    errorMessage.value = error?.message || '无法读取连接配置'
    return false
  } finally {
    if (generation === selectionGeneration) selectingSourceId.value = ''
  }
}

async function refreshSourcesAfterMutation(preferredId, completedMessage) {
  try {
    const refreshed = await refreshSources(preferredId, { clearNotice: false })
    if (refreshed === false) throw new Error(errorMessage.value || '无法读取最新连接列表')
    return true
  } catch (error) {
    successMessage.value = ''
    errorMessage.value = `${completedMessage}，但连接列表刷新失败：${error?.message || '未知错误'}`
    return false
  }
}

function validateConnectionDraft(draft, fields, protocol) {
  if (!draft.name.trim()) return '连接名称不能为空'
  for (const field of fields) {
    const value = draft.config[field.key]
    const valueText = String(value ?? '').trim()
    if (field.required && !valueText) return `${field.label}不能为空`
    if (field.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return `${field.label}必须是有效数字`
      if (Number.isFinite(field.min) && numeric < field.min) return `${field.label}不能小于 ${field.min}`
      if (Number.isFinite(field.max) && numeric > field.max) return `${field.label}不能大于 ${field.max}`
    }
    if (field.type === 'select' && !field.options?.includes(valueText)) return `${field.label}选项无效`
  }
  if (protocol === 'HTTP') {
    try {
      const headers = JSON.parse(String(draft.config.headers || '{}'))
      if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new TypeError()
    } catch {
      return '请求头必须是 JSON 对象'
    }
  }
  return ''
}

function validateDraft() {
  return validateConnectionDraft(sourceDraft.value, configFields.value, selectedSource.value?.protocol)
}

function validateCreateDraft() {
  return validateConnectionDraft(createDraft.value, createConfigFields.value, createDraft.value.protocol)
}

function validateActiveDraft() {
  return managerView.value === 'create' ? validateCreateDraft() : validateDraft()
}

function activeConnectionPayload() {
  const draft = activeDraft.value
  return {
    ...(managerView.value === 'detail' && selectedSource.value ? { id: selectedSource.value.id } : {}),
    name: draft.name.trim(),
    protocol: activeProtocol.value,
    enabled: draft.enabled,
    config: { ...draft.config }
  }
}

function clearActiveTestPreview() {
  if (managerView.value === 'create') {
    createTestResult.value = null
    createTestContext.value = ''
    createResponseText.value = ''
    createResponseSnapshot.value = null
    return
  }
  sourcePreviewGeneration += 1
  sourceTestResult.value = null
  sourceTestContext.value = ''
  sourceResponseText.value = ''
  selectedSourceSnapshot.value = null
}

function applyActiveTestPreview(result, context = 'draft') {
  const testResult = testResultFromResponse(result?.response)
  const snapshot = result?.snapshot || null
  const responseText = snapshot ? formatTestResponse(snapshot.data) : ''
  if (managerView.value === 'create') {
    createTestResult.value = testResult
    if (context === 'official') createTestContext.value = 'official'
    else createTestContext.value = 'draft'
    createResponseSnapshot.value = snapshot
    createResponseText.value = responseText
    return
  }
  sourceTestResult.value = testResult
  if (context === 'official') sourceTestContext.value = 'official'
  else sourceTestContext.value = 'draft'
  selectedSourceSnapshot.value = snapshot
  sourceResponseText.value = responseText
}

function replaceSourceMetadata(updated) {
  if (!updated?.id) return
  let found = false
  sources.value = sources.value.map(source => {
    if (source.id !== updated.id) return source
    found = true
    return mergeSourceMetadata(source, updated)
  })
  if (!found) sources.value = [...sources.value, updated]
  if (selectedSourceId.value === updated.id && selectedSource.value) {
    selectedSource.value = mergeSourceMetadata(selectedSource.value, updated)
  }
}

function applyOfficialTestResult(result, snapshot, previewError = null) {
  replaceSourceMetadata(result?.source)
  const testResult = testResultFromResponse(result?.response)
  sourceTestResult.value = previewError && testResult
    ? { ...testResult, previewMessage: `连接测试已完成，但正式数据读取失败：${previewError?.message || '未知错误'}` }
    : testResult
  sourceTestContext.value = 'official'
  selectedSourceSnapshot.value = snapshot || null
  sourceResponseText.value = snapshot ? formatTestResponse(snapshot.data) : ''
  const sourceId = String(result?.source?.id || '')
  if (sourceId && result?.response) {
    const nextResponses = new Map(liveResponseBySource.value)
    nextResponses.set(sourceId, result.response)
    liveResponseBySource.value = nextResponses
  }
}

async function saveExistingSource() {
  if (!selectedSource.value || sourceInteractionLocked.value) return
  clearNotice()
  const invalid = validateDraft()
  if (invalid) {
    errorMessage.value = invalid
    return
  }
  const operationSourceId = selectedSource.value.id
  saving.value = true
  try {
    const updated = await props.gateway.updateSource(operationSourceId, sourceDraftPatch(), { includePoints: false })
    if (selectedSourceId.value === operationSourceId) {
      selectedSource.value = mergeSourceMetadata(selectedSource.value, updated)
      fillDraft(selectedSource.value)
      clearActiveTestPreview()
    }
    showPersistenceResult(updated.persistence, '连接配置已保存，请点击“测试”使连接上线并用于组件')
    emit('changed', { type: 'source-saved', source: updated })
    await refreshSourcesAfterMutation(operationSourceId, '连接配置已保存')
  } catch (error) {
    errorMessage.value = error?.message || '保存连接配置失败'
  } finally {
    saving.value = false
  }
}

async function saveConnection() {
  if (managerView.value === 'create') await saveCreatedSource()
  else await saveExistingSource()
}

async function testConnection() {
  if (sourceInteractionLocked.value) return
  clearNotice()
  createError.value = ''
  const invalid = validateActiveDraft()
  if (invalid) {
    if (managerView.value === 'create') createError.value = invalid
    else errorMessage.value = invalid
    return
  }
  const testsSavedConnection = managerView.value === 'detail'
    && Boolean(selectedSource.value?.id)
    && !sourceDraftDirty.value
  const operationView = managerView.value
  const operationSourceId = String(selectedSource.value?.id || '')
  const operationSelectionGeneration = selectionGeneration
  clearActiveTestPreview()
  testing.value = true
  try {
    if (testsSavedConnection) {
      const sourceId = operationSourceId
      const result = await props.gateway.testSource(sourceId, { includePoints: false })
      let snapshot = null
      let previewError = null
      try {
        snapshot = await props.gateway.getSourceSnapshot(sourceId, { shared: true })
      } catch (error) {
        // 正式测试与快照读取分别记账，预览读取失败不能抹掉已经完成的测试状态。
        previewError = error
      }
      if (
        !sourceManagerActive
        || operationSelectionGeneration !== selectionGeneration
        || managerView.value !== 'detail'
        || selectedSourceId.value !== sourceId
      ) return
      applyOfficialTestResult(result, snapshot, previewError)
      emit('changed', { type: 'source-tested', source: result.source })
      if (result.ok && result.source?.enabled === false) {
        successMessage.value = '连接测试成功，但当前连接已停用，不会向组件提供数据'
      } else if (
        result.ok
        && effectiveSourceStatus(result.source) === 'online'
        && isUsableSourceSnapshot(snapshot, sourceId)
      ) {
        successMessage.value = '连接成功，数据已可用于组件通信'
      } else if (result.ok) {
        errorMessage.value = previewError
          ? `连接测试成功，但正式数据读取失败：${previewError?.message || '未知错误'}`
          : '连接测试成功，但尚未获得可用于组件通信的数据，请重新测试'
      } else {
        errorMessage.value = result.response?.message || '连接测试失败'
      }
      return
    }
    if (typeof props.gateway.testSourceDraft !== 'function') {
      throw new Error('当前数据源适配器不支持测试未保存的连接配置')
    }
    const result = await props.gateway.testSourceDraft(activeConnectionPayload(), { sharedSnapshot: true })
    if (
      !sourceManagerActive
      || operationSelectionGeneration !== selectionGeneration
      || managerView.value !== operationView
      || (operationView === 'detail' && selectedSourceId.value !== operationSourceId)
    ) return
    applyActiveTestPreview(result, 'draft')
    if (result.ok) successMessage.value = '当前配置测试成功（仅预览），请保存后再正式测试'
    else if (managerView.value === 'create') createError.value = result.response?.message || '连接测试失败'
    else errorMessage.value = result.response?.message || '连接测试失败'
  } catch (error) {
    if (
      !sourceManagerActive
      || operationSelectionGeneration !== selectionGeneration
      || managerView.value !== operationView
      || (operationView === 'detail' && selectedSourceId.value !== operationSourceId)
    ) return
    const message = error?.message || '连接测试失败'
    applyActiveTestPreview(
      { response: { ok: false, message, at: Date.now(), durationMs: 0 } },
      testsSavedConnection ? 'official' : 'draft'
    )
    if (managerView.value === 'create') createError.value = message
    else errorMessage.value = message
  } finally {
    testing.value = false
  }
}

async function toggleSourceEnabled(source) {
  if (!source || sourceInteractionLocked.value) return
  const sourceId = String(source.id || '')
  const current = sources.value.find(item => item.id === sourceId)
  if (!current) return
  clearNotice()

  let job = sourceToggleJobs.get(sourceId)
  markSourceToggleRevision(sourceId)
  if (!job) {
    job = {
      sourceId,
      confirmedSource: current,
      confirmedEnabled: current.enabled !== false,
      desiredEnabled: current.enabled === false,
      running: false,
      task: null
    }
    sourceToggleJobs.set(sourceId, job)
  } else {
    // 始终基于最新意图切换，避免事件参数中的旧对象造成重复“停用”。
    job.desiredEnabled = !job.desiredEnabled
  }

  applySourceToggleDisplay(job)
  if (!job.running) job.task = reconcileSourceToggle(job)
  await job.task
}

async function reconcileSourceToggle(job) {
  job.running = true
  let completionEmitted = false
  try {
    while (job.confirmedEnabled !== job.desiredEnabled) {
      const requestedEnabled = job.desiredEnabled
      const confirmedEnabledBeforeRequest = job.confirmedEnabled
      const confirmedSourceBeforeRequest = job.confirmedSource
      try {
        const updated = await props.gateway.updateSource(
          job.sourceId,
          { enabled: requestedEnabled },
          { includePoints: false }
        )
        job.confirmedSource = mergeSourceMetadata(job.confirmedSource, updated)
        job.confirmedEnabled = updated.enabled !== false
        if (job.confirmedEnabled !== requestedEnabled) {
          job.confirmedEnabled = confirmedEnabledBeforeRequest
          job.confirmedSource = confirmedSourceBeforeRequest
          throw new Error('连接启用状态未被数据源接受')
        }
        markSourceToggleRevision(job.sourceId)
        if (sourceManagerActive && sourceToggleJobs.get(job.sourceId) === job) {
          applySourceToggleDisplay(job, { settled: job.confirmedEnabled === job.desiredEnabled })
          emit('changed', {
            type: 'source-enabled-changed',
            source: updated,
            enabled: job.confirmedEnabled
          })
          completionEmitted = true
          if (job.confirmedEnabled === job.desiredEnabled) {
            showPersistenceResult(
              updated.persistence,
              job.confirmedEnabled ? '连接已启用，重新测试后开始采集' : '连接已停用'
            )
          }
        }
      } catch (error) {
        if (!sourceManagerActive || sourceToggleJobs.get(job.sourceId) !== job) break
        // 旧意图失败但用户已改回确认状态时无需打扰；最新意图失败才回滚并提示。
        if (requestedEnabled === job.desiredEnabled) {
          job.desiredEnabled = job.confirmedEnabled
          markSourceToggleRevision(job.sourceId)
          if (sourceManagerActive && sourceToggleJobs.get(job.sourceId) === job) {
            applySourceToggleDisplay(job, { settled: true })
            errorMessage.value = error?.message
              || (requestedEnabled ? '启用连接失败' : '停用连接失败')
          }
        }
      }
    }
  } finally {
    job.running = false
    const jobIsActive = sourceToggleJobs.get(job.sourceId) === job
    // 即使管理页已关闭，也通知应用刷新通信面板的轻量目录缓存。
    if (!completionEmitted) {
      emit('changed', {
        type: 'source-enabled-settled',
        sourceId: job.sourceId,
        enabled: job.confirmedEnabled
      })
    }
    if (sourceManagerActive && jobIsActive) {
      sourceToggleJobs.delete(job.sourceId)
      applySourceToggleDisplay(job, { settled: true })
    }
  }
}

function openProtocolPicker() {
  if (sourceInteractionLocked.value || !confirmDiscardSourceDraft()) return
  protocolPickerTrigger = document.activeElement
  clearNotice()
  protocolChoice.value = CREATE_PROTOCOL_ORDER[0]
  protocolPickerOpen.value = true
  nextTick(() => protocolPickerElement.value?.querySelector?.('[aria-checked="true"]')?.focus?.())
}

function chooseCreateProtocol(protocol) {
  if (!CREATE_PROTOCOL_ORDER.includes(protocol)) return
  protocolChoice.value = protocol
}

function moveCreateProtocolChoice(direction) {
  const currentIndex = CREATE_PROTOCOL_ORDER.indexOf(protocolChoice.value)
  const nextIndex = (currentIndex + direction + CREATE_PROTOCOL_ORDER.length) % CREATE_PROTOCOL_ORDER.length
  chooseCreateProtocol(CREATE_PROTOCOL_ORDER[nextIndex])
  nextTick(() => protocolPickerElement.value?.querySelector?.('[aria-checked="true"]')?.focus?.())
}

function startCreateConnection() {
  const protocol = protocolChoice.value
  if (!CREATE_PROTOCOL_ORDER.includes(protocol)) return
  createDraft.value = createSourceDraft(protocol)
  createError.value = ''
  createTestResult.value = null
  createTestContext.value = ''
  createResponseText.value = ''
  createResponseSnapshot.value = null
  createAdvancedOpen.value = false
  createDraftBaseline.value = sourceDraftSnapshot(createDraft.value)
  protocolPickerOpen.value = false
  protocolPickerTrigger = null
  selectionGeneration += 1
  selectedSourceId.value = ''
  selectedSource.value = null
  fillDraft(null)
  managerView.value = 'create'
  nextTick(() => createNameInput.value?.focus())
}

function createSourcePayload() {
  return {
    name: createDraft.value.name.trim(),
    protocol: createDraft.value.protocol,
    enabled: createDraft.value.enabled,
    config: { ...createDraft.value.config }
  }
}

function formatTestResponse(data) {
  const compact = formatRuntimeValue(data, {
    maxLength: 4096,
    maxDepth: 8,
    maxObjectKeys: 64,
    maxArrayItems: 40,
    maxTotalEntries: 256
  })
  return prettyPrintJsonPreview(compact)
}

function testResultFromResponse(response) {
  if (!response) return null
  return {
    ok: Boolean(response.ok),
    message: response.message || (response.ok ? '连接测试成功' : '连接测试失败'),
    at: response.at || Date.now(),
    durationMs: Number(response.durationMs) || 0
  }
}

async function loadSourceTestPreview(source, response = source?.lastResponse) {
  const sourceId = String(source?.id || '')
  const generation = ++sourcePreviewGeneration
  sourceTestResult.value = testResultFromResponse(response)
  sourceTestContext.value = sourceTestResult.value
    ? (source?.status === 'online' && response?.ok ? 'official' : 'history')
    : ''
  sourceResponseText.value = ''
  selectedSourceSnapshot.value = null
  if (!sourceId || !sourceTestResult.value?.ok) return
  try {
    const snapshot = await props.gateway.getSourceSnapshot(sourceId, { shared: true })
    if (generation !== sourcePreviewGeneration || selectedSourceId.value !== sourceId) return
    if (snapshot) {
      selectedSourceSnapshot.value = snapshot
      sourceResponseText.value = formatTestResponse(snapshot.data)
      sourceTestContext.value = source?.status === 'online'
        && response?.ok
        && String(snapshot.quality || '').toLowerCase() === 'good'
        && snapshot.data !== undefined
        ? 'official'
        : 'history'
    }
  } catch (previewError) {
    if (generation !== sourcePreviewGeneration || selectedSourceId.value !== sourceId) return
    sourceTestResult.value = {
      ...sourceTestResult.value,
      previewMessage: `连接测试成功，但响应预览失败：${previewError?.message || '未知错误'}`
    }
  }
}

// 只处理已经有界的短文本，避免为了美化响应再次解析或复制完整接口数据。
function prettyPrintJsonPreview(value) {
  let output = ''
  let indent = 0
  let quoted = false
  let escaped = false
  const appendIndent = () => { output += '  '.repeat(indent) }

  for (const character of value) {
    if (quoted) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      output += character
    } else if (character === '{' || character === '[') {
      output += `${character}\n`
      indent += 1
      appendIndent()
    } else if (character === '}' || character === ']') {
      output = output.trimEnd()
      output += '\n'
      indent = Math.max(0, indent - 1)
      appendIndent()
      output += character
    } else if (character === ',') {
      output += ',\n'
      appendIndent()
    } else if (character === ':') {
      output += ': '
    } else {
      output += character
    }
  }
  return output
}

// 创建成功后先进入本地详情；目录刷新失败时也不会留在创建页造成重复提交。
function enterCreatedSourceDetail(source) {
  const createdSource = mergeSourceMetadata(source, {
    lastResponse: createTestResult.value
      ? {
          ok: createTestResult.value.ok,
          at: createTestResult.value.at,
          durationMs: createTestResult.value.durationMs,
          message: createTestResult.value.message
        }
      : source?.lastResponse
  })
  if (!sources.value.some(item => item.id === createdSource.id)) {
    sources.value = [...sources.value, createdSource]
  }
  selectedSourceId.value = createdSource.id
  selectedSource.value = createdSource
  fillDraft(createdSource)
  sourceAdvancedOpen.value = createAdvancedOpen.value
  sourceTestResult.value = createTestResult.value
  // 创建页测试只验证草稿；保存后必须重新正式测试，不能沿用草稿在线状态。
  sourceTestContext.value = createTestResult.value ? 'history' : ''
  sourceResponseText.value = createResponseText.value
  selectedSourceSnapshot.value = null
  managerView.value = 'detail'
}

async function saveCreatedSource() {
  if (sourceInteractionLocked.value) return
  const invalid = validateCreateDraft()
  if (invalid) {
    createError.value = invalid
    return
  }
  createError.value = ''
  createTestResult.value = null
  createTestContext.value = ''
  createResponseText.value = ''
  createResponseSnapshot.value = null
  saving.value = true
  let source = null
  try {
    const payload = createSourcePayload()
    source = await props.gateway.createSource(payload)
    clearSourceFilters()
    emit('changed', { type: 'source-created', source })
    createDraftBaseline.value = sourceDraftSnapshot(createDraft.value)
    enterCreatedSourceDetail(source)
    showPersistenceResult(source.persistence, '连接已保存，请点击“测试”使连接上线并用于组件')
    await refreshSourcesAfterMutation(source.id, '连接已保存')
  } catch (error) {
    createError.value = error?.message || '新建连接失败'
  } finally {
    saving.value = false
  }
}

async function removeSource(source = selectedSource.value) {
  if (!source || sourceInteractionLocked.value) return
  if (!window.confirm(`确定删除数据连接“${source.name}”吗？\n使用该连接动态数据的组件将恢复为属性中的静态值。`)) return
  clearNotice()
  const deletingSelected = selectedSourceId.value === source.id
  const nextVisible = sourceListModel.value.filtered.find(item => item.id !== source.id)
  const nextAvailable = sources.value.find(item => item.id !== source.id)
  const preferredId = deletingSelected ? (nextVisible?.id || nextAvailable?.id || '') : selectedSourceId.value
  deleting.value = true
  try {
    const removed = await props.gateway.removeSource(source.id)
    if (!removed?.removed) throw new Error('数据连接已不存在')
    sources.value = sources.value.filter(item => item.id !== source.id)
    if (deletingSelected) {
      selectionGeneration += 1
      selectingSourceId.value = ''
      selectedSource.value = null
      selectedSourceId.value = ''
      fillDraft(null)
    }
    showPersistenceResult(removed.persistence, '数据连接已删除')
    emit('changed', { type: 'source-removed', source })
    await refreshSourcesAfterMutation(preferredId, '数据连接已删除')
  } catch (error) {
    errorMessage.value = error?.message || '删除连接失败'
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  sourceManagerActive = true
  previouslyFocusedElement = document.activeElement
  subscribeToGatewayEvents()
  try {
    await refreshSources(props.initialSourceId, { select: Boolean(props.initialSourceId) })
  } catch (error) {
    errorMessage.value = error?.message || '无法读取数据源'
  } finally {
    loading.value = false
    await nextTick()
    managerCloseButton.value?.focus()
  }
})

onBeforeUnmount(() => {
  sourceManagerActive = false
  unsubscribeFromGatewayEvents()
  // 页面关闭后不再让尚未完成的持久化回执修改已卸载界面的状态。
  sourceToggleJobs.clear()
  const focusTarget = previouslyFocusedElement
  nextTick(() => focusTarget?.isConnected && focusTarget.focus?.())
})
</script>

<template>
  <div class="data-source-overlay" role="dialog" aria-modal="true" aria-labelledby="data-source-manager-title" @keydown.tab="trapManagerFocus" @keydown.esc.stop.prevent="handleManagerEscape">
    <section ref="managerShellElement" class="manager-shell" :inert="protocolPickerOpen" :aria-hidden="protocolPickerOpen ? 'true' : undefined">
      <header class="manager-header">
        <div class="manager-title">
          <span class="title-icon"><Database /></span>
          <div class="manager-title-copy">
            <h2 id="data-source-manager-title">数据源管理</h2>
            <span data-testid="data-source-drawing-name" :title="`当前图纸：${drawingDisplayName}`">当前图纸 · <b>{{ drawingDisplayName }}</b></span>
          </div>
        </div>
        <div class="manager-summary" :aria-label="`${drawingDisplayName} 的数据源总览`">
          <span><b>{{ sourceStats.online }}</b> 在线</span>
          <span><b>{{ sourceStats.total }}</b> 个连接</span>
          <span :class="{ warning: sourceStats.errors }"><b>{{ sourceStats.errors }}</b> 异常</span>
        </div>
        <button ref="managerCloseButton" class="icon-button manager-close" type="button" title="关闭数据源管理" aria-label="关闭数据源管理，返回图纸" :disabled="sourceInteractionLocked" @click="requestCloseManager">
          <X />
        </button>
      </header>

      <div class="manager-workbench">
        <aside class="source-sidebar">
          <button class="sidebar-create-button" data-testid="source-create-button" type="button" title="新建连接" aria-label="新建连接" :disabled="sourceInteractionLocked" @click="openProtocolPicker">
            <Plus /><span>新建连接</span>
          </button>
          <form class="sidebar-primary-actions" role="search" @submit.prevent="applySourceSearch">
            <div class="sidebar-search" data-testid="source-search">
              <Search aria-hidden="true" />
              <input v-model="sourceQueryInput" type="search" placeholder="名称、地址、协议" aria-label="搜索连接">
            </div>
            <button class="sidebar-search-button" type="submit" title="搜索连接" aria-label="搜索连接"><Search /></button>
          </form>
          <div class="source-filter-bar">
            <ListFilter aria-hidden="true" />
            <label class="visually-hidden" for="source-status-filter">按状态筛选</label>
            <select id="source-status-filter" v-model="sourceStatusFilter" aria-label="按状态筛选">
              <option v-for="filter in SOURCE_STATUS_FILTERS" :key="filter.id" :value="filter.id">
                {{ filter.label }}
              </option>
            </select>
            <i aria-hidden="true"></i>
            <label class="visually-hidden" for="source-protocol-filter">按协议筛选</label>
            <select id="source-protocol-filter" v-model="sourceProtocolFilter" aria-label="按协议筛选">
              <option value="all">全部协议</option>
              <option v-for="protocol in sourceProtocolOptions" :key="protocol" :value="protocol">
                {{ protocol }}
              </option>
            </select>
            <button v-if="hasSourceFilters" type="button" title="清除全部筛选" aria-label="清除全部筛选" @click="clearSourceFilters"><X /></button>
          </div>
          <div class="sidebar-caption">
            <span>筛选结果</span>
            <b data-testid="source-result-count" role="status" aria-live="polite" aria-atomic="true">{{ sourceListModel.filtered.length }} / {{ sourceStats.total }}</b>
          </div>
          <div v-if="selectedSourceFilteredOut" class="filtered-selection-notice" role="status" aria-live="polite">
            <span>当前编辑的连接已被筛选隐藏</span>
            <button type="button" @click="revealSelectedSource">定位当前连接</button>
          </div>
          <div ref="sourceListElement" class="source-list" data-testid="source-list" role="list" aria-label="数据连接">
            <button
              ref="sourceOverviewEntry"
              type="button"
              class="source-overview-entry"
              :class="{ active: managerView === 'overview' }"
              :aria-current="managerView === 'overview' ? 'page' : undefined"
              :disabled="sourceInteractionLocked"
              @click="showSourceOverview"
            >
              <span class="overview-entry-icon"><Database /></span>
              <span><b>数据源总览</b><small>查看全部连接与采集状态</small></span>
              <strong>{{ sourceStats.total }}</strong>
            </button>
            <section v-for="group in sourceListModel.groups" v-show="group.items.length" :key="group.id" class="source-group" role="group" :aria-labelledby="`source-group-heading-${group.id}`">
              <div :id="`source-group-heading-${group.id}`" class="source-group-heading">
                <button type="button" :aria-expanded="!sourceGroupIsCollapsed(group.id)" :aria-controls="`source-group-${group.id}`" @click="toggleSourceGroup(group.id)">
                  <ChevronRight :class="{ expanded: !sourceGroupIsCollapsed(group.id) }" />
                  <span class="protocol-mark compact" :data-protocol="group.label">{{ protocolShortName(group.label) }}</span>
                  <span>{{ group.label }}</span>
                  <b>{{ sourceGroupCountLabel(group) }}</b>
                </button>
              </div>
              <div v-if="!sourceGroupIsCollapsed(group.id)" :id="`source-group-${group.id}`" class="source-group-items">
                <div
                  v-for="source in sourceGroupPageItems(group)"
                  :key="source.id"
                  class="source-item"
                  :class="{ active: selectedSourceId === source.id, selecting: selectingSourceId === source.id }"
                  :data-source-id="source.id"
                  :data-status="effectiveSourceStatus(source)"
                  data-testid="source-row"
                  role="listitem"
                >
                  <button
                    type="button"
                    class="source-item-select"
                    :aria-current="selectedSourceId === source.id ? 'true' : undefined"
                    :title="`打开连接：${source.name}`"
                    :disabled="sourceInteractionLocked"
                    @click="requestSelectSource(source.id)"
                  >
                    <span class="protocol-mark" :data-protocol="source.protocol">{{ protocolShortName(source.protocol) }}</span>
                    <span class="source-item-copy">
                      <b>{{ sourceListDisplayName(source) }}<em v-if="isInterfaceDemoSource(source)">示例</em></b>
                      <small :title="source.endpoint || '尚未配置连接地址'">{{ source.endpoint || '尚未配置连接地址' }}</small>
                    </span>
                    <span class="source-item-status" :class="effectiveSourceStatus(source)" :title="statusLabel(effectiveSourceStatus(source))"><i></i><span>{{ statusLabel(effectiveSourceStatus(source)) }}</span></span>
                  </button>
                  <span class="source-item-actions">
                    <button
                      type="button"
                      class="source-item-manage"
                      :title="`编辑连接：${source.name}`"
                      :aria-label="`编辑连接：${source.name}`"
                      :disabled="sourceInteractionLocked"
                      @click="requestSelectSource(source.id)"
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      class="source-item-manage source-item-delete"
                      :title="`删除连接：${source.name}`"
                      :aria-label="`删除连接：${source.name}`"
                      :disabled="sourceInteractionLocked"
                      @click="removeSource(source)"
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
                <nav v-if="sourceGroupPageCount(group) > 1" class="source-group-pager" :aria-label="`${group.label} 连接分页`">
                  <button type="button" :disabled="sourceGroupCurrentPage(group) === 0" @click="changeSourceGroupPage(group, -1)">上一页</button>
                  <span>{{ sourceGroupCurrentPage(group) + 1 }} / {{ sourceGroupPageCount(group) }}</span>
                  <button type="button" :disabled="sourceGroupCurrentPage(group) >= sourceGroupPageCount(group) - 1" @click="changeSourceGroupPage(group, 1)">下一页</button>
                </nav>
              </div>
            </section>
            <div v-if="!sourceListModel.filtered.length" class="empty-sidebar">
              <span>{{ hasSourceFilters ? '没有匹配的连接' : '当前图纸暂无连接' }}</span>
              <button v-if="hasSourceFilters" type="button" @click="clearSourceFilters">清除筛选</button>
            </div>
          </div>
        </aside>

        <main class="source-main">
          <header v-if="!loading && (managerView === 'create' || (managerView === 'detail' && selectedSource))" class="source-heading">
            <button ref="detailBackButton" class="detail-back-button" type="button" title="返回数据源总览" aria-label="返回数据源总览" :disabled="sourceInteractionLocked" @click="showSourceOverview"><ArrowLeft /></button>
            <span class="source-heading-icon"><Wifi v-if="activeProtocol === 'MQTT'" /><Globe2 v-else-if="['HTTP','WebSocket'].includes(activeProtocol)" /><Cable v-else-if="activeProtocol === 'Socket'" /><Server v-else /></span>
            <div class="source-heading-copy">
              <div><h3>{{ managerView === 'create' ? '新建数据连接' : selectedSource.name }}</h3><span class="protocol-label">{{ activeProtocol }}</span></div>
              <small>{{ managerView === 'create' ? '填写连接参数，可分别保存或测试' : `${selectedSource.endpoint || '尚未配置连接地址'} · ${selectedSource.enabled ? '已启用' : '已停用'}` }}</small>
            </div>
            <span v-if="managerView === 'detail'" class="health-label" :class="effectiveSourceStatus(selectedSource)"><i></i>{{ sourceDraftDirty ? '已保存配置运行：' : '运行：' }}{{ statusLabel(effectiveSourceStatus(selectedSource)) }}</span>
            <div class="heading-actions" data-testid="source-heading-actions">
              <button class="secondary-button source-test-button" type="button" :disabled="sourceInteractionLocked" :aria-busy="testing" @click="testConnection"><RefreshCw :class="{ spin: testing }" />{{ testing ? '测试中' : '测试' }}</button>
              <button class="primary-button source-save-button" type="button" :disabled="sourceInteractionLocked" :aria-busy="saving" @click="saveConnection"><Save />{{ saving ? '保存中' : '保存' }}</button>
            </div>
          </header>

          <div class="notice-area" :class="{ floating: managerView === 'overview' }" aria-live="polite" aria-atomic="true">
            <div v-if="managerView === 'create' && createError" class="notice error" role="alert"><AlertCircle />{{ createError }}<button type="button" title="关闭提示" aria-label="关闭提示" @click="createError = ''"><X /></button></div>
            <div v-else-if="errorMessage" class="notice error" role="alert"><AlertCircle />{{ errorMessage }}<button type="button" title="关闭提示" aria-label="关闭提示" @click="errorMessage = ''"><X /></button></div>
            <div v-else-if="successMessage" class="notice success" role="status"><CheckCircle2 />{{ successMessage }}<button type="button" title="关闭提示" aria-label="关闭提示" @click="successMessage = ''"><X /></button></div>
          </div>

          <div v-if="loading" class="loading-state"><RefreshCw class="spin" />正在读取数据源</div>
          <section v-else-if="managerView === 'overview'" class="source-overview" aria-labelledby="source-overview-title">
            <div class="overview-toolbar">
              <div class="overview-heading-copy">
                <h3 id="source-overview-title">连接与采集状态</h3>
                <small>集中查看全部协议连接，选择接口后进入配置与测试</small>
              </div>
              <form class="overview-search" role="search" @submit.prevent="applySourceSearch">
                <Search aria-hidden="true" />
                <input v-model="sourceQueryInput" type="search" placeholder="搜索名称、地址或协议" aria-label="搜索数据源总览">
                <select v-model="sourceProtocolFilter" aria-label="总览协议筛选">
                  <option value="all">全部协议</option>
                  <option v-for="protocol in sourceProtocolOptions" :key="protocol" :value="protocol">{{ protocol }}</option>
                </select>
                <select v-model="sourceStatusFilter" aria-label="总览状态筛选">
                  <option v-for="filter in SOURCE_STATUS_FILTERS" :key="filter.id" :value="filter.id">{{ filter.label }}</option>
                </select>
                <button class="overview-search-button" type="submit"><Search />搜索</button>
              </form>
              <div class="overview-result-line">
                <span>共 {{ sourceListModel.filtered.length }} 个连接</span>
                <span :title="`连接仅属于当前图纸：${drawingDisplayName}`">仅用于当前图纸 · {{ drawingDisplayName }}</span>
              </div>
            </div>

            <div v-if="sourceListModel.filtered.length" class="overview-table-scroll" data-testid="source-overview-table">
              <table class="overview-table">
                <thead><tr><th>协议</th><th>连接名称</th><th>连接地址</th><th>运行状态</th><th>启用状态</th><th>点位数</th><th>响应耗时</th><th>最近响应</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="source in sourceOverviewItems" :key="source.id" :data-status="effectiveSourceStatus(source)">
                    <td><span class="protocol-mark overview-protocol" :data-protocol="source.protocol">{{ protocolShortName(source.protocol) }}</span></td>
                    <td><div class="overview-source-name"><b>{{ sourceListDisplayName(source) }}</b><small>{{ source.protocol }} 连接<em v-if="isInterfaceDemoSource(source)">示例</em></small></div></td>
                    <td><code :title="source.endpoint || '尚未配置连接地址'">{{ source.endpoint || '尚未配置连接地址' }}</code></td>
                    <td><span class="overview-status" :class="overviewRuntimeStatus(source)"><i></i>{{ statusLabel(overviewRuntimeStatus(source)) }}</span></td>
                    <td><span class="enabled-state" :class="{ enabled: source.enabled !== false }">{{ source.enabled !== false ? '已启用' : '已停用' }}</span></td>
                    <td>{{ formatPointCount(source.pointCount) }}</td>
                    <td>{{ responseDurationLabel(source) }}</td>
                    <td><span class="overview-response-time">{{ recentResponseLabel(source) }}</span></td>
                    <td>
                      <div class="overview-actions">
                        <button
                          class="source-enable-toggle"
                          type="button"
                          :class="{ enabled: source.enabled !== false }"
                          :disabled="sourceInteractionLocked"
                          role="switch"
                          :aria-checked="source.enabled !== false"
                          :aria-label="`接口启用状态：${source.name}`"
                          @click="toggleSourceEnabled(source)"
                        >
                          <span></span>{{ source.enabled !== false ? '停用' : '启用' }}
                        </button>
                        <button class="inspect-source-button" type="button" :disabled="sourceInteractionLocked" :aria-label="`查看接口：${source.name}`" @click="requestSelectSource(source.id)">查看接口</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="overview-empty">
              <Search v-if="hasSourceFilters" />
              <Database v-else />
              <b>{{ hasSourceFilters ? '没有匹配的连接' : '当前图纸暂无数据连接' }}</b>
              <small>{{ hasSourceFilters ? '调整搜索词或筛选条件后重试' : `“${drawingDisplayName}”尚未配置专属连接` }}</small>
              <button v-if="hasSourceFilters" type="button" @click="clearSourceFilters">清除筛选</button>
              <button v-else type="button" @click="openProtocolPicker"><Plus />新建连接</button>
            </div>
            <nav v-if="sourceOverviewPageCount > 1" class="overview-pager" aria-label="数据源总览分页">
              <button type="button" :disabled="sourceOverviewCurrentPage === 0" @click="changeOverviewPage(-1)">上一页</button>
              <span>第 {{ sourceOverviewCurrentPage + 1 }} / {{ sourceOverviewPageCount }} 页</span>
              <button type="button" :disabled="sourceOverviewCurrentPage >= sourceOverviewPageCount - 1" @click="changeOverviewPage(1)">下一页</button>
            </nav>
          </section>
          <div v-else-if="managerView !== 'create' && !selectedSource" class="empty-main">
            <Server />
            <b>{{ errorMessage ? (sources.length ? '连接详情加载失败' : '数据源读取失败') : '暂无数据源' }}</b>
            <small v-if="errorMessage">{{ sources.length ? '请从左侧重新选择连接' : '请稍后重新打开数据源管理' }}</small>
            <button class="primary-button" type="button" :disabled="sourceInteractionLocked" @click="openProtocolPicker"><Plus />新建连接</button>
          </div>
          <fieldset v-else class="source-detail source-api-workbench" data-testid="source-api-workbench" :disabled="sourceInteractionLocked" :aria-busy="sourceInteractionLocked">
            <legend class="visually-hidden">{{ activeWorkbenchCopy.title }}</legend>
            <section class="source-request-pane">
              <header class="workbench-panel-heading">
                <div><b>{{ activeWorkbenchCopy.title }}</b><small>常用连接参数直接编辑，低频与安全参数按需展开</small></div>
                <span v-if="managerView === 'detail'" class="detail-connection-state" :class="effectiveSourceStatus(selectedSource)"><i></i>{{ selectedSource.enabled ? '连接已启用' : '连接已停用' }}</span>
              </header>
              <div class="workbench-panel-body">
                <div class="config-grid create-config-grid basic-config-grid" data-testid="source-basic-config">
                  <label class="config-field">
                    <span>连接名称<em>*</em></span>
                    <input ref="createNameInput" v-model="activeDraft.name" type="text" maxlength="80" placeholder="例如：一号车间设备" required>
                  </label>
                  <div class="config-field">
                    <span>传输方式</span>
                    <output class="readonly-config-value">{{ activeWorkbenchCopy.transport }}</output>
                  </div>
                  <label v-if="primaryTargetKey(activeProtocol)" class="config-field wide">
                    <span>{{ activeConfigFields.find(field => field.key === primaryTargetKey(activeProtocol))?.label || '连接地址' }}<em>*</em></span>
                    <input v-model="activeDraft.config[primaryTargetKey(activeProtocol)]" :placeholder="primaryTargetPlaceholder(activeProtocol)" :inputmode="fieldInputMode({ key: primaryTargetKey(activeProtocol) })" required>
                  </label>
                  <label v-for="field in workbenchFields(activeBasicFields, activeProtocol, 'basic')" :key="field.key" class="config-field" :class="{ wide: field.span === 2 }" :for="fieldControlId(field, 'basic')">
                    <span>{{ field.label }}<em v-if="field.required">*</em></span>
                    <select v-if="field.type === 'select'" :id="fieldControlId(field, 'basic')" v-model="activeDraft.config[field.key]" :required="field.required">
                      <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                    </select>
                    <textarea v-else-if="field.type === 'textarea'" :id="fieldControlId(field, 'basic')" v-model="activeDraft.config[field.key]" :placeholder="field.placeholder" :required="field.required" rows="3"></textarea>
                    <input v-else-if="field.type === 'number'" :id="fieldControlId(field, 'basic')" v-model.number="activeDraft.config[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step || 1" :placeholder="field.placeholder" :required="field.required" inputmode="numeric">
                    <input v-else :id="fieldControlId(field, 'basic')" v-model="activeDraft.config[field.key]" :type="field.type || 'text'" :placeholder="field.placeholder" :required="field.required" :inputmode="fieldInputMode(field)" autocomplete="off">
                    <small v-if="field.help" class="field-help">{{ field.help }}</small>
                  </label>
                </div>

                <button id="source-advanced-config-toggle" class="advanced-config-toggle" type="button" :aria-expanded="activeAdvancedOpen" :aria-controls="activeAdvancedOpen ? 'source-advanced-config' : undefined" @click="activeAdvancedOpen = !activeAdvancedOpen">
                  <SlidersHorizontal /><span><b>高级配置</b><small>认证、安全、超时、重试与连接策略</small></span><ChevronDown :class="{ expanded: activeAdvancedOpen }" />
                </button>
                <section v-if="activeAdvancedOpen" id="source-advanced-config" class="advanced-config-panel" role="region" aria-labelledby="source-advanced-config-toggle" data-testid="source-advanced-config">
                  <div class="advanced-config-note"><AlertCircle /><span>密码、令牌和请求头等敏感信息只用于当前会话测试，不写入图纸文件。</span></div>
                  <div class="config-grid create-config-grid">
                    <label v-for="field in activeAdvancedFields" :key="field.key" class="config-field" :class="{ wide: field.span === 2 }" :for="fieldControlId(field, 'advanced')">
                      <span>{{ field.label }}<em v-if="field.required">*</em></span>
                      <select v-if="field.type === 'select'" :id="fieldControlId(field, 'advanced')" v-model="activeDraft.config[field.key]" :required="field.required">
                        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                      </select>
                      <textarea v-else-if="field.type === 'textarea'" :id="fieldControlId(field, 'advanced')" v-model="activeDraft.config[field.key]" :placeholder="field.placeholder" :required="field.required" rows="3"></textarea>
                      <input v-else-if="field.type === 'number'" :id="fieldControlId(field, 'advanced')" v-model.number="activeDraft.config[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step || 1" :placeholder="field.placeholder" :required="field.required" inputmode="numeric">
                      <input v-else :id="fieldControlId(field, 'advanced')" v-model="activeDraft.config[field.key]" :type="field.type || 'text'" :placeholder="field.placeholder" :required="field.required" :inputmode="fieldInputMode(field)" autocomplete="off">
                      <small v-if="field.help" class="field-help">{{ field.help }}</small>
                    </label>
                    <label class="enabled-row"><span><b>{{ managerView === 'create' ? '创建后启用' : '启用连接' }}</b><small>停用时保留配置，但不参与数据采集</small></span><input v-model="activeDraft.enabled" type="checkbox"><i></i></label>
                  </div>
                </section>
              </div>
            </section>

            <section class="source-response-pane create-response-pane">
              <header class="workbench-panel-heading">
                <div><b>连接状态与采集结果</b><small>测试后展示响应结构和可绑定的 JSON 字段</small></div>
                <span>有界预览，避免大响应阻塞页面</span>
              </header>
              <div class="workbench-panel-body response-panel-body">
                <div class="response-status" :class="{ success: activeTestResult?.ok, error: activeTestResult && !activeTestResult.ok }" aria-live="polite">
                  <span class="response-status-icon"><RefreshCw v-if="testing" class="spin" /><CheckCircle2 v-else-if="activeTestResult?.ok" /><AlertCircle v-else-if="activeTestResult" /><Code2 v-else /></span>
                  <div>
                    <b>{{ testing ? '正在测试连接' : activeTestDisplayMessage }}</b>
                    <small v-if="activeTestResult">{{ formatDate(activeTestResult.at) }} · {{ activeTestResult.durationMs }} ms</small>
                    <small v-else>点击右上角“测试”查看连接状态和数据结构</small>
                    <small v-if="activeTestHint" class="test-context-hint">{{ activeTestHint }}</small>
                    <small v-if="activeTestResult?.previewMessage" class="preview-warning">{{ activeTestResult.previewMessage }}</small>
                  </div>
                </div>
                <div class="response-preview source-response-preview" data-testid="source-response-preview">
                  <div class="response-preview-heading"><span>最近响应数据</span><small>{{ activeOfficialSnapshotAvailable ? '组件可用的正式数据' : (activeTestContext === 'draft' ? '仅预览，尚未用于组件' : (activeTestContext === 'official' ? '正式测试结果，当前不可用于组件' : '仅展示有界预览')) }}</small></div>
                  <code v-if="activeResponseText" tabindex="0" aria-label="响应 JSON 预览">{{ activeResponseText }}</code>
                  <div v-else class="response-empty"><Code2 /><span>{{ activeTestResult && !activeTestResult.ok ? '测试失败，暂无返回数据' : '测试成功后在此显示响应结构' }}</span></div>
                </div>
                <div class="response-points" data-testid="source-response-points">
                  <div class="response-preview-heading"><span>JSON 解析点位</span><small>最多展示 {{ RESPONSE_POINT_ROW_LIMIT }} 项</small></div>
                  <div class="response-points-scroll" tabindex="0" aria-label="JSON 解析点位列表">
                    <table v-if="responsePointRows.length">
                      <thead><tr><th>JSON 路径</th><th>类型</th><th>当前值</th><th>质量</th></tr></thead>
                      <tbody><tr v-for="row in responsePointRows" :key="row.path"><td><code>{{ row.path }}</code></td><td>{{ row.type }}</td><td :title="row.value">{{ row.value }}</td><td class="point-quality" :class="activeTestContext === 'official' ? String(activeResponseSnapshot?.quality || 'unknown').toLowerCase() : 'unknown'">{{ responsePointQualityLabel }}</td></tr></tbody>
                    </table>
                    <div v-else class="response-points-empty">测试成功后展示可绑定的 JSON 字段</div>
                  </div>
                </div>
              </div>
            </section>
          </fieldset>
        </main>
      </div>
    </section>

    <div v-if="protocolPickerOpen" class="dialog-backdrop" data-testid="source-protocol-picker" @pointerdown.self="closeProtocolPicker">
      <form ref="protocolPickerElement" class="protocol-picker" role="dialog" aria-modal="true" aria-labelledby="protocol-picker-title" @submit.prevent="startCreateConnection">
        <header>
          <div><h3 id="protocol-picker-title">选择连接类型</h3><p>选择协议后进入统一的连接配置页面</p></div>
          <button type="button" title="关闭" aria-label="关闭协议选择" @click="closeProtocolPicker"><X /></button>
        </header>
        <div class="protocol-picker-grid" role="radiogroup" aria-label="数据连接协议">
          <button v-for="protocol in CREATE_PROTOCOL_ORDER" :key="protocol" type="button" role="radio" :aria-checked="protocolChoice === protocol" :class="{ active: protocolChoice === protocol }" @click="chooseCreateProtocol(protocol)" @keydown.left.prevent="moveCreateProtocolChoice(-1)" @keydown.up.prevent="moveCreateProtocolChoice(-1)" @keydown.right.prevent="moveCreateProtocolChoice(1)" @keydown.down.prevent="moveCreateProtocolChoice(1)">
            <span class="protocol-mark" :data-protocol="protocol">{{ protocolShortName(protocol) }}</span>
            <b>{{ PROTOCOL_LABELS[protocol] || protocol }}</b>
          </button>
        </div>
        <footer>
          <button class="secondary-button" type="button" @click="closeProtocolPicker">取消</button>
          <button class="primary-button" type="submit">下一步：配置连接<ChevronRight /></button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.data-source-overlay,
.data-source-overlay * {
  box-sizing: border-box;
}

.data-source-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #eef1f3;
  color: #25313a;
  font-family: Inter, "Microsoft YaHei", Arial, sans-serif;
}

button,
input,
select,
textarea {
  font: inherit;
}

.visually-hidden {
  width: 1px;
  height: 1px;
  position: absolute;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.manager-shell {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: 60px minmax(0, 1fr);
  background: #fff;
}

.manager-header {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 0 18px;
  border-bottom: 1px solid #dfe4e7;
  background: #fff;
}

.manager-title {
  min-width: 0;
  max-width: min(360px, 34vw);
  display: flex;
  align-items: center;
  gap: 10px;
}

.manager-title-copy {
  min-width: 0;
}

.title-icon,
.source-heading-icon {
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 5px;
}

.title-icon {
  width: 34px;
  height: 34px;
  background: #e9f7f4;
  color: #0b927a;
}

.title-icon svg {
  width: 19px;
}

.manager-title-copy h2 {
  margin: 0;
  font-size: 16px;
  line-height: 20px;
}

.manager-title-copy > span {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: #89949b;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-title-copy > span b {
  color: #53636d;
  font-weight: 600;
}

.manager-summary {
  height: 34px;
  margin-left: auto;
  display: flex;
  border: 1px solid #e1e6e8;
  background: #fafbfb;
}

.manager-summary span {
  min-width: 95px;
  padding: 0 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-left: 1px solid #e1e6e8;
  color: #758087;
  font-size: 12px;
  white-space: nowrap;
}

.manager-summary span:first-child {
  border-left: 0;
}

.manager-summary b {
  color: #27343d;
}

.manager-summary .warning b {
  color: #c15d3c;
}

.icon-button,
.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid;
  background: #fff;
  cursor: pointer;
}

.icon-button {
  width: 34px;
  height: 34px;
  border-color: #dce2e5;
  color: #4f5d66;
}

.icon-button:hover {
  border-color: #13a98f;
  color: #0b8d76;
}

.icon-button:disabled,
.primary-button:disabled,
.secondary-button:disabled {
  opacity: .5;
  cursor: default;
}

.icon-button svg {
  width: 17px;
}

.icon-button.manager-close {
  flex: none;
  background: #f4f6f7;
}

.icon-button.manager-close:hover {
  border-color: #168eea;
  background: #f1f8fe;
  color: #1479c4;
}

.primary-button,
.secondary-button {
  height: 34px;
  padding: 0 14px;
  gap: 7px;
  white-space: nowrap;
}

.primary-button {
  border-color: #129b82;
  background: #129b82;
  color: #fff;
}

.primary-button:hover {
  border-color: #0c876f;
  background: #0c876f;
}

.secondary-button {
  border-color: #d8dfe3;
  color: #42515a;
}

.secondary-button:hover {
  border-color: #12a087;
  color: #0b8d76;
}

.primary-button svg,
.secondary-button svg {
  width: 16px;
}

.manager-workbench {
  min-height: 0;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
}

.source-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid #dfe4e7;
  background: #f7f9fa;
}

.sidebar-primary-actions {
  margin: 8px 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  gap: 7px;
  flex: none;
}

.sidebar-search-button,
.sidebar-create-button {
  height: 36px;
  min-height: 36px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #129b82;
  background: #129b82;
  color: #fff;
  cursor: pointer;
  flex: none;
  font-weight: 600;
}

.sidebar-create-button {
  min-height: 44px;
  margin: 12px 12px 0;
  gap: 9px;
}

.sidebar-create-button span {
  font-size: 12px;
}

.sidebar-search-button {
  border: 1px solid #ccd8dc;
  background: #fff;
  color: #53656e;
}

.sidebar-search-button:hover {
  border-color: #129b82;
  color: #087461;
}

.sidebar-create-button:hover {
  border-color: #0c876f;
  background: #0c876f;
}

.sidebar-create-button:disabled {
  opacity: .55;
  cursor: wait;
}

.sidebar-create-button svg,
.sidebar-search-button svg {
  width: 16px;
}

.sidebar-search {
  height: 36px;
  min-height: 36px;
  margin: 0;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #dbe1e4;
  background: #fff;
  flex: none;
}

.sidebar-search:focus-within {
  border-color: #18a48c;
  box-shadow: 0 0 0 2px #18a48c19;
}

.sidebar-search svg {
  width: 16px;
  color: #87939a;
}

.sidebar-search input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #29363e;
}

.source-filter-bar {
  height: 34px;
  min-height: 34px;
  margin: 0 12px 4px;
  padding-left: 9px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #dbe1e4;
  background: #fff;
  flex: none;
}

.source-filter-bar:focus-within {
  border-color: #18a48c;
  box-shadow: 0 0 0 2px #18a48c19;
}

.source-filter-bar > svg {
  width: 15px;
  flex: none;
  color: #7d8990;
}

.source-filter-bar select {
  min-width: 0;
  height: 100%;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #3e4d56;
  font-size: 11px;
}

.source-filter-bar #source-status-filter {
  max-width: 72px;
  flex: 0 1 72px;
}

.source-filter-bar > i {
  width: 1px;
  height: 16px;
  background: #e1e6e8;
  flex: none;
}

.source-filter-bar button {
  width: 30px;
  height: 100%;
  display: grid;
  place-items: center;
  flex: none;
  border: 0;
  border-left: 1px solid #e1e6e8;
  background: #fafbfb;
  color: #69777f;
  cursor: pointer;
}

.source-filter-bar button:hover {
  background: #eef7f5;
  color: #087461;
}

.source-filter-bar button svg {
  width: 13px;
}

.sidebar-caption {
  height: 28px;
  min-height: 28px;
  margin: 0 12px;
  padding: 0 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #5f6d75;
  flex: none;
  font-size: 11px;
}

.sidebar-caption b {
  font-weight: 500;
}

.filtered-selection-notice {
  margin: 0 8px 7px;
  padding: 7px 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #ecd6a7;
  background: #fff9ec;
  color: #77571e;
  flex: none;
  font-size: 10px;
}

.filtered-selection-notice span {
  min-width: 0;
  flex: 1;
}

.filtered-selection-notice button,
.empty-sidebar button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #087461;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.source-list {
  min-height: 0;
  margin: 0 12px 12px;
  flex: 1 1 auto;
  overflow: auto;
  border: 1px solid #e2e7e9;
  background: #fff;
}

.source-overview-entry {
  width: 100%;
  min-height: 60px;
  padding: 9px 12px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 0;
  border-bottom: 1px solid #e2e7e9;
  border-left: 3px solid transparent;
  background: #fff;
  color: #33424b;
  text-align: left;
  cursor: pointer;
}

.source-overview-entry:hover,
.source-overview-entry.active {
  border-left-color: #129b82;
  background: #eaf6f3;
}

.source-overview-entry:disabled {
  cursor: wait;
  opacity: .6;
}

.overview-entry-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: #def1ed;
  color: #0c8b73;
}

.overview-entry-icon svg {
  width: 17px;
}

.source-overview-entry > span:nth-child(2) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.source-overview-entry b {
  font-size: 12px;
}

.source-overview-entry small {
  overflow: hidden;
  color: #77848b;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-overview-entry strong {
  min-width: 24px;
  padding: 2px 6px;
  border-radius: 3px;
  background: #fff;
  color: #617078;
  font-size: 9px;
  text-align: center;
}

.source-group-heading {
  width: 100%;
  height: 36px;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #e2e7e9;
  background: #eef2f3;
  color: #52616a;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
}

.source-group-heading > button {
  width: 100%;
  height: 100%;
  padding: 0 13px 0 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.source-group-heading > button:hover {
  background: #e7edee;
  color: #25343c;
}

.source-group-heading > button > svg {
  width: 13px;
  flex: none;
  transition: transform .15s ease;
}

.source-group-heading > button > svg.expanded {
  transform: rotate(90deg);
}

.source-group-heading .protocol-mark.compact {
  width: 34px;
  height: 22px;
  border-radius: 3px;
  font-size: 8px;
}

.source-group-heading b {
  min-width: 22px;
  margin-left: auto;
  padding: 1px 5px;
  border-radius: 3px;
  background: #fff;
  color: #67757d;
  font-size: 9px;
  text-align: center;
}

.source-group-pager {
  height: 36px;
  padding: 0 9px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #e2e7e9;
  background: #f8fafb;
}

.source-group-pager span {
  color: #74828a;
  font-size: 10px;
}

.source-group-pager button {
  height: 24px;
  border: 1px solid #d5dde1;
  background: #fff;
  color: #52636c;
  cursor: pointer;
  font-size: 10px;
}

.source-group-pager button:last-child {
  justify-self: stretch;
}

.source-group-pager button:disabled {
  opacity: .45;
  cursor: default;
}

.source-item {
  width: 100%;
  height: 56px;
  padding-right: 7px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 62px;
  align-items: center;
  gap: 2px;
  border-left: 3px solid transparent;
  border-bottom: 1px solid #e5e9eb;
  color: #2f3c45;
}

.source-item:hover {
  background: #f0f5f4;
}

.source-item.active {
  border-left-color: #10a088;
  background: #e8f6f3;
}

.source-item.selecting {
  background: #eef6f5;
}

.source-item-select {
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0 5px 0 25px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 55px;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.source-item-select:focus-visible {
  outline: 2px solid #12a087;
  outline-offset: -2px;
}

.source-item-select:disabled {
  cursor: wait;
}

.protocol-mark {
  width: 42px;
  height: 30px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid #cbd5da;
  border-radius: 4px;
  background: #fff;
  color: #53656f;
  font-size: 9px;
  font-weight: 700;
}

.protocol-mark[data-protocol="MQTT"] {
  border-color: #9ed5ca;
  background: #f1fbf8;
  color: #087763;
}

.protocol-mark[data-protocol="HTTP"] {
  border-color: #afcde6;
  background: #f3f8fc;
  color: #28648f;
}

.protocol-mark[data-protocol="WebSocket"] {
  border-color: #b8c0e6;
  background: #f5f6fc;
  color: #4c5fa0;
}

.protocol-mark[data-protocol="Socket"] {
  border-color: #d9c08f;
  background: #fcf8ef;
  color: #815f1d;
}

.protocol-mark[data-protocol="MySQL"] {
  border-color: #a9d2d0;
  background: #f1f9f8;
  color: #246f6d;
}

.protocol-mark[data-protocol="SQL Server"] {
  border-color: #c6bae0;
  background: #f8f5fc;
  color: #66508e;
}

.protocol-mark[data-protocol="Redis"] {
  border-color: #e0b7b2;
  background: #fcf5f4;
  color: #944a43;
}

.source-item-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.source-item-copy b,
.source-item-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-item-copy b {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.source-item-copy b em {
  padding: 1px 4px;
  flex: none;
  border: 1px solid #cbd7d4;
  border-radius: 3px;
  background: #f8fbfa;
  color: #71807a;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}

.source-item-copy small {
  color: #5f6d75;
  font-size: 10px;
}

.source-item-status {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  color: #68767e;
  font-size: 10px;
  white-space: nowrap;
}

.source-item-status i {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #929da3;
}

.source-item-status.online {
  color: #087461;
}

.source-item-status.online i {
  background: #0b987a;
}

.source-item-status.testing {
  color: #8b5d13;
}

.source-item-status.testing i {
  background: #c4841e;
}

.source-item-status.offline,
.source-item-status.disabled,
.source-item-status.unknown {
  color: #66747c;
}

.source-item-status.offline i,
.source-item-status.disabled i,
.source-item-status.unknown i {
  background: #7f8b92;
}

.source-item-status.error {
  color: #ad4139;
}

.source-item-status.error i {
  background: #d85d51;
}

.source-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.source-item-manage {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  background: transparent;
  color: #77858d;
  cursor: pointer;
}

.source-item-manage svg {
  width: 14px;
}

.source-item:hover .source-item-manage,
.source-item.active .source-item-manage {
  border-color: #cedbd8;
  background: #fff;
  color: #0b8d76;
}

.source-item-manage:hover,
.source-item-manage:focus-visible {
  border-color: #12a087;
  background: #effaf7;
  color: #0b8d76;
  outline: none;
}

.source-item-manage:disabled {
  opacity: .45;
  cursor: default;
}

.source-item-delete {
  color: #a94a43;
}

.source-item-delete:hover,
.source-item-delete:focus-visible {
  border-color: #d48a83;
  background: #fff5f3;
  color: #9f3e37;
}

.empty-sidebar {
  padding: 25px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #66747c;
  font-size: 12px;
  text-align: center;
}

.source-main {
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.loading-state,
.empty-main {
  min-height: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #7c878e;
}

.loading-state svg,
.empty-main > svg {
  width: 22px;
}

.empty-main {
  flex-direction: column;
}

.empty-main small {
  color: #8a969d;
  font-size: 12px;
}

.source-heading {
  min-width: 0;
  height: 76px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e7e9;
}

.detail-back-button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: none;
  border: 1px solid #dbe2e5;
  background: #fff;
  color: #5d6b73;
  cursor: pointer;
}

.detail-back-button:hover {
  border-color: #129b82;
  color: #087461;
}

.detail-back-button:disabled {
  opacity: .5;
  cursor: wait;
}

.detail-back-button svg {
  width: 16px;
}

.source-overview {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  background: #f7f9fa;
}

.overview-toolbar {
  padding: 14px 18px 10px;
  border-bottom: 1px solid #e0e6e8;
  background: #fff;
}

.overview-heading-copy {
  margin-bottom: 12px;
}

.overview-heading-copy h3 {
  margin: 0;
  color: #26353d;
  font-size: 13px;
}

.overview-heading-copy small {
  display: block;
  margin-top: 4px;
  color: #829097;
  font-size: 10px;
}

.overview-search {
  min-width: 0;
  display: grid;
  grid-template-columns: 20px minmax(180px, 1fr) 125px 125px 88px;
  align-items: center;
  gap: 0;
  border: 1px solid #d6dfe2;
  background: #fff;
}

.overview-search > svg {
  width: 15px;
  margin-left: 10px;
  color: #849198;
}

.overview-search input,
.overview-search select {
  min-width: 0;
  height: 38px;
  border: 0;
  border-left: 1px solid #e0e6e8;
  border-radius: 0;
  outline: 0;
  background: #fff;
  color: #35444d;
  font-size: 11px;
}

.overview-search input {
  padding: 0 10px;
  border-left: 0;
}

.overview-search select {
  padding: 0 9px;
}

.overview-search:focus-within {
  border-color: #129b82;
  box-shadow: 0 0 0 2px #129b8218;
}

.overview-search-button {
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  background: #129b82;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}

.overview-search-button:hover {
  background: #0c876f;
}

.overview-search-button svg {
  width: 14px;
}

.overview-result-line {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  color: #87939a;
  font-size: 9px;
}

.overview-table-scroll {
  min-width: 0;
  min-height: 0;
  margin: 12px 18px 0;
  overflow: auto;
  border: 1px solid #dfe5e7;
  background: #fff;
}

.overview-table {
  width: 100%;
  min-width: 1120px;
  border-collapse: collapse;
  table-layout: fixed;
}

.overview-table th {
  height: 38px;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0 10px;
  border-bottom: 1px solid #dde4e7;
  background: #f2f5f6;
  color: #65747c;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
}

.overview-table td {
  height: 56px;
  padding: 0 10px;
  border-bottom: 1px solid #e7ebed;
  color: #42515a;
  font-size: 10px;
  vertical-align: middle;
}

.overview-table tbody tr:hover {
  background: #f3f8f7;
}

.overview-table th:nth-child(1) { width: 74px; }
.overview-table th:nth-child(2) { width: 170px; }
.overview-table th:nth-child(3) { width: 24%; }
.overview-table th:nth-child(4) { width: 86px; }
.overview-table th:nth-child(5) { width: 82px; }
.overview-table th:nth-child(6) { width: 72px; }
.overview-table th:nth-child(7) { width: 82px; }
.overview-table th:nth-child(8) { width: 118px; }
.overview-table th:nth-child(9) { width: 176px; }

.overview-protocol {
  width: 42px;
  height: 28px;
}

.overview-source-name {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overview-source-name b,
.overview-source-name small,
.overview-table td code,
.overview-response-time {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-source-name b {
  color: #2c3b44;
  font-size: 11px;
}

.overview-source-name small {
  color: #87939a;
  font-size: 9px;
}

.overview-source-name em {
  margin-left: 5px;
  color: #668079;
  font-style: normal;
}

.overview-table td code {
  color: #5f7079;
  font: 9px/1.4 Consolas, "Courier New", monospace;
}

.overview-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.overview-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #89959b;
}

.overview-status.online { color: #087461; }
.overview-status.online i { background: #0b987a; box-shadow: 0 0 0 3px #0b987a17; }
.overview-status.testing { color: #8b5d13; }
.overview-status.testing i { background: #c4841e; }
.overview-status.error { color: #ad4139; }
.overview-status.error i { background: #d85d51; }

.overview-response-time {
  color: #697880;
}

.enabled-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #8a6460;
  white-space: nowrap;
}

.enabled-state::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #bd756c;
}

.enabled-state.enabled { color: #087461; }
.enabled-state.enabled::before { background: #0b987a; }

.overview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.source-enable-toggle {
  width: 74px;
  min-width: 74px;
  height: 30px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  border: 1px solid #ccd8dc;
  background: #fff;
  color: #087461;
  cursor: pointer;
  white-space: nowrap;
}

.source-enable-toggle span {
  width: 18px;
  height: 10px;
  position: relative;
  flex: none;
  border-radius: 5px;
  background: #aeb9bd;
}

.source-enable-toggle span::after {
  content: "";
  width: 6px;
  height: 6px;
  position: absolute;
  top: 2px;
  left: 2px;
  border-radius: 50%;
  background: #fff;
}

.source-enable-toggle.enabled span { background: #129b82; }
.source-enable-toggle.enabled span::after { left: 10px; }
.source-enable-toggle:focus-visible {
  outline: 2px solid #129b82;
  outline-offset: 2px;
}
.source-enable-toggle:disabled { opacity: .5; cursor: not-allowed; }

.inspect-source-button {
  height: 30px;
  padding: 0 12px;
  border: 1px solid #ccd8dc;
  background: #fff;
  color: #49606a;
  cursor: pointer;
  white-space: nowrap;
}

.inspect-source-button:hover {
  border-color: #129b82;
  color: #087461;
}

.inspect-source-button:disabled {
  opacity: .5;
  cursor: wait;
}

.overview-pager {
  height: 48px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e1e6e8;
  background: #fff;
}

.overview-pager button {
  height: 28px;
  padding: 0 11px;
  border: 1px solid #d4dde0;
  background: #fff;
  color: #53646d;
  cursor: pointer;
  font-size: 10px;
}

.overview-pager button:disabled {
  opacity: .45;
  cursor: default;
}

.overview-pager span {
  color: #74828a;
  font-size: 10px;
}

.overview-empty {
  min-height: 0;
  margin: 12px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #dfe5e7;
  background: #fff;
  color: #7b878e;
}

.overview-empty svg {
  width: 24px;
}

.overview-empty small {
  font-size: 10px;
}

.overview-empty button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #087461;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.overview-empty button svg {
  width: 14px;
}

.source-heading-icon {
  width: 40px;
  height: 40px;
  background: #eff4f6;
  color: #53636d;
}

.source-heading-icon svg {
  width: 21px;
}

.source-heading-copy {
  min-width: 0;
  flex: 1;
}

.source-heading-copy > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-heading-copy h3 {
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-heading-copy small {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: #849097;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.protocol-label {
  padding: 2px 5px;
  border: 1px solid #cbd8dd;
  border-radius: 3px;
  background: #f7fafb;
  color: #5a6a73;
  font-size: 9px;
  font-weight: 700;
}

.health-label {
  margin-left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6d7980;
  font-size: 11px;
  white-space: nowrap;
}

.health-label i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #98a3a9;
}

.health-label.online {
  color: #11826d;
}

.health-label.online i {
  background: #10a17e;
}

.health-label.testing {
  color: #a66c13;
}

.health-label.testing i {
  background: #d59a2f;
}

.health-label.error {
  color: #b74840;
}

.health-label.error i {
  background: #d85d51;
}

.heading-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.heading-actions button {
  min-width: 82px;
}

.notice-area {
  min-height: 0;
}

.notice-area.floating {
  width: min(460px, calc(100% - 36px));
  position: absolute;
  top: 10px;
  right: 18px;
  z-index: 5;
  pointer-events: none;
}

.notice {
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid;
  box-shadow: 0 8px 20px #27343d1f;
  font-size: 12px;
  pointer-events: auto;
}

.notice svg {
  width: 16px;
  flex: none;
}

.notice button {
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.notice button svg {
  width: 14px;
}

.notice.error {
  border-color: #f1d5d0;
  background: #fff5f3;
  color: #a84138;
}

.notice.success {
  border-color: #cde9e2;
  background: #eef9f6;
  color: #0e7e69;
}

.source-detail {
  min-height: 0;
  min-width: 0;
  flex: 1;
  margin: 0;
  border: 0;
  overflow: auto;
}

.source-api-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding: 10px;
  overflow: hidden;
  background: #f3f6f7;
}

.source-request-pane,
.source-response-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #dce3e6;
  border-radius: 4px;
  background: #fff;
}

.source-response-pane {
  background: #fff;
}

.workbench-panel-heading {
  height: 58px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex: none;
  border-bottom: 1px solid #dce3e6;
  background: #f6f8f9;
}

.workbench-panel-heading > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workbench-panel-heading b {
  color: #26353d;
  font-size: 12px;
}

.workbench-panel-heading small,
.workbench-panel-heading > span {
  color: #869299;
  font-size: 10px;
  line-height: 1.3;
}

.workbench-panel-heading > span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workbench-panel-body {
  min-height: 0;
  padding: 14px;
  overflow: auto;
}

.basic-config-grid {
  align-content: start;
}

.readonly-config-value {
  min-height: 34px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid #d7dfe2;
  border-radius: 3px;
  background: #f4f7f8;
  color: #40515a !important;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-help {
  color: #8a969d;
  font-size: 10px;
  line-height: 1.45;
  text-wrap: pretty;
}

.advanced-config-toggle {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  padding: 7px 12px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  border: 1px solid #d7e0e3;
  border-radius: 3px;
  background: #f8fafb;
  color: #34454e;
  cursor: pointer;
  text-align: left;
  transition: border-color .15s ease, background-color .15s ease;
}

.advanced-config-toggle:hover {
  border-color: #9fcfc4;
  background: #f1f8f6;
}

.advanced-config-toggle:focus-visible {
  border-color: #12a087;
  outline: 2px solid #12a0872b;
  outline-offset: 1px;
}

.advanced-config-toggle > svg {
  width: 16px;
  height: 16px;
  color: #60717a;
}

.advanced-config-toggle > span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.advanced-config-toggle b {
  font-size: 11px;
  font-weight: 600;
}

.advanced-config-toggle small {
  overflow: hidden;
  color: #89959c;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.advanced-config-toggle > svg:last-child {
  color: #77868e;
  transition: transform .15s ease;
}

.advanced-config-toggle > svg:last-child.expanded {
  transform: rotate(180deg);
}

.advanced-config-toggle[aria-expanded="true"] {
  border-radius: 3px 3px 0 0;
}

.advanced-config-panel {
  padding: 14px;
  border: 1px solid #d7e0e3;
  border-top: 0;
  border-radius: 0 0 3px 3px;
  background: #fbfcfc;
}

.advanced-config-note {
  min-height: 36px;
  margin-bottom: 13px;
  padding: 7px 9px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-left: 3px solid #d5a752;
  background: #fff9ed;
  color: #76613a;
  font-size: 10px;
  line-height: 1.45;
}

.advanced-config-note svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.response-panel-body {
  display: flex;
  flex-direction: column;
}

.detail-connection-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: #68767e;
  font-size: 9px;
  white-space: nowrap;
}

.detail-connection-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #87939a;
}

.detail-connection-state.online {
  color: #087461;
}

.detail-connection-state.online i {
  background: #0b987a;
}

.detail-connection-state.error {
  color: #ad4139;
}

.detail-connection-state.error i {
  background: #d85d51;
}

.source-response-preview {
  height: clamp(190px, 30vh, 320px);
  min-height: 190px;
}

.response-preview.source-response-preview > code {
  background: #1f2d35;
  color: #f0faf7;
  font-size: 11px;
}

.response-points {
  min-height: 0;
  margin-top: 12px;
  border: 1px solid #dce3e6;
  background: #fff;
}

.response-points-scroll {
  max-height: 250px;
  overflow: auto;
}

.response-points-scroll:focus-visible {
  outline: 2px solid #12a087;
  outline-offset: -2px;
}

.response-points table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.response-points th,
.response-points td {
  height: 34px;
  padding: 0 9px;
  overflow: hidden;
  border-bottom: 1px solid #e5eaec;
  color: #4d5e67;
  font-size: 10px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.response-points th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f3f6f7;
  color: #69777f;
  font-weight: 600;
}

.response-points th:nth-child(1) { width: 42%; }
.response-points th:nth-child(2) { width: 14%; }
.response-points th:nth-child(3) { width: 30%; }
.response-points th:nth-child(4) { width: 14%; }
.response-points td code { color: #246455; font: 10px/1.4 Consolas, "Courier New", monospace; }
.point-quality.good { color: #087461 !important; }
.point-quality.bad,
.point-quality.error,
.point-quality.offline { color: #b74840 !important; }
.point-quality.unknown { color: #75828a !important; }
.response-points-empty { padding: 24px 12px; color: #8c989e; font-size: 10px; text-align: center; }

.response-preview > code:focus-visible {
  outline: 2px solid #12a087;
  outline-offset: -2px;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 13px 18px;
}

.config-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-field.wide {
  grid-column: 1 / -1;
}

.config-field > span {
  color: #68757d;
  font-size: 11px;
}

.config-field em {
  margin-left: 3px;
  color: #cf5047;
  font-style: normal;
}

.config-field input,
.config-field select,
.config-field textarea {
  width: 100%;
  padding: 0 10px;
  border: 1px solid #d7dfe2;
  border-radius: 3px;
  outline: 0;
  background: #fff;
  color: #28353d;
}

.config-field input,
.config-field select {
  height: 34px;
}

.config-field textarea {
  min-height: 72px;
  padding-top: 8px;
  resize: vertical;
  line-height: 1.45;
}

.config-field input:focus,
.config-field select:focus,
.config-field textarea:focus {
  border-color: #12a087;
  box-shadow: 0 0 0 2px #12a08718;
}

.config-field input:disabled {
  background: #f2f4f5;
  color: #77838a;
}

.enabled-row {
  grid-column: 1 / -1;
  min-height: 44px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e0e5e7;
  cursor: pointer;
}

.enabled-row > span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.enabled-row b {
  font-size: 11px;
}

.enabled-row small {
  color: #8a959b;
  font-size: 10px;
}

.enabled-row input {
  width: 1px;
  height: 1px;
  position: absolute;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
}

.enabled-row:focus-within {
  border-color: #12a087;
  box-shadow: 0 0 0 2px #12a08718;
}

.enabled-row i {
  width: 34px;
  height: 18px;
  position: relative;
  border-radius: 9px;
  background: #b9c2c7;
}

.enabled-row i::after {
  content: "";
  width: 14px;
  height: 14px;
  position: absolute;
  top: 2px;
  left: 2px;
  border-radius: 50%;
  background: #fff;
  transition: left .15s;
}

.enabled-row input:checked + i {
  background: #12a087;
}

.enabled-row input:checked + i::after {
  left: 18px;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2;
  padding: 18px;
  display: grid;
  place-items: center;
  background: #1d2b3366;
}

.protocol-picker {
  width: min(760px, 100%);
  max-height: calc(100vh - 36px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 16px 48px #17252e3d;
}

.protocol-picker header {
  min-height: 62px;
  padding: 10px 18px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e2e7e9;
}

.protocol-picker header > div {
  min-width: 0;
}

.protocol-picker h3 {
  margin: 0;
  font-size: 15px;
}

.protocol-picker header p {
  margin: 4px 0 0;
  color: #7b878e;
  font-size: 10px;
}

.protocol-picker header button {
  width: 30px;
  height: 30px;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: #69767e;
  cursor: pointer;
}

.protocol-picker header svg {
  width: 16px;
}

.protocol-picker-grid {
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  overflow: auto;
}

.protocol-picker-grid > button {
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid #d7e0e3;
  background: #fff;
  color: #35454e;
  cursor: pointer;
}

.protocol-picker-grid > button:hover,
.protocol-picker-grid > button.active {
  border-color: #129b82;
  background: #edf9f6;
  color: #087461;
}

.protocol-picker-grid .protocol-mark {
  width: 54px;
  height: 28px;
}

.protocol-picker-grid b {
  font-size: 12px;
}

.create-response-pane {
  background: #fff;
}

.create-config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.response-status {
  min-height: 58px;
  padding: 9px 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #dce3e6;
  background: #fff;
}

.response-status.success {
  border-color: #badfd6;
  background: #f2faf8;
}

.response-status.error {
  border-color: #ecc8c3;
  background: #fff5f3;
}

.response-status-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: none;
  color: #78868d;
}

.response-status.success .response-status-icon {
  color: #0c8b72;
}

.response-status.error .response-status-icon {
  color: #b74840;
}

.response-status-icon svg {
  width: 18px;
}

.response-status > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.response-status b {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.response-status small {
  color: #7e8b92;
  font-size: 9px;
}

.response-status .preview-warning {
  color: #a26825;
}

.response-status .test-context-hint {
  color: #4f666f;
}

.response-preview {
  height: 300px;
  margin-top: 12px;
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid #dce3e6;
  background: #fff;
}

.response-preview-heading {
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid #e4e9eb;
  background: #f6f8f9;
  color: #56656d;
  font-size: 10px;
}

.response-preview-heading small {
  color: #9a6a28;
  font-size: 8px;
}

.response-preview > code {
  min-width: 0;
  overflow: auto;
  padding: 11px;
  color: #30444f;
  font: 10px/1.6 Consolas, "Courier New", monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.response-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #95a0a6;
  font-size: 10px;
}

.response-empty svg {
  width: 24px;
}

.protocol-picker footer {
  min-height: 60px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid #e2e7e9;
  background: #fff;
}

.protocol-picker footer button {
  min-width: 92px;
}

.protocol-picker footer .primary-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.protocol-picker footer svg {
  width: 14px;
}

.spin {
  animation: manager-spin .8s linear infinite;
}

@keyframes manager-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }

  .enabled-row i::after,
  .advanced-config-toggle,
  .advanced-config-toggle > svg:last-child {
    transition: none;
  }
}

@media (max-width: 1200px) and (min-width: 901px) {
  .manager-workbench {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .source-api-workbench {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .source-response-pane .workbench-panel-heading > span {
    display: none;
  }
}

@media (max-width: 1200px) and (min-width: 761px) {
  .source-item-select {
    grid-template-columns: 44px minmax(0, 1fr) 16px;
  }

  .source-item-status > span {
    display: none;
  }
}

@media (max-width: 900px) {
  .manager-summary span:nth-child(3) {
    display: none;
  }

  .manager-workbench {
    grid-template-columns: 288px minmax(0, 1fr);
  }

  .source-heading {
    padding: 0 14px;
  }

  .source-heading-icon,
  .health-label {
    display: none;
  }

  .overview-toolbar {
    padding-right: 12px;
    padding-left: 12px;
  }

  .overview-search {
    grid-template-columns: repeat(2, minmax(0, 1fr)) 88px;
  }

  .overview-search > svg {
    display: none;
  }

  .overview-search input {
    grid-column: 1 / -1;
    border-bottom: 1px solid #e0e6e8;
  }

  .overview-search select {
    border-left: 0;
    border-right: 1px solid #e0e6e8;
  }

  .overview-table-scroll {
    margin-right: 12px;
    margin-left: 12px;
  }

  .source-api-workbench {
    grid-template-columns: 1fr;
    grid-auto-rows: max-content;
    align-content: start;
    overflow: auto;
  }

  .source-request-pane,
  .source-response-pane {
    min-height: auto;
    overflow: visible;
  }

  .workbench-panel-body {
    overflow: visible;
  }

  .response-preview {
    height: 240px;
  }
}

@media (max-width: 760px) {
  .manager-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: clamp(250px, 42vh, 340px) minmax(420px, 1fr);
    overflow-y: auto;
  }

  .source-sidebar {
    min-height: 250px;
    border-right: 0;
    border-bottom: 1px solid #dfe4e7;
  }

  .source-main {
    min-height: 420px;
  }
}

@media (max-width: 680px) {
  .manager-header {
    gap: 8px;
    padding: 0 10px;
  }

  .manager-title {
    min-width: 0;
  }

  .manager-title span,
  .manager-summary {
    display: none;
  }

  .manager-close {
    margin-left: auto;
  }

  .manager-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: clamp(250px, 44vh, 360px) minmax(420px, 1fr);
    overflow-y: auto;
  }

  .source-sidebar {
    min-height: 250px;
    border-right: 0;
    border-bottom: 1px solid #dfe4e7;
  }

  .source-main {
    min-height: 420px;
  }

  .sidebar-create-button {
    margin: 8px 8px 0;
  }

  .source-filter-bar {
    margin-right: 8px;
    margin-left: 8px;
  }

  .sidebar-primary-actions {
    margin-right: 8px;
    margin-left: 8px;
  }

  .sidebar-caption {
    margin-right: 8px;
    margin-left: 8px;
  }

  .source-list {
    margin-right: 8px;
    margin-bottom: 8px;
    margin-left: 8px;
  }

  .source-item {
    grid-template-columns: minmax(0, 1fr) 62px;
    padding-right: 7px;
  }

  .source-item-select {
    grid-template-columns: 44px minmax(0, 1fr) 55px;
    gap: 9px;
    padding-left: 25px;
  }

  .protocol-mark {
    width: 42px;
  }

  .source-heading-icon,
  .health-label {
    display: none;
  }

  .source-heading {
    height: auto;
    min-height: 70px;
    padding: 9px 10px;
    flex-wrap: wrap;
  }

  .source-heading-copy {
    flex: 1;
  }

  .heading-actions {
    width: 100%;
    margin: 0;
  }

  .heading-actions button {
    flex: 1;
  }

  .detail-back-button {
    align-self: flex-start;
  }

  .source-overview {
    min-height: 420px;
  }

  .overview-toolbar {
    padding: 10px 8px 8px;
  }

  .overview-heading-copy small,
  .overview-result-line span:last-child {
    display: none;
  }

  .overview-search {
    grid-template-columns: repeat(2, minmax(0, 1fr)) 78px;
  }

  .overview-search-button {
    font-size: 10px;
  }

  .overview-table-scroll {
    margin: 8px 8px 0;
  }

  .notice-area.floating {
    width: calc(100% - 16px);
    top: 8px;
    right: 8px;
  }

  .overview-pager {
    padding: 0 8px;
  }

  .config-grid {
    grid-template-columns: 1fr;
  }

  .config-field.wide,
  .enabled-row {
    grid-column: 1;
  }

  .dialog-backdrop {
    padding: 8px;
  }

  .protocol-picker {
    max-height: calc(100vh - 16px);
  }

  .protocol-picker header {
    padding-right: 12px;
    padding-left: 12px;
  }

  .protocol-picker-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 12px;
  }

  .create-config-grid {
    grid-template-columns: 1fr;
  }

  .create-config-grid .wide,
  .create-config-grid .enabled-row {
    grid-column: 1;
  }

  .advanced-config-toggle {
    grid-template-columns: 18px minmax(0, 1fr) 16px;
  }

  .advanced-config-toggle small {
    white-space: normal;
  }

  .protocol-picker footer {
    padding: 10px 12px;
  }

  .protocol-picker footer button {
    min-width: 0;
    padding: 0 9px;
    flex: 1;
  }
}
</style>
