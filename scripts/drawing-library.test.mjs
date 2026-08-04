import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'vite'
import { MAX_POLYLINE_NODE_POINTS } from '../src/utils/polylineGeometry.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const configFile = fileURLToPath(new URL('../vite.config.js', import.meta.url))

function drawingJson(overrides = {}) {
  return JSON.stringify({ nodes: [], edges: [], drawings: [], ...overrides })
}

function etag(content) {
  return `"${createHash('sha256').update(content).digest('hex')}"`
}

function rawRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

async function startServer() {
  const server = await createServer({
    configFile,
    root: projectRoot,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false }
  })
  await server.listen()
  const address = server.httpServer?.address()
  assert.equal(typeof address, 'object')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function expectFile(path) {
  await access(path)
}

async function expectMissingFile(path) {
  await assert.rejects(access(path), error => error?.code === 'ENOENT')
}

test('enforces conditional saves and deletes in the project drawing library', async () => {
  const drawingsDirectory = await mkdtemp(join(tmpdir(), 'tc2d-drawings-'))
  const drawingName = '待删除图纸.json'
  const drawingPath = join(drawingsDirectory, drawingName)
  const conflictName = '同名图纸.json'
  const conflictPath = join(drawingsDirectory, conflictName)
  const newName = '新图纸.json'
  const newPath = join(drawingsDirectory, newName)
  const invalidName = '非图纸.json'
  const invalidPath = join(drawingsDirectory, invalidName)
  const largeName = '大于20MB图纸.json'
  const validContent = drawingJson()
  const existingContent = drawingJson({ revision: 1 })
  const replacementContent = drawingJson({ revision: 2 })
  const newContent = drawingJson({ revision: 1, fileName: '新图纸' })
  const invalidContent = JSON.stringify({ arbitrary: true })
  await writeFile(drawingPath, validContent)
  await writeFile(conflictPath, existingContent)
  await writeFile(invalidPath, invalidContent)

  const originalDirectory = process.env.TC2D_DRAWINGS_DIR
  const originalRequestLimit = process.env.TC2D_MAX_DRAWING_BYTES
  process.env.TC2D_DRAWINGS_DIR = drawingsDirectory
  delete process.env.TC2D_MAX_DRAWING_BYTES
  let server
  try {
    let started = await startServer()
    server = started.server
    let baseUrl = started.baseUrl
    const drawingUrl = `${baseUrl}/api/drawings/${encodeURIComponent(drawingName)}`

    const listResponse = await fetch(`${baseUrl}/api/drawings`)
    assert.equal(listResponse.status, 200)
    const listing = await listResponse.json()
    assert.equal(listing.caseSensitiveNames, process.platform !== 'win32')
    const entry = listing.files.find(file => file.name === drawingName)
    assert.ok(entry)
    assert.equal(entry.etag, etag(validContent))
    assert.equal(listing.files.some(file => file.name === invalidName), false)

    const conflictUrl = `${baseUrl}/api/drawings/${encodeURIComponent(conflictName)}`
    const sameNameResponse = await fetch(conflictUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: replacementContent
    })
    assert.equal(sameNameResponse.status, 412)
    assert.deepEqual(await sameNameResponse.json(), {
      error: `图纸库中已存在“${conflictName}”，同一位置不能保存两个同名图纸。请修改当前图纸名称，或先删除图纸库中的同名文件后再保存。`
    })
    assert.equal(await readFile(conflictPath, 'utf8'), existingContent)

    const staleSaveResponse = await fetch(conflictUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"stale"' },
      body: replacementContent
    })
    assert.equal(staleSaveResponse.status, 412)
    assert.deepEqual(await staleSaveResponse.json(), {
      error: `图纸库中的“${conflictName}”已被其他操作修改。为避免覆盖新内容，请重新打开该图纸后再保存。`
    })
    assert.equal(await readFile(conflictPath, 'utf8'), existingContent)

    const updatedResponse = await fetch(conflictUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag(existingContent) },
      body: replacementContent
    })
    assert.equal(updatedResponse.status, 200)
    assert.equal(updatedResponse.headers.get('etag'), etag(replacementContent))
    assert.equal(await readFile(conflictPath, 'utf8'), replacementContent)

    const newDrawingResponse = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent(newName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: newContent
    })
    assert.equal(newDrawingResponse.status, 200)
    assert.equal(newDrawingResponse.headers.get('etag'), etag(newContent))
    assert.equal(await readFile(newPath, 'utf8'), newContent)

    const excessivePolylinePoints = Array.from({ length: MAX_POLYLINE_NODE_POINTS + 1 }, () => ({ x: 0, y: 0 }))
    const rejectedProjects = [
      ['重复ID.json', drawingJson({ nodes: [{ id: 'same' }, { id: 'same' }] })],
      ['悬空连线.json', drawingJson({ nodes: [{ id: 'node-a' }], edges: [{ id: 'edge-a', from: 'node-a', to: 'missing' }] })],
      ['线段节点超限.json', drawingJson({
        nodes: [{ id: 'polyline-large', type: 'polyline', polylinePoints: excessivePolylinePoints }]
      })],
      ['模板线段节点超限.json', drawingJson({
        customComponents: [{
          id: 'custom-polyline-large',
          nodes: [{ id: 'template-polyline-large', type: 'polyline', x: 0, y: 0, w: 10, h: 10, polylinePoints: excessivePolylinePoints }],
          edges: []
        }]
      })],
      ['模板几何无效.json', drawingJson({
        customComponents: [{ id: 'custom-invalid', nodes: [{ id: 'node-invalid', x: 0, y: 0, w: 0, h: 10 }], edges: [] }]
      })],
      ['自定义组件超限.json', drawingJson({
        customComponents: Array.from({ length: 201 }, (_, index) => ({
          id: `custom-${index}`,
          nodes: [{ id: `node-${index}`, x: 0, y: 0, w: 10, h: 10 }],
          edges: []
        }))
      })]
    ]
    for (const [name, content] of rejectedProjects) {
      const response = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
        body: content
      })
      assert.equal(response.status, 422, name)
      await expectMissingFile(join(drawingsDirectory, name))
    }

    const legacyName = '旧线稿兼容.json'
    const legacyContent = drawingJson({
      nodes: [{ id: 'anchor' }],
      edges: [{ id: 'legacy-edge', from: 'anchor', to: 'pencil-legacy' }],
      drawings: [{ id: 'legacy', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }]
    })
    const legacyResponse = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent(legacyName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: legacyContent
    })
    assert.equal(legacyResponse.status, 200)

    const largeContent = drawingJson({ note: 'x'.repeat(36 * 1024 * 1024) })
    const largeUrl = `${baseUrl}/api/drawings/${encodeURIComponent(largeName)}`
    const largeSaveResponse = await fetch(largeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: largeContent
    })
    assert.equal(largeSaveResponse.status, 200)
    assert.equal(largeSaveResponse.headers.get('etag'), etag(largeContent))
    const largeListResponse = await fetch(`${baseUrl}/api/drawings`)
    const largeListing = await largeListResponse.json()
    assert.ok(largeListing.files.some(file => file.name === largeName && file.size === Buffer.byteLength(largeContent)))
    const largeOpenResponse = await fetch(largeUrl)
    assert.equal(largeOpenResponse.status, 200)
    assert.equal((await largeOpenResponse.arrayBuffer()).byteLength, Buffer.byteLength(largeContent))
    const repeatedLargeListing = await (await fetch(`${baseUrl}/api/drawings`)).json()
    assert.equal(repeatedLargeListing.files.find(file => file.name === largeName)?.etag, etag(largeContent))
    const externallyChangedLargeContent = drawingJson({ revision: 9, note: 'external replacement' })
    await writeFile(join(drawingsDirectory, largeName), externallyChangedLargeContent)
    const externallyChangedListing = await (await fetch(`${baseUrl}/api/drawings`)).json()
    const externallyChangedEntry = externallyChangedListing.files.find(file => file.name === largeName)
    assert.equal(externallyChangedEntry?.etag, etag(externallyChangedLargeContent))
    assert.equal(externallyChangedEntry?.size, Buffer.byteLength(externallyChangedLargeContent))

    const missingCondition = await fetch(drawingUrl, { method: 'DELETE' })
    assert.equal(missingCondition.status, 428)
    await expectFile(drawingPath)

    const wildcardCondition = await fetch(drawingUrl, { method: 'DELETE', headers: { 'If-Match': '*' } })
    assert.equal(wildcardCondition.status, 400)
    await expectFile(drawingPath)

    const staleCondition = await fetch(drawingUrl, { method: 'DELETE', headers: { 'If-Match': '"stale"' } })
    assert.equal(staleCondition.status, 412)
    await expectFile(drawingPath)

    const escapedPath = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent('../outside.json')}`, {
      method: 'DELETE',
      headers: { 'If-Match': entry.etag }
    })
    assert.equal(escapedPath.status, 400)

    const unsupportedMethod = await fetch(drawingUrl, { method: 'POST' })
    assert.equal(unsupportedMethod.status, 405)
    assert.equal(unsupportedMethod.headers.get('allow'), 'GET, HEAD, PUT, DELETE')

    const invalidDrawing = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent(invalidName)}`, {
      method: 'DELETE',
      headers: { 'If-Match': etag(invalidContent) }
    })
    assert.equal(invalidDrawing.status, 422)
    await expectFile(invalidPath)

    const invalidDrawingProbe = await fetch(`${baseUrl}/api/drawings/${encodeURIComponent(invalidName)}`, { method: 'HEAD' })
    assert.equal(invalidDrawingProbe.status, 204)

    const deleted = await fetch(drawingUrl, { method: 'DELETE', headers: { 'If-Match': entry.etag } })
    assert.equal(deleted.status, 200)
    assert.deepEqual(await deleted.json(), { name: drawingName })
    await expectMissingFile(drawingPath)

    const missingFile = await fetch(drawingUrl, { method: 'DELETE', headers: { 'If-Match': entry.etag } })
    assert.equal(missingFile.status, 404)
    const missingFileProbe = await fetch(drawingUrl, { method: 'HEAD' })
    assert.equal(missingFileProbe.status, 404)

    await server.close()
    server = null
    process.env.TC2D_MAX_DRAWING_BYTES = '1024'
    started = await startServer()
    server = started.server
    baseUrl = started.baseUrl

    const oversizedDiskName = '磁盘超限图纸.json'
    await writeFile(join(drawingsDirectory, oversizedDiskName), drawingJson({ note: 'x'.repeat(1024) }))
    const oversizedDiskUrl = `${baseUrl}/api/drawings/${encodeURIComponent(oversizedDiskName)}`
    const boundedDiskListing = await (await fetch(`${baseUrl}/api/drawings`)).json()
    assert.equal(boundedDiskListing.files.some(file => file.name === oversizedDiskName), false)
    const oversizedDiskOpen = await fetch(oversizedDiskUrl)
    assert.equal(oversizedDiskOpen.status, 413)
    const oversizedDiskProbe = await fetch(oversizedDiskUrl, { method: 'HEAD' })
    assert.equal(oversizedDiskProbe.status, 204)

    const declaredTooLargeName = '声明超限.json'
    const declaredTooLarge = await rawRequest(`${baseUrl}/api/drawings/${encodeURIComponent(declaredTooLargeName)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1025',
        'If-None-Match': '*'
      }
    })
    assert.equal(declaredTooLarge.status, 413)
    await expectMissingFile(join(drawingsDirectory, declaredTooLargeName))

    const chunkedTooLargeName = '流式超限.json'
    const chunkedTooLarge = await rawRequest(`${baseUrl}/api/drawings/${encodeURIComponent(chunkedTooLargeName)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
        'If-None-Match': '*'
      },
      body: Buffer.alloc(1025, 0x20)
    })
    assert.equal(chunkedTooLarge.status, 413)
    await expectMissingFile(join(drawingsDirectory, chunkedTooLargeName))

    const compressedName = '压缩请求.json'
    const compressed = await rawRequest(`${baseUrl}/api/drawings/${encodeURIComponent(compressedName)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'If-None-Match': '*'
      },
      body: drawingJson()
    })
    assert.equal(compressed.status, 415)
    await expectMissingFile(join(drawingsDirectory, compressedName))
  } finally {
    await server?.close()
    if (originalDirectory === undefined) delete process.env.TC2D_DRAWINGS_DIR
    else process.env.TC2D_DRAWINGS_DIR = originalDirectory
    if (originalRequestLimit === undefined) delete process.env.TC2D_MAX_DRAWING_BYTES
    else process.env.TC2D_MAX_DRAWING_BYTES = originalRequestLimit
    await rm(drawingsDirectory, { recursive: true, force: true })
  }
})
