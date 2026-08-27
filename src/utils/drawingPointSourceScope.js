import { normalizeWorkspaceId } from './workspaceIdentity.js'

const DRAWING_SCOPE_PREFIX = 'drawing:v1:'
const MAX_DRAWING_ID_LENGTH = 512
const FNV_64_MASK = 0xffffffffffffffffn

function requiredDrawingId(value) {
  const drawingId = String(value ?? '').normalize('NFC').trim()
  if (!drawingId) throw new TypeError('图纸 ID 不能为空')
  if (drawingId.length > MAX_DRAWING_ID_LENGTH) throw new TypeError('图纸 ID 过长')
  return drawingId
}

function fnv1a64(value, offsetBasis) {
  let hash = offsetBasis
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & FNV_64_MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * 数据源存储仍复用现有工作空间网关，但作用域由“工作空间 + 图纸”共同确定。
 * 双摘要把最长 64 + 512 字符的身份压缩到现有 64 字符存储键限制内。
 */
export function drawingPointSourceScopeId(workspaceValue, drawingValue) {
  const workspaceId = normalizeWorkspaceId(workspaceValue)
  if (!workspaceId) throw new TypeError('工作空间不能为空')
  const drawingId = requiredDrawingId(drawingValue)
  const identity = `${workspaceId.length}:${workspaceId}\u0000${drawingId.length}:${drawingId}`
  const first = fnv1a64(identity, 0xcbf29ce484222325n)
  const second = fnv1a64(identity, 0x84222325cbf29ce4n)
  return `${DRAWING_SCOPE_PREFIX}${first}${second}`
}
