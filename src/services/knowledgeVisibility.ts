import type { KBEntry, KnowledgeBase, KnowledgeVisibility } from '@/types/knowledge'

export function canUseKnowledgeEntry(entry: Pick<KBEntry, 'visibility'>, chapterNumber?: number): boolean {
  const visibility = entry.visibility
  if (!visibility) return true
  return visibility.mode === 'from-chapter' && Number.isSafeInteger(visibility.chapter)
    && visibility.chapter > 0 && chapterNumber !== undefined && chapterNumber >= visibility.chapter
}

export function canUseKnowledgeBaseSummary(base: KnowledgeBase, chapterNumber?: number): boolean {
  return base.entries.every(entry => canUseKnowledgeEntry(entry, chapterNumber))
}

export function mergedKnowledgeVisibility(entries: KBEntry[]): KnowledgeVisibility | undefined {
  if (entries.some(entry => entry.visibility?.mode === 'never')) return { mode: 'never' }
  const chapter = Math.max(0, ...entries.map(entry => entry.visibility?.mode === 'from-chapter' ? entry.visibility.chapter : 0))
  return chapter ? { mode: 'from-chapter', chapter } : undefined
}
