import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogCsv, summarize, mergeRows, energyMean, findGaps, chooseResolution, buildSeries, gapIndices } from '../../app/js/logs.js';
import { makeTz } from '../../app/js/tz.js';

const T0 = 1793106000; // 2026-10-28 ~00:00 Sydney
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('parseLogCsv reads the firmware format, with empty fields as null', () => {
  const rows = parseLogCsv(`${T0},20.0,50.0,1010.0,50.0,40.0,60.0,4000\n${T0 + 300},,,,,,,3990\n`);
  assert.deepEqual(rows[0], [T0, 20, 50, 1010, 50, 40, 60, 4000]);
  assert.deepEqual(rows[1], [T0 + 300, null, null, null, null, null, null, 3990]);
});

test('parseLogCsv drops a line cut short by a power loss, garbage and impossible times', () => {
  const rows = parseLogCsv([
    `${T0},20.0,50.0,1010.0,50.0,40.0,60.0,4000`,
    `${T0 + 300},23.1,4`,                              // truncated mid-write
    `hello,world`,
    `12345,1,2,3,4,5,6,7`,                              // time before the clock was ever set
    `${T0 + 600},x,50.0,1010.0,50.0,40.0,60.0,4000`,   // junk in a field -> that field is null
    '',
  ].join('\n'));
  assert.deepEqual(rows.map((r) => r[0]), [T0, T0 + 600]);
  assert.equal(rows[1][1], null);
  assert.equal(rows[1][2], 50);
});

test('parseLogCsv copes with CRLF, unsorted input and duplicate timestamps (last wins)', () => {
  const rows = parseLogCsv(`${T0 + 300},2,2,2,2,2,2,2\r\n${T0},1,1,1,1,1,1,1\r\n${T0},9,9,9,9,9,9,9\r\n`);
  assert.deepEqual(rows.map((r) => [r[0], r[1]]), [[T0, 9], [T0 + 300, 2]]);
});

test('energyMean averages power, not decibels', () => {
  near(energyMean([60, 60]), 60);
  near(energyMean([50, 70]), 10 * Math.log10((1e5 + 1e7) / 2)); // ~67.0, far above the 60 a plain mean would give
  assert.equal(energyMean([]), null);
  assert.equal(energyMean([null, NaN]), null);
});

test('summarize: ranges, mean temperature, energy-mean sound, min/max from the sound columns', () => {
  const rows = [
    [T0, 20, 50, 1010, 50, 40, 60, 4000],
    [T0 + 300, 24, 40, 1012, 70, 35, 90, 3990],
    [T0 + 600, null, null, null, null, null, null, 3980],
  ];
  const s = summarize(rows);
  assert.equal(s.n, 3);
  assert.deepEqual([s.firstT, s.lastT], [T0, T0 + 600]);
  assert.deepEqual(s.temp, { min: 20, max: 24, avg: 22 });
  assert.deepEqual([s.press.min, s.press.max], [1010, 1012]);
  assert.equal(s.sound.min, 35);
  assert.equal(s.sound.max, 90);
  near(s.sound.avg, 67.03, 0.01); // 10*log10((1e5+1e7)/2); a plain dB mean would say 60
  assert.deepEqual([s.battMin, s.battMax], [3980, 4000]);
});

test('summarize of nothing is all nulls, not NaN or a crash', () => {
  const s = summarize([]);
  assert.equal(s.n, 0);
  assert.equal(s.temp.min, null);
  assert.equal(s.sound.avg, null);
});

test('mergeRows unions by time and lets the second set win', () => {
  const a = [[1793106000, 1, 1, 1, 1, 1, 1, 1], [1793106300, 2, 2, 2, 2, 2, 2, 2]];
  const b = [[1793106300, 9, 9, 9, 9, 9, 9, 9], [1793106600, 3, 3, 3, 3, 3, 3, 3]];
  const m = mergeRows(a, b);
  assert.deepEqual(m.map((r) => [r[0], r[1]]), [[1793106000, 1], [1793106300, 9], [1793106600, 3]]);
});

test('findGaps reports runs of missing days', () => {
  assert.deepEqual(findGaps(['20261001', '20261002', '20261003']), []);
  assert.deepEqual(findGaps(['20261031', '20261104', '20261001']), [
    { from: '20261002', to: '20261030', days: 29 },
    { from: '20261101', to: '20261103', days: 3 },
  ]);
  assert.deepEqual(findGaps(['20261201', '20261201']), []);
  assert.deepEqual(findGaps([]), []);
});

test('chooseResolution steps from raw to hourly to daily', () => {
  assert.equal(chooseResolution(24 * 3600), 'raw');
  assert.equal(chooseResolution(36 * 3600), 'raw');
  assert.equal(chooseResolution(36 * 3600 + 1), 'hour');
  assert.equal(chooseResolution(14 * 86400), 'hour');
  assert.equal(chooseResolution(30 * 86400), 'day');
});

const syd = makeTz('Australia/Sydney');
const hourRows = [ // three log lines in the 14:00 Sydney hour, two in 15:00
  [1793156400 + 0, 20, 50, 1010, 50, 45, 55, 4000],      // 14:00 AEDT
  [1793156400 + 300, 22, 52, 1011, 70, 60, 80, 4000],
  [1793156400 + 600, 24, 54, 1012, 60, 55, 65, 4000],
  [1793156400 + 3600, 30, 60, 1013, 40, 38, 42, 4000],   // 15:00
  [1793156400 + 3900, null, null, null, null, null, null, 4000],
];

test('buildSeries raw: sound carries its own min/max band, other metrics have none', () => {
  const snd = buildSeries(hourRows, 'sound', 'raw', syd);
  assert.deepEqual(snd[1], { t: 1793156700, v: 70, lo: 60, hi: 80, n: 1 });
  assert.equal(snd.length, 4, 'a row with no reading is left out, not plotted as zero');
  const temp = buildSeries(hourRows, 'temp', 'raw', syd);
  assert.equal(temp[0].lo, null);
  assert.equal(temp[0].hi, null);
});

test('buildSeries hour: buckets align to local hours, temp is a mean with a min-max band, sound an energy mean', () => {
  const temp = buildSeries(hourRows, 'temp', 'hour', syd);
  assert.equal(temp.length, 2);
  assert.equal(temp[0].t, 1793156400);
  near(temp[0].v, 22);
  assert.deepEqual([temp[0].lo, temp[0].hi, temp[0].n], [20, 24, 3]);
  const snd = buildSeries(hourRows, 'sound', 'hour', syd);
  near(snd[0].v, 65.68, 0.01); // 10*log10((1e5+1e7+1e6)/3)
  assert.deepEqual([snd[0].lo, snd[0].hi], [45, 80]);
});

test('buildSeries day: groups by Sydney calendar day, not UTC day', () => {
  const rows = [
    [syd.midnight('20261028') + 60, 10, 1, 1, 1, 1, 1, 1],      // just after local midnight (still the 27th in UTC)
    [syd.midnight('20261028') + 86000, 20, 1, 1, 1, 1, 1, 1],   // just before the next local midnight
    [syd.midnight('20261029') + 60, 40, 1, 1, 1, 1, 1, 1],
  ];
  const d = buildSeries(rows, 'temp', 'day', syd);
  assert.equal(d.length, 2);
  assert.equal(d[0].t, syd.midnight('20261028'));
  near(d[0].v, 15);
  assert.equal(d[1].v, 40);
});

test('buildSeries day on a 23 hour daylight-saving day still lands everything in one bucket', () => {
  const start = syd.midnight('20261004');
  const rows = [[start + 10, 10, 1, 1, 1, 1, 1, 1], [start + 23 * 3600 - 10, 20, 1, 1, 1, 1, 1, 1], [start + 23 * 3600 + 10, 30, 1, 1, 1, 1, 1, 1]];
  const d = buildSeries(rows, 'temp', 'day', syd);
  assert.equal(d.length, 2);
  assert.equal(d[0].n, 2);
});

test('gapIndices flags only gaps much longer than the usual spacing', () => {
  const p = (t) => ({ t, v: 1 });
  const pts = [p(0), p(300), p(600), p(900), p(900 + 7200), p(900 + 7500)];
  assert.deepEqual([...gapIndices(pts)], [4]);
  assert.deepEqual([...gapIndices([p(0), p(300)])], []);
});
