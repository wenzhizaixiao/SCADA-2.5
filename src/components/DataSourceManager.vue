<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue'
import {
  AlertCircle,
  Cable,
  CheckCircle2,
  Database,
  Globe2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
  Wifi,
  X
} from 'lucide-vue-next'
import {
  POINT_SOURCE_CONFIG_FIELDS,
  POINT_SOURCE_PROTOCOLS
} from '../services/pointCatalogGateway'

const props = defineProps({
  gateway: { type: Object, required: true },
  initialSourceId: { type: String, default: '' }
})

const emit = defineEmits(['close', 'changed'])

const sources = ref([])
const selectedSource = shallowRef(null)
const selectedSourceId = ref('')
const sourceDraft = ref({ name: '', enabled: true, config: {} })
const sourceQuery = ref('')
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const deleting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const createDialogOpen = ref(false)
const createDraft = ref({ name: '', protocol: 'MQTT' })
const createError = ref('')
let selectionGeneration = 0

const filteredSources = computed(() => {
  const query = sourceQuery.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return sources.value
  return sources.value.filter(source => [source.name, source.protocol, source.endpoint]
    .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query)))
})

const sourceStats = computed(() => ({
  online: sources.value.filter(source => source.enabled !== false && source.status === 'online').length,
  total: sources.value.length,
  errors: sources.value.filter(source => source.enabled !== false && ['offline', 'error'].includes(source.status)).length
}))

const configFields = computed(() => POINT_SOURCE_CONFIG_FIELDS[selectedSource.value?.protocol] || [])

function protocolShortName(protocol) {
  return ({ 'SQL Server': 'SQL', WebSocket: 'WS', Socket: 'TCP', MySQL: 'MYSQL' })[protocol] || String(protocol || '').slice(0, 5).toUpperCase()
}

function effectiveSourceStatus(source) {
  if (source?.enabled === false) return 'disabled'
  return source?.status || 'unknown'
}

function statusLabel(status) {
  return ({ online: '在线', offline: '离线', testing: '测试中', error: '异常', disabled: '已停用' })[status] || '未知'
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date)
}

function clearNotice() {
  errorMessage.value = ''
  successMessage.value = ''
}

function fillDraft(source) {
  sourceDraft.value = {
    name: source?.name || '',
    enabled: source?.enabled !== false,
    config: { ...(source?.config || {}) }
  }
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

function showPersistenceResult(persistence, durableMessage) {
  if (persistence && persistence.durable) {
    successMessage.value = durableMessage
    return true
  }
  errorMessage.value = '操作仅在当前页面生效，未持久保存；刷新页面后将恢复为上次成功保存的配置'
  return false
}

async function refreshSources(preferredId = selectedSourceId.value) {
  const nextSources = await props.gateway.listSources()
  sources.value = nextSources
  if (!nextSources.length) {
    selectedSourceId.value = ''
    selectedSource.value = null
    fillDraft(null)
    return
  }
  const nextId = nextSources.some(source => source.id === preferredId) ? preferredId : nextSources[0].id
  if (nextId !== selectedSourceId.value || !selectedSource.value) await selectSource(nextId)
}

async function selectSource(id) {
  const generation = ++selectionGeneration
  selectedSourceId.value = id
  clearNotice()
  const source = await props.gateway.getSource(id, { includePoints: false })
  if (generation !== selectionGeneration || selectedSourceId.value !== id) return
  selectedSource.value = source
  fillDraft(source)
}

function validateDraft() {
  if (!sourceDraft.value.name.trim()) return '连接名称不能为空'
  for (const field of configFields.value) {
    const value = sourceDraft.value.config[field.key]
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
  if (selectedSource.value?.protocol === 'HTTP') {
    try {
      const headers = JSON.parse(String(sourceDraft.value.config.headers || '{}'))
      if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new TypeError()
    } catch {
      return '请求头必须是 JSON 对象'
    }
  }
  return ''
}

async function saveSource() {
  if (!selectedSource.value || saving.value || testing.value) return
  clearNotice()
  const invalid = validateDraft()
  if (invalid) {
    errorMessage.value = invalid
    return
  }
  saving.value = true
  try {
    const updated = await props.gateway.updateSource(selectedSource.value.id, {
      name: sourceDraft.value.name.trim(),
      enabled: sourceDraft.value.enabled,
      config: { ...sourceDraft.value.config }
    }, { includePoints: false })
    selectedSource.value = mergeSourceMetadata(selectedSource.value, updated)
    fillDraft(selectedSource.value)
    await refreshSources(updated.id)
    showPersistenceResult(updated.persistence, '连接配置已保存')
    emit('changed', { type: 'source-saved', source: updated })
  } catch (error) {
    errorMessage.value = error?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  if (!selectedSource.value || saving.value || testing.value) return
  clearNotice()
  const invalid = validateDraft()
  if (invalid) {
    errorMessage.value = invalid
    return
  }
  testing.value = true
  try {
    const prepared = await props.gateway.updateSource(selectedSource.value.id, {
      name: sourceDraft.value.name.trim(),
      enabled: sourceDraft.value.enabled,
      config: { ...sourceDraft.value.config }
    }, { includePoints: false })
    selectedSource.value = mergeSourceMetadata(selectedSource.value, prepared)
    const result = await props.gateway.testSource(selectedSource.value.id, { includePoints: false })
    const metadata = await props.gateway.getSource(selectedSource.value.id, { includePoints: false })
    selectedSource.value = mergeSourceMetadata(selectedSource.value, metadata || result.source)
    fillDraft(selectedSource.value)
    await refreshSources(selectedSource.value.id)
    if (result.ok) successMessage.value = result.response.message
    else errorMessage.value = result.response.message
    if (!result.persistence?.durable) {
      const memoryOnly = '测试结果仅在当前页面生效，未持久保存；刷新页面后将恢复为上次成功保存的配置'
      errorMessage.value = errorMessage.value ? `${errorMessage.value}；${memoryOnly}` : memoryOnly
    }
    emit('changed', { type: 'source-tested', source: selectedSource.value, ok: result.ok })
  } catch (error) {
    errorMessage.value = error?.message || '连接测试失败'
  } finally {
    testing.value = false
  }
}

function openCreateDialog() {
  clearNotice()
  createDraft.value = { name: '', protocol: 'MQTT' }
  createError.value = ''
  createDialogOpen.value = true
}

async function createSource() {
  const name = createDraft.value.name.trim()
  if (!name) {
    createError.value = '连接名称不能为空'
    return
  }
  createError.value = ''
  saving.value = true
  try {
    const source = await props.gateway.createSource({ name, protocol: createDraft.value.protocol })
    createDialogOpen.value = false
    await refreshSources(source.id)
    showPersistenceResult(source.persistence, '新连接已创建，请完善配置')
    emit('changed', { type: 'source-created', source })
  } catch (error) {
    createError.value = error?.message || '新建连接失败'
  } finally {
    saving.value = false
  }
}

async function removeSource(source = selectedSource.value) {
  if (!source || saving.value || testing.value || deleting.value) return
  if (!window.confirm(`确定删除数据连接“${source.name}”吗？\n使用该连接动态数据的组件将恢复为属性中的静态值。`)) return
  clearNotice()
  deleting.value = true
  try {
    const removed = await props.gateway.removeSource(source.id)
    if (!removed?.removed) throw new Error('数据连接已不存在')
    if (selectedSourceId.value === source.id) {
      selectedSource.value = null
      selectedSourceId.value = ''
    }
    await refreshSources()
    showPersistenceResult(removed.persistence, '数据连接已删除')
    emit('changed', { type: 'source-removed', source })
  } catch (error) {
    errorMessage.value = error?.message || '删除连接失败'
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  try {
    await refreshSources(props.initialSourceId)
  } catch (error) {
    errorMessage.value = error?.message || '无法读取数据源'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="data-source-overlay" role="dialog" aria-modal="true" aria-labelledby="data-source-manager-title">
    <section class="manager-shell">
      <header class="manager-header">
        <div class="manager-title">
          <span class="title-icon"><Database /></span>
          <div><h2 id="data-source-manager-title">数据源管理</h2><span>当前工作空间</span></div>
        </div>
        <div class="manager-summary" aria-label="数据源总览">
          <span><b>{{ sourceStats.online }}</b> 在线</span>
          <span><b>{{ sourceStats.total }}</b> 个连接</span>
          <span :class="{ warning: sourceStats.errors }"><b>{{ sourceStats.errors }}</b> 异常</span>
        </div>
        <button class="icon-button manager-close" type="button" title="关闭数据源管理" aria-label="关闭数据源管理，返回图纸" @click="emit('close')">
          <X />
        </button>
      </header>

      <div class="manager-workbench">
        <aside class="source-sidebar">
          <button class="sidebar-create-button" type="button" @click="openCreateDialog"><Plus />新建连接</button>
          <div class="sidebar-search">
            <Search aria-hidden="true" />
            <input v-model="sourceQuery" type="search" placeholder="搜索连接" aria-label="搜索连接">
          </div>
          <div class="sidebar-caption"><span>全部连接</span><b>{{ filteredSources.length }}</b></div>
          <div class="source-list">
            <div
              v-for="source in filteredSources"
              :key="source.id"
              class="source-item"
              :class="{ active: selectedSourceId === source.id }"
            >
              <button
                type="button"
                class="source-item-select"
                :aria-current="selectedSourceId === source.id ? 'true' : undefined"
                :title="`打开连接：${source.name}`"
                @click="selectSource(source.id)"
              >
                <span class="protocol-mark" :data-protocol="source.protocol">{{ protocolShortName(source.protocol) }}</span>
                <span class="source-item-copy"><b>{{ source.name }}</b><small>{{ source.endpoint || '尚未配置连接地址' }}</small></span>
                <i class="status-dot" :class="effectiveSourceStatus(source)" :title="statusLabel(effectiveSourceStatus(source))"></i>
              </button>
              <span class="source-item-actions">
                <button
                  type="button"
                  class="source-item-manage"
                  :title="`编辑连接：${source.name}`"
                  :aria-label="`编辑连接：${source.name}`"
                  @click="selectSource(source.id)"
                >
                  <Pencil />
                </button>
                <button
                  type="button"
                  class="source-item-manage source-item-delete"
                  :title="`删除连接：${source.name}`"
                  :aria-label="`删除连接：${source.name}`"
                  :disabled="testing || saving || deleting"
                  @click="removeSource(source)"
                >
                  <Trash2 />
                </button>
              </span>
            </div>
            <div v-if="!filteredSources.length" class="empty-sidebar">没有匹配的连接</div>
          </div>
        </aside>

        <main class="source-main">
          <div v-if="loading" class="loading-state"><RefreshCw class="spin" />正在读取数据源</div>
          <div v-else-if="!selectedSource" class="empty-main">
            <Server /><b>暂无数据源</b><button class="primary-button" type="button" @click="openCreateDialog"><Plus />新建连接</button>
          </div>
          <template v-else>
            <header class="source-heading">
              <span class="source-heading-icon"><Wifi v-if="selectedSource.protocol === 'MQTT'" /><Globe2 v-else-if="['HTTP','WebSocket'].includes(selectedSource.protocol)" /><Cable v-else-if="selectedSource.protocol === 'Socket'" /><Server v-else /></span>
              <div class="source-heading-copy">
                <div><h3>{{ selectedSource.name }}</h3><span class="protocol-label">{{ selectedSource.protocol }}</span></div>
                <small>{{ selectedSource.endpoint || '尚未配置连接地址' }} · {{ selectedSource.enabled ? '已启用' : '已停用' }}</small>
              </div>
              <span class="health-label" :class="effectiveSourceStatus(selectedSource)"><i></i>{{ statusLabel(effectiveSourceStatus(selectedSource)) }}</span>
              <div class="heading-actions">
                <button class="secondary-button" type="button" :disabled="testing || saving" @click="testConnection"><RefreshCw :class="{ spin: testing }" />{{ testing ? '测试中' : '测试连接' }}</button>
                <button class="primary-button" type="button" :disabled="testing || saving" @click="saveSource"><Save />{{ saving ? '保存中' : '保存' }}</button>
              </div>
            </header>

            <div class="notice-area" aria-live="polite">
              <div v-if="errorMessage" class="notice error"><AlertCircle />{{ errorMessage }}<button type="button" title="关闭提示" aria-label="关闭提示" @click="errorMessage = ''"><X /></button></div>
              <div v-else-if="successMessage" class="notice success"><CheckCircle2 />{{ successMessage }}<button type="button" title="关闭提示" aria-label="关闭提示" @click="successMessage = ''"><X /></button></div>
            </div>

            <div class="source-detail config-detail">
              <section class="status-band" aria-label="连接状态">
                <div><span>连接状态</span><b :class="effectiveSourceStatus(selectedSource)">{{ statusLabel(effectiveSourceStatus(selectedSource)) }}</b></div>
                <div><span>最近测试</span><b>{{ formatDate(selectedSource.lastResponse?.at) }}</b></div>
                <div><span>响应耗时</span><b>{{ selectedSource.lastResponse ? `${selectedSource.lastResponse.durationMs} ms` : '暂无' }}</b></div>
              </section>

              <section class="config-section">
                <h4>基础信息</h4>
                <div class="config-grid">
                  <label class="config-field"><span>连接名称</span><input v-model="sourceDraft.name" type="text" maxlength="80"></label>
                  <label class="config-field"><span>协议类型</span><input :value="selectedSource.protocol" type="text" disabled></label>
                  <label class="enabled-row"><span><b>启用连接</b><small>停用后不再建立或维持数据连接</small></span><input v-model="sourceDraft.enabled" type="checkbox"><i></i></label>
                </div>
              </section>

              <section class="config-section">
                <h4>{{ selectedSource.protocol }} 配置</h4>
                <div class="config-grid">
                  <label v-for="field in configFields" :key="field.key" class="config-field" :class="{ wide: field.span === 2 }">
                    <span>{{ field.label }}<em v-if="field.required">*</em></span>
                    <select v-if="field.type === 'select'" v-model="sourceDraft.config[field.key]">
                      <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                    </select>
                    <textarea v-else-if="field.type === 'textarea'" v-model="sourceDraft.config[field.key]" :placeholder="field.placeholder" rows="3"></textarea>
                    <input v-else-if="field.type === 'number'" v-model.number="sourceDraft.config[field.key]" type="number" :min="field.min" :placeholder="field.placeholder">
                    <input v-else v-model="sourceDraft.config[field.key]" :type="field.type || 'text'" :placeholder="field.placeholder" autocomplete="off">
                  </label>
                </div>
              </section>

              <section class="test-summary" :class="{ success: selectedSource.lastResponse?.ok, error: selectedSource.lastResponse && !selectedSource.lastResponse.ok }">
                <span class="test-summary-icon"><CheckCircle2 v-if="selectedSource.lastResponse?.ok" /><AlertCircle v-else /></span>
                <div>
                  <h4>连接测试</h4>
                  <p>{{ selectedSource.lastResponse?.message || '尚未测试此连接' }}</p>
                </div>
                <time v-if="selectedSource.lastResponse">{{ formatDate(selectedSource.lastResponse.at) }} · {{ selectedSource.lastResponse.durationMs }} ms</time>
              </section>
            </div>
          </template>
        </main>
      </div>
    </section>

    <div v-if="createDialogOpen" class="dialog-backdrop" @pointerdown.self="createDialogOpen = false">
      <form class="create-dialog" @submit.prevent="createSource">
        <header><h3>新建数据连接</h3><button type="button" title="关闭" aria-label="关闭" @click="createDialogOpen = false"><X /></button></header>
        <div v-if="createError" class="dialog-error" role="alert"><AlertCircle />{{ createError }}</div>
        <label><span>连接名称</span><input v-model="createDraft.name" type="text" maxlength="80" autofocus placeholder="例如：车间设备"></label>
        <label><span>协议类型</span><select v-model="createDraft.protocol"><option v-for="protocol in POINT_SOURCE_PROTOCOLS" :key="protocol" :value="protocol">{{ protocol }}</option></select></label>
        <footer><button class="secondary-button" type="button" @click="createDialogOpen = false">取消</button><button class="primary-button" type="submit" :disabled="saving"><Plus />创建连接</button></footer>
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
  min-width: 190px;
  display: flex;
  align-items: center;
  gap: 10px;
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

.manager-title h2 {
  margin: 0;
  font-size: 16px;
  line-height: 20px;
}

.manager-title span {
  display: block;
  color: #89949b;
  font-size: 11px;
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
  grid-template-columns: 276px minmax(0, 1fr);
}

.source-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #dfe4e7;
  background: #f7f9fa;
}

.sidebar-create-button {
  height: 36px;
  margin: 12px 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #129b82;
  background: #129b82;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}

.sidebar-create-button:hover {
  border-color: #0c876f;
  background: #0c876f;
}

.sidebar-create-button svg {
  width: 16px;
}

.sidebar-search {
  height: 36px;
  margin: 8px 12px 9px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #dbe1e4;
  background: #fff;
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

.sidebar-caption {
  height: 30px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #7e8a91;
  font-size: 11px;
}

.sidebar-caption b {
  font-weight: 500;
}

.source-list {
  min-height: 0;
  overflow: auto;
  padding-bottom: 12px;
}

.source-item {
  width: 100%;
  height: 64px;
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

.source-item-select {
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0 5px 0 9px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 10px;
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

.protocol-mark {
  width: 42px;
  height: 30px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid #bedbd5;
  border-radius: 4px;
  background: #fff;
  color: #107f6c;
  font-size: 9px;
  font-weight: 700;
}

.source-item:nth-child(2n) .protocol-mark {
  border-color: #c8d8e7;
  color: #356d99;
}

.source-item-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-item-copy b,
.source-item-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-item-copy b {
  font-size: 12px;
}

.source-item-copy small {
  color: #8b969d;
  font-size: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9aa4aa;
}

.status-dot.online {
  background: #12a47f;
}

.status-dot.testing {
  background: #d4982c;
}

.status-dot.error {
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
  color: #919ba1;
  font-size: 12px;
  text-align: center;
}

.source-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: #fff;
}

.loading-state,
.empty-main {
  grid-row: 1 / -1;
  height: 100%;
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

.source-heading {
  min-width: 0;
  height: 76px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e7e9;
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
  margin-left: auto;
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
  margin-left: 10px;
  display: flex;
  gap: 8px;
}

.notice-area {
  min-height: 0;
}

.notice {
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid;
  font-size: 12px;
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
  overflow: auto;
}

.config-detail {
  padding: 18px 22px 28px;
}

.status-band {
  max-width: 940px;
  margin-bottom: 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  border: 1px solid #dfe5e7;
  background: #fafbfb;
}

.status-band > div {
  min-height: 62px;
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  border-left: 1px solid #e1e6e8;
}

.status-band > div:first-child {
  border-left: 0;
}

.status-band span {
  color: #89949b;
  font-size: 10px;
}

.status-band b {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-band b.online {
  color: #11816c;
}

.status-band b.error {
  color: #bd4b42;
}

.config-section {
  max-width: 940px;
  padding: 15px 0 7px;
  border-top: 1px solid #e3e8ea;
}

.config-section h4,
.test-summary h4 {
  margin: 0 0 13px;
  font-size: 13px;
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
.config-field textarea,
.create-dialog input,
.create-dialog select {
  width: 100%;
  padding: 0 10px;
  border: 1px solid #d7dfe2;
  border-radius: 3px;
  outline: 0;
  background: #fff;
  color: #28353d;
}

.config-field input,
.config-field select,
.create-dialog input,
.create-dialog select {
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
.config-field textarea:focus,
.create-dialog input:focus,
.create-dialog select:focus {
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
  display: none;
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

.test-summary {
  max-width: 940px;
  min-height: 64px;
  margin-top: 15px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 1px solid #dfe5e7;
  background: #f8fafb;
}

.test-summary.success {
  border-color: #cbe6df;
  background: #f2faf8;
}

.test-summary.error {
  border-color: #edd1cc;
  background: #fff7f5;
}

.test-summary-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: none;
  color: #7d898f;
}

.test-summary.success .test-summary-icon {
  color: #0e8b73;
}

.test-summary.error .test-summary-icon {
  color: #b74840;
}

.test-summary-icon svg {
  width: 19px;
}

.test-summary > div {
  min-width: 0;
}

.test-summary h4 {
  margin-bottom: 5px;
  font-size: 12px;
}

.test-summary p {
  margin: 0;
  overflow: hidden;
  color: #65727a;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-summary time {
  margin-left: auto;
  color: #829097;
  font-size: 10px;
  white-space: nowrap;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2;
  padding: 20px;
  display: grid;
  place-items: center;
  background: #1d2b3366;
}

.create-dialog {
  width: min(420px, 100%);
  padding: 0 18px 18px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 16px 48px #17252e3d;
}

.create-dialog header {
  height: 52px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e2e7e9;
}

.create-dialog h3 {
  margin: 0;
  font-size: 15px;
}

.create-dialog header button {
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

.create-dialog header svg {
  width: 16px;
}

.dialog-error {
  min-height: 34px;
  padding: 7px 9px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #f0d0cb;
  background: #fff3f1;
  color: #a84239;
  font-size: 11px;
}

.dialog-error svg {
  width: 15px;
  flex: none;
}

.create-dialog > label {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.create-dialog > label span {
  color: #68757d;
  font-size: 11px;
}

.create-dialog footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.spin {
  animation: manager-spin .8s linear infinite;
}

@keyframes manager-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .manager-summary span:nth-child(3) {
    display: none;
  }

  .manager-workbench {
    grid-template-columns: 230px minmax(0, 1fr);
  }

  .source-heading {
    padding: 0 14px;
  }

  .config-detail {
    padding-right: 16px;
    padding-left: 16px;
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
    grid-template-columns: 170px minmax(0, 1fr);
  }

  .sidebar-create-button {
    margin-right: 8px;
    margin-left: 8px;
  }

  .source-item {
    grid-template-columns: minmax(0, 1fr) 58px;
    padding-right: 4px;
  }

  .source-item-select {
    grid-template-columns: 36px minmax(0, 1fr) 8px;
    gap: 6px;
    padding-left: 6px;
  }

  .protocol-mark {
    width: 34px;
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

  .config-grid,
  .status-band {
    grid-template-columns: 1fr;
  }

  .config-field.wide,
  .enabled-row {
    grid-column: 1;
  }

  .status-band > div {
    border-top: 1px solid #e1e6e8;
    border-left: 0;
  }

  .status-band > div:first-child {
    border-top: 0;
  }

  .test-summary {
    align-items: flex-start;
  }

  .test-summary time {
    display: none;
  }
}
</style>
