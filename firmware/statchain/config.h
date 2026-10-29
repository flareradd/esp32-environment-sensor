// Statchain - compile-time configuration: pin map, hardware constants, defaults.
#pragma once
#include <Arduino.h>

#define FW_VERSION "0.1.0"

#if !defined(CONFIG_IDF_TARGET_ESP32C3)
#error "Statchain targets the ESP32-C3 (pin map below). Select an ESP32-C3 board."
#endif

// GPIO20/21 are UART0 and are used for the display here, so Serial must be the
// native USB port. Arduino IDE: Tools > USB CDC On Boot > Enabled.
// arduino-cli: --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc
#if !ARDUINO_USB_CDC_ON_BOOT
#error "Enable 'USB CDC On Boot': GPIO20/21 (UART0) are wired to the e-ink display, so Serial must use USB."
#endif

#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""  // empty -> device runs its own hotspot only
#define WIFI_PASS ""
#endif
#ifndef AP_PASS
#define AP_PASS "statchain"  // fallback hotspot password (WPA2 needs >= 8 chars)
#endif

// ---------------------------------------------------------------------------
// Pin map (GPIO numbers). Full rationale in docs/wiring.md.
// ---------------------------------------------------------------------------
// E-ink display (WeAct 2.13", SSD1680) on SPI. Write-only, so no MISO.
constexpr int PIN_EPD_SCK = 4;
constexpr int PIN_EPD_MOSI = 6;   // panel pin labelled SDA / DIN
constexpr int PIN_EPD_CS = 2;     // strapping pin: fine, CS idles high
constexpr int PIN_EPD_DC = 8;     // strapping pin (+ onboard LED on the SuperMini)
constexpr int PIN_EPD_RST = 21;   // U0TXD: ROM boot log toggles it for a moment, harmless for a reset line
constexpr int PIN_EPD_BUSY = 20;  // U0RXD: input only
// AHT20 + BMP280 breakout, shared I2C bus (both boards carry their own pull-ups).
constexpr int PIN_I2C_SDA = 0;
constexpr int PIN_I2C_SCL = 1;
// ICS-43434 MEMS microphone on I2S (receive only).
constexpr int PIN_I2S_BCLK = 5;  // mic pin SCK
constexpr int PIN_I2S_WS = 7;    // mic pin WS
constexpr int PIN_I2S_DIN = 10;  // mic pin SD
// Battery divider midpoint. Must be ADC1 (GPIO0-4): ADC2 is unusable with Wi-Fi.
constexpr int PIN_BATT_ADC = 3;
// GPIO9 = BOOT button, left free (future user button). GPIO18/19 = USB.

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------
constexpr uint32_t MIC_SAMPLE_RATE = 48000;  // ICS-43434: 23-51.6 kHz in high-performance mode
constexpr bool MIC_ON_RIGHT_SLOT = false;    // ICS-43434 L/R pin: GND = left slot, VDD = right slot
// Nominal datasheet figures. The real mic is +/-1 dB and the enclosure changes things, so
// this is an estimate; use the "soundCalDb" setting to trim it against a reference meter.
constexpr float MIC_SENSITIVITY_DBFS = -26.0f;  // output level at the reference SPL
constexpr float MIC_REFERENCE_SPL_DB = 94.0f;
constexpr uint32_t SOUND_WINDOW_MS = 1000;  // one reading = Leq over this long
constexpr uint32_t MIC_SETTLE_MS = 150;     // discarded after the clock starts (mic wake + filter settling)

// ---------------------------------------------------------------------------
// Battery (single-cell LiPo through a resistor divider into PIN_BATT_ADC)
// ---------------------------------------------------------------------------
constexpr float BATT_DIVIDER_RATIO = 2.0f;  // (R1+R2)/R2, e.g. 100k + 100k
constexpr uint32_t BATT_PERIOD_MS = 60UL * 1000;

// ---------------------------------------------------------------------------
// Sensors, display, storage
// ---------------------------------------------------------------------------
constexpr uint32_t SENSOR_PERIOD_MS = 30UL * 1000;
constexpr uint8_t EPD_ROTATION = 1;  // 1 = landscape; 3 = landscape, flipped
constexpr uint32_t DISPLAY_MIN_GAP_S = 180;  // panel makers advise >= 3 min between refreshes
constexpr uint32_t DISPLAY_FIRST_DRAW_TIMEOUT_MS = 30UL * 1000;  // wait this long for NTP before the first draw
constexpr size_t LOG_MIN_FREE_BYTES = 64 * 1024;  // oldest days are dropped below this

// ---------------------------------------------------------------------------
// Network and time
// ---------------------------------------------------------------------------
#define HOSTNAME "statchain"  // http://statchain.local
#define TZ_SYDNEY "AEST-10AEDT,M10.1.0,M4.1.0/3"
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
constexpr uint32_t AP_FALLBACK_AFTER_MS = 30UL * 1000;  // no Wi-Fi this long -> start own hotspot
constexpr time_t MIN_VALID_EPOCH = 1735689600;           // 2025-01-01: anything earlier means "clock not set"
// Some ESP32-C3 SuperMini clones connect better with reduced TX power. Uncomment if Wi-Fi is flaky:
// #define WIFI_TX_POWER WIFI_POWER_8_5dBm
