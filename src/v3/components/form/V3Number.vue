<template>
  <input :id="fieldId" v-bind="$attrs" class="m-input m-number" type="number" inputmode="numeric" :value="value ?? ''" :min="min" :max="max"
    :step="step ?? 1" :disabled="disabled" :placeholder="placeholder ?? (clearable ? '未填写' : undefined)" @change="onChange">
</template>

<script setup lang="ts">
// 原生数字输入：失焦或回车时提交，超出范围收回到边界；允许清空时空值记为 null。
// precision 指定保留的小数位数（0 表示只取整数），提交时先按位数取整再收回到边界。
import { useFieldId } from './fieldId'

defineOptions({ name: 'V3Number', inheritAttrs: false })
const fieldId = useFieldId()
const props = defineProps<{
  value?: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  clearable?: boolean
  placeholder?: string
  precision?: number
}>()
const emit = defineEmits<{ 'update:value': [value: number | null] }>()

function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  if (!raw) {
    if (props.clearable) { emit('update:value', null); return }
    input.value = props.value === null || props.value === undefined ? '' : String(props.value)
    return
  }
  let next = Number(raw)
  if (!Number.isFinite(next)) { input.value = props.value === null || props.value === undefined ? '' : String(props.value); return }
  if (props.precision !== undefined) next = Number(next.toFixed(props.precision))
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  input.value = String(next)
  emit('update:value', next)
}
</script>
