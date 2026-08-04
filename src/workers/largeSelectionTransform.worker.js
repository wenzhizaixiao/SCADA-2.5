import { computeLargeSelectionTransform } from '../utils/largeSelectionTransform.js'

self.onmessage = event => {
  const { id, items, spec } = event.data || {}
  try {
    self.postMessage({ id, result: computeLargeSelectionTransform(items, spec) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
