import { jsonPathForChild, jsonValueType } from './jsonPathBinding.js'
import { formatRuntimeValue } from './runtimeValueFormat.js'

const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const DEFAULT_LIMITS = Object.freeze({
  maxRows: 80,
  maxDepth: 8,
  maxChildren: 40,
  maxValueLength: 96
})

const MAX_LIMITS = Object.freeze({
  maxRows: 80,
  maxDepth: 32,
  maxChildren: 200,
  maxValueLength: 256
})

const VALUE_FORMAT_LIMITS = Object.freeze({
  // 容器行只显示形状，子项由下方的统一遍历预算读取，避免重复触发 getter。
  maxDepth: 0,
  maxArrayItems: 3,
  maxObjectKeys: 3,
  maxTotalEntries: 6
})

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function normalizedLimits(options) {
  return {
    maxRows: boundedInteger(options?.maxRows, DEFAULT_LIMITS.maxRows, 1, MAX_LIMITS.maxRows),
    maxDepth: boundedInteger(options?.maxDepth, DEFAULT_LIMITS.maxDepth, 0, MAX_LIMITS.maxDepth),
    maxChildren: boundedInteger(options?.maxChildren, DEFAULT_LIMITS.maxChildren, 1, MAX_LIMITS.maxChildren),
    maxValueLength: boundedInteger(options?.maxValueLength, DEFAULT_LIMITS.maxValueLength, 16, MAX_LIMITS.maxValueLength)
  }
}

function safeContainerKind(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return ''
  try {
    return Array.isArray(value) ? 'array' : 'object'
  } catch {
    return ''
  }
}

function safeArrayLength(value) {
  try {
    const length = Math.trunc(Number(value.length))
    if (!Number.isFinite(length) || length <= 0) return 0
    return Math.min(0xffffffff, length)
  } catch {
    return 0
  }
}

function safeOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
  } catch {
    return false
  }
}

function safeRead(value, key) {
  try {
    return { readable: true, value: value[key] }
  } catch {
    return { readable: false, value: undefined }
  }
}

function previewValue(value, readable, maxLength) {
  if (!readable) return '[无法读取]'
  return formatRuntimeValue(value, {
    ...VALUE_FORMAT_LIMITS,
    maxLength
  })
}

/**
 * 将一次接口响应展平为可绑定的 JSONPath 预览行。
 * 遍历从不先复制完整键集合，并同时受总行数、深度和单容器宽度预算约束。
 */
export function createJsonResponsePointPreview(value, options = {}) {
  const limits = normalizedLimits(options)
  const rows = []
  const ancestors = new WeakSet()

  function append(current, path, depth, readable = true) {
    if (rows.length >= limits.maxRows) return

    const type = readable ? jsonValueType(current) : 'unknown'
    rows.push({
      path,
      type,
      value: previewValue(current, readable, limits.maxValueLength)
    })

    if (!readable || depth >= limits.maxDepth || rows.length >= limits.maxRows) return
    const containerKind = safeContainerKind(current)
    if (!containerKind || ancestors.has(current)) return

    ancestors.add(current)
    try {
      if (containerKind === 'array') appendArrayChildren(current, path, depth)
      else appendObjectChildren(current, path, depth)
    } finally {
      ancestors.delete(current)
    }
  }

  function appendArrayChildren(array, parentPath, depth) {
    const scanCount = Math.min(safeArrayLength(array), limits.maxChildren)
    for (let index = 0; index < scanCount && rows.length < limits.maxRows; index += 1) {
      if (!safeOwn(array, index)) continue
      let childPath
      try {
        childPath = jsonPathForChild(parentPath, index)
      } catch {
        continue
      }
      const child = safeRead(array, index)
      append(child.value, childPath, depth + 1, child.readable)
    }
  }

  function appendObjectChildren(object, parentPath, depth) {
    let scanned = 0
    try {
      for (const key in object) {
        if (scanned >= limits.maxChildren || rows.length >= limits.maxRows) break
        scanned += 1
        if (UNSAFE_PROPERTY_KEYS.has(key) || !safeOwn(object, key)) continue

        let childPath
        try {
          childPath = jsonPathForChild(parentPath, key)
        } catch {
          continue
        }
        const child = safeRead(object, key)
        append(child.value, childPath, depth + 1, child.readable)
      }
    } catch {
      // 代理对象可能在枚举键时抛错；已经生成的有界预览仍然有效。
    }
  }

  append(value, '$', 0)
  return rows
}
