export const MAX_EDITOR_STAGE_SIZE = 20000
export const OBJECT_ACCESS_TARGET_SIZE = 24

export function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function normalizedVisualScale(value, renderedSize) {
  const size = Math.max(0, finiteNumber(renderedSize, 0))
  const minimumScale = size ? Math.max(0.000001, size / MAX_EDITOR_STAGE_SIZE) : 0.000001
  const scale = Number(value)
  return clampNumber(Number.isFinite(scale) && scale > 0 ? scale : 1, minimumScale, 1000000)
}

function stageDimension(value) {
  return Math.max(1, finiteNumber(value, MAX_EDITOR_STAGE_SIZE))
}

function axisAccessibleSize(objectSize, stageSize) {
  return Math.min(OBJECT_ACCESS_TARGET_SIZE, Math.max(0, objectSize) / 2, stageSize / 2)
}

function axisPositionBounds(objectSize, stageSize) {
  const accessibleSize = axisAccessibleSize(objectSize, stageSize)
  return {
    minimum: accessibleSize - objectSize,
    maximum: stageSize - accessibleSize
  }
}

function normalizedRotation(value) {
  const rotation = finiteNumber(value, 0) % 360
  return rotation < 0 ? rotation + 360 : rotation
}

export function nodeMinimumSize(node = {}) {
  return { w: 1, h: node.type === 'lineShape' ? .1 : 1 }
}

function requestedNodeMinimumSize(node, options = {}) {
  const minimum = options.minimumIsAuthoritative ? { w: .1, h: .1 } : nodeMinimumSize(node)
  return {
    w: clampNumber(finiteNumber(options.minimumWidth, minimum.w), minimum.w, MAX_EDITOR_STAGE_SIZE),
    h: clampNumber(finiteNumber(options.minimumHeight, minimum.h), minimum.h, MAX_EDITOR_STAGE_SIZE)
  }
}

function rotationExtentCoefficients(rotation) {
  const radians = normalizedRotation(rotation) * Math.PI / 180
  return { cos: Math.abs(Math.cos(radians)), sin: Math.abs(Math.sin(radians)) }
}

export function rotationScaleWeights(rotation) {
  const { cos, sin } = rotationExtentCoefficients(rotation)
  return { parallel: cos * cos, cross: sin * sin }
}

export function rotatedLocalScaleFactors(rotation, worldScaleX, worldScaleY) {
  const scaleX = Math.max(0.000000001, finiteNumber(worldScaleX, 1))
  const scaleY = Math.max(0.000000001, finiteNumber(worldScaleY, 1))
  const { parallel, cross } = rotationScaleWeights(rotation)
  return {
    x: Math.exp(parallel * Math.log(scaleX) + cross * Math.log(scaleY)),
    y: Math.exp(cross * Math.log(scaleX) + parallel * Math.log(scaleY))
  }
}

export function rotatedFrameBounds(frame = {}) {
  const x = finiteNumber(frame?.x, 0)
  const y = finiteNumber(frame?.y, 0)
  const width = Math.max(.1, finiteNumber(frame?.w, 1))
  const height = Math.max(.1, finiteNumber(frame?.h, 1))
  const { cos, sin } = rotationExtentCoefficients(frame?.rotate)
  const visualWidth = width * cos + height * sin
  const visualHeight = width * sin + height * cos
  return {
    x: x + (width - visualWidth) / 2,
    y: y + (height - visualHeight) / 2,
    w: visualWidth,
    h: visualHeight
  }
}

export function normalizeNodeGeometry(node = {}, stageWidth = MAX_EDITOR_STAGE_SIZE, stageHeight = MAX_EDITOR_STAGE_SIZE, options = {}) {
  const widthLimit = stageDimension(stageWidth)
  const heightLimit = stageDimension(stageHeight)
  const minimum = requestedNodeMinimumSize(node, options)
  const minimumWidth = minimum.w
  const minimumHeight = minimum.h
  const maximumWidth = Math.max(minimumWidth, finiteNumber(options.maximumWidth, MAX_EDITOR_STAGE_SIZE))
  const maximumHeight = Math.max(minimumHeight, finiteNumber(options.maximumHeight, MAX_EDITOR_STAGE_SIZE))
  const rotation = normalizedRotation(node.rotate)
  const width = clampNumber(finiteNumber(node.w, minimumWidth), minimumWidth, maximumWidth)
  const height = clampNumber(finiteNumber(node.h, minimumHeight), minimumHeight, maximumHeight)
  let x = finiteNumber(node.x, 0)
  let y = finiteNumber(node.y, 0)
  if (options.constrainPosition !== false) {
    const visualBounds = rotatedFrameBounds({ x, y, w: width, h: height, rotate: rotation })
    const xBounds = axisPositionBounds(visualBounds.w, widthLimit)
    const yBounds = axisPositionBounds(visualBounds.h, heightLimit)
    const correctionX = clampNumber(visualBounds.x, xBounds.minimum, xBounds.maximum) - visualBounds.x
    const correctionY = clampNumber(visualBounds.y, yBounds.minimum, yBounds.maximum) - visualBounds.y
    if (Math.abs(correctionX) > 1e-8) x += correctionX
    if (Math.abs(correctionY) > 1e-8) y += correctionY
  }

  return {
    x,
    y,
    w: width,
    h: height,
    rotate: rotation
  }
}

function axisTranslationBounds(minimum, maximum, stageSize) {
  const span = maximum - minimum
  const accessibleSize = axisAccessibleSize(span, stageSize)
  const firstBoundary = accessibleSize - maximum
  const secondBoundary = stageSize - accessibleSize - minimum
  return {
    minimum: Math.min(firstBoundary, secondBoundary),
    maximum: Math.max(firstBoundary, secondBoundary)
  }
}

function collectionTranslationBounds(items, stageWidth, stageHeight) {
  const frames = items.map(item => rotatedFrameBounds(item))
  const minimumX = Math.min(...frames.map(frame => frame.x))
  const minimumY = Math.min(...frames.map(frame => frame.y))
  const maximumX = Math.max(...frames.map(frame => frame.x + frame.w))
  const maximumY = Math.max(...frames.map(frame => frame.y + frame.h))
  return {
    x: axisTranslationBounds(minimumX, maximumX, stageDimension(stageWidth)),
    y: axisTranslationBounds(minimumY, maximumY, stageDimension(stageHeight))
  }
}

function persistentBundleTranslationBounds(items, stageWidth, stageHeight) {
  return collectionTranslationBounds([items[0]], stageWidth, stageHeight)
}

function nodeCollectionBundleIndices(items, bundleAll = false) {
  const bundles = new Map()
  items.forEach((item, index) => {
    const groupId = String(item?.groupId || '').trim()
    const key = bundleAll ? 'bundle:all' : groupId ? `group:${groupId}` : `node:${index}`
    if (!bundles.has(key)) bundles.set(key, [])
    bundles.get(key).push(index)
  })
  return [...bundles.values()]
}

export function constrainTranslation(items, requestedDx, requestedDy, stageWidth, stageHeight) {
  if (!Array.isArray(items) || !items.length) return { dx: 0, dy: 0 }
  const bounds = collectionTranslationBounds(items, stageWidth, stageHeight)

  return {
    dx: clampNumber(finiteNumber(requestedDx, 0), bounds.x.minimum, bounds.x.maximum),
    dy: clampNumber(finiteNumber(requestedDy, 0), bounds.y.minimum, bounds.y.maximum)
  }
}

export function constrainNodeCollectionTranslation(items, requestedDx, requestedDy, stageWidth, stageHeight, options = {}) {
  if (!Array.isArray(items) || !items.length) return { dx: 0, dy: 0, feasible: true }
  let minimumDx = -Infinity
  let maximumDx = Infinity
  let minimumDy = -Infinity
  let maximumDy = Infinity
  for (const indices of nodeCollectionBundleIndices(items, options.bundleAll)) {
    const bounds = persistentBundleTranslationBounds(indices.map(index => items[index]), stageWidth, stageHeight)
    minimumDx = Math.max(minimumDx, bounds.x.minimum)
    maximumDx = Math.min(maximumDx, bounds.x.maximum)
    minimumDy = Math.max(minimumDy, bounds.y.minimum)
    maximumDy = Math.min(maximumDy, bounds.y.maximum)
  }
  const feasible = minimumDx <= maximumDx + 1e-8 && minimumDy <= maximumDy + 1e-8
  if (!feasible) return { dx: 0, dy: 0, feasible: false }
  if (minimumDx > maximumDx) minimumDx = maximumDx = (minimumDx + maximumDx) / 2
  if (minimumDy > maximumDy) minimumDy = maximumDy = (minimumDy + maximumDy) / 2
  return {
    dx: clampNumber(finiteNumber(requestedDx, 0), minimumDx, maximumDx),
    dy: clampNumber(finiteNumber(requestedDy, 0), minimumDy, maximumDy),
    feasible: true
  }
}

export function normalizeNodeCollectionGeometry(items, stageWidth = MAX_EDITOR_STAGE_SIZE, stageHeight = MAX_EDITOR_STAGE_SIZE, options = {}) {
  if (!Array.isArray(items) || !items.length) return []
  const geometries = items.map(item => normalizeNodeGeometry(item, stageWidth, stageHeight, { constrainPosition: false }))
  if (options.commonTranslation) {
    const frames = items.map((item, index) => ({ ...item, ...geometries[index] }))
    const translation = constrainNodeCollectionTranslation(frames, 0, 0, stageWidth, stageHeight, options)
    if (translation.feasible) {
      geometries.forEach(geometry => {
        geometry.x += translation.dx
        geometry.y += translation.dy
      })
      return geometries
    }
  }
  for (const indices of nodeCollectionBundleIndices(items, options.bundleAll)) {
    const frames = indices.map(index => geometries[index])
    const { dx, dy } = constrainTranslation([frames[0]], 0, 0, stageWidth, stageHeight)
    if (!dx && !dy) continue
    indices.forEach(index => {
      geometries[index].x += dx
      geometries[index].y += dy
    })
  }
  return geometries
}

function nodeCollectionVisualBounds(items) {
  const frames = items.map(item => rotatedFrameBounds(item))
  const left = Math.min(...frames.map(frame => frame.x))
  const top = Math.min(...frames.map(frame => frame.y))
  const right = Math.max(...frames.map(frame => frame.x + frame.w))
  const bottom = Math.max(...frames.map(frame => frame.y + frame.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function nodeCollectionVisualBoundsAtScale(items, source, scaleX, scaleY) {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const item of items) {
    const minimum = nodeMinimumSize(item)
    const sourceWidth = Math.max(minimum.w, finiteNumber(item.w, minimum.w))
    const sourceHeight = Math.max(minimum.h, finiteNumber(item.h, minimum.h))
    const sourceCenterX = finiteNumber(item.x, source.x) + sourceWidth / 2
    const sourceCenterY = finiteNumber(item.y, source.y) + sourceHeight / 2
    const localScale = rotatedLocalScaleFactors(item.rotate, scaleX, scaleY)
    const width = sourceWidth * localScale.x
    const height = sourceHeight * localScale.y
    const centerX = (sourceCenterX - source.x) * scaleX
    const centerY = (sourceCenterY - source.y) * scaleY
    const { parallel, cross } = rotationScaleWeights(item.rotate)
    const visualWidth = width * Math.sqrt(parallel) + height * Math.sqrt(cross)
    const visualHeight = width * Math.sqrt(cross) + height * Math.sqrt(parallel)
    left = Math.min(left, centerX - visualWidth / 2)
    top = Math.min(top, centerY - visualHeight / 2)
    right = Math.max(right, centerX + visualWidth / 2)
    bottom = Math.max(bottom, centerY + visualHeight / 2)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function collectionWorldScaleForFrame(items, source, frame) {
  const nominalScaleX = frame.w / source.w
  const nominalScaleY = frame.h / source.h
  if (Math.abs(nominalScaleX - nominalScaleY) <= 1e-12) {
    return { x: nominalScaleX, y: nominalScaleY }
  }

  const targetLogAspect = Math.log(frame.w / frame.h)
  const aspectError = logRatio => {
    const ratio = Math.exp(logRatio)
    const bounds = nodeCollectionVisualBoundsAtScale(items, source, ratio, 1)
    return Math.log(bounds.w / bounds.h) - targetLogAspect
  }
  const initialLogRatio = Math.log(nominalScaleX / nominalScaleY)
  const initialError = aspectError(initialLogRatio)
  if (Math.abs(initialError) <= 1e-12) return { x: nominalScaleX, y: nominalScaleY }

  let low = initialLogRatio
  let high = initialLogRatio
  let lowError = initialError
  let highError = initialError
  let step = 1
  for (let index = 0; index < 24 && (lowError > 0 || highError < 0); index += 1) {
    if (lowError > 0) {
      low = Math.max(-40, low - step)
      lowError = aspectError(low)
    }
    if (highError < 0) {
      high = Math.min(40, high + step)
      highError = aspectError(high)
    }
    step *= 1.6
  }
  if (lowError > 0 || highError < 0) return { x: nominalScaleX, y: nominalScaleY }

  for (let index = 0; index < 40; index += 1) {
    const middle = (low + high) / 2
    const error = aspectError(middle)
    if (error < 0) low = middle
    else high = middle
  }
  const ratio = Math.exp((low + high) / 2)
  const unitBounds = nodeCollectionVisualBoundsAtScale(items, source, ratio, 1)
  const uniformScale = frame.w / unitBounds.w
  return { x: ratio * uniformScale, y: uniformScale }
}

export function transformNodeCollectionWithinStage(items, sourceBounds, targetBounds, stageWidth, stageHeight, options = {}) {
  if (!Array.isArray(items) || !items.length) return { items: [], bounds: null, feasible: true, limited: false }
  const source = {
    x: finiteNumber(sourceBounds?.x, 0),
    y: finiteNumber(sourceBounds?.y, 0),
    w: Math.max(.1, finiteNumber(sourceBounds?.w, 1)),
    h: Math.max(.1, finiteNumber(sourceBounds?.h, 1))
  }
  const maximumWidth = Math.max(source.w, .1, finiteNumber(options.maximumWidth, MAX_EDITOR_STAGE_SIZE))
  const maximumHeight = Math.max(source.h, .1, finiteNumber(options.maximumHeight, MAX_EDITOR_STAGE_SIZE))
  const requestedWidth = finiteNumber(targetBounds?.w, source.w)
  const requestedHeight = finiteNumber(targetBounds?.h, source.h)
  const target = {
    x: finiteNumber(targetBounds?.x, source.x),
    y: finiteNumber(targetBounds?.y, source.y),
    w: clampNumber(requestedWidth, .1, maximumWidth),
    h: clampNumber(requestedHeight, .1, maximumHeight)
  }
  const targetSizeLimited = Math.abs(target.w - requestedWidth) > 1e-8 || Math.abs(target.h - requestedHeight) > 1e-8
  if (Math.abs(target.x - source.x) <= 1e-12 && Math.abs(target.y - source.y) <= 1e-12 && Math.abs(target.w - source.w) <= 1e-12 && Math.abs(target.h - source.h) <= 1e-12) {
    const baselineItems = items.map(item => ({ ...item }))
    return { items: baselineItems, bounds: nodeCollectionVisualBounds(baselineItems), feasible: true, limited: targetSizeLimited }
  }
  const evaluate = progress => {
    const frame = {
      x: source.x + (target.x - source.x) * progress,
      y: source.y + (target.y - source.y) * progress,
      w: source.w + (target.w - source.w) * progress,
      h: source.h + (target.h - source.h) * progress
    }
    const worldScale = collectionWorldScaleForFrame(items, source, frame)
    const scaleX = worldScale.x
    const scaleY = worldScale.y
    let memberSizesFeasible = true
    const candidates = items.map(item => {
      const minimum = nodeMinimumSize(item)
      const sourceWidth = Math.max(minimum.w, finiteNumber(item.w, minimum.w))
      const sourceHeight = Math.max(minimum.h, finiteNumber(item.h, minimum.h))
      const sourceCenterX = finiteNumber(item.x, source.x) + sourceWidth / 2
      const sourceCenterY = finiteNumber(item.y, source.y) + sourceHeight / 2
      const localScale = rotatedLocalScaleFactors(item.rotate, scaleX, scaleY)
      const rawWidth = sourceWidth * localScale.x
      const rawHeight = sourceHeight * localScale.y
      if (rawWidth < minimum.w - 1e-8 || rawHeight < minimum.h - 1e-8 || rawWidth > MAX_EDITOR_STAGE_SIZE + 1e-8 || rawHeight > MAX_EDITOR_STAGE_SIZE + 1e-8) {
        memberSizesFeasible = false
      }
      const width = clampNumber(rawWidth, minimum.w, MAX_EDITOR_STAGE_SIZE)
      const height = clampNumber(rawHeight, minimum.h, MAX_EDITOR_STAGE_SIZE)
      const centerX = frame.x + (sourceCenterX - source.x) * scaleX
      const centerY = frame.y + (sourceCenterY - source.y) * scaleY
      const hasVisualScale = Object.hasOwn(item, 'visualScaleX') || Object.hasOwn(item, 'visualScaleY')
      return {
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
    })
    const candidateBounds = nodeCollectionVisualBounds(candidates)
    const alignedCandidates = candidates.map(item => ({
      ...item,
      x: item.x + frame.x - candidateBounds.x,
      y: item.y + frame.y - candidateBounds.y
    }))
    const translation = constrainNodeCollectionTranslation(alignedCandidates, 0, 0, stageWidth, stageHeight)
    const transformed = translation.feasible
      ? alignedCandidates.map(item => ({ ...item, x: item.x + translation.dx, y: item.y + translation.dy }))
      : alignedCandidates
    return {
      items: transformed,
      bounds: nodeCollectionVisualBounds(transformed),
      feasible: memberSizesFeasible && translation.feasible
    }
  }

  const requested = evaluate(1)
  if (requested.feasible) return { ...requested, limited: targetSizeLimited }
  const initial = evaluate(0)
  if (!initial.feasible) return { ...initial, limited: true }

  let allowedProgress = 0
  let blockedProgress = 1
  const samples = 32
  for (let index = 1; index <= samples; index += 1) {
    const progress = index / samples
    if (!evaluate(progress).feasible) {
      blockedProgress = progress
      break
    }
    allowedProgress = progress
  }
  for (let index = 0; index < 40; index += 1) {
    const progress = (allowedProgress + blockedProgress) / 2
    if (evaluate(progress).feasible) allowedProgress = progress
    else blockedProgress = progress
  }
  return { ...evaluate(allowedProgress), limited: true }
}

export function resizeFrameWithinBounds(frame, direction, requestedDx, requestedDy, stageWidth, stageHeight, options = {}) {
  const widthLimit = stageDimension(stageWidth)
  const heightLimit = stageDimension(stageHeight)
  const minimum = requestedNodeMinimumSize(frame, options)
  const minimumWidth = minimum.w
  const minimumHeight = minimum.h
  const maximumWidth = Math.max(minimumWidth, finiteNumber(options.maximumWidth, MAX_EDITOR_STAGE_SIZE))
  const maximumHeight = Math.max(minimumHeight, finiteNumber(options.maximumHeight, MAX_EDITOR_STAGE_SIZE))
  const normalized = normalizeNodeGeometry({
    ...frame,
    w: Math.max(minimumWidth, finiteNumber(frame?.w, minimumWidth)),
    h: Math.max(minimumHeight, finiteNumber(frame?.h, minimumHeight))
  }, widthLimit, heightLimit, {
    minimumWidth,
    minimumHeight,
    minimumIsAuthoritative: options.minimumIsAuthoritative,
    maximumWidth,
    maximumHeight
  })
  const snapSize = Math.max(0, finiteNumber(options.snapSize, 0))
  const snapValue = value => snapSize ? Math.round(value / snapSize) * snapSize : value
  const dx = finiteNumber(requestedDx, 0)
  const dy = finiteNumber(requestedDy, 0)
  let left = normalized.x
  let top = normalized.y
  let right = normalized.x + normalized.w
  let bottom = normalized.y + normalized.h
  const axisFrameIsAccessible = (start, end, stageSize) => {
    const accessibleSize = axisAccessibleSize(end - start, stageSize)
    return end >= accessibleSize - 1e-8 && start <= stageSize - accessibleSize + 1e-8
  }
  const constrainResizeCoordinate = (current, requested, isAccessible) => {
    if (isAccessible(requested)) return requested
    if (!isAccessible(current)) return current
    let allowed = current
    let blocked = requested
    for (let index = 0; index < 48; index += 1) {
      const candidate = (allowed + blocked) / 2
      if (isAccessible(candidate)) allowed = candidate
      else blocked = candidate
    }
    return allowed
  }
  const resizeEnd = (start, end, delta, minimumSize, maximumSize, stageSize) => {
    const requested = clampNumber(snapValue(end + delta), start + minimumSize, start + maximumSize)
    return constrainResizeCoordinate(end, requested, value => axisFrameIsAccessible(start, value, stageSize))
  }
  const resizeStart = (start, end, delta, minimumSize, maximumSize, stageSize) => {
    const requested = clampNumber(snapValue(start + delta), end - maximumSize, end - minimumSize)
    return constrainResizeCoordinate(start, requested, value => axisFrameIsAccessible(value, end, stageSize))
  }

  const directionValue = String(direction || '')
  const horizontalSide = directionValue.includes('e') ? 1 : directionValue.includes('w') ? -1 : 0
  const verticalSide = directionValue.includes('s') ? 1 : directionValue.includes('n') ? -1 : 0
  if (options.lockAspectRatio && (horizontalSide || verticalSide)) {
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    const anchorX = horizontalSide ? (horizontalSide > 0 ? left : right) : centerX
    const anchorY = verticalSide ? (verticalSide > 0 ? top : bottom) : centerY
    let projectedScale
    if (horizontalSide && verticalSide) {
      const requestedMovingX = snapValue(horizontalSide > 0 ? right + dx : left + dx)
      const requestedMovingY = snapValue(verticalSide > 0 ? bottom + dy : top + dy)
      const requestedVectorX = requestedMovingX - anchorX
      const requestedVectorY = requestedMovingY - anchorY
      const sourceVectorX = horizontalSide * normalized.w
      const sourceVectorY = verticalSide * normalized.h
      projectedScale = (requestedVectorX * sourceVectorX + requestedVectorY * sourceVectorY)
        / (normalized.w * normalized.w + normalized.h * normalized.h)
    } else if (horizontalSide) {
      const requestedMovingX = snapValue(horizontalSide > 0 ? right + dx : left + dx)
      projectedScale = (requestedMovingX - anchorX) / (horizontalSide * normalized.w)
    } else {
      const requestedMovingY = snapValue(verticalSide > 0 ? bottom + dy : top + dy)
      projectedScale = (requestedMovingY - anchorY) / (verticalSide * normalized.h)
    }
    const minimumScale = Math.max(minimumWidth / normalized.w, minimumHeight / normalized.h)
    const maximumScale = Math.min(maximumWidth / normalized.w, maximumHeight / normalized.h)
    const requestedScale = clampNumber(projectedScale, minimumScale, maximumScale)
    const scaledFrame = scale => {
      const width = normalized.w * scale
      const height = normalized.h * scale
      return {
        x: horizontalSide ? (horizontalSide > 0 ? anchorX : anchorX - width) : centerX - width / 2,
        y: verticalSide ? (verticalSide > 0 ? anchorY : anchorY - height) : centerY - height / 2,
        w: width,
        h: height
      }
    }
    const frameIsAccessible = candidate => axisFrameIsAccessible(candidate.x, candidate.x + candidate.w, widthLimit)
      && axisFrameIsAccessible(candidate.y, candidate.y + candidate.h, heightLimit)
    const requestedFrame = scaledFrame(requestedScale)
    if (frameIsAccessible(requestedFrame)) return requestedFrame
    const initialFrame = scaledFrame(1)
    if (!frameIsAccessible(initialFrame)) return initialFrame
    let allowedProgress = 0
    let blockedProgress = 1
    for (let index = 0; index < 48; index += 1) {
      const progress = (allowedProgress + blockedProgress) / 2
      const scale = 1 + (requestedScale - 1) * progress
      if (frameIsAccessible(scaledFrame(scale))) allowedProgress = progress
      else blockedProgress = progress
    }
    return scaledFrame(1 + (requestedScale - 1) * allowedProgress)
  }

  if (directionValue.includes('e')) right = resizeEnd(left, right, dx, minimumWidth, maximumWidth, widthLimit)
  if (directionValue.includes('s')) bottom = resizeEnd(top, bottom, dy, minimumHeight, maximumHeight, heightLimit)
  if (directionValue.includes('w')) left = resizeStart(left, right, dx, minimumWidth, maximumWidth, widthLimit)
  if (directionValue.includes('n')) top = resizeStart(top, bottom, dy, minimumHeight, maximumHeight, heightLimit)

  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function resizeRotatedFrameWithinBounds(frame, direction, requestedDx, requestedDy, stageWidth, stageHeight, options = {}) {
  const widthLimit = stageDimension(stageWidth)
  const heightLimit = stageDimension(stageHeight)
  const maximumSize = MAX_EDITOR_STAGE_SIZE
  const minimum = requestedNodeMinimumSize(frame, options)
  const minimumWidth = minimum.w
  const minimumHeight = minimum.h
  const normalized = normalizeNodeGeometry({ ...frame, type: frame?.type }, widthLimit, heightLimit, { minimumWidth, minimumHeight })
  const { x, y, w: width, h: height, rotate: rotation } = normalized

  if (rotation < 1e-9 || Math.abs(rotation - 360) < 1e-9) {
    return resizeFrameWithinBounds({ ...frame, x, y, w: width, h: height }, direction, requestedDx, requestedDy, widthLimit, heightLimit, options)
  }

  const radians = rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = finiteNumber(requestedDx, 0)
  const dy = finiteNumber(requestedDy, 0)
  const localDx = dx * cos + dy * sin
  const localDy = -dx * sin + dy * cos
  const value = String(direction || '')
  const horizontalSide = value.includes('e') ? 1 : value.includes('w') ? -1 : 0
  const verticalSide = value.includes('s') ? 1 : value.includes('n') ? -1 : 0

  let nextWidth = width
  let nextHeight = height
  if (horizontalSide === 1) nextWidth = clampNumber(width + localDx, minimumWidth, maximumSize)
  if (horizontalSide === -1) nextWidth = clampNumber(width - localDx, minimumWidth, maximumSize)
  if (verticalSide === 1) nextHeight = clampNumber(height + localDy, minimumHeight, maximumSize)
  if (verticalSide === -1) nextHeight = clampNumber(height - localDy, minimumHeight, maximumSize)

  const requestedWidthDelta = nextWidth - width
  const requestedHeightDelta = nextHeight - height
  const centerDeltaX = (cos * horizontalSide * requestedWidthDelta - sin * verticalSide * requestedHeightDelta) / 2
  const centerDeltaY = (sin * horizontalSide * requestedWidthDelta + cos * verticalSide * requestedHeightDelta) / 2
  const requestedFrame = {
    x: x + centerDeltaX - requestedWidthDelta / 2,
    y: y + centerDeltaY - requestedHeightDelta / 2,
    w: nextWidth,
    h: nextHeight,
    rotate: rotation
  }
  const scaledFrame = scale => ({
    x: x + (requestedFrame.x - x) * scale,
    y: y + (requestedFrame.y - y) * scale,
    w: width + requestedWidthDelta * scale,
    h: height + requestedHeightDelta * scale,
    rotate: rotation
  })
  const frameIsAccessible = candidate => {
    const bounds = rotatedFrameBounds(candidate)
    const accessibleWidth = axisAccessibleSize(bounds.w, widthLimit)
    const accessibleHeight = axisAccessibleSize(bounds.h, heightLimit)
    return bounds.x + bounds.w >= accessibleWidth - 1e-8
      && bounds.x <= widthLimit - accessibleWidth + 1e-8
      && bounds.y + bounds.h >= accessibleHeight - 1e-8
      && bounds.y <= heightLimit - accessibleHeight + 1e-8
  }
  let scale = 1
  if (!frameIsAccessible(requestedFrame)) {
    let allowed = 0
    let blocked = 1
    for (let index = 0; index < 48; index += 1) {
      const candidate = (allowed + blocked) / 2
      if (frameIsAccessible(scaledFrame(candidate))) allowed = candidate
      else blocked = candidate
    }
    scale = allowed
  }
  const result = scaledFrame(scale)
  return { x: result.x, y: result.y, w: result.w, h: result.h }
}
