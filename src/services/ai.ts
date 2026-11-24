// AI 服务层 — OpenAI 兼容 API 调用（支持流式 SSE）

import { useConfigStore, type ModelConfig } from '@/stores/config'
import type { WritingSkillTask } from '@/types/skill'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'
import { structuredRequestFields, type StructuredOutputMode } from './aiStructuredRequest'
import { assertStructuredOutputComplete, safeAiErrorMessage, validateStructuredJson } from './aiDiagnostics'
import { isLocalModelUrl } from './modelProviders'
import { adjustBodyForParameterError, isTerminalProviderError } from './aiParameterRetry'
import { explainAiError } from './aiErrorExplain'
import { AI_PROTOCOL_LABELS, aiHeaders, aiObject, aiRequest, decodeAiEvent, decodeAiReply, resolveAiProtocol, type AiProtocol } from './aiProtocols'
import { createParser } from 'eventsource-parser'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  imageDataUrls?: string[]
}

export interface AiRequestLifecycle {
  beforeRequest(options: ChatCompletionOptions): Promise<void>
  afterRequest(outcome: { result?: ChatCompletionResult; error?: unknown }): Promise<void>
}

export function serializeChatMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content, imageDataUrls }) => {
    if (!imageDataUrls?.length) return { role, content }
    if (role !== 'user' || imageDataUrls.length > 4
      || imageDataUrls.some(url => !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(url) || url.length > 12 * 1024 * 1024)) {
      throw new Error('图片消息格式无效或超过大小上限')
    }
    return { role, content: [
      { type: 'text', text: content },
      ...imageDataUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
    ] }
  })
}

export interface ChatCompletionOptions {
  model: ModelConfig
  messages: ChatMessage[]
  taskName?: string
  stream?: boolean
  onChunk?: (chunk: string) => void // 流式回调
  signal?: AbortSignal
  maxTokens?: number // 覆盖模型默认 maxTokens
  timeoutMs?: number // 覆盖默认请求超时
  skillTask?: Exclude<WritingSkillTask, 'all'>
  activityParentId?: string
  redactErrors?: boolean
  noAutomaticRetry?: boolean
  structuredOutput?: StructuredOutputMode // 显式短 JSON 判断，不改变普通请求或输出预算
  /** 整理、摘要这类不需要推理的任务：在已核实的官方接口上关闭思考，避免思考用光输出额度。 */
  disableThinking?: boolean
  requestLifecycle?: AiRequestLifecycle
  shouldStop?: () => boolean
}

/**
 * 关闭思考的请求字段。只用于已用真实请求核实过的官方接口（2026-11-22 核实 DeepSeek：
 * 默认会先思考，带 thinking.type=disabled 时正常返回且无思考内容）；中转站和其他服务商不加，避免未知参数导致请求被拒。
 */
export function disableThinkingFields(model: Pick<ModelConfig, 'baseUrl'>, disable?: boolean): Record<string, unknown> {
  if (!disable) return {}
  try {
    if (new URL(model.baseUrl).hostname.toLowerCase() === 'api.deepseek.com') return { thinking: { type: 'disabled' } }
  } catch { /* 地址无效时由正常请求流程报错 */ }
  return {}
}

export function applySkillInstructions(messages: ChatMessage[], instructions: string): ChatMessage[] {
  const content = instructions.trim()
  if (!content) return messages
  const block = `【已启用写作 Skill】\n${content}`
  const systemIndex = messages.findIndex(message => message.role === 'system')
  if (systemIndex < 0) return [{ role: 'system', content: block }, ...messages]
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${block}` }
    : message)
}

export interface ChatCompletionResult {
  content: string
  finishReason?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

export interface AvailableModel {
  id: string
  object?: string
  ownedBy?: string
}

const NON_STREAM_TIMEOUT = 120_000  // 非流式 120 秒
const STREAM_TIMEOUT = 300_000      // 流式 300 秒
const MAX_REQUEST_ATTEMPTS = 3

/** Normalize both `https://provider.example` and `https://provider.example/v1`. */
export function openAiV1BaseUrl(baseUrl: string): string {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) return ''
  // 官方接口地址可能以其他版本号结尾（智谱 /api/paas/v4、火山方舟 /api/v3、Gemini /v1beta/openai），这类地址原样使用。
  return /\/v\d+(?:beta|alpha)?$/i.test(normalized) || /\/openai$/i.test(normalized) ? normalized : `${normalized}/v1`
}

// 合并用户 signal 和超时 signal
function mergeSignals(userSignal?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`)), timeoutMs) : null
  const abort = () => controller.abort(userSignal?.reason)
  const dispose = () => {
    if (timer) clearTimeout(timer)
    userSignal?.removeEventListener('abort', abort)
  }

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason)
    } else {
      userSignal.addEventListener('abort', abort, { once: true })
    }
  }

  controller.signal.addEventListener('abort', dispose, { once: true })
  return { signal: controller.signal, dispose }
}

class AiHttpError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`API 请求失败 (${status}): ${detail}`)
  }
}

class AiStreamError extends Error {}

async function readErrorDetail(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, 4000)
  const decoder = new TextDecoder()
  let bytes = 0
  let detail = ''
  try {
    while (bytes < 4000) {
      const { done, value } = await reader.read()
      if (done) break
      detail += decoder.decode(value.subarray(0, 4000 - bytes), { stream: true })
      bytes += value.length
    }
    return detail + decoder.decode()
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function readAiReply(response: Response, protocol: AiProtocol): Promise<ChatCompletionResult> {
  const payload = await response.json().catch(() => null)
  const result = decodeAiReply(protocol, payload)
  if (result) return result
  const error = aiObject(aiObject(payload).error)
  if (typeof error.message === 'string') throw new AiHttpError(400, `${String(error.code ?? error.type ?? '')} ${error.message}`)
  throw new Error('模型返回了无效数据，或内容与当前接口格式不匹配。请在模型设置中重新测试对话。')
}

async function readAiStream(
  response: Response, protocol: AiProtocol, signal: AbortSignal, options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  if (/application\/json/i.test(response.headers?.get('content-type') ?? '')) return readAiReply(response, protocol)
  const reader = response.body?.getReader()
  if (!reader) throw new AiStreamError('无法获取模型响应流')
  try {
    const decoder = new TextDecoder()
    let content = ''
    let finishReason: string | undefined
    let usage: ChatCompletionResult['usage']
    let done = false
    const emit = (delta: string) => {
      content += delta
      options.onChunk?.(delta)
      if (options.shouldStop?.()) { finishReason = 'client_stop'; done = true }
    }
    const parser = createParser({
      maxBufferSize: 8 * 1024 * 1024,
      onEvent(event) {
        if (done) return
        if (event.data.trim() === '[DONE]') {
          if (protocol === 'chat-completions' || finishReason) done = true
          return
        }
        let payload: unknown
        try { payload = JSON.parse(event.data) } catch {
          throw new AiStreamError('模型返回了无效的流式数据，未将部分内容视为完整结果')
        }
        const parsed = decodeAiEvent(protocol, event.event, payload, usage)
        if (parsed.failed) {
          const error = aiObject(aiObject(payload).error ?? aiObject(aiObject(payload).response).error)
          if (typeof error.message === 'string') throw new AiHttpError(400, `${String(error.code ?? error.type ?? '')} ${error.message}`)
          throw new Error('模型接口在输出过程中返回错误，已停止接收')
        }
        finishReason = parsed.finishReason ?? finishReason
        usage = parsed.usage
        if ('summary' in parsed && parsed.summary !== undefined && finishReason !== 'content_filter') {
          if (!parsed.summary.startsWith(content)) throw new AiStreamError('模型的流式正文与最终正文不一致。')
          const remaining = parsed.summary.slice(content.length)
          if (remaining) emit(remaining)
        } else if (parsed.delta) emit(parsed.delta)
        done ||= parsed.done
      },
      onError(error) {
        if (error.type === 'unknown-field') return
        throw new AiStreamError('模型返回的事件流格式异常，未将部分内容视为完整结果')
      },
    })
    while (!done) {
      signal.throwIfAborted()
      const chunk = await reader.read().catch(() => {
        signal.throwIfAborted()
        throw new AiStreamError('模型连接提前结束，未收到输出完成标记；已接收内容保留')
      })
      if (chunk.done) {
        // Some relays omit the blank line after their final data event.
        parser.feed(decoder.decode() + '\n\n')
        break
      }
      parser.feed(decoder.decode(chunk.value, { stream: true }))
    }
    signal.throwIfAborted()
    if (!done && !(protocol === 'chat-completions' && finishReason)) {
      throw new AiStreamError('模型连接提前结束，未收到输出完成标记；已接收内容保留')
    }
    return { content, finishReason: finishReason || 'stop', ...(usage ? { usage } : {}) }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function modelBaseUrl(model: Pick<ModelConfig, 'baseUrl'>): string {
  const normal = openAiV1BaseUrl(model.baseUrl)
  let url: URL
  try { url = new URL(normal) } catch { throw new Error('API 地址无效，请检查模型设置中的 API Base URL。') }
  if (!['https:', 'http:'].includes(url.protocol) || /^https?:\/\/[^/]*@/i.test(normal) || url.username || url.password || /[?#]/.test(normal)) {
    throw new Error('API 地址必须是有效的 HTTP(S) 基地址，且不能包含凭据、查询参数或片段。')
  }
  if (/\/v1beta$/i.test(url.pathname)) throw new Error('Gemini 原生接口暂用兼容地址，请在 API Base URL 末尾加 /openai。')
  return url.href.replace(/\/$/, '')
}

async function chatCompletion(options: ChatCompletionOptions, probe = false): Promise<ChatCompletionResult> {
  const { model, messages, signal, maxTokens } = options
  const protocol = resolveAiProtocol(model)
  const requestData = aiRequest(protocol, model, serializeChatMessages(messages), maxTokens || model.maxTokens, {
    ...structuredRequestFields(model, options.structuredOutput),
    ...disableThinkingFields(model, options.disableThinking),
  })
  const url = modelBaseUrl(model) + requestData.path
  let stream = Boolean(options.stream && options.onChunk)
  const request = mergeSignals(signal, options.timeoutMs ?? (stream ? STREAM_TIMEOUT : NON_STREAM_TIMEOUT))
  const requestStreamingUsage = protocol === 'chat-completions' && new URL(url).hostname === 'api.openai.com'
  let body: Record<string, unknown> = requestData.body
  if (probe) {
    delete body.temperature
    delete body.top_p
  }
  let parameterRetried = false
  let delivered = false
  const publish = (text: string) => {
    delivered = true
    options.onChunk?.(text)
  }
  try {
    for (let attempt = 1; ; attempt++) {
      request.signal.throwIfAborted()
      const response = await fetch(url, {
        method: 'POST', headers: aiHeaders(protocol, model.apiKey.trim()), signal: request.signal,
        body: JSON.stringify({ ...body, stream, ...(stream && requestStreamingUsage ? { stream_options: { include_usage: true } } : {}) }),
        ...(protocol === 'anthropic' ? { redirect: 'error' } : {}),
      })
      request.signal.throwIfAborted()
      const canRetry = !options.noAutomaticRetry && attempt < MAX_REQUEST_ATTEMPTS
      if (!response.ok) {
        const detail = await readErrorDetail(response)
        const adjusted = canRetry && !parameterRetried ? adjustBodyForParameterError(response.status, detail, body) : null
        if (!adjusted) throw new AiHttpError(response.status, detail)
        parameterRetried = true
        body = adjusted.body
        continue
      }
      try {
        const result = stream
          ? await readAiStream(response, protocol, request.signal, { ...options, onChunk: publish })
          : await readAiReply(response, protocol)
        request.signal.throwIfAborted()
        if (!delivered && result.content && options.stream && options.onChunk) publish(result.content)
        return result
      } catch (error) {
        if (!canRetry || !stream || (delivered && !options.structuredOutput) || !(error instanceof AiStreamError)) throw error
        stream = false
      }
    }
  } catch (error) {
    request.signal.throwIfAborted()
    throw error
  } finally {
    request.dispose()
  }
}

/** Fetch the models exposed by an OpenAI-compatible provider. */
export async function listAvailableModels(
  model: Pick<ModelConfig, 'baseUrl' | 'apiKey' | 'apiProtocol' | 'kind'>,
  signal?: AbortSignal,
): Promise<AvailableModel[]> {
  if (!model.baseUrl.trim()) throw new Error('请先填写 API Base URL')
  const baseUrl = modelBaseUrl(model)
  if (!model.apiKey.trim() && !isLocalModelUrl(model.baseUrl)) throw new Error('请先填写 API 密钥')

  let payload: unknown
  const request = mergeSignals(signal, 30_000)
  try {
    request.signal.throwIfAborted()
    const protocol = model.kind === 'embedding' ? 'chat-completions' : resolveAiProtocol(model)
    const headers = aiHeaders(protocol, model.apiKey.trim())
    delete headers['Content-Type']
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      ...(protocol === 'anthropic' ? { redirect: 'error' } : {}),
      signal: request.signal,
    })
    if (!response.ok) {
      const detail = safeAiErrorMessage((await readErrorDetail(response)).trim(), [model.apiKey.trim()]).slice(0, 300)
      throw new Error(`获取模型失败（${response.status}）${detail ? `：${detail}` : ''}`)
    }
    try { payload = await response.json() } catch { throw new Error('获取模型失败：服务返回的内容不是合法 JSON') }
  } finally {
    request.dispose()
  }
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const models = rows
    .map(item => {
      if (typeof item === 'string') return { id: item }
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      const id = typeof value.id === 'string' ? value.id.trim() : ''
      if (!id) return null
      return {
        id,
        object: typeof value.object === 'string' ? value.object : undefined,
        ownedBy: typeof value.owned_by === 'string' ? value.owned_by : undefined,
      }
    })
    .filter((item): item is AvailableModel => Boolean(item))
  const unique = new Map<string, AvailableModel>()
  for (const model of models) {
    // Keep the richest first response when a provider accidentally repeats an id.
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// 统一入口
export async function callAI(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const activity = startAiActivity(options.taskName || ({
    planning: 'AI 规划任务',
    writing: 'AI 写作任务',
    review: 'AI 审查任务',
    analysis: 'AI 分析任务',
  }[options.skillTask || 'planning'] || 'AI 任务'), options.activityParentId)
  let enrichedOptions = options
  const lifecycle = options.requestLifecycle
  let lifecycleAdmitted = false
  let lifecycleAfterAttempted = false
  let lifecycleOutcome: 'success' | 'error' | undefined
  try {
    if (options.skillTask) {
      try {
        const skillPrompt = useConfigStore().getSkillPrompt(options.skillTask)
        enrichedOptions = { ...options, messages: applySkillInstructions(options.messages, skillPrompt) }
      } catch {
        // Pinia 尚未初始化的独立调用不注入 Skill。
      }
    }
    if (lifecycle) {
      enrichedOptions = { ...enrichedOptions, noAutomaticRetry: true }
    }
    enrichedOptions.signal?.throwIfAborted()
    if (lifecycle) {
      await lifecycle.beforeRequest(enrichedOptions)
      lifecycleAdmitted = true
      enrichedOptions = { ...enrichedOptions, noAutomaticRetry: true, requestLifecycle: lifecycle }
      // Admission can wait on an async budget/store decision. If the caller
      // cancels while that decision is pending, settle the admitted request
      // without entering either HTTP path.
      enrichedOptions.signal?.throwIfAborted()
    }
    const deferredChunk = enrichedOptions.structuredOutput ? enrichedOptions.onChunk : undefined
    const result = await chatCompletion(deferredChunk ? { ...enrichedOptions, onChunk: () => {} } : enrichedOptions)
    if (lifecycle) {
      lifecycleAfterAttempted = true
      lifecycleOutcome = 'success'
      await lifecycle.afterRequest({ result })
    }
    if (result.finishReason === 'content_filter') throw new Error('模型因内容审核拒绝回复。请检查输入后再试。')
    if (enrichedOptions.structuredOutput) {
      const task = enrichedOptions.taskName || '模型结构化结果'
      assertStructuredOutputComplete(result, task)
      validateStructuredJson(result.content, task)
      if (enrichedOptions.stream) deferredChunk?.(result.content)
    }
    return result
  } catch (error) {
    let finalError = error
    let lifecycleFailed = false
    if (!options.signal?.aborted && error instanceof AiHttpError) {
      const detail = safeAiErrorMessage(error, [options.model.apiKey.trim()])
      finalError = new Error(`模型接口返回错误 (${error.status})。${explainAiError(detail, 'request').hint}`)
    } else if (!options.signal?.aborted && error instanceof TypeError && /fetch|network|socket|econn/i.test(error.message)) {
      finalError = new TypeError(`${explainAiError('failed to fetch', 'request').hint}（${safeAiErrorMessage(error, [options.model.apiKey.trim()])}）`)
    }
    if (lifecycleAdmitted && lifecycle && !lifecycleAfterAttempted) {
      lifecycleAfterAttempted = true
      lifecycleOutcome = 'error'
      try {
        await lifecycle.afterRequest({ error: finalError })
      } catch (lifecycleError) {
        finalError = lifecycleError
        lifecycleFailed = true
      }
    }
    const visibleError = options.redactErrors && !options.signal?.aborted && lifecycleOutcome !== 'success' && !lifecycleFailed
      ? new Error('图片识别接口请求失败，请检查模型、额度和连接。') : finalError
    finishAiActivity(activity, visibleError)
    throw visibleError
  } finally {
    if (activity.status === 'running') finishAiActivity(activity)
  }
}

// 测试 API 连接
export async function testConnection(model: ModelConfig): Promise<{ ok: boolean; message: string; detail?: string; latency?: number; detectedProtocol?: AiProtocol }> {
  const start = Date.now()
  const preferred = resolveAiProtocol(model)
  const candidates: AiProtocol[] = model.apiProtocol || preferred === 'anthropic' ? [preferred] : ['chat-completions', 'responses', 'anthropic']
  const activity = startAiActivity('AI 连接测试')
  try {
    for (const [index, protocol] of candidates.entries()) {
      try {
        const result = await chatCompletion({ model: { ...model, apiProtocol: protocol },
          messages: [{ role: 'user', content: '请回复“连接成功”四个字。' }], maxTokens: 64, timeoutMs: 15_000,
          noAutomaticRetry: true, disableThinking: true }, true)
        if (!result.content.trim() || result.finishReason && !['stop', 'length'].includes(result.finishReason)) throw new Error('模型未返回可显示的对话回复。')
        const latency = Date.now() - start
        const detectedProtocol = model.apiProtocol ? undefined : protocol
        return { ok: true, latency, detectedProtocol,
          message: `连接成功（${latency} ms）${detectedProtocol ? `，已自动识别为 ${AI_PROTOCOL_LABELS[detectedProtocol]} 格式` : ''}` }
      } catch (error) {
        if (index === candidates.length - 1 || !(error instanceof AiHttpError) || !canProbeAnotherProtocol(error)) throw error
      }
    }
    throw new Error('未找到可用的对话协议。')
  } catch (err: unknown) {
    const { hint, detail } = explainAiError(safeAiErrorMessage(err, [model.apiKey.trim()]))
    finishAiActivity(activity, new Error(hint))
    return { ok: false, message: `连接失败：${hint}`, detail }
  } finally {
    if (activity.status === 'running') finishAiActivity(activity)
  }
}

function canProbeAnotherProtocol(error: AiHttpError): boolean {
  if (isTerminalProviderError(error.detail)) return false
  if (error.status === 404 || error.status === 405) return true
  return (error.status === 400 || error.status === 422) &&
    /(?:endpoint|protocol|接口|格式|route|api format).{0,80}(?:unsupported|not support|不支持|not found)|(?:unsupported|does not support|不支持).{0,80}(?:endpoint|protocol|接口|格式|route|api format)/i.test(error.detail)
}
