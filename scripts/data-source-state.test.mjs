import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  MAX_BINDING_POINT_ID_LENGTH,
  normalizeDataBindings,
  upsertDataBinding
} from '../src/models/dataBindingModel.js'
import { createLocalPointCatalogGateway } from '../src/services/pointCatalogGateway.js'
import { diffPointCatalog } from '../src/utils/pointCatalogDiff.js'
import { normalizeWorkspaceId } from '../src/utils/workspaceIdentity.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

function sourceFixture(value = 18) {
  return [{
    id: 'source-http-line',
    name: '产线接口',
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: { url: 'https://gateway.example/realtime' },
    points: [{
      id: 'legacy.line.temperature',
      name: '旧图纸温度点位',
      type: 'number',
      value,
      status: 'good',
      updatedAt: '2026-08-02T00:00:00.000Z'
    }]
  }]
}

test('workspace ids use one NFC identity before any storage or gateway lookup', () => {
  const composed = 'caf\u00e9'
  const decomposed = 'cafe\u0301'

  assert.equal(normalizeWorkspaceId(composed), composed)
  assert.equal(normalizeWorkspaceId(decomposed), composed)
  assert.equal(normalizeWorkspaceId(`  ${decomposed}\u0000  `), composed)
  assert.equal(normalizeWorkspaceId(`\u0000  ${decomposed}\u0000  `), composed)
  assert.equal(normalizeWorkspaceId('', 'default'), 'default')
  assert.equal(normalizeWorkspaceId('', '\u0000  fallback\u0000  '), 'fallback')
  assert.equal(normalizeWorkspaceId({ toString() { throw new Error('bad id') } }, 'fallback'), 'fallback')
  assert.equal(normalizeWorkspaceId('x'.repeat(100)).length, 64)
})

test('catalog diff invalidates removed points and replays only new or changed values', () => {
  const previous = [
    { id: 'stable.table', type: 'array', status: 'good', updatedAt: '2026-08-01T00:00:00.000Z', value: [{ id: 1 }], sourceName: '旧名称' },
    { id: 'changed.number', type: 'number', status: 'good', updatedAt: '2026-08-01T00:00:00.000Z', value: 1 },
    { id: 'removed.point', type: 'string', status: 'good', updatedAt: '2026-08-01T00:00:00.000Z', value: 'old' }
  ]
  const next = [
    { id: 'stable.table', type: 'array', status: 'good', updatedAt: '2026-08-01T00:00:00.000Z', value: [{ id: 1 }], sourceName: '新名称' },
    { id: 'changed.number', type: 'number', status: 'good', updatedAt: '2026-08-01T00:00:00.000Z', value: 2 },
    { id: 'new.point', type: 'boolean', status: 'good', updatedAt: '2026-08-01T00:00:01.000Z', value: true }
  ]

  assert.deepEqual(diffPointCatalog(previous, next), {
    invalidatedPointIds: ['removed.point'],
    changedPointIds: ['changed.number', 'new.point']
  })
  assert.deepEqual(diffPointCatalog(next, next.map(point => ({ ...point, value: typeof point.value === 'object' ? structuredClone(point.value) : point.value }))), {
    invalidatedPointIds: [],
    changedPointIds: []
  })
})

test('catalog and bindings reject an overlong point identity instead of truncating it', () => {
  const pointId = 'p'.repeat(MAX_BINDING_POINT_ID_LENGTH + 1)
  const source = {
    id: 'source-id-boundary',
    name: '点位边界',
    protocol: 'HTTP',
    enabled: true,
    status: 'online',
    config: { url: 'https://gateway.example/data' },
    points: [{ id: pointId, name: '超长点位', type: 'number', value: 1, status: 'good' }]
  }

  assert.throws(() => createLocalPointCatalogGateway({ sources: [source] }), /点位 ID.*1024/)
  assert.deepEqual(normalizeDataBindings([{ target: 'text', pointId }], 'rect'), [])
  assert.throws(() => upsertDataBinding({ type: 'rect', dataBindings: [] }, { target: 'text', pointId }), /invalid component data binding/)
})

test('source snapshots publish once, isolate mutable callers and invalidate on removal', async () => {
  const gateway = createLocalPointCatalogGateway({ sources: sourceFixture })
  const copiedEvents = []
  const sharedEvents = []
  const unsubscribeCopied = gateway.subscribeSnapshots(snapshot => copiedEvents.push(snapshot))
  const unsubscribeShared = gateway.subscribeSnapshots(snapshot => sharedEvents.push(snapshot), { shared: true })

  await gateway.activateWorkspace('workspace-a')
  copiedEvents.length = 0
  sharedEvents.length = 0

  const ownedData = { device: { temperature: 23 }, rows: [{ id: 1 }] }
  const committed = gateway.ingestSourceSnapshot(
    'source-http-line',
    ownedData,
    { quality: 'good', origin: 'test-adapter' },
    { takeOwnership: true, sharedResult: true }
  )
  assert.strictEqual(committed.data, ownedData)
  assert.strictEqual(sharedEvents[0], committed)
  assert.notStrictEqual(copiedEvents[0], committed)
  assert.deepEqual(copiedEvents[0].data, ownedData)

  const sharedRead = await gateway.getSourceSnapshot('source-http-line', { shared: true })
  const copiedRead = await gateway.getSourceSnapshot('source-http-line')
  assert.strictEqual(sharedRead, committed)
  assert.notStrictEqual(copiedRead, committed)
  copiedRead.data.device.temperature = 99
  assert.equal((await gateway.getSourceSnapshot('source-http-line', { shared: true })).data.device.temperature, 23)

  assert.deepEqual(await gateway.getPointsByIds([
    'legacy.line.temperature',
    'missing.point',
    'legacy.line.temperature'
  ]), [{
    id: 'legacy.line.temperature',
    name: '旧图纸温度点位',
    group: '未分组',
    type: 'number',
    value: 18,
    status: 'good',
    updatedAt: '2026-08-02T00:00:00.000Z',
    sourceId: 'source-http-line',
    sourceName: '产线接口',
    protocol: 'HTTP'
  }])

  await gateway.removeSource('source-http-line')
  assert.equal(await gateway.getSourceSnapshot('source-http-line'), null)
  assert.equal(sharedEvents.at(-1).quality, 'bad')
  assert.equal(sharedEvents.at(-1).data, undefined)
  assert.deepEqual(await gateway.getPointsByIds(['legacy.line.temperature']), [])
  assert.equal(unsubscribeCopied(), true)
  assert.equal(unsubscribeShared(), true)
})

test('workspace activation replaces source snapshots instead of leaking the previous workspace value', async () => {
  const gateway = createLocalPointCatalogGateway({ sources: () => sourceFixture(18) })
  await gateway.activateWorkspace('workspace-a')
  gateway.ingestSourceSnapshot('source-http-line', { device: { temperature: 41 } })
  assert.equal((await gateway.getSourceSnapshot('source-http-line')).data.device.temperature, 41)

  await gateway.activateWorkspace('workspace-b')
  const workspaceBSnapshot = await gateway.getSourceSnapshot('source-http-line')
  assert.notEqual(workspaceBSnapshot.data?.device?.temperature, 41)
  assert.equal(workspaceBSnapshot.sourceId, 'source-http-line')
  assert.equal(gateway.activeWorkspaceId, 'workspace-b')
})

test('App activates source snapshots and loads legacy point values only when referenced', () => {
  assert.match(appSource, /import \{ diffPointCatalog \} from '\.\/utils\/pointCatalogDiff'/)
  assert.match(appSource, /import \{ normalizeWorkspaceId \} from '\.\/utils\/workspaceIdentity'/)
  assert.match(appSource, /import \{ drawingPointSourceScopeId \} from '\.\/utils\/drawingPointSourceScope'/)
  assert.match(appSource, /import \{ createSourceBindingRuntime \} from '\.\/services\/sourceBindingRuntime'/)
  assert.match(appSource, /import \{ createSourceSnapshotReplayCoordinator \} from '\.\/utils\/sourceSnapshotReplayCoordinator'/)
  assert.match(appSource, /function clearPointCatalogRuntimeValues\(points = pointCatalog\.value\)/)
  assert.match(appSource, /pointCatalogGateway\.subscribeSnapshots\?\.\(snapshot => \{[\s\S]*?snapshot\?\.workspaceId !== activePointSourceScopeId\.value[\s\S]*?sourceBindingRuntime\.ingest\(snapshot\)[\s\S]*?\}, \{ shared: true \}\)/)
  assert.match(appSource, /async function activatePointCatalogDrawing[\s\S]*?drawingPointSourceScopeId\(normalizedWorkspace, normalizedDrawingId\)[\s\S]*?pointCatalogGateway\.activateWorkspace\(targetScopeId,[\s\S]*?legacyWorkspaceId:[\s\S]*?publishSnapshots: false[\s\S]*?activePointSourceScopeId\.value = targetScopeId[\s\S]*?sourceBindingRuntime\.reset\?\.\(\{ keepBindings: true \}\)[\s\S]*?await refreshPointCatalog\(options\)[\s\S]*?await replaySourceSnapshotsForNodes\(\)/)
  assert.match(appSource, /catch \(error\) \{[\s\S]*?clearPointCatalogRuntimeValues\(\)[\s\S]*?throw error/)
  assert.match(appSource, /const pointIds = requiredIds == null[\s\S]*?indexedLegacyPointIds\(\)[\s\S]*?pointCatalogGateway\.getPointsByIds\(pointIds\)/)
  assert.match(appSource, /function indexedLegacyPointIds\(\)[\s\S]*?runtimeDataKeyIndex\.keys\(\)[\s\S]*?runtimeBindingPointIndex\.keys\(\)[\s\S]*?isSourceBindingRuntimeKey\(key\)/)
  assert.match(appSource, /diffPointCatalog\(pointCatalog\.value, points\)/)
  assert.match(appSource, /const activeKeys = new Set\(getActiveRuntimeDataKeys\(\)\)/)
  assert.match(appSource, /replayPointCatalogValues\(changedPointIds\.filter\(pointId => activeKeys\.has\(pointId\)\)\)/)
  assert.match(appSource, /const sourceSnapshotReplayCoordinator = createSourceSnapshotReplayCoordinator\([\s\S]*?getSourceSnapshot\?\.\(sourceId, \{ shared: true \}\)[\s\S]*?sourceBindingRuntime\.ingest\(snapshot, options\)/)
  assert.match(appSource, /bindingSourceIds\(node\)[\s\S]*?sourceSnapshotReplayCoordinator\.replay\(sourceIds, \{ force \}\)/)
  assert.match(appSource, /onMounted\(async \(\) => \{[\s\S]*?let restored = await restoreWorkspacePaperSessions\(\)[\s\S]*?restoreStoredWorkspaceProject\(\)[\s\S]*?ensurePaperSession\(\)[\s\S]*?activateCurrentDrawingPointCatalog\(\{ inheritLegacyWorkspace: false \}\)/)
  assert.match(appSource, /async function switchWorkspace\(\)[\s\S]*?workspaceId\.value = nextWorkspace[\s\S]*?restoreWorkspacePaperSessions\(\)[\s\S]*?activateCurrentDrawingPointCatalog\(\{ inheritLegacyWorkspace: false \}\)[\s\S]*?catch \(error\)[\s\S]*?workspaceId\.value = previousWorkspace[\s\S]*?restoreWorkspacePaperSessions\(\)/)
})
