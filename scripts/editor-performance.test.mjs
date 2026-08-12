import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isReactive, nextTick, ref, toRaw, triggerRef, watchEffect } from 'vue'
import { createSpatialIndex } from '../src/utils/spatialIndex.js'
import { rotatedFrameBounds } from '../src/utils/editorGeometry.js'
import { createDataKeyIndex, createEdgeAdjacencyIndex } from '../src/utils/documentIndexes.js'
import { applyEntityEntry, captureEntityEntry, createEntityInsertionEntry } from '../src/utils/entityHistory.js'
import { incidentEdgeCountExceedsLimit } from '../src/utils/edgeInteractionPolicy.js'

const NODE_COUNT = 10_000
const COLUMNS = 100

function createSparseNodes(count = NODE_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    x: (index % COLUMNS) * 240 + (index % 3) * 7,
    y: Math.floor(index / COLUMNS) * 180 + (index % 5) * 5,
    w: 40 + (index % 5) * 7,
    h: 30 + (index % 7) * 5
  }))
}

function intersects(item, bounds) {
  return item.x + item.w >= bounds.x
    && item.x <= bounds.x + bounds.w
    && item.y + item.h >= bounds.y
    && item.y <= bounds.y + bounds.h
}

function matchingIds(items, bounds) {
  return items.filter(item => intersects(item, bounds)).map(item => item.id).sort()
}

function queryResult(index, bounds) {
  const candidates = index.query(bounds)
  assert.equal(new Set(candidates.map(item => item.id)).size, candidates.length, '空间索引不应返回重复候选节点')
  return {
    candidates,
    visibleIds: candidates.filter(item => intersects(item, bounds)).map(item => item.id).sort()
  }
}

function bestDuration(run, samples = 3) {
  let best = Number.POSITIVE_INFINITY
  let value
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now()
    value = run()
    best = Math.min(best, performance.now() - startedAt)
  }
  return { duration: best, value }
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `应定义 ${name}()`)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1, `应能读取 ${name}() 的完整函数体`)
  return source.slice(start, end + 2)
}

function cloneEntity(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value))
}

function observeCollectionAccess(source) {
  const stats = { numericReads: 0, mapReads: 0 }
  const collection = new Proxy(source, {
    get(target, property, receiver) {
      if (property === 'map') stats.mapReads += 1
      if (typeof property === 'string' && /^\d+$/.test(property)) stats.numericReads += 1
      return Reflect.get(target, property, receiver)
    }
  })
  return { collection, stats }
}

function observeCollectionSplices(source) {
  const stats = { splices: 0 }
  const splice = source.splice
  Object.defineProperty(source, 'splice', {
    configurable: true,
    value(...args) {
      stats.splices += 1
      return splice.apply(this, args)
    }
  })
  return { stats }
}

test('spatial index returns the same visible nodes as a full scan on a sparse 10k canvas', () => {
  const nodes = createSparseNodes()
  const index = createSpatialIndex(nodes, { cellSize: 256 })
  const viewports = Array.from({ length: 48 }, (_, step) => ({
    x: (step * 431) % 22_000,
    y: (step * 307) % 16_500,
    w: 1_440,
    h: 960
  }))

  for (const viewport of viewports) {
    const result = queryResult(index, viewport)
    assert.deepEqual(result.visibleIds, matchingIds(nodes, viewport))
    assert.ok(result.candidates.length < NODE_COUNT * 0.15, `单个视口产生 ${result.candidates.length} 个候选节点，超过总量的 15%`)
  }
})

test('spatial index updates a moved node without leaving stale cells', () => {
  const nodes = createSparseNodes()
  const index = createSpatialIndex(nodes, { cellSize: 256 })
  const moved = nodes[0]
  const oldBounds = { x: moved.x - 1, y: moved.y - 1, w: moved.w + 2, h: moved.h + 2 }
  const newBounds = { x: 11_400, y: 8_200, w: 900, h: 700 }

  assert.ok(index.query(oldBounds).some(item => item.id === moved.id))
  moved.x = newBounds.x + 120
  moved.y = newBounds.y + 90
  index.update(moved)

  assert.ok(!index.query(oldBounds).some(item => item.id === moved.id), '移动后不应残留在旧网格')
  assert.ok(index.query(newBounds).some(item => item.id === moved.id), '移动后应进入新网格')
  assert.deepEqual(queryResult(index, newBounds).visibleIds, matchingIds(nodes, newBounds))
})

test('spatial index skips no-op geometry updates while refreshing the retained reference', () => {
  const original = { id: 'stable-node', x: 120, y: 80, w: 40, h: 24 }
  const replacement = { ...original, text: 'latest' }
  const index = createSpatialIndex([original], { cellSize: 64 })

  assert.equal(index.update(replacement), false)
  assert.equal(index.query({ x: 100, y: 60, w: 100, h: 80 })[0], replacement)

  replacement.x += 1
  assert.equal(index.update(replacement), true)
})

test('attached spatial indexes preserve translated queries, cursors, updates, and cleanup', () => {
  const localNode = { id: 'attached-node', x: 12, y: 18, w: 30, h: 20 }
  const segment = createSpatialIndex([localNode], { cellSize: 64 })
  const index = createSpatialIndex([
    { id: 'root-node', x: 40, y: 50, w: 20, h: 20 }
  ], { cellSize: 64 })

  segment.setTranslation(1_000, 500)
  localNode.x += 1_000
  localNode.y += 500
  index.attach(segment)

  const translatedBounds = { x: 1_000, y: 500, w: 100, h: 100 }
  assert.equal(index.state.entries, 2)
  assert.equal(index.state.segments, 1)
  assert.deepEqual(index.query(translatedBounds).map(item => item.id), [localNode.id])

  const matches = []
  const cursor = index.createQueryCursor(translatedBounds, { sort: false })
  while (!cursor.done) cursor.runSlice({ maxOperations: 2, onMatch: item => matches.push(item.id) })
  assert.deepEqual(matches, [localNode.id])

  const replacement = { ...localNode, text: 'latest' }
  assert.equal(index.update(replacement), false)
  assert.equal(index.query(translatedBounds)[0], replacement)

  replacement.x += 160
  assert.equal(index.update(replacement), true)
  assert.deepEqual(index.query(translatedBounds), [])
  assert.deepEqual(index.query({ x: 1_150, y: 500, w: 100, h: 100 }), [replacement])

  assert.equal(index.remove(replacement.id), true)
  assert.equal(index.state.entries, 1)
  assert.equal(index.state.segments, 0)
})

test('spatial index removes, rebuilds, and clears entities deterministically', () => {
  const nodes = createSparseNodes(800)
  const index = createSpatialIndex(nodes, { cellSize: 256 })
  const removed = nodes[140]
  const removedBounds = { x: removed.x - 1, y: removed.y - 1, w: removed.w + 2, h: removed.h + 2 }

  index.remove(removed.id)
  assert.ok(!index.query(removedBounds).some(item => item.id === removed.id))

  const rebuilt = nodes.slice(400).map((node, index) => ({ ...node, x: 2_000 + index * 3, y: 2_500 + index * 2 }))
  const rebuiltBounds = { x: 2_300, y: 2_700, w: 700, h: 700 }
  index.rebuild(rebuilt)
  assert.deepEqual(queryResult(index, rebuiltBounds).visibleIds, matchingIds(rebuilt, rebuiltBounds))
  assert.ok(!index.query(removedBounds).some(item => item.id === nodes[0].id), '重建后不应保留旧实体')

  index.clear()
  assert.deepEqual(index.query(rebuiltBounds), [])
})

test('spatial query limits are deterministic, deduplicate cells, and preserve retained order', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `limited-${index}`,
    x: 8 + index,
    y: 8 + index,
    w: 80,
    h: 80
  }))
  const index = createSpatialIndex(items, { cellSize: 32 })
  const bounds = { x: 0, y: 0, w: 160, h: 160 }

  const first = index.query(bounds, { limit: 3 })
  const second = index.query(bounds, { limit: 3 })
  assert.deepEqual(first.map(item => item.id), ['limited-0', 'limited-1', 'limited-2'])
  assert.deepEqual(second, first)
  assert.equal(new Set(first.map(item => item.id)).size, first.length)
  assert.deepEqual(index.query(bounds, { limit: 2.9 }).map(item => item.id), ['limited-0', 'limited-1'])

  items[1].x = 12
  items[1].y = 12
  index.update(items[1])
  assert.deepEqual(index.query(bounds, { limit: 3 }).map(item => item.id), ['limited-0', 'limited-1', 'limited-2'])
  assert.deepEqual(index.query(bounds, { limit: 99 }), items)
})

test('spatial query limits cap the oversized path before visiting normal buckets', () => {
  const oversized = Array.from({ length: 4 }, (_, index) => ({
    id: `oversized-${index}`,
    x: 0,
    y: 0,
    w: 1_024,
    h: 1_024
  }))
  const normal = Array.from({ length: 4 }, (_, index) => ({
    id: `normal-${index}`,
    x: 10 + index,
    y: 10 + index,
    w: 8,
    h: 8
  }))
  const index = createSpatialIndex([...oversized, ...normal], { cellSize: 32 })
  const bounds = { x: 0, y: 0, w: 64, h: 64 }

  assert.deepEqual(index.query(bounds, { limit: 2 }).map(item => item.id), ['oversized-0', 'oversized-1'])
  assert.deepEqual(index.query(bounds, { limit: 2, sort: false }).map(item => item.id), ['oversized-0', 'oversized-1'])
  assert.equal(index.query(bounds, { limit: 1 }).length, 1)
  assert.equal(index.query(bounds).length, oversized.length + normal.length)
})

test('spatial queries stay materially cheaper than repeated full scans', () => {
  const nodes = createSparseNodes().map((node, index) => ({ ...node, rotate: index % 9 ? 0 : 27 }))
  const index = createSpatialIndex(nodes, { cellSize: 256 })
  const viewports = Array.from({ length: 160 }, (_, step) => ({
    x: (step * 317) % 22_000,
    y: (step * 229) % 16_500,
    w: 1_440,
    h: 960
  }))
  const scan = () => {
    let count = 0
    for (const viewport of viewports) {
      for (const node of nodes) if (intersects(rotatedFrameBounds(node), viewport)) count += 1
    }
    return count
  }
  const query = () => {
    let count = 0
    for (const viewport of viewports) count += index.query(viewport).length
    return count
  }

  // 先各跑一次完成 JIT 预热，再取多次执行中的最短耗时，降低共享机器抖动的影响。
  assert.equal(query(), scan())
  const scanResult = bestDuration(scan)
  const queryResult = bestDuration(query)

  assert.equal(queryResult.value, scanResult.value)
  assert.ok(
    queryResult.duration < scanResult.duration * 0.6,
    `索引查询 ${queryResult.duration.toFixed(2)}ms，未显著快于全量扫描 ${scanResult.duration.toFixed(2)}ms`
  )
})

test('large empty viewport queries do not scan two separated 10k-node clusters', () => {
  const clusteredNodes = Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: `clustered-${index}`,
    x: (index < NODE_COUNT / 2 ? 0 : 18_000) + index % 20,
    y: Math.floor(index / 20) % 20,
    w: 24,
    h: 18
  }))
  const index = createSpatialIndex(clusteredNodes, { cellSize: 256 })
  // Both empty viewports sit inside the document's overall bounding box, between two dense clusters.
  const smallEmptyViewport = { x: 8_000, y: 0, w: 1_200, h: 800 }
  const lowZoomEmptyViewport = { x: 4_800, y: 0, w: 8_400, h: 6_400 }
  const repeatedQuery = bounds => {
    let count = 0
    for (let iteration = 0; iteration < 120; iteration += 1) count += index.query(bounds).length
    return count
  }

  assert.equal(repeatedQuery(smallEmptyViewport), 0)
  assert.equal(repeatedQuery(lowZoomEmptyViewport), 0)
  const smallResult = bestDuration(() => repeatedQuery(smallEmptyViewport))
  const lowZoomResult = bestDuration(() => repeatedQuery(lowZoomEmptyViewport))
  const allowedDuration = Math.max(12, smallResult.duration * 25)

  assert.equal(lowZoomResult.value, 0)
  assert.ok(
    lowZoomResult.duration < allowedDuration,
    `large empty viewport ${lowZoomResult.duration.toFixed(2)}ms indicates a full scan; small viewport ${smallResult.duration.toFixed(2)}ms`
  )
})

test('the editor viewport is wired to the spatial index and incrementally updates geometry', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const viewportQuery = functionSource(appSource, 'nodesInViewport')

  assert.match(appSource, /import \{ createSpatialIndex \} from '\.\/utils\/spatialIndex'/)
  assert.match(appSource, /(?:const|let) nodeSpatialIndex = createSpatialIndex\(/)
  assert.match(appSource, /function queryNodesInBounds\([\s\S]*?nodeSpatialIndex\.query\(/)
  assert.match(viewportQuery, /viewportWorldBounds\(/)
  assert.match(viewportQuery, /queryNodesInBounds\(/)
  assert.match(viewportQuery, /LARGE_DOCUMENT_OVERSCAN/)
  assert.match(appSource, /function updateNodeSpatialIndex\([\s\S]*?nodeSpatialIndex\.update\(/)
  assert.doesNotMatch(appSource, /const visibleNodes = computed\(\(\) => nodes\.value\.filter\(/)
  assert.doesNotMatch(appSource, /function nodesInViewport\([^)]*\) \{\s*return nodes\.value\.filter\(/)
})

test('node lookup updates appended proxies without rebuilding the full map', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const updateLookup = functionSource(appSource, 'updateNodeSpatialIndex')
  const applyChanges = functionSource(appSource, 'applyNodeSpatialChanges')
  const appendNodes = functionSource(appSource, 'appendNodes')
  const replaceCollections = functionSource(appSource, 'replaceEntityCollections')
  const finishTextEdit = functionSource(appSource, 'finishTextEdit')

  assert.match(appSource, /const nodeIndex = shallowRef\(new globalThis\.Map\(\)\)/)
  assert.doesNotMatch(appSource, /const nodeIndex = computed\(\(\) => new globalThis\.Map\(nodes\.value\.map/)
  assert.match(updateLookup, /const start = Math\.max\(0, nodes\.value\.length - items\.length\)/)
  assert.match(updateLookup, /appendedNodes\.set\(node\.id, node\)/)
  assert.match(updateLookup, /nodeIndex\.value\.set\(indexedNode\.id, indexedNode\)/)
  assert.match(updateLookup, /triggerRef\(nodeIndex\)/)
  assert.match(applyChanges, /nodeIndex\.value\.delete\(item\.id\)/)
  assert.match(applyChanges, /nodeIndex\.value\.set\(item\.value\.id, item\.value\)/)
  assert.match(appendNodes, /nodes\.value\.push\(\.\.\.items\)[\s\S]*?const inserted = nodes\.value\.slice\(start\)[\s\S]*?updateNodeSpatialIndex\(inserted\)/)
  assert.match(replaceCollections, /nodes\.value = nextNodes[\s\S]*?edges\.value = nextEdges[\s\S]*?drawings\.value = nextDrawings[\s\S]*?rebuildDocumentIndexes\(\)/)
  assert.match(finishTextEdit, /nodeIndex\.value\.get\(editingText\.value\.id\)/)
  assert.doesNotMatch(finishTextEdit, /nodes\.value\.find/)
  assert.match(appSource, /const activeTableDataNode = computed\(\(\) => \{[\s\S]*?nodeIndex\.value\.get\(tableDataEditor\.value\.nodeId\)/)
  assert.match(appSource, /const activeTableCellDetail = computed\(\(\) => \{[\s\S]*?nodeIndex\.value\.get\(tableCellViewer\.value\.nodeId\)/)
})

test('the main minimap redraws locally and reuses document indexes', async () => {
  const [appSource, previewSource] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  ])
  const mainMiniMap = appSource.match(/<div v-if="showMiniMap" class="minimap">[\s\S]*?(<MiniMapPreview[^>]*>)/)?.[1]

  assert.ok(mainMiniMap, '应找到主鹰眼组件')
  assert.match(mainMiniMap, /ref="miniMapPreview"/)
  assert.match(mainMiniMap, /:node-index="nodeIndex"/)
  assert.match(mainMiniMap, /:ordered-entities="layerEntries"/)
  assert.match(previewSource, /renderRevision:\s*\{\s*type:\s*Number/)
  assert.match(previewSource, /spatialIndex:\s*\{\s*type:\s*Object/)
  assert.match(previewSource, /incrementalRuntime:\s*\{\s*type:\s*Boolean/)
  assert.match(previewSource, /function canIncrementRuntime\(\)[\s\S]*?typeof props\.spatialIndex\?\.createQueryCursor === 'function'/)
  assert.match(previewSource, /function requestRuntimeRender\(changedNodes\)[\s\S]*?runtimeRenderRequest\(changedNodes\)[\s\S]*?updateRuntimeDenseStream\(request\)[\s\S]*?pendingRuntimeNodes\.set[\s\S]*?if \(!canIncrementRuntime\(\)\)[\s\S]*?renderScheduler\.state\.pending[\s\S]*?return renderScheduler\.state\.generation[\s\S]*?return requestCoalescedRender\(\)[\s\S]*?scheduleRuntimeRender\(\)/)
  assert.match(previewSource, /defineExpose\(\{[\s\S]*?requestRender: scheduleRender,[\s\S]*?requestCoalescedRender,[\s\S]*?requestRuntimeRender,/)
  assert.match(appSource, /function markMiniMapDirty\(\)[\s\S]*?miniMapPreview\.value\?\.requestRender\(\)/)
  assert.doesNotMatch(appSource, /miniMapRevision\.value\s*\+=/)
  assert.doesNotMatch(previewSource, /watchEffect\s*\(/)
  assert.doesNotMatch(previewSource, /for \(const node of props\.nodes\)[\s\S]*?scheduleRender\(\)/)
})

test('canvas zoom commits the projected viewport before publishing the reactive scale', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const commitViewport = functionSource(appSource, 'commitCanvasViewport')
  const setZoom = functionSource(appSource, 'setCanvasZoom')
  const commitZoom = functionSource(appSource, 'commitCanvasZoomTarget')
  const scheduleCommit = functionSource(appSource, 'scheduleCanvasZoomCommit')
  const updateViewport = functionSource(appSource, 'updateViewport')

  assert.match(commitViewport, /const nextViewport = canvasViewportFromScroll\(left, top, target\)/)
  assert.match(commitViewport, /if \([^\n]*(?:viewport\.value|current)\.left === nextViewport\.left[^\n]*\) return false/)
  assert.match(commitViewport, /viewport\.value = nextViewport[\s\S]*?return true/)

  assert.match(setZoom, /applyTransientCanvasZoom\(target\)/)
  assert.match(setZoom, /commitCanvasZoomTarget\(target\)/)

  const projectedViewport = 'commitCanvasViewport(target.canvas.scrollLeft, target.canvas.scrollTop, target.canvas)'
  for (const source of [commitZoom, scheduleCommit]) {
    assert.ok(source.includes(projectedViewport), 'zoom commit must publish its projected viewport')
    assert.ok(source.indexOf(projectedViewport) < source.indexOf('zoom.value = target.zoom'))
  }
  assert.match(updateViewport, /commitCanvasViewport\(/)
  assert.doesNotMatch(updateViewport, /viewport\.value = canvasViewportFromScroll/)
})

test('canvas zoom updates one inherited inverse-scale value per frame', async () => {
  const [appSource, enhancementCss] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')
  ])
  const canvasStart = appSource.indexOf('<div ref="canvas" class="canvas"')
  const canvasEnd = appSource.indexOf('@scroll.passive="updateViewport"', canvasStart)
  const canvasTag = appSource.slice(canvasStart, canvasEnd)

  assert.notEqual(canvasStart, -1)
  assert.notEqual(canvasEnd, -1)
  assert.match(canvasTag, /'--inverse-zoom': 1 \/ zoom/)
  assert.equal((canvasTag.match(/\/ zoom/g) || []).length, 1, 'zoom should not patch every inverse-sized CSS variable')
  assert.match(enhancementCss, /var\(--inverse-zoom(?:,\s*1)?\)/)
  assert.doesNotMatch(canvasTag, /`\$\{(?:1|1\.25|2|5|6|8|10|12|16|17|24|32|60) \/ zoom\}px`/)
})

test('wheel zoom uses transient DOM composition and commits Vue state once after idle', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const wheelHandler = functionSource(appSource, 'canvasWheel')
  const applyTransientZoom = functionSource(appSource, 'applyTransientCanvasZoom')
  const scheduleCommit = functionSource(appSource, 'scheduleCanvasZoomCommit')

  assert.doesNotMatch(wheelHandler, /setCanvasZoom\(/)
  assert.match(wheelHandler, /applyTransientCanvasZoom\(/)
  assert.match(wheelHandler, /scheduleCanvasZoomCommit\(/)

  assert.doesNotMatch(applyTransientZoom, /zoom\.value\s*=/)
  assert.match(applyTransientZoom, /expandTransientCanvasRenderBounds\(target\)/)
  assert.match(applyTransientZoom, /scheduleTransientCanvasZoomRender\(\)/)
  assert.match(appSource, /function renderTransientCanvasZoom\(target\)[\s\S]*?stage\.value\.style\.transform\s*=/)
  assert.match(appSource, /function renderTransientCanvasZoom\(target\)[\s\S]*?stageSpace\.value\.style\.width\s*=/)
  assert.match(appSource, /function renderTransientCanvasZoom\(target\)[\s\S]*?stageSpace\.value\.style\.height\s*=/)
  assert.doesNotMatch(applyTransientZoom, /--inverse-zoom|style\.setProperty\(/)
  assert.match(appSource, /function renderTransientCanvasZoom\(target\)[\s\S]*?scrollTo\(/)

  assert.match(appSource, /const transientCanvasRenderBounds = shallowRef\(null\)/)
  assert.match(appSource, /const visible = transientCanvasRenderBounds\.value[\s\S]*?queryNodesInBounds\(transientCanvasRenderBounds\.value\)/)
  assert.match(appSource, /expandCanvasBounds\(currentBounds, canvasRenderBoundsForViewport\(targetViewport, target\.zoom\)\)/)
  assert.match(appSource, /zoom\.value = target\.zoom\s+clearTransientCanvasRenderBounds\(\)/)

  assert.match(scheduleCommit, /clearTimeout\(/)
  assert.match(scheduleCommit, /setTimeout\(/)
  assert.match(scheduleCommit, /zoom\.value\s*=\s*target\.zoom/)
  assert.equal((scheduleCommit.match(/zoom\.value\s*=/g) || []).length, 1)
})

test('canvas zoom keeps the minimap bitmap outside the hot path', async () => {
  const [appSource, previewSource] = await Promise.all([
    readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
  ])
  const zoomPath = appSource.slice(
    appSource.indexOf('async function setCanvasZoom'),
    appSource.indexOf('async function resetCanvasView')
  )
  const minimapRegion = appSource.slice(appSource.indexOf('<div v-if="showMiniMap" class="minimap">'), appSource.indexOf('<div class="zoom-bar">'))
  const minimapTag = minimapRegion.match(/<MiniMapPreview[^>]*:nodes="nodes"[^>]*\/>/)?.[0] || ''
  const minimapWatch = previewSource.slice(previewSource.indexOf('watch(['), previewSource.indexOf('onBeforeUnmount'))

  assert.doesNotMatch(zoomPath, /markMiniMapDirty|miniMapRevision/)
  assert.match(minimapTag, /ref="miniMapPreview"/)
  assert.doesNotMatch(minimapTag, /:render-revision=/)
  assert.doesNotMatch(minimapTag, /:render-revision="zoom"|:zoom=/)
  assert.doesNotMatch(minimapWatch, /props\.zoom/)
})

test('canvas zoom does not serialize nested node data from v-memo expressions', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const memoAccessor = functionSource(appSource, 'nodeRenderMemo')
  const loopStart = appSource.indexOf('<div v-for="n in editorRenderedNodes"')
  const loopEnd = appSource.indexOf('<div v-if="showMiniMap"', loopStart)
  const editorNodeLoop = appSource.slice(loopStart, loopEnd)

  assert.notEqual(loopStart, -1)
  assert.notEqual(loopEnd, -1)
  assert.match(editorNodeLoop, /v-memo=/)
  assert.match(appSource, /const nodeRenderMemoCache = new WeakMap\(\)/)
  assert.match(memoAccessor, /computed\(\(\) =>/)
  assert.match(editorNodeLoop, /nodeRenderMemo\(n\)/)
  assert.doesNotMatch(editorNodeLoop, /(?:form|progress|pencil|polyline)MemoKey\(n\)/)
  assert.doesNotMatch(editorNodeLoop, /JSON\.stringify/)
})

test('pointer geometry history avoids serializing the complete document', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const pointerCommit = appSource.match(/function commitPointerOperation\(op\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.doesNotMatch(appSource, /function\s+commit\s*\(|\b(snapshot|restore)\s*\(/)
  assert.doesNotMatch(appSource, /JSON\.stringify\(\{[\s\S]*?toRaw\(nodes\.value\)/)
  assert.match(appSource, /function pointerGeometryHistory\(op\)/)
  assert.match(pointerCommit, /pointerGeometryHistory\(op\)/)
  assert.match(pointerCommit, /recordHistory\(entry\)/)
  assert.doesNotMatch(pointerCommit, /snapshot\(\)|\bcommit\(\)/)
})

test('editor teardown discards a queued pointer frame before ending the operation', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const teardown = appSource.match(/onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] || ''
  const cancelAt = teardown.indexOf('cancelAnimationFrame(pointerFrame)')
  const clearFrameAt = teardown.indexOf('pointerFrame = 0')
  const clearPointerAt = teardown.indexOf('pendingPointer = null')
  const pointerUpAt = teardown.indexOf('pointerUp()')

  assert.ok(cancelAt >= 0, '卸载时应取消待处理的指针动画帧')
  assert.ok(clearFrameAt > cancelAt && clearFrameAt < pointerUpAt, '应在 pointerUp 前清除指针帧标记')
  assert.ok(clearPointerAt > cancelAt && clearPointerAt < pointerUpAt, '应在 pointerUp 前丢弃待处理坐标')
})

test('adding catalog and bundled nodes records compact entity insertion history', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const addNode = functionSource(appSource, 'addNode')
  const instantiateBundle = functionSource(appSource, 'instantiateNodeBundle')
  const commitPreparedBundle = functionSource(appSource, 'commitPreparedNodeBundle')
  const recordInsertion = functionSource(appSource, 'recordEntityInsertion')

  for (const [label, source] of [['普通组件新增', addNode], ['组件模板实例化', instantiateBundle], ['组件模板原子发布', commitPreparedBundle]]) {
    assert.doesNotMatch(source, /\bcommit\(\)|\bsnapshot\(\)/, `${label}不应序列化完整图纸`)
    assert.doesNotMatch(source, /JSON\.stringify\(\s*(?:toRaw\()?\s*(?:nodes|edges|drawings)\.value/, `${label}不应序列化完整实体集合`)
  }
  assert.match(addNode, /recordEntityInsertion\(\{\s*nodes:\s*\[n\]/)
  assert.match(commitPreparedBundle, /recordHistory\(ready\.historyEntry, ready\.historyBytes\)/)
  assert.doesNotMatch(commitPreparedBundle, /new globalThis\.Map\(nodeIndex\.value\)|nodes\.value\.concat|edges\.value\.concat|layerEntries\.value\.concat/)
  assert.match(commitPreparedBundle, /toRaw\(nodes\.value\)\.push\(\.\.\.ready\.nodes\)/)
  assert.match(commitPreparedBundle, /toRaw\(edges\.value\)\.push\(\.\.\.ready\.edges\)/)

  assert.match(recordInsertion, /createEntityInsertionEntry\(/)
  assert.match(recordInsertion, /\bnodes\b/)
  assert.match(recordInsertion, /\bedges\b/)
  assert.match(recordInsertion, /\bdrawings\b/)
  assert.doesNotMatch(recordInsertion, /\bsnapshot\(\)|JSON\.stringify\(|toRaw\(nodes\.value\)/)
})

test('entity history captures inverse state so undo and redo restore insertions and removals', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const capture = functionSource(appSource, 'captureEntityHistory')
  const apply = functionSource(appSource, 'applyEntityHistory')
  const applySpatialChanges = functionSource(appSource, 'applyNodeSpatialChanges')
  const captureDispatch = functionSource(appSource, 'captureHistoryEntry')
  const applyDispatch = functionSource(appSource, 'applyHistoryEntry')
  const undo = functionSource(appSource, 'undo')
  const redo = functionSource(appSource, 'redo')

  assert.match(capture, /captureEntityEntry\(entry,\s*entityCollections\(\),\s*\{\s*reuseEntityReferences:\s*true\s*\}\)/)

  // value:null 表示目标状态中实体不存在；非空 value 必须按原 index 恢复。
  assert.match(apply, /applyEntityEntry\(entry,\s*entityCollections\(\)/)
  assert.match(apply, /reuseEntityReferences:\s*true/)
  assert.match(apply, /mutateRawCollections:\s*true/)
  assert.match(apply, /applyNodeSpatialChanges\(changes\.nodes\.removed,\s*changes\.nodes\.inserted\)/)
  assert.match(applySpatialChanges, /nodeSpatialIndex\.remove\(item\.id\)/)
  assert.match(applySpatialChanges, /nodeSpatialIndex\.update\(item\.value\)/)
  assert.match(apply, /triggerRef\(nodes\)/)
  assert.match(apply, /triggerRef\(edges\)/)
  assert.match(apply, /triggerRef\(drawings\)/)
  assert.match(apply, /markMiniMapDirty\(\)/)

  assert.match(captureDispatch, /entry\.kind === 'entities'[^\n]*captureEntityHistory\(entry\)/)
  assert.match(applyDispatch, /entry\.kind === 'entities'[^\n]*applyEntityHistory\(entry\)/)
  assert.match(undo, /captureHistoryEntry\(entry\)[\s\S]*?future\.value\.push\(inverse\)[\s\S]*?applyHistoryEntry\(entry\)/)
  assert.match(redo, /appendHistory\(captureHistoryEntry\(entry\),\s*false\)[\s\S]*?applyHistoryEntry\(entry\)/)
})

test('entity restoration returns the Vue proxy used by the spatial index', () => {
  const nodes = ref([])
  const entry = {
    kind: 'entities',
    nodes: [{ id: 'restored-node', index: 0, value: { id: 'restored-node', x: 10, y: 20, w: 80, h: 40 } }],
    edges: [],
    drawings: []
  }

  const changes = applyEntityEntry(entry, { nodes: nodes.value, edges: [], drawings: [] })
  const restored = nodes.value[0]

  assert.equal(isReactive(restored), true)
  assert.equal(changes.nodes.inserted[0].value, restored)
  assert.equal(isReactive(changes.nodes.inserted[0].value), true)
})

test('entity history batches 2k node and 4k edge removal and restoration while preserving references and indexes', async () => {
  const targetNodeCount = 2_000
  const targetEdgeCount = 4_000
  const leadingNode = { id: 'leading-node', x: -100, y: -100, w: 20, h: 20, dataKey: '' }
  const trailingNode = { id: 'trailing-node', x: 50_000, y: 50_000, w: 20, h: 20, dataKey: '' }
  const targetNodes = Array.from({ length: targetNodeCount }, (_, index) => ({
    id: `batch-node-${index}`,
    x: (index % 100) * 120,
    y: Math.floor(index / 100) * 90,
    w: 80,
    h: 50,
    layer: index + 2,
    dataKey: `runtime.batch.${index}`,
    nested: { rows: [[index, { label: `node-${index}` }]], flags: { enabled: index % 2 === 0 } }
  }))
  const leadingEdge = { id: 'leading-edge', from: leadingNode.id, to: trailingNode.id }
  const trailingEdge = { id: 'trailing-edge', from: trailingNode.id, to: leadingNode.id }
  const targetEdges = Array.from({ length: targetEdgeCount }, (_, index) => ({
    id: `batch-edge-${index}`,
    from: targetNodes[index % targetNodeCount].id,
    to: targetNodes[(index + 1) % targetNodeCount].id,
    nested: { route: [{ x: index, y: index + 1 }] }
  }))
  const nodes = ref([leadingNode, ...targetNodes, trailingNode])
  const edges = ref([leadingEdge, ...targetEdges, trailingEdge])
  const nodeReferences = nodes.value.slice(1, targetNodeCount + 1)
  const edgeReferences = edges.value.slice(1, targetEdgeCount + 1)
  const nestedNodeReference = nodeReferences[0].nested
  const nestedEdgeReference = edgeReferences[0].nested
  const observedNodes = observeCollectionSplices(toRaw(nodes.value))
  const observedEdges = observeCollectionSplices(toRaw(edges.value))
  const collections = { nodes: nodes.value, edges: edges.value, drawings: [] }
  const historyOptions = { reuseEntityReferences: true, mutateRawCollections: true }
  const identifiers = {
    kind: 'entities',
    nodes: nodeReferences.map(node => ({ id: node.id, index: 0, value: null })),
    edges: edgeReferences.map(edge => ({ id: edge.id, index: 0, value: null })),
    drawings: []
  }

  const removalEntry = captureEntityEntry(identifiers, collections, historyOptions)
  const removeCommand = captureEntityEntry(removalEntry, collections, historyOptions)
  assert.ok(removalEntry.nodes.every((item, index) => item.value === nodeReferences[index] && item.index === index + 1))
  assert.ok(removalEntry.edges.every((item, index) => item.value === edgeReferences[index] && item.index === index + 1))
  assert.ok(removeCommand.nodes.every(item => item.value === null))
  assert.ok(removeCommand.edges.every(item => item.value === null))

  const spatialIndex = createSpatialIndex(nodes.value, { cellSize: 256 })
  const dataKeyIndex = createDataKeyIndex()
  dataKeyIndex.rebuild(nodes.value)
  const adjacencyIndex = createEdgeAdjacencyIndex()
  adjacencyIndex.rebuild(edges.value)
  let publishedNodeLength = nodes.value.length
  let publishedEdgeLength = edges.value.length
  const stopNodeWatch = watchEffect(() => { publishedNodeLength = nodes.value.length })
  const stopEdgeWatch = watchEffect(() => { publishedEdgeLength = edges.value.length })
  const applyIndexChanges = changes => {
    for (const item of changes.nodes.removed) spatialIndex.remove(item.id)
    for (const item of changes.nodes.inserted) spatialIndex.update(item.value)
    dataKeyIndex.remove(changes.nodes.removed)
    dataKeyIndex.add(changes.nodes.inserted.map(item => item.value))
    adjacencyIndex.applyChanges(changes.edges.removed, changes.edges.inserted)
  }

  const removedChanges = applyEntityEntry(removeCommand, collections, {}, historyOptions)
  applyIndexChanges(removedChanges)
  triggerRef(nodes)
  triggerRef(edges)
  await nextTick()
  assert.deepEqual(nodes.value.map(node => node.id), [leadingNode.id, trailingNode.id])
  assert.deepEqual(edges.value.map(edge => edge.id), [leadingEdge.id, trailingEdge.id])
  assert.equal(spatialIndex.state.entries, 2)
  assert.equal(dataKeyIndex.state.nodeCount, 0)
  assert.equal(adjacencyIndex.state.edgeCount, 2)
  assert.equal(publishedNodeLength, 2)
  assert.equal(publishedEdgeLength, 2)
  assert.equal(observedNodes.stats.splices, 1)
  assert.equal(observedEdges.stats.splices, 1)

  let normalizerCalls = 0
  const normalizers = {
    nodes: value => { normalizerCalls += 1; return value },
    edges: value => { normalizerCalls += 1; return value }
  }
  const restoredChanges = applyEntityEntry(removalEntry, collections, normalizers, historyOptions)
  applyIndexChanges(restoredChanges)
  triggerRef(nodes)
  triggerRef(edges)
  await nextTick()

  assert.equal(normalizerCalls, 0)
  assert.equal(observedNodes.stats.splices, 2)
  assert.equal(observedEdges.stats.splices, 2)
  assert.deepEqual(nodes.value.map(node => node.id), [leadingNode.id, ...targetNodes.map(node => node.id), trailingNode.id])
  assert.deepEqual(edges.value.map(edge => edge.id), [leadingEdge.id, ...targetEdges.map(edge => edge.id), trailingEdge.id])
  assert.ok(nodeReferences.every((node, index) => nodes.value[index + 1] === node))
  assert.ok(edgeReferences.every((edge, index) => edges.value[index + 1] === edge))
  assert.equal(nodes.value[1].nested, nestedNodeReference)
  assert.equal(edges.value[1].nested, nestedEdgeReference)
  assert.equal(spatialIndex.state.entries, targetNodeCount + 2)
  assert.equal(dataKeyIndex.state.nodeCount, targetNodeCount)
  assert.equal(adjacencyIndex.state.edgeCount, targetEdgeCount + 2)
  assert.equal(publishedNodeLength, targetNodeCount + 2)
  assert.equal(publishedEdgeLength, targetEdgeCount + 2)
  assert.equal(adjacencyIndex.countFor(targetNodes[0].id), 4)
  assert.equal(dataKeyIndex.keyFor(targetNodes[0].id), targetNodes[0].dataKey)
  assert.ok(spatialIndex.has(targetNodes.at(-1).id))
  stopNodeWatch()
  stopEdgeWatch()
})

test('entity insertion undo only reads affected records on a 10k-node document', () => {
  const nodes = createSparseNodes()
  const target = nodes.at(-1)
  const observedNodes = observeCollectionAccess(nodes)
  const observedEdges = observeCollectionAccess(Array.from({ length: 20_000 }, (_, index) => ({ id: `edge-${index}` })))
  const observedDrawings = observeCollectionAccess(Array.from({ length: 2_000 }, (_, index) => ({ id: `drawing-${index}` })))
  const collections = {
    nodes: observedNodes.collection,
    edges: observedEdges.collection,
    drawings: observedDrawings.collection
  }
  const entry = {
    kind: 'entities',
    nodes: [{ id: target.id, index: nodes.length - 1, value: null }],
    edges: [],
    drawings: []
  }

  const inverse = captureEntityEntry(entry, collections)
  const changes = applyEntityEntry(entry, collections)

  assert.deepEqual(inverse.nodes[0].value, target)
  assert.equal(changes.nodes.removed[0].id, target.id)
  assert.equal(nodes.length, NODE_COUNT - 1)
  assert.equal(observedNodes.stats.mapReads, 0, 'the normal index hit must not build a full node map')
  assert.ok(observedNodes.stats.numericReads <= 5, `expected O(1) node reads, received ${observedNodes.stats.numericReads}`)
  assert.deepEqual(observedEdges.stats, { numericReads: 0, mapReads: 0 })
  assert.deepEqual(observedDrawings.stats, { numericReads: 0, mapReads: 0 })
})

test('entity restoration does not scan a large document to confirm absence', () => {
  const nodes = createSparseNodes()
  const restoredNode = { id: 'restored-at-end', x: 24_000, y: 18_000, w: 80, h: 40 }
  const observedNodes = observeCollectionAccess(nodes)
  const observedEdges = observeCollectionAccess(Array.from({ length: 20_000 }, (_, index) => ({ id: `edge-${index}` })))
  const observedDrawings = observeCollectionAccess(Array.from({ length: 2_000 }, (_, index) => ({ id: `drawing-${index}` })))
  const collections = {
    nodes: observedNodes.collection,
    edges: observedEdges.collection,
    drawings: observedDrawings.collection
  }
  const entry = {
    kind: 'entities',
    nodes: [{ id: restoredNode.id, index: NODE_COUNT, value: restoredNode }],
    edges: [],
    drawings: []
  }

  const inverse = captureEntityEntry(entry, collections)
  const changes = applyEntityEntry(entry, collections)

  assert.equal(inverse.nodes[0].value, null)
  assert.equal(changes.nodes.inserted[0].id, restoredNode.id)
  assert.equal(nodes.at(-1).id, restoredNode.id)
  assert.equal(observedNodes.stats.mapReads, 0, 'restoring an absent entity must not build a full node map')
  assert.ok(observedNodes.stats.numericReads <= 2, `expected O(1) restoration reads, received ${observedNodes.stats.numericReads}`)
  assert.deepEqual(observedEdges.stats, { numericReads: 0, mapReads: 0 })
  assert.deepEqual(observedDrawings.stats, { numericReads: 0, mapReads: 0 })
})

test('entity history contract reverses additions and removals on a 10k-node document', () => {
  const originalNodes = createSparseNodes()
  const document = { nodes: originalNodes.map(cloneEntity), edges: [], drawings: [] }
  const addedNodes = [
    { id: 'added-a', x: 300, y: 400, w: 80, h: 50, text: 'A' },
    { id: 'added-b', x: 430, y: 400, w: 80, h: 50, text: 'B' }
  ]
  const addedEdge = { id: 'added-edge', from: 'added-a', to: 'added-b', width: 2 }
  const insertionEntry = createEntityInsertionEntry(
    { nodes: addedNodes, edges: [addedEdge], drawings: [] },
    { nodes: NODE_COUNT, edges: 0, drawings: 0 }
  )

  document.nodes.push(...addedNodes.map(cloneEntity))
  document.edges.push(cloneEntity(addedEdge))
  const redoInsertion = captureEntityEntry(insertionEntry, document)
  applyEntityEntry(insertionEntry, document)
  assert.deepEqual(document.nodes, originalNodes)
  assert.deepEqual(document.edges, [])

  const undoInsertion = captureEntityEntry(redoInsertion, document)
  applyEntityEntry(redoInsertion, document)
  assert.deepEqual(document.nodes.slice(-2), addedNodes)
  assert.deepEqual(document.edges, [addedEdge])
  assert.ok(undoInsertion.nodes.every(record => record.value === null))

  const deletionEntry = {
    kind: 'entities',
    nodes: redoInsertion.nodes.map(record => ({ ...record, value: cloneEntity(record.value) })),
    edges: redoInsertion.edges.map(record => ({ ...record, value: cloneEntity(record.value) })),
    drawings: []
  }
  document.nodes = document.nodes.filter(node => !addedNodes.some(added => added.id === node.id))
  document.edges = []
  const redoDeletion = captureEntityEntry(deletionEntry, document)
  applyEntityEntry(deletionEntry, document)
  assert.deepEqual(document.nodes.slice(-2), addedNodes)
  assert.deepEqual(document.edges, [addedEdge])

  const undoDeletion = captureEntityEntry(redoDeletion, document)
  applyEntityEntry(redoDeletion, document)
  assert.deepEqual(document.nodes, originalNodes)
  assert.deepEqual(document.edges, [])
  assert.ok(undoDeletion.nodes.every(record => record.value != null))

  const fullSnapshotBytes = Buffer.byteLength(JSON.stringify({ nodes: originalNodes, edges: [], drawings: [] }))
  const insertionHistoryBytes = Buffer.byteLength(JSON.stringify(insertionEntry))
  assert.ok(insertionHistoryBytes < fullSnapshotBytes * 0.01, `实体历史 ${insertionHistoryBytes}B 不应接近整图 ${fullSnapshotBytes}B`)
})

test('the structure panel virtualizes thousands of layer rows', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(appSource, /const STRUCTURE_ROW_HEIGHT = 40/)
  assert.match(appSource, /const structureVirtualRows = computed\(/)
  assert.match(appSource, /class="structure-scroll"[^>]*@scroll\.passive="updateStructureViewport"/)
  assert.match(appSource, /v-for="row in structureVirtualRows"/)
  assert.doesNotMatch(appSource, /v-for="item in \[\.\.\.layerEntries\]\.reverse\(\)"/)
})

test('new entities use a dual layer allocator without rescanning existing nodes', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const projectPreparationSource = await readFile(new URL('../src/utils/projectPreparation.js', import.meta.url), 'utf8')
  const addNode = functionSource(appSource, 'addNode')
  const commitPreparedBundle = functionSource(appSource, 'commitPreparedNodeBundle')
  const reserveLayers = functionSource(appSource, 'reserveEntityLayers')
  const rebuildIndexes = functionSource(appSource, 'rebuildDocumentIndexes')
  const prepareProject = functionSource(projectPreparationSource, 'prepareProject')

  assert.match(appSource, /createLayerAllocator/)
  assert.match(projectPreparationSource, /import \{ compactEntityLayers \} from '\.\/documentIndexes\.js'/)
  assert.match(appSource, /let entityLayerAllocator = createLayerAllocator\(\)/)
  assert.match(appSource, /entityLayerAllocator = runtime\.entityLayerAllocator/)
  assert.doesNotMatch(appSource, /function nextLayer\(/)
  assert.match(addNode, /layer: reserveEntityLayers\(\)/)
  assert.match(commitPreparedBundle, /const baseLayer = reserveEntityLayers\(ready\.nodes\.length\)/)
  assert.match(reserveLayers, /entityLayerAllocator\.reserve\(count\)\.start/)
  assert.doesNotMatch(reserveLayers, /nodes\.value|drawings\.value|\.map\(|for\s*\(/)
  assert.match(prepareProject, /compactEntityLayers\(project\.nodes\)/)
  assert.match(rebuildIndexes, /entityLayerAllocator\.rebuild\(\[nodes\.value, drawings\.value\]\)/)
})

test('layer, time, and edge indexes update only the affected insertion batch', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const appendNodes = functionSource(appSource, 'appendNodes')
  const appendEdges = functionSource(appSource, 'appendEdges')
  const appendLayers = functionSource(appSource, 'appendLayerEntries')
  const removeLayers = functionSource(appSource, 'removeLayerEntries')
  const applyHistory = functionSource(appSource, 'applyEntityHistory')

  assert.match(appSource, /const layerEntries = shallowRef\(\[\]\)/)
  assert.doesNotMatch(appSource, /const layerEntries = computed\([\s\S]*?nodes\.value\.map/)
  assert.match(appendLayers, /entries\.push\(\.\.\.additions\)/)
  assert.doesNotMatch(appendLayers, /nodes\.value|drawings\.value/)
  assert.match(removeLayers, /entries\.splice\(writeIndex\)/)
  assert.doesNotMatch(removeLayers, /splice\([^\n]*,\s*1\)/)
  assert.match(appSource, /entries\[entries\.length - index - 1\]/)

  assert.match(appSource, /const timeNodeIndex = shallowRef\(new globalThis\.Map\(\)\)/)
  assert.match(appendNodes, /addTimeNodes\(inserted\)/)
  assert.doesNotMatch(appSource, /const hasServerTime = computed\(\(\) => nodes\.value\.some/)
  assert.doesNotMatch(appSource, /const hasAutomaticTime = computed\(\(\) => nodes\.value\.some/)

  assert.match(appSource, /const edgeAdjacency = shallowRef\(createEdgeAdjacencyIndex\(\)\)/)
  assert.match(appendEdges, /updateEdgeAdjacency\(\[\], inserted\)/)
  assert.match(applyHistory, /updateEdgeAdjacency\(changes\.edges\.removed, changes\.edges\.inserted\)/)
  assert.doesNotMatch(appSource, /const edgeAdjacency = computed\([\s\S]*?for \(const edge of edges\.value\)/)
})

test('high-fanout geometry detects deferred edge work without enumerating incident edges', async () => {
  let countCalls = 0
  const adjacency = {
    countFor(nodeId) {
      countCalls += 1
      return nodeId === 'hub' ? 20_000 : 1
    },
    get() {
      throw new Error('the threshold probe must not enumerate edges')
    }
  }

  assert.equal(incidentEdgeCountExceedsLimit(adjacency, ['hub'], 128), true)
  assert.equal(countCalls, 1)

  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const updateConnected = functionSource(appSource, 'updateConnectedEdgeSpatialIndex')
  const geometryPayload = functionSource(appSource, 'editorLodGeometryPayload')
  const pointerUp = functionSource(appSource, 'pointerUp')

  assert.match(appSource, /const EDITOR_LOD_INTERACTION_EDGE_LIMIT = 128/)
  assert.match(updateConnected, /incidentEdgeCountExceedsLimit\([\s\S]*?EDITOR_LOD_INTERACTION_EDGE_LIMIT/)
  assert.match(updateConnected, /documentIndexRebuildRequired = true/)
  assert.ok(updateConnected.indexOf('incidentEdgeCountExceedsLimit') < updateConnected.indexOf('edgeAdjacency.value.get'))
  assert.match(geometryPayload, /edgesForNodeIds\([\s\S]*?EDITOR_LOD_INTERACTION_EDGE_LIMIT/)
  assert.match(appSource, /editorLodOverlayEdges\(\{[\s\S]*?limit: EDITOR_LOD_INTERACTION_EDGE_LIMIT/)
  assert.match(appSource, /if \(!hasSegments && !documentIndexRebuildRequired\) return/)
  assert.match(appSource, /commit\(task, payload\) \{[\s\S]*?nodeSpatialIndex = task\.nodeSpatialIndex[\s\S]*?edgeSpatialIndex = task\.edgeSpatialIndex[\s\S]*?documentIndexRebuildRequired = false/)
  assert.match(pointerUp, /if \(!documentIndexRebuildRequired\) edgeSpatialRevision\.value \+= 1/)
  assert.match(pointerUp, /endEditorInteraction\(POINTER_INTERACTION\)[\s\S]*?scheduleDocumentIndexCompaction\(\)/)
})

test('high-fanout runtime keys defer node fanout to the bounded Canvas dirty queue', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const queueDirtyKey = functionSource(appSource, 'queueRuntimeCanvasDirtyKey')
  const takeDirtyNodes = functionSource(appSource, 'takeRuntimeCanvasDirtyNodes')

  assert.match(appSource, /const RUNTIME_CANVAS_DISPATCH_BUDGET_MS = 2/)
  assert.match(appSource, /const RUNTIME_CANVAS_DISPATCH_BATCH_LIMIT = 1/)
  assert.match(appSource, /createRuntimeCanvasDirtyQueue\(\{[\s\S]*?runtimeDataKeyIndex\.idsFor\(key\)[\s\S]*?runtimeBindingPointIndex\.nodeIdsFor\(key\)/)
  assert.match(queueDirtyKey, /const affectedCount = runtimeDataKeyIndex\.countFor\(normalizedKey\)[\s\S]*?runtimeBindingPointIndex\.countFor\(normalizedKey\)/)
  assert.match(queueDirtyKey, /return affectedCount > 0 && runtimeCanvasDirtyQueue\.queueKey\(normalizedKey\)/)
  assert.doesNotMatch(queueDirtyKey, /idsFor|nodeIdsFor|nodeIndex|for\s*\(/)
  assert.match(takeDirtyNodes, /runtimeCanvasDirtyQueue\.takeBatch\(DEFAULT_RUNTIME_CANVAS_DIRTY_BATCH_SIZE\)/)
  assert.doesNotMatch(appSource, /RUNTIME_CANVAS_INCREMENTAL_NODE_LIMIT|affectedCount > RUNTIME|runtimeCanvasFullRedraw/)
})

test('node memoization keeps runtime subscriptions out of the parent render loops', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const previewLayerSource = await readFile(new URL('../src/components/ProgressivePreviewNodes.vue', import.meta.url), 'utf8')
  const previewBatchSource = await readFile(new URL('../src/components/PreviewNodeBatch.vue', import.meta.url), 'utf8')
  const nodeVisualSource = await readFile(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
  const runtimeValueTextSource = await readFile(new URL('../src/components/RuntimeValueText.vue', import.meta.url), 'utf8')
  const memoAccessor = functionSource(appSource, 'nodeRenderMemo')
  const memoExpressions = [...appSource.matchAll(/v-memo="(\[nodeRenderMemo\(n\)[^"]*)"/g)].map(match => match[1])

  assert.equal(memoExpressions.length, 1)
  assert.ok(memoExpressions.every(expression => !/n\.(?:x|y|w|h|text|videoUrl|signalColors)/.test(expression)))
  assert.match(memoAccessor, /const geometry = computed\(/)
  assert.match(memoAccessor, /const common = computed\(/)
  assert.match(memoAccessor, /const content = computed\(/)
  assert.doesNotMatch(appSource, /getRuntimeVersion|getRuntimeValue|nodeRenderTime/)
  assert.match(appSource, /const previewFitInitialRenderUrgent = computed\(\(\) => \([\s\S]*?previewFallbackRequired\.value[\s\S]*?!previewPresentationReady\.value[\s\S]*?\)\)/)
  assert.match(appSource, /const previewFitRenderMode = computed\(\(\) => \(previewFitActive\.value \|\| previewFitInitialRenderUrgent\.value\) \? 'task' : 'idle'\)/)
  assert.match(appSource, /const previewFitRenderBudgetMs = computed\(\(\) => previewFitRenderMode\.value === 'task' \? 4 : 2\)/)
  assert.match(appSource, /<MiniMapPreview v-if="previewFitMounted"[^>]*:runtime-store="runtimeData"[^>]*:render-budget-ms="previewFitRenderBudgetMs"[^>]*:render-mode="previewFitRenderMode"[^>]*faithful[^>]*@render-complete="handlePreviewFitRenderComplete"/)
  assert.match(appSource, /<div v-if="previewDomMounted"[^>]*class="preview-stage"[^>]*data-testid="preview-dom-stage"[^>]*[\s\S]*?<ProgressivePreviewNodes :nodes="previewDomNodes" :generation="previewDomGeneration" progressive :batch-size="8" :mount-cost-budget="64" :runtime-store="runtimeData"/)
  assert.match(appSource, /<div v-if="previewLivePlaneActive"[^>]*class="preview-stage is-live-plane"[^>]*data-testid="preview-live-plane"[^>]*[\s\S]*?<ProgressivePreviewNodes :nodes="previewLivePlaneNodes"[^>]*:batch-size="PREVIEW_HYBRID_MAX_DOM_NODES"[^>]*:mount-cost-budget="PREVIEW_HYBRID_MAX_DOM_COST"/)
  assert.match(appSource, /const previewDomNodes = computed\([\s\S]*?previewFitExcludedNodeIds\.value[\s\S]*?source\.filter\(node => !excludedIds\.has\(node\.id\)\)/)
  assert.match(appSource, /const previewDomDrawings = computed\([\s\S]*?previewFitExcludedDrawingIds\.value[\s\S]*?source\.filter\(drawing => !excludedIds\.has\(drawing\.id\)\)/)
  assert.match(appSource, /<MiniMapPreview v-if="previewFitMounted"[^>]*:excluded-node-ids="previewFitExcludedNodeIds"[^>]*:excluded-drawing-ids="previewFitExcludedDrawingIds"/)
  assert.match(appSource, /const previewNodeCandidates = computed\(\(\) => \{[\s\S]*?nodeSpatialIndex\.query\([\s\S]*?\{ sort: false \}\)/)
  assert.doesNotMatch(appSource, /const previewVisibleNodes = computed\(\(\) => previewNodeCandidates\.value\.slice/)
  assert.match(appSource, /const previewSmallDocument = computed\(\(\) => \([\s\S]*?nodes\.value\.length <= PREVIEW_DOM_NODE_LIMIT[\s\S]*?edges\.value\.length <= PREVIEW_DOM_EDGE_LIMIT[\s\S]*?drawings\.value\.length <= PREVIEW_DOM_DRAWING_LIMIT/)
  assert.match(appSource, /const previewFallbackRequired = computed\(\(\) => showPreview\.value && !previewSmallDocument\.value\)/)
  assert.match(previewLayerSource, /watch\(\[\(\) => props\.nodes, \(\) => props\.generation, \(\) => props\.progressive/)
  assert.match(previewLayerSource, /emit\('render-complete', \{ generation: sourceGeneration, count: source\.length \}\)/)
  assert.match(previewLayerSource, /const visibleBatches = shallowRef\(\[\]\)/)
  assert.match(previewLayerSource, /partitionRetainedPreviewNodeBatches\(source, visibleBatches\.value\)[\s\S]*?visibleBatches\.value = retainedBatches/)
  assert.match(previewLayerSource, /visibleBatches\.value = \[[\s\S]*?items: pendingNodes\.slice\(pendingCount, nextCount\)/)
  assert.match(previewLayerSource, /v-for="batch in visibleBatches"/)
  assert.match(previewBatchSource, /:runtime-store="runtimeStore"/)
  assert.match(previewBatchSource, /v-memo="\[node,[^"]*runtimeStore,timeContext\]"/)
  assert.match(nodeVisualSource, /watch\(\[\(\) => props\.runtimeStore, \(\) => props\.node\.type, \(\) => props\.node\.dataKey\], syncRuntimeBinding/)
  assert.match(nodeVisualSource, /unsubscribeRuntimeBinding = nextStore\.subscribe\(nextKey, value =>/)
  assert.match(nodeVisualSource, /for \(const entry of runtimePointBindings\?\.values\(\) \|\| \[\]\) entry\.unsubscribe\?\.\(\)/)
  assert.match(nodeVisualSource, /if \(!tableVirtualized\.value\) return[\s\S]*?requestAnimationFrame/)
  assert.match(nodeVisualSource, /onMounted\(\(\) => \{[\s\S]*?if \(!tableVirtualized\.value\) return/)
  assert.doesNotMatch(nodeVisualSource, /runtimeBindingStore\?\.release|runtimePointStore\.acquire/)
  assert.match(runtimeValueTextSource, /watch\(\[\(\) => props\.runtimeStore, \(\) => props\.dataKey, \(\) => props\.fallback\], syncSubscription\)/)
  assert.match(appSource, /nodeSpatialIndex\.query\(bounds, \{ sort: false \}\)/)
})
