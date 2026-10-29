// Building and reading export files. Pure: strings in, strings out.

import { COLS, CSV_HEADER } from './metrics.js';
import { mergeRows, summarize } from './logs.js';

export const BACKUP_FORMAT = 'statchain-archive';
export const BACKUP_VERSION = 1;

const num = (v, dec) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(dec));

// "2026-10-28 14:05:00" in the given zone.
export function isoLocal(t, tz) {
  const p = tz.parts(t), z = (n) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}:${z(p.second)}`;
}

// One line per log row, in time order. days: [{ date, rows }].
export function recordsCsv(days, tz) {
  const out = ['local_time,epoch,temperature_c,humidity_pct,pressure_hpa,sound_avg_db,sound_min_db,sound_max_db,battery_mv'];
  for (const d of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const r of d.rows) {
      out.push([isoLocal(r[0], tz), r[0], num(r[1], 1), num(r[2], 1), num(r[3], 1), num(r[4], 1), num(r[5], 1), num(r[6], 1), num(r[7], 0)].join(','));
    }
  }
  return `${out.join('\n')}\n`;
}

// One line per day: the daily summaries the app keeps.
export function summariesCsv(summaries) {
  const head = 'date,complete,readings,temp_min_c,temp_avg_c,temp_max_c,humidity_min_pct,humidity_avg_pct,humidity_max_pct,' +
    'pressure_min_hpa,pressure_avg_hpa,pressure_max_hpa,sound_min_db,sound_avg_db,sound_max_db,battery_min_mv,battery_max_mv';
  const out = [head];
  for (const s of [...summaries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const m = s.summary;
    out.push([s.date, s.complete ? 'yes' : 'no', m.n,
      num(m.temp.min, 1), num(m.temp.avg, 1), num(m.temp.max, 1),
      num(m.hum.min, 1), num(m.hum.avg, 1), num(m.hum.max, 1),
      num(m.press.min, 1), num(m.press.avg, 1), num(m.press.max, 1),
      num(m.sound.min, 1), num(m.sound.avg, 1), num(m.sound.max, 1),
      num(m.battMin, 0), num(m.battMax, 0)].join(','));
  }
  return `${out.join('\n')}\n`;
}

// Lossless backup: everything needed to restore the archive in another browser.
export function backupJson(days, { exportedAt = Date.now(), firmware } = {}) {
  return JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, firmware: firmware ?? null, columns: COLS,
    days: [...days].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({ date: d.date, complete: !!d.complete, rows: d.rows })),
  });
}

// Reads a backup file into days ready for the store. Throws Error with a plain message if it isn't one.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (data?.format !== BACKUP_FORMAT) throw new Error('That is not a Statchain archive backup.');
  if (data.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${data.version}.`);
  if (!Array.isArray(data.days)) throw new Error('The backup has no days in it.');
  const days = [];
  for (const d of data.days) {
    if (!/^\d{8}$/.test(d?.date ?? '') || !Array.isArray(d.rows)) throw new Error(`The backup has a damaged day (${d?.date ?? '?'}).`);
    const rows = d.rows.filter((r) => Array.isArray(r) && r.length === 8 && Number.isInteger(r[0]) &&
      r.slice(1).every((v) => v === null || Number.isFinite(v)));
    days.push({ date: d.date, complete: !!d.complete, rows });
  }
  return days;
}

// Merges backup days into what is already stored. Returns the days to write and what changed.
export function mergeBackup(existingByDate, incoming, now = Date.now()) {
  const write = [];
  let added = 0, updated = 0;
  for (const d of incoming) {
    const have = existingByDate.get(d.date);
    const rows = have ? mergeRows(have.rows, d.rows) : d.rows;
    const complete = !!(have?.complete || d.complete);
    if (!have) added++;
    else if (rows.length !== have.rows.length || complete !== have.complete) updated++;
    else continue; // nothing new in this day
    write.push({ date: d.date, rows, complete, fetchedAt: have?.fetchedAt ?? now, summary: summarize(rows) });
  }
  return { write, added, updated };
}

export { CSV_HEADER };
