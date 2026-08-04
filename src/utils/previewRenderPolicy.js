import { FORM_TYPE_IDS } from '../config/componentCatalog.js'
import { previewNodeMountCost } from './previewMountBudget.js'

export const PREVIEW_HYBRID_MAX_DOM_NODES = 16
export const PREVIEW_HYBRID_MAX_DOM_COST = 128
export const PREVIEW_HYBRID_MAX_DOM_ENTRIES = 24
export const PREVIEW_HYBRID_DRAWING_COST = 4

export function animatedPreviewImageSource(value) {
  const source = String(value || '').trim().toLowerCase()
  return /(?:^data:image\/(?:gif|apng|webp)|\.(?:gif|apng|webp)(?:$|[?#]))/.test(source)
}

export function previewNodeNeedsLiveDom(node) {
  if (!node) return false
  if (node.type === 'video' || FORM_TYPE_IDS.has(node.type)) return true
  if (String(node.type || '').startsWith('custom')) return true
  if (node.animation && node.animation !== 'none') return true
  if (node.progressFluctuationEnabled) return true
  return ['image', 'customImageMotion'].includes(node.type) && animatedPreviewImageSource(node.imageUrl)
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
