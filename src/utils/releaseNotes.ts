// 把发布页的 Markdown 更新说明拆成段落、标题和列表，界面只当文本渲染，不插入 HTML。
export type NoteInline = { text: string; strong?: boolean; code?: boolean }
export type NoteBlock =
  | { kind: 'heading'; level: number; inlines: NoteInline[] }
  | { kind: 'paragraph'; inlines: NoteInline[] }
  | { kind: 'list'; ordered: boolean; items: NoteInline[][] }

const MAX_NOTES = 24_000

export function parseInlines(text: string): NoteInline[] {
  // 链接只保留文字；图片直接去掉。
  const plain = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  const result: NoteInline[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/g
  let last = 0
  for (const match of plain.matchAll(pattern)) {
    if (match.index > last) result.push({ text: plain.slice(last, match.index) })
    if (match[1] !== undefined) result.push({ text: match[1], code: true })
    else result.push({ text: match[2] ?? match[3], strong: true })
    last = match.index + match[0].length
  }
  if (last < plain.length) result.push({ text: plain.slice(last) })
  return result.filter(part => part.text)
}

export function parseReleaseNotes(source: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInlines) })
    list = null
  }
  for (const raw of source.slice(0, MAX_NOTES).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line || /^([-*_])\1{2,}$/.test(line)) { flushParagraph(); flushList(); continue }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (heading) {
      flushParagraph(); flushList()
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseInlines(heading[2]) })
      continue
    }
    const item = /^(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line)
    if (item) {
      flushParagraph()
      const ordered = item[2] !== undefined
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(item[3])
      continue
    }
    const quote = line.replace(/^>\s?/, '')
    // 列表项的续行接到上一项后面。
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + quote; continue }
    flushList()
    paragraph.push(quote)
  }
  flushParagraph(); flushList()
  return blocks
}
