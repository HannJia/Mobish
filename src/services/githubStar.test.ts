// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchStarCount, finishStarPrompt, shouldShowStarPrompt } from './githubStar'

const DAY = 24 * 60 * 60 * 1000

describe('github star prompt', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('shows once after 7 days and 10 chapters, then never again', () => {
    const start = 1_000_000
    expect(shouldShowStarPrompt(20, start)).toBe(false)
    expect(shouldShowStarPrompt(9, start + 8 * DAY)).toBe(false)
    expect(shouldShowStarPrompt(10, start + 8 * DAY)).toBe(true)
    finishStarPrompt()
    expect(shouldShowStarPrompt(50, start + 30 * DAY)).toBe(false)
  })

  it('caches the star count for a day and stays silent on failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ stargazers_count: 42 })))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchStarCount(0)).toBe(42)
    expect(await fetchStarCount(DAY - 1)).toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockImplementation(async () => { throw new TypeError('offline') })
    expect(await fetchStarCount(2 * DAY)).toBeNull()
  })
})
