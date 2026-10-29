#include "logger.h"
#include "config.h"
#include <LittleFS.h>
#include <algorithm>
#include <vector>

static const char* DIR = "/d";

bool timeIsValid() { return time(nullptr) >= MIN_VALID_EPOCH; }

void localDateString(time_t t, char out[9]) {
  struct tm tmv;
  localtime_r(&t, &tmv);
  char tmp[32];  // roomy so a nonsense year can't truncate mid-field; we keep the first 8 chars
  snprintf(tmp, sizeof tmp, "%04d%02d%02d", tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday);
  memcpy(out, tmp, 8);
  out[8] = 0;
}

bool loggerBegin() {
  if (!LittleFS.begin(true)) return false;  // true = format on first use / corruption
  if (!LittleFS.exists(DIR)) LittleFS.mkdir(DIR);
  return true;
}

bool loggerPathFor(const char* date, char* buf, size_t len) {
  if (!date || strlen(date) != 8) return false;
  for (int i = 0; i < 8; i++)
    if (date[i] < '0' || date[i] > '9') return false;
  snprintf(buf, len, "%s/%s.csv", DIR, date);
  return true;
}

// Appends "v" with one decimal, or nothing if v is NaN.
static void putField(char*& p, const char* end, float v) {
  if (!isnan(v)) p += snprintf(p, end - p, "%.1f", v);
}

bool loggerAppend(const LogRecord& r) {
  char date[9], path[40];
  localDateString((time_t)r.epoch, date);
  if (!loggerPathFor(date, path, sizeof(path))) return false;

  char line[96], *p = line;
  const char* end = line + sizeof(line) - 2;
  p += snprintf(p, end - p, "%lu,", (unsigned long)r.epoch);
  putField(p, end, r.tempC);
  *p++ = ',';
  putField(p, end, r.humidity);
  *p++ = ',';
  putField(p, end, r.pressureHPa);
  *p++ = ',';
  putField(p, end, r.soundAvg);
  *p++ = ',';
  putField(p, end, r.soundMin);
  *p++ = ',';
  putField(p, end, r.soundMax);
  p += snprintf(p, end - p, ",%u\n", (unsigned)r.battMv);

  File f = LittleFS.open(path, FILE_APPEND);
  if (!f) return false;
  size_t n = f.write((const uint8_t*)line, p - line);
  f.close();
  return n == (size_t)(p - line);
}

// Splits `line` in place on commas into up to `max` fields; empty fields become NAN.
static int parseFields(char* line, float* out, int max) {
  int n = 0;
  char* p = line;
  while (n < max) {
    char* comma = strchr(p, ',');
    if (comma) *comma = 0;
    out[n++] = (*p && *p != '\n' && *p != '\r') ? strtof(p, nullptr) : NAN;
    if (!comma) break;
    p = comma + 1;
  }
  return n;
}

bool loggerLoadDay(const char* date, DaySummary& out) {
  char path[40];
  if (!loggerPathFor(date, path, sizeof(path))) return false;
  File f = LittleFS.open(path, FILE_READ);
  if (!f) return false;

  out = DaySummary();
  strlcpy(out.date, date, sizeof(out.date));
  char line[96];
  while (f.available()) {
    size_t len = f.readBytesUntil('\n', line, sizeof(line) - 1);
    line[len] = 0;
    float v[8];
    if (parseFields(line, v, 8) < 7) continue;  // truncated line from a power cut
    out.temp.add(v[1]);
    out.hum.add(v[2]);
    out.press.add(v[3]);
    // Min/max of the interval stand in for the readings that produced them; the
    // interval average (an energy mean) represents the rest.
    out.addSound(v[4]);
    if (!isnan(v[5])) out.soundMin = isnan(out.soundMin) ? v[5] : fminf(out.soundMin, v[5]);
    if (!isnan(v[6])) out.soundMax = isnan(out.soundMax) ? v[6] : fmaxf(out.soundMax, v[6]);
  }
  f.close();
  return true;
}

static std::vector<String> listDays() {
  std::vector<String> days;
  File dir = LittleFS.open(DIR);
  if (!dir || !dir.isDirectory()) return days;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String name = f.name();  // basename, e.g. "20261028.csv"
    int slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.substring(slash + 1);
    if (name.length() == 12 && name.endsWith(".csv")) days.push_back(name.substring(0, 8));
  }
  std::sort(days.begin(), days.end());  // YYYYMMDD sorts chronologically
  return days;
}

void loggerForEachDay(const std::function<void(const char*)>& fn) {
  for (auto& d : listDays()) fn(d.c_str());
}

static void removeDay(const String& day) {
  char path[40];
  if (loggerPathFor(day.c_str(), path, sizeof(path))) LittleFS.remove(path);
}

void loggerPrune(uint8_t keepDays, const char* today) {
  std::vector<String> days = listDays();
  // Oldest first. Keep the newest `keepDays` (today counts as one).
  size_t excess = days.size() > keepDays ? days.size() - keepDays : 0;
  size_t i = 0;
  for (; i < excess; i++)
    if (days[i] != today) removeDay(days[i]);
  for (; i < days.size() && loggerFreeBytes() < LOG_MIN_FREE_BYTES; i++)
    if (days[i] != today) removeDay(days[i]);
}

size_t loggerFreeBytes() { return LittleFS.totalBytes() - LittleFS.usedBytes(); }
size_t loggerTotalBytes() { return LittleFS.totalBytes(); }
