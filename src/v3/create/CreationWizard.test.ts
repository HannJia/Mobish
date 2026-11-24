// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import CreateWizard from '@/v3/create/CreationWizard.vue'
import InspirationChat from '@/components/InspirationChat.vue'
import CreationEntrySource from '@/components/CreationEntrySource.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { CreateWizardForm } from '@/types/novel'

const { push, leave, warning, success } = vi.hoisted(() => ({ push: vi.fn(), leave: vi.fn(), warning: vi.fn(), success: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), onBeforeRouteLeave: (guard: () => unknown) => leave.mockImplementation(guard) }))
vi.mock('@/v3/feedback', async importOriginal => ({
  ...await importOriginal<object>(), useMessage: () => ({ success, error: vi.fn() }),
  useDialog: () => ({ warning }),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  push.mockReset()
  leave.mockReset()
  warning.mockReset()
  success.mockReset()
  vi.spyOn(useReconstructionWorkspaceStore(), 'persistInitialCreation').mockResolvedValue()
})
const options = { global: { renderStubDefaultSlot: true, stubs: {
  CreationModePicker: false,
} } }

type WizardWrapper = ReturnType<typeof shallowMount>
async function choose(wrapper: WizardWrapper, writing: 'ai' | 'manual', setup: 'inspiration' | 'custom') {
  await wrapper.get(`input[name="creation-writing-mode"][value="${writing}"]`).setValue(true)
  await wrapper.get(`input[name="creation-setup-method"][value="${setup}"]`).setValue(true)
  await wrapper.get('#start-creation-btn').trigger('click')
}
function proposal(writingMode: 'ai' | 'manual'): CreateWizardForm {
  const store = useNovelStore()
  const settings = store.defaultSettings()
  settings.protagonist.name = '陈安'
  return { genre: 'urban', subGenre: 'business', tags: ['经商'],
    targetWordCountMin: 80, targetWordCountMax: 100, writingMode,
    writingStyle: store.defaultWritingStyle(), settings }
}

describe('independent writing and settings choices', () => {
  it.each([
    ['作品名称', 'V3Input', 'placeholder', '在作品契约中继续确认', '修灯人的故事'],
    ['主角', 'V3Input', 'placeholder', '主角姓名', '顾宁'],
    ['故事起点', 'V3Number', 'aria-label', '起始故事日', 0],
    ['起点名称', 'V3Input', 'placeholder', '例如：玄历三年春，抵达当天', '抵达当天'],
  ])('protects unfinished %s on navigation and refresh', async (_label, component, attribute, selector, value) => {
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'custom')
    expect(await leave()).toBe(true)
    if (_label === '主角') {
      await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
      await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
      await wrapper.get('#wizard-next-btn').trigger('click')
    }
    const field = wrapper.findAllComponents({ name: String(component) }).find(item => item.attributes(String(attribute)) === selector)!
    field.vm.$emit('update:value', value)
    await flushPromises()
    const navigating = leave()
    expect(warning).toHaveBeenCalledOnce()
    warning.mock.calls[0][0].onNegativeClick()
    expect(await navigating).toBe(false)
    expect(field.props('value')).toBe(value)
    const refresh = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(refresh)
    expect(refresh.defaultPrevented).toBe(true)
    const exiting = leave()
    warning.mock.calls[1][0].onPositiveClick()
    expect(await exiting).toBe(true)
    wrapper.unmount()
    const afterUnmount = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  })

  it('protects a selected genre and keeps the editing step when cancelling or confirming the same setup', async () => {
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'custom')
    await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
    const navigating = leave()
    warning.mock.calls[0][0].onMaskClick()
    expect(await navigating).toBe(false)
    await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    const change = () => wrapper.findAll('button').find(button => button.text() === '更换搭配')!.trigger('click')
    await change()
    await wrapper.get('input[name="creation-writing-mode"][value="ai"]').setValue(true)
    await wrapper.get('input[name="creation-setup-method"][value="inspiration"]').setValue(true)
    await wrapper.get('#wizard-back-btn').trigger('click')
    expect(wrapper.get('#wizard-page-2').isVisible()).toBe(true)
    expect(wrapper.findComponent(InspirationChat).props('form')).toMatchObject({ writingMode: 'manual', genre: 'urban' })
    expect(push).not.toHaveBeenCalled()
    await change()
    await choose(wrapper, 'ai', 'custom')
    expect(wrapper.get('#wizard-page-2').isVisible()).toBe(true)
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('ai')
    wrapper.unmount()
  })

  it('keeps organized settings in discussion and goes directly to the contract step on apply', async () => {
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'inspiration')
    const chat = wrapper.findComponent(InspirationChat)
    expect(wrapper.classes()).toContain('discussing-inspiration')
    chat.vm.$emit('draft-change', proposal('ai'))
    await flushPromises()
    expect(chat.props('active')).toBe(true)
    expect(chat.props('form')).toMatchObject({ writingMode: 'manual', settings: { protagonist: { name: '陈安' } } })
    expect(useNovelStore().novels).toHaveLength(0)
    chat.vm.$emit('apply', chat.props('form'), [{ role: 'user', content: '当前讨论' }])
    await flushPromises()
    expect(chat.props('active')).toBe(false)
    expect(wrapper.classes()).not.toContain('discussing-inspiration')
    expect(wrapper.get('.creation-entry-panel h2').text()).toBe('作品契约')
    expect(wrapper.find('#wizard-steps').exists()).toBe(false)
    expect(useNovelStore().novels).toHaveLength(0)
    wrapper.unmount()
  })

  it('opens inspiration immediately and commits metadata, full discussion and chosen title with the contract', async () => {
    const store = useNovelStore()
    const wrapper = shallowMount(CreateWizard, { ...options, props: { appearance: 'v3' } })
    expect(wrapper.find('#origin-idea').exists()).toBe(false)
    await wrapper.get('input[name="creation-setup-method"][value="inspiration"]').setValue(true)
    expect(wrapper.find('#origin-idea').exists()).toBe(false)
    expect(wrapper.find('.origin-seed').exists()).toBe(false)
    await wrapper.get('#start-creation-btn').trigger('click')
    expect(store.novels).toHaveLength(0)
    const chat = wrapper.findComponent(InspirationChat)
    expect(chat.props('active')).toBe(true)
    expect(wrapper.find('.creation-entry-panel').exists()).toBe(false)
    const idea = '合成灵感：渡口的守灯人正在等待一封旧信。'
    const discussion = [{ role: 'user', content: idea }, { role: 'assistant', content: '第一幕从旧信送达开始。' }]
    chat.vm.$emit('apply', { ...proposal('manual'), workingTitle: '渡口守灯人', storyTimeOrigin: { day: 0, label: '旧信送达' },
      titleSuggestions: [{ title: '灯下旧信', reason: '突出开篇意象' }] }, discussion)
    await flushPromises()
    expect(wrapper.findComponent(CreationEntrySource).exists()).toBe(false)
    expect(wrapper.findAllComponents(V3Input).find(field => field.attributes('aria-label') === '新作品名称')?.props('value')).toBe('渡口守灯人')
    expect(wrapper.findAllComponents(V3Number).find(field => field.attributes('aria-label') === '创建起始故事日')?.props('value')).toBe(0)
    await wrapper.get('.entry-title-options button').trigger('click')
    await wrapper.get('#entry-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels).toHaveLength(1)
    expect(store.novels[0]).toMatchObject({ title: '灯下旧信', storyClock: { origin: { day: 0, label: '旧信送达' } }, inspirationHistory: discussion })
    expect(useReconstructionWorkspaceStore().getCreationDraft(store.novels[0].id)?.initialInput).toMatchObject({ method: 'inspiration', idea, includeDiscussion: true })
    expect(useReconstructionWorkspaceStore().getCreationDraft(store.novels[0].id)?.approval.contract).toBeUndefined()
    wrapper.unmount()
  })

  it('waits for the structured draft to be saved before opening the next page', async () => {
    const store = useNovelStore()
    let saved!: () => void
    vi.mocked(useReconstructionWorkspaceStore().persistInitialCreation).mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve }))
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'custom')
    await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
    await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(store.novels).toHaveLength(0)
    expect(useReconstructionWorkspaceStore().creationDraftsByNovel).toEqual({})
    saved()
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/generate/' + store.novels[0].id)
    wrapper.unmount()
  })

  it('keeps a failed creation unpublished and allows a retry', async () => {
    const store = useNovelStore()
    const persist = vi.mocked(useReconstructionWorkspaceStore().persistInitialCreation)
    persist.mockRejectedValueOnce(new Error('测试磁盘失败'))
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'custom')
    await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
    await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()
    await wrapper.get('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels).toHaveLength(1)
    expect(push).toHaveBeenCalledWith('/generate/' + store.novels[0].id)
    wrapper.unmount()
  })

  it('retries navigation after a saved creation without creating a second book', async () => {
    const store = useNovelStore(), persist = vi.mocked(useReconstructionWorkspaceStore().persistInitialCreation)
    push.mockRejectedValueOnce(new Error('模拟导航失败'))
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'manual', 'custom')
    await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
    await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-next-btn').trigger('click')
    await wrapper.get('#wizard-create-btn').trigger('click'); await flushPromises()
    expect(store.novels).toHaveLength(1); expect(persist).toHaveBeenCalledTimes(1)
    const bookId = store.novels[0].id
    expect(wrapper.get('#wizard-create-btn').text()).toBe('打开已创建的作品')
    await wrapper.get('#wizard-create-btn').trigger('click'); await flushPromises()
    expect(store.novels).toHaveLength(1); expect(persist).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenLastCalledWith('/generate/' + bookId)
    wrapper.unmount()
  })
  it('offers two independent single-choice groups and waits for an explicit continue', async () => {
    const wrapper = shallowMount(CreateWizard, options)
    expect(wrapper.findAll('.choice-group legend').map(item => item.text())).toEqual(['正文创作方式', '作品创建起点'])
    expect(wrapper.get('#start-creation-btn').attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="creation-writing-mode"][value="ai"]').setValue(true)
    await wrapper.get('input[name="creation-setup-method"][value="custom"]').setValue(true)
    await wrapper.get('input[name="creation-setup-method"][value="inspiration"]').setValue(true)
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('ai')
    expect(wrapper.findComponent(InspirationChat).props('active')).toBe(false)
    expect(wrapper.get('#start-creation-btn').attributes('disabled')).toBeUndefined()
    expect(useNovelStore().novels).toHaveLength(0)
    wrapper.unmount()
  })

  it.each([
    ['ai', 'inspiration'], ['manual', 'inspiration'], ['ai', 'custom'], ['manual', 'custom'],
  ] as const)('creates %s + %s and keeps the chosen writing mode through outline creation', async (writing, setup) => {
    const store = useNovelStore()
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, writing, setup)
    const chat = wrapper.findComponent(InspirationChat)
    expect(chat.props('form').writingMode).toBe(writing)
    expect(chat.props('active')).toBe(setup === 'inspiration')
    if (setup === 'inspiration') {
      // A stale or model-produced mode must never override the author's choice.
      chat.vm.$emit('apply', proposal(writing === 'ai' ? 'manual' : 'ai'), [{ role: 'user', content: '九十年代创业' }])
    } else {
      await wrapper.findAll('.genre-btn').find(button => button.text() === '都市')!.trigger('click')
      await wrapper.findAll('.sub-genre-btn').find(button => button.text() === '商战职场')!.trigger('click')
    }
    await flushPromises()
    expect(store.novels).toHaveLength(0)
    expect(chat.props('active')).toBe(false)
    expect(chat.props('form').writingMode).toBe(writing)
    if (setup === 'inspiration') await wrapper.get('#entry-create-btn').trigger('click')
    else {
      await wrapper.get('#wizard-next-btn').trigger('click')
      await wrapper.get('#wizard-next-btn').trigger('click')
      await wrapper.get('#wizard-create-btn').trigger('click')
    }
    await flushPromises()
    expect(store.novels).toHaveLength(1)
    expect(useReconstructionWorkspaceStore().getCreationDraft(store.novels[0].id)?.contract.approval).toBe('draft')
    expect(useReconstructionWorkspaceStore().getCreationDraft(store.novels[0].id)?.approval.contract).toBeUndefined()
    expect(store.novels[0].writingMode).toBe(writing)
    if (setup === 'inspiration') {
      expect(store.novels[0].settings.protagonist.name).toBe('陈安')
      expect(store.novels[0].inspirationHistory?.[0].content).toBe('九十年代创业')
    } else expect(store.novels[0].inspirationHistory).toHaveLength(0)
    expect(store.novels[0].chatHistory).toHaveLength(0)
    expect(push).toHaveBeenCalledWith(`/generate/${store.novels[0].id}`)
    wrapper.unmount()
  })

  it('preserves checked settings/history when switching the combination and ignores inactive results', async () => {
    const store = useNovelStore()
    const wrapper = shallowMount(CreateWizard, options)
    await choose(wrapper, 'ai', 'inspiration')
    const chat = wrapper.findComponent(InspirationChat)
    chat.vm.$emit('apply', proposal('ai'), [{ role: 'user', content: '已经确认的灵感' }])
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '更换搭配')!.trigger('click')
    chat.vm.$emit('apply', { ...proposal('manual'), genre: '不应采纳的旧回复' }, [])
    await choose(wrapper, 'manual', 'custom')
    expect(chat.props('form')).toMatchObject({ genre: 'urban', writingMode: 'manual', settings: { protagonist: { name: '陈安' } } })
    await wrapper.find('#wizard-next-btn').trigger('click')
    await wrapper.find('#wizard-next-btn').trigger('click')
    await wrapper.find('#wizard-create-btn').trigger('click')
    await flushPromises()
    expect(store.novels[0].writingMode).toBe('manual')
    expect(store.novels[0].inspirationHistory?.[0].content).toBe('已经确认的灵感')
    expect(store.novels[0].chatHistory).toHaveLength(0)
    wrapper.unmount()
  })

  it('defaults new books to manual mode independently of other books and the setup method', async () => {
    const existing = useNovelStore().addNovel(proposal('ai'))
    const wrapper = shallowMount(CreateWizard, options)
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('manual')
    await wrapper.get('input[name="creation-setup-method"][value="custom"]').setValue(true)
    await wrapper.get('#start-creation-btn').trigger('click')
    expect(wrapper.findComponent(InspirationChat).props('form').writingMode).toBe('manual')
    expect(existing.writingMode).toBe('ai')
    wrapper.unmount()
  })
})
