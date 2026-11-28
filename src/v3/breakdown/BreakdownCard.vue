<template>
  <article class="breakdown-card">
    <div class="card-heading">
      <div><small>{{ heading }}</small><h4>{{ item.title }}</h4></div>
      <label v-if="selectable" class="m-check"><input type="checkbox" :checked="checked" @change="emit('select')">选用</label>
    </div>
    <form v-if="draft" @submit.prevent="submit">
      <label>标题<input class="m-in" v-model.trim="draft.title" maxlength="160" required></label>
      <label>原文观察<textarea class="m-in" v-model.trim="draft.observation" maxlength="1000" required /></label>
      <label>写法判断<textarea class="m-in" v-model.trim="draft.interpretation" maxlength="1000" required /></label>
      <label>迁移场景<textarea class="m-in" v-model.trim="draft.application" maxlength="1000" required /></label>
      <button type="submit" class="m-btn sm pri" :disabled="!canEdit">保存</button>
      <button type="button" class="m-btn sm" @click="draft = undefined">取消</button>
    </form>
    <dl v-else>
      <div><dt>原文观察</dt><dd>{{ item.observation }}</dd></div>
      <div><dt>写法判断</dt><dd>{{ item.interpretation }}</dd></div>
      <div><dt>迁移场景</dt><dd>{{ item.application }}</dd></div>
    </dl>
    <ul v-if="item.evidence.length" class="card-evidence">
      <li v-for="(reference, index) in item.evidence" :key="index">
        <button type="button" class="m-btn sm ghost" :data-guide="guideFirstQuote && index === 0 ? 'breakdown.quote' : undefined" @click="emit('open', index)">段 {{ reference.paragraph }} · {{ reference.quote }}</button>
      </li>
    </ul>
    <p v-if="item.pendingEvidence.length" class="m-muted">待核对 · {{ item.pendingEvidence.join('、') }}</p>
    <button v-if="!draft && canEdit" type="button" class="m-btn sm" @click="draft = { ...item }">{{ item.edited ? '编辑（已校订）' : '编辑判断' }}</button>
  </article>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import type { BreakdownCard } from '@/services/bookBreakdownAnalysis'
const props = defineProps<{ item: BreakdownCard; heading: string; selectable: boolean; canEdit: boolean; checked?: boolean; guideFirstQuote?: boolean }>()
const emit = defineEmits<{ select: []; open: [index: number]; save: [item: BreakdownCard] }>()
const draft = ref<BreakdownCard>()
function submit() {
  if (!draft.value || !props.canEdit || ![draft.value.title, draft.value.observation, draft.value.interpretation, draft.value.application].every(Boolean)) return
  emit('save', draft.value)
  draft.value = undefined
}
</script>
<style scoped>
.breakdown-card { padding: 15px; border: 1px solid var(--line); border-radius: var(--r-m); margin-bottom: 12px; background: var(--panel); }
.card-heading { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.card-heading small { color: var(--ink-3); }
.card-heading h4 { font: 650 17px var(--f-serif); margin: 3px 0; overflow-wrap: anywhere; }
dl { margin: 8px 0; } dl div { margin-bottom: 8px; } dt { color: var(--ink-3); font-size: 12px; }
dd { margin: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.card-evidence { list-style: none; padding: 0; }
.card-evidence button { white-space: normal; text-align: left; max-width: 100%; height: auto; }
form label { display: grid; gap: 3px; margin: 6px 0; }
form button { margin: 5px 6px 0 0; }
</style>
