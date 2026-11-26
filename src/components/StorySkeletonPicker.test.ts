// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StorySkeletonPicker from './StorySkeletonPicker.vue'
import type { PlotSkeleton, SkeletonSourceSelection } from '@/types/reconstruction'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'

vi.mock('@/services/ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))

const skeleton = (key: string, over: Partial<PlotSkeleton> = {}): PlotSkeleton => ({
  id: 'sk-' + key, revisionId: 'rev-' + key, title: '方案' + key, premise: key + '的前提', logline: key + '的主线', promise: key + '的承诺', ending: key + '的结局',
  beats: [{ id: 'b-' + key + '-1', title: key + '开端', description: key + '的开端内容', kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] },
    { id: 'b-' + key + '-2', title: key + '转折', description: key + '的转折内容', kind: 'turning_point', relatedPlotlineIds: [], relatedCharacterIds: [] }],
  approval: 'draft', updatedAt: '2026-11-09T00:00:00Z', ...over,
})

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(StorySkeletonPicker, { props: { skeletons: [skeleton('甲'), skeleton('乙'), skeleton('丙')], selectedId: 'sk-甲', ...props } })
}

describe('故事骨架三视图与方案台换写法', () => {
  it('默认展示三列方案对照卡片、主线在前与情节曲线，并支持切换情节结构泳道视图', async () => {
    const wrapper = mountPicker()
    expect(wrapper.findAll('.cards .card')).toHaveLength(3)
    expect(wrapper.findAll('.cards .c-title').map(node => node.text())).toEqual(['方案甲', '方案乙', '方案丙'])
    expect(wrapper.findAll('.cards .c-logline').map(node => node.text())).toEqual(['甲的主线', '乙的主线', '丙的主线'])
    expect(wrapper.findAll('.cards svg.shape')).toHaveLength(3)

    await wrapper.findAll('.seg button')[1].trigger('click')
    expect(wrapper.findAll('.lanes .lane')).toHaveLength(3)
    await wrapper.find('.lanes .track li button').trigger('click')
    expect(wrapper.get('.lane-detail').text()).toContain('甲的开端内容')
  })

  it('在方案台通过红框换写法切换字段来源并组合为新的可编辑候选', async () => {
    const wrapper = mountPicker()
    await wrapper.get('button[aria-label="整列选用：方案甲"]').trigger('click')
    expect(wrapper.find('.desk').exists()).toBe(true)
    await wrapper.get('button[aria-label="结局方向 · 方案丙"]').trigger('click')
    expect((wrapper.get('textarea[aria-label="结局方向"]').element as HTMLTextAreaElement).value).toBe('丙的结局')
    expect(wrapper.get('.mix-bar').text()).toContain('方案甲×6 · 方案丙×1')

    const mix = wrapper.findAll('button').find(button => button.text().trim() === '组合为新的可编辑候选')!
    expect(mix.attributes('disabled')).toBeUndefined()
    await mix.trigger('click')
    const sources = wrapper.emitted('mix')![0][0] as SkeletonSourceSelection[]
    expect(sources.slice(0, 5)).toEqual([
      { field: 'title', revisionId: 'rev-甲' }, { field: 'logline', revisionId: 'rev-甲' },
      { field: 'premise', revisionId: 'rev-甲' }, { field: 'promise', revisionId: 'rev-甲' },
      { field: 'ending', revisionId: 'rev-丙' },
    ])
    expect(sources.slice(5).map(source => [source.revisionId, source.beatId])).toEqual([['rev-甲', 'b-甲-1'], ['rev-甲', 'b-甲-2']])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('有未保存的作者输入时不允许混合，并说明原因', async () => {
    const wrapper = mountPicker({ dirty: true })
    await wrapper.get('button[aria-label="整列选用：方案甲"]').trigger('click')
    await wrapper.get('button[aria-label="结局方向 · 方案乙"]').trigger('click')
    expect(wrapper.get('.mix-hint').text()).toContain('请先保存当前作者版本')
    expect(wrapper.findAll('button').find(button => button.text().trim() === '组合为新的可编辑候选')!.attributes('disabled')).toBeDefined()
  })

  it('检查组合冲突并应用作者取舍后保留取舍理由', async () => {
    setActivePinia(createPinia())
    const config = useConfigStore()
    const getModel = vi.spyOn(config, 'getModelForTask').mockReturnValue({ apiKey: 'test', maxTokens: 2000 } as NonNullable<ReturnType<typeof config.getModelForTask>>)
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ conflicts: [
      { left: 3, right: 5, conflict: '结局假定前提中的城门还开着。', options: ['把结局改为在城外会合。', '在前提中提前打开城门。'] },
    ] }) })
    const wrapper = mountPicker()
    await wrapper.get('button[aria-label="整列选用：方案甲"]').trigger('click')
    await wrapper.get('button[aria-label="结局方向 · 方案乙"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text().trim() === '检查组合冲突')!.trigger('click')
    await flushPromises()
    const review = wrapper.get('.conflicts')
    expect(review.text()).toContain('把结局改为在城外会合。')
    const mix = wrapper.findAll('button').find(button => button.text().trim() === '组合为新的可编辑候选')!
    expect(mix.attributes('disabled')).toBeDefined()
    await review.findAll('input[type="radio"]')[0].setValue(true)
    await review.get('input[aria-label="取舍理由 1"]').setValue('闭门要推动第一幕。')
    await mix.trigger('click')
    const [sources, receipt] = wrapper.emitted('mix')![0] as [SkeletonSourceSelection[], { original: SkeletonSourceSelection[] }]
    expect(sources[4].revisionId).toBe('rev-甲')
    expect(receipt.original[4].revisionId).toBe('rev-乙')
    const candidate = skeleton('混合')
    candidate.beats.forEach((beat, index) => { beat.id = sources[index + 5].targetBeatId! })
    await wrapper.setProps({ skeletons: [skeleton('甲'), skeleton('乙'), candidate], selectedId: candidate.id })
    expect(wrapper.get('details.mix-review-saved').text()).toContain('闭门要推动第一幕。')
    wrapper.unmount()
    localStorage.clear()
    getModel.mockRestore()
  })

  it('标出方案台编辑中、正式方向与未完整状态，且点击顶部胶囊可切换选中方案', async () => {
    const wrapper = mountPicker({ confirmedId: 'sk-乙', skeletons: [skeleton('甲'), skeleton('乙'), skeleton('丙', { complete: false })] })
    const metaTexts = wrapper.findAll('.cards .c-meta').map(node => node.text())
    expect(metaTexts[0]).toContain('方案台编辑中')
    expect(metaTexts[1]).toContain('✓ 正式方向')
    expect(metaTexts[2]).toContain('未完整，需要补齐后保存')
    await wrapper.findAll('.index button')[2].trigger('click')
    expect(wrapper.emitted('select')![0]).toEqual(['sk-丙'])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('没有候选方案时展示空白起步页并提供手写与重新生成', async () => {
    const wrapper = mountPicker({ skeletons: [], selectedId: undefined })
    expect(wrapper.find('.cards').exists()).toBe(false)
    expect(wrapper.get('footer').text()).toContain('选择一个方案，或手写新方案')
    await wrapper.findAll('button').find(button => button.text().trim() === '手写新方案')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().trim() === '重新生成候选')!.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('regenerate')).toHaveLength(1)
  })
})
