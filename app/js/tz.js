// Time-zone helpers. The device logs one file per *local* (Sydney) day, so the app has to
// reason about local days and hours in that zone, whatever zone the phone is in.
// All timestamps here are epoch SECONDS.

const cache = new Map();

export function addDays(ds, n) {
  const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Whole days from a to b (b later => positive). Both are YYYYMMDD.
export function daysBetween(a, b) {
  const ms = (ds) => Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));
  return Math.round((ms(b) - ms(a)) / 86400000);
}

export const isDateStr = (s) => typeof s === 'string' && /^\d{8}$/.test(s);

// timeZone: an IANA name, or undefined for the phone's own zone.
export function makeTz(timeZone) {
  const key = timeZone ?? '';
  if (cache.has(key)) return cache.get(key);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (t) => {
    const o = {};
    for (const p of fmt.formatToParts(new Date(t * 1000))) if (p.type !== 'literal') o[p.type] = +p.value;
    return o;
  };
  const offsets = new Map(); // offsets only change at DST switches: one lookup per half hour is plenty
  const offsetS = (t) => {
    const k = Math.floor(t / 1800);
    let v = offsets.get(k);
    if (v === undefined) {
      const p = parts(k * 1800);
      v = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - k * 1800;
      offsets.set(k, v);
    }
    return v;
  };
  const dateStr = (t) => {
    const p = parts(t);
    return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  };
  const midnight = (ds) => {
    const base = Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)) / 1000;
    let guess = base;
    for (let i = 0; i < 3; i++) guess = base - offsetS(guess);
    return guess;
  };
  const startOfHour = (t) => Math.floor((t + offsetS(t)) / 3600) * 3600 - offsetS(t);
  const hourFrac = (t) => ((((t + offsetS(t)) % 86400) + 86400) % 86400) / 3600;

  const tz = { timeZone, offsetS, dateStr, midnight, startOfHour, hourFrac, parts };
  cache.set(key, tz);
  return tz;
}
