// Wi-Fi (station + fallback hotspot), NTP time in Sydney local time, mDNS.
#pragma once
#include <Arduino.h>

void netBegin();  // also sets the timezone, so call before anything uses local time
void netLoop();   // call from loop(): reconnect policy, hotspot fallback, SNTP/mDNS start

bool netConnected();   // joined the configured network
bool netApActive();    // own hotspot "Statchain-XXXX" is up
String netIp();        // station IP if connected, else hotspot IP
int netRssi();         // dBm, 0 if not connected
