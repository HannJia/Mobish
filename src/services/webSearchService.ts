// 独立联网搜索服务：先用搜索服务查网页，再把结果交给当前模型回答。
// 适用于官方接口没有内置联网搜索的模型（如 DeepSeek），也可以给任何模型使用。
// 1.1.3 起默认服务为博查（国内可用，需要密钥）；Firecrawl 需境外网络，只在用户手动选择时使用。
import type { ChatSource } from '@/types/chat'

export type WebSearchProvider = 'firecrawl' | 'tavily' | 'bocha' | 'zhipu' | 'searxng'

export interface WebSearchServiceConfig {
  provider: WebSearchProvider
  apiKey: string
  /** 搜索服务地址；SearXNG 必填，其他服务可改用官方备用域名。 */
  baseUrl: string
  /** 每次返回的结果条数。 */
  count: number
  /** 模型自带的搜索出错或没有搜到时，改用这里的搜索服务（需已配置可用）。字段名沿用旧版。 */
  freeFallback: boolean
}

export interface WebSearchProviderInfo {
  label: string
  defaultBaseUrl: string
  /** 允许的主机；空数组表示用户自建（SearXNG）。 */
  hosts: string[]
  needsKey: boolean
  note: string
}

export const WEB_SEARCH_PROVIDERS: Record<WebSearchProvider, WebSearchProviderInfo> = {
  bocha: { label: '博查搜索', defaultBaseUrl: 'https://api.bochaai.com', hosts: ['api.bochaai.com', 'api.bocha.cn'], needsKey: true,
    note: '国内网页搜索服务，在博查开放平台申请 API 密钥。' },
  zhipu: { label: '智谱网络搜索', defaultBaseUrl: 'https://open.bigmodel.cn', hosts: ['open.bigmodel.cn', 'api.z.ai'], needsKey: true,
    note: '使用智谱开放平台的 API 密钥，与 GLM 模型可以共用。' },
  tavily: { label: 'Tavily', defaultBaseUrl: 'https://api.tavily.com', hosts: ['api.tavily.com'], needsKey: true,
    note: '海外网页搜索服务，在 Tavily 官网申请 API 密钥。' },
  searxng: { label: 'SearXNG（自建）', defaultBaseUrl: '', hosts: [], needsKey: false,
    note: '填写自建 SearXNG 的地址，需要在其设置中开启 JSON 输出。' },
  firecrawl: { label: 'Firecrawl（需境外网络）', defaultBaseUrl: 'https://api.firecrawl.dev', hosts: ['api.firecrawl.dev'], needsKey: false,
    note: '需要能访问境外网络（如代理），国内网络通常无法直接连接。不填密钥也能用，按网络地址每日限量；搜索词会发送到 Firecrawl（美国）。' },
}

export const DEFAULT_WEB_SEARCH_SERVICE: WebSearchServiceConfig = { provider: 'bocha', apiKey: '', baseUrl: '', count: 5, freeFallback: true }

export class WebSearchServiceError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WebSearchServiceError' }
}

export interface WebSearchHttpRequest {
  provider: WebSearchProvider
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const str = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function isWebSearchServiceConfigured(config: WebSearchServiceConfig | undefined | null): boolean {
  if (!config || !WEB_SEARCH_PROVIDERS[config.provider]) return false
  if (!WEB_SEARCH_PROVIDERS[config.provider].needsKey) return Boolean(resolveBaseUrl(config))
  return Boolean(config.apiKey.trim())
}

/** 实际会使用的搜索服务名称。 */
export function effectiveWebSearchLabel(config: WebSearchServiceConfig | undefined | null): string {
  if (config && isWebSearchServiceConfigured(config)) return WEB_SEARCH_PROVIDERS[config.provider].label
  return '未设置'
}

/** 校验并返回实际使用的服务地址；地址无效或不属于该服务时返回空字符串。 */
export function resolveBaseUrl(config: Pick<WebSearchServiceConfig, 'provider' | 'baseUrl'>): string {
  const info = WEB_SEARCH_PROVIDERS[config.provider]
  const raw = (config.baseUrl.trim() || info.defaultBaseUrl).replace(/\/+$/, '')
  let url: URL
  try { url = new URL(raw) } catch { return '' }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''
  if (info.hosts.length && (url.protocol !== 'https:' || !info.hosts.includes(url.hostname.toLowerCase()) || (url.pathname !== '/' && url.pathname !== ''))) return ''
  return raw
}

export function buildWebSearchRequest(config: WebSearchServiceConfig, query: string): WebSearchHttpRequest {
  const base = resolveBaseUrl(config)
  if (!base) throw new WebSearchServiceError('INVALID_URL', config.provider === 'searxng' ? '请填写有效的 SearXNG 地址。' : '搜索服务地址无效，请恢复为官方地址。')
  const count = Math.max(1, Math.min(10, Math.round(config.count) || 5))
  const json = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const auth = { Authorization: `Bearer ${config.apiKey.trim()}` }
  switch (config.provider) {
    case 'firecrawl':
      return { provider: 'firecrawl', method: 'POST', url: `${base}/v2/search`,
        headers: { ...json, ...(config.apiKey.trim() ? auth : {}) }, body: JSON.stringify({ query, limit: count }) }
    case 'tavily':
      return { provider: 'tavily', method: 'POST', url: `${base}/search`, headers: { ...json, ...auth }, body: JSON.stringify({ query, max_results: count, search_depth: 'basic' }) }
    case 'bocha':
      return { provider: 'bocha', method: 'POST', url: `${base}/v1/web-search`, headers: { ...json, ...auth }, body: JSON.stringify({ query, count, summary: true, freshness: 'noLimit' }) }
    case 'zhipu':
      return { provider: 'zhipu', method: 'POST', url: `${base}/api/paas/v4/web_search`, headers: { ...json, ...auth }, body: JSON.stringify({ search_query: query, search_engine: 'search_std', count }) }
    case 'searxng': {
      const url = new URL(`${base}/search`)
      url.searchParams.set('q', query); url.searchParams.set('format', 'json')
      return { provider: 'searxng', method: 'GET', url: url.href, headers: { Accept: 'application/json' } }
    }
  }
}

function source(url: unknown, title: unknown, excerpt: unknown): ChatSource | null {
  const href = str(url)
  try {
    const parsed = new URL(href)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    const text = str(excerpt)
    return { url: parsed.href, title: (str(title) || parsed.hostname).slice(0, 300), excerpt: text ? text.slice(0, 500) : undefined }
  } catch { return null }
}

export function parseWebSearchResults(provider: WebSearchProvider, raw: unknown): ChatSource[] {
  const data = object(raw)
  let rows: Array<ChatSource | null> = []
  if (provider === 'firecrawl') {
    rows = array(object(data.data).web).map(item => { const row = object(item); return source(row.url, row.title, row.description) })
  } else if (provider === 'tavily' || provider === 'searxng') {
    rows = array(data.results).map(item => { const row = object(item); return source(row.url, row.title, row.content) })
  } else if (provider === 'bocha') {
    const pages = object(object(data.data).webPages).value ?? object(data.webPages).value
    rows = array(pages).map(item => { const row = object(item); return source(row.url, row.name, row.summary || row.snippet) })
  } else {
    rows = array(data.search_result).map(item => { const row = object(item); return source(row.link, row.title, row.content) })
  }
  const unique = new Map<string, ChatSource>()
  for (const row of rows) if (row && !unique.has(row.url)) unique.set(row.url, row)
  return [...unique.values()].slice(0, 10)
}

function httpError(status: number, label: string): WebSearchServiceError {
  const reason = status === 401 || status === 403 ? `${label} 拒绝了请求，请检查搜索服务的 API 密钥和权限。`
    : status === 402 || status === 429 ? `${label} 的额度不足或请求太频繁，请稍后重试或检查余额。`
    : status >= 500 ? `${label} 暂时异常，请稍后重试。`
    : `${label} 不接受这次搜索请求（HTTP ${status}），请检查搜索服务设置。`
  return new WebSearchServiceError(`SEARCH_SERVICE_HTTP_${status}`, reason)
}

interface WebSearchResponse { ok: boolean; status: number; text: string }

export const SEARCH_TIMEOUT_MS = 30_000

async function send(request: WebSearchHttpRequest, signal: AbortSignal): Promise<WebSearchResponse> {
  signal.throwIfAborted()
  // 桌面版经主进程转发，避免搜索服务不支持跨域时请求失败；浏览器版直接请求。
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new WebSearchServiceError('SEARCH_SERVICE_TIMEOUT', '搜索服务 30 秒内没有响应，请检查网络或换用其他搜索服务。')), SEARCH_TIMEOUT_MS)
  const requestSignal = AbortSignal.any([signal, timeout.signal])
  try {
    const desktop = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (desktop?.webSearchRequest) {
      const id = crypto.randomUUID()
      let stop: (() => void) | undefined
      const cancelled = new Promise<never>((_, reject) => {
        stop = () => {
          desktop.webSearchCancel?.(id)
          reject(requestSignal.reason)
        }
        requestSignal.addEventListener('abort', stop, { once: true })
      })
      try { return await Promise.race([desktop.webSearchRequest(request, id), cancelled]) }
      finally { if (stop) requestSignal.removeEventListener('abort', stop) }
    }
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: requestSignal })
    return { ok: response.ok, status: response.status, text: await response.text() }
  } catch (error) {
    if (!signal.aborted && timeout.signal.reason instanceof WebSearchServiceError) throw timeout.signal.reason
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** 调用搜索服务，返回来源列表；失败时抛出带中文说明的错误。 */
export async function searchWeb(config: WebSearchServiceConfig, query: string, signal: AbortSignal): Promise<ChatSource[]> {
  const info = WEB_SEARCH_PROVIDERS[config.provider]
  if (!info) throw new WebSearchServiceError('NO_SERVICE', '请先在设置中选择联网搜索服务。')
  if (info.needsKey && !config.apiKey.trim()) throw new WebSearchServiceError('NO_KEY', `这个模型需要借助搜索服务联网：请在“设置 → 联网搜索”填写${info.label}的 API 密钥（也可以换其他服务）；通义、智谱、豆包模型可以直接用自带的搜索。`)
  if (config.apiKey.startsWith('enc:') || config.apiKey.includes('***')) throw new WebSearchServiceError('BAD_KEY', '搜索服务的 API 密钥是密文或遮蔽文本，请重新填写。')
  const trimmed = query.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!trimmed) throw new WebSearchServiceError('EMPTY_QUERY', '没有可搜索的问题内容。')
  const request = buildWebSearchRequest(config, trimmed)
  let response: WebSearchResponse
  try { response = await send(request, signal) }
  catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof WebSearchServiceError) throw error
    throw new WebSearchServiceError('SEARCH_SERVICE_CONNECTION_FAILED', config.provider === 'firecrawl'
      ? '没有连上 Firecrawl。它需要境外网络，国内网络通常无法使用；可以在“设置 → 联网搜索”改用博查或智谱，或使用通义、智谱、豆包模型自带的搜索。'
      : `没有连上${info.label}，请检查网络或服务地址。`)
  }
  if (!response.ok) throw httpError(response.status, info.label)
  let data: unknown
  try { data = JSON.parse(response.text) } catch { throw new WebSearchServiceError('SEARCH_SERVICE_BAD_RESPONSE', `${info.label} 返回的内容无法识别。`) }
  return parseWebSearchResults(config.provider, data)
}

export interface WebSearchOutcome {
  sources: ChatSource[]
  provider: WebSearchProvider
  /** 改用免费搜索的原因；未改用时为空。 */
  fallbackReason?: string
}

/** 按设置搜索。1.1.3 起不再自动改用 Firecrawl（国内网络通常连不上），只使用用户配置的服务。 */
export async function searchWebWithFallback(config: WebSearchServiceConfig, query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  return { sources: await searchWeb(config, query, signal), provider: config.provider }
}

/** 把搜索结果整理成交给模型的参考资料。 */
export function searchContextMessage(query: string, sources: ChatSource[]): string {
  const lines = sources.map((item, index) => `[${index + 1}] ${item.title}\n${item.url}${item.excerpt ? `\n${item.excerpt}` : ''}`)
  return [
    `以下是针对“${query}”的联网搜索结果，供回答参考。`,
    '回答时只使用与问题相关的内容；引用某条结果时用 [编号] 标注；搜索结果与问题无关或不足以回答时，请如实说明。',
    '',
    ...lines,
  ].join('\n')
}
