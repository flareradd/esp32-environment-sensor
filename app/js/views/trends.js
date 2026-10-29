// Trends: each measurement across the archived days. One filter row above the charts scopes
// all of them (24 h / 7 days / 30 days / everything). Longer spans are aggregated (hourly, then
// daily means with a min-max band) so a year of readings stays readable.

import { h, emptyState } from '../ui.js';
import { METRICS } from '../metrics.js';
import { buildSeries, chooseResolution, energyMean } from '../logs.js';
import { fmtNum, fmtDayShort, fmtDateTime } from '../format.js';
import { chartCard } from './chart-card.js';

const RANGES = [
  { id: '24h', label: '24 hours', seconds: 86400 },
  { id: '7d', label: '7 days', seconds: 7 * 86400 },
  { id: '30d', label: '30 days', seconds: 30 * 86400 },
  { id: 'all', label: 'All', seconds: null },
];
const RES_WORD = { raw: 'every logged reading', hour: 'hourly averages', day: 'daily averages' };

export function mountTrends(ctx, root) {
  const { store, prefs, session } = ctx;
  let range = prefs.get('trendRange') ?? '7d';
  if (!RANGES.some((r) => r.id === range)) range = '7d';
  let token = 0;
  let destroyed = false;
  let seenSyncAt = session.view.sync.at;

  const cards = METRICS.map((m) => chartCard(m));
  const el = {
    seg: h('div', { class: 'segmented', role: 'group', 'aria-label': 'Time range' }),
    note: h('p', { class: 'muted small', 'aria-live': 'polite' }),
    charts: h('div', { class: 'chart-grid' }, cards.map((c) => c.el)),
    body: h('div'),
  };
  const buttons = RANGES.map((r) => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(r.id === range),
    onclick: () => { range = r.id; prefs.set('trendRange', range); buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(RANGES[i].id === range))); load(); } }, r.label));
  el.seg.append(...buttons);
  root.replaceChildren(h('div', { class: 'view trends' }, h('div', { class: 'filter-row' }, el.seg), el.note, el.body));

  async function load() {
    const mine = ++token;
    const sums = await store.listSummaries();
    if (mine !== token || destroyed) return;
    if (!sums.length) {
      el.note.textContent = '';
      el.body.replaceChildren(emptyState('No archived data yet',
        'Trends are drawn from the days copied to this phone. Connect to your Statchain and they will appear here.',
        h('a', { class: 'btn', href: '#/settings' }, 'Device settings')));
      return;
    }
    el.body.replaceChildren(el.charts);
    if (lastData) cards.forEach((c, i) => c.update({ ...lastData[i], loading: true })); // keep the frame, dim it

    const tz = ctx.tz(), dtz = ctx.deviceTz;
    const r = RANGES.find((x) => x.id === range);
    const tEnd = sums.at(-1).summary.lastT;
    const tStart = r.seconds ? tEnd - r.seconds : sums[0].summary.firstT;
    const dates = sums.filter((s) => s.date >= dtz.dateStr(tStart) && s.date <= dtz.dateStr(tEnd)).map((s) => s.date);
    const days = await store.getDays(dates);
    if (mine !== token || destroyed) return;
    const rows = days.flatMap((d) => d.rows).filter((row) => row[0] >= tStart && row[0] <= tEnd);
    const res = chooseResolution(tEnd - tStart);

    lastData = METRICS.map((m) => {
      const series = buildSeries(rows, m, res, tz);
      let stats = 'No readings in this range';
      if (series.length) {
        const vals = rows.map((row) => row[m.col]).filter((v) => v != null);
        const lo = m.minCol ? Math.min(...rows.map((row) => row[m.minCol]).filter((v) => v != null)) : Math.min(...vals);
        const hi = m.maxCol ? Math.max(...rows.map((row) => row[m.maxCol]).filter((v) => v != null)) : Math.max(...vals);
        const avg = m.energy ? energyMean(vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
        stats = `Average ${fmtNum(avg, m.dec)} · low ${fmtNum(lo, m.dec)} · high ${fmtNum(hi, m.dec)} ${m.unit}`;
      }
      return { series, domain: [tStart, tEnd], tz, agg: res, band: m.id === 'sound' || res !== 'raw', stats, loading: false };
    });
    cards.forEach((c, i) => c.update(lastData[i]));
    el.note.textContent = `${fmtDayShort(tStart, tz.timeZone)} to ${fmtDateTime(tEnd, tz.timeZone)} · ${RES_WORD[res]} · ${dates.length} ${dates.length === 1 ? 'day' : 'days'} archived`;
  }
  let lastData = null;

  const off = session.subscribe((v) => { if (v.sync.at !== seenSyncAt) { seenSyncAt = v.sync.at; load(); } });
  load();
  return { unmount() { destroyed = true; off(); cards.forEach((c) => c.destroy()); } };
}
