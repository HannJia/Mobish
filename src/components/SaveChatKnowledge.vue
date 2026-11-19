<template>
  <V3Modal :show="show" title="存入知识库" size="wide" class="save-chat-knowledge" :closable="!saving"
    description="把这条回复整理成知识条目；保存前可以修改标题、分类、内容和摘要。"
    @update:show="value => { if (!saving) emit('update:show', value) }">
    <div class="knowledge-draft-form">
      <V3Field label="目标知识库"><V3Select v-model:value="target" :options="options" :disabled="saving || Boolean(pending)" aria-label="目标知识库" /></V3Field>
      <template v-if="target === NEW_BASE">
        <V3Field label="新知识库名称"><V3Input v-model:value="name" :maxlength="100" :disabled="saving || Boolean(pending)" aria-label="新知识库名称" /></V3Field>
      </template>
      <div class="knowledge-form-row">
        <V3Field label="条目标题"><V3Input v-model:value="title" :maxlength="180" :disabled="saving || extracting || Boolean(pending)" aria-label="条目标题" /></V3Field>
        <V3Field label="分类"><V3Select v-model:value="category" :options="kbCategories" :disabled="saving || extracting || Boolean(pending)" aria-label="条目分类" /></V3Field>
      </div>
      <V3Field label="内容"><V3Input v-model:value="draft" type="textarea" :rows="10" :disabled="saving || extracting || Boolean(pending)" aria-label="知识条目内容" /></V3Field>
      <V3Field label="标签"><V3Input v-model:value="tags" placeholder="用逗号分隔" :disabled="saving || extracting || Boolean(pending)" aria-label="知识条目标签" /></V3Field>
      <span class="m-field-l">提取摘要（供后续检索与写作参考）</span>
      <p v-if="extracting" class="knowledge-extract-status" role="status">{{ extractionStatus }}</p>
      <p v-if="extractError" class="knowledge-save-error" role="alert">{{ extractError }}；可以重试或直接按原文保存。</p>
      <p v-if="content.length > CHAT_KNOWLEDGE_EXTRACT_LIMIT" class="knowledge-extract-status">
        本条回复较长，AI 仅读取前 {{ CHAT_KNOWLEDGE_EXTRACT_LIMIT.toLocaleString() }} 字；请核对摘要是否遗漏后续信息。
      </p>
      <V3Input v-model:value="summary" type="textarea" :rows="4" :disabled="saving || Boolean(pending) || extracting"
        placeholder="提取完成后可编辑；留空则仅保存原文" aria-label="知识条目摘要" />
      <p class="knowledge-extract-status">请核对 AI 提取的重要事实与数字。</p>
      <p v-if="error" class="knowledge-save-error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="m-btn" :disabled="saving" @click="emit('update:show', false)">取消</button>
      <button v-if="extractError && !saving && !pending" type="button" class="m-btn" :disabled="extracting" @click="extract">重试提取</button>
      <button type="button" class="m-btn pri" :disabled="!canSave || saving" :aria-busy="saving" @click="save">
        <V3Icon name="check" size="s" />{{ pending ? '重试保存' : '确认保存' }}
      </button>
    </template>
  </V3Modal>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import { kbCategories, useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { CHAT_KNOWLEDGE_EXTRACT_LIMIT, extractChatKnowledge } from '@/services/chatKnowledgeExtraction'

const props = defineProps<{ show: boolean; content: string; preferredIds?: string[] }>()
const emit = defineEmits<{
  'update:show': [show: boolean]
  saved: [result: { kbId: string; kbName: string; entryId: string; title: string }]
}>()
const store = useKnowledgeStore()
const config = useConfigStore()
const NEW_BASE = '__new_knowledge_base__'
const target = ref(NEW_BASE)
const name = ref('')
const title = ref('')
const category = ref('其他')
const draft = ref('')
const tags = ref('')
const summary = ref('')
const extracting = ref(false)
const extractionStatus = ref('正在从本条回复提取信息…')
const extractError = ref('')
let extractionController: AbortController | null = null
let summarizedContent = ''
const saving = ref(false)
let active = true
onBeforeUnmount(() => { active = false; extractionController?.abort() })
const error = ref('')
const pending = ref<{ kbId: string; entryId: string; title: string } | null>(null)
const options = computed(() => [
  ...store.knowledgeBases.map(base => ({ label: base.name, value: base.id })),
  { label: '新建知识库', value: NEW_BASE },
])
const canSave = computed(() => !saving.value && !extracting.value && (Boolean(pending.value)
  || Boolean(title.value.trim() && draft.value.trim() && (target.value !== NEW_BASE || name.value.trim()))))

watch(() => props.show, show => {
  if (!show) {
    extractionController?.abort()
    extractionController = null
    extracting.value = false
    return
  }
  target.value = props.preferredIds?.find(id => store.getKB(id)) || NEW_BASE
  name.value = ''
  title.value = props.content.split('\n').map(line => line.replace(/^[#*\s]+|[*\s]+$/g, '')).find(Boolean)?.slice(0, 180) || ''
  draft.value = props.content
  category.value = '其他'
  tags.value = ''
  summary.value = ''
  summarizedContent = ''
  error.value = ''
  extractError.value = ''
  pending.value = null
  if (props.content.trim()) void extract()
}, { immediate: true })

watch(draft, value => {
  if (summarizedContent && value !== summarizedContent) {
    summary.value = ''
    summarizedContent = ''
    extractError.value = '正文已修改，原摘要已清空'
  }
})

async function extract() {
  if (!props.show || !draft.value.trim() || extracting.value || pending.value) return
  const model = config.getModelForTask('chat')
  if (!model?.apiKey.trim()) {
    extractError.value = '请先配置可用的对话模型与 API 密钥'
    return
  }
  const request = new AbortController()
  extractionController = request
  extracting.value = true
  extractionStatus.value = '正在从本条回复提取信息…'
  extractError.value = ''
  const source = draft.value
  try {
    const extracted = await extractChatKnowledge({ ...model }, source, request.signal, () => {
      if (extractionController === request) extractionStatus.value = '正在尝试简洁摘要格式…'
    })
    if (!active || !props.show || extractionController !== request || request.signal.aborted) return
    title.value = extracted.title
    category.value = extracted.category
    tags.value = extracted.tags.join('、')
    summary.value = extracted.summary
    summarizedContent = source
  } catch (cause) {
    if (active && props.show && extractionController === request && !request.signal.aborted) {
      extractError.value = errorText(cause, 'AI 提取失败')
    }
  } finally {
    if (extractionController === request) {
      extractionController = null
      extracting.value = false
    }
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  try {
    if (!pending.value) {
      if (draft.value.length > 100_000) throw new Error('条目超过 10 万字符，请拆分后保存。')
      let kb = store.getKB(target.value)
      if (target.value === NEW_BASE) {
        if (store.knowledgeBases.some(base => base.name === name.value.trim())) throw new Error('已有同名知识库，请选择该库或修改名称。')
        kb = store.createKB(name.value.trim())
      }
      if (!kb) throw new Error('目标知识库已不存在，请重新选择。')
      const entry = store.addEntry(kb.id, {
        title: title.value.trim(), content: draft.value.trim(), category: category.value, summary: summary.value.trim(),
        tags: tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).slice(0, 20),
      }, 'author')
      if (!entry) throw new Error('未能创建条目，请重试。')
      pending.value = { kbId: kb.id, entryId: entry.id, title: entry.title }
    }
    await store.flushPendingSaves()
    if (!active) return
    const kb = store.getKB(pending.value.kbId)
    if (!kb?.entries.some(entry => entry.id === pending.value!.entryId)) throw new Error('条目已被移除，请重新保存。')
    emit('saved', { ...pending.value, kbName: kb.name })
    emit('update:show', false)
  } catch (cause) {
    error.value = pending.value
      ? '条目已加入本次会话，但写入本机失败。请重试保存，不会重复创建条目。'
      : errorText(cause, '保存失败，请重试。')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.knowledge-draft-form { display: grid; gap: 8px; min-width: 0; }
.knowledge-draft-form .m-field { margin-bottom: 0; }
.knowledge-form-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 12px; }
@media (max-width: 520px) { .knowledge-form-row { grid-template-columns: 1fr; } }
.knowledge-save-error { color: var(--zhu); overflow-wrap: anywhere; margin: 0; }
.knowledge-extract-status { color: var(--ink-3); font-size: 12px; margin: 0; }

</style>
