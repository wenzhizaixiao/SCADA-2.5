import {
  baseNodeOptions,
  EDGE_ANCHOR_MODES,
  EDGE_MARKER_TYPES,
  normalizeDrawing,
  normalizeEdge,
  normalizeNode,
  normalizeNodesTogether
} from '../models/editorModel.js'
import { clampNumber, rotatedFrameBounds } from './editorGeometry.js'
import { compactEntityLayers } from './documentIndexes.js'
import { allocateLegacyDrawingNodeIds } from './legacyDrawingIds.js'
import { migrateLegacyInterfaceTestProject } from './legacyInterfaceTestMigration.js'
import { migrateLegacyLineShapeNode, PROJECT_VERSION } from './projectMigration.js'
import { PROJECT_CAPACITY_LIMITS, validateProjectForFrontend } from './projectValidation.js'

export const DEFAULT_PROJECT_STAGE_WIDTH = 6000
export const DEFAULT_PROJECT_STAGE_HEIGHT = 4000

export function createEntityId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

export function clampCanvasDimension(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.max(320, Math.min(20000, number))) : fallback
}

function drawingBounds(drawing) {
  if (!drawing?.points?.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of drawing.points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

export function drawingToPencilNode(
  drawing,
  id = createEntityId('node'),
  targetStageWidth = DEFAULT_PROJECT_STAGE_WIDTH,
  targetStageHeight = DEFAULT_PROJECT_STAGE_HEIGHT
) {
  const source = normalizeDrawing(drawing)
  if (!source.points.length) return null
  const bounds = drawingBounds(source)
  const width = Math.min(targetStageWidth, Math.max(8, bounds.w))
  const height = Math.min(targetStageHeight, Math.max(8, bounds.h))
  const x = clampNumber(bounds.x - (width - bounds.w) / 2, 0, Math.max(0, targetStageWidth - width))
  const y = clampNumber(bounds.y - (height - bounds.h) / 2, 0, Math.max(0, targetStageHeight - height))
  return normalizeNode({
    ...baseNodeOptions(),
    id,
    layer: source.layer,
    type: 'pencil',
    x,
    y,
    w: width,
    h: height,
    rotate: 0,
    text: '铅笔线稿',
    fill: '#ffffff',
    stroke: source.color,
    color: source.color,
    backgroundOpacity: 0,
    borderVisible: false,
    opacity: source.opacity,
    locked: source.locked,
    groupId: source.groupId || null,
    pencilPoints: source.points.map(point => ({
      x: clampNumber((point.x - x) / Math.max(1, width), 0, 1),
      y: clampNumber((point.y - y) / Math.max(1, height), 0, 1)
    })),
    pencilColor: source.color,
    pencilWidth: source.width,
    pencilDash: source.dash,
    pencilSmooth: source.smooth,
    pencilClosed: source.closed,
    pencilLineCap: source.lineCap,
    pencilLineJoin: source.lineJoin
  })
}

function migrateDrawingsToPencilNodes(sourceDrawings, sourceNodes, targetStageWidth, targetStageHeight) {
  const drawingsToMigrate = Array.isArray(sourceDrawings) ? sourceDrawings : []
  const allocatedIds = allocateLegacyDrawingNodeIds(drawingsToMigrate, sourceNodes)
  return drawingsToMigrate.flatMap((drawing, index) => {
    const node = drawingToPencilNode(drawing, allocatedIds[index], targetStageWidth, targetStageHeight)
    return node ? [node] : []
  })
}

function assertUniqueIds(items, label) {
  const ids = new Set()
  for (const item of items) {
    const idType = typeof item?.id
    if (!['string', 'number'].includes(idType) || item.id === '' || (idType === 'number' && !Number.isFinite(item.id)) || ids.has(item.id)) {
      throw new Error(`invalid ${label} id`)
    }
    ids.add(item.id)
  }
  return ids
}

function nodeCollectionBounds(sourceNodes) {
  const frames = sourceNodes.map(node => rotatedFrameBounds(node))
  const minX = Math.min(...frames.map(frame => frame.x))
  const minY = Math.min(...frames.map(frame => frame.y))
  const maxX = Math.max(...frames.map(frame => frame.x + frame.w))
  const maxY = Math.max(...frames.map(frame => frame.y + frame.h))
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

function normalizeCustomComponents(source, lineDefaults = {}, projectVersion = PROJECT_VERSION) {
  if (source == null) return []
  if (!Array.isArray(source) || source.length > PROJECT_CAPACITY_LIMITS.customComponents) throw new Error('invalid custom components')
  let totalNodes = 0
  let totalEdges = 0
  const result = source.map((item, index) => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.nodes) || !item.nodes.length) throw new Error('invalid custom component')
    const sourceEdges = item.edges == null ? [] : item.edges
    if (!Array.isArray(sourceEdges)) throw new Error('invalid custom component edges')
    totalNodes += item.nodes.length
    totalEdges += sourceEdges.length
    if (totalNodes > PROJECT_CAPACITY_LIMITS.customComponentNodes || totalEdges > PROJECT_CAPACITY_LIMITS.customComponentEdges) {
      throw new Error('custom components too large')
    }
    const templateNodes = item.nodes.map(sourceNode => {
      const migratedSource = migrateLegacyLineShapeNode(sourceNode, projectVersion)
      const x = Number(migratedSource.x)
      const y = Number(migratedSource.y)
      const width = Number(migratedSource.w)
      const height = Number(migratedSource.h)
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('invalid custom component geometry')
      return normalizeNode({ ...migratedSource, x, y, w: width, h: height, locked: false, groupId: null })
    })
    const nodeIds = assertUniqueIds(templateNodes, 'custom component node')
    const templateEdges = sourceEdges.map(edge => normalizeEdge(edge, lineDefaults))
    assertUniqueIds(templateEdges, 'custom component edge')
    if (templateEdges.some(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) throw new Error('invalid custom component edge endpoint')
    const bounds = nodeCollectionBounds(templateNodes)
    templateNodes.forEach(node => {
      node.x -= bounds.x
      node.y -= bounds.y
    })
    return {
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 160) : `custom-import-${index + 1}`,
      name: String(item.name || `自定义组件 ${index + 1}`).trim().slice(0, 64) || `自定义组件 ${index + 1}`,
      width: bounds.w,
      height: bounds.h,
      nodes: templateNodes,
      edges: templateEdges,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null
    }
  })
  assertUniqueIds(result, 'custom component')
  return result
}

export function prepareProject(data, fallbackName = '未命名图纸') {
  validateProjectForFrontend(data)
  data = migrateLegacyInterfaceTestProject(data)
  const now = new Date().toISOString()
  const preparedStageWidth = clampCanvasDimension(data.stageWidth, DEFAULT_PROJECT_STAGE_WIDTH)
  const preparedStageHeight = clampCanvasDimension(data.stageHeight, DEFAULT_PROJECT_STAGE_HEIGHT)
  const sourceProjectVersion = Number(data.version)
  const normalizedNodes = data.nodes.map(node => normalizeNode(migrateLegacyLineShapeNode(node, sourceProjectVersion)))
  const migratedPencilNodes = migrateDrawingsToPencilNodes(data.drawings, normalizedNodes, preparedStageWidth, preparedStageHeight)
  const importedLineDefaults = {
    color: data.lineColor || '#485563',
    width: Number(data.lineWidth) || 2,
    dash: typeof data.lineDash === 'boolean' ? data.lineDash : false,
    startMarker: data.lineStartMarker,
    endMarker: data.lineEndMarker,
    anchorMode: data.lineAnchorMode
  }
  const project = {
    ...data,
    version: PROJECT_VERSION,
    projectId: typeof data.projectId === 'string' && data.projectId ? data.projectId : createEntityId('project'),
    revision: Math.max(0, Math.floor(Number(data.revision) || 0)),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    fileName: String(data.fileName || fallbackName),
    stageWidth: preparedStageWidth,
    stageHeight: preparedStageHeight,
    canvasBorderColor: data.canvasBorderColor || '#cbd3d9',
    canvasBorderWidth: data.canvasBorderWidth == null ? 1 : Math.max(0, Math.min(10, Number(data.canvasBorderWidth) || 0)),
    gridColor: data.gridColor || '#dde3e7',
    gridStyle: ['line', 'dot'].includes(data.gridStyle) ? data.gridStyle : 'line',
    lineStartMarker: EDGE_MARKER_TYPES.has(data.lineStartMarker) ? data.lineStartMarker : 'none',
    lineEndMarker: EDGE_MARKER_TYPES.has(data.lineEndMarker) ? data.lineEndMarker : 'arrow',
    lineAnchorMode: EDGE_ANCHOR_MODES.has(data.lineAnchorMode) ? data.lineAnchorMode : 'edge',
    nodes: [...normalizedNodes, ...migratedPencilNodes],
    edges: data.edges.map(edge => normalizeEdge(edge, importedLineDefaults)),
    drawings: [],
    customComponents: normalizeCustomComponents(data.customComponents, importedLineDefaults, sourceProjectVersion)
  }
  normalizeNodesTogether(project.nodes, project.stageWidth, project.stageHeight)
  const nodeIds = assertUniqueIds(project.nodes, 'node')
  assertUniqueIds(project.edges, 'edge')
  if (project.edges.some(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) throw new Error('invalid edge endpoint')
  compactEntityLayers(project.nodes)
  return project
}
