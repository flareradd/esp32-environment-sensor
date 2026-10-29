// The app's one view of the device: is it reachable, what did it last say, is the archive syncing.
// The top bar, Home and Settings all read this, so they can never disagree about connectivity.

const FAST_MS = 3000;       // Home is open: live readings
const SLOW_MS = 15000;      // another tab: keep the connection pill honest, cheaply
const TODAY_EVERY_MS = 30000;
const AUTO_SYNC_EVERY_MS = 15 * 60 * 1000;
const HISTORY = 90;         // live sound readings kept for the sparkline

export function createSession({ api, sync, prefs, now = () => Date.now() }) {
  const listeners = new Set();
  const cached = prefs.get('lastState');
  const view = {
    conn: 'connecting',           // 'connecting' | 'online' | 'offline' | 'blocked'
    error: null,                  // last DeviceError while not online
    state: cached?.state ?? null, // latest /api/state body (from the previous visit until we hear back)
    stateAt: cached?.at ?? 0,
    today: null,                  // latest /api/today body
    sound: [],                    // [{ at, v }] live readings this visit
    sync: { running: false, progress: null, result: null, error: null, at: 0 },
  };

  let mode = 'slow';
  let timer = null;
  let inflight = false;
  let failures = 0;
  let lastTodayAt = 0;
  let epoch = 0; // bumped when the address changes, so late answers from the old address are ignored

  const emit = () => { for (const fn of listeners) fn(view); };
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  function delay() {
    if (view.conn === 'online') return mode === 'fast' ? FAST_MS : SLOW_MS;
    return Math.min(30000, 4000 * 2 ** Math.min(failures, 3)); // back off while the device is away
  }
  function schedule(ms = delay()) {
    clearTimeout(timer);
    if (hidden()) return;
    timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (inflight) return;
    inflight = true;
    const mine = epoch;
    try {
      const s = await api.state();
      if (mine !== epoch) return;
      const wasOnline = view.conn === 'online';
      failures = 0;
      view.conn = 'online';
      view.error = null;
      view.state = s;
      view.stateAt = now();
      if (s.soundDb != null) {
        view.sound.push({ at: view.stateAt, v: s.soundDb });
        if (view.sound.length > HISTORY) view.sound.shift();
      }
      prefs.set('lastState', { state: s, at: view.stateAt });
      emit();
      if (!wasOnline) { fetchToday(); maybeSync(true); }
      else { if (now() - lastTodayAt > TODAY_EVERY_MS) fetchToday(); maybeSync(false); }
    } catch (e) {
      if (mine !== epoch || e?.name === 'AbortError') return;
      failures++;
      view.conn = e.kind === 'mixed-content' ? 'blocked' : 'offline';
      view.error = e;
      emit();
    } finally {
      inflight = false;
      if (mine === epoch) schedule();
    }
  }

  async function fetchToday() {
    lastTodayAt = now();
    try { view.today = await api.today(); emit(); } catch { /* the next poll will try again */ }
  }

  function maybeSync(justConnected) {
    if (!prefs.get('autoSync') || view.sync.running) return;
    if (justConnected || now() - view.sync.at > AUTO_SYNC_EVERY_MS) runSync();
  }

  async function runSync() {
    if (view.sync.running) return view.sync.result;
    view.sync = { ...view.sync, running: true, progress: null, error: null };
    emit();
    try {
      const result = await sync.syncAll((p) => { view.sync.progress = p; emit(); });
      view.sync = { running: false, progress: null, result, error: null, at: now() };
    } catch (e) {
      view.sync = { ...view.sync, running: false, progress: null, error: e, at: now() };
    }
    emit();
    return view.sync.result;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { failures = 0; tick(); } else clearTimeout(timer);
    });
  }
  prefs.onChange((k) => {
    if (k !== 'deviceUrl') return;
    epoch++; // forget anything in flight for the old address
    inflight = false;
    failures = 0;
    Object.assign(view, { conn: 'connecting', error: null, today: null, sound: [] });
    emit();
    tick();
  });

  return {
    view,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() { tick(); },
    setMode(m) { if (mode !== m) { mode = m; if (view.conn === 'online') schedule(m === 'fast' ? 400 : delay()); } },
    refreshNow() { failures = 0; return tick(); },
    fetchToday,
    runSync,
  };
}
