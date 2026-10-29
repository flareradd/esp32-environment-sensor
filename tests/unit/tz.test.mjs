import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTz, addDays, daysBetween, isDateStr } from '../../app/js/tz.js';

const utc = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const syd = makeTz('Australia/Sydney');

test('addDays / daysBetween cross month and year ends and leap days', () => {
  assert.equal(addDays('20261031', 1), '20261101');
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(addDays('20240228', 1), '20240229');
  assert.equal(addDays('20240301', -1), '20240229');
  assert.equal(daysBetween('20261028', '20261101'), 4);
  assert.equal(daysBetween('20261101', '20261028'), -4);
});

test('isDateStr', () => {
  assert.ok(isDateStr('20261028'));
  for (const bad of ['2026102', '202610288', 'abcdefgh', '', null, undefined, 20261028]) assert.ok(!isDateStr(bad), String(bad));
});

test('Sydney local date flips at local midnight, in standard and daylight time', () => {
  assert.equal(syd.dateStr(utc(2026, 7, 14, 13, 59, 59)), '20260714'); // AEST +10: 23:59:59
  assert.equal(syd.dateStr(utc(2026, 7, 14, 14, 0, 0)), '20260715');
  assert.equal(syd.dateStr(utc(2026, 12, 14, 12, 59, 59)), '20261214'); // AEDT +11: 23:59:59
  assert.equal(syd.dateStr(utc(2026, 12, 14, 13, 0, 0)), '20261215');
});

test('midnight() is exact, including the 23 h and 25 h days either side of daylight saving', () => {
  assert.equal(syd.midnight('20261003'), utc(2026, 10, 2, 14));
  assert.equal(syd.midnight('20261004'), utc(2026, 10, 3, 14));
  assert.equal(syd.midnight('20261005'), utc(2026, 10, 4, 13)); // clocks went forward on the 4th
  assert.equal(syd.midnight('20261005') - syd.midnight('20261004'), 23 * 3600);
  assert.equal(syd.midnight('20270405') - syd.midnight('20270404'), 25 * 3600); // and back on 4 April 2027
  for (const d of ['20261004', '20261005', '20270404', '20270405', '20260101']) assert.equal(syd.dateStr(syd.midnight(d)), d);
  assert.equal(syd.dateStr(syd.midnight('20261005') - 1), '20261004');
});

test('startOfHour aligns to local hours, including half-hour zones', () => {
  const t = utc(2026, 10, 28, 3, 20, 0);          // 14:20 AEDT
  assert.equal(syd.startOfHour(t), utc(2026, 10, 28, 3));
  const ist = makeTz('Asia/Kolkata');               // +05:30
  assert.equal(ist.startOfHour(utc(2026, 10, 28, 10, 20)), utc(2026, 10, 28, 9, 30));
});

test('hourFrac gives local hours', () => {
  assert.ok(Math.abs(syd.hourFrac(utc(2026, 10, 28, 3, 30)) - 14.5) < 1e-9);
  assert.ok(Math.abs(syd.hourFrac(utc(2026, 10, 27, 13, 0)) - 0) < 1e-9);
});
