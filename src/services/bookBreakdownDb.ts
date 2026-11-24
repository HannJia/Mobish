import type { BreakdownJob } from './bookBreakdownAnalysis'
import type { BreakdownSource } from './bookBreakdownSource'

let database: Promise<IDBDatabase> | undefined

function openBreakdownDb() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mojian-v3-book-breakdown', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('jobs', { keyPath: 'id' })
        request.result.createObjectStore('sources')
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined }
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
    }).catch(error => { database = undefined; throw error })
  }
  return database
}

function readResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadBreakdownJobs(): Promise<BreakdownJob[]> {
  const db = await openBreakdownDb()
  return readResult(db.transaction('jobs').objectStore('jobs').getAll())
}

export async function loadBreakdownSource(id: string, version: string): Promise<BreakdownSource | undefined> {
  const db = await openBreakdownDb()
  return readResult(db.transaction('sources').objectStore('sources').get([id, version]))
}

export async function saveBreakdownJob(job: BreakdownJob, source?: BreakdownSource): Promise<BreakdownJob> {
  const db = await openBreakdownDb()
  const next = JSON.parse(JSON.stringify({ ...job, revision: job.revision + 1 })) as BreakdownJob
  return new Promise((resolve, reject) => {
    const tx = db.transaction(source ? ['jobs', 'sources'] : ['jobs'], 'readwrite')
    const jobs = tx.objectStore('jobs')
    const lookup = jobs.get(job.id)
    let conflict = false
    lookup.onsuccess = () => {
      if ((lookup.result?.revision || 0) !== job.revision) {
        conflict = true
        tx.abort()
        return
      }
      jobs.put(next)
      if (source) tx.objectStore('sources').put(source, [job.id, source.version])
    }
    tx.oncomplete = () => resolve(next)
    tx.onabort = () => reject(conflict ? new Error('这条拆书记录已在其他窗口更新，请重新打开。') : tx.error || new Error('保存拆书进度失败。'))
  })
}
