import assert from 'node:assert/strict'
import test from 'node:test'

import { isUsableSourceSnapshot } from '../src/utils/sourceSnapshotValidation.js'

test('accepts only an object snapshot with matching source id and its own data field', () => {
  assert.equal(isUsableSourceSnapshot({ sourceId: 'source-a', data: { value: 1 } }, ' source-a '), true)
  assert.equal(isUsableSourceSnapshot({ sourceId: 'source-a', data: undefined }, 'source-a'), true)
  assert.equal(isUsableSourceSnapshot({ sourceId: 'source-b', data: {} }, 'source-a'), false)
  assert.equal(isUsableSourceSnapshot({ sourceId: 'source-a' }, 'source-a'), false)
  assert.equal(isUsableSourceSnapshot([], 'source-a'), false)
  assert.equal(isUsableSourceSnapshot(null, 'source-a'), false)
})

test('rejects inherited data and hostile snapshot objects without throwing', () => {
  const inherited = Object.create({ data: { value: 1 } })
  inherited.sourceId = 'source-a'
  assert.equal(isUsableSourceSnapshot(inherited, 'source-a'), false)

  const { proxy, revoke } = Proxy.revocable({ sourceId: 'source-a', data: {} }, {})
  revoke()
  assert.doesNotThrow(() => isUsableSourceSnapshot(proxy, 'source-a'))
  assert.equal(isUsableSourceSnapshot(proxy, 'source-a'), false)
})
