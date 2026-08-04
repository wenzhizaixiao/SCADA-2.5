<script setup>
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  ArrowLeft,
  Box,
  Check,
  Database,
  Link2,
  Lock,
  Palette,
  Percent,
  RefreshCw,
  SlidersHorizontal,
  TableProperties,
  Timer,
  ToggleLeft,
  Type,
  Unlink
} from 'lucide-vue-next'
import JsonPathTree from './JsonPathTree.vue'
import { formatRuntimeValue } from '../utils/runtimeValueFormat.js'
import { isUsableSourceSnapshot } from '../utils/sourceSnapshotValidation.js'
import {
  directBindingCompatibility,
  parameterValueTypeLabel
} from '../utils/dataBindingCompatibility.js'
import {
  canonicalizeJsonPath,
  evaluateJsonPath,
  jsonValueType
} from '../utils/jsonPathBinding.js'

const props = defineProps({
  node: { type: Object, default: null },
  parameters: { type: Array, default: () => [] },
  gateway: { type: Object, default: null },
  sourceRevision: { type: Number, default: 0 },
  runtimeStore: { type: Object, default: null },
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
let sourceLoadGeneration = 0
let snapshotLoadGeneration = 0
let sourceRevisionGeneration = 0

const SECTION_LABELS = Object.freeze({
  common: '外观与样式',
  appearance: '外观与样式',
  animation: '内容与动效',
  content: '内容与动效',
  data: '数据参数'
})

const VALUE_TYPE_ICONS = Object.freeze({
  color: Palette,
  number: SlidersHorizontal,
  boolean: ToggleLeft,
  text: Type,
  table: TableProperties,
  percent: Percent,
  duration: Timer
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

function text(value) {
  return String(value ?? '').trim()
}

function parameterTarget(parameter) {
  return text(parameter?.target || parameter?.key || parameter?.path || parameter?.propertyPath)
}

function parameterLabel(parameter) {
  return text(parameter?.label || parameter?.title || parameter?.name || parameterTarget(parameter)) || '未命名参数'
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
  for (const parameter of props.parameters || []) {
    const target = parameterTarget(parameter)
    if (!target || usedTargets.has(target)) continue
    usedTargets.add(target)
    const section = parameterSection(parameter)
    result.push({
      source: parameter,
      target,
      section,
      showSection: section !== previousSection
    })
    previousSection = section
  }
  return result
})

const parameterByTarget = computed(() => new Map(
  normalizedParameters.value.map(parameter => [parameter.target, parameter])
))
const activeParameter = computed(() => parameterByTarget.value.get(activeTarget.value) || null)
const activeParameterLabel = computed(() => parameterLabel(activeParameter.value?.source))

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

function closeBindingPage() {
  activeTarget.value = ''
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
      throw new TypeError('数据样例格式无效')
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
  pathDraft.value = '$'
  void loadSnapshot(selectedSourceId.value)
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

onUnmounted(() => {
  sourceLoadGeneration += 1
  snapshotLoadGeneration += 1
  sourceRevisionGeneration += 1
})
</script>

<template>
  <section class="communication-binding-panel" data-testid="communication-binding-panel">
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
          <article class="parameter-row" :data-testid="`communication-parameter-${parameter.target}`">
            <button type="button" class="parameter-main" :disabled="locked" @click="openBindingPage(parameter.target)">
              <span class="parameter-icon"><component :is="parameterIcon(parameter.source)" /></span>
              <span class="parameter-copy">
                <span class="parameter-title">
                  <b>{{ parameterLabel(parameter.source) }}</b>
                  <em>{{ parameterValueTypeLabel(parameter.source) }}</em>
                </span>
                <small>
                  属性当前值
                  <i
                    v-if="isColorParameter(parameter.source) && colorSwatchValue(parameter.source)"
                    class="value-swatch"
                    :style="{ backgroundColor: colorSwatchValue(parameter.source) }"
                  ></i>
                  <span :title="displayValue(rawParameterValue(parameter.source))">{{ displayValue(rawParameterValue(parameter.source), 48) }}</span>
                </small>
              </span>
              <span class="parameter-action" :class="{ bound: bindingRecord(parameter.target) }">
                {{ bindingRecord(parameter.target) ? '已连接' : '绑定数据' }}
              </span>
            </button>

            <div v-if="bindingRecord(parameter.target)?.kind === 'json'" class="bound-details">
              <div class="bound-relation">
                <b>{{ sourceName(bindingRecord(parameter.target).binding.sourceId) }}</b><span>→</span><b>{{ parameterLabel(parameter.source) }}</b>
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
          <div class="source-select-row">
            <Database />
            <select :value="selectedSourceId" :disabled="locked || sourcesLoading" aria-label="选择数据源" data-testid="communication-source-select" @change="changeSource">
              <option value="">{{ sourcesLoading ? '正在读取…' : '请选择数据源' }}</option>
              <option v-for="source in sources" :key="source.id" :value="source.id">
                {{ source.name }}{{ sourceProtocol(source) ? ` · ${sourceProtocol(source)}` : '' }}{{ sourceStatus(source) ? ` · ${sourceStatus(source)}` : '' }}
              </option>
            </select>
            <button type="button" title="刷新数据源" :disabled="sourcesLoading" @click="loadSources({ force: true })"><RefreshCw /></button>
          </div>
          <p v-if="sourcesError" class="field-error">{{ sourcesError }}</p>
          <p v-else-if="sourcesLoaded && !sources.length" class="field-hint">暂无数据源，请先在顶部“数据源”中建立连接。</p>
        </div>

        <div class="binding-step" :class="{ disabled: !selectedSourceId }">
          <div class="step-heading"><i>2</i><span><b>选择 JSON 数据</b><small>展开数据并点击需要绑定的字段，也可以手动输入路径</small></span></div>

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
  min-height: 100%;
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

.source-select-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 28px;
  align-items: center;
  min-width: 0;
  min-height: 34px;
  border: 1px solid #d8dfe2;
  background: #fff;
}

.source-select-row > svg {
  width: 14px;
  height: 14px;
  margin: auto;
  color: #168f79;
}

.source-select-row select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 4px;
  border: 0;
  outline: 0;
  background: #fff;
  color: #405862;
  font-size: 10px;
}

.source-select-row button {
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

.source-select-row button svg {
  width: 13px;
  height: 13px;
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
