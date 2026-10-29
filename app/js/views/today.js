// Today: a day's summary (low / average / high) and how it unfolded. Defaults to the device's
// current day; the arrows step back through the days archived on this phone.

import { h, icon, emptyState } from '../ui.js';
import { METRICS } from '../metrics.js';
import { buildSeries, summarize } from '../logs.js';
import { addDays } from '../tz.js';
import { fmtDateStr, fmtNum, fmtClock } from '../format.js';
import { chartCard } from './chart-card.js';

export function mountToday(ctx, root) {
  const { session, store, sync } = ctx;
  let selected = null;     // YYYYMMDD
  let dates = [];          // archived days (plus today)
  let todayStr = null;
  let loadToken = 0;
  let seenSyncAt = session.view.sync.at;
  let seenToday = session.view.today;
  let destroyed = false;

  const cards = METRICS.map((m) => chartCard(m));
  const el = {
    title: h('h2', { class: 'date-title' }),
    badge: h('span', { class: 'chip', hidden: true }, 'Today'),
    meta: h('p', { class: 'muted small' }),
    prev: h('button', { type: 'button', class: 'btn icon-btn ghost', 'aria-label': 'Previous day', onclick: () => step(-1) }, icon('chevL', 20)),
    next: h('button', { type: 'button', class: 'btn icon-btn ghost', 'aria-label': 'Next day', onclick: () => step(1) }, icon('chevR', 20)),
    summary: h('section', { class: 'summary', 'aria-label': 'Daily summary' }),
    charts: h('div', { class: 'chart-grid' }, cards.map((c) => c.el)),
    body: h('div'),
  };

  root.replaceChildren(h('div', { class: 'view today' },
    h('div', { class: 'date-nav' }, el.prev, h('div', { class: 'date-label' }, h('div', { class: 'row tight' }, el.title, el.badge), el.meta), el.next),
    el.body));

  function step(dir) {
    const i = dates.indexOf(selected) + dir;
    if (i >= 0 && i < dates.length) { selected = dates[i]; load(); }
  }

  function summaryFor(day, isToday) {
    const live = isToday && session.view.conn === 'online' ? session.view.today : null;
    if (live && live.date === day.date) {
      return { temp: live.temperature, hum: live.humidity, press: live.pressure, sound: live.sound, live: true };
    }
    const s = day.summary ?? summarize(day.rows);
    return { temp: s.temp, hum: s.hum, press: s.press, sound: s.sound, live: false };
  }

  function paintSummary(day, isToday) {
    const s = summaryFor(day, isToday);
    const src = { temp: s.temp, hum: s.hum, press: s.press, sound: s.sound };
    el.summary.replaceChildren(...METRICS.map((m) => {
      const v = src[m.id];
      const cell = (label, val) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-num' }, fmtNum(val, m.dec)));
      return h('article', { class: 'card summary-card' }, h('h3', { class: 'label' }, m.label, h('span', { class: 'unit' }, ` ${m.unit}`)),
        h('div', { class: 'stats3' }, cell('Low', v.min), cell('Average', v.avg), cell('High', v.max)));
    }));
  }

  async function load() {
    const token = ++loadToken;
    const sums = await store.listSummaries();
    todayStr = session.view.today?.date || (await store.getMeta('lastSync'))?.today || null;
    dates = [...new Set([...sums.map((s) => s.date), ...(todayStr ? [todayStr] : [])])].sort();
    if (!dates.length) {
      el.title.textContent = 'No days yet';
      el.badge.hidden = true;
      el.meta.textContent = '';
      el.prev.disabled = el.next.disabled = true;
      el.body.replaceChildren(emptyState('Nothing archived yet',
        'Connect to your Statchain once and the app copies its logs to this phone. The device only keeps a few weeks.',
        h('a', { class: 'btn', href: '#/settings' }, 'Device settings')));
      return;
    }
    if (!selected || !dates.includes(selected)) selected = todayStr && dates.includes(todayStr) ? todayStr : dates.at(-1);
    const isToday = selected === todayStr;

    // Today is still growing: pull the latest lines first (if the device is reachable).
    if (isToday && session.view.conn === 'online') { try { await sync.syncDay(selected, todayStr); } catch { /* show what the archive has */ } }
    if (token !== loadToken || destroyed) return;
    const day = await store.getDay(selected);
    if (token !== loadToken || destroyed) return;

    el.title.textContent = fmtDateStr(selected, true, selected.slice(0, 4) !== (todayStr ?? dates.at(-1)).slice(0, 4));
    el.badge.hidden = !isToday;
    const i = dates.indexOf(selected);
    el.prev.disabled = i <= 0;
    el.next.disabled = i >= dates.length - 1;

    if (!day || !day.rows.length) {
      el.meta.textContent = 'No readings were logged on this day.';
      el.body.replaceChildren(emptyState('No readings for this day', isToday ? 'The first log line is written a few minutes after the device gets the time.' : null));
      return;
    }
    const tz = ctx.tz(), dtz = ctx.deviceTz;
    const first = day.rows[0][0], last = day.rows.at(-1)[0];
    el.meta.textContent = `${day.rows.length} readings · ${fmtClock(first, tz.timeZone)}–${fmtClock(last, tz.timeZone)}${day.complete ? '' : ' · day in progress'}`;
    paintSummary(day, isToday);
    el.body.replaceChildren(el.summary, el.charts);

    const t0 = dtz.midnight(selected), t1 = dtz.midnight(addDays(selected, 1));
    METRICS.forEach((m, k) => {
      const series = buildSeries(day.rows, m, 'raw', tz);
      const lastPt = series.at(-1);
      const stats = lastPt ? `Last reading ${fmtNum(lastPt.v, m.dec)} ${m.unit} at ${fmtClock(lastPt.t, tz.timeZone)}` : 'No readings';
      cards[k].update({ series, domain: [t0, t1], tz, agg: 'raw', band: m.id === 'sound', stats });
    });
  }

  const off = session.subscribe((v) => {
    if (v.sync.at !== seenSyncAt) { seenSyncAt = v.sync.at; load(); return; }
    if (v.today !== seenToday) {
      seenToday = v.today;
      if (selected && selected === todayStr) store.getDay(selected).then((d) => d && !destroyed && paintSummary(d, true));
    }
  });
  load();
  return { unmount() { destroyed = true; off(); cards.forEach((c) => c.destroy()); } };
}
