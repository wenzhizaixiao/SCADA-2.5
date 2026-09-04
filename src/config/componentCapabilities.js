const BUILT_IN_ANIMATION_TYPES = new Set([
  'flowDirection',
  'flowPipe',
  'rotatingFan',
  'signalLight',
  'waterTank',
  'heartbeat',
  'particles'
])

const CUSTOM_ANIMATION_TYPES = new Set([
  'customMotion',
  'customTextMotion',
  'customImageMotion',
  'customIndicator'
])

export function isBuiltInAnimationComponentType(type) {
  return BUILT_IN_ANIMATION_TYPES.has(String(type ?? ''))
}

export function isCustomAnimationComponentType(type) {
  return CUSTOM_ANIMATION_TYPES.has(String(type ?? ''))
}

export function isAnimationComponentType(type) {
  return isBuiltInAnimationComponentType(type) || isCustomAnimationComponentType(type)
}
