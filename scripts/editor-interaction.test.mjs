import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  anchoredCanvasScroll,
  CANVAS_ZOOM_FACTOR,
  clampCanvasZoom,
  expandCanvasBounds,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  steppedCanvasZoom
} from '../src/utils/canvasViewport.js'
import { filterPaperEntries } from '../src/utils/librarySearch.js'
import { isImeCompositionEvent } from '../src/utils/keyboard.js'
import { createPreviewViewportScheduler } from '../src/utils/previewViewportScheduler.js'
import {
  fullscreenPreviewScrollAxes,
  resolveFullscreenViewportSize
} from '../src/utils/fullscreenViewportSize.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const editorModelSource = readFileSync(new URL('../src/models/editorModel.js', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const previewNodeBatchSource = readFileSync(new URL('../src/components/PreviewNodeBatch.vue', import.meta.url), 'utf8')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return enhancementCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || ''
}

function clampedScroll(value, maximum) {
  return Math.max(0, Math.min(maximum, value))
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

test('filters paper sessions by drawing title and target file name', () => {
  const entries = [
    { id: 'a', title: '泵站 Alpha', targetName: 'pump-main.json', location: '图纸库' },
    { id: 'b', title: '阀门布置', targetName: 'valve-layout.json', location: '其他位置' },
    { id: 'c', title: '临时草稿', targetName: '', location: '未保存' }
  ]

  assert.deepEqual(filterPaperEntries(entries, '阀门').map(entry => entry.id), ['b'])
  assert.deepEqual(filterPaperEntries(entries, 'ALPHA').map(entry => entry.id), ['a'])
  assert.deepEqual(filterPaperEntries(entries, ' PUMP-MAIN.JSON ').map(entry => entry.id), ['a'])
  assert.deepEqual(filterPaperEntries(entries, '不存在').map(entry => entry.id), [])
  assert.equal(filterPaperEntries(entries, ' \t '), entries)
})

test('connects the shared library search to the active left category', () => {
  assert.match(appSource, /const searchPlaceholder = computed\(\(\) => leftTab\.value === '图纸'[\s\S]*?'搜索图纸'[\s\S]*?'搜索我的组件'[\s\S]*?'搜索组件'/)
  assert.match(appSource, /data-testid="library-search"/)
  assert.match(appSource, /const filteredPaperSessionEntries = computed\(\(\) => filterPaperEntries\(paperSessionEntries\.value, search\.value\)\)/)
  assert.match(appSource, /v-for="entry in filteredPaperSessionEntries"/)
  assert.match(appSource, /data-testid="paper-search-empty"[\s\S]*?没有匹配的图纸/)
  assert.match(appSource, /function setLeftTab\(tab\)\s*\{\s*const entering = leftTab\.value !== tab\s*if \(entering\) search\.value = ''/)
  assert.match(appSource, /else if \(entering \|\| !drawingFilesLoaded\.value\) void refreshDrawingFiles\(\)/)
})

test('labels text components generically in the structure and property heading', () => {
  assert.match(appSource, /function structureNodeDisplayName\(node\)\s*\{\s*return node\?\.type === 'text' \? '文本' : nodeDisplayName\(node\)\s*\}/)
  assert.match(appSource, /row\.item\.kind === 'drawing' \? '铅笔线稿' : structureNodeDisplayName\(row\.item\.entity\)/)
  assert.match(appSource, /selected\.type === 'text' \? '文本' : \(selected\.text \|\| '图形'\)/)
  assert.match(appSource, /const suggestedName = selectedNodeCount\.value > 1 \? `\$\{nodeDisplayName\(selected\.value\)\}组合` : nodeDisplayName\(selected\.value\)/)
  assert.match(appSource, /name:\s*uniqueCustomComponentName\(suggestedName\)/)
})

test('makes a pending table merge the clear primary action', () => {
  assert.match(appSource, /const tableSelectionMergeReady = computed\(\(\) => \{[\s\S]*?selection\.cellCount < 2[\s\S]*?tableSelectionMergeConflict\.value/)
  assert.match(appSource, /class="table-data-merge-actions" :class="\{ 'is-ready': tableSelectionMergeReady \}" aria-live="polite"/)
  assert.match(appSource, /class="table-data-merge-primary" :disabled="!tableSelectionMergeReady"[\s\S]*?合并 \{\{ activeTableSelection\.rowSpan \}\} × \{\{ activeTableSelection\.columnSpan \}\} 选区/)
  assert.match(appSource, /v-else-if="tableSelectionMergeConflict">先拆分冲突区域<\/template>/)
  assert.match(appSource, /function mergeSelectedTableCellsAndClose\(\)\s*\{\s*if \(mergeSelectedTableCells\(\)\) closeTableDataEditor\(\)\s*\}/)
  assert.match(appSource, /v-if="tableDataEditor\.tab === 'data' && tableDataEditor\.mode === 'merge' && tableSelectionMergeReady" class="table-data-finish-merge"[\s\S]*?mergeSelectedTableCellsAndClose[\s\S]*?合并并完成/)

  assert.match(cssRule('.table-data-merge-actions.is-ready'), /background:\s*#e7f7f3/)
  assert.match(cssRule('.table-data-toolbar button.table-data-merge-primary'), /background:\s*#16b89a/)
  assert.match(cssRule('.table-data-toolbar button.table-data-merge-primary'), /color:\s*#fff/)
})

test('keeps table data and style editing responsibilities independent', () => {
  const dataPanel = sourceBetween(
    appSource,
    '<template v-if="tableDataEditor.tab === \'data\'">',
    '<div v-else class="table-style-editor"'
  )
  const stylePanel = sourceBetween(
    appSource,
    '<div v-else class="table-style-editor"',
    '<footer>'
  )

  assert.match(dataPanel, /data-testid="table-data-panel"/)
  assert.match(dataPanel, /activeTableEditorNode\.tableTitle/)
  assert.match(dataPanel, /activeTableEditorNode\.tableHeaders/)
  assert.match(dataPanel, /activeTableEditorNode\.tableCells/)
  assert.match(dataPanel, /activeTableUsesRuntimeData/)
  assert.match(dataPanel, /v-if="!tableEditorShowsRuntimeData" class="table-runtime-data-state"[\s\S]*?静态后备数据（可编辑）/)
  assert.match(dataPanel, /v-else-if="activeTableUsesRuntimeData" class="table-runtime-data-state"[\s\S]*?当前接口数据（内容只读）/)
  assert.match(dataPanel, /addTableRow/)
  assert.match(dataPanel, /addTableColumn/)
  for (const styleField of ['showTableTitle', 'showHeader', 'tableColumnWidthsPx', 'tableRowHeights']) {
    assert.doesNotMatch(dataPanel, new RegExp(`v-model(?:\\.number)?="activeTableDataNode\\.${styleField}`))
  }

  assert.match(stylePanel, /data-testid="table-style-panel"/)
  for (const styleField of [
    'showTableTitle', 'showHeader', 'tableScrollX', 'tableScrollY',
    'tableTitleFill', 'tableTitleColor', 'tableTitleSize', 'tableTitleWeight', 'tableTitleAlign',
    'tableHeaderFill', 'tableHeaderColor', 'tableHeaderSize', 'tableHeaderWeight', 'tableHeaderAlign', 'tableHeaderHeight',
    'tableRowFill', 'tableAltRowFill', 'tableCellColor', 'tableCellSize', 'tableCellWeight', 'tableTextAlign', 'tableContentDisplay',
    'tableBorderColor', 'tableBorderWidth', 'tableBorderStyle', 'tableGridColor', 'tableGridWidth', 'tableGridStyle'
  ]) {
    assert.match(stylePanel, new RegExp(`v-model(?:\\.number)?="activeTableDataNode\\.${styleField}`), `missing ${styleField} from style panel`)
  }
  assert.match(stylePanel, /v-for="\(width, columnIndex\) in activeTableDataNode\.tableColumnWidthsPx"/)
  assert.match(stylePanel, /v-for="\(height, rowIndex\) in activeTableDataNode\.tableRowHeights"/)
})

test('uses the shared appearance section for tables and keeps only table content in the property panel', () => {
  const propertyAppearance = sourceBetween(
    appSource,
    '<h3 data-property-section="appearance">外观与样式</h3>',
    '<template v-if="selectedCategory === \'功能组件\'">'
  )
  const tableContent = sourceBetween(
    appSource,
    '<template v-if="selectedCategory === \'功能组件\'">',
    '<template v-else-if="selected.type === \'checkbox\'">'
  )

  assert.doesNotMatch(propertyAppearance, /表格样式/)
  assert.doesNotMatch(propertyAppearance, /table-style-group/)
  assert.match(propertyAppearance, /selected\.type === 'table'/)
  assert.match(propertyAppearance, /填充颜色/)
  assert.match(propertyAppearance, /边框颜色/)
  assert.match(propertyAppearance, /圆角/)
  assert.match(tableContent, /<h3>表格内容<\/h3>/)
  assert.match(tableContent, /openTableDataEditor\(selected\)/)
})

test('gives every single component the same base and appearance section contract', () => {
  const singleComponentStart = appSource.indexOf('<h3 data-property-section="base">基础属性</h3>')
  const singleComponentEnd = appSource.indexOf('<template v-if="selectedCategory === \'功能组件\'">', singleComponentStart)
  assert.ok(singleComponentStart >= 0, 'expected the shared single-component base section')
  assert.ok(singleComponentEnd > singleComponentStart, 'expected the type-specific property sections')
  const singleComponentEditor = appSource.slice(singleComponentStart, singleComponentEnd)
  const baseHeading = singleComponentEditor.indexOf('<h3 data-property-section="base">基础属性</h3>')
  const visibilityControl = singleComponentEditor.indexOf('data-property-target="visible"')
  const appearanceHeading = singleComponentEditor.indexOf('<h3 data-property-section="appearance">外观与样式</h3>')

  assert.ok(baseHeading >= 0, 'single components must expose the shared base section')
  assert.ok(appearanceHeading > baseHeading, 'the shared appearance section must follow the base section')
  assert.ok(visibilityControl > appearanceHeading, 'component visibility must be part of the appearance section')
  assert.doesNotMatch(singleComponentEditor, /<h3>组件状态<\/h3>/)
  assert.doesNotMatch(singleComponentEditor, /线条尺寸|线段尺寸|流向尺寸/)
  for (const specialtyHeading of ['铅笔属性', '线段属性', '流向属性', '文字编辑', '图像编辑', '视频设置']) {
    const specialtyIndex = singleComponentEditor.indexOf(`<h3>${specialtyHeading}</h3>`)
    if (specialtyIndex >= 0) assert.ok(specialtyIndex > appearanceHeading, `${specialtyHeading} must follow shared appearance`)
  }
})

test('keeps static and runtime table views mergeable while runtime cell data stays read-only', () => {
  assert.match(appSource, /import \{[^}]*hasConfiguredTableContentBinding[^}]*hasResolvedTableContentBinding[^}]*materializeRuntimeNode[^}]*\} from '\.\/utils\/runtimeNodeMaterializer'/)
  assert.match(appSource, /const activeTableDisplayNode = computed\(\(\) => \{[\s\S]*?materializeRuntimeNode\(node, pointId => runtimeData\.getValue\(pointId\)\)/)
  assert.match(appSource, /const activeTableHasRuntimeConfiguration = computed\(\(\) => hasConfiguredTableContentBinding\(activeTableDataNode\.value\)\)/)
  assert.match(appSource, /const activeTableUsesRuntimeData = computed\(\(\) => \{[\s\S]*?hasResolvedTableContentBinding\(node, pointId => runtimeData\.getValue\(pointId\)\)/)
  assert.match(appSource, /const tableEditorShowsRuntimeData = computed\(\(\) => tableDataEditor\.value\.view === 'runtime'\)/)
  assert.match(appSource, /function setTableDataEditorView\(view\)[\s\S]*?view === 'runtime' \? 'runtime' : 'static'[\s\S]*?view: nextView/)
  assert.doesNotMatch(appSource, /function setTableDataEditorView\(view\)[\s\S]*?activeTableUsesRuntimeData\.value[\s\S]*?function setTableDataEditorMode/)
  assert.match(appSource, /function startTableEditorRuntimeSubscriptions\(node\)[\s\S]*?bindingPointIds\(node, \{ includeLegacy: true \}\)[\s\S]*?runtimeData\.subscribe/)
  assert.match(appSource, /function closeTableDataEditor\(\)[\s\S]*?stopTableEditorRuntimeSubscriptions\(\)/)

  const dataPanel = sourceBetween(
    appSource,
    '<template v-if="tableDataEditor.tab === \'data\'">',
    '<div v-else class="table-style-editor"'
  )
  assert.match(dataPanel, /静态配置[\s\S]*?当前接口数据/)
  assert.match(dataPanel, /<div class="table-data-view-switch" role="group" aria-label="表格数据视图">/)
  assert.doesNotMatch(dataPanel, /v-if="activeTableUsesRuntimeData" class="table-data-view-switch"/)
  assert.match(dataPanel, /v-if="tableEditorShowsRuntimeData && !activeTableUsesRuntimeData" class="table-runtime-empty"/)
  assert.match(dataPanel, /尚未配置接口数据[\s\S]*?请先配置表格接口数据[\s\S]*?配置接口/)
  assert.match(dataPanel, /暂未获取到接口数据[\s\S]*?检查接口配置/)
  assert.match(appSource, /function openTableCommunicationSettings\(\)[\s\S]*?closeTableDataEditor\(\)[\s\S]*?rightTab\.value = '通信'/)
  assert.match(dataPanel, /:readonly="tableEditorShowsRuntimeData"/)
  assert.match(dataPanel, /class="table-data-toolbar"/)
  assert.match(dataPanel, /v-if="!tableEditorShowsRuntimeData && tableDataEditor\.mode === 'edit'" class="table-data-structure-actions"/)
  assert.match(dataPanel, /:class="\{ 'merge-mode': tableDataEditor\.mode === 'merge' \}"/)
  assert.match(dataPanel, /@pointermove="extendTableDataSelectionFromPointer\(\$event\)"/)
  assert.match(dataPanel, /:class="\{ selected: tableDataCellSelected\(rowIndex, columnIndex\), merged: tableDataMergeAt\(rowIndex, columnIndex\) \}"/)
  assert.match(dataPanel, /@pointerdown="startTableDataSelectionDrag\(\$event, rowIndex, columnIndex\)"/)
  assert.match(dataPanel, /v-if="tableDataMergeAt\(rowIndex, columnIndex\)" class="table-data-merge-label"/)
  assert.doesNotMatch(appSource, /function setTableDataEditorMode\(mode\) \{\s*if \(tableEditorShowsRuntimeData\.value\) return/)
  assert.doesNotMatch(appSource, /function tableDataMergeAt\(row, column\) \{\s*if \(tableEditorShowsRuntimeData\.value\) return null/)
  assert.match(appSource, /const activeTableSelection = computed\(\(\) => \{[\s\S]*?const viewNode = activeTableEditorNode\.value[\s\S]*?rowEnd >= viewNode\.tableRows[\s\S]*?columnEnd >= viewNode\.tableColumns/)
  assert.match(appSource, /const activeTableViewMerges = computed\(\(\) => \{[\s\S]*?normalizeTableMerges\(node\.tableMerges, viewNode\.tableRows, viewNode\.tableColumns\)/)
  assert.match(appSource, /const selectedTableViewMerges = computed\(\(\) => tableMergesIntersectingSelection\(activeTableViewMerges\.value, activeTableSelection\.value\)\)/)
  assert.match(appSource, /const selectedTableMerges = computed\(\(\) => tableMergesIntersectingSelection\(activeTableDataNode\.value\?\.tableMerges, activeTableSelection\.value\)\)/)
  assert.match(appSource, /const tableSelectionMergeConflict = computed\(\(\) => hasTableMergeSelectionConflict\(activeTableDataNode\.value\?\.tableMerges, activeTableSelection\.value\)\)/)
  assert.match(appSource, /const tableSelectionMergeReady = computed\(\(\) => \{[\s\S]*?tableSelectionMergeConflict\.value[\s\S]*?selectedTableViewMerges\.value\.some/)
  assert.doesNotMatch(appSource, /function startTableEditorRuntimeSubscriptions\(node\)[\s\S]*?tableDataEditor\.value = \{ \.\.\.tableDataEditor\.value, mode: 'edit' \}/)
  assert.match(dataPanel, /tableDataEditorUpdateTitle/)
  assert.match(dataPanel, /tableDataEditorUpdateHeader/)
  assert.match(dataPanel, /tableDataEditorUpdateCell/)

  const stylePanel = sourceBetween(appSource, '<div v-else class="table-style-editor"', '<footer>')
  assert.match(stylePanel, /activeTableDataNode\.tableTitleFill/)
  assert.doesNotMatch(stylePanel, /activeTableEditorNode/)
})

test('preserves repeated spaces and supports horizontal or vertical text layout', () => {
  assert.match(editorModelSource, /textLayout:\s*'horizontal'/)
  assert.match(editorModelSource, /normalized\.textLayout = normalizeTextLayout\(source\.textLayout\)/)
  assert.match(appSource, /v-if="selected\.type === 'text'" class="field"[\s\S]*?data-testid="text-layout-control"[\s\S]*?v-model="selected\.textLayout" value="horizontal"[\s\S]*?v-model="selected\.textLayout" value="vertical"/)
  assert.match(appSource, /const common = computed\(\(\) => \[[\s\S]*?node\.textAlign, node\.textLayout/)
  assert.equal((appSource.match(/v-memo="\[nodeRenderMemo\(n\)/g) || []).length, 1)
  assert.match(previewNodeBatchSource, /v-for="node in nodes"[\s\S]*?v-memo=/)
  assert.match(previewNodeBatchSource, /<NodeVisual[\s\S]*?preview/)
  assert.match(nodeVisualSource, /class="node-text-content"[^>]*'text-layout-vertical': node\.type === 'text' && node\.textLayout === 'vertical'/)
  assert.match(nodeVisualSource, /node\.type !== 'text' \|\| node\.textLayout !== 'vertical'[\s\S]*?alignment === 'left' \? 'start' : alignment === 'right' \? 'end'/)

  const textRule = cssRule('.node-body.text > .node-text-content')
  const verticalRule = cssRule('.node-body.text > .node-text-content.text-layout-vertical')
  assert.match(textRule, /padding:\s*0/)
  assert.match(textRule, /line-height:\s*1(?:;|\s|$)/)
  assert.match(textRule, /max-height:\s*none/)
  assert.match(textRule, /white-space:\s*break-spaces/)
  assert.match(textRule, /overflow-wrap:\s*anywhere/)
  assert.match(verticalRule, /writing-mode:\s*vertical-rl/)
  assert.match(verticalRule, /text-orientation:\s*upright/)
})

test('keeps drag selection shells and the table node body transparent', () => {
  for (const selector of ['.single-node-transform-box', '.group-transform-box']) {
    assert.match(cssRule(selector), /background:\s*transparent/)
  }

  const formBodyRule = cssRule('.node-body:is(.table, .checkbox, .radio, .switch, .formProgress, .button, .input, .select, .time)')
  assert.match(formBodyRule, /background:\s*transparent\s*!important/)
  assert.match(formBodyRule, /box-shadow:\s*none/)
  assert.match(nodeVisualSource, /class="form-table-wrapper"[^>]*backgroundColor:\s*colorWithOpacity\(node\.tableRowFill, node\.backgroundOpacity \?\? 1\)/)
  assert.doesNotMatch(nodeVisualSource.match(/class="node-body"[\s\S]*?>/)?.[0] || '', /tableRowFill/)
})

test('mounts a zoom-compensated move target on every canvas node', () => {
  assert.match(appSource, /'--inverse-zoom': 1 \/ zoom/)
  assert.match(appSource, /<i class="node-move-hit" data-testid="node-move-hit" aria-hidden="true"><\/i>/)

  const rule = cssRule('.canvas .node-move-hit')
  assert.match(rule, /width:\s*24px/)
  assert.match(rule, /height:\s*24px/)
  assert.match(rule, /transform:\s*translate\(-50%,\s*-50%\)\s*scale\(var\(--inverse-zoom,\s*1\)\)/)
})

test('keeps the extended move target separate from resize and form interaction', () => {
  assert.match(
    enhancementCss,
    /\.compact-resize-handles > \.resize-handle\.nw\s*\{[^}]*--compact-resize-handle-offset/s
  )
  assert.match(
    enhancementCss,
    /\.compact-resize-handles > \.resize-handle\.se\s*\{[^}]*--compact-resize-handle-offset/s
  )
  assert.match(
    enhancementCss,
    /\.node-shell\.form-interacting > \.node-move-hit\s*\{\s*pointer-events:\s*none;\s*\}/
  )
})

test('lets an interactive button distinguish clicks from node drags in place', () => {
  const pointerHandler = nodeVisualSource.slice(
    nodeVisualSource.indexOf('function stopInteractivePointer'),
    nodeVisualSource.indexOf('function stopInteractiveDoubleClick')
  )
  assert.match(pointerHandler, /if \(!canInteract\(\) \|\| !event\.target\.closest\?\.\('\.form-control'\)\) return/)
  assert.match(pointerHandler, /if \(props\.node\.type !== 'button'\) event\.stopPropagation\(\)/)
  assert.match(appSource, /const NODE_DRAG_START_DISTANCE = 4/)
  assert.match(appSource, /if \(Math\.hypot\(e\.clientX - operation\.value\.sx, e\.clientY - operation\.value\.sy\) < NODE_DRAG_START_DISTANCE\) return/)
  assert.match(enhancementCss, /\.canvas \.form-interacting \.form-button-visual\s*\{\s*cursor:\s*move;\s*\}/)
  assert.match(nodeVisualSource, /@click\.stop="handleButtonClick"/)
})

test('keeps the logical point under the mouse stable through repeated zoom steps', () => {
  const anchor = { x: 187, y: 133 }
  const original = { scrollLeft: 420, scrollTop: 275, zoom: 1 }
  const worldPoint = {
    x: (original.scrollLeft + anchor.x) / original.zoom,
    y: (original.scrollTop + anchor.y) / original.zoom
  }
  let viewport = original

  for (const nextZoom of [1.1, 1.2, 1.3, 1.2, .9, .6]) {
    const scroll = anchoredCanvasScroll({
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      fromZoom: viewport.zoom,
      toZoom: nextZoom,
      anchorX: anchor.x,
      anchorY: anchor.y
    })
    viewport = { scrollLeft: scroll.left, scrollTop: scroll.top, zoom: nextZoom }
    assert.ok(Math.abs((viewport.scrollLeft + anchor.x) / nextZoom - worldPoint.x) < 1e-10)
    assert.ok(Math.abs((viewport.scrollTop + anchor.y) / nextZoom - worldPoint.y) < 1e-10)
  }
})

test('keeps the first wheel anchor stable while projected zoom targets are still pending', () => {
  const anchor = { x: 187, y: 133 }
  const worldPoint = { x: 607, y: 408 }
  let projected = { scrollLeft: 420, scrollTop: 275, zoom: 1 }

  for (const nextZoom of [1.1, 1.21, .99, 1.4, .8]) {
    const scroll = anchoredCanvasScroll({
      scrollLeft: projected.scrollLeft,
      scrollTop: projected.scrollTop,
      fromZoom: projected.zoom,
      toZoom: nextZoom,
      anchorX: anchor.x,
      anchorY: anchor.y,
      anchorWorldX: worldPoint.x,
      anchorWorldY: worldPoint.y
    })
    projected = { scrollLeft: scroll.left, scrollTop: scroll.top, zoom: nextZoom }
    assert.ok(Math.abs((projected.scrollLeft + anchor.x) / nextZoom - worldPoint.x) < 1e-10)
    assert.ok(Math.abs((projected.scrollTop + anchor.y) / nextZoom - worldPoint.y) < 1e-10)
  }
})

test('supports proportional canvas zoom from 20 to 1000 percent', () => {
  assert.equal(MIN_CANVAS_ZOOM, .2)
  assert.equal(MAX_CANVAS_ZOOM, 10)
  assert.equal(CANVAS_ZOOM_FACTOR, 1.1)
  assert.equal(clampCanvasZoom(.001), MIN_CANVAS_ZOOM)
  assert.equal(clampCanvasZoom(30), MAX_CANVAS_ZOOM)
  assert.ok(Math.abs(steppedCanvasZoom(1, 7) - CANVAS_ZOOM_FACTOR ** 7) < 1e-12)
  assert.equal(steppedCanvasZoom(1, 100), MAX_CANVAS_ZOOM)
  assert.equal(steppedCanvasZoom(1, -100), MIN_CANVAS_ZOOM)
  assert.equal(steppedCanvasZoom(1, 10000), MAX_CANVAS_ZOOM)
  assert.equal(steppedCanvasZoom(1, -10000), MIN_CANVAS_ZOOM)
})

test('pins the real canvas to its edges when an anchor would require outside space', () => {
  const stage = { width: 6000, height: 4000 }
  const viewportSize = { width: 955, height: 808 }
  const anchor = { x: 400, y: 300 }

  let topLeft = { scrollLeft: 0, scrollTop: 0, zoom: 1 }
  for (const nextZoom of [.9, .8, .7]) {
    const target = anchoredCanvasScroll({
      scrollLeft: topLeft.scrollLeft,
      scrollTop: topLeft.scrollTop,
      fromZoom: topLeft.zoom,
      toZoom: nextZoom,
      anchorX: anchor.x,
      anchorY: anchor.y
    })
    topLeft = {
      scrollLeft: clampedScroll(target.left, stage.width * nextZoom - viewportSize.width),
      scrollTop: clampedScroll(target.top, stage.height * nextZoom - viewportSize.height),
      zoom: nextZoom
    }
    assert.equal(topLeft.scrollLeft, 0)
    assert.equal(topLeft.scrollTop, 0)
  }

  let bottomRight = {
    scrollLeft: stage.width - viewportSize.width,
    scrollTop: stage.height - viewportSize.height,
    zoom: 1
  }
  const nextZoom = .8
  const target = anchoredCanvasScroll({
    scrollLeft: bottomRight.scrollLeft,
    scrollTop: bottomRight.scrollTop,
    fromZoom: bottomRight.zoom,
    toZoom: nextZoom,
    anchorX: anchor.x,
    anchorY: anchor.y
  })
  const maxLeft = stage.width * nextZoom - viewportSize.width
  const maxTop = stage.height * nextZoom - viewportSize.height
  bottomRight = {
    scrollLeft: clampedScroll(target.left, maxLeft),
    scrollTop: clampedScroll(target.top, maxTop),
    zoom: nextZoom
  }
  assert.equal(bottomRight.scrollLeft, maxLeft)
  assert.equal(bottomRight.scrollTop, maxTop)
})

test('clamps only the overflowing zoom axis and preserves the other mouse anchor', () => {
  const stage = { width: 6000, height: 4000 }
  const viewport = { width: 955, height: 808 }
  const scenarios = [
    { source: { left: 0, top: 900 }, anchor: { x: 100, y: 300 }, zoom: .5, clampedAxis: 'x' },
    { source: { left: stage.width - viewport.width, top: 900 }, anchor: { x: 800, y: 300 }, zoom: .8, clampedAxis: 'x' },
    { source: { left: 1000, top: 0 }, anchor: { x: 400, y: 100 }, zoom: .5, clampedAxis: 'y' },
    { source: { left: 1000, top: stage.height - viewport.height }, anchor: { x: 400, y: 700 }, zoom: .8, clampedAxis: 'y' }
  ]

  for (const scenario of scenarios) {
    const world = {
      x: scenario.source.left + scenario.anchor.x,
      y: scenario.source.top + scenario.anchor.y
    }
    const raw = anchoredCanvasScroll({
      scrollLeft: scenario.source.left,
      scrollTop: scenario.source.top,
      fromZoom: 1,
      toZoom: scenario.zoom,
      anchorX: scenario.anchor.x,
      anchorY: scenario.anchor.y
    })
    const scroll = {
      left: clampedScroll(raw.left, stage.width * scenario.zoom - viewport.width),
      top: clampedScroll(raw.top, stage.height * scenario.zoom - viewport.height)
    }
    const stableAxis = scenario.clampedAxis === 'x' ? 'y' : 'x'
    const offset = stableAxis === 'x' ? scenario.anchor.x : scenario.anchor.y
    const actualWorld = ((stableAxis === 'x' ? scroll.left : scroll.top) + offset) / scenario.zoom
    assert.ok(Math.abs(actualWorld - world[stableAxis]) < 1e-10)
  }
})

test('restores the original top-left view when one wheel gesture reverses', () => {
  const stage = { width: 6000, height: 4000 }
  const viewportSize = { width: 955, height: 808 }
  const anchor = { x: 400, y: 300 }
  const gestureWorld = { x: anchor.x, y: anchor.y }
  let viewport = { scrollLeft: 0, scrollTop: 0, zoom: 1 }

  for (const nextZoom of [.9, .8, .7, .8, .9, 1]) {
    const target = anchoredCanvasScroll({
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      fromZoom: viewport.zoom,
      toZoom: nextZoom,
      anchorX: anchor.x,
      anchorY: anchor.y,
      anchorWorldX: gestureWorld.x,
      anchorWorldY: gestureWorld.y
    })
    viewport = {
      scrollLeft: clampedScroll(target.left, stage.width * nextZoom - viewportSize.width),
      scrollTop: clampedScroll(target.top, stage.height * nextZoom - viewportSize.height),
      zoom: nextZoom
    }
  }

  assert.deepEqual(viewport, { scrollLeft: 0, scrollTop: 0, zoom: 1 })
})

test('expands transient canvas bounds without shrinking an existing gesture range', () => {
  const initial = { x: 100, y: 80, w: 500, h: 320 }
  const contained = { x: 160, y: 120, w: 180, h: 100 }
  const expanded = expandCanvasBounds(initial, { x: 40, y: 60, w: 760, h: 500 })

  assert.equal(expandCanvasBounds(initial, contained), initial, '已覆盖的投影视口不应触发响应式更新')
  assert.deepEqual(expanded, { x: 40, y: 60, w: 760, h: 500 })
  assert.deepEqual(expandCanvasBounds(expanded, initial), expanded)
})

test('starts the real stage at the canvas upper-left without viewport gutters', () => {
  assert.doesNotMatch(appSource, /canvasGutter/)
  assert.match(appSource, /class="stage-space" :style="\{ width: stageWidth \* zoom \+ 'px', height: stageHeight \* zoom \+ 'px' \}"/)
  assert.match(appSource, /ref="stage" class="stage" :style="\{ width: stageWidth \+ 'px', height: stageHeight \+ 'px'/)
  assert.match(appSource, /stageWidth\.value \* nextZoom - targetCanvas\.clientWidth/)
  assert.match(appSource, /scrollTo\(\{ left: 0, top: 0 \}\)/)
  assert.doesNotMatch(enhancementCss, /\.canvas \.stage-space\s*\{/)
  assert.match(enhancementCss, /\.stage-space > \.stage\s*\{[^}]*left:\s*0;\s*top:\s*0;/s)
  assert.match(enhancementCss, /\.canvas\s*\{[^}]*overflow-anchor:\s*none;/s)
})

test('coalesces wheel events without limiting per-frame touchpad steps', () => {
  const wheelHandler = appSource.slice(
    appSource.indexOf('function canvasWheel'),
    appSource.indexOf('async function resetCanvasView')
  )
  const toolbarZoomHandler = appSource.slice(
    appSource.indexOf('async function setCanvasZoom'),
    appSource.indexOf('let canvasWheelFrame')
  )
  assert.match(appSource, /const direction = Math\.sign\(-Number\(e\.deltaY\)\)\s+if \(!direction\) return/)
  assert.match(appSource, /pendingCanvasWheelSteps \+= direction/)
  assert.match(appSource, /canvasWheelFrame = requestAnimationFrame\(\(\) => \{/)
  assert.match(appSource, /createCanvasZoomTarget\(steppedCanvasZoom\(sourceZoom, steps\), anchor\.x, anchor\.y, \{ wheelGesture: true \}\)/)
  assert.match(wheelHandler, /applyTransientCanvasZoom\(target\)/)
  assert.match(wheelHandler, /scheduleCanvasZoomCommit\(target\)/)
  assert.doesNotMatch(wheelHandler, /Math\.(?:min|max)\([^;\n]*\bsteps\b/i)
  assert.match(appSource, /const source = projectedCanvasZoom\?\.canvas === targetCanvas[\s\S]*?: \{ canvas: targetCanvas, zoom: zoom\.value/)
  assert.match(appSource, /function applyTransientCanvasZoom\(target\)[\s\S]*?projectedCanvasZoom = target/)
  assert.match(appSource, /function scheduleCanvasZoomCommit\(target\)[\s\S]*?zoom\.value = target\.zoom/)
  assert.match(appSource, /const focusWorldX = reuseGesture \? canvasZoomGesture\.worldX/)
  assert.match(appSource, /const anchorX = reuseGesture \? canvasZoomGesture\.anchorX : pointerX/)
  assert.match(appSource, /anchoredCanvasScroll\(\{[\s\S]*?scrollLeft: source\.left,[\s\S]*?scrollTop: source\.top,[\s\S]*?fromZoom: oldZoom,[\s\S]*?toZoom: nextZoom,[\s\S]*?anchorX,[\s\S]*?anchorY,[\s\S]*?anchorWorldX: focusWorldX,[\s\S]*?anchorWorldY: focusWorldY/)
  assert.doesNotMatch(appSource, /centeredCanvasScroll/)
  assert.match(toolbarZoomHandler, /await nextTick\(\)[\s\S]*?renderTransientCanvasZoom\(target\)[\s\S]*?commitCanvasZoomTarget\(target\)/)
  assert.match(appSource, /@pointermove\.passive="handleCanvasPointerMove"/)
  assert.match(appSource, /@pointerleave="handleCanvasPointerLeave"/)
  assert.match(appSource, /function handleCanvasPointerMove\(e\)[\s\S]*?trackCanvasZoomPointer\(e\)/)
  assert.match(appSource, /function handleCanvasPointerLeave\(\)[\s\S]*?clearCanvasZoomGesture\(\)/)
  assert.doesNotMatch(appSource, /CANVAS_ZOOM_GESTURE_IDLE|canvasZoomGestureTimer/)
  assert.match(appSource, /setCanvasZoom\(steppedCanvasZoom\(zoom, -1\)\)/)
  assert.match(appSource, /setCanvasZoom\(steppedCanvasZoom\(zoom, 1\)\)/)
  assert.doesNotMatch(wheelHandler, /Math\.max\(\.2, zoom\.value\)|Math\.min\(3, requestedZoom\)/)
  assert.match(appSource, /function rotateHandleBelow\(frame\)[\s\S]*?const scale = zoom\.value/)
  assert.match(appSource, /const minimumDrag = 3 \/ zoom\.value/)
  assert.match(appSource, /2\.5 \/ zoom\.value/)
})

test('requires native double-click for text while preserving the table pointer fallback', () => {
  assert.match(appSource, /const TABLE_DOUBLE_POINTER_DELAY = 650/)
  assert.match(appSource, /const TABLE_DOUBLE_POINTER_DISTANCE = 12/)
  assert.match(appSource, /const NODE_DRAG_START_DISTANCE = 4/)
  assert.match(appSource, /function canStartNodeTextEdit\(node\)[\s\S]*?!\['lineShape', 'pencil'\]\.includes\(node\.type\)[\s\S]*?!isPolylineNodeType\(node\.type\)/)

  const tableFallback = appSource.slice(
    appSource.indexOf('function consumeTableDoublePointerDown'),
    appSource.indexOf('function startPencilDrawing')
  )
  assert.match(tableFallback, /node\.type !== 'table'/)
  assert.match(tableFallback, /!canStartNodeTextEdit\(node\)/)
  assert.doesNotMatch(appSource, /NODE_DOUBLE_POINTER|consumeNodeDoublePointerDown/)

  const pointerHandler = appSource.slice(
    appSource.indexOf('function nodePointerDown'),
    appSource.indexOf('async function startTextEdit')
  )
  assert.ok(pointerHandler.indexOf('consumeTableDoublePointerDown') < pointerHandler.indexOf('beginPointerOperation'))
  assert.match(pointerHandler, /if \(operation\.value\) pointerUp\(\)[\s\S]*?void startTextEdit\(e, n\)/)
  assert.match(pointerHandler, /type: 'moveNodes',[\s\S]*?deferPointerCapture: true/)
  assert.match(appSource, /function beginPointerOperation\(e, nextOperation\)[\s\S]*?if \(!nextOperation\.deferPointerCapture\) capturePointer\(e\)/)
  assert.match(appSource, /if \(operation\.value\?\.deferPointerCapture\)[\s\S]*?Math\.hypot\(e\.clientX - operation\.value\.sx, e\.clientY - operation\.value\.sy\) < NODE_DRAG_START_DISTANCE[\s\S]*?capturePointer\(e\)/)
  assert.match(appSource, /@dblclick="handleNodeDoubleClick\(\$event, n\)"/)
  assert.match(appSource, /class="inline-text-editor"[^>]*@pointerdown\.stop @dblclick\.stop/)
})

test('chart components never open the generic inline name editor', () => {
  const textEditGuard = sourceBetween(appSource, 'function canStartNodeTextEdit(node) {', 'function consumeTableDoublePointerDown')
  assert.match(textEditGuard, /!ECHARTS_COMPONENT_TYPES\.has\(node\.type\)/)
  assert.match(appSource, /v-if="editingText\?\.id === n\.id && !n\.locked && !ECHARTS_COMPONENT_TYPES\.has\(n\.type\)"[^>]*data-testid="inline-text-editor"/)
})

test('exposes time font size and weight controls through the inherited form text style', () => {
  assert.match(appSource, /data-testid="time-font-size"[^>]*v-model\.number="selected\.fontSize"|v-model\.number="selected\.fontSize"[^>]*data-testid="time-font-size"/)
  assert.match(appSource, /data-testid="time-font-weight"[^>]*v-model="selected\.fontWeight"|v-model="selected\.fontWeight"[^>]*data-testid="time-font-weight"/)
  assert.match(appSource, /data-testid="time-font-weight"[\s\S]*?<option value="400">常规<\/option><option value="600">中粗<\/option><option value="700">粗体<\/option>/)
  assert.match(cssRule('.form-time-visual input'), /font:\s*inherit/)
  assert.match(enhancementCss, /\.form-time-visual input,[\s\S]*?-webkit-text-stroke-width:\s*var\(--text-stroke-width, 0\)/)
})

test('keeps text entry shortcuts inactive during IME composition', () => {
  const startTextEdit = appSource.slice(
    appSource.indexOf('async function startTextEdit'),
    appSource.indexOf('function handleNodeDoubleClick')
  )
  assert.match(startTextEdit, /await nextTick\(\)[\s\S]*?focus\(\{ preventScroll: true \}\)[\s\S]*?setSelectionRange\(0, editor\.value\.length\)/)
  assert.doesNotMatch(startTextEdit, /\.select\(\)|requestAnimationFrame/)

  assert.match(appSource, /function handleWorkspaceNameKeydown\(event\)\s*\{[\s\S]*?isImeCompositionEvent\(event\)[\s\S]*?event\.key !== 'Enter'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?switchWorkspace\(\)/)
  assert.match(appSource, /function handleInlineTextEditorKeydown\(event\)\s*\{[\s\S]*?isImeCompositionEvent\(event, inlineTextComposing\.value\)[\s\S]*?event\.key === 'Enter'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?finishTextEdit\(\)[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?finishTextEdit\(true\)/)
  assert.match(appSource, /class="workspace-field">工作空间名称<input[^>]*@keydown="handleWorkspaceNameKeydown"/)
  assert.match(appSource, /class="inline-text-editor"[^>]*@keydown="handleInlineTextEditorKeydown"/)
  assert.doesNotMatch(appSource, /class="inline-text-editor"[^>]*@keydown\.(?:enter|esc)\.prevent/)

  const inlineTextInput = appSource.match(/<input[^>]*data-testid="inline-text-editor"[^>]*>/)?.[0] || ''
  assert.match(inlineTextInput, /lang="zh-CN"/)
  assert.match(inlineTextInput, /inputmode="text"/)
  assert.match(inlineTextInput, /@compositionstart="inlineTextComposing = true"/)
  assert.match(inlineTextInput, /@compositionend="inlineTextComposing = false"/)

  const inlineHandlerSource = appSource.slice(
    appSource.indexOf('function handleInlineTextEditorKeydown'),
    appSource.indexOf('function keydown')
  )
  let inlineFinish = null
  const handleInlineKeydown = new Function(
    'isImeCompositionEvent',
    'inlineTextComposing',
    'finishTextEdit',
    `${inlineHandlerSource}; return handleInlineTextEditorKeydown`
  )(isImeCompositionEvent, { value: false }, cancel => { inlineFinish = Boolean(cancel) })
  const keyEvent = (key, options = {}) => ({
    key,
    ...options,
    stopped: 0,
    prevented: 0,
    stopPropagation() { this.stopped += 1 },
    preventDefault() { this.prevented += 1 }
  })
  for (const event of [
    keyEvent('Shift', { keyCode: 16 }),
    keyEvent(' ', { code: 'Space', ctrlKey: true }),
    keyEvent('Process', { keyCode: 229 }),
    keyEvent('Enter', { isComposing: true })
  ]) {
    handleInlineKeydown(event)
    assert.deepEqual([event.stopped, event.prevented, inlineFinish], [0, 0, null])
  }
  const normalEnter = keyEvent('Enter')
  handleInlineKeydown(normalEnter)
  assert.deepEqual([normalEnter.stopped, normalEnter.prevented, inlineFinish], [1, 1, false])
  const normalEscape = keyEvent('Escape')
  handleInlineKeydown(normalEscape)
  assert.deepEqual([normalEscape.stopped, normalEscape.prevented, inlineFinish], [1, 1, true])

  const selectedTextInput = appSource.match(/<input[^>]*data-testid="selected-text-content"[^>]*>/)?.[0] || ''
  assert.match(selectedTextInput, /v-model="selected\.text"/)
  assert.match(selectedTextInput, /lang="zh-CN"/)
  assert.match(selectedTextInput, /inputmode="text"/)
  assert.doesNotMatch(selectedTextInput, /@keydown/)
})

test('keeps the inline text editor faithful when a component is scaled small', () => {
  assert.match(appSource, /function inlineTextEditorStyle\(node\)[\s\S]*?normalizedVisualScale\(node\.visualScaleX, node\.w\)[\s\S]*?normalizedVisualScale\(node\.visualScaleY, node\.h\)/)
  assert.match(appSource, /function inlineTextEditorStyle\(node\)[\s\S]*?width:\s*`\$\{100 \/ scaleX\}%`[\s\S]*?height:\s*`\$\{100 \/ scaleY\}%`[\s\S]*?transform:\s*`scale\(\$\{scaleX\}, \$\{scaleY\}\)`/)
  assert.match(appSource, /'text-editing': editingText\?\.id === n\.id/)
  assert.match(appSource, /data-testid="inline-text-editor"[^>]*:style="inlineTextEditorStyle\(n\)"/)

  const editorRule = cssRule('.inline-text-editor')
  assert.match(editorRule, /inset:\s*0/)
  assert.match(editorRule, /background:\s*transparent/)
  assert.match(editorRule, /padding:\s*0/)
  assert.match(editorRule, /border:\s*0/)
  assert.doesNotMatch(editorRule, /height:\s*30px/)
  assert.match(cssRule('.node-shell.text-editing .node-body > .node-text-content'), /visibility:\s*hidden/)
})

test('keeps locked components read-only until an explicit unlock action', () => {
  const doubleClickHandler = appSource.slice(
    appSource.indexOf('function handleNodeDoubleClick'),
    appSource.indexOf('function finishTextEdit')
  )
  assert.match(doubleClickHandler, /if \(!node\.locked\) return startTextEdit\(e, node\)/)
  assert.match(doubleClickHandler, /notify\('组件已锁定，请使用属性栏或右键菜单解锁'\)/)
  assert.doesNotMatch(doubleClickHandler, /locked\s*=\s*false|commit\(\)/)

  const tableEditor = appSource.slice(
    appSource.indexOf('function openTableDataEditor'),
    appSource.indexOf('function closeTableDataEditor')
  )
  assert.ok(tableEditor.indexOf('if (node.locked)') < tableEditor.indexOf('normalizeTableModel(node)'))
  assert.match(appSource, /activeTableDataNode = computed\(\(\) => \{[\s\S]*?nodeIndex\.value\.get\(tableDataEditor\.value\.nodeId\)[\s\S]*?node\?\.type === 'table' && !node\.locked/)
  assert.match(appSource, /function closeNodeEditors\(nodeIds\)[\s\S]*?finishTextEdit\(\)[\s\S]*?editingFormId\.value = null[\s\S]*?closeTableDataEditor\(\)/)
  assert.match(appSource, /if \(locked\) closeNodeEditors\(new Set\(entities\.map\(entity => entity\.id\)\)\)/)

  assert.match(appSource, /class="selection-property-editor" :disabled="selectedNodesContainLocked"/)
  assert.match(appSource, /data-testid="locked-property-state"/)
  assert.match(appSource, /'form-interacting': editingFormId === n\.id && !n\.locked/)
  assert.match(appSource, /:interactive="editingFormId === n\.id && !n\.locked"/)
  assert.match(appSource, /v-if="editingText\?\.id === n\.id && !n\.locked[^\"]*"/)
  assert.match(nodeVisualSource, /const canInteract = \(\) => props\.preview \|\| \(props\.interactive && !props\.node\.locked\)/)

  assert.match(appSource, /movingNodes\.some\(node => node\.locked\)/)
  assert.match(appSource, /function startResize\(e, n, direction\)[\s\S]*?if \(n\.locked \|\| operation\.value\) return/)
  assert.match(appSource, /selected && selectedNodeCount === 1 && !selected\.locked/)
  assert.match(appSource, /function deleteSelected\(\) \{\s*if \(rejectLockedSelection\('删除'\)\) return/)
  assert.match(enhancementCss, /\.selection-property-editor\s*\{[^}]*border:\s*0;/s)
})

test('starts pencil strokes above existing nodes before selection handlers', () => {
  assert.match(appSource, /function startPencilDrawing\(e\)[\s\S]*?activeTool\.value !== 'pencil'[\s\S]*?clearNodeSelection\(\)[\s\S]*?type: 'draw'/)

  const canvasHandler = appSource.slice(
    appSource.indexOf('function canvasPointerDown'),
    appSource.indexOf('function nodePointerDown')
  )
  assert.ok(canvasHandler.indexOf('startPencilDrawing(e)') < canvasHandler.indexOf("e.target.closest?.('.node-shell, .drawing-hit')"))

  const nodeHandler = appSource.slice(
    appSource.indexOf('function nodePointerDown'),
    appSource.indexOf('async function startTextEdit')
  )
  assert.ok(nodeHandler.indexOf('startPencilDrawing(e)') < nodeHandler.indexOf('consumeTableDoublePointerDown'))
  assert.match(appSource, /function drawingPointerDown\(e, drawing\)[\s\S]*?if \(startPencilDrawing\(e\)\) return[\s\S]*?moveDrawing/)
  assert.equal((appSource.match(/v-if="activeTool === 'select' && [^"]*" class="(?:drawing|group|single-node)-transform-box/g) || []).length, 3)
  assert.match(appSource, /function handleLockedBadgePointerDown\(e, node\)[\s\S]*?activeTool\.value === 'pencil'[\s\S]*?isPolylineNodeType\(activeTool\.value\)[\s\S]*?selectSingleNode\(node\)/)
  assert.match(appSource, /@pointerdown\.stop="handleLockedBadgePointerDown\(\$event, n\)"/)
})

test('keeps grouped visual scaling through move, rotate, preview, and reload', () => {
  assert.match(editorModelSource, /visualScaleX: 1, visualScaleY: 1/)
  assert.match(appSource, /const items = movingNodes\.map\(selectedNodeTransformItem\)/)
  assert.match(appSource, /const items = selectedNodes\.value\.map\(node => \(\{\s*\.\.\.selectedNodeTransformItem\(node\),\s*centerX:/)
  assert.match(appSource, /Object\.hasOwn\(item, 'visualScaleX'\)/)
  assert.match(appSource, /const geometry = computed\(\(\) => \[node\.x, node\.y, node\.w, node\.h, node\.rotate, node\.visualScaleX, node\.visualScaleY, node\.layer\]\)/)
  assert.equal((appSource.match(/v-memo="\[nodeRenderMemo\(n\)/g) || []).length, 1)
  assert.match(previewNodeBatchSource, /<NodeVisual[\s\S]*?:node="node"[\s\S]*?preview/)
  assert.match(nodeVisualSource, /class="node-visual-scale-frame"[^>]*:style="visualScaleFrameStyle"/)
  assert.match(nodeVisualSource, /w: Math\.max\(\.1, Number\(props\.node\.w\) \|\| 1\) \/ scaleX/)
  assert.match(enhancementCss, /\.node-visual-scale-frame\s*\{[^}]*transform-origin:\s*0 0;/s)
})

test('exposes solid, dashed, and dotted styles for the actual line body', () => {
  const lineControls = appSource.slice(
    appSource.indexOf('<template v-if="selected.type === \'lineShape\'">'),
    appSource.indexOf('<template v-else-if="![\'table\',\'pencil\'].includes(selected.type)">')
  )

  assert.match(lineControls, /data-testid="line-shape-style"/)
  assert.match(lineControls, /<option value="solid">实线<\/option><option value="dashed">虚线<\/option><option value="dotted">点线<\/option>/)
  assert.match(lineControls, /selected\.borderStyle !== 'solid'[\s\S]*?selected\.borderDashLength[\s\S]*?selected\.borderDashGap/)
  assert.match(lineControls, /显示轮廓[\s\S]*?selected\.borderVisible[\s\S]*?轮廓颜色[\s\S]*?selected\.stroke/)
  assert.match(nodeVisualSource, /node\.borderStyle === 'solid'[\s\S]*?data-testid="line-shape-body"[\s\S]*?lineShapeBodyDashArray\(visualNode\)/)
})

test('locks group aspect ratio only for corner resize handles', () => {
  const resizeNodes = appSource.slice(
    appSource.indexOf("if (op.type === 'resizeNodes')"),
    appSource.indexOf("if (op.type === 'rotateNodes')")
  )

  assert.match(
    resizeNodes,
    /lockAspectRatio:\s*(?:op\.direction\.length\s*===\s*2|\[['"]nw['"],\s*['"]ne['"],\s*['"]se['"],\s*['"]sw['"]\]\.includes\(op\.direction\))/
  )
  assert.doesNotMatch(resizeNodes, /lockAspectRatio:\s*true/)
  assert.match(appSource, /v-for="dir in resizeDirections"[^>]*@pointerdown="startSelectedNodesResize\(\$event, dir\)"/)
})

test('keeps group minimum sizes and property width or height independent by axis', () => {
  const scaleLimits = appSource.slice(
    appSource.indexOf('function selectedNodesScaleLimits'),
    appSource.indexOf('function selectedNodesMinimumBounds')
  )
  const minimumBounds = appSource.slice(
    appSource.indexOf('function selectedNodesMinimumBounds'),
    appSource.indexOf('function selectedNodesMaximumBounds')
  )
  const maximumBounds = appSource.slice(
    appSource.indexOf('function selectedNodesMaximumBounds'),
    appSource.indexOf('function selectedNodeTransformItem')
  )
  const metricSetter = appSource.slice(
    appSource.indexOf('function setSelectedNodesMetric'),
    appSource.indexOf('function startSelectedNodesResize')
  )
  const collectionBounds = appSource.slice(
    appSource.indexOf('function nodeCollectionBounds'),
    appSource.indexOf('function nodeSelectionBounds')
  )
  const resizeNodes = appSource.slice(
    appSource.indexOf("if (op.type === 'resizeNodes')"),
    appSource.indexOf("if (op.type === 'rotateNodes')")
  )

  assert.match(collectionBounds, /items\.every\(item => nodeMinimumSize\(item\)\.h < 1\) \? \.1 : 1/)
  assert.match(scaleLimits, /rotationScaleWeights\(item\.rotate\)/)
  assert.match(scaleLimits, /limits\.x\.minimum[^\n]+minimumWidthRatio[^\n]+parallel[^\n]+minimumHeightRatio[^\n]+cross/)
  assert.match(scaleLimits, /limits\.y\.minimum[^\n]+minimumWidthRatio[^\n]+cross[^\n]+minimumHeightRatio[^\n]+parallel/)
  assert.match(scaleLimits, /limits\.uniform\.maximum[^\n]+maximumWidthRatio[^\n]+maximumHeightRatio/)
  assert.match(minimumBounds, /useUniformScale = direction\.length === 2/)
  assert.match(minimumBounds, /limits\.uniform\.minimum : limits\.x\.minimum/)
  assert.match(minimumBounds, /limits\.uniform\.minimum : limits\.y\.minimum/)
  assert.match(maximumBounds, /limits\.uniform\.maximum : limits\.x\.maximum/)
  assert.match(maximumBounds, /limits\.uniform\.maximum : limits\.y\.maximum/)
  assert.match(metricSetter, /metric === 'w'\) \{\s*target\.w = clampNumber\(value, minimum\.w, maximum\.w\)/)
  assert.match(metricSetter, /metric === 'h'\) \{\s*target\.h = clampNumber\(value, minimum\.h, maximum\.h\)/)
  assert.doesNotMatch(metricSetter, /metric === 'w' \|\| metric === 'h'/)
  assert.match(metricSetter, /const translated = items\.map\(item => \(\{ \.\.\.item, x: item\.x \+ dx, y: item\.y \+ dy \}\)\)/)
  assert.ok(metricSetter.indexOf('applyNodeItemsGeometry(translated)') < metricSetter.indexOf('transformNodeCollectionWithinStage'))
  assert.match(resizeNodes, /minimumIsAuthoritative:\s*true/)
  assert.match(resizeNodes, /maximumWidth:\s*op\.maximum\.w/)
  assert.match(resizeNodes, /maximumHeight:\s*op\.maximum\.h/)
  assert.match(appSource, /minimum:\s*selectedNodesMinimumBounds\(items, bounds, direction, limits\)/)
  assert.match(appSource, /maximum:\s*selectedNodesMaximumBounds\(items, bounds, direction, limits\)/)
  assert.match(appSource, /:max="selectedNodeTransformSummary\.maximum\.w"/)
  assert.match(appSource, /:max="selectedNodeTransformSummary\.maximum\.h"/)
})

test('resolves selection through indexes and avoids redundant selection writes', () => {
  const selectionComputeds = appSource.slice(
    appSource.indexOf('const nodeIndex = shallowRef'),
    appSource.indexOf('const activeTableDataNode = computed')
  )
  assert.match(selectionComputeds, /const nodeIndex = shallowRef\(new globalThis\.Map\(\)\)/)
  assert.match(selectionComputeds, /const selected = computed\(\(\) => nodeIndex\.value\.get\(selectedId\.value\) \|\| null\)/)
  assert.match(selectionComputeds, /const selectedNodes = computed\(\(\) => selectedNodeIds\.value[\s\S]*?\.map\(id => nodeIndex\.value\.get\(id\)\)/)
  assert.doesNotMatch(selectionComputeds, /const selected = computed\(\(\) => nodes\.value\.find/)
  assert.doesNotMatch(selectionComputeds, /const selectedNodes = computed\(\(\) => nodes\.value\.filter/)

  const selectionSetter = appSource.slice(
    appSource.indexOf('function setNodeSelection'),
    appSource.indexOf('function selectSingleNode')
  )
  assert.match(selectionSetter, /const selectionChanged = selectedId\.value !== nextPrimaryId/)
  assert.match(selectionSetter, /if \(selectionChanged\) \{[\s\S]*?selectedNodeIds\.value = validIds[\s\S]*?selectedId\.value = nextPrimaryId/)
  assert.match(selectionSetter, /selectedDrawingId\.value = null[\s\S]*?paperSelected\.value = false/)
  assert.doesNotMatch(selectionSetter, /commit\(|snapshot\(|JSON\.stringify/)

  const ordinarySelection = appSource.slice(
    appSource.indexOf('if (isNodeSelected(n.id)) setNodeSelection'),
    appSource.indexOf("if (n.locked && activeTool.value !== 'select')")
  )
  assert.doesNotMatch(ordinarySelection, /commit\(|snapshot\(|JSON\.stringify/)

  const pointerSelection = appSource.slice(
    appSource.indexOf('function nodePointerDown'),
    appSource.indexOf("if (activeTool.value === 'line')")
  )
  assert.doesNotMatch(pointerSelection, /commit\(|snapshot\(|JSON\.stringify/)
})

test('keeps pending clicks out of viewport activity until dragging begins', () => {
  const activeNodes = appSource.slice(
    appSource.indexOf('const activeOperationNodeIds = computed'),
    appSource.indexOf('const visibleNodes = computed')
  )
  assert.match(appSource, /const EMPTY_NODE_ID_SET = new Set\(\)/)
  assert.match(activeNodes, /if \(!current \|\| current\.deferPointerCapture\) return EMPTY_NODE_ID_SET/)
  assert.match(activeNodes, /\['moveNodes', 'resizeNodes', 'rotateNodes'\]\.includes\(current\.type\)[\s\S]*?new Set\(current\.items\.map\(item => item\.id\)\)/)
  assert.match(activeNodes, /: EMPTY_NODE_ID_SET/)
  assert.doesNotMatch(activeNodes, /if \(!current\) return new Set\(\)/)
  assert.match(appSource, /(?:const|let) nodeSpatialIndex = createSpatialIndex/)
  assert.match(appSource, /function nodesInViewport[\s\S]*?queryNodesInBounds\(viewportWorldBounds/)
  assert.match(appSource, /const visibleNodes = computed\(\(\) => \{[\s\S]*?transientCanvasRenderBounds\.value[\s\S]*?nodesInViewport\(viewport\.value, zoom\.value\)/)
  assert.doesNotMatch(appSource, /const visibleNodes = computed\([\s\S]{0,200}nodes\.value\.filter/)

  const pointerMove = appSource.slice(
    appSource.indexOf('function pointerMove'),
    appSource.indexOf('function applyPointerMove')
  )
  assert.match(pointerMove, /Math\.hypot\([^\n]+\) < NODE_DRAG_START_DISTANCE\) return/)
  assert.ok(pointerMove.indexOf('NODE_DRAG_START_DISTANCE') < pointerMove.indexOf('operation.value.deferPointerCapture = false'))
})

test('keeps moving nodes fully opaque after the move threshold and restores DOM rendering on release', () => {
  assert.doesNotMatch(appSource, /NODE_MOVE_INTERACTION_OPACITY|nodeMoveInteractionOpacity/)
  assert.match(appSource, /function deactivateNodeMoveInteraction\(op\)[\s\S]*?op\.nodeMoveInteractionActive = false/)

  const nodePointerDown = sourceBetween(appSource, 'function nodePointerDown', 'async function startTextEdit')
  assert.match(nodePointerDown, /type: 'moveNodes',[\s\S]*?deferPointerCapture: true,[\s\S]*?nodeMoveInteractionActive: false/)

  const renderedNode = appSource.split('\n').find(line => line.includes('<div v-for="n in editorRenderedNodes"')) || ''
  assert.doesNotMatch(renderedNode, /nodeMoveInteractionOpacity|opacity:/)
  const groupTransformBox = appSource.split('\n').find(line => line.includes('data-testid="group-transform-box"')) || ''
  assert.doesNotMatch(groupTransformBox, /opacity:/)

  const pointerMove = sourceBetween(appSource, 'function pointerMove', 'function applyPointerMove')
  assert.ok(pointerMove.indexOf('NODE_DRAG_START_DISTANCE') < pointerMove.indexOf('operation.value.deferPointerCapture = false'))
  assert.ok(pointerMove.indexOf('operation.value.deferPointerCapture = false') < pointerMove.indexOf('operation.value.nodeMoveInteractionActive = true'))

  const pointerRelease = sourceBetween(appSource, 'function pointerUp', 'function openCanvasContextMenu')
  assert.ok(pointerRelease.indexOf('deactivateNodeMoveInteraction(finishedOperation)') < pointerRelease.indexOf('finishedOperation?.largeSelectionCommitPending'))
  assert.ok(pointerRelease.indexOf('deactivateNodeMoveInteraction(finishedOperation)') < pointerRelease.indexOf('scheduleLargeSelectionCommit(finishedOperation)'))
  assert.ok(pointerRelease.indexOf('finishEditorLodGeometry(finishedOperation)') < pointerRelease.indexOf('operation.value = null'))
  assert.match(appSource, /window\.addEventListener\('pointercancel', pointerUp\)/)
  assert.match(appSource, /window\.addEventListener\('lostpointercapture', pointerUp\)/)
  assert.match(appSource, /window\.addEventListener\('blur', pointerUp\)/)
  assert.match(pointerMove, /e\.pointerType === 'mouse' && e\.buttons === 0\) \{ pointerUp\(e\); return \}/)
  assert.match(appSource, /async function settleWorkspaceSwitchInteractions\(\)[\s\S]*?if \(operation\.value\) pointerUp\(\)/)
  assert.match(nodeVisualSource, /opacity: node\.opacity \?\? 1/)

  const largeCommitFinish = sourceBetween(appSource, 'function finishLargeSelectionCommit', 'function runLargeSelectionCommitSlice')
  const largeCommitSchedule = sourceBetween(appSource, 'function scheduleLargeSelectionCommit', 'function cancelLargeSelectionCommit')
  const largeCommitCancel = sourceBetween(appSource, 'function cancelLargeSelectionCommit', 'function pointerGeometryHistory')
  assert.ok(largeCommitFinish.indexOf('deactivateNodeMoveInteraction(op)') < largeCommitFinish.indexOf('finishEditorLodGeometry(op)'))
  assert.match(largeCommitSchedule, /if \(error \|\| !result\?\.feasible[\s\S]*?deactivateNodeMoveInteraction\(op\)[\s\S]*?finishEditorLodGeometry\(op\)/)
  assert.match(largeCommitCancel, /deactivateNodeMoveInteraction\(operation\.value\)[\s\S]*?cancelGeometryInteraction/)
})

test('keeps both LOD geometry patches fully opaque while moving and on the final frame', () => {
  const payload = sourceBetween(appSource, 'function editorLodGeometryPayload', 'function currentEditorLodGeometrySession')
  assert.match(payload, /nodeOpacityMultiplier: nodeOpacityMultiplier \?\? 1/)
  assert.doesNotMatch(payload, /nodeMoveInteractionActive|NODE_MOVE_INTERACTION_OPACITY/)
  assert.doesNotMatch(payload, /(?:node|activeNodes\[[^\]]+\])\.opacity\s*=/)

  const frame = sourceBetween(appSource, 'function requestEditorLodGeometryFrame', 'function finishEditorLodGeometry')
  assert.match(frame, /editorLodCanvas\.value\?\.requestGeometryInteractionFrame\?\.\(sessionId, payload\)/)
  assert.match(frame, /editorLodDetailCanvas\.value\?\.requestGeometryInteractionFrame\?\.\(detailSessionId, payload\)/)

  const finish = sourceBetween(appSource, 'function finishEditorLodGeometry', 'function commitPointerOperation')
  assert.match(finish, /editorLodGeometryPayload\(op, revision, 1\)/)
  assert.match(finish, /editorLodDetailCanvas\.value\?\.finishGeometryInteraction\?\.\([\s\S]*?payload/)
  assert.match(finish, /editorLodCanvas\.value\?\.finishGeometryInteraction\?\.\(sessionId, payload\)/)
})

test('keeps embedded video data out of the URL input and commits once by node id', () => {
  const videoControls = appSource.slice(
    appSource.indexOf('<template v-if="selected.type === \'video\'">'),
    appSource.indexOf('<h3 v-if="selected.type !== \'pencil\'">')
  )
  assert.match(videoControls, /data-testid="embedded-video-source"/)
  assert.match(videoControls, /data-testid="video-url-editor"/)
  assert.match(videoControls, /:value="selectedVideoEditorValue"/)
  assert.match(videoControls, /:data-node-id="selected\.id"/)
  assert.match(videoControls, /@input="cacheVideoUrlEdit"/)
  assert.match(videoControls, /@blur="commitSelectedVideoUrl"/)
  assert.doesNotMatch(videoControls, /v-model="selected\.videoUrl"/)

  const videoCommit = appSource.slice(
    appSource.indexOf('function restoreVideoUrlInput'),
    appSource.indexOf('function uploadNodeVideo')
  )
  assert.match(videoCommit, /nodeId: target\.dataset\.nodeId/)
  assert.match(videoCommit, /nodeIndex\.value\.get\(edit\.nodeId\)/)
  assert.match(videoCommit, /edit\.embeddedSource && !nextUrl/)
  assert.match(videoCommit, /node\.videoUrl = nextUrl/)
  assert.match(videoCommit, /isImeCompositionEvent\(event\)/)
  const flushVideoEdit = appSource.slice(
    appSource.indexOf('function flushPendingVideoUrlEdit'),
    appSource.indexOf('function commitSelectedVideoUrl')
  )
  assert.ok(flushVideoEdit.indexOf("if (nextUrl === String(node.videoUrl || '')) return") < flushVideoEdit.indexOf("recordNodeFields(node, ['videoUrl'])"))
  assert.equal((flushVideoEdit.match(/recordNodeFields\(node, \['videoUrl'\]\)/g) || []).length, 1)
  assert.doesNotMatch(flushVideoEdit, /selected\.value/)
  assert.ok(flushVideoEdit.indexOf("recordNodeFields(node, ['videoUrl'])") < flushVideoEdit.indexOf('node.videoUrl = nextUrl'))
  assert.match(appSource, /function flushPendingDocumentEdits\(\) \{\s*flushDocumentInputRender\(\)\s*finishActiveFieldEdit\(\)\s*flushPendingVideoUrlEdit\(\)/)
  assert.match(appSource, /function setNodeSelection\([^)]*\) \{\s*flushPendingDocumentEdits\(\)/)
  assert.match(appSource, /function clearNodeSelection\(\) \{\s*flushPendingDocumentEdits\(\)/)
  assert.match(appSource, /const selectedVideoEditorValue = computed\(\(\) => selectedVideoHasEmbeddedSource\.value \? '' : selectedVideoSource\.value\)/)

  const embeddedSize = appSource.slice(
    appSource.indexOf('function embeddedDataUrlByteLength'),
    appSource.indexOf('function formatMediaBytes')
  )
  assert.doesNotMatch(embeddedSize, /atob\(|decodeURIComponent\(|new Blob|\.split\(/)

  const editorNodeLoop = appSource.slice(
    appSource.indexOf('<div v-for="n in editorRenderedNodes"'),
    appSource.indexOf('<div v-if="showMiniMap"', appSource.indexOf('<div v-for="n in editorRenderedNodes"'))
  )
  assert.match(editorNodeLoop, /v-for="n in editorRenderedNodes" :key="n\.id"/)
  assert.match(editorNodeLoop, /v-memo="\[nodeRenderMemo\(n\)/)
  assert.match(appSource, /const common = computed\(\(\) => \[[\s\S]*?node\.videoUrl, node\.videoFit, node\.videoAutoplay/)
  assert.match(editorNodeLoop, /<NodeVisual :key="`\$\{n\.id\}:\$\{n\.dataKey\}`"/)
  assert.doesNotMatch(editorNodeLoop.match(/<NodeVisual[^>]*>/)?.[0] || '', /n\.videoUrl|:selected=|v-if=/)
  assert.match(nodeVisualSource, /<video v-if="node\.videoUrl"[^>]*:src="node\.videoUrl"/)
  assert.doesNotMatch(nodeVisualSource, /<video[^>]*:key=/)
  assert.match(nodeVisualSource, /watch\(\(\) => \[props\.node\.videoUrl, props\.node\.videoPlayCount, props\.node\.videoAutoplay\], initializeVideoPlayback\)/)
  assert.match(nodeVisualSource, /watch\(\[videoElement, \(\) => props\.node\.videoMuted, \(\) => props\.node\.videoPlaybackRate\], syncVideoSettings/)
})

test('renders fullscreen preview at actual pixels without the ordinary preview header', () => {
  const keydownHandler = sourceBetween(appSource, 'function keydown(e) {', '\n// 其他响应式数据')
  const fullscreenChange = sourceBetween(appSource, 'function handleFullscreenChange', 'async function togglePreviewAutoFit')
  const fullscreenReconcile = sourceBetween(appSource, 'function reconcilePreviewFullscreenState', 'async function togglePreviewAutoFit')
  const invalidateViewport = sourceBetween(appSource, 'function invalidatePreviewViewportSchedule', 'function updatePreviewViewport')
  const updateViewport = sourceBetween(appSource, 'function updatePreviewViewport', 'function commitPreviewViewport')
  const scheduleViewport = sourceBetween(appSource, 'function schedulePreviewViewport', 'function flushPreviewViewport')
  const flushViewport = sourceBetween(appSource, 'function flushPreviewViewport', 'function commitPreviewViewport')
  const commitViewport = sourceBetween(appSource, 'function commitPreviewViewport', 'function previewCanvasHasFrame')
  const enterFullscreen = sourceBetween(appSource, 'async function enterPreviewFullscreen', 'async function exitPreviewFullscreen')
  const exitFullscreen = sourceBetween(appSource, 'async function exitPreviewFullscreen', 'function togglePreviewFullscreen')
  const useScreenSize = sourceBetween(appSource, 'async function useCurrentScreenSize', 'const edgeAdjacency')
  const canvasPreset = sourceBetween(appSource, 'const canvasSizePreset = computed', 'const layerEntries')

  assert.match(appSource, /const previewRenderScale = computed\(\(\) => previewFullscreen\.value\s*\? 1\s*: \(previewFittedVisible\.value \? previewFitPresentationScale\.value : 1\)/)
  assert.match(appSource, /function previewFullscreenTarget\(\) \{\s*return document\.documentElement\s*\}/)
  assert.match(enterFullscreen, /const target = previewFullscreenTarget\(\)[\s\S]*?requestFullscreen/)
  assert.doesNotMatch(enterFullscreen, /navigationUI/)
  assert.match(enterFullscreen, /fullscreenElement\(\) !== target/)
  assert.match(exitFullscreen, /document\.exitFullscreen \|\| document\.webkitExitFullscreen/)
  assert.match(fullscreenChange, /fullscreenElement\(\) === previewFullscreenTarget\(\)/)
  assert.match(fullscreenChange, /invalidatePreviewViewportSchedule\(\)/)
  assert.match(fullscreenChange, /if \(isFullscreen\) \{[\s\S]*?previewFullscreen\.value = true[\s\S]*?ensurePreviewDomHandoff\(\)[\s\S]*?updatePreviewViewport\(\{ scroll: \{ left: 0, top: 0 \}, waitForContentRect: true \}\)/)
  assert.doesNotMatch(fullscreenChange, /stageWidth\.value\s*=|stageHeight\.value\s*=|normalizeCanvasSize\(|markDocumentInput\(/)
  assert.doesNotMatch(flushViewport, /stageWidth\.value\s*=|stageHeight\.value\s*=|syncScreenCanvasSizeFromFullscreen|markDocumentInput\(/)
  assert.doesNotMatch(appSource, /function syncScreenCanvasSizeFromFullscreen|resolveScreenCanvasSizeForFullscreen/)
  assert.doesNotMatch(fullscreenChange, /resetPreviewDomHandoff\(\)/)
  const exitFitTarget = fullscreenChange.indexOf("previewRenderTarget.value = 'fit'")
  const exitFullscreenState = fullscreenChange.indexOf('previewFullscreen.value = isFullscreen')
  assert.ok(exitFitTarget >= 0 && exitFitTarget < exitFullscreenState)
  assert.match(fullscreenChange, /if \(previewAutoFit\.value\)[\s\S]*?refreshFit: true, waitForContentRect: true/)
  assert.doesNotMatch(fullscreenChange, /ensurePreviewFitCanvas/)
  assert.equal((fullscreenChange.match(/waitForContentRect: true/g) || []).length, 4)
  assert.doesNotMatch(fullscreenChange, /commitPreviewViewport|\.scrollTo\(|clientWidth|clientHeight|getComputedStyle|fittedPreviewScale/)
  assert.match(fullscreenReconcile, /previewFullscreenPending\.value[\s\S]*?fullscreenElement\(\) === previewFullscreenTarget\(\)[\s\S]*?handleFullscreenChange\(\)/)
  assert.match(keydownHandler, /if \(showPreview\.value\) \{\s*const fullscreenActive = fullscreenElement\(\) === previewFullscreenTarget\(\)\s*if \(previewFullscreen\.value && !fullscreenActive\) \{\s*e\.preventDefault\(\)\s*handleFullscreenChange\(\)\s*return\s*\}\s*if \(previewFullscreenPending\.value \|\| fullscreenActive\) return/)
  assert.match(fullscreenReconcile, /function handlePreviewWindowResize\(event\)[\s\S]*?reconcilePreviewFullscreenState\(\)[\s\S]*?updatePreviewViewport\(event\)/)
  assert.match(appSource, /window\.addEventListener\('resize', handlePreviewWindowResize\)[\s\S]*?window\.addEventListener\('focus', reconcilePreviewFullscreenState\)/)
  assert.match(appSource, /document\.addEventListener\('visibilitychange', reconcilePreviewFullscreenState\)/)
  assert.match(appSource, /window\.removeEventListener\('resize', handlePreviewWindowResize\)[\s\S]*?window\.removeEventListener\('focus', reconcilePreviewFullscreenState\)/)
  assert.match(appSource, /document\.removeEventListener\('visibilitychange', reconcilePreviewFullscreenState\)/)

  assert.match(invalidateViewport, /previewViewportScheduler\?\.invalidate\(\)/)
  assert.match(updateViewport, /const resizeEntry = Array\.isArray\(source\)[\s\S]*?entry\?\.target === previewCanvas\.value/)
  assert.match(updateViewport, /resizeEntry\?\.contentRect \|\| source\?\.contentRect/)
  assert.match(updateViewport, /schedulePreviewViewport\(\{[\s\S]*?contentRect,[\s\S]*?scroll: source\?\.scroll,[\s\S]*?refreshFit: source\?\.refreshFit,[\s\S]*?waitForContentRect: source\?\.waitForContentRect/)
  assert.match(scheduleViewport, /createPreviewViewportScheduler\(\{[\s\S]*?requestFrame: callback => requestAnimationFrame\(callback\)[\s\S]*?cancelFrame: frame => cancelAnimationFrame\(frame\)[\s\S]*?flush: flushPreviewViewport/)
  assert.match(flushViewport, /commitPreviewViewport\(scroll\.left, scroll\.top, target, contentRect\)/)
  assert.doesNotMatch(flushViewport, /FullscreenPreviewScale|previewScale/)
  assert.match(flushViewport, /syncPreviewFitCommittedOffset\(target, contentRect\)/)
  assert.match(flushViewport, /\}\s*if \(previewFittedVisible\.value && previewFitFrameAvailable\.value\) \{\s*syncPreviewFitCommittedOffset\(target, contentRect\)/)
  assert.equal((flushViewport.match(/syncPreviewFitCommittedOffset\(target, contentRect\)/g) || []).length, 1)
  assert.equal((flushViewport.match(/ensurePreviewFitCanvas/g) || []).length, 1)
  assert.match(appSource, /previewResizeObserver = new ResizeObserver\(updatePreviewViewport\)/)
  assert.match(commitViewport, /contentRect = null/)
  assert.ok(commitViewport.indexOf('contentRect?.width') < commitViewport.indexOf('target.clientWidth'))
  assert.ok(commitViewport.indexOf('contentRect?.height') < commitViewport.indexOf('target.clientHeight'))

  assert.match(appSource, /class="preview-overlay"[^>]*:class="\{[^}]*'is-fullscreen': previewFullscreen[^}]*'is-preparing': !previewPresentationReady[^}]*\}"/)
  assert.match(appSource, /:aria-busy="!previewPresentationReady"/)
  assert.match(appSource, /<\/div>\s*<header v-if="showPreview && !previewFullscreen" class="preview-header"/)
  assert.match(appSource, /width: stageWidth \* previewRenderScale[\s\S]*?height: stageHeight \* previewRenderScale/)
  assert.doesNotMatch(appSource, /previewStageWidth|previewStageHeight|fills-screen-viewport/)
  assert.doesNotMatch(enhancementCss, /fills-screen-viewport/)
  assert.match(appSource, /canvasSizeMode: canvasSizeMode\.value/)
  assert.match(appSource, /transform: `scale\(\$\{previewRenderScale\}\)`/)
  assert.match(appSource, /marginLeft: previewFittedVisible && !previewFullscreen \? previewFitPresentationOffset\.left/)
  assert.match(appSource, /marginTop: previewFittedVisible && !previewFullscreen \? previewFitPresentationOffset\.top/)
  assert.match(enhancementCss, /\.preview-canvas\.preview-fit \{[^}]*align-items:\s*flex-start;[^}]*justify-content:\s*flex-start;/)
  assert.match(appSource, /'preview-fit': previewFittedVisible && !previewFullscreen/)
  assert.doesNotMatch(appSource, /previewScreenFillActive|screenCanvasFullscreenScale|syncFullscreenPreviewScale/)
  assert.doesNotMatch(enhancementCss, /preview-screen-fill/)
  assert.match(useScreenSize, /resolveFullscreenViewportSize\(\{[\s\S]*?screenWidth: globalThis\.screen\?\.width,[\s\S]*?screenHeight: globalThis\.screen\?\.height,[\s\S]*?innerWidth: globalThis\.innerWidth,[\s\S]*?outerWidth: globalThis\.outerWidth/)
  assert.match(useScreenSize, /stageWidth\.value = clampCanvasDimension\(width/)
  assert.match(useScreenSize, /stageHeight\.value = clampCanvasDimension\(height/)
  assert.match(useScreenSize, /canvasSizeMode\.value = 'screen'/)
  assert.match(useScreenSize, /await normalizeCanvasSize\(\)[\s\S]*?markDocumentInput\(\)/)
  assert.match(canvasPreset, /canvasSizeMode\.value !== 'fixed'[\s\S]*?return 'custom'/)
  assert.match(appSource, /data-testid="canvas-width"[^>]*step="1"/)
  assert.match(appSource, /data-testid="canvas-height"[^>]*step="1"/)
  assert.match(appSource, /data-testid="canvas-width"[^>]*@input="canvasSizeMode = 'fixed'"/)
  assert.match(appSource, /data-testid="canvas-height"[^>]*@input="canvasSizeMode = 'fixed'"/)
  assert.match(appSource, /canvasSizeMode === 'screen' \? `全屏分辨率 \$\{stageWidth\} × \$\{stageHeight\} px`/)
  assert.doesNotMatch(appSource, /fullscreen-preview-exit/)

  assert.match(enhancementCss, /\.preview-header\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*51/)
  assert.doesNotMatch(enhancementCss, /\.preview-overlay\.is-fullscreen > header/)
  assert.match(enhancementCss, /\.preview-overlay\.is-fullscreen > \.preview-viewport-clip,[\s\S]*?:fullscreen \.preview-overlay > \.preview-viewport-clip,[\s\S]*?inset:\s*auto;/)
  assert.match(enhancementCss, /\.preview-overlay\.is-fullscreen > \.preview-viewport-clip > \.preview-canvas,[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/)
  assert.match(enhancementCss, /\.preview-overlay\.is-fullscreen\.scroll-x[^}]*overflow-x:\s*auto;/)
  assert.match(enhancementCss, /\.preview-overlay\.is-fullscreen\.scroll-y[^}]*overflow-y:\s*auto;/)
  assert.match(appSource, /'scroll-x': previewFullscreen && previewFullscreenScrollAxes\.x/)
  assert.match(appSource, /'scroll-y': previewFullscreen && previewFullscreenScrollAxes\.y/)
  assert.match(enhancementCss, /:fullscreen \.preview-overlay/)
  assert.doesNotMatch(enhancementCss, /:fullscreen \.preview-header[\s\S]*?display:\s*none/)
  assert.doesNotMatch(enhancementCss, /\.preview-overlay:fullscreen|\.preview-canvas:fullscreen/)
  assert.doesNotMatch(enhancementCss, /\.fullscreen-preview-exit/)
})

test('resolves the fullscreen viewport before the user opens preview', () => {
  assert.deepEqual(resolveFullscreenViewportSize({
    screenWidth: 1707,
    screenHeight: 1067,
    innerWidth: 1897,
    outerWidth: 1707
  }), { width: 1896, height: 1185 })

  assert.deepEqual(resolveFullscreenViewportSize({
    screenWidth: 1920,
    screenHeight: 1080,
    innerWidth: 1918,
    outerWidth: 1920
  }), { width: 1920, height: 1080 })

  assert.deepEqual(resolveFullscreenViewportSize({
    screenWidth: 0,
    screenHeight: 0,
    innerWidth: 1366,
    innerHeight: 768,
    outerWidth: 0
  }), { width: 1366, height: 768 })

  assert.deepEqual(resolveFullscreenViewportSize({
    screenWidth: 1920,
    screenHeight: 1080,
    innerWidth: 360,
    innerHeight: 720,
    outerWidth: 1280
  }), { width: 1920, height: 1080 })
})

test('shows fullscreen scrollbars only on axes that exceed the fullscreen viewport', () => {
  assert.deepEqual(fullscreenPreviewScrollAxes({
    stageWidth: 1996,
    stageHeight: 1185,
    viewportWidth: 1896,
    viewportHeight: 1185
  }), { x: true, y: false })

  assert.deepEqual(fullscreenPreviewScrollAxes({
    stageWidth: 1896,
    stageHeight: 1285,
    viewportWidth: 1896,
    viewportHeight: 1185
  }), { x: false, y: true })

  assert.deepEqual(fullscreenPreviewScrollAxes({
    stageWidth: 1996,
    stageHeight: 1285,
    viewportWidth: 1896,
    viewportHeight: 1185
  }), { x: true, y: true })
})

test('edits canvas width and height independently', () => {
  const normalizeCanvas = sourceBetween(appSource, 'async function normalizeCanvasSize', 'async function setCanvasPreset')
  const normalizeFixedCanvas = sourceBetween(appSource, 'async function normalizeFixedCanvasSize', 'const edgeAdjacency')

  assert.match(normalizeCanvas, /dimension = null/)
  assert.match(normalizeCanvas, /if \(!dimension \|\| dimension === 'width'\)\s*stageWidth\.value = clampCanvasDimension/)
  assert.match(normalizeCanvas, /if \(!dimension \|\| dimension === 'height'\)\s*stageHeight\.value = clampCanvasDimension/)
  assert.match(normalizeFixedCanvas, /normalizeCanvasSize\(dimension\)/)
  assert.match(appSource, /data-testid="canvas-width"[^>]*@change="normalizeFixedCanvasSize\('width'\)"/)
  assert.match(appSource, /data-testid="canvas-height"[^>]*@change="normalizeFixedCanvasSize\('height'\)"/)
})

test('preserves existing component positions when the canvas becomes smaller', () => {
  const normalizeCanvas = sourceBetween(appSource, 'async function normalizeCanvasSize', 'async function setCanvasPreset')

  assert.doesNotMatch(normalizeCanvas, /normalizeNodesTogether/)
  assert.doesNotMatch(normalizeCanvas, /drawings\.value/)
  assert.doesNotMatch(normalizeCanvas, /rebuildNodeSpatialIndex/)
})

test('coalesces fullscreen intent and ResizeObserver dimensions into one preview frame', () => {
  const callbacks = []
  const flushes = []
  const scheduler = createPreviewViewportScheduler({
    requestFrame(callback) {
      callbacks.push(callback)
      return callbacks.length
    },
    cancelFrame() {},
    flush(update) {
      flushes.push(update)
    }
  })

  scheduler.schedule({ scroll: { left: 0, top: 0 }, waitForContentRect: true })
  scheduler.schedule({ contentRect: { width: 1692, height: 827 } })

  assert.equal(callbacks.length, 1)
  assert.deepEqual(flushes, [])
  callbacks[0]()
  assert.deepEqual(flushes, [{
    contentRect: { width: 1692, height: 827 },
    scroll: { left: 0, top: 0 },
    refreshFit: false
  }])
})

test('waits one frame for a fullscreen ResizeObserver result and then uses it', () => {
  const callbacks = []
  const flushes = []
  const scheduler = createPreviewViewportScheduler({
    requestFrame(callback) {
      callbacks.push(callback)
      return callbacks.length
    },
    cancelFrame() {},
    flush(update) {
      flushes.push(update)
    }
  })

  scheduler.schedule({ scroll: { left: 10, top: 20 }, waitForContentRect: true })
  callbacks[0]()

  assert.equal(callbacks.length, 2)
  assert.deepEqual(flushes, [])
  scheduler.schedule({ contentRect: { width: 1280, height: 720 } })
  assert.equal(callbacks.length, 2)
  callbacks[1]()
  assert.deepEqual(flushes, [{
    contentRect: { width: 1280, height: 720 },
    scroll: { left: 10, top: 20 },
    refreshFit: false
  }])
})

test('falls back on the second fullscreen frame without delaying ordinary scrolls', () => {
  const callbacks = []
  const flushes = []
  const scheduler = createPreviewViewportScheduler({
    requestFrame(callback) {
      callbacks.push(callback)
      return callbacks.length
    },
    cancelFrame() {},
    flush(update) {
      flushes.push(update)
    }
  })

  scheduler.schedule({ scroll: { left: 5, top: 6 }, waitForContentRect: true })
  callbacks[0]()
  assert.deepEqual(flushes, [])
  callbacks[1]()
  assert.equal(flushes.length, 1)
  assert.equal(flushes[0].contentRect, null)

  scheduler.schedule({ scroll: { left: 7, top: 8 } })
  assert.equal(callbacks.length, 3)
  callbacks[2]()
  assert.equal(flushes.length, 2)
  assert.deepEqual(flushes[1].scroll, { left: 7, top: 8 })
})

test('invalidates stale preview viewport callbacks without clearing the replacement frame', () => {
  const callbacks = new Map()
  const cancelled = []
  const flushes = []
  let nextFrame = 1
  const scheduler = createPreviewViewportScheduler({
    requestFrame(callback) {
      const frame = nextFrame
      nextFrame += 1
      callbacks.set(frame, callback)
      return frame
    },
    cancelFrame(frame) {
      cancelled.push(frame)
    },
    flush(update) {
      flushes.push(update)
    }
  })

  scheduler.schedule({ scroll: { left: 25, top: 50 } })
  scheduler.invalidate()
  scheduler.schedule({ contentRect: { width: 800, height: 600 }, refreshFit: true })

  assert.deepEqual(cancelled, [1])
  callbacks.get(1)()
  assert.deepEqual(flushes, [])
  assert.equal(scheduler.state().scheduled, true)
  callbacks.get(2)()
  assert.deepEqual(flushes, [{
    contentRect: { width: 800, height: 600 },
    scroll: null,
    refreshFit: true
  }])
  assert.equal(scheduler.state().scheduled, false)
})
