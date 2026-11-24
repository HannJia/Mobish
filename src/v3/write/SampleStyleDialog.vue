<template>
  <V3Modal :show="true" title="提炼本书写法" size="wide" :closable="!saving" @update:show="emit('close')">
    <details class="sample" open>
      <summary>选中的样文</summary>
      <p>{{ sample }}</p>
    </details>
    <button type="button" class="m-btn sm" :disabled="busy" @click="extract">{{ operation === 'extract' ? '正在提炼…' : 'AI 提炼规则' }}</button>
    <V3Field label="本书写法候选">
      <V3Input v-model:value="rules" type="textarea" :rows="4" :maxlength="MAX_SAMPLE_RULES_LENGTH" show-count :disabled="busy"
        placeholder="编辑提炼出的规则，每行一条" />
    </V3Field>
    <V3Field label="用另一段试写">
      <V3Input v-model:value="original" type="textarea" :rows="3" :maxlength="MAX_STYLE_SAMPLE_LENGTH" show-count :disabled="busy"
        placeholder="粘贴另一段正文，或写一段用于试写的文字" />
    </V3Field>
    <button type="button" class="m-btn sm" :disabled="busy || !trialReady" @click="tryRules">{{ operation === 'trial' ? '正在试写…' : '生成对照预览' }}</button>
    <div v-if="preview" class="comparison" aria-label="原文和试写对照">
      <section><h4>试写原文</h4><p>{{ preview.original }}</p></section>
      <section><h4>按规则试写</h4><p>{{ preview.rewrite }}</p></section>
    </div>
    <p v-else-if="trial" class="m-muted m-tiny">规则或试写原文已编辑，请重新生成对照。</p>
    <p v-if="original.trim() && original.trim() === sample.trim()" class="m-muted m-tiny">请选择与样文不同的一段文字。</p>
    <p v-if="error" role="alert" class="style-error">{{ error }}</p>
    <template #footer>
      <span class="l">确认后，本书的 AI 写作会使用这些规则。</span>
      <button type="button" class="m-btn" :disabled="saving" @click="emit('close')">取消</button>
      <button type="button" class="m-btn zhu" :disabled="busy || !preview" @click="save">{{ saving ? '保存中…' : '确认应用写法' }}</button>
    </template>
  </V3Modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { errorText } from '@/services/userFacingError'
import { extractSampleStyleRules, MAX_SAMPLE_RULES_LENGTH, MAX_STYLE_SAMPLE_LENGTH, trySampleStyleRules } from '@/services/sampleStyle'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'

const props = defineProps<{ novelId: string; sample: string; previousRules: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const config = useConfigStore(), novels = useNovelStore()
const rules = ref(props.previousRules), original = ref(''), error = ref('')
const trial = shallowRef<{ rules: string; original: string; rewrite: string }>()
const operation = ref<'extract' | 'trial'>()
const saving = ref(false)
const busy = computed(() => !!operation.value || saving.value)
const trialReady = computed(() => !!rules.value.trim() && !!original.value.trim() && original.value.trim() !== props.sample.trim())
const preview = computed(() => trial.value?.rules === rules.value.trim() && trial.value.original === original.value.trim() ? trial.value : undefined)
let controller: AbortController | undefined
let mounted = true
onBeforeUnmount(() => { mounted = false; controller?.abort() })

async function run(kind: 'extract' | 'trial') {
  if (busy.value) return
  const model = config.getModelForTask('writing')
  if (!model) { error.value = '请先在设置页配置写作模型。'; return }
  controller = new AbortController()
  operation.value = kind
  error.value = ''
  try {
    if (kind === 'extract') {
      rules.value = await extractSampleStyleRules(model, props.sample, rules.value.trim(), controller.signal)
      trial.value = undefined
    } else {
      const input = { original: original.value.trim(), rules: rules.value.trim() }
      const rewrite = await trySampleStyleRules(model, input.original, input.rules, controller.signal)
      trial.value = { ...input, rewrite }
    }
  } catch (cause) {
    if (mounted) error.value = errorText(cause, '模型未完成本次请求。')
  } finally {
    controller = undefined
    operation.value = undefined
  }
}

function extract() { if (props.sample.length <= MAX_STYLE_SAMPLE_LENGTH) void run('extract') }
function tryRules() { if (trialReady.value) void run('trial') }

async function save() {
  const confirmed = preview.value
  if (!confirmed || busy.value) return
  saving.value = true
  error.value = ''
  try {
    await novels.updateSampleStyleRules(props.novelId, confirmed.rules, props.previousRules)
    if (mounted) emit('saved')
  } catch (cause) {
    if (mounted) error.value = errorText(cause, '写法规则保存失败，请重试。')
  } finally { saving.value = false }
}
</script>

<style scoped>
.sample, .comparison section { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 12px; }
.sample, .m-btn, .comparison { margin-bottom: 12px; }
.sample summary { cursor: pointer; }
.sample p, .comparison p { margin: 8px 0 0; max-height: 240px; overflow: auto; overflow-wrap: anywhere; white-space: pre-wrap; font: 14px/1.75 var(--f-serif); }
.comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.comparison h4 { margin: 0; font-size: 13px; }
.style-error { color: var(--zhu); }
.m-modal-f .m-btn { margin-bottom: 0; }
@media (max-width: 650px) { .comparison { grid-template-columns: minmax(0, 1fr); } }
</style>
