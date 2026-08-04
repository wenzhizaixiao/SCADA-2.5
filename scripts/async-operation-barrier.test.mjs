import assert from 'node:assert/strict'
import test from 'node:test'
import { createAsyncOperationBarrier } from '../src/utils/asyncOperationBarrier.js'

test('waits for every active operation before settling', async () => {
  const barrier = createAsyncOperationBarrier()
  const first = barrier.begin('first')
  const second = barrier.begin('second')
  let settled = false
  const idle = barrier.whenIdle().then(result => {
    settled = true
    return result
  })

  barrier.end(first)
  await Promise.resolve()
  assert.equal(settled, false)
  barrier.end(second)

  assert.equal(await idle, true)
  assert.deepEqual(barrier.state, { active: false, activeCount: 0, disposed: false })
})

test('does not cross a replacement operation started by the completing callback', async () => {
  const barrier = createAsyncOperationBarrier()
  const first = barrier.begin('capture')
  const idle = barrier.whenIdle()

  barrier.end(first)
  const replacement = barrier.begin('insert')
  let settled = false
  idle.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)

  barrier.end(replacement)
  assert.equal(await idle, true)
})

test('dispose releases waiters and rejects future work', async () => {
  const barrier = createAsyncOperationBarrier()
  barrier.begin('pending')
  const idle = barrier.whenIdle()

  barrier.dispose()

  assert.equal(await idle, false)
  assert.equal(barrier.begin('late'), null)
  assert.deepEqual(barrier.state, { active: false, activeCount: 0, disposed: true })
})
