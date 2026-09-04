import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createComponentGroups, SHAPE_DEFAULTS } from '../src/config/componentCatalog.js'
import { echartsCodeSourceHash, normalizeNode } from '../src/models/editorModel.js'
import { previewNodeNeedsLiveDom } from '../src/utils/previewRenderPolicy.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const visualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const echartsVisualSource = readFileSync(new URL('../src/components/EChartsVisual.vue', import.meta.url), 'utf8')
const communicationSource = readFileSync(new URL('../src/components/CommunicationBindingPanel.vue', import.meta.url), 'utf8')
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const parserSource = readFileSync(new URL('../src/utils/echartsCodeParser.js', import.meta.url), 'utf8')
const sandboxSource = readFileSync(new URL('../src/utils/echartsCodeSandbox.js', import.meta.url), 'utf8')
const enhancementSource = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const chartTypes = ['lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart']

test('component library exposes the requested categories in order', () => {
  const groups = createComponentGroups()
  assert.deepEqual(groups.map(group => group.name), [
    '基本形状',
    '线段组件',
    '功能组件',
    '图表组件',
    '动效组件',
    '自定义动效',
    '网络与云',
    '工业设备',
    '流程图组件'
  ])
  assert.deepEqual(
    groups.find(group => group.name === '图表组件').items.map(item => item.type),
    [...chartTypes, 'echartsCode']
  )
  assert.ok(!groups.find(group => group.name === '基本形状').items.some(item => item.type === 'process'))
  assert.deepEqual(
    groups.find(group => group.name === '流程图组件').items.map(item => item.type),
    ['process', 'decision', 'terminal', 'database']
  )
})

test('new complete-code charts use a readable 4:3 default size', () => {
  assert.deepEqual(SHAPE_DEFAULTS.echartsCode.slice(1), [400, 300])
})

test('legacy chart nodes migrate without deleting their data', () => {
  const normalized = normalizeNode({ type: 'chart', chartData: [12, 34], chartLabels: ['A', 'B'] })
  assert.equal(normalized.type, 'barChart')
  assert.deepEqual(normalized.chartData, [12, 34])
  assert.deepEqual(normalized.chartLabels, ['A', 'B'])
})

test('code chart cache is retained only when it matches the current source', () => {
  const source = `option = { series: [{ type: 'bar', data: [1, 2] }] };`
  const option = { series: [{ type: 'bar', data: [1, 2] }] }
  const sourceHash = echartsCodeSourceHash(source)

  const matching = normalizeNode({
    type: 'echartsCode',
    echartsCode: source,
    chartOption: option,
    chartOptionSourceHash: sourceHash
  })
  assert.deepEqual(matching.chartOption, option)
  assert.equal(matching.chartOptionSourceHash, sourceHash)

  const stale = normalizeNode({
    type: 'echartsCode',
    echartsCode: `${source}\n// changed`,
    chartOption: option,
    chartOptionSourceHash: sourceHash
  })
  assert.deepEqual(stale.chartOption, {})
  assert.equal(stale.chartOptionSourceHash, '')

  const legacyCacheWithoutSource = normalizeNode({
    type: 'echartsCode',
    echartsCode: source,
    chartOption: option
  })
  assert.deepEqual(legacyCacheWithoutSource.chartOption, {})
})

test('all ECharts components use sharp live rendering in normal previews', () => {
  for (const type of [...chartTypes, 'echartsCode']) {
    assert.equal(previewNodeNeedsLiveDom({ type }), true, `${type} should use live DOM`)
  }
  assert.match(visualSource, /<EChartsVisual :node="visualNode"/)
  assert.match(echartsVisualSource, /import\('echarts'\)/)
  assert.match(echartsVisualSource, /renderer:\s*'svg'/)
  assert.match(echartsVisualSource, /sandbox="allow-scripts"/)
  assert.match(echartsVisualSource, /createEChartsSandboxDocument/)
  assert.match(visualSource, /<EChartsVisual :node="visualNode" :interactive="preview"/)
  assert.match(visualSource, /chartVisualTypes\.has\(node\.type\)/)
  assert.equal(packageJson.dependencies.echarts.startsWith('^'), true)
})

test('property editor covers standard data and complete-code workflows', () => {
  for (const target of [
    'chartTitle', 'chartSeriesName', 'chartColor', 'chartShowLegend', 'chartShowTooltip',
    'chartShowGrid', 'chartSmooth', 'chartAreaFill', 'chartSymbolSize', 'chartRadarMax',
    'chartLabels', 'chartData', 'chartSeries', 'chartSliceColors', 'echartsCode'
  ]) assert.match(appSource, new RegExp(`data-property-target(?:s)?="[^"]*${target}`), `missing ${target} editor`)
  assert.match(appSource, /scheduleSelectedEChartsCode\(selected\)/)
  assert.match(appSource, /applySelectedEChartsCode\(selected\)/)
  assert.match(appSource, /@input="setSelectedChartValue\(row, \$event\.target\.value\)"/)
  assert.doesNotMatch(appSource, /@change="setSelectedChartValue\(/)
  assert.match(appSource, /@blur="restoreSelectedChartNumber\(\$event, row\)"/)
  assert.match(appSource, /ECHARTS_COMPONENT_TYPES\.has\(selected\.type\)/)
  assert.match(appSource, /完整代码将在隔离环境中运行/)
})

test('complete-code editor provides a spacious light-theme dialog with an isolated draft', () => {
  assert.match(appSource, /data-testid="echarts-code-editor-open"/)
  assert.match(appSource, /data-testid="echarts-code-editor-dialog"/)
  assert.match(appSource, /v-model="echartsCodeEditor\.draft"/)
  assert.match(appSource, /function openEChartsCodeEditor/)
  assert.match(appSource, /function applyEChartsCodeEditor/)
  assert.match(appSource, /function closeEChartsCodeEditor/)
  assert.match(enhancementSource, /\.echarts-code-editor-dialog\s*\{[^}]*width:\s*min\(1100px,/s)
  assert.match(enhancementSource, /\.echarts-code-editor-textarea\s*\{[^}]*background:\s*#fff/s)
  assert.doesNotMatch(enhancementSource, /\.chart-code-field textarea\s*\{[^}]*background:\s*#202a31/s)
})

test('complete-code charts preserve a readable logical viewport without weakening sandboxing', () => {
  assert.match(echartsVisualSource, /echartsCodeViewport/)
  assert.match(echartsVisualSource, /:style="chartFrameStyle"/)
  assert.match(echartsVisualSource, /width:\s*`\$\{viewport\.width\}px`/)
  assert.match(echartsVisualSource, /height:\s*`\$\{viewport\.height\}px`/)
  assert.match(echartsVisualSource, /transform:\s*`scale\(\$\{viewport\.scale\}\)`/)
  assert.match(echartsVisualSource, /transformOrigin:\s*'0 0'/)
  assert.match(echartsVisualSource, /sandbox="allow-scripts"/)
  assert.doesNotMatch(echartsVisualSource, /allow-same-origin/)
})

test('complete-code charts relay editor hover to the isolated runtime while preserving canvas gestures', () => {
  assert.match(echartsVisualSource, /SANDBOX_HOST_MESSAGE_SOURCE/)
  assert.match(echartsVisualSource, /function relayCodeChartPointerMove/)
  assert.match(echartsVisualSource, /x:\s*localX\s*\/\s*viewport\.scale/)
  assert.match(echartsVisualSource, /y:\s*localY\s*\/\s*viewport\.scale/)
  assert.match(echartsVisualSource, /type:\s*'pointermove'/)
  assert.match(echartsVisualSource, /type:\s*'pointerleave'/)
  assert.match(echartsVisualSource, /@pointermove="relayCodeChartPointerMove"/)
  assert.match(echartsVisualSource, /@pointerleave="relayCodeChartPointerLeave"/)
  assert.match(sandboxSource, /handler\.dispatch\('mousemove'/)
  assert.match(sandboxSource, /handler\.dispatch\('mouseout'/)
  assert.match(enhancementSource, /\.echarts-code-frame\s*\{\s*pointer-events:\s*none;/)
})

test('complete-code charts relay a short click but suppress it after a component drag', () => {
  assert.match(echartsVisualSource, /function rememberCodeChartPointerDown/)
  assert.match(echartsVisualSource, /function relayCodeChartClick/)
  assert.match(echartsVisualSource, /CODE_CHART_CLICK_DRAG_THRESHOLD/)
  assert.match(echartsVisualSource, /codeChartPointerMoved/)
  assert.match(echartsVisualSource, /postSandboxMessage\(\{\s*type:\s*'click'/s)
  assert.match(echartsVisualSource, /@pointerdown="rememberCodeChartPointerDown"/)
  assert.match(echartsVisualSource, /@click="relayCodeChartClick"/)
  assert.doesNotMatch(enhancementSource, /\.canvas \.echarts-visual\s*\{\s*cursor:\s*pointer;/)
  assert.match(echartsVisualSource, /message\.type === 'cursor'/)
  assert.match(echartsVisualSource, /const codeChartCursorStyle = computed/)
  assert.match(echartsVisualSource, /:style="codeChartCursorStyle"/)
})

test('standard charts use the same responsive logical viewport as complete-code charts', () => {
  assert.match(echartsVisualSource, /standardEChartsViewport/)
  assert.match(echartsVisualSource, /const chartFrameStyle = computed/)
  assert.match(echartsVisualSource, /class="echarts-chart-host" :style="chartFrameStyle"/)
  assert.match(echartsVisualSource, /class="echarts-code-frame"[\s\S]*?:style="chartFrameStyle"/)
  assert.doesNotMatch(enhancementSource, /\.echarts-visual\s*>\s*div[\s\S]*?width:\s*100%\s*!important/)
})

test('standard chart data editor explains the visual mapping for every chart type', () => {
  for (const text of [
    '每行对应当前系列在横轴上的 1 个点', '每行对应当前系列在横轴上的 1 根柱',
    '每行对应 1 个扇区，颜色与图例一致', '每行对应当前系列的 1 个坐标点（X, Y）', '每行对应当前系列的 1 个雷达维度',
    '横轴分类', '折线点值（Y）', '柱值（Y）', '扇区名称', '扇区数值',
    '点名称', 'X 坐标', 'Y 坐标', '指标名称', '指标值'
  ]) assert.match(appSource, new RegExp(text), `missing chart editor label: ${text}`)
  assert.match(appSource, /class="chart-data-item-marker"/)
  assert.match(appSource, /class="chart-series-list"/)
  assert.match(appSource, /class="chart-series-item"/)
  assert.match(appSource, /aria-label="`编辑系列 \$\{seriesIndex \+ 1\} 的数据`"/)
  assert.match(appSource, /class="chart-data-table-head"/)
  assert.match(appSource, /class="chart-data-row"/)
  assert.doesNotMatch(appSource, /class="chart-series-picker"/)
  assert.doesNotMatch(appSource, /class="chart-data-item"/)
  assert.match(communicationSource, /series: '数据系列'/)
  assert.match(communicationSource, /class="chart-series-binding-head"/)
  assert.match(communicationSource, /chartSeriesBoundCount/)
  assert.match(communicationSource, /chartSeriesDataCount/)
  assert.match(appSource, /chartDataMarkerStyle\(row\.sourceIndex\)/)
  assert.match(appSource, /setSelectedPieSliceColor\(row\.sourceIndex/)
  assert.match(appSource, /addSelectedChartSeries/)
  assert.match(appSource, /removeSelectedChartSeries/)
  assert.match(appSource, /setSelectedChartSeriesColor/)
  assert.match(appSource, /selectedChartTotal/)
  assert.match(appSource, /selectedChartLimitMessage/)
  assert.match(appSource, /selectedChartTotal >= MAX_EDITABLE_CHART_ITEMS/)
  assert.doesNotMatch(appSource, /selectedChartTotal >= MAX_RUNTIME_CHART_BARS/)
  assert.match(appSource, /aria-hidden="true"/)
  assert.match(appSource, /row\.sourceIndex/)
  assert.match(appSource, /chartRowsFromNode\(node\)/)
  assert.doesNotMatch(appSource, /class="chart-data-head"/)
  assert.doesNotMatch(appSource, /staticChartRowValue/)
})

test('chart editor updates original rows without flattening structured data and invalidates stale code cache immediately', () => {
  assert.match(appSource, /setChartRowLabel\(selectedChartEditNode\(node\), row, value\)/)
  assert.match(appSource, /setChartRowValue\(editNode, row, value, \{ field, rows \}\)/)
  assert.match(appSource, /applySelectedSeriesDataPatch\(node, patch\)/)
  assert.match(appSource, /removeChartRow\(\{ \.\.\.node, chartData: item\.data, chartLabels: originalLabels \}/)
  assert.match(
    appSource,
    /function scheduleSelectedEChartsCode[\s\S]*?node\.chartOptionSourceHash = ''[\s\S]*?pendingEChartsCodeNode = node[\s\S]*?setTimeout/
  )
  assert.match(
    appSource,
    /node\.chartOption = option \|\| \{\}[\s\S]*?node\.chartOptionSourceHash = option \? echartsCodeSourceHash\(node\.echartsCode\) : ''/
  )
  assert.match(
    appSource,
    /function applySelectedEChartsCode[\s\S]*?catch \(error\) \{\s*node\.chartOption = \{\}\s*node\.chartOptionSourceHash = ''/
  )
  assert.match(
    appSource,
    /function flushPendingDocumentEdits[\s\S]*?flushPendingEChartsCode\(\)/
  )
})

test('minimap recognizes every new chart without creating ECharts instances', () => {
  for (const type of [...chartTypes, 'echartsCode']) assert.match(miniMapSource, new RegExp(`['"]${type}['"]`))
  assert.match(miniMapSource, /function drawChart\(/)
  assert.doesNotMatch(miniMapSource, /import\(['"]echarts['"]\)/)
})

test('complete-code parser never executes pasted JavaScript', () => {
  assert.equal(packageJson.dependencies.acorn.startsWith('^'), true)
  assert.doesNotMatch(parserSource, /\beval\s*\(/)
  assert.doesNotMatch(parserSource, /\bnew\s+Function\b/)
  assert.doesNotMatch(parserSource, /document\.createElement\s*\(\s*['"]script['"]/)
})

test('complete-code runtime stays inside a script-only sandbox', () => {
  assert.match(echartsVisualSource, /sandbox="allow-scripts"/)
  assert.doesNotMatch(echartsVisualSource, /allow-same-origin/)
  assert.doesNotMatch(sandboxSource, /localStorage|sessionStorage|document\.cookie/)
  assert.match(sandboxSource, /prepareEChartsCodeForSandbox/)
})
