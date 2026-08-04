import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createPointCatalogLookup,
  createPointCatalogScan
} from '../src/utils/pointCatalogSearch.js'

const panelSource = readFileSync(
  new URL('../src/components/CommunicationBindingPanel.vue', import.meta.url),
  'utf8'
)
const jsonTreeSource = readFileSync(
  new URL('../src/components/JsonPathTree.vue', import.meta.url),
  'utf8'
)

function createPoint(index, overrides = {}) {
  return {
    id: `point-${index}`,
    name: `设备点位 ${index}`,
    group: `产线 ${index % 7}`,
    sourceName: index % 2 ? 'MQTT 主站' : 'HTTP 接口',
    protocol: index % 2 ? 'mqtt' : 'http',
    value: index,
    ...overrides
  }
}

function createOptions(counters = {}) {
  return {
    getId(point) {
      counters.idReads = (counters.idReads || 0) + 1
      return String(point?.id || '').trim()
    },
    getSearchValues(point, id) {
      counters.searchReads = (counters.searchReads || 0) + 1
      return [id, point.name, point.group, point.sourceName, point.protocol]
    },
    normalize(point, id) {
      counters.normalized = (counters.normalized || 0) + 1
      return { id, source: point }
    }
  }
}

test('the initial catalog page only normalizes its visible batch', () => {
  const counters = {}
  const points = Array.from({ length: 100_000 }, (_, index) => createPoint(index))
  const scan = createPointCatalogScan(points, '', createOptions(counters))

  const slice = scan.runSlice({ maxOperations: 50, stopAfterMatches: 50 })

  assert.equal(slice.operations, 50)
  assert.equal(slice.added.length, 50)
  assert.equal(scan.matches.length, 50)
  assert.equal(scan.done, false)
  assert.equal(counters.idReads, 50)
  assert.equal(counters.searchReads || 0, 0)
  assert.equal(counters.normalized, 50)
})

test('bound point lookup scans ids but only normalizes requested entries', () => {
  const counters = {}
  const points = Array.from({ length: 50_000 }, (_, index) => createPoint(index))
  const lookup = createPointCatalogLookup(
    points,
    ['point-49999', 'point-12', 'missing-point'],
    createOptions(counters)
  )
  const operations = []
  while (!lookup.done) {
    const slice = lookup.runSlice({ maxOperations: 127 })
    operations.push(slice.operations)
  }

  assert.deepEqual([...lookup.matches.keys()], ['point-12', 'point-49999'])
  assert.equal(counters.normalized, 2)
  assert.equal(counters.searchReads || 0, 0)
  assert.ok(operations.length > 1)
  assert.ok(operations.every(count => count > 0 && count <= 127))
})

test('a full query is split into bounded slices and keeps exact stable results', () => {
  const points = Array.from({ length: 5_003 }, (_, index) => createPoint(index, {
    name: index % 911 === 0 ? `目标泵站 ${index}` : `设备点位 ${index}`
  }))
  points.splice(1_500, 0, { ...points[0], name: '重复目标泵站' })
  const scan = createPointCatalogScan(points, '目标泵站', createOptions())
  const operations = []

  while (!scan.done) {
    const slice = scan.runSlice({ maxOperations: 113 })
    operations.push(slice.operations)
  }

  const expected = points
    .filter((point, index, source) => source.findIndex(candidate => candidate.id === point.id) === index)
    .filter(point => point.name.includes('目标泵站'))
    .map(point => point.id)
  assert.deepEqual(scan.matches.map(point => point.id), expected)
  assert.ok(operations.length > 1)
  assert.ok(operations.every(count => count > 0 && count <= 113))
})

test('a cancelled query cannot continue scanning or publish stale matches', () => {
  const counters = {}
  const points = Array.from({ length: 2_000 }, (_, index) => createPoint(index))
  const oldScan = createPointCatalogScan(points, '设备', createOptions(counters))
  const first = oldScan.runSlice({ maxOperations: 97 })
  const readsBeforeCancel = counters.idReads

  assert.equal(first.cancelled, false)
  oldScan.cancel()
  const staleSlice = oldScan.runSlice({ maxOperations: 97 })

  assert.equal(staleSlice.cancelled, true)
  assert.equal(staleSlice.operations, 0)
  assert.equal(counters.idReads, readsBeforeCancel)

  const currentScan = createPointCatalogScan(points, 'point-1999', createOptions())
  while (!currentScan.done) currentScan.runSlice({ maxOperations: 101 })
  assert.deepEqual(currentScan.matches.map(point => point.id), ['point-1999'])
})

test('the communication panel avoids full legacy catalogs and browses bounded JSON snapshots', () => {
  assert.doesNotMatch(panelSource, /createPointCatalogScan|createPointCatalogLookup|props\.points|querySourcePoints|listPoints/)
  assert.match(panelSource, /const nextSources = result\.slice\(0, 1000\)[\s\S]*?sources\.value = nextSources/)
  assert.match(panelSource, /getSourceSnapshot\(normalizedSourceId,\s*\{\s*shared:\s*true\s*\}\)/)
  assert.match(panelSource, /<JsonPathTree\s+:value="snapshot\.data"[\s\S]*?@select="selectTreePath"/)
  assert.match(jsonTreeSource, /maxChildren:\s*\{ type: Number, default: 60 \}/)
  assert.match(jsonTreeSource, /maxVisible:\s*\{ type: Number, default: 240 \}/)
  assert.match(jsonTreeSource, /maxDepth:\s*\{ type: Number, default: 12 \}/)
  assert.match(jsonTreeSource, /if \(result\.length >= visibleLimit\.value\)/)
})
