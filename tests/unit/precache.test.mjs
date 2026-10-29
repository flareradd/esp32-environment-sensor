import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(fileURLToPath(new URL('../../app/', import.meta.url)));
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(APP).map((f) => relative(APP, f).replaceAll('\\', '/'));
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Source artwork that is not served to the page, and the worker itself, need no precache entry.
const NOT_PRECACHED = new Set(['sw.js', 'icons/icon-maskable.svg']);

test('every file the app ships is precached (else it breaks offline), and nothing precached is missing', () => {
  const expected = files.filter((f) => !NOT_PRECACHED.has(f));
  const have = shell.filter((f) => f !== './');
  assert.deepEqual([...have].sort(), [...expected].sort());
  assert.ok(shell.includes('./'), 'the bare directory URL is cached too');
});

test('the service worker and app agree on the version', () => {
  const v = readFileSync(join(APP, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], v);
});

test('every relative import in the app resolves to a real file', () => {
  for (const f of files.filter((x) => x.endsWith('.js') && x !== 'sw.js')) {
    const src = readFileSync(join(APP, f), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      const target = resolve(APP, dirname(f), m[1]);
      assert.ok(existsSync(target), `${f} imports ${m[1]} which does not exist`);
    }
  }
});

test('the manifest and index.html point at files that exist', () => {
  const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
  for (const i of manifest.icons) assert.ok(files.includes(i.src), i.src);
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^(https?:|#)/.test(m[1])) continue;
    assert.ok(files.includes(m[1]), `index.html references ${m[1]}`);
  }
});
