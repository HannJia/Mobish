// GitHub Star：关于页的固定入口 + 一次性的温和提示。只打开 GitHub 页面，不需要登录或授权。

export const GITHUB_REPO_URL = 'https://github.com/HannJia/mobish'
const STAR_API = 'https://api.github.com/repos/HannJia/mobish'
const COUNT_KEY = 'mobish.githubStars'
const FIRST_USE_KEY = 'mobish.firstUseAt'
const PROMPT_KEY = 'mobish.starPromptDone'
const DAY = 24 * 60 * 60 * 1000

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 存储不可用时忽略 */ }
}

/** 获取 Star 数：只在打开关于页时调用，缓存一天，失败时静默返回 null。 */
export async function fetchStarCount(now = Date.now()): Promise<number | null> {
  try {
    const cached = JSON.parse(readStorage(COUNT_KEY) || 'null') as { count: number; at: number } | null
    if (cached && typeof cached.count === 'number' && now - cached.at < DAY) return cached.count
  } catch { /* 缓存损坏时重新获取 */ }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(STAR_API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) return null
    const count = (await response.json() as { stargazers_count?: unknown }).stargazers_count
    if (typeof count !== 'number') return null
    writeStorage(COUNT_KEY, JSON.stringify({ count, at: now }))
    return count
  } catch { return null }
}

/** 记录第一次使用的时间（只记一次）。 */
export function rememberFirstUse(now = Date.now()): number {
  const saved = Number(readStorage(FIRST_USE_KEY))
  if (saved > 0) return saved
  writeStorage(FIRST_USE_KEY, String(now))
  return now
}

/** 用满 7 天、写了 10 章以上，且从没提示过，才提示一次。 */
export function shouldShowStarPrompt(chapterCount: number, now = Date.now()): boolean {
  if (readStorage(PROMPT_KEY)) return false
  const firstUse = rememberFirstUse(now)
  return now - firstUse >= 7 * DAY && chapterCount >= 10
}

/** 无论点“去看看”还是“不再提示”，都不再出现。 */
export function finishStarPrompt() {
  writeStorage(PROMPT_KEY, '1')
}
