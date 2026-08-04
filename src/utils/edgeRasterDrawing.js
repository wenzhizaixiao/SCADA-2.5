export const EDGE_RASTER_GEOMETRY_STRIDE = 8
export const EDGE_RASTER_FLAG_STRIDE = 3

const markerCodes = Object.freeze({ none: 0, arrow: 1, circle: 2, square: 3 })
const markers = Object.freeze(['none', 'arrow', 'circle', 'square'])

function markerCode(marker) {
  if (!marker || marker === 'none') return 0
  return markerCodes[marker] || markerCodes.square
}

function drawMarker(ctx, marker, pointX, pointY, neighborX, neighborY, size, lineWidth, color) {
  if (!marker || marker === 'none') return
  const angle = Math.atan2(pointY - neighborY, pointX - neighborX)
  ctx.save()
  try {
    ctx.translate(pointX, pointY)
    ctx.rotate(angle)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    if (marker === 'arrow') {
      ctx.moveTo(0, 0)
      ctx.lineTo(-size, -size * .45)
      ctx.lineTo(-size, size * .45)
      ctx.closePath()
    } else if (marker === 'circle') ctx.arc(0, 0, size * .52, 0, Math.PI * 2)
    else ctx.rect(-size * .5, -size * .5, size, size)
    ctx.fill()
  } finally {
    ctx.restore()
  }
}

export function drawEdgeRasterCommand(ctx, command) {
  if (!ctx || !command) return false
  const previousLineCap = typeof ctx.lineCap === 'string' ? ctx.lineCap : 'butt'
  const {
    startX,
    startY,
    endX,
    endY,
    color,
    lineWidth,
    dash,
    startMarker,
    endMarker,
    startMarkerSize,
    endMarkerSize,
    markerLineWidth
  } = command
  try {
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    if (dash) ctx.setLineDash([lineWidth * 4, lineWidth * 3])
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.lineTo(endX, endY)
    ctx.stroke()
    ctx.setLineDash([])
    drawMarker(ctx, startMarker, startX, startY, endX, endY, startMarkerSize, markerLineWidth, color)
    drawMarker(ctx, endMarker, endX, endY, startX, startY, endMarkerSize, markerLineWidth, color)
    return true
  } finally {
    try {
      ctx.setLineDash([])
    } finally {
      ctx.lineCap = previousLineCap
    }
  }
}

export function packEdgeRasterCommands(commands) {
  const count = Array.isArray(commands) ? commands.length : 0
  const geometry = new Float64Array(count * EDGE_RASTER_GEOMETRY_STRIDE)
  const flags = new Uint8Array(count * EDGE_RASTER_FLAG_STRIDE)
  const colorIndexes = new Uint16Array(count)
  const colors = []
  const colorLookup = new Map()
  for (let index = 0; index < count; index += 1) {
    const command = commands[index]
    const geometryOffset = index * EDGE_RASTER_GEOMETRY_STRIDE
    geometry[geometryOffset] = command.startX
    geometry[geometryOffset + 1] = command.startY
    geometry[geometryOffset + 2] = command.endX
    geometry[geometryOffset + 3] = command.endY
    geometry[geometryOffset + 4] = command.lineWidth
    geometry[geometryOffset + 5] = command.startMarkerSize
    geometry[geometryOffset + 6] = command.endMarkerSize
    geometry[geometryOffset + 7] = command.markerLineWidth
    const flagOffset = index * EDGE_RASTER_FLAG_STRIDE
    flags[flagOffset] = command.dash ? 1 : 0
    flags[flagOffset + 1] = markerCode(command.startMarker)
    flags[flagOffset + 2] = markerCode(command.endMarker)
    const color = String(command.color || '#485563')
    let colorIndex = colorLookup.get(color)
    if (colorIndex == null) {
      colorIndex = colors.length
      if (colorIndex >= 65535) throw new RangeError('Edge raster batch contains too many colors')
      colorLookup.set(color, colorIndex)
      colors.push(color)
    }
    colorIndexes[index] = colorIndex
  }
  return { count, geometry, flags, colorIndexes, colors }
}

export function edgeRasterBatchTransferList(batch) {
  if (!batch) return []
  return [batch.geometry?.buffer, batch.flags?.buffer, batch.colorIndexes?.buffer].filter(Boolean)
}

export function drawEdgeRasterBatch(ctx, batch) {
  const count = Math.max(0, Math.floor(Number(batch?.count) || 0))
  const geometry = batch?.geometry
  const flags = batch?.flags
  const colorIndexes = batch?.colorIndexes
  const colors = batch?.colors
  if (
    !ctx
    || !(geometry instanceof Float64Array)
    || !(flags instanceof Uint8Array)
    || !(colorIndexes instanceof Uint16Array)
    || !Array.isArray(colors)
    || geometry.length < count * EDGE_RASTER_GEOMETRY_STRIDE
    || flags.length < count * EDGE_RASTER_FLAG_STRIDE
    || colorIndexes.length < count
  ) throw new TypeError('Invalid edge raster batch')
  for (let index = 0; index < count; index += 1) {
    const geometryOffset = index * EDGE_RASTER_GEOMETRY_STRIDE
    const flagOffset = index * EDGE_RASTER_FLAG_STRIDE
    drawEdgeRasterCommand(ctx, {
      startX: geometry[geometryOffset],
      startY: geometry[geometryOffset + 1],
      endX: geometry[geometryOffset + 2],
      endY: geometry[geometryOffset + 3],
      lineWidth: geometry[geometryOffset + 4],
      startMarkerSize: geometry[geometryOffset + 5],
      endMarkerSize: geometry[geometryOffset + 6],
      markerLineWidth: geometry[geometryOffset + 7],
      dash: flags[flagOffset] === 1,
      startMarker: markers[flags[flagOffset + 1]] || 'square',
      endMarker: markers[flags[flagOffset + 2]] || 'square',
      color: colors[colorIndexes[index]] || '#485563'
    })
  }
  return count
}
