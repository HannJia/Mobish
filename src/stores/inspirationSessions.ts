import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createRevisionPersistence } from './revisionPersistence'
import { loadInspirationSessions, saveInspirationSessions } from '@/services/db/inspirationSessions'
import { sortInspirationSessions, parseInspirationSession, type InspirationSession } from '@/services/inspirationSessions'
import { usesProjectKernel } from '@/services/projectKernelClient'
import { useKnowledgeStore } from './knowledge'

export const useInspirationSessionsStore = defineStore('inspirationSessions', () => {
  const initialized = ref(false)
  const records = ref([{ id: 'sessions', sessions: [] as InspirationSession[] }])
  const sessions = computed(() => records.value[0].sessions)
  async function writeSessions(snapshot: { sessions: InspirationSession[] }) {
    if (usesProjectKernel()) await useKnowledgeStore().flushPendingSaves()
    await saveInspirationSessions(snapshot.sessions)
  }
  const persistence = createRevisionPersistence(records, initialized, writeSessions)
  let loading: Promise<void> | null = null
  function adopt(items: InspirationSession[]) {
    records.value[0].sessions = sortInspirationSessions(items.map(parseInspirationSession))
    persistence.adopt()
  }
  async function initialize() {
    if (initialized.value) return
    if (!loading) loading = loadInspirationSessions().then(items => { adopt(items); initialized.value = true })
      .finally(() => { loading = null })
    await loading
  }
  function upsert(item: InspirationSession) {
    if (!initialized.value) throw new Error('灵感记录尚未加载完成，请稍后重试。')
    const checked = parseInspirationSession(item)
    records.value[0].sessions = sortInspirationSessions([checked, ...sessions.value.filter(old => old.id !== item.id)])
    persistence.markDirty('sessions')
  }
  function remove(id: string) {
    return persistence.transact('sessions', async draft => {
      if (!draft.sessions.some(session => session.id === id)) return { persist: null, value: undefined }
      draft.sessions = draft.sessions.filter(session => session.id !== id)
      return { persist: () => writeSessions(draft), value: undefined }
    }, (_committed, merged) => ({ ...merged, sessions: merged.sessions.filter(session => session.id !== id) }))
  }
  function detachKnowledgeBase(id: string) {
    let changed = false
    for (const session of sessions.value) {
      if (!session.knowledgeIds?.includes(id)) continue
      session.knowledgeIds = session.knowledgeIds.filter(value => value !== id)
      changed = true
    }
    if (changed) persistence.markDirty('sessions')
  }
  return { sessions, initialized, initialize, upsert, remove, adopt, detachKnowledgeBase, flushPendingSaves: persistence.flush,
    saveError: persistence.saveError, saving: persistence.saving, hasPendingSaves: persistence.hasPendingSaves }
})
