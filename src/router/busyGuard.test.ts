import { afterEach, describe, expect, it } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { cloudApplyBusy, projectTransferBusy } from '@/services/appLifecycle'
import { toasts } from '@/v3/shell'
import { blockNavigationWhileProjectBusy } from './busyGuard'

const route = (fullPath: string) => ({ fullPath } as RouteLocationNormalized)

afterEach(() => { cloudApplyBusy.value = false; projectTransferBusy.value = false; toasts.splice(0) })

describe('blockNavigationWhileProjectBusy', () => {
  it('lets every navigation through, with no message, when nothing is running', () => {
    expect(blockNavigationWhileProjectBusy(route('/'), route('/write/a/b'))).toBe(true)
    expect(toasts).toHaveLength(0)
  })

  it('blocks and explains once while a backup, import or restore is running', () => {
    projectTransferBusy.value = true
    expect(blockNavigationWhileProjectBusy(route('/'), route('/write/a/b'))).toBe(false)
    expect(blockNavigationWhileProjectBusy(route('/'), route('/write/a/b'))).toBe(false)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toContain('备份')
  })

  it('names cloud sync when that is what is applying data, and stays silent for a same-page request', () => {
    cloudApplyBusy.value = true
    expect(blockNavigationWhileProjectBusy(route('/write/a/b'), route('/write/a/b'))).toBe(false)
    expect(toasts).toHaveLength(0)
    expect(blockNavigationWhileProjectBusy(route('/'), route('/write/a/b'))).toBe(false)
    expect(toasts[0].text).toContain('云同步')
  })
})
