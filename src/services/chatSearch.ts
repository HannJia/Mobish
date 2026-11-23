import { callAI, openAiV1BaseUrl, type ChatMessage } from '@/services/ai'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import type { ChatSearchProtocol, ChatSearchRecord, ChatSource } from '@/types/chat'
import { finishAiActivity, startAiActivity } from './aiActivity'
import { autoSearchAdapter, type ChatSearchAdapter } from './modelProviders'
import { readSearchPayload, SearchResponseError as SearchError } from './searchResponse'
import { effectiveWebSearchLabel, isWebSearchServiceConfigured, searchContextMessage, searchWebWithFallback, WEB_SEARCH_PROVIDERS, WebSearchServiceError } from './webSearchService'

type ResolvedProtocol = Exclude<ChatSearchProtocol, 'auto'>
/** 实际使用的联网方式：原有的四种协议，加上通义、智谱、Gemini 与独立搜索服务。 */
export type ChatSearchMode = ResolvedProtocol | ChatSearchAdapter
type SearchModel = Pick<ModelConfig, 'baseUrl' | 'modelName' | 'chatSearchProtocol' | 'searchAdapter'>

const ADAPTERS: ChatSearchAdapter[] = ['qwen', 'zhipu', 'gemini', 'search-service']

// 设置页的联网方式选项。原有四种协议随云端配置同步；新增的方式只保存在本机，
// 其他设备在“自动”下按官方接口地址识别出同样的方式。
export const chatSearchModeOptions: Array<{ label: string; value: ChatSearchProtocol | ChatSearchAdapter }> = [
  { label: '自动（按接口地址识别）', value: 'auto' },
  { label: '独立搜索服务（先搜索，再交给模型）', value: 'search-service' },
  { label: 'OpenAI / 火山方舟 Responses 网页搜索', value: 'responses' },
  { label: 'Claude 消息接口网页搜索', value: 'anthropic' },
  { label: 'Gemini Google 搜索', value: 'gemini' },
  { label: '通义千问联网搜索', value: 'qwen' },
  { label: '智谱网络搜索', value: 'zhipu' },
  { label: 'OpenRouter 网页插件', value: 'openrouter' },
  { label: '聊天补全搜索专用模型', value: 'chat-completions' },
]
/** 把设置页选择的联网方式拆成随云端同步的协议值和只存本机的方式。 */
export function splitSearchMode(value: ChatSearchProtocol | ChatSearchAdapter): { chatSearchProtocol: ChatSearchProtocol; searchAdapter: ChatSearchAdapter | undefined } {
  return (ADAPTERS as string[]).includes(value)
    ? { chatSearchProtocol: 'auto', searchAdapter: value as ChatSearchAdapter }
    : { chatSearchProtocol: value as ChatSearchProtocol, searchAdapter: undefined }
}
/** @deprecated 保留给旧代码引用，等同于 chatSearchModeOptions。 */
export const chatSearchProtocolOptions = chatSearchModeOptions

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const modeInfo: Record<ChatSearchMode, { label: string; path: string }> = {
  responses: { label: 'Responses', path: '/responses' },
  anthropic: { label: 'Claude Messages', path: '/messages' },
  openrouter: { label: 'OpenRouter', path: '/chat/completions' },
  'chat-completions': { label: 'Chat Completions', path: '/chat/completions' },
  qwen: { label: '通义千问联网搜索', path: '/chat/completions' },
  zhipu: { label: '智谱网络搜索', path: '/chat/completions' },
  gemini: { label: 'Gemini Google 搜索', path: ':generateContent' },
  'search-service': { label: '独立搜索服务', path: '先搜索再回答' },
}

/** 对话记录里的协议字段必须是旧版本也认识的值，新增方式按其请求格式归入 chat-completions。 */
function recordProtocol(mode: ChatSearchMode): ResolvedProtocol {
  return (ADAPTERS as string[]).includes(mode) ? 'chat-completions' : mode as ResolvedProtocol
}

export function searchProtocolDescription(model: SearchModel): string {
  const mode = resolveChatSearchMode(model)
  const { label, path } = modeInfo[mode]
  const chosen = model.searchAdapter || (model.chatSearchProtocol && model.chatSearchProtocol !== 'auto')
  if (mode === 'search-service') {
    return `${chosen ? '已选择' : '自动识别'}：${label} · ${effectiveWebSearchLabel(useConfigStore().webSearchService)}`
  }
  return `${chosen ? '已选择' : '自动推测'}：${label} · ${path}`
}

function httpSearchError(status: number, mode: ChatSearchMode): SearchError {
  const { label, path } = modeInfo[mode]
  const reason = status === 401 ? '搜索接口未通过身份验证。普通对话可用，不一定说明搜索接口也接受同一密钥。'
    : status === 403 ? '搜索接口拒绝访问，请确认服务商的搜索权限、模型权限及访问限制。'
    : [400, 404, 405, 422].includes(status)
      ? `接口不接受 ${label} 搜索请求，请向服务商确认 ${path} 及搜索工具支持情况，在模型设置中选择对应的联网方式。`
    : status === 429 ? '搜索请求被限流或额度不足，请检查服务商的搜索额度与频率限制。'
    : status >= 500 ? '服务商的搜索接口暂时异常，请稍后重试。'
    : '搜索接口未接受请求，请检查服务商的接口要求。'
  return new SearchError(`HTTP_${status}`, reason)
}

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function resolveChatSearchMode(model: SearchModel): ChatSearchMode {
  if (model.searchAdapter && ADAPTERS.includes(model.searchAdapter)) return model.searchAdapter
  const configured = model.chatSearchProtocol
  if (configured && configured !== 'auto' && (['responses', 'anthropic', 'openrouter', 'chat-completions'] as string[]).includes(configured)) return configured
  const official = autoSearchAdapter(model.baseUrl)
  if (official) return official
  let hostname = ''
  try { hostname = new URL(model.baseUrl).hostname } catch { /* validated before sending */ }
  if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) return 'openrouter'
  // DeepSeek 与 Kimi 的接口没有可用的内置搜索；中转站一般只提供 Gemini 的 OpenAI 兼容接口，
  // 拿不到 Google 搜索。这几类经中转站调用时改用独立搜索服务，需要时可在模型设置里手动改。
  if (/deepseek|kimi|moonshot|gemini/i.test(model.modelName)) return 'search-service'
  if (/claude/i.test(model.modelName)) return 'anthropic'
  if (/search-preview|search-api/i.test(model.modelName)) return 'chat-completions'
  return 'responses'
}

/** 兼容旧调用：返回写入对话记录的协议值。 */
export function resolveChatSearchProtocol(model: SearchModel): ResolvedProtocol {
  return recordProtocol(resolveChatSearchMode(model))
}

function sourcesFrom(candidates: unknown[]): ChatSource[] {
  const unique = new Map<string, ChatSource>()
  for (const candidate of candidates) {
    const row = object(candidate)
    const url = safeSourceUrl(row.url)
    if (!url) continue
    if (unique.has(url)) {
      if (typeof row.cited_text === 'string') unique.get(url)!.excerpt = row.cited_text.slice(0, 500)
      continue
    }
    unique.set(url, {
      url,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, 300) : new URL(url).hostname,
      excerpt: typeof row.cited_text === 'string' ? row.cited_text.slice(0, 500) : undefined,
    })
  }
  return [...unique.values()].slice(0, 30)
}

export function parseSearchResponse(raw: unknown, mode: ChatSearchMode): { content: string; search: ChatSearchRecord } {
  const data = object(raw)
  if (data.error || data.type === 'error') throw new Error('联网接口返回错误，未获得有效搜索回复。')
  if ((mode === 'anthropic' || mode === 'responses') && Array.isArray(data.choices)) {
    throw new SearchError('PROTOCOL_MISMATCH', '服务商返回了普通 Chat Completions 格式，与所选搜索协议不匹配。请确认中转接口是否转发搜索工具。')
  }
  let content = ''
  let searched = false
  let candidates: unknown[] = []
  let status: ChatSearchRecord['status'] = 'not-used'
  if (mode === 'responses') {
    if (data.status === 'failed' || data.status === 'incomplete' || data.status === 'cancelled') {
      throw new Error('联网回复未完整生成，请缩短问题或提高模型输出上限后重试。')
    }
    for (const value of array(data.output)) {
      const item = object(value)
      if (item.type === 'web_search_call') {
        if (item.status === 'failed') throw new Error('搜索工具执行失败，请稍后重试。')
        searched ||= item.status === 'completed'
      }
      if (item.type === 'message') {
        for (const value of array(item.content)) {
          const part = object(value)
          if (part.type === 'output_text' && typeof part.text === 'string') content += part.text
          candidates.push(...array(part.annotations).filter(value => object(value).type === 'url_citation'))
        }
      }
    }
  } else if (mode === 'anthropic') {
    if (data.stop_reason === 'pause_turn' || data.stop_reason === 'max_tokens') {
      throw new Error('联网任务尚未完成或回复达到输出上限；本次不自动追加计费请求，请调整后重试。')
    }
    for (const value of array(data.content)) {
      const part = object(value)
      if (part.type === 'text' && typeof part.text === 'string') {
        content += part.text
        candidates.push(...array(part.citations).filter(value => object(value).type === 'web_search_result_location'))
      }
      if (part.type === 'web_search_tool_result') {
        const toolError = object(part.content).type === 'web_search_tool_result_error'
          ? object(part.content)
          : array(part.content).map(object).find(item => item.type === 'web_search_tool_result_error')
        if (toolError) {
          const reasons: Record<string, string> = {
            unavailable: '服务商的搜索工具当前不可用。',
            too_many_requests: '服务商的搜索工具被限流，请稍后重试。',
            max_uses_exceeded: '本次搜索次数达到上限，未自动追加付费请求。',
            invalid_tool_input: '服务商的搜索工具不接受当前搜索参数。',
            query_too_long: '搜索词过长，请缩短问题后重试。',
            request_too_large: '搜索请求过大，请缩短问题后重试。',
          }
          const code = typeof toolError.error_code === 'string' && Object.prototype.hasOwnProperty.call(reasons, toolError.error_code) ? toolError.error_code : ''
          throw new SearchError(code ? `TOOL_${code.toUpperCase()}` : 'TOOL_ERROR', code ? reasons[code] : '服务商返回搜索工具错误，请确认搜索权限及工具支持情况。')
        }
        searched ||= Array.isArray(part.content)
        candidates.push(...array(part.content).filter(value => object(value).type === 'web_search_result'))
      }
    }
    searched ||= Number(object(object(data.usage).server_tool_use).web_search_requests) > 0
  } else if (mode === 'gemini') {
    const candidate = object(array(data.candidates)[0])
    if (candidate.finishReason === 'MAX_TOKENS') throw new Error('联网回复达到输出上限，请在设置中提高“最大输出 Token 数”后重试。')
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') throw new Error('Gemini 因内容安全原因没有回答这个问题。')
    content = array(object(candidate.content).parts).map(part => object(part).text).filter((text): text is string => typeof text === 'string').join('')
    const grounding = object(candidate.groundingMetadata)
    searched = array(grounding.webSearchQueries).length > 0
    candidates = array(grounding.groundingChunks).map(chunk => {
      const web = object(object(chunk).web)
      return { url: web.uri, title: web.title }
    })
  } else {
    const choice = object(array(data.choices)[0])
    if (choice.finish_reason === 'length') throw new Error('联网回复达到输出上限，请在设置中提高“最大输出 Token 数”后重试。')
    const message = object(choice.message)
    content = typeof message.content === 'string' ? message.content : ''
    candidates = array(message.annotations)
      .filter(value => object(value).type === 'url_citation')
      .map(value => object(value).url_citation || value)
    if (mode === 'qwen') {
      // 百炼开启 enable_source 后返回 search_info.search_results；不同接口版本放在顶层或消息里。
      const info = object(data.search_info || message.search_info)
      candidates.push(...array(info.search_results).map(item => ({ url: object(item).url, title: object(item).title })))
    } else if (mode === 'zhipu') {
      candidates.push(...array(data.web_search).map(item => ({ url: object(item).link, title: object(item).title, cited_text: object(item).content })))
    }
    // 兼容接口可能静默忽略未知参数；HTTP 200 或回答里写“我搜索了”都不能证明真的搜索过。
    status = 'unverified'
  }
  const sources = sourcesFrom(candidates)
  if (!content.trim()) throw new Error('联网接口没有返回可显示的回答，可能不支持所选联网方式。')
  if (searched || sources.length) status = 'searched'
  return { content, search: { protocol: recordProtocol(mode), status, sources } }
}

interface AssistantChatOptions {
  model: ModelConfig
  messages: ChatMessage[]
  webSearch: boolean
  signal: AbortSignal
  onChunk?: (text: string) => void
  stream?: boolean
  timeoutMs?: number
  noAutomaticRetry?: boolean
}

/** Gemini 原生接口地址：官方 OpenAI 兼容地址去掉末尾的 /openai。 */
function geminiNativeBase(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/openai$/i, '')
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'user' && typeof message.content === 'string' && message.content.trim()) return message.content
  }
  return ''
}

type SearchChatResult = { content: string; search?: ChatSearchRecord; responseFormat?: 'json' | 'claude-sse'; fallback?: string }

/**
 * 独立搜索服务：先查网页，再把结果作为参考资料交给当前模型。
 * builtInFailure 表示是从模型内置搜索退回来的，原因写进返回的 fallback 说明（不写入对话记录）。
 */
async function chatWithSearchService(options: AssistantChatOptions, builtInFailure?: string): Promise<SearchChatResult> {
  const { model, messages, signal } = options
  const service = useConfigStore().webSearchService
  const info = WEB_SEARCH_PROVIDERS[service.provider]
  const activity = startAiActivity(builtInFailure ? '联网搜索（改用搜索服务）' : '联网搜索')
  let sources: ChatSource[]
  let fallback = builtInFailure ? `${builtInFailure}，已改用` : ''
  try {
    const outcome = await searchWebWithFallback(service, lastUserText(messages), signal)
    sources = outcome.sources
    const used = WEB_SEARCH_PROVIDERS[outcome.provider].label
    if (outcome.fallbackReason) fallback = `${fallback ? fallback.replace(/，已改用$/, '；') : ''}${outcome.fallbackReason}，已改用${used}`
    else if (fallback) fallback += used
    finishAiActivity(activity)
  } catch (error) {
    if (signal.aborted) { finishAiActivity(activity, signal.reason); throw signal.reason }
    const code = error instanceof WebSearchServiceError ? error.code : 'SEARCH_SERVICE_FAILED'
    const failure = new SearchError(code, `[${code}] ${info?.label || '搜索服务'}：${error instanceof Error ? error.message : '搜索未完成。'}`)
    finishAiActivity(activity, failure)
    throw failure
  }
  const query = lastUserText(messages).replace(/\s+/g, ' ').trim().slice(0, 200)
  const withContext: ChatMessage[] = sources.length
    ? [...messages.slice(0, -1), { role: 'system', content: searchContextMessage(query, sources) }, messages[messages.length - 1]]
    : messages
  const result = await callAI({
    model, messages: withContext, signal, stream: options.stream ?? true, onChunk: options.onChunk,
    timeoutMs: options.timeoutMs, noAutomaticRetry: options.noAutomaticRetry,
  })
  return { content: result.content, search: { protocol: 'chat-completions', status: sources.length ? 'searched' : 'not-used', sources },
    ...(fallback ? { fallback } : {}) }
}

/** 内置搜索出错（配置错误除外）或没有搜索证据时，能否改用独立搜索服务。 */
function shouldFallBack(error: unknown): boolean {
  return error instanceof SearchError && error.code !== 'INVALID_URL'
}

export async function chatWithOptionalSearch(options: AssistantChatOptions): Promise<SearchChatResult> {
  const { model, messages, signal } = options
  signal.throwIfAborted()
  if (!options.webSearch) {
    if (/:online(?:$|:)|search-preview|search-api|(?:^|\/)sonar(?:-|$)/i.test(model.modelName)) {
      throw new Error('当前配置是联网专用模型，无法保证关闭搜索。请在设置中切换普通模型后再使用不联网对话。')
    }
    // Search is scoped to explicit chat entry points, not writing/outline/review.
    return callAI({
      model, messages, signal, stream: options.stream ?? true, onChunk: options.onChunk,
      timeoutMs: options.timeoutMs,
      noAutomaticRetry: options.noAutomaticRetry,
    })
  }
  const mode = resolveChatSearchMode(model)
  if (mode === 'search-service') return chatWithSearchService(options)
  const service = useConfigStore().webSearchService
  let builtIn: SearchChatResult
  try {
    builtIn = await chatWithBuiltInSearch(options, mode)
  } catch (error) {
    // 内置搜索失败时改用独立搜索服务；只发送问题给搜索服务，模型密钥仍只发往原接口。
    if (signal.aborted || !shouldFallBack(error) || !service.freeFallback || !isWebSearchServiceConfigured(service)) throw error
    const detail = error instanceof Error ? error.message.replace(/^[[^]]+]s*/, '') : '未完成'
    return chatWithSearchService(options, `模型内置搜索失败（${detail.slice(0, 160)}）`)
  }
  if (builtIn.search?.status === 'not-used' && service.freeFallback && isWebSearchServiceConfigured(service)) {
    signal.throwIfAborted()
    return chatWithSearchService(options, '模型内置搜索没有返回搜索证据')
  }
  return builtIn
}

async function chatWithBuiltInSearch(options: AssistantChatOptions, mode: Exclude<ChatSearchMode, 'search-service'>): Promise<SearchChatResult> {
  const { model, messages, signal } = options
  let endpoint: URL
  try { endpoint = new URL(mode === 'gemini' ? geminiNativeBase(model.baseUrl) : openAiV1BaseUrl(model.baseUrl)) }
  catch { throw new SearchError('INVALID_URL', 'API 地址无效，请检查模型设置中的 API Base URL。') }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('API 地址必须是有效的 HTTP(S) 基地址，不能包含凭据、查询参数或片段。')
  }
  if (!model.apiKey.trim()) throw new Error('请先在设置中填写有效的 API 密钥。')
  if (model.apiKey.startsWith('enc:') || model.apiKey.includes('***')) throw new Error('API 密钥是密文或遮蔽文本，请填写当前服务商的有效密钥。')
  let path = '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` }
  let body: Json = { model: model.modelName, messages, max_tokens: model.maxTokens, stream: false }
  if (mode === 'responses') {
    path = '/responses'
    body = { model: model.modelName, input: messages, max_output_tokens: model.maxTokens, stream: false, store: false,
      tools: [{ type: 'web_search' }], tool_choice: 'auto' }
  } else if (mode === 'anthropic') {
    path = '/messages'
    headers['x-api-key'] = model.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = { model: model.modelName, max_tokens: model.maxTokens, stream: false,
      system: messages.filter(item => item.role === 'system').map(item => item.content).join('\n\n'),
      messages: messages.filter(item => item.role !== 'system'),
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }
  } else if (mode === 'gemini') {
    path = `/models/${encodeURIComponent(model.modelName.replace(/^models\//, ''))}:generateContent`
    delete headers.Authorization
    headers['x-goog-api-key'] = model.apiKey
    const system = messages.filter(item => item.role === 'system').map(item => item.content).join('\n\n')
    body = {
      contents: messages.filter(item => item.role !== 'system')
        .map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: model.maxTokens },
    }
  } else if (mode === 'qwen') {
    body.enable_search = true
    body.search_options = { enable_source: true }
  } else if (mode === 'zhipu') {
    body.tools = [{ type: 'web_search', web_search: { enable: true, search_engine: 'search_std', search_result: true } }]
  } else if (mode === 'openrouter') {
    body.plugins = [{ id: 'web', max_results: 3 }]
  } else {
    body.web_search_options = { search_context_size: 'medium' }
  }
  const activity = startAiActivity('AI 联网对话')
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new SearchError('SEARCH_TIMEOUT', '搜索接口在 120 秒内未完成回复，请检查服务商状态或当前网络。')), 120_000)
  try {
    // Never retry with a different host/protocol or silently fall back to offline.
    // That could leak a key to a different service or charge for duplicate searches.
    const response = await fetch(`${endpoint.href.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw httpSearchError(response.status, mode)
    }
    const payload = await readSearchPayload(response, recordProtocol(mode), controller.signal)
    controller.signal.throwIfAborted()
    return { ...parseSearchResponse(payload.data, mode), responseFormat: payload.format }
  } catch (error) {
    if (signal.aborted) {
      finishAiActivity(activity, signal.reason)
      throw signal.reason
    }
    const cause = controller.signal.aborted ? controller.signal.reason
      : error instanceof TypeError
        ? new SearchError('SEARCH_CONNECTION_FAILED', '搜索请求未取得可读取的响应。普通对话正常时，请检查搜索路径、服务商的跨域支持及公司网络策略；仅凭此错误不能认定密钥失效或电脑断网。')
        : error
    const { label, path } = modeInfo[mode]
    const detail = cause instanceof Error ? cause.message : '搜索请求未完成。'
    const failure = new SearchError(cause instanceof SearchError ? cause.code : 'SEARCH_FAILED',
      `[${cause instanceof SearchError ? cause.code : 'SEARCH_FAILED'}] ${label} ${path}：${detail}`)
    finishAiActivity(activity, failure)
    throw failure
  } finally {
    if (activity.status === 'running') finishAiActivity(activity)
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export interface ChatSearchTestResult {
  status: 'verified' | 'unverified' | 'failed'
  message: string
  sourceCount: number
}

export async function testChatSearch(model: ModelConfig, signal: AbortSignal): Promise<ChatSearchTestResult> {
  try {
    const result = await chatWithOptionalSearch({
      model: { ...model, maxTokens: Math.min(model.maxTokens, 2048) }, signal, webSearch: true, stream: false,
      messages: [{ role: 'user', content: '请实际调用网页搜索，查询 Vue 官方网站，返回官网链接和一句概述。不要只根据已有知识回答。' }],
    })
    const count = result.search?.sources.length || 0
    const formatNote = result.responseFormat === 'claude-sse' ? '已兼容读取中转站返回的 Claude 事件流。' : ''
    const fallbackNote = result.fallback ? `${result.fallback}。` : ''
    if (result.search?.status === 'searched' && count > 0) {
      return { status: 'verified', sourceCount: count, message: `${formatNote}${fallbackNote}本次测试收到搜索证据和 ${count} 个来源。` }
    }
    return { status: 'unverified', sourceCount: count, message: formatNote + fallbackNote + (result.search?.status === 'searched'
      ? '接口报告搜索已执行，但未返回可引用来源，本次未完整验证。'
      : '接口有回复，但没有可验证的搜索证据。可能未调用搜索，或服务商忽略了搜索参数，不能据此判定联网成功。') }
  } catch (error) {
    signal.throwIfAborted()
    return { status: 'failed', sourceCount: 0, message: error instanceof Error ? error.message : '搜索测试失败。' }
  }
}
