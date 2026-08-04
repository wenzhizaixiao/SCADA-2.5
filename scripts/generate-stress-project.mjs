import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PROJECT_VERSION } from '../src/utils/projectMigration.js'

const requestedCount = Number.parseInt(process.argv[2] || '2000', 10)
const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10000, requestedCount)) : 2000
const columns = 55
const stageWidth = 6000
const stageHeight = Math.max(4000, 120 + Math.ceil(count / columns) * 90)
const nodes = Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  type: index % 8 === 0 ? 'gauge' : 'rect',
  x: 40 + (index % columns) * 105,
  y: 40 + Math.floor(index / columns) * 90,
  w: 82,
  h: 54,
  rotate: 0,
  text: `N${index + 1}`,
  fill: index % 8 === 0 ? '#eefaf7' : '#ffffff',
  stroke: '#16b89a',
  color: '#28323c',
  radius: 4,
  locked: false,
  animation: index % 8 === 0 ? 'flow' : 'none',
  dataKey: index % 8 === 0 ? `stress.value.${index + 1}` : ''
}))

const edges = Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
  id: count + index + 1,
  from: index + 1,
  to: index + 2,
  color: '#98a2a9',
  width: 1,
  dash: false
}))

const createdAt = new Date().toISOString()
const document = {
  version: PROJECT_VERSION,
  projectId: `stress-project-${randomUUID()}`,
  revision: 0,
  createdAt,
  updatedAt: null,
  fileName: `压力测试-${count}节点`,
  nodes,
  edges,
  drawings: [],
  customComponents: [],
  stageWidth,
  stageHeight,
  canvasBg: '#f7f8fa',
  canvasBorderColor: '#cbd3d9',
  canvasBorderWidth: 1,
  showGrid: true,
  gridColor: '#dde3e7',
  gridStyle: 'line',
  snap: false,
  gridSize: 20,
  lineColor: '#485563',
  lineWidth: 2,
  lineDash: false,
  lineStartMarker: 'none',
  lineEndMarker: 'arrow',
  lineAnchorMode: 'edge'
}
const output = new URL('../stress-project.json', import.meta.url)
await writeFile(output, JSON.stringify(document))
console.log(`Generated ${count} nodes and ${edges.length} edges: ${output.pathname}`)
