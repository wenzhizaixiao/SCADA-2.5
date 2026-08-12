import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { baseNodeOptions, normalizeNode } from '../src/models/editorModel.js'
import { PROJECT_VERSION } from '../src/utils/projectMigration.js'

const requestedCount = Number.parseInt(process.argv[2] || '2400', 10)
const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10_000, requestedCount)) : 2400
const output = resolve(process.argv[3] || 'mixed-binding-stress-project.json')
const columns = 48
const types = ['rect', 'text', 'gauge', 'flowPipe', 'rotatingFan', 'signalLight', 'waterTank', 'heartbeat', 'particles']
const animationForType = {
  flowPipe: 'flow',
  rotatingFan: 'flow',
  signalLight: 'blink',
  waterTank: 'flow',
  heartbeat: 'pulse',
  particles: 'flow'
}

function bindingTarget(type) {
  if (type === 'signalLight') return 'signalColors.0'
  if (['flowPipe', 'rotatingFan', 'waterTank', 'heartbeat', 'particles'].includes(type)) return 'visualPrimaryColor'
  if (type === 'gauge') return 'progressValue'
  return 'fill'
}

const nodes = Array.from({ length: count }, (_, index) => {
  const type = types[index % types.length]
  const animation = animationForType[type] || 'none'
  return normalizeNode({
    ...baseNodeOptions(),
    id: `mixed-${index + 1}`,
    layer: index + 1,
    type,
    x: 36 + (index % columns) * 116,
    y: 36 + Math.floor(index / columns) * 92,
    w: type === 'flowPipe' ? 104 : 88,
    h: type === 'signalLight' ? 78 : 62,
    text: `M${index + 1}`,
    fill: '#ffffff',
    stroke: '#16b89a',
    color: '#28323c',
    visualPrimaryColor: index % 2 ? '#16b89a' : '#168eea',
    animation,
    animationDuration: .8 + (index % 5) * .2,
    signalColorCount: 2,
    signalColors: ['#21c58e', '#ef5350'],
    dataBindings: [{
      target: bindingTarget(type),
      sourceId: 'performance-mixed-source',
      jsonPath: `$.values[${index % 128}]`,
      enabled: true
    }]
  })
})

const stageWidth = 6000
const stageHeight = Math.max(4000, 120 + Math.ceil(count / columns) * 92)
const createdAt = new Date().toISOString()
const document = {
  version: PROJECT_VERSION,
  projectId: `mixed-binding-stress-${randomUUID()}`,
  revision: 0,
  createdAt,
  updatedAt: null,
  fileName: `混合绑定压力测试-${count}`,
  nodes,
  edges: [],
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

await writeFile(output, JSON.stringify(document))
console.log(`Generated ${count} mixed bound nodes: ${output}`)
