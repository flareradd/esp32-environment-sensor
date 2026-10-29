import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../app/js/sync.js';
import { createMemoryStore } from '../../app/js/store.js';
import { DeviceError } from '../../app/js/api.js';

const T = 1793106000;
const line = (t, temp = 20) => `${t},${temp}.0,50.0,1010.0,50.0,40.0,60.0,4000\n`;

// A scripted stand-in for the device API.
function fakeApi({ days, today, logs, failOn = {} }) {
  const calls = [];
  return {
    calls,
    set(next) { Object.assign(this, next); },
    async days() {
      calls.push('days');
      if (failOn.days) throw failOn.days;
      return { days: this.daysList ?? days, today: this.todayStr ?? today };
    },
    async log(date) {
      calls.push(`log:${date}`);
      if (failOn[date]) throw failOn[date];
      const csv = (this.logs ?? logs)[date];
      if (csv === undefined) throw new DeviceError('http', 'no log for that day', { status: 404 });
      return csv;
    },
  };
}

test('first sync copies every device day; past days are complete, today is not', async () => {
  const api = fakeApi({ days: ['20261026', '20261027', '20261028'], today: '20261028',
    logs: { 20261026: line(T), 20261027: line(T + 86400), 20261028: line(T + 2 * 86400) } });
  const store = createMemoryStore();
  const r = await createSync({ api, store }).syncAll();
  assert.deepEqual(r.fetched, ['20261026', '20261027', '20261028']);
  const sums = await store.listSummaries();
  assert.deepEqual(sums.map((s) => [s.date, s.complete]), [['20261026', true], ['20261027', true], ['20261028', false]]);
  assert.equal(sums[0].summary.n, 1);
  assert.equal((await store.getMeta('lastSync')).fetched, 3);
});

test('second sync skips complete days and re-fetches only the day still in progress', async () => {
  const api = fakeApi({ days: ['20261027', '20261028'], today: '20261028',
    logs: { 20261027: line(T), 20261028: line(T + 86400) } });
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  api.calls.length = 0;
  api.logs = { ...api.logs, 20261028: line(T + 86400) + line(T + 86700, 25) };
  const r = await sync.syncAll();
  assert.deepEqual(api.calls, ['days', 'log:20261028']);
  assert.equal(r.skipped, 1);
  assert.equal((await store.getDay('20261028')).rows.length, 2);
});

test('when the device date rolls over, yesterday is finalised with a last fetch and today starts', async () => {
  const api = fakeApi({ days: ['20261028'], today: '20261028', logs: { 20261028: line(T) } });
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  assert.equal((await store.listSummaries())[0].complete, false);

  api.set({ daysList: ['20261028', '20261029'], todayStr: '20261029',
    logs: { 20261028: line(T) + line(T + 300), 20261029: line(T + 86400) } });
  await sync.syncAll();
  const sums = await store.listSummaries();
  assert.deepEqual(sums.map((s) => [s.date, s.complete, s.n]), [['20261028', true, 2], ['20261029', false, 1]]);

  api.calls.length = 0;
  await sync.syncAll();
  assert.ok(!api.calls.includes('log:20261028'), 'a finalised day is never fetched again');
});

test('the archive keeps days the device has pruned', async () => {
  const api = fakeApi({ days: ['20261001', '20261002'], today: '20261002', logs: { 20261001: line(T), 20261002: line(T + 86400) } });
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  api.set({ daysList: ['20261002'], todayStr: '20261002' }); // 20261001 pruned on the device
  await sync.syncAll();
  assert.deepEqual((await store.listSummaries()).map((s) => s.date), ['20261001', '20261002']);
});

test('rows the device has since lost are kept (merge, not replace)', async () => {
  const api = fakeApi({ days: ['20261028'], today: '20261028', logs: { 20261028: line(T) + line(T + 300) } });
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  api.logs = { 20261028: line(T + 300, 99) + line(T + 600) }; // device lost the first row and changed one
  await sync.syncAll();
  const rows = (await store.getDay('20261028')).rows;
  assert.deepEqual(rows.map((r) => [r[0], r[1]]), [[T, 20], [T + 300, 99], [T + 600, 20]]);
});

test('a day the device pruned mid-sync (404) is reported and the rest carry on', async () => {
  const api = fakeApi({ days: ['20261001', '20261002'], today: '20261002', logs: { 20261002: line(T) } });
  const r = await createSync({ api, store: createMemoryStore() }).syncAll();
  assert.deepEqual(r.missing, ['20261001']);
  assert.deepEqual(r.fetched, ['20261002']);
});

test('losing the device mid-sync throws, keeps what was copied, and the next sync finishes the job', async () => {
  const failOn = { 20261027: new DeviceError('network', 'gone') };
  const api = fakeApi({ days: ['20261026', '20261027', '20261028'], today: '20261028',
    logs: { 20261026: line(T), 20261027: line(T), 20261028: line(T) }, failOn });
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await assert.rejects(sync.syncAll(), (e) => e.kind === 'network');
  assert.deepEqual((await store.listSummaries()).map((s) => s.date), ['20261026']);
  assert.equal(await store.getMeta('lastSync'), undefined, 'a failed sync is not recorded as done');
  failOn[20261027] = undefined;  // device is back
  const r = await sync.syncAll();
  assert.deepEqual(r.fetched, ['20261027', '20261028']);
  assert.equal((await store.listSummaries()).length, 3);
});

test('two overlapping syncs share one run (the device serves one request at a time)', async () => {
  const api = fakeApi({ days: ['20261028'], today: '20261028', logs: { 20261028: line(T) } });
  const sync = createSync({ api, store: createMemoryStore() });
  const [a, b] = [sync.syncAll(), sync.syncAll()];
  assert.equal(a, b);
  await a;
  assert.equal(api.calls.filter((c) => c === 'days').length, 1);
  assert.equal(sync.running, false);
});

test('a device with no clock set has no days and nothing breaks', async () => {
  const api = fakeApi({ days: [], today: '', logs: {} });
  const r = await createSync({ api, store: createMemoryStore() }).syncAll();
  assert.deepEqual(r.fetched, []);
  assert.equal(r.today, '');
});

test('progress is reported', async () => {
  const api = fakeApi({ days: ['20261027', '20261028'], today: '20261028', logs: { 20261027: line(T), 20261028: line(T) } });
  const seen = [];
  await createSync({ api, store: createMemoryStore() }).syncAll((p) => seen.push(`${p.done}/${p.total}`));
  assert.deepEqual(seen, ['0/2', '1/2', '2/2']);
});
