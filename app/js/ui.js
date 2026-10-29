// Small DOM helpers. Everything that comes from data (labels, values, device text) goes in with
// textContent / text nodes, never innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  apply(el, props);
  append(el, children);
  return el;
}

export function svgEl(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, props);
  append(el, children);
  return el;
}

// ---------------------------------------------------------------------------
// Icons: 24x24, 1.75px stroke, currentColor. Paths are ours, so setting them is safe.
// ---------------------------------------------------------------------------
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  today: 'M4 6.5h16V20H4z M4 10.5h16 M8 3.5v4 M16 3.5v4 M8 14.5h3',
  trends: 'M3.5 4v16.5H21 M7 15l4-5 3 3 5-6.5',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4.5v5 M9 14.5v5',
  export: 'M12 3.5v11 M7.5 10.5 12 15l4.5-4.5 M4.5 20h15',
  warn: 'M12 3.5 22 20H2z M12 10v4.5 M12 17.2v.3',
  offline: 'M3 3l18 18 M8.5 8.8a7 7 0 0 0-3.2 2 M2.5 7.5a12 12 0 0 1 5-3 M12 19.5v.1 M16.2 12a7 7 0 0 0-2.2-1.2 M20 8.5a12 12 0 0 0-5.5-3.8',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9 M20 4v5h-5',
  chevL: 'M14.5 5.5 8 12l6.5 6.5',
  chevR: 'M9.5 5.5 16 12l-6.5 6.5',
  table: 'M4 5h16v14H4z M4 10h16 M4 14.5h16 M10 5v14',
  chart: 'M3.5 4v16.5H21 M7 15l4-5 3 3 5-6.5',
  battery: 'M3.5 8h15v8h-15z M20.5 10.5v3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.8v.1',
};

export function icon(name, size = 20) {
  return svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' },
  svgEl('path', { d: PATHS[name] }));
}

// ---------------------------------------------------------------------------
// Toast: a short status message, announced to screen readers.
// ---------------------------------------------------------------------------
let toastTimer;
export function toast(message, { action, label, ms = 4000 } = {}) {
  const host = document.getElementById('toast');
  if (!host) return;
  clearTimeout(toastTimer);
  host.replaceChildren(h('span', null, message),
    action ? h('button', { type: 'button', class: 'link', onclick: () => { host.classList.remove('show'); action(); } }, label ?? 'Undo') : null);
  host.classList.add('show');
  toastTimer = setTimeout(() => host.classList.remove('show'), ms);
}

// Replaces the children of `el` with a fresh <div class="empty"> message.
export const emptyState = (title, body, ...actions) =>
  h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), body ? h('p', { class: 'muted' }, body) : null, actions.length ? h('div', { class: 'row' }, actions) : null);

// Saves text/Blob as a file via a temporary link.
export function download(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
