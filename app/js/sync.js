// Copies the device's daily logs into the phone archive.
//
// A day is "complete" once the device's own date has moved past it. Until then the day is
// re-fetched on every sync (it is still growing). Complete days are never fetched again, so
// syncing is cheap, and the archive is never trimmed: it keeps what the device has pruned.

import { DeviceError } from './api.js';
import { mergeRows, parseLogCsv, summarize } from './logs.js';

export function createSync({ api, store, now = () => Date.now() }) {
  let running = null;

  async function syncDay(date, today) {
    const existing = await store.getDay(date);
    let rows = parseLogCsv(await api.log(date));
    // Merge rather than replace: if the device lost rows (reflash, full flash) the archive keeps them.
    if (existing) rows = mergeRows(existing.rows, rows);
    const day = { date, rows, complete: !!today && date < today, fetchedAt: now(), summary: summarize(rows) };
    await store.putDay(day);
    return day;
  }

  // Fetches every device day not yet archived as complete. Returns what happened.
  // Throws DeviceError if the device can't be reached; days already copied stay saved.
  function syncAll(onProgress) {
    if (running) return running; // one sync at a time: the device is a tiny single-threaded server
    running = (async () => {
      const info = await api.days();
      const today = info.today || '';
      const have = new Map((await store.listSummaries()).map((s) => [s.date, s]));
      const todo = info.days.filter((d) => !have.get(d)?.complete);
      const result = { today, deviceDays: info.days, fetched: [], skipped: info.days.length - todo.length, missing: [] };

      let done = 0;
      for (const date of todo) {
        onProgress?.({ done, total: todo.length, date });
        try {
          await syncDay(date, today);
          result.fetched.push(date);
        } catch (e) {
          // The device may have pruned this day between listing and fetching: note it, carry on.
          if (e instanceof DeviceError && e.kind === 'http' && e.status === 404) result.missing.push(date);
          else throw e;
        }
        done++;
      }
      onProgress?.({ done, total: todo.length, date: null });
      result.at = now();
      await store.setMeta('lastSync', { at: result.at, today, fetched: result.fetched.length });
      return result;
    })().finally(() => { running = null; });
    return running;
  }

  return { syncAll, syncDay, get running() { return !!running; } };
}
