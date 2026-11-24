<template>
  <Teleport defer to="#v3-crumb"><RouterLink class="crumb-link" to="/breakdown">拆书</RouterLink><span class="crumb-sep">/</span><span class="crumb-b">灵感对话</span></Teleport>
  <div class="discussion-page">
    <div v-if="receipt" class="discussion-source">
      <RouterLink :to="'/breakdown/' + receipt.job.id">{{ receipt.job.title }}</RouterLink>
      <RouterLink v-for="(reference, index) in receipt.handoff.links" :key="index"
        :to="breakdownEvidenceRoute(receipt.job.id, reference.cardId, reference.evidenceIndex, receipt.handoff.sourceVersion)">出处 {{ index + 1 }}</RouterLink>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <InspirationChat v-if="ready" :form="form" :active="true" @draft-change="form = $event" @apply="form = $event" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import InspirationChat from '@/components/InspirationChat.vue'
import type { CreateWizardForm } from '@/types/novel'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { useBookBreakdownStore } from '@/stores/bookBreakdown'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { breakdownEvidenceRoute } from './bookBreakdownHandoff'

const route = useRoute()
const novels = useNovelStore()
const sessions = useInspirationSessionsStore()
const knowledge = useKnowledgeStore()
const breakdown = useBookBreakdownStore()
const ready = ref(false)
const error = ref('')
const form = ref<CreateWizardForm>({ genre: '', subGenre: '', tags: [], targetWordCountMin: 80, targetWordCountMax: 120,
  settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle(), writingMode: 'manual' })
const receipt = computed(() => breakdown.jobs.flatMap(job => job.handoffs.map(handoff => ({ job, handoff })))
  .find(item => item.handoff.id === route.query.from && item.handoff.destinationId === route.params.sessionId))
onMounted(async () => {
  try {
    await Promise.all([sessions.initialize(), breakdown.initialize(), knowledge.initStore()])
    const target = sessions.sessions.find(item => item.id === route.params.sessionId)
    if (!target) throw new Error('这份灵感对话已不在近期记录中。')
    if (receipt.value) breakdown.authorize(receipt.value.job)
    if (sessions.sessions[0]?.id !== target.id) {
      sessions.upsert({ ...target, updatedAt: new Date().toISOString() })
      await sessions.flushPendingSaves()
    }
    ready.value = true
  } catch (value) { error.value = value instanceof Error ? value.message : String(value) }
})
</script>

<style scoped>
.discussion-page { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 14px clamp(18px, 6vw, 80px); overflow: auto; }
.discussion-source { display: flex; flex-wrap: wrap; gap: 10px; padding: 5px 0 9px; }
.discussion-page :deep(.inspiration-chat) { flex: 1; min-height: 0; }
</style>
