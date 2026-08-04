import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  horizontalTextLayout,
  horizontalTextLines,
  splitTextGraphemes,
  textBlockStart,
  verticalTextColumns
} from '../src/utils/textLayout.js'
import {
  layoutConstrainedCanvasFontSize,
  readableCanvasFontSize
} from '../src/utils/canvasTextReadability.js'

const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const canvasTextStart = miniMapSource.indexOf('function canvasTextFont')
const canvasTextEnd = miniMapSource.indexOf('\nfunction drawRuntimeBadge', canvasTextStart)
const canvasTextSource = miniMapSource.slice(canvasTextStart, canvasTextEnd)

const widthOf = value => splitTextGraphemes(value).reduce((width, grapheme) => {
  if (grapheme === ' ') return width + 4
  if (/^[\x00-\x7f]$/u.test(grapheme)) return width + 6
  return width + 10
}, 0)

function createCanvasTextHarness(props = {}) {
  const factory = new Function(
    'props',
    'number',
    'horizontalTextLayout',
    'horizontalTextLines',
    'TEXT_LAYOUT_LINE_HEIGHT',
    'textBlockStart',
    'verticalTextColumns',
    'layoutConstrainedCanvasFontSize',
    'readableCanvasFontSize',
    `"use strict"; ${canvasTextSource}; return { baselineCanvasTextLayout, drawHorizontalText, drawText, drawVerticalText };`
  )
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
  return factory(
    { faithful: true, minimumScreenTextSize: 7, preferText: false, ...props },
    number,
    horizontalTextLayout,
    horizontalTextLines,
    1,
    textBlockStart,
    verticalTextColumns,
    layoutConstrainedCanvasFontSize,
    readableCanvasFontSize
  )
}

function createMockCanvasContext(options = {}) {
  const state = { depth: 0, fillCalls: [], measureCalls: [] }
  const ctx = {
    font: 'normal 400 14px sans-serif',
    save() { state.depth += 1 },
    restore() {
      state.depth -= 1
      assert.ok(state.depth >= 0, 'Canvas state stack underflow')
    },
    beginPath() {},
    rect() {},
    clip() {},
    measureText(value) {
      state.measureCalls.push(String(value))
      if (options.throwMeasureAt === state.measureCalls.length) throw new Error('measure failure')
      const fontSize = Number(/([\d.]+)px/u.exec(this.font)?.[1]) || 14
      return { width: splitTextGraphemes(value).reduce((total, grapheme) => total + fontSize * (grapheme === ' ' ? .25 : /^[\x00-\x7f]$/u.test(grapheme) ? .5 : 1), 0) }
    },
    fillText(value, x, y, maxWidth) {
      state.fillCalls.push({ text: String(value), x, y, maxWidth })
      if (options.throwFillAt === state.fillCalls.length) throw new Error('fill failure')
    }
  }
  return { ctx, state }
}

test('horizontal wrapping preserves repeated spaces and explicit blank lines', () => {
  const text = '甲   乙\n\n丙  丁'
  const lines = horizontalTextLines(text, 18, widthOf)

  assert.deepEqual(lines, ['甲  ', ' 乙', '', '丙  ', '丁'])
  assert.equal(lines.join(''), text.replace(/\n/g, ''))
})

test('horizontal wrapping keeps a fitting Latin word together and breaks oversized words', () => {
  assert.deepEqual(horizontalTextLines('alpha beta', 40, widthOf), ['alpha ', 'beta'])
  assert.deepEqual(horizontalTextLines('abcdef', 18, widthOf), ['abc', 'def'])
})

test('horizontal wrapping uses CJK opportunities without dropping punctuation', () => {
  const lines = horizontalTextLines('甲乙，丙丁', 20, widthOf)

  assert.deepEqual(lines, ['甲', '乙，', '丙丁'])
  assert.equal(lines.join(''), '甲乙，丙丁')
  assert.ok(lines.every(line => !line.startsWith('，')))
})

test('horizontal layout returns exact whole-line metrics after wrapping', () => {
  const layout = horizontalTextLayout('甲 A-501', 28, widthOf)

  assert.deepEqual(layout.lines, horizontalTextLines('甲 A-501', 28, widthOf))
  assert.deepEqual(layout.widths, layout.lines.map(widthOf))
  assert.ok(layout.widths.every(width => width <= 28))
})

test('text layout fast path preserves complex graphemes and measures repeated glyphs once', () => {
  assert.deepEqual(splitTextGraphemes('A甲e\u0301か\u3099👨‍👩‍👧‍👦'), ['A', '甲', 'e\u0301', 'か\u3099', '👨‍👩‍👧‍👦'])

  let measureCalls = 0
  const layout = horizontalTextLayout('A'.repeat(50_000), 60, () => {
    measureCalls += 1
    return 6
  })
  assert.equal(measureCalls, 2)
  assert.equal(layout.lines.length, 5_000)
  assert.ok(layout.lines.every(line => line === 'AAAAAAAAAA'))
})

test('vertical columns preserve spaces and hard breaks', () => {
  assert.deepEqual(verticalTextColumns('甲   乙', 2), [['甲', ' '], [' ', ' '], ['乙']])
  assert.deepEqual(verticalTextColumns('甲\n\n乙', 10), [['甲'], [], ['乙']])
})

test('text block placement shares start, center, and end alignment math', () => {
  assert.equal(textBlockStart(100, 40, 'left'), 0)
  assert.equal(textBlockStart(100, 40, 'center'), 30)
  assert.equal(textBlockStart(100, 40, 'right'), 60)
  assert.equal(textBlockStart(20, 40, 'center'), -10)
})

test('Canvas text nodes consume the shared horizontal and vertical layout helpers', () => {
  const horizontalRenderer = miniMapSource.match(/function drawHorizontalText\([\s\S]*?(?=\nfunction drawText)/)?.[0] || ''
  const textRenderer = miniMapSource.match(/function drawText\([\s\S]*?(?=\nfunction drawRuntimeBadge)/)?.[0] || ''

  assert.match(horizontalRenderer, /horizontalTextLines\(text, width, value => ctx\.measureText\(value\)\)/)
  assert.match(horizontalRenderer, /const firstLine[\s\S]*?const lastLine[\s\S]*?ctx\.fillText\(lines\[index\]/)
  assert.match(horizontalRenderer, /try \{[\s\S]*?finally \{\s*ctx\.restore\(\)/)
  assert.match(textRenderer, /node\.type === 'text' && node\.textLayout === 'vertical'[\s\S]*drawVerticalText/)
  assert.match(textRenderer, /node\.type === 'text'[\s\S]*drawHorizontalText/)
})

test('Canvas readability enlargement reuses the baseline text layout', () => {
  const baselineRenderer = miniMapSource.match(/function baselineCanvasTextLayout\([\s\S]*?(?=\nfunction drawVerticalText)/)?.[0] || ''
  const textRenderer = miniMapSource.match(/function drawText\([\s\S]*?(?=\nfunction drawRuntimeBadge)/)?.[0] || ''

  assert.match(baselineRenderer, /verticalTextColumns\(/)
  assert.match(baselineRenderer, /horizontalTextLayout\(/)
  assert.match(textRenderer, /layoutConstrainedCanvasFontSize\(/)
  assert.match(textRenderer, /baselineLayout\?\.columns/)
  assert.match(textRenderer, /baselineLayout\?\.lines/)
})

test('Canvas readability keeps horizontal and vertical baseline layout semantics', () => {
  const renderer = createCanvasTextHarness()
  const horizontal = createMockCanvasContext()
  renderer.drawText(horizontal.ctx, {
    type: 'text',
    text: 'A  B\n\nC',
    textLayout: 'horizontal',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 400,
    fontStyle: 'normal'
  }, 100, 40, .4, .4)
  assert.deepEqual(horizontal.state.fillCalls.map(call => call.text), ['A  B', '', 'C'])
  assert.equal(horizontal.state.depth, 0)

  const vertical = createMockCanvasContext()
  renderer.drawText(vertical.ctx, {
    type: 'text',
    text: '甲  \n乙',
    textLayout: 'vertical',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 400,
    fontStyle: 'normal'
  }, 40, 40, .4, .4)
  assert.deepEqual(vertical.state.fillCalls.map(call => call.text), ['甲', '乙'])
  assert.equal(vertical.state.depth, 0)
})

test('Canvas text drawing skips clipped work and restores state after failures', () => {
  const renderer = createCanvasTextHarness()
  const horizontal = createMockCanvasContext()
  renderer.drawHorizontalText(horizontal.ctx, '', 100, 20, 10, 'center', Array.from({ length: 5_000 }, (_, index) => `line-${index}`))
  assert.ok(horizontal.state.fillCalls.length <= 6)
  assert.equal(horizontal.state.depth, 0)

  const vertical = createMockCanvasContext()
  const columns = Array.from({ length: 5_000 }, () => Array.from({ length: 100 }, () => '甲'))
  renderer.drawVerticalText(vertical.ctx, '', 20, 20, 10, 'center', columns)
  assert.ok(vertical.state.fillCalls.length <= 36)
  assert.equal(vertical.state.depth, 0)

  for (const options of [{ throwMeasureAt: 1 }, { throwFillAt: 1 }]) {
    const failing = createMockCanvasContext(options)
    assert.throws(() => renderer.drawText(failing.ctx, {
      type: 'text',
      text: 'failure path',
      textLayout: 'horizontal',
      textAlign: 'center',
      fontSize: 14
    }, 120, 40, .3, .3), /failure/)
    assert.equal(failing.state.depth, 0)
  }
})

test('Canvas node wrapper restores its transform state when nested drawing throws', () => {
  const nodeRenderer = miniMapSource.match(/function drawNode\([\s\S]*?(?=\nfunction edgeRasterCommand)/)?.[0] || ''
  assert.match(nodeRenderer, /ctx\.save\(\)\s*try \{[\s\S]*?finally \{\s*ctx\.restore\(\)/)
})

test('editing DOM keeps the same preserved-space, line-height, and vertical-flow semantics', () => {
  assert.match(enhancementCss, /\.node-body\.text > \.node-text-content\s*\{[^}]*line-height:\s*1;[^}]*white-space:\s*break-spaces;/)
  assert.match(enhancementCss, /\.text-layout-vertical\s*\{[^}]*writing-mode:\s*vertical-rl;[^}]*text-orientation:\s*upright;/)
})
