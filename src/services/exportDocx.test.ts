// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { Novel } from '@/types/novel'
import { buildDocx, docxBlocks } from './exportDocx'

const novel = {
  title: '驿路<春>', genreLabel: '历史', subGenreLabel: '架空', synopsis: '一个驿卒的故事。', outline: '# 第一卷\n- **起**：入驿',
  chapters: [
    { chapterIndex: 0, title: '第一章 入驿', content: '晨雾未散。\n\n他推开门 & 走了进去\u0001。' },
    { chapterIndex: 1, title: '风起', content: '' },
  ],
} as unknown as Novel

describe('docx export', () => {
  it('lays out title, outline and chapters without duplicating the chapter number', () => {
    const blocks = docxBlocks(novel)
    expect(blocks.map(block => block.text)).toEqual(['《驿路<春>》', '历史 · 架空', '内容简介', '一个驿卒的故事。', '总大纲', '第一卷', '· 起：入驿',
      '第1章 入驿', '晨雾未散。', '他推开门 & 走了进去\u0001。', '第2章 风起', '（本章暂无正文）'])
    expect(docxBlocks(novel, { bodyOnly: true }).map(block => block.text)[1]).toBe('第1章 入驿')
  })

  it('writes a valid package with escaped text and page breaks between chapters', async () => {
    const zip = await JSZip.loadAsync(await (await buildDocx(novel)).arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']))
    const document = await zip.file('word/document.xml')!.async('string')
    expect(document).toContain('《驿路&lt;春&gt;》')
    expect(document).toContain('他推开门 &amp; 走了进去。')
    expect(document).not.toContain('\u0001')
    expect(document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(2)
    expect(() => new DOMParser().parseFromString(document, 'application/xml')).not.toThrow()
  })
})
