import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import path from 'node:path'

const requireLocal = createRequire(path.resolve('app-main/main.js'))
const { createUpdateController, parseOfficialManifest, parseRelease, validateManifest,
  OFFICIAL_UPDATE_BASE, OFFICIAL_DOWNLOAD_URL } = requireLocal('./updater.cjs')
const { createUpdateTransport, fetchOfficialManifest } = requireLocal('./updateTransport.cjs')
const { createUpdateHandshake } = requireLocal('./updateHandshake.cjs')
const installer = 'mobish-1.0.3.exe'
const giteeReleaseUrl = 'https://gitee.com/hannjia/Mobish/releases/tag/v1.0.3'
function release() {
  return { tag_name: 'v1.0.3', body: '# 修复问题', published_at: '2026-09-13T08:00:00Z',
    assets: [{ name: installer, state: 'uploaded', size: 300 }, { name: 'latest.yml', state: 'uploaded', size: 200 }] }
}
const manifest = () => ({ version: '1.0.3', files: [{ url: installer, size: 300, sha512: Buffer.alloc(64, 1).toString('base64') }] })
const officialManifest = (version = '1.0.3') => 'version: ' + version + '\nreleaseDate: "2026-09-14T08:00:00Z"\n'
function setup(extra: Record<string, unknown> = {}) {
  const token = { cancel: vi.fn() }
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => ({ updateInfo: manifest(), cancellationToken: token })),
    downloadUpdate: vi.fn(async () => undefined), quitAndInstall: vi.fn(), autoDownload: true,
    autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true,
  })
  const options = {
    supported: true, autoCheck: false, currentVersion: '1.0.2', fetchLatest: vi.fn(async () => release()), getUpdater: vi.fn(() => updater),
    publish: vi.fn(), prepareInstall: vi.fn(async () => undefined), allowQuit: vi.fn(), savePreference: vi.fn(),
    openExternal: vi.fn(), ...extra,
  }
  return { controller: createUpdateController(options), options, updater, token }
}
afterEach(() => vi.useRealTimers())

describe('GitHub release validation', () => {
  it('uses semantic versions and ignores equal or older releases', () => {
    expect(parseRelease({ ...release(), tag_name: 'v1.0.10' }, '1.0.2').version).toBe('1.0.10')
    expect(parseRelease(release(), '1.0.3')).toBeNull()
    expect(parseRelease(release(), '2.0.0')).toBeNull()
  })
  it.each(['1.01', 'latest', 'v1.0.4-beta.1', '../../payload', 'https://example.test/a'])('rejects non-release tag %s', tag_name => {
    expect(() => parseRelease({ ...release(), tag_name }, '1.0.2')).toThrow()
  })
  it('rejects drafts and prereleases and derives trusted URLs instead of trusting API URLs', () => {
    expect(() => parseRelease({ ...release(), draft: true }, '1.0.2')).toThrow()
    expect(() => parseRelease({ ...release(), prerelease: true }, '1.0.2')).toThrow()
    expect(parseRelease({ ...release(), html_url: 'https://example.test' }, '1.0.2').url)
      .toBe('https://github.com/HannJia/mobish/releases/tag/v1.0.3')
  })
  it('does not offer automatic downloads without both metadata and a matching installer', () => {
    expect(parseRelease({ ...release(), assets: release().assets.slice(0, 1) }, '1.0.2').canDownload).toBe(false)
    expect(parseRelease(release(), '1.0.2', 'arm64').canDownload).toBe(false)
  })
  it('pins the manifest version, payload name and checksum, excluding web installers and external URLs', () => {
    const info = parseRelease(release(), '1.0.2')
    expect(() => validateManifest(manifest(), info)).not.toThrow()
    for (const invalid of [
      { ...manifest(), version: '1.0.4' },
      { ...manifest(), packages: { x64: { path: 'https://example.test/payload' } } },
      { ...manifest(), files: [] },
      { ...manifest(), files: [{ ...manifest().files[0], url: 'https://example.test/payload.exe' }] },
      { ...manifest(), files: [{ ...manifest().files[0], url: '../payload.exe' }] },
      { ...manifest(), files: [{ ...manifest().files[0], sha512: '' }] },
    ]) expect(() => validateManifest(invalid, info)).toThrow()
  })
})

describe('desktop update lifecycle', () => {
  it('retries failed checks after automatic downloads are disabled', async () => {
    vi.useFakeTimers()
    const { controller, options } = setup({ autoCheck: true, currentVersion: '1.0.3' })
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    controller.start()
    await vi.advanceTimersByTimeAsync(12000)
    expect(controller.snapshot().phase).toBe('error')
    await vi.advanceTimersByTimeAsync(60000)
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().phase).toBe('current')
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    await controller.check()
    controller.setAutoCheck(false)
    await vi.advanceTimersByTimeAsync(3600000)
    expect(options.fetchLatest).toHaveBeenCalledTimes(4)
    expect(controller.snapshot().phase).toBe('current')
    controller.dispose()
  })
  it('keeps the new-version notice if manifest verification fails without allowing unverified downloads', async () => {
    vi.useFakeTimers()
    const { controller, updater } = setup({ autoCheck: true })
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_TIMED_OUT'))
    await controller.check()
    expect(controller.snapshot()).toMatchObject({ phase: 'available', release: { version: '1.0.3', canDownload: false } })
    expect(controller.snapshot().error).not.toBe('')
    await controller.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60000)
    expect(controller.snapshot().release.canDownload).toBe(true)
    controller.dispose()
  })
  it('refreshes stale checks after wake and throttles repeated events with automatic downloads disabled', async () => {
    vi.useFakeTimers()
    const { controller, options } = setup({ autoCheck: true, currentVersion: '1.0.3' })
    await controller.check()
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000)
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledTimes(2)
    controller.setAutoCheck(false)
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000)
    await controller.wake()
    expect(options.fetchLatest).toHaveBeenCalledTimes(3)
    controller.dispose()
  })
  it('never checks or downloads in development and browser-like environments', async () => {
    const { controller, options } = setup({ supported: false })
    controller.start()
    await controller.check()
    await controller.download()
    await controller.install()
    expect(options.fetchLatest).not.toHaveBeenCalled()
    expect(options.getUpdater).not.toHaveBeenCalled()
    expect(controller.snapshot().phase).toBe('unsupported')
    controller.dispose()
  })
  it.each([true, false])('checks at startup and periodically with auto-download preference %s', async autoCheck => {
    vi.useFakeTimers()
    const { controller, options, updater } = setup({ autoCheck, currentVersion: '1.0.3' })
    controller.start()
    await vi.advanceTimersByTimeAsync(11999)
    expect(options.fetchLatest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    controller.setAutoCheck(false)
    expect(options.savePreference).toHaveBeenCalledWith(false)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(options.fetchLatest).toHaveBeenCalledTimes(3)
    await controller.check()
    expect(options.fetchLatest).toHaveBeenCalledTimes(4)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(() => controller.setAutoCheck('yes')).toThrow()
    controller.dispose()
  })
  it('coalesces repeated checks and does not download without an explicit command', async () => {
    const { controller, updater, options } = setup()
    await Promise.all([controller.check(), controller.check(), controller.check()])
    expect(options.fetchLatest).toHaveBeenCalledOnce()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.setFeedURL.mock.calls[0][0].url).toBe('https://github.com/HannJia/mobish/releases/download/v1.0.3/')
    expect(controller.snapshot().phase).toBe('available')
  })
  it('can show old releases without updater metadata as already current', async () => {
    const { controller, options } = setup({ currentVersion: '1.0.3', fetchLatest: vi.fn(async () => ({ ...release(), assets: [] })) })
    await controller.check()
    expect(controller.snapshot().phase).toBe('current')
    expect(options.getUpdater).not.toHaveBeenCalled()
  })
  it('offers a manual release page when files are incomplete', async () => {
    const { controller, options, updater } = setup({ fetchLatest: async () => ({ ...release(), assets: [] }) })
    await controller.check()
    expect(controller.snapshot().phase).toBe('available')
    expect(controller.snapshot().release.canDownload).toBe(false)
    await controller.download()
    controller.openRelease()
    expect(options.openExternal).toHaveBeenCalledWith('https://github.com/HannJia/mobish/releases/tag/v1.0.3')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })
  it('requires confirmation, successful download and save before installation', async () => {
    const { controller, updater, options } = setup()
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    expect(controller.snapshot().phase).toBe('downloaded')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(options.prepareInstall).not.toHaveBeenCalled()
    await Promise.all([controller.install(), controller.install()])
    expect(options.prepareInstall).toHaveBeenCalledOnce()
    expect(options.allowQuit).toHaveBeenCalledWith(true)
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })
  it('keeps a downloaded update after saving fails and allows retry without another download', async () => {
    const { controller, updater, options } = setup()
    await controller.check()
    await controller.download()
    options.prepareInstall.mockRejectedValueOnce(new Error('正文尚未保存'))
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ phase: 'downloaded', error: '正文尚未保存' })
    await controller.install()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })
  it('reports progress, cancels without installing, and requires a fresh check to retry', async () => {
    const { controller, updater, token } = setup()
    await controller.check()
    let rejectDownload!: (error: Error) => void
    updater.downloadUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject }))
    const download = controller.download()
    await Promise.resolve()
    updater.emit('download-progress', { percent: 41, transferred: 41, total: 100, bytesPerSecond: 25 })
    expect(controller.snapshot().percent).toBe(41)
    controller.cancel()
    expect(token.cancel).toHaveBeenCalledOnce()
    rejectDownload(new Error('cancelled'))
    await download
    expect(controller.snapshot().phase).toBe('idle')
    await controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    expect(controller.snapshot().phase).toBe('downloaded')
  })
  it('leaves the app running on failed checks, downloads, and installer errors', async () => {
    const { controller, updater, options } = setup()
    options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    await controller.check()
    expect(controller.snapshot().phase).toBe('error')
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'))
    await controller.download()
    expect(controller.snapshot().error).toContain('校验失败')
    await controller.install()
    expect(options.prepareInstall).not.toHaveBeenCalled()
    await controller.check()
    await controller.download()
    await controller.install()
    updater.emit('error', new Error('installer failed'))
    expect(controller.snapshot().phase).toBe('downloaded')
    expect(options.allowQuit).toHaveBeenLastCalledWith(false)
  })
})

describe('update save handshake', () => {
  it('ignores stale replies and permits only the matching save acknowledgement', async () => {
    const send = vi.fn()
    const handshake = createUpdateHandshake(send)
    const pending = handshake.request()
    const requestId = send.mock.calls[0][0]
    handshake.respond({ requestId: 'old', ok: true })
    expect(handshake.busy).toBe(true)
    await expect(handshake.request()).rejects.toThrow('正在保存')
    handshake.respond({ requestId, ok: true })
    await pending
    expect(handshake.busy).toBe(false)
  })
  it('fails closed on save failure and timeout', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const handshake = createUpdateHandshake(send, 100)
    const rejected = expect(handshake.request()).rejects.toThrow('保存失败')
    handshake.respond({ requestId: send.mock.calls[0][0], ok: false, error: '保存失败' })
    await rejected
    const timeout = expect(handshake.request()).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(100)
    await timeout
    expect(handshake.busy).toBe(false)
  })
})

describe('official update fallback', () => {
  it('parses top-level fields and derives the installer and download page', () => {
    const customBase = 'https://dl.mobish.cn/test/'
    const raw = "\uFEFFversion: '1.0.3' # stable\r\nfiles:\r\n  version: 9.0.0\r\nreleaseDate: 2026-09-14T08:00:00Z\r\n"
    expect(parseOfficialManifest(raw, '1.0.2', 'arm64', 'v1.0.3', customBase)).toEqual({
      version: '1.0.3', tag: 'v1.0.3', source: 'official', url: OFFICIAL_DOWNLOAD_URL, feedUrl: customBase,
      installer, installerSize: undefined, notes: '', publishedAt: '2026-09-14T08:00:00Z', canDownload: false,
    })
    expect(parseOfficialManifest(raw, '1.0.3')).toBeNull()
    expect(parseOfficialManifest(raw, '1.0.4')).toBeNull()
  })

  it.each(['1.0.3-rc.1', '1.0.3+test', '../../payload', 'v1.0.3', '1.00.3', '1.0.3\nversion: 1.0.4'])(
    'rejects invalid official manifest version %j', version => {
      expect(() => parseOfficialManifest(officialManifest(version), '1.0.2')).toThrow()
    },
  )

  it.each(['current', 'available'])('keeps GitHub when its check succeeds as %s', async phase => {
    const fetchOfficial = vi.fn(async () => officialManifest())
    const { controller } = setup({ currentVersion: phase === 'current' ? '1.0.3' : '1.0.2', fetchOfficial })
    expect((await controller.check()).phase).toBe(phase)
    expect(fetchOfficial).not.toHaveBeenCalled()
    controller.dispose()
  })

  it.each(['API', 'manifest', 'timeout'])('uses the official source after a GitHub %s failure', async reason => {
    vi.useFakeTimers()
    const fetchOfficial = vi.fn(async () => officialManifest())
    const fetchGitee = vi.fn(async () => release())
    const { controller, options, updater } = setup({ fetchOfficial, fetchGitee, checkTimeoutMs: 50 })
    if (reason === 'API') options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    else if (reason === 'timeout') options.fetchLatest.mockImplementationOnce(() => new Promise(() => {}))
    else updater.checkForUpdates.mockRejectedValueOnce(new Error('invalid latest.yml'))
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(50)
    expect(await check).toMatchObject({ phase: 'available', release: {
      url: OFFICIAL_DOWNLOAD_URL, canDownload: true,
      notes: reason === 'manifest' ? '# 修复问题' : '',
      publishedAt: reason === 'manifest' ? '2026-09-13T08:00:00Z' : '2026-09-14T08:00:00Z',
    } })
    expect(updater.setFeedURL).toHaveBeenLastCalledWith(expect.objectContaining({ url: OFFICIAL_UPDATE_BASE }))
    expect(fetchGitee).not.toHaveBeenCalled()
    controller.openRelease()
    expect(options.openExternal).toHaveBeenCalledWith(OFFICIAL_DOWNLOAD_URL)
    controller.dispose()
  })

  it('clears a failed GitHub download and verifies the same version from the official source', async () => {
    const fetchOfficial = vi.fn(async () => officialManifest())
    const verifyDownload = vi.fn(async () => undefined)
    const { controller, updater } = setup({ fetchOfficial, verifyDownload })
    const clear = vi.fn(async () => undefined)
    Object.assign(updater, { downloadedUpdateHelper: { clear } })
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('download interrupted'))
    expect(await controller.download()).toMatchObject({ phase: 'downloaded', release: {
      version: '1.0.3', url: OFFICIAL_DOWNLOAD_URL, notes: '# 修复问题', publishedAt: '2026-09-13T08:00:00Z',
    } })
    expect(clear).toHaveBeenCalledBefore(fetchOfficial)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(verifyDownload).toHaveBeenCalledExactlyOnceWith(undefined, manifest().files[0])
    controller.dispose()
  })

  it.each(['1.0.1', '1.0.2', '1.0.4'])('refuses mismatched official version %s during download fallback', async version => {
    const { controller, updater } = setup({ fetchOfficial: async () => officialManifest(version) })
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('download interrupted'))
    expect(await controller.download()).toMatchObject({
      phase: 'error', release: { version: '1.0.3' }, error: '官网备用源尚未同步同一版本的更新文件。',
    })
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('tries Gitee after the official download fails verification', async () => {
    const fetchOfficial = vi.fn(async () => officialManifest())
    const fetchGitee = vi.fn(async () => release())
    const verifyDownload = vi.fn(async () => undefined)
    verifyDownload.mockRejectedValueOnce(new Error('SHA512 checksum mismatch'))
    const { controller, updater } = setup({ fetchOfficial, fetchGitee, verifyDownload })
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('download interrupted'))
    expect(await controller.download()).toMatchObject({ phase: 'downloaded', release: { url: giteeReleaseUrl } })
    expect(fetchOfficial).toHaveBeenCalledBefore(fetchGitee)
    expect(fetchGitee).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), 'v1.0.3')
    expect(verifyDownload).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('rejects redirects to any other origin, even a trusted GitHub host or a supplied staticOrigin', async () => {
    const url = new URL('latest.yml', OFFICIAL_UPDATE_BASE)
    const signal = AbortSignal.timeout(5000)
    const fetchImpl = vi.fn(async () => Response.redirect('https://github.com/other/latest.yml'))
    await expect(fetchOfficialManifest(url, signal, fetchImpl)).rejects.toThrow('不受信任')
    await expect(createUpdateTransport({
      source: 'official', feedUrl: OFFICIAL_UPDATE_BASE, staticOrigin: 'https://github.com',
    }, { fetchImpl }).request()).rejects.toThrow('不受信任')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenLastCalledWith(url, expect.objectContaining({ redirect: 'manual' }))
  })

  it('bounds official metadata reads', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(1024 * 1024 + 1)))
    await expect(fetchOfficialManifest(new URL('latest.yml', OFFICIAL_UPDATE_BASE), AbortSignal.timeout(5000), fetchImpl))
      .rejects.toThrow('数据过大')
  })
})

describe('Gitee update fallback', () => {
  it('keeps GitHub when it is current or has a verified update', async () => {
    const fetchGitee = vi.fn(async () => release())
    for (const currentVersion of ['1.0.2', '1.0.3']) {
      const { controller } = setup({ currentVersion, fetchGitee })
      expect((await controller.check()).phase).toBe(currentVersion === '1.0.2' ? 'available' : 'current')
      controller.dispose()
    }
    expect(fetchGitee).not.toHaveBeenCalled()
  })

  it.each(['network error', 'invalid release', 'timeout'])('uses Gitee latest after GitHub %s', async reason => {
    vi.useFakeTimers()
    const fetchGitee = vi.fn(async () => release())
    const { controller, options } = setup({ fetchGitee, checkTimeoutMs: 50 })
    if (reason === 'timeout') options.fetchLatest.mockImplementationOnce(() => new Promise(() => {}))
    else if (reason === 'network error') options.fetchLatest.mockRejectedValueOnce(new Error('fetch failed'))
    else options.fetchLatest.mockResolvedValueOnce({ ...release(), tag_name: 'v1.0.3-beta.1' })
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(50)
    expect(await check).toMatchObject({ phase: 'available', release: { url: giteeReleaseUrl, version: '1.0.3' } })
    expect(fetchGitee).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), undefined)
    controller.dispose()
  })

  it.each(['missing asset', 'invalid manifest'])('checks the same Gitee tag when GitHub has a %s', async reason => {
    const fetchGitee = vi.fn(async () => release())
    const { controller, updater, options } = setup({ fetchGitee })
    if (reason === 'missing asset') options.fetchLatest.mockResolvedValueOnce({ ...release(), assets: [] })
    else updater.checkForUpdates.mockRejectedValueOnce(new Error('invalid latest.yml'))
    expect(await controller.check()).toMatchObject({ phase: 'available', release: { url: giteeReleaseUrl, canDownload: true } })
    expect(fetchGitee).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), 'v1.0.3')
    controller.dispose()
  })

  it.each(['download failed', 'SHA512 checksum mismatch'])('rechecks the entire Gitee release after %s', async message => {
    const fetchGitee = vi.fn(async () => release())
    const { controller, updater } = setup({ fetchGitee })
    const clear = vi.fn(async () => undefined)
    Object.assign(updater, { downloadedUpdateHelper: { clear } })
    await controller.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error(message))
    expect(await controller.download()).toMatchObject({ phase: 'downloaded', release: { url: giteeReleaseUrl } })
    expect(clear).toHaveBeenCalledBefore(fetchGitee)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('refuses a lagging mirror even when its release is newer than the installed version', async () => {
    const fetchGitee = vi.fn(async () => release())
    const { controller, updater, options } = setup({ fetchGitee })
    options.fetchLatest.mockResolvedValueOnce({ ...release(), tag_name: 'v1.0.4', assets: [] })
    expect(await controller.check()).toMatchObject({ phase: 'available', release: { version: '1.0.4', canDownload: false } })
    expect(fetchGitee).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), 'v1.0.4')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('reports failure when both sources time out', async () => {
    vi.useFakeTimers()
    const pending = () => new Promise(() => {})
    const { controller } = setup({ fetchLatest: pending, fetchGitee: pending, checkTimeoutMs: 50 })
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(100)
    expect(await check).toMatchObject({ phase: 'error', release: null, error: '检查更新超时。' })
    controller.dispose()
  })

  it('never starts the fallback after a cancelled GitHub download', async () => {
    const fetchGitee = vi.fn(async () => release())
    const { controller, updater, token } = setup({ fetchGitee })
    await controller.check()
    updater.downloadUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      token.cancel.mockImplementationOnce(() => reject(new Error('cancelled')))
    }))
    const download = controller.download()
    await Promise.resolve()
    controller.cancel()
    expect(await download).toMatchObject({ phase: 'idle', error: '' })
    expect(fetchGitee).not.toHaveBeenCalled()
    controller.dispose()
  })
})
