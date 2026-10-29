// Sound level meter on the ICS-43434 I2S microphone.
//
// The mic is only clocked while a measurement is running: every settings.soundIntervalS
// seconds it is started, the first MIC_SETTLE_MS are discarded, then SOUND_WINDOW_MS of audio
// is filtered (A-weighting) and averaged into one Leq reading in dB.
#pragma once
#include <Arduino.h>

// Creates the I2S channel (does not start the clock). Returns false on driver failure.
bool soundBegin();

// Re-reads settings.aWeighting (call after settings change).
void soundApplySettings();

// Call from loop(). Returns true exactly when a new reading is ready in *db.
// *valid is false if the mic returned silence-as-zeros (not wired, or dead).
bool soundUpdate(float* db, bool* valid);

// True while a measurement window is running (loop should not sleep).
bool soundBusy();
