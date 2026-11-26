// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import SaveChatKnowledge from './SaveChatKnowledge.vue'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { extractChatKnowledge } from '@/services/chatKnowledgeExtraction'
import { knowledgeOutline } from '@/services/knowledgeText'
import { knowledgeSections } from '@/services/knowledgeSections'

vi.mock('@/services/chatKnowledgeExtraction', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/chatKnowledgeExtraction')>()
  return {
    ...actual,
    extractChatKnowledge: vi.fn(),
  }
})
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useConfigStore().models = [{ id: 'local', name: 'local', baseUrl: 'https://example.test',
    modelName: 'test', apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 8000 }]
  vi.mocked(extractChatKnowledge).mockResolvedValue({
    title: '县城田赋与税制规范', category: '世界观', summary: '县城每亩缴粮三升。', tags: ['县城', '税制'],
  })
})
afterEach(() => vi.restoreAllMocks())

function setup(options: { mode?: 'book' | 'inspiration'; bookTitle?: string; preferred?: boolean; content?: string } = {}) {
  const store = useKnowledgeStore()
  const kb = store.createKB(options.bookTitle || '历史资料')
  const flush = vi.spyOn(store, 'flushPendingSaves').mockResolvedValue()
  const wrapper = shallowMount(SaveChatKnowledge, {
    props: {
      show: true,
      content: options.content ?? '顺着这个思路，县城每亩缴粮三升。',
      preferredIds: options.preferred === false ? [] : [kb.id],
      mode: options.mode ?? 'book',
      bookTitle: options.bookTitle ?? '历史资料',
    },
    global: { renderStubDefaultSlot: true, stubs: {
      V3Modal: { name: 'V3Modal', template: '<section><slot /><slot name="footer" /></section>' },
      V3Input: { name: 'V3Input', props: ['value', 'disabled', 'placeholder'], emits: ['update:value'], template: '<input :value="value" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
    } },
  })
  return { wrapper, store, kb, flush }
}
type Wrapper = ReturnType<typeof setup>['wrapper']
const saveButton = (wrapper: Wrapper) => wrapper.findAll('button').find(button => /确认保存|重试保存/.test(button.text()))!

describe('explicit chat knowledge writes', () => {
  it('removes manual new-kb name input and manual category select, defaulting to auto book/untitled library', async () => {
    const store = useKnowledgeStore()
    vi.spyOn(store, 'flushPendingSaves').mockResolvedValue()
    const wrapper = shallowMount(SaveChatKnowledge, {
      props: { show: true, content: '林岸回港接铺。', mode: 'book', bookTitle: '河岸的灯', preferredIds: [] },
      global: { renderStubDefaultSlot: true, stubs: {
        V3Modal: { name: 'V3Modal', template: '<section><slot /><slot name="footer" /></section>' },
        V3Input: { name: 'V3Input', props: ['value', 'disabled', 'placeholder'], emits: ['update:value'], template: '<input :value="value" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
      } },
    })
    await flushPromises()
    expect(wrapper.find('[aria-label="新知识库名称"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="条目分类"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="自动分类"]').text()).toContain('世界观')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    const created = store.knowledgeBases.find(item => item.name === '河岸的灯')!
    expect(created).toBeTruthy()
    expect(created.entries).toHaveLength(1)
    expect(created.entries[0].title).toBe('《河岸的灯》讨论笔记')
    expect(knowledgeOutline(created.entries[0].content).map(item => item.title)).toEqual(['县城田赋与税制规范'])
    wrapper.unmount()
  })

  it('extracts with the same model assigned to chat rather than the review model', async () => {
    const config = useConfigStore()
    config.models = [
      { ...config.models[0], id: 'dialog', modelName: 'chat-model' },
      { ...config.models[0], id: 'review', modelName: 'review-model' },
    ]
    config.assignments.chat = 'dialog'
    config.assignments.review = 'review'
    const { wrapper } = setup()
    await flushPromises()
    expect(vi.mocked(extractChatKnowledge).mock.calls[0][0].modelName).toBe('chat-model')
    wrapper.unmount()
  })

  it('appends consecutive saves into one structured document with clear directory headings', async () => {
    const { wrapper, kb, flush } = setup({ mode: 'book', bookTitle: '历史资料' })
    expect(kb.entries).toHaveLength(0)
    expect(flush).not.toHaveBeenCalled()
    await flushPromises()
    expect(wrapper.get('[aria-label="目录标题"]').element.getAttribute('value')).toBe('县城田赋与税制规范')
    await wrapper.get('[aria-label="目录标题"]').setValue('核实后的县城税制')
    await wrapper.get('[aria-label="知识条目内容"]').setValue('经作者核实，每亩缴粮两升。')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(kb.entries[0].title).toBe('《历史资料》讨论笔记')
    expect(kb.entries[0].content).toContain('## 核实后的县城税制')
    expect(kb.entries[0].content).toContain('经作者核实，每亩缴粮两升。')
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ kbId: kb.id, title: '核实后的县城税制', entryTitle: '《历史资料》讨论笔记' })

    vi.mocked(extractChatKnowledge).mockResolvedValueOnce({
      title: '渡口盐运收费规则', category: '地点', summary: '渡口每船收银二两。', tags: ['渡口', '盐运'],
    })
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true, content: '渡口每船收银二两。' })
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(knowledgeOutline(kb.entries[0].content).map(item => item.title)).toEqual(['核实后的县城税制', '渡口盐运收费规则'])
    expect(knowledgeSections(kb.entries[0]).map(section => section.path[0])).toEqual(['核实后的县城税制', '渡口盐运收费规则'])
    wrapper.unmount()
  })

  it('auto-creates 待命名 library in inspiration mode without overwriting existing reference library', async () => {
    const store = useKnowledgeStore()
    const refKb = store.createKB('通用史料库')
    vi.spyOn(store, 'flushPendingSaves').mockResolvedValue()
    const wrapper = shallowMount(SaveChatKnowledge, {
      props: { show: true, content: '主角回到河港老街。', mode: 'inspiration', preferredIds: [refKb.id] },
      global: { renderStubDefaultSlot: true, stubs: {
        V3Modal: { name: 'V3Modal', template: '<section><slot /><slot name="footer" /></section>' },
        V3Input: { name: 'V3Input', props: ['value', 'disabled', 'placeholder'], emits: ['update:value'], template: '<input :value="value" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />' },
      } },
    })
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(refKb.entries).toHaveLength(0)
    const untitled = store.knowledgeBases.find(item => item.name === '待命名')!
    expect(untitled).toBeTruthy()
    expect(untitled.entries).toHaveLength(1)
    expect(untitled.entries[0].title).toBe('灵感讨论笔记')
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ kbId: untitled.id, kbName: '待命名' })
    wrapper.unmount()
  })

  it('cancels without creating content and rejects deleted targets', async () => {
    const { wrapper, store, kb } = setup()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    expect(kb.entries).toHaveLength(0)
    expect(wrapper.emitted('saved')).toBeUndefined()
    store.knowledgeBases = []
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('已不存在')
    expect(store.knowledgeBases).toHaveLength(0)
    wrapper.unmount()
  })

  it('does not report success before persistence or duplicate a failed write on retry', async () => {
    const { wrapper, kb, flush } = setup()
    await flushPromises()
    flush.mockRejectedValueOnce(new Error('写盘失败'))
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('不会重复创建')
    expect(kb.entries).toHaveLength(1)
    const contentAfterFirst = kb.entries[0].content
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries).toHaveLength(1)
    expect(kb.entries[0].content).toBe(contentAfterFirst)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('waits for extraction before saving, keeps title empty until AI responds, and ignores late results', async () => {
    let finish!: (value: { title: string; category: string; summary: string; tags: string[] }) => void
    vi.mocked(extractChatKnowledge).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, kb } = setup()
    expect(wrapper.get('[aria-label="目录标题"]').element.getAttribute('value')).toBe('')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await saveButton(wrapper).trigger('click')
    expect(kb.entries).toHaveLength(0)
    await wrapper.setProps({ show: false })
    finish({ title: '晚到标题', category: '人物', summary: '晚到摘要', tags: [] })
    await flushPromises()
    expect(kb.entries).toHaveLength(0)
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(wrapper.get('[aria-label="目录标题"]').element.getAttribute('value')).not.toBe('晚到标题')
    wrapper.unmount()
  })

  it('falls back to cleaned title and auto-inferred category when extraction fails', async () => {
    vi.mocked(extractChatKnowledge).mockRejectedValueOnce(new Error('接口超时'))
    const { wrapper, kb } = setup({ content: '顺着这个思路，林岸的角色性格与身世设定非常鲜明。' })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('接口超时')
    expect(wrapper.get('[aria-label="目录标题"]').element.getAttribute('value')).toBe('林岸的角色性格与身世设定非常鲜明')
    expect(wrapper.get('[aria-label="自动分类"]').text()).toContain('人物')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(kb.entries[0].content).toContain('## 林岸的角色性格与身世设定非常鲜明')
    wrapper.unmount()
  })
})
