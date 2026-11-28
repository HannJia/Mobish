// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import GuideChecklist from './GuideChecklist.vue'
import GuideSpotlight from './GuideSpotlight.vue'
import GuideBeacon from './GuideBeacon.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useNovelStore } from '@/stores/novel'
import { ONBOARDING_STORAGE_KEY } from '@/services/onboardingGuide'

function makeRouter(initial = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/create', component: { template: '<div />' } },
      { path: '/settings', component: { template: '<div />' } },
      { path: '/write/:novelId/:chapterId', component: { template: '<div />' } },
    ],
  })
  void router.push(initial)
  return router
}

describe('P0 onboarding UI components', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    const onboarding = useOnboardingStore()
    await onboarding.initialize({ hadPreExistingSnapshot: false, checkBreakdownJobs: async () => 0 })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('GuideChecklist offers manual & AI paths for new users, switches routes, and supports collapse/disable/replay', async () => {
    const router = makeRouter('/')
    await router.isReady()
    const wrapper = mount(GuideChecklist, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('先自己写（无需配置 AI）')
    expect(wrapper.text()).toContain('先配置 AI 模型')

    await wrapper.get('[data-guide-path="manual"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/create')
    expect(useOnboardingStore().state.path).toBe('manual')
    expect(useOnboardingStore().activeTour?.scene).toBe('create_picker')
    expect(wrapper.text()).toContain('已完成 0 / 2')

    await wrapper.findAll('button').find(b => b.text() === '收起')?.trigger('click')
    expect(useOnboardingStore().state.checklist).toBe('collapsed')
    await wrapper.findAll('button').find(b => b.text() === '不再提示')?.trigger('click')
    expect(useOnboardingStore().showChecklist).toBe(false)

    useOnboardingStore().replay()
    await flushPromises()
    expect(useOnboardingStore().showChecklist).toBe(true)
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{}').enabled).toBe(true)
    wrapper.unmount()
  })

  it('GuideSpotlight navigates steps, closes on Esc, and yields when a modal overlay is present', async () => {
    const router = makeRouter('/create')
    await router.isReady()
    const anchor = document.createElement('div')
    anchor.className = 'v3'
    const btn = document.createElement('button')
    btn.setAttribute('data-guide', 'create.mode')
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, right: 260, bottom: 140, width: 160, height: 40, x: 100, y: 100, toJSON: () => ({}),
    })
    anchor.appendChild(btn)
    document.body.appendChild(anchor)

    const onboarding = useOnboardingStore()
    onboarding.startTour('create_picker')
    const wrapper = mount(GuideSpotlight, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    const dialog = document.body.querySelector('.guide-popover') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('选择创作方式')
    expect(dialog.textContent).toContain('1 / 3')

    const nextBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent?.trim() === '下一步')!
    nextBtn.click()
    await flushPromises()
    expect(document.body.querySelector('.guide-popover')?.textContent).toContain('2 / 3')

    // Yields cleanly when blocked prop is true
    await wrapper.setProps({ blocked: true })
    await flushPromises()
    expect(document.body.querySelector('.guide-popover')).toBeNull()

    await wrapper.setProps({ blocked: false })
    await flushPromises()
    expect(document.body.querySelector('.guide-popover')).not.toBeNull()

    // Esc closes tour and marks step seen
    const activeDialog = document.body.querySelector('.guide-popover') as HTMLElement
    activeDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(onboarding.activeTour).toBeNull()
    expect(onboarding.isSeen('create.origin')).toBe(true)
    wrapper.unmount()
  })

  it('GuideBeacon displays for new users, triggers tour on click, and hides permanently once seen', async () => {
    const onboarding = useOnboardingStore()
    const wrapper = mount(GuideBeacon, { props: { beaconId: 'write.mode', scene: 'write_first' } })
    expect(wrapper.find('.guide-beacon').exists()).toBe(true)
    expect(wrapper.text()).toContain('模式说明')

    await wrapper.get('.guide-beacon').trigger('click')
    expect(onboarding.activeTour?.scene).toBe('write_first')
    expect(onboarding.isSeen('write.mode')).toBe(true)
    expect(wrapper.find('.guide-beacon').exists()).toBe(false)

    // Existing users never see beacons
    setActivePinia(createPinia())
    localStorage.clear()
    const novels = useNovelStore()
    novels.novels.push({ id: 'old', title: '旧书', status: 'writing', chapters: [] } as never)
    const existingOnboarding = useOnboardingStore()
    await existingOnboarding.initialize({ hadPreExistingSnapshot: true, checkBreakdownJobs: async () => 0 })
    const existingWrapper = mount(GuideBeacon, { props: { beaconId: 'write.mode', scene: 'write_first' } })
    expect(existingWrapper.find('.guide-beacon').exists()).toBe(false)
    wrapper.unmount()
    existingWrapper.unmount()
  })

  it('GuideSpotlight falls back to desk tab anchor for P1 margin notes and skips scene beacons cleanly', async () => {
    const router = makeRouter('/write/n1/c1')
    await router.isReady()
    const shell = document.createElement('div')
    shell.className = 'v3'
    const deskTab = document.createElement('button')
    deskTab.setAttribute('data-guide', 'write.margin.desk')
    vi.spyOn(deskTab, 'getBoundingClientRect').mockReturnValue({
      top: 120, left: 600, right: 680, bottom: 156, width: 80, height: 36, x: 600, y: 120, toJSON: () => ({}),
    })
    shell.appendChild(deskTab)
    document.body.appendChild(shell)

    const onboarding = useOnboardingStore()
    onboarding.startTour('write_deep', 'write.margin')
    const spotlight = mount(GuideSpotlight, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()
    const popover = document.body.querySelector('.guide-popover') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.textContent).toContain('查看页边朱批')
    expect(popover.classList.contains('inline-fallback')).toBe(false)

    // Skipping write_deep hides all write_deep beacons while keeping other scenes active
    const beacon = mount(GuideBeacon, { props: { beaconId: 'write.selection' } })
    const planBeacon = mount(GuideBeacon, { props: { beaconId: 'plan.chapters' } })
    expect(beacon.find('.guide-beacon').exists()).toBe(true)
    expect(planBeacon.find('.guide-beacon').exists()).toBe(true)
    onboarding.skipScene('write_deep')
    await flushPromises()
    expect(beacon.find('.guide-beacon').exists()).toBe(false)
    expect(planBeacon.find('.guide-beacon').exists()).toBe(true)

    spotlight.unmount()
    beacon.unmount()
    planBeacon.unmount()
  })
})
