// Minimal IndexedDB-backed queue for daily entries submitted while the
// device is offline. The entry-form persists to this queue when
// navigator.onLine is false, and a background tick (kicked by the
// JmrPWAInit component on 'online') flushes the queue into Supabase.
//
// Photos cannot be JSON-serialised, so we store them as Blob refs.

const DB_NAME = 'srmd-jmr'
const STORE = 'pending-entries'
const VERSION = 1

export interface QueuedEntry {
  id: string
  payload: {
    project_id: string
    sub_project_id: string | null
    contractor_id: string
    item_id: string
    entry_date: string
    start_meter: number | null
    end_meter: number | null
    quantity: number
    rate_snapshot: number
    amount: number
    work_description: string | null
  }
  photoBlob: Blob | null
  photoFileName: string | null
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
  })
}

export async function enqueue(entry: QueuedEntry): Promise<void> {
  const db = await openDb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}

export async function queueSize(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0
  const db = await openDb()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    req.onsuccess = () => { res(req.result as number); db.close() }
    req.onerror = () => { rej(req.error); db.close() }
  })
}

export async function listQueue(): Promise<QueuedEntry[]> {
  const db = await openDb()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => { res(req.result as QueuedEntry[]); db.close() }
    req.onerror = () => { rej(req.error); db.close() }
  })
}

export async function dequeue(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}
