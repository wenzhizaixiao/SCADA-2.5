import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './enhancements.css'
createApp(App).mount('#app')

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('__perfProbe') === '1') {
  import('../scripts/browser-performance-probe.mjs').then(({ createBrowserPerformanceProbe }) => {
    const params = new URLSearchParams(window.location.search)
    const errors = []
    const probe = createBrowserPerformanceProbe()
    const requestedDelay = Number(params.get('__perfProbeDelay'))
    const startDelay = Number.isFinite(requestedDelay) ? Math.max(0, Math.min(30000, requestedDelay)) : 0
    const resetOnPreview = params.get('__perfProbeResetOnPreview') === '1'
    const resetOnFit = params.get('__perfProbeResetOnFit') === '1'
    const resetOnFullscreen = params.get('__perfProbeResetOnFullscreen') === '1'
    const previewScroll = String(params.get('__perfPreviewScroll') || '').split(',').map(Number)
    const recordError = event => {
      if (errors.length >= 100) errors.splice(0, 25)
      errors.push(String(event?.error?.stack || event?.reason?.stack || event?.message || event?.reason || 'Unknown error'))
    }
    const publish = () => {
      document.documentElement.dataset.tc2dPerformance = JSON.stringify({
        ...probe.snapshot(),
        errors: errors.slice(-20)
      })
    }
    const resetProbe = () => {
      probe.stop()
      probe.start()
      publish()
    }
    const timer = window.setInterval(publish, 250)
    const startTimer = window.setTimeout(() => {
      probe.start()
      publish()
    }, startDelay)
    let previewObserved = false
    let fitObserved = false
    let previewReset = false
    let fitReset = false
    let fullscreenReset = false
    const handleMeasuredCommand = event => {
      const button = event.target?.closest?.('button')
      const label = String(button?.textContent || '').trim()
      if (resetOnPreview && !previewReset && label === '预览') {
        previewReset = true
        resetProbe()
      }
      if (resetOnFit && !fitReset && label === '自适应预览') {
        fitReset = true
        resetProbe()
      }
      if (resetOnFullscreen && !fullscreenReset && label === '全屏预览') {
        fullscreenReset = true
        resetProbe()
      }
    }
    const previewObserver = resetOnPreview || resetOnFit ? new MutationObserver(() => {
      const preview = document.querySelector('[data-testid="preview-overlay"]')
      if (!previewObserved && preview) {
        previewObserved = true
        if (resetOnPreview && !previewReset) resetProbe()
        if (previewScroll.length === 2 && previewScroll.every(Number.isFinite)) {
          window.setTimeout(() => {
            document.querySelector('[data-testid="preview-canvas"]')?.scrollTo({
              left: previewScroll[0],
              top: previewScroll[1]
            })
          }, 500)
        }
      }
      if (resetOnFit && !fitObserved && document.querySelector('.preview-fit-canvas.is-visible')) {
        fitObserved = true
        if (!fitReset) resetProbe()
      }
    }) : null
    previewObserver?.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] })
    document.addEventListener('click', handleMeasuredCommand, true)
    window.addEventListener('error', recordError)
    window.addEventListener('unhandledrejection', recordError)
    window.addEventListener('beforeunload', () => {
      window.clearInterval(timer)
      window.clearTimeout(startTimer)
      previewObserver?.disconnect()
      document.removeEventListener('click', handleMeasuredCommand, true)
      probe.stop()
    }, { once: true })
    publish()
  }).catch(error => {
    document.documentElement.dataset.tc2dPerformance = JSON.stringify({
      active: false,
      errors: [String(error?.stack || error)]
    })
  })
}
