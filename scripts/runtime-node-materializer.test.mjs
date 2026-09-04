import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MAX_RUNTIME_CHART_BARS,
  hasEnabledRuntimeBinding,
  hasConfiguredTableContentBinding,
  hasResolvedTableContentBinding,
  materializeRuntimeNode,
  runtimeChartPercentages,
  runtimeColor
} from '../src/utils/runtimeNodeMaterializer.js'
import { sourceBindingRuntimeKey } from '../src/utils/jsonPathBinding.js'
import { runtimeKeySignature } from '../src/utils/runtimeKey.js'

function pointGetter(values) {
  return pointId => values.get(pointId)
}

test('materializes common runtime parameters without mutating the document node', () => {
  const node = {
    type: 'rect',
    fill: '#ffffff',
    stroke: '#111111',
    opacity: 1,
    text: '静态文字',
    visible: true,
    dataBindings: [
      { target: 'fill', pointId: 'state', enabled: true },
      { target: 'stroke', pointId: 'invalid-color', enabled: true },
      { target: 'opacity', pointId: 'opacity', enabled: true },
      { target: 'text', pointId: 'label', enabled: true },
      { target: 'visible', pointId: 'visible', enabled: true }
    ]
  }
  const before = structuredClone(node)
  const effective = materializeRuntimeNode(node, pointGetter(new Map([
    ['state', 'warning'],
    ['invalid-color', 'not-a-css-color'],
    ['opacity', 0.35],
    ['label', '动态文字'],
    ['visible', false]
  ])))

  assert.notStrictEqual(effective, node)
  assert.equal(effective.fill, '#f59e0b')
  assert.equal(effective.stroke, '#111111')
  assert.equal(effective.opacity, 0.35)
  assert.equal(effective.text, '动态文字')
  assert.equal(effective.visible, false)
  assert.deepEqual(node, before)
})

test('materializes animation controls only for animation components', () => {
  const fan = {
    type: 'rotatingFan',
    animation: 'flow',
    animationPaused: false,
    animationDuration: 1.5,
    dataBindings: [
      { target: 'animationPlaying', pointId: 'playing', enabled: true },
      { target: 'animationDuration', pointId: 'duration', enabled: true }
    ]
  }
  const effectiveFan = materializeRuntimeNode(fan, pointGetter(new Map([
    ['playing', false],
    ['duration', 2.5]
  ])))
  assert.equal(effectiveFan.animationPaused, true)
  assert.equal(effectiveFan.animationDuration, 2.5)

  const rectangle = {
    type: 'rect',
    animation: 'float',
    animationPaused: false,
    animationDuration: 1.5,
    dataBindings: [
      { target: 'animationPlaying', pointId: 'playing', enabled: true },
      { target: 'animationDuration', pointId: 'duration', enabled: true }
    ]
  }
  assert.strictEqual(materializeRuntimeNode(rectangle, () => false), rectangle)
})

test('visibility binding falls back to the static component state when data is unavailable', () => {
  const legacyNode = {
    type: 'rect',
    dataBindings: [{ target: 'visible', pointId: 'missing' }]
  }
  const hiddenNode = {
    type: 'rect',
    visible: false,
    dataBindings: [{ target: 'visible', pointId: 'missing' }]
  }

  assert.equal(materializeRuntimeNode(legacyNode, () => undefined).visible, true)
  assert.equal(materializeRuntimeNode(hiddenNode, () => undefined).visible, false)
})

test('time value binding overrides every renderer while missing data restores the editable static time', () => {
  const node = {
    type: 'time',
    value: '10:00:00',
    defaultValue: '09:30:00',
    timeUseServer: true,
    timeRunning: true,
    dataBindings: [{ target: 'value', pointId: 'clock.value', enabled: true }]
  }
  const before = structuredClone(node)
  const effective = materializeRuntimeNode(node, pointGetter(new Map([['clock.value', '12:45:30']])))

  assert.equal(effective.value, '12:45:30')
  assert.equal(effective.defaultValue, '12:45:30')
  assert.equal(effective.timeUseServer, false)
  assert.equal(effective.timeRunning, false)
  assert.deepEqual(node, before)
  const fallback = materializeRuntimeNode(node, () => undefined)
  assert.equal(fallback.value, '09:30:00')
  assert.equal(fallback.defaultValue, '09:30:00')
  assert.equal(fallback.timeUseServer, false)
  assert.equal(fallback.timeRunning, false)
  assert.deepEqual(node, before)
})

test('materializes source and legacy bindings independently when their display keys collide', () => {
  const sourceKey = sourceBindingRuntimeKey('collision-source', '$.label')
  const legacyKey = String(sourceKey)
  const node = {
    type: 'rect',
    fill: '#ffffff',
    text: '静态文字',
    dataBindings: [
      { target: 'text', sourceId: 'collision-source', jsonPath: '$.label', enabled: true },
      { target: 'fill', pointId: legacyKey, enabled: true }
    ]
  }
  const effective = materializeRuntimeNode(node, pointGetter(new Map([
    [sourceKey, '源数据文字'],
    [legacyKey, 'warning']
  ])))

  assert.equal(effective.text, '源数据文字')
  assert.equal(effective.fill, '#f59e0b')
})

test('materializes a built-in effect body color without mutating its document style', () => {
  const node = {
    type: 'flowPipe',
    visualPrimaryColor: '#16b89a',
    dataBindings: [{ target: 'visualPrimaryColor', pointId: 'pipe.state', enabled: true }]
  }
  const before = structuredClone(node)
  const effective = materializeRuntimeNode(node, pointGetter(new Map([['pipe.state', 'alarm']])))

  assert.equal(effective.visualPrimaryColor, '#ef4444')
  assert.deepEqual(node, before)
})

test('maps documented status values and rejects arbitrary English color strings', () => {
  assert.equal(runtimeColor('alarm', '#000'), '#ef4444')
  assert.equal(runtimeColor('ERROR', '#000'), '#ef4444')
  assert.equal(runtimeColor('normal', '#000'), '#16a085')
  assert.equal(runtimeColor('run', '#000'), '#16a085')
  assert.equal(runtimeColor('good', '#000'), '#16a085')
  assert.equal(runtimeColor('online', '#000'), '#16a085')
  assert.equal(runtimeColor('offline', '#000'), '#9ca3af')
  assert.equal(runtimeColor('totallyUnknownWord', '#123456'), '#123456')
  assert.equal(runtimeColor('rgb(1, 2, 3)', '#000'), 'rgb(1, 2, 3)')
})

test('adapts a runtime dataset to the existing table renderer shape', () => {
  const node = {
    type: 'table',
    tableHeaders: ['旧列'],
    tableCells: [['旧值']],
    tableRows: 1,
    tableColumns: 1,
    tableMerges: [{ row: 0, column: 0, rowSpan: 2, columnSpan: 1 }],
    tableColumnWidths: [1],
    tableColumnWidthsPx: [160],
    tableRowHeights: [32],
    dataBindings: [{ target: 'tableData', pointId: 'orders', enabled: true }]
  }
  const source = {
    columns: [{ key: 'name', title: '设备' }, { key: 'state', title: '状态' }],
    rows: [{ name: '风机 A', state: '运行' }, { name: '风机 B', state: { text: '停止' } }]
  }
  const effective = materializeRuntimeNode(node, () => source)

  assert.deepEqual(effective.tableHeaders, ['设备', '状态'])
  assert.deepEqual(effective.tableCells, [['风机 A', '运行'], ['风机 B', '{"text":"停止"}']])
  assert.equal(effective.tableRows, 2)
  assert.equal(effective.tableColumns, 2)
  assert.strictEqual(effective.tableMerges, node.tableMerges)
  assert.deepEqual(node.tableHeaders, ['旧列'])
  assert.deepEqual(source.rows[1].state, { text: '停止' })
})

test('detects resolved table content even when the interface value equals the static value', () => {
  const titleNode = {
    type: 'table',
    tableTitle: '相同标题',
    dataBindings: [{ target: 'tableTitle', pointId: 'table.title', enabled: true }]
  }
  assert.equal(hasConfiguredTableContentBinding(titleNode), true)
  assert.equal(hasResolvedTableContentBinding(titleNode, () => '相同标题'), true)
  assert.equal(hasResolvedTableContentBinding(titleNode, () => undefined), false)

  const styleOnlyNode = {
    type: 'table',
    tableRowFill: '#ffffff',
    dataBindings: [{ target: 'tableRowFill', pointId: 'table.fill', enabled: true }]
  }
  assert.equal(hasConfiguredTableContentBinding(styleOnlyNode), false)
  assert.equal(hasResolvedTableContentBinding(styleOnlyNode, () => '#ffffff'), false)
})

test('maps current and legacy table color bindings to renderer fields and restores static colors', () => {
  const currentNode = {
    type: 'table',
    tableRowFill: '#f8fafc',
    tableAltRowFill: '#f8fafc',
    tableBorderColor: '#94a3b8',
    dataBindings: [
      { target: 'tableRowFill', pointId: 'table.rows', enabled: true },
      { target: 'tableBorderColor', pointId: 'table.border', enabled: true }
    ]
  }
  const currentBefore = structuredClone(currentNode)
  const currentEffective = materializeRuntimeNode(currentNode, pointGetter(new Map([
    ['table.rows', 'warning'],
    ['table.border', '#123abc']
  ])))

  assert.equal(currentEffective.tableRowFill, '#f59e0b')
  assert.equal(currentEffective.tableAltRowFill, '#f59e0b')
  assert.equal(currentEffective.tableBorderColor, '#123abc')
  assert.deepEqual(currentNode, currentBefore)
  const restoredCurrent = materializeRuntimeNode(currentNode, () => undefined)
  assert.equal(restoredCurrent.tableRowFill, '#f8fafc')
  assert.equal(restoredCurrent.tableAltRowFill, '#f8fafc')
  assert.equal(restoredCurrent.tableBorderColor, '#94a3b8')

  const disabledCurrentNode = structuredClone(currentNode)
  disabledCurrentNode.dataBindings.forEach(binding => { binding.enabled = false })
  assert.strictEqual(materializeRuntimeNode(disabledCurrentNode, () => 'alarm'), disabledCurrentNode)
  assert.equal(disabledCurrentNode.tableRowFill, '#f8fafc')
  assert.equal(disabledCurrentNode.tableAltRowFill, '#f8fafc')
  assert.equal(disabledCurrentNode.tableBorderColor, '#94a3b8')

  const legacyNode = {
    type: 'table',
    fill: '#ffffff',
    stroke: '#475569',
    tableRowFill: '#f1f5f9',
    tableAltRowFill: '#f1f5f9',
    tableBorderColor: '#64748b',
    dataBindings: [
      { target: 'fill', pointId: 'legacy.fill', enabled: true },
      { target: 'stroke', pointId: 'legacy.stroke', enabled: true }
    ]
  }
  const legacyBefore = structuredClone(legacyNode)
  const legacyEffective = materializeRuntimeNode(legacyNode, pointGetter(new Map([
    ['legacy.fill', 'alarm'],
    ['legacy.stroke', '#abcdef']
  ])))

  assert.equal(legacyEffective.tableRowFill, '#ef4444')
  assert.equal(legacyEffective.tableAltRowFill, '#ef4444')
  assert.equal(legacyEffective.tableBorderColor, '#abcdef')
  assert.equal(legacyEffective.fill, '#ffffff')
  assert.equal(legacyEffective.stroke, '#475569')
  assert.deepEqual(legacyNode, legacyBefore)

  const restoredLegacy = materializeRuntimeNode(legacyNode, () => undefined)
  assert.equal(restoredLegacy.tableRowFill, '#f1f5f9')
  assert.equal(restoredLegacy.tableAltRowFill, '#f1f5f9')
  assert.equal(restoredLegacy.tableBorderColor, '#64748b')

  const disabledLegacyNode = structuredClone(legacyNode)
  disabledLegacyNode.dataBindings.forEach(binding => { binding.enabled = false })
  assert.strictEqual(materializeRuntimeNode(disabledLegacyNode, () => 'warning'), disabledLegacyNode)
})

test('formats table cells with fixed structural and text budgets without JSON.stringify', () => {
  const cyclic = { state: '运行' }
  cyclic.self = cyclic
  const throwing = { label: '可用字段' }
  Object.defineProperty(throwing, 'failed', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  const longText = 'x'.repeat(100_000)
  const node = {
    type: 'table',
    tableHeaders: ['静态列'],
    tableCells: [['静态值']],
    dataBindings: [{ target: 'tableData', pointId: 'runtime.table', enabled: true }]
  }

  let stringifyCalls = 0
  const originalStringify = JSON.stringify
  JSON.stringify = () => {
    stringifyCalls += 1
    throw new Error('table cells must not be serialized without a budget')
  }
  let effective
  try {
    effective = materializeRuntimeNode(node, () => [
      [{ text: '停止' }],
      [longText],
      [cyclic],
      [throwing]
    ])
  } finally {
    JSON.stringify = originalStringify
  }

  assert.equal(stringifyCalls, 0)
  assert.equal(effective.tableCells[0][0], '{"text":"停止"}')
  assert.ok(effective.tableCells[1][0].length <= 256)
  assert.match(effective.tableCells[1][0], /\.\.\.$/)
  assert.match(effective.tableCells[2][0], /"self":"\[Circular\]"/)
  assert.match(effective.tableCells[3][0], /"failed":"\[Thrown\]"/)
})

test('materializes component-specific values and chart percentages', () => {
  const checkbox = materializeRuntimeNode({
    type: 'checkbox',
    checked: false,
    dataBindings: [{ target: 'checked', pointId: 'checked' }]
  }, () => 'on')
  const input = materializeRuntimeNode({
    type: 'input',
    value: 'static',
    dataBindings: [{ target: 'value', pointId: 'value' }]
  }, () => 42)
  const progress = materializeRuntimeNode({
    type: 'progress',
    progressValue: 10,
    dataBindings: [{ target: 'progressValue', pointId: 'progress' }]
  }, () => 73.5)
  const chart = materializeRuntimeNode({
    type: 'barChart',
    chartTitle: '静态标题',
    chartSeriesName: '静态系列',
    chartLabels: ['旧标签'],
    chartData: [],
    chartColor: '#16b89a',
    chartShowLegend: true,
    chartShowTooltip: true,
    chartShowGrid: true,
    dataBindings: [
      { target: 'chartTitle', pointId: 'title' },
      { target: 'chartSeriesName', pointId: 'seriesName' },
      { target: 'chartLabels', pointId: 'labels' },
      { target: 'chartData', pointId: 'series' },
      { target: 'chartColor', pointId: 'color' },
      { target: 'chartShowLegend', pointId: 'legend' },
      { target: 'chartShowTooltip', pointId: 'tooltip' },
      { target: 'chartShowGrid', pointId: 'grid' }
    ]
  }, pointId => ({
    title: '运行标题',
    seriesName: '运行系列',
    labels: ['A', 'B', 'C'],
    series: [10, 20, 5],
    color: 'warning',
    legend: false,
    tooltip: false,
    grid: false
  })[pointId])

  assert.equal(checkbox.checked, true)
  assert.equal(input.value, '42')
  assert.equal(progress.progressValue, 73.5)
  assert.equal(chart.chartTitle, '运行标题')
  assert.equal(chart.chartSeriesName, '运行系列')
  assert.deepEqual(chart.chartLabels, ['A', 'B', 'C'])
  assert.equal(chart.chartColor, '#f59e0b')
  assert.equal(chart.chartShowLegend, false)
  assert.equal(chart.chartShowTooltip, false)
  assert.equal(chart.chartShowGrid, false)
  assert.deepEqual(runtimeChartPercentages(chart), [50, 100, 25])
})

test('materializes each chart series binding independently without mutating static series', () => {
  const node = {
    type: 'lineChart',
    chartSeriesName: '系列 1',
    chartColor: '#16b89a',
    chartData: [10, 20],
    chartSeries: [
      { name: '系列 1', color: '#16b89a', data: [10, 20] },
      { name: '系列 2', color: '#168eea', data: [30, 40] }
    ],
    dataBindings: [
      { target: 'chartSeries.0.name', pointId: 'series0-name' },
      { target: 'chartSeries.0.data', pointId: 'series0-data' },
      { target: 'chartSeries.1.name', pointId: 'series1-name' },
      { target: 'chartSeries.1.color', pointId: 'series1-color' },
      { target: 'chartSeries.1.data', pointId: 'series1-data' }
    ]
  }
  const before = structuredClone(node)
  const effective = materializeRuntimeNode(node, pointId => ({
    'series0-name': '运行系列 1',
    'series0-data': [11, 22],
    'series1-name': '运行系列 2',
    'series1-color': 'warning',
    'series1-data': [33, 44]
  })[pointId])

  assert.deepEqual(node, before)
  assert.equal(effective.chartSeriesName, '运行系列 1')
  assert.deepEqual(effective.chartData, {
    columns: [{ key: 'value', title: '值' }],
    rows: [{ value: 11 }, { value: 22 }]
  })
  assert.equal(effective.chartSeries[0].name, '运行系列 1')
  assert.deepEqual(effective.chartSeries[0].data, effective.chartData)
  assert.equal(effective.chartSeries[1].name, '运行系列 2')
  assert.equal(effective.chartSeries[1].color, '#f59e0b')
  assert.deepEqual(effective.chartSeries[1].data, {
    columns: [{ key: 'value', title: '值' }],
    rows: [{ value: 33 }, { value: 44 }]
  })
  assert.notStrictEqual(effective.chartSeries, node.chartSeries)
  assert.notStrictEqual(effective.chartSeries[1], node.chartSeries[1])
})

test('materializes signal colors and lamp opacity without mutating the document palette', () => {
  const node = {
    type: 'signalLight',
    signalColorCount: 4,
    signalColors: ['#21c58e', '#ef5350', '#ffc440', '#168eea'],
    signalOpacity: 1,
    dataBindings: [
      { target: 'signalColors.0', sourceId: 'signal-source', jsonPath: '$.states.run' },
      { target: 'signalColors.1', sourceId: 'signal-source', jsonPath: '$.states.invalid' },
      { target: 'signalColors.3', sourceId: 'signal-source', jsonPath: '$.states.alarm' },
      { target: 'signalOpacity', sourceId: 'signal-source', jsonPath: '$.opacity' }
    ]
  }
  const before = structuredClone(node)
  const effective = materializeRuntimeNode(node, pointGetter(new Map([
    [sourceBindingRuntimeKey('signal-source', '$.states.run'), 'warning'],
    [sourceBindingRuntimeKey('signal-source', '$.states.invalid'), 'not-a-color'],
    [sourceBindingRuntimeKey('signal-source', '$.states.alarm'), '#123abc'],
    [sourceBindingRuntimeKey('signal-source', '$.opacity'), 0.35]
  ])))

  assert.notStrictEqual(effective.signalColors, node.signalColors)
  assert.deepEqual(effective.signalColors, ['#f59e0b', '#ef5350', '#ffc440', '#123abc'])
  assert.equal(effective.signalOpacity, 0.35)
  assert.deepEqual(node, before)
})

test('bounds signal palette cloning for hostile imported arrays', () => {
  const signalColors = Array.from({ length: 100_000 }, (_, index) => `color-${index}`)
  const node = {
    type: 'signalLight',
    signalColorCount: 8,
    signalColors,
    dataBindings: [{ target: 'signalColors.7', pointId: 'signal.last' }]
  }
  const effective = materializeRuntimeNode(node, pointGetter(new Map([
    ['signal.last', 'warning']
  ])))

  assert.equal(effective.signalColors.length, 8)
  assert.equal(effective.signalColors[7], '#f59e0b')
  assert.equal(node.signalColors.length, 100_000)
  assert.strictEqual(node.signalColors, signalColors)
})

test('keeps a legacy single signal color when runtime data is unavailable', () => {
  const node = {
    type: 'signalLight',
    signalColor: '#123456',
    signalColorCount: 1,
    dataBindings: [{ target: 'signalColors.0', pointId: 'signal.offline' }]
  }
  const effective = materializeRuntimeNode(node, () => undefined)

  assert.deepEqual(effective.signalColors, ['#123456'])
  assert.equal(node.signalColors, undefined)
})

test('keeps chart extraction within a fixed budget for 100k-row and wide arrays', () => {
  const wideRowSource = new Array(100_000)
  for (let index = 0; index < MAX_RUNTIME_CHART_BARS - 1; index += 1) wideRowSource[index] = '无效'
  wideRowSource[MAX_RUNTIME_CHART_BARS - 1] = 40
  let cellReads = 0
  let cellMembershipChecks = 0
  const wideRow = new Proxy(wideRowSource, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) cellReads += 1
      return Reflect.get(target, property, receiver)
    },
    has(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) cellMembershipChecks += 1
      return Reflect.has(target, property)
    }
  })

  const rowSource = new Array(100_000)
  for (let index = 0; index < MAX_RUNTIME_CHART_BARS; index += 1) rowSource[index] = wideRow
  let rowReads = 0
  let rowMembershipChecks = 0
  const rows = new Proxy(rowSource, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) rowReads += 1
      return Reflect.get(target, property, receiver)
    },
    has(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) rowMembershipChecks += 1
      return Reflect.has(target, property)
    }
  })

  const percentages = runtimeChartPercentages({ chartData: rows }, Number.POSITIVE_INFINITY)
  assert.deepEqual(percentages, Array(MAX_RUNTIME_CHART_BARS).fill(100))
  assert.ok(rowReads <= MAX_RUNTIME_CHART_BARS, `read ${rowReads} source rows`)
  assert.ok(rowMembershipChecks <= MAX_RUNTIME_CHART_BARS, `checked ${rowMembershipChecks} source rows`)
  assert.ok(cellReads <= MAX_RUNTIME_CHART_BARS ** 2, `read ${cellReads} source cells`)
  assert.ok(cellMembershipChecks <= MAX_RUNTIME_CHART_BARS ** 2, `checked ${cellMembershipChecks} source cells`)
  assert.equal(rowSource.length, 100_000)
  assert.equal(wideRowSource.length, 100_000)
})

test('returns the original node when no parameter binding exists', () => {
  const node = { type: 'rect', fill: '#fff', dataBindings: [] }
  assert.strictEqual(materializeRuntimeNode(node, () => 'warning'), node)
})

test('recognizes source JSONPath bindings when suppressing legacy visual fallbacks', () => {
  const node = {
    type: 'rect',
    dataBindings: [{
      target: 'text',
      sourceId: 'source-http-line',
      jsonPath: '$.device.name',
      enabled: true
    }]
  }

  assert.equal(hasEnabledRuntimeBinding(node, 'text'), true)
  assert.equal(hasEnabledRuntimeBinding(node, 'fill'), false)
  node.dataBindings[0].enabled = false
  assert.equal(hasEnabledRuntimeBinding(node, 'text'), false)
})

test('NodeVisual initializes the table layout signature without shadowing the effective node', async () => {
  const source = await readFile(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
  const signatureBlock = source.match(/const tableLayoutSignature = computed\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1] || ''

  assert.match(signatureBlock, /const type = node\.value\.type[\s\S]*?if \(type !== 'table'\) return type[\s\S]*?const visual = visualNode\.value/)
  assert.doesNotMatch(signatureBlock, /if \(node\.value[^\n]+\)\s*return[^\n]+\n\s*const node\s*=/)
})

test('NodeVisual preserves branded source keys when reading parameter bindings', async () => {
  const source = await readFile(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
  const lookupBlock = source.match(/function runtimePointValue\(pointId\) \{([\s\S]*?)\n\}/)?.[1] || ''
  const sourceKey = sourceBindingRuntimeKey('source-a', '$.value')

  assert.match(source, /import \{ normalizeRuntimeKey, runtimeKeySignature \} from '\.\.\/utils\/runtimeKey\.js'/)
  assert.match(lookupBlock, /runtimePointBindings\?\.get\(normalizeRuntimeKey\(pointId\)\)\?\.value\.value/)
  assert.doesNotMatch(lookupBlock, /String\(pointId/)
  assert.match(source, /runtimeKeySignature\(bindingPointIds\(props\.node\)\)/)
  assert.doesNotMatch(source, /bindingPointIds\(props\.node\)\.join/)
  assert.match(source, /runtimePointStore\.subscribe\(pointId, value =>/)
  assert.match(source, /let runtimePointBindings = null/)
  assert.match(source, /if \(!nextPointIds\.length && !runtimePointBindings\?\.size\) return/)
  assert.match(source, /unsubscribeRuntimeBinding = nextStore\.subscribe\(nextKey, value =>/)
  assert.doesNotMatch(source, /runtimePointStore\.acquire|runtimeBindingStore\?\.release/)
  assert.notEqual(runtimeKeySignature([sourceKey]), runtimeKeySignature([String(sourceKey)]))
})

test('NodeVisual does not restart an active signal clock for each runtime palette update', async () => {
  const source = await readFile(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
  const syncBlock = source.match(/function syncSignalClock\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  const signalWatch = source.match(/if \(props\.node\.type === 'signalLight'\) \{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(syncBlock, /externalTimestamp = props\.signalAnimationTimestamp != null[\s\S]*?if \(!signalClock\) \{[\s\S]*?signalClock = acquireVisualClock\(SIGNAL_CLOCK_FPS\)[\s\S]*?\}/)
  assert.doesNotMatch(syncBlock, /signalClockStartedAt/)
  assert.match(signalWatch, /source\.signalColors\.slice\(0, MAX_SIGNAL_COLORS\)\.join\(','\)/)
  assert.doesNotMatch(signalWatch, /return \[/)
})
