// Statchain companion app: wiring, routing, theme, service worker.

import { createApi } from './api.js';
import { openStore } from './store.js';
import { createPrefs } from './prefs.js';
import { createSync } from './sync.js';
import { createSession } from './session.js';
import { makeTz } from './tz.js';
import { h, icon, toast } from './ui.js';
import { mountHome } from './views/home.js';
import { mountToday } from './views/today.js';
import { mountTrends } from './views/trends.js';
import { mountSettings } from './views/settings.js';
import { mountExport } from './views/export.js';

const DEVICE_TZ = 'Australia/Sydney'; // the device logs by Sydney's calendar days

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', mount: mountHome },
  { id: 'today', label: 'Today', icon: 'today', mount: mountToday },
  { id: 'trends', label: 'Trends', icon: 'trends', mount: mountTrends },
  { id: 'settings', label: 'Settings', icon: 'settings', mount: mountSettings },
  { id: 'export', label: 'Export', icon: 'export', mount: mountExport },
];

async function main() {
  const prefs = createPrefs();
  const store = await openStore();
  // When the device itself serves this page (tools/build-app.mjs marks that build), the device is simply
  // the page's own origin: no address to configure, and no mixed-content or CORS to worry about.
  const hostedByDevice = !!document.querySelector('meta[name="statchain-host"]');
  const api = createApi({ getBase: () => (hostedByDevice ? location.origin : prefs.get('deviceUrl')) });
  const sync = createSync({ api, store });
  const session = createSession({ api, sync, prefs });
  const ctx = {
    api, store, sync, prefs, session, hostedByDevice,
    deviceTz: makeTz(DEVICE_TZ),
    tz: () => makeTz(prefs.get('tzMode') === 'phone' ? undefined : DEVICE_TZ),
  };
  window.statchain = ctx; // handy in the browser console, and for tests

  // ---- theme: follow the system unless the viewer picked one
  const applyTheme = () => {
    const t = prefs.get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
  applyTheme();

  // ---- chrome: connection pill and tab bar
  const pill = h('a', { class: 'pill', href: '#/settings' });
  const paintPill = (v) => {
    const syncing = v.sync.running;
    const [cls, ic, text] = syncing && v.conn === 'online' ? ['online', 'refresh', 'Syncing archive…']
      : v.conn === 'online' ? ['online', 'check', 'Connected']
        : v.conn === 'connecting' ? ['pending', 'refresh', 'Connecting…']
          : v.conn === 'blocked' ? ['bad', 'warn', 'Blocked by browser']
            : ['bad', 'offline', 'Offline'];
    pill.className = `pill ${cls}`;
    pill.replaceChildren(icon(ic, 14), h('span', null, text));
    pill.setAttribute('aria-label', `Device status: ${text}. Open settings.`);
  };
  document.querySelector('.topbar').append(pill);
  session.subscribe(paintPill);
  paintPill(session.view);

  const tabbar = document.getElementById('tabbar');
  tabbar.replaceChildren(...ROUTES.map((r) => h('a', { href: `#/${r.id}`, class: 'tab', 'data-route': r.id }, icon(r.icon, 22), h('span', null, r.label))));

  // ---- router
  const main = document.getElementById('view');
  let current = null;
  let first = true;
  function route() {
    const id = location.hash.replace(/^#\//, '') || 'home';
    const r = ROUTES.find((x) => x.id === id) ?? ROUTES[0];
    current?.unmount?.();
    current = r.mount(ctx, main);
    for (const a of tabbar.children) {
      if (a.dataset.route === r.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    document.title = `${r.label} · Statchain`;
    if (!first) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    first = false;
  }
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#/home');
  prefs.onChange((k) => { if (k === 'theme') applyTheme(); if (k === 'tzMode') route(); });
  route();
  session.start();

  // ---- offline support (needs https or localhost). Not when the device serves the app: that build ships no
  // service worker (a plain-http origin cannot run one), so registering would only produce a 404.
  if ('serviceWorker' in navigator && window.isSecureContext && !hostedByDevice) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => { /* the app works without it */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('App updated.', { action: () => location.reload(), label: 'Reload', ms: 12000 });
    });
  }
}

main().catch((e) => {
  document.getElementById('view').replaceChildren(h('div', { class: 'view' }, h('div', { class: 'banner error', role: 'alert' },
    icon('warn', 20), h('div', { class: 'banner-text' }, h('strong', null, 'The app could not start'), h('p', null, String(e?.message ?? e))))));
  console.error(e);
});
