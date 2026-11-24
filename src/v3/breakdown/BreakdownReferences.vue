<template>
  <details v-if="items.length" class="breakdown-references" :open="!!route.query.breakdownHandoff">
    <summary>{{ route.name === 'V3Write' ? '本章拆书参考' : '拆书出处' }}（{{ items.length }}）</summary>
    <article v-for="{ job, handoff } in items" :key="handoff.id">
      <strong>{{ handoff.title }}</strong>
      <p v-if="route.name === 'V3Write' || route.name === 'KnowledgeLibrary'">{{ handoff.text }}</p>
      <RouterLink :to="'/breakdown/' + job.id">《{{ job.title }}》</RouterLink>
      <RouterLink v-for="(reference, index) in handoff.links" :key="index"
        :to="breakdownEvidenceRoute(job.id, reference.cardId, reference.evidenceIndex, handoff.sourceVersion)">出处 {{ index + 1 }}</RouterLink>
    </article>
  </details>
</template>
<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBookBreakdownStore } from '@/stores/bookBreakdown'
import { breakdownEvidenceRoute } from './bookBreakdownHandoff'

const route = useRoute()
const store = useBookBreakdownStore()
const items = computed(() => store.jobs.flatMap(job => job.handoffs.map(handoff => ({ job, handoff }))).filter(({ job, handoff }) => {
  if (!handoff.destinationId) return false
  const selected = handoff.id === route.query.breakdownHandoff
  const novel = handoff.targetId === route.params.novelId
  const matches = (route.name === 'KnowledgeLibrary' && handoff.kind === 'knowledge' && selected)
    || (route.name === 'V3Write' && handoff.kind === 'writing' && novel && handoff.chapterId === route.params.chapterId)
    || (route.name === 'V3Plan' && handoff.kind === 'plan' && novel && (selected || route.query.plannerSelection === handoff.destinationId))
    || (route.name === 'V3Codex' && handoff.kind === 'codex' && novel && (selected || route.query.character === handoff.destinationId))
  if (!matches) return false
  try { store.authorize(job); return true } catch { return false }
}))
watch(() => route.name, name => {
  if (name === 'V3Write' || name === 'V3Plan' || name === 'V3Codex' || name === 'KnowledgeLibrary') void store.initialize().catch(() => undefined)
}, { immediate: true })
</script>
<style scoped>
.breakdown-references { z-index: 5; position: absolute; inset: 8px 18px auto auto; max-width: min(390px, 48%); max-height: 65%; overflow: auto; padding: 7px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-s); box-shadow: var(--shadow); font-size: 12px; }
summary { cursor: pointer; }
article { border-top: 1px solid var(--line); padding: 7px 0; margin-top: 7px; }
p { white-space: pre-wrap; overflow-wrap: anywhere; }
a { margin-right: 6px; }
</style>
