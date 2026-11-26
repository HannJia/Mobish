// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import AiChatAssistant from './BookChat.vue'
import { chatWithOptionalSearch } from '@/services/chatSearch'
import { useNovelStore } from '@/stores/novel'

vi.mock('@/services/chatSearch', async original => ({
  ...await original<object>(), chatWithOptionalSearch: vi.fn(),
}))
vi.mock('@/v3/feedback', async original => ({
  ...await original<object>(), useDialog: () => ({ warning: vi.fn() }),
}))
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(chatWithOptionalSearch).mockReset() })

describe('chat window background behavior', () => {
  it('clears an unchanged selection prefill when reset and preserves later manual edits', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id, prefill: '旧章节选区正文' }, global: { renderStubDefaultSlot: true, stubs: {
      Input: { props: ['value'], emits: ['update:value'], template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    } } })
    expect(wrapper.get('textarea').element.value).toBe('旧章节选区正文')
    await wrapper.setProps({ prefill: '', prefillVersion: 1 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('')
    await wrapper.setProps({ prefill: '新的选区正文', prefillVersion: 2 })
    await flushPromises()
    await wrapper.setProps({ prefill: '新的选区正文', prefillVersion: 3 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('新的选区正文')
    await wrapper.get('textarea').setValue('作者手动补充的问题')
    await wrapper.setProps({ prefill: '', prefillVersion: 4 })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('作者手动补充的问题')
    wrapper.unmount()
  })

  it('keeps an IME composition in the input when Enter is pressed', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id }, global: { renderStubDefaultSlot: true, stubs: {
      Input: { props: ['value'], emits: ['update:value'], template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />' },
    } } })
    await wrapper.get('textarea').setValue('尚在输入的灵感')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(chatWithOptionalSearch).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('尚在输入的灵感')
    expect(book.chatHistory).toHaveLength(0)
    wrapper.unmount()
  })
  it('renders and copies readable citation names without changing stored replies or source links', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const url = 'https://example.org/article?utm_source=test'
    const content = `引用 ([example.org](${url}))`
    store.addChatMessage(book.id, { id: 'answer', role: 'assistant', content, timestamp: new Date().toISOString(),
      search: { protocol: 'responses', status: 'searched', sources: [{ title: '时代背景资料', url }] } })
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id },
      global: { renderStubDefaultSlot: true, stubs: { ChatSearchEvidence: false } } })
    expect(wrapper.find('.msg-content').text()).toBe('引用 (时代背景资料)')
    expect(wrapper.find('.search-sources a').text()).toBe('时代背景资料')
    expect(wrapper.find('.search-sources a').attributes('href')).toBe(url)
    await wrapper.find('[title="复制内容"]').trigger('click')
    expect(copy).toHaveBeenCalledWith('引用 (时代背景资料)')
    expect(book.chatHistory[0].content).toBe(content)
    expect(book.chatHistory[0].search?.sources[0].url).toBe(url)
    wrapper.unmount()
    copy.mockRestore()
  })

  it('renders merged inline writing directions, prefills follow-up chat, and emits explicit note/next-plan saves', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
    const chapter = store.addChapter(book.id, { title: '第一章', content: '' })!
    const suggestion = {
      id: 'dir-1',
      kind: 'conflict' as const,
      title: '料行清晨催账',
      approach: '以三家料行堵门开篇，把旧账压力和修船手艺一起摆上台面。',
      storyEffect: '立住现实倒计时与主角守铺决心。',
      nextBeat: '林岸推开木门板，看见三张按了红手印的欠条压在刨花上。',
      risk: '注意不要让三家料行一口气同时讲完背景，留出周叔出场的空间。',
      evidence: [{ sourceType: 'plan' as const, sourceLabel: '第1章章纲', excerpt: '清点三家料行旧账' }],
    }
    const wrapper = shallowMount(AiChatAssistant, {
      props: {
        novelId: book.id,
        chapterId: chapter.id,
        draftContent: '',
        adviceResult: {
          mode: 'scene',
          focusLabel: '当前场景',
          focusExcerpt: '',
          contextSummary: '当前章节计划、总纲',
          suggestions: [suggestion],
          nextChapterPlan: null,
          generatedAt: '2026-11-26T00:00:00Z',
        },
      },
      global: { renderStubDefaultSlot: true },
    })

    expect(wrapper.find('.direction-card').text()).toContain('料行清晨催账')
    expect(wrapper.find('.direction-card').text()).toContain('下一拍：')
    const btn = (label: string) => wrapper.findAll('button').find(b => b.text().trim() === label)!
    await btn('沿着聊').trigger('click')
    expect(wrapper.get('textarea').element.value).toContain('沿着「料行清晨催账」')

    await btn('记入本章笔记').trigger('click')
    await btn('存为下一章计划').trigger('click')
    expect(wrapper.emitted('save-direction')).toEqual([
      [{ action: 'note', suggestion }],
      [{ action: 'plan', suggestion }],
    ])

    await wrapper.setProps({ adviceStale: true })
    expect(btn('记入本章笔记').attributes('disabled')).toBeDefined()
    expect(btn('存为下一章计划').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('renders save receipts as clean status notices without copy or save-to-knowledge buttons', async () => {
    const store = useNovelStore()
    const book = store.addNovel({ genre: '现实', subGenre: '年代', tags: [], targetWordCountMin: 10, targetWordCountMax: 20,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    store.addChatMessage(book.id, { id: 'r1', role: 'assistant', content: '【保存成功】已归档到知识库“河岸的灯”。', timestamp: '2026-11-26T00:00:00Z' })
    store.addChatMessage(book.id, { id: 'r2', role: 'assistant', content: '【软件保存回执】旧版回执。', timestamp: '2026-11-26T00:00:01Z' })
    const wrapper = shallowMount(AiChatAssistant, { props: { novelId: book.id }, global: { renderStubDefaultSlot: true } })
    const receipts = wrapper.findAll('.chat-msg.receipt')
    expect(receipts).toHaveLength(2)
    expect(receipts[0].text()).toContain('保存成功')
    expect(receipts[0].text()).not.toContain('【保存成功】')
    expect(receipts[0].findAll('.action-btn')).toHaveLength(0)
    expect(receipts[1].findAll('.action-btn')).toHaveLength(0)
    wrapper.unmount()
  })
})
