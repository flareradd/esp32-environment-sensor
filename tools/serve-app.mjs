#!/usr/bin/env node
// Serves app/ over http with correct MIME types. No dependencies.
//   node tools/serve-app.mjs [--port 8080]
// localhost counts as a secure context, so the service worker and "install" work there; from a phone
// (http://<computer-ip>:8080) the app runs but cannot go offline. See docs/app.md.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../app/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const port = i >= 0 ? +process.argv[i + 1] : 8080;
  createAppServer().listen(port, '0.0.0.0', () => console.log(`Statchain app on http://localhost:${port}`));
}
