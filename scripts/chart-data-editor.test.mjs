import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addChartRow,
  MAX_EDITABLE_CHART_ITEMS,
  removeChartRow,
  setChartRowLabel,
  setChartRowValue
} from '../src/utils/chartDataEditor.js'

test('updates labels by sourceIndex without compressing labels around invalid rows', () => {
  const node = {
    type: 'barChart',
    chartData: [10, 'bad', 20],
    chartLabels: ['计划', '无效占位', '实际', '尾部标签']
  }
  const before = structuredClone(node)

  const patch = setChartRowLabel(node, { index: 1, sourceIndex: 2, label: '实际' }, '完成')

  assert.deepEqual(patch, { chartLabels: ['计划', '无效占位', '完成', '尾部标签'] })
  assert.deepEqual(node, before)
})

test('uses legacy xAxisData as the label baseline and keeps source alignment', () => {
  const patch = setChartRowLabel({
    type: 'lineChart',
    chartData: [1, 2, 3],
    xAxisData: ['一月', '二月', '三月']
  }, { sourceIndex: 1 }, '第二月')

  assert.deepEqual(patch, { chartLabels: ['一月', '第二月', '三月'] })
})

test('updates scalar rows in place while preserving arrays, objects and wrapper metadata', () => {
  const rows = [
    [2026, 35, '台'],
    { category: '实际', value: 70, unit: '台' },
    { category: '预测', reading: 82, unit: '台' }
  ]
  const node = {
    type: 'barChart',
    chartData: { revision: 7, source: 'manual', rows }
  }
  const before = structuredClone(node)

  const arrayPatch = setChartRowValue(node, { sourceIndex: 0, value: 35 }, 41)
  assert.deepEqual(arrayPatch.chartData, {
    revision: 7,
    source: 'manual',
    rows: [[2026, 41, '台'], rows[1], rows[2]]
  })

  const objectPatch = setChartRowValue(node, { sourceIndex: 1, value: 70 }, 74)
  assert.deepEqual(objectPatch.chartData.rows[1], {
    category: '实际', value: 74, unit: '台'
  })

  const inferredFieldPatch = setChartRowValue(node, { sourceIndex: 2, value: 82 }, 90)
  assert.deepEqual(inferredFieldPatch.chartData.rows[2], {
    category: '预测', reading: 90, unit: '台'
  })
  assert.deepEqual(node, before)
})

test('preserves rows beyond the editor and renderer mapping limits', () => {
  const rows = Array.from({ length: 2105 }, (_, index) => ({ value: index, tag: `row-${index}` }))
  const node = { type: 'lineChart', chartData: { rows, cursor: 'next-page' } }

  const patch = setChartRowValue(node, { sourceIndex: 2, value: 2 }, 200)

  assert.equal(patch.chartData.rows.length, 2105)
  assert.deepEqual(patch.chartData.rows[2], { value: 200, tag: 'row-2' })
  assert.strictEqual(patch.chartData.rows[2104], rows[2104])
  assert.equal(patch.chartData.cursor, 'next-page')
})

test('preserves every supported scatter row representation and its extra fields', () => {
  const valueArrayNode = {
    type: 'scatterChart',
    chartData: [{ name: 'A', value: [2, 5, 'quality-good'], unit: 'MPa' }]
  }
  const valueArrayPatch = setChartRowValue(
    valueArrayNode,
    { sourceIndex: 0, x: 2, y: 5 },
    8,
    { field: 'y' }
  )
  assert.deepEqual(valueArrayPatch.chartData, [
    { name: 'A', value: [2, 8, 'quality-good'], unit: 'MPa' }
  ])

  const xyNode = {
    type: 'scatterChart',
    chartData: [{ name: 'B', x: 3, y: 7, unit: 'MPa' }]
  }
  const xyPatch = setChartRowValue(xyNode, { sourceIndex: 0, x: 3, y: 7 }, 4, { field: 'x' })
  assert.deepEqual(xyPatch.chartData, [{ name: 'B', x: 4, y: 7, unit: 'MPa' }])

  const arrayNode = { type: 'scatterChart', chartData: [[1, 9, 'sample-1']] }
  const arrayPatch = setChartRowValue(arrayNode, { sourceIndex: 0, x: 1, y: 9 }, 11, { field: 'y' })
  assert.deepEqual(arrayPatch.chartData, [[1, 11, 'sample-1']])

  const scalarNode = { type: 'scatterChart', chartData: [6] }
  assert.deepEqual(
    setChartRowValue(scalarNode, { sourceIndex: 0, x: 1, y: 6 }, 10, { field: 'y' }).chartData,
    [10]
  )
  assert.deepEqual(
    setChartRowValue(scalarNode, { sourceIndex: 0, x: 1, y: 6 }, 4, { field: 'x' }).chartData,
    [[4, 6]]
  )
})

test('clamps pie values at zero in the data layer', () => {
  const patch = setChartRowValue(
    { type: 'pieChart', chartData: [{ name: '停止', value: 2, unit: '台' }] },
    { sourceIndex: 0, value: 2 },
    -10
  )

  assert.deepEqual(patch.chartData, [{ name: '停止', value: 0, unit: '台' }])
})

test('returns null for invalid row indexes, empty values and invalid scatter fields', () => {
  const node = { type: 'scatterChart', chartData: [[1, 2]] }
  assert.equal(setChartRowLabel(node, {}, '名称'), null)
  assert.equal(setChartRowLabel(node, { sourceIndex: null }, '名称'), null)
  assert.equal(setChartRowLabel(node, { sourceIndex: '' }, '名称'), null)
  assert.equal(setChartRowLabel(node, { sourceIndex: false }, '名称'), null)
  assert.equal(setChartRowLabel(node, { sourceIndex: 100_000_000 }, '名称'), null)
  assert.equal(setChartRowValue(node, { sourceIndex: 0 }, ''), null)
  assert.equal(setChartRowValue(node, { sourceIndex: 0 }, Number.NaN), null)
  assert.equal(setChartRowValue(node, { sourceIndex: 0 }, 3, { field: 'value' }), null)
})

test('adds after the raw data tail without discarding invalid rows or wrapper fields', () => {
  const node = {
    type: 'barChart',
    chartData: { rows: [10, 'bad', { value: 20, unit: '台' }], revision: 8 },
    chartLabels: ['计划', '无效占位', '实际', '保留标签']
  }
  const normalizedRows = [
    { index: 0, sourceIndex: 0, label: '计划', value: 10 },
    { index: 1, sourceIndex: 2, label: '实际', value: 20 }
  ]

  const patch = addChartRow(node, normalizedRows)

  assert.deepEqual(patch.chartData, {
    rows: [10, 'bad', { value: 20, unit: '台' }, 20],
    revision: 8
  })
  assert.deepEqual(patch.chartLabels, ['计划', '无效占位', '实际', '数据 3', '保留标签'])
})

test('adds a scatter point using the preceding displayed point', () => {
  const rows = [
    { index: 0, sourceIndex: 0, label: 'A', x: 2, y: 9 },
    { index: 1, sourceIndex: 1, label: 'B', x: 5, y: 12 }
  ]
  const patch = addChartRow({ type: 'scatterChart', chartData: [[2, 9], [5, 12]] }, rows)

  assert.deepEqual(patch.chartData, [[2, 9], [5, 12], [6, 12]])
  assert.equal(patch.chartLabels.length, 3)
  assert.equal(patch.chartLabels[2], '数据 3')
})

test('keeps manual chart editing independent from the 12-item runtime binding budget', () => {
  const chartData = Array.from({ length: 12 }, (_, index) => index + 1)
  const chartLabels = Array.from({ length: 12 }, (_, index) => `扇区 ${index + 1}`)
  const rows = chartData.map((value, index) => ({
    index,
    sourceIndex: index,
    label: chartLabels[index],
    value
  }))

  const patch = addChartRow({ type: 'pieChart', chartData, chartLabels }, rows)

  assert.equal(MAX_EDITABLE_CHART_ITEMS, 2000)
  assert.equal(patch.chartData.length, 13)
  assert.equal(patch.chartLabels.length, 13)
  assert.equal(patch.chartLabels[12], '数据 13')
})

test('inserts new rows after visible source data while retaining an oversized raw tail', () => {
  const rawRows = [10, ...Array.from({ length: 2100 }, (_, index) => `invalid-${index}`)]
  const labels = ['当前值', ...Array.from({ length: 2100 }, (_, index) => `尾部 ${index + 1}`)]
  const node = { type: 'barChart', chartData: { rows: rawRows, revision: 3 }, chartLabels: labels }
  const rows = [{ index: 0, sourceIndex: 0, label: '当前值', value: 10 }]

  const patch = addChartRow(node, rows)

  assert.equal(patch.chartData.rows.length, 2102)
  assert.deepEqual(patch.chartData.rows.slice(0, 3), [10, 10, 'invalid-0'])
  assert.equal(patch.chartData.rows.at(-1), 'invalid-2099')
  assert.equal(patch.chartData.revision, 3)
  assert.deepEqual(patch.chartLabels.slice(0, 3), ['当前值', '数据 2', '尾部 1'])
  assert.equal(patch.chartLabels.at(-1), '尾部 2100')
})

test('does not report a successful add when the insertion would be outside the mapped window', () => {
  const rawRows = Array.from({ length: 2105 }, (_, index) => `invalid-${index}`)
  rawRows[0] = 10
  rawRows[1999] = 20
  const node = { type: 'barChart', chartData: { rows: rawRows, revision: 6 } }
  const rows = [
    { index: 0, sourceIndex: 0, label: '第一项', value: 10 },
    { index: 1, sourceIndex: 1999, label: '第二项', value: 20 }
  ]

  assert.equal(addChartRow(node, rows, { value: 77 }), null)
  assert.equal(node.chartData.rows.length, 2105)
  assert.equal(node.chartData.rows[1999], 20)
})

test('deletes the raw source row and matching label instead of the filtered row index', () => {
  const node = {
    type: 'radarChart',
    chartData: { rows: [10, 'bad', { value: 20, unit: '%' }], revision: 2 },
    chartLabels: ['压力', '无效占位', '温度', '尾部标签']
  }
  const normalizedRows = [
    { index: 0, sourceIndex: 0, label: '压力', value: 10 },
    { index: 1, sourceIndex: 2, label: '温度', value: 20 }
  ]
  const before = structuredClone(node)

  const patch = removeChartRow(node, normalizedRows[1], { rows: normalizedRows })

  assert.deepEqual(patch.chartData, { rows: [10, 'bad'], revision: 2 })
  assert.deepEqual(patch.chartLabels, ['压力', '无效占位', '尾部标签'])
  assert.deepEqual(node, before)
})

test('materializes all default-derived rows before value, add or remove operations', () => {
  const defaults = [
    { index: 0, sourceIndex: 0, label: '一月', value: 10 },
    { index: 1, sourceIndex: 1, label: '二月', value: 20 },
    { index: 2, sourceIndex: 2, label: '三月', value: 30 }
  ]
  const emptyNode = { type: 'lineChart', chartData: [] }

  assert.deepEqual(
    setChartRowValue(emptyNode, defaults[1], 25, { rows: defaults }),
    { chartData: [10, 25, 30], chartLabels: ['一月', '二月', '三月'] }
  )
  assert.deepEqual(
    addChartRow(emptyNode, defaults),
    { chartData: [10, 20, 30, 30], chartLabels: ['一月', '二月', '三月', '数据 4'] }
  )
  assert.deepEqual(
    removeChartRow(emptyNode, defaults[1], { rows: defaults }),
    { chartData: [10, 30], chartLabels: ['一月', '三月'] }
  )

  const invalidWrappedNode = {
    type: 'barChart',
    chartData: { rows: ['bad', { value: 'not-a-number' }], source: 'legacy' }
  }
  assert.deepEqual(
    setChartRowValue(invalidWrappedNode, defaults[0], 11, { rows: defaults }),
    {
      chartData: { rows: [11, 20, 30], source: 'legacy' },
      chartLabels: ['一月', '二月', '三月']
    }
  )
})

test('materializing defaults preserves data and label tails beyond the mapped source window', () => {
  const rawRows = Array.from({ length: 2101 }, (_, index) => `invalid-${index}`)
  rawRows[2100] = { value: 99, source: 'late-row' }
  const labels = Array.from({ length: 2101 }, (_, index) => `原标签 ${index + 1}`)
  const defaults = [
    { index: 0, sourceIndex: 0, label: '一'.repeat(180), value: 10 },
    { index: 1, sourceIndex: 1, label: '二月', value: 20 },
    { index: 2, sourceIndex: 2, label: '三月', value: 30 },
    { index: 3, sourceIndex: 3, label: '四月', value: 40 },
    { index: 4, sourceIndex: 4, label: '五月', value: 50 },
    { index: 5, sourceIndex: 5, label: '六月', value: 60 }
  ]
  const node = {
    type: 'barChart',
    chartData: { rows: rawRows, source: 'legacy', revision: 4 },
    chartLabels: labels
  }

  const patch = setChartRowValue(node, defaults[0], 42, { rows: defaults })

  assert.equal(patch.chartData.rows.length, 2101)
  assert.deepEqual(patch.chartData.rows.slice(0, 6), [42, 20, 30, 40, 50, 60])
  assert.deepEqual(patch.chartData.rows[2100], { value: 99, source: 'late-row' })
  assert.equal(patch.chartData.source, 'legacy')
  assert.equal(patch.chartData.revision, 4)
  assert.equal(patch.chartLabels.length, 2101)
  assert.deepEqual(patch.chartLabels.slice(0, 6), ['一'.repeat(180), '二月', '三月', '四月', '五月', '六月'])
  assert.equal(patch.chartLabels[0].length, 180)
  assert.equal(patch.chartLabels[2100], '原标签 2101')

  const added = addChartRow(node, defaults)
  assert.equal(added.chartData.rows.length, 2102)
  assert.deepEqual(added.chartData.rows.slice(0, 7), [10, 20, 30, 40, 50, 60, 60])
  assert.deepEqual(added.chartData.rows[2101], { value: 99, source: 'late-row' })
  assert.equal(added.chartLabels[6], '数据 7')
  assert.equal(added.chartLabels[2101], '原标签 2101')

  const removed = removeChartRow(node, defaults[1], { rows: defaults })
  assert.equal(removed.chartData.rows.length, 2100)
  assert.deepEqual(removed.chartData.rows.slice(0, 5), [10, 30, 40, 50, 60])
  assert.deepEqual(removed.chartData.rows[2099], { value: 99, source: 'late-row' })
  assert.equal(removed.chartLabels[2099], '原标签 2101')
})
