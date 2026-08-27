import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

function interactionAnimationHarness() {
  const source = sourceBetween(
    appSource,
    'const INTERACTION_ANIMATION_OPTIONS',
    'function normalizeBuiltInAnimationDuration'
  )
  return new Function(
    'formTypeIds',
    'BUILT_IN_ANIMATION_OPTIONS',
    `${source}\nreturn { interactionAnimationOptions, supportsInteractionAnimation }`
  )(
    new Set(['input', 'select', 'button']),
    { flowPipe: [{ value: 'flow' }], signalLight: [{ value: 'blink' }] }
  )
}

test('offers only animation effects that each component can visibly render', () => {
  const { interactionAnimationOptions } = interactionAnimationHarness()
  const values = type => interactionAnimationOptions({ type }).map(option => option.value)

  assert.deepEqual(values('rect'), ['none', 'pulse', 'float'])
  assert.deepEqual(values('cloud'), ['none', 'pulse', 'float'])
  assert.deepEqual(values('network'), ['none', 'pulse', 'float'])
  assert.deepEqual(values('router'), ['none', 'pulse', 'float'])
  assert.deepEqual(values('chart'), ['none', 'pulse', 'float', 'flow'])
  assert.deepEqual(values('gauge'), ['none', 'pulse', 'float', 'flow'])
  assert.deepEqual(values('server'), ['none', 'pulse', 'float', 'blink'])
})

test('exposes interaction animation by node capability instead of broad catalog exclusions', () => {
  const { supportsInteractionAnimation } = interactionAnimationHarness()

  for (const type of ['rect', 'chart', 'gauge', 'server', 'cloud', 'network', 'router']) {
    assert.equal(supportsInteractionAnimation({ type }), true, `${type} should expose interaction animation`)
  }
  for (const type of ['pencil', 'input', 'flowPipe', 'signalLight', 'customShapeMotion']) {
    assert.equal(supportsInteractionAnimation({ type }), false, `${type} should use its specialized properties`)
  }
})

test('commits a validated selection and refreshes cached canvas visuals', () => {
  const setterSource = sourceBetween(appSource, 'function setInteractionAnimation', 'function normalizeWaterTankProgress')
  const refreshes = []
  const allowedValues = {
    rect: ['none', 'pulse', 'float'],
    chart: ['none', 'pulse', 'float', 'flow']
  }
  const setInteractionAnimation = new Function(
    'supportsInteractionAnimation',
    'interactionAnimationOptions',
    'refreshBuiltInAnimation',
    `${setterSource}\nreturn setInteractionAnimation`
  )(
    node => Boolean(allowedValues[node?.type]),
    node => allowedValues[node.type].map(value => ({ value })),
    node => refreshes.push(node)
  )

  const rect = { type: 'rect', animation: 'none', animationPaused: true }
  setInteractionAnimation(rect, 'float')
  assert.equal(rect.animation, 'float')
  assert.equal(rect.animationPaused, false)
  assert.deepEqual(refreshes, [rect])

  const chart = { type: 'chart', animation: 'flow', animationPaused: false }
  setInteractionAnimation(chart, 'blink')
  assert.equal(chart.animation, 'none', 'unsupported values must fall back to a visible state')
  assert.equal(refreshes.at(-1), chart)

  const locked = { type: 'rect', animation: 'none', animationPaused: true, locked: true }
  setInteractionAnimation(locked, 'pulse')
  assert.deepEqual(locked, { type: 'rect', animation: 'none', animationPaused: true, locked: true })
})

test('wires the property select through the explicit animation setter', () => {
  const template = sourceBetween(
    appSource,
    '<template v-if="supportsInteractionAnimation(selected)">',
    '</template>'
  )

  assert.match(template, /data-testid="interaction-animation-select"/)
  assert.match(template, /:value="selected\.animation"/)
  assert.match(template, /@change="setInteractionAnimation\(selected, \$event\.target\.value\)"/)
  assert.match(template, /v-for="option in interactionAnimationOptions\(selected\)"/)
  assert.doesNotMatch(template, /v-model="selected\.animation"/)
})

test('places interaction animation directly after basic properties', () => {
  const basicProperties = appSource.indexOf("<h3>{{ selected.type === 'lineShape' ? '线条尺寸'")
  const interactionAnimation = appSource.indexOf('<template v-if="supportsInteractionAnimation(selected)">')
  const pencilEditor = appSource.indexOf('<template v-if="selected.type === \'pencil\'">', interactionAnimation)
  const textEditor = appSource.indexOf('<h3>文字编辑</h3>', interactionAnimation)

  assert.ok(basicProperties >= 0, 'expected the basic property section')
  assert.ok(interactionAnimation > basicProperties, 'interaction animation should follow basic properties')
  assert.ok(pencilEditor > interactionAnimation, 'interaction animation should precede pencil editing')
  assert.ok(textEditor > interactionAnimation, 'interaction animation should precede text editing')
})

test('preserves property scroll while choosing an animation and leaves room for the last control', () => {
  const watcher = sourceBetween(
    appSource,
    'watch(propertyInspectionIdentity',
    'function rejectLockedSelection'
  )

  assert.match(
    appSource,
    /<div ref="propertiesPanel" class="properties" v-show="rightTab === '属性'"/,
    'the property panel must stay mounted while another right-side tab is active'
  )
  assert.doesNotMatch(appSource, /ref="propertiesPanel"[^>]*v-if=/)
  assert.match(appSource, /<CommunicationBindingPanel\s+v-if="rightTab === '通信'"/)
  assert.doesNotMatch(appSource, /<CommunicationBindingPanel\s+v-else-if=/)
  assert.match(watcher, /propertiesPanel\.value\.scrollTop = 0/)
  assert.match(watcher, /flush: 'post'/)
  assert.doesNotMatch(watcher, /rightTab|rightOpen/)
  assert.doesNotMatch(appSource, /watch\(\[propertyInspectionIdentity,\s*rightTab,\s*rightOpen\]/)
  assert.match(appSource, /<div class="properties" v-if="rightTab === '布局'"/)
  assert.match(appSource, /<div class="properties structure-list" v-if="rightTab === '结构'"/)
  assert.match(
    enhancementCss,
    /\.right-panel\s*>\s*\.properties:not\(\.communication-properties\)\s*\{[^}]*padding-bottom:\s*16px;/
  )
})
