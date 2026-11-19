// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { dialogs, dismissDialog, runDialogAction, useDialog, useMessage } from './feedback'
import { toasts } from './shell'
import V3DialogHost from './components/V3DialogHost.vue'

afterEach(() => { dialogs.splice(0); toasts.splice(0); vi.useRealTimers() })

describe('V3 messages', () => {
  it('shows each kind as a toast and lets the caller dismiss it early', () => {
    vi.useFakeTimers()
    const message = useMessage()
    message.success('已保存'); message.warning('请先选择模型')
    const error = message.error('保存失败')
    expect(toasts.map(item => [item.kind, item.text])).toEqual([['success', '已保存'], ['warning', '请先选择模型'], ['error', '保存失败']])
    error.destroy()
    expect(toasts.some(item => item.text === '保存失败')).toBe(false)
    vi.advanceTimersByTime(3000)
    expect(toasts.map(item => item.text)).toEqual(['请先选择模型'])
    vi.advanceTimersByTime(2000)
    expect(toasts).toHaveLength(0)
  })
})

describe('V3 confirmation dialogs', () => {
  it('closes after a successful positive action and keeps busy dialogs open', async () => {
    let finish!: () => void
    const onPositiveClick = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    useDialog().warning({ title: '删除章节', content: '删除？', positiveText: '删除', negativeText: '取消', onPositiveClick })
    const id = dialogs[0].id
    const running = runDialogAction(id, 'positive')
    expect(dialogs[0].busy).toBe(true)
    void runDialogAction(id, 'positive')
    dismissDialog(id)
    expect(onPositiveClick).toHaveBeenCalledOnce()
    expect(dialogs).toHaveLength(1)
    finish(); await running
    expect(dialogs).toHaveLength(0)
  })

  it('stays open for retry when the positive action returns false', async () => {
    const onPositiveClick = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    useDialog().warning({ title: '删除', positiveText: '删除', onPositiveClick })
    const id = dialogs[0].id
    await runDialogAction(id, 'positive')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].busy).toBe(false)
    await runDialogAction(id, 'positive')
    expect(dialogs).toHaveLength(0)
  })

  it('reports dismissal through onClose and supports destroy without callbacks', () => {
    const onClose = vi.fn(), onPositiveClick = vi.fn()
    useDialog().warning({ title: '放弃修改？', positiveText: '放弃修改', onClose, onPositiveClick })
    dismissDialog(dialogs[0].id)
    expect(onClose).toHaveBeenCalledOnce()
    const handle = useDialog().info({ title: '规划完成', positiveText: '创建章节', onPositiveClick, onClose })
    handle.destroy()
    expect(dialogs).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPositiveClick).not.toHaveBeenCalled()
  })

  it('renders the content and both actions, marking destructive confirmations', async () => {
    const onPositiveClick = vi.fn(), onNegativeClick = vi.fn()
    const wrapper = mount(V3DialogHost, { attachTo: document.body })
    useDialog().warning({ title: '删除知识库', content: '删除「甲」？', positiveText: '删除', negativeText: '取消', onPositiveClick, onNegativeClick })
    await flushPromises()
    expect(wrapper.text()).toContain('删除「甲」？')
    const buttons = wrapper.findAll('.m-modal-f button')
    expect(buttons.map(button => button.text())).toEqual(['取消', '删除'])
    expect(buttons[1].classes()).toContain('v3-dialog-danger')
    await buttons[0].trigger('click'); await flushPromises()
    expect(onNegativeClick).toHaveBeenCalledOnce()
    expect(onPositiveClick).not.toHaveBeenCalled()
    expect(wrapper.find('.m-modal').exists()).toBe(false)
    wrapper.unmount()
  })
})
