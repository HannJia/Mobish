import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useConfigStore } from './config'
import { useNovelStore } from './novel'
import { useKnowledgeStore } from './knowledge'
import { useInspirationSessionsStore } from './inspirationSessions'
import { loadBreakdownJobs } from '@/services/bookBreakdownDb'
import { modelConnectionFingerprint } from '@/services/modelConnectionTest'
import {
  classifyOnboardingAudience, defaultOnboardingState, deriveOnboardingChecklist, isModelReadyForOnboarding, parseOnboardingState,
  selectVisibleBeacons, FIRST_USE_AT_KEY, GUIDE_BEACONS, GUIDE_SCENES, LAST_BACKUP_KEY, LEGACY_GUIDE_SEEN_KEY, ONBOARDING_STORAGE_KEY,
  type GuideBeaconId, type GuideSceneId, type OnboardingAudienceEvidence, type OnboardingChecklistMode, type OnboardingMilestone, type OnboardingPath,
} from '@/services/onboardingGuide'

interface InitializeOptions {
  configLoadFailed?: boolean
  hadPreExistingSnapshot?: boolean | null
  checkBreakdownJobs?: () => Promise<number>
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const config = useConfigStore()
  const novels = useNovelStore()
  const knowledge = useKnowledgeStore()
  const inspiration = useInspirationSessionsStore()
  const state = ref(defaultOnboardingState())
  const initialized = ref(false)
  const activeTour = ref<{ scene: GuideSceneId; stepIndex: number } | null>(null)
  const readyModelIds = ref(new Set<string>())
  const hasBackupTimestamp = ref(false)
  let initializing: Promise<void> | undefined
  let readinessVersion = 0

  const currentSceneSteps = computed(() => activeTour.value ? GUIDE_SCENES[activeTour.value.scene] : [])
  const currentStep = computed(() => currentSceneSteps.value[activeTour.value?.stepIndex ?? 0] ?? null)
  const checklistSummary = computed(() => deriveOnboardingChecklist({
    state: state.value, novels: novels.novels, models: config.models, readyModelIds: readyModelIds.value,
    hasBackupTimestamp: hasBackupTimestamp.value, isChapterPersisted: novel => novels.isNovelPersisted(novel.id),
  }))
  const showChecklist = computed(() => initialized.value && state.value.enabled && state.value.checklist !== 'dismissed')

  function persist() {
    if (!initialized.value) return
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state.value)) }
    catch { /* Use the in-memory guide when local storage is unavailable. */ }
  }

  async function restoreOrClassify(options: InitializeOptions) {
    const evidence: OnboardingAudienceEvidence = {
      configLoadFailed: options.configLoadFailed, hadPreExistingSnapshot: options.hadPreExistingSnapshot,
    }
    function read(key: string) {
      try { return localStorage.getItem(key) }
      catch { evidence.storageUnavailable = true; return null }
    }

    const restored = parseOnboardingState(read(ONBOARDING_STORAGE_KEY))
    hasBackupTimestamp.value = read(LAST_BACKUP_KEY) !== null
    if (restored) {
      state.value = restored
      initialized.value = true
      await refreshModelReadiness()
      return
    }

    evidence.hasLegacyGuideSeen = read(LEGACY_GUIDE_SEEN_KEY) !== null
    evidence.hasPreExistingFirstUseAt = read(FIRST_USE_AT_KEY) !== null
    evidence.hasBackupTimestamp = hasBackupTimestamp.value
    evidence.novelCount = novels.novels.length
    evidence.modelCount = config.models.length
    evidence.knowledgeBaseCount = knowledge.knowledgeBases.length
    evidence.inspirationSessionCount = inspiration.sessions.length
    if (classifyOnboardingAudience(evidence) !== 'existing') {
      try {
        evidence.breakdownJobCount = options.checkBreakdownJobs ? await options.checkBreakdownJobs() : (await loadBreakdownJobs()).length
      } catch { evidence.breakdownCheckFailed = true }
    }
    state.value = defaultOnboardingState(classifyOnboardingAudience(evidence))
    initialized.value = true
    persist()
    await refreshModelReadiness()
  }

  async function initialize(options: InitializeOptions = {}) {
    if (initializing) return initializing
    if (initialized.value) return
    initializing = restoreOrClassify(options).finally(() => { initializing = undefined })
    await initializing
  }

  async function refreshModelReadiness() {
    const version = ++readinessVersion
    const environment = typeof window !== 'undefined' && window.electronAPI ? 'desktop' : 'browser'
    readyModelIds.value = new Set()
    const ready = await Promise.all(config.models.map(async model => {
      const test = model.connectionTest
      if (model.kind === 'embedding' || test?.status !== 'ok') return null
      // The connection-test store already persists desktop results as 'electron'.
      const connectionTest = { ...test, environment: test.environment === 'electron' ? 'desktop' as const : test.environment }
      if (connectionTest.environment !== environment) return null
      try {
        const fingerprint = await modelConnectionFingerprint(model)
        return isModelReadyForOnboarding({ kind: model.kind, connectionTest }, environment, fingerprint) ? model.id : null
      } catch { return null }
    }))
    if (version === readinessVersion) readyModelIds.value = new Set(ready.filter(id => id !== null))
  }

  watch(() => config.models, () => {
    if (initialized.value) void refreshModelReadiness()
  }, { deep: true })

  function setPath(path: OnboardingPath) {
    state.value.path = path
    persist()
  }

  function setChecklist(mode: OnboardingChecklistMode) {
    state.value.checklist = mode
    persist()
  }

  function closeTour() { activeTour.value = null }

  function disableAll() {
    state.value.enabled = false
    closeTour()
    setChecklist('dismissed')
  }

  function startTour(scene: GuideSceneId, stepId?: string) {
    if (!state.value.enabled || (stepId === undefined && state.value.skipped.includes(scene))) return
    const stepIndex = stepId === undefined ? 0 : GUIDE_SCENES[scene].findIndex(step => step.id === stepId)
    if (stepIndex >= 0) activeTour.value = { scene, stepIndex }
  }

  function nextStep() {
    const tour = activeTour.value, step = currentStep.value
    if (!tour || !step) return
    markSeen(step.id)
    if (tour.stepIndex + 1 < currentSceneSteps.value.length) tour.stepIndex++
    else closeTour()
  }

  function prevStep() {
    if (activeTour.value && activeTour.value.stepIndex > 0) activeTour.value.stepIndex--
  }

  function skipScene(scene = activeTour.value?.scene) {
    if (!scene) return
    if (activeTour.value?.scene === scene) closeTour()
    if (state.value.skipped.includes(scene)) return
    state.value.skipped.push(scene)
    persist()
  }

  function isSeen(id: string) { return state.value.seen.includes(id) }

  function markSeen(id: string) {
    if (isSeen(id)) return
    state.value.seen.push(id)
    persist()
  }

  function shouldShowBeacon(id: string) {
    if (!initialized.value || !state.value.enabled || !Object.prototype.hasOwnProperty.call(GUIDE_BEACONS, id) || isSeen(id)) return false
    const scene = GUIDE_BEACONS[id as GuideBeaconId]?.scene
    return scene !== undefined && !state.value.skipped.includes(scene)
  }

  function visibleBeaconsFor(candidateIds: readonly GuideBeaconId[], limit = 2): GuideBeaconId[] {
    return selectVisibleBeacons(candidateIds, shouldShowBeacon, limit)
  }

  function recordAchievement(milestone: OnboardingMilestone) {
    if (state.value.achieved.includes(milestone)) return
    state.value.achieved.push(milestone)
    persist()
  }

  async function handleProjectImported() {
    if (!initialized.value) return
    if (state.value.audience === 'new' && state.value.path === 'undecided'
      && !state.value.achieved.includes('first_book_created')) {
      state.value.audience = 'existing'
      disableAll()
    }
    await refreshModelReadiness()
  }

  function replay() {
    state.value.enabled = true
    state.value.skipped = []
    closeTour()
    setChecklist('expanded')
  }

  function resetMarkers() {
    state.value.seen = []
    state.value.skipped = []
    persist()
  }

  return { state, initialized, activeTour, readyModelIds, currentStep, currentSceneSteps, checklistSummary, showChecklist,
    initialize, refreshModelReadiness, setPath, setChecklist, disableAll, startTour, nextStep, prevStep, skipScene, closeTour,
    markSeen, isSeen, shouldShowBeacon, visibleBeaconsFor, recordAchievement, handleProjectImported, replay, resetMarkers }
})
