const BROWSER_ZOOM_LEVELS = Object.freeze([
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
  1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
])

function positiveNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function nearestBrowserZoom(value) {
  let nearest = 1
  let distance = Number.POSITIVE_INFINITY
  for (const level of BROWSER_ZOOM_LEVELS) {
    const nextDistance = Math.abs(level - value)
    if (nextDistance >= distance) continue
    nearest = level
    distance = nextDistance
  }
  return nearest
}

export function fullscreenPreviewScrollAxes({
  stageWidth,
  stageHeight,
  viewportWidth,
  viewportHeight
} = {}) {
  const contentWidth = positiveNumber(stageWidth)
  const contentHeight = positiveNumber(stageHeight)
  const availableWidth = positiveNumber(viewportWidth)
  const availableHeight = positiveNumber(viewportHeight)
  return {
    x: Boolean(availableWidth && contentWidth > availableWidth),
    y: Boolean(availableHeight && contentHeight > availableHeight)
  }
}

/**
 * 在尚未进入全屏时估算 Fullscreen API 的 CSS 视口尺寸。
 * 浏览器缩放会改变 innerWidth，却不会同步改变 screen.width；使用水平方向
 * 的 inner/outer 比例识别浏览器缩放档位，避免 90% 缩放时留下 10% 空白。
 */
export function resolveFullscreenViewportSize(metrics = {}) {
  const screenWidth = positiveNumber(metrics.screenWidth)
  const screenHeight = positiveNumber(metrics.screenHeight)
  const innerWidth = positiveNumber(metrics.innerWidth)
  const innerHeight = positiveNumber(metrics.innerHeight)
  const outerWidth = positiveNumber(metrics.outerWidth)

  if (!screenWidth || !screenHeight) {
    return {
      width: Math.max(1, Math.round(innerWidth || 1)),
      height: Math.max(1, Math.round(innerHeight || 1))
    }
  }

  const measuredZoomCandidate = innerWidth && outerWidth ? outerWidth / innerWidth : 1
  // 嵌入式浏览器的 outerWidth 可能属于宿主窗口，不能拿它推断页面缩放。
  const measuredZoom = measuredZoomCandidate >= 0.5 && measuredZoomCandidate <= 2
    ? measuredZoomCandidate
    : 1
  const browserZoom = nearestBrowserZoom(measuredZoom)
  // clientWidth/clientHeight 按整像素向下取整；向上取整会让舞台多出不足 1px，
  // 但 overflow:auto 仍会因此同时生成横向和纵向滚动条。
  return {
    width: Math.max(1, Math.floor(screenWidth / browserZoom)),
    height: Math.max(1, Math.floor(screenHeight / browserZoom))
  }
}
