// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { decodeHtmlBytes, htmlToKnowledgeText } from './knowledgeHtml'
import { readKnowledgeFile } from './knowledgeImport'
import { useKnowledgeStore } from '@/stores/knowledge'

const page = `<!doctype html><html><head><meta charset="utf-8"><title>宋代驿站制度</title>
<style>.x{color:red}</style><script>alert('x')</script></head><body>
<nav><a href="/">首页</a> | <a href="/about">关于</a></nav>
<article><h1>宋代驿站制度</h1><p>驿站由兵部管理，<b>马递</b>每日五百里。<br>急递铺负责传递公文。</p>
<h2>一、设置</h2><ul><li>驿：传递与住宿</li><li>铺：传递公文</li></ul>
<table><tr><th>名称</th><th>职能</th></tr><tr><td>马递</td><td>紧急公文</td></tr></table>
<img src="https://example.com/track.png"><iframe src="https://example.com"></iframe></article>
<footer>版权所有</footer></body></html>`

describe('HTML knowledge import', () => {
  it('keeps headings, paragraphs, lists and tables, and drops scripts, styles, navigation and embeds', () => {
    const text = htmlToKnowledgeText(page)
    expect(text).toBe([
      '# 宋代驿站制度', '驿站由兵部管理，马递每日五百里。\n急递铺负责传递公文。', '## 一、设置',
      '- 驿：传递与住宿', '- 铺：传递公文', '名称 | 职能', '马递 | 紧急公文',
    ].join('\n\n'))
    expect(text).not.toMatch(/alert|color:red|首页|版权所有|example\.com/)
  })

  it('uses the page title when there is no top heading, and decodes GBK pages', () => {
    expect(htmlToKnowledgeText('<html><head><title>资料页</title></head><body><p>正文</p></body></html>')).toBe('# 资料页\n\n正文')
    const gbk = new Uint8Array([0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x67, 0x62, 0x6b, 0x3e, 0xd6, 0xd0, 0xce, 0xc4])
    expect(decodeHtmlBytes(gbk.buffer)).toBe('<meta charset=gbk>中文')
  })

  it('reads .html files and imports a whole file as one entry', async () => {
    const text = await readKnowledgeFile(new File([page], '驿站.html', { type: 'text/html' }))
    expect(text.startsWith('# 宋代驿站制度')).toBe(true)
    setActivePinia(createPinia())
    const store = useKnowledgeStore()
    const kb = store.createKB('资料', '')
    expect(store.importFromText(kb.id, text, '其他', { mode: 'whole', fallbackTitle: '驿站' })).toBe(1)
    expect(store.getKB(kb.id)!.entries[0]).toMatchObject({ title: '宋代驿站制度', content: text })
  })
})
