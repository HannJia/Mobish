// 页面之间的“从哪来、回哪去”：跳转时把来源页完整地址放进 ?returnTo=，目标页据此显示“← 返回典籍”之类的按钮。
// 只接受站内路径，避免把外部地址当作返回目标。

/** 读出安全的站内返回地址；不合法时返回空字符串。 */
export function readReturnTo(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : ''
}

const RETURN_LABELS: Array<[RegExp, string]> = [
  [/^\/write\//, '返回写作'],
  [/^\/codex\//, '返回典籍'],
  [/^\/plan\//, '返回结构'],
  [/^\/review\//, '返回审校'],
  [/^\/auto\//, '返回自动写作'],
  [/^\/characters\//, '返回人物资料'],
  [/^\/data\//, '返回数据面板'],
  [/^\/knowledge(\/|\?|$)/, '返回知识库'],
  [/^\/settings(\?|$)/, '返回设置'],
  [/^\/(\?|$)/, '返回书架'],
]

/** 按返回地址说清楚要回到哪一页，而不是一律写“返回写作”。 */
export function returnLabel(path: string): string {
  return RETURN_LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? '返回上一页'
}
