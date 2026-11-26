// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createEmptyCreationDraft, type StoryContract } from '@/types/reconstruction'
import StoryContractEditor from './StoryContractEditor.vue'
import { confirmTestContractCards } from '@/test/contractCardsFixture'

beforeEach(() => setActivePinia(createPinia()))
describe('contract card author confirmation', () => {
  it('uses compact cards, expands editing and revokes only the changed card until explicitly confirmed', async () => {
    const contract = createEmptyCreationDraft({ id: 'test', now: '2026-11-10T00:00:00.000Z' }).contract
    Object.assign(contract, { approval: 'approved', title: '渡口', genre: '悬疑', centralConflict: '查信', endingDirection: '离开' })
    Object.assign(contract, confirmTestContractCards(contract, contract.updatedAt))
    const wrapper = mount(StoryContractEditor, { props: { contract, cancelable: true } })
    await wrapper.get('footer .cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.findAll('.card-summary')).toHaveLength(9)
    expect(wrapper.text()).toContain('已确认 9 / 9')
    await wrapper.get('[aria-label="编辑视角与文风"]').trigger('click')
    await wrapper.get('[aria-label="叙事视角"]').setValue('第一人称')
    expect(wrapper.text()).toContain('已确认 8 / 9')
    const changed = wrapper.emitted('change')!.slice(-1)[0][0] as StoryContract
    expect(changed.cardConfirmations).toHaveLength(8)
    expect(changed.cardConfirmations!.some(item => item.cardId === 'theme')).toBe(true)
    await wrapper.get('[aria-label="确认视角与文风"]').trigger('click')
    expect(wrapper.text()).toContain('已确认 9 / 9')
    expect(wrapper.findAll('.card-summary')).toHaveLength(9)
    await wrapper.get('.story-contract > form').trigger('submit')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('formats word count in wan when collapsed and prompts before filling undecided on blank romance/ending', async () => {
    const contract = createEmptyCreationDraft({ id: 'test-2', now: '2026-11-10T00:00:00.000Z' }).contract
    Object.assign(contract, { targetWordCountMin: 803201, targetWordCountMax: 1200000, romanceDirection: '', endingDirection: '' })
    const wrapper = mount(StoryContractEditor, { props: { contract } })
    expect(wrapper.get('[aria-label="编辑篇幅与节奏"]').text()).toContain('80.32万字至120万字')
    await wrapper.get('[aria-label="编辑篇幅与节奏"]').trigger('click')
    expect((wrapper.get('input[aria-label="最少字数"]').element as HTMLInputElement).value).toBe('803201')
    await wrapper.get('[aria-label="确认结局方向"]').trigger('click')
    expect(wrapper.find('.blank-confirm').text()).toContain('是否暂不确定')
    await wrapper.get('.blank-confirm .blank-accept').trigger('click')
    const latest = wrapper.emitted('change')!.slice(-1)[0][0] as StoryContract
    expect(latest.endingDirection).toBe('暂不确定')
    expect(wrapper.text()).toContain('已确认 1 / 9')
    wrapper.unmount()
  })
})
