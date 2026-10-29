#include "sensors.h"
#include "config.h"
#include "settings.h"
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>

static Adafruit_AHTX0 aht;
static Adafruit_BMP280 bmp(&Wire);
static bool ahtOk = false, bmpOk = false;

bool sensorsBegin() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);  // 100 kHz: slow is fine here and forgiving of keychain-length wiring
  ahtOk = aht.begin(&Wire);
  // Breakouts strap the BMP280 address to 0x76 or 0x77 depending on the SDO pin.
  bmpOk = bmp.begin(0x76) || bmp.begin(0x77);
  if (bmpOk) {
    // Forced mode: one conversion per read, then it sleeps. Keeps self-heating down.
    bmp.setSampling(Adafruit_BMP280::MODE_FORCED, Adafruit_BMP280::SAMPLING_X1,
                    Adafruit_BMP280::SAMPLING_X4, Adafruit_BMP280::FILTER_OFF,
                    Adafruit_BMP280::STANDBY_MS_1);
  }
  return ahtOk || bmpOk;
}

bool sensorsHaveAht() { return ahtOk; }
bool sensorsHaveBmp() { return bmpOk; }

bool sensorsRead(Readings& r) {
  bool any = false;
  if (ahtOk) {
    sensors_event_t hum, temp;
    if (aht.getEvent(&hum, &temp) && !isnan(temp.temperature) && !isnan(hum.relative_humidity)) {
      r.tempC = temp.temperature + settings.tempOffsetC;
      r.humidity = constrain(hum.relative_humidity, 0.0f, 100.0f);
      any = true;
    }
  }
  if (bmpOk && bmp.takeForcedMeasurement()) {
    float p = bmp.readPressure() / 100.0f;  // Pa -> hPa
    if (!isnan(p) && p > 300.0f && p < 1100.0f) {
      r.pressureHPa = p;
      any = true;
    }
  }
  return any;
}

uint16_t batteryReadMv() {
  // Median of 15 reads: Wi-Fi transmit bursts put spikes on the supply and the ADC.
  analogSetPinAttenuation(PIN_BATT_ADC, ADC_11db);
  uint32_t s[15];
  for (auto& v : s) {
    v = analogReadMilliVolts(PIN_BATT_ADC);
    delayMicroseconds(200);
  }
  for (int i = 1; i < 15; i++) {  // insertion sort
    uint32_t k = s[i];
    int j = i - 1;
    while (j >= 0 && s[j] > k) {
      s[j + 1] = s[j];
      j--;
    }
    s[j + 1] = k;
  }
  return (uint16_t)(s[7] * BATT_DIVIDER_RATIO + 0.5f);
}

uint8_t batteryPercent(uint16_t mv) {
  // Typical single-cell LiPo discharge curve under light load: {millivolts, percent}.
  static const uint16_t curve[][2] = {
      {3270, 0},  {3610, 5},  {3690, 10}, {3710, 15}, {3730, 20}, {3750, 25}, {3770, 30},
      {3790, 35}, {3800, 40}, {3820, 45}, {3840, 50}, {3850, 55}, {3870, 60}, {3910, 65},
      {3950, 70}, {3980, 75}, {4020, 80}, {4080, 85}, {4110, 90}, {4150, 95}, {4200, 100}};
  const int n = sizeof(curve) / sizeof(curve[0]);
  if (mv <= curve[0][0]) return 0;
  if (mv >= curve[n - 1][0]) return 100;
  for (int i = 1; i < n; i++) {
    if (mv <= curve[i][0]) {
      float t = (float)(mv - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]);
      return (uint8_t)(curve[i - 1][1] + t * (curve[i][1] - curve[i - 1][1]) + 0.5f);
    }
  }
  return 100;
}
