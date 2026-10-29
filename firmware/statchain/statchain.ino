// Statchain - keychain environment monitor for the ESP32-C3.
//
// Sound level, temperature, humidity, pressure and battery on a 2.13" e-ink display,
// daily logs on flash, and the companion web app + JSON API served over Wi-Fi.
// Pin map: config.h and docs/wiring.md.

#include "config.h"
#include "app.h"
#include "logger.h"
#include "net.h"
#include "screen.h"
#include "sensors.h"
#include "settings.h"
#include "sound.h"
#include "web.h"

AppState app;

static uint32_t nextSensorMs = 0, nextBattMs = 0, nextLogMs = 0;
static bool refreshRequested = false;

// Sound readings gathered since the last log line.
static double accEnergy = 0;
static uint32_t accN = 0;
static float accMin = NAN, accMax = NAN;

static bool due(uint32_t now, uint32_t at) { return (int32_t)(now - at) >= 0; }

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
uint32_t appRequestDisplayRefresh() {
  if (screenBusy() || refreshRequested) return 15;
  if (app.displayDrawn) {
    const uint32_t since = (millis() - app.lastDisplayMs) / 1000;
    if (since < DISPLAY_MIN_GAP_S) return DISPLAY_MIN_GAP_S - since;
  }
  refreshRequested = true;
  return 0;
}

static void drawDisplay() {
  ScreenData d;
  d.now = app.now;
  d.soundMin = app.today.soundMin;
  d.soundMax = app.today.soundMax;
  d.epoch = timeIsValid() ? time(nullptr) : 0;
  d.loudDb = settings.loudDb;
  d.battLowPct = settings.battLowPct;
  if (!screenRequest(d)) return;  // still drawing; try again next pass
  const uint32_t now = millis();
  app.displayDrawn = true;
  app.lastDisplayMs = now;
  app.lastDisplayEpoch = d.epoch;
  app.nextDisplayMs = now + 60000UL * settings.displayIntervalMin;
  refreshRequested = false;
}

static void displayTick(uint32_t now) {
  if (screenBusy()) return;
  if (!app.displayDrawn) {
    // First picture: wait for a first sound reading, and for the clock if Wi-Fi is on its way.
    const bool haveData = !isnan(app.now.tempC) && !isnan(app.now.soundDb);
    if (haveData && (timeIsValid() || now > DISPLAY_FIRST_DRAW_TIMEOUT_MS)) drawDisplay();
  } else if (refreshRequested || due(now, app.nextDisplayMs)) {
    drawDisplay();
  }
}

// ---------------------------------------------------------------------------
// Day handling: "today" summary follows the local calendar day
// ---------------------------------------------------------------------------
static void dayTick(uint32_t now) {
  static uint32_t nextCheckMs = 0;
  if (!due(now, nextCheckMs)) return;
  nextCheckMs = now + 1000;
  if (!timeIsValid()) return;
  char date[9];
  localDateString(time(nullptr), date);
  if (strcmp(date, app.today.date) == 0) return;

  // New day, or the first time the clock is known. After a reboot, pick up where the log left off.
  // (Readings taken in the few seconds before the clock was set are not carried over.)
  if (!loggerLoadDay(date, app.today)) {
    app.today = DaySummary();
    strlcpy(app.today.date, date, sizeof app.today.date);
  }
  loggerPrune(settings.keepDays, date);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
static void logTick(uint32_t now) {
  if (!due(now, nextLogMs) || !timeIsValid()) return;
  nextLogMs = now + 60000UL * settings.logIntervalMin;

  LogRecord r;
  r.epoch = (uint32_t)time(nullptr);
  r.tempC = app.now.tempC;
  r.humidity = app.now.humidity;
  r.pressureHPa = app.now.pressureHPa;
  r.battMv = app.now.battMv;
  if (accN) {
    r.soundAvg = (float)(10.0 * log10(accEnergy / accN));
    r.soundMin = accMin;
    r.soundMax = accMax;
  }
  accEnergy = 0;
  accN = 0;
  accMin = accMax = NAN;

  if (isnan(r.tempC) && isnan(r.soundAvg)) return;  // nothing measured yet
  if (app.fsOk && !loggerAppend(r)) Serial.println("log write failed");
  loggerPrune(settings.keepDays, app.today.date);
}

// ---------------------------------------------------------------------------
static void readBattery() {
  app.now.battMv = batteryReadMv();
  app.now.battPct = batteryPercent(app.now.battMv);
  // Below ~2 V at the pin's divider output nothing is connected (running from USB with no cell).
  app.now.battValid = app.now.battMv > 2000;
}

static void readSensors() {
  if (!sensorsRead(app.now)) return;
  app.today.temp.add(app.now.tempC);
  app.today.hum.add(app.now.humidity);
  app.today.press.add(app.now.pressureHPa);
}

static void onSoundReading(float db, bool valid) {
  app.micOk = valid;
  app.now.soundDb = valid ? db : NAN;
  if (!valid) return;
  app.today.addSound(db);
  accEnergy += pow(10.0, db / 10.0);
  accN++;
  accMin = isnan(accMin) ? db : fminf(accMin, db);
  accMax = isnan(accMax) ? db : fmaxf(accMax, db);
}

void setup() {
  // Take over the display's RST line before anything else: until now GPIO21 is UART0 TX.
  pinMode(PIN_EPD_RST, OUTPUT);
  digitalWrite(PIN_EPD_RST, HIGH);

  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);  // never stall when running on battery with no USB host
  Serial.printf("\nStatchain %s\n", FW_VERSION);

  netBegin();  // first: sets the timezone
  settingsLoad();
  app.fsOk = loggerBegin();
  if (!app.fsOk) Serial.println("flash filesystem failed to mount; logging disabled");

  sensorsBegin();
  app.ahtOk = sensorsHaveAht();
  app.bmpOk = sensorsHaveBmp();
  Serial.printf("AHT20 %s, BMP280 %s\n", app.ahtOk ? "ok" : "MISSING", app.bmpOk ? "ok" : "MISSING");
  readBattery();
  readSensors();

  if (!soundBegin()) Serial.println("microphone (I2S) failed to start");
  screenBegin();
  webBegin();

  const uint32_t now = millis();
  nextSensorMs = now + SENSOR_PERIOD_MS;
  nextBattMs = now + BATT_PERIOD_MS;
  nextLogMs = now + 60000UL * settings.logIntervalMin;
}

void loop() {
  netLoop();
  webLoop();

  float db;
  bool valid;
  if (soundUpdate(&db, &valid)) {
    onSoundReading(db, valid);
    Serial.printf("sound %.1f dB%s | %.1f C  %.0f %%  %.1f hPa | batt %u mV (%u%%)\n", db,
                  valid ? "" : " (no mic signal)", app.now.tempC, app.now.humidity,
                  app.now.pressureHPa, app.now.battMv, app.now.battPct);
  }

  const uint32_t now = millis();
  if (due(now, nextSensorMs)) {
    nextSensorMs = now + SENSOR_PERIOD_MS;
    readSensors();
  }
  if (due(now, nextBattMs)) {
    nextBattMs = now + BATT_PERIOD_MS;
    readBattery();
  }
  dayTick(now);
  logTick(now);
  displayTick(now);

  // While the mic is running the I2S read paces the loop; otherwise give the CPU a rest.
  if (!soundBusy()) delay(5);
}
