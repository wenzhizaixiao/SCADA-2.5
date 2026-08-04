export const PROJECT_VERSION = 20

export function migrateLegacyLineShapeNode(node, projectVersion) {
  if (!node || typeof node !== 'object' || node.type !== 'lineShape' || Number(projectVersion) >= PROJECT_VERSION) return node

  const legacyHeightValue = Number(node.h)
  const legacyHeight = Number.isFinite(legacyHeightValue) && legacyHeightValue > 0 ? legacyHeightValue : 12
  const legacyBorderWidthValue = Number(node.borderWidth)
  const legacyBorderWidth = Number.isFinite(legacyBorderWidthValue) ? legacyBorderWidthValue : 2
  const thickness = Math.max(.1, legacyBorderWidth > 0 ? legacyBorderWidth : 2)
  const yValue = Number(node.y)
  const y = Number.isFinite(yValue) ? yValue : 0

  return {
    ...node,
    y: y + (legacyHeight - thickness) / 2,
    h: thickness,
    fill: node.stroke || node.fill || '#485563',
    borderWidth: thickness,
    borderVisible: node.borderVisible !== false && legacyBorderWidth > 0,
    backgroundOpacity: node.borderVisible !== false && legacyBorderWidth > 0 && (node.borderStyle || 'solid') === 'solid' ? 1 : 0
  }
}
