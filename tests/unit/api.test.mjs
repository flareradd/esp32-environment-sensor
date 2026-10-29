import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, normalizeBase, DeviceError } from '../../app/js/api.js';

test('normalizeBase accepts what people actually type', () => {
  assert.equal(normalizeBase('192.168.1.50'), 'http://192.168.1.50');
  assert.equal(normalizeBase('  statchain.local  '), 'http://statchain.local');
  assert.equal(normalizeBase('statchain.local:8080/'), 'http://statchain.local:8080');
  assert.equal(normalizeBase('http://statchain.local/some/path'), 'http://statchain.local');
  assert.equal(normalizeBase('https://x.example'), 'https://x.example');
});

test('normalizeBase rejects nonsense', () => {
  for (const bad of ['', '   ', null, undefined, 'ftp://x', 'javascript:alert(1)', 'http://']) assert.equal(normalizeBase(bad), null, String(bad));
});

const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const mk = (fetchImpl, extra = {}) => createApi({ getBase: () => 'http://statchain.local', fetchImpl, pageProtocol: () => 'http:', ...extra });

test('GET returns parsed JSON; CSV is returned as text; requests are never cached', async () => {
  let seen;
  const api = mk(async (url, init) => { seen = { url, init }; return url.includes('/api/log') ? { ok: true, status: 200, text: async () => 'csv-here' } : jsonRes({ fw: '1' }); });
  assert.deepEqual(await api.state(), { fw: '1' });
  assert.equal(seen.url, 'http://statchain.local/api/state');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(await api.log('20261028'), 'csv-here');
  assert.equal(seen.url, 'http://statchain.local/api/log?date=20261028');
});

test('POST sends form-encoded fields (a simple CORS request, so no preflight)', async () => {
  let init;
  const api = mk(async (_u, i) => { init = i; return jsonRes({ ok: true }); });
  await api.saveSettings({ keepDays: 30, aWeighting: '1' });
  assert.equal(init.method, 'POST');
  assert.ok(init.body instanceof URLSearchParams);
  assert.equal(init.body.toString(), 'keepDays=30&aWeighting=1');
  await api.setTime(1793156700);
  assert.equal(init.body.get('epoch'), '1793156700');
});

test('unreachable device -> kind "network"', async () => {
  const api = mk(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.state(), (e) => e instanceof DeviceError && e.kind === 'network');
});

test('https page + http device -> kind "mixed-content", so the UI can explain it', async () => {
  const api = mk(async () => { throw new TypeError('Failed to fetch'); }, { pageProtocol: () => 'https:' });
  await assert.rejects(api.state(), (e) => e.kind === 'mixed-content');
  const https = createApi({ getBase: () => 'https://dev.example', fetchImpl: async () => { throw new TypeError('x'); }, pageProtocol: () => 'https:' });
  await assert.rejects(https.state(), (e) => e.kind === 'network');
});

test('a device that never answers -> kind "timeout"', async () => {
  const api = mk((_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  await assert.rejects(api.request('/api/state', { timeoutMs: 20 }), (e) => e.kind === 'timeout');
});

test('a device that stalls while sending the body is also a timeout, not a hang', async () => {
  const api = mk(async (_u, { signal }) => ({
    ok: true, status: 200,
    text: () => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  }));
  await assert.rejects(api.request('/api/log?date=1', { timeoutMs: 20, as: 'text' }), (e) => e.kind === 'timeout');
});

test('caller cancellation surfaces as AbortError, not as a device failure', async () => {
  const ctl = new AbortController();
  const api = mk((_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  const p = api.request('/api/state', { signal: ctl.signal, timeoutMs: 5000 });
  ctl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('HTTP errors carry status, the device message and retryInS', async () => {
  const api = mk(async () => jsonRes({ ok: false, retryInS: 95 }, 429));
  await assert.rejects(api.refresh(), (e) => e.kind === 'http' && e.status === 429 && e.retryInS === 95);
  const api2 = mk(async () => jsonRes({ error: 'no log for that day' }, 404));
  await assert.rejects(api2.log('20250101'), (e) => e.status === 404 && e.message === 'no log for that day');
});

test('an unparseable success reply -> kind "parse"; an unparseable error body still reports the status', async () => {
  const bad = (status) => ({ ok: status < 400, status, json: async () => { throw new SyntaxError('bad json'); }, text: async () => '<html>' });
  await assert.rejects(mk(async () => bad(200)).state(), (e) => e.kind === 'parse');
  await assert.rejects(mk(async () => bad(500)).state(), (e) => e.kind === 'http' && e.status === 500);
});

test('no address configured is reported, not fetched', async () => {
  let called = false;
  const api = createApi({ getBase: () => '', fetchImpl: async () => { called = true; return jsonRes({}); } });
  await assert.rejects(api.state(), (e) => e.kind === 'network');
  assert.equal(called, false);
});
