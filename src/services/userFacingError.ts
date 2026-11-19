// 把服务层的内部校验错误翻译成用户能看懂的一句话。
// 原始错误不丢弃：作为“诊断信息”保留，用户可以复制后反馈。
// 只翻译下面列出的内部错误；其余错误原样显示（它们本来就是写给用户的提示）。

export interface UserFacingError {
  /** 显示给用户的文字。 */
  text: string
  /** 原始错误；只有翻译过的错误才有。 */
  detail: string | null
}

const SAVE_FAILED = '保存失败，请重试；如果反复出现，请导出备份并反馈。'

const RULES: Array<[RegExp, string]> = [
  [/^备份数据不完整或无效：/, '备份数据校验未通过，文件可能不完整或已损坏。'],
  [/^编辑草稿无效：/, '草稿数据异常，无法恢复或保存。'],
  [/^(AI |摘要)请求账本无效：|付费账本/, 'AI 任务记录已损坏，无法继续这项任务。'],
  [/来源绑定要求/, '内容为空，无法生成摘要。'],
  [/^人物记忆数据无效：|命题身份，已停止投影/, '人物记忆数据不完整，已暂停显示。'],
  [/事务修改必须同步完成|事务不能嵌套执行|事务的版本不属于当前作品/, SAVE_FAILED],
]

export function describeError(raw: string): UserFacingError {
  const message = raw.replace(/^Error:\s*/, '')
  for (const [pattern, text] of RULES) if (pattern.test(message)) return { text, detail: message }
  return { text: message, detail: null }
}

/** 从捕获到的异常取显示文字；没有可用信息时用 fallback。 */
export function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return raw.trim() ? describeError(raw).text : fallback
}

/** 复制到剪贴板的诊断信息。 */
export function diagnosticReport(detail: string, version: string, at = new Date()): string {
  return [`墨笔生花 v${version}`, `时间：${at.toISOString()}`, `原始错误：${detail}`].join('\n')
}
