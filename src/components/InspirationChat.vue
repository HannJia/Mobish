<template>
  <section class="inspiration-chat">
    <div class="inspiration-panel-switch" role="group" aria-label="灵感工作区视图">
      <button type="button" :aria-pressed="compactPanel === 'conversation'" @click="compactPanel = 'conversation'">灵感对话</button>
      <button type="button" :aria-pressed="compactPanel === 'settings'" @click="showSettingsPanel">已整理的设定</button>
    </div>
    <div class="inspiration-workspace" :class="{ 'show-settings': compactPanel === 'settings', 'settings-collapsed': settingsCollapsed }">
      <main class="inspiration-conversation paper-panel">
        <header class="inspiration-heading">
          <h2>灵感对话</h2>
          <div ref="headingTools" class="heading-tools" @keydown.esc="closeHeaderMenu">
            <button type="button" class="heading-tool" :aria-expanded="headerMenu === 'history'" :disabled="busy"
              data-inspiration-history @click="toggleHeaderMenu('history')">
              <V3Icon name="history" size="s" /><span>历史会话</span><V3Icon name="chevD" size="s" class="tool-chevron" />
            </button>
            <button type="button" class="heading-tool" :class="{ on: knowledgeIds.length }" :aria-expanded="headerMenu === 'knowledge'"
              :title="knowledgeNames || '未挂载知识库'" data-heading-knowledge @click="toggleHeaderMenu('knowledge')">
              <V3Icon name="book" size="s" />
              <span>参考知识库{{ knowledgeNames ? '：' + knowledgeNames : '' }}</span>
              <V3Icon name="chevD" size="s" class="tool-chevron" />
            </button>
            <button v-if="settingsCollapsed" type="button" class="heading-tool show-settings-tool" data-open-settings @click="showSettingsPanel">
              <V3Icon name="arrowR" size="s" class="open-settings-arrow" /><span>已整理的设定</span>
            </button>
            <div v-if="headerMenu === 'history'" class="heading-pop" role="group" aria-label="历史灵感会话">
              <button type="button" class="m-btn" @click="loadSession(null)"><V3Icon name="plus" size="s" />新建会话</button>
              <p v-if="!savedSessions.length" class="heading-knowledge-empty">还没有保存的会话。</p>
              <div v-for="session in savedSessions" :key="session.id" class="history-row">
                <button type="button" class="history-session" :data-history-session="session.id"
                  :aria-current="selectedSessionId === session.id ? 'true' : undefined" @click="loadSession(session.id)">
                  <span>{{ session.title }}</span>
                  <small>{{ session.messages.length }} 条消息 · {{ sessionTime(session.updatedAt) }}</small>
                </button>
                <button type="button" class="m-btn sm history-delete" :data-delete-history-session="session.id"
                  :aria-label="`删除会话《${session.title}》`" title="删除会话" @click="confirmRemoveSession(session)">
                  <V3Icon name="trash" size="s" />
                </button>
              </div>
            </div>
            <div v-if="headerMenu === 'knowledge'" class="heading-pop heading-knowledge-pop" role="group" aria-label="选择参考知识库">
              <div v-if="!knowledge.knowledgeBases.length" class="heading-knowledge-empty">还没有知识库，可以在左侧“知识库”中导入资料。</div>
              <label v-for="option in knowledgeOptions" :key="option.value" class="m-check">
                <input type="checkbox" :checked="knowledgeIds.includes(option.value)" :disabled="busy"
                  @change="toggleKnowledge(option.value, ($event.target as HTMLInputElement).checked)">{{ option.label }}
              </label>
              <small v-if="sharedKnowledgeIds">所选资料也会挂载到新作品。</small>
              <button type="button" class="m-btn" :disabled="busy" @click="openKnowledgeDraft('')">
                <V3Icon name="plus" size="s" />新建知识条目
              </button>
            </div>
          </div>
        </header>
    <div class="inspiration-reading">
      <nav v-if="turns.length" class="inspiration-turns" aria-label="对话轮次" @mouseleave="hoveredTurn = null">
        <button v-for="(turn, ordinal) in turns" :key="turn.index" type="button"
          :aria-current="activeTurn === turn.index ? 'true' : undefined" :aria-label="`第 ${ordinal + 1} 轮：${turn.preview}`"
          @mouseenter="hoveredTurn = turn.index" @focus="focusedTurn = turn.index" @blur="focusedTurn = null"
          @click="jumpToTurn(turn.index)"><span aria-hidden="true"></span></button>
      </nav>
      <p v-if="turnPreview" class="inspiration-turn-preview" aria-hidden="true">{{ turnPreview }}</p>
    <div ref="historyElement" class="inspiration-history" tabindex="0" aria-live="polite" aria-label="灵感对话">
      <div v-if="!history.length && !busy" class="inspiration-empty-guide"><V3Icon name="bulb" size="l" /><h3>写下故事的第一点灵感</h3><p>人物、场景、一句台词，都可以成为起点。</p><div><button v-for="prompt in ['先帮我构思一个主角', '一起确定故事的背景', '从一个核心冲突开始']" :key="prompt" type="button" @click="input = input.trim() ? input + '\n' + prompt : prompt">{{ prompt }}</button></div></div>
      <article v-for="(item, index) in history" :key="index" :data-message-index="index"
        class="inspiration-message" :class="item.role">
        <strong>{{ item.role === 'user' ? '我' : isSaveReceipt(item) ? '软件' : 'AI' }}</strong>
        <div v-html="renderMd(item.role === 'assistant' ? formatChatReply(item.content, item.search) : item.content)"></div>
        <ChatSearchEvidence :record="item.search" />
        <div v-if="item.knowledgeReferences?.length || saveReminder?.index === index" class="inspiration-reply-actions">
          <button v-if="item.knowledgeReferences?.length" type="button" class="m-btn inspiration-reference-toggle"
            :aria-expanded="expandedReferences.has(index)" @click="toggleReferences(index)">
            <V3Icon name="chevR" size="s" />本轮引用 {{ item.knowledgeReferences.length }} 处原文
          </button>
          <button v-if="saveReminder?.index === index" type="button" class="m-btn inspiration-save-reminder" :disabled="busy"
            @click="openSuggestedKnowledgeDraft(item)">
            <V3Icon name="book" size="s" /><span>这轮讨论可以存入知识库：{{ saveReminder.title }} · 查看草稿</span>
          </button>
          <ul v-if="item.knowledgeReferences?.length && expandedReferences.has(index)" class="inspiration-knowledge-references">
            <li v-for="reference in item.knowledgeReferences" :key="reference.label">
              <button type="button" class="m-btn ghost" @click="openedReference = reference">
                {{ reference.label }} · {{ reference.entryTitle }}{{ reference.path.length ? ' › ' + reference.path.join(' › ') : '' }}
              </button>
            </li>
          </ul>
        </div>
      </article>
      <article v-if="streamReplyText" data-streaming-assistant class="inspiration-message assistant">
        <strong>AI</strong><div v-html="renderMd(streamReplyText)"></div>
      </article>
      <p v-else-if="busy" class="inspiration-progress" role="status">{{ compacting
        ? compactionProgress
        : extracting
          ? extractionProgress
          : requestWebSearch ? '正在请求联网回复，完成后显示回答和来源；开关修改下条生效…' : 'AI 正在回复…' }}</p>
      <div v-if="suggestedQuestions.length && !busy" class="inspiration-follow-ups" role="group" aria-label="建议继续讨论的问题">
        <span>可以接着聊</span>
        <button v-for="question in suggestedQuestions" :key="question" type="button" @click="sendSuggestedQuestion(question)">
          {{ question }}<span aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
    </div>
    <div class="inspiration-composer">
      <aside v-if="pendingIdea" class="inspiration-carried-idea" aria-label="已带入的一句话灵感">
        <strong>已带入一句话灵感</strong><p>{{ pendingIdea }}</p><small>发送时会与下方草稿一起带入讨论。</small>
      </aside>
      <V3Input v-model:value="input" type="textarea" :rows="3" :maxlength="4000" :disabled="busy"
        :placeholder="history.length ? '继续说说你的想法…' : '一句话说说你的想法：一个人物、一个冲突或一个场景'" aria-label="小说灵感"
        @keydown="handleInputKeydown" @compositionstart="composing = true"
        @compositionend="composing = false" @blur="composing = false" />
      <div v-if="error" role="alert" class="inspiration-error">{{ error }}</div>
      <div class="inspiration-actions">
        <p class="inspiration-input-hint">回车发送 · 上档键＋回车换行</p>
        <button v-if="!history.length && !busy" type="button" class="m-btn" :disabled="!canExtract"
          @click="extract">跳过讨论，直接整理设定</button>
        <button type="button" class="m-btn" v-if="retryAvailable && !busy && !pendingIdea" @click="respond">重试回复</button>
        <div class="inspiration-send-group">
          <button type="button" class="inspiration-search-toggle" :class="{ enabled: webSearch }" :aria-pressed="webSearch"
            :title="webSearch ? '已开启联网：允许按需搜索近期事件和背景，查询词可能外发并额外计费；下条消息生效' : '未开启联网；点击开启，下条消息生效'" @click="webSearch = !webSearch">联网{{ webSearch ? '开' : '关' }}</button>
          <div class="inspiration-context-status" :class="{ empty: !contextStatus }" role="status">
            <button type="button" class="inspiration-context-summary" :aria-label="contextTooltip">
              <span class="inspiration-context-ring" :style="{ background: contextRingBackground }" aria-hidden="true"></span>
            </button>
            <div class="inspiration-context-tooltip" role="tooltip">
              <strong>背景信息窗口：</strong>
              <span v-if="!contextStatus">还没有对话内容；聊天越多占用越多，接近上限时自动压缩较早的对话。</span>
              <template v-else>
              <span>{{ contextPercent }}% 已用（剩余 {{ contextRemainingPercent }}%）</span>
              <span>已用 {{ contextLength.toLocaleString() }} 字符，共 {{ INSPIRATION_CONTEXT_BUDGET.toLocaleString() }} 字符</span>
              <span v-if="compacting">{{ compactionProgress }}</span>
              <span v-else-if="compressedMessageCount">已压缩前 {{ compressedMessageCount }} 条消息</span>
              </template>
            </div>
            <progress class="inspiration-context-progress-native" :value="contextPercent" max="100"
              aria-label="灵感对话上下文使用量"></progress>
          </div>
          <button type="button" class="m-btn" v-if="busy" @click="stop"><V3Icon name="stop" size="s" />停止</button>
          <button type="button" class="m-btn pri" v-else :disabled="!input.trim() && !pendingIdea" @click="send">
            <V3Icon name="send" size="s" />发送
          </button>
        </div>
      </div>
    </div>

      </main>
      <InspirationSettingsSummary v-show="!settingsCollapsed" :form="discussionSettings" :busy="busy" :extracting="extracting"
        :can-extract="canExtract" :can-finish="hasSettingsDraft || canExtract" :settings-status="settingsStatus"
        @draft-change="updateDiscussionSettings" @extract="extract" @finish="finish" @collapse="collapseSettingsPanel" />
    </div>
    <SaveChatKnowledge :key="selectedSessionId || 'new'" v-model:show="showKnowledgeDraft" :content="knowledgeDraft" :preferred-ids="knowledgeIds"
      @saved="knowledgeSaved" />
    <V3Modal :show="Boolean(openedReference)" title="知识库原文" size="wide"
      :description="openedReference ? [openedReference.baseName, openedReference.entryTitle, ...openedReference.path].join(' › ') : ''"
      @update:show="openedReference = null">
      <p v-if="referenceExcerpt" class="inspiration-reference-excerpt">{{ referenceExcerpt.before }}<mark>{{ referenceExcerpt.excerpt }}</mark>{{ referenceExcerpt.after }}</p>
      <p v-else>这处原文已更新或移除。请让 AI 重新查阅当前资料。</p>
    </V3Modal>

  </section>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { useDialog, useMessage } from '@/v3/feedback'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import { useConfigStore } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import {
  chatInspiration,
  compactInspirationContext,
  extractInspirationSettings,
  inspirationContextLength,
  inspirationReplyText,
  inspirationSettingsSnapshot,
  parseInspirationSettings,
  INSPIRATION_COMPACT_AT,
  INSPIRATION_CONTEXT_BUDGET,
  type InspirationMessage,
  type InspirationSettingsDraft,
} from '@/services/inspiration'
import type { CreateWizardForm } from '@/types/novel'
import { renderMd } from '@/utils/markdown'
import { formatChatReply } from '@/utils/chatPresentation'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'
import SaveChatKnowledge from '@/components/SaveChatKnowledge.vue'
import InspirationSettingsSummary from '@/components/InspirationSettingsSummary.vue'
import { knowledgeDraftWithSources } from '@/services/softwareAssistantContext'
import type { ChatSearchRecord } from '@/types/chat'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import type { InspirationSession } from '@/services/inspirationSessions'
import { inspirationKnowledgeExcerpt, type InspirationKnowledgeReference } from '@/services/inspirationKnowledge'
import { stopInspirationKnowledgeIndexing } from '@/services/inspirationKnowledgeVectors'

const props = defineProps<{
  form: CreateWizardForm
  active: boolean
  initialIdea?: string
  initialSessionId?: string
  startRequest?: { id: number; idea: string }
  /** 创建入口选的知识库；提供时与入口共用同一份选择 */
  sharedKnowledgeIds?: string[]
}>()
const emit = defineEmits<{
  apply: [form: InspirationSettingsDraft, history: InspirationMessage[]]
  'history-change': [history: InspirationMessage[]]
  'draft-change': [form: InspirationSettingsDraft]
  'knowledge-change': [ids: string[]]
}>()
const config = useConfigStore()
const knowledge = useKnowledgeStore()
const openedReference = ref<InspirationKnowledgeReference | null>(null)
const referenceExcerpt = computed(() => openedReference.value && inspirationKnowledgeExcerpt(knowledge.knowledgeBases, openedReference.value))
const sessionsStore = useInspirationSessionsStore()
const dialog = useDialog()
const message = useMessage()
const history = ref<InspirationMessage[]>([])
const initialForm: CreateWizardForm = JSON.parse(JSON.stringify(props.form))
const discussionSettings = ref<InspirationSettingsDraft>(JSON.parse(JSON.stringify(props.form)))
const hasSettingsDraft = ref(false)
const settingsMessageCount = ref<number>()
let restoreSettingsOnOpen = false
const savedSessions = computed(() => sessionsStore.sessions)
const selectedSessionId = ref<string | null>(null)
let removingSessionId: string | null = null
const historyElement = ref<HTMLElement | null>(null)
const compactPanel = ref<'conversation' | 'settings'>('conversation')
const settingsCollapsed = ref(false)
function showSettingsPanel() {
  settingsCollapsed.value = false
  compactPanel.value = 'settings'
}
async function collapseSettingsPanel() {
  settingsCollapsed.value = true
  compactPanel.value = 'conversation'
  await nextTick()
  headingTools.value?.querySelector<HTMLButtonElement>('[data-open-settings]')?.focus()
}
const input = ref('')
const pendingIdea = ref('')
const importedIdea = ref('')
const canExtract = computed(() => history.value.some(item => item.role === 'user') || !!pendingIdea.value || !!input.value.trim())
const selectedKnowledgeIds = ref<string[] | null>(null)
const knowledgeIds = computed<string[]>({
  get: () => props.sharedKnowledgeIds ? props.sharedKnowledgeIds.filter(id => knowledge.getKB(id))
    : selectedKnowledgeIds.value === null ? knowledge.knowledgeBases.map(base => base.id)
    : selectedKnowledgeIds.value.filter(id => knowledge.getKB(id)),
  set: ids => {
    selectedKnowledgeIds.value = ids || []
    if (props.sharedKnowledgeIds) emit('knowledge-change', [...(ids || [])])
    persistCurrentHistory()
  },
})
const knowledgeOptions = computed(() => knowledge.knowledgeBases.map(base => ({
  label: `${base.name}（${base.entries.length} 条）`, value: base.id,
})))
const headerMenu = ref<'history' | 'knowledge' | null>(null)
const headingTools = ref<HTMLElement | null>(null)
function toggleHeaderMenu(menu: 'history' | 'knowledge') {
  headerMenu.value = headerMenu.value === menu ? null : menu
}
function closeHeaderMenu(event: KeyboardEvent) {
  if (!headerMenu.value) return
  event.stopPropagation()
  headingTools.value?.querySelector<HTMLButtonElement>(
    headerMenu.value === 'history' ? '[data-inspiration-history]' : '[data-heading-knowledge]',
  )?.focus()
  headerMenu.value = null
}
function dismissHeaderMenu(event: MouseEvent) {
  if (headerMenu.value && !headingTools.value?.contains(event.target as Node)) headerMenu.value = null
}
onMounted(() => document.addEventListener('click', dismissHeaderMenu))
onBeforeUnmount(() => document.removeEventListener('click', dismissHeaderMenu))
watch(() => [props.active, knowledgeIds.value.join('\n'), config.embedding.enabled, config.embedding.baseUrl, config.embedding.modelName, config.embedding.apiKey], stopInspirationKnowledgeIndexing, { flush: 'sync' })
onBeforeUnmount(stopInspirationKnowledgeIndexing)
const knowledgeNames = computed(() => knowledgeIds.value.map(id => knowledge.getKB(id)?.name).filter(Boolean).join('、'))
function toggleKnowledge(id: string, checked: boolean) {
  knowledgeIds.value = checked ? [...new Set([...knowledgeIds.value, id])] : knowledgeIds.value.filter(item => item !== id)
}
const showKnowledgeDraft = ref(false)
const knowledgeDraft = ref('')
const saveReminder = ref<{ index: number; title: string }>()
let savingSuggestedReply = false
const composing = ref(false)
const streamText = ref('')
const streamReplyText = computed(() => inspirationReplyText(streamText.value))
function isSaveReceipt(item: InspirationMessage) {
  return item.role === 'assistant' && /^【(?:软件保存回执|保存成功)】/.test(item.content)
}
const latestDiscussionIndex = computed(() => {
  for (let index = history.value.length - 1; index >= 0; index--) {
    if (!isSaveReceipt(history.value[index])) return index
  }
  return -1
})
const suggestedQuestions = computed(() => {
  const latest = history.value[latestDiscussionIndex.value]
  return latest?.role === 'assistant' ? latest.questions || [] : []
})
const settingsStatus = computed(() => {
  if (settingsMessageCount.value === undefined) return hasSettingsDraft.value
    ? '已有设定草稿，可整理当前讨论后再检查。'
    : '当前讨论尚未整理为设定，可先整理，或点击完成后手动补充。'
  return latestDiscussionIndex.value >= settingsMessageCount.value || pendingIdea.value
    ? '有新增讨论待整理，点击完成将带入当前设定。'
    : '设定已整理到最新讨论，点击完成进入详细检查。'
})
const error = ref('')
const busy = ref(false)
const extracting = ref(false)
const extractionProgress = ref('正在整理设定…')
const compacting = ref(false)
const compactionProgress = ref('正在自动压缩较早的对话…')
const conversationContext = ref<InspirationSession['context']>()
const webSearch = ref(false)
const requestWebSearch = ref(false)
const retryAvailable = computed(() => history.value[history.value.length - 1]?.role === 'user')
const turns = computed(() => history.value.flatMap((item, index) => {
  if (item.role !== 'user') return []
  const text = item.content.trim().replace(/\s+/g, ' ')
  return [{ index, preview: text.length > 92 ? text.slice(0, 91) + '…' : text }]
}))
const selectedTurn = ref<number | null>(null)
const hoveredTurn = ref<number | null>(null)
const focusedTurn = ref<number | null>(null)
const latestTurn = computed(() => turns.value[turns.value.length - 1]?.index)
const activeTurn = computed(() => selectedTurn.value ?? latestTurn.value)
const turnPreview = computed(() => turns.value.find(
  turn => turn.index === (hoveredTurn.value ?? focusedTurn.value),
)?.preview)
watch(latestTurn, () => { selectedTurn.value = null })
const expandedReferences = ref(new Set<number>())
function toggleReferences(index: number) {
  if (expandedReferences.value.has(index)) expandedReferences.value.delete(index)
  else expandedReferences.value.add(index)
}
const contextLength = computed(() =>
  inspirationContextLength(history.value, conversationContext.value, discussionSettings.value),
)
const contextPercent = computed(() => Math.min(100, Math.round(
  contextLength.value / INSPIRATION_CONTEXT_BUDGET * 100,
)))
const contextRemainingPercent = computed(() => Math.max(0, 100 - contextPercent.value))
const compressedMessageCount = computed(() => conversationContext.value?.messageCount || 0)
const contextRingBackground = computed(() =>
  `conic-gradient(var(--zhu) ${contextPercent.value}%, var(--line) 0)`,
)
const contextStatus = computed(() => {
  if (!history.value.some(item => item.role === 'user')) return ''
  return `上下文 ${contextLength.value.toLocaleString()} / ${INSPIRATION_CONTEXT_BUDGET.toLocaleString()} 字，接近上限时自动压缩`
})
const contextTooltip = computed(() => [
  `背景信息窗口：${contextPercent.value}% 已用（剩余 ${contextRemainingPercent.value}%）`,
  `已用 ${contextLength.value.toLocaleString()} 字符，共 ${INSPIRATION_CONTEXT_BUDGET.toLocaleString()} 字符`,
  compacting.value ? compactionProgress.value
    : compressedMessageCount.value ? `已压缩前 ${compressedMessageCount.value} 条消息` : '接近上限时自动压缩',
].join('。'))
let controller: AbortController | null = null

let restoring = false

function cloneHistory(messages: InspirationMessage[]): InspirationMessage[] {
  return JSON.parse(JSON.stringify(messages)) as InspirationMessage[]
}

function sessionTitle(messages: InspirationMessage[]): string {
  const firstPrompt = messages.find(message => message.role === 'user')?.content.trim() || '未命名灵感会话'
  return firstPrompt.replace(/\s+/g, ' ').slice(0, 42)
}

function sessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const initialSession = props.initialSessionId
  ? savedSessions.value.find(session => session.id === props.initialSessionId)
  : savedSessions.value[0]
if (initialSession) {
  selectedSessionId.value = initialSession.id
  history.value = cloneHistory(initialSession.messages)
  selectedKnowledgeIds.value = initialSession.knowledgeIds ? [...initialSession.knowledgeIds] : null
  input.value = initialSession.draft
  webSearch.value = initialSession.webSearch
  conversationContext.value = initialSession.context
  restoreDiscussionSettings(initialSession.settingsDraft, initialSession.settingsMessageCount)
}

function restoreDiscussionSettings(snapshot?: string, messageCount?: number) {
  discussionSettings.value = snapshot
    ? parseInspirationSettings(snapshot, { ...initialForm, genre: '', subGenre: '' })
    : JSON.parse(JSON.stringify(initialForm))
  discussionSettings.value.writingMode = props.form.writingMode
  hasSettingsDraft.value = !!snapshot
  settingsMessageCount.value = messageCount
  restoreSettingsOnOpen = true
}

function updateDiscussionSettings(form: InspirationSettingsDraft) {
  discussionSettings.value = { ...JSON.parse(JSON.stringify(form)), writingMode: props.form.writingMode }
  hasSettingsDraft.value = true
  emit('draft-change', JSON.parse(JSON.stringify(discussionSettings.value)))
  persistCurrentHistory()
}

function persistCurrentHistory() {
  if (restoring || !sessionsStore.initialized) return
  if (selectedSessionId.value) {
    if (removingSessionId === selectedSessionId.value || !savedSessions.value.some(session => session.id === selectedSessionId.value)) return
  } else if (!hasSettingsDraft.value && !history.value.some(message => message.role === 'user') && !input.value.trim()) return
  const id = selectedSessionId.value || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  selectedSessionId.value = id
  const next: InspirationSession = {
    id,
    title: history.value.length ? sessionTitle(history.value) : input.value.trim().slice(0, 42) || '新书设定',
    updatedAt: new Date().toISOString(),
    messages: cloneHistory(history.value),
    knowledgeIds: props.sharedKnowledgeIds ? [...knowledgeIds.value] : selectedKnowledgeIds.value === null ? null : [...selectedKnowledgeIds.value],
    draft: input.value,
    webSearch: webSearch.value,
    context: conversationContext.value,
    ...(hasSettingsDraft.value ? { settingsDraft: inspirationSettingsSnapshot(discussionSettings.value) } : {}),
    ...(settingsMessageCount.value === undefined ? {} : { settingsMessageCount: settingsMessageCount.value }),
  }
  const previous = savedSessions.value.find(session => session.id === id)
  if (previous && JSON.stringify({ ...previous, updatedAt: '' }) === JSON.stringify({ ...next, updatedAt: '' })) return
  sessionsStore.upsert(next)
}

function carryInitialIdea() {
  const idea = props.initialIdea?.trim() || ''
  if (!props.active || idea === importedIdea.value) return
  pendingIdea.value = ''
  if (!idea) {
    if (input.value === importedIdea.value) input.value = ''
    importedIdea.value = ''
    return
  }
  if (!history.value.some(item => item.role === 'user' && item.content.includes(idea)) && !input.value.includes(idea)) {
    if (!input.value.trim() || input.value === importedIdea.value) input.value = idea
    else pendingIdea.value = idea
  }
  importedIdea.value = idea
}

function commitPendingIdea(content = '') {
  if (!pendingIdea.value) return
  if (!content.includes(pendingIdea.value)) history.value.push({ role: 'user', content: pendingIdea.value })
  pendingIdea.value = ''
}

function confirmRemoveSession(session: InspirationSession) {
  dialog.warning({
    title: '删除灵感会话',
    content: `确定删除《${session.title}》的对话和草稿吗？已同步的会话也会从云端移除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      removingSessionId = session.id
      try {
        await sessionsStore.remove(session.id)
        if (selectedSessionId.value === session.id) loadSession(null, false)
        headerMenu.value = null
        await nextTick()
        headingTools.value?.querySelector<HTMLButtonElement>('[data-inspiration-history]')?.focus()
      } catch (cause) {
        message.error(errorText(cause, '删除会话失败，请重试'))
        return false
      } finally { removingSessionId = null }
    },
  })
}

function loadSession(id: string | null, preserveCurrent = true) {
  headerMenu.value = null
  if (preserveCurrent) persistCurrentHistory()
  importedIdea.value = preserveCurrent ? '' : props.initialIdea?.trim() || ''
  pendingIdea.value = ''
  restoring = true
  try {
  stop()
  selectedTurn.value = null
  hoveredTurn.value = null
  focusedTurn.value = null
  expandedReferences.value.clear()
  openedReference.value = null
  showKnowledgeDraft.value = false
  saveReminder.value = undefined
  if (!id) {
    selectedSessionId.value = null
    history.value = []
    input.value = ''
    error.value = ''
    selectedKnowledgeIds.value = null
    conversationContext.value = undefined
    webSearch.value = false
    restoreDiscussionSettings()
    return
  }
  const session = savedSessions.value.find(item => item.id === id)
  if (!session) return
  selectedSessionId.value = session.id
  history.value = cloneHistory(session.messages)
  selectedKnowledgeIds.value = Array.isArray(session.knowledgeIds) ? session.knowledgeIds.filter(id => typeof id === 'string') : null
  // 打开以前的讨论时，沿用它当时选的知识库
  if (props.sharedKnowledgeIds && selectedKnowledgeIds.value) emit('knowledge-change', [...selectedKnowledgeIds.value])
  input.value = session.draft
  webSearch.value = session.webSearch
  conversationContext.value = session.context
  restoreDiscussionSettings(session.settingsDraft, session.settingsMessageCount)
  error.value = ''
  void scrollToLatestMessage()
  } finally { restoring = false; activateDiscussionSettings(); carryInitialIdea() }
}

function activateDiscussionSettings() {
  if (!props.active) return
  if (restoreSettingsOnOpen) {
    restoreSettingsOnOpen = false
    discussionSettings.value.writingMode = props.form.writingMode
    emit('draft-change', JSON.parse(JSON.stringify(discussionSettings.value)))
  } else {
    const { titleSuggestions, storyTimeOrigin } = discussionSettings.value
    discussionSettings.value = { ...JSON.parse(JSON.stringify(props.form)), titleSuggestions, storyTimeOrigin }
  }
}

function openKnowledgeDraft(content: string, search?: ChatSearchRecord) {
  headerMenu.value = null
  savingSuggestedReply = false
  knowledgeDraft.value = knowledgeDraftWithSources(content, search)
  showKnowledgeDraft.value = true
}

function openSuggestedKnowledgeDraft(item: InspirationMessage) {
  const references = item.knowledgeReferences?.map(reference =>
    [reference.baseName, reference.entryTitle, ...reference.path].join(' › ')) || []
  const content = [`# ${saveReminder.value?.title}`, item.content,
    references.length ? ['参考知识库原文', ...references.map(reference => '- ' + reference)].join('\n') : ''].filter(Boolean).join('\n\n')
  openKnowledgeDraft(content, item.search)
  savingSuggestedReply = true
}

function knowledgeSaved(result: { kbId: string; kbName: string; title: string }) {
  if (savingSuggestedReply) saveReminder.value = undefined
  savingSuggestedReply = false
  if (selectedKnowledgeIds.value && !selectedKnowledgeIds.value.includes(result.kbId)) {
    selectedKnowledgeIds.value = [...selectedKnowledgeIds.value, result.kbId]
  }
  history.value.push({ role: 'assistant', content: `【保存成功】已保存到知识库“${result.kbName}”，条目“${result.title}”。` })
  persistCurrentHistory()
}

function scrollMessageToStart(target: HTMLElement | null) {
  const container = historyElement.value
  if (!container || !target) return
  // offsetTop may refer to a different positioned ancestor.
  container.scrollTop = Math.max(0, container.scrollTop + target.getBoundingClientRect().top
    - container.getBoundingClientRect().top - container.clientTop - 12)
}

function jumpToTurn(index: number) {
  selectedTurn.value = index
  const container = historyElement.value
  scrollMessageToStart(container?.querySelector<HTMLElement>(`[data-message-index="${index}"]`) || null)
}

async function scrollToLatestMessage() {
  await nextTick()
  if (!props.active || !history.value.length || !historyElement.value) return
  historyElement.value.scrollTop = historyElement.value.scrollHeight
}

async function scrollToReplyStart(request: AbortController, replyIndex: number) {
  await nextTick()
  if (controller !== request || request.signal.aborted || !props.active) return
  const container = historyElement.value
  scrollMessageToStart(container?.querySelector<HTMLElement>(
    `[data-message-index="${replyIndex}"], [data-streaming-assistant], .inspiration-progress`,
  ) || null)
}

function stop() {
  controller?.abort()
  controller = null
  busy.value = false
  extracting.value = false
  compacting.value = false
  streamText.value = ''
}
function handleInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  // IME Enter confirms the selected character, not the whole chat message.
  if (event.isComposing || composing.value || event.keyCode === 229) return
  event.preventDefault()
  if (!event.repeat) send()
}
function send() {
  if (!props.active || busy.value || (!input.value.trim() && !pendingIdea.value)) return
  const content = input.value.trim()
  commitPendingIdea(content)
  if (content) history.value.push({ role: 'user', content })
  persistCurrentHistory()
  input.value = ''
  void respond()
}

function sendSuggestedQuestion(question: string) {
  if (!props.active || busy.value || !suggestedQuestions.value.includes(question)) return
  history.value.push({ role: 'user', content: question })
  persistCurrentHistory()
  void respond()
}

function startDiscussion(idea: string) {
  const content = idea.trim()
  if (!props.active || busy.value || !content
    || history.value.some(item => item.role === 'user' && item.content.includes(content))) return
  history.value.push({ role: 'user', content })
  if (input.value.trim() === content) input.value = ''
  if (pendingIdea.value === content) pendingIdea.value = ''
  persistCurrentHistory()
  void respond()
}

async function respond() {
  if (busy.value) return
  const model = config.getModelForTask('chat')
  if (!model?.apiKey.trim()) { error.value = '请先在设置中配置对话 / 联网模型（默认跟随大纲模型）及有效的 API 密钥，再重试回复'; return }
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  streamText.value = ''
  requestWebSearch.value = webSearch.value
  const replyIndex = history.value.length
  let startedStreaming = false
  void scrollToReplyStart(request, replyIndex)
  try {
    const snapshot = JSON.parse(JSON.stringify(history.value)) as InspirationMessage[]
    if (inspirationContextLength(snapshot, conversationContext.value, discussionSettings.value) >= INSPIRATION_COMPACT_AT) {
      compacting.value = true
      compactionProgress.value = '正在自动压缩较早的对话…'
      const compacted = await compactInspirationContext(
        { ...model },
        snapshot,
        conversationContext.value,
        request.signal,
        (completed, total) => {
          if (controller === request) {
            compactionProgress.value = total
              ? `正在自动压缩上下文：已完成 ${completed}/${total} 批…`
              : '正在整理上下文…'
          }
        },
      )
      if (controller !== request || request.signal.aborted) return
      conversationContext.value = compacted
      persistCurrentHistory()
      compacting.value = false
    }
    const result = await chatInspiration({ ...model }, snapshot, request.signal, chunk => {
      if (controller === request && !request.signal.aborted) {
        streamText.value += chunk
        if (!startedStreaming && streamText.value) {
          startedStreaming = true
          void scrollToReplyStart(request, replyIndex)
        }
      }
    }, requestWebSearch.value, [...knowledgeIds.value], conversationContext.value, JSON.parse(JSON.stringify(discussionSettings.value)))
    if (controller === request && !request.signal.aborted && props.active) {
      // 改用搜索服务的说明只提示一次，不写入对话记录。
      const { fallback, saveTitle, ...reply } = result
      if (fallback) useMessage().info(fallback)
      history.value.push({ role: 'assistant', ...reply })
      saveReminder.value = saveTitle ? { index: history.value.length - 1, title: saveTitle } : undefined
      persistCurrentHistory()
      streamText.value = ''
      await scrollToReplyStart(request, replyIndex)
    }
  } catch (err) {
    if (controller === request && !request.signal.aborted) error.value = errorText(err, '对话失败')
  } finally {
    if (controller === request) stop()
  }
}
async function extract() {
  if (busy.value || !props.active || !canExtract.value) return
  const model = config.getModelForTask('outline')
  if (!model?.apiKey.trim()) { error.value = '请先在设置中配置大纲模型及有效的 API 密钥。'; return }
  commitExtractionInput()
  persistCurrentHistory()
  const request = new AbortController()
  controller = request
  busy.value = extracting.value = true
  error.value = ''
  extractionProgress.value = '正在整理设定…'
  void scrollToReplyStart(request, history.value.length)
  try {
    const base = JSON.parse(JSON.stringify(discussionSettings.value)) as InspirationSettingsDraft
    const snapshot = JSON.parse(JSON.stringify(history.value)) as InspirationMessage[]
    const form = await extractInspirationSettings({ ...model }, snapshot, base, request.signal, (completed, total) => {
      if (controller === request) extractionProgress.value = `正在整理设定：已完成 ${completed}/${total} 步…`
    })
    if (controller !== request || request.signal.aborted || !props.active) return
    extractionProgress.value = '设定已整理，正在压缩已聊内容…'
    const context = await compactInspirationContext({ ...model }, snapshot, undefined, request.signal,
      (completed, total) => {
        if (controller === request) extractionProgress.value = `正在压缩已聊内容：已完成 ${completed}/${total} 批…`
      }, 0)
    if (controller === request && !request.signal.aborted && props.active) {
      conversationContext.value = context
      settingsMessageCount.value = snapshot.length
      updateDiscussionSettings(form)
      persistCurrentHistory()
    }
  } catch (err) {
    if (controller === request && !request.signal.aborted) error.value = errorText(err, '整理失败')
  } finally {
    if (controller === request) stop()
  }
}

function commitExtractionInput() {
  const content = input.value.trim()
  commitPendingIdea(content)
  if (!content) return
  if (content !== importedIdea.value || !history.value.some(item => item.role === 'user' && item.content.includes(content))) {
    history.value.push({ role: 'user', content })
  }
  input.value = ''
}

function finish() {
  if (!props.active || busy.value || (!hasSettingsDraft.value && !canExtract.value)) return
  commitExtractionInput()
  persistCurrentHistory()
  emit('apply', JSON.parse(JSON.stringify(discussionSettings.value)), cloneHistory(history.value))
}

onMounted(() => { void scrollToLatestMessage() })
watch(() => JSON.stringify(props.form), () => {
  if (!props.active || restoreSettingsOnOpen || restoring) return
  const { titleSuggestions, storyTimeOrigin } = discussionSettings.value
  const next = { ...JSON.parse(JSON.stringify(props.form)), titleSuggestions, storyTimeOrigin }
  if (inspirationSettingsSnapshot(next) === inspirationSettingsSnapshot(discussionSettings.value)
    && props.form.writingMode === discussionSettings.value.writingMode) return
  discussionSettings.value = next
  hasSettingsDraft.value = true
  persistCurrentHistory()
})
watch([input, webSearch], persistCurrentHistory, { flush: 'sync' })
watch(() => !!selectedSessionId.value && !savedSessions.value.some(session => session.id === selectedSessionId.value), missing => {
  if (missing && !removingSessionId) loadSession(null, false)
})
watch([() => props.active, () => props.initialIdea], ([active], previous) => {
  if (active) {
    if (!previous?.[0] && props.sharedKnowledgeIds && selectedKnowledgeIds.value && !props.sharedKnowledgeIds.length) {
      emit('knowledge-change', [...selectedKnowledgeIds.value])
    }
    activateDiscussionSettings(); carryInitialIdea(); void scrollToLatestMessage()
  }
  else { stop(); showKnowledgeDraft.value = false; headerMenu.value = null }
}, { immediate: true })
let handledStartRequest = 0
watch([() => props.active, () => props.startRequest], ([active, request]) => {
  if (!active || !request || request.id === handledStartRequest) return
  handledStartRequest = request.id
  startDiscussion(request.idea)
}, { flush: 'post', immediate: true })
watch(history, value => emit('history-change', cloneHistory(value)), { deep: true, immediate: true })
onBeforeUnmount(() => { persistCurrentHistory(); stop() })
</script>

<style scoped>
.inspiration-carried-idea { margin-bottom: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--panel-2); font-size: 12px; }
.inspiration-carried-idea p { margin: 6px 0; max-height: 130px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.inspiration-carried-idea small { color: var(--ink-3); }
.inspiration-chat {
  display: flex; flex-direction: column; flex: 1; width: 100%; min-width: 0; min-height: 0;
  margin: 0 auto; box-sizing: border-box;
}
.inspiration-panel-switch { display: none; }
.inspiration-workspace {
  flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) clamp(232px, 25%, 315px);
  grid-template-rows: minmax(0, 1fr); align-items: start; gap: 12px; min-height: 0;
}
.inspiration-workspace.settings-collapsed { grid-template-columns: minmax(0, 1fr); }
.inspiration-conversation {
  display: flex; flex-direction: column; align-self: stretch; min-width: 0; min-height: 0; padding: 12px 14px;
}
.inspiration-heading {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 7px 12px; padding: 0 0 10px; border-bottom: 1px solid var(--line);
}
.inspiration-heading h2 { margin: 0; font-size: 20px; }
.heading-tools { position: relative; display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; }
.heading-tool {
  display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; padding: 5px 8px;
  border: 1px solid var(--line-2); border-radius: var(--r-s); background: var(--paper);
  color: var(--ink-2); font: 12px/1.45 var(--f-ui); cursor: pointer;
}
.heading-tool span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: clamp(85px, 14vw, 180px); }
.heading-tool .icon { flex: none; }
.heading-tool.on, .heading-tool:hover { border-color: var(--dai); color: var(--dai); background: var(--dai-soft); }
.heading-tool:disabled { opacity: .55; cursor: default; }
.heading-tool[aria-expanded="true"] .tool-chevron, .open-settings-arrow { transform: rotate(180deg); }
.heading-pop {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: min(290px, calc(100vw - 100px));
  max-height: min(55vh, 340px); overflow-y: auto; overscroll-behavior: contain;
  display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line-2);
  border-radius: var(--r-m); background: var(--paper); box-shadow: var(--shadow-2);
}
.heading-pop small, .heading-knowledge-empty { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.55; }
.heading-pop .m-check { min-width: 0; overflow-wrap: anywhere; }
.history-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
.history-delete:hover { color: var(--zhu); border-color: var(--zhu); }
.history-session {
  display: grid; gap: 2px; padding: 7px 9px; border: 1px solid var(--line); border-radius: var(--r-s);
  background: var(--panel); color: var(--ink); text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere;
}
.history-session:hover, .history-session[aria-current="true"] { border-color: var(--zhu); }
.inspiration-reading { position: relative; flex: 1; display: flex; min-width: 0; min-height: 0; }
.inspiration-turns {
  flex: 0 0 28px; display: flex; flex-direction: column; align-items: center; padding: 7px 0;
  margin-right: 7px; overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain; border-right: 1px solid var(--line);
}
.inspiration-turns button {
  flex: none; display: grid; place-items: center; width: 22px; height: 22px;
  padding: 0; border: 0; border-radius: var(--r-s); background: transparent; cursor: pointer;
}
.inspiration-turns button span { width: 12px; height: 3px; border-radius: 4px; background: var(--ink-3); opacity: .55; }
.inspiration-turns button:hover span, .inspiration-turns button:focus-visible span,
.inspiration-turns button[aria-current="true"] span { width: 16px; background: var(--zhu); opacity: 1; }
.inspiration-turns button:focus-visible { outline: 1px solid var(--zhu); outline-offset: -2px; }
.inspiration-turn-preview {
  position: absolute; z-index: 5; left: 34px; top: 7px; max-width: min(250px, calc(100% - 42px)); margin: 0;
  padding: 7px 9px; border-radius: var(--r-s); background: var(--ink); color: var(--paper);
  box-shadow: var(--shadow-2); font: 12px/1.55 var(--f-ui); overflow-wrap: anywhere; pointer-events: none;
}
.inspiration-history {
  flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 4px 6px 12px;
  overscroll-behavior: contain; overflow-anchor: none;
}
.inspiration-message {
  width: fit-content; min-width: 0; max-width: 88%; padding: 12px 14px; margin: 12px 0;
  border: 1px solid var(--line-2); border-radius: var(--r-l); overflow-wrap: anywhere;
}
.inspiration-message > strong { display: block; margin-bottom: 4px; color: var(--ink-2); font-size: 12px; }
.inspiration-message > div:not(.inspiration-reply-actions) { line-height: 1.8; font-size: 14px; overflow-x: auto; }
.inspiration-message.user { margin-left: auto; background: var(--zhu-soft); border-color: transparent; }
.inspiration-message.user > strong { color: var(--zhu); text-align: right; }
.inspiration-message.assistant {
  max-width: calc(100% - 31px); margin-left: 31px; position: relative; background: var(--paper);
}
.inspiration-message.assistant:has(.inspiration-reply-actions) { width: calc(100% - 31px); }
.inspiration-message.assistant::before {
  content: '墨'; position: absolute; top: 4px; left: -31px; display: grid; place-items: center;
  width: 24px; height: 26px; border-radius: 50%; background: var(--zhu);
  color: var(--on-accent); font: 16px var(--f-serif);
}
.inspiration-message.assistant > strong { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.inspiration-message :deep(p + p) { margin-top: 10px; }
.inspiration-message :deep(ul), .inspiration-message :deep(ol) { padding-left: 22px; }
.inspiration-reply-actions {
  display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; justify-items: start; gap: 6px 8px; min-width: 0;
  margin-top: 9px; color: var(--ink-2); font-size: 12px;
}
.inspiration-reply-actions:has(.inspiration-reference-toggle + .inspiration-save-reminder) {
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
}
.inspiration-reply-actions .m-btn {
  height: auto; min-height: 30px; max-width: 100%; padding: 5px 8px;
  align-items: flex-start; white-space: normal; text-align: left; overflow-wrap: anywhere; line-height: 1.5;
}
.inspiration-reply-actions .m-btn .icon { flex: none; margin-top: 2px; }
.inspiration-reference-toggle[aria-expanded="true"] .icon { transform: rotate(90deg); }
.inspiration-reply-actions .inspiration-save-reminder {
  border-color: #bd652b; background: color-mix(in srgb, #ed8d42 17%, var(--paper)); color: var(--ink);
}
.inspiration-reply-actions .inspiration-save-reminder:hover { border-color: #a54e1d; background: color-mix(in srgb, #ed8d42 28%, var(--paper)); }
.inspiration-reply-actions .inspiration-knowledge-references {
  display: grid; gap: 4px; grid-column: 1 / -1; justify-self: stretch; min-width: 0; margin: 0; padding: 5px 8px;
  list-style: none; border: 1px solid var(--line); border-radius: var(--r-s); background: var(--panel);
}
.inspiration-knowledge-references li { min-width: 0; }
.inspiration-reference-excerpt { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
.inspiration-reference-excerpt mark { background: var(--zhu-soft); color: var(--ink); }
.inspiration-composer {
  flex: none; margin-top: 4px; padding: 10px; border: 1px solid var(--line-2);
  border-radius: var(--r-l); background: var(--paper);
}
.inspiration-composer .m-textarea { background: transparent; }
@media (max-width: 850px) {
  .inspiration-panel-switch { display: flex; flex: none; gap: 8px; margin-bottom: 8px; }
  .inspiration-panel-switch button {
    flex: 1; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: var(--r-s);
    background: var(--paper); color: var(--ink-2); font: 12px var(--f-ui); cursor: pointer;
  }
  .inspiration-panel-switch button[aria-pressed="true"] { border-color: var(--zhu); background: var(--zhu-soft); color: var(--zhu); }
  .inspiration-workspace { grid-template-columns: minmax(0, 1fr); }
  .inspiration-workspace:not(.show-settings) > :deep(.inspiration-settings),
  .inspiration-workspace.show-settings > .inspiration-conversation,
  .show-settings-tool { display: none; }
  .inspiration-conversation { padding: 8px; }
}
@media (max-width: 530px) {
  .inspiration-reply-actions:has(.inspiration-reference-toggle + .inspiration-save-reminder) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  }
}
.inspiration-search-toggle { cursor: pointer; flex-shrink: 0; border: 1px solid var(--line-2); border-radius: 100px; padding: 4px 12px; background: var(--paper); color: var(--ink-2); transition: all var(--motion-fast); }
.inspiration-search-toggle:hover { border-color: var(--dai); color: var(--dai); }
.inspiration-search-toggle.enabled { color: var(--dai); border-color: var(--dai); background: var(--dai-soft); }
.inspiration-progress { padding-left: 4px; color: var(--dai); font-size: 12px; line-height: 1.6; }
.inspiration-input-hint { flex: 1 1 auto; margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.inspiration-send-group { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.inspiration-context-status { position: relative; display: inline-flex; align-items: center; color: var(--ink-3); font-size: 11px; line-height: 1; }
.inspiration-context-summary { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
  padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: help; }
.inspiration-context-summary:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.inspiration-context-ring { position: relative; display: inline-block; width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%; }
/* 没有消息时圆环为灰色，但一直显示，避免发第一条消息时挤动旁边按钮 */
.inspiration-context-status.empty .inspiration-context-ring { background: var(--line) !important; opacity: .7; }
.inspiration-context-ring::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--paper); }
.inspiration-context-tooltip { position: absolute; z-index: 5; bottom: calc(100% + 8px); right: 0; display: flex; flex-direction: column; gap: 3px;
  width: max-content; max-width: min(280px, calc(100vw - 160px)); padding: 9px 11px; border-radius: 9px;
  background: var(--ink); color: var(--paper); box-shadow: var(--shadow-2);
  font-size: 11px; line-height: 1.45; opacity: 0; pointer-events: none; transform: translateY(3px);
  transition: opacity 120ms ease, transform 120ms ease; white-space: normal; overflow-wrap: anywhere; }
.inspiration-context-tooltip strong { color: inherit; font-weight: 600; }
.inspiration-context-status:hover .inspiration-context-tooltip,
.inspiration-context-summary:focus + .inspiration-context-tooltip { opacity: 1; transform: translateY(0); }
.inspiration-context-progress-native { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; clip-path: inset(50%); }
.inspiration-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; clip-path: inset(50%); }
.inspiration-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.inspiration-follow-ups { display: grid; gap: 8px; margin: 12px 0 8px 42px; }
.inspiration-follow-ups > span { color: var(--ink-3); font-size: 12px; }
.inspiration-follow-ups button { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 12px; border: 1px solid var(--line-2); border-radius: var(--r-m); background: var(--paper);
  color: var(--ink-2); font: 13px/1.6 var(--f-ui); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.inspiration-follow-ups button:hover { border-color: var(--zhu); color: var(--zhu); }
.inspiration-follow-ups button:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.inspiration-follow-ups button > span { flex-shrink: 0; color: var(--ink-3); }
.inspiration-error { color: var(--zhu); margin-top: 8px; overflow-wrap: anywhere; }
.inspiration-empty-guide { margin: auto; max-width: 440px; text-align: center; padding: 28px; color: var(--ink-2); }
.inspiration-empty-guide > .icon { color: var(--dai); margin-bottom: 16px; }
.inspiration-empty-guide h3 { font-size: 24px; color: var(--ink); margin-bottom: 8px; }
.inspiration-empty-guide p { font-size: 14px; line-height: 1.8; }
.inspiration-empty-guide > div { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 24px; }
.inspiration-empty-guide button { padding: 8px 12px; border: 1px solid var(--line-2); border-radius: var(--r-m); background: var(--paper); color: var(--dai); font: 13px var(--f-ui); cursor: pointer; }
.inspiration-empty-guide button:hover { border-color: var(--dai); }
</style>
