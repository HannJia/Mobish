import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useKnowledgeStore } from '@/stores/knowledge'
import { saveKnowledgeBaseToDb } from '@/services/db/knowledge'
import {
  BOOK_KB_DESC_PREFIX, INSPIRATION_KB_DESC, UNTITLED_DISCUSSION_KB_NAME,
  demoteMarkdownHeadings, discussionDocumentTitle, formatChatKnowledgeSection, isAutoDiscussionKB,
  resolveDefaultSaveTarget, saveStructuredChatKnowledge, syncDiscussionKnowledgeBaseForBook, uniqueKBName,
} from './chatKnowledgeDocument'
import { knowledgeOutlineText, knowledgeSections } from './knowledgeSections'
import { getCurrentEntrySummary, entrySourceVersion } from './knowledgeSources'
import { knowledgeOutline } from './knowledgeText'

vi.mock('@/services/db/knowledge', () => ({ saveKnowledgeBaseToDb: vi.fn() }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

const inspirationNote = {
  targetKbId: null, mode: 'inspiration' as const, sectionTitle: '**旧港轮值制度**',
  body: '# 值夜规则\n旧港每晚轮值。\n\n````md\n## 代码示例\n```\n---\n````\n\n## 交接规则\n换班必登记。',
  category: '其他', tags: [' 旧港 ', '轮值', '旧港'], summary: '旧港每晚轮值。',
}

describe('chat knowledge Markdown', () => {
  it('demotes body headings and preserves fenced code and its line endings', () => {
    const code = '````md\r\n# 一级样例\r\n```\r\n## 二级样例\r\n````\r\n~~~sh\r\n# comment  \r\n~~~\r\n'
    expect(demoteMarkdownHeadings(`# 一级\r\n${code}  ## 二级\r\n### 三级`))
      .toBe(`### 一级\r\n${code}#### 二级\r\n### 三级`)
  })

  it('cleans a section title and renders optional metadata on one line', () => {
    expect(formatChatKnowledgeSection({ sectionTitle: '## **旧港** ##', body: '## 轮值', category: '地点', tags: [' 港口 ', '水路'] }))
      .toBe('## 旧港\n> 分类：地点 · 标签：港口、水路\n\n#### 轮值')
    expect(formatChatKnowledgeSection({ sectionTitle: '旧港', body: '正文' })).toBe('## 旧港\n> 分类：其他\n\n正文')
  })
})

describe('discussion save targets', () => {
  it('resolves bound discussion libraries first and searches exact book titles only in book mode', () => {
    const store = useKnowledgeStore()
    const reference = store.createKB('参考资料')
    const bound = store.createKB('待命名 2', INSPIRATION_KB_DESC)
    const exact = store.createKB('旧港')
    const options = { mode: 'book' as const, bookTitle: ' 旧港 ', boundIds: [reference.id, 'missing', bound.id] }
    expect(resolveDefaultSaveTarget(store.knowledgeBases, options)).toEqual({ kbId: bound.id, autoName: bound.name, isExisting: true })
    expect(resolveDefaultSaveTarget(store.knowledgeBases, { ...options, boundIds: [reference.id] }).kbId).toBe(exact.id)
    expect(resolveDefaultSaveTarget(store.knowledgeBases, { ...options, mode: 'inspiration' }).kbId).toBe(bound.id)
    expect(resolveDefaultSaveTarget(store.knowledgeBases, { ...options, mode: 'inspiration', boundIds: [exact.id] }))
      .toEqual({ kbId: null, autoName: UNTITLED_DISCUSSION_KB_NAME, isExisting: false })
  })

  it('recognizes auto-created libraries and finds available names', () => {
    expect(isAutoDiscussionKB({ name: '待命名 3', description: '' })).toBe(true)
    expect(isAutoDiscussionKB({ name: '旧港', description: `${BOOK_KB_DESC_PREFIX} · 《旧港》` })).toBe(true)
    expect(isAutoDiscussionKB({ name: '待命名参考', description: '' })).toBe(false)
    expect(uniqueKBName(['待命名', '待命名 2'], '待命名')).toBe('待命名 3')
    expect(uniqueKBName(['旧港'], '旧港', { excludeName: '旧港' })).toBe('旧港')
    expect(uniqueKBName(['旧港', '旧港（讨论笔记）'], '旧港', { collisionSuffix: '讨论笔记' })).toBe('旧港（讨论笔记） 2')
    expect(discussionDocumentTitle(' 旧港 ')).toBe('《旧港》讨论笔记')
    expect(discussionDocumentTitle(' ')).toBe('灵感讨论笔记')
  })
})

describe('structured discussion archives', () => {
  it('appends two addressable sections and keeps the updated summary tied to the entry', () => {
    const store = useKnowledgeStore()
    const first = saveStructuredChatKnowledge(store, inspirationNote)
    expect(first).toMatchObject({ kbName: '待命名', sectionTitle: '旧港轮值制度', entryTitle: '灵感讨论笔记', createdKb: true })
    const kb = store.getKB(first.kbId)!
    expect(kb.description).toBe(INSPIRATION_KB_DESC)
    const entry = kb.entries[0]
    expect(knowledgeOutline(entry.content, 2).map(item => item.title)).toEqual(['旧港轮值制度'])
    const source = entrySourceVersion(kb.id, entry)
    entry.updatedAt = '2026-01-01T00:00:00.000Z'

    const second = saveStructuredChatKnowledge(store, {
      ...inspirationNote, targetKbId: kb.id, sectionTitle: '旧港水路', body: '## 水路详解\n渡口位于山谷。',
      category: '地点', tags: ['旧港', '水路'], summary: '渡口位于山谷。',
    })
    expect(second).toMatchObject({ entryId: first.entryId, sectionTitle: '旧港水路', createdKb: false })
    expect(kb.entries).toHaveLength(1)
    expect(entry).toMatchObject({ category: '地点', tags: ['旧港', '轮值', '水路'], summarySource: { origin: 'author' } })
    expect(entry.content).toContain('\n\n---\n\n## 旧港水路\n> 分类：地点 · 标签：旧港、水路\n\n#### 水路详解')
    expect(knowledgeOutline(entry.content, 2).map(item => item.title)).toEqual(['旧港轮值制度', '旧港水路'])
    expect(knowledgeOutlineText(entry)).toBe('旧港轮值制度 / 旧港水路')
    const sections = knowledgeSections(entry)
    expect([...new Set(sections.map(section => section.path[0]))]).toEqual(['旧港轮值制度', '旧港水路'])
    expect(sections.find(section => section.text.includes('## 代码示例'))?.path).toEqual(['旧港轮值制度', '值夜规则'])
    expect(sections.find(section => section.text.includes('渡口位于山谷'))?.path).toEqual(['旧港水路', '水路详解'])
    expect(getCurrentEntrySummary(kb.id, entry)).toBe('【旧港轮值制度】旧港每晚轮值。\n\n【旧港水路】渡口位于山谷。')
    expect(entry.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(entrySourceVersion(kb.id, entry)).not.toBe(source)
  })

  it('closes a truncated code fence before appending the next section', () => {
    const store = useKnowledgeStore()
    const first = saveStructuredChatKnowledge(store, { ...inspirationNote, tags: [], body: '````md\n## 样例\n```' })
    saveStructuredChatKnowledge(store, { ...inspirationNote, targetKbId: first.kbId, tags: [], sectionTitle: '下一条', body: '正文' })
    const entry = store.getKB(first.kbId)!.entries[0]
    expect(knowledgeOutline(entry.content, 2)).toEqual([
      { level: 2, title: first.sectionTitle, index: 0 }, { level: 2, title: '下一条', index: 2 },
    ])
  })

  it('creates a separate book library for a null target and rolls over full documents', () => {
    const store = useKnowledgeStore()
    store.createKB('旧港')
    const tags = Array.from({ length: 25 }, (_, index) => `标签${index}`)
    const input = { ...inspirationNote, mode: 'book' as const, bookTitle: ' 旧港 ', body: '甲'.repeat(97_800), tags, summary: '摘'.repeat(12_500) }
    const first = saveStructuredChatKnowledge(store, input)
    const kb = store.getKB(first.kbId)!
    expect(first.kbName).toBe('旧港（讨论笔记）')
    expect(kb.description).toBe(`${BOOK_KB_DESC_PREFIX} · 《旧港》`)
    expect(kb.entries[0].summary).toHaveLength(12_000)
    expect(kb.entries[0].tags).toEqual(tags.slice(0, 20))
    const second = saveStructuredChatKnowledge(store, { ...input, targetKbId: kb.id })
    expect(second.entryTitle).toBe('《旧港》讨论笔记（续 2）')
    const third = saveStructuredChatKnowledge(store, { ...input, targetKbId: kb.id, body: '续篇短句', tags: [], summary: '续篇。' })
    expect(third.entryId).toBe(second.entryId)
    expect(saveStructuredChatKnowledge(store, { ...input, targetKbId: kb.id }).entryTitle).toBe('《旧港》讨论笔记（续 3）')
  })
})

describe('automatic discussion library renaming', () => {
  it('renames a bound archive and its continuations, including after a double collision', () => {
    const store = useKnowledgeStore()
    const first = saveStructuredChatKnowledge(store, { ...inspirationNote, tags: [] })
    const kb = store.getKB(first.kbId)!
    const continuation = store.addEntry(kb.id, { ...kb.entries[0], title: '灵感讨论笔记（续 2）' })!
    const manual = store.addEntry(kb.id, { ...kb.entries[0], title: '附录讨论笔记' })!
    store.createKB('旧港')
    store.createKB('旧港（讨论笔记）')
    const novel = { title: ' 未命名小说 ', knowledgeBaseIds: ['missing', kb.id] }
    expect(syncDiscussionKnowledgeBaseForBook(store, novel)).toEqual({})
    novel.title = ' 旧港 '
    expect(syncDiscussionKnowledgeBaseForBook(store, novel)).toEqual({ renamedKbId: kb.id, newName: '旧港（讨论笔记） 2' })
    expect(kb.entries.map(entry => entry.title)).toEqual(['附录讨论笔记', '《旧港》讨论笔记（续 2）', '《旧港》讨论笔记'])
    expect(kb.description).toBe(`${BOOK_KB_DESC_PREFIX} · 《旧港》`)
    expect(getCurrentEntrySummary(kb.id, kb.entries.find(entry => entry.id === first.entryId)!)).toContain('旧港每晚轮值')
    novel.title = '新港'
    expect(syncDiscussionKnowledgeBaseForBook(store, novel, '旧港').newName).toBe('新港')
    expect(kb.entries.find(entry => entry.id === continuation.id)?.title).toBe('《新港》讨论笔记（续 2）')
    expect(kb.entries.find(entry => entry.id === manual.id)?.title).toBe('附录讨论笔记')
    store.renameKB(kb.id, '手动整理的资料库')
    expect(syncDiscussionKnowledgeBaseForBook(store, { ...novel, title: '南港' }, '新港')).toEqual({})
    expect(kb.name).toBe('手动整理的资料库')
  })

  it('validates name changes and persists the trimmed name and description', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('待命名', INSPIRATION_KB_DESC)
    store.createKB('旧港')
    await store.flushPendingSaves()
    vi.mocked(saveKnowledgeBaseToDb).mockClear()
    expect(store.renameKB('missing', '无目标')).toBe(false)
    expect(store.renameKB(kb.id, '  ')).toBe(false)
    expect(store.renameKB(kb.id, ' 旧港 ')).toBe(false)
    expect(store.hasPendingSaves).toBe(false)
    expect(store.renameKB(kb.id, ' 待命名 ')).toBe(true)
    expect(store.getKB(kb.id)?.description).toBe(INSPIRATION_KB_DESC)
    expect(store.renameKB(kb.id, ' 新港 ', '新描述')).toBe(true)
    await store.flushPendingSaves()
    expect(saveKnowledgeBaseToDb).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: kb.id, name: '新港', description: '新描述' }))
  })
})
