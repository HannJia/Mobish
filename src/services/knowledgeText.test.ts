import { describe, expect, it } from 'vitest'
import { knowledgeDocumentTitle, knowledgeOutline, splitKnowledgeText } from './knowledgeText'

// 与作者实际导入的资料同样的结构：一个总标题、若干二级部分、三级阶段、四级条目、分隔线。
const timeline = [
  '# 中国房地产政策时间线（1949—2026）', '', '导语：本表整理七十余年的政策节点。', '', '---', '',
  '## 一、总体分期', '九个阶段，三次范式转换。', '', '---', '',
  '## 二、完整时间线', '', '### 阶段一 · 制度奠基（1949—1977）', '',
  '#### 1949年9月29日｜《共同纲领》确立保护私有房产 `[制度]`', '内容甲。', '',
  '#### 1950年6月30日｜《土地改革法》 `[制度]`', '内容乙。', '',
  '### 阶段二 · 商品化破题（1978—1987）', '', '#### 1978年3月｜全国城市住宅建设工作会议', '内容丙。', '', '---', '',
  '## 三、资料说明与使用提示', '阅读时请注意三点。',
].join('\n')

describe('knowledge import text', () => {
  it('imports a whole file as one entry titled by its top heading', () => {
    const [entry, ...rest] = splitKnowledgeText(timeline, { mode: 'whole', fallbackTitle: '文件名' })
    expect(rest).toEqual([])
    expect(entry.title).toBe('中国房地产政策时间线（1949—2026）')
    expect(entry.content).toBe(timeline.trim())
    expect(knowledgeDocumentTitle('没有标题的正文很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长', '文件名')).toBe('文件名')
  })

  it('splits by the shallowest repeated heading, keeping the preface and ignoring separators', () => {
    const sections = splitKnowledgeText(timeline, { fallbackTitle: '文件名' })
    expect(sections.map(section => section.title)).toEqual(['中国房地产政策时间线（1949—2026）', '一、总体分期', '二、完整时间线', '三、资料说明与使用提示'])
    expect(sections[0].content).toBe('导语：本表整理七十余年的政策节点。')
    expect(sections[2].content).toContain('#### 1978年3月')
    expect(sections.every(section => !/^---|---$/.test(section.content))).toBe(true)
  })

  it('keeps the earlier behaviour for page text, plain text and separators', () => {
    expect(splitKnowledgeText('## 第 1 页\n甲\n\n---\n\n## 第 2 页\n乙').map(section => section.title)).toEqual(['第 1 页', '第 2 页'])
    expect(splitKnowledgeText('## 第 1 页\n只有一页')).toEqual([{ title: '第 1 页', content: '只有一页' }])
    expect(splitKnowledgeText('某年县学重建。')).toHaveLength(1)
    expect(splitKnowledgeText('甲事\n---\n乙事')).toHaveLength(2)
    expect(splitKnowledgeText('  \n')).toEqual([])
  })

  it('recognises Chinese chapter and numbered headings', () => {
    expect(splitKnowledgeText('第一章 开端\n甲\n第二章 转折\n乙').map(section => section.title)).toEqual(['第一章 开端', '第二章 转折'])
    expect(splitKnowledgeText('一、背景\n甲\n二、做法\n乙').map(section => section.title)).toEqual(['一、背景', '二、做法'])
  })

  it('builds an outline up to level three in rendered heading order', () => {
    const outline = knowledgeOutline(timeline)
    expect(outline.map(item => `${item.level}:${item.title}`)).toEqual([
      '1:中国房地产政策时间线（1949—2026）', '2:一、总体分期', '2:二、完整时间线', '3:阶段一 · 制度奠基（1949—1977）',
      '3:阶段二 · 商品化破题（1978—1987）', '2:三、资料说明与使用提示',
    ])
    // 四级标题也会渲染成标题元素，所以“阶段二”在渲染后的标题里排第 7 个（下标 6）。
    expect(outline.find(item => item.title.startsWith('阶段二'))!.index).toBe(6)
  })
})
