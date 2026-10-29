// A small promise wrapper over IndexedDB for the outbox and the read cache
// (SPEC §8.5). When IndexedDB is unavailable (private mode, blocked storage)
// every call quietly does nothing, and the app works without persistence.

export type StoreName = 'outbox' | 'reads';

let opening: Promise<IDBDatabase | null> | undefined;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open('ferment', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('outbox', { keyPath: 'seq' });
        req.result.createObjectStore('reads');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = body(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Every key and value in `store`, in key order. */
export async function idbEntries<T>(store: StoreName): Promise<[IDBValidKey, T][]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    const out: [IDBValidKey, T][] = [];
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        out.push([cursor.key, cursor.value as T]);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

export async function idbPut(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  await run(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await run(store, 'readwrite', (s) => s.delete(key));
}
