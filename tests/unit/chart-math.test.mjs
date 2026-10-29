import test from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, niceTicks, yDomain, tickDecimals, nearestIndex, segments, timeTicks } from '../../app/js/chart-math.js';
import { makeTz } from '../../app/js/tz.js';

const syd = makeTz('Australia/Sydney');
const utc = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

test('niceStep picks 1-2-5 steps', () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(100, 4), 20);
  assert.equal(niceStep(0.9, 4), 0.2);
  assert.equal(niceStep(1013 - 1005, 4), 2);
});

test('niceTicks covers the data with round numbers', () => {
  const t = niceTicks(14.7, 24.3, 4);
  assert.deepEqual(t.ticks, [14, 16, 18, 20, 22, 24, 26]);
  assert.ok(t.min <= 14.7 && t.max >= 24.3);
  const flat = niceTicks(20, 20, 4);
  assert.ok(flat.ticks.length >= 2 && flat.min < 20 && flat.max > 20, 'a flat series still gets a usable axis');
  const p = niceTicks(1004.7, 1007.9, 4);
  assert.ok(p.ticks.every((v) => Number.isInteger(v * 2)), p.ticks.join());
});

test('yDomain enforces a minimum span so noise is not exaggerated', () => {
  const [lo, hi] = yDomain([20.0, 20.1, 20.05], 2);
  assert.ok(hi - lo >= 2);
  assert.ok(lo < 20 && hi > 20.1);
  const [a, b] = yDomain([10, 30], 2, 0.1);
  assert.deepEqual([a, b], [8, 32]);
  assert.deepEqual(yDomain([], 5), [0, 5]);
});

test('tickDecimals follows the step', () => {
  assert.equal(tickDecimals(5), 0);
  assert.equal(tickDecimals(2), 0);
  assert.equal(tickDecimals(0.5), 1);
  assert.equal(tickDecimals(0.2), 1);
  assert.equal(tickDecimals(0.25), 2);
  assert.equal(tickDecimals(0.05), 2);
});

test('nearestIndex finds the closest x, at the ends and between points', () => {
  const xs = [0, 10, 20, 40];
  assert.equal(nearestIndex(xs, -5), 0);
  assert.equal(nearestIndex(xs, 4), 0);
  assert.equal(nearestIndex(xs, 6), 1);
  assert.equal(nearestIndex(xs, 29), 2);
  assert.equal(nearestIndex(xs, 31), 3);
  assert.equal(nearestIndex(xs, 99), 3);
  assert.equal(nearestIndex([], 1), -1);
  assert.equal(nearestIndex([5], 100), 0);
});

test('segments splits at gaps and handles degenerate input', () => {
  assert.deepEqual(segments(6, new Set([2, 5])), [[0, 1], [2, 4], [5, 5]]);
  assert.deepEqual(segments(3, new Set()), [[0, 2]]);
  assert.deepEqual(segments(0, new Set()), []);
  assert.deepEqual(segments(1, new Set()), [[0, 0]]);
});

test('24 h axis in Sydney: ticks sit on local hours, 3-hourly, midnight is major', () => {
  const t0 = syd.midnight('20261028'), t1 = t0 + 24 * 3600;
  const ticks = timeTicks(t0, t1, syd, 8);
  assert.deepEqual(ticks.map((t) => t.label), ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '00:00']);
  assert.ok(ticks[0].major && !ticks[1].major);
  assert.equal(ticks[0].t, t0);
});

test('an axis that starts mid-hour begins at the next whole local hour', () => {
  const t0 = syd.midnight('20261028') + 4 * 3600 + 1200; // 04:20
  const ticks = timeTicks(t0, t0 + 6 * 3600, syd, 8);
  assert.equal(ticks[0].label, '05:00');
  assert.ok(ticks.every((t) => t.t >= t0));
});

test('the 23 hour daylight-saving day still has ticks at correct local times', () => {
  const t0 = syd.midnight('20261004'), t1 = syd.midnight('20261005');
  const ticks = timeTicks(t0, t1, syd, 8);
  const labels = ticks.map((t) => t.label);
  assert.equal(labels[0], '00:00');
  for (const t of ticks) assert.equal(Math.round(syd.hourFrac(t.t)) % 3, 0, t.label);
  assert.equal(ticks.at(-1).t, t1);
});

test('7 day axis ticks at local midnights with weekday labels', () => {
  const t0 = syd.midnight('20261022'), t1 = syd.midnight('20261029');
  const ticks = timeTicks(t0, t1, syd, 8);
  assert.equal(ticks.length, 8);
  assert.ok(ticks.every((t) => t.major && syd.hourFrac(t.t) === 0));
  assert.match(ticks[0].label, /Thu 22/);
});

test('30 day axis uses date labels and fewer ticks; a year uses month ticks', () => {
  const t0 = syd.midnight('20260929'), t1 = syd.midnight('20261029');
  const t = timeTicks(t0, t1, syd, 5);
  assert.ok(t.length <= 6 && t.length >= 3, String(t.length));
  assert.match(t[0].label, /\d+ \w{3}/);
  const y0 = syd.midnight('20260101'), y1 = syd.midnight('20270101');
  const m = timeTicks(y0, y1, syd, 6);
  assert.ok(m.length >= 4 && m.length <= 7, String(m.length));
  assert.ok(m.every((x) => syd.dateStr(x.t).endsWith('01')), 'month ticks fall on the 1st');
});
