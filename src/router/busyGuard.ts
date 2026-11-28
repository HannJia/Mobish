import type { RouteLocationNormalized } from 'vue-router'
import { cloudApplyBusy, projectTransferBusy } from '@/services/appLifecycle'
import { toast } from '@/v3/shell'

/**
 * 备份、导入、恢复或云同步正在改写项目数据时不允许切换页面。
 * 只有真的因此拦下了一次跳转，才给出一条提示；没有这些操作时不会有任何提示。
 */
export function blockNavigationWhileProjectBusy(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  if (!cloudApplyBusy.value && !projectTransferBusy.value) return true
  if (to.fullPath !== from.fullPath) {
    toast(cloudApplyBusy.value ? '正在应用云同步的数据，完成后再切换页面。' : '正在备份、导入或恢复项目，完成后再切换页面。',
      { kind: 'warning', group: 'navigation-blocked' })
  }
  return false
}
