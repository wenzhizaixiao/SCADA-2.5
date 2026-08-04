import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIncrementalTextLayout,
  finishIncrementalTextLayout,
  runIncrementalTextLayoutSlice
} from '../src/utils/incrementalTextLayout.js'
import {
  horizontalTextLayout,
  splitTextGraphemes,
  verticalTextColumns
} from '../src/utils/textLayout.js'

function widthOf(value) {
  return splitTextGraphemes(value).reduce((width, grapheme) => {
    if (grapheme === ' ') return width + 4
    if (/^[\x00-\x7f]$/u.test(grapheme)) return width + 6
    return width + 10
  }, 0)
}

function runToCompletion(value, layoutOptions, measureText = widthOf, sliceOptions = {}) {
  const state = createIncrementalTextLayout(value, layoutOptions)
  const slices = []
  while (!state.done) {
    const result = runIncrementalTextLayoutSlice(
      state,
      measureText,
      { shouldYield: () => false },
      sliceOptions
    )
    assert.ok(result.operations > 0)
    slices.push(result)
  }
  return { result: finishIncrementalTextLayout(state), slices, state }
}

test('incremental horizontal layout matches existing wrapping semantics', () => {
  const cases = [
    { text: '甲   乙\n\n丙  丁', width: 18 },
    { text: 'alpha beta supercalifragilistic', width: 42 },
    { text: '甲乙，丙丁（戊己）', width: 30 },
    { text: 'A👨‍👩‍👧‍👦 B e\u0301', width: 30 },
    { text: 'A\r\n\rB', width: 30 }
  ]

  for (const { text, width } of cases) {
    const expected = horizontalTextLayout(text, width, widthOf)
    const actual = runToCompletion(text, { orientation: 'horizontal', maxWidth: width }).result
    assert.deepEqual(actual.lines, expected.lines, text)
    assert.deepEqual(actual.widths, actual.lines.map(widthOf), text)
    assert.equal(actual.lines.join(''), text.replace(/\r\n?/g, '\n').replace(/\n/g, ''), text)
  }
})

test('incremental vertical layout preserves graphemes, spaces, and hard breaks', () => {
  const cases = [
    { text: '甲   乙', rows: 2 },
    { text: '甲\n\n乙', rows: 10 },
    { text: 'A👨‍👩‍👧‍👦 e\u0301\r\nB', rows: 2 }
  ]

  for (const { text, rows } of cases) {
    const actual = runToCompletion(text, { orientation: 'vertical', maxRows: rows }).result
    assert.deepEqual(actual.columns, verticalTextColumns(text, rows), text)
  }
})

test('incremental layout preserves combining marks outside the ASCII and Han fast path', () => {
  const text = '\u304b\u3099e\u0301\ud83d\udc69\u200d\ud83d\udcbb'
  const horizontal = runToCompletion(text, {
    orientation: 'horizontal',
    maxWidth: 10
  }).result
  const vertical = runToCompletion(text, {
    orientation: 'vertical',
    maxRows: 1
  }).result

  assert.deepEqual(horizontal.lines, horizontalTextLayout(text, 10, widthOf).lines)
  assert.deepEqual(vertical.columns, verticalTextColumns(text, 1))
  assert.deepEqual(vertical.columns, [['\u304b\u3099'], ['e\u0301'], ['\ud83d\udc69\u200d\ud83d\udcbb']])
})

test('incremental horizontal metrics measure complete shaped lines', () => {
  const calls = []
  const measure = value => {
    calls.push(value)
    if (value === 'AVATAR') return { width: 31 }
    return { width: splitTextGraphemes(value).length * 6 }
  }
  const { result } = runToCompletion(
    'AVATAR',
    { orientation: 'horizontal', maxWidth: 100 },
    measure
  )

  assert.deepEqual(result.lines, ['AVATAR'])
  assert.deepEqual(result.widths, [31])
  assert.ok(calls.includes('AVATAR'))
  assert.notEqual(result.widths[0], splitTextGraphemes('AVATAR').length * 6)
})

test('incremental wrapping keeps an oversized grapheme as a complete line', () => {
  const family = '👨‍👩‍👧‍👦'
  const text = `${family}甲`
  const measure = value => value === family ? 100 : widthOf(value)
  const { result } = runToCompletion(
    text,
    { orientation: 'horizontal', maxWidth: 10 },
    measure
  )

  assert.deepEqual(result.lines, [family, '甲'])
  assert.deepEqual(result.widths, [100, 10])
})

test('incremental layout yields long text to a fake deadline and resumes exactly', () => {
  const text = 'A'.repeat(50_000)
  const state = createIncrementalTextLayout(text, { orientation: 'horizontal', maxWidth: 60 })
  let sliceCount = 0
  let totalOperations = 0

  while (!state.done) {
    let checks = 0
    const result = runIncrementalTextLayoutSlice(
      state,
      value => value.length * 6,
      { shouldYield: () => ++checks >= 8 }
    )
    sliceCount += 1
    totalOperations += result.operations
    assert.ok(result.operations > 0 && result.operations <= 256)
  }

  const result = finishIncrementalTextLayout(state)
  assert.ok(sliceCount > 1)
  assert.ok(totalOperations > text.length)
  assert.equal(result.lines.length, 5_000)
  assert.ok(result.lines.every(line => line === 'AAAAAAAAAA'))
  assert.ok(result.widths.every(width => width === 60))
})

test('incremental layout enforces the per-slice hard operation limit', () => {
  const state = createIncrementalTextLayout('甲'.repeat(20_000), {
    orientation: 'vertical',
    maxRows: 20
  })
  const first = runIncrementalTextLayoutSlice(
    state,
    widthOf,
    { shouldYield: () => false }
  )

  assert.equal(first.done, false)
  assert.equal(first.operations, 8192)
  assert.throws(() => finishIncrementalTextLayout(state), /not complete/)

  while (!state.done) {
    runIncrementalTextLayoutSlice(state, widthOf, { shouldYield: () => false })
  }
  assert.deepEqual(finishIncrementalTextLayout(state).columns, verticalTextColumns('甲'.repeat(20_000), 20))
})
