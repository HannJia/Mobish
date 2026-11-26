import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ChapterAppearances } from '@/services/characterAppearances'
import { captureDataPanelReferenceItem, recordDataPanelReference } from '@/services/dataPanelReference'
import { applyEntityDefinitionEdit } from '@/services/entityDefinitionEditing'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import type { DataPanelItem, DataPanelReferenceSource } from '@/types/novel'
import { deriveCharacterDesk } from './characterDesk'

beforeEach(() => setActivePinia(createPinia()))

function setup() {
  const { novel } = characterStateFixture()
  return {
    novel,
    chapter: novel.chapters[1],
    draftContent: '',
    planText: '',
    canonMutations: [],
  }
}

function panel(id: string, overrides: Partial<DataPanelItem> = {}): DataPanelItem {
  return { id, name: id, category: '角色', fields: [], relatedKeywords: [], createdAt: now, updatedAt: now, ...overrides }
}

describe('writing desk characters', () => {
  it('prioritizes appearances and uses the zero-based first-appearance boundary', () => {
    const input = setup()
    const { novel } = input
    const [lead, partner] = novel.characters
    lead.aliases = ['小林']
    partner.firstAppearChapter = 2
    novel.characters.push(
      { ...partner, id: 'future', name: '未来人物', firstAppearChapter: 2 },
      { ...partner, id: 'reader', name: '顾真', aliases: ['信使'], firstAppearChapter: 3 },
      { ...partner, id: 'author-plan', name: '徐静', firstAppearChapter: 4 },
      { ...partner, id: 'text-plan', name: '徐珂', aliases: ['道长'], firstAppearChapter: 4 },
      { ...partner, id: 'on-boundary', name: '周意', firstAppearChapter: 1 },
      { ...partner, id: 'existing', name: '李元', firstAppearChapter: 0 },
    )
    const evidence = { id: 'evidence', sourceType: 'chapter' as const, sourceId: input.chapter.id, quote: '林澈' }
    const chapterAppearances: ChapterAppearances = {
      actual: [
        { characterId: lead.id, kind: 'mentioned', evidence },
        { characterId: partner.id, kind: 'mentioned', evidence },
        { characterId: lead.id, kind: 'direct', evidence },
      ],
      planned: [{ characterId: 'author-plan', kind: 'direct', evidence }, { characterId: 'reader', kind: 'direct', evidence }],
    }
    const args = { ...input, chapterAppearances, draftContent: '小林打开门，信使留下书信。', planText: '小林和道长见面。' }
    const result = deriveCharacterDesk(args)
    expect(result.items.map(row => [row.character.id, row.presenceLabel, row.visibleAtChapter])).toEqual([
      [lead.id, '实际出场', true], [partner.id, '正文提及', false], ['reader', '正文提及', false],
      ['author-plan', '计划涉及', false], ['text-plan', '计划涉及', false],
      ['existing', '', true], ['on-boundary', '', true],
    ])
    expect(result).toMatchObject({ totalVisible: 7, hiddenFutureCount: 1 })
    expect(deriveCharacterDesk({ ...args, includeFuture: true })).toMatchObject({ totalVisible: 8, hiddenFutureCount: 0 })
  })

  it('searches the five character fields case-insensitively and keeps chapter visibility totals', () => {
    const input = setup()
    Object.assign(input.novel.characters[0], { name: 'Lynn', aliases: ['Raven'], identity: 'Archivist', faction: 'North Guild', powerLevel: 'Tier Four' })
    for (const query of [' lYnN ', 'rAVEn', 'ARCHIV', 'north guild', 'TIER FOUR']) {
      const result = deriveCharacterDesk({ ...input, query })
      expect(result.items.map(row => row.character.id)).toEqual(['person-0'])
      expect(result.totalVisible).toBe(2)
    }
    expect(deriveCharacterDesk({ ...input, query: 'absent' }).items).toEqual([])
  })

  it('shows chapter-start relationships and knowledge with evidence, and counts only invalid knowledge', () => {
    const input = setup()
    const { novel, chapter } = input
    const [lead, partner] = novel.characters
    const other = { ...partner, id: 'author-target', name: '葛青' }
    novel.characters.push(other)
    lead.relationships = [{ targetId: other.id, targetName: other.name, relation: '师徒' }]
    const records = [
      knowledgeCandidate(novel, 0), relationshipCandidate(novel, 0), relationshipCandidate(novel, 1),
    ].map(candidate => applyCandidateChangeToCanon(novel, acceptCandidateChange(candidate, now), now).record)
    const args = { ...input, draftContent: '林澈向苏禾打开书信。', canonMutations: records }
    const result = deriveCharacterDesk(args)
    expect(result.items.find(row => row.character.id === lead.id)).toMatchObject({
      relations: [
        { targetId: partner.id, targetName: partner.name, relation: '信任', origin: 'chapter', inChapter: true },
        { targetId: other.id, relation: '师徒', origin: 'author', inChapter: false },
      ],
      knowledge: [{
        state: 'false_belief', stateLabel: '错误信念', fact: '城主仍然在世', belief: '城主已经死了',
        sourceLabel: '第 1 章', quote: '林澈以为城主已经死了。',
      }],
    })
    expect(result.items.find(row => row.character.id === partner.id)?.relations).toEqual([])
    expect(deriveCharacterDesk({ ...args, chapter: novel.chapters[0] }).items[0].knowledge).toEqual([])
    novel.chapters[0].content = '往事已改写。'
    const invalid = deriveCharacterDesk({ ...args, chapter })
    expect(invalid.invalidKnowledgeCount).toBe(1)
    expect(invalid.items.find(row => row.character.id === lead.id)).toMatchObject({
      relations: [{ targetId: other.id }], knowledge: [],
    })
  })

  it('projects metrics and equipment by stable ID and keeps later chapter revisions out', () => {
    const input = setup()
    const { novel, chapter } = input
    const [lead, partner] = novel.characters
    const field = { id: 'power', name: '修为', value: '一阶', unit: '级', note: '' }
    const tracked = panel('tracked', { characterId: lead.id, name: '修炼册', fields: [{ ...field }] })
    const legacy = panel('legacy', { characterId: lead.id, fields: [{ ...field }] })
    const matchingName = panel('coincidence', { name: lead.name, characterId: partner.id })
    const sword = panel('sword', { category: '装备', name: '剑', ownerItemId: tracked.id,
      fields: [{ id: 'durability', name: '耐久', value: '8', unit: '点', note: '' }] })
    const medicine = panel('medicine', { category: '道具', ownerItemId: legacy.id, equipmentState: 'consumed' })
    const lost = panel('lost', { category: '装备', ownerItemId: tracked.id, equipmentState: 'lost' })
    novel.dataPanels = [tracked, legacy, matchingName, sword, medicine, lost,
      panel('names-only', { name: lead.name }), panel('other-item', { category: '道具', ownerItemId: matchingName.id })]
    const source: DataPanelReferenceSource = {
      kind: 'chapter', novelId: novel.id, chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), referenceVersion: 'test', quote: chapter.content,
    }
    const before = captureDataPanelReferenceItem(tracked), stored = captureDataPanelReferenceItem(sword)
    tracked.fields[0].value = '二阶'
    sword.equipmentState = 'equipped'
    recordDataPanelReference(tracked, before, source, now, 'metric-revision')
    recordDataPanelReference(sword, stored, source, now, 'equipment-revision')
    applyEntityDefinitionEdit(novel, { action: 'update', kind: 'character', entityId: lead.id,
      expectedEntity: JSON.stringify(lead), updates: { name: '林清' } }, now, () => 'rename')
    const original = JSON.stringify(novel)
    const beforeRow = deriveCharacterDesk(input).items.find(row => row.character.id === lead.id)!
    expect(beforeRow.character.name).toBe('林清')
    expect(beforeRow.boundPanels).toEqual([
      { id: tracked.id, name: tracked.name, metrics: [{ panelId: tracked.id, panelName: tracked.name, fieldId: field.id,
        name: field.name, value: '一阶', unit: '级', temporal: 'global-setting' }] },
      { id: legacy.id, name: legacy.name, metrics: [{ panelId: legacy.id, panelName: legacy.name, fieldId: field.id,
        name: field.name, value: '一阶', unit: '级', temporal: 'unrecorded' }] },
    ])
    expect(beforeRow.equipment).toEqual([
      { id: 'sword', name: '剑', category: '装备', state: 'stored', stateLabel: '已存放', summary: '耐久 8点' },
      { id: 'medicine', name: 'medicine', category: '道具', state: 'consumed', stateLabel: '已消耗', summary: '' },
      { id: 'lost', name: 'lost', category: '装备', state: 'lost', stateLabel: '已遗失', summary: '' },
    ])
    const later = deriveCharacterDesk({ ...input, chapter: novel.chapters[2] }).items.find(row => row.character.id === lead.id)!
    expect(later.boundPanels[0].metrics[0]).toMatchObject({ value: '二阶', temporal: 'before-chapter' })
    expect(later.equipment[0]).toMatchObject({ state: 'equipped', stateLabel: '已装备' })
    expect(JSON.stringify(novel)).toBe(original)
    chapter.content = '正文改写。'
    const invalid = deriveCharacterDesk({ ...input, chapter: novel.chapters[2] }).items.find(row => row.character.id === lead.id)!
    expect(invalid.boundPanels[0].metrics).toEqual([])
    expect(invalid.equipment.map(row => row.id)).toEqual(['medicine', 'lost'])
  })
})
