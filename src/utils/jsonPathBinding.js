import { internSourceBindingRuntimeKey } from './runtimeKey.js'

export const MAX_JSON_PATH_LENGTH = 2048
export const MAX_JSON_PATH_TOKENS = 128

const MAX_COMPILED_PATH_CACHE = 512
const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const compiledPathCache = new Map()
const trustedCompiledPaths = new WeakSet()
const sourceBindingDescriptorCache = new WeakMap()

function pathError(message, ErrorType = TypeError) {
  return new ErrorType(`JSONPath ${message}`)
}

function isIdentifierStart(character) {
  return /[A-Za-z_$]/.test(character)
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character)
}

function assertSafePropertyKey(key) {
  if (UNSAFE_PROPERTY_KEYS.has(key)) throw pathError(`禁止访问属性 ${key}`)
}

function appendToken(tokens, token) {
  if (tokens.length >= MAX_JSON_PATH_TOKENS) {
    throw pathError(`最多支持 ${MAX_JSON_PATH_TOKENS} 段`, RangeError)
  }
  tokens.push(Object.freeze(token))
}

function parseQuotedProperty(path, start) {
  let cursor = start
  let key = ''
  while (cursor < path.length) {
    const character = path[cursor]
    if (character === "'") return { key, cursor: cursor + 1 }
    if (character !== '\\') {
      key += character
      cursor += 1
      continue
    }

    cursor += 1
    if (cursor >= path.length) throw pathError('字符串转义不完整')
    const escaped = path[cursor]
    const simpleEscapes = {
      "'": "'",
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t'
    }
    if (Object.prototype.hasOwnProperty.call(simpleEscapes, escaped)) {
      key += simpleEscapes[escaped]
      cursor += 1
      continue
    }
    if (escaped !== 'u') throw pathError(`不支持转义 \\${escaped}`)
    const code = path.slice(cursor + 1, cursor + 5)
    if (!/^[0-9a-fA-F]{4}$/.test(code)) throw pathError('Unicode 转义无效')
    key += String.fromCharCode(Number.parseInt(code, 16))
    cursor += 5
  }
  throw pathError('属性引号未闭合')
}

function parsePath(input) {
  if (typeof input !== 'string') throw pathError('必须是字符串')
  if (!input || input[0] !== '$') throw pathError('必须从 $ 开始')
  if (input.length > MAX_JSON_PATH_LENGTH) {
    throw pathError(`长度不能超过 ${MAX_JSON_PATH_LENGTH}`, RangeError)
  }

  const tokens = []
  let cursor = 1
  while (cursor < input.length) {
    const marker = input[cursor]
    if (marker === '.') {
      cursor += 1
      if (cursor >= input.length || !isIdentifierStart(input[cursor])) {
        throw pathError('点号后必须是标识符')
      }
      const start = cursor
      cursor += 1
      while (cursor < input.length && isIdentifierPart(input[cursor])) cursor += 1
      const key = input.slice(start, cursor)
      assertSafePropertyKey(key)
      appendToken(tokens, { type: 'property', key })
      continue
    }

    if (marker !== '[') throw pathError(`在位置 ${cursor} 发现不支持的语法`)
    cursor += 1
    if (cursor >= input.length) throw pathError('方括号未闭合')

    if (input[cursor] === "'") {
      const property = parseQuotedProperty(input, cursor + 1)
      cursor = property.cursor
      if (input[cursor] !== ']') throw pathError('属性引号后必须紧跟 ]')
      cursor += 1
      assertSafePropertyKey(property.key)
      appendToken(tokens, { type: 'property', key: property.key })
      continue
    }

    const start = cursor
    while (cursor < input.length && /[0-9]/.test(input[cursor])) cursor += 1
    if (start === cursor || input[cursor] !== ']') throw pathError('数组下标必须是非负整数')
    const rawIndex = input.slice(start, cursor)
    cursor += 1
    const index = Number(rawIndex)
    if (!Number.isSafeInteger(index) || index < 0) throw pathError('数组下标超出安全整数范围', RangeError)
    appendToken(tokens, { type: 'index', index })
  }
  return tokens
}

function escapedPropertyKey(key) {
  let escaped = ''
  for (let index = 0; index < key.length; index += 1) {
    const character = key[index]
    const code = character.charCodeAt(0)
    if (character === '\\') escaped += '\\\\'
    else if (character === "'") escaped += "\\'"
    else if (code < 0x20 || code === 0x7F) escaped += `\\u${code.toString(16).padStart(4, '0')}`
    else escaped += character
  }
  return escaped
}

function canonicalPath(tokens) {
  let path = '$'
  for (const token of tokens) {
    if (token.type === 'index') {
      path += `[${token.index}]`
    } else if (token.key && isIdentifierStart(token.key[0]) && [...token.key].every(isIdentifierPart)) {
      path += `.${token.key}`
    } else {
      path += `['${escapedPropertyKey(token.key)}']`
    }
  }
  if (path.length > MAX_JSON_PATH_LENGTH) {
    throw pathError(`规范化后长度不能超过 ${MAX_JSON_PATH_LENGTH}`, RangeError)
  }
  return path
}

function cacheCompiledPath(key, compiled) {
  if (compiledPathCache.has(key)) compiledPathCache.delete(key)
  compiledPathCache.set(key, compiled)
  while (compiledPathCache.size > MAX_COMPILED_PATH_CACHE) {
    compiledPathCache.delete(compiledPathCache.keys().next().value)
  }
}

/**
 * 编译受控 JSONPath。这里只解析字段和数组下标，不执行表达式、过滤器或脚本。
 */
export function compileJsonPath(path) {
  const cached = typeof path === 'string' ? compiledPathCache.get(path) : null
  if (cached) {
    compiledPathCache.delete(path)
    compiledPathCache.set(path, cached)
    return cached
  }

  const tokens = Object.freeze(parsePath(path))
  const canonical = canonicalPath(tokens)
  const compiled = Object.freeze({ path: canonical, tokens })
  trustedCompiledPaths.add(compiled)
  cacheCompiledPath(path, compiled)
  if (canonical !== path) cacheCompiledPath(canonical, compiled)
  return compiled
}

export function canonicalizeJsonPath(path) {
  return compileJsonPath(path).path
}

/** 只读取自有属性；缺失字段、异常 getter 和不可访问代理统一返回 undefined。 */
export function evaluateJsonPath(value, pathOrCompiled) {
  let compiled
  try {
    compiled = typeof pathOrCompiled === 'string'
      ? compileJsonPath(pathOrCompiled)
      : (trustedCompiledPaths.has(pathOrCompiled) ? pathOrCompiled : compileJsonPath(pathOrCompiled?.path))
  } catch {
    return undefined
  }
  if (!compiled || !Array.isArray(compiled.tokens)) return undefined

  let current = value
  for (const token of compiled.tokens) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) return undefined
    const key = token.type === 'index' ? token.index : token.key
    try {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined
      current = current[key]
    } catch {
      return undefined
    }
  }
  return current
}

export function jsonPathForChild(parentPath, key) {
  const parent = compileJsonPath(parentPath)
  let token
  if (typeof key === 'number') {
    if (!Number.isSafeInteger(key) || key < 0) throw pathError('数组下标必须是非负安全整数')
    token = Object.freeze({ type: 'index', index: key })
  } else {
    const propertyKey = String(key)
    assertSafePropertyKey(propertyKey)
    token = Object.freeze({ type: 'property', key: propertyKey })
  }
  if (parent.tokens.length >= MAX_JSON_PATH_TOKENS) {
    throw pathError(`最多支持 ${MAX_JSON_PATH_TOKENS} 段`, RangeError)
  }
  return canonicalPath([...parent.tokens, token])
}

export function jsonValueType(value) {
  if (value === null) return 'null'
  const type = typeof value
  if (type !== 'object') return type
  try {
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    return 'object'
  } catch {
    return 'unknown'
  }
}

/** 将数据源与路径编码为不会和旧 pointId 碰撞的运行时键。 */
export function sourceBindingRuntimeKey(sourceId, jsonPath) {
  const normalizedSourceId = String(sourceId ?? '').trim()
  if (!normalizedSourceId) throw new TypeError('数据源 ID 不能为空')
  if (normalizedSourceId.length > 256) throw new RangeError('数据源 ID 不能超过 256 个字符')
  const canonical = canonicalizeJsonPath(jsonPath)
  return runtimeKeyForCanonicalBinding(normalizedSourceId, canonical)
}

function runtimeKeyForCanonicalBinding(sourceId, jsonPath) {
  return internSourceBindingRuntimeKey(
    `source-binding:${encodeURIComponent(sourceId)}:${encodeURIComponent(jsonPath)}`
  )
}

/**
 * 同一个图纸绑定会依次经过索引、源运行时和渲染订阅，弱缓存让这些阶段复用编译结果。
 * 绑定字段被原地修改时会重新编译；节点删除后不会因缓存阻止垃圾回收。
 */
export function sourceBindingDescriptor(binding) {
  if (!binding || (typeof binding !== 'object' && typeof binding !== 'function')) return null
  let sourceId
  let rawPath
  try {
    sourceId = String(binding.sourceId ?? '').trim()
    rawPath = String(binding.jsonPath ?? binding.path ?? '').trim()
  } catch {
    return null
  }
  if (!sourceId || sourceId.length > 256 || !rawPath) return null

  const cached = sourceBindingDescriptorCache.get(binding)
  if (cached?.sourceId === sourceId && cached.rawPath === rawPath) return cached.descriptor

  try {
    const compiled = compileJsonPath(rawPath)
    const descriptor = Object.freeze({
      sourceId,
      jsonPath: compiled.path,
      compiled,
      runtimeKey: runtimeKeyForCanonicalBinding(sourceId, compiled.path)
    })
    sourceBindingDescriptorCache.set(binding, { sourceId, rawPath, descriptor })
    return descriptor
  } catch {
    return null
  }
}
