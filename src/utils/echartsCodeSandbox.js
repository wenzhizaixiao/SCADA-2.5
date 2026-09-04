import { prepareEChartsCodeForSandbox } from './echartsCodeParser.js'

const SANDBOX_MESSAGE_SOURCE = 'tc2d-echarts-sandbox'
const SANDBOX_HOST_MESSAGE_SOURCE = 'tc2d-echarts-host'

function text(value) {
  return String(value ?? '').trim()
}

function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function htmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function scriptSource(value) {
  return String(value).replace(/<\/script/gi, '<\\/script')
}

export function createEChartsSandboxDocument({
  source,
  echartsUrl,
  channelId,
  fallbackOption = null
} = {}) {
  const runtimeUrl = text(echartsUrl)
  const runtimeChannelId = text(channelId)
  if (!text(source)) throw new TypeError('ECharts 示例代码不能为空')
  if (!runtimeUrl) throw new TypeError('ECharts 运行库地址不能为空')
  if (!runtimeChannelId) throw new TypeError('ECharts 运行通道不能为空')

  const preparedSource = scriptSource(prepareEChartsCodeForSandbox(source))
  const channelLiteral = inlineJson(runtimeChannelId)
  const fallbackLiteral = inlineJson(fallbackOption && typeof fallbackOption === 'object' ? fallbackOption : null)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#main{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}</style>
</head>
<body>
<div id="main"></div>
<script>
(() => {
  const channelId = ${channelLiteral};
  const send = (type, message = '') => parent.postMessage({ source: '${SANDBOX_MESSAGE_SOURCE}', channelId, type, message }, '*');
  const messageOf = value => value instanceof Error ? value.message : String(value ?? '未知运行错误');
  const charts = [];
  const registerChart = chart => {
    if (chart && !charts.includes(chart)) charts.push(chart);
    return chart;
  };
  let lastCursor = 'default';
  const bridge = { send, messageOf, charts, registerChart };
  window.__TC2D_ECHARTS_BRIDGE__ = bridge;
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.source !== '${SANDBOX_HOST_MESSAGE_SOURCE}' || message?.channelId !== channelId) return;
    const x = Number(message.x);
    const y = Number(message.y);
    if (message.type === 'click') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 0
      });
      const nativeControl = target.closest?.('button,a,input,select,textarea,[role="button"]');
      if (nativeControl) {
        nativeControl.dispatchEvent(event);
        return;
      }
      const zrEvent = {
        type: 'click',
        event,
        target,
        zrX: x,
        zrY: y,
        offsetX: x,
        offsetY: y,
        clientX: x,
        clientY: y,
        which: 1,
        button: 0,
        buttons: 0,
        stop: () => event.stopPropagation()
      };
      let dispatched = false;
      for (const chart of charts) {
        if (!chart || chart.isDisposed()) continue;
        const handler = chart.getZr?.()?.handler;
        if (!handler?.dispatch) continue;
        handler.dispatch('mousedown', { ...zrEvent, type: 'mousedown' });
        handler.dispatch('mouseup', { ...zrEvent, type: 'mouseup' });
        handler.dispatch('click', zrEvent);
        dispatched = true;
      }
      if (!dispatched) target.dispatchEvent(event);
      return;
    }
    if (message.type !== 'pointermove' && message.type !== 'pointerleave') return;
    if (message.type === 'pointermove' && (!Number.isFinite(x) || !Number.isFinite(y))) return;
    const pointerLeaves = message.type === 'pointerleave';
    const eventX = pointerLeaves ? -1 : x;
    const eventY = pointerLeaves ? -1 : y;
    const target = pointerLeaves ? null : document.elementFromPoint(x, y);
    const eventType = pointerLeaves ? 'mouseout' : 'mousemove';
    const pointerEvent = new MouseEvent(eventType, {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: eventX,
      clientY: eventY,
      screenX: eventX,
      screenY: eventY,
      button: 0,
      buttons: 0
    });
    const zrEvent = {
      type: eventType,
      event: pointerEvent,
      target,
      zrX: eventX,
      zrY: eventY,
      offsetX: eventX,
      offsetY: eventY,
      clientX: eventX,
      clientY: eventY,
      which: 0,
      button: 0,
      buttons: 0,
      stop: () => pointerEvent.stopPropagation()
    };
    let nextCursor = 'default';
    for (const chart of charts) {
      if (!chart || chart.isDisposed()) continue;
      try {
        const handler = chart.getZr?.()?.handler;
        if (pointerLeaves) {
          if (handler?.dispatch) handler.dispatch('mouseout', zrEvent);
          chart.dispatchAction({ type: 'hideTip' });
        } else {
          // showTip 只显示提示框；mousemove 才会执行图元命中、高亮及用户悬浮回调。
          if (handler?.dispatch) handler.dispatch('mousemove', zrEvent);
          chart.dispatchAction({ type: 'showTip', x, y });
          const chartCursor = chart.getZr?.()?.painter?.getViewportRoot?.()?.style?.cursor;
          if (chartCursor === 'pointer') nextCursor = 'pointer';
        }
      } catch (error) { send('error', messageOf(error)); }
    }
    if (nextCursor !== lastCursor) {
      lastCursor = nextCursor;
      send('cursor', nextCursor);
    }
  });
  window.addEventListener('error', event => send('error', messageOf(event.error || event.message)));
  window.addEventListener('unhandledrejection', event => send('error', messageOf(event.reason)));
})();
</script>
<script src="${htmlAttribute(runtimeUrl)}"></script>
<script>
(async () => {
  const bridge = window.__TC2D_ECHARTS_BRIDGE__;
  try {
    if (!window.echarts) throw new Error('ECharts 运行库加载失败');
    const echarts = window.echarts;
    const initializeChart = echarts.init.bind(echarts);
    echarts.init = (...args) => bridge.registerChart(initializeChart(...args));
${preparedSource}
    const main = document.getElementById('main');
    const renderedChart = echarts.getInstanceByDom(main);
    bridge.registerChart(renderedChart);
    if (!bridge.charts.length) {
      const fallbackOption = ${fallbackLiteral};
      if (fallbackOption) {
        const chart = echarts.init(main);
        chart.setOption(fallbackOption, { notMerge: true });
      }
    }
    const resize = () => bridge.charts.forEach(chart => chart && !chart.isDisposed() && chart.resize({ animation: { duration: 0 } }));
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(main);
    bridge.send('ready');
  } catch (error) {
    bridge.send('error', bridge.messageOf(error));
  }
})();
</script>
</body>
</html>`
}

export { SANDBOX_HOST_MESSAGE_SOURCE, SANDBOX_MESSAGE_SOURCE }
