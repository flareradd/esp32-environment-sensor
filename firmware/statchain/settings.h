// User settings, persisted in flash (NVS) so they survive restarts.
#pragma once
#include <Arduino.h>

struct Settings {
  uint16_t soundIntervalS = 5;      // seconds between sound readings (2-300)
  uint16_t displayIntervalMin = 60; // minutes between automatic e-ink refreshes (5-1440)
  uint16_t logIntervalMin = 5;      // minutes between log lines (1-60)
  uint8_t keepDays = 21;            // days of logs kept on the device (1-90)
  uint8_t loudDb = 80;              // sound at/above this is drawn in red (40-120)
  uint8_t battLowPct = 20;          // battery at/below this is drawn in red (5-50)
  float tempOffsetC = 0.0f;         // added to the temperature (board self-heating), -10..10
  float soundCalDb = 0.0f;          // added to the sound level, -30..30
  bool aWeighting = true;           // A-weighted (dBA) or unweighted
};

extern Settings settings;

void settingsLoad();
bool settingsSave();
void settingsClamp(Settings& s);
