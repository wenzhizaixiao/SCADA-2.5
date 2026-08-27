const BINDABLE_SNAPSHOT_QUALITIES = new Set(['', 'good'])

/** 绑定确认只接受当前数据源自身生成、正文有效且质量正常的正式快照。 */
export function isUsableSourceSnapshot(snapshot, expectedSourceId) {
  try {
    const sourceId = String(expectedSourceId ?? '').trim()
    if (!sourceId || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
    if (!Object.prototype.hasOwnProperty.call(snapshot, 'data')) return false
    if (snapshot.data === undefined) return false
    if (String(snapshot.sourceId ?? '').trim() !== sourceId) return false
    const quality = String(snapshot.quality ?? '').trim().toLowerCase()
    return BINDABLE_SNAPSHOT_QUALITIES.has(quality)
  } catch {
    return false
  }
}
