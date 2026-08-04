const DEFAULT_DEADLINE_CHECK_INTERVAL = 32
const DEFAULT_SLICE_OPERATION_LIMIT = 8192

const simpleGraphemePattern = /^[\x00-\x7f\p{Script=Han}]$/u
const breakableSpacePattern = /^[\t\u0020\u3000]$/u
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const openingPunctuationPattern = /^[([{\u2018\u201c\u3008\u300a\u300c\u300e\u3010\u3014\u3016\ufe59\ufe5b\ufe5d\uff08\uff3b\uff5b]$/u
const closingPunctuationPattern = /^[)\]}!,.:;?\u2019\u201d\u3001\u3002\u3009\u300b\u300d\u300f\u3011\u3015\u3017\ufe50-\ufe58\ufe5a\ufe5c\ufe5e\uff01\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\uff3d\uff5d]$/u
const trailingBreakPattern = /^[-/\u2010-\u2014]$/u

let graphemeSegmenter = null
try {
  if (globalThis.Intl?.Segmenter) {
    graphemeSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
  }
} catch {}

function finiteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(finiteNumber(value, fallback))
  return parsed > 0 ? parsed : fallback
}

function isSoftWrapOpportunity(previous, next) {
  if (!previous || !next) return false
  if (breakableSpacePattern.test(previous) || trailingBreakPattern.test(previous)) return true
  if (!cjkPattern.test(previous) && !cjkPattern.test(next)) return false
  return !openingPunctuationPattern.test(previous) && !closingPunctuationPattern.test(next)
}

function sourceGraphemeIterator(text) {
  if (!graphemeSegmenter) return text[Symbol.iterator]()

  let index = 0
  let pendingSimple = null
  let segmented = null

  const nextCodePoint = () => {
    if (index >= text.length) return { done: true }
    const start = index
    const value = String.fromCodePoint(text.codePointAt(index))
    index += value.length
    return { done: false, start, value }
  }

  const startSegmentedRemainder = start => {
    const iterator = graphemeSegmenter.segment(text.slice(start))[Symbol.iterator]()
    segmented = {
      next() {
        const item = iterator.next()
        return item.done ? item : { done: false, value: item.value.segment }
      },
      return() {
        return typeof iterator.return === 'function' ? iterator.return() : { done: true }
      }
    }
    index = text.length
    pendingSimple = null
  }

  return {
    next() {
      if (segmented) return segmented.next()

      while (true) {
        if (!pendingSimple) {
          const item = nextCodePoint()
          if (item.done) return item
          if (!simpleGraphemePattern.test(item.value)) {
            startSegmentedRemainder(item.start)
            return segmented.next()
          }
          pendingSimple = item
        }

        const next = nextCodePoint()
        if (next.done) {
          const value = pendingSimple.value
          pendingSimple = null
          return { done: false, value }
        }
        if (!simpleGraphemePattern.test(next.value)) {
          startSegmentedRemainder(pendingSimple.start)
          return segmented.next()
        }

        const value = pendingSimple.value
        pendingSimple = next
        return { done: false, value }
      }
    },
    return() {
      index = text.length
      pendingSimple = null
      return segmented && typeof segmented.return === 'function'
        ? segmented.return()
        : { done: true }
    }
  }
}

function normalizedGraphemeIterator(text) {
  const source = sourceGraphemeIterator(text)
  let pending = null

  return {
    next() {
      const item = pending || source.next()
      pending = null
      if (item.done) return item
      if (item.value === '\r\n') return { done: false, value: '\n' }
      if (item.value !== '\r') return item

      const next = source.next()
      if (!next.done && next.value !== '\n') pending = next
      return { done: false, value: '\n' }
    },
    return() {
      pending = null
      return typeof source.return === 'function' ? source.return() : { done: true }
    }
  }
}

function measuredWidth(measureText, value) {
  const measured = measureText(value)
  const width = Number(typeof measured === 'number' ? measured : measured?.width)
  return Number.isFinite(width) && width > 0 ? width : 0
}

function resetHorizontalLine(state, graphemes = [], widths = [], currentWidth = 0) {
  state.currentGraphemes = graphemes
  state.currentWidths = widths
  state.currentWidth = currentWidth
  state.lastSoftWrap = -1
  state.lastSoftWrapWidth = 0
}

function appendHorizontalLine(state, end = state.currentGraphemes.length) {
  const lineWidth = end === state.currentGraphemes.length
    ? state.currentWidth
    : state.lastSoftWrapWidth
  state.lines.push(state.currentGraphemes.slice(0, end).join(''))
  resetHorizontalLine(
    state,
    state.currentGraphemes.slice(end),
    state.currentWidths.slice(end),
    Math.max(0, state.currentWidth - lineWidth)
  )
}

function appendHorizontalGrapheme(state, grapheme, width) {
  while (true) {
    const length = state.currentGraphemes.length
    if (length && isSoftWrapOpportunity(state.currentGraphemes[length - 1], grapheme)) {
      state.lastSoftWrap = length
      state.lastSoftWrapWidth = state.currentWidth
    }

    if (length && state.currentWidth + width > state.maxWidth) {
      const lineEnd = state.lastSoftWrap > 0 ? state.lastSoftWrap : length
      appendHorizontalLine(state, lineEnd)
      continue
    }

    state.currentGraphemes.push(grapheme)
    state.currentWidths.push(width)
    state.currentWidth += width
    return
  }
}

function runHorizontalLayoutOperation(state, measureText) {
  const item = state.iterator.next()
  if (item.done) {
    appendHorizontalLine(state)
    state.phase = 'metrics'
    state.iterator = null
    return
  }

  const grapheme = item.value
  if (grapheme === '\n') {
    appendHorizontalLine(state)
    return
  }

  let width = state.graphemeWidths.get(grapheme)
  if (width === undefined) {
    width = measuredWidth(measureText, grapheme)
    state.graphemeWidths.set(grapheme, width)
  }
  appendHorizontalGrapheme(state, grapheme, width)
}

function runHorizontalMetricOperation(state, measureText) {
  if (state.metricCursor >= state.lines.length) {
    state.phase = 'done'
    state.done = true
    return
  }

  const line = state.lines[state.metricCursor]
  let width = state.lineWidths.get(line)
  if (width === undefined) {
    width = measuredWidth(measureText, line)
    state.lineWidths.set(line, width)
  }
  state.widths[state.metricCursor] = width
  state.maximumLineWidth = Math.max(state.maximumLineWidth, width)
  state.metricCursor += 1
  if (state.metricCursor >= state.lines.length) {
    state.phase = 'done'
    state.done = true
  }
}

function runVerticalLayoutOperation(state) {
  const item = state.iterator.next()
  if (item.done) {
    state.iterator = null
    state.phase = 'done'
    state.done = true
    return
  }

  const grapheme = item.value
  if (grapheme === '\n') {
    state.columns.push([])
    return
  }

  let column = state.columns[state.columns.length - 1]
  if (column.length >= state.maxRows) {
    column = []
    state.columns.push(column)
  }
  column.push(grapheme)
  state.maximumColumnLength = Math.max(state.maximumColumnLength, column.length)
}

function defaultMeasureText(value) {
  return Array.from(String(value ?? '')).length
}

export function createIncrementalTextLayout(value, options = {}) {
  const orientation = options.orientation === 'vertical' ? 'vertical' : 'horizontal'
  const text = String(value ?? '')
  const state = {
    orientation,
    phase: 'layout',
    done: false,
    iterator: normalizedGraphemeIterator(text),
    sourceLength: text.length
  }

  if (orientation === 'vertical') {
    state.maxRows = positiveInteger(options.maxRows, 1)
    state.columns = [[]]
    state.maximumColumnLength = 0
    return state
  }

  const maxWidth = Number(options.maxWidth)
  state.maxWidth = Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : Number.POSITIVE_INFINITY
  state.lines = []
  state.widths = []
  state.currentGraphemes = []
  state.currentWidths = []
  state.currentWidth = 0
  state.lastSoftWrap = -1
  state.lastSoftWrapWidth = 0
  state.graphemeWidths = new Map()
  state.lineWidths = new Map()
  state.metricCursor = 0
  state.maximumLineWidth = 0
  return state
}

export function runIncrementalTextLayoutSlice(
  state,
  measureText,
  deadline,
  options = {}
) {
  if (!state || typeof state !== 'object') throw new TypeError('state must be an incremental text layout')
  if (state.done) return { done: true, operations: 0 }

  const measure = typeof measureText === 'function' ? measureText : defaultMeasureText
  const checkInterval = positiveInteger(options.checkInterval, DEFAULT_DEADLINE_CHECK_INTERVAL)
  const operationLimit = positiveInteger(options.operationLimit, DEFAULT_SLICE_OPERATION_LIMIT)
  const shouldYield = typeof deadline?.shouldYield === 'function'
    ? () => deadline.shouldYield()
    : () => false
  let operations = 0

  while (!state.done && operations < operationLimit) {
    if (state.orientation === 'vertical') runVerticalLayoutOperation(state)
    else if (state.phase === 'layout') runHorizontalLayoutOperation(state, measure)
    else runHorizontalMetricOperation(state, measure)
    operations += 1

    if (!state.done && operations % checkInterval === 0 && shouldYield()) break
  }

  return { done: state.done, operations }
}

export function finishIncrementalTextLayout(state) {
  if (!state || typeof state !== 'object') throw new TypeError('state must be an incremental text layout')
  if (!state.done) throw new Error('incremental text layout is not complete')
  return state.orientation === 'vertical'
    ? { columns: state.columns, maximumColumnLength: state.maximumColumnLength }
    : { lines: state.lines, widths: state.widths, maximumLineWidth: state.maximumLineWidth }
}
