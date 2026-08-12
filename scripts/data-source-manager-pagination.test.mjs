import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker}`)
  return source.slice(start, end)
}

test('selects connection metadata without copying response bodies or point catalogs', () => {
  assert.match(managerSource, /getSource\(id,\s*\{\s*includePoints:\s*false\s*\}\)/)
  assert.match(managerSource, /const operationSourceId = selectedSource\.value\.id[\s\S]*?testSource\(operationSourceId,\s*\{\s*includePoints:\s*false\s*\}\)/)
  assert.doesNotMatch(managerSource, /querySourcePoints|selectedSource\.points|lastResponse\?\.preview/)
})

test('keeps data-source management focused on connection lifecycle', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /基础信息/)
  assert.match(template, /selectedSource\.protocol.*配置/)
  assert.match(template, /测试连接/)
  assert.match(template, /连接测试/)
  assert.doesNotMatch(template, /数据点位|查看全部点位|point-table|runPointSearch/)
})

test('places edit and delete controls together on every connection row', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')
  assert.match(sidebar, /class="source-item-actions"[\s\S]*?编辑连接：[\s\S]*?<Pencil \/>[\s\S]*?删除连接：[\s\S]*?<Trash2 \/>/)
  assert.match(sidebar, /@click="removeSource\(source\)"/)
  assert.match(managerSource, /window\.confirm\(/)
})

test('summary exposes only connection health and never renders a response payload', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /sourceStats\.online/)
  assert.match(template, /sourceStats\.total/)
  assert.match(template, /sourceStats\.errors/)
  assert.doesNotMatch(template, /sourceStats\.points|<pre>/)
})

test('validates protocol field bounds, enumerations and HTTP header JSON before requests', () => {
  const validation = sourceBetween(managerSource, 'function validateDraft()', 'async function saveSource')
  assert.match(validation, /field\.type === 'number'/)
  assert.match(validation, /numeric < field\.min/)
  assert.match(validation, /numeric > field\.max/)
  assert.match(validation, /field\.type === 'select'.*field\.options\?\.includes/s)
  assert.match(validation, /protocol === 'HTTP'[\s\S]*?JSON\.parse[\s\S]*?请求头必须是 JSON 对象/)
})

test('derives the connection list through one computed model without component-level source rescans', () => {
  const model = sourceBetween(managerSource, 'const sourceListModel = computed', 'const sourceStats = computed')

  assert.match(model, /createSourceConnectionListModel\(sources\.value,\s*\{[\s\S]*?query: sourceQuery\.value,[\s\S]*?status: sourceStatusFilter\.value,[\s\S]*?protocol: sourceProtocolFilter\.value/)
  assert.equal((managerSource.match(/createSourceConnectionListModel\(/g) || []).length, 1)
  assert.match(managerSource, /const sourceStats = computed\(\(\) => sourceListModel\.value\.stats\)/)
  assert.doesNotMatch(managerSource, /\bfilteredSources\b/)
  assert.doesNotMatch(model, /sources\.value\.filter\(/)
})

test('wires status and protocol filters into the shared connection list model', () => {
  const filters = sourceBetween(managerSource, 'const SOURCE_STATUS_FILTERS', 'const sourceListModel')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  for (const filterId of ['all', 'online', 'issues', 'disabled']) {
    assert.match(filters, new RegExp(`id: '${filterId}'`))
  }
  assert.match(sidebar, /class="source-status-filters"[\s\S]*?v-for="filter in SOURCE_STATUS_FILTERS"[\s\S]*?sourceStatusFilter = filter\.id/)
  assert.match(sidebar, /id="source-protocol-filter"[\s\S]*?v-model="sourceProtocolFilter"[\s\S]*?v-for="protocol in sourceProtocolOptions"/)
  assert.match(sidebar, /data-testid="source-result-count"[\s\S]*?sourceListModel\.filtered\.length[\s\S]*?sourceStats\.total/)
})

test('groups configured connections and interface demos with demos collapsed by default', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(managerSource, /const collapsedSourceGroups = ref\(new Set\(\['demos'\]\)\)/)
  assert.match(managerSource, /isInterfaceDemoSource\(source\) \? 'demos' : 'connections'/)
  assert.match(sidebar, /v-for="group in sourceListModel\.groups"[\s\S]*?class="source-group-heading"[\s\S]*?:aria-expanded="!sourceGroupIsCollapsed\(group\.id\)"/)
  assert.match(sidebar, /:id="`source-group-\$\{group\.id\}`"[\s\S]*?v-if="!sourceGroupIsCollapsed\(group\.id\)"[\s\S]*?v-for="source in group\.items"/)
})

test('renders visible connection status text and stable row inspection hooks', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(sidebar, /data-testid="source-list"/)
  assert.match(sidebar, /:data-source-id="source\.id"/)
  assert.match(sidebar, /:data-status="effectiveSourceStatus\(source\)"/)
  assert.match(sidebar, /data-testid="source-row"/)
  assert.match(sidebar, /class="source-item-status"[\s\S]*?<span>\{\{ statusLabel\(effectiveSourceStatus\(source\)\) \}\}<\/span>/)
})

test('reveals a filtered-out selection without selecting another connection', () => {
  const filteredSelection = sourceBetween(managerSource, 'const selectedSourceFilteredOut', 'const configFields')
  const reveal = sourceBetween(managerSource, 'function revealSelectedSource()', 'function sourceDraftSnapshot')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(filteredSelection, /selectedSourceId\.value[\s\S]*?!sourceListModel\.value\.filteredIds\.has\(selectedSourceId\.value\)/)
  assert.match(reveal, /clearSourceFilters\(\)[\s\S]*?expandSourceGroupFor\(selectedSourceId\.value\)/)
  assert.doesNotMatch(reveal, /selectSource\(/)
  assert.match(sidebar, /v-if="selectedSourceFilteredOut"[\s\S]*?@click="revealSelectedSource"[\s\S]*?定位当前连接/)
})

test('uses protocol-stable colors and stacks list above details on narrow screens', () => {
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')
  const mobileStart = styles.indexOf('@media (max-width: 680px)')
  assert.notEqual(mobileStart, -1, 'expected narrow-screen manager styles')
  const mobile = styles.slice(mobileStart)

  for (const protocol of ['MQTT', 'HTTP', 'WebSocket', 'Socket', 'MySQL', 'SQL Server', 'Redis']) {
    assert.match(styles, new RegExp(`\\.protocol-mark\\[data-protocol="${protocol}"\\]`))
  }
  assert.doesNotMatch(styles, /\.source-item:nth-child|nth-child\([^)]*\)\s+\.protocol-mark/)
  assert.match(mobile, /\.manager-workbench\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-rows:\s*clamp\(250px,\s*44vh,\s*360px\)\s+minmax\(260px,\s*1fr\);[^}]*overflow-y:\s*auto;/)
  assert.match(mobile, /\.source-sidebar\s*\{[^}]*border-right:\s*0;[^}]*border-bottom:\s*1px solid/)
})

test('pins save and test operations to the source that started them', () => {
  const save = sourceBetween(managerSource, 'async function saveSource()', 'async function testConnection')
  const connectionTest = sourceBetween(managerSource, 'async function testConnection()', 'function openCreateDialog')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(managerSource, /const sourceInteractionLocked = computed\(\(\) => \([\s\S]*?selectingSourceId\.value[\s\S]*?saving\.value[\s\S]*?testing\.value[\s\S]*?deleting\.value/)
  assert.match(sidebar, /class="source-item-select"[\s\S]*?:disabled="sourceInteractionLocked"[\s\S]*?@click="requestSelectSource\(source\.id\)"/)
  assert.match(sidebar, /class="source-item-manage"[\s\S]*?:disabled="sourceInteractionLocked"/)
  assert.match(save, /const operationSourceId = selectedSource\.value\.id[\s\S]*?updateSource\(operationSourceId, draftPatch/)
  assert.doesNotMatch(save.slice(save.indexOf('const draftPatch')), /selectedSource\.value\.id/)
  assert.match(connectionTest, /const operationSourceId = selectedSource\.value\.id[\s\S]*?testSource\(operationSourceId/)
  assert.doesNotMatch(connectionTest.slice(connectionTest.indexOf('const draftPatch')), /selectedSource\.value\.id/)
})

test('locks the editable form during async operations and keeps global notices visible in every main state', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const noticeIndex = main.indexOf('<div class="notice-area"')
  const loadingIndex = main.indexOf('<div v-if="loading"')
  const detailIndex = main.indexOf('<fieldset v-else class="source-detail config-detail"')

  assert.ok(noticeIndex >= 0)
  assert.ok(loadingIndex > noticeIndex)
  assert.ok(detailIndex > loadingIndex)
  assert.match(main, /<fieldset v-else class="source-detail config-detail" :disabled="sourceInteractionLocked" :aria-busy="sourceInteractionLocked">/)
  assert.match(main, /class="notice error" role="alert"/)
  assert.match(main, /class="notice success" role="status"/)
  assert.match(main, /errorMessage \? \(sources\.length \? '连接详情加载失败' : '数据源读取失败'\) : '暂无数据源'/)
})

test('guards unsaved drafts on selection, creation and close without blocking filters', () => {
  const dirtyGuard = sourceBetween(managerSource, 'function sourceDraftSnapshot', 'function closeCreateDialog')
  const createDialog = sourceBetween(managerSource, 'function openCreateDialog()', 'async function createSource')
  const reveal = sourceBetween(managerSource, 'function revealSelectedSource()', 'function sourceDraftSnapshot')
  const template = sourceBetween(managerSource, '<template>', '</template>')

  assert.match(managerSource, /sourceDraftBaseline\.value = sourceDraftSnapshot\(nextDraft\)/)
  assert.match(dirtyGuard, /function confirmDiscardSourceDraft\(\)[\s\S]*?sourceDraftDirty\.value[\s\S]*?window\.confirm/)
  assert.match(dirtyGuard, /function requestSelectSource\(id\)[\s\S]*?confirmDiscardSourceDraft\(\)[\s\S]*?selectSource\(id\)/)
  assert.match(dirtyGuard, /function requestCloseManager\(\)[\s\S]*?confirmDiscardSourceDraft\(\)[\s\S]*?emit\('close'\)/)
  assert.match(createDialog, /confirmDiscardSourceDraft\(\)/)
  assert.doesNotMatch(reveal, /confirmDiscardSourceDraft|selectSource/)
  assert.match(template, /保存并测试连接/)
})

test('reports mutation success independently from a later list refresh failure', () => {
  const refresh = sourceBetween(managerSource, 'async function refreshSourcesAfterMutation', 'function validateDraft')
  const save = sourceBetween(managerSource, 'async function saveSource()', 'async function testConnection')
  const connectionTest = sourceBetween(managerSource, 'async function testConnection()', 'function openCreateDialog')
  const create = sourceBetween(managerSource, 'async function createSource()', 'async function removeSource')
  const remove = sourceBetween(managerSource, 'async function removeSource', 'onMounted')

  assert.match(refresh, /try[\s\S]*?refreshSources\(preferredId, \{ clearNotice: false \}\)[\s\S]*?catch[\s\S]*?连接列表刷新失败/)
  for (const operation of [save, connectionTest, create, remove]) {
    assert.ok(operation.indexOf("emit('changed'") < operation.indexOf('refreshSourcesAfterMutation('))
  }
  assert.match(connectionTest, /if \(prepared\)[\s\S]*?连接配置已更新，但连接测试失败[\s\S]*?type: 'source-saved'/)
})

test('commits a selected row only after metadata loads and preserves the previous detail on failure', () => {
  const selection = sourceBetween(managerSource, 'async function selectSource', 'async function refreshSourcesAfterMutation')
  const fetchIndex = selection.indexOf('await props.gateway.getSource')
  const commitIndex = selection.indexOf('selectedSourceId.value = id')

  assert.ok(fetchIndex >= 0 && commitIndex > fetchIndex)
  assert.match(selection, /generation !== selectionGeneration[\s\S]*?return false/)
  assert.match(selection, /catch \(error\)[\s\S]*?errorMessage\.value[\s\S]*?return false/)
  assert.match(selection, /finally[\s\S]*?selectingSourceId\.value = ''/)
})

test('announces dynamic list state and keeps keyboard focus inside both dialogs', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')

  assert.match(template, /@keydown\.tab="trapManagerFocus"[\s\S]*?@keydown\.esc\.stop\.prevent="handleManagerEscape"/)
  assert.match(template, /data-testid="source-result-count"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(template, /class="filtered-selection-notice"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(managerSource, /class="create-dialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="create-data-source-title"/)
  assert.match(managerSource, /function trapManagerFocus\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?\.focus\(\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})
