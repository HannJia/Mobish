// 把另存为网页（.html / .htm）的资料转成带标题的 Markdown 文本。
// 只读取正文：去掉脚本、样式、导航等；不加载任何图片、链接或外部资源（DOMParser 解析出的文档不会发请求）。

const DROP = 'script,style,noscript,template,iframe,object,embed,svg,canvas,nav,header,footer,aside,form,button,select,input,textarea,link,meta'
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS', 'CENTER'])

/** 按网页声明的编码解码；没有声明且不是有效 UTF-8 时按 GB18030（兼容 GBK、GB2312）解码。 */
export function decodeHtmlBytes(bytes: ArrayBuffer): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096)).toLowerCase()
  const declared = /charset\s*=\s*["']?\s*([a-z0-9_-]+)/.exec(head)?.[1]
  if (declared && /^(gbk|gb2312|gb18030|x-gbk)$/.test(declared)) return new TextDecoder('gb18030').decode(bytes)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return new TextDecoder('gb18030').decode(bytes) }
}

const clean = (value: string) => value.replace(/[ \t 　]+/g, ' ').trim()

function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as Element
  if (element.tagName === 'BR') return '\n'
  return Array.from(element.childNodes).map(inlineText).join('')
}

const BLOCK_CHILD = /^(H[1-6]|P|DIV|SECTION|ARTICLE|MAIN|BLOCKQUOTE|FIGURE|UL|OL|LI|TABLE|PRE|HR|DL)$/
/** 只含文字和行内元素的块（如 <p>）整段输出；含有块级子元素的才逐个处理子元素。 */
function hasBlockChild(element: Element): boolean {
  return Array.from(element.children).some(child => BLOCK_CHILD.test(child.tagName))
}

function blocks(node: Element, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = clean(child.textContent || '')
      if (text) out.push(text)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const element = child as Element
    const tag = element.tagName
    const heading = /^H([1-6])$/.exec(tag)
    if (heading) {
      const text = clean(inlineText(element)).replace(/\n+/g, ' ')
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`)
    } else if (tag === 'LI') {
      const text = clean(inlineText(element)).replace(/\n+/g, ' ')
      if (text) out.push(`- ${text}`)
    } else if (tag === 'TR') {
      const cells = Array.from(element.children).map(cell => clean(inlineText(cell)).replace(/\n+/g, ' ')).filter(Boolean)
      if (cells.length) out.push(cells.join(' | '))
    } else if (tag === 'PRE') {
      const text = (element.textContent || '').trimEnd()
      if (text.trim()) out.push(text)
    } else if (tag === 'HR') {
      out.push('---')
    } else if (['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'BODY'].includes(tag) || (BLOCK.has(tag) && hasBlockChild(element))) {
      blocks(element, out)
    } else {
      const text = clean(inlineText(element))
      if (text) out.push(text)
    }
  }
}

export function htmlToKnowledgeText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll(DROP).forEach(element => element.remove())
  const root = document.querySelector('article') || document.querySelector('main') || document.body
  if (!root) return ''
  const out: string[] = []
  const title = clean(document.title || '')
  blocks(root, out)
  if (title && !out.some(line => /^#\s/.test(line))) out.unshift(`# ${title}`)
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
