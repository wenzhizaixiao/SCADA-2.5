const TRUNCATION_MARKER = '...'
const CIRCULAR_MARKER = '[Circular]'
const THROWN_MARKER = '[Thrown]'
const UNFORMATTABLE_MARKER = '[Unformattable]'

export const DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS = Object.freeze({
  maxLength: 256,
  maxDepth: 4,
  maxObjectKeys: 12,
  maxArrayItems: 12,
  maxTotalEntries: 48
})

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
}

function normalizedLimits(options) {
  return {
    maxLength: boundedInteger(options?.maxLength, DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxLength, 0, 4096),
    maxDepth: boundedInteger(options?.maxDepth, DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxDepth, 0, 16),
    maxObjectKeys: boundedInteger(options?.maxObjectKeys, DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxObjectKeys, 0, 128),
    maxArrayItems: boundedInteger(options?.maxArrayItems, DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxArrayItems, 0, 128),
    maxTotalEntries: boundedInteger(options?.maxTotalEntries, DEFAULT_RUNTIME_VALUE_FORMAT_LIMITS.maxTotalEntries, 0, 512)
  }
}

function safePrefix(value, length) {
  if (length <= 0) return ''
  let prefix = value.slice(0, length)
  const lastCode = prefix.charCodeAt(prefix.length - 1)
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) prefix = prefix.slice(0, -1)
  return prefix
}

function clippedText(value, maxLength) {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  if (maxLength <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, maxLength)
  return safePrefix(value, maxLength - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
}

function escapedStringToken(value, index) {
  const code = value.charCodeAt(index)
  const character = value[index]
  if (character === '"') return { token: '\\"', width: 1 }
  if (character === '\\') return { token: '\\\\', width: 1 }
  if (character === '\b') return { token: '\\b', width: 1 }
  if (character === '\f') return { token: '\\f', width: 1 }
  if (character === '\n') return { token: '\\n', width: 1 }
  if (character === '\r') return { token: '\\r', width: 1 }
  if (character === '\t') return { token: '\\t', width: 1 }
  if (code < 0x20 || (code >= 0xDC00 && code <= 0xDFFF)) {
    return { token: `\\u${code.toString(16).padStart(4, '0')}`, width: 1 }
  }
  if (code >= 0xD800 && code <= 0xDBFF) {
    const nextCode = value.charCodeAt(index + 1)
    if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
      return { token: value.slice(index, index + 2), width: 2 }
    }
    return { token: `\\u${code.toString(16).padStart(4, '0')}`, width: 1 }
  }
  return { token: character, width: 1 }
}

function quotedString(value, maxLength) {
  if (maxLength <= 0) return ''
  if (maxLength === 1) return '"'
  const bodyLimit = maxLength - 2
  const tokens = []
  let bodyLength = 0
  let index = 0

  while (index < value.length) {
    const { token, width } = escapedStringToken(value, index)
    if (bodyLength + token.length > bodyLimit) break
    tokens.push(token)
    bodyLength += token.length
    index += width
  }

  if (index < value.length && bodyLimit > 0) {
    const marker = TRUNCATION_MARKER.slice(0, bodyLimit)
    while (tokens.length && bodyLength + marker.length > bodyLimit) {
      bodyLength -= tokens.pop().length
    }
    tokens.push(marker.slice(0, bodyLimit - bodyLength))
  }

  return `"${tokens.join('')}"`
}

function wrappedText(prefix, value, suffix, maxLength) {
  if (maxLength <= 0) return ''
  const fixedLength = prefix.length + suffix.length
  if (fixedLength >= maxLength) return clippedText(prefix + suffix, maxLength)
  return prefix + clippedText(value, maxLength - fixedLength) + suffix
}

function safeScalarText(value, fallback = '') {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return fallback
  return fallback
}

function boundedBigInt(value, maxLength) {
  if (maxLength <= 0) return ''
  const negative = value < 0n
  const absolute = negative ? -value : value
  const digitBudget = Math.max(1, maxLength - (negative ? 2 : 1))
  const decimalLimit = 10n ** BigInt(digitBudget)
  if (absolute >= decimalLimit) {
    return clippedText(`${negative ? '-' : ''}[BigInt exceeds display budget]`, maxLength)
  }
  return clippedText(`${value.toString()}n`, maxLength)
}

function safeProperty(value, key) {
  try {
    return { value: value[key], threw: false }
  } catch {
    return { value: undefined, threw: true }
  }
}

function appendOmission(output, closing, maxLength, hasEntries) {
  const marker = `${hasEntries ? ',' : ''}${TRUNCATION_MARKER}`
  if (output.length + marker.length + closing.length <= maxLength) return output + marker
  return output
}

function formatSequence({ opening, closing, values, omitted, depth, maxLength, state }) {
  if (maxLength <= opening.length + closing.length) return clippedText(opening + closing, maxLength)
  let output = opening
  let rendered = 0
  let wasOmitted = Boolean(omitted)

  for (const value of values) {
    if (state.totalEntries >= state.limits.maxTotalEntries) {
      wasOmitted = true
      break
    }
    const separator = rendered ? ',' : ''
    const available = maxLength - output.length - separator.length - closing.length
    if (available <= 0) {
      wasOmitted = true
      break
    }
    state.totalEntries += 1
    const formatted = formatAny(value, depth + 1, available, state, false)
    if (!formatted) {
      wasOmitted = true
      break
    }
    output += separator + formatted
    rendered += 1
  }

  if (wasOmitted) output = appendOmission(output, closing, maxLength, rendered > 0)
  return output + closing
}

function formatArray(value, depth, maxLength, state) {
  if (depth >= state.limits.maxDepth) return clippedText('[...]', maxLength)
  const lengthResult = safeProperty(value, 'length')
  if (lengthResult.threw) return clippedText(UNFORMATTABLE_MARKER, maxLength)
  const length = boundedInteger(lengthResult.value, 0, 0, Number.MAX_SAFE_INTEGER)
  const count = Math.min(length, state.limits.maxArrayItems)
  const values = (function * limitedArrayValues() {
    for (let index = 0; index < count; index += 1) {
      const result = safeProperty(value, index)
      yield result.threw ? THROWN_MARKER : result.value
    }
  })()
  return formatSequence({
    opening: '[',
    closing: ']',
    values,
    omitted: length > count,
    depth,
    maxLength,
    state
  })
}

function formatMap(value, depth, maxLength, state) {
  if (depth >= state.limits.maxDepth) return clippedText('Map{...}', maxLength)
  if (maxLength <= 5) return clippedText('Map{}', maxLength)
  let iterator
  try {
    iterator = Map.prototype.entries.call(value)
  } catch {
    return clippedText(UNFORMATTABLE_MARKER, maxLength)
  }
  let output = 'Map{'
  let rendered = 0
  let omitted = false

  while (rendered < state.limits.maxObjectKeys) {
    let next
    try {
      next = iterator.next()
    } catch {
      omitted = true
      break
    }
    if (next.done) return output + '}'
    if (state.totalEntries >= state.limits.maxTotalEntries) {
      omitted = true
      break
    }
    const separator = rendered ? ',' : ''
    const available = maxLength - output.length - separator.length - 1
    if (available <= 2) {
      omitted = true
      break
    }
    state.totalEntries += 1
    const keyBudget = Math.max(1, Math.floor((available - 2) / 2))
    const key = formatAny(next.value[0], depth + 1, keyBudget, state, false)
    const valueBudget = available - key.length - 2
    const entryValue = formatAny(next.value[1], depth + 1, valueBudget, state, false)
    output += `${separator}${key}=>${entryValue}`
    rendered += 1
  }

  if (rendered >= state.limits.maxObjectKeys) omitted = true
  if (omitted) output = appendOmission(output, '}', maxLength, rendered > 0)
  return output + '}'
}

function formatSet(value, depth, maxLength, state) {
  if (depth >= state.limits.maxDepth) return clippedText('Set[...]', maxLength)
  let iterator
  try {
    iterator = Set.prototype.values.call(value)
  } catch {
    return clippedText(UNFORMATTABLE_MARKER, maxLength)
  }
  const values = (function * limitedSetValues() {
    let count = 0
    while (count < state.limits.maxArrayItems) {
      let next
      try {
        next = iterator.next()
      } catch {
        yield THROWN_MARKER
        return
      }
      if (next.done) return
      count += 1
      yield next.value
    }
  })()
  return formatSequence({
    opening: 'Set[',
    closing: ']',
    values,
    omitted: false,
    depth,
    maxLength,
    state
  })
}

function formatObject(value, depth, maxLength, state) {
  if (depth >= state.limits.maxDepth) return clippedText('{...}', maxLength)
  if (maxLength <= 2) return clippedText('{}', maxLength)
  let output = '{'
  let rendered = 0
  let scanned = 0
  let omitted = false
  const scanLimit = Math.max(1, state.limits.maxObjectKeys * 2 + 4)

  try {
    for (const key in value) {
      scanned += 1
      if (scanned > scanLimit) {
        omitted = true
        break
      }
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      if (rendered >= state.limits.maxObjectKeys || state.totalEntries >= state.limits.maxTotalEntries) {
        omitted = true
        break
      }
      const separator = rendered ? ',' : ''
      const available = maxLength - output.length - separator.length - 1
      if (available <= 3) {
        omitted = true
        break
      }
      const keyBudget = Math.min(96, Math.max(2, Math.floor(available / 2)))
      const formattedKey = quotedString(key, keyBudget)
      const valueBudget = available - formattedKey.length - 1
      if (valueBudget <= 0) {
        omitted = true
        break
      }
      const result = safeProperty(value, key)
      state.totalEntries += 1
      const formattedValue = result.threw
        ? clippedText(THROWN_MARKER, valueBudget)
        : formatAny(result.value, depth + 1, valueBudget, state, false)
      output += `${separator}${formattedKey}:${formattedValue}`
      rendered += 1
      if (rendered >= state.limits.maxObjectKeys) {
        omitted = true
        break
      }
    }
  } catch {
    omitted = true
  }

  if (omitted) output = appendOmission(output, '}', maxLength, rendered > 0)
  return output + '}'
}

function formatAny(value, depth, maxLength, state, topLevel) {
  if (maxLength <= 0) return ''
  if (value === null) return clippedText('null', maxLength)
  if (value === undefined) return clippedText('undefined', maxLength)

  const type = typeof value
  if (type === 'string') return topLevel ? clippedText(value, maxLength) : quotedString(value, maxLength)
  if (type === 'number' || type === 'boolean') return clippedText(String(value), maxLength)
  if (type === 'bigint') return boundedBigInt(value, maxLength)
  if (type === 'symbol') {
    let description = ''
    try { description = value.description || '' } catch { /* no-op */ }
    return wrappedText('Symbol(', description, ')', maxLength)
  }
  if (type === 'function') {
    let name = ''
    try { name = value.name || '' } catch { /* no-op */ }
    return name
      ? wrappedText('[Function ', name, ']', maxLength)
      : clippedText('[Function]', maxLength)
  }
  if (type !== 'object') return clippedText(`[${type}]`, maxLength)

  try {
    if (state.ancestors.has(value)) return clippedText(CIRCULAR_MARKER, maxLength)
    state.ancestors.add(value)
    try {
      if (value instanceof Date) {
        const timestamp = Date.prototype.getTime.call(value)
        return quotedString(Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'Invalid Date', maxLength)
      }
      if (value instanceof RegExp) {
        const source = safeProperty(value, 'source')
        const flags = safeProperty(value, 'flags')
        if (source.threw || flags.threw) return clippedText(UNFORMATTABLE_MARKER, maxLength)
        const suffix = `/${clippedText(safeScalarText(flags.value), 16)}`
        return wrappedText('/', safeScalarText(source.value, THROWN_MARKER), suffix, maxLength)
      }
      if (value instanceof String) return quotedString(String.prototype.valueOf.call(value), maxLength)
      if (value instanceof Number) return clippedText(String(Number.prototype.valueOf.call(value)), maxLength)
      if (value instanceof Boolean) return clippedText(String(Boolean.prototype.valueOf.call(value)), maxLength)
      if (value instanceof Error) {
        const name = safeProperty(value, 'name')
        const message = safeProperty(value, 'message')
        const label = name.threw ? 'Error' : safeScalarText(name.value, 'Error')
        const detail = message.threw ? THROWN_MARKER : safeScalarText(message.value, '[Object]')
        return wrappedText(`${clippedText(label, 48)}(`, detail, ')', maxLength)
      }
      if (value instanceof Map) return formatMap(value, depth, maxLength, state)
      if (value instanceof Set) return formatSet(value, depth, maxLength, state)
      if (Array.isArray(value)) return formatArray(value, depth, maxLength, state)
      if (ArrayBuffer.isView(value)) {
        if (value instanceof DataView) return clippedText(`[DataView ${value.byteLength} bytes]`, maxLength)
        return formatArray(value, depth, maxLength, state)
      }
      if (value instanceof ArrayBuffer) return clippedText(`[ArrayBuffer ${value.byteLength} bytes]`, maxLength)
      if (typeof WeakMap !== 'undefined' && value instanceof WeakMap) return clippedText('[WeakMap]', maxLength)
      if (typeof WeakSet !== 'undefined' && value instanceof WeakSet) return clippedText('[WeakSet]', maxLength)
      if (typeof Promise !== 'undefined' && value instanceof Promise) return clippedText('[Promise]', maxLength)
      return formatObject(value, depth, maxLength, state)
    } finally {
      state.ancestors.delete(value)
    }
  } catch {
    return clippedText(UNFORMATTABLE_MARKER, maxLength)
  }
}

/**
 * Formats a runtime value without serializing or traversing the complete value.
 * Work is bounded by output length, nesting depth, collection width and a global entry budget.
 */
export function formatRuntimeValue(value, options = {}) {
  const limits = normalizedLimits(options)
  if (limits.maxLength === 0) return ''
  return formatAny(value, 0, limits.maxLength, {
    ancestors: new WeakSet(),
    limits,
    totalEntries: 0
  }, true)
}
