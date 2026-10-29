import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefs, DEFAULTS } from '../../app/js/prefs.js';
import { createMemoryStore, openStore } from '../../app/js/store.js';

const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

test('prefs: defaults, round-trip of non-string values, and change notifications', () => {
  const p = createPrefs(fakeStorage());
  assert.equal(p.get('deviceUrl'), DEFAULTS.deviceUrl);
  assert.equal(p.get('autoSync'), true);
  const seen = [];
  const off = p.onChange((k, v) => seen.push([k, v]));
  p.set('autoSync', false);
  p.set('lastState', { tempC: 21.5 });
  assert.equal(p.get('autoSync'), false);
  assert.deepEqual(p.get('lastState'), { tempC: 21.5 });
  assert.deepEqual(seen, [['autoSync', false], ['lastState', { tempC: 21.5 }]]);
  off(); p.set('theme', 'dark');
  assert.equal(seen.length, 2);
});

test('prefs: survive a corrupt stored value and a storage that throws on write', () => {
  const s = fakeStorage();
  s.setItem('statchain.theme', '{not json');
  const p = createPrefs(s);
  assert.equal(p.get('theme'), DEFAULTS.theme);
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() {} };
  const q = createPrefs(hostile);
  q.set('theme', 'dark');
  assert.equal(q.get('theme'), 'dark', 'still works for this page load');
});

const day = (date, n = 2) => ({ date, rows: Array.from({ length: n }, (_, i) => [1793106000 + i * 300, 20, 50, 1010, 50, 40, 60, 4000]),
  complete: true, fetchedAt: 123, summary: { n } });

test('memory store: round trip, ordering, isolation from caller mutation', async () => {
  const s = createMemoryStore();
  await s.putDay(day('20261029'));
  await s.putDay(day('20261027', 3));
  assert.deepEqual((await s.listSummaries()).map((x) => [x.date, x.n]), [['20261027', 3], ['20261029', 2]]);
  const got = await s.getDay('20261027');
  got.rows.length = 0;
  assert.equal((await s.getDay('20261027')).rows.length, 3, 'a stored day is not aliased by what callers hold');
  assert.deepEqual((await s.getDays(['20261027', '20990101', '20261029'])).map((d) => d.date), ['20261027', '20261029']);
  await s.setMeta('lastSync', { at: 5 });
  assert.deepEqual(await s.getMeta('lastSync'), { at: 5 });
  await s.deleteDay('20261027');
  assert.equal((await s.listSummaries()).length, 1);
  await s.clear();
  assert.equal((await s.listSummaries()).length, 0);
  assert.equal(await s.getMeta('lastSync'), undefined);
});

test('openStore falls back to memory (and says so) when IndexedDB is missing or broken', async () => {
  assert.equal((await openStore(null)).persistent, false);
  const broken = { open() { const r = {}; queueMicrotask(() => r.onerror?.()); return Object.assign(r, { error: new Error('denied') }); } };
  assert.equal((await openStore(broken)).persistent, false);
});
