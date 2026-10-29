#include "settings.h"
#include <Preferences.h>

Settings settings;

static const char* NS = "statchain";

static float clampf(float v, float lo, float hi) {
  if (isnan(v)) return lo > 0 ? lo : 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

void settingsClamp(Settings& s) {
  s.soundIntervalS = constrain(s.soundIntervalS, 2, 300);
  s.displayIntervalMin = constrain(s.displayIntervalMin, 5, 1440);
  s.logIntervalMin = constrain(s.logIntervalMin, 1, 60);
  s.keepDays = constrain(s.keepDays, 1, 90);
  s.loudDb = constrain(s.loudDb, 40, 120);
  s.battLowPct = constrain(s.battLowPct, 5, 50);
  s.tempOffsetC = clampf(s.tempOffsetC, -10.0f, 10.0f);
  s.soundCalDb = clampf(s.soundCalDb, -30.0f, 30.0f);
}

void settingsLoad() {
  Preferences p;
  if (!p.begin(NS, true)) {
    // Namespace doesn't exist yet (first boot): keep defaults.
    return;
  }
  Settings s;
  s.soundIntervalS = p.getUShort("sndInt", s.soundIntervalS);
  s.displayIntervalMin = p.getUShort("dispInt", s.displayIntervalMin);
  s.logIntervalMin = p.getUShort("logInt", s.logIntervalMin);
  s.keepDays = p.getUChar("keepDays", s.keepDays);
  s.loudDb = p.getUChar("loudDb", s.loudDb);
  s.battLowPct = p.getUChar("battLow", s.battLowPct);
  s.tempOffsetC = p.getFloat("tempOff", s.tempOffsetC);
  s.soundCalDb = p.getFloat("sndCal", s.soundCalDb);
  s.aWeighting = p.getBool("aWt", s.aWeighting);
  p.end();
  settingsClamp(s);
  settings = s;
}

bool settingsSave() {
  settingsClamp(settings);
  Preferences p;
  if (!p.begin(NS, false)) return false;
  p.putUShort("sndInt", settings.soundIntervalS);
  p.putUShort("dispInt", settings.displayIntervalMin);
  p.putUShort("logInt", settings.logIntervalMin);
  p.putUChar("keepDays", settings.keepDays);
  p.putUChar("loudDb", settings.loudDb);
  p.putUChar("battLow", settings.battLowPct);
  p.putFloat("tempOff", settings.tempOffsetC);
  p.putFloat("sndCal", settings.soundCalDb);
  p.putBool("aWt", settings.aWeighting);
  p.end();
  return true;
}
