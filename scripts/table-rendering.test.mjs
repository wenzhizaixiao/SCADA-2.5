import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import { h } from 'vue'
import { createServer } from 'vite'
import {
  LINE_SHAPE_MIN_INNER_SIZE,
  lineShapeBorderWidth,
  lineShapeBodyDashArray,
  lineShapeBodyDashSegments,
  lineShapeBodyInset,
  lineShapeDashArray,
  lineShapeDashSegments,
  lineShapeHeight,
  lineShapeInnerThickness,
  lineShapeWidth
} from '../src/utils/lineShapeGeometry.js'
import {
  createTableCellModels,
  createTableVirtualWindow,
  shouldVirtualizeTable
} from '../src/utils/tableVirtualization.js'

let nodeVisual
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  })
  const module = await vite.ssrLoadModule('/src/components/NodeVisual.vue')
  nodeVisual = module.default
})

after(async () => {
  await vite?.close()
})

function tableNode(overrides = {}) {
  return {
    id: 'table-rendering-test',
    type: 'table',
    text: 'Table',
    w: 500,
    h: 300,
    tableColumns: 5,
    tableRows: 2,
    showHeader: true,
    showTableTitle: false,
    tableHeaders: ['Date', 'Name', 'Province', 'City', 'Address'],
    tableCells: [
      ['2016-05-03', 'Alice', 'Shanghai', 'Putuo', '1518 Jinshajiang Road'],
      ['2016-05-02', 'Bob', 'Shanghai', 'Putuo', '1518 Jinshajiang Road']
    ],
    tableColumnWidthsPx: [130, 105, 105, 105, 40],
    tableHeaderHeight: 36,
    tableRowHeight: 40,
    tableRowHeights: [44, 58],
    tableContentDisplay: 'ellipsis',
    tableBorderWidth: 1,
    tableBorderColor: '#ebeef5',
    tableBorderStyle: 'solid',
    tableGridWidth: 1,
    tableGridColor: '#ebeef5',
    tableGridStyle: 'solid',
    tableMerges: [],
    ...overrides
  }
}

async function renderTable(node = tableNode()) {
  return renderToString(h(nodeVisual, { node }))
}

async function renderLine(overrides = {}) {
  return renderToString(h(nodeVisual, {
    node: {
      id: 'line-rendering-test',
      type: 'lineShape',
      w: 160,
      h: 7.5,
      fill: '#abcdef',
      backgroundOpacity: 1,
      stroke: '#123456',
      borderVisible: true,
      borderWidth: 1,
      borderStyle: 'solid',
      borderDashLength: 8,
      borderDashGap: 6,
      ...overrides
    }
  }))
}

async function renderTime(overrides = {}) {
  return renderToString(h(nodeVisual, {
    node: {
      id: 'time-rendering-test',
      type: 'time',
      w: 220,
      h: 44,
      fill: '#ffffff',
      stroke: '#9aa3aa',
      color: '#26323d',
      borderWidth: 1,
      borderStyle: 'solid',
      borderVisible: true,
      backgroundOpacity: 1,
      opacity: 1,
      fontSize: 14,
      fontWeight: '400',
      fontStyle: 'normal',
      textAlign: 'left',
      timeFormat: 'time-seconds',
      timeMode: 'fixed',
      timeUseServer: false,
      timeRunning: false,
      timeShowLeftIcon: true,
      timeShowRightIcon: true,
      defaultValue: '12:34:56',
      ...overrides
    }
  }))
}

function largeTableNode(overrides = {}) {
  const rows = 50
  const columns = 12
  return tableNode({
    w: 360,
    h: 260,
    tableRows: rows,
    tableColumns: columns,
    tableHeaders: Array.from({ length: columns }, (_, column) => `Header ${column + 1}`),
    tableCells: Array.from({ length: rows }, (_, row) => (
      Array.from({ length: columns }, (_, column) => `R${row + 1}C${column + 1}`)
    )),
    tableColumnWidthsPx: Array.from({ length: columns }, () => 80),
    tableHeaderHeight: 30,
    tableRowHeight: 24,
    tableRowHeights: Array.from({ length: rows }, () => 24),
    ...overrides
  })
}

function largeTableTracks(node) {
  return {
    rowHeights: [node.tableHeaderHeight, ...node.tableRowHeights],
    columnWidths: node.tableColumnWidthsPx
  }
}

test('shows and hides both time icons independently', async () => {
  const visible = await renderTime()
  const withoutLeft = await renderTime({ timeShowLeftIcon: false })
  const withoutRight = await renderTime({ timeShowRightIcon: false })
  const withoutBoth = await renderTime({ timeShowLeftIcon: false, timeShowRightIcon: false })

  assert.match(visible, /data-testid="time-left-icon"/)
  assert.doesNotMatch(visible, /hide-right-icon/)
  assert.doesNotMatch(withoutLeft, /data-testid="time-left-icon"/)
  assert.doesNotMatch(withoutLeft, /hide-right-icon/)
  assert.match(withoutRight, /data-testid="time-left-icon"/)
  assert.match(withoutRight, /class="[^"]*hide-right-icon[^"]*form-time-visual/)
  assert.doesNotMatch(withoutBoth, /data-testid="time-left-icon"/)
  assert.match(withoutBoth, /class="[^"]*hide-right-icon[^"]*form-time-visual/)
})

test('renders the configured time text size and weight', async () => {
  const styled = await renderTime({ fontSize: 32, fontWeight: '700' })

  assert.match(styled, /font-size:32px/)
  assert.match(styled, /font-weight:700/)
  assert.match(styled, /data-testid="time-input"/)
})

test('renders every edited table column at its exact pixel width', async () => {
  const html = await renderTable()

  assert.match(html, /grid-template-columns:130px 105px 105px 105px 40px(?:;|\")/)
  assert.doesNotMatch(html, /grid-template-columns:[^;\"]*1fr/)
})

test('bounds a 50 by 12 table to the cells intersecting its viewport', async () => {
  const node = largeTableNode()
  const tracks = largeTableTracks(node)
  const window = createTableVirtualWindow({
    ...tracks,
    viewportWidth: node.w,
    viewportHeight: node.h,
    overscanRows: 1,
    overscanColumns: 1
  })
  const cells = createTableCellModels(node, window)
  const html = await renderTable(node)
  const renderedCells = html.match(/data-table-cell-key=/g) || []

  assert.equal(shouldVirtualizeTable(node), true)
  assert.ok(cells.length <= 84, `expected at most 84 visible cells, received ${cells.length}`)
  assert.ok(renderedCells.length <= 120, `expected at most 120 mounted cells, received ${renderedCells.length}`)
  assert.match(html, /data-table-cell-key="cell:0:0"/)
  assert.doesNotMatch(html, /data-table-cell-key="cell:49:11"/)
})

test('a virtual table window reaches the final row and column on scroll', () => {
  const node = largeTableNode()
  const tracks = largeTableTracks(node)
  const totalHeight = tracks.rowHeights.reduce((total, height) => total + height, 0)
  const totalWidth = tracks.columnWidths.reduce((total, width) => total + width, 0)
  const window = createTableVirtualWindow({
    ...tracks,
    scrollTop: totalHeight - node.h,
    scrollLeft: totalWidth - node.w,
    viewportWidth: node.w,
    viewportHeight: node.h,
    overscanRows: 1,
    overscanColumns: 1
  })
  const cells = createTableCellModels(node, window)

  assert.equal(window.rowEnd, tracks.rowHeights.length)
  assert.equal(window.columnEnd, tracks.columnWidths.length)
  assert.equal(cells.find(cell => cell.key === 'cell:49:11')?.text, 'R50C12')
})

test('virtual windows preserve every cell and cross-window merge origin', () => {
  const node = largeTableNode({
    tableMerges: [
      { row: 0, column: 0, rowSpan: 4, columnSpan: 3 },
      { row: 40, column: 9, rowSpan: 10, columnSpan: 3 }
    ]
  })
  const tracks = largeTableTracks(node)
  const fullCells = createTableCellModels(node)
  const visited = new Map()
  let scrollTop = 0

  for (let row = 0; row < tracks.rowHeights.length; row += 1) {
    let scrollLeft = 0
    for (let column = 0; column < tracks.columnWidths.length; column += 1) {
      const window = createTableVirtualWindow({
        ...tracks,
        scrollTop,
        scrollLeft,
        viewportWidth: 1,
        viewportHeight: 1,
        overscanRows: 0,
        overscanColumns: 0
      })
      for (const cell of createTableCellModels(node, window)) visited.set(cell.key, cell)
      scrollLeft += tracks.columnWidths[column]
    }
    scrollTop += tracks.rowHeights[row]
  }

  assert.deepEqual([...visited.keys()].sort(), fullCells.map(cell => cell.key).sort())
  assert.deepEqual(
    visited.get('cell:40:9'),
    fullCells.find(cell => cell.key === 'cell:40:9')
  )
  assert.equal(visited.has('cell:49:11'), false, 'covered merged cells must stay omitted')
})

test('keeps the title, header, and body on one fixed-width table surface', async () => {
  const underflow = await renderTable(tableNode({ showTableTitle: true, tableTitle: 'Delivery', w: 500 }))
  const overflow = await renderTable(tableNode({ showTableTitle: true, tableTitle: 'Delivery', w: 300 }))

  for (const html of [underflow, overflow]) {
    assert.match(html, /class="form-table-content" style="width:485px(?:;|\")/)
    assert.match(html, /class="form-table-title"[^>]*>Delivery<\/div>/)
    assert.match(html, /grid-template-columns:130px 105px 105px 105px 40px(?:;|\")/)
  }
  assert.match(overflow, /class="form-table-wrapper" style="[^"]*overflow-x:auto/)
})

test('renders the right border of the final table column', async () => {
  const html = await renderTable()

  assert.match(html, /<span class="header" style="[^"]*border-right-width:1px[^"]*"[^>]*>Address<\/span>/)
  assert.match(html, /<span[^>]*style="[^"]*border-right-width:1px[^"]*"[^>]*>1518 Jinshajiang Road<\/span>/)
})

test('applies each grid line style only to the right and bottom cell edges', async () => {
  for (const gridStyle of ['solid', 'dashed', 'dotted']) {
    const html = await renderTable(tableNode({ tableGridStyle: gridStyle }))
    const cellStyle = html.match(/<span[^>]*style="([^"]*)"[^>]*>Alice<\/span>/)?.[1] || ''

    assert.match(cellStyle, /(?:^|;)border-top-width:0(?:;|$)/)
    assert.match(cellStyle, /(?:^|;)border-left-width:0(?:;|$)/)
    assert.match(cellStyle, /(?:^|;)border-top-style:none(?:;|$)/)
    assert.match(cellStyle, /(?:^|;)border-left-style:none(?:;|$)/)
    assert.match(cellStyle, new RegExp(`(?:^|;)border-right-style:${gridStyle}(?:;|$)`))
    assert.match(cellStyle, new RegExp(`(?:^|;)border-bottom-style:${gridStyle}(?:;|$)`))
    assert.doesNotMatch(cellStyle, /(?:^|;)border-style:/)
  }
})

test('draws the title and leading inner frame once when it differs from the outer frame', async () => {
  const borderOptions = {
    tableGridWidth: 3,
    tableGridColor: '#ff0000',
    tableGridStyle: 'dashed',
    tableBorderWidth: 1,
    tableBorderColor: '#ebeef5',
    tableBorderStyle: 'solid'
  }
  const titled = await renderTable(tableNode({ ...borderOptions, showTableTitle: true, tableTitle: 'Delivery' }))
  const untitled = await renderTable(tableNode({ ...borderOptions, showTableTitle: false }))
  const withoutHeader = await renderTable(tableNode({ ...borderOptions, showTableTitle: false, showHeader: false }))
  const spanStyle = (html, text) => html.match(new RegExp(`<span[^>]*style="([^"]*)"[^>]*>${text}<\\/span>`))?.[1] || ''
  const titleStyle = titled.match(/class="form-table-title" style="([^"]*)"/)?.[1] || ''

  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.match(titleStyle, new RegExp(`(?:^|;)border-${edge}-width:3px(?:;|$)`))
    assert.match(titleStyle, new RegExp(`(?:^|;)border-${edge}-style:dashed(?:;|$)`))
  }

  const titledHeader = spanStyle(titled, 'Date')
  const titledFirstCell = spanStyle(titled, '2016-05-03')
  assert.match(titledHeader, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(titledHeader, /(?:^|;)border-left-width:3px(?:;|$)/)
  assert.match(titledFirstCell, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(titledFirstCell, /(?:^|;)border-left-width:3px(?:;|$)/)

  const firstHeader = spanStyle(untitled, 'Date')
  const nextHeader = spanStyle(untitled, 'Name')
  const firstBodyCell = spanStyle(untitled, '2016-05-03')
  const internalCell = spanStyle(untitled, 'Alice')
  assert.match(firstHeader, /(?:^|;)border-top-width:3px(?:;|$)/)
  assert.match(firstHeader, /(?:^|;)border-left-width:3px(?:;|$)/)
  assert.match(nextHeader, /(?:^|;)border-top-width:3px(?:;|$)/)
  assert.match(nextHeader, /(?:^|;)border-left-width:0(?:;|$)/)
  assert.match(firstBodyCell, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(firstBodyCell, /(?:^|;)border-left-width:3px(?:;|$)/)
  assert.match(internalCell, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(internalCell, /(?:^|;)border-left-width:0(?:;|$)/)

  const firstVisibleCell = spanStyle(withoutHeader, '2016-05-03')
  assert.match(firstVisibleCell, /(?:^|;)border-top-width:3px(?:;|$)/)
  assert.match(firstVisibleCell, /(?:^|;)border-left-width:3px(?:;|$)/)
})

test('reuses a matching outer frame instead of doubling the title and leading edges', async () => {
  const html = await renderTable(tableNode({ showTableTitle: true, tableTitle: 'Delivery', w: 487 }))
  const titleStyle = html.match(/class="form-table-title" style="([^"]*)"/)?.[1] || ''
  const firstHeaderStyle = html.match(/<span class="header" style="([^"]*)"[^>]*>Date<\/span>/)?.[1] || ''

  assert.match(titleStyle, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(titleStyle, /(?:^|;)border-right-width:0(?:;|$)/)
  assert.match(titleStyle, /(?:^|;)border-bottom-width:1px(?:;|$)/)
  assert.match(titleStyle, /(?:^|;)border-left-width:0(?:;|$)/)
  assert.match(firstHeaderStyle, /(?:^|;)border-top-width:0(?:;|$)/)
  assert.match(firstHeaderStyle, /(?:^|;)border-left-width:0(?:;|$)/)
})

test('does not double the final border when columns reach the outer frame', async () => {
  const exact = await renderTable(tableNode({ w: 487 }))
  const overflow = await renderTable(tableNode({ w: 300 }))

  assert.match(exact, /<span class="header" style="[^"]*border-right-width:0[^"]*"[^>]*>Address<\/span>/)
  assert.match(overflow, /<span class="header" style="[^"]*border-right-width:0[^"]*"[^>]*>Address<\/span>/)
})

test('keeps the final right grid border when its style differs from the outer frame', async () => {
  const widerGrid = await renderTable(tableNode({ w: 487, tableGridWidth: 3 }))
  const differentColor = await renderTable(tableNode({ w: 487, tableGridColor: '#ff0000' }))
  const differentStyle = await renderTable(tableNode({ w: 487, tableGridStyle: 'dashed' }))

  assert.match(widerGrid, /<span class="header" style="[^"]*border-right-width:3px[^"]*"[^>]*>Address<\/span>/)
  assert.match(differentColor, /<span class="header" style="[^"]*border-right-width:1px[^"]*"[^>]*>Address<\/span>/)
  assert.match(differentStyle, /<span class="header" style="[^"]*border-right-width:1px[^"]*"[^>]*>Address<\/span>/)
})

test('renders the bottom grid border on the final row and bottom-edge merged cells', async () => {
  const regular = await renderTable()
  const merged = await renderTable(tableNode({ tableMerges: [{ row: 0, column: 0, rowSpan: 2, columnSpan: 2 }] }))

  assert.match(regular, /<span[^>]*style="[^"]*border-bottom-width:1px[^"]*grid-row:3 \/ span 1[^"]*"[^>]*>2016-05-02<\/span>/)
  assert.match(merged, /<span class="[^"]*merged[^"]*" style="[^"]*border-bottom-width:1px[^"]*grid-row:2 \/ span 2[^"]*"[^>]*>2016-05-03<\/span>/)
})

test('uses the outer bottom frame only when content reaches it with the same style', async () => {
  const exact = await renderTable(tableNode({ h: 140 }))
  const overflow = await renderTable(tableNode({ h: 100 }))
  const differentGrid = await renderTable(tableNode({ h: 140, tableGridWidth: 3 }))

  assert.match(exact, /<span[^>]*style="[^"]*border-bottom-width:0[^"]*grid-row:3 \/ span 1[^"]*"[^>]*>2016-05-02<\/span>/)
  assert.match(overflow, /<span[^>]*style="[^"]*border-bottom-width:0[^"]*grid-row:3 \/ span 1[^"]*"[^>]*>2016-05-02<\/span>/)
  assert.match(differentGrid, /<span[^>]*style="[^"]*border-bottom-width:3px[^"]*grid-row:3 \/ span 1[^"]*"[^>]*>2016-05-02<\/span>/)
})

test('renders the right border of a merged cell ending in the final column', async () => {
  const html = await renderTable(tableNode({ tableMerges: [{ row: 0, column: 3, rowSpan: 1, columnSpan: 2 }] }))

  assert.match(html, /<span class="[^"]*merged[^"]*" style="[^"]*border-right-width:1px[^"]*grid-column:4 \/ span 2[^"]*"[^>]*>Putuo<\/span>/)
})

test('renders the edited header and per-row heights', async () => {
  const html = await renderTable()

  assert.match(html, /grid-template-rows:36px 44px 58px(?:;|\")/)
})

test('keeps table content on its original layout while a group scales it visually', async () => {
  const html = await renderTable(tableNode({ w: 250, h: 150, visualScaleX: .5, visualScaleY: .5 }))

  assert.match(html, /class="node-visual-scale-frame" style="width:500px;height:300px;transform:scale\(0\.5, 0\.5\);?"/)
  assert.match(html, /grid-template-columns:130px 105px 105px 105px 40px(?:;|\")/)
  assert.match(html, /grid-template-rows:36px 44px 58px(?:;|\")/)
})

test('renders line width and height as its actual SVG geometry', async () => {
  const html = await renderLine()

  assert.match(html, /data-testid="line-shape-visual"/)
  assert.match(html, /viewBox="0 0 160 7\.5"/)
  assert.match(html, /<rect[^>]*data-testid="line-shape-body"[^>]*fill="#abcdef"/)
  assert.match(html, /stroke="#123456"/)
  assert.match(html, /stroke-width="1"/)
})

test('renders dashed and dotted styles on the line body instead of only its outline', async () => {
  const dashed = await renderLine({ borderStyle: 'dashed', borderDashLength: 10, borderDashGap: 4 })
  const dotted = await renderLine({ borderStyle: 'dotted', borderDashLength: 2, borderDashGap: 5 })

  assert.doesNotMatch(dashed, /<rect/)
  assert.match(dashed, /<line[^>]*data-testid="line-shape-body"[^>]*stroke-width="7\.5"[^>]*stroke-dasharray="10 4"[^>]*stroke-linecap="butt"/)
  assert.match(dashed, /<line[^>]*data-testid="line-shape-body-fill"[^>]*stroke="#abcdef"[^>]*stroke-width="5\.5"[^>]*stroke-dasharray="10 4"/)
  assert.doesNotMatch(dotted, /<rect/)
  assert.match(dotted, /<line[^>]*data-testid="line-shape-body"[^>]*x1="3\.75"[^>]*x2="156\.25"[^>]*stroke-dasharray="2 12\.5"[^>]*stroke-linecap="round"/)
})

test('keeps a dashed line body visible when its outline is disabled', async () => {
  const html = await renderLine({ borderVisible: false, borderStyle: 'dashed', borderDashLength: 9, borderDashGap: 3 })

  assert.match(html, /<line[^>]*data-testid="line-shape-body"[^>]*stroke="#abcdef"[^>]*stroke-width="7\.5"[^>]*stroke-dasharray="9 3"/)
  assert.doesNotMatch(html, /data-testid="line-shape-body-fill"/)
})

test('keeps an adjustable border visible on the thinnest supported line', async () => {
  const html = await renderLine({ h: .1, borderWidth: 1 })
  const borderWidth = lineShapeBorderWidth({ h: .1, w: 160, borderWidth: 1 })

  assert.ok(borderWidth > 0)
  assert.ok(borderWidth < .1)
  assert.match(html, /viewBox="0 0 160 0\.1"/)
  assert.match(html, /stroke-width="0\.09\d*"/)
  assert.match(html, /height="0\.01\d*"/)
})

test('uses one line geometry and border style contract for canvas and SVG renderers', () => {
  const dotted = {
    w: 0,
    h: 0,
    borderWidth: 4,
    borderStyle: 'dotted',
    borderDashLength: .05,
    borderDashGap: 3
  }

  assert.equal(lineShapeWidth(dotted), 1)
  assert.equal(lineShapeHeight(dotted), .1)
  assert.equal(lineShapeBorderWidth(dotted), .1 - LINE_SHAPE_MIN_INNER_SIZE)
  assert.deepEqual(lineShapeDashSegments(dotted), [.1, 3])
  assert.equal(lineShapeDashArray(dotted), '0.1 3')
  assert.deepEqual(lineShapeBodyDashSegments(dotted), [.1, 3.1])
  assert.equal(lineShapeBodyDashArray(dotted), '0.1 3.1')
  assert.equal(lineShapeBodyInset(dotted), .05)
  assert.equal(lineShapeInnerThickness({ ...dotted, w: 160, h: 7.5, borderWidth: 1 }), 5.5)
  assert.deepEqual(lineShapeDashSegments({ borderStyle: 'solid' }), [])
  assert.equal(lineShapeDashArray({ borderStyle: 'solid' }), 'none')
  assert.deepEqual(lineShapeBodyDashSegments({ borderStyle: 'solid' }), [])
  assert.equal(lineShapeBodyDashArray({ borderStyle: 'solid' }), 'none')
})
