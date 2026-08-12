import { pathToFileURL } from 'node:url'

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.find(entry => entry.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = values.slice().sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

function summarize(sample) {
  const groups = new Map()
  for (const frame of sample.frames) {
    const group = groups.get(frame.testId) || []
    group.push(frame)
    groups.set(frame.testId, group)
  }
  const frames = [...groups.values()].sort((left, right) => right.length - left.length)[0] || []
  const timestamps = frames.map(frame => frame.timestamp)
  const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index])
  const duration = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0
  const numeric = key => frames
    .map(frame => Number(frame.dataset[key]))
    .filter(Number.isFinite)
  const average = values => values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0
  return {
    canvas: frames[0]?.testId || '',
    committedFrames: frames.length,
    fps: duration > 0 ? (timestamps.length - 1) * 1000 / duration : 0,
    medianFrameIntervalMs: percentile(intervals, .5),
    p95FrameIntervalMs: percentile(intervals, .95),
    atlasFrames: frames.filter(frame => frame.dataset.visualAtlasUsed === 'true').length,
    atlasBackends: [...new Set(frames.map(frame => frame.dataset.visualAtlasBackend).filter(Boolean))],
    atlasFallbacks: Math.max(0, ...numeric('visualAtlasFallbacks')),
    atlasFailureReasons: [...new Set(frames.map(frame => frame.dataset.visualAtlasFailureReason).filter(Boolean))],
    instances: Math.max(0, ...numeric('visualAtlasInstances')),
    sprites: Math.max(0, ...numeric('visualAtlasSprites')),
    atlasPixels: Math.max(0, ...numeric('visualAtlasPixels')),
    atlasRawPixels: Math.max(0, ...numeric('visualAtlasRawPixels')),
    atlasWidth: Math.max(0, ...numeric('visualAtlasWidth')),
    atlasHeight: Math.max(0, ...numeric('visualAtlasHeight')),
    outputPixels: Math.max(0, ...numeric('visualAtlasOutputPixels')),
    averagePrepareMs: average(numeric('visualAtlasPrepareMs')),
    averageRasterMs: average(numeric('visualAtlasRasterMs')),
    averageUploadMs: average(numeric('visualAtlasUploadMs')),
    averageDrawMs: average(numeric('visualAtlasDrawMs')),
    averageValidationMs: average(numeric('visualAtlasValidationMs')),
    averageGlTo2dMs: average(numeric('visualAtlasCompositeMs')),
    descriptorCacheHits: Math.max(0, ...numeric('visualDescriptorCacheHits')),
    descriptorCacheMisses: Math.max(0, ...numeric('visualDescriptorCacheMisses')),
    descriptorCacheBypasses: Math.max(0, ...numeric('visualDescriptorCacheBypasses')),
    animationSignatureCacheHits: Math.max(0, ...numeric('visualAnimationSignatureCacheHits')),
    animationSignatureCacheMisses: Math.max(0, ...numeric('visualAnimationSignatureCacheMisses')),
    atlasFrameCacheHits: frames.filter(frame => frame.dataset.visualAtlasFrameCacheHit === 'true').length,
    atlasSlotCacheHits: Math.max(0, ...numeric('visualAtlasSlotCacheHits')),
    atlasSlotCacheMisses: Math.max(0, ...numeric('visualAtlasSlotCacheMisses')),
    longTaskCount: sample.longTasks.length,
    maxLongTaskMs: sample.longTasks.length ? Math.max(...sample.longTasks) : 0,
    p95LongTaskMs: percentile(sample.longTasks, .95)
  }
}

function summarizeCpuProfile(profile) {
  if (!profile?.nodes?.length || !profile?.samples?.length) return []
  const frames = new Map(profile.nodes.map(node => [node.id, node.callFrame]))
  const totals = new Map()
  for (let index = 0; index < profile.samples.length; index += 1) {
    const frame = frames.get(profile.samples[index])
    if (!frame) continue
    const durationMs = Math.max(0, Number(profile.timeDeltas?.[index]) || 0) / 1000
    const key = `${frame.url || ''}:${frame.lineNumber + 1}:${frame.functionName || '(anonymous)'}`
    totals.set(key, (totals.get(key) || 0) + durationMs)
  }
  return [...totals]
    .map(([frame, selfMs]) => ({ frame, selfMs }))
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 20)
}

const moduleSpecifier = process.env.PLAYWRIGHT_MODULE
if (!moduleSpecifier) throw new Error('PLAYWRIGHT_MODULE is required')
const playwrightUrl = moduleSpecifier.startsWith('file:')
  ? moduleSpecifier
  : pathToFileURL(moduleSpecifier).href
const playwrightModule = await import(playwrightUrl)
const chromium = playwrightModule.chromium || playwrightModule.default?.chromium
if (!chromium) throw new Error('PLAYWRIGHT_MODULE does not expose chromium')
const headed = argument('headed', 'false') === 'true'
const browser = await chromium.launch({
  headless: !headed,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ]
})

const url = argument('url', 'http://127.0.0.1:5174/')
const drawingName = argument('drawing', '\u6d4b\u8bd5\u7ec4\u4ef6')
const durationMs = Math.max(1000, Number(argument('duration', '10000')) || 10000)
const warmupMs = Math.max(0, Number(argument('warmup', '1000')) || 0)
const mode = argument('mode', 'both')
const profileCpu = argument('profile', 'false') === 'true'

async function run(label, disableWebgl) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  })
  if (disableWebgl) {
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...options) {
        if (type === 'webgl2') return null
        return getContext.call(this, type, ...options)
      }
    })
  }
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.bringToFront()
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '\u6253\u5f00', exact: true }).click()
  await page.locator('button.drawing-file-open').filter({ hasText: drawingName }).click()
  await page.getByText('\u6253\u5f00\u56fe\u7eb8', { exact: true }).waitFor({ state: 'hidden', timeout: 120000 })
  await page.getByRole('button', { name: '\u9884\u89c8', exact: true }).click()
  const selector = '[data-testid="preview-edge-canvas"].is-visible[data-render-ready="true"]'
  await page.locator(selector).waitFor({ state: 'visible', timeout: 120000 })
  await page.waitForTimeout(warmupMs)
  if (profileCpu) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
  }
  const sample = await page.evaluate(({ durationMs }) => new Promise(resolve => {
    const frames = []
    const longTasks = []
    const generations = new Map()
    let animationFrameCount = 0
    let animationFrameHandle = 0
    const countAnimationFrame = () => {
      animationFrameCount += 1
      animationFrameHandle = requestAnimationFrame(countAnimationFrame)
    }
    animationFrameHandle = requestAnimationFrame(countAnimationFrame)
    let longTaskObserver = null
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
      longTaskObserver.observe({ entryTypes: ['longtask'] })
    }
    const capture = () => {
      for (const target of document.querySelectorAll('canvas[data-render-generation]')) {
        const testId = target.dataset.testid || target.getAttribute('data-testid') || ''
        const next = target.dataset.renderGeneration || ''
        if (!next || generations.get(testId) === next) continue
        generations.set(testId, next)
        frames.push({ testId, timestamp: performance.now(), dataset: { ...target.dataset } })
      }
    }
    capture()
    const interval = setInterval(capture, 10)
    setTimeout(() => {
      clearInterval(interval)
      cancelAnimationFrame(animationFrameHandle)
      longTaskObserver?.disconnect()
      capture()
      resolve({
        frames,
        longTasks,
        animationFrameCount,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        visibilityState: document.visibilityState,
        canvasStates: [...document.querySelectorAll('canvas[data-render-generation]')].map(target => ({
          testId: target.getAttribute('data-testid'),
          className: target.className,
          dataset: { ...target.dataset },
          rect: target.getBoundingClientRect().toJSON()
        }))
      })
    }, durationMs)
  }), { durationMs })
  const cpuProfile = profileCpu ? await cdp.send('Profiler.stop') : null
  const result = {
    label,
    ...summarize(sample),
    ...sample,
    frames: undefined,
    consoleErrors,
    cpuHotspots: summarizeCpuProfile(cpuProfile?.profile)
  }
  await context.close()
  return result
}

try {
  const accelerated = mode === 'fallback' ? null : await run('webgl-atlas', false)
  const fallback = mode === 'webgl' ? null : await run('2d-fallback', true)
  console.log(JSON.stringify({ accelerated, fallback }, null, 2))
} finally {
  await browser.close()
}
