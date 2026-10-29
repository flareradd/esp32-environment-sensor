// "Your Environment" page on the 2.13" black/white/red e-ink panel (GxEPD2, SSD1680).
//
// A full refresh takes ~15 s, so drawing runs in its own task and the rest of the
// firmware keeps going. Red is used only as a warning colour (loud sound, low battery).
#pragma once
#include <Arduino.h>
#include "types.h"

struct ScreenData {
  Readings now;
  float soundMin = NAN;  // today's range, from DaySummary
  float soundMax = NAN;
  time_t epoch = 0;      // 0 = clock not set
  uint8_t loudDb = 80;
  uint8_t battLowPct = 20;
};

void screenBegin();
// Hands a snapshot to the drawing task. Returns false if a refresh is already running.
bool screenRequest(const ScreenData& data);
bool screenBusy();
