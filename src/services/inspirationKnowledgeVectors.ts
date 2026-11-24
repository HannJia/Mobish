import type { EmbeddingConfig } from '@/stores/config'
import type { KnowledgeBase } from '@/types/knowledge'
import { embedTextsWithProvider, embeddingSourceId, isRemoteEmbeddingEnabled } from './embeddings'
import { knowledgeSections } from './knowledgeSections'
import { entrySourceVersion } from './knowledgeSources'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { canUseKnowledgeEntry } from './knowledgeVisibility'

export interface KnowledgePassageLocation {
  baseId: string
  entryId: string
  start: number
}

const BATCH_SIZE = 16
const MAX_CACHED_VECTORS = 12_000
const RETRY_DELAY_MS = 30_000
const QUERY_TIMEOUT_MS = 1500
const vectors = new Map<string, number[]>()
let indexing: { key: string; controller: AbortController } | undefined
let retryAfter = 0
let lastModelKey = ''

export function stopInspirationKnowledgeIndexing() {
  indexing?.controller.abort()
  indexing = undefined
}

function rankVector(query: number[], vector: number[]) {
  if (query.length !== vector.length) return -1
  return query.reduce((score, value, index) => score + value * vector[index], 0)
}

function startIndexing(config: EmbeddingConfig, modelKey: string, selectionKey: string, missing: Map<string, string>) {
  if (indexing?.key === selectionKey) return
  indexing?.controller.abort()
  if (!missing.size || Date.now() < retryAfter) return
  const job = { key: selectionKey, controller: new AbortController() }
  indexing = job
  void (async () => {
    try {
      const pending = [...missing]
      for (let index = 0; index < pending.length; index += BATCH_SIZE) {
        job.controller.signal.throwIfAborted()
        if (modelKey !== lastModelKey) return
        const batch = pending.slice(index, index + BATCH_SIZE)
        const embedded = await embedTextsWithProvider(config, batch.map(([, text]) => text), job.controller.signal)
        job.controller.signal.throwIfAborted()
        batch.forEach(([key], offset) => { vectors.set(key, embedded[offset]) })
        while (vectors.size > MAX_CACHED_VECTORS) vectors.delete(vectors.keys().next().value!)
      }
    } catch {
      if (!job.controller.signal.aborted) retryAfter = Date.now() + RETRY_DELAY_MS
    } finally {
      if (indexing === job) indexing = undefined
    }
  })()
}

export async function searchInspirationKnowledgeVectors(
  bases: KnowledgeBase[], selectedIds: string[], config: EmbeddingConfig, query: string, signal: AbortSignal,
): Promise<KnowledgePassageLocation[]> {
  if (!isRemoteEmbeddingEnabled(config) || !selectedIds.length || !query.trim()) {
    stopInspirationKnowledgeIndexing()
    return []
  }
  const modelKey = JSON.stringify([embeddingSourceId(config.baseUrl), config.modelName])
  if (modelKey !== lastModelKey) {
    indexing?.controller.abort()
    vectors.clear()
    retryAfter = 0
    lastModelKey = modelKey
  }
  const ids = new Set(selectedIds)
  const missing = new Map<string, string>()
  const searchable: Array<KnowledgePassageLocation & { vector: number[] }> = []
  for (const base of bases) {
    if (!ids.has(base.id)) continue
    for (const entry of base.entries) {
      if (!canUseKnowledgeEntry(entry)) continue
      for (const section of knowledgeSections(entry)) {
        const text = [entry.title, section.path.join(' › '), section.text].join('\n')
        const key = buildAnalysisSourceVersionId(text)
        const vector = vectors.get(key)
        if (vector) searchable.push({ baseId: base.id, entryId: entry.id, start: section.start, vector })
        else if (missing.size + searchable.length < MAX_CACHED_VECTORS) missing.set(key, text)
      }
    }
  }
  if (missing.size || indexing) {
    // The missing set changes as a running job writes batches. Keep that job when it is still
    // working on the current set of documents, and cancel it when the selection changes.
    const sourceKey = JSON.stringify([modelKey, ...bases.filter(base => ids.has(base.id)).map(base =>
      [base.id, base.entries.filter(entry => canUseKnowledgeEntry(entry)).map(entry => entrySourceVersion(base.id, entry))])])
    startIndexing({ ...config }, modelKey, sourceKey, missing)
  }
  if (!searchable.length) return []
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.throwIfAborted()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)
  try {
    const [vector] = await embedTextsWithProvider(config, [query.slice(-2000)], controller.signal)
    return searchable.map(item => ({ item, score: rankVector(vector, item.vector) }))
      .filter(row => row.score > 0.28).sort((left, right) => right.score - left.score).slice(0, 5)
      .map(({ item: { baseId, entryId, start } }) => ({ baseId, entryId, start }))
  } catch {
    signal.throwIfAborted()
    return []
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
