export class DrawingJsonFormatError extends Error {}

function normalizeDrawingJsonError(error) {
  if (error instanceof SyntaxError || error?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
    return new DrawingJsonFormatError('Drawing file is not valid UTF-8 JSON')
  }
  return error
}

export function parseDrawingJson(buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    throw normalizeDrawingJsonError(error)
  }
}

export { normalizeDrawingJsonError }
