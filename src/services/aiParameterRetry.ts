// 模型不支持某个请求参数时（如部分推理模型不接受 temperature / top_p），
// 去掉该参数重试。只处理 400/422 且报错里点名了参数的情况；密钥、额度、内容审核等错误不重试。

/** 可以安全去掉的参数（去掉后服务商用自己的默认值）。 */
const DROPPABLE = ['temperature', 'top_p', 'response_format', 'thinking', 'presence_penalty', 'frequency_penalty'] as const
/** 每次请求最多因参数问题重试几次。 */
export const MAX_PARAMETER_RETRIES = 3

const NOT_PARAMETER_ERROR = /api[_ ]?key|unauthori[sz]ed|authentication|insufficient|quota|balance|余额|欠费|rate limit|content[_ ]?(filter|policy)|sensitive|审核|违规/i
const UNSUPPORTED_HINT = /unsupported|not support|does not support|isn'?t supported|not allowed|invalid|unrecognized|unknown|extra (?:inputs|fields)|不支持|无效|未知|不允许/i

/**
 * 根据报错决定怎么改请求体；返回 null 表示不是参数问题，不应重试。
 * max_tokens 被拒且提示改用 max_completion_tokens 时改名，其余点名参数直接去掉。
 */
export function adjustBodyForParameterError(status: number, errorText: string, body: Record<string, unknown>): { body: Record<string, unknown>; dropped: string } | null {
  if (status !== 400 && status !== 422) return null
  const text = errorText.slice(0, 4000)
  if (NOT_PARAMETER_ERROR.test(text) || !UNSUPPORTED_HINT.test(text)) return null
  if ('max_tokens' in body && /max_tokens/.test(text) && /max_completion_tokens/.test(text)) {
    const { max_tokens: value, ...rest } = body
    return { body: { ...rest, max_completion_tokens: value }, dropped: 'max_tokens' }
  }
  const field = DROPPABLE.find(name => name in body && new RegExp(`\\b${name}\\b`).test(text))
  if (!field) return null
  const { [field]: _removed, ...rest } = body
  return { body: rest, dropped: field }
}

/** 发送请求；遇到参数不受支持的 400 时去掉该参数重发，返回最终响应。 */
export async function fetchWithParameterRetry(
  send: (body: Record<string, unknown>) => Promise<Response>,
  initialBody: Record<string, unknown>,
): Promise<Response> {
  let body = initialBody
  for (let attempt = 0; ; attempt++) {
    const response = await send(body)
    if (response.ok || attempt >= MAX_PARAMETER_RETRIES || (response.status !== 400 && response.status !== 422)) return response
    const text = await response.clone().text().catch(() => '')
    const adjusted = adjustBodyForParameterError(response.status, text, body)
    if (!adjusted) return response
    console.warn(`模型不支持参数 ${adjusted.dropped}，已去掉后重试`)
    body = adjusted.body
  }
}
