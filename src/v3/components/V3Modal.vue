<template>
  <div v-if="show" class="m-overlay" @mousedown.self="maskDown = true" @click.self="onMask" @keydown="onKey">
    <section ref="dialog" class="m-modal" :class="size === 'small' ? 'm-modal-sm' : size === 'wide' ? 'm-modal-wide' : undefined" role="dialog" aria-modal="true"
      :aria-labelledby="titleId" tabindex="-1">
      <header class="m-modal-h">
        <div><h3 :id="titleId">{{ title }}</h3><p v-if="description">{{ description }}</p></div>
        <button v-if="closable" type="button" class="m-ibtn" aria-label="关闭" @click="close"><V3Icon name="x" /></button>
      </header>
      <div class="m-modal-b"><slot /></div>
      <footer v-if="$slots.footer" class="m-modal-f"><slot name="footer" /></footer>
    </section>
  </div>
</template>

<script setup lang="ts">
// 通用弹窗：v-model:show 控制显示；closable 为 false 时（例如保存中）不能用 Esc、遮罩或关闭按钮关闭。
// 打开时焦点进入弹窗，Tab 在弹窗内循环，关闭后焦点回到打开前的位置。
import { nextTick, ref, watch } from 'vue'
import V3Icon from './V3Icon.vue'

defineOptions({ name: 'V3Modal' })
const props = withDefaults(defineProps<{ show: boolean; title: string; description?: string; closable?: boolean; size?: 'default' | 'small' | 'wide' }>(),
  { closable: true, size: 'default', description: undefined })
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const dialog = ref<HTMLElement | null>(null)
const titleId = `v3m-${Math.random().toString(36).slice(2, 9)}`
const maskDown = ref(false)
let opener: HTMLElement | null = null

watch(() => props.show, open => {
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void nextTick(() => dialog.value?.focus())
  } else if (opener?.isConnected) {
    const target = opener
    opener = null
    void nextTick(() => target.focus())
  }
}, { immediate: true })

function close() { if (props.closable) emit('update:show', false) }
function onMask() {
  // 只在遮罩上按下并松开时关闭，避免从输入框拖选到遮罩外时误关。
  if (maskDown.value) close()
  maskDown.value = false
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); return }
  if (event.key !== 'Tab' || !dialog.value) return
  // 弹窗嵌套时只由最内层处理 Tab 循环。
  event.stopPropagation()
  const items = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
  const first = items[0], last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>
