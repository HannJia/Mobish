import { describe, expect, it } from 'vitest'
import type { EventLogEntry } from '@/types/novel'
import { foreshadowReminders, lastWrittenChapterIndex } from './foreshadowReminders'

const event = (patch: Partial<EventLogEntry>): EventLogEntry => ({ id: patch.title || 'e', title: 'e', description: '', chapterIndex: 0, type: '伏笔', characters: [], ...patch } as EventLogEntry)

describe('foreshadow reminders', () => {
  it('flags overdue and long-stale foreshadowing, skipping resolved, abandoned and unverified ones', () => {
    const reminders = foreshadowReminders([
      event({ title: '玉佩', targetChapter: 9, status: 'planted' }),
      event({ title: '旧信', chapterIndex: 2, lastProgressChapterIndex: 5, status: 'developing' }),
      event({ title: '刚推进', chapterIndex: 2, lastProgressChapterIndex: 30, status: 'developing' }),
      event({ title: '已回收', targetChapter: 3, status: 'resolved' }),
      event({ title: '已放弃', targetChapter: 3, status: 'abandoned' }),
      event({ title: '待核对', targetChapter: 3, status: 'unverified' }),
      event({ title: '主线', type: '主线', targetChapter: 3 }),
    ], 40)
    expect(reminders.map(item => [item.title, item.kind])).toEqual([['玉佩', 'overdue'], ['旧信', 'stale']])
    expect(reminders[0].text).toBe('计划第 10 章推进或回收，已写到第 41 章')
    expect(reminders[1].text).toBe('第 6 章之后 35 章没有推进')
  })

  it('does not flag a target chapter that is being written now', () => {
    expect(foreshadowReminders([event({ chapterIndex: 30, targetChapter: 40 })], 40)).toEqual([])
    expect(foreshadowReminders([event({ targetChapter: 1 })], -1)).toEqual([])
  })

  it('finds the last chapter with text', () => {
    expect(lastWrittenChapterIndex([{ content: 'a' }, { content: '  ' }, { content: 'b' }, {}])).toBe(2)
    expect(lastWrittenChapterIndex([])).toBe(-1)
  })
})
