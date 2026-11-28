// @vitest-environment happy-dom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useOnboardingStore } from './onboarding'
import { useConfigStore, type ModelConfig } from './config'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { useInspirationSessionsStore } from './inspirationSessions'
import { loadBreakdownJobs } from '@/services/bookBreakdownDb'
import { saveNovelToDb } from '@/services/db/novels'
import { modelConnectionFingerprint } from '@/services/modelConnectionTest'
import { createProjectBackup } from '@/services/projectBackup'
import {
  defaultOnboardingState, FIRST_USE_AT_KEY, GUIDE_BEACONS, LAST_BACKUP_KEY, LEGACY_GUIDE_SEEN_KEY, ONBOARDING_STORAGE_KEY,
  type OnboardingStateV1,
} from '@/services/onboardingGuide'

vi.mock('@/services/bookBreakdownDb', () => ({ loadBreakdownJobs: vi.fn() }))
vi.mock('@/services/db/novels', () => ({ saveNovelToDb: vi.fn(), loadAllNovelsFromDb: vi.fn().mockResolvedValue([]) }))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  setActivePinia(pinia = createPinia())
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  vi.mocked(loadBreakdownJobs).mockReset().mockResolvedValue([])
  vi.mocked(saveNovelToDb).mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  disposePinia(pinia)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.electronAPI = undefined
})

function addBook(status: 'writing' | 'trash' | 'archived' = 'writing') {
  const novels = useNovelStore()
  const book = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
  book.status = status
  return book
}

function model(id: string, kind?: ModelConfig['kind']): ModelConfig {
  return { id, kind, name: id, baseUrl: 'https://example.test/v1', modelName: id, apiKey: '', maxTokens: 100, temperature: 0.5, topP: 1 }
}

describe('onboarding initialization', () => {
  it('initializes a fresh profile once, even with concurrent callers', async () => {
    const onboarding = useOnboardingStore()
    expect(onboarding.showChecklist).toBe(false)
    await Promise.all([onboarding.initialize({ hadPreExistingSnapshot: false }), onboarding.initialize()])
    expect(onboarding.initialized).toBe(true)
    expect(onboarding.state).toEqual(defaultOnboardingState('new'))
    expect(onboarding.showChecklist).toBe(true)
    expect(loadBreakdownJobs).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual(onboarding.state)
    expect(localStorage.getItem(FIRST_USE_AT_KEY)).toBeNull()
  })

  it.each([LEGACY_GUIDE_SEEN_KEY, FIRST_USE_AT_KEY, LAST_BACKUP_KEY])('treats %s as historical evidence', async key => {
    localStorage.setItem(key, '1')
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.state).toEqual(defaultOnboardingState('existing'))
    expect(onboarding.showChecklist).toBe(false)
    expect(loadBreakdownJobs).not.toHaveBeenCalled()
  })

  it.each([
    ['trash', () => addBook('trash')],
    ['archive', () => addBook('archived')],
    ['vector', () => useConfigStore().models.push(model('vector', 'embedding'))],
    ['knowledge', () => useKnowledgeStore().knowledgeBases.push({ id: 'kb', name: '资料库', description: '', entries: [], createdAt: '' })],
    ['inspiration', () => useInspirationSessionsStore().adopt([{ id: 'session', title: '灵感', messages: [], updatedAt: '2026-11-27T00:00:00.000Z',
      knowledgeIds: null, draft: '', webSearch: false }])],
  ] as const)('detects a profile with only %s', async (_label, setup) => {
    setup()
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.state).toEqual(defaultOnboardingState('existing'))
    expect(loadBreakdownJobs).not.toHaveBeenCalled()
  })

  it('uses the pre-initialization snapshot, even if it is empty', async () => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize({ hadPreExistingSnapshot: true })
    expect(onboarding.state).toEqual(defaultOnboardingState('existing'))
    expect(loadBreakdownJobs).not.toHaveBeenCalled()
  })

  it('checks breakdown jobs when there is no other evidence', async () => {
    const onboarding = useOnboardingStore()
    const checkBreakdownJobs = vi.fn().mockResolvedValue(1)
    await onboarding.initialize({ checkBreakdownJobs })
    expect(onboarding.state.audience).toBe('existing')
    expect(checkBreakdownJobs).toHaveBeenCalledOnce()
  })

  it('restores a P0 record and persists new markers in the same schema', async () => {
    const saved: OnboardingStateV1 = {
      schema: 1, audience: 'existing', enabled: true, path: 'manual', checklist: 'collapsed',
      seen: ['write.type'], skipped: ['write_first'], achieved: ['first_book_created'],
    }
    const raw = JSON.stringify(saved)
    localStorage.setItem(ONBOARDING_STORAGE_KEY, raw)
    const onboarding = useOnboardingStore()
    await onboarding.initialize({ configLoadFailed: true })
    expect(onboarding.state).toEqual(saved)
    expect(loadBreakdownJobs).not.toHaveBeenCalled()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe(raw)
    expect(onboarding.shouldShowBeacon('write.type')).toBe(false)
    expect(onboarding.shouldShowBeacon('write.mode')).toBe(false)
    expect(onboarding.shouldShowBeacon('shelf.backup')).toBe(true)
    expect(onboarding.shouldShowBeacon('write.selection')).toBe(true)

    onboarding.markSeen('write.selection')
    onboarding.skipScene('knowledge')
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({
      ...saved, seen: ['write.type', 'write.selection'], skipped: ['write_first', 'knowledge'],
    })
  })

  it('reclassifies corrupt JSON using the remaining profile evidence', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '{broken')
    localStorage.setItem(FIRST_USE_AT_KEY, '12345')
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.state).toEqual(defaultOnboardingState('existing'))
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual(onboarding.state)
  })

  it('uses unknown when local storage cannot be read', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage blocked') }, setItem: vi.fn() })
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.state).toEqual(defaultOnboardingState('unknown'))
  })

  it('uses unknown when config loading failed', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const configs = useConfigStore()
    localStorage.setItem('mojian-v3-config', '{broken')
    const configLoaded = await configs.loadConfig()
    expect(configLoaded).toBe(false)
    expect(warning).toHaveBeenCalled()
    const onboarding = useOnboardingStore()
    await onboarding.initialize({ configLoadFailed: !configLoaded })
    expect(onboarding.state).toEqual(defaultOnboardingState('unknown'))
  })

  it('uses unknown when breakdown storage fails', async () => {
    vi.mocked(loadBreakdownJobs).mockRejectedValueOnce(new Error('cannot read jobs'))
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.state).toEqual(defaultOnboardingState('unknown'))
  })

  it('keeps state changes in memory when writing markers fails', async () => {
    const setItem = vi.fn(() => { throw new Error('quota') })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem })
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    onboarding.setPath('manual')
    onboarding.recordAchievement('first_book_created')
    expect(onboarding.state).toMatchObject({ audience: 'new', path: 'manual', achieved: ['first_book_created'] })
    expect(setItem).toHaveBeenCalledTimes(3)
  })
})

describe('onboarding progress', () => {
  it.each(['browser', 'electron'] as const)('refreshes readiness when a verified %s model changes', async environment => {
    if (environment === 'electron') window.electronAPI = {} as typeof window.electronAPI
    const config = useConfigStore()
    const ready = model('ready')
    ready.connectionTest = { status: 'ok', fingerprint: await modelConnectionFingerprint(ready), environment, testedAt: '' }
    const vector = model('vector', 'embedding')
    vector.connectionTest = { ...ready.connectionTest, fingerprint: await modelConnectionFingerprint(vector) }
    config.models.push(ready, vector)
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    expect(onboarding.readyModelIds).toEqual(new Set(['ready']))
    config.models[0].modelName = 'changed-name'
    await vi.waitFor(() => expect(onboarding.readyModelIds.size).toBe(0))
    config.models[0].modelName = 'ready'
    await vi.waitFor(() => expect(onboarding.readyModelIds).toEqual(new Set(['ready'])))
    config.models[0].connectionTest!.environment = environment === 'browser' ? 'electron' : 'browser'
    await onboarding.refreshModelReadiness()
    expect(onboarding.readyModelIds.size).toBe(0)
  })

  it('leaves a chapter unchecked through a failed write and rechecks after durable retry', async () => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    onboarding.setPath('manual')
    const novels = useNovelStore()
    const book = addBook()
    const chapter = novels.addChapter(book.id, { title: '第一章', content: ' ' })!
    await novels.saveNovelNow(book.id)
    expect(onboarding.checklistSummary.completedCore).toBe(1)
    novels.updateChapter(book.id, chapter.id, { content: '第一段正文。' })
    vi.mocked(saveNovelToDb).mockRejectedValueOnce(new Error('disk unavailable'))
    expect(onboarding.checklistSummary.completedCore).toBe(1)
    await expect(novels.saveNovelNow(book.id)).rejects.toThrow('disk unavailable')
    expect(onboarding.checklistSummary.completedCore).toBe(1)
    await novels.saveNovelNow(book.id)
    expect(onboarding.checklistSummary.allCoreDone).toBe(true)
  })

  it('dismisses unstarted guidance after replacing the project and reads the imported book', async () => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    onboarding.startTour('shelf')
    const book = addBook()
    useNovelStore().addChapter(book.id, { content: '旧项目已保存的正文。' })
    useNovelStore().adoptImportedNovels(useNovelStore().novels)
    await onboarding.handleProjectImported()
    expect(onboarding.state).toEqual(defaultOnboardingState('existing'))
    expect(onboarding.activeTour).toBeNull()
    expect(onboarding.showChecklist).toBe(false)
    expect(onboarding.checklistSummary).toMatchObject({ activeNovelId: book.id, completedCore: 2 })
  })

  it('navigates, skips and replays the guide while keeping business achievements', async () => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    onboarding.setPath('ai')
    onboarding.startTour('write_first', 'write.type')
    expect(onboarding.currentStep?.id).toBe('write.type')
    onboarding.prevStep()
    expect(onboarding.currentStep?.id).toBe('write.mode')
    onboarding.nextStep()
    expect(onboarding.isSeen('write.mode')).toBe(true)
    expect(onboarding.shouldShowBeacon('write.mode')).toBe(false)
    onboarding.skipScene()
    expect(onboarding.currentStep).toBeNull()
    expect(onboarding.shouldShowBeacon('write.type')).toBe(false)
    onboarding.startTour('write_first')
    expect(onboarding.activeTour).toBeNull()
    onboarding.recordAchievement('first_book_created')
    onboarding.recordAchievement('first_book_created')
    onboarding.disableAll()
    expect(onboarding.showChecklist).toBe(false)
    onboarding.replay()
    expect(onboarding.state).toMatchObject({ enabled: true, path: 'ai', checklist: 'expanded', skipped: [],
      seen: ['write.mode'], achieved: ['first_book_created'] })
    expect(onboarding.shouldShowBeacon('write.type')).toBe(true)
    onboarding.startTour('write_first', 'write.save')
    onboarding.nextStep()
    expect(onboarding.currentStep).toBeNull()
    expect(onboarding.isSeen('write.save')).toBe(true)
    onboarding.resetMarkers()
    expect(onboarding.state).toMatchObject({ seen: [], skipped: [], achieved: ['first_book_created'] })
  })

  it.each(['write_deep', 'plan', 'codex', 'knowledge', 'breakdown'] as const)('only hides beacons owned by the skipped scene %s', async scene => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    const beacons = Object.values(GUIDE_BEACONS)
    expect(beacons.every(beacon => onboarding.shouldShowBeacon(beacon.id))).toBe(true)

    onboarding.skipScene(scene)
    for (const beacon of beacons) {
      expect(onboarding.shouldShowBeacon(beacon.id)).toBe(beacon.scene !== scene)
    }
    expect(onboarding.shouldShowBeacon('write.review')).toBe(false)
    expect(onboarding.shouldShowBeacon('constructor')).toBe(false)
  })

  it('filters ineligible beacons before applying the per-screen limit', async () => {
    const onboarding = useOnboardingStore()
    const candidates = ['kb.create', 'write.selection', 'write.candidate', 'write.margin', 'write.finalize'] as const
    expect(onboarding.visibleBeaconsFor(candidates)).toEqual([])
    await onboarding.initialize()
    onboarding.skipScene('knowledge')
    onboarding.markSeen('write.selection')

    expect(onboarding.visibleBeaconsFor(candidates)).toEqual(['write.candidate', 'write.margin'])
    expect(onboarding.visibleBeaconsFor(candidates, 1)).toEqual(['write.candidate'])
    onboarding.disableAll()
    expect(onboarding.visibleBeaconsFor(candidates)).toEqual([])
  })

  it('keeps onboarding markers out of project backup serialization', async () => {
    const onboarding = useOnboardingStore()
    await onboarding.initialize()
    onboarding.markSeen('marker-only-local')
    onboarding.recordAchievement('first_book_created')
    const project = createProjectBackup({ novels: [], knowledgeBases: [], chapterRevisions: [], inspirationSessions: [], reconstructionWorkspaces: [] })
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toContain('marker-only-local')
    expect(JSON.stringify(project)).not.toMatch(/marker-only-local|first_book_created|onboarding|checklist|achieved/)
  })
})
