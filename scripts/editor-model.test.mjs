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
  normalizeEdge,
  normalizeNode,
  normalizeTableMerges
} from '../src/models/editorModel.js'
import { splitTextGraphemes, verticalTextColumns } from '../src/utils/textLayout.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('builds unique component indexes from the catalog', () => {
  const groups = createComponentGroups()
  const items = groups.flatMap(group => group.items.map(item => ({ ...item, category: group.name })))
  const types = items.map(item => item.type)

  assert.equal(new Set(types).size, types.length)
  assert.deepEqual(new Set(types), new Set(Object.keys(SHAPE_DEFAULTS).filter(type => type !== 'pencil')))
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
  firstNode.pencilPoints.push({ x: 0, y: 0 })
  firstNode.tableMerges.push({ row: 0, column: 0, rowSpan: 2, columnSpan: 2 })
  assert.equal(secondNode.signalColors[0], '#21c58e')
  assert.deepEqual(secondNode.pencilPoints, [])
  assert.deepEqual(secondNode.tableMerges, [])
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
