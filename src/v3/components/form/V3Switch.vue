<template>
  <button :id="fieldId" type="button" role="switch" class="m-switch" :class="{ on: !!value }" :aria-checked="!!value"
    :disabled="disabled" @click="emit('update:value', !value)"><span aria-hidden="true" /></button>
</template>

<script setup lang="ts">
// 开关：点按切换，v-model:value 写法；请用 aria-label 或 V3Field 标签说明它控制什么。
import { useFieldId } from './fieldId'

defineOptions({ name: 'V3Switch' })
defineProps<{ value?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:value': [value: boolean] }>()
const fieldId = useFieldId()
</script>
