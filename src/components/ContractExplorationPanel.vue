<template>
  <aside class="explore" aria-label="探索对话">
    <header class="explore-head">
      <h3>探索对话</h3>
      <span>第 {{ turnCount }} 轮</span>
    </header>
    <div ref="messagesEl" class="messages" tabindex="0" aria-live="polite" aria-label="对话消息">
      <div class="messages-inner">
        <p v-if="!state.messages.length" class="empty">补充你的想法，或让 AI 从类型、主角和冲突开始追问。建议可以逐卡采用，再由你确认。</p>
        <article v-for="item in state.messages" :key="item.id" class="message" :class="item.role">
          <b class="msg-speaker"><img v-if="item.role !== 'user'" :src="mojianIcon" alt="" aria-hidden="true" class="speaker-seal" /><span>{{ item.role === 'user' ? '你' : '策划搭档' }}</span></b>
          <p>{{ item.reply || (item.status === 'running' ? '正在整理建议…' : item.content || '本轮没有返回可用内容') }}</p>
          <small v-if="!['completed', 'running'].includes(item.status)" class="status-note">本轮{{ item.status === 'failed' ? '失败' : item.status === 'interrupted' ? '中断' : '未完整完成' }}，输出已保留</small>
          <div v-if="item.status === 'completed' && item.suggestions?.length" class="suggestion-groups">
            <section v-for="group in groupedSuggestions(item.suggestions)" :key="group.cardId" class="suggestion-group">
              <h4>{{ cardTitle(group.cardId) }}{{ group.items.length > 1 ? '备选' : '候选' }}</h4>
              <div class="options" :class="{ single: group.items.length === 1 }">
                <article v-for="(suggestion, idx) in group.items" :key="idx" class="option">
                  <strong v-if="group.items.length > 1">备选 {{ idx + 1 }}</strong>
                  <p v-if="suggestion.explanation" class="option-explain">{{ suggestion.explanation }}</p>
                  <p v-for="(value, key) in suggestion.values" :key="key" class="option-value">
                    {{ formatSuggestionValue(value) }}
                  </p>
                  <div class="option-actions">
                    <button type="button" class="adopt-btn" :disabled="disabled || busy" @click="emit('adopt', suggestion)">采用到卡片，等待确认</button>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </article>
      </div>
    </div>
    <p v-if="errorText" class="error" role="alert">{{ errorText }}</p>
    <form class="compose" @submit.prevent="send">
      <div class="compose-inner">
        <textarea aria-label="探索对话输入" :value="state.input" :disabled="disabled || busy" rows="2"
          placeholder="继续补充，或让 AI 追问……"
          @input="setInput(($event.target as HTMLTextAreaElement).value)"
          @keydown="handleKeydown"></textarea>
        <div class="compose-actions">
          <span class="keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
          <button v-if="busy" type="button" class="send-btn stop" @click="controller?.abort()">停止并保留输出</button>
          <button v-else type="submit" class="send-btn primary" :disabled="disabled || !state.input.trim()">发送</button>
        </div>
      </div>
    </form>
  </aside>
</template>
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'
import { contractCards, parseContractExploration, upgradeContractSuggestions } from '@/services/storyContract'
import { prepareContractExploration } from '@/services/contractExploration'
import type { ContractExploration, ContractSuggestion, StoryContract } from '@/types/reconstruction'
import mojianIcon from '@/assets/v3/mojian-icon.svg'

const props = defineProps<{ contract: StoryContract; exploration?: ContractExploration; knowledgeIds?: string[]; disabled?: boolean; flush?: () => Promise<void> }>()
const emit = defineEmits<{ change: [value: ContractExploration]; busy: [value: boolean]; adopt: [suggestion: ContractSuggestion] }>()
function copy(value: ContractExploration): ContractExploration {
  const next: ContractExploration = JSON.parse(JSON.stringify(value))
  for (const item of next.messages) if (item.suggestions) item.suggestions = upgradeContractSuggestions(item.suggestions)
  return next
}
const state = ref(copy(props.exploration || { input: '', messages: [] }))
watch(() => props.exploration, value => {
  if (value && JSON.stringify(value) !== JSON.stringify(state.value)) state.value = copy(value)
})
const config = useConfigStore()
const busy = ref(false)
const errorText = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const turnCount = computed(() => state.value.messages.filter(item => item.role === 'user').length)
const cardTitle = (id: string) => contractCards.find(card => card.id === id)?.title || '契约'

function groupedSuggestions(suggestions: ContractSuggestion[]) {
  const groups: Array<{ cardId: string; items: ContractSuggestion[] }> = []
  for (const suggestion of suggestions) {
    let group = groups.find(item => item.cardId === suggestion.cardId)
    if (!group) { group = { cardId: suggestion.cardId, items: [] }; groups.push(group) }
    group.items.push(suggestion)
  }
  return groups
}

function formatSuggestionValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('、')
  if (value === 'serial') return '连载'
  if (value === 'complete') return '完结作品'
  if (value === 'undecided') return '暂不确定'
  return String(value ?? '')
}

let controller: AbortController | undefined
let disposed = false
function publish() { emit('change', copy(state.value)) }
function setInput(value: string) { state.value.input = value; publish() }
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}
async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
async function send() {
  if (busy.value || props.disabled || !state.value.input.trim()) return
  const model = config.getModelForTask('chat')
  if (!model) { errorText.value = '请先在设置中配置对话模型'; return }
  const baseline: StoryContract = JSON.parse(JSON.stringify(props.contract))
  state.value.messages.push({ id: crypto.randomUUID(), role: 'user', content: state.value.input.trim(), status: 'completed' })
  const exploration = copy(state.value)
  const knowledgeIds = [...(props.knowledgeIds || [])]
  const assistant: ContractExploration['messages'][number] = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'running' }
  state.value.messages.push(assistant)
  const output = () => state.value.messages.find(item => item.id === assistant.id)!
  state.value.input = ''
  busy.value = true; emit('busy', true); errorText.value = ''
  const requestController = new AbortController()
  controller = requestController
  let lastCheckpoint = 0
  publish()
  void scrollToBottom()
  try {
    await props.flush?.()
    requestController.signal.throwIfAborted()
    const messages = await prepareContractExploration(model, baseline, exploration, knowledgeIds, requestController.signal)
    const response = await callAI({ model: { ...model }, messages, signal: requestController.signal, taskName: '作品契约探索', noAutomaticRetry: true,
      onChunk: chunk => {
        output().content += chunk
        if (Date.now() - lastCheckpoint > 600) { publish(); lastCheckpoint = Date.now() }
      } })
    requestController.signal.throwIfAborted()
    output().content = response.content
    if (response.finishReason && response.finishReason !== 'stop') throw new Error('探索输出未完整结束，请检查已保留的内容后重试')
    const parsed = parseContractExploration(response.content, baseline)
    Object.assign(output(), parsed, { status: 'completed' })
  } catch (error) {
    output().status = requestController.signal.aborted ? 'interrupted' : output().content ? 'partial' : 'failed'
    errorText.value = safeAiErrorMessage(error, [model.apiKey])
  } finally {
    publish()
    void scrollToBottom()
    try { await props.flush?.() } catch { errorText.value = '探索记录尚未保存，请使用页面的重试保存操作' }
    busy.value = false
    emit('busy', false)
    if (disposed) controller = undefined
  }
}
onUnmounted(() => { disposed = true; controller?.abort() })
</script>
<style scoped>
.explore {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}
.explore-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 54px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--line);
}
.explore-head h3 { margin: 0; font: 700 17px/1.35 var(--f-serif); color: var(--ink); }
.explore-head span { color: var(--ink-3); font-size: 12px; }
.messages { min-height: 0; padding: 16px 20px 20px; overflow: auto; overscroll-behavior: contain; }
.messages-inner { display: grid; gap: 14px; width: 100%; }
.empty { margin: 0; color: var(--ink-3); font-size: 13px; line-height: 1.75; }
.message { min-width: 0; font-size: 13.5px; line-height: 1.72; overflow-wrap: anywhere; }
.message b { display: block; margin-bottom: 5px; color: var(--ink-3); font-size: 12px; font-weight: 600; }
.message .msg-speaker { display: inline-flex; align-items: center; gap: 6px; }
.speaker-seal { width: 20px; height: 20px; border-radius: 5px; object-fit: cover; display: block; flex: none; }
.message p { margin: 0; white-space: pre-wrap; }
.message p + p { margin-top: 7px; }
.message.user {
  justify-self: end;
  max-width: 88%;
  padding: 9px 14px;
  border: 1px solid color-mix(in srgb, var(--zhu) 22%, var(--line));
  border-radius: 10px 10px 2px 10px;
  background: var(--zhu-soft);
}
.message.assistant {
  width: 100%;
  padding: 13px 15px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.status-note, .error { color: var(--jin); font-size: 12px; }
.status-note { display: block; margin-top: 6px; }
.error { margin: 0; padding: 6px 16px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--jin) 8%, var(--paper)); }
.suggestion-groups { display: grid; gap: 12px; margin-top: 12px; }
.suggestion-group h4 { margin: 0 0 7px; font-size: 12px; font-weight: 600; color: var(--ink-3); }
.options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.options.single { grid-template-columns: minmax(0, 1fr); }
.option {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 6px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.option strong { font-size: 12.5px; color: var(--ink); }
.option-explain { font-size: 12px; color: var(--ink-3); }
.option-value { font-size: 13px; color: var(--ink); }
.option-actions { display: flex; justify-content: flex-start; margin-top: 2px; }
.adopt-btn {
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: var(--paper);
  color: var(--zhu);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.adopt-btn:hover:not(:disabled) { border-color: var(--zhu); background: var(--zhu-soft); }
.adopt-btn:disabled { opacity: .5; cursor: not-allowed; }
.compose {
  padding: 0;
  border-top: 1px solid var(--line);
  background: var(--paper);
  transition: border-color .15s;
}
.compose:focus-within { border-top-color: var(--zhu); }
.compose-inner {
  display: grid;
  gap: 7px;
  width: 100%;
  min-height: 103px;
  padding: 10px 16px 12px;
}
textarea {
  display: block;
  width: 100%;
  min-height: 41px;
  max-height: 160px;
  resize: vertical;
  box-sizing: border-box;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
}
textarea:focus-visible { outline: none; }
.compose-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.keyboard-hint { color: var(--ink-3); font-size: 12px; }
.send-btn {
  flex-shrink: 0;
  min-height: 32px;
  padding: 5px 14px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.send-btn.primary { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.send-btn.stop { border-color: var(--zhu); color: var(--zhu); background: var(--zhu-soft); }
.send-btn:disabled { opacity: .48; cursor: not-allowed; }
@media (max-width: 760px) {
  .options { grid-template-columns: minmax(0, 1fr); }
  .keyboard-hint { display: none; }
}
</style>
