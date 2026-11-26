<template>
  <V3Modal :show="show" title="存入知识库" size="wide" class="save-chat-knowledge" :closable="!saving"
    description="AI 自动总结目录标题与分类，按标准目录结构归档，便于直接检索与向量匹配。"
    @update:show="value => { if (!saving) emit('update:show', value) }">
    <div class="knowledge-draft-form">
      <V3Field label="目标知识库">
        <V3Select v-model:value="target" :options="options" :disabled="saving || Boolean(pending)" aria-label="目标知识库" />
      </V3Field>
      <p class="knowledge-structure-hint">
        将作为独立目录小节追加到「{{ targetDocumentTitle }}」（上面是目录，下面是正文）。
      </p>
      <div class="knowledge-title-row">
        <V3Field label="目录标题（AI 自动总结，可微调）">
          <V3Input v-model:value="title" :maxlength="120" :disabled="saving || extracting || Boolean(pending)"
            :placeholder="extracting ? 'AI 正在总结目录标题…' : '输入清晰概括主题的目录标题'" aria-label="目录标题" />
        </V3Field>
        <div class="knowledge-auto-category" aria-label="自动分类">
          <span class="m-field-l">自动分类</span>
          <span class="auto-category-pill">{{ categoryLabel }}</span>
        </div>
      </div>
      <V3Field label="内容">
        <V3Input v-model:value="draft" type="textarea" :rows="10" :disabled="saving || extracting || Boolean(pending)" aria-label="知识条目内容" />
      </V3Field>
      <V3Field label="标签">
        <V3Input v-model:value="tags" placeholder="AI 自动提炼，可用逗号分隔微调" :disabled="saving || extracting || Boolean(pending)" aria-label="知识条目标签" />
      </V3Field>
      <span class="m-field-l">提取摘要（供后续检索与写作参考）</span>
      <p v-if="extracting" class="knowledge-extract-status" role="status">{{ extractionStatus }}</p>
      <p v-if="extractError" class="knowledge-save-error" role="alert">{{ extractError }}；可以重试或直接按原文保存。</p>
      <p v-if="content.length > CHAT_KNOWLEDGE_EXTRACT_LIMIT" class="knowledge-extract-status">
        本条回复较长，AI 仅读取前 {{ CHAT_KNOWLEDGE_EXTRACT_LIMIT.toLocaleString() }} 字；请核对摘要是否遗漏后续信息。
      </p>
      <V3Input v-model:value="summary" type="textarea" :rows="4" :disabled="saving || Boolean(pending) || extracting"
        placeholder="提取完成后可编辑；留空则仅保存原文" aria-label="知识条目摘要" />
      <p class="knowledge-extract-status">请核对 AI 提取的标题、事实与数字。</p>
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
import {
  CHAT_KNOWLEDGE_EXTRACT_LIMIT,
  cleanFallbackTitle,
  extractChatKnowledge,
  inferChatKnowledgeCategory,
} from '@/services/chatKnowledgeExtraction'
import {
  discussionDocumentTitle,
  resolveDefaultSaveTarget,
  saveStructuredChatKnowledge,
} from '@/services/chatKnowledgeDocument'

const props = defineProps<{
  show: boolean
  content: string
  preferredIds?: string[]
  mode?: 'book' | 'inspiration'
  bookTitle?: string
}>()
const emit = defineEmits<{
  'update:show': [show: boolean]
  saved: [result: { kbId: string; kbName: string; entryId: string; title: string; entryTitle?: string }]
}>()

const store = useKnowledgeStore()
const config = useConfigStore()
const AUTO_NEW_BASE = '__auto_discussion_knowledge_base__'
const target = ref(AUTO_NEW_BASE)
const title = ref('')
const category = ref('其他')
const draft = ref('')
const tags = ref('')
const summary = ref('')
const extracting = ref(false)
const extractionStatus = ref('正在由 AI 总结目录标题与自动分类…')
const extractError = ref('')
let extractionController: AbortController | null = null
let summarizedContent = ''
const saving = ref(false)
let active = true
onBeforeUnmount(() => { active = false; extractionController?.abort() })
const error = ref('')
const pending = ref<{ kbId: string; entryId: string; title: string; entryTitle: string } | null>(null)

const effectiveMode = computed<'book' | 'inspiration'>(() => props.mode ?? (props.bookTitle?.trim() ? 'book' : 'inspiration'))
const defaultTarget = computed(() => resolveDefaultSaveTarget(store.knowledgeBases, {
  mode: effectiveMode.value,
  bookTitle: props.bookTitle,
  boundIds: props.preferredIds,
}))
const targetDocumentTitle = computed(() => discussionDocumentTitle(effectiveMode.value === 'book' ? props.bookTitle : undefined))
const categoryLabel = computed(() => kbCategories.find(item => item.value === category.value)?.label || `📝 ${category.value || '其他'}`)

const options = computed(() => {
  const existing = store.knowledgeBases.map(base => ({ label: base.name, value: base.id }))
  if (defaultTarget.value.isExisting) return existing
  return [{ label: `${defaultTarget.value.autoName}（自动新建）`, value: AUTO_NEW_BASE }, ...existing]
})

const canSave = computed(() => !saving.value && !extracting.value && (Boolean(pending.value)
  || Boolean(title.value.trim() && draft.value.trim())))

watch(() => props.show, show => {
  if (!show) {
    extractionController?.abort()
    extractionController = null
    extracting.value = false
    return
  }
  target.value = defaultTarget.value.kbId ?? AUTO_NEW_BASE
  title.value = ''
  draft.value = props.content
  category.value = inferChatKnowledgeCategory(props.content)
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
  if (!extracting.value && value.trim()) {
    const inferred = inferChatKnowledgeCategory(value)
    if (category.value === '其他' && inferred !== '其他') category.value = inferred
  }
})

async function extract() {
  if (!props.show || !draft.value.trim() || extracting.value || pending.value) return
  const model = config.getModelForTask('chat')
  if (!model?.apiKey.trim()) {
    extractError.value = '请先配置可用的对话模型与 API 密钥'
    if (!title.value.trim()) title.value = cleanFallbackTitle(draft.value)
    category.value = inferChatKnowledgeCategory(draft.value)
    return
  }
  const request = new AbortController()
  extractionController = request
  extracting.value = true
  extractionStatus.value = '正在由 AI 总结目录标题与自动分类…'
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
      if (!title.value.trim()) title.value = cleanFallbackTitle(source)
      category.value = inferChatKnowledgeCategory(source)
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
      if (draft.value.length > 100_000) throw new Error('单条内容超过 10 万字符，请拆分后保存。')
      const sectionTitle = title.value.trim() || cleanFallbackTitle(draft.value)
      const saved = saveStructuredChatKnowledge(store, {
        targetKbId: target.value === AUTO_NEW_BASE ? null : target.value,
        mode: effectiveMode.value,
        bookTitle: props.bookTitle,
        sectionTitle,
        body: draft.value.trim(),
        category: category.value || inferChatKnowledgeCategory(draft.value),
        tags: tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).slice(0, 20),
        summary: summary.value.trim(),
      })
      pending.value = { kbId: saved.kbId, entryId: saved.entryId, title: saved.sectionTitle, entryTitle: saved.entryTitle }
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
.knowledge-structure-hint { margin: -2px 0 2px; font-size: 12px; color: var(--ink-3); line-height: 1.5; }
.knowledge-title-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.knowledge-auto-category { display: grid; gap: 6px; min-width: 112px; }
.auto-category-pill {
  display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: var(--r-s); background: var(--panel);
  color: var(--ink-2); font-size: 13px; white-space: nowrap;
}
@media (max-width: 520px) { .knowledge-title-row { grid-template-columns: 1fr; } }
.knowledge-save-error { color: var(--zhu); overflow-wrap: anywhere; margin: 0; }
.knowledge-extract-status { color: var(--ink-3); font-size: 12px; margin: 0; }
</style>
