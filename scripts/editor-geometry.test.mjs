import assert from 'node:assert/strict'
import test from 'node:test'
import {
  constrainNodeCollectionTranslation,
  constrainTranslation,
  nodeMinimumSize,
  normalizeNodeCollectionGeometry,
  normalizeNodeGeometry,
  normalizedVisualScale,
  resizeFrameWithinBounds,
  resizeRotatedFrameWithinBounds,
  rotatedFrameBounds,
  rotatedLocalScaleFactors,
  transformNodeCollectionWithinStage
} from '../src/utils/editorGeometry.js'
import { migrateLegacyLineShapeNode, PROJECT_VERSION } from '../src/utils/projectMigration.js'

function localPoint(frame, localX, localY) {
  const radians = (Number(frame.rotate) || 0) * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const centerX = frame.x + frame.w / 2
  const centerY = frame.y + frame.h / 2
  return {
    x: centerX + localX * cos - localY * sin,
    y: centerY + localX * sin + localY * cos
  }
}

function assertPointClose(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `expected x ${expected.x}, received ${actual.x}`)
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `expected y ${expected.y}, received ${actual.y}`)
}

function collectionBounds(items) {
  const frames = items.map(item => rotatedFrameBounds(item))
  const x = Math.min(...frames.map(frame => frame.x))
  const y = Math.min(...frames.map(frame => frame.y))
  const right = Math.max(...frames.map(frame => frame.x + frame.w))
  const bottom = Math.max(...frames.map(frame => frame.y + frame.h))
  return { x, y, w: right - x, h: bottom - y }
}

function assertFrameAccessible(frame, stageWidth, stageHeight, epsilon = 1e-7) {
  const bounds = rotatedFrameBounds(frame)
  const accessibleWidth = Math.min(24, bounds.w / 2, stageWidth / 2)
  const accessibleHeight = Math.min(24, bounds.h / 2, stageHeight / 2)
  assert.ok(bounds.x + bounds.w >= accessibleWidth - epsilon, `expected right edge ${bounds.x + bounds.w} to remain accessible`)
  assert.ok(bounds.x <= stageWidth - accessibleWidth + epsilon, `expected left edge ${bounds.x} to remain accessible`)
  assert.ok(bounds.y + bounds.h >= accessibleHeight - epsilon, `expected bottom edge ${bounds.y + bounds.h} to remain accessible`)
  assert.ok(bounds.y <= stageHeight - accessibleHeight + epsilon, `expected top edge ${bounds.y} to remain accessible`)
}

test('normalizes imported string and invalid node geometry', () => {
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'rect', x: '100', y: '25', w: '140', h: '72', rotate: '-15' }, 600, 400),
    { x: 100, y: 25, w: 140, h: 72, rotate: 345 }
  )
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'rect', x: 'bad', y: Infinity, w: -1, h: 0 }, 320, 240),
    { x: 0, y: 0, w: 1, h: 1, rotate: 0 }
  )
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'pencil', x: 12, y: 18, w: 1, h: 2 }, 320, 240),
    { x: 12, y: 18, w: 1, h: 2, rotate: 0 }
  )
})

test('uses one-pixel component minimums and a subpixel line thickness', () => {
  assert.deepEqual(nodeMinimumSize({ type: 'rect' }), { w: 1, h: 1 })
  assert.deepEqual(nodeMinimumSize({ type: 'pencil' }), { w: 1, h: 1 })
  assert.deepEqual(nodeMinimumSize({ type: 'lineShape' }), { w: 1, h: .1 })
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'lineShape', x: 10, y: 20, w: 0, h: 0 }, 600, 400),
    { x: 10, y: 20, w: 1, h: .1, rotate: 0 }
  )
})

test('defaults invalid visual scales and bounds valid extreme values', () => {
  assert.equal(normalizedVisualScale(undefined, 100), 1)
  assert.equal(normalizedVisualScale(Number.NaN, 100), 1)
  assert.equal(normalizedVisualScale(Infinity, 100), 1)
  assert.equal(normalizedVisualScale(0, 100), 1)
  assert.equal(normalizedVisualScale(-3, 100), 1)
  assert.equal(normalizedVisualScale(.000001, 100), .005)
  assert.equal(normalizedVisualScale(2, 100), 2)
})

test('normalizes line height down to a visible subpixel thickness', () => {
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'lineShape', x: 10, y: 20, w: 150, h: '0.1' }, 600, 400),
    { x: 10, y: 20, w: 150, h: .1, rotate: 0 }
  )
})

test('migrates legacy line border width into real height without moving its center', () => {
  const migrated = migrateLegacyLineShapeNode({
    type: 'lineShape', x: 30, y: 40, w: 150, h: 12, borderWidth: 3, borderVisible: true
  }, 19)

  assert.equal(migrated.h, 3)
  assert.equal(migrated.y, 44.5)
  assert.equal(migrated.y + migrated.h / 2, 46)
  assert.equal(migrated.fill, '#485563')
  assert.equal(migrated.borderVisible, true)
  assert.equal(migrated.backgroundOpacity, 1)
})

test('does not migrate current line geometry and preserves hidden zero-width legacy lines', () => {
  const current = { type: 'lineShape', y: 12, h: 9, borderWidth: 2 }
  assert.equal(migrateLegacyLineShapeNode(current, PROJECT_VERSION), current)

  const hidden = migrateLegacyLineShapeNode({ type: 'lineShape', y: 20, h: 12, borderWidth: 0 }, 19)
  assert.equal(hidden.h, 2)
  assert.equal(hidden.y + hidden.h / 2, 26)
  assert.equal(hidden.borderVisible, false)
  assert.equal(hidden.backgroundOpacity, 0)
})

test('moves a group beyond every stage edge while keeping an accessible strip', () => {
  const items = [
    { x: 20, y: 30, w: 100, h: 60 },
    { x: 180, y: 120, w: 80, h: 50 }
  ]
  assert.deepEqual(constrainTranslation(items, -200, 500, 400, 300), { dx: -200, dy: 246 })
  assert.deepEqual(constrainTranslation(items, 500, -200, 400, 300), { dx: 356, dy: -146 })
})

test('keeps an oversized group intersecting the stage', () => {
  assert.deepEqual(
    constrainTranslation([{ x: 0, y: 0, w: 500, h: 60 }], -900, 0, 320, 240),
    { dx: -476, dy: 0 }
  )
})

test('moves components that exactly fill an axis while keeping an accessible strip', () => {
  const fullWidth = [{ x: 0, y: 30, w: 320, h: 60 }]
  assert.deepEqual(constrainTranslation(fullWidth, -80, 0, 320, 240), { dx: -80, dy: 0 })
  assert.deepEqual(constrainTranslation(fullWidth, 75, 0, 320, 240), { dx: 75, dy: 0 })
  assert.deepEqual(constrainTranslation(fullWidth, -900, 0, 320, 240), { dx: -296, dy: 0 })
  assert.deepEqual(constrainTranslation(fullWidth, 900, 0, 320, 240), { dx: 296, dy: 0 })

  const fullHeight = [{ x: 40, y: 0, w: 60, h: 240 }]
  assert.deepEqual(constrainTranslation(fullHeight, 0, -50, 320, 240), { dx: 0, dy: -50 })
  assert.deepEqual(constrainTranslation(fullHeight, 0, 60, 320, 240), { dx: 0, dy: 60 })
})

test('moves an ordinary component beyond all four stage edges', () => {
  const frame = { x: 100, y: 80, w: 100, h: 60 }

  assert.deepEqual(constrainTranslation([frame], -1000, 0, 320, 240), { dx: -176, dy: 0 })
  assert.deepEqual(constrainTranslation([frame], 1000, 0, 320, 240), { dx: 196, dy: 0 })
  assert.deepEqual(constrainTranslation([frame], 0, -1000, 320, 240), { dx: 0, dy: -116 })
  assert.deepEqual(constrainTranslation([frame], 0, 1000, 320, 240), { dx: 0, dy: 136 })
})

test('keeps half of a subpixel line thickness accessible above and below the stage', () => {
  const line = { type: 'lineShape', x: 60, y: 100, w: 150, h: .1 }
  const above = constrainTranslation([line], 0, -1000, 320, 240)
  const below = constrainTranslation([line], 0, 1000, 320, 240)

  assert.ok(Math.abs(above.dy + 100.05) <= 1e-8)
  assert.ok(Math.abs(below.dy - 139.95) <= 1e-8)
  const lineAbove = { ...line, y: line.y + above.dy }
  const lineBelow = { ...line, y: line.y + below.dy }
  assert.ok(rotatedFrameBounds(lineAbove).y < 0)
  assert.ok(rotatedFrameBounds(lineBelow).y + rotatedFrameBounds(lineBelow).h > 240)
  assertFrameAccessible(lineAbove, 320, 240)
  assertFrameAccessible(lineBelow, 320, 240)
})

test('uses rotated visual bounds when moving an ordinary component off-stage', () => {
  const frame = { type: 'rect', x: 100, y: 70, w: 120, h: 60, rotate: 35 }
  for (const [dx, dy] of [[-1000, 0], [1000, 0], [0, -1000], [0, 1000]]) {
    const delta = constrainTranslation([frame], dx, dy, 320, 240)
    const moved = { ...frame, x: frame.x + delta.dx, y: frame.y + delta.dy }
    const bounds = rotatedFrameBounds(moved)
    if (dx < 0) assert.ok(bounds.x < 0)
    if (dx > 0) assert.ok(bounds.x + bounds.w > 320)
    if (dy < 0) assert.ok(bounds.y < 0)
    if (dy > 0) assert.ok(bounds.y + bounds.h > 240)
    assertFrameAccessible(moved, 320, 240)
  }
})

test('normalization preserves accessible overflow on every component size', () => {
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'lineShape', x: -120, y: 30, w: 320, h: 8 }, 320, 240),
    { x: -120, y: 30, w: 320, h: 8, rotate: 0 }
  )
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'rect', x: -120, y: 30, w: 300, h: 80 }, 320, 240),
    { x: -120, y: 30, w: 300, h: 80, rotate: 0 }
  )
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'rect', x: -999, y: 30, w: 300, h: 80 }, 320, 240),
    { x: -276, y: 30, w: 300, h: 80, rotate: 0 }
  )
  assert.deepEqual(
    normalizeNodeGeometry({ type: 'rect', x: 999, y: 999, w: 320, h: 240 }, 320, 240),
    { x: 296, y: 216, w: 320, h: 240, rotate: 0 }
  )
})

test('collection normalization preserves the spacing of a full-width group', () => {
  const nodes = [
    { id: 'left', groupId: 'full-width-group', type: 'rect', x: -50, y: 20, w: 160, h: 60 },
    { id: 'right', groupId: 'full-width-group', type: 'rect', x: 110, y: 20, w: 160, h: 60 }
  ]
  const first = normalizeNodeCollectionGeometry(nodes, 320, 240)
  const reloaded = nodes.map((node, index) => ({ ...node, ...first[index] }))
  const second = normalizeNodeCollectionGeometry(reloaded, 320, 240)

  assert.deepEqual(first.map(node => node.x), [-50, 110])
  assert.deepEqual(second, first)
})

test('collection normalization is idempotent for a single moved full-width node', () => {
  const nodes = [{ id: 'line', type: 'lineShape', x: -120, y: 30, w: 320, h: 8 }]
  const first = normalizeNodeCollectionGeometry(nodes, 320, 240)
  const second = normalizeNodeCollectionGeometry([{ ...nodes[0], ...first[0] }], 320, 240)

  assert.deepEqual(first, [{ x: -120, y: 30, w: 320, h: 8, rotate: 0 }])
  assert.deepEqual(second, first)
})

test('collection normalization constrains ordinary ungrouped nodes to an accessible strip', () => {
  const normalized = normalizeNodeCollectionGeometry([
    { id: 'left', type: 'rect', x: -80, y: -40, w: 100, h: 60 },
    { id: 'right', type: 'rect', x: 300, y: 220, w: 80, h: 50 }
  ], 320, 240)

  assert.deepEqual(normalized, [
    { x: -76, y: -36, w: 100, h: 60, rotate: 0 },
    { x: 296, y: 216, w: 80, h: 50, rotate: 0 }
  ])
})

test('bundle normalization preserves spacing for an ungrouped multi-node operation', () => {
  const nodes = [
    { id: 'left', type: 'rect', x: -50, y: 20, w: 160, h: 60 },
    { id: 'right', type: 'rect', x: 110, y: 20, w: 160, h: 60 }
  ]

  const normalized = normalizeNodeCollectionGeometry(nodes, 320, 240, { bundleAll: true })
  assert.deepEqual(normalized.map(node => node.x), [-50, 110])
})

test('common translation keeps every ungrouped selected node accessible and reload-stable', () => {
  const nodes = [
    { id: 'left', type: 'rect', x: 0, y: 40, w: 100, h: 60 },
    { id: 'right', type: 'rect', x: 220, y: 40, w: 100, h: 60 }
  ]
  const translation = constrainNodeCollectionTranslation(nodes, 1000, 0, 320, 240)
  const moved = nodes.map(node => ({ ...node, x: node.x + translation.dx, y: node.y + translation.dy }))
  const reloaded = normalizeNodeCollectionGeometry(moved, 320, 240)

  assert.deepEqual(translation, { dx: 76, dy: 0, feasible: true })
  assert.deepEqual(moved.map(node => node.x), [76, 296])
  assert.deepEqual(reloaded.map(node => node.x), [76, 296])
})

test('formal groups use one persistent translation bundle', () => {
  const nodes = [
    { id: 'left', groupId: 'group-a', type: 'rect', x: 0, y: 40, w: 100, h: 60 },
    { id: 'right', groupId: 'group-a', type: 'rect', x: 220, y: 40, w: 100, h: 60 }
  ]

  assert.deepEqual(
    constrainNodeCollectionTranslation(nodes, 1000, 0, 320, 240),
    { dx: 296, dy: 0, feasible: true }
  )
})

test('a sparse formal group keeps a real anchor member accessible instead of only its empty AABB', () => {
  const nodes = [
    { id: 'anchor', groupId: 'sparse-group', type: 'rect', x: 40, y: -106, w: 100, h: 100 },
    { id: 'remote', groupId: 'sparse-group', type: 'rect', x: 40, y: 266, w: 100, h: 80 }
  ]
  const translation = constrainNodeCollectionTranslation(nodes, 0, 0, 320, 240)
  const normalized = normalizeNodeCollectionGeometry(nodes, 320, 240)
  const reloaded = normalizeNodeCollectionGeometry(nodes.map((node, index) => ({ ...node, ...normalized[index] })), 320, 240)

  assert.deepEqual(translation, { dx: 0, dy: 30, feasible: true })
  assert.deepEqual(normalized.map(node => node.y), [-76, 296])
  assert.deepEqual(reloaded, normalized)
  assertFrameAccessible({ ...nodes[0], ...normalized[0] }, 320, 240)
})

test('common normalization preserves ungrouped bundle spacing whenever one shared shift exists', () => {
  const nodes = [
    { id: 'left', type: 'rect', x: -100, y: 40, w: 100, h: 60 },
    { id: 'right', type: 'rect', x: 100, y: 40, w: 100, h: 60 }
  ]

  const normalized = normalizeNodeCollectionGeometry(nodes, 320, 240, { commonTranslation: true })
  assert.deepEqual(normalized.map(node => node.x), [-76, 124])
})

test('reports when rotated persistent bundles have no shared corrective translation', () => {
  const candidates = [
    { id: 'left', type: 'rect', x: -200, y: 40, w: 100, h: 60, rotate: 0 },
    { id: 'right', type: 'rect', x: 420, y: 40, w: 100, h: 60, rotate: 0 }
  ]

  assert.deepEqual(
    constrainNodeCollectionTranslation(candidates, 0, 0, 320, 240),
    { dx: 0, dy: 0, feasible: false }
  )
})

test('single-node rotation receives the minimum corrective translation at an edge', () => {
  const candidate = { type: 'rect', x: -76, y: 100, w: 100, h: 30, rotate: 90 }
  const translation = constrainTranslation([candidate], 0, 0, 320, 240)
  const corrected = { ...candidate, x: candidate.x + translation.dx, y: candidate.y + translation.dy }

  assert.ok(Math.abs(translation.dx - 26) <= 1e-8)
  assert.equal(translation.dy, 0)
  assertFrameAccessible(corrected, 320, 240)
})

test('single-node rotation remains finite and returns to its operation baseline', () => {
  const baseline = { type: 'rect', x: -76, y: 100, w: 100, h: 30, rotate: 0 }
  const rotatedCandidate = { ...baseline, rotate: 90 }
  const rotatedShift = constrainTranslation([rotatedCandidate], 0, 0, 320, 240)
  const rotated = { ...rotatedCandidate, x: baseline.x + rotatedShift.dx, y: baseline.y + rotatedShift.dy }
  const returnedShift = constrainTranslation([baseline], 0, 0, 320, 240)
  const returned = { ...baseline, x: baseline.x + returnedShift.dx, y: baseline.y + returnedShift.dy }

  assert.ok([rotated.x, rotated.y, returned.x, returned.y].every(Number.isFinite))
  assert.notDeepEqual(rotated, baseline)
  assert.deepEqual(returned, baseline)
})

test('limits ungrouped collection scaling to a reload-stable shared range', () => {
  const nodes = [
    { id: 'left', type: 'rect', x: 0, y: 40, w: 100, h: 60 },
    { id: 'right', type: 'rect', x: 220, y: 40, w: 100, h: 60 }
  ]
  const transformed = transformNodeCollectionWithinStage(
    nodes,
    { x: 0, y: 40, w: 320, h: 60 },
    { x: 0, y: 40, w: 1000, h: 60 },
    320,
    240
  )
  const reloaded = normalizeNodeCollectionGeometry(transformed.items, 320, 240)

  assert.equal(transformed.feasible, true)
  assert.equal(transformed.limited, true)
  assert.ok(transformed.bounds.w > 320 && transformed.bounds.w < 1000)
  transformed.items.forEach((item, index) => {
    assert.ok(Math.abs(reloaded[index].x - item.x) <= 1e-8)
    assert.ok(Math.abs(reloaded[index].y - item.y) <= 1e-8)
    assert.equal(reloaded[index].w, item.w)
    assert.equal(reloaded[index].h, item.h)
  })
})

test('allows a formal group to retain the full requested collection scale', () => {
  const nodes = [
    { id: 'left', groupId: 'group-a', type: 'rect', x: 0, y: 40, w: 100, h: 60 },
    { id: 'right', groupId: 'group-a', type: 'rect', x: 220, y: 40, w: 100, h: 60 }
  ]
  const transformed = transformNodeCollectionWithinStage(
    nodes,
    { x: 0, y: 40, w: 320, h: 60 },
    { x: 0, y: 40, w: 1000, h: 60 },
    320,
    240
  )

  assert.equal(transformed.feasible, true)
  assert.equal(transformed.limited, false)
  assert.equal(transformed.bounds.w, 1000)
})

test('collection transform at the operation baseline restores the exact initial geometry', () => {
  const nodes = [
    { id: 'left', type: 'rect', x: 20, y: 40, w: 100, h: 60, rotate: 15 },
    { id: 'right', type: 'rect', x: 180, y: 40, w: 80, h: 60, rotate: 345 }
  ]
  const bounds = { x: 20, y: 40, w: 240, h: 60 }
  const restored = transformNodeCollectionWithinStage(nodes, bounds, bounds, 320, 240)

  assert.equal(restored.feasible, true)
  assert.equal(restored.limited, false)
  assert.deepEqual(restored.items, nodes)
})

test('collection transform accumulates visual scales with each geometry axis', () => {
  const nodes = [
    { id: 'left', type: 'text', x: 20, y: 30, w: 100, h: 50, visualScaleX: 1, visualScaleY: 1 },
    { id: 'right', type: 'rect', x: 180, y: 80, w: 80, h: 40, visualScaleX: .5, visualScaleY: .75 }
  ]
  const bounds = { x: 20, y: 30, w: 240, h: 90 }
  const shrunk = transformNodeCollectionWithinStage(
    nodes,
    bounds,
    { x: 20, y: 30, w: 120, h: 45 },
    1000,
    1000
  )

  assert.equal(shrunk.feasible, true)
  assert.deepEqual(shrunk.items.map(item => [item.w, item.h, item.visualScaleX, item.visualScaleY]), [
    [50, 25, .5, .5],
    [40, 20, .25, .375]
  ])

  const restored = transformNodeCollectionWithinStage(
    shrunk.items,
    shrunk.bounds,
    bounds,
    1000,
    1000
  )
  restored.items.forEach((item, index) => {
    assert.ok(Math.abs(item.w - nodes[index].w) <= 1e-8)
    assert.ok(Math.abs(item.h - nodes[index].h) <= 1e-8)
    assert.ok(Math.abs(item.visualScaleX - nodes[index].visualScaleX) <= 1e-8)
    assert.ok(Math.abs(item.visualScaleY - nodes[index].visualScaleY) <= 1e-8)
  })
})

test('collection stretch accumulates each visual scale independently and preserves rotation', () => {
  const nodes = [
    { id: 'label', type: 'text', x: 20, y: 30, w: 100, h: 50, rotate: 15, visualScaleX: 1, visualScaleY: 1 },
    { id: 'shape', type: 'rect', x: 180, y: 80, w: 80, h: 40, rotate: 345, visualScaleX: .5, visualScaleY: .75 }
  ]
  assert.deepEqual(rotatedLocalScaleFactors(0, 1.5, .5), { x: 1.5, y: .5 })
  const verticalScale = rotatedLocalScaleFactors(90, 1.5, .5)
  assert.ok(Math.abs(verticalScale.x - .5) <= 1e-8)
  assert.ok(Math.abs(verticalScale.y - 1.5) <= 1e-8)
  const uniformScale = rotatedLocalScaleFactors(37, 2, 2)
  assert.ok(Math.abs(uniformScale.x - 2) <= 1e-8)
  assert.ok(Math.abs(uniformScale.y - 2) <= 1e-8)
  const bounds = collectionBounds(nodes)
  const target = { ...bounds, w: bounds.w * 1.5, h: bounds.h * .5 }
  const stretched = transformNodeCollectionWithinStage(
    nodes,
    bounds,
    target,
    1000,
    1000
  )

  assert.equal(stretched.feasible, true)
  assertPointClose(stretched.bounds, target)
  assert.ok(Math.abs(stretched.bounds.w - target.w) <= 1e-8)
  assert.ok(Math.abs(stretched.bounds.h - target.h) <= 1e-8)
  stretched.items.forEach((item, index) => {
    const source = nodes[index]
    assert.equal(item.rotate, source.rotate)
    assert.ok(Math.abs(item.visualScaleX - source.visualScaleX * item.w / source.w) <= 1e-8)
    assert.ok(Math.abs(item.visualScaleY - source.visualScaleY * item.h / source.h) <= 1e-8)
  })

  const restored = transformNodeCollectionWithinStage(stretched.items, stretched.bounds, bounds, 1000, 1000)
  restored.items.forEach((item, index) => {
    for (const field of ['x', 'y', 'w', 'h', 'rotate', 'visualScaleX', 'visualScaleY']) {
      assert.ok(Math.abs(item[field] - nodes[index][field]) <= 1e-6, `${item.id}.${field} did not round-trip`)
    }
  })
})

test('perpendicular line members stay joined through stretch and inverse shrink', () => {
  const nodes = [
    { id: 'horizontal', groupId: 'cross', type: 'lineShape', x: 0, y: 99, w: 200, h: 2, rotate: 0, visualScaleX: 1, visualScaleY: 1 },
    { id: 'vertical', groupId: 'cross', type: 'lineShape', x: 50, y: 99, w: 200, h: 2, rotate: 90, visualScaleX: 1, visualScaleY: 1 }
  ]
  const bounds = collectionBounds(nodes)
  const stretched = transformNodeCollectionWithinStage(
    nodes,
    bounds,
    { ...bounds, w: 400, h: 100 },
    1000,
    1000
  )

  assert.equal(stretched.feasible, true)
  assert.deepEqual(stretched.items, [
    { ...nodes[0], x: 0, y: 49.5, w: 400, h: 1, visualScaleX: 2, visualScaleY: .5 },
    { ...nodes[1], x: 250, y: 48, w: 100, h: 4, visualScaleX: .5, visualScaleY: 2 }
  ])
  const stretchedBounds = collectionBounds(stretched.items)
  assertPointClose(stretchedBounds, { x: 0, y: 0 })
  assert.ok(Math.abs(stretchedBounds.w - 400) <= 1e-8)
  assert.ok(Math.abs(stretchedBounds.h - 100) <= 1e-8)
  const horizontalBounds = rotatedFrameBounds(stretched.items[0])
  const verticalBounds = rotatedFrameBounds(stretched.items[1])
  assert.ok(horizontalBounds.x <= verticalBounds.x + verticalBounds.w && horizontalBounds.x + horizontalBounds.w >= verticalBounds.x)
  assert.ok(horizontalBounds.y <= verticalBounds.y + verticalBounds.h && horizontalBounds.y + horizontalBounds.h >= verticalBounds.y)

  const restored = transformNodeCollectionWithinStage(stretched.items, stretchedBounds, bounds, 1000, 1000)
  restored.items.forEach((item, index) => {
    for (const field of ['x', 'y', 'w', 'h', 'rotate', 'visualScaleX', 'visualScaleY']) {
      assert.ok(Math.abs(item[field] - nodes[index][field]) <= 1e-8, `${item.id}.${field} did not round-trip`)
    }
  })
  assert.deepEqual(collectionBounds(restored.items), bounds)
})

test('separate edge stretches keep perpendicular members joined and reversible', () => {
  const original = [
    { id: 'horizontal', groupId: 'cross', type: 'lineShape', x: 0, y: 99, w: 200, h: 2, rotate: 0, visualScaleX: 1, visualScaleY: 1 },
    { id: 'vertical', groupId: 'cross', type: 'lineShape', x: 50, y: 99, w: 200, h: 2, rotate: 90, visualScaleX: 1, visualScaleY: 1 }
  ]
  const originalBounds = collectionBounds(original)
  let items = original
  let bounds = originalBounds
  const targetSizes = [[400, 200], [400, 100], [400, 200], [200, 200]]

  for (const [width, height] of targetSizes) {
    const transformed = transformNodeCollectionWithinStage(items, bounds, { ...bounds, w: width, h: height }, 1000, 1000)
    assert.equal(transformed.feasible, true)
    items = transformed.items
    bounds = collectionBounds(items)
    assert.ok(Math.abs(bounds.w - width) <= 1e-8)
    assert.ok(Math.abs(bounds.h - height) <= 1e-8)
    const horizontalBounds = rotatedFrameBounds(items[0])
    const verticalBounds = rotatedFrameBounds(items[1])
    assert.ok(horizontalBounds.x <= verticalBounds.x + verticalBounds.w && horizontalBounds.x + horizontalBounds.w >= verticalBounds.x)
    assert.ok(horizontalBounds.y <= verticalBounds.y + verticalBounds.h && horizontalBounds.y + horizontalBounds.h >= verticalBounds.y)
  }

  items.forEach((item, index) => {
    for (const field of ['x', 'y', 'w', 'h', 'rotate', 'visualScaleX', 'visualScaleY']) {
      assert.ok(Math.abs(item[field] - original[index][field]) <= 1e-8, `${item.id}.${field} did not round-trip`)
    }
  })
  assert.deepEqual(bounds, originalBounds)
})

test('corner collection resize preserves its aspect ratio and opposite anchor', () => {
  const source = { x: 40, y: 50, w: 200, h: 100 }
  const southEast = resizeFrameWithinBounds(source, 'se', -100, -50, 1000, 1000, {
    lockAspectRatio: true,
    minimumWidth: 20,
    minimumHeight: 10
  })
  assert.deepEqual(southEast, { x: 40, y: 50, w: 100, h: 50 })

  const northWest = resizeFrameWithinBounds(source, 'nw', 100, 50, 1000, 1000, {
    lockAspectRatio: true,
    minimumWidth: 20,
    minimumHeight: 10
  })
  assert.deepEqual(northWest, { x: 140, y: 100, w: 100, h: 50 })
  assert.equal(northWest.w / northWest.h, source.w / source.h)
  assert.equal(northWest.x + northWest.w, source.x + source.w)
  assert.equal(northWest.y + northWest.h, source.y + source.h)
})

test('corner collection resize projects an off-axis pointer onto the aspect ratio', () => {
  const source = { x: 40, y: 50, w: 100, h: 50 }
  const resized = resizeFrameWithinBounds(source, 'se', -80, 0, 1000, 1000, {
    lockAspectRatio: true,
    minimumWidth: 1,
    minimumHeight: 1
  })

  assert.ok(Math.abs(resized.w - 36) <= 1e-8)
  assert.ok(Math.abs(resized.h - 18) <= 1e-8)
  assert.equal(resized.x, source.x)
  assert.equal(resized.y, source.y)
})

test('corner collection resize uses the stricter axis minimum without distortion', () => {
  const source = { x: 40, y: 50, w: 100, h: 50 }
  const resized = resizeFrameWithinBounds(source, 'nw', 100, 50, 1000, 1000, {
    lockAspectRatio: true,
    minimumWidth: 30,
    minimumHeight: 20
  })

  assert.deepEqual(resized, { x: 100, y: 80, w: 40, h: 20 })
})

test('edge collection resize changes only its corresponding axis around the opposite edge', () => {
  const source = { x: 40, y: 50, w: 200, h: 100 }
  const east = resizeFrameWithinBounds(source, 'e', -100, 0, 1000, 1000, {
    lockAspectRatio: false,
    minimumWidth: 20,
    minimumHeight: 10
  })
  assert.deepEqual(east, { x: 40, y: 50, w: 100, h: 100 })

  const north = resizeFrameWithinBounds(source, 'n', 0, 50, 1000, 1000, {
    lockAspectRatio: false,
    minimumWidth: 20,
    minimumHeight: 10
  })
  assert.deepEqual(north, { x: 40, y: 100, w: 200, h: 50 })
  assert.equal(north.x, source.x)
  assert.equal(north.y + north.h, source.y + source.h)
})

test('collection resize honors an explicit subpixel minimum for line-only groups', () => {
  const source = { x: 40, y: 50, w: 200, h: 1 }
  const resized = resizeFrameWithinBounds(source, 's', 0, -.9, 1000, 1000, {
    minimumWidth: 1,
    minimumHeight: .1,
    minimumIsAuthoritative: true
  })

  assert.ok(Math.abs(resized.h - .1) <= 1e-8)
  assert.equal(resized.x, source.x)
  assert.equal(resized.y, source.y)
  assert.equal(resized.w, source.w)
})

test('collection resize and transform preserve an oversized operation baseline', () => {
  const bounds = { x: 0, y: 40, w: 38100, h: 60 }
  const maximumWidth = bounds.w
  assert.deepEqual(
    resizeFrameWithinBounds(bounds, 'e', 0, 0, 320, 240, { maximumWidth }),
    bounds
  )

  const nodes = [
    { id: 'anchor', groupId: 'wide', type: 'rect', x: 0, y: 40, w: 100, h: 60, rotate: 0 },
    { id: 'remote', groupId: 'wide', type: 'rect', x: 38000, y: 40, w: 100, h: 60, rotate: 0 }
  ]
  const transformed = transformNodeCollectionWithinStage(nodes, bounds, bounds, 320, 240, { maximumWidth })
  assert.equal(transformed.feasible, true)
  assert.deepEqual(transformed.items, nodes)
})

test('collection stretch caps rotated member geometry at the reload-stable node maximum', () => {
  const nodes = [
    { id: 'vertical', groupId: 'rotated', type: 'lineShape', x: 0, y: 0, w: 10000, h: 1, rotate: 90, visualScaleX: 1, visualScaleY: 1 }
  ]
  const bounds = collectionBounds(nodes)
  const transformed = transformNodeCollectionWithinStage(
    nodes,
    bounds,
    { ...bounds, w: 40000 },
    50000,
    50000,
    { maximumWidth: 40000, maximumHeight: 40000 }
  )
  const reloaded = normalizeNodeCollectionGeometry(transformed.items, 50000, 50000)

  assert.equal(transformed.limited, true)
  assert.ok(Math.abs(transformed.bounds.w - 20000) <= 1e-6)
  assert.ok(Math.abs(transformed.items[0].w - 10000) <= 1e-8)
  assert.ok(Math.abs(transformed.items[0].h - 20000) <= 1e-6)
  assert.ok(Math.abs(transformed.items[0].visualScaleX - 1) <= 1e-8)
  assert.ok(Math.abs(transformed.items[0].visualScaleY - 20000) <= 1e-6)
  transformed.items.forEach((item, index) => {
    assert.ok(item.w <= 20000)
    assert.ok(item.h <= 20000)
    for (const field of ['x', 'y', 'w', 'h', 'rotate']) {
      assert.ok(Math.abs(reloaded[index][field] - item[field]) <= 1e-6, `${item.id}.${field} changed after reload`)
    }
  })
})

test('resizing can cross stage edges while retaining an accessible region', () => {
  assert.deepEqual(
    resizeFrameWithinBounds({ x: 10, y: 10, w: 100, h: 80 }, 'nw', -100, -100, 320, 240),
    { x: -90, y: -90, w: 200, h: 180 }
  )
  assert.deepEqual(
    resizeFrameWithinBounds({ x: 250, y: 180, w: 60, h: 50 }, 'se', 500, 500, 320, 240),
    { x: 250, y: 180, w: 560, h: 550 }
  )
})

test('resize normalization does not pull an already off-stage component back', () => {
  const frame = { type: 'rect', x: -76, y: -36, w: 100, h: 60, rotate: 0 }
  assert.deepEqual(resizeFrameWithinBounds(frame, 'se', 0, 0, 320, 240), {
    x: frame.x, y: frame.y, w: frame.w, h: frame.h
  })

  const rotated = normalizeNodeGeometry({ type: 'rect', x: -500, y: -400, w: 120, h: 60, rotate: 35 }, 320, 240)
  const resized = resizeRotatedFrameWithinBounds(rotated, 'e', 0, 0, 320, 240)
  assert.deepEqual(resized, { x: rotated.x, y: rotated.y, w: rotated.w, h: rotated.h })
  assertFrameAccessible(rotated, 320, 240)
})

test('resize honors caller minimums without expanding a small drawing at pointer start', () => {
  const frame = { x: 40, y: 50, w: 8, h: 8 }
  assert.deepEqual(
    resizeFrameWithinBounds(frame, 'se', 0, 0, 320, 240, { minimumWidth: 8, minimumHeight: 8 }),
    frame
  )
})

test('rotated resize keeps zero-degree behavior unchanged', () => {
  const frame = { type: 'rect', x: 10, y: 10, w: 100, h: 80, rotate: 0 }
  assert.deepEqual(
    resizeRotatedFrameWithinBounds(frame, 'nw', -100, -100, 320, 240),
    resizeFrameWithinBounds(frame, 'nw', -100, -100, 320, 240)
  )
})

test('rotated east resize uses the node local axis and fixes the west edge', () => {
  const frame = { type: 'rect', x: 100, y: 100, w: 120, h: 60, rotate: 90 }
  const westBefore = localPoint(frame, -frame.w / 2, 0)
  const target = resizeRotatedFrameWithinBounds(frame, 'e', 0, 40, 1000, 1000)

  assert.deepEqual(target, { x: 80, y: 120, w: 160, h: 60 })
  assertPointClose(localPoint({ ...target, rotate: frame.rotate }, -target.w / 2, 0), westBefore)
  assert.deepEqual(resizeRotatedFrameWithinBounds(frame, 'e', 40, 0, 1000, 1000), { x: 100, y: 100, w: 120, h: 60 })
})

test('rotated west resize uses the node local axis and fixes the east edge', () => {
  const frame = { type: 'rect', x: 100, y: 100, w: 120, h: 60, rotate: 90 }
  const eastBefore = localPoint(frame, frame.w / 2, 0)
  const target = resizeRotatedFrameWithinBounds(frame, 'w', 0, -40, 1000, 1000)

  assert.deepEqual(target, { x: 80, y: 80, w: 160, h: 60 })
  assertPointClose(localPoint({ ...target, rotate: frame.rotate }, target.w / 2, 0), eastBefore)
  assert.deepEqual(resizeRotatedFrameWithinBounds(frame, 'w', -40, 0, 1000, 1000), { x: 100, y: 100, w: 120, h: 60 })
})

test('rotated corner resize fixes the opposite corner', () => {
  const frame = { type: 'rect', x: 300, y: 300, w: 120, h: 80, rotate: 45 }
  const radians = frame.rotate * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const worldDx = -30 * cos - (-20) * sin
  const worldDy = -30 * sin + (-20) * cos
  const southeastBefore = localPoint(frame, frame.w / 2, frame.h / 2)
  const target = resizeRotatedFrameWithinBounds(frame, 'nw', worldDx, worldDy, 1000, 1000)

  assert.ok(Math.abs(target.w - 150) < 1e-8)
  assert.ok(Math.abs(target.h - 100) < 1e-8)
  assertPointClose(localPoint({ ...target, rotate: frame.rotate }, target.w / 2, target.h / 2), southeastBefore)
})

test('rotated resize respects one-pixel minimum size and accessible stage bounds', () => {
  const frame = { type: 'rect', x: 4, y: 40, w: 80, h: 50, rotate: 30 }
  const target = resizeRotatedFrameWithinBounds(frame, 'w', -500, 0, 320, 240)
  assertFrameAccessible({ ...target, rotate: frame.rotate }, 320, 240)

  const minimum = resizeRotatedFrameWithinBounds(frame, 'e', -500, 0, 320, 240)
  assert.ok(minimum.w >= 1 - 1e-8)
  assert.ok(minimum.h >= 1 - 1e-8)
  assertFrameAccessible({ ...minimum, rotate: frame.rotate }, 320, 240)
})

test('a component can continue shrinking to one pixel in a second pointer operation', () => {
  const frame = { type: 'rect', x: 100, y: 80, w: 100, h: 80, rotate: 0 }
  const first = resizeFrameWithinBounds(frame, 'se', -70, -50, 1000, 1000)
  const second = resizeFrameWithinBounds({ ...first, type: frame.type }, 'se', -100, -100, 1000, 1000)

  assert.deepEqual(first, { x: 100, y: 80, w: 30, h: 30 })
  assert.deepEqual(second, { x: 100, y: 80, w: 1, h: 1 })
  assert.deepEqual(normalizeNodeGeometry({ ...second, type: frame.type }, 1000, 1000), { ...second, rotate: 0 })
})

test('a rotated component shrinks to one pixel while fixing the opposite corner', () => {
  const frame = { type: 'rect', x: 300, y: 260, w: 80, h: 60, rotate: 35 }
  const northwestBefore = localPoint(frame, -frame.w / 2, -frame.h / 2)
  const radians = frame.rotate * Math.PI / 180
  const localDx = -200
  const localDy = -200
  const worldDx = localDx * Math.cos(radians) - localDy * Math.sin(radians)
  const worldDy = localDx * Math.sin(radians) + localDy * Math.cos(radians)
  const target = resizeRotatedFrameWithinBounds(frame, 'se', worldDx, worldDy, 1000, 1000)

  assert.ok(Math.abs(target.w - 1) <= 1e-8)
  assert.ok(Math.abs(target.h - 1) <= 1e-8)
  assertPointClose(localPoint({ ...target, rotate: frame.rotate }, -target.w / 2, -target.h / 2), northwestBefore)
})

test('one-pixel component geometry survives JSON import normalization', () => {
  const saved = { type: 'rect', x: 42.5, y: 17.25, w: 1, h: 1, rotate: 27 }
  const imported = JSON.parse(JSON.stringify(saved))
  assert.deepEqual(normalizeNodeGeometry(imported, 320, 240), { x: 42.5, y: 17.25, w: 1, h: 1, rotate: 27 })
})

test('near-vertical components keep growing until their visible edge reaches the stage', () => {
  const frame = { type: 'rect', x: 100, y: 580, w: 400, h: 40, rotate: 88 }
  const radians = frame.rotate * Math.PI / 180
  const worldDelta = { x: 300 * Math.cos(radians), y: 300 * Math.sin(radians) }
  const westBefore = localPoint(frame, -frame.w / 2, 0)
  const target = resizeRotatedFrameWithinBounds(frame, 'e', worldDelta.x, worldDelta.y, 600, 1200)

  assert.ok(Math.abs(target.w - 700) < 1e-8)
  assertPointClose(localPoint({ ...target, rotate: frame.rotate }, -target.w / 2, 0), westBefore)
  const visualBounds = rotatedFrameBounds({ ...target, rotate: frame.rotate })
  assert.ok(visualBounds.x >= -1e-8 && visualBounds.x + visualBounds.w <= 600 + 1e-8)
  assert.ok(visualBounds.y >= -1e-8 && visualBounds.y + visualBounds.h <= 1200 + 1e-8)
})

test('a rotated component can continue resizing in a second pointer operation', () => {
  const frame = { type: 'rect', x: 0, y: 300, w: 200, h: 72, rotate: 90 }
  const first = resizeRotatedFrameWithinBounds(frame, 'e', 0, 300, 320, 1000)
  const second = resizeRotatedFrameWithinBounds({ ...first, type: frame.type, rotate: frame.rotate }, 'e', 0, 100, 320, 1000)

  assert.deepEqual(first, { x: -150, y: 450, w: 500, h: 72 })
  assert.deepEqual(second, { x: -200, y: 500, w: 600, h: 72 })
  assert.deepEqual(normalizeNodeGeometry({ ...second, type: frame.type, rotate: frame.rotate }, 320, 1000), { ...second, rotate: 90 })
})

test('moving a rotated node with negative logical coordinates does not jump during normalization', () => {
  const frame = { type: 'rect', x: -200, y: 500, w: 600, h: 72, rotate: 90 }
  const delta = constrainTranslation([frame], -500, -500, 320, 1000)
  const moved = { ...frame, x: frame.x + delta.dx, y: frame.y + delta.dy }

  assert.ok(Math.abs(delta.dx + 112) <= 1e-8)
  assert.equal(delta.dy, -500)
  assert.deepEqual(normalizeNodeGeometry(moved, 320, 1000), {
    x: moved.x, y: moved.y, w: moved.w, h: moved.h, rotate: 90
  })
  const visualBounds = rotatedFrameBounds(moved)
  assert.ok(Math.abs(visualBounds.x + 48) <= 1e-8)
  assert.ok(Math.abs(visualBounds.x + visualBounds.w - 24) <= 1e-8)
  assertFrameAccessible(moved, 320, 1000)
})

test('rotated geometry remains idempotent after JSON serialization and import normalization', () => {
  const savedNode = {
    id: 'rotated-node',
    type: 'rect',
    x: '-200',
    y: '500',
    w: '600',
    h: '72',
    rotate: '450'
  }
  const importedNode = JSON.parse(JSON.stringify(savedNode))
  const firstGeometry = normalizeNodeGeometry(importedNode, 320, 1000)
  const reloadedNode = JSON.parse(JSON.stringify({ ...importedNode, ...firstGeometry }))
  const secondGeometry = normalizeNodeGeometry(reloadedNode, 320, 1000)

  assert.deepEqual(firstGeometry, { x: -200, y: 500, w: 600, h: 72, rotate: 90 })
  assert.deepEqual(secondGeometry, firstGeometry)
})
