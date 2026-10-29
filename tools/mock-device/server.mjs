#!/usr/bin/env node
// Mock Statchain device: speaks the same HTTP API as the firmware (firmware/statchain/web.cpp)
// with realistic, seeded data, so the companion app can be developed and tested without hardware.
//
//   node tools/mock-device/server.mjs [--port 8765] [--days 45] [--seed 1] [--tz Australia/Sydney]
//                                     [--frozen-at 2026-10-28T14:05:00+11:00] [--latency 0]
//
// Extras that the real device does not have live under /__control/ (see handleControl).
// No dependencies; Node 18+.

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const FW_VERSION = '0.1.0';
const MIN_VALID_EPOCH = 1735689600; // same cut-off as the firmware: before 2025-01-01 the clock "isn't set"
const DISPLAY_MIN_GAP_S = 180;
const LOG_INTERVAL_S = 300;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash32(...ints) {
  let h = 2166136261;
  for (const x of ints) { h ^= x | 0; h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
const rnd = (seed, a, b = 0) => mulberry32(hash32(seed, a, b))();

// ---------------------------------------------------------------------------
// Time zone helpers (the device logs per *local* day)
// ---------------------------------------------------------------------------
function makeTz(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (ms) => {
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
    return o;
  };
  const offsetMs = (ms) => {
    const p = parts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const dateStr = (ms) => {
    const p = parts(ms);
    return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  };
  const localString = (ms) => {
    const p = parts(ms), z = (n) => String(n).padStart(2, '0');
    return `${p.year}-${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}:${z(p.second)}`;
  };
  const hourFrac = (ms) => { const p = parts(ms); return p.hour + p.minute / 60 + p.second / 3600; };
  const midnightMs = (ds) => {
    const y = +ds.slice(0, 4), m = +ds.slice(4, 6) - 1, d = +ds.slice(6, 8);
    let guess = Date.UTC(y, m, d);
    for (let i = 0; i < 3; i++) guess = Date.UTC(y, m, d) - offsetMs(guess);
    return guess;
  };
  const addDays = (ds, n) => {
    const t = Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8) + n);
    const d = new Date(t);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  return { dateStr, localString, hourFrac, midnightMs, addDays };
}

// ---------------------------------------------------------------------------
// The simulated world: what the sensors would read at a given moment
// ---------------------------------------------------------------------------
const BATT_CURVE = [[3270, 0], [3610, 5], [3690, 10], [3710, 15], [3730, 20], [3750, 25], [3770, 30], [3790, 35], [3800, 40],
  [3820, 45], [3840, 50], [3850, 55], [3870, 60], [3910, 65], [3950, 70], [3980, 75], [4020, 80], [4080, 85], [4110, 90],
  [4150, 95], [4200, 100]];
function battPercent(mv) { // same curve as firmware/statchain/sensors.cpp
  if (mv <= BATT_CURVE[0][0]) return 0;
  if (mv >= BATT_CURVE.at(-1)[0]) return 100;
  for (let i = 1; i < BATT_CURVE.length; i++) {
    if (mv <= BATT_CURVE[i][0]) {
      const [x0, y0] = BATT_CURVE[i - 1], [x1, y1] = BATT_CURVE[i];
      return Math.round(y0 + ((mv - x0) / (x1 - x0)) * (y1 - y0));
    }
  }
  return 100;
}

function makeWorld(seed, tz) {
  const soundBaseline = (h) => {
    if (h < 6) return 32;
    if (h < 8) return 32 + ((h - 6) / 2) * 18;
    if (h < 18) return 50 + 4 * Math.sin((h - 8) * 0.9);
    if (h < 22) return 47;
    return 38;
  };
  // A "slot" is 5 minutes; some slots contain a noisy event (a door, traffic, a vacuum cleaner...).
  const event = (slot) => (rnd(seed, slot, 7) < 0.12 ? 5 + rnd(seed, slot, 8) * 22 : 0);

  function env(ms) {
    const sec = ms / 1000, h = tz.hourFrac(ms), dn = Math.floor(sec / 86400);
    const dayOffset = (rnd(seed, dn, 1) - 0.5) * 5;
    const temp = 19 + dayOffset + 4 * Math.sin((2 * Math.PI * (h - 9)) / 24) + (rnd(seed, Math.floor(sec / 60), 2) - 0.5) * 0.3;
    const hum = Math.min(96, Math.max(18, 62 - 2.2 * (temp - 19) + (rnd(seed, Math.floor(sec / 600), 3) - 0.5) * 6));
    const press = 1013 + 7 * Math.sin((2 * Math.PI * sec) / (86400 * 5.3)) + 1.2 * Math.sin((2 * Math.PI * (h - 4)) / 12) +
      (rnd(seed, Math.floor(sec / 300), 4) - 0.5) * 0.4;
    const age = (sec / 86400 + hash32(seed) % 7) % 6.5; // days since the last charge
    const battMv = Math.round(4190 - 52 * age + (rnd(seed, Math.floor(sec / 300), 5) - 0.5) * 6);
    return { temp, hum, press, battMv };
  }

  // One log line's worth of sound for the 5 minutes starting at ms.
  function soundRecord(ms) {
    const slot = Math.floor(ms / 1000 / 300), base = soundBaseline(tz.hourFrac(ms)), ev = event(slot);
    const avg = Math.max(30, base + (rnd(seed, slot, 9) - 0.5) * 4 + ev * 0.3);
    // The mic's own noise floor is ~30 dBA, so nothing reads much below that.
    return { avg, min: Math.max(28, avg - (2 + rnd(seed, slot, 10) * 5)), max: avg + 3 + rnd(seed, slot, 11) * 6 + ev * 0.7 };
  }

  // The instantaneous 1 s reading the device shows live (changes every 5 s).
  function soundLive(ms) {
    const slot = Math.floor(ms / 1000 / 300), tick = Math.floor(ms / 5000);
    return soundBaseline(tz.hourFrac(ms)) + (rnd(seed, tick, 12) - 0.5) * 5 + event(slot) * 0.5;
  }

  return { env, soundRecord, soundLive };
}

// ---------------------------------------------------------------------------
// The mock device
// ---------------------------------------------------------------------------
export function createMockDevice(opts = {}) {
  const o = {
    seed: 1, days: 45, tz: 'Australia/Sydney', frozenAtMs: null, latencyMs: 0, ...opts,
  };
  const tz = makeTz(o.tz);
  const world = makeWorld(o.seed, tz);
  const startReal = Date.now();
  const bootMs = o.frozenAtMs ?? startReal;
  const sim = {
    frozen: o.frozenAtMs != null,
    frozenMs: o.frozenAtMs ?? 0,
    skewMs: 0,            // virtual clock offset, moved by /__control/clock
    clockValid: true,
    lastDisplayMs: 0,
    displayDrawn: false,
    nextDisplayMs: 0,
    sensors: { aht20: true, bmp280: true, mic: true, flash: true },
    forceLoud: false,
    truncatedTail: false,
    latencyMs: o.latencyMs,
    hotspot: false,
  };
  const settings = {
    soundIntervalS: 5, displayIntervalMin: 60, logIntervalMin: 5, keepDays: 21, loudDb: 80, battLowPct: 20,
    tempOffsetC: 0, soundCalDb: 0, aWeighting: true,
  };
  const requests = []; // log for tests: {method, path}

  const now = () => (sim.frozen ? sim.frozenMs : Date.now()) + sim.skewMs;
  const epochS = () => Math.floor(now() / 1000);
  const historyStartMs = () => bootMs - o.days * 86400000; // fixed: advancing the clock must not erase history

  // ---- day files
  function todayStr() { return tz.dateStr(now()); }
  function listDays() {
    if (!sim.clockValid) return [];
    const today = todayStr(), out = [];
    for (let i = settings.keepDays - 1; i >= 0; i--) {
      const d = tz.addDays(today, -i);
      if (tz.midnightMs(tz.addDays(d, 1)) > historyStartMs()) out.push(d);
    }
    return out;
  }
  function dayRecords(ds) {
    const start = tz.midnightMs(ds), end = Math.min(tz.midnightMs(tz.addDays(ds, 1)), now());
    const phase = (hash32(o.seed, +ds) % LOG_INTERVAL_S) * 1000;
    const rows = [];
    for (let t = start + phase; t < end; t += LOG_INTERVAL_S * 1000) {
      if (t < historyStartMs()) continue;
      const e = world.env(t), s = world.soundRecord(t);
      rows.push({
        t: Math.floor(t / 1000),
        temp: e.temp + settings.tempOffsetC, hum: e.hum, press: e.press,
        snd: s.avg + settings.soundCalDb, sndMin: s.min + settings.soundCalDb, sndMax: s.max + settings.soundCalDb,
        batt: e.battMv,
      });
    }
    return rows;
  }
  const f1 = (v) => (v == null || Number.isNaN(v) ? '' : v.toFixed(1));
  function dayCsv(ds) {
    let csv = dayRecords(ds)
      .map((r) => `${r.t},${f1(r.temp)},${f1(r.hum)},${f1(r.press)},${f1(r.snd)},${f1(r.sndMin)},${f1(r.sndMax)},${r.batt}\n`)
      .join('');
    if (sim.truncatedTail && ds === todayStr()) csv += '1793200000,23.1,4'; // a line cut short by a power loss
    return csv;
  }

  // ---- summaries
  const stat = (vals) => {
    const v = vals.filter((x) => x != null && !Number.isNaN(x));
    if (!v.length) return { min: null, max: null, avg: null };
    return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length };
  };
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const statJson = ({ min, max, avg }) => ({ min: r1(min), max: r1(max), avg: r1(avg) });

  // ---- endpoint payloads
  function state() {
    const ms = now(), valid = sim.clockValid;
    const e = world.env(ms);
    const rows = valid ? dayRecords(todayStr()) : [];
    const soundNow = sim.forceLoud ? settings.loudDb + 6 : world.soundLive(ms) + settings.soundCalDb;
    const sMin = rows.length ? Math.min(...rows.map((r) => r.sndMin), soundNow) : null;
    const sMax = rows.length ? Math.max(...rows.map((r) => r.sndMax), soundNow) : null;
    const mv = e.battMv;
    return {
      fw: FW_VERSION,
      epoch: valid ? Math.floor(ms / 1000) : 0,
      local: valid ? tz.localString(ms) : '',
      timeValid: valid,
      tempC: sim.sensors.aht20 ? r1(e.temp + settings.tempOffsetC) : null,
      humidity: sim.sensors.aht20 ? r1(e.hum) : null,
      pressureHPa: sim.sensors.bmp280 ? r1(e.press) : null,
      soundDb: sim.sensors.mic ? r1(soundNow) : null,
      soundMin: sMin == null ? null : r1(sMin),
      soundMax: sMax == null ? null : r1(sMax),
      aWeighting: settings.aWeighting,
      loudDb: settings.loudDb,
      battValid: true,
      battMv: mv,
      battPct: battPercent(mv),
      battLowPct: settings.battLowPct,
      ip: sim.hotspot ? '192.168.4.1' : '192.168.1.50',
      rssi: sim.hotspot ? 0 : -58,
      hotspot: sim.hotspot,
      uptimeS: Math.floor((now() - bootMs - sim.skewMs) / 1000) + 4321,
      freeHeap: 180000,
      display: {
        drawn: sim.displayDrawn,
        lastEpoch: sim.displayDrawn && valid ? Math.floor(sim.lastDisplayMs / 1000) : 0,
        nextInS: sim.displayDrawn ? Math.max(0, Math.floor((sim.nextDisplayMs - now()) / 1000)) : 0,
      },
      sensors: { ...sim.sensors },
    };
  }
  function today() {
    if (!sim.clockValid) {
      return { date: '', temperature: statJson(stat([])), humidity: statJson(stat([])), pressure: statJson(stat([])),
        sound: statJson(stat([])), soundReadings: 0 };
    }
    const rows = dayRecords(todayStr());
    const energy = rows.map((r) => 10 ** (r.snd / 10));
    const sAvg = energy.length ? 10 * Math.log10(energy.reduce((a, b) => a + b, 0) / energy.length) : null;
    return {
      date: todayStr(),
      temperature: statJson(stat(rows.map((r) => r.temp))),
      humidity: statJson(stat(rows.map((r) => r.hum))),
      pressure: statJson(stat(rows.map((r) => r.press))),
      sound: statJson({ min: stat(rows.map((r) => r.sndMin)).min, max: stat(rows.map((r) => r.sndMax)).max, avg: sAvg }),
      soundReadings: rows.length * 60,
    };
  }
  const settingsJson = () => ({ ...settings, tempOffsetC: r2(settings.tempOffsetC), soundCalDb: r2(settings.soundCalDb) });

  // ---- HTTP plumbing
  function send(res, code, body, type = 'application/json') {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(code, {
      'Content-Type': type, 'Content-Length': buf.length,
      'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
    });
    res.end(buf);
  }
  const clampInt = (v, lo, hi, cur) => {
    if (v == null) return cur;
    const n = parseInt(v, 10) || 0; // like Arduino String::toInt(): garbage -> 0, then clamped
    return Math.min(hi, Math.max(lo, n));
  };

  function handleControl(url, res) {
    const q = url.searchParams;
    if (q.has('advanceS')) { if (sim.frozen) sim.frozenMs += +q.get('advanceS') * 1000; else sim.skewMs += +q.get('advanceS') * 1000; }
    if (q.has('freezeAt')) { sim.frozen = true; sim.frozenMs = Date.parse(q.get('freezeAt')) - sim.skewMs; }
    if (q.has('clockValid')) sim.clockValid = q.get('clockValid') === '1';
    if (q.has('loud')) sim.forceLoud = q.get('loud') === '1';
    if (q.has('truncatedTail')) sim.truncatedTail = q.get('truncatedTail') === '1';
    if (q.has('latencyMs')) sim.latencyMs = +q.get('latencyMs');
    if (q.has('hotspot')) sim.hotspot = q.get('hotspot') === '1';
    for (const k of Object.keys(sim.sensors)) if (q.has(k)) sim.sensors[k] = q.get(k) === '1';
    if (q.has('resetRequests')) requests.length = 0;
    send(res, 200, { ok: true, now: tz.localString(now()), today: todayStr(), sim: { ...sim, sensors: undefined }, requests: q.has('requests') ? requests : undefined });
  }

  function route(req, res, body) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname, method = req.method;
    if (!path.startsWith('/__control')) requests.push({ method, path });
    const args = new URLSearchParams(url.search);
    if (body) for (const [k, v] of new URLSearchParams(body)) args.set(k, v);

    if (path.startsWith('/__control')) return handleControl(url, res);

    if (method === 'GET' && path === '/') return send(res, 200, '<!doctype html><title>Statchain (mock)</title><h1>Statchain mock device</h1>', 'text/html');
    if (method === 'GET' && path === '/api/state') return send(res, 200, state());
    if (method === 'GET' && path === '/api/today') return send(res, 200, today());
    if (method === 'GET' && path === '/api/days') {
      return send(res, 200, { days: listDays(), today: sim.clockValid ? todayStr() : '', freeBytes: 1_100_000, totalBytes: 1_500_000 });
    }
    if (method === 'GET' && path === '/api/log') {
      const d = args.get('date') || '';
      if (!/^\d{8}$/.test(d)) return send(res, 400, { error: 'date must be YYYYMMDD' });
      if (!listDays().includes(d)) return send(res, 404, { error: 'no log for that day' });
      return send(res, 200, dayCsv(d), 'text/csv');
    }
    if (method === 'GET' && path === '/api/settings') return send(res, 200, settingsJson());
    if (method === 'POST' && path === '/api/settings') {
      const s = settings;
      s.soundIntervalS = clampInt(args.get('soundIntervalS'), 2, 300, s.soundIntervalS);
      s.displayIntervalMin = clampInt(args.get('displayIntervalMin'), 5, 1440, s.displayIntervalMin);
      s.logIntervalMin = clampInt(args.get('logIntervalMin'), 1, 60, s.logIntervalMin);
      s.keepDays = clampInt(args.get('keepDays'), 1, 90, s.keepDays);
      s.loudDb = clampInt(args.get('loudDb'), 40, 120, s.loudDb);
      s.battLowPct = clampInt(args.get('battLowPct'), 5, 50, s.battLowPct);
      if (args.has('tempOffsetC')) s.tempOffsetC = Math.min(10, Math.max(-10, parseFloat(args.get('tempOffsetC')) || 0));
      if (args.has('soundCalDb')) s.soundCalDb = Math.min(30, Math.max(-30, parseFloat(args.get('soundCalDb')) || 0));
      if (args.has('aWeighting')) s.aWeighting = ['1', 'true', 'on'].includes(args.get('aWeighting'));
      return send(res, 200, settingsJson());
    }
    if (method === 'POST' && path === '/api/refresh') {
      const since = sim.displayDrawn ? Math.floor((now() - sim.lastDisplayMs) / 1000) : Infinity;
      if (since < DISPLAY_MIN_GAP_S) return send(res, 429, { ok: false, retryInS: DISPLAY_MIN_GAP_S - since });
      sim.displayDrawn = true; sim.lastDisplayMs = now(); sim.nextDisplayMs = now() + settings.displayIntervalMin * 60000;
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/time') {
      if (sim.clockValid) return send(res, 409, { error: 'clock already set', ok: false });
      const e = parseInt(args.get('epoch'), 10) || 0;
      if (e < MIN_VALID_EPOCH) return send(res, 400, { error: 'epoch must be unix seconds', ok: false });
      sim.skewMs += e * 1000 - now(); sim.clockValid = true;
      return send(res, 200, { ok: true });
    }
    if (method === 'OPTIONS') { // CORS preflight, answered for any path like the firmware's not-found handler
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true',
      });
      return res.end();
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const go = () => { try { route(req, res, body); } catch (e) { send(res, 500, { error: String(e) }); } };
      if (sim.latencyMs > 0 && !req.url.startsWith('/__control')) setTimeout(go, sim.latencyMs); else go();
    });
  });

  return {
    server, sim, settings, requests, tz,
    now, todayStr, listDays, dayRecords,
    listen: (port = 0, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), opt = {};
  const flag = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help')) {
    console.log('usage: node server.mjs [--port 8765] [--days 45] [--seed 1] [--tz Australia/Sydney] [--frozen-at ISO] [--latency ms]');
    process.exit(0);
  }
  if (flag('days')) opt.days = +flag('days');
  if (flag('seed')) opt.seed = +flag('seed');
  if (flag('tz')) opt.tz = flag('tz');
  if (flag('latency')) opt.latencyMs = +flag('latency');
  if (flag('frozen-at')) opt.frozenAtMs = Date.parse(flag('frozen-at'));
  const dev = createMockDevice(opt);
  const port = await dev.listen(+(flag('port') ?? 8765), '0.0.0.0');
  console.log(`Mock Statchain listening on http://localhost:${port}  (local time ${dev.tz.localString(dev.now())})`);
}
