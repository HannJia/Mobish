// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import InspirationChat from './InspirationChat.vue'
import {
  chatInspiration,
  compactInspirationContext,
  extractInspirationSettings,
  inspirationContextLength,
  inspirationSettingsSnapshot,
} from '@/services/inspiration'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import SaveChatKnowledge from './SaveChatKnowledge.vue'
import InspirationSettingsSummary from './InspirationSettingsSummary.vue'
import type { CreateWizardForm } from '@/types/novel'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { parseInspirationSession } from '@/services/inspirationSessions'
import { saveInspirationSessions } from '@/services/db/inspirationSessions'
import { dialogs, runDialogAction } from '@/v3/feedback'

vi.mock('@/services/inspiration', async original => ({
  ...await original<object>(),
  chatInspiration: vi.fn(),
  compactInspirationContext: vi.fn(),
  extractInspirationSettings: vi.fn(),
  inspirationContextLength: vi.fn(() => 0),
  INSPIRATION_COMPACT_AT: 18_000,
  INSPIRATION_CONTEXT_BUDGET: 24_000,
}))
vi.mock('@/services/db/inspirationSessions', () => ({
  loadInspirationSessions: async () => JSON.parse(localStorage.getItem('novel-writer-inspiration-sessions') || '[]').map(parseInspirationSession),
  saveInspirationSessions: vi.fn(async sessions => localStorage.setItem('novel-writer-inspiration-sessions', JSON.stringify(sessions))),
}))
beforeEach(async () => {
  setActivePinia(createPinia()); vi.resetAllMocks(); localStorage.clear(); await useInspirationSessionsStore().initialize()
  vi.mocked(compactInspirationContext).mockImplementation(async (_model, messages) => ({ content: '已聊内容摘要，尚未决定的方向保持开放。', messageCount: messages.length }))
})
afterEach(() => vi.restoreAllMocks())

function mountChat(active = true, initialIdea = '') {
  const store = useNovelStore()
  const form: CreateWizardForm = { genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() }
  useConfigStore().models = [{ id: 'local', name: 'local', baseUrl: 'https://example.test', modelName: 'test',
    apiKey: 'synthetic', temperature: 0.7, topP: 0.9, maxTokens: 8000 }]
  return shallowMount(InspirationChat, { props: { form, active, initialIdea }, global: { renderStubDefaultSlot: true, stubs: {
    InspirationSettingsSummary: false,
    V3Input: { name: 'V3Input', props: ['value', 'disabled'], emits: ['update:value'], template: '<textarea :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />' },
  } } })
}
type Wrapper = ReturnType<typeof mountChat>
function button(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)!
}
async function selectSession(wrapper: Wrapper, id: string) {
  await wrapper.get('[data-inspiration-history]').trigger('click')
  await wrapper.get(`[data-history-session="${id}"]`).trigger('click')
}

it('confirms session deletion, retains other sessions and clears a deleted current draft after saving', async () => {
  const store = useInspirationSessionsStore()
  store.adopt(Array.from({ length: 6 }, (_, index) => ({
    id: `session-${index}`, title: `历史 ${index}`, updatedAt: '2026-11-24T00:00:00.000Z',
    messages: [], knowledgeIds: null, draft: index === 0 ? '带入的灵感' : '', webSearch: false,
  })))
  const wrapper = mountChat(true, '带入的灵感')
  await wrapper.get('[data-inspiration-history]').trigger('click')
  expect(wrapper.findAll('[data-history-session]')).toHaveLength(6)
  await wrapper.get('[data-delete-history-session="session-0"]').trigger('click')
  await runDialogAction(dialogs[dialogs.length - 1].id, 'negative')
  expect(store.sessions).toHaveLength(6)

  await wrapper.get('[data-delete-history-session="session-0"]').trigger('click')
  vi.mocked(saveInspirationSessions).mockRejectedValueOnce(new Error('合成写入失败'))
  await runDialogAction(dialogs[dialogs.length - 1].id, 'positive')
  expect(store.sessions).toHaveLength(6)
  await runDialogAction(dialogs[dialogs.length - 1].id, 'positive')
  expect(store.sessions.map(session => session.id)).toEqual(['session-1', 'session-2', 'session-3', 'session-4', 'session-5'])
  expect(wrapper.get('textarea').element.value).toBe('')
  wrapper.unmount()
  await store.flushPendingSaves()
  setActivePinia(createPinia())
  const reopened = useInspirationSessionsStore()
  await reopened.initialize()
  expect(reopened.sessions.map(session => session.id)).toEqual(['session-1', 'session-2', 'session-3', 'session-4', 'session-5'])
})

describe('inspiration search controls', () => {
  it('keeps the save entry in the action row when knowledge citations are expanded', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({
      content: '可以把旧表当作线索。',
      saveTitle: '旧表线索',
      knowledgeReferences: [{
        label: '资料1', baseId: 'archive', entryId: 'clock', sourceVersion: 'v1',
        baseName: '城市旧档', entryTitle: '旧钟表档案', path: ['渡口', '交接记录'], start: 0, end: 8,
      }],
    })
    await wrapper.get('textarea').setValue('旧表里有哪些线索？')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const actions = wrapper.get('.inspiration-reply-actions')
    expect(actions.find('.inspiration-knowledge-references').exists()).toBe(false)
    await actions.get('.inspiration-reference-toggle').trigger('click')
    expect(actions.get('.inspiration-reference-toggle').attributes('aria-expanded')).toBe('true')
    expect(actions.get('.inspiration-save-reminder + .inspiration-knowledge-references').text()).toContain('旧钟表档案')
    await actions.get('.inspiration-save-reminder').trigger('click')
    expect(wrapper.getComponent(SaveChatKnowledge).props('content')).toContain('城市旧档 › 旧钟表档案 › 渡口 › 交接记录')
    wrapper.unmount()
  })

  it('preserves the draft when collapsing settings and opening history', async () => {
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('姐姐失踪前留下了一盏旧灯。')
    await button(wrapper, '已整理的设定').trigger('click')
    expect(wrapper.get('.inspiration-workspace').classes()).toContain('show-settings')
    await button(wrapper, '灵感对话').trigger('click')
    expect(wrapper.get('textarea').element.value).toBe('姐姐失踪前留下了一盏旧灯。')
    await button(wrapper, '已整理的设定').trigger('click')
    wrapper.getComponent(InspirationSettingsSummary).vm.$emit('collapse')
    await flushPromises()
    expect(wrapper.get('.inspiration-workspace').classes()).not.toContain('show-settings')
    expect(wrapper.get('.inspiration-workspace').classes()).toContain('settings-collapsed')
    await wrapper.get('[data-inspiration-history]').trigger('click')
    expect(wrapper.get('[data-inspiration-history]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('textarea').element.value).toBe('姐姐失踪前留下了一盏旧灯。')
    expect(chatInspiration).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('sends the latest suggested question once, preserves the draft, and restores new suggestions after reopening', async () => {
    const wrapper = mountChat()
    const questions = ['姐姐留下的线索可以有哪些？', '主角会遇到什么阻力？', '怎样确定故事的时代氛围？']
    vi.mocked(chatInspiration).mockResolvedValue({ content: '先聊聊姐姐留下的线索。', questions })
    await wrapper.get('textarea').setValue('主角在寻找姐姐。')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.get('.inspiration-follow-ups').findAll('button').map(item => item.text().replace('↗', '').trim())).toEqual(questions)
    wrapper.getComponent(SaveChatKnowledge).vm.$emit('saved', { kbId: 'test-kb', kbName: '验收资料', title: '线索' })
    await flushPromises()
    expect(wrapper.text()).toContain('【保存成功】已归档到知识库“验收资料”，目录项「线索」，并已挂载至本轮讨论。')
    expect(wrapper.get('.inspiration-follow-ups').findAll('button').map(item => item.text().replace('↗', '').trim())).toEqual(questions)
    const draft = '我还没写完的想法'
    await wrapper.get('textarea').setValue(draft)
    let complete!: (reply: { content: string; questions: string[] }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const suggestion = wrapper.get('.inspiration-follow-ups button')
    await suggestion.trigger('click')
    await suggestion.trigger('click')
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(2)
    expect(vi.mocked(chatInspiration).mock.calls[1][1].slice(-1)).toEqual([{ role: 'user', content: questions[0] }])
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(draft)
    expect(wrapper.find('.inspiration-follow-ups').exists()).toBe(false)
    const nextQuestions = ['这条线索可以如何误导主角？', '谁会阻止他调查？', '怎样安排第一次转折？']
    complete({ content: '可以从一盏未修完的灯开始。', questions: nextQuestions })
    await flushPromises()
    expect(wrapper.get('.inspiration-follow-ups').text()).toContain(nextQuestions[0])
    expect(wrapper.get('.inspiration-follow-ups').text()).not.toContain(questions[0])
    wrapper.unmount()
    const reopened = mountChat()
    expect(reopened.get('.inspiration-follow-ups').findAll('button')).toHaveLength(3)
    expect(reopened.get('.inspiration-follow-ups').text()).toContain(nextQuestions[0])
    expect((reopened.get('textarea').element as HTMLTextAreaElement).value).toBe(draft)
    expect(chatInspiration).toHaveBeenCalledTimes(2)
    reopened.unmount()
  })

  it('organizes without leaving, uses edited settings in continued chat, and only finishes on explicit completion', async () => {
    const wrapper = mountChat()
    expect(wrapper.get('.summary-status').text()).toContain('尚未整理')
    vi.mocked(chatInspiration).mockResolvedValue({ content: '继续讨论姐姐的线索。' })
    await wrapper.get('textarea').setValue('主角叫林晚，在海边修灯，正在寻找姐姐。'.repeat(200))
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const form = JSON.parse(JSON.stringify(wrapper.props('form'))) as CreateWizardForm
    form.settings.protagonist.name = '林晚'
    form.settings.worldBuilding.worldType = '海边的修灯铺'
    vi.mocked(extractInspirationSettings).mockResolvedValue(form)
    vi.mocked(compactInspirationContext).mockResolvedValue({ content: '林晚在寻找姐姐，姐姐的去向尚未决定。', messageCount: 2 })
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.getComponent(InspirationSettingsSummary).props('form').settings.protagonist.name).toBe('林晚')
    expect(wrapper.findAll('.inspiration-message')).toHaveLength(2)
    expect(wrapper.get('.summary-status').text()).toContain('已整理到最新讨论')
    expect(useInspirationSessionsStore().sessions[0].settingsMessageCount).toBe(2)
    expect(vi.mocked(compactInspirationContext).mock.calls[0][5]).toBe(0)
    const edited = JSON.parse(JSON.stringify(form)) as CreateWizardForm
    edited.settings.protagonist.name = '苏晴'
    wrapper.getComponent(InspirationSettingsSummary).vm.$emit('draft-change', edited)
    await flushPromises()
    expect(JSON.parse(useInspirationSessionsStore().sessions[0].settingsDraft!).settings.protagonist.name).toBe('苏晴')
    await wrapper.get('textarea').setValue('接着聊姐姐的线索。')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const continued = vi.mocked(chatInspiration).mock.calls[1]
    expect(continued[6]).toEqual({ content: '林晚在寻找姐姐，姐姐的去向尚未决定。', messageCount: 2 })
    expect(continued[7]?.settings.protagonist.name).toBe('苏晴')
    expect(wrapper.get('.summary-status').text()).toContain('有新增讨论待整理')
    await button(wrapper, '完成').trigger('click')
    expect(wrapper.emitted('apply')?.[0][0]).toMatchObject({ settings: { protagonist: { name: '苏晴' } } })
    expect((wrapper.emitted('apply')?.[0][1] as unknown[])).toHaveLength(4)
    expect(extractInspirationSettings).toHaveBeenCalledTimes(1)
    expect(chatInspiration).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    const reopened = mountChat()
    expect(reopened.getComponent(InspirationSettingsSummary).props('form').settings.protagonist.name).toBe('苏晴')
    expect(reopened.get('.summary-status').text()).toContain('有新增讨论待整理')
    reopened.unmount()
  })

  it('finishes an unorganized discussion with accurate status and no model extraction', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '先聊聊姐姐的线索。' })
    await wrapper.get('textarea').setValue('修灯人寻找姐姐。')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.get('.summary-status').text()).toContain('尚未整理')
    await button(wrapper, '完成').trigger('click')
    expect(wrapper.emitted('apply')).toHaveLength(1)
    expect(extractInspirationSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('restores settings with the selected history session instead of keeping another conversation settings', async () => {
    const wrapper = mountChat(false)
    const makeSettings = (name: string) => {
      const form = JSON.parse(JSON.stringify(wrapper.props('form'))) as CreateWizardForm
      form.settings.protagonist.name = name
      return inspirationSettingsSnapshot(form)
    }
    useInspirationSessionsStore().adopt([
      parseInspirationSession({ id: 'first', title: '第一部', updatedAt: '2026-11-14T00:00:00Z', messages: [], settingsDraft: makeSettings('林晚') }),
      parseInspirationSession({ id: 'second', title: '第二部', updatedAt: '2026-11-14T01:00:00Z', messages: [], settingsDraft: makeSettings('苏晴') }),
    ])
    await wrapper.setProps({ active: true })
    await selectSession(wrapper, 'first')
    await flushPromises()
    expect(wrapper.getComponent(InspirationSettingsSummary).props('form').settings.protagonist.name).toBe('林晚')
    await selectSession(wrapper, 'second')
    await flushPromises()
    expect(wrapper.getComponent(InspirationSettingsSummary).props('form').settings.protagonist.name).toBe('苏晴')
    wrapper.unmount()
  })

  it.each(['停止', '失败'] as const)('does not replace current settings or context when compression ends with %s', async action => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '先确定人物。' })
    await wrapper.get('textarea').setValue('修灯人的故事。')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const form = JSON.parse(JSON.stringify(wrapper.props('form'))) as CreateWizardForm
    form.settings.protagonist.name = '迟到的结果'
    vi.mocked(extractInspirationSettings).mockResolvedValue(form)
    let complete!: (context: { content: string; messageCount: number }) => void
    let fail!: (error: Error) => void
    vi.mocked(compactInspirationContext).mockImplementation(() => new Promise((resolve, reject) => { complete = resolve; fail = reject }))
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    if (action === '停止') {
      await button(wrapper, '停止').trigger('click')
      complete({ content: '迟到的摘要', messageCount: 2 })
    } else fail(new Error('整理后的压缩失败'))
    await flushPromises()
    expect(wrapper.getComponent(InspirationSettingsSummary).props('form').settings.protagonist.name).toBe('')
    expect(useInspirationSessionsStore().sessions[0].context).toBeUndefined()
    expect(wrapper.emitted('apply')).toBeUndefined()
    if (action === '失败') expect(wrapper.get('[role="alert"]').text()).toContain('压缩失败')
    wrapper.unmount()
  })

  it('sends a nonempty idea once for an explicit discussion request, without repeating on return', async () => {
    const idea = '守灯人在暴雨夜收到一封旧信。'
    const wrapper = mountChat(false, idea)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '先聊聊这封信的来历。' })
    await wrapper.setProps({ active: true, startRequest: { id: 1, idea } })
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: idea }])
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.setProps({ startRequest: { id: 1, idea } })
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true, startRequest: { id: 2, idea } })
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(useInspirationSessionsStore().sessions[0].messages.filter(item => item.role === 'user')).toEqual([{ role: 'user', content: idea }])
    wrapper.unmount()
  })

  it('automatically sends only the entered idea while preserving an unrelated full draft', async () => {
    const draft = '草'.repeat(4000), idea = '渡口的守灯人收到了旧信。'
    const store = useInspirationSessionsStore()
    store.adopt([parseInspirationSession({ id: 'existing', title: '旧讨论', updatedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: '原有问题' }, { role: 'assistant', content: '原有回答' }], draft })])
    const wrapper = mountChat(false, idea)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '围绕来信继续讨论。' })
    await wrapper.setProps({ active: true, startRequest: { id: 1, idea } })
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([
      { role: 'user', content: '原有问题' }, { role: 'assistant', content: '原有回答' }, { role: 'user', content: idea },
    ])
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(draft)
    expect(store.sessions[0].draft).toBe(draft)
    expect(wrapper.find('.inspiration-carried-idea').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens existing discussion without sending anything when the entry idea is blank', async () => {
    useInspirationSessionsStore().adopt([parseInspirationSession({ id: 'existing', title: '已有草稿',
      updatedAt: new Date().toISOString(), messages: [], draft: '我还没打算发送的问题' })])
    const wrapper = mountChat(false)
    await wrapper.setProps({ active: true, startRequest: { id: 1, idea: '  ' } })
    await flushPromises()
    expect(chatInspiration).not.toHaveBeenCalled()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('我还没打算发送的问题')
    expect(useInspirationSessionsStore().sessions[0].messages).toEqual([])
    wrapper.unmount()
  })

  it('keeps an automatically submitted idea for retry when no model is configured', async () => {
    const idea = '修灯人想寻找失踪的姐姐。'
    const wrapper = mountChat(false, idea)
    const config = useConfigStore(), models = [...config.models]
    config.models = []
    await wrapper.setProps({ active: true, startRequest: { id: 1, idea } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('请先在设置中配置')
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(useInspirationSessionsStore().sessions[0].messages).toEqual([{ role: 'user', content: idea }])
    config.models = models
    vi.mocked(chatInspiration).mockResolvedValue({ content: '从姐姐的最后行踪开始。' })
    await button(wrapper, '重试回复').trigger('click')
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: idea }])
    wrapper.unmount()
  })

  it('carries the creation idea into the composer on opening, preserving edits across return visits', async () => {
    const idea = '暴雨夜，守灯人收到一封十年前的来信。'
    const wrapper = mountChat(false, idea)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(useInspirationSessionsStore().sessions).toHaveLength(0)
    await wrapper.setProps({ active: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(idea)
    expect(useInspirationSessionsStore().sessions[0].draft).toBe(idea)
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(extractInspirationSettings).not.toHaveBeenCalled()
    const edited = idea + '\n先聊聊写信的人。'
    await wrapper.get('textarea').setValue(edited)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(edited)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '一起梳理写信人的动机。' })
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: edited }])
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    wrapper.unmount()
    const reopened = mountChat(true, idea)
    expect((reopened.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    reopened.unmount()
  })

  it('persists an explicitly cleared imported draft instead of restoring its previous text', async () => {
    const wrapper = mountChat(true, '尚未发送的灵感。')
    await wrapper.get('textarea').setValue('')
    expect(useInspirationSessionsStore().sessions[0].draft).toBe('')
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    wrapper.unmount()
    const reopened = mountChat()
    expect((reopened.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    reopened.unmount()
  })

  it('keeps a full existing draft and history, carrying the idea separately into the next explicit request', async () => {
    const store = useInspirationSessionsStore()
    const draft = '待'.repeat(4000), idea = '灯'.repeat(4000)
    store.adopt([parseInspirationSession({ id: 'existing', title: '已有讨论', updatedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' }], draft,
      context: { content: '已有摘要', messageCount: 2 } })])
    const wrapper = mountChat(false, idea)
    await wrapper.setProps({ active: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(draft)
    expect(wrapper.get('.inspiration-carried-idea p').text()).toBe(idea)
    expect(store.sessions[0].draft).toBe(draft)
    expect(store.sessions[0].messages).toHaveLength(2)
    expect(chatInspiration).not.toHaveBeenCalled()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '结合新的灵感继续。' })
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([
      { role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' },
      { role: 'user', content: idea }, { role: 'user', content: draft },
    ])
    expect(vi.mocked(chatInspiration).mock.calls[0][6]).toEqual({ content: '已有摘要', messageCount: 2 })
    expect(store.sessions).toHaveLength(1)
    expect(wrapper.find('.inspiration-carried-idea').exists()).toBe(false)
    wrapper.unmount()
    const reopened = mountChat(true, idea)
    expect((reopened.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(reopened.find('.inspiration-carried-idea').exists()).toBe(false)
    reopened.unmount()
  })

  it('includes the carried idea when the author chooses to organize settings directly', async () => {
    const idea = '海边的修灯人想找到失踪的姐姐。'
    const wrapper = mountChat(true, idea)
    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][1]).toEqual([{ role: 'user', content: idea }])
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.emitted('draft-change')).toHaveLength(1)
    await button(wrapper, '完成').trigger('click')
    expect(wrapper.emitted('apply')?.[0][1]).toEqual([{ role: 'user', content: idea }])
    expect(useInspirationSessionsStore().sessions[0].context?.messageCount).toBe(1)
    expect(chatInspiration).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('sends the idea exactly once when the author copies an attached idea into the composer', async () => {
    useInspirationSessionsStore().adopt([parseInspirationSession({ id: 'draft', title: '未完成的问题',
      updatedAt: new Date().toISOString(), messages: [], draft: '已有草稿' })])
    const idea = '修灯人收到一封旧信。'
    const wrapper = mountChat(true, idea)
    expect(wrapper.find('.inspiration-carried-idea').exists()).toBe(true)
    await wrapper.get('textarea').setValue(idea)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '讨论这封信。' })
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: idea }])
    wrapper.unmount()
  })

  it('opens a restored conversation at the newest message, including after returning to inspiration', async () => {
    useInspirationSessionsStore().adopt([parseInspirationSession({
      id: 'saved-session', title: '已有想法', updatedAt: '2026-09-06T10:00:00.000Z',
      messages: [{ role: 'user', content: '最早的提问' }, { role: 'assistant', content: '最新的回答' }],
    })])
    const wrapper = mountChat()
    const container = wrapper.get('.inspiration-history').element
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1500 })
    await flushPromises()
    expect(container.scrollTop).toBe(1500)

    container.scrollTop = 210
    await wrapper.setProps({ active: false })
    expect(container.scrollTop).toBe(210)
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(container.scrollTop).toBe(1500)
    wrapper.unmount()
  })

  it('opens a selected history session at the newest message', async () => {
    useInspirationSessionsStore().adopt([
      parseInspirationSession({ id: 'newer', title: '新对话', updatedAt: '2026-09-07T10:00:00.000Z',
        messages: [{ role: 'user', content: '新对话内容' }] }),
      parseInspirationSession({ id: 'older', title: '旧对话', updatedAt: '2026-09-06T10:00:00.000Z',
        messages: [{ role: 'user', content: '旧对话内容' }, { role: 'assistant', content: '旧对话回复' }] }),
    ])
    const wrapper = mountChat()
    const container = wrapper.get('.inspiration-history').element
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1800 })
    await flushPromises()
    container.scrollTop = 0
    await selectSession(wrapper, 'older')
    await flushPromises()
    expect(wrapper.get('.inspiration-message.assistant').text()).toContain('旧对话回复')
    expect(container.scrollTop).toBe(1800)
    wrapper.unmount()
  })

  it('restores a synced unfinished draft and web setting, then continues the same conversation', async () => {
    const store = useInspirationSessionsStore()
    store.adopt([parseInspirationSession({ id: 'cloud-session', title: '公司的想法', updatedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: '开头' }, { role: 'assistant', content: '已有回复' }],
      draft: '未发送的问题', webSearch: true, knowledgeIds: [], context: { content: '已有设定', messageCount: 2 } })])
    const wrapper = mountChat()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('未发送的问题')
    expect(wrapper.get('.inspiration-search-toggle').attributes('aria-pressed')).toBe('true')
    vi.mocked(chatInspiration).mockResolvedValue({ content: '新回复' })
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].id).toBe('cloud-session')
    expect(store.sessions[0].messages).toHaveLength(4)
    expect(store.sessions[0].draft).toBe('')
    expect(compactInspirationContext).not.toHaveBeenCalled()
    expect(vi.mocked(chatInspiration).mock.calls[0][6]).toEqual({ content: '已有设定', messageCount: 2 })
    wrapper.unmount()
  })
  it('shows context usage and compacts earlier messages before a long conversation continues', async () => {
    vi.mocked(inspirationContextLength).mockReturnValue(18_000)
    vi.mocked(compactInspirationContext).mockResolvedValue({ content: '前面对话摘要', messageCount: 1 })
    vi.mocked(chatInspiration).mockResolvedValue({ content: '基于摘要继续回复' })
    const wrapper = mountChat()

    await wrapper.get('textarea').setValue('继续讨论新的冲突')
    await button(wrapper, '发送').trigger('click')
    expect(wrapper.find('.inspiration-send-group .inspiration-context-ring').exists()).toBe(true)
    expect(wrapper.find('.inspiration-context-summary').text()).toBe('')
    expect(wrapper.find('.inspiration-context-summary').attributes('aria-label')).toContain('18,000 字符，共 24,000 字符')
    await flushPromises()

    expect(compactInspirationContext).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.inspiration-progress').exists()).toBe(false)
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatInspiration).mock.calls[0][6]).toEqual({ content: '前面对话摘要', messageCount: 1 })
    expect(useInspirationSessionsStore().sessions[0].messages).toEqual([
      { role: 'user', content: '继续讨论新的冲突' },
      { role: 'assistant', content: '基于摘要继续回复' },
    ])
    expect(wrapper.find('progress').attributes('aria-label')).toBe('灵感对话上下文使用量')
    wrapper.unmount()
  })
  it('shows compression progress and allows stopping before a reply is requested', async () => {
    vi.mocked(inspirationContextLength).mockReturnValue(18_000)
    let complete!: (result: { content: string; messageCount: number }) => void
    vi.mocked(compactInspirationContext).mockImplementation((_model, _messages, _context, _signal, progress) => {
      progress?.(1, 3)
      return new Promise(resolve => { complete = resolve })
    })
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('再谈人物')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.find('.inspiration-progress').text()).toContain('1/3 批')
    await button(wrapper, '停止').trigger('click')
    complete({ content: '迟到摘要', messageCount: 1 })
    await flushPromises()
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(useInspirationSessionsStore().sessions[0].context).toBeUndefined()
    wrapper.unmount()
  })
  it('keeps the original transcript and shows an error when automatic compaction fails', async () => {
    vi.mocked(inspirationContextLength).mockReturnValue(18_000)
    vi.mocked(compactInspirationContext).mockRejectedValue(new Error('压缩失败'))
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('需要保留的长对话')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()

    expect(chatInspiration).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toContain('压缩失败')
    expect(wrapper.find('.inspiration-message.user').text()).toContain('需要保留的长对话')
    expect(useInspirationSessionsStore().sessions[0].messages).toEqual([
      { role: 'user', content: '需要保留的长对话' },
    ])
    wrapper.unmount()
  })
  it('defaults to available knowledge, remembers a cleared selection and opens a draft without writing', async () => {
    const knowledge = useKnowledgeStore()
    const kb = knowledge.createKB('地方志')
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '## 县学资料\n这是一份待确认草稿。', saveTitle: '县学资料' })
    await wrapper.get('textarea').setValue('帮我整理县学资料')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][5]).toEqual([kb.id])
    await wrapper.get('.inspiration-save-reminder').trigger('click')
    expect(wrapper.findComponent(SaveChatKnowledge).props('content')).toContain('待确认草稿')
    expect(kb.entries).toHaveLength(0)
    wrapper.findComponent(SaveChatKnowledge).vm.$emit('update:show', false)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '继续讨论。' })
    await wrapper.get('[data-heading-knowledge]').trigger('click')
    await wrapper.get('.heading-knowledge-pop input[type=checkbox]').setValue(false)
    await wrapper.get('textarea').setValue('这轮不使用资料')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][5]).toEqual([])
    expect(useInspirationSessionsStore().sessions[0].knowledgeIds).toEqual([])
    expect(wrapper.find('.inspiration-save-reminder').exists()).toBe(false)
    wrapper.unmount()
  })
  it('organizes a typed seed without requesting a chat reply and keeps the original for the contract', async () => {
    const wrapper = mountChat()
    const idea = '一封旧信在停电后的渡口送达。'
    const form = wrapper.props('form')
    vi.mocked(extractInspirationSettings).mockResolvedValue({ ...form, workingTitle: '渡口来信', storyTimeOrigin: { day: 0 } })
    await wrapper.get('textarea').setValue(idea)
    await button(wrapper, '跳过讨论，直接整理设定').trigger('click')
    await flushPromises()
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][1]).toEqual([{ role: 'user', content: idea }])
    wrapper.findComponent(InspirationSettingsSummary).vm.$emit('finish')
    expect(wrapper.emitted('apply')?.[0]).toEqual([
      expect.objectContaining({ workingTitle: '渡口来信', storyTimeOrigin: { day: 0 } }),
      [{ role: 'user', content: idea }],
    ])
    wrapper.unmount()
  })
  it('shows one turn marker per prompt and previews the corresponding text outside the transcript', async () => {
    const wrapper = mountChat()
    expect(wrapper.find('.inspiration-turns').exists()).toBe(false)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '第一轮回答' })
    const prompt = '第一行设定\n第二行设定\n' + '需要完整保留的长问题。'.repeat(100)
    await wrapper.get('textarea').setValue(prompt)
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const firstTurn = wrapper.get('.inspiration-turns button')
    expect(firstTurn.attributes('aria-current')).toBe('true')
    expect(wrapper.get('.inspiration-history').find('.inspiration-turns').exists()).toBe(false)
    expect(wrapper.get('.inspiration-message.user strong').text()).toBe('我')
    expect(wrapper.get('.inspiration-message.assistant strong').text()).toBe('AI')
    await firstTurn.trigger('mouseenter')
    expect(wrapper.get('.inspiration-turn-preview').text()).toMatch(/^第一行设定 第二行设定.*…$/)
    await wrapper.get('.inspiration-turns').trigger('mouseleave')
    expect(wrapper.find('.inspiration-turn-preview').exists()).toBe(false)

    vi.mocked(chatInspiration).mockImplementation(() => new Promise(() => {}))
    await wrapper.get('textarea').setValue('新的问题')
    await button(wrapper, '发送').trigger('click')
    const turns = wrapper.findAll('.inspiration-turns button')
    expect(turns).toHaveLength(2)
    expect(turns[0].attributes('aria-current')).toBeUndefined()
    expect(turns[1].attributes('aria-current')).toBe('true')
    await turns[1].trigger('focus')
    expect(wrapper.get('.inspiration-turn-preview').text()).toBe('新的问题')
    await button(wrapper, '停止').trigger('click')
    expect(wrapper.findAll('.inspiration-turns button')).toHaveLength(2)
    wrapper.unmount()
  })

  it.each([false, true])('positions a completed reply at its start (search=%s), without chunk-by-chunk bottom jumps', async search => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    const container = wrapper.get('.inspiration-history').element as HTMLElement
    // A positioned ancestor need not be the scrollport. offsetTop must not be
    // used; the mocked rectangles change as a real scrollport scrolls.
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 200 } as DOMRect))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return { top: 200 + (this.classList.contains('user') ? 30 : 900) - container.scrollTop } as DOMRect
    })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 10000 })
    if (search) await wrapper.get('.inspiration-search-toggle').trigger('click')
    await wrapper.get('textarea').setValue('长回复定位')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    const onChunk = vi.mocked(chatInspiration).mock.calls[0][3]
    if (!search) {
      onChunk('开头')
      await flushPromises()
      container.scrollTop = 1200 // The author chooses where to read.
      onChunk('新增的正文'.repeat(300))
      await flushPromises()
      expect(container.scrollTop).toBe(1200)
    }
    finish({ content: '开头\n\n' + '长回复内容\n\n'.repeat(300) })
    await flushPromises()
    expect(container.scrollTop).toBe(888)
    expect(wrapper.find('[data-streaming-assistant]').exists()).toBe(false)
    expect(wrapper.findAll('.inspiration-message.assistant')).toHaveLength(1)
    container.scrollTop = 1500
    await wrapper.get('.inspiration-turns button').trigger('click')
    expect(container.scrollTop).toBe(18)
    wrapper.unmount()
  })

  it('does not reposition the transcript for an aborted late reply', async () => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('停止后保留阅读位置')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    await button(wrapper, '停止').trigger('click')
    const container = wrapper.get('.inspiration-history').element
    container.scrollTop = 270
    finish({ content: '晚到结果' })
    await flushPromises()
    expect(container.scrollTop).toBe(270)
    expect(wrapper.find('.inspiration-message.assistant').exists()).toBe(false)
    wrapper.unmount()
  })

  it('sends with Enter and prevents repeat/blank/busy submissions', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(() => {}))
    const textarea = wrapper.get('textarea')
    await textarea.setValue('第一条灵感')
    await textarea.trigger('keydown', { key: 'Enter', repeat: true })
    expect(chatInspiration).not.toHaveBeenCalled()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    textarea.element.dispatchEvent(enter)
    await flushPromises()
    expect(enter.defaultPrevented).toBe(true)
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chatInspiration).mock.calls[0][1]).toEqual([{ role: 'user', content: '第一条灵感' }])
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    await button(wrapper, '停止').trigger('click')
    await textarea.setValue('   ')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('keeps Shift+Enter as native newline instead of sending', async () => {
    const wrapper = mountChat()
    const textarea = wrapper.get('textarea')
    await textarea.setValue('两行灵感')
    const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    textarea.element.dispatchEvent(newline)
    await flushPromises()
    expect(newline.defaultPrevented).toBe(false)
    expect(chatInspiration).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('回车发送 · 上档键＋回车换行')
    wrapper.unmount()
  })

  it('does not send while choosing Chinese input characters, including IME fallback events', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '收到' })
    const textarea = wrapper.get('textarea')
    await textarea.setValue('中文灵感')
    await textarea.trigger('compositionstart')
    await textarea.trigger('keydown', { key: 'Enter' })
    await textarea.trigger('compositionend')
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true })
    await textarea.trigger('keydown', { key: 'Enter', keyCode: 229 })
    expect(chatInspiration).not.toHaveBeenCalled()
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.inspiration-message.user').text()).toContain('中文灵感')
    wrapper.unmount()
  })

  it('does not send from an inactive inspiration view', async () => {
    const wrapper = mountChat()
    await wrapper.get('textarea').setValue('暂未发送')
    await wrapper.setProps({ active: false })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(chatInspiration).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('uses the chat model with search on/off, but keeps settings extraction on the outline model', async () => {
    const wrapper = mountChat()
    const config = useConfigStore()
    config.models.push({ ...config.models[0], id: 'outline', modelName: 'outline-model' },
      { ...config.models[0], id: 'chat', modelName: 'chat-model', chatSearchProtocol: 'responses' })
    config.assignments.outline = 'outline'
    vi.mocked(chatInspiration).mockResolvedValue({ content: '构思建议' })
    await wrapper.find('textarea').setValue('聊想法')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[0][0].id).toBe('outline')

    config.assignments.chat = 'chat'
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查询背景')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][0]).toMatchObject({ id: 'chat', chatSearchProtocol: 'responses' })
    expect(vi.mocked(chatInspiration).mock.calls[1][4]).toBe(true)
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('继续构思')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[2][0].id).toBe('chat')
    expect(vi.mocked(chatInspiration).mock.calls[2][4]).toBe(false)

    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][0].id).toBe('outline')
    wrapper.unmount()
  })
  it('shows extraction progress and keeps the conversation intact after a failed long extraction', async () => {
    const wrapper = mountChat()
    vi.mocked(chatInspiration).mockResolvedValue({ content: '先讨论人物' })
    await wrapper.get('textarea').setValue('写一个商战故事')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    let fail!: (error: Error) => void
    vi.mocked(extractInspirationSettings).mockImplementation((_model, _messages, _base, _signal, progress) => {
      progress?.(2, 6)
      return new Promise((_resolve, reject) => { fail = reject })
    })
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toContain('2/6 步')
    fail(new Error('请求超时（240秒）'))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('240秒')
    expect(wrapper.findAll('.inspiration-message')).toHaveLength(2)
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(button(wrapper, '整理设定').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('hides citation URLs only in assistant presentation and keeps the original conversation for extraction', async () => {
    const wrapper = mountChat()
    const url = 'https://example.test/article?utm_source=test'
    const content = `构思依据：([example.test](${url}))`
    const search = { protocol: 'responses' as const, status: 'searched' as const, sources: [{ url, title: '背景资料' }] }
    vi.mocked(chatInspiration).mockResolvedValue({ content, search })
    await wrapper.find('textarea').setValue(`我提供的链接：${url}`)
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.find('.inspiration-message.assistant').text()).toContain('构思依据：(背景资料)')
    expect(wrapper.find('.inspiration-message.assistant').text()).not.toContain(url)
    expect(wrapper.find('.inspiration-message.user').text()).toContain(url)
    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(vi.mocked(extractInspirationSettings).mock.calls[0][1][1]).toEqual({ role: 'assistant', content, search })
    wrapper.unmount()
  })

  it('defaults off; toggling during a request affects the next message only, and extraction carries evidence for confirmation', async () => {
    let finish!: (result: Awaited<ReturnType<typeof chatInspiration>>) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    expect(wrapper.find('.inspiration-search-toggle').attributes('aria-pressed')).toBe('false')
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查近期事件给我一点灵感')
    await button(wrapper, '发送').trigger('click')
    const args = vi.mocked(chatInspiration).mock.calls[0]
    expect(args[4]).toBe(true)
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    expect(args[2].aborted).toBe(false)
    expect(wrapper.text()).toContain('正在请求联网回复')
    const search = { protocol: 'responses' as const, status: 'searched' as const,
      sources: [{ title: '参考资料', url: 'https://example.org/event' }] }
    finish({ content: '先区分真实事件和虚构设定。', search })
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ChatSearchEvidence' }).slice(-1)[0].props('record')).toEqual(search)
    vi.mocked(extractInspirationSettings).mockResolvedValue(wrapper.props('form'))
    await button(wrapper, '整理设定').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('apply')).toBeUndefined()
    await button(wrapper, '完成').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[1]).toEqual([
      { role: 'user', content: '查近期事件给我一点灵感' }, { role: 'assistant', content: '先区分真实事件和虚构设定。', search },
    ])
    expect(wrapper.emitted('apply')).toHaveLength(1)
    // Applying is only a confirmation form event, not creating or changing a book.
    expect(useNovelStore().novels).toHaveLength(0)
    vi.mocked(chatInspiration).mockResolvedValue({ content: '纯构思回复' })
    await wrapper.find('textarea').setValue('接着想人物冲突')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[1][4]).toBe(false)
    wrapper.unmount()
  })

  it.each(['停止', '退出灵感', '卸载'] as const)('%s cancels and rejects a late search reply', async action => {
    let finish!: (result: { content: string }) => void
    vi.mocked(chatInspiration).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountChat()
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查背景')
    await button(wrapper, '发送').trigger('click')
    const signal = vi.mocked(chatInspiration).mock.calls[0][2]
    if (action === '停止') await button(wrapper, '停止').trigger('click')
    else if (action === '退出灵感') await wrapper.setProps({ active: false })
    else wrapper.unmount()
    expect(signal.aborted).toBe(true)
    finish({ content: '不应出现的旧回复' })
    await flushPromises()
    expect(wrapper.emitted('apply')).toBeUndefined()
    if (action !== '卸载') {
      expect(wrapper.text()).not.toContain('不应出现的旧回复')
      wrapper.unmount()
    }
  })

  it('surfaces unsupported search errors without changing the switch or silently retrying', async () => {
    vi.mocked(chatInspiration).mockRejectedValue(new Error('接口不接受 responses 联网请求（400）'))
    const wrapper = mountChat()
    await wrapper.find('.inspiration-search-toggle').trigger('click')
    await wrapper.find('textarea').setValue('查近期背景')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('400')
    expect(wrapper.find('.inspiration-search-toggle').attributes('aria-pressed')).toBe('true')
    expect(chatInspiration).toHaveBeenCalledTimes(1)
    expect(button(wrapper, '重试回复').exists()).toBe(true)
    wrapper.unmount()
  })

  it('persists inspiration sessions in recent-first order without dropping older drafts', async () => {
    vi.mocked(chatInspiration).mockResolvedValue({ content: '回复' })
    for (let index = 0; index < 6; index++) {
      const wrapper = mountChat()
      await wrapper.get('[data-inspiration-history]').trigger('click')
      await button(wrapper, '新建会话').trigger('click')
      await wrapper.get('textarea').setValue(`第 ${index + 1} 个灵感会话`)
      await button(wrapper, '发送').trigger('click')
      await flushPromises()
      wrapper.unmount()
    }

    const sessions = useInspirationSessionsStore().sessions
    expect(sessions).toHaveLength(6)
    expect(sessions[0].messages[0].content).toBe('第 6 个灵感会话')
  })

  it('restores the latest complete conversation after refresh and continues the same session', async () => {
    useInspirationSessionsStore().adopt([parseInspirationSession({
      id: 'saved-session',
      title: '已有想法',
      updatedAt: '2026-09-06T10:00:00.000Z',
      messages: [
        { role: 'user', content: '已有第一句' },
        { role: 'assistant', content: '已有第一句的回复' },
      ],
    })])
    vi.mocked(chatInspiration).mockResolvedValue({ content: '继续回复' })
    const wrapper = mountChat()

    expect(wrapper.findAll('.inspiration-message')).toHaveLength(2)
    expect(wrapper.find('[data-inspiration-history]').exists()).toBe(true)
    await wrapper.get('textarea').setValue('继续聊第二句')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()

    const sessions = useInspirationSessionsStore().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('saved-session')
    expect(sessions[0].messages.map(message => message.content)).toEqual([
      '已有第一句', '已有第一句的回复', '继续聊第二句', '继续回复',
    ])
    wrapper.unmount()
  })

  it('shares the knowledge selection with the creation entry (1.1.3)', async () => {
    const knowledge = useKnowledgeStore()
    const a = knowledge.createKB('地方志')
    knowledge.createKB('兵制考')
    const wrapper = mountChat()
    await wrapper.setProps({ sharedKnowledgeIds: [a.id] })
    vi.mocked(chatInspiration).mockResolvedValue({ content: '好的。' })
    await wrapper.get('textarea').setValue('只参考地方志')
    await button(wrapper, '发送').trigger('click')
    await flushPromises()
    expect(vi.mocked(chatInspiration).mock.calls[vi.mocked(chatInspiration).mock.calls.length - 1][5]).toEqual([a.id])
    await wrapper.get('[data-heading-knowledge]').trigger('click')
    await wrapper.get('.heading-knowledge-pop input:checked').setValue(false)
    const changes = wrapper.emitted('knowledge-change')!
    expect(changes[changes.length - 1]).toEqual([[]])
    wrapper.unmount()
  })

  it('shows and toggles the mounted knowledge bases in the heading (1.1.4)', async () => {
    const knowledge = useKnowledgeStore()
    const a = knowledge.createKB('地方志')
    const b = knowledge.createKB('兵制考')
    const wrapper = mountChat()
    await wrapper.setProps({ sharedKnowledgeIds: [] })
    const btn = wrapper.get('[data-heading-knowledge]')
    expect(btn.attributes('title')).toBe('未挂载知识库')
    await btn.trigger('click')
    const boxes = wrapper.findAll('.heading-knowledge-pop input[type=checkbox]')
    expect(boxes).toHaveLength(2)
    await boxes[1].setValue(true)
    const changes = wrapper.emitted('knowledge-change')!
    expect(changes[changes.length - 1]).toEqual([[b.id]])
    await wrapper.setProps({ sharedKnowledgeIds: [a.id, b.id] })
    expect(wrapper.get('[data-heading-knowledge]').text()).toContain('参考知识库：地方志、兵制考')
    wrapper.unmount()
  })

  it('starts fresh when the latest saved session already created a book and clears shared knowledge on new chat', async () => {
    const knowledge = useKnowledgeStore()
    const a = knowledge.createKB('老城旧档')
    useInspirationSessionsStore().adopt([parseInspirationSession({
      id: 'created-book-session',
      title: '上一本书的灵感',
      updatedAt: '2026-11-26T10:00:00.000Z',
      messages: [{ role: 'user', content: '第一本书的点子' }, { role: 'assistant', content: '第一本书的回复' }],
      knowledgeIds: [a.id],
    })])
    localStorage.setItem('mojian-last-created-inspiration-session-id', 'created-book-session')
    const wrapper = mountChat()
    await wrapper.setProps({ sharedKnowledgeIds: [a.id] })
    // Does not auto-load the already-used session from the previous book
    expect(wrapper.findAll('.inspiration-message')).toHaveLength(0)
    // User can still reopen it from history, and clicking 新对话 clears shared knowledge + resets meta
    await selectSession(wrapper, 'created-book-session')
    expect(wrapper.findAll('.inspiration-message')).toHaveLength(2)
    await wrapper.get('[data-inspiration-history]').trigger('click')
    await button(wrapper, '新建会话').trigger('click')
    expect(wrapper.findAll('.inspiration-message')).toHaveLength(0)
    const kbChanges = wrapper.emitted('knowledge-change')!
    expect(kbChanges[kbChanges.length - 1]).toEqual([[]])
    expect(wrapper.emitted('session-reset')?.length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })
})
