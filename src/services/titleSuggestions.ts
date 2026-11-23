// 根据作品契约推荐书名：一次给 5 个候选，附一句取名思路。作者点选或自己输入，AI 不会直接改书名。
import type { StoryContract } from '@/types/reconstruction'
import type { ModelConfig } from '@/stores/config'
import { callAI } from './ai'

export interface TitleSuggestion { title: string; reason: string }

const FIELDS: Array<[keyof StoryContract, string]> = [
  ['genre', '类型'], ['subGenre', '子类型'], ['audience', '目标读者'], ['coreTheme', '主题'], ['readerPromise', '读者期待'],
  ['protagonistPremise', '主角'], ['protagonistGoal', '主角目标'], ['centralConflict', '主线冲突'], ['endingDirection', '结局方向'],
  ['styleDirection', '文风'], ['romanceDirection', '感情线'],
]

export function titleSuggestionMessages(contract: StoryContract, avoid: string[] = []) {
  const facts = FIELDS.map(([key, label]) => {
    const value = contract[key]
    return typeof value === 'string' && value.trim() && !/^暂不确定|^暂无$/.test(value.trim()) ? `${label}：${value.trim().slice(0, 400)}` : ''
  }).filter(Boolean)
  if (contract.worldRules?.length) facts.push('世界规则：' + contract.worldRules.slice(0, 5).join('；').slice(0, 400))
  return [
    { role: 'system' as const, content: '你是中文网络小说的起名编辑。只输出 JSON，不要解释。' },
    { role: 'user' as const, content: `根据下面的作品设定，推荐 5 个书名，风格各不相同（如直白爽点型、意象文艺型、悬念型、设定概括型），贴合题材和目标读者；每个书名 2 到 12 个字，不带书名号。
${avoid.length ? `不要重复这些已经给过的书名：${avoid.join('、')}\n` : ''}
【作品设定】
${facts.join('\n') || '（设定很少，请按常见网文题材起名）'}

只输出 JSON：{"titles":[{"title":"书名","reason":"一句话取名思路，不超过 30 字"}]}` },
  ]
}

/** 从模型回复里取出书名候选；去掉书名号、重复项和明显不合格的结果。 */
export function parseTitleSuggestions(content: string): TitleSuggestion[] {
  const text = content.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  let items: unknown[] = []
  try {
    const parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as { titles?: unknown }
    if (Array.isArray(parsed.titles)) items = parsed.titles
  } catch { /* 退回按行解析 */ }
  if (!items.length) {
    items = text.split('\n').map(line => /^\s*(?:\d+[.、)]|[-*])?\s*《?([^《》—\-:：]{2,20})》?\s*(?:[—\-:：]\s*(.*))?$/.exec(line))
      .filter((match): match is RegExpExecArray => !!match).map(match => ({ title: match[1], reason: match[2] || '' }))
  }
  const seen = new Set<string>()
  return items.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const title = String((item as { title?: unknown }).title ?? '').replace(/[《》「」"“”]/g, '').trim()
    const reason = String((item as { reason?: unknown }).reason ?? '').trim().slice(0, 60)
    if (title.length < 2 || title.length > 20 || seen.has(title)) return []
    seen.add(title)
    return [{ title, reason }]
  }).slice(0, 5)
}

export async function suggestTitles(model: ModelConfig, contract: StoryContract, avoid: string[] = [], signal?: AbortSignal): Promise<TitleSuggestion[]> {
  const response = await callAI({ model: { ...model }, messages: titleSuggestionMessages(contract, avoid), signal, taskName: '推荐书名', noAutomaticRetry: true })
  const titles = parseTitleSuggestions(response.content)
  if (!titles.length) throw new Error('模型没有给出可用的书名，请再试一次')
  return titles
}
