export const MAX_WORKSPACE_ID_LENGTH = 64

function normalizedIdentity(value) {
  try {
    return String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, MAX_WORKSPACE_ID_LENGTH)
  } catch {
    return ''
  }
}

/** 所有图纸、会话和数据源在生成存储键前必须经过同一份工作空间规范化。 */
export function normalizeWorkspaceId(value, fallback = '') {
  return normalizedIdentity(value) || normalizedIdentity(fallback)
}
