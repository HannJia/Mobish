import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { registerWindowCloseGuard, windowCloseContext } from './windowClose'

const require = createRequire(import.meta.url)
const { finishWindowClose, approveWindowUnload } = require('../../app-main/windowClose.cjs')

describe('desktop close confirmation', () => {
  it.each(['/create', '/generate/book', '/settings', '/breakdown', '/write/book', '/plan/book', '/codex/book',
    '/knowledge', '/review/book', '/auto/book', '/about'])('protects an empty %s page', path => {
    expect(windowCloseContext(path)).toEqual({ dirty: false, inspiration: false })
  })

  it('closes the shelf directly and gives inspiration sessions their recovery copy', () => {
    const win = { close: vi.fn() }, dialog = { showMessageBoxSync: vi.fn().mockReturnValue(1) }, approve = vi.fn()
    expect(finishWindowClose(win, dialog, windowCloseContext('/'), approve)).toBe(true)
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    const unregister = registerWindowCloseGuard(() => ({ inspiration: true }))
    try {
      expect(finishWindowClose(win, dialog, windowCloseContext('/create'), approve)).toBe(true)
      expect(dialog.showMessageBoxSync.mock.calls[0][1]).toMatchObject({
        detail: expect.stringContaining('历史会话'), buttons: ['继续编辑', '退出'], defaultId: 0, cancelId: 0,
      })
    } finally { unregister() }
    expect(win.close).toHaveBeenCalledTimes(2)
    expect(windowCloseContext('/breakdown/discuss/session')?.inspiration).toBe(true)
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
