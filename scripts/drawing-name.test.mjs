import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingComparisonKey, drawingNamesMatch } from '../src/utils/drawingName.js'

test('normalizes drawing names without changing case-sensitive filesystem semantics', () => {
  assert.equal(drawingComparisonKey('e\u0301.json'), 'é.json')
  assert.equal(drawingNamesMatch('Plant.JSON', 'plant.json'), false)
})

test('matches drawing names case-insensitively when the backend filesystem does', () => {
  assert.equal(drawingNamesMatch('Plant.JSON', 'plant.json', false), true)
  assert.equal(drawingNamesMatch('e\u0301.JSON', 'É.json', false), true)
})
