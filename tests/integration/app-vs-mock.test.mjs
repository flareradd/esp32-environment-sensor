// The app's real API client + sync code, talking over real HTTP to the mock device.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDevice } from '../../tools/mock-device/server.mjs';
import { createApi, DeviceError } from '../../app/js/api.js';
import { createSync } from '../../app/js/sync.js';
import { createMemoryStore } from '../../app/js/store.js';
import { makeTz } from '../../app/js/tz.js';

const FROZEN = Date.parse('2026-10-28T14:05:00+11:00');
let dev, base, api;
const control = async (qs) => (await fetch(`${base}/__control?${qs}`)).json();

before(async () => {
  dev = createMockDevice({ frozenAtMs: FROZEN, days: 45 });
  const port = await dev.listen(0);
  base = `http://127.0.0.1:${port}`;
  api = createApi({ getBase: () => base, pageProtocol: () => 'http:' });
});
after(() => dev.close());

// Every test starts from the same moment, with the same settings, whatever the previous one did.
beforeEach(async () => {
  await control('clockValid=1&truncatedTail=0&freezeAt=2026-10-28T14:05:00%2B11:00&resetRequests=1');
  await api.saveSettings({ keepDays: '21' });
});

test('state/today/days/settings parse as the app expects', async () => {
  const s = await api.state();
  assert.equal(s.timeValid, true);
  assert.equal(s.local, '2026-10-28 14:05:00');
  assert.equal(typeof s.tempC, 'number');
  assert.equal(typeof s.display.nextInS, 'number');
  const t = await api.today();
  assert.equal(t.date, '20261028');
  assert.ok(t.sound.max > t.sound.min);
  const d = await api.days();
  assert.equal(d.days.length, 21);
  assert.equal(d.today, '20261028');
  assert.equal((await api.settings()).keepDays, 21);
});

test('CORS headers are present on every API answer and on preflights', async () => {
  for (const path of ['/api/state', '/api/days', '/api/log?date=20261028', '/api/nope']) {
    const r = await fetch(base + path);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', path);
  }
  const pre = await fetch(`${base}/api/settings`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
});

test('a full sync archives all 21 days; summaries agree with the device\'s own /api/today', async () => {
  const store = createMemoryStore();
  const r = await createSync({ api, store }).syncAll();
  assert.equal(r.fetched.length, 21);
  const sums = await store.listSummaries();
  assert.equal(sums.length, 21);
  assert.equal(sums.filter((x) => x.complete).length, 20);
  assert.equal(sums.at(-1).complete, false);

  const today = sums.at(-1).summary, dev_ = await api.today();
  assert.ok(Math.abs(today.temp.min - dev_.temperature.min) < 0.06);
  assert.ok(Math.abs(today.temp.max - dev_.temperature.max) < 0.06);
  assert.ok(Math.abs(today.sound.max - dev_.sound.max) < 0.06);
  assert.ok(Math.abs(today.sound.avg - dev_.sound.avg) < 0.15, 'energy mean, rounding of 1-decimal log values');
  // 288 lines in a complete day (5-minute logging)
  assert.ok(sums.slice(0, 20).every((s) => s.n >= 287 && s.n <= 289), sums.slice(0, 3).map((s) => s.n).join());
});

test('day rollover: the app finalises yesterday and picks up the new day', async () => {
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  const before = (await store.getDay('20261028')).rows.length;

  await control('advanceS=21600'); // 14:05 -> 20:05
  await sync.syncAll();
  assert.ok((await store.getDay('20261028')).rows.length > before, 'today grew');

  await control('advanceS=14400'); // 20:05 -> 00:05 on the 29th
  const r = await sync.syncAll();
  assert.equal(r.today, '20261029');
  const sums = Object.fromEntries((await store.listSummaries()).map((s) => [s.date, s]));
  assert.equal(sums['20261028'].complete, true);
  assert.equal(sums['20261029'].complete, false);
  const tz = makeTz('Australia/Sydney');
  const last = (await store.getDay('20261028')).rows.at(-1)[0];
  assert.equal(tz.dateStr(last), '20261028');
  assert.ok(last > tz.midnight('20261029') - 600, 'the finalised day runs right up to midnight');
});

test('the archive outlives the device\'s pruning when keepDays is lowered', async () => {
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  const had = (await store.listSummaries()).length;
  const s = await api.saveSettings({ keepDays: '7' });
  assert.equal(s.keepDays, 7);
  assert.equal((await api.days()).days.length, 7);
  await sync.syncAll();
  assert.equal((await store.listSummaries()).length, had, 'nothing was lost from the archive');
  await api.saveSettings({ keepDays: '21' });
});

test('a truncated last line from a power cut does not break archiving', async () => {
  await control('truncatedTail=1');
  const store = createMemoryStore();
  const sync = createSync({ api, store });
  await sync.syncAll();
  const today = (await api.days()).today;
  const rows = (await store.getDay(today)).rows;
  assert.ok(rows.length > 10);
  assert.ok(rows.every((r) => r.length === 8 && Number.isFinite(r[0])));
  await control('truncatedTail=0');
});

test('device with no clock: no days; setting the clock from the phone then works once', async () => {
  await control('clockValid=0');
  const d = await api.days();
  assert.deepEqual([d.days, d.today], [[], '']);
  assert.equal((await api.state()).timeValid, false);
  const epoch = Math.floor(Date.parse('2026-10-29T10:00:00+11:00') / 1000);
  assert.deepEqual(await api.setTime(epoch), { ok: true });
  const s = await api.state();
  assert.equal(s.timeValid, true);
  assert.ok(s.local.startsWith('2026-10-29 10:00'));
  await assert.rejects(api.setTime(epoch), (e) => e instanceof DeviceError && e.status === 409);
});

test('refresh is rate limited like the firmware: second request gets 429 with retryInS', async () => {
  assert.deepEqual(await api.refresh(), { ok: true });
  await assert.rejects(api.refresh(), (e) => e.status === 429 && e.retryInS > 0 && e.retryInS <= 180);
  await control('advanceS=181');
  assert.deepEqual(await api.refresh(), { ok: true });
});

test('asking for a missing or malformed day gives clear errors', async () => {
  await assert.rejects(api.log('20200101'), (e) => e.status === 404 && /no log/.test(e.message));
  await assert.rejects(api.log('nonsense'), (e) => e.status === 400);
});

test('an unreachable device is a network error', async () => {
  const dead = createApi({ getBase: () => 'http://127.0.0.1:1', pageProtocol: () => 'http:' });
  await assert.rejects(dead.state(), (e) => e.kind === 'network');
});
