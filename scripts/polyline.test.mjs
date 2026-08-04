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
  normalizeWorldPolylinePoints,
  polylineArrowSize,
  polylineDashArray,
  polylineDashSegments,
  polylineFrameFromWorldPoints,
  polylineLineOpacity,
  polylineLineStyle,
  polylineLineWidth,
  polylineOutlineWidth,
  polylineStrokeLineCap
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

test('adds one vertex per click and previews straight segments between adjacent vertices', () => {
  const draftPoints = sourceBetween(appSource, 'const polylineDraftRenderPoints', 'const polylineDraftPointString')
  const addPoint = sourceBetween(appSource, 'function addPolylinePoint', 'function finishPolylineDrawing')
  const canvasPointerDown = sourceBetween(appSource, 'function canvasPointerDown', 'function nodePointerDown')

  assert.match(addPoint, /polylineDraft\.value\s*=\s*\{[\s\S]*?points:\s*\[point\]/)
  assert.match(addPoint, /const last = draft\.points\.at\(-1\)/)
  assert.match(addPoint, /draft\.points\.push\(point\)/)
  assert.match(addPoint, /Math\.hypot\(point\.x - last\.x, point\.y - last\.y\)/)
  assert.match(draftPoints, /const points = \[\.\.\.draft\.points\]/)
  assert.match(draftPoints, /points\.push\(hover\)/)
  assert.match(appSource, /<polyline :points="polylineDraftPointString"[^>]*:stroke-linejoin="polylineDraft\.lineJoin"/)
  assert.ok(canvasPointerDown.indexOf('addPolylinePoint(e)') < canvasPointerDown.indexOf("e.target.closest?.('.node-shell, .drawing-hit')"))
})

test('drags only the draft start vertex and cleans up every pointer lifecycle path', () => {
  const pointFromEvent = sourceBetween(appSource, 'function polylinePointFromEvent', 'const polylineDraftRenderPoints')
  const move = sourceBetween(appSource, 'function movePolylineStartPoint', 'function endPolylineStartPointDrag')
  const end = sourceBetween(appSource, 'function endPolylineStartPointDrag', 'function startPolylineStartPointDrag')
  const start = sourceBetween(appSource, 'function startPolylineStartPointDrag', 'function addPolylinePoint')
  const finish = sourceBetween(appSource, 'function finishPolylineDrawing', 'function cancelPolylineDrawing')
  const cancel = sourceBetween(appSource, 'function cancelPolylineDrawing', 'function removeLastPolylinePoint')
  const removeLast = sourceBetween(appSource, 'function removeLastPolylinePoint', 'function handleCanvasPointerMove')
  const canvasMove = sourceBetween(appSource, 'function handleCanvasPointerMove', 'function handleCanvasPointerLeave')
  const resetDocumentSession = sourceBetween(appSource, 'function resetDocumentSession', 'function applyProject')
  const applyProject = sourceBetween(appSource, 'function applyProject', 'function buildProjectPayload')
  const unmount = sourceBetween(appSource, 'onUnmounted(() => {', '</script>')

  assert.match(appSource, /<circle v-for="\(point, index\) in polylineDraft\.points"[^>]*:class="\{ 'polyline-start-point': index === 0 \}"[^>]*:data-testid="index === 0 \? 'polyline-start-point' : undefined"/)
  assert.match(appSource, /:r="\(index === 0 \? 7 : 4\) \/ zoom"/)
  assert.match(appSource, /@pointerdown="index === 0 && startPolylineStartPointDrag\(\$event\)"/)

  assert.match(enhancementCss, /\.polyline-draft-layer\s*\{[^}]*pointer-events:\s*none;/s)
  assert.match(enhancementCss, /\.polyline-draft-layer polyline\s*\{[^}]*pointer-events:\s*none;/s)
  assert.match(enhancementCss, /\.polyline-draft-layer circle\s*\{[^}]*pointer-events:\s*none;/s)
  assert.match(enhancementCss, /\.polyline-draft-layer circle\.polyline-start-point\s*\{[^}]*pointer-events:\s*all;[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/s)
  assert.match(enhancementCss, /\.polyline-draft-layer circle\.polyline-start-point:active\s*\{[^}]*cursor:\s*grabbing;/s)

  assert.match(start, /e\.preventDefault\(\)[\s\S]*?e\.stopPropagation\(\)/)
  assert.match(start, /polylineDraft\.value\.hover = polylineDraft\.value\.points\.at\(-1\)/)
  assert.match(start, /polylineStartPointDrag = \{ pointerId: e\.pointerId, target: e\.currentTarget \}/)
  assert.match(start, /e\.currentTarget\?\.setPointerCapture\?\.\(e\.pointerId\)/)
  for (const eventName of ['pointermove', 'pointerup', 'pointercancel', 'blur']) {
    assert.match(start, new RegExp(`window\\.addEventListener\\('${eventName}',`))
    assert.match(end, new RegExp(`window\\.removeEventListener\\('${eventName}',`))
  }
  assert.match(end, /target\?\.hasPointerCapture\?\.\(pointerId\)[\s\S]*?target\.releasePointerCapture\(pointerId\)/)

  assert.match(move, /const point = polylinePointFromEvent\(e\)[\s\S]*?polylineDraft\.value\.points\[0\] = point/)
  assert.doesNotMatch(move, /\.push\(|\.splice\(|points\[[1-9]/)
  assert.match(canvasMove, /activeTool\.value === 'polyline' && polylineDraft\.value && !polylineStartPointDrag && !operation\.value/)
  assert.match(pointFromEvent, /!snap\.value \|\| e\?\.altKey/)
  assert.match(pointFromEvent, /Math\.round\(point\.x \/ gridSize\.value\) \* gridSize\.value/)
  assert.match(pointFromEvent, /Math\.round\(point\.y \/ gridSize\.value\) \* gridSize\.value/)

  assert.match(finish, /endPolylineStartPointDrag\(\)[\s\S]*?const node = normalizeNode/)
  assert.match(cancel, /^function cancelPolylineDrawing\(showNotice = false\) \{\s*endPolylineStartPointDrag\(\)/)
  assert.match(removeLast, /if \(!draft\.points\.length\) \{\s*endPolylineStartPointDrag\(\)/)
  assert.match(resetDocumentSession, /pointerUp\(\)[\s\S]*?endPolylineStartPointDrag\(\)[\s\S]*?polylineDraft\.value = null/)
  assert.match(applyProject, /resetDocumentSession\(\)/)
  assert.match(unmount, /cancelPendingCanvasZoom\(\{ commit: false \}\)[\s\S]*?endPolylineStartPointDrag\(\)[\s\S]*?pointerUp\(\)/)
})

test('finishes or cancels one polyline session and always returns to selection mode', () => {
  const finish = sourceBetween(appSource, 'function finishPolylineDrawing', 'function cancelPolylineDrawing')
  const cancel = sourceBetween(appSource, 'function cancelPolylineDrawing', 'function removeLastPolylinePoint')
  const removeLast = sourceBetween(appSource, 'function removeLastPolylinePoint', 'function handleCanvasPointerMove')
  const keyboard = sourceBetween(appSource, 'function keydown', 'function keyup')

  assert.match(appSource, /@dblclick="handleCanvasDoubleClick"/)
  assert.match(appSource, /function handleCanvasDoubleClick\(e\)[\s\S]*?finishPolylineDrawing\(e\)/)
  assert.match(keyboard, /activeTool\.value === 'polyline' && polylineDraft\.value/)
  assert.match(keyboard, /e\.key === 'Enter'[\s\S]*?finishPolylineDrawing\(e\)/)
  assert.match(keyboard, /e\.key === 'Escape'[\s\S]*?cancelPolylineDrawing\(true\)/)
  assert.match(finish, /draft\.points\.length < 2/)
  assert.match(finish, /recordEntityInsertion\(\{ nodes: \[node\], edges: \[\], drawings: \[\] \}\)[\s\S]*?const \[insertedNode\] = appendNodes\(node\)[\s\S]*?polylineDraft\.value = null[\s\S]*?selectSingleNode\(insertedNode\)[\s\S]*?activeTool\.value = 'select'/)
  assert.match(cancel, /polylineDraft\.value = null[\s\S]*?activeTool\.value === 'polyline'\) activeTool\.value = 'select'/)
  assert.match(removeLast, /draft\.points\.pop\(\)[\s\S]*?if \(!draft\.points\.length\) \{[\s\S]*?polylineDraft\.value = null[\s\S]*?activeTool\.value = 'select'/)
  assert.match(appSource, /function setTool\(id\)[\s\S]*?if \(id !== 'polyline'\) cancelPolylineDrawing\(\)[\s\S]*?activeTool\.value = id/)
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
  assert.match(drop, /if \(type === 'polyline'\) \{[\s\S]*?polylineDraft\.value\?\.points\?\.length >= 2\) finishPolylineDrawing\(\)[\s\S]*?else cancelPolylineDrawing\(\)[\s\S]*?setTool\('polyline'\)[\s\S]*?addPolylinePoint\(e\)[\s\S]*?return/)
  assert.ok(drop.indexOf("setTool('polyline')") < drop.indexOf('addPolylinePoint(e)'))
  assert.ok(drop.indexOf('addPolylinePoint(e)') < drop.indexOf('if (type) addNode(type'))
  assert.match(addPoint, /\(e\.button \?\? 0\) !== 0 \|\| activeTool\.value !== 'polyline'[\s\S]*?return false/)
  assert.doesNotMatch(addPoint, /if \(e\.button !== 0/)
  assert.equal((appSource.match(/setTool\('polyline'\)/g) || []).length, 1)
  assert.match(appSource, /@dblclick="handleCanvasDoubleClick"/)
  assert.match(appSource, /function handleCanvasDoubleClick\(e\)[\s\S]*?finishPolylineDrawing\(e\)/)
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

  const controls = sourceBetween(appSource, '<template v-if="selected.type === \'polyline\'">', '<template v-if="![\'lineShape\',\'pencil\',\'polyline\'].includes(selected.type)')
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

  const controls = sourceBetween(appSource, '<template v-if="selected.type === \'polyline\'">', '<template v-if="![\'lineShape\',\'pencil\',\'polyline\'].includes(selected.type)')
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
    '<template v-if="![\'lineShape\',\'pencil\',\'polyline\'].includes(selected.type)'
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
