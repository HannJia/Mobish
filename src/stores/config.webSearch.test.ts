import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConfigStore } from './config'
import { splitConfig } from '@/services/configSync'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}
const local = storage(), session = storage()
const disk = { value: '' as string | null }

function desktop() {
  const electronAPI = {
    configRead: async () => disk.value,
    configWrite: vi.fn(async (data: string) => { disk.value = data }),
    configEncrypt: vi.fn(async (data: string) => data ? 'enc:' + btoa(data) : ''),
    configDecrypt: async (data: string) => data.startsWith('enc:') ? atob(data.slice(4)) : data,
    configSecurityStatus: async () => ({ encryptionAvailable: true }),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: '' }, electronAPI } })
  return electronAPI
}
function browser() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: undefined, location: { hostname: '' } } })
}

beforeEach(() => {
  local.clear(); session.clear(); disk.value = null
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true })
  setActivePinia(createPinia())
})

describe('flushing settings before exit', () => {
  it('skips encryption and writes after loading, then persists an in-memory edit', async () => {
    const { configEncrypt, configWrite } = desktop()
    disk.value = JSON.stringify({ models: [], assignments: {},
      webSearchService: { provider: 'tavily', apiKey: 'enc:' + btoa('test-key'), count: 4 } })
    const store = useConfigStore()
    expect(await store.loadConfig()).toBe(true)
    await store.flushPendingSaves()
    expect(configEncrypt).not.toHaveBeenCalled()
    expect(configWrite).not.toHaveBeenCalled()

    store.webSearchService.count = 5
    await store.flushPendingSaves()
    expect(configEncrypt).toHaveBeenCalledWith('test-key')
    expect(configWrite).toHaveBeenCalledOnce()
    expect(JSON.parse(disk.value!).webSearchService).toMatchObject({ count: 5, apiKey: 'enc:' + btoa('test-key') })
    configEncrypt.mockClear()
    await store.flushPendingSaves()
    expect(configEncrypt).not.toHaveBeenCalled()
    expect(configWrite).toHaveBeenCalledOnce()
  })

  it('waits for an import and compares the applied settings after the queue drains', async () => {
    const { configEncrypt, configWrite } = desktop()
    const store = useConfigStore()
    await store.loadConfig()
    let release!: () => void
    configWrite.mockImplementationOnce(data => new Promise(resolve => {
      release = () => { disk.value = data; resolve() }
    }))
    const importing = store.importConfig({ models: [], assignments: {}, pdfVisionEnabled: true }, () => true)
    const flushing = store.flushPendingSaves()
    await vi.waitFor(() => expect(configWrite).toHaveBeenCalledOnce())
    expect(store.pdfVisionEnabled).toBe(false)
    configEncrypt.mockClear()
    release()
    await Promise.all([importing, flushing])
    expect(store.pdfVisionEnabled).toBe(true)
    expect(configEncrypt).not.toHaveBeenCalled()
    expect(configWrite).toHaveBeenCalledOnce()
  })

  it('does not cache defaults after a read failure or remember a failed write', async () => {
    const { configWrite } = desktop()
    disk.value = '{'
    const store = useConfigStore()
    expect(await store.loadConfig()).toBe(false)
    configWrite.mockRejectedValueOnce(new Error('写盘失败'))
    await expect(store.flushPendingSaves()).rejects.toThrow('写盘失败')
    await store.flushPendingSaves()
    expect(configWrite).toHaveBeenCalledTimes(2)
    expect(JSON.parse(disk.value!)).toMatchObject({ pdfVisionEnabled: false })
  })
})

describe('独立联网搜索服务设置', () => {
  it('桌面版加密保存搜索服务密钥，重新打开后还原', async () => {
    desktop()
    const store = useConfigStore()
    await store.loadConfig()
    await store.setWebSearchService({ provider: 'tavily', apiKey: 'tvly-secret', baseUrl: '', count: 4, freeFallback: false })
    const saved = JSON.parse(disk.value!)
    expect(saved.webSearchService).toMatchObject({ provider: 'tavily', count: 4 })
    expect(saved.webSearchService.apiKey).toBe('enc:' + btoa('tvly-secret'))
    expect(disk.value).not.toContain('tvly-secret')
    setActivePinia(createPinia())
    const reopened = useConfigStore()
    await reopened.loadConfig()
    expect(reopened.webSearchService).toEqual({ provider: 'tavily', apiKey: 'tvly-secret', baseUrl: '', count: 4, freeFallback: false })
  })

  it('网页版不把搜索服务密钥写入本地存储，只留在本次会话', async () => {
    browser()
    const store = useConfigStore()
    await store.setWebSearchService({ provider: 'bocha', apiKey: 'bocha-secret', baseUrl: '', count: 5, freeFallback: false })
    expect(local.getItem('mojian-v3-config')).not.toContain('bocha-secret')
    expect(session.getItem('mojian-v3-session-secrets')).toContain('bocha-secret')
    setActivePinia(createPinia())
    const reopened = useConfigStore()
    await reopened.loadConfig()
    expect(reopened.webSearchService.apiKey).toBe('bocha-secret')
  })

  it('旧配置没有搜索服务时使用默认值，异常值被纠正', async () => {
    browser()
    local.setItem('mojian-v3-config', JSON.stringify({ models: [], assignments: {}, webSearchService: { provider: 'nope', count: 99 } }))
    const store = useConfigStore()
    await store.loadConfig()
    expect(store.webSearchService).toMatchObject({ provider: 'bocha', count: 10, freeFallback: true })
  })

  it('云端配置不带本机联网方式和搜索服务，旧版本能读', async () => {
    browser()
    const store = useConfigStore()
    store.addModel({ name: 'ds', baseUrl: 'https://api.deepseek.com', apiKey: 'k', modelName: 'deepseek-chat', maxTokens: 4096, temperature: 0.7, topP: 0.9,
      chatSearchProtocol: 'auto', searchAdapter: 'search-service' })
    await store.setWebSearchService({ provider: 'tavily', apiKey: 'tvly', baseUrl: '', count: 5, freeFallback: false })
    const { settings } = splitConfig(store.exportConfig(), 'fanqie')
    expect(settings.models[0]).not.toHaveProperty('searchAdapter')
    expect(settings.models[0].chatSearchProtocol).toBe('auto')
    expect(JSON.stringify(settings)).not.toContain('webSearchService')
  })

  it('从云端恢复配置时保留本机的搜索服务', async () => {
    browser()
    const store = useConfigStore()
    await store.setWebSearchService({ provider: 'zhipu', apiKey: 'zp', baseUrl: '', count: 3, freeFallback: false })
    await store.importConfig({ models: [], assignments: {} }, () => true)
    expect(store.webSearchService).toMatchObject({ provider: 'zhipu', apiKey: 'zp', count: 3, freeFallback: false })
  })
})
