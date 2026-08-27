import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createLocalPointCatalogGateway } from '../src/services/pointCatalogGateway.js'
import { createWorkspacePointSourceStore } from '../src/services/workspacePointSourceStore.js'
import { drawingPointSourceScopeId } from '../src/utils/drawingPointSourceScope.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const managerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

function sourceFixture(name = '一号图纸接口', value = 18) {
  return [{
    id: 'source-http-line',
    name,
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: { url: 'https://gateway.example/realtime' },
    points: [{
      id: 'line.temperature',
      name: '产线温度',
      type: 'number',
      value,
      status: 'good',
      updatedAt: '2026-08-15T00:00:00.000Z'
    }]
  }]
}

test('drawing source scope is stable, normalized, bounded and collision resistant', () => {
  const composed = drawingPointSourceScopeId('caf\u00e9', 'project-a')
  const decomposed = drawingPointSourceScopeId('cafe\u0301', 'project-a')
  assert.equal(composed, decomposed)
  assert.equal(drawingPointSourceScopeId(' workspace-a ', ' project-a '), drawingPointSourceScopeId('workspace-a', 'project-a'))
  assert.notEqual(drawingPointSourceScopeId('workspace-a', 'project-a'), drawingPointSourceScopeId('workspace-a', 'project-b'))
  assert.notEqual(drawingPointSourceScopeId('workspace-a', 'project-a'), drawingPointSourceScopeId('workspace-b', 'project-a'))
  assert.notEqual(drawingPointSourceScopeId('a:b', 'c'), drawingPointSourceScopeId('a', 'b:c'))

  const maximumWorkspace = 'w'.repeat(64)
  const first = drawingPointSourceScopeId(maximumWorkspace, `project-${'a'.repeat(80)}`)
  const second = drawingPointSourceScopeId(maximumWorkspace, `project-${'b'.repeat(80)}`)
  assert.ok(first.length <= 64, `scope exceeds gateway identity boundary: ${first.length}`)
  assert.ok(second.length <= 64, `scope exceeds gateway identity boundary: ${second.length}`)
  assert.notEqual(first, second, 'long project identities must not be truncated into the same storage scope')
  assert.throws(() => drawingPointSourceScopeId('workspace-a', ''), /图纸|project/i)
})

test('same workspace keeps every drawing source catalog isolated while switching tabs', async () => {
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const gateway = createLocalPointCatalogGateway({ store, sources: [] })
  const drawingA = drawingPointSourceScopeId('workspace-a', 'project-a')
  const drawingB = drawingPointSourceScopeId('workspace-a', 'project-b')

  await gateway.activateWorkspace(drawingA)
  const sourceA = await gateway.createSource({ name: 'A 图纸 HTTP', protocol: 'HTTP' })
  await gateway.updateSource(sourceA.id, { config: { url: 'https://a.example/data' } })

  await gateway.activateWorkspace(drawingB)
  assert.deepEqual(await gateway.listSources(), [])
  const sourceB = await gateway.createSource({ name: 'B 图纸 MQTT', protocol: 'MQTT' })
  assert.equal((await gateway.getSource(sourceA.id)), null)

  await gateway.activateWorkspace(drawingA)
  assert.equal((await gateway.getSource(sourceA.id)).name, 'A 图纸 HTTP')
  assert.equal(await gateway.getSource(sourceB.id), null)

  await gateway.activateWorkspace(drawingB)
  assert.equal((await gateway.getSource(sourceB.id)).name, 'B 图纸 MQTT')
  assert.equal(await gateway.getSource(sourceA.id), null)
})

test('opening a legacy drawing copies its workspace catalog once without retaining shared mutations', async () => {
  const workspaceId = 'legacy-workspace'
  const drawingScope = drawingPointSourceScopeId(workspaceId, 'legacy-project')
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, sourceFixture('旧工作空间接口', 18))

  const gateway = createLocalPointCatalogGateway({ store, sources: [] })
  await gateway.activateWorkspace(drawingScope, { legacyWorkspaceId: workspaceId })
  assert.equal((await gateway.getSource('source-http-line')).name, '旧工作空间接口')
  assert.deepEqual((await store.load(drawingScope)).map(source => source.name), ['旧工作空间接口'])

  await gateway.updateSource('source-http-line', { name: '当前图纸独立接口' })
  await gateway.activateWorkspace(workspaceId)
  assert.equal((await gateway.getSource('source-http-line')).name, '旧工作空间接口')
  await gateway.updateSource('source-http-line', { name: '旧目录后续修改' })

  // 目标图纸已经初始化后必须以自己的目录为准，不能被旧工作空间再次覆盖。
  await gateway.activateWorkspace(drawingScope, { legacyWorkspaceId: workspaceId })
  assert.equal((await gateway.getSource('source-http-line')).name, '当前图纸独立接口')
})

test('an initialized empty drawing catalog never falls back to legacy workspace sources', async () => {
  const workspaceId = 'legacy-empty-boundary'
  const drawingScope = drawingPointSourceScopeId(workspaceId, 'empty-project')
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, sourceFixture())
  await store.save(drawingScope, [])

  const gateway = createLocalPointCatalogGateway({ store, sources: sourceFixture('代码默认接口') })
  await gateway.activateWorkspace(drawingScope, { legacyWorkspaceId: workspaceId })
  assert.deepEqual(await gateway.listSources(), [])
  assert.deepEqual(await store.load(drawingScope), [])
})

test('a new blank drawing does not inherit the former workspace catalog implicitly', async () => {
  const workspaceId = 'new-paper-workspace'
  const drawingScope = drawingPointSourceScopeId(workspaceId, 'new-project')
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  await store.save(workspaceId, sourceFixture())

  const gateway = createLocalPointCatalogGateway({ store, sources: [] })
  await gateway.activateWorkspace(drawingScope)
  assert.deepEqual(await gateway.listSources(), [])
  assert.deepEqual(await store.load(drawingScope), [])
})

test('a late snapshot tagged with the previous drawing scope cannot enter the active drawing', async () => {
  const sourceId = 'source-http-line'
  const storage = createMemoryStorage()
  const store = createWorkspacePointSourceStore({ storage })
  const drawingA = drawingPointSourceScopeId('workspace-a', 'project-a')
  const drawingB = drawingPointSourceScopeId('workspace-a', 'project-b')
  await store.save(drawingA, sourceFixture('A 图纸接口', 18))
  await store.save(drawingB, sourceFixture('B 图纸接口', 26))

  const gateway = createLocalPointCatalogGateway({ store, sources: [] })
  await gateway.activateWorkspace(drawingA)
  const drawingAGeneration = gateway.activeWorkspaceGeneration
  await gateway.activateWorkspace(drawingB)
  const before = await gateway.getSourceSnapshot(sourceId)
  assert.equal(before.workspaceId, drawingB, 'every published snapshot must identify its drawing scope')
  assert.equal(before.workspaceGeneration, gateway.activeWorkspaceGeneration)
  assert.notEqual(before.workspaceGeneration, drawingAGeneration)

  gateway.ingestSourceSnapshot(sourceId, { value: 999 }, {
    quality: 'good',
    workspaceId: drawingA,
    origin: 'late-adapter-frame'
  })
  gateway.ingestSourceSnapshot(sourceId, { value: 1000 }, {
    quality: 'good',
    workspaceGeneration: drawingAGeneration,
    origin: 'late-generation-frame'
  })

  const after = await gateway.getSourceSnapshot(sourceId)
  assert.deepEqual(after.data, before.data)
  assert.equal(after.revision, before.revision)
  assert.equal(after.workspaceId, drawingB)
  assert.equal(gateway.activeWorkspaceId, drawingB)
})

test('App scopes activation to projectId and only activates data collection for the current paper', () => {
  assert.match(appSource, /import \{ drawingPointSourceScopeId \} from '\.\/utils\/drawingPointSourceScope(?:\.js)?'/)
  assert.match(appSource, /drawingPointSourceScopeId\(workspaceId\.value,\s*projectId\.value\)/)
  assert.match(appSource, /activatePointCatalogDrawing/)

  const drawingActivation = appSource.slice(
    appSource.indexOf('async function activatePointCatalogDrawing'),
    appSource.indexOf('async function activateCurrentDrawingPointCatalog')
  )
  assert.match(appSource, /let pointCatalogActivationGeneration = 0/)
  assert.match(drawingActivation, /const activationGeneration = \+\+pointCatalogActivationGeneration/)
  assert.match(drawingActivation, /const activationIsCurrent = \(\) => \([\s\S]*?workspaceId\.value === normalizedWorkspace[\s\S]*?projectId\.value === normalizedDrawingId/)
  assert.match(drawingActivation, /pointCatalogGateway\.activateWorkspace\(targetScopeId,[\s\S]*?publishSnapshots:\s*false/)
  assert.match(drawingActivation, /if \(!activationIsCurrent\(\)\) return false[\s\S]*?activePointSourceScopeId\.value = targetScopeId/)
  assert.match(drawingActivation, /catch \(error\) \{\s*if \(!activationIsCurrent\(\)\) return false/)
  const resetDocument = appSource.slice(
    appSource.indexOf('function resetDocumentSession'),
    appSource.indexOf('async function applyProject')
  )
  assert.match(resetDocument, /pointCatalogActivationGeneration \+= 1/)
  assert.ok(
    drawingActivation.indexOf('activePointSourceScopeId.value = targetScopeId')
      < drawingActivation.indexOf('replaySourceSnapshotsForNodes()'),
    'the new drawing scope must become current before its snapshots are replayed'
  )

  const restorePaper = appSource.slice(
    appSource.indexOf('async function restorePaperSession'),
    appSource.indexOf('async function activatePaperSession')
  )
  assert.match(restorePaper, /await applyProject\(session\.data/)
  assert.match(restorePaper, /await activateCurrentDrawingPointCatalog/)
  assert.ok(
    restorePaper.indexOf('await applyProject(session.data') < restorePaper.indexOf('await activateCurrentDrawingPointCatalog'),
    'the target projectId must be installed before its source scope is activated'
  )

  const switchPaper = appSource.slice(
    appSource.indexOf('async function activatePaperSession'),
    appSource.indexOf('function nextBlankPaperTitle')
  )
  assert.match(switchPaper, /await restorePaperSession\(target/)
  assert.doesNotMatch(switchPaper, /forEach[\s\S]*?activatePointCatalogDrawing|Promise\.all[\s\S]*?paperSessions/)

  const blankPaper = appSource.slice(
    appSource.indexOf('function createBlankPaperSession'),
    appSource.indexOf('async function removePaperSession')
  )
  assert.match(blankPaper, /resetToBlankProject\(\)/)
  assert.match(blankPaper, /activateCurrentDrawingPointCatalog\(\{\s*inheritLegacyWorkspace:\s*false\s*\}\)/)

  const mounted = appSource.slice(
    appSource.indexOf('onMounted(async () => {'),
    appSource.indexOf('onUnmounted(() => {')
  )
  const restoreIndex = mounted.indexOf('restoreWorkspacePaperSessions()')
  assert.ok(restoreIndex >= 0, 'startup must restore the active paper before selecting a source scope')
  assert.doesNotMatch(mounted.slice(0, restoreIndex), /activate(?:PointCatalog|CurrentDrawingPointCatalog)/)
  assert.doesNotMatch(mounted, /activatePointCatalogWorkspace/)
  assert.match(
    mounted,
    /if \(!restored\) \{[\s\S]*?ensurePaperSession\(\)[\s\S]*?activateCurrentDrawingPointCatalog\(\{\s*inheritLegacyWorkspace:\s*false\s*\}\)/
  )

  const switchWorkspace = appSource.slice(
    appSource.indexOf('async function switchWorkspace'),
    appSource.indexOf('let projectStorageChangeGeneration')
  )
  assert.doesNotMatch(switchWorkspace, /activatePointCatalogWorkspace/)
  assert.ok(
    switchWorkspace.indexOf('workspaceId.value = nextWorkspace') < switchWorkspace.indexOf('restoreWorkspacePaperSessions()'),
    'the target workspace identity must be installed before restoring its active drawing scope'
  )

  const snapshotSubscription = appSource.slice(
    appSource.indexOf('pointCatalogGateway.subscribeSnapshots'),
    appSource.indexOf('function legacyPointIdsForNodes')
  )
  assert.match(snapshotSubscription, /snapshot\?\.workspaceId\s*!==\s*activePointSourceScopeId\.value/)
  assert.ok(
    snapshotSubscription.indexOf('snapshot?.workspaceId') < snapshotSubscription.indexOf('sourceBindingRuntime.ingest(snapshot)'),
    'a stale drawing snapshot must be rejected before entering the runtime binding pipeline'
  )
  const replayCoordinator = appSource.slice(
    appSource.indexOf('const sourceSnapshotReplayCoordinator'),
    appSource.indexOf('const legacyPointReplayCoordinator')
  )
  assert.match(replayCoordinator, /!pointCatalogScopeReady \|\| snapshot\?\.workspaceId !== activePointSourceScopeId\.value/)

  const manager = appSource.slice(
    appSource.indexOf('<DataSourceManager'),
    appSource.indexOf('</DataSourceManager>') > 0
      ? appSource.indexOf('</DataSourceManager>')
      : appSource.indexOf('<div v-if="contextMenu.show"')
  )
  assert.match(manager, /:key="currentPointSourceScopeId"/)
  assert.match(manager, /:drawing-name="fileName"/)
})

test('save target changes keep the project identity; a real copy must use a new projectId', () => {
  const saveAs = appSource.slice(
    appSource.indexOf('async function saveDrawingAsCustomFile'),
    appSource.indexOf('async function saveDrawingToProjectDirectory')
  )
  assert.match(saveAs, /writeCustomDrawing\(handle, true\)/)
  assert.doesNotMatch(saveAs, /projectId\.value\s*=|createEntityId\('project'\)/)

  const resetBlank = appSource.slice(
    appSource.indexOf('function resetToBlankProject'),
    appSource.indexOf('async function switchWorkspace')
  )
  assert.match(resetBlank, /projectId\.value\s*=\s*createEntityId\('project'\)/)
  assert.notEqual(
    drawingPointSourceScopeId('workspace-a', 'original-project'),
    drawingPointSourceScopeId('workspace-a', 'copied-project'),
    'an explicit drawing copy must receive a new projectId before copying its source catalog'
  )
})

test('opening a drawing or its source manager never tests connections automatically', () => {
  const mountedStart = managerSource.indexOf('onMounted(async () => {')
  const mountedEnd = managerSource.indexOf('onBeforeUnmount(() => {', mountedStart)
  assert.ok(mountedStart >= 0 && mountedEnd > mountedStart)
  const mounted = managerSource.slice(mountedStart, mountedEnd)
  assert.match(mounted, /subscribeToGatewayEvents\(\)/)
  assert.match(mounted, /await refreshSources\(/)
  assert.doesNotMatch(mounted, /testSource(?:Draft)?\(/)

  const testStart = managerSource.indexOf('async function testConnection()')
  const testEnd = managerSource.indexOf('async function toggleSourceEnabled', testStart)
  assert.ok(testStart >= 0 && testEnd > testStart)
  const userTestHandler = managerSource.slice(testStart, testEnd)
  assert.match(userTestHandler, /props\.gateway\.testSource\(sourceId, \{ includePoints: false \}\)/)
  assert.match(userTestHandler, /props\.gateway\.testSourceDraft\(activeConnectionPayload\(\), \{ sharedSnapshot: true \}\)/)

  const outsideUserTestHandler = managerSource.slice(0, testStart) + managerSource.slice(testEnd)
  assert.doesNotMatch(outsideUserTestHandler, /props\.gateway\.testSource(?:Draft)?\(/)
  assert.match(managerSource, /class="secondary-button source-test-button"[\s\S]*?@click="testConnection"/)
  assert.doesNotMatch(appSource, /pointCatalogGateway\.testSource(?:Draft)?\(/)
})
