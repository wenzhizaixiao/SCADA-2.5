import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBindableParameter,
  getBindableParameters
} from '../src/config/componentBindingSchema.js'
import {
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS,
  normalizeDataBindings,
  resolveBindingValue
} from '../src/models/dataBindingModel.js'
import {
  directBindingCompatibility,
  parameterDataFormatGuide,
  parameterValueTypeLabel
} from '../src/utils/dataBindingCompatibility.js'
import { materializeRuntimeNode } from '../src/utils/runtimeNodeMaterializer.js'
import { createTableCellModels } from '../src/utils/tableVirtualization.js'

function tableNode(overrides = {}) {
  return {
    type: 'table',
    text: '旧版显示文字',
    tableTitle: '静态标题',
    tableHeaders: ['静态列 A', '静态列 B'],
    tableCells: [['静态 A1', '静态 B1']],
    tableRows: 1,
    tableColumns: 2,
    dataBindings: [],
    ...overrides
  }
}

function pointGetter(values) {
  return key => values.get(key)
}

test('table schema exposes three focused targets while keeping bound legacy targets removable', () => {
  const currentTargets = getBindableParameters(tableNode()).map(parameter => parameter.target)
  assert.deepEqual(
    currentTargets.filter(target => ['tableTitle', 'tableHeaders', 'tableCells'].includes(target)),
    ['tableTitle', 'tableHeaders', 'tableCells']
  )
  assert.equal(currentTargets.includes('tableData'), false)
  assert.equal(currentTargets.includes('text'), false)
  assert.equal(currentTargets.includes('tableRows'), false)

  const legacyTargets = getBindableParameters(tableNode({
    dataBindings: [
      { target: 'tableData', pointId: 'legacy.table' },
      { target: 'text', pointId: 'legacy.title' }
    ]
  })).map(parameter => parameter.target)
  assert.ok(legacyTargets.includes('tableData'))
  assert.ok(legacyTargets.includes('text'))
  assert.equal(getBindableParameter('table', 'text')?.label, '旧版标题数据')
  assert.equal(getBindableParameter('table', 'text')?.legacy, true)

  assert.equal(getBindableParameter('table', 'tableTitle')?.label, '标题数据')
  assert.equal(getBindableParameter('table', 'tableHeaders')?.label, '表头数据')
  assert.equal(getBindableParameter('table', 'tableCells')?.label, '行表格数据')
  assert.ok(getBindableParameter('table', 'tableData'), 'legacy tableData must remain valid for reopen')

  const persisted = normalizeDataBindings(tableNode({
    dataBindings: [
      { target: 'tableData', pointId: 'legacy.table' },
      { target: 'tableTitle', pointId: 'table.title' },
      { target: 'tableHeaders', pointId: 'table.headers' },
      { target: 'tableCells', pointId: 'table.rows' }
    ]
  }))
  assert.deepEqual(persisted.map(binding => binding.target), [
    'tableData',
    'tableTitle',
    'tableHeaders',
    'tableCells'
  ])
})

test('table split targets document focused values with concise format variants', () => {
  const expected = [
    ['tableTitle', '标题文本', '标题数据格式', '$.table.title', '设备状态', 1],
    ['tableHeaders', '表头数据', '表头数据格式', '$.table.headers', ['设备', '数值', '状态'], 1],
    ['tableCells', '行表格数据', '行数据格式', '$.table.rows', [['设备 A', 42, '运行']], 2]
  ]

  for (const [target, label, title, path, value, exampleCount] of expected) {
    const parameter = getBindableParameter('table', target)
    const guide = parameterDataFormatGuide(parameter)
    assert.equal(parameterValueTypeLabel(parameter), label)
    assert.equal(guide.title, title)
    assert.equal(guide.examples.length, exampleCount)
    assert.equal(guide.examples[0].jsonPath, path)
    assert.equal(
      directBindingCompatibility(parameter, {
        type: Array.isArray(value) ? 'array' : typeof value,
        value
      }).compatible,
      true
    )
  }

  const rowGuide = parameterDataFormatGuide(getBindableParameter('table', 'tableCells'))
  assert.deepEqual(rowGuide.examples.map(example => example.label), [
    '二维数组',
    '对象行数组（兼容）'
  ])
  assert.deepEqual(rowGuide.examples.map(example => example.id), ['row-arrays', 'object-rows'])
  assert.ok(rowGuide.examples.every(example => example.description))
  assert.equal(rowGuide.examples[0].recommended, true)
  assert.equal(rowGuide.examples[1].jsonPath, '$.table.rows')

  assert.equal(
    directBindingCompatibility(getBindableParameter('table', 'tableHeaders'), {
      type: 'array',
      value: [{ key: 'device', title: '设备' }, { key: 'state', title: '状态' }]
    }).compatible,
    true
  )
  assert.equal(
    directBindingCompatibility(getBindableParameter('table', 'tableHeaders'), {
      type: 'object',
      value: { headers: ['设备'] }
    }).compatible,
    false
  )
})

test('row binding accepts one consistent row shape and treats an empty array as valid', () => {
  const parameter = getBindableParameter('table', 'tableCells')
  for (const value of [
    [],
    [['设备 A', 42], ['设备 B', 37]],
    [{ device: '设备 A', value: 42 }, { device: '设备 B', value: 37 }]
  ]) {
    assert.equal(directBindingCompatibility(parameter, { type: 'array', value }).compatible, true)
  }

  const mixedRows = [['设备 A', 42], { device: '设备 B', value: 37 }]
  const compatibility = directBindingCompatibility(parameter, { type: 'array', value: mixedRows })
  assert.equal(compatibility.compatible, false)
  assert.match(compatibility.reason, /不能混用/)
  assert.deepEqual(resolveBindingValue(tableNode(), 'tableCells', mixedRows), [['静态 A1', '静态 B1']])
})

test('split table values are normalized with fixed limits and detached from source data', () => {
  const node = tableNode()
  const headerSource = Array.from(
    { length: MAX_RUNTIME_TABLE_COLUMNS + 5 },
    (_, index) => index === 0 ? { key: 'device', title: '设备' } : `列 ${index + 1}`
  )
  const nested = { state: '运行' }
  const rowSource = Array.from(
    { length: MAX_RUNTIME_TABLE_ROWS + 5 },
    (_, index) => index === 0
      ? { device: '设备 A', detail: nested }
      : { device: `设备 ${index + 1}`, value: index }
  )

  const headers = resolveBindingValue(node, 'tableHeaders', headerSource)
  const rows = resolveBindingValue(node, 'tableCells', rowSource)

  assert.equal(headers.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.deepEqual(headers[0], { key: 'device', title: '设备' })
  assert.equal(rows.length, MAX_RUNTIME_TABLE_ROWS)
  assert.notStrictEqual(headers, headerSource)
  assert.notStrictEqual(headers[0], headerSource[0])
  assert.notStrictEqual(rows, rowSource)
  assert.notStrictEqual(rows[0], rowSource[0])
  assert.notStrictEqual(rows[0].detail, nested)

  headers[0].title = '已修改'
  rows[0].detail.state = '停止'
  assert.equal(headerSource[0].title, '设备')
  assert.equal(nested.state, '运行')
})

test('each split binding changes only its table section', () => {
  const titleOnly = materializeRuntimeNode(tableNode({
    dataBindings: [{ target: 'tableTitle', pointId: 'title' }]
  }), () => '动态标题')
  assert.equal(titleOnly.tableTitle, '动态标题')
  assert.deepEqual(titleOnly.tableHeaders, ['静态列 A', '静态列 B'])
  assert.deepEqual(titleOnly.tableCells, [['静态 A1', '静态 B1']])

  const headersOnly = materializeRuntimeNode(tableNode({
    dataBindings: [{ target: 'tableHeaders', pointId: 'headers' }]
  }), () => ['设备', '状态', '数值'])
  assert.equal(headersOnly.tableTitle, '静态标题')
  assert.deepEqual(headersOnly.tableHeaders, ['设备', '状态', '数值'])
  assert.deepEqual(headersOnly.tableCells, [['静态 A1', '静态 B1', '']])
  assert.equal(headersOnly.tableColumns, 3)
  assert.equal(headersOnly.tableRows, 1)

  const rowsOnly = materializeRuntimeNode(tableNode({
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => [['动态 A1', '动态 B1'], ['动态 A2', { state: '运行' }]])
  assert.equal(rowsOnly.tableTitle, '静态标题')
  assert.deepEqual(rowsOnly.tableHeaders, ['静态列 A', '静态列 B'])
  assert.deepEqual(rowsOnly.tableCells, [
    ['动态 A1', '动态 B1'],
    ['动态 A2', '{"state":"运行"}']
  ])
  assert.equal(rowsOnly.tableColumns, 2)
  assert.equal(rowsOnly.tableRows, 2)

  const rowsOnlyWithWidths = materializeRuntimeNode(tableNode({
    tableColumnWidthsPx: [140, 220],
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => [['动态 A1', '动态 B1', '动态 C1']])
  assert.deepEqual(rowsOnlyWithWidths.tableColumnWidthsPx, [140, 220, 180])
})

test('row data expands beyond short headers without truncating cells', () => {
  const effective = materializeRuntimeNode(tableNode({
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => [
    ['设备 A', 42, '运行'],
    ['设备 B', 37, '待机']
  ])

  assert.equal(effective.tableColumns, 3)
  assert.deepEqual(effective.tableHeaders, ['静态列 A', '静态列 B', '列 3'])
  assert.deepEqual(effective.tableCells, [
    ['设备 A', '42', '运行'],
    ['设备 B', '37', '待机']
  ])
})

test('object rows infer stable keys across rows and explicit header keys stay authoritative', () => {
  const rows = [
    { device: '风机 A', state: '运行' },
    { state: '停止', value: 37 }
  ]
  const inferred = materializeRuntimeNode(tableNode({
    tableHeaders: ['设备名称'],
    tableColumns: 1,
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => rows)

  assert.equal(inferred.tableColumns, 3)
  assert.deepEqual(inferred.tableHeaders, ['设备名称', '列 2', '列 3'])
  assert.deepEqual(inferred.tableCells, [
    ['风机 A', '运行', ''],
    ['', '停止', '37']
  ])

  const keyed = materializeRuntimeNode(tableNode({
    dataBindings: [
      { target: 'tableHeaders', pointId: 'headers' },
      { target: 'tableCells', pointId: 'rows' }
    ]
  }), pointGetter(new Map([
    ['headers', [{ key: 'state', title: '状态' }, '设备名称']],
    ['rows', [{ device: '风机 A', state: '运行', value: 42 }]]
  ])))

  assert.equal(keyed.tableColumns, 3)
  assert.deepEqual(keyed.tableHeaders, ['状态', '设备名称', '列 3'])
  assert.deepEqual(keyed.tableCells, [['运行', '风机 A', '42']])

  const emptyTitle = materializeRuntimeNode(tableNode({
    dataBindings: [
      { target: 'tableHeaders', pointId: 'headers' },
      { target: 'tableCells', pointId: 'rows' }
    ]
  }), pointGetter(new Map([
    ['headers', [{ key: 'state', title: '' }]],
    ['rows', [{ state: '运行', device: '风机 A' }]]
  ])))
  assert.deepEqual(emptyTitle.tableHeaders, ['列 1', '列 2'])
  assert.deepEqual(emptyTitle.tableCells, [['运行', '风机 A']])

  const titleOnlyHeader = materializeRuntimeNode(tableNode({
    dataBindings: [
      { target: 'tableHeaders', pointId: 'headers' },
      { target: 'tableCells', pointId: 'rows' }
    ]
  }), pointGetter(new Map([
    ['headers', [{ title: '设备' }]],
    ['rows', [{ device: '风机 A' }]]
  ])))
  assert.deepEqual(titleOnlyHeader.tableHeaders, ['设备'])
  assert.deepEqual(titleOnlyHeader.tableCells, [['风机 A']])
})

test('split table materialization enforces row and column budgets and preserves layout metadata', () => {
  const tableColumnWidths = [120, 180]
  const tableColumnWidthsPx = [140, 220]
  const tableRowHeights = [36, 42]
  const tableMerges = [{ row: 0, column: 0, rowSpan: 1, columnSpan: 2 }]
  const sourceRows = Array.from(
    { length: MAX_RUNTIME_TABLE_ROWS + 5 },
    (_, rowIndex) => Array.from(
      { length: MAX_RUNTIME_TABLE_COLUMNS + 5 },
      (_, columnIndex) => `${rowIndex}:${columnIndex}`
    )
  )
  const effective = materializeRuntimeNode(tableNode({
    tableHeaders: [],
    tableColumnWidths,
    tableColumnWidthsPx,
    tableRowHeights,
    tableMerges,
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => sourceRows)

  assert.equal(effective.tableColumns, MAX_RUNTIME_TABLE_COLUMNS)
  assert.equal(effective.tableRows, MAX_RUNTIME_TABLE_ROWS)
  assert.equal(effective.tableHeaders.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.equal(effective.tableCells.length, MAX_RUNTIME_TABLE_ROWS)
  assert.ok(effective.tableCells.every(row => row.length === MAX_RUNTIME_TABLE_COLUMNS))
  assert.equal(effective.tableCells.at(-1).at(-1), '49:11')
  assert.strictEqual(effective.tableColumnWidths, tableColumnWidths)
  assert.notStrictEqual(effective.tableColumnWidthsPx, tableColumnWidthsPx)
  assert.deepEqual(effective.tableColumnWidthsPx.slice(0, 3), [140, 220, 180])
  assert.equal(effective.tableColumnWidthsPx.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.deepEqual(tableColumnWidthsPx, [140, 220])
  assert.strictEqual(effective.tableRowHeights, tableRowHeights)
  assert.strictEqual(effective.tableMerges, tableMerges)
  assert.equal(sourceRows.length, MAX_RUNTIME_TABLE_ROWS + 5)
  assert.equal(sourceRows[0].length, MAX_RUNTIME_TABLE_COLUMNS + 5)

  const empty = materializeRuntimeNode(tableNode({
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  }), () => [])
  assert.equal(empty.tableRows, 1)
  assert.deepEqual(empty.tableCells, [['', '']])
})

test('runtime table rows render the saved merge layout within the current interface dimensions', () => {
  const tableMerges = [{ row: 0, column: 0, rowSpan: 3, columnSpan: 2 }]
  const node = tableNode({
    tableMerges,
    dataBindings: [{ target: 'tableCells', pointId: 'rows' }]
  })
  const compact = materializeRuntimeNode(node, () => [
    ['08:00', '278.06'],
    ['09:00', '312.82']
  ])
  const compactCells = createTableCellModels(compact)
  const compactMerge = compactCells.find(cell => cell.row === 0 && cell.column === 0)

  assert.equal(compactMerge.text, '08:00')
  assert.equal(compactMerge.rowSpan, 2)
  assert.equal(compactMerge.columnSpan, 2)
  assert.equal(compactCells.some(cell => cell.row === 1 && cell.column === 0), false)
  assert.strictEqual(compact.tableMerges, tableMerges)

  const expanded = materializeRuntimeNode(node, () => [
    ['08:00', '278.06'],
    ['09:00', '312.82'],
    ['10:00', '359.17'],
    ['11:00', '386.20']
  ])
  const expandedMerge = createTableCellModels(expanded)
    .find(cell => cell.row === 0 && cell.column === 0)

  assert.equal(expandedMerge.rowSpan, 3)
  assert.equal(expandedMerge.columnSpan, 2)
  assert.deepEqual(node.tableMerges, tableMerges)
})

test('new split bindings override legacy whole-table data independently of binding order', () => {
  const bindings = [
    { target: 'tableData', pointId: 'legacy.table' },
    { target: 'text', pointId: 'legacy.title' },
    { target: 'tableTitle', pointId: 'table.title' },
    { target: 'tableHeaders', pointId: 'table.headers' },
    { target: 'tableCells', pointId: 'table.rows' }
  ]
  const values = new Map([
    ['legacy.table', {
      columns: [{ key: 'legacyName', title: '旧设备' }, { key: 'legacyState', title: '旧状态' }],
      rows: [{ legacyName: '旧设备 A', legacyState: '旧状态 A' }]
    }],
    ['legacy.title', '旧动态标题'],
    ['table.title', '新动态标题'],
    ['table.headers', [
      { key: 'device', title: '设备' },
      { key: 'state', title: '状态' }
    ]],
    ['table.rows', [
      { device: '风机 A', state: '运行' },
      { device: '风机 B', state: '停止' }
    ]]
  ])

  const forwardNode = tableNode({ dataBindings: bindings })
  const reverseNode = tableNode({ dataBindings: [...bindings].reverse() })
  const forward = materializeRuntimeNode(forwardNode, pointGetter(values))
  const reverse = materializeRuntimeNode(reverseNode, pointGetter(values))

  for (const effective of [forward, reverse]) {
    assert.equal(effective.tableTitle, '新动态标题')
    assert.deepEqual(effective.tableHeaders, ['设备', '状态'])
    assert.deepEqual(effective.tableCells, [['风机 A', '运行'], ['风机 B', '停止']])
    assert.equal(effective.tableColumns, 2)
    assert.equal(effective.tableRows, 2)
  }
  assert.deepEqual(
    {
      title: forward.tableTitle,
      headers: forward.tableHeaders,
      cells: forward.tableCells
    },
    {
      title: reverse.tableTitle,
      headers: reverse.tableHeaders,
      cells: reverse.tableCells
    }
  )
  assert.equal(forwardNode.tableTitle, '静态标题')
  assert.deepEqual(values.get('table.rows')[0], { device: '风机 A', state: '运行' })
})

test('legacy table bindings work while an explicitly empty static title remains empty', () => {
  const effective = materializeRuntimeNode(tableNode({
    dataBindings: [
      { target: 'tableData', pointId: 'legacy.table' },
      { target: 'text', pointId: 'legacy.title' }
    ]
  }), pointGetter(new Map([
    ['legacy.table', {
      columns: [{ key: 'name', title: '设备' }],
      rows: [{ name: '风机 A' }]
    }],
    ['legacy.title', '旧图纸动态标题']
  ])))

  assert.equal(effective.tableTitle, '旧图纸动态标题')
  assert.deepEqual(effective.tableHeaders, ['设备'])
  assert.deepEqual(effective.tableCells, [['风机 A']])

  const missingRuntimeValue = materializeRuntimeNode(tableNode({
    text: '旧版静态标题',
    tableTitle: '',
    dataBindings: [{ target: 'text', pointId: 'missing.title' }]
  }), () => undefined)
  assert.equal(missingRuntimeValue.text, '')
  assert.equal(missingRuntimeValue.tableTitle, '')
})

test('full-cell viewer preserves the materialized value that the user clicked', async () => {
  const {
    createTableCellViewPayload,
    resolveTableCellViewDetail
  } = await import('../src/utils/tableCellViewer.js')

  const staticNode = tableNode({
    id: 'table-1',
    tableHeaders: ['静态列'],
    tableCells: [['静态值']],
    tableRows: 1,
    tableColumns: 1
  })
  const effectiveNode = materializeRuntimeNode({
    ...staticNode,
    dataBindings: [
      { target: 'tableHeaders', pointId: 'headers' },
      { target: 'tableCells', pointId: 'rows' }
    ]
  }, pointGetter(new Map([
    ['headers', ['动态列']],
    ['rows', [['动态值 1'], ['动态值 2']]]
  ])))
  const payload = createTableCellViewPayload(effectiveNode, {
    row: 1,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    text: effectiveNode.tableCells[1][0]
  })
  const detail = resolveTableCellViewDetail(staticNode, payload)

  assert.deepEqual(payload, {
    row: 1,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    title: '动态列',
    text: '动态值 2'
  })
  assert.deepEqual(detail, {
    title: '动态列',
    position: '第 2 行 · 第 1 列',
    text: '动态值 2'
  })
})
