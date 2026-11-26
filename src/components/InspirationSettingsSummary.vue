<template>
  <aside class="inspiration-settings paper-panel" aria-label="已整理的设定">
    <header class="summary-heading">
      <h2>已整理的设定</h2>
      <button type="button" class="m-btn ghost sm summary-collapse" @click="emit('collapse')">收起<V3Icon name="arrowR" size="s" /></button>
    </header>
    <dl class="summary-fields" tabindex="0" aria-label="设定内容">
      <div v-for="field in fields" :key="field.key" class="summary-field">
        <dt>{{ field.label }}</dt>
        <dd :class="{ empty: !field.value }">{{ field.value || '待整理' }}</dd>
        <button v-if="field.editable" type="button" class="field-pencil" :disabled="busy"
          :aria-label="`编辑${field.label}`" @click="openEdit(field.key)"><V3Icon name="edit" size="s" /></button>
      </div>
    </dl>
    <footer class="summary-footer">
      <p v-if="settingsStatus" class="summary-status" role="status">{{ settingsStatus }}</p>
      <div class="summary-actions">
        <button type="button" class="m-btn pri summary-extract" :disabled="busy || !canExtract || extracting" @click="emit('extract')" :aria-busy="extracting"><V3Icon name="file" size="s" />{{ extracting ? '整理中' : '整理设定' }}</button>
        <button type="button" class="m-btn summary-finish" :disabled="busy || !canFinish" @click="emit('finish')"><V3Icon name="check" size="s" />完成</button>
      </div>
    </footer>
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
const emit = defineEmits<{ extract: []; finish: []; collapse: []; 'draft-change': [form: CreateWizardForm] }>()
type SummaryKey = 'genre' | 'protagonist' | 'world' | 'mainConflict' | 'conflict' | 'notes'
const editing = ref<SummaryKey | null>(null)
const draft = ref('')
const fields = computed(() => {
  const { protagonist, supportingCharacters, worldBuilding, coreConflict, otherSettings } = props.form.settings
  return [
    { key: 'genre', label: '类型', value: genres.find(genre => genre.value === props.form.genre)?.label || props.form.genre, editable: true },
    { key: 'protagonist', label: '主角', value: [protagonist.name, protagonist.background].filter(Boolean).join(' · '), editable: true },
    { key: 'supporting', label: '关键配角', value: supportingCharacters.map(character =>
      [character.name, character.role || character.relationship].filter(Boolean).join(' · '),
    ).filter(Boolean).join('\n'), editable: false },
    { key: 'world', label: '故事舞台', value: worldBuilding.worldType, editable: true },
    { key: 'mainConflict', label: '主线矛盾', value: coreConflict.mainConflict, editable: true },
    { key: 'conflict', label: '核心悬念', value: coreConflict.coreSuspense, editable: true },
    { key: 'notes', label: '线索与备注', value: otherSettings, editable: true },
  ] as const
})
function openEdit(key: SummaryKey) {
  editing.value = key
  if (key === 'genre') draft.value = props.form.genre
  else if (key === 'protagonist') draft.value = props.form.settings.protagonist.name
  else draft.value = fields.value.find(field => field.key === key)?.value || ''
}
function saveEdit() {
  if (!editing.value || props.busy) return
  const form: CreateWizardForm = JSON.parse(JSON.stringify(props.form))
  if (editing.value === 'genre') { form.genre = draft.value; form.subGenre = '' }
  else if (editing.value === 'protagonist') form.settings.protagonist.name = draft.value.trim()
  else if (editing.value === 'world') form.settings.worldBuilding.worldType = draft.value.trim()
  else if (editing.value === 'mainConflict') form.settings.coreConflict.mainConflict = draft.value.trim()
  else if (editing.value === 'notes') form.settings.otherSettings = draft.value.trim()
  else form.settings.coreConflict.coreSuspense = draft.value.trim()
  emit('draft-change', form)
  editing.value = null
}
</script>

<style scoped>
.inspiration-settings {
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 9px;
  align-self: stretch; min-width: 0; min-height: 0; height: 100%; padding: 12px;
}
.summary-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 8px; }
.summary-heading h2 { font-size: 17px; margin: 0; }
.summary-collapse { gap: 4px; }
.summary-fields { display: grid; align-content: start; gap: 5px; min-height: 0; margin: 0; overflow-y: auto; overscroll-behavior: contain; }
.summary-field {
  display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; align-items: start;
  gap: 5px; padding: 6px 7px; border: 1px solid var(--line); border-radius: var(--r-s);
  background: var(--panel); color: var(--ink); font-size: 12px; line-height: 1.55;
}
.summary-field dt, .summary-field .empty { color: var(--ink-3); }
.summary-field dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.field-pencil { display: grid; place-items: center; padding: 1px; border: 0; background: transparent; color: var(--ink-3); cursor: pointer; }
.field-pencil:hover { color: var(--zhu); }
.field-pencil:disabled { opacity: .5; cursor: default; }
.summary-footer { display: grid; gap: 5px; }
.summary-status { margin: 0; color: var(--ink-2); font-size: 12px; line-height: 1.55; }
.summary-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
@media (max-width: 850px) {
  .inspiration-settings { align-self: stretch; max-height: 100%; }
}
</style>
