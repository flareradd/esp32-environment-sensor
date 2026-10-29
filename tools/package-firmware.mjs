#!/usr/bin/env node
// Builds the firmware and packages flashable images into dist/ (git-ignored).
//
//   node tools/package-firmware.mjs
//
// Needs arduino-cli on your PATH (or set ARDUINO_CLI). The first run downloads the pinned ESP32 core and
// libraries (see firmware/statchain/sketch.yaml), which is several hundred MB.
//
// Produces, for firmware version X:
//   statchain-vX-esp32c3-full.bin      everything from address 0x0: bootloader, partition table, app.
//                                      Use for the FIRST flash. Also resets settings (the NVS area).
//   statchain-vX-esp32c3-app-only.bin  just the program, for address 0x10000. Use for UPDATES: keeps your
//                                      settings and the logs.
//   SHA256SUMS and FLASHING.txt        checksums and the exact commands
//
// If firmware/statchain/secrets.h exists, your Wi-Fi name and password are compiled into the images, and the
// file names say "-wifi" so you do not share one by accident. Without it the device starts as a hotspot.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKETCH = join(ROOT, 'firmware/statchain');
const DIST = join(ROOT, 'dist');
const BUILD = join(DIST, 'build');
const CLI = process.env.ARDUINO_CLI || 'arduino-cli';

const APP_OFFSET = 0x10000;       // where partitions.csv puts the program
const PARTITION_TABLE_OFFSET = 0x8000;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const fail = (m) => { console.error(`\npackage-firmware: ${m}`); process.exit(1); };

// ---- 1. the embedded app must match app/ (else the device would ship a stale app)
try {
  const { buildApp, parseHeader, HEADER_PATH } = await import('./build-app.mjs');
  const fresh = await buildApp(), have = parseHeader(readFileSync(HEADER_PATH, 'utf8'));
  if (have.length !== fresh.length || fresh.some((a, i) => have[i].etag !== a.etag)) {
    fail('firmware/statchain/app_assets.h is out of date with app/. Run: npm run build:app');
  }
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.warn('(esbuild is not installed, so the embedded app was not checked against app/. Run npm install to enable that.)');
}

// ---- 2. build
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
console.log(`Building with ${CLI} (the first build downloads the pinned toolchain; be patient)...\n`);
const r = spawnSync(CLI, ['compile', '--warnings', 'default', '--output-dir', BUILD], { cwd: SKETCH, stdio: 'inherit' });
if (r.error?.code === 'ENOENT') fail(`${CLI} not found. Install arduino-cli: https://arduino.github.io/arduino-cli/latest/installation/`);
if (r.status !== 0) fail('the build failed (see above)');

// ---- 3. assemble and cross-check
const app = readFileSync(join(BUILD, 'statchain.ino.bin'));
const merged = readFileSync(join(BUILD, 'statchain.ino.merged.bin'));
const table = readFileSync(join(BUILD, 'statchain.ino.partitions.bin'));
const boot = readFileSync(join(BUILD, 'statchain.ino.bootloader.bin'));

if (merged[0] !== 0xe9 || app[0] !== 0xe9) fail('images do not start with the ESP32 image magic byte (0xE9)');
if (!merged.subarray(APP_OFFSET, APP_OFFSET + 64).equals(app.subarray(0, 64))) fail(`the program is not at 0x${APP_OFFSET.toString(16)} in the merged image`);
if (!merged.subarray(PARTITION_TABLE_OFFSET, PARTITION_TABLE_OFFSET + table.length).equals(table)) fail('partition table is not at 0x8000 in the merged image');
if (!merged.subarray(0, boot.length).equals(boot)) fail('bootloader is not at 0x0 in the merged image');

// The partition table says how much room the program has; make sure it fits.
const entries = [];
for (let o = 0; o + 32 <= table.length && table[o] === 0xaa && table[o + 1] === 0x50; o += 32) {
  entries.push({ name: table.subarray(o + 12, o + 28).toString().replace(/\0.*$/, ''), offset: table.readUInt32LE(o + 4), size: table.readUInt32LE(o + 8) });
}
const app0 = entries.find((e) => e.name === 'app0');
if (!app0 || app0.offset !== APP_OFFSET) fail('partition table has no app0 at 0x10000 (partitions.csv changed? update APP_OFFSET here)');
if (app.length > app0.size) fail(`the program (${app.length} bytes) does not fit its partition (${app0.size})`);

const end = Math.ceil((APP_OFFSET + app.length) / 0x1000) * 0x1000; // stop after the program: no padding to the end of flash
const full = merged.subarray(0, end);

const version = /#define FW_VERSION "([^"]+)"/.exec(readFileSync(join(SKETCH, 'config.h'), 'utf8'))?.[1] ?? 'dev';
const secrets = join(SKETCH, 'secrets.h');
const hasWifi = existsSync(secrets) && /#define\s+WIFI_SSID\s+"[^"]+"/.test(readFileSync(secrets, 'utf8'));
const tag = hasWifi ? '-wifi' : '';
const fullName = `statchain-v${version}-esp32c3-full${tag}.bin`;
const appName = `statchain-v${version}-esp32c3-app-only${tag}.bin`;
writeFileSync(join(DIST, fullName), full);
writeFileSync(join(DIST, appName), app);
writeFileSync(join(DIST, 'SHA256SUMS'), `${sha256(full)}  ${fullName}\n${sha256(app)}  ${appName}\n`);

const flashing = `Statchain v${version} for ESP32-C3 (4 MB flash)${hasWifi ? '\nTHESE IMAGES CONTAIN YOUR WI-FI PASSWORD. Do not share them.' : '\nNo Wi-Fi credentials inside: the device starts as a hotspot named Statchain-XXXX (password: statchain).'}

FIRST FLASH (also resets settings; logs start empty):
  esptool --chip esp32c3 --port <PORT> --baud 460800 write-flash 0x0 ${fullName}

UPDATE (keeps settings and logs):
  esptool --chip esp32c3 --port <PORT> --baud 460800 write-flash 0x10000 ${appName}

<PORT> is /dev/ttyACM0 (Linux), /dev/cu.usbmodem* (macOS) or COM5 (Windows).
Older esptool (v4) spells the command write_flash.
No esptool? Use a browser flasher (Chrome or Edge): https://espressif.github.io/esptool-js/
  Connect, then program ${fullName} at address 0x0.

If the board is not found: hold the BOOT button, tap RESET (or plug USB in while holding BOOT), release BOOT, retry.
Full guide: docs/flashing.md
`;
writeFileSync(join(DIST, 'FLASHING.txt'), flashing);

console.log(`\nPackaged into ${DIST}:`);
console.log(`  ${fullName}  ${full.length} bytes  (flash at 0x0)`);
console.log(`  ${appName}  ${app.length} bytes  (flash at 0x10000)`);
console.log(`Program uses ${(100 * app.length / app0.size).toFixed(0)}% of its ${(app0.size / 1024) | 0} KB partition.`);
console.log(hasWifi ? '\nNOTE: your Wi-Fi password is inside these images.' : '\nNo secrets.h: these images start the device as a hotspot.');
