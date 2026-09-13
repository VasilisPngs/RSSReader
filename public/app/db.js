const DB_NAME = "rssreader";
const DB_VERSION = 1;

export const TABLES = {
  folders: { key: "id", writable: true, indexes: [] },
  feeds: { key: "id", writable: true, indexes: [["folder_id", "folder_id"]] },
  feed_state: { key: "feed_id", writable: false, indexes: [] },
  articles: { key: "id", writable: false, indexes: [["feed_id", "feed_id"], ["published_at", "published_at"]] },
  article_state: { key: "article_id", writable: true, indexes: [] }
};

export const TABLE_NAMES = Object.keys(TABLES);

let dbPromise = null;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, config] of Object.entries(TABLES)) {
        const store = db.createObjectStore(name, { keyPath: config.key });
        for (const [indexName, path] of config.indexes) store.createIndex(indexName, path);
      }
      db.createObjectStore("outbox", { keyPath: ["table", "id"] });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database_blocked"));
  });
  return dbPromise;
}

async function transact(stores, mode, run) {
  const db = await openDatabase();
  const tx = db.transaction(stores, mode);
  const settled = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction_aborted"));
  });
  let result;
  try {
    result = await run(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    throw error;
  }
  await settled;
  return result;
}

export async function readAll(table) {
  return transact([table], "readonly", (tx) => promisify(tx.objectStore(table).getAll()));
}

export async function writeRows(entries) {
  if (entries.length === 0) return;
  const stamp = Date.now();
  const stores = [...new Set(entries.map((entry) => entry.table))];
  await transact([...stores, "outbox"], "readwrite", (tx) => {
    const outbox = tx.objectStore("outbox");
    for (const entry of entries) {
      const key = TABLES[entry.table].key;
      tx.objectStore(entry.table).put(entry.row);
      outbox.put({ table: entry.table, id: entry.row[key], queued_at: stamp });
    }
  });
}

export async function applyRemote(changes) {
  const tables = Object.keys(changes).filter((table) => TABLES[table] && changes[table].length > 0);
  if (tables.length === 0) return 0;
  return transact([...tables, "outbox"], "readwrite", async (tx) => {
    const outbox = tx.objectStore("outbox");
    let applied = 0;
    for (const table of tables) {
      const store = tx.objectStore(table);
      const key = TABLES[table].key;
      const writable = TABLES[table].writable;
      for (const row of changes[table]) {
        if (writable) {
          const pending = await promisify(outbox.get([table, row[key]]));
          if (pending) continue;
        }
        store.put(row);
        applied += 1;
      }
    }
    return applied;
  });
}

export async function listOutbox(limit) {
  const entries = await transact(["outbox"], "readonly", (tx) => promisify(tx.objectStore("outbox").getAll()));
  const slice = entries.slice(0, limit);
  if (slice.length === 0) return { total: entries.length, items: [] };
  const stores = [...new Set(slice.map((entry) => entry.table))];
  const items = await transact(stores, "readonly", async (tx) => {
    const collected = [];
    for (const entry of slice) {
      const row = await promisify(tx.objectStore(entry.table).get(entry.id));
      if (row) collected.push({ table: entry.table, id: entry.id, queued_at: entry.queued_at, row });
    }
    return collected;
  });
  return { total: entries.length, items };
}

export async function clearOutbox(items) {
  if (items.length === 0) return;
  await transact(["outbox"], "readwrite", async (tx) => {
    const outbox = tx.objectStore("outbox");
    for (const item of items) {
      const current = await promisify(outbox.get([item.table, item.id]));
      if (current && current.queued_at === item.queued_at) outbox.delete([item.table, item.id]);
    }
  });
}

export async function countOutbox() {
  return transact(["outbox"], "readonly", (tx) => promisify(tx.objectStore("outbox").count()));
}

export async function getMeta(key, fallback) {
  const record = await transact(["meta"], "readonly", (tx) => promisify(tx.objectStore("meta").get(key)));
  return record ? record.value : fallback;
}

export async function setMeta(key, value) {
  await transact(["meta"], "readwrite", (tx) => {
    tx.objectStore("meta").put({ key, value });
  });
}

export async function pruneArticles(cutoff) {
  return transact(["articles"], "readwrite", async (tx) => {
    const store = tx.objectStore("articles");
    const range = IDBKeyRange.upperBound(cutoff, true);
    const request = store.index("published_at").openKeyCursor(range);
    let removed = 0;
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        store.delete(cursor.primaryKey);
        removed += 1;
        cursor.continue();
      };
    });
    return removed;
  });
}
