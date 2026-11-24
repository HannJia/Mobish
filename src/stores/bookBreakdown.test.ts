import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI } from '@/services/ai'
import { loadBreakdownJobs, loadBreakdownSource } from '@/services/bookBreakdownDb'
import { knowledgeBreakdownSource, makeBreakdownSource, openingSections } from '@/services/bookBreakdownSource'
import { useBookBreakdownStore } from './bookBreakdown'
import { useKnowledgeStore } from './knowledge'
import type { KBEntry, KnowledgeBase } from '@/types/knowledge'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('./config', () => {
  const model = { id: 'test', name: 'test', baseUrl: 'https://example.invalid', modelName: 'test', temperature: 0.3, topP: 1 }
  return { useConfigStore: () => ({ getModelForTask: () => model, models: [model] }) }
})
vi.mock('./novel', () => ({ useNovelStore: () => ({ getNovel: () => undefined }) }))
vi.mock('./knowledge', () => {
  const knowledgeBases: KnowledgeBase[] = []
  return { useKnowledgeStore: () => ({ knowledgeBases }) }
})

const response = (quote = '门开了。') => ({
  content: JSON.stringify({ cards: [{ title: '悬念', observation: '门打开', interpretation: '留下结果', application: '先写动作',
    evidence: [{ block: 'P2', quote }] }] }),
  usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
})
const sourceOf = (first = '门开了。') => makeBreakdownSource('书', `序章\r\n序言正文。\r\n第一章开端\r\n门开了。\r\n${first}\r\n第二章 去路\r\n他看见黎明。\r\n门开了。`, { kind: 'file' })

describe('independent breakdown checkpoints', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(callAI).mockReset().mockResolvedValue(response())
    useKnowledgeStore().knowledgeBases.splice(0)
  })

  it('persists budget interruption, skips saved units after restart, and binds a repeated quote to its actual paragraph', async () => {
    const store = useBookBreakdownStore()
    await store.initialize()
    const source = sourceOf()
    const selection = openingSections(source)
    expect(selection).toHaveLength(2)
    const created = await store.create(source, 'opening', selection, null, '节奏', 1, 6000)
    await store.resume(created, 1, 6000)
    const paused = (await loadBreakdownJobs()).find(job => job.id === created.id)!
    expect(paused.status).toBe('budget')
    expect(paused.units.map(unit => unit.cards?.length)).toEqual([1, undefined])
    expect(paused.units[0].cards![0].evidence[0].start).toBe(source.text.lastIndexOf('门开了。', source.text.indexOf('第二章')))
    expect(paused.usage).toEqual({ input: 20, output: 30, charged: 50, estimated: false })
    setActivePinia(createPinia())
    const reopened = useBookBreakdownStore()
    await reopened.initialize()
    const saved = reopened.jobs.find(job => job.id === created.id)!
    await reopened.resume(saved, 3, 7000)
    expect(reopened.jobs.find(job => job.id === created.id)?.status).toBe('complete')
    expect(vi.mocked(callAI)).toHaveBeenCalledTimes(2)
    expect((await loadBreakdownSource(created.id, source.version))?.text).toBe(source.text)
  })

  it('keeps the completed unit when a later result fails and preserves author edits across a source change', async () => {
    const store = useBookBreakdownStore()
    const source = sourceOf()
    const created = await store.create(source, 'book', source.sections.map(section => section.key), null, '节奏', 8, 18000)
    vi.mocked(callAI).mockResolvedValueOnce({ ...response(), content: '{"cards":[]}' })
      .mockResolvedValueOnce(response()).mockResolvedValueOnce({ ...response(), content: 'bad JSON' })
    await store.resume(created, 8, 18000)
    const current = store.jobs.find(job => job.id === created.id)!
    expect(current.status).toBe('failed')
    expect(current.units.map(unit => unit.cards?.length)).toEqual([0, 1, undefined])
    expect(current.usage.charged).toBe(150)
    const edit = { ...current.units[1].cards![0], interpretation: '作者的校订' }
    const edited = await store.editCard(current, edit)
    const next = await store.refreshSource(edited, sourceOf('门已经关上。'))
    expect(next.units.map(unit => unit.cards?.length)).toEqual([0, undefined, undefined])
    expect(next.archive[0]).toMatchObject({ version: source.version, card: { interpretation: edit.interpretation, edited: true } })
  })

  it('rechecks the shared knowledge visibility after an earlier request finishes', async () => {
    const knowledge = useKnowledgeStore()
    const entry: KBEntry = { id: 'entry', title: '资料', content: sourceOf().text, category: '', summary: '',
      tags: [], createdAt: '', updatedAt: '' }
    knowledge.knowledgeBases.push({ id: 'base', name: '资料库', description: '', createdAt: '', entries: [entry] })
    const store = useBookBreakdownStore()
    const source = knowledgeBreakdownSource('base', entry)
    const created = await store.create(source, 'opening', openingSections(source), null, '节奏', 4, 12000)
    vi.mocked(callAI).mockImplementationOnce(async () => {
      entry.visibility = { mode: 'never' }
      return response()
    })
    await store.resume(created, 4, 12000)
    expect(vi.mocked(callAI)).toHaveBeenCalledTimes(1)
    expect(store.jobs.find(job => job.id === created.id)?.status).toBe('failed')
    expect(() => store.authorize(created)).toThrow('保密')
  })
})
