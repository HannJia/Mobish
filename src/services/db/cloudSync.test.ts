import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createTestProjectBackup as createProjectBackup, plannedProjectWorkspace } from '@/test/projectBackupFixture'
import { loadReconstructionWorkspace } from './reconstruction'
import { emptySyncState, type SyncConflict } from '../cloudSyncModel'
import { commitLocalKnowledgeMerge, persistCloudState, readCloudConflicts, readCloudState, readLocalKnowledgeMergePreview } from './cloudSync'
import { loadAllNovelsFromDb } from './novels'
import { loadAllKnowledgeBasesFromDb } from './knowledge'
import { loadInspirationSessions } from './inspirationSessions'
import { execute, queryAll, runTransaction } from '../database'
import { parseInspirationSession } from '../inspirationSessions'
import { createEntrySummarySource, entrySourceVersion, getCurrentEntrySummary } from '../knowledgeSources'
import { inspirationKnowledgeExcerpt } from '../inspirationKnowledge'
import type { KBEntry, KnowledgeBase } from '@/types/knowledge'

describe('cloud synchronization database transaction', () => {
  it('commits data, bases and conflict archives together; disk failure rolls all three back', async () => {
    setActivePinia(createPinia())
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    try {
      const novels = useNovelStore()
      const book = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
        settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
      const before = createProjectBackup([book], [])
      before.reconstructionWorkspaces = [plannedProjectWorkspace(book)]
      const state = emptySyncState()
      const conflict: SyncConflict = { id: 'conflict', key: `novel:${book.id}`, title: book.title,
        local: null, remote: null, remoteHash: null, remoteVersion: 2, createdAt: book.createdAt }
      await persistCloudState(state, [conflict], before)
      await runTransaction(() => execute("INSERT INTO ai_tasks (id,name,status) VALUES ('task','已有任务','completed')"))
      const after = createProjectBackup([book], [])
      after.inspirationSessions = [parseInspirationSession({ id: 'idea', title: '未成书的想法', updatedAt: book.updatedAt,
        messages: [{ role: 'user', content: '还没聊完' }], draft: '下一句话' })]
      after.novels[0].title = '云端的新书名'
      after.reconstructionWorkspaces = [plannedProjectWorkspace(book)]
      after.reconstructionWorkspaces[0].creationDraft!.contract.title = '云端修改的契约'
      const next = { ...state, bases: { [conflict.key]: { version: 2, hash: null } } }
      writer.mockRejectedValueOnce(new Error('磁盘空间不足'))
      await expect(persistCloudState(next, [{ ...conflict, resolution: 'remote' }], after)).rejects.toThrow('磁盘空间不足')
      expect((await readCloudState()).bases).toEqual({})
      expect((await readCloudConflicts())[0].resolution).toBeUndefined()
      expect((await loadAllNovelsFromDb())[0].title).toBe(book.title)
      expect(queryAll('SELECT id FROM inspiration_sessions')).toEqual([])
      expect((await loadReconstructionWorkspace(book.id)).creationDraft?.contract.title).toBe('作者确认的作品契约')
      await persistCloudState(next, [{ ...conflict, resolution: 'remote' }], after)
      expect((await readCloudState()).bases[conflict.key].version).toBe(2)
      expect((await readCloudConflicts())[0].resolution).toBe('remote')
      expect((await loadAllNovelsFromDb())[0].title).toBe('云端的新书名')
      expect(queryAll('SELECT id FROM ai_tasks')).toEqual([{ id: 'task' }])
      expect(queryAll('SELECT id FROM inspiration_sessions')).toEqual([{ id: 'idea' }])
      expect((await loadReconstructionWorkspace(book.id)).creationDraft?.contract.title).toBe('云端修改的契约')
      const malformed = JSON.parse(JSON.stringify(after))
      malformed.reconstructionWorkspaces[0].novelId = 'another-book'
      await expect(persistCloudState({ ...next, lastSync: 'invalid' }, [], malformed)).rejects.toThrow()
      expect((await readCloudState()).lastSync).toBe('')
    } finally { vi.unstubAllGlobals() }
  })

  it('merges the SQLite library and references atomically, rolls back a failed write, and retries the same confirmation', async () => {
    setActivePinia(createPinia())
    const writer = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { dbRead: async () => null, dbWrite: writer } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    try {
      const novels = useNovelStore()
      const book = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
        settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
      const shared: KBEntry = { id: 'local-entry', title: '标题', category: '其他', content: '完整的资料正文',
        summary: '', tags: [], createdAt: book.createdAt, updatedAt: book.updatedAt }
      const exclusive: KBEntry = { ...shared, id: 'extra', title: '独有', content: '独有资料正文', summary: '作者摘要', tags: ['标签'] }
      exclusive.summarySource = createEntrySummarySource('b-duplicate', exclusive, exclusive.summary, 'author', book.createdAt)
      const target: KnowledgeBase = { id: 'a-target', name: '同名', entries: [shared], description: '', createdAt: book.createdAt }
      const duplicate: KnowledgeBase = { ...target, id: 'b-duplicate', description: '副本库说明', entries: [
        { ...shared, id: 'cloud-entry' }, exclusive,
      ] }
      book.knowledgeBaseIds = [target.id, duplicate.id]
      const idea = parseInspirationSession({ id: 'idea-merge', title: '灵感', updatedAt: book.updatedAt,
        knowledgeIds: [duplicate.id, target.id], messages: [{ role: 'assistant', content: '引用',
          knowledgeReferences: [{ label: '资料1', baseId: duplicate.id, entryId: exclusive.id,
            sourceVersion: entrySourceVersion(duplicate.id, exclusive), baseName: duplicate.name,
            entryTitle: exclusive.title, path: [], start: 0, end: 4 }],
        }] })
      const project = createProjectBackup([book], [target, duplicate], [], [idea])
      await persistCloudState(emptySyncState(), [], project)
      const selection = { targetId: target.id, duplicateId: duplicate.id }
      const preview = (await readLocalKnowledgeMergePreview(selection))!
      expect(preview.affected).toEqual({ novels: 1, sessionSelections: 1, messages: 1, messageReferences: 1 })
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(commitLocalKnowledgeMerge(preview, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
      writer.mockRejectedValueOnce(new Error('磁盘空间不足'))
      await expect(commitLocalKnowledgeMerge(preview)).rejects.toThrow('磁盘空间不足')
      expect(await loadAllKnowledgeBasesFromDb()).toHaveLength(2)
      expect((await loadAllNovelsFromDb())[0].knowledgeBaseIds).toEqual(book.knowledgeBaseIds)
      expect((await loadInspirationSessions())[0]).toEqual(idea)
      expect((await readCloudState()).knowledgeMergeDeletions).toBeUndefined()

      const { result } = await commitLocalKnowledgeMerge(preview)
      const [merged] = await loadAllKnowledgeBasesFromDb()
      const moved = merged.entries.find(entry => entry.title === exclusive.title)!
      expect(result.entryIds).toEqual(expect.arrayContaining([{ from: 'cloud-entry', to: shared.id }, { from: exclusive.id, to: moved.id }]))
      expect(merged.entries.find(entry => entry.id === result.archivedMetadataEntryId)).toMatchObject({
        visibility: { mode: 'never' }, content: expect.stringContaining(duplicate.description),
      })
      expect(getCurrentEntrySummary(merged.id, moved)).toBe(exclusive.summary)
      expect((await loadAllNovelsFromDb())[0].knowledgeBaseIds).toEqual([target.id])
      const [session] = await loadInspirationSessions()
      expect(session.knowledgeIds).toEqual([target.id])
      const ref = session.messages[0].knowledgeReferences![0]
      expect(ref).toMatchObject({ baseId: target.id, entryId: moved.id })
      expect(inspirationKnowledgeExcerpt([merged], ref)?.excerpt).toBe(exclusive.content.slice(0, 4))
      expect(Object.keys((await readCloudState()).knowledgeMergeDeletions![`knowledge:${duplicate.id}`].requiredHashes))
        .toEqual([`knowledge:${target.id}`, `novel:${book.id}`, `inspiration:${idea.id}`])
      await expect(commitLocalKnowledgeMerge(preview)).rejects.toThrow('重新预览')
      expect(await loadAllKnowledgeBasesFromDb()).toHaveLength(1)
    } finally { vi.unstubAllGlobals() }
  })
})
