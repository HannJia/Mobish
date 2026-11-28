import { describe, expect, it } from 'vitest'
import { readReturnTo, returnLabel } from './returnTo'

describe('returnTo', () => {
  it('only accepts in-app paths', () => {
    expect(readReturnTo('/codex/a?tab=people')).toBe('/codex/a?tab=people')
    expect(readReturnTo('//evil.example')).toBe('')
    expect(readReturnTo('https://evil.example')).toBe('')
    expect(readReturnTo(['/codex/a'])).toBe('')
  })

  it('names the page the button goes back to', () => {
    expect(returnLabel('/write/a/b?tab=character')).toBe('返回写作')
    expect(returnLabel('/codex/a?returnTo=%2Fwrite%2Fa')).toBe('返回典籍')
    expect(returnLabel('/plan/a')).toBe('返回结构')
    expect(returnLabel('/knowledge/a')).toBe('返回知识库')
    expect(returnLabel('/')).toBe('返回书架')
    expect(returnLabel('/somewhere-new')).toBe('返回上一页')
  })
})
