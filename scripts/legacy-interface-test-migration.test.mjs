import assert from 'node:assert/strict'
import test from 'node:test'
import {
  legacyInterfaceTestProjectNeedsMigration,
  migrateLegacyInterfaceTestProject
} from '../src/utils/legacyInterfaceTestMigration.js'
import { prepareProject } from '../src/utils/projectPreparation.js'
import { prepareWorkspaceSessionSnapshot } from '../src/utils/workspaceSessionCache.js'
import { PROJECT_VERSION } from '../src/utils/projectMigration.js'

const PROJECT_ID = 'project-7c45e4ef-6c0a-49f2-8bf8-04022db40ee1'
const BASE_IDS = [
  'node-32b12f5f-00d0-4c58-b86f-cf19027ed446',
  'node-6270cbe2-bcf0-4790-a019-696f0b918221',
  'node-dd325af1-88c5-4876-aff6-7acaa60d8759',
  'node-80d23fd1-cb06-44a0-8d15-5dbe6d02ec3a',
  'node-b74f7f36-50fb-4906-83f2-4ec45380ba86',
  'node-308cf401-82ab-4312-88d2-4b667fe407df',
  'node-9251d141-3f15-425d-a2bd-3bd45237dcb2',
  'node-0cdf7fa8-dd74-42f4-956b-5f673221e3aa',
  'node-252a1111-9248-47c0-ad01-d56c87943c82',
  'node-e9bb7fff-708e-459b-b2f5-12cface6a5b9',
  'node-ff374e25-2b82-423c-8206-68e41ed0050f',
  'node-05ccd4c5-6c0a-4e3b-bae2-7667db1abc54'
]
const BASE_TYPES = [
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
  'progress'
]
const TAIL_NODES = [
  { id: 'node-c1a1c902-e9a2-4db7-8d12-835c880ffa9f', type: 'hexagon' },
  { id: 'node-7a81afe0-087a-41b4-bf1c-e97d1fa17c57', type: 'circle' },
  { id: 'node-c961a4c6-678b-49bd-9c6e-f03a9638e73f', type: 'flowPipe' }
]

function node(id, type, layer, offset = 0) {
  return {
    id,
    type,
    layer,
    x: 100 + offset,
    y: 100 + offset,
    w: 100,
    h: 60,
    text: type,
    dataKey: `shared.${type}`
  }
}

function legacyInterfaceTestProject() {
  const nodes = []
  for (let copy = 0; copy < 64; copy += 1) {
    BASE_TYPES.forEach((type, index) => {
      const id = copy === 0 ? BASE_IDS[index] : `duplicate-${copy}-${index}`
      nodes.push(node(id, type, nodes.length + 1, copy * 24))
    })
  }
  for (const entry of TAIL_NODES) nodes.push(node(entry.id, entry.type, nodes.length + 1))
  return {
    version: PROJECT_VERSION,
    projectId: PROJECT_ID,
    revision: 1,
    fileName: '\u63a5\u53e3\u6d4b\u8bd5',
    stageWidth: 1707,
    stageHeight: 1067,
    nodes,
    edges: [],
    drawings: [],
    customComponents: []
  }
}

test('migrates only the known 771-node interface-test duplication incident', () => {
  const source = legacyInterfaceTestProject()
  const migrated = migrateLegacyInterfaceTestProject(source)

  assert.equal(legacyInterfaceTestProjectNeedsMigration(source), true)
  assert.notEqual(migrated, source)
  assert.equal(source.nodes.length, 771)
  assert.equal(migrated.nodes.length, 15)
  assert.equal(migrated.revision, 2)
  assert.deepEqual(migrated.nodes.map(entry => entry.id), [...BASE_IDS, ...TAIL_NODES.map(entry => entry.id)])
  assert.equal(migrated.nodes.filter(entry => entry.type === 'signalLight').length, 1)
})

test('keeps an already-correct interface-test project unchanged', () => {
  const migrated = migrateLegacyInterfaceTestProject(legacyInterfaceTestProject())
  assert.equal(migrateLegacyInterfaceTestProject(migrated), migrated)
  assert.equal(legacyInterfaceTestProjectNeedsMigration(migrated), false)
})

test('does not apply generic data-key deduplication to other projects', () => {
  const source = legacyInterfaceTestProject()
  source.projectId = 'project-with-legitimate-repeated-bindings'
  const result = migrateLegacyInterfaceTestProject(source)

  assert.equal(result, source)
  assert.equal(result.nodes.length, 771)
  assert.equal(new Set(result.nodes.map(entry => entry.dataKey)).size < result.nodes.length, true)
})

test('refuses the migration when the incident shape contains graph data', () => {
  const source = legacyInterfaceTestProject()
  source.edges.push({ id: 'edge-user', from: BASE_IDS[0], to: BASE_IDS[1] })
  assert.equal(migrateLegacyInterfaceTestProject(source), source)
})

test('project preparation compacts the retained nodes into the canonical layer order', () => {
  const prepared = prepareProject(legacyInterfaceTestProject())

  assert.equal(prepared.nodes.length, 15)
  assert.deepEqual(prepared.nodes.map(entry => entry.layer), Array.from({ length: 15 }, (_, index) => index + 1))
  assert.equal(prepared.nodes.filter(entry => entry.type === 'signalLight').length, 1)
  assert.equal(prepared.edges.length, 0)
})

test('workspace restoration marks a migrated legacy session for durable rewrite', () => {
  const prepared = prepareWorkspaceSessionSnapshot({
    version: 1,
    workspace: 'default',
    activeId: 'paper-interface-test',
    sessions: [{
      id: 'paper-interface-test',
      data: legacyInterfaceTestProject(),
      history: [],
      future: []
    }]
  }, 'default', prepareProject)

  assert.equal(prepared.sanitized, true)
  assert.equal(prepared.sessions[0].data.nodes.length, 15)
  assert.equal(prepared.sessions[0].data.nodes.filter(entry => entry.type === 'signalLight').length, 1)
})
