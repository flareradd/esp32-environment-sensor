# Statchain companion app (browser)

A single-page web app, no build step and no dependencies: plain ES modules in [`app/`](../app).
It talks to the device's HTTP API ([`web.h`](../firmware/statchain/web.h)), keeps a copy of every day's
log on your phone, and works offline once installed.

| Tab | What it does |
|-----|--------------|
| **Home** | Live readings. Sound level leads (it is the number that moves), then temperature, humidity, pressure and battery, with today's range. Shows why when the device can't be reached, the clock isn't set, or a sensor is failing. Refreshes the e-ink screen on request. |
| **Today** | A day's low / average / high for each measurement and how the day unfolded. Arrows step back through archived days. |
| **Trends** | Each measurement across the archive: 24 hours, 7 days, 30 days or everything. Longer spans are averaged (hourly, then daily) with a min–max band, so a year stays readable. Gaps in the data show as gaps. |
| **Settings** | Device address, the device's own settings (saved to its flash), archive sync, theme, time zone. |
| **Export** | Readings or daily summaries as CSV; the whole archive as a JSON backup, and restore from one. |

Every chart has a table view and works from the keyboard (arrow keys read values).

## Running it

```sh
node tools/serve-app.mjs          # http://localhost:8080
```

Then open it in a browser on the same network as the device. The default device address is
`http://statchain.local`; change it under **Settings** (for example to the IP address printed in the
device's serial log). Android phones often cannot resolve `.local` names, so use the IP there.

**No hardware yet?** Run the mock device, which behaves like the firmware, with 45 days of realistic data:

```sh
node tools/mock-device/server.mjs          # http://localhost:8765
```

and set the app's device address to `http://localhost:8765`.

## Where to host it: the https problem

Browsers refuse to let a page loaded over **https** call an **http** address (it is "mixed content"),
and the device only speaks http. That decides how the app can be hosted today:

| Hosting | Reaches the device? | Install / offline? |
|---------|---------------------|--------------------|
| `localhost` on a computer (`node tools/serve-app.mjs`) | Yes | Yes (localhost counts as secure) |
| A computer or Raspberry Pi on your network, opened from a phone as `http://<its-ip>:8080` | Yes | No: only secure contexts can install or go offline. The app runs, and the archive is still saved on the phone. |
| A public https site (GitHub Pages and the like) | **Blocked** by the browser, and the app says so. Desktop Chrome has a per-site "Insecure content" setting that lifts the block; don't count on that existing on phones. | Yes |

The app detects the blocked case and explains it instead of just showing "offline".

Two ways out, for a later round: serve the app from the device itself (same origin, so no
mixed content; it needs a bigger flash partition than the firmware currently leaves free), or move to the
native app planned next, which has no such restriction.

## Data and privacy

* The archive lives in the browser's **IndexedDB** on that phone/browser. Nothing is sent anywhere
  except to your device. There is no account and no server.
* The device keeps only a few weeks of logs; the app copies each day when it connects, and never deletes
  from the archive by itself. **Settings → Archive** shows what's saved and warns about missing days.
* Clearing site data in the browser deletes the archive. **Export → Backup (JSON)** is the safety copy.
* The device has no authentication, so anyone on the same network can change its settings. Keep it on a
  network you trust.

## Tests

```sh
npm test                 # unit + integration: app logic against the mock device over real HTTP
npm run test:e2e         # the real app in headless Chromium against the mock device
```

The end-to-end suite needs Playwright and Chromium (`npm i -g playwright && npx playwright install chromium`).
It serves the app and the mock device from different origins, so CORS is exercised for real, and it
covers live readings, losing and regaining the device, sync and day rollover, charts (pointer and
keyboard), settings, export/import round trips, offline reload from the service worker, the https-blocked
case, and layout at phone and desktop sizes. `SHOTS=/some/dir` also saves screenshots.

## How it is put together

```
app/
  index.html, css/app.css, manifest.webmanifest, sw.js, icons/
  js/
    main.js          wiring, router, theme, service worker
    session.js       the one shared view of the device: connection, polling, auto-sync
    api.js           device client; classifies failures (network / timeout / blocked / http / parse)
    sync.js          copies device days into the archive; a day is final once the device date passes it
    store.js         IndexedDB archive (memory fallback if the browser blocks it)
    logs.js tz.js    CSV parsing, summaries, bucketing; Sydney-day / DST-correct time maths
    chart-math.js charts.js   scales and ticks, then the SVG charts
    export.js        CSV / JSON building and parsing
    views/           home, today, trends, settings, export
tools/mock-device/   a stand-in for the device (same API, seeded data, virtual clock)
tools/serve-app.mjs  tiny static server
tests/               unit, integration, e2e
```
