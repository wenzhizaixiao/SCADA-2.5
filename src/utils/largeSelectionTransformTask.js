import {
  MAX_EDITOR_STAGE_SIZE,
  clampNumber,
  finiteNumber,
  nodeMinimumSize,
  normalizedVisualScale,
  rotatedFrameBounds,
  rotatedLocalScaleFactors,
  rotationScaleWeights
} from './editorGeometry.js'

const EPSILON = 1e-8

function normalizedRotation(value) {
  const rotation = finiteNumber(value, 0) % 360
  return rotation < 0 ? rotation + 360 : rotation
}

function createBoundsAccumulator() {
  return {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY
  }
}

function addVisualBounds(accumulator, item) {
  const frame = rotatedFrameBounds(item)
  accumulator.left = Math.min(accumulator.left, frame.x)
  accumulator.top = Math.min(accumulator.top, frame.y)
  accumulator.right = Math.max(accumulator.right, frame.x + frame.w)
  accumulator.bottom = Math.max(accumulator.bottom, frame.y + frame.h)
}

function finishBounds(accumulator, minimumExtent = false) {
  if (!Number.isFinite(accumulator.left)) return null
  const width = accumulator.right - accumulator.left
  const height = accumulator.bottom - accumulator.top
  return {
    x: accumulator.left,
    y: accumulator.top,
    w: minimumExtent ? Math.max(.1, width) : width,
    h: minimumExtent ? Math.max(.1, height) : height
  }
}

function stageDimension(value) {
  return Math.max(1, finiteNumber(value, MAX_EDITOR_STAGE_SIZE))
}

function axisTranslationBounds(minimum, maximum, stageSize) {
  const span = maximum - minimum
  const accessibleSize = Math.min(24, Math.max(0, span) / 2, stageSize / 2)
  const firstBoundary = accessibleSize - maximum
  const secondBoundary = stageSize - accessibleSize - minimum
  return {
    minimum: Math.min(firstBoundary, secondBoundary),
    maximum: Math.max(firstBoundary, secondBoundary)
  }
}

function createTranslationAccumulator(stageWidth, stageHeight) {
  return {
    stageWidth: stageDimension(stageWidth),
    stageHeight: stageDimension(stageHeight),
    minimumDx: Number.NEGATIVE_INFINITY,
    maximumDx: Number.POSITIVE_INFINITY,
    minimumDy: Number.NEGATIVE_INFINITY,
    maximumDy: Number.POSITIVE_INFINITY,
    grouped: new Set()
  }
}

function addTranslationCandidate(accumulator, item) {
  const groupId = String(item?.groupId || '').trim()
  if (groupId) {
    if (accumulator.grouped.has(groupId)) return
    accumulator.grouped.add(groupId)
  }
  const frame = rotatedFrameBounds(item)
  const x = axisTranslationBounds(frame.x, frame.x + frame.w, accumulator.stageWidth)
  const y = axisTranslationBounds(frame.y, frame.y + frame.h, accumulator.stageHeight)
  accumulator.minimumDx = Math.max(accumulator.minimumDx, x.minimum)
  accumulator.maximumDx = Math.min(accumulator.maximumDx, x.maximum)
  accumulator.minimumDy = Math.max(accumulator.minimumDy, y.minimum)
  accumulator.maximumDy = Math.min(accumulator.maximumDy, y.maximum)
}

function finishTranslation(accumulator) {
  let { minimumDx, maximumDx, minimumDy, maximumDy } = accumulator
  const feasible = minimumDx <= maximumDx + EPSILON && minimumDy <= maximumDy + EPSILON
  if (!feasible) return { dx: 0, dy: 0, feasible: false }
  if (minimumDx > maximumDx) minimumDx = maximumDx = (minimumDx + maximumDx) / 2
  if (minimumDy > maximumDy) minimumDy = maximumDy = (minimumDy + maximumDy) / 2
  return {
    dx: clampNumber(0, minimumDx, maximumDx),
    dy: clampNumber(0, minimumDy, maximumDy),
    feasible: true
  }
}

function finishTask(task, result) {
  task.result = result
  task.phase = 'done'
}

function startSimpleTransform(task, kind) {
  task.simpleKind = kind
  task.cursor = 0
  task.output = new Array(task.items.length)
  task.bounds = createBoundsAccumulator()
  task.phase = 'simple'
}

function advanceSimpleTransform(task) {
  if (task.cursor >= task.items.length) {
    finishTask(task, {
      items: task.output,
      bounds: finishBounds(task.bounds, true),
      feasible: true
    })
    return
  }
  const item = task.items[task.cursor]
  const transformed = task.simpleKind === 'move'
    ? { ...item, x: item.x + task.dx, y: item.y + task.dy }
    : { ...item }
  task.output[task.cursor] = transformed
  task.cursor += 1
  addVisualBounds(task.bounds, transformed)
}

function startRotationEvaluation(task, scale, mode, captureItems) {
  const rotation = task.rotation
  rotation.scale = scale
  rotation.mode = mode
  rotation.degrees = finiteNumber(task.spec.degrees) * scale
  rotation.cursor = 0
  rotation.translation = createTranslationAccumulator(task.spec.stageWidth, task.spec.stageHeight)
  rotation.evaluatedItems = captureItems ? new Array(task.items.length) : null
  task.phase = 'rotate-evaluate'
}

function startRotationFinalize(task, items, translation) {
  task.rotation.finalItems = items
  task.rotation.finalTranslation = translation
  task.rotation.cursor = 0
  task.rotation.bounds = createBoundsAccumulator()
  task.phase = 'rotate-finalize'
}

function continueRotationSearch(task, translation) {
  const rotation = task.rotation
  if (rotation.mode === 'requested') {
    if (translation.feasible) {
      startRotationFinalize(task, rotation.evaluatedItems, translation)
      return
    }
    rotation.allowedScale = 0
    rotation.blockedScale = 1
    rotation.sampleIndex = 1
    startRotationEvaluation(task, 1 / 32, 'sample', false)
    return
  }
  if (rotation.mode === 'sample') {
    if (translation.feasible) rotation.allowedScale = rotation.scale
    else rotation.blockedScale = rotation.scale
    if (!translation.feasible || rotation.sampleIndex >= 32) {
      rotation.binaryIndex = 0
      startRotationEvaluation(
        task,
        (rotation.allowedScale + rotation.blockedScale) / 2,
        'binary',
        false
      )
      return
    }
    rotation.sampleIndex += 1
    startRotationEvaluation(task, rotation.sampleIndex / 32, 'sample', false)
    return
  }
  if (rotation.mode === 'binary') {
    if (translation.feasible) rotation.allowedScale = rotation.scale
    else rotation.blockedScale = rotation.scale
    rotation.binaryIndex += 1
    if (rotation.binaryIndex < 40) {
      startRotationEvaluation(
        task,
        (rotation.allowedScale + rotation.blockedScale) / 2,
        'binary',
        false
      )
      return
    }
    startRotationEvaluation(task, rotation.allowedScale, 'final', true)
    return
  }
  if (!translation.feasible) {
    finishTask(task, { items: [], bounds: null, feasible: false })
    return
  }
  startRotationFinalize(task, rotation.evaluatedItems, translation)
}

function advanceRotationEvaluation(task) {
  const rotation = task.rotation
  if (rotation.cursor >= task.items.length) {
    continueRotationSearch(task, finishTranslation(rotation.translation))
    return
  }
  const item = task.items[rotation.cursor]
  const itemCenterX = finiteNumber(item.centerX, finiteNumber(item.x) + finiteNumber(item.w, 1) / 2)
  const itemCenterY = finiteNumber(item.centerY, finiteNumber(item.y) + finiteNumber(item.h, 1) / 2)
  const dx = itemCenterX - finiteNumber(task.spec.cx)
  const dy = itemCenterY - finiteNumber(task.spec.cy)
  const radians = rotation.degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const nextCenterX = finiteNumber(task.spec.cx) + dx * cos - dy * sin
  const nextCenterY = finiteNumber(task.spec.cy) + dx * sin + dy * cos
  const transformed = {
    ...item,
    x: nextCenterX - item.w / 2,
    y: nextCenterY - item.h / 2,
    rotate: Math.round((finiteNumber(item.rotate) + rotation.degrees) * 100) / 100
  }
  if (rotation.evaluatedItems) rotation.evaluatedItems[rotation.cursor] = transformed
  addTranslationCandidate(rotation.translation, transformed)
  rotation.cursor += 1
}

function advanceRotationFinalize(task) {
  const rotation = task.rotation
  if (rotation.cursor >= rotation.finalItems.length) {
    finishTask(task, {
      items: rotation.finalItems,
      bounds: finishBounds(rotation.bounds, true),
      feasible: true
    })
    return
  }
  const item = rotation.finalItems[rotation.cursor]
  item.x += rotation.finalTranslation.dx
  item.y += rotation.finalTranslation.dy
  addVisualBounds(rotation.bounds, item)
  rotation.cursor += 1
}

function startAspectScan(task, logRatio, returnMode) {
  const resize = task.resize
  resize.aspect = {
    logRatio,
    scaleX: Math.exp(logRatio),
    cursor: 0,
    bounds: createBoundsAccumulator(),
    returnMode
  }
  task.phase = 'resize-aspect'
}

function startResizeCandidates(task, scaleX, scaleY) {
  const resize = task.resize
  resize.scaleX = scaleX
  resize.scaleY = scaleY
  resize.cursor = 0
  resize.memberSizesFeasible = true
  resize.candidates = new Array(task.items.length)
  resize.bounds = createBoundsAccumulator()
  task.phase = 'resize-candidates'
}

function startResizeEvaluation(task, progress, mode) {
  const resize = task.resize
  resize.progress = progress
  resize.mode = mode
  resize.frame = {
    x: resize.source.x + (resize.target.x - resize.source.x) * progress,
    y: resize.source.y + (resize.target.y - resize.source.y) * progress,
    w: resize.source.w + (resize.target.w - resize.source.w) * progress,
    h: resize.source.h + (resize.target.h - resize.source.h) * progress
  }
  resize.nominalScaleX = resize.frame.w / resize.source.w
  resize.nominalScaleY = resize.frame.h / resize.source.h
  if (Math.abs(resize.nominalScaleX - resize.nominalScaleY) <= 1e-12) {
    startResizeCandidates(task, resize.nominalScaleX, resize.nominalScaleY)
    return
  }
  resize.targetLogAspect = Math.log(resize.frame.w / resize.frame.h)
  resize.initialLogRatio = Math.log(resize.nominalScaleX / resize.nominalScaleY)
  startAspectScan(task, resize.initialLogRatio, 'initial')
}

function continueWorldScaleSearch(task, bounds) {
  const resize = task.resize
  const aspect = resize.aspect
  const error = Math.log(bounds.w / bounds.h) - resize.targetLogAspect
  if (aspect.returnMode === 'initial') {
    resize.initialError = error
    if (Math.abs(error) <= 1e-12) {
      startResizeCandidates(task, resize.nominalScaleX, resize.nominalScaleY)
      return
    }
    resize.low = resize.initialLogRatio
    resize.high = resize.initialLogRatio
    resize.lowError = error
    resize.highError = error
    resize.expandStep = 1
    resize.expandIndex = 0
    continueWorldScaleExpansion(task)
    return
  }
  if (aspect.returnMode === 'expand-low') {
    resize.lowError = error
    if (resize.highError < 0) {
      resize.high = Math.min(40, resize.high + resize.expandStep)
      startAspectScan(task, resize.high, 'expand-high')
      return
    }
    finishWorldScaleExpansionIteration(task)
    return
  }
  if (aspect.returnMode === 'expand-high') {
    resize.highError = error
    finishWorldScaleExpansionIteration(task)
    return
  }
  if (aspect.returnMode === 'binary') {
    if (error < 0) resize.low = aspect.logRatio
    else resize.high = aspect.logRatio
    resize.worldBinaryIndex += 1
    if (resize.worldBinaryIndex < 40) {
      startAspectScan(task, (resize.low + resize.high) / 2, 'binary')
      return
    }
    startAspectScan(task, (resize.low + resize.high) / 2, 'unit')
    return
  }
  const ratio = Math.exp(aspect.logRatio)
  const uniformScale = resize.frame.w / bounds.w
  startResizeCandidates(task, ratio * uniformScale, uniformScale)
}

function finishWorldScaleExpansionIteration(task) {
  const resize = task.resize
  resize.expandStep *= 1.6
  resize.expandIndex += 1
  continueWorldScaleExpansion(task)
}

function continueWorldScaleExpansion(task) {
  const resize = task.resize
  if (resize.expandIndex >= 24 || (resize.lowError <= 0 && resize.highError >= 0)) {
    if (resize.lowError > 0 || resize.highError < 0) {
      startResizeCandidates(task, resize.nominalScaleX, resize.nominalScaleY)
      return
    }
    resize.worldBinaryIndex = 0
    startAspectScan(task, (resize.low + resize.high) / 2, 'binary')
    return
  }
  if (resize.lowError > 0) {
    resize.low = Math.max(-40, resize.low - resize.expandStep)
    startAspectScan(task, resize.low, 'expand-low')
    return
  }
  resize.high = Math.min(40, resize.high + resize.expandStep)
  startAspectScan(task, resize.high, 'expand-high')
}

function advanceAspectScan(task) {
  const resize = task.resize
  const aspect = resize.aspect
  if (aspect.cursor >= task.items.length) {
    continueWorldScaleSearch(task, finishBounds(aspect.bounds))
    return
  }
  const item = task.items[aspect.cursor]
  const minimum = nodeMinimumSize(item)
  const sourceWidth = Math.max(minimum.w, finiteNumber(item.w, minimum.w))
  const sourceHeight = Math.max(minimum.h, finiteNumber(item.h, minimum.h))
  const sourceCenterX = finiteNumber(item.x, resize.source.x) + sourceWidth / 2
  const sourceCenterY = finiteNumber(item.y, resize.source.y) + sourceHeight / 2
  const localScale = rotatedLocalScaleFactors(item.rotate, aspect.scaleX, 1)
  const width = sourceWidth * localScale.x
  const height = sourceHeight * localScale.y
  const centerX = (sourceCenterX - resize.source.x) * aspect.scaleX
  const centerY = sourceCenterY - resize.source.y
  const { parallel, cross } = rotationScaleWeights(item.rotate)
  const visualWidth = width * Math.sqrt(parallel) + height * Math.sqrt(cross)
  const visualHeight = width * Math.sqrt(cross) + height * Math.sqrt(parallel)
  aspect.bounds.left = Math.min(aspect.bounds.left, centerX - visualWidth / 2)
  aspect.bounds.top = Math.min(aspect.bounds.top, centerY - visualHeight / 2)
  aspect.bounds.right = Math.max(aspect.bounds.right, centerX + visualWidth / 2)
  aspect.bounds.bottom = Math.max(aspect.bounds.bottom, centerY + visualHeight / 2)
  aspect.cursor += 1
}

function advanceResizeCandidates(task) {
  const resize = task.resize
  if (resize.cursor >= task.items.length) {
    const candidateBounds = finishBounds(resize.bounds)
    resize.alignDx = resize.frame.x - candidateBounds.x
    resize.alignDy = resize.frame.y - candidateBounds.y
    resize.aligned = new Array(task.items.length)
    resize.translation = createTranslationAccumulator(task.spec.stageWidth, task.spec.stageHeight)
    resize.cursor = 0
    task.phase = 'resize-align'
    return
  }
  const item = task.items[resize.cursor]
  const minimum = nodeMinimumSize(item)
  const sourceWidth = Math.max(minimum.w, finiteNumber(item.w, minimum.w))
  const sourceHeight = Math.max(minimum.h, finiteNumber(item.h, minimum.h))
  const sourceCenterX = finiteNumber(item.x, resize.source.x) + sourceWidth / 2
  const sourceCenterY = finiteNumber(item.y, resize.source.y) + sourceHeight / 2
  const localScale = rotatedLocalScaleFactors(item.rotate, resize.scaleX, resize.scaleY)
  const rawWidth = sourceWidth * localScale.x
  const rawHeight = sourceHeight * localScale.y
  if (rawWidth < minimum.w - EPSILON || rawHeight < minimum.h - EPSILON || rawWidth > MAX_EDITOR_STAGE_SIZE + EPSILON || rawHeight > MAX_EDITOR_STAGE_SIZE + EPSILON) {
    resize.memberSizesFeasible = false
  }
  const width = clampNumber(rawWidth, minimum.w, MAX_EDITOR_STAGE_SIZE)
  const height = clampNumber(rawHeight, minimum.h, MAX_EDITOR_STAGE_SIZE)
  const centerX = resize.frame.x + (sourceCenterX - resize.source.x) * resize.scaleX
  const centerY = resize.frame.y + (sourceCenterY - resize.source.y) * resize.scaleY
  const hasVisualScale = Object.hasOwn(item, 'visualScaleX') || Object.hasOwn(item, 'visualScaleY')
  const candidate = {
    ...item,
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height,
    ...(hasVisualScale ? {
      visualScaleX: normalizedVisualScale(normalizedVisualScale(item.visualScaleX, sourceWidth) * width / sourceWidth, width),
      visualScaleY: normalizedVisualScale(normalizedVisualScale(item.visualScaleY, sourceHeight) * height / sourceHeight, height)
    } : {}),
    rotate: normalizedRotation(item.rotate)
  }
  resize.candidates[resize.cursor] = candidate
  addVisualBounds(resize.bounds, candidate)
  resize.cursor += 1
}

function advanceResizeAlignment(task) {
  const resize = task.resize
  if (resize.cursor >= resize.candidates.length) {
    resize.translationResult = finishTranslation(resize.translation)
    resize.output = resize.translationResult.feasible ? new Array(task.items.length) : resize.aligned
    resize.bounds = createBoundsAccumulator()
    resize.cursor = 0
    task.phase = 'resize-translate'
    return
  }
  const item = resize.candidates[resize.cursor]
  const aligned = { ...item, x: item.x + resize.alignDx, y: item.y + resize.alignDy }
  resize.aligned[resize.cursor] = aligned
  addTranslationCandidate(resize.translation, aligned)
  resize.cursor += 1
}

function continueResizeSearch(task, evaluation) {
  const resize = task.resize
  if (resize.mode === 'requested') {
    if (evaluation.feasible) {
      finishTask(task, { ...evaluation, limited: resize.targetSizeLimited })
      return
    }
    startResizeEvaluation(task, 0, 'initial')
    return
  }
  if (resize.mode === 'initial') {
    if (!evaluation.feasible) {
      finishTask(task, { ...evaluation, limited: true })
      return
    }
    resize.allowedProgress = 0
    resize.blockedProgress = 1
    resize.sampleIndex = 1
    startResizeEvaluation(task, 1 / 32, 'sample')
    return
  }
  if (resize.mode === 'sample') {
    if (evaluation.feasible) resize.allowedProgress = resize.progress
    else resize.blockedProgress = resize.progress
    if (!evaluation.feasible || resize.sampleIndex >= 32) {
      resize.limitBinaryIndex = 0
      startResizeEvaluation(task, (resize.allowedProgress + resize.blockedProgress) / 2, 'limit-binary')
      return
    }
    resize.sampleIndex += 1
    startResizeEvaluation(task, resize.sampleIndex / 32, 'sample')
    return
  }
  if (resize.mode === 'limit-binary') {
    if (evaluation.feasible) resize.allowedProgress = resize.progress
    else resize.blockedProgress = resize.progress
    resize.limitBinaryIndex += 1
    if (resize.limitBinaryIndex < 40) {
      startResizeEvaluation(task, (resize.allowedProgress + resize.blockedProgress) / 2, 'limit-binary')
      return
    }
    startResizeEvaluation(task, resize.allowedProgress, 'final')
    return
  }
  finishTask(task, { ...evaluation, limited: true })
}

function advanceResizeTranslation(task) {
  const resize = task.resize
  if (resize.cursor >= resize.aligned.length) {
    continueResizeSearch(task, {
      items: resize.output,
      bounds: finishBounds(resize.bounds),
      feasible: resize.memberSizesFeasible && resize.translationResult.feasible
    })
    return
  }
  const aligned = resize.aligned[resize.cursor]
  const transformed = resize.translationResult.feasible
    ? {
        ...aligned,
        x: aligned.x + resize.translationResult.dx,
        y: aligned.y + resize.translationResult.dy
      }
    : aligned
  if (resize.translationResult.feasible) resize.output[resize.cursor] = transformed
  addVisualBounds(resize.bounds, transformed)
  resize.cursor += 1
}

function initializeResize(task) {
  const sourceBounds = task.spec.sourceBounds
  const targetBounds = task.spec.targetBounds
  const source = {
    x: finiteNumber(sourceBounds?.x, 0),
    y: finiteNumber(sourceBounds?.y, 0),
    w: Math.max(.1, finiteNumber(sourceBounds?.w, 1)),
    h: Math.max(.1, finiteNumber(sourceBounds?.h, 1))
  }
  const maximumWidth = Math.max(source.w, .1, finiteNumber(task.spec.maximumWidth, MAX_EDITOR_STAGE_SIZE))
  const maximumHeight = Math.max(source.h, .1, finiteNumber(task.spec.maximumHeight, MAX_EDITOR_STAGE_SIZE))
  const requestedWidth = finiteNumber(targetBounds?.w, source.w)
  const requestedHeight = finiteNumber(targetBounds?.h, source.h)
  const target = {
    x: finiteNumber(targetBounds?.x, source.x),
    y: finiteNumber(targetBounds?.y, source.y),
    w: clampNumber(requestedWidth, .1, maximumWidth),
    h: clampNumber(requestedHeight, .1, maximumHeight)
  }
  task.resize = {
    source,
    target,
    targetSizeLimited: Math.abs(target.w - requestedWidth) > EPSILON || Math.abs(target.h - requestedHeight) > EPSILON
  }
  if (Math.abs(target.x - source.x) <= 1e-12 && Math.abs(target.y - source.y) <= 1e-12 && Math.abs(target.w - source.w) <= 1e-12 && Math.abs(target.h - source.h) <= 1e-12) {
    startSimpleTransform(task, 'resize-baseline')
    task.simpleLimited = task.resize.targetSizeLimited
    return
  }
  startResizeEvaluation(task, 1, 'requested')
}

export function createLargeSelectionTransformTask(items, spec = {}) {
  const normalizedItems = Array.isArray(items) ? items : []
  const task = { items: normalizedItems, spec, phase: 'initial', result: null }
  if (!normalizedItems.length) {
    finishTask(task, { items: [], bounds: null, feasible: true })
    return task
  }
  if (spec.kind === 'move') {
    task.dx = finiteNumber(spec.dx)
    task.dy = finiteNumber(spec.dy)
    startSimpleTransform(task, 'move')
  } else if (spec.kind === 'resize') {
    initializeResize(task)
  } else if (spec.kind === 'rotate') {
    task.rotation = {}
    startRotationEvaluation(task, 1, 'requested', true)
  } else {
    startSimpleTransform(task, 'clone')
  }
  return task
}

export function runLargeSelectionTransformTaskSlice(task, deadline) {
  if (!task || task.phase === 'done') return true
  let advanced = false
  while (!advanced || !deadline?.shouldYield?.()) {
    if (task.phase === 'simple') advanceSimpleTransform(task)
    else if (task.phase === 'rotate-evaluate') advanceRotationEvaluation(task)
    else if (task.phase === 'rotate-finalize') advanceRotationFinalize(task)
    else if (task.phase === 'resize-aspect') advanceAspectScan(task)
    else if (task.phase === 'resize-candidates') advanceResizeCandidates(task)
    else if (task.phase === 'resize-align') advanceResizeAlignment(task)
    else if (task.phase === 'resize-translate') advanceResizeTranslation(task)
    else throw new Error(`Unknown large selection transform phase: ${task.phase}`)
    advanced = true
    if (task.phase === 'done') {
      if (task.simpleLimited !== undefined) task.result.limited = task.simpleLimited
      return true
    }
  }
  return false
}
