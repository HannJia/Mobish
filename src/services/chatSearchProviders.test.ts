import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { chatWithOptionalSearch, parseSearchResponse, resolveChatSearchMode, resolveChatSearchProtocol, searchProtocolDescription } from './chatSearch'
import { autoSearchAdapter, detectModelProvider, EMBEDDING_PROVIDER_PRESETS, isEmbeddingModelName, MODEL_PROVIDER_PRESETS } from './modelProviders'
import { buildWebSearchRequest, isWebSearchServiceConfigured, parseWebSearchResults, resolveBaseUrl, SEARCH_TIMEOUT_MS, searchContextMessage, searchWeb, searchWebWithFallback } from './webSearchService'
import { useConfigStore, type ModelConfig } from '@/stores/config'

const requireLocal = createRequire(path.resolve('app-main/main.js'))
const { validateWebSearchRequest, createWebSearchProxy } = requireLocal('./webSearchProxy.cjs')

const base: ModelConfig = { id: 'm', name: 'm', baseUrl: 'https://relay.example/v1', apiKey: 'synthetic-key', modelName: 'model-x', temperature: 0.7, topP: 0.9, maxTokens: 800 }
const messages = [{ role: 'system' as const, content: '你是写作助手' }, { role: 'user' as const, content: '查一下宋代的驿站制度' }]
const signal = () => new AbortController().signal

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe('official provider presets', () => {
  it('uses the same SiliconFlow registration link and disclosure for writing and embeddings', () => {
    const embedding = EMBEDDING_PROVIDER_PRESETS.find(item => item.id === 'siliconflow')
    const writing = MODEL_PROVIDER_PRESETS.find(item => item.id === 'siliconflow')
    expect(writing?.signupUrl).toBe('https://cloud.siliconflow.cn/i/KSMskNN6')
    expect(writing?.signupUrl).toBe(embedding?.signupUrl)
    expect(writing?.signupNote).toContain('作者的邀请链接')
    expect(writing?.signupNote).toBe(embedding?.signupNote)
  })

  it('recognizes official hosts and leaves relays alone', () => {
    expect(detectModelProvider('https://api.deepseek.com')?.id).toBe('deepseek')
    expect(detectModelProvider('https://dashscope.aliyuncs.com/compatible-mode/v1')?.id).toBe('qwen')
    expect(detectModelProvider('https://open.bigmodel.cn/api/paas/v4')?.id).toBe('zhipu')
    expect(detectModelProvider('https://ark.cn-beijing.volces.com/api/v3')?.id).toBe('doubao')
    expect(detectModelProvider('https://generativelanguage.googleapis.com/v1beta/openai')?.id).toBe('gemini')
    expect(detectModelProvider('https://relay.example/v1')).toBeNull()
    expect(detectModelProvider('https://evil-deepseek.com.example')).toBeNull()
    expect(MODEL_PROVIDER_PRESETS.filter(item => item.region === 'domestic').map(item => item.id)).toEqual(['deepseek', 'qwen', 'kimi', 'zhipu', 'doubao', 'siliconflow', 'minimax', 'hunyuan'])
    expect(MODEL_PROVIDER_PRESETS.filter(item => item.region === 'local').map(item => item.id)).toEqual(['ollama', 'lmstudio'])
    expect(detectModelProvider('http://127.0.0.1:11434/v1')?.id).toBe('ollama')
    expect(detectModelProvider('https://api.siliconflow.cn/v1')?.id).toBe('siliconflow')
    expect(isEmbeddingModelName('BAAI/bge-m3')).toBe(true)
    expect(isEmbeddingModelName('BAAI/bge-reranker-v2-m3')).toBe(false)
    expect(isEmbeddingModelName('deepseek-ai/DeepSeek-V3')).toBe(false)
  })

  it('picks the documented search mode for each official host in auto mode', () => {
    expect(autoSearchAdapter('https://api.deepseek.com')).toBe('search-service')
    expect(autoSearchAdapter('https://api.moonshot.cn/v1')).toBe('search-service')
    for (const modelName of ['deepseek-v4.1-flash', 'deepseek-flash', 'DeepSeek-R1', 'kimi-k2', 'moonshot-v1-8k', 'gemini-2.5-pro', 'google/gemini-3-flash']) {
      expect(resolveChatSearchMode({ ...base, baseUrl: 'https://relay.example.com/v1', modelName })).toBe('search-service')
    }
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://openrouter.ai/api/v1', modelName: 'deepseek/deepseek-chat' })).toBe('openrouter')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://relay.example.com/v1', modelName: 'deepseek-chat', chatSearchProtocol: 'responses' })).toBe('responses')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://relay.example.com/v1', modelName: 'gpt-5' })).toBe('responses')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://relay.example.com/v1', modelName: 'gemini-2.5-pro', searchAdapter: 'gemini' })).toBe('gemini')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })).toBe('qwen')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })).toBe('zhipu')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' })).toBe('responses')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://api.anthropic.com/v1' })).toBe('anthropic')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' })).toBe('gemini')
    // 本机选择优先，其次是随云端同步的旧协议值
    expect(resolveChatSearchMode({ ...base, searchAdapter: 'search-service', chatSearchProtocol: 'responses' })).toBe('search-service')
    expect(resolveChatSearchMode({ ...base, baseUrl: 'https://api.deepseek.com', chatSearchProtocol: 'chat-completions' })).toBe('chat-completions')
  })

  it('records only protocol values older clients accept', () => {
    expect(resolveChatSearchProtocol({ ...base, searchAdapter: 'gemini' })).toBe('chat-completions')
    expect(parseSearchResponse({ choices: [{ message: { content: '答' } }], web_search: [] }, 'zhipu').search.protocol).toBe('chat-completions')
  })
})

describe('built-in search adapters', () => {
  it('sends Qwen enable_search and reads its sources', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '驿站由兵部管理。' }, finish_reason: 'stop' }],
      search_info: { search_results: [{ index: 1, title: '宋代驿传', url: 'https://example.org/song' }] },
    })))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, messages, webSearch: true, signal: signal() })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({ enable_search: true, search_options: { enable_source: true } })
    expect(result.search).toMatchObject({ status: 'searched', sources: [{ url: 'https://example.org/song', title: '宋代驿传' }] })
  })

  it('sends the Zhipu web_search tool to the v4 address and reads web_search results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '急递铺负责传递。' } }],
      web_search: [{ title: '急递铺', link: 'https://example.org/pu', content: '宋代设急递铺' }],
    })))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, messages, webSearch: true, signal: signal() })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(JSON.parse(String(init.body)).tools[0]).toMatchObject({ type: 'web_search', web_search: { enable: true, search_result: true } })
    expect(result.search?.sources[0]).toMatchObject({ url: 'https://example.org/pu', excerpt: '宋代设急递铺' })
  })

  it('calls Gemini generateContent with google_search and reads grounding chunks', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '马递每日' }, { text: '五百里。' }] }, finishReason: 'STOP',
        groundingMetadata: { webSearchQueries: ['宋代 驿站'], groundingChunks: [{ web: { uri: 'https://example.org/g', title: 'example.org' } }] } }],
    })))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelName: 'models/gemini-test' }, messages, webSearch: true, signal: signal() })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent')
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('synthetic-key')
    expect(headers.Authorization).toBeUndefined()
    const body = JSON.parse(String(init.body))
    expect(body.tools).toEqual([{ google_search: {} }])
    expect(body.systemInstruction.parts[0].text).toBe('你是写作助手')
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '查一下宋代的驿站制度' }] }])
    expect(result.content).toBe('马递每日五百里。')
    expect(result.search).toMatchObject({ status: 'searched', sources: [{ url: 'https://example.org/g' }] })
  })
})

describe('independent search service', () => {
  it('builds documented requests and rejects addresses outside the service', () => {
    const bocha = buildWebSearchRequest({ provider: 'bocha', apiKey: 'k', baseUrl: '', count: 3, freeFallback: false }, '驿站')
    expect(bocha).toMatchObject({ method: 'POST', url: 'https://api.bochaai.com/v1/web-search' })
    expect(JSON.parse(bocha.body!)).toEqual({ query: '驿站', count: 3, summary: true, freshness: 'noLimit' })
    expect(buildWebSearchRequest({ provider: 'zhipu', apiKey: 'k', baseUrl: '', count: 5, freeFallback: false }, 'q').url).toBe('https://open.bigmodel.cn/api/paas/v4/web_search')
    expect(buildWebSearchRequest({ provider: 'tavily', apiKey: 'k', baseUrl: '', count: 5, freeFallback: false }, 'q').url).toBe('https://api.tavily.com/search')
    expect(buildWebSearchRequest({ provider: 'searxng', apiKey: '', baseUrl: 'http://127.0.0.1:8888/', count: 5, freeFallback: false }, '驿 站').url).toBe('http://127.0.0.1:8888/search?q=%E9%A9%BF+%E7%AB%99&format=json')
    expect(resolveBaseUrl({ provider: 'bocha', baseUrl: 'https://attacker.example' })).toBe('')
    expect(resolveBaseUrl({ provider: 'zhipu', baseUrl: 'https://api.z.ai' })).toBe('https://api.z.ai')
    expect(isWebSearchServiceConfigured({ provider: 'tavily', apiKey: '', baseUrl: '', count: 5, freeFallback: false })).toBe(false)
    expect(isWebSearchServiceConfigured({ provider: 'searxng', apiKey: '', baseUrl: 'http://127.0.0.1:8888', count: 5, freeFallback: false })).toBe(true)
  })

  it('parses each service and drops unsafe links', () => {
    expect(parseWebSearchResults('bocha', { data: { webPages: { value: [{ name: '甲', url: 'https://a.example/1', summary: '摘要' }, { name: '坏', url: 'javascript:alert(1)' }] } } }))
      .toEqual([{ title: '甲', url: 'https://a.example/1', excerpt: '摘要' }])
    expect(parseWebSearchResults('tavily', { results: [{ title: '乙', url: 'https://b.example/', content: '内容' }] })[0].url).toBe('https://b.example/')
    expect(parseWebSearchResults('zhipu', { search_result: [{ title: '丙', link: 'https://c.example/', content: '片段' }] })[0].excerpt).toBe('片段')
    expect(searchContextMessage('驿站', [{ title: '甲', url: 'https://a.example/1' }])).toContain('[1] 甲\nhttps://a.example/1')
  })

  it('searches first, then gives the results to the configured model', async () => {
    const config = useConfigStore()
    Object.assign(config.webSearchService, { provider: 'tavily', apiKey: 'tvly-synthetic', baseUrl: '', count: 2, freeFallback: false })
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.tavily.com/search') return new Response(JSON.stringify({ results: [{ title: '驿站考', url: 'https://example.org/yi', content: '宋代驿站分三等' }] }))
      const body = JSON.parse(String(init?.body))
      expect(body.messages[1]).toMatchObject({ role: 'system' })
      expect(body.messages[1].content).toContain('https://example.org/yi')
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: '查一下宋代的驿站制度' })
      return new Response(JSON.stringify({ choices: [{ message: { content: '根据 [1]，驿站分三等。' }, finish_reason: 'stop' }] }))
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://api.deepseek.com' }, messages, webSearch: true, stream: false, signal: signal() })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('根据 [1]，驿站分三等。')
    expect(result.search).toMatchObject({ protocol: 'chat-completions', status: 'searched', sources: [{ url: 'https://example.org/yi' }] })
    expect(searchProtocolDescription({ ...base, baseUrl: 'https://api.deepseek.com' })).toBe('自动识别：独立搜索服务 · Tavily')
  })

  it('stops with a clear message when the search service has no key and fallback is off', async () => {
    Object.assign(useConfigStore().webSearchService, { provider: 'bocha', apiKey: '', baseUrl: '', count: 5, freeFallback: false })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://api.deepseek.com' }, messages, webSearch: true, signal: signal() }))
      .rejects.toThrow('填写博查搜索的 API 密钥')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('search service defaults and fallback (1.1.3)', () => {
  const firecrawlBody = { success: true, data: { web: [{ url: 'https://example.org/fc', title: '驿传志', description: '宋代驿传', position: 1 }] } }
  const bochaBody = { data: { webPages: { value: [{ name: '驿站考', url: 'https://example.org/bc', summary: '宋代驿站' }] } } }
  const modelReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))

  it('builds the keyless Firecrawl request and reads its web results', () => {
    const keyless = buildWebSearchRequest({ provider: 'firecrawl', apiKey: '', baseUrl: '', count: 4, freeFallback: true }, '驿站')
    expect(keyless).toMatchObject({ method: 'POST', url: 'https://api.firecrawl.dev/v2/search' })
    expect(keyless.headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(keyless.body!)).toEqual({ query: '驿站', limit: 4 })
    expect(buildWebSearchRequest({ provider: 'firecrawl', apiKey: 'fc-k', baseUrl: '', count: 4, freeFallback: true }, 'q').headers.Authorization).toBe('Bearer fc-k')
    expect(parseWebSearchResults('firecrawl', firecrawlBody)).toEqual([{ url: 'https://example.org/fc', title: '驿传志', excerpt: '宋代驿传' }])
  })

  it('does not use Firecrawl unless chosen, and guides the user when no service is set up', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(useConfigStore().webSearchService.provider).toBe('bocha')
    await expect(chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://api.deepseek.com' }, messages, webSearch: true, stream: false, signal: signal() }))
      .rejects.toThrow('通义、智谱、豆包模型可以直接用自带的搜索')
    expect(fetcher).not.toHaveBeenCalled()
    expect(searchProtocolDescription({ ...base, baseUrl: 'https://api.deepseek.com' })).toBe('自动识别：独立搜索服务 · 未设置')
  })

  it('uses Firecrawl when chosen and explains that it needs an overseas network when unreachable', async () => {
    Object.assign(useConfigStore().webSearchService, { provider: 'firecrawl', apiKey: '', baseUrl: '' })
    const fetcher = vi.fn(async (url: string) => url.includes('firecrawl') ? new Response(JSON.stringify(firecrawlBody)) : modelReply('见 [1]。'))
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, baseUrl: 'https://api.deepseek.com' }, messages, webSearch: true, stream: false, signal: signal() })
    expect(result.search?.sources[0].url).toBe('https://example.org/fc')
    fetcher.mockImplementation(async () => { throw new TypeError('fetch failed') })
    await expect(searchWebWithFallback(useConfigStore().webSearchService, '驿站', signal())).rejects.toThrow('需要境外网络')
  })

  it('times out a browser request that never answers', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })))
      const pending = searchWebWithFallback({ provider: 'bocha', apiKey: 'k', baseUrl: '', count: 3, freeFallback: true }, '驿站', signal())
      const check = expect(pending).rejects.toThrow('30 秒内没有响应')
      await vi.advanceTimersByTimeAsync(30_000)
      await check
    } finally { vi.useRealTimers() }
  })

  it('retries through a configured search service when built-in search fails, without sending the model key to it', async () => {
    Object.assign(useConfigStore().webSearchService, { provider: 'bocha', apiKey: 'bocha-k', freeFallback: true })
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/responses')) return new Response('{}', { status: 400 })
      if (url.includes('bochaai')) {
        expect(JSON.stringify(init?.headers)).not.toContain('synthetic-key')
        return new Response(JSON.stringify(bochaBody))
      }
      return modelReply('根据 [1]。')
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await chatWithOptionalSearch({ model: { ...base, modelName: 'gpt-5' }, messages, webSearch: true, stream: false, signal: signal() })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://relay.example/v1/responses', 'https://api.bochaai.com/v1/web-search', 'https://relay.example/v1/chat/completions'])
    expect(result.content).toBe('根据 [1]。')
    expect(result.fallback).toMatch(/^模型内置搜索失败（.+），已改用博查搜索$/)
  })

  it('keeps the built-in result or error when no search service is configured or fallback is off', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/responses')
      ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '凭记忆回答' }] }] }))
      : modelReply('有来源的回答'))
    vi.stubGlobal('fetch', fetcher)
    // 默认博查未填密钥：不改用，保留内置结果
    const plain = await chatWithOptionalSearch({ model: { ...base, modelName: 'gpt-5' }, messages, webSearch: true, stream: false, signal: signal() })
    expect(plain.content).toBe('凭记忆回答')
    expect(fetcher).toHaveBeenCalledTimes(1)
    Object.assign(useConfigStore().webSearchService, { apiKey: 'bocha-k', freeFallback: false })
    fetcher.mockImplementation(async () => new Response('{}', { status: 400 }))
    await expect(chatWithOptionalSearch({ model: { ...base, modelName: 'gpt-5' }, messages, webSearch: true, stream: false, signal: signal() }))
      .rejects.toThrow('HTTP_400')
  })
})

describe('main-process search proxy', () => {
  it('aborts a forwarded request and times out browser requests with a distinct message', async () => {
    const pendingFetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    const cancel = new AbortController()
    const config = { provider: 'searxng' as const, apiKey: '', baseUrl: 'http://127.0.0.1:8888', count: 2, freeFallback: false }
    const proxy = createWebSearchProxy(pendingFetch)
    const forwarded = proxy(buildWebSearchRequest(config, 'test'), cancel.signal)
    const stopped = expect(forwarded).rejects.toMatchObject({ name: 'AbortError' })
    cancel.abort()
    await stopped

    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', pendingFetch)
      const timedOut = expect(searchWeb(config, 'test', signal())).rejects.toMatchObject({ code: 'SEARCH_SERVICE_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS)
      await timedOut
    } finally { vi.useRealTimers() }
  })

  it('only forwards fixed service endpoints and SearXNG JSON queries', () => {
    const ok = { provider: 'bocha', method: 'POST', url: 'https://api.bochaai.com/v1/web-search', headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, body: '{}' }
    expect(validateWebSearchRequest(ok).url).toBe('https://api.bochaai.com/v1/web-search')
    expect(() => validateWebSearchRequest({ ...ok, url: 'https://attacker.example/v1/web-search' })).toThrow('不属于所选服务')
    expect(() => validateWebSearchRequest({ ...ok, url: 'https://api.bochaai.com/v1/other' })).toThrow('不属于所选服务')
    expect(() => validateWebSearchRequest({ ...ok, headers: { Cookie: 'a=b' } })).toThrow('请求头无效')
    expect(() => validateWebSearchRequest({ ...ok, provider: 'shell' })).toThrow('不支持')
    expect(validateWebSearchRequest({ provider: 'searxng', method: 'GET', url: 'http://127.0.0.1:8888/search?q=a&format=json', headers: {} }).method).toBe('GET')
    expect(() => validateWebSearchRequest({ provider: 'searxng', method: 'GET', url: 'http://127.0.0.1:8888/admin?format=json', headers: {} })).toThrow('SearXNG')
    expect(validateWebSearchRequest({ provider: 'firecrawl', method: 'POST', url: 'https://api.firecrawl.dev/v2/search', headers: {}, body: '{}' }).url).toBe('https://api.firecrawl.dev/v2/search')
    expect(() => validateWebSearchRequest({ provider: 'firecrawl', method: 'POST', url: 'https://api.firecrawl.dev/v2/scrape', headers: {}, body: '{}' })).toThrow('不属于所选服务')
  })

  it('returns status and text from the forwarded request', async () => {
    const proxy = createWebSearchProxy(async () => new Response('{"results":[]}', { status: 200 }))
    await expect(proxy({ provider: 'tavily', method: 'POST', url: 'https://api.tavily.com/search', headers: {}, body: '{}' }))
      .resolves.toEqual({ ok: true, status: 200, text: '{"results":[]}' })
  })
})
