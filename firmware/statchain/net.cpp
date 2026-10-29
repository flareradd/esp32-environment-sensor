#include "net.h"
#include "config.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <time.h>

static bool apOn = false, mdnsOn = false, sntpOn = false;
static uint32_t offlineSinceMs = 0;    // when we last had (or started without) a connection
static uint32_t connectedSinceMs = 0;
static String apName;

static void startAp() {
  if (apOn) return;
  // Station stays on (if configured) so the device can still join the network when it appears.
  WiFi.mode(WIFI_SSID[0] ? WIFI_AP_STA : WIFI_AP);
  apOn = WiFi.softAP(apName.c_str(), AP_PASS);
}

static void stopAp() {
  if (!apOn) return;
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  apOn = false;
}

void netBegin() {
  setenv("TZ", TZ_SYDNEY, 1);
  tzset();

  char suffix[8];
  snprintf(suffix, sizeof suffix, "%04X", (unsigned)(ESP.getEfuseMac() >> 32) & 0xFFFF);
  apName = String("Statchain-") + suffix;

  WiFi.persistent(false);  // credentials live in secrets.h, don't wear flash saving them
  WiFi.setHostname(HOSTNAME);
  WiFi.mode(WIFI_STA);
#ifdef WIFI_TX_POWER
  WiFi.setTxPower(WIFI_TX_POWER);
#endif
  offlineSinceMs = millis();
  if (WIFI_SSID[0]) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  } else {
    startAp();
  }
}

void netLoop() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (connectedSinceMs == 0) connectedSinceMs = now ? now : 1;
    offlineSinceMs = now;
    if (!sntpOn) {
      configTzTime(TZ_SYDNEY, NTP_SERVER_1, NTP_SERVER_2);
      sntpOn = true;
    }
    if (!mdnsOn && MDNS.begin(HOSTNAME)) {
      MDNS.addService("http", "tcp", 80);
      mdnsOn = true;
    }
    // Once the real network has been stable for a bit, the fallback hotspot isn't needed.
    if (apOn && WIFI_SSID[0] && now - connectedSinceMs > 10000) stopAp();
  } else {
    connectedSinceMs = 0;
    if (!apOn && now - offlineSinceMs > AP_FALLBACK_AFTER_MS) startAp();
  }
}

bool netConnected() { return WiFi.status() == WL_CONNECTED; }
bool netApActive() { return apOn; }

String netIp() {
  if (netConnected()) return WiFi.localIP().toString();
  if (apOn) return WiFi.softAPIP().toString();
  return String("");
}

int netRssi() { return netConnected() ? WiFi.RSSI() : 0; }
