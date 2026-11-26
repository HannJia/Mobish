import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAI } from './ai'
import type { ModelConfig } from '@/stores/config'

const model: ModelConfig = {
  id: 'cancel-model', name: '取消测试', baseUrl: 'https://example.test', apiKey: 'test', modelName: 'test',
  maxTokens: 100, temperature: 0.7, topP: 0.9,
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('AI 请求取消', () => {
  it.each([false, true])('默认超时为 300 秒（stream=%s）', async stream => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const request = callAI({ model, messages: [{ role: 'user', content: '生成正文' }], stream, onChunk: () => {}, noAutomaticRetry: true })
    const outcome = request.catch((error: unknown) => error)
    const signal = fetchMock.mock.calls[0][1].signal!

    await vi.advanceTimersByTimeAsync(299_999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ message: '请求超时（300秒）' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('用户取消后立即结束且不进入自动重试', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const request = callAI({ model, messages: [{ role: 'user', content: '生成正文' }], signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
