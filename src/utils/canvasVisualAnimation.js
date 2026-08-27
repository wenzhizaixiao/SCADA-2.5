import { MAX_SIGNAL_COLORS } from '../config/componentBindingSchema.js'

export const CANVAS_VISUAL_ANIMATION_FPS = 30
export const CANVAS_VISUAL_FAST_ANIMATION_FPS = 60

const DEFAULT_ANIMATION_DURATION_SECONDS = 1.5
const MINIMUM_ANIMATION_SAMPLES_PER_CYCLE = 12
// The four identical fan blades repeat visually every quarter turn. Treat that
// visible repeat as one configured cycle so the period control matches what
// users actually see instead of making the apparent cycle four times faster.
const FAN_VISUAL_CYCLE_RADIANS = Math.PI / 2
const FLOW_PIPE_DASH_UNITS = 7
const PARTICLE_COUNT = 8
const PARTICLE_TRANSLATE_START = -22
const PARTICLE_TRANSLATE_END = 45
const DEFAULT_SIGNAL_COLOR = '#21c58e'
const DEFAULT_SIGNAL_ALTERNATE_COLOR = '#ef5350'
const TARGET_COMPLETE_FRAME_UTILIZATION = .8
const ADAPTIVE_FRAME_RATES = Object.freeze([30, 24, 20, 15, 12, 10, 8, 6, 4, 3, 2, 1])
const FRAME_INTERVAL_EPSILON = 1e-6

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function adaptiveFrameInterval(requiredInterval) {
  const minimum = 1000 / CANVAS_VISUAL_ANIMATION_FPS
  const required = Math.max(minimum, finiteNumber(requiredInterval, minimum))
  for (const fps of ADAPTIVE_FRAME_RATES) {
    const interval = 1000 / fps
    if (interval + FRAME_INTERVAL_EPSILON >= required) return interval
  }
  return 1000 / ADAPTIVE_FRAME_RATES.at(-1)
}

function minimumSamplingFrameInterval(durationSeconds) {
  const duration = finiteNumber(durationSeconds)
  if (!(duration > 0)) return Number.POSITIVE_INFINITY
  const requiredFps = MINIMUM_ANIMATION_SAMPLES_PER_CYCLE / duration
  const samplingFps = requiredFps > CANVAS_VISUAL_ANIMATION_FPS
    ? CANVAS_VISUAL_FAST_ANIMATION_FPS
    : requiredFps
  return 1000 / Math.min(CANVAS_VISUAL_FAST_ANIMATION_FPS, samplingFps)
}

/**
 * Plans one atomic refresh for the complete visible animation set. Work may be
 * chunked internally, but every node in that set must use frameTimestamp and
 * become visible in one commit; this policy never rotates individual nodes.
 */
export function canvasVisualAnimationFramePlan(options = {}) {
  const visibleCount = Math.max(0, Math.floor(finiteNumber(options.visibleCount)))
  if (!visibleCount) {
    return Object.freeze({
      active: false,
      fps: 0,
      intervalMs: 0,
      shouldRender: false,
      delayMs: 0,
      frameTimestamp: null
    })
  }

  const measuredFrameMs = Math.max(0, finiteNumber(options.measuredFrameMs))
  const measuredVisibleCount = Math.max(
    1,
    Math.floor(finiteNumber(options.measuredVisibleCount, visibleCount))
  )
  const normalizedMeasuredFrameMs = measuredFrameMs * visibleCount / measuredVisibleCount
  const measuredInterval = normalizedMeasuredFrameMs / TARGET_COMPLETE_FRAME_UTILIZATION
  const intervalMs = Math.min(
    adaptiveFrameInterval(measuredInterval),
    minimumSamplingFrameInterval(options.minimumAnimationDurationSeconds)
  )
  const now = Math.max(0, finiteNumber(options.now))
  const rawLastFrameTimestamp = Number(options.lastFrameTimestamp)
  const hasPreviousFrame = Number.isFinite(rawLastFrameTimestamp) && rawLastFrameTimestamp >= 0
  const dueAt = hasPreviousFrame ? rawLastFrameTimestamp + intervalMs : now
  const delayMs = Math.max(0, dueAt - now)
  const shouldRender = options.pending !== true && delayMs <= FRAME_INTERVAL_EPSILON

  return Object.freeze({
    active: true,
    fps: 1000 / intervalMs,
    intervalMs,
    shouldRender,
    delayMs,
    frameTimestamp: shouldRender ? now : null
  })
}

function animationDurationMilliseconds(node) {
  const duration = finiteNumber(node?.animationDuration, DEFAULT_ANIMATION_DURATION_SECONDS)
  return (duration > 0 ? duration : DEFAULT_ANIMATION_DURATION_SECONDS) * 1000
}

function signalPaletteCount(node) {
  return Math.max(1, Math.min(
    MAX_SIGNAL_COLORS,
    Math.floor(finiteNumber(node?.signalColorCount, 2)) || 2
  ))
}

function signalPaletteColor(node, index) {
  if (Array.isArray(node?.signalColors)) {
    return node.signalColors[index] || DEFAULT_SIGNAL_COLOR
  }
  if (index === 0) return node?.signalColor || DEFAULT_SIGNAL_COLOR
  if (index === 1) return DEFAULT_SIGNAL_ALTERNATE_COLOR
  return DEFAULT_SIGNAL_COLOR
}

export function isCanvasVisualAnimationCandidate(node) {
  if (!node) return false
  if (['flowDirection', 'flowPipe', 'rotatingFan', 'waterTank', 'particles'].includes(node.type)) return node.animation === 'flow'
  if (node.type === 'heartbeat') return node.animation === 'pulse'
  return node.type === 'signalLight'
    && node.animation === 'blink'
    && signalPaletteCount(node) > 1
}

export function isCanvasVisualAnimationNode(node) {
  return node?.animationPaused !== true && isCanvasVisualAnimationCandidate(node)
}

export function canvasVisualAnimationPhase(node, timestamp) {
  if (!isCanvasVisualAnimationCandidate(node)) return 0
  const elapsed = Math.max(0, finiteNumber(timestamp)) / animationDurationMilliseconds(node)
  const iteration = Math.floor(elapsed)
  const progress = elapsed - iteration
  if (node.animationDirection === 'reverse') return 1 - progress
  if (node.animationDirection === 'alternate') return iteration % 2 ? 1 - progress : progress
  if (node.animationDirection === 'alternate-reverse') return iteration % 2 ? progress : 1 - progress
  return progress
}

export function flowPipeDashOffset(node, lineWidth, timestamp) {
  if (node?.type !== 'flowPipe' || !isCanvasVisualAnimationCandidate(node)) return 0
  const width = finiteNumber(lineWidth, 1)
  const dashCycle = (width > 0 ? width : 1) * FLOW_PIPE_DASH_UNITS
  return -canvasVisualAnimationPhase(node, timestamp) * dashCycle
}

export function flowDirectionDashOffset(node, timestamp) {
  if (node?.type !== 'flowDirection' || !isCanvasVisualAnimationCandidate(node)) return 0
  const dashLength = Math.max(.1, finiteNumber(node.borderDashLength, 8))
  const dashGap = Math.max(.1, finiteNumber(node.borderDashGap, 6))
  return -canvasVisualAnimationPhase(node, timestamp) * (dashLength + dashGap)
}

export function rotatingFanAngle(node, timestamp) {
  if (node?.type !== 'rotatingFan' || !isCanvasVisualAnimationCandidate(node)) return 0
  return canvasVisualAnimationPhase(node, timestamp) * FAN_VISUAL_CYCLE_RADIANS
}

export function waterTankAnimationState(node, timestamp) {
  if (node?.type !== 'waterTank' || !isCanvasVisualAnimationCandidate(node)) {
    return { phase: 0, waveOffset: 0, waveScale: 1 }
  }
  const phase = canvasVisualAnimationPhase(node, timestamp)
  const segment = Math.min(3, Math.floor(phase * 4))
  const progress = phase * 4 - segment
  const easedProgress = cssEaseInOut(progress)
  const offsets = [0, 1, 0, -1, 0]
  const scales = [1.04, 1, .96, 1, 1.04]
  return {
    phase,
    waveOffset: offsets[segment] + (offsets[segment + 1] - offsets[segment]) * easedProgress,
    waveScale: scales[segment] + (scales[segment + 1] - scales[segment]) * easedProgress
  }
}

function mixedWaterChannel(channel) {
  return Math.round(channel * .55 + 255 * .45)
}

export function waterTankWaveColor(node) {
  const source = String(node?.visualPrimaryColor || '#3bb9df').trim()
  const shorthand = /^#([0-9a-f]{3})$/i.exec(source)
  const full = /^#([0-9a-f]{6})$/i.exec(source)
  const hex = shorthand
    ? [...shorthand[1]].map(value => `${value}${value}`).join('')
    : full?.[1]
  if (!hex) return 'rgba(255, 255, 255, 0.45)'
  const value = Number.parseInt(hex, 16)
  const channels = [
    mixedWaterChannel(value >> 16),
    mixedWaterChannel((value >> 8) & 255),
    mixedWaterChannel(value & 255)
  ]
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function cubicBezierCoordinate(value, first, second) {
  const remaining = 1 - value
  return 3 * remaining * remaining * value * first
    + 3 * remaining * value * value * second
    + value * value * value
}

function cubicBezierDerivative(value, first, second) {
  const remaining = 1 - value
  return 3 * remaining * remaining * first
    + 6 * remaining * value * (second - first)
    + 3 * value * value * (1 - second)
}

function cssEaseInOut(value) {
  const progress = Math.max(0, Math.min(1, finiteNumber(value)))
  if (progress === 0 || progress === 1) return progress
  let parameter = progress
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = cubicBezierCoordinate(parameter, .42, .58)
    const difference = x - progress
    if (Math.abs(difference) <= 1e-9) break
    const derivative = cubicBezierDerivative(parameter, .42, .58)
    if (Math.abs(derivative) <= Number.EPSILON) break
    parameter = Math.max(0, Math.min(1, parameter - difference / derivative))
  }
  return cubicBezierCoordinate(parameter, 0, 1)
}

function interpolateHeartbeatFrame(phase, start, end, from, to) {
  if (phase < start || phase > end) return null
  const progress = cssEaseInOut((phase - start) / Math.max(Number.EPSILON, end - start))
  return from + (to - from) * progress
}

export function heartbeatAnimationScale(node, timestamp) {
  if (node?.type !== 'heartbeat' || !isCanvasVisualAnimationCandidate(node)) return 1
  const phase = canvasVisualAnimationPhase(node, timestamp)
  return interpolateHeartbeatFrame(phase, 0, .1, 1, 1.18)
    ?? interpolateHeartbeatFrame(phase, .1, .2, 1.18, .96)
    ?? interpolateHeartbeatFrame(phase, .2, .3, .96, 1.1)
    ?? interpolateHeartbeatFrame(phase, .3, .42, 1.1, 1)
    ?? 1
}

export function particleAnimationState(node, particleIndex, timestamp) {
  if (node?.type !== 'particles' || !isCanvasVisualAnimationCandidate(node)) {
    return { phase: 0, translateX: 0, opacity: 1 }
  }
  const index = Math.max(0, Math.floor(finiteNumber(particleIndex)))
  const delayedTimestamp = Math.max(0, finiteNumber(timestamp))
    + animationDurationMilliseconds(node) * (index % PARTICLE_COUNT) / PARTICLE_COUNT
  const phase = canvasVisualAnimationPhase(node, delayedTimestamp)
  const translateX = PARTICLE_TRANSLATE_START
    + (PARTICLE_TRANSLATE_END - PARTICLE_TRANSLATE_START) * phase
  const opacity = phase < .2
    ? phase / .2
    : phase <= .8
      ? 1
      : (1 - phase) / .2
  return {
    phase,
    translateX,
    opacity: Math.max(0, Math.min(1, opacity))
  }
}

export function signalLightColor(node, timestamp) {
  const count = signalPaletteCount(node)
  if (
    node?.type !== 'signalLight'
    || node.animation !== 'blink'
    || count <= 1
  ) return signalPaletteColor(node, 0)
  const phase = canvasVisualAnimationPhase(node, timestamp)
  const index = Math.min(count - 1, Math.floor(phase * count))
  return signalPaletteColor(node, index)
}

export function canvasVisualDetailSize(requestedSize, worldPixel, maximumSize, screenPixels = 1) {
  const requested = Math.max(.1, finiteNumber(requestedSize, .1))
  const pixelSize = Math.max(.0001, finiteNumber(worldPixel, 1))
  const maximum = finiteNumber(maximumSize, Number.POSITIVE_INFINITY)
  const cap = maximum > 0 ? maximum : requested
  return Math.min(cap, Math.max(
    requested,
    pixelSize * Math.max(.1, finiteNumber(screenPixels, 1))
  ))
}

function timelineKey(nodeOrId) {
  return nodeOrId && typeof nodeOrId === 'object'
    ? (nodeOrId.id ?? nodeOrId)
    : nodeOrId
}

export function createCanvasVisualAnimationTimeline() {
  const entries = new Map()
  let suspended = false

  function freeze(node, rawTimestamp) {
    const key = timelineKey(node)
    if (key == null) return 0
    const timestamp = Math.max(0, finiteNumber(rawTimestamp))
    const previous = entries.get(key)
    if (!previous) {
      entries.set(key, { timestamp: 0, observedAt: timestamp, paused: true })
      return 0
    }
    previous.observedAt = Math.max(previous.observedAt, timestamp)
    previous.paused = true
    return previous.timestamp
  }

  function resolve(node, rawTimestamp) {
    if (suspended) return freeze(node, rawTimestamp)
    const key = timelineKey(node)
    if (key == null) return 0
    const timestamp = Math.max(0, finiteNumber(rawTimestamp))
    const paused = node?.animationPaused === true
    const previous = entries.get(key)
    if (!previous) {
      const initialTimestamp = paused ? 0 : timestamp
      entries.set(key, { timestamp: initialTimestamp, observedAt: timestamp, paused })
      return initialTimestamp
    }
    if (timestamp < previous.observedAt) {
      return previous.paused
        ? previous.timestamp
        : Math.max(0, previous.timestamp - (previous.observedAt - timestamp))
    }
    const elapsed = Math.max(0, timestamp - previous.observedAt)
    if (!previous.paused) previous.timestamp += elapsed
    previous.observedAt = timestamp
    previous.paused = paused
    return previous.timestamp
  }

  function setSuspended(value, rawTimestamp = 0, nodes = []) {
    const next = value === true
    if (next) {
      for (const node of nodes || []) freeze(node, rawTimestamp)
    }
    suspended = next
    return suspended
  }

  function retain(nodeIds) {
    const retained = new Set()
    for (const nodeOrId of nodeIds || []) {
      const key = timelineKey(nodeOrId)
      if (key != null) retained.add(key)
    }
    for (const key of entries.keys()) {
      if (!retained.has(key)) entries.delete(key)
    }
    return entries.size
  }

  function remove(nodeOrId) {
    const key = timelineKey(nodeOrId)
    return key != null && entries.delete(key)
  }

  function clear() {
    entries.clear()
  }

  return Object.freeze({ resolve, freeze, setSuspended, retain, remove, clear })
}
