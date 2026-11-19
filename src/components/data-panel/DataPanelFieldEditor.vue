<template>
  <div class="field-editor">
    <div class="m-seg" role="group" aria-label="编辑方式">
      <button type="button" :class="{ on: mode === 'structured' }" :aria-pressed="mode === 'structured'" @click="mode = 'structured'">结构化编辑</button>
      <button type="button" :class="{ on: mode === 'advanced' }" :aria-pressed="mode === 'advanced'" @click="mode = 'advanced'">高级文本</button>
    </div>
    <p v-for="field in formulaErrors" :key="field.id" role="alert" class="formula-error">{{ field.name }}：{{ field.calculationError }}</p>

    <template v-if="mode === 'structured'">
      <section class="editor-section">
        <div class="fe-heading">
          <strong>字段</strong>
          <button type="button" class="m-btn xs" @click="addField"><V3Icon name="plus" size="s" />添加字段</button>
        </div>
        <div v-if="fields.length" class="field-list">
          <div class="field-row field-head" aria-hidden="true"><span>字段名</span><span>当前值</span><span>单位</span><span>类型</span><span>公式</span><span /></div>
          <div v-for="field in fields" :key="field.id" class="field-row">
            <V3Input :value="field.name" aria-label="字段名" placeholder="字段名" @update:value="value => updateField(field.id, { name: value })" />
            <V3Input :value="field.value" aria-label="当前值" placeholder="当前值" @update:value="value => updateField(field.id, { value })" />
            <V3Input :value="field.unit" aria-label="单位" placeholder="单位" @update:value="value => updateField(field.id, { unit: value })" />
            <V3Select :value="field.type || 'text'" aria-label="字段类型" :options="fieldTypeOptions" @update:value="value => updateField(field.id, { type: value })" />
            <V3Input v-if="field.type === 'formula'" :value="field.formula" aria-label="公式" placeholder="如：总周期-已成长" @update:value="value => updateField(field.id, { formula: value, autoCalculate: true })" />
            <span v-else class="formula-placeholder">—</span>
            <button type="button" class="m-ibtn" title="删除字段" aria-label="删除字段" @click="removeField(field.id)"><V3Icon name="trash" size="s" /></button>
          </div>
        </div>
        <p v-else class="editor-empty">还没有字段。点“添加字段”记录数量、进度、状态等。</p>
      </section>

      <section class="editor-section">
        <div class="fe-heading">
          <strong>自动规则</strong>
          <button type="button" class="m-btn xs" :disabled="!fields.length" @click="addRule"><V3Icon name="plus" size="s" />添加规则</button>
        </div>
        <div v-if="rules.length" class="rule-list">
          <div class="rule-row field-head" aria-hidden="true"><span>字段</span><span>触发</span><span>间隔天数</span><span>变化</span><span>基于字段</span><span /></div>
          <div v-for="rule in rules" :key="rule.id" class="rule-row">
            <V3Select :value="rule.fieldName" aria-label="规则字段" :options="fieldOptions" @update:value="value => updateRule(rule.id, { fieldName: value })" />
            <V3Select :value="rule.trigger" aria-label="触发方式" :options="triggerOptions" @update:value="value => updateRule(rule.id, { trigger: value })" />
            <V3Number v-if="rule.trigger === 'elapsed_days'" :value="rule.interval" aria-label="间隔天数" :min="1" @update:value="value => updateRule(rule.id, { interval: value || 1 })" />
            <span v-else class="formula-placeholder">—</span>
            <V3Input v-if="rule.trigger === 'per_chapter'" :value="rule.schedule" aria-label="每章变化" placeholder="+5, +4" @update:value="value => updateRule(rule.id, { schedule: value })" />
            <V3Number v-else :value="rule.amount" aria-label="变化量" @update:value="value => updateRule(rule.id, { amount: value || 0 })" />
            <V3Select v-if="rule.trigger === 'elapsed_days'" clearable :value="rule.sourceFieldName || null" aria-label="基于字段" :options="fieldOptions" placeholder="基于字段（可选）" @update:value="value => updateRule(rule.id, { sourceFieldName: value || '' })" />
            <span v-else class="formula-placeholder">—</span>
            <button type="button" class="m-ibtn" title="删除规则" aria-label="删除规则" @click="removeRule(rule.id)"><V3Icon name="trash" size="s" /></button>
          </div>
        </div>
        <p v-else class="editor-empty">{{ fields.length ? '还没有自动规则。可以让字段每章、每次出现或每隔几天自动变化。' : '先添加字段，再为它设置自动规则。' }}</p>
      </section>
    </template>

    <template v-else>
      <V3Field label="字段文本">
        <V3Input v-model:value="advancedFieldsText" type="textarea" :rows="8" placeholder="字段名=值=单位=类型=公式" @blur="applyAdvancedFields" />
      </V3Field>
      <V3Field label="自动规则文本">
        <V3Input :value="automationText" type="textarea" :rows="5" placeholder="字段名｜每章 +1" @update:value="value => emit('update:automationText', value)" />
      </V3Field>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import { calculateDataPanelFieldValues, createDataPanelId, formatDataPanelFields, parseDataPanelFields, STORY_CLOCK_SOURCE } from '@/services/dataPanel'
import type { DataPanelAutomationRule, DataPanelField, DataPanelFieldType } from '@/types/novel'

interface RuleRow {
  id: string
  fieldName: string
  trigger: DataPanelAutomationRule['trigger']
  amount: number
  interval: number
  schedule: string
  sourceFieldName: string
}

const props = defineProps<{ fields: DataPanelField[]; automationText: string }>()
const emit = defineEmits<{
  'update:fields': [fields: DataPanelField[]]
  'update:automationText': [value: string]
}>()

const mode = ref<'structured' | 'advanced'>('structured')
const formulaErrors = computed(() => calculateDataPanelFieldValues(props.fields).filter(field => field.calculationError))
const advancedFieldsText = ref('')
const rules = ref<RuleRow[]>([])
const fieldTypeOptions: Array<{ label: string; value: DataPanelFieldType }> = [
  { label: '文本', value: 'text' }, { label: '数字', value: 'number' }, { label: '百分比', value: 'percent' },
  { label: '天数', value: 'days' }, { label: '倒计时', value: 'countdown' }, { label: '公式', value: 'formula' },
]
const triggerOptions = [
  { label: '每章变化', value: 'per_chapter' },
  { label: '每次出现', value: 'on_mention' },
  { label: '经过天数', value: 'elapsed_days' },
]
const fieldOptions = computed(() => [
  { label: '故事时间（当前故事日）', value: STORY_CLOCK_SOURCE },
  ...props.fields.map(field => ({ label: field.name || '未命名字段', value: field.name })),
])

watch(() => props.fields, fields => {
  advancedFieldsText.value = formatDataPanelFields(fields)
}, { immediate: true, deep: true })

watch(() => props.automationText, text => {
  rules.value = parseRules(text)
}, { immediate: true })

function updateField(id: string, updates: Partial<DataPanelField>) {
  const next = props.fields.map(field => field.id === id ? { ...field, ...updates } : field)
  emit('update:fields', next)
}

function addField() {
  emit('update:fields', [...props.fields, {
    id: createDataPanelId(), name: '', value: '', unit: '', note: '', type: 'text', formula: '', autoCalculate: false,
  }])
}

function removeField(id: string) {
  const removed = props.fields.find(field => field.id === id)?.name
  emit('update:fields', props.fields.filter(field => field.id !== id))
  if (removed) {
    rules.value = rules.value.filter(rule => rule.fieldName !== removed)
    emitRules()
  }
}

function applyAdvancedFields() {
  emit('update:fields', parseDataPanelFields(advancedFieldsText.value).map(field => {
    const previous = props.fields.find(candidate => candidate.name === field.name)
    return previous ? { ...field, id: previous.id, modifier: previous.modifier } : field
  }))
}

function addRule() {
  rules.value.push({
    id: createDataPanelId(), fieldName: props.fields[0]?.name || '', trigger: 'per_chapter', amount: 1,
    interval: 1, schedule: '+1', sourceFieldName: '',
  })
  emitRules()
}

function updateRule(id: string, updates: Partial<RuleRow>) {
  rules.value = rules.value.map(rule => rule.id === id ? { ...rule, ...updates } : rule)
  emitRules()
}

function removeRule(id: string) {
  rules.value = rules.value.filter(rule => rule.id !== id)
  emitRules()
}

function emitRules() {
  emit('update:automationText', rules.value.map(rule => {
    if (rule.trigger === 'per_chapter') return `${rule.fieldName}｜每章 ${rule.schedule || signed(rule.amount)}`
    if (rule.trigger === 'on_mention') return `${rule.fieldName}｜每次出现 ${signed(rule.amount)}`
    const source = rule.sourceFieldName ? `（基于：${rule.sourceFieldName}）` : ''
    return `${rule.fieldName}｜经过 ${Math.max(1, rule.interval)} 天 ${signed(rule.amount)}${source}`
  }).join('\n'))
}

function signed(value: number) { return value >= 0 ? `+${value}` : String(value) }

function parseRules(text: string): RuleRow[] {
  const parsed: RuleRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const [fieldName = '', spec = ''] = line.split(/[|｜]/).map(value => value.trim())
    if (!fieldName || !spec) continue
    const elapsed = spec.match(/经过\s*(\d+(?:\.\d+)?)\s*天(?:后)?\s*([+-]?\s*\d+(?:\.\d+)?)/)
    const rawSource = spec.match(/基于\s*[:：\s]*([^）)]+)/)?.[1]?.trim() || ''
    const source = rawSource === '故事时间' || rawSource === '当前故事日' ? STORY_CLOCK_SOURCE : rawSource
    if (elapsed) {
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'elapsed_days', amount: Number(elapsed[2].replace(/\s/g, '')), interval: Number(elapsed[1]), schedule: '', sourceFieldName: source })
      continue
    }
    const mention = spec.match(/每次出现\s*([+-]?\s*\d+(?:\.\d+)?)/)
    if (mention) {
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'on_mention', amount: Number(mention[1].replace(/\s/g, '')), interval: 1, schedule: '', sourceFieldName: '' })
      continue
    }
    const chapter = spec.match(/每章\s*(.+)/)
    if (chapter) {
      const first = chapter[1].match(/[+-]?\s*\d+(?:\.\d+)?/)?.[0] || '0'
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'per_chapter', amount: Number(first.replace(/\s/g, '')), interval: 1, schedule: chapter[1].trim(), sourceFieldName: '' })
    }
  }
  return parsed
}
</script>

<style scoped>
.field-editor { display: grid; gap: 14px; min-width: 0; }
.formula-error { color: var(--zhu); margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.editor-section { display: grid; gap: 8px; }
.fe-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fe-heading strong { font: 600 13px var(--f-ui); color: var(--ink); }
.field-editor > .m-seg { justify-self: start; }
.field-head { color: var(--ink-3); font-size: 11px; padding: 0 2px; }
.editor-empty { margin: 0; padding: 12px 14px; border: 1px dashed var(--line-2); border-radius: var(--r-s); color: var(--ink-3); font-size: 12px; }
.field-list, .rule-list { display: grid; gap: 8px; }
.field-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 72px 100px minmax(0, 1.2fr) 30px; gap: 6px; align-items: center; min-width: 0; }
.rule-row { display: grid; grid-template-columns: minmax(0, 1fr) 104px 76px 96px minmax(0, 1fr) 30px; gap: 6px; align-items: center; min-width: 0; }
.formula-placeholder { text-align: center; color: var(--ink-3); }
@media (max-width: 720px) {
  .field-head { display: none; }
  .field-row, .rule-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  .field-row > :last-child, .rule-row > :last-child { justify-self: end; }
}
</style>
