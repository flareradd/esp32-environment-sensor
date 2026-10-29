// A card holding one measurement's chart, with a toggle to the same data as a table.

import { h, icon } from '../ui.js';
import { lineChart, dataTable } from '../charts.js';

// update({ series, domain, tz, agg, band, stats, loading }) can be called as often as needed.
export function chartCard(metric) {
  let mode = 'chart';
  let data = null;
  let chart = null;
  const idBase = `cc-${metric.id}`;

  const stats = h('p', { class: 'muted small', id: `${idBase}-stats` });
  const host = h('div', { class: 'chart-host' });
  const toggle = h('button', { type: 'button', class: 'btn small ghost', 'aria-pressed': 'false', onclick: () => {
    mode = mode === 'chart' ? 'table' : 'chart';
    paint(true);
  } });
  const el = h('section', { class: 'card chart-card', 'aria-labelledby': `${idBase}-title` },
    h('div', { class: 'card-head' }, h('h3', { id: `${idBase}-title` }, metric.label), toggle),
    stats, host);

  function paintToggle() {
    toggle.replaceChildren(icon(mode === 'chart' ? 'table' : 'chart', 16), h('span', null, mode === 'chart' ? 'Table' : 'Chart'));
    toggle.setAttribute('aria-pressed', String(mode === 'table'));
    toggle.setAttribute('aria-label', mode === 'chart' ? `Show ${metric.label} as a table` : `Show ${metric.label} as a chart`);
  }

  function paint(modeChanged) {
    paintToggle();
    if (!data?.series) return;
    stats.textContent = data.stats ?? '';
    el.classList.toggle('loading', !!data.loading);
    const opts = { series: data.series, domain: data.domain, tz: data.tz, metric, band: data.band, agg: data.agg, height: 200 };
    if (mode === 'table') {
      chart?.destroy();
      chart = null;
      host.replaceChildren(dataTable(opts));
    } else if (!chart || modeChanged) {
      chart?.destroy();
      chart = lineChart(host, opts);
    } else {
      chart.update(opts);
    }
  }

  paintToggle();
  return {
    el,
    update(next) { data = next; paint(false); },
    destroy() { chart?.destroy(); },
  };
}
