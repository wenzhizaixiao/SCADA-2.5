import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCanvasSizeMode, prepareProject } from '../src/utils/projectPreparation.js'
import { PROJECT_VERSION } from '../src/utils/projectMigration.js'

function legacyProject() {
  return {
    version: PROJECT_VERSION - 1,
    projectId: 'project-stable',
    revision: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    fileName: '',
    stageWidth: '700',
    stageHeight: 500,
    lineColor: '#123456',
    lineWidth: 4,
    lineDash: true,
    lineStartMarker: 'circle',
    lineEndMarker: 'square',
    lineAnchorMode: 'center',
    nodes: [
      { id: 'node-a', type: 'rect', x: 10, y: 20, w: 40, h: 30, layer: 100, text: 'A' }
    ],
    edges: [
      { id: 'edge-a', from: 'node-a', to: 'pencil-legacy' }
    ],
    drawings: [
      {
        id: 'legacy',
        layer: 50,
        color: '#abcdef',
        width: 3,
        opacity: 0.75,
        points: [{ x: 100, y: 100 }, { x: 120, y: 110 }]
      }
    ],
    customComponents: [
      {
        id: 'custom-a',
        name: ' Legacy custom ',
        createdAt: '2025-12-01T00:00:00.000Z',
        nodes: [
          {
            id: 'custom-node-a',
            type: 'lineShape',
            x: 10,
            y: 10,
            w: 40,
            h: 12,
            borderWidth: 2,
            stroke: '#ff0000',
            locked: true,
            groupId: 'legacy-group'
          }
        ],
        edges: []
      }
    ]
  }
}

test('prepares legacy projects without changing drawing, edge, custom component, or layer semantics', () => {
  const prepared = prepareProject(legacyProject(), 'fallback-name')

  assert.equal(prepared.version, PROJECT_VERSION)
  assert.equal(prepared.projectId, 'project-stable')
  assert.equal(prepared.fileName, 'fallback-name')
  assert.equal(prepared.stageWidth, 700)
  assert.equal(prepared.stageHeight, 500)
  assert.equal(prepared.drawings.length, 0)
  assert.deepEqual(prepared.nodes.map(node => node.id), ['node-a', 'pencil-legacy'])
  assert.deepEqual(prepared.nodes.map(node => node.layer), [2, 1])

  const pencil = prepared.nodes[1]
  assert.equal(pencil.type, 'pencil')
  assert.equal(pencil.pencilColor, '#abcdef')
  assert.equal(pencil.pencilWidth, 3)
  assert.equal(pencil.opacity, 0.75)
  assert.deepEqual(pencil.pencilPoints, [{ x: 0, y: 0 }, { x: 1, y: 1 }])

  assert.deepEqual(
    prepared.edges.map(edge => ({ from: edge.from, to: edge.to, color: edge.color, width: edge.width, dash: edge.dash })),
    [{ from: 'node-a', to: 'pencil-legacy', color: '#123456', width: 4, dash: true }]
  )

  const custom = prepared.customComponents[0]
  assert.equal(custom.name, 'Legacy custom')
  assert.equal(custom.nodes[0].locked, false)
  assert.equal(custom.nodes[0].groupId, null)
  assert.equal(custom.nodes[0].y, 0)
  assert.equal(custom.nodes[0].h, 2)
  assert.equal(custom.nodes[0].fill, '#ff0000')
})

test('does not mutate the source project while preparing it', () => {
  const source = legacyProject()
  const snapshot = structuredClone(source)
  prepareProject(source, 'fallback-name')
  assert.deepEqual(source, snapshot)
})

test('preserves explicit screen canvas sizing and defaults legacy projects to fixed sizing', () => {
  assert.equal(normalizeCanvasSizeMode('screen'), 'screen')
  assert.equal(normalizeCanvasSizeMode('fixed'), 'fixed')
  assert.equal(normalizeCanvasSizeMode('unknown'), 'fixed')

  assert.equal(prepareProject({ ...legacyProject(), canvasSizeMode: 'screen' }).canvasSizeMode, 'screen')
  assert.equal(prepareProject(legacyProject()).canvasSizeMode, 'fixed')
})
