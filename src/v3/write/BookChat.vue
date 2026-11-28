<template>
  <div class="book-chat" id="ai-chat-assistant">
    <div id="ai-chat-window" class="chat-window" role="region" aria-label="AI 对话助手">
      <header class="chat-header">
        <div class="chat-header-title">
          <strong>书内对话</strong>
          <span v-if="webSearch" class="chat-mode-tag">联网已开</span>
        </div>
        <div class="chat-header-actions">
          <button type="button" class="chat-search-btn" :class="{ enabled: webSearch }" :aria-pressed="webSearch"
            :title="webSearch ? '关闭联网搜索（下条消息生效）' : '开启联网搜索（下条消息生效）'"
            @click="toggleSearch">联网{{ webSearch ? '开' : '关' }}</button>
          <button type="button" class="chat-icon-btn" :disabled="thinking"
            :title="thinking ? '请先停止请求再清空记录' : '清空记录'" @click="clearHistory">清空</button>
        </div>
      </header>

      <p v-if="webSearch || thinking" class="chat-search-notice">
        {{ webSearch
          ? '允许按需联网搜索；查询词可能外发并额外计费。'
          : '未启用网页搜索；AI 对话仍需调用已配置 API。' }}{{ thinking ? ' 开关修改下条生效。' : '' }}
      </p>

      <div class="chat-messages" ref="messagesRef">
        <!-- 欢迎与快捷提问 -->
        <div v-if="messages.length === 0 && !adviceResult && !adviceLoading" class="chat-welcome">
          <p class="welcome-title">我是本书的写作助手</p>
          <p class="chat-hint">这里是独立的书内对话，会参考已确认设定与当前草稿，不会直接修改正文。</p>
          <button v-if="chapterId" type="button" class="welcome-direction-cta"
            :disabled="thinking || adviceLoading" @click="emit('request-directions')">
            <span class="cta-mark">✦</span>
            <span>{{ hasDraftContent ? '这段接下来怎么写（给我两个走法）' : '按章纲想两个开场' }}</span>
          </button>
          <div class="quick-actions">
            <button type="button" @click="quickAsk('帮我分析一下当前的剧情走向')">分析剧情</button>
            <button type="button" @click="quickAsk('给我一些关于下一章的写作建议')">写作建议</button>
            <button type="button" @click="quickAsk('帮我检查人物性格是否一致')">角色一致性</button>
            <button type="button" @click="quickAsk('当前有哪些全书规划需要推进或收束')">全书规划</button>
            <button type="button" @click="crossChapterAnalysis">跨章节分析</button>
            <button type="button" @click="wholeBookAnalysis">全书评估</button>
          </div>
        </div>

        <!-- 普通对话消息列表 -->
        <div v-for="msg in messages" :key="msg.id" class="chat-msg" :class="[msg.role, { receipt: isSaveReceipt(msg) }]">
          <template v-if="isSaveReceipt(msg)">
            <div class="receipt-card" role="status">
              <span class="receipt-badge">保存成功</span>
              <span class="receipt-text">{{ receiptBody(msg.content) }}</span>
            </div>
          </template>
          <template v-else>
            <div v-if="msg.role === 'user'" class="msg-avatar">我</div>
            <img v-else :src="mojianIcon" alt="墨" class="msg-avatar msg-avatar-seal" />
            <div class="msg-bubble">
              <div class="msg-content" v-html="renderMd(msg.role === 'assistant' ? formatChatReply(msg.content, msg.search) : msg.content)"></div>
              <ChatSearchEvidence :record="msg.search" />
              <div v-if="msg.role === 'assistant' && !msg.failed" class="msg-actions">
                <button type="button" class="action-btn" title="复制内容" @click="copyContent(formatChatReply(msg.content, msg.search))">复制</button>
                <button type="button" class="action-btn" :disabled="thinking" @click="openKnowledgeDraft(msg.content, msg.search)">存入知识库</button>
              </div>
            </div>
          </template>
        </div>

        <!-- AI 正在流式回复 -->
        <div v-if="thinking" class="chat-msg assistant">
          <img :src="mojianIcon" alt="墨" class="msg-avatar msg-avatar-seal" />
          <div class="msg-bubble">
            <div v-if="streamText" class="msg-content" v-html="renderMd(streamText)"></div>
            <div v-else class="msg-content thinking-dots" :aria-label="webSearch ? '正在请求联网回复' : '正在回复'">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <!-- 合并自「顾问」的单次结构化下一步方向卡（不修改正文，可原地追问或落库） -->
        <section v-if="adviceLoading || adviceError || adviceResult" class="direction-thread" aria-label="下一步写作方向">
          <div v-if="adviceLoading" class="direction-loading">
            <span class="dir-spinner" aria-hidden="true"></span>
            <span>正在结合当前草稿与章纲构思两个走法…</span>
            <button type="button" class="action-btn" @click="emit('stop-directions')">停止</button>
          </div>

          <p v-if="adviceError && !adviceStale" class="direction-alert" role="alert">{{ adviceError }}</p>

          <template v-if="adviceResult">
            <div class="direction-head">
              <strong>✦ {{ hasDraftContent ? '接下来可以这样写' : '两个开场方向' }}</strong>
              <span class="direction-head-actions">
                <button type="button" class="action-btn" :disabled="adviceLoading" @click="emit('request-directions')">换两个</button>
                <button type="button" class="action-btn" :disabled="adviceLoading" @click="emit('clear-directions')">收起</button>
              </span>
            </div>
            <p v-if="adviceStale" class="direction-stale" role="alert">正文或参考资料已变化，保存前请重新生成。</p>
            <p v-if="adviceResult.contextSummary" class="direction-ctx">参考：{{ adviceResult.contextSummary }}</p>

            <article v-for="(item, idx) in adviceResult.suggestions" :key="item.id" class="direction-card">
              <div class="direction-card-head">
                <span class="dir-kind">{{ kindLabel(item.kind) }}</span>
                <strong>{{ idx + 1 }}. {{ item.title }}</strong>
              </div>
              <p v-if="item.nextBeat" class="dir-beat"><b>下一拍：</b>{{ item.nextBeat }}</p>
              <p class="dir-approach">{{ item.approach }}</p>
              <p v-if="item.evidence[0]" class="dir-evidence">
                <b>依据（{{ item.evidence[0].sourceLabel }}）：</b>{{ item.evidence[0].excerpt }}
              </p>
              <p v-if="item.risk && item.risk !== '无' && item.risk !== '无明显风险'" class="dir-risk">
                <b>注意：</b>{{ item.risk }}
              </p>
              <div class="direction-actions">
                <button type="button" class="action-btn follow-btn" :disabled="thinking" @click="followDirection(item)">沿着聊</button>
                <button type="button" class="action-btn" :disabled="adviceSaving || adviceStale"
                  @click="emit('save-direction', { action: 'note', suggestion: item })">记入本章笔记</button>
                <button type="button" class="action-btn" :disabled="adviceSaving || adviceStale"
                  @click="emit('save-direction', { action: 'plan', suggestion: item })">存为下一章计划</button>
                <button type="button" class="action-btn" @click="emit('copy-direction', item)">复制</button>
              </div>
            </article>
          </template>
        </section>
      </div>

      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>

      <!-- 宽大舒适的底部输入区（全宽多行输入框 + 快捷方向入口 + 底栏发送） -->
      <div class="chat-composer">
        <div v-if="chapterId && (messages.length > 0 || adviceResult)" class="composer-shortcuts">
          <button type="button" class="composer-dir-chip" :disabled="thinking || adviceLoading"
            @click="emit('request-directions')">
            ✦ {{ hasDraftContent ? '这段接下来怎么写' : '按章纲想两个开场' }}
          </button>
        </div>

        <div class="chat-input-box">
          <textarea
            ref="inputRef"
            v-model="inputText"
            class="chat-input"
            rows="4"
            maxlength="12000"
            aria-label="向 AI 提问"
            placeholder="输入问题、卡文处或修改想法，Enter 发送，Shift+Enter 换行"
            @keydown.enter="handleSendKeydown"
          />
          <div class="chat-input-foot">
            <span class="chat-scope" :title="scopeLabel">范围：{{ scopeLabel }}</span>
            <button v-if="thinking" type="button" class="m-btn sm" @click="stop">停止</button>
            <button v-else type="button" class="m-btn sm zhu" :disabled="!inputText.trim()" @click="sendMessage">发送</button>
          </div>
        </div>
      </div>
    </div>

    <SaveChatKnowledge :key="novelId" v-model:show="showKnowledgeDraft" :content="knowledgeDraft"
      mode="book" :book-title="novel?.title" :preferred-ids="novel?.knowledgeBaseIds || []" @saved="knowledgeSaved" />
  </div>
</template>

<script setup lang="ts">
import { getCurrentChapterSummary } from '@/services/derivedSources'
import { computed, ref, nextTick, watch } from 'vue'
import { useDialog, useMessage } from '@/v3/feedback'
import { useAssistantChat } from '@/composables/useAssistantChat'
import { useNovelStore } from '@/stores/novel'
import SaveChatKnowledge from '@/components/SaveChatKnowledge.vue'
import { knowledgeDraftWithSources } from '@/services/softwareAssistantContext'
import type { ChatSearchRecord } from '@/types/chat'
import type { WritingAdviceKind, WritingAdviceResult, WritingAdviceSuggestion } from '@/services/writingAdvisor'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'
import { renderMd } from '@/utils/markdown'
import { formatChatReply } from '@/utils/chatPresentation'
import mojianIcon from '@/assets/v3/mojian-icon.svg'

const props = defineProps<{
  novelId: string
  chapterId?: string
  draftContent?: string
  prefill?: string
  prefillVersion?: number
  adviceResult?: WritingAdviceResult | null
  adviceLoading?: boolean
  adviceStale?: boolean
  adviceSaving?: boolean
  adviceError?: string
}>()

const emit = defineEmits<{
  'request-directions': []
  'stop-directions': []
  'clear-directions': []
  'save-direction': [payload: { action: 'note' | 'plan'; suggestion: WritingAdviceSuggestion }]
  'copy-direction': [suggestion: WritingAdviceSuggestion]
}>()

const dialog = useDialog()
const message = useMessage()
const store = useNovelStore()
const draftReader = props.draftContent !== undefined ? () => props.draftContent ?? '' : undefined
const { novel, messages, webSearch, inputText, thinking, streamText, error, sendMessage, stop, toggleSearch, clear, quickAsk } = useAssistantChat(
  () => props.novelId,
  () => props.chapterId || '',
  draftReader,
)

const messagesRef = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const showKnowledgeDraft = ref(false)
const knowledgeDraft = ref('')

const hasDraftContent = computed(() => {
  if (props.draftContent !== undefined) return Boolean(props.draftContent.trim())
  const chapter = props.chapterId ? novel.value?.chapters.find(item => item.id === props.chapterId) : undefined
  return Boolean(chapter?.content?.trim())
})

const KIND_LABELS: Record<WritingAdviceKind, string> = {
  conflict: '冲突',
  investigation: '推进',
  relationship: '关系',
  revelation: '揭示',
  scene: '场景',
  pacing: '节奏',
}
const kindLabel = (kind: WritingAdviceKind) => KIND_LABELS[kind] || '方向'

function followDirection(item: WritingAdviceSuggestion) {
  const beat = item.nextBeat ? `（下一拍：${item.nextBeat}）` : ''
  inputText.value = `沿着「${item.title}」${beat}这个思路继续讨论，不要代写正文：`
  void nextTick(() => {
    inputRef.value?.focus()
    const len = inputText.value.length
    inputRef.value?.setSelectionRange?.(len, len)
  })
}

function openKnowledgeDraft(content: string, search?: ChatSearchRecord) {
  knowledgeDraft.value = knowledgeDraftWithSources(content, search)
  showKnowledgeDraft.value = true
}

function isSaveReceipt(msg: { role: string; content: string }) {
  return msg.role === 'assistant' && /^【(?:软件保存回执|保存成功)】/.test(msg.content)
}

function receiptBody(content: string) {
  return content.replace(/^【(?:软件保存回执|保存成功)】\s*/, '')
}

function knowledgeSaved(result: { kbId: string; kbName: string; title: string; entryTitle?: string }) {
  if (novel.value && !novel.value.knowledgeBaseIds.includes(result.kbId)) {
    store.bindKnowledgeBase(props.novelId, result.kbId)
  }
  store.addChatMessage(props.novelId, {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: `【保存成功】已归档到知识库“${result.kbName}”${result.entryTitle ? ` · ${result.entryTitle}` : ''}，目录项「${result.title}」，并已挂载供本书参考。`,
    timestamp: new Date().toISOString(),
  })
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
}

function clearHistory() {
  dialog.warning({
    title: '清空对话记录',
    content: '只清空当前小说的书内助手对话，不影响灵感记录、正文和设定。确定继续吗？',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: clear,
  })
}

async function copyContent(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  }
  catch { error.value = '复制失败，请选中文本手动复制。' }
}

// Enter 发送，Shift+Enter 换行；输入法组字时不发送。
function handleSendKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey) return
  event.preventDefault()
  if (thinking.value || !inputText.value.trim()) return
  void sendMessage()
}

const scopeLabel = computed(() => {
  const chapter = props.chapterId ? novel.value?.chapters.find(item => item.id === props.chapterId) : undefined
  if (!chapter) return '全书已确认设定与章节摘要'
  return chapter.chapterIndex > 0 ? `第1–${chapter.chapterIndex}章摘要 + 本章草稿` : '已确认设定 + 本章草稿'
})

watch(() => [messages.value.length, streamText.value, thinking.value, props.adviceLoading, props.adviceResult?.generatedAt], scrollToBottom)
watch(() => props.novelId, () => { showKnowledgeDraft.value = false })
watch([() => props.prefill, () => props.prefillVersion], (values, previousValues) => {
  const value = values[0]
  const previous = previousValues?.[0]
  if (value) {
    inputText.value = value
    void nextTick(() => inputRef.value?.focus())
  } else if (previous && inputText.value === previous) {
    inputText.value = ''
  }
}, { immediate: true })

function crossChapterAnalysis() {
  if (!novel.value) return
  const chapSummaries = novel.value.chapters
    .filter(c => getCurrentChapterSummary(c))
    .map(c => `第${c.chapterIndex + 1}章《${c.title}》: ${getCurrentChapterSummary(c).substring(0, 100)}`)
    .join('\n')
  inputText.value = `请分析以下章节之间的连贯性和可能的问题（节奏、角色表现不一致、剧情漏洞等），并给出具体修改建议：\n\n${chapSummaries || '（暂无章节总结，请先完成一些章节）'}`
  void sendMessage()
}

function wholeBookAnalysis() {
  if (!novel.value) return
  const info = [
    `书名：${novel.value.title}`,
    `类型：${novel.value.genreLabel}/${novel.value.subGenreLabel}`,
    `进度：${novel.value.chapters.length}章 / ${novel.value.currentWordCount}字`,
    `目标：${novel.value.targetWordCountMin}~${novel.value.targetWordCountMax}万字`,
    novel.value.outline ? `大纲摘要：${novel.value.outline.substring(0, 300)}` : '',
  ].filter(Boolean).join('\n')
  inputText.value = `请对这本小说进行全面评估，包括：
1. 整体节奏评估（是否合理）
2. 角色发展弧线评估
3. 剧情张力分析
4. 待回收伏笔梳理
5. 后续写作建议\n\n${info}`
  void sendMessage()
}
</script>

<style scoped>
.book-chat {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.chat-window {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  overflow: hidden;
}

.chat-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.chat-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-header-title strong {
  font: 600 14px var(--f-serif);
  color: var(--ink);
}

.chat-mode-tag {
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--zhu-soft);
  color: var(--zhu);
  font-size: 12px;
  font-weight: 600;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-search-btn {
  padding: 3px 9px;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  cursor: pointer;
  font-size: 12px;
  background: var(--paper);
  color: var(--ink-2);
}
.chat-search-btn.enabled {
  color: var(--zhu);
  border-color: var(--zhu);
  background: var(--zhu-soft);
}

.chat-icon-btn {
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-3);
  padding: 3px 7px;
  border-radius: 6px;
}
.chat-icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--ink);
}
.chat-icon-btn:disabled { opacity: .45; cursor: not-allowed; }

.chat-search-notice {
  flex: none;
  margin: 0;
  padding: 6px 14px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}

/* 消息区 */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-welcome {
  text-align: center;
  padding: 16px 6px 8px;
  color: var(--ink-3);
  font-size: 13px;
  display: grid;
  gap: 10px;
  justify-items: center;
}
.welcome-title { margin: 0; font: 600 15px var(--f-serif); color: var(--ink); }
.chat-hint { margin: 0; font-size: 13px; line-height: 1.65; max-width: 300px; }

.welcome-direction-cta {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 14px;
  border: 1px solid var(--zhu);
  border-radius: 9px;
  background: color-mix(in srgb, var(--zhu) 8%, var(--paper));
  color: var(--zhu);
  font: 600 13px/1.4 var(--f-ui);
  cursor: pointer;
  transition: background .15s;
}
.welcome-direction-cta:hover:not(:disabled) { background: var(--zhu-soft); }
.welcome-direction-cta:disabled { opacity: .45; cursor: not-allowed; }
.cta-mark { font-size: 14px; }

.quick-actions {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 2px;
}

.quick-actions button {
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.quick-actions button:hover {
  border-color: var(--zhu);
  color: var(--zhu);
}

/* 消息气泡 */
.chat-msg {
  display: flex;
  gap: 9px;
  max-width: 95%;
}
.chat-msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.chat-msg.receipt {
  max-width: 100%;
  width: 100%;
}
.receipt-card {
  display: flex;
  align-items: baseline;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--qing) 30%, var(--line));
  border-radius: 8px;
  background: var(--qing-soft);
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-2);
}
.receipt-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--qing);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.receipt-text { min-width: 0; overflow-wrap: anywhere; }

.msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  background: var(--paper);
  border: 1px solid var(--line);
  color: var(--ink-2);
}
.chat-msg.user .msg-avatar { background: var(--zhu-soft); border-color: transparent; color: var(--zhu); }
.chat-msg.assistant .msg-avatar { background: transparent; border: 0; border-radius: 7px; object-fit: cover; display: block; }

.msg-bubble {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.msg-content {
  padding: 10px 13px;
  border-radius: 11px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--ink);
}
.chat-msg.user .msg-content {
  background: var(--zhu-solid);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.chat-msg.assistant .msg-content {
  background: var(--paper);
  border: 1px solid var(--line);
  border-left: 3px solid var(--dai);
  border-bottom-left-radius: 4px;
}
.msg-content :deep(strong) { color: var(--zhu); }
.msg-content :deep(li) { margin-left: 14px; margin-bottom: 2px; }

.thinking-dots { display: flex; gap: 4px; align-items: center; padding: 12px 16px; }
.thinking-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); animation: dot-bounce 1.4s ease-in-out infinite; }
.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dot-bounce { 0%, 80%, 100% { transform: scale(0.6); } 40% { transform: scale(1); } }

.msg-actions { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }

.action-btn {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid var(--line-2);
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink-2);
  cursor: pointer;
  transition: border-color .15s, color .15s, background .15s;
}
.action-btn:hover:not(:disabled) {
  border-color: var(--zhu);
  color: var(--zhu);
  background: var(--zhu-soft);
}
.action-btn:disabled { opacity: .45; cursor: not-allowed; }
.action-btn.follow-btn {
  border-color: var(--zhu);
  color: var(--zhu);
  font-weight: 600;
}

/* 内嵌结构化方向卡（合并自原顾问面板） */
.direction-thread {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--paper);
}
.direction-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.direction-loading span:nth-child(2) { flex: 1; }
.dir-spinner {
  width: 14px;
  height: 14px;
  flex: none;
  border: 2px solid var(--line-2);
  border-top-color: var(--zhu);
  border-radius: 50%;
  animation: dir-spin .8s linear infinite;
}
@keyframes dir-spin { to { transform: rotate(360deg); } }
.direction-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.direction-head strong {
  font: 600 13px var(--f-serif);
  color: var(--zhu);
}
.direction-head-actions { display: flex; gap: 5px; }
.direction-ctx {
  margin: 0;
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.5;
}
.direction-alert {
  margin: 0;
  padding: 7px 9px;
  border-left: 3px solid var(--zhu);
  background: var(--zhu-soft);
  color: var(--zhu);
  font-size: 12px;
  line-height: 1.5;
}
.direction-stale {
  margin: 0;
  padding: 6px 9px;
  border-left: 3px solid var(--jin);
  background: var(--jin-soft);
  color: var(--jin);
  font-size: 12px;
  line-height: 1.5;
}
.direction-card {
  display: grid;
  gap: 6px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}
.direction-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--ink);
}
.dir-kind {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dai-soft);
  color: var(--dai);
  font-size: 12px;
  font-weight: 600;
}
.dir-beat {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--paper);
  border: 1px solid var(--line);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink);
}
.dir-approach {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ink-2);
}
.dir-evidence, .dir-risk {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-3);
}
.dir-risk b { color: var(--jin); }
.direction-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.direction-actions .m-btn.xs {
  padding: 3px 6px;
  font-size: 12px;
}

.chat-error {
  max-height: 70px;
  overflow-y: auto;
  flex: none;
  color: var(--zhu);
  font-size: 12px;
  margin: 0;
  padding: 6px 14px;
}

/* 宽大舒适的底部输入区（全宽多行输入框） */
.chat-composer {
  flex: none;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  display: grid;
  gap: 7px;
}
.composer-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.composer-dir-chip {
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--zhu) 45%, var(--line));
  border-radius: 14px;
  background: var(--paper);
  color: var(--zhu);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.composer-dir-chip:hover:not(:disabled) { background: var(--zhu-soft); }
.composer-dir-chip:disabled { opacity: .45; cursor: not-allowed; }

.chat-input-box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--paper);
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
}
.chat-input-box:focus-within {
  border-color: var(--zhu);
  box-shadow: 0 0 0 3px var(--zhu-soft);
}

.chat-input {
  width: 100%;
  min-height: 96px;
  max-height: 240px;
  resize: vertical;
  border: 0;
  outline: none;
  padding: 10px 12px 6px;
  background: transparent;
  color: var(--ink);
  font: 13.5px/1.65 var(--f-ui);
}

.chat-input-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 8px 12px;
  border-top: 1px dashed var(--line);
}

.chat-scope {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-3);
  font-size: 12px;
}
</style>
