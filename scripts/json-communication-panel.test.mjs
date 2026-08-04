import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const panelSource = readFileSync(new URL('../src/components/CommunicationBindingPanel.vue', import.meta.url), 'utf8')
const treeSource = readFileSync(new URL('../src/components/JsonPathTree.vue', import.meta.url), 'utf8')

test('communication panel selects a source and emits an explicit source JSONPath binding', () => {
  assert.match(panelSource, /gateway:\s*\{\s*type:\s*Object/)
  assert.doesNotMatch(panelSource, /points:\s*\{\s*type:\s*Array/)
  assert.doesNotMatch(panelSource, /sourceNames:\s*\{\s*type:\s*Object/)
  assert.match(panelSource, /props\.gateway\.listSources\(\)/)
  assert.match(panelSource, /props\.gateway\.getSourceSnapshot\(normalizedSourceId, \{ shared: true \}\)/)
  assert.match(panelSource, /evaluateJsonPath\(snapshot\.value\.data, path\)/)
  assert.match(panelSource, /emit\('bind',\s*\{[\s\S]*?target:\s*activeTarget\.value,[\s\S]*?sourceId:\s*selectedSourceId\.value,[\s\S]*?jsonPath:\s*normalizedPath\.value/)
})

test('communication panel keeps property order and identifies legacy point bindings', () => {
  const parameterLoop = panelSource.slice(
    panelSource.indexOf('for (const parameter of props.parameters || [])'),
    panelSource.indexOf('const parameterByTarget')
  )
  assert.match(parameterLoop, /result\.push/)
  assert.doesNotMatch(parameterLoop, /\.sort\(/)
  assert.match(panelSource, /旧绑定待重新选择/)
  assert.match(panelSource, /binding\?\.pointId/)
  assert.match(panelSource, /@click="unbind\(parameter\.target\)"/)
})

test('JSON tree expands lazily with per-level, visible-node and depth budgets', () => {
  assert.match(treeSource, /maxChildren:\s*\{\s*type:\s*Number,\s*default:\s*60/)
  assert.match(treeSource, /maxVisible:\s*\{\s*type:\s*Number,\s*default:\s*240/)
  assert.match(treeSource, /maxDepth:\s*\{\s*type:\s*Number,\s*default:\s*12/)
  assert.match(treeSource, /if \(!expanded\) return/)
  assert.match(treeSource, /entries\.length >= limit/)
  assert.match(treeSource, /result\.length >= visibleLimit\.value/)
  assert.doesNotMatch(treeSource, /JSON\.stringify/)
  assert.doesNotMatch(treeSource, /Object\.keys/)
})
