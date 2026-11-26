import type { Chapter, Character, EquipmentState, Novel } from '@/types/novel'
import type { CanonMutationRecord, KnowledgeEdge } from '@/types/reconstruction'
import type { ChapterAppearances } from '@/services/characterAppearances'
import { dataPanelReferenceUnknown, getDataPanelFieldTemporalKind, type DataPanelFieldTemporalKind } from '@/services/dataPanelReference'
import { withCurrentStoryEntities } from '@/services/effectiveStory'
import { getCharacterStateSnapshot, knowledgeStateLabels } from '@/services/reconstructionCharacterState'
import { getRelationshipProjection } from '@/services/relationshipProjection'

export type CharacterPresence = 'actual' | 'mentioned' | 'planned' | 'other'

export interface CharacterDeskMetric {
  panelId: string
  panelName: string
  fieldId: string
  name: string
  value: string
  unit?: string
  temporal: DataPanelFieldTemporalKind
}

export interface CharacterDeskEquipment {
  id: string
  name: string
  category: '装备' | '道具'
  state: EquipmentState
  stateLabel: string
  summary: string
}

export interface CharacterDeskRelation {
  targetId: string
  targetName: string
  dimensionLabel: string
  relation: string
  inChapter: boolean
  origin: 'author' | 'chapter'
}

export interface CharacterDeskKnowledge {
  id: string
  state: KnowledgeEdge['state']
  stateLabel: string
  fact: string
  belief?: string
  sourceLabel?: string
  quote?: string
}

export interface CharacterDeskItem {
  character: Character
  presence: CharacterPresence
  presenceLabel: '' | '实际出场' | '正文提及' | '计划涉及'
  visibleAtChapter: boolean
  relations: CharacterDeskRelation[]
  knowledge: CharacterDeskKnowledge[]
  boundPanels: Array<{ id: string; name: string; metrics: CharacterDeskMetric[] }>
  equipment: CharacterDeskEquipment[]
}

interface CharacterDeskInput {
  novel: Novel
  chapter: Chapter
  draftContent: string
  planText: string
  canonMutations: CanonMutationRecord[]
  chapterAppearances?: ChapterAppearances
  query?: string
  includeFuture?: boolean
}

const presenceLabels: Record<CharacterPresence, CharacterDeskItem['presenceLabel']> = {
  actual: '实际出场', mentioned: '正文提及', planned: '计划涉及', other: '',
}
const presenceOrder: Record<CharacterPresence, number> = { actual: 0, mentioned: 1, planned: 2, other: 3 }
const equipmentLabels: Record<EquipmentState, string> = {
  stored: '已存放', equipped: '已装备', consumed: '已消耗', lost: '已遗失',
}

export function deriveCharacterDesk({
  novel, chapter, draftContent, planText, canonMutations, chapterAppearances, query, includeFuture,
}: CharacterDeskInput): { items: CharacterDeskItem[]; totalVisible: number; hiddenFutureCount: number; invalidKnowledgeCount: number } {
  const chapterIndex = chapter.chapterIndex
  const projected = withCurrentStoryEntities(novel, chapterIndex)
  const directIds = new Set(chapterAppearances?.actual.filter(row => row.kind === 'direct').map(row => row.characterId))
  const mentionedIds = new Set(chapterAppearances?.actual.filter(row => row.kind === 'mentioned').map(row => row.characterId))
  const plannedIds = new Set(chapterAppearances?.planned.map(row => row.characterId))
  const chapterCharacterIds = new Set<string>()
  const characters = projected.characters.map(character => {
    const names = [character.name, ...(character.aliases || [])].filter(name => name.trim())
    let presence: CharacterPresence = 'other'
    if (directIds.has(character.id)) presence = 'actual'
    else if (mentionedIds.has(character.id) || names.some(name => draftContent.includes(name))) presence = 'mentioned'
    else if (plannedIds.has(character.id) || names.some(name => planText.includes(name))) presence = 'planned'
    if (presence !== 'other') chapterCharacterIds.add(character.id)
    return { character, presence, visibleAtChapter: character.firstAppearChapter <= chapterIndex }
  })
  const visible = characters.filter(row => includeFuture || row.visibleAtChapter || row.presence !== 'other')
  const needle = query?.trim().toLowerCase()
  const relationships = getRelationshipProjection(novel, canonMutations, chapterIndex, 'before')
  const snapshot = getCharacterStateSnapshot(novel, canonMutations, chapterIndex, 'before')

  const items = visible
    .filter(({ character }) => !needle || [character.name, ...(character.aliases || []), character.identity, character.faction, character.powerLevel]
      .some(value => value.toLowerCase().includes(needle)))
    .sort((a, b) => presenceOrder[a.presence] - presenceOrder[b.presence]
      || (a.character.firstAppearChapter ?? Infinity) - (b.character.firstAppearChapter ?? Infinity)
      || a.character.name.localeCompare(b.character.name, 'zh-CN'))
    .map(({ character, presence, visibleAtChapter }): CharacterDeskItem => {
      const relations = relationships.edges.filter(edge => edge.source.id === character.id)
        .map((edge): CharacterDeskRelation => ({
          targetId: edge.target.id, targetName: edge.target.name, dimensionLabel: edge.dimensionLabel,
          relation: edge.relation, inChapter: chapterCharacterIds.has(edge.target.id), origin: edge.origin,
        }))
        .sort((a, b) => Number(b.inChapter) - Number(a.inChapter))
      const knowledge = snapshot.knowledge.filter(state => state.characterId === character.id)
        .map((state): CharacterDeskKnowledge => ({
          id: state.id, state: state.state, stateLabel: knowledgeStateLabels[state.state], fact: state.fact,
          belief: state.belief, sourceLabel: `第 ${state.knownSinceChapter + 1} 章`, quote: state.evidence[0]?.quote,
        }))
      const boundPanels = projected.dataPanels.filter(panel => panel.characterId === character.id).map(panel => ({
        id: panel.id, name: panel.name,
        metrics: panel.fields.map((field): CharacterDeskMetric => ({
          panelId: panel.id, panelName: panel.name, fieldId: field.id, name: field.name,
          value: field.value, unit: field.unit || undefined,
          temporal: getDataPanelFieldTemporalKind(projected, panel.id, field.id, chapterIndex),
        })),
      }))
      const ownerIds = new Set(boundPanels.map(panel => panel.id))
      const equipment: CharacterDeskEquipment[] = []
      for (const item of projected.dataPanels) {
        if ((item.category !== '装备' && item.category !== '道具') || !item.ownerItemId
          || !ownerIds.has(item.ownerItemId) || dataPanelReferenceUnknown(item).has('equipmentState')) continue
        const state = item.equipmentState ?? 'stored'
        equipment.push({
          id: item.id, name: item.name, category: item.category, state, stateLabel: equipmentLabels[state],
          summary: item.fields.map(field => `${field.name} ${field.value}${field.unit}`).join(' · '),
        })
      }
      return { character, presence, presenceLabel: presenceLabels[presence], visibleAtChapter, relations, knowledge, boundPanels, equipment }
    })
  return {
    items, totalVisible: visible.length, hiddenFutureCount: characters.length - visible.length,
    invalidKnowledgeCount: snapshot.invalid.filter(row => row.record.characterState?.kind === 'knowledge').length,
  }
}
