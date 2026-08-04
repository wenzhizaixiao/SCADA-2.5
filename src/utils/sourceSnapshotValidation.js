/** 绑定确认只接受当前数据源自身生成、且显式携带 data 的普通对象快照。 */
export function isUsableSourceSnapshot(snapshot, expectedSourceId) {
  try {
    const sourceId = String(expectedSourceId ?? '').trim()
    if (!sourceId || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
    if (!Object.prototype.hasOwnProperty.call(snapshot, 'data')) return false
    return String(snapshot.sourceId ?? '').trim() === sourceId
  } catch {
    return false
  }
}
