import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  COMPONENT_CATEGORY_BY_TYPE,
  COMPONENT_NAME_BY_TYPE,
  createComponentGroups,
  SHAPE_DEFAULTS
} from '../src/config/componentCatalog.js'
import {
  baseNodeOptions,
  builtInVisualPrimaryColor,
  migrateTableMergesForDeletion,
  migrateTableMergesForInsertion,
  hasTableMergeSelectionConflict,
  normalizeEdge,
  normalizeNode,
  normalizeTableModel,
  normalizeTableMerges,
  tableMergesIntersectingSelection
} from '../src/models/editorModel.js'
import { splitTextGraphemes, verticalTextColumns } from '../src/utils/textLayout.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const enhancementsSource = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')

test('builds unique component indexes from the catalog', () => {
  const groups = createComponentGroups()
  const items = groups.flatMap(group => group.items.map(item => ({ ...item, category: group.name })))
  const types = items.map(item => item.type)

  const chartGroup = groups.find(group => group.name === '图表组件')
  const basicGroup = groups.find(group => group.name === '基本形状')
  const flowchartGroup = groups.find(group => group.name === '流程图组件')
  const hiddenCompatibilityTypes = new Set(['pencil', 'chart', 'progress', 'code'])

  assert.equal(groups.length, 9)
  assert.deepEqual(groups.map(group => group.name), [
    '基本形状', '线段组件', '功能组件', '图表组件',
    '动效组件', '自定义动效', '网络与云', '工业设备', '流程图组件'
  ])
  assert.equal(new Set(types).size, types.length)
  assert.deepEqual(new Set(types), new Set(Object.keys(SHAPE_DEFAULTS).filter(type => !hiddenCompatibilityTypes.has(type))))
  assert.deepEqual(
    chartGroup.items.map(item => item.type),
    ['lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart', 'echartsCode']
  )
  assert.ok(['process', 'decision', 'terminal', 'database'].every(type => !basicGroup.items.some(item => item.type === type)))
  assert.deepEqual(flowchartGroup.items.map(item => item.type), ['process', 'decision', 'terminal', 'database'])
  assert.ok([...hiddenCompatibilityTypes].every(type => !types.includes(type)))
  assert.equal(COMPONENT_NAME_BY_TYPE.get('heartbeat'), '告警')
  assert.equal(SHAPE_DEFAULTS.heartbeat[0], '告警')
  for (const item of items) {
    assert.equal(COMPONENT_CATEGORY_BY_TYPE.get(item.type), item.category)
    assert.equal(COMPONENT_NAME_BY_TYPE.get(item.type), item.name)
  }
})

test('returns independent catalog and node default state', () => {
  const firstGroups = createComponentGroups()
  const secondGroups = createComponentGroups()
  firstGroups[0].open = false
  firstGroups[0].items.pop()
  assert.equal(secondGroups[0].open, true)
  assert.notEqual(firstGroups[0].items.length, secondGroups[0].items.length)

  const firstNode = baseNodeOptions()
  const secondNode = baseNodeOptions()
  firstNode.signalColors[0] = '#000000'
  firstNode.chartLabels[0] = '已修改'
  firstNode.chartData[0] = 999
  firstNode.chartOption.series = []
  firstNode.pencilPoints.push({ x: 0, y: 0 })
  firstNode.tableMerges.push({ row: 0, column: 0, rowSpan: 2, columnSpan: 2 })
  assert.equal(secondNode.signalColors[0], '#21c58e')
  assert.deepEqual(secondNode.chartLabels, ['一月', '二月', '三月', '四月'])
  assert.deepEqual(secondNode.chartData, [35, 70, 48, 85])
  assert.notStrictEqual(firstNode.chartSeries, secondNode.chartSeries)
  assert.notStrictEqual(firstNode.chartSeries[0].data, secondNode.chartSeries[0].data)
  assert.deepEqual(secondNode.chartOption, {})
  assert.deepEqual(secondNode.pencilPoints, [])
  assert.deepEqual(secondNode.tableMerges, [])
})

test('normalizes the legacy chart type and validates shared chart properties', () => {
  const legacy = normalizeNode({
    type: 'chart',
    chartData: [12, 30],
    chartLabels: ['A', 2],
    chartColor: ' #123456 ',
    chartShowLegend: 'false',
    chartShowTooltip: 1,
    chartShowGrid: 0,
    chartSmooth: 'true',
    chartAreaFill: false,
    chartSymbolSize: 999,
    chartRadarMax: -10
  })

  assert.equal(legacy.type, 'barChart')
  assert.deepEqual(legacy.chartData, [12, 30])
  assert.deepEqual(legacy.chartLabels, ['A', '2'])
  assert.equal(legacy.chartColor, '#123456')
  assert.deepEqual(legacy.chartSeries, [{ name: '系列 1', color: '#123456', data: [12, 30] }])
  assert.equal(legacy.chartShowLegend, false)
  assert.equal(legacy.chartShowTooltip, true)
  assert.equal(legacy.chartShowGrid, false)
  assert.equal(legacy.chartSmooth, true)
  assert.equal(legacy.chartAreaFill, false)
  assert.equal(legacy.chartSymbolSize, 100)
  assert.equal(legacy.chartRadarMax, 100)
})

test('normalizes multiple chart series without sharing imported data and keeps the first legacy series fields synchronized', () => {
  const source = {
    type: 'lineChart',
    chartLabels: ['A', 'B'],
    chartSeries: [
      { name: '设备 A', color: '#dc2626', data: [10, 20] },
      { name: '设备 B', color: '#2563eb', data: [12, 18] }
    ]
  }
  const node = normalizeNode(source)

  assert.deepEqual(node.chartSeries, source.chartSeries)
  assert.notStrictEqual(node.chartSeries, source.chartSeries)
  assert.notStrictEqual(node.chartSeries[0].data, source.chartSeries[0].data)
  assert.equal(node.chartSeriesName, '设备 A')
  assert.equal(node.chartColor, '#dc2626')
  assert.deepEqual(node.chartData, [10, 20])

  const legacyOverride = normalizeNode({
    ...source,
    chartSeriesName: '接口系列',
    chartColor: '#9333ea',
    chartData: [30, 40]
  })
  assert.deepEqual(legacyOverride.chartSeries[0], {
    name: '接口系列',
    color: '#9333ea',
    data: [30, 40]
  })
})

test('code components keep their dark defaults without overriding edited fill and text colors', () => {
  const codeRule = styleSource.match(/\.node-body\.code\{[^}]*\}/)?.[0] || ''
  assert.match(codeRule, /font-family:Consolas,monospace/)
  assert.match(enhancementsSource, /\.node-body\.code\s*\{\s*background:\s*var\(--shape-fill\)\s*!important;\s*color:\s*var\(--form-color\)\s*!important;/)
  assert.match(appSource, /if \(type === 'code'\) \{ n\.fill = '#25323b'; n\.color = '#d8f5ee' \}/)
})

test('node normalization bounds imported signal palettes to the supported eight colors', () => {
  const signalColors = Array.from({ length: 100_000 }, (_, index) => `#${index.toString(16).padStart(6, '0').slice(-6)}`)
  const node = normalizeNode({ type: 'signalLight', signalColorCount: 8, signalColors })

  assert.equal(node.signalColors.length, 8)
  assert.deepEqual(node.signalColors, signalColors.slice(0, 8))
  assert.notStrictEqual(node.signalColors, signalColors)
})

test('node normalization validates animation settings and completes short signal palettes', () => {
  const signal = normalizeNode({
    type: 'signalLight',
    animation: 'flow',
    animationDuration: -4,
    animationDirection: 'sideways',
    animationPaused: 'false',
    signalOpacity: 9,
    signalColorCount: 3.8,
    signalColors: ['#123456']
  })

  assert.equal(signal.animation, 'none')
  assert.equal(signal.animationDuration, .2)
  assert.equal(signal.animationDirection, 'normal')
  assert.equal(signal.animationPaused, false)
  assert.equal(signal.signalOpacity, 1)
  assert.equal(signal.signalColorCount, 3)
  assert.deepEqual(signal.signalColors, ['#123456', '#ef5350', '#ffc440'])

  const bounded = normalizeNode({
    type: 'waterTank',
    animation: 'flow',
    animationDuration: 99,
    animationDirection: 'reverse',
    animationPaused: 'true',
    signalOpacity: -2,
    signalColorCount: 99,
    signalColors: ['#111111', '', null]
  })
  assert.equal(bounded.animation, 'flow')
  assert.equal(bounded.animationDuration, 5)
  assert.equal(bounded.animationDirection, 'reverse')
  assert.equal(bounded.animationPaused, true)
  assert.equal(bounded.signalOpacity, 0)
  assert.equal(bounded.signalColorCount, 8)
  assert.equal(bounded.signalColors.length, 8)
  assert.deepEqual(bounded.signalColors.slice(0, 4), ['#111111', '#ef5350', '#ffc440', '#168eea'])

  assert.equal(normalizeNode({ type: 'heartbeat', animation: 'flow' }).animation, 'none')
  assert.equal(normalizeNode({ type: 'rect', animation: 'float' }).animation, 'none')
  assert.equal(normalizeNode({ type: 'rect', animation: 'invalid' }).animation, 'none')
  assert.equal(normalizeNode({ type: 'rect', animationDuration: Number.NaN }).animationDuration, 1.5)
  assert.equal(normalizeNode({ type: 'rect', animationDirection: 'alternate-reverse' }).animationDirection, 'normal')
  assert.equal(normalizeNode({ type: 'rect' }).visible, true)
  assert.equal(normalizeNode({ type: 'rect', visible: 'false' }).visible, false)
})

test('normalizes built-in visual colors and water level without changing legacy defaults', () => {
  const tank = normalizeNode({
    type: 'waterTank',
    progressValue: 135
  })

  assert.equal(tank.progressValue, 100)
  assert.equal(tank.visualPrimaryColor, '#3bb9df')
  assert.equal(normalizeNode({ type: 'heartbeat' }).visualPrimaryColor, '#ef5350')
  assert.equal(normalizeNode({ type: 'particles', visualPrimaryColor: ' #123456 ' }).visualPrimaryColor, '#123456')
  assert.equal(builtInVisualPrimaryColor('flowPipe'), '#16b89a')
  assert.equal(builtInVisualPrimaryColor('flowDirection'), '#16b89a')
})

test('built-in visual property controls expose only settings that render', () => {
  assert.match(appSource, /visualPrimaryColor:\s*builtInVisualPrimaryColor\(type\)/)
  assert.match(appSource, /data-testid="visual-primary-color"/)
  assert.match(appSource, /'flowPipe','rotatingFan','signalLight','waterTank','heartbeat','particles'/)
  assert.match(appSource, /Math\.trunc\(Number\(value\) \|\| 2\)/)
})

test('normalizes legacy media, time, font, and pencil fields', () => {
  const video = normalizeNode({ type: 'video', w: 240, h: 135, videoPlaying: true, videoPlaybackRate: 9, videoPlayCount: -4 })
  assert.equal(video.videoAutoplay, true)
  assert.equal(video.videoPlaybackRate, 4)
  assert.equal(video.videoPlayCount, 0)
  assert.equal('videoPlaying' in video, false)

  const time = normalizeNode({ type: 'time', w: 160, h: 42, value: '09:30:00', timeSource: 'current', timeMin: '00:00' })
  assert.equal(time.timeUseServer, true)
  assert.equal(time.timeRunning, true)
  assert.equal(time.timeShowLeftIcon, true)
  assert.equal(time.timeShowRightIcon, true)
  assert.equal('timeSource' in time, false)
  assert.equal('timeMin' in time, false)

  const text = normalizeNode({ type: 'text', w: 160, h: 50, fontWeightScale: 1.5 })
  assert.equal(text.fontWeight, '600')
  assert.equal('fontWeightScale' in text, false)

  const pencil = normalizeNode({
    type: 'pencil', w: 120, h: 80, color: '#123456', width: .05, dash: true,
    points: [], pencilPoints: [{ x: -1, y: .4 }, { x: 2, y: .8 }, { x: 'bad', y: 1 }]
  })
  assert.deepEqual(pencil.pencilPoints, [{ x: 0, y: .4 }, { x: 1, y: .8 }])
  assert.equal(pencil.pencilColor, '#123456')
  assert.equal(pencil.pencilWidth, .1)
  assert.equal(pencil.pencilDash, true)
  assert.equal(pencil.backgroundOpacity, 0)
})

test('normalizes text layout without changing repeated spaces', () => {
  const spacedText = '甲    乙'
  const vertical = normalizeNode({ type: 'text', w: 160, h: 50, text: spacedText, textLayout: 'vertical' })
  const restored = normalizeNode(JSON.parse(JSON.stringify(vertical)))

  assert.equal(baseNodeOptions().textLayout, 'horizontal')
  assert.equal(vertical.textLayout, 'vertical')
  assert.equal(restored.text, spacedText)
  assert.equal(restored.textLayout, 'vertical')
  assert.equal(normalizeNode({ type: 'text', w: 160, h: 50, textLayout: 'diagonal' }).textLayout, 'horizontal')
  assert.deepEqual(verticalTextColumns(spacedText, 2), [['甲', ' '], [' ', ' '], [' ', '乙']])
  assert.deepEqual(verticalTextColumns('甲\n乙', 10), [['甲'], ['乙']])
  assert.equal(splitTextGraphemes('甲乙').join(''), '甲乙')
})

test('converts legacy table text into a bounded structured table', () => {
  const table = normalizeNode({
    type: 'table', w: 360, h: 200, tableColumns: 2, tableRows: 2,
    options: '姓名,状态', tableData: '设备 A,正常;设备 B,告警',
    tableRowHeight: 10, tableColumnWidths: [1, 2]
  })

  assert.deepEqual(table.tableHeaders, ['姓名', '状态'])
  assert.deepEqual(table.tableCells, [['设备 A', '正常'], ['设备 B', '告警']])
  assert.equal(table.tableRowHeight, 18)
  assert.deepEqual(table.tableRowHeights, [18, 18])
  assert.equal(table.tableColumnWidthsPx.length, 2)
  assert.ok(table.tableColumnWidthsPx.every(width => width >= 40))
})

test('drops invalid and overlapping table merges', () => {
  assert.deepEqual(normalizeTableMerges([
    { row: 0, column: 0, rowSpan: 2, columnSpan: 2 },
    { row: 1, column: 1, rowSpan: 2, columnSpan: 2 },
    { row: -1, column: 0, rowSpan: 2, columnSpan: 2 },
    { row: 2, column: 2, rowSpan: 5, columnSpan: 5 },
    { row: 0, column: 2, rowSpan: 1, columnSpan: 1 }
  ], 3, 3), [
    { row: 0, column: 0, rowSpan: 2, columnSpan: 2 }
  ])
})

test('preserves bounded interface merge layouts beyond the static fallback size', () => {
  const table = normalizeTableModel({
    tableRows: 2,
    tableColumns: 2,
    tableHeaders: ['A', 'B'],
    tableCells: [['1', '2'], ['3', '4']],
    tableMerges: [{ row: 4, column: 1, rowSpan: 2, columnSpan: 2 }]
  })

  assert.deepEqual(table.tableMerges, [
    { row: 4, column: 1, rowSpan: 2, columnSpan: 2 }
  ])
})

test('static structure edits leave interface-only merge coordinates unchanged', () => {
  const rowMerges = [
    { row: 0, column: 0, rowSpan: 2, columnSpan: 1 },
    { row: 4, column: 0, rowSpan: 2, columnSpan: 2 }
  ]
  assert.deepEqual(migrateTableMergesForInsertion(rowMerges, 'row', 2, 2), rowMerges)
  assert.deepEqual(migrateTableMergesForDeletion(rowMerges, 'row', 1, 2), [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
    rowMerges[1]
  ])

  const columnMerges = [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
    { row: 0, column: 4, rowSpan: 2, columnSpan: 2 }
  ]
  assert.deepEqual(migrateTableMergesForInsertion(columnMerges, 'column', 2, 2), columnMerges)
  assert.deepEqual(migrateTableMergesForDeletion(columnMerges, 'column', 1, 2), [
    { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
    columnMerges[1]
  ])
})

test('detects persisted merge overlap even when the current view clips it to one cell', () => {
  const merges = [{ row: 1, column: 1, rowSpan: 2, columnSpan: 2 }]
  const selection = { row: 1, rowEnd: 1, column: 0, columnEnd: 1 }

  assert.deepEqual(tableMergesIntersectingSelection(merges, selection), merges)
  assert.equal(hasTableMergeSelectionConflict(merges, selection), true)
  assert.equal(hasTableMergeSelectionConflict(merges, {
    row: 0,
    rowEnd: 3,
    column: 0,
    columnEnd: 3
  }), false)
})

test('normalizes edge ports against document defaults', () => {
  assert.deepEqual(normalizeEdge({ width: .01, startMarker: 'invalid', endMarker: 'circle', anchorMode: 'invalid' }, {
    color: '#112233', width: 3, dash: true, startMarker: 'square', endMarker: 'arrow', anchorMode: 'center'
  }), {
    width: .1,
    startMarker: 'square',
    endMarker: 'circle',
    anchorMode: 'center',
    color: '#112233',
    dash: true
  })
})

test('keeps catalog and model implementation outside App.vue', () => {
  assert.match(appSource, /from '\.\/config\/componentCatalog'/)
  assert.match(appSource, /from '\.\/models\/editorModel'/)
  assert.doesNotMatch(appSource, /const COMPONENT_GROUPS\s*=/)
  assert.doesNotMatch(appSource, /function normalizeNode\s*\(/)
  assert.doesNotMatch(appSource, /function normalizeTableModel\s*\(/)
})
