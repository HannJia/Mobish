import type { useKnowledgeStore } from '@/stores/knowledge'
import type { KnowledgeBase } from '@/types/knowledge'
import type { Novel } from '@/types/novel'
import { createMarkdownFenceTracker, markdownTitleText } from '@/utils/markdownStructure'
import { createEntrySummarySource, getCurrentEntrySummary } from './knowledgeSources'

export const UNTITLED_DISCUSSION_KB_NAME = '待命名'
export const INSPIRATION_KB_DESC = '灵感讨论自动归档知识库（确认书名后自动重命名）'
export const BOOK_KB_DESC_PREFIX = '书内讨论自动归档知识库'

const UNTITLED_NAME = /^待命名(?:\s+\d+)?$/
const BOOK_COLLISION_SUFFIX = '讨论笔记'
const INSPIRATION_DOCUMENT_TITLE = '灵感讨论笔记'
const CONTINUATION = /（续 (\d+)）$/
const SECTION_SEPARATOR = '\n\n---\n\n'
const CONTENT_LIMIT = 98_000
const SUMMARY_LIMIT = 12_000
type KnowledgeStore = ReturnType<typeof useKnowledgeStore>
type DiscussionMode = 'book' | 'inspiration'

export function demoteMarkdownHeadings(body: string): string {
  const fence = createMarkdownFenceTracker()
  return body.replace(/[^\r\n]+/g, line => fence.includes(line)
    ? line : line.replace(/^ {0,3}(#{1,2})[ \t]+(?=\S)/, '##$1 '))
}

function cleanSectionTitle(title: string): string {
  return markdownTitleText(title.replace(/\s+/g, ' ')).slice(0, 120).replace(/[\uD800-\uDBFF]$/, '').trimEnd() || '讨论摘录'
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 20)
}

export function formatChatKnowledgeSection(input: { sectionTitle: string; body: string; category?: string; tags?: string[] }): string {
  const category = input.category?.replace(/\s+/g, ' ').trim() || '其他'
  const tags = cleanTags(input.tags || [])
  const body = demoteMarkdownHeadings(input.body)
  const fence = createMarkdownFenceTracker()
  for (const line of body.split(/\r\n?|\n/)) fence.includes(line)
  // An unfinished response may leave a fence open. Close it before the next section.
  const closingFence = fence.openMarker ? `\n${fence.openMarker}` : ''
  return `## ${cleanSectionTitle(input.sectionTitle)}\n> 分类：${category}${tags.length ? ` · 标签：${tags.join('、')}` : ''}\n\n${body}${closingFence}`
}

export function discussionDocumentTitle(bookTitle?: string): string {
  const title = bookTitle?.trim()
  return title ? `《${title}》讨论笔记` : INSPIRATION_DOCUMENT_TITLE
}

export function isAutoDiscussionKB(kb: Pick<KnowledgeBase, 'name' | 'description'>): boolean {
  return UNTITLED_NAME.test(kb.name) || Boolean(kb.description?.startsWith('灵感讨论自动归档知识库')
    || kb.description?.startsWith(BOOK_KB_DESC_PREFIX))
}

export function uniqueKBName(existingNames: string[], desiredName: string, options?: { excludeName?: string; collisionSuffix?: string }): string {
  const occupied = new Set(existingNames.filter(name => name !== options?.excludeName).map(name => name.trim()))
  if (!occupied.has(desiredName)) return desiredName
  const alternative = options?.collisionSuffix ? `${desiredName}（${options.collisionSuffix}）` : desiredName
  let candidate = alternative
  for (let number = 2; occupied.has(candidate); number++) candidate = `${alternative} ${number}`
  return candidate
}

function newDiscussionKBName(bases: KnowledgeBase[], mode: DiscussionMode, bookTitle: string): string {
  const names = bases.map(base => base.name)
  return mode === 'book'
    ? uniqueKBName(names, bookTitle || '未命名作品', { collisionSuffix: BOOK_COLLISION_SUFFIX })
    : uniqueKBName(names, UNTITLED_DISCUSSION_KB_NAME)
}

export function resolveDefaultSaveTarget(bases: KnowledgeBase[], options: { mode: DiscussionMode; bookTitle?: string; boundIds?: string[] }): { kbId: string | null; autoName: string; isExisting: boolean } {
  const bookTitle = options.bookTitle?.trim() || ''
  const exactBookKB = (base: KnowledgeBase) => options.mode === 'book' && Boolean(bookTitle) && base.name === bookTitle
  const bound = options.boundIds?.map(id => bases.find(base => base.id === id)).find(base => base && (isAutoDiscussionKB(base) || exactBookKB(base)))
  const target = bound ?? bases.find(exactBookKB)
  return target ? { kbId: target.id, autoName: target.name, isExisting: true }
    : { kbId: null, autoName: newDiscussionKBName(bases, options.mode, bookTitle), isExisting: false }
}

function bookDescription(title: string): string {
  return `${BOOK_KB_DESC_PREFIX} · 《${title}》`
}

function appendSectionSummary(previous: string, title: string, summary: string): string {
  const text = summary.trim()
  const parts = [previous.trim(), text && `【${title}】${text}`].filter(Boolean)
  return parts.join('\n\n').slice(0, SUMMARY_LIMIT).replace(/[\uD800-\uDBFF]$/, '')
}

function discussionEntryPart(title: string): number {
  if (!title.replace(CONTINUATION, '').endsWith('讨论笔记')) return 0
  return Number(CONTINUATION.exec(title)?.[1] || 1)
}

export function saveStructuredChatKnowledge(store: KnowledgeStore, input: {
  targetKbId: string | null; mode: DiscussionMode; bookTitle?: string; sectionTitle: string; body: string
  category: string; tags: string[]; summary: string
}): { kbId: string; kbName: string; entryId: string; entryTitle: string; sectionTitle: string; createdKb: boolean } {
  const bookTitle = input.bookTitle?.trim() || ''
  const baseTitle = discussionDocumentTitle(bookTitle)
  const sectionTitle = cleanSectionTitle(input.sectionTitle)
  const category = input.category.trim() || '其他'
  const tags = cleanTags(input.tags)
  const section = formatChatKnowledgeSection({ ...input, sectionTitle, category, tags })
  const createdKb = input.targetKbId === null
  const kb = input.targetKbId === null
    ? store.createKB(newDiscussionKBName(store.knowledgeBases, input.mode, bookTitle),
      input.mode === 'book' ? bookDescription(bookTitle || '未命名作品') : INSPIRATION_KB_DESC)
    : store.getKB(input.targetKbId)
  if (!kb) throw new Error('目标知识库已不存在，请重新选择。')

  const documents = kb.entries.map(entry => ({ entry, part: discussionEntryPart(entry.title) }))
    .filter(item => item.part > 0).sort((left, right) => right.part - left.part)
  const result = documents.find(({ entry }) => entry.content.length + SECTION_SEPARATOR.length + section.length <= CONTENT_LIMIT)
  if (result) {
    const { entry } = result
    const updated = {
      content: `${entry.content}${SECTION_SEPARATOR}${section}`,
      category: entry.category === '其他' ? category : entry.category,
      tags: cleanTags([...entry.tags, ...tags]),
      summary: appendSectionSummary(entry.summary, sectionTitle, input.summary),
    }
    const summarySource = updated.summary
      ? createEntrySummarySource(kb.id, { ...entry, ...updated }, updated.summary, 'author', new Date().toISOString())
      : undefined
    store.updateEntry(kb.id, entry.id, { ...updated, summarySource })
    return { kbId: kb.id, kbName: kb.name, entryId: entry.id, entryTitle: entry.title, sectionTitle, createdKb }
  }

  const featuredPart = documents[0]?.part
  const entryTitle = featuredPart ? `${baseTitle}（续 ${featuredPart + 1}）` : baseTitle
  const entry = store.addEntry(kb.id, {
    title: entryTitle, content: section, category, tags, summary: appendSectionSummary('', sectionTitle, input.summary),
  }, 'author')
  if (!entry) throw new Error('未能创建条目，请重试。')
  return { kbId: kb.id, kbName: kb.name, entryId: entry.id, entryTitle, sectionTitle, createdKb }
}

export function syncDiscussionKnowledgeBaseForBook(knowledgeStore: KnowledgeStore, novel: Pick<Novel, 'title' | 'knowledgeBaseIds'>, previousTitle?: string): { renamedKbId?: string; newName?: string } {
  const title = novel.title.trim()
  if (!title || /^(?:未命名(?:作品|小说)?|待命名)$/.test(title)) return {}
  const previous = previousTitle?.trim() || ''
  const previousAlternative = `${previous}（${BOOK_COLLISION_SUFFIX}）`
  const kb = novel.knowledgeBaseIds?.map(id => knowledgeStore.getKB(id)).find(base => {
    if (!base || !isAutoDiscussionKB(base)) return false
    return UNTITLED_NAME.test(base.name) || Boolean(previous && (base.name === previous || base.name === previousAlternative
      || (base.description === bookDescription(previous) && base.name.startsWith(`${previousAlternative} `)
        && /^\d+$/.test(base.name.slice(previousAlternative.length + 1)))))
  })
  if (!kb) return {}

  const nextName = newDiscussionKBName(knowledgeStore.knowledgeBases.filter(base => base.id !== kb.id), 'book', title)
  if (!knowledgeStore.renameKB(kb.id, nextName, bookDescription(title))) return {}
  const nextDocumentTitle = discussionDocumentTitle(title)
  const previousDocumentTitle = discussionDocumentTitle(previous)
  for (const entry of kb.entries) {
    const continuation = CONTINUATION.exec(entry.title)?.[0] || ''
    const root = entry.title.replace(CONTINUATION, '')
    if (root !== INSPIRATION_DOCUMENT_TITLE && root !== previousDocumentTitle) continue
    const nextTitle = nextDocumentTitle + continuation
    if (entry.title === nextTitle) continue
    const currentSummary = getCurrentEntrySummary(kb.id, entry)
    const summarySource = currentSummary && entry.summarySource?.origin === 'author'
      ? createEntrySummarySource(kb.id, { ...entry, title: nextTitle }, entry.summary, 'author', entry.summarySource.createdAt)
      : entry.summarySource
    knowledgeStore.updateEntry(kb.id, entry.id, { title: nextTitle, summarySource })
  }
  return { renamedKbId: kb.id, newName: nextName }
}
