// Shared data types.
#pragma once
#include <Arduino.h>
#include <math.h>

// Latest values. NAN / false mean "no valid reading yet".
struct Readings {
  float tempC = NAN;
  float humidity = NAN;
  float pressureHPa = NAN;
  float soundDb = NAN;  // last 1 s Leq, dB (A) unless weighting is switched off
  uint16_t battMv = 0;
  uint8_t battPct = 0;
  bool battValid = false;
};

// Running min / max / mean of one quantity.
struct Stat {
  float minV = NAN, maxV = NAN;
  double sum = 0;
  uint32_t n = 0;

  void add(float v) {
    if (isnan(v)) return;
    minV = isnan(minV) ? v : fminf(minV, v);
    maxV = isnan(maxV) ? v : fmaxf(maxV, v);
    sum += v;
    n++;
  }
  float mean() const { return n ? (float)(sum / n) : NAN; }
};

// Everything the "Today" view needs, for one local calendar day.
struct DaySummary {
  char date[9] = "";  // YYYYMMDD, local time
  Stat temp, hum, press;
  // Sound is averaged on energy, not on the dB values.
  float soundMin = NAN, soundMax = NAN;
  double soundEnergy = 0;  // sum of 10^(dB/10)
  uint32_t soundN = 0;

  void addSound(float db) {
    if (isnan(db)) return;
    soundMin = isnan(soundMin) ? db : fminf(soundMin, db);
    soundMax = isnan(soundMax) ? db : fmaxf(soundMax, db);
    soundEnergy += pow(10.0, db / 10.0);
    soundN++;
  }
  float soundMean() const { return soundN ? (float)(10.0 * log10(soundEnergy / soundN)) : NAN; }
};

// One line of the daily log. Sound fields summarise the 1 s readings in the interval.
struct LogRecord {
  uint32_t epoch = 0;
  float tempC = NAN, humidity = NAN, pressureHPa = NAN;
  float soundAvg = NAN, soundMin = NAN, soundMax = NAN;
  uint16_t battMv = 0;
};
