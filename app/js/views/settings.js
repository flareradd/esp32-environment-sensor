// Settings: how to reach the device, the device's own settings, the phone archive, and how this app looks.

import { h, icon, toast } from '../ui.js';
import { normalizeBase, DEFAULT_DEVICE_URL } from '../api.js';
import { findGaps } from '../logs.js';
import { fmtDateStr, fmtAgo, fmtBytes } from '../format.js';
import { APP_VERSION } from '../version.js';

// Mirrors the limits the firmware enforces (firmware/statchain/settings.cpp).
const FIELDS = [
  { key: 'soundIntervalS', label: 'Sound reading every', unit: 's', min: 2, max: 300, step: 1, help: 'How often the microphone takes a 1 second reading.' },
  { key: 'displayIntervalMin', label: 'E-ink refresh every', unit: 'min', min: 5, max: 1440, step: 1, help: 'The screen takes about 15 seconds to redraw; hourly is gentle on it.' },
  { key: 'logIntervalMin', label: 'Log a line every', unit: 'min', min: 1, max: 60, step: 1, help: 'How often a reading is saved to the device’s flash.' },
  { key: 'keepDays', label: 'Keep logs on the device', unit: 'days', min: 1, max: 90, step: 1, help: 'Your phone keeps its own copy beyond this.' },
  { key: 'loudDb', label: 'Loud above', unit: 'dB', min: 40, max: 120, step: 1, help: 'Sound at or above this shows in red on the screen and here.' },
  { key: 'battLowPct', label: 'Low battery at', unit: '%', min: 5, max: 50, step: 1, help: 'At or below this the battery shows in red.' },
  { key: 'tempOffsetC', label: 'Temperature offset', unit: '°C', min: -10, max: 10, step: 0.1, help: 'Subtract the device’s own warmth, e.g. -1.5.' },
  { key: 'soundCalDb', label: 'Sound calibration', unit: 'dB', min: -30, max: 30, step: 0.1, help: 'Trim the estimate against a reference sound meter.' },
  { key: 'aWeighting', label: 'A-weighting', type: 'checkbox', help: 'Weight sound like human hearing (dBA). Turn off for a flat reading.' },
];

function section(title, ...kids) { return h('section', { class: 'card settings-section' }, h('h2', null, title), ...kids); }

function describeError(e, base) {
  if (e.kind === 'mixed-content') return 'Your browser blocked this secure (https) page from reaching an http device. Open the app from an http address on your network, or allow insecure content for this site.';
  if (e.kind === 'timeout') return `${base} did not answer in time. It may be busy redrawing its screen; try again.`;
  if (e.kind === 'network') return `Could not reach ${base}. Check the address and that this phone is on the same Wi-Fi as the device. Some Android phones cannot find “.local” names; use the device’s IP address instead.`;
  return e.message;
}

export function mountSettings(ctx, root) {
  const { api, session, store, prefs } = ctx;
  let destroyed = false;
  const unsubs = [];

  // ---- how to reach the device
  // Served by the device: its address is this page's own origin, so there is nothing to configure.
  // Served from elsewhere (development, or a computer on the network): the address is a setting.
  const addr = h('input', { type: 'text', id: 'addr', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    value: prefs.get('deviceUrl'), placeholder: 'statchain.local or 192.168.1.50' });
  const testMsg = h('p', { class: 'muted', role: 'status' });
  async function testConnection(base) {
    testMsg.className = 'muted'; testMsg.textContent = 'Connecting…';
    try {
      const s = await api.state();
      testMsg.className = 'msg ok';
      testMsg.replaceChildren(icon('check', 16), ` Connected to ${base}: firmware ${s.fw}${s.rssi ? `, Wi-Fi ${s.rssi} dBm` : ''}${s.timeValid ? '' : ', clock not set'}.`);
      loadDeviceSettings();
    } catch (e) {
      testMsg.className = 'msg error';
      testMsg.replaceChildren(icon('warn', 16), ` ${describeError(e, base)}`);
    }
  }
  async function saveAndTest() {
    const base = normalizeBase(addr.value);
    if (!base) { testMsg.className = 'msg error'; testMsg.textContent = 'Enter an address such as statchain.local or 192.168.1.50.'; return; }
    addr.value = base;
    prefs.set('deviceUrl', base);
    await testConnection(base);
  }
  const connection = ctx.hostedByDevice
    ? section('Device',
      h('p', null, 'This app is served by your Statchain itself, at ', h('strong', null, location.host), '. There is nothing to set up.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => testConnection(location.origin) }, 'Check connection')),
      testMsg)
    : section('Device',
      h('label', { class: 'field stack', for: 'addr' }, h('span', null, 'Address'), addr,
        h('span', { class: 'help' }, `Default ${DEFAULT_DEVICE_URL}. The IP address is shown in the device’s serial log.`)),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: saveAndTest }, 'Save and test'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { addr.value = DEFAULT_DEVICE_URL; saveAndTest(); } }, 'Reset')),
      testMsg);

  // ---- device settings
  const form = h('form', { class: 'settings-form', novalidate: true });
  const formMsg = h('p', { class: 'muted', role: 'status' });
  const saveBtn = h('button', { type: 'submit', class: 'btn', disabled: true }, 'Save to device');
  let loaded = null;
  const inputs = {};
  for (const f of FIELDS) {
    const input = h('input', f.type === 'checkbox'
      ? { type: 'checkbox', id: `f-${f.key}`, name: f.key }
      : { type: 'number', id: `f-${f.key}`, name: f.key, min: f.min, max: f.max, step: f.step, inputmode: 'decimal' });
    inputs[f.key] = input;
    input.addEventListener('input', markDirty);
    form.append(h('div', { class: `field ${f.type === 'checkbox' ? 'check' : ''}` },
      h('label', { for: `f-${f.key}` }, h('span', null, f.label), f.unit ? h('span', { class: 'muted' }, ` (${f.unit})`) : null),
      input, h('span', { class: 'help', id: `h-${f.key}` }, f.help)));
    input.setAttribute('aria-describedby', `h-${f.key}`);
  }
  form.append(h('div', { class: 'row' }, saveBtn), formMsg);

  function currentValues() {
    const v = {};
    for (const f of FIELDS) v[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value;
    return v;
  }
  function markDirty() {
    if (!loaded) return;
    const now = currentValues();
    saveBtn.disabled = FIELDS.every((f) => (f.type === 'checkbox' ? now[f.key] === loaded[f.key] : Number(now[f.key]) === Number(loaded[f.key])));
  }
  function fill(values) {
    loaded = values;
    for (const f of FIELDS) {
      if (f.type === 'checkbox') inputs[f.key].checked = !!values[f.key]; else inputs[f.key].value = values[f.key];
      inputs[f.key].disabled = false;
      inputs[f.key].removeAttribute('aria-invalid');
    }
    saveBtn.disabled = true;
  }
  async function loadDeviceSettings() {
    try {
      fill(await api.settings());
      formMsg.className = 'muted';
      formMsg.textContent = '';
    } catch {
      loaded = null;
      for (const f of FIELDS) inputs[f.key].disabled = true;
      saveBtn.disabled = true;
      formMsg.className = 'muted';
      formMsg.textContent = 'Connect to the device to see and change its settings.';
    }
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let bad = null;
    for (const f of FIELDS) {
      if (f.type === 'checkbox') continue;
      const n = Number(inputs[f.key].value);
      const ok = inputs[f.key].value.trim() !== '' && Number.isFinite(n) && n >= f.min && n <= f.max;
      inputs[f.key].toggleAttribute('aria-invalid', !ok);
      if (!ok && !bad) bad = f;
    }
    if (bad) {
      formMsg.className = 'msg error';
      formMsg.textContent = `${bad.label} must be between ${bad.min} and ${bad.max}.`;
      inputs[bad.key].focus();
      return;
    }
    const send = {};
    for (const f of FIELDS) send[f.key] = f.type === 'checkbox' ? (inputs[f.key].checked ? '1' : '0') : inputs[f.key].value;
    saveBtn.disabled = true;
    try {
      const saved = await api.saveSettings(send);
      fill(saved);
      formMsg.className = 'msg ok';
      formMsg.replaceChildren(icon('check', 16), ' Saved to the device.');
      session.refreshNow();
    } catch (e) {
      formMsg.className = 'msg error';
      formMsg.replaceChildren(icon('warn', 16), ` Could not save: ${e.message}`);
      markDirty();
    }
  });
  const deviceSettings = section('Device settings', form);

  // ---- archive
  const archiveStats = h('p'), gapsEl = h('div'), syncMsg = h('p', { class: 'muted', role: 'status' });
  const syncBtn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    await session.runSync();
    paintArchive();
  } }, icon('refresh', 18), h('span', null, 'Sync now'));
  const autoSync = h('input', { type: 'checkbox', id: 'autosync', checked: prefs.get('autoSync'), onchange: (e) => prefs.set('autoSync', e.target.checked) });
  async function paintArchive() {
    const sums = await store.listSummaries();
    if (destroyed) return;
    const rows = sums.reduce((a, s) => a + s.n, 0);
    const meta = await store.getMeta('lastSync');
    archiveStats.textContent = sums.length
      ? `${sums.length} ${sums.length === 1 ? 'day' : 'days'} saved on this phone (${fmtDateStr(sums[0].date)} to ${fmtDateStr(sums.at(-1).date)}), ${rows.toLocaleString()} readings, about ${fmtBytes(rows * 48)}.${store.persistent ? '' : ' This browser is not keeping the archive between visits (private mode?).'}`
      : 'Nothing saved yet.';
    const gaps = findGaps(sums.map((s) => s.date));
    gapsEl.replaceChildren(...(gaps.length ? [h('div', { class: 'banner warn' }, icon('warn', 20), h('div', { class: 'banner-text' },
      h('strong', null, 'Some days are missing'),
      h('p', null, `The device only keeps a few weeks, and these days were never copied: ${gaps.slice(0, 4).map((g) => (g.days === 1 ? fmtDateStr(g.from) : `${fmtDateStr(g.from)} to ${fmtDateStr(g.to)}`)).join('; ')}${gaps.length > 4 ? '…' : ''}. Sync more often to avoid gaps.`)))] : []));
    const sy = session.view.sync;
    if (sy.running) syncMsg.textContent = sy.progress ? `Copying ${sy.progress.done + 1} of ${sy.progress.total}…` : 'Checking the device…';
    else if (sy.error) syncMsg.textContent = `Sync failed: ${sy.error.message}`;
    else if (sy.result) syncMsg.textContent = `Synced just now: ${sy.result.fetched.length} ${sy.result.fetched.length === 1 ? 'day' : 'days'} copied.`;
    else if (meta) syncMsg.textContent = `Last synced ${fmtAgo((Date.now() - meta.at) / 1000)}.`;
    else syncMsg.textContent = '';
    syncBtn.disabled = sy.running || session.view.conn !== 'online';
  }
  unsubs.push(session.subscribe(paintArchive));
  const archive = section('Archive on this phone',
    h('p', { class: 'muted' }, 'The device keeps only a few weeks of logs. This app copies each day to this browser so history is not lost.'),
    window.isSecureContext ? null : h('div', { class: 'banner info', role: 'note' }, icon('info', 20), h('div', { class: 'banner-text' },
      h('strong', null, 'Best effort on an http page'),
      h('p', null, `This page is served over http, so the browser treats its storage as less permanent: it may clear it when space is short, Safari removes it after about a week without a visit, and each address (${location.hostname} or an IP) keeps its own separate copy. `,
        h('a', { href: '#/export' }, 'Back it up'), ' now and then.'))),
    archiveStats, gapsEl,
    h('div', { class: 'row' }, syncBtn),
    syncMsg,
    h('div', { class: 'field check' }, h('label', { for: 'autosync' }, h('span', null, 'Sync automatically'), h('span', { class: 'muted' }, ' whenever the device is reachable')), autoSync),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
      if (!confirm('Delete every day saved on this phone? The device keeps its own recent logs, but older days cannot be recovered unless you exported a backup.')) return;
      await store.clear();
      toast('Archive cleared.');
      paintArchive();
    } }, 'Clear archive…')));

  // ---- appearance
  const radios = (name, options, value, onPick) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h('label', { class: 'seg-label' },
      h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onPick(v) }), h('span', null, label))));
  const appearance = section('Appearance',
    h('div', { class: 'field stack' }, h('span', null, 'Theme'), radios('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], prefs.get('theme'), (v) => prefs.set('theme', v))),
    h('div', { class: 'field stack' }, h('span', null, 'Show times in'),
      radios('tz', [['device', 'Sydney (device)'], ['phone', 'This phone']], prefs.get('tzMode'), (v) => prefs.set('tzMode', v))));

  const about = section('About',
    h('p', { class: 'muted' }, `Statchain app ${APP_VERSION}`, ctx.session.view.state ? ` · device firmware ${ctx.session.view.state.fw}` : '',
      ctx.hostedByDevice ? ' · served by the device' : ''));

  root.replaceChildren(h('div', { class: 'view settings' }, connection, deviceSettings, archive, appearance, about));
  loadDeviceSettings();
  paintArchive();
  return { unmount() { destroyed = true; unsubs.forEach((f) => f()); } };
}
