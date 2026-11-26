import { describe, expect, it } from 'vitest'
import { deriveChapterPendingCanon, deriveChapterWorkflow, derivePreviousChapterPendingCanon, type ChapterWorkflowInput } from './chapterWorkflow'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { buildChapterReviewSourceVersion } from '@/services/chapterReviewIdentity'
import type { Chapter } from '@/types/novel'
import type { CandidateChange, ChapterReview, ReviewFinding } from '@/types/reconstruction'

const content = '雨下了一夜。'
const chapter = (over: Partial<Chapter> = {}): Chapter => ({ id: 'c1', volumeIndex: -1, chapterIndex: 0, title: '一', content, summary: '', wordCount: 6,
  status: 'writing', createdAt: '', updatedAt: '', ...over })
const input = (over: Partial<ChapterWorkflowInput> = {}): ChapterWorkflowInput => ({
  chapter: chapter(), content, contextVersion: 'ctx', lengthPolicy: { minWords: 1, targetWords: 5, maxWords: 100 },
  hasPlan: true, storyTimeKnown: true, findings: [], candidates: [], hasPendingRevision: false, ...over })
const review = (over: Partial<ChapterReview> = {}) => ({ id: 'r', chapterId: 'c1', sourceVersionId: buildChapterReviewSourceVersion(content, 'ctx'),
  startedAt: '', deterministicChecksPassed: true, semanticChecksPassed: true, findings: [], candidateChanges: [], status: 'ready_to_finalize', ...over }) as ChapterReview
const blocker: ReviewFinding = { id: 'f', type: 'continuity', severity: 'blocker', title: '', explanation: '', chapterId: 'c1', evidence: [],
  blocksFinalization: true, status: 'open', sourceVersionId: buildAnalysisSourceVersionId(content) }
const candidate = (type: CandidateChange['type'], over: Partial<CandidateChange> = {}): CandidateChange => ({
  id: type, novelId: 'n1', chapterId: 'c1', type, status: 'proposed', sourceVersionId: buildAnalysisSourceVersionId(content),
  proposedValue: '{}', evidence: [], createdAt: '', updatedAt: '', ...over,
})

describe('deriveChapterWorkflow', () => {
  it('derives idea / outlined for empty chapters', () => {
    expect(deriveChapterWorkflow(input({ content: '', chapter: chapter({ content: '' }), hasPlan: false })).status).toBe('idea')
    expect(deriveChapterWorkflow(input({ content: '', chapter: chapter({ content: '' }) })).status).toBe('outlined')
  })
  it('treats a review without matching coverage as not current', () => {
    const wf = deriveChapterWorkflow(input({ latestReview: review() }))
    expect(wf.reviewCurrent).toBe(false)
    expect(wf.status).toBe('drafting')
    expect(wf.primary).toBe('complete')
  })
  it('counts only current-version blockers and pending candidates', () => {
    const wf = deriveChapterWorkflow(input({ findings: [blocker, { ...blocker, id: 'old', sourceVersionId: 'x' }],
      candidates: [{ id: 'k', status: 'proposed', sourceVersionId: buildAnalysisSourceVersionId(content) } as never, { id: 'k2', status: 'proposed', sourceVersionId: 'x' } as never] }))
    expect(wf.blockers.map(f => f.id)).toEqual(['f'])
    expect(wf.pendingCandidates).toHaveLength(1)
    expect(wf.gate.find(g => g.key === 'candidates')?.state).toBe('block')
  })
  it('marks unsaved edits and finalized chapters', () => {
    expect(deriveChapterWorkflow(input({ content: content + '又' })).saved).toBe(false)
    const done = deriveChapterWorkflow(input({ chapter: chapter({ status: 'finalized' }) }))
    expect(done.status).toBe('finalized')
    expect(done.primary).toBeNull()
  })
  it('offers finalize once the chapter is completed with pending candidates', () => {
    expect(deriveChapterWorkflow(input({ chapter: chapter({ status: 'completed' }) })).primary).toBe('finalize')
  })
})

describe('pending canon reminders', () => {
  it('has no reminder when candidates are settled, stale, or owned by another chapter or book', () => {
    const settled = (['accepted', 'edited', 'merged', 'rejected', 'stale'] as const).map(status => candidate('state', { status, id: status }))
    expect(deriveChapterPendingCanon('n1', chapter(), [...settled, candidate('fact', { sourceVersionId: 'other-body' }),
      candidate('timeline', { chapterId: 'other-chapter' }), candidate('knowledge', { novelId: 'other-book' })]))
      .toEqual({ chapterId: 'c1', total: 0, byType: [], summary: '', route: null })
    expect(deriveChapterPendingCanon('n1', chapter(), []).summary).toBe('')
  })

  it('groups distinct changes for the previous chapter and links directly to its writing desk', () => {
    const current = chapter({ id: 'c3', chapterIndex: 2 })
    const book = { id: 'n1', chapters: [current, chapter()] }
    const character = candidate('fact', { proposedValue: '{"kind":"character","name":"林澈"}' })
    const reminder = derivePreviousChapterPendingCanon(book, current.id, [character, character, candidate('relationship'),
      candidate('knowledge', { status: 'deferred', sourceVersionId: undefined }), candidate('foreshadowing'),
      candidate('state', { chapterId: current.id })])
    expect(reminder).toEqual({ chapterId: 'c1', total: 4, byType: [
      { type: 'character', label: '人物', count: 1 }, { type: 'relationship', label: '关系', count: 1 },
      { type: 'knowledge', label: '知情状态', count: 1 }, { type: 'foreshadowing', label: '伏笔', count: 1 },
    ], summary: '上一章还有 4 条人物/关系/知情状态/伏笔变化未确认入典。确认后，AI 可在后续写作中参考。',
    route: { name: 'V3Write', params: { novelId: 'n1', chapterId: 'c1' }, query: { tab: 'candidate' } } })
    expect(derivePreviousChapterPendingCanon(book, 'c1', [])).toBeNull()
  })
})
