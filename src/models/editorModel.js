import {
  clampNumber, finiteNumber, normalizeNodeCollectionGeometry, normalizeNodeGeometry, normalizedVisualScale
} from '../utils/editorGeometry.js'
import {
  MAX_POLYLINE_NODE_POINTS,
  polylineArrowSize,
  polylineLineOpacity,
  polylineLineStyle
} from '../utils/polylineGeometry.js'
import { normalizeTextLayout } from '../utils/textLayout.js'
import { normalizeDataBindings } from './dataBindingModel.js'

export const TABLE_COLUMN_MIN_WIDTH = 40
export const TABLE_COLUMN_MAX_WIDTH = 2000
export const EDGE_MARKER_TYPES = new Set(['none', 'arrow', 'circle', 'square'])
export const EDGE_ANCHOR_MODES = new Set(['edge', 'center'])

// 每次创建全新的数组字段，防止两个节点共享颜色、路径或表格合并状态。
export function baseNodeOptions() {
  return {
    // 几何、文字与外观
    rotate: 0, locked: false, animation: 'none', dataKey: '', dataBindings: [],
    visualScaleX: 1, visualScaleY: 1,
    fontSize: 14, fontWeight: '400', fontStyle: 'normal', textAlign: 'center', textLayout: 'horizontal',
    borderWidth: 2, borderStyle: 'solid', borderDashLength: 8, borderDashGap: 6, borderVisible: true, backgroundOpacity: 1, opacity: 1,
    animationDuration: 1.5, animationDirection: 'normal', animationPaused: false,
    animationDelay: 0, animationEasing: 'ease-in-out', animationIterations: 'infinite',
    customEffect: 'bounce', motionDistance: 18, motionScale: 1.18, motionRotate: 360, motionColor: '#16b89a',
    // 媒体与通用表单
    imageUrl: '', imageFit: 'contain', videoUrl: '', videoFit: 'contain', videoAutoplay: false, videoControls: true, videoPlaybackRate: 1, videoPlayCount: 0, videoMuted: true,
    formName: '', value: '', defaultValue: '', placeholder: '请输入内容', options: '选项一:option1,选项二:option2,选项三:option3', selectOptions: null, checked: false, defaultChecked: false, disabled: false, required: false, readOnly: false,
    checkedValue: '1', uncheckedValue: '0', labelPosition: 'right', controlSize: 20, switchWidth: 42, switchHeight: 22,
    inputType: 'text', maxLength: 100, buttonAction: 'count', actionMessage: '操作已执行', clickCount: 0, showClickCount: true, buttonBeforeColor: '#168eea', buttonAfterColor: '#0f766e', buttonFeedback: '',
    progressMin: 0, progressMax: 100, progressMode: 'percent', showProgressText: true, progressHeight: 12,
    // 时间、动效和数据展示组件
    timeFormat: 'time-seconds', timeMode: 'fixed', timeUseServer: false, timeRunning: false, timeStartedAt: null, timeFrozenValue: '', timeShowLeftIcon: true, timeShowRightIcon: true,
    signalColorCount: 2, signalColors: ['#21c58e', '#ef5350'], signalOpacity: 1,
    progressValue: 68, progressThickness: 12, progressLength: 84, progressStartShape: 'round', progressEndShape: 'round',
    progressFluctuationEnabled: false, progressFluctuationMin: 0, progressFluctuationMax: 1, progressFluctuationDuration: 2,
    // 铅笔、线段与表格使用数组字段，必须由本函数逐次创建
    pencilPoints: [], pencilColor: '#485563', pencilWidth: 2, pencilDash: false, pencilSmooth: true, pencilClosed: false, pencilLineCap: 'round', pencilLineJoin: 'round',
    polylinePoints: [{ x: .08, y: .72 }, { x: .34, y: .28 }, { x: .64, y: .68 }, { x: .92, y: .24 }],
    polylineColor: '#485563', polylineWidth: 2, polylineArrowSize: 8, polylineStyle: 'solid', polylineOpacity: 1, polylineDash: false, polylineStartMarker: 'none', polylineEndMarker: 'none', polylineLineCap: 'round', polylineLineJoin: 'round',
    tableRows: 3, tableColumns: 3, showHeader: true, tableData: '设备 A,正常,68;设备 B,告警,42;设备 C,正常,86', tableHeaders: null, tableCells: null, tableColumnWidths: null, tableColumnWidthsPx: null, tableScrollX: true, tableScrollY: true,
    tableTitle: '数据表格', showTableTitle: true, tableTitleFill: '#26323d', tableTitleColor: '#ffffff', tableTitleSize: 14, tableTitleWeight: '600', tableTitleAlign: 'center',
    tableHeaderFill: '#eef2f4', tableHeaderColor: '#26323d', tableHeaderSize: 14, tableHeaderWeight: '600', tableHeaderAlign: 'center',
    tableRowFill: '#ffffff', tableAltRowFill: '#f7f9fa', tableCellColor: '#26323d', tableCellSize: 14, tableCellWeight: '400',
    tableGridColor: '#b8c1c7', tableGridWidth: 1, tableGridStyle: 'solid', tableBorderColor: '#b8c1c7', tableBorderWidth: 1, tableBorderStyle: 'solid', tableHeaderHeight: null, tableRowHeight: 28, tableRowHeights: null, tableTextAlign: 'center', tableContentDisplay: 'ellipsis', tableMerges: [],
    min: 0, max: 100, address: '', status: '正常'
  }
}

function splitFormValues(value, separator = ',') {
  return String(value || '').split(separator).map(item => item.trim())
}

export function normalizeSelectOptions(node) {
  const source = Array.isArray(node.selectOptions)
    ? node.selectOptions
    : splitFormValues(node.options).filter(Boolean).map((item, index) => {
        const separator = item.indexOf(':')
        return separator < 0
          ? { label: item, value: item }
          : { label: item.slice(0, separator).trim() || `选项 ${index + 1}`, value: item.slice(separator + 1).trim() || item }
      })
  return (source.length ? source : [{ label: '选项一', value: 'option1' }]).slice(0, 50).map((item, index) => ({
    label: String(item?.label ?? `选项 ${index + 1}`),
    value: String(item?.value ?? `option${index + 1}`)
  }))
}

// 合并区域按顺序占用单元格，越界或与已有区域重叠的数据会被丢弃。
export function normalizeTableMerges(source, rows, columns) {
  if (!Array.isArray(source)) return []
  const normalized = []
  const occupied = new Set()
  for (const item of source) {
    const row = Math.floor(Number(item?.row))
    const column = Math.floor(Number(item?.column))
    if (!Number.isFinite(row) || !Number.isFinite(column) || row < 0 || column < 0 || row >= rows || column >= columns) continue
    const rowSpan = Math.min(rows - row, Math.max(1, Math.floor(Number(item?.rowSpan)) || 1))
    const columnSpan = Math.min(columns - column, Math.max(1, Math.floor(Number(item?.columnSpan)) || 1))
    if (rowSpan === 1 && columnSpan === 1) continue
    const cells = []
    let overlaps = false
    for (let currentRow = row; currentRow < row + rowSpan; currentRow += 1) {
      for (let currentColumn = column; currentColumn < column + columnSpan; currentColumn += 1) {
        const key = `${currentRow}:${currentColumn}`
        cells.push(key)
        if (occupied.has(key)) overlaps = true
      }
    }
    if (overlaps) continue
    cells.forEach(key => occupied.add(key))
    normalized.push({ row, column, rowSpan, columnSpan })
  }
  return normalized
}

export function clampTableColumnWidth(value, fallback = 120) {
  return Math.max(TABLE_COLUMN_MIN_WIDTH, Math.min(TABLE_COLUMN_MAX_WIDTH, Math.round(Number(value) || fallback)))
}

export function normalizeTableColumnWidthsPx(node, columns, sourceRatios) {
  const outerWidth = Math.max(0, Number(node.tableBorderWidth) || 0) * 2
  const availableWidth = Math.max(columns * TABLE_COLUMN_MIN_WIDTH, (Number(node.w) || columns * 120) - outerWidth)
  const ratios = Array.from({ length: columns }, (_, index) => Math.max(.2, Math.min(5, Number(sourceRatios[index]) || 1)))
  const ratioTotal = ratios.reduce((total, width) => total + width, 0) || columns
  const converted = ratios.map(width => clampTableColumnWidth(availableWidth * width / ratioTotal))
  const convertedTotal = converted.reduce((total, width) => total + width, 0)
  if (converted.length && convertedTotal !== availableWidth) {
    converted[converted.length - 1] = clampTableColumnWidth(converted[converted.length - 1] + availableWidth - convertedTotal)
  }
  const sourcePixels = Array.isArray(node.tableColumnWidthsPx) ? node.tableColumnWidthsPx : []
  return Array.from({ length: columns }, (_, index) => {
    const explicitWidth = Number(sourcePixels[index])
    return Number.isFinite(explicitWidth) && explicitWidth > 0 ? clampTableColumnWidth(explicitWidth) : converted[index]
  })
}

// 旧图纸可能只保存逗号分隔文本；这里统一转换为当前二维表格模型。
export function normalizeTableModel(node) {
  const legacyHeaders = splitFormValues(node.options).filter(Boolean)
  const legacyRows = splitFormValues(node.tableData, ';').filter(Boolean).map(row => splitFormValues(row))
  const requestedColumns = Number(node.tableColumns) || node.tableHeaders?.length || legacyHeaders.length || 3
  const columns = Math.max(1, Math.min(12, requestedColumns))
  const requestedRows = Number(node.tableRows) || node.tableCells?.length || legacyRows.length || 3
  const rows = Math.max(1, Math.min(50, requestedRows))
  const sourceHeaders = Array.isArray(node.tableHeaders) ? node.tableHeaders : legacyHeaders
  const sourceCells = Array.isArray(node.tableCells) ? node.tableCells : legacyRows
  const sourceWidths = Array.isArray(node.tableColumnWidths) ? node.tableColumnWidths : []
  const fallbackRowHeight = Math.max(18, Math.min(120, Number(node.tableRowHeight) || 28))
  const sourceRowHeights = Array.isArray(node.tableRowHeights) ? node.tableRowHeights : []
  return {
    ...node,
    tableColumns: columns,
    tableRows: rows,
    tableHeaders: Array.from({ length: columns }, (_, index) => String(sourceHeaders[index] ?? `列 ${index + 1}`)),
    tableCells: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => String(sourceCells[row]?.[column] ?? ''))),
    tableColumnWidths: Array.from({ length: columns }, (_, index) => Math.max(.2, Math.min(5, Number(sourceWidths[index]) || 1))),
    tableColumnWidthsPx: normalizeTableColumnWidthsPx(node, columns, sourceWidths),
    tableHeaderHeight: Math.max(18, Math.min(120, Number(node.tableHeaderHeight) || fallbackRowHeight)),
    tableRowHeight: fallbackRowHeight,
    tableRowHeights: Array.from({ length: rows }, (_, index) => Math.max(18, Math.min(120, Number(sourceRowHeights[index]) || fallbackRowHeight))),
    tableMerges: normalizeTableMerges(node.tableMerges, rows, columns)
  }
}

export function normalizeFontWeightLevel(value, fallback = '400') {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  if (numeric < 500) return '400'
  if (numeric < 650) return '600'
  return '700'
}

// 节点归一化是所有导入、模板实例化和撤销恢复共用的兼容边界。
export function normalizeNode(node) {
  const source = node && typeof node === 'object' ? node : {}
  const normalized = { ...baseNodeOptions(), ...source }
  normalized.dataBindings = normalizeDataBindings(source, normalized.type)
  Object.assign(normalized, normalizeNodeGeometry(normalized, undefined, undefined, { constrainPosition: false }))
  const groupId = String(source.groupId || '').trim().slice(0, 128)
  normalized.groupId = groupId || null
  const legacyVisualScale = normalizedVisualScale(source.visualScale)
  normalized.visualScaleX = normalizedVisualScale(source.visualScaleX ?? legacyVisualScale, normalized.w)
  normalized.visualScaleY = normalizedVisualScale(source.visualScaleY ?? legacyVisualScale, normalized.h)
  delete normalized.visualScale
  const legacyFontWeight = Number(source.fontWeight)
  const legacyFontScale = Number(source.fontWeightScale)
  normalized.fontWeight = normalizeFontWeightLevel(legacyFontWeight > 0 ? legacyFontWeight : legacyFontScale > 0 ? legacyFontScale * 400 : 400)
  normalized.textLayout = normalizeTextLayout(source.textLayout)
  delete normalized.fontWeightScale
  // 兼容早期媒体和动效字段，并把数值限制在属性面板允许的范围内。
  if (!Array.isArray(source.signalColors)) normalized.signalColors = [source.signalColor || '#21c58e', '#ef5350']
  normalized.signalColorCount = Math.max(1, Math.min(8, Number(normalized.signalColorCount) || 2))
  normalized.videoPlaybackRate = Math.max(.25, Math.min(4, Number(normalized.videoPlaybackRate) || 1))
  normalized.videoPlayCount = Math.max(0, Math.min(999, Math.round(Number(normalized.videoPlayCount) || 0)))
  normalized.videoAutoplay = source.videoAutoplay == null ? Boolean(source.videoPlaying) : Boolean(source.videoAutoplay)
  normalized.videoControls = source.videoControls !== false
  normalized.videoMuted = normalized.videoMuted !== false
  normalized.showClickCount = source.showClickCount !== false
  normalized.buttonBeforeColor = String(source.buttonBeforeColor || source.fill || '#168eea')
  normalized.buttonAfterColor = String(source.buttonAfterColor || '#0f766e')
  normalized.progressThickness = Math.max(2, Math.min(80, Number(normalized.progressThickness) || 12))
  normalized.progressLength = Math.max(10, Math.min(100, Number(normalized.progressLength) || 84))
  normalized.progressStartShape = normalized.progressStartShape === 'square' ? 'square' : 'round'
  normalized.progressEndShape = normalized.progressEndShape === 'square' ? 'square' : 'round'
  normalized.progressFluctuationEnabled = Boolean(normalized.progressFluctuationEnabled)
  normalized.progressFluctuationMin = Math.max(0, Math.min(1, Number.isFinite(Number(normalized.progressFluctuationMin)) ? Number(normalized.progressFluctuationMin) : 0))
  normalized.progressFluctuationMax = Math.max(0, Math.min(1, Number.isFinite(Number(normalized.progressFluctuationMax)) ? Number(normalized.progressFluctuationMax) : 1))
  normalized.progressFluctuationDuration = Math.max(.2, Math.min(60, Number(normalized.progressFluctuationDuration) || 2))
  delete normalized.videoPlaying
  if (normalized.type === 'select') normalized.selectOptions = normalizeSelectOptions(normalized)
  // 时间组件旧字段只在读取时迁移，新图纸不会继续写回已废弃配置。
  if (normalized.type === 'time') {
    const legacyCurrentTime = source.timeSource === 'current'
    if (source.timeUseServer == null) normalized.timeUseServer = legacyCurrentTime
    if (source.timeRunning == null) normalized.timeRunning = legacyCurrentTime
    normalized.timeShowLeftIcon = source.timeShowLeftIcon !== false
    normalized.timeShowRightIcon = source.timeShowRightIcon !== false
    normalized.timeMode = ['fixed', 'elapsed'].includes(normalized.timeMode) ? normalized.timeMode : 'fixed'
    normalized.timeStartedAt = Number.isFinite(Number(normalized.timeStartedAt)) ? Number(normalized.timeStartedAt) : null
    normalized.timeFrozenValue = String(normalized.timeFrozenValue || normalized.defaultValue || normalized.value || '')
    delete normalized.timeSource
    delete normalized.timeMin
    delete normalized.timeMax
    delete normalized.timeStep
  }
  if (source.defaultChecked == null) normalized.defaultChecked = Boolean(source.checked)
  if (source.defaultValue == null) normalized.defaultValue = String(source.value ?? '')
  // 铅笔点使用节点内部的 0-1 相对坐标，缩放节点时无需改写全部采样点。
  if (normalized.type === 'pencil') {
    normalized.text = String(source.text || '铅笔线稿')
    normalized.pencilPoints = (Array.isArray(source.pencilPoints) ? source.pencilPoints : [])
      .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
      .map(point => ({ x: clampNumber(Number(point.x), 0, 1), y: clampNumber(Number(point.y), 0, 1) }))
    normalized.pencilColor = String(source.pencilColor || source.color || '#485563')
    normalized.pencilWidth = clampNumber(finiteNumber(source.pencilWidth, source.width ?? 2), .1, 100)
    normalized.pencilDash = Boolean(source.pencilDash ?? source.dash)
    normalized.pencilSmooth = source.pencilSmooth == null ? source.smooth !== false : Boolean(source.pencilSmooth)
    normalized.pencilClosed = Boolean(source.pencilClosed ?? source.closed)
    normalized.pencilLineCap = ['round', 'butt', 'square'].includes(source.pencilLineCap) ? source.pencilLineCap : (['round', 'butt', 'square'].includes(source.lineCap) ? source.lineCap : 'round')
    normalized.pencilLineJoin = ['round', 'bevel', 'miter'].includes(source.pencilLineJoin) ? source.pencilLineJoin : (['round', 'bevel', 'miter'].includes(source.lineJoin) ? source.lineJoin : 'round')
    normalized.backgroundOpacity = 0
    normalized.borderVisible = false
  }
  if (normalized.type === 'polyline') {
    const fallbackPoints = baseNodeOptions().polylinePoints
    const sourcePoints = Array.isArray(source.polylinePoints) ? source.polylinePoints : fallbackPoints
    const validPoints = sourcePoints
      .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
      .slice(0, MAX_POLYLINE_NODE_POINTS)
      .map(point => ({ x: clampNumber(Number(point.x), 0, 1), y: clampNumber(Number(point.y), 0, 1) }))
    normalized.text = String(source.text || '线段')
    normalized.polylinePoints = validPoints.length ? validPoints : fallbackPoints
    normalized.polylineColor = String(source.polylineColor || source.fill || source.color || '#485563')
    normalized.polylineWidth = clampNumber(finiteNumber(source.polylineWidth, source.width ?? 2), .1, 100)
    normalized.polylineArrowSize = polylineArrowSize(source)
    normalized.polylineStyle = polylineLineStyle(source)
    normalized.polylineOpacity = polylineLineOpacity(source)
    // 保留旧字段用于读取早期图纸；新渲染统一使用三态 polylineStyle。
    normalized.polylineDash = normalized.polylineStyle !== 'solid'
    normalized.polylineStartMarker = ['none', 'arrow'].includes(source.polylineStartMarker) ? source.polylineStartMarker : 'none'
    normalized.polylineEndMarker = ['none', 'arrow'].includes(source.polylineEndMarker) ? source.polylineEndMarker : 'none'
    normalized.polylineLineCap = ['round', 'butt', 'square'].includes(source.polylineLineCap) ? source.polylineLineCap : (['round', 'butt', 'square'].includes(source.lineCap) ? source.lineCap : 'round')
    normalized.polylineLineJoin = ['round', 'bevel', 'miter'].includes(source.polylineLineJoin) ? source.polylineLineJoin : (['round', 'bevel', 'miter'].includes(source.lineJoin) ? source.lineJoin : 'round')
    normalized.borderDashLength = clampNumber(finiteNumber(source.borderDashLength, normalized.polylineStyle === 'dotted' ? 2 : 8), .1, 50)
    normalized.borderDashGap = clampNumber(finiteNumber(source.borderDashGap, 6), .1, 50)
    normalized.borderWidth = clampNumber(finiteNumber(source.borderWidth, 2), 0, 20)
    normalized.borderVisible = source.borderVisible === true
    normalized.stroke = String(source.stroke || '#485563')
    normalized.backgroundOpacity = 0
  }
  if (normalized.type === 'table') {
    const alignments = ['left', 'center', 'right']
    normalized.tableTitleAlign = alignments.includes(source.tableTitleAlign) ? source.tableTitleAlign : 'center'
    normalized.tableHeaderAlign = alignments.includes(source.tableHeaderAlign) ? source.tableHeaderAlign : (alignments.includes(source.tableTextAlign) ? source.tableTextAlign : 'left')
    normalized.tableTextAlign = alignments.includes(source.tableTextAlign) ? source.tableTextAlign : 'left'
    normalized.tableGridStyle = ['solid', 'dashed', 'dotted'].includes(source.tableGridStyle) ? source.tableGridStyle : 'solid'
    normalized.tableTitleSize = Math.max(8, Math.min(48, Number(source.tableTitleSize) || 14))
    normalized.tableHeaderSize = Math.max(8, Math.min(48, Number(source.tableHeaderSize) || 14))
    normalized.tableCellSize = Math.max(8, Math.min(48, Number(source.tableCellSize) || 14))
    normalized.tableTitleWeight = normalizeFontWeightLevel(source.tableTitleWeight, '600')
    normalized.tableHeaderWeight = normalizeFontWeightLevel(source.tableHeaderWeight, '600')
    normalized.tableCellWeight = normalizeFontWeightLevel(source.tableCellWeight, '400')
    normalized.tableContentDisplay = ['wrap', 'ellipsis'].includes(source.tableContentDisplay) ? source.tableContentDisplay : 'ellipsis'
    return normalizeTableModel(normalized)
  }
  return normalized
}

// 多节点必须共享同一次几何校正，逐个归一化会破坏组合内部相对位置。
export function normalizeNodesTogether(items, targetStageWidth, targetStageHeight, options = {}) {
  const geometries = normalizeNodeCollectionGeometry(items, targetStageWidth, targetStageHeight, options)
  items.forEach((node, index) => Object.assign(node, geometries[index]))
  return items
}

export function normalizeDrawing(drawing) {
  const source = drawing && typeof drawing === 'object' ? drawing : {}
  return {
    color: '#485563', smooth: true, closed: false, lineCap: 'round', lineJoin: 'round', layer: null,
    ...source,
    width: clampNumber(finiteNumber(source.width, 2), .1, 100),
    dash: Boolean(source.dash),
    opacity: clampNumber(finiteNumber(source.opacity, 1), 0, 1),
    locked: Boolean(source.locked),
    points: (source.points || []).map(point => ({ x: Number(point.x), y: Number(point.y) }))
  }
}

export function normalizeEdge(edge, defaults = {}) {
  // 图纸级设置只为缺失或非法字段兜底，合法的连线自身设置始终优先。
  const startMarker = EDGE_MARKER_TYPES.has(edge?.startMarker) ? edge.startMarker : (EDGE_MARKER_TYPES.has(defaults.startMarker) ? defaults.startMarker : 'none')
  const endMarker = EDGE_MARKER_TYPES.has(edge?.endMarker) ? edge.endMarker : (EDGE_MARKER_TYPES.has(defaults.endMarker) ? defaults.endMarker : 'arrow')
  const anchorMode = EDGE_ANCHOR_MODES.has(edge?.anchorMode) ? edge.anchorMode : (EDGE_ANCHOR_MODES.has(defaults.anchorMode) ? defaults.anchorMode : 'edge')
  return {
    ...edge,
    color: edge?.color || defaults.color || '#485563',
    width: clampNumber(finiteNumber(edge?.width, defaults.width || 2), .1, 100),
    dash: edge?.dash == null ? Boolean(defaults.dash) : Boolean(edge.dash),
    startMarker,
    endMarker,
    anchorMode
  }
}
