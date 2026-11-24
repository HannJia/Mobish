<template>
  <details v-if="pairs.length" class="paper-panel chapter-continuity">
    <summary>章与章衔接审校</summary>
    <div class="pair-tools">
      <label>相邻章节
        <select v-model="selected" class="m-input" :disabled="busy">
          <option v-for="{ before, after } in pairs" :key="after.id" :value="after.id">
            {{ chapterLabel(before) }} → {{ chapterLabel(after) }}
          </option>
        </select>
      </label>
      <button type="button" class="m-btn sm" :disabled="!model || busy || !pair" @click="run">{{ busy ? '核对中…' : '检查章尾和章首' }}</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="reviewedVersion === pairVersion && !findings.length" role="status">本次读取的章尾和章首未发现可证实的衔接矛盾。</p>
    <article v-for="finding in findings" :key="finding.id" class="continuity-finding">
      <h3>{{ finding.title }}</h3>
      <p>{{ finding.explanation }}</p>
      <div class="source-pair">
        <div v-for="(source, index) in finding.evidence" :key="source.id">
          <b>{{ index === 0 ? '前章结尾' : '后章开头' }}</b>
          <blockquote>{{ source.quote }}</blockquote>
          <RouterLink :to="{ name: 'V3Write', params: { novelId: novel.id, chapterId: source.sourceId } }">打开正文</RouterLink>
        </div>
      </div>
      <p v-if="finding.suggestedFix">{{ finding.suggestedFix }}</p>
      <p v-if="finding.status === 'intentional'">有意留白{{ finding.authorNote ? ' · ' + finding.authorNote : '' }}</p>
      <div v-else class="pair-tools">
        <input class="m-input" v-model="notes[finding.id]" aria-label="留白原因" placeholder="留白原因（可选）" />
        <button type="button" class="m-btn sm" :disabled="deciding" @click="intentional(finding)">标记有意留白</button>
      </div>
    </article>
  </details>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Chapter, Novel } from '@/types/novel'
import type { ReviewFinding } from '@/types/reconstruction'
import type { ModelConfig } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { adjacentChapterPairs, adjacentSourcesCurrent, isAdjacentFinding, reviewAdjacentChapters } from '@/services/chapterContinuity'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'

const props = defineProps<{ novel: Novel; model: ModelConfig | null }>()
const workspace = useReconstructionWorkspaceStore()
const pairs = computed(() => adjacentChapterPairs(props.novel))
const selected = ref('')
watch(pairs, rows => {
  if (!rows.some(row => row.after.id === selected.value)) selected.value = rows[0]?.after.id || ''
}, { immediate: true })
const pair = computed(() => pairs.value.find(row => row.after.id === selected.value))
const pairVersion = computed(() => pair.value && version(pair.value.before, pair.value.after))
const findings = computed(() => workspace.getReviewFindings(props.novel.id).filter(finding => finding.chapterId === selected.value
  && isAdjacentFinding(finding) && finding.status !== 'stale' && adjacentSourcesCurrent(props.novel, finding)))
const notes = ref<Record<string, string>>({})
const reviewedVersion = ref('')
const error = ref('')
const busy = ref(false)
const deciding = ref(false)
let request: AbortController | undefined
onBeforeUnmount(() => request?.abort())

function chapterLabel(chapter: Chapter) {
  return `第 ${chapter.chapterIndex + 1} 章 ${chapter.title}`
}

function version(before: Chapter, after: Chapter) {
  return JSON.stringify([before.id, after.id, buildAnalysisSourceVersionId(before.content), buildAnalysisSourceVersionId(after.content)])
}

async function run() {
  const opened = pair.value
  const model = props.model
  if (busy.value || !opened || !model) return
  const novelId = props.novel.id
  const before = { ...opened.before }, after = { ...opened.after }
  const source = version(before, after)
  const controller = new AbortController()
  request = controller
  busy.value = true
  error.value = ''
  try {
    const result = await reviewAdjacentChapters(before, after, model, controller.signal)
    controller.signal.throwIfAborted()
    await workspace.transactStory(novelId, aggregate => {
      controller.signal.throwIfAborted()
      const current = adjacentChapterPairs(aggregate.novel).find(item => item.after.id === after.id)
      if (!current || version(current.before, current.after) !== source) throw new Error('两章正文或顺序已变化，请重新检查')
      const saved = aggregate.workspace.reviewFindings
      const ids = new Set(saved.map(finding => finding.id))
      saved.push(...result.filter(finding => !ids.has(finding.id)))
    })
    reviewedVersion.value = source
  } catch (cause) {
    if (!controller.signal.aborted) error.value = safeAiErrorMessage(cause, [model.apiKey])
  } finally {
    request = undefined
    busy.value = false
  }
}

async function intentional(finding: ReviewFinding) {
  if (deciding.value) return
  deciding.value = true
  error.value = ''
  try {
    const note = notes.value[finding.id]?.trim()
    await workspace.transactStory(props.novel.id, aggregate => {
      const saved = aggregate.workspace.reviewFindings.find(item => item.id === finding.id)
      if (!saved || saved.status !== finding.status || !adjacentSourcesCurrent(aggregate.novel, saved)) throw new Error('原文或处理状态已变化，请重新核对')
      saved.status = 'intentional'
      saved.authorNote = note || undefined
    })
  } catch (cause) {
    error.value = safeAiErrorMessage(cause)
  } finally {
    deciding.value = false
  }
}
</script>

<style scoped>
.chapter-continuity { padding: 12px 16px; margin-block: 18px; }
summary { cursor: pointer; font-weight: 650; }
.pair-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-top: 12px; }
.pair-tools label { display: grid; gap: 4px; min-width: 0; }
select { max-width: min(440px, 100%); }
.continuity-finding { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 10px; }
h3, p { margin-block: 6px; }
.source-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.source-pair > div { background: var(--desk); padding: 10px; }
blockquote { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
