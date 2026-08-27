import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(
  new URL('../src/components/DataSourceManager.vue', import.meta.url),
  'utf8'
)

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker}`)
  return source.slice(start, end)
}

test('identifies the active drawing as the data-source owner', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')

  assert.match(managerSource, /drawingName:\s*\{\s*type:\s*String,\s*default:\s*'未命名图纸'\s*\}/)
  assert.match(managerSource, /const drawingDisplayName = computed/)
  assert.match(template, /data-testid="data-source-drawing-name"/)
  assert.match(template, /当前图纸 · <b>\{\{ drawingDisplayName \}\}<\/b>/)
  assert.match(template, /仅用于当前图纸 · \{\{ drawingDisplayName \}\}/)
  assert.doesNotMatch(template, /当前工作空间|数据按当前工作空间保存/)
})

test('makes an empty connection catalog specific and actionable for the active drawing', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  const overview = sourceBetween(
    template,
    '<section v-else-if="managerView === \'overview\'"',
    '<div v-else-if="managerView !== \'create\' && !selectedSource"'
  )

  assert.match(overview, /hasSourceFilters \? '没有匹配的连接' : '当前图纸暂无数据连接'/)
  assert.match(overview, /“\$\{drawingDisplayName\}”尚未配置专属连接/)
  assert.match(overview, /v-else type="button" @click="openProtocolPicker"><Plus \/>新建连接<\/button>/)
})
