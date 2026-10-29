# Statchain companion app

A single-page web app, plain ES modules with no framework. **The device serves it**: it is compiled into
the firmware, so opening the device's address in a browser is the whole setup. It talks to the device's
HTTP API ([`web.h`](../firmware/statchain/web.h)), keeps a copy of every day's log in the browser, and can
export it.

| Tab | What it does |
|-----|--------------|
| **Home** | Live readings. Sound level leads (it is the number that moves), then temperature, humidity, pressure and battery, with today's range. Shows why when the device can't be reached, the clock isn't set, or a sensor is failing. Refreshes the e-ink screen on request. |
| **Today** | A day's low / average / high for each measurement and how the day unfolded. Arrows step back through archived days. |
| **Trends** | Each measurement across the archive: 24 hours, 7 days, 30 days or everything. Longer spans are averaged (hourly, then daily) with a min–max band, so a year stays readable. Gaps in the data show as gaps. |
| **Settings** | The device's own settings (saved to its flash), archive sync, theme, time zone. |
| **Export** | Readings or daily summaries as CSV; the whole archive as a JSON backup, and restore from one. |

Every chart has a table view and works from the keyboard (arrow keys read values).

## Using it

1. Flash the firmware (see the [README](../README.md#build-and-flash)).
2. On a phone or computer on the same Wi-Fi, open **`http://statchain.local`**. On Android, or anywhere
   `.local` names don't resolve, use the device's IP address (printed in the serial log, or in your router).
3. If the device can't join your Wi-Fi it starts its own hotspot, `Statchain-XXXX`. Join that and open
   `http://192.168.4.1`.

Because the app comes from the device, the device's address is simply the page's own address: there is
nothing to configure, and the browser never has to make a cross-origin or https-to-http request.

## Where the archive lives, and how durable that is

The device keeps only a few weeks of logs, so each time the app connects it copies new days into the
browser's **IndexedDB**, and never deletes from that copy by itself. **Settings → Archive** shows what is
saved and warns about days that were missed.

Serving from the device means the page is plain `http://`, which browsers treat as a less trustworthy
context. What that does and does not change:

* **It does work.** IndexedDB is available on http pages, and this is tested on a genuinely non-secure
  origin: the archive survives page reloads.
* **It is best effort.** The browser may clear the storage when the phone is short on space, Safari removes
  script-written storage after about a week without a visit, and clearing site data deletes it.
* **It is per address.** `http://statchain.local` and `http://192.168.1.50` are different origins, each with
  its own separate archive. Pick one and stick to it.
* **There is no offline app.** Installable, offline-capable web apps need https (or localhost), so the page
  itself is loaded from the device each time. The archive can only be viewed while the device is reachable.

So until there is somewhere durable to put the data (the native app, or a server), treat the in-browser
archive as a convenience, and make a backup with **Export → Backup (JSON)** now and then. The app says this
on the Settings and Export pages.

The device has no authentication, so anyone on the same network can change its settings. Keep it on a
network you trust.

## Changing the app

The source is in [`app/`](../app). The firmware serves a built copy, [`app_assets.h`](../firmware/statchain/app_assets.h),
which is generated and committed so that building the firmware needs nothing but `arduino-cli`.

```sh
npm install                  # once: esbuild (the only dependency, build time only)
node tools/serve-app.mjs     # run app/ directly while developing: http://localhost:8080
node tools/mock-device/server.mjs    # a stand-in device; also serves the built app at /
npm run build:app            # rebuild app_assets.h after changing anything in app/
```

Then recompile and upload the firmware. `npm test` fails if `app_assets.h` is out of date with `app/`, so a
stale app cannot be shipped by accident.

`tools/build-app.mjs` bundles and minifies the JS and CSS, injects a marker that tells the app the device is
serving it, and gzips everything: about 48 KB of flash. It is a bundle on purpose: the device's web server
handles one connection at a time and a browser opens several in parallel, so ~30 module files would load
slowly and erratically. A page load is five or six requests, and later loads are answered with `304 Not
Modified` (the files carry an ETag).

When developing, `tools/serve-app.mjs` serves `app/` from a different origin than the device. That mode
needs the device address set in Settings, works with the service worker and install on `localhost`, and is
what the mock-device tests use for the cross-origin cases. An https page cannot call the device at all (the
browser blocks it), and the app says so.

## Tests

```sh
npm test                 # unit + integration: app logic, and the app against the mock device over real HTTP
npm run test:e2e         # the real app in headless Chromium against the mock device
```

The end-to-end suite needs Playwright and Chromium (`npm i -g playwright && npx playwright install chromium`).
It runs the app both ways: loaded from the device's own address (the real deployment, including a
non-secure http origin) and from a separate dev origin (real CORS). It covers live readings, losing and
regaining the device, sync and day rollover, charts by pointer and keyboard, settings, export/import round
trips, offline reload from the service worker (dev mode), the https-blocked case, request count and 304
revalidation, and layout at phone and desktop sizes. `SHOTS=/some/dir` also saves screenshots.

What no test here can cover: how the real ESP32 web server behaves under a phone's browser (timing,
concurrent connections, weak Wi-Fi). That needs the hardware.

## How it is put together

```
app/                        the source
  index.html, css/app.css, manifest.webmanifest, sw.js (dev hosting only), icons/
  js/
    main.js          wiring, router, theme; detects "hosted by the device"
    session.js       the one shared view of the device: connection, polling, auto-sync
    api.js           device client; classifies failures (network / timeout / blocked / http / parse)
    sync.js          copies device days into the archive; a day is final once the device date passes it
    store.js         IndexedDB archive (memory fallback if the browser blocks it)
    logs.js tz.js    CSV parsing, summaries, bucketing; Sydney-day / DST-correct time maths
    chart-math.js charts.js   scales and ticks, then the SVG charts
    export.js        CSV / JSON building and parsing
    views/           home, today, trends, settings, export
firmware/statchain/
  app_assets.h       GENERATED from app/ (npm run build:app)
  web.cpp            serves the assets (gzip, ETag/304) and the API
  partitions.csv     flash layout: 2 MB program, ~1.9 MB logs
tools/
  build-app.mjs      bundles app/ and writes app_assets.h
  mock-device/       a stand-in for the device (same API and app serving, seeded data, virtual clock)
  serve-app.mjs      static server for app/ (development)
tests/               unit, integration, e2e
```
