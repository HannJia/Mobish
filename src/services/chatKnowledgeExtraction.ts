import { callAI } from '@/services/ai'
import { kbCategories } from '@/stores/knowledge'
import type { ModelConfig } from '@/stores/config'
import { parseAiJsonObject } from '@/utils/aiJson'
import { createMarkdownFenceTracker, markdownTitleText } from '@/utils/markdownStructure'

export const CHAT_KNOWLEDGE_EXTRACT_LIMIT = 16_000

export interface ChatKnowledgeExtraction {
  title: string
  category: string
  summary: string
  tags: string[]
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  世界观: ['世界观', '世界设定', '历史背景', '社会制度', '社会结构', '文明', '历法', '宇宙', '天道', '法则', '种族', '货币制度'],
  人物: ['人物', '角色', '主角', '配角', '反派', '男主', '女主', '姓名', '身世', '性格', '人设', '人物关系'],
  势力: ['势力', '组织', '宗门', '门派', '帮派', '教团', '公会', '联盟', '阵营', '家族', '王朝', '宗主'],
  功法: ['功法', '武技', '武学', '技能', '招式', '心法', '秘术', '法术', '修炼', '剑诀', '剑法', '口诀', '运功'],
  道具: ['道具', '宝物', '法宝', '神器', '兵器', '武器', '装备', '材料', '丹药', '符箓', '灵石', '钥匙', '玉佩'],
  地点: ['地点', '地理', '地形', '位于', '坐落', '地图', '城镇', '村落', '山脉', '山谷', '遗迹', '渡口', '港口', '秘境'],
  事件: ['事件', '剧情节点', '时间线', '战役', '战争', '政变', '叛乱', '灾难', '冲突', '事故', '爆发', '经过', '导火索'],
  数值属性: ['数值', '属性', '攻击力', '防御力', '生命值', '伤害值', '血量', '暴击率', '经验值', '属性点', '等级上限', '冷却时间', '成功率'],
}

const CHAT_OPENING = /^(?:(?:好的|好吧|当然可以|没问题|顺着这个思路|顺着这个方向|沿着这个思路)(?=$|[\s，,、。！!：:]|我们|可以)|(?:(?:我|这里)的?建议是|我建议|建议(?:先|将|把|为|用)?(?!书)|我们可以|可以考虑))[\s，,、。！!：:]*/
const TITLE_CLAUSE = /[。！？!?；;，,：:]/

export function inferChatKnowledgeCategory(content: string): string {
  const topic = cleanFallbackTitle(content)
  let best = '其他'
  let bestScore = 0
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((total, keyword) => total + (topic.includes(keyword) ? 3 : Number(content.includes(keyword))), 0)
    if (score > bestScore) {
      bestScore = score
      best = category
    }
  }
  return best
}

function stripChatOpening(text: string): string {
  let current = text
  while (CHAT_OPENING.test(current)) current = current.replace(CHAT_OPENING, '')
  return current
}

export function cleanFallbackTitle(content: string): string {
  const fence = createMarkdownFenceTracker()
  let firstClause = ''
  for (const line of content.split(/\r\n?|\n/)) {
    if (fence.includes(line)) continue
    const title = stripChatOpening(markdownTitleText(line)).split(TITLE_CLAUSE, 1)[0].trim()
    if (!/[\p{L}\p{N}]/u.test(title)) continue
    const shortTitle = Array.from(title).slice(0, 28).join('').trimEnd()
    if (/^\s{0,3}#{1,6}[ \t]+/.test(line)) return shortTitle
    firstClause ||= shortTitle
  }
  return firstClause || '灵感资料'
}

function extractedTitle(value: unknown, content: string): string {
  const title = typeof value === 'string' ? markdownTitleText(value) : ''
  const bodyOpening = markdownTitleText(content.trim().split(/\r\n?|\n/, 1)[0]).split(/[。！？!?]/, 1)[0].trim()
  if (/^[^\r\n]{6,20}$/u.test(title) && /\p{Script=Han}/u.test(title) && !CHAT_OPENING.test(title)
    && title.replace(/[。！？!?]$/, '') !== bodyOpening) return title
  return cleanFallbackTitle(content)
}

function extractedFields(parsed: Record<string, unknown> | null, content: string): ChatKnowledgeExtraction | null {
  const summary = parsed?.summary ?? parsed?.摘要 ?? parsed?.要点
  if (typeof summary !== 'string' || !summary.trim()) return null
  const name = parsed?.title ?? parsed?.标题
  const rawCategory = parsed?.category ?? parsed?.分类
  const category = typeof rawCategory === 'string' ? rawCategory.trim() : ''
  const tags = parsed?.tags ?? parsed?.标签
  return {
    title: extractedTitle(name, content),
    category: category !== '其他' && kbCategories.some(item => item.value === category)
      ? category : inferChatKnowledgeCategory(content),
    summary: summary.trim().slice(0, 12000),
    tags: Array.isArray(tags)
      ? [...new Set(tags.filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 6)
      : [],
  }
}

function plainSummary(text: string): string {
  const cleaned = text.replace(/<(thinking|think|analysis|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^```(?:text|markdown)?\s*|\s*```$/gi, '')
    .replace(/^#{1,4}\s*(?:摘要|要点)\s*[:：]?\s*/i, '')
    .trim()
  if (cleaned.length < 8 || /^[{[]/.test(cleaned) || /^(抱歉|无法完成|不能提供)/.test(cleaned)) return ''
  return cleaned.slice(0, 1800)
}

export async function extractChatKnowledge(
  model: ModelConfig,
  content: string,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<ChatKnowledgeExtraction> {
  const source = content.slice(0, CHAT_KNOWLEDGE_EXTRACT_LIMIT)
  const result = await callAI({
    model,
    taskName: '提取知识条目',
    maxTokens: 4000,
    timeoutMs: 90_000,
    noAutomaticRetry: true,
    stream: true,
    onChunk: () => {},
    signal,
    messages: [
      { role: 'system', content: `从单条对话回复中提取可复用的知识条目。只返回 JSON 对象，字段为 title、category、summary、tags（字符串数组）。
title 必须由你总结为 6~20 字的精炼中文目录标题，清楚概括这条内容的核心主题。禁止照搬正文第一句，禁止以“好的”“顺着这个思路”“建议”等对话寒暄开头。
category 必须从以下分类中自动选择最贴切的一项：${kbCategories.map(item => item.value).join('、')}。内容明显属于具体分类时，不要选择“其他”。
summary 用简洁中文记录原文明确提出的设定、人物、时间、地点、因果、规则和关键数字。不要编造或补全事实；区分小说构想与有来源的史实，不把建议或猜测写成已证实事实。不要把“参考来源”列表当成事实。不要重复整段原文。
tags 最多 6 个，每项为简明关键词。` },
      { role: 'user', content: source },
    ],
  })
  const parsed = extractedFields(parseAiJsonObject<Record<string, unknown>>(result.content), content)
  if (parsed) return parsed

  if (signal?.aborted) throw signal.reason || new DOMException('请求已取消', 'AbortError')
  onRetry?.()
  const retry = await callAI({
    model,
    taskName: '重试提取知识摘要',
    maxTokens: 4000,
    timeoutMs: 90_000,
    noAutomaticRetry: true,
    stream: true,
    onChunk: () => {},
    signal,
    messages: [
      { role: 'system', content: '只根据收到的对话回复，提取其中明确提出的设定和关键数字。不要编造，不把建议或猜测当作事实，不要把来源列表当作事实。只输出简洁中文摘要，不要 JSON 或分析过程。' },
      { role: 'user', content: source },
    ],
  })
  const structuredRetry = extractedFields(parseAiJsonObject<Record<string, unknown>>(retry.content), content)
  if (structuredRetry) return structuredRetry
  const summary = plainSummary(retry.content)
  if (summary) return { title: cleanFallbackTitle(content), category: inferChatKnowledgeCategory(content), summary, tags: [] }
  throw new Error('模型未返回可用摘要。可更换对话模型后重试')
}
