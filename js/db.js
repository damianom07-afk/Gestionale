// Piccolo strato sopra IndexedDB, il database interno del browser.
// I dati restano sul dispositivo: nessun server, nessun account.

const DB_NAME = 'gestionale';
const DB_VERSION = 1;

// nome tabella -> campo chiave
export const STORES = {
  accounts: 'id',      // conti (conto corrente, contanti, carta…)
  categories: 'id',    // categorie di spese ed entrate
  transactions: 'id',  // movimenti: spese ed entrate
  assets: 'id',        // strumenti di investimento (un ETF, un'azione…)
  ops: 'id',           // operazioni sugli investimenti (acquisto, vendita, dividendo)
  rules: 'key',        // esercente -> categoria, imparate dalle tue scelte
  meta: 'key'          // impostazioni varie (es. data dell'ultimo backup)
};

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) {
  return wrap((await store(name)).getAll());
}

export async function get(name, key) {
  return wrap((await store(name)).get(key));
}

export async function put(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function del(name, key) {
  return wrap((await store(name, 'readwrite')).delete(key));
}

/** Scrive molti record in un'unica transazione (tutto o niente). */
export async function bulkPut(name, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    for (const v of values) os.put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Sostituisce il contenuto di più tabelle in un'unica transazione. */
export async function replaceAll(data) {
  const db = await open();
  const names = Object.keys(STORES);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) {
      const os = tx.objectStore(n);
      os.clear();
      for (const v of data[n] || []) os.put(v);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Chiede al browser di non cancellare mai i dati per liberare spazio. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* non supportato */ }
  return false;
}
