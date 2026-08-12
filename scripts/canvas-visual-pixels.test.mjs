import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = new URL('../', import.meta.url)
const miniMapSource = await readFile(new URL('../src/components/MiniMapPreview.vue', import.meta.url), 'utf8')
const animationSource = await readFile(new URL('../src/utils/canvasVisualAnimation.js', import.meta.url), 'utf8')
const nodeVisualSource = await readFile(new URL('../src/components/NodeVisual.vue', import.meta.url), 'utf8')
const visualStyleSource = await readFile(new URL('../src/enhancements.css', import.meta.url), 'utf8')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `expected ${startMarker}`)
  assert.notEqual(end, -1, `expected ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

function executableFromPath(name) {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const directory of String(process.env.PATH || '').split(delimiter)) {
    if (!directory) continue
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

function browserExecutable() {
  const configured = [process.env.CHROME_BIN, process.env.EDGE_BIN].filter(Boolean)
  const platformCandidates = process.platform === 'win32'
    ? [
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
        join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge'
        ]
  for (const candidate of [...configured, ...platformCandidates]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge']) {
    const candidate = executableFromPath(name)
    if (candidate) return candidate
  }
  return ''
}

function visualSourcePacket() {
  const animationPacket = sourceBetween(
    animationSource,
    'export const CANVAS_VISUAL_ANIMATION_FPS',
    'function timelineKey'
  ).replaceAll('export ', '')
  const pipePacket = sourceBetween(miniMapSource, 'function drawFlowPipe', '\nfunction drawFan')
  const fanPacket = sourceBetween(miniMapSource, 'function drawFan', '\nfunction drawImageFit')
  const specialPacket = sourceBetween(miniMapSource, 'function drawSpecialNode', '\nfunction canvasNodeLayout')
  return { animationPacket, fanPacket, pipePacket, specialPacket }
}

function browserFixtureHtml() {
  const { animationPacket, fanPacket, pipePacket, specialPacket } = visualSourcePacket()
  return `<!doctype html>
<html><body><pre id="result"></pre><script>
const MAX_SIGNAL_COLORS = 8
${animationPacket}
const VISUAL_ACCENT_COLOR = '#16b89a'
const VISUAL_HEARTBEAT_COLOR = '#ef5350'
function alpha(value, fallback = 1) {
  const parsed = Number(value)
  return Math.max(0, Math.min(1, Number.isFinite(parsed) ? parsed : fallback))
}
function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function roundedRect(ctx, x, y, width, height, radius) {
  const resolvedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, resolvedRadius)
}
function fillAndStroke(ctx, node, width, height, _worldPixel, fallbackFill = '#fff') {
  ctx.fillStyle = node.fill || fallbackFill
  ctx.fillRect(0, 0, width, height)
  if (node.borderVisible === false) return
  const borderWidth = Math.max(.1, Number(node.borderWidth) || 2)
  ctx.strokeStyle = node.stroke || '#485563'
  ctx.lineWidth = borderWidth
  ctx.strokeRect(borderWidth / 2, borderWidth / 2, Math.max(.1, width - borderWidth), Math.max(.1, height - borderWidth))
}
${pipePacket}
${fanPacket}
${specialPacket}

const ZOOM = .2
const WORLD_PIXEL = 1 / ZOOM
const PADDING = 3
const COLORS = {
  fanRing: [142, 165, 170],
  pipeBorder: [60, 143, 160],
  fanPhase: [14, 131, 119],
  signalFirst: [0, 170, 0],
  signalSecond: [204, 0, 0],
  water: [[59, 185, 223], [147, 217, 237]],
  heartbeat: [239, 83, 80]
}

function snapshot(width, height, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * ZOOM) + PADDING * 2
  canvas.height = Math.ceil(height * ZOOM) + PADDING * 2
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(PADDING, PADDING)
  ctx.scale(ZOOM, ZOOM)
  draw(ctx)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  return { width: canvas.width, height: canvas.height, data: Array.from(data) }
}

function colorDistance(data, offset, target) {
  const red = data[offset] - target[0]
  const green = data[offset + 1] - target[1]
  const blue = data[offset + 2] - target[2]
  return Math.sqrt(red * red + green * green + blue * blue)
}

function colorMask(frame, targets, tolerance = 34) {
  const list = Array.isArray(targets[0]) ? targets : [targets]
  const mask = []
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    mask.push(list.some(target => colorDistance(frame.data, offset, target) <= tolerance))
  }
  return mask
}

function channelMask(frame, predicate) {
  const mask = []
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    mask.push(predicate(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2], frame.data[offset + 3]))
  }
  return mask
}

function regionMask(frame, mask, bounds) {
  return mask.map((included, index) => {
    if (!included) return false
    const x = index % frame.width
    const y = Math.floor(index / frame.width)
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
  })
}

function maskSummary(frame, mask) {
  let count = 0
  let left = frame.width
  let top = frame.height
  let right = -1
  let bottom = -1
  let sumX = 0
  let sumY = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const x = index % frame.width
    const y = Math.floor(index / frame.width)
    count += 1
    sumX += x
    sumY += y
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  return {
    count,
    left: count ? left : 0,
    top: count ? top : 0,
    right: count ? right : 0,
    bottom: count ? bottom : 0,
    width: count ? right - left + 1 : 0,
    height: count ? bottom - top + 1 : 0,
    fillRatio: count ? count / ((right - left + 1) * (bottom - top + 1)) : 0,
    centerX: count ? sumX / count : 0,
    centerY: count ? sumY / count : 0
  }
}

function quadrantCount(frame, mask) {
  const centerX = (frame.width - 1) / 2
  const centerY = (frame.height - 1) / 2
  const quadrants = new Set()
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const x = index % frame.width
    const y = Math.floor(index / frame.width)
    if (Math.abs(x - centerX) < 1 || Math.abs(y - centerY) < 1) continue
    quadrants.add((x < centerX ? 0 : 1) + (y < centerY ? 0 : 2))
  }
  return quadrants.size
}

function changedPixels(first, second, threshold = 48) {
  let changed = 0
  for (let offset = 0; offset < first.data.length; offset += 4) {
    const difference = Math.abs(first.data[offset] - second.data[offset])
      + Math.abs(first.data[offset + 1] - second.data[offset + 1])
      + Math.abs(first.data[offset + 2] - second.data[offset + 2])
      + Math.abs(first.data[offset + 3] - second.data[offset + 3])
    if (difference >= threshold) changed += 1
  }
  return changed
}

const pipeNode = {
  type: 'flowPipe', animation: 'flow', animationDuration: 1,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2
}
const fanNode = {
  type: 'rotatingFan', animation: 'flow', animationDuration: 1,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2
}
const signalNode = {
  type: 'signalLight', animation: 'blink', animationDuration: .4,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2,
  signalColorCount: 2, signalColors: ['#00aa00', '#cc0000'], signalOpacity: 1
}
const particleNode = {
  type: 'particles', animation: 'flow', animationDuration: 1,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2
}
const waterNode = {
  type: 'waterTank', animation: 'flow', animationDuration: 1,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2,
  progressValue: 37
}
const heartbeatNode = {
  type: 'heartbeat', animation: 'pulse', animationDuration: 1,
  animationDirection: 'normal', animationPaused: false, borderWidth: 2
}

const pipeFirst = snapshot(190, 48, ctx => drawFlowPipe(ctx, pipeNode, 190, 48, WORLD_PIXEL, 0))
const pipeSecond = snapshot(190, 48, ctx => drawFlowPipe(ctx, pipeNode, 190, 48, WORLD_PIXEL, 250))
const fanFirst = snapshot(110, 110, ctx => drawFan(ctx, fanNode, 110, 110, WORLD_PIXEL, 0))
const fanSecond = snapshot(110, 110, ctx => drawFan(ctx, fanNode, 110, 110, WORLD_PIXEL, 125))
const signalFirst = snapshot(90, 130, ctx => drawSpecialNode(ctx, signalNode, 90, 130, 2, undefined, 'full', WORLD_PIXEL, 0))
const signalSecond = snapshot(90, 130, ctx => drawSpecialNode(ctx, signalNode, 90, 130, 2, undefined, 'full', WORLD_PIXEL, 250))
const particleFirst = snapshot(190, 72, ctx => drawSpecialNode(ctx, particleNode, 190, 72, 2, undefined, 'full', WORLD_PIXEL, 200))
const particleSecond = snapshot(190, 72, ctx => drawSpecialNode(ctx, particleNode, 190, 72, 2, undefined, 'full', WORLD_PIXEL, 450))
const waterFirst = snapshot(90, 120, ctx => drawSpecialNode(ctx, waterNode, 90, 120, 2, undefined, 'full', WORLD_PIXEL, 0))
const waterSecond = snapshot(90, 120, ctx => drawSpecialNode(ctx, waterNode, 90, 120, 2, undefined, 'full', WORLD_PIXEL, 250))
const heartbeatFirst = snapshot(90, 90, ctx => drawSpecialNode(ctx, heartbeatNode, 90, 90, 2, undefined, 'full', WORLD_PIXEL, 0))
const heartbeatSecond = snapshot(90, 90, ctx => drawSpecialNode(ctx, heartbeatNode, 90, 90, 2, undefined, 'full', WORLD_PIXEL, 150))

const pipeAccent = maskSummary(pipeFirst, regionMask(
  pipeFirst,
  channelMask(pipeFirst, (red, green, blue) => green - red >= 55 && green >= blue),
  {
    left: pipeFirst.width * .2,
    right: pipeFirst.width * .8,
    top: (pipeFirst.height - 1) / 2 - 1,
    bottom: (pipeFirst.height - 1) / 2 + 1
  }
))
const pipeBorder = maskSummary(pipeFirst, colorMask(pipeFirst, COLORS.pipeBorder, 50))
const fanAccentMask = channelMask(fanFirst, (red, green, blue) => green - red >= 40 && green >= blue)
const fanSecondAccentMask = channelMask(fanSecond, (red, green, blue) => green - red >= 40 && green >= blue)
const fanAccent = maskSummary(fanFirst, fanAccentMask)
const fanPhase = maskSummary(fanFirst, colorMask(fanFirst, COLORS.fanPhase, 8))
const fanRing = maskSummary(fanFirst, colorMask(fanFirst, COLORS.fanRing, 32))
const signalGreen = maskSummary(signalFirst, colorMask(signalFirst, COLORS.signalFirst, 30))
const signalRed = maskSummary(signalSecond, colorMask(signalSecond, COLORS.signalSecond, 30))
const particleFirstAccent = maskSummary(particleFirst, channelMask(
  particleFirst,
  (red, green, blue) => green - red >= 70 && green - blue >= 8
))
const particleSecondAccent = maskSummary(particleSecond, channelMask(
  particleSecond,
  (red, green, blue) => green - red >= 70 && green - blue >= 8
))
const waterFirstLiquid = maskSummary(waterFirst, colorMask(waterFirst, COLORS.water, 38))
const waterSecondLiquid = maskSummary(waterSecond, colorMask(waterSecond, COLORS.water, 38))
const heartbeatFirstStroke = maskSummary(heartbeatFirst, colorMask(heartbeatFirst, COLORS.heartbeat, 100))
const heartbeatSecondStroke = maskSummary(heartbeatSecond, colorMask(heartbeatSecond, COLORS.heartbeat, 100))

const result = {
  pipe: {
    accent: pipeAccent,
    border: pipeBorder,
    changed: changedPixels(pipeFirst, pipeSecond)
  },
  fan: {
    accent: fanAccent,
    ring: fanRing,
    quadrants: quadrantCount(fanSecond, fanSecondAccentMask),
    phase: fanPhase,
    changed: changedPixels(fanFirst, fanSecond)
  },
  signal: {
    first: signalGreen,
    second: signalRed,
    changed: changedPixels(signalFirst, signalSecond)
  },
  particles: {
    first: particleFirstAccent,
    second: particleSecondAccent,
    changed: changedPixels(particleFirst, particleSecond)
  },
  water: {
    first: waterFirstLiquid,
    second: waterSecondLiquid,
    changed: changedPixels(waterFirst, waterSecond, 24)
  },
  heartbeat: {
    first: heartbeatFirstStroke,
    second: heartbeatSecondStroke,
    changed: changedPixels(heartbeatFirst, heartbeatSecond, 24)
  }
}
document.getElementById('result').textContent = btoa(JSON.stringify(result))
</script></body></html>`
}

const browser = browserExecutable()

test('Canvas and DOM animated component styles keep one visual contract', () => {
  const fanSource = sourceBetween(miniMapSource, 'function drawFan', '\nfunction drawImageFit')
  const specialSource = sourceBetween(miniMapSource, 'function drawSpecialNode', '\nfunction canvasNodeLayout')
  const signalSource = sourceBetween(specialSource, "if (node.type === 'signalLight')", "if (node.type === 'waterTank')")

  assert.doesNotMatch(miniMapSource, /VISUAL_FAN_PHASE_COLOR/)
  assert.doesNotMatch(fanSource, /index === 0|ctx\.ellipse\(rotorRadius/)
  assert.match(fanSource, /ctx\.strokeStyle = node\.visualPrimaryColor \|\| VISUAL_ACCENT_COLOR[\s\S]*?for \(let index = 0; index < 4; index \+= 1\)/)
  assert.match(visualStyleSource, /\.fan-rotor i\s*\{[^}]*background:\s*var\(--visual-primary-color, #16b89a\)/)
  assert.doesNotMatch(nodeVisualSource, /fan-direction-marker/)
  assert.doesNotMatch(visualStyleSource, /\.fan-direction-marker/)
  assert.match(specialSource, /node\.type === 'signalLight'[\s\S]*?signalLightColor\(node, animationTimestamp\)[\s\S]*?ctx\.arc\(width \/ 2, height \/ 2, signalRadius/)
  assert.match(signalSource, /fillAndStroke\(ctx, node, width, height, worldPixel, '#fff'\)/, 'signal lights share the animated component frame')
  assert.match(specialSource, /node\.type === 'waterTank'[\s\S]*?fillAndStroke\([\s\S]*?#f6fbfc[\s\S]*?#3c6f7a[\s\S]*?#3bb9df[\s\S]*?waterTankWaveColor\(node\)/)
  assert.match(specialSource, /node\.type === 'heartbeat'[\s\S]*?fillAndStroke\([\s\S]*?VISUAL_HEARTBEAT_COLOR[\s\S]*?bezierCurveTo/)
  assert.match(specialSource, /node\.type === 'particles'[\s\S]*?fillAndStroke\([\s\S]*?const positions = \[\[\.05, 0\][\s\S]*?\[\.88, 7\]\][\s\S]*?particleAnimationState\(node, index, animationTimestamp\)/)
  assert.match(animationSource, /PARTICLE_COUNT = 8/)
  assert.match(animationSource, /animationDurationMilliseconds\(node\) \* \(index % PARTICLE_COUNT\) \/ PARTICLE_COUNT/)
  assert.match(animationSource, /phase < \.2[\s\S]*?phase <= \.8/)
  assert.match(visualStyleSource, /@keyframes preview-particles\s*\{\s*from\s*\{\s*translate:\s*-22px 0;\s*opacity:\s*0;\s*\}\s*20%, 80%\s*\{\s*opacity:\s*1;\s*\}\s*to\s*\{\s*translate:\s*45px 0;\s*opacity:\s*0;\s*\}\s*\}/)
  assert.match(visualStyleSource, /\.particles-visual i\s*\{[^}]*animation-delay:\s*calc\(var\(--built-in-animation-delay, 0s\) \+ var\(--particle-delay, 0s\)\)/)
  assert.match(nodeVisualSource, /function particleAnimationDelay\(index\)[\s\S]*?duration \/ 8/)
  for (const color of ['#f6fbfc', '#3c6f7a', '#3bb9df', '#ef5350', '#16b89a']) {
    assert.match(visualStyleSource, new RegExp(color))
  }
  assert.match(visualStyleSource, /\.tank-visual i::before[^}]*color-mix\(in srgb, var\(--visual-primary-color, #3bb9df\) 55%, white\)/)
})

test('low-zoom animated visuals retain recognizable pixels and change between frames', {
  skip: browser ? false : 'Chrome, Edge, or Chromium is required for the real Canvas pixel check',
  timeout: 30_000
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tc2d-canvas-pixels-'))
  try {
    const fixturePath = join(directory, 'fixture.html')
    await writeFile(fixturePath, browserFixtureHtml(), 'utf8')
    const { stdout } = await execFileAsync(browser, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${join(directory, 'profile')}`,
      '--dump-dom',
      pathToFileURL(fixturePath).href
    ], {
      cwd: new URL('.', projectRoot),
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 20_000,
      windowsHide: true
    })
    const encoded = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1]
    assert.ok(encoded, `browser fixture did not return Canvas metrics: ${stdout.slice(0, 500)}`)
    const metrics = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))

    assert.ok(metrics.pipe.border.count >= 18, `pipe border is not recognizable: ${JSON.stringify(metrics.pipe)}`)
    assert.ok(metrics.pipe.accent.count >= 8, `pipe flow stripes are not recognizable: ${JSON.stringify(metrics.pipe)}`)
    assert.ok(metrics.pipe.accent.width >= 16 && metrics.pipe.accent.height >= 2, `pipe stripes lost their low-zoom footprint: ${JSON.stringify(metrics.pipe)}`)
    assert.ok(metrics.pipe.changed >= 8, `pipe stripes did not visibly move: ${JSON.stringify(metrics.pipe)}`)

    assert.ok(metrics.fan.ring.count >= 8, `fan ring is not recognizable: ${JSON.stringify(metrics.fan)}`)
    assert.ok(metrics.fan.accent.count >= 8, `fan rotor is not recognizable: ${JSON.stringify(metrics.fan)}`)
    assert.equal(metrics.fan.quadrants, 4, `fan rotor does not cover four directions: ${JSON.stringify(metrics.fan)}`)
    assert.equal(metrics.fan.phase.count, 0, `fan contains an inconsistent dark blade: ${JSON.stringify(metrics.fan)}`)
    assert.ok(metrics.fan.changed >= 8, `fan rotor did not visibly rotate: ${JSON.stringify(metrics.fan)}`)

    assert.ok(metrics.signal.first.count >= 20, `signal color 1 is not recognizable: ${JSON.stringify(metrics.signal)}`)
    assert.ok(metrics.signal.second.count >= 20, `signal color 2 is not recognizable: ${JSON.stringify(metrics.signal)}`)
    assert.ok(metrics.signal.first.width >= 7 && metrics.signal.first.height >= 7, `signal core is too small: ${JSON.stringify(metrics.signal)}`)
    assert.ok(metrics.signal.first.fillRatio >= .55, `signal core lost its circular filled shape: ${JSON.stringify(metrics.signal)}`)
    assert.ok(metrics.signal.changed >= 30, `signal light did not visibly change color: ${JSON.stringify(metrics.signal)}`)

    assert.ok(metrics.particles.first.count >= 4, `particle frame 1 is not recognizable: ${JSON.stringify(metrics.particles)}`)
    assert.ok(metrics.particles.second.count >= 4, `particle frame 2 is not recognizable: ${JSON.stringify(metrics.particles)}`)
    assert.ok(metrics.particles.first.width >= 10, `particles lost their distributed footprint: ${JSON.stringify(metrics.particles)}`)
    assert.ok(metrics.particles.changed >= 8, `particles did not visibly move and fade: ${JSON.stringify(metrics.particles)}`)

    assert.ok(metrics.water.first.count >= 20, `water tank liquid is not recognizable: ${JSON.stringify(metrics.water)}`)
    assert.equal(metrics.water.first.top, metrics.water.second.top, `water animation changed the configured level top: ${JSON.stringify(metrics.water)}`)
    assert.equal(metrics.water.first.bottom, metrics.water.second.bottom, `water animation changed the configured level bottom: ${JSON.stringify(metrics.water)}`)
    assert.equal(metrics.water.first.height, metrics.water.second.height, `water animation changed the configured liquid height: ${JSON.stringify(metrics.water)}`)
    assert.ok(metrics.water.changed >= 2, `water surface did not visibly move: ${JSON.stringify(metrics.water)}`)

    assert.ok(metrics.heartbeat.first.count >= 8, `heartbeat frame 1 is not recognizable: ${JSON.stringify(metrics.heartbeat)}`)
    assert.ok(metrics.heartbeat.second.count >= 8, `heartbeat frame 2 is not recognizable: ${JSON.stringify(metrics.heartbeat)}`)
    assert.ok(metrics.heartbeat.second.width >= metrics.heartbeat.first.width, `heartbeat did not expand horizontally: ${JSON.stringify(metrics.heartbeat)}`)
    assert.ok(metrics.heartbeat.second.height >= metrics.heartbeat.first.height, `heartbeat did not expand vertically: ${JSON.stringify(metrics.heartbeat)}`)
    assert.ok(metrics.heartbeat.changed >= 8, `heartbeat did not visibly pulse: ${JSON.stringify(metrics.heartbeat)}`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
