import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { COMPONENT_CATEGORY_BY_TYPE } from '../src/config/componentCatalog.js'
import {
  PARAMETER_VALUE_TYPE_LABELS,
  directBindingCompatibility,
  isConvertibleBoolean,
  isMappableColorString,
  isSafeNumericString,
  parameterDataFormatGuide,
  pointBindingAvailability,
  pointStatusInfo,
  pointValueTypeLabel
} from '../src/utils/dataBindingCompatibility.js'
import {
  getBindableParameter,
  getBindableParameters
} from '../src/config/componentBindingSchema.js'
import { resolveBindingValue } from '../src/models/dataBindingModel.js'

const panelSource = readFileSync(new URL('../src/components/CommunicationBindingPanel.vue', import.meta.url), 'utf8')
const jsonTreeSource = readFileSync(new URL('../src/components/JsonPathTree.vue', import.meta.url), 'utf8')

function compatibility(valueType, type, value) {
  return directBindingCompatibility({ valueType }, { type, value })
}

function inferredType(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'unknown'
  return typeof value === 'object' ? 'object' : typeof value
}

test('direct binding compatibility matches runtime color and numeric conversion boundaries', () => {
  assert.equal(isMappableColorString('warning'), true)
  assert.equal(isMappableColorString('#12abef'), true)
  assert.equal(isMappableColorString('rgb(12, 34, 56)'), true)
  assert.equal(isMappableColorString('not-a-color'), false)
  assert.equal(compatibility('color', 'string', 'warning').compatible, true)
  assert.equal(compatibility('color', 'number', 1).compatible, false)

  assert.equal(isSafeNumericString(' -12.5e2 '), true)
  assert.equal(isSafeNumericString('0x10'), false)
  assert.equal(isSafeNumericString('Infinity'), false)
  assert.equal(compatibility('number', 'number', 42).compatible, true)
  assert.equal(compatibility('number', 'string', '42.5').compatible, true)
  assert.equal(compatibility('number', 'string', '0x10').compatible, false)
})

test('animation duration binding limits match each component property editor', () => {
  const builtIn = getBindableParameter('flowPipe', 'animationDuration')
  const custom = getBindableParameter('customImageMotion', 'animationDuration')
  assert.deepEqual({ min: builtIn.min, max: builtIn.max }, { min: 0.2, max: 5 })
  assert.deepEqual({ min: custom.min, max: custom.max }, { min: 0.2, max: 20 })
})

test('table, text and boolean direct bindings accept only values supported by their targets', () => {
  assert.equal(compatibility('table', 'array', [{ id: 1 }]).compatible, true)
  assert.equal(compatibility('table', 'object', { columns: [], rows: [] }).compatible, true)
  assert.equal(compatibility('table', 'object', { data: { id: 1 } }).compatible, false)
  assert.equal(compatibility('table', 'string', '[]').compatible, false)

  assert.equal(compatibility('text', 'string', '运行').compatible, true)
  assert.equal(compatibility('text', 'number', 12).compatible, true)
  assert.equal(compatibility('text', 'boolean', false).compatible, true)
  assert.equal(compatibility('text', 'array', ['运行']).compatible, false)

  assert.equal(isConvertibleBoolean('开启'), true)
  assert.equal(isConvertibleBoolean('0'), true)
  assert.equal(isConvertibleBoolean('unknown'), false)
  assert.equal(compatibility('boolean', 'boolean', true).compatible, true)
  assert.equal(compatibility('boolean', 'number', 0).compatible, true)
  assert.equal(compatibility('boolean', 'string', '关闭').compatible, true)
  assert.equal(compatibility('boolean', 'string', 'unknown').compatible, false)
})

test('every component parameter type exposes a compatible default response format', () => {
  const expectedPaths = {
    color: '$.value',
    number: '$.value',
    boolean: '$.value',
    text: '$.value',
    table: '$.table'
  }
  assert.deepEqual(
    new Set(Object.keys(expectedPaths)),
    new Set(Object.keys(PARAMETER_VALUE_TYPE_LABELS)),
    'every supported component parameter type must have a documented format'
  )

  for (const valueType of Object.keys(expectedPaths)) {
    const guide = parameterDataFormatGuide({ valueType })
    assert.equal(guide.valueType, valueType)
    assert.equal(guide.examples[0].jsonPath, expectedPaths[valueType])
    assert.ok(guide.description)
    assert.ok(guide.examples.length >= 1)

    for (const example of guide.examples) {
      const payload = JSON.parse(example.json)
      const value = example.jsonPath === '$.table' ? payload.table : payload.value
      assert.equal(
        compatibility(valueType, inferredType(value), value).compatible,
        true,
        `${valueType} guide example must be accepted by the runtime`
      )
    }
  }

  const tableGuide = parameterDataFormatGuide({ valueType: 'table' })
  assert.equal(tableGuide.examples.length, 2)
  assert.ok(Array.isArray(JSON.parse(tableGuide.examples[0].json).table))
  assert.ok(Array.isArray(JSON.parse(tableGuide.examples[1].json).table.rows))
  assert.equal(parameterDataFormatGuide({ valueType: 'percent' }).valueType, 'number')
  assert.equal(parameterDataFormatGuide({ valueType: 'duration' }).valueType, 'number')
})

test('bounded numeric parameters document a value inside their runtime range', () => {
  const guide = parameterDataFormatGuide({ valueType: 'number', min: 0, max: 1 })
  const value = JSON.parse(guide.examples[0].json).value

  assert.equal(value, 0.8)
  assert.match(guide.description, /0 到 1/)
  assert.equal(compatibility('number', 'number', value).compatible, true)
})

test('every catalog component communication parameter exposes a default response format', () => {
  for (const componentType of COMPONENT_CATEGORY_BY_TYPE.keys()) {
    const parameters = getBindableParameters(componentType)
    assert.ok(parameters.length > 0, `${componentType} should expose communication parameters`)
    for (const parameter of parameters) {
      assert.ok(
        parameterDataFormatGuide(parameter),
        `${componentType}.${parameter.target} (${parameter.valueType}) is missing a data format guide`
      )
    }
  }
})

test('every table value accepted by the picker can be materialized by the runtime', () => {
  const node = {
    type: 'table',
    tableHeaders: ['静态列'],
    tableCells: [['静态值']]
  }
  const supportedValues = [
    [{ id: 1 }],
    { columns: [{ key: 'id', title: '编号' }], rows: [{ id: 1 }] }
  ]

  for (const value of supportedValues) {
    const pointType = Array.isArray(value) ? 'array' : 'object'
    assert.equal(compatibility('table', pointType, value).compatible, true)
    assert.notDeepEqual(resolveBindingValue(node, 'tableData', value).rows, [{ column1: '静态值' }])
  }

  const unsupportedValue = { data: { id: 1 } }
  const result = compatibility('table', 'object', unsupportedValue)
  assert.equal(result.compatible, false)
  assert.match(result.reason, /rows/)
  assert.deepEqual(resolveBindingValue(node, 'tableData', unsupportedValue).rows, [{ column1: '静态值' }])
})

test('point type and stale/offline status labels are explicit', () => {
  assert.equal(pointValueTypeLabel({ type: 'number', value: 1 }), '数值')
  assert.deepEqual(pointStatusInfo({ status: 'stale' }), { state: 'stale', label: '数据滞后' })
  assert.deepEqual(pointStatusInfo({ status: 'offline' }), { state: 'offline', label: '离线' })
  assert.deepEqual(pointStatusInfo({ status: 'bad' }), { state: 'error', label: '异常' })
  assert.equal(pointBindingAvailability({ status: 'good' }).available, true)
  assert.equal(pointBindingAvailability({ status: 'stale' }).available, false)
  assert.equal(pointBindingAvailability({ status: 'offline' }).available, false)
  assert.equal(pointBindingAvailability({ status: 'bad' }).available, false)
})

test('component schema removes only clearly ineffective entries and preserves existing targets', () => {
  const commonTargets = ['fill', 'stroke', 'opacity', 'text', 'animationPlaying', 'animationDuration']
  assert.ok(commonTargets.every(target => getBindableParameter('table', target)))
  assert.ok(getBindableParameter('progress', 'text'))
  assert.equal(getBindableParameter('pencil', 'fill'), undefined)
  assert.equal(getBindableParameter('pencil', 'stroke'), undefined)
  assert.equal(getBindableParameter('polyline', 'fill'), undefined)
  assert.equal(getBindableParameter('polyline', 'stroke')?.valueType, 'color')
  for (const type of ['flowPipe', 'rotatingFan', 'signalLight', 'waterTank', 'heartbeat', 'particles']) {
    assert.equal(getBindableParameter(type, 'text'), undefined, `${type} must not expose text that it never renders`)
  }

  const emptyTextTargets = getBindableParameters({ type: 'rect', text: '', dataBindings: [] }).map(item => item.target)
  assert.equal(emptyTextTargets.includes('text'), false)
  const boundTextTargets = getBindableParameters({
    type: 'rect',
    text: '',
    dataBindings: [{ target: 'text', pointId: 'device.label' }]
  }).map(item => item.target)
  assert.equal(boundTextTargets.includes('text'), true)
})

test('communication picker validates a bounded JSONPath sample before explicit confirmation', () => {
  assert.match(panelSource, /import JsonPathTree from '\.\/JsonPathTree\.vue'/)
  assert.match(panelSource, /const nextSources = result\.slice\(0, 1000\)[\s\S]*?sources\.value = nextSources/)
  assert.match(panelSource, /getSourceSnapshot\(normalizedSourceId,\s*\{\s*shared:\s*true\s*\}\)/)
  assert.match(panelSource, /const path = canonicalizeJsonPath\(pathDraft\.value\)/)
  assert.match(panelSource, /const value = evaluateJsonPath\(snapshot\.value\.data, path\)/)
  assert.match(panelSource, /directBindingCompatibility\(activeParameter\.value\.source, \{ value, type: valueType \}\)/)
  assert.match(panelSource, /compatibility\.value\?\.compatible === true/)
  assert.match(panelSource, /parameterDataFormatGuide\(activeParameter\.value\?\.source\)/)
  assert.match(panelSource, /label\.endsWith\('数据'\)/)
  assert.match(panelSource, /data-testid="communication-data-format-guide"/)
  assert.match(panelSource, /formatExample\.jsonPath/)
  assert.match(panelSource, /formatExample\.json/)
  assert.match(panelSource, /signal:\s*'信号灯属性'/)
  assert.match(panelSource, /emit\('bind', \{[\s\S]*?sourceId: selectedSourceId\.value,[\s\S]*?jsonPath: normalizedPath\.value/)
  assert.doesNotMatch(panelSource, /querySourcePoints|listPoints|searchPoints|groupedPoints/)

  assert.match(jsonTreeSource, /maxChildren:\s*\{ type: Number, default: 60 \}/)
  assert.match(jsonTreeSource, /maxVisible:\s*\{ type: Number, default: 240 \}/)
  assert.match(jsonTreeSource, /maxDepth:\s*\{ type: Number, default: 12 \}/)
  assert.match(jsonTreeSource, /function childEntries\(value\)[\s\S]*?const limit = childLimit\.value/)
  assert.match(jsonTreeSource, /if \(result\.length >= visibleLimit\.value\)/)
})
