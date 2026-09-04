import { parseEChartsCode } from './echartsCodeParser.js'

export const CHART_TYPES = Object.freeze([
  'lineChart',
  'barChart',
  'pieChart',
  'scatterChart',
  'radarChart'
])

export const DEFAULT_CHART_TYPE = 'barChart'
export const MAX_EDITABLE_CHART_SERIES = 8

export const CHART_TYPE_LABELS = Object.freeze({
  lineChart: '折线图',
  barChart: '柱状图',
  pieChart: '饼图',
  scatterChart: '散点图',
  radarChart: '雷达图'
})

const SERIES_TYPE_TO_CHART_TYPE = Object.freeze({
  line: 'lineChart',
  bar: 'barChart',
  pie: 'pieChart',
  scatter: 'scatterChart',
  radar: 'radarChart'
})

const DEFAULT_COLORS = Object.freeze([
  '#168eea',
  '#16a085',
  '#f59e0b',
  '#ef5350',
  '#8b5cf6',
  '#3bb9df'
])
const DEFAULT_CATEGORY_LABELS = Object.freeze(['一月', '二月', '三月', '四月', '五月', '六月'])
const DEFAULT_VALUES = Object.freeze([42, 68, 55, 83, 64, 76])
const MAX_MAPPED_DATA_ITEMS = 2000
const MAX_OPTION_DEPTH = 64
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const URL_VALUE_KEYS = new Set(['backgroundimage', 'cursor', 'href', 'image', 'link', 'src', 'sublink', 'symbol', 'url'])
const BLOCKED_URL_SCHEMES = new Set(['blob', 'file', 'filesystem', 'javascript', 'vbscript'])
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(?:bmp|gif|jpe?g|png|webp)(?:;[^,]*)?,/i

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function cloneOptionValue(value, seen = new Map(), depth = 0) {
  if (depth > MAX_OPTION_DEPTH) throw new RangeError(`图表配置最多支持 ${MAX_OPTION_DEPTH} 层嵌套`)
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') throw new TypeError('图表配置只能包含可序列化的静态数据')
  if (seen.has(value)) throw new TypeError('图表配置不能包含循环引用')

  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    for (const item of value) result.push(cloneOptionValue(item, seen, depth + 1))
    seen.delete(value)
    return result
  }
  if (!plainRecord(value)) throw new TypeError('图表配置只能包含普通对象和数组')

  const result = {}
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new TypeError(`图表配置不允许属性 ${key}`)
    result[key] = cloneOptionValue(value[key], seen, depth + 1)
  }
  seen.delete(value)
  return result
}

function unwrappedUrlValue(value) {
  let candidate = String(value).trim()
  if (/^image:\/\//i.test(candidate)) candidate = candidate.slice('image://'.length).trim()
  const cssUrl = /^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/i.exec(candidate)
  return cssUrl ? cssUrl[2].trim() : candidate
}

function dangerousUrlValue(value) {
  if (typeof value !== 'string') return false
  const candidate = unwrappedUrlValue(value)
  const colon = candidate.indexOf(':')
  if (colon < 0) return false
  const scheme = candidate.slice(0, colon).replace(/[\u0000-\u0020]/g, '').toLowerCase()
  if (scheme === 'data') return !SAFE_DATA_IMAGE_PATTERN.test(candidate)
  return BLOCKED_URL_SCHEMES.has(scheme)
}

function hardenChartOption(option) {
  const visited = new WeakSet()

  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    for (const key of Object.keys(value)) {
      const normalizedKey = key.toLowerCase()
      if (URL_VALUE_KEYS.has(normalizedKey) && dangerousUrlValue(value[key])) {
        delete value[key]
        continue
      }
      const child = value[key]
      if (normalizedKey === 'tooltip' && plainRecord(child)) {
        delete child.extraCssText
        child.renderMode = 'richText'
      }
      visit(child)
    }
  }

  visit(option)
  if (plainRecord(option.tooltip)) {
    delete option.tooltip.extraCssText
    option.tooltip.renderMode = 'richText'
  } else {
    option.tooltip = { renderMode: 'richText' }
  }
  option.backgroundColor = 'transparent'
  return option
}

function safeChartOption(value) {
  return hardenChartOption(cloneOptionValue(value))
}

function commonCartesianOption() {
  return {
    color: [...DEFAULT_COLORS],
    title: { show: false, text: '', left: 'center' },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
    legend: { show: true, top: 2, right: 8 },
    grid: { left: 24, right: 20, top: 28, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: [...DEFAULT_CATEGORY_LABELS],
      axisLine: { lineStyle: { color: '#9aa5b1' } },
      axisLabel: { color: '#52606d' }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#e4e7eb' } },
      axisLabel: { color: '#52606d' }
    }
  }
}

const DEFAULT_OPTION_FACTORIES = Object.freeze({
  lineChart() {
    const option = commonCartesianOption()
    option.xAxis.boundaryGap = false
    option.series = [{
      name: '数值',
      type: 'line',
      smooth: true,
      showSymbol: true,
      symbolSize: 7,
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.12 },
      data: [...DEFAULT_VALUES]
    }]
    return option
  },
  barChart() {
    const option = commonCartesianOption()
    option.series = [{
      name: '数值',
      type: 'bar',
      barMaxWidth: 42,
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      data: [...DEFAULT_VALUES]
    }]
    return option
  },
  pieChart() {
    return {
      color: [...DEFAULT_COLORS],
      title: { show: false, text: '', left: 'center' },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { type: 'scroll', bottom: 4, left: 'center' },
      series: [{
        name: '占比',
        type: 'pie',
        radius: ['34%', '68%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        label: { formatter: '{b}: {d}%' },
        data: DEFAULT_VALUES.slice(0, 5).map((value, index) => ({
          name: DEFAULT_CATEGORY_LABELS[index],
          value
        }))
      }]
    }
  },
  scatterChart() {
    const option = commonCartesianOption()
    option.xAxis = {
      type: 'value',
      splitLine: { lineStyle: { color: '#e4e7eb' } },
      axisLabel: { color: '#52606d' }
    }
    option.series = [{
      name: '样本',
      type: 'scatter',
      symbolSize: 11,
      data: DEFAULT_VALUES.map((value, index) => [index + 1, value])
    }]
    return option
  },
  radarChart() {
    return {
      color: [...DEFAULT_COLORS],
      title: { show: false, text: '', left: 'center' },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
      legend: { bottom: 4 },
      radar: {
        center: ['50%', '48%'],
        radius: '62%',
        indicator: DEFAULT_CATEGORY_LABELS.slice(0, 5).map(name => ({ name, max: 100 })),
        splitArea: { areaStyle: { color: ['#ffffff', '#f4f7fa'] } }
      },
      series: [{
        name: '综合指标',
        type: 'radar',
        areaStyle: { opacity: 0.18 },
        data: [{ name: '当前值', value: DEFAULT_VALUES.slice(0, 5) }]
      }]
    }
  }
})

export function isChartType(value) {
  return CHART_TYPES.includes(String(value ?? ''))
}

export function normalizeChartType(value, fallback = DEFAULT_CHART_TYPE) {
  const type = String(value ?? '').trim()
  if (isChartType(type)) return type
  if (SERIES_TYPE_TO_CHART_TYPE[type]) return SERIES_TYPE_TO_CHART_TYPE[type]
  return isChartType(fallback) ? fallback : DEFAULT_CHART_TYPE
}

export function createDefaultChartOption(type = DEFAULT_CHART_TYPE) {
  return DEFAULT_OPTION_FACTORIES[normalizeChartType(type)]()
}

function configuredOption(node) {
  if (node?.type !== 'echartsCode') return null
  for (const key of ['chartOption', 'echartsOption', 'option']) {
    if (!plainRecord(node?.[key])) continue
    if (Object.keys(node[key]).length) return node[key]
  }
  const source = String(node?.echartsCode ?? '').trim()
  if (source) {
    try {
      return parseEChartsCode(source)
    } catch {
      // 属性面板负责展示精确解析错误；画布使用可见占位图，避免空白组件。
    }
  }
  return null
}

function sourceRows(node) {
  const source = node?.chartData
  const rows = Array.isArray(source?.rows) ? source.rows : Array.isArray(source) ? source : []
  return rows.slice(0, MAX_MAPPED_DATA_ITEMS)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function scalarRowValue(row) {
  if (Array.isArray(row)) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      const number = finiteNumber(row[index])
      if (number !== null) return number
    }
    return null
  }
  if (plainRecord(row)) {
    const preferred = finiteNumber(row.value)
    if (preferred !== null) return preferred
    for (const key of Object.keys(row)) {
      if (UNSAFE_KEYS.has(key)) continue
      const number = finiteNumber(row[key])
      if (number !== null) return number
    }
    return null
  }
  return finiteNumber(row)
}

function configuredLabels(node) {
  return Array.isArray(node?.chartLabels)
    ? node.chartLabels
    : Array.isArray(node?.xAxisData)
      ? node.xAxisData
      : []
}

function rowLabel(node, row, sourceIndex, fallbackIndex = sourceIndex) {
  const configured = configuredLabels(node)
  const explicit = configured[sourceIndex]
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) return String(explicit)
  if (plainRecord(row)) {
    const label = row.name ?? row.label ?? row.category
    if (label !== undefined && label !== null && String(label).trim()) return String(label)
  }
  if (Array.isArray(row)) {
    const label = row.find(candidate => typeof candidate === 'string' && candidate.trim() && finiteNumber(candidate) === null)
    if (label !== undefined) return String(label)
  }
  return DEFAULT_CATEGORY_LABELS[fallbackIndex] || `数据 ${fallbackIndex + 1}`
}

function scalarRows(node) {
  const rows = []
  for (const [sourceIndex, row] of sourceRows(node).entries()) {
    const value = scalarRowValue(row)
    if (value === null) continue
    rows.push({ sourceIndex, label: rowLabel(node, row, sourceIndex, rows.length), value })
  }
  if (rows.length) return rows
  const configured = Array.isArray(node?.chartLabels)
    ? node.chartLabels
    : Array.isArray(node?.xAxisData)
      ? node.xAxisData
      : []
  return DEFAULT_VALUES.map((value, index) => ({
    sourceIndex: index,
    label: configured[index] !== undefined && configured[index] !== null && String(configured[index]).trim()
      ? String(configured[index])
      : DEFAULT_CATEGORY_LABELS[index] || `数据 ${index + 1}`,
    value
  }))
}

function scatterRows(node) {
  const points = []
  for (const [sourceIndex, row] of sourceRows(node).entries()) {
    let x = null
    let y = null
    if (Array.isArray(row)) {
      x = finiteNumber(row[0])
      y = finiteNumber(row[1])
    } else if (plainRecord(row)) {
      const value = Array.isArray(row.value) ? row.value : null
      x = finiteNumber(value ? value[0] : row.x)
      y = finiteNumber(value ? value[1] : row.y ?? row.value)
      if (x === null && y !== null) x = sourceIndex + 1
    } else {
      y = finiteNumber(row)
      if (y !== null) x = sourceIndex + 1
    }
    if (x === null || y === null) continue
    points.push({ sourceIndex, label: rowLabel(node, row, sourceIndex, points.length), x, y })
  }
  if (points.length) return points
  return DEFAULT_VALUES.map((value, index) => ({
    sourceIndex: index,
    label: rowLabel(node, null, index),
    x: index + 1,
    y: value
  }))
}

export function chartRowsFromNode(node = {}, requestedType = node?.chartType ?? node?.type) {
  const type = normalizeChartType(requestedType)
  const rows = type === 'scatterChart' ? scatterRows(node) : scalarRows(node)
  return rows.map((row, index) => ({ index, ...row }))
}

function seriesData(value) {
  if (Array.isArray(value)) return value
  if (plainRecord(value) && Array.isArray(value.rows)) return value
  return []
}

export function chartSeriesFromNode(node = {}, requestedType = node?.chartType ?? node?.type) {
  const type = normalizeChartType(requestedType)
  const source = Array.isArray(node?.chartSeries)
    ? node.chartSeries.filter(plainRecord).slice(0, MAX_EDITABLE_CHART_SERIES)
    : []
  const fallbackColor = String(node?.chartColor ?? '').trim() || DEFAULT_COLORS[0]
  const fallbackName = String(node?.chartSeriesName ?? '').trim() || '系列 1'

  if (!source.length) {
    return [{ name: fallbackName, color: fallbackColor, data: seriesData(node?.chartData) }]
  }

  return source.map((item, index) => {
    let name = String(item.name ?? '').trim() || `系列 ${index + 1}`
    let color = String(item.color ?? '').trim() || DEFAULT_COLORS[index % DEFAULT_COLORS.length]
    let data = seriesData(item.data)
    // 旧字段仍是首系列的通信入口；运行时绑定覆盖后必须立即反映到图表。
    if (index === 0) {
      if (hasOwn(node, 'chartSeriesName')) name = fallbackName
      if (hasOwn(node, 'chartColor')) color = fallbackColor
      if (hasOwn(node, 'chartData')) data = seriesData(node.chartData)
    }
    return { name, color, data, type }
  })
}

export function chartRowsForSeries(node = {}, seriesIndex = 0, requestedType = node?.chartType ?? node?.type) {
  const type = normalizeChartType(requestedType)
  const series = chartSeriesFromNode(node, type)
  const selectedSeries = series[Math.max(0, Math.min(series.length - 1, Math.trunc(Number(seriesIndex)) || 0))]
  return chartRowsFromNode({ ...node, chartData: selectedSeries?.data ?? [] }, type)
}

export function chartColorPalette(node = {}) {
  const sliceColors = Array.isArray(node?.chartSliceColors)
    ? node.chartSliceColors.map(color => String(color ?? '').trim()).filter(Boolean)
    : []
  const seriesColors = Array.isArray(node?.chartSeries)
    ? node.chartSeries.map(series => String(series?.color ?? '').trim()).filter(Boolean)
    : []
  const color = String(node?.chartColor ?? '').trim()
  return [...new Set([...(color ? [color] : []), ...sliceColors, ...seriesColors, ...DEFAULT_COLORS])]
}

export function chartSliceColor(node = {}, index = 0) {
  const sourceIndex = Math.max(0, Math.trunc(Number(index)) || 0)
  const configured = Array.isArray(node?.chartSliceColors) ? node.chartSliceColors : []
  const explicit = sourceIndex === 0
    ? String(node?.chartColor ?? configured[0] ?? '').trim()
    : String(configured[sourceIndex] ?? '').trim()
  return explicit || DEFAULT_COLORS[sourceIndex % DEFAULT_COLORS.length]
}

function optionBoolean(value, fallback) {
  return value === undefined || value === null ? fallback : value !== false
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function applyNodePresentation(option, node, type) {
  option.backgroundColor = 'transparent'
  const title = String(node?.chartTitle ?? '').trim()
  if (title) {
    const currentTitle = plainRecord(option.title) ? option.title : {}
    const currentTextStyle = plainRecord(currentTitle.textStyle) ? currentTitle.textStyle : {}
    const textStyle = { ...currentTextStyle }
    const color = String(node?.color ?? '').trim()
    if (color) textStyle.color = color
    const fontSize = Number(node?.fontSize)
    if (Number.isFinite(fontSize) && fontSize > 0) textStyle.fontSize = fontSize
    if (node?.fontWeight !== undefined && node?.fontWeight !== null && String(node.fontWeight).trim()) {
      textStyle.fontWeight = node.fontWeight
    }
    const textAlign = ['left', 'center', 'right'].includes(String(node?.textAlign ?? '').trim())
      ? String(node.textAlign).trim()
      : ''
    if (textAlign) textStyle.align = textAlign
    option.title = {
      ...currentTitle,
      show: true,
      text: title,
      ...(textAlign ? { left: textAlign, textAlign } : {}),
      ...(Object.keys(textStyle).length ? { textStyle } : {})
    }
  }
  else if (plainRecord(option.title)) option.title.show = false

  const color = String(node?.chartColor ?? '').trim()
  if (color || Array.isArray(node?.chartSeries) || Array.isArray(node?.chartSliceColors)) option.color = chartColorPalette(node)

  const seriesList = Array.isArray(option.series) ? option.series.filter(plainRecord) : []

  const showLegend = optionBoolean(node?.chartShowLegend, true)
  option.legend = { ...(plainRecord(option.legend) ? option.legend : {}), show: showLegend }
  const showTooltip = optionBoolean(node?.chartShowTooltip, true)
  option.tooltip = { ...(plainRecord(option.tooltip) ? option.tooltip : {}), show: showTooltip }

  if (['lineChart', 'barChart', 'scatterChart'].includes(type)) {
    const showGrid = optionBoolean(node?.chartShowGrid, true)
    for (const axisName of ['xAxis', 'yAxis']) {
      if (!plainRecord(option[axisName])) continue
      option[axisName].splitLine = {
        ...(plainRecord(option[axisName].splitLine) ? option[axisName].splitLine : {}),
        show: showGrid
      }
    }
  }
  if (type === 'lineChart') {
    for (const series of seriesList) {
      series.smooth = node?.chartSmooth === true
      series.areaStyle = {
        ...(plainRecord(series.areaStyle) ? series.areaStyle : {}),
        opacity: node?.chartAreaFill === true ? 0.18 : 0
      }
    }
  }
  if (['lineChart', 'scatterChart'].includes(type)) {
    for (const series of seriesList) {
      series.symbolSize = positiveNumber(node?.chartSymbolSize, series.symbolSize || 10)
    }
  }
  return option
}

function seriesTemplate(option) {
  return plainRecord(option?.series?.[0]) ? cloneOptionValue(option.series[0]) : {}
}

function applySeriesColor(series, color, type) {
  series.itemStyle = { ...(plainRecord(series.itemStyle) ? series.itemStyle : {}), color }
  if (type === 'lineChart') {
    series.lineStyle = { ...(plainRecord(series.lineStyle) ? series.lineStyle : {}), color }
  }
  return series
}

export function chartOptionFromNode(node = {}) {
  const custom = configuredOption(node)
  if (custom) {
    return safeChartOption(custom)
  }

  if (node?.type === 'echartsCode') {
    return applyNodePresentation(createDefaultChartOption(DEFAULT_CHART_TYPE), node, DEFAULT_CHART_TYPE)
  }

  const type = normalizeChartType(node.chartType ?? node.type)
  const option = createDefaultChartOption(type)
  if (type === 'pieChart') {
    const rows = chartRowsFromNode(node, type)
    const explicitColors = Array.isArray(node?.chartSliceColors)
    option.series[0].data = rows.map((row, index) => {
      const item = { name: row.label, value: row.value }
      if (explicitColors) item.itemStyle = { color: chartSliceColor(node, row.sourceIndex) }
      return item
    })
  } else {
    const configuredSeries = chartSeriesFromNode(node, type)
    if (type === 'radarChart') {
      const seriesRows = configuredSeries.map((series, index) => ({
        series,
        rows: chartRowsForSeries(node, index, type)
      }))
      const labels = seriesRows[0]?.rows.map(row => row.label) || []
      const values = seriesRows.flatMap(entry => entry.rows.map(row => row.value))
      const maximum = Math.max(1, ...values.map(value => Math.abs(value)))
      const indicatorMaximum = positiveNumber(node?.chartRadarMax, Math.ceil(maximum * 1.2))
      option.radar.indicator = labels.map(name => ({ name, max: indicatorMaximum }))
      option.series[0].data = seriesRows.map(({ series, rows }) => ({
        name: series.name,
        value: rows.map(row => row.value),
        lineStyle: { color: series.color },
        itemStyle: { color: series.color },
        areaStyle: { color: series.color, opacity: 0.18 }
      }))
      option.color = configuredSeries.map(series => series.color)
    } else {
      const template = seriesTemplate(option)
      option.series = configuredSeries.map((series, index) => {
        const rows = chartRowsForSeries(node, index, type)
        if (index === 0 && type !== 'scatterChart') option.xAxis.data = rows.map(row => row.label)
        const nextSeries = {
          ...cloneOptionValue(template),
          name: series.name,
          data: type === 'scatterChart'
            ? rows.map(row => ({ name: row.label, value: [row.x, row.y] }))
            : rows.map(row => row.value)
        }
        return applySeriesColor(nextSeries, series.color, type)
      })
      option.color = configuredSeries.map(series => series.color)
    }
  }
  return applyNodePresentation(option, node, type)
}

function inferredChartType(option, fallback) {
  const series = Array.isArray(option?.series) ? option.series : []
  const type = series.find(item => plainRecord(item) && SERIES_TYPE_TO_CHART_TYPE[item.type])?.type
  return normalizeChartType(type, fallback)
}

function optionColorAt(option, item, index) {
  const palette = Array.isArray(option?.color) ? option.color : [option?.color]
  const candidates = [item?.itemStyle?.color, item?.lineStyle?.color, palette[index], palette[0]]
  const color = candidates.find(candidate => typeof candidate === 'string' && candidate.trim())
  return color ? color.trim() : DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

function optionSeriesName(series, index) {
  const name = String(series?.name ?? '').trim()
  return name || `系列 ${index + 1}`
}

export function chartNodeDataFromOption(option, fallbackType = DEFAULT_CHART_TYPE) {
  if (!plainRecord(option)) throw new TypeError('ECharts option 必须是对象')
  const chartType = inferredChartType(option, fallbackType)
  const seriesList = (Array.isArray(option.series) ? option.series : [])
    .filter(series => plainRecord(series) && normalizeChartType(series.type, chartType) === chartType)
    .slice(0, MAX_EDITABLE_CHART_SERIES)
  const series = seriesList[0] || {}
  let chartData = []
  let chartLabels = []
  let chartSeries = []
  let chartSliceColors = []

  if (chartType === 'pieChart') {
    const rawData = Array.isArray(series.data) ? series.data.slice(0, MAX_MAPPED_DATA_ITEMS) : []
    chartData = rawData.map((item, index) => plainRecord(item)
      ? { name: String(item.name ?? `数据 ${index + 1}`), value: finiteNumber(item.value) ?? 0 }
      : { name: `数据 ${index + 1}`, value: finiteNumber(item) ?? 0 })
    chartLabels = chartData.map(item => item.name)
    chartSliceColors = rawData.map((item, index) => optionColorAt(option, plainRecord(item) ? item : null, index))
    chartSeries = [{
      name: optionSeriesName(series, 0),
      color: optionColorAt(option, series, 0),
      data: cloneOptionValue(chartData)
    }]
  } else if (chartType === 'scatterChart') {
    chartSeries = seriesList.map((currentSeries, seriesIndex) => {
      const rawData = Array.isArray(currentSeries.data) ? currentSeries.data.slice(0, MAX_MAPPED_DATA_ITEMS) : []
      const mappedPoints = rawData.flatMap((item, index) => {
        const value = plainRecord(item) && Array.isArray(item.value) ? item.value : item
        if (!Array.isArray(value)) return []
        const x = finiteNumber(value[0])
        const y = finiteNumber(value[1])
        const name = plainRecord(item) ? String(item.name ?? `数据 ${index + 1}`) : `数据 ${index + 1}`
        return x === null || y === null ? [] : [{ name, value: [x, y] }]
      })
      if (seriesIndex === 0) chartLabels = mappedPoints.map(item => item.name)
      return {
        name: optionSeriesName(currentSeries, seriesIndex),
        color: optionColorAt(option, currentSeries, seriesIndex),
        data: mappedPoints.map(item => item.value)
      }
    })
    chartData = cloneOptionValue(chartSeries[0]?.data || [])
  } else if (chartType === 'radarChart') {
    const rawData = Array.isArray(series.data) ? series.data.slice(0, MAX_EDITABLE_CHART_SERIES) : []
    chartSeries = rawData.map((item, index) => {
      const values = plainRecord(item) && Array.isArray(item.value) ? item.value : []
      return {
        name: String(item?.name ?? '').trim() || `系列 ${index + 1}`,
        color: optionColorAt(option, plainRecord(item) ? item : null, index),
        data: values.slice(0, MAX_MAPPED_DATA_ITEMS).map(value => finiteNumber(value) ?? 0)
      }
    })
    if (!chartSeries.length) {
      chartSeries = [{ name: optionSeriesName(series, 0), color: optionColorAt(option, series, 0), data: [] }]
    }
    chartData = cloneOptionValue(chartSeries[0].data)
    chartLabels = Array.isArray(option.radar?.indicator)
      ? option.radar.indicator.slice(0, chartData.length).map((item, index) => String(item?.name ?? `指标 ${index + 1}`))
      : []
  } else {
    chartSeries = seriesList.map((currentSeries, index) => {
      const rawData = Array.isArray(currentSeries.data) ? currentSeries.data.slice(0, MAX_MAPPED_DATA_ITEMS) : []
      return {
        name: optionSeriesName(currentSeries, index),
        color: optionColorAt(option, currentSeries, index),
        data: rawData.map(item => plainRecord(item) ? finiteNumber(item.value) ?? 0 : finiteNumber(item) ?? 0)
      }
    })
    if (!chartSeries.length) {
      chartSeries = [{ name: '系列 1', color: DEFAULT_COLORS[0], data: [] }]
    }
    chartData = cloneOptionValue(chartSeries[0].data)
    chartLabels = Array.isArray(option.xAxis?.data)
      ? option.xAxis.data.slice(0, chartData.length).map(String)
      : []
  }

  const chartColor = chartSeries[0]?.color || optionColorAt(option, series, 0)
  const chartSeriesName = chartSeries[0]?.name || optionSeriesName(series, 0)
  const result = {
    chartType,
    chartData: cloneOptionValue(chartData),
    chartLabels: cloneOptionValue(chartLabels),
    chartSeries: cloneOptionValue(chartSeries),
    chartTitle: String(option.title?.text ?? ''),
    chartSeriesName,
    chartColor,
    chartShowLegend: option.legend?.show !== false,
    chartShowTooltip: option.tooltip?.show !== false,
    chartShowGrid: option.yAxis?.splitLine?.show !== false,
    chartSmooth: series.smooth === true,
    chartAreaFill: plainRecord(series.areaStyle) && Number(series.areaStyle.opacity ?? 1) > 0,
    chartSymbolSize: positiveNumber(series.symbolSize, 10)
  }
  if (chartType === 'radarChart') {
    result.chartRadarMax = positiveNumber(option.radar?.indicator?.[0]?.max, 100)
  }
  if (chartType === 'pieChart') result.chartSliceColors = cloneOptionValue(chartSliceColors)
  return result
}

export function applyChartOptionToNode(node, option, fallbackType = node?.chartType ?? node?.type) {
  if (!node || typeof node !== 'object') throw new TypeError('图表节点必须是对象')
  const normalizedOption = safeChartOption(option)
  const mapped = chartNodeDataFromOption(normalizedOption, fallbackType)
  return {
    ...node,
    ...mapped,
    chartOption: normalizedOption
  }
}
