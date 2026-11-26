import { describe, expect, it } from 'vitest'
import { chapterOutputTokenBudget } from './chapterGeneration'

describe('chapter output token budget', () => {
  it('uses the configured 16384 tokens for a 2200-word chapter', () => {
    expect(chapterOutputTokenBudget(16384, 2200)).toBe(16384)
  })

  it('keeps the chapter below the configured model cap', () => {
    expect(chapterOutputTokenBudget(4096, 2200)).toBe(4096)
    expect(chapterOutputTokenBudget(8192.5, 2200)).toBe(8192)
  })

  it('allocates more than 16384 tokens for a longer chapter when the model permits it', () => {
    expect(chapterOutputTokenBudget(32768, 5001)).toBe(20695)
  })

  it.each([undefined, 0, -1, NaN, Infinity])('defaults to 12000 tokens for a missing or invalid model cap (%s)', cap => {
    expect(chapterOutputTokenBudget(cap, 2200)).toBe(12000)
  })
})
