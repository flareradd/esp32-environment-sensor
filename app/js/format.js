// Formatting for display. Times are epoch seconds shown in a chosen zone (see tz.js).

const dtfCache = new Map();
function dtf(locale, opts) {
  const key = locale + JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, opts); dtfCache.set(key, f); }
  return f;
}
const LOCALE = 'en-AU';

export function fmtNum(v, dec = 1) {
  if (v == null || !Number.isFinite(v)) return '–';
  const s = v.toFixed(dec);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; // never show "-0.0"
}

export const fmtClock = (t, timeZone) =>
  dtf(LOCALE, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000);

export const fmtDayShort = (t, timeZone) =>
  dtf(LOCALE, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(t * 1000);

export const fmtDateTime = (t, timeZone) => `${fmtDayShort(t, timeZone)}, ${fmtClock(t, timeZone)}`;

// 'YYYYMMDD' -> "Wednesday 28 October 2026" (long, with year unless withYear is false) or "Wed 28 Oct" (short).
// Calendar date only, so no zone.
export function fmtDateStr(ds, long = false, withYear = true) {
  const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)));
  return dtf(LOCALE, long
    ? { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }
    : { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');
}

export function fmtDuration(s) {
  s = Math.max(0, Math.round(s));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

export const fmtAgo = (s) => (s < 10 ? 'just now' : `${fmtDuration(s)} ago`);

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
