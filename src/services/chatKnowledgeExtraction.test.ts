import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callAI } from '@/services/ai'
import { CHAT_KNOWLEDGE_EXTRACT_LIMIT, cleanFallbackTitle, extractChatKnowledge, inferChatKnowledgeCategory } from './chatKnowledgeExtraction'
import type { ModelConfig } from '@/stores/config'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
const model = { id: 'test', name: 'test', modelName: 'test', apiKey: 'synthetic',
  baseUrl: 'https://example.test', maxTokens: 8000 } as ModelConfig

beforeEach(() => vi.resetAllMocks())

describe('chat knowledge extraction', () => {
  it('makes one bounded request and validates extracted fields', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '```json\n{"title":"县城田亩缴粮制度","category":"事件","summary":"每亩缴粮三升。","tags":["税制","县城",17,"县城","田亩","田赋","缴粮","登记","收成"]}\n```' })
    const longContent = '这是一条设定。'.repeat(4000)
    const result = await extractChatKnowledge(model, longContent)
    expect(result).toEqual({ title: '县城田亩缴粮制度', category: '事件', summary: '每亩缴粮三升。', tags: ['税制', '县城', '田亩', '田赋', '缴粮', '登记'] })
    expect(callAI).toHaveBeenCalledOnce()
    expect(vi.mocked(callAI).mock.calls[0][0]).toMatchObject({
      taskName: '提取知识条目', maxTokens: 4000, timeoutMs: 90_000, noAutomaticRetry: true, stream: true,
    })
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toBe(longContent.slice(0, CHAT_KNOWLEDGE_EXTRACT_LIMIT))
    expect(vi.mocked(callAI).mock.calls[0][0].messages[0].content).toContain('禁止照搬正文第一句')
  })

  it.each([undefined, '其他', '假分类'])('infers a clear category when the model returns %s', async category => {
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ title: '好的，这是一个建议', category, summary: '顾槐从小在港口长大。' }) })
    await expect(extractChatKnowledge(model, '好的，顺着这个思路。\n## **主角顾槐的身世**\n顾槐从小在港口长大。')).resolves.toMatchObject({
      title: '主角顾槐的身世', category: '人物',
    })
  })

  it('keeps a specific model category even when the body has stronger keywords for another one', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"title":"顾槐与旧港传闻","category":" 事件 ","summary":"顾槐从小在港口长大。"}' })
    await expect(extractChatKnowledge(model, '主角顾槐的身世：他在港口长大。')).resolves.toMatchObject({
      title: '顾槐与旧港传闻', category: '事件',
    })
  })

  it('accepts a valid summary without title and ignores unexpected categories', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"summary":"每亩缴粮三升。","category":"假分类","tags":[]}' })
    await expect(extractChatKnowledge(model, '## 县城税制\n原文')).resolves.toEqual({
      title: '县城税制', category: '其他', summary: '每亩缴粮三升。', tags: [],
    })
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('retries invalid structured output with a simpler streamed summary', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '{"title":"县城税制"}' })
      .mockResolvedValueOnce({ content: '县城每亩缴粮三升，尚待核实。' })
    const onRetry = vi.fn()
    await expect(extractChatKnowledge(model, '## 县城税制\n货币制度与历法另议。', undefined, onRetry)).resolves.toEqual({
      title: '县城税制', category: '世界观', summary: '县城每亩缴粮三升，尚待核实。', tags: [],
    })
    expect(onRetry).toHaveBeenCalledOnce()
    expect(callAI).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callAI).mock.calls[1][0]).toMatchObject({ stream: true, taskName: '重试提取知识摘要' })
  })

  it('reports an actionable error only after both attempts have no usable content', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '' })
    await expect(extractChatKnowledge(model, '原文')).rejects.toThrow('更换对话模型')
    expect(callAI).toHaveBeenCalledTimes(2)
  })

  it('does not retry after cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => {
      controller.abort()
      return { content: '' }
    })
    await expect(extractChatKnowledge(model, '原文', controller.signal)).rejects.toBeTruthy()
    expect(callAI).toHaveBeenCalledOnce()
  })
})

describe('local chat knowledge metadata', () => {
  it.each([
    ['世界观', '历法采用十三个月，宇宙有三层。'],
    ['人物', '主角的身世和性格。'],
    ['势力', '负责北境的公会由三大门派组建。'],
    ['功法', '这门心法的修炼口诀需要三句。'],
    ['道具', '玉佩是借来的法宝。'],
    ['地点', '渡口坐落在山谷里。'],
    ['事件', '战役是这场叛乱的导火索。'],
    ['数值属性', '攻击力和暴击率写入面板。'],
    ['其他', '还需要再想一想。'],
  ])('infers %s from the available keywords', (category, content) => {
    expect(inferChatKnowledgeCategory(content)).toBe(category)
  })

  it('strips markup and repeated greetings and keeps the short topic clause', () => {
    expect(cleanFallbackTitle('> **好的，顺着这个思路，建议：**[旧港夜巡制度](https://example.test)，后面补一段细节。'))
      .toBe('旧港夜巡制度')
    expect(cleanFallbackTitle('这是开场说明。\n## **旧港夜巡制度** ##\n原文')).toBe('旧港夜巡制度')
    expect(cleanFallbackTitle('里'.repeat(100))).toBe('里'.repeat(28))
    expect(cleanFallbackTitle('好的。\n---')).toBe('灵感资料')
  })
})
