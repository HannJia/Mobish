import { describe, expect, it } from 'vitest'
import type { KBEntry, KnowledgeBase } from '@/types/knowledge'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { mergeCloudDocuments, projectDocuments } from './cloudSyncModel'
import { findKnowledgeDuplicates, planKnowledgeMerge } from './knowledgeDuplicateMerge'

const time = '2026-11-25T00:00:00Z'
const makeEntry = (id: string, title = id, content = title): KBEntry =>
  ({ id, title, content, category: '其他', summary: '', tags: [], createdAt: time, updatedAt: time })
const library = (id: string, entries: KBEntry[]): KnowledgeBase => ({ id, name: '归墨斋', entries, createdAt: time, description: '' })
const backup = (...libraries: KnowledgeBase[]) => createTestProjectBackup([], libraries)

describe('knowledge duplicate detection', () => {
  it('does not report a duplicate for a first pull or repeated synchronization under the same ID', () => {
    const remote = projectDocuments(backup(library('cloud', [makeEntry('one')])))
    const first = mergeCloudDocuments(backup(), remote)
    expect(first.knowledgeBases.map(base => base.id)).toEqual(['cloud'])
    expect(findKnowledgeDuplicates(first)).toEqual([])
    expect(findKnowledgeDuplicates(mergeCloudDocuments(first, remote))).toEqual([])
  })

  it.each([false, true])('previews different IDs with shared content and preserves the union (partial %s)', partial => {
    const shared = ['one', 'two', 'three'].map(id => makeEntry(id))
    const targetEntries = [...shared, ...(partial ? [makeEntry('only-local')] : [])]
    const cloudEntries = [...shared.map(entry => ({ ...entry, id: 'cloud-' + entry.id })), ...(partial ? [makeEntry('only-cloud')] : [])]
    const remote = projectDocuments(backup(library('z-cloud', cloudEntries)))
    const project = mergeCloudDocuments(backup(library('a-local', targetEntries)), remote)
    expect(project.knowledgeBases).toHaveLength(2)
    const [preview] = findKnowledgeDuplicates(project)
    expect(preview).toMatchObject({ targetId: 'a-local', duplicateId: 'z-cloud', recommendedTargetId: 'a-local' })
    expect(preview.identical).toHaveLength(3)
    expect(preview.targetOnly.map(entry => entry.title)).toEqual(partial ? ['only-local'] : [])
    expect(preview.duplicateOnly.map(entry => entry.title)).toEqual(partial ? ['only-cloud'] : [])
    const merged = planKnowledgeMerge(project, preview)
    expect(merged.backup.knowledgeBases[0].entries.map(entry => entry.content))
      .toEqual(partial ? ['one', 'two', 'three', 'only-local', 'only-cloud'] : ['one', 'two', 'three'])
    expect(merged.result.entryIds[0]).toEqual({ from: 'cloud-one', to: 'one' })
    expect(project.knowledgeBases).toHaveLength(2)
  })

  it('requires overlapping text and keeps title, content and metadata variants separately', () => {
    const a = library('a', [makeEntry('a1', 'Shared', 'text'), makeEntry('a2', 'Renamed', 'same'), makeEntry('a3', 'Title', 'old')])
    expect(findKnowledgeDuplicates(backup(a, library('b', [makeEntry('b1', 'Shared', 'unrelated')])))).toEqual([])
    const b = library('b', [
      { ...makeEntry('b1', 'Shared', 'text'), tags: ['private'], visibility: { mode: 'never' } },
      makeEntry('b2', 'New title', 'same'), makeEntry('b3', 'Title', 'new'),
    ])
    const project = backup(a, b)
    const [preview] = findKnowledgeDuplicates(project)
    expect(preview.identical).toMatchObject([{ metadataChanged: true }])
    expect(preview.different).toMatchObject([{ titleChanged: true, contentChanged: false }, { titleChanged: false, contentChanged: true }])
    const merged = planKnowledgeMerge(project, preview)
    expect(merged.backup.knowledgeBases[0].entries).toHaveLength(6)
    expect(merged.backup.knowledgeBases[0].entries[3]).toMatchObject({ tags: ['private'], visibility: { mode: 'never' } })
  })
})
