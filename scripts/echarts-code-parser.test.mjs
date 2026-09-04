import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  EChartsCodeParseError,
  extractEChartsOption,
  parseEChartsCode,
  prepareEChartsCodeForSandbox,
  tryParseEChartsCode
} from '../src/utils/echartsCodeParser.js'

test('prepares complete official code for isolated execution without removing dynamic behavior', () => {
  const source = `
    import * as echarts from 'echarts';
    const chartDom = document.getElementById('main');
    const myChart = echarts.init(chartDom);
    const option = {
      tooltip: { formatter: value => String(value[0].value) },
      series: [{ type: 'gauge', data: [{ value: 50, name: 'SCORE' }] }]
    };
    myChart.setOption(option);
    setInterval(() => myChart.setOption({ series: [{ data: [{ value: Math.random() * 100 }] }] }), 1000);
  `

  const prepared = prepareEChartsCodeForSandbox(source)
  assert.doesNotMatch(prepared, /import\s+\*\s+as\s+echarts/)
  assert.match(prepared, /formatter:\s*value\s*=>/)
  assert.match(prepared, /setInterval/)
  assert.match(prepared, /type:\s*'gauge'/)
})

test('sandbox preparation rejects actual syntax errors with source location', () => {
  assert.throws(
    () => prepareEChartsCodeForSandbox('const option = { series: [};'),
    error => error instanceof EChartsCodeParseError
      && error.code === 'SYNTAX_ERROR'
      && error.line > 0
  )
})

test('extracts var option assignment from a complete official-style wrapper', () => {
  const source = `
    import * as echarts from 'echarts';
    var chartDom = document.getElementById('main');
    var myChart = echarts.init(chartDom);
    var option;

    option = {
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [10, 20] }],
    };

    option && myChart.setOption(option);
  `
  assert.deepEqual(parseEChartsCode(source), {
    xAxis: { type: 'category', data: ['A', 'B'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [10, 20] }]
  })
})

test('supports static declarations, references, spreads, member reads and inline setOption', () => {
  const option = parseEChartsCode(`
    const labels = ['甲', '乙'];
    const base = { color: '#168eea' };
    const values = [2, 3 * 4];
    chart.setOption({
      ...base,
      xAxis: { data: [...labels] },
      series: [{ type: 'line', name: labels[0], data: [...values, -5] }]
    });
  `)
  assert.deepEqual(option, {
    color: '#168eea',
    xAxis: { data: ['甲', '乙'] },
    series: [{ type: 'line', name: '甲', data: [2, 12, -5] }]
  })
})

test('uses the final static option assignment when setOption is omitted', () => {
  assert.deepEqual(extractEChartsOption(`
    let option;
    option = { series: [{ type: 'pie', data: [{ value: 1, name: \`A\` }] }] };
  `), {
    series: [{ type: 'pie', data: [{ value: 1, name: 'A' }] }]
  })
})

test('ignores unrelated executable wrapper declarations instead of executing them', () => {
  const option = parseEChartsCode(`
    const element = document.querySelector('#main');
    const chart = echarts.init(element);
    const unused = loadRemoteData();
    const option = { series: [{ type: 'scatter', data: [[1, 2]] }] };
    window.addEventListener('resize', chart.resize);
    chart.setOption(option);
  `)
  assert.equal(option.series[0].type, 'scatter')

  const withResizeCallback = parseEChartsCode(`
    const chart = echarts.init(document.querySelector('#main'));
    const option = { series: [{ type: 'line', data: [1, 2] }] };
    window.addEventListener('resize', function () { chart.resize(); });
    chart.setOption(option);
  `)
  assert.equal(withResizeCallback.series[0].type, 'line')
})

test('rejects functions, calls and constructors that participate in option data', () => {
  for (const source of [
    `const option = { tooltip: { formatter(value) { return value; } } }; chart.setOption(option);`,
    `const option = { series: [{ data: makeData() }] }; chart.setOption(option);`,
    `const option = { series: [{ data: new Array(10) }] }; chart.setOption(option);`
  ]) {
    assert.throws(
      () => parseEChartsCode(source),
      error => error instanceof EChartsCodeParseError
        && ['FUNCTION_VALUE', 'UNSUPPORTED_OBJECT_MEMBER', 'DYNAMIC_EXPRESSION'].includes(error.code)
    )
  }
})

test('rejects prototype-polluting keys and ambiguous repeated setOption calls', () => {
  assert.throws(
    () => parseEChartsCode(`const option = { __proto__: { polluted: true } }; chart.setOption(option);`),
    error => error instanceof EChartsCodeParseError && error.code === 'UNSAFE_PROPERTY'
  )
  assert.throws(
    () => parseEChartsCode(`
      const first = { series: [{ type: 'bar', data: [1] }] };
      const second = { series: [{ type: 'bar', data: [2] }] };
      chart.setOption(first);
      chart.setOption(second);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'MULTIPLE_SET_OPTION'
  )
})

test('enforces source, structure and output budgets with stable error codes', () => {
  assert.throws(
    () => parseEChartsCode('const option = { value: 1 };', { maxSourceLength: 10 }),
    error => error.code === 'SOURCE_LENGTH_LIMIT'
  )
  assert.throws(
    () => parseEChartsCode('const option = { values: [1, 2, 3] };', { maxArrayItems: 2 }),
    error => error.code === 'ARRAY_ITEM_LIMIT'
  )
  assert.throws(
    () => parseEChartsCode(`const option = { text: '${'x'.repeat(40)}' };`, { maxOutputLength: 20 }),
    error => error.code === 'OUTPUT_LENGTH_LIMIT'
  )
})

test('rejects exponentially expanded shared references before materializing the output', () => {
  const arrayLevels = ["const level0 = ['0123456789'];"]
  const objectLevels = ['const object0 = { value: 1 };']
  for (let index = 1; index <= 12; index += 1) {
    arrayLevels.push(`const level${index} = [level${index - 1}, level${index - 1}];`)
    objectLevels.push(`const object${index} = { left: object${index - 1}, right: object${index - 1} };`)
  }

  assert.throws(
    () => parseEChartsCode(`${arrayLevels.join('\n')}\nconst option = { series: level12 };`, {
      maxArrayItems: 64,
      maxObjectProperties: 100,
      maxOutputLength: 1_000_000
    }),
    error => error instanceof EChartsCodeParseError && error.code === 'ARRAY_ITEM_LIMIT'
  )
  assert.throws(
    () => parseEChartsCode(`${objectLevels.join('\n')}\nconst option = { series: object12 };`, {
      maxArrayItems: 100,
      maxObjectProperties: 64,
      maxOutputLength: 1_000_000
    }),
    error => error instanceof EChartsCodeParseError && error.code === 'OBJECT_PROPERTY_LIMIT'
  )

  // Keep the source static: shared references amplify a small literal beyond the output budget.
  const stringLevels = [`const text0 = ['${'x'.repeat(200)}'];`]
  for (let index = 1; index <= 8; index += 1) {
    stringLevels.push(`const text${index} = [text${index - 1}, text${index - 1}];`)
  }
  assert.throws(
    () => parseEChartsCode(`${stringLevels.join('\n')}\nconst option = { series: text8 };`, {
      maxArrayItems: 2_000,
      maxObjectProperties: 100,
      maxOutputLength: 10_000
    }),
    error => error instanceof EChartsCodeParseError && error.code === 'OUTPUT_LENGTH_LIMIT'
  )
})

test('returns a UI-friendly non-throwing result with source location', () => {
  const result = tryParseEChartsCode(`
    const option = {
      tooltip: { formatter: value => value }
    };
    chart.setOption(option);
  `)
  assert.equal(result.ok, false)
  assert.equal(result.option, null)
  assert.ok(result.error instanceof EChartsCodeParseError)
  assert.equal(result.error.code, 'FUNCTION_VALUE')
  assert.ok(result.error.line > 0)
  assert.match(result.error.message, /第 \d+ 行/)
})

test('rejects arrays or objects that are dynamically mutated before setOption', () => {
  assert.throws(
    () => parseEChartsCode(`
      const data = [];
      for (let index = 0; index < 3; index += 1) data.push(index);
      const option = { series: [{ type: 'bar', data }] };
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )

  assert.throws(
    () => parseEChartsCode(`
      const option = { series: [{ type: 'line', data: [1] }] };
      option.series[0].data.push(2);
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )
})

test('rejects tainted values nested inside option and closures that may mutate static data', () => {
  assert.throws(
    () => parseEChartsCode(`
      const data = [1];
      const option = { series: [{ type: 'line', data }] };
      data.push(2);
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )

  assert.throws(
    () => parseEChartsCode(`
      const data = [1];
      const option = { series: [{ type: 'line', data }] };
      function mutate() { data.push(2); }
      mutate();
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )

  assert.throws(
    () => parseEChartsCode(`
      const data = [1];
      const option = { series: [{ type: 'line', data }] };
      unknownMutation(data);
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )

  assert.throws(
    () => parseEChartsCode(`
      const data = [1];
      const holder = { data };
      const option = { series: [{ type: 'line', data }] };
      unknownMutation(holder);
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )

  assert.throws(
    () => parseEChartsCode(`
      const data = [1];
      const option = { series: [{ type: 'line', data }] };
      let mutate;
      mutate = () => data.push(2);
      mutate();
      chart.setOption(option);
    `),
    error => error instanceof EChartsCodeParseError && error.code === 'DYNAMIC_MUTATION'
  )
})

test('implementation contains no dynamic JavaScript execution primitive', async () => {
  const source = await readFile(new URL('../src/utils/echartsCodeParser.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\beval\s*\(/)
  assert.doesNotMatch(source, /\bnew\s+Function\b/)
  assert.doesNotMatch(source, /\bFunction\s*\(/)
})
