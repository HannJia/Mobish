// @vitest-environment happy-dom
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { registerWindowCloseGuard, windowCloseContext } from './windowClose'
import router from '@/router'

const require = createRequire(import.meta.url)
const { finishWindowClose, approveWindowUnload } = require('../../app-main/windowClose.cjs')

describe('desktop close confirmation', () => {
  const workspaces = ['/create', '/generate/book', '/settings', '/breakdown', '/breakdown/job',
    '/write/book', '/write/book/chapter', '/plan/book', '/codex/book', '/knowledge', '/knowledge/book',
    '/review/book', '/auto/book', '/characters/book', '/data/book', '/inspiration/book', '/chapters/book', '/outline/book']
  it.each(workspaces)('requires confirmation before closing %s and preserves dirty warnings', path => {
    const route = router.resolve(path)
    expect(route.name).not.toBe('V3NotFound')
    const context = () => windowCloseContext(route.path)
    const win = { close: vi.fn() }
    const dialog = { showMessageBoxSync: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1) }
    const approve = vi.fn()
    expect(context()).toEqual({ dirty: false, inspiration: false })
    expect(finishWindowClose(win, dialog, context(), approve)).toBe(false)
    expect(approve).not.toHaveBeenCalled()
    expect(win.close).not.toHaveBeenCalled()

    const unregister = registerWindowCloseGuard(() => ({ dirty: true }))
    try {
      expect(context()).toEqual({ dirty: true, inspiration: false })
      expect(finishWindowClose(win, dialog, context(), approve)).toBe(true)
      expect(dialog.showMessageBoxSync.mock.calls[1][1].message).toContain('未保存')
      expect(approve).toHaveBeenCalledExactlyOnceWith('confirmed')
      expect(win.close).toHaveBeenCalledOnce()
    } finally { unregister() }
  })

  it('closes the shelf directly even if a guard from the previous page is registered', () => {
    const unregister = registerWindowCloseGuard(() => ({ dirty: true, inspiration: true }))
    try {
      const context = windowCloseContext(router.resolve('/').path)
      const win = { close: vi.fn() }, dialog = { showMessageBoxSync: vi.fn() }, approve = vi.fn()
      expect(context).toBeUndefined()
      expect(finishWindowClose(win, dialog, context, approve)).toBe(true)
      expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
      expect(approve).toHaveBeenCalledExactlyOnceWith('saved')
      expect(win.close).toHaveBeenCalledOnce()
    } finally { unregister() }
  })

  it('gives creation and breakdown discussion their inspiration recovery copy', () => {
    const win = { close: vi.fn() }, dialog = { showMessageBoxSync: vi.fn().mockReturnValue(1) }, approve = vi.fn()
    const unregister = registerWindowCloseGuard(() => ({ inspiration: true }))
    try {
      expect(finishWindowClose(win, dialog, windowCloseContext(router.resolve('/create').path), approve)).toBe(true)
    } finally { unregister() }
    const discussion = windowCloseContext(router.resolve('/breakdown/discuss/session').path)
    expect(discussion).toEqual({ dirty: false, inspiration: true })
    expect(finishWindowClose(win, dialog, discussion, approve)).toBe(true)
    for (const [, options] of dialog.showMessageBoxSync.mock.calls) {
      expect(options).toMatchObject({
        detail: expect.stringContaining('历史会话'), buttons: ['继续编辑', '退出'], defaultId: 0, cancelId: 0,
      })
    }
    expect(win.close).toHaveBeenCalledTimes(2)
  })

  it('cancel keeps the window open, retry prompts once, and approval allows dirty unload', () => {
    const unregister = registerWindowCloseGuard(() => ({ dirty: true }))
    try {
      const win = { close: vi.fn() }, dialog = { showMessageBoxSync: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1) }
      const event = { preventDefault: vi.fn() }, reset = vi.fn()
      let approval: string | undefined
      const approve = (value: string) => { approval = value }
      expect(finishWindowClose(win, dialog, windowCloseContext('/settings'), approve)).toBe(false)
      expect(win.close).not.toHaveBeenCalled()
      expect(finishWindowClose(win, dialog, windowCloseContext('/settings'), approve)).toBe(true)
      approveWindowUnload(event, win, dialog, approval, reset)
      expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(2)
      expect(dialog.showMessageBoxSync.mock.calls[0][1].message).toContain('未保存')
      expect(win.close).toHaveBeenCalledOnce()
      expect(event.preventDefault).toHaveBeenCalledOnce()
    } finally { unregister() }
  })

  it('allows an approved update to unload through the old dirty guard without prompting', () => {
    const event = { preventDefault: vi.fn() }, dialog = { showMessageBoxSync: vi.fn() }
    approveWindowUnload(event, {}, dialog, 'update', vi.fn())
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
  })
})
