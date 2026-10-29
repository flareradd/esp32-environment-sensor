// The firmware serves the app from firmware/statchain/app_assets.h. These tests make sure that file
// is exactly what a fresh build of app/ produces, so the device can never ship a stale app.
// (Needs `npm install` for esbuild; skipped if it is missing so the other tests still run.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

let tool = null;
try { tool = await import('../../tools/build-app.mjs'); } catch { /* esbuild not installed */ }
const skip = tool ? false : 'esbuild not installed (run npm install)';

test('the committed header matches a fresh build of app/ (run `npm run build:app` if this fails)', { skip }, async () => {
  const fresh = await tool.buildApp();
  const have = tool.parseHeader(readFileSync(tool.HEADER_PATH, 'utf8'));
  assert.deepEqual(have.map((a) => a.path), fresh.map((a) => a.path));
  for (const f of fresh) {
    const h = have.find((a) => a.path === f.path);
    const bytes = h.gzip ? gunzipSync(h.data) : h.data;
    assert.ok(bytes.equals(f.raw), `${f.path} in app_assets.h differs from app/ - run: npm run build:app`);
    assert.equal(h.mime, f.mime, f.path);
    assert.equal(h.etag, f.etag, f.path);
  }
});

test('the built page is self-contained and tells the app it is hosted by the device', { skip }, async () => {
  const assets = await tool.buildApp();
  const get = (p) => assets.find((a) => a.path === p).raw.toString();
  const html = get('/index.html');
  assert.match(html, /<meta name="statchain-host" content="device">/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(html, /href="app\.css"/);
  assert.doesNotMatch(html, /js\/main\.js|css\/app\.css/);
  const js = get('/app.js');
  assert.doesNotMatch(js, /\bfrom\s*["']\.\.?\//, 'bundle has no relative imports left');
  assert.ok(js.length > 20000, 'bundle contains the app');
  assert.ok(!assets.some((a) => a.path.includes('sw.js')), 'no service worker: it cannot run on a plain-http origin');
});

test('building is deterministic and the embedded app stays small', { skip }, async () => {
  const a = await tool.buildApp(), b = await tool.buildApp();
  assert.deepEqual(a.map((x) => x.etag), b.map((x) => x.etag));
  const flash = a.reduce((n, x) => n + (x.gz ?? x.raw).length, 0);
  assert.ok(flash < 100_000, `embedded app is ${flash} bytes; keep it small, it shares flash with the firmware`);
  assert.ok(a.length <= 10, 'a page load must stay a handful of requests (the device serves one connection at a time)');
});

test('every mime type is known and every path is absolute', { skip }, async () => {
  for (const a of await tool.buildApp()) {
    assert.ok(a.mime, a.path);
    assert.ok(a.path.startsWith('/'), a.path);
  }
});
