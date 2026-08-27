import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { POINT_SOURCE_CONFIG_FIELDS } from '../src/services/pointCatalogGateway.js'

const managerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker}`)
  return source.slice(start, end)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function sourceUpdateResult(enabled) {
  return {
    id: 'source-a',
    name: 'A',
    enabled,
    status: 'offline',
    config: {},
    persistence: { durable: true }
  }
}

function createSourceToggleHarness({ enabled = true, draftDirty = true } = {}) {
  const displaySource = sourceBetween(
    managerSource,
    'function mergeSourceMetadata',
    'function snapshotResponseSummary'
  )
  const toggleSource = sourceBetween(
    managerSource,
    'async function toggleSourceEnabled',
    'function openProtocolPicker'
  )
  const initialSource = {
    id: 'source-a',
    name: 'A',
    enabled,
    status: 'online',
    config: {},
    pointCount: 1
  }
  const sources = { value: [{ ...initialSource }] }
  const selectedSource = { value: { ...initialSource } }
  const selectedSourceId = { value: 'source-a' }
  const sourceDraftDirty = { value: draftDirty }
  const errorMessage = { value: '' }
  const requests = []
  const emissions = []
  const persistenceNotices = []
  const props = {
    gateway: {
      updateSource(id, patch, options) {
        const request = deferred()
        requests.push({ ...request, id, patch, options })
        return request.promise
      }
    }
  }
  const createHarness = new Function(
    'props',
    'sources',
    'selectedSource',
    'selectedSourceId',
    'sourceDraftDirty',
    'errorMessage',
    'emissions',
    'persistenceNotices',
    `const selectingSourceId = { value: '' }
     const saving = { value: false }
     const testing = { value: false }
     const deleting = { value: false }
     const successMessage = { value: '' }
     const sourceToggleJobs = new Map()
     const sourceToggleRevisions = new Map()
     let sourceManagerActive = true
     const sourceInteractionLocked = {
       get value() {
         return Boolean(selectingSourceId.value) || saving.value || testing.value || deleting.value
       }
     }
     let gatewayEventsActive = true
     let fillDraftCalls = 0
     function fillDraft() { fillDraftCalls += 1 }
     function clearNotice() { errorMessage.value = ''; successMessage.value = '' }
     function showPersistenceResult(persistence, message) { persistenceNotices.push({ persistence, message }) }
     function emit(...args) { emissions.push(args) }
     ${displaySource}
     ${toggleSource}
     return {
       toggleSourceEnabled,
       state: () => ({
         fillDraftCalls,
         interactionLocked: sourceInteractionLocked.value,
         pendingJobs: sourceToggleJobs.size
       })
     }`
  )
  return {
    ...createHarness(
      props,
      sources,
      selectedSource,
      selectedSourceId,
      sourceDraftDirty,
      errorMessage,
      emissions,
      persistenceNotices
    ),
    sources,
    selectedSource,
    errorMessage,
    requests,
    emissions,
    persistenceNotices
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

test('selects connection metadata without copying response bodies or point catalogs', () => {
  assert.match(managerSource, /getSource\(id,\s*\{\s*includePoints:\s*false\s*\}\)/)
  assert.match(managerSource, /testSourceDraft\(activeConnectionPayload\(\),\s*\{\s*sharedSnapshot:\s*true\s*\}\)/)
  assert.doesNotMatch(managerSource, /querySourcePoints|selectedSource\.points|lastResponse\?\.preview/)
})

test('keeps data-source management focused on connection lifecycle', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /class="source-overview"/)
  assert.match(template, /class="source-detail source-api-workbench"/)
  assert.match(template, /data-testid="source-basic-config"/)
  assert.match(template, /data-testid="source-advanced-config"/)
  assert.match(template, /连接状态与采集结果/)
  assert.match(template, /data-testid="source-response-points"/)
  assert.doesNotMatch(template, /查看全部点位|point-table|runPointSearch/)
})

test('opens on a bounded metadata-only overview and loads connection details only after inspection', () => {
  const overviewState = sourceBetween(managerSource, 'const managerView', 'const collapsedSourceGroups')
  const overview = sourceBetween(managerSource, '<section v-else-if="managerView === \'overview\'"', '<div v-else-if="managerView !== \'create\' && !selectedSource"')
  const refresh = sourceBetween(managerSource, 'async function refreshSources', 'async function selectSource')
  const mounted = sourceBetween(managerSource, 'onMounted(async () =>', 'onBeforeUnmount')

  assert.match(overviewState, /props\.initialSourceId \? 'detail' : 'overview'/)
  assert.match(managerSource, /const SOURCE_OVERVIEW_PAGE_SIZE = 60/)
  assert.match(managerSource, /sourceListModel\.value\.filtered\.slice\(start, start \+ SOURCE_OVERVIEW_PAGE_SIZE\)/)
  assert.match(overview, /v-for="source in sourceOverviewItems"/)
  assert.match(overview, /协议[\s\S]*?连接名称[\s\S]*?连接地址[\s\S]*?状态[\s\S]*?点位数[\s\S]*?响应耗时[\s\S]*?最近响应[\s\S]*?操作/)
  assert.match(overview, /aria-label="`查看接口：\$\{source\.name\}`"[\s\S]*?requestSelectSource\(source\.id\)/)
  assert.doesNotMatch(overview, /getSource\(|getSourceSnapshot\(|sourceResponseText|\.config/)
  assert.match(refresh, /const shouldSelect = options\.select === true \|\| \(managerView\.value === 'detail'/)
  assert.match(mounted, /refreshSources\(props\.initialSourceId, \{ select: Boolean\(props\.initialSourceId\) \}\)/)
})

test('returns from connection detail to overview through the unsaved-draft guard', () => {
  const transition = sourceBetween(managerSource, 'async function requestSelectSource', 'function requestCloseManager')
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')

  assert.match(transition, /\['detail', 'create'\]\.includes\(managerView\.value\) && !confirmDiscardSourceDraft\(\)/)
  assert.match(transition, /const selected = await selectSource\(id\)[\s\S]*?managerView\.value = 'detail'/)
  assert.match(transition, /function showSourceOverview\(\)[\s\S]*?!confirmDiscardSourceDraft\(\)[\s\S]*?selectedSourceId\.value = ''[\s\S]*?fillDraft\(null\)[\s\S]*?managerView\.value = 'overview'/)
  assert.match(main, /class="detail-back-button"[\s\S]*?@click="showSourceOverview"/)
})

test('keeps separate API-style test and save controls in the heading with a fixed result pane', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')
  const heading = sourceBetween(main, '<header v-if="!loading', '</header>')
  const requestPane = sourceBetween(main, '<section class="source-request-pane">', '<section class="source-response-pane')

  assert.match(requestPane, /class="workbench-panel-heading"[\s\S]*?activeWorkbenchCopy\.title/)
  assert.match(requestPane, /data-testid="source-basic-config"/)
  assert.match(heading, /class="secondary-button source-test-button"[\s\S]*?@click="testConnection"[\s\S]*?<RefreshCw[\s\S]*?'测试'[\s\S]*?class="primary-button source-save-button"[\s\S]*?@click="saveConnection"[\s\S]*?<Save \/>[\s\S]*?'保存'/)
  assert.equal((heading.match(/source-save-button/g) || []).length, 1)
  assert.equal((heading.match(/source-test-button/g) || []).length, 1)
  assert.doesNotMatch(requestPane, /saveConnection|testConnection/)
  assert.match(main, /class="source-response-pane create-response-pane"[\s\S]*?连接状态与采集结果/)
  assert.doesNotMatch(main, /保存并测试|request-send-button/)
  assert.match(styles, /\.source-api-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/)
  assert.match(styles, /\.response-preview\.source-response-preview\s*>\s*code\s*\{[^}]*background:\s*#(?:1f2d35|26343d);/)
})

test('keeps advanced configuration collapsed, named and out of the focus order until expanded', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const toggle = sourceBetween(main, '<button id="source-advanced-config-toggle"', '</button>')
  const panel = sourceBetween(main, '<section v-if="activeAdvancedOpen" id="source-advanced-config"', '</section>')
  const selectFlow = sourceBetween(managerSource, 'async function selectSource', 'async function refreshSourcesAfterMutation')
  const createFlow = sourceBetween(managerSource, 'function startCreateConnection()', 'function createSourcePayload')

  assert.match(managerSource, /const createAdvancedOpen = ref\(false\)/)
  assert.match(managerSource, /const sourceAdvancedOpen = ref\(false\)/)
  assert.match(toggle, /type="button"/)
  assert.match(toggle, /:aria-expanded="activeAdvancedOpen"/)
  assert.match(toggle, /:aria-controls="activeAdvancedOpen \? 'source-advanced-config' : undefined"/)
  assert.match(toggle, /@click="activeAdvancedOpen = !activeAdvancedOpen"/)
  assert.match(panel, /role="region"/)
  assert.match(panel, /aria-labelledby="source-advanced-config-toggle"/)
  assert.match(panel, /v-for="field in activeAdvancedFields"/)
  assert.doesNotMatch(main, /<section v-show="activeAdvancedOpen"/)
  assert.match(selectFlow, /sourceAdvancedOpen\.value = false/)
  assert.match(createFlow, /createAdvancedOpen\.value = false/)
})

test('partitions every protocol field into one visible basic or collapsible advanced control', () => {
  const layoutSource = sourceBetween(managerSource, 'const PRIMARY_CONFIG_KEYS', 'function primaryTargetPlaceholder')
  const layout = new Function(
    `${layoutSource}\nreturn { PRIMARY_CONFIG_KEYS, configFieldsBySection, workbenchFields, primaryTargetKey }`
  )()
  const expectedSections = {
    MQTT: {
      basic: ['brokerUrl', 'clientId', 'qos', 'topic', 'keepAlive'],
      advanced: ['username', 'password', 'cleanSession', 'connectTimeoutMs', 'reconnectIntervalMs', 'tlsMode']
    },
    HTTP: {
      basic: ['method', 'pollInterval', 'url', 'dataPath'],
      advanced: ['headers', 'body', 'timeoutMs', 'retryCount', 'retryIntervalMs', 'responseType']
    },
    MySQL: {
      basic: ['host', 'port', 'database', 'pollInterval', 'query'],
      advanced: ['username', 'password', 'connectTimeoutMs', 'queryTimeoutMs', 'maxRows', 'sslMode']
    },
    'SQL Server': {
      basic: ['host', 'port', 'database', 'pollInterval', 'query'],
      advanced: ['username', 'password', 'connectTimeoutMs', 'queryTimeoutMs', 'maxRows', 'encrypt', 'trustServerCertificate']
    },
    Redis: {
      basic: ['host', 'port', 'database', 'pollInterval', 'keyPattern'],
      advanced: ['username', 'password', 'connectTimeoutMs', 'commandTimeoutMs', 'maxResults', 'tlsMode']
    },
    Socket: {
      basic: ['host', 'port', 'encoding', 'delimiter'],
      advanced: ['heartbeat', 'heartbeatInterval', 'connectTimeoutMs', 'reconnectIntervalMs', 'receiveBufferBytes', 'tcpNoDelay']
    },
    WebSocket: {
      basic: ['url', 'subscribeMessage'],
      advanced: ['subprotocol', 'heartbeatMessage', 'heartbeatInterval', 'connectTimeoutMs', 'reconnectIntervalMs', 'binaryType']
    }
  }

  assert.deepEqual(Object.keys(POINT_SOURCE_CONFIG_FIELDS).sort(), Object.keys(expectedSections).sort())
  for (const [protocol, fields] of Object.entries(POINT_SOURCE_CONFIG_FIELDS)) {
    const basic = layout.configFieldsBySection(fields, 'basic')
    const advanced = layout.configFieldsBySection(fields, 'advanced')
    assert.deepEqual(basic.map(field => field.key), expectedSections[protocol].basic, `${protocol} basic fields changed`)
    assert.deepEqual(advanced.map(field => field.key), expectedSections[protocol].advanced, `${protocol} advanced fields changed`)

    const primaryKey = layout.primaryTargetKey(protocol)
    const renderedBasic = [
      ...(primaryKey ? [primaryKey] : []),
      ...layout.workbenchFields(basic, protocol, 'basic').map(field => field.key)
    ]
    const renderedAdvanced = advanced.map(field => field.key)
    const rendered = [...renderedBasic, ...renderedAdvanced]
    const schemaKeys = fields.map(field => field.key)

    assert.equal(new Set(rendered).size, rendered.length, `${protocol} renders a field more than once`)
    assert.deepEqual([...rendered].sort(), [...schemaKeys].sort(), `${protocol} drops a configured field`)
  }
})

test('places edit and delete controls together on every connection row', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')
  assert.match(sidebar, /class="source-item-actions"[\s\S]*?编辑连接：[\s\S]*?<Pencil \/>[\s\S]*?删除连接：[\s\S]*?<Trash2 \/>/)
  assert.match(sidebar, /@click="removeSource\(source\)"/)
  assert.match(managerSource, /window\.confirm\(/)
})

test('shows enabled state in the overview and keeps enable controls next to interface actions', () => {
  const overview = sourceBetween(managerSource, '<section v-else-if="managerView === \'overview\'"', '<div v-else-if="managerView !== \'create\' && !selectedSource"')

  assert.match(overview, /运行状态[\s\S]*?启用状态[\s\S]*?操作/)
  assert.match(overview, /class="overview-status"[\s\S]*?overviewRuntimeStatus\(source\)/)
  assert.match(overview, /class="enabled-state"[\s\S]*?source\.enabled !== false \? '已启用' : '已停用'/)
  assert.match(overview, /class="overview-actions"[\s\S]*?class="source-enable-toggle"[\s\S]*?role="switch"[\s\S]*?:aria-checked="source\.enabled !== false"/)
  assert.match(overview, /<span><\/span>\{\{ source\.enabled !== false \? '停用' : '启用' \}\}/)
  assert.doesNotMatch(overview, /处理中|togglingSourceId|:aria-busy|<RefreshCw[^>]*spin/)
  assert.match(overview, /@click="toggleSourceEnabled\(source\)"[\s\S]*?@click="requestSelectSource\(source\.id\)"/)
  assert.match(managerSource, /function overviewRuntimeStatus\(source\)[\s\S]*?source\?\.status/)
})

test('keeps the overview geometry stable while an interface is toggled', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')

  assert.match(main, /class="notice-area" :class="\{ floating: managerView === 'overview' \}"/)
  assert.match(styles, /\.source-main\s*\{[^}]*position:\s*relative;/)
  assert.match(styles, /\.notice-area\.floating\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/)
  assert.match(styles, /\.notice\s*\{[^}]*pointer-events:\s*auto;/)
  assert.match(styles, /\.source-enable-toggle\s*\{[^}]*width:\s*74px;[^}]*min-width:\s*74px;[^}]*justify-content:\s*center;[^}]*flex:\s*none;/)
  assert.match(styles, /\.source-enable-toggle span\s*\{[^}]*flex:\s*none;/)
})

test('updates enabled state immediately without entering a global busy state', async () => {
  const harness = createSourceToggleHarness()
  const staleRow = harness.sources.value[0]
  const operation = harness.toggleSourceEnabled(staleRow)

  assert.equal(harness.sources.value[0].enabled, false)
  assert.equal(harness.selectedSource.value.enabled, false)
  assert.equal(harness.sources.value[0].status, 'offline')
  assert.equal(harness.state().interactionLocked, false)
  assert.equal(harness.state().pendingJobs, 1)
  assert.deepEqual(harness.requests.map(({ id, patch, options }) => ({ id, patch, options })), [{
    id: 'source-a',
    patch: { enabled: false },
    options: { includePoints: false }
  }])

  harness.requests[0].resolve(sourceUpdateResult(false))
  await operation
  assert.equal(harness.sources.value[0].enabled, false)
  assert.equal(harness.state().pendingJobs, 0)
  assert.equal(harness.emissions.length, 1)
})

test('rolls back the immediate enabled state when the latest request fails', async () => {
  const harness = createSourceToggleHarness()
  const operation = harness.toggleSourceEnabled(harness.sources.value[0])

  assert.equal(harness.sources.value[0].enabled, false)
  harness.requests[0].reject(new Error('network failed'))
  await operation

  assert.equal(harness.sources.value[0].enabled, true)
  assert.equal(harness.selectedSource.value.enabled, true)
  assert.match(harness.errorMessage.value, /network failed/)
  assert.equal(harness.state().pendingJobs, 0)
  assert.deepEqual(harness.emissions, [[
    'changed',
    { type: 'source-enabled-settled', sourceId: 'source-a', enabled: true }
  ]])
})

test('coalesces rapid repeated clicks and keeps the final requested enabled state', async () => {
  const harness = createSourceToggleHarness()
  const staleRow = harness.sources.value[0]
  const first = harness.toggleSourceEnabled(staleRow)

  assert.equal(harness.sources.value[0].enabled, false)
  const second = harness.toggleSourceEnabled(staleRow)
  assert.equal(harness.sources.value[0].enabled, true)
  assert.equal(harness.state().interactionLocked, false)
  assert.equal(harness.requests.length, 1, 'the second click is coalesced while the first write is pending')

  harness.requests[0].resolve(sourceUpdateResult(false))
  await flushMicrotasks()
  assert.equal(harness.requests.length, 2)
  assert.equal(harness.requests[1].patch.enabled, true)
  assert.equal(harness.sources.value[0].enabled, true)

  harness.requests[1].resolve(sourceUpdateResult(true))
  await Promise.all([first, second])
  assert.equal(harness.sources.value[0].enabled, true)
  assert.equal(harness.selectedSource.value.enabled, true)
  assert.deepEqual(harness.requests.map(request => request.patch.enabled), [false, true])
})

test('ignores an obsolete failed intent after the user returns to the confirmed state', async () => {
  const harness = createSourceToggleHarness()
  const staleRow = harness.sources.value[0]
  const first = harness.toggleSourceEnabled(staleRow)
  const second = harness.toggleSourceEnabled(staleRow)

  assert.equal(harness.sources.value[0].enabled, true)
  harness.requests[0].reject(new Error('obsolete failure'))
  await Promise.all([first, second])

  assert.equal(harness.sources.value[0].enabled, true)
  assert.equal(harness.selectedSource.value.enabled, true)
  assert.equal(harness.errorMessage.value, '')
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.state().pendingJobs, 0)
})

test('does not let a slow catalog read overwrite a toggle completed during the read', async () => {
  const liveRefreshSource = sourceBetween(
    managerSource,
    'function mergeSourceMetadata',
    'function handleSourceCatalogEvent()'
  )
  const toggleSource = sourceBetween(
    managerSource,
    'async function toggleSourceEnabled',
    'function openProtocolPicker'
  )
  const staleCatalogRead = deferred()
  const updateRequest = deferred()
  const initialSource = {
    id: 'source-a',
    name: 'A',
    enabled: true,
    status: 'online',
    config: {},
    pointCount: 1
  }
  const sources = { value: [{ ...initialSource }] }
  const props = {
    gateway: {
      listSources() { return staleCatalogRead.promise },
      updateSource() { return updateRequest.promise }
    }
  }
  const createHarness = new Function(
    'props',
    'sources',
    `const selectedSourceId = { value: '' }
     const selectedSource = { value: null }
     const managerView = { value: 'overview' }
     const sourceDraftDirty = { value: false }
     const sourceTestResult = { value: null }
     const sourceResponseText = { value: '' }
     const selectedSourceSnapshot = { value: null }
     const liveResponseBySource = { value: new Map() }
     const selectingSourceId = { value: '' }
     const saving = { value: false }
     const testing = { value: false }
     const deleting = { value: false }
     const errorMessage = { value: '' }
     const successMessage = { value: '' }
     const sourceInteractionLocked = { get value() { return false } }
     const pendingSnapshotBySource = new Map()
     const sourceToggleJobs = new Map()
     const sourceToggleRevisions = new Map()
     let sourceManagerActive = true
     let selectionGeneration = 0
     let sourcePreviewGeneration = 0
     let liveRefreshTimer = null
     let liveRefreshRunning = false
     let liveRefreshQueued = false
     let liveCatalogDirty = true
     let gatewayEventsActive = true
     const LIVE_REFRESH_INTERVAL_MS = 1000
     function fillDraft() {}
     function testResultFromResponse(response) { return response }
     function formatTestResponse(data) { return JSON.stringify(data) }
     function clearNotice() { errorMessage.value = ''; successMessage.value = '' }
     function showPersistenceResult() {}
     function emit() {}
     ${liveRefreshSource}
     ${toggleSource}
     return { flushLiveRefresh, toggleSourceEnabled, pendingJobs: () => sourceToggleJobs.size }`
  )
  const harness = createHarness(props, sources)

  const refresh = harness.flushLiveRefresh()
  const toggle = harness.toggleSourceEnabled(sources.value[0])
  assert.equal(sources.value[0].enabled, false)

  updateRequest.resolve(sourceUpdateResult(false))
  await toggle
  assert.equal(harness.pendingJobs(), 0)
  assert.equal(sources.value[0].enabled, false)

  staleCatalogRead.resolve([{ ...initialSource, enabled: true, status: 'online' }])
  await refresh

  assert.equal(sources.value[0].enabled, false)
  assert.equal(sources.value[0].status, 'offline')
})

test('does not treat enable or configuration lifecycle snapshots as interface responses', () => {
  const responseFlow = sourceBetween(
    managerSource,
    'function snapshotResponseSummary',
    'async function flushLiveRefresh()'
  )
  const originalResponse = {
    ok: true,
    at: '2026-08-13T03:00:00.000Z',
    durationMs: 18,
    message: '真实接口响应'
  }
  const liveResponseBySource = { value: new Map([['source-a', originalResponse]]) }
  const sources = { value: [{ id: 'source-a', lastResponse: originalResponse }] }
  const createHarness = new Function(
    'liveResponseBySource',
    'sources',
    `${responseFlow}
     return { publishLiveResponseSummaries }`
  )
  const harness = createHarness(liveResponseBySource, sources)

  harness.publishLiveResponseSummaries(new Map([['source-a', {
    sourceId: 'source-a',
    timestamp: '2026-08-13T03:05:00.000Z',
    quality: 'offline',
    meta: { origin: 'source-verification-required' }
  }]]))
  assert.equal(liveResponseBySource.value.get('source-a'), originalResponse)

  harness.publishLiveResponseSummaries(new Map([['source-a', {
    sourceId: 'source-a',
    timestamp: '2026-08-13T03:06:00.000Z',
    quality: 'good',
    meta: { origin: 'connection-test', durationMs: 21, message: '测试成功' }
  }]]))
  assert.equal(liveResponseBySource.value.get('source-a').at, '2026-08-13T03:06:00.000Z')
  assert.equal(liveResponseBySource.value.get('source-a').durationMs, 21)
})

test('summary exposes only connection health and never renders a response payload', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /sourceStats\.online/)
  assert.match(template, /sourceStats\.total/)
  assert.match(template, /sourceStats\.errors/)
  assert.doesNotMatch(template, /sourceStats\.points|<pre>/)
})

test('validates protocol field bounds, enumerations and HTTP header JSON for edit and create requests', () => {
  const validation = sourceBetween(managerSource, 'function validateConnectionDraft', 'async function testConnection')
  assert.match(validation, /field\.type === 'number'/)
  assert.match(validation, /numeric < field\.min/)
  assert.match(validation, /numeric > field\.max/)
  assert.match(validation, /field\.type === 'select'.*field\.options\?\.includes/s)
  assert.match(validation, /protocol === 'HTTP'[\s\S]*?JSON\.parse[\s\S]*?请求头必须是 JSON 对象/)
  assert.match(validation, /function validateDraft\(\)[\s\S]*?validateConnectionDraft\(sourceDraft\.value/)
  assert.match(validation, /function validateCreateDraft\(\)[\s\S]*?validateConnectionDraft\(createDraft\.value/)
})

test('derives the connection list through one computed model without component-level source rescans', () => {
  const model = sourceBetween(managerSource, 'const sourceListModel = computed', 'const sourceStats = computed')

  assert.match(model, /createSourceConnectionListModel\(sources\.value,\s*\{[\s\S]*?query: sourceQuery\.value,[\s\S]*?status: sourceStatusFilter\.value,[\s\S]*?protocol: sourceProtocolFilter\.value/)
  assert.equal((managerSource.match(/createSourceConnectionListModel\(/g) || []).length, 1)
  assert.match(managerSource, /const sourceStats = computed\(\(\) => sourceListModel\.value\.stats\)/)
  assert.doesNotMatch(managerSource, /\bfilteredSources\b/)
  assert.doesNotMatch(model, /sources\.value\.filter\(/)
})

test('keeps status and protocol filters in one compact sidebar row', () => {
  const filters = sourceBetween(managerSource, 'const SOURCE_STATUS_FILTERS', 'const sourceListModel')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  for (const filterId of ['all', 'online', 'issues', 'disabled']) {
    assert.match(filters, new RegExp(`id: '${filterId}'`))
  }
  assert.match(sidebar, /class="source-filter-bar"[\s\S]*?id="source-status-filter"[\s\S]*?v-model="sourceStatusFilter"[\s\S]*?v-for="filter in SOURCE_STATUS_FILTERS"/)
  assert.match(sidebar, /id="source-protocol-filter"[\s\S]*?v-model="sourceProtocolFilter"[\s\S]*?v-for="protocol in sourceProtocolOptions"/)
  assert.doesNotMatch(sidebar, /source-status-filters|sourceStatusFilterCount|aria-pressed="sourceStatusFilter/)
  assert.match(sidebar, /data-testid="source-result-count"[\s\S]*?sourceListModel\.filtered\.length[\s\S]*?sourceStats\.total/)
})

test('executes large-catalog text search explicitly from a button or Enter', () => {
  const searchFlow = sourceBetween(managerSource, 'watch([sourceQuery', 'function clearSourceFilters')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(managerSource, /const sourceQueryInput = ref\(''\)/)
  assert.match(sidebar, /<form class="sidebar-primary-actions" role="search" @submit\.prevent="applySourceSearch">/)
  assert.match(sidebar, /v-model="sourceQueryInput"/)
  assert.match(sidebar, /class="sidebar-search-button"[^>]*type="submit"[^>]*aria-label="搜索连接"/)
  assert.match(searchFlow, /function applySourceSearch\(\)[\s\S]*?sourceQuery\.value = sourceQueryInput\.value\.trim\(\)/)
})

test('renders one connection catalog grouped by protocol and marks built-in examples inline', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')

  assert.match(sidebar, /v-for="group in sourceListModel\.groups"[\s\S]*?class="source-group-heading"[\s\S]*?v-for="source in sourceGroupPageItems\(group\)"/)
  assert.match(sidebar, /protocolShortName\(group\.label\)/)
  assert.match(sidebar, /sourceGroupCountLabel\(group\)/)
  assert.match(managerSource, /function sourceGroupCountLabel\(group\)[\s\S]*?sourceListModel\.value\.protocolCounts\.get\(group\.label\)/)
  assert.match(sidebar, /isInterfaceDemoSource\(source\)[^>]*>示例</)
  assert.match(sidebar, /:aria-expanded="!sourceGroupIsCollapsed\(group\.id\)"/)
  assert.match(sidebar, /class="source-group-pager"[\s\S]*?changeSourceGroupPage\(group, -1\)[\s\S]*?changeSourceGroupPage\(group, 1\)/)
})

test('aligns the connection catalog with the sidebar filters and keeps a complete frame', () => {
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')
  const mobile = sourceBetween(managerSource, '@media (max-width: 680px)', '</style>')

  assert.match(styles, /\.sidebar-caption\s*\{[^}]*margin:\s*0 12px;[^}]*padding:\s*0 2px;/)
  assert.match(styles, /\.source-list\s*\{[^}]*margin:\s*0 12px 12px;[^}]*border:\s*1px solid #e2e7e9;[^}]*background:\s*#fff;/)
  assert.match(styles, /\.source-item-select\s*\{[^}]*padding:\s*0 5px 0 25px;/)
  assert.match(styles, /@media \(max-width:\s*1200px\) and \(min-width:\s*761px\)[\s\S]*?\.source-item-select\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 16px;[^}]*\}[\s\S]*?\.source-item-status > span\s*\{[^}]*display:\s*none;/)
  assert.match(mobile, /\.sidebar-caption\s*\{[^}]*margin-right:\s*8px;[^}]*margin-left:\s*8px;/)
  assert.match(mobile, /\.source-list\s*\{[^}]*margin-right:\s*8px;[^}]*margin-bottom:\s*8px;[^}]*margin-left:\s*8px;/)
  assert.match(mobile, /\.source-item-select\s*\{[^}]*padding-left:\s*25px;/)
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

test('bounds each expanded protocol group with fixed pages and reveals deep selections', () => {
  const groupBehavior = sourceBetween(managerSource, 'function sourceGroupFor', 'function protocolDefaultConfig')

  assert.match(managerSource, /const SOURCE_GROUP_PAGE_SIZE = 60/)
  assert.match(managerSource, /POINT_SOURCE_PROTOCOLS[\s\S]*?\.filter\(protocol => protocol !== 'MQTT'\)[\s\S]*?\.map\(sourceProtocolGroupId\)/)
  assert.match(groupBehavior, /function sourceGroupPageItems\(group\)[\s\S]*?slice\(start, start \+ SOURCE_GROUP_PAGE_SIZE\)/)
  assert.match(groupBehavior, /function changeSourceGroupPage\(group, direction\)/)
  assert.match(groupBehavior, /function expandSourceGroupFor\(sourceId\)/)
  assert.match(groupBehavior, /Math\.floor\(sourceIndex \/ SOURCE_GROUP_PAGE_SIZE\)/)
  assert.match(groupBehavior, /scrollSourceRowIntoView\(sourceId\)/)
  assert.match(groupBehavior, /scrollIntoView\?\.\(\{ block: 'nearest' \}\)/)
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
  assert.match(mobile, /\.manager-workbench\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-rows:\s*clamp\(250px,\s*44vh,\s*360px\)\s+minmax\(420px,\s*1fr\);[^}]*overflow-y:\s*auto;/)
  assert.match(mobile, /\.source-sidebar\s*\{[^}]*border-right:\s*0;[^}]*border-bottom:\s*1px solid/)
})

test('keeps save persistent and routes tests by saved connection state', () => {
  const existingSave = sourceBetween(managerSource, 'async function saveExistingSource()', 'async function saveConnection')
  const saveDispatch = sourceBetween(managerSource, 'async function saveConnection()', 'async function testConnection')
  const connectionTest = sourceBetween(managerSource, 'async function testConnection()', 'async function toggleSourceEnabled')
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')
  const interactionLock = sourceBetween(managerSource, 'const sourceInteractionLocked', 'const sourceDraftDirty')

  assert.match(interactionLock, /selectingSourceId\.value[\s\S]*?saving\.value[\s\S]*?testing\.value[\s\S]*?deleting\.value/)
  assert.doesNotMatch(interactionLock, /toggle|pending/i)
  assert.match(sidebar, /class="source-item-select"[\s\S]*?:disabled="sourceInteractionLocked"[\s\S]*?@click="requestSelectSource\(source\.id\)"/)
  assert.match(sidebar, /class="source-item-manage"[\s\S]*?:disabled="sourceInteractionLocked"/)
  assert.match(existingSave, /const operationSourceId = selectedSource\.value\.id[\s\S]*?gateway\.updateSource\(operationSourceId/)
  assert.match(saveDispatch, /managerView\.value === 'create'\) await saveCreatedSource\(\)[\s\S]*?else await saveExistingSource\(\)/)
  assert.doesNotMatch(`${existingSave}\n${saveDispatch}`, /testSourceDraft|gateway\.testSource\(/)
  assert.match(connectionTest, /const testsSavedConnection = managerView\.value === 'detail'[\s\S]*?!sourceDraftDirty\.value/)
  assert.match(connectionTest, /testsSavedConnection[\s\S]*?gateway\.testSource\(sourceId, \{ includePoints: false \}\)/)
  assert.match(connectionTest, /gateway\.getSourceSnapshot\(sourceId, \{ shared: true \}\)/)
  assert.match(connectionTest, /applyOfficialTestResult\(result, snapshot, previewError\)/)
  assert.match(connectionTest, /isUsableSourceSnapshot\(snapshot, sourceId\)/)
  assert.match(connectionTest, /emit\('changed', \{ type: 'source-tested', source: result\.source \}\)/)
  assert.match(connectionTest, /if \(testsSavedConnection\)[\s\S]*?else[\s\S]*?gateway\.testSourceDraft/)
  assert.match(connectionTest, /gateway\.testSourceDraft\(activeConnectionPayload\(\), \{ sharedSnapshot: true \}\)/)
  assert.match(connectionTest, /applyActiveTestPreview\(result, 'draft'\)/)
  assert.doesNotMatch(connectionTest, /createSource|updateSource/)
})

test('labels draft responses and historical responses separately from live connection data', () => {
  const previewState = sourceBetween(managerSource, 'const activeTestResult', 'const responsePointPreview')
  const previewFlow = sourceBetween(managerSource, 'function clearActiveTestPreview', 'async function saveExistingSource')
  const responsePanel = sourceBetween(managerSource, '<section class="source-response-pane create-response-pane">', '</section>')

  assert.match(previewState, /const activeTestContext/)
  assert.match(previewState, /isUsableSourceSnapshot\(selectedSourceSnapshot\.value, selectedSource\.value\?\.id\)/)
  assert.match(previewState, /const activeTestDisplayMessage/)
  assert.match(previewState, /仅预览/)
  assert.match(previewState, /上次测试成功/)
  assert.match(previewFlow, /sourceTestContext\.value = 'official'/)
  assert.match(previewFlow, /sourceTestContext\.value = 'draft'/)
  assert.match(responsePanel, /activeTestHint/)
  assert.match(responsePanel, /responsePointQualityLabel/)
  assert.match(responsePanel, /activeOfficialSnapshotAvailable \? '组件可用的正式数据'/)
  assert.match(managerSource, /已保存配置运行：/)
})

test('locks the editable form during async operations and keeps global notices visible in every main state', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const noticeIndex = main.indexOf('<div class="notice-area"')
  const loadingIndex = main.indexOf('<div v-if="loading"')
  const detailIndex = main.indexOf('<fieldset v-else class="source-detail source-api-workbench"')

  assert.ok(noticeIndex >= 0)
  assert.ok(loadingIndex > noticeIndex)
  assert.ok(detailIndex > loadingIndex)
  assert.match(main, /<fieldset v-else class="source-detail source-api-workbench"[^>]*:disabled="sourceInteractionLocked"[^>]*:aria-busy="sourceInteractionLocked">/)
  assert.match(main, /class="notice error" role="alert"/)
  assert.match(main, /class="notice success" role="status"/)
  assert.match(main, /errorMessage \? \(sources\.length \? '连接详情加载失败' : '数据源读取失败'\) : '暂无数据源'/)
})

test('guards unsaved drafts on selection, creation and close without blocking filters', () => {
  const dirtyGuard = sourceBetween(managerSource, 'function sourceDraftSnapshot', 'function closeProtocolPicker')
  const createEntry = sourceBetween(managerSource, 'function openProtocolPicker()', 'function createSourcePayload')
  const reveal = sourceBetween(managerSource, 'function revealSelectedSource()', 'function sourceDraftSnapshot')
  const template = sourceBetween(managerSource, '<template>', '</template>')

  assert.match(managerSource, /sourceDraftBaseline\.value = sourceDraftSnapshot\(nextDraft\)/)
  assert.match(dirtyGuard, /function confirmDiscardSourceDraft\(\)[\s\S]*?sourceDraftDirty\.value[\s\S]*?createDraftDirty\.value[\s\S]*?window\.confirm/)
  assert.match(dirtyGuard, /function requestSelectSource\(id\)[\s\S]*?confirmDiscardSourceDraft\(\)[\s\S]*?selectSource\(id\)/)
  assert.match(dirtyGuard, /function requestCloseManager\(\)[\s\S]*?confirmDiscardSourceDraft\(\)[\s\S]*?emit\('close'\)/)
  assert.match(createEntry, /function openProtocolPicker\(\)[\s\S]*?confirmDiscardSourceDraft\(\)/)
  assert.doesNotMatch(reveal, /confirmDiscardSourceDraft|selectSource/)
  assert.match(template, /source-test-button[\s\S]*?测试[\s\S]*?source-save-button[\s\S]*?保存/)
})

test('keeps existing connection editing in the same API-tool workbench and previews bounded JSON', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')
  const previewFlow = sourceBetween(managerSource, 'function testResultFromResponse', 'function prettyPrintJsonPreview')

  assert.match(main, /class="source-detail source-api-workbench"/)
  assert.match(main, /data-testid="source-basic-config"[\s\S]*?workbenchFields\(activeBasicFields, activeProtocol, 'basic'\)/)
  assert.match(main, /v-if="activeAdvancedOpen"[\s\S]*?v-for="field in activeAdvancedFields"/)
  assert.match(main, /data-testid="source-response-preview"[^>]*>[\s\S]*?<code v-if="activeResponseText" tabindex="0" aria-label="响应 JSON 预览"/)
  assert.doesNotMatch(main, /data-testid="source-response-preview"[^>]*tabindex=/)
  assert.match(styles, /\.response-preview\s*>\s*code\s*\{[^}]*overflow:\s*auto;/)
  assert.match(styles, /\.response-preview\s*>\s*code:focus-visible/)
  assert.match(managerSource, /const createResponseSnapshot = shallowRef\(null\)/)
  assert.match(managerSource, /const selectedSourceSnapshot = shallowRef\(null\)/)
  assert.match(previewFlow, /gateway\.getSourceSnapshot\(sourceId, \{ shared: true \}\)/)
  assert.match(previewFlow, /formatTestResponse\(snapshot\.data\)/)
  assert.match(managerSource, /loadSourceTestPreview\(source\)/)
})

test('coalesces catalog and snapshot events into one refresh per second with the latest snapshot winning', () => {
  const schedulingSource = sourceBetween(
    managerSource,
    'function scheduleLiveRefresh()',
    'function subscribeToGatewayEvents()'
  )
  const scheduled = []
  const fakeGlobal = {
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay })
      return scheduled.length
    }
  }
  const createHarness = new Function(
    'globalThis',
    `let gatewayEventsActive = true
     let liveRefreshTimer = null
     let liveCatalogDirty = false
     const pendingSnapshotBySource = new Map()
     const LIVE_REFRESH_INTERVAL_MS = 1000
     let flushCount = 0
     function flushLiveRefresh() { flushCount += 1 }
     ${schedulingSource}
     return {
       handleSourceCatalogEvent,
       handleSourceSnapshot,
       state: () => ({
         flushCount,
         liveCatalogDirty,
         liveRefreshTimer,
         snapshots: new Map(pendingSnapshotBySource)
       })
     }`
  )
  const harness = createHarness(fakeGlobal)

  harness.handleSourceCatalogEvent()
  harness.handleSourceSnapshot({ sourceId: 'source-a', revision: 1 })
  harness.handleSourceSnapshot({ sourceId: 'source-a', revision: 2 })
  harness.handleSourceSnapshot({ sourceId: 'source-b', revision: 1 })

  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 1000)
  assert.equal(harness.state().liveCatalogDirty, true)
  assert.equal(harness.state().snapshots.size, 2)
  assert.equal(harness.state().snapshots.get('source-a').revision, 2)

  scheduled[0].callback()
  assert.equal(harness.state().flushCount, 1)
})

test('refreshes live summaries and JSON without replacing an unsaved connection draft', async () => {
  const liveRefreshSource = sourceBetween(
    managerSource,
    'function mergeSourceMetadata',
    'function handleSourceCatalogEvent()'
  )
  const sourceDraft = {
    value: {
      name: '用户未保存名称',
      enabled: true,
      config: { url: 'https://unsaved.example/api' }
    }
  }
  const listedSources = [{
    id: 'source-a',
    name: '服务端最新名称',
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    endpoint: 'https://saved.example/api',
    pointCount: 3,
    lastResponse: null
  }]
  const snapshot = {
    sourceId: 'source-a',
    revision: 9,
    timestamp: '2026-08-13T03:04:05.000Z',
    quality: 'good',
    data: { value: 42 },
    meta: { durationMs: 12, message: '已采集' }
  }
  const dependencies = {
    props: { gateway: { async listSources() { return listedSources } } },
    sources: { value: [{ ...listedSources[0], name: '旧名称' }] },
    selectedSourceId: { value: 'source-a' },
    selectedSource: { value: { ...listedSources[0], name: '旧名称', config: { url: 'https://saved.example/api' } } },
    managerView: { value: 'detail' },
    sourceTestResult: { value: null },
    sourceTestContext: { value: '' },
    sourceResponseText: { value: '' },
    selectedSourceSnapshot: { value: null },
    liveResponseBySource: { value: new Map() },
    selectingSourceId: { value: '' },
    sourceDraft,
    pendingSnapshotBySource: new Map([['source-a', snapshot]])
  }
  const createHarness = new Function(
    'props',
    'sources',
    'selectedSourceId',
    'selectedSource',
    'managerView',
    'sourceTestResult',
    'sourceTestContext',
    'sourceResponseText',
    'selectedSourceSnapshot',
    'liveResponseBySource',
    'selectingSourceId',
    'sourceDraft',
    'pendingSnapshotBySource',
    `let selectionGeneration = 0
     let sourcePreviewGeneration = 0
     let liveRefreshTimer = null
     let liveRefreshRunning = false
     let liveRefreshQueued = false
     let liveCatalogDirty = true
     let gatewayEventsActive = true
     const sourceToggleJobs = new Map()
     const sourceToggleRevisions = new Map()
     const LIVE_REFRESH_INTERVAL_MS = 1000
     let fillDraftCalls = 0
     function fillDraft() { fillDraftCalls += 1 }
     function testResultFromResponse(response) { return response }
     function formatTestResponse(data) { return JSON.stringify(data) }
     ${liveRefreshSource}
     return { flushLiveRefresh, state: () => ({ fillDraftCalls }) }`
  )
  const harness = createHarness(...Object.values(dependencies))
  const draftBefore = JSON.stringify(sourceDraft.value)

  await harness.flushLiveRefresh()

  assert.equal(JSON.stringify(sourceDraft.value), draftBefore)
  assert.equal(harness.state().fillDraftCalls, 0)
  assert.equal(dependencies.selectedSource.value.name, '服务端最新名称')
  assert.deepEqual(dependencies.selectedSource.value.config, { url: 'https://saved.example/api' })
  assert.equal(dependencies.sourceResponseText.value, '{"value":42}')
  assert.equal(dependencies.sourceTestResult.value.message, '已采集')
})

test('keeps snapshot-only refreshes off the large connection catalog', async () => {
  const liveRefreshSource = sourceBetween(
    managerSource,
    'function mergeSourceMetadata',
    'function handleSourceCatalogEvent()'
  )
  const catalog = [{
    id: 'source-a',
    name: '高频采集连接',
    protocol: 'MQTT',
    lastResponse: null
  }]
  const sources = { value: catalog }
  const liveResponseBySource = { value: new Map() }
  const snapshot = {
    sourceId: 'source-a',
    revision: 18,
    timestamp: '2026-08-13T04:05:06.000Z',
    quality: 'good',
    data: { rpm: 1480 },
    meta: { durationMs: 7 }
  }
  let listCalls = 0
  const createHarness = new Function(
    'props',
    'sources',
    'liveResponseBySource',
    'pendingSnapshotBySource',
    `const selectedSourceId = { value: '' }
     const selectedSource = { value: null }
     const managerView = { value: 'overview' }
     const sourceTestResult = { value: null }
     const sourceResponseText = { value: '' }
     const selectedSourceSnapshot = { value: null }
     const selectingSourceId = { value: '' }
     let selectionGeneration = 0
     let sourcePreviewGeneration = 0
     let liveRefreshTimer = null
     let liveRefreshRunning = false
     let liveRefreshQueued = false
     let liveCatalogDirty = false
     let gatewayEventsActive = true
     const sourceToggleJobs = new Map()
     const sourceToggleRevisions = new Map()
     const LIVE_REFRESH_INTERVAL_MS = 1000
     function fillDraft() {}
     function testResultFromResponse(response) { return response }
     function formatTestResponse(data) { return JSON.stringify(data) }
     ${liveRefreshSource}
     return { flushLiveRefresh }`
  )
  const harness = createHarness(
    { gateway: { async listSources() { listCalls += 1; return [] } } },
    sources,
    liveResponseBySource,
    new Map([['source-a', snapshot]])
  )

  await harness.flushLiveRefresh()

  assert.equal(listCalls, 0)
  assert.equal(sources.value, catalog)
  assert.equal(liveResponseBySource.value.get('source-a').at, snapshot.timestamp)
  assert.equal(liveResponseBySource.value.get('source-a').durationMs, 7)
})

test('subscribes to both gateway event streams and releases subscriptions and timers on unmount', () => {
  const subscriptions = sourceBetween(
    managerSource,
    'function subscribeToGatewayEvents()',
    'function showPersistenceResult'
  )
  const lifecycle = sourceBetween(managerSource, 'onMounted(async () =>', '</script>')

  assert.match(subscriptions, /gateway\?\.subscribe === 'function'[\s\S]*?gateway\.subscribe\(handleSourceCatalogEvent\)/)
  assert.match(subscriptions, /gateway\?\.subscribeSnapshots === 'function'[\s\S]*?gateway\.subscribeSnapshots\(handleSourceSnapshot, \{ shared: true \}\)/)
  assert.match(subscriptions, /unsubscribeSourceCatalog\?\.\(\)[\s\S]*?unsubscribeSourceSnapshots\?\.\(\)/)
  assert.match(subscriptions, /globalThis\.clearTimeout\(liveRefreshTimer\)/)
  assert.match(subscriptions, /pendingSnapshotBySource\.clear\(\)/)
  assert.match(lifecycle, /onMounted\(async \(\) => \{[\s\S]*?subscribeToGatewayEvents\(\)/)
  assert.match(lifecycle, /onBeforeUnmount\(\(\) => \{[\s\S]*?unsubscribeFromGatewayEvents\(\)/)
})

test('reports mutation success independently from a later list refresh failure', () => {
  const refresh = sourceBetween(managerSource, 'async function refreshSourcesAfterMutation', 'function validateDraft')
  const existingSave = sourceBetween(managerSource, 'async function saveExistingSource()', 'async function saveConnection')
  const create = sourceBetween(managerSource, 'async function saveCreatedSource()', 'async function removeSource')
  const remove = sourceBetween(managerSource, 'async function removeSource', 'onMounted')

  assert.match(refresh, /try[\s\S]*?refreshSources\(preferredId, \{ clearNotice: false \}\)[\s\S]*?catch[\s\S]*?连接列表刷新失败/)
  for (const operation of [existingSave, remove]) {
    assert.ok(operation.indexOf("emit('changed'") < operation.indexOf('refreshSourcesAfterMutation('))
  }
  assert.ok(create.indexOf("emit('changed'") < create.indexOf('refreshSourcesAfterMutation(source.id'))
  assert.ok(create.indexOf('enterCreatedSourceDetail(') < create.indexOf('refreshSourcesAfterMutation(source.id'))
  assert.doesNotMatch(create, /await refreshSources\(source\.id/)
  assert.match(create, /catch \(error\)[\s\S]*?createError\.value/)
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

test('announces dynamic list state and traps keyboard focus in the protocol picker', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')

  assert.match(template, /@keydown\.tab="trapManagerFocus"[\s\S]*?@keydown\.esc\.stop\.prevent="handleManagerEscape"/)
  assert.match(template, /data-testid="source-result-count"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(template, /class="filtered-selection-notice"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(managerSource, /class="protocol-picker"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="protocol-picker-title"/)
  assert.match(managerSource, /function trapManagerFocus\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?\.focus\(\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('uses a protocol-only picker before entering the full-page create workbench', () => {
  const pickerFlow = sourceBetween(managerSource, 'function openProtocolPicker()', 'function createSourcePayload')
  const picker = sourceBetween(managerSource, '<form ref="protocolPickerElement"', '</form>')
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')

  assert.match(managerSource, /const CREATE_PROTOCOL_ORDER = Object\.freeze\(\[\s*'HTTP',\s*'WebSocket',\s*'Socket',\s*'MQTT',\s*'Redis',\s*'MySQL',\s*'SQL Server'\s*\]\)/)
  assert.match(managerSource, /const protocolChoice = ref\(CREATE_PROTOCOL_ORDER\[0\]\)/)
  assert.match(picker, /class="protocol-picker"[\s\S]*?role="radiogroup"[\s\S]*?v-for="protocol in CREATE_PROTOCOL_ORDER"/)
  assert.match(picker, /role="radio"[\s\S]*?:aria-checked="protocolChoice === protocol"[\s\S]*?chooseCreateProtocol\(protocol\)/)
  assert.match(picker, /@submit\.prevent="startCreateConnection"[\s\S]*?下一步：配置连接/)
  assert.doesNotMatch(picker, /连接名称|request-address-bar|createDraft\.config/)
  assert.match(pickerFlow, /function startCreateConnection\(\)[\s\S]*?createSourceDraft\(protocol\)[\s\S]*?managerView\.value = 'create'/)
  assert.match(pickerFlow, /nextTick\(\(\) => createNameInput\.value\?\.focus\(\)\)/)
  assert.match(main, /managerView === 'create'[\s\S]*?class="source-detail source-api-workbench"/)
  assert.match(main, /<input ref="createNameInput" v-model="activeDraft\.name"/)
})

test('keeps one full-width new connection action above the compact search form', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')
  const primaryActions = sourceBetween(sidebar, '<form class="sidebar-primary-actions"', '</form>')
  const createButtonIndex = sidebar.indexOf('class="sidebar-create-button"')
  const searchFormIndex = sidebar.indexOf('<form class="sidebar-primary-actions"')

  assert.ok(createButtonIndex >= 0, 'expected the full-width new connection action')
  assert.ok(searchFormIndex > createButtonIndex, 'expected the search form below the new connection action')
  assert.equal((sidebar.match(/class="sidebar-create-button"/g) || []).length, 1)
  assert.match(sidebar, /class="sidebar-create-button"[^>]*data-testid="source-create-button"[^>]*@click="openProtocolPicker"[\s\S]*?<Plus \/><span>新建连接<\/span>/)
  assert.match(primaryActions, /class="sidebar-search"[\s\S]*?v-model="sourceQueryInput"[\s\S]*?class="sidebar-search-button"[^>]*type="submit"/)
  assert.doesNotMatch(primaryActions, /sidebar-create-button|新建连接|openProtocolPicker/)
  assert.match(managerSource, /\.sidebar-primary-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*36px;/)
  assert.match(managerSource, /\.sidebar-create-button\s*\{[^}]*min-height:\s*44px;[^}]*margin:\s*12px\s*12px\s*0;/)
})

test('renders the shared workbench instead of the empty state after choosing a protocol', () => {
  const createFlow = sourceBetween(managerSource, 'function startCreateConnection()', 'function createSourcePayload')
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const overviewIndex = main.indexOf('<section v-else-if="managerView === \'overview\'"')
  const emptyIndex = main.indexOf('<div v-else-if="managerView !== \'create\' && !selectedSource"')
  const workbenchIndex = main.indexOf('<fieldset v-else class="source-detail source-api-workbench"')

  assert.match(createFlow, /selectedSource\.value = null[\s\S]*?managerView\.value = 'create'/)
  assert.ok(overviewIndex >= 0 && emptyIndex > overviewIndex && workbenchIndex > emptyIndex)
  assert.match(main, /v-else-if="managerView !== 'create' && !selectedSource"/)
  assert.match(main, /<fieldset v-else class="source-detail source-api-workbench"/)
  assert.match(main, /class="workbench-panel-heading"[\s\S]*?activeWorkbenchCopy\.title/)
  assert.match(main, /v-model="activeDraft\.name"/)

  const protocolChoice = { value: 'HTTP' }
  const createDraft = { value: null }
  const createError = { value: 'stale error' }
  const createTestResult = { value: { ok: false } }
  const createTestContext = { value: 'draft' }
  const createResponseText = { value: 'stale response' }
  const createResponseSnapshot = { value: { data: { stale: true } } }
  const createAdvancedOpen = { value: true }
  const createDraftBaseline = { value: '' }
  const protocolPickerOpen = { value: true }
  const selectedSourceId = { value: 'old-source' }
  const selectedSource = { value: { id: 'old-source' } }
  const managerView = { value: 'overview' }
  let fillDraftValue = Symbol('not-called')
  let focusCalls = 0
  const createHarness = new Function(
    'protocolChoice',
    'createDraft',
    'createError',
    'createTestResult',
    'createTestContext',
    'createResponseText',
    'createResponseSnapshot',
    'createAdvancedOpen',
    'createDraftBaseline',
    'protocolPickerOpen',
    'selectedSourceId',
    'selectedSource',
    'managerView',
    'setFillDraftValue',
    'recordFocus',
    `const CREATE_PROTOCOL_ORDER = ['HTTP', 'WebSocket', 'Socket', 'MQTT', 'Redis', 'MySQL', 'SQL Server']
     const createSourceDraft = protocol => ({ name: '', protocol, enabled: true, config: { method: 'GET', url: '' } })
     const sourceDraftSnapshot = value => JSON.stringify(value)
     const createNameInput = { value: { focus: recordFocus } }
     const nextTick = callback => callback()
     const fillDraft = value => setFillDraftValue(value)
     let protocolPickerTrigger = { focus() {} }
     let selectionGeneration = 0
     ${createFlow}
     return { startCreateConnection, selectionGeneration: () => selectionGeneration }`
  )
  const harness = createHarness(
    protocolChoice,
    createDraft,
    createError,
    createTestResult,
    createTestContext,
    createResponseText,
    createResponseSnapshot,
    createAdvancedOpen,
    createDraftBaseline,
    protocolPickerOpen,
    selectedSourceId,
    selectedSource,
    managerView,
    value => { fillDraftValue = value },
    () => { focusCalls += 1 }
  )

  harness.startCreateConnection()
  assert.deepEqual(createDraft.value, {
    name: '',
    protocol: 'HTTP',
    enabled: true,
    config: { method: 'GET', url: '' }
  })
  assert.equal(managerView.value, 'create')
  assert.equal(protocolPickerOpen.value, false)
  assert.equal(selectedSourceId.value, '')
  assert.equal(selectedSource.value, null)
  assert.equal(fillDraftValue, null)
  assert.equal(createError.value, '')
  assert.equal(createTestResult.value, null)
  assert.equal(createTestContext.value, '')
  assert.equal(createResponseText.value, '')
  assert.equal(createResponseSnapshot.value, null)
  assert.equal(createAdvancedOpen.value, false)
  assert.equal(createDraftBaseline.value, JSON.stringify(createDraft.value))
  assert.equal(harness.selectionGeneration(), 1)
  assert.equal(focusCalls, 1)
})

test('keeps the untested JSON point area empty until a response snapshot exists', () => {
  const previewState = sourceBetween(managerSource, 'const responsePointPreview', 'const RESPONSE_POINT_ROW_LIMIT')
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const pointArea = sourceBetween(main, '<div class="response-points"', '</section>')

  assert.match(previewState, /activeResponseSnapshot\.value/)
  assert.match(
    previewState,
    /(?:if\s*\(\s*!activeResponseSnapshot\.value(?:\s*\|\|\s*activeResponseSnapshot\.value\.data\s*===\s*undefined)?\s*\)\s*return\s*\[\]|\?\s*createJsonResponsePointPreview\([\s\S]*?:\s*\[\])/,
    'an untested connection must expose zero parsed point rows'
  )
  assert.match(pointArea, /<table v-if="responsePointRows\.length">/)
  assert.match(pointArea, /<div v-else class="response-points-empty">测试成功后展示可绑定的 JSON 字段<\/div>/)
})

test('removes the legacy full connection dialog and keeps only the protocol picker overlay', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  const pickerBackdrop = sourceBetween(template, '<div v-if="protocolPickerOpen" class="dialog-backdrop"', '</form>')

  assert.equal((template.match(/class="dialog-backdrop"/g) || []).length, 1)
  assert.doesNotMatch(template, /class="(?:create-dialog|create-source-dialog|connection-config-dialog)"/)
  assert.doesNotMatch(managerSource, /function (?:openCreateDialog|closeCreateDialog)\(/)
  assert.match(pickerBackdrop, /class="protocol-picker"[\s\S]*?选择连接类型[\s\S]*?下一步：配置连接/)
  assert.doesNotMatch(pickerBackdrop, /连接名称|request-address-bar|create-config-grid|测试结果|source-save-button|source-test-button/)
})

test('keeps save and test as independent API-style actions', () => {
  const createSave = sourceBetween(managerSource, 'async function saveCreatedSource()', 'async function removeSource')
  const existingSave = sourceBetween(managerSource, 'async function saveExistingSource()', 'async function saveConnection')
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const requestPane = sourceBetween(main, '<section class="source-request-pane">', '<section class="source-response-pane')

  assert.match(createSave, /gateway\.createSource\(payload\)/)
  assert.doesNotMatch(createSave, /testSourceDraft|gateway\.testSource\(|getSourceSnapshot/)
  assert.match(existingSave, /gateway\.updateSource\(operationSourceId/)
  assert.doesNotMatch(existingSave, /testSourceDraft|gateway\.testSource\(|createSource/)
  assert.match(main, /class="secondary-button source-test-button"[\s\S]*?@click="testConnection"[\s\S]*?class="primary-button source-save-button"[\s\S]*?@click="saveConnection"/)
  assert.doesNotMatch(requestPane, /saveConnection|testConnection/)
})

test('preserves every advanced value in existing-save, create-save and draft-test payloads while collapsed', () => {
  const sourceDraftPatchSource = sourceBetween(managerSource, 'function sourceDraftPatch()', 'function confirmDiscardSourceDraft')
  const createSourcePayloadSource = sourceBetween(managerSource, 'function createSourcePayload()', 'function formatTestResponse')
  const activeConnectionPayloadSource = sourceBetween(managerSource, 'function activeConnectionPayload()', 'function clearActiveTestPreview')
  const sourceDraft = { value: null }
  const createDraft = { value: null }
  const activeDraft = { value: null }
  const managerView = { value: 'detail' }
  const selectedSource = { value: { id: 'source-advanced' } }
  const activeProtocol = { value: 'HTTP' }
  const payloads = new Function(
    'sourceDraft',
    'createDraft',
    'activeDraft',
    'managerView',
    'selectedSource',
    'activeProtocol',
    `${sourceDraftPatchSource}\n${createSourcePayloadSource}\n${activeConnectionPayloadSource}\nreturn { sourceDraftPatch, createSourcePayload, activeConnectionPayload }`
  )(sourceDraft, createDraft, activeDraft, managerView, selectedSource, activeProtocol)

  for (const [protocol, fields] of Object.entries(POINT_SOURCE_CONFIG_FIELDS)) {
    const config = Object.fromEntries(fields.map(field => [
      field.key,
      field.section === 'advanced' ? `advanced:${protocol}:${field.key}` : field.default
    ]))
    sourceDraft.value = { name: ' existing ', enabled: true, config }
    createDraft.value = { name: ' created ', protocol, enabled: false, config }
    activeDraft.value = sourceDraft.value
    activeProtocol.value = protocol

    const existingSavePayload = payloads.sourceDraftPatch()
    const createSavePayload = payloads.createSourcePayload()
    const draftTestPayload = payloads.activeConnectionPayload()
    for (const field of fields.filter(field => field.section === 'advanced')) {
      const expected = config[field.key]
      assert.equal(existingSavePayload.config[field.key], expected, `${protocol} existing save lost ${field.key}`)
      assert.equal(createSavePayload.config[field.key], expected, `${protocol} create save lost ${field.key}`)
      assert.equal(draftTestPayload.config[field.key], expected, `${protocol} draft test lost ${field.key}`)
    }
    assert.notEqual(existingSavePayload.config, config)
    assert.notEqual(createSavePayload.config, config)
    assert.notEqual(draftTestPayload.config, config)
  }
})

test('enters the created detail before refreshing and preserves it when refresh fails', () => {
  const createFlow = sourceBetween(managerSource, 'async function saveCreatedSource()', 'async function removeSource')
  const createIndex = createFlow.indexOf('await props.gateway.createSource(payload)')
  const detailIndex = createFlow.indexOf('enterCreatedSourceDetail(source)')
  const refreshIndex = createFlow.indexOf("await refreshSourcesAfterMutation(source.id, '连接已保存')")

  assert.ok(createIndex >= 0 && detailIndex > createIndex && refreshIndex > detailIndex)
  assert.doesNotMatch(createFlow, /await refreshSources\(source\.id/)
  assert.match(managerSource, /function enterCreatedSourceDetail\(source\)[\s\S]*?selectedSourceId\.value = createdSource\.id[\s\S]*?selectedSource\.value = createdSource[\s\S]*?managerView\.value = 'detail'/)
})

test('guards the full-page create draft and shares one API workbench between create and edit', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')

  assert.match(managerSource, /const createDraftDirty = computed\(\(\) => \([\s\S]*?managerView\.value === 'create'[\s\S]*?createDraftBaseline\.value/)
  assert.match(managerSource, /function confirmDiscardSourceDraft\(\)[\s\S]*?!sourceDraftDirty\.value && !createDraftDirty\.value/)
  assert.match(main, /v-model="activeDraft\.name"/)
  assert.match(main, /workbenchFields\(activeBasicFields, activeProtocol, 'basic'\)/)
  assert.match(main, /v-for="field in activeAdvancedFields"/)
  assert.equal((main.match(/class="source-detail source-api-workbench"/g) || []).length, 1)
  assert.match(styles, /\.source-api-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/)
})

test('renders a bounded JSON point preview with path, type, value and snapshot quality', () => {
  const main = sourceBetween(managerSource, '<main class="source-main">', '</main>')
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')

  assert.match(managerSource, /if \(!activeResponseSnapshot\.value \|\| activeResponseSnapshot\.value\.data === undefined\) return \[\][\s\S]*?createJsonResponsePointPreview\(activeResponseSnapshot\.value\.data, \{[\s\S]*?maxRows:\s*80[\s\S]*?maxDepth:\s*8[\s\S]*?maxChildren:\s*40/)
  assert.match(managerSource, /const RESPONSE_POINT_ROW_LIMIT = 80/)
  assert.match(main, /data-testid="source-response-points"[\s\S]*?最多展示 \{\{ RESPONSE_POINT_ROW_LIMIT \}\} 项/)
  assert.match(main, /JSON 路径[\s\S]*?类型[\s\S]*?当前值[\s\S]*?质量/)
  assert.match(main, /v-for="row in responsePointRows"[\s\S]*?row\.path[\s\S]*?row\.type[\s\S]*?row\.value[\s\S]*?class="point-quality"[\s\S]*?activeTestContext === 'official'[\s\S]*?responsePointQualityLabel/)
  assert.match(styles, /\.point-quality\.good\s*\{[^}]*color:/)
  assert.match(styles, /\.point-quality\.(?:bad|error)[\s\S]*?\.point-quality\.unknown\s*\{[^}]*color:/)
  assert.doesNotMatch(main, /<td class="point-quality">/)
})

test('keeps the protocol picker and shared workbench usable on narrow screens', () => {
  const styles = sourceBetween(managerSource, '<style scoped>', '</style>')
  const mobile = styles.slice(styles.indexOf('@media (max-width: 680px)'))

  assert.match(styles, /\.protocol-picker-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/)
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.source-api-workbench\s*\{[^}]*grid-template-columns:\s*1fr;/)
  assert.match(mobile, /\.protocol-picker-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/)
  assert.match(mobile, /\.create-config-grid\s*\{[^}]*grid-template-columns:\s*1fr;/)
})
