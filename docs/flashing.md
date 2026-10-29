# Flashing the Statchain firmware

> **Honest status:** the firmware compiles cleanly from a fresh checkout, the image headers and partition
> table check out, and the app inside it is tested. **It has not been run on a real board yet.** The first flash
> is the first real test, so read "What you should see" and "If something is wrong" below.

You need an **ESP32-C3** board (a SuperMini-style board, or the ESP32-C3-12F module with USB wired to IO18/IO19,
see [wiring](wiring.md)) and a USB cable **that carries data** (many cables are charge-only; if the board
never shows up as a port, try another cable). You can flash a bare board with nothing else connected: the
firmware copes with missing parts. Wire things up before judging how it behaves.

There are two ways. Pick one.

## A. Build and flash with arduino-cli

Best if you might change anything. One tool, nothing to install by hand: the ESP32 core and libraries are
pinned in `firmware/statchain/sketch.yaml` and download on first use.

1. Install [arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/).
2. Get the code and (optionally) your Wi-Fi details in:

   ```sh
   git clone https://github.com/flareradd/esp32-environment-sensor.git
   cd esp32-environment-sensor/firmware/statchain
   cp secrets.example.h secrets.h      # then edit it: WIFI_SSID and WIFI_PASS
   ```

   Without `secrets.h` the device starts as a hotspot instead (see "First boot").
3. Build. The first time this downloads about 1.8 GB (6 GB on disk) and takes several minutes:

   ```sh
   arduino-cli compile
   ```

4. Plug the board in and find its port, then upload:

   ```sh
   arduino-cli board list                  # e.g. /dev/ttyACM0, COM5, /dev/cu.usbmodem1101
   arduino-cli upload -p <port>
   ```

   If it cannot connect, put the board in bootloader mode first (below).
5. Watch it start:

   ```sh
   arduino-cli monitor -p <port> -c baudrate=115200
   ```

   Open the monitor, then press the board's RESET button: the USB serial port only appears after boot, so
   a monitor opened late misses the start-up messages.

**Arduino IDE instead?** Board "ESP32C3 Dev Module", then Tools: *USB CDC On Boot: Enabled* (required),
*Flash Size: 4MB*, *Partition Scheme: No OTA (2MB APP/2MB SPIFFS)* (the sketch's `partitions.csv` sets this
anyway). Libraries, at these versions: GxEPD2 1.6.9, Adafruit GFX Library 1.13.0, Adafruit BusIO 1.17.4,
Adafruit Unified Sensor 1.1.15, Adafruit AHTX0 2.0.6, Adafruit BMP280 Library 3.0.0, with ESP32 core 3.3.12.

## B. Flash a ready-made image (no toolchain)

`node tools/package-firmware.mjs` builds the firmware (it needs arduino-cli, as above) and writes images into
`dist/` along with checksums and a `FLASHING.txt` holding the exact commands. Or use an image someone built
for you. There are two:

| File | Address | Use |
|------|---------|-----|
| `statchain-vX-esp32c3-full.bin` | `0x0` | **First flash.** Bootloader, partition table and program. Also resets settings. |
| `statchain-vX-esp32c3-app-only.bin` | `0x10000` | **Updates.** Just the program; keeps your settings and the logs. |

Flash with [esptool](https://docs.espressif.com/projects/esptool/en/latest/esp32c3/esptool/flashing-firmware.html)
(`pip install esptool`):

```sh
esptool --chip esp32c3 --port <port> --baud 460800 write-flash 0x0 statchain-vX-esp32c3-full.bin
```

or in a browser (Chrome or Edge) with Espressif's flasher, <https://espressif.github.io/esptool-js/>:
connect, choose the file, set the address to `0x0`, program.

An image made **without** a `secrets.h` has no Wi-Fi details in it, so it starts as a hotspot. An image made
**with** one contains your Wi-Fi password: the file name ends in `-wifi`; do not share it.

## Bootloader mode (if the board does not show up or upload fails)

Hold the **BOOT** button, tap **RESET**, release BOOT, then try again (or plug the USB cable in while
holding BOOT). The board then appears as a serial port. On Linux you may need to be in the `dialout` group.
On a bare ESP32-C3-12F, the BOOT function is GPIO9 pulled low at reset.

## First boot: what you should see

| When | Where | What |
|------|-------|------|
| 0 s | serial | `Statchain 0.1.0`, then `AHT20 ok, BMP280 ok` (or `MISSING` for one that isn't wired or answering) |
| ~2 s, then every 5 s | serial | `sound 47.3 dB \| 24.1 C  51 %  1007.1 hPa \| batt 4003 mV (78%)` |
| up to ~30 s | serial | with Wi-Fi details: `Wi-Fi connected. Open http://192.168.x.x`; without, or if it can't join: `Hotspot "Statchain-1A2B" is up ...` |
| every 30 s | serial | `[net] open http://...` (repeated so you can still find it if you missed the start) |
| within ~30 s | e-ink | once the clock is set (seconds, with Wi-Fi), or after 30 s regardless: the screen redraws (about 15 s, flashing black/white/red) and shows readings, with `--` for anything missing |

Then open the address on a phone or computer on the same network. With Wi-Fi: `http://statchain.local`, or the
IP from the serial log (some Android phones cannot find `.local` names). As a hotspot: join `Statchain-XXXX`
(password `statchain` unless you set `AP_PASS`), then open `http://192.168.4.1`. A hotspot has no internet, so
the device cannot set its clock: the app offers to set it from your phone, and logging starts then.

## Updating later

Rebuild and `arduino-cli upload`, or flash the `app-only` image at `0x10000`. Both keep your settings and logs.
(Changing the flash layout in `partitions.csv` moves log storage, which starts empty again.)

To start completely clean: `esptool --chip esp32c3 --port <port> erase-flash`, then flash the `full` image.

## If something is wrong

| What you see | Likely cause and what to try |
|--------------|------------------------------|
| No serial port appears | Charge-only USB cable; or put the board in bootloader mode. Windows 10 and later normally needs no driver for the ESP32-C3's built-in USB; older Windows may |
| `Failed to connect` / timed out | Bootloader mode (above); lower the speed: `--baud 115200` |
| Uploads fine but nothing in the serial monitor | The port re-appears after reset: close and reopen the monitor, then press RESET. IDE users: *USB CDC On Boot* must be Enabled |
| Boots over and over (`rst:` lines repeating) | Note the reason code. First, disconnect the display's CS and DC wires (GPIO2, GPIO8) and reset: those are strapping pins ([wiring](wiring.md#if-it-wont-flash-or-boot)). Then `erase-flash` and reflash |
| Screen stays blank | It draws about 30 s after boot and takes ~15 s. If it never does: check the display wiring (BUSY on GPIO20, RST on GPIO21) and the serial log for `Busy Timeout!` |
| `AHT20 MISSING` / `BMP280 MISSING` | Check SDA/SCL (GPIO0/1), 3V3 and ground, and that the board has its pull-up resistors |
| Sound reads `--` or `no mic signal` | Check the microphone wiring (BCLK GPIO5, WS GPIO7, data GPIO10) and that its L/R pin goes to ground |
| Can't find `statchain.local` | Use the IP address from the serial log; some Android phones cannot resolve `.local` |
| Wi-Fi drops or won't connect (SuperMini clones) | Uncomment `WIFI_TX_POWER` in `config.h`: some boards connect better at reduced power |
| Logs are empty after an update | Expected if the flash layout changed |

If you hit something not listed, the serial log is the first thing to look at: copy it before resetting.
