import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reactive, toRaw } from 'vue'
import { isImeCompositionEvent } from '../src/utils/keyboard.js'
import { cloneHistoryValue } from '../src/utils/historyPatches.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const editorModelSource = readFileSync(new URL('../src/models/editorModel.js', import.meta.url), 'utf8')
const brandMarkSource = readFileSync(new URL('../src/components/BrandMark.vue', import.meta.url), 'utf8')
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const nodeBundleSource = readFileSync(new URL('../src/utils/nodeBundleTransactions.js', import.meta.url), 'utf8')

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start + 1)
  assert.notEqual(start, -1, `${name} must exist`)
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`)
  return source.slice(start, end)
}

test('renders the code-defined brand as a complete double diamond', () => {
  assert.match(appSource, /const BRAND_NAME = '苔岑2D绘图'/)
  assert.match(appSource, /<BrandMark :label="BRAND_NAME"\s*\/>[\s\S]*\{\{ BRAND_NAME \}\}/)
  assert.doesNotMatch(appSource, /<Shapes\b/)
  assert.match(brandMarkSource, /viewBox="0 0 48 48"/)
  assert.match(brandMarkSource, /d="M24 2\.5 45\.5 24 24 45\.5 2\.5 24Z"/)
  assert.match(brandMarkSource, /class="brand-symbol__diamond" d="M24 12 36 24 24 36 12 24Z"/)
  assert.doesNotMatch(brandMarkSource, /<rect|<circle|brand-symbol__shapes/)
  assert.doesNotMatch(brandMarkSource, /rotate\(/)
})

test('asks for a name before committing a custom component', () => {
  const openDialog = functionBody(appSource, 'addSelectionToMyLibrary', 'closeCustomComponentDialog')
  const confirmDialog = functionBody(appSource, 'confirmCustomComponent', 'instantiateCustomComponent')

  assert.match(openDialog, /customComponentDialog\.value\s*=\s*\{[\s\S]*show:\s*true/)
  assert.doesNotMatch(openDialog, /\bcommit\(\)|customComponents\.value\.push/)
  assert.match(confirmDialog, /recordCustomComponentInsertion\(\[item\]\)[\s\S]*customComponents\.value\.push\(item\)/)
  assert.doesNotMatch(confirmDialog, /\bcommit\(\)|\b(snapshot|restore)\s*\(/)
  assert.match(appSource, /data-testid="custom-component-name"/)
  assert.match(appSource, /data-testid="confirm-custom-component"/)
})

test('clones editor entities without JSON serialization while isolating nested mutable data', () => {
  const media = `data:video/mp4;base64,${'A'.repeat(20 * 1024 * 1024)}`
  const source = reactive({
    id: 'template-node',
    videoUrl: media,
    signalColors: ['#111111', '#222222'],
    tableCells: [['A', 'B']],
    pencilPoints: [{ x: 0, y: 0 }]
  })
  const first = cloneHistoryValue(toRaw(source))
  const second = cloneHistoryValue(toRaw(source))

  assert.equal(first.videoUrl, media)
  assert.notStrictEqual(first.signalColors, source.signalColors)
  assert.notStrictEqual(first.signalColors, second.signalColors)
  assert.notStrictEqual(first.tableCells, source.tableCells)
  assert.notStrictEqual(first.tableCells[0], source.tableCells[0])
  assert.notStrictEqual(first.pencilPoints[0], source.pencilPoints[0])

  first.signalColors[0] = '#ffffff'
  first.tableCells[0][0] = 'changed'
  first.pencilPoints[0].x = 10
  assert.equal(source.signalColors[0], '#111111')
  assert.equal(source.tableCells[0][0], 'A')
  assert.equal(source.pencilPoints[0].x, 0)

  const cloneBoundary = functionBody(appSource, 'cloneEditorValue', 'nodeBundleBounds')
  assert.match(cloneBoundary, /cloneHistoryValue\(toRaw\(value\)\)/)
  assert.doesNotMatch(appSource, /JSON\.parse\(JSON\.stringify\(/)
  assert.match(appSource, /clone:\s*cloneEditorValue/)
  assert.match(nodeBundleSource, /cloneHistoryValue\(toRaw\(value\)\)/)
  assert.doesNotMatch(nodeBundleSource, /JSON\.parse\(JSON\.stringify\(/)
})

test('keeps custom component naming compatible with Chinese IME composition', () => {
  assert.equal(isImeCompositionEvent({ isComposing: true, key: 'Enter', keyCode: 13 }), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Process', keyCode: 0 }), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Enter', keyCode: 229 }), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Enter', which: 229 }), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Enter', target: { composing: true } }), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Enter', keyCode: 13 }), false)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Shift', keyCode: 16 }, true), true)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: 'Shift', keyCode: 16 }), false)
  assert.equal(isImeCompositionEvent({ isComposing: false, key: ' ', code: 'Space', ctrlKey: true }), false)

  const nameKeydown = functionBody(appSource, 'handleCustomComponentNameKeydown', 'confirmCustomComponent')
  const createNameKeydown = new Function(
    'isImeCompositionEvent',
    'customComponentNameComposing',
    'closeCustomComponentDialog',
    'confirmCustomComponent',
    `${nameKeydown}; return handleCustomComponentNameKeydown`
  )
  let closed = 0
  let confirmed = 0
  const handleNameKeydown = createNameKeydown(
    isImeCompositionEvent,
    { value: false },
    () => { closed += 1 },
    () => { confirmed += 1 }
  )
  const createEvent = (key, options = {}) => ({
    key,
    ...options,
    stopped: 0,
    prevented: 0,
    stopPropagation() { this.stopped += 1 },
    preventDefault() { this.prevented += 1 }
  })

  for (const event of [
    createEvent('Shift', { keyCode: 16 }),
    createEvent(' ', { code: 'Space', ctrlKey: true }),
    createEvent('Process', { keyCode: 229 }),
    createEvent('Enter', { isComposing: true })
  ]) {
    handleNameKeydown(event)
    assert.equal(event.stopped, 0, `${event.key} must keep native propagation`)
    assert.equal(event.prevented, 0, `${event.key} must keep native default behavior`)
  }
  assert.equal(closed, 0)
  assert.equal(confirmed, 0)

  const enter = createEvent('Enter')
  handleNameKeydown(enter)
  assert.deepEqual([enter.stopped, enter.prevented, confirmed], [1, 1, 1])
  const escape = createEvent('Escape')
  handleNameKeydown(escape)
  assert.deepEqual([escape.stopped, escape.prevented, closed], [1, 1, 1])

  assert.match(nameKeydown, /isImeCompositionEvent\(event, customComponentNameComposing\.value\)[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?event\.key !== 'Enter'[\s\S]*?event\.stopPropagation\(\)[\s\S]*?confirmCustomComponent\(\)/)
  const focusNameInput = functionBody(appSource, 'focusCustomComponentNameInput', 'addSelectionToMyLibrary')
  assert.match(focusNameInput, /nextTick\(\(\) => \{[\s\S]*?focus\(\{ preventScroll: true \}\)[\s\S]*?setSelectionRange\(0, input\.value\.length\)/)
  assert.doesNotMatch(focusNameInput, /requestAnimationFrame/)
  assert.match(appSource, /customComponentDialog\.value = \{[\s\S]*?show: true[\s\S]*?focusCustomComponentNameInput\(true\)/)
  assert.doesNotMatch(appSource, /customComponentNameInput\.value\?\.select\(\)/)
  assert.match(appSource, /function keydown\(e\)\s*\{\s*if \(isImeCompositionEvent\(e\)\) return/)
  assert.match(appSource, /data-testid="custom-component-name"[^>]*lang="zh-CN"[^>]*@compositionstart="customComponentNameComposing = true"[^>]*@compositionend="customComponentNameComposing = false"[^>]*@keydown="handleCustomComponentNameKeydown"/)
  assert.doesNotMatch(appSource, /data-testid="custom-component-name"[^>]*@keydown\.enter\.prevent/)
})

test('renders each saved component from its real nodes and edges', () => {
  assert.match(appSource, /class="my-component-preview"[\s\S]*<MiniMapPreview[^>]*:nodes="item\.nodes"[^>]*:edges="item\.edges"[^>]*fit-mode="contain"/)
  assert.match(appSource, /<MiniMapPreview[^>]*:nodes="item\.nodes"[^>]*:width="64"[^>]*:height="54"/)
  assert.match(enhancementCss, /\.my-component-preview\s*\{[^}]*width:\s*calc\(100% - 20px\);[^}]*height:\s*54px;[^}]*display:\s*grid;[^}]*pointer-events:\s*none;/)
  assert.match(enhancementCss, /\.my-component-preview canvas\s*\{[^}]*width:\s*64px\s*!important;[^}]*height:\s*auto\s*!important;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;/)
  assert.doesNotMatch(appSource, /item\.thumbnail|customComponentIcon\(item\)/)
})

test('opts custom previews into drawing real Chinese node text without changing the minimap default', () => {
  const customCard = appSource.match(/<MiniMapPreview[^>]*:nodes="item\.nodes"[^>]*\/>/)?.[0] || ''
  const customDialog = appSource.match(/<MiniMapPreview[^>]*:nodes="customComponentDialog\.bundle\.nodes"[^>]*\/>/)?.[0] || ''
  const defaultMiniMap = appSource.match(/<MiniMapPreview[^>]*:nodes="nodes"[^>]*\/>/)?.[0] || ''
  const textPlan = functionBody(miniMapSource, 'canvasTextDrawPlan', 'baselineCanvasTextLayout')
  const drawText = functionBody(miniMapSource, 'drawText', 'drawPencil')
  const drawNode = functionBody(miniMapSource, 'drawNode', 'drawEdges')

  assert.match(miniMapSource, /preferText:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/)
  assert.match(customCard, /\bprefer-text\b/)
  assert.match(customDialog, /\bprefer-text\b/)
  assert.doesNotMatch(defaultMiniMap, /\bprefer-text\b/)

  assert.match(textPlan, /const\s+(\w+)\s*=\s*props\.preferText\s*&&\s*node\.type\s*===\s*'text'/)
  assert.match(textPlan, /const text = String\(override\s*\?\?\s*node\.text\s*\?\?\s*''\)/)
  assert.match(drawText, /preparedTextLayout \? !text\.length : !text\.trim\(\)/)
  assert.match(drawText, /node\.type === 'text' && node\.textLayout === 'vertical'[\s\S]*?drawVerticalText\(ctx, text, width, height, fontSize, textAlign, baselineLayout\?\.columns \|\| drawLayout\?\.columns\)/)
  assert.match(miniMapSource, /function drawVerticalText\([\s\S]*?verticalTextColumns\(text, maxRows\)[\s\S]*?grapheme !== ' '\) ctx\.fillText/)
  assert.match(miniMapSource, /function canvasTextFont\([^)]*\)[\s\S]*?"Microsoft YaHei"[\s\S]*?sans-serif/)
  assert.match(drawText, /ctx\.fillText\(text,\s*x,\s*placement\.y\s*\?\?\s*height\s*\/\s*2,/)
  assert.match(drawNode, /node\.type[^\n]*'text'[\s\S]*?drawText\(ctx,\s*node,\s*layoutWidth,\s*layoutHeight,\s*effectiveScaleX,\s*effectiveScaleY,[\s\S]*?textLayout\)/)

  const preferredFlag = textPlan.match(/const\s+(\w+)\s*=\s*props\.preferText\s*&&\s*node\.type\s*===\s*'text'/)?.[1]
  assert.ok(preferredFlag, 'drawText must limit preferText to actual text nodes')
  const thresholdNumberPattern = '\\d+(?:\\.\\d+)?'
  const intermediateNumberPattern = `(?:${thresholdNumberPattern}|\\.\\d+)`
  const thresholdSource = `${textPlan}\n${drawText}`
  const thresholdPairs = [...thresholdSource.matchAll(new RegExp(`${preferredFlag}\\s*\\?\\s*(${thresholdNumberPattern})\\s*:\\s*(?:\\w+\\s*\\?\\s*${intermediateNumberPattern}\\s*:\\s*)?(${thresholdNumberPattern})`, 'g'))]
    .map(([, preferred, normal]) => [Number(preferred), Number(normal)])
  assert.ok(thresholdPairs.length >= 2, 'preferText must relax both size and font visibility thresholds')
  assert.ok(thresholdPairs.every(([preferred, normal]) => preferred < normal), 'preferred text thresholds must stay below the default minimap thresholds')
})

test('keeps the original two-column preview cards without losing actions', () => {
  assert.match(enhancementCss, /\.my-library\s*\{[^}]*padding:\s*10px;/)
  assert.match(enhancementCss, /\.my-component-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*7px;/)
  assert.match(enhancementCss, /\.my-component-item\s*\{[^}]*height:\s*118px;/)
  assert.match(enhancementCss, /@media \(max-width:\s*800px\)\s*\{\s*\.my-component-grid\s*\{[^}]*grid-template-columns:\s*1fr;/)
  assert.match(appSource, /class="my-component-item"[^>]*draggable="true"[^>]*role="button"[^>]*tabindex="0"[^>]*:title="`拖动或双击添加\$\{item\.name\}`"[^>]*@dragstart="dragStartCustomComponent\(\$event, item\.id\)"[^>]*@dblclick="instantiateCustomComponent\(item\.id\)"[^>]*@keydown\.enter\.prevent="instantiateCustomComponent\(item\.id\)"[^>]*@keydown\.space\.prevent="instantiateCustomComponent\(item\.id\)"/)
  assert.match(appSource, /<span><b>\{\{ item\.name \}\}<\/b><small>\{\{ item\.nodes\.length > 1/)
  assert.match(appSource, /<button type="button"[^>]*@pointerdown\.stop[^>]*@dblclick\.stop[^>]*@keydown\.enter\.stop="deleteCustomComponent\(item\.id\)"[^>]*@keydown\.space\.prevent\.stop="deleteCustomComponent\(item\.id\)"[^>]*@click\.stop="deleteCustomComponent\(item\.id\)"/)
  assert.match(appSource, /function configureLibraryDrag[\s\S]*?transfer\.setDragImage\(image, 22, 16\)/)
  assert.match(appSource, /function dragStartItem\(event, type\) \{ configureLibraryDrag\(event, 'shape', type, type\) \}/)
  assert.match(appSource, /function dragStartCustomComponent\(event, id\) \{ configureLibraryDrag\(event, 'application\/x-tc2d-custom-component', id\) \}/)
})

test('contains custom previews without changing the existing minimap default', () => {
  assert.match(miniMapSource, /fitMode:\s*\{[^}]*default:\s*'stretch'/)
  assert.match(miniMapSource, /import \{ miniMapTransform \} from '\.\.\/utils\/miniMapGeometry'/)
  assert.match(miniMapSource, /miniMapTransform\(\{[\s\S]*?stageWidth,[\s\S]*?stageHeight,[\s\S]*?width,[\s\S]*?height,[\s\S]*?fitMode: payload\.fitMode,[\s\S]*?viewBox: payload\.viewBox[\s\S]*?\}\)[\s\S]*const \{ scaleX, scaleY, offsetX, offsetY \} = transform/)
  assert.match(miniMapSource, /ctx\.translate\(offsetX, offsetY\)[\s\S]*ctx\.scale\(scaleX, scaleY\)/)
  assert.match(miniMapSource, /const visualScaleX = [^\n]*node\.visualScaleX[\s\S]*const visualScaleY = [^\n]*node\.visualScaleY/)
  assert.match(miniMapSource, /ctx\.scale\(visualScaleX, visualScaleY\)/)
  assert.match(miniMapSource, /renderRevision:\s*\{\s*type:\s*Number/)
  assert.match(miniMapSource, /const visualLineNode = \{ \.\.\.node, w: layoutWidth, h: layoutHeight \}[\s\S]*lineShapeBorderWidth\(visualLineNode\)/)
  assert.match(miniMapSource, /node\.borderStyle === 'solid'[\s\S]*lineShapeBodyInset\(visualLineNode\)[\s\S]*lineShapeBodyDashSegments\(visualLineNode\)[\s\S]*lineShapeInnerThickness\(visualLineNode\)/)
  assert.match(enhancementCss, /\.minimap-stage\s*>\s*\.minimap-preview\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/)
  assert.doesNotMatch(enhancementCss, /(?:^|\n)\.minimap-preview\s*\{[^}]*position:\s*absolute;/)
})

test('persists independent time icon visibility across every renderer', () => {
  assert.match(editorModelSource, /timeShowLeftIcon: true, timeShowRightIcon: true/)
  assert.match(editorModelSource, /normalized\.timeShowLeftIcon = source\.timeShowLeftIcon !== false/)
  assert.match(editorModelSource, /normalized\.timeShowRightIcon = source\.timeShowRightIcon !== false/)
  assert.match(appSource, /node\.timeShowLeftIcon, node\.timeShowRightIcon/)
  assert.match(appSource, /显示左侧图标[\s\S]*v-model="selected\.timeShowLeftIcon"[^>]*data-testid="time-left-icon-toggle"/)
  assert.match(appSource, /显示右侧图标[\s\S]*v-model="selected\.timeShowRightIcon"[^>]*data-testid="time-right-icon-toggle"/)
  assert.match(miniMapSource, /node\.type === 'time' && node\.timeShowLeftIcon !== false/)
  assert.match(enhancementCss, /\.form-time-visual\.hide-right-icon input::\-webkit-calendar-picker-indicator\s*\{\s*display:\s*none;/)
})

test('persists canvas objects, custom components, and paper settings through one project payload', () => {
  const project = functionBody(appSource, 'projectData', 'serializeProjectData')
  for (const field of [
    'nodes', 'edges', 'drawings', 'customComponents',
    'stageWidth', 'stageHeight', 'canvasBg', 'canvasBorderColor', 'canvasBorderWidth',
    'showGrid', 'gridColor', 'gridStyle', 'snap', 'gridSize',
    'lineColor', 'lineWidth', 'lineDash', 'lineStartMarker', 'lineEndMarker', 'lineAnchorMode'
  ]) assert.match(project, new RegExp(`\\b${field}:`), `projectData must include ${field}`)

  const apply = functionBody(appSource, 'applyProject', 'drawingFileName')
  assert.match(apply, /const runtime = await projectRuntimePreparer\.prepare\(data\)/)
  assert.match(apply, /installPreparedEntityCollections\(runtime\)/)
  assert.match(apply, /customComponents\.value = project\.customComponents/)
  assert.match(apply, /stageWidth\.value = project\.stageWidth/)
  assert.match(apply, /lineAnchorMode\.value = project\.lineAnchorMode/)
})

test('reopens an existing paper session from the disk file instead of stale memory', () => {
  const open = functionBody(appSource, 'openProjectDrawing', 'applyExternalDrawingFile')
  assert.match(open, /drawingRepository\.get\(entry\.name, backendRequestContext\(\)\)/)
  assert.match(open, /projectJsonParser\.parseAndPrepare\(text, drawingTitleFromFile\(entry\.name\)\)/)
  assert.doesNotMatch(open, /if \(openSession\)[\s\S]*?activatePaperSession\(openSession\.id\)[\s\S]*?return/)
  assert.match(open, /if \(openSession\)[\s\S]*?session\.id = openSession\.id[\s\S]*?paperSessions\.value = paperSessions\.value\.map/)
  assert.match(open, /applyProject\(data\)[\s\S]*?cacheProjectSnapshot\(data, text\)/)
})

test('deletes a project library file without discarding an open editing session', () => {
  const detach = functionBody(appSource, 'detachProjectDrawingSessions', 'deleteProjectDrawing')
  const remove = functionBody(appSource, 'deleteProjectDrawing', 'applyExternalDrawingFile')

  assert.match(remove, /磁盘文件将永久删除/)
  assert.match(remove, /window\.confirm\(`/)
  assert.match(remove, /drawingRepository\.delete\(entry\.name, entry\.etag, backendRequestContext\(\)\)/)
  assert.match(remove, /drawingFiles\.value = drawingFiles\.value\.filter[\s\S]*?detachProjectDrawingSessions\(entry\.name\)/)
  assert.match(remove, /await refreshDrawingFiles\(\)[\s\S]*?let confirmedMissing = error\?\.status === 404/)
  assert.match(remove, /drawingRepository\.exists\(entry\.name, backendRequestContext\(\)\)/)
  assert.match(remove, /if \(confirmedMissing\)[\s\S]*?detachProjectDrawingSessions\(entry\.name\)/)
  assert.match(detach, /currentDrawingFile\.value = \{ \.\.\.detachedFile \}/)
  assert.match(detach, /for \(const \[cachedWorkspaceId, cached\] of \[\.\.\.workspacePaperSessions\]\)/)
  assert.match(detach, /workspacePaperSessions\.markDirty\(cachedWorkspaceId\)/)
  assert.match(detach, /persistWorkspacePaperSessions\(cachedWorkspaceId, nextCached\)/)
  assert.match(appSource, /class="drawing-file-open"[^>]*@click="openProjectDrawing\(entry\)"/)
  assert.match(appSource, /class="drawing-file-delete"[^>]*@click\.stop="deleteProjectDrawing\(entry\)"/)
  assert.match(enhancementCss, /\.drawing-file-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 34px;/)
  assert.match(enhancementCss, /\.drawing-file-delete:hover:not\(:disabled\)\s*\{[^}]*color:\s*#c83e3e;/)
})

test('explains same-name saves separately from stale saved drawings', () => {
  const save = functionBody(appSource, 'saveDrawingToProjectDirectory', 'saveDrawing')

  assert.match(save, /create:\s*!existingTarget/)
  assert.match(save, /if \(conflict && !existingTarget\) await refreshDrawingFiles\(\)/)
  assert.match(save, /existingTarget[\s\S]*?无法按当前版本保存“\$\{name\}”[\s\S]*?图纸库中已存在“\$\{name\}”，同一位置不能保存两个同名图纸/)
  assert.doesNotMatch(save, /图纸已被修改或存在同名文件/)
  assert.match(appSource, /const nameConflict = unsavedProject[\s\S]*?drawingFilesLoaded\.value[\s\S]*?drawingNamesMatch\(entry\.name, projectTargetName, drawingNamesCaseSensitive\.value\)/)
  assert.match(appSource, /未保存 · 同名冲突/)
  assert.match(appSource, /未保存 · 同名目标/)
  assert.match(appSource, /另一个未保存图纸也将保存到“图纸库\/\$\{projectTargetName\}”/)
  assert.match(appSource, /targetName:\s*unsavedProject \? `图纸库\/\$\{projectTargetName\}` : \(file\?\.name \|\| ''\)/)
  assert.match(appSource, /未保存 · 名称未检查/)
  assert.match(appSource, /图纸库中已存在“\$\{projectTargetName\}”，请修改当前图纸名称，或先删除图纸库中的同名文件/)
  assert.match(appSource, /<em :class="\{ conflict: entry\.nameConflict \}" :title="entry\.statusTitle \|\| undefined">/)
  assert.match(enhancementCss, /\.paper-session-main em\.conflict\s*\{[^}]*color:\s*#b5483f;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;/)
})
