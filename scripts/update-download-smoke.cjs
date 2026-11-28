const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { app, net } = require('electron')
const { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const { createUpdateController, validateManifest, OFFICIAL_DOWNLOAD_URL } = require('../app-main/updater.cjs')
const { createElectronUpdateFetch, createUpdateTransport, fetchOfficialManifest, verifyDownloadedFile } = require('../app-main/updateTransport.cjs')

async function main() {
  const directory = process.env.AI_NOVEL_UPDATE_TEST_DIR
  if (!directory) throw new Error('Missing isolated test directory')
  app.disableHardwareAcceleration()
  app.setPath('userData', directory)
  const payload = Buffer.from('NON_EXECUTABLE_UPDATE_DOWNLOAD_TEST\n'.repeat(2048))
  const sha512 = crypto.createHash('sha512').update(payload).digest('base64')
  let corrupt = false
  let downloads = 0
  const filename = 'mobish-1.0.3.exe'
  const metadata = { version: '1.0.3', files: [{ url: filename, size: payload.length, sha512 }] }
  const officialYaml = [
    'version: 1.0.3', 'files:', '  - url: ' + filename, '    size: ' + payload.length,
    '    sha512: ' + sha512, "releaseDate: '2026-11-27T00:00:00Z'",
  ].join('\n')
  const officialScenarios = [
    'official-check', 'official-manifest', 'official-download', 'official-lagging',
    'official-manifest-redirect', 'official-installer-redirect', 'official-checksum', 'official-gitee', 'official-cancelled',
  ]
  const requests = []
  let foreignRequests = 0
  const foreign = http.createServer((_request, response) => { foreignRequests++; response.end() })
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve))
  let startDownload
  const server = http.createServer((request, response) => {
    requests.push(request.url)
    const [, source, scenario, file] = request.url.split('/')
    if (source === 'official') {
      if (file === 'latest.yml') {
        if (scenario === 'official-manifest-redirect') {
          response.writeHead(302, { Location: 'http://127.0.0.1:' + foreign.address().port + '/untrusted' }).end()
          return
        }
        const yaml = scenario === 'official-lagging' ? officialYaml.replace('version: 1.0.3', 'version: 1.0.2') : officialYaml
        response.end(yaml)
        return
      }
      if (file === filename) {
        if (scenario === 'official-installer-redirect') {
          response.writeHead(302, { Location: 'http://127.0.0.1:' + foreign.address().port + '/untrusted' }).end()
          return
        }
        const bytes = ['official-checksum', 'official-gitee'].includes(scenario) ? Buffer.alloc(payload.length, 1) : payload
        response.end(bytes)
        return
      }
    }
    if (['github', 'gitee'].includes(source)) {
      if (file === 'latest.yml') {
        if (source === 'github' && ['manifest', 'official-manifest'].includes(scenario)) { response.writeHead(404).end(); return }
        if (source === 'github' && scenario === 'manifest-timeout') {
          response.writeHead(200)
          response.write('{')
          return
        }
        if (source === 'gitee') {
          response.writeHead(302, { Location: '/mirror-manifest' }).end()
          return
        }
        response.end(JSON.stringify(metadata))
        return
      }
      if (file === filename) {
        if (source === 'github') {
          if (scenario === 'failed' || scenario === 'both-fail'
            || (officialScenarios.includes(scenario) && scenario !== 'official-cancelled')) { response.writeHead(503).end(); return }
          if (scenario === 'redirect') {
            response.writeHead(302, { Location: `http://127.0.0.1:${foreign.address().port}/payload` }).end()
            return
          }
          if (['stalled', 'cancelled', 'official-cancelled'].includes(scenario)) {
            response.writeHead(200)
            response.write(payload.subarray(0, 1))
            startDownload?.()
            return
          }
          if (scenario === 'size') { response.end(payload.subarray(0, -1)); return }
          if (scenario === 'checksum') { response.end(Buffer.alloc(payload.length, 1)); return }
        }
        if (scenario === 'both-fail') { response.writeHead(503).end(); return }
        response.end(payload)
        return
      }
    }
    if (request.url === '/mirror-manifest') { response.end(JSON.stringify(metadata)); return }
    if (request.url.startsWith('/latest.yml')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(metadata))
    } else if (request.url === `/${filename}`) {
      downloads++
      const bytes = corrupt ? Buffer.from(payload.toString().replace('NON_EXECUTABLE', 'BAD_EXECUTABLE')) : payload
      response.setHeader('Content-Length', bytes.length)
      response.end(bytes)
    } else { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    await app.whenReady()
    async function makeUpdater(test) {
      const cache = path.join(directory, test)
      await fs.mkdir(cache)
      const config = path.join(cache, 'app-update.yml')
      await fs.writeFile(config, JSON.stringify({ provider: 'generic', url, updaterCacheDirName: `smoke-${test}` }))
      const adapter = {
        version: '1.0.2', name: 'updater-smoke', isPackaged: true, appUpdateConfigPath: config,
        userDataPath: cache, baseCachePath: cache, whenReady: () => app.whenReady(),
        quit: () => assert.fail('Test must not quit to install'), relaunch: () => assert.fail('Test must not relaunch'),
        onQuit: () => assert.fail('Automatic install on quit must remain disabled'),
      }
      const updater = new NsisUpdater(undefined, adapter)
      updater.logger = null
      return updater
    }
    for (const test of ['valid', 'tampered']) {
      corrupt = test === 'tampered'
      const updater = await makeUpdater(test)
      updater.httpExecutor = new ElectronHttpExecutor()
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.disableWebInstaller = true
      updater.disableDifferentialDownload = true
      updater.setFeedURL({ provider: 'generic', url })
      updater.on('error', () => undefined)
      const before = downloads
      const result = await updater.checkForUpdates()
      validateManifest(result.updateInfo, { version: '1.0.3', installer: filename })
      assert.equal(downloads, before, 'Checking must not download')
      if (corrupt) {
        await assert.rejects(updater.downloadUpdate(result.cancellationToken), /checksum mismatch/)
      } else {
        const files = await updater.downloadUpdate(result.cancellationToken)
        assert.deepEqual(await fs.readFile(files[0]), payload)
      }
      console.log(`UPDATE_DOWNLOAD_SMOKE ${test}: passed`)
    }
    const giteeScenarios = ['github', 'manifest', 'manifest-timeout', 'failed', 'checksum', 'size', 'stalled', 'redirect', 'both-fail', 'cancelled']
    const fetchImpl = createElectronUpdateFetch(net)
    const testOrigin = new URL(url).origin
    const errors = {
      'both-fail': /503/, 'official-lagging': /尚未同步同一版本/,
      'official-manifest-redirect': /不受信任/, 'official-installer-redirect': /不受信任/,
      'official-checksum': /校验失败/,
    }
    for (const scenario of [...giteeScenarios, ...officialScenarios]) {
      const updater = await makeUpdater(scenario)
      const release = { tag_name: 'v1.0.3', assets: [
        { name: filename, state: 'uploaded', size: payload.length },
        { name: 'latest.yml', state: 'uploaded', size: 200 },
      ] }
      const officialBase = url + 'official/' + scenario + '/'
      const isOfficial = officialScenarios.includes(scenario)
      const cancelled = ['cancelled', 'official-cancelled'].includes(scenario)
      const controller = createUpdateController({
        supported: true, autoCheck: false, currentVersion: '1.0.2',
        fetchLatest: async () => {
          if (scenario === 'official-check') throw new Error('GitHub unavailable')
          return release
        },
        officialBase,
        fetchOfficial: isOfficial
          ? signal => fetchOfficialManifest(new URL('latest.yml', officialBase), signal, fetchImpl, testOrigin)
          : undefined,
        fetchGitee: !isOfficial || scenario === 'official-gitee' ? async (_signal, tag) => {
          assert.equal(tag, 'v1.0.3')
          return release
        } : undefined,
        getUpdater: () => updater,
        makeTransport: (candidate, signal) => {
          // The transport still validates the exact URL the updater resolves.
          const feedUrl = `${url}${candidate.source}/${scenario}/`
          const setFeedURL = updater.setFeedURL.bind(updater)
          updater.setFeedURL = options => {
            updater.setFeedURL = setFeedURL
            setFeedURL({ ...options, url: feedUrl })
          }
          return createUpdateTransport({ ...candidate, feedUrl }, {
            testOrigin, metadataSignal: signal, manifestTimeoutMs: 500, stallTimeoutMs: 500, fetchImpl,
          })
        },
        verifyDownload: verifyDownloadedFile, publish: () => {},
        prepareInstall: () => assert.fail('Test must not prepare to install'),
      })
      requests.length = 0
      assert.equal((await controller.check()).phase, 'available')
      if (cancelled) startDownload = () => controller.cancel()
      const state = await controller.download()
      startDownload = undefined
      if (cancelled || errors[scenario]) {
        assert.equal(state.phase, cancelled ? 'idle' : 'error')
        if (errors[scenario]) assert.match(state.error, errors[scenario])
        assert.deepEqual(await fs.readdir(updater.downloadedUpdateHelper.cacheDirForPendingUpdate), [])
      } else {
        assert.equal(state.phase, 'downloaded', state.error)
        if (isOfficial && scenario !== 'official-gitee') assert.equal(state.release.url, OFFICIAL_DOWNLOAD_URL)
        else assert.equal(new URL(state.release.url).hostname, scenario === 'github' ? 'github.com' : 'gitee.com')
        assert.deepEqual(await fs.readFile(updater.downloadedUpdateHelper.file), payload)
        const pending = await fs.readdir(updater.downloadedUpdateHelper.cacheDirForPendingUpdate)
        assert.deepEqual(pending.sort(), [filename, 'update-info.json'].sort())
      }
      if (!isOfficial) {
        if (scenario === 'github' || cancelled) assert.ok(!requests.some(url => url.startsWith('/gitee/')))
        else assert.ok(requests.includes('/gitee/' + scenario + '/latest.yml'))
      }
      if (isOfficial) {
        const manifestRequests = requests.filter(request => request === '/official/' + scenario + '/latest.yml')
        const rejectedDiscovery = ['official-lagging', 'official-manifest-redirect'].includes(scenario)
        assert.equal(manifestRequests.length, cancelled ? 0 : rejectedDiscovery ? 1 : 2)
        const installerRequest = '/official/' + scenario + '/' + filename
        assert.equal(requests.includes(installerRequest), !cancelled && !rejectedDiscovery)
        if (scenario === 'official-gitee') {
          assert.ok(requests.indexOf('/gitee/' + scenario + '/latest.yml') > requests.indexOf(installerRequest))
        } else assert.ok(!requests.some(url => url.startsWith('/gitee/')))
      }
      assert.equal(foreignRequests, 0)
      controller.dispose()
      console.log(`UPDATE_DOWNLOAD_SMOKE ${scenario}: passed`)
    }
  } finally {
    server.closeAllConnections()
    foreign.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => foreign.close(resolve))
  }
}

async function runIsolated() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-update-smoke-'))
  try {
    const child = spawn(require('electron'), ['--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu', __filename], {
      env: { ...process.env, AI_NOVEL_UPDATE_TEST_DIR: directory }, stdio: 'inherit', windowsHide: true,
    })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), 75000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); resolve(code) })
    })
    if (code !== 0) throw new Error(`Update download smoke failed (${code})`)
  } finally {
    const resolved = path.resolve(directory)
    if (!resolved.startsWith(path.join(path.resolve(os.tmpdir()), 'novel-update-smoke-'))) throw new Error('Unsafe test cleanup path')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.versions.electron) {
  const timeout = setTimeout(() => { console.error('Update download smoke timed out'); app.exit(1) }, 60000)
  main().then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => {
    clearTimeout(timeout)
    console.error(error)
    app.exit(1)
  })
} else {
  runIsolated().catch(error => { console.error(error); process.exitCode = 1 })
}
