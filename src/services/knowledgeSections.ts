// 知识库按标题分段检索：把每份资料按标题切成小节（带标题路径），按关键词挑出最相关的小节交给 AI。
// 不调用模型、不花费用；读到的是原文。没有标题的资料按段落切成约一千字的小块。
import type { KBEntry } from '@/types/knowledge'
import { createMarkdownFenceTracker } from '@/utils/markdownStructure'

export interface KnowledgeSection {
  /** 标题路径，如 ['二、完整时间线', '阶段四 · 全面市场化', '1998年7月3日｜房改 23 号文']。 */
  path: string[]
  text: string
  /** UTF-16 offsets into the original entry, before any formatting or newline conversion. */
  start: number
  end: number
}
export interface KnowledgeSectionHit<T> { source: T; entry: KBEntry; section: KnowledgeSection; score: number }

const MARKDOWN_HEADING = /^(#{1,4})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const CHINESE_HEADING = /^[ \t]*(第[一二三四五六七八九十百千零〇\d]+[章节回卷部篇集]|[一二三四五六七八九十百]+、|（[一二三四五六七八九十百]+）)[ \t]*\S.{0,60}$/
const SECTION_LIMIT = 1200
const CHUNK_TARGET = 1000

const cleanTitle = (value: string) => value.replace(/[`*_]/g, '').trim().slice(0, 120)

/** 过长的小节按段落再分块，保留同一标题路径。 */
function chunk(path: string[], content: string, start: number, end: number, untitled: boolean, counter: { value: number }): KnowledgeSection[] {
  const parts: Array<Omit<KnowledgeSection, 'path'>> = []
  const body = content.slice(start, end)
  let offset = 0
  while (offset < body.length) {
    let next = body.length
    if (next - offset > SECTION_LIMIT) {
      const window = body.slice(offset, offset + SECTION_LIMIT)
      const boundaries = [...window.matchAll(/\r?\n[ \t]*\r?\n/g)]
      const lastBreak = boundaries[boundaries.length - 1]
      next = offset + (lastBreak && lastBreak.index >= CHUNK_TARGET / 2 ? lastBreak.index + lastBreak[0].length : CHUNK_TARGET)
      // Keep a Unicode surrogate pair together when a long paragraph has to be cut.
      if (/[\uDC00-\uDFFF]/.test(body[next])) next--
    }
    const piece = body.slice(offset, next)
    const text = piece.trim()
    if (text) {
      const from = start + offset + piece.length - piece.trimStart().length
      parts.push({ text, start: from, end: from + text.length })
    }
    offset = next
  }
  return parts.map((part, index) => ({
    ...part,
    path: untitled ? [`第 ${++counter.value} 段`] : parts.length > 1 ? [...path.slice(0, -1), `${path[path.length - 1] || ''}（${index + 1}/${parts.length}）`] : path,
  }))
}

const cache = new WeakMap<KBEntry, { content: string; sections: KnowledgeSection[] }>()

export function knowledgeSections(entry: KBEntry): KnowledgeSection[] {
  const cached = cache.get(entry)
  if (cached && cached.content === entry.content) return cached.sections
  const content = entry.content
  const fence = createMarkdownFenceTracker()
  const boundaries = []
  let hasMarkdown = false
  for (const line of content.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
    if (fence.includes(line[1])) continue
    const markdown = MARKDOWN_HEADING.exec(line[1])
    hasMarkdown ||= Boolean(markdown)
    if (markdown || CHINESE_HEADING.test(line[1]) || /^[ \t]*---+[ \t]*$/.test(line[1])) {
      boundaries.push({ line, markdown, separator: /^[ \t]*---+[ \t]*$/.test(line[1]) })
    }
  }
  const sections: KnowledgeSection[] = []
  const stack: Array<{ level: number; title: string }> = []
  const counter = { value: 0 }
  let start = 0
  const flush = (end: number) => {
    const path = stack.map(item => item.title)
    sections.push(...chunk(path.length ? path : [entry.title], content, start, end, !path.length, counter))
  }
  for (const { line, markdown, separator } of boundaries) {
    if (!markdown && !separator && hasMarkdown) continue
    flush(line.index)
    start = line.index + line[0].length
    if (separator) continue
    const level = markdown ? markdown[1].length : 2
    const title = cleanTitle(markdown ? markdown[2] : line[1])
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, title })
  }
  flush(content.length)
  cache.set(entry, { content, sections })
  return sections
}

function countHits(haystack: string, needle: string, cap = 3): number {
  let count = 0
  for (let position = haystack.indexOf(needle); position >= 0 && count < cap; position = haystack.indexOf(needle, position + needle.length)) count++
  return count
}

/** 在若干资料中按关键词挑出最相关的小节；同一份资料最多取 perEntry 个，避免一份资料占满额度。 */
export function retrieveKnowledgeSections<T>(items: Array<{ source: T; entry: KBEntry }>, keywords: string[], options: { maxSections?: number; perEntry?: number } = {}): Array<KnowledgeSectionHit<T>> {
  const terms = [...new Set(keywords.map(keyword => keyword.trim().toLowerCase()).filter(keyword => keyword.length >= 2))].slice(0, 60)
  if (!terms.length) return []
  const hits: Array<KnowledgeSectionHit<T>> = []
  for (const { source, entry } of items) {
    const entryTitle = `${entry.title} ${entry.tags.join(' ')}`.toLowerCase()
    for (const section of knowledgeSections(entry)) {
      const path = section.path.join(' ').toLowerCase()
      const text = section.text.toLowerCase()
      let score = 0
      let matched = 0
      for (const term of terms) {
        const inPath = path.includes(term), inText = countHits(text, term)
        if (inPath || inText) matched++
        score += (inPath ? 3 : 0) + inText + (entryTitle.includes(term) ? 0.5 : 0)
      }
      // 命中的不同关键词越多越靠前
      if (matched) hits.push({ source, entry, section, score: score + matched * 2 })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const perEntry = options.perEntry ?? 3
  const counts = new Map<KBEntry, number>()
  const selected: Array<KnowledgeSectionHit<T>> = []
  for (const hit of hits) {
    if (selected.length >= (options.maxSections ?? 6)) break
    const count = counts.get(hit.entry) || 0
    if (count >= perEntry) continue
    counts.set(hit.entry, count + 1)
    selected.push(hit)
  }
  return selected
}

/** 一份资料的简短目录（一、二级标题），让 AI 知道资料里有哪些内容。 */
export function knowledgeOutlineText(entry: KBEntry, maxChars = 300): string {
  const titles: string[] = []
  const fence = createMarkdownFenceTracker()
  for (const line of entry.content.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence.includes(line)) continue
    const match = /^(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (match && cleanTitle(match[2]) !== entry.title.trim()) titles.push(cleanTitle(match[2]))
  }
  const text = titles.join(' / ')
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}

/** 小节正文过长时，截取关键词附近的一段。 */
export function sectionExcerpt(text: string, keywords: string[], limit: number): string {
  if (text.length <= limit) return text
  const lower = text.toLowerCase()
  const position = keywords.map(keyword => lower.indexOf(keyword.toLowerCase())).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, Math.min(position - Math.floor(limit / 4), text.length - limit))
  return `${start > 0 ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`
}

/** 统一的引用格式：《资料》 › 标题路径：正文片段。 */
export function formatSectionHit(entry: KBEntry, section: KnowledgeSection, keywords: string[], limit: number): string {
  const path = section.path.filter(title => title !== entry.title.trim())
  return `《${entry.title}》${path.length ? ' › ' + path.join(' › ') : ''}：${sectionExcerpt(section.text, keywords, limit)}`
}
