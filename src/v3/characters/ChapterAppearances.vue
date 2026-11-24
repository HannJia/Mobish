<template>
  <section class="appearances" aria-label="人物出场对照">
    <div class="appearance-header">
      <p>第 {{ chapter.chapterIndex + 1 }} 章 · {{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }}</p>
      <button type="button" class="m-btn sm" :disabled="running || !characters.length || !canAnalyze" @click="analyze">
        {{ running ? '正在核对…' : result ? '重新核对本章' : 'AI 核对本章' }}
      </button>
    </div>
    <p v-if="error" class="appearance-error" role="alert">{{ error }}</p>
    <p v-if="!characters.length" class="m-muted">请先添加人物资料。</p>
    <p v-else-if="result" class="m-muted m-tiny">分类由 AI 根据所列引句判断。可查看正文和本章知情记录。</p>
    <p v-else-if="canAnalyze" class="m-muted m-tiny">核对本章后可查看亲自到场、被提及及对应原句。</p>
    <div class="appearance-table-wrap">
      <table class="appearance-table">
        <thead><tr><th scope="col">人物</th><th scope="col">计划出场</th><th scope="col">正文出场</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <th scope="row">
              {{ row.name }}
              <button v-if="knowledgeIds.has(row.id)" type="button" class="m-link" @click="emit('knowledge', row.id)">本章知情记录</button>
            </th>
            <td>
              <div v-for="item in row.planned" :key="item.evidence.id" class="appearance-evidence">
                <span class="m-tag" :class="item.kind === 'direct' ? 'qing' : 'jin'">{{ appearanceLabels[item.kind] }}</span>
                <span>{{ item.evidence.label }}</span>
                <blockquote v-if="item.evidence.quote">{{ item.evidence.quote }}</blockquote>
              </div>
              <span v-if="!row.planned.length" class="m-muted">{{ plans.length ? result ? '未识别到安排' : '待核对' : '无本章计划' }}</span>
            </td>
            <td>
              <div v-for="item in row.actual" :key="item.evidence.id" class="appearance-evidence">
                <span class="m-tag" :class="item.kind === 'direct' ? 'qing' : 'jin'">{{ appearanceLabels[item.kind] }}</span>
                <blockquote>{{ item.evidence.quote }}</blockquote>
                <router-link v-if="evidenceLocation(item.evidence)" class="m-link" :to="evidenceLocation(item.evidence)!">查看正文原句</router-link>
              </div>
              <span v-if="!row.actual.length" class="m-muted">{{ hasBody ? result ? '未识别到出场' : '待核对' : '本章暂无正文' }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length"><th scope="row">—</th><td class="m-muted">{{ plans.length ? result ? '未识别到安排' : '待核对章纲与场景' : '无本章计划' }}</td>
            <td class="m-muted">{{ hasBody ? result ? '未识别到出场' : '待核对正文' : '本章暂无正文' }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script lang="ts">
import type { ChapterAppearances } from '@/services/characterAppearances'

// Keep recently checked chapters available when the writer follows a quote back into the manuscript.
const chapterResults = new Map<string, ChapterAppearances>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { Chapter, Character } from '@/types/novel'
import type { EvidenceRef } from '@/types/reconstruction'
import { useConfigStore } from '@/stores/config'
import { analyzeChapterAppearances, getPlannedViewpoints, type AppearancePlanSource, type CharacterAppearance } from '@/services/characterAppearances'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { errorText } from '@/services/userFacingError'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'

const props = defineProps<{
  novelId: string
  chapter: Chapter
  characters: Character[]
  plans: AppearancePlanSource[]
  knowledgeIds: Set<string>
  evidenceLocation: (evidence: EvidenceRef) => RouteLocationRaw | undefined
}>()
const emit = defineEmits<{ knowledge: [characterId: string] }>()
const config = useConfigStore()
const appearanceLabels = { direct: '亲自到场', mentioned: '被提及' }
const running = ref(false), error = ref('')
const result = shallowRef<ChapterAppearances>()
const characterNames = computed(() => props.characters.map(({ id, name, aliases }) => ({ id, name, aliases: [...aliases || []] })))
const sourceKey = computed(() => JSON.stringify([props.novelId, props.chapter.id, props.chapter.chapterIndex,
  buildAnalysisSourceVersionId(props.chapter.content), characterNames.value, buildAnalysisSourceVersionId(JSON.stringify(props.plans))]))
const hasBody = computed(() => !!props.chapter.content.trim())
const canAnalyze = computed(() => hasBody.value || props.plans.some(plan => plan.text.trim()))
const rows = computed(() => {
  const byCharacter = new Map<string, { planned: CharacterAppearance[]; actual: CharacterAppearance[] }>()
  const planned = result.value?.planned ?? getPlannedViewpoints(props.plans, characterNames.value)
  const actual = result.value?.actual ?? []
  for (const [column, appearances] of [['planned', planned], ['actual', actual]] as const) {
    for (const appearance of appearances) {
      const row = byCharacter.get(appearance.characterId) ?? { planned: [], actual: [] }
      row[column].push(appearance)
      byCharacter.set(appearance.characterId, row)
    }
  }
  return characterNames.value.flatMap(({ id, name }) => {
    const evidence = byCharacter.get(id)
    return evidence ? [{ id, name, ...evidence }] : []
  })
})

let controller: AbortController | undefined
function stop() {
  controller?.abort()
  controller = undefined
  running.value = false
}
watch(sourceKey, key => {
  stop()
  error.value = ''
  result.value = chapterResults.get(key)
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(stop)

async function analyze() {
  if (running.value) return
  const model = config.getModelForTask('review') || config.getModelForTask('writing')
  if (!model) { error.value = '请在设置页配置审校或写作模型。'; return }
  const request = new AbortController(), key = sourceKey.value
  controller = request
  running.value = true
  error.value = ''
  try {
    const checked = await analyzeChapterAppearances(model, props.chapter, props.plans, characterNames.value, request.signal)
    if (request !== controller || key !== sourceKey.value) return
    chapterResults.delete(key)
    chapterResults.set(key, checked)
    const oldest = chapterResults.keys().next().value
    if (chapterResults.size > 24 && oldest !== undefined) chapterResults.delete(oldest)
    result.value = checked
  } catch (cause) {
    if (request === controller) error.value = errorText(cause, '未完成出场核对，请重试。')
  } finally {
    if (request === controller) stop()
  }
}
</script>

<style scoped>
.appearance-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.appearance-header p { font: 600 15px var(--f-serif); }
.appearance-table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.appearance-table { width: 100%; min-width: 460px; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
.appearance-table th, .appearance-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.appearance-table th { background: var(--panel); }
.appearance-table th:first-child { width: 112px; }
.appearance-table tr:last-child td, .appearance-table tbody tr:last-child th { border-bottom: 0; }
.appearance-table th .m-link { display: block; margin-top: 5px; }
.appearance-evidence + .appearance-evidence { margin-top: 10px; }
.appearance-evidence .m-tag { margin-right: 6px; }
.appearance-evidence blockquote { margin: 6px 0 4px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink-2); line-height: 1.7; }
.appearance-error { color: var(--zhu); }
</style>
