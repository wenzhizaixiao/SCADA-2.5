import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreviewMediaReadinessGate } from '../src/utils/previewMediaReadiness.js'

function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

function fakeMedia(tagName, overrides = {}) {
  const listeners = new Map()
  return {
    tagName,
    currentSrc: overrides.src || '',
    src: overrides.src || '',
    complete: overrides.complete,
    naturalWidth: overrides.naturalWidth,
    readyState: overrides.readyState,
    error: overrides.error || null,
    dataset: {},
    classList: { add() {}, remove() {} },
    decode: overrides.decode,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    emit(type) {
      for (const handler of [...(listeners.get(type) || [])]) handler({ currentTarget: this })
    },
    listenerCount() {
      let count = 0
      for (const handlers of listeners.values()) count += handlers.size
      return count
    }
  }
}

function fakeStage(media = []) {
  return {
    media,
    querySelectorAll(selector) {
      assert.equal(selector, 'img, video')
      return this.media
    }
  }
}

test('preview media gate waits for image decode before publishing a complete stage', async () => {
  const decoded = deferred()
  const image = fakeMedia('IMG', {
    src: '/large-image.png',
    complete: true,
    naturalWidth: 1920,
    decode: () => decoded.promise
  })
  const stage = fakeStage([image])
  const gate = createPreviewMediaReadinessGate()

  let ready = false
  const waiting = gate.wait(stage).then(value => { ready = value })
  await Promise.resolve()
  assert.equal(ready, false, 'native load completion is not enough while decode is pending')

  decoded.resolve()
  await waiting
  assert.equal(ready, true)
  assert.equal(image.listenerCount(), 0)
})

test('preview media gate waits for the first drawable video frame', async () => {
  const video = fakeMedia('VIDEO', {
    src: '/process.mp4',
    readyState: 1
  })
  const stage = fakeStage([video])
  const gate = createPreviewMediaReadinessGate()

  let ready = false
  const waiting = gate.wait(stage).then(value => { ready = value })
  await Promise.resolve()
  assert.equal(ready, false)

  video.readyState = 2
  video.emit('loadeddata')
  await waiting
  assert.equal(ready, true)
  assert.equal(video.listenerCount(), 0)
})

test('preview media gate cancels stale stages and keeps the current generation isolated', async () => {
  const firstImage = fakeMedia('IMG', {
    src: '/first.png',
    complete: false,
    naturalWidth: 0,
    decode: () => Promise.resolve()
  })
  const secondImage = fakeMedia('IMG', {
    src: '/second.png',
    complete: false,
    naturalWidth: 0,
    decode: () => Promise.resolve()
  })
  const stage = fakeStage([firstImage])
  const gate = createPreviewMediaReadinessGate()

  const stale = gate.wait(stage)
  stage.media = [secondImage]
  const current = gate.wait(stage)
  assert.equal(await stale, false)
  assert.equal(firstImage.listenerCount(), 0)

  secondImage.complete = true
  secondImage.naturalWidth = 800
  secondImage.emit('load')
  assert.equal(await current, true)
  assert.equal(secondImage.listenerCount(), 0)
})

test('failed media settles only after the explicit fallback state is visible', async () => {
  let flushDom
  const domUpdated = new Promise(resolve => { flushDom = resolve })
  const image = fakeMedia('IMG', {
    src: '/missing.png',
    complete: false,
    naturalWidth: 0,
    decode: () => Promise.resolve()
  })
  const stage = fakeStage([image])
  const gate = createPreviewMediaReadinessGate({ afterDomUpdate: () => domUpdated })

  let ready = false
  const waiting = gate.wait(stage).then(value => { ready = value })
  image.complete = true
  image.dataset.previewMediaState = 'error'
  image.emit('error')
  await Promise.resolve()
  assert.equal(ready, false)

  flushDom()
  await waiting
  assert.equal(ready, true)
})
