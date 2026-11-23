// 把服务商返回的报错翻译成“哪里出了问题、该怎么办”。只看状态码和报错关键词，不发额外请求，不包含密钥。

export interface AiErrorExplanation {
  /** 给用户看的原因和建议 */
  hint: string
  /** 服务商返回的原文（截断），供排查 */
  detail: string
}

const statusOf = (text: string): number | null => {
  const match = /API 请求失败 \((\d{3})\)/.exec(text) || /HTTP_(\d{3})/.exec(text) || /\b(?:status|状态码)\D{0,3}(\d{3})\b/i.exec(text)
  return match ? Number(match[1]) : null
}

export function explainAiError(raw: string): AiErrorExplanation {
  const detail = raw.replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 1200)
  const text = raw.toLowerCase()
  const status = statusOf(raw)
  let hint: string
  if (/abort|已取消|cancel/.test(text) && !status) hint = '测试已取消。'
  else if (/超时|timeout|timed out/.test(text)) hint = '请求超时：服务商长时间没有响应。请稍后再试，或检查网络、代理设置；境外服务在国内通常需要代理。'
  else if (status === 401 || /invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|authentication/.test(text)) {
    hint = '密钥无效（401）：请检查 API 密钥是否填对、复制完整、前后没有多余空格，以及是否已在服务商后台被删除或过期。'
  } else if (status === 403 || /forbidden|permission/.test(text)) {
    hint = /分组|group/.test(text)
      ? '密钥没有调用权限（403）：中转站的分组不允许这样调用（分组被停用、模型不在这个分组里，或分组只允许指定客户端使用）。请到中转站后台换一个允许通用 API 调用的分组 / 令牌，或联系中转站。'
      : '密钥没有调用权限（403）：这个密钥不能调用该模型，或所在地区不被支持。请到服务商后台确认模型权限、账号状态，或换一个密钥。'
  } else if (status === 404 || /model[_ ]not[_ ]found|does not exist|no such model/.test(text)) {
    hint = '找不到接口或模型（404）：请检查接口地址结尾（一般是 /v1）和模型名是否与服务商文档一致，可以点“获取模型”从列表里选。'
  } else if (status === 429 || /rate limit|quota|insufficient|余额|欠费|额度/.test(text)) {
    hint = /quota|insufficient|余额|欠费|额度|balance/.test(text)
      ? '额度不足（429）：账户余额或额度已用完，请到服务商后台充值或查看用量。'
      : '请求太频繁（429）：触发了服务商的频率限制，请稍等片刻再试。'
  } else if (status === 400 || status === 422) {
    hint = `请求参数不被接受（${status}）：可以尝试调小“最大输出”，或在高级参数里清空温度等设置；具体原因见下方原始返回。`
  } else if (status && status >= 500) {
    hint = `服务商暂时出错（${status}）：通常是服务商或中转站的问题，请稍后再试。`
  } else if (/fetch failed|failed to fetch|network|econn|enotfound|socket|证书|certificate/.test(text)) {
    hint = '连不上服务器：请检查接口地址是否正确、网络或代理是否可用；境外服务在国内通常需要代理。'
  } else {
    hint = '连接失败，原因见下方原始返回。'
  }
  return { hint, detail }
}

/** “获取模型”成功但对话失败时补充的一句说明。 */
export const MODEL_LIST_NOT_PERMISSION = '能获取模型列表只说明地址和密钥能连上，不代表有调用权限；其他工具显示“连通”也可能只测了连接。'
