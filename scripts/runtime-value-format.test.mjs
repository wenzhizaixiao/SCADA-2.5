import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS,
  formatRuntimeValue
} from '../src/utils/runtimeValueFormat.js'

test('formats primitive and common runtime values without JSON serialization', () => {
  const originalStringify = JSON.stringify
  JSON.stringify = () => { throw new Error('runtime values must not be serialized in full') }
  try {
    assert.equal(formatRuntimeValue('running'), 'running')
    assert.equal(formatRuntimeValue(12.5), '12.5')
    assert.equal(formatRuntimeValue(true), 'true')
    assert.equal(formatRuntimeValue(null), 'null')
    assert.equal(formatRuntimeValue(undefined), 'undefined')
    assert.equal(formatRuntimeValue(42n), '42n')
    assert.equal(formatRuntimeValue(new Date('2026-07-27T01:02:03.000Z')), '"2026-07-27T01:02:03.000Z"')
    assert.equal(formatRuntimeValue({ state: 'running', samples: [1, true, null] }), '{"state":"running","samples":[1,true,null]}')
  } finally {
    JSON.stringify = originalStringify
  }
})

test('bounds output length and reads only the configured number of object keys', () => {
  let reads = 0
  const value = {}
  for (let index = 0; index < 1000; index += 1) {
    Object.defineProperty(value, `key${index}`, {
      enumerable: true,
      get() {
        reads += 1
        return index === 0 ? 'x'.repeat(100_000) : index
      }
    })
  }

  const formatted = formatRuntimeValue(value, {
    maxLength: 80,
    maxObjectKeys: 3,
    maxTotalEntries: 3
  })

  assert.ok(formatted.length <= 80)
  assert.match(formatted, /^\{"key0":"x+/)
  assert.match(formatted, /\.\.\./)
  assert.ok(reads <= 3, `read ${reads} properties`)
})

test('bounds array item reads independently of a very large declared length', () => {
  let itemReads = 0
  const value = new Proxy([], {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) itemReads += 1
      if (key === 'length') return 1_000_000_000
      return Reflect.get(target, key, receiver)
    }
  })

  const formatted = formatRuntimeValue(value, { maxArrayItems: 4, maxTotalEntries: 4 })
  assert.equal(itemReads, 4)
  assert.equal(formatted, '[undefined,undefined,undefined,undefined,...]')
})

test('bounds nesting depth and handles cycles and throwing properties', () => {
  const cyclic = { name: 'root' }
  cyclic.self = cyclic
  Object.defineProperty(cyclic, 'failed', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  cyclic.deep = { child: { child: { child: { value: 1 } } } }

  const formatted = formatRuntimeValue(cyclic, { maxDepth: 2, maxLength: 256 })
  assert.match(formatted, /"self":\[Circular\]/)
  assert.match(formatted, /"failed":\[Thrown\]/)
  assert.match(formatted, /"deep":\{"child":\{\.\.\.\}\}/)
  assert.ok(formatted.length <= DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxLength)
})

test('large BigInt values and revoked proxies remain bounded and never throw', () => {
  const largeBigInt = 10n ** 10_000n
  assert.match(formatRuntimeValue(largeBigInt), /^\[BigInt exceeds display budget\]$/)

  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  assert.doesNotThrow(() => formatRuntimeValue(proxy))
  assert.equal(formatRuntimeValue(proxy), '[Unformattable]')
})

test('character budget clips strings without splitting a surrogate pair', () => {
  const value = `${'a'.repeat(20)}\u{1F680}${'b'.repeat(20)}`
  const formatted = formatRuntimeValue(value, { maxLength: 24 })
  assert.ok(formatted.length <= 24)
  assert.match(formatted, /\.\.\.$/)
  assert.doesNotMatch(formatted, /[\uD800-\uDBFF]$/)
})

test('every supported container respects very small character budgets', () => {
  const values = [
    { value: 1 },
    [1, 2, 3],
    new Map([['key', 'value']]),
    new Set([1, 2, 3]),
    new Date('2026-07-27T01:02:03.000Z'),
    /long-pattern/giu
  ]

  for (let maxLength = 0; maxLength <= 8; maxLength += 1) {
    for (const value of values) {
      const formatted = formatRuntimeValue(value, { maxLength })
      assert.ok(formatted.length <= maxLength, `${formatted} exceeded ${maxLength}`)
    }
  }
})
