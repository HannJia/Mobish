<template>
  <button
    v-if="show"
    type="button"
    class="guide-beacon"
    :aria-label="`新手提示：${def.title}`"
    :title="def.body"
    @click.stop="openGuide"
  >
    <span class="guide-beacon-dot" aria-hidden="true" />
    <span class="guide-beacon-label">{{ def.label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GUIDE_BEACONS, type GuideBeaconId, type GuideSceneId } from '@/services/onboardingGuide'
import { useOnboardingStore } from '@/stores/onboarding'

const props = withDefaults(defineProps<{
  beaconId: GuideBeaconId
  scene?: GuideSceneId
  visible?: boolean
}>(), {
  visible: true,
})

const onboarding = useOnboardingStore()
const def = computed(() => GUIDE_BEACONS[props.beaconId])
const targetScene = computed(() => props.scene ?? def.value.scene)
const show = computed(() => props.visible && onboarding.shouldShowBeacon(props.beaconId))

function openGuide() {
  onboarding.startTour(targetScene.value, props.beaconId)
  onboarding.markSeen(props.beaconId)
}
</script>

<style scoped>
.guide-beacon {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--zhu) 45%, var(--line));
  border-radius: 99px;
  background: var(--zhu-soft);
  color: var(--zhu);
  font-size: 12px;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
}
.guide-beacon:hover { border-color: var(--zhu); }
.guide-beacon-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--zhu);
  background: transparent;
  flex: none;
  animation: guide-beacon-pulse 1.1s ease-in-out 2;
}
@keyframes guide-beacon-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--zhu-soft); }
  50% { box-shadow: 0 0 0 5px var(--zhu-soft); }
}
@media (prefers-reduced-motion: reduce) {
  .guide-beacon-dot { animation: none; }
}
</style>
