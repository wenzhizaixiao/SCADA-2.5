<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  Columns3,
  Database,
  Link2,
  Lock,
  Palette,
  Percent,
  RefreshCw,
  Rows3,
  Search,
  SlidersHorizontal,
  TableProperties,
  Timer,
  ToggleLeft,
  Type,
  Unlink,
  X
} from 'lucide-vue-next'
import JsonPathTree from './JsonPathTree.vue'
import { formatRuntimeValue } from '../utils/runtimeValueFormat.js'
import { isUsableSourceSnapshot } from '../utils/sourceSnapshotValidation.js'
import { createSourceConnectionListModel } from '../utils/sourceConnectionList.js'
import {
  directBindingCompatibility,
  parameterDataFormatGuide,
  parameterValueTypeLabel
} from '../utils/dataBindingCompatibility.js'
import {
  canonicalizeJsonPath,
  evaluateJsonPath,
  jsonValueType
} from '../utils/jsonPathBinding.js'

const SOURCE_PICKER_PAGE_SIZE = 60
const SOURCE_PROTOCOL_ORDER = Object.freeze([
  'MQTT', 'HTTP', 'MySQL', 'SQL Server', 'Redis', 'Socket', 'WebSocket'
])

const props = defineProps({
  node: { type: Object, default: null },
  parameters: { type: Array, default: () => [] },
  gateway: { type: Object, default: null },
  sourceRevision: { type: Number, default: 0 },
  locked: { type: Boolean, default: false }
})

const emit = defineEmits({
  bind: payload => Boolean(payload?.target && payload?.sourceId && payload?.jsonPath),
  unbind: payload => Boolean(payload?.target)
})

const activeTarget = ref('')
const sources = shallowRef([])
const sourcesLoading = ref(false)
const sourcesLoaded = ref(false)
const sourcesError = ref('')
const sourceQuery = ref('')
const sourceProtocolFilter = ref('all')
const selectedSourceId = ref('')
const snapshot = shallowRef(null)
const snapshotLoading = ref(false)
const snapshotError = ref('')
const pathDraft = ref('$')
const normalizedPath = ref('')
const pathError = ref('')
const previewValue = shallowRef(undefined)
const previewValueType = ref('unknown')
const compatibility = shallowRef(null)
const activeFormatExampleId = ref('')
const panelElement = ref(null)
const sourcePickerOpen = ref(false)
const sourcePickerVisibleLimit = ref(SOURCE_PICKER_PAGE_SIZE)
const sourcePickerElement = ref(null)
const sourcePickerTriggerElement = ref(null)
const sourcePickerSearchElement = ref(null)
let sourceLoadGeneration = 0
let snapshotLoadGeneration = 0
let sourceRevisionGeneration = 0

const SECTION_LABELS = Object.freeze({
  common: '外观与样式',
  appearance: '外观与样式',
  animation: '内容与动效',
  content: '内容与动效',
  data: '数据参数',
  series: '数据系列',
  signal: '信号灯属性'
})

const VALUE_TYPE_ICONS = Object.freeze({
  color: Palette,
  number: SlidersHorizontal,
  boolean: ToggleLeft,
  text: Type,
  table: TableProperties,
  'text-list': Columns3,
  'table-rows': Rows3,
  percent: Percent,
  duration: Timer
})

const CHART_SERIES_FIELD_LABELS = Object.freeze({
  name: '名称',
  color: '颜色',
  data: '数据'
})

const JSON_VALUE_TYPE_LABELS = Object.freeze({
  string: '文本',
  number: '数值',
  boolean: '布尔',
  array: '数组',
  object: '对象',
  null: '空值',
  unknown: '未知'
})

const SOURCE_SNAPSHOT_UNAVAILABLE_MESSAGE = '当前连接没有可用数据，请先到“数据源”完成正式测试。'

function text(value) {
  return String(value ?? '').trim()
}

function parameterTarget(parameter) {
  return text(parameter?.target || parameter?.key || parameter?.path || parameter?.propertyPath)
}

function parameterLabel(parameter) {
  return text(parameter?.label || parameter?.title || parameter?.name || parameterTarget(parameter)) || '未命名参数'
}

function parameterDisplayLabel(parameter) {
  return CHART_SERIES_FIELD_LABELS[parameter?.chartSeriesField] || parameterLabel(parameter)
}

function parameterSection(parameter) {
  const section = text(parameter?.section || parameter?.group)
  return SECTION_LABELS[section] || section || '其他参数'
}

function parameterIcon(parameter) {
  return VALUE_TYPE_ICONS[text(parameter?.valueType || parameter?.targetType).toLowerCase()] || SlidersHorizontal
}

function readNodeValue(path) {
  if (!props.node || !path) return undefined
  return path.split('.').reduce((value, key) => value?.[key], props.node)
}

function rawParameterValue(parameter) {
  if (Object.prototype.hasOwnProperty.call(parameter || {}, 'staticValue')) return parameter.staticValue
  if (Object.prototype.hasOwnProperty.call(parameter || {}, 'value')) {
    return typeof parameter.value === 'function' ? parameter.value(props.node) : parameter.value
  }
  return readNodeValue(parameterTarget(parameter))
}

function displayValue(value, maximum = 72) {
  if (value === undefined || value === null || value === '') return '未设置'
  return formatRuntimeValue(value, {
    maxLength: maximum,
    maxDepth: 2,
    maxArrayItems: 4,
    maxObjectKeys: 4,
    maxTotalEntries: 12
  })
}

function boundedArrayLength(value, maximum) {
  if (!Array.isArray(value)) return 0
  const length = Number(value.length)
  return Number.isFinite(length) ? Math.min(maximum, Math.max(0, Math.trunc(length))) : 0
}

function tableHeaderText(header) {
  if (header && typeof header === 'object' && !Array.isArray(header)) {
    return text(header.title ?? header.label ?? header.name ?? header.key)
  }
  return text(header)
}

function parameterValueSummary(parameter) {
  const target = parameterTarget(parameter)
  const value = rawParameterValue(parameter)
  if (target === 'visible') return value === false ? '隐藏' : '显示'
  if (target === 'animationPlaying') return value === false ? '已暂停' : '播放中'
  if (target === 'animationDuration') return `${displayValue(value, 32)} 秒`
  if (target === 'tableHeaders') {
    const count = boundedArrayLength(value, 12)
    const labels = []
    for (let index = 0; index < Math.min(count, 3); index += 1) {
      const label = tableHeaderText(value[index])
      if (label) labels.push(label)
    }
    return `${count} 列${labels.length ? ` · ${labels.join('、')}${count > labels.length ? '…' : ''}` : ''}`
  }
  if (target === 'tableCells') {
    const rows = boundedArrayLength(value, 50)
    let columns = Math.min(12, Math.max(0, Number(props.node?.tableColumns) || 0))
    if (!columns && rows && Array.isArray(value[0])) columns = boundedArrayLength(value[0], 12)
    if (!columns) columns = boundedArrayLength(props.node?.tableHeaders, 12)
    return `${rows} 行 × ${columns} 列`
  }
  if (target === 'tableData') {
    const rows = boundedArrayLength(value?.rows, 50)
    const columns = boundedArrayLength(value?.columns, 12)
    return `${rows} 行 × ${columns} 列`
  }
  if (parameter?.chartSeriesField === 'data') {
    const count = Array.isArray(value?.rows)
      ? boundedArrayLength(value.rows, 2000)
      : boundedArrayLength(value, 2000)
    return `${count} 项数据`
  }
  return displayValue(value, 48)
}

function parameterBadge(parameter) {
  return parameter?.legacy ? '旧版' : parameterValueTypeLabel(parameter)
}

function isColorParameter(parameter) {
  return text(parameter?.valueType || parameter?.targetType).toLowerCase() === 'color'
}

function colorSwatchValue(parameter) {
  const value = text(rawParameterValue(parameter))
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : ''
}

const normalizedParameters = computed(() => {
  const usedTargets = new Set()
  const result = []
  let previousSection = ''
  let previousSeriesIndex = null
  for (const parameter of props.parameters || []) {
    const target = parameterTarget(parameter)
    if (!target || usedTargets.has(target)) continue
    usedTargets.add(target)
    const section = parameterSection(parameter)
    const seriesIndex = Number.isInteger(parameter?.chartSeriesIndex)
      ? parameter.chartSeriesIndex
      : null
    result.push({
      source: parameter,
      target,
      section,
      seriesIndex,
      showSection: section !== previousSection,
      showSeriesHeader: seriesIndex !== null && seriesIndex !== previousSeriesIndex
    })
    previousSection = section
    previousSeriesIndex = seriesIndex
  }
  return result
})

const parameterByTarget = computed(() => new Map(
  normalizedParameters.value.map(parameter => [parameter.target, parameter])
))
const activeParameter = computed(() => parameterByTarget.value.get(activeTarget.value) || null)
const activeParameterLabel = computed(() => parameterLabel(activeParameter.value?.source))
const activeFormatGuide = computed(() => parameterDataFormatGuide(activeParameter.value?.source))
const activeFormatGuideTitle = computed(() => {
  if (activeFormatGuide.value?.title) return activeFormatGuide.value.title
  const label = parameterValueTypeLabel(activeParameter.value?.source)
  return `${label.endsWith('数据') ? label : `${label}数据`}格式`
})
const activeFormatExample = computed(() => {
  const examples = activeFormatGuide.value?.examples || []
  return examples.find(example => example.id === activeFormatExampleId.value) || examples[0] || null
})

const bindingsByTarget = computed(() => {
  const result = new Map()
  for (const binding of Array.isArray(props.node?.dataBindings) ? props.node.dataBindings : []) {
    const target = text(binding?.target)
    if (!target || result.has(target)) continue
    if (text(binding?.sourceId) && text(binding?.jsonPath)) result.set(target, { binding, kind: 'json' })
    else if (text(binding?.pointId)) result.set(target, { binding, kind: 'legacy' })
  }
  return result
})

const boundCount = computed(() => normalizedParameters.value.reduce(
  (count, parameter) => count + (bindingsByTarget.value.has(parameter.target) ? 1 : 0),
  0
))
const sourceById = computed(() => new Map(sources.value.map(source => [text(source?.id), source])))
const selectedSource = computed(() => sourceById.value.get(selectedSourceId.value) || null)
const sourceListModel = computed(() => createSourceConnectionListModel(sources.value, {
  query: sourceQuery.value,
  protocol: sourceProtocolFilter.value
}))
const sourceProtocolOptions = computed(() => {
  const counts = sourceListModel.value.protocolCounts
  const known = SOURCE_PROTOCOL_ORDER.filter(protocol => counts.has(protocol))
  const knownSet = new Set(known)
  const extra = [...counts.keys()]
    .filter(protocol => protocol && !knownSet.has(protocol))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  return [...known, ...extra].map(protocol => ({
    value: protocol,
    label: protocol,
    count: counts.get(protocol) || 0
  }))
})
const visibleSourceItems = computed(() => {
  const filtered = sourceListModel.value.filtered
  const limit = Math.max(SOURCE_PICKER_PAGE_SIZE, sourcePickerVisibleLimit.value)
  const visible = filtered.slice(0, limit)
  const selectedIndex = filtered.findIndex(source => text(source?.id) === selectedSourceId.value)
  if (selectedIndex < limit || selectedIndex < 0) return visible
  return [filtered[selectedIndex], ...visible.slice(0, limit - 1)]
})
const hiddenSourceItemCount = computed(() => Math.max(
  0,
  sourceListModel.value.filtered.length - visibleSourceItems.value.length
))
const selectedSourceFilteredOut = computed(() => (
  Boolean(selectedSource.value)
  && !sourceListModel.value.filteredIds.has(selectedSourceId.value)
))
const nodeTitle = computed(() => text(
  props.node?.displayName || props.node?.name || props.node?.text || props.node?.type
) || '已选组件')

const canConfirmBinding = computed(() => (
  !props.locked
  && Boolean(activeParameter.value)
  && Boolean(selectedSourceId.value)
  && Boolean(snapshot.value)
  && Boolean(normalizedPath.value)
  && !pathError.value
  && compatibility.value?.compatible === true
))

function bindingRecord(target) {
  return bindingsByTarget.value.get(target) || null
}

function chartSeriesValue(index, field) {
  if (index === 0) {
    if (field === 'name' && props.node?.chartSeriesName !== undefined) return props.node.chartSeriesName
    if (field === 'color' && props.node?.chartColor !== undefined) return props.node.chartColor
    if (field === 'data' && props.node?.chartData !== undefined) return props.node.chartData
  }
  const series = Array.isArray(props.node?.chartSeries) ? props.node.chartSeries[index] : null
  return series && typeof series === 'object' && !Array.isArray(series) ? series[field] : undefined
}

function chartSeriesName(index) {
  return text(chartSeriesValue(index, 'name')) || `系列 ${index + 1}`
}

function chartSeriesColor(index) {
  const color = text(chartSeriesValue(index, 'color'))
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#aab7bc'
}

function chartSeriesDataCount(index) {
  const data = chartSeriesValue(index, 'data')
  return Array.isArray(data?.rows)
    ? boundedArrayLength(data.rows, 2000)
    : boundedArrayLength(data, 2000)
}

function chartSeriesBoundCount(index) {
  return Object.keys(CHART_SERIES_FIELD_LABELS).reduce(
    (count, field) => count + (bindingsByTarget.value.has(`chartSeries.${index}.${field}`) ? 1 : 0),
    0
  )
}

function sourceName(sourceId) {
  const source = sourceById.value.get(text(sourceId))
  return text(source?.name || source?.label || sourceId) || '未知数据源'
}

function sourceProtocol(source) {
  return text(source?.protocol || source?.type).toUpperCase()
}

function sourceStatus(source) {
  if (source?.enabled === false) return '已停用'
  const status = text(source?.status || source?.quality).toLowerCase()
  if (['online', 'good', 'connected', 'healthy'].includes(status)) return '在线'
  if (['testing', 'connecting'].includes(status)) return '检测中'
  if (['error', 'bad'].includes(status)) return '异常'
  if (['offline', 'disabled'].includes(status)) return '离线'
  return ''
}

function sourceEndpoint(source) {
  return text(source?.endpoint || source?.url || source?.address)
}

function resetSourcePickerFilters() {
  sourceQuery.value = ''
  sourceProtocolFilter.value = 'all'
  sourcePickerVisibleLimit.value = SOURCE_PICKER_PAGE_SIZE
}

async function showMoreSources() {
  const previousIds = new Set(visibleSourceItems.value.map(source => text(source?.id)))
  sourcePickerVisibleLimit.value = Math.min(
    sourceListModel.value.filtered.length,
    sourcePickerVisibleLimit.value + SOURCE_PICKER_PAGE_SIZE
  )
  await nextTick()
  const optionButtons = sourcePickerElement.value?.querySelectorAll('[data-testid="communication-source-option"]') || []
  const firstNewOption = [...optionButtons].find(button => !previousIds.has(text(button.dataset.sourceId)))
  firstNewOption?.focus()
}

function closeSourcePicker({ restoreFocus = false } = {}) {
  sourcePickerOpen.value = false
  resetSourcePickerFilters()
  if (restoreFocus) nextTick(() => sourcePickerTriggerElement.value?.focus())
}

function openSourcePicker() {
  if (props.locked || sourcesLoading.value || !sources.value.length) return
  resetSourcePickerFilters()
  sourcePickerOpen.value = true
  nextTick(() => sourcePickerSearchElement.value?.focus())
}

function toggleSourcePicker() {
  if (sourcePickerOpen.value) closeSourcePicker()
  else openSourcePicker()
}

function handleSourcePickerPointerDown(event) {
  if (!sourcePickerOpen.value || sourcePickerElement.value?.contains(event.target)) return
  closeSourcePicker()
}

function handleSourcePickerKeydown(event) {
  if (!sourcePickerOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  closeSourcePicker({ restoreFocus: true })
}

function invalidateSourceCache() {
  sourceLoadGeneration += 1
  sourcesLoading.value = false
  sourcesLoaded.value = false
  sourcesError.value = ''
}

function resetSnapshot() {
  snapshotLoadGeneration += 1
  snapshot.value = null
  snapshotLoading.value = false
  snapshotError.value = ''
  normalizedPath.value = ''
  pathError.value = ''
  previewValue.value = undefined
  previewValueType.value = 'unknown'
  compatibility.value = null
}

function resetPanelScroll() {
  if (panelElement.value) panelElement.value.scrollTop = 0
}

function closeBindingPage() {
  activeTarget.value = ''
  activeFormatExampleId.value = ''
  closeSourcePicker()
  selectedSourceId.value = ''
  pathDraft.value = '$'
  resetSnapshot()
}

async function loadSources({ force = false } = {}) {
  if (!props.gateway?.listSources) {
    sources.value = []
    sourcesLoaded.value = true
    sourcesError.value = '数据源服务暂不可用'
    return
  }
  if (sourcesLoading.value || (sourcesLoaded.value && !force)) return
  const generation = ++sourceLoadGeneration
  sourcesLoading.value = true
  sourcesError.value = ''
  try {
    const result = await props.gateway.listSources()
    if (generation !== sourceLoadGeneration) return
    if (!Array.isArray(result)) throw new TypeError('数据源列表格式无效')
    // 数据源数量通常很小；设置硬上限防止异常网关一次挂载海量 option。
    const nextSources = result.slice(0, 1000)
    sources.value = nextSources
    sourcesLoaded.value = true
    if (selectedSourceId.value && !nextSources.some(source => text(source?.id) === selectedSourceId.value)) {
      selectedSourceId.value = ''
      pathDraft.value = '$'
      resetSnapshot()
    }
  } catch (error) {
    if (generation !== sourceLoadGeneration) return
    sources.value = []
    sourcesLoaded.value = true
    sourcesError.value = error?.message || '读取数据源失败'
  } finally {
    if (generation === sourceLoadGeneration) sourcesLoading.value = false
  }
}

async function refreshSourcesAfterMutation() {
  const generation = ++sourceRevisionGeneration
  const sourceId = selectedSourceId.value
  const shouldReloadSnapshot = Boolean(activeParameter.value && sourceId)
  invalidateSourceCache()
  if (shouldReloadSnapshot) resetSnapshot()
  if (!props.node) return
  await loadSources({ force: true })
  if (
    generation !== sourceRevisionGeneration
    || !shouldReloadSnapshot
    || selectedSourceId.value !== sourceId
    || !sourceById.value.has(sourceId)
  ) return
  await loadSnapshot(sourceId, { preservePath: true })
}

function updatePathPreview() {
  normalizedPath.value = ''
  pathError.value = ''
  previewValue.value = undefined
  previewValueType.value = 'unknown'
  compatibility.value = null
  if (!activeParameter.value || !snapshot.value) return

  try {
    const path = canonicalizeJsonPath(pathDraft.value)
    const value = evaluateJsonPath(snapshot.value.data, path)
    if (value === undefined) throw new RangeError('路径未匹配到数据')
    const valueType = jsonValueType(value)
    const result = directBindingCompatibility(activeParameter.value.source, { value, type: valueType })
    normalizedPath.value = path
    previewValue.value = value
    previewValueType.value = valueType
    compatibility.value = result
    if (!result.compatible) pathError.value = result.reason || '数据类型与组件属性不匹配'
  } catch (error) {
    pathError.value = error?.message || 'JSONPath 无效'
  }
}

async function loadSnapshot(sourceId, { preservePath = false } = {}) {
  resetSnapshot()
  const normalizedSourceId = text(sourceId)
  if (!normalizedSourceId) return
  if (!props.gateway?.getSourceSnapshot) {
    snapshotError.value = '数据源暂不支持读取样例数据'
    return
  }
  if (!preservePath) pathDraft.value = '$'
  const generation = ++snapshotLoadGeneration
  snapshotLoading.value = true
  try {
    // 面板只读浏览快照；共享读取避免大 JSON 为展开树再复制一次。
    const result = await props.gateway.getSourceSnapshot(normalizedSourceId, { shared: true })
    if (generation !== snapshotLoadGeneration || selectedSourceId.value !== normalizedSourceId) return
    if (!isUsableSourceSnapshot(result, normalizedSourceId)) {
      throw new TypeError(SOURCE_SNAPSHOT_UNAVAILABLE_MESSAGE)
    }
    snapshot.value = result
    updatePathPreview()
  } catch (error) {
    if (generation !== snapshotLoadGeneration) return
    snapshotError.value = error?.message || '读取数据样例失败'
  } finally {
    if (generation === snapshotLoadGeneration) snapshotLoading.value = false
  }
}

async function openBindingPage(target) {
  if (props.locked || !parameterByTarget.value.has(target)) return
  activeTarget.value = target
  activeFormatExampleId.value = activeFormatGuide.value?.examples?.[0]?.id || ''
  resetSnapshot()
  await loadSources()
  if (activeTarget.value !== target) return
  const existing = bindingRecord(target)
  if (existing?.kind === 'json') {
    selectedSourceId.value = text(existing.binding.sourceId)
    pathDraft.value = text(existing.binding.jsonPath) || '$'
    await loadSnapshot(selectedSourceId.value, { preservePath: true })
    return
  }
  selectedSourceId.value = ''
  pathDraft.value = '$'
}

function changeSource(event) {
  selectedSourceId.value = text(event?.target?.value)
  sourceQuery.value = ''
  pathDraft.value = '$'
  void loadSnapshot(selectedSourceId.value)
}

function chooseSource(sourceId) {
  changeSource({ target: { value: sourceId } })
  closeSourcePicker({ restoreFocus: true })
}

function selectTreePath(payload) {
  if (!payload?.path) return
  pathDraft.value = payload.path
  updatePathPreview()
}

function confirmBinding() {
  if (!canConfirmBinding.value) return
  const existingAdapter = bindingRecord(activeTarget.value)?.binding?.adapter
  emit('bind', {
    target: activeTarget.value,
    sourceId: selectedSourceId.value,
    jsonPath: normalizedPath.value,
    ...(existingAdapter ? { adapter: existingAdapter } : {})
  })
  closeBindingPage()
}

function unbind(target) {
  if (props.locked || !bindingRecord(target)) return
  emit('unbind', { target })
  if (activeTarget.value === target) closeBindingPage()
}

watch(pathDraft, updatePathPreview)
watch([sourceQuery, sourceProtocolFilter], () => {
  sourcePickerVisibleLimit.value = SOURCE_PICKER_PAGE_SIZE
})
watch(sourceProtocolOptions, options => {
  if (sourceProtocolFilter.value === 'all') return
  if (!options.some(option => option.value === sourceProtocolFilter.value)) {
    sourceProtocolFilter.value = 'all'
  }
})
watch(activeFormatGuide, guide => {
  activeFormatExampleId.value = guide?.examples?.[0]?.id || ''
}, { immediate: true })
watch([() => props.node?.id, activeTarget], resetPanelScroll, { flush: 'post' })
watch(() => props.node?.id, () => {
  closeBindingPage()
  if (Array.isArray(props.node?.dataBindings) && props.node.dataBindings.some(binding => (
    text(binding?.sourceId) && text(binding?.jsonPath)
  ))) void loadSources()
}, { immediate: true })
watch(() => props.locked, locked => { if (locked) closeBindingPage() })
watch(() => props.gateway, () => {
  invalidateSourceCache()
  sources.value = []
  closeBindingPage()
  if (props.node) void loadSources()
})
watch(() => props.sourceRevision, () => {
  void refreshSourcesAfterMutation()
})
watch(normalizedParameters, parameters => {
  if (activeTarget.value && !parameters.some(parameter => parameter.target === activeTarget.value)) closeBindingPage()
})

onMounted(() => {
  document.addEventListener('pointerdown', handleSourcePickerPointerDown)
  document.addEventListener('keydown', handleSourcePickerKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleSourcePickerPointerDown)
  document.removeEventListener('keydown', handleSourcePickerKeydown)
  sourceLoadGeneration += 1
  snapshotLoadGeneration += 1
  sourceRevisionGeneration += 1
})
</script>

<template>
  <section ref="panelElement" class="communication-binding-panel" data-testid="communication-binding-panel">
    <div v-if="!node" class="binding-empty" data-testid="communication-binding-empty">
      <Link2 />
      <b>未选择组件</b>
      <span>请先在画布中选择一个组件</span>
    </div>

    <template v-else>
      <header class="component-head" data-testid="communication-component-head">
        <button v-if="activeParameter" type="button" class="back-button" title="返回参数列表" @click="closeBindingPage"><ArrowLeft /></button>
        <span v-else class="component-icon"><Box /></span>
        <span class="component-copy">
          <b :title="activeParameter ? activeParameterLabel : nodeTitle">{{ activeParameter ? activeParameterLabel : nodeTitle }}</b>
          <small>{{ activeParameter ? '选择数据并建立绑定' : '组件动态参数' }}</small>
        </span>
        <span v-if="!activeParameter && boundCount" class="component-health">数据已连接</span>
      </header>

      <div v-if="locked" class="locked-note" data-testid="communication-locked-note">
        <Lock />
        <span><b>组件已锁定</b><small>解锁后可修改数据连接</small></span>
      </div>

      <template v-if="!activeParameter">
        <div class="binding-summary" data-testid="communication-binding-summary">
          <b>{{ normalizedParameters.length }} 个参数</b>
          <span>{{ boundCount }} 个已连接</span>
        </div>

        <div v-if="!normalizedParameters.length" class="binding-empty compact" data-testid="communication-parameter-empty">
          <SlidersHorizontal />
          <b>暂无可绑定参数</b>
        </div>

        <template v-for="parameter in normalizedParameters" :key="parameter.target">
          <div v-if="parameter.showSection" class="section-title">
            <span>{{ parameter.section }}</span>
          </div>
          <div
            v-if="parameter.showSeriesHeader"
            class="chart-series-binding-head"
            :data-testid="`communication-series-${parameter.seriesIndex}`"
          >
            <i class="chart-series-binding-swatch" :style="{ backgroundColor: chartSeriesColor(parameter.seriesIndex) }"></i>
            <span class="chart-series-binding-copy">
              <b>系列 {{ parameter.seriesIndex + 1 }}</b>
              <small :title="chartSeriesName(parameter.seriesIndex)">{{ chartSeriesName(parameter.seriesIndex) }} · {{ chartSeriesDataCount(parameter.seriesIndex) }} 项数据</small>
            </span>
            <span class="chart-series-binding-count">{{ chartSeriesBoundCount(parameter.seriesIndex) }}/3 已连接</span>
          </div>
          <article class="parameter-row" :class="{ 'chart-series-parameter-row': parameter.seriesIndex !== null }" :data-testid="`communication-parameter-${parameter.target}`">
            <button type="button" class="parameter-main" :disabled="locked" @click="openBindingPage(parameter.target)">
              <span class="parameter-icon"><component :is="parameterIcon(parameter.source)" /></span>
              <span class="parameter-copy">
                <span class="parameter-title">
                  <b>{{ parameterDisplayLabel(parameter.source) }}</b>
                  <em>{{ parameterBadge(parameter.source) }}</em>
                </span>
                <small>
                  属性当前值
                  <i
                    v-if="isColorParameter(parameter.source) && colorSwatchValue(parameter.source)"
                    class="value-swatch"
                    :style="{ backgroundColor: colorSwatchValue(parameter.source) }"
                  ></i>
                  <span :title="displayValue(rawParameterValue(parameter.source))">{{ parameterValueSummary(parameter.source) }}</span>
                </small>
              </span>
              <span class="parameter-action" :class="{ bound: bindingRecord(parameter.target) }">
                {{ bindingRecord(parameter.target) ? '已连接' : '绑定数据' }}
              </span>
            </button>

            <div v-if="bindingRecord(parameter.target)?.kind === 'json'" class="bound-details">
              <div class="bound-relation">
                <b>{{ sourceName(bindingRecord(parameter.target).binding.sourceId) }}</b><span>→</span><b>{{ parameterDisplayLabel(parameter.source) }}</b>
              </div>
              <div class="bound-meta">
                <code :title="bindingRecord(parameter.target).binding.jsonPath">{{ bindingRecord(parameter.target).binding.jsonPath }}</code>
              </div>
              <div class="bound-actions">
                <button type="button" :disabled="locked" @click="openBindingPage(parameter.target)">更换</button>
                <button type="button" class="danger" :disabled="locked" @click="unbind(parameter.target)"><Unlink />解除</button>
              </div>
            </div>

            <div v-else-if="bindingRecord(parameter.target)?.kind === 'legacy'" class="bound-details legacy-binding">
              <div class="legacy-title"><b>旧绑定待重新选择</b><span>原点位无法直接转换为 JSON 路径</span></div>
              <code :title="bindingRecord(parameter.target).binding.pointId">{{ bindingRecord(parameter.target).binding.pointId }}</code>
              <div class="bound-actions">
                <button type="button" :disabled="locked" @click="openBindingPage(parameter.target)">重新选择</button>
                <button type="button" class="danger" :disabled="locked" @click="unbind(parameter.target)"><Unlink />解除</button>
              </div>
            </div>
          </article>
        </template>

        <footer v-if="normalizedParameters.length" class="panel-note">未连接动态数据时，组件继续使用“属性”中的当前值。</footer>
      </template>

      <section v-else class="binding-page" data-testid="communication-binding-page">
        <div class="binding-step">
          <div class="step-heading"><i>1</i><span><b>选择数据源</b><small>选择已经在“数据源”中配置的连接</small></span></div>
          <div ref="sourcePickerElement" class="source-picker">
            <div class="source-select-row" :class="{ open: sourcePickerOpen }">
              <Database aria-hidden="true" />
              <button
                ref="sourcePickerTriggerElement"
                type="button"
                class="source-picker-trigger"
                :aria-expanded="sourcePickerOpen"
                aria-controls="communication-source-picker-options"
                :disabled="locked || sourcesLoading || !sources.length"
                data-testid="communication-source-select"
                @click="toggleSourcePicker"
              >
                <span :title="selectedSource?.name || ''">
                  {{ sourcesLoading ? '正在读取…' : (selectedSource?.name || '请选择数据源') }}
                  <small v-if="selectedSource">{{ sourceProtocol(selectedSource) }}{{ sourceStatus(selectedSource) ? ` · ${sourceStatus(selectedSource)}` : '' }}</small>
                </span>
                <ChevronDown :class="{ expanded: sourcePickerOpen }" aria-hidden="true" />
              </button>
              <button class="source-refresh-button" type="button" title="刷新数据源与样例" aria-label="刷新数据源与样例" :disabled="sourcesLoading || snapshotLoading" @click="refreshSourcesAfterMutation"><RefreshCw /></button>
            </div>

            <div
              v-if="sourcePickerOpen"
              id="communication-source-picker-options"
              class="source-picker-menu"
              role="region"
              aria-label="数据源选择器"
              data-testid="communication-source-picker"
            >
              <div class="source-search-row">
                <Search aria-hidden="true" />
                <input ref="sourcePickerSearchElement" v-model="sourceQuery" type="search" aria-label="按名称、协议、地址或状态搜索数据源" placeholder="搜索名称、协议或地址" autocomplete="off" data-testid="communication-source-search">
                <button v-if="sourceQuery" type="button" title="清空搜索" aria-label="清空数据源搜索" @click="sourceQuery = ''"><X /></button>
              </div>

              <div class="source-picker-filter-row">
                <label for="communication-source-protocol-filter">类型</label>
                <select
                  id="communication-source-protocol-filter"
                  v-model="sourceProtocolFilter"
                  aria-label="按协议类型筛选数据源"
                  data-testid="communication-source-protocol-filter"
                >
                  <option value="all">全部类型（{{ sources.length }}）</option>
                  <option v-for="option in sourceProtocolOptions" :key="option.value" :value="option.value">
                    {{ option.label }}（{{ option.count }}）
                  </option>
                </select>
                <span role="status" aria-live="polite" aria-atomic="true">{{ sourceListModel.filtered.length }} 项</span>
                <button v-if="selectedSource" type="button" title="清除当前选择" aria-label="清除当前数据源选择" @click="chooseSource('')"><X /></button>
              </div>

              <div v-if="selectedSourceFilteredOut" class="source-picker-current" data-testid="communication-source-current-filtered">
                <small>当前选择不在筛选结果中</small>
                <b>{{ selectedSource.name }}</b>
              </div>

              <div v-if="sourceListModel.filtered.length" class="source-picker-options">
                <button
                  v-for="source in visibleSourceItems"
                  :key="source.id"
                  type="button"
                  class="source-picker-option"
                  :class="{ selected: selectedSourceId === source.id }"
                  :aria-current="selectedSourceId === source.id ? 'true' : undefined"
                  :data-source-id="source.id"
                  data-testid="communication-source-option"
                  @click="chooseSource(source.id)"
                >
                  <span>
                    <b :title="source.name">{{ source.name }}</b>
                    <small>{{ sourceProtocol(source) }}{{ sourceStatus(source) ? ` · ${sourceStatus(source)}` : '' }}</small>
                    <em v-if="sourceEndpoint(source)" :title="sourceEndpoint(source)">{{ sourceEndpoint(source) }}</em>
                  </span>
                  <Check v-if="selectedSourceId === source.id" aria-label="当前选择" />
                </button>
                <button v-if="hiddenSourceItemCount" type="button" class="source-picker-more" data-testid="communication-source-more" @click="showMoreSources">
                  显示更多 <small>还有 {{ hiddenSourceItemCount }} 项</small>
                </button>
              </div>
              <p v-else class="source-picker-empty" aria-live="polite" data-testid="communication-source-search-empty">未找到匹配的数据源。可清空搜索或切换到“全部类型”，当前选择不会被清除。</p>
            </div>
          </div>
          <p v-if="sourcesError" class="field-error">{{ sourcesError }}</p>
          <p v-else-if="sourcesLoaded && !sources.length" class="field-hint">暂无数据源，请先在顶部“数据源”中建立连接。</p>
        </div>

        <div class="binding-step" :class="{ disabled: !selectedSourceId }">
          <div class="step-heading"><i>2</i><span><b>选择 JSON 数据</b><small>展开数据并点击需要绑定的字段，也可以手动输入路径</small></span></div>

          <section v-if="activeFormatGuide" class="data-format-guide" data-testid="communication-data-format-guide">
            <header>
              <span><b>{{ activeFormatGuideTitle }}</b><small>{{ activeFormatGuide.description }}</small></span>
            </header>
            <div
              v-if="activeFormatGuide.examples.length > 1"
              class="format-variant-switch"
              role="tablist"
              :aria-label="`${activeFormatGuideTitle}选项`"
              data-testid="communication-format-variants"
            >
              <button
                v-for="formatExample in activeFormatGuide.examples"
                :key="formatExample.id"
                :id="`communication-format-tab-${formatExample.id}`"
                type="button"
                role="tab"
                :class="{ active: activeFormatExample?.id === formatExample.id }"
                :aria-selected="activeFormatExample?.id === formatExample.id"
                :aria-controls="`communication-format-panel-${formatExample.id}`"
                :tabindex="activeFormatExample?.id === formatExample.id ? 0 : -1"
                @click="activeFormatExampleId = formatExample.id"
              >
                {{ formatExample.label }}<small v-if="formatExample.recommended">（推荐）</small>
              </button>
            </div>
            <article
              v-if="activeFormatExample"
              :key="activeFormatExample.id"
              :id="`communication-format-panel-${activeFormatExample.id}`"
              :role="activeFormatGuide.examples.length > 1 ? 'tabpanel' : undefined"
              :aria-labelledby="activeFormatGuide.examples.length > 1 ? `communication-format-tab-${activeFormatExample.id}` : undefined"
            >
              <p v-if="activeFormatExample.description" class="format-example-description">{{ activeFormatExample.description }}</p>
              <div><b>{{ activeFormatGuide.examples.length > 1 ? '示例数据' : activeFormatExample.label }}</b><span>JSONPath <code>{{ activeFormatExample.jsonPath }}</code></span></div>
              <pre><code>{{ activeFormatExample.json }}</code></pre>
            </article>
          </section>

          <div v-if="snapshotLoading" class="snapshot-state"><RefreshCw class="spinning" />正在读取最新数据样例…</div>
          <div v-else-if="snapshotError" class="snapshot-state error">
            <span>{{ snapshotError }}</span>
            <button type="button" :disabled="!selectedSourceId" @click="loadSnapshot(selectedSourceId, { preservePath: true })">重试</button>
          </div>
          <template v-else-if="snapshot">
            <div class="snapshot-meta">
              <span><i></i>{{ selectedSource?.name || selectedSourceId }}</span>
              <small v-if="snapshot.timestamp">样例时间 {{ snapshot.timestamp }}</small>
            </div>
            <JsonPathTree :value="snapshot.data" :selected-path="normalizedPath || pathDraft" @select="selectTreePath" />

            <label class="path-field">
              <span>JSONPath</span>
              <input v-model="pathDraft" type="text" spellcheck="false" placeholder="例如 $.data.temperature" data-testid="communication-json-path-input">
            </label>
            <p v-if="pathError" class="field-error" data-testid="communication-json-path-error">{{ pathError }}</p>
            <p v-else class="field-hint">绑定路径：<code>{{ normalizedPath }}</code></p>
          </template>
          <div v-else class="snapshot-state">请先选择数据源</div>
        </div>

        <div class="binding-step" :class="{ disabled: !normalizedPath || Boolean(pathError) }">
          <div class="step-heading"><i>3</i><span><b>确认绑定</b><small>检查解析结果与组件属性类型</small></span></div>
          <div class="binding-preview">
            <div class="preview-relation">
              <span><Database />{{ selectedSource?.name || '未选择数据源' }}</span>
              <strong>→</strong>
              <span><component :is="parameterIcon(activeParameter.source)" />{{ activeParameterLabel }}</span>
            </div>
            <div class="preview-result">
              <span class="preview-type">{{ JSON_VALUE_TYPE_LABELS[previewValueType] || previewValueType }}</span>
              <code :title="displayValue(previewValue, 240)">{{ displayValue(previewValue, 120) }}</code>
              <span v-if="compatibility?.compatible" class="compatible"><Check />类型匹配</span>
              <span v-else class="incompatible">{{ pathError || '等待选择数据' }}</span>
            </div>
          </div>
          <button type="button" class="confirm-button" :disabled="!canConfirmBinding" data-testid="communication-establish-binding" @click="confirmBinding">
            <Link2 />建立绑定
          </button>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.communication-binding-panel,
.communication-binding-panel * {
  box-sizing: border-box;
}

.communication-binding-panel {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  background: #fff;
  color: #344b55;
  font-size: 12px;
}

button,
input,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: .52;
}

.component-head {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 60px;
  padding: 9px 11px;
  border-bottom: 1px solid #e7ebed;
}

.component-icon,
.back-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  background: #edf9f6;
  color: #15977f;
}

.back-button:hover,
.back-button:focus-visible {
  outline: 1px solid #83c4b9;
}

.component-icon svg,
.back-button svg {
  width: 17px;
  height: 17px;
}

.component-copy,
.component-copy b,
.component-copy small {
  display: block;
  min-width: 0;
}

.component-copy b,
.component-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.component-copy b {
  color: #344b55;
  font-size: 13px;
}

.component-copy small {
  margin-top: 3px;
  color: #8a969c;
  font-size: 10px;
}

.component-health {
  color: #168264;
  font-size: 10px;
  white-space: nowrap;
}

.component-health::before {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 4px;
  border-radius: 50%;
  background: currentColor;
  vertical-align: 1px;
}

.locked-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 10px 0;
  padding: 8px;
  border: 1px solid #e1e6e8;
  background: #f7f9fa;
  color: #687880;
}

.locked-note > svg {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
}

.locked-note span,
.locked-note b,
.locked-note small {
  display: block;
  min-width: 0;
}

.locked-note small {
  margin-top: 2px;
  color: #929ca1;
  font-size: 10px;
}

.binding-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 8px 11px;
  border-bottom: 1px solid #e7ebed;
  background: #f7faf9;
}

.binding-summary b {
  font-size: 12px;
}

.binding-summary span {
  color: #77878e;
  font-size: 10px;
}

.section-title {
  min-height: 34px;
  padding: 9px 11px 6px;
  background: #f7f9fa;
  color: #526771;
  font-size: 11px;
  font-weight: 600;
}

.chart-series-binding-head {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 43px;
  padding: 7px 10px;
  border-top: 1px solid #dfe7e8;
  border-bottom: 1px solid #e7ebed;
  background: #f4f8f7;
}

.chart-series-binding-swatch {
  width: 12px;
  height: 12px;
  border: 1px solid #c8d2d5;
}

.chart-series-binding-copy,
.chart-series-binding-copy b,
.chart-series-binding-copy small {
  display: block;
  min-width: 0;
}

.chart-series-binding-copy b {
  color: #344b55;
  font-size: 11px;
}

.chart-series-binding-copy small {
  margin-top: 2px;
  overflow: hidden;
  color: #7b8b92;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-series-binding-count {
  color: #168264;
  font-size: 9px;
  white-space: nowrap;
}

.chart-series-parameter-row .parameter-main {
  min-height: 52px;
  padding-left: 18px;
}

.parameter-row {
  min-width: 0;
  border-bottom: 1px solid #edf0f1;
  background: #fff;
}

.parameter-main {
  display: grid;
  grid-template-columns: 23px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  min-height: 57px;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.parameter-main:not(:disabled):hover,
.parameter-main:focus-visible {
  outline: 0;
  background: #edf9f6;
}

.parameter-icon {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  color: #168f79;
}

.parameter-icon svg {
  width: 16px;
  height: 16px;
}

.parameter-copy,
.parameter-copy b,
.parameter-copy small {
  display: block;
  min-width: 0;
}

.parameter-copy b {
  overflow: hidden;
  color: #344b55;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parameter-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.parameter-title b {
  flex: 1 1 auto;
  min-width: 0;
}

.parameter-title em {
  flex: 0 0 auto;
  padding: 1px 4px;
  border: 1px solid #dbe4e5;
  background: #f7faf9;
  color: #708087;
  font-size: 8px;
  font-style: normal;
  font-weight: 400;
}

.parameter-copy small {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  overflow: hidden;
  color: #819097;
  font-size: 10px;
  white-space: nowrap;
}

.parameter-copy small > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.value-swatch {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border: 1px solid #cdd6d9;
}

.parameter-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 25px;
  padding: 0 7px;
  border: 1px solid #83c4b9;
  color: #137c69;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.parameter-action.bound {
  background: #edf9f6;
}

.bound-details {
  min-width: 0;
  margin: 0 9px 9px 32px;
  padding: 8px;
  border-left: 2px solid #16a88f;
  background: #f7faf9;
}

.bound-relation {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  align-items: center;
  gap: 3px;
  min-width: 0;
  font-size: 11px;
}

.bound-relation b {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bound-relation span {
  color: #16a88f;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

.bound-meta,
.legacy-binding > code {
  display: block;
  max-width: 100%;
  margin-top: 5px;
  overflow: hidden;
  color: #526974;
  font: 9px Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legacy-binding {
  border-left-color: #c59b42;
  background: #fffaf0;
}

.legacy-title b,
.legacy-title span {
  display: block;
}

.legacy-title b {
  color: #7f6428;
  font-size: 11px;
}

.legacy-title span {
  margin-top: 2px;
  color: #8f8264;
  font-size: 9px;
}

.bound-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 7px;
}

.bound-actions button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding: 0 6px;
  border: 1px solid #9fcfc7;
  background: #fff;
  color: #137c69;
  font-size: 10px;
}

.bound-actions button.danger {
  border-color: transparent;
  color: #b55151;
}

.bound-actions svg {
  width: 11px;
  height: 11px;
}

.binding-page {
  min-width: 0;
  padding-bottom: 14px;
}

.binding-step {
  min-width: 0;
  padding: 12px 10px;
  border-bottom: 1px solid #e7ebed;
}

.binding-step.disabled {
  background: #fafbfb;
}

.step-heading {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 7px;
  align-items: start;
  margin-bottom: 9px;
}

.step-heading > i {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: #16a88f;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}

.step-heading b,
.step-heading small {
  display: block;
}

.step-heading b {
  color: #344b55;
  font-size: 12px;
}

.step-heading small {
  margin-top: 2px;
  color: #87949a;
  font-size: 9px;
  line-height: 1.45;
}

.data-format-guide {
  display: grid;
  gap: 7px;
  min-width: 0;
  margin-bottom: 9px;
  padding: 8px;
  border-left: 3px solid #56ad9d;
  background: #f4f9f8;
}

.data-format-guide header b,
.data-format-guide header small {
  display: block;
}

.data-format-guide header b {
  color: #35535d;
  font-size: 10px;
}

.data-format-guide header small {
  margin-top: 2px;
  color: #73858c;
  font-size: 9px;
  line-height: 1.5;
}

.data-format-guide article {
  min-width: 0;
}

.format-variant-switch {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  min-width: 0;
  padding: 2px;
  border: 1px solid #d4e3df;
  background: #fff;
}

.format-variant-switch button {
  min-width: 0;
  min-height: 28px;
  padding: 4px;
  border: 0;
  background: transparent;
  color: #61747c;
  cursor: pointer;
  font-size: 9px;
  letter-spacing: 0;
  line-height: 1.25;
}

.format-variant-switch button.active {
  background: #e8f6f3;
  box-shadow: inset 0 0 0 1px #88c9bd;
  color: #137c69;
  font-weight: 600;
}

.format-variant-switch button small {
  color: inherit;
  font-size: 8px;
}

.format-example-description {
  margin: 0 0 6px;
  color: #60757d;
  font-size: 9px;
  line-height: 1.55;
}

.data-format-guide article > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 3px;
  color: #60757d;
  font-size: 9px;
}

.data-format-guide article > div span {
  flex: 0 0 auto;
}

.data-format-guide article > div code {
  color: #137c69;
  font: 9px Consolas, monospace;
}

.data-format-guide pre {
  max-height: 180px;
  margin: 0;
  overflow: auto;
  padding: 6px 7px;
  border: 1px solid #d9e6e3;
  background: #fff;
  color: #405862;
  font: 9px/1.45 Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.source-picker {
  min-width: 0;
}

.source-select-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 28px;
  align-items: center;
  min-width: 0;
  min-height: 34px;
  border: 1px solid #d8dfe2;
  background: #fff;
}

.source-select-row.open,
.source-select-row:focus-within {
  border-color: #67b9aa;
}

.source-select-row > svg {
  width: 14px;
  height: 14px;
  margin: auto;
  color: #168f79;
}

.source-picker-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14px;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 6px 0 4px;
  border: 0;
  background: #fff;
  color: #405862;
  text-align: left;
}

.source-picker-trigger > span {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker-trigger small {
  margin-left: 4px;
  color: #718289;
  font-size: 8px;
}

.source-picker-trigger > svg {
  width: 12px;
  height: 12px;
  transition: transform .16s ease;
}

.source-picker-trigger > svg.expanded {
  transform: rotate(180deg);
}

.source-refresh-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 32px;
  padding: 0;
  border: 0;
  border-left: 1px solid #e2e6e8;
  background: #fff;
  color: #60747d;
}

.source-refresh-button:hover,
.source-refresh-button:focus-visible,
.source-picker-trigger:hover,
.source-picker-trigger:focus-visible {
  background: #edf9f6;
  color: #137c69;
  outline: 0;
}

.source-refresh-button svg {
  width: 13px;
  height: 13px;
}

.source-picker-menu {
  min-width: 0;
  margin-top: 4px;
  border: 1px solid #cfdcda;
  background: #fff;
  box-shadow: 0 6px 16px rgba(36, 70, 73, .12);
}

.source-search-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 26px;
  align-items: center;
  min-width: 0;
  min-height: 32px;
  border-bottom: 1px solid #dce6e4;
  background: #fff;
}

.source-search-row > svg {
  width: 14px;
  height: 14px;
  margin: auto;
  color: #788991;
}

.source-search-row input {
  width: 100%;
  min-width: 0;
  height: 31px;
  padding: 0 4px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #405862;
  font-size: 10px;
}

.source-search-row input::-webkit-search-cancel-button {
  display: none;
}

.source-search-row:focus-within {
  box-shadow: inset 0 0 0 1px #67b9aa;
}

.source-search-row button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 31px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #788991;
}

.source-search-row button:hover,
.source-search-row button:focus-visible {
  background: #edf9f6;
  color: #137c69;
  outline: 0;
}

.source-search-row button svg {
  width: 12px;
  height: 12px;
}

.source-picker-filter-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 32px;
  padding: 3px 5px 3px 8px;
  border-bottom: 1px solid #e5ecea;
  background: #f8fbfa;
}

.source-picker-filter-row label {
  flex: 0 0 auto;
  color: #5e747c;
  font-size: 9px;
}

.source-picker-filter-row select {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 25px;
  padding: 0 4px;
  border: 1px solid #cfddda;
  border-radius: 2px;
  outline: 0;
  background: #fff;
  color: #405862;
  font-size: 9px;
}

.source-picker-filter-row select:focus {
  border-color: #67b9aa;
  box-shadow: 0 0 0 1px rgba(103, 185, 170, .18);
}

.source-picker-filter-row > span {
  flex: 0 0 auto;
  color: #718289;
  font-size: 9px;
  white-space: nowrap;
}

.source-picker-filter-row button {
  display: grid;
  flex: 0 0 24px;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #a05555;
}

.source-picker-filter-row button:hover,
.source-picker-filter-row button:focus-visible {
  background: #fff2f2;
  outline: 1px solid #e3b9b9;
}

.source-picker-filter-row svg {
  width: 10px;
  height: 10px;
}

.source-picker-current {
  display: grid;
  gap: 2px;
  padding: 6px 9px;
  border-bottom: 1px solid #d8e7e4;
  background: #f1faf8;
  color: #3f625f;
}

.source-picker-current small {
  color: #718985;
  font-size: 8px;
}

.source-picker-current b {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker-options {
  max-height: min(320px, 42vh);
  overflow-y: auto;
  background: #fff;
  overscroll-behavior: contain;
}

.source-picker-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
  align-items: center;
  gap: 5px;
  width: 100%;
  min-height: 43px;
  padding: 5px 8px 5px 9px;
  border: 0;
  border-top: 1px solid #edf1f0;
  background: #fff;
  color: #405862;
  text-align: left;
}

.source-picker-option:hover,
.source-picker-option:focus-visible {
  background: #f2faf8;
}

.source-picker-option:hover {
  outline: 0;
}

.source-picker-option:focus-visible {
  outline: 2px solid #168f79;
  outline-offset: -2px;
}

.source-picker-option.selected {
  background: #e5f6f2;
  color: #116d5d;
  box-shadow: inset 3px 0 #18a88f;
}

.source-picker-option > span,
.source-picker-option b,
.source-picker-option small,
.source-picker-option em {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker-option b {
  font-size: 10px;
  font-weight: 600;
}

.source-picker-option small {
  margin-top: 2px;
  color: #6e8188;
  font-size: 8px;
}

.source-picker-option em {
  margin-top: 1px;
  color: #8a999e;
  font-size: 8px;
  font-style: normal;
}

.source-picker-option > svg {
  width: 13px;
  height: 13px;
  color: #15977f;
}

.source-picker-more,
.source-picker-empty {
  margin: 0;
  padding: 9px;
  color: #718289;
  font-size: 9px;
  line-height: 1.45;
  text-align: center;
}

.source-picker-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 34px;
  border: 0;
  border-top: 1px solid #e7eeec;
  background: #fafcfc;
}

.source-picker-more:hover,
.source-picker-more:focus-visible {
  background: #edf9f6;
  color: #137c69;
}

.source-picker-more:hover {
  outline: 0;
}

.source-picker-more:focus-visible {
  outline: 2px solid #168f79;
  outline-offset: -2px;
}

.source-picker-more small {
  color: #8a999e;
  font-size: 8px;
}

.snapshot-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 88px;
  border: 1px dashed #d4dcdf;
  color: #88969c;
  font-size: 10px;
  text-align: center;
}

.snapshot-state svg {
  width: 14px;
  height: 14px;
}

.snapshot-state.error {
  flex-direction: column;
  color: #a45b5b;
}

.snapshot-state button {
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid #d8bcbc;
  background: #fff;
  color: #a45b5b;
}

.spinning {
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.snapshot-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 5px 7px;
  border: 1px solid #dfe5e7;
  border-bottom: 0;
  background: #f7faf9;
  color: #536a73;
  font-size: 9px;
}

.snapshot-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snapshot-meta span i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: #16a88f;
}

.snapshot-meta small {
  flex: 0 0 auto;
  color: #8b989e;
  font-size: 8px;
}

.path-field {
  display: block;
  margin-top: 8px;
}

.path-field > span {
  display: block;
  margin-bottom: 4px;
  color: #536872;
  font-size: 10px;
  font-weight: 600;
}

.path-field input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 7px;
  border: 1px solid #d8dfe2;
  outline: 0;
  color: #405862;
  font: 10px Consolas, monospace;
}

.path-field input:focus {
  border-color: #67b9aa;
}

.field-error,
.field-hint {
  margin: 5px 0 0;
  font-size: 9px;
  line-height: 1.45;
}

.field-error {
  color: #b55151;
}

.field-hint {
  color: #7f8e94;
}

.field-hint code {
  overflow-wrap: anywhere;
  color: #45626d;
  font: 9px Consolas, monospace;
}

.binding-preview {
  min-width: 0;
  border: 1px solid #dfe5e7;
  background: #fff;
}

.preview-relation {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 15px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  border-bottom: 1px solid #edf0f1;
}

.preview-relation span {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: #405862;
  font-size: 10px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-relation svg {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  color: #168f79;
}

.preview-relation strong {
  color: #16a88f;
  text-align: center;
}

.preview-result {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 7px;
  align-items: center;
  min-width: 0;
  padding: 7px 8px;
}

.preview-type {
  padding: 1px 4px;
  border: 1px solid #dbe4e5;
  background: #f7faf9;
  color: #708087;
  font-size: 8px;
}

.preview-result code {
  min-width: 0;
  overflow: hidden;
  color: #526974;
  font: 9px Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compatible,
.incompatible {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
}

.compatible {
  color: #137c69;
}

.compatible svg {
  width: 11px;
  height: 11px;
}

.incompatible {
  color: #b55151;
}

.confirm-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 32px;
  margin-top: 8px;
  border: 1px solid #16a88f;
  background: #16a88f;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

.confirm-button:not(:disabled):hover,
.confirm-button:not(:disabled):focus-visible {
  outline: 0;
  background: #117b68;
}

.confirm-button svg {
  width: 13px;
  height: 13px;
}

.panel-note {
  padding: 10px 11px 14px;
  border-top: 1px solid #e7ebed;
  color: #819097;
  font-size: 10px;
  line-height: 1.5;
}

.binding-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  min-height: 240px;
  padding: 20px;
  color: #98a3a8;
  text-align: center;
}

.binding-empty.compact {
  min-height: 130px;
}

.binding-empty svg {
  width: 30px;
  height: 30px;
  stroke-width: 1.4;
}

.binding-empty b {
  color: #68777e;
  font-size: 13px;
}

.binding-empty span {
  font-size: 11px;
}
</style>
