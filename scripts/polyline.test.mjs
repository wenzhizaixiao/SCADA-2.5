import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import { h } from 'vue'
import { createServer } from 'vite'
import {
  COMPONENT_CATEGORY_BY_TYPE,
  createComponentGroups
} from '../src/config/componentCatalog.js'
import { baseNodeOptions, normalizeNode } from '../src/models/editorModel.js'
import {
  countProjectCapacity,
  PROJECT_CAPACITY_LIMITS,
  ProjectValidationError,
  validateProjectForFrontend
} from '../src/utils/projectValidation.js'
import {
  clampPolylineSegmentCount,
  createEvenlySpacedPolylinePoints,
  DEFAULT_POLYLINE_SEGMENT_COUNT,
  MAX_POLYLINE_SEGMENT_COUNT,
  normalizeWorldPolylinePoints,
  nearestPolylinePointIndex,
  polylineArrowSize,
  polylineDashArray,
  polylineDashSegments,
  polylineFrameFromWorldPoints,
  polylineLocalPointToWorld,
  polylineLineOpacity,
  polylineLineStyle,
  polylineLineWidth,
  polylineNormalizedPointsToLocal,
  polylineOutlineWidth,
  polylinePointHandlePaths,
  polylineStrokeLineCap,
  reframePolylineNode,
  resamplePolylineNodeGeometry,
  resamplePolylineNodePoints,
  resamplePolylinePoints,
  worldPointToPolylineLocal
} from '../src/utils/polylineGeometry.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const projectPreparationSource = readFileSync(new URL('../src/utils/projectPreparation.js', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const previewNodeBatchSource = readFileSync(new URL('../src/components/PreviewNodeBatch.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')

let nodeVisual
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  })
  nodeVisual = (await vite.ssrLoadModule('/src/components/NodeVisual.vue')).default
})

after(async () => {
  await vite?.close()
})

function sourceBetween(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}

function polylineNode(overrides = {}) {
  return normalizeNode({
    ...baseNodeOptions(),
    id: 'polyline-render-test',
    type: 'polyline',
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    text: '线段',
    opacity: 1,
    polylinePoints: [{ x: .1, y: .2 }, { x: .5, y: .6 }, { x: .9, y: .25 }],
    ...overrides
  })
}

async function renderPolyline(startMarker, endMarker) {
  return renderToString(h(nodeVisual, {
    node: polylineNode({ polylineStartMarker: startMarker, polylineEndMarker: endMarker })
  }))
}

function assertClose(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`)
}

test('keeps straight line in basic shapes and polyline alone in its own category', () => {
  const groups = createComponentGroups()
  const basicShapes = groups.find(group => group.name === '基本形状')
  const polylineGroup = groups.find(group => group.name === '线段')

  assert.ok(basicShapes)
  assert.ok(polylineGroup)
  assert.ok(basicShapes.items.some(item => item.type === 'lineShape' && item.name === '直线'))
  assert.equal(basicShapes.items.some(item => item.type === 'polyline'), false)
  assert.deepEqual(polylineGroup.items.map(item => ({ type: item.type, name: item.name })), [
    { type: 'polyline', name: '线段' }
  ])
  assert.equal(COMPONENT_CATEGORY_BY_TYPE.get('lineShape'), '基本形状')
  assert.equal(COMPONENT_CATEGORY_BY_TYPE.get('polyline'), '线段')

  const secondCatalog = createComponentGroups()
  assert.notStrictEqual(groups, secondCatalog)
  assert.notStrictEqual(polylineGroup.items, secondCatalog.find(group => group.name === '线段').items)
})

test('normalizes polyline points, width, endpoint markers, and independent arrays', () => {
  const sourcePoints = [
    { x: -.2, y: .25 },
    { x: 'invalid', y: .5 },
    { x: .7, y: 1.4 }
  ]
  const normalized = normalizeNode({
    id: 'polyline-normalize',
    type: 'polyline',
    x: 10,
    y: 20,
    w: 160,
    h: 90,
    polylinePoints: sourcePoints,
    polylineWidth: 500,
    polylineArrowSize: 500,
    polylineStartMarker: 'circle',
    polylineEndMarker: 'arrow'
  })

  assert.deepEqual(normalized.polylinePoints, [{ x: 0, y: .25 }, { x: .7, y: 1 }])
  assert.equal(normalized.polylineWidth, 100)
  assert.equal(normalized.polylineArrowSize, 100)
  assert.equal(normalized.polylineStartMarker, 'none')
  assert.equal(normalized.polylineEndMarker, 'arrow')
  assert.equal(normalized.backgroundOpacity, 0)
  assert.equal(normalized.borderVisible, false)
  assert.notStrictEqual(normalized.polylinePoints, sourcePoints)

  const firstDefaults = baseNodeOptions()
  const secondDefaults = baseNodeOptions()
  assert.equal(secondDefaults.polylineArrowSize, 8)
  assert.notStrictEqual(firstDefaults.polylinePoints, secondDefaults.polylinePoints)
  firstDefaults.polylinePoints.push({ x: 0, y: 0 })
  assert.equal(secondDefaults.polylinePoints.length, 4)

  const firstNode = normalizeNode({ type: 'polyline' })
  const secondNode = normalizeNode({ type: 'polyline' })
  assert.notStrictEqual(firstNode.polylinePoints, secondNode.polylinePoints)
  firstNode.polylinePoints[0].x = 1
  assert.equal(secondNode.polylinePoints[0].x, .08)
})

test('migrates legacy dashed polylines and normalizes shared line appearance fields', () => {
  const migrated = normalizeNode({
    id: 'polyline-legacy-style',
    type: 'polyline',
    x: 0,
    y: 0,
    w: 160,
    h: 90,
    polylineDash: true,
    polylineOpacity: .35,
    borderVisible: true,
    stroke: '#123456',
    borderWidth: 3.5,
    borderDashLength: 12.5,
    borderDashGap: 4.5
  })

  assert.equal(migrated.polylineStyle, 'dashed')
  assert.equal(migrated.polylineDash, true)
  assert.equal(migrated.polylineOpacity, .35)
  assert.equal(migrated.borderVisible, true)
  assert.equal(migrated.stroke, '#123456')
  assert.equal(migrated.borderWidth, 3.5)
  assert.equal(migrated.borderDashLength, 12.5)
  assert.equal(migrated.borderDashGap, 4.5)

  const bounded = normalizeNode({
    type: 'polyline',
    polylineStyle: 'invalid',
    polylineDash: false,
    polylineOpacity: -2,
    borderVisible: 'true',
    stroke: '',
    borderWidth: 100,
    borderDashLength: 0,
    borderDashGap: -5
  })
  assert.equal(bounded.polylineStyle, 'solid')
  assert.equal(bounded.polylineOpacity, 0)
  assert.equal(bounded.borderVisible, false)
  assert.equal(bounded.stroke, '#485563')
  assert.equal(bounded.borderWidth, 20)
  assert.equal(bounded.borderDashLength, .1)
  assert.equal(bounded.borderDashGap, .1)

  assert.equal(polylineLineStyle(migrated), 'dashed')
  assert.equal(polylineLineOpacity(migrated), .35)
  assert.equal(polylineLineWidth({ polylineWidth: 200 }), 100)
  assert.equal(polylineOutlineWidth(migrated), 3.5)
  assert.deepEqual(polylineDashSegments(migrated), [12.5, 4.5])
  assert.equal(polylineDashArray(migrated), '12.5 4.5')
  assert.equal(polylineStrokeLineCap({ polylineStyle: 'dotted', polylineLineCap: 'square' }), 'round')
})

test('builds a padded frame and reconstructs every world point from normalized coordinates', () => {
  const worldPoints = [{ x: 100, y: 100 }, { x: 200, y: 140 }, { x: 150, y: 220 }]
  const frame = polylineFrameFromWorldPoints(worldPoints, {
    stageWidth: 1000,
    stageHeight: 800,
    lineWidth: 2,
    startMarker: 'arrow',
    endMarker: 'none'
  })

  assert.deepEqual({ x: frame.x, y: frame.y, w: frame.w, h: frame.h }, { x: 86, y: 86, w: 128, h: 148 })
  frame.points.forEach((point, index) => {
    assertClose(frame.x + point.x * frame.w, worldPoints[index].x)
    assertClose(frame.y + point.y * frame.h, worldPoints[index].y)
  })

  const edgeFrame = polylineFrameFromWorldPoints(
    [{ x: -20, y: -30 }, { x: 1020, y: 830 }],
    { stageWidth: 1000, stageHeight: 800, lineWidth: 4, endMarker: 'arrow' }
  )
  assert.deepEqual({ x: edgeFrame.x, y: edgeFrame.y, w: edgeFrame.w, h: edgeFrame.h }, { x: 0, y: 0, w: 1000, h: 800 })
  assert.deepEqual(edgeFrame.points, [{ x: 0, y: 0 }, { x: 1, y: 1 }])
  assert.deepEqual(normalizeWorldPolylinePoints([{ x: -1, y: 3 }, { x: 12, y: 30 }], 10, 20), [
    { x: 0, y: 3 },
    { x: 10, y: 20 }
  ])
  assert.equal(polylineFrameFromWorldPoints([{ x: 1, y: 1 }], { stageWidth: 10, stageHeight: 10 }), null)
})

test('creates N equal straight segments while preserving exact endpoints', () => {
  assert.equal(DEFAULT_POLYLINE_SEGMENT_COUNT, 4)
  assert.equal(MAX_POLYLINE_SEGMENT_COUNT, 9999)
  assert.equal(clampPolylineSegmentCount(0), 1)
  assert.equal(clampPolylineSegmentCount(7.9), 7)
  assert.equal(clampPolylineSegmentCount(Number.NaN), DEFAULT_POLYLINE_SEGMENT_COUNT)
  assert.equal(clampPolylineSegmentCount(20000), MAX_POLYLINE_SEGMENT_COUNT)

  const start = { x: 200, y: 180 }
  const end = { x: 600, y: 380 }
  const points = createEvenlySpacedPolylinePoints(start, end, 4)
  assert.deepEqual(points, [
    { x: 200, y: 180 },
    { x: 300, y: 230 },
    { x: 400, y: 280 },
    { x: 500, y: 330 },
    { x: 600, y: 380 }
  ])
  assert.notStrictEqual(points[0], start)
  assert.notStrictEqual(points.at(-1), end)
})

test('resamples an edited polyline by arc length without flattening it', () => {
  const source = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
  const points = resamplePolylinePoints(source, 4)
  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: .5, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: .5 },
    { x: 1, y: 1 }
  ])
  assert.deepEqual(resamplePolylinePoints([{ x: 2, y: 3 }, { x: 2, y: 3 }], 3), [
    { x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 3 }
  ])
})

test('resamples normalized points by rendered pixel length on non-square nodes', () => {
  const points = resamplePolylineNodePoints({
    w: 200,
    h: 100,
    polylinePoints: [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: 1 }]
  }, 4)
  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: .25, y: 0 },
    { x: .5, y: 0 },
    { x: .5, y: .5 },
    { x: .5, y: 1 }
  ])
})

test('reframes after resampling removes extrema and keeps max-size round trips stable', () => {
  const node = {
    x: 10,
    y: 20,
    w: 220,
    h: 120,
    rotate: 0,
    polylinePoints: [{ x: .05, y: .9 }, { x: .5, y: .05 }, { x: .95, y: .9 }]
  }
  const endpoints = [node.polylinePoints[0], node.polylinePoints.at(-1)].map(point => (
    polylineLocalPointToWorld(node, { x: point.x * node.w, y: point.y * node.h })
  ))
  const reframed = resamplePolylineNodeGeometry(node, 1)
  assert.equal(reframed.polylinePoints.length, 2)
  assert.ok(reframed.h < node.h)
  const reframedEndpoints = reframed.polylinePoints.map(point => polylineLocalPointToWorld(reframed, {
    x: point.x * reframed.w,
    y: point.y * reframed.h
  }))
  assert.deepEqual(reframedEndpoints, endpoints)

  const maximum = {
    x: 0,
    y: 50,
    w: 20000,
    h: 100,
    rotate: 0,
    polylinePoints: [{ x: 0, y: .5 }, { x: .5, y: .2 }, { x: 1, y: .5 }]
  }
  const maximumLocal = polylineNormalizedPointsToLocal(maximum)
  maximumLocal[1].y = -80
  const maximumFrame = reframePolylineNode(maximum, maximumLocal, { pointIndex: 1 })
  assert.equal(maximumFrame.w, 20000)
  const normalized = normalizeNode({
    ...baseNodeOptions(),
    ...maximumFrame,
    id: 'polyline-maximum-round-trip',
    type: 'polyline'
  })
  assert.equal(normalized.w, maximumFrame.w)
  assert.deepEqual(normalized.polylinePoints, maximumFrame.polylinePoints)
})

test('reframes a dragged point without moving untouched points, including on rotated nodes', () => {
  const node = {
    x: 92,
    y: 92,
    w: 216,
    h: 116,
    rotate: 0,
    polylinePoints: [
      { x: 8 / 216, y: 8 / 116 },
      { x: 108 / 216, y: 48 / 116 },
      { x: 208 / 216, y: 108 / 116 }
    ]
  }
  const local = polylineNormalizedPointsToLocal(node)
  local[1] = worldPointToPolylineLocal(node, { x: 200, y: 260 })
  const reframed = reframePolylineNode(node, local, { padding: 8 })
  assert.deepEqual({ x: reframed.x, y: reframed.y, w: reframed.w, h: reframed.h }, { x: 92, y: 92, w: 216, h: 176 })
  const world = reframed.polylinePoints.map(point => polylineLocalPointToWorld(reframed, {
    x: point.x * reframed.w,
    y: point.y * reframed.h
  }))
  assert.deepEqual(world, [{ x: 100, y: 100 }, { x: 200, y: 260 }, { x: 300, y: 200 }])

  const rotated = { ...node, rotate: 37 }
  const before = polylineNormalizedPointsToLocal(rotated).map(point => polylineLocalPointToWorld(rotated, point))
  const rotatedLocal = polylineNormalizedPointsToLocal(rotated)
  const target = { x: before[1].x + 120, y: before[1].y - 80 }
  rotatedLocal[1] = worldPointToPolylineLocal(rotated, target)
  const rotatedFrame = reframePolylineNode(rotated, rotatedLocal, { padding: 8 })
  const after = rotatedFrame.polylinePoints.map(point => polylineLocalPointToWorld(rotatedFrame, {
    x: point.x * rotatedFrame.w,
    y: point.y * rotatedFrame.h
  }))
  assert.equal(rotatedFrame.rotate, 37)
  assertClose(after[0].x, before[0].x)
  assertClose(after[0].y, before[0].y)
  assertClose(after[1].x, target.x)
  assertClose(after[1].y, target.y)
  assertClose(after[2].x, before[2].x)
  assertClose(after[2].y, before[2].y)
})

test('keeps maximum point editing to bounded SVG paths while every point remains addressable', () => {
  const points = Array.from({ length: 10000 }, (_, index) => ({
    x: index / 9999,
    y: (index % 17) / 16
  }))
  const node = { w: 20000, h: 1000, polylinePoints: points }
  const paths = polylinePointHandlePaths(node)
  assert.equal((paths.all.match(/M/g) || []).length, 10000)
  assert.equal((paths.endpoints.match(/M/g) || []).length, 2)
  assert.ok(paths.all.length < 400000)
  assert.equal(nearestPolylinePointIndex(node, { x: points[8765].x * node.w, y: points[8765].y * node.h }, 1), 8765)
  assert.equal(nearestPolylinePointIndex(node, { x: -100, y: -100 }, 12), -1)
})

test('finishes the straight draft on the second point and expands it into equal segments', () => {
  const draftPoints = sourceBetween(appSource, 'const polylineDraftRenderPoints', 'const polylineDraftPointString')
  const addPoint = sourceBetween(appSource, 'function addPolylinePoint', 'function finishPolylineDrawing')
  const finish = sourceBetween(appSource, 'function finishPolylineDrawing', 'function cancelPolylineDrawing')
  const canvasPointerDown = sourceBetween(appSource, 'function canvasPointerDown', 'function nodePointerDown')

  assert.match(addPoint, /polylineDraft\.value\s*=\s*\{[\s\S]*?points:\s*\[point\]/)
  assert.match(addPoint, /createEvenlySpacedPolylinePoints\(draft\.points\[0\], point, DEFAULT_POLYLINE_SEGMENT_COUNT\)/)
  assert.match(addPoint, /return finishPolylineDrawing\(e\)/)
  assert.doesNotMatch(addPoint, /draft\.points\.push\(point\)/)
  assert.match(draftPoints, /return \[draft\.points\[0\], hover\]/)
  assert.match(appSource, /<polyline :points="polylineDraftPointString"[^>]*:stroke-linejoin="polylineDraft\.lineJoin"/)
  assert.ok(canvasPointerDown.indexOf('addPolylinePoint(e)') < canvasPointerDown.indexOf("e.target.closest?.('.node-shell, .drawing-hit')"))
  assert.match(finish, /draft\.points\.length < 2/)
  assert.match(finish, /recordEntityInsertion\(\{ nodes: \[node\], edges: \[\], drawings: \[\] \}\)[\s\S]*?selectSingleNode\(insertedNode\)[\s\S]*?activeTool\.value = 'select'/)
})

test('shows draggable point handles only for one selected unlocked polyline and records one field history entry', () => {
  const start = sourceBetween(appSource, 'function startPolylinePointDrag', 'function setPolylineSegmentCount')
  const pointerHistory = sourceBetween(appSource, 'function pointerGeometryHistory', 'function editorLodGeometryPayload')
  const pointerMove = sourceBetween(appSource, 'function applyPointerMove', 'function pointerUp')
  const transformBox = sourceBetween(appSource, '<div v-if="activeTool === \'select\' && selected && selectedNodeCount === 1 && !selected.locked"', '<div v-for="n in editorRenderedNodes"')

  assert.match(transformBox, /v-if="selected\.type === 'polyline'"[^>]*class="polyline-point-editor"/)
  assert.doesNotMatch(transformBox, /v-for="\(point, index\) in selected\.polylinePoints"/)
  assert.match(transformBox, /data-testid="polyline-point-handle-layer"/)
  assert.match(transformBox, /:data-point-count="selected\.polylinePoints\.length"/)
  assert.match(transformBox, /@pointerdown="startPolylinePointLayerDrag\(\$event, selected\)"/)
  assert.match(start, /e\.preventDefault\(\)[\s\S]*?e\.stopPropagation\(\)/)
  assert.match(start, /node\.type !== 'polyline' \|\| node\.locked/)
  assert.match(start, /captureFieldRecord\(node, \['x', 'y', 'w', 'h', 'polylinePoints'\]\)/)
  assert.match(start, /beginPointerOperation\(e, \{[\s\S]*?type: 'polylinePoint'/)
  assert.match(pointerMove, /polylinePointFromEvent\(e, false\)/)
  assert.match(pointerMove, /op\.type === 'polylinePoint'[\s\S]*?worldPointToPolylineLocal[\s\S]*?reframePolylineNode[\s\S]*?commitPointerOperation\(op\)[\s\S]*?updateNodeSpatialIndex\(node, false\)/)
  assert.match(pointerHistory, /op\.type === 'polylinePoint'[\s\S]*?kind: 'fields'[\s\S]*?op\.historyRecord/)
  assert.match(enhancementCss, /\.polyline-point-editor\s*\{[^}]*pointer-events:\s*none;/s)
  assert.match(enhancementCss, /\.polyline-point-handle-layer\s*\{[^}]*cursor:\s*grab;/s)
})

test('changes segment count through arc-length resampling and keeps resize and rotate controls', () => {
  const setter = sourceBetween(appSource, 'function setPolylineSegmentCount', 'function addPolylinePoint')
  const controls = sourceBetween(appSource, '<template v-if="selected.type === \'polyline\'">', '<template v-if="![\'lineShape\',\'pencil\',\'polyline\',\'flowPipe\'')
  const transformBox = sourceBetween(appSource, '<div v-if="activeTool === \'select\' && selected && selectedNodeCount === 1 && !selected.locked"', '<div v-for="n in editorRenderedNodes"')

  assert.doesNotMatch(setter, /recordNodeFields\(/)
  assert.match(setter, /const geometry = resamplePolylineNodeGeometry\(node, nextCount\)/)
  assert.match(setter, /Object\.assign\(node, geometry\)[\s\S]*?updateNodeSpatialIndex\(node\)[\s\S]*?markPreviewCanvasDocumentDirty\(\)/)
  assert.match(controls, /分段数<input type="number" min="1" max="9999" step="1"[^>]*data-testid="polyline-segment-count"/)
  assert.match(controls, /:value="polylineSegmentCount\(selected\)"/)
  assert.match(controls, /@change="setPolylineSegmentCount\(selected, \$event\.target\.value\)"/)
  assert.match(appSource, /class="properties"[^>]*@focusin\.capture="beginSelectedFieldEdit"[^>]*@focusout\.capture="finishActiveFieldEdit"/)
  assert.match(transformBox, /class="resize-handle"/)
  assert.match(transformBox, /class="rotate-handle"/)
})

test('starts a polyline only by dropping it on the canvas and requires another drop for the next one', () => {
  const add = sourceBetween(appSource, 'function addCatalogItem', 'function handleCatalogItemDoubleClick')
  const doubleClick = sourceBetween(appSource, 'function handleCatalogItemDoubleClick', 'function catalogItemTitle')
  const title = sourceBetween(appSource, 'function catalogItemTitle', 'const signalColorDefaults')
  const drop = sourceBetween(appSource, 'function dropItem', 'function setTool')
  const addPoint = sourceBetween(appSource, 'function addPolylinePoint', 'function finishPolylineDrawing')
  const catalogButton = appSource.match(/<div v-show="groupIsOpen\(g\.name\)" class="shape-grid">[\s\S]*?<\/div>/)?.[0] || ''

  assert.doesNotMatch(appSource, /function activateCatalogItem\(/)
  assert.match(add, /item\.type !== 'polyline'\) addNode\(item\.type\)/)
  assert.match(doubleClick, /item\.type !== 'polyline'\) addCatalogItem\(item\)/)
  assert.doesNotMatch(doubleClick, /addNode\(|setTool\(/)
  assert.match(title, /item\.type === 'polyline' \? '拖到画布确定线段起始点'/)
  assert.match(appSource, /:class="\{ active: item\.type === 'polyline' && activeTool === 'polyline', 'drawing-tool': item\.type === 'polyline' \}"/)
  assert.match(catalogButton, /<button[^>]*draggable="true"/)
  assert.match(catalogButton, /:data-testid="item\.type === 'polyline' \? 'polyline-library-item' : undefined"/)
  assert.match(appSource, /:aria-pressed="item\.type === 'polyline' \? activeTool === 'polyline' : undefined"/)
  assert.doesNotMatch(catalogButton, /@click=/)
  assert.match(catalogButton, /@dblclick="handleCatalogItemDoubleClick\(item\)"/)
  assert.match(drop, /const type = e\.dataTransfer\.getData\('shape'\)/)
  assert.match(drop, /if \(type === 'polyline'\) \{[\s\S]*?cancelPolylineDrawing\(\)[\s\S]*?setTool\('polyline'\)[\s\S]*?addPolylinePoint\(e\)[\s\S]*?return/)
  assert.ok(drop.indexOf("setTool('polyline')") < drop.indexOf('addPolylinePoint(e)'))
  assert.ok(drop.indexOf('addPolylinePoint(e)') < drop.indexOf('if (type) addNode(type'))
  assert.match(addPoint, /\(e\.button \?\? 0\) !== 0 \|\| activeTool\.value !== 'polyline'[\s\S]*?return false/)
  assert.doesNotMatch(addPoint, /if \(e\.button !== 0/)
  assert.equal((appSource.match(/setTool\('polyline'\)/g) || []).length, 1)
})

test('routes clicks over nodes, drawings, and locked badges into the active polyline draft', () => {
  const nodePointerDown = sourceBetween(appSource, 'function nodePointerDown', 'async function startTextEdit')
  const drawingPointerDown = sourceBetween(appSource, 'function drawingPointerDown', 'function drawingPointsToBounds')
  const lockedBadge = sourceBetween(appSource, 'function handleLockedBadgePointerDown', 'const TABLE_DOUBLE_POINTER_DELAY')

  assert.ok(nodePointerDown.indexOf('addPolylinePoint(e)') < nodePointerDown.indexOf('consumeTableDoublePointerDown'))
  assert.ok(drawingPointerDown.indexOf('addPolylinePoint(e)') < drawingPointerDown.indexOf('moveDrawing'))
  assert.match(lockedBadge, /activeTool\.value === 'polyline'\) addPolylinePoint\(e\)/)
  assert.match(appSource, /function canStartNodeTextEdit\(node\)[\s\S]*?\['lineShape', 'pencil', 'polyline'\]\.includes\(node\.type\)/)
})

test('renders every start and end arrow combination independently', async () => {
  const combinations = [
    ['none', 'none', false, false],
    ['arrow', 'none', true, false],
    ['none', 'arrow', false, true],
    ['arrow', 'arrow', true, true]
  ]

  for (const [start, end, hasStart, hasEnd] of combinations) {
    const html = await renderPolyline(start, end)
    assert.match(html, /data-testid="polyline-node-path"/)
    assert.match(html, /d="M 20 20 L 100 60 L 180 25"/)
    assert.equal(/id="[^"]*start-arrow"/.test(html), hasStart)
    assert.equal(/id="[^"]*end-arrow"/.test(html), hasEnd)
    assert.equal(/marker-start="url\(#[^"]*start-arrow\)"/.test(html), hasStart)
    assert.equal(/marker-end="url\(#[^"]*end-arrow\)"/.test(html), hasEnd)
    if (hasStart || hasEnd) assert.match(html, /markerUnits="userSpaceOnUse"/)
  }

  const controls = sourceBetween(appSource, '<template v-if="selected.type === \'polyline\'">', '<template v-if="![\'lineShape\',\'pencil\',\'polyline\',\'flowPipe\'')
  assert.match(controls, /起点样式<select v-model="selected\.polylineStartMarker"><option value="none">无<\/option><option value="arrow">箭头<\/option><\/select>/)
  assert.match(controls, /终点样式<select v-model="selected\.polylineEndMarker"><option value="none">无<\/option><option value="arrow">箭头<\/option><\/select>/)
})

test('keeps arrow size independent from line width in every renderer', async () => {
  assert.equal(polylineArrowSize({ polylineWidth: .1, polylineArrowSize: 14 }), 14)
  assert.equal(polylineArrowSize({ polylineWidth: 100, polylineArrowSize: 14 }), 14)
  assert.equal(polylineArrowSize({ polylineArrowSize: 0 }), 1)
  assert.equal(polylineArrowSize({ polylineArrowSize: 500 }), 100)
  assert.equal(polylineArrowSize({ polylineWidth: 20 }), 60)

  const migratedLegacy = normalizeNode({ type: 'polyline', w: 160, h: 80, polylineWidth: 6, polylineEndMarker: 'arrow' })
  assert.equal(migratedLegacy.polylineArrowSize, 24)
  migratedLegacy.polylineWidth = 40
  assert.equal(polylineArrowSize(migratedLegacy), 24)

  const html = await renderToString(h(nodeVisual, {
    node: polylineNode({ polylineWidth: 40, polylineArrowSize: 14, polylineStartMarker: 'arrow', polylineEndMarker: 'arrow' })
  }))
  assert.equal((html.match(/markerWidth="14"/g) || []).length, 2)
  assert.equal((html.match(/markerHeight="14"/g) || []).length, 2)
  assert.doesNotMatch(html, /markerWidth="60"|markerHeight="60"/)

  const controls = sourceBetween(appSource, '<template v-if="selected.type === \'polyline\'">', '<template v-if="![\'lineShape\',\'pencil\',\'polyline\',\'flowPipe\'')
  assert.match(controls, /箭头大小<input type="number" min="1" max="100" step="1" v-model\.number="selected\.polylineArrowSize" data-testid="polyline-arrow-size">/)
})

test('keeps newly inserted polyline nodes reactive in the spatial index', () => {
  const spatialUpdate = sourceBetween(appSource, 'function updateNodeSpatialIndex', 'watch(nodes, source =>')
  assert.match(spatialUpdate, /const indexedNode = nodeIndex\.value\.get\(node\?\.id\) \|\| appendedNodes\.get\(node\?\.id\) \|\| node/)
  assert.match(spatialUpdate, /nodeIndex\.value\.set\(indexedNode\.id, indexedNode\)/)
  assert.match(spatialUpdate, /triggerRef\(nodeIndex\)/)
  assert.match(spatialUpdate, /nodeSpatialIndex\.update\(indexedNode\)/)
})

test('orders shared straight-line controls before polyline-only controls', () => {
  const polylineControls = sourceBetween(
    appSource,
    '<template v-if="selected.type === \'polyline\'">',
    '<template v-if="![\'lineShape\',\'pencil\',\'polyline\',\'flowPipe\''
  )
  const lineControls = sourceBetween(
    appSource,
    '<template v-if="selected.type === \'lineShape\'">',
    '<template v-else-if="![\'table\',\'pencil\',\'polyline\'].includes(selected.type)">'
  )
  const labels = source => [...source.matchAll(/<label[^>]*>([^<]+)/g)].map(match => match[1])
  const sharedLabels = [
    '线条颜色',
    '线条完全透明',
    '线条不透明度',
    '线条样式',
    '线段长度',
    '线段间隔',
    '显示轮廓',
    '轮廓颜色',
    '轮廓宽度'
  ]

  assert.deepEqual(labels(lineControls), sharedLabels)
  assert.deepEqual(labels(polylineControls).slice(0, sharedLabels.length), sharedLabels)
  assert.deepEqual(labels(polylineControls).slice(sharedLabels.length), [
    '分段数',
    '线条宽度',
    '箭头大小',
    '起点样式',
    '终点样式',
    '端点',
    '连接'
  ])
  assert.match(polylineControls, /data-testid="polyline-style"><option value="solid">实线<\/option><option value="dashed">虚线<\/option><option value="dotted">点线<\/option>/)
  assert.match(polylineControls, /selected\.polylineStyle !== 'solid'[\s\S]*?selected\.borderDashLength[\s\S]*?selected\.borderDashGap/)
  assert.ok(polylineControls.indexOf('<h3>线条样式</h3>') < polylineControls.indexOf('<h3>线段属性</h3>'))
})

test('renders dotted custom spacing with a round cap, outline layer, and line opacity', async () => {
  const styled = await renderToString(h(nodeVisual, {
    node: polylineNode({
      polylineColor: '#336699',
      polylineWidth: 4,
      polylineStyle: 'dotted',
      polylineOpacity: .25,
      polylineLineCap: 'square',
      borderVisible: true,
      stroke: '#ff0000',
      borderWidth: 3,
      borderDashLength: 2.5,
      borderDashGap: 7.5
    })
  }))

  assert.match(styled, /data-testid="polyline-node-outline"[^>]*stroke="#ff0000"[^>]*stroke-width="10"[^>]*stroke-dasharray="2\.5 7\.5"[^>]*stroke-linecap="round"/)
  assert.match(styled, /data-testid="polyline-node-path"[^>]*stroke="rgba\(51, 102, 153, 0\.25\)"[^>]*stroke-width="4"[^>]*stroke-dasharray="2\.5 7\.5"[^>]*stroke-linecap="round"/)

  const transparent = await renderToString(h(nodeVisual, {
    node: polylineNode({
      polylineColor: '#336699',
      polylineStyle: 'dotted',
      polylineOpacity: 0,
      borderVisible: false
    })
  }))
  assert.match(transparent, /data-testid="polyline-node-path"[^>]*stroke="transparent"/)
  assert.doesNotMatch(transparent, /data-testid="polyline-node-outline"/)
})

test('uses the same polyline geometry in the node renderer, preview, and minimap', () => {
  assert.match(nodeVisualSource, /function polylinePath\(node\)[\s\S]*?coordinates\.slice\(1\)\.map\(point => `L \$\{point\.x\} \$\{point\.y\}`\)/)
  assert.match(nodeVisualSource, /v-else-if="node\.type === 'polyline'"[\s\S]*?data-testid="polyline-node-path"/)

  assert.match(appSource, /<ProgressivePreviewNodes :nodes="previewDomNodes"/)
  assert.match(previewNodeBatchSource, /v-for="node in nodes"[\s\S]*?v-memo=/)
  assert.match(previewNodeBatchSource, /<NodeVisual[\s\S]*?:node="node"[\s\S]*?preview/)

  assert.match(miniMapSource, /function drawPolyline\(ctx, node, width, height, worldPixel\)[\s\S]*?points\.slice\(1\)\.forEach\(point => ctx\.lineTo\(point\.x, point\.y\)\)/)
  assert.match(miniMapSource, /node\.type === 'polyline'\) drawPolyline\(ctx, node, layoutWidth, layoutHeight, visualWorldPixel\)/)
  assert.match(miniMapSource, /node\.polylineStartMarker === 'arrow'[\s\S]*?node\.polylineEndMarker === 'arrow'/)
})

test('uses the shared polyline style helpers in both SVG and minimap renderers', () => {
  for (const helper of [
    'polylineArrowSize',
    'polylineLineOpacity',
    'polylineLineWidth',
    'polylineOutlineWidth',
    'polylineStrokeLineCap'
  ]) {
    assert.match(nodeVisualSource, new RegExp(`\\b${helper}\\(node\\)`))
    assert.match(miniMapSource, new RegExp(`\\b${helper}\\(node\\)`))
  }
  assert.match(nodeVisualSource, /polylineDashArray\(node\)/)
  assert.match(miniMapSource, /polylineDashSegments\(node\)/)

  const miniMapPolyline = sourceBetween(miniMapSource, 'function drawPolyline(ctx', 'function drawGrid')
  assert.match(miniMapPolyline, /const sourceLineWidth = polylineLineWidth\(node\)/)
  assert.match(miniMapPolyline, /const outlineWidth = polylineOutlineWidth\(node\) \* styleScale/)
  assert.match(miniMapPolyline, /const dashSegments = polylineDashSegments\(node\)\.map/)
  assert.match(miniMapPolyline, /ctx\.lineCap = polylineStrokeLineCap\(node\)/)
  assert.match(miniMapPolyline, /strokePath\(color, lineWidth, polylineLineOpacity\(node\)\)/)
})

test('preserves point count through JSON import and tracks polyline data in memoization', () => {
  const savedNode = polylineNode({
    polylinePoints: [{ x: 0, y: .1 }, { x: .3, y: .7 }, { x: .65, y: .2 }, { x: 1, y: .9 }],
    polylineColor: '#2468ac',
    polylineWidth: 5.5,
    polylineArrowSize: 17,
    polylineStyle: 'dotted',
    polylineOpacity: .4,
    polylineStartMarker: 'arrow',
    polylineEndMarker: 'arrow',
    polylineLineCap: 'square',
    polylineLineJoin: 'bevel',
    borderVisible: true,
    stroke: '#102030',
    borderWidth: 2.5,
    borderDashLength: 3.25,
    borderDashGap: 8.75
  })
  const imported = normalizeNode(JSON.parse(JSON.stringify({ nodes: [savedNode] })).nodes[0])
  assert.equal(imported.polylinePoints.length, 4)
  assert.deepEqual(imported.polylinePoints, savedNode.polylinePoints)
  assert.equal(imported.polylineStartMarker, 'arrow')
  assert.equal(imported.polylineEndMarker, 'arrow')
  for (const field of [
    'polylineColor',
    'polylineWidth',
    'polylineArrowSize',
    'polylineStyle',
    'polylineOpacity',
    'polylineLineCap',
    'polylineLineJoin',
    'borderVisible',
    'stroke',
    'borderWidth',
    'borderDashLength',
    'borderDashGap'
  ]) assert.equal(imported[field], savedNode[field], field)

  const projectData = sourceBetween(appSource, 'function projectData', 'function serializeProjectData')
  const prepareProject = projectPreparationSource.slice(projectPreparationSource.indexOf('export function prepareProject'))
  const memo = sourceBetween(appSource, 'function polylineMemoKey', 'function handleFormChange')
  const savedProject = { version: 3, nodes: [savedNode], edges: [], drawings: [], customComponents: [] }
  assert.match(projectData, /nodes:\s*nodes\.value/)
  assert.match(projectPreparationSource, /import\s*\{[^}]*\bvalidateProjectForFrontend\b[^}]*\}\s*from '\.\/projectValidation\.js'/)
  assert.match(prepareProject, /validateProjectForFrontend\(data\)/)
  assert.equal(countProjectCapacity(savedProject).polylinePointCount, savedNode.polylinePoints.length)
  assert.throws(
    () => validateProjectForFrontend(savedProject, { ...PROJECT_CAPACITY_LIMITS, pathPoints: savedNode.polylinePoints.length - 1 }),
    error => error instanceof ProjectValidationError && error.code === 'PROJECT_TOO_LARGE'
  )
  assert.match(prepareProject, /data\.nodes\.map\(node => normalizeNode\(/)
  assert.match(memo, /node\.polylinePoints[\s\S]*?node\.polylineArrowSize[\s\S]*?node\.polylineStyle[\s\S]*?node\.polylineOpacity[\s\S]*?node\.polylineStartMarker[\s\S]*?node\.polylineEndMarker/)
  assert.match(memo, /const nodeRenderMemoCache = new WeakMap\(\)[\s\S]*?const content = computed\([^\n]*polylineMemoKey\(node\)/)
  assert.match(memo, /content: content\.value/)
  assert.equal((appSource.match(/nodeRenderMemo\(n\)/g) || []).length, 1)
  assert.match(previewNodeBatchSource, /v-for="node in nodes"[\s\S]*?<NodeVisual[\s\S]*?:node="node"/)
  assert.match(miniMapSource, /node\.type === 'polyline'\) drawPolyline\(ctx, node, layoutWidth, layoutHeight, visualWorldPixel\)/)
})
