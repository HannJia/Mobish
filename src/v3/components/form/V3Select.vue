<template>
  <div v-if="multiple" :aria-labelledby="fieldId ? fieldId + '-l' : undefined" v-bind="$attrs" class="m-multi" role="group" :aria-disabled="disabled || undefined">
    <button v-for="option in options" :key="String(option.value)" type="button" class="m-chip"
      :class="{ on: selected.has(option.value) }" :aria-pressed="selected.has(option.value)"
      :disabled="disabled || option.disabled" @click="toggle(option.value)">
      <V3Icon v-if="selected.has(option.value)" name="check" size="s" />{{ option.label }}
    </button>
    <span v-if="!options.length" class="m-multi-empty">{{ placeholder || '暂无可选项' }}</span>
    <button v-else-if="clearable && selected.size && !disabled" type="button" class="m-link m-multi-clear" @click="emit('update:value', [])">清空</button>
  </div>
  <select v-else :id="fieldId" v-bind="$attrs" class="m-input m-select" :value="indexOf(value)" :disabled="disabled" @change="onChange">
    <option v-if="placeholder || clearable || indexOf(value) === ''" value="" :disabled="!clearable">{{ placeholder || '请选择' }}</option>
    <option v-for="(option, index) in options" :key="String(option.value)" :value="String(index)" :disabled="option.disabled">{{ option.label }}</option>
  </select>
</template>

<script setup lang="ts">
// 原生下拉：单选用 <select>，多选用可切换的标签按钮（比原生多选框更好点按）。
// 选项值可以是字符串或数字，内部按序号对应，避免数字被转成字符串。
import { computed } from 'vue'
import V3Icon from '../V3Icon.vue'
import { useFieldId } from './fieldId'

type OptionValue = string | number
interface V3SelectOption { label: string; value: OptionValue; disabled?: boolean }

defineOptions({ name: 'V3Select', inheritAttrs: false })
const props = defineProps<{
  value?: OptionValue | OptionValue[] | null
  options: V3SelectOption[]
  multiple?: boolean
  clearable?: boolean
  placeholder?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: any] }>()
const fieldId = useFieldId()

const selected = computed(() => new Set<OptionValue>(Array.isArray(props.value) ? props.value : []))
function indexOf(value: unknown) {
  const index = props.options.findIndex(option => option.value === value)
  return index < 0 ? '' : String(index)
}
function onChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  emit('update:value', raw === '' ? null : props.options[Number(raw)]?.value ?? null)
}
function toggle(value: OptionValue) {
  const current = Array.isArray(props.value) ? props.value : []
  emit('update:value', current.includes(value) ? current.filter(item => item !== value) : [...current, value])
}
</script>
