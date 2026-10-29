// The arithmetic behind the charts: scales, tick placement, hit-testing. Pure and DOM-free,
// so it can be unit-tested. Times are epoch seconds.

import { addDays } from './tz.js';

// "Nice" 1-2-5 step for roughly `target` intervals across `span` (rounded to the nearest nice
// number, so the tick count stays close to what was asked for).
export function niceStep(span, target = 4) {
  const raw = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

// Round-number ticks covering [min, max]; the returned domain is widened to the outer ticks.
export function niceTicks(min, max, target = 4) {
  if (!(max > min)) { min -= 0.5; max += 0.5; }
  const step = niceStep(max - min, target);
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, min: lo, max: hi, step };
}

// Value domain for a series: pad a little, and never let a flat line fill the plot with noise
// (a 0.1 degree wiggle should not look like a storm), so enforce a minimum span per measurement.
export function yDomain(values, minSpan, pad = 0.08) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [0, minSpan];
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

// Fewest decimal places that represent a tick step exactly (5 -> 0, 0.5 -> 1, 0.25 -> 2).
export function tickDecimals(step) {
  for (let d = 0; d < 3; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d;
  }
  return 3;
}

// Index of the entry in ascending `xs` nearest to x.
export function nearestIndex(xs, x) {
  if (!xs.length) return -1;
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x) ? lo - 1 : lo;
}

// Splits [0, n) into runs at the break indices: each run is drawn as its own line, so a
// stretch with no data shows as a gap instead of a misleading straight join.
export function segments(n, breaks) {
  const out = [];
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (breaks.has(i)) { out.push([start, i - 1]); start = i; }
  }
  if (n) out.push([start, n - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Time axis
// ---------------------------------------------------------------------------
const fmtCache = new Map();
function dtf(timeZone, opts) {
  const key = (timeZone ?? '') + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-AU', { timeZone, ...opts }); fmtCache.set(key, f); }
  return f;
}

// Ticks at round local times: hours when the span is short, days, weeks, then months.
// Returns [{ t, label, major }]; a "major" tick is a local midnight (or month start).
export function timeTicks(t0, t1, tz, maxTicks = 5) {
  const span = t1 - t0;
  const zone = tz.timeZone;
  const out = [];

  const hourSteps = [1, 2, 3, 6, 12];
  const hStep = hourSteps.find((h) => span / (h * 3600) <= maxTicks);
  if (hStep) {
    for (let t = tz.startOfHour(t0); t <= t1; t += 3600) {
      if (t < t0) continue;
      const hour = Math.round(tz.hourFrac(t)) % 24;
      if (hour % hStep !== 0) continue;
      const midnight = hour === 0;
      out.push({
        t, major: midnight,
        label: midnight && span > 24 * 3600
          ? dtf(zone, { weekday: 'short', day: 'numeric' }).format(t * 1000)
          : dtf(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000),
      });
    }
    return out;
  }

  const monthly = span > 150 * 86400;
  if (monthly) {
    const first = tz.dateStr(t0);
    let ds = `${first.slice(0, 6)}01`;
    const monthsSpan = span / (30.4 * 86400);
    const every = monthsSpan / maxTicks > 1 ? Math.ceil(monthsSpan / maxTicks) : 1;
    let n = 0;
    for (;;) {
      const t = tz.midnight(ds);
      if (t > t1) break;
      if (t >= t0 && n % every === 0) {
        const jan = ds.slice(4, 6) === '01';
        out.push({ t, major: true, label: dtf(zone, jan ? { month: 'short', year: '2-digit' } : { month: 'short' }).format(t * 1000) });
      }
      const y = +ds.slice(0, 4), m = +ds.slice(4, 6);
      ds = m === 12 ? `${y + 1}0101` : `${y}${String(m + 1).padStart(2, '0')}01`;
      n++;
    }
    return out;
  }

  const dayCount = span / 86400;
  const dStep = [1, 2, 7, 14].find((d) => dayCount / d <= maxTicks) ?? 14;
  let ds = tz.dateStr(t0);
  if (tz.midnight(ds) < t0) ds = addDays(ds, 1);
  for (; ; ds = addDays(ds, dStep)) {
    const t = tz.midnight(ds);
    if (t > t1) break;
    out.push({ t, major: true, label: dtf(zone, dStep >= 7 || dayCount > 8 ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' }).format(t * 1000) });
  }
  return out;
}
