import assert from 'node:assert/strict'
import test from 'node:test'
import { createCancellableIdleTask } from '../src/utils/cancellableIdleTask.js'

test('cancels a pending idle callback and rejects its stale invocation', () => {
  const callbacks = new Map()
  const cancelled = []
  let nextId = 1
  let runs = 0
  const task = createCancellableIdleTask({
    requestIdle(callback) {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    },
    cancelIdle(id) { cancelled.push(id) }
  })

  task.schedule(() => { runs += 1 })
  task.cancel()
  callbacks.get(1)({ didTimeout: false, timeRemaining: () => 50 })

  assert.deepEqual(cancelled, [1])
  assert.equal(runs, 0)
  assert.equal(task.pending, false)
})

test('only the latest rescheduled idle callback may run', () => {
  const callbacks = []
  const task = createCancellableIdleTask({
    requestIdle(callback) {
      callbacks.push(callback)
      return callbacks.length
    },
    cancelIdle() {}
  })
  const runs = []

  task.schedule(() => runs.push('old'))
  task.schedule(() => runs.push('new'))
  callbacks[0]({ didTimeout: false, timeRemaining: () => 50 })
  callbacks[1]({ didTimeout: false, timeRemaining: () => 50 })

  assert.deepEqual(runs, ['new'])
  assert.equal(task.pending, false)
})

test('falls back to a cancellable timer with a timeout deadline', () => {
  const timers = new Map()
  const cleared = []
  let nextId = 1
  let receivedDeadline = null
  const task = createCancellableIdleTask({
    requestIdle() { throw new Error('idle scheduling unavailable') },
    setTimer(callback) {
      const id = nextId++
      timers.set(id, callback)
      return id
    },
    clearTimer(id) { cleared.push(id) }
  })

  task.schedule(deadline => { receivedDeadline = deadline })
  timers.get(1)()
  assert.equal(receivedDeadline.didTimeout, true)
  assert.equal(receivedDeadline.timeRemaining(), 0)

  task.schedule(() => {})
  task.dispose()
  assert.deepEqual(cleared, [2])
  assert.equal(task.schedule(() => {}), false)
})
