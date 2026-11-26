// 知识库导入时把文本整理成条目。
// whole：一份文件就是一个条目（推荐）；sections：按标题拆成多个条目。
import { createMarkdownFenceTracker } from '@/utils/markdownStructure'

export type KnowledgeSplitMode = 'whole' | 'sections'
export interface KnowledgeSplitOptions {
  mode?: KnowledgeSplitMode
  /** 文本里没有标题时使用的名称，一般是文件名。 */
  fallbackTitle?: string
}
export interface KnowledgeSection { title: string; content: string }

const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const CHINESE_HEADING = /^[ \t]*(第[一二三四五六七八九十百千零〇\d]+[章节回卷部篇集]|[一二三四五六七八九十百]+、|（[一二三四五六七八九十百]+）)[ \t]*\S/
const SEPARATOR = /^[ \t]*---+[ \t]*$/
const TITLE_LIMIT = 180

function cleanTitle(value: string): string {
  return value.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().slice(0, TITLE_LIMIT)
}

function trimBlock(lines: string[]): string {
  const kept = [...lines]
  // 去掉段首尾的空行和分隔线，正文中间的内容原样保留。
  while (kept.length && (!kept[0].trim() || SEPARATOR.test(kept[0]))) kept.shift()
  while (kept.length && (!kept[kept.length - 1].trim() || SEPARATOR.test(kept[kept.length - 1]))) kept.pop()
  return kept.join('\n').trim()
}

/** 文档标题：第一个一级标题；没有时用第一行文字或备用名称。 */
export function knowledgeDocumentTitle(text: string, fallbackTitle = '导入资料'): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const heading = lines.map(line => MARKDOWN_HEADING.exec(line)).find(match => match && match[1].length === 1)
  if (heading) return cleanTitle(heading[2]) || fallbackTitle
  const first = lines.find(line => line.trim() && !SEPARATOR.test(line))
  const title = first ? cleanTitle(first) : ''
  return title && title.length <= 60 ? title : fallbackTitle
}

function splitAt(lines: string[], isBoundary: (line: string) => boolean, titleOf: (line: string) => string, preface: string): KnowledgeSection[] {
  const sections: KnowledgeSection[] = []
  let title = preface
  let body: string[] = []
  const flush = () => {
    const content = trimBlock(body)
    if (content) sections.push({ title: title || preface, content })
  }
  for (const line of lines) {
    if (isBoundary(line)) {
      flush()
      title = titleOf(line)
      body = []
    } else body.push(line)
  }
  flush()
  return sections
}

export function splitKnowledgeText(text: string, options: KnowledgeSplitOptions = {}): KnowledgeSection[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return []
  const fallback = options.fallbackTitle?.trim() || '导入资料'
  const docTitle = knowledgeDocumentTitle(normalized, fallback)
  if (options.mode === 'whole') return [{ title: docTitle, content: normalized.trim() }]

  const lines = normalized.split('\n')
  const headings = lines.map((line, index) => ({ index, match: MARKDOWN_HEADING.exec(line) })).filter(item => item.match)
  const counts = new Map<number, number>()
  for (const item of headings) counts.set(item.match![1].length, (counts.get(item.match![1].length) || 0) + 1)
  // 只有一个一级标题时，它是整篇的题目，不作为拆分点。
  const titleIndex = counts.get(1) === 1 && headings[0]?.match![1].length === 1 ? headings[0].index : -1
  // 拆分层级：出现至少两次的最浅一级标题。
  const level = [...counts.entries()].filter(([, count]) => count >= 2).map(([value]) => value).sort((a, b) => a - b)[0]
  const body = titleIndex >= 0 ? lines.filter((_, index) => index !== titleIndex) : lines
  const preface = titleIndex >= 0 ? docTitle : fallback

  if (level) {
    return splitAt(body, line => MARKDOWN_HEADING.exec(line)?.[1].length === level,
      line => cleanTitle(MARKDOWN_HEADING.exec(line)![2]) || preface, preface)
  }
  if (lines.filter(line => CHINESE_HEADING.test(line)).length >= 2) {
    return splitAt(body, line => CHINESE_HEADING.test(line), line => cleanTitle(line), preface)
  }
  // 没有可用的标题时，按分隔线拆开；也没有分隔线就整篇作为一条。
  const parts = normalized.split(/^[ \t]*---+[ \t]*$/m).map(part => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    return parts.map(part => {
      const partLines = part.split('\n')
      const heading = MARKDOWN_HEADING.exec(partLines[0])
      return heading
        ? { title: cleanTitle(heading[2]) || fallback, content: trimBlock(partLines.slice(1)) || part }
        : { title: cleanTitle(partLines[0]).slice(0, 60) || fallback, content: part }
    }).filter(section => section.content)
  }
  const single = MARKDOWN_HEADING.exec(lines.find(line => line.trim()) || '')
  if (single) {
    const content = trimBlock(lines.slice(lines.findIndex(line => line.trim()) + 1))
    return [{ title: cleanTitle(single[2]) || fallback, content: content || normalized.trim() }]
  }
  return [{ title: docTitle, content: normalized.trim() }]
}

/** 资料内的标题目录（最多到三级），用于阅读时跳转。 */
export function knowledgeOutline(content: string, maxLevel = 3): Array<{ level: number; title: string; index: number }> {
  const outline: Array<{ level: number; title: string; index: number }> = []
  const fence = createMarkdownFenceTracker()
  let index = 0
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence.includes(line)) {
      // renderMd still renders heading-shaped code lines. Count their DOM slots for jumps.
      if (/^#{1,4} .+$/.test(line)) index++
      continue
    }
    const match = MARKDOWN_HEADING.exec(line)
    if (!match) continue
    // renderMd 只把一到四级标题渲染成标题元素，index 与渲染顺序对应。
    if (match[1].length <= 4) {
      if (match[1].length <= maxLevel) outline.push({ level: match[1].length, title: cleanTitle(match[2]), index })
      index++
    }
  }
  return outline
}
