import { describe, expect, it } from 'vitest'
import type { Chapter, Novel } from '@/types/novel'
import {
  classifyOnboardingAudience, defaultOnboardingState, deriveOnboardingChecklist, GUIDE_BEACONS, GUIDE_SCENES,
  isModelReadyForOnboarding, parseOnboardingState, selectVisibleBeacons, type OnboardingAudienceEvidence,
} from './onboardingGuide'

describe('onboarding guide definitions', () => {
  it('retains the P0 scenes and their step order', () => {
    const scenes = ['shelf', 'settings_models', 'settings_assign', 'create_picker', 'create_flow', 'write_first'] as const
    const steps = scenes.flatMap(scene => GUIDE_SCENES[scene])
    expect(steps.map(step => step.id)).toEqual([
      'shelf.start', 'shelf.backup', 'settings.add', 'settings.test', 'settings.assign',
      'create.mode', 'create.origin', 'create.save', 'create.contract', 'create.direction', 'create.firstChapter',
      'write.mode', 'write.type', 'write.save',
    ])
    for (const scene of scenes) {
      expect(GUIDE_SCENES[scene].every(step => step.scene === scene && step.anchor === step.id && step.routePrefix.startsWith('/'))).toBe(true)
    }
  })

  it.each([
    ['write_deep', '/write/', ['write.selection', 'write.review', 'write.margin', 'write.candidate', 'write.finalize']],
    ['plan', '/plan/', ['plan.chapters', 'plan.arcs']],
    ['codex', '/codex/', ['codex.chapter', 'codex.source']],
    ['knowledge', '/knowledge', ['kb.create', 'kb.import', 'kb.bind']],
    ['breakdown', '/breakdown', ['breakdown.source', 'breakdown.budget', 'breakdown.quote']],
  ] as const)('defines the steps and route for %s', (scene, routePrefix, stepIds) => {
    expect(GUIDE_SCENES[scene]).toEqual(stepIds.map(id => expect.objectContaining({
      id, scene, anchor: id, routePrefix, title: expect.stringMatching(/\S/), body: expect.stringMatching(/\S/),
    })))
  })

  it('keeps guide fallback anchors on the steps that need them', () => {
    const fallbacks = Object.values(GUIDE_SCENES).flat().filter(step => step.fallbackAnchor)
    expect(Object.fromEntries(fallbacks.map(step => [step.id, step.fallbackAnchor]))).toEqual({
      'create.contract': 'create.contract.toggle',
      'write.margin': 'write.margin.desk',
      'write.candidate': 'write.candidate.desk',
    })
  })

  it('defines P0 and P1 beacon labels and reuses the owning steps', () => {
    const beacons = Object.entries(GUIDE_BEACONS)
    expect(Object.fromEntries(beacons.map(([id, beacon]) => [id, beacon.label]))).toEqual({
      'write.mode': '模式说明', 'write.type': '排版与手机预览', 'shelf.backup': '记得备份',
      'write.selection': '可改写', 'write.margin': '看朱批', 'write.candidate': '看候选', 'write.finalize': '定稿核对',
      'plan.chapters': '改章纲', 'plan.arcs': '看弧线',
      'codex.chapter': '按章回看', 'codex.source': '查来源',
      'kb.create': '新建资料库', 'kb.import': '导入原文', 'kb.bind': '绑定本书',
      'breakdown.source': '选原文', 'breakdown.budget': '设预算', 'breakdown.quote': '核对原句',
    })
    for (const [id, beacon] of beacons) {
      const { scene, anchor, title, body } = beacon
      expect(beacon.id).toBe(id)
      expect(GUIDE_SCENES[scene].find(step => step.id === id)).toMatchObject({ anchor, title, body })
    }
  })
})

describe('visible beacons', () => {
  const candidates = ['write.selection', 'write.candidate', 'write.margin', 'write.finalize'] as const

  it('takes the first two eligible beacons in candidate order', () => {
    expect(selectVisibleBeacons(candidates, id => id !== 'write.selection')).toEqual(['write.candidate', 'write.margin'])
    expect(selectVisibleBeacons(candidates, () => false)).toEqual([])
  })

  it('honors smaller limits and keeps the maximum at two', () => {
    expect(selectVisibleBeacons(candidates, () => true, 1)).toEqual(['write.selection'])
    expect(selectVisibleBeacons(candidates, () => true, 0)).toEqual([])
    expect(selectVisibleBeacons(candidates, () => true, -1)).toEqual([])
    expect(selectVisibleBeacons(candidates, () => true, 3)).toEqual(['write.selection', 'write.candidate'])
  })
})

describe('onboarding state and audience', () => {
  it('round-trips supported state and uses independent default markers', () => {
    const state = defaultOnboardingState('new')
    state.seen.push('shelf.start')
    state.skipped.push('create_picker')
    state.achieved.push('first_book_created')
    expect(parseOnboardingState(JSON.stringify(state))).toEqual(state)
    expect(defaultOnboardingState('new')).toMatchObject({ enabled: true, checklist: 'expanded', seen: [], skipped: [], achieved: [] })
    expect(defaultOnboardingState()).toMatchObject({ audience: 'unknown', enabled: false, checklist: 'dismissed' })
  })

  it.each([null, '', '{', 'null', '[]', '{}'])('rejects an invalid state %s', raw => {
    expect(parseOnboardingState(raw)).toBeNull()
  })

  it.each([
    { schema: 2 }, { schema: '1' }, { audience: 'returning' }, { enabled: 'true' }, { checklist: 'closed' },
    { path: 'automatic' }, { seen: ['shelf.start', 3] }, { skipped: null }, { achieved: ['legacy'] }, { achieved: {} },
  ])('rejects invalid field values %j', fields => {
    expect(parseOnboardingState(JSON.stringify({ ...defaultOnboardingState('new'), ...fields }))).toBeNull()
  })

  const history: OnboardingAudienceEvidence[] = [
    { hasLegacyGuideSeen: true }, { hasPreExistingFirstUseAt: true }, { hasBackupTimestamp: true },
    { hadPreExistingSnapshot: true }, { novelCount: 1 }, { modelCount: 1 }, { knowledgeBaseCount: 1 },
    { inspirationSessionCount: 1 }, { breakdownJobCount: 1 },
  ]
  it.each(history)('prioritizes historical evidence %j over read failures', evidence => {
    expect(classifyOnboardingAudience({ ...evidence, configLoadFailed: true, storageUnavailable: true, breakdownCheckFailed: true })).toBe('existing')
  })

  it.each([{ configLoadFailed: true }, { storageUnavailable: true }, { breakdownCheckFailed: true }])('classifies uncertain evidence %j conservatively', evidence => {
    expect(classifyOnboardingAudience(evidence)).toBe('unknown')
  })

  it('recognizes a fresh profile with no historical evidence', () => {
    expect(classifyOnboardingAudience({ hadPreExistingSnapshot: false, novelCount: 0, modelCount: 0 })).toBe('new')
    expect(classifyOnboardingAudience({ hadPreExistingSnapshot: null })).toBe('new')
  })
})

describe('onboarding checklist', () => {
  function book(id: string, status: Novel['status'], content?: string): Novel {
    const chapters = content === undefined ? [] : [{ id: id + '-ch', title: '有章名', content } as Chapter]
    return { id, title: id, status, chapters, updatedAt: id } as Novel
  }

  const empty = { novels: [], models: [], readyModelIds: new Set<string>(), hasBackupTimestamp: false }

  it('requires a successful matching connection for a non-vector model', () => {
    const test = { status: 'ok', environment: 'desktop', fingerprint: 'fingerprint' } as const
    expect(isModelReadyForOnboarding({ connectionTest: test }, 'desktop', 'fingerprint')).toBe(true)
    expect(isModelReadyForOnboarding({ kind: 'embedding', connectionTest: test }, 'desktop', 'fingerprint')).toBe(false)
    expect(isModelReadyForOnboarding({ connectionTest: test }, 'browser', 'fingerprint')).toBe(false)
    expect(isModelReadyForOnboarding({ connectionTest: test }, 'desktop', 'edited')).toBe(false)
    expect(isModelReadyForOnboarding({ connectionTest: { ...test, status: 'fail' } }, 'desktop', 'fingerprint')).toBe(false)
    expect(isModelReadyForOnboarding({}, 'desktop', 'fingerprint')).toBe(false)
  })

  it.each(['undecided', 'ai', 'manual'] as const)('counts the correct core items for path %s', path => {
    const summary = deriveOnboardingChecklist({ ...empty, state: { ...defaultOnboardingState('new'), path } })
    expect(summary.coreItems.map(item => item.id)).toEqual(path === 'manual'
      ? ['first_book_created', 'first_chapter_saved'] : ['model_ready', 'first_book_created', 'first_chapter_saved'])
    expect(summary.totalCore).toBe(summary.coreItems.length)
    expect(summary.completedCore).toBe(0)
    expect(summary.allCoreDone).toBe(false)
    expect(summary.optionalItems.map(item => item.id)).toEqual(['first_review_completed'])
  })

  it('requires non-blank prose outside the trash and gates the backup item', () => {
    const state = defaultOnboardingState('new')
    state.achieved.push('first_chapter_saved', 'first_review_completed')
    const novels = [book('a', 'writing', ' \n\t'), book('b', 'trash', '回收站正文')]
    const summary = deriveOnboardingChecklist({ ...empty, state, novels })
    expect(summary.completedCore).toBe(1)
    expect(summary.optionalItems).toEqual([{ id: 'first_review_completed', label: '体验一次 AI 审校', done: true }])
    expect(deriveOnboardingChecklist({ ...empty, state, novels: novels.slice(1) }).completedCore).toBe(0)
  })

  it('counts existing durable prose and ignores archived and trashed books for the resume target', () => {
    const state = defaultOnboardingState('new')
    const models = [{ id: 'vector', kind: 'embedding' }, { id: 'writer', kind: 'chat' }] as const
    const novels = [book('a', 'writing', '正文'), book('b', 'creating'), book('c', 'archived'), book('d', 'trash')]
    const summary = deriveOnboardingChecklist({ state, novels, models, readyModelIds: new Set(['writer']), hasBackupTimestamp: true })
    expect(summary).toMatchObject({ completedCore: 3, totalCore: 3, allCoreDone: true, hasOnlyEmbeddingModels: false,
      activeNovelId: 'b', activeNovelTitle: 'b', activeNovelPath: '/generate/b' })
    expect(summary.optionalItems.find(item => item.id === 'first_backup_exported')).toMatchObject({ done: true })
    expect(deriveOnboardingChecklist({ ...empty, state, novels, activeBookPath: novel => '/custom/' + novel.id }).activeNovelPath).toBe('/custom/b')
    expect(deriveOnboardingChecklist({ ...empty, state, novels: [book('archive', 'archived', '存档正文')] })).toMatchObject({ completedCore: 2, activeNovelId: null })
  })

  it('does not count vectors or prose still waiting for persistence', () => {
    const state = defaultOnboardingState('new')
    const summary = deriveOnboardingChecklist({ ...empty, state, models: [{ id: 'vector', kind: 'embedding' }],
      readyModelIds: new Set(['vector']), novels: [book('a', 'writing', '未保存正文')], isChapterPersisted: () => false })
    expect(summary).toMatchObject({ hasOnlyEmbeddingModels: true, completedCore: 1, allCoreDone: false })
    expect(summary.optionalItems).toHaveLength(1)
  })
})
