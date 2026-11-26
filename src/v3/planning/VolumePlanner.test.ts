// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import VolumeOutline from '@/v3/planning/VolumePlanner.vue'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { createEmptyCreationDraft } from '@/types/reconstruction'

const { route, error, dialog } = vi.hoisted(() => ({ route: { params: { novelId: '' } }, error: vi.fn(), dialog: { warning: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
vi.mock('@/v3/feedback', async original => ({ ...await original<object>(), useMessage: () => ({ error, success: vi.fn(), warning: vi.fn(), info: vi.fn() }), useDialog: () => dialog }))
let wrapper: ReturnType<typeof shallowMount>
type VolumeOutlineProps = { compact?: boolean; chapterPlanConfirmed?: boolean }
function setup(props: VolumeOutlineProps = {}) {
  const store = useNovelStore()
  const created = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  const novel = store.getNovel(created.id)!
  store.updateOutline(novel.id, '原始总纲')
  store.setVolumes(novel.id, [0, 1].map(index => ({ id: 'volume-' + index, volumeIndex: index, title: '卷' + index,
    theme: '', summary: '卷纲' + index, keyTurningPoints: '', characterChanges: '', estimatedChapters: 10, estimatedWordCount: 2, versions: [] })))
  store.setChapterPlanConfirmed(novel.id, true)
  route.params.novelId = novel.id
  const snapshot: ReconstructionWorkspaceSnapshot = { candidates: [], reviewFindings: [], chapterReviews: [], canonMutations: [], aiRuns: [] }
  vi.spyOn(useReconstructionWorkspaceStore(), 'transactStory').mockImplementation(async (id, operation) => operation({ novel: store.getNovel(id)!, workspace: snapshot }))
  vi.spyOn(useConfigStore(), 'getModelForTask').mockReturnValue({ id: 'test', modelName: 'test' } as never)
  wrapper = shallowMount(VolumeOutline, { props, global: { renderStubDefaultSlot: true, stubs: {
  } } })
  return { store, novel }
}
const button = (label: string) => wrapper.findAll('button').find(item => item.text().trim() === label)!
const generated = '## 第1卷《新方向》\n**主题**：调查\n**剧情概要**：找到新线索\n**预估章节数和字数**：约12章，约3万字'
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); vi.mocked(callAI).mockReset() })
afterEach(() => wrapper?.unmount())

describe('volume planning persistence and request baselines', () => {
  it('confirms deletion with the volume name and deletes against the baseline captured on open', async () => {
    const { store, novel } = setup()
    const remove = vi.spyOn(store, 'deleteVolumeWithImpact').mockResolvedValue(true as never)
    const capture = vi.spyOn(store, 'capturePlanningEditBaseline')
    await wrapper.get('button[aria-label="更多操作"]').trigger('click')
    await button('删除本卷').trigger('click')
    expect(remove).not.toHaveBeenCalled()
    const options = dialog.warning.mock.calls[0][0] as { content: string; onPositiveClick: () => void }
    expect(options.content).toContain('第 1 卷「卷0」')
    const opening = capture.mock.results.slice(-1)[0].value
    options.onPositiveClick(); await flushPromises()
    expect(remove).toHaveBeenCalledWith(novel.id, 'volume-0', opening)
  })


  it('renders explicit card fields and separates real chapters from estimates', async () => {
    const { store, novel } = setup()
    novel.volumes[0].summary = '卷纲概要\n**目标**：寻找失踪账册。\n- **冲突**: 守灯人拒绝交出钥匙。\n### 收束：揭开旧案。'
    novel.volumes[0].keyTurningPoints = '查到旧档'
    novel.volumes[0].characterChanges = '沈砚：怀疑 → 追查'
    store.addChapter(novel.id, { title: '第一章', volumeIndex: 0 })
    store.addChapter(novel.id, { title: '第二章', volumeIndex: 0 })
    await flushPromises()

    const cards = wrapper.findAll('.volc')
    expect(cards).toHaveLength(2)
    expect(cards[0].classes()).toContain('cur')
    expect(cards[0].text()).toContain('寻找失踪账册。')
    expect(cards[0].text()).toContain('正文 2 章')
    expect(cards[0].text()).toContain('10 章')
    expect(cards[0].text()).not.toContain('共 10 章')
    const flow = wrapper.find('.volume-flow-grid').text()
    expect(flow).toContain('目标寻找失踪账册。')
    expect(flow).toContain('冲突守灯人拒绝交出钥匙。')
    expect(flow).toContain('转折查到旧档')
    expect(flow).toContain('收束揭开旧案。')

    await cards[1].trigger('click')
    expect(cards[0].classes()).not.toContain('cur')
    expect(cards[1].classes()).toContain('cur')
    expect(cards[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.volume-detail-panel').text()).toContain('卷1')
  })

  it('keeps the master-detail panel visible in compact mode and marks unsaved edits on the list card', async () => {
    setup({ compact: true })
    expect(wrapper.find('.volume-detail-panel').exists()).toBe(true)
    await button('编辑本卷').trigger('click')
    expect(wrapper.find('.edit-form').exists()).toBe(true)
    expect(wrapper.find('.volc.cur .vol-unsaved').text()).toBe('未保存')
    await button('取消修改').trigger('click')
    expect(wrapper.find('.edit-form').exists()).toBe(false)
    expect(wrapper.find('.volume-detail-panel').exists()).toBe(true)
  })

  it('marks missing flow fields as unfilled without treating character changes as closure', async () => {
    const { novel } = setup()
    novel.volumes[0].characterChanges = '人物变化记录'
    await flushPromises()

    const flow = wrapper.find('.volume-flow-grid').text()
    expect(flow).toContain('目标未填写')
    expect(flow).toContain('冲突未填写')
    expect(flow).toContain('收束未填写')
    expect(flow).not.toContain('人物变化记录')
  })

  it('leaves creation-flow confirmation to its parent while keeping volume cards and details', () => {
    setup({ compact: true })
    const labels = wrapper.findAll('button').map(item => item.text().trim())
    expect(wrapper.findAll('.volc')).toHaveLength(2)
    expect(wrapper.find('.volume-nav').exists()).toBe(false)
    expect(labels).not.toContain('确认分卷并生成章节计划')
  })

  it('retains form input after failed save, blocks duplicate actions, and permits retry', async () => {
    const { store, novel } = setup()
    await button('编辑本卷').trigger('click')
    await wrapper.get('textarea[aria-label="本卷目标"]').setValue('作者手写的新卷目标')
    await flushPromises()
    let reject!: (error: Error) => void
    vi.spyOn(store, 'updateVolumeWithImpact').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await button('保存本卷').trigger('click')
    expect(button('保存本卷').attributes('disabled')).toBeDefined()
    expect(button('取消修改').attributes('disabled')).toBeDefined()
    expect(button('确认分卷并生成章节计划').attributes('disabled')).toBeDefined()
    reject(new Error('磁盘失败')); await flushPromises()
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect((wrapper.get('textarea[aria-label="本卷目标"]').element as HTMLTextAreaElement).value).toBe('作者手写的新卷目标')
    await button('保存本卷').trigger('click'); await flushPromises()
    expect(novel.volumes[0].summary).toContain('作者手写的新卷目标')
    expect(novel.chapterPlanConfirmed).toBe(false)
    expect(wrapper.find('.edit-form').exists()).toBe(false)
  })

  it('retains the original form baseline when switching between volume drafts', async () => {
    const { store, novel } = setup()
    await button('编辑本卷').trigger('click')
    await wrapper.get('textarea[aria-label="本卷目标"]').setValue('未保存的作者输入')
    await wrapper.findAll('.volc')[1].trigger('click')
    await store.updateVolumeWithImpact(novel.id, novel.volumes[0].id, { summary: '目标：另一个窗口已保存' })
    await wrapper.findAll('.volc')[0].trigger('click')
    await button('保存本卷').trigger('click'); await flushPromises()
    expect(novel.volumes[0].summary).toBe('目标：另一个窗口已保存')
    expect((wrapper.get('textarea[aria-label="本卷目标"]').element as HTMLTextAreaElement).value).toBe('未保存的作者输入')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('does not clear approval when generation fails before any volume is saved', async () => {
    const { novel } = setup(), before = JSON.stringify(novel.volumes)
    vi.mocked(callAI).mockRejectedValueOnce(new Error('模型失败'))
    await button('AI 重新规划全部').trigger('click'); await flushPromises()
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(JSON.stringify(novel.volumes)).toBe(before)
  })

  it.each(['outline', 'length', 'references', 'contract'] as const)('rejects late generation when %s changed during the request', async field => {
    const { store, novel } = setup(), before = JSON.stringify(novel.volumes)
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await button('AI 重新规划全部').trigger('click')
    if (field === 'outline') store.updateOutline(novel.id, '请求期间的新总纲')
    else if (field === 'length') novel.targetWordCountMax += 5
    else if (field === 'references') novel.knowledgeBaseIds = ['new-reference']
    else useReconstructionWorkspaceStore().setCreationDraft(novel.id, createEmptyCreationDraft({ id: 'new-direction', now: '2026-11-13T00:00:00Z' }))
    release({ content: generated, finishReason: 'stop' } as never); await flushPromises()
    expect(JSON.stringify(novel.volumes)).toBe(before)
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('rejects a late local regeneration after another edit', async () => {
    const { store, novel } = setup()
    let release!: (value: never) => void
    vi.mocked(callAI).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await button('AI 重写本卷').trigger('click')
    await store.updateVolumeWithImpact(novel.id, novel.volumes[0].id, { summary: '新保存的卷纲' })
    release({ content: JSON.stringify({ title: '迟到', summary: '旧请求内容' }) } as never); await flushPromises()
    expect(novel.volumes[0].summary).toBe('新保存的卷纲')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('已经变化'))
  })

  it('invalidates confirmation only after successful generation and prevents a truncated result from replacing it', async () => {
    const { novel } = setup(), before = JSON.stringify(novel.volumes)
    vi.mocked(callAI).mockResolvedValueOnce({ content: generated, finishReason: 'length' } as never)
    await button('AI 重新规划全部').trigger('click'); await flushPromises()
    expect(JSON.stringify(novel.volumes)).toBe(before)
    expect(novel.chapterPlanConfirmed).toBe(true)
    vi.mocked(callAI).mockResolvedValueOnce({ content: generated, finishReason: 'stop' } as never)
    await button('AI 重新规划全部').trigger('click'); await flushPromises()
    expect(novel.volumes).toHaveLength(1)
    expect(novel.volumes[0].title).toContain('新方向')
    expect(novel.chapterPlanConfirmed).toBe(false)
  })

  it('streams volumes progressively into the master-detail view and keeps completed volumes when stopped', async () => {
    const { novel } = setup()
    let emitChunk!: (chunk: string) => void
    let abortSignal!: AbortSignal
    vi.mocked(callAI).mockImplementationOnce((opts: any) => new Promise((_resolve, reject) => {
      emitChunk = opts.onChunk
      abortSignal = opts.signal
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason))
    }))

    await button('AI 重新规划全部').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.volc.pending')).toHaveLength(1)

    emitChunk('## 第1卷《老街的夏天》\n**主题**：留下\n**剧情概要**：\n**目标**：修好第一条旧渔船\n**冲突**：三家料行催债\n**收束**：决定押铺投标\n**预估章节数和字数**：约40章，约10万字\n')
    await flushPromises()
    expect(wrapper.findAll('.volc')).toHaveLength(1)
    expect(wrapper.find('.volume-detail-panel').text()).toContain('老街的夏天')
    expect(wrapper.find('.volume-flow-grid').text()).toContain('修好第一条旧渔船')

    emitChunk('\n## 第2卷《渡船大单》\n**主题**：账本与船台\n**目标**：拿下二十条渡船订单\n')
    await flushPromises()
    expect(wrapper.findAll('.volc')).toHaveLength(2)
    expect(wrapper.findAll('.volc.pending')).toHaveLength(1)
    expect(wrapper.find('.overview').text()).toContain('已规划 1 卷')
    expect(wrapper.find('.volume-detail-panel').text()).toContain('渡船大单')

    ;(wrapper.vm as any).stopAndKeepGeneratedVolumes()
    await flushPromises()
    expect(novel.volumes).toHaveLength(2)
    expect(novel.volumes[0].title).toBe('老街的夏天')
    expect(novel.volumes[1].title).toBe('渡船大单')
    expect(wrapper.find('.volume-detail-panel').text()).toContain('老街的夏天')
  })
})
