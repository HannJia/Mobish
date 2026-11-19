// V3 的提示与确认框，替代 Naive 的 useMessage / useDialog，调用方式保持一致：
//   const message = useMessage(); message.success('已保存')
//   const dialog = useDialog(); dialog.warning({ title, content, positiveText, negativeText, onPositiveClick })
// 确认框由 V3Shell 里的 V3DialogHost 渲染；没有挂载外壳时（例如单元测试）调用也不会报错。
import { reactive } from 'vue'
import { toast, type V3ToastKind } from './shell'

export interface MessageReactive { destroy: () => void }
export type MessageApi = Record<V3ToastKind, (content: string) => MessageReactive>

const messageApi: MessageApi = {
  success: content => ({ destroy: toast(content, { kind: 'success' }) }),
  info: content => ({ destroy: toast(content, { kind: 'info' }) }),
  warning: content => ({ destroy: toast(content, { kind: 'warning' }) }),
  error: content => ({ destroy: toast(content, { kind: 'error' }) }),
}
export function useMessage(): MessageApi { return messageApi }

/** 回调返回 false（或解析为 false 的 Promise）时确认框保持打开，例如保存失败后允许重试。 */
type DialogCallback = () => unknown
export interface DialogOptions {
  title: string
  content?: string
  positiveText?: string
  negativeText?: string
  onPositiveClick?: DialogCallback
  onNegativeClick?: DialogCallback
  /** Esc、关闭按钮或点击遮罩关闭时调用。 */
  onClose?: () => void
  onMaskClick?: () => void
}
export type DialogKind = 'warning' | 'info' | 'error' | 'success'
export interface V3DialogItem extends DialogOptions { id: number; kind: DialogKind; busy: boolean }
export interface DialogReactive { destroy: () => void }

export const dialogs = reactive<V3DialogItem[]>([])
let dialogSeq = 0

function removeDialog(id: number) {
  const index = dialogs.findIndex(item => item.id === id)
  if (index >= 0) dialogs.splice(index, 1)
}

function openDialog(kind: DialogKind, options: DialogOptions): DialogReactive {
  const id = ++dialogSeq
  dialogs.push({ ...options, id, kind, busy: false })
  return { destroy: () => removeDialog(id) }
}

/** 点击确认或取消：等待回调完成，回调返回 false 时不关闭。 */
export async function runDialogAction(id: number, action: 'positive' | 'negative') {
  const item = dialogs.find(dialog => dialog.id === id)
  if (!item || item.busy) return
  const callback = action === 'positive' ? item.onPositiveClick : item.onNegativeClick
  item.busy = true
  try {
    const result = await callback?.()
    if (result !== false) removeDialog(id)
  } finally {
    const current = dialogs.find(dialog => dialog.id === id)
    if (current) current.busy = false
  }
}

/** Esc、关闭按钮或遮罩关闭；确认回调执行期间不能关闭。 */
export function dismissDialog(id: number) {
  const item = dialogs.find(dialog => dialog.id === id)
  if (!item || item.busy) return
  removeDialog(id)
  item.onClose?.()
  item.onMaskClick?.()
}

const dialogApi = {
  warning: (options: DialogOptions) => openDialog('warning', options),
  info: (options: DialogOptions) => openDialog('info', options),
  error: (options: DialogOptions) => openDialog('error', options),
  success: (options: DialogOptions) => openDialog('success', options),
}
export type DialogApi = typeof dialogApi
export function useDialog(): DialogApi { return dialogApi }
