<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link>
    <span class="crumb-sep">/</span>
    <span class="crumb-book">{{ novel?.title || '新建作品' }}</span>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">创作流程</span>
  </Teleport>

  <div class="creation-flow">
    <header class="flow-head">
      <div>
        <div class="flow-kicker">创作 · {{ novel?.genreLabel || '新作品' }}</div>
        <h1>作品创作流程</h1>
        <p v-if="novel">《{{ novel.title }}》的设定、骨架与大纲会在这里逐步确认。</p>
      </div>
    </header>

    <ol class="flow-steps" aria-label="作品创建进度">
      <li v-for="(step, index) in steps" :key="step" :class="{ done: index < activeStep, active: index === activeStep }"
        :data-step="index" :aria-current="index === activeStep ? 'step' : undefined">
        <button v-if="canRevisit(index)" type="button" class="flow-step-hit" :title="`回到${step}`" @click="revisit(index)">
          <span class="flow-step-number">✓</span>
          <span class="flow-step-label">{{ step }}</span>
        </button>
        <template v-else>
          <span class="flow-step-number">{{ index < activeStep ? '✓' : index + 1 }}</span>
          <span class="flow-step-label">{{ step }}</span>
        </template>
      </li>
    </ol>

    <div v-if="novel && hydrated" class="flow-content">
      <CreationPlanning v-if="planningAccepted" />
      <GenerateOutline v-else ref="directionEditor" @step="activeSurfaceStep = $event" />
    </div>
    <section v-else-if="!novel || loadError" class="flow-missing m-panel" role="alert">
      <p v-if="loadError">{{ loadError }}</p>
      <p v-else>找不到这部作品，可能已移入回收站。</p>
      <router-link class="m-btn zhu" to="/">返回书架</router-link>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import GenerateOutline from '@/v3/create/DirectionEditor.vue'
import CreationPlanning from './CreationPlanning.vue'
import { resolveCreationSurface } from '@/services/planningRecovery'

defineOptions({ name: 'V3CreateFlowView' })

const steps = ['起点', '作品契约', '故事骨架', '分卷大纲', '开始写作']
const route = useRoute(), router = useRouter()
const novels = useNovelStore()
const workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novels.getNovel(novelId.value))
const creationDraft = computed(() => workspace.getCreationDraft(novelId.value))
const activeSurfaceStep = ref<number>()
const hydrated = ref(false)
const loadError = ref('')
const surface = computed(() => resolveCreationSurface(creationDraft.value))
const planningReady = computed(() => Boolean(creationDraft.value?.acceptedOutline
  && creationDraft.value.approval.contract === 'approved' && creationDraft.value.approval.skeleton === 'approved'))
const planningAccepted = computed(() => route.query?.edit !== 'direction' && planningReady.value
  && (surface.value === 'volumes' || surface.value === 'ready'))
const activeStep = computed(() => {
  if (!planningAccepted.value && activeSurfaceStep.value !== undefined) return activeSurfaceStep.value
  if (planningAccepted.value && novel.value?.chapterPlanConfirmed && creationDraft.value?.approval['chapter-outline'] === 'approved') return 4
  switch (creationDraft.value?.stage) {
    case 'contract': return 1
    case 'skeleton': return 2
    case 'volume-outline':
    case 'chapter-outline':
    case 'scene-outline': return 3
    case 'ready': return 4
    default: return 0
  }
})
watch(novelId, async (id, _previous, onCleanup) => {
  let stale = false
  onCleanup(() => { stale = true })
  hydrated.value = false; loadError.value = ''; activeSurfaceStep.value = undefined
  if (!id) return
  try {
    await workspace.hydrateFromPersistence(id)
    if (!stale) hydrated.value = true
  } catch {
    if (!stale) loadError.value = '创作草稿读取失败，请返回书架后重试。'
  }
}, { immediate: true })

// 已完成的步骤可以点回去：契约、骨架回到方向编辑；分卷大纲回到规划。“起点”已经落成作品，不可回退。
const directionEditor = ref<InstanceType<typeof GenerateOutline> | null>(null)
function canRevisit(index: number) {
  if (!novel.value || index === 0 || index === activeStep.value) return false
  if (index === 3) return planningReady.value && !planningAccepted.value
  return index < activeStep.value || planningReady.value
}
async function revisit(index: number) {
  if (index <= 2) {
    if (planningAccepted.value) await router.replace({ query: { ...route.query, edit: 'direction' } })
    await nextTick()
    if (index === 1) directionEditor.value?.reopenContract()
    if (index === 2) directionEditor.value?.reopenSkeleton()
    document.querySelector('.creation-flow')?.scrollTo?.({ top: 0, behavior: 'smooth' })
  } else {
    await workspace.saveCreationSurface(novelId.value, 'volumes')
    if (!route.query.edit) return
    await router.replace({ query: Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'edit')) })
  }
}
</script>

<style scoped>

.creation-flow { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; padding: 14px clamp(16px, 2.2vw, 36px) 14px; background: var(--desk); color: var(--ink); }
.flow-head { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.flow-kicker { color: var(--zhu); font-size: 11px; }
.flow-head h1 { margin: 4px 0; font: 600 25px/1.4 var(--f-serif); }
.flow-head p { margin: 0; color: var(--ink-3); font-size: 13px; }
.flow-steps { flex: none; width: 100%; max-width: 1460px; margin: 0 auto 12px; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); list-style: none; }
.flow-steps li { position: relative; isolation: isolate; display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--ink-4); font-size: 12px; }
.flow-steps li::after { content: ''; position: absolute; z-index: 0; top: 12px; left: 34px; right: 10px; height: 1px; background: var(--line); pointer-events: none; }
.flow-steps li:last-child::after { display: none; }
.flow-steps li.done, .flow-steps li.active { color: var(--ink-2); }
.flow-steps li.active { color: var(--zhu); font-weight: 600; }
.flow-step-number { position: relative; z-index: 2; width: 24px; height: 24px; border: 1px solid var(--line-2); border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--paper); font: 11px var(--f-num); }
.flow-step-label { position: relative; z-index: 2; padding: 0 8px; background-color: var(--desk); box-shadow: 0 0 0 2px var(--desk); white-space: nowrap; }
.flow-steps li.done .flow-step-number { border-color: var(--qing); background: var(--qing-soft); color: var(--qing); }
.flow-steps li.active .flow-step-number { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.flow-step-hit { position: relative; z-index: 2; display: flex; align-items: center; gap: 9px; min-width: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.flow-step-hit:hover .flow-step-label { color: var(--zhu); text-decoration: underline; }
@media (max-width: 580px) { .flow-step-hit { flex-direction: column; align-items: flex-start; gap: 5px; } }
.flow-content { flex: 1; min-height: 0; width: 100%; max-width: 1460px; margin: 0 auto; display: flex; flex-direction: column; }
.flow-missing { max-width: 620px; margin: 56px auto; padding: 24px; text-align: center; }
.crumb-book { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }.crumb-current { color: var(--ink); font-weight: 600; }
@media (max-width: 900px) {
  .creation-flow { padding: 12px 16px 14px; }
}
@media (max-width: 760px) {
  .creation-flow { overflow: auto; padding: 12px 12px 24px; }
  .flow-content { min-height: auto; }
}
@media (max-width: 580px) {
  .creation-flow { padding: 16px 14px 32px; }
  .flow-head { align-items: flex-start; }
  .flow-head h1 { font-size: 21px; }
  .flow-steps { grid-template-columns: repeat(5, minmax(64px, 1fr)); overflow-x: auto; gap: 8px; }
  .flow-steps li { flex-direction: column; align-items: flex-start; gap: 5px; font-size: 10px; }
  .flow-steps li::after { top: 12px; left: 31px; right: 4px; }
  .flow-step-number { width: 22px; height: 22px; }
}

</style>
