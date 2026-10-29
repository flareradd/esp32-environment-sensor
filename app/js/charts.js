// SVG line charts, hand-drawn so the app has no dependencies and works offline.
//
// One measurement per chart (never two scales on one plot). A single series, so no legend box:
// the card title says what is plotted. Marks follow the dataviz spec: 2px line, a ~10% wash for the
// area / min-max band, hairline solid gridlines, an end marker with a 2px surface ring, a crosshair
// that snaps to the nearest reading with one tooltip, and the same readout on keyboard focus.
// Every chart has a table twin (dataTable) so nothing depends on hovering.

import { gapIndices } from './logs.js';
import { niceTicks, yDomain, tickDecimals, nearestIndex, segments, timeTicks } from './chart-math.js';
import { fmtNum, fmtClock, fmtDayShort, fmtDateTime } from './format.js';
import { h, svgEl } from './ui.js';

const MARGIN = { top: 12, right: 14, bottom: 26 };

function whenLabel(p, agg, zone) {
  if (agg === 'day') return `${fmtDayShort(p.t, zone)} · daily mean`;
  if (agg === 'hour') return `${fmtDayShort(p.t, zone)}, ${fmtClock(p.t, zone)}–${fmtClock(p.t + 3600, zone)} · hourly mean`;
  return fmtDateTime(p.t, zone);
}

function rangeText(p, m) {
  if (p.lo == null || p.hi == null) return '';
  return `min ${fmtNum(p.lo, m.dec)} · max ${fmtNum(p.hi, m.dec)} ${m.unit}`;
}

// options: { series:[{t,v,lo,hi,n}], domain:[t0,t1], tz, metric, band, agg, height }
export function lineChart(host, options) {
  let opts = options;
  let active = -1;
  let hideTimer;
  let width = 0;
  let geom = null; // plot geometry from the last draw, used by the pointer handlers

  const svg = svgEl('svg', { class: 'chart-svg', 'aria-hidden': 'true', focusable: 'false' });
  const tipTime = h('div', { class: 'tip-time' });
  const tipVal = h('strong');
  const tipRow = h('div', { class: 'tip-row' }, h('span', { class: 'tip-key' }), tipVal);
  const tipSub = h('div', { class: 'tip-sub' });
  const tip = h('div', { class: 'chart-tip', hidden: true }, tipTime, tipRow, tipSub);
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const root = h('div', { class: 'chart', tabindex: '0', role: 'group' }, svg, tip, live);
  host.replaceChildren(root);

  function describe() {
    const { series, metric, tz } = opts;
    if (!series.length) return `${metric.label}: no data in this range.`;
    const a = series[0], z = series.at(-1), zone = tz.timeZone;
    return `${metric.label}: ${series.length} points from ${fmtDateTime(a.t, zone)} to ${fmtDateTime(z.t, zone)}, ` +
      `latest ${fmtNum(z.v, metric.dec)} ${metric.unit}. Use the left and right arrow keys to read values.`;
  }

  function draw() {
    const { series, domain, tz, metric, band, agg } = opts;
    const H = opts.height ?? 200;
    width = Math.max(240, root.clientWidth || host.clientWidth || 320);
    root.setAttribute('aria-label', describe());
    root.style.setProperty('--chart-h', `${H}px`);
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', H);

    if (!series.length) {
      svg.append(svgEl('text', { class: 'chart-empty', x: width / 2, y: H / 2, 'text-anchor': 'middle' }, 'No data in this range'));
      geom = null;
      return;
    }

    // --- scales
    const useBand = band && series.some((p) => p.lo != null && p.hi != null);
    const values = [];
    for (const p of series) { values.push(p.v); if (useBand && p.lo != null) { values.push(p.lo, p.hi); } }
    const [dLo, dHi] = yDomain(values, metric.minSpan);
    const nt = niceTicks(dLo, dHi, H > 150 ? 4 : 3);
    const dec = tickDecimals(nt.step);
    const labelW = Math.max(...nt.ticks.map((v) => fmtNum(v, dec).length)) * 6.6 + 10;
    const L = Math.round(labelW + 6), R = MARGIN.right, T = MARGIN.top, B = H - MARGIN.bottom;
    const plotW = width - L - R, plotH = B - T;
    const [t0, t1] = domain;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * plotW;
    const y = (v) => T + (1 - (v - nt.min) / (nt.max - nt.min)) * plotH;
    geom = { L, R, T, B, plotW, plotH, t0, t1, x, y, H };

    // --- grid + axes
    for (const v of nt.ticks) {
      svg.append(svgEl('line', { class: 'grid', x1: L, x2: width - R, y1: y(v), y2: y(v) }));
      svg.append(svgEl('text', { class: 'tick', x: L - 7, y: y(v) + 4, 'text-anchor': 'end' }, fmtNum(v, dec)));
    }
    const xt = timeTicks(t0, t1, tz, Math.max(2, Math.floor(plotW / 62)));
    for (const tk of xt) {
      const px = x(tk.t);
      if (tk.major && px > L + 2 && px < width - R - 2) svg.append(svgEl('line', { class: 'grid vgrid', x1: px, x2: px, y1: T, y2: B }));
      const half = tk.label.length * 3.4;
      const anchor = px - half < 0 ? 'start' : px + half > width ? 'end' : 'middle';
      svg.append(svgEl('text', { class: 'tick', x: px, y: H - 7, 'text-anchor': anchor }, tk.label));
    }
    svg.append(svgEl('line', { class: 'axis', x1: L, x2: width - R, y1: B, y2: B }));

    // --- marks
    const segs = segments(series.length, gapIndices(series));
    const bandD = [], areaD = [], lineD = [];
    const dots = [];
    for (const [a, b] of segs) {
      if (a === b) { dots.push(series[a]); continue; }
      const pts = series.slice(a, b + 1);
      lineD.push(pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(''));
      if (useBand) {
        const up = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.hi ?? p.v).toFixed(1)}`);
        const dn = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.lo ?? p.v).toFixed(1)}`).reverse();
        bandD.push(`M${up.join('L')}L${dn.join('L')}Z`);
      } else {
        areaD.push(`${lineD.at(-1)}L${x(pts.at(-1).t).toFixed(1)},${B}L${x(pts[0].t).toFixed(1)},${B}Z`);
      }
    }
    if (bandD.length) svg.append(svgEl('path', { class: 'band', d: bandD.join('') }));
    if (areaD.length) svg.append(svgEl('path', { class: 'area', d: areaD.join('') }));
    if (lineD.length) svg.append(svgEl('path', { class: 'line', d: lineD.join('') }));
    for (const p of dots) svg.append(svgEl('circle', { class: 'dot', cx: x(p.t), cy: y(p.v), r: 2.5 }));

    // --- end marker with a surface ring, and the latest value as the one direct label
    const last = series.at(-1);
    svg.append(svgEl('circle', { class: 'ring', cx: x(last.t), cy: y(last.v), r: 6 }));
    svg.append(svgEl('circle', { class: 'end', cx: x(last.t), cy: y(last.v), r: 4 }));
    const above = y(last.v) - 11 > T + 6;
    const lx = Math.min(width - R, Math.max(L + 40, x(last.t)));
    svg.append(svgEl('text', { class: 'endlabel', x: lx, y: above ? y(last.v) - 11 : y(last.v) + 19, 'text-anchor': 'end' },
      `${fmtNum(last.v, metric.dec)} ${metric.unit}`));

    // --- hover layer
    svg.append(svgEl('line', { class: 'crosshair', x1: 0, x2: 0, y1: T, y2: B, visibility: 'hidden' }));
    svg.append(svgEl('circle', { class: 'ring hover-ring', r: 6, visibility: 'hidden' }));
    svg.append(svgEl('circle', { class: 'end hover-dot', r: 4, visibility: 'hidden' }));
    if (active >= series.length) active = -1;
    if (active >= 0) show(active, false);
  }

  function show(i, announce) {
    const { series, metric, tz, agg } = opts;
    if (!geom || i < 0 || i >= series.length) return;
    active = i;
    const p = series[i];
    const px = geom.x(p.t), py = geom.y(p.v);
    svg.querySelector('.crosshair').setAttribute('x1', px);
    svg.querySelector('.crosshair').setAttribute('x2', px);
    for (const sel of ['.crosshair', '.hover-ring', '.hover-dot']) svg.querySelector(sel).setAttribute('visibility', 'visible');
    for (const sel of ['.hover-ring', '.hover-dot']) { const c = svg.querySelector(sel); c.setAttribute('cx', px); c.setAttribute('cy', py); }

    tipTime.textContent = whenLabel(p, agg, tz.timeZone);
    tipVal.textContent = `${fmtNum(p.v, metric.dec)} ${metric.unit}`;
    tipSub.textContent = opts.band ? rangeText(p, metric) : '';
    tip.hidden = false;
    const w = tip.offsetWidth;
    const left = px + 14 + w > width - 4 ? px - w - 14 : px + 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${geom.T}px`;
    if (announce) live.textContent = `${tipTime.textContent}: ${tipVal.textContent}. ${tipSub.textContent}`;
  }

  function hide() {
    active = -1;
    tip.hidden = true;
    for (const sel of ['.crosshair', '.hover-ring', '.hover-dot']) svg.querySelector(sel)?.setAttribute('visibility', 'hidden');
  }

  // --- pointer: mouse hover, or touch scrub (vertical scrolling still works: touch-action: pan-y)
  function atPointer(ev) {
    if (!geom || !opts.series.length) return;
    const r = svg.getBoundingClientRect();
    const px = Math.min(geom.L + geom.plotW, Math.max(geom.L, ev.clientX - r.left));
    const t = geom.t0 + ((px - geom.L) / geom.plotW) * (geom.t1 - geom.t0);
    show(nearestIndex(opts.series.map((p) => p.t), t), false);
  }
  root.addEventListener('pointermove', (ev) => { clearTimeout(hideTimer); atPointer(ev); });
  root.addEventListener('pointerdown', (ev) => { clearTimeout(hideTimer); atPointer(ev); });
  root.addEventListener('pointerleave', () => { if (document.activeElement !== root) hide(); });
  root.addEventListener('pointerup', (ev) => { if (ev.pointerType === 'touch') hideTimer = setTimeout(hide, 2500); });
  root.addEventListener('pointercancel', hide);

  // --- keyboard
  root.addEventListener('focus', () => { if (opts.series.length && active < 0) show(opts.series.length - 1, true); });
  root.addEventListener('blur', hide);
  root.addEventListener('keydown', (ev) => {
    const n = opts.series.length;
    if (!n) return;
    const step = ev.shiftKey ? 10 : 1;
    let i = active < 0 ? n - 1 : active;
    if (ev.key === 'ArrowLeft') i -= step;
    else if (ev.key === 'ArrowRight') i += step;
    else if (ev.key === 'Home') i = 0;
    else if (ev.key === 'End') i = n - 1;
    else if (ev.key === 'Escape') { hide(); return; }
    else return;
    ev.preventDefault();
    show(Math.min(n - 1, Math.max(0, i)), true);
  });

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { const w = root.clientWidth; if (w && Math.abs(w - width) > 1) draw(); })
    : null;
  ro?.observe(root);
  draw();

  return {
    update(next) { opts = next; draw(); },
    destroy() { ro?.disconnect(); clearTimeout(hideTimer); },
  };
}

// The table twin of a chart: the same points, readable without hovering or seeing colour.
export function dataTable({ series, metric, tz, agg, band }) {
  const zone = tz.timeZone;
  const showRange = band && series.some((p) => p.lo != null);
  const head = h('tr', null, h('th', { scope: 'col' }, agg === 'day' ? 'Day' : 'Time'),
    h('th', { scope: 'col', class: 'num' }, `${metric.label} (${metric.unit})`),
    showRange ? h('th', { scope: 'col', class: 'num' }, 'Min') : null,
    showRange ? h('th', { scope: 'col', class: 'num' }, 'Max') : null);
  const rows = [...series].reverse().map((p) => h('tr', null,
    h('th', { scope: 'row' }, agg === 'day' ? fmtDayShort(p.t, zone) : fmtDateTime(p.t, zone)),
    h('td', { class: 'num' }, fmtNum(p.v, metric.dec)),
    showRange ? h('td', { class: 'num' }, fmtNum(p.lo, metric.dec)) : null,
    showRange ? h('td', { class: 'num' }, fmtNum(p.hi, metric.dec)) : null));
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': `${metric.label} data table` },
    h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 4 }, 'No data in this range')))));
}

// A small trend line for a stat tile: no axes, just the shape and where it ends.
export function sparkline(values, { width = 160, height = 36, label = 'Recent trend' } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  const svg = svgEl('svg', { class: 'spark', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': label });
  if (v.length < 2) return svg;
  const lo = Math.min(...v), hi = Math.max(...v), span = Math.max(hi - lo, 6);
  const mid = (hi + lo) / 2;
  const x = (i) => 4 + (i / (v.length - 1)) * (width - 12);
  const y = (val) => height - 5 - ((val - (mid - span / 2)) / span) * (height - 10);
  svg.append(svgEl('path', { class: 'line', d: v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join('') }));
  svg.append(svgEl('circle', { class: 'ring', cx: x(v.length - 1), cy: y(v.at(-1)), r: 5.5 }));
  svg.append(svgEl('circle', { class: 'end', cx: x(v.length - 1), cy: y(v.at(-1)), r: 3.5 }));
  return svg;
}
