import { describe, expect, it } from 'vitest'
import type { KBEntry } from '@/types/knowledge'
import { formatSectionHit, knowledgeOutlineText, knowledgeSections, retrieveKnowledgeSections } from './knowledgeSections'

const entry = (title: string, content: string): KBEntry => ({ id: title, category: '其他', title, content, summary: '', tags: [], createdAt: '', updatedAt: '' })

const timeline = entry('中国房地产政策时间线（1949—2026）', [
  '# 中国房地产政策时间线（1949—2026）', '导语。', '---',
  '## 一、总体分期', '九个阶段。', '---',
  '## 二、完整时间线', '### 阶段四 · 全面市场化（1998—2002）', '#### 1998年7月3日｜房改 23 号文', '停止住房实物分配，逐步实行住房分配货币化。',
  '#### 1999年4月3日｜住房公积金全国统一', '公积金管理条例发布。',
  '### 阶段五 · 支柱产业与首轮调控（2003—2009）', '#### 2003年8月12日｜支柱产业', '房地产被确立为国民经济支柱产业。',
].join('\n'))

describe('knowledge section retrieval', () => {
  it('splits a document by headings and keeps the heading path', () => {
    const sections = knowledgeSections(timeline)
    const reform = sections.find(section => section.text.includes('货币化'))!
    expect(reform.path).toEqual(['中国房地产政策时间线（1949—2026）', '二、完整时间线', '阶段四 · 全面市场化（1998—2002）', '1998年7月3日｜房改 23 号文'])
    expect(sections.every(section => !/^---/m.test(section.text))).toBe(true)
  })

  it('returns the most relevant sections with their location, and nothing when no keyword matches', () => {
    const hits = retrieveKnowledgeSections([{ source: 1, entry: timeline }], ['货币化', '分配'])
    expect(hits[0].section.text).toContain('住房分配货币化')
    expect(formatSectionHit(hits[0].entry, hits[0].section, ['货币化'], 200))
      .toBe('《中国房地产政策时间线（1949—2026）》 › 二、完整时间线 › 阶段四 · 全面市场化（1998—2002） › 1998年7月3日｜房改 23 号文：停止住房实物分配，逐步实行住房分配货币化。')
    expect(retrieveKnowledgeSections([{ source: 1, entry: timeline }], ['宇宙飞船'])).toEqual([])
    // 标题命中权重更高
    const top = retrieveKnowledgeSections([{ source: 1, entry: timeline }], ['支柱产业'])[0].section.path
    expect(top[top.length - 1]).toBe('2003年8月12日｜支柱产业')
  })

  it('chunks documents without headings into numbered parts, and recognises Chinese chapter headings', () => {
    const plain = entry('长文', Array.from({ length: 6 }, (_, index) => `第${index}段内容。`.repeat(60)).join('\n\n'))
    const parts = knowledgeSections(plain)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].path).toEqual(['第 1 段'])
    expect(parts.every(part => part.text.length <= 1200)).toBe(true)
    const chapters = knowledgeSections(entry('小说', '第一章 开端\n甲事。\n第二章 转折\n乙事。'))
    expect(chapters.map(section => section.path[section.path.length - 1])).toEqual(['第一章 开端', '第二章 转折'])
  })

  it('builds a short outline from top-level headings', () => {
    expect(knowledgeOutlineText(timeline)).toBe('一、总体分期 / 二、完整时间线')
  })
})
