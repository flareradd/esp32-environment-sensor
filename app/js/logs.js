// Pure functions over archived log rows: parsing the device's CSV, summarising a day,
// merging, and turning rows into chart series at a sensible resolution. No DOM, no I/O.

import { METRICS } from './metrics.js';
import { addDays } from './tz.js';

const MIN_VALID_EPOCH = 1735689600; // matches the firmware: earlier means the clock wasn't set
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// One device log file -> rows, sorted by time. Lines that are cut short (a power loss mid-write)
// or garbled are skipped, never half-read.
export function parseLogCsv(text) {
  const byT = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) continue;
    const f = line.split(',');
    if (f.length !== 8) continue;
    const t = Number(f[0]);
    if (!Number.isInteger(t) || t < MIN_VALID_EPOCH) continue;
    const row = [t];
    for (let i = 1; i < 8; i++) {
      const v = f[i] === '' ? null : Number(f[i]);
      row.push(isNum(v) ? v : null);
    }
    byT.set(t, row);
  }
  return [...byT.values()].sort((a, b) => a[0] - b[0]);
}

// Union of two row sets by timestamp; where both have a time, b wins. Lets a re-fetched day
// extend what is already archived without losing rows the device has since dropped.
export function mergeRows(a, b) {
  const byT = new Map();
  for (const r of a) byT.set(r[0], r);
  for (const r of b) byT.set(r[0], r);
  return [...byT.values()].sort((x, y) => x[0] - y[0]);
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export function energyMean(dbs) {
  const v = dbs.filter(isNum);
  if (!v.length) return null;
  return 10 * Math.log10(v.reduce((s, d) => s + 10 ** (d / 10), 0) / v.length);
}

function stat(values) {
  const v = values.filter(isNum);
  if (!v.length) return { min: null, max: null, avg: null };
  return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((s, x) => s + x, 0) / v.length };
}

export function summarize(rows) {
  const col = (i) => rows.map((r) => r[i]);
  const snd = col(4);
  const sndMins = col(5).filter(isNum), sndMaxs = col(6).filter(isNum);
  const batt = stat(col(7));
  return {
    n: rows.length,
    firstT: rows.length ? rows[0][0] : null,
    lastT: rows.length ? rows[rows.length - 1][0] : null,
    temp: stat(col(1)),
    hum: stat(col(2)),
    press: stat(col(3)),
    sound: {
      min: sndMins.length ? Math.min(...sndMins) : stat(snd).min,
      max: sndMaxs.length ? Math.max(...sndMaxs) : stat(snd).max,
      avg: energyMean(snd),
    },
    battMin: batt.min,
    battMax: batt.max,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// Runs of missing days between archived days: the device only keeps a few weeks, so a gap
// means days the phone never got to copy. dates: YYYYMMDD strings.
export function findGaps(dates) {
  const sorted = [...new Set(dates)].sort();
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = addDays(sorted[i - 1], 1);
    if (from < sorted[i]) {
      const to = addDays(sorted[i], -1);
      let n = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) n++;
      gaps.push({ from, to, days: n });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

// How finely to plot a span: raw log lines for a day or so, hourly means for a couple of weeks,
// daily means beyond that.
export function chooseResolution(spanS) {
  if (spanS <= 36 * 3600) return 'raw';
  if (spanS <= 14 * 86400) return 'hour';
  return 'day';
}

// rows -> [{t, v, lo, hi, n}] for one metric. v is the line; lo/hi the min/max band (null if none).
// Buckets are aligned to local hours/days in `tz` (see tz.js).
export function buildSeries(rows, metric, res, tz) {
  const m = typeof metric === 'string' ? METRICS.find((x) => x.id === metric) : metric;
  if (res === 'raw') {
    const out = [];
    for (const r of rows) {
      const v = r[m.col];
      if (!isNum(v)) continue;
      const lo = m.minCol ? r[m.minCol] : null, hi = m.maxCol ? r[m.maxCol] : null;
      out.push({ t: r[0], v, lo: isNum(lo) ? lo : null, hi: isNum(hi) ? hi : null, n: 1 });
    }
    return out;
  }

  const groups = [];
  let cur = null, curEnd = -Infinity;
  for (const r of rows) {
    const t = r[0];
    if (!cur || t >= curEnd) {
      if (res === 'hour') {
        const start = tz.startOfHour(t);
        cur = { start, vals: [], mins: [], maxs: [] };
        curEnd = start + 3600;
      } else {
        const ds = tz.dateStr(t), start = tz.midnight(ds);
        cur = { start, vals: [], mins: [], maxs: [] };
        curEnd = tz.midnight(addDays(ds, 1));
      }
      groups.push(cur);
    }
    const v = r[m.col];
    if (!isNum(v)) continue;
    cur.vals.push(v);
    const lo = m.minCol ? r[m.minCol] : v, hi = m.maxCol ? r[m.maxCol] : v;
    cur.mins.push(isNum(lo) ? lo : v);
    cur.maxs.push(isNum(hi) ? hi : v);
  }
  const out = [];
  for (const g of groups) {
    if (!g.vals.length) continue;
    const v = m.energy ? energyMean(g.vals) : g.vals.reduce((s, x) => s + x, 0) / g.vals.length;
    out.push({ t: g.start, v, lo: Math.min(...g.mins), hi: Math.max(...g.maxs), n: g.vals.length });
  }
  return out;
}

// Indices where a line should be broken because data is missing: a gap much longer than the
// typical spacing means the device was off or out of range, and joining across it would invent data.
export function gapIndices(points, factor = 2.5) {
  if (points.length < 3) return new Set();
  const dts = [];
  for (let i = 1; i < points.length; i++) dts.push(points[i].t - points[i - 1].t);
  const sorted = [...dts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const breaks = new Set();
  for (let i = 1; i < points.length; i++) if (dts[i - 1] > median * factor) breaks.add(i);
  return breaks;
}
