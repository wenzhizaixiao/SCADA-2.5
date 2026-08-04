import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createInteractionCommitBarrier } from '../src/utils/interactionCommitBarrier.js'

function createFrameQueue() {
  let nextId = 1
  const frames = []
  return {
    schedule(callback) {
      const frame = { id: nextId++, callback, cancelled: false }
      frames.push(frame)
      return frame
    },
    cancel(frame) {
      if (frame) frame.cancelled = true
    },
    flushOne() {
      const frame = frames.shift()
      if (frame && !frame.cancelled) frame.callback()
    },
    flushAll(limit = 20) {
      let count = 0
      while (frames.length && count++ < limit) this.flushOne()
      assert.ok(count < limit, 'scheduled work did not settle')
    },
    get pending() {
      return frames.filter(frame => !frame.cancelled).length
    }
  }
}

test('deferred publication waits for every active interaction and a clean resume frame', () => {
  const queue = createFrameQueue()
  const barrier = createInteractionCommitBarrier({
    schedule: callback => queue.schedule(callback),
    cancel: frame => queue.cancel(frame)
  })
  const initialGeneration = barrier.state.generation
  const published = []

  barrier.begin('pointer')
  const pointerGeneration = barrier.state.generation
  barrier.begin('scroll')
  barrier.defer('bundle', () => published.push('bundle'))

  assert.equal(barrier.state.activeCount, 2)
  assert.equal(queue.pending, 0)
  assert.equal(barrier.isCurrent(pointerGeneration), false)

  barrier.end('pointer')
  assert.equal(queue.pending, 0)
  barrier.end('scroll')
  assert.equal(queue.pending, 1)
  assert.deepEqual(published, [])

  queue.flushOne()
  assert.deepEqual(published, ['bundle'])
  assert.equal(barrier.state.deferredCount, 0)
  assert.equal(barrier.state.generation, initialGeneration + 4)
  assert.equal(barrier.isCurrent(barrier.state.generation), true)
})

test('a new interaction cancels the pending resume and preserves deferred work', () => {
  const queue = createFrameQueue()
  const barrier = createInteractionCommitBarrier({
    schedule: callback => queue.schedule(callback),
    cancel: frame => queue.cancel(frame)
  })
  const published = []

  barrier.defer('compaction', () => published.push('compacted'))
  assert.equal(queue.pending, 1)
  barrier.begin('wheel')
  queue.flushAll()
  assert.deepEqual(published, [])

  barrier.end('wheel')
  queue.flushAll()
  assert.deepEqual(published, ['compacted'])
})

test('keyed retries are coalesced and can be cancelled on document reset', () => {
  const queue = createFrameQueue()
  const barrier = createInteractionCommitBarrier({
    schedule: callback => queue.schedule(callback),
    cancel: frame => queue.cancel(frame)
  })
  const published = []

  barrier.begin('pointer')
  barrier.defer('capture', () => published.push('old'))
  barrier.defer('capture', () => published.push('latest'))
  barrier.defer('compaction', () => published.push('compaction'))
  assert.equal(barrier.state.deferredCount, 2)
  assert.equal(barrier.cancelDeferred('compaction'), true)
  barrier.end('pointer')
  queue.flushAll()

  assert.deepEqual(published, ['latest'])
  barrier.defer('capture', () => published.push('after-reset'))
  barrier.reset()
  queue.flushAll()
  assert.deepEqual(published, ['latest'])
})

test('a callback can reschedule the same function under the same key', () => {
  const queue = createFrameQueue()
  const barrier = createInteractionCommitBarrier({
    schedule: callback => queue.schedule(callback),
    cancel: frame => queue.cancel(frame)
  })
  let runs = 0
  function retry() {
    runs += 1
    if (runs < 2) barrier.defer('retry', retry)
  }

  barrier.defer('retry', retry)
  queue.flushAll()

  assert.equal(runs, 2)
  assert.equal(barrier.state.deferredCount, 0)
})

test('whenIdle waits for every interaction and dispose cancels pending waiters', async () => {
  const barrier = createInteractionCommitBarrier()
  barrier.begin('pointer')
  barrier.begin('scroll')
  let settled = false
  const idle = barrier.whenIdle().then(result => {
    settled = true
    return result
  })

  await Promise.resolve()
  assert.equal(settled, false)
  barrier.end('pointer')
  await Promise.resolve()
  assert.equal(settled, false)
  barrier.end('scroll')
  assert.equal(await idle, true)

  barrier.begin('pointer')
  const cancelled = barrier.whenIdle()
  barrier.dispose()
  assert.equal(await cancelled, false)
})

test('App gates bundle publication and index compaction with the interaction generation', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.match(source, /createInteractionCommitBarrier\(\{[\s\S]*?scheduleBundleFrame[\s\S]*?cancelBundleFrame/)
  assert.match(source, /function beginPointerOperation[\s\S]*?beginEditorInteraction\(POINTER_INTERACTION\)/)
  assert.match(source, /function pointerUp[\s\S]*?endEditorInteraction\(POINTER_INTERACTION\)/)
  assert.match(source, /function canvasWheel[\s\S]*?beginEditorInteraction\(CANVAS_ZOOM_INTERACTION\)/)
  assert.match(source, /function updateViewport\(source = null\)[\s\S]*?pulseCanvasScrollInteraction\(\)/)
  assert.match(source, /function setConnectionAnchor[\s\S]*?beginEditorInteraction\(CONNECTION_INTERACTION\)[\s\S]*?endEditorInteraction\(CONNECTION_INTERACTION\)/)

  const instanceScheduler = source.match(/const bundleInstanceScheduler = createChunkedRenderScheduler\(\{[\s\S]*?\n\}\)\n\nfunction deferBundleCaptureRetry/)?.[0] || ''
  assert.match(instanceScheduler, /interactionPayloadIsCurrent\(payload\)/)
  assert.match(instanceScheduler, /interactionCommitBarrier\.state\.active\) return false/)
  assert.match(instanceScheduler, /payload\.interactionGeneration = currentInteractionGeneration\(\)/)
  assert.match(instanceScheduler, /payload\.documentVersion = documentChangeVersion/)

  const captureScheduler = source.match(/const bundleCaptureScheduler = createChunkedRenderScheduler\(\{[\s\S]*?\n\}\)\n\nlet indexCompactionRetryTimer/)?.[0] || ''
  assert.match(captureScheduler, /task\.interactionStale = true/)
  assert.match(captureScheduler, /deferBundleCaptureRetry\(payload\)/)

  const compactionScheduler = source.match(/const documentIndexCompactionScheduler = createChunkedRenderScheduler\(\{[\s\S]*?\n\}\)\n\nfunction scheduleDocumentIndexCompaction/)?.[0] || ''
  assert.match(compactionScheduler, /task\.interactionStale = true/)
  assert.match(compactionScheduler, /interactionCommitBarrier\.defer\(DOCUMENT_INDEX_COMPACTION_RETRY, scheduleDocumentIndexCompaction\)/)
  assert.match(source, /documentVersion: documentChangeVersion,\s*interactionGeneration: currentInteractionGeneration\(\),\s*nodes: nodes\.value/)
})
