import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const enhancementCss = readFileSync(new URL('../src/enhancements.css', import.meta.url), 'utf8')
const nodeVisualSource = readFileSync(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

test('ordinary components no longer expose or execute generic animation effects', () => {
  assert.doesNotMatch(appSource, /INTERACTION_ANIMATION_OPTIONS/)
  assert.doesNotMatch(appSource, /supportsInteractionAnimation/)
  assert.doesNotMatch(appSource, /interaction-animation-select/)
  assert.doesNotMatch(appSource, />交互动画</)
  assert.match(nodeVisualSource, /isAnimationComponentType\(node\.value\?\.type\)/)
  assert.match(nodeVisualSource, /animationComponentActive/)
})

test('built-in and custom animation categories keep their dedicated controls', () => {
  assert.match(appSource, /selectedCategory === '动效组件'/)
  assert.match(appSource, /<h3>动效属性<\/h3>/)
  assert.match(appSource, /selectedCategory === '自定义动效'/)
  assert.match(appSource, /<h3>自定义动效<\/h3>/)
})

test('every component exposes the same static visibility property used by communication binding', () => {
  assert.match(appSource, /显示组件<input type="checkbox" v-model="selected\.visible"/)
  assert.match(nodeVisualSource, /v-show="node\.visible !== false"/)
})

test('every communication parameter is gated by a matching property editor contract and wired to a real control', () => {
  assert.match(appSource, /import \{ getPropertyEditorContract \} from '\.\/config\/componentPropertyContracts'/)
  assert.match(
    appSource,
    /getBindableParameters\(selected\.value\)[\s\S]*?filter\(parameter => getPropertyEditorContract\(selected\.value, parameter\.target\)\)/
  )

  for (const target of [
    'fill',
    'stroke',
    'opacity',
    'text',
    'visible',
    'animationPlaying',
    'animationDuration',
    'tableRowFill',
    'tableBorderColor',
    'tableTitle',
    'tableHeaders',
    'tableCells',
    'tableData',
    'checked',
    'value',
    'progressValue',
    'visualPrimaryColor',
    'polylineColor',
    'chartData',
    'signalOpacity'
  ]) {
    assert.match(
      appSource,
      new RegExp(`(?:data-property-target="${target}"|data-property-targets="[^"]*\\b${target}\\b[^"]*")`),
      `missing property control for communication target ${target}`
    )
  }

  assert.match(appSource, /v-for="parameter in selectedSignalColorParameters"[\s\S]*?:data-property-target="parameter\.target"/)
})

test('keeps the time binding fallback editable while live time sources are active', () => {
  const setter = sourceBetween(appSource, 'function setTimeStaticValue', 'function setTimeFormat')
  const timeProperty = appSource.match(/<label class="field" data-property-target="value">\{\{ selected\.timeMode[\s\S]*?<\/label>/)?.[0] || ''

  assert.match(setter, /node\.defaultValue = text/)
  assert.match(setter, /if \(!node\.timeUseServer && !node\.timeRunning\) node\.value = text/)
  assert.doesNotMatch(setter, /\|\| node\.timeUseServer \|\| node\.timeRunning/)
  assert.doesNotMatch(timeProperty, /:disabled=/)
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
