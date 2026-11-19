<template>
  <div class="m-field" :class="{ 'span-2': span }">
    <label v-if="label" :id="controlId + '-l'" class="m-field-l" :for="controlId">{{ label }}</label>
    <slot />
  </div>
</template>

<script setup lang="ts">
// 表单项：标签在上，控件在下。里面的 V3Input / V3Number / V3Select 会自动拿到 id，点击标签即可聚焦。
import { provide } from 'vue'
import { FIELD_ID } from './fieldId'

defineOptions({ name: 'V3Field' })
defineProps<{ label?: string; span?: boolean }>()
const controlId = `v3f-${Math.random().toString(36).slice(2, 9)}`
provide(FIELD_ID, controlId)
</script>
