// 导出真正的 Word 文档（.docx，Office Open XML），用 JSZip 在本地生成，不经过任何服务。
// 结构：书名（标题）→ 简介、总纲（可选）→ 每章一个“标题 1”并另起一页，正文段落首行缩进两字。
import type { Novel } from '@/types/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'

// XML 1.0 不允许的控制字符要去掉，否则 Word 打不开
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
function xml(text: string): string {
  return text.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type Block = { style?: 'Title' | 'Heading1' | 'Heading2' | 'Subtitle'; text: string; pageBreakBefore?: boolean; body?: boolean }

function paragraph(block: Block): string {
  const props = [
    block.style ? `<w:pStyle w:val="${block.style}"/>` : '',
    block.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
  ].join('')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(block.text)}</w:t></w:r></w:p>`
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)

/** Markdown 总纲：# 标题变成“标题 2”，其余去掉列表、加粗等符号后作为普通段落。 */
function markdownBlocks(text: string): Block[] {
  return lines(text).map(line => {
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) return { style: 'Heading2' as const, text: heading[1].replace(/[*_`]/g, '') }
    return { text: line.replace(/^[-*+]\s+/, '· ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'), body: true }
  })
}

export function docxBlocks(novel: Novel, options: { bodyOnly?: boolean } = {}): Block[] {
  const blocks: Block[] = [{ style: 'Title', text: `《${novel.title}》` }]
  if (!options.bodyOnly) {
    const genre = [novel.genreLabel, novel.subGenreLabel].filter(Boolean).join(' · ')
    if (genre) blocks.push({ style: 'Subtitle', text: genre })
    if (novel.synopsis?.trim()) blocks.push({ style: 'Heading1', text: '内容简介' }, ...lines(novel.synopsis).map(text => ({ text, body: true })))
    if (novel.outline?.trim()) blocks.push({ style: 'Heading1', text: '总大纲' }, ...markdownBlocks(novel.outline))
  }
  novel.chapters.forEach((chapter, index) => {
    const title = chapterTitleForDisplay(chapter.title || '', chapter.chapterIndex)
    blocks.push({ style: 'Heading1', text: `第${chapter.chapterIndex + 1}章 ${title}`, pageBreakBefore: index > 0 || !options.bodyOnly })
    const paragraphs = lines(chapter.content || '')
    blocks.push(...(paragraphs.length ? paragraphs : ['（本章暂无正文）']).map(text => ({ text, body: true })))
  })
  return blocks
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="400" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:jc w:val="center"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:jc w:val="center"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:before="200" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
</w:styles>`

/** 生成 .docx 文件内容。 */
export async function buildDocx(novel: Novel, options: { bodyOnly?: boolean } = {}): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(novel.title)}</dc:title><dc:creator>墨笔生花</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>`)
  zip.file('word/styles.xml', STYLES)
  const body = docxBlocks(novel, options).map(paragraph).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
}

export async function exportToDocx(novel: Novel, options: { bodyOnly?: boolean } = {}): Promise<void> {
  const blob = await buildDocx(novel, options)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${novel.title}.docx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
