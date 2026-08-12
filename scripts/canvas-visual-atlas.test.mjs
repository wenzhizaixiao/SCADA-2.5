import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasVisualAtlasBlitData,
  drawCanvasVisualAtlasBlits,
  mapCanvasVisualAtlasInstances,
  packCanvasVisualAtlas
} from '../src/utils/canvasVisualAtlas.js'

function overlaps(left, right) {
  return left.x < right.x + right.w
    && right.x < left.x + left.w
    && left.y < right.y + right.h
    && right.y < left.y + left.h
}

test('packs unique visual sprites deterministically within atlas bounds', () => {
  const entries = [
    { signature: 'pipe', width: 31, height: 12 },
    { signature: 'fan', width: 24, height: 24 },
    { signature: 'signal', width: 14, height: 14 },
    { signature: 'tank', width: 18, height: 28 }
  ]
  const first = packCanvasVisualAtlas(entries, { maxWidth: 128, maxHeight: 128, maxPixels: 16_384 })
  const second = packCanvasVisualAtlas(entries.slice().reverse(), { maxWidth: 128, maxHeight: 128, maxPixels: 16_384 })
  assert.ok(first)
  assert.equal(first.width * first.height, first.pixels)
  assert.deepEqual([...first.slots], [...second.slots])

  const slots = [...first.slots.values()]
  for (const slot of slots) {
    assert.ok(slot.x >= 1 && slot.y >= 1)
    assert.ok(slot.x + slot.w < first.width)
    assert.ok(slot.y + slot.h < first.height)
  }
  for (let left = 0; left < slots.length; left += 1) {
    for (let right = left + 1; right < slots.length; right += 1) {
      assert.equal(overlaps(slots[left], slots[right]), false)
    }
  }
})

test('padding is included in atlas allocation and pixel budgets', () => {
  const overBudget = packCanvasVisualAtlas([
    { signature: 'a', width: 30, height: 30 }
  ], { maxWidth: 32, maxHeight: 32, maxPixels: 1023, padding: 1 })
  assert.equal(overBudget, null)

  const tooWide = packCanvasVisualAtlas([
    { signature: 'a', width: 31, height: 30 }
  ], { maxWidth: 32, maxHeight: 32, maxPixels: 1024, padding: 1 })
  assert.equal(tooWide, null)

  const roomy = packCanvasVisualAtlas([
    { signature: 'a', width: 30, height: 30 }
  ], { maxWidth: 64, maxHeight: 64, maxPixels: 4096, padding: 1 })
  assert.deepEqual(roomy?.slots.get('a'), { x: 1, y: 1, w: 30, h: 30 })
  assert.equal(roomy.width * roomy.height, roomy.pixels)
})

test('atlas output stays tightly NPOT instead of uploading power-of-two slack', () => {
  const packed = packCanvasVisualAtlas([
    { signature: 'wide', width: 30, height: 10 }
  ], { maxWidth: 64, maxHeight: 64, maxPixels: 4096, padding: 1 })
  assert.equal(packed.width, 32)
  assert.equal(packed.height, 12)
  assert.equal(packed.pixels, 384)
})

test('atlas packing fails closed for duplicate, invalid, or over-budget sprites', () => {
  assert.equal(packCanvasVisualAtlas([]), null)
  assert.equal(packCanvasVisualAtlas([{ signature: 'a', width: 0, height: 10 }]), null)
  assert.equal(packCanvasVisualAtlas([
    { signature: 'a', width: 10, height: 10 },
    { signature: 'a', width: 10, height: 10 }
  ]), null)
  assert.equal(packCanvasVisualAtlas([
    { signature: 'a', width: 65, height: 65 }
  ], { maxWidth: 64, maxHeight: 64, maxPixels: 4096 }), null)
  assert.equal(packCanvasVisualAtlas([
    { signature: 'a', width: 40, height: 40 },
    { signature: 'b', width: 40, height: 40 }
  ], { maxWidth: 64, maxHeight: 64, maxPixels: 4096 }), null)
  assert.equal(packCanvasVisualAtlas([
    { signature: 'a', width: 1, height: 1 },
    { signature: 'b', width: 1, height: 1 }
  ], { maxEntries: 1 }), null)
})

test('atlas instance mapping preserves complete layer order and duplicate instances', () => {
  const atlas = packCanvasVisualAtlas([
    { signature: 'fan', width: 20, height: 20 },
    { signature: 'pipe', width: 30, height: 10 }
  ], { maxWidth: 64, maxHeight: 64, maxPixels: 4096 })
  const instances = [
    { id: 'layer-1', signature: 'fan' },
    { id: 'layer-2', signature: 'pipe' },
    { id: 'layer-3', signature: 'fan' }
  ]
  const mapped = mapCanvasVisualAtlasInstances(instances, atlas.slots)
  assert.deepEqual(mapped.map(instance => instance.id), ['layer-1', 'layer-2', 'layer-3'])
  assert.equal(mapped[0].atlasRect, mapped[2].atlasRect)
  assert.equal(mapCanvasVisualAtlasInstances([{ signature: 'missing' }], atlas.slots), null)
})

test('Canvas2D atlas blits preserve every instance and its original layer order', () => {
  const calls = []
  const context = { drawImage: (...args) => calls.push(args) }
  const atlas = { id: 'atlas' }
  const instances = [
    { id: 'layer-1', atlasRect: { x: 1, y: 2, w: 3, h: 4 }, bitmapRect: { x: 5, y: 6, w: 3, h: 4 } },
    { id: 'layer-2', atlasRect: { x: 8, y: 9, w: 10, h: 11 }, bitmapRect: { x: 12, y: 13, w: 10, h: 11 } },
    { id: 'layer-3', atlasRect: { x: 1, y: 2, w: 3, h: 4 }, bitmapRect: { x: 15, y: 16, w: 3, h: 4 } }
  ]
  const blitData = canvasVisualAtlasBlitData(instances)
  assert.ok(blitData instanceof Float32Array)
  const first = drawCanvasVisualAtlasBlits(context, atlas, blitData, {
    offsetX: 20,
    offsetY: 30,
    yieldEvery: 1,
    shouldYield: () => calls.length === 2
  })
  assert.deepEqual(first, { cursor: 2, done: false, drawn: 2 })
  const second = drawCanvasVisualAtlasBlits(context, atlas, blitData, {
    cursor: first.cursor,
    offsetX: 20,
    offsetY: 30
  })
  assert.deepEqual(second, { cursor: 3, done: true, drawn: 1 })
  assert.deepEqual(calls, [
    [atlas, 1, 2, 3, 4, 25, 36, 3, 4],
    [atlas, 8, 9, 10, 11, 32, 43, 10, 11],
    [atlas, 1, 2, 3, 4, 35, 46, 3, 4]
  ])
})

test('Canvas2D atlas blits fail closed for invalid rectangles', () => {
  assert.equal(canvasVisualAtlasBlitData(
    [{ atlasRect: { x: 0, y: 0, w: 0, h: 1 }, bitmapRect: { x: 0, y: 0, w: 1, h: 1 } }]
  ), null)
  assert.throws(() => drawCanvasVisualAtlasBlits({ drawImage() {} }, {}, null), /valid blit data/)
})

test('Canvas2D atlas blits yield every 64 instances and resume without gaps or duplicates', () => {
  const destinations = []
  const context = { drawImage: (...args) => destinations.push(args[5]) }
  const instances = Array.from({ length: 130 }, (_, index) => ({
    atlasRect: { x: 0, y: 0, w: 1, h: 1 },
    bitmapRect: { x: index, y: 0, w: 1, h: 1 }
  }))
  const blitData = canvasVisualAtlasBlitData(instances)
  let checks = 0
  const first = drawCanvasVisualAtlasBlits(context, {}, blitData, {
    shouldYield: () => {
      checks += 1
      return true
    }
  })
  assert.deepEqual(first, { cursor: 64, done: false, drawn: 64 })
  assert.equal(checks, 1)

  checks = 0
  const second = drawCanvasVisualAtlasBlits(context, {}, blitData, {
    cursor: first.cursor,
    shouldYield: () => {
      checks += 1
      return false
    }
  })
  assert.deepEqual(second, { cursor: 130, done: true, drawn: 66 })
  assert.equal(checks, 1)
  assert.deepEqual(destinations, Array.from({ length: 130 }, (_, index) => index))
})
