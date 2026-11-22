import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMd } from './markdown'

describe('markdown 工具', () => {
  it('转义 HTML 标签和属性字符', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  })

  it('渲染 Markdown 前先转义 HTML', () => {
    const html = renderMd('## 标题\n<script>alert("x")</script>')
    expect(html).toContain('<h3>标题</h3>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('渲染引用和行内代码，内容仍已转义', () => {
    const html = renderMd('> 引用<b>文字</b>\n标题 `[制度]` 与 `<i>`')
    expect(html).toContain('<blockquote>引用&lt;b&gt;文字&lt;/b&gt;</blockquote>')
    expect(html).toContain('<code>[制度]</code>')
    expect(html).toContain('<code>&lt;i&gt;</code>')
  })
})
