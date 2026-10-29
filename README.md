# Statchain

A keychain-sized environment monitor on an ESP32-C3. It measures sound level, temperature, humidity,
pressure and battery, shows them on a 2.13" e-ink screen, logs them to flash, and serves a small web
dashboard and JSON API over Wi-Fi for a companion app.

**Status:** firmware v0.1. It compiles cleanly and its logic is tested on a PC (see
[Verification](#verification)), but **it has not been run on real hardware yet**. Expect some bring-up work.

## Hardware

| Part | Notes |
|------|-------|
| ESP32-C3 | SuperMini-style board, or the bare ESP32-C3-12F module |
| ICS-43434 | I2S MEMS microphone |
| AHT20 + BMP280 breakout | temperature, humidity, pressure on I2C |
| WeAct 2.13" black/white/red e-ink | SSD1680, 250×122 |
| Single-cell LiPo | with a 2 × 100 kΩ divider to GPIO3 |

**Wiring and the full pin map: [docs/wiring.md](docs/wiring.md).** In short:

| Function | GPIO |
|----------|------|
| I2C SDA / SCL | 0 / 1 |
| E-ink CS / SCK / MOSI / DC / RST / BUSY | 2 / 4 / 6 / 8 / 21 / 20 |
| Mic BCLK / WS / DOUT | 5 / 7 / 10 |
| Battery ADC | 3 |
| Free (BOOT button) | 9 |

## Build and flash

You need `arduino-cli` (or the Arduino IDE with the same settings). Tested with ESP32 core 3.3.12.

```sh
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli lib install GxEPD2 "Adafruit GFX Library" "Adafruit AHTX0" "Adafruit BMP280 Library"

cd firmware/statchain
cp secrets.example.h secrets.h        # then put your Wi-Fi name and password in it
arduino-cli compile                   # board and options come from sketch.yaml
arduino-cli upload -p /dev/ttyACM0
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

**USB CDC On Boot must be enabled** (the build fails with a message if it isn't). In the Arduino IDE that is
*Tools → USB CDC On Boot → Enabled*. The reason is in the wiring doc: GPIO20/21 are used by the display.

Libraries used in the tested build: GxEPD2 1.6.9, Adafruit GFX 1.13.0, Adafruit AHTX0 2.0.6,
Adafruit BMP280 3.0.0 (plus their dependencies BusIO 1.17.4 and Unified Sensor 1.1.15).

The sketch uses about 95 % of the default 1.25 MB app partition; almost all of that is the Wi-Fi/mDNS/web
stack. It's fine as is, but adding Bluetooth or OTA updates will need a different partition scheme.

## What it does

* **Sound:** every `soundIntervalS` seconds (default 5, adjustable 2–300) the mic is started, 150 ms is
  discarded while it settles, then 1 s is measured and A-weighted into one dB reading. The I2S clock is
  stopped between readings.
* **Environment:** temperature, humidity and pressure every 30 s. Pressure is station pressure, not
  sea-level adjusted.
* **E-ink page:** "Your Environment": temperature, humidity and pressure in three columns, a sound row
  with the current level and today's min/max, and a footer with battery and the time of the refresh.
  Red is used only as a warning colour (sound at or above `loudDb`, battery at or below `battLowPct`).
  It refreshes at boot, then every `displayIntervalMin` minutes (default 60) or on request. Requests are
  limited to one per 3 minutes to protect the panel.
* **Logging:** one CSV line per `logIntervalMin` minutes (default 5) in a file per local day on the
  device's flash, keeping `keepDays` days (default 21) and dropping the oldest days if flash runs low.
  Today's summary is rebuilt from the log after a restart. Columns: `epoch,tempC,humidity,pressureHPa,soundAvg,soundMin,soundMax,battMv`; an empty field means no reading.
* **Settings** are saved to flash and survive restarts.
* **Wi-Fi and time:** joins the network from `secrets.h`, syncs the clock over NTP in Sydney time
  (`AEST-10AEDT`), and answers at `http://statchain.local`. If it can't join within 30 s it starts its
  own hotspot `Statchain-XXXX` (password `statchain`, or `AP_PASS` from `secrets.h`) so the dashboard
  still works away from home. With no internet the phone can set the clock via `POST /api/time`.

## Web dashboard and API

Open `http://statchain.local` (or the IP shown in the serial log) for the dashboard: live readings,
a refresh button, and the settings.

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/state` | latest readings and device status |
| GET | `/api/today` | today's min / max / mean for each reading |
| GET | `/api/days` | logged days and flash usage |
| GET | `/api/log?date=YYYYMMDD` | that day's CSV |
| GET / POST | `/api/settings` | settings; POST takes any subset as form fields |
| POST | `/api/refresh` | redraw the e-ink display (429 with `retryInS` if too soon) |
| POST | `/api/time` | `epoch=<unix seconds>`; only accepted while the clock isn't set |

There is **no authentication**: anyone on your network (or on the hotspot) can change settings. That is
fine for a prototype at home; add a token before using it anywhere shared. CORS is open so the
companion app can call it from another origin.

## Sound readings are an estimate

Level is computed from the mic's datasheet sensitivity (−26 dBFS at 94 dB SPL, ±1 dB) with an A-weighting
filter. That is uncalibrated: the enclosure, the mic port and the individual part all shift it, and the mic's
noise floor is around 30 dBA, so quiet rooms read high. Use the `soundCalDb` setting to trim it against a
reference meter. The constants are in `config.h`. Self-heating from the ESP32 and Wi-Fi will also make
temperature read high; `tempOffsetC` compensates.

## Verification

Done in the development sandbox, without hardware:

* The sketch compiles for `esp32:esp32:esp32c3` with no warnings from project code.
* **A-weighting filter:** checked against IEC 61672 reference values: within 0.15 dB up to 4 kHz and 0.6 dB at
  8 kHz (error grows above 10 kHz from the filter design). A 1 kHz tone at a known level gives the expected
  dB SPL, and the float32 filter matches a double-precision run.
* **Logger:** CSV round trip, power-cut truncated lines, missing fields, Sydney daylight-saving
  boundaries, age and free-space pruning, and that today's file is never deleted. The checks fail when the
  protection is removed.
* **E-ink layout:** the real drawing code was rendered on a PC for normal, warning, worst-case-width and
  no-data states.
* **Dashboard:** exercised in headless Chromium against a mock of the API.

Not verified, because it needs the hardware: I2S capture from the mic, the e-ink panel driver and its
timing, the Wi-Fi/NTP/mDNS path, battery ADC accuracy, and the strapping-pin assumptions in the wiring doc.

## Layout

```
firmware/statchain/   the Arduino sketch
  config.h            pin map and constants
  statchain.ino       setup/loop and scheduling
  sound.*  dsp.h      I2S microphone and the level/A-weighting maths
  sensors.*           AHT20, BMP280, battery
  screen.*  layout.*  e-ink task and the page layout
  logger.*            daily CSV logs on LittleFS
  settings.*          persistent settings
  net.*  web.*        Wi-Fi/NTP/mDNS, HTTP server and API
docs/wiring.md        pin map and wiring
```
