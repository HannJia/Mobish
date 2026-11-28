<template>
  <V3Modal v-for="item in dialogs" :key="item.id" :show="true" size="small" :title="item.title" :closable="!item.busy"
    class="v3-dialog" :class="`v3-dialog-${item.kind}`" @update:show="value => { if (!value) dismissDialog(item.id) }">
    <div class="v3-dialog-body">
      <V3Icon :name="item.kind === 'info' ? 'info' : item.kind === 'success' ? 'check' : 'alert'" class="v3-dialog-icon" />
      <p>{{ item.content }}</p>
    </div>
    <template #footer>
      <button v-if="item.negativeText" type="button" class="m-btn" :disabled="item.busy" @click="runDialogAction(item.id, 'negative')">{{ item.negativeText }}</button>
      <button v-if="item.positiveText" type="button" class="m-btn pri" :class="{ 'v3-dialog-danger': destructive(item) }"
        :aria-busy="item.busy" :disabled="item.busy" @click="runDialogAction(item.id, 'positive')">{{ item.positiveText }}</button>
    </template>
  </V3Modal>
</template>

<script setup lang="ts">
// 渲染 useDialog() 打开的确认框；放在 V3Shell 内，沿用 V3 样式。
// 打开时焦点落在确认框本身而不是确认按钮，避免误按回车直接执行删除。
import V3Modal from './V3Modal.vue'
import V3Icon from './V3Icon.vue'
import { dialogs, dismissDialog, runDialogAction, type V3DialogItem } from '../feedback'

defineOptions({ name: 'V3DialogHost' })
const DESTRUCTIVE = /删除|清空|放弃|移除|覆盖|丢弃/
function destructive(item: V3DialogItem) { return item.kind === 'warning' && DESTRUCTIVE.test(item.positiveText || '') }
</script>

<style scoped>
.v3-dialog-body { display: flex; gap: 12px; align-items: flex-start; }
.v3-dialog-body p { margin: 0; line-height: 1.75; color: var(--ink-2); white-space: pre-line; overflow-wrap: anywhere; }
.v3-dialog-icon { flex-shrink: 0; margin-top: 3px; color: var(--jin); }
.v3-dialog-error .v3-dialog-icon { color: var(--zhu); }
.v3-dialog-info .v3-dialog-icon { color: var(--dai); }
.v3-dialog-success .v3-dialog-icon { color: var(--qing); }
.v3 .m-btn.pri.v3-dialog-danger { background: var(--zhu-solid); border-color: var(--zhu); color: var(--on-accent); }
</style>
