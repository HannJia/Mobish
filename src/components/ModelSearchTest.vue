<template>
  <div class="model-search-test" :class="{ 'model-search-test--compact': compact }">
    <p v-if="!compact || busy || result || cancelled" class="search-protocol">{{ description }}<span v-if="!result"> · 尚未验证服务商能力</span></p>
    <div class="search-actions">
      <button type="button" :class="btnClass" :aria-busy="busy" :disabled="busy || !model.baseUrl.trim() || !model.modelName.trim() || (!model.apiKey.trim() && !isLocalModelUrl(model.baseUrl))"
        @click="confirmTest"><V3Icon name="search" size="s" />{{ connection ? '测试' : '测试联网' }}</button>
      <button v-if="busy" type="button" :class="btnClass" @click="stop"><V3Icon name="stop" size="s" />停止测试</button>
      <button v-if="result" type="button" class="m-btn ghost" :class="compact ? 'xs' : 'sm'" @click="copyDiagnostic"><V3Icon name="file" size="s" />复制诊断</button>
    </div>
    <p v-if="busy" class="search-result" role="status">{{ step === 'connection' ? '正在测试对话…' : '正在请求搜索接口…' }}</p>
    <div v-else-if="result" class="search-result" :class="`search-${overallStatus}`" role="status">
      <strong>{{ heading }}</strong>
      <template v-if="connectionResult">
        <p><b>对话：</b>{{ connectionResult.message }}</p>
        <p v-if="!connectionResult.ok && connectionResult.message.includes('（403）')" class="search-detail-note">{{ MODEL_LIST_NOT_PERMISSION }}</p>
        <details v-if="!connectionResult.ok && connectionResult.detail" class="search-raw"><summary>服务商原始返回</summary><pre>{{ connectionResult.detail }}</pre></details>
        <p><b>联网：</b>{{ result.message }}</p>
      </template>
      <p v-else>{{ result.message }}</p>
      <time>{{ testedAt }}</time>
    </div>
    <p v-if="cancelled" class="search-result" role="status">测试已停止。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDialog, useMessage } from '@/v3/feedback'
import V3Icon from '@/v3/components/V3Icon.vue'
import type { ModelConfig } from '@/stores/config'
import { searchProtocolDescription, testChatSearch, type ChatSearchTestResult } from '@/services/chatSearch'
import { MODEL_LIST_NOT_PERMISSION } from '@/services/aiErrorExplain'
import { isLocalModelUrl } from '@/services/modelProviders'

/**
 * 联网测试。传入 connection 时先测对话，再测联网，结果分两行显示，哪一步出错就提示哪一步；
 * 对话失败时不再测联网。不传时只测联网（编辑表单里的高级参数使用）。
 */
const props = defineProps<{
  model: ModelConfig
  compact?: boolean
  connection?: (model: ModelConfig) => Promise<{ ok: boolean; message: string; detail?: string }>
}>()
const dialog = useDialog()
const message = useMessage()
const busy = ref(false)
const cancelled = ref(false)
const step = ref<'connection' | 'search'>('search')
const result = ref<ChatSearchTestResult | null>(null)
const connectionResult = ref<{ ok: boolean; message: string; detail?: string } | null>(null)
const testedAt = ref('')
const btnClass = computed(() => ['m-btn', props.compact ? 'xs ghost' : 'sm'])
const description = computed(() => searchProtocolDescription(props.model))
const overallStatus = computed(() => connectionResult.value && !connectionResult.value.ok ? 'failed' : result.value?.status ?? 'failed')
const heading = computed(() => {
  const search = result.value?.status
  if (!connectionResult.value) return search === 'verified' ? '本次搜索已验证' : search === 'unverified' ? '搜索尚未验证' : '搜索测试失败'
  if (!connectionResult.value.ok) return '对话测试失败'
  return search === 'verified' ? '对话和联网都正常' : search === 'unverified' ? '对话正常，联网尚未验证' : '对话正常，联网测试失败'
})
let controller: AbortController | null = null

function stop() {
  controller?.abort()
  controller = null
  busy.value = false
  cancelled.value = true
}

function confirmTest() {
  if (busy.value) return
  const snapshot = { ...props.model }
  dialog.warning({
    title: props.connection ? '测试对话和联网？' : '测试联网搜索？',
    content: props.connection
      ? '会依次发送一次对话请求和一次联网搜索请求（可能产生少量费用），不包含小说内容。'
      : '会发送一次搜索测试请求（可能产生少量费用），不包含小说内容。',
    positiveText: '开始测试', negativeText: '取消',
    onPositiveClick: () => {
      if (!busy.value && sameSettings(snapshot, props.model)) void run(snapshot)
    },
  })
}

function sameSettings(a: ModelConfig, b: ModelConfig) {
  return a.baseUrl === b.baseUrl && a.apiKey === b.apiKey && a.modelName === b.modelName
    && a.chatSearchProtocol === b.chatSearchProtocol && a.maxTokens === b.maxTokens
}

async function run(model: ModelConfig) {
  const request = new AbortController()
  controller = request
  busy.value = true
  cancelled.value = false
  result.value = null
  connectionResult.value = null
  const current = () => controller === request && !request.signal.aborted
  try {
    if (props.connection) {
      step.value = 'connection'
      const connection = await props.connection(model).catch(() => ({ ok: false, message: '对话测试未完成，请重试。' }))
      if (!current()) return
      if (!connection.ok) {
        connectionResult.value = connection
        result.value = { status: 'failed', message: '对话不通，没有继续测试联网。', sourceCount: 0 }
        testedAt.value = new Date().toLocaleString('zh-CN')
        return
      }
      connectionResult.value = connection
    }
    step.value = 'search'
    const response = await testChatSearch(model, request.signal)
    if (current()) {
      result.value = response
      testedAt.value = new Date().toLocaleString('zh-CN')
    }
  } catch {
    if (current()) {
      result.value = { status: 'failed', message: '测试未完成，请重试。', sourceCount: 0 }
    }
  } finally {
    if (controller === request) { controller = null; busy.value = false }
  }
}

async function copyDiagnostic() {
  if (!result.value) return
  const lines = connectionResult.value
    ? [description.value, testedAt.value, heading.value, `对话：${connectionResult.value.message}`, `联网：${result.value.message}`]
    : [description.value, testedAt.value, result.value.message]
  // Do not include the provider URL, key, manuscript, or raw response body.
  try { await navigator.clipboard.writeText(lines.join('\n')); message.success('诊断已复制') }
  catch { message.error('复制失败，请选中诊断文字复制。') }
}

watch(() => ({ ...props.model }), (next, previous) => {
  if (!sameSettings(next, previous)) { stop(); result.value = null; connectionResult.value = null; cancelled.value = false }
})
onBeforeUnmount(stop)
</script>

<style scoped>
.search-detail-note { color: var(--ink-3); font-size: 12px; }
.search-raw summary { cursor: pointer; color: var(--ink-3); font-size: 12px; }
.search-raw pre { margin: 6px 0 0; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; color: var(--ink-2); background: var(--panel-2, var(--paper)); padding: 8px; border-radius: 6px; }
.model-search-test { display: grid; gap: 8px; min-width: 0; }
.model-search-test--compact, .model-search-test--compact .search-actions { display: contents; }
.model-search-test--compact .search-protocol, .model-search-test--compact .search-result { order: 1; flex-basis: 100%; min-width: 0; }
.search-protocol, .search-result { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.search-protocol, time { color: var(--ink-3); }
.search-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.search-result { border-top: 1px solid var(--line); padding-top: 8px; }
.search-result p { margin: 4px 0; white-space: pre-wrap; }
.search-result b { font-weight: 600; color: var(--ink-2); }
.search-verified strong { color: var(--qing); }
.search-failed strong { color: var(--zhu); }
.search-unverified strong { color: var(--jin); }
</style>
