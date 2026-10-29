// Home: live readings. Sound leads (it is the one number that changes every few seconds);
// temperature, humidity, pressure and battery are stat tiles.

import { h, icon, toast } from '../ui.js';
import { sparkline } from '../charts.js';
import { fmtNum, fmtClock, fmtAgo, fmtDuration } from '../format.js';

const soundWord = (db, loudDb) => (db >= loudDb ? 'Loud' : db < 40 ? 'Very quiet' : db < 55 ? 'Quiet' : db < 70 ? 'Moderate' : 'Noisy');

function banner(kind, iconName, title, body, ...actions) {
  return h('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(iconName, 20),
    h('div', { class: 'banner-text' }, h('strong', null, title), body ? h('p', null, body) : null,
      actions.length ? h('div', { class: 'row' }, actions) : null));
}

export function mountHome(ctx, root) {
  const { session, api, prefs } = ctx;
  let refreshBlockedUntil = 0;

  const el = {
    banners: h('div', { class: 'banners' }),
    heroNum: h('span', { class: 'hero-num' }, '–'),
    heroUnit: h('span', { class: 'hero-unit' }, 'dB'),
    heroChip: h('span', { class: 'chip critical', hidden: true }, icon('warn', 16), h('span', null, 'Loud')),
    heroDesc: h('p', { class: 'hero-desc' }),
    heroSpark: h('div', { class: 'hero-spark' }),
    hero: null,
    tiles: {},
    displayText: h('p', { class: 'muted' }),
    refreshBtn: null,
    footer: h('p', { class: 'muted small' }),
    seen: h('span'),
  };

  el.hero = h('section', { class: 'card hero', 'aria-labelledby': 'hero-label' },
    h('div', { class: 'hero-top' }, h('h2', { class: 'label', id: 'hero-label' }, 'Sound level'), el.heroChip),
    h('p', { class: 'hero-value' }, el.heroNum, el.heroUnit),
    el.heroDesc, el.heroSpark,
    h('p', { class: 'muted small' }, 'An estimate: not calibrated. ', h('a', { href: '#/settings' }, 'Calibrate')));

  function tile(id, label) {
    const value = h('span', { class: 'tile-num' }, '–');
    const unit = h('span', { class: 'unit' });
    const sub = h('p', { class: 'tile-sub' });
    const chip = h('span', { class: 'chip critical', hidden: true }, icon('warn', 14), h('span', null, 'Low'));
    el.tiles[id] = { value, unit, sub, chip };
    return h('article', { class: 'tile' }, h('div', { class: 'tile-top' }, h('h3', { class: 'label' }, label), chip),
      h('p', { class: 'tile-value' }, value, unit), sub);
  }

  el.refreshBtn = h('button', { type: 'button', class: 'btn', onclick: onRefresh }, icon('refresh', 18), h('span', null, 'Refresh display'));

  root.replaceChildren(h('div', { class: 'view home' },
    el.banners, el.hero,
    h('section', { class: 'tiles', 'aria-label': 'Other readings' },
      tile('temp', 'Temperature'), tile('hum', 'Humidity'), tile('press', 'Pressure'), tile('batt', 'Battery')),
    h('section', { class: 'card row-card' },
      h('div', null, h('h3', { class: 'label' }, 'E-ink display'), el.displayText), el.refreshBtn),
    el.footer));
  const view = root.firstElementChild;

  async function onRefresh() {
    try {
      await api.refresh();
      toast('Redrawing the display. It takes about 15 seconds.');
      refreshBlockedUntil = Date.now() + 15000;
    } catch (e) {
      if (e.status === 429) {
        refreshBlockedUntil = Date.now() + e.retryInS * 1000;
        toast(`The screen was refreshed a moment ago. Try again in ${fmtDuration(e.retryInS)}.`);
      } else toast(e.kind === 'network' || e.kind === 'timeout' ? 'Could not reach the device.' : e.message);
    }
    paintDisplay();
  }

  async function setClock() {
    try {
      await api.setTime(Math.floor(Date.now() / 1000));
      toast('Device clock set from this phone.');
      session.refreshNow();
    } catch (e) {
      toast(e.status === 409 ? 'The device clock is already set.' : `Could not set the clock: ${e.message}`);
    }
  }

  function paintBanners(v) {
    const out = [];
    const s = v.state;
    if (v.conn === 'blocked') {
      out.push(banner('error', 'warn', 'Your browser blocked the connection',
        'This page is on a secure (https) address, and browsers do not let those talk to a device that only speaks http. Open the app from an http address on your network, or allow insecure content for this site in your browser settings.',
        h('a', { class: 'btn small', href: '#/settings' }, 'Device settings')));
    } else if (v.conn === 'offline') {
      out.push(banner('error', 'offline', "Can't reach your Statchain",
        ['Check that it is powered and on the same Wi-Fi as this device, then try again. ', el.seen],
        h('button', { type: 'button', class: 'btn small', onclick: () => session.refreshNow() }, 'Try again'),
        h('a', { class: 'btn small ghost', href: '#/settings' }, 'Change address')));
    }
    if (v.conn === 'online' && s) {
      if (!s.timeValid) {
        out.push(banner('warn', 'warn', "The device clock isn't set",
          'Without the time it cannot keep daily logs. It sets itself over Wi-Fi with internet; otherwise set it from this phone.',
          h('button', { type: 'button', class: 'btn small', onclick: setClock }, 'Set clock from this phone')));
      }
      const faults = [];
      if (!s.sensors.aht20) faults.push('the temperature/humidity sensor (AHT20)');
      if (!s.sensors.bmp280) faults.push('the pressure sensor (BMP280)');
      if (!s.sensors.mic) faults.push('the microphone');
      if (!s.sensors.flash) faults.push('log storage');
      if (faults.length) out.push(banner('warn', 'warn', 'Something is not responding', `The device reports a problem with ${faults.join(', ')}. Check the wiring.`));
      if (s.hotspot) out.push(banner('info', 'info', 'Connected to the device’s own hotspot', 'It could not join your Wi-Fi network, so it has no internet for the clock.'));
    }
    el.banners.replaceChildren(...out);
    paintSeen();
  }

  // Only this text changes each second while offline; the banner itself (and its buttons) stay put.
  function paintSeen() {
    const v = session.view;
    el.seen.textContent = v.conn === 'offline' && v.stateAt ? `Last seen ${fmtAgo((Date.now() - v.stateAt) / 1000)}.` : '';
  }

  function paintDisplay() {
    const v = session.view, d = v.state?.display;
    if (!d) { el.displayText.textContent = '–'; return; }
    const tz = ctx.tz();
    if (!d.drawn) el.displayText.textContent = 'Not drawn yet.';
    else {
      const left = Math.max(0, d.nextInS - (Date.now() - v.stateAt) / 1000);
      el.displayText.textContent = `${d.lastEpoch ? `Updated ${fmtClock(d.lastEpoch, tz.timeZone)}` : 'Updated'} · next refresh in ${fmtDuration(left)}`;
    }
    el.refreshBtn.disabled = v.conn !== 'online' || Date.now() < refreshBlockedUntil;
  }

  function render() {
    const v = session.view, s = v.state;
    const online = v.conn === 'online';
    view.classList.toggle('stale', !online && !!s);
    paintBanners(v);
    if (!s) { paintDisplay(); return; }

    // hero
    const db = s.soundDb;
    const loud = db != null && db >= s.loudDb;
    el.heroNum.textContent = fmtNum(db, 0);
    el.heroNum.classList.toggle('no-value', db == null);
    el.heroUnit.textContent = s.aWeighting ? 'dB(A)' : 'dB';
    el.heroChip.hidden = !loud;
    el.hero.classList.toggle('is-loud', loud);
    const range = s.soundMin != null && s.soundMax != null ? ` · today ${fmtNum(s.soundMin, 0)}–${fmtNum(s.soundMax, 0)} dB` : '';
    el.heroDesc.textContent = db == null ? 'No microphone reading' : `${soundWord(db, s.loudDb)}${range}`;
    const vals = v.sound.map((p) => p.v);
    el.heroSpark.replaceChildren(vals.length >= 3
      ? sparkline(vals, { width: 300, height: 44, label: `Sound level over the last ${fmtDuration(((v.sound.at(-1).at - v.sound[0].at) / 1000))}` })
      : '');

    // tiles
    const t = v.today;
    const set = (id, value, dec, unit, sub) => {
      el.tiles[id].value.textContent = fmtNum(value, dec);
      el.tiles[id].value.classList.toggle('no-value', value == null);
      el.tiles[id].unit.textContent = value == null ? '' : ` ${unit}`;
      el.tiles[id].sub.textContent = sub;
    };
    const rng = (m, dec) => (m && m.min != null ? `Today ${fmtNum(m.min, dec)}–${fmtNum(m.max, dec)}` : '');
    set('temp', s.tempC, 1, '°C', rng(t?.temperature, 1));
    set('hum', s.humidity, 0, '%', rng(t?.humidity, 0));
    set('press', s.pressureHPa, 0, 'hPa', rng(t?.pressure, 0));
    const low = s.battValid && s.battPct <= s.battLowPct;
    set('batt', s.battValid ? s.battPct : null, 0, '%', s.battValid ? `${(s.battMv / 1000).toFixed(2)} V` : 'No battery detected');
    el.tiles.batt.chip.hidden = !low;

    paintDisplay();
    const bits = [s.local ? `Device clock ${s.local}` : null, `firmware ${s.fw}`, s.rssi ? `Wi-Fi ${s.rssi} dBm` : null, `up ${fmtDuration(s.uptimeS)}`];
    el.footer.textContent = (online ? '' : `Last seen ${fmtAgo((Date.now() - v.stateAt) / 1000)} · `) + bits.filter(Boolean).join(' · ');
  }

  const off = session.subscribe(render);
  session.setMode('fast');
  const clock = setInterval(() => { paintDisplay(); paintSeen(); }, 1000);
  render();
  return { unmount() { off(); clearInterval(clock); session.setMode('slow'); } };
}
