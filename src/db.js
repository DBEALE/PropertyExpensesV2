const DB_NAME = 'property-expenses';
// v2 added the categories store, which used to be a fixed enum in code.
const DB_VERSION = 2;

export const STORES = ['properties', 'categories', 'rules', 'transactions'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * Runs `work` inside one transaction and resolves once it commits, so callers
 * never read back a write that hasn't landed.
 *
 * @param {string|string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => IDBRequest|void} work
 */
function run(storeNames, mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        const request = work(tx);
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function getAll(store) {
  return run(store, 'readonly', (tx) => tx.objectStore(store).getAll());
}

export function put(store, value) {
  return run(store, 'readwrite', (tx) => {
    tx.objectStore(store).put(value);
  });
}

export function putMany(store, values) {
  return run(store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const value of values) os.put(value);
  });
}

export function remove(store, id) {
  return run(store, 'readwrite', (tx) => {
    tx.objectStore(store).delete(id);
  });
}

/** Replaces the entire contents of every store — used by backup restore. */
export function replaceAll(data) {
  return run(STORES, 'readwrite', (tx) => {
    for (const name of STORES) {
      const os = tx.objectStore(name);
      os.clear();
      for (const value of data[name]) os.put(value);
    }
  });
}

export function clearAll() {
  return run(STORES, 'readwrite', (tx) => {
    for (const name of STORES) tx.objectStore(name).clear();
  });
}

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
