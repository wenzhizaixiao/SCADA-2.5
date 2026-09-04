import { FORM_TYPE_IDS } from '../config/componentCatalog.js'
import { previewNodeMountCost } from './previewMountBudget.js'

export const PREVIEW_HYBRID_MAX_DOM_NODES = 16
export const PREVIEW_HYBRID_MAX_DOM_COST = 128
export const PREVIEW_HYBRID_MAX_DOM_ENTRIES = 24
export const PREVIEW_HYBRID_DRAWING_COST = 4

export const PREVIEW_RENDER_CAPABILITIES = Object.freeze({
  STATIC_CANVAS: 'static-canvas',
  ANIMATED_CANVAS: 'animated-canvas',
  LIVE_DOM: 'live-dom'
})

const ANIMATED_CANVAS_ANIMATION_BY_TYPE = Object.freeze({
  flowDirection: 'flow',
  flowPipe: 'flow',
  rotatingFan: 'flow',
  signalLight: 'blink',
  waterTank: 'flow',
  heartbeat: 'pulse',
  particles: 'flow'
})

const ECHARTS_NODE_TYPES = new Set([
  'chart', 'lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart', 'echartsCode'
])

export function animatedPreviewImageSource(value) {
  const source = String(value || '').trim().toLowerCase()
  return /(?:^data:image\/(?:gif|apng|webp)|\.(?:gif|apng|webp)(?:$|[?#]))/.test(source)
}

export function previewNodeRenderCapability(node) {
  const { STATIC_CANVAS, ANIMATED_CANVAS, LIVE_DOM } = PREVIEW_RENDER_CAPABILITIES
  if (!node) return STATIC_CANVAS

  const type = String(node.type || '')
  if (type === 'video' || FORM_TYPE_IDS.has(type) || type.startsWith('custom') || ECHARTS_NODE_TYPES.has(type)) return LIVE_DOM
  if (node.progressFluctuationEnabled) return LIVE_DOM
  if (type === 'image' && animatedPreviewImageSource(node.imageUrl)) return LIVE_DOM

  const supportedAnimation = ANIMATED_CANVAS_ANIMATION_BY_TYPE[type]
  if (!supportedAnimation || node.animation !== supportedAnimation) return STATIC_CANVAS
  return ANIMATED_CANVAS
}

export function previewNodeNeedsLiveDom(node) {
  return previewNodeRenderCapability(node) === PREVIEW_RENDER_CAPABILITIES.LIVE_DOM
}

export function previewNodeCanUseCanvasFallback(node) {
  return ECHARTS_NODE_TYPES.has(String(node?.type || ''))
}

export function previewHybridLayerTail(entries = [], liveNodeIds = [], options = {}) {
  const liveIds = liveNodeIds instanceof Set ? liveNodeIds : new Set(liveNodeIds)
  if (!liveIds.size) return { safe: true, entries: [] }

  const maxEntries = Math.max(
    1,
    Math.floor(Number(options.maxEntries) || PREVIEW_HYBRID_MAX_DOM_ENTRIES)
  )
  const missingIds = new Set(liveIds)
  const tail = []
  for (let index = entries.length - 1; index >= 0 && tail.length < maxEntries; index -= 1) {
    const entry = entries[index]
    tail.push(entry)
    if (entry?.kind === 'node') missingIds.delete(entry.id)
    if (!missingIds.size) {
      tail.reverse()
      return { safe: true, entries: tail }
    }
  }
  return { safe: false, entries: [] }
}

export function previewHybridDomSafe(nodes = [], options = {}) {
  const maxNodes = Math.max(1, Math.floor(Number(options.maxNodes) || PREVIEW_HYBRID_MAX_DOM_NODES))
  const maxCost = Math.max(1, Math.floor(Number(options.maxCost) || PREVIEW_HYBRID_MAX_DOM_COST))
  if (nodes.length > maxNodes) return false
  let cost = 0
  for (const node of nodes) {
    cost += previewNodeMountCost(node)
    if (cost > maxCost) return false
  }
  return true
}

export function previewHybridTailDomSafe(entries = [], options = {}) {
  const nodes = []
  let drawingCost = 0
  for (const entry of entries) {
    if (entry?.kind === 'node' && entry.entity) nodes.push(entry.entity)
    else if (entry?.kind === 'drawing') drawingCost += PREVIEW_HYBRID_DRAWING_COST
  }
  const maxCost = Math.max(1, Math.floor(Number(options.maxCost) || PREVIEW_HYBRID_MAX_DOM_COST))
  if (drawingCost >= maxCost) return false
  return previewHybridDomSafe(nodes, { ...options, maxCost: maxCost - drawingCost })
}

export function buildPreviewHybridPlan(entries = [], nodes = [], options = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : []
  const sourceNodes = Array.isArray(nodes) ? nodes : []
  const liveNodeIds = []
  const requiredLiveNodeIds = []
  const preferredLiveNodeIds = []

  for (const node of sourceNodes) {
    if (!previewNodeNeedsLiveDom(node)) continue
    liveNodeIds.push(node.id)
    if (previewNodeCanUseCanvasFallback(node)) preferredLiveNodeIds.push(node.id)
    else requiredLiveNodeIds.push(node.id)
  }

  const planFor = ids => {
    const tail = previewHybridLayerTail(sourceEntries, ids, options)
    return {
      entries: tail.entries,
      layerSafe: tail.safe,
      domSafe: tail.safe && previewHybridTailDomSafe(tail.entries, options)
    }
  }
  const completePlan = planFor(liveNodeIds)
  if (completePlan.layerSafe && completePlan.domSafe) {
    return {
      overlayEntries: completePlan.entries,
      liveNodeIds,
      requiredLiveNodeIds,
      canvasFallbackNodeIds: [],
      layerSafe: true,
      domSafe: true,
      canUseCanvas: true,
      preservesAllLiveDom: true
    }
  }

  // 仅图表允许退回已有 Canvas 预览；视频、表单、动态媒体和自定义组件仍严格保留 DOM。
  const requiredPlan = planFor(requiredLiveNodeIds)
  if (!requiredPlan.layerSafe || !requiredPlan.domSafe) {
    return {
      overlayEntries: [],
      liveNodeIds,
      requiredLiveNodeIds,
      canvasFallbackNodeIds: preferredLiveNodeIds,
      layerSafe: requiredPlan.layerSafe,
      domSafe: requiredPlan.domSafe,
      canUseCanvas: false,
      preservesAllLiveDom: false
    }
  }

  let overlayEntries = requiredPlan.entries
  const preferredIds = new Set(preferredLiveNodeIds)
  const selectedPreferredIds = []
  for (let index = sourceEntries.length - 1; index >= 0; index -= 1) {
    const entry = sourceEntries[index]
    if (entry?.kind !== 'node' || !preferredIds.has(entry.id)) continue
    selectedPreferredIds.push(entry.id)
    const candidate = planFor([...requiredLiveNodeIds, ...selectedPreferredIds])
    if (!candidate.layerSafe || !candidate.domSafe) {
      selectedPreferredIds.pop()
      break
    }
    overlayEntries = candidate.entries
  }

  const overlayNodeIds = new Set(
    overlayEntries.filter(entry => entry?.kind === 'node').map(entry => entry.id)
  )
  const canvasFallbackNodeIds = preferredLiveNodeIds.filter(id => !overlayNodeIds.has(id))
  return {
    overlayEntries,
    liveNodeIds,
    requiredLiveNodeIds,
    canvasFallbackNodeIds,
    layerSafe: true,
    domSafe: true,
    canUseCanvas: true,
    preservesAllLiveDom: liveNodeIds.every(id => overlayNodeIds.has(id))
  }
}
