<template>
  <Teleport to="body">
    <div v-if="visible && step" class="guide-spotlight-root">
      <div v-if="targetRect" class="guide-highlight-ring" :style="ringStyle" aria-hidden="true" />
      <section
        ref="dialogEl"
        class="guide-popover"
        :class="{ 'inline-fallback': !targetRect }"
        role="dialog"
        aria-modal="false"
        :aria-label="`新手引导：${step.title}`"
        :style="popoverStyle"
        tabindex="-1"
        @keydown.esc.stop.prevent="closeAndRestoreFocus"
      >
        <header class="gp-head">
          <span class="gp-kicker">引导 · {{ stepIndex + 1 }} / {{ totalSteps }}</span>
          <button type="button" class="gp-close" aria-label="关闭当前提示" @click="closeAndRestoreFocus">×</button>
        </header>
        <h4 class="gp-title">{{ step.title }}</h4>
        <p class="gp-body">{{ step.body }}</p>
        <p v-if="!targetRect" class="gp-fallback-note">当前目标在折叠区域或尚未显示，可按提示找到对应位置，或点「下一步」继续。</p>
        <footer class="gp-foot">
          <button type="button" class="m-btn xs ghost" @click="skipScene">跳过本段</button>
          <div class="gp-nav">
            <button v-if="stepIndex > 0" type="button" class="m-btn xs" @click="onboarding.prevStep()">上一步</button>
            <button type="button" class="m-btn xs pri" @click="handleNext">
              {{ stepIndex + 1 < totalSteps ? '下一步' : '知道了' }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'

const props = defineProps<{ blocked?: boolean }>()
const route = useRoute()
const onboarding = useOnboardingStore()
const dialogEl = ref<HTMLElement | null>(null)
const targetRect = ref<DOMRect | null>(null)
const previousFocus = ref<HTMLElement | null>(null)
const blockedByDom = ref(false)
let resizeObserver: ResizeObserver | null = null
let domObserver: MutationObserver | null = null
let observedTarget: Element | null = null
let rafId = 0

const step = computed(() => onboarding.currentStep)
const stepIndex = computed(() => onboarding.activeTour?.stepIndex ?? 0)
const totalSteps = computed(() => onboarding.currentSceneSteps.length)

const routeMatches = computed(() => {
  if (!step.value) return false
  if (step.value.routePrefix === '/') return route.path === '/'
  return route.path.startsWith(step.value.routePrefix)
})

const visible = computed(() => Boolean(step.value && routeMatches.value && !props.blocked && !blockedByDom.value))

function checkDomBlockers() {
  if (typeof document === 'undefined') { blockedByDom.value = false; return }
  blockedByDom.value = Boolean(
    document.querySelector('.m-overlay, [role="alertdialog"], .v3-guide, .v3-palette, .is-focused, .save-banner'),
  )
}

function findVisibleAnchor(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const shell = document.querySelector('.v3') || document.body
  const candidates = shell.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(name)}"]`)
  for (const el of candidates) {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return el
  }
  return null
}

function measure() {
  checkDomBlockers()
  if (!step.value || !routeMatches.value || props.blocked || blockedByDom.value) {
    targetRect.value = null
    return
  }
  const el = findVisibleAnchor(step.value.anchor)
    || (step.value.fallbackAnchor ? findVisibleAnchor(step.value.fallbackAnchor) : null)
  if (el !== observedTarget) {
    if (observedTarget) resizeObserver?.unobserve(observedTarget)
    observedTarget = el
    if (el) resizeObserver?.observe(el)
  }
  if (!el) {
    targetRect.value = null
    return
  }
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    targetRect.value = null
    return
  }
  targetRect.value = rect
}

function scheduleMeasure() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = 0
    measure()
  })
}

const ringStyle = computed(() => {
  const r = targetRect.value
  if (!r) return {}
  const pad = 4
  return {
    top: `${Math.max(2, r.top - pad)}px`,
    left: `${Math.max(2, r.left - pad)}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  }
})

const popoverStyle = computed(() => {
  const r = targetRect.value
  if (!r || typeof window === 'undefined') return {}
  const width = Math.min(320, window.innerWidth - 24)
  const estHeight = 190
  const gap = 12
  let top = r.bottom + gap
  if (top + estHeight > window.innerHeight - 12 && r.top - gap - estHeight > 12) {
    top = r.top - gap - estHeight
  } else {
    top = Math.min(Math.max(12, top), Math.max(12, window.innerHeight - estHeight - 12))
  }
  let left = r.left
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12
  left = Math.max(12, left)
  return { top: `${top}px`, left: `${left}px`, width: `${width}px` }
})

function restoreFocus() {
  const prev = previousFocus.value
  previousFocus.value = null
  if (prev && prev.isConnected) prev.focus({ preventScroll: true })
}

function closeAndRestoreFocus() {
  if (step.value) onboarding.markSeen(step.value.id)
  onboarding.closeTour()
  restoreFocus()
}

function skipScene() {
  onboarding.skipScene()
  restoreFocus()
}

function handleNext() {
  const isLast = stepIndex.value + 1 >= totalSteps.value
  onboarding.nextStep()
  if (isLast) restoreFocus()
}

watch(step, async (next, prev) => {
  if (next && !prev && typeof document !== 'undefined') {
    previousFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  if (!next) {
    targetRect.value = null
    return
  }
  await nextTick()
  measure()
  if (visible.value) dialogEl.value?.focus({ preventScroll: true })
}, { immediate: true })

watch(() => route.fullPath, async () => {
  if (step.value && !routeMatches.value) {
    onboarding.closeTour()
    return
  }
  await nextTick()
  scheduleMeasure()
})

watch(() => props.blocked, () => scheduleMeasure())

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(scheduleMeasure)
  if (typeof MutationObserver !== 'undefined') {
    domObserver = new MutationObserver(scheduleMeasure)
    domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-guide'] })
  }
  window.addEventListener('resize', scheduleMeasure, { passive: true })
  window.addEventListener('scroll', scheduleMeasure, true)
  scheduleMeasure()
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  domObserver?.disconnect()
  window.removeEventListener('resize', scheduleMeasure)
  window.removeEventListener('scroll', scheduleMeasure, true)
})
</script>

<style scoped>
.guide-spotlight-root { position: fixed; inset: 0; z-index: 90; pointer-events: none; }
.guide-highlight-ring {
  position: fixed;
  border: 2px solid var(--zhu);
  border-radius: 8px;
  box-shadow: 0 0 0 4px var(--zhu-soft);
  pointer-events: none;
  transition: top .16s ease, left .16s ease, width .16s ease, height .16s ease;
}
.guide-popover {
  position: fixed;
  pointer-events: auto;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--zhu);
  border-radius: var(--r-m);
  box-shadow: var(--shadow-3);
  padding: 14px 16px;
  display: grid;
  gap: 8px;
  outline: none;
}
.guide-popover.inline-fallback { right: 20px; bottom: 52px; width: min(320px, calc(100vw - 24px)); }
.gp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gp-kicker { font-size: 12px; font-family: var(--f-num); color: var(--zhu); font-weight: 600; }
.gp-close { border: 0; background: transparent; color: var(--ink-3); font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; }
.gp-close:hover { color: var(--ink); }
.gp-title { margin: 0; font: 600 15px/1.4 var(--f-serif); color: var(--ink); }
.gp-body { margin: 0; font-size: 13px; line-height: 1.65; color: var(--ink-2); }
.gp-fallback-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink-3); padding: 6px 8px; border-radius: 6px; background: var(--panel); }
.gp-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
.gp-nav { display: flex; gap: 6px; }
@media (prefers-reduced-motion: reduce) {
  .guide-highlight-ring { transition: none; }
}
</style>
