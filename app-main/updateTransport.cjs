const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { lstat } = require('node:fs/promises')
const { basename } = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { CancellationError } = require('builder-util-runtime')

const githubOrigins = ['https://api.github.com', 'https://github.com',
  'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']
const giteeOrigins = ['https://gitee.com', 'https://foruda.gitee.com']
const maxMetadataBytes = 1024 * 1024

function createElectronUpdateFetch(net) {
  return (url, { signal, headers }) => new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const request = net.request({ url: url.href, redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    let incoming
    const abort = () => {
      incoming?.destroy(signal.reason)
      request.abort()
      reject(signal.reason)
    }
    const detach = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    request.on('error', error => { detach(); reject(error) })
    request.on('redirect', (status, _method, location) => {
      detach()
      request.abort()
      resolve(new Response(null, { status, headers: { location } }))
    })
    request.on('response', response => {
      incoming = response
      response.once('close', detach)
      response.once('end', detach)
      response.once('error', detach)
      resolve({ status: response.statusCode, headers: new Headers(response.headers), body: Readable.toWeb(response) })
    })
    for (const [name, value] of Object.entries(headers || {})) request.setHeader(name, value)
    request.end()
  })
}

async function requestUpdate(url, { origins, signal, fetchImpl, headers }) {
  let target = new URL(url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!origins.includes(target.origin) || target.username || target.password) {
      throw new Error('更新服务返回了不受信任的下载地址。')
    }
    const response = await fetchImpl(target, { signal, headers, redirect: 'manual', credentials: 'omit' })
    if (response.status === 200) return response
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      throw new Error(`更新服务暂不可用（${response.status}），请稍后重试。`)
    }
    target = new URL(location, target)
  }
  throw new Error('更新服务重定向次数过多。')
}

async function readMetadata(response) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body || []) {
    size += chunk.byteLength
    if (size > maxMetadataBytes) throw new Error('更新服务返回的数据过大。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function fetchReleaseJson(url, source, signal, fetchImpl = fetch) {
  return JSON.parse(await readMetadata(await requestUpdate(url, {
    origins: source === 'gitee' ? giteeOrigins : githubOrigins, signal, fetchImpl,
    headers: { Accept: source === 'gitee' ? 'application/json' : 'application/vnd.github+json' },
  })))
}

function createUpdateTransport(release, { fetchImpl = fetch, testOrigin, metadataSignal,
  manifestTimeoutMs = 15000, stallTimeoutMs = 30000 } = {}) {
  const origins = [...(release.source === 'gitee' ? giteeOrigins : githubOrigins)]
  if (release.staticOrigin) origins.push(release.staticOrigin)
  // Passed explicitly by the isolated smoke test, never from a release or user setting.
  if (testOrigin) origins.push(testOrigin)
  let expected
  return {
    setManifest: file => { expected = { ...file } },
    async request() {
      const timeout = AbortSignal.timeout(manifestTimeoutMs)
      const signal = metadataSignal ? AbortSignal.any([timeout, metadataSignal]) : timeout
      return readMetadata(await requestUpdate(new URL('latest.yml', release.feedUrl), { origins, signal, fetchImpl }))
    },
    async download(url, destination, { cancellationToken, onProgress }) {
      if (!expected || url.href !== new URL(release.installer, release.feedUrl).href) {
        throw new Error('安装包地址与已校验的更新清单不一致。')
      }
      const controller = new AbortController()
      const abort = () => controller.abort(new CancellationError())
      cancellationToken.onCancel(abort)
      let timer
      const resetTimeout = () => {
        clearTimeout(timer)
        timer = setTimeout(() => controller.abort(new Error('更新下载停滞超时。')), stallTimeoutMs)
      }
      resetTimeout()
      try {
        const response = await requestUpdate(url, { origins, signal: controller.signal, fetchImpl })
        const started = Date.now()
        const hash = createHash('sha512')
        let transferred = 0
        await pipeline(Readable.fromWeb(response.body), new Transform({
          transform(chunk, _encoding, callback) {
            resetTimeout()
            transferred += chunk.length
            if (transferred > expected.size) return callback(new Error('安装包大小校验失败。'))
            hash.update(chunk)
            onProgress?.({ transferred, total: expected.size, percent: 100 * transferred / expected.size,
              bytesPerSecond: Math.round(transferred * 1000 / Math.max(1, Date.now() - started)) })
            callback(null, chunk)
          },
        }), createWriteStream(destination, { flags: 'wx' }), { signal: controller.signal })
        if (transferred !== expected.size) throw new Error('安装包大小校验失败。')
        if (hash.digest('base64') !== expected.sha512) throw new Error('SHA512 checksum mismatch')
      } catch (error) {
        throw controller.signal.aborted ? controller.signal.reason : error
      } finally {
        clearTimeout(timer)
        cancellationToken.removeListener('cancel', abort)
      }
    },
  }
}

async function verifyDownloadedFile(files, expected) {
  const filename = files?.[0]
  if (files?.length !== 1 || basename(filename) !== expected.url) throw new Error('安装包文件名校验失败。')
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.size !== expected.size) throw new Error('安装包大小校验失败。')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  if (hash.digest('base64') !== expected.sha512) throw new Error('SHA512 checksum mismatch')
}

module.exports = { createElectronUpdateFetch, createUpdateTransport, fetchReleaseJson, verifyDownloadedFile }
