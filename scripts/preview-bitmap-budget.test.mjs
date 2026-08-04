import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_PREVIEW_BITMAP_PIXEL_RATIO,
  MAX_PREVIEW_BOOTSTRAP_BITMAP_PIXELS,
  MAX_PREVIEW_BITMAP_PIXELS,
  previewBitmapIsSharp,
  previewBitmapPixelBudget,
  previewBitmapPixelRatio
} from '../src/utils/previewBitmapBudget.js'
import { canvasBitmapDimensions, MAX_CANVAS_PIXEL_RATIO } from '../src/utils/canvasBitmap.js'
import { previewPixelAlignedOffset } from '../src/utils/previewPixelAlignment.js'

test('fit preview allocates at least 2x the displayed pixels on 1x and 2x displays', () => {
  const stageWidth = 9355
  const stageHeight = 2643
  const scale = 0.1

  const requiredAt2x = (Math.ceil(stageWidth * scale * 2) + 1)
    * (Math.ceil(stageHeight * scale * 2) + 1)
  assert.equal(previewBitmapPixelBudget({
    fitActive: true,
    stageWidth,
    stageHeight,
    scale,
    devicePixelRatio: 1
  }), requiredAt2x)

  assert.equal(previewBitmapPixelBudget({
    fitActive: true,
    stageWidth,
    stageHeight,
    scale,
    devicePixelRatio: 2
  }), requiredAt2x)
  assert.equal(MIN_PREVIEW_BITMAP_PIXEL_RATIO, 2)
})

test('fit preview keeps the formal wide drawing at 2x effective display density', () => {
  const stageWidth = 9355
  const stageHeight = 2643
  const scale = 2128 / stageWidth
  const budget = previewBitmapPixelBudget({
    fitActive: true,
    stageWidth,
    stageHeight,
    scale,
    devicePixelRatio: 1
  })
  const displayWidth = stageWidth * scale
  const displayHeight = stageHeight * scale
  const bitmap = canvasBitmapDimensions({
    width: displayWidth,
    height: displayHeight,
    devicePixelRatio: previewBitmapPixelRatio(1),
    maximum: budget
  })

  assert.ok(bitmap.bitmapWidth / displayWidth >= 2)
  assert.ok(bitmap.bitmapHeight / displayHeight >= 2)
  assert.ok(bitmap.bitmapWidth * bitmap.bitmapHeight <= MAX_PREVIEW_BITMAP_PIXELS)
})

test('preview renderer requests the same bounded pixel ratio used by its budget', () => {
  assert.equal(previewBitmapPixelRatio(1), 2)
  assert.equal(previewBitmapPixelRatio(1.5), 2)
  assert.equal(previewBitmapPixelRatio(2.5), 2.5)
  assert.equal(previewBitmapPixelRatio(4), MAX_CANVAS_PIXEL_RATIO)
})

test('preview handoff requires the requested display density instead of one CSS pixel', () => {
  assert.equal(previewBitmapIsSharp(2, 2), true)
  assert.equal(previewBitmapIsSharp(1.995, 2), true)
  assert.equal(previewBitmapIsSharp(1.5, 2), false)
  assert.equal(previewBitmapIsSharp(1, 2), false)
  assert.equal(previewBitmapIsSharp(0, 2), false)
})

test('centers the fit preview on a physical-pixel-aligned parent offset', () => {
  const offset = previewPixelAlignedOffset({
    available: 670,
    rendered: 361.625,
    origin: 50,
    devicePixelRatio: 1.5
  })
  assert.ok(Math.abs((50 + offset) * 1.5 - Math.round((50 + offset) * 1.5)) < 1e-9)
  assert.ok(Math.abs(offset - (670 - 361.625) / 2) <= 1 / 1.5 / 2)
  assert.equal(previewPixelAlignedOffset({ available: 100, rendered: 100, origin: 0.25, devicePixelRatio: 2 }), 0)
})

test('caps large and invalid fit requests at the existing quality ceiling', () => {
  assert.equal(previewBitmapPixelBudget({
    fitActive: true,
    stageWidth: 20_000,
    stageHeight: 20_000,
    scale: 1,
    devicePixelRatio: 3
  }), MAX_PREVIEW_BITMAP_PIXELS)
  assert.equal(previewBitmapPixelBudget({ fitActive: true, scale: 0 }), MAX_PREVIEW_BITMAP_PIXELS)
  assert.equal(previewBitmapPixelBudget({ fitActive: false }), MAX_PREVIEW_BOOTSTRAP_BITMAP_PIXELS)
})

test('shares the renderer pixel-ratio ceiling before applying the global cap', () => {
  assert.equal(previewBitmapPixelBudget({
    fitActive: true,
    stageWidth: 100,
    stageHeight: 100,
    scale: 1,
    devicePixelRatio: 4
  }), 90_601)
  assert.equal(MAX_CANVAS_PIXEL_RATIO, 3)
})

test('allocates uncapped bitmap axes without subpixel undersampling', () => {
  const zoom = 1 / 1.1 ** 8
  const width = 9355 * zoom
  const height = 2643 * zoom
  const formal = canvasBitmapDimensions({ width, height, devicePixelRatio: 1, maximum: 5_382_045 })
  assert.deepEqual([formal.bitmapWidth, formal.bitmapHeight], [4365, 1233])
  assert.ok(formal.pixelRatioX >= 1)
  assert.ok(formal.pixelRatioY >= 1)

  const narrow = canvasBitmapDimensions({ width: 64, height: 528.6, devicePixelRatio: 1, maximum: 33_856 })
  assert.deepEqual([narrow.bitmapWidth, narrow.bitmapHeight], [64, 529])
  assert.ok(narrow.pixelRatioX >= 1)
  assert.ok(narrow.pixelRatioY >= 1)
})

test('keeps hard-capped bitmap dimensions inside the pixel budget', () => {
  const width = 9355 * 0.8
  const height = 2643 * 0.8
  const maximum = 4_194_304
  const result = canvasBitmapDimensions({ width, height, devicePixelRatio: 2, maximum })
  const target = Math.sqrt(maximum / (width * height))
  const tolerance = 2 / Math.min(width, height)
  assert.equal(result.capped, true)
  assert.ok(result.bitmapWidth * result.bitmapHeight <= maximum)
  assert.ok(result.pixelRatioX + tolerance >= target)
  assert.ok(result.pixelRatioY + tolerance >= target)
})
