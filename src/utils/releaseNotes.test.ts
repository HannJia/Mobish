import { describe, expect, it } from 'vitest'
import { parseInlines, parseReleaseNotes } from './releaseNotes'

describe('release notes', () => {
  it('turns GitHub markdown into headings, paragraphs and lists', () => {
    const blocks = parseReleaseNotes('# 墨笔生花 1.1.0\r\n\r\n发布日期为 2026-11-19。\n\n## 界面\n\n- 设置改用 **V3** 控件；\n- 支持 `Alt+T`\n  切换主题\n\n1. 第一步\n2. 第二步\n---\n见 [发布说明](https://example.com)')
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'paragraph'])
    expect(blocks[2]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: '界面' }] })
    const bullets = blocks[3]
    expect(bullets.kind === 'list' && !bullets.ordered && bullets.items).toEqual([
      [{ text: '设置改用 ' }, { text: 'V3', strong: true }, { text: ' 控件；' }],
      [{ text: '支持 ' }, { text: 'Alt+T', code: true }, { text: ' 切换主题' }],
    ])
    expect(blocks[4].kind === 'list' && blocks[4].ordered).toBe(true)
    expect(blocks[5]).toEqual({ kind: 'paragraph', inlines: [{ text: '见 发布说明' }] })
  })

  it('keeps markup as plain text', () => {
    expect(parseInlines('<script>x()</script> ![图](a.png)')).toEqual([{ text: '<script>x()</script> ' }])
    expect(parseReleaseNotes('')).toEqual([])
  })
})
