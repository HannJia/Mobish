// 知识库按标题分段检索：把每份资料按标题切成小节（带标题路径），按关键词挑出最相关的小节交给 AI。
// 不调用模型、不花费用；读到的是原文。没有标题的资料按段落切成约一千字的小块。
import type { KBEntry } from '@/types/knowledge'

export interface KnowledgeSection {
  /** 标题路径，如 ['二、完整时间线', '阶段四 · 全面市场化', '1998年7月3日｜房改 23 号文']。 */
  path: string[]
  text: string
}
export interface KnowledgeSectionHit<T> { source: T; entry: KBEntry; section: KnowledgeSection; score: number }

const MARKDOWN_HEADING = /^(#{1,4})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const CHINESE_HEADING = /^[ \t]*(第[一二三四五六七八九十百千零〇\d]+[章节回卷部篇集]|[一二三四五六七八九十百]+、|（[一二三四五六七八九十百]+）)[ \t]*\S.{0,60}$/
const SECTION_LIMIT = 1200
const CHUNK_TARGET = 1000

const cleanTitle = (value: string) => value.replace(/[`*_]/g, '').trim().slice(0, 120)

/** 过长的小节按段落再分块，保留同一标题路径。 */
function chunk(path: string[], text: string, untitled: boolean, counter: { value: number }): KnowledgeSection[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= SECTION_LIMIT) return [{ path: untitled ? [`第 ${++counter.value} 段`] : path, text: trimmed }]
  const parts: string[] = []
  let current = ''
  for (const paragraph of trimmed.split(/\n\s*\n/)) {
    if (current && current.length + paragraph.length > CHUNK_TARGET) { parts.push(current); current = '' }
    // 单个段落超长时按固定长度切开
    let rest = paragraph
    while (rest.length > SECTION_LIMIT) { parts.push((current ? current + '\n\n' : '') + rest.slice(0, CHUNK_TARGET)); current = ''; rest = rest.slice(CHUNK_TARGET) }
    current = current ? current + '\n\n' + rest : rest
  }
  if (current.trim()) parts.push(current)
  return parts.map((part, index) => ({
    path: untitled ? [`第 ${++counter.value} 段`] : parts.length > 1 ? [...path.slice(0, -1), `${path[path.length - 1] || ''}（${index + 1}/${parts.length}）`] : path,
    text: part.trim(),
  }))
}

const cache = new WeakMap<KBEntry, { content: string; sections: KnowledgeSection[] }>()

export function knowledgeSections(entry: KBEntry): KnowledgeSection[] {
  const cached = cache.get(entry)
  if (cached && cached.content === entry.content) return cached.sections
  const lines = entry.content.replace(/\r\n?/g, '\n').split('\n')
  const hasMarkdown = lines.some(line => MARKDOWN_HEADING.test(line))
  const headingOf = (line: string): { level: number; title: string } | null => {
    const markdown = MARKDOWN_HEADING.exec(line)
    if (markdown) return { level: markdown[1].length, title: cleanTitle(markdown[2]) }
    if (!hasMarkdown && CHINESE_HEADING.test(line)) return { level: 2, title: cleanTitle(line) }
    return null
  }
  const sections: KnowledgeSection[] = []
  const stack: Array<{ level: number; title: string }> = []
  const counter = { value: 0 }
  let body: string[] = []
  let anyHeading = false
  const flush = () => {
    const path = stack.map(item => item.title)
    sections.push(...chunk(path.length ? path : [entry.title], body.join('\n').replace(/^\s*---+\s*$/gm, ''), !anyHeading, counter))
    body = []
  }
  for (const line of lines) {
    const heading = headingOf(line)
    if (!heading) { body.push(line); continue }
    flush()
    anyHeading = true
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop()
    stack.push(heading)
  }
  flush()
  cache.set(entry, { content: entry.content, sections })
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
  for (const line of entry.content.replace(/\r\n?/g, '\n').split('\n')) {
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
