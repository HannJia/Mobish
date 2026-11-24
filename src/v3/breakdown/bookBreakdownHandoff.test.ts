// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { callAI } from '@/services/ai'
import { makeBreakdownSource } from '@/services/bookBreakdownSource'
import { loadBreakdownSource } from '@/services/bookBreakdownDb'
import { useBookBreakdownStore } from '@/stores/bookBreakdown'
import { useConfigStore } from '@/stores/config'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { breakdownEvidenceRoute, destinationRoute, publishBreakdownHandoff } from './bookBreakdownHandoff'

vi.mock('@/services/ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))

it('reopens an interrupted book, preserves an edited card and saves five destinations with the original evidence', async () => {
  const initial = createPinia()
  const reopened = createPinia()
  vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ cards: [{ title: '开场悬念', observation: '动作起头',
    interpretation: '留一个问题', application: '先写动作', evidence: [{ block: 'P1', quote: '门开了。' }] }] }),
  usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } })
  try {
    setActivePinia(initial)
    const model = useConfigStore().addModel({ name: '合成拆书模型', baseUrl: 'https://example.test', modelName: 'test',
      apiKey: 'synthetic', temperature: 0, topP: 1, maxTokens: 8000 })
    const source = makeBreakdownSource('原书', '第一章 开场\n门开了。\n第二章 归来\n门开了。\n第三章 离开\n门开了。', { kind: 'file' })
    const first = useBookBreakdownStore()
    const job = await first.create(source, 'book', source.sections.map(section => section.key), null, '开场节奏', 1, 9000)
    await first.resume(job, 1, 9000)
    const paused = first.jobs.find(item => item.id === job.id)!
    expect(paused.status).toBe('budget')
    const editedText = '作者改为先写门锁松动。'
    await first.editCard(paused, { ...paused.units[0].cards![0], application: editedText })

    setActivePinia(reopened)
    useConfigStore().models = [{ ...model }]
    const store = useBookBreakdownStore()
    const novels = useNovelStore(), knowledge = useKnowledgeStore(), sessions = useInspirationSessionsStore()
    await Promise.all([store.initialize(), novels.initStore(), knowledge.initStore(), sessions.initialize()])
    await store.resume(store.jobs.find(item => item.id === job.id)!, 10, 36000)
    const complete = store.jobs.find(item => item.id === job.id)!
    expect(complete.status).toBe('complete')
    expect(vi.mocked(callAI)).toHaveBeenCalledTimes(complete.units.length)
    const card = complete.units[0].cards![0]
    expect(card.application).toBe(editedText)
    const evidence = card.evidence[0]
    const storedSource = await loadBreakdownSource(job.id, complete.source.version)
    expect(storedSource?.text.slice(evidence.start, evidence.end)).toBe('门开了。')

    const base = knowledge.createKB('写法资料')
    const novel = novels.addNovel({ workingTitle: '新书', genre: '', subGenre: '', tags: [], targetWordCountMin: 100,
      targetWordCountMax: 200, settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
    const chapter = novels.addChapter(novel.id, { title: '第一章', content: '作者的正文。' })!
    await novels.flushPendingSaves()
    for (const [kind, targetId, chapterId, routeName] of [
      ['inspiration', '', undefined, 'BookBreakdownDiscussion'], ['knowledge', base.id, undefined, 'KnowledgeLibrary'],
      ['plan', novel.id, chapter.id, 'V3Plan'], ['writing', novel.id, chapter.id, 'V3Write'], ['codex', novel.id, chapter.id, 'V3Codex'],
    ] as const) {
      const receipt = await publishBreakdownHandoff(store.jobs.find(item => item.id === job.id)!, source, [card], {
        kind, targetId, chapterId, title: kind === 'codex' ? '顾榕' : '开场动作', text: editedText, targetLabel: '合成目标',
      })
      expect(receipt.destinationId).toBeTruthy()
      expect(destinationRoute(receipt).name).toBe(routeName)
      expect(receipt.links).toEqual([{ cardId: card.id, evidenceIndex: 0 }])
      const link = breakdownEvidenceRoute(job.id, card.id, 0, receipt.sourceVersion)
      expect(receipt.provenance).toContain(link.path + '?card=' + card.id)
    }
    expect(sessions.sessions[0].messages[0].content).toContain(editedText)
    expect(knowledge.getKB(base.id)?.entries[0].content).toContain(editedText)
    const saved = novels.getNovel(novel.id)!
    expect(saved.chapterPlans?.[0].summary).toContain(editedText)
    expect(saved.chapters[0].sceneNotes?.[0].content).toContain(editedText)
    expect(saved.chapters[0].content).toBe('作者的正文。')
    expect(saved.characters[0]).toMatchObject({ name: '顾榕', status: '待核对' })
    expect(saved.characters[0].description).toContain(editedText)
  } finally {
    disposePinia(initial)
    disposePinia(reopened)
  }
})
