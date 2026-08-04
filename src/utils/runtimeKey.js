const SOURCE_BINDING_KEY_BRAND = Symbol('tc2d.source-binding-runtime-key')
const RUNTIME_UPDATE_GENERATION = Symbol('tc2d.runtime-update-generation')

const supportsWeakInterning = typeof WeakRef === 'function' && typeof FinalizationRegistry === 'function'
const sourceBindingKeyCache = new Map()
const sourceBindingKeyFinalizer = supportsWeakInterning
  ? new FinalizationRegistry(({ text, reference }) => {
      if (sourceBindingKeyCache.get(text) === reference) sourceBindingKeyCache.delete(text)
    })
  : null

function cachedSourceBindingKey(text) {
  const cached = sourceBindingKeyCache.get(text)
  return supportsWeakInterning ? cached?.deref() : cached
}

/**
 * 源绑定键只存在于运行内存。使用带品牌的 String 对象既保留字符串展示能力，
 * 又让 Map 身份与任意旧 pointId/dataKey 字符串彻底隔离。
 */
export function internSourceBindingRuntimeKey(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new TypeError('源绑定运行键不能为空')
  const cached = cachedSourceBindingKey(text)
  if (cached) return cached

  const key = new String(text)
  Object.defineProperty(key, SOURCE_BINDING_KEY_BRAND, { value: true })
  Object.freeze(key)
  if (supportsWeakInterning) {
    const reference = new WeakRef(key)
    sourceBindingKeyCache.set(text, reference)
    sourceBindingKeyFinalizer.register(key, { text, reference })
  } else {
    sourceBindingKeyCache.set(text, key)
  }
  return key
}

export function isSourceBindingRuntimeKey(value) {
  if (!value || typeof value !== 'object') return false
  try {
    return value[SOURCE_BINDING_KEY_BRAND] === true
  } catch {
    return false
  }
}

/** 规范普通旧键，同时原样保留已经隔离的源绑定键。 */
export function normalizeRuntimeKey(value) {
  return isSourceBindingRuntimeKey(value) ? value : String(value ?? '').trim()
}

export function runtimeKeyText(value) {
  return String(value ?? '').trim()
}

/**
 * 生成仅用于响应式监听的稳定签名，并保留源绑定键与旧字符串键的类型差异。
 * 长度前缀避免键文本中包含分隔符时产生组合碰撞。
 */
export function runtimeKeySignature(values = []) {
  let signature = ''
  for (const value of values) {
    const key = normalizeRuntimeKey(value)
    if (!key) continue
    const text = runtimeKeyText(key)
    signature += `${isSourceBindingRuntimeKey(key) ? 's' : 'l'}${text.length}:${text};`
  }
  return signature
}

/** 仅返回已经存在的令牌，用于把 App 的字符串脏区通知桥接回源绑定索引。 */
export function findSourceBindingRuntimeKey(value) {
  const text = runtimeKeyText(value)
  return text ? cachedSourceBindingKey(text) || null : null
}

export function setRuntimeUpdateGeneration(update, generation) {
  if (!update || typeof update !== 'object') return update
  Object.defineProperty(update, RUNTIME_UPDATE_GENERATION, {
    configurable: true,
    value: generation
  })
  return update
}

export function hasRuntimeUpdateGeneration(update) {
  return Boolean(update && typeof update === 'object'
    && Object.prototype.hasOwnProperty.call(update, RUNTIME_UPDATE_GENERATION))
}

export function runtimeUpdateGeneration(update) {
  return hasRuntimeUpdateGeneration(update) ? update[RUNTIME_UPDATE_GENERATION] : undefined
}

export function copyRuntimeUpdateGeneration(target, source) {
  return hasRuntimeUpdateGeneration(source)
    ? setRuntimeUpdateGeneration(target, runtimeUpdateGeneration(source))
    : target
}
