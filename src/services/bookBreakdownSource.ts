import type { KBEntry } from '@/types/knowledge'
import type { Novel } from '@/types/novel'
import { knowledgeSections } from '@/services/knowledgeSections'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { entrySourceVersion } from '@/services/knowledgeSources'

export type BreakdownOrigin = { kind: 'file' } | { kind: 'knowledge'; baseId: string; entryId: string }
  | { kind: 'manuscript'; novelId: string }

export interface BreakdownBlock { start: number; end: number; paragraph: number }
export interface BreakdownSection { key: string; title: string; volume: string; blocks: BreakdownBlock[] }
export interface BreakdownSource {
  title: string
  version: string
  origin: BreakdownOrigin
  text: string
  sections: BreakdownSection[]
}

export const BREAKDOWN_TOPICS = [
  '开篇如何让人追读', '人物动机与弧线', '冲突升级与节奏', '伏笔与回收', '自定义问题',
] as const

const VOLUME = /^(?:第[\d０-９一二三四五六七八九十百千两零〇]+[卷部集]|卷[一二三四五六七八九十百\d]+)(?:\s|[：:·、]|$)/u
const CHAPTER = /^(?:第[\d０-９一二三四五六七八九十百千两零〇]+[章节回]|chapter\s+\d+\b|(?:序章|楔子|引子|序言|卷首语|后记|尾声)(?:\s|[：:·、]|$))/iu
const FRONT_MATTER = /^(?:序章|楔子|引子|序言|卷首语|后记|尾声)/u

export function makeBreakdownSource(title: string, text: string, origin: BreakdownOrigin, version?: string): BreakdownSource {
  const virtualEntry: KBEntry = { id: '', title, content: text, category: '', summary: '', tags: [], createdAt: '', updatedAt: '' }
  const sections: BreakdownSection[] = []
  let volume = ''
  let sectionTitle = ''
  const headings: Array<{ offset: number; title: string; volume: string }> = []
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    const line = match[0].trim()
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (line.length > 100) continue
    const name = (heading?.[2] || line).trim()
    if (VOLUME.test(name)) {
      volume = name
      sectionTitle = '卷首'
    } else if (CHAPTER.test(name) || (heading && heading[1].length <= 2)) {
      sectionTitle = name
    } else continue
    headings.push({ offset: match.index + match[0].length, title: sectionTitle, volume })
  }

  // The knowledge parser supplies exact offsets. Split again at any chapter
  // heading it did not recognise while retaining the rest of the source text.
  const breaks = new Set(knowledgeSections(virtualEntry).flatMap(part => [part.start, part.end]))
  const seen = new Map<string, number>()
  let number = 0
  let paragraph = 0
  const addRegion = (start: number, end: number, heading?: typeof headings[number]) => {
    const blocks: BreakdownBlock[] = []
    for (const match of text.slice(start, end).matchAll(/[^\r\n]+/g)) {
      const value = match[0].trim()
      if (!value || /^---+$/.test(value)) continue
      const from = start + match.index + match[0].indexOf(value)
      const to = from + value.length
      paragraph++
      for (let offset = from; offset < to;) {
        let next = Math.min(offset + 1100, to)
        if (next < to && /[\uDC00-\uDFFF]/.test(text[next])) next--
        blocks.push({ start: offset, end: next, paragraph })
        offset = next
      }
    }
    if (!blocks.length) return
    if (!heading && !headings.length) {
      let group: BreakdownBlock[] = []
      let startOfGroup = blocks[0].start
      for (const block of blocks) {
        if (group.length && (breaks.has(block.start) || block.end - startOfGroup > 3500)) {
          sections.push({ key: 'part-' + ++number, title: '原文段落 ' + number, volume: '', blocks: group })
          group = []
          startOfGroup = block.start
        }
        group.push(block)
      }
      if (group.length) sections.push({ key: 'part-' + ++number, title: '原文段落 ' + number, volume: '', blocks: group })
      return
    }
    const label = heading?.title || '卷首语'
    const path = JSON.stringify([heading?.volume || '', label])
    const occurrence = (seen.get(path) || 0) + 1
    seen.set(path, occurrence)
    sections.push({ key: JSON.stringify([path, occurrence]), title: label, volume: heading?.volume || '', blocks })
  }
  let start = 0
  let current: typeof headings[number] | undefined
  for (const heading of headings) {
    const headingStart = Math.max(start, text.lastIndexOf('\n', heading.offset - 1) + 1, text.lastIndexOf('\r', heading.offset - 1) + 1)
    addRegion(start, headingStart, current)
    start = heading.offset
    current = heading
  }
  addRegion(start, text.length, current)
  return { title, text, sections, origin, version: version || buildAnalysisSourceVersionId(JSON.stringify([title, text])) }
}

export function knowledgeBreakdownSource(baseId: string, entry: KBEntry) {
  return makeBreakdownSource(entry.title, entry.content, { kind: 'knowledge', baseId, entryId: entry.id }, entrySourceVersion(baseId, entry))
}

export function manuscriptBreakdownSource(novel: Novel): BreakdownSource {
  let text = ''
  const sections: BreakdownSection[] = []
  let paragraph = 0
  const chapters = [...novel.chapters].sort((left, right) => left.chapterIndex - right.chapterIndex)
  for (const chapter of chapters) {
    if (!chapter.content.trim()) continue
    const shift = text.length
    const original = chapter.content
    const parts = makeBreakdownSource(chapter.title, original, { kind: 'file' }).sections
    const blocks = parts.flatMap(part => part.blocks.map(block => ({ start: block.start + shift, end: block.end + shift,
      paragraph: block.paragraph + paragraph })))
    if (!blocks.length) continue
    paragraph = blocks[blocks.length - 1].paragraph
    text += original + '\n\n'
    const volume = novel.volumes.find(item => item.volumeIndex === chapter.volumeIndex)
    sections.push({ key: chapter.id, title: `第${chapter.chapterIndex + 1}章 · ${chapter.title}`, volume: volume?.title || '', blocks })
  }
  const version = buildAnalysisSourceVersionId(JSON.stringify([novel.title, text, sections.map(({ key, title, volume }) => [key, title, volume])]))
  return { title: novel.title, origin: { kind: 'manuscript', novelId: novel.id }, version, text, sections }
}

export function openingSections(source: BreakdownSource): string[] {
  const chapters = source.sections.filter(section => CHAPTER.test(section.title) && !FRONT_MATTER.test(section.title))
  const body = chapters.length ? chapters : source.sections.filter(section => !FRONT_MATTER.test(section.title) && section.title !== '卷首')
  return body.slice(0, 3).map(section => section.key)
}

export interface BreakdownPart {
  key: string
  fingerprint: string
  sectionKey: string
  blocks: BreakdownBlock[]
}

export function breakdownParts(source: BreakdownSource, selected: string[], singleBlock: BreakdownBlock | null, limit: number): BreakdownPart[] {
  const keys = new Set(selected)
  return source.sections.filter(section => keys.has(section.key)).flatMap(section => {
    const blocks = singleBlock ? section.blocks.filter(block => block.start === singleBlock.start && block.end === singleBlock.end) : section.blocks
    const result: BreakdownPart[] = []
    let group: BreakdownBlock[] = []
    let size = 0
    const push = () => {
      if (!group.length) return
      result.push({
        key: JSON.stringify([section.key, result.length]), sectionKey: section.key, blocks: group,
        fingerprint: buildAnalysisSourceVersionId(JSON.stringify([source.title, section.title, section.volume,
          group.map(block => source.text.slice(block.start, block.end))])),
      })
    }
    for (const block of blocks) {
      const next = block.end - block.start + 18
      if (group.length && (size + next > limit || group.length >= 30)) {
        push()
        group = []
        size = 0
      }
      group.push(block)
      size += next
    }
    push()
    return result
  })
}
