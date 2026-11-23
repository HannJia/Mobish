// HTML 转义（防 XSS）
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
const TABLE_TOKEN = '\u0000TABLE'

// Markdown 表格（表头 + 分隔行 + 数据行）转成 <table>；输入已转义。
// 表格先换成占位符，避免后面的换行、竖线替换破坏表格结构。
function extractTables(text: string, tables: string[]): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1] || ''
    if (isTableRow(lines[i]) && next.includes('|') && TABLE_SEPARATOR.test(next)) {
      const head = tableCells(lines[i])
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && isTableRow(lines[j])) rows.push(tableCells(lines[j++]))
      const cell = (tag: string, value: string) => `<${tag}>${inline(value)}</${tag}>`
      tables.push('<table class="md-table"><thead><tr>' + head.map(value => cell('th', value)).join('') + '</tr></thead><tbody>'
        + rows.map(row => '<tr>' + head.map((_, k) => cell('td', row[k] || '')).join('') + '</tr>').join('') + '</tbody></table>')
      out.push(`${TABLE_TOKEN}${tables.length - 1}\u0000`)
      i = j - 1
    } else out.push(lines[i])
  }
  return out.join('\n')
}

function inline(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

// 简易 Markdown → HTML 渲染（覆盖项目中所有使用场景）
export function renderMd(text: string): string {
  const tables: string[] = []
  let t = extractTables(escapeHtml(text), tables)
  t = t.replace(/^#### (.+)$/gm, '<h5>$1</h5>')
  t = t.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  t = t.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  t = t.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  t = t.replace(/^&gt; ?(.*)$/gm, '<blockquote>$1</blockquote>')
  t = inline(t)
  t = t.replace(/^- (.+)$/gm, '<li>$1</li>')
  t = t.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  t = t.replace(/\|/g, ' │ ')
  // 表格自成一块：去掉紧挨着的换行
  t = t.replace(/\n?(\u0000TABLE\d+\u0000)\n?/g, '$1')
  t = t.replace(/\n\n/g, '</p><p>')
  t = t.replace(/\n/g, '<br>')
  t = t.replace(/\u0000TABLE(\d+)\u0000/g, (_, index: string) => tables[Number(index)])
  return `<p>${t}</p>`
}
