# Statchain wiring

Pin map for the ESP32-C3. It works on the SuperMini-style board and on the bare ESP32-C3-12F module
(the 12F's pads are labelled `IO0`…`IO10`, `IO18`, `IO19`, `RXD` = GPIO20, `TXD` = GPIO21).
The single source of truth in code is [`config.h`](../firmware/statchain/config.h).

## Pin table

| GPIO | Connects to | Module pin label | Direction |
|------|-------------|------------------|-----------|
| **0** | I2C **SDA** | AHT20/BMP280 board `SDA` | bidirectional |
| **1** | I2C **SCL** | AHT20/BMP280 board `SCL` | output |
| **2** | E-ink **CS** | WeAct `CS` | output |
| **3** | **Battery** divider midpoint | – | analog in (ADC1) |
| **4** | E-ink **SCK** | WeAct `SCL` | output |
| **5** | Mic **BCLK** | ICS-43434 `SCK` | output |
| **6** | E-ink **MOSI** | WeAct `SDA` | output |
| **7** | Mic **WS** | ICS-43434 `WS` | output |
| **8** | E-ink **DC** | WeAct `D/C` | output |
| **9** | *(free: BOOT button)* | – | – |
| **10** | Mic **DOUT** | ICS-43434 `SD` | input |
| 18 / 19 | USB D− / D+ | USB connector | – |
| **20** (RXD) | E-ink **BUSY** | WeAct `BUSY` | input |
| **21** (TXD) | E-ink **RST** | WeAct `RES` | output |

Power and fixed connections:

| Part | Pin | Goes to |
|------|-----|---------|
| WeAct 2.13" | `3.3V`, `GND` | 3V3, GND |
| ICS-43434 | `3V3`/`VDD`, `GND` | 3V3, GND |
| ICS-43434 | `L/R` | **GND** (left slot; if you tie it to 3V3 set `MIC_ON_RIGHT_SLOT` to `true`) |
| AHT20 + BMP280 board | `VCC`, `GND` | 3V3, GND |
| Battery divider | top / bottom | battery **+** / GND, midpoint to GPIO3 |

```
 LiPo +  ──┬── (to charger / 3V3 regulator input)
           │
          100k
           ├──────── GPIO3        100 nF from GPIO3 to GND (right at the pin)
          100k
           │
 LiPo −  ──┴── GND
```

`BATT_DIVIDER_RATIO` in `config.h` is `2.0` for two equal resistors. Equal 100 kΩ resistors draw about
21 µA at 4.2 V and keep the pin under 2.1 V, inside the ADC's range. The 100 nF capacitor matters:
the ADC input needs it to give stable readings through a high-value divider.

## Why these pins

The ESP32-C3 has only 13 usable GPIOs, and this design needs 12 signals, so the allocation is tight.

* **Battery on GPIO3.** The battery must be on ADC1 (GPIO0–4). ADC2 (GPIO5) can't be used while Wi-Fi is on.
  GPIO2 is a strapping pin, so it isn't used for the high-impedance divider.
* **I2S and SPI on ordinary pins.** The ESP32-C3 routes I2S and SPI to any pin through its GPIO matrix,
  so none of these needs a specific pad.
* **GPIO2 (CS) and GPIO8 (DC) are strapping pins, used as outputs that idle high.** The chip reads
  them only at reset, and the display's inputs are high-impedance, so they shouldn't be pulled low at
  boot. I haven't seen the WeAct module's schematic, so this is the one assumption to check on real
  hardware: if a board won't flash or boot, see "If it won't flash or boot" below. (GPIO8 also drives
  the SuperMini's onboard LED, which will flicker while the display updates.)
* **GPIO20/21 (UART0) go to the display's BUSY and RST.** At power-up the ROM typically prints a boot
  log on GPIO21 for a moment; on a reset line that is harmless, and the firmware takes the pin over as plain
  GPIO at the start of `setup()`. That is also why **USB CDC On Boot must be enabled**: with it off,
  `Serial` would claim these pins and break the display. `config.h` stops the build if it's off.
* **GPIO9 is left free.** It is the BOOT button on most boards, which makes it the natural future
  "refresh / next page" button. Note that on the C3 only GPIO0–5 can wake the chip from *deep* sleep,
  so a button on GPIO9 works while awake or in light sleep but not as a deep-sleep wake source.
* **GPIO18/19 stay on USB.**

## ESP32-C3-12F notes

* The 12F module has no USB-serial chip. **Wire the USB connector's D− to IO18 and D+ to IO19.** The C3's
  built-in USB then gives you flashing and `Serial` with no extra parts, and leaves GPIO20/21 free for the
  display. This is the intended setup.
* If you must flash over UART instead, disconnect the display's BUSY and RST wires (GPIO20/21) first,
  and pull GPIO9 low while resetting to enter the bootloader.
* If the module boot-loops after flashing, try the DIO flash mode:
  `--fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio`.
* The module needs a regulated 3.3 V supply (an LDO with low quiescent current suits a battery). Take the
  battery-divider tap from the battery side, before the regulator.

## If it won't flash or boot

Strapping pins sample at reset. If a freshly wired board refuses to flash or boot, disconnect the display's
CS (GPIO2) and DC (GPIO8) wires and try again. If that fixes it, the display module is pulling one of them low; add a 4.7 kΩ pull-up to 3V3 on that line.

## Pin budget for future parts

Every usable pin except GPIO9 is taken, so most of the future-ideas list needs a plan:

| Idea | Pins | How |
|------|------|-----|
| DS3231 RTC | none | shares I2C (GPIO0/1) |
| VOC / CO₂ sensors | none | share I2C |
| Button | GPIO9 | free |
| Buzzer / LED alert | 1 | needs a pin: use an I2C expander or move to the S3 |
| microSD | 3–4 | shares SPI SCK/MOSI, needs its own CS and MISO; not possible without an expander |
| Wake-on-pickup (motion/light INT) | 1 from GPIO0–5 | none free; the S3 has more RTC pins |

This is the practical case for the ESP32-S3 move already on the list.
