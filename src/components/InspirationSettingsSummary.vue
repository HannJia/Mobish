<template>
  <aside class="inspiration-settings paper-panel" aria-label="已整理的设定">
    <header class="summary-heading"><span class="summary-mark"><V3Icon name="file" size="l" /></span><div><h2>已整理的设定</h2><p>保留已填写的内容，随时调整故事方向。</p></div></header>
    <div class="summary-fields">
      <button v-for="field in fields" :key="field.key" type="button" class="summary-field" :disabled="busy" :aria-label="`编辑${field.label}`" @click="openEdit(field.key)">
        <span class="field-symbol"><V3Icon :name="field.icon" size="l" /></span>
        <span class="field-label">{{ field.label }}</span><strong :class="{ empty: !field.value }">{{ field.value || '待整理' }}</strong><V3Icon name="edit" size="s" class="field-pencil" />
      </button>
    </div>
    <div class="summary-tip"><V3Icon name="bulb" size="l" /><div><h3>完善设定</h3><p>整理当前讨论，更新上方设定并压缩上下文后可继续聊。编辑后的设定会用于后续回复；确定后点击“完成”进入详细检查。</p></div></div>
    <p v-if="settingsStatus" class="summary-status" role="status">{{ settingsStatus }}</p>
    <button type="button" class="m-btn pri lg block summary-extract" :disabled="busy || !canExtract || extracting" @click="emit('extract')" :aria-busy="extracting"><V3Icon name="file" size="s" />{{ extracting ? '整理中' : '整理设定' }}</button>
    <button type="button" class="m-btn lg block summary-finish" :disabled="busy || !canFinish" @click="emit('finish')"><V3Icon name="check" size="s" />完成</button>
    <button type="button" class="m-btn lg block summary-history" :disabled="busy" @click="emit('history')"><V3Icon name="clock" size="s" />查看历史</button>
    <p class="summary-footnote">没整理出来的项目会留空。</p>
    <V3Modal :show="editing !== null" size="small" :title="`编辑${fields.find(field => field.key === editing)?.label || '设定'}`" @update:show="value => { if (!value) editing = null }">
      <V3Select v-if="editing === 'genre'" v-model:value="draft" :options="genres.map(genre => ({ label: genre.label, value: genre.value }))" aria-label="故事类型" />
      <V3Input v-else v-model:value="draft" :type="editing === 'protagonist' ? 'text' : 'textarea'" :rows="4" :maxlength="2000" aria-label="设定内容" />
      <template #footer><button type="button" class="m-btn" @click="editing = null">取消</button><button type="button" class="m-btn pri" @click="saveEdit">保存设定</button></template>
    </V3Modal>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import V3Modal from '@/v3/components/V3Modal.vue'
import { genres } from '@/data/genres'
import type { CreateWizardForm } from '@/types/novel'
const props = withDefaults(defineProps<{ form: CreateWizardForm; busy: boolean; extracting: boolean; canExtract: boolean; canFinish?: boolean; settingsStatus?: string }>(), { canFinish: true, settingsStatus: '' })
const emit = defineEmits<{ extract: []; finish: []; history: []; 'draft-change': [form: CreateWizardForm] }>()
type SummaryKey = 'genre' | 'protagonist' | 'world' | 'conflict'
const editing = ref<SummaryKey | null>(null)
const draft = ref('')
const fields = computed(() => [
  { key: 'genre' as const, label: '类型', value: genres.find(genre => genre.value === props.form.genre)?.label || props.form.genre, icon: 'book' as const },
  { key: 'protagonist' as const, label: '主角', value: props.form.settings.protagonist.name, icon: 'user' as const },
  { key: 'world' as const, label: '故事舞台', value: props.form.settings.worldBuilding.worldType, icon: 'pin' as const },
  { key: 'conflict' as const, label: '核心悬念', value: props.form.settings.coreConflict.coreSuspense, icon: 'link' as const },
])
function openEdit(key: SummaryKey) {
  editing.value = key
  draft.value = key === 'genre' ? props.form.genre : fields.value.find(field => field.key === key)?.value || ''
}
function saveEdit() {
  if (!editing.value || props.busy) return
  const form: CreateWizardForm = JSON.parse(JSON.stringify(props.form))
  if (editing.value === 'genre') { form.genre = draft.value; form.subGenre = '' }
  else if (editing.value === 'protagonist') form.settings.protagonist.name = draft.value.trim()
  else if (editing.value === 'world') form.settings.worldBuilding.worldType = draft.value.trim()
  else form.settings.coreConflict.coreSuspense = draft.value.trim()
  emit('draft-change', form)
  editing.value = null
}
</script>

<style scoped>
.inspiration-settings { display: flex; flex-direction: column; gap: 16px; min-width: 0; padding: 24px; }
.inspiration-settings > * { flex-shrink: 0; }
.summary-heading { display: flex; align-items: flex-start; gap: 12px; }
.summary-heading h2 { font-size: 23px; margin: 0 0 6px; }
.summary-heading p, .summary-tip p { color: var(--ink-2); font-size: 13px; line-height: 1.75; }
.summary-mark, .field-symbol { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 44px; border-radius: 8px; background: var(--dai-soft); color: var(--dai); }
.summary-fields { display: grid; gap: 12px; margin-top: 10px; }
.summary-field { display: grid; grid-template-columns: 40px 62px minmax(0, 1fr) 17px; align-items: center; gap: 10px; min-height: 80px; padding: 12px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--paper); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.summary-field:hover { border-color: var(--zhu); }
.summary-field strong { font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.field-label, .empty, .field-pencil { color: var(--ink-2); font-size: 13px; }
.summary-tip { display: flex; align-items: flex-start; gap: 12px; padding: 18px 14px; border: 1px solid var(--line); border-radius: 9px; margin-top: auto; }
.summary-tip > .icon { color: var(--jin); flex-shrink: 0; }
.summary-tip h3 { font-size: 16px; margin-bottom: 6px; }
.summary-footnote { color: var(--ink-3); font-size: 11px; }
.summary-status { color: var(--ink-2); font-size: 12px; line-height: 1.7; }
@media (max-width: 1100px) { .inspiration-settings { padding: 18px; } .summary-field { grid-template-columns: 32px minmax(0, 1fr) 17px; gap: 8px; } .field-label { grid-column: 2; } .summary-field strong { grid-column: 2; } .field-symbol { width: 32px; grid-row: span 2; } .field-pencil { grid-column: 3; grid-row: 1 / 3; } }
</style>
