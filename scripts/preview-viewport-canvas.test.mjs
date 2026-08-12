import assert from 'node:assert/strict'
import test from 'node:test'

import {
  previewViewportOverscan,
  previewViewportPixelRatio
} from '../src/utils/previewViewportCanvas.js'

test('viewport Canvas uses the real device density instead of forcing a 2x bitmap', () => {
  assert.equal(previewViewportPixelRatio(1), 1)
  assert.equal(previewViewportPixelRatio(1.5), 1.5)
  assert.equal(previewViewportPixelRatio(2), 2)
  assert.equal(previewViewportPixelRatio(8), 3)
})

test('viewport Canvas reduces overscan before reducing visible viewport density', () => {
  const preferred = previewViewportOverscan({
    width: 1200,
    height: 800,
    pixelRatio: 2,
    preferred: 192,
    maximumPixels: 8_388_608
  })
  assert.equal(preferred, 192)

  const reduced = previewViewportOverscan({
    width: 1800,
    height: 1000,
    pixelRatio: 2,
    preferred: 192,
    maximumPixels: 8_388_608
  })
  assert.ok(reduced >= 0 && reduced < 192)
  assert.ok((1800 + reduced * 2) * (1000 + reduced * 2) * 4 <= 8_388_608)

  assert.equal(previewViewportOverscan({
    width: 2200,
    height: 1200,
    pixelRatio: 2,
    preferred: 192,
    maximumPixels: 8_388_608
  }), 0)
})
