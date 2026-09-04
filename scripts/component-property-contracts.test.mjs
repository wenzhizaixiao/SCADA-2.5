import assert from 'node:assert/strict'
import test from 'node:test'

import { getBindableParameters } from '../src/config/componentBindingSchema.js'
import {
  COMPONENT_CATEGORY_BY_TYPE,
  COMPONENT_NAME_BY_TYPE,
  createComponentGroups
} from '../src/config/componentCatalog.js'
import {
  getPropertyEditorContract,
  getPropertyEditorContracts
} from '../src/config/componentPropertyContracts.js'

const CATALOG_COMPONENTS = Object.freeze(createComponentGroups().flatMap(group => (
  group.items.map(item => Object.freeze({
    type: item.type,
    name: item.name,
    category: group.name
  }))
)))
const SUPPLEMENTAL_COMPONENTS = Object.freeze([
  Object.freeze({ type: 'pencil', name: '铅笔线稿', category: '画布工具' })
])
const COMPONENT_CASES = Object.freeze([...CATALOG_COMPONENTS, ...SUPPLEMENTAL_COMPONENTS])

function propertyFixture(type) {
  return {
    type,
    fill: '#111111',
    stroke: '#222222',
    opacity: 0.25,
    text: '静态文字',
    visible: false,
    animationPaused: true,
    animationDuration: 2,
    checked: false,
    value: '静态值',
    progressValue: 25,
    visualPrimaryColor: '#333333',
    polylineColor: '#444444',
    tableTitle: '静态标题',
    tableRowFill: '#555555',
    tableBorderColor: '#666666',
    tableHeaders: ['静态列 1'],
    tableCells: [['静态单元格']],
    tableColumns: 1,
    tableRows: 1,
    chartData: [25],
    chartTitle: '静态图表标题',
    chartSeriesName: '静态系列',
    chartLabels: ['一月'],
    chartColor: '#168eea',
    chartSeries: [{ name: '静态系列', color: '#168eea', data: [25] }],
    chartShowLegend: true,
    chartShowTooltip: true,
    chartShowGrid: true,
    chartSmooth: false,
    chartAreaFill: false,
    chartSymbolSize: 10,
    chartRadarMax: 100,
    defaultValue: '静态默认值',
    signalColorCount: 8,
    signalColors: Array.from({ length: 8 }, (_, index) => `#00000${index}`),
    signalOpacity: 0.4
  }
}

function writtenValue(target) {
  if (target === 'visible' || target === 'animationPlaying' || target === 'checked') return true
  if (target === 'opacity' || target === 'signalOpacity') return 0.75
  if (target === 'animationDuration') return 4
  if (target === 'progressValue') return 80
  if (target === 'tableTitle') return '新标题'
  if (target === 'tableHeaders') return ['新列 1', '新列 2']
  if (target === 'tableCells') return [['A', 'B'], ['C', 'D']]
  if (target === 'tableData') {
    return {
      columns: [
        { key: 'column1', title: '设备' },
        { key: 'column2', title: '状态' }
      ],
      rows: [['泵 A', '运行'], ['泵 B', '停止']]
    }
  }
  if (target === 'chartData') return [10, 35, 80]
  if (/^chartSeries\.\d+\.data$/.test(target)) return [10, 35, 80]
  if (/^chartSeries\.\d+\.color$/.test(target)) return '#abcdef'
  if (/^chartSeries\.\d+\.name$/.test(target)) return '新系列'
  if (target === 'chartLabels') return ['A', 'B', 'C']
  if (['chartShowLegend', 'chartShowTooltip', 'chartShowGrid'].includes(target)) return false
  if (['chartSmooth', 'chartAreaFill'].includes(target)) return true
  if (target === 'chartSymbolSize') return 24
  if (target === 'chartRadarMax') return 500
  if (target.startsWith('signalColors.')) return '#abcdef'
  if (target.endsWith('Color') || target.endsWith('Fill') || target === 'fill' || target === 'stroke') return '#abcdef'
  return `new-${target}`
}

function expectedFieldPaths(type, target) {
  if (type === 'table' && ['fill', 'tableRowFill'].includes(target)) return ['tableRowFill']
  if (type === 'table' && ['stroke', 'tableBorderColor'].includes(target)) return ['tableBorderColor']
  if (type === 'table' && ['text', 'tableTitle'].includes(target)) return ['tableTitle']
  if (type === 'time' && target === 'value') return ['defaultValue']
  if (target === 'animationPlaying') return ['animationPaused']
  if (target === 'tableData') return ['tableHeaders', 'tableCells', 'tableColumns', 'tableRows']
  const chartSeriesMatch = /^chartSeries\.(\d+)\.(name|color|data)$/.exec(target)
  if (chartSeriesMatch) {
    if (chartSeriesMatch[1] !== '0') return ['chartSeries']
    return ['chartSeries', {
      name: 'chartSeriesName',
      color: 'chartColor',
      data: 'chartData'
    }[chartSeriesMatch[2]]]
  }
  return [target]
}

function changedTopLevelFields(previous, next) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  return [...keys]
    .filter(key => !Object.is(previous[key], next[key]))
    .sort()
}

function sortedTargets(source) {
  return [...new Set(source.map(item => item.target))].sort()
}

function fullyConfiguredNode(type, parameters) {
  return {
    ...propertyFixture(type),
    buttonAction: 'toggle',
    dataBindings: parameters.map(parameter => ({
      target: parameter.target,
      pointId: `contract.${type}.${parameter.target}`,
      enabled: true
    }))
  }
}

function assertCompletePropertyContract(component) {
  const { type, category, name } = component
  const componentLabel = `${category}/${name} (${type})`
  const typeParameters = getBindableParameters(type)
  const node = fullyConfiguredNode(type, typeParameters)
  const nodeParameters = getBindableParameters(node)
  const contracts = getPropertyEditorContracts(type)
  const typeTargets = sortedTargets(typeParameters)
  const nodeTargets = sortedTargets(nodeParameters)
  const contractTargets = sortedTargets(contracts)

  assert.ok(typeParameters.length > 0, `${componentLabel} must expose at least component visibility`)
  assert.equal(typeTargets.length, typeParameters.length, `${componentLabel} has duplicate communication targets`)
  assert.equal(contractTargets.length, contracts.length, `${componentLabel} has duplicate property contracts`)
  assert.deepEqual(
    nodeTargets,
    typeTargets,
    `${componentLabel} node conditions hide a target even when its static state and legacy binding are configured`
  )
  assert.deepEqual(
    contractTargets,
    typeTargets,
    `${componentLabel} communication and property contract target sets differ`
  )

  for (const parameter of nodeParameters) {
    const contract = getPropertyEditorContract(type, parameter.target)
    assert.ok(contract, `${componentLabel}.${parameter.target} has no property editor contract`)
    assert.equal(contract.target, parameter.target)
    assert.ok(contract.controlKind, `${componentLabel}.${parameter.target} must declare its editor control kind`)
    assert.deepEqual(
      contract.fieldPaths,
      expectedFieldPaths(type, parameter.target),
      `${componentLabel}.${parameter.target} points at the wrong static property fields`
    )
    assert.deepEqual(
      contract.readStatic(node),
      parameter.readStatic(node),
      `${componentLabel}.${parameter.target} reads a different value in properties and communication`
    )

    const value = writtenValue(parameter.target)
    const updated = contract.writeStatic(node, value)
    const expectedTopLevelFields = [...new Set(contract.fieldPaths.map(path => path.split('.')[0]))].sort()
    assert.notStrictEqual(updated, node, `${componentLabel}.${parameter.target} must not mutate the selected node in place`)
    assert.deepEqual(
      changedTopLevelFields(node, updated),
      expectedTopLevelFields,
      `${componentLabel}.${parameter.target} wrote outside its declared static property fields`
    )
    assert.deepEqual(
      parameter.readStatic(updated),
      value,
      `${componentLabel}.${parameter.target} cannot round-trip through the communication schema`
    )
    assert.deepEqual(
      contract.readStatic(updated),
      value,
      `${componentLabel}.${parameter.target} cannot round-trip through the property editor contract`
    )
  }
}

test('component directory enumeration includes every unique catalog entry', () => {
  const catalogTypes = CATALOG_COMPONENTS.map(component => component.type)
  const hiddenCompatibilityTypes = ['chart', 'progress', 'code']
  assert.ok(catalogTypes.length > 0)
  assert.equal(new Set(catalogTypes).size, catalogTypes.length, 'component directory contains duplicate types')
  assert.deepEqual(
    [...COMPONENT_CATEGORY_BY_TYPE.keys()].sort(),
    [...catalogTypes, ...hiddenCompatibilityTypes].sort()
  )
  for (const component of CATALOG_COMPONENTS) {
    assert.equal(COMPONENT_CATEGORY_BY_TYPE.get(component.type), component.category)
    assert.equal(COMPONENT_NAME_BY_TYPE.get(component.type), component.name)
  }
})

for (const component of COMPONENT_CASES) {
  test(`property contracts exhaustively cover ${component.category}/${component.name} (${component.type})`, () => {
    assertCompletePropertyContract(component)
  })
}

test('component-specific property contracts are not exposed on unrelated components', () => {
  assert.equal(getPropertyEditorContract('rect', 'checked'), undefined)
  assert.equal(getPropertyEditorContract('rect', 'animationPlaying'), undefined)
  assert.equal(getPropertyEditorContract('circle', 'signalColors.0'), undefined)
  assert.equal(getPropertyEditorContract('table', 'chartData'), undefined)
  assert.equal(getPropertyEditorContract('lineChart', 'text'), undefined)
  assert.equal(getPropertyEditorContract('echartsCode', 'text'), undefined)
  assert.equal(getPropertyEditorContract('rect', '__proto__'), undefined)
  assert.equal(getPropertyEditorContract('pieChart', 'chartSeries.0.data'), undefined)
  assert.equal(getPropertyEditorContract('barChart', 'chartSeries.8.data'), undefined)
})

test('multi-series chart contracts update only the selected series and preserve the source node', () => {
  const node = {
    ...propertyFixture('barChart'),
    chartSeries: [
      { name: '系列 1', color: '#16b89a', data: [10, 20] },
      { name: '系列 2', color: '#168eea', data: [30, 40] }
    ]
  }
  const contract = getPropertyEditorContract(node, 'chartSeries.1.data')
  const updated = contract.writeStatic(node, [70, 80])

  assert.deepEqual(contract.fieldPaths, ['chartSeries'])
  assert.deepEqual(contract.readStatic(node), [30, 40])
  assert.deepEqual(contract.readStatic(updated), [70, 80])
  assert.deepEqual(node.chartSeries[1].data, [30, 40])
  assert.notStrictEqual(updated.chartSeries, node.chartSeries)
  assert.notStrictEqual(updated.chartSeries[1], node.chartSeries[1])
})

test('table legacy aliases and modern targets edit the same static property fields', () => {
  const node = {
    ...propertyFixture('table'),
    dataBindings: [
      { target: 'fill', pointId: 'legacy.table.fill' },
      { target: 'stroke', pointId: 'legacy.table.stroke' },
      { target: 'text', pointId: 'legacy.table.title' }
    ]
  }
  const visibleTargets = getBindableParameters(node).map(parameter => parameter.target)

  assert.ok(visibleTargets.includes('tableRowFill'))
  assert.ok(visibleTargets.includes('tableBorderColor'))
  assert.ok(visibleTargets.includes('tableTitle'))
  assert.ok(visibleTargets.includes('fill'))
  assert.ok(visibleTargets.includes('stroke'))
  assert.ok(visibleTargets.includes('text'))
  assert.deepEqual(getPropertyEditorContract('table', 'fill').fieldPaths, ['tableRowFill'])
  assert.deepEqual(getPropertyEditorContract('table', 'tableRowFill').fieldPaths, ['tableRowFill'])
  assert.deepEqual(getPropertyEditorContract('table', 'stroke').fieldPaths, ['tableBorderColor'])
  assert.deepEqual(getPropertyEditorContract('table', 'tableBorderColor').fieldPaths, ['tableBorderColor'])
  assert.deepEqual(getPropertyEditorContract('table', 'text').fieldPaths, ['tableTitle'])
  assert.deepEqual(getPropertyEditorContract('table', 'tableTitle').fieldPaths, ['tableTitle'])
  assert.equal(
    getPropertyEditorContract('table', 'text').readStatic({ ...node, tableTitle: '', text: '旧版静态标题' }),
    ''
  )
})
