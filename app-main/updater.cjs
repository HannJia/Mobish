const semver = require('semver')

const RELEASES_URL = 'https://github.com/HannJia/mobish/releases'
const LATEST_API = 'https://api.github.com/repos/HannJia/mobish/releases/latest'
const GITEE_RELEASES_URL = 'https://gitee.com/hannjia/Mobish/releases'
const GITEE_API = 'https://gitee.com/api/v5/repos/hannjia/Mobish/releases'

function releaseVersion(data) {
  const tag = data?.tag_name
  const version = typeof tag === 'string' && /^v?\d+\.\d+\.\d+$/.test(tag) ? semver.valid(tag) : null
  if (!version || (data.draft !== undefined && data.draft !== false)
    || (data.prerelease !== undefined && data.prerelease !== false)) return null
  return version
}

function parseRelease(data, currentVersion, arch = 'x64', source = 'github', expectedTag, giteeStaticBase) {
  const tag = data?.tag_name
  const version = releaseVersion(data)
  if (!version) throw new Error('发布版本号无效，或不是正式版本。')
  if (expectedTag && tag !== expectedTag) throw new Error('Gitee 备用源尚未提供同一版本的更新文件。')
  if (!semver.gt(version, currentVersion)) return null
  const installer = `mobish-${version}.exe`
  const assets = Array.isArray(data.assets) ? data.assets : []
  const findAsset = name => assets.find(asset => asset?.name === name && asset.state === 'uploaded'
    && Number.isSafeInteger(asset.size) && asset.size > 0)
  const installerAsset = findAsset(installer)
  const releasesUrl = source === 'gitee' ? GITEE_RELEASES_URL : RELEASES_URL
  const staticBase = source === 'gitee' && giteeStaticBase ? new URL(giteeStaticBase) : null
  if (staticBase && (staticBase.protocol !== 'https:' || staticBase.username || staticBase.password
    || staticBase.search || staticBase.hash || !staticBase.pathname.endsWith('/'))) {
    throw new Error('Gitee 静态更新地址配置无效。')
  }
  return {
    version, tag, source,
    url: `${releasesUrl}/tag/${tag}`,
    feedUrl: staticBase ? new URL(`${tag}/`, staticBase).href : `${releasesUrl}/download/${tag}/`,
    staticOrigin: staticBase?.origin,
    installer,
    installerSize: source === 'github' ? installerAsset?.size : undefined,
    notes: typeof data.body === 'string' ? data.body.slice(0, 24000) : '',
    publishedAt: typeof data.published_at === 'string' ? data.published_at
      : typeof data.created_at === 'string' ? data.created_at : '',
    canDownload: arch === 'x64' && (source === 'gitee' || Boolean(installerAsset && findAsset('latest.yml'))),
  }
}

function validateManifest(info, release) {
  if (!info || info.version !== release.version || !Array.isArray(info.files) || info.files.length !== 1) {
    throw new Error('更新清单与发布版本不一致，请稍后重新检查。')
  }
  const file = info.files[0]
  if (!file || file.url !== release.installer || typeof file.sha512 !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || !Number.isSafeInteger(file.size) || file.size <= 0
    || (release.installerSize !== undefined && file.size !== release.installerSize)
    || (info.path !== undefined && info.path !== file.url)
    || (info.sha512 !== undefined && info.sha512 !== file.sha512) || info.packages) {
    throw new Error('更新清单缺少有效校验信息，或包含不受支持的安装地址。')
  }
}

function publicRelease(release) {
  if (!release) return null
  const { feedUrl, installer, installerSize, tag, source, staticOrigin, ...visible } = release
  return visible
}

function createUpdateController(options) {
  const { supported, currentVersion, fetchLatest, getUpdater, publish, prepareInstall,
    allowQuit, savePreference, openExternal, fetchGitee, giteeStaticBase, makeTransport,
    verifyDownload, checkTimeoutMs = 15000, arch = 'x64' } = options
  let release = null
  let updater = null
  let operation = null
  let downloadToken = null
  let downloadAbort = null
  let installerManifest = null
  let ready = false
  let cancelled = false
  let startupTimer = null
  let intervalTimer = null
  let retryTimer = null
  let retryCount = 0
  let lastAttempt = 0
  let disposed = false
  let revision = 0
  let state = {
    supported, currentVersion, phase: supported ? 'idle' : 'unsupported',
    autoCheck: options.autoCheck !== false, release: null, checkedAt: '', error: '',
    percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, revision,
  }
  const snapshot = () => ({ ...state, release: state.release ? { ...state.release } : null })
  function set(patch) {
    state = { ...state, ...patch, revision: ++revision }
    publish(snapshot())
  }
  function fail(error, fallback = 'error') {
    const raw = error instanceof Error ? error.message : String(error)
    const detail = /(?:sha512|checksum|signature|校验)/i.test(raw)
      ? '安装包校验失败，未安装。请重新下载或到发布页核对文件。'
      : /(?:ERR_|https?:|net::|ECONN|ETIMEDOUT|fetch)/i.test(raw)
        ? '无法连接更新服务或下载中断。请检查网络后重试，也可打开发布页手动下载。'
        : raw.slice(0, 240)
    set({ phase: fallback, error: detail })
  }
  function ensureUpdater() {
    if (updater) return updater
    updater = getUpdater()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.disableDifferentialDownload = true
    updater.on('download-progress', progress => {
      if (state.phase !== 'downloading' || cancelled) return
      set({
        percent: Math.min(100, Math.max(0, Number(progress.percent) || 0)),
        transferred: Math.max(0, Number(progress.transferred) || 0),
        total: Math.max(0, Number(progress.total) || 0),
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0),
      })
    })
    // Check/download promises handle their errors; installation can report errors asynchronously.
    updater.on('error', error => {
      if (state.phase === 'installing') {
        allowQuit(false)
        fail(error, 'downloaded')
      }
    })
    return updater
  }
  function exclusive(work) {
    if (operation) return operation
    operation = Promise.resolve().then(work).finally(() => { operation = null })
    return operation
  }
  async function lookup(fetchRelease, tag, signal) {
    if (!fetchRelease) throw new Error('备用更新源不可用。')
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new Error('检查更新超时。')), checkTimeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
    let rejectAbort
    const onAbort = () => rejectAbort(combined.reason)
    try {
      combined.throwIfAborted()
      return await Promise.race([
        new Promise((_resolve, reject) => {
          rejectAbort = reject
          combined.addEventListener('abort', onAbort, { once: true })
        }),
        fetchRelease(combined, tag),
      ])
    } finally {
      clearTimeout(timer)
      combined.removeEventListener('abort', onAbort)
    }
  }
  async function prepareRelease(candidate, signal) {
    if (!candidate?.canDownload) throw new Error('发布版缺少更新清单或安装包。')
    const client = ensureUpdater()
    const transport = makeTransport?.(candidate, signal)
    if (transport) client.httpExecutor = transport
    client.setFeedURL({ provider: 'generic', url: candidate.feedUrl, useMultipleRangeRequest: false })
    const result = await client.checkForUpdates()
    signal?.throwIfAborted()
    validateManifest(result?.updateInfo, candidate)
    if (!result.cancellationToken) throw new Error('当前系统无法安装此更新。')
    installerManifest = result.updateInfo.files[0]
    transport?.setManifest(installerManifest)
    downloadToken = result.cancellationToken
    ready = true
  }
  async function lookupGitee(tag, signal) {
    const data = await lookup(fetchGitee, tag, signal)
    return parseRelease(data, currentVersion, arch, 'gitee', tag, giteeStaticBase)
  }
  async function check() {
    if (disposed || !supported || ['downloaded', 'installing', 'downloading'].includes(state.phase)) return snapshot()
    await exclusive(async () => {
      clearTimeout(retryTimer)
      retryTimer = null
      lastAttempt = Date.now()
      set({ phase: 'checking', error: '' })
      ready = false
      release = null
      downloadToken = null
      try {
        try {
          release = parseRelease(await lookup(fetchLatest), currentVersion, arch)
          if (release && arch === 'x64') await prepareRelease(release)
        } catch (error) {
          if (!fetchGitee) throw error
          const fallback = await lookupGitee(release?.tag)
          if (fallback) {
            release ||= fallback
            if (arch === 'x64') await prepareRelease(fallback)
            release = fallback
          }
        }
        set({
          phase: release ? 'available' : 'current', release: publicRelease(release),
          checkedAt: new Date().toISOString(), percent: 0,
        })
        retryCount = 0
        if (release && !ready) scheduleRetry()
      } catch (error) {
        set({ release: publicRelease(release ? { ...release, canDownload: false } : null),
          checkedAt: new Date().toISOString() })
        fail(error, release ? 'available' : 'error')
        scheduleRetry()
      }
      return snapshot()
    })
    // The check must release its operation before acquiring the download lock.
    // Re-read the preference after network I/O so opting out takes effect immediately.
    if (!disposed && state.autoCheck && ready && state.phase === 'available') return download()
    return snapshot()
  }
  async function download() {
    if (!supported || !ready || !release?.canDownload || state.phase !== 'available') return snapshot()
    return exclusive(async () => {
      cancelled = false
      downloadAbort = new AbortController()
      set({ phase: 'downloading', percent: 0, error: '', transferred: 0, total: 0, bytesPerSecond: 0 })
      const client = ensureUpdater()
      async function downloadRelease() {
        const files = await client.downloadUpdate(downloadToken)
        await verifyDownload?.(files, installerManifest)
        downloadAbort.signal.throwIfAborted()
      }
      try {
        try {
          await downloadRelease()
        } catch (error) {
          await client.downloadedUpdateHelper?.clear()
          if (cancelled || release.source !== 'github' || !fetchGitee) throw error
          ready = false
          downloadToken = null
          const fallback = await lookupGitee(release.tag, downloadAbort.signal)
          await prepareRelease(fallback, downloadAbort.signal)
          release = fallback
          set({ release: publicRelease(release), percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
          await downloadRelease()
        }
        set({ phase: 'downloaded', percent: 100 })
      } catch (error) {
        ready = false
        await client.downloadedUpdateHelper?.clear()
        if (cancelled) set({ phase: 'idle', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: '' })
        else fail(error)
      } finally {
        downloadAbort = null
        downloadToken = null
      }
      return snapshot()
    })
  }
  function cancel() {
    if (state.phase === 'downloading' && !cancelled) {
      cancelled = true
      downloadAbort?.abort()
      downloadToken?.cancel()
    }
    return snapshot()
  }
  async function install() {
    if (!supported || state.phase !== 'downloaded') return snapshot()
    return exclusive(async () => {
      set({ phase: 'installing', error: '' })
      try {
        await prepareInstall()
        allowQuit(true)
        ensureUpdater().quitAndInstall(false, true)
      } catch (error) {
        allowQuit(false)
        fail(error, 'downloaded')
      }
      return snapshot()
    })
  }
  function stopTimers() {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
    clearTimeout(retryTimer)
    startupTimer = intervalTimer = retryTimer = null
  }
  function scheduleRetry() {
    if (disposed || !supported) return
    const minutes = [1, 5, 15, 30, 60][Math.min(retryCount++, 4)]
    retryTimer = setTimeout(() => { retryTimer = null; void check() }, minutes * 60000)
    retryTimer.unref?.()
  }
  function wake() {
    if (disposed || !supported || !lastAttempt || operation) return snapshot()
    const retryable = state.phase === 'error' || (state.phase === 'available' && !ready)
    const stale = ['idle', 'current'].includes(state.phase)
    if ((retryable || stale) && Date.now() - lastAttempt >= (retryable ? 60000 : 6 * 60 * 60 * 1000)) return check()
    return snapshot()
  }
  function start() {
    stopTimers()
    disposed = false
    retryCount = 0
    if (!supported) return
    startupTimer = setTimeout(() => { void check() }, 12000)
    intervalTimer = setInterval(() => {
      if (!['checking', 'downloading', 'downloaded', 'installing'].includes(state.phase)) void check()
    }, 6 * 60 * 60 * 1000)
    startupTimer.unref?.()
    intervalTimer.unref?.()
  }
  function setAutoCheck(value) {
    if (typeof value !== 'boolean') throw new TypeError('自动检查设置必须为布尔值')
    savePreference(value)
    set({ autoCheck: value })
    start()
    return snapshot()
  }
  return {
    snapshot, check, download, cancel, install, start, wake,
    dispose: () => { disposed = true; stopTimers() }, setAutoCheck,
    openRelease: () => openExternal(release?.url || RELEASES_URL),
  }
}

module.exports = { createUpdateController, parseRelease, releaseVersion, validateManifest, RELEASES_URL, LATEST_API, GITEE_API }
