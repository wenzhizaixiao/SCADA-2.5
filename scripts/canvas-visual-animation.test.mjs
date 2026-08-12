import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CANVAS_VISUAL_ANIMATION_FPS,
  CANVAS_VISUAL_FAST_ANIMATION_FPS,
  canvasVisualAnimationFramePlan,
  canvasVisualDetailSize,
  canvasVisualAnimationPhase,
  createCanvasVisualAnimationTimeline,
  flowPipeDashOffset,
  heartbeatAnimationScale,
  isCanvasVisualAnimationCandidate,
  isCanvasVisualAnimationNode,
  particleAnimationState,
  rotatingFanAngle,
  signalLightColor,
  waterTankAnimationState,
  waterTankWaveColor
} from '../src/utils/canvasVisualAnimation.js'
import {
  createRuntimeCandidateCursor,
  createRuntimeQueryCursor
} from '../src/utils/runtimeCanvasRegions.js'
import {
  canvasVisualAtlasBlitData,
  drawCanvasVisualAtlasBlits
} from '../src/utils/canvasVisualAtlas.js'
import { rectangularNodeBorderGeometry } from '../src/utils/nodeBorderGeometry.js'

const EPSILON = 1e-10
const miniMapSource = readFileSync(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const enhancementSource = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const CANVAS_VISUAL_TYPES = Object.freeze([
  'flowPipe',
  'rotatingFan',
  'signalLight',
  'waterTank',
  'heartbeat',
  'particles'
])

function sourceBetween(startMarker, endMarker) {
  const start = miniMapSource.indexOf(startMarker)
  const end = miniMapSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return miniMapSource.slice(start, end)
}

function compileSource(packet, exportExpression, dependencies = {}) {
  const names = Object.keys(dependencies)
  const factory = new Function(
    ...names,
    `"use strict"; ${packet}; return ${exportExpression};`
  )
  return factory(...names.map(name => dependencies[name]))
}

function visualCanvasRecorder() {
  const calls = {
    arcs: [],
    clips: 0,
    dashOffsets: [],
    ellipses: [],
    fillRects: [],
    fillStyles: [],
    lineDashes: [],
    rotations: [],
    scales: [],
    strokes: [],
    strokeRects: [],
    translations: []
  }
  let currentPath = []
  const context = {
    globalAlpha: 1,
    lineCap: 'butt',
    lineWidth: 1,
    strokeStyle: '#000',
    arc(...args) { calls.arcs.push(args) },
    bezierCurveTo(...args) { currentPath.push(['C', ...args]) },
    beginPath() { currentPath = [] },
    clip() { calls.clips += 1 },
    ellipse(...args) { calls.ellipses.push(args) },
    fill() {},
    fillRect(...args) { calls.fillRects.push(args) },
    fillText() {},
    lineTo(x, y) { currentPath.push(['L', x, y]) },
    moveTo(x, y) { currentPath.push(['M', x, y]) },
    rect(x, y, width, height) { currentPath.push(['R', x, y, width, height]) },
    restore() {},
    rotate(value) { calls.rotations.push(value) },
    save() {},
    scale(x, y) { calls.scales.push([x, y]) },
    setLineDash(segments) { calls.lineDashes.push([...segments]) },
    stroke() {
      calls.strokes.push({
        lineCap: context.lineCap,
        lineWidth: context.lineWidth,
        path: currentPath.map(command => [...command]),
        strokeStyle: context.strokeStyle
      })
    },
    strokeRect(...args) { calls.strokeRects.push({ args, lineWidth: context.lineWidth, strokeStyle: context.strokeStyle }) },
    translate(x, y) { calls.translations.push([x, y]) }
  }
  Object.defineProperty(context, 'fillStyle', {
    get: () => calls.fillStyles.at(-1),
    set: value => calls.fillStyles.push(value),
    configurable: true
  })
  Object.defineProperty(context, 'lineDashOffset', {
    get: () => calls.dashOffsets.at(-1) || 0,
    set: value => calls.dashOffsets.push(value),
    configurable: true
  })
  return { calls, context }
}

function assertClose(actual, expected, message, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`)
}

function animatedNode(type, overrides = {}) {
  return {
    type,
    animation: 'flow',
    animationPaused: false,
    animationDuration: 1,
    animationDirection: 'normal',
    ...overrides
  }
}

test('Canvas visual animation work stays within its per-frame budget', () => {
  assert.equal(CANVAS_VISUAL_ANIMATION_FPS, 30)
  assert.equal(CANVAS_VISUAL_FAST_ANIMATION_FPS, 60)
})

test('Canvas animation frame planning starts at 30 FPS regardless of visible node count', () => {
  const inactive = canvasVisualAnimationFramePlan({ visibleCount: 0, now: 100 })
  assert.deepEqual(inactive, {
    active: false,
    fps: 0,
    intervalMs: 0,
    shouldRender: false,
    delayMs: 0,
    frameTimestamp: null
  })
  assert.equal(Object.isFrozen(inactive), true)

  for (const visibleCount of [1, 128, 256, 966, 4698, 20_000]) {
    const plan = canvasVisualAnimationFramePlan({ visibleCount, now: 250 })
    assert.equal(plan.active, true)
    assertClose(plan.fps, 30, `${visibleCount} visible animations must start at the configured cap`)
    assert.equal(plan.intervalMs, 1000 / 30)
    assert.equal(plan.shouldRender, true)
    assert.equal(plan.frameTimestamp, 250)
    assert.equal(Object.isFrozen(plan), true)
  }
})

test('Canvas animation frame planning uses measured active work and recovers immediately', () => {
  const overloaded = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    measuredFrameMs: 100,
    previousIntervalMs: 1000 / 30,
    now: 500
  })
  assert.equal(overloaded.fps, 8, '100ms of measured complete-frame work applies backpressure')

  const normalized = canvasVisualAnimationFramePlan({
    visibleCount: 512,
    measuredFrameMs: 40,
    measuredVisibleCount: 128,
    now: 500
  })
  assert.equal(normalized.fps, 4, 'measurements scale to the current visible-node count')

  const firstRecovery = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    previousIntervalMs: 500,
    now: 500
  })
  assertClose(firstRecovery.fps, 30, 'a stale slow interval must not throttle a recovered frame')
  const recoveredAfterSpike = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    measuredFrameMs: 62,
    previousIntervalMs: 1000,
    now: 500
  })
  assert.equal(recoveredAfterSpike.fps, 12, 'one normal active-work sample must recover directly to its safe rate')
})

test('fast animation periods keep enough real frame samples to avoid slow aliasing', () => {
  const overloadedFast = canvasVisualAnimationFramePlan({
    visibleCount: 4698,
    measuredFrameMs: 100,
    minimumAnimationDurationSeconds: .2,
    now: 500
  })
  assertClose(overloadedFast.fps, 60, 'a 0.2s period requires the fast real-frame sampling ceiling')
  assertClose(overloadedFast.intervalMs, 1000 / 60, 'fast animation interval')

  const moderate = canvasVisualAnimationFramePlan({
    visibleCount: 4698,
    measuredFrameMs: 100,
    minimumAnimationDurationSeconds: .4,
    now: 500
  })
  assertClose(moderate.fps, 30, 'a 0.4s period must not be backpressured below its observable rate')

  const ordinary = canvasVisualAnimationFramePlan({
    visibleCount: 4698,
    measuredFrameMs: 100,
    minimumAnimationDurationSeconds: 1.5,
    now: 500
  })
  assert.equal(ordinary.fps, 8, 'ordinary periods retain adaptive backpressure')
})

test('Canvas animation frame planning applies backpressure and one timestamp per atomic frame', () => {
  const waiting = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    now: 1000,
    lastFrameTimestamp: 980
  })
  assert.equal(waiting.shouldRender, false)
  assertClose(waiting.delayMs, 1000 / 30 - 20, 'remaining frame delay')
  assert.equal(waiting.frameTimestamp, null)

  const due = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    now: 1020,
    lastFrameTimestamp: 980
  })
  assert.equal(due.shouldRender, true)
  assert.equal(due.delayMs, 0)
  assert.equal(due.frameTimestamp, 1020, 'the complete task shares the current frame timestamp')

  const pending = canvasVisualAnimationFramePlan({
    visibleCount: 128,
    now: 1020,
    lastFrameTimestamp: 980,
    pending: true
  })
  assert.equal(pending.shouldRender, false)
  assert.equal(pending.delayMs, 0)
  assert.equal(pending.frameTimestamp, null)
})

test('only supported running visual effects enter the Canvas animation set', () => {
  assert.equal(isCanvasVisualAnimationNode(animatedNode('flowPipe')), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('rotatingFan')), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('waterTank')), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('heartbeat', { animation: 'pulse' })), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('particles')), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('signalLight', {
    animation: 'blink',
    signalColorCount: 2,
    signalColors: ['#00ff00', '#ff0000']
  })), true)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('flowPipe', { animationPaused: true })), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('rotatingFan', { animation: 'none' })), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('waterTank', { animation: 'pulse' })), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('heartbeat')), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('signalLight', {
    animation: 'blink',
    signalColorCount: 1,
    signalColors: ['#00ff00']
  })), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('signalLight')), false)
  assert.equal(isCanvasVisualAnimationNode(null), false)
})

test('Canvas animation candidates remain trackable while playback is paused', () => {
  const pausedPipe = animatedNode('flowPipe', { animationPaused: true })
  const pausedFan = animatedNode('rotatingFan', { animationPaused: true })
  const pausedTank = animatedNode('waterTank', { animationPaused: true })
  const pausedHeartbeat = animatedNode('heartbeat', { animation: 'pulse', animationPaused: true })
  const pausedParticles = animatedNode('particles', { animationPaused: true })
  const pausedSignal = animatedNode('signalLight', {
    animation: 'blink',
    animationPaused: true,
    signalColorCount: 2,
    signalColors: ['#00aa00', '#cc0000']
  })

  for (const node of [pausedPipe, pausedFan, pausedTank, pausedHeartbeat, pausedParticles, pausedSignal]) {
    assert.equal(isCanvasVisualAnimationCandidate(node), true)
    assert.equal(isCanvasVisualAnimationNode(node), false)
  }
  assert.equal(isCanvasVisualAnimationCandidate(animatedNode('flowPipe', { animation: 'none' })), false)
  assert.equal(isCanvasVisualAnimationCandidate(animatedNode('waterTank', { animation: 'none' })), false)
  assert.equal(isCanvasVisualAnimationCandidate(animatedNode('heartbeat', { animation: 'flow' })), false)
  assert.equal(isCanvasVisualAnimationCandidate(animatedNode('signalLight', {
    animation: 'blink',
    signalColorCount: 1,
    signalColors: ['#00aa00']
  })), false)
  assert.equal(isCanvasVisualAnimationCandidate({ type: 'rect', animation: 'flow' }), false)
  assert.equal(isCanvasVisualAnimationCandidate(null), false)
})

test('MiniMap animation collection includes every built-in visual effect', () => {
  const declaration = miniMapSource.match(/const canvasVisualAnimationTypes = new Set\(\[([^\]]+)]\)/)?.[1]
  assert.ok(declaration, 'expected the MiniMap Canvas animation type set')
  for (const type of CANVAS_VISUAL_TYPES) {
    assert.match(declaration, new RegExp(`['"]${type}['"]`), `${type} must participate in Canvas animation refreshes`)
  }
})

test('built-in animation controls feed both DOM and Canvas preview paths', () => {
  const controlsStart = appSource.indexOf('<h3>动效属性</h3>')
  assert.notEqual(controlsStart, -1)
  const controls = appSource.slice(controlsStart, controlsStart + 1800)
  assert.match(controls, /v-model="selected\.animation"/)
  assert.match(controls, /v-model\.number="selected\.animationDuration"/)
  assert.match(controls, /@change="normalizeBuiltInAnimationDuration\(selected\)"/)
  assert.match(controls, /v-model="selected\.animationDirection"/)
  assert.match(controls, /v-model="selected\.animationPaused"/)

  assert.match(nodeVisualSource, /'--motion-speed':\s*`\$\{node\.animationDuration \|\| 1\.5\}s`/)
  assert.match(nodeVisualSource, /'--motion-direction':\s*node\.animationDirection \|\| 'normal'/)
  assert.match(nodeVisualSource, /'motion-paused':\s*node\.animationPaused/)
  assert.match(
    nodeVisualSource,
    /builtInAnimationActive\.value\s*&&\s*node\.value\.animationPaused\s*!==\s*true/,
    'cold-start pause must use the runtime-materialized node'
  )
  assert.match(enhancementSource, /animation-duration:\s*var\(--motion-speed, 1\.5s\) !important/)
  assert.match(enhancementSource, /animation-direction:\s*var\(--motion-direction, normal\) !important/)
  assert.match(enhancementSource, /\.motion-paused \*/)
  assert.match(nodeVisualSource, /'--built-in-animation-delay':\s*builtInAnimationDelay/)
  assert.match(enhancementSource, /\.animation-flow \.fan-rotor[\s\S]*?animation-delay:\s*var\(--built-in-animation-delay, 0s\)/)
  assert.doesNotMatch(nodeVisualSource, /fan-direction-marker/)
  assert.doesNotMatch(enhancementSource, /\.fan-direction-marker/)
  assert.match(enhancementSource, /\.animation-flow \.particles-visual i[\s\S]*?calc\(var\(--built-in-animation-delay, 0s\) \+ var\(--particle-delay, 0s\)\)/)

  assertClose(canvasVisualAnimationPhase(animatedNode('flowPipe', { animationDuration: 2 }), 500), .25, 'Canvas duration control')
  assertClose(canvasVisualAnimationPhase(animatedNode('rotatingFan', { animationDirection: 'reverse' }), 250), .75, 'Canvas direction control')

  const durationCommit = appSource.slice(
    appSource.indexOf('function normalizeBuiltInAnimationDuration'),
    appSource.indexOf('\nfunction normalizeWaterTankProgress')
  )
  assert.ok(durationCommit.length > 0)
  assert.match(durationCommit, /node\.animationDuration = Math\.max\([\s\S]*?markMiniMapDirty\(\)/)
})

test('signal light color cycling does not also blink its DOM border', () => {
  assert.match(
    enhancementSource,
    /\.animation-blink:not\(\.signalLight\)\s*>\s*svg/,
    'generic SVG blink must exclude the signal light custom border'
  )
  assert.doesNotMatch(enhancementSource, /\.animation-blink\s*>\s*svg/)
})

test('DOM signal lights freeze their JavaScript clock for reduced motion', () => {
  assert.match(nodeVisualSource, /if \(props\.preview\) \{[\s\S]*?signalReducedMotion\.value = false[\s\S]*?return/)
  assert.match(nodeVisualSource, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(nodeVisualSource, /function handleSignalMotionPreferenceChange/)
  assert.match(nodeVisualSource, /signalAnimationTimeline\.setSuspended\(next, timestamp, \[node\.value\]\)/)
  assert.match(nodeVisualSource, /const active = !signalReducedMotion\.value[\s\S]*?&& candidate/)
  assert.match(nodeVisualSource, /releaseVisualClock\(SIGNAL_CLOCK_FPS\)/)
  assert.match(nodeVisualSource, /removeEventListener\?\.\('change', handleSignalMotionPreferenceChange\)/)
})

test('DOM and Canvas built-in effects share none, duration, direction, and pause semantics', () => {
  assert.match(enhancementSource, /\.animation-flow \.animated-pipe i/)
  assert.match(enhancementSource, /\.animation-flow \.fan-rotor/)
  assert.match(enhancementSource, /\.animation-flow \.tank-visual i::before/)
  assert.match(enhancementSource, /\.animation-pulse \.heartbeat-visual/)
  assert.match(enhancementSource, /\.animation-flow \.particles-visual i/)
  assert.match(enhancementSource, /animation-duration:\s*var\(--motion-speed, 1\.5s\) !important/)
  assert.match(enhancementSource, /animation-direction:\s*var\(--motion-direction, normal\) !important/)
  assert.match(enhancementSource, /\.motion-paused[\s\S]*?animation-play-state:\s*paused !important/)
  assert.match(enhancementSource, /@keyframes preview-water[\s\S]*?25%[\s\S]*?50%[\s\S]*?75%/)
  assert.match(enhancementSource, /preview-water var\(--motion-speed, 1\.5s\) ease-in-out infinite/)
  assert.match(enhancementSource, /\.node-shell:not\(\.preview-node\) \.node-body/)

  for (const type of ['flowPipe', 'rotatingFan', 'waterTank', 'particles']) {
    assert.equal(isCanvasVisualAnimationCandidate(animatedNode(type, { animation: 'none' })), false)
  }
  assert.equal(isCanvasVisualAnimationCandidate(animatedNode('heartbeat', { animation: 'none' })), false)
  assert.equal(isCanvasVisualAnimationNode(animatedNode('rotatingFan', { animationPaused: true })), false)
})

test('Canvas animation timeline freezes paused phases and resumes without a jump', () => {
  const timeline = createCanvasVisualAnimationTimeline()
  const running = animatedNode('rotatingFan', { id: 'fan' })
  const paused = { ...running, animationPaused: true }

  assert.equal(timeline.resolve({ ...paused, id: 'cold-paused-fan' }, 900), 0)
  assert.equal(timeline.resolve(running, 200), 200, 'running effects use the shared preview clock')
  assert.equal(timeline.resolve({ ...running }, 450), 450)
  const frozenAt = timeline.resolve({ ...paused }, 700)
  assert.equal(frozenAt, 700)
  assert.equal(timeline.resolve({ ...paused }, 1200), frozenAt)
  assertClose(canvasVisualAnimationPhase(paused, frozenAt), .7, 'paused phase')

  const resumedAt = timeline.resolve({ ...running }, 1500)
  assert.equal(resumedAt, frozenAt)
  assertClose(canvasVisualAnimationPhase(running, resumedAt), .7, 'resumed phase')
  assert.equal(timeline.resolve({ ...running }, 1750), 950)

  timeline.remove('fan')
  assert.equal(timeline.resolve({ ...running }, 2000), 2000, 'remove rejoins the shared preview clock')

  const second = animatedNode('flowPipe', { id: 'pipe' })
  timeline.resolve(second, 2000)
  timeline.resolve({ ...second, animationPaused: true }, 2250)
  timeline.retain(['pipe'])
  assert.equal(timeline.resolve({ ...second, animationPaused: true }, 2600), 2250)
  assert.equal(timeline.resolve({ ...running, animationPaused: true }, 2600), 0, 'retain drops stale node state')

  timeline.clear()
  assert.equal(timeline.resolve({ ...second, animationPaused: true }, 3000), 0)
})

test('Canvas animation timeline reads older committed frames without rewinding live state', () => {
  const timeline = createCanvasVisualAnimationTimeline()
  const node = animatedNode('signalLight', {
    id: 'monotonic-signal',
    animation: 'blink',
    signalColorCount: 4,
    signalColors: ['#001100', '#002200', '#003300', '#004400']
  })

  assert.equal(timeline.resolve(node, 240), 240)
  assert.equal(timeline.resolve(node, 260), 260)
  assert.equal(timeline.resolve(node, 240), 240, 'an older committed timestamp is a read, not a rewind')
  assert.equal(timeline.resolve(node, 300), 300, 'later playback must not double-count the rewound interval')
})

test('Canvas animation timeline can freeze at the last displayed phase for reduced motion', () => {
  const timeline = createCanvasVisualAnimationTimeline()
  const node = animatedNode('rotatingFan', { id: 'reduced-motion-fan' })

  assert.equal(timeline.resolve(node, 100), 100)
  assert.equal(timeline.resolve(node, 600), 600)
  timeline.setSuspended(true, 1600, [node])
  assert.equal(timeline.resolve(node, 2000), 600, 'reduced-motion time must not accrue while frozen')
  timeline.setSuspended(false, 2000)
  assert.equal(timeline.resolve(node, 2250), 600, 'the first resumed observation preserves the frozen phase')
  assert.equal(timeline.resolve(node, 2500), 850)
})

test('Canvas visual animation phase follows duration and loops deterministically', () => {
  const node = animatedNode('flowPipe', { animationDuration: 2 })

  assertClose(canvasVisualAnimationPhase(node, 0), 0, 'initial phase')
  assertClose(canvasVisualAnimationPhase(node, 500), .25, 'quarter phase')
  assertClose(canvasVisualAnimationPhase(node, 1500), .75, 'three-quarter phase')
  assertClose(canvasVisualAnimationPhase(node, 2000), 0, 'loop boundary')
  assertClose(
    canvasVisualAnimationPhase(animatedNode('flowPipe', { animationDuration: 0 }), 750),
    .5,
    'invalid duration uses the 1.5 second model default'
  )
  assertClose(canvasVisualAnimationPhase(node, Number.NaN), 0, 'invalid timestamp')
})

test('Canvas visual animation phase respects reverse and alternate directions', () => {
  assertClose(
    canvasVisualAnimationPhase(animatedNode('rotatingFan', { animationDirection: 'reverse' }), 250),
    .75,
    'reverse phase'
  )
  const alternating = animatedNode('rotatingFan', { animationDirection: 'alternate' })
  assertClose(canvasVisualAnimationPhase(alternating, 250), .25, 'alternate forward iteration')
  assertClose(canvasVisualAnimationPhase(alternating, 1250), .75, 'alternate reverse iteration')
})

test('flow pipe dash offset follows the resolved phase and rejects non-pipe candidates', () => {
  const node = animatedNode('flowPipe')

  assertClose(flowPipeDashOffset(node, 2, 0), 0, 'initial dash offset')
  assertClose(flowPipeDashOffset(node, 2, 500), -7, 'half-cycle dash offset')
  assertClose(flowPipeDashOffset(node, 2, 1000), 0, 'looped dash offset')
  assertClose(
    flowPipeDashOffset({ ...node, animationDirection: 'reverse' }, 2, 250),
    -10.5,
    'reverse dash offset'
  )
  const paused = { ...node, id: 'paused-pipe', animationPaused: true }
  const pausedTimestamp = createCanvasVisualAnimationTimeline().resolve(paused, 500)
  assertClose(flowPipeDashOffset(paused, 2, pausedTimestamp), 0, 'cold paused dash offset')
  assertClose(flowPipeDashOffset(animatedNode('rotatingFan'), 2, 500), 0, 'non-pipe dash offset')
})

test('rotating fan angle follows the resolved phase and rejects non-fan candidates', () => {
  const node = animatedNode('rotatingFan')

  assertClose(rotatingFanAngle(node, 250), Math.PI / 2, 'quarter-turn fan angle')
  assertClose(
    rotatingFanAngle({ ...node, animationDirection: 'reverse' }, 250),
    Math.PI * 1.5,
    'reverse fan angle'
  )
  const paused = { ...node, id: 'paused-fan', animationPaused: true }
  const pausedTimestamp = createCanvasVisualAnimationTimeline().resolve(paused, 250)
  assertClose(rotatingFanAngle(paused, pausedTimestamp), 0, 'cold paused fan angle')
  assertClose(rotatingFanAngle(animatedNode('flowPipe'), 250), 0, 'non-fan angle')
})

test('water tank animation state follows duration and direction without changing the configured level', () => {
  const node = animatedNode('waterTank', { animationDuration: 2, progressValue: 37 })

  assert.deepEqual(waterTankAnimationState(node, 0), { phase: 0, waveOffset: 0, waveScale: 1.04 })
  const quarter = waterTankAnimationState(node, 500)
  assertClose(quarter.phase, .25, 'water phase')
  assertClose(quarter.waveOffset, 1, 'water wave right crest')
  assertClose(quarter.waveScale, 1, 'water wave right crest width')
  const eighth = waterTankAnimationState(node, 250)
  assertClose(eighth.waveOffset, .5, 'water wave uses the DOM keyframe interpolation')
  assertClose(eighth.waveScale, 1.02, 'water width uses the DOM keyframe interpolation')
  const sixteenth = waterTankAnimationState(node, 125)
  assertClose(sixteenth.waveOffset, .1291619, 'water wave eases naturally between keyframes', 1e-6)
  assertClose(sixteenth.waveScale, 1.0348335, 'water width uses the same eased frame', 1e-6)
  const midpoint = waterTankAnimationState(node, 1000)
  assertClose(midpoint.phase, .5, 'water midpoint phase')
  assertClose(midpoint.waveOffset, 0, 'water wave midpoint')
  assertClose(midpoint.waveScale, .96, 'water wave midpoint width')
  const reversed = waterTankAnimationState({ ...node, animationDirection: 'reverse' }, 500)
  assertClose(reversed.phase, .75, 'reverse water phase')
  assertClose(reversed.waveOffset, -1, 'reverse water left crest')
  assertClose(reversed.waveScale, 1, 'reverse water left crest width')
  assert.notEqual(quarter.waveOffset, reversed.waveOffset, 'normal and reverse must not collapse to the same visual state')
  const alternateReversePass = waterTankAnimationState({ ...node, animationDirection: 'alternate' }, 2500)
  assertClose(alternateReversePass.phase, .75, 'alternate water reverse pass')
  assertClose(alternateReversePass.waveOffset, -1, 'alternate water reverses on the second iteration')
  assert.equal(node.progressValue, 37, 'animation state must not mutate the persisted liquid level')
  assert.deepEqual(
    waterTankAnimationState({ ...node, animation: 'none' }, 500),
    { phase: 0, waveOffset: 0, waveScale: 1 }
  )
})

test('heartbeat pulse produces a short double beat, rests, and follows duration and direction', () => {
  const node = animatedNode('heartbeat', { animation: 'pulse', animationDuration: 1 })

  assertClose(heartbeatAnimationScale(node, 0), 1, 'heartbeat resting scale')
  assertClose(heartbeatAnimationScale(node, 100), 1.18, 'first beat crest')
  assertClose(heartbeatAnimationScale(node, 200), .96, 'first beat rebound')
  assertClose(heartbeatAnimationScale(node, 300), 1.1, 'second beat crest')
  assertClose(heartbeatAnimationScale(node, 420), 1, 'heartbeat settles after the second crest')
  assertClose(heartbeatAnimationScale(node, 700), 1, 'heartbeat keeps a natural resting interval')
  assertClose(heartbeatAnimationScale(node, 25), 1.023249, 'heartbeat uses CSS ease-in-out between keyframes', 1e-6)
  assertClose(
    heartbeatAnimationScale({ ...node, animationDirection: 'reverse' }, 900),
    heartbeatAnimationScale(node, 100),
    'reverse heartbeat phase'
  )
  assert.equal(heartbeatAnimationScale({ ...node, animation: 'none' }, 150), 1)
})

test('particle states mirror the DOM keyframes with eight evenly staggered phases', () => {
  const node = animatedNode('particles')

  assert.deepEqual(particleAnimationState(node, 0, 0), {
    phase: 0,
    translateX: -22,
    opacity: 0
  })
  const fullyVisibleStart = particleAnimationState(node, 0, 200)
  assertClose(fullyVisibleStart.phase, .2, 'particle fade-in boundary phase')
  assertClose(fullyVisibleStart.translateX, -8.6, 'particle fade-in boundary position')
  assertClose(fullyVisibleStart.opacity, 1, 'particle fade-in boundary opacity')
  const fullyVisibleEnd = particleAnimationState(node, 0, 800)
  assertClose(fullyVisibleEnd.phase, .8, 'particle fade-out boundary phase')
  assertClose(fullyVisibleEnd.translateX, 31.6, 'particle fade-out boundary position')
  assertClose(fullyVisibleEnd.opacity, 1, 'particle fade-out boundary opacity')
  const fading = particleAnimationState(node, 0, 900)
  assertClose(fading.phase, .9, 'particle fade-out phase')
  assertClose(fading.translateX, 38.3, 'particle fade-out position')
  assertClose(fading.opacity, .5, 'particle fade-out opacity')

  const staggered = particleAnimationState(node, 1, 0)
  assertClose(staggered.phase, .125, 'the second particle starts one eighth of a cycle ahead')
  assertClose(staggered.translateX, -13.625, 'staggered particle position')
  assertClose(staggered.opacity, .625, 'staggered particle opacity')
  assert.equal(
    new Set(Array.from({ length: 8 }, (_, index) => particleAnimationState(node, index, 0).phase)).size,
    8,
    'all particles must use distinct phases instead of moving in two synchronized groups'
  )

  const slower = animatedNode('particles', { animationDuration: 2 })
  assertClose(particleAnimationState(slower, 0, 500).phase, .25, 'particle duration')
  assertClose(
    particleAnimationState(slower, 1, 0).phase,
    .125,
    'particle stagger scales with the configured duration'
  )
  assertClose(
    particleAnimationState({ ...node, animationDirection: 'reverse' }, 0, 250).phase,
    .75,
    'reverse particle direction'
  )
  assertClose(
    particleAnimationState({ ...node, animationDirection: 'alternate' }, 0, 1250).phase,
    .75,
    'alternate particle direction'
  )
  assert.deepEqual(particleAnimationState({ ...node, animation: 'none' }, 0, 500), {
    phase: 0,
    translateX: 0,
    opacity: 1
  })
})

test('particle playback shares the pausable Canvas timeline without phase jumps', () => {
  const timeline = createCanvasVisualAnimationTimeline()
  const running = animatedNode('particles', { id: 'particles' })
  const paused = { ...running, animationPaused: true }

  assert.equal(timeline.resolve(running, 100), 100)
  const pausedAt = timeline.resolve(paused, 600)
  assert.equal(pausedAt, 600)
  assert.equal(timeline.resolve(paused, 1600), pausedAt)
  assertClose(particleAnimationState(paused, 0, pausedAt).phase, .6, 'paused particle phase')
  assert.equal(timeline.resolve(running, 2000), pausedAt)
  assert.equal(timeline.resolve(running, 2250), 850)
})

test('signal light color advances through its configured palette and respects direction', () => {
  const node = animatedNode('signalLight', {
    animation: 'blink',
    animationDuration: .9,
    signalColorCount: 3,
    signalColors: ['#00aa00', '#ffaa00', '#cc0000']
  })

  assert.equal(signalLightColor(node, 0), '#00aa00')
  assert.equal(signalLightColor(node, 450), '#ffaa00')
  assert.equal(signalLightColor(node, 750), '#cc0000')
  assert.equal(signalLightColor(node, 900), '#00aa00')
  assert.equal(signalLightColor({ ...node, animationDirection: 'reverse' }, 150), '#cc0000')
  assert.equal(signalLightColor({ ...node, animationDirection: 'alternate' }, 1050), '#cc0000')
  assert.equal(signalLightColor({ ...node, animation: 'none' }, 750), '#00aa00')
})

test('multiple signal lights use one global phase while keeping their own palettes', () => {
  const first = animatedNode('signalLight', {
    id: 'signal-first',
    animation: 'blink',
    animationDuration: .6,
    signalColorCount: 3,
    signalColors: ['#aa0000', '#ffaa00', '#00aa00']
  })
  const second = animatedNode('signalLight', {
    id: 'signal-second',
    animation: 'blink',
    animationDuration: .6,
    signalColorCount: 3,
    signalColors: ['#0000aa', '#aa00aa', '#00aaaa']
  })

  assert.equal(signalLightColor(first, 500), '#00aa00')
  assert.equal(signalLightColor(second, 500), '#00aaaa')

  const recoloredSecond = {
    ...second,
    signalColors: ['#112233', '#445566', '#778899']
  }
  assert.equal(signalLightColor(recoloredSecond, 500), '#778899')
  assert.deepEqual(first.signalColors, ['#aa0000', '#ffaa00', '#00aa00'])
  assert.deepEqual(second.signalColors, ['#0000aa', '#aa00aa', '#00aaaa'])
})

test('signal light pause freezes the current color and resumes without a phase jump', () => {
  const running = animatedNode('signalLight', {
    id: 'signal-pause-resume',
    animation: 'blink',
    animationDuration: .9,
    signalColorCount: 3,
    signalColors: ['#00aa00', '#ffaa00', '#cc0000']
  })
  const paused = { ...running, animationPaused: true }
  const timeline = createCanvasVisualAnimationTimeline()

  assert.equal(timeline.resolve(running, 100), 100, 'signal lights retain the shared global phase')
  assert.equal(timeline.resolve(running, 550), 550)
  const pausedAt = timeline.resolve(paused, 700)
  assert.equal(pausedAt, 700)
  assert.equal(signalLightColor(paused, pausedAt), '#cc0000')
  assert.equal(timeline.resolve(paused, 1700), pausedAt)
  assert.equal(signalLightColor(paused, pausedAt), '#cc0000')
  const resumedAt = timeline.resolve(running, 2000)
  assert.equal(resumedAt, pausedAt)
  assert.equal(signalLightColor(running, resumedAt), '#cc0000')
  assert.equal(timeline.resolve(running, 2200), 900)
  assert.equal(signalLightColor(running, 900), '#00aa00')
  assert.doesNotMatch(nodeVisualSource, /signalClockStartedAt/)
  assert.match(nodeVisualSource, /return signalLightColor\(source, signalAnimationTimeline\.resolve\(source, timestamp\)\)/)
  assert.match(miniMapSource, /visualAnimationTimeline\.resolve\(node, rawAnimationTimestamp\)/)
})

test('signal light timeline resets when color switching is disabled and keeps pause semantics separate', () => {
  const timeline = createCanvasVisualAnimationTimeline()
  const blinking = animatedNode('signalLight', {
    id: 'toggle-signal',
    animation: 'blink',
    signalColorCount: 2,
    signalColors: ['#00aa00', '#cc0000']
  })
  assert.equal(timeline.resolve(blinking, 400), 400)
  assert.equal(timeline.remove(blinking), true)
  assert.equal(timeline.resolve({ ...blinking, animation: 'none' }, 0), 0)
  timeline.remove(blinking)
  assert.equal(timeline.resolve(blinking, 900), 900)

  const syncSignalClockStart = nodeVisualSource.indexOf('function syncSignalClock')
  const syncSignalClockEnd = nodeVisualSource.indexOf('\nfunction currentSignalColor', syncSignalClockStart)
  assert.notEqual(syncSignalClockStart, -1)
  assert.notEqual(syncSignalClockEnd, -1)
  const syncSignalClockSource = nodeVisualSource.slice(syncSignalClockStart, syncSignalClockEnd)
  assert.match(syncSignalClockSource, /const candidate = source\.animation === 'blink'[\s\S]*?colors\.length > 1/)
  assert.match(syncSignalClockSource, /if \(!candidate\) signalAnimationTimeline\.remove\(source\)/)
  const currentSignalColorStart = nodeVisualSource.indexOf('function currentSignalColor')
  const currentSignalColorEnd = nodeVisualSource.indexOf('\nfunction pencilPath', currentSignalColorStart)
  assert.notEqual(currentSignalColorStart, -1)
  assert.notEqual(currentSignalColorEnd, -1)
  assert.match(
    nodeVisualSource.slice(currentSignalColorStart, currentSignalColorEnd),
    /signalClock\?\.value \?\? visualTimestamp\(\)/,
    'a paused local signal must observe the current time instead of rewinding its timeline to zero'
  )
})

test('signal lights use the shared component frame while keeping one configurable lamp core', () => {
  const signalCanvasSource = sourceBetween("if (node.type === 'signalLight')", "if (node.type === 'waterTank')")
  assert.match(signalCanvasSource, /fillAndStroke\(ctx, node, width, height, worldPixel, '#fff'\)/)
  assert.match(signalCanvasSource, /signalLightColor\(node, animationTimestamp\)[\s\S]*?ctx\.arc\(width \/ 2, height \/ 2, signalRadius/)
  assert.match(nodeVisualSource, /background: node\.type === 'polyline' \? 'transparent'/)
  assert.match(nodeVisualSource, /!\['lineShape','pencil','polyline'\]\.includes\(node\.type\)/)
  assert.doesNotMatch(appSource, /type === 'signalLight' \? \{ backgroundOpacity: 0, borderVisible: false \} : null/)
})

test('rectangular DOM borders share one pixel geometry for every rounded component', () => {
  assert.deepEqual(
    rectangularNodeBorderGeometry({ w: 90, h: 130, borderWidth: 2, radius: 43 }),
    { width: 88, height: 128, strokeWidth: 2, outerRadius: 43, radius: 42 }
  )
  assert.deepEqual(
    rectangularNodeBorderGeometry({ w: 140, h: 72, borderWidth: 2, radius: 100 }),
    { width: 138, height: 70, strokeWidth: 2, outerRadius: 36, radius: 35 }
  )
  assert.match(nodeVisualSource, /const customBorderGeometry = computed\(\(\) => rectangularNodeBorderGeometry\(visualNode\.value\)\)/)
  assert.match(nodeVisualSource, /`0 0 \$\{customBorderGeometry\.width\} \$\{customBorderGeometry\.height\}`/)
  assert.match(nodeVisualSource, /:rx="customBorderGeometry\.radius" :ry="customBorderGeometry\.radius"/)
  assert.match(enhancementSource, /\.node-body\.terminal\s*\{\s*border-radius:\s*var\(--shape-outer-radius, 0\) !important;/)
})

test('LOD signal-light overlays follow the last successfully committed Canvas frame', () => {
  const fullCompletion = sourceBetween('function fullRenderCompletion', '\nfunction frameCommitAccepted')
  const runtimeCompletion = sourceBetween('function runtimeRenderCompletion', '\nfunction commitRuntimeRenderTask')

  assert.match(fullCompletion, /animationTimestamp:\s*task\.animationTimestamp/)
  assert.match(runtimeCompletion, /animationTimestamp:\s*task\.animationTimestamp/)
  assert.match(nodeVisualSource, /signalAnimationTimestamp:\s*\{\s*type:\s*Number,\s*default:\s*null\s*\}/)
  assert.match(nodeVisualSource, /Number\.isFinite\(Number\(props\.signalAnimationTimestamp\)\)/)
  assert.match(nodeVisualSource, /signalLightColor\(source,\s*signalAnimationTimeline\.resolve\(source, timestamp\)\)/)
  assert.match(appSource, /function syncEditorLodAnimationTimestamp/)
  assert.match(appSource, /function editorLodSignalAnimationTimestamp/)
  assert.match(appSource, /:signal-animation-timestamp="editorLodSignalAnimationTimestamp\(n\)"/)
  assert.match(appSource, /v-memo="\[[^\]]*editorLodSignalAnimationTimestamp\(n\)[^\]]*\]"/)
})

test('signal light color supports the legacy single-color field without exposing invalid values', () => {
  const node = animatedNode('signalLight', {
    animation: 'blink',
    signalColor: '#123456',
    signalColorCount: 2,
    signalColors: null
  })

  assert.equal(signalLightColor(node, 0), '#123456')
  assert.equal(signalLightColor(node, 750), '#ef5350')
  assert.equal(signalLightColor({ ...node, signalColor: '' }, 0), '#21c58e')
})

test('MiniMap Canvas borders use the configured dash length and gap', () => {
  const strokeNodeOutline = compileSource(
    sourceBetween('function strokeNodeOutline', '\nfunction fillAndStroke'),
    'strokeNodeOutline',
    {
      nodePath: context => context.beginPath(),
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      visibleStroke: () => 3
    }
  )
  const dashed = visualCanvasRecorder()
  strokeNodeOutline(dashed.context, {
    borderDashLength: 13,
    borderDashGap: 7,
    borderStyle: 'dashed',
    borderVisible: true,
    borderWidth: 3
  }, 100, 60, 1)
  assert.deepEqual(dashed.calls.lineDashes, [[13, 7], []])

  const dotted = visualCanvasRecorder()
  strokeNodeOutline(dotted.context, {
    borderDashLength: 4,
    borderDashGap: 9,
    borderStyle: 'dotted',
    borderVisible: true,
    borderWidth: 3
  }, 100, 60, 1)
  assert.deepEqual(dotted.calls.lineDashes, [[4, 9], []])
  assert.equal(dotted.calls.strokes.at(-1).lineCap, 'round')
})

test('MiniMap timestamps reach all six animated Canvas component commands', () => {
  const drawFlowPipe = compileSource(
    sourceBetween('function drawFlowPipe', '\nfunction drawFan'),
    'drawFlowPipe',
    {
      VISUAL_ACCENT_COLOR: '#16b89a',
      canvasVisualDetailSize,
      fillAndStroke: () => {},
      flowPipeDashOffset
    }
  )
  const pipeNode = animatedNode('flowPipe')
  const firstPipe = visualCanvasRecorder()
  const secondPipe = visualCanvasRecorder()
  drawFlowPipe(firstPipe.context, pipeNode, 100, 20, 1, 0)
  drawFlowPipe(secondPipe.context, pipeNode, 100, 20, 1, 500)
  const firstPipeFlow = firstPipe.calls.strokes.find(call => call.strokeStyle === '#16b89a')
  const secondPipeFlow = secondPipe.calls.strokes.find(call => call.strokeStyle === '#16b89a')
  assert.equal(firstPipe.calls.strokeRects[0].strokeStyle, '#3c8fa0')
  assert.ok(firstPipeFlow.path.length >= 8, 'pipe flow must remain recognizable as repeated diagonal stripes')
  assert.notEqual(firstPipeFlow.path[0][1], secondPipeFlow.path[0][1], 'pipe stripes must move between frames')
  assertClose(
    secondPipeFlow.path[0][1] - firstPipeFlow.path[0][1],
    -10,
    'Canvas pipe must move half of the DOM 20px pattern during half a cycle'
  )

  const drawFan = compileSource(
    sourceBetween('function drawFan', '\nfunction drawImageFit'),
    'drawFan',
    {
      VISUAL_ACCENT_COLOR: '#16b89a',
      canvasVisualDetailSize,
      fillAndStroke: () => {},
      rotatingFanAngle
    }
  )
  const firstFan = visualCanvasRecorder()
  const secondFan = visualCanvasRecorder()
  drawFan(firstFan.context, animatedNode('rotatingFan'), 80, 80, 1, 0)
  drawFan(secondFan.context, animatedNode('rotatingFan'), 80, 80, 1, 125)
  assertClose(firstFan.calls.rotations[0], 0, 'initial fan command')
  assertClose(secondFan.calls.rotations[0], Math.PI / 4, 'advanced fan command')
  const fullSizeBlades = firstFan.calls.strokes.filter(call => call.strokeStyle === '#16b89a')
  assert.equal(fullSizeBlades.length, 4)
  assert.ok(fullSizeBlades.every(call => call.lineWidth === 8), 'Canvas blade width must match the DOM 8px blade')
  assert.ok(fullSizeBlades.every(call => JSON.stringify(call.path) === JSON.stringify([
    ['M', 0, 0],
    ['L', 0, -20]
  ])), 'Canvas blade length and direction must match the DOM 64px fan geometry')
  assert.equal(firstFan.calls.rotations.length, 4, 'fan must not add an extra rotating marker')
  assert.equal(secondFan.calls.rotations.length, 4, 'advanced fan must keep only four blade transforms')

  const lowZoomPipe = visualCanvasRecorder()
  drawFlowPipe(lowZoomPipe.context, pipeNode, 190, 48, 5, 250)
  const lowZoomPipeFlow = lowZoomPipe.calls.strokes.find(call => call.strokeStyle === '#16b89a')
  assert.ok(lowZoomPipe.calls.strokeRects.length >= 1, 'low-zoom pipe keeps its square-ended track')
  assert.ok(lowZoomPipeFlow.lineWidth / 5 >= .89, 'low-zoom pipe flow remains close to one screen pixel')

  const lowZoomFan = visualCanvasRecorder()
  drawFan(lowZoomFan.context, animatedNode('rotatingFan'), 110, 110, 5, 125)
  const lowZoomBlades = lowZoomFan.calls.strokes.filter(call => call.strokeStyle === '#16b89a')
  assert.equal(lowZoomBlades.length, 4, 'low-zoom fan uses four same-color rotating blades')
  assert.ok(lowZoomBlades.every(call => call.lineWidth / 5 >= .99), 'low-zoom fan blades remain at least one screen pixel')
  assertClose(lowZoomFan.calls.rotations[0], Math.PI / 4, 'low-zoom fan phase')

  const halfTurnFan = visualCanvasRecorder()
  drawFan(halfTurnFan.context, animatedNode('rotatingFan'), 110, 110, 5, 500)
  assert.equal(halfTurnFan.calls.strokes.filter(call => call.strokeStyle === '#16b89a').length, 4)
  assertClose(halfTurnFan.calls.rotations[0], Math.PI, 'half-turn fan angle')

  const drawSpecialNode = compileSource(
    sourceBetween('function drawSpecialNode', '\nfunction canvasNodeLayout'),
    'drawSpecialNode',
    {
      VISUAL_ACCENT_COLOR: '#16b89a',
      VISUAL_HEARTBEAT_COLOR: '#ef5350',
      alpha: value => Number.isFinite(Number(value)) ? Number(value) : 1,
      canvasVisualDetailSize,
      fillAndStroke: () => {},
      heartbeatAnimationScale,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      particleAnimationState,
      roundedRect: () => {},
      signalLightColor,
      waterTankAnimationState,
      waterTankWaveColor
    }
  )
  const signalNode = animatedNode('signalLight', {
    animation: 'blink',
    animationDuration: .4,
    signalColorCount: 2,
    signalColors: ['#00aa00', '#cc0000'],
    signalOpacity: 1
  })
  const firstSignal = visualCanvasRecorder()
  const secondSignal = visualCanvasRecorder()
  drawSpecialNode(firstSignal.context, signalNode, 80, 80, 1, undefined, 'full', 1, 0)
  drawSpecialNode(secondSignal.context, signalNode, 80, 80, 1, undefined, 'full', 1, 250)
  assert.equal(firstSignal.calls.fillStyles.at(-1), '#00aa00')
  assert.equal(secondSignal.calls.fillStyles.at(-1), '#cc0000')

  const tankNode = animatedNode('waterTank', { progressValue: 37, visualPrimaryColor: '#ff0000' })
  const firstTank = visualCanvasRecorder()
  const secondTank = visualCanvasRecorder()
  const thirdTank = visualCanvasRecorder()
  drawSpecialNode(firstTank.context, tankNode, 68, 95, 1, undefined, 'full', 1, 0)
  drawSpecialNode(secondTank.context, tankNode, 68, 95, 1, undefined, 'full', 1, 250)
  drawSpecialNode(thirdTank.context, tankNode, 68, 95, 1, undefined, 'full', 1, 500)
  assert.deepEqual(
    firstTank.calls.fillRects,
    secondTank.calls.fillRects,
    'water animation must not replace or change the configured liquid-height fill'
  )
  assert.notDeepEqual(
    firstTank.calls.ellipses,
    secondTank.calls.ellipses,
    'water surface must move between animation timestamps'
  )
  assert.ok(
    firstTank.calls.ellipses[0][0] < secondTank.calls.ellipses[0][0]
      && thirdTank.calls.ellipses[0][0] < secondTank.calls.ellipses[0][0],
    'Canvas water surface must follow the DOM center-right-center traveling phase'
  )
  assert.ok(
    firstTank.calls.ellipses[0][2] > secondTank.calls.ellipses[0][2]
      && secondTank.calls.ellipses[0][2] > thirdTank.calls.ellipses[0][2],
    'Canvas water surface width must follow the DOM 1.04-1-.96 scale'
  )
  assert.ok(firstTank.calls.fillStyles.includes('#ff0000'))
  assert.ok(firstTank.calls.fillStyles.includes('#ff7373'), 'water surface color must be derived from the configured liquid color')

  const heartbeatNode = animatedNode('heartbeat', { animation: 'pulse' })
  const firstHeartbeat = visualCanvasRecorder()
  const secondHeartbeat = visualCanvasRecorder()
  drawSpecialNode(firstHeartbeat.context, heartbeatNode, 80, 80, 1, undefined, 'full', 1, 0)
  drawSpecialNode(secondHeartbeat.context, heartbeatNode, 80, 80, 1, undefined, 'full', 1, 150)
  assert.notDeepEqual(
    firstHeartbeat.calls.strokes,
    secondHeartbeat.calls.strokes,
    'heartbeat geometry must pulse between Canvas frames'
  )

  const firstParticles = visualCanvasRecorder()
  const secondParticles = visualCanvasRecorder()
  const particleNode = animatedNode('particles')
  drawSpecialNode(firstParticles.context, particleNode, 100, 52, 1, undefined, 'full', 1, 0)
  drawSpecialNode(secondParticles.context, particleNode, 100, 52, 1, undefined, 'full', 1, 250)
  assert.equal(firstParticles.calls.arcs.length, 8)
  assert.equal(secondParticles.calls.arcs.length, 8)
  assert.notEqual(firstParticles.calls.arcs[0][0], secondParticles.calls.arcs[0][0], 'particles must move between timestamps')

  const lowZoomSignal = visualCanvasRecorder()
  drawSpecialNode(lowZoomSignal.context, signalNode, 90, 130, 1, undefined, 'full', 5, 0)
  const signalOutline = lowZoomSignal.calls.strokes.at(-1)
  assert.ok(lowZoomSignal.calls.arcs.length >= 1, 'low-zoom signal light keeps its circular core')
  assert.ok(signalOutline.lineWidth / 5 >= .59, 'low-zoom signal outline remains visible')

  assert.match(miniMapSource, /animationTimestamp: task\.animationTimestamp/)
  assert.match(miniMapSource, /drawSpecialNode\([^\n]+animationTimestamp\)/)
})

test('MiniMap geometry interaction redraws use the current animation timestamp', () => {
  const currentTimestamp = 4321
  const geometrySnapshot = compileSource(
    sourceBetween('function geometrySnapshot', '\nfunction geometryRegions'),
    'geometrySnapshot',
    {
      alpha: value => Number.isFinite(Number(value)) ? Number(value) : 1,
      currentAnimationTimestamp: () => currentTimestamp,
      geometryNodeLookup: nodes => new Map(nodes.map(node => [node.id, node])),
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
    }
  )
  const node = animatedNode('rotatingFan', { id: 'geometry-fan' })
  const snapshot = geometrySnapshot({ nodes: [node], geometryRevision: 7 })
  assert.equal(snapshot.animationTimestamp, currentTimestamp)

  let drawOptions = null
  const drawGeometryCompositePlan = compileSource(
    sourceBetween('function drawGeometryCompositePlan', '\nfunction replaceGeometryOwnerSegments'),
    'drawGeometryCompositePlan',
    {
      committedStaticFrame: {
        bitmapHeight: 100,
        bitmapWidth: 100,
        offsetX: 0,
        offsetY: 0,
        pixelRatioX: 1,
        pixelRatioY: 1,
        renderDrawings: true,
        renderNodes: true,
        scaleX: 1,
        scaleY: 1
      },
      committedStaticSurface: {},
      drawNode: (...args) => { drawOptions = args.at(-1) },
      drawTemporaryDrawing: () => {}
    }
  )
  const context = {
    beginPath() {},
    clearRect() {},
    clip() {},
    drawImage() {},
    rect() {},
    restore() {},
    save() {},
    scale() {},
    setTransform() {},
    translate() {}
  }
  drawGeometryCompositePlan(context, {
    bitmapRect: { x: 0, y: 0, w: 20, h: 20 },
    entities: [{ kind: 'node', entity: node }]
  }, snapshot)
  assert.equal(drawOptions.animationTimestamp, currentTimestamp)
  assert.doesNotMatch(
    sourceBetween('function drawGeometryCompositePlan', '\nfunction replaceGeometryOwnerSegments'),
    /frame\.animationTimestamp/
  )
})

test('MiniMap full renders retain paused candidates without scheduling them while stopped', () => {
  const tracking = compileSource(
    sourceBetween('function collectTaskVisualAnimationNode', '\nfunction drawEntities'),
    '({ collectTaskVisualAnimationNode, orderedTaskVisualAnimationNodes })',
    {
      canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
      isCanvasVisualAnimationCandidate,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: node => node,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      runtimePointValue: () => undefined
    }
  )
  const task = {
    animationCandidateIds: new Set(),
    animationNodes: [],
  }
  const candidates = [
    animatedNode('flowPipe', { id: 'pipe' }),
    animatedNode('rotatingFan', { id: 'paused-fan', animationPaused: true }),
    animatedNode('waterTank', { id: 'tank' }),
    animatedNode('heartbeat', { id: 'heartbeat', animation: 'pulse' }),
    animatedNode('particles', { id: 'particles' }),
    animatedNode('signalLight', {
      id: 'signal',
      animation: 'blink',
      signalColorCount: 2,
      signalColors: ['#00aa00', '#cc0000']
    }),
    animatedNode('flowPipe', { id: 'static-pipe', animation: 'none' })
  ]
  for (const node of candidates) tracking.collectTaskVisualAnimationNode(task, node)
  assert.deepEqual([...task.animationCandidateIds], ['pipe', 'paused-fan', 'tank', 'heartbeat', 'particles', 'signal'])
  assert.deepEqual(task.animationNodes.map(node => node.id), ['pipe', 'tank', 'heartbeat', 'particles', 'signal'])
  assert.deepEqual(
    tracking.orderedTaskVisualAnimationNodes(task).map(node => node.id),
    ['pipe', 'tank', 'heartbeat', 'particles', 'signal']
  )
})

test('MiniMap runtime playback bindings add and remove clock members synchronously', () => {
  const packet = sourceBetween('function visualAnimationNodeKey', '\nfunction clipsOverflow')
  const node = animatedNode('rotatingFan', {
    id: 'runtime-fan',
    dataBindings: [{ target: 'animationPlaying', pointId: 'fan-playing' }]
  })
  const controls = { now: 100, playing: false, clockSyncs: 0 }
  const nodeMap = new Map()
  const timeline = createCanvasVisualAnimationTimeline()
  const descriptorCache = new WeakMap([[node, { stale: true }]])
  const streamStates = new WeakMap([[node, { stale: true }]])
  const syncRuntimeVisualAnimationNodes = compileSource(
    packet,
    'syncRuntimeVisualAnimationNodes',
    {
      canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
      canvasVisualAnimationStreamStates: streamStates,
      canvasVisualSpriteDescriptorCache: descriptorCache,
      committedExcludedNodeIds: new Set(),
      committedSignalLightColors: new Map(),
      committedVisualAnimationNodeMap: nodeMap,
      committedVisualAnimationNodes: [],
      currentAnimationTimestamp: () => controls.now,
      invalidateCanvasVisualDirectAtlasFrame: () => {},
      isCanvasVisualAnimationCandidate,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: source => ({ ...source, animationPaused: !controls.playing }),
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      props: { nodeIndex: new Map([[node.id, node]]) },
      runtimePointValue: () => controls.playing,
      syncVisualAnimationClock: () => { controls.clockSyncs += 1 },
      visualAnimationTimeline: timeline,
      visualAnimationViewportDirty: false
    }
  )

  assert.equal(syncRuntimeVisualAnimationNodes([node]), false)
  assert.equal(nodeMap.size, 0)
  assert.equal(controls.clockSyncs, 0)
  assert.equal(descriptorCache.has(node), false, 'runtime changes must invalidate the materialized descriptor')
  assert.equal(streamStates.has(node), false, 'runtime changes must invalidate the cached animation stream')

  controls.now = 400
  controls.playing = true
  assert.equal(syncRuntimeVisualAnimationNodes([node]), true)
  assert.equal(nodeMap.get(node.id), node)
  assert.equal(controls.clockSyncs, 1, 'false to true must start or resubscribe the clock')

  controls.now = 700
  assert.equal(syncRuntimeVisualAnimationNodes([node]), false)
  assert.equal(controls.clockSyncs, 1, 'an unchanged member must not churn the shared clock')

  controls.now = 900
  controls.playing = false
  assert.equal(syncRuntimeVisualAnimationNodes([node]), true)
  assert.equal(nodeMap.size, 0)
  assert.equal(controls.clockSyncs, 2, 'true to false must release or resubscribe the clock')
  assert.equal(timeline.resolve({ ...node, animationPaused: true }, 1200), 500)
})

test('MiniMap full commits reconcile runtime animation changes received during rendering', () => {
  const packet = sourceBetween(
    'committedVisualAnimationNodes = nextVisualAnimationNodes',
    '\n\n  committedGeneration.value'
  )
  const runtimeFan = animatedNode('rotatingFan', { id: 'runtime-fan' })
  const pendingRuntimeNodes = new Map([[runtimeFan.id, runtimeFan]])
  const commitTask = {
    excludedDrawingIds: new Set(['new-drawing']),
    excludedNodeIds: new Set(['new-node'])
  }
  const calls = []
  assert.ok(
    packet.indexOf('committedExcludedNodeIds = task.excludedNodeIds')
      < packet.indexOf('syncRuntimeVisualAnimationNodes([...pendingRuntimeNodes.values()])'),
    'runtime reconciliation must use the newly committed exclusion set'
  )
  const commitVisualAnimationState = compileSource(
    `function commitVisualAnimationState() { ${packet} }`,
    'commitVisualAnimationState',
    {
      committedExcludedDrawingIds: new Set(['old-drawing']),
      committedExcludedNodeIds: new Set(['old-node']),
      committedVisualAnimationNodeMap: new Map([['stale-fan', animatedNode('rotatingFan')]]),
      committedVisualAnimationNodes: [],
      commitSignalLightColors: () => {},
      nextVisualAnimationCandidateIds: new Set(['task-fan']),
      nextVisualAnimationNodes: [animatedNode('rotatingFan', { id: 'task-fan' })],
      pendingRuntimeNodes,
      resetVisualAnimationFramePacing: () => {},
      syncRuntimeVisualAnimationNodes: nodes => calls.push({ nodes }),
      task: commitTask,
      visualAnimationTimeline: {
        retain: ids => calls.push({ retained: new Set(ids) })
      },
      visualAnimationViewportDirty: false
    }
  )

  commitVisualAnimationState()

  assert.deepEqual(calls[0].retained, new Set(['task-fan']))
  assert.deepEqual(calls[1].nodes, [runtimeFan])
  assert.equal(pendingRuntimeNodes.size, 1, 'the queued runtime render must still repaint the latest pixels')
})

test('MiniMap returns the complete visible continuous-animation set without cursor rotation', () => {
  const packet = sourceBetween('function clipsOverflow', '\nfunction requestVisualAnimationRender')
  assert.doesNotMatch(packet, /canvasVisualAnimationBatchSize|visualAnimationBatchSequence/)
  assert.doesNotMatch(packet, /visualAnimationNodeCursor|visibleVisualAnimationNodeCursor/)

  const continuousTypes = ['flowPipe', 'rotatingFan', 'waterTank', 'heartbeat', 'particles']
  const nodes = Array.from({ length: 300 }, (_, index) => {
    const type = continuousTypes[index % continuousTypes.length]
    return animatedNode(type, {
      id: `animation-${index}`,
      animation: type === 'heartbeat' ? 'pulse' : 'flow',
      layer: index,
      x: index,
      y: index,
      w: 10,
      h: 10
    })
  })
  const nodeMap = new Map(nodes.map(node => [node.id, node]))

  function createFrameHarness(visibleCandidates) {
    return compileSource(
      packet,
      '({ refreshVisibleVisualAnimationNodes, nextVisualAnimationNodeBatch })',
      {
        canvas: { value: {} },
        canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
        committedExcludedNodeIds: new Set(),
        committedSignalLightColors: new Map(),
        committedStaticFrame: {
          viewBox: { x: 0, y: 0, w: 1000, h: 1000 },
          stageWidth: 1000,
          stageHeight: 1000
        },
        committedVisualAnimationNodeMap: nodeMap,
        committedVisualAnimationNodes: nodes.slice().reverse(),
        isCanvasVisualAnimationNode,
        materializeRuntimeNode: node => node,
        currentAnimationTimestamp: () => 0,
        number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        props: {
          nodeIndex: nodeMap,
          spatialIndex: { query: () => visibleCandidates }
        },
        runtimePointValue: () => undefined,
        signalLightColor,
        syncRuntimeVisualAnimationNodes: () => false,
        visibleVisualAnimationNodeIds: new Set(),
        visibleVisualAnimationNodes: [],
        visualAnimationBoundsKey: bounds => `${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}`,
        visualAnimationNodeKey: node => node?.id ?? node,
        visualAnimationTimeline: createCanvasVisualAnimationTimeline(),
        visualAnimationViewportDirty: true,
        visualAnimationViewportKey: ''
      }
    )
  }

  const allVisible = createFrameHarness(nodes)
  const selected = allVisible.refreshVisibleVisualAnimationNodes()
  assert.equal(selected.length, nodes.length, 'visible animations beyond the former 256-node cap must remain scheduled')
  assert.equal(selected[0].id, 'animation-299')
  assert.equal(selected.at(-1).id, 'animation-0')

  for (const timestamp of [250, 283]) {
    const frameNodes = allVisible.nextVisualAnimationNodeBatch(timestamp)
    assert.equal(frameNodes.length, nodes.length, `timestamp ${timestamp} must return one complete visible frame`)
    assert.deepEqual(
      new Set(frameNodes.map(node => node.id)),
      new Set(nodes.map(node => node.id)),
      'a later frame must not rotate to a different node subset'
    )
  }

  const tenVisibleNodes = nodes.slice(-10)
  const partiallyVisible = createFrameHarness(tenVisibleNodes)
  const partialFrame = partiallyVisible.nextVisualAnimationNodeBatch(250)
  for (const node of tenVisibleNodes) {
    assert.ok(partialFrame.some(candidate => candidate.id === node.id), `${node.id} must be present in the atomic visible frame`)
  }

})

test('MiniMap queues every visible signal light in one atomic color-transition task', () => {
  const packet = sourceBetween('function clipsOverflow', '\nfunction requestVisualAnimationRender')
  const signals = Array.from({ length: 64 }, (_, index) => animatedNode('signalLight', {
    id: `signal-${index}`,
    animation: 'blink',
    animationDuration: .4,
    layer: index,
    signalColorCount: 2,
    signalColors: ['#00aa00', '#cc0000'],
    x: index % 8,
    y: Math.floor(index / 8),
    w: 10,
    h: 10
  }))
  const nodeMap = new Map(signals.map(node => [node.id, node]))
  const committedSignalLightColors = new Map(signals.map(node => [node.id, '#00aa00']))
  const batching = compileSource(
      packet,
      '({ nextVisualAnimationNodeBatch })',
      {
        canvas: { value: {} },
        canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
      committedExcludedNodeIds: new Set(),
      committedSignalLightColors,
      committedStaticFrame: {
        viewBox: { x: 0, y: 0, w: 100, h: 100 },
        stageWidth: 100,
        stageHeight: 100
      },
      committedVisualAnimationNodeMap: nodeMap,
      committedVisualAnimationNodes: signals,
      currentAnimationTimestamp: () => 250,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: node => node,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      previousCommittedSignalLightColor: (_node, key) => committedSignalLightColors.get(key),
      props: {
        nodeIndex: nodeMap,
        spatialIndex: { query: () => signals }
      },
      runtimePointValue: () => undefined,
        signalLightColor,
        syncRuntimeVisualAnimationNodes: () => false,
        visibleVisualAnimationNodeIds: new Set(),
        visibleVisualAnimationNodes: [],
        visualAnimationBoundsKey: bounds => `${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}`,
        visualAnimationNodeKey: node => node?.id ?? node,
        visualAnimationTimeline: createCanvasVisualAnimationTimeline(),
      visualAnimationViewportDirty: true,
      visualAnimationViewportKey: ''
    }
  )

  const transitionBatch = batching.nextVisualAnimationNodeBatch(250)
  assert.equal(transitionBatch.length, signals.length)
  assert.deepEqual(new Set(transitionBatch.map(node => node.id)), new Set(signals.map(node => node.id)))

  for (const signal of signals) committedSignalLightColors.set(signal.id, '#cc0000')
  assert.deepEqual(batching.nextVisualAnimationNodeBatch(300), [])
})

test('direct-to-general signal transitions compare the committed color before advancing the live timeline', () => {
  const signal = animatedNode('signalLight', {
    id: 'direct-signal',
    animation: 'blink',
    animationDuration: 1,
    layer: 1,
    signalColorCount: 4,
    signalColors: ['#001100', '#002200', '#003300', '#004400'],
    x: 0,
    y: 0,
    w: 10,
    h: 10
  })
  const timeline = createCanvasVisualAnimationTimeline()
  timeline.resolve(signal, 240)
  const nodeMap = new Map([[signal.id, signal]])
  const packet = [
    sourceBetween('function commitSignalLightColors', '\nfunction syncRuntimeVisualAnimationNodes'),
    sourceBetween('function clipsOverflow', '\nfunction requestVisualAnimationRender')
  ].join('\n')
  const batching = compileSource(packet, '({ nextVisualAnimationNodeBatch })', {
    canvas: { value: {} },
    canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
    committedDirectSignalLightTimestamp: 240,
    committedExcludedNodeIds: new Set(),
    committedSignalLightColors: new Map(),
    committedStaticFrame: {
      viewBox: { x: 0, y: 0, w: 100, h: 100 },
      stageWidth: 100,
      stageHeight: 100
    },
    committedVisualAnimationNodeMap: nodeMap,
    committedVisualAnimationNodes: [signal],
    currentAnimationTimestamp: () => 260,
    isCanvasVisualAnimationCandidate,
    isCanvasVisualAnimationNode,
    materializeRuntimeNode: node => node,
    number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    props: {
      nodeIndex: nodeMap,
      spatialIndex: { query: () => [signal] }
    },
    runtimePointValue: () => undefined,
    signalLightColor,
    syncRuntimeVisualAnimationNodes: () => false,
    visibleVisualAnimationNodeIds: new Set(),
    visibleVisualAnimationNodes: [],
    visualAnimationBoundsKey: bounds => `${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}`,
    visualAnimationNodeKey: node => node?.id ?? node,
    visualAnimationTimeline: timeline,
    visualAnimationViewportDirty: true,
    visualAnimationViewportKey: ''
  })

  assert.deepEqual(batching.nextVisualAnimationNodeBatch(260).map(node => node.id), [signal.id])
  assert.equal(timeline.resolve(signal, 300), 300, 'the comparison must not advance the next frame beyond real time')
})

test('unchanged overlapping signal lights are restored inside another animation dirty region', () => {
  const flowPipe = animatedNode('flowPipe', { id: 'pipe', layer: 1 })
  const signalLight = animatedNode('signalLight', {
    id: 'signal',
    animation: 'blink',
    layer: 2,
    signalColorCount: 2,
    signalColors: ['#00aa00', '#cc0000']
  })
  const region = { x: 10, y: 10, w: 40, h: 20 }
  const beginRuntimeCandidateCollection = compileSource(
    sourceBetween('function runtimeCandidateIncluded', '\nfunction prepareRuntimeRegion'),
    'beginRuntimeCandidateCollection',
    {
      createRuntimeCandidateCursor,
      createRuntimeQueryCursor,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
    }
  )
  const task = {
    drawingSpatialIndex: null,
    excludedDrawingIds: new Set(),
    excludedNodeIds: new Set(),
    renderDrawings: false,
    renderNodes: true,
    spatialIndex: {
      createQueryCursor(requestedRegion) {
        assert.deepEqual(requestedRegion, region)
        let done = false
        return {
          runSlice({ onMatch }) {
            if (done) return { done: true, yielded: false, operations: 0 }
            done = true
            onMatch(flowPipe)
            onMatch(signalLight)
            return { done: true, yielded: false, operations: 2 }
          }
        }
      }
    }
  }

  beginRuntimeCandidateCollection(task, [region], true)
  const result = task.candidateWork.runSlice({ shouldYield: () => false }, 16)
  assert.equal(result.done, true)
  assert.deepEqual(
    task.candidateWork.items.map(item => item.entity.id),
    ['pipe', 'signal'],
    'the dirty-region query must redraw every overlapping layer, not only the node that scheduled the frame'
  )
  assert.match(
    sourceBetween('function measureRuntimeRegions', '\nfunction drawDenseRuntimeEntities'),
    /task\.visualAnimationFrame[\s\S]*?mergeOverlappingRuntimeRegions\(task\.measuredRegions\)[\s\S]*?beginRuntimeCandidateCollection\(task, queryRegions, true\)/
  )
})

test('MiniMap cadence reads the shortest effective per-component animation period', () => {
  const packet = sourceBetween(
    'function minimumVisibleVisualAnimationDurationSeconds',
    '\nfunction flushPendingVisualAnimationRender'
  )
  const minimumDuration = compileSource(
    packet,
    'minimumVisibleVisualAnimationDurationSeconds',
    {
      hasEnabledRuntimeBinding: (node, target) => node?.runtimeTarget === target,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: node => ({ ...node, animationDuration: node.runtimeDuration }),
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      runtimePointValue: () => undefined
    }
  )
  assert.equal(minimumDuration([
    animatedNode('rotatingFan', { animationDuration: 1.5 }),
    animatedNode('rotatingFan', { animationDuration: .2 }),
    animatedNode('rotatingFan', { animationDuration: .1, animationPaused: true })
  ]), .2)
  assert.equal(minimumDuration([
    animatedNode('rotatingFan', {
      animationDuration: 1.5,
      runtimeDuration: .3,
      runtimeTarget: 'animationDuration'
    })
  ]), .3)
})

test('MiniMap visual refreshes schedule one complete frame, apply backpressure, and release their clock', () => {
  const trackedNodes = Array.from(
    { length: 30 },
    (_, index) => animatedNode('flowPipe', { id: `pipe-${index}` })
  )
  const props = {
    active: true,
    incrementalRuntime: true,
    nodeIndex: new Map(trackedNodes.map(node => [node.id, node])),
    spatialIndex: { createQueryCursor() {} }
  }
  const pendingRuntimeNodes = new Map()
  const renderScheduler = { state: { pending: false } }
  const runtimeRenderScheduler = { state: { pending: false } }
  const control = { result: 1 }
  const scheduled = []
  const clock = { value: 0 }
  const lifecycle = { acquired: 0, released: 0, stopped: 0, watched: 0 }
  const releasePacket = sourceBetween('function releaseVisualAnimationClock', '\nfunction visualAnimationNodeKey')
  const requestPacket = sourceBetween('function queueVisualAnimationTimestamp', '\nfunction syncVisualAnimationClock')
  const clockPacket = sourceBetween('function syncVisualAnimationClock', '\nfunction geometryNodeLookup')
  const animationRuntime = compileSource(
    `${releasePacket}\n${requestPacket}\n${clockPacket}`,
    '({ requestVisualAnimationRender, flushPendingVisualAnimationRender, syncVisualAnimationClock, releaseVisualAnimationClock, pendingTimestamp: () => pendingVisualAnimationTimestamp })',
    {
      CANVAS_VISUAL_ANIMATION_FPS,
      VISUAL_ANIMATION_CLOCK_FPS: 60,
      acquireVisualClock: fps => {
        assert.equal(fps, 60)
        lifecycle.acquired += 1
        return clock
      },
      canIncrementRuntime: () => true,
      canvasVisualAnimationFramePlan,
      canvas: { value: {} },
      coalescedRenderDirty: false,
      committedCompositeSurface: {},
      committedStaticFrame: { renderNodes: true },
      committedStaticSurface: {},
      committedVisualAnimationNodeMap: new Map(trackedNodes.map(node => [node.id, node])),
      currentAnimationTimestamp: () => 999,
      geometryInteraction: null,
      hasEnabledRuntimeBinding: () => false,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: node => node,
      nextVisualAnimationNodeBatch: () => trackedNodes,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      pendingRuntimeNodes,
      pendingVisualAnimationTimestamp: null,
      props,
      refreshVisibleVisualAnimationNodes: () => trackedNodes,
      runtimePointValue: () => undefined,
      releaseVisualClock: fps => {
        assert.equal(fps, 60)
        lifecycle.released += 1
      },
      renderScheduler,
      resetVisualAnimationFramePacing: () => {},
      runtimePointValue: () => undefined,
      runtimeRenderDirty: false,
      runtimeRenderFollowUpPending: () => false,
      runtimeRenderScheduler,
      scheduleRuntimeRender: options => {
        scheduled.push({ options, nodeIds: [...pendingRuntimeNodes.keys()] })
        return control.result
      },
      stopVisualAnimationClockWatch: null,
      visualAnimationFrameIntervalMs: 0,
      visualAnimationLastFrameTimestamp: null,
      visualAnimationMeasuredFrameMs: 0,
      visualAnimationMeasuredNodeCount: 0,
      visualAnimationTickCount: 0,
      visualAnimationDirectAtlasFrame: () => null,
      visualAnimationReducedMotion: false,
      visualAnimationClock: null,
      watch: (source, callback, options) => {
        assert.equal(source, clock)
        assert.equal(typeof callback, 'function')
        assert.deepEqual(options, { flush: 'sync', immediate: true })
        lifecycle.watched += 1
        return () => { lifecycle.stopped += 1 }
      }
    }
  )

  animationRuntime.requestVisualAnimationRender(750)
  assert.equal(scheduled.length, 1)
  assert.deepEqual(scheduled[0].options, {
    animationTimestamp: 750,
    visualAnimationFrame: true,
    visualAnimationNodeCount: trackedNodes.length,
    visualAnimationVisibleCount: trackedNodes.length,
    visualAtlasDirectRect: null,
    visualAtlasDirectFrame: null,
    visualAnimationPreparationMs: 0
  })
  assert.equal(scheduled[0].nodeIds.length, trackedNodes.length)
  assert.deepEqual(scheduled[0].nodeIds, trackedNodes.map(node => node.id))

  pendingRuntimeNodes.clear()
  runtimeRenderScheduler.state.pending = true
  animationRuntime.requestVisualAnimationRender(800)
  animationRuntime.requestVisualAnimationRender(825)
  assert.equal(scheduled.length, 1, 'an in-flight runtime task must apply backpressure')
  assert.equal(pendingRuntimeNodes.size, 0)
  assert.equal(animationRuntime.pendingTimestamp(), null, 'busy frames do not enqueue stale partial work')

  runtimeRenderScheduler.state.pending = false
  animationRuntime.requestVisualAnimationRender(825)
  assert.equal(scheduled.length, 2)
  assert.deepEqual(scheduled[1].options, {
    animationTimestamp: 825,
    visualAnimationFrame: true,
    visualAnimationNodeCount: trackedNodes.length,
    visualAnimationVisibleCount: trackedNodes.length,
    visualAtlasDirectRect: null,
    visualAtlasDirectFrame: null,
    visualAnimationPreparationMs: 0
  })
  assert.equal(animationRuntime.pendingTimestamp(), null)

  pendingRuntimeNodes.clear()
  control.result = null
  animationRuntime.requestVisualAnimationRender(870)
  assert.equal(scheduled.length, 3)
  assert.equal(pendingRuntimeNodes.size, 0, 'a rejected sparse refresh must roll back its inserted nodes')
  assert.equal(animationRuntime.pendingTimestamp(), 870, 'a rejected refresh remains available for the next flush')

  animationRuntime.syncVisualAnimationClock()
  assert.deepEqual(lifecycle, { acquired: 1, released: 0, stopped: 0, watched: 1 })
  props.active = false
  animationRuntime.syncVisualAnimationClock()
  assert.deepEqual(lifecycle, { acquired: 1, released: 1, stopped: 1, watched: 1 })

  assert.match(miniMapSource, /watch\(\(\) => props\.active,[\s\S]*?releaseVisualAnimationClock\(\)[\s\S]*?invalidatePendingRender\('suspended'\)/)
  assert.match(miniMapSource, /onBeforeUnmount\(\(\) => \{[\s\S]*?releaseVisualAnimationClock\(\)[\s\S]*?committedVisualAnimationNodes = \[\]/)
})

test('MiniMap Canvas respects reduced motion by default while formal preview keeps real playback', () => {
  assert.match(miniMapSource, /respectReducedMotion:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/)
  assert.match(miniMapSource, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(miniMapSource, /function handleVisualAnimationMotionPreferenceChange/)
  assert.match(miniMapSource, /const next = props\.respectReducedMotion && Boolean\(event\?\.matches\)/)
  assert.ok((appSource.match(/:respect-reduced-motion="false"/g) || []).length >= 2)
  assert.match(miniMapSource, /visualAnimationTimeline\.setSuspended\(next, timestamp, effectiveNodes\)/)
  assert.match(
    sourceBetween('function requestVisualAnimationRender', '\nfunction syncVisualAnimationClock'),
    /visualAnimationReducedMotion[\s\S]*?return null/
  )
  assert.match(
    sourceBetween('function syncVisualAnimationClock', '\nfunction geometryNodeLookup'),
    /!visualAnimationReducedMotion/
  )
  assert.match(miniMapSource, /addEventListener\?\.\('change', handleVisualAnimationMotionPreferenceChange\)/)
  assert.match(miniMapSource, /removeEventListener\?\.\('change', handleVisualAnimationMotionPreferenceChange\)/)
  assert.doesNotMatch(
    sourceBetween('function handleVisualAnimationMotionPreferenceChange', '\nfunction normalizedRenderSliceBudgetMs'),
    /animationDuration\s*=|animationPaused\s*=/
  )
})

test('persistent visual-atlas slots skip identical frames and clear stale pixels before redraw', () => {
  const operations = []
  const context = {
    clearRect: (...args) => operations.push(['clear', ...args]),
    restore: () => operations.push(['restore']),
    save: () => operations.push(['save']),
    setTransform: (...args) => operations.push(['transform', ...args])
  }
  const rasterCanvasVisualAtlas = compileSource(
    sourceBetween('function rasterCanvasVisualAtlas', '\nfunction compositeCanvasVisualAtlas'),
    'rasterCanvasVisualAtlas',
    {
      canvasVisualAtlasOutputRect: () => ({ x: 0, y: 0, w: 20, h: 20 }),
      currentAnimationTimestamp: () => 10,
      canvasVisualAtlasBlitData: instances => new Float32Array(instances.length * 8),
      drawCanvasVisualAtlasSprite: (_task, _context, command) => operations.push(['draw', command.signature]),
      fallbackCanvasVisualAtlas: (_task, reason) => { throw new Error(`unexpected fallback: ${reason}`) },
      mapCanvasVisualAtlasInstances: instances => instances
    }
  )
  const command = {
    bitmapRect: { x: 2, y: 3, w: 8, h: 9 },
    signature: 'frame-a',
    slotSignature: 'stable-slot'
  }
  const task = {
    visualAtlasCommands: [command],
    visualAtlasEntries: [command],
    visualAtlasFrame: {
      context,
      slotSignatures: new Map(),
      surface: {}
    },
    visualAtlasPlan: {
      slots: new Map([['stable-slot', { x: 4, y: 5, w: 8, h: 9 }]])
    },
    visualAtlasRasterCursor: 0,
    visualAtlasRasterDrawCount: 0,
    visualAtlasRasterMs: 0,
    visualAtlasSlotCacheHits: 0,
    visualAtlasSlotCacheMisses: 0
  }
  const deadline = { shouldYield: () => false }

  assert.equal(rasterCanvasVisualAtlas(task, deadline), true)
  assert.equal(task.visualAtlasRasterDrawCount, 1)
  assert.equal(task.visualAtlasSlotCacheMisses, 1)
  assert.deepEqual(operations.filter(([type]) => type === 'draw'), [['draw', 'frame-a']])
  assert.deepEqual(operations.find(([type]) => type === 'clear'), ['clear', 3, 4, 10, 11])

  task.visualAtlasRasterCursor = 0
  assert.equal(rasterCanvasVisualAtlas(task, deadline), true)
  assert.equal(task.visualAtlasSlotCacheHits, 1)
  assert.equal(task.visualAtlasRasterDrawCount, 1, 'an identical complete signature must reuse the existing slot pixels')

  command.signature = 'frame-b'
  task.visualAtlasRasterCursor = 0
  assert.equal(rasterCanvasVisualAtlas(task, deadline), true)
  assert.equal(task.visualAtlasSlotCacheMisses, 2)
  assert.equal(task.visualAtlasRasterDrawCount, 2)
  assert.deepEqual(operations.filter(([type]) => type === 'draw'), [
    ['draw', 'frame-a'],
    ['draw', 'frame-b']
  ])
  assert.equal(task.visualAtlasFrame.slotSignatures.get('stable-slot'), 'frame-b')
})

test('visual descriptor cache keys invalidate every configurable built-in effect field', () => {
  const canvasVisualDescriptorSourceKey = compileSource(
    sourceBetween('function canvasVisualDescriptorSourceKey', '\nfunction canvasVisualSpriteAnimationState'),
    'canvasVisualDescriptorSourceKey'
  )
  const node = animatedNode('waterTank', {
    id: 'descriptor-node',
    x: 1,
    y: 2,
    w: 68,
    h: 95,
    opacity: 1,
    visualPrimaryColor: '#3bb9df',
    progressValue: 37,
    borderVisible: true,
    borderWidth: 2,
    borderStyle: 'solid',
    dataKey: 'tank-level',
    dataBindings: [{ target: 'progressValue', pointId: 'level' }]
  })
  const baseline = canvasVisualDescriptorSourceKey(node)
  for (const [field, value] of [
    ['animationDuration', 2.5],
    ['animationDirection', 'reverse'],
    ['animationPaused', true],
    ['visualPrimaryColor', '#ff0000'],
    ['progressValue', 82],
    ['borderWidth', 20],
    ['visualScaleX', 1.8],
    ['x', 30]
  ]) {
    assert.notEqual(canvasVisualDescriptorSourceKey({ ...node, [field]: value }), baseline, `${field} must invalidate the descriptor`)
  }
  assert.notEqual(
    canvasVisualDescriptorSourceKey({ ...node, dataBindings: [{ target: 'animationDuration', pointId: 'speed' }] }),
    baseline,
    'binding edits must invalidate the materialized descriptor'
  )
  assert.match(
    sourceBetween('function prepareCanvasVisualSpriteCommand', '\nfunction tryDrawCanvasVisualSprite'),
    /descriptor\.sourceKey !== sourceKey[\s\S]*?sourceKey,/
  )
})

test('visual atlas profiles isolate components with different animation periods', () => {
  const canvasVisualAnimationProfile = compileSource(
    sourceBetween('function canvasVisualAnimationProfile', '\nfunction internCanvasVisualAnimationProfile'),
    'canvasVisualAnimationProfile'
  )
  const layout = { layoutWidth: 110, layoutHeight: 110, visualWorldPixel: 1 }
  const slow = animatedNode('rotatingFan', { animationDuration: 1.5 })
  const fast = animatedNode('rotatingFan', { animationDuration: .3 })
  assert.notEqual(canvasVisualAnimationProfile(slow, layout), canvasVisualAnimationProfile(fast, layout))
})

test('visual-atlas stream keys preserve exact running and paused phases', () => {
  const streamStates = new WeakMap()
  const canvasVisualAnimationStreamKey = compileSource(
    sourceBetween('function canvasVisualAnimationStreamKey', '\nfunction canvasVisualSpriteSignature'),
    'canvasVisualAnimationStreamKey',
    { canvasVisualAnimationStreamStates: streamStates }
  )
  const first = {}
  const second = {}
  const running = { animationPaused: false }
  const paused = { animationPaused: true }

  assert.equal(canvasVisualAnimationStreamKey(first, running, 7, 100, 100, true), 'running:0')
  assert.equal(canvasVisualAnimationStreamKey(first, running, 7, 250, 250, true), 'running:0')
  assert.equal(canvasVisualAnimationStreamKey(second, running, 7, 100, 112.5, true), 'running:12.5')
  assert.notEqual(
    canvasVisualAnimationStreamKey(first, running, 7, 250, 250, true),
    canvasVisualAnimationStreamKey(second, running, 7, 250, 262.5, true),
    'different exact phase offsets must not share a persistent slot'
  )
  assert.equal(canvasVisualAnimationStreamKey(first, paused, 7, 300, 250, true), 'paused:250')
  assert.equal(canvasVisualAnimationStreamKey(first, paused, 7, 500, 250, true), 'paused:250')
  assert.equal(canvasVisualAnimationStreamKey(first, running, 8, 500, 375, true), 'running:-125')
  assert.equal(canvasVisualAnimationStreamKey(first, running, 8, 500, 375, false), 'static')
})

test('visual-atlas layout keys are order independent and isolate different sprite sets', () => {
  const canvasVisualAtlasLayoutKey = compileSource(
    sourceBetween('function canvasVisualAtlasLayoutKey', '\nfunction resolveCanvasVisualAtlasSlotSignature'),
    'canvasVisualAtlasLayoutKey'
  )
  const entries121 = Array.from({ length: 121 }, (_, index) => ({
    signature: `slot-${index}`,
    width: 12 + index % 3,
    height: 10 + index % 5
  }))
  const entries171 = [
    ...entries121,
    ...Array.from({ length: 50 }, (_, index) => ({
      signature: `extra-${index}`,
      width: 14,
      height: 11
    }))
  ]
  assert.equal(canvasVisualAtlasLayoutKey(entries121), canvasVisualAtlasLayoutKey(entries121.slice().reverse()))
  assert.notEqual(canvasVisualAtlasLayoutKey(entries121), canvasVisualAtlasLayoutKey(entries171))
})

test('visual-atlas falls back to per-frame signatures when stable streams exceed capacity', () => {
  const prepareCanvasVisualAtlas = compileSource(
    sourceBetween('function prepareCanvasVisualAtlas', '\nfunction rasterCanvasVisualAtlas'),
    'prepareCanvasVisualAtlas',
    {
      RUNTIME_VISUAL_ATLAS_MAX_DIMENSION: 4096,
      RUNTIME_VISUAL_ATLAS_MAX_PIXELS: 8_388_608,
      RUNTIME_VISUAL_SPRITE_MAX_SIGNATURES: 512,
      acquireCanvasVisualAtlasFrame: (_layoutKey, plan) => ({
        context: {},
        plan,
        slotSignatures: new Map(),
        surface: {}
      }),
      cachedCanvasVisualAtlasFrame: () => null,
      canvasVisualAtlasLayoutKey: entries => entries.map(entry => entry.signature).join('|'),
      currentAnimationTimestamp: () => 10,
      fallbackCanvasVisualAtlas: (_task, reason) => { throw new Error(`unexpected fallback: ${reason}`) },
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      packCanvasVisualAtlas: entries => ({
        height: 20,
        pixels: 400,
        slots: new Map(entries.map(entry => [entry.signature, { x: 1, y: 1, w: entry.width, h: entry.height }])),
        width: 20
      }),
      prepareCanvasVisualSpriteCommand: (_task, node) => ({ ...node, sourceNode: node }),
      resolveCanvasVisualAtlasSlotSignature: (_task, command) => command.slotSignature
    }
  )
  const items = Array.from({ length: 513 }, (_, index) => ({
    entity: {
      bitmapRect: { x: 0, y: 0, w: 4, h: 4 },
      id: `node-${index}`,
      signature: 'shared-dynamic-frame',
      slotSignature: `stable-stream-${index}`
    },
    kind: 'node'
  }))
  const task = {
    frame: { scaleX: 1, scaleY: 1 },
    phase: 'visualAtlasPrepare',
    visualAtlasCommands: [],
    visualAtlasCursor: 0,
    visualAtlasEntries: [],
    visualAtlasFrame: null,
    visualAtlasFrameCacheHit: false,
    visualAtlasItems: items,
    visualAtlasPrepareMs: 0,
    visualAtlasRawPixels: 0,
    visualAtlasStableSlots: true,
    visualAtlasUniqueCommands: new Map()
  }

  assert.equal(prepareCanvasVisualAtlas(task, { shouldYield: () => false }), true)
  assert.equal(task.visualAtlasStableSlots, false)
  assert.equal(task.visualAtlasUniqueCommands.size, 1, 'identical current frames should still share one dynamic sprite')
  assert.equal(task.visualAtlasEntries.length, 1)
  assert.equal(task.visualAtlasEntries[0].slotSignature, 'shared-dynamic-frame')
  assert.equal(task.phase, 'visualAtlasRaster')
})

test('direct visual-atlas eligibility keeps canonical order and rejects unsafe document states', () => {
  const nodes = Array.from({ length: 256 }, (_, index) => animatedNode('rotatingFan', {
    id: `direct-${index}`,
    layer: index % 8,
    opacity: 1,
    rotate: 0
  }))
  const canonicalNodes = nodes.slice().reverse()
  const committedMap = new Map(nodes.map(node => [node.id, node]))
  let overlappingNode = null
  const props = {
    drawings: [],
    drawingSpatialIndex: { query: () => [] },
    nodeIndex: new Map(nodes.map(node => [node.id, node])),
    nodes,
    orderedEntities: canonicalNodes.map(node => ({ kind: 'node', entity: node })),
    spatialIndex: {
      query: region => [props.nodeIndex.get(region.nodeId), overlappingNode].filter(Boolean)
    }
  }
  const visualAnimationDirectAtlasFrame = compileSource(
    sourceBetween('function visualAnimationDirectAtlasFrame', '\nfunction queueVisualAnimationTimestamp'),
    'visualAnimationDirectAtlasFrame',
    {
      RUNTIME_VISUAL_ATLAS_MIN_INSTANCES: 256,
      alpha: value => value == null ? 1 : Math.max(0, Math.min(1, Number(value))),
      canvasVisualAnimationTypes: new Set(CANVAS_VISUAL_TYPES),
      canvasVisualDirectAtlasFrameCache: null,
      committedExcludedDrawingIds: new Set(),
      committedExcludedNodeIds: new Set(),
      committedStaticFrame: {},
      committedVisualAnimationNodeMap: committedMap,
      isCanvasVisualAnimationNode,
      materializeRuntimeNode: node => node,
      number: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      props,
      refreshVisibleVisualAnimationNodes: () => nodes,
      runtimeBitmapRect: () => ({ x: 4, y: 5, w: 100, h: 80 }),
      runtimeNodeRegion: node => ({ nodeId: node.id, x: node.x || 0, y: node.y || 0, w: node.w || 1, h: node.h || 1 }),
      runtimePointValue: () => undefined,
      visualAnimationNodeKey: node => node?.id ?? node,
      visualAnimationViewportBounds: () => ({ x: 0, y: 0, w: 100, h: 80 })
    }
  )

  const direct = visualAnimationDirectAtlasFrame(nodes.slice())
  assert.deepEqual(direct.nodes.map(node => node.id), canonicalNodes.map(node => node.id))
  assert.deepEqual(direct.bitmapRect, { x: 4, y: 5, w: 100, h: 80 })

  nodes[0].opacity = 0
  assert.equal(visualAnimationDirectAtlasFrame(nodes), null, 'fully transparent nodes use the general exact path')
  nodes[0].opacity = 1
  nodes[0].animationPaused = true
  assert.equal(visualAnimationDirectAtlasFrame(nodes), null, 'paused nodes use the general exact path')
  nodes[0].animationPaused = false
  nodes[0].animation = 'none'
  assert.equal(visualAnimationDirectAtlasFrame(nodes), null, 'mixed static layers use the general exact path')

  nodes[0].animation = 'flow'
  for (const node of nodes) {
    node.backgroundOpacity = 1
    node.fill = '#ffffff'
  }
  const staticNode = { id: 'static-node', type: 'rect', layer: 999, x: 5000, y: 5000, w: 20, h: 20 }
  props.nodes = [...nodes, staticNode]
  props.nodeIndex.set(staticNode.id, staticNode)
  props.orderedEntities = [
    ...canonicalNodes.map(node => ({ kind: 'node', entity: node })),
    { kind: 'node', entity: staticNode }
  ]
  const mixedDirect = visualAnimationDirectAtlasFrame(nodes.slice())
  assert.equal(mixedDirect.preserveCompositeBase, true)
  assert.deepEqual(mixedDirect.nodes.map(node => node.id), canonicalNodes.map(node => node.id))

  overlappingNode = staticNode
  assert.equal(visualAnimationDirectAtlasFrame(nodes.slice()), null, 'overlapping static nodes require exact layer redraw')
  overlappingNode = null
  nodes[0].fill = 'rgba(255, 255, 255, .5)'
  assert.equal(visualAnimationDirectAtlasFrame(nodes.slice()), null, 'transparent mixed frames cannot preserve old animation pixels')
})

test('direct visual-atlas frames restore the base before compositing transparent animation pixels', () => {
  const operations = []
  const base = { id: 'base' }
  const atlas = { id: 'atlas' }
  const context = {
    beginPath: () => operations.push(['beginPath']),
    clearRect: (...args) => operations.push(['clear', ...args]),
    clip: () => operations.push(['clip']),
    drawImage: (...args) => operations.push(['drawImage', ...args]),
    rect: (...args) => operations.push(['rect', ...args]),
    restore: () => operations.push(['restore']),
    save: () => operations.push(['save']),
    setTransform: (...args) => operations.push(['transform', ...args])
  }
  const compositeCanvasVisualAtlas = compileSource(
    sourceBetween('function compositeCanvasVisualAtlas', '\nfunction drawEntityIncrementally'),
    'compositeCanvasVisualAtlas',
    {
      beginRuntimeUnionDraw: () => { throw new Error('direct mode must not enter union setup') },
      clearCanvasVisualAtlasAttempt: () => {},
      currentAnimationTimestamp: () => 20,
      drawCanvasVisualAtlasBlits,
      fallbackCanvasVisualAtlas: (_task, reason) => { throw new Error(`unexpected fallback: ${reason}`) },
      finishRuntimeRegion: () => {},
      fullRuntimeSeedRect: () => [{ x: 0, y: 0, w: 100, h: 80 }]
    }
  )
  const directRect = { x: 4, y: 5, w: 40, h: 30 }
  const task = {
    base,
    bitmapRects: [],
    ctx: context,
    frame: {},
    measuredBitmapRects: [directRect],
    partialDense: false,
    visualAtlasCompositeMs: 0,
    visualAtlasCompositeCursor: 0,
    visualAtlasCompositePrepared: false,
    visualAtlasDrawMs: 0,
    visualAtlasEntries: [{ type: 'particles', opacity: .35 }, { type: 'signalLight', opacity: .5 }],
    visualAtlasFrame: { surface: atlas },
    visualAtlasInstances: [
      { atlasRect: { x: 1, y: 2, w: 8, h: 9 }, bitmapRect: { x: 0, y: 0, w: 8, h: 9 } },
      { atlasRect: { x: 11, y: 12, w: 6, h: 7 }, bitmapRect: { x: 10, y: 11, w: 6, h: 7 } }
    ],
    visualAtlasBlitData: null,
    visualAtlasMode: 'direct',
    visualAtlasOutputRect: directRect,
    visualAtlasPlan: { height: 20, pixels: 400, width: 20 },
    visualAtlasRasterDrawCount: 2,
    visualAtlasUploadMs: 0,
    visualAtlasValidationMs: 0
  }
  task.visualAtlasBlitData = canvasVisualAtlasBlitData(task.visualAtlasInstances)

  assert.equal(compositeCanvasVisualAtlas(task), true)
  const clearIndex = operations.findIndex(([type]) => type === 'clear')
  const baseIndex = operations.findIndex(operation => operation[0] === 'drawImage' && operation[1] === base)
  const atlasIndexes = operations
    .map((operation, index) => operation[0] === 'drawImage' && operation[1] === atlas ? index : -1)
    .filter(index => index >= 0)
  assert.ok(clearIndex >= 0 && clearIndex < baseIndex && baseIndex < atlasIndexes[0])
  assert.deepEqual(operations[clearIndex], ['clear', 4, 5, 40, 30])
  assert.deepEqual(operations[baseIndex], ['drawImage', base, 4, 5, 40, 30, 4, 5, 40, 30])
  assert.deepEqual(operations[atlasIndexes[0]], ['drawImage', atlas, 1, 2, 8, 9, 4, 5, 8, 9])
  assert.deepEqual(operations[atlasIndexes[1]], ['drawImage', atlas, 11, 12, 6, 7, 14, 16, 6, 7])
  assert.ok(operations.some(operation => operation[0] === 'rect' && operation.slice(1).join(',') === '4,5,40,30'))
  assert.deepEqual(task.bitmapRects, [directRect])
  assert.equal(task.visualAtlasBackend, 'canvas2d')
  assert.equal(task.phase, 'complete')
})

test('a partial Canvas2D atlas failure restores the base before the exact fallback', () => {
  const operations = []
  const base = { id: 'base' }
  const atlas = { id: 'atlas' }
  let atlasDraws = 0
  let fallback = null
  const context = {
    beginPath: () => operations.push(['beginPath']),
    clearRect: (...args) => operations.push(['clear', ...args]),
    clip: () => operations.push(['clip']),
    drawImage: (...args) => {
      operations.push(['drawImage', ...args])
      if (args[0] === atlas && ++atlasDraws === 2) throw new Error('atlas blit failed')
    },
    rect: (...args) => operations.push(['rect', ...args]),
    restore: () => operations.push(['restore']),
    save: () => operations.push(['save']),
    setTransform: (...args) => operations.push(['transform', ...args])
  }
  const compositeCanvasVisualAtlas = compileSource(
    `${sourceBetween('function restoreCanvasVisualAtlasOutput', '\nfunction drawCanvasVisualAtlasSprite')}\n${sourceBetween('function compositeCanvasVisualAtlas', '\nfunction drawEntityIncrementally')}`,
    'compositeCanvasVisualAtlas',
    {
      beginRuntimeUnionDraw: () => { throw new Error('direct mode must not enter union setup') },
      clearCanvasVisualAtlasAttempt: () => {},
      currentAnimationTimestamp: () => 20,
      drawCanvasVisualAtlasBlits,
      fallbackCanvasVisualAtlas: (task, reason) => { fallback = { reason, timestamp: task.animationTimestamp } },
      finishRuntimeRegion: () => {},
      fullRuntimeSeedRect: () => [{ x: 0, y: 0, w: 100, h: 80 }]
    }
  )
  const instances = [
    { atlasRect: { x: 1, y: 1, w: 5, h: 5 }, bitmapRect: { x: 0, y: 0, w: 5, h: 5 } },
    { atlasRect: { x: 7, y: 1, w: 5, h: 5 }, bitmapRect: { x: 6, y: 0, w: 5, h: 5 } }
  ]
  const task = {
    animationTimestamp: 1234,
    base,
    bitmapRects: [],
    ctx: context,
    frame: {},
    measuredBitmapRects: [{ x: 4, y: 5, w: 40, h: 30 }],
    partialDense: false,
    surfaceReusable: true,
    visualAtlasBackend: '',
    visualAtlasBlitData: canvasVisualAtlasBlitData(instances),
    visualAtlasCompositeCursor: 0,
    visualAtlasCompositeMs: 0,
    visualAtlasCompositePrepared: false,
    visualAtlasDrawMs: 0,
    visualAtlasEntries: [{}, {}],
    visualAtlasFrame: { surface: atlas },
    visualAtlasInstances: instances,
    visualAtlasMode: 'direct',
    visualAtlasOutputRect: { x: 4, y: 5, w: 40, h: 30 },
    visualAtlasPlan: { pixels: 100 },
    visualAtlasRasterDrawCount: 2,
    visualAtlasUsed: false
  }

  assert.equal(compositeCanvasVisualAtlas(task), true)
  assert.deepEqual(fallback, { reason: '2d-atlas-composite', timestamp: 1234 })
  assert.equal(operations.filter(operation => operation[0] === 'drawImage' && operation[1] === base).length, 2)
  assert.equal(task.visualAtlasUsed, false)
  assert.equal(task.visualAtlasCompositeCursor, 0, 'fallback redraws the complete frame after a partial blit')
})
