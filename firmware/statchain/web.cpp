#include "web.h"
#include "app.h"
#include "config.h"
#include "app_assets.h"
#include "logger.h"
#include "net.h"
#include "settings.h"
#include "sound.h"
#include "sensors.h"
#include <LittleFS.h>
#include <WebServer.h>
#include <sys/time.h>

static WebServer server(80);

// ---------------------------------------------------------------------------
// Tiny JSON writer. NaN becomes null. Keys and string values are ours (never user text),
// so no escaping is needed.
// ---------------------------------------------------------------------------
class Json {
 public:
  Json() { s_.reserve(640); s_ = "{"; }
  Json& num(const char* k, float v, int dec = 1) {
    key(k);
    if (isnan(v)) s_ += "null";
    else s_ += String(v, dec);
    return *this;
  }
  Json& integer(const char* k, long v) { key(k); s_ += v; return *this; }
  Json& boolean(const char* k, bool v) { key(k); s_ += v ? "true" : "false"; return *this; }
  Json& str(const char* k, const char* v) { key(k); s_ += '"'; s_ += v; s_ += '"'; return *this; }
  Json& obj(const char* k, const Json& j) { key(k); s_ += j.done(); return *this; }
  String done() const { return s_ + "}"; }

 private:
  void key(const char* k) {
    if (s_.length() > 1) s_ += ',';
    s_ += '"'; s_ += k; s_ += "\":";
  }
  String s_;
};

static Json statJson(float mn, float mx, float avg) {
  Json j;
  j.num("min", mn).num("max", mx).num("avg", avg);
  return j;
}

// ---------------------------------------------------------------------------
static void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
}

static void sendJson(const Json& j, int code = 200) {
  cors();
  server.send(code, "application/json", j.done());
}

// ---------------------------------------------------------------------------
// The companion app, served from flash. The files are generated from app/ by tools/build-app.mjs
// (gzipped, a handful of them so a page load is only a few requests).
// ---------------------------------------------------------------------------
static const AppAsset* findAsset(const String& uri) {
  const char* want = (uri == "/") ? "/index.html" : uri.c_str();
  for (size_t i = 0; i < APP_ASSET_COUNT; i++) {
    if (strcmp(APP_ASSETS[i].path, want) == 0) return &APP_ASSETS[i];
  }
  return nullptr;
}

// Returns true if `uri` is part of the app and the reply has been sent.
static bool serveAsset(const String& uri) {
  const AppAsset* a = findAsset(uri);
  if (!a) return false;
  server.sendHeader("ETag", a->etag);
  server.sendHeader("Cache-Control", "no-cache");  // revalidate every time: a 304 costs almost nothing
  if (server.hasHeader("If-None-Match") && server.header("If-None-Match") == a->etag) {
    server.send(304);
    return true;
  }
  if (a->gzip) server.sendHeader("Content-Encoding", "gzip");
  server.send_P(200, a->mime, (PGM_P)a->data, a->len);
  return true;
}

static void handleState() {
  const time_t t = time(nullptr);
  char local[24] = "";
  if (timeIsValid()) {
    struct tm tmv;
    localtime_r(&t, &tmv);
    strftime(local, sizeof local, "%Y-%m-%d %H:%M:%S", &tmv);
  }
  Json j;
  j.str("fw", FW_VERSION)
      .integer("epoch", timeIsValid() ? (long)t : 0)
      .str("local", local[0] ? local : "")
      .boolean("timeValid", timeIsValid())
      .num("tempC", app.now.tempC)
      .num("humidity", app.now.humidity)
      .num("pressureHPa", app.now.pressureHPa)
      .num("soundDb", app.now.soundDb)
      .num("soundMin", app.today.soundMin)
      .num("soundMax", app.today.soundMax)
      .boolean("aWeighting", settings.aWeighting)
      .integer("loudDb", settings.loudDb)
      .boolean("battValid", app.now.battValid)
      .integer("battMv", app.now.battMv)
      .integer("battPct", app.now.battPct)
      .integer("battLowPct", settings.battLowPct)
      .str("ip", netIp().c_str())
      .integer("rssi", netRssi())
      .boolean("hotspot", netApActive())
      .integer("uptimeS", millis() / 1000)
      .integer("freeHeap", ESP.getFreeHeap());
  Json disp;
  disp.boolean("drawn", app.displayDrawn)
      .integer("lastEpoch", (long)app.lastDisplayEpoch)
      .integer("nextInS", app.displayDrawn ? (long)max<int32_t>(0, (int32_t)(app.nextDisplayMs - millis()) / 1000) : 0);
  j.obj("display", disp);
  Json hw;
  hw.boolean("aht20", app.ahtOk).boolean("bmp280", app.bmpOk).boolean("mic", app.micOk).boolean("flash", app.fsOk);
  j.obj("sensors", hw);
  sendJson(j);
}

static void handleToday() {
  const DaySummary& d = app.today;
  Json j;
  j.str("date", d.date)
      .obj("temperature", statJson(d.temp.minV, d.temp.maxV, d.temp.mean()))
      .obj("humidity", statJson(d.hum.minV, d.hum.maxV, d.hum.mean()))
      .obj("pressure", statJson(d.press.minV, d.press.maxV, d.press.mean()))
      .obj("sound", statJson(d.soundMin, d.soundMax, d.soundMean()))
      .integer("soundReadings", d.soundN);
  sendJson(j);
}

static void handleDays() {
  String days = "[";
  loggerForEachDay([&](const char* d) {
    if (days.length() > 1) days += ',';
    days += '"'; days += d; days += '"';
  });
  days += ']';
  cors();
  String body = "{\"days\":" + days + ",\"today\":\"" + app.today.date + "\",\"freeBytes\":" +
                String((unsigned long)loggerFreeBytes()) + ",\"totalBytes\":" +
                String((unsigned long)loggerTotalBytes()) + "}";
  server.send(200, "application/json", body);
}

static void handleLog() {
  char path[40];
  if (!loggerPathFor(server.arg("date").c_str(), path, sizeof path)) {
    sendJson(Json().str("error", "date must be YYYYMMDD"), 400);
    return;
  }
  File f = LittleFS.open(path, FILE_READ);
  if (!f) {
    sendJson(Json().str("error", "no log for that day"), 404);
    return;
  }
  cors();
  server.streamFile(f, "text/csv");
  f.close();
}

static Json settingsJson() {
  Json j;
  j.integer("soundIntervalS", settings.soundIntervalS)
      .integer("displayIntervalMin", settings.displayIntervalMin)
      .integer("logIntervalMin", settings.logIntervalMin)
      .integer("keepDays", settings.keepDays)
      .integer("loudDb", settings.loudDb)
      .integer("battLowPct", settings.battLowPct)
      .num("tempOffsetC", settings.tempOffsetC, 2)
      .num("soundCalDb", settings.soundCalDb, 2)
      .boolean("aWeighting", settings.aWeighting);
  return j;
}

static void handleSettingsGet() { sendJson(settingsJson()); }

// Integer form field, clamped to the field's range *before* it is narrowed to the
// settings struct's smaller types (a bare toInt() into a uint8_t would wrap 300 to 44).
static long argInt(const char* name, long lo, long hi, long current) {
  if (!server.hasArg(name)) return current;
  long v = server.arg(name).toInt();
  return v < lo ? lo : (v > hi ? hi : v);
}

static void handleSettingsPost() {
  Settings s = settings;
  s.soundIntervalS = argInt("soundIntervalS", 2, 300, s.soundIntervalS);
  s.displayIntervalMin = argInt("displayIntervalMin", 5, 1440, s.displayIntervalMin);
  s.logIntervalMin = argInt("logIntervalMin", 1, 60, s.logIntervalMin);
  s.keepDays = argInt("keepDays", 1, 90, s.keepDays);
  s.loudDb = argInt("loudDb", 40, 120, s.loudDb);
  s.battLowPct = argInt("battLowPct", 5, 50, s.battLowPct);
  if (server.hasArg("tempOffsetC")) s.tempOffsetC = server.arg("tempOffsetC").toFloat();
  if (server.hasArg("soundCalDb")) s.soundCalDb = server.arg("soundCalDb").toFloat();
  if (server.hasArg("aWeighting")) {
    const String v = server.arg("aWeighting");
    s.aWeighting = (v == "1" || v == "true" || v == "on");
  }
  settingsClamp(s);
  settings = s;
  if (!settingsSave()) {
    sendJson(Json().str("error", "could not write settings"), 500);
    return;
  }
  soundApplySettings();
  sendJson(settingsJson());
}

static void handleRefresh() {
  const uint32_t wait = appRequestDisplayRefresh();
  if (wait == 0) {
    sendJson(Json().boolean("ok", true));
  } else {
    sendJson(Json().boolean("ok", false).integer("retryInS", wait), 429);
  }
}

static void handleTime() {
  if (timeIsValid()) {
    sendJson(Json().str("error", "clock already set").boolean("ok", false), 409);
    return;
  }
  const long long e = server.arg("epoch").toInt();
  if (e < MIN_VALID_EPOCH) {
    sendJson(Json().str("error", "epoch must be unix seconds").boolean("ok", false), 400);
    return;
  }
  struct timeval tv = {(time_t)e, 0};
  settimeofday(&tv, nullptr);
  sendJson(Json().boolean("ok", true));
}

static void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {  // CORS preflight from the companion app
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.sendHeader("Access-Control-Allow-Private-Network", "true");
    server.send(204);
    return;
  }
  if (server.method() == HTTP_GET && serveAsset(server.uri())) return;  // "/" and the app's files
  sendJson(Json().str("error", "not found"), 404);
}

void webBegin() {
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/today", HTTP_GET, handleToday);
  server.on("/api/days", HTTP_GET, handleDays);
  server.on("/api/log", HTTP_GET, handleLog);
  server.on("/api/settings", HTTP_GET, handleSettingsGet);
  server.on("/api/settings", HTTP_POST, handleSettingsPost);
  server.on("/api/refresh", HTTP_POST, handleRefresh);
  server.on("/api/time", HTTP_POST, handleTime);
  server.onNotFound(handleNotFound);
  static const char* kRequestHeaders[] = {"If-None-Match"};  // so the app's files can answer 304
  server.collectHeaders(kRequestHeaders, 1);
  server.begin();
}

void webLoop() { server.handleClient(); }
