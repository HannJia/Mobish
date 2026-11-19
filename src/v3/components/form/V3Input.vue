<template>
  <div class="m-input-wrap" :class="[attrs.class, { 'has-prefix': $slots.prefix, 'is-area': type === 'textarea', 'has-count': showCount && maxlength }]" :style="attrs.style as any">
    <span v-if="$slots.prefix" class="m-input-prefix" aria-hidden="true"><slot name="prefix" /></span>
    <textarea v-if="type === 'textarea'" :id="fieldId" v-bind="controlAttrs" class="m-textarea" :value="value ?? ''" :rows="rows || 3"
      :placeholder="placeholder" :disabled="disabled" :maxlength="maxlength" @input="onInput" />
    <input v-else :id="fieldId" v-bind="controlAttrs" class="m-input" :type="type === 'password' && !revealed ? 'password' : 'text'" :value="value ?? ''" :placeholder="placeholder"
      :disabled="disabled" :maxlength="maxlength" @input="onInput">
    <button v-if="type === 'password' && value && !disabled" type="button" class="m-input-clear" :aria-label="revealed ? '隐藏内容' : '显示内容'"
      :aria-pressed="revealed" @click="revealed = !revealed"><V3Icon name="eye" size="s" /></button>
    <button v-else-if="clearable && value && !disabled" type="button" class="m-input-clear" aria-label="清空" @click="emit('update:value', '')">
      <V3Icon name="x" size="s" />
    </button>
    <span v-if="showCount && maxlength" class="m-input-count" aria-hidden="true">{{ (value ?? '').length }} / {{ maxlength }}</span>
  </div>
</template>

<script setup lang="ts">
// 原生输入框，沿用 v-model:value 写法。class / style 作用在外层容器上；
// 其余属性（id、aria-*、@keydown 等）落到真正的输入元素上。
// type="password" 时右侧有显示/隐藏按钮；showCount 配合 maxlength 显示字数。
import { computed, ref, useAttrs } from 'vue'
import V3Icon from '../V3Icon.vue'
import { useFieldId } from './fieldId'

defineOptions({ name: 'V3Input', inheritAttrs: false })
defineProps<{
  value?: string | null
  type?: 'text' | 'textarea' | 'password'
  rows?: number
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  maxlength?: number
  showCount?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: string] }>()
const attrs = useAttrs()
const fieldId = useFieldId()
const revealed = ref(false)
const controlAttrs = computed(() => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style')))
function onInput(event: Event) { emit('update:value', (event.target as HTMLInputElement | HTMLTextAreaElement).value) }
</script>
