import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
const projectPreparationSource = await readFile(new URL('../src/utils/projectPreparation.js', import.meta.url), 'utf8')

function section(start, end) {
  const startIndex = appSource.indexOf(start)
  const endIndex = appSource.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing ${start}`)
  assert.notEqual(endIndex, -1, `missing ${end}`)
  return appSource.slice(startIndex, endIndex)
}

test('flushes pending field and video edits through one selection boundary', () => {
  const flush = section('function flushPendingDocumentEdits()', 'function beginFieldEdit')
  assert.ok(flush.indexOf('finishActiveFieldEdit()') < flush.indexOf('flushPendingVideoUrlEdit()'))
  assert.match(section('function setNodeSelection', 'function clearNodeSelection'), /flushPendingDocumentEdits\(\)/)
  assert.match(section('function clearNodeSelection', 'function selectSingleNode'), /flushPendingDocumentEdits\(\)/)
})

test('awaits complete workspace save and restore boundaries', () => {
  const switchWorkspace = section('async function switchWorkspace()', 'function handleProjectStorageChange')
  assert.match(switchWorkspace, /await saveLocal\(\{ silent: true \}\)/)
  assert.match(switchWorkspace, /const sessionsSaved = await storeWorkspacePaperSessions\(\)/)
  assert.match(switchWorkspace, /if \(await restoreWorkspacePaperSessions\(\)\)/)
  assert.match(switchWorkspace, /if \(!await restoreStoredWorkspaceProject\(\)\)/)
  assert.match(switchWorkspace, /workspaceSwitchMessage\(workspaceId\.value, sessionsSaved/)
  assert.doesNotMatch(switchWorkspace, /if \(!await saveLocal/)

  const mounted = section('onMounted(async () =>', 'onUnmounted(() =>')
  assert.ok(mounted.indexOf('restoreWorkspacePaperSessions()') < mounted.indexOf('restoreStoredWorkspaceProject()'))
  assert.ok(mounted.indexOf('restoreStoredWorkspaceProject()') < mounted.indexOf('ensurePaperSession()'))
})

function createProjectStorageChangeHarness() {
  const source = section('let projectStorageChangeGeneration = 0', 'async function importJson')
  const localStorage = {}
  const pending = []
  const notifications = []
  const refs = {
    workspaceSwitchPending: { value: false },
    workspaceId: { value: 'workspace-a' },
    projectStorageKey: { value: 'tc2d-project:workspace-a' },
    projectId: { value: 'project-a' },
    projectRevision: { value: 1 },
    projectUpdatedAt: { value: '2026-01-01T00:00:00.000Z' }
  }
  const projectJsonParser = {
    parseHeader(serialized) {
      return new Promise((resolve, reject) => pending.push({ serialized, resolve, reject }))
    }
  }
  const createHarness = new Function(
    'localStorage',
    'projectJsonParser',
    'workspaceSwitchPending',
    'workspaceId',
    'projectStorageKey',
    'projectId',
    'projectRevision',
    'projectUpdatedAt',
    'notify',
    'componentLifecycleActive',
    `${source}\nreturn { handleProjectStorageChange, invalidateProjectStorageChanges, setComponentLifecycleActive(value) { componentLifecycleActive = Boolean(value) } }`
  )
  return {
    ...createHarness(
      localStorage,
      projectJsonParser,
      refs.workspaceSwitchPending,
      refs.workspaceId,
      refs.projectStorageKey,
      refs.projectId,
      refs.projectRevision,
      refs.projectUpdatedAt,
      message => notifications.push(message),
      true
    ),
    localStorage,
    notifications,
    pending,
    refs
  }
}

function storageEvent(harness, newValue) {
  return {
    storageArea: harness.localStorage,
    key: harness.refs.projectStorageKey.value,
    newValue
  }
}

test('offloads storage-event parsing and accepts only the latest asynchronous result', async () => {
  const harness = createProjectStorageChangeHarness()
  const first = harness.handleProjectStorageChange(storageEvent(harness, '{"revision":2}'))
  const second = harness.handleProjectStorageChange(storageEvent(harness, '{"revision":3}'))

  assert.deepEqual(harness.pending.map(request => request.serialized), ['{"revision":2}', '{"revision":3}'])
  harness.pending[1].resolve({ projectId: 'project-a', revision: 3, updatedAt: '2026-01-03T00:00:00.000Z' })
  await second
  assert.deepEqual(harness.notifications, ['当前图纸已在其他窗口更新'])

  harness.pending[0].resolve({ projectId: 'project-a', revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' })
  await first
  assert.equal(harness.notifications.length, 1)
})

test('discards storage-event results after deletion, context changes, or parser failure', async () => {
  const deleted = createProjectStorageChangeHarness()
  const beforeDelete = deleted.handleProjectStorageChange(storageEvent(deleted, '{"revision":2}'))
  await deleted.handleProjectStorageChange(storageEvent(deleted, null))
  deleted.pending[0].resolve({ projectId: 'project-a', revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' })
  await beforeDelete
  assert.deepEqual(deleted.notifications, [])

  for (const mutateContext of [
    refs => { refs.workspaceId.value = 'workspace-b' },
    refs => { refs.projectId.value = 'project-b' },
    (refs, harness) => harness.invalidateProjectStorageChanges(),
    refs => { refs.workspaceSwitchPending.value = true },
    (refs, harness) => harness.setComponentLifecycleActive(false)
  ]) {
    const stale = createProjectStorageChangeHarness()
    const request = stale.handleProjectStorageChange(storageEvent(stale, '{"revision":2}'))
    mutateContext(stale.refs, stale)
    stale.pending[0].resolve({ projectId: 'project-a', revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' })
    await request
    assert.deepEqual(stale.notifications, [])
  }

  const failed = createProjectStorageChangeHarness()
  const request = failed.handleProjectStorageChange(storageEvent(failed, 'invalid'))
  failed.pending[0].reject(new SyntaxError('invalid JSON'))
  await request
  assert.deepEqual(failed.notifications, [])
})

function createProjectCacheHarness() {
  const source = section('let projectCacheGeneration = 0', 'function nextProjectSavePayload')
  const pending = []
  const writes = []
  const removals = []
  let remembered = 0
  const refs = {
    workspaceId: { value: 'workspace-a' },
    projectStorageKey: { value: 'tc2d-project:workspace-a' },
    projectId: { value: 'project-a' }
  }
  const localStorage = {
    setItem(key, value) { writes.push({ key, value }) },
    removeItem(key) { removals.push(key) }
  }
  const encodeBoundedJsonText = (data, options) => new Promise((resolve, reject) => {
    pending.push({ data, options, resolve, reject })
  })
  const createHarness = new Function(
    'encodeBoundedJsonText',
    'workspaceId',
    'projectStorageKey',
    'projectId',
    'storageKeyForWorkspace',
    'localStorage',
    'rememberWorkspace',
    'MAX_LOCAL_PROJECT_CACHE_CHARS',
    'documentChangeVersion',
    'componentLifecycleActive',
    `${source}\nreturn { cacheProjectSnapshot, invalidateProjectCacheTasks, setComponentLifecycleActive(value) { componentLifecycleActive = Boolean(value) }, advanceDocumentVersion() { documentChangeVersion += 1 } }`
  )
  return {
    ...createHarness(
      encodeBoundedJsonText,
      refs.workspaceId,
      refs.projectStorageKey,
      refs.projectId,
      workspace => `tc2d-project:${workspace}`,
      localStorage,
      () => { remembered += 1 },
      32,
      0,
      true
    ),
    pending,
    refs,
    writes,
    removals,
    remembered: () => remembered
  }
}

test('prevents stale project-cache encoders from overwriting a newer generation or workspace', async () => {
  const latest = createProjectCacheHarness()
  const first = latest.cacheProjectSnapshot({ projectId: 'project-a', value: 'old' })
  const second = latest.cacheProjectSnapshot({ projectId: 'project-a', value: 'new' })
  latest.pending[0].resolve({ tooLarge: false, text: '{"value":"old"}' })
  latest.pending[1].resolve({ tooLarge: false, text: '{"value":"new"}' })
  assert.equal(await first, false)
  assert.equal(await second, true)
  assert.deepEqual(latest.writes, [{ key: 'tc2d-project:workspace-a', value: '{"value":"new"}' }])
  assert.equal(latest.remembered(), 1)

  const switched = createProjectCacheHarness()
  const delayed = switched.cacheProjectSnapshot({ projectId: 'project-a' })
  switched.refs.workspaceId.value = 'workspace-b'
  switched.refs.projectStorageKey.value = 'tc2d-project:workspace-b'
  switched.refs.projectId.value = 'project-b'
  switched.pending[0].resolve({ tooLarge: false, text: '{"projectId":"project-a"}' })
  assert.equal(await delayed, false)
  assert.deepEqual(switched.writes, [])

  const edited = createProjectCacheHarness()
  const beforeEdit = edited.cacheProjectSnapshot({ projectId: 'project-a' })
  edited.advanceDocumentVersion()
  edited.pending[0].resolve({ tooLarge: false, text: '{"projectId":"project-a"}' })
  assert.equal(await beforeEdit, false)
  assert.deepEqual(edited.writes, [])

  const unmounted = createProjectCacheHarness()
  const afterUnmount = unmounted.cacheProjectSnapshot({ projectId: 'project-a' })
  unmounted.setComponentLifecycleActive(false)
  assert.equal(unmounted.pending[0].options.isCancelled(), true)
  unmounted.pending[0].resolve({ tooLarge: false, text: '{"projectId":"project-a"}' })
  assert.equal(await afterUnmount, false)
  assert.deepEqual(unmounted.writes, [])
})

test('uses direct bounded handling when a serialized project is already available', () => {
  const small = createProjectCacheHarness()
  assert.equal(small.cacheProjectSnapshot({ projectId: 'project-a' }, '{"small":true}'), true)
  assert.equal(small.pending.length, 0)
  assert.deepEqual(small.writes, [{ key: 'tc2d-project:workspace-a', value: '{"small":true}' }])

  const large = createProjectCacheHarness()
  assert.equal(large.cacheProjectSnapshot({ projectId: 'project-a' }, 'x'.repeat(33)), true)
  assert.equal(large.pending.length, 0)
  assert.deepEqual(large.writes, [])
  assert.deepEqual(large.removals, ['tc2d-project:workspace-a'])
})

test('bounds compatibility-cache encoding before committing saveLocal state', () => {
  const cache = section('let projectCacheGeneration = 0', 'function nextProjectSavePayload')
  const saveLocal = section('async function saveLocal', 'function resetToBlankProject')
  assert.match(cache, /encodeBoundedJsonText\(data, \{[\s\S]*?maxCharacterLength: MAX_LOCAL_PROJECT_CACHE_CHARS/)
  assert.doesNotMatch(cache, /serializeProjectData\(/)
  assert.match(saveLocal, /const encoded = await encodeProjectCacheSnapshot\(data, cacheTarget\)/)
  assert.match(saveLocal, /if \(!writeProjectCacheSnapshot\(cacheTarget, encoded\)\) return false/)
  assert.doesNotMatch(saveLocal, /serializeProjectData\(/)
  assert.ok(saveLocal.indexOf('await encodeProjectCacheSnapshot') < saveLocal.indexOf('projectRevision.value = nextRevision'))
  assert.match(section('function resetDocumentSession()', 'async function applyProject'), /invalidateProjectCacheTasks\(\)/)
  assert.match(appSource.slice(appSource.indexOf('onUnmounted(() =>')), /componentLifecycleActive = false[\s\S]*?invalidateProjectCacheTasks\(\)/)
})

test('keeps the latest failed workspace snapshot in memory', () => {
  const persist = section('async function persistWorkspacePaperSessions', 'function scheduleWorkspaceSessionPersistence')
  assert.match(persist, /workspacePaperSessions\.beginSave\(workspace\)/)
  assert.match(persist, /current\.sessions\.some\(session => session\.customHandle\)/)
  assert.match(persist, /workspaceSessionSnapshot\(workspace, current, false\)/)
  assert.match(persist, /workspaceSessionSaveQueue\.save\(workspace, snapshot, fallbackSnapshot, \{/)
  assert.match(persist, /isFresh: \(\) => workspacePaperSessions\.isSaveCurrent\(workspace, saveVersion\)/)
  assert.match(persist, /if \(result\.stale\) return false/)
  assert.match(persist, /return workspacePaperSessions\.completeSave\(workspace, saveVersion\)/)
  assert.ok(persist.indexOf('if (result.stale)') < persist.indexOf('if (!result.ok)'))
  assert.ok(persist.indexOf('if (!result.ok)') < persist.indexOf('completeSave'))

  const prepareRestore = section('async function preparePersistedWorkspaceSession', 'async function restoreWorkspacePaperSessions()')
  assert.match(prepareRestore, /isChunkedWorkspaceSessionRecord\(record\)/)
  assert.match(prepareRestore, /projectJsonParser\.parseAndPrepareWorkspaceSession\([\s\S]*?createWorkspaceSessionRestoreSource\(record\)/)
  assert.match(prepareRestore, /prepareWorkspaceSessionSnapshotAsync\(record, workspace, data => projectJsonParser\.prepare\(data\)\)/)

  const restore = section('async function restoreWorkspacePaperSessions()', 'function cacheProjectSnapshot')
  assert.match(restore, /workspaceSessionStore\.loadRecord\(workspace\)/)
  assert.doesNotMatch(restore, /workspaceSessionStore\.load\(workspace\)/)
  assert.match(restore, /const restoreGeneration = \+\+workspaceSessionRestoreGeneration/)
  assert.match(restore, /await preparePersistedWorkspaceSession[\s\S]*?if \(!isCurrent\(\)\) return false[\s\S]*?if \(!prepared\)/)
  assert.match(restore, /rewritePersistedRecord = prepared\.sanitized \|\| !isChunkedWorkspaceSessionRecord\(restored\.value\)/)
  assert.match(restore, /if \(rewritePersistedRecord\) void persistWorkspacePaperSessions\(workspace, cached\)/)
  assert.match(restore, /workspacePaperSessions\.delete\(workspace\)[\s\S]*?workspaceSessionStore\.remove\(workspace\)/)
  assert.ok(restore.indexOf('await restorePaperSession(target, isCurrent)') < restore.indexOf('paperSessions.value = cached.sessions'))
})

test('runs automatic workspace persistence only through a cancellable idle gate', () => {
  const schedule = section('function cancelScheduledWorkspaceSessionPersistence()', 'async function storeWorkspacePaperSessions()')
  assert.match(schedule, /workspaceSessionIdleTask\.cancel\(\)/)
  assert.match(schedule, /workspacePaperSessions\.markDirty\(scheduledWorkspace\)/)
  assert.match(schedule, /workspaceSessionIdleTask\.schedule\(deadline =>/)
  assert.match(schedule, /navigator\?\.scheduling\?\.isInputPending/)
  assert.match(schedule, /operation\.value \|\| interactionCommitBarrier\.state\.active/)
  assert.match(schedule, /workspaceSessionPersistenceBlocked\(\) \|\| !workspaceSessionHasIdleBudget\(deadline\)/)
  assert.ok(schedule.indexOf('workspaceSessionIdleTask.schedule') < schedule.indexOf('void persistWorkspacePaperSessions(scheduledWorkspace)'))

  const explicitStore = section('async function storeWorkspacePaperSessions()', 'async function restoreWorkspacePaperSessions()')
  assert.match(explicitStore, /cancelScheduledWorkspaceSessionPersistence\(\)/)
  assert.match(explicitStore, /return persistWorkspacePaperSessions\(workspaceId\.value\)/)

  const customSave = section('async function writeCustomDrawing', 'async function saveDrawingAsCustomFile')
  const projectSave = section('async function saveDrawingToProjectDirectory', 'function saveDrawing()')
  for (const explicitSave of [customSave, projectSave]) {
    assert.match(explicitSave, /await storeWorkspacePaperSessions\(\)/)
    assert.doesNotMatch(explicitSave, /void persistWorkspacePaperSessions\(\)/)
  }
})

test('blocks editor and paper interactions while a workspace restore is pending', () => {
  assert.match(appSource, /const workspaceSwitchPending = ref\(false\)/)
  const switchWorkspace = section('async function switchWorkspace()', 'function handleProjectStorageChange')
  assert.match(switchWorkspace, /if \(workspaceSwitchPending\.value\) return/)
  assert.match(switchWorkspace, /workspaceSwitchPending\.value = true/)
  assert.match(switchWorkspace, /await settleWorkspaceSwitchInteractions\(\)/)
  assert.match(switchWorkspace, /finally \{[\s\S]*?workspaceSwitchPending\.value = false/)

  const keydown = section('function keydown(e)', '// 其他响应式数据')
  assert.match(keydown, /if \(workspaceSwitchPending\.value\) \{[\s\S]*?overlayBlocksEditorShortcut\(e, false\)[\s\S]*?return/)
  assert.match(appSource, /class="app-shell" :inert="workspaceSwitchPending" :aria-busy="workspaceSwitchPending"/)
  assert.match(appSource, /v-if="workspaceSwitchPending" class="geometry-commit-shield workspace-switch-shield" role="status"/)

  const settleInteractions = section('async function settleWorkspaceSwitchInteractions()', 'async function switchWorkspace()')
  for (const boundary of ['endPolylineStartPointDrag()', 'cancelPendingCanvasZoom()', 'finishCanvasScrollInteraction()', 'setConnectionAnchor(null)', 'pointerUp()', 'interactionCommitBarrier.whenIdle()', 'workspaceAsyncOperationBarrier.whenIdle()']) {
    assert.match(settleInteractions, new RegExp(boundary.replace(/[().]/g, '\\$&')))
  }
  const pointerMove = section('function pointerMove(e)', 'function applyPointerMove()')
  const applyPointerMove = section('function applyPointerMove()', 'function releasePointerOperationBindings()')
  const polylineMove = section('function movePolylineStartPoint(e)', 'function endPolylineStartPointDrag(e)')
  assert.match(pointerMove, /workspaceSwitchPending\.value[\s\S]*?pointerUp\(\)/)
  assert.match(applyPointerMove, /workspaceSwitchPending\.value\) return/)
  assert.match(polylineMove, /workspaceSwitchPending\.value[\s\S]*?endPolylineStartPointDrag\(\)/)

  const mounted = section('onMounted(async () =>', 'onUnmounted(() =>')
  assert.match(mounted, /workspaceSwitchPending\.value = true[\s\S]*?restoreWorkspacePaperSessions\(\)[\s\S]*?finally \{[\s\S]*?workspaceSwitchPending\.value = false/)
})

test('detaches only confirmed missing project files', () => {
  const remove = section('async function deleteProjectDrawing', 'async function applyExternalDrawingFile')
  assert.match(remove, /const refreshed = await refreshDrawingFiles\(\)/)
  assert.match(remove, /let confirmedMissing = error\?\.status === 404/)
  assert.match(remove, /drawingRepository\.exists\(entry\.name, backendRequestContext\(\)\)/)
  assert.doesNotMatch(remove, /refreshed[\s\S]*?!drawingFiles\.value\.some/)
  assert.match(remove, /if \(confirmedMissing\)[\s\S]*?detachProjectDrawingSessions\(entry\.name\)/)
  assert.match(appSource, /for \(const \[cachedWorkspaceId, cached\] of \[\.\.\.workspacePaperSessions\]\)/)

  const save = section('async function saveDrawingToProjectDirectory', 'function saveDrawing()')
  assert.match(save, /const missingTarget = Boolean\(existingTarget\)/)
  assert.match(save, /status === 412[\s\S]*?includes\('不存在'\)/)
  assert.match(save, /if \(missingTarget\)[\s\S]*?detachProjectDrawingSessions\(name\)/)
})

test('keeps the active paper session until its replacement is prepared successfully', () => {
  const remove = section('async function removePaperSession', 'function persistableProjectData')
  const restore = remove.indexOf('await restorePaperSession(nextSession)')
  const commit = remove.indexOf('paperSessions.value = remaining', restore)
  assert.ok(restore >= 0 && commit > restore)
  assert.equal(remove.slice(0, restore).includes("activePaperSessionId.value = ''"), false)
})

test('binds asynchronous media reads to the originating workspace, paper, project, and node', () => {
  const identity = section('function selectedNodeFileReadTarget', 'function uploadNodeImage')
  for (const field of ['workspace', 'paperSessionId', 'project', 'nodeId', 'node']) assert.match(identity, new RegExp(`\\b${field}\\b`))
  assert.match(identity, /Boolean\(target\?\.node\)/)
  assert.match(identity, /nodeIndex\.value\.get\(target\.nodeId\) === target\.node/)
  assert.match(identity, /componentLifecycleActive/)
  assert.match(identity, /workspaceAsyncOperationBarrier\.begin\(`/)
  assert.match(identity, /workspaceAsyncOperationBarrier\.end\(operationToken\)/)
  for (const event of ['reader.onload', 'reader.onerror', 'reader.onabort', 'reader.onloadend']) {
    assert.match(identity, new RegExp(event.replace('.', '\\.')))
  }

  const image = section('function uploadNodeImage', 'function restoreVideoUrlInput')
  assert.match(image, /if \(!file \|\| !targetId\) \{ e\.target\.value = ''; return \}/)
  assert.match(image, /file\.type\.startsWith\('image\/'\)/)
  assert.match(image, /file\.size > MAX_EMBEDDED_IMAGE_BYTES/)
  assert.match(image, /readNodeMediaFile\(file, target, \{/)
  assert.match(image, /field: 'imageUrl'/)

  const video = section('function uploadNodeVideo', 'function newFile')
  assert.match(video, /if \(!file \|\| !targetId\) \{ e\.target\.value = ''; return \}/)
  assert.match(video, /readNodeMediaFile\(file, target, \{/)
  assert.match(video, /type: 'video'/)
  assert.match(video, /field: 'videoUrl'/)
})

test('invalidates async mount work before teardown and preserves valid caches on parser disposal', () => {
  const mounted = section('onMounted(async () =>', 'onUnmounted(() =>')
  assert.match(mounted, /componentLifecycleActive = true/)
  assert.ok((mounted.match(/if \(!componentLifecycleActive\) return/g) || []).length >= 3)
  assert.ok(mounted.indexOf('if (!componentLifecycleActive) return', mounted.indexOf('await nextTick()')) > mounted.indexOf('await nextTick()'))

  const unmounted = appSource.slice(appSource.indexOf('onUnmounted(() =>'))
  assert.ok(unmounted.indexOf('componentLifecycleActive = false') < unmounted.indexOf("cancelPendingBundleWork('unmounted')"))
  assert.match(unmounted, /abortActiveNodeFileReaders\(\)/)
  assert.match(unmounted, /workspaceAsyncOperationBarrier\.dispose\(\)/)

  const restore = section('async function restoreStoredWorkspaceProject()', '// 同一浏览器')
  assert.match(restore, /const data = await projectJsonParser\.parseAndPrepare\(raw\)[\s\S]*?if \(!componentLifecycleActive\) return false[\s\S]*?applyProject\(data\)/)
  assert.match(restore, /if \(projectParsingWasDisposed\(error\)\) return false[\s\S]*?localStorage\.removeItem/)
})

test('offloads every project-open preparation while keeping save conflict reads raw', () => {
  const openProject = section('async function openProjectDrawing', 'function matchesProjectDrawingFile')
  const openExternal = section('async function applyExternalDrawingFile', 'function deletePaperSession')
  const restoreSessions = section('async function preparePersistedWorkspaceSession', 'function cacheProjectSnapshot')
  const restoreStored = section('async function restoreStoredWorkspaceProject()', '// 同一浏览器')
  const saveLocal = section('async function saveLocal', 'function resetToBlankProject')

  assert.match(openProject, /await projectJsonParser\.parseAndPrepare\(text, drawingTitleFromFile\(entry\.name\)\)/)
  assert.match(openExternal, /await projectJsonParser\.parseAndPrepare\(serialized, drawingTitleFromFile\(file\.name\)\)/)
  assert.match(restoreSessions, /projectJsonParser\.parseAndPrepareWorkspaceSession/)
  assert.match(restoreSessions, /prepareWorkspaceSessionSnapshotAsync[\s\S]*?projectJsonParser\.prepare\(data\)/)
  assert.match(restoreStored, /await projectJsonParser\.parseAndPrepare\(raw\)/)
  assert.match(saveLocal, /stored = await projectJsonParser\.parseHeader\(storedRaw\)/)
  assert.doesNotMatch(saveLocal, /projectJsonParser\.parse\(storedRaw\)/)
  assert.doesNotMatch(saveLocal, /parseAndPrepare\(storedRaw\)/)
  assert.match(section('async function handleProjectStorageChange', 'async function importJson'), /await projectJsonParser\.parseHeader\(e\.newValue\)/)
})

test('marks successful undo and redo results dirty for session recovery', () => {
  const undo = section('function undo()', 'function redo()')
  const redo = section('function redo()', 'let toastTimer')
  for (const historyAction of [undo, redo]) {
    assert.match(historyAction, /applyHistoryEntry\(entry\)[\s\S]*?scheduleWorkspaceSessionPersistence\(\)/)
  }
})

test('document reset clears the runtime gateway without referencing removed communication state', () => {
  const reset = section('function resetDocumentSession()', 'function applyProject')

  assert.match(reset, /runtimeGateway\.disconnect\(\)/)
  assert.match(reset, /clearRuntimeData\(\)/)
  assert.match(reset, /clearRuntimeData\(\)[\s\S]*?cancelAnimationFrame\(runtimeCanvasRenderFrame\)[\s\S]*?runtimeCanvasDirtyQueue\.clear\(\)/)
  assert.doesNotMatch(reset, /communication\.value/)
})

test('waits for deferred bundle and media operations before a workspace save', () => {
  const switchWorkspace = section('async function switchWorkspace()', 'function handleProjectStorageChange')
  assert.ok(switchWorkspace.indexOf('await settleWorkspaceSwitchInteractions()') < switchWorkspace.indexOf('await saveLocal'))

  const bundleCapture = section('function captureNodeBundleForAction', 'function instantiateNodeBundle')
  const bundleInsert = section('function instantiateNodeBundle', 'function groupSelectedNodes')
  assert.match(bundleCapture, /beginBundleAsyncOperation/)
  assert.match(bundleCapture, /operationToken/)
  assert.match(bundleInsert, /beginBundleAsyncOperation\('bundle-insert'\)/)
})

test('isolates editor shortcuts behind modal layers while allowing table save', () => {
  const keydown = section('function keydown(e)', '// 其他响应式数据')
  const customGuard = keydown.indexOf('if (customComponentDialog.value.show)')
  const readOnlyGuard = keydown.indexOf('if (buttonMessageDialog.value.show || tableCellViewer.value.show || drawingBrowserOpen.value || showPreview.value)')
  const saveShortcut = keydown.indexOf("if (commandKey && shortcutKey === 's')", readOnlyGuard)
  const tableGuard = keydown.indexOf('if (tableDataEditor.value.show) {', saveShortcut)
  assert.ok(customGuard < readOnlyGuard)
  assert.ok(readOnlyGuard < saveShortcut)
  assert.ok(saveShortcut < tableGuard)
  assert.match(keydown, /overlayBlocksEditorShortcut\(e, typing, true\)/)
  assert.match(keydown, /flushPendingDocumentEdits\(\)[\s\S]*?void saveDrawing\(\)/)

  for (const closer of ['closeButtonMessage()', 'closeTableCellViewer()', 'closeTableDataEditor()', 'drawingBrowserOpen.value = false', 'closePreview()']) {
    assert.match(keydown, new RegExp(closer.replace(/[().]/g, '\\$&')))
  }
})

test('suspends the fitted preview renderer and releases persistence timers', () => {
  assert.match(appSource, /ref="previewFitCanvas"[^>]*:active="previewCanvasRenderActive"/)
  const unmounted = appSource.slice(appSource.indexOf('onUnmounted(() =>'))
  assert.match(unmounted, /cancelScheduledWorkspaceSessionPersistence\(\)/)
  assert.match(unmounted, /workspaceSessionIdleTask\.dispose\(\)/)
})

test('shares the linear legacy drawing id allocator during project migration', () => {
  assert.match(projectPreparationSource, /import \{ allocateLegacyDrawingNodeIds \} from '\.\/legacyDrawingIds\.js'/)
  const start = projectPreparationSource.indexOf('function migrateDrawingsToPencilNodes')
  const end = projectPreparationSource.indexOf('function assertUniqueIds', start)
  const migration = projectPreparationSource.slice(start, end)
  assert.match(migration, /allocateLegacyDrawingNodeIds\(drawingsToMigrate, sourceNodes\)/)
  assert.doesNotMatch(migration, /while \(usedIds\.has/)
  assert.match(appSource, /import \{ clampCanvasDimension, createEntityId, drawingToPencilNode \} from '\.\/utils\/projectPreparation'/)
  assert.match(appSource, /drawingToPencilNode\(drawing, createEntityId\('node'\), stageWidth\.value, stageHeight\.value\)/)
})

test('clipboard cannot preserve or multiply transient drawing records', () => {
  const copy = section('function copySelected(options = {})', 'function cutSelected()')
  const paste = section('function pasteNode()', 'function align(mode)')
  const duplicate = section('function duplicate()', 'function closeNodeEditors')

  assert.ok(copy.indexOf('if (operation.value) pointerUp()') < copy.indexOf('if (!selectedEntity.value)'))
  assert.match(paste, /clipboardItem\.value\.kind === 'drawing'[\s\S]*?drawingToPencilNode\(drawing, createEntityId\('node'\), stageWidth\.value, stageHeight\.value\)/)
  assert.match(paste, /recordEntityInsertion\(\{ nodes: \[node\], edges: \[\], drawings: \[\] \}\)[\s\S]*?appendNodes\(node\)[\s\S]*?selectSingleNode\(insertedNode\)/)
  assert.doesNotMatch(paste, /appendDrawings\(drawing\)/)
  assert.match(duplicate, /selectedDrawing\.value[\s\S]*?drawingToPencilNode\(drawing, createEntityId\('node'\), stageWidth\.value, stageHeight\.value\)/)
  assert.match(duplicate, /recordEntityInsertion\(\{ nodes: \[node\], edges: \[\], drawings: \[\] \}\)[\s\S]*?appendNodes\(node\)[\s\S]*?selectSingleNode\(insertedNode\)/)
  assert.doesNotMatch(duplicate, /appendDrawings\(drawing\)/)
})
