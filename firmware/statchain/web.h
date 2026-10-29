// HTTP server: the companion app at / (served from flash, see app_assets.h) and the JSON API it uses.
//
//   GET  /api/state      latest readings, device status
//   GET  /api/today      today's min / max / mean
//   GET  /api/days       list of logged days + flash usage
//   GET  /api/log?date=YYYYMMDD   that day's CSV (see logger.h for columns)
//   GET  /api/settings   current settings
//   POST /api/settings   form fields (any subset of the settings keys); returns new settings
//   POST /api/refresh    redraw the e-ink display now (rate limited)
//   POST /api/time       epoch=<unix seconds>; sets the clock, only while it isn't set
//
// No authentication: it is meant for your own network or the device's own hotspot.
// CORS is open so the companion web app can call it from another origin.
#pragma once

void webBegin();
void webLoop();
