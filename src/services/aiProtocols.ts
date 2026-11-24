import type { ModelConfig } from '@/stores/config'
import type { ChatCompletionResult } from './ai'
import { safeAiUsage } from './aiDiagnostics'

export const AI_PROTOCOL_LABELS = {
  'chat-completions': 'Chat Completions', responses: 'Responses', anthropic: 'Anthropic Messages',
} as const
export type AiProtocol = keyof typeof AI_PROTOCOL_LABELS

export function resolveAiProtocol(model: Pick<ModelConfig, 'baseUrl' | 'apiProtocol'>): AiProtocol {
  if (model.apiProtocol && Object.prototype.hasOwnProperty.call(AI_PROTOCOL_LABELS, model.apiProtocol)) return model.apiProtocol
  try {
    if (new URL(model.baseUrl).hostname === 'api.anthropic.com') return 'anthropic'
  } catch { /* The request reports an invalid URL. */ }
  return 'chat-completions'
}

export function aiHeaders(protocol: AiProtocol, key: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    if (key) headers['x-api-key'] = key
  } else if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

type WireMessage = { role: string; content: string | ({ type: string; text: string } | { type: string; image_url: { url: string } })[] }

export function aiRequest(protocol: AiProtocol, model: ModelConfig, messages: WireMessage[], maxTokens: number, chatFields: Record<string, unknown>) {
  const common = { model: model.modelName, temperature: model.temperature, top_p: model.topP }
  if (protocol === 'responses') {
    const input = messages.map(({ role, content }) => ({ role, content: typeof content === 'string' ? content
      : content.map(part => 'image_url' in part
        ? { type: 'input_image', image_url: part.image_url.url, detail: 'high' }
        : { type: 'input_text', text: part.text }) }))
    return { path: '/responses', body: { ...common, input, max_output_tokens: maxTokens, store: false } }
  }
  if (protocol === 'anthropic') {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    const turns = messages.filter(message => message.role !== 'system').map(({ role, content }) => ({ role, content: typeof content === 'string' ? content
      : content.map(part => {
        if (!('image_url' in part)) return { type: 'text', text: part.text }
        const [metadata, data] = part.image_url.url.split(',')
        return { type: 'image', source: { type: 'base64', media_type: metadata.slice(5, -7), data } }
      }) }))
    // Anthropic recommends setting one sampling parameter, and some models reject both.
    return { path: '/messages', body: { model: model.modelName, max_tokens: maxTokens,
      ...(system ? { system } : {}), messages: turns, temperature: model.temperature } }
  }
  return { path: '/chat/completions', body: { ...common, messages, max_tokens: maxTokens, ...chatFields } }
}

export const aiObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const asText = (value: unknown) => typeof value === 'string' ? value : undefined
const rows = (value: unknown) => Array.isArray(value) ? value.map(aiObject) : []

function tokenUsage(value: unknown, previous?: ChatCompletionResult['usage']): ChatCompletionResult['usage'] {
  const source = aiObject(value)
  const usage = { ...previous, ...safeAiUsage({
    prompt_tokens: source.input_tokens,
    completion_tokens: source.output_tokens,
    total_tokens: source.total_tokens,
    completion_tokens_details: aiObject(source.output_tokens_details),
  }) }
  if (source.total_tokens === undefined && usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined) {
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
  }
  return safeAiUsage(usage)
}

function anthropicStop(reason: unknown) {
  switch (reason) {
    case 'end_turn': case 'stop_sequence': return 'stop'
    case 'max_tokens': case 'model_context_window_exceeded': return 'length'
    case 'refusal': return 'content_filter'
    case 'tool_use': return 'tool_calls'
    default: return asText(reason)
  }
}

export function decodeAiReply(protocol: AiProtocol, value: unknown): ChatCompletionResult | null {
  const data = aiObject(value)
  if (protocol === 'responses') {
    if (!Array.isArray(data.output) || !['completed', 'incomplete'].includes(String(data.status))) return null
    const items = rows(data.output)
    const parts = items.filter(item => item.type === 'message').flatMap(item => rows(item.content))
    const refusal = parts.some(part => part.type === 'refusal')
    const incomplete = aiObject(data.incomplete_details).reason
    const finishReason = refusal || incomplete === 'content_filter' ? 'content_filter' : data.status === 'incomplete'
      ? incomplete === 'max_output_tokens' ? 'length' : 'incomplete'
      : items.some(item => item.type === 'function_call') ? 'tool_calls' : 'stop'
    const content = parts.filter(part => part.type === 'output_text').map(part => asText(part.text) ?? '').join('')
    return { content, finishReason, usage: tokenUsage(data.usage) }
  }
  if (protocol === 'anthropic') {
    if (!Array.isArray(data.content)) return null
    const content = rows(data.content).filter(part => part.type === 'text').map(part => asText(part.text) ?? '').join('')
    return { content, finishReason: anthropicStop(data.stop_reason), usage: tokenUsage(data.usage) }
  }
  const choice = rows(data.choices)[0]
  if (!choice || !choice.message || typeof choice.message !== 'object') return null
  const message = aiObject(choice.message)
  return { content: asText(message.content) ?? '', finishReason: message.refusal ? 'content_filter' : asText(choice.finish_reason), usage: safeAiUsage(data.usage) }
}

export function decodeAiEvent(protocol: AiProtocol, event: string | undefined, value: unknown, usage: ChatCompletionResult['usage']) {
  const data = aiObject(value)
  const type = event || data.type
  if (protocol === 'responses') {
    const done = type === 'response.completed' || type === 'response.incomplete'
    const result = done ? decodeAiReply(protocol, data.response) : null
    return { delta: type === 'response.output_text.delta' ? asText(data.delta) : undefined,
      summary: result?.content, finishReason: result?.finishReason, usage: result?.usage ?? usage, done: done && Boolean(result),
      failed: type === 'response.failed' || type === 'error' || (done && !result) }
  }
  if (protocol === 'anthropic') {
    const delta = aiObject(data.delta)
    const block = aiObject(data.content_block)
    const text = type === 'content_block_start' && block.type === 'text' ? asText(block.text)
      : type === 'content_block_delta' && delta.type === 'text_delta' ? asText(delta.text) : undefined
    const nextUsage = type === 'message_start' ? aiObject(data.message).usage : data.usage
    return { delta: text, finishReason: anthropicStop(delta.stop_reason), usage: tokenUsage(nextUsage, usage),
      done: type === 'message_stop', failed: type === 'error' || Boolean(data.error) }
  }
  const choices = rows(data.choices)
  const choice = choices.find(item => item.index === 0) ?? choices[0]
  const delta = aiObject(choice?.delta)
  return { delta: asText(delta.content), finishReason: delta.refusal ? 'content_filter' : asText(choice?.finish_reason),
    usage: safeAiUsage(data.usage) ?? usage, done: false, failed: Boolean(data.error) }
}
