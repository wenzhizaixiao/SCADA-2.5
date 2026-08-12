const LEGACY_INTERFACE_TEST_PROJECT_ID = 'project-7c45e4ef-6c0a-49f2-8bf8-04022db40ee1'
const LEGACY_INTERFACE_TEST_FILE_NAME = '接口测试'
const LEGACY_INTERFACE_TEST_NODE_COUNT = 771

const BASE_NODE_IDS = Object.freeze([
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
])

const TAIL_NODE_IDS = Object.freeze([
  'node-c1a1c902-e9a2-4db7-8d12-835c880ffa9f',
  'node-7a81afe0-087a-41b4-bf1c-e97d1fa17c57',
  'node-c961a4c6-678b-49bd-9c6e-f03a9638e73f'
])

const BASE_NODE_TYPES = Object.freeze([
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
])

const EXPECTED_TYPE_COUNTS = Object.freeze({
  rect: 128,
  text: 64,
  formProgress: 64,
  table: 64,
  time: 64,
  select: 64,
  flowPipe: 65,
  rotatingFan: 64,
  signalLight: 64,
  customMotion: 64,
  progress: 64,
  hexagon: 1,
  circle: 1
})

const RETAINED_NODE_IDS = new Set([...BASE_NODE_IDS, ...TAIL_NODE_IDS])

function idsMatch(nodes, start, expectedIds) {
  return expectedIds.every((id, index) => nodes[start + index]?.id === id)
}

function duplicateSequenceMatches(nodes) {
  const duplicateNodeCount = BASE_NODE_IDS.length * 64
  for (let index = 0; index < duplicateNodeCount; index += 1) {
    if (nodes[index]?.type !== BASE_NODE_TYPES[index % BASE_NODE_TYPES.length]) return false
  }
  return true
}

function typeCountsMatch(nodes) {
  const counts = Object.create(null)
  for (const node of nodes) counts[node?.type] = (counts[node?.type] || 0) + 1
  const entries = Object.entries(EXPECTED_TYPE_COUNTS)
  return Object.keys(counts).length === entries.length
    && entries.every(([type, count]) => counts[type] === count)
}

export function legacyInterfaceTestProjectNeedsMigration(data) {
  const nodes = data?.nodes
  return Boolean(
    data
    && data.projectId === LEGACY_INTERFACE_TEST_PROJECT_ID
    && data.fileName === LEGACY_INTERFACE_TEST_FILE_NAME
    && Number(data.stageWidth) === 1707
    && Number(data.stageHeight) === 1067
    && Array.isArray(nodes)
    && nodes.length === LEGACY_INTERFACE_TEST_NODE_COUNT
    && Array.isArray(data.edges)
    && data.edges.length === 0
    && Array.isArray(data.drawings)
    && data.drawings.length === 0
    && idsMatch(nodes, 0, BASE_NODE_IDS)
    && idsMatch(nodes, nodes.length - TAIL_NODE_IDS.length, TAIL_NODE_IDS)
    && duplicateSequenceMatches(nodes)
    && typeCountsMatch(nodes)
  )
}

export function migrateLegacyInterfaceTestProject(data) {
  if (!legacyInterfaceTestProjectNeedsMigration(data)) return data
  return {
    ...data,
    revision: Math.max(2, Math.floor(Number(data.revision) || 0) + 1),
    nodes: data.nodes.filter(node => RETAINED_NODE_IDS.has(node.id))
  }
}
