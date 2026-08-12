import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasVisualWebglInstanceData,
  createCanvasVisualWebglRenderer
} from '../src/utils/canvasVisualWebglRenderer.js'

function createFakeWebgl() {
  const calls = []
  let nextId = 0
  let contextLost = false
  const errors = []
  const object = type => ({ type, id: ++nextId })
  const gl = {
    ARRAY_BUFFER: 1,
    STATIC_DRAW: 2,
    DYNAMIC_DRAW: 3,
    FLOAT: 4,
    VERTEX_SHADER: 5,
    FRAGMENT_SHADER: 6,
    COMPILE_STATUS: 7,
    LINK_STATUS: 8,
    TEXTURE_2D: 9,
    TEXTURE_MIN_FILTER: 10,
    TEXTURE_MAG_FILTER: 11,
    TEXTURE_WRAP_S: 12,
    TEXTURE_WRAP_T: 13,
    NEAREST: 14,
    CLAMP_TO_EDGE: 15,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 16,
    UNPACK_FLIP_Y_WEBGL: 17,
    MAX_TEXTURE_SIZE: 18,
    MAX_VIEWPORT_DIMS: 19,
    MAX_RENDERBUFFER_SIZE: 34,
    DEPTH_TEST: 20,
    STENCIL_TEST: 21,
    CULL_FACE: 22,
    DITHER: 23,
    SCISSOR_TEST: 24,
    BLEND: 25,
    FUNC_ADD: 26,
    ONE: 27,
    ONE_MINUS_SRC_ALPHA: 28,
    COLOR_BUFFER_BIT: 29,
    TEXTURE0: 30,
    RGBA: 31,
    UNSIGNED_BYTE: 32,
    TRIANGLE_STRIP: 33,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 35,
    NONE: 36,
    NO_ERROR: 0,
    createShader: () => object('shader'),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    deleteShader() {},
    createProgram: () => object('program'),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    deleteProgram() {},
    createVertexArray: () => object('vao'),
    createBuffer: () => object('buffer'),
    createTexture: () => object('texture'),
    deleteTexture() {},
    deleteBuffer() {},
    deleteVertexArray() {},
    getUniformLocation: (_program, name) => ({ name }),
    bindVertexArray(value) { calls.push(['bindVertexArray', value?.type || null]) },
    bindBuffer() {},
    bufferData(_target, data, usage) {
      calls.push(['bufferData', Array.from(data), usage])
    },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor() {},
    bindTexture() {},
    texParameteri() {},
    pixelStorei(name, value) { calls.push(['pixelStorei', name, value]) },
    getError() {
      calls.push(['getError'])
      return errors.length ? errors.shift() : 0
    },
    isContextLost: () => contextLost,
    getParameter(name) {
      if (name === this.MAX_TEXTURE_SIZE) return 4096
      if (name === this.MAX_VIEWPORT_DIMS) return new Int32Array([4096, 4096])
      if (name === this.MAX_RENDERBUFFER_SIZE) return 4096
      return 0
    },
    viewport() {},
    disable(name) { calls.push(['disable', name]) },
    enable(name) { calls.push(['enable', name]) },
    blendEquationSeparate(color, alpha) { calls.push(['blendEquationSeparate', color, alpha]) },
    blendFuncSeparate(sourceColor, destinationColor, sourceAlpha, destinationAlpha) {
      calls.push(['blendFuncSeparate', sourceColor, destinationColor, sourceAlpha, destinationAlpha])
    },
    clearColor() {},
    clear() {},
    useProgram() {},
    uniform2f() {},
    activeTexture() {},
    texImage2D(...args) { calls.push(['texImage2D', args.at(-1)]) },
    texSubImage2D(...args) { calls.push(['texSubImage2D', args.at(-1)]) },
    uniform1i() {},
    drawArraysInstanced(mode, first, count, instances) {
      calls.push(['drawArraysInstanced', mode, first, count, instances])
    },
    flush() {},
    setErrors(...values) { errors.push(...values) },
    setContextLost(value) { contextLost = value },
    calls
  }
  return gl
}

function createFakeCanvas(gl) {
  const listeners = new Map()
  const canvas = {
    width: 0,
    height: 0,
    getContext: type => type === 'webgl2' ? gl : null,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
    dispatch(type) { listeners.get(type)?.({ preventDefault() {} }) }
  }
  if (gl) {
    Object.defineProperties(gl, {
      drawingBufferWidth: { get: () => canvas.width },
      drawingBufferHeight: { get: () => canvas.height }
    })
  }
  return canvas
}

test('encodes destination and atlas rectangles without changing instance order', () => {
  const data = canvasVisualWebglInstanceData([
    { bitmapRect: { x: 20, y: 3, w: 4, h: 5 }, atlasRect: { x: 1, y: 2, w: 4, h: 5 } },
    { bitmapRect: { x: 2, y: 30, w: 6, h: 7 }, atlasRect: { x: 8, y: 9, w: 6, h: 7 } }
  ])
  assert.deepEqual(Array.from(data), [20, 3, 4, 5, 1, 2, 4, 5, 2, 30, 6, 7, 8, 9, 6, 7])
  assert.equal(canvasVisualWebglInstanceData([{ bitmapRect: {}, atlasRect: {} }]), null)
})

test('uploads one complete premultiplied atlas and submits one ordered instanced draw', () => {
  const gl = createFakeWebgl()
  const canvas = createFakeCanvas(gl)
  const renderer = createCanvasVisualWebglRenderer({ createCanvas: () => canvas })
  const atlas = { id: 'atlas', width: 64, height: 64 }
  const instances = [
    { bitmapRect: { x: 10, y: 20, w: 30, h: 40 }, atlasRect: { x: 0, y: 0, w: 30, h: 40 } },
    { bitmapRect: { x: 50, y: 60, w: 12, h: 14 }, atlasRect: { x: 32, y: 0, w: 12, h: 14 } }
  ]
  assert.equal(renderer.render({ width: 200, height: 100, atlas, atlasWidth: 64, atlasHeight: 64, instances }), canvas)
  assert.deepEqual(gl.calls.filter(call => call[0] === 'drawArraysInstanced'), [
    ['drawArraysInstanced', gl.TRIANGLE_STRIP, 0, 4, 2]
  ])
  assert.deepEqual(gl.calls.filter(call => call[0] === 'texImage2D'), [['texImage2D', atlas]])
  assert.ok(gl.calls.some(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && call[2] === true))
  assert.ok(gl.calls.some(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_FLIP_Y_WEBGL && call[2] === true))
  assert.ok(gl.calls.some(call => call[0] === 'blendFuncSeparate'
    && call[1] === gl.ONE
    && call[2] === gl.ONE_MINUS_SRC_ALPHA
    && call[3] === gl.ONE
    && call[4] === gl.ONE_MINUS_SRC_ALPHA))
  assert.ok(gl.calls.some(call => call[0] === 'disable' && call[1] === gl.DITHER))
  assert.equal(gl.calls.filter(call => call[0] === 'getError').length, 0, 'render must not synchronously validate before its surface is copied')
  assert.equal(renderer.state().pendingDraw, true)
  assert.equal(renderer.validateLastDraw(), true)

  assert.equal(renderer.render({ width: 200, height: 100, atlas, atlasWidth: 64, atlasHeight: 64, instances }), canvas)
  assert.equal(renderer.validateLastDraw(), true)
  assert.equal(gl.calls.filter(call => call[0] === 'texSubImage2D').length, 1)
  assert.equal(gl.calls.filter(call => call[0] === 'getError').length, 2, 'every submitted frame must be validated exactly once')
  assert.equal(renderer.state().drawCount, 2)
  assert.equal(renderer.validateLastDraw(), false, 'a frame cannot be validated twice')
})

test('a WebGL command error on a stable frame fails closed before the output can be committed', () => {
  const gl = createFakeWebgl()
  const canvas = createFakeCanvas(gl)
  const renderer = createCanvasVisualWebglRenderer({ createCanvas: () => canvas })
  const payload = {
    width: 100,
    height: 80,
    atlas: { width: 32, height: 32 },
    atlasWidth: 32,
    atlasHeight: 32,
    instances: [{ bitmapRect: { x: 0, y: 0, w: 10, h: 10 }, atlasRect: { x: 0, y: 0, w: 10, h: 10 } }]
  }

  assert.equal(renderer.render(payload), canvas)
  assert.equal(renderer.validateLastDraw(), true)
  assert.equal(renderer.render(payload), canvas)
  gl.setErrors(1285)
  assert.equal(renderer.validateLastDraw(), false)
  assert.equal(renderer.state().drawCount, 1, 'the failed draw must not be counted as a committed WebGL frame')
  assert.equal(gl.calls.filter(call => call[0] === 'getError').length, 2)

  assert.equal(renderer.render(payload), canvas, 'the renderer can rebuild resources after a failed validation')
  assert.equal(renderer.validateLastDraw(), true)
  assert.equal(renderer.state().drawCount, 2)
  assert.equal(gl.calls.filter(call => call[0] === 'getError').length, 3)
})

test('accepts precomputed immutable instance data without rebuilding it per frame', () => {
  const gl = createFakeWebgl()
  const canvas = createFakeCanvas(gl)
  const renderer = createCanvasVisualWebglRenderer({ createCanvas: () => canvas })
  const atlas = { width: 32, height: 32 }
  const instances = [
    { bitmapRect: { x: 2, y: 3, w: 8, h: 9 }, atlasRect: { x: 4, y: 5, w: 8, h: 9 } }
  ]
  const instanceData = canvasVisualWebglInstanceData(instances)
  assert.equal(renderer.render({
    width: 40,
    height: 30,
    atlas,
    atlasWidth: 32,
    atlasHeight: 32,
    instances,
    instanceData
  }), canvas)
  assert.equal(renderer.validateLastDraw(), true)
  assert.deepEqual(
    gl.calls.filter(call => call[0] === 'bufferData').at(-1),
    ['bufferData', Array.from(instanceData), gl.DYNAMIC_DRAW]
  )
})

test('fails closed for missing WebGL, capacity overflow, and context loss', () => {
  const noWebgl = createCanvasVisualWebglRenderer({ createCanvas: () => createFakeCanvas(null) })
  const payload = {
    width: 100,
    height: 100,
    atlas: { width: 32, height: 32 },
    atlasWidth: 32,
    atlasHeight: 32,
    instances: [{ bitmapRect: { x: 0, y: 0, w: 10, h: 10 }, atlasRect: { x: 0, y: 0, w: 10, h: 10 } }]
  }
  assert.equal(noWebgl.render(payload), null)

  const gl = createFakeWebgl()
  const canvas = createFakeCanvas(gl)
  const bounded = createCanvasVisualWebglRenderer({ createCanvas: () => canvas, maxInstances: 1, maxOutputPixels: 100 })
  assert.equal(bounded.render({ ...payload, width: 11, height: 10 }), null)
  assert.equal(bounded.render({ ...payload, instances: [...payload.instances, ...payload.instances] }), null)
  assert.equal(gl.calls.some(call => call[0] === 'drawArraysInstanced'), false)

  const renderer = createCanvasVisualWebglRenderer({ createCanvas: () => canvas })
  assert.equal(renderer.render(payload), canvas)
  assert.equal(renderer.validateLastDraw(), true)
  gl.setContextLost(true)
  canvas.dispatch('webglcontextlost')
  assert.equal(renderer.render(payload), null)
  assert.equal(renderer.state().contextLost, true)
  renderer.dispose()
  assert.equal(renderer.render(payload), null)
})
