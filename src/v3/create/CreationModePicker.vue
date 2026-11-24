<template>
  <section class="creation-mode-picker" aria-label="创建方式搭配">
    <fieldset class="choice-group writing-choice">
      <legend>正文创作方式</legend>
      <div class="choice-grid">
        <label v-for="option in writingOptions" :key="option.value" class="mode-option"
          :class="{ selected: writingMode === option.value }">
          <input type="radio" name="creation-writing-mode" :value="option.value"
            :checked="writingMode === option.value" :disabled="disabled"
            @change="emit('update:writingMode', option.value)" />
          <span class="mode-icon" aria-hidden="true"><V3Icon :name="option.icon" size="l" /></span>
          <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
        </label>
      </div>
    </fieldset>
    <fieldset class="choice-group origin-choice">
      <legend>作品创建起点</legend>
      <div class="choice-grid">
        <label v-for="option in setupOptions" :key="option.value" class="mode-option"
          :class="{ selected: setupMethod === option.value }">
          <input type="radio" name="creation-setup-method" :value="option.value"
            :checked="setupMethod === option.value" :disabled="disabled"
            @change="emit('update:setupMethod', option.value)" />
          <span class="mode-icon" aria-hidden="true"><V3Icon :name="option.icon" size="l" /></span>
          <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
        </label>
      </div>
    </fieldset>
    <div class="choice-actions">
      <p class="choice-summary" aria-live="polite">
        {{ writingMode === 'ai' ? 'AI 模式' : '作者主笔 · 写作辅助' }}
        ＋ {{ setupOptions.find(option => option.value === setupMethod)?.label || '请选择创建起点' }}
      </p>
      <button id="start-creation-btn" type="button" class="m-btn" :disabled="disabled || !writingMode || !setupMethod"
        @click="emit('start')">
        {{ setupMethod === 'inspiration' ? '进入灵感对话 →' : setupMethod === 'outline' ? '读取或粘贴大纲 →' : setupMethod === 'blank' ? '准备空白作品 →' : setupMethod === 'custom' ? '填写小说设定 →' : '选择后继续' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import V3Icon from '@/v3/components/V3Icon.vue'
import type { CreationSetupMethod } from '@/types/creationEntry'

defineProps<{
  writingMode?: 'ai' | 'manual'
  setupMethod: CreationSetupMethod | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:writingMode': [mode: 'ai' | 'manual']
  'update:setupMethod': [method: CreationSetupMethod]
  start: []
}>()
const writingOptions = [
  { value: 'manual' as const, label: '作者主笔 · 写作辅助', icon: 'edit' as const, description: '默认由你写正文，按需使用 AI 提供思路、规划和审查。' },
  { value: 'ai' as const, label: 'AI 模式', icon: 'spark' as const, description: '允许 AI 生成候选正文，由你编辑、调整和确认。' },
]
const setupOptions = [
  { value: 'inspiration' as const, label: '灵感对话 · 输入你的想法', icon: 'bulb' as const, description: '写下一个想法即可开始契约，也可继续已有灵感讨论。' },
  { value: 'outline' as const, label: '已有大纲文件 / 粘贴', icon: 'sliders' as const, description: '本地读取 TXT、Markdown、DOCX，预览编辑并保存为候选。' },
  { value: 'blank' as const, label: '空白模板', icon: 'edit' as const, description: '无需模型或预设题材，从空白作品契约手工设计。' },
  { value: 'custom' as const, label: '自选设定', icon: 'sliders' as const, description: '保留详细类型、人物、世界和风格设置，再确认作品契约。' },
]
</script>

<style scoped>
.mode-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 22px; height: 22px; }
.mode-icon :deep(svg) { width: 22px; height: 22px; }

.choice-group legend { margin-bottom: 16px; font-size: 18px; font-weight: 600; font-family: var(--f-serif); color: var(--ink); }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.mode-option input { margin: 4px 0 0; accent-color: var(--zhu); }
.mode-option:focus-within { outline: 2px solid var(--zhu); outline-offset: 2px; }
.mode-option strong { display: block; color: var(--ink); font-size: 16px; font-weight: 600; line-height: 1.5; }
@media (max-width: 768px) {
  .creation-mode-picker { padding: 0 20px 20px; }
  .choice-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .mode-option { padding: 16px; }
  .choice-actions { bottom: -20px; padding: 16px 0; }
}
@media (max-width: 390px) {
  .creation-mode-picker { padding: 0 16px 16px; }
  .choice-actions .m-btn { width: 100%; }
}
.creation-mode-picker { margin: 0 auto; box-sizing: border-box; width: 100%; overflow-y: auto; min-height: 0; flex: 1; display: flex; flex-direction: column; max-width: none; overflow: visible; padding: 0; }
.picker-intro { line-height: 1.75; font-size: 15px; color: var(--ink-2); margin: 0 0 32px; display: none; }.choice-group { border: 0; padding: 0; min-width: 0; margin: 0; }
.origin-choice { order: 1; }.origin-choice legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.origin-choice .choice-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.origin-choice .mode-option { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 24px; position: relative; }
.mode-option { cursor: pointer; border: 1px solid var(--line-2); padding: 20px 18px; gap: 12px; align-items: start; grid-template-columns: auto auto minmax(0, 1fr); display: grid; border-color: var(--line); border-radius: var(--r-m); background: var(--paper); transition: border-color .2s, box-shadow .2s; }
.mode-option:hover { border-color: var(--ink-3); box-shadow: var(--shadow-1); }
.mode-option.selected { background: var(--paper); border-color: var(--zhu); box-shadow: 0 0 0 3px var(--zhu-soft); }
.origin-choice .mode-option > input { position: absolute; top: 14px; right: 14px; accent-color: var(--zhu); }
.origin-choice .mode-icon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--panel-2); color: var(--ink-2); }
.origin-choice .mode-icon :deep(svg) { width: 22px; height: 22px; }
.origin-choice strong { color: var(--ink); font: 600 17px/1.5 var(--f-serif); }.mode-option small { margin-top: 6px; display: block; color: var(--ink-3); font-size: 12px; line-height: 1.7; }
.origin-choice .mode-option:last-child { grid-column: 1 / -1; grid-template-columns: 30px minmax(0, 1fr); padding: 12px 18px; align-items: center; gap: 12px; }
.origin-choice .mode-option:last-child .mode-icon { width: 30px; height: 30px; }.origin-choice .mode-option:last-child > span { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
.origin-choice .mode-option:last-child strong { font-size: 14px; }.origin-choice .mode-option:last-child small { margin: 0; }
.choice-number { display: none; }.writing-choice { order: 3; margin-top: 22px; }.writing-choice legend { margin-bottom: 8px; font: 600 12px var(--f-ui); color: var(--ink-3); }
.writing-choice .choice-grid { gap: 10px; }.writing-choice .mode-option { grid-template-columns: auto minmax(0, 1fr); gap: 10px; padding: 10px 14px; }
.writing-choice .mode-icon { display: none; }.writing-choice strong { font-size: 12px; }.writing-choice small { margin-top: 3px; font-size: 11px; }
.choice-actions { border-top: 1px solid var(--line-2); gap: 16px; justify-content: space-between; align-items: center; flex-wrap: wrap; display: flex; bottom: -32px; order: 4; position: static; padding: 16px 0 0; margin-top: 16px; border-color: var(--line); background: transparent; }.choice-summary { line-height: 1.6; margin: 0; color: var(--ink-3); font-size: 12px; }
#start-creation-btn { height: 34px; padding: 0 14px; border: 1px solid var(--ink); border-radius: 6px; background: var(--ink); color: var(--paper); font: 13px var(--f-ui); }
@media (max-width: 1100px) {.origin-choice .choice-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
@media (max-width: 1100px) {.origin-choice .mode-option { grid-template-columns: 44px minmax(0, 1fr); padding: 18px 22px; gap: 16px; } }
@media (max-width: 1100px) {.origin-choice .mode-option:last-child { grid-template-columns: 30px minmax(0, 1fr); } }
@media (max-width: 700px) {.writing-choice .choice-grid { grid-template-columns: minmax(0, 1fr); } }

</style>
