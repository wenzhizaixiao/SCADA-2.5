export function parseRenderGeneration(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function finiteRevision(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function completionTargetMatches(expected, actual) {
  const expectedValue = parseRenderGeneration(expected)
  const actualValue = parseRenderGeneration(actual)
  return expectedValue != null && actualValue != null && actualValue >= expectedValue
}

function revisionMatches(expected, actual) {
  const expectedValue = finiteRevision(expected)
  const actualValue = finiteRevision(actual)
  return expectedValue != null && actualValue != null && actualValue >= expectedValue
}

function geometryCompletionMatches({
  session,
  event,
  sessionId,
  targetGeneration,
  revision = session?.revision
}) {
  return Boolean(
    session?.state === 'awaiting-full'
    && sessionId != null
    && event?.sessionId === sessionId
    && completionTargetMatches(targetGeneration, event?.renderGeneration)
    && revisionMatches(revision, event?.geometryRevision)
  )
}

export function editorLodSessionWaitsForDetail(session) {
  return session?.detailCompletionRequired === true
}

export function editorLodGeometryBarrierSettled(session) {
  return Boolean(
    session?.state === 'awaiting-full'
    && session.fallbackComplete === true
    && (!editorLodSessionWaitsForDetail(session) || session.detailComplete === true)
  )
}

export function editorLodFallbackGeometryCompletesSession(session, event) {
  return geometryCompletionMatches({
    session,
    event,
    sessionId: session?.sessionId,
    targetGeneration: session?.targetFullGeneration,
    revision: session?.fallbackRevision ?? session?.revision
  })
}

export function editorLodDetailRenderCompletesSession(session, event) {
  if (session?.state !== 'awaiting-full' || !editorLodSessionWaitsForDetail(session)) return false
  if (!completionTargetMatches(session.detailTargetGeneration, event?.renderGeneration)) return false
  if (session.detailSessionId == null) return event?.geometrySessionId == null
  return event?.geometrySessionId === session.detailSessionId
    && revisionMatches(session.detailRevision ?? session.revision, event?.geometryRevision)
}

export function editorLodDetailGeometryCompletesSession(session, event) {
  if (!editorLodSessionWaitsForDetail(session)) return false
  return geometryCompletionMatches({
    session,
    event,
    sessionId: session?.detailSessionId,
    targetGeneration: session?.detailTargetGeneration,
    revision: session?.detailRevision ?? session?.revision
  })
}

export function markEditorLodGeometryLayerComplete(session, layer) {
  if (!session || !['fallback', 'detail'].includes(layer)) return { session, settled: false }
  const next = {
    ...session,
    fallbackComplete: session.fallbackComplete === true || layer === 'fallback',
    detailComplete: session.detailComplete === true || layer === 'detail'
  }
  return {
    session: next,
    settled: editorLodGeometryBarrierSettled(next)
  }
}

export function markEditorLodGeometryLayerFailed(session, layer) {
  if (!session || !['fallback', 'detail'].includes(layer)) return { session, settled: false }
  const completion = markEditorLodGeometryLayerComplete(session, layer)
  const next = {
    ...completion.session,
    [`${layer}Failed`]: true,
    [`${layer}RecoveryPending`]: true
  }
  return {
    session: next,
    settled: editorLodGeometryBarrierSettled(next)
  }
}
