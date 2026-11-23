<template>
  <section id="web-search-service" tabindex="-1" class="settings-section paper-panel web-search-panel" aria-labelledby="web-search-service-title">
    <h2 id="web-search-service-title" class="web-search-title">联网搜索</h2>
    <p class="section-desc">没有内置联网搜索的模型（如 DeepSeek、Kimi）开启“联网”时，先用这里的服务搜索网页，再把结果交给模型回答。也可以在模型的“对话联网方式”里让任何模型改用它。</p>
    <p class="section-desc web-search-tip">通义、智谱、豆包模型可以直接用自带的搜索，不必配置这里。已有智谱 API 密钥的，可以选“智谱网络搜索”并填同一个密钥。</p>
    <div class="web-search-form">
      <V3Field label="搜索服务">
        <V3Select :value="form.provider" :options="providerOptions" aria-label="搜索服务" @update:value="changeProvider" />
        <p class="model-discovery-hint">{{ info.note }}</p>
      </V3Field>
      <V3Field v-if="keyAllowed" :label="info.needsKey ? 'API 密钥' : 'API 密钥（选填）'">
        <V3Input v-model:value="form.apiKey" type="password" autocomplete="off" aria-label="搜索服务 API 密钥"
          :placeholder="configStore.webSearchService.apiKey && configStore.webSearchService.provider === form.provider ? '留空则保留当前 API 密钥' : info.needsKey ? '填写搜索服务的 API 密钥' : '不填也能使用，填写后额度更高'" />
      </V3Field>
      <V3Field :label="form.provider === 'searxng' ? '服务地址' : '服务地址（选填）'">
        <V3Input v-model:value="form.baseUrl" aria-label="搜索服务地址" :placeholder="info.defaultBaseUrl || '如：http://127.0.0.1:8888'" />
        <p v-if="addressError" class="model-discovery-error">{{ addressError }}</p>
        <p v-else-if="form.provider !== 'searxng'" class="model-discovery-hint">留空使用官方地址{{ info.hosts.length > 1 ? `；也可以填 https://${info.hosts[1]}` : '' }}。</p>
      </V3Field>
      <V3Field label="每次结果条数">
        <V3Number v-model:value="form.count" :min="1" :max="10" :step="1" aria-label="每次结果条数" />
      </V3Field>
    </div>
    <div class="web-search-fallback">
      <V3Switch :id="fallbackId" :value="form.freeFallback" aria-label="模型自带搜索失败时改用这里的服务" @update:value="value => form.freeFallback = value" />
      <label :for="fallbackId">模型自带的搜索出错或没有搜到时，改用这里的搜索服务</label>
    </div>
    <div class="web-search-actions">
      <button type="button" class="m-btn sm pri" :disabled="saving || !dirty || Boolean(addressError)" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      <button type="button" class="m-btn sm" :disabled="testing || dirty || !configured" :title="dirty ? '请先保存' : ''" @click="test">{{ testing ? '搜索中…' : '测试搜索' }}</button>
      <span v-if="!configured" class="model-discovery-hint">{{ info.needsKey ? '填写 API 密钥并保存后可以测试。' : '填写服务地址并保存后可以测试。' }}</span>
      <span v-else-if="testResult" :class="testResult.ok ? 'model-discovery-success' : 'model-discovery-error'" role="status">{{ testResult.text }}</span>
    </div>
    <p class="model-discovery-hint">测试会发送一次搜索请求（可能产生少量费用），不包含小说内容。联网对话时，搜索词会发送给所用的搜索服务。搜索服务的设置只保存在本机。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import V3Switch from '@/v3/components/form/V3Switch.vue'
import { useConfigStore } from '@/stores/config'
import { useMessage } from '@/v3/feedback'
import { errorText } from '@/services/userFacingError'
import { isWebSearchServiceConfigured, resolveBaseUrl, searchWeb, WEB_SEARCH_PROVIDERS, type WebSearchProvider } from '@/services/webSearchService'

const configStore = useConfigStore()
const message = useMessage()
const providerOptions = (Object.keys(WEB_SEARCH_PROVIDERS) as WebSearchProvider[]).map(value => ({ value, label: WEB_SEARCH_PROVIDERS[value].label }))

// 表单里的密钥留空表示沿用已保存的密钥。
const form = reactive({ provider: configStore.webSearchService.provider, apiKey: '', baseUrl: configStore.webSearchService.baseUrl,
  count: configStore.webSearchService.count, freeFallback: configStore.webSearchService.freeFallback })
watch(() => ({ ...configStore.webSearchService }), saved => {
  if (dirty.value) return
  Object.assign(form, { provider: saved.provider, apiKey: '', baseUrl: saved.baseUrl, count: saved.count, freeFallback: saved.freeFallback })
})
const fallbackId = useId()
const info = computed(() => WEB_SEARCH_PROVIDERS[form.provider])
// Firecrawl 不填密钥也能用，填写后额度更高；SearXNG 不需要密钥。
const keyAllowed = computed(() => info.value.needsKey || form.provider === 'firecrawl')
const nextConfig = computed(() => {
  const saved = configStore.webSearchService
  const apiKey = form.apiKey.trim() || (saved.provider === form.provider ? saved.apiKey : '')
  return { provider: form.provider, apiKey: keyAllowed.value ? apiKey : '', baseUrl: form.baseUrl.trim(), count: form.count, freeFallback: form.freeFallback }
})
const dirty = computed(() => {
  const saved = configStore.webSearchService
  return form.provider !== saved.provider || Boolean(form.apiKey.trim()) || form.baseUrl.trim() !== saved.baseUrl || form.count !== saved.count
    || form.freeFallback !== saved.freeFallback
})
const addressError = computed(() => {
  if (!form.baseUrl.trim() && form.provider !== 'searxng') return ''
  if (!form.baseUrl.trim()) return ''
  return resolveBaseUrl({ provider: form.provider, baseUrl: form.baseUrl }) ? '' : form.provider === 'searxng' ? '请填写有效的 http(s) 地址。' : '只能填写该服务的官方地址。'
})
const configured = computed(() => isWebSearchServiceConfigured(configStore.webSearchService))

function changeProvider(value: WebSearchProvider) {
  if (value === form.provider) return
  Object.assign(form, { provider: value, apiKey: '', baseUrl: '' })
  testResult.value = null
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await configStore.setWebSearchService(nextConfig.value)
    form.apiKey = ''
    testResult.value = null
    message.success('联网搜索服务已保存')
  } catch (error) { message.error(errorText(error, '保存失败，请重试')) }
  finally { saving.value = false }
}

const testing = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)
let controller: AbortController | null = null
async function test() {
  controller?.abort()
  controller = new AbortController()
  testing.value = true
  testResult.value = null
  try {
    const sources = await searchWeb(configStore.webSearchService, 'Vue.js 官方网站', controller.signal)
    testResult.value = sources.length
      ? { ok: true, text: `搜索成功，返回 ${sources.length} 条结果，第一条：${sources[0].title}` }
      : { ok: false, text: '服务有响应，但没有返回结果。' }
  } catch (error) {
    if (controller.signal.aborted) return
    testResult.value = { ok: false, text: errorText(error, '搜索测试失败') }
  } finally { testing.value = false }
}
onBeforeUnmount(() => controller?.abort())
</script>

<style scoped>
/* 与设置页一致的基础样式（设置页样式是局部的，子组件内部用不到）。 */
.settings-section { padding: var(--space-lg); }
.web-search-title { margin: 0 0 4px; color: var(--ink); font: 600 24px var(--f-serif); }
.section-desc { font-size: 13px; color: var(--ink-3); margin: 0 0 var(--space-md); line-height: 1.6; }
.model-discovery-hint, .model-discovery-success, .model-discovery-error { font-size: 11px; line-height: 1.5; }
.model-discovery-hint { color: var(--ink-3); }
.model-discovery-success { color: var(--qing); }
.model-discovery-error { margin: 0; color: var(--zhu); }
/* 字段顶部对齐：说明文字长短不一时，输入框仍在同一条线上 */
.web-search-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 16px; align-items: start; }
.web-search-tip { margin-top: -8px; }
.web-search-fallback { display: flex; align-items: center; gap: 10px; margin: 4px 0 6px; font-size: 13px; color: var(--ink-2); }
.web-search-fallback label { cursor: pointer; line-height: 1.5; }
.web-search-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 6px 0 8px; }
</style>
