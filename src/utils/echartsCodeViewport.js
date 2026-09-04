export const ECHARTS_CODE_MIN_VIEWPORT_WIDTH = 400
export const ECHARTS_CODE_MIN_VIEWPORT_HEIGHT = 300
export const ECHARTS_STANDARD_MIN_VIEWPORT_WIDTH = 320
export const ECHARTS_STANDARD_MIN_VIEWPORT_HEIGHT = 220

function positiveDimension(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, number) : 1
}

function responsiveEChartsViewport(width, height, minimumWidth, minimumHeight) {
  const actualWidth = positiveDimension(width)
  const actualHeight = positiveDimension(height)
  const scale = Math.min(
    1,
    actualWidth / minimumWidth,
    actualHeight / minimumHeight
  )

  return {
    width: actualWidth / scale,
    height: actualHeight / scale,
    scale
  }
}

/**
 * 标准图表在较小组件中保留完整逻辑画布，再整体缩放到节点边界。
 * 这样坐标轴、雷达标签和图例不会因 ECharts 的固定字号互相遮挡。
 */
export function standardEChartsViewport(width, height) {
  return responsiveEChartsViewport(
    width,
    height,
    ECHARTS_STANDARD_MIN_VIEWPORT_WIDTH,
    ECHARTS_STANDARD_MIN_VIEWPORT_HEIGHT
  )
}

export function echartsCodeViewport(width, height) {
  return responsiveEChartsViewport(
    width,
    height,
    ECHARTS_CODE_MIN_VIEWPORT_WIDTH,
    ECHARTS_CODE_MIN_VIEWPORT_HEIGHT
  )
}
