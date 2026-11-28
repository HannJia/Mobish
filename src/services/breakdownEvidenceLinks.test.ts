import { describe, expect, it } from 'vitest'
import { extractBreakdownMessageParts } from './breakdownEvidenceLinks'

describe('extractBreakdownMessageParts', () => {
  it('keeps the readable location and extracts the route and decoded query', () => {
    const raw = '结合书中的悬念写法讨论。\r\n\r\n参考书《老城》\r\n'
      + '卷一 / 第三章 / 段落 1 · 字符 1–20 / [回看出处](#/breakdown/job-1?card=card-1&evidence=0&version=content%3Aabc%3A100)\r\n'
      + '〔拆书记录 breakdown-content:abcd:120〕'
    expect(extractBreakdownMessageParts(raw)).toEqual({
      text: '结合书中的悬念写法讨论。\r\n\r\n参考书《老城》\r\n卷一 / 第三章 / 段落 1 · 字符 1–20',
      links: [{ label: '卷一 · 第三章 · 段落 1 · 字符 1–20', path: '/breakdown/job-1',
        query: { card: 'card-1', evidence: '0', version: 'content:abc:100' } }],
    })
  })

  it('keeps multiple evidence links in order and removes inline markers and standalone link lines', () => {
    const raw = '正文 〔拆书记录 breakdown-first〕 继续\n'
      + '第一章 / [回看出处](#/breakdown/job-1?evidence=0) / 第二章 / [回看出处](#/breakdown/job-1?evidence=1)\n'
      + '[回看出处](#/breakdown/job-2)\n'
      + '段落 3 / [回看出处](#/breakdown/job-2?card=card-2)\n'
      + '〔拆书记录 breakdown-last〕\n'
    expect(extractBreakdownMessageParts(raw)).toEqual({
      text: '正文 继续\n第一章 / 第二章\n段落 3',
      links: [
        { label: '第一章', path: '/breakdown/job-1', query: { evidence: '0' } },
        { label: '第二章', path: '/breakdown/job-1', query: { evidence: '1' } },
        { label: '回看出处', path: '/breakdown/job-2', query: {} },
        { label: '段落 3', path: '/breakdown/job-2', query: { card: 'card-2' } },
      ],
    })
  })

  it('preserves an ordinary message exactly', () => {
    const raw = '  简短正文。\n\n第二段 / 普通链接 [资料](https://example.test)\n'
    expect(extractBreakdownMessageParts(raw)).toEqual({ text: raw, links: [] })
  })

  it('joins adjacent paragraph spacers left by a removed line', () => {
    const raw = '第一段\n\n〔拆书记录 breakdown-abcd〕\n\n第二段'
    expect(extractBreakdownMessageParts(raw)).toEqual({ text: '第一段\n\n第二段', links: [] })
  })

  it.each([
    'https://example.test/#/breakdown/job-1', '//example.test/job-1', 'javascript:alert(1)',
    '#/breakdown/../settings', '#/breakdown/%2e%2e', '#/breakdown/job-1#extra',
    '#/breakdown/discuss/session-1', '#/settings',
  ])('hides out-of-scope targets without returning a link for %s', target => {
    expect(extractBreakdownMessageParts('段落 1 / [回看出处](' + target + ')')).toEqual({ text: '段落 1', links: [] })
  })
})
