import { describe, expect, it } from 'vitest'
import { relevantExcerpt } from './semanticIndex'

// 与优化前完全一致的参考实现：逐个候选窗口切片搜索。优化版必须对任意输入给出同样的摘录。
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  const cjk = Array.from(normalized.replace(/[^\p{Script=Han}]/gu, ''))
  const grams: string[] = []
  for (let i = 0; i < cjk.length - 1; i++) grams.push(cjk.slice(i, i + 2).join(''))
  return [...words, ...grams].filter(token => token.length >= 2)
}
function reference(text: string, query: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  const terms = Array.from(new Set(tokenize(query)))
  const lower = normalized.toLowerCase()
  const starts = new Set([0])
  const windowSize = limit - 2
  for (const term of terms) {
    let at = lower.indexOf(term)
    while (at >= 0) {
      starts.add(Math.max(0, Math.min(normalized.length - windowSize, at - Math.floor(windowSize / 3))))
      at = lower.indexOf(term, at + term.length)
    }
  }
  let start = 0, best = -1, bestMargin = -1
  for (const candidate of starts) {
    const window = lower.slice(candidate, candidate + windowSize)
    const score = terms.reduce((sum, term) => sum + (window.includes(term) ? Math.min(term.length, 12) : 0), 0)
    const matches = terms.flatMap(term => {
      const offset = window.indexOf(term)
      return offset < 0 ? [] : [{ start: offset, end: offset + term.length }]
    })
    const margin = matches.length ? Math.min(Math.min(...matches.map(match => match.start)),
      windowSize - Math.max(...matches.map(match => match.end))) : 0
    if (score > best || (score === best && margin > bestMargin)) { best = score; bestMargin = margin; start = candidate }
  }
  return (start > 0 ? '…' : '') + normalized.slice(start, start + windowSize) + (start + windowSize < normalized.length ? '…' : '')
}

function seeded(seed: number) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 }

describe('relevantExcerpt', () => {
  it('matches the reference implementation on random Chinese, Latin and repeated-character text', () => {
    const random = seeded(20261127)
    const alphabet = '沈砚顾听澜白鹭账本码头旧案灯火雨夜守铺哈哈aab 。，\n'.split('')
    for (let round = 0; round < 400; round++) {
      const length = 40 + Math.floor(random() * 900)
      const text = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
      const query = Array.from({ length: 2 + Math.floor(random() * 14) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
      const limit = 20 + Math.floor(random() * 160)
      expect(relevantExcerpt(text, query, limit), `round ${round}`).toBe(reference(text, query, limit))
    }
  })

  it('keeps short text untouched and marks truncated edges', () => {
    expect(relevantExcerpt('很短的文字', '文字', 100)).toBe('很短的文字')
    const long = '前文'.repeat(80) + '关键线索出现在这里' + '后文'.repeat(80)
    const excerpt = relevantExcerpt(long, '关键线索', 60)
    expect(excerpt).toContain('关键线索')
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})
