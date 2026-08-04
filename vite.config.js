import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, renameSync } from 'node:fs'
import { copyFile, link, lstat, open, readFile, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createDrawingMetadataCache, drawingStatSignature } from './src/services/drawingMetadataCache.js'
import { DrawingJsonFormatError, parseDrawingJson } from './src/services/drawingJsonParser.js'
import {
  DrawingRequestError,
  readBoundedRequestBody,
  resolveDrawingRequestLimit,
  validateDrawingRequestHeaders
} from './src/services/drawingRequestBody.js'
import { verifyDrawingSave } from './src/services/drawingSaveVerification.js'
import { drawingComparisonKey } from './src/utils/drawingName.js'
import { ProjectValidationError, validateProjectForFrontend } from './src/utils/projectValidation.js'

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))
const configuredDirectory = String(process.env.TC2D_DRAWINGS_DIR || '').trim()
const DRAWINGS_DIRECTORY = resolve(PROJECT_ROOT, configuredDirectory || '图纸库')
const LEGACY_DRAWINGS_DIRECTORY = resolve(PROJECT_ROOT, '图纸')
const DRAWINGS_ROUTE = '/api/drawings'
const TIME_ROUTE = '/api/time'
const saveQueues = new Map()
const DRAWING_NAMES_CASE_SENSITIVE = process.platform !== 'win32'
const drawingNameKey = name => drawingComparisonKey(name, DRAWING_NAMES_CASE_SENSITIVE)

function pathStat(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

if (!configuredDirectory && !pathStat(DRAWINGS_DIRECTORY)) {
  const legacyStat = pathStat(LEGACY_DRAWINGS_DIRECTORY)
  if (legacyStat?.isDirectory() && !legacyStat.isSymbolicLink()) renameSync(LEGACY_DRAWINGS_DIRECTORY, DRAWINGS_DIRECTORY)
}

mkdirSync(DRAWINGS_DIRECTORY, { recursive: true })
const drawingsDirectoryStat = pathStat(DRAWINGS_DIRECTORY)
if (!drawingsDirectoryStat?.isDirectory() || drawingsDirectoryStat.isSymbolicLink()) {
  throw new Error('图纸库路径必须是普通目录，不能使用符号链接')
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const drawingMetadataCache = createDrawingMetadataCache({
  keyForName: drawingNameKey,
  shouldCacheError: error => error instanceof HttpError && error.status === 422
})

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  res.end(body)
}

function validateFileName(rawName) {
  if (typeof rawName !== 'string' || !rawName) throw new HttpError(400, '图纸文件名不能为空')
  const name = rawName.normalize('NFC')
  if (name !== rawName || name !== name.trim()) throw new HttpError(400, '图纸文件名格式无效')
  if (name.length > 120 || Buffer.byteLength(name, 'utf8') > 240) throw new HttpError(400, '图纸文件名过长')
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(name) || /[ .]$/u.test(name)) throw new HttpError(400, '图纸文件名包含非法字符')
  if (!/\.json$/iu.test(name)) throw new HttpError(400, '图纸文件必须使用 .json 扩展名')

  const stem = name.slice(0, -5)
  if (!stem || stem === '.' || stem === '..') throw new HttpError(400, '图纸文件名格式无效')
  const deviceStem = stem.split('.')[0].replace(/[ .]+$/u, '')
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(deviceStem)) {
    throw new HttpError(400, '图纸文件名不能使用 Windows 保留名')
  }
  return name
}

function drawingPath(name) {
  const target = resolve(DRAWINGS_DIRECTORY, name)
  const relativePath = relative(DRAWINGS_DIRECTORY, target)
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new HttpError(400, '图纸文件路径无效')
  }
  return target
}

function parseDrawing(buffer) {
  let data
  try {
    data = parseDrawingJson(buffer)
  } catch (error) {
    if (!(error instanceof DrawingJsonFormatError)) throw error
    throw new HttpError(422, '图纸文件不是有效的 JSON')
  }
  try {
    validateProjectForFrontend(data)
  } catch (error) {
    if (error instanceof ProjectValidationError) throw new HttpError(422, error.message)
    throw error
  }
  return data
}

function createEtag(buffer) {
  return `"${createHash('sha256').update(buffer).digest('hex')}"`
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').some(value => {
    const candidate = value.trim()
    return candidate === '*' || candidate === etag
  })
}

async function fileStatForRead(target, missingIsError) {
  try {
    return await lstat(target, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT' && !missingIsError) return null
    if (error?.code === 'ENOENT') throw new HttpError(404, '图纸文件不存在')
    throw error
  }
}

async function readExistingFile(target, missingIsError = true, knownStat = null, maxBytes = null) {
  const fileStat = knownStat || await fileStatForRead(target, missingIsError)
  if (!fileStat) return null
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new HttpError(missingIsError ? 404 : 409, '目标不是普通图纸文件')
  if (maxBytes != null && fileStat.size > BigInt(maxBytes)) {
    throw new HttpError(413, `图纸文件超过 ${maxBytes} 字节上限`)
  }
  const buffer = await readFile(target)
  const verifiedStat = await fileStatForRead(target, missingIsError)
  if (!verifiedStat || drawingStatSignature(fileStat) !== drawingStatSignature(verifiedStat)) {
    throw new HttpError(409, '图纸文件读取期间发生变化，请重试')
  }
  return { buffer, fileStat: verifiedStat, etag: createEtag(buffer) }
}

function drawingMetadata(name, current) {
  return {
    name,
    size: current.buffer.length,
    modifiedAt: current.fileStat.mtime.toISOString(),
    etag: current.etag
  }
}

async function listDrawings(maxBytes) {
  const entries = await readdir(DRAWINGS_DIRECTORY, { withFileTypes: true })
  const files = []
  const retainedNames = new Set()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    let name
    try {
      name = validateFileName(entry.name)
      const target = drawingPath(name)
      const fileStat = await fileStatForRead(target, true)
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue
      if (fileStat.size > BigInt(maxBytes)) {
        drawingMetadataCache.invalidate(name)
        continue
      }
      retainedNames.add(name)
      const metadata = await drawingMetadataCache.getOrLoad(name, fileStat, async () => {
        const current = await readExistingFile(target, true, fileStat, maxBytes)
        parseDrawing(current.buffer)
        return drawingMetadata(name, current)
      })
      files.push(metadata)
    } catch {
      // Ignore files that are invalid, inaccessible, or changed during listing.
    }
  }
  drawingMetadataCache.retain(retainedNames)
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name, 'zh-CN'))
  return files
}

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase().split('%', 1)[0]
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function withSaveQueue(name, task) {
  const key = drawingNameKey(name)
  const previous = saveQueues.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  saveQueues.set(key, current)
  return current.finally(() => {
    if (saveQueues.get(key) === current) saveQueues.delete(key)
  })
}

async function atomicWrite(target, buffer) {
  const temporaryPath = resolve(DRAWINGS_DIRECTORY, `.tc2d-${process.pid}-${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(buffer)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, target)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

function enforceWriteConditions(req, current, name) {
  const ifMatch = req.headers['if-match']
  const ifNoneMatch = req.headers['if-none-match']
  if (ifMatch != null && ifNoneMatch != null) throw new HttpError(400, 'If-Match 与 If-None-Match 不能同时使用')
  if (ifMatch == null && ifNoneMatch == null) throw new HttpError(428, '保存图纸必须提供条件请求头')
  if (String(ifMatch || '').split(',').some(value => value.trim() === '*')) throw new HttpError(400, 'If-Match 不允许使用通配符')
  if (current) {
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim() === '*') {
      throw new HttpError(412, `图纸库中已存在“${name}”，同一位置不能保存两个同名图纸。请修改当前图纸名称，或先删除图纸库中的同名文件后再保存。`)
    }
    if (typeof ifMatch !== 'string' || ifMatch.trim() !== current.etag) {
      throw new HttpError(412, `图纸库中的“${name}”已被其他操作修改。为避免覆盖新内容，请重新打开该图纸后再保存。`)
    }
    return
  }
  if (ifMatch != null) throw new HttpError(412, '图纸不存在，无法按已有版本保存')
  if (typeof ifNoneMatch !== 'string' || ifNoneMatch.trim() !== '*') throw new HttpError(412, '新图纸必须使用 If-None-Match: *')
}

async function saveDrawing(req, name, target, buffer, maxBytes) {
  return withSaveQueue(name, async () => {
    const current = await readExistingFile(target, false, null, maxBytes)
    enforceWriteConditions(req, current, name)
    await atomicWrite(target, buffer)
    const result = await verifyDrawingSave({
      name,
      expectedEtag: createEtag(buffer),
      loadCurrent: () => readExistingFile(target, true, null, maxBytes),
      metadataCache: drawingMetadataCache
    })
    if (!result) throw new HttpError(409, '图纸保存后被外部程序修改，请重新打开后再保存')
    return result
  })
}

function enforceDeleteCondition(req, current) {
  const ifMatch = req.headers['if-match']
  if (typeof ifMatch !== 'string' || !ifMatch.trim()) throw new HttpError(428, '删除图纸必须提供版本条件')
  if (ifMatch.split(',').some(value => value.trim() === '*')) throw new HttpError(400, 'If-Match 不允许使用通配符')
  if (!etagMatches(ifMatch, current.etag)) throw new HttpError(412, '图纸已被修改，请刷新列表后再删除')
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false
  const value = item => typeof item === 'bigint' ? item.toString() : String(item ?? '')
  return value(left.dev) === value(right.dev)
    && value(left.ino) === value(right.ino)
    && value(left.mode) === value(right.mode)
    && value(left.size) === value(right.size)
    && value(left.mtimeNs ?? left.mtimeMs) === value(right.mtimeNs ?? right.mtimeMs)
}

function deleteQuarantinePath() {
  return resolve(DRAWINGS_DIRECTORY, `.tc2d-delete-${process.pid}-${randomUUID()}.tmp`)
}

function deleteRecoveryName(name) {
  const stem = String(name || '图纸.json').replace(/\.json$/iu, '').slice(0, 48) || '图纸'
  return `${stem} (删除冲突恢复-${Date.now()}-${randomUUID().slice(0, 8)}).json`
}

async function restoreQuarantinedDrawing(quarantine, target, name) {
  try {
    await link(quarantine, target)
    await rm(quarantine, { force: true }).catch(() => {})
    return null
  } catch (error) {
    if (error?.code !== 'EEXIST' && !['EPERM', 'EACCES', 'ENOSYS', 'EOPNOTSUPP', 'EXDEV'].includes(error?.code)) throw error
  }

  try {
    await copyFile(quarantine, target, constants.COPYFILE_EXCL)
    await rm(quarantine, { force: true }).catch(() => {})
    return null
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }

  const recoveryName = deleteRecoveryName(name)
  await rename(quarantine, drawingPath(recoveryName))
  return recoveryName
}

async function deleteDrawing(req, name, target, maxBytes) {
  return withSaveQueue(name, async () => {
    const fileStat = await fileStatForRead(target, true)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new HttpError(404, '图纸文件不存在')
    if (fileStat.size > BigInt(maxBytes)) throw new HttpError(413, `图纸文件超过 ${maxBytes} 字节上限`)
    const metadata = await drawingMetadataCache.getOrLoad(name, fileStat, async () => {
      const loaded = await readExistingFile(target, true, fileStat, maxBytes)
      parseDrawing(loaded.buffer)
      return drawingMetadata(name, loaded)
    })
    const current = { fileStat, etag: metadata.etag }
    enforceDeleteCondition(req, current)
    const quarantine = deleteQuarantinePath()
    try {
      await rename(target, quarantine)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        drawingMetadataCache.invalidate(name)
        throw new HttpError(404, '图纸文件不存在')
      }
      throw error
    }

    try {
      const isolatedStat = await fileStatForRead(quarantine, true)
      if (!isolatedStat.isFile() || isolatedStat.isSymbolicLink() || !sameFileIdentity(current.fileStat, isolatedStat)) {
        throw new HttpError(409, '图纸在删除确认期间发生变化，请刷新列表后重试')
      }
      await unlink(quarantine)
    } catch (error) {
      let recoveryName = null
      try {
        recoveryName = await restoreQuarantinedDrawing(quarantine, target, name)
      } catch {
        drawingMetadataCache.invalidate(name)
        throw new HttpError(500, '图纸删除未完成，原文件已保留在图纸库临时恢复文件中')
      }
      drawingMetadataCache.invalidate(name)
      if (recoveryName) {
        drawingMetadataCache.invalidate(recoveryName)
        throw new HttpError(409, `图纸删除期间目标位置被占用，原文件已保留为“${recoveryName}”`)
      }
      throw error
    }
    drawingMetadataCache.invalidate(name)
    return { name }
  })
}

async function handleDrawingApi(req, res, next, maxRequestBytes) {
  let requestUrl
  try {
    requestUrl = new URL(req.url || '/', 'http://localhost')
  } catch {
    throw new HttpError(400, '请求路径无效')
  }
  const pathname = requestUrl.pathname
  if (pathname === TIME_ROUTE) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      throw new HttpError(405, '请求方法不允许')
    }
    const now = Date.now()
    sendJson(res, 200, { now, iso: new Date(now).toISOString() })
    return
  }
  if (pathname !== DRAWINGS_ROUTE && pathname !== `${DRAWINGS_ROUTE}/` && !pathname.startsWith(`${DRAWINGS_ROUTE}/`)) {
    next()
    return
  }
  if (!isLoopbackRequest(req)) throw new HttpError(403, '仅允许在本机访问图纸库')

  if (pathname === DRAWINGS_ROUTE || pathname === `${DRAWINGS_ROUTE}/`) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      throw new HttpError(405, '请求方法不允许')
    }
    sendJson(res, 200, {
      directory: DRAWINGS_DIRECTORY,
      caseSensitiveNames: DRAWING_NAMES_CASE_SENSITIVE,
      files: await listDrawings(maxRequestBytes)
    })
    return
  }

  const encodedName = pathname.slice(DRAWINGS_ROUTE.length + 1)
  if (!encodedName || encodedName.includes('/')) throw new HttpError(400, '图纸文件名格式无效')
  let decodedName
  try {
    decodedName = decodeURIComponent(encodedName)
  } catch {
    throw new HttpError(400, '图纸文件名编码无效')
  }
  const name = validateFileName(decodedName)
  const target = drawingPath(name)

  if (req.method === 'HEAD') {
    const fileStat = await fileStatForRead(target, true)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new HttpError(404, '图纸文件不存在')
    res.writeHead(204, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end()
    return
  }

  if (req.method === 'GET') {
    const current = await readExistingFile(target, true, null, maxRequestBytes)
    parseDrawing(current.buffer)
    drawingMetadataCache.set(name, current.fileStat, drawingMetadata(name, current))
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': current.buffer.length,
      'ETag': current.etag,
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(current.buffer)
    return
  }

  if (req.method === 'PUT') {
    const declaredBytes = validateDrawingRequestHeaders(req, maxRequestBytes)
    const buffer = await readBoundedRequestBody(req, maxRequestBytes, declaredBytes)
    parseDrawing(buffer)
    const result = await saveDrawing(req, name, target, buffer, maxRequestBytes)
    sendJson(res, 200, result, { ETag: result.etag })
    return
  }

  if (req.method === 'DELETE') {
    const result = await deleteDrawing(req, name, target, maxRequestBytes)
    sendJson(res, 200, result)
    return
  }

  res.setHeader('Allow', 'GET, HEAD, PUT, DELETE')
  throw new HttpError(405, '请求方法不允许')
}

function assertProjectBuildOutputPath(outputDirectory) {
  const relativePath = relative(PROJECT_ROOT, outputDirectory)
  if (
    !relativePath
    || isAbsolute(relativePath)
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
  ) throw new Error('构建输出目录必须位于项目根目录内，且不能等于项目根目录')
}

function resolveBuildOutputDirectory(config) {
  const configuredOutDir = String(config?.build?.outDir || '').trim()
  if (!configuredOutDir) throw new Error('Vite 未提供有效的构建输出目录')
  const outputDirectory = resolve(config.root || PROJECT_ROOT, configuredOutDir)
  assertProjectBuildOutputPath(outputDirectory)
  return outputDirectory
}

async function nearestExistingRealPath(target) {
  let candidate = target
  while (true) {
    try {
      return { path: await realpath(candidate), exact: candidate === target }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

async function cleanBuildOutputDirectory(outputDirectory) {
  const [realProjectRoot, existingTarget] = await Promise.all([
    realpath(PROJECT_ROOT),
    nearestExistingRealPath(outputDirectory)
  ])
  const relativeRealPath = relative(realProjectRoot, existingTarget.path)
  if (
    (existingTarget.exact && !relativeRealPath)
    || isAbsolute(relativeRealPath)
    || relativeRealPath === '..'
    || relativeRealPath.startsWith(`..${sep}`)
  ) throw new Error('构建输出目录的真实路径必须位于项目根目录内，且不能等于项目根目录')

  await rm(outputDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  })
}

function cleanBuildOutputPlugin() {
  let outputDirectory = null
  let cleanupPromise = null
  return {
    name: 'tc2d-clean-build-output',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      outputDirectory = resolveBuildOutputDirectory(config)
    },
    async buildStart() {
      if (!outputDirectory) throw new Error('构建输出目录尚未解析')
      if (!cleanupPromise) cleanupPromise = cleanBuildOutputDirectory(outputDirectory)
      await cleanupPromise
    }
  }
}

function drawingFilesPlugin() {
  const install = server => {
    mkdirSync(DRAWINGS_DIRECTORY, { recursive: true })
    const maxRequestBytes = resolveDrawingRequestLimit()
    server.middlewares.use((req, res, next) => {
      handleDrawingApi(req, res, next, maxRequestBytes).catch(error => {
        if (res.headersSent) {
          res.end()
          return
        }
        const expected = error instanceof HttpError || error instanceof DrawingRequestError
        const status = expected ? error.status : 500
        const message = expected ? error.message : '图纸文件服务异常'
        if (status === 413) req.resume()
        sendJson(res, status, { error: message }, status === 413 ? { Connection: 'close' } : {})
      })
    })
  }
  return {
    name: 'tc2d-drawing-files',
    configureServer: install,
    configurePreviewServer: install
  }
}

export default defineConfig({
  plugins: [vue(), cleanBuildOutputPlugin(), drawingFilesPlugin()],
  build: {
    emptyOutDir: true
  }
})
