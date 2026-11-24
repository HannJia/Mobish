// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { useConfigStore } from '@/stores/config'
import WebSearchServicePanel from './WebSearchServicePanel.vue'

afterEach(() => vi.unstubAllGlobals())

it('cancels an independent search test, ignores a late result and allows a fresh test', async () => {
  const pinia = createPinia()
  const store = useConfigStore(pinia)
  Object.assign(store.webSearchService, { provider: 'searxng', apiKey: '', baseUrl: 'http://127.0.0.1:8888' })

  let resolveFirst!: (response: Response) => void
  const first = new Promise<Response>(resolve => { resolveFirst = resolve })
  const result = (title: string) => new Response(JSON.stringify({ results: [{ title, url: 'https://example.test/search' }] }))
  const staleResult = result('过期搜索结果')
  const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(first).mockResolvedValueOnce(result('新搜索结果'))
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = shallowMount(WebSearchServicePanel, { global: { plugins: [pinia] } })
  const testButton = () => wrapper.findAll('button').find(button => button.text() === '测试搜索')!

  try {
    await testButton().trigger('click')
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '停止测试')!.trigger('click')
    expect(signal?.aborted).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toBe('已停止搜索测试。')

    await testButton().trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('新搜索结果')
    resolveFirst(staleResult)
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('新搜索结果')
    expect(wrapper.text()).not.toContain('过期搜索结果')
  } finally {
    resolveFirst(staleResult)
    wrapper.unmount()
  }
})
