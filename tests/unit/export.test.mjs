import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsCsv, summariesCsv, backupJson, parseBackup, mergeBackup, isoLocal } from '../../app/js/export.js';
import { summarize, parseLogCsv } from '../../app/js/logs.js';
import { makeTz } from '../../app/js/tz.js';

const syd = makeTz('Australia/Sydney');
const T = 1793156700; // 2026-10-28 14:05:00 AEDT
const rows = [[T, 24.1, 50.8, 1007.1, 47.7, 40.2, 60.5, 4003], [T + 300, null, null, null, 50, 45, 55, 4000]];
const day = (date, r = rows, complete = true) => ({ date, rows: r, complete, fetchedAt: 1, summary: summarize(r) });

test('isoLocal formats in the chosen zone', () => {
  assert.equal(isoLocal(T, syd), '2026-10-28 14:05:00');
  assert.equal(isoLocal(T, makeTz('UTC')), '2026-10-28 03:05:00');
});

test('recordsCsv: header, local time + epoch, empty fields for missing readings, days in order', () => {
  const csv = recordsCsv([day('20261029', [[T + 86400, 20, 40, 1000, 30, 29, 31, 3900]]), day('20261028')], syd);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'local_time,epoch,temperature_c,humidity_pct,pressure_hpa,sound_avg_db,sound_min_db,sound_max_db,battery_mv');
  assert.equal(lines[1], `2026-10-28 14:05:00,${T},24.1,50.8,1007.1,47.7,40.2,60.5,4003`);
  assert.equal(lines[2], `2026-10-28 14:10:00,${T + 300},,,,50.0,45.0,55.0,4000`);
  assert.equal(lines[3].split(',')[0], '2026-10-29 14:05:00');
  assert.equal(lines.length, 4);
  assert.ok(csv.endsWith('\n'));
});

test('summariesCsv: one line per day with every statistic', () => {
  const csv = summariesCsv([{ date: '20261028', complete: true, summary: summarize(rows) }]).trim().split('\n');
  assert.equal(csv.length, 2);
  const cols = csv[1].split(',');
  assert.equal(cols.length, csv[0].split(',').length);
  assert.deepEqual(cols.slice(0, 3), ['20261028', 'yes', '2']);
  assert.equal(cols[3], '24.1'); // temp min
});

test('backup round trip is lossless, including nulls and incomplete days', () => {
  const days = [day('20261028', rows, false), day('20261027')];
  const back = parseBackup(backupJson(days, { exportedAt: 5, firmware: '0.1.0' }));
  assert.deepEqual(back.map((d) => d.date), ['20261027', '20261028']);
  assert.deepEqual(back.find((d) => d.date === '20261028').rows, rows);
  assert.equal(back.find((d) => d.date === '20261028').complete, false);
  assert.equal(back.find((d) => d.date === '20261027').complete, true);
});

test('parseBackup rejects things that are not backups, with plain messages', () => {
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"a":1}'), /not a Statchain archive/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'statchain-archive', version: 99, days: [] })), /Unsupported backup version 99/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'statchain-archive', version: 1 })), /no days/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'statchain-archive', version: 1, days: [{ date: 'bad', rows: [] }] })), /damaged day/);
});

test('parseBackup drops malformed rows inside an otherwise good day', () => {
  const text = JSON.stringify({ format: 'statchain-archive', version: 1, days: [{ date: '20261028', complete: true,
    rows: [rows[0], [1, 2], 'x', [T, 'a', 1, 1, 1, 1, 1, 1], rows[1]] }] });
  assert.deepEqual(parseBackup(text)[0].rows, rows);
});

test('mergeBackup: adds new days, extends known ones, ignores identical ones, never un-completes a day', () => {
  const have = new Map([['20261027', day('20261027')], ['20261028', day('20261028', [rows[0]], false)]]);
  const incoming = [day('20261026'), day('20261027'), day('20261028', rows, true)];
  const r = mergeBackup(have, incoming, 99);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.deepEqual(r.write.map((d) => d.date), ['20261026', '20261028']);
  const d28 = r.write.find((d) => d.date === '20261028');
  assert.equal(d28.rows.length, 2);
  assert.equal(d28.complete, true);
  assert.equal(d28.summary.n, 2);

  const keep = mergeBackup(new Map([['20261028', day('20261028', rows, true)]]), [day('20261028', rows, false)], 1);
  assert.equal(keep.write.length, 0, 'an incomplete copy never downgrades a complete day');
});

test('device CSV -> archive -> records CSV keeps the numbers the device logged', () => {
  const deviceCsv = `${T},24.1,50.8,1007.1,47.7,40.2,60.5,4003\n${T + 300},,,,50.0,45.0,55.0,4000\n`;
  const out = recordsCsv([{ date: '20261028', rows: parseLogCsv(deviceCsv) }], syd).trim().split('\n').slice(1);
  assert.deepEqual(out.map((l) => l.split(',').slice(1).join(',')), deviceCsv.trim().split('\n'));
});
