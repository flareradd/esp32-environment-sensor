// End-to-end: the real app in headless Chromium, against the mock device, on a different origin
// (so CORS is real). Run:  node --test tests/e2e/app.e2e.mjs        (needs Playwright + Chromium)
// Set SHOTS=/some/dir to also save screenshots.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { createMockDevice } from '../../tools/mock-device/server.mjs';
import { createAppServer } from '../../tools/serve-app.mjs';

const require = createRequire(join(process.env.PLAYWRIGHT_ROOT ?? execSync('npm root -g').toString().trim(), 'x.js'));
const { chromium } = require('playwright');

const FROZEN = '2026-10-28T14:05:00+11:00';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let browser, device, appServer, devPort, appPort, appUrl, deviceUrl;
const problems = []; // console errors / uncaught exceptions seen in any test

async function startDevice(port = 0) {
  device = createMockDevice({ frozenAtMs: Date.parse(FROZEN), days: 45 });
  devPort = await device.listen(port);
  deviceUrl = `http://127.0.0.1:${devPort}`;
}
const control = async (qs) => (await fetch(`${deviceUrl}/__control?${qs}`)).json();

before(async () => {
  await startDevice();
  appServer = createAppServer();
  appPort = await new Promise((r) => appServer.listen(0, '127.0.0.1', () => r(appServer.address().port)));
  appUrl = `http://127.0.0.1:${appPort}`;
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP statchain.test 127.0.0.1'] });
});
after(async () => { await browser?.close(); await device?.close(); appServer?.close(); });

// A fresh browser profile each time: empty IndexedDB / localStorage / service workers.
async function open({ hash = '#/home', width = 390, height = 844, scheme = 'light', prefs = {}, url } = {}) {
  await control('clockValid=1&truncatedTail=0&loud=0&latencyMs=0&resetRequests=1&aht20=1&bmp280=1&mic=1&flash=1&hotspot=0&freezeAt=' + encodeURIComponent(FROZEN));
  await fetch(`${deviceUrl}/api/settings`, { method: 'POST', body: new URLSearchParams({ keepDays: '21', loudDb: '80' }) });
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true, serviceWorkers: 'allow' });
  await context.addInitScript(([d, extra]) => {
    if (!localStorage.getItem('statchain.deviceUrl')) localStorage.setItem('statchain.deviceUrl', JSON.stringify(d));
    for (const [k, v] of Object.entries(extra)) if (!localStorage.getItem(`statchain.${k}`)) localStorage.setItem(`statchain.${k}`, JSON.stringify(v));
  }, [deviceUrl, prefs]);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR|Failed to load resource|Failed to fetch|Mixed Content|blocked/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.goto((url ?? appUrl) + '/' + hash);
  return { page, context };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const waitOnline = (page) => page.waitForFunction(() => window.statchain?.session.view.conn === 'online', null, { timeout: 15000 });
const waitSynced = (page) => page.waitForFunction(() => window.statchain?.session.view.sync.at > 0 && !window.statchain.session.view.sync.running, null, { timeout: 30000 });
const text = (page, sel) => page.locator(sel).first().innerText();

test('Home shows live readings that match what the device reports', async () => {
  const { page, context } = await open();
  await waitOnline(page);
  await waitSynced(page); // first connect copies the archive; the pill says so while it runs
  const s = await (await fetch(`${deviceUrl}/api/state`)).json();
  assert.equal(await text(page, '.pill'), 'Connected');
  assert.equal(await text(page, '.hero-num'), String(Math.round(s.soundDb)));
  const tiles = await page.locator('.tile').allInnerTexts();
  assert.ok(tiles[0].includes('Temperature') && tiles[0].includes(s.tempC.toFixed(1)), tiles[0]);
  assert.ok(tiles[1].includes('Humidity') && tiles[1].includes(String(Math.round(s.humidity))), tiles[1]);
  assert.ok(tiles[2].includes('Pressure') && tiles[2].includes(String(Math.round(s.pressureHPa))), tiles[2]);
  assert.ok(tiles[3].includes('Battery') && tiles[3].includes(`${s.battPct}`), tiles[3]);
  await page.waitForSelector('.tile-sub:not(:empty)'); // today's range arrives from /api/today
  assert.match(await text(page, '.tile-sub'), /^Today \d+\.\d–\d+\.\d$/);
  assert.equal(await page.locator('.banner').count(), 0, 'no banners when everything is fine');
  await shot(page, 'home-light');
  await context.close();
});

test('a loud room is flagged with a label and an icon, not just colour', async () => {
  const { page, context } = await open();
  await waitOnline(page);
  assert.equal(await page.locator('.hero-top .chip').isVisible(), false);
  await control('loud=1');
  await page.waitForSelector('.hero-top .chip:not([hidden])', { timeout: 10000 });
  assert.match(await text(page, '.hero-top .chip'), /Loud/);
  assert.ok(await page.locator('.hero-top .chip svg').count() > 0, 'icon present');
  assert.match(await page.locator('.hero').getAttribute('class'), /is-loud/);
  await shot(page, 'home-loud');
  await context.close();
});

test('losing the device shows a clear banner and dimmed last values; it recovers by itself', async () => {
  const { page, context } = await open();
  await waitOnline(page);
  const before = await text(page, '.hero-num');
  await device.close();
  await page.waitForSelector('.banner.error', { timeout: 20000 });
  assert.match(await text(page, '.banner.error'), /Can't reach your Statchain/);
  assert.equal(await text(page, '.pill'), 'Offline');
  assert.equal(await text(page, '.hero-num'), before, 'last known value stays on screen');
  assert.match(await page.locator('.view.home').getAttribute('class'), /stale/);
  await shot(page, 'home-offline');
  await startDevice(devPort); // same address again
  await page.waitForFunction(() => window.statchain.session.view.conn === 'online', null, { timeout: 40000 });
  assert.equal(await page.locator('.banner.error').count(), 0);
  await context.close();
});

test('device clock not set: the banner offers to set it from the phone, and it works', async () => {
  const { page, context } = await open();
  await waitOnline(page);
  await control('clockValid=0');
  await page.waitForSelector('.banner:has-text("clock isn\'t set")', { timeout: 10000 });
  await page.click('button:has-text("Set clock from this phone")');
  await page.waitForFunction(() => window.statchain.session.view.state?.timeValid === true, null, { timeout: 10000 });
  assert.equal(await page.locator('.banner:has-text("clock isn\'t set")').count(), 0);
  await context.close();
});

test('a failing sensor is reported by name', async () => {
  const { page, context } = await open();
  await waitOnline(page);
  await control('bmp280=0&mic=0');
  await page.waitForSelector('.banner.warn', { timeout: 10000 });
  const t = await text(page, '.banner.warn');
  assert.match(t, /pressure sensor/);
  assert.match(t, /microphone/);
  assert.doesNotMatch(t, /temperature\/humidity/);
  assert.equal(await text(page, '.hero-num'), '–', 'no reading shown as a dash, never a fake zero');
  await context.close();
});

test('first connect archives the device days on the phone (IndexedDB)', async () => {
  const { page, context } = await open();
  await waitSynced(page);
  const sums = await page.evaluate(() => window.statchain.store.listSummaries());
  assert.equal(sums.length, 21);
  assert.equal(sums.filter((x) => x.complete).length, 20);
  assert.equal(sums.at(-1).date, '20261028');
  assert.equal(await page.evaluate(() => window.statchain.store.persistent), true);
  // a reload keeps it: it is really on disk, not in memory
  await page.reload();
  assert.equal((await page.evaluate(() => window.statchain.store.listSummaries())).length, 21);
  await context.close();
});

test('Today: summary, charts, hover tooltip, keyboard reading, table twin, and stepping back a day', async () => {
  const { page, context } = await open({ hash: '#/today' });
  await waitSynced(page);
  await page.waitForSelector('.chart-svg .line');
  assert.equal(await text(page, '.date-title'), 'Wednesday 28 October');
  assert.ok(await page.locator('.date-label .chip').isVisible(), 'Today badge');
  assert.equal(await page.locator('.summary-card').count(), 4);
  assert.match(await text(page, '.summary-card'), /Low[\s\S]*Average[\s\S]*High/);
  assert.equal(await page.locator('.chart-card').count(), 4);
  await shot(page, 'today-light');

  // pointer: crosshair snaps, one tooltip with time + value + unit
  const svg = page.locator('.chart-card').first().locator('.chart-svg');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  const tip = page.locator('.chart-card').first().locator('.chart-tip');
  await tip.waitFor({ state: 'visible' });
  assert.match(await tip.innerText(), /\d{2}:\d{2}[\s\S]*\d+\.\d °C/);
  const first = await tip.innerText();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
  assert.notEqual(await tip.innerText(), first, 'tooltip follows the pointer');
  await page.mouse.move(0, 0);
  await tip.waitFor({ state: 'hidden' });

  // keyboard: same readout on focus, arrows move it, Escape clears it
  const chart = page.locator('.chart-card').nth(3).locator('.chart');
  await chart.focus();
  const tip4 = page.locator('.chart-card').nth(3).locator('.chart-tip');
  await tip4.waitFor({ state: 'visible' });
  const k0 = await tip4.innerText();
  await page.keyboard.press('ArrowLeft');
  assert.notEqual(await tip4.innerText(), k0);
  assert.match(await tip4.innerText(), /min \d+ · max \d+ dB/, 'sound shows its min-max range');
  assert.ok((await chart.locator('xpath=./div[@aria-live]').innerText()).length > 0, 'screen-reader announcement');
  await page.keyboard.press('Escape');
  await tip4.waitFor({ state: 'hidden' });

  // table twin carries the same numbers
  const nPoints = await page.locator('.chart-card').first().locator('.chart-svg .line').count();
  await page.click('button[aria-label="Show Temperature as a table"]');
  const rows = await page.locator('.chart-card').first().locator('table.data tbody tr').count();
  assert.ok(nPoints > 0 && rows >= 150, `table has ${rows} rows`);
  await page.click('button[aria-label="Show Temperature as a chart"]');
  await page.waitForSelector('.chart-card >> nth=0 >> .chart-svg .line');

  // previous day
  await page.click('button[aria-label="Previous day"]');
  await page.waitForFunction(() => document.querySelector('.date-title').textContent === 'Tuesday 27 October');
  assert.equal(await page.locator('.date-label .chip').isVisible(), false);
  assert.match(await text(page, '.date-label .muted'), /28\d readings|\d+ readings/);
  await context.close();
});

test('Trends: ranges change the resolution; the choice is remembered', async () => {
  const { page, context } = await open({ hash: '#/trends' });
  await waitSynced(page);
  await page.waitForSelector('.chart-svg .line');
  const note = () => page.locator('.filter-row + p').innerText();
  assert.match(await note(), /hourly averages · 21 days archived|hourly averages · 8 days archived/);
  await page.click('button.seg:has-text("24 hours")');
  await page.waitForFunction(() => /every logged reading/.test(document.querySelector('.filter-row + p').textContent));
  await page.click('button.seg:has-text("30 days")');
  await page.waitForFunction(() => /daily averages/.test(document.querySelector('.filter-row + p').textContent));
  assert.match(await text(page, '.chart-card:nth-child(1) .muted.small'), /Average \d+\.\d · low \d+\.\d · high \d+\.\d °C/);
  await shot(page, 'trends-30d');
  await page.click('button.seg:has-text("All")');
  await page.reload();
  await page.waitForSelector('.chart-svg .line');
  assert.equal(await page.locator('button.seg[aria-pressed="true"]').innerText(), 'All', 'range persisted');
  // one chart per measurement, each with its own axis: never two scales on one plot
  assert.equal(await page.locator('.chart-svg').count(), 4);
  await context.close();
});

test('Trends with an empty archive explains itself instead of showing empty charts', async () => {
  const { page, context } = await open({ hash: '#/trends', prefs: { autoSync: false } });
  await page.waitForSelector('.empty');
  assert.match(await text(page, '.empty'), /No archived data yet/);
  await context.close();
});

test('Settings: values come from the device, edits validate, save, and persist on the device', async () => {
  const { page, context } = await open({ hash: '#/settings' });
  await waitOnline(page);
  await page.waitForFunction(() => document.querySelector('#f-keepDays')?.value === '21');
  assert.equal(await page.inputValue('#f-soundIntervalS'), '5');
  assert.equal(await page.locator('button:has-text("Save to device")').isDisabled(), true, 'nothing changed yet');

  await page.fill('#f-keepDays', '500');
  await page.click('button:has-text("Save to device")');
  assert.match(await text(page, '.settings-form .msg.error, .settings-form p[role=status]'), /Keep logs on the device must be between 1 and 90/);
  assert.equal((await device.requests).filter((r) => r.method === 'POST' && r.path === '/api/settings').length, 1, 'only the test setup POST: invalid values are not sent');

  await page.fill('#f-keepDays', '30');
  await page.uncheck('#f-aWeighting');
  await page.click('button:has-text("Save to device")');
  await page.waitForSelector('.settings-form .msg.ok');
  assert.equal(device.settings.keepDays, 30);
  assert.equal(device.settings.aWeighting, false);
  assert.equal(await page.locator('button:has-text("Save to device")').isDisabled(), true);
  await shot(page, 'settings-light');
  await context.close();
});

test('Settings: a wrong device address gives a helpful message; fixing it reconnects', async () => {
  const { page, context } = await open({ hash: '#/settings' });
  await waitOnline(page);
  await page.fill('#addr', 'http://127.0.0.1:1');
  await page.click('button:has-text("Save and test")');
  await page.waitForSelector('.msg.error:has-text("Could not reach")');
  assert.match(await text(page, '.msg.error'), /same Wi-Fi/);
  await page.fill('#addr', deviceUrl.replace('http://', ''));  // scheme omitted, as people type it
  await page.click('button:has-text("Save and test")');
  await page.waitForSelector('.msg.ok:has-text("Connected to")');
  assert.equal(await page.inputValue('#addr'), deviceUrl);
  await context.close();
});

test('Settings: theme choice applies immediately and survives a reload; times can follow the phone', async () => {
  const { page, context } = await open({ hash: '#/settings' });
  await page.click('label.seg-label:has-text("Dark")');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 13, 13)');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, 'settings-dark');
  await page.click('label.seg-label:has-text("System")');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  await context.close();
});

test('Export: CSVs and a backup download with the right content; a cleared archive restores from the backup', async () => {
  const { page, context } = await open({ hash: '#/export' });
  await waitSynced(page);
  await page.waitForSelector('.export-btn');
  const n = await page.evaluate(async () => (await window.statchain.store.listSummaries()).reduce((a, s) => a + s.n, 0));

  const dl = async (label) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(`.export-btn:has-text("${label}")`)]); return [d.suggestedFilename(), readFileSync(await d.path(), 'utf8')]; };
  const [rName, rCsv] = await dl('Readings (CSV)');
  assert.match(rName, /^statchain-readings-20261008-20261028\.csv$/);
  const rLines = rCsv.trim().split('\n');
  assert.equal(rLines.length, n + 1, 'one line per archived reading, plus the header');
  assert.match(rLines[0], /^local_time,epoch,temperature_c/);
  assert.match(rLines[1], /^2026-10-0?8 \d\d:\d\d:\d\d,\d{10},/);

  const [sName, sCsv] = await dl('Daily summaries (CSV)');
  assert.match(sName, /daily-summaries/);
  assert.equal(sCsv.trim().split('\n').length, 22);

  const [bName, backup] = await dl('Backup (JSON)');
  assert.match(bName, /^statchain-backup-20261008-20261028\.json$/);
  assert.equal(JSON.parse(backup).days.length, 21);

  // a narrower range exports less
  await page.fill('#x-from', '2026-10-27');
  const [, small] = await dl('Readings (CSV)');
  assert.ok(small.trim().split('\n').length < rLines.length / 5);
  await page.fill('#x-from', '2026-10-29');   // start after end
  await page.click('.export-btn:has-text("Readings (CSV)")');
  await page.waitForSelector('.msg.error:has-text("start date")');

  // wipe the archive (auto-sync off so it doesn't refill behind our back), then restore from the backup file
  await page.evaluate(async () => { window.statchain.prefs.set('autoSync', false); await window.statchain.store.clear(); });
  await page.reload();
  await page.waitForSelector('.empty');
  await page.setInputFiles('#x-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.waitForSelector('.msg.ok:has-text("Restored")');
  assert.match(await text(page, '.msg.ok'), /21 new days/);
  assert.equal((await page.evaluate(() => window.statchain.store.listSummaries())).length, 21);

  await page.setInputFiles('#x-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await page.waitForSelector('.msg.error:has-text("not a Statchain archive backup")');
  await context.close();
});

test('day rollover: after midnight the old day is finalised and the new day appears', async () => {
  const { page, context } = await open({ hash: '#/settings', prefs: { autoSync: false } });
  await waitOnline(page);
  await page.click('button:has-text("Sync now")');
  await waitSynced(page);
  assert.equal((await page.evaluate(() => window.statchain.store.listSummaries())).at(-1).complete, false);
  await control('advanceS=36000'); // 14:05 -> 00:05 the next day
  await page.waitForFunction(() => window.statchain.session.view.state?.local?.startsWith('2026-10-29'), null, { timeout: 15000 });
  await page.click('button:has-text("Sync now")');
  await page.waitForFunction(() => window.statchain.session.view.sync.result?.today === '20261029', null, { timeout: 20000 });
  const sums = await page.evaluate(() => window.statchain.store.listSummaries());
  const by = Object.fromEntries(sums.map((s) => [s.date, s]));
  assert.equal(by['20261028'].complete, true);
  assert.equal(by['20261029'].complete, false);
  assert.equal(sums.length, 22);
  await context.close();
});

test('gaps in the archive are called out (the device only keeps a few weeks)', async () => {
  const { page, context } = await open({ hash: '#/settings', prefs: { autoSync: false } });
  await waitOnline(page);
  await page.evaluate(async () => {
    const row = [1793106000, 20, 50, 1010, 50, 40, 60, 4000];
    for (const date of ['20260801', '20260802', '20260810']) {
      await window.statchain.store.putDay({ date, rows: [row], complete: true, fetchedAt: 1, summary: { n: 1, temp: {}, hum: {}, press: {}, sound: {} } });
    }
  });
  await page.click('button:has-text("Sync now")');
  await waitSynced(page);
  await page.waitForSelector('.banner.warn:has-text("Some days are missing")');
  assert.match(await text(page, '.banner.warn'), /Tue 4 Aug to Sun 9 Aug|Mon 3 Aug to Sun 9 Aug/);
  await context.close();
});

test('offline: the installed app still opens, and shows the archive saved on the phone', async () => {
  const { page, context } = await open({ hash: '#/trends' });
  await waitSynced(page);
  await page.waitForSelector('.chart-svg .line');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller || (location.reload(), false), null, { timeout: 15000 }).catch(() => {});
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await context.setOffline(true);
  await page.reload();
  assert.match(await page.title(), /Trends · Statchain/);
  await page.waitForSelector('.chart-svg .line', { timeout: 10000 });
  assert.equal(await page.locator('.chart-svg').count(), 4);
  await page.click('a.tab[data-route="home"]');
  await page.waitForSelector('.banner.error', { timeout: 20000 });
  assert.equal(await text(page, '.pill'), 'Offline');
  assert.notEqual(await text(page, '.hero-num'), '–', 'last known reading is shown from the previous visit');
  await shot(page, 'home-offline-reload');
  await context.close();
});

test('an https page cannot reach an http device: the browser blocks it and the app explains why', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript((d) => localStorage.setItem('statchain.deviceUrl', JSON.stringify(d)), `http://statchain.test:${devPort}`);
  // serve the app from a pretend https origin
  await context.route('https://app.example/**', async (route) => {
    const res = await fetch(`${appUrl}${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type') } });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto('https://app.example/#/home');
  await page.waitForSelector('.banner.error', { timeout: 15000 });
  assert.match(await text(page, '.banner.error'), /browser blocked/i);
  assert.equal(await text(page, '.pill'), 'Blocked by browser');
  await shot(page, 'home-blocked');
  await context.close();
});

test('mobile and desktop layouts have no horizontal scrolling and keep the tab bar in view', async () => {
  for (const [w, h, scheme] of [[360, 740, 'light'], [390, 844, 'dark'], [820, 1000, 'light'], [1280, 900, 'dark']]) {
    for (const route of ['home', 'today', 'trends', 'settings', 'export']) {
      const { page, context } = await open({ hash: `#/${route}`, width: w, height: h, scheme });
      await waitSynced(page);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        tab: document.getElementById('tabbar').getBoundingClientRect().bottom, vh: innerHeight }));
      assert.ok(m.sw <= m.cw, `${route} @${w}: horizontal overflow ${m.sw} > ${m.cw}`);
      assert.ok(Math.abs(m.tab - m.vh) < 2, `${route} @${w}: tab bar not at the bottom`);
      if (route === 'home' || route === 'trends' || route === 'today') await shot(page, `${route}-${w}-${scheme}`);
      await context.close();
    }
  }
});

test('accessibility basics: landmarks, names, focus order, tap targets', async () => {
  const { page, context } = await open({ hash: '#/today' });
  await waitSynced(page);
  await page.waitForSelector('.chart-svg .line');
  const r = await page.evaluate(() => {
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
    const unnamed = [...document.querySelectorAll('button, a[href], input, select')]
      .filter((el) => !name(el) && !(el.labels && el.labels.length) && !el.getAttribute('aria-labelledby')).map((el) => el.outerHTML.slice(0, 80));
    const small = [...document.querySelectorAll('button, a.tab, a.btn')].filter((el) => {
      const b = el.getBoundingClientRect(); return b.width > 0 && (b.height < 36 || b.width < 36);
    }).map((el) => `${name(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return {
      main: !!document.querySelector('main'), nav: !!document.querySelector('nav[aria-label]'), lang: document.documentElement.lang,
      h1orH2: document.querySelectorAll('h1, h2').length > 0, unnamed, small, current: document.querySelector('[aria-current="page"]')?.textContent,
      imgAlt: [...document.images].every((i) => i.hasAttribute('alt')), chartNames: [...document.querySelectorAll('.chart')].map((c) => c.getAttribute('aria-label')),
    };
  });
  assert.ok(r.main && r.nav && r.lang === 'en' && r.h1orH2);
  assert.deepEqual(r.unnamed, [], 'every control has an accessible name');
  assert.deepEqual(r.small, [], 'tap targets are at least 36px');
  assert.equal(r.current, 'Today');
  assert.ok(r.imgAlt);
  assert.ok(r.chartNames.every((n) => /points from .* to .*latest/.test(n)), r.chartNames.join('|'));
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'Tab moves focus into the page');
  await context.close();
});

test('no console errors or uncaught exceptions during any of the above', () => {
  assert.deepEqual(problems, []);
});
