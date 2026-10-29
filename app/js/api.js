// Client for the Statchain device's HTTP API (firmware/statchain/web.cpp).
//
// Browsers make this harder than it looks, so failures are classified:
//   network        device unreachable (off, out of range, wrong address)
//   timeout        no answer in time
//   mixed-content  this page is https but the device only speaks http: the browser blocks the call
//   http           the device answered with an error (status, message, retryInS where given)
//   parse          the answer wasn't what we expected

export class DeviceError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'DeviceError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const DEFAULT_DEVICE_URL = 'http://statchain.local';

// "192.168.1.50", "statchain.local:80", "http://x/" -> "http://x". Returns null if unusable.
export function normalizeBase(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function createApi({ getBase, fetchImpl, pageProtocol } = {}) {
  const doFetch = (...a) => (fetchImpl ?? globalThis.fetch)(...a);
  const protocol = () => (pageProtocol ? pageProtocol() : globalThis.location?.protocol);

  // opts: { method, form (object -> urlencoded body), timeoutMs, as: 'json'|'text', signal }
  async function request(path, opts = {}) {
    const base = normalizeBase(getBase());
    if (!base) throw new DeviceError('network', 'No device address set');
    const { method = 'GET', form, timeoutMs = 6000, as = 'json', signal } = opts;

    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    const onAbort = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    try {
      let res;
      try {
        // Form-encoded POSTs are "simple" CORS requests: no preflight, which the device handles anyway.
        res = await doFetch(base + path, {
          method, cache: 'no-store', signal: ctl.signal,
          ...(form ? { body: new URLSearchParams(form) } : {}),
        });
      } catch (e) {
        if (timedOut) throw new DeviceError('timeout', 'The device did not answer in time');
        if (e?.name === 'AbortError') throw e; // cancelled by the caller
        const blocked = protocol() === 'https:' && base.startsWith('http:');
        throw new DeviceError(blocked ? 'mixed-content' : 'network',
          blocked ? 'The browser blocked a secure page from reaching the (unsecured) device'
            : 'Could not reach the device');
      }

      // The timer keeps running while the body downloads: a device that stalls mid-file must not hang us.
      let body;
      try {
        body = as === 'text' ? await res.text() : await res.json();
      } catch (e) {
        if (timedOut) throw new DeviceError('timeout', 'The device stopped answering');
        if (e?.name === 'AbortError') throw e;
        if (res.ok) throw new DeviceError('parse', 'Unexpected reply from the device');
        body = null;
      }
      if (!res.ok) {
        // Errors are JSON even when a success would have been text (e.g. a CSV request that 404s).
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
        throw new DeviceError('http', body?.error || `Device error ${res.status}`,
          { status: res.status, retryInS: body?.retryInS, body });
      }
      return body;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    request,
    state: (o) => request('/api/state', o),
    today: (o) => request('/api/today', o),
    days: (o) => request('/api/days', o),
    log: (date, o) => request(`/api/log?date=${encodeURIComponent(date)}`, { timeoutMs: 15000, ...o, as: 'text' }),
    settings: (o) => request('/api/settings', o),
    saveSettings: (values, o) => request('/api/settings', { ...o, method: 'POST', form: values }),
    refresh: (o) => request('/api/refresh', { ...o, method: 'POST' }),
    setTime: (epochS, o) => request('/api/time', { ...o, method: 'POST', form: { epoch: String(epochS) } }),
  };
}
