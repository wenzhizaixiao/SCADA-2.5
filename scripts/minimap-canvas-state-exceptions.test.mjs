import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canvasVisualDetailSize,
  flowPipeDashOffset,
  isCanvasVisualAnimationCandidate,
  rotatingFanAngle,
  signalLightColor
} from '../src/utils/canvasVisualAnimation.js'
import { drawEdgeRasterCommand } from '../src/utils/edgeRasterDrawing.js'

const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = miniMapSource.indexOf(startMarker)
  const end = miniMapSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return miniMapSource.slice(start, end)
}

function compileSource(packet, exportName, dependencies = {}) {
  const names = Object.keys(dependencies)
  const factory = new Function(
    ...names,
    `"use strict"; ${packet}; return ${exportName};`
  )
  return factory(...names.map(name => dependencies[name]))
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(finiteNumber(radius), width / 2, height / 2))
  context.beginPath()
  context.roundRect(x, y, width, height, safeRadius)
}

function createFaultCanvasContext(failure = {}) {
  const state = {
    counts: new Map(),
    dash: [],
    depth: 0,
    maximumDepth: 0
  }
  const hit = method => {
    const count = (state.counts.get(method) || 0) + 1
    state.counts.set(method, count)
    if (failure.method === method && count === (failure.occurrence || 1)) {
      throw new Error(`injected ${method} failure`)
    }
  }
  const context = {
    fillStyle: '#000',
    font: 'normal 400 14px sans-serif',
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '#000',
    save() {
      hit('save')
      state.depth += 1
      state.maximumDepth = Math.max(state.maximumDepth, state.depth)
    },
    restore() {
      hit('restore')
      state.depth -= 1
      assert.ok(state.depth >= 0, 'Canvas state stack underflow')
    },
    setLineDash(value) {
      hit('setLineDash')
      state.dash = [...value]
    },
    measureText(value) {
      hit('measureText')
      return { width: String(value).length * 6 }
    }
  }
  for (const method of [
    'arc',
    'bezierCurveTo',
    'beginPath',
    'clearRect',
    'clip',
    'closePath',
    'drawImage',
    'ellipse',
    'fill',
    'fillRect',
    'fillText',
    'lineTo',
    'moveTo',
    'quadraticCurveTo',
    'rect',
    'rotate',
    'roundRect',
    'scale',
    'setTransform',
    'stroke',
    'strokeRect',
    'translate'
  ]) {
    context[method] = () => hit(method)
  }
  return { context, state }
}

function releaseSurface(surface) {
  surface.width = 0
  surface.height = 0
}

function compileDrawNode(overrides = {}) {
  const packet = sourceBetween('function drawNode', '\nfunction longTextLayoutDescriptor')
  return compileSource(packet, 'drawNode', {
    LINE_SHAPE_MIN_INNER_SIZE: .1,
    alpha: value => finiteNumber(value, 1),
    cachedImage: () => null,
    cachedImageReady: image => image?.complete === true && Number(image.naturalWidth) > 0,
    canvasNodeLayout: () => ({
      width: 40,
      height: 20,
      visualScaleX: 1,
      visualScaleY: 1,
      layoutWidth: 40,
      layoutHeight: 20,
      visualWorldPixel: 1,
      effectiveScaleX: 1,
      effectiveScaleY: 1
    }),
    drawImageFit: () => {},
    nodePath: () => {},
    isCanvasVisualAnimationCandidate,
    lineShapeBodyDashSegments: () => [],
    lineShapeBodyInset: () => 0,
    lineShapeBorderWidth: () => 1,
    lineShapeDashSegments: () => [],
    lineShapeInnerThickness: () => 0,
    materializeRuntimeNode: node => node,
    multiplyOpacity: () => 1,
    number: finiteNumber,
    readableStroke: value => value,
    runtimePointValue: () => undefined,
    runtimeValue: () => undefined,
    shapePoints: {},
    strokeNodeOutline: () => {},
    visibleStroke: () => 1,
    visualAnimationTimeline: { resolve: (_node, timestamp) => timestamp },
    ...overrides
  })
}

function compilePolyline(overrides = {}) {
  const packet = sourceBetween('function drawPolylineArrow', '\nfunction drawGrid')
  return compileSource(packet, 'drawPolyline', {
    flowDirectionDashOffset: () => 0,
    number: finiteNumber,
    polylineArrowSize: () => 4,
    polylineDashSegments: () => [],
    polylineLineOpacity: () => 1,
    polylineLineWidth: () => 2,
    polylineOutlineWidth: () => 2,
    polylineStrokeLineCap: () => 'round',
    props: { faithful: true },
    readableStroke: value => value,
    ...overrides
  })
}

test('drawNode balances its lineShape state when an inner fill throws', () => {
  const packet = sourceBetween('function drawNode', '\nfunction longTextLayoutDescriptor')
  const drawNode = compileSource(packet, 'drawNode', {
    alpha: value => finiteNumber(value, 1),
    canvasNodeLayout: () => ({
      width: 40,
      height: 12,
      visualScaleX: 1,
      visualScaleY: 1,
      layoutWidth: 40,
      layoutHeight: 12,
      visualWorldPixel: 1,
      effectiveScaleX: 1,
      effectiveScaleY: 1
    }),
    lineShapeBorderWidth: () => 1,
    lineShapeDashSegments: () => [],
    isCanvasVisualAnimationCandidate,
    materializeRuntimeNode: node => node,
    multiplyOpacity: () => 1,
    number: finiteNumber,
    readableStroke: value => value,
    runtimePointValue: () => undefined,
    runtimeValue: () => undefined,
    visibleStroke: () => 1,
    visualAnimationTimeline: { resolve: (_node, timestamp) => timestamp }
  })
  const { context, state } = createFaultCanvasContext({ method: 'fillRect' })
  const node = {
    type: 'lineShape',
    borderStyle: 'solid',
    backgroundOpacity: 1,
    opacity: 1
  }

  assert.throws(
    () => drawNode(context, node, 1, 1, 1, 'static', 1, { node }),
    /injected fillRect failure/
  )
  assert.equal(state.depth, 0, 'lineShape must restore both its inner state and the drawNode state')
})

test('fillAndStroke restores its opacity state when fill throws', () => {
  const packet = sourceBetween('function fillAndStroke', '\nfunction canvasTextFont')
  const fillAndStroke = compileSource(packet, 'fillAndStroke', {
    alpha: value => finiteNumber(value, 1),
    nodePath: () => {},
    strokeNodeOutline: () => {}
  })
  const { context, state } = createFaultCanvasContext({ method: 'fill' })

  assert.throws(() => fillAndStroke(context, { backgroundOpacity: 1 }, 40, 20, 1), /injected fill failure/)
  assert.equal(state.maximumDepth, 1)
  assert.equal(state.depth, 0, 'fillAndStroke must restore its saved opacity state')
})

test('text components paint their configurable fill before text in DOM and Canvas previews', () => {
  assert.match(
    nodeVisualSource,
    /\.node-body\.text\s*\{\s*background:\s*var\(--shape-fill\)\s*!important;\s*\}/
  )
  assert.match(
    nodeVisualSource,
    /'--shape-fill':\s*colorWithOpacity\(node\.fill, node\.backgroundOpacity \?\? 1\)/
  )

  const calls = []
  const node = {
    type: 'text',
    fill: '#123456',
    backgroundOpacity: .35,
    opacity: 1,
    text: '文本'
  }
  const drawNode = compileDrawNode({
    drawText: (_context, source) => calls.push(['text', source]),
    fillAndStroke: (_context, source, width, height, worldPixel) => {
      calls.push(['background', source, width, height, worldPixel])
    }
  })
  const { context } = createFaultCanvasContext()

  drawNode(context, node, 1, 1, 1, 'static', 1, { node })

  assert.deepEqual(calls.map(([kind]) => kind), ['background', 'text'])
  assert.equal(calls[0][1], node)
  assert.deepEqual(calls[0].slice(2), [40, 20, 1])
})

test('closed pencil fill failures restore the pencil state', () => {
  const packet = sourceBetween('function drawPencil', '\nfunction drawPolylineArrow')
  const drawPencil = compileSource(packet, 'drawPencil', {
    number: finiteNumber,
    props: { faithful: true },
    readableStroke: value => value
  })
  const { context, state } = createFaultCanvasContext({ method: 'fill' })
  const node = {
    pencilClosed: true,
    pencilPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    pencilSmooth: false,
    pencilWidth: 2
  }

  assert.throws(() => drawPencil(context, node, 40, 20, 1), /injected fill failure/)
  assert.equal(state.maximumDepth, 1)
  assert.equal(state.depth, 0, 'closed pencil fill must restore its saved state')
})

test('polyline stroke failures restore the nested stroke and polyline states', () => {
  const drawPolyline = compilePolyline()
  const { context, state } = createFaultCanvasContext({ method: 'stroke' })
  const node = {
    polylinePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  }

  assert.throws(() => drawPolyline(context, node, 40, 20, 1), /injected stroke failure/)
  assert.ok(state.maximumDepth >= 2, 'the injected failure must reach the nested stroke state')
  assert.equal(state.depth, 0, 'polyline stroke failure must restore every saved state')
})

test('polyline arrow failures restore arrow opacity, marker, and polyline states', () => {
  const drawPolyline = compilePolyline({ polylineOutlineWidth: () => 0 })
  const { context, state } = createFaultCanvasContext({ method: 'fill' })
  const node = {
    polylinePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    polylineStartMarker: 'arrow'
  }

  assert.throws(() => drawPolyline(context, node, 40, 20, 1), /injected fill failure/)
  assert.ok(state.maximumDepth >= 3, 'the injected failure must reach the nested arrow state')
  assert.equal(state.depth, 0, 'polyline arrow failure must restore every saved state')
})

test('flow-pipe stripe failures restore the clipping state', () => {
  const packet = sourceBetween('function drawFlowPipe', '\nfunction drawFan')
  const drawFlowPipe = compileSource(packet, 'drawFlowPipe', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    canvasVisualDetailSize,
    fillAndStroke: () => {},
    flowPipeDashOffset,
    roundedRect
  })
  const { context, state } = createFaultCanvasContext({ method: 'fillRect' })

  assert.throws(
    () => drawFlowPipe(context, { type: 'flowPipe', animation: 'flow' }, 100, 20, 1, 200),
    /injected fillRect failure/
  )
  assert.equal(state.maximumDepth, 1)
  assert.equal(state.depth, 0, 'flow-pipe stripe failure must restore its clipping state')
})

test('rotating fan blade failures restore the blade transform state', () => {
  const packet = sourceBetween('function drawFan', '\nfunction drawImageFit')
  const drawFan = compileSource(packet, 'drawFan', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    canvasVisualDetailSize,
    fillAndStroke: () => {},
    roundedRect,
    rotatingFanAngle
  })
  const { context, state } = createFaultCanvasContext({ method: 'fill', occurrence: 2 })

  assert.throws(() => drawFan(context, {}, 40, 20, 1), /injected fill failure/)
  assert.equal(state.maximumDepth, 2)
  assert.equal(state.depth, 0, 'rotating fan blade must restore its transform state')
})

test('drawImageFit restores its clipping state when drawImage throws', () => {
  const packet = sourceBetween('function drawImageFit', '\nfunction cachedImage')
  const drawImageFit = compileSource(packet, 'drawImageFit')
  const { context, state } = createFaultCanvasContext({ method: 'drawImage' })
  const image = { naturalHeight: 50, naturalWidth: 100 }

  assert.throws(() => drawImageFit(context, image, 40, 20, 'contain'), /injected drawImage failure/)
  assert.equal(state.maximumDepth, 1)
  assert.equal(state.depth, 0, 'image clipping state must be restored')
})

test('media placeholders use the same clipped background and configurable outline as loaded media', () => {
  const packet = sourceBetween('function drawMediaPlaceholder', '\nfunction drawFormControl')
  const calls = []
  const drawMediaPlaceholder = compileSource(packet, 'drawMediaPlaceholder', {
    alpha: value => finiteNumber(value, 1),
    nodePath: (_context, node, width, height) => calls.push(['path', node, width, height]),
    strokeNodeOutline: (_context, node, width, height, worldPixel) => calls.push(['outline', node, width, height, worldPixel]),
    visibleStroke: () => 2
  })
  const { context, state } = createFaultCanvasContext()
  context.clip = () => calls.push(['clip'])
  context.fillRect = (...args) => calls.push(['background', ...args])
  const node = { type: 'image', backgroundOpacity: .25, borderVisible: true, radius: 16 }

  drawMediaPlaceholder(context, node, 80, 60, .5, true)

  assert.deepEqual(calls.filter(([kind]) => ['path', 'clip', 'background', 'outline'].includes(kind)).map(([kind]) => kind), [
    'path', 'clip', 'background', 'outline'
  ])
  assert.equal(calls.at(-1)[1], node)
  assert.equal(calls.at(-1)[4], .5)
  assert.equal(state.depth, 0)
})

test('Canvas form controls use the same configurable fill and stroke colors as DOM controls', () => {
  const packet = sourceBetween('function drawFormControl', '\nfunction progressTrackFrame')
  const drawFormControl = compileSource(packet, 'drawFormControl', {
    drawGrid: () => {},
    number: finiteNumber,
    roundedRect
  })
  const render = node => {
    const { context } = createFaultCanvasContext()
    const operations = []
    let fillStyle = '#000'
    Object.defineProperty(context, 'fillStyle', {
      get: () => fillStyle,
      set: value => { fillStyle = value }
    })
    context.fill = () => operations.push(['fill', fillStyle])
    context.fillRect = (...args) => operations.push(['fillRect', fillStyle, ...args])
    drawFormControl(context, node, 100, 40, 2)
    return operations
  }

  for (const type of ['input', 'select', 'time']) {
    const operations = render({ type, fill: '#123456', stroke: '#654321' })
    assert.deepEqual(operations[0], ['fill', '#123456'], `${type} background must use node.fill`)
  }

  const switchOperations = render({ type: 'switch', checked: false, fill: '#123456', stroke: '#654321' })
  assert.deepEqual(switchOperations[0], ['fill', '#654321'], 'disabled switch track must use node.stroke')

  const progressOperations = render({
    type: 'formProgress',
    fill: '#123456',
    stroke: '#654321',
    progressValue: 25,
    progressMax: 100
  })
  assert.equal(progressOperations[0][0], 'fillRect')
  assert.equal(progressOperations[0][1], '#654321', 'progress track must use node.stroke')
  assert.equal(progressOperations[1][0], 'fillRect')
  assert.equal(progressOperations[1][1], '#123456', 'progress value must use node.fill')
})

test('signal light failures restore the nested opacity state', () => {
  const packet = sourceBetween('function drawSpecialNode', '\nfunction canvasNodeLayout')
  const drawSpecialNode = compileSource(packet, 'drawSpecialNode', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    VISUAL_HEARTBEAT_COLOR: '#ef5350',
    alpha: value => finiteNumber(value, 1),
    canvasVisualDetailSize,
    fillAndStroke: context => context.fill(),
    signalLightColor
  })
  const { context, state } = createFaultCanvasContext({ method: 'fill', occurrence: 2 })

  assert.throws(
    () => drawSpecialNode(context, { type: 'signalLight', signalOpacity: 1 }, 40, 20, 1),
    /injected fill failure/
  )
  assert.equal(state.maximumDepth, 1)
  assert.equal(state.depth, 0, 'signal light opacity state must be restored')
})

test('faithful dynamic visuals keep the shared frame without reusing dark text as their accent', () => {
  const fanPacket = sourceBetween('function drawFan', '\nfunction drawImageFit')
  const fanFillStyles = []
  const fanContext = createFaultCanvasContext().context
  Object.defineProperty(fanContext, 'fillStyle', {
    get: () => fanFillStyles.at(-1),
    set: value => fanFillStyles.push(value),
    configurable: true
  })
  const drawFan = compileSource(fanPacket, 'drawFan', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    canvasVisualDetailSize,
    fillAndStroke: () => {},
    roundedRect,
    rotatingFanAngle
  })
  drawFan(fanContext, { color: '#28323c' }, 110, 110, 1)
  assert.ok(fanFillStyles.includes('#16b89a'))
  assert.equal(fanFillStyles.includes('#28323c'), false)

  const specialPacket = sourceBetween('function drawSpecialNode', '\nfunction canvasNodeLayout')
  const frameCalls = []
  const signalFillStyles = []
  const signalContext = createFaultCanvasContext().context
  Object.defineProperty(signalContext, 'fillStyle', {
    get: () => signalFillStyles.at(-1),
    set: value => signalFillStyles.push(value),
    configurable: true
  })
  const drawSpecialNode = compileSource(specialPacket, 'drawSpecialNode', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    VISUAL_HEARTBEAT_COLOR: '#ef5350',
    alpha: value => finiteNumber(value, 1),
    canvasVisualDetailSize,
    fillAndStroke: (...args) => frameCalls.push(args.slice(1)),
    signalLightColor
  })
  const signal = { type: 'signalLight', color: '#28323c', fill: '#fff', signalColors: ['#21c58e'], signalOpacity: 1 }
  drawSpecialNode(signalContext, signal, 90, 130, 2, undefined, 'full', 1)
  assert.equal(frameCalls.length, 1, 'signal lights must draw the same configurable component frame as other visuals')
  assert.deepEqual(frameCalls[0], [signal, 90, 130, 1, '#fff'])
  assert.equal(signalFillStyles.includes('#26323d'), false)
  assert.ok(signalFillStyles.includes('#21c58e'))

  const customFillStyles = []
  const customContext = createFaultCanvasContext().context
  Object.defineProperty(customContext, 'fillStyle', {
    get: () => customFillStyles.at(-1),
    set: value => customFillStyles.push(value),
    configurable: true
  })
  drawSpecialNode(customContext, {
    type: 'customMotion',
    color: '#28323c',
    motionColor: '#f05a7e'
  }, 90, 90, 2, undefined, 'full', 1)
  assert.ok(customFillStyles.includes('#f05a7e'))
  assert.equal(customFillStyles.includes('#28323c'), false)

  const chartPacket = sourceBetween('function drawChart', '\nfunction drawGauge')
  assert.match(chartPacket, /const color = node\.chartColor \|\| VISUAL_ACCENT_COLOR/)
  assert.match(chartPacket, /ctx\.strokeStyle = color/)
  assert.match(chartPacket, /ctx\.fillStyle = color/)
  assert.doesNotMatch(chartPacket, /node\.color/)
  assert.match(sourceBetween('function drawGauge', '\nfunction drawFlowPipe'), /ctx\.strokeStyle = VISUAL_ACCENT_COLOR/)
  assert.match(sourceBetween('function drawFlowPipe', '\nfunction drawFan'), /ctx\.fillStyle = node\.visualPrimaryColor \|\| VISUAL_ACCENT_COLOR/)
  assert.match(specialPacket, /node\.motionColor \|\| VISUAL_ACCENT_COLOR/)
  assert.match(specialPacket, /ctx\.strokeStyle = node\.visualPrimaryColor \|\| VISUAL_HEARTBEAT_COLOR/)
})

test('static special components render through the shared configurable frame', () => {
  const packet = sourceBetween('function drawSpecialNode', '\nfunction canvasNodeLayout')
  const frameCalls = []
  const drawSpecialNode = compileSource(packet, 'drawSpecialNode', {
    VISUAL_ACCENT_COLOR: '#16b89a',
    VISUAL_HEARTBEAT_COLOR: '#ef5350',
    canvasVisualDetailSize,
    drawChart: () => {},
    drawGauge: () => {},
    fillAndStroke: (_context, node, width, height, worldPixel, fallbackFill) => {
      frameCalls.push({ fallbackFill, height, node, width, worldPixel })
    },
    hasEnabledRuntimeBinding: () => false,
    progressTrackFrame: () => ({ x: 0, y: 0, width: 100, height: 10, startRadius: 5, endRadius: 5 }),
    progressTrackPath: () => {},
    roundedRect: context => context.beginPath()
  })
  const { context } = createFaultCanvasContext()

  for (const type of ['chart', 'gauge', 'progress', 'server', 'database']) {
    const node = { type, backgroundOpacity: .35, borderVisible: true, radius: 18 }
    frameCalls.length = 0
    drawSpecialNode(context, node, 120, 80, 2, undefined, 'static', .5)
    assert.equal(frameCalls.length, 1, `${type} must draw one shared configurable frame`)
    assert.equal(frameCalls[0].node, node)
    assert.deepEqual([frameCalls[0].width, frameCalls[0].height, frameCalls[0].worldPixel], [120, 80, .5])
  }

  const serverBranch = sourceBetween("if (node.type === 'server')", "if (node.type === 'database')")
  const databaseBranch = sourceBetween("if (node.type === 'database')", "if (['network', 'router', 'disk', 'cloud', 'customMotion', 'customIndicator'].includes(node.type))")
  assert.doesNotMatch(serverBranch, /ctx\.fillStyle = node\.fill/, 'the server icon must not repaint the configurable background')
  assert.doesNotMatch(databaseBranch, /ctx\.fillStyle = node\.fill/, 'the database icon must not repaint the configurable background')
})

test('static progress geometry uses the configured length, thickness, and endpoint shapes', () => {
  const packet = sourceBetween('function progressTrackFrame', '\nfunction drawSpecialNode')
  const progressTrackFrame = compileSource(packet, 'progressTrackFrame', { number: finiteNumber })

  assert.deepEqual(
    progressTrackFrame({
      progressLength: 40,
      progressThickness: 8,
      progressStartShape: 'square',
      progressEndShape: 'round'
    }, 200, 60),
    { endRadius: 4, height: 8, startRadius: 0, width: 80, x: 60, y: 26 }
  )

  const progressBranch = sourceBetween("if (node.type === 'progress')", "if (node.type === 'server')")
  assert.match(progressBranch, /progressTrackFrame\(node, width, height\)/)
  assert.match(progressBranch, /progressTrackPath\(ctx, track\.x, track\.y, track\.width/)
})

test('drawNode restores dashed lineShape body state when stroke throws', () => {
  const drawNode = compileDrawNode()
  const { context, state } = createFaultCanvasContext({ method: 'stroke' })
  const node = {
    type: 'lineShape',
    borderStyle: 'dashed',
    backgroundOpacity: 1,
    opacity: 1
  }

  assert.throws(
    () => drawNode(context, node, 1, 1, 1, 'static', 1, { node }),
    /injected stroke failure/
  )
  assert.ok(state.maximumDepth >= 2, 'the injected failure must reach the lineShape body state')
  assert.equal(state.depth, 0, 'lineShape body and drawNode states must both be restored')
})

test('drawNode restores image background state when fillRect throws', () => {
  const image = { complete: true, naturalHeight: 50, naturalWidth: 100 }
  const drawNode = compileDrawNode({ cachedImage: () => image })
  const { context, state } = createFaultCanvasContext({ method: 'fillRect' })
  const node = {
    type: 'image',
    backgroundOpacity: 1,
    imageUrl: 'fixture.png',
    opacity: 1
  }

  assert.throws(
    () => drawNode(context, node, 1, 1, 1, 'static', 1, { node }),
    /injected fillRect failure/
  )
  assert.ok(state.maximumDepth >= 2, 'the injected failure must reach the image background state')
  assert.equal(state.depth, 0, 'image background and drawNode states must both be restored')
})

test('drawNode clips ready images to the component path before drawing the configured outline', () => {
  const image = { complete: true, naturalHeight: 50, naturalWidth: 100 }
  const calls = []
  const node = {
    type: 'image',
    backgroundOpacity: .4,
    borderDashGap: 7,
    borderDashLength: 11,
    borderStyle: 'dashed',
    borderVisible: true,
    borderWidth: 6,
    imageFit: 'cover',
    imageUrl: 'fixture.png',
    opacity: .45,
    radius: 10,
    stroke: '#ef3340'
  }
  const drawNode = compileDrawNode({
    cachedImage: () => image,
    drawImageFit: (_context, source, width, height, fit) => calls.push(['image', source, width, height, fit]),
    nodePath: (_context, source, width, height) => calls.push(['path', source, width, height]),
    strokeNodeOutline: (_context, source, width, height, worldPixel) => calls.push(['outline', source, width, height, worldPixel])
  })
  const { context, state } = createFaultCanvasContext()
  context.clip = () => calls.push(['clip'])
  context.fillRect = (...args) => calls.push(['background', ...args])

  drawNode(context, node, 1, 1, 1, 'static', 1, { node })

  assert.deepEqual(calls.map(([kind]) => kind), ['path', 'clip', 'background', 'image', 'outline'])
  assert.equal(calls[0][1], node)
  assert.deepEqual(calls[3].slice(2), [40, 20, 'cover'])
  assert.equal(calls[4][1], node)
  assert.equal(state.depth, 0)
})

test('closed temporary drawings balance both saved states when fill throws', () => {
  const packet = sourceBetween('function drawTemporaryDrawing', '\nfunction renderPayload')
  const drawTemporaryDrawing = compileSource(packet, 'drawTemporaryDrawing', {
    alpha: value => finiteNumber(value, 1),
    number: finiteNumber,
    props: { faithful: true },
    readableStroke: value => value
  })
  const { context, state } = createFaultCanvasContext({ method: 'fill' })
  const drawing = {
    closed: true,
    opacity: 1,
    points: [{ x: 0, y: 0 }, { x: 20, y: 20 }]
  }

  assert.throws(() => drawTemporaryDrawing(context, drawing, 1), /injected fill failure/)
  assert.equal(state.depth, 0, 'closed drawings must restore their fill and drawing states')
})

test('geometry composite drawing failures leave the committed context balanced', () => {
  const drawingPacket = sourceBetween('function drawTemporaryDrawing', '\nfunction renderPayload')
  const geometryPacket = sourceBetween('function drawGeometryCompositePlan', '\nfunction replaceGeometryOwnerSegments')
  const drawGeometryCompositePlan = compileSource(
    `${drawingPacket}\n${geometryPacket}`,
    'drawGeometryCompositePlan',
    {
      alpha: value => finiteNumber(value, 1),
      committedStaticFrame: {
        offsetX: 0,
        offsetY: 0,
        pixelRatioX: 1,
        pixelRatioY: 1,
        renderDrawings: true,
        renderNodes: false,
        scaleX: 1,
        scaleY: 1
      },
      committedStaticSurface: {},
      drawNode: () => {},
      number: finiteNumber,
      props: { faithful: true },
      readableStroke: value => value
    }
  )
  const { context, state } = createFaultCanvasContext({ method: 'fill' })
  const plan = {
    bitmapRect: { x: 0, y: 0, w: 40, h: 40 },
    entities: [{
      kind: 'drawing',
      entity: {
        id: 'drawing-1',
        closed: true,
        opacity: 1,
        points: [{ x: 0, y: 0 }, { x: 20, y: 20 }]
      }
    }]
  }

  assert.throws(
    () => drawGeometryCompositePlan(context, plan, {
      activeNodeIds: new Set(),
      nodeOpacityMultiplier: 1
    }),
    /injected fill failure/
  )
  assert.equal(state.depth, 0, 'geometry fallback must not inherit a leaked drawing state')
})

test('createStaticRenderSurface releases an unowned surface after setup failure', () => {
  const packet = sourceBetween('function fillRenderBackground', '\nfunction createRenderTask')
  const { context, state } = createFaultCanvasContext({ method: 'fillRect' })
  const surface = { width: 160, height: 90, getContext: () => context }
  const createStaticRenderSurface = compileSource(packet, 'createStaticRenderSurface', {
    acquireRenderSurface: () => surface,
    releaseRenderSurface: releaseSurface
  })

  assert.throws(() => createStaticRenderSurface({
    background: '#fff',
    bitmapHeight: 90,
    bitmapWidth: 160,
    height: 90,
    offsetX: 0,
    offsetY: 0,
    pixelRatioX: 1,
    pixelRatioY: 1,
    reuseSurfaces: true,
    scaleX: 1,
    scaleY: 1,
    stageHeight: 90,
    stageWidth: 160,
    width: 160
  }), /injected fillRect failure/)
  assert.deepEqual(
    { depth: state.depth, width: surface.width, height: surface.height },
    { depth: 0, width: 0, height: 0 }
  )
})

test('createRenderTask releases its surface when creation throws after save', () => {
  const packet = sourceBetween('function createRenderTask', '\nfunction prepareNodeIndex')
  const { context, state } = createFaultCanvasContext({ method: 'fillRect' })
  const surface = { width: 200, height: 120, getContext: () => context }
  const createRenderTask = compileSource(packet, 'createRenderTask', {
    acquireRenderSurface: () => surface,
    canReuseCanvasRenderSurface: () => false,
    canvasBitmapDimensions: () => ({
      bitmapWidth: 200,
      bitmapHeight: 120,
      pixelRatioX: 1,
      pixelRatioY: 1
    }),
    fillRenderBackground: ctx => ctx.fillRect(0, 0, 200, 120),
    currentAnimationTimestamp: () => 0,
    miniMapTransform: () => ({
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      viewBox: null
    }),
    number: finiteNumber,
    releaseRenderSurface: releaseSurface,
    reportCanvasRenderError: () => {}
  })

  assert.throws(() => createRenderTask({
    background: '#fff',
    edges: [],
    height: 120,
    incrementalRuntime: false,
    nodes: [],
    stageHeight: 120,
    stageWidth: 200,
    target: {},
    width: 200
  }, 1), /injected fillRect failure/)
  assert.deepEqual(
    { depth: state.depth, width: surface.width, height: surface.height },
    { depth: 0, width: 0, height: 0 }
  )
})

test('runtime seed failures quarantine the private composite surface', () => {
  const packet = sourceBetween('function seedRuntimeRenderSurface', '\nfunction resetRuntimeSurfaceSeed')
  const errors = []
  const seedRuntimeRenderSurface = compileSource(packet, 'seedRuntimeRenderSurface', {
    RUNTIME_SURFACE_SEED_STRIP_PIXELS: 1024,
    acquireRenderSurface: () => null,
    reportCanvasRenderError: (code, error) => errors.push({ code, error })
  })
  const { context } = createFaultCanvasContext({ method: 'drawImage' })
  const task = {
    composite: { getContext: () => context },
    ctx: null,
    frame: { bitmapHeight: 20, bitmapWidth: 40 },
    seedRectCursor: 0,
    seedRectY: 0,
    seedRects: [{ x: 0, y: 0, w: 40, h: 20 }],
    seedSource: {},
    surfaceReusable: true,
    valid: true
  }

  assert.equal(seedRuntimeRenderSurface(task, { shouldYield: () => false }), true)
  assert.equal(task.valid, false)
  assert.equal(task.surfaceReusable, false)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].code, 'runtime-surface-initialize-failed')
  assert.match(errors[0].error.message, /injected drawImage failure/)

  const unavailableTask = {
    ...task,
    composite: { getContext: () => null },
    ctx: null,
    seedRectCursor: 0,
    seedRectY: 0,
    seedRects: [{ x: 0, y: 0, w: 40, h: 20 }],
    seedSource: {},
    surfaceReusable: true,
    valid: true
  }
  assert.equal(seedRuntimeRenderSurface(unavailableTask, { shouldYield: () => false }), true)
  assert.equal(unavailableTask.valid, false)
  assert.equal(unavailableTask.surfaceReusable, false)
  assert.equal(errors.at(-1).code, 'runtime-surface-unavailable')
})

test('runtime cancellation quarantines surfaces when context cleanup fails', () => {
  const packet = sourceBetween('function releaseRuntimeRenderTask', '\nfunction runtimeRenderCompletion')
  const releases = []
  const releaseRuntimeRenderTask = compileSource(packet, 'releaseRuntimeRenderTask', {
    releaseRenderSurface: (surface, reusable) => releases.push({ surface, reusable }),
    releaseCanvasVisualSprites: () => {},
    clearCanvasVisualAtlasAttempt: () => {}
  })
  const makeTask = context => ({
    candidateWork: {},
    candidates: [{}],
    composite: {},
    coverageTracker: {},
    ctx: context,
    denseContextSaved: false,
    entities: [{}],
    frontComposite: {},
    nodes: [{}],
    regionAccumulator: {},
    regionContextSaved: true,
    regionCursor: {},
    surfaceReusable: true,
    textLayoutWork: {}
  })

  releaseRuntimeRenderTask(makeTask({
    restore() { throw new Error('restore failed') },
    set globalCompositeOperation(_value) {}
  }), null, 'cancelled')
  releaseRuntimeRenderTask(makeTask({
    restore() {},
    set globalCompositeOperation(_value) { throw new Error('reset failed') }
  }), null, 'cancelled')

  assert.deepEqual(releases.map(item => item.reusable), [false, false])
})

test('geometry context acquisition failures queue an authoritative frame', () => {
  const packet = sourceBetween('function commitGeometryPlans', '\nfunction applyGeometrySnapshot')
  let failure = 'static'
  let queued = 0
  const errors = []
  const context = {}
  const target = {
    getContext() {
      if (failure === 'target') throw new Error('target context failed')
      return context
    }
  }
  const surface = kind => ({
    getContext() {
      if (failure === kind) throw new Error(`${kind} context failed`)
      return context
    }
  })
  const dependencies = {
    canvas: { value: target },
    canvasContextGate: {
      accepts: () => true,
      capture: () => ({ target }),
      state: () => ({ lost: false })
    },
    commitCanvasSurface: () => true,
    committedCompositeSurface: surface('composite'),
    committedStaticSurface: surface('static'),
    drawGeometryCompositePlan: () => {},
    drawGeometryStaticPlan: () => {},
    needsIncrementalTextLayout: () => false,
    releaseRuntimeBackSurface: () => {},
    reportCanvasRenderError: (code, error) => errors.push({ code, error }),
    requestCoalescedRender: () => { queued += 1 }
  }
  const names = Object.keys(dependencies)
  const factory = new Function(
    ...names,
    `"use strict"; let committedGeometryIndexesComplete = true; ${packet}; return { commitGeometryPlans, indexesComplete: () => committedGeometryIndexesComplete };`
  )
  const harness = factory(...names.map(name => dependencies[name]))

  for (const source of ['static', 'composite', 'target']) {
    failure = source
    assert.equal(harness.commitGeometryPlans([{ bitmapRect: {} }], {}), false)
  }

  assert.equal(harness.indexesComplete(), false)
  assert.equal(queued, 3)
  assert.deepEqual(errors.map(item => item.code), Array(3).fill('geometry-commit-failed'))
  assert.deepEqual(errors.map(item => item.error.message), [
    'static context failed',
    'composite context failed',
    'target context failed'
  ])
})

test('edge marker failures restore the marker stack and command state', () => {
  const { context, state } = createFaultCanvasContext({ method: 'fill' })
  context.lineCap = 'square'
  const command = {
    color: '#485563',
    dash: true,
    endMarker: 'none',
    endMarkerSize: 8,
    endX: 30,
    endY: 20,
    lineWidth: 2,
    markerLineWidth: 1,
    startMarker: 'arrow',
    startMarkerSize: 8,
    startX: 0,
    startY: 0
  }

  assert.throws(() => drawEdgeRasterCommand(context, command), /injected fill failure/)
  assert.deepEqual(
    { depth: state.depth, dash: state.dash, lineCap: context.lineCap },
    { depth: 0, dash: [], lineCap: 'square' }
  )
})
