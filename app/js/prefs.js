// App preferences, kept in localStorage (per-browser conveniences only: the archive lives in
// IndexedDB). If storage is blocked the prefs still work for the life of the page.

import { DEFAULT_DEVICE_URL } from './api.js';

export const DEFAULTS = {
  deviceUrl: DEFAULT_DEVICE_URL,
  autoSync: true,
  tzMode: 'device',   // 'device' = Sydney, like the logs; 'phone' = this phone's zone
  theme: 'system',    // 'system' | 'light' | 'dark'
  lastState: null,    // last reading from the device, shown (dimmed) while it is out of reach
};

const PREFIX = 'statchain.';

function pickStorage() {
  try {
    const s = globalThis.localStorage;
    const k = `${PREFIX}probe`;
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export function createPrefs(storage = pickStorage()) {
  const mem = new Map();
  const listeners = new Set();
  return {
    get(key) {
      if (storage) {
        try {
          const raw = storage.getItem(PREFIX + key);
          if (raw !== null) return JSON.parse(raw);
        } catch { /* fall through to memory / default */ }
      }
      return mem.has(key) ? mem.get(key) : DEFAULTS[key];
    },
    set(key, value) {
      mem.set(key, value);
      if (storage) { try { storage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* memory copy still holds */ } }
      for (const fn of listeners) fn(key, value);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
