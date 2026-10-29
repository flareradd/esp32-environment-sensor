// Daily CSV logs on the device's flash (LittleFS), one file per local day: /d/YYYYMMDD.csv
//
// Columns: epoch,tempC,humidity,pressureHPa,soundAvg,soundMin,soundMax,battMv
// An empty field means "no reading". Sound columns are dB over the logging interval
// (soundAvg is an energy average of the 1 s readings).
#pragma once
#include <Arduino.h>
#include <functional>
#include "types.h"

bool loggerBegin();

bool timeIsValid();                          // true once NTP has set the clock
void localDateString(time_t t, char out[9]); // "YYYYMMDD" in local (Sydney) time

// Appends a record to the file for the day that contains rec.epoch.
bool loggerAppend(const LogRecord& rec);

// Rebuilds a day's summary from its file. False if the day has no log.
bool loggerLoadDay(const char* date, DaySummary& out);

// Calls fn(date) for each logged day, oldest first.
void loggerForEachDay(const std::function<void(const char*)>& fn);

// Path for a day's file into buf. Returns false if date isn't 8 digits.
bool loggerPathFor(const char* date, char* buf, size_t len);

// Deletes days beyond keepDays, then the oldest days while flash is nearly full.
// Never deletes `today`.
void loggerPrune(uint8_t keepDays, const char* today);

size_t loggerFreeBytes();
size_t loggerTotalBytes();
