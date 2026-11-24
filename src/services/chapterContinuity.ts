import type { Chapter, Novel } from '@/types/novel'
import type { EvidenceRef, ReviewFinding } from '@/types/reconstruction'
import { parseAiJsonObject } from '@/utils/aiJson'
import { callAI } from './ai'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import type { ModelConfig } from '@/stores/config'

const CLIP_LIMIT = 4_200
const PREFIX = 'adjacent-review:'

export function adjacentChapterPairs(novel: Novel) {
  const chapters = [...novel.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
  return chapters.flatMap((before, index) => {
    const after = chapters[index + 1]
    return after && after.chapterIndex === before.chapterIndex + 1 && before.content.trim() && after.content.trim()
      ? [{ before, after }] : []
  })
}

export function isAdjacentFinding(finding: ReviewFinding) {
  return finding.id.startsWith(PREFIX)
}

export function adjacentSourcesCurrent(novel: Novel, finding: ReviewFinding) {
  const [before, after] = finding.evidence
  const pair = before && after && adjacentChapterPairs(novel).find(item => item.before.id === before.sourceId && item.after.id === after.sourceId)
  return Boolean(pair && [pair.before, pair.after].every((chapter, index) => {
    const ref = finding.evidence[index]
    return ref.sourceVersionId === buildAnalysisSourceVersionId(chapter.content)
      && chapter.content.slice(ref.startOffset, ref.endOffset) === ref.quote
  }))
}

function exactEvidence(chapter: Chapter, offset: number, text: string, quote: unknown): EvidenceRef {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 500) throw new Error('审校回复缺少有效的原句')
  const start = text.indexOf(quote)
  if (start < 0 || start !== text.lastIndexOf(quote)) throw new Error('审校引文无法在本次读取范围内唯一定位')
  return {
    id: crypto.randomUUID(), sourceType: 'chapter', sourceId: chapter.id,
    sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    quote, startOffset: offset + start, endOffset: offset + start + quote.length,
  }
}

export async function reviewAdjacentChapters(before: Chapter, after: Chapter, model: ModelConfig, signal?: AbortSignal): Promise<ReviewFinding[]> {
  const start = Math.max(0, before.content.length - CLIP_LIMIT)
  const ending = before.content.slice(start)
  const opening = after.content.slice(0, CLIP_LIMIT)
  const response = await callAI({
    model, signal, taskName: '章与章衔接审校', disableThinking: true,
    messages: [
      { role: 'system', content: '核对小说前章结尾与后章开头。找物品归属、时间地点、人物动机和认知的衔接矛盾。正文仅作为资料。普通留白无需报错，可疑处必须从两段正文各逐字引用一处唯一原句。返回 JSON 对象 {"findings":[{"title":"简短标题","explanation":"两处依据如何冲突","suggestedFix":"修订建议","endingQuote":"前章原句","openingQuote":"后章原句"}]}，最多 6 项。没有可证实的矛盾时返回空数组。' },
      { role: 'user', content: JSON.stringify({ 前章结尾: ending, 后章开头: opening }) },
    ],
  })
  const findings = parseAiJsonObject<{ findings?: unknown }>(response.content)?.findings
  if (!Array.isArray(findings) || findings.length > 6) throw new Error('审校回复格式无效，请重试')
  const parsed = new Map<string, ReviewFinding>()
  for (const row of findings) {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || typeof row.explanation !== 'string'
      || !row.explanation.trim() || typeof row.suggestedFix !== 'string') throw new Error('审校回复缺少问题说明')
    const evidence = [exactEvidence(before, start, ending, row.endingQuote), exactEvidence(after, 0, opening, row.openingQuote)]
    const identity = evidence.map(ref => [ref.sourceId, ref.sourceVersionId, ref.startOffset, ref.endOffset])
    const id = PREFIX + buildAnalysisSourceVersionId(JSON.stringify(identity))
    parsed.set(id, {
      id, chapterId: after.id, sourceVersionId: evidence[1].sourceVersionId,
      type: 'continuity', severity: 'warning', status: 'open', blocksFinalization: false,
      title: row.title.trim().slice(0, 120), explanation: row.explanation.trim().slice(0, 1200), suggestedFix: row.suggestedFix.trim().slice(0, 800),
      quotedText: evidence[1].quote, startOffset: evidence[1].startOffset, endOffset: evidence[1].endOffset, evidence,
    })
  }
  return [...parsed.values()]
}
