import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const drawingUrl = new URL('../图纸库/接口测试.json', import.meta.url)

test('interface test drawing keeps one canonical component set', {
  skip: existsSync(drawingUrl) ? false : 'optional interface-test drawing is not present'
}, () => {
  const drawing = JSON.parse(readFileSync(drawingUrl, 'utf8'))
  const expectedTypes = [
    'rect',
    'text',
    'formProgress',
    'table',
    'time',
    'select',
    'flowPipe',
    'rotatingFan',
    'signalLight',
    'customMotion',
    'rect',
    'progress',
    'hexagon',
    'circle',
    'flowPipe'
  ]

  assert.equal(drawing.nodes.length, 15)
  assert.deepEqual(drawing.nodes.map(node => node.type), expectedTypes)
  assert.deepEqual(drawing.nodes.map(node => node.layer), expectedTypes.map((_, index) => index + 1))
  assert.equal(new Set(drawing.nodes.map(node => node.id)).size, drawing.nodes.length)
  assert.equal(drawing.nodes.filter(node => node.type === 'signalLight').length, 1)
})
