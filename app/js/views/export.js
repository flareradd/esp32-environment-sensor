// Export: take the archive out as CSV (spreadsheets) or JSON (a full backup), and restore a backup.

import { h, icon, toast, download, emptyState } from '../ui.js';
import { recordsCsv, summariesCsv, backupJson, parseBackup, mergeBackup } from '../export.js';
import { fmtDateStr, fmtBytes } from '../format.js';

const toInput = (ds) => `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`; // YYYYMMDD -> value of <input type=date>
const fromInput = (v) => v.replaceAll('-', '');

export function mountExport(ctx, root) {
  const { store, session } = ctx;
  let destroyed = false;

  const info = h('p');
  const from = h('input', { type: 'date', id: 'x-from' });
  const to = h('input', { type: 'date', id: 'x-to' });
  const rangeMsg = h('p', { class: 'msg error', role: 'alert', hidden: true });
  const body = h('div');

  root.replaceChildren(h('div', { class: 'view export' }, body));

  async function selection() {
    const a = fromInput(from.value), b = fromInput(to.value);
    if (!a || !b || a > b) {
      rangeMsg.hidden = false;
      rangeMsg.textContent = 'Choose a start date that is on or before the end date.';
      return null;
    }
    rangeMsg.hidden = true;
    const sums = (await store.listSummaries()).filter((s) => s.date >= a && s.date <= b);
    return { a, b, sums };
  }
  const range = (a, b) => (a === b ? a : `${a}-${b}`);

  const btn = (label, desc, onclick) => h('button', { type: 'button', class: 'btn export-btn', onclick },
    icon('export', 18), h('span', null, h('strong', null, label), h('span', { class: 'muted small block' }, desc)));

  async function exportReadings() {
    const sel = await selection(); if (!sel) return;
    const days = await store.getDays(sel.sums.map((s) => s.date));
    download(`statchain-readings-${range(sel.a, sel.b)}.csv`, recordsCsv(days, ctx.tz()), 'text/csv');
    toast(`Exported ${days.reduce((n, d) => n + d.rows.length, 0).toLocaleString()} readings.`);
  }
  async function exportSummaries() {
    const sel = await selection(); if (!sel) return;
    download(`statchain-daily-summaries-${range(sel.a, sel.b)}.csv`, summariesCsv(sel.sums), 'text/csv');
    toast(`Exported ${sel.sums.length} daily summaries.`);
  }
  async function exportBackup() {
    const sums = await store.listSummaries();
    const days = await store.getDays(sums.map((s) => s.date));
    download(`statchain-backup-${sums[0].date}-${sums.at(-1).date}.json`, backupJson(days, { firmware: session.view.state?.fw }), 'application/json');
    toast(`Backup saved: ${days.length} days.`);
  }

  const importMsg = h('p', { class: 'muted', role: 'status' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'x-file', onchange: async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const incoming = parseBackup(await f.text());
      const have = new Map((await store.getDays(incoming.map((d) => d.date))).map((d) => [d.date, d]));
      const { write, added, updated } = mergeBackup(have, incoming);
      for (const d of write) await store.putDay(d);
      importMsg.className = 'msg ok';
      importMsg.replaceChildren(icon('check', 16), ` Restored: ${added} new ${added === 1 ? 'day' : 'days'}, ${updated} updated, ${incoming.length - added - updated} already up to date.`);
      toast('Backup restored.');
      render();
    } catch (e) {
      importMsg.className = 'msg error';
      importMsg.replaceChildren(icon('warn', 16), ` ${e.message}`);
    }
    file.value = '';
  } });

  async function render() {
    const sums = await store.listSummaries();
    if (destroyed) return;
    const restore = h('section', { class: 'card settings-section' }, h('h2', null, 'Restore a backup'),
      h('p', { class: 'muted' }, 'Load a backup file made by this app. Days already on this phone are merged, never overwritten with less.'),
      h('label', { class: 'field stack', for: 'x-file' }, h('span', null, 'Backup file (.json)'), file), importMsg);
    if (!sums.length) {
      body.replaceChildren(emptyState('Nothing to export yet', 'Once the app has copied days from your Statchain they can be exported here.',
        h('a', { class: 'btn', href: '#/settings' }, 'Device settings')), restore);
      return;
    }
    const rows = sums.reduce((n, s) => n + s.n, 0);
    info.textContent = `${sums.length} ${sums.length === 1 ? 'day' : 'days'} (${fmtDateStr(sums[0].date)} to ${fmtDateStr(sums.at(-1).date)}), ${rows.toLocaleString()} readings, about ${fmtBytes(rows * 48)}.`;
    from.min = to.min = toInput(sums[0].date);
    from.max = to.max = toInput(sums.at(-1).date);
    if (!from.value) from.value = toInput(sums[0].date);
    if (!to.value) to.value = toInput(sums.at(-1).date);
    body.replaceChildren(
      h('section', { class: 'card settings-section' }, h('h2', null, 'Export'),
        info,
        h('div', { class: 'row' },
          h('label', { class: 'field stack', for: 'x-from' }, h('span', null, 'From'), from),
          h('label', { class: 'field stack', for: 'x-to' }, h('span', null, 'To'), to)),
        rangeMsg,
        h('div', { class: 'export-list' },
          btn('Readings (CSV)', 'Every logged reading in the range, with local times. Opens in a spreadsheet.', exportReadings),
          btn('Daily summaries (CSV)', 'One line per day: low, average and high for each measurement.', exportSummaries)),
        h('p', { class: 'muted small' }, `Times are shown in ${ctx.tz().timeZone ?? 'this phone’s time zone'}.`)),
      h('section', { class: 'card settings-section' }, h('h2', null, 'Full backup'),
        h('p', { class: 'muted' }, 'Everything in the archive as one file, to keep safe or to move to another browser. Always the whole archive, whatever dates are chosen above.'),
        window.isSecureContext ? null : h('p', { class: 'muted' }, 'The app is on a plain-http page, so the browser may clear its storage: a backup now and then is worth having.'),
        btn('Backup (JSON)', 'Lossless; can be restored below.', exportBackup)),
      restore);
  }
  // The archive can change under us (first sync finishing, a later sync): keep the page current.
  let seenSyncAt = session.view.sync.at;
  const off = session.subscribe((v) => { if (v.sync.at !== seenSyncAt) { seenSyncAt = v.sync.at; render(); } });
  render();
  return { unmount() { destroyed = true; off(); } };
}
