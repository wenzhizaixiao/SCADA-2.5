import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeNode } from '../src/models/editorModel.js'
import { resolveNodeDataBindings } from '../src/models/dataBindingModel.js'
import { sourceBindingRuntimeKey } from '../src/utils/jsonPathBinding.js'
import { materializeRuntimeNode } from '../src/utils/runtimeNodeMaterializer.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const bindingPanelSource = readFileSync(new URL('../src/components/CommunicationBindingPanel.vue', import.meta.url), 'utf8')
const sourceManagerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')
const catalogSource = readFileSync(new URL('../src/config/componentCatalog.js', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

test('opens one workspace-level data source manager from the final toolbar group', () => {
  assert.match(catalogSource, /id:\s*'dataSource'[\s\S]*?label:\s*'数据源'/)
  const editorToolsSource = sourceBetween(catalogSource, 'export const EDITOR_TOOLS', 'export const WORKSPACE_TOOLS')
  const workspaceToolsSource = sourceBetween(catalogSource, 'export const WORKSPACE_TOOLS', 'const COMPONENT_GROUPS')
  assert.doesNotMatch(editorToolsSource, /id:\s*'dataSource'/)
  assert.match(workspaceToolsSource, /id:\s*'dataSource'/)
  assert.match(appSource, /toolbar-group-divider[\s\S]*?v-for="t in workspaceTools"/)
  assert.ok(
    appSource.indexOf('v-for="t in workspaceTools"') > appSource.indexOf('@click="showGrid = !showGrid"'),
    'workspace-level data source entry should be the final toolbar category'
  )
  assert.match(appSource, /import DataSourceManager from '\.\/components\/DataSourceManager\.vue'/)
  assert.match(appSource, /if \(id === 'dataSource'\)[\s\S]*?dataSourceManagerOpen\.value = true[\s\S]*?return/)
  assert.match(appSource, /<DataSourceManager[\s\S]*?v-if="dataSourceManagerOpen"[\s\S]*?:gateway="pointCatalogGateway"/)

  assert.match(sourceManagerSource, /数据源管理/)
  assert.match(sourceManagerSource, /基础信息/)
  assert.match(sourceManagerSource, /测试连接/)
  assert.doesNotMatch(sourceManagerSource, /数据点位|查看全部点位|runPointSearch|querySourcePoints/)
})

test('keeps page navigation and connection management in their expected locations', () => {
  const managerHeaderSource = sourceBetween(sourceManagerSource, '<header class="manager-header">', '</header>')
  const managerSidebarSource = sourceBetween(sourceManagerSource, '<aside class="source-sidebar">', '</aside>')

  assert.doesNotMatch(managerHeaderSource, /ArrowLeft|openCreateDialog|新建连接/)
  assert.match(managerHeaderSource, /class="icon-button manager-close"[\s\S]*?<X \/>/)
  assert.match(managerHeaderSource, /aria-label="关闭数据源管理，返回图纸"[\s\S]*?emit\('close'\)/)
  assert.match(managerSidebarSource, /class="sidebar-create-button"[\s\S]*?openCreateDialog[\s\S]*?新建连接/)
  assert.match(managerSidebarSource, /class="source-item-manage"[\s\S]*?编辑连接：[\s\S]*?<Pencil \/>/)
  assert.match(managerSidebarSource, /@click="selectSource\(source\.id\)"/)
})

test('wires selected component parameters and the source snapshot runtime into Communication', () => {
  assert.match(appSource, /import CommunicationBindingPanel from '\.\/components\/CommunicationBindingPanel\.vue'/)
  assert.match(appSource, /import \{[^}]*pointCatalogGateway[^}]*runtimeGateway[^}]*\} from '\.\/services\/backend'/)
  assert.match(appSource, /import \{ createSourceBindingRuntime \} from '\.\/services\/sourceBindingRuntime'/)
  assert.match(appSource, /const sourceBindingRuntime = createSourceBindingRuntime\([\s\S]*?runtimeGateway\.send\(updates\)/)
  assert.match(appSource, /pointCatalogGateway\.subscribeSnapshots\?\.\(snapshot => \{[\s\S]*?sourceBindingRuntime\.ingest\(snapshot\)/)
  assert.match(appSource, /<CommunicationBindingPanel[\s\S]*?:node="selectedNodeCount === 1 \? selected : null"[\s\S]*?:parameters="selectedBindingParameters"[\s\S]*?:gateway="pointCatalogGateway"[\s\S]*?@bind="bindSelectedParameter"[\s\S]*?@unbind="unbindSelectedParameter"/)
  assert.doesNotMatch(appSource, /<CommunicationBindingPanel[\s\S]*?:points="pointCatalog"/)
  assert.match(bindingPanelSource, /gateway:\s*\{ type: Object, default: null \}/)
  assert.doesNotMatch(bindingPanelSource, /querySourcePoints|listPoints|searchPoints/)
})

test('data source mutations invalidate the communication source cache immediately', () => {
  assert.match(appSource, /const dataSourceRevision = ref\(0\)/)
  assert.match(appSource, /function handleDataSourceChanged\([\s\S]*?dataSourceRevision\.value \+= 1/)
  assert.match(appSource, /<DataSourceManager[\s\S]*?@changed="handleDataSourceChanged"/)
  assert.match(appSource, /<CommunicationBindingPanel[\s\S]*?:source-revision="dataSourceRevision"/)
  assert.match(bindingPanelSource, /sourceRevision:\s*\{ type: Number, default: 0 \}/)
  assert.match(bindingPanelSource, /async function refreshSourcesAfterMutation\(\)[\s\S]*?invalidateSourceCache\(\)[\s\S]*?loadSources\(\{ force: true \}\)[\s\S]*?loadSnapshot\(sourceId, \{ preservePath: true \}\)/)
  assert.match(bindingPanelSource, /watch\(\(\) => props\.sourceRevision,[\s\S]*?refreshSourcesAfterMutation\(\)/)
})

test('data source lifecycle relies on snapshot delivery without duplicate UI-triggered replays', () => {
  const replaySource = sourceBetween(appSource, 'async function replaySourceSnapshotsForNodes', 'function rebuildRuntimeDataKeyIndex')
  const replayCoordinatorSource = sourceBetween(appSource, 'const sourceSnapshotReplayCoordinator', 'const unsubscribeSourceSnapshots')
  const activateSource = sourceBetween(appSource, 'async function activatePointCatalogWorkspace', 'const unsubscribePointCatalog')
  const bindSource = sourceBetween(appSource, 'async function bindSelectedParameter', 'function unbindSelectedParameter')
  const managerSource = sourceBetween(appSource, 'function handleDataSourceChanged', 'function handleLockedBadgePointerDown')
  const saveSource = sourceBetween(sourceManagerSource, 'async function saveSource', 'async function testConnection')

  assert.match(replaySource, /\{ force = false \}/)
  assert.match(replaySource, /sourceSnapshotReplayCoordinator\.replay\(sourceIds, \{ force \}\)/)
  assert.match(replayCoordinatorSource, /sourceBindingRuntime\.ingest\(snapshot, options\)/)
  assert.match(activateSource, /if \(options\.replay !== false\) await replaySourceSnapshotsForNodes\(\)/)
  assert.match(bindSource, /JSON\.stringify\(current\) === JSON\.stringify\(nextBindings\)[\s\S]*?sourceBindingRuntime\.ingest\(snapshot, \{ replay: true \}\)/)
  const changeSource = sourceBetween(managerSource, 'function handleDataSourceChanged', 'function closeDataSourceManager')
  const closeSource = sourceBetween(appSource, 'function closeDataSourceManager', 'function handleLockedBadgePointerDown')
  assert.match(changeSource, /dataSourceRevision\.value \+= 1/)
  assert.doesNotMatch(changeSource, /sourceSnapshotReplayCoordinator|sourceBindingRuntime\.sourceIds|force: true/)
  assert.match(closeSource, /dataSourceManagerOpen\.value = false/)
  assert.doesNotMatch(closeSource, /replayIndexedSourceSnapshots|sourceSnapshotReplayCoordinator|force: true/)
  assert.doesNotMatch(`${changeSource}\n${closeSource}`, /nodes\.value|replaySourceSnapshotsForNodes/)
  assert.match(appSource, /<DataSourceManager[\s\S]*?@close="closeDataSourceManager"/)
  assert.match(appSource, /if \(dataSourceManagerOpen\.value\)[\s\S]*?e\.key === 'Escape'[\s\S]*?closeDataSourceManager\(\)/)
  assert.ok(saveSource.indexOf('if (invalid)') < saveSource.indexOf('props.gateway.updateSource'))
  assert.ok(saveSource.indexOf('return', saveSource.indexOf('if (invalid)')) < saveSource.indexOf('props.gateway.updateSource'))
  assert.ok(saveSource.indexOf("emit('changed'") > saveSource.indexOf('props.gateway.updateSource'))
})

test('source snapshot replay isolates unrelated sources and invalidates stale document work', () => {
  const replaySource = sourceBetween(appSource, 'async function replaySourceSnapshotsForNodes', 'function rebuildRuntimeDataKeyIndex')
  const activateSource = sourceBetween(appSource, 'async function activatePointCatalogWorkspace', 'const unsubscribePointCatalog')
  const resetSource = sourceBetween(appSource, 'function resetDocumentSession', 'function applyProject')
  const applySource = sourceBetween(appSource, 'function applyProject', 'function drawingFileName')
  const unmountSource = sourceBetween(appSource, 'onUnmounted(() => {', '</script>')

  assert.match(appSource, /import \{ createSourceSnapshotReplayCoordinator \} from '\.\/utils\/sourceSnapshotReplayCoordinator'/)
  assert.match(appSource, /const sourceSnapshotReplayCoordinator = createSourceSnapshotReplayCoordinator\(/)
  assert.match(replaySource, /sourceSnapshotReplayCoordinator\.replay\(sourceIds, \{ force \}\)/)
  assert.doesNotMatch(replaySource, /sourceSnapshotReplayGeneration/)
  assert.match(activateSource, /invalidateRuntimeDataReplays\(\)/)
  assert.match(resetSource, /invalidateRuntimeDataReplays\(\)/)
  assert.match(applySource, /const runtime = await projectRuntimePreparer\.prepare\(data\)[\s\S]*?installPreparedEntityCollections\(runtime\)/)
  assert.doesNotMatch(applySource, /replaySourceSnapshotsForNodes/)
  const installSource = sourceBetween(appSource, 'function installPreparedEntityCollections', 'function appendNodes')
  assert.match(installSource, /sourceSnapshotReplayCoordinator\.replay\(runtime\.sourceIds\)/)
  assert.match(unmountSource, /invalidateRuntimeDataReplays\(\)/)
})

test('disabled sources are presented as stopped even if their stored status is online', () => {
  assert.match(bindingPanelSource, /function sourceStatus\(source\)[\s\S]*?source\?\.enabled === false[\s\S]*?return '已停用'/)
  assert.match(sourceManagerSource, /function effectiveSourceStatus\(source\)[\s\S]*?source\?\.enabled === false[\s\S]*?return 'disabled'/)
  assert.match(sourceManagerSource, /statusLabel\(effectiveSourceStatus\(source\)\)/)
  assert.match(sourceManagerSource, /statusLabel\(effectiveSourceStatus\(selectedSource\)\)/)
})

test('source and JSON path selection remain pending until the user confirms the binding', () => {
  const openSource = sourceBetween(bindingPanelSource, 'async function openBindingPage', 'function changeSource')
  const sourceSelection = sourceBetween(bindingPanelSource, 'function changeSource', 'function selectTreePath')
  const pathSelection = sourceBetween(bindingPanelSource, 'function selectTreePath', 'function confirmBinding')
  const confirmation = sourceBetween(bindingPanelSource, 'function confirmBinding', 'function unbind')

  assert.match(openSource, /activeTarget\.value = target/)
  assert.match(openSource, /await loadSources\(\)/)
  assert.doesNotMatch(openSource, /emit\(['"]bind['"]/)
  assert.match(sourceSelection, /selectedSourceId\.value = text\(event\?\.target\?\.value\)/)
  assert.match(sourceSelection, /loadSnapshot\(selectedSourceId\.value\)/)
  assert.doesNotMatch(sourceSelection, /emit\(['"]bind['"]/)
  assert.match(pathSelection, /pathDraft\.value = payload\.path[\s\S]*?updatePathPreview\(\)/)
  assert.doesNotMatch(pathSelection, /emit\(['"]bind['"]/)
  assert.match(confirmation, /emit\('bind', \{[\s\S]*?target: activeTarget\.value,[\s\S]*?sourceId: selectedSourceId\.value,[\s\S]*?jsonPath: normalizedPath\.value/)
  assert.match(bindingPanelSource, /data-testid="communication-source-select"/)
  assert.match(bindingPanelSource, /<JsonPathTree\s+:value="snapshot\.data"[\s\S]*?@select="selectTreePath"/)
  assert.match(bindingPanelSource, /data-testid="communication-json-path-input"/)
  assert.match(bindingPanelSource, /data-testid="communication-establish-binding"[\s\S]*?@click="confirmBinding"/)
  assert.match(bindingPanelSource, /旧绑定待重新选择/)
})

test('communication snapshot reads are bounded and ignore stale asynchronous results', () => {
  assert.match(bindingPanelSource, /import \{ isUsableSourceSnapshot \} from '\.\.\/utils\/sourceSnapshotValidation\.js'/)
  assert.match(bindingPanelSource, /const sourceLoadGeneration =|let sourceLoadGeneration =/)
  assert.match(bindingPanelSource, /let snapshotLoadGeneration =/)
  assert.match(bindingPanelSource, /const nextSources = result\.slice\(0, 1000\)[\s\S]*?sources\.value = nextSources/)
  assert.match(bindingPanelSource, /if \(generation !== sourceLoadGeneration\) return/)
  assert.match(bindingPanelSource, /if \(generation !== snapshotLoadGeneration \|\| selectedSourceId\.value !== normalizedSourceId\) return/)
  assert.match(bindingPanelSource, /if \(!isUsableSourceSnapshot\(result, normalizedSourceId\)\)[\s\S]*?数据样例格式无效/)
  assert.match(bindingPanelSource, /onUnmounted\(\(\) => \{[\s\S]*?sourceLoadGeneration \+= 1[\s\S]*?snapshotLoadGeneration \+= 1/)
})

test('confirmed bindings update source indexes, legacy subscriptions and undo history', () => {
  const bindSource = sourceBetween(appSource, 'async function bindSelectedParameter', 'function unbindSelectedParameter')
  const synchronizeSource = sourceBetween(appSource, 'function synchronizeNodeDataBindings', 'async function bindSelectedParameter')
  const referenceSource = sourceBetween(appSource, 'function synchronizeRuntimeKeyReferences', 'function synchronizeNodeDataBindings')
  const historySource = sourceBetween(appSource, 'function synchronizeRuntimeKeysAfterHistory', 'function applyFieldsHistory')

  assert.match(bindSource, /canonicalizeJsonPath\(jsonPath\)/)
  assert.match(bindSource, /pointCatalogGateway\.getSourceSnapshot\(normalizedSourceId,\s*\{\s*shared:\s*true\s*\}\)/)
  assert.match(bindSource, /evaluateJsonPath\(snapshot\.data, normalizedPath\)/)
  assert.match(bindSource, /directBindingCompatibility\(parameter,/)
  assert.match(bindSource, /binding = \{ target, sourceId: normalizedSourceId, jsonPath: normalizedPath/)
  assert.match(bindSource, /binding = \{ target, pointId: normalizedPointId/)
  assert.match(bindSource, /upsertDataBinding\(node, binding\)/)
  assert.match(bindSource, /recordNodeFields\(node, \['dataBindings'\]\)/)
  assert.match(bindSource, /synchronizeNodeDataBindings\(node, nextBindings\)/)
  assert.match(bindSource, /sourceBindingRuntime\.ingest\(snapshot\)/)
  assert.match(synchronizeSource, /runtimeBindingPointIndex\.update\(node\)/)
  assert.match(synchronizeSource, /sourceBindingRuntime\.updateNode\(node\)/)
  assert.match(synchronizeSource, /replaySourceSnapshotsForNodes\(\[node\]\)/)
  assert.match(referenceSource, /unregisterRuntimeDataKeys\(removedKeys\)/)
  assert.match(referenceSource, /registerRuntimeDataKeys\(addedKeys\)/)
  assert.match(referenceSource, /replayPointCatalogValues\(addedKeys\)/)
  assert.match(historySource, /sourceBindingRuntime\.updateNode\(node\)/)
  assert.match(historySource, /synchronizeRuntimeKeyReferences\(previousKeys, nextKeys\)/)
})

test('binding confirmation rejects malformed or cross-source snapshots before evaluating JSONPath', () => {
  const bindSource = sourceBetween(appSource, 'async function bindSelectedParameter', 'function unbindSelectedParameter')
  assert.match(appSource, /import \{ isUsableSourceSnapshot \} from '\.\/utils\/sourceSnapshotValidation'/)
  assert.match(bindSource, /if \(!isUsableSourceSnapshot\(snapshot, normalizedSourceId\)\) throw new Error\(/)
  assert.ok(
    bindSource.indexOf('isUsableSourceSnapshot(snapshot, normalizedSourceId)') < bindSource.indexOf('evaluateJsonPath(snapshot.data, normalizedPath)'),
    'snapshot ownership and shape must be verified before reading data'
  )
})

test('prepared bundles register source bindings and replay their latest snapshots', () => {
  const commitBundleSource = sourceBetween(
    appSource,
    'function commitPreparedNodeBundle',
    'function scheduleBundleFrame'
  )

  // 粘贴和“我的组件”共用该原子提交路径，必须走与普通新增组件相同的运行时入口。
  assert.match(commitBundleSource, /addRuntimeDataNodes\(ready\.nodes\)/)
  assert.doesNotMatch(commitBundleSource, /runtimeBindingPointIndex\.add\(ready\.nodes\)/)
})

test('dynamically inserted legacy bindings use a targeted point batch with document lifecycle guards', () => {
  const addRuntimeSource = sourceBetween(appSource, 'function addRuntimeDataNodes', 'function removeRuntimeDataNodes')
  const replaySetupSource = sourceBetween(appSource, 'const legacyPointReplayCoordinator', 'const unsubscribeSourceSnapshots')
  const invalidateSource = sourceBetween(appSource, 'function invalidateRuntimeDataReplays', 'async function replaySourceSnapshotsForNodes')
  const catalogSubscriptionSource = sourceBetween(appSource, 'const unsubscribePointCatalog', '// 画布、视口及临时编辑器状态')

  assert.match(appSource, /import \{ createLegacyPointReplayCoordinator \} from '\.\/utils\/legacyPointReplayCoordinator'/)
  assert.match(replaySetupSource, /pointCatalogGateway\.getPointsByIds\(pointIds\)/)
  assert.match(replaySetupSource, /hasActiveRuntimeDataKey\(pointId\)/)
  assert.match(replaySetupSource, /runtimeGateway\.send\(updates\)/)
  assert.match(addRuntimeSource, /legacyPointReplayCoordinator\.replay\(legacyPointIdsForNodes\(source\)\)/)
  assert.doesNotMatch(addRuntimeSource, /legacyPointIdsForNodes\(\)/)
  assert.match(invalidateSource, /sourceSnapshotReplayCoordinator\.invalidate\(\)/)
  assert.match(invalidateSource, /legacyPointReplayCoordinator\.invalidate\(\)/)
  assert.match(catalogSubscriptionSource, /if \(event\?\.type === 'workspace-activated'\) return[\s\S]*?if \(!event\?\.catalogChanged\) return[\s\S]*?legacyPointReplayCoordinator\.invalidate\(\)[\s\S]*?indexedLegacyPointIds\(\)[\s\S]*?refreshPointCatalog\(\{ requiredIds \}\)/)
  assert.doesNotMatch(catalogSubscriptionSource, /legacyPointIdsForNodes|nodes\.value/)
  assert.ok(
    catalogSubscriptionSource.indexOf('legacyPointReplayCoordinator.invalidate()') < catalogSubscriptionSource.indexOf('refreshPointCatalog({ requiredIds })'),
    'catalog mutations must cancel stale point reads before refreshing values'
  )
})

test('delayed binding confirmation cannot mutate a component after selection changes', () => {
  const bindSource = sourceBetween(appSource, 'async function bindSelectedParameter', 'function unbindSelectedParameter')
  assert.match(appSource, /let bindingOperationGeneration = 0/)
  assert.match(appSource, /watch\(\[selectedId, selectedNodeIds\],[\s\S]*?bindingOperationGeneration \+= 1[\s\S]*?flush: 'sync'/)
  assert.match(bindSource, /const operationGeneration = \+\+bindingOperationGeneration/)
  assert.match(bindSource, /operationGeneration !== bindingOperationGeneration/)
  assert.match(bindSource, /selectedNodeCount\.value !== 1/)
  assert.match(bindSource, /selected\.value !== node/)
})

test('saved source bindings and legacy point bindings round-trip without mutating static properties', () => {
  const sourceNode = {
    id: 'node-runtime-binding',
    type: 'progress',
    fill: '#ffffff',
    text: '静态名称',
    progressValue: 20,
    dataBindings: [
      { target: 'text', sourceId: 'source-mqtt', jsonPath: "$.device['name']", enabled: true },
      { target: 'progressValue', pointId: 'mqtt.motor01.load', enabled: true }
    ]
  }
  const normalized = normalizeNode(JSON.parse(JSON.stringify(sourceNode)))
  const before = structuredClone(normalized)
  const sourceTextKey = sourceBindingRuntimeKey('source-mqtt', '$.device.name')
  const runtimeValues = new Map([
    [sourceTextKey, '一号风机'],
    ['mqtt.motor01.load', 68]
  ])

  assert.deepEqual(normalized.dataBindings, [
    { target: 'text', sourceId: 'source-mqtt', jsonPath: '$.device.name', enabled: true },
    { target: 'progressValue', pointId: 'mqtt.motor01.load', enabled: true }
  ])
  assert.deepEqual(resolveNodeDataBindings(normalized, key => runtimeValues.get(key)), {
    text: '一号风机',
    progressValue: 68
  })

  const effective = materializeRuntimeNode(normalized, key => runtimeValues.get(key))
  assert.notStrictEqual(effective, normalized)
  assert.equal(effective.text, '一号风机')
  assert.equal(effective.progressValue, 68)
  assert.deepEqual(normalized, before)

  const fallback = materializeRuntimeNode(normalized, () => undefined)
  assert.equal(fallback.text, '静态名称')
  assert.equal(fallback.progressValue, 20)
  assert.deepEqual(normalized, before)
})
