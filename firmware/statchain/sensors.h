// AHT20 (temperature, humidity) + BMP280 (pressure) on I2C, and the battery monitor.
#pragma once
#include "types.h"

// Starts I2C and probes both sensors. Returns true if at least one answered.
bool sensorsBegin();
bool sensorsHaveAht();
bool sensorsHaveBmp();

// Reads whatever is available into r (temp offset from settings applied).
// Fields whose sensor failed are left untouched. Returns true if anything was updated.
bool sensorsRead(Readings& r);

// Battery voltage in mV (already scaled by the divider ratio), median of several samples.
uint16_t batteryReadMv();
// LiPo voltage -> state of charge, 0-100.
uint8_t batteryPercent(uint16_t mv);
