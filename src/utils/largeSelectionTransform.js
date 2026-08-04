import {
  constrainNodeCollectionTranslation,
  finiteNumber,
  rotatedFrameBounds,
  transformNodeCollectionWithinStage
} from './editorGeometry.js'

function collectionBounds(items) {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const item of items || []) {
    const frame = rotatedFrameBounds(item)
    left = Math.min(left, frame.x)
    top = Math.min(top, frame.y)
    right = Math.max(right, frame.x + frame.w)
    bottom = Math.max(bottom, frame.y + frame.h)
  }
  return Number.isFinite(left)
    ? { x: left, y: top, w: Math.max(.1, right - left), h: Math.max(.1, bottom - top) }
    : null
}

function rotateItemsAt(items, centerX, centerY, degrees) {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return items.map(item => {
    const itemCenterX = finiteNumber(item.centerX, finiteNumber(item.x) + finiteNumber(item.w, 1) / 2)
    const itemCenterY = finiteNumber(item.centerY, finiteNumber(item.y) + finiteNumber(item.h, 1) / 2)
    const dx = itemCenterX - centerX
    const dy = itemCenterY - centerY
    const nextCenterX = centerX + dx * cos - dy * sin
    const nextCenterY = centerY + dx * sin + dy * cos
    return {
      ...item,
      x: nextCenterX - item.w / 2,
      y: nextCenterY - item.h / 2,
      rotate: Math.round((finiteNumber(item.rotate) + degrees) * 100) / 100
    }
  })
}

function constrainedRotation(items, spec) {
  const evaluate = degrees => {
    const rotated = rotateItemsAt(items, spec.cx, spec.cy, degrees)
    const translation = constrainNodeCollectionTranslation(
      rotated,
      0,
      0,
      spec.stageWidth,
      spec.stageHeight
    )
    return { items: rotated, translation }
  }
  let result = evaluate(spec.degrees)
  if (!result.translation.feasible) {
    let allowedScale = 0
    let blockedScale = 1
    for (let index = 1; index <= 32; index += 1) {
      const scale = index / 32
      if (!evaluate(spec.degrees * scale).translation.feasible) {
        blockedScale = scale
        break
      }
      allowedScale = scale
    }
    for (let index = 0; index < 40; index += 1) {
      const scale = (allowedScale + blockedScale) / 2
      if (evaluate(spec.degrees * scale).translation.feasible) allowedScale = scale
      else blockedScale = scale
    }
    result = evaluate(spec.degrees * allowedScale)
  }
  if (!result.translation.feasible) return { items: [], bounds: null, feasible: false }
  const { dx, dy } = result.translation
  const appliedItems = result.items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy }))
  return { items: appliedItems, bounds: collectionBounds(appliedItems), feasible: true }
}

export function largeSelectionPreviewBounds(sourceBounds, spec = {}) {
  if (!sourceBounds) return null
  if (spec.kind === 'move') {
    return {
      ...sourceBounds,
      x: sourceBounds.x + finiteNumber(spec.dx),
      y: sourceBounds.y + finiteNumber(spec.dy)
    }
  }
  if (spec.kind === 'resize') return { ...spec.targetBounds }
  if (spec.kind === 'rotate') {
    return rotatedFrameBounds({ ...sourceBounds, rotate: finiteNumber(spec.degrees) })
  }
  return { ...sourceBounds }
}

export function computeLargeSelectionTransform(items, spec = {}) {
  if (!Array.isArray(items) || !items.length) return { items: [], bounds: null, feasible: true }
  if (spec.kind === 'move') {
    const dx = finiteNumber(spec.dx)
    const dy = finiteNumber(spec.dy)
    const transformed = items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy }))
    return { items: transformed, bounds: collectionBounds(transformed), feasible: true }
  }
  if (spec.kind === 'resize') {
    return transformNodeCollectionWithinStage(
      items,
      spec.sourceBounds,
      spec.targetBounds,
      spec.stageWidth,
      spec.stageHeight,
      {
        maximumWidth: spec.maximumWidth,
        maximumHeight: spec.maximumHeight
      }
    )
  }
  if (spec.kind === 'rotate') return constrainedRotation(items, spec)
  const cloned = items.map(item => ({ ...item }))
  return { items: cloned, bounds: collectionBounds(cloned), feasible: true }
}
