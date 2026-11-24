<template>
  <Teleport defer to="#v3-crumb"><RouterLink class="crumb-link" to="/">书架</RouterLink><span class="crumb-sep">/</span><span class="crumb-b">拆书</span></Teleport>
  <div class="breakdown-page">
    <div class="breakdown-workbench">
      <aside class="breakdown-history">
        <header><h1>拆书</h1><RouterLink class="m-btn pri" to="/breakdown">新建</RouterLink></header>
        <h2>拆书记录</h2>
        <p v-if="!store.jobs.length" class="m-muted">导入参考书，选一段或几章开始。</p>
        <RouterLink v-for="item in store.jobs" :key="item.id" :to="'/breakdown/' + item.id" class="history-item" :class="{ selected: item.id === job?.id }">
          <strong>{{ item.title }}</strong><span>{{ item.topic }} · {{ statusText(item) }}</span>
        </RouterLink>
      </aside>

      <main class="breakdown-main">
        <p v-if="error || store.runnerError" class="breakdown-error" role="alert">{{ error || store.runnerError }}</p>
        <p v-if="loading">正在打开记录…</p>
        <p v-else-if="route.params.jobId && !job">找不到这条拆书记录。</p>
        <template v-else-if="!job">
          <header class="page-title"><h2>新建拆书</h2><p>选原文、定范围，拆出可以回到原句的写法。</p></header>
          <section class="breakdown-panel">
            <h3>原文</h3>
            <div class="actions">
              <button v-for="option in originOptions" :key="option.id" type="button" class="m-btn" :class="{ pri: originKind === option.id }" @click="chooseOrigin(option.id)">{{ option.label }}</button>
            </div>
            <label v-if="originKind === 'file'" class="field">导入 TXT、Markdown、HTML、DOCX、EPUB 或 PDF
              <input type="file" accept=".txt,.md,.markdown,.html,.htm,.docx,.epub,.pdf" :disabled="importing" @change="importSource">
            </label>
            <label v-else-if="originKind === 'knowledge'" class="field">知识条目
              <select class="m-in" v-model="libraryChoice" @change="selectLibrary"><option value="">请选择</option>
                <optgroup v-for="base in visibleBases" :key="base.id" :label="base.name">
                  <option v-for="entry in base.entries" :key="entry.id" :value="JSON.stringify([base.id, entry.id])">{{ entry.title }}</option>
                </optgroup>
              </select>
            </label>
            <label v-else class="field">我的作品
              <select class="m-in" v-model="manuscriptChoice" @change="selectManuscript"><option value="">请选择</option>
                <option v-for="novel in availableNovels" :key="novel.id" :value="novel.id">{{ novel.title }}</option>
              </select>
            </label>
            <p v-if="importing" role="status">正在读取文件…</p>
            <p v-if="source" class="m-muted">《{{ source.title }}》 · {{ source.sections.length }} 处目录</p>
          </section>
          <section v-if="source" class="breakdown-panel">
            <h3>分析范围</h3>
            <label class="field">按范围读取
              <select class="m-in" v-model="scope">
                <option value="opening">开篇三章</option><option value="paragraph">选段</option><option value="selected">选章</option>
                <option value="volume" :disabled="!volumes.length">按卷</option><option value="book">全书</option>
              </select>
            </label>
            <label v-if="scope === 'volume'" class="field">分卷<select class="m-in" v-model="volume"><option v-for="name in volumes" :key="name">{{ name }}</option></select></label>
            <label v-if="scope === 'paragraph'" class="field">所在章节
              <select class="m-in" v-model="paragraphSection" @change="paragraphIndex = 0"><option v-for="section in source.sections" :key="section.key" :value="section.key">{{ section.title }}</option></select>
            </label>
            <label v-if="scope === 'paragraph'" class="field">原文段落
              <select class="m-in" v-model="paragraphIndex"><option v-for="(block, index) in currentBlocks" :key="block.start" :value="index">段落 {{ block.paragraph }} · {{ source.text.slice(block.start, block.end).slice(0, 45) }}</option></select>
            </label>
            <details :open="scope === 'selected'" class="directory">
              <summary>查看目录和选中范围（{{ selectedKeys.length }} / {{ source.sections.length }}）</summary>
              <label v-for="section in source.sections" :key="section.key">
                <input v-if="scope === 'selected'" type="checkbox" v-model="selection" :value="section.key">
                <span v-else>{{ selectedKeySet.has(section.key) ? '✓' : '·' }}</span>
                {{ section.volume ? section.volume + ' / ' : '' }}{{ section.title }}
              </label>
            </details>
            <label class="field">想学什么<select class="m-in" v-model="topic"><option v-for="name in BREAKDOWN_TOPICS" :key="name">{{ name }}</option></select></label>
            <label v-if="topic === '自定义问题'" class="field">你的问题<input v-model.trim="question" class="m-in" maxlength="300"></label>
            <p v-if="estimate" class="m-muted">{{ estimate.characters.toLocaleString() }} 字符 · 预计 {{ estimate.calls }} 次调用 · 预留约 {{ estimate.tokens.toLocaleString() }} tokens</p>
            <div class="budget">
              <label class="field">调用上限<input v-model.number="calls" class="m-in" type="number" min="1" step="1"></label>
              <label class="field">Token 上限<input v-model.number="tokens" class="m-in" type="number" min="1" step="1"></label>
              <button type="button" class="m-btn pri" :disabled="!canCreate" @click="start">开始分析</button>
            </div>
            <p v-if="!store.model" class="m-muted">请先在设置配置大纲或默认对话模型。</p>
          </section>
        </template>
        <template v-else>
          <header class="page-title"><h2>{{ job.title }}</h2><p>{{ job.topic }} · {{ job.model.label }}</p></header>
          <section class="breakdown-panel">
            <div class="actions"><strong>{{ statusText(job) }}</strong><span>{{ completedSections.size }} / {{ job.selected.length }} 处目录 · {{ finishedParts }} / {{ job.units.length }} 个单元</span></div>
            <progress :value="finishedParts" :max="job.units.length" aria-label="拆书进度"></progress>
            <p class="m-muted">已调用 {{ job.attempts }} / {{ job.calls }} 次 · 已占用 {{ job.usage.charged.toLocaleString() }} / {{ job.tokens.toLocaleString() }} tokens（输入 {{ job.usage.input }}，输出 {{ job.usage.output }}{{ job.usage.estimated ? '，含预留' : '' }}）</p>
            <p v-if="job.error" class="breakdown-error">{{ job.error }}</p>
            <p v-if="sourceChanged" class="breakdown-error">原文已有新版本，当前引用对应保存时的原文。</p>
            <details v-if="source" class="directory">
              <summary>实际覆盖与逐章用量</summary>
              <div v-for="section in coveredSections" :key="section.key" class="coverage-row">
                <span>{{ section.title }}</span><span>{{ section.completed }} / {{ section.parts }} · {{ section.tokens }} tokens</span>
              </div>
            </details>
            <div v-if="running" class="actions"><button type="button" class="m-btn" @click="store.pause()">暂停</button><span class="m-muted">切页后会继续分析。</span></div>
            <template v-else>
              <div class="budget">
                <label class="field">调用上限<input v-model.number="calls" class="m-in" type="number" min="1" step="1"></label>
                <label class="field">Token 上限<input v-model.number="tokens" class="m-in" type="number" min="1" step="1"></label>
                <button v-if="finishedParts < job.units.length" type="button" class="m-btn pri" :disabled="!canResume" @click="resume(false)">继续分析</button>
                <button v-else-if="!job.report" type="button" class="m-btn pri" :disabled="!canResume" @click="resume(true)">生成跨章报告</button>
              </div>
              <button v-if="sourceChanged" type="button" class="m-btn" @click="refresh">更新原文并保留有效成果</button>
              <label v-else-if="job.source.origin.kind === 'file' && !job.singleBlock" class="field">上传新版原文
                <input type="file" accept=".txt,.md,.markdown,.html,.htm,.docx,.epub,.pdf" :disabled="importing || store.busy" @change="importSource">
              </label>
            </template>
          </section>

          <template v-if="source">
            <div class="breakdown-results">
              <div>
                <header class="result-heading"><h3>拆书成果</h3><button type="button" class="m-btn pri" :disabled="!checkedCards.length || running || store.busy || sourceChanged" @click="openHandoff">使用选中成果（{{ checkedCards.length }}）</button></header>
                <p v-if="job.report" class="m-muted">跨章报告取材于 {{ job.report.coveredUnits }} / {{ job.units.length }} 个已分析单元。</p>
                <p v-if="!activeCards.length" class="m-muted">{{ finishedParts ? '已读范围暂未得到分析卡。' : '完成一个分析单元后即可在这里核对。' }}</p>
                <BreakdownCardView v-for="item in displayedCards" :key="item.card.id" :item="item.card" :heading="item.heading"
                  :selectable="!!item.card.evidence.length && !sourceChanged" :checked="selectedCards.includes(item.card.id)"
                  :can-edit="!running && !store.busy" @select="toggleCard(item.card.id)" @open="showEvidence(item.card, $event)" @save="saveCard" />
                <button v-if="activeCards.length > displayedCards.length" class="m-btn" type="button" @click="displayLimit += 30">再显示 30 条成果</button>
                <details v-if="job.archive.length" class="breakdown-panel">
                  <summary>旧版本保留成果（{{ job.archive.length }}）</summary>
                  <BreakdownCardView v-for="item in job.archive" :key="item.version + item.card.id" :item="item.card" heading="旧版原文"
                    :selectable="false" :can-edit="false" @open="showEvidence(item.card, $event, item.version)" />
                </details>
              </div>
              <aside class="breakdown-panel evidence-panel" aria-label="原文核对">
                <h3>原文核对</h3>
                <template v-if="excerpt">
                  <p>{{ excerpt.heading }} · 段落 {{ excerpt.paragraph }} · 字符 {{ excerpt.start + 1 }}–{{ excerpt.end }}</p>
                  <p v-if="excerpt.version !== job.source.version" class="breakdown-error">此引文来自旧版原文。</p>
                  <p class="excerpt">{{ excerpt.before }}<mark>{{ excerpt.quote }}</mark>{{ excerpt.after }}</p>
                </template>
                <p v-else class="m-muted">点成果上的短引查看前后文。</p>
              </aside>
            </div>
            <section v-if="job.handoffs.length" class="breakdown-panel">
              <h3>使用记录</h3>
              <div v-for="receipt in job.handoffs" :key="receipt.id" class="coverage-row">
                <span>{{ receipt.title }} · {{ receipt.targetLabel }} · {{ receipt.destinationId ? '已保存' : '待重试' }}</span>
                <RouterLink v-if="receipt.destinationId" class="m-btn sm" :to="destinationRoute(receipt)">打开</RouterLink>
                <button v-else type="button" class="m-btn sm" @click="retryHandoff(receipt)">重试</button>
              </div>
            </section>
          </template>
        </template>
      </main>
    </div>
  </div>
  <V3Modal v-model:show="handoffOpen" title="确认使用拆书成果" :closable="!store.busy">
    <form class="handoff-form" @submit.prevent="confirmHandoff">
      <label class="field">用途<select class="m-in" v-model="handoffKind" @change="changeHandoffKind"><option v-for="(label, kind) in HANDOFF_NAMES" :key="kind" :value="kind">{{ label }}</option></select></label>
      <label v-if="handoffKind === 'knowledge'" class="field">目标知识库<select class="m-in" v-model="targetId"><option value="">请选择</option><option v-for="base in knowledge.knowledgeBases" :key="base.id" :value="base.id">{{ base.name }}</option></select></label>
      <label v-else-if="handoffKind === 'inspiration'" class="field">讨论<select class="m-in" v-model="targetId"><option value="">新对话</option><option v-for="session in sessions.sessions" :key="session.id" :value="session.id">{{ session.title }}</option></select></label>
      <template v-else>
        <label class="field">目标作品<select class="m-in" v-model="targetId" @change="targetChapterId = ''"><option value="">请选择</option><option v-for="novel in availableNovels" :key="novel.id" :value="novel.id">{{ novel.title }}</option></select></label>
        <label class="field">{{ handoffKind === 'codex' ? '首次出场（可选）' : '目标章节' }}<select class="m-in" v-model="targetChapterId"><option value="">请选择</option>
          <option v-for="chapter in targetNovel?.chapters || []" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 · {{ chapter.title }}</option>
        </select></label>
      </template>
      <label class="field">{{ handoffKind === 'codex' ? '在目标作品中的角色名' : '标题' }}<input class="m-in" v-model.trim="handoffTitle" maxlength="160" required></label>
      <label class="field">{{ handoffKind === 'codex' ? '改写候选人物的背景、动机与关系' : '确认要采用的文字' }}<textarea class="m-in" v-model.trim="handoffText" rows="7" maxlength="10000" required /></label>
      <p v-if="handoffError" class="breakdown-error" role="alert">{{ handoffError }}</p>
      <div class="actions">
        <button v-if="suggesting" type="button" class="m-btn" @click="stopSuggestion">取消生成</button>
        <button v-else-if="['plan', 'writing', 'codex'].includes(handoffKind)" type="button" class="m-btn" :disabled="!targetId || !handoffText || store.busy" @click="suggestHandoff">按目标作品生成候选</button>
        <button type="submit" class="m-btn pri" :disabled="store.busy || suggesting || !handoffTitle || !handoffText">确认采用</button>
      </div>
    </form>
  </V3Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import V3Modal from '@/v3/components/V3Modal.vue'
import { readKnowledgeFile } from '@/services/knowledgeImport'
import { canUseKnowledgeEntry } from '@/services/knowledgeVisibility'
import { loadBreakdownSource } from '@/services/bookBreakdownDb'
import { BREAKDOWN_TOPICS, knowledgeBreakdownSource, makeBreakdownSource, manuscriptBreakdownSource, openingSections, type BreakdownSource } from '@/services/bookBreakdownSource'
import type { BreakdownCard, BreakdownHandoff, BreakdownJob, BreakdownScope } from '@/services/bookBreakdownAnalysis'
import { useBookBreakdownStore } from '@/stores/bookBreakdown'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { breakdownHandoffDraft, destinationRoute, HANDOFF_NAMES, publishBreakdownHandoff, suggestBreakdownHandoff } from './bookBreakdownHandoff'
import BreakdownCardView from './BreakdownCard.vue'

const route = useRoute()
const router = useRouter()
const store = useBookBreakdownStore()
const knowledge = useKnowledgeStore()
const novels = useNovelStore()
const sessions = useInspirationSessionsStore()
const originOptions = [{ id: 'file', label: '本地文件' }, { id: 'knowledge', label: '知识库资料' }, { id: 'manuscript', label: '我的章节' }] as const
const originKind = ref<BreakdownSource['origin']['kind']>('file')
const source = shallowRef<BreakdownSource>()
const loading = ref(true)
const importing = ref(false)
const error = ref('')
const libraryChoice = ref('')
const manuscriptChoice = ref('')
const scope = ref<BreakdownScope>('opening')
const selection = ref<string[]>([])
const volume = ref('')
const paragraphSection = ref('')
const paragraphIndex = ref(0)
const topic = ref<string>(BREAKDOWN_TOPICS[0])
const question = ref('')
const calls = ref(1)
const tokens = ref(3000)
const selectedCards = ref<string[]>([])
const displayLimit = ref(30)
const handoffOpen = ref(false)
const handoffKind = ref<BreakdownHandoff['kind']>('inspiration')
const targetId = ref('')
const targetChapterId = ref('')
const handoffTitle = ref('')
const handoffText = ref('')
const handoffError = ref('')
const handoffCards = ref<BreakdownCard[]>([])
const suggesting = ref(false)
let suggestionRequest: AbortController | undefined
const excerpt = ref<{ heading: string; version: string; paragraph: number; start: number; end: number; before: string; quote: string; after: string }>()
let evidenceRequest = 0

const job = computed(() => store.jobs.find(item => item.id === route.params.jobId))
const running = computed(() => !!job.value && store.runningId === job.value.id)
const visibleBases = computed(() => knowledge.knowledgeBases.map(base => ({ ...base, entries: base.entries.filter(entry => canUseKnowledgeEntry(entry)) })).filter(base => base.entries.length))
const availableNovels = computed(() => novels.novels.filter(novel => novel.status !== 'trash'))
const targetNovel = computed(() => availableNovels.value.find(novel => novel.id === targetId.value))
const volumes = computed(() => [...new Set(source.value?.sections.map(section => section.volume).filter(Boolean))])
const currentBlocks = computed(() => source.value?.sections.find(section => section.key === paragraphSection.value)?.blocks || [])
const chosenBlock = computed(() => scope.value === 'paragraph' ? currentBlocks.value[paragraphIndex.value] || null : null)
const selectedKeys = computed(() => {
  if (!source.value) return []
  if (scope.value === 'selected') return selection.value
  if (scope.value === 'paragraph') return chosenBlock.value ? [paragraphSection.value] : []
  if (scope.value === 'opening') return openingSections(source.value)
  return source.value.sections.filter(section => scope.value === 'book' || section.volume === volume.value).map(section => section.key)
})
const selectedKeySet = computed(() => new Set(selectedKeys.value))
const taskTopic = computed(() => topic.value === '自定义问题' ? question.value : topic.value)
const estimate = computed(() => !job.value && source.value ? store.estimate(source.value, selectedKeys.value, chosenBlock.value, taskTopic.value) : null)
const validBudget = computed(() => [calls.value, tokens.value].every(value => Number.isSafeInteger(value) && value > 0))
const canCreate = computed(() => validBudget.value && !!estimate.value?.calls && !!taskTopic.value && !!store.model && !store.runningId && !store.busy)
const canResume = computed(() => validBudget.value && !!source.value && !sourceChanged.value && !store.runningId && !store.busy)
const finishedParts = computed(() => job.value?.units.filter(unit => unit.cards !== undefined).length || 0)
const sourceChanged = computed(() => {
  if (!job.value) return false
  try { return (store.currentSource(job.value)?.version || job.value.source.version) !== job.value.source.version }
  catch { return true }
})
const coveredSections = computed(() => {
  const map = new Map((source.value?.sections || []).map(section => [section.key, { key: section.key, title: section.title, completed: 0, parts: 0, tokens: 0 }]))
  for (const unit of job.value?.units || []) {
    const row = map.get(unit.part.sectionKey)
    if (!row) continue
    row.parts++
    if (unit.cards) row.completed++
    row.tokens += unit.usage?.charged || 0
  }
  return [...map.values()].filter(row => row.parts)
})
const completedSections = computed(() => new Set(coveredSections.value.filter(row => row.completed === row.parts).map(row => row.key)))
const sectionTitles = computed(() => new Map(source.value?.sections.map(section => [section.key, section.title])))
const activeCards = computed(() => [
  ...(job.value?.report?.cards || []).map(card => ({ card, heading: '跨章报告' })),
  ...(job.value?.units || []).flatMap(unit => (unit.cards || []).map(card => ({ card, heading: sectionTitles.value.get(unit.part.sectionKey) || '章节成果' }))),
])
const displayedCards = computed(() => activeCards.value.slice(0, displayLimit.value))
const checkedCards = computed(() => activeCards.value.map(item => item.card).filter(card => selectedCards.value.includes(card.id) && card.evidence.length))

function statusText(item: BreakdownJob) {
  if (store.runningId === item.id) return '分析中'
  return { ready: '待分析', running: '中断，可续跑', paused: '已暂停', budget: '到达预算', failed: '待重试', complete: '已完成' }[item.status]
}
function fail(value: unknown) { error.value = value instanceof Error ? value.message : String(value) }
function setSource(next?: BreakdownSource) {
  source.value = next
  selection.value = next ? openingSections(next) : []
  paragraphSection.value = next?.sections[0]?.key || ''
  paragraphIndex.value = 0
  volume.value = volumes.value[0] || ''
  if (scope.value === 'volume' && !volume.value) scope.value = 'opening'
}
function chooseOrigin(kind: typeof originKind.value) {
  originKind.value = kind
  libraryChoice.value = ''
  manuscriptChoice.value = ''
  error.value = ''
  setSource()
}
async function importSource(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  importing.value = true
  error.value = ''
  try {
    const text = await readKnowledgeFile(file)
    const currentJob = job.value
    const next = makeBreakdownSource(currentJob?.title || file.name, text, { kind: 'file' })
    if (!next.sections.length) throw new Error('文件没有可拆解的正文。')
    if (currentJob?.source.origin.kind === 'file') await store.refreshSource(currentJob, next)
    else if (originKind.value === 'file' && !currentJob) setSource(next)
  } catch (value) { fail(value) }
  finally { importing.value = false }
}
function selectLibrary() {
  error.value = ''
  const [baseId, entryId] = libraryChoice.value ? JSON.parse(libraryChoice.value) as string[] : []
  const entry = visibleBases.value.find(base => base.id === baseId)?.entries.find(item => item.id === entryId)
  setSource(entry ? knowledgeBreakdownSource(baseId, entry) : undefined)
}
function selectManuscript() {
  error.value = ''
  const novel = availableNovels.value.find(item => item.id === manuscriptChoice.value)
  const next = novel && manuscriptBreakdownSource(novel)
  if (next && !next.sections.length) fail(new Error('这部作品还没有可拆解的正文。'))
  setSource(next)
}

watch(estimate, value => {
  if (!value) return
  calls.value = Math.max(1, value.calls)
  tokens.value = Math.max(3000, value.tokens)
})
watch([() => job.value?.id, () => job.value?.source.version, loading], async ([id, version, pending], _, onCleanup) => {
  let active = true
  onCleanup(() => { active = false })
  excerpt.value = undefined
  if (pending) return
  error.value = ''
  if (!id || !job.value || !version) return
  selectedCards.value = []
  displayLimit.value = 30
  calls.value = job.value.calls
  tokens.value = job.value.tokens
  source.value = undefined
  try {
    store.authorize(job.value)
    const next = await loadBreakdownSource(id, version)
    if (!active) return
    if (!next) throw new Error('原文快照暂不可用。')
    source.value = next
  } catch (value) { if (active) fail(value) }
}, { immediate: true })
watch(() => [job.value, source.value, sourceChanged.value] as const, ([current, original, changed]) => {
  if (!current || !original || !changed) return
  try { store.authorize(current) } catch { source.value = undefined; excerpt.value = undefined }
})
watch([() => source.value?.version, () => route.query.card, () => route.query.evidence, () => route.query.version], ([version, id, evidenceIndex, requestedVersion]) => {
  if (!version || typeof id !== 'string' || typeof evidenceIndex !== 'string' || !/^\d+$/.test(evidenceIndex)) return
  const current = (!requestedVersion || requestedVersion === version) && activeCards.value.find(item => item.card.id === id)
  const archived = job.value?.archive.find(item => item.card.id === id && (!requestedVersion || item.version === requestedVersion))
  if (current) void showEvidence(current.card, Number(evidenceIndex))
  else if (archived) void showEvidence(archived.card, Number(evidenceIndex), archived.version)
})
onMounted(async () => {
  try { await Promise.all([store.initialize(), novels.initStore(), knowledge.initStore(), sessions.initialize()]) }
  catch (value) { fail(value) }
  finally { loading.value = false }
})
watch([handoffOpen, handoffKind, targetId, targetChapterId], stopSuggestion)
onBeforeUnmount(stopSuggestion)

async function start() {
  if (!source.value || !canCreate.value) return
  error.value = ''
  try {
    const created = await store.create(source.value, scope.value, selectedKeys.value, chosenBlock.value, taskTopic.value, calls.value, tokens.value)
    await router.push('/breakdown/' + created.id)
    if (created.status === 'ready') await store.resume(created, created.calls, created.tokens)
  } catch (value) { fail(value) }
}
async function resume(report: boolean) {
  if (!job.value) return
  error.value = ''
  try { await store.resume(job.value, calls.value, tokens.value, report) } catch (value) { fail(value) }
}
async function refresh() {
  if (!job.value) return
  try { await store.refreshSource(job.value) } catch (value) { fail(value) }
}
function toggleCard(id: string) {
  selectedCards.value = selectedCards.value.includes(id) ? selectedCards.value.filter(value => value !== id) : [...selectedCards.value, id]
}
async function saveCard(card: BreakdownCard) {
  if (!job.value) return
  try { await store.editCard(job.value, card) } catch (value) { fail(value) }
}
async function showEvidence(card: BreakdownCard, index: number, version = job.value?.source.version) {
  const current = job.value
  const evidence = card.evidence[index]
  if (!current || !evidence || !version) return
  const request = ++evidenceRequest
  try {
    store.authorize(current)
    const original = version === source.value?.version ? source.value : await loadBreakdownSource(current.id, version)
    if (request !== evidenceRequest || current.id !== job.value?.id) return
    store.authorize(current)
    if (!original || original.text.slice(evidence.start, evidence.end) !== evidence.quote) throw new Error('此引文需要重新核对。')
    const section = original.sections.find(item => item.key === evidence.sectionKey)
    excerpt.value = { ...evidence, version, heading: [section?.volume, section?.title].filter(Boolean).join(' / '),
      before: original.text.slice(Math.max(0, evidence.start - 200), evidence.start), after: original.text.slice(evidence.end, evidence.end + 200) }
  } catch (value) { fail(value) }
}
function changeHandoffKind() {
  targetId.value = ''
  targetChapterId.value = ''
  handoffTitle.value = handoffKind.value === 'codex' ? '' : handoffCards.value.map(card => card.title).join('、').slice(0, 160)
  handoffText.value = breakdownHandoffDraft(handoffCards.value, handoffKind.value).slice(0, 10000)
}
function openHandoff() {
  handoffCards.value = checkedCards.value
  handoffKind.value = 'inspiration'
  handoffError.value = ''
  changeHandoffKind()
  handoffOpen.value = true
}
function stopSuggestion() {
  suggestionRequest?.abort()
  suggestionRequest = undefined
  suggesting.value = false
}
async function suggestHandoff() {
  const current = job.value
  const kind = handoffKind.value
  if (!current || kind === 'knowledge' || kind === 'inspiration') return
  if (kind !== 'codex' && !targetChapterId.value) {
    handoffError.value = '请选择目标章节。'
    return
  }
  const draft = [handoffTitle.value, handoffText.value]
  const request = new AbortController()
  suggestionRequest = request
  suggesting.value = true
  handoffError.value = ''
  try {
    const suggestion = await suggestBreakdownHandoff(current, kind, targetId.value, targetChapterId.value, draft[1], request.signal)
    if (suggestionRequest === request && draft[0] === handoffTitle.value && draft[1] === handoffText.value) {
      handoffTitle.value = suggestion.title
      handoffText.value = suggestion.text
    }
  } catch (value) {
    if (!request.signal.aborted) handoffError.value = value instanceof Error ? value.message : String(value)
  } finally {
    if (suggestionRequest === request) stopSuggestion()
  }
}
function retryHandoff(receipt: BreakdownHandoff) {
  handoffKind.value = receipt.kind
  targetId.value = receipt.targetId
  targetChapterId.value = receipt.chapterId || ''
  handoffTitle.value = receipt.title
  handoffText.value = receipt.text
  handoffCards.value = activeCards.value.map(item => item.card).filter(card => receipt.links.some(link => link.cardId === card.id))
  handoffError.value = ''
  handoffOpen.value = true
}
async function confirmHandoff() {
  if (!job.value || !source.value) return
  const kind = handoffKind.value
  if (kind !== 'inspiration' && !targetId.value || (kind === 'plan' || kind === 'writing') && !targetChapterId.value) {
    handoffError.value = '请选择目标作品、知识库或章节。'
    return
  }
  const targetLabel = kind === 'inspiration' ? sessions.sessions.find(item => item.id === targetId.value)?.title || '新灵感对话'
    : kind === 'knowledge' ? knowledge.getKB(targetId.value)?.name || '知识库'
      : [targetNovel.value?.title, targetNovel.value?.chapters.find(chapter => chapter.id === targetChapterId.value)?.title].filter(Boolean).join(' / ')
  try {
    const receipt = await publishBreakdownHandoff(job.value, source.value, handoffCards.value, {
      kind, targetId: targetId.value, chapterId: targetChapterId.value || undefined, title: handoffTitle.value,
      text: handoffText.value, targetLabel,
    })
    handoffOpen.value = false
    if (receipt.kind === 'inspiration') await router.push(destinationRoute(receipt))
  } catch (value) { handoffError.value = value instanceof Error ? value.message : String(value) }
}
</script>

<style scoped>
.breakdown-page { position: absolute; inset: 0; overflow: auto; background: var(--desk); color: var(--ink); }
.breakdown-workbench { display: grid; grid-template-columns: 218px minmax(0, 1fr); max-width: 1460px; min-height: 100%; margin: 0 auto; }
.breakdown-history { padding: 24px 16px; border-right: 1px solid var(--line); background: var(--panel); }
.breakdown-history header, .result-heading, .actions, .budget, .coverage-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.breakdown-history header, .result-heading, .coverage-row { justify-content: space-between; }
.breakdown-history h1, .page-title h2 { font: 650 27px/1.3 var(--f-serif); margin: 0; }
.breakdown-history h2 { color: var(--ink-3); font-size: 13px; margin: 26px 0 8px; }
.history-item { display: grid; gap: 5px; padding: 10px; margin-bottom: 4px; border: 1px solid transparent; border-radius: var(--r-s); color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.history-item:hover, .history-item.selected { border-color: var(--line); background: var(--desk); }
.history-item span { font-size: 12px; color: var(--ink-3); }
.breakdown-main { width: 100%; padding: 28px clamp(16px, 3vw, 42px) 50px; min-width: 0; }
.page-title { margin-bottom: 18px; }
.page-title p { color: var(--ink-3); margin: 6px 0; }
.breakdown-panel { padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--panel); margin-bottom: 14px; }
.breakdown-panel h3, .result-heading h3 { font: 650 17px var(--f-serif); margin: 0 0 8px; }
.field { display: grid; gap: 5px; margin: 10px 0; font-size: 13px; }
.field select, .field input, .field textarea { max-width: 100%; width: 100%; }
.handoff-form textarea { resize: vertical; }
.budget { align-items: end; margin-bottom: 8px; }
.budget > label { flex: 0 1 140px; margin: 0; }
.directory { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: var(--r-s); padding: 8px 10px; }
.directory summary, summary { cursor: pointer; }
.directory label { display: block; margin: 5px 0; }
.coverage-row { padding: 5px 0; }
.coverage-row + .coverage-row { border-top: 1px solid var(--line); }
progress { width: 100%; height: 8px; accent-color: var(--zhu); margin-top: 10px; }
.breakdown-error { color: var(--zhu); overflow-wrap: anywhere; }
.breakdown-results { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(210px, 1fr); gap: 14px; align-items: start; }
.result-heading { margin-bottom: 12px; }
.evidence-panel { position: sticky; top: 10px; }
.excerpt { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
.excerpt mark { background: var(--zhu-soft); color: var(--zhu); }
@media (max-width: 860px) { .breakdown-workbench { grid-template-columns: 150px minmax(0, 1fr); } .breakdown-results { grid-template-columns: 1fr; } .evidence-panel { grid-row: 1; position: static; } }
</style>
