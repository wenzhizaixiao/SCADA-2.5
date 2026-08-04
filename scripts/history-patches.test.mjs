import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  applyFieldRecord,
  applyListRecords,
  captureFieldRecord,
  captureInverseFieldRecord,
  captureInverseListRecords,
  createListInsertionRecords,
  createListRemovalRecords,
  fieldRecordChanged,
  historyValueBytes
} from '../src/utils/historyPatches.js'

test('field patches reverse nested table edits without sharing mutable containers', () => {
  const node = {
    id: 'table-1',
    tableCells: [['A', 'B']],
    tableMerges: [],
    tableColumnWidthsPx: [120, 160]
  }
  const before = captureFieldRecord(node, ['tableCells', 'tableMerges', 'tableColumnWidthsPx'])

  node.tableCells[0][0] = 'changed'
  node.tableMerges.push({ row: 0, column: 0, rowSpan: 1, columnSpan: 2 })
  node.tableColumnWidthsPx[0] = 240
  assert.equal(fieldRecordChanged(node, before), true)

  const redo = captureInverseFieldRecord(node, before)
  applyFieldRecord(node, before)
  assert.deepEqual(node.tableCells, [['A', 'B']])
  assert.deepEqual(node.tableMerges, [])
  assert.deepEqual(node.tableColumnWidthsPx, [120, 160])
  assert.notEqual(node.tableCells, before.values.tableCells)
  assert.notEqual(node.tableCells[0], before.values.tableCells[0])

  applyFieldRecord(node, redo)
  assert.deepEqual(node.tableCells, [['changed', 'B']])
  assert.equal(node.tableColumnWidthsPx[0], 240)
})

test('field patches reverse grouping and lock state changes', () => {
  const node = { id: 'node-1', groupId: null, locked: false }
  const before = captureFieldRecord(node, ['groupId', 'locked'])
  node.groupId = 'group-1'
  node.locked = true

  const redo = captureInverseFieldRecord(node, before)
  applyFieldRecord(node, before)
  assert.deepEqual(node, { id: 'node-1', groupId: null, locked: false })
  applyFieldRecord(node, redo)
  assert.deepEqual(node, { id: 'node-1', groupId: 'group-1', locked: true })
})

test('custom component list patches reverse insertion and removal at stable indexes', () => {
  const original = { id: 'custom-a', name: 'A', nodes: [{ id: 'template-a' }] }
  const inserted = { id: 'custom-b', name: 'B', nodes: [{ id: 'template-b' }] }
  const source = [original, inserted]

  const insertionUndo = createListInsertionRecords([inserted], 1)
  const insertionRedo = captureInverseListRecords(insertionUndo, source)
  applyListRecords(insertionUndo, source)
  assert.deepEqual(source.map(item => item.id), ['custom-a'])
  applyListRecords(insertionRedo, source)
  assert.deepEqual(source.map(item => item.id), ['custom-a', 'custom-b'])
  assert.notEqual(source[1], inserted)

  const removalUndo = createListRemovalRecords([source[0]], source)
  source.splice(0, 1)
  const removalRedo = captureInverseListRecords(removalUndo, source)
  applyListRecords(removalUndo, source)
  assert.deepEqual(source.map(item => item.id), ['custom-a', 'custom-b'])
  applyListRecords(removalRedo, source)
  assert.deepEqual(source.map(item => item.id), ['custom-b'])
})

test('large media strings are retained without JSON serialization or string copies', () => {
  const media = `data:video/mp4;base64,${'A'.repeat(4 * 1024 * 1024)}`
  const node = { id: 'video-1', videoUrl: media }
  const originalStringify = JSON.stringify
  JSON.stringify = () => { throw new Error('history must not serialize') }
  try {
    const record = captureFieldRecord(node, ['videoUrl'])
    assert.equal(record.values.videoUrl, media)
    assert.ok(historyValueBytes(record) >= media.length * 2)
    node.videoUrl = 'https://example.invalid/video.mp4'
    applyFieldRecord(node, record)
    assert.equal(node.videoUrl, media)
  } finally {
    JSON.stringify = originalStringify
  }
})

test('App history wiring has no synchronous full-document snapshot fallback', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /function\s+commit\s*\(/)
  assert.doesNotMatch(source, /\b(snapshot|restore)\s*\(/)
  assert.doesNotMatch(source, /^\s*(?:else\s+)?commit\(\)\s*;?\s*$/m)
  for (const name of ['insertTableRow', 'deleteTableRow', 'insertTableColumn', 'deleteTableColumn']) {
    assert.match(source, new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?recordNodeFields\\(node, TABLE_MODEL_HISTORY_FIELDS\\)`))
  }
  for (const name of ['mergeSelectedTableCells', 'splitSelectedTableCells']) {
    assert.match(source, new RegExp(`function ${name}\\(\\)[\\s\\S]*?recordNodeFields\\(node, \\['tableMerges'\\]\\)`))
  }
  for (const name of ['addSelectOption', 'removeSelectOption']) {
    assert.match(source, new RegExp(`function ${name}\\([^)]*\\)[\\s\\S]*?recordNodeFields\\(node, \\['selectOptions', 'value', 'defaultValue'\\]\\)`))
  }
  assert.match(source, /function commitPointerOperation\(op\)[\s\S]*?if \(entry\) recordHistory\(entry\)[\s\S]*?op\.historyCommitted = true/)
  assert.match(source, /function groupSelectedNodes\(\)[\s\S]*?recordNodeFields\(groupNodes, \['groupId'\]\)/)
  assert.match(source, /function ungroupSelectedNodes\(\)[\s\S]*?recordNodeFields\(affected, \['groupId'\]\)/)
  assert.match(source, /function setSelectedDrawingMetric\([^)]*\)[\s\S]*?recordHistory\(\{ kind: 'geometry'/)
  assert.match(source, /function setSelectedNodesMetric\([^)]*\)[\s\S]*?geometryHistoryForNodes\(items\)/)
  assert.match(source, /function align\([^)]*\)[\s\S]*?geometryHistoryForNodes\(selectedNodes\.value\)/)
  assert.match(source, /function toggleLock\(\)[\s\S]*?\['locked'\]/)
  assert.match(source, /function bringFront\(\)[\s\S]*?recordLayerHistory\(\)/)
  assert.match(source, /function sendBack\(\)[\s\S]*?recordLayerHistory\(\)/)
  assert.match(source, /function moveLayer\([^)]*\)[\s\S]*?recordLayerHistory\(\)/)
  assert.match(source, /function confirmCustomComponent\(\)[\s\S]*?recordCustomComponentInsertion\(\[item\]\)/)
  assert.match(source, /function deleteCustomComponent\(id\)[\s\S]*?recordCustomComponentRemoval\(\[item\]\)/)
  assert.match(source, /function readNodeMediaFile\([^)]*\)[\s\S]*?recordNodeFields\(target\.node, \[options\.field\]\)/)
  assert.match(source, /function uploadNodeImage\(e\)[\s\S]*?field: 'imageUrl'/)
  assert.match(source, /function flushPendingVideoUrlEdit\([^)]*\)[\s\S]*?recordNodeFields\(node, \['videoUrl'\]\)/)
  assert.match(source, /function clearSelectedVideoSource\(\)[\s\S]*?recordNodeFields\(node, \['videoUrl'\]\)/)
  assert.match(source, /function uploadNodeVideo\(e\)[\s\S]*?field: 'videoUrl'/)
  assert.match(source, /@focusin\.capture="beginSelectedFieldEdit"/)
  assert.match(source, /@focusin\.capture="beginTableFieldEdit"/)
})
