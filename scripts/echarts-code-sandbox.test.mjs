import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'acorn'

import { createEChartsSandboxDocument } from '../src/utils/echartsCodeSandbox.js'
import { echartsCodeViewport, standardEChartsViewport } from '../src/utils/echartsCodeViewport.js'

function inlineScripts(document) {
  return [...document.matchAll(/<script(?: src="[^"]*")?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(Boolean)
}

test('builds an isolated ECharts document for complete official code', () => {
  const document = createEChartsSandboxDocument({
    source: `
      import * as echarts from 'echarts';
      const chart = echarts.init(document.getElementById('main'));
      chart.setOption({ tooltip: { formatter: value => value.name }, series: [{ type: 'gauge' }] });
      setInterval(() => chart.setOption({ series: [{ data: [{ value: Date.now() % 100 }] }] }), 1000);
    `,
    echartsUrl: '/assets/echarts.min.js',
    channelId: 'chart-1'
  })

  assert.match(document, /id="main"/)
  assert.match(document, /src="\/assets\/echarts\.min\.js"/)
  assert.doesNotMatch(document, /import\s+\*\s+as\s+echarts/)
  assert.match(document, /formatter:\s*value\s*=>/)
  assert.match(document, /setInterval/)
  assert.match(document, /tc2d-echarts-sandbox/)
  for (const script of inlineScripts(document)) {
    assert.doesNotThrow(() => parse(script, { ecmaVersion: 'latest', sourceType: 'script' }))
  }
})

test('bridges editor hover coordinates to code charts without exposing the iframe', () => {
  const document = createEChartsSandboxDocument({
    source: `
      const chart = echarts.init(document.getElementById('main'));
      chart.setOption({ tooltip: {}, series: [{ type: 'bar', data: [1, 2] }] });
    `,
    echartsUrl: '/assets/echarts.min.js',
    channelId: 'chart-hover'
  })

  assert.match(document, /tc2d-echarts-host/)
  assert.match(document, /event\.source !== parent/)
  assert.match(document, /type:\s*'showTip'/)
  assert.match(document, /type:\s*'hideTip'/)
  assert.match(document, /handler\.dispatch\('mousemove'/)
  assert.match(document, /handler\.dispatch\('mouseout'/)
  assert.match(document, /getViewportRoot\?\.\(\)\?\.style\?\.cursor/)
  assert.match(document, /send\('cursor', nextCursor\)/)
  assert.match(document, /chart\.dispatchAction\(\{ type: 'showTip', x, y \}\)/)
  assert.match(document, /chart\.dispatchAction\(\{ type: 'hideTip' \}\)/)
  assert.match(document, /registerChart/)
})

test('dispatches relayed clicks to the chart element at the requested logical coordinate', () => {
  const document = createEChartsSandboxDocument({
    source: `
      const chart = echarts.init(document.getElementById('main'));
      chart.setOption({ legend: { type: 'scroll' }, series: [{ type: 'pie', data: [{ value: 1, name: 'A' }] }] });
    `,
    echartsUrl: '/assets/echarts.min.js',
    channelId: 'chart-click'
  })

  assert.match(document, /message\.type === 'click'/)
  assert.match(document, /document\.elementFromPoint\(x, y\)/)
  assert.match(document, /new MouseEvent\('click'/)
  assert.match(document, /handler\.dispatch\('mousedown'/)
  assert.match(document, /handler\.dispatch\('mouseup'/)
  assert.match(document, /handler\.dispatch\('click'/)
  assert.match(document, /nativeControl\.dispatchEvent\(event\)/)
})

test('escapes script terminators in pasted source without dropping its contents', () => {
  const document = createEChartsSandboxDocument({
    source: `const label = '</script><script>parent.bad = true</script>';`,
    echartsUrl: '/echarts.js',
    channelId: 'chart-2'
  })

  assert.doesNotMatch(document, /<\/script><script>parent\.bad/)
  assert.match(document, /<\\\/script>/)
})

test('requires source, runtime URL and channel identity', () => {
  assert.throws(() => createEChartsSandboxDocument({ source: '', echartsUrl: '/echarts.js', channelId: 'x' }), /不能为空/)
  assert.throws(() => createEChartsSandboxDocument({ source: 'option = {};', echartsUrl: '', channelId: 'x' }), /运行库/)
  assert.throws(() => createEChartsSandboxDocument({ source: 'option = {};', echartsUrl: '/echarts.js', channelId: '' }), /通道/)
})

test('keeps a readable logical viewport for small components without changing their aspect ratio', () => {
  const compact = echartsCodeViewport(360, 240)
  assert.equal(compact.width, 450)
  assert.equal(compact.height, 300)
  assert.equal(compact.scale, 0.8)

  assert.deepEqual(echartsCodeViewport(1200, 900), {
    width: 1200,
    height: 900,
    scale: 1
  })

  const fitted = echartsCodeViewport(450, 320)
  assert.equal(fitted.width, 450)
  assert.equal(fitted.height, 320)
  assert.equal(fitted.scale, 1)

  const wideCompact = echartsCodeViewport(250, 140)
  assert.ok(Math.abs(wideCompact.width * wideCompact.scale - 250) < 1e-9)
  assert.ok(Math.abs(wideCompact.height * wideCompact.scale - 140) < 1e-9)
  assert.equal(wideCompact.height, 300)
})

test('standard charts keep their complete 320 by 220 layout when the node becomes small', () => {
  const compact = standardEChartsViewport(150, 110)
  assert.equal(compact.width, 320)
  assert.ok(Math.abs(compact.height * compact.scale - 110) < 1e-9)
  assert.ok(Math.abs(compact.width * compact.scale - 150) < 1e-9)

  assert.deepEqual(standardEChartsViewport(640, 440), {
    width: 640,
    height: 440,
    scale: 1
  })
})
