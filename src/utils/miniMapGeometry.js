function finitePositive(value, fallback = 1) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function containedSpan(start, requestedSize, minimum, maximum, minimumVisibleSize) {
  const availableSize = Math.max(0, maximum - minimum)
  const naturalSize = clamp(Number(requestedSize) || 0, 0, availableSize)
  const naturalStart = clamp(Number(start) || 0, minimum, Math.max(minimum, maximum - naturalSize))
  const visibleSize = Math.min(availableSize, Math.max(naturalSize, minimumVisibleSize))
  const center = naturalStart + naturalSize / 2
  return {
    start: clamp(center - visibleSize / 2, minimum, Math.max(minimum, maximum - visibleSize)),
    size: visibleSize
  }
}

// 缩略图、视口框和点击导航必须共用同一变换，避免画面等比后交互仍按拉伸坐标计算。
export function miniMapTransform({ stageWidth, stageHeight, width, height, fitMode = 'contain', viewBox = null }) {
  const safeStageWidth = finitePositive(stageWidth)
  const safeStageHeight = finitePositive(stageHeight)
  const safeWidth = finitePositive(width)
  const safeHeight = finitePositive(height)
  const viewWidth = Number(viewBox?.w)
  const viewHeight = Number(viewBox?.h)
  if (Number.isFinite(viewWidth) && viewWidth > 0 && Number.isFinite(viewHeight) && viewHeight > 0) {
    const viewX = Number.isFinite(Number(viewBox?.x)) ? Number(viewBox.x) : 0
    const viewY = Number.isFinite(Number(viewBox?.y)) ? Number(viewBox.y) : 0
    const scaleX = safeWidth / viewWidth
    const scaleY = safeHeight / viewHeight
    return {
      stageWidth: safeStageWidth,
      stageHeight: safeStageHeight,
      width: safeWidth,
      height: safeHeight,
      scaleX,
      scaleY,
      offsetX: -viewX * scaleX,
      offsetY: -viewY * scaleY,
      contentWidth: safeStageWidth * scaleX,
      contentHeight: safeStageHeight * scaleY,
      viewBox: { x: viewX, y: viewY, w: viewWidth, h: viewHeight }
    }
  }
  let scaleX = safeWidth / safeStageWidth
  let scaleY = safeHeight / safeStageHeight
  let offsetX = 0
  let offsetY = 0

  if (fitMode === 'contain') {
    const scale = Math.min(scaleX, scaleY)
    scaleX = scale
    scaleY = scale
    offsetX = (safeWidth - safeStageWidth * scale) / 2
    offsetY = (safeHeight - safeStageHeight * scale) / 2
  }

  return {
    stageWidth: safeStageWidth,
    stageHeight: safeStageHeight,
    width: safeWidth,
    height: safeHeight,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    contentWidth: safeStageWidth * scaleX,
    contentHeight: safeStageHeight * scaleY
  }
}

export function miniMapViewportRect(transform, viewport, zoom = 1, minimumSize = 4) {
  const safeZoom = finitePositive(zoom)
  const contentRight = transform.offsetX + transform.contentWidth
  const contentBottom = transform.offsetY + transform.contentHeight
  const minimumVisibleSize = Math.max(1, Number(minimumSize) || 4)
  const horizontal = containedSpan(
    transform.offsetX + Number(viewport?.left || 0) / safeZoom * transform.scaleX,
    Number(viewport?.width || 0) / safeZoom * transform.scaleX,
    transform.offsetX,
    contentRight,
    minimumVisibleSize
  )
  const vertical = containedSpan(
    transform.offsetY + Number(viewport?.top || 0) / safeZoom * transform.scaleY,
    Number(viewport?.height || 0) / safeZoom * transform.scaleY,
    transform.offsetY,
    contentBottom,
    minimumVisibleSize
  )

  return {
    left: horizontal.start,
    top: vertical.start,
    width: horizontal.size,
    height: vertical.size
  }
}

export function miniMapWorldPoint(transform, point) {
  return {
    x: clamp((Number(point?.x || 0) - transform.offsetX) / transform.scaleX, 0, transform.stageWidth),
    y: clamp((Number(point?.y || 0) - transform.offsetY) / transform.scaleY, 0, transform.stageHeight)
  }
}
