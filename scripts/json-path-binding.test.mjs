import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_JSON_PATH_LENGTH,
  MAX_JSON_PATH_TOKENS,
  canonicalizeJsonPath,
  compileJsonPath,
  evaluateJsonPath,
  jsonPathForChild,
  jsonValueType,
  sourceBindingDescriptor,
  sourceBindingRuntimeKey
} from '../src/utils/jsonPathBinding.js'

test('canonicalizes the supported JSONPath subset without evaluating source text', () => {
  assert.equal(canonicalizeJsonPath('$'), '$')
  assert.equal(canonicalizeJsonPath("$['factory']['line-1'][01]['温度']"), "$.factory['line-1'][1]['温度']")
  assert.equal(canonicalizeJsonPath("$['quote\\\'and\\\\slash']"), "$['quote\\\'and\\\\slash']")

  const compiled = compileJsonPath("$['factory'].lines[2]['温度']")
  assert.equal(compiled.path, "$.factory.lines[2]['温度']")
  assert.deepEqual(compiled.tokens, [
    { type: 'property', key: 'factory' },
    { type: 'property', key: 'lines' },
    { type: 'index', index: 2 },
    { type: 'property', key: '温度' }
  ])
  assert.ok(Object.isFrozen(compiled))
  assert.ok(Object.isFrozen(compiled.tokens))
})

test('builds child paths for identifiers, arbitrary object keys and array indexes', () => {
  assert.equal(jsonPathForChild('$', 'factory'), '$.factory')
  assert.equal(jsonPathForChild('$.factory', 'line-1'), "$.factory['line-1']")
  assert.equal(jsonPathForChild('$.factory', "a'b\\c"), "$.factory['a\\'b\\\\c']")
  assert.equal(jsonPathForChild('$.rows', 12), '$.rows[12]')
  assert.equal(jsonPathForChild('$.rows', '12'), "$.rows['12']")
})

test('rejects executable, recursive, wildcard and prototype-dangerous paths within fixed budgets', () => {
  const invalidPaths = [
    '',
    'factory.value',
    '$.constructor',
    "$['__proto__']",
    "$['prototype']",
    '$..value',
    '$.*',
    '$[?(@.ok)]',
    '$[0:2]',
    '$[-1]',
    '$["value"]',
    '$.value()',
    '$[foo]',
    '$[1.5]',
    '$.a b',
    "$['bad\\x']"
  ]
  for (const path of invalidPaths) {
    assert.throws(() => compileJsonPath(path), { name: /TypeError|RangeError/ }, path)
  }

  assert.throws(() => compileJsonPath(`$${'.value'.repeat(MAX_JSON_PATH_TOKENS + 1)}`), RangeError)
  assert.throws(() => compileJsonPath(`$['${'x'.repeat(MAX_JSON_PATH_LENGTH)}']`), RangeError)
  assert.throws(() => jsonPathForChild('$', '__proto__'), TypeError)
})

test('evaluates only own properties and contains missing or throwing values', () => {
  const inherited = { inherited: '不可读取' }
  const value = Object.assign(Object.create(inherited), {
    factory: {
      rows: [{ temperature: 18 }, { temperature: 23 }]
    }
  })
  Object.defineProperty(value.factory, 'throwing', {
    enumerable: true,
    get() { throw new Error('getter failed') }
  })

  assert.equal(evaluateJsonPath(value, '$'), value)
  assert.equal(evaluateJsonPath(value, '$.factory.rows[1].temperature'), 23)
  assert.equal(evaluateJsonPath(value, '$.factory.rows[9].temperature'), undefined)
  assert.equal(evaluateJsonPath(value, '$.inherited'), undefined)
  assert.equal(evaluateJsonPath(value, '$.factory.throwing'), undefined)
  assert.equal(evaluateJsonPath(null, '$.factory'), undefined)
  assert.equal(evaluateJsonPath(value, {
    path: '$.constructor',
    tokens: [{ type: 'property', key: 'constructor' }]
  }), undefined)

  const compiled = compileJsonPath('$.factory.rows[0]')
  assert.deepEqual(evaluateJsonPath(value, compiled), { temperature: 18 })
})

test('reports JSON-facing value types and creates collision-free stable runtime keys', () => {
  assert.equal(jsonValueType(null), 'null')
  assert.equal(jsonValueType([]), 'array')
  assert.equal(jsonValueType(new Date(0)), 'date')
  assert.equal(jsonValueType({}), 'object')
  assert.equal(jsonValueType('1'), 'string')
  assert.equal(jsonValueType(1), 'number')
  assert.equal(jsonValueType(true), 'boolean')
  assert.equal(jsonValueType(1n), 'bigint')
  assert.equal(jsonValueType(undefined), 'undefined')

  const first = sourceBindingRuntimeKey('source:a', "$.data['b:c']")
  const second = sourceBindingRuntimeKey('source', "$.a.data['b:c']")
  assert.equal(first, sourceBindingRuntimeKey('source:a', "$['data']['b:c']"))
  assert.notEqual(first, second)
  assert.equal(typeof first, 'object')
  assert.match(String(first), /^source-binding:/)
})

test('reuses one compiled descriptor per stable binding object and invalidates it after mutation', () => {
  const binding = { sourceId: 'source-a', jsonPath: "$['data']['value']" }
  const first = sourceBindingDescriptor(binding)
  const second = sourceBindingDescriptor(binding)
  assert.strictEqual(first, second)
  assert.equal(first.sourceId, 'source-a')
  assert.equal(first.jsonPath, '$.data.value')
  assert.equal(first.runtimeKey, sourceBindingRuntimeKey('source-a', '$.data.value'))
  assert.ok(Object.isFrozen(first))

  binding.jsonPath = '$.data.other'
  const changed = sourceBindingDescriptor(binding)
  assert.notStrictEqual(changed, first)
  assert.equal(changed.jsonPath, '$.data.other')
  assert.equal(sourceBindingDescriptor({ sourceId: '', jsonPath: '$.data' }), null)
  assert.equal(sourceBindingDescriptor({ sourceId: 'source-a', jsonPath: '$..bad' }), null)
})
