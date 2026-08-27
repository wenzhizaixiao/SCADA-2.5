import assert from 'node:assert/strict'
import test from 'node:test'

import { createJsonResponsePointPreview } from '../src/utils/jsonResponsePointPreview.js'

test('creates canonical path, type and bounded value rows for nested response data', () => {
  const rows = createJsonResponsePointPreview({
    device: { id: 7, running: true },
    rows: [{ 'line-name': 'A' }],
    empty: null
  })

  assert.deepEqual(rows.map(row => [row.path, row.type]), [
    ['$', 'object'],
    ['$.device', 'object'],
    ['$.device.id', 'number'],
    ['$.device.running', 'boolean'],
    ['$.rows', 'array'],
    ['$.rows[0]', 'object'],
    ["$.rows[0]['line-name']", 'string'],
    ['$.empty', 'null']
  ])
  assert.equal(rows.find(row => row.path === '$.device.id').value, '7')
  assert.equal(rows.find(row => row.path === "$.rows[0]['line-name']").value, 'A')
  assert.ok(rows.every(row => Object.keys(row).join(',') === 'path,type,value'))
})

test('enforces total rows, depth and per-container scan budgets', () => {
  const wide = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
    `key${index}`,
    { nested: index }
  ]))

  const rowLimited = createJsonResponsePointPreview(wide, {
    maxRows: 7,
    maxDepth: 8,
    maxChildren: 100
  })
  assert.equal(rowLimited.length, 7)

  const depthLimited = createJsonResponsePointPreview({ a: { b: { c: 1 } } }, {
    maxRows: 80,
    maxDepth: 1,
    maxChildren: 40
  })
  assert.deepEqual(depthLimited.map(row => row.path), ['$', '$.a'])

  const widthLimited = createJsonResponsePointPreview(wide, {
    maxRows: 80,
    maxDepth: 1,
    maxChildren: 3
  })
  assert.deepEqual(widthLimited.map(row => row.path), ['$', '$.key0', '$.key1', '$.key2'])

  const hardLimited = createJsonResponsePointPreview(wide, {
    maxRows: Number.MAX_SAFE_INTEGER,
    maxDepth: Number.MAX_SAFE_INTEGER,
    maxChildren: Number.MAX_SAFE_INTEGER
  })
  assert.equal(hardLimited.length, 80)
})

test('does not read beyond the array width budget or materialize a huge sparse array', () => {
  let indexReads = 0
  let ownChecks = 0
  const array = new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') return 1_000_000_000
      if (/^\d+$/.test(String(key))) indexReads += 1
      return Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      if (/^\d+$/.test(String(key))) {
        ownChecks += 1
        return { configurable: true, enumerable: true, value: Number(key), writable: true }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    }
  })

  const rows = createJsonResponsePointPreview(array, { maxChildren: 4, maxRows: 80 })

  assert.equal(rows.length, 5)
  assert.equal(indexReads, 4)
  assert.equal(ownChecks, 4)
  assert.deepEqual(rows.slice(1).map(row => row.path), ['$[0]', '$[1]', '$[2]', '$[3]'])
})

test('contains cycles and throwing getters while never reading dangerous properties', () => {
  const response = { name: 'root' }
  response.self = response
  Object.defineProperty(response, 'failed', {
    enumerable: true,
    get() { throw new Error('unavailable') }
  })
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    Object.defineProperty(response, key, {
      configurable: true,
      enumerable: true,
      get() { throw new Error(`dangerous key read: ${key}`) }
    })
  }

  const rows = createJsonResponsePointPreview(response, { maxRows: 80, maxDepth: 8 })

  assert.ok(rows.length < 10)
  assert.deepEqual(rows.find(row => row.path === '$.failed'), {
    path: '$.failed',
    type: 'unknown',
    value: '[无法读取]'
  })
  assert.ok(rows.some(row => row.path === '$.self'))
  assert.ok(rows.every(row => !/__proto__|prototype|constructor/.test(row.path)))
})

test('avoids full object expansion and caps property getter work', () => {
  const originalEntries = Object.entries
  const originalFlatMap = Array.prototype.flatMap
  let reads = 0
  const response = {}
  for (let index = 0; index < 1000; index += 1) {
    Object.defineProperty(response, `value${index}`, {
      enumerable: true,
      get() {
        reads += 1
        return index
      }
    })
  }

  Object.entries = () => { throw new Error('must not materialize all entries') }
  Array.prototype.flatMap = () => { throw new Error('must not flatten all entries') }
  try {
    const rows = createJsonResponsePointPreview(response, {
      maxRows: 80,
      maxDepth: 1,
      maxChildren: 5
    })
    assert.equal(rows.length, 6)
    assert.equal(reads, 5)
  } finally {
    Object.entries = originalEntries
    Array.prototype.flatMap = originalFlatMap
  }
})

test('returns a safe root preview for hostile proxy values', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()

  assert.doesNotThrow(() => createJsonResponsePointPreview(proxy))
  assert.deepEqual(createJsonResponsePointPreview(proxy), [{
    path: '$',
    type: 'unknown',
    value: '[Unformattable]'
  }])
})

test('formats every row value within a small independent character budget', () => {
  const rows = createJsonResponsePointPreview({
    message: 'x'.repeat(10_000),
    nested: { value: 1 }
  }, { maxValueLength: 24 })

  assert.ok(rows.every(row => row.value.length <= 24))
  assert.equal(rows.find(row => row.path === '$').value, '{...}')
  assert.match(rows.find(row => row.path === '$.message').value, /\.\.\.$/)
})
