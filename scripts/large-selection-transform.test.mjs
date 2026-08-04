import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { computeLargeSelectionTransform } from '../src/utils/largeSelectionTransform.js'
import {
  createLargeSelectionTransformTask,
  runLargeSelectionTransformTaskSlice
} from '../src/utils/largeSelectionTransformTask.js'

function createItems(count = 192) {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    groupId: index % 11 === 0 ? `group-${Math.floor(index / 22)}` : '',
    type: index % 19 === 0 ? 'lineShape' : 'rect',
    x: 120 + (index % 24) * 128,
    y: 100 + Math.floor(index / 24) * 96,
    w: 52 + index % 7,
    h: 34 + index % 5,
    rotate: (index % 6) * 15,
    visualScaleX: 1,
    visualScaleY: 1
  }))
}

function runChunked(items, spec, operationsPerSlice = 31) {
  const task = createLargeSelectionTransformTask(items, spec)
  let slices = 0
  while (task.phase !== 'done') {
    let operations = 0
    runLargeSelectionTransformTaskSlice(task, {
      shouldYield() {
        operations += 1
        return operations >= operationsPerSlice
      }
    })
    slices += 1
    assert.ok(slices < 200_000, 'chunked transform did not settle')
  }
  return { result: task.result, slices }
}

function assertEquivalent(actual, expected, path = 'result') {
  if (typeof expected === 'number') {
    assert.ok(
      Math.abs(actual - expected) <= 1e-8,
      `${path}: expected ${expected}, received ${actual}`
    )
    return
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}.length`)
    expected.forEach((value, index) => assertEquivalent(actual[index], value, `${path}[${index}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`)
    for (const [key, value] of Object.entries(expected)) assertEquivalent(actual[key], value, `${path}.${key}`)
    return
  }
  assert.equal(actual, expected, path)
}

for (const [name, spec] of [
  ['move', { kind: 'move', dx: 37.5, dy: -22.25 }],
  ['resize', {
    kind: 'resize',
    sourceBounds: { x: 112, y: 84, w: 3_090, h: 785 },
    targetBounds: { x: 160, y: 120, w: 2_740, h: 910 },
    stageWidth: 4_000,
    stageHeight: 2_000,
    maximumWidth: 8_000,
    maximumHeight: 8_000
  }],
  ['rotate', {
    kind: 'rotate',
    cx: 1_650,
    cy: 500,
    degrees: 33,
    stageWidth: 4_000,
    stageHeight: 2_000
  }],
  ['boundary-limited rotate', {
    kind: 'rotate',
    cx: 120,
    cy: 110,
    degrees: 127,
    stageWidth: 600,
    stageHeight: 420
  }]
]) {
  test(`chunked ${name} matches the worker transform`, () => {
    const items = createItems()
    const expected = computeLargeSelectionTransform(items, spec)
    const { result, slices } = runChunked(items, spec)
    assert.ok(slices > 1, 'large transform should cross a scheduling boundary')
    assertEquivalent(result, expected)
  })
}

test('App never runs the full large-selection transform in a fallback animation frame', async () => {
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')
  const start = app.indexOf('function requestChunkedLargeSelectionTransform')
  const end = app.indexOf('function scheduleLargeSelectionCommit', start)
  const fallback = app.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.match(fallback, /runLargeSelectionTransformTaskSlice/)
  assert.match(fallback, /performance\.now\(\) - startedAt >= LARGE_SELECTION_COMMIT_BUDGET_MS/)
  assert.match(fallback, /if \(!worker\) \{\s*requestChunkedLargeSelectionTransform/)
  assert.match(fallback, /catch \{\s*largeSelectionWorkerCallbacks\.delete\(id\)\s*requestChunkedLargeSelectionTransform/)
  assert.doesNotMatch(fallback, /computeLargeSelectionTransform/)
  assert.match(css, /\.geometry-commit-shield\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*2147483647;/)
})
