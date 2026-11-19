<template>
  <section class="modifier-editor">
    <strong>属性加成</strong>
    <p class="modifier-hint">把装备字段计入归属角色的某个基础字段，例如“攻击力 +12”或“生命 +10%”。</p>
    <div v-for="field in fields" :key="field.id" class="modifier-row">
      <span>{{ field.name }}</span>
      <V3Input :value="field.modifier?.attribute || ''" :aria-label="`${field.name}计入的角色字段`" placeholder="角色基础字段名"
        @update:value="value => setModifier(field, value, field.modifier?.operation || 'flat')" />
      <V3Select :value="field.modifier?.operation || 'none'" :aria-label="`${field.name}的加成方式`" :options="operations"
        @update:value="value => setModifier(field, field.modifier?.attribute || field.name, value)" />
    </div>
    <p v-if="!fields.length" class="modifier-hint">先在上方添加字段。</p>
  </section>
</template>

<script setup lang="ts">
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import type { DataPanelField } from '@/types/novel'
const props = defineProps<{ fields: DataPanelField[] }>()
const emit = defineEmits<{ 'update:fields': [fields: DataPanelField[]] }>()
const operations = [
  { label: '不计入属性', value: 'none' }, { label: '固定数值', value: 'flat' }, { label: '基础值百分比', value: 'percent' },
]
function setModifier(field: DataPanelField, attribute: string, operation: string) {
  const modifier: DataPanelField['modifier'] = attribute.trim() && (operation === 'flat' || operation === 'percent')
    ? { attribute: attribute.trim(), operation } : undefined
  emit('update:fields', props.fields.map(candidate => candidate.id === field.id ? { ...candidate, modifier } : candidate))
}
</script>

<style scoped>
.modifier-editor { display: grid; gap: 8px; min-width: 0; }
.modifier-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 150px; gap: 8px; align-items: center; }
.modifier-row span { overflow-wrap: anywhere; font-size: 13px; color: var(--ink-2); }
.modifier-editor > strong { font: 600 13px var(--f-ui); color: var(--ink); }
.modifier-hint { margin: 0; color: var(--ink-3); font-size: 12px; }
@media (max-width: 560px) { .modifier-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .modifier-row > span { grid-column: 1 / -1; } }
</style>
