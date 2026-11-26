import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import { buildOpeningCanonSeedPreview } from './openingCanonSeed'
import { syncCreationDraftPlanning } from './reconstructionCreation'
import { parseVolumesFromText } from './volumeParsing'

const outline = `## 第一卷《雨城》
**本卷角色变化**：
- 林澈：从回避追问到主动开门
- 顾舟 → 放弃继续隐瞒
- 沈珂：暂无
**卷级伏笔**：
- 本卷伏笔：《雨铃》 — 钟声慢一拍
- 跨卷铺垫：暂不确定
- 钥匙：暂无
**关键转折点**：
- 雨停了，角色出城
## 第二卷《沙岸》
**卷级伏笔**：
- 沙塔：塔下留有旧城地砖`

function seed() {
  const { novel } = characterStateFixture()
  novel.volumes = parseVolumesFromText(outline)
  const draft = syncCreationDraftPlanning(createEmptyCreationDraft({ id: 'opening', now }), novel, now)
  Object.assign(draft.contract, { approval: 'approved', protagonistPremise: '林澈：守门人', protagonistGoal: '查明旧案',
    protagonistFear: '暂不确定', worldRules: [' ', '【暂无】', '时空法则：暂无。', '雨禁：落雨时不可开城门'] })
  draft.approval.contract = 'approved'
  draft.approval['volume-outline'] = 'approved'
  draft.volumes[0].approval = 'approved'
  return { novel, draft }
}

describe('buildOpeningCanonSeedPreview', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('reads approved planning and contract content and skips placeholders and draft volumes', () => {
    const { novel, draft } = seed()
    novel.characters = []
    const before = JSON.stringify({ novel, draft })
    const items = buildOpeningCanonSeedPreview(novel, draft)
    expect(items.map(item => [item.type, item.title, item.summary])).toEqual([
      ['character', '林澈', '初始状态：守门人\n核心欲望：查明旧案\n雨城：从回避追问到主动开门'],
      ['character', '顾舟', '雨城：放弃继续隐瞒'],
      ['foreshadowing', '雨铃', '钟声慢一拍'],
      ['rule', '雨禁', '雨禁：落雨时不可开城门'],
    ])
    expect(items[0].sourceLabel).toBe('作品契约 · 主角 / 雨城 · 角色变化')
    expect(JSON.stringify({ novel, draft })).toBe(before)
    expect(buildOpeningCanonSeedPreview(novel, draft)).toEqual(items)
    draft.contract.worldRules[3] = '雨禁：暴雨时不可开城门'
    expect(buildOpeningCanonSeedPreview(novel, draft).map(item => item.id)).toEqual([
      ...items.slice(0, 3).map(item => item.id), expect.not.stringMatching(items[3].id),
    ])
    draft.approval.contract = 'draft'
    expect(buildOpeningCanonSeedPreview(novel, draft)).toEqual([])
  })

  it('marks existing names, aliases and identical content and deduplicates repeated source entries', () => {
    const { novel, draft } = seed()
    novel.characters[1].aliases = ['顾 舟']
    novel.eventLog.push({ id: 'bell', chapterIndex: 2, timestamp: now, title: '城门钟', description: '钟声慢一拍。', characters: [], type: '伏笔' })
    novel.settings.worldBuilding.specialRules = '城门禁令：落雨时不可开城门。'
    draft.contract.worldRules.push('雨 禁：午夜要关城门', '落雨禁令：落雨时不可开城门')
    const preview = buildOpeningCanonSeedPreview(novel, draft)
    expect(preview.map(item => [item.title, item.alreadyExists])).toEqual([
      ['林澈', true], ['顾舟', true], ['雨铃', true], ['雨禁', true],
    ])
  })
})
