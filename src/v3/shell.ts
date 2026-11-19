// V3 外壳的共享状态：提示、命令面板、当前作品与各区入口。
import { reactive, ref } from 'vue'
import type { ThemeName } from '@/stores/theme'
import { describeError } from '@/services/userFacingError'

export type V3ToastKind = 'success' | 'info' | 'warning' | 'error'
export interface V3Toast { id: number; text: string; error?: boolean; kind: V3ToastKind; /** 内部错误的原始信息，可复制为诊断信息。 */ detail?: string | null }
export const toasts = reactive<V3Toast[]>([])
let toastSeq = 0
function removeToast(id: number) { const i = toasts.findIndex(t => t.id === id); if (i >= 0) toasts.splice(i, 1) }
/** 显示一条提示，返回可提前关闭它的函数。错误和警告停留更久。 */
export function toast(text: string, options: { error?: boolean; kind?: V3ToastKind; ms?: number } = {}) {
  const kind = options.kind ?? (options.error ? 'error' : 'success')
  const described = kind === 'error' ? describeError(text) : { text, detail: null }
  const item = { id: ++toastSeq, text: described.text, error: kind === 'error', kind, detail: described.detail }
  toasts.push(item)
  const timer = setTimeout(() => removeToast(item.id), options.ms ?? (item.detail ? 12000 : kind === 'error' ? 5200 : kind === 'warning' ? 4200 : 2600))
  return () => { clearTimeout(timer); removeToast(item.id) }
}
export function toastError(error: unknown, fallback: string) {
  toast(error instanceof Error && error.message ? error.message : fallback, { error: true })
}

export const paletteOpen = ref(false)

/** 命令面板发给写作台的操作；写作台监听 seq 变化执行。 */
export type WriteCommandName = 'completion' | 'focus' | 'review' | 'save'
export const writeCommand = ref<{ name: WriteCommandName; seq: number } | null>(null)
let writeCommandSeq = 0
export function requestWriteCommand(name: WriteCommandName) { writeCommand.value = { name, seq: ++writeCommandSeq } }

const BOOK_KEY = 'mojian-v3-current-book'
export function rememberBook(novelId: string) { try { localStorage.setItem(BOOK_KEY, novelId) } catch { /* 仅为便利 */ } }
export function recalledBook(): string { try { return localStorage.getItem(BOOK_KEY) || '' } catch { return '' } }

export const THEME_LABEL: Record<ThemeName, string> = { fanqie: '宣纸', eyecare: '青瓷', dark: '夜墨' }
export const THEME_ORDER: ThemeName[] = ['fanqie', 'eyecare', 'dark']
export const nextTheme = (current: ThemeName): ThemeName => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]

export type BookArea = 'write' | 'plan' | 'codex' | 'review' | 'auto'
/** 作品各区的唯一入口。 */
export function areaPath(area: BookArea, novelId: string, chapterId?: string): string {
  switch (area) {
    case 'write': return chapterId ? `/write/${novelId}/${chapterId}` : `/write/${novelId}`
    case 'plan': return `/plan/${novelId}`
    case 'codex': return `/codex/${novelId}`
    case 'review': return `/review/${novelId}`
    case 'auto': return `/auto/${novelId}`
  }
}
