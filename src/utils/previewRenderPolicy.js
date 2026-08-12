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
  flowPipe: 'flow',
  rotatingFan: 'flow',
  signalLight: 'blink',
  waterTank: 'flow',
  heartbeat: 'pulse',
  particles: 'flow'
})

export function animatedPreviewImageSource(value) {
  const source = String(value || '').trim().toLowerCase()
  return /(?:^data:image\/(?:gif|apng|webp)|\.(?:gif|apng|webp)(?:$|[?#]))/.test(source)
}

export function previewNodeRenderCapability(node) {
  const { STATIC_CANVAS, ANIMATED_CANVAS, LIVE_DOM } = PREVIEW_RENDER_CAPABILITIES
  if (!node) return STATIC_CANVAS

  const type = String(node.type || '')
  if (type === 'video' || FORM_TYPE_IDS.has(type) || type.startsWith('custom')) return LIVE_DOM
  if (node.progressFluctuationEnabled) return LIVE_DOM
  if (type === 'image' && animatedPreviewImageSource(node.imageUrl)) return LIVE_DOM

  const animation = node.animation
  if (!animation || animation === 'none') return STATIC_CANVAS
  return ANIMATED_CANVAS_ANIMATION_BY_TYPE[type] === animation ? ANIMATED_CANVAS : LIVE_DOM
}

export function previewNodeNeedsLiveDom(node) {
  return previewNodeRenderCapability(node) === PREVIEW_RENDER_CAPABILITIES.LIVE_DOM
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
