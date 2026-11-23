import type { EventLogEntry } from '@/types/novel'

/** 多少章没有推进算“久未推进”。 */
export const FORESHADOW_STALE_CHAPTERS = 30

export interface ForeshadowReminder {
  id: string
  title: string
  kind: 'overdue' | 'stale'
  /** 给作者看的一句话说明 */
  text: string
}

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * 伏笔提醒：
 * - 超期：计划在第 N 章推进/回收，但已经写过了第 N 章还没回收；
 * - 久未推进：埋设或最近一次推进之后，已经过去 30 章以上。
 * 已回收、已放弃、来源待核对的伏笔不提醒。currentChapterIndex 是已写到的最后一章（从 0 开始）。
 */
export function foreshadowReminders(events: EventLogEntry[], currentChapterIndex: number): ForeshadowReminder[] {
  if (!valid(currentChapterIndex)) return []
  const result: ForeshadowReminder[] = []
  for (const event of events) {
    if (event.type !== '伏笔' || event.status === 'resolved' || event.status === 'abandoned' || event.status === 'unverified') continue
    if (valid(event.targetChapter) && event.targetChapter < currentChapterIndex) {
      result.push({ id: event.id, title: event.title, kind: 'overdue',
        text: `计划第 ${event.targetChapter + 1} 章推进或回收，已写到第 ${currentChapterIndex + 1} 章` })
      continue
    }
    const last = valid(event.lastProgressChapterIndex) ? Math.max(event.lastProgressChapterIndex, event.chapterIndex) : event.chapterIndex
    if (valid(last) && currentChapterIndex - last >= FORESHADOW_STALE_CHAPTERS) {
      result.push({ id: event.id, title: event.title, kind: 'stale',
        text: `第 ${last + 1} 章之后 ${currentChapterIndex - last} 章没有推进` })
    }
  }
  // 超期的排前面，其余按标题
  return result.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, 'zh') : a.kind === 'overdue' ? -1 : 1))
}

/** 已写到的最后一章（有正文的章节中下标最大的）；没有正文时返回 -1。 */
export function lastWrittenChapterIndex(chapters: Array<{ content?: string }>): number {
  for (let index = chapters.length - 1; index >= 0; index--) if (chapters[index].content?.trim()) return index
  return -1
}
