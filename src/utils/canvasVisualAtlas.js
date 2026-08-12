const DEFAULT_MAX_ENTRIES = 512
const DEFAULT_MAX_DIMENSION = 4096
const DEFAULT_MAX_PIXELS = 4_194_304

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function nextPowerOfTwo(value) {
  let result = 1
  const target = Math.max(1, Math.ceil(Number(value) || 1))
  while (result < target) result *= 2
  return result
}

function normalizedEntries(entries, maximumEntries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > maximumEntries) return null
  const signatures = new Set()
  const normalized = []
  for (const entry of entries) {
    const signature = String(entry?.signature ?? '')
    const width = Math.ceil(Number(entry?.width))
    const height = Math.ceil(Number(entry?.height))
    if (!signature || signatures.has(signature) || !(width > 0) || !(height > 0)) return null
    signatures.add(signature)
    normalized.push({ signature, width, height })
  }
  return normalized
}

function shelfPack(entries, width, maximumHeight, gap, padding) {
  const slots = new Map()
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let usedWidth = 0
  for (const entry of entries) {
    const allocationWidth = entry.width + padding * 2
    const allocationHeight = entry.height + padding * 2
    if (allocationWidth > width || allocationHeight > maximumHeight) return null
    if (cursorX > 0 && cursorX + allocationWidth > width) {
      cursorY += rowHeight + gap
      cursorX = 0
      rowHeight = 0
    }
    if (cursorY + allocationHeight > maximumHeight) return null
    slots.set(entry.signature, {
      x: cursorX + padding,
      y: cursorY + padding,
      w: entry.width,
      h: entry.height
    })
    cursorX += allocationWidth + gap
    rowHeight = Math.max(rowHeight, allocationHeight)
    usedWidth = Math.max(usedWidth, cursorX - gap)
  }
  return {
    slots,
    usedWidth,
    usedHeight: cursorY + rowHeight
  }
}

function atlasCandidateWidths(entries, widest, maximumWidth, gap, padding) {
  const allocationPixels = entries.reduce((total, entry) => (
    total + (entry.width + padding * 2) * (entry.height + padding * 2)
  ), 0)
  const target = Math.sqrt(allocationPixels)
  const candidates = new Set([widest, maximumWidth])
  for (const ratio of [.75, .875, 1, 1.125, 1.25, 1.5, 1.75, 2]) {
    const width = Math.ceil(target * ratio / 16) * 16
    candidates.add(Math.max(widest, Math.min(maximumWidth, width)))
  }
  for (let width = nextPowerOfTwo(widest); width <= maximumWidth; width *= 2) {
    candidates.add(width)
    if (width > maximumWidth / 2) break
  }
  let accumulatedWidth = 0
  for (const entry of entries) {
    accumulatedWidth += entry.width + padding * 2 + gap
    candidates.add(Math.max(widest, Math.min(maximumWidth, accumulatedWidth - gap)))
  }
  return [...candidates].filter(width => width >= widest && width <= maximumWidth).sort((left, right) => left - right)
}

export function packCanvasVisualAtlas(sourceEntries, options = {}) {
  const maximumEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, 65_536)
  const maximumWidth = boundedInteger(options.maxWidth, DEFAULT_MAX_DIMENSION, 1, 32_768)
  const maximumHeight = boundedInteger(options.maxHeight, DEFAULT_MAX_DIMENSION, 1, 32_768)
  const maximumPixels = boundedInteger(options.maxPixels, DEFAULT_MAX_PIXELS, 1, 268_435_456)
  const gap = boundedInteger(options.gap, 0, 0, 16)
  const padding = boundedInteger(options.padding, 1, 0, 16)
  const normalized = normalizedEntries(sourceEntries, maximumEntries)
  if (!normalized) return null
  const entries = normalized.slice().sort((left, right) => (
    right.height - left.height
    || right.width - left.width
    || left.signature.localeCompare(right.signature)
  ))
  const widest = Math.max(...entries.map(entry => entry.width + padding * 2))
  if (widest > maximumWidth) return null

  let best = null
  for (const candidateWidth of atlasCandidateWidths(entries, widest, maximumWidth, gap, padding)) {
    const packed = shelfPack(entries, candidateWidth, maximumHeight, gap, padding)
    if (!packed) continue
    const width = packed.usedWidth
    const height = packed.usedHeight
    const pixels = width * height
    if (width > maximumWidth || height > maximumHeight || pixels > maximumPixels) continue
    if (!best || pixels < best.pixels || (pixels === best.pixels && width < best.width)) {
      best = { width, height, pixels, slots: packed.slots }
    }
  }
  return best
}

export function mapCanvasVisualAtlasInstances(instances, slots) {
  if (!Array.isArray(instances) || !(slots instanceof Map)) return null
  const mapped = []
  for (const instance of instances) {
    const slot = slots.get(instance?.signature)
    if (!slot) return null
    mapped.push({ ...instance, atlasRect: slot })
  }
  return mapped
}

export function canvasVisualAtlasBlitData(instances) {
  if (!Array.isArray(instances) || !instances.length) return null
  const data = new Float32Array(instances.length * 8)
  for (let index = 0; index < instances.length; index += 1) {
    const source = instances[index]?.atlasRect
    const destination = instances[index]?.bitmapRect
    const sourceX = Number(source?.x)
    const sourceY = Number(source?.y)
    const sourceWidth = Number(source?.w)
    const sourceHeight = Number(source?.h)
    const destinationX = Number(destination?.x)
    const destinationY = Number(destination?.y)
    const destinationWidth = Number(destination?.w)
    const destinationHeight = Number(destination?.h)
    if (
      !Number.isFinite(sourceX)
      || !Number.isFinite(sourceY)
      || !Number.isFinite(sourceWidth)
      || !Number.isFinite(sourceHeight)
      || !Number.isFinite(destinationX)
      || !Number.isFinite(destinationY)
      || !Number.isFinite(destinationWidth)
      || !Number.isFinite(destinationHeight)
      || sourceWidth <= 0
      || sourceHeight <= 0
      || destinationWidth <= 0
      || destinationHeight <= 0
    ) return null
    const offset = index * 8
    data[offset] = sourceX
    data[offset + 1] = sourceY
    data[offset + 2] = sourceWidth
    data[offset + 3] = sourceHeight
    data[offset + 4] = destinationX
    data[offset + 5] = destinationY
    data[offset + 6] = destinationWidth
    data[offset + 7] = destinationHeight
  }
  return data
}

export function drawCanvasVisualAtlasBlits(context, atlas, blitData, options = {}) {
  if (
    typeof context?.drawImage !== 'function'
    || !atlas
    || !(blitData instanceof Float32Array)
    || !blitData.length
    || blitData.length % 8 !== 0
  ) throw new TypeError('a Canvas2D context, atlas, and valid blit data are required')
  const offsetX = Number(options.offsetX) || 0
  const offsetY = Number(options.offsetY) || 0
  const shouldYield = typeof options.shouldYield === 'function' ? options.shouldYield : () => false
  const instanceCount = blitData.length / 8
  const yieldEvery = Math.max(1, Math.floor(Number(options.yieldEvery)) || 64)
  let cursor = Math.max(0, Math.min(instanceCount, Math.floor(Number(options.cursor)) || 0))
  const startedAt = cursor
  while (cursor < instanceCount) {
    const index = cursor * 8
    context.drawImage(
      atlas,
      blitData[index],
      blitData[index + 1],
      blitData[index + 2],
      blitData[index + 3],
      offsetX + blitData[index + 4],
      offsetY + blitData[index + 5],
      blitData[index + 6],
      blitData[index + 7]
    )
    cursor += 1
    if (cursor < instanceCount && (cursor - startedAt) % yieldEvery === 0 && shouldYield()) break
  }
  return Object.freeze({
    cursor,
    done: cursor >= instanceCount,
    drawn: cursor - startedAt
  })
}
