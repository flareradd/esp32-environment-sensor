// State shared between the main loop (statchain.ino) and the web API.
#pragma once
#include "types.h"

struct AppState {
  Readings now;
  DaySummary today;
  bool ahtOk = false, bmpOk = false;
  bool micOk = false;      // last sound window had a plausible signal
  bool fsOk = false;       // flash filesystem mounted
  bool displayDrawn = false;
  time_t lastDisplayEpoch = 0;  // 0 if never drawn, or clock wasn't set at the time
  uint32_t lastDisplayMs = 0;
  uint32_t nextDisplayMs = 0;
};
extern AppState app;

// Asks for an e-ink refresh. Returns 0 if accepted, otherwise the number of seconds
// to wait (the panel is busy, or was refreshed too recently).
uint32_t appRequestDisplayRefresh();
