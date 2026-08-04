export function normalizeTextLayout(value) {
  return value === 'vertical' ? 'vertical' : 'horizontal'
}

export const TEXT_LAYOUT_LINE_HEIGHT = 1

let graphemeSegmenter = null
try {
  if (globalThis.Intl?.Segmenter) graphemeSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
} catch {}

const simpleTextPattern = /^[\x00-\x7f\p{Script=Han}]*$/u

export function splitTextGraphemes(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n')
  if (simpleTextPattern.test(text)) return Array.from(text)
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), item => item.segment)
    : Array.from(text)
}

const breakableSpacePattern = /^[\t\u0020\u3000]$/u
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const openingPunctuationPattern = /^[([{\u2018\u201c\u3008\u300a\u300c\u300e\u3010\u3014\u3016\ufe59\ufe5b\ufe5d\uff08\uff3b\uff5b]$/u
const closingPunctuationPattern = /^[)\]}!,.:;?\u2019\u201d\u3001\u3002\u3009\u300b\u300d\u300f\u3011\u3015\u3017\ufe50-\ufe58\ufe5a\ufe5c\ufe5e\uff01\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\uff3d\uff5d]$/u
const trailingBreakPattern = /^[-/\u2010-\u2014]$/u

function isSoftWrapOpportunity(previous, next) {
  if (!previous || !next) return false
  if (breakableSpacePattern.test(previous) || trailingBreakPattern.test(previous)) return true
  if (!cjkPattern.test(previous) && !cjkPattern.test(next)) return false
  return !openingPunctuationPattern.test(previous) && !closingPunctuationPattern.test(next)
}

function measuredWidth(measureText, grapheme) {
  const measured = measureText(grapheme)
  const width = Number(typeof measured === 'number' ? measured : measured?.width)
  return Number.isFinite(width) && width > 0 ? width : 0
}

function wrapHorizontalParagraph(graphemes, widthLimit, measureText) {
  if (!graphemes.length) return { lines: [''], widths: [0] }

  const widths = graphemes.map(grapheme => measuredWidth(measureText, grapheme))
  const cumulativeWidths = [0]
  for (const width of widths) cumulativeWidths.push(cumulativeWidths[cumulativeWidths.length - 1] + width)
  if (!Number.isFinite(widthLimit)) return { lines: [graphemes.join('')], widths: [cumulativeWidths.at(-1)] }
  const lines = []
  const lineWidths = []
  let start = 0

  const appendLine = end => {
    lines.push(graphemes.slice(start, end).join(''))
    lineWidths.push(cumulativeWidths[end] - cumulativeWidths[start])
    start = end
  }

  while (start < graphemes.length) {
    let lineWidth = 0
    let fitEnd = start
    let lastSoftWrap = -1

    while (fitEnd < graphemes.length) {
      if (fitEnd > start && isSoftWrapOpportunity(graphemes[fitEnd - 1], graphemes[fitEnd])) {
        lastSoftWrap = fitEnd
      }
      const nextWidth = lineWidth + widths[fitEnd]
      if (fitEnd > start && nextWidth > widthLimit) break
      lineWidth = nextWidth
      fitEnd += 1
    }

    if (fitEnd === graphemes.length) {
      appendLine(graphemes.length)
      break
    }

    const lineEnd = lastSoftWrap > start ? lastSoftWrap : Math.max(start + 1, fitEnd)
    appendLine(lineEnd)
  }

  return { lines, widths: lineWidths }
}

function createHorizontalTextLayout(value, maxWidth, measureText, includeLineMetrics) {
  const text = String(value ?? '')
  const width = Number(maxWidth)
  const widthLimit = Number.isFinite(width) ? Math.max(0, width) : Number.POSITIVE_INFINITY
  const sourceMeasure = typeof measureText === 'function' ? measureText : () => 1
  const widthCache = text.length > 64 ? new Map() : null
  const measure = widthCache
    ? grapheme => {
        if (!widthCache.has(grapheme)) widthCache.set(grapheme, sourceMeasure(grapheme))
        return widthCache.get(grapheme)
      }
    : sourceMeasure
  const paragraphs = [[]]

  for (const grapheme of splitTextGraphemes(text)) {
    if (grapheme === '\n') paragraphs.push([])
    else paragraphs[paragraphs.length - 1].push(grapheme)
  }

  const result = { lines: [], widths: [] }
  for (const paragraph of paragraphs) {
    const layout = wrapHorizontalParagraph(paragraph, widthLimit, measure)
    result.lines.push(...layout.lines)
    result.widths.push(...layout.widths)
  }
  if (includeLineMetrics) {
    const lineWidthCache = result.lines.length > 64 ? new Map() : null
    result.widths = result.lines.map(line => {
      if (!lineWidthCache) return measuredWidth(sourceMeasure, line)
      if (!lineWidthCache.has(line)) lineWidthCache.set(line, measuredWidth(sourceMeasure, line))
      return lineWidthCache.get(line)
    })
  }
  return result
}

export function horizontalTextLayout(value, maxWidth, measureText) {
  return createHorizontalTextLayout(value, maxWidth, measureText, true)
}

export function horizontalTextLines(value, maxWidth, measureText) {
  return createHorizontalTextLayout(value, maxWidth, measureText, false).lines
}

export function textBlockStart(containerExtent, contentExtent, alignment = 'center') {
  const container = Math.max(0, Number(containerExtent) || 0)
  const content = Math.max(0, Number(contentExtent) || 0)
  if (alignment === 'left' || alignment === 'start') return 0
  if (alignment === 'right' || alignment === 'end') return container - content
  return (container - content) / 2
}

export function verticalTextColumns(value, maxRows) {
  const rowLimit = Math.max(1, Math.floor(Number(maxRows)) || 1)
  const columns = [[]]
  for (const grapheme of splitTextGraphemes(value)) {
    if (grapheme === '\n') {
      columns.push([])
      continue
    }
    let column = columns[columns.length - 1]
    if (column.length >= rowLimit) {
      column = []
      columns.push(column)
    }
    column.push(grapheme)
  }
  return columns
}
