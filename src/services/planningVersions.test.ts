import { describe, expect, it } from 'vitest'
import { appendPlanningVersion, comparePlanningVersions, createPlanningSnapshot } from '@/services/planningVersions'
import type { ChapterPlan, Volume } from '@/types/novel'

function plan(): ChapterPlan {
  return {
    id: 'p1', horizon: 'next', title: '潜入旧塔', objective: '取得坐标', summary: '避开守卫进入塔顶', beats: ['观察', '潜入'],
    targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('planning versions', () => {
  it('keeps bounded snapshots and reports field-level differences', () => {
    const current = plan()
    const version = appendPlanningVersion([], createPlanningSnapshot(current), '编辑前版本', current.createdAt)[0]
    current.objective = '取得坐标并安全撤离'
    current.beats.push('撤离')
    const diff = comparePlanningVersions(version, current)
    expect(diff.map(item => item.field)).toEqual(expect.arrayContaining(['阶段目标', '写作节拍']))
  })

  it('does not append an identical snapshot twice', () => {
    const current = plan()
    const snapshot = createPlanningSnapshot(current)
    const once = appendPlanningVersion([], snapshot, '首次')
    expect(appendPlanningVersion(once, snapshot, '重复')).toBe(once)
  })
  it('keeps both volume and chapter versions stable over five round trips', () => {
    const volume: Volume = { id: 'v', title: '卷', volumeIndex: 0, theme: '', summary: '', keyTurningPoints: '', characterChanges: '',
      estimatedChapters: 4, estimatedWordCount: 2, sourceVolumeNumber: 2, skeletonBeatIds: ['beat:a'] }
    for (const entity of [volume, plan()]) {
      const a = createPlanningSnapshot(entity), b = createPlanningSnapshot({ ...entity, title: '另一版' })
      const versions = appendPlanningVersion(appendPlanningVersion([], a, '首版'), b, '第二版')
      for (let index = 0; index < 5; index++) {
        expect(appendPlanningVersion(appendPlanningVersion(versions, a, '恢复'), b, '切回')).toBe(versions)
      }
    }
  })
})
