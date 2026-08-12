const DEFAULT_MAX_INSTANCES = 20_000
const DEFAULT_MAX_OUTPUT_PIXELS = 16_777_216
const FLOATS_PER_INSTANCE = 8

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aDestination;
layout(location = 2) in vec4 aAtlasRect;
uniform vec2 uOutputSize;
uniform vec2 uAtlasSize;
out vec2 vTextureCoordinate;
void main() {
  vec2 pixel = aDestination.xy + aCorner * aDestination.zw;
  vec2 clip = vec2(pixel.x / uOutputSize.x * 2.0 - 1.0, 1.0 - pixel.y / uOutputSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vec2 atlasPixel = vec2(
    aAtlasRect.x + aCorner.x * aAtlasRect.z,
    uAtlasSize.y - aAtlasRect.y - aCorner.y * aAtlasRect.w
  );
  vTextureCoordinate = atlasPixel / uAtlasSize;
}`

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vTextureCoordinate;
out vec4 outputColor;
void main() {
  outputColor = texture(uAtlas, vTextureCoordinate);
}`

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, parsed) : fallback
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  if (!vertexShader) return null
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (!fragmentShader) {
    gl.deleteShader(vertexShader)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return null
}

export function canvasVisualWebglInstanceData(instances) {
  if (!Array.isArray(instances) || !instances.length) return null
  const data = new Float32Array(instances.length * FLOATS_PER_INSTANCE)
  for (let index = 0; index < instances.length; index += 1) {
    const destination = instances[index]?.bitmapRect
    const atlas = instances[index]?.atlasRect
    const values = [
      destination?.x, destination?.y, destination?.w, destination?.h,
      atlas?.x, atlas?.y, atlas?.w, atlas?.h
    ].map(Number)
    if (values.some(value => !Number.isFinite(value)) || values.some((value, valueIndex) => valueIndex % 4 >= 2 && value <= 0)) {
      return null
    }
    data.set(values, index * FLOATS_PER_INSTANCE)
  }
  return data
}

function instancesFitAtlas(instances, width, height) {
  for (const instance of instances) {
    const rect = instance?.atlasRect
    const x = Number(rect?.x)
    const y = Number(rect?.y)
    const w = Number(rect?.w)
    const h = Number(rect?.h)
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(w)
      || !Number.isFinite(h)
      || x < 0
      || y < 0
      || w <= 0
      || h <= 0
      || x + w > width
      || y + h > height
    ) return false
  }
  return true
}

export function createCanvasVisualWebglRenderer(options = {}) {
  const createCanvas = options.createCanvas || (() => globalThis.document?.createElement?.('canvas') || null)
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now())
  const maximumInstances = positiveInteger(options.maxInstances, DEFAULT_MAX_INSTANCES, 100_000)
  const maximumOutputPixels = positiveInteger(options.maxOutputPixels, DEFAULT_MAX_OUTPUT_PIXELS, 268_435_456)
  let canvas = null
  let gl = null
  let program = null
  let vertexArray = null
  let cornerBuffer = null
  let instanceBuffer = null
  let atlasTexture = null
  let outputSizeLocation = null
  let atlasSizeLocation = null
  let atlasSamplerLocation = null
  let atlasWidth = 0
  let atlasHeight = 0
  let contextLost = false
  let disposed = false
  let drawCount = 0
  let pendingDraw = false
  let lastUploadMs = 0
  let lastDrawMs = 0
  let lastValidationMs = 0

  function releaseGlResources() {
    if (gl && !gl.isContextLost?.()) {
      try { if (atlasTexture) gl.deleteTexture(atlasTexture) } catch {}
      try { if (instanceBuffer) gl.deleteBuffer(instanceBuffer) } catch {}
      try { if (cornerBuffer) gl.deleteBuffer(cornerBuffer) } catch {}
      try { if (vertexArray) gl.deleteVertexArray(vertexArray) } catch {}
      try { if (program) gl.deleteProgram(program) } catch {}
    }
    program = null
    vertexArray = null
    cornerBuffer = null
    instanceBuffer = null
    atlasTexture = null
    outputSizeLocation = null
    atlasSizeLocation = null
    atlasSamplerLocation = null
    atlasWidth = 0
    atlasHeight = 0
    pendingDraw = false
  }

  function handleContextLost(event) {
    event?.preventDefault?.()
    contextLost = true
    releaseGlResources()
  }

  function handleContextRestored() {
    contextLost = false
    releaseGlResources()
  }

  function ensureCanvas() {
    if (canvas || disposed) return canvas
    canvas = createCanvas()
    if (!canvas) return null
    canvas.addEventListener?.('webglcontextlost', handleContextLost)
    canvas.addEventListener?.('webglcontextrestored', handleContextRestored)
    return canvas
  }

  function initialize() {
    if (disposed || contextLost) return false
    const target = ensureCanvas()
    if (!target) return false
    if (!gl) {
      gl = target.getContext?.('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      }) || null
    }
    if (!gl || gl.isContextLost?.()) return false
    if (program) return true
    program = createProgram(gl)
    vertexArray = gl.createVertexArray()
    cornerBuffer = gl.createBuffer()
    instanceBuffer = gl.createBuffer()
    atlasTexture = gl.createTexture()
    if (!program || !vertexArray || !cornerBuffer || !instanceBuffer || !atlasTexture) {
      releaseGlResources()
      return false
    }

    outputSizeLocation = gl.getUniformLocation(program, 'uOutputSize')
    atlasSizeLocation = gl.getUniformLocation(program, 'uAtlasSize')
    atlasSamplerLocation = gl.getUniformLocation(program, 'uAtlas')
    if (outputSizeLocation == null || atlasSizeLocation == null || atlasSamplerLocation == null) {
      releaseGlResources()
      return false
    }

    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    const stride = FLOATS_PER_INSTANCE * Float32Array.BYTES_PER_ELEMENT
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)

    gl.bindTexture(gl.TEXTURE_2D, atlasTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null && gl.NONE != null) {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    }
    return true
  }

  function render({
    width,
    height,
    atlas,
    atlasWidth: requestedAtlasWidth,
    atlasHeight: requestedAtlasHeight,
    instances,
    instanceData: preparedInstanceData
  } = {}) {
    lastUploadMs = 0
    lastDrawMs = 0
    lastValidationMs = 0
    const outputWidth = positiveInteger(width, 0)
    const outputHeight = positiveInteger(height, 0)
    const nextAtlasWidth = positiveInteger(requestedAtlasWidth, 0)
    const nextAtlasHeight = positiveInteger(requestedAtlasHeight, 0)
    if (
      disposed
      || pendingDraw
      || !atlas
      || !outputWidth
      || !outputHeight
      || outputWidth * outputHeight > maximumOutputPixels
      || !nextAtlasWidth
      || !nextAtlasHeight
      || positiveInteger(atlas.width, 0) !== nextAtlasWidth
      || positiveInteger(atlas.height, 0) !== nextAtlasHeight
      || !Array.isArray(instances)
      || !instances.length
      || instances.length > maximumInstances
      || !instancesFitAtlas(instances, nextAtlasWidth, nextAtlasHeight)
    ) return null
    const instanceData = preparedInstanceData instanceof Float32Array
      && preparedInstanceData.length === instances.length * FLOATS_PER_INSTANCE
      ? preparedInstanceData
      : canvasVisualWebglInstanceData(instances)
    if (!instanceData || !initialize()) return null
    const maximumTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0
    const maximumRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0
    const maximumViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS)
    if (
      nextAtlasWidth > maximumTextureSize
      || nextAtlasHeight > maximumTextureSize
      || outputWidth > maximumRenderbufferSize
      || outputHeight > maximumRenderbufferSize
      || outputWidth > Number(maximumViewport?.[0])
      || outputHeight > Number(maximumViewport?.[1])
    ) return null

    try {
      if (canvas.width !== outputWidth) {
        canvas.width = outputWidth
      }
      if (canvas.height !== outputHeight) {
        canvas.height = outputHeight
      }
      if (gl.drawingBufferWidth !== outputWidth || gl.drawingBufferHeight !== outputHeight) {
        releaseGlResources()
        return null
      }
      gl.viewport(0, 0, outputWidth, outputHeight)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.STENCIL_TEST)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.DITHER)
      gl.disable(gl.SCISSOR_TEST)
      gl.enable(gl.BLEND)
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD)
      gl.blendFuncSeparate(
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      )
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(program)
      gl.uniform2f(outputSizeLocation, outputWidth, outputHeight)
      gl.uniform2f(atlasSizeLocation, nextAtlasWidth, nextAtlasHeight)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, atlasTexture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null && gl.NONE != null) {
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      }
      const uploadStartedAt = now()
      if (atlasWidth === nextAtlasWidth && atlasHeight === nextAtlasHeight) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
        atlasWidth = nextAtlasWidth
        atlasHeight = nextAtlasHeight
      }
      lastUploadMs = Math.max(0, now() - uploadStartedAt)
      gl.uniform1i(atlasSamplerLocation, 0)
      const drawStartedAt = now()
      gl.bindVertexArray(vertexArray)
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.length)
      gl.bindVertexArray(null)
      gl.flush()
      lastDrawMs = Math.max(0, now() - drawStartedAt)
      if (gl.isContextLost?.()) {
        releaseGlResources()
        return null
      }
      pendingDraw = true
      return canvas
    } catch {
      releaseGlResources()
      return null
    }
  }

  function validateLastDraw() {
    lastValidationMs = 0
    if (disposed || !pendingDraw || !gl) return false
    const startedAt = now()
    try {
      if (gl.isContextLost?.()) {
        contextLost = true
        releaseGlResources()
        return false
      }
      if (gl.getError() !== gl.NO_ERROR) {
        releaseGlResources()
        return false
      }
      pendingDraw = false
      drawCount += 1
      return true
    } catch {
      releaseGlResources()
      return false
    } finally {
      lastValidationMs = Math.max(0, now() - startedAt)
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    releaseGlResources()
    canvas?.removeEventListener?.('webglcontextlost', handleContextLost)
    canvas?.removeEventListener?.('webglcontextrestored', handleContextRestored)
    if (canvas) {
      try {
        canvas.width = 0
        canvas.height = 0
      } catch {}
    }
    canvas = null
    gl = null
  }

  function state() {
    return Object.freeze({
      available: Boolean(gl && program && !contextLost && !disposed),
      contextLost,
      disposed,
      drawCount,
      pendingDraw,
      atlasWidth,
      atlasHeight,
      lastUploadMs,
      lastDrawMs,
      lastValidationMs
    })
  }

  return Object.freeze({ render, validateLastDraw, dispose, state })
}
