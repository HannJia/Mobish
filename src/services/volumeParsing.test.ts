import { describe, expect, it } from 'vitest'
import { parseVolumeEstimates, parseVolumesFromText, volumeChapterRanges, volumeForChapterPlan, volumeOrdinalMismatches } from './volumeParsing'

describe('shared volume parsing', () => {
  it('reads the bold estimates from the reported screenshot, not the old 20 chapter fallback', () => {
    const volumes = parseVolumesFromText(`## 分卷建议
### 第一卷：下海（1992-1996）
**主题：** 从零到一、原始积累与道德灰色
**关键事件：**
- 辞职风波，夫妻矛盾初现
**预估章节数：** 约97章
**预估字数：** 约21.3万字
### 第二卷：远航
**预估章节数和字数**：约80章，约18万字
## 预估总字数分配
全书共200万字。`)
    expect(volumes).toHaveLength(2)
    expect(volumes[0]).toMatchObject({ estimatedChapters: 97, estimatedWordCount: 21.3, theme: '从零到一、原始积累与道德灰色' })
    expect(volumes[0].summary).not.toContain('预估章节数')
    expect(volumes[1]).toMatchObject({ estimatedChapters: 80, estimatedWordCount: 18 })
    expect(volumes[1].summary).not.toContain('全书共200')
  })

  it('handles title estimates, raw word counts and missing values', () => {
    expect(parseVolumeEstimates('第一卷（约67章）（约15万字）')).toEqual({ estimatedChapters: 67, estimatedWordCount: 15 })
    expect(parseVolumesFromText('第一卷（约67章）（约15万字）')[0]).toMatchObject({ sourceVolumeNumber: 1, estimatedChapters: 67, estimatedWordCount: 15 })
    expect(parseVolumeEstimates('预估字数：213000字')).toMatchObject({ estimatedWordCount: 21.3 })
    expect(parseVolumesFromText('## 第一卷：出发\n尚未确定篇幅')[0]).toMatchObject({ estimatedChapters: 0, estimatedWordCount: 0 })
  })
  it('keeps the first inline bullet volume, separate ordinals and multiline turning points', () => {
    const volumes = parseVolumesFromText([
      '## 分卷建议：第1卷《开门》', '预估章节数：3章', '关键转折点：- 开门', '- 失去钥匙',
      '- **第四卷《渡河》**', '预估章节数：2章', '承担的骨架节点：beat:a、bogus、beat:a',
    ].join('\n'), ['beat:a'])
    expect(volumes).toHaveLength(2)
    expect(volumes[0]).toMatchObject({ title: '开门', volumeIndex: 0, sourceVolumeNumber: 1, keyTurningPoints: '开门\n失去钥匙' })
    expect(volumes[1]).toMatchObject({ title: '渡河', volumeIndex: 1, sourceVolumeNumber: 4, skeletonBeatIds: ['beat:a'] })
    expect(volumeOrdinalMismatches(volumes)).toEqual([{ volumeId: volumes[1].id, sourceVolumeNumber: 4, expectedVolumeNumber: 2 }])
    const ranges = volumeChapterRanges(volumes)
    expect(ranges.map(({ start, endExclusive }) => [start, endExclusive])).toEqual([[0, 3], [3, 5]])
    expect(volumeForChapterPlan(ranges, { targetChapterStart: 3 })).toBe(volumes[1].id)
    expect(volumeForChapterPlan(ranges, { targetChapterStart: 5 })).toBeUndefined()
  })

  it('requires a title boundary after either form of the ordinal', () => {
    const boundaries = ['', ' ', '：', ':', '—', '–', '-', '·', '、', '.', '《', '(', '（', '【', '[']
    for (const boundary of boundaries) {
      const suffix = boundary ? `${boundary}出发` : ''
      expect(parseVolumesFromText(`## 第一卷${suffix}\n## 卷二${suffix}`).map(volume => volume.sourceVolumeNumber)).toEqual([1, 2])
    }
    expect(parseVolumesFromText('## 卷一【出发】')[0]).toMatchObject({ title: '出发' })
    expect(parseVolumesFromText('## 【第一卷：出发】')[0]).toMatchObject({ title: '出发' })

    const modifiers = ['末', '初', '中', '前', '后', '尾', '内', '里', '间', '至卷三', '到卷三', '的', '第', '开篇', '收束', '细纲', '章节']
    const notes = modifiers.flatMap(modifier => [`- 第一卷${modifier}：沈砚破局`, `- 卷一${modifier}：沈砚破局`])
    expect(parseVolumesFromText(notes.join('\n'))).toEqual([])
  })

  it.each(['### 第一卷前六章细纲', '## 第一卷前十章细纲', '### 卷一开篇六章细纲'])(
    'ends the volume before the chapter outline heading %s', chapterOutline => {
      const volumes = parseVolumesFromText(`## 分卷建议
### 第一卷：入局
### 主题：查清账册来历
#### 核心冲突：如何取得账册
沈砚先查渡口。
${chapterOutline}
- 第1章：沈砚进城。
- 预估章节数：6章
#### 第一卷：章节细化
- 卷一：开篇情节补充
## 分卷规划
### 第二卷：破局
预估章节数：30章`)
      expect(volumes).toHaveLength(2)
      expect(volumes[0]).toMatchObject({ title: '入局', sourceVolumeNumber: 1, theme: '查清账册来历', estimatedChapters: 0 })
      expect(volumes[0].summary).toContain('沈砚先查渡口。')
      expect(volumes[0].summary).not.toMatch(/沈砚进城|章节细化|开篇情节补充/)
      expect(volumes[1]).toMatchObject({ title: '破局', sourceVolumeNumber: 2, estimatedChapters: 30 })
    },
  )

  it('keeps stage summaries and other outline sections outside Markdown volume blocks', () => {
    const volumes = parseVolumesFromText(`## 分卷建议：第1卷《开门》
预计章数：18章
- **第四卷《渡河》**
预计章数：32章
## 核心冲突与节奏节点
- 卷一末：沈砚破局
- 卷二末：守住渡口
- 卷三末：账册失踪
- 卷四末：追至北港
- 卷五末：再遇旧敌
- 卷六末：集齐证词
- 卷七末：公堂对质
## 卷末收束
- 第一卷中：暗线开始收拢
- 卷一至卷三：追查账册
## 全书伏笔
- 第一卷：埋下铜印线索
## 阶段高潮
- 卷七：揭开真相`)
    expect(volumes.map(({ title, estimatedChapters, summary }) => ({ title, estimatedChapters, summary }))).toEqual([
      { title: '开门', estimatedChapters: 18, summary: '' },
      { title: '渡河', estimatedChapters: 32, summary: '' },
    ])
  })
})
