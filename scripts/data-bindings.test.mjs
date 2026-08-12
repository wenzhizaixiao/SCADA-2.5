import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindingParameterFor,
  bindingParametersForType,
  getBindableParameters,
  isBindingTargetAllowed
} from '../src/config/componentBindingSchema.js'
import {
  MAX_NODE_DATA_BINDINGS,
  MAX_RUNTIME_TABLE_COLUMNS,
  MAX_RUNTIME_TABLE_ROWS,
  bindingRuntimeKey,
  bindingSourceIds,
  bindingPointIds,
  findBinding,
  normalizeDataBindings,
  removeDataBinding,
  resolveBindingValue,
  resolveNodeBindingValue,
  resolveNodeDataBindings,
  upsertDataBinding
} from '../src/models/dataBindingModel.js'
import { baseNodeOptions, normalizeNode } from '../src/models/editorModel.js'
import { createDataBindingIndex } from '../src/utils/dataBindingIndex.js'
import { sourceBindingRuntimeKey } from '../src/utils/jsonPathBinding.js'
import { ProjectValidationError, validateProjectForFrontend } from '../src/utils/projectValidation.js'

function projectWithNode(node) {
  return {
    version: 20,
    nodes: [{ id: 'node-1', type: 'rect', ...node }],
    edges: [],
    drawings: []
  }
}

test('binding schema exposes common and component-specific parameters from one whitelist', () => {
  const commonTargets = ['fill', 'stroke', 'opacity', 'text', 'animationPlaying', 'animationDuration']
  const rectangleTargets = bindingParametersForType('rect').map(item => item.target)
  const tableTargets = bindingParametersForType('table').map(item => item.target)
  const chartTargets = bindingParametersForType('chart').map(item => item.target)

  assert.deepEqual(rectangleTargets, commonTargets)
  assert.ok(commonTargets.every(target => isBindingTargetAllowed('table', target)))
  assert.ok(tableTargets.includes('tableData'))
  assert.ok(chartTargets.includes('chartData'))
  assert.equal(bindingParameterFor('checkbox', 'checked')?.valueType, 'boolean')
  assert.equal(bindingParameterFor('input', 'value')?.valueType, 'text')
  assert.equal(bindingParameterFor('progress', 'progressValue')?.valueType, 'number')
  assert.equal(bindingParameterFor('flowPipe', 'visualPrimaryColor')?.valueType, 'color')
  assert.deepEqual(
    { min: bindingParameterFor('waterTank', 'progressValue')?.min, max: bindingParameterFor('waterTank', 'progressValue')?.max },
    { min: 0, max: 100 }
  )
  assert.equal(bindingParameterFor('rect', '__proto__'), undefined)
  assert.equal(isBindingTargetAllowed('rect', 'style.fill'), false)
})

test('signal light communication mirrors the configured color slots and lamp opacity', () => {
  const node = {
    type: 'signalLight',
    signalColorCount: 4,
    signalColors: ['#21c58e', '#ef5350', '#ffc440', '#168eea'],
    signalOpacity: 0.8,
    dataBindings: []
  }
  const signalParameters = getBindableParameters(node)
    .filter(parameter => parameter.group === 'signal')
    .map(parameter => ({
      target: parameter.target,
      label: parameter.label,
      valueType: parameter.valueType,
      value: parameter.readStatic(node)
    }))

  assert.deepEqual(signalParameters, [
    { target: 'signalColors.0', label: '颜色 1', valueType: 'color', value: '#21c58e' },
    { target: 'signalColors.1', label: '颜色 2', valueType: 'color', value: '#ef5350' },
    { target: 'signalColors.2', label: '颜色 3', valueType: 'color', value: '#ffc440' },
    { target: 'signalColors.3', label: '颜色 4', valueType: 'color', value: '#168eea' },
    { target: 'signalOpacity', label: '灯光不透明度', valueType: 'number', value: 0.8 }
  ])
  assert.equal(bindingParameterFor('signalLight', 'signalColors.7')?.valueType, 'color')
  assert.equal(bindingParameterFor('signalLight', 'signalColors.8'), undefined)
  assert.equal(resolveBindingValue(node, 'signalOpacity', 2), 1)
  assert.equal(resolveBindingValue(node, 'signalOpacity', -1), 0)

  const reducedTargets = getBindableParameters({
    ...node,
    signalColorCount: 2,
    dataBindings: [{ target: 'signalColors.3', pointId: 'signal.fourth' }]
  }).map(parameter => parameter.target)
  assert.equal(reducedTargets.includes('signalColors.2'), false)
  assert.equal(reducedTargets.includes('signalColors.3'), true, 'a hidden configured binding must remain removable')
})

test('normalizes every bounded signal color target for save and reopen', () => {
  const node = {
    type: 'signalLight',
    dataBindings: [
      { target: 'signalColors.0', sourceId: 'signal-source', jsonPath: '$.states.run' },
      { target: 'signalColors.3', sourceId: 'signal-source', jsonPath: '$.states.alarm' },
      { target: 'signalOpacity', sourceId: 'signal-source', jsonPath: '$.opacity' },
      { target: 'signalColors.8', sourceId: 'signal-source', jsonPath: '$.invalid' }
    ]
  }

  assert.deepEqual(normalizeDataBindings(node), node.dataBindings.slice(0, 3).map(binding => ({
    ...binding,
    enabled: true
  })))
})

test('keeps an empty text parameter visible when it already has a source JSONPath binding', () => {
  const node = {
    type: 'rect',
    text: '',
    dataBindings: [{
      target: 'text',
      sourceId: 'source-http-line',
      jsonPath: '$.device.name',
      enabled: true
    }]
  }

  assert.ok(getBindableParameters(node).some(parameter => parameter.target === 'text'))
})

test('normalizes bindings to unique schema targets without changing legacy dataKey', () => {
  const normalized = normalizeNode({
    type: 'rect',
    w: 120,
    h: 80,
    dataKey: 'legacy.temperature',
    dataBindings: [
      { target: ' fill ', pointId: ' old.color ' },
      { target: 'unknown', pointId: 'ignored' },
      { target: 'fill', pointId: ' new.color ', enabled: false },
      { target: 'text', pointId: ' device.name ', adapter: { type: 'join', separator: ' / ' } },
      { target: 'stroke', pointId: '   ' }
    ]
  })

  assert.equal(normalized.dataKey, 'legacy.temperature')
  assert.deepEqual(normalized.dataBindings, [
    { target: 'fill', pointId: 'new.color', enabled: false },
    { target: 'text', pointId: 'device.name', adapter: { type: 'join', separator: ' / ' }, enabled: true }
  ])

  const firstDefaults = baseNodeOptions()
  const secondDefaults = baseNodeOptions()
  firstDefaults.dataBindings.push({ target: 'text', pointId: 'shared', enabled: true })
  assert.deepEqual(secondDefaults.dataBindings, [])
})

test('binding helpers are immutable, deduplicate point subscriptions, and keep targets unique', () => {
  const node = {
    type: 'rect',
    dataKey: 'legacy.value',
    dataBindings: [
      { target: 'fill', pointId: 'device.state', enabled: true },
      { target: 'stroke', pointId: 'device.state', enabled: true },
      { target: 'text', pointId: 'device.label', enabled: false }
    ]
  }

  assert.deepEqual(bindingPointIds(node), ['device.state'])
  assert.deepEqual(bindingPointIds(node, { enabledOnly: false }), ['device.state', 'device.label'])
  assert.deepEqual(bindingPointIds(node, { includeLegacy: true }), ['legacy.value', 'device.state'])
  assert.equal(findBinding(node, 'stroke')?.pointId, 'device.state')

  const replaced = upsertDataBinding(node, { target: 'fill', pointId: 'device.color' })
  assert.notStrictEqual(replaced, node.dataBindings)
  assert.equal(replaced.length, 3)
  assert.equal(replaced[0].pointId, 'device.color')
  assert.equal(node.dataBindings[0].pointId, 'device.state')

  const removed = removeDataBinding({ ...node, dataBindings: replaced }, 'stroke')
  assert.deepEqual(removed.map(item => item.target), ['fill', 'text'])
  assert.equal(replaced.length, 3)
})

test('normalizes source JSONPath bindings and keeps legacy point bindings compatible', () => {
  const normalized = normalizeDataBindings([
    { target: 'text', sourceId: ' source-http ', jsonPath: "$['data']['name']" },
    { target: 'fill', pointId: 'legacy.color' },
    { target: 'stroke', sourceId: 'source-http', jsonPath: '$..unsafe' }
  ], 'rect')

  assert.deepEqual(normalized, [
    { target: 'text', sourceId: 'source-http', jsonPath: '$.data.name', enabled: true },
    { target: 'fill', pointId: 'legacy.color', enabled: true }
  ])
  assert.deepEqual(bindingSourceIds({ dataBindings: normalized }), ['source-http'])
  assert.equal(bindingRuntimeKey(normalized[0]), sourceBindingRuntimeKey('source-http', '$.data.name'))
  assert.deepEqual(bindingPointIds({ dataBindings: normalized }), [
    sourceBindingRuntimeKey('source-http', '$.data.name'),
    'legacy.color'
  ])

  const replaced = upsertDataBinding(
    { type: 'rect', dataBindings: normalized },
    { target: 'text', sourceId: 'source-mqtt', jsonPath: '$.device.label' }
  )
  assert.deepEqual(replaced[0], {
    target: 'text',
    sourceId: 'source-mqtt',
    jsonPath: '$.device.label',
    enabled: true
  })
})

test('data binding index tracks many-to-many enabled relations without duplicate node buckets', () => {
  const index = createDataBindingIndex()
  const firstNode = {
    id: 'node-1',
    dataBindings: [
      { target: 'fill', pointId: 'shared', enabled: true },
      { target: 'stroke', pointId: 'shared', enabled: true },
      { target: 'text', pointId: 'disabled', enabled: false }
    ]
  }
  const secondNode = {
    id: 'node-2',
    dataBindings: [{ target: 'text', pointId: 'shared', enabled: true }]
  }

  index.rebuild([firstNode, secondNode])
  assert.deepEqual([...index.keys()], ['shared'])
  assert.deepEqual([...index.pointIdsFor('node-1')], ['shared'])
  assert.deepEqual([...index.nodeIdsFor('shared')], ['node-1', 'node-2'])
  assert.equal(index.countFor('shared'), 2)
  assert.deepEqual(index.state, { nodeCount: 2, pointCount: 1 })

  assert.equal(index.update({
    id: 'node-1',
    dataBindings: [{ target: 'fill', pointId: 'replacement', enabled: true }]
  }), true)
  assert.deepEqual([...index.nodeIdsFor('shared')], ['node-2'])
  assert.deepEqual([...index.nodeIdsFor('replacement')], ['node-1'])
  assert.equal(index.update({ id: 'node-1', dataBindings: [{ target: 'fill', pointId: 'replacement', enabled: true }] }), false)

  assert.equal(index.remove(['node-2']), 1)
  assert.deepEqual([...index.keys()], ['replacement'])
  assert.equal(index.add([{ id: 'node-3', dataBindings: [{ target: 'text', pointId: 'replacement' }] }]), 1)
  assert.equal(index.countFor('replacement'), 2)
})

test('data binding index isolates colliding source and legacy keys while bridging string dirty lookups', () => {
  const sourceKey = sourceBindingRuntimeKey('collision-source', '$.value')
  const legacyKey = String(sourceKey)
  const index = createDataBindingIndex()
  index.rebuild([
    {
      id: 'source-node',
      type: 'rect',
      dataBindings: [{ target: 'text', sourceId: 'collision-source', jsonPath: '$.value' }]
    },
    {
      id: 'legacy-node',
      type: 'rect',
      dataBindings: [{ target: 'text', pointId: legacyKey }]
    }
  ])

  assert.equal(index.state.pointCount, 2)
  assert.deepEqual([...index.nodeIdsFor(sourceKey)], ['source-node'])
  assert.deepEqual([...index.nodeIdsFor(legacyKey)], ['legacy-node', 'source-node'])
  assert.equal(index.countFor(legacyKey), 2)

  assert.equal(index.remove(['legacy-node']), 1)
  assert.deepEqual([...index.nodeIdsFor(legacyKey)], ['source-node'])
  assert.equal(index.remove(['source-node']), 1)
  assert.deepEqual([...index.nodeIdsFor(legacyKey)], [])
  assert.equal(index.state.pointCount, 0)

  const overlappingIndex = createDataBindingIndex()
  overlappingIndex.rebuild([{
    id: 'overlap-node',
    type: 'rect',
    dataBindings: [
      { target: 'fill', sourceId: 'collision-source', jsonPath: '$.value' },
      { target: 'stroke', pointId: legacyKey }
    ]
  }])
  assert.deepEqual([...overlappingIndex.nodeIdsFor(legacyKey)], ['overlap-node'])
  assert.equal(overlappingIndex.countFor(legacyKey), 1)
})

test('resolves color, number, boolean and text values with static fallback', () => {
  const node = {
    type: 'checkbox',
    fill: '#112233',
    stroke: '#445566',
    opacity: 0.4,
    text: '静态文字',
    animationPaused: true,
    animationDuration: 1.5,
    checked: false
  }

  assert.equal(resolveBindingValue(node, 'fill', ' #abcdef '), '#abcdef')
  assert.equal(resolveBindingValue(node, 'fill', 'warning'), '#f59e0b')
  assert.equal(resolveBindingValue(node, 'fill', 'notacolor'), '#112233')
  assert.equal(resolveBindingValue(node, 'fill', 'url(javascript:bad)'), '#112233')
  assert.equal(resolveBindingValue(node, 'opacity', '2'), 1)
  assert.equal(resolveBindingValue(node, 'opacity', 'not-a-number'), 0.4)
  assert.equal(resolveBindingValue(node, 'checked', '开启'), true)
  assert.equal(resolveBindingValue(node, 'checked', 'unknown'), false)
  assert.equal(resolveBindingValue(node, 'animationPlaying', 1), true)
  assert.equal(resolveBindingValue(node, 'animationPlaying', undefined), false)
  assert.equal(resolveBindingValue(node, 'text', 42), '42')
  assert.equal(resolveBindingValue(node, 'text', [1, 2]), '静态文字')
  assert.equal(resolveBindingValue(node, 'text', [1, 2], { type: 'first' }), '1')
  assert.equal(resolveBindingValue(node, 'text', [1, 2], { type: 'join', separator: ' / ' }), '1 / 2')
  assert.equal(resolveBindingValue(node, 'text', [1, 2], { type: 'template', template: '编号：{value}', separator: '-' }), '编号：1-2')
  assert.equal(resolveBindingValue(node, 'style.fill', '#fff'), undefined)
})

test('bounds join and template adapters before traversing large runtime arrays', () => {
  const node = { type: 'rect', text: '静态文字' }
  const createLargeValue = () => {
    let reads = 0
    const source = new Array(100_000).fill(1)
    const value = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    return { value, reads: () => reads }
  }

  const joinedSource = createLargeValue()
  const joined = resolveBindingValue(node, 'text', joinedSource.value, { type: 'join', separator: '|' })
  assert.equal(joined.split('|').length, 64)
  assert.ok(joinedSource.reads() <= 64, `join read ${joinedSource.reads()} items`)

  const templateSource = createLargeValue()
  const templated = resolveBindingValue(node, 'text', templateSource.value, {
    type: 'template',
    template: '值：{value}',
    separator: ','
  })
  assert.equal(templated.slice(2).split(',').length, 64)
  assert.ok(templateSource.reads() <= 64, `template read ${templateSource.reads()} items`)

  const throwingValue = new Proxy([1, 2, 3], {
    get(target, property, receiver) {
      if (property === '1') throw new Error('unavailable')
      return Reflect.get(target, property, receiver)
    }
  })
  assert.doesNotThrow(() => resolveBindingValue(node, 'text', throwingValue, { type: 'join', separator: ',' }))
  assert.equal(resolveBindingValue(node, 'text', throwingValue, { type: 'join', separator: ',' }), '静态文字')
})

test('resolves an enabled node binding through a point getter without writing the node', () => {
  const node = {
    type: 'progress',
    progressValue: 25,
    dataBindings: [{ target: 'progressValue', pointId: 'motor.load', enabled: true }]
  }
  const before = structuredClone(node)

  assert.equal(resolveNodeBindingValue(node, 'progressValue', pointId => pointId === 'motor.load' ? '68.5' : undefined), 68.5)
  assert.equal(resolveNodeBindingValue(node, 'progressValue', () => 180), 100)
  assert.deepEqual(node, before)
  assert.equal(resolveNodeBindingValue({ ...node, dataBindings: [{ ...node.dataBindings[0], enabled: false }] }, 'progressValue', () => 90), 25)
})

test('resolves all enabled bindings into a detached target override object', () => {
  const node = {
    type: 'rect',
    fill: '#112233',
    opacity: 0.25,
    text: '静态文字',
    dataBindings: [
      { target: 'fill', pointId: 'device.color', enabled: true },
      { target: 'opacity', pointId: 'device.opacity', enabled: true },
      { target: 'text', pointId: 'device.label', enabled: false }
    ]
  }
  const before = structuredClone(node)
  const values = new Map([['device.color', '#abcdef'], ['device.opacity', 0.8], ['device.label', '动态文字']])

  assert.deepEqual(resolveNodeDataBindings(node, pointId => values.get(pointId)), {
    fill: '#abcdef',
    opacity: 0.8
  })
  assert.deepEqual(node, before)
})

test('adapts arrays and datasets to isolated canonical table data', () => {
  const node = {
    type: 'table',
    tableHeaders: ['静态列'],
    tableCells: [['静态值']]
  }
  const sourceRows = [{ id: 1, state: { label: '运行' } }, { id: 2, state: { label: '停止' } }]
  const first = resolveBindingValue(node, 'tableData', sourceRows)
  const second = resolveBindingValue(node, 'tableData', sourceRows)

  assert.deepEqual(first.columns, [
    { key: 'id', title: 'id' },
    { key: 'state', title: 'state' }
  ])
  assert.deepEqual(first.rows, sourceRows)
  assert.notStrictEqual(first, second)
  assert.notStrictEqual(first.rows, sourceRows)
  assert.notStrictEqual(first.rows[0], sourceRows[0])
  assert.notStrictEqual(first.rows[0].state, sourceRows[0].state)
  first.rows[0].state.label = '已修改'
  assert.equal(second.rows[0].state.label, '运行')
  assert.equal(sourceRows[0].state.label, '运行')

  const dataset = resolveBindingValue(node, 'tableData', {
    datasetId: 'orders',
    columns: [{ key: 'name', title: '名称' }, 'value'],
    rows: [['设备 A', 10], ['设备 B', 20]]
  })
  assert.equal(dataset.datasetId, 'orders')
  assert.deepEqual(dataset.columns, [{ key: 'name', title: '名称' }, { key: 'value', title: 'value' }])
  assert.deepEqual(dataset.rows, [{ name: '设备 A', value: 10 }, { name: '设备 B', value: 20 }])

  const fallback = resolveBindingValue(node, 'tableData', { unsupported: true })
  assert.deepEqual(fallback.rows, [{ column1: '静态值' }])
  fallback.rows[0].column1 = '外部修改'
  assert.equal(node.tableCells[0][0], '静态值')
})

test('bounds 100k-row and wide table values before inference, mapping, and cloning', () => {
  const node = { type: 'table', tableHeaders: ['静态列'], tableCells: [['静态值']] }
  const nestedSource = { label: '原值' }
  const wideRowSource = new Array(100_000)
  wideRowSource[0] = nestedSource
  for (let index = 1; index < MAX_RUNTIME_TABLE_COLUMNS; index += 1) wideRowSource[index] = `值 ${index}`

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
  rowSource[0] = wideRow
  for (let index = 1; index < MAX_RUNTIME_TABLE_ROWS; index += 1) rowSource[index] = [index]
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

  const adapted = resolveBindingValue(node, 'tableData', rows)
  assert.equal(adapted.columns.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.equal(adapted.rows.length, MAX_RUNTIME_TABLE_ROWS)
  assert.ok(rowReads <= MAX_RUNTIME_TABLE_ROWS, `read ${rowReads} source rows`)
  assert.ok(rowMembershipChecks <= MAX_RUNTIME_TABLE_ROWS, `checked ${rowMembershipChecks} source rows`)
  assert.ok(cellReads <= MAX_RUNTIME_TABLE_COLUMNS, `read ${cellReads} cells from a wide row`)
  assert.ok(cellMembershipChecks <= MAX_RUNTIME_TABLE_COLUMNS, `checked ${cellMembershipChecks} cells from a wide row`)
  assert.notStrictEqual(adapted.rows[0].column1, nestedSource)
  adapted.rows[0].column1.label = '运行时副本'
  assert.equal(nestedSource.label, '原值')
  assert.equal(rowSource.length, 100_000)
  assert.equal(wideRowSource.length, 100_000)

  const columnSource = new Array(100_000)
  for (let index = 0; index < MAX_RUNTIME_TABLE_COLUMNS; index += 1) {
    columnSource[index] = { key: `field${index + 1}`, title: `字段 ${index + 1}` }
  }
  let columnMembershipChecks = 0
  const columns = new Proxy(columnSource, {
    has(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) columnMembershipChecks += 1
      return Reflect.has(target, property)
    }
  })
  const dataset = resolveBindingValue(node, 'tableData', { columns, rows: [[1, 2, 3]] })
  assert.equal(dataset.columns.length, MAX_RUNTIME_TABLE_COLUMNS)
  assert.equal(dataset.rows.length, 1)
  assert.ok(columnMembershipChecks <= MAX_RUNTIME_TABLE_COLUMNS, `checked ${columnMembershipChecks} source columns`)
  assert.equal(columnSource.length, 100_000)
})

test('bounds nested table cell traversal and keeps hostile values isolated', () => {
  const node = { type: 'table', tableHeaders: ['静态列'], tableCells: [['静态值']] }

  let wideReads = 0
  const wideCell = { label: '运行' }
  wideCell.self = wideCell
  for (let index = 0; index < 100_000; index += 1) {
    Object.defineProperty(wideCell, `field${index}`, {
      enumerable: true,
      get() {
        wideReads += 1
        return index
      }
    })
  }

  let arrayReads = 0
  const hugeArray = new Proxy(new Array(100_000), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) arrayReads += 1
      return Reflect.get(target, property, receiver)
    }
  })

  let totalReads = 0
  const nestedEntries = {}
  for (let group = 0; group < 12; group += 1) {
    const entry = {}
    for (let index = 0; index < 12; index += 1) {
      Object.defineProperty(entry, `value${index}`, {
        enumerable: true,
        get() {
          totalReads += 1
          return index
        }
      })
    }
    nestedEntries[`group${group}`] = entry
  }

  let deepReads = 0
  let deepCell = { value: '末端' }
  for (let index = 0; index < 100; index += 1) {
    const child = deepCell
    deepCell = {}
    Object.defineProperty(deepCell, 'child', {
      enumerable: true,
      get() {
        deepReads += 1
        return child
      }
    })
  }

  const throwingCell = { label: '仍可显示' }
  Object.defineProperty(throwingCell, 'failed', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })

  let nestedArrayReads = 0
  const nestedArraySource = Array.from({ length: 12 }, () => new Proxy(new Array(12), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) nestedArrayReads += 1
      return Reflect.get(target, property, receiver)
    }
  }))
  const nestedArrays = new Proxy(nestedArraySource, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) nestedArrayReads += 1
      return Reflect.get(target, property, receiver)
    }
  })

  const adapted = resolveBindingValue(node, 'tableData', [
    [wideCell],
    [hugeArray],
    [nestedEntries],
    [deepCell],
    [throwingCell],
    [nestedArrays]
  ])

  const clonedWideCell = adapted.rows[0].column1
  assert.equal(clonedWideCell.label, '运行')
  assert.equal(clonedWideCell.self, '[Circular]')
  assert.ok(Object.keys(clonedWideCell).length <= 12)
  assert.ok(wideReads <= 12, `read ${wideReads} object properties`)
  assert.ok(adapted.rows[1].column1.length <= 12)
  assert.ok(Object.keys(adapted.rows[1].column1).length <= 12)
  assert.ok(arrayReads <= 12, `read ${arrayReads} array items`)
  assert.ok(totalReads <= 48, `read ${totalReads} nested entries`)
  assert.ok(nestedArrayReads <= 48, `read ${nestedArrayReads} nested array entries`)
  assert.ok(deepReads <= 4, `read ${deepReads} nested levels`)
  assert.equal(adapted.rows[4].column1.label, '仍可显示')
  assert.equal(adapted.rows[4].column1.failed, '[Thrown]')
})

test('normalization clones adapter state shared by multiple source nodes', () => {
  const sharedAdapter = { type: 'template', template: '{value}', separator: ',' }
  const source = [{ target: 'text', pointId: 'device.ids', adapter: sharedAdapter }]
  const first = normalizeDataBindings(source, 'rect')
  const second = normalizeDataBindings(source, 'rect')

  assert.notStrictEqual(first, second)
  assert.notStrictEqual(first[0], second[0])
  assert.notStrictEqual(first[0].adapter, second[0].adapter)
  first[0].adapter.template = 'changed'
  assert.equal(second[0].adapter.template, '{value}')
  assert.equal(sharedAdapter.template, '{value}')
})

test('project validation accepts canonical bindings and rejects malformed or unsafe relations', () => {
  assert.doesNotThrow(() => validateProjectForFrontend(projectWithNode({
    dataKey: 'legacy.value',
    dataBindings: [
      { target: 'fill', pointId: 'device.color', enabled: true },
      { target: 'text', pointId: 'device.ids', adapter: { type: 'join', separator: ',' }, enabled: false }
    ]
  })))
  assert.doesNotThrow(() => validateProjectForFrontend(projectWithNode({
    dataBindings: [
      { target: 'text', sourceId: 'source-http', jsonPath: '$.data.name', enabled: true },
      { target: 'opacity', sourceId: 'source-http', jsonPath: '$.data.opacity', enabled: false }
    ]
  })))
  assert.doesNotThrow(() => validateProjectForFrontend(projectWithNode({
    type: 'signalLight',
    dataBindings: [
      { target: 'signalColors.0', sourceId: 'source-http', jsonPath: '$.states.run' },
      { target: 'signalColors.7', sourceId: 'source-http', jsonPath: '$.states.alarm' },
      { target: 'signalOpacity', sourceId: 'source-http', jsonPath: '$.opacity' }
    ]
  })))
  assert.doesNotThrow(() => validateProjectForFrontend(projectWithNode({ dataKey: 'legacy.only' })))

  for (const dataBindings of [
    {},
    [{ target: 'style.fill', pointId: 'device.color' }],
    [{ target: 'fill', pointId: '' }],
    [{ target: 'fill', pointId: 'first' }, { target: ' fill ', pointId: 'second' }],
    [{ target: 'fill', pointId: 'device.color', enabled: 'yes' }],
    [{ target: 'fill', sourceId: '', jsonPath: '$.data.color' }],
    [{ target: 'fill', sourceId: 'source-http', jsonPath: '$..color' }],
    [{ target: 'fill', sourceId: 'source-http' }],
    [{ target: 'fill', pointId: 'device.color', adapter: { type: 'eval', code: 'danger()' } }],
    Array.from({ length: MAX_NODE_DATA_BINDINGS + 1 }, (_, index) => ({ target: 'fill', pointId: `point.${index}` }))
  ]) {
    assert.throws(
      () => validateProjectForFrontend(projectWithNode({ dataBindings })),
      error => error instanceof ProjectValidationError && error.code === 'INVALID_DATA_BINDINGS'
    )
  }

  assert.throws(
    () => validateProjectForFrontend(projectWithNode({
      type: 'signalLight',
      dataBindings: [{ target: 'signalColors.8', pointId: 'bad' }]
    })),
    error => error instanceof ProjectValidationError && error.code === 'INVALID_DATA_BINDINGS'
  )

  assert.throws(
    () => validateProjectForFrontend({
      ...projectWithNode({}),
      customComponents: [{
        id: 'custom-1',
        nodes: [{ id: 'custom-node', type: 'table', x: 0, y: 0, w: 100, h: 80, dataBindings: [{ target: '__proto__', pointId: 'bad' }] }],
        edges: []
      }]
    }),
    error => error instanceof ProjectValidationError && error.code === 'INVALID_DATA_BINDINGS'
  )
})
