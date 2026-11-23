import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast, toasts } from './shell'

describe('toast grouping (1.1.4)', () => {
  afterEach(() => { toasts.splice(0); vi.useRealTimers() })

  it('keeps only the latest toast of a group', () => {
    toast('主题：夜墨', { group: 'theme' })
    toast('主题：宣纸', { group: 'theme' })
    toast('主题：青瓷', { group: 'theme' })
    expect(toasts.map(item => item.text)).toEqual(['主题：青瓷'])
  })

  it('does not stack an identical toast and restarts its timer', () => {
    vi.useFakeTimers()
    toast('已保存')
    vi.advanceTimersByTime(2000)
    toast('已保存')
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(700)
    expect(toasts).toHaveLength(0)
  })
})
