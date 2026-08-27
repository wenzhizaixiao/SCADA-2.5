import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import { h } from 'vue'
import { createServer } from 'vite'
import {
  COMPONENT_CATEGORY_BY_TYPE,
  createComponentGroups
} from '../src/config/componentCatalog.js'
import { baseNodeOptions, normalizeNode } from '../src/models/editorModel.js'
import {
  flowDirectionDashOffset,
  isCanvasVisualAnimationCandidate,
  isCanvasVisualAnimationNode
} from '../src/utils/canvasVisualAnimation.js'
import { PREVIEW_RENDER_CAPABILITIES, previewNodeRenderCapability } from '../src/utils/previewRenderPolicy.js'
import {
  isPolylineNodeType,
  polylineDashArray,
  polylineDashCycle
} from '../src/utils/polylineGeometry.js'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')

let nodeVisual
let vite

before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  })
  nodeVisual = (await vite.ssrLoadModule('/src/components/NodeVisual.vue')).default
})

after(async () => {
  await vite?.close()
})

function flowNode(overrides = {}) {
  return normalizeNode({
    ...baseNodeOptions(),
    id: 'flow-direction-test',
    type: 'flowDirection',
    x: 0,
    y: 0,
    w: 220,
    h: 130,
    animation: 'flow',
    polylineColor: '#16b89a',
    ...overrides
  })
}

test('registers flow direction as an animated component with polyline geometry', () => {
  const animated = createComponentGroups().find(group => group.name === '动效组件')
  assert.ok(animated?.items.some(item => item.type === 'flowDirection' && item.name === '流向'))
  assert.equal(COMPONENT_CATEGORY_BY_TYPE.get('flowDirection'), '动效组件')
  assert.equal(isPolylineNodeType('polyline'), true)
  assert.equal(isPolylineNodeType('flowDirection'), true)
  assert.equal(isPolylineNodeType('flowPipe'), false)
})

test('normalizes flow direction defaults and bounds custom dash spacing', () => {
  const normalized = flowNode({
    polylinePoints: [{ x: -.2, y: .2 }, { x: .4, y: 1.2 }, { x: 1, y: .6 }],
    polylineWidth: 500,
    borderDashLength: 0,
    borderDashGap: 100,
    flowArrowVisible: 'false',
    animation: 'invalid',
    animationDirection: 'alternate'
  })

  assert.deepEqual(normalized.polylinePoints, [{ x: 0, y: .2 }, { x: .4, y: 1 }, { x: 1, y: .6 }])
  assert.equal(normalized.text, '流向')
  assert.equal(normalized.polylineStyle, 'dashed')
  assert.equal(normalized.polylineWidth, 100)
  assert.equal(normalized.borderDashLength, .1)
  assert.equal(normalized.borderDashGap, 50)
  assert.equal(normalized.flowArrowVisible, false)
  assert.equal(normalized.animation, 'none')
  assert.equal(normalized.animationDirection, 'normal')

  const defaults = flowNode()
  assert.equal(defaults.animation, 'flow')
  assert.equal(defaults.animationPaused, false)
  assert.equal(defaults.flowArrowVisible, true)
  assert.equal(defaults.polylineColor, '#16b89a')
  assert.equal(polylineDashArray(defaults), '8 6')
  assert.equal(polylineDashCycle(defaults), 14)
})

test('uses one animation phase for Canvas and respects direction and pause', () => {
  const forward = flowNode({ animationDuration: 2, borderDashLength: 8, borderDashGap: 4 })
  const reverse = flowNode({ animationDuration: 2, animationDirection: 'reverse', borderDashLength: 8, borderDashGap: 4 })
  const paused = flowNode({ animationPaused: true })

  assert.equal(isCanvasVisualAnimationCandidate(forward), true)
  assert.equal(isCanvasVisualAnimationNode(forward), true)
  assert.equal(isCanvasVisualAnimationNode(paused), false)
  assert.equal(flowDirectionDashOffset(forward, 500), -3)
  assert.equal(flowDirectionDashOffset(reverse, 500), -9)
  assert.equal(flowDirectionDashOffset(paused, 500), flowDirectionDashOffset(flowNode(), 500))
  assert.equal(previewNodeRenderCapability(forward), PREVIEW_RENDER_CAPABILITIES.ANIMATED_CANVAS)
})

test('renders the moving dashed path and places the arrow at the configured direction endpoint', async () => {
  const forward = await renderToString(h(nodeVisual, { node: flowNode() }))
  assert.match(forward, /data-testid="flow-direction-path"/)
  assert.match(forward, /stroke-dasharray="8 6"/)
  assert.match(forward, /style="--flow-dash-cycle:14px;"/)
  assert.match(forward, /marker-end="url\(#[^"]*end-arrow\)"/)
  assert.doesNotMatch(forward, /marker-start="url\(#[^"]*start-arrow\)"/)

  const reverse = await renderToString(h(nodeVisual, {
    node: flowNode({ animationDirection: 'reverse' })
  }))
  assert.match(reverse, /marker-start="url\(#[^"]*start-arrow\)"/)
  assert.doesNotMatch(reverse, /marker-end="url\(#[^"]*end-arrow\)"/)

  const hidden = await renderToString(h(nodeVisual, {
    node: flowNode({ flowArrowVisible: false })
  }))
  assert.doesNotMatch(hidden, /marker-(?:start|end)=/)
  assert.match(enhancementCss, /\.animation-flow \.flow-direction-path[\s\S]*?animation:\s*preview-flow-direction-dash/)
  assert.match(enhancementCss, /@keyframes preview-flow-direction-dash[\s\S]*?stroke-dashoffset/)
})

test('reuses line-node creation and point editing while exposing complete flow controls', () => {
  assert.match(appSource, /isPolylineNodeType\(selected\.value\?\.type\)/)
  assert.match(appSource, /type:\s*draft\.type/)
  assert.match(appSource, /selected\.type === 'flowDirection'[\s\S]*?虚线长度[\s\S]*?虚线间隔[\s\S]*?流动方向[\s\S]*?显示方向箭头/)
  assert.match(appSource, /v-if="isPolylineNodeType\(selected\.type\)" class="polyline-point-editor"/)
  assert.match(miniMapSource, /function drawPolyline\(ctx, node, width, height, worldPixel, animationTimestamp = 0\)/)
  assert.match(miniMapSource, /flowDirectionDashOffset\(node, animationTimestamp\)/)
  assert.match(miniMapSource, /node\.type === 'flowDirection'/)
  assert.match(appSource, /const previewSmallDocument = computed\(\(\) => \([\s\S]*?!shouldUseAnimatedFlowDirectionLod\(nodes\.value\)/)
})
