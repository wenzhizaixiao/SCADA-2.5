import { allocateLegacyDrawingNodeIds } from './legacyDrawingIds.js'
import { migrateLegacyLineShapeNode } from './projectMigration.js'
import { MAX_POLYLINE_NODE_POINTS, isPolylineNodeType } from './polylineGeometry.js'
import { getBindableParameter } from '../config/componentBindingSchema.js'
import {
  MAX_BINDING_JSON_PATH_LENGTH,
  MAX_BINDING_POINT_ID_LENGTH,
  MAX_BINDING_SOURCE_ID_LENGTH,
  MAX_NODE_DATA_BINDINGS,
  isSupportedBindingAdapter
} from '../models/dataBindingModel.js'
import { canonicalizeJsonPath } from './jsonPathBinding.js'

export const PROJECT_CAPACITY_LIMITS = Object.freeze({
  entities: 10000,
  edges: 20000,
  drawings: 5000,
  pathPoints: 250000,
  polylineNodePoints: MAX_POLYLINE_NODE_POINTS,
  customComponents: 200,
  customComponentNodes: 2000,
  customComponentEdges: 4000
})

export class ProjectValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProjectValidationError'
    this.code = code
  }
}

function invalid(code, message) {
  throw new ProjectValidationError(code, message)
}

function arrays(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('INVALID_PROJECT', '图纸文件结构无效')
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.drawings)) {
    invalid('MISSING_COLLECTIONS', '图纸文件缺少 nodes、edges 或 drawings 数组')
  }
  return { nodes: data.nodes, edges: data.edges, drawings: data.drawings }
}

function validId(id) {
  return (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))
}

function uniqueIds(items, label) {
  const ids = new Set()
  for (const item of items) {
    const id = item?.id
    if (!validId(id) || ids.has(id)) invalid('INVALID_ID', `${label} ID 无效或重复`)
    ids.add(id)
  }
  return ids
}

function legacyDrawingNodeIds(nodes, drawings) {
  const finalIds = new Set(nodes.map(node => node.id))
  const drawingNodeIds = allocateLegacyDrawingNodeIds(drawings, nodes)
  drawings.forEach((drawing, index) => {
    if (drawing.points.length) finalIds.add(drawingNodeIds[index])
  })
  return finalIds
}

function customComponentCollections(source) {
  if (source == null) return []
  if (!Array.isArray(source)) invalid('INVALID_CUSTOM_COMPONENTS', '自定义组件数据结构无效')
  return source
}

function countNodePathPoints(nodes) {
  let pencilPointCount = 0
  let polylinePointCount = 0
  for (const node of nodes) {
    if (node?.type === 'pencil' && Array.isArray(node.pencilPoints)) pencilPointCount += node.pencilPoints.length
    if (isPolylineNodeType(node?.type) && Array.isArray(node.polylinePoints)) polylinePointCount += node.polylinePoints.length
  }
  return { pencilPointCount, polylinePointCount }
}

function validatePolylinePointLimits(nodes, maxPoints) {
  for (const node of nodes) {
    if (isPolylineNodeType(node?.type) && Array.isArray(node.polylinePoints) && node.polylinePoints.length > maxPoints) {
      invalid('PROJECT_TOO_LARGE', `单条线段或流向最多支持 ${maxPoints} 个节点`)
    }
  }
}

function validateNodeDataBindings(nodes, label) {
  for (const node of nodes) {
    if (node?.dataBindings == null) continue
    const bindings = node.dataBindings
    if (!Array.isArray(bindings) || bindings.length > MAX_NODE_DATA_BINDINGS) {
      invalid('INVALID_DATA_BINDINGS', `${label}数据绑定结构无效或超过 ${MAX_NODE_DATA_BINDINGS} 项`)
    }
    const targets = new Set()
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        invalid('INVALID_DATA_BINDINGS', `${label}数据绑定项无效`)
      }
      if (typeof binding.target !== 'string') invalid('INVALID_DATA_BINDINGS', `${label}数据绑定参数无效`)
      const target = binding.target.trim()
      const definition = getBindableParameter(node?.type, target)
      if (!target || target.length > 128 || !definition) {
        invalid('INVALID_DATA_BINDINGS', `${label}包含不支持的数据绑定参数`)
      }
      const hasSourceBinding = binding.sourceId != null || binding.jsonPath != null || binding.path != null
      if (hasSourceBinding) {
        if (typeof binding.sourceId !== 'string' || typeof (binding.jsonPath ?? binding.path) !== 'string') {
          invalid('INVALID_DATA_BINDINGS', `${label}数据源或 JSONPath 无效`)
        }
        const sourceId = binding.sourceId.trim()
        const jsonPath = String(binding.jsonPath ?? binding.path).trim()
        if (
          !sourceId
          || sourceId.length > MAX_BINDING_SOURCE_ID_LENGTH
          || !jsonPath
          || jsonPath.length > MAX_BINDING_JSON_PATH_LENGTH
        ) invalid('INVALID_DATA_BINDINGS', `${label}数据源或 JSONPath 无效`)
        try {
          canonicalizeJsonPath(jsonPath)
        } catch {
          invalid('INVALID_DATA_BINDINGS', `${label}包含不支持的 JSONPath`)
        }
      } else {
        if (typeof binding.pointId !== 'string') invalid('INVALID_DATA_BINDINGS', `${label}旧点位无效`)
        const pointId = binding.pointId.trim()
        if (!pointId || pointId.length > MAX_BINDING_POINT_ID_LENGTH) {
          invalid('INVALID_DATA_BINDINGS', `${label}包含不支持的旧点位`)
        }
      }
      if (targets.has(target)) invalid('INVALID_DATA_BINDINGS', `${label}同一参数不能重复绑定`)
      targets.add(target)
      if (binding.enabled != null && typeof binding.enabled !== 'boolean') {
        invalid('INVALID_DATA_BINDINGS', `${label}数据绑定启用状态无效`)
      }
      if (!isSupportedBindingAdapter(binding.adapter, definition.valueType)) {
        invalid('INVALID_DATA_BINDINGS', `${label}数据转换规则无效`)
      }
    }
  }
}

export function countProjectCapacity(data) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : []
  const edges = Array.isArray(data?.edges) ? data.edges : []
  const drawings = Array.isArray(data?.drawings) ? data.drawings : []
  const customComponents = Array.isArray(data?.customComponents) ? data.customComponents : []
  const drawingPointCount = drawings.reduce((total, drawing) => total + (Array.isArray(drawing?.points) ? drawing.points.length : 0), 0)
  const { pencilPointCount, polylinePointCount } = countNodePathPoints(nodes)
  const customComponentNodeCount = customComponents.reduce((total, component) => total + (Array.isArray(component?.nodes) ? component.nodes.length : 0), 0)
  const customComponentEdgeCount = customComponents.reduce((total, component) => total + (Array.isArray(component?.edges) ? component.edges.length : 0), 0)
  let customComponentPencilPointCount = 0
  let customComponentPolylinePointCount = 0
  for (const component of customComponents) {
    const counts = countNodePathPoints(Array.isArray(component?.nodes) ? component.nodes : [])
    customComponentPencilPointCount += counts.pencilPointCount
    customComponentPolylinePointCount += counts.polylinePointCount
  }
  const customComponentPathPointCount = customComponentPencilPointCount + customComponentPolylinePointCount
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    drawingCount: drawings.length,
    entityCount: nodes.length + drawings.length,
    drawingPointCount,
    pencilPointCount,
    polylinePointCount,
    customComponentPencilPointCount,
    customComponentPolylinePointCount,
    customComponentPathPointCount,
    pathPointCount: drawingPointCount + pencilPointCount + polylinePointCount + customComponentPathPointCount,
    customComponentCount: customComponents.length,
    customComponentNodeCount,
    customComponentEdgeCount
  }
}

export function validateProjectForFrontend(data, limits = PROJECT_CAPACITY_LIMITS) {
  const { nodes, edges, drawings } = arrays(data)
  const customComponents = customComponentCollections(data.customComponents)
  const projectVersion = Number(data.version)
  const capacity = countProjectCapacity({ ...data, customComponents })
  const maxPolylineNodePoints = Number.isFinite(Number(limits.polylineNodePoints))
    ? Number(limits.polylineNodePoints)
    : MAX_POLYLINE_NODE_POINTS
  if (capacity.entityCount > limits.entities || capacity.edgeCount > limits.edges || capacity.drawingCount > limits.drawings) {
    invalid('PROJECT_TOO_LARGE', '图纸对象数量超过限制')
  }
  if (capacity.pathPointCount > limits.pathPoints) invalid('PROJECT_TOO_LARGE', '图纸路径点数超过限制')
  if (
    capacity.customComponentCount > limits.customComponents
    || capacity.customComponentNodeCount > limits.customComponentNodes
    || capacity.customComponentEdgeCount > limits.customComponentEdges
  ) invalid('CUSTOM_COMPONENTS_TOO_LARGE', '自定义组件数量超过限制')

  validatePolylinePointLimits(nodes, maxPolylineNodePoints)
  validateNodeDataBindings(nodes, '节点')

  for (const drawing of drawings) {
    if (!drawing || typeof drawing !== 'object' || !Array.isArray(drawing.points)) invalid('INVALID_DRAWING', '线稿数据结构无效')
    for (const point of drawing.points) {
      if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) invalid('INVALID_DRAWING_POINT', '线稿坐标无效')
    }
  }

  const customComponentIds = new Set()
  customComponents.forEach((component, index) => {
    if (!component || typeof component !== 'object' || !Array.isArray(component.nodes) || !component.nodes.length) {
      invalid('INVALID_CUSTOM_COMPONENT', '自定义组件数据结构无效')
    }
    const componentEdges = component.edges == null ? [] : component.edges
    if (!Array.isArray(componentEdges)) invalid('INVALID_CUSTOM_COMPONENT_EDGES', '自定义组件连线数据结构无效')
    validatePolylinePointLimits(component.nodes, maxPolylineNodePoints)
    validateNodeDataBindings(component.nodes, '自定义组件节点')
    for (const sourceNode of component.nodes) {
      const node = migrateLegacyLineShapeNode(sourceNode, projectVersion)
      const x = Number(node?.x)
      const y = Number(node?.y)
      const width = Number(node?.w)
      const height = Number(node?.h)
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        invalid('INVALID_CUSTOM_COMPONENT_GEOMETRY', '自定义组件节点几何无效')
      }
    }

    const componentId = typeof component.id === 'string' && component.id
      ? component.id.slice(0, 160)
      : `custom-import-${index + 1}`
    if (customComponentIds.has(componentId)) invalid('INVALID_CUSTOM_COMPONENT_ID', '自定义组件 ID 无效或重复')
    customComponentIds.add(componentId)

    const nodeIds = uniqueIds(component.nodes, '自定义组件节点')
    uniqueIds(componentEdges, '自定义组件连线')
    if (componentEdges.some(edge => !nodeIds.has(edge?.from) || !nodeIds.has(edge?.to))) {
      invalid('INVALID_CUSTOM_COMPONENT_EDGE_ENDPOINT', '自定义组件存在悬空连线')
    }
  })

  uniqueIds(nodes, '节点')
  uniqueIds(edges, '连线')
  const nodeIds = legacyDrawingNodeIds(nodes, drawings)
  if (edges.some(edge => !nodeIds.has(edge?.from) || !nodeIds.has(edge?.to))) invalid('INVALID_EDGE_ENDPOINT', '图纸存在悬空连线')
  return capacity
}
