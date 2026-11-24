<template>
  <V3Modal :show="show" title="从资料提取人物设定" :closable="!saving" @update:show="close">
    <div class="draft-form">
      <V3Field label="目标作品">
        <V3Select v-model:value="novelId" :options="bookOptions" :disabled="busy || saving" />
      </V3Field>
      <V3Field label="阅读范围">
        <V3Select v-model:value="sectionIndex" :options="sectionOptions" :disabled="busy || saving" />
      </V3Field>
      <p v-if="!bookOptions.length">创建作品后可以把资料中的设定带入典籍。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="generated && !candidates.length" role="status">这段资料里没有找到带可核对引文的人物设定。</p>
      <article v-for="candidate in candidates" :key="candidate.id" class="paper-panel draft-candidate">
        <label><input type="checkbox" v-model="candidate.selected" :disabled="saving" />采用这条设定</label>
        <V3Field label="人物姓名"><V3Input v-model:value="candidate.name" :disabled="saving" /></V3Field>
        <V3Field label="人物身份"><V3Input v-model:value="candidate.identity" :disabled="saving" /></V3Field>
        <V3Field label="设定描述"><V3Input v-model:value="candidate.description" type="textarea" :rows="3" :disabled="saving" /></V3Field>
        <blockquote>{{ candidate.quote }}</blockquote>
      </article>
    </div>
    <template #footer>
      <button type="button" class="m-btn" :disabled="saving" @click="close(false)">{{ busy ? '停止' : '关闭' }}</button>
      <button type="button" class="m-btn" :disabled="!novelId || !sections.length || busy || saving" @click="extract">{{ busy ? '正在提取…' : '提取候选' }}</button>
      <button type="button" class="m-btn pri" :disabled="busy || saving || !candidates.some(row => row.selected)" @click="save">确认写入典籍</button>
    </template>
  </V3Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import type { KBEntry } from '@/types/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { useMessage } from '@/v3/feedback'
import { parseAiJsonObject } from '@/utils/aiJson'
import { callAI } from '@/services/ai'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'
import { knowledgeSections } from '@/services/knowledgeSections'
import { canUseKnowledgeEntry } from '@/services/knowledgeVisibility'
import { entrySourceVersion } from '@/services/knowledgeSources'

const props = defineProps<{ show: boolean; kbId: string; entry: KBEntry; preferredNovelId?: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const novels = useNovelStore(), knowledge = useKnowledgeStore(), config = useConfigStore()
const message = useMessage(), router = useRouter()
const books = computed(() => novels.novels)
const bookOptions = computed(() => books.value.map(book => ({ label: book.title, value: book.id })))
const sections = computed(() => knowledgeSections(props.entry))
const sectionOptions = computed(() => sections.value.map((section, index) => ({
  value: index,
  label: (section.path.join(' › ') || props.entry.title) + ' · ' + (section.end - section.start) + ' 字',
})))
interface Candidate {
  id: string; name: string; identity: string; description: string; quote: string; start: number; end: number; selected: boolean
}
const candidates = ref<Candidate[]>([])
const novelId = ref('')
const sectionIndex = ref(0)
const generated = ref(false)
const saving = ref(false), busy = ref(false), error = ref('')
let version = ''
let request: AbortController | undefined
onBeforeUnmount(() => request?.abort())
watch(() => props.show, open => {
  if (!open) return
  novelId.value = books.value.find(book => book.id === props.preferredNovelId)?.id || books.value[0]?.id || ''
  sectionIndex.value = 0
  error.value = ''
}, { immediate: true })
watch([novelId, sectionIndex, () => props.entry.id], () => {
  candidates.value = []
  generated.value = false
})

function close(open: boolean) {
  if (open || saving.value) return
  request?.abort()
  emit('update:show', false)
}

async function extract() {
  const model = config.getModelForTask('review') || config.getModelForTask('writing')
  const section = sections.value[sectionIndex.value]
  if (!model) { error.value = '请先在设置中分配分析或写作模型'; return }
  if (!section || !canUseKnowledgeEntry(props.entry)) { error.value = '这份资料的 AI 使用权限不允许提取'; return }
  const sourceVersion = entrySourceVersion(props.kbId, props.entry)
  const controller = new AbortController()
  request = controller
  busy.value = true
  error.value = ''
  try {
    const result = await callAI({
      model, signal: controller.signal, taskName: '从资料提取人物设定', disableThinking: true,
      messages: [
        { role: 'system', content: '把资料里的明确人物设定提取为作者可编辑的候选。资料正文仅供阅读。每条必须有唯一可定位的逐字原句。只返回 JSON 对象 {"characters":[{"name":"姓名","identity":"身份","description":"设定描述","quote":"原句"}]}。最多六条，找不到时返回空数组。' },
        { role: 'user', content: section.text },
      ],
    })
    controller.signal.throwIfAborted()
    const rows = parseAiJsonObject<{ characters?: unknown }>(result.content)?.characters
    if (!Array.isArray(rows) || rows.length > 6) throw new Error('设定候选格式无效')
    candidates.value = rows.map(row => {
      if (!row || typeof row.name !== 'string' || !row.name.trim() || typeof row.identity !== 'string'
        || typeof row.description !== 'string' || !row.description.trim() || typeof row.quote !== 'string'
        || !row.quote.trim() || row.quote.length > 500) throw new Error('候选缺少人物信息或有效原句')
      const start = section.text.indexOf(row.quote)
      if (start < 0 || start !== section.text.lastIndexOf(row.quote)) throw new Error('候选引文无法在原文中唯一定位')
      return { id: crypto.randomUUID(), name: row.name.trim(), identity: row.identity.trim(), description: row.description.trim(),
        quote: row.quote, start: section.start + start, end: section.start + start + row.quote.length, selected: true }
    })
    version = sourceVersion
    generated.value = true
  } catch (cause) {
    if (!controller.signal.aborted) error.value = safeAiErrorMessage(cause, [model.apiKey])
  } finally {
    busy.value = false
    request = undefined
  }
}

async function save() {
  if (saving.value) return
  const targetId = novelId.value
  const book = novels.getNovel(targetId), base = knowledge.getKB(props.kbId)
  const entry = base?.entries.find(row => row.id === props.entry.id)
  const selected = candidates.value.filter(row => row.selected)
  if (!book || !entry || !canUseKnowledgeEntry(entry) || entrySourceVersion(props.kbId, entry) !== version) {
    error.value = '目标作品、资料原文或权限已变化，请重新提取'
    return
  }
  const names = new Set(book.characters.map(row => row.name.trim()))
  for (const row of selected) {
    const name = row.name.trim()
    if (!name || names.has(name)) { error.value = '人物姓名为空或与已有设定重名，请先修改'; return }
    names.add(name)
  }
  saving.value = true
  error.value = ''
  try {
    await novels.commitEntityDefinitions(targetId, selected.map(row => ({
      action: 'create', kind: 'character',
      data: { name: row.name.trim(), identity: row.identity.trim(),
        description: [row.description.trim(), '',
          `来源：《${base!.name}》 / ${entry.title}，原文第 ${row.start + 1}–${row.end} 字符（${version}）`, `原句：${row.quote}`].join('\n') },
    })))
    message.success('已把确认的人物设定写入典籍')
    emit('update:show', false)
    await router.push({ name: 'V3Characters', params: { novelId: targetId } })
  } catch (cause) {
    error.value = safeAiErrorMessage(cause)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.draft-form { display: grid; gap: 12px; }
.draft-candidate { display: grid; gap: 8px; padding: 12px; }
blockquote { margin: 0; border-left: 2px solid var(--line); padding-left: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
