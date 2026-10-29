// The phone-side archive. The device keeps only a few weeks of logs, so every day the app sees is
// copied here (IndexedDB) and kept until the user clears it.
//
// Two stores: `days` holds each day's rows (heavy), `summaries` holds a light record per day
// (date, complete?, fetchedAt, summary) so listing the archive doesn't load every row.
//
// day = { date: 'YYYYMMDD', rows: [[t,temp,hum,press,snd,sndMin,sndMax,batt], ...],
//         complete: boolean, fetchedAt: ms, summary: {...} }

const DB_NAME = 'statchain';
const DB_VERSION = 1;

const lightOf = (day) => ({
  date: day.date, complete: !!day.complete, fetchedAt: day.fetchedAt, summary: day.summary, n: day.rows.length,
});
const clone = (v) => (v === undefined ? v : structuredClone(v));

// ---------------------------------------------------------------------------
// In-memory implementation: tests, and browsers where IndexedDB is unavailable
// (data then only lasts until the page closes - `persistent` is false so the UI can say so).
// ---------------------------------------------------------------------------
export function createMemoryStore() {
  const days = new Map(), light = new Map(), meta = new Map();
  return {
    persistent: false,
    async getDay(date) { return clone(days.get(date)); },
    async putDay(day) { days.set(day.date, clone(day)); light.set(day.date, clone(lightOf(day))); },
    async deleteDay(date) { days.delete(date); light.delete(date); },
    async listSummaries() { return [...light.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(clone); },
    async getDays(dates) { return dates.map((d) => clone(days.get(d))).filter(Boolean); },
    async getMeta(key) { return clone(meta.get(key)); },
    async setMeta(key, value) { meta.set(key, clone(value)); },
    async clear() { days.clear(); light.clear(); meta.clear(); },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB implementation
// ---------------------------------------------------------------------------
const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

function openDb(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('days', { keyPath: 'date' });
      db.createObjectStore('summaries', { keyPath: 'date' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

// Falls back to the in-memory store if IndexedDB can't be opened (some private-browsing modes).
export async function openStore(factory = globalThis.indexedDB) {
  if (!factory) return createMemoryStore();
  let db;
  try {
    db = await openDb(factory);
  } catch {
    return createMemoryStore();
  }
  return {
    persistent: true,
    async getDay(date) { return reqP(db.transaction('days').objectStore('days').get(date)); },
    async putDay(day) {
      const tx = db.transaction(['days', 'summaries'], 'readwrite');
      tx.objectStore('days').put(day);
      tx.objectStore('summaries').put(lightOf(day));
      await txDone(tx);
    },
    async deleteDay(date) {
      const tx = db.transaction(['days', 'summaries'], 'readwrite');
      tx.objectStore('days').delete(date);
      tx.objectStore('summaries').delete(date);
      await txDone(tx);
    },
    async listSummaries() {
      const all = await reqP(db.transaction('summaries').objectStore('summaries').getAll());
      return all.sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async getDays(dates) {
      const store = db.transaction('days').objectStore('days');
      const found = await Promise.all(dates.map((d) => reqP(store.get(d))));
      return found.filter(Boolean);
    },
    async getMeta(key) { const r = await reqP(db.transaction('meta').objectStore('meta').get(key)); return r?.value; },
    async setMeta(key, value) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      await txDone(tx);
    },
    async clear() {
      const tx = db.transaction(['days', 'summaries', 'meta'], 'readwrite');
      for (const n of ['days', 'summaries', 'meta']) tx.objectStore(n).clear();
      await txDone(tx);
    },
  };
}
