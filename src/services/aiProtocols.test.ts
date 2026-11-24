import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAI, testConnection } from './ai'
import type { ModelConfig } from '@/stores/config'

const model: ModelConfig = { id: 'test', name: 'test', baseUrl: 'https://test.example/v1', apiKey: 'synthetic-key',
  modelName: 'test-model', maxTokens: 512, temperature: 0.7, topP: 0.9 }
const messages = [{ role: 'system', content: 'Reply in JSON' }, { role: 'user', content: 'Say yes' }] as const
const content = '{"answer":"是"}'
const responses = { status: 'completed', output: [{ type: 'reasoning', summary: [{ text: 'private' }] },
  { type: 'message', content: [{ type: 'output_text', text: content }] }],
  usage: { input_tokens: 6, output_tokens: 8, total_tokens: 14, output_tokens_details: { reasoning_tokens: 2 } } }
const anthropic = { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: content }],
  stop_reason: 'end_turn', usage: { input_tokens: 6, output_tokens: 8 } }
const completions = { choices: [{ message: { content }, finish_reason: 'stop' }] }
const sse = (...events: object[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
  { headers: { 'Content-Type': 'text/event-stream' } })

afterEach(() => vi.unstubAllGlobals())

describe('standard AI protocols', () => {
  it.each([
    ['responses', '/responses', responses, { input: [...messages], max_output_tokens: 512, store: false }],
    ['anthropic', '/messages', anthropic, { system: messages[0].content, messages: [messages[1]], max_tokens: 512 }],
  ] as const)('sends and receives %s structured output', async (apiProtocol, path, payload, fields) => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(payload))
    vi.stubGlobal('fetch', fetcher)
    const result = await callAI({ model: { ...model, apiProtocol }, messages: [...messages], structuredOutput: 'concise-json' })
    expect(result).toMatchObject({ content, finishReason: 'stop', usage: { prompt_tokens: 6, completion_tokens: 8, total_tokens: 14 } })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(model.baseUrl + path)
    expect(JSON.parse(String(init.body))).toMatchObject(fields)
    if (apiProtocol === 'responses') expect(init.headers).toMatchObject({ Authorization: `Bearer ${model.apiKey}` })
    else {
      expect(init.headers).toMatchObject({ 'x-api-key': model.apiKey, 'anthropic-version': '2023-06-01' })
      expect(init.headers).not.toHaveProperty('Authorization')
    }
  })

  it('streams Responses text and normalizes final reasoning usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse({ type: 'response.reasoning_summary_text.delta', delta: 'private' },
      { type: 'response.output_text.delta', delta: content.slice(0, 8) }, { type: 'response.completed', response: responses })))
    const onChunk = vi.fn()
    const result = await callAI({ model: { ...model, apiProtocol: 'responses' }, messages: [...messages], stream: true, onChunk })
    expect(onChunk.mock.calls.flat().join('')).toBe(content)
    expect(result).toEqual({ content, finishReason: 'stop', usage: { prompt_tokens: 6, completion_tokens: 8, total_tokens: 14,
      completion_tokens_details: { reasoning_tokens: 2 } } })
  })

  it('streams Anthropic text and combines start and stop usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse({ type: 'message_start', message: { usage: { input_tokens: 6, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: content } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }, { type: 'message_stop' })))
    const onChunk = vi.fn()
    await expect(callAI({ model: { ...model, apiProtocol: 'anthropic' }, messages: [...messages], stream: true, onChunk }))
      .resolves.toEqual({ content, finishReason: 'stop', usage: { prompt_tokens: 6, completion_tokens: 8, total_tokens: 14 } })
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(content)
  })

  it('probes only after format errors and reports the first working protocol', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('route not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('unsupported endpoint', { status: 400 })).mockResolvedValueOnce(Response.json(anthropic))
    vi.stubGlobal('fetch', fetcher)
    await expect(testConnection(model)).resolves.toMatchObject({ ok: true, detectedProtocol: 'anthropic' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/chat/completions', '/responses', '/messages'].map(path => model.baseUrl + path))
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ max_tokens: 64 })
  })

  it.each([[401, 'invalid key'], [403, `permission denied ${model.apiKey}`], [429, 'quota exceeded'],
    [404, 'model_not_found'], [400, 'content_filter']])('stops detection after terminal HTTP %s errors', async (status, detail) => {
    const fetcher = vi.fn(async () => new Response(detail, { status }))
    vi.stubGlobal('fetch', fetcher)
    const result = await testConnection(model)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(model.apiKey)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('allows one parameter retry and one stream recovery within three actual requests', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('unsupported temperature', { status: 400 }))
      .mockResolvedValueOnce(new Response('data: broken\n\n')).mockResolvedValueOnce(Response.json(completions))
    vi.stubGlobal('fetch', fetcher)
    const onChunk = vi.fn()
    await expect(callAI({ model, messages: [...messages], stream: true, onChunk })).resolves.toMatchObject({ content })
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies.map(body => body.stream)).toEqual([true, true, false])
    expect(bodies[2]).not.toHaveProperty('temperature')
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(content)
  })

  it('rejects malformed structured output without publishing a valid-looking nested result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse({ choices: [{ delta: { content: '{"outer":{"answer":true}' }, finish_reason: 'stop' }] })))
    const onChunk = vi.fn()
    await expect(callAI({ model, messages: [...messages], stream: true, onChunk, structuredOutput: 'concise-json' })).rejects.toThrow('完整的 JSON 对象')
    expect(onChunk).not.toHaveBeenCalled()
  })
})
