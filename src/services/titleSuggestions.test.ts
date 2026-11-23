import { describe, expect, it } from 'vitest'
import { parseTitleSuggestions, titleSuggestionMessages } from './titleSuggestions'
import type { StoryContract } from '@/types/reconstruction'

describe('title suggestions', () => {
  it('parses JSON candidates, strips book marks and duplicates', () => {
    const titles = parseTitleSuggestions('```json\n{"titles":[{"title":"《雾港旧案》","reason":"悬疑意象"},{"title":"雾港旧案","reason":"重复"},{"title":"码头","reason":"x"},{"title":"一","reason":"太短"}]}\n```')
    expect(titles).toEqual([{ title: '雾港旧案', reason: '悬疑意象' }, { title: '码头', reason: 'x' }])
  })

  it('falls back to a numbered list', () => {
    expect(parseTitleSuggestions('1. 《长夜驿》— 驿站意象\n2. 风起青萍').map(item => item.title)).toEqual(['长夜驿', '风起青萍'])
  })

  it('builds a prompt from filled contract fields and avoids earlier titles', () => {
    const contract = { title: '', genre: '悬疑', coreTheme: '真相与代价', protagonistPremise: '暂不确定', worldRules: ['雾夜不出港'] } as unknown as StoryContract
    const prompt = titleSuggestionMessages(contract, ['雾港旧案'])[1].content
    expect(prompt).toContain('类型：悬疑')
    expect(prompt).toContain('主题：真相与代价')
    expect(prompt).not.toContain('主角：暂不确定')
    expect(prompt).toContain('雾夜不出港')
    expect(prompt).toContain('不要重复这些已经给过的书名：雾港旧案')
  })
})
