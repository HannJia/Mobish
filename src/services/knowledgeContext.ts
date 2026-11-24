import type { Novel } from '@/types/novel'
import { useKnowledgeStore, type KBEntry } from '@/stores/knowledge'
import type { KnowledgeBase } from '@/types/knowledge'
import { getCurrentBaseSummary } from './knowledgeSources'
import { knowledgeReferenceInput } from './knowledgeSelection'
import { canUseKnowledgeBaseSummary } from './knowledgeVisibility'
import { formatSectionHit, knowledgeOutlineText, retrieveKnowledgeSections } from './knowledgeSections'

function splitKeywords(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[\s\n，。！？、；：,.!?;:《》“”‘’（）()【】\[\]-]+/)
      .map(value => value.trim())
      .filter(value => value.length >= 2),
  ))
}

/**
 * 整份导入的资料可能很长：问题里的关键词出现在资料中间时，取关键词附近的原文片段（尽量覆盖更多不同关键词），
 * 而不是只取开头。没有命中时沿用原来的做法：有摘要用摘要，否则取开头。
 */
export function knowledgeEntryExcerpt(entry: Pick<KBEntry, 'content' | 'summary'>, keywords: string[], limit: number): string {
  const content = entry.content
  if (content.length <= limit || !keywords.length) return (entry.summary || content).slice(0, limit)
  const lower = content.toLowerCase()
  const hits: Array<{ keyword: string; position: number }> = []
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase()
    let position = lower.indexOf(needle)
    for (let count = 0; position >= 0 && count < 200; count++) {
      hits.push({ keyword: needle, position })
      position = lower.indexOf(needle, position + needle.length)
    }
  }
  if (!hits.length) return (entry.summary || content).slice(0, limit)
  const lead = Math.floor(limit / 4)
  let best = { start: 0, score: -1 }
  for (const hit of hits) {
    const start = Math.max(0, Math.min(hit.position - lead, content.length - limit))
    const score = new Set(hits.filter(other => other.position >= start && other.position < start + limit).map(other => other.keyword)).size
    if (score > best.score) best = { start, score }
  }
  const end = Math.min(content.length, best.start + limit)
  return `${best.start > 0 ? '…' : ''}${content.slice(best.start, end)}${end < content.length ? '…' : ''}`
}

function getBoundKnowledgeEntries(novel: Novel, query = '', maxEntries = 8): KBEntry[] {
  if (!novel.knowledgeBaseIds?.length) return []
  try {
    const store = useKnowledgeStore()
    return store.getRelevantEntries(novel.knowledgeBaseIds, splitKeywords(query).slice(0, 40), maxEntries)
  } catch {
    return []
  }
}

export function buildBoundKnowledgeContext(
  novel: Novel,
  query = '',
  maxEntries = 8,
  entryLimit = 700,
): string {
  const entries = getBoundKnowledgeEntries(novel, query, maxEntries)
  if (!entries.length) return ''
  const keywords = splitKeywords(query).slice(0, 40)
  // 按标题分段检索：取最相关的小节原文；没有命中时沿用摘要或开头
  const hits = retrieveKnowledgeSections(entries.map(entry => ({ source: entry, entry })), keywords, { maxSections: maxEntries, perEntry: 3 })
  const entryLines = hits.length
    ? hits.map(hit => '• ' + formatSectionHit(hit.entry, hit.section, keywords, entryLimit))
    : entries.map(entry => `• [${entry.category}] ${entry.title}：${knowledgeEntryExcerpt(entry, keywords, entryLimit)}`)
  const outlines = entries.slice(0, 4).flatMap(entry => {
    const outline = knowledgeOutlineText(entry)
    return outline ? [`• 《${entry.title}》：${outline}`] : []
  })
  try {
    const store = useKnowledgeStore()
    const boundIds = new Set(novel.knowledgeBaseIds || [])
    const summaries = store.knowledgeBases
      .filter(base => boundIds.has(base.id) && canUseKnowledgeBaseSummary(base))
      .flatMap(base => {
        const summary = getCurrentBaseSummary(base)
        return summary ? ['• ' + base.name + '：' + summary.slice(0, Math.max(entryLimit * 2, 1200))] : []
      })
    return [
      '【当前小说已挂载知识库（仅供本书参考）】',
      summaries.length ? `知识库摘要：\n${summaries.join('\n')}` : '',
      outlines.length ? `资料目录：\n${outlines.join('\n')}` : '',
      hits.length ? '相关资料片段（按标题定位的原文）：' : '相关资料条目：',
      ...entryLines,
    ].filter(Boolean).join('\n')
  } catch {
    return entryLines.join('\n')
  }
}

// Include entry content so editing a bound entry invalidates cached AI context.
export function buildBoundKnowledgeSignature(novel: Novel, snapshot?: KnowledgeBase[]): string {
  if (!novel.knowledgeBaseIds?.length) return ''
  if (snapshot !== undefined) return JSON.stringify(knowledgeReferenceInput(snapshot, novel.knowledgeBaseIds))
  try {
    return JSON.stringify(knowledgeReferenceInput(useKnowledgeStore().knowledgeBases, novel.knowledgeBaseIds))
  } catch {
    return ''
  }
}
