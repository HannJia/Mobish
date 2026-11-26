import type { KBEntry, KnowledgeBase, KnowledgeSummarySource } from '@/types/knowledge'
import { canonicalJson } from './cloudSyncModel'
import type { InspirationSession } from './inspirationSessions'
import { entrySourceVersion } from './knowledgeSources'
import { parseProjectBackup, type ProjectBackup } from './projectBackup'

type MergeLibrary = Pick<ProjectBackup, 'knowledgeBases' | 'novels' | 'inspirationSessions'>
type EntryPreview = Pick<KBEntry, 'id' | 'title' | 'category'>
type EntryPair = { target: EntryPreview; duplicate: EntryPreview }

export interface KnowledgeMergeSelection {
  targetId: string
  duplicateId: string
}

export interface KnowledgeMergePreview extends KnowledgeMergeSelection {
  recommendedTargetId: string
  name: string
  identical: Array<EntryPair & { metadataChanged: boolean }>
  different: Array<EntryPair & { titleChanged: boolean; contentChanged: boolean; metadataChanged: boolean }>
  targetOnly: EntryPreview[]
  duplicateOnly: EntryPreview[]
  archivesLibraryMetadata: boolean
  affected: { novels: number; sessionSelections: number; messages: number; messageReferences: number }
}

export interface KnowledgeMergeConfirmation extends KnowledgeMergeSelection {
  token: string
}

export interface KnowledgeMergeResult extends KnowledgeMergeSelection {
  entryIds: Array<{ from: string; to: string }>
  archivedMetadataEntryId?: string
}

const entryPreview = ({ id, title, category }: KBEntry): EntryPreview => ({ id, title, category })
const libraryName = (library: KnowledgeBase) => library.name.trim().normalize('NFC')
const entryKey = (entry: KBEntry) => JSON.stringify([entry.title, entry.content])
const entryMetadata = ({ id, title, content, ...metadata }: KBEntry) => canonicalJson(metadata)
const libraryMetadata = ({ entries, ...metadata }: KnowledgeBase) => metadata
const comparableLibraryMetadata = ({ id, ...metadata }: ReturnType<typeof libraryMetadata>) => canonicalJson(metadata)

function sessionImpact(session: InspirationSession, libraryId: string) {
  const counts = session.messages.map(message => message.knowledgeReferences?.filter(ref => ref.baseId === libraryId).length || 0)
  return { selected: session.knowledgeIds?.includes(libraryId) ?? false,
    messages: counts.filter(Boolean).length, references: counts.reduce((total, count) => total + count, 0) }
}

function affectedUses(project: MergeLibrary, libraryId: string): KnowledgeMergePreview['affected'] {
  const impact = { novels: project.novels.filter(novel => novel.knowledgeBaseIds.includes(libraryId)).length,
    sessionSelections: 0, messages: 0, messageReferences: 0 }
  for (const session of project.inspirationSessions) {
    const { selected, messages, references } = sessionImpact(session, libraryId)
    impact.sessionSelections += Number(selected)
    impact.messages += messages
    impact.messageReferences += references
  }
  return impact
}

function recommendsFirst(first: KnowledgeBase, second: KnowledgeBase, firstUses: KnowledgeMergePreview['affected'],
  secondUses: KnowledgeMergePreview['affected']): boolean {
  const uses = (item: typeof firstUses) => item.novels + item.sessionSelections + item.messageReferences
  return (uses(firstUses) - uses(secondUses) || Date.parse(second.createdAt) - Date.parse(first.createdAt)
    || second.id.localeCompare(first.id)) >= 0
}

export function previewKnowledgeMerge(project: MergeLibrary, selection: KnowledgeMergeSelection): KnowledgeMergePreview | null {
  const target = project.knowledgeBases.find(base => base.id === selection.targetId)
  const duplicate = project.knowledgeBases.find(base => base.id === selection.duplicateId)
  if (!target || !duplicate || target === duplicate || !libraryName(target) || libraryName(target) !== libraryName(duplicate)) return null
  const byExact = new Map<string, KBEntry[]>()
  const byTitle = new Map<string, KBEntry>()
  const byContent = new Map<string, KBEntry>()
  for (const entry of target.entries) {
    const key = entryKey(entry)
    const exact = byExact.get(key) || []
    exact.push(entry)
    byExact.set(key, exact)
    if (entry.title.trim()) byTitle.set(entry.title, entry)
    if (entry.content.trim()) byContent.set(entry.content, entry)
  }
  const hasOverlap = duplicate.entries.some(entry => entry.content.trim() &&
    (byExact.has(entryKey(entry)) || byContent.has(entry.content)))
  if (!hasOverlap) return null

  const identical: KnowledgeMergePreview['identical'] = []
  const different: KnowledgeMergePreview['different'] = []
  const duplicateOnly: EntryPreview[] = []
  const relatedTargetIds = new Set<string>()
  for (const entry of duplicate.entries) {
    const exact = byExact.get(entryKey(entry)) || []
    const metadata = entryMetadata(entry)
    const same = exact.find(candidate => entryMetadata(candidate) === metadata)
    const related = same || exact[0] || byTitle.get(entry.title) || byContent.get(entry.content)
    if (!related) {
      duplicateOnly.push(entryPreview(entry))
      continue
    }
    relatedTargetIds.add(related.id)
    const pair = { target: entryPreview(related), duplicate: entryPreview(entry) }
    if (exact.length) identical.push({ ...pair, metadataChanged: !same })
    else different.push({ ...pair, titleChanged: related.title !== entry.title, contentChanged: related.content !== entry.content,
      metadataChanged: entryMetadata(related) !== metadata })
  }
  const affected = affectedUses(project, duplicate.id)
  const recommendation = recommendsFirst(target, duplicate, affectedUses(project, target.id), affected) ? target : duplicate
  return { targetId: target.id, duplicateId: duplicate.id, name: target.name, recommendedTargetId: recommendation.id,
    identical, different, duplicateOnly,
    targetOnly: target.entries.filter(entry => !relatedTargetIds.has(entry.id)).map(entryPreview),
    archivesLibraryMetadata: comparableLibraryMetadata(libraryMetadata(target)) !== comparableLibraryMetadata(libraryMetadata(duplicate)),
    affected }
}

export function findKnowledgeDuplicates(project: MergeLibrary): KnowledgeMergePreview[] {
  const groups = new Map<string, KnowledgeBase[]>()
  const previews: KnowledgeMergePreview[] = []
  for (const library of project.knowledgeBases) {
    const name = libraryName(library)
    const group = groups.get(name) || []
    for (const other of group) {
      const preview = previewKnowledgeMerge(project, { targetId: other.id, duplicateId: library.id })
      if (!preview) continue
      previews.push(preview.recommendedTargetId === preview.targetId ? preview :
        previewKnowledgeMerge(project, { targetId: library.id, duplicateId: other.id })!)
    }
    group.push(library)
    groups.set(name, group)
  }
  return previews
}

export function knowledgeMergeInputs(project: MergeLibrary, { targetId, duplicateId }: KnowledgeMergeSelection): string {
  return canonicalJson({
    libraries: [targetId, duplicateId].map(id => project.knowledgeBases.find(base => base.id === id) || null),
    novels: project.novels.filter(novel => novel.knowledgeBaseIds.includes(duplicateId))
      .map(({ id, knowledgeBaseIds }) => ({ id, knowledgeBaseIds })).sort((a, b) => a.id.localeCompare(b.id)),
    sessions: project.inspirationSessions.map(session => ({
      id: session.id, knowledgeIds: session.knowledgeIds?.includes(duplicateId) ? session.knowledgeIds : null,
      references: session.messages.flatMap((message, index) => {
        const references = message.knowledgeReferences?.filter(ref => ref.baseId === duplicateId)
        return references?.length ? [{ index, references }] : []
      }),
    })).filter(session => session.knowledgeIds || session.references.length).sort((a, b) => a.id.localeCompare(b.id)),
  })
}

function moveEntry(source: KBEntry, duplicateId: string, targetId: string): KBEntry {
  // Use a new ID so partial cloud delivery can expose both libraries together.
  const id = crypto.randomUUID()
  const previousVersion = entrySourceVersion(duplicateId, source)
  const moved = { ...source, id }
  const nextVersion = entrySourceVersion(targetId, moved)
  function rebind(binding: KnowledgeSummarySource): KnowledgeSummarySource {
    const remap = <T extends { entryId: string; sourceVersionId: string }>(item: T): T => ({
      ...item, entryId: id, sourceVersionId: item.sourceVersionId === previousVersion ? nextVersion : item.sourceVersionId,
    })
    const coverage = binding.coverage && { ...binding.coverage, sources: binding.coverage.sources.map(remap),
      leafEvidence: binding.coverage.leafEvidence?.map(leaf => ({
        ...leaf, binding: remap(leaf.binding), originalBinding: { ...leaf.originalBinding, entryId: id },
      })) }
    return { ...binding, knowledgeBaseId: targetId, entryId: id,
      sourceVersionId: binding.sourceVersionId === previousVersion ? nextVersion : binding.sourceVersionId, coverage }
  }
  return { ...moved, summarySource: source.summarySource && rebind(source.summarySource),
    summaryHistory: source.summaryHistory?.map(item => ({ ...item, summarySource: item.summarySource && rebind(item.summarySource) })),
    mergedSources: [...(source.mergedSources || []),
      { entryId: source.id, title: source.title, category: source.category, sourceVersionId: previousVersion }] }
}

export function planKnowledgeMerge(project: ProjectBackup, selection: KnowledgeMergeSelection) {
  const preview = previewKnowledgeMerge(project, selection)
  if (!preview) throw new Error('待合并的知识库已变化，请重新检查。')
  const target = project.knowledgeBases.find(base => base.id === preview.targetId)!
  const duplicate = project.knowledgeBases.find(base => base.id === preview.duplicateId)!
  const targetEntries = new Map(target.entries.map(entry => [entry.id, entry]))
  const existing = new Map(preview.identical.filter(pair => !pair.metadataChanged)
    .map(pair => [pair.duplicate.id, targetEntries.get(pair.target.id)!]))
  const entries = [...target.entries]
  for (const source of duplicate.entries) {
    if (existing.has(source.id)) continue
    const moved = moveEntry(source, duplicate.id, target.id)
    entries.push(moved)
    existing.set(source.id, moved)
  }
  let archivedMetadataEntryId: string | undefined
  if (preview.archivesLibraryMetadata) {
    archivedMetadataEntryId = crypto.randomUUID()
    entries.push({ id: archivedMetadataEntryId, title: '合并前的副本库信息', category: '其他', visibility: { mode: 'never' },
      content: JSON.stringify(libraryMetadata(duplicate), null, 2), summary: '', tags: [],
      createdAt: duplicate.createdAt, updatedAt: duplicate.createdAt })
  }
  const remapIds = (ids: string[]) => [...new Set(ids.map(id => id === duplicate.id ? target.id : id))]
  const requiredKeys = [`knowledge:${target.id}`]
  const novels = project.novels.map(novel => {
    if (!novel.knowledgeBaseIds.includes(duplicate.id)) return novel
    requiredKeys.push(`novel:${novel.id}`)
    return { ...novel, knowledgeBaseIds: remapIds(novel.knowledgeBaseIds) }
  })
  const sourceEntries = new Map(duplicate.entries.map(entry => [entry.id, entry]))
  const inspirationSessions = project.inspirationSessions.map(session => {
    const { selected, references } = sessionImpact(session, duplicate.id)
    if (!selected && !references) return session
    requiredKeys.push(`inspiration:${session.id}`)
    return {
      ...session, knowledgeIds: selected ? remapIds(session.knowledgeIds!) : session.knowledgeIds,
      messages: session.messages.map(message => ({
        ...message, knowledgeReferences: message.knowledgeReferences?.map(ref => {
          if (ref.baseId !== duplicate.id) return ref
          const source = sourceEntries.get(ref.entryId)
          const destination = existing.get(ref.entryId)
          const sourceVersion = source && destination && ref.sourceVersion === entrySourceVersion(duplicate.id, source)
            ? entrySourceVersion(target.id, destination) : ref.sourceVersion
          return { ...ref, baseId: target.id, entryId: destination?.id || ref.entryId, sourceVersion }
        }),
      })),
    }
  })
  const knowledgeBases = project.knowledgeBases.filter(base => base.id !== duplicate.id)
    .map(base => base.id === target.id ? { ...base, entries } : base)
  const backup = parseProjectBackup(JSON.stringify({ ...project, novels, inspirationSessions, knowledgeBases }))
  const result: KnowledgeMergeResult = { targetId: target.id, duplicateId: duplicate.id,
    entryIds: [...existing].map(([from, entry]) => ({ from, to: entry.id })), archivedMetadataEntryId }
  return { backup, result, requiredKeys }
}
