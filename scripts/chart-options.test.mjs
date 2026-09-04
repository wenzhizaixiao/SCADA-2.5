import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHART_TYPES,
  DEFAULT_CHART_TYPE,
  applyChartOptionToNode,
  chartColorPalette,
  chartRowsFromNode,
  chartNodeDataFromOption,
  chartOptionFromNode,
  createDefaultChartOption,
  isChartType,
  normalizeChartType
} from '../src/utils/chartOptions.js'

const expectedSeriesTypes = {
  lineChart: 'line',
  barChart: 'bar',
  pieChart: 'pie',
  scatterChart: 'scatter',
  radarChart: 'radar'
}

test('creates independent default options for all five chart component types', () => {
  assert.deepEqual(CHART_TYPES, ['lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart'])
  for (const type of CHART_TYPES) {
    const first = createDefaultChartOption(type)
    const second = createDefaultChartOption(type)
    assert.notStrictEqual(first, second)
    assert.notStrictEqual(first.series, second.series)
    assert.equal(first.series[0].type, expectedSeriesTypes[type])
  }
})

test('normalizes ECharts series names and invalid values without introducing a sixth chart type', () => {
  assert.equal(normalizeChartType('line'), 'lineChart')
  assert.equal(normalizeChartType('radar'), 'radarChart')
  assert.equal(normalizeChartType('gauge'), DEFAULT_CHART_TYPE)
  assert.equal(isChartType('scatterChart'), true)
  assert.equal(isChartType('chart'), false)
})

test('maps line and bar node data into category axes without mutating the node', () => {
  const node = {
    type: 'lineChart',
    chartTitle: '月度产量',
    chartSeriesName: '产量',
    chartLabels: ['甲', '乙', '丙'],
    chartData: [12, 34, 18],
    chartColor: '#123456',
    chartShowLegend: false,
    chartShowTooltip: false,
    chartShowGrid: false,
    chartSmooth: true,
    chartAreaFill: true,
    chartSymbolSize: 14,
    fill: '#f0f4f8',
    backgroundOpacity: 0.5
  }
  const before = structuredClone(node)
  const option = chartOptionFromNode(node)

  assert.equal(option.series[0].type, 'line')
  assert.deepEqual(option.series[0].data, [12, 34, 18])
  assert.deepEqual(option.xAxis.data, ['甲', '乙', '丙'])
  assert.equal(option.color[0], '#123456')
  assert.deepEqual(option.title, { show: true, text: '月度产量', left: 'center' })
  assert.equal(option.series[0].name, '产量')
  assert.equal(option.series[0].smooth, true)
  assert.deepEqual(option.series[0].areaStyle, { opacity: 0.18 })
  assert.equal(option.series[0].symbolSize, 14)
  assert.equal(option.legend.show, false)
  assert.equal(option.tooltip.show, false)
  assert.equal(option.yAxis.splitLine.show, false)
  assert.equal(option.backgroundColor, 'transparent')
  assert.deepEqual(node, before)

  assert.equal(chartOptionFromNode({ type: 'chart', chartData: [1] }).series[0].type, 'bar')
  assert.equal(chartOptionFromNode({ type: 'lineChart', chartOption: {} }).series[0].type, 'line')
  assert.equal(chartOptionFromNode({ type: 'echartsCode', chartOption: {} }).series[0].type, 'bar')
})

test('maps pie, scatter and radar nodes to their native ECharts data shapes', () => {
  const pie = chartOptionFromNode({
    type: 'pieChart',
    chartData: [{ name: '运行', value: 8 }, { name: '停止', value: 2 }]
  })
  assert.deepEqual(pie.series[0].data, [
    { name: '运行', value: 8 },
    { name: '停止', value: 2 }
  ])

  const scatter = chartOptionFromNode({
    type: 'scatterChart',
    chartLabels: ['甲', '乙', '丙'],
    chartData: [[1, 9], { x: 2, y: 7 }, 5]
  })
  assert.deepEqual(scatter.series[0].data, [
    { name: '甲', value: [1, 9] },
    { name: '乙', value: [2, 7] },
    { name: '丙', value: [3, 5] }
  ])

  const radar = chartOptionFromNode({
    type: 'radarChart',
    chartLabels: ['压力', '温度'],
    chartData: [80, 45],
    chartSeriesName: '设备 A',
    chartRadarMax: 250
  })
  assert.deepEqual(radar.radar.indicator, [{ name: '压力', max: 250 }, { name: '温度', max: 250 }])
  assert.deepEqual(radar.series[0].data.map(item => ({ name: item.name, value: item.value })), [
    { name: '设备 A', value: [80, 45] }
  ])
})

test('renders multiple editable series with their own colors for every multi-series chart', () => {
  const sharedSeries = [
    { name: '设备 A', color: '#e11d48', data: [12, 24] },
    { name: '设备 B', color: '#0284c7', data: [18, 30] }
  ]

  for (const type of ['lineChart', 'barChart']) {
    const option = chartOptionFromNode({
      type,
      chartLabels: ['一月', '二月'],
      chartSeries: sharedSeries
    })
    assert.deepEqual(option.series.map(series => series.name), ['设备 A', '设备 B'])
    assert.deepEqual(option.series.map(series => series.data), [[12, 24], [18, 30]])
    assert.deepEqual(option.series.map(series => series.itemStyle.color), ['#e11d48', '#0284c7'])
    if (type === 'lineChart') {
      assert.deepEqual(option.series.map(series => series.lineStyle.color), ['#e11d48', '#0284c7'])
    }
  }

  const scatter = chartOptionFromNode({
    type: 'scatterChart',
    chartLabels: ['样本 1', '样本 2'],
    chartSeries: [
      { name: '批次 A', color: '#7c3aed', data: [[1, 8], [2, 13]] },
      { name: '批次 B', color: '#ea580c', data: [[1, 5], [2, 11]] }
    ]
  })
  assert.equal(scatter.series.length, 2)
  assert.deepEqual(scatter.series[1].data, [
    { name: '样本 1', value: [1, 5] },
    { name: '样本 2', value: [2, 11] }
  ])
  assert.equal(scatter.series[0].itemStyle.color, '#7c3aed')
  assert.equal(scatter.series[1].itemStyle.color, '#ea580c')

  const radar = chartOptionFromNode({
    type: 'radarChart',
    chartLabels: ['压力', '温度'],
    chartRadarMax: 100,
    chartSeries: sharedSeries
  })
  assert.equal(radar.series.length, 1)
  assert.deepEqual(radar.series[0].data.map(item => ({
    name: item.name,
    value: item.value,
    lineColor: item.lineStyle.color,
    itemColor: item.itemStyle.color
  })), [
    { name: '设备 A', value: [12, 24], lineColor: '#e11d48', itemColor: '#e11d48' },
    { name: '设备 B', value: [18, 30], lineColor: '#0284c7', itemColor: '#0284c7' }
  ])
})

test('applies editable pie slice colors to the actual sectors', () => {
  const option = chartOptionFromNode({
    type: 'pieChart',
    chartData: [{ name: '运行', value: 8 }, { name: '停止', value: 2 }],
    chartSliceColors: ['#22c55e', '#ef4444']
  })
  assert.deepEqual(option.series[0].data, [
    { name: '运行', value: 8, itemStyle: { color: '#22c55e' } },
    { name: '停止', value: 2, itemStyle: { color: '#ef4444' } }
  ])

  const runtimeColor = chartOptionFromNode({
    type: 'pieChart',
    chartColor: '#a855f7',
    chartData: [8, 2],
    chartSliceColors: ['#22c55e', '#ef4444']
  })
  assert.deepEqual(runtimeColor.series[0].data.map(item => item.itemStyle.color), ['#a855f7', '#ef4444'])
})

test('uses the same normalized rows for property editing and ECharts rendering', () => {
  const barNode = {
    type: 'barChart',
    chartLabels: ['计划', '实际'],
    chartData: [[2026, 35], { category: '实际', value: 70 }]
  }
  const barRows = chartRowsFromNode(barNode)
  assert.deepEqual(barRows, [
    { index: 0, sourceIndex: 0, label: '计划', value: 35 },
    { index: 1, sourceIndex: 1, label: '实际', value: 70 }
  ])
  const barOption = chartOptionFromNode(barNode)
  assert.deepEqual(barOption.xAxis.data, barRows.map(row => row.label))
  assert.deepEqual(barOption.series[0].data, barRows.map(row => row.value))

  const scatterNode = {
    type: 'scatterChart',
    chartData: [{ name: '样本 A', value: 9 }, { name: '样本 B', value: [4, 12] }]
  }
  const scatterRows = chartRowsFromNode(scatterNode)
  assert.deepEqual(scatterRows, [
    { index: 0, sourceIndex: 0, label: '样本 A', x: 1, y: 9 },
    { index: 1, sourceIndex: 1, label: '样本 B', x: 4, y: 12 }
  ])
  assert.deepEqual(
    chartOptionFromNode(scatterNode).series[0].data,
    scatterRows.map(row => ({ name: row.label, value: [row.x, row.y] }))
  )
})

test('keeps display rows linked to their original data indexes when invalid rows are skipped', () => {
  assert.deepEqual(chartRowsFromNode({
    type: 'barChart',
    chartData: [10, 'bad', 20],
    chartLabels: ['A', '无效', 'C']
  }), [
    { index: 0, sourceIndex: 0, label: 'A', value: 10 },
    { index: 1, sourceIndex: 2, label: 'C', value: 20 }
  ])
})

test('exposes the exact ECharts color order used by pie data markers', () => {
  assert.deepEqual(chartColorPalette({ chartColor: '#123456' }), [
    '#123456', '#168eea', '#16a085', '#f59e0b', '#ef5350', '#8b5cf6', '#3bb9df'
  ])
  assert.equal(chartColorPalette({ chartColor: '#168eea' }).filter(color => color === '#168eea').length, 1)
})

test('code charts prefer a stored custom option and return a defensive copy', () => {
  const custom = {
    tooltip: { trigger: 'item' },
    series: [{ type: 'pie', data: [{ name: 'A', value: 3 }] }]
  }
  const option = chartOptionFromNode({ type: 'echartsCode', chartOption: custom, chartData: [99] })
  assert.deepEqual(option, {
    ...custom,
    tooltip: { ...custom.tooltip, renderMode: 'richText' },
    backgroundColor: 'transparent'
  })
  assert.notStrictEqual(option, custom)
  assert.notStrictEqual(option.series, custom.series)
  option.series[0].data[0].value = 10
  assert.equal(custom.series[0].data[0].value, 3)
})

test('maps options back to editable node data and applies the option immutably', () => {
  const option = {
    color: ['#123456'],
    title: { text: '产量' },
    legend: { show: false },
    tooltip: { show: false },
    xAxis: { data: ['一号', '二号'] },
    yAxis: { splitLine: { show: false } },
    series: [{ type: 'bar', name: '系列 A', data: [3, { value: 7 }] }]
  }
  assert.deepEqual(chartNodeDataFromOption(option), {
    chartType: 'barChart',
    chartData: [3, 7],
    chartLabels: ['一号', '二号'],
    chartSeries: [{ name: '系列 A', color: '#123456', data: [3, 7] }],
    chartTitle: '产量',
    chartSeriesName: '系列 A',
    chartColor: '#123456',
    chartShowLegend: false,
    chartShowTooltip: false,
    chartShowGrid: false,
    chartSmooth: false,
    chartAreaFill: false,
    chartSymbolSize: 10
  })

  const node = { id: 'chart-1', type: 'barChart', chartData: [1] }
  const updated = applyChartOptionToNode(node, option)
  assert.notStrictEqual(updated, node)
  assert.deepEqual(updated.chartData, [3, 7])
  assert.notStrictEqual(updated.chartOption, option)
  assert.deepEqual(node.chartData, [1])
})

test('maps multiple ECharts series and sector colors back to editable node fields', () => {
  const bar = chartNodeDataFromOption({
    color: ['#dc2626', '#2563eb'],
    xAxis: { data: ['A', 'B'] },
    series: [
      { type: 'bar', name: '计划', data: [10, 20] },
      { type: 'bar', name: '实际', itemStyle: { color: '#16a34a' }, data: [12, 18] }
    ]
  })
  assert.deepEqual(bar.chartSeries, [
    { name: '计划', color: '#dc2626', data: [10, 20] },
    { name: '实际', color: '#16a34a', data: [12, 18] }
  ])
  assert.deepEqual(bar.chartData, [10, 20])

  const pie = chartNodeDataFromOption({
    color: ['#f97316', '#0ea5e9'],
    series: [{
      type: 'pie',
      data: [
        { name: '运行', value: 8, itemStyle: { color: '#22c55e' } },
        { name: '停止', value: 2 }
      ]
    }]
  })
  assert.deepEqual(pie.chartSliceColors, ['#22c55e', '#0ea5e9'])
})

test('rejects unsafe or non-serializable code chart option values', () => {
  assert.throws(
    () => chartOptionFromNode({ type: 'echartsCode', chartOption: { formatter() {} } }),
    /可序列化的静态数据/
  )
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => chartOptionFromNode({ type: 'echartsCode', chartOption: cyclic }), /循环引用/)
})

test('only code charts prioritize chartOption while the wrapper owns the component background', () => {
  const standard = chartOptionFromNode({
    type: 'barChart',
    chartData: [5],
    chartOption: { series: [{ type: 'pie', data: [99] }] }
  })
  assert.equal(standard.series[0].type, 'bar')
  assert.deepEqual(standard.series[0].data, [5])

  const code = chartOptionFromNode({
    type: 'echartsCode',
    chartOption: { series: [{ type: 'pie', data: [99] }] },
    fill: '#000000',
    backgroundOpacity: 0
  })
  assert.equal(code.series[0].type, 'pie')
  assert.equal(code.backgroundColor, 'transparent')
})

test('hardens custom tooltip and dangerous URL fields before ECharts receives them', () => {
  const option = chartOptionFromNode({
    type: 'echartsCode',
    chartOption: {
      tooltip: {
        renderMode: 'html',
        formatter: '<b>{b}</b>',
        extraCssText: 'background-image:url(javascript:alert(1))'
      },
      title: {
        text: '安全图表',
        link: 'javascript:alert(1)',
        sublink: 'https://example.test/details'
      },
      graphic: [{ type: 'image', style: { image: 'data:text/html,<script>alert(1)</script>' } }],
      series: [{ type: 'pie', symbol: 'image://vbscript:msgbox(1)', data: [1] }]
    }
  })

  assert.equal(option.tooltip.renderMode, 'richText')
  assert.equal(option.tooltip.formatter, '<b>{b}</b>')
  assert.equal(Object.hasOwn(option.tooltip, 'extraCssText'), false)
  assert.equal(Object.hasOwn(option.title, 'link'), false)
  assert.equal(option.title.sublink, 'https://example.test/details')
  assert.equal(Object.hasOwn(option.graphic[0].style, 'image'), false)
  assert.equal(Object.hasOwn(option.series[0], 'symbol'), false)

  const updated = applyChartOptionToNode({ id: 'chart-safe', type: 'echartsCode' }, {
    tooltip: { renderMode: 'html', extraCssText: 'position:fixed' },
    title: { link: 'file:///etc/passwd' },
    series: [{ type: 'bar', data: [1] }]
  })
  assert.deepEqual(updated.chartOption.tooltip, { renderMode: 'richText' })
  assert.equal(Object.hasOwn(updated.chartOption.title, 'link'), false)
})

test('only displays an explicit chart title and never uses the component library name as a title', () => {
  const fallback = chartOptionFromNode({
    type: 'lineChart',
    chartTitle: '',
    text: '折线图',
    color: '#334455',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'right'
  })
  assert.equal(fallback.title.show, false)
  assert.equal(fallback.title.text, '')

  const explicit = chartOptionFromNode({
    type: 'barChart',
    chartTitle: '专用标题',
    text: '兼容标题'
  })
  assert.equal(explicit.title.text, '专用标题')
})

test('code charts parse source when chartOption is empty and fall back visibly on invalid code', () => {
  const parsed = chartOptionFromNode({
    type: 'echartsCode',
    chartOption: {},
    echartsCode: `
      var option;
      option = { series: [{ type: 'line', data: [1, 2] }] };
      option && chart.setOption(option);
    `
  })
  assert.equal(parsed.series[0].type, 'line')
  assert.deepEqual(parsed.series[0].data, [1, 2])

  const fallback = chartOptionFromNode({
    type: 'echartsCode',
    chartOption: {},
    echartsCode: 'const option = { formatter: value => value };'
  })
  assert.equal(fallback.series[0].type, 'bar')
  assert.ok(fallback.series[0].data.length > 0)
})
