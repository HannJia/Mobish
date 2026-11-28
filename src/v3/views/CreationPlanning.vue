<template>
  <section v-if="novel" class="creation-planning">
    <template v-if="!ready || editing">
      <div class="planning-main">
        <VolumeOutline ref="volumePlannerRef" compact :chapter-plan-confirmed="ready"
          @state-change="plannerState = $event" />
      </div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>

      <!-- 底部常驻状态与操作栏（与原型 renderFooter 1:1） -->
      <footer class="planning-footer">
        <div class="f-status" :data-tone="footerTone" role="status">
          <span class="lamp"></span>
          <span v-if="!plannerState.generating && plannerState.hasVolumes && !plannerState.hasDrafts"
            class="checks" title="分卷、章纲是必须项；篇幅、骨架节点、卷号是提醒项">
            <span v-for="c in plannerState.checks" :key="c.key"
              :class="c.ok ? 'ok' : c.block ? '' : 'warn'"
              :title="c.ok ? c.key : c.text"></span>
          </span>
          <span class="txt" :title="footerText">{{ footerText }}</span>
          <span v-if="plannerState.generating" class="gen-bar" aria-hidden="true"><i></i></span>
        </div>

        <div class="f-actions">
          <template v-if="plannerState.generating">
            <button type="button" class="m-btn" @click="volumePlannerRef?.stopAndKeepGeneratedVolumes()">
              <V3Icon name="stop" size="s" />停止生成并保留已完成的卷
            </button>
          </template>
          <template v-else-if="plannerState.hasDrafts">
            <template v-if="plannerState.viewingDraftVolume">
              <button type="button" class="m-btn ghost" :disabled="busy" @click="volumePlannerRef?.cancelEdit()">取消修改</button>
              <button type="button" class="m-btn pri" :disabled="busy" @click="volumePlannerRef?.saveCurrentEdit()">
                <V3Icon name="check" size="s" />保存本卷
              </button>
            </template>
            <button v-else type="button" class="m-btn zhu" @click="volumePlannerRef?.selectVolume(plannerState.draftVolumeId)">
              回到第 {{ plannerState.draftVolumeIndex + 1 }} 卷
            </button>
          </template>
          <template v-else-if="!plannerState.hasVolumes">
            <router-link class="m-btn zhu-outline" :to="{ path: '/generate/' + novel.id, query: { edit: 'direction' } }">
              <V3Icon name="chevL" size="s" />返回故事骨架
            </router-link>
            <button type="button" class="m-btn" @click="volumePlannerRef?.addManualVolume()">手动新增一卷</button>
            <button type="button" class="m-btn zhu" :disabled="!novel.outline" @click="volumePlannerRef?.generateVolumes()">
              <V3Icon name="spark" size="s" />AI 按大纲规划分卷
            </button>
          </template>
          <template v-else>
            <router-link class="m-btn zhu-outline" :to="{ path: '/generate/' + novel.id, query: { edit: 'direction' } }">
              <V3Icon name="chevL" size="s" />返回故事骨架
            </router-link>
            <button v-if="ready" type="button" class="m-btn" @click="editing = false">返回开始写作</button>
            <button type="button" class="m-btn" :class="{ zhu: !hasBlockingChecks && !ready }"
              :disabled="busy || ready || hasBlockingChecks" @click="confirmPlanning">
              {{ busy ? '保存中…' : ready ? '规划已确认' : '确认分卷与章纲' }}
              <V3Icon v-if="!busy && !ready" name="arrowR" size="s" />
            </button>
          </template>
        </div>
      </footer>
    </template>

    <!-- 结构已就绪页（与原型 readyHTML 1:1，并保留 #66 开书首批入典） -->
    <div v-else class="ready-stage">
      <section class="ready-card fade-in">
        <div class="ready-seal">墨</div>
        <h1>结构已就绪</h1>
        <p class="ready-book">《{{ novel.title }}》<template v-if="officialDirectionText"> · 正式方向 {{ officialDirectionText }}</template></p>

        <div class="ready-stats">
          <div><b>{{ novel.volumes.length }}</b><small>卷</small></div>
          <div><b>{{ totalEstimatedChapters.toLocaleString('zh-CN') }}</b><small>章（预计）</small></div>
          <div><b>{{ totalEstimatedWords }}</b><small>万字</small></div>
          <div><b>{{ plans.length }}</b><small>条章纲</small></div>
          <div v-if="skeletonBeats.length"><b>{{ placedBeatsCount }}/{{ skeletonBeats.length }}</b><small>骨架节点落卷</small></div>
        </div>

        <div v-if="novel.volumes.length" class="ready-ov" aria-label="全书结构概览">
          <div class="ready-ov-head">
            <b>全书结构</b>
            <span>{{ novel.volumes.length }} 卷 · {{ totalEstimatedChapters.toLocaleString('zh-CN') }} 章 · 约 {{ totalEstimatedWords }} 万字</span>
          </div>
          <div class="ready-ov-bar">
            <div v-for="(vol, idx) in novel.volumes" :key="vol.id" class="ready-ov-seg"
              :style="{ flexGrow: Math.max(vol.estimatedWordCount || 0, 0.5) }">
              <span class="seal sm">{{ cnNum(idx + 1) }}</span>
              <b>{{ vol.title || '未命名分卷' }}</b>
            </div>
          </div>
        </div>

        <p class="ready-note">故事方向与规划已保存。开始写作只建立空白章，不会生成正文或决定故事变化。</p>

        <section v-if="openingSeeds.length" class="opening-seed-box" aria-label="开书首批入典">
          <div class="seed-head">
            <strong>开书首批入典（可选）</strong>
            <span>将契约主角、世界规则与卷级伏笔一键转为首批典籍初稿</span>
          </div>
          <ul class="seed-list">
            <li v-for="item in openingSeeds" :key="item.id" :class="{ exists: item.alreadyExists }">
              <label>
                <input type="checkbox" :checked="item.alreadyExists || selectedSeedIds.includes(item.id)"
                  :disabled="item.alreadyExists || seeding" @change="toggleSeed(item.id, ($event.target as HTMLInputElement).checked)">
                <span><b>{{ item.title }}</b><small class="seed-src">{{ item.sourceLabel }}</small><em v-if="item.alreadyExists" class="seed-done">已在典籍</em></span>
              </label>
              <p v-if="item.summary && item.summary.trim() !== item.title.trim()">{{ item.summary }}</p>
            </li>
          </ul>
          <div class="seed-actions">
            <span class="seed-feedback" role="status">{{ seedFeedback }}</span>
            <button v-if="selectableSeedCount" type="button" class="m-btn sm" :disabled="seeding || !selectedSeedIds.length" @click="applyOpeningSeeds">
              {{ seeding ? '正在写入典籍…' : `写入所选入典（${selectedSeedIds.length}）` }}
            </button>
          </div>
        </section>

        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <div class="ready-actions">
          <button type="button" data-guide="create.firstChapter" class="m-btn zhu lg" :disabled="busy" @click="startWriting">
            <V3Icon name="pen" size="s" />{{ busy ? '保存中…' : novel.chapters.length ? '打开写作台' : '开始写第一章' }}
          </button>
          <router-link class="m-btn lg" :to="'/plan/' + novel.id">
            <V3Icon name="layers" size="s" />打开结构页
          </router-link>
        </div>
        <div class="ready-secondary-actions">
          <button type="button" class="m-btn sm zhu-outline edit-again" @click="editing = true">
            <V3Icon name="chevL" size="s" />返回检查分卷与章纲
          </button>
          <router-link class="m-btn sm edit-again direction-link" :to="{ path: '/generate/' + novel.id, query: { edit: 'direction' } }">
            检查契约与骨架
          </router-link>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { applyOpeningCanonSeed, buildOpeningCanonSeedPreview } from '@/services/openingCanonSeed'
import VolumeOutline, { type VolumePlannerSummaryState } from '@/v3/planning/VolumePlanner.vue'
import V3Icon from '../components/V3Icon.vue'
import type { Chapter } from '@/types/novel'

const route = useRoute(), router = useRouter(), novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const novel = computed(() => novels.getNovel(String(route.params.novelId)))
const plans = computed(() => [...(novel.value?.chapterPlans || [])].filter(plan => plan.status !== 'archived').sort((a, b) => a.targetChapterStart - b.targetChapterStart))
const ready = computed(() => Boolean(novel.value?.chapterPlanConfirmed && plans.value.length
  && workspace.getCreationDraft(novel.value.id)?.approval['chapter-outline'] === 'approved'))

const volumePlannerRef = ref<InstanceType<typeof VolumeOutline> | null>(null)
const plannerState = ref<VolumePlannerSummaryState>({
  generating: false,
  streamingCompleted: 0,
  hasVolumes: false,
  hasDrafts: false,
  draftVolumeIndex: -1,
  draftVolumeId: '',
  viewingDraftVolume: false,
  pendingSuggestionsCount: 0,
  checks: [],
})

const busy = ref(false), error = ref(''), editing = ref(false)
const seeding = ref(false), seedFeedback = ref('')
const creationDraft = computed(() => novel.value ? workspace.getCreationDraft(novel.value.id) : undefined)
const openingSeeds = computed(() => novel.value && creationDraft.value ? buildOpeningCanonSeedPreview(novel.value, creationDraft.value) : [])
const selectableSeedCount = computed(() => openingSeeds.value.filter(item => !item.alreadyExists).length)
const selectedSeedIds = ref<string[]>([])

const CN_DIGITS = '零一二三四五六七八九'
function cnNum(n: number): string {
  if (n <= 0) return '零'
  if (n <= 10) return n === 10 ? '十' : CN_DIGITS[n]
  if (n < 20) return '十' + CN_DIGITS[n - 10]
  return CN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGITS[n % 10] : '')
}
const SLOTS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const officialDirectionText = computed(() => {
  const draft = creationDraft.value
  const list = draft?.skeletons || []
  const idx = list.findIndex(item => item.id === draft?.selectedSkeletonId)
  const item = idx >= 0 ? list[idx] : undefined
  return item ? `${SLOTS[idx] || idx + 1} ${item.title}` : ''
})
const skeletonBeats = computed(() => {
  const draft = creationDraft.value
  return draft?.skeletons.find(item => item.id === draft.selectedSkeletonId)?.beats || []
})
const placedBeatsCount = computed(() => {
  const assigned = new Set((novel.value?.volumes || []).flatMap(vol => vol.skeletonBeatIds || []))
  return skeletonBeats.value.filter(b => assigned.has(b.id)).length
})
const totalEstimatedChapters = computed(() => (novel.value?.volumes || []).reduce((sum, v) => sum + Math.max(0, v.estimatedChapters || 0), 0))
const totalEstimatedWords = computed(() => {
  const sum = (novel.value?.volumes || []).reduce((acc, v) => acc + Math.max(0, v.estimatedWordCount || 0), 0)
  return Number((Math.round(sum * 100) / 100).toFixed(2))
})

const blockingChecks = computed(() => plannerState.value.checks.filter(c => !c.ok && c.block))
const warnChecks = computed(() => plannerState.value.checks.filter(c => !c.ok && !c.block))
const hasBlockingChecks = computed(() => blockingChecks.value.length > 0 || !novel.value?.volumes.length || !plans.value.length)

const footerTone = computed(() => {
  if (plannerState.value.generating) return 'busy'
  if (plannerState.value.hasDrafts) return 'warn'
  if (!plannerState.value.hasVolumes) return ''
  if (blockingChecks.value.length) return 'need'
  if (warnChecks.value.length) return 'warn'
  return 'ok'
})
const footerText = computed(() => {
  if (plannerState.value.generating) return `AI 正在规划分卷 · 已完成 ${plannerState.value.streamingCompleted} 卷`
  if (plannerState.value.hasDrafts) return `第 ${plannerState.value.draftVolumeIndex + 1} 卷有未保存的修改（已暂存）`
  if (!plannerState.value.hasVolumes) return '还没有分卷规划'
  if (blockingChecks.value.length) return '还需要：' + blockingChecks.value.map(c => c.text).join('；')
  if (warnChecks.value.length) return `可以确认，还有 ${warnChecks.value.length} 项提醒：` + warnChecks.value.map(c => c.text).join('；')
  return '分卷和章纲都已就绪，可以确认'
})

watch(openingSeeds, items => {
  const valid = new Set(items.filter(item => !item.alreadyExists).map(item => item.id))
  if (!selectedSeedIds.value.length && valid.size) selectedSeedIds.value = [...valid]
  else selectedSeedIds.value = selectedSeedIds.value.filter(id => valid.has(id))
}, { immediate: true })

function toggleSeed(id: string, checked: boolean) {
  selectedSeedIds.value = checked ? [...new Set([...selectedSeedIds.value, id])] : selectedSeedIds.value.filter(item => item !== id)
}
async function applyOpeningSeeds() {
  if (!novel.value || seeding.value || !selectedSeedIds.value.length) return
  seeding.value = true; seedFeedback.value = ''; error.value = ''
  try {
    const result = await applyOpeningCanonSeed(novel.value.id, selectedSeedIds.value)
    seedFeedback.value = result.written.length ? `已写入 ${result.written.length} 项到典籍，开写第 1 章即可参考。` : '所选条目已在典籍中，无需重复写入。'
  } catch (cause) { error.value = errorText(cause, '首批入典写入失败') }
  finally { seeding.value = false }
}

async function confirmPlanning() {
  const n = novel.value
  if (!n || busy.value) return
  if (!n.volumes.length || !plans.value.length) { error.value = '请先保存分卷与至少一条章纲。'; return }
  busy.value = true; error.value = ''
  try {
    await novels.commitChapterPlanEdit(n.id, { action: 'confirm-planning', expectedVolumes: JSON.stringify(n.volumes), expectedPlans: JSON.stringify(n.chapterPlans), confirmCreation: true })
    volumePlannerRef.value?.discardPendingSuggestions()
    editing.value = false
  } catch (cause) { error.value = errorText(cause, String(cause)) }
  finally { busy.value = false }
}

async function startWriting() {
  const n = novel.value, draft = n && workspace.getCreationDraft(n.id)
  if (!n || busy.value || !ready.value || draft?.approval.contract !== 'approved' || draft?.approval.skeleton !== 'approved') return
  busy.value = true; error.value = ''
  try {
    let first: Chapter | undefined = [...n.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)[0]
    if (!first) {
      const plan = plans.value.find(row => row.targetChapterStart === 0)
      const approvedPlan = draft.chapterPlans.find(row => row.id === 'chapter-plan:' + plan?.id)
      const volume = n.volumes.find(row => 'volume:' + row.id === approvedPlan?.volumeId)
        || [...n.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex)[0]
      first = novels.addChapter(n.id, { title: plan?.title || '第一章', volumeIndex: volume?.volumeIndex ?? 0 }) || undefined
    }
    if (!first) throw new Error('章节未能创建，请重试。')
    await novels.saveNovelNow(n.id)
    await router.push('/write/' + n.id + '/' + first.id)
  } catch (cause) { error.value = errorText(cause, String(cause)) }
  finally { busy.value = false }
}
</script>

<style scoped>
.creation-planning { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.planning-main { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.error { margin: 0; color: var(--zhu); font-size: 13px; }

/* 底部常驻状态与操作栏（与原型 1:1） */
.planning-footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 8px 10px 8px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.f-status { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13px; color: var(--ink-2); }
.f-status .lamp { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--ink-4); }
.f-status[data-tone="ok"] { color: var(--qing); }
.f-status[data-tone="ok"] .lamp { background: var(--qing); }
.f-status[data-tone="warn"] { color: var(--jin); }
.f-status[data-tone="warn"] .lamp { background: var(--jin); }
.f-status[data-tone="need"] { color: var(--zhu); }
.f-status[data-tone="need"] .lamp { background: var(--zhu-solid); }
.f-status[data-tone="busy"] .lamp { background: var(--jin); animation: f-pulse 1.2s infinite; }
@keyframes f-pulse { 50% { opacity: .35; } }
.f-status .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.f-status .gen-bar { width: 120px; height: 4px; flex: none; border-radius: 4px; background: var(--line); overflow: hidden; }
.f-status .gen-bar i { display: block; height: 100%; width: 45%; border-radius: 4px; background: var(--jin); animation: f-slide 1.3s ease-in-out infinite; }
@keyframes f-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
.checks { display: flex; gap: 4px; flex: none; }
.checks span { width: 8px; height: 8px; border-radius: 2px; background: var(--zhu-solid); }
.checks span.ok { background: var(--qing); }
.checks span.warn { background: var(--jin); }
.f-actions { display: flex; align-items: center; gap: 8px; flex: none; flex-wrap: wrap; }
.zhu-outline { border-color: var(--zhu); color: var(--zhu); background: var(--paper); font-weight: 600; }
.zhu-outline:hover { background: var(--zhu-soft); }

/* 结构已就绪页 */
.ready-stage { flex: 1; min-height: 0; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 6px 12px 14px; }
.ready-card { width: min(1040px, 100%); min-height: 100%; margin: 0 auto; padding: 28px 36px 26px; text-align: center; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); box-shadow: var(--shadow-2); display: flex; flex-direction: column; align-items: center; gap: 14px; }
.ready-seal { flex: none; display: grid; place-items: center; width: 62px; height: 62px; border: 2px solid var(--zhu); border-radius: 7px; color: var(--zhu); font: 36px/1 var(--f-kai); transform: rotate(-6deg); }
.ready-card h1 { margin: 0; font: 600 26px/1.3 var(--f-serif); letter-spacing: .06em; }
.ready-book { margin: 0; font-size: 14px; color: var(--ink-3); }
.ready-stats { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.ready-stats div { display: grid; padding: 9px 24px; border-right: 1px solid var(--line); }
.ready-stats div:last-child { border-right: 0; }
.ready-stats b { font: 600 21px/1.3 var(--f-serif); color: var(--ink); }
.ready-stats small { color: var(--ink-3); font-size: 12px; }

.ready-ov { width: 100%; text-align: left; display: grid; gap: 7px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.ready-ov-head { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-3); }
.ready-ov-head b { font: 600 13.5px var(--f-serif); color: var(--ink); }
.ready-ov-bar { display: flex; gap: 6px; }
.ready-ov-seg { flex-basis: 0; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--paper); overflow: hidden; }
.ready-ov-seg .seal.sm { width: 24px; height: 24px; flex: none; border: 1px solid var(--line-2); border-radius: 5px; display: grid; place-items: center; background: var(--panel); color: var(--ink-2); font: 600 13px/1 var(--f-kai); }
.ready-ov-seg b { font: 600 13px var(--f-serif); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ready-note { max-width: 580px; margin: 0; font-size: 13px; line-height: 1.75; color: var(--ink-3); }
.ready-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin-top: 2px; }
.ready-secondary-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; }
.opening-seed-box { width: 100%; flex: 1 1 auto; display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); text-align: left; }
.seed-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.seed-head strong { font-size: 14px; color: var(--ink); }
.seed-head span { font-size: 12px; color: var(--ink-3); }
.seed-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 8px 10px; flex: 1 1 auto; min-height: 220px; max-height: clamp(280px, 42vh, 460px); overflow: auto; }
.seed-list li { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); display: grid; align-content: start; gap: 5px; }
.seed-list li.exists { opacity: .68; }
.seed-list label { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 13px; line-height: 1.45; }
.seed-list label input { margin-top: 3px; flex: none; accent-color: var(--zhu); }
.seed-list label span { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.seed-src { color: var(--ink-3); font-size: 12px; }
.seed-done { font-style: normal; padding: 1px 6px; border-radius: 4px; background: var(--qing-soft); color: var(--qing); font-size: 12px; }
.seed-list p { margin: 0 0 0 22px; font-size: 13px; color: var(--ink-2); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.seed-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding-top: 2px; }
.seed-feedback { font-size: 12.5px; color: var(--qing); }
.edit-again { text-decoration: none; }
.direction-link { display: inline-flex; align-items: center; }

@media (max-width: 760px) {
  .creation-planning { overflow: visible; }
  .planning-footer { flex-direction: column; align-items: stretch; }
  .ready-card { padding: 20px 14px; }
  .seed-list { grid-template-columns: minmax(0, 1fr); }
}
</style>
