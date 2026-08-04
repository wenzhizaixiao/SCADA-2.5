import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const managerSource = readFileSync(new URL('../src/components/DataSourceManager.vue', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker}`)
  return source.slice(start, end)
}

test('selects connection metadata without copying response bodies or point catalogs', () => {
  assert.match(managerSource, /getSource\(id,\s*\{\s*includePoints:\s*false\s*\}\)/)
  assert.match(managerSource, /testSource\(selectedSource\.value\.id,\s*\{\s*includePoints:\s*false\s*\}\)/)
  assert.doesNotMatch(managerSource, /querySourcePoints|selectedSource\.points|lastResponse\?\.preview/)
})

test('keeps data-source management focused on connection lifecycle', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /基础信息/)
  assert.match(template, /selectedSource\.protocol.*配置/)
  assert.match(template, /测试连接/)
  assert.match(template, /连接测试/)
  assert.doesNotMatch(template, /数据点位|查看全部点位|point-table|runPointSearch/)
})

test('places edit and delete controls together on every connection row', () => {
  const sidebar = sourceBetween(managerSource, '<aside class="source-sidebar">', '</aside>')
  assert.match(sidebar, /class="source-item-actions"[\s\S]*?编辑连接：[\s\S]*?<Pencil \/>[\s\S]*?删除连接：[\s\S]*?<Trash2 \/>/)
  assert.match(sidebar, /@click="removeSource\(source\)"/)
  assert.match(managerSource, /window\.confirm\(/)
})

test('summary exposes only connection health and never renders a response payload', () => {
  const template = sourceBetween(managerSource, '<template>', '</template>')
  assert.match(template, /sourceStats\.online/)
  assert.match(template, /sourceStats\.total/)
  assert.match(template, /sourceStats\.errors/)
  assert.doesNotMatch(template, /sourceStats\.points|<pre>/)
})

test('validates protocol field bounds, enumerations and HTTP header JSON before requests', () => {
  const validation = sourceBetween(managerSource, 'function validateDraft()', 'async function saveSource')
  assert.match(validation, /field\.type === 'number'/)
  assert.match(validation, /numeric < field\.min/)
  assert.match(validation, /numeric > field\.max/)
  assert.match(validation, /field\.type === 'select'.*field\.options\?\.includes/s)
  assert.match(validation, /protocol === 'HTTP'[\s\S]*?JSON\.parse[\s\S]*?请求头必须是 JSON 对象/)
})
