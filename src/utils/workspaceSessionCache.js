export function createWorkspaceSessionCache(limit = 3) {
  const entries = new Map()
  const persisted = new Set()
  const saveVersions = new Map()
  const capacity = Math.max(1, Math.floor(Number(limit) || 1))

  function remove(workspace) {
    persisted.delete(workspace)
    saveVersions.delete(workspace)
    return entries.delete(workspace)
  }

  function trim() {
    while (entries.size > capacity) {
      let candidate = null
      for (const workspace of entries.keys()) {
        if (persisted.has(workspace)) {
          candidate = workspace
          break
        }
      }
      if (candidate == null) return false
      remove(candidate)
    }
    return true
  }

  return {
    get size() { return entries.size },
    get: workspace => entries.get(workspace),
    set(workspace, value) {
      entries.delete(workspace)
      entries.set(workspace, value)
      trim()
      return this
    },
    delete: remove,
    entries: () => entries.entries(),
    [Symbol.iterator]: () => entries[Symbol.iterator](),
    markDirty(workspace) {
      saveVersions.set(workspace, (saveVersions.get(workspace) || 0) + 1)
      persisted.delete(workspace)
    },
    markPersisted(workspace) {
      persisted.add(workspace)
      trim()
    },
    beginSave(workspace) {
      const version = (saveVersions.get(workspace) || 0) + 1
      saveVersions.set(workspace, version)
      persisted.delete(workspace)
      return version
    },
    isSaveCurrent(workspace, version) {
      return saveVersions.get(workspace) === version
    },
    completeSave(workspace, version) {
      if (saveVersions.get(workspace) !== version) return false
      persisted.add(workspace)
      trim()
      return true
    },
    trim
  }
}

function canPrepareWorkspaceSessionSnapshot(snapshot, workspace, prepareData) {
  return Boolean(
    snapshot
    && snapshot.version === 1
    && snapshot.workspace === workspace
    && Array.isArray(snapshot.sessions)
    && snapshot.sessions.length
    && typeof prepareData === 'function'
  )
}

function canPrepareWorkspacePaper(session, sessionIds) {
  return Boolean(session?.id && !sessionIds.has(session.id) && session.data && typeof session.data === 'object')
}

function historyEntryWithoutLegacyDrawings(entry) {
  if (!entry || typeof entry !== 'object' || !['entities', 'fields', 'geometry'].includes(entry.kind)) {
    return { entry, changed: false }
  }
  const drawings = Array.isArray(entry.drawings) ? entry.drawings : []
  if (!drawings.length) return { entry, changed: false }
  const sanitized = { ...entry, drawings: [] }
  const hasCurrentTargets = entry.kind === 'entities'
    ? (Array.isArray(entry.nodes) && entry.nodes.length) || (Array.isArray(entry.edges) && entry.edges.length)
    : Array.isArray(entry.nodes) && entry.nodes.length
  return { entry: hasCurrentTargets ? sanitized : null, changed: true }
}

function preparedWorkspaceHistory(value) {
  if (!Array.isArray(value)) return { entries: [], sanitized: true }
  const entries = []
  let sanitized = false
  for (const entry of value) {
    const prepared = historyEntryWithoutLegacyDrawings(entry)
    sanitized ||= prepared.changed
    if (prepared.entry !== null) entries.push(prepared.entry)
  }
  return { entries: sanitized ? entries : value, sanitized }
}

function preparedWorkspacePaper(session, data) {
  const history = preparedWorkspaceHistory(session.history)
  const future = preparedWorkspaceHistory(session.future)
  return {
    paper: {
      ...session,
      data,
      file: { kind: 'project', name: '', etag: '', size: 0, modifiedAt: null, ...(session.file || {}) },
      customHandle: session.customHandle || null,
      history: history.entries,
      future: future.entries
    },
    sanitized: history.sanitized || future.sanitized
  }
}

function completedWorkspaceSessionSnapshot(snapshot, sessionIds, sessions, sanitized = false) {
  if (!sessions.length) return null
  return {
    sessions,
    activeId: sessionIds.has(snapshot.activeId) ? snapshot.activeId : sessions[0].id,
    sanitized: sanitized || sessions.length !== snapshot.sessions.length
  }
}

export function prepareWorkspaceSessionSnapshot(snapshot, workspace, prepareData) {
  if (!canPrepareWorkspaceSessionSnapshot(snapshot, workspace, prepareData)) return null

  const sessionIds = new Set()
  const sessions = []
  let sanitized = false
  for (const session of snapshot.sessions) {
    if (!canPrepareWorkspacePaper(session, sessionIds)) continue
    try {
      const prepared = preparedWorkspacePaper(session, prepareData(session.data))
      sessions.push(prepared.paper)
      sanitized ||= prepared.sanitized
      sessionIds.add(session.id)
    } catch {}
  }
  return completedWorkspaceSessionSnapshot(snapshot, sessionIds, sessions, sanitized)
}

export async function prepareWorkspaceSessionSnapshotAsync(snapshot, workspace, prepareData) {
  if (!canPrepareWorkspaceSessionSnapshot(snapshot, workspace, prepareData)) return null

  const sessionIds = new Set()
  const sessions = []
  let sanitized = false
  for (const session of snapshot.sessions) {
    if (!canPrepareWorkspacePaper(session, sessionIds)) continue
    try {
      const prepared = preparedWorkspacePaper(session, await prepareData(session.data))
      sessions.push(prepared.paper)
      sanitized ||= prepared.sanitized
      sessionIds.add(session.id)
    } catch {}
  }
  return completedWorkspaceSessionSnapshot(snapshot, sessionIds, sessions, sanitized)
}
