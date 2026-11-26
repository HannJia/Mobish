import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWritingAdvicePrompt, extractWritingFocus, parseWritingAdviceResult, requestWritingAdvice } from './writingAdvisor'
import type { WritingContext } from './context'
import type { Chapter, Novel } from '@/types/novel'

vi.mock('./context', () => ({
  buildWritingContext: () => context,
  augmentWritingContextWithVectorMemory: async () => context,
}))
afterEach(() => vi.unstubAllGlobals())

const context: WritingContext = {
  outlineContext: '世界观：北境城每年初雪后会关闭外城门。',
  previousSummary: '林默在旧港口发现星环金属片。',
  lastParagraph: '老人抬头看向城门，没有回答。',
  chapterGuidance: '本章目标：确认金属片来源，但暂不揭露星环真相。',
  semanticEvidence: '第 3 章：星环组织曾在旧港口活动。',
}

const chapter: Chapter = {
  id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '旧港口', content: '', summary: '', wordCount: 0,
  status: 'writing', createdAt: '2026-01-01', updatedAt: '2026-01-01',
}

const novel = { id: 'novel-1', title: '星标遗痕' } as Novel

describe('写作辅助协议', () => {
  it('提取光标所在段落，选中文本优先', () => {
    const text = '第一段内容。\n\n第二段内容很长。\n第三行。'
    const selectedStart = text.indexOf('内容')
    expect(extractWritingFocus(text, selectedStart, selectedStart + 3)).toBe('内容。')
    expect(extractWritingFocus(text, text.indexOf('第二') + 3)).toContain('第二段内容很长。')
  })

  it('提示词明确要求人工主笔且禁止代写正文', () => {
    const messages = buildWritingAdvicePrompt(novel, chapter, '林默走进城门。', 'scene', context, '林默走进城门，发现门上的雪痕。')
    expect(messages[0].content).toContain('绝不能代写正文')
    expect(messages[1].content).toContain('3-4 个')
    expect(messages[1].content).toContain('nextChapterPlan')
    expect(messages[1].content).toContain('门上的雪痕')
  })

  it('长章正文保留开头与最新结尾，省略中段', () => {
    const beginning = `城门打开。\n${'甲'.repeat(2994)}`
    const ending = `${'乙'.repeat(2994)}\n火把熄灭。`
    const middle = '这是中段独有的事件。'
    const [, prompt] = buildWritingAdvicePrompt(novel, chapter, '', 'scene', context, beginning + middle + ending)
    expect(prompt.content).toContain(`${beginning}\n（中段省略）\n${ending}`)
    expect(prompt.content).not.toContain(middle)
  })

  it('按指定数量要求彼此不同的下一步走法并聚焦作者正在编辑的内容', () => {
    const [, prompt] = buildWritingAdvicePrompt(novel, chapter, '选区正文', 'scene', context, undefined, 2)
    expect(prompt.content).toContain('suggestions 返回 2 个彼此不同且聚焦的下一步走法')
    expect(prompt.content).toContain('每个走法都要围绕作者正在编辑的内容')
    expect(prompt.content).not.toContain('3-4 个')
  })

  it.each(['SSE', 'JSON'])('使用配置的模型流式请求两个方向并解析 %s 完整响应', async transport => {
    const model = { id: 'advisor', name: '顾问模型', modelName: 'configured-model', baseUrl: 'https://example.test',
      apiKey: 'test-key', maxTokens: 4000, temperature: 0.7, topP: 1 }
    const content = JSON.stringify({ suggestions: [
      { title: '调查城门', approach: '先找门上的刻痕。' },
      { title: '走访旧港口', approach: '先找见过金属片的人。' },
    ] })
    const events = [
      { choices: [{ delta: { content: content.slice(0, 27) } }] },
      { choices: [{ delta: { content: content.slice(27) }, finish_reason: 'stop' }] },
    ]
    const response = transport === 'SSE'
      ? new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
      : Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWritingAdvice({ model, novel, chapter, content: '', focus: '', mode: 'scene', suggestionCount: 2 })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: model.modelName, stream: true, max_tokens: 2600 })
    expect(result.suggestions.map(suggestion => suggestion.title)).toEqual(['调查城门', '走访旧港口'])
  })

  it('解析建议、证据和下一章计划并限制数量', () => {
    const raw = JSON.stringify({
      contextSummary: '参考章节计划和前文摘要',
      suggestions: Array.from({ length: 6 }, (_, index) => ({
        id: `direction-${index + 1}`,
        kind: index === 0 ? 'investigation' : 'scene',
        title: `方向 ${index + 1}`,
        approach: '让角色先调查标记来源，再决定是否进入内城。',
        storyEffect: '推进线索并保留悬念。',
        nextBeat: '落笔写角色做出调查选择。',
        risk: '不要提前揭露真相。',
        evidence: [{ sourceType: 'chapter', sourceLabel: '第 3 章', excerpt: '星环组织曾在旧港口活动' }],
      })),
      nextChapterPlan: { title: '城门后的回声', objective: '确认金属片与旧港口的关系', beats: ['调查老人', '进入内城'] },
    })
    const result = parseWritingAdviceResult(raw, 'scene', '林默走进城门。', context)
    expect(result.suggestions).toHaveLength(4)
    expect(result.suggestions[0].evidence[0].sourceLabel).toBe('第 3 章')
    expect(result.nextChapterPlan?.beats).toEqual(['调查老人', '进入内城'])
    const focusedResult = parseWritingAdviceResult(raw, 'scene', '林默走进城门。', context, 2)
    expect(focusedResult.suggestions).toEqual(result.suggestions.slice(0, 2))
  })

  it('拒绝没有可用方向的结果', () => {
    expect(() => parseWritingAdviceResult('{"suggestions":[]}', 'scene', '', context)).toThrow('没有返回可用')
  })
})
