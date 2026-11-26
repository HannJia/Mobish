import type { Novel } from '@/types/novel'
import type { CreationDraft } from '@/types/reconstruction'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { EntityDefinitionEdit } from './entityDefinitionEditing'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { editDefinitionsWithImpact, editNovelContextWithImpact } from './storyImpactTransactions'

export interface OpeningCanonSeedItem {
  id: string
  type: 'character' | 'foreshadowing' | 'rule'
  title: string
  summary: string
  sourceLabel: string
  alreadyExists: boolean
}

type Seed = Omit<OpeningCanonSeedItem, 'id' | 'alreadyExists'>

export interface OpeningCanonSeedResult {
  written: OpeningCanonSeedItem[]
  skipped: Array<{ id: string; reason: 'already-exists' | 'source-changed' }>
}

interface OpeningCanonSeedDependencies {
  now?: () => string
  makeId?: () => string
}

const placeholder = /^(?:暂无|暂不确定|尚未确定|未确定|不确定|未填写|未命名|待定|未定|无|n\/?a|none|xxx)$/iu
const listMarker = /^(?:[-*+]\s+|\d+[.、)）]\s*)/u
const sectionTitle = /^(?:本卷)?(?:卷级伏笔|伏笔(?:线索|设计|与回收)?|角色变化|人物变化|角色弧线)$/u
const foreshadowTitle = /^(?:卷级伏笔|本卷伏笔|跨卷铺垫|全书伏笔|伏笔\s*\d*)\s*[：:]\s*/u

function cleanText(value: string | undefined): string {
  const text = (value ?? '').trim().replace(listMarker, '').replace(/\*\*|__|`/g, '').trim()
  const comparable = text.replace(/^[（(【\[「『“《\s]+|[）)】\]」』”》。！？.!?\s]+$/gu, '')
  return comparable && !placeholder.test(comparable) && !/^[-—–]+$/u.test(comparable) ? text : ''
}

function cleanTitle(value: string | undefined): string {
  return cleanText(cleanText(value).replace(/^[《「『“"'【\[]+|[》」』”"'】\]]+$/gu, '').trim())
}

function key(value: string): string {
  return cleanTitle(value).normalize('NFKC').replace(/[\s\u200B\uFEFF]+/gu, '').replace(/[。.!！?？]+$/u, '').toLowerCase()
}

function namedText(value: string): { title: string; detail: string } | undefined {
  const match = value.match(/^(.+?)(?:[：:]|\s+[—–-]\s+|→)([\s\S]*)$/u)
  if (!match) return
  return { title: cleanTitle(match[1]), detail: cleanText(match[2]) }
}

const roleName = (value: string) => cleanTitle(value.replace(/^(?:主角姓名|姓名)\s*[：:]\s*/u, ''))
const isName = (value: string) => /^(?:[\p{Script=Han}·]{1,8}|[\p{Script=Latin}·]+(?: [\p{Script=Latin}·]+)*)$/u.test(value)
  && value.length <= 40 && !/^(?:主角|开场|初始状态|身份|角色|人物)$/u.test(value) && !sectionTitle.test(value)

function volumeForeshadowing(text: string): string[] {
  const lines: string[] = []
  let inSection = false
  for (const line of text.split(/\r?\n/u)) {
    const heading = line.trim().replace(/^#{1,6}\s*/u, '').replace(/\*\*|__/gu, '')
    const [label] = heading.split(/[：:]/u, 1)
    if (!listMarker.test(heading) && /^(?:卷级伏笔|本卷伏笔|伏笔(?:线索|设计|与回收)?)$/u.test(label.trim())) {
      inSection = true
      lines.push(heading.slice(label.length).replace(/^[：:]\s*/u, ''))
    } else if (inSection) {
      const item = cleanText(heading)
      if (listMarker.test(heading) || foreshadowTitle.test(item)) lines.push(item)
      else if (heading.trim()) inSection = false
    }
  }
  return lines.map(line => cleanText(line.replace(foreshadowTitle, ''))).filter(Boolean)
}

function collectSeeds(novel: Novel, draft: CreationDraft): Seed[] {
  const { contract } = draft
  const characters = new Map<string, Seed>()
  const premise = cleanText(contract.protagonistPremise)
  const namedPremise = namedText(premise.replace(/^(?:主角姓名|姓名)\s*[：:]\s*/u, '').replace(/^主角\s*[：:]\s*/u, ''))
  const explicitName = roleName(premise.match(/^(?:主角姓名|姓名)\s*[：:]\s*([^，。；\n：:]+)/u)?.[1] || '')
  const configuredName = roleName(novel.settings.protagonist.name)
  const hasNamedPremise = !!namedPremise && isName(namedPremise.title)
  const protagonist = (isName(explicitName) && explicitName) || (hasNamedPremise && namedPremise.title) || configuredName || '主角'
  const protagonistNotes = [
    ['初始状态', hasNamedPremise ? namedPremise.detail : premise],
    ['核心欲望', cleanText(contract.protagonistGoal)],
    ['核心恐惧', cleanText(contract.protagonistFear)],
  ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`)
  if (protagonistNotes.length) characters.set(key(protagonist), { type: 'character', title: protagonist,
    summary: protagonistNotes.join('\n'), sourceLabel: '作品契约 · 主角' })

  const rules = contract.worldRules.map(cleanText).filter(Boolean).flatMap((text): Seed[] => {
    const parts = namedText(text)
    if (parts && (!parts.title || !parts.detail)) return []
    return [{ type: 'rule', title: parts?.title || text, summary: text, sourceLabel: '作品契约 · 世界规则' }]
  })
  const foreshadowing: Seed[] = []
  if (draft.approval['volume-outline'] === 'approved') {
    const knownNames = [protagonist, ...novel.characters.map(character => character.name)].sort((a, b) => b.length - a.length)
    for (const volume of draft.volumes) {
      if (volume.approval !== 'approved') continue
      const label = volume.title.trim() || '分卷大纲'
      for (const item of volumeForeshadowing(volume.objective)) {
        const parts = namedText(item)
        if (parts && (!parts.title || !parts.detail)) continue
        foreshadowing.push({ type: 'foreshadowing', title: parts?.title || cleanTitle(item),
          summary: parts?.detail || item, sourceLabel: `${label} · 卷级伏笔` })
      }
      for (const line of volume.endingState.split(/\r?\n/u)) {
        const text = cleanText(line)
        const parts = namedText(text)
        // Free-form text has no reliable role identity unless it starts with a known name.
        const title = parts?.title ?? knownNames.find(name => name && text.startsWith(name))
        if (!title || (title !== '主角' && !isName(title))) continue
        const name = title === '主角' ? protagonist : title
        const detail = parts?.detail ?? cleanText(text.slice(title.length))
        if (!detail) continue
        const sourceLabel = `${label} · 角色变化`
        const existing = characters.get(key(name))
        const summary = `${label}：${detail}`
        if (existing) {
          if (!existing.summary.split('\n').includes(summary)) existing.summary += `\n${summary}`
          if (!existing.sourceLabel.split(' / ').includes(sourceLabel)) existing.sourceLabel += ` / ${sourceLabel}`
        } else characters.set(key(name), { type: 'character', title: name, summary, sourceLabel })
      }
    }
  }
  return [...characters.values(), ...foreshadowing, ...rules]
}

function duplicateKeys(seed: Pick<Seed, 'title' | 'summary'>, includeNamedDetail = false): string[] {
  const detail = includeNamedDetail ? namedText(seed.summary)?.detail : undefined
  return [seed.title, seed.summary, detail].filter((value): value is string => !!value).map(key).filter(Boolean)
}

function existingKeys(novel: Novel): Record<Seed['type'], Set<string>> {
  return {
    character: new Set(novel.characters.flatMap(character => [character.name, ...character.aliases, character.description].map(key).filter(Boolean))),
    foreshadowing: new Set([...novel.eventLog.filter(event => event.type === '伏笔'), ...(novel.storyArcs || [])]
      .flatMap(item => duplicateKeys({ title: item.title, summary: item.description }))),
    rule: new Set(novel.settings.worldBuilding.specialRules.split(/[\r\n；;]+/u).flatMap(text => {
      const summary = cleanText(text)
      return duplicateKeys({ title: namedText(summary)?.title || summary, summary }, true)
    })),
  }
}

/** Existing matches are visible for explanation but cannot be applied. */
export function buildOpeningCanonSeedPreview(novel: Novel, creationDraft?: CreationDraft): OpeningCanonSeedItem[] {
  if (creationDraft?.contract.approval !== 'approved' || creationDraft.approval.contract !== 'approved') return []
  const existing = existingKeys(novel)
  const seen = { character: new Set<string>(), foreshadowing: new Set<string>(), rule: new Set<string>() }
  const preview: OpeningCanonSeedItem[] = []
  for (const seed of collectSeeds(novel, creationDraft)) {
    const keys = duplicateKeys(seed, seed.type === 'rule')
    if (!key(seed.title) || keys.some(value => seen[seed.type].has(value))) continue
    for (const value of keys) seen[seed.type].add(value)
    // Content-bound IDs prevent a selection from silently applying revised source material.
    const id = 'opening-canon:' + buildAnalysisSourceVersionId(JSON.stringify([novel.id, seed.type, seed.title, seed.summary, seed.sourceLabel]))
    preview.push({ ...seed, id, alreadyExists: keys.some(value => existing[seed.type].has(value)) })
  }
  return preview
}

/** Rebuild the preview on the private transaction draft before writing any selected item. */
export async function applyOpeningCanonSeed(novelId: string, selectedIds: readonly string[], deps: OpeningCanonSeedDependencies = {}): Promise<OpeningCanonSeedResult> {
  const ids = [...new Set(selectedIds)]
  if (!ids.length) return { written: [], skipped: [] }
  return useReconstructionWorkspaceStore().transactStory<OpeningCanonSeedResult>(novelId, aggregate => {
    const { novel, workspace } = aggregate
    const preview = new Map(buildOpeningCanonSeedPreview(novel, workspace.creationDraft).map(item => [item.id, item]))
    const written: OpeningCanonSeedItem[] = []
    const skipped: OpeningCanonSeedResult['skipped'] = []
    for (const id of ids) {
      const item = preview.get(id)
      if (!item || item.alreadyExists) skipped.push({ id, reason: item ? 'already-exists' : 'source-changed' })
      else written.push(item)
    }
    if (!written.length) return { written, skipped }
    const now = (deps.now ?? (() => new Date().toISOString()))()
    const makeId = deps.makeId ?? (() => crypto.randomUUID())
    const definitions: EntityDefinitionEdit[] = []
    const rules: string[] = []
    for (const item of written) {
      if (item.type === 'character') {
        definitions.push({ action: 'create', kind: 'character', data: { name: item.title, description: item.summary,
          identity: item.sourceLabel.startsWith('作品契约 · 主角') ? '主角' : '' } })
      } else if (item.type === 'foreshadowing') {
        definitions.push({ action: 'create', kind: 'event', data: { chapterIndex: -1, type: '伏笔', scope: 'volume',
          status: 'planted', hintCount: 0, title: item.title, description: item.summary, characters: [], source: 'user' } })
      } else rules.push(item.summary)
    }
    if (definitions.length) editDefinitionsWithImpact(aggregate, definitions, now, makeId)
    if (rules.length) {
      const { settings } = novel
      const specialRules = [settings.worldBuilding.specialRules, ...rules].filter(Boolean).join('\n')
      editNovelContextWithImpact(aggregate, { updates: { settings: { ...settings,
        worldBuilding: { ...settings.worldBuilding, specialRules } } }, fields: ['settings'] }, now, makeId)
    }
    return { written, skipped }
  }, result => !result.written.length)
}
