import { execute, initDb, queryAll, runTransaction } from '../database'
import { emptySyncState, hashKnowledgeMergeFields, hashPayload, projectDocuments, sha256, type SyncState, type SyncConflict } from '../cloudSyncModel'
import { createProjectBackup, parseProjectBackup, type ProjectBackup } from '../projectBackup'
import { writeProjectRows } from './project'
import { usesProjectKernel, readProjectLibrary, mutateProjectLibrary } from '../projectKernelClient'
import { readAllKnowledgeRows, writeKnowledgeBaseRows, deleteKnowledgeBaseRows } from './knowledge'
import { readAllNovelRows } from './novels'
import { readProjectChapterRevisionRows } from './chapterRevisions'
import { readInspirationSessionRows } from './inspirationSessions'
import { readReconstructionWorkspaceRows } from './reconstruction'
import { findKnowledgeDuplicates, knowledgeMergeInputs, planKnowledgeMerge, previewKnowledgeMerge,
  type KnowledgeMergeSelection, type KnowledgeMergeConfirmation } from '../knowledgeDuplicateMerge'

async function ready() { await initDb() }
export async function readCloudState(): Promise<SyncState> {
  if (usesProjectKernel()) return (await readProjectLibrary()).sync.state || emptySyncState()
  await ready()
  return readCloudStateRow()
}
function readCloudStateRow(): SyncState {
  const row = queryAll<{ value: string }>("SELECT value FROM cloud_sync_state WHERE id='main'")[0]
  return row ? JSON.parse(row.value) : emptySyncState()
}

function writeCloudStateRow(state: SyncState) {
  execute("INSERT INTO cloud_sync_state(id,value) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    [JSON.stringify(state)])
}
export async function readCloudConflicts(): Promise<SyncConflict[]> {
  if (usesProjectKernel()) return (await readProjectLibrary()).sync.conflicts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  await ready()
  return queryAll<{ value: string }>('SELECT value FROM cloud_sync_conflicts ORDER BY created_at DESC')
    .map(row => JSON.parse(row.value))
}
export async function persistCloudState(state: SyncState, conflicts: SyncConflict[] = [], project?: ProjectBackup): Promise<void> {
  const checked = project ? parseProjectBackup(JSON.stringify(project)) : undefined
  if (usesProjectKernel()) {
    const savedState = JSON.parse(JSON.stringify(state)) as SyncState
    const savedConflicts = JSON.parse(JSON.stringify(conflicts)) as SyncConflict[]
    return mutateProjectLibrary(draft => {
      if (checked) draft.backup = checked
      draft.sync.state = savedState
      for (const conflict of savedConflicts) {
        const index = draft.sync.conflicts.findIndex(item => item.id === conflict.id)
        if (index < 0) draft.sync.conflicts.push(conflict)
        else draft.sync.conflicts[index] = conflict
      }
    })
  }
  await ready()
  await runTransaction(() => {
    if (checked) writeProjectRows(checked)
    writeCloudStateRow(state)
    for (const conflict of conflicts) {
      execute('INSERT INTO cloud_sync_conflicts(id,value,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        [conflict.id, JSON.stringify(conflict), conflict.createdAt])
    }
  }, { restoreOnWriteFailure: true })
}

function readSqlProject(): ProjectBackup {
  const novels = readAllNovelRows()
  return createProjectBackup({ novels, knowledgeBases: readAllKnowledgeRows(), inspirationSessions: readInspirationSessionRows(),
    chapterRevisions: readProjectChapterRevisionRows(), reconstructionWorkspaces: novels.map(novel => {
      const workspace = readReconstructionWorkspaceRows(novel.id)
      return { ...workspace, novelId: novel.id, chapterReviews: workspace.chapterReviews || [], aiRuns: workspace.aiRuns || [] }
    }) })
}

async function readMergeProject(): Promise<ProjectBackup> {
  if (usesProjectKernel()) return (await readProjectLibrary(true)).backup!
  await ready()
  return readSqlProject()
}

export async function listLocalKnowledgeDuplicates() {
  return findKnowledgeDuplicates(await readMergeProject())
}

const mergeToken = (inputs: string) => sha256(new TextEncoder().encode(inputs))

export async function readLocalKnowledgeMergePreview(selection: KnowledgeMergeSelection) {
  const project = await readMergeProject()
  const preview = previewKnowledgeMerge(project, selection)
  return preview && { ...preview, token: await mergeToken(knowledgeMergeInputs(project, preview)) }
}

const changedMerge = () => new Error('待合并的资料或引用已变化，请重新预览。')

/** Both backends publish the verified aggregate and deletion intent atomically. */
export async function commitLocalKnowledgeMerge(confirmation: KnowledgeMergeConfirmation, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const snapshot = await readMergeProject()
  const inputs = knowledgeMergeInputs(snapshot, confirmation)
  if (await mergeToken(inputs) !== confirmation.token) throw changedMerge()
  const planned = planKnowledgeMerge(snapshot, confirmation)
  const sourceKey = `knowledge:${confirmation.duplicateId}`
  const originalDocuments = projectDocuments(snapshot)
  const sourceHash = await hashPayload(originalDocuments.get(sourceKey) ?? null)
  if (!sourceHash) throw changedMerge()
  // SQLite orders entries by creation time. Reproduce that order in the
  // expected cloud payload, keeping insertion order for equal timestamps.
  if (!usesProjectKernel()) {
    const target = planned.backup.knowledgeBases.find(base => base.id === confirmation.targetId)!
    target.entries.sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
  }
  const plannedDocuments = projectDocuments(planned.backup)
  const changedDocuments = await Promise.all(planned.requiredKeys.map(async key => {
    const current = originalDocuments.get(key)
    const planned = plannedDocuments.get(key)
    if (!current || !planned) throw changedMerge()
    const [before, after] = await Promise.all([hashKnowledgeMergeFields(key, current), hashKnowledgeMergeFields(key, planned),
      hashPayload(planned)])
    return { key, before, after }
  }))
  const requiredHashes = Object.fromEntries(changedDocuments.map(({ key, after }) => [key, after]))

  function prepare(current: ProjectBackup, state: SyncState) {
    signal?.throwIfAborted()
    if (knowledgeMergeInputs(current, confirmation) !== inputs) throw changedMerge()
    const currentDocuments = projectDocuments(current)
    if (planned.requiredKeys.some(key => currentDocuments.get(key) !== originalDocuments.get(key))) throw changedMerge()
    const changes = state.knowledgeMergeDeletions || {}
    for (const deletion of Object.values(changes)) {
      if (deletion.requiredHashes[sourceKey] === sourceHash) {
        delete deletion.requiredHashes[sourceKey]
        for (const { key, after } of changedDocuments) deletion.requiredHashes[key] ??= after
      }
      for (const { key, before, after } of changedDocuments) {
        if (deletion.requiredHashes[key] === before) deletion.requiredHashes[key] = after
      }
    }
    changes[sourceKey] = { sourceHash: sourceHash!, requiredHashes }
    state.knowledgeMergeDeletions = changes
    state.approvedUploads = state.approvedUploads?.filter(key => key !== sourceKey)
    state.pendingUploads = state.pendingUploads?.filter(item => item.key !== sourceKey)
    const plannedNovels = new Map(planned.backup.novels.map(novel => [novel.id, novel]))
    const plannedSessions = new Map(planned.backup.inspirationSessions.map(session => [session.id, session]))
    const required = new Set(planned.requiredKeys)
    return parseProjectBackup(JSON.stringify({
      ...current,
      novels: current.novels.map(novel => required.has(`novel:${novel.id}`) ? plannedNovels.get(novel.id)! : novel),
      knowledgeBases: current.knowledgeBases.filter(base => base.id !== confirmation.duplicateId)
        .map(base => base.id === confirmation.targetId ? planned.backup.knowledgeBases.find(item => item.id === base.id)! : base),
      inspirationSessions: current.inspirationSessions.map(session =>
        required.has(`inspiration:${session.id}`) ? plannedSessions.get(session.id)! : session),
    }))
  }

  let committed!: { project: ProjectBackup; state: SyncState }
  if (usesProjectKernel()) {
    await mutateProjectLibrary(draft => {
      const state = draft.sync.state || emptySyncState()
      const project = prepare(draft.backup, state)
      // The kernel verifies the staged library through its disk reader before publishing.
      draft.backup = project
      draft.sync.state = JSON.parse(JSON.stringify(state)) as SyncState
      committed = { project, state }
    })
  } else {
    await runTransaction(() => {
      const state = readCloudStateRow()
      const project = prepare(readSqlProject(), state)
      writeKnowledgeBaseRows(project.knowledgeBases.find(base => base.id === confirmation.targetId)!)
      const required = new Set(planned.requiredKeys)
      for (const novel of project.novels) {
        if (required.has(`novel:${novel.id}`)) execute('UPDATE novels SET knowledge_base_ids = ? WHERE id = ?',
          [JSON.stringify(novel.knowledgeBaseIds), novel.id])
      }
      for (const session of project.inspirationSessions) {
        if (required.has(`inspiration:${session.id}`)) execute('UPDATE inspiration_sessions SET value = ? WHERE id = ?',
          [JSON.stringify(session), session.id])
      }
      const stagedDocuments = projectDocuments(readSqlProject())
      if (planned.requiredKeys.some(key => stagedDocuments.get(key) !== plannedDocuments.get(key))) {
        throw new Error('合并后的资料或引用写入校验失败。')
      }
      deleteKnowledgeBaseRows(confirmation.duplicateId)
      const saved = readSqlProject()
      if (saved.knowledgeBases.some(base => base.id === confirmation.duplicateId)) throw new Error('知识库合并写入校验失败。')
      writeCloudStateRow(state)
      committed = { project: saved, state }
    }, { restoreOnWriteFailure: true })
  }
  return { ...committed, result: planned.result }
}
